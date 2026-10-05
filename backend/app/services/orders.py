"""Orders: intake, processing checks, courier choice, deadlines, blocked reasons and next actions."""
from datetime import timedelta

from .. import clock, config
from ..db import one, all_rows
from .common import (
    Actor, DomainError, NotFound, SYSTEM, RECEIVED, ON_HOLD, AWAITING_STOCK, READY_TO_PICK, PICKING, READY_TO_PACK,
    PACKED, STAGED, SHIPPED, CANCELLED, OPEN_STATUSES, STATUS_LABELS, STATUS_TO_STAGE, HOLD_ISSUE_TYPES, MAIN, SECONDARY,
    next_id, log, require_office, fmt_minutes, dumps,
)
from . import inventory as inv
from . import issues as issues_svc


def couriers(conn) -> list[dict]:
    rows = all_rows(conn, "SELECT * FROM couriers ORDER BY id")
    for r in rows:
        r["pickups"] = r["pickup_times"].split(",")
    return rows


def courier(conn, courier_id: str) -> dict:
    c = one(conn, "SELECT * FROM couriers WHERE id = ?", (courier_id,))
    if not c:
        raise NotFound(f"Courier {courier_id}")
    c["pickups"] = c["pickup_times"].split(",")
    return c


def courier_options(conn, order: dict, at=None) -> list[dict]:
    """Every courier with its next pickup, cost and speed — the facts behind the recommendation."""
    now = clock.parse(at) if at else clock.now()
    ship_by = clock.parse(order["ship_by"])
    out = []
    for c in couriers(conn):
        nxt = clock.next_pickup(c["pickups"], now)
        out.append({
            "id": c["id"], "name": c["name"], "next_pickup": clock.iso(nxt), "next_pickup_label": clock.fmt_local(nxt),
            "cost": c["cost_per_parcel"], "delivery": f"{c['delivery_days_min']}–{c['delivery_days_max']} days",
            "delivery_days_min": c["delivery_days_min"], "meets_ship_by": nxt <= ship_by,
        })
    return out


def recommend_courier(conn, order: dict, at=None) -> tuple[str, str]:
    """Transparent rule, not a black box:
    - only couriers whose next pickup is before the ship-by time are considered;
    - priority orders get the fastest delivery (then earliest pickup);
    - normal orders get the lowest cost (then earliest pickup);
    - if nobody can make the ship-by time, take the earliest pickup."""
    opts = courier_options(conn, order, at)
    ok = [o for o in opts if o["meets_ship_by"]]
    if not ok:
        best = min(opts, key=lambda o: o["next_pickup"])
        return best["id"], f"Earliest pickup ({best['next_pickup_label']}) — no courier collects before ship-by"
    if order["priority"]:
        best = min(ok, key=lambda o: (o["delivery_days_min"], o["next_pickup"]))
        return best["id"], f"Fastest delivery ({best['delivery']}) with a pickup before ship-by"
    best = min(ok, key=lambda o: (o["cost"], o["next_pickup"]))
    return best["id"], f"Lowest cost (₹{best['cost']:.0f}) with a pickup before ship-by"


def compute_ship_by(received_at, priority: bool):
    """Returns (ship_by_utc, after_cutoff)."""
    lr = clock.local(received_at)
    ship_t = clock.hhmm(config.SHIP_BY_TIME)
    if priority:
        cutoff = clock.hhmm(config.PRIORITY_CUTOFF)
        after = lr.time() >= cutoff
        day = lr + timedelta(days=1 if after else 0)
    else:
        cutoff = clock.hhmm(config.NORMAL_CUTOFF)
        after = lr.time() >= cutoff
        day = lr + timedelta(days=2 if after else 1)
    return clock.at_local_time(day, ship_t), after


def create_order(conn, actor: Actor, *, channel: str, channel_ref: str, customer_name: str, phone: str,
                 address: str, city: str, pincode: str, priority: bool, items: list[dict], received_at=None,
                 order_id: str | None = None) -> dict:
    if not items:
        raise DomainError("An order needs at least one item", code="validation", status=422)
    rec = clock.parse(received_at) if isinstance(received_at, str) else (received_at or clock.now())
    ship_by, after = compute_ship_by(rec, priority)
    oid = order_id or next_id(conn, "order", "FH-", 5, start=23001)
    lines = []
    value = 0.0
    for it in items:
        p = inv.product_by_sku(conn, it["sku"])
        q = int(it["qty"])
        if q <= 0:
            raise DomainError("Quantities must be at least 1", code="validation", status=422)
        lines.append((p, q))
        value += p["price"] * q
    conn.execute(
        "INSERT INTO orders(id, channel, channel_ref, customer_name, phone, address, city, pincode, priority, status,"
        " received_at, ship_by, after_cutoff, order_value) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (oid, channel, channel_ref, customer_name, phone, address, city, pincode, 1 if priority else 0, RECEIVED,
         clock.iso(rec), clock.iso(ship_by), 1 if after else 0, round(value, 2)))
    for p, q in lines:
        conn.execute("INSERT INTO order_items(order_id, product_id, qty) VALUES (?,?,?)", (oid, p["id"], q))
    msg = f"Order received from {channel} ({channel_ref})"
    if after:
        msg += f" after the {'priority' if priority else 'daily'} cutoff — ships by {clock.fmt_local(ship_by)}"
    log(conn, actor, "received", msg, order_id=oid, at=clock.iso(rec))
    return get_order_row(conn, oid)


def get_order_row(conn, order_id: str) -> dict:
    o = one(conn, "SELECT * FROM orders WHERE id = ?", ((order_id or "").strip().upper(),))
    if not o:
        raise NotFound(f"Order {order_id}")
    return o


def items_for(conn, order_id: str) -> list[dict]:
    return all_rows(conn, """
        SELECT oi.*, p.sku, p.base_code, p.name, p.variant, p.weight_kg, p.substitutable, p.price,
               m.bin AS bin, (m.on_hand - m.reserved) AS main_available, (s.on_hand - s.reserved) AS secondary_available
        FROM order_items oi JOIN products p ON p.id = oi.product_id
        LEFT JOIN inventory m ON m.product_id = p.id AND m.warehouse_id = 'MAIN'
        LEFT JOIN inventory s ON s.product_id = p.id AND s.warehouse_id = 'SEC'
        WHERE oi.order_id = ? ORDER BY m.bin, oi.id""", (order_id,))


def _hold_checks(conn, order: dict) -> list[tuple[str, str, str]]:
    """Returns (issue_type, title, description) for every reason to hold this order."""
    found = []
    dup = one(conn, """SELECT id FROM orders WHERE channel = ? AND channel_ref = ? AND id != ? AND status != ?
                       AND received_at <= ? ORDER BY received_at LIMIT 1""",
              (order["channel"], order["channel_ref"], order["id"], CANCELLED, order["received_at"]))
    if dup:
        found.append(("Duplicate Order", f"Possible duplicate of {dup['id']}",
                      f"{order['channel']} reference {order['channel_ref']} was already imported as {dup['id']}. "
                      "Cancel this copy unless the customer really placed two orders."))
    missing = []
    pin = (order["pincode"] or "").strip()
    if not (pin.isdigit() and len(pin) == 6):
        missing.append("PIN code")
    if not (order["phone"] or "").strip():
        missing.append("phone number")
    if len((order["address"] or "").strip()) < 10:
        missing.append("house/street details")
    if missing:
        found.append(("Address Problem", f"Incomplete address: missing {', '.join(missing)}",
                      "The courier cannot deliver without a complete address. Contact the customer or the channel."))
    items = all_rows(conn, "SELECT qty FROM order_items WHERE order_id = ?", (order["id"],))
    if order["order_value"] > config.HIGH_VALUE_THRESHOLD or any(i["qty"] > config.MAX_QTY_PER_LINE for i in items):
        found.append(("Unusual Order", "Unusual value or quantity — quick review needed",
                      f"Order value ₹{order['order_value']:.0f}; check it is genuine before committing stock."))
    return found


def process_order(conn, actor: Actor, order_id: str, courier_id: str | None = None, *, skip_checks=False,
                  at=None) -> dict:
    require_office(actor, "process orders")
    o = get_order_row(conn, order_id)
    if o["status"] == ON_HOLD and not skip_checks:
        raise DomainError("This order is on hold. Review the hold reason, then use Release hold.", code="on_hold")
    if o["status"] not in (RECEIVED, ON_HOLD):
        raise DomainError(f"Order {o['id']} is already {STATUS_LABELS[o['status']].lower()}", code="already_done")
    at = at or clock.now_iso()
    if not skip_checks:
        problems = _hold_checks(conn, o)
        if problems:
            reason = "; ".join(p[1] for p in problems)
            conn.execute("UPDATE orders SET status=?, hold_reason=? WHERE id=?", (ON_HOLD, reason, o["id"]))
            for typ, title, desc in problems:
                issues_svc.create_issue(conn, actor, type=typ, severity="Medium", title=f"{o['id']}: {title}",
                                        description=desc, order_id=o["id"], blocking=True,
                                        dedupe_key=f"hold:{o['id']}:{typ}", at=at)
            log(conn, actor, "on_hold", f"Put on hold: {reason}", order_id=o["id"], at=at)
            return get_order_row(conn, o["id"])
    if courier_id:
        courier(conn, courier_id)
        reason = "Chosen manually by the office"
    elif o["courier_id"]:
        courier_id, reason = o["courier_id"], o["courier_reason"] or "Chosen manually by the office"
    else:
        courier_id, reason = recommend_courier(conn, o, at)
    c = courier(conn, courier_id)
    conn.execute("UPDATE orders SET courier_id=?, courier_reason=?, label_code=?, processed_at=?, hold_reason=NULL"
                 " WHERE id=?", (courier_id, reason, f"LBL-{o['id']}", at, o["id"]))
    log(conn, actor, "processed", f"Processed — {c['name']} selected ({reason}); label LBL-{o['id']} created",
        order_id=o["id"], at=at)
    inv.try_reserve(conn, actor, o["id"], at=at)
    return get_order_row(conn, o["id"])


def release_hold(conn, actor: Actor, order_id: str, note: str) -> dict:
    require_office(actor, "release holds")
    o = get_order_row(conn, order_id)
    if o["status"] != ON_HOLD:
        raise DomainError("This order is not on hold", code="not_on_hold")
    if not note or not note.strip():
        raise DomainError("Add a note explaining why the hold is safe to release", code="validation", status=422)
    issues_svc.auto_resolve(conn, actor, order_id=o["id"], types=HOLD_ISSUE_TYPES,
                            resolution=f"Hold released: {note.strip()}")
    log(conn, actor, "hold_released", f"Hold released: {note.strip()}", order_id=o["id"])
    return process_order(conn, actor, o["id"], skip_checks=True)


def change_courier(conn, actor: Actor, order_id: str, courier_id: str) -> dict:
    require_office(actor, "change couriers")
    o = get_order_row(conn, order_id)
    if o["status"] in (SHIPPED, CANCELLED):
        raise DomainError("The courier can't be changed after the order has shipped or been cancelled")
    c = courier(conn, courier_id)
    if o["courier_id"] == courier_id:
        return o
    conn.execute("UPDATE orders SET courier_id=?, courier_reason=? WHERE id=?",
                 (courier_id, "Chosen manually by the office", o["id"]))
    pkg = one(conn, "SELECT * FROM packages WHERE order_id = ?", (o["id"],))
    if pkg and pkg["status"] in ("packed", "staged"):
        nxt = clock.next_pickup(c["pickups"], clock.now())
        conn.execute("UPDATE packages SET courier_id=?, pickup_at=? WHERE id=?", (courier_id, clock.iso(nxt), pkg["id"]))
        if pkg["status"] == "staged":
            log(conn, actor, "restage_needed", f"Move {pkg['id']} to {c['staging_lane']} for the new courier",
                order_id=o["id"], package_id=pkg["id"])
    log(conn, actor, "courier_changed", f"Courier changed to {c['name']}", order_id=o["id"])
    return get_order_row(conn, o["id"])


def cancel_order(conn, actor: Actor, order_id: str, reason: str, at=None) -> dict:
    require_office(actor, "cancel orders")
    o = get_order_row(conn, order_id)
    if o["status"] == CANCELLED:
        return o
    if o["status"] == SHIPPED:
        raise DomainError("This order has already been handed to the courier and can't be cancelled here")
    if not reason or not reason.strip():
        raise DomainError("Give a reason for cancelling", code="validation", status=422)
    at = at or clock.now_iso()
    inv.release_reservations(conn, o["id"])
    picked = [i for i in items_for(conn, o["id"]) if i["picked_qty"] > 0]
    pkg = one(conn, "SELECT * FROM packages WHERE order_id = ?", (o["id"],))
    conn.execute("UPDATE orders SET status=?, cancelled_at=?, cancel_reason=? WHERE id=?",
                 (CANCELLED, at, reason.strip(), o["id"]))
    issues_svc.auto_resolve(conn, actor, order_id=o["id"], resolution="Order cancelled")
    log(conn, actor, "cancelled", f"Order cancelled: {reason.strip()}", order_id=o["id"], at=at)
    if picked:
        steps = []
        if pkg and pkg["status"] == "staged":
            steps.append(f"Pull package {pkg['id']} from {pkg['staging_location']} so it isn't handed to the courier.")
        elif pkg:
            steps.append(f"Open package {pkg['id']} at the packing station.")
        steps.append("Return to shelf: " + ", ".join(f"{i['picked_qty']} × {i['sku']} → bin {i['bin']}" for i in picked))
        issues_svc.create_issue(
            conn, actor, type="Return to Shelf", severity="Medium",
            title=f"{o['id']} cancelled after picking — return items to the shelf",
            description=" ".join(steps), order_id=o["id"], package_id=pkg["id"] if pkg else None,
            payload={"lines": [{"product_id": i["product_id"], "qty": i["picked_qty"], "bin": i["bin"]} for i in picked]},
            dedupe_key=f"return:{o['id']}", at=at)
    if pkg:
        conn.execute("UPDATE packages SET status='cancelled' WHERE id=?", (pkg["id"],))
    inv.allocate_waiting(conn, actor, at=at)
    return get_order_row(conn, o["id"])


def risk_of(order: dict, *, blocked: bool = False, pickup_at: str | None = None, now=None) -> dict:
    now = now or clock.now()
    if order["status"] in (SHIPPED, CANCELLED):
        on_time = order["status"] == SHIPPED and order["shipped_at"] and order["shipped_at"] <= order["ship_by"]
        return {"state": "done", "label": "Shipped on time" if on_time else ("Shipped late" if order["status"] == SHIPPED else "Cancelled"),
                "minutes_left": None, "reason": None}
    ship_by = clock.parse(order["ship_by"])
    mins = (ship_by - now).total_seconds() / 60
    if mins < 0:
        return {"state": "delayed", "label": "Delayed", "minutes_left": round(mins),
                "reason": f"Ship-by passed {fmt_minutes(mins)} ago"}
    if order["status"] == STAGED and pickup_at and pickup_at <= order["ship_by"]:
        return {"state": "on_track", "label": "On track", "minutes_left": round(mins),
                "reason": "Staged for a pickup before ship-by"}
    window = config.AT_RISK_WINDOW_PRIORITY_MIN if order["priority"] else config.AT_RISK_WINDOW_NORMAL_MIN
    if mins <= window:
        return {"state": "at_risk", "label": "At risk", "minutes_left": round(mins),
                "reason": f"Only {fmt_minutes(mins)} left and not yet staged"}
    if blocked and order["priority"]:
        return {"state": "at_risk", "label": "At risk", "minutes_left": round(mins),
                "reason": "Priority order is blocked"}
    return {"state": "on_track", "label": "On track", "minutes_left": round(mins), "reason": None}


def blocked_info(conn, order: dict) -> dict:
    """Plain-language 'Why is this blocked?' with real numbers."""
    reasons: list[str] = []
    kind = None
    if order["status"] == ON_HOLD:
        kind = "hold"
        holds = [i for i in issues_svc.open_issues_for_order(conn, order["id"]) if i["type"] in HOLD_ISSUE_TYPES]
        if holds:
            reasons += [f"On hold — {h['title'].split(': ', 1)[-1]}." for h in holds]
        else:
            reasons.append(f"On hold — {order['hold_reason'] or 'needs office review'}.")
    if order["status"] == AWAITING_STOCK:
        kind = kind or "stock"
        for it in items_for(conn, order["id"]):
            if it["pick_status"] in ("not_found", "damaged"):
                continue
            need = inv.line_need(it)
            if not need or (it["main_available"] or 0) >= need:
                continue
            main_av, sec_av = it["main_available"] or 0, it["secondary_available"] or 0
            s = (f"SKU {it['sku']} ({it['variant']}) needs {need} unit{'s' if need != 1 else ''}. "
                 f"Main Warehouse has {main_av} available. Secondary Warehouse has {sec_av}.")
            tr = one(conn, "SELECT * FROM transfers WHERE product_id = ? AND status IN ('requested','in_transit')",
                     (it["product_id"],))
            incoming = one(conn, """SELECT i.id, i.expected_at, i.status FROM inbound_lines l JOIN inbound i ON i.id = l.inbound_id
                                    WHERE l.product_id = ? AND i.warehouse_id = 'MAIN' AND i.status IN ('expected','received')
                                    ORDER BY CASE i.status WHEN 'received' THEN 0 ELSE 1 END, i.expected_at LIMIT 1""",
                           (it["product_id"],))
            if tr:
                s += f" Transfer {tr['id']} ({tr['qty']} units) is {'on its way' if tr['status'] == 'in_transit' else 'requested'}."
            elif sec_av >= need - main_av:
                s += " Transfer required."
            elif incoming:
                s += (f" Supplier delivery {incoming['id']} is "
                      f"{'waiting to be put away' if incoming['status'] == 'received' else 'expected ' + clock.fmt_local(clock.parse(incoming['expected_at']))}.")
            else:
                s += " Not enough stock anywhere — reorder from the supplier (Reorders page) or cancel."
            reasons.append(s)
    for iss in issues_svc.blocking_issues_for_order(conn, order["id"]):
        if iss["type"] in HOLD_ISSUE_TYPES:
            continue
        kind = kind or "issue"
        reasons.append(f"{iss['id']} is open: {iss['title']}.")
    return {"blocked": bool(reasons), "kind": kind, "reasons": reasons}


def next_action(conn, order: dict, blocked: dict, package: dict | None) -> dict:
    s = order["status"]
    oid = order["id"]
    if s == CANCELLED:
        ret = one(conn, "SELECT id FROM issues WHERE order_id=? AND type='Return to Shelf' AND status!='Resolved'", (oid,))
        if ret:
            return {"text": "Return the picked items to their bins, then resolve the return task.",
                    "cta": {"kind": "open_issue", "label": "Open return task", "issue_id": ret["id"]}}
        return {"text": "Cancelled — no action needed.", "cta": None}
    if s == SHIPPED:
        return {"text": "Shipped — no action needed.", "cta": None}
    if s == RECEIVED:
        return {"text": "Process the order: check address, choose a courier and reserve stock.",
                "cta": {"kind": "process", "label": "Process order", "office_only": True}}
    if s == ON_HOLD:
        return {"text": "Review the hold. Release it if everything checks out, or cancel the order.",
                "cta": {"kind": "release_hold", "label": "Release hold", "office_only": True}}
    blocking = [i for i in issues_svc.blocking_issues_for_order(conn, oid) if i["type"] not in HOLD_ISSUE_TYPES]
    if blocking:
        i = blocking[0]
        return {"text": f"Resolve {i['id']} ({i['type']}) before this order can move on.",
                "cta": {"kind": "open_issue", "label": f"Open {i['id']}", "issue_id": i["id"]}}
    if s == AWAITING_STOCK:
        for sh in inv.shortages(conn):
            if any(o["order_id"] == oid for o in sh["orders"]):
                if sh["open_transfer"]:
                    tr = sh["open_transfer"]
                    return {"text": f"Receive transfer {tr['id']} ({tr['qty']} × {sh['sku']}) at the Main Warehouse when it arrives.",
                            "cta": {"kind": "receive_transfer", "label": f"Mark {tr['id']} received", "transfer_id": tr["id"],
                                    "office_only": False}}
                if sh["suggested_transfer_qty"]:
                    q = sh["suggested_transfer_qty"]
                    n = len(sh["orders"])
                    covers = f"covers all {n} waiting orders" if n > 1 and q >= sh["shortfall"] else ""
                    refill = "refills the bin" if q > sh["shortfall"] else ""
                    extra = f" ({' and '.join(x for x in (covers, refill) if x)})" if covers or refill else ""
                    return {"text": f"Transfer {q} units of {sh['sku']} from the Secondary Warehouse{extra}.",
                            "cta": {"kind": "create_transfer", "label": f"Transfer {q} units", "sku": sh["sku"], "qty": q,
                                    "office_only": True}}
                if sh["incoming_delivery"]:
                    d = sh["incoming_delivery"]
                    if d["status"] == "received":
                        return {"text": f"Put away {sh['sku']} from delivery {d['id']} — the units are in the building "
                                        "but not on a shelf yet.",
                                "cta": {"kind": "go", "label": "Open Receiving", "href": "/receiving"}}
                    return {"text": f"Wait for supplier delivery {d['id']}, then receive and put it away.",
                            "cta": {"kind": "go", "label": "Open Receiving", "href": "/receiving"}}
                return {"text": f"No stock of {sh['sku']} in either warehouse. Backorder or cancel.",
                        "cta": {"kind": "cancel", "label": "Cancel order", "office_only": True}}
        return {"text": "Waiting for stock.", "cta": None}
    if s == READY_TO_PICK:
        return {"text": "Start picking.", "cta": {"kind": "go", "label": "Start picking", "href": f"/picking/{oid}"}}
    if s == PICKING:
        items = items_for(conn, oid)
        done = sum(1 for i in items if i["pick_status"] == "picked")
        return {"text": f"Continue picking ({done} of {len(items)} lines picked).",
                "cta": {"kind": "go", "label": "Continue picking", "href": f"/picking/{oid}"}}
    if s == READY_TO_PACK:
        if order["last_scan_error"]:
            return {"text": "Verify SKU — the last scan did not match this order.",
                    "cta": {"kind": "go", "label": "Open packing", "href": f"/packing/{oid}"}}
        return {"text": "Scan each item at the packing station, then pack and verify the label.",
                "cta": {"kind": "go", "label": "Start packing", "href": f"/packing/{oid}"}}
    c = courier(conn, order["courier_id"]) if order["courier_id"] else None
    if s == PACKED and package:
        from . import dispatch
        sug = dispatch.suggest_location(conn, package)
        return {"text": f"Stage package {package['id']} at {sug['location']}. {sug['reason']}",
                "cta": {"kind": "go", "label": "Stage package", "href": f"/staging?package={package['id']}"}}
    if s == STAGED and package:
        when = clock.fmt_local(clock.parse(package["pickup_at"])) if package["pickup_at"] else "the next"
        return {"text": f"Hand package to {c['name'] if c else 'the courier'} during the {when} pickup.",
                "cta": {"kind": "go", "label": "Open handover", "href": f"/handover?courier={order['courier_id']}"}}
    return {"text": "", "cta": None}


def summarize(order: dict, *, item_count: int, units: int, open_issues: int, blocking: bool, courier_name: str | None,
              pickup_at: str | None = None) -> dict:
    blocked = order["status"] in (ON_HOLD, AWAITING_STOCK) or blocking
    r = risk_of(order, blocked=blocked, pickup_at=pickup_at)
    if order["status"] == ON_HOLD:
        short = "On hold"
    elif order["status"] == AWAITING_STOCK:
        short = "Waiting for stock"
    elif blocking:
        short = "Issue open"
    else:
        short = None
    return {
        "id": order["id"], "channel": order["channel"], "channel_ref": order["channel_ref"],
        "customer_name": order["customer_name"], "city": order["city"], "priority": bool(order["priority"]),
        "status": order["status"], "status_label": STATUS_LABELS[order["status"]],
        "stage": STATUS_TO_STAGE.get(order["status"]), "received_at": order["received_at"],
        "ship_by": order["ship_by"], "after_cutoff": bool(order["after_cutoff"]),
        "courier_id": order["courier_id"], "courier_name": courier_name,
        "items": item_count, "units": units, "open_issues": open_issues,
        "blocked": blocked, "blocked_short": short, "risk": r, "order_value": order["order_value"],
        "shipped_at": order["shipped_at"], "scan_error": bool(order["last_scan_error"]),
    }


def list_orders(conn, *, q=None, stage=None, status=None, priority=None, risk=None, courier_id=None, channel=None,
                has_issue=None, date_from=None, date_to=None, blocked=None, sort="urgency") -> list[dict]:
    orders = all_rows(conn, "SELECT * FROM orders")
    agg = {r["order_id"]: r for r in all_rows(conn, "SELECT order_id, COUNT(*) AS n, SUM(qty) AS units FROM order_items GROUP BY order_id")}
    iss = {r["order_id"]: r for r in all_rows(conn, """SELECT order_id, COUNT(*) AS n,
            SUM(CASE WHEN blocking = 1 OR severity = 'Critical' THEN 1 ELSE 0 END) AS b
            FROM issues WHERE status != 'Resolved' AND order_id IS NOT NULL GROUP BY order_id""")}
    cnames = {c["id"]: c["name"] for c in all_rows(conn, "SELECT id, name FROM couriers")}
    pickups = {r["order_id"]: r["pickup_at"] for r in all_rows(conn, "SELECT order_id, pickup_at FROM packages")}
    out = []
    ql = (q or "").strip().lower()
    for o in orders:
        a = agg.get(o["id"], {"n": 0, "units": 0})
        i = iss.get(o["id"], {"n": 0, "b": 0})
        s = summarize(o, item_count=a["n"], units=a["units"] or 0, open_issues=i["n"], blocking=bool(i["b"]),
                      courier_name=cnames.get(o["courier_id"]), pickup_at=pickups.get(o["id"]))
        if ql and ql not in o["id"].lower() and ql not in o["customer_name"].lower() and ql not in o["channel_ref"].lower() \
                and ql not in (o["city"] or "").lower():
            continue
        if stage == "open" and o["status"] not in OPEN_STATUSES:
            continue
        if stage and stage != "open" and s["stage"] != stage:
            continue
        if status and o["status"] != status:
            continue
        if priority == "priority" and not o["priority"]:
            continue
        if priority == "normal" and o["priority"]:
            continue
        if risk == "attention" and s["risk"]["state"] not in ("at_risk", "delayed"):
            continue
        if risk and risk != "attention" and s["risk"]["state"] != risk:
            continue
        if courier_id and o["courier_id"] != courier_id:
            continue
        if channel and o["channel"] != channel:
            continue
        if has_issue == "yes" and not i["n"]:
            continue
        if blocked == "yes" and not s["blocked"]:
            continue
        if date_from or date_to:
            day = clock.local(clock.parse(o["received_at"])).date().isoformat()
            if date_from and day < date_from:
                continue
            if date_to and day > date_to:
                continue
        out.append(s)
    risk_rank = {"delayed": 0, "at_risk": 1, "on_track": 2, "done": 3}
    if sort == "newest":
        out.sort(key=lambda s: s["received_at"], reverse=True)
    elif sort == "ship_by":
        out.sort(key=lambda s: s["ship_by"])
    else:
        out.sort(key=lambda s: (risk_rank[s["risk"]["state"]], not s["priority"], s["ship_by"]))
        done = [s for s in out if s["risk"]["state"] == "done"]
        done.sort(key=lambda s: s["shipped_at"] or s["received_at"], reverse=True)
        out = [s for s in out if s["risk"]["state"] != "done"] + done
    return out


def order_detail(conn, order_id: str) -> dict:
    o = get_order_row(conn, order_id)
    items = items_for(conn, o["id"])
    pkg = one(conn, "SELECT * FROM packages WHERE order_id = ?", (o["id"],))
    open_iss = issues_svc.open_issues_for_order(conn, o["id"])
    b = blocked_info(conn, o)
    s = summarize(o, item_count=len(items), units=sum(i["qty"] for i in items), open_issues=len(open_iss),
                  blocking=any(i["blocking"] or i["severity"] == "Critical" for i in open_iss),
                  courier_name=None, pickup_at=pkg["pickup_at"] if pkg else None)
    c = courier(conn, o["courier_id"]) if o["courier_id"] else None
    s["risk"] = risk_of(o, blocked=b["blocked"], pickup_at=pkg["pickup_at"] if pkg else None)
    detail = {
        **s,
        "phone": o["phone"], "address": o["address"], "pincode": o["pincode"],
        "courier": ({"id": c["id"], "name": c["name"], "lane": c["staging_lane"], "reason": o["courier_reason"],
                     "cost": c["cost_per_parcel"], "delivery": f"{c['delivery_days_min']}–{c['delivery_days_max']} days"}
                    if c else None),
        "courier_name": c["name"] if c else None,
        "label_code": o["label_code"], "hold_reason": o["hold_reason"], "cancel_reason": o["cancel_reason"],
        "last_scan_error": o["last_scan_error"], "scan_failures": o["scan_failures"],
        "timestamps": {k: o[k] for k in ("received_at", "processed_at", "picking_started_at", "picked_at", "packed_at",
                                         "staged_at", "shipped_at", "cancelled_at")},
        "line_items": [{
            "id": i["id"], "sku": i["sku"], "name": i["name"], "variant": i["variant"], "qty": i["qty"],
            "bin": i["bin"], "reserved_qty": i["reserved_qty"], "picked_qty": i["picked_qty"],
            "verified_qty": i["verified_qty"], "pick_status": i["pick_status"], "price": i["price"],
            "main_available": i["main_available"], "secondary_available": i["secondary_available"],
        } for i in items],
        "package": pkg,
        "blocked_info": b,
        "next_action": next_action(conn, o, b, pkg),
        "issues": [issues_svc.serialize_issue(conn, i) for i in all_rows(
            conn, "SELECT * FROM issues WHERE order_id = ? ORDER BY created_at DESC", (o["id"],))],
        "timeline": all_rows(conn, "SELECT at, actor, role, action, message FROM activity WHERE order_id = ?"
                                   " ORDER BY at, id", (o["id"],)),
        "courier_options": courier_options(conn, o) if o["status"] not in (SHIPPED, CANCELLED) else [],
    }
    return detail
