"""Staging, courier handover, manifests and missed-pickup detection."""
from collections import defaultdict
from datetime import timedelta

from .. import clock, config
from ..db import one, all_rows, scalar
from .common import Actor, DomainError, NotFound, SYSTEM, PACKED, STAGED, SHIPPED, next_id, log, require_office
from . import issues as issues_svc
from . import orders as orders_svc


def get_package(conn, package_id: str) -> dict:
    p = one(conn, "SELECT * FROM packages WHERE id = ?", ((package_id or "").strip().upper(),))
    if not p:
        raise NotFound(f"Package {package_id}")
    return p


def areas(conn) -> list[dict]:
    """Every place a parcel can wait: one lane per courier (that courier only) + the shared areas."""
    out = []
    for c in orders_svc.couriers(conn):
        out.append({"name": c["staging_lane"], "kind": "lane", "capacity": config.LANE_CAPACITY,
                    "courier_id": c["id"], "courier_name": c["name"],
                    "purpose": f"{c['name']} parcels only — the {c['name']} driver collects from this lane."})
    for a in config.STAGING_AREAS:
        out.append({**a, "courier_id": None, "courier_name": None})
    return out


def staging_locations(conn) -> list[str]:
    return [a["name"] for a in areas(conn)]


def _area(conn, name: str) -> dict | None:
    return next((a for a in areas(conn) if a["name"].lower() == (name or "").strip().lower()), None)


def _occupancy(conn) -> dict[str, int]:
    return {r["staging_location"]: r["n"] for r in all_rows(
        conn, "SELECT staging_location, COUNT(*) AS n FROM packages WHERE status='staged' GROUP BY staging_location")}


def suggest_location(conn, pkg: dict, occ: dict | None = None) -> dict:
    """Where this parcel should go, with the reason in plain words."""
    occ = occ if occ is not None else _occupancy(conn)
    o = orders_svc.get_order_row(conn, pkg["order_id"])
    c = orders_svc.courier(conn, pkg["courier_id"])
    all_areas = areas(conn)
    free = lambda a: occ.get(a["name"], 0) < a["capacity"]
    blocking = issues_svc.blocking_issues_for_order(conn, o["id"])
    if blocking or o["status"] == "CANCELLED":
        hold = next((a for a in all_areas if a["kind"] == "hold"), None)
        if hold:
            why = "order was cancelled" if o["status"] == "CANCELLED" else f"{blocking[0]['id']} must be resolved first"
            return {"location": hold["name"], "reason": f"Hold rack — {why}. It must not go out yet."}
    if o["priority"]:
        pr = next((a for a in all_areas if a["kind"] == "priority" and free(a)), None)
        if pr:
            return {"location": pr["name"], "reason": f"Priority order — keep it on {pr['name']} so it goes first."}
    lane = next(a for a in all_areas if a["name"] == c["staging_lane"])
    if free(lane):
        return {"location": lane["name"], "reason": f"{c['name']} lane — where the {c['name']} driver collects."}
    over = next((a for a in all_areas if a["kind"] == "overflow" and free(a)), None)
    if over:
        return {"location": over["name"], "reason": f"{lane['name']} is full ({lane['capacity']}) — use the overflow area."}
    return {"location": lane["name"], "reason": f"{c['name']} lane (every area is full — tidy the lane)."}


def stage_package(conn, actor: Actor, package_id: str, location: str, at=None, confirm_other_lane: bool = False) -> dict:
    pkg = get_package(conn, package_id)
    location = (location or "").strip()
    if not location:
        raise DomainError("Choose where the parcel is being placed", code="validation", status=422)
    area = _area(conn, location)
    if not area:
        raise DomainError(f"“{location}” is not a staging area. Choose one from the list.", code="validation", status=422)
    location = area["name"]
    if pkg["status"] == "cancelled":
        raise DomainError("This order was cancelled — pull the parcel from staging instead", code="cancelled")
    if pkg["status"] == "handed_over":
        raise DomainError("This parcel has already been handed to the courier", code="already_done")
    c = orders_svc.courier(conn, pkg["courier_id"])
    if area["kind"] == "lane" and area["courier_id"] != pkg["courier_id"] and not confirm_other_lane:
        raise DomainError(f"{area['name']} is for {area['courier_name']} parcels. This parcel goes with {c['name']} — "
                          f"the {area['courier_name']} driver could take it by mistake. Use {c['staging_lane']} or a shared "
                          "area.", code="wrong_lane", details={"suggested": c["staging_lane"]})
    at = at or clock.now_iso()
    if pkg["status"] == "staged":
        if pkg["staging_location"] == location:
            return pkg
        conn.execute("UPDATE packages SET staging_location=? WHERE id=?", (location, pkg["id"]))
        log(conn, actor, "moved", f"Package {pkg['id']} moved {pkg['staging_location']} → {location}",
            order_id=pkg["order_id"], package_id=pkg["id"], at=at)
        return get_package(conn, pkg["id"])
    o = orders_svc.get_order_row(conn, pkg["order_id"])
    if o["status"] != PACKED:
        raise DomainError("Only packed parcels can be staged", code="invalid_transition")
    conn.execute("UPDATE packages SET status='staged', staging_location=?, staged_at=? WHERE id=?",
                 (location, at, pkg["id"]))
    conn.execute("UPDATE orders SET status=?, staged_at=? WHERE id=?", (STAGED, at, o["id"]))
    note = "" if location == c["staging_lane"] else f" (courier lane: {c['staging_lane']})"
    log(conn, actor, "staged", f"Package {pkg['id']} staged at {location}{note} for {c['name']}",
        order_id=o["id"], package_id=pkg["id"], at=at)
    return get_package(conn, pkg["id"])


def _not_ready_reason(conn, pkg: dict, hold_names: set[str]) -> str | None:
    """None if the parcel may leave with its courier now, otherwise why not (plain words)."""
    if pkg["status"] != "staged":
        return "Not staged yet — only staged parcels can be handed over. Stage it first so we know where it is"
    if pkg["staging_location"] in hold_names:
        return f"On the hold rack ({pkg['staging_location']}) — move it to a lane when it is cleared"
    blocking = issues_svc.blocking_issues_for_order(conn, pkg["order_id"])
    if blocking:
        return f"{blocking[0]['id']} ({blocking[0]['type']}) must be resolved before shipping"
    return None


def handover(conn, actor: Actor, courier_id: str, package_ids: list[str], at=None, trigger: str = "manual",
             visit_id: str | None = None) -> dict:
    """Courier collects parcels. All-or-nothing validation, idempotent for parcels already handed over."""
    c = orders_svc.courier(conn, courier_id)
    if not package_ids:
        raise DomainError("Select at least one parcel to hand over", code="validation", status=422)
    hold_names = {a["name"] for a in areas(conn) if a["kind"] == "hold"}
    problems, fresh, already = [], [], []
    for pid in dict.fromkeys(p.strip().upper() for p in package_ids):
        pkg = get_package(conn, pid)
        if pkg["status"] == "handed_over":
            already.append(pkg)
            continue
        if pkg["courier_id"] != courier_id:
            other = orders_svc.courier(conn, pkg["courier_id"])
            problems.append(f"{pid} is booked with {other['name']}, not {c['name']}")
            continue
        why = _not_ready_reason(conn, pkg, hold_names)
        if why:
            problems.append(f"{pid}: {why}")
            continue
        fresh.append(pkg)
    if problems:
        raise DomainError("Handover stopped: " + "; ".join(problems), code="handover_blocked",
                          details={"problems": problems})
    if not fresh:
        m = already[0]["manifest_id"] if already else None
        return {"manifest": get_manifest(conn, m) if m else None, "handed_over": [], "already": [p["id"] for p in already]}
    at = at or clock.now_iso()
    mid = next_id(conn, "manifest", "MF-", 4)
    conn.execute("INSERT INTO manifests(id, courier_id, created_at, created_by, parcel_count, trigger) VALUES (?,?,?,?,?,?)",
                 (mid, courier_id, at, actor.name, len(fresh), trigger))
    how = {"manual": "", "on_arrival": " automatically when the courier arrived",
           "scheduled": " automatically at the scheduled pickup"}.get(trigger, "")
    for pkg in fresh:
        conn.execute("UPDATE packages SET status='handed_over', handed_over_at=?, manifest_id=? WHERE id=?",
                     (at, mid, pkg["id"]))
        conn.execute("UPDATE orders SET status=?, shipped_at=? WHERE id=?", (SHIPPED, at, pkg["order_id"]))
        log(conn, actor, "handed_over", f"Handed to {c['name']}{how} on manifest {mid} — shipped",
            order_id=pkg["order_id"], package_id=pkg["id"], at=at)
        issues_svc.auto_resolve(conn, actor, package_id=pkg["id"], types=["Missed Pickup"],
                                resolution=f"Collected by {c['name']} on manifest {mid}")
    log(conn, actor, "manifest", f"Manifest {mid}: {len(fresh)} parcel(s) handed to {c['name']}{how}", at=at)
    if visit_id:
        conn.execute("UPDATE courier_visits SET manifest_id=?, parcels=? WHERE id=?", (mid, len(fresh), visit_id))
    else:
        _record_visit(conn, actor, courier_id, at, trigger, mid, len(fresh))
    return {"manifest": get_manifest(conn, mid), "handed_over": [p["id"] for p in fresh],
            "already": [p["id"] for p in already]}


MODE_LABELS = {
    "manual": "Manual",
    "on_arrival": "Automatic when the courier arrives",
    "scheduled": "Automatic at pickup time",
}


def _record_visit(conn, actor: Actor, courier_id: str, at: str, trigger: str, manifest_id=None, parcels=0,
                  left_behind=0, note=None) -> str:
    vid = next_id(conn, "visit", "CV-", 4)
    conn.execute("""INSERT INTO courier_visits(id, courier_id, arrived_at, recorded_by, trigger, manifest_id, parcels,
                    left_behind, note) VALUES (?,?,?,?,?,?,?,?,?)""",
                 (vid, courier_id, at, actor.name, trigger, manifest_id, parcels, left_behind, note))
    return vid


def ready_parcels(conn, courier_id: str) -> tuple[list[dict], list[dict]]:
    """(ready, not_ready) staged parcels for one courier, ready ones in walking order by area."""
    hold_names = {a["name"] for a in areas(conn) if a["kind"] == "hold"}
    ready, not_ready = [], []
    for p in all_rows(conn, """SELECT p.*, o.priority FROM packages p JOIN orders o ON o.id = p.order_id
                               WHERE p.courier_id = ? AND p.status IN ('packed','staged')
                               ORDER BY o.priority DESC, p.staging_location, p.id""", (courier_id,)):
        why = _not_ready_reason(conn, p, hold_names)
        (not_ready if why else ready).append({**p, "reason": why})
    return ready, not_ready


def courier_arrived(conn, actor: Actor, courier_id: str, package_ids: list[str] | None = None, at=None,
                    trigger: str | None = None) -> dict:
    """The courier is at the dock. With `package_ids` (manual checklist) those parcels are handed over;
    without, the courier's handover mode decides: automatic modes hand over every ready parcel at once,
    manual just records the arrival so someone can tick the parcels."""
    c = orders_svc.courier(conn, courier_id)
    mode = c.get("handover_mode") or config.DEFAULT_HANDOVER_MODE
    at = at or clock.now_iso()
    ready, not_ready = ready_parcels(conn, courier_id)
    if package_ids is None:
        if mode == "manual":
            vid = _record_visit(conn, actor, courier_id, at, "manual", left_behind=len(not_ready))
            log(conn, actor, "courier_arrived", f"{c['name']} courier arrived — tick the parcels they take", at=at)
            return {"visit_id": vid, "mode": mode, "manifest": None, "handed_over": [],
                    "ready": [p["id"] for p in ready], "not_ready": [{"id": p["id"], "reason": p["reason"]} for p in not_ready]}
        package_ids = [p["id"] for p in ready]
    trig = trigger or ("manual" if mode == "manual" else "on_arrival")
    vid = _record_visit(conn, actor, courier_id, at, trig, left_behind=len(not_ready))
    log(conn, actor, "courier_arrived", f"{c['name']} courier arrived", at=at)
    out = {"manifest": None, "handed_over": [], "already": []}
    if package_ids:
        out = handover(conn, actor, courier_id, package_ids, at=at, trigger=trig, visit_id=vid)
    return {**out, "visit_id": vid, "mode": mode, "ready": [], "not_ready": [{"id": p["id"], "reason": p["reason"]}
                                                                          for p in not_ready]}


def set_handover_mode(conn, actor: Actor, courier_id: str, mode: str) -> dict:
    require_office(actor, "change how parcels are handed over")
    if mode not in config.HANDOVER_MODES:
        raise DomainError("Unknown handover mode", code="validation", status=422)
    c = orders_svc.courier(conn, courier_id)
    if c.get("handover_mode") == mode:
        return c
    conn.execute("UPDATE couriers SET handover_mode=? WHERE id=?", (mode, courier_id))
    log(conn, actor, "handover_mode", f"{c['name']}: handover set to “{MODE_LABELS[mode]}”")
    return orders_svc.courier(conn, courier_id)


def _scheduled_handovers(conn, now) -> int:
    """Couriers on 'scheduled' mode: at each pickup time every parcel that was ready on the lane
    (staged before the pickup) leaves automatically. Blocked parcels stay and fall to the missed-pickup rule."""
    done = 0
    hold_names = {a["name"] for a in areas(conn) if a["kind"] == "hold"}
    for c in orders_svc.couriers(conn):
        if (c.get("handover_mode") or "manual") != "scheduled":
            continue
        rows = all_rows(conn, """SELECT * FROM packages WHERE courier_id = ? AND status = 'staged'
                                 AND pickup_at IS NOT NULL AND pickup_at <= ? AND staged_at <= pickup_at
                                 ORDER BY pickup_at""", (c["id"], clock.iso(now)))
        by_slot = defaultdict(list)
        for p in rows:
            if not _not_ready_reason(conn, p, hold_names):
                by_slot[p["pickup_at"]].append(p["id"])
        for slot, ids in sorted(by_slot.items()):
            handover(conn, SYSTEM, c["id"], ids, at=slot, trigger="scheduled")
            done += len(ids)
    return done


def get_manifest(conn, manifest_id: str) -> dict:
    m = one(conn, "SELECT m.*, c.name AS courier_name FROM manifests m JOIN couriers c ON c.id = m.courier_id WHERE m.id=?",
            (manifest_id,))
    if not m:
        raise NotFound(f"Manifest {manifest_id}")
    m["trigger_label"] = {"manual": "Handed over by hand", "on_arrival": "Automatic — courier arrival",
                          "scheduled": "Automatic — scheduled pickup"}.get(m.get("trigger") or "manual")
    m["parcels"] = all_rows(conn, """SELECT p.id, p.order_id, p.package_type, p.weight_kg, p.handed_over_at,
                                     p.staging_location, o.customer_name, o.city, o.pincode, o.priority FROM packages p JOIN orders o ON o.id = p.order_id
                                     WHERE p.manifest_id = ? ORDER BY p.id""", (manifest_id,))
    return m


def sweep(conn, at=None) -> int:
    """Rule-based checks that depend on the clock. Safe to run on every page load:
    a parcel still in the building after its pickup (+grace) gets a Missed Pickup issue
    and is rolled to that courier's next pickup."""
    now = clock.parse(at) if at else clock.now()
    _scheduled_handovers(conn, now)
    grace = config.MISSED_PICKUP_GRACE_MIN * 60
    created = 0
    for pkg in all_rows(conn, "SELECT * FROM packages WHERE status IN ('packed','staged') AND pickup_at IS NOT NULL"):
        pickup = clock.parse(pkg["pickup_at"])
        if (now - pickup).total_seconds() <= grace:
            continue
        c = orders_svc.courier(conn, pkg["courier_id"])
        o = orders_svc.get_order_row(conn, pkg["order_id"])
        where = f"at {pkg['staging_location']}" if pkg["status"] == "staged" else "at the packing station (never staged)"
        iss = issues_svc.create_issue(
            conn, SYSTEM, type="Missed Pickup", severity="High" if o["priority"] else "Medium",
            title=f"{pkg['id']} missed the {c['name']} pickup ({clock.fmt_local(pickup)})",
            description=f"Parcel for {o['id']} was still {where} after the pickup window. "
                        "It has been moved to the next pickup — confirm with the courier.",
            order_id=o["id"], package_id=pkg["id"], dedupe_key=f"missed:{pkg['id']}:{pkg['pickup_at']}",
            at=clock.iso(pickup + timedelta(seconds=grace)))
        nxt = clock.next_pickup(c["pickups"], now)
        conn.execute("UPDATE packages SET pickup_at=? WHERE id=?", (clock.iso(nxt), pkg["id"]))
        log(conn, SYSTEM, "pickup_rolled", f"Moved to next {c['name']} pickup ({clock.fmt_local(nxt)})",
            order_id=o["id"], package_id=pkg["id"], issue_id=iss["id"], at=clock.iso(now))
        created += 1
    return created


def staging_overview(conn) -> dict:
    now = clock.now()
    pkgs = all_rows(conn, """SELECT p.*, o.priority, o.customer_name, o.ship_by, o.city FROM packages p
                             JOIN orders o ON o.id = p.order_id WHERE p.status IN ('packed','staged')
                             ORDER BY o.priority DESC, p.pickup_at, p.packed_at""")
    missed_pkg = {r["package_id"] for r in all_rows(conn, "SELECT package_id FROM issues WHERE type='Missed Pickup'"
                                                          " AND status != 'Resolved' AND package_id IS NOT NULL")}
    groups = defaultdict(list)
    for p in pkgs:
        since = clock.parse(p["staged_at"] or p["packed_at"])
        p["waiting_minutes"] = round((now - since).total_seconds() / 60)
        p["priority"] = bool(p["priority"])
        p["missed_pickup"] = p["id"] in missed_pkg
        groups[p["courier_id"]].append(p)
    out = []
    for c in orders_svc.couriers(conn):
        nxt = clock.next_pickup(c["pickups"], now)
        ps = groups.get(c["id"], [])
        unstaged = sum(1 for p in ps if p["status"] == "packed")
        mins = (nxt - now).total_seconds() / 60
        out.append({
            "courier": {"id": c["id"], "name": c["name"], "lane": c["staging_lane"], "pickups": c["pickups"],
                        "cost": c["cost_per_parcel"], "delivery": f"{c['delivery_days_min']}–{c['delivery_days_max']} days"},
            "next_pickup": clock.iso(nxt), "next_pickup_label": clock.fmt_local(nxt), "minutes_to_pickup": round(mins),
            "packages": ps, "staged": sum(1 for p in ps if p["status"] == "staged"), "unstaged": unstaged,
            "alert": unstaged > 0 and mins <= config.PICKUP_ALERT_MIN,
        })
    manifests = all_rows(conn, "SELECT m.*, c.name AS courier_name FROM manifests m JOIN couriers c ON c.id = m.courier_id"
                               " ORDER BY m.created_at DESC LIMIT 8")
    pulls = _pull_list(conn)
    return {"couriers": out, "manifests": manifests, "locations": staging_locations(conn), "pull_from_staging": pulls}


def _pull_list(conn) -> list[dict]:
    return all_rows(conn, """SELECT i.id AS issue_id, i.package_id, p.staging_location, i.order_id FROM issues i
                             JOIN packages p ON p.id = i.package_id WHERE i.type='Return to Shelf' AND i.status != 'Resolved'
                             AND p.staged_at IS NOT NULL""")


def _pkg_rows(conn, where: str, params=()) -> list[dict]:
    now = clock.now()
    rows = all_rows(conn, f"""SELECT p.*, o.priority, o.customer_name, o.ship_by, o.city, o.status AS order_status,
                                     c.name AS courier_name, c.staging_lane AS courier_lane
                              FROM packages p JOIN orders o ON o.id = p.order_id JOIN couriers c ON c.id = p.courier_id
                              WHERE {where} ORDER BY o.priority DESC, p.pickup_at, p.packed_at""", params)
    missed = {r["package_id"] for r in all_rows(conn, "SELECT package_id FROM issues WHERE type='Missed Pickup'"
                                                      " AND status != 'Resolved' AND package_id IS NOT NULL")}
    for p in rows:
        since = clock.parse(p["staged_at"] or p["packed_at"])
        p["waiting_minutes"] = round((now - since).total_seconds() / 60)
        p["priority"] = bool(p["priority"])
        p["missed_pickup"] = p["id"] in missed
    return rows


def staging_board(conn) -> dict:
    """Staging page: parcels still to place, and every staging area with what is in it."""
    occ = _occupancy(conn)
    hold_names = {a["name"] for a in areas(conn) if a["kind"] == "hold"}
    to_stage = _pkg_rows(conn, "p.status = 'packed'")
    for p in to_stage:
        p["suggestion"] = suggest_location(conn, p, occ)
    staged = _pkg_rows(conn, "p.status = 'staged'")
    by_area = defaultdict(list)
    lane_names = {a["name"] for a in areas(conn) if a["kind"] == "lane"}
    for p in staged:
        p["not_ready"] = _not_ready_reason(conn, p, hold_names)
        p["wrong_lane"] = p["staging_location"] != p["courier_lane"] and p["staging_location"] in lane_names
        by_area[p["staging_location"]].append(p)
    out_areas = []
    for a in areas(conn):
        ps = by_area.pop(a["name"], [])
        out_areas.append({**a, "count": len(ps), "fill_pct": round(len(ps) / a["capacity"] * 100) if a["capacity"] else 0,
                          "packages": ps, "couriers": sorted({p["courier_name"] for p in ps}),
                          "priority": sum(1 for p in ps if p["priority"])})
    for name, ps in by_area.items():
        out_areas.append({"name": name, "kind": "other", "capacity": max(len(ps), 1), "purpose": "Not a configured area — "
                          "move these parcels to a lane or shared area.", "courier_id": None, "courier_name": None,
                          "count": len(ps), "fill_pct": 100, "packages": ps, "couriers": sorted({p["courier_name"] for p in ps}),
                          "priority": sum(1 for p in ps if p["priority"])})
    now = clock.now()
    couriers = []
    for c in orders_svc.couriers(conn):
        nxt = clock.next_pickup(c["pickups"], now)
        couriers.append({"id": c["id"], "name": c["name"], "lane": c["staging_lane"], "next_pickup": clock.iso(nxt),
                         "minutes_to_pickup": round((nxt - now).total_seconds() / 60),
                         "to_stage": sum(1 for p in to_stage if p["courier_id"] == c["id"])})
    return {
        "to_stage": to_stage, "areas": out_areas, "couriers": couriers, "pull_from_staging": _pull_list(conn),
        "counts": {"to_stage": len(to_stage), "staged": len(staged),
                   "on_hold": sum(1 for p in staged if p["staging_location"] in hold_names),
                   "wrong_lane": sum(1 for p in staged if p["wrong_lane"]),
                   "areas_full": sum(1 for a in out_areas if a["count"] >= a["capacity"])},
        "alert_minutes": config.PICKUP_ALERT_MIN,
    }


def handover_board(conn) -> dict:
    """Ready to hand over: per courier, the parcels that can leave now, the ones that can't (and why),
    the handover mode and whether the courier is on site."""
    now = clock.now()
    today = clock.iso(clock.at_local_time(clock.local(now), clock.hhmm("00:00")))
    out = []
    for c in orders_svc.couriers(conn):
        ready, not_ready = ready_parcels(conn, c["id"])
        rows = {p["id"]: p for p in _pkg_rows(conn, "p.courier_id = ? AND p.status IN ('staged','packed')", (c["id"],))}
        ready = [{**rows[p["id"]], "reason": None} for p in ready if p["id"] in rows]
        not_ready = [{**rows[p["id"]], "reason": p["reason"]} for p in not_ready if p["id"] in rows]
        nxt = clock.next_pickup(c["pickups"], now)
        mins = (nxt - now).total_seconds() / 60
        last = one(conn, "SELECT * FROM courier_visits WHERE courier_id = ? ORDER BY arrived_at DESC LIMIT 1", (c["id"],))
        on_site = bool(last and (now - clock.parse(last["arrived_at"])).total_seconds() / 60 <= config.COURIER_ON_SITE_MIN)
        mode = c.get("handover_mode") or config.DEFAULT_HANDOVER_MODE
        unstaged = sum(1 for p in not_ready if p["status"] == "packed")
        out.append({
            "courier": {"id": c["id"], "name": c["name"], "lane": c["staging_lane"], "pickups": c["pickups"],
                        "cost": c["cost_per_parcel"], "delivery": f"{c['delivery_days_min']}–{c['delivery_days_max']} days"},
            "mode": mode, "mode_label": MODE_LABELS[mode],
            "next_pickup": clock.iso(nxt), "minutes_to_pickup": round(mins),
            "ready": ready, "not_ready": not_ready, "unstaged": unstaged,
            "alert": (unstaged > 0 or bool(ready)) and mins <= config.PICKUP_ALERT_MIN,
            "on_site": on_site, "last_visit": last,
            "shipped_today": scalar(conn, "SELECT COUNT(*) FROM packages WHERE courier_id = ? AND status='handed_over' "
                                          "AND handed_over_at >= ?", (c["id"], today)) or 0,
            "locations": sorted({p["staging_location"] for p in ready}),
        })
    out.sort(key=lambda g: (not g["on_site"], not (g["ready"] or g["not_ready"]), g["minutes_to_pickup"]))
    return {
        "couriers": out,
        "modes": [{"id": m, "label": MODE_LABELS[m]} for m in config.HANDOVER_MODES],
        "counts": {"ready": sum(len(g["ready"]) for g in out), "not_ready": sum(len(g["not_ready"]) for g in out),
                   "on_site": sum(1 for g in out if g["on_site"])},
        "pull_from_staging": _pull_list(conn),
        "on_site_minutes": config.COURIER_ON_SITE_MIN,
    }


def shipped(conn, range_: str = "today", courier_id: str | None = None, q: str | None = None) -> dict:
    """Everything that has left the building: parcels, manifests and courier visits."""
    now = clock.now()
    start_today = clock.at_local_time(clock.local(now), clock.hhmm("00:00"))
    ranges = {"today": (start_today, None), "yesterday": (start_today - timedelta(days=1), start_today),
              "7d": (start_today - timedelta(days=6), None), "all": (None, None)}
    frm, to = ranges.get(range_ or "today", ranges["today"])
    cond, params = ["p.status = 'handed_over'"], []
    if frm:
        cond.append("p.handed_over_at >= ?"); params.append(clock.iso(frm))
    if to:
        cond.append("p.handed_over_at < ?"); params.append(clock.iso(to))
    if courier_id:
        cond.append("p.courier_id = ?"); params.append(courier_id)
    ql = (q or "").strip().upper()
    if ql:
        cond.append("(p.id LIKE ? OR p.order_id LIKE ? OR UPPER(o.customer_name) LIKE ? OR p.manifest_id LIKE ? OR UPPER(o.city) LIKE ?)")
        params += [f"%{ql}%"] * 5
    parcels = all_rows(conn, f"""SELECT p.id, p.order_id, p.package_type, p.weight_kg, p.courier_id, p.label_code,
                                        p.handed_over_at, p.manifest_id, p.staging_location, o.customer_name, o.city,
                                        o.pincode, o.priority, o.ship_by, o.channel, c.name AS courier_name,
                                        m.created_by AS handed_by, m.trigger
                                 FROM packages p JOIN orders o ON o.id = p.order_id JOIN couriers c ON c.id = p.courier_id
                                 LEFT JOIN manifests m ON m.id = p.manifest_id
                                 WHERE {' AND '.join(cond)} ORDER BY p.handed_over_at DESC, p.id LIMIT 500""", tuple(params))
    for p in parcels:
        p["priority"] = bool(p["priority"])
        p["on_time"] = p["handed_over_at"] <= p["ship_by"]
    mcond, mparams = [], []
    if frm:
        mcond.append("m.created_at >= ?"); mparams.append(clock.iso(frm))
    if to:
        mcond.append("m.created_at < ?"); mparams.append(clock.iso(to))
    if courier_id:
        mcond.append("m.courier_id = ?"); mparams.append(courier_id)
    mwhere = ("WHERE " + " AND ".join(mcond)) if mcond else ""
    manifests = all_rows(conn, f"""SELECT m.*, c.name AS courier_name FROM manifests m JOIN couriers c ON c.id = m.courier_id
                                   {mwhere} ORDER BY m.created_at DESC LIMIT 200""", tuple(mparams))
    visits = all_rows(conn, f"""SELECT v.*, c.name AS courier_name FROM courier_visits v JOIN couriers c ON c.id = v.courier_id
                                {mwhere.replace('m.created_at', 'v.arrived_at').replace('m.courier_id', 'v.courier_id')}
                                ORDER BY v.arrived_at DESC LIMIT 200""", tuple(mparams))
    by_courier = defaultdict(int)
    for p in parcels:
        by_courier[p["courier_name"]] += 1
    return {
        "range": range_ or "today",
        "stats": {"parcels": len(parcels), "manifests": len(manifests),
                  "automatic": sum(1 for p in parcels if p["trigger"] in ("on_arrival", "scheduled")),
                  "on_time_pct": round(sum(1 for p in parcels if p["on_time"]) / len(parcels) * 100) if parcels else None,
                  "priority": sum(1 for p in parcels if p["priority"]),
                  "by_courier": [{"courier": k, "parcels": v} for k, v in sorted(by_courier.items(), key=lambda x: -x[1])]},
        "parcels": parcels, "manifests": manifests, "visits": visits,
        "couriers": [{"id": c["id"], "name": c["name"]} for c in orders_svc.couriers(conn)],
    }


def find_package(conn, q: str) -> list[dict]:
    q = (q or "").strip().upper()
    if not q:
        return []
    return all_rows(conn, """SELECT p.*, o.customer_name, o.priority, c.name AS courier_name FROM packages p
                             JOIN orders o ON o.id = p.order_id JOIN couriers c ON c.id = p.courier_id
                             WHERE p.id LIKE ? OR p.order_id LIKE ? OR p.label_code LIKE ?
                             ORDER BY p.packed_at DESC LIMIT 10""", (f"%{q}%", f"%{q}%", f"%{q}%"))
