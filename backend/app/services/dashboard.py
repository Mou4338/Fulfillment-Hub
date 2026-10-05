"""Read models: dashboard, Action Queue, bottlenecks, search, analytics and shift handover.
Everything here is computed from the database with simple, explainable rules."""
from collections import Counter, defaultdict
from datetime import timedelta

from .. import clock, config
from ..db import one, all_rows, scalar
from .common import (
    STAGES, RECEIVED, ON_HOLD, AWAITING_STOCK, READY_TO_PICK, PICKING, READY_TO_PACK, PACKED, STAGED, SHIPPED,
    CANCELLED, OPEN_STATUSES, INVENTORY_ISSUE_TYPES, SEVERITY_RANK, fmt_minutes, dumps, loads, log, Actor,
)
from . import inventory as inv
from . import orders as orders_svc
from . import dispatch
from . import reorders as reorders_svc


def _urgency(minutes_left) -> int:
    if minutes_left is None:
        return 0
    if minutes_left < 0:
        return 40
    if minutes_left < 60:
        return 30
    if minutes_left < 180:
        return 15
    if minutes_left < 360:
        return 5
    return 0


def action_queue(conn, orders: list[dict], staging: dict, shortages: list[dict], replenish: dict | None = None) -> list[dict]:
    """Turns the state of the warehouse into a ranked to-do list.
    score = base for the kind of problem + 30 if priority + urgency (time left) + severity."""
    acts: list[dict] = []

    def add(kind, title, reason, link, cta, score, severity="normal", order_id=None):
        acts.append({"id": f"{kind}:{order_id or title}", "kind": kind, "title": title, "reason": reason, "link": link,
                     "cta": cta, "score": score, "severity": severity, "order_id": order_id})

    for o in orders:
        if o["status"] in (SHIPPED, CANCELLED):
            continue
        r = o["risk"]
        u = _urgency(r["minutes_left"])
        pr = 30 if o["priority"] else 0
        time_txt = (f"ship-by passed {fmt_minutes(r['minutes_left'])} ago" if (r["minutes_left"] or 0) < 0
                    else f"{fmt_minutes(r['minutes_left'])} left") if r["minutes_left"] is not None else ""
        sev = "critical" if r["state"] == "delayed" else ("warning" if r["state"] == "at_risk" else "normal")
        if o["status"] == RECEIVED and r["state"] != "on_track":
            add("process", f"{'Priority order' if o['priority'] else 'Order'} {o['id']} waiting to be processed",
                f"{o['customer_name']} · {time_txt}", f"/orders/{o['id']}", "Process", 40 + pr + u, sev, o["id"])
        elif o["status"] == ON_HOLD:
            add("hold", f"{o['id']} is on hold", f"Needs an office decision · {time_txt}", f"/orders/{o['id']}",
                "Review", 35 + pr + u, "warning", o["id"])
        elif o["status"] == READY_TO_PICK and (o["priority"] or r["state"] != "on_track"):
            add("pick", f"{'Priority order' if o['priority'] else 'Order'} {o['id']} needs picking",
                f"{o['items']} line{'s' if o['items'] != 1 else ''} · {time_txt}", f"/picking/{o['id']}", "Pick now",
                45 + pr + u, sev, o["id"])
        elif o["status"] == READY_TO_PACK and o["scan_error"]:
            add("verify", f"Packing verification failed on {o['id']}", "Last scan didn't match the order — re-check the item",
                f"/packing/{o['id']}", "Verify SKU", 55 + pr + u, "warning", o["id"])
        elif o["status"] in (PICKING, READY_TO_PACK) and r["state"] != "on_track" and not o["blocked"]:
            add("at_risk", f"{o['id']} {'is delayed' if r['state'] == 'delayed' else 'at risk of missing ship-by'}",
                f"{o['status_label']} · {time_txt}",
                f"/{'picking' if o['status'] == PICKING else 'packing'}/{o['id']}", "Open", 35 + pr + u, sev, o["id"])

    waiting_pri = [o for o in orders if o["status"] == RECEIVED and o["priority"] and o["risk"]["state"] == "on_track"]
    if waiting_pri:
        n = len(waiting_pri)
        soonest = min(o["risk"]["minutes_left"] for o in waiting_pri)
        add("process_batch", f"{n} priority order{'s' if n != 1 else ''} waiting to be processed",
            f"Earliest ship-by in {fmt_minutes(soonest)} · process these before normal orders",
            "/orders?stage=received&priority=priority", "Open list", 48 + _urgency(soonest))

    for s in shortages:
        n = len(s["orders"])
        npri = sum(1 for o in s["orders"] if o["priority"])
        who = f"Blocks {n} order{'s' if n != 1 else ''}" + (f" ({npri} priority)" if npri else "")
        if s["open_transfer"]:
            t = s["open_transfer"]
            add("receive_transfer", f"Receive transfer {t['id']} ({t['qty']} × {s['sku']})",
                f"{who} · {'on its way' if t['status'] == 'in_transit' else 'requested, not yet sent'}",
                f"/inventory?view=blocking&sku={s['sku']}", "Receive", 30 + npri * 15, "normal")
        elif s["suggested_transfer_qty"]:
            add("transfer", f"Transfer {s['suggested_transfer_qty']} × {s['sku']} from Secondary",
                f"{who} · Main has {s['main_available']}, Secondary has {s['secondary_available']}",
                f"/inventory?view=blocking&sku={s['sku']}", "Create transfer", 60 + npri * 20, "warning")
        elif s["incoming_delivery"] and s["incoming_delivery"]["status"] == "received":
            d = s["incoming_delivery"]
            add("putaway_unblock", f"Put away {s['sku']} from delivery {d['id']}",
                f"{who} · {d['awaiting_putaway']} units are in the building but not on a shelf yet", "/receiving",
                "Put away", 58 + npri * 20, "warning")
        elif s["incoming_delivery"]:
            add("receiving", f"{s['sku']} arriving on delivery {s['incoming_delivery']['id']}",
                f"{who} · receive and put it away as soon as it lands", "/receiving", "Open receiving", 25 + npri * 10)
        else:
            add("no_stock", f"No stock of {s['sku']} anywhere", f"{who} · backorder or cancel",
                f"/inventory?view=blocking&sku={s['sku']}", "Review", 30 + npri * 15, "warning")

    missed: list[dict] = []
    for i in all_rows(conn, "SELECT * FROM issues WHERE status != 'Resolved' ORDER BY created_at"):
        sev = SEVERITY_RANK[i["severity"]] * 8
        if i["type"] in ("Stock Not Found", "Damaged Item"):
            add("stock_issue", f"{'Stock not found' if i['type'] == 'Stock Not Found' else 'Damaged item'} — recount needed",
                i["title"], f"/issues?id={i['id']}", "Resolve", 62 + sev, "critical", i["order_id"])
        elif i["type"] == "Missed Pickup":
            missed.append(i)
        elif i["type"] == "Return to Shelf":
            add("return", f"Return items to shelf ({i['order_id']})", "Cancelled after picking", f"/issues?id={i['id']}",
                "Open task", 20 + sev, "normal", i["order_id"])
        elif i["type"] == "Receiving Shortage":
            add("recv_issue", "Delivery didn't match the paperwork", i["title"], f"/issues?id={i['id']}", "Review",
                18 + sev, "normal")

    if missed:
        worst = max(SEVERITY_RANK[i["severity"]] for i in missed) * 8
        n = len(missed)
        add("missed_pickup", f"{n} parcel{'s' if n != 1 else ''} missed a courier pickup",
            "Still in the building after the pickup window — confirm with the courier and hand over at the next pickup",
            "/handover", "Open handover", 55 + worst + min(n, 5), "critical")

    for c in staging["couriers"]:
        if c["alert"]:
            add("pickup_soon", f"{c['courier']['name']} pickup in {fmt_minutes(c['minutes_to_pickup'])}",
                f"{c['unstaged']} packed parcel{'s' if c['unstaged'] != 1 else ''} not staged yet",
                "/staging", "Stage now", 60, "warning")

    if replenish:
        prev = [i for i in replenish["items"] if i["status"] == "transfer_required" and not i["blocking_orders"]]
        if prev:
            n, units = len(prev), sum(i["suggested_qty"] for i in prev)
            crit = sum(1 for i in prev if i["level"] == "critical")
            add("replenish", f"{n} SKU{'s' if n != 1 else ''} below half in Main — transfer required",
                f"Preventive: move {units} units from Secondary before orders get stuck"
                + (f" · {crit} critical" if crit else ""),
                "/inventory?view=replenish", "Review transfers", 32 + crit * 6, "warning" if crit else "normal")

    ro = reorders_svc.suggestions(conn)
    if ro["count"]:
        add("reorder", f"{ro['count']} SKU{'s' if ro['count'] != 1 else ''} need reordering from suppliers",
            f"Stock is low in both warehouses — {ro['units']} units suggested"
            + (f" · {ro['critical']} blocking orders or out of stock" if ro["critical"] else ""),
            "/reorders", "Review reorders", 30 + min(ro["critical"], 5) * 4, "warning" if ro["critical"] else "normal")
    for ib in all_rows(conn, "SELECT * FROM inbound WHERE status = 'expected' AND expected_at < ?", (clock.now_iso(),)):
        add("late_delivery", f"Delivery {ib['id']} from {ib['supplier']} is late",
            f"Expected {clock.fmt_local(clock.parse(ib['expected_at']))} — count it if it has arrived, or chase the supplier",
            f"/receiving?delivery={ib['id']}", "Open", 26, "normal")
    for ib in all_rows(conn, "SELECT * FROM inbound WHERE status = 'received'"):
        add("putaway", f"Delivery {ib['id']} waiting to be shelved", f"From {ib['supplier']} · stock isn't sellable until put away",
            f"/receiving?delivery={ib['id']}", "Put away", 28, "normal")

    acts.sort(key=lambda a: -a["score"])
    seen, out = set(), []
    for a in acts:
        key = a["order_id"] or a["id"]
        if key in seen:
            continue
        seen.add(key)
        out.append(a)
    return out


def bottleneck(orders: list[dict]) -> dict | None:
    """Largest queue among the working stages, stated plainly. No predictions."""
    stage_names = {"received": "Processing (received, not processed)", "processed": "Waiting to be picked",
                   "picking": "Picking", "packing": "Packing", "staging": "Waiting for courier pickup"}
    counts, pri = Counter(), Counter()
    for o in orders:
        if o["stage"] in stage_names and o["status"] not in (SHIPPED, CANCELLED):
            counts[o["stage"]] += 1
            if o["priority"]:
                pri[o["stage"]] += 1
    if not counts:
        return None
    stage, n = counts.most_common(1)[0]
    if n < config.BOTTLENECK_MIN_QUEUE:
        return {"stage": None, "message": "No bottleneck — work is spread evenly across stages.", "counts": dict(counts)}
    total = sum(counts.values())
    msg = f"{stage_names[stage]} is currently the largest queue: {n} orders"
    if pri[stage]:
        msg += f", {pri[stage]} of them priority"
    msg += f" ({round(n / total * 100)}% of open work)."
    return {"stage": stage, "count": n, "priority": pri[stage], "message": msg, "counts": dict(counts)}


def dashboard(conn) -> dict:
    dispatch.sweep(conn)
    now = clock.now()
    orders = orders_svc.list_orders(conn)
    staging = dispatch.staging_overview(conn)
    shortages = inv.shortages(conn)
    replenish = inv.replenishment(conn)
    since = clock.iso(now - timedelta(hours=24))
    open_orders = [o for o in orders if o["status"] in OPEN_STATUSES]
    open_issues = all_rows(conn, "SELECT type, severity FROM issues WHERE status != 'Resolved'")
    inv_issue_count = sum(1 for i in open_issues if i["type"] in INVENTORY_ISSUE_TYPES) + len(shortages)
    kpis = {
        "orders_24h": sum(1 for o in orders if o["received_at"] >= since),
        "priority_open": sum(1 for o in open_orders if o["priority"]),
        "at_risk": sum(1 for o in open_orders if o["risk"]["state"] == "at_risk"),
        "delayed": sum(1 for o in open_orders if o["risk"]["state"] == "delayed"),
        "ready_to_pick": sum(1 for o in orders if o["status"] == READY_TO_PICK),
        "ready_to_ship": sum(1 for o in orders if o["status"] == STAGED),
        "inventory_issues": inv_issue_count,
        "open_issues": len(open_issues),
        "shipped_24h": sum(1 for o in orders if o["status"] == SHIPPED and (o["shipped_at"] or "") >= since),
        "to_process": sum(1 for o in orders if o["status"] == RECEIVED),
        "transfer_required": replenish["transfer_required"],
        "below_half": replenish["count"],
        "reorder_needed": reorders_svc.suggestions(conn)["count"],
        "deliveries_to_receive": scalar(conn, "SELECT COUNT(*) FROM inbound WHERE status IN ('expected','received')") or 0,
        "deliveries_late": scalar(conn, "SELECT COUNT(*) FROM inbound WHERE status = 'expected' AND expected_at < ?",
                                  (clock.now_iso(),)) or 0,
    }
    pipeline = []
    for key, label, sts in STAGES:
        group = [o for o in orders if o["status"] in sts]
        if key == "shipped":
            group = [o for o in group if (o["shipped_at"] or "") >= since]
        pipeline.append({"key": key, "label": label, "count": len(group),
                         "priority": sum(1 for o in group if o["priority"]),
                         "attention": sum(1 for o in group if o["risk"]["state"] in ("at_risk", "delayed") or o["blocked"])})
    priority_orders = sorted([o for o in open_orders if o["priority"]], key=lambda o: o["ship_by"])[:8]
    attention = [o for o in open_orders if o["risk"]["state"] in ("at_risk", "delayed")]
    attention.sort(key=lambda o: (o["risk"]["state"] != "delayed", not o["priority"], o["ship_by"]))
    low_stock = [i for i in inv.list_inventory(conn, view="low") if not i["blocking"]][:5]
    activity = all_rows(conn, "SELECT * FROM activity ORDER BY at DESC, id DESC LIMIT 14")
    return {
        "now": clock.iso(now),
        "kpis": kpis,
        "pipeline": pipeline,
        "action_queue": action_queue(conn, orders, staging, shortages, replenish)[:config.ACTION_QUEUE_LIMIT],
        "priority_orders": priority_orders,
        "attention_orders": attention[:8],
        "attention_total": len(attention),
        "shortages": shortages[:6],
        "low_stock": [{"sku": i["sku"], "name": i["name"], "variant": i["variant"], "available": i["main"]["available"],
                       "threshold": i["low_stock_threshold"]} for i in low_stock],
        "replenishment": {k: replenish[k] for k in ("rule", "count", "transfer_required", "units_to_move")}
                         | {"items": [i for i in replenish["items"] if not i["blocking_orders"]][:6]},
        "couriers": [{k: v for k, v in c.items() if k != "packages"} for c in staging["couriers"]],
        "bottleneck": bottleneck(orders),
        "activity": activity,
    }


def notifications(conn) -> dict:
    dispatch.sweep(conn)
    rows = all_rows(conn, """SELECT * FROM issues WHERE status != 'Resolved' AND severity IN ('High','Critical')
                             ORDER BY CASE severity WHEN 'Critical' THEN 0 ELSE 1 END, created_at DESC LIMIT 10""")
    delayed_pri = [o for o in orders_svc.list_orders(conn, priority="priority", risk="delayed")
                   if o["status"] in OPEN_STATUSES]
    items = [{"kind": "issue", "title": r["title"], "severity": r["severity"], "at": r["created_at"],
              "link": f"/issues?id={r['id']}"} for r in rows]
    items = [{"kind": "delayed", "title": f"Priority order {o['id']} is delayed", "severity": "Critical",
              "at": o["ship_by"], "link": f"/orders/{o['id']}"} for o in delayed_pri[:5]] + items
    return {"count": len(items), "items": items[:12]}


def search(conn, q: str) -> list[dict]:
    q = (q or "").strip()
    if len(q) < 2:
        return []
    like = f"%{q}%"
    res = []
    for o in all_rows(conn, """SELECT id, customer_name, status, priority, channel_ref FROM orders
                               WHERE id LIKE ? OR customer_name LIKE ? OR channel_ref LIKE ? ORDER BY received_at DESC LIMIT 6""",
                      (like, like, like)):
        res.append({"type": "Order", "id": o["id"], "title": f"{o['id']} · {o['customer_name']}",
                    "subtitle": orders_svc.STATUS_LABELS[o["status"]] + (" · Priority" if o["priority"] else ""),
                    "link": f"/orders/{o['id']}"})
    for p in all_rows(conn, "SELECT sku, name, variant FROM products WHERE sku LIKE ? OR name LIKE ? ORDER BY sku LIMIT 6",
                      (like, like)):
        res.append({"type": "Product", "id": p["sku"], "title": f"{p['sku']} · {p['name']}", "subtitle": p["variant"],
                    "link": f"/inventory?q={p['sku']}"})
    for p in all_rows(conn, "SELECT id, order_id, status, staging_location FROM packages WHERE id LIKE ? LIMIT 5", (like,)):
        res.append({"type": "Package", "id": p["id"], "title": f"{p['id']} · {p['order_id']}",
                    "subtitle": f"{p['status'].replace('_', ' ')}" + (f" · {p['staging_location']}" if p["staging_location"] else ""),
                    "link": {"packed": f"/staging?package={p['id']}", "staged": f"/handover?package={p['id']}",
                             "handed_over": f"/shipped?range=all&q={p['id']}"}.get(p["status"], f"/orders/{p['order_id']}")})
    for r in all_rows(conn, "SELECT id, supplier, status FROM reorders WHERE id LIKE ? OR supplier LIKE ? ORDER BY created_at DESC LIMIT 4",
                      (like, like)):
        res.append({"type": "Reorder", "id": r["id"], "title": f"{r['id']} · {r['supplier']}",
                    "subtitle": reorders_svc.STATUS_LABELS.get(r["status"], r["status"]), "link": f"/reorders?id={r['id']}"})
    for d in all_rows(conn, "SELECT id, supplier, status FROM inbound WHERE id LIKE ? LIMIT 4", (like,)):
        res.append({"type": "Delivery", "id": d["id"], "title": f"{d['id']} · {d['supplier']}",
                    "subtitle": d["status"].replace("_", " "), "link": f"/receiving?delivery={d['id']}"})
    for i in all_rows(conn, "SELECT id, title, status FROM issues WHERE id LIKE ? OR title LIKE ? ORDER BY created_at DESC LIMIT 5",
                      (like, like)):
        res.append({"type": "Issue", "id": i["id"], "title": f"{i['id']} · {i['title']}", "subtitle": i["status"],
                    "link": f"/issues?id={i['id']}"})
    return res


def analytics(conn) -> dict:
    now = clock.now()
    orders = orders_svc.list_orders(conn)
    raw = {o["id"]: o for o in all_rows(conn, "SELECT * FROM orders")}
    by_status = Counter(o["status_label"] for o in orders)

    def avg_hours(a, b):
        vals = []
        for o in raw.values():
            if o[a] and o[b]:
                vals.append((clock.parse(o[b]) - clock.parse(o[a])).total_seconds() / 3600)
        return round(sum(vals) / len(vals), 1) if vals else None

    shipped_pri = [o for o in raw.values() if o["status"] == SHIPPED and o["priority"]]
    on_time_pri = [o for o in shipped_pri if o["shipped_at"] <= o["ship_by"]]
    shipped_all = [o for o in raw.values() if o["status"] == SHIPPED]
    on_time_all = [o for o in shipped_all if o["shipped_at"] <= o["ship_by"]]
    delayed_by_stage = Counter(o["stage"] for o in orders if o["risk"]["state"] == "delayed")
    week_ago = clock.iso(now - timedelta(days=7))
    issue_types = Counter(r["type"] for r in all_rows(conn, "SELECT type FROM issues WHERE created_at >= ?", (week_ago,)))
    scan_fail = scalar(conn, "SELECT COUNT(*) FROM activity WHERE action IN ('scan_failed','label_failed')") or 0
    scans = scalar(conn, "SELECT COUNT(*) FROM activity WHERE action = 'item_verified'") or 0
    courier_perf = []
    for c in orders_svc.couriers(conn):
        handed = scalar(conn, "SELECT COUNT(*) FROM packages WHERE courier_id=? AND status='handed_over'", (c["id"],)) or 0
        missed = scalar(conn, "SELECT COUNT(*) FROM issues i JOIN packages p ON p.id = i.package_id"
                              " WHERE i.type='Missed Pickup' AND p.courier_id=?", (c["id"],)) or 0
        courier_perf.append({"courier": c["name"], "handed_over": handed, "missed": missed,
                             "on_time_rate": round(handed / (handed + missed) * 100) if handed + missed else None})
    per_day = defaultdict(lambda: {"received": 0, "shipped": 0})
    for o in raw.values():
        d = clock.local(clock.parse(o["received_at"])).strftime("%a %d")
        per_day[d]["received"] += 1
        if o["shipped_at"]:
            per_day[clock.local(clock.parse(o["shipped_at"])).strftime("%a %d")]["shipped"] += 1
    days = []
    for k in range(4, -1, -1):
        d = clock.local(now - timedelta(days=k)).strftime("%a %d")
        days.append({"day": d, **per_day.get(d, {"received": 0, "shipped": 0})})
    stage_order = [s[1] for s in STAGES] + ["Cancelled"]
    stage_counts = Counter()
    for o in orders:
        label = next((lbl for key, lbl, sts in STAGES if o["status"] in sts), "Cancelled")
        stage_counts[label] += 1
    return {
        "orders_by_stage": [{"label": s, "count": stage_counts.get(s, 0)} for s in stage_order],
        "orders_by_status": [{"label": k, "count": v} for k, v in by_status.most_common()],
        "avg_hours_received_to_packed": avg_hours("received_at", "packed_at"),
        "avg_hours_received_to_shipped": avg_hours("received_at", "shipped_at"),
        "avg_hours_picked_to_packed": avg_hours("picked_at", "packed_at"),
        "priority_on_time_rate": round(len(on_time_pri) / len(shipped_pri) * 100) if shipped_pri else None,
        "priority_shipped": len(shipped_pri),
        "overall_on_time_rate": round(len(on_time_all) / len(shipped_all) * 100) if shipped_all else None,
        "delayed_by_stage": [{"label": lbl, "count": delayed_by_stage.get(key, 0)} for key, lbl, _ in STAGES if key != "shipped"],
        "issues_by_type_7d": [{"label": k, "count": v} for k, v in issue_types.most_common()],
        "verification": {"failures": scan_fail, "verified_units": scans,
                         "caught_rate_note": "Every failure here is a wrong item or label stopped before it shipped."},
        "courier_performance": courier_perf,
        "per_day": days,
        "bottleneck": bottleneck(orders),
    }


def shift_summary(conn, hours: int = 8) -> dict:
    now = clock.now()
    since = clock.iso(now - timedelta(hours=hours))
    orders = orders_svc.list_orders(conn)
    in_progress = Counter(o["stage"] for o in orders if o["status"] in OPEN_STATUSES)
    stage_labels = {k: l for k, l, _ in STAGES}
    open_issues = all_rows(conn, "SELECT id, title, severity, type, assignee FROM issues WHERE status != 'Resolved'"
                                 " ORDER BY created_at DESC")
    open_issues.sort(key=lambda i: -SEVERITY_RANK[i["severity"]])
    transfers = [t for t in inv.list_transfers(conn) if t["status"] in ("requested", "in_transit")]
    staged = all_rows(conn, """SELECT p.id, p.order_id, p.staging_location, p.pickup_at, c.name AS courier_name FROM packages p
                               JOIN couriers c ON c.id = p.courier_id WHERE p.status = 'staged' ORDER BY p.pickup_at""")
    notes = all_rows(conn, "SELECT * FROM shift_notes ORDER BY created_at DESC LIMIT 5")
    for n in notes:
        n["snapshot"] = loads(n["snapshot"])
    return {
        "since": since, "hours": hours,
        "shipped": sum(1 for o in orders if o["status"] == SHIPPED and (o["shipped_at"] or "") >= since),
        "received": sum(1 for o in orders if o["received_at"] >= since),
        "in_progress": [{"stage": k, "label": stage_labels[k], "count": in_progress.get(k, 0)}
                        for k, _, _ in STAGES if k != "shipped"],
        "delayed": [o for o in orders if o["risk"]["state"] == "delayed" and o["status"] in OPEN_STATUSES][:10],
        "open_issues": open_issues[:15], "open_issue_count": len(open_issues),
        "pending_transfers": transfers, "staged_parcels": staged, "notes": notes,
    }


def save_shift_note(conn, actor: Actor, note: str) -> dict:
    if not note or not note.strip():
        from .common import DomainError
        raise DomainError("Write a short note for the next shift", code="validation", status=422)
    s = shift_summary(conn)
    snap = {"shipped": s["shipped"], "open_issues": s["open_issue_count"], "delayed": len(s["delayed"]),
            "in_progress": {x["label"]: x["count"] for x in s["in_progress"]}}
    at = clock.now_iso()
    conn.execute("INSERT INTO shift_notes(created_at, author, role, note, snapshot) VALUES (?,?,?,?,?)",
                 (at, actor.name, actor.role, note.strip(), dumps(snap)))
    log(conn, actor, "shift_note", f"Shift handover note: {note.strip()[:120]}", at=at)
    return shift_summary(conn)
