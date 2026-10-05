"""Processing desk: new orders are handled strictly in queue order.

Queue order (the same rule everywhere): priority orders first, then the earliest ship-by,
then first received (first in, first out). Processing in this order matters because stock is
reserved as each order is processed — the order at the top of the queue gets stock first.

The board also shows, before anyone clicks, what processing each order will do:
  ready      -> stock is available (after the orders above it take theirs) — it will go to picking
  needs_stock-> it will wait for stock; says which SKU and whether a transfer can fix it
  hold       -> a check will stop it (duplicate import, incomplete address, unusual value/quantity)
"""
from collections import defaultdict
from datetime import timedelta

from .. import clock, config
from ..db import all_rows, one
from .common import (
    Actor, DomainError, RECEIVED, ON_HOLD, AWAITING_STOCK, READY_TO_PICK, STATUS_LABELS, HOLD_ISSUE_TYPES,
    require_office, fmt_minutes,
)
from . import inventory as inv
from . import issues as issues_svc
from . import orders as orders_svc


def queue_key(o: dict):
    """Priority first, then earliest ship-by, then first received, then order number."""
    return (not o["priority"], o["ship_by"], o["received_at"], o["id"])


def _received_in_order(conn) -> list[dict]:
    rows = [o for o in orders_svc.list_orders(conn, status=RECEIVED)]
    rows.sort(key=queue_key)
    return rows


def board(conn) -> dict:
    now = clock.now()
    queue = _received_in_order(conn)
    raw = {o["id"]: o for o in all_rows(conn, "SELECT * FROM orders WHERE status = ?", (RECEIVED,))}
    lines = defaultdict(list)
    for it in all_rows(conn, """SELECT oi.order_id, oi.product_id, oi.qty, p.sku, p.variant, p.name FROM order_items oi
                                JOIN products p ON p.id = oi.product_id
                                JOIN orders o ON o.id = oi.order_id WHERE o.status = ?""", (RECEIVED,)):
        lines[it["order_id"]].append(it)
    stock = {r["product_id"]: r for r in all_rows(conn, """
        SELECT m.product_id, m.on_hand - m.reserved AS main_av, COALESCE(s.on_hand - s.reserved, 0) AS sec_av
        FROM inventory m LEFT JOIN inventory s ON s.product_id = m.product_id AND s.warehouse_id = 'SEC'
        WHERE m.warehouse_id = 'MAIN'""")}
    left = {pid: r["main_av"] for pid, r in stock.items()}
    ready_n = stock_n = hold_n = 0
    for pos, o in enumerate(queue, start=1):
        o["position"] = pos
        o["lines"] = [{"sku": l["sku"], "variant": l["variant"], "qty": l["qty"]} for l in lines[o["id"]]]
        holds = orders_svc._hold_checks(conn, raw[o["id"]])
        need = defaultdict(int)
        for l in lines[o["id"]]:
            need[l["product_id"]] += l["qty"]
        short = []
        for pid, q in need.items():
            have = left.get(pid, 0)
            if have < q:
                l = next(x for x in lines[o["id"]] if x["product_id"] == pid)
                sec = stock.get(pid, {}).get("sec_av", 0)
                short.append({"sku": l["sku"], "variant": l["variant"], "need": q, "main_left": max(have, 0),
                              "secondary": sec, "fix": "transfer" if sec >= q - max(have, 0) else "no_stock"})
        if holds:
            o["preview"] = {"kind": "hold", "label": "Will be held",
                            "text": "; ".join(h[1] for h in holds) + " — an office check is needed."}
            hold_n += 1
        elif short:
            parts = [f"{s['sku']}: needs {s['need']}, Main has {s['main_left']} left"
                     + (f" (Secondary has {s['secondary']} — transfer)" if s["fix"] == "transfer" else " (none in Secondary)")
                     for s in short]
            o["preview"] = {"kind": "needs_stock", "label": "Will wait for stock", "text": "; ".join(parts) + ".",
                            "short": short}
            stock_n += 1
        else:
            for pid, q in need.items():
                left[pid] = left.get(pid, 0) - q
            o["preview"] = {"kind": "ready", "label": "Stock ready", "text": "All items available in Main — goes straight to picking."}
            ready_n += 1
        try:
            cid, why = orders_svc.recommend_courier(conn, raw[o["id"]])
            o["courier_preview"] = {"id": cid, "name": orders_svc.courier(conn, cid)["name"], "reason": why}
        except Exception:  # pragma: no cover - couriers always exist in practice
            o["courier_preview"] = None
        o["waiting_minutes"] = round((now - clock.parse(o["received_at"])).total_seconds() / 60)

    on_hold = orders_svc.list_orders(conn, status=ON_HOLD)
    on_hold.sort(key=queue_key)
    for o in on_hold:
        o["hold_reasons"] = [i["title"].split(": ", 1)[-1] for i in issues_svc.open_issues_for_order(conn, o["id"])
                             if i["type"] in HOLD_ISSUE_TYPES] or [
            (one(conn, "SELECT hold_reason FROM orders WHERE id = ?", (o["id"],)) or {}).get("hold_reason") or "Needs review"]

    waiting = orders_svc.list_orders(conn, status=AWAITING_STOCK)
    waiting.sort(key=queue_key)
    by_order = defaultdict(list)
    for s in inv.shortages(conn):
        for w in s["orders"]:
            fix = ("transfer_open" if s["open_transfer"] else "transfer" if s["suggested_transfer_qty"]
                   else ("putaway" if s["incoming_delivery"]["status"] == "received" else "delivery")
                   if s["incoming_delivery"] else "no_stock")
            by_order[w["order_id"]].append({"sku": s["sku"], "qty": w["qty"], "fix": fix,
                                            "transfer_id": (s["open_transfer"] or {}).get("id")})
    for o in waiting:
        o["short"] = by_order.get(o["id"], [])

    since = clock.iso(now - timedelta(hours=24))
    today_start = clock.iso(clock.at_local_time(clock.local(now), clock.hhmm("00:00")))
    recent = all_rows(conn, """SELECT id, customer_name, priority, status, processed_at, courier_id FROM orders
                               WHERE processed_at IS NOT NULL ORDER BY processed_at DESC, id DESC LIMIT 12""")
    cnames = {c["id"]: c["name"] for c in orders_svc.couriers(conn)}
    for r in recent:
        r["priority"] = bool(r["priority"])
        r["status_label"] = STATUS_LABELS[r["status"]]
        r["courier_name"] = cnames.get(r["courier_id"])
    oldest = max((o["waiting_minutes"] for o in queue), default=0)
    return {
        "now": clock.iso(now),
        "rule": "Priority first → earliest ship-by → first received",
        "queue": queue,
        "on_hold": on_hold,
        "waiting_stock": waiting,
        "recent": recent,
        "stats": {
            "to_process": len(queue),
            "priority": sum(1 for o in queue if o["priority"]),
            "will_be_ready": ready_n, "will_wait": stock_n, "will_hold": hold_n,
            "on_hold": len(on_hold), "waiting_stock": len(waiting),
            "oldest_wait_minutes": oldest, "oldest_wait_label": fmt_minutes(oldest) if queue else None,
            "processed_24h": all_rows(conn, "SELECT COUNT(*) AS n FROM orders WHERE processed_at >= ?", (since,))[0]["n"],
            "processed_today": all_rows(conn, "SELECT COUNT(*) AS n FROM orders WHERE processed_at >= ?",
                                        (today_start,))[0]["n"],
        },
        "batch_max": config.PROCESS_BATCH_MAX,
    }


def process_batch(conn, actor: Actor, order_ids: list[str] | None = None, count: int | None = None) -> dict:
    """Process several orders strictly in queue order. Each order is processed on its own savepoint,
    so one problem never stops (or half-applies) the rest of the batch."""
    require_office(actor, "process orders")
    queue = [o["id"] for o in _received_in_order(conn)]
    if order_ids:
        wanted = {(i or "").strip().upper() for i in order_ids}
        todo = [i for i in queue if i in wanted]
        missing = sorted(wanted - set(todo))
    else:
        todo = queue[: (count or 1)]
        missing = []
    if len(todo) > config.PROCESS_BATCH_MAX:
        todo = todo[: config.PROCESS_BATCH_MAX]
    if not todo and not missing:
        raise DomainError("There are no received orders waiting to be processed", code="nothing_to_do")
    results = []
    for oid in todo:
        conn.execute("SAVEPOINT batch_order")
        try:
            o = orders_svc.process_order(conn, actor, oid)
            conn.execute("RELEASE SAVEPOINT batch_order")
            outcome = {READY_TO_PICK: "ready", AWAITING_STOCK: "waiting", ON_HOLD: "hold"}.get(o["status"], "other")
            msg = {"ready": "Stock reserved — ready to pick",
                   "waiting": "Processed — waiting for stock",
                   "hold": f"On hold: {o['hold_reason']}"}.get(outcome, STATUS_LABELS[o["status"]])
            results.append({"id": oid, "outcome": outcome, "status": o["status"], "message": msg})
        except DomainError as e:
            conn.execute("ROLLBACK TO SAVEPOINT batch_order")
            conn.execute("RELEASE SAVEPOINT batch_order")
            results.append({"id": oid, "outcome": "error", "status": None, "message": e.message})
    for oid in missing:
        row = one(conn, "SELECT status FROM orders WHERE id = ?", (oid,))
        why = f"already {STATUS_LABELS[row['status']].lower()}" if row else "not found"
        results.append({"id": oid, "outcome": "skipped", "status": row["status"] if row else None,
                        "message": f"Skipped — {why}"})
    summary = defaultdict(int)
    for r in results:
        summary[r["outcome"]] += 1
    return {"results": results, "summary": dict(summary), "processed": sum(1 for r in results if r["outcome"] in ("ready", "waiting", "hold"))}
