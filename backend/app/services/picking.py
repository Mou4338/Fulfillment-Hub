"""Picking: one order at a time, walking order by bin, with explicit exceptions."""
from .. import clock
from ..db import one, all_rows
from .common import (
    Actor, DomainError, NotFound, READY_TO_PICK, PICKING, READY_TO_PACK, AWAITING_STOCK, MAIN, CANCELLED,
    log, require_office, STATUS_LABELS,
)
from . import inventory as inv
from . import issues as issues_svc
from . import orders as orders_svc


def pick_queue(conn) -> list[dict]:
    """Orders a picker can work on: priority first, then earliest ship-by."""
    rows = orders_svc.list_orders(conn, sort="urgency")
    q = [r for r in rows if r["status"] in (READY_TO_PICK, PICKING)]
    q.sort(key=lambda r: (not r["priority"], r["ship_by"]))
    for r in q:
        items = all_rows(conn, "SELECT pick_status FROM order_items WHERE order_id = ?", (r["id"],))
        r["picked_lines"] = sum(1 for i in items if i["pick_status"] == "picked")
        r["total_lines"] = len(items)
        first_bin = one(conn, """SELECT MIN(m.bin) AS b FROM order_items oi JOIN inventory m ON m.product_id = oi.product_id
                                 AND m.warehouse_id='MAIN' WHERE oi.order_id = ? AND oi.pick_status='pending'""", (r["id"],))
        r["first_bin"] = first_bin["b"] if first_bin else None
    return q


def start_picking(conn, actor: Actor, order_id: str, at=None) -> dict:
    o = orders_svc.get_order_row(conn, order_id)
    if o["status"] == PICKING:
        return o
    if o["status"] != READY_TO_PICK:
        raise DomainError(f"Order {o['id']} is {STATUS_LABELS[o['status']].lower()} — only orders that are ready to pick "
                          "can be picked", code="invalid_transition")
    at = at or clock.now_iso()
    conn.execute("UPDATE orders SET status=?, picking_started_at=COALESCE(picking_started_at, ?) WHERE id=?",
                 (PICKING, at, o["id"]))
    log(conn, actor, "picking_started", "Picking started", order_id=o["id"], at=at)
    return orders_svc.get_order_row(conn, o["id"])


def _item(conn, item_id: int) -> dict:
    it = one(conn, """SELECT oi.*, p.sku, p.name, p.variant FROM order_items oi JOIN products p ON p.id = oi.product_id
                      WHERE oi.id = ?""", (item_id,))
    if not it:
        raise NotFound(f"Order line {item_id}")
    return it


def pick_item(conn, actor: Actor, item_id: int, at=None) -> dict:
    it = _item(conn, item_id)
    o = orders_svc.get_order_row(conn, it["order_id"])
    if it["pick_status"] == "picked":
        return {"order": o, "already": True}
    if o["status"] == READY_TO_PICK:
        o = start_picking(conn, actor, o["id"], at=at)
    if o["status"] != PICKING:
        raise DomainError(f"Order {o['id']} is {STATUS_LABELS[o['status']].lower()} — it can't be picked right now",
                          code="invalid_transition")
    if it["pick_status"] in ("not_found", "damaged"):
        raise DomainError("This line has an open problem report. Resolve the issue first (e.g. 'Found it on recount').",
                          code="line_has_issue")
    if it["reserved_qty"] < it["qty"] - it["picked_qty"]:
        raise DomainError("Stock for this line isn't reserved yet", code="not_reserved")
    at = at or clock.now_iso()
    qty = it["qty"] - it["picked_qty"]
    inv._bump(conn, it["product_id"], MAIN, on_hand=-qty, reserved=-qty)
    conn.execute("UPDATE order_items SET picked_qty=qty, reserved_qty=0, pick_status='picked' WHERE id=?", (it["id"],))
    log(conn, actor, "item_picked", f"Picked {qty} × {it['sku']} ({it['variant']})", order_id=o["id"],
        product_id=it["product_id"], at=at)
    remaining = one(conn, "SELECT COUNT(*) AS n FROM order_items WHERE order_id=? AND pick_status != 'picked'", (o["id"],))
    if remaining["n"] == 0:
        conn.execute("UPDATE orders SET status=?, picked_at=? WHERE id=?", (READY_TO_PACK, at, o["id"]))
        log(conn, actor, "picking_completed", "Picking completed — all items collected", order_id=o["id"], at=at)
    return {"order": orders_svc.get_order_row(conn, o["id"]), "already": False}


def report_problem(conn, actor: Actor, item_id: int, kind: str, note: str = "", at=None) -> dict:
    """'Can't find it' / 'Item damaged'. Never changes stock silently — it opens an issue and blocks the order."""
    if kind not in ("not_found", "damaged"):
        raise DomainError("Unknown problem type", code="validation", status=422)
    it = _item(conn, item_id)
    o = orders_svc.get_order_row(conn, it["order_id"])
    if o["status"] == READY_TO_PICK:
        o = start_picking(conn, actor, o["id"], at=at)
    if o["status"] != PICKING:
        raise DomainError("Problems can only be reported while the order is being picked", code="invalid_transition")
    if it["pick_status"] == "picked":
        raise DomainError("This line is already picked")
    if it["pick_status"] in ("not_found", "damaged"):
        existing = one(conn, "SELECT * FROM issues WHERE item_id=? AND status != 'Resolved' ORDER BY created_at DESC",
                       (it["id"],))
        if existing:
            return existing
    at = at or clock.now_iso()
    bin_ = one(conn, "SELECT bin FROM inventory WHERE product_id=? AND warehouse_id='MAIN'", (it["product_id"],))["bin"]
    if kind == "not_found":
        typ, title = "Stock Not Found", f"{it['sku']} not found in bin {bin_} ({o['id']})"
        desc = (f"{actor.name} could not find {it['qty'] - it['picked_qty']} × {it['name']} ({it['variant']}) in bin {bin_}. "
                "System stock has not been changed. Recount the bin, check nearby bins, or confirm it is missing.")
    else:
        typ, title = "Damaged Item", f"{it['sku']} damaged in bin {bin_} ({o['id']})"
        desc = f"{actor.name} found {it['name']} ({it['variant']}) damaged. System stock has not been changed."
    if note:
        desc += f" Note: {note}"
    conn.execute("UPDATE order_items SET pick_status=? WHERE id=?", (kind, it["id"]))
    issue = issues_svc.create_issue(conn, actor, type=typ, severity="High", title=title, description=desc,
                                    order_id=o["id"], product_id=it["product_id"], item_id=it["id"], blocking=True,
                                    dedupe_key=f"pick:{it['id']}:{kind}:{at}", at=at)
    log(conn, actor, "pick_problem", f"Reported: {typ.lower()} — {it['sku']} (bin {bin_})", order_id=o["id"],
        issue_id=issue["id"], product_id=it["product_id"], at=at)
    return issue


def resolve_pick_problem(conn, actor: Actor, issue_id: str, action: str, *, substitute_sku: str | None = None,
                         note: str = "") -> dict:
    issue = issues_svc.get_issue_row(conn, issue_id)
    if issue["status"] == "Resolved":
        return issue
    if issue["type"] not in ("Stock Not Found", "Damaged Item") or not issue["item_id"]:
        raise DomainError("This action only applies to picking problems")
    it = _item(conn, issue["item_id"])
    o = orders_svc.get_order_row(conn, it["order_id"])
    note = (note or "").strip()

    if action == "found":
        conn.execute("UPDATE order_items SET pick_status='pending' WHERE id=?", (it["id"],))
        res = note or ("Found on recount" if issue["type"] == "Stock Not Found" else "Checked — item is fine")
        issues_svc.close_issue(conn, actor, issue_id, res)
        log(conn, actor, "pick_resumed", f"{it['sku']} can be picked again ({res})", order_id=o["id"], issue_id=issue_id)
        return issues_svc.get_issue_row(conn, issue_id)

    require_office(actor, "adjust stock or change orders")
    if action in ("confirm_missing", "substitute"):
        missing = it["qty"] - it["picked_qty"]
        row = inv.stock_row(conn, it["product_id"], MAIN)
        write_off = min(missing, row["on_hand"])
        inv._bump(conn, it["product_id"], MAIN, reserved=-it["reserved_qty"])
        conn.execute("UPDATE order_items SET reserved_qty=0 WHERE id=?", (it["id"],))
        if write_off:
            inv._bump(conn, it["product_id"], MAIN, on_hand=-write_off)
        why = "missing on recount" if issue["type"] == "Stock Not Found" else "damaged"
        log(conn, actor, "stock_adjusted", f"{it['sku']} in Main: -{write_off} ({why}, {issue_id})",
            order_id=o["id"], issue_id=issue_id, product_id=it["product_id"])

    if action == "confirm_missing":
        conn.execute("UPDATE order_items SET pick_status='pending' WHERE id=?", (it["id"],))
        ok = inv.try_reserve(conn, actor, o["id"])
        res = note or "Confirmed missing; stock adjusted and the line re-planned"
        issues_svc.close_issue(conn, actor, issue_id, res)
        if ok:
            log(conn, actor, "replanned", "Other units available — line can be picked again", order_id=o["id"])
        return issues_svc.get_issue_row(conn, issue_id)

    if action == "substitute":
        p = inv.product(conn, it["product_id"])
        if not p["substitutable"]:
            raise DomainError(f"{p['sku']} is not marked as substitutable — ask the customer first", code="not_substitutable")
        if not substitute_sku:
            raise DomainError("Choose the substitute SKU", code="validation", status=422)
        sp = inv.product_by_sku(conn, substitute_sku)
        if sp["base_code"] != p["base_code"] or sp["id"] == p["id"]:
            raise DomainError("A substitute must be a different variant of the same product", code="validation", status=422)
        need = it["qty"] - it["picked_qty"]
        if inv.available(inv.stock_row(conn, sp["id"], MAIN)) < need:
            raise DomainError(f"Not enough {sp['sku']} available in Main Warehouse", code="insufficient_stock")
        conn.execute("UPDATE order_items SET product_id=?, pick_status='pending', reserved_qty=0 WHERE id=?",
                     (sp["id"], it["id"]))
        inv.try_reserve(conn, actor, o["id"])
        res = note or f"Substituted with {sp['sku']} ({sp['variant']})"
        issues_svc.close_issue(conn, actor, issue_id, res)
        log(conn, actor, "substituted", f"{p['sku']} replaced by {sp['sku']} ({sp['variant']})", order_id=o["id"],
            issue_id=issue_id)
        return issues_svc.get_issue_row(conn, issue_id)

    if action == "cancel_order":
        orders_svc.cancel_order(conn, actor, o["id"], note or f"Cancelled — {issue['type'].lower()} ({issue_id})")
        return issues_svc.get_issue_row(conn, issue_id)

    raise DomainError("Unknown action", code="validation", status=422)


def pick_detail(conn, order_id: str) -> dict:
    d = orders_svc.order_detail(conn, order_id)
    d["line_items"].sort(key=lambda i: (i["pick_status"] == "picked", i["bin"] or ""))
    return d
