"""Inventory: reservations, two-warehouse transfers, receiving/putaway and adjustments.

Numbers per SKU per warehouse:
  on_hand           units physically on the shelf (as far as the system knows)
  reserved          units promised to processed orders (or to an outgoing transfer)
  available         on_hand - reserved   -> the only stock a new order may claim
  awaiting_putaway  received from a supplier but not yet shelved -> NOT sellable
Only the Main Warehouse ships orders.
"""
import re
from collections import defaultdict
from datetime import timedelta

from .. import clock, config
from ..db import one, all_rows
from .common import (
    Actor, DomainError, NotFound, MAIN, SECONDARY, AWAITING_STOCK, READY_TO_PICK, RECEIVED, ON_HOLD, PICKING,
    next_id, log, loads, require_office,
)
from . import issues as issues_svc


def product_by_sku(conn, sku: str) -> dict:
    p = one(conn, "SELECT * FROM products WHERE sku = ?", ((sku or "").strip().upper(),))
    if not p:
        raise NotFound(f"SKU {sku}")
    return p


def product(conn, product_id: int) -> dict:
    p = one(conn, "SELECT * FROM products WHERE id = ?", (product_id,))
    if not p:
        raise NotFound(f"Product {product_id}")
    return p


def default_capacity(category: str | None, wh: str) -> int:
    if wh == SECONDARY:
        return config.SECONDARY_BIN_CAPACITY
    return config.BIN_CAPACITY_BY_CATEGORY.get(category or "", config.DEFAULT_BIN_CAPACITY)


def stock_row(conn, product_id: int, wh: str) -> dict:
    row = one(conn, "SELECT * FROM inventory WHERE product_id = ? AND warehouse_id = ?", (product_id, wh))
    if row is None:
        p = product(conn, product_id)
        conn.execute("INSERT INTO inventory(product_id, warehouse_id, bin, capacity) VALUES (?,?,?,?)",
                     (product_id, wh, "UNASSIGNED", default_capacity(p["category"], wh)))
        row = one(conn, "SELECT * FROM inventory WHERE product_id = ? AND warehouse_id = ?", (product_id, wh))
    return row


def available(row: dict) -> int:
    return row["on_hand"] - row["reserved"]


def capacity_of(row: dict | None, category: str | None, wh: str) -> int:
    """Bin capacity; databases from older versions have 0 and fall back to the category default."""
    cap = (row or {}).get("capacity") or 0
    return cap if cap > 0 else default_capacity(category, wh)


def below_line(main_row: dict, category: str | None) -> bool:
    """The preventive rule: available in Main is below REPLENISH_BELOW_PCT of the bin's capacity."""
    cap = capacity_of(main_row, category, MAIN)
    return available(main_row) * 100 < cap * config.REPLENISH_BELOW_PCT


def refill_room(main_row: dict, category: str | None) -> int:
    """Units that fit in the Main bin right now (stock waiting for put-away already has a place)."""
    cap = capacity_of(main_row, category, MAIN)
    return max(0, cap - main_row["on_hand"] - main_row["awaiting_putaway"])


def bin_sort_key(b: str | None):
    """Natural order for bins: A-01-02 < A-01-10 < A-02-01 < B-01-01; unassigned bins last."""
    if not b or b == "UNASSIGNED":
        return (1, [])
    parts = re.split(r"[-\s]+", b.strip().upper())
    return (0, [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in parts])


def _bump(conn, product_id: int, wh: str, *, on_hand=0, reserved=0, awaiting=0) -> None:
    row = stock_row(conn, product_id, wh)
    new_on_hand = row["on_hand"] + on_hand
    new_reserved = row["reserved"] + reserved
    new_awaiting = row["awaiting_putaway"] + awaiting
    if new_on_hand < 0 or new_reserved < 0 or new_awaiting < 0 or new_reserved > new_on_hand:
        p = product(conn, product_id)
        raise DomainError(f"Stock numbers for {p['sku']} would become inconsistent — action cancelled",
                          code="stock_inconsistent")
    conn.execute("UPDATE inventory SET on_hand=?, reserved=?, awaiting_putaway=? WHERE id=?",
                 (new_on_hand, new_reserved, new_awaiting, row["id"]))


def line_need(item: dict) -> int:
    return max(0, item["qty"] - item["picked_qty"] - item["reserved_qty"])


def try_reserve(conn, actor: Actor, order_id: str, at=None) -> bool:
    """All-or-nothing reservation from Main. A half-reserved order would lock stock
    other orders could ship today, so we either reserve every missing unit or none."""
    items = all_rows(conn, "SELECT * FROM order_items WHERE order_id = ?", (order_id,))
    need_by_product: dict[int, int] = defaultdict(int)
    for it in items:
        if it["pick_status"] in ("not_found", "damaged"):
            continue
        need_by_product[it["product_id"]] += line_need(it)
    short = []
    for pid, need in need_by_product.items():
        if need and available(stock_row(conn, pid, MAIN)) < need:
            short.append(pid)
    order = one(conn, "SELECT * FROM orders WHERE id = ?", (order_id,))
    at = at or clock.now_iso()
    if short:
        if order["status"] != AWAITING_STOCK:
            conn.execute("UPDATE orders SET status = ? WHERE id = ?", (AWAITING_STOCK, order_id))
            skus = ", ".join(product(conn, p)["sku"] for p in short)
            log(conn, actor, "awaiting_stock", f"Not enough stock in Main Warehouse for {skus}",
                order_id=order_id, at=at)
        return False
    reserved_any = False
    for it in items:
        if it["pick_status"] in ("not_found", "damaged"):
            continue
        need = line_need(it)
        if need:
            _bump(conn, it["product_id"], MAIN, reserved=need)
            conn.execute("UPDATE order_items SET reserved_qty = reserved_qty + ? WHERE id = ?", (need, it["id"]))
            reserved_any = True
    if order["status"] in (RECEIVED, ON_HOLD, AWAITING_STOCK):
        conn.execute("UPDATE orders SET status = ? WHERE id = ?", (READY_TO_PICK, order_id))
    if reserved_any:
        log(conn, actor, "stock_reserved", "Stock reserved in Main Warehouse", order_id=order_id, at=at)
    return True


def release_reservations(conn, order_id: str) -> int:
    released = 0
    for it in all_rows(conn, "SELECT * FROM order_items WHERE order_id = ? AND reserved_qty > 0", (order_id,)):
        _bump(conn, it["product_id"], MAIN, reserved=-it["reserved_qty"])
        conn.execute("UPDATE order_items SET reserved_qty = 0 WHERE id = ?", (it["id"],))
        released += it["reserved_qty"]
    return released


def allocate_waiting(conn, actor: Actor, at=None) -> list[str]:
    """Give newly available stock to waiting orders: priority first, then earliest ship-by."""
    unblocked = []
    waiting = all_rows(conn, "SELECT id FROM orders WHERE status = ? ORDER BY priority DESC, ship_by ASC, received_at ASC",
                       (AWAITING_STOCK,))
    for o in waiting:
        if issues_svc.blocking_issues_for_order(conn, o["id"]):
            continue
        if try_reserve(conn, actor, o["id"], at=at):
            log(conn, actor, "unblocked", "Stock is now available — order is ready to pick", order_id=o["id"], at=at)
            unblocked.append(o["id"])
    return unblocked


def shortages(conn) -> list[dict]:
    """SKUs that are blocking orders, with what can be done about it."""
    rows = all_rows(conn, """
        SELECT oi.*, o.priority, o.ship_by FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status = ? AND oi.pick_status NOT IN ('not_found','damaged')""", (AWAITING_STOCK,))
    need: dict[int, int] = defaultdict(int)
    orders_by: dict[int, list] = defaultdict(list)
    for r in rows:
        n = line_need(r)
        if n:
            need[r["product_id"]] += n
            orders_by[r["product_id"]].append({"order_id": r["order_id"], "qty": n, "priority": bool(r["priority"]),
                                               "ship_by": r["ship_by"]})
    out = []
    for pid, total in need.items():
        main = stock_row(conn, pid, MAIN)
        sec = stock_row(conn, pid, SECONDARY)
        main_av = available(main)
        p = product(conn, pid)
        open_tr = one(conn, "SELECT * FROM transfers WHERE product_id = ? AND status IN ('requested','in_transit')"
                            " ORDER BY requested_at DESC", (pid,))
        shortfall = max(0, total - main_av)
        if shortfall == 0:
            continue
        refill = refill_room(main, p["category"]) if below_line(main, p["category"]) else 0
        suggest = min(max(shortfall, refill), available(sec)) if not open_tr else 0
        incoming = one(conn, """SELECT i.id, i.expected_at, i.status, l.expected_qty,
                                       COALESCE(l.received_qty, 0) - l.damaged_qty - l.putaway_qty AS awaiting_putaway
                                FROM inbound_lines l JOIN inbound i ON i.id = l.inbound_id
                                WHERE l.product_id = ? AND i.warehouse_id = ?
                                  AND (i.status = 'expected' OR (i.status = 'received'
                                       AND COALESCE(l.received_qty, 0) - l.damaged_qty - l.putaway_qty > 0))
                                ORDER BY CASE i.status WHEN 'received' THEN 0 ELSE 1 END, i.expected_at""", (pid, MAIN))
        out.append({
            "product_id": pid, "sku": p["sku"], "name": p["name"], "variant": p["variant"],
            "needed": total, "main_available": main_av, "secondary_available": available(sec),
            "shortfall": shortfall, "suggested_transfer_qty": suggest,
            "open_transfer": open_tr, "incoming_delivery": incoming,
            "on_order": on_order_by_product(conn).get(pid, 0),
            "orders": sorted(orders_by[pid], key=lambda o: (not o["priority"], o["ship_by"])),
        })
    out.sort(key=lambda s: (-sum(1 for o in s["orders"] if o["priority"]), -len(s["orders"])))
    return out


def create_transfer(conn, actor: Actor, sku: str, qty: int, note: str = "", at=None) -> dict:
    require_office(actor, "request stock transfers")
    p = product_by_sku(conn, sku)
    if qty <= 0:
        raise DomainError("Transfer quantity must be at least 1", code="validation", status=422)
    open_tr = one(conn, "SELECT * FROM transfers WHERE product_id = ? AND status IN ('requested','in_transit')",
                  (p["id"],))
    if open_tr:
        raise DomainError(f"Transfer {open_tr['id']} for {p['sku']} is already open ({open_tr['qty']} units). "
                          "Complete it before requesting another.", code="duplicate_transfer",
                          details={"transfer_id": open_tr["id"]})
    sec = stock_row(conn, p["id"], SECONDARY)
    if available(sec) < qty:
        raise DomainError(f"Secondary Warehouse only has {available(sec)} available units of {p['sku']}",
                          code="insufficient_secondary")
    at = at or clock.now_iso()
    tid = next_id(conn, "transfer", "TR-", 4)
    _bump(conn, p["id"], SECONDARY, reserved=qty)
    conn.execute("INSERT INTO transfers(id, product_id, from_wh, to_wh, qty, status, requested_at, requested_by, note)"
                 " VALUES (?,?,?,?,?,?,?,?,?)", (tid, p["id"], SECONDARY, MAIN, qty, "requested", at, actor.name, note))
    log(conn, actor, "transfer_requested", f"Transfer {tid}: {qty} × {p['sku']} from Secondary → Main",
        product_id=p["id"], at=at)
    return get_transfer(conn, tid)


def get_transfer(conn, tid: str) -> dict:
    t = one(conn, """SELECT t.*, p.sku, p.name, p.variant FROM transfers t JOIN products p ON p.id = t.product_id
                     WHERE t.id = ?""", (tid,))
    if not t:
        raise NotFound(f"Transfer {tid}")
    return t


def dispatch_transfer(conn, actor: Actor, tid: str, at=None) -> dict:
    t = get_transfer(conn, tid)
    if t["status"] in ("in_transit", "received"):
        return t
    if t["status"] != "requested":
        raise DomainError(f"Transfer {tid} is {t['status']} and cannot be dispatched")
    at = at or clock.now_iso()
    _bump(conn, t["product_id"], SECONDARY, on_hand=-t["qty"], reserved=-t["qty"])
    conn.execute("UPDATE transfers SET status='in_transit', dispatched_at=? WHERE id=?", (at, tid))
    log(conn, actor, "transfer_dispatched", f"Transfer {tid} left Secondary Warehouse ({t['qty']} × {t['sku']})",
        product_id=t["product_id"], at=at)
    return get_transfer(conn, tid)


def receive_transfer(conn, actor: Actor, tid: str, at=None) -> dict:
    t = get_transfer(conn, tid)
    if t["status"] == "received":
        return {**t, "unblocked_orders": []}
    if t["status"] == "cancelled":
        raise DomainError(f"Transfer {tid} was cancelled")
    at = at or clock.now_iso()
    if t["status"] == "requested":
        dispatch_transfer(conn, actor, tid, at=at)
    _bump(conn, t["product_id"], MAIN, on_hand=t["qty"])
    conn.execute("UPDATE transfers SET status='received', received_at=? WHERE id=?", (at, tid))
    log(conn, actor, "transfer_received", f"Transfer {tid} received at Main Warehouse (+{t['qty']} × {t['sku']})",
        product_id=t["product_id"], at=at)
    unblocked = allocate_waiting(conn, actor, at=at)
    return {**get_transfer(conn, tid), "unblocked_orders": unblocked}


def cancel_transfer(conn, actor: Actor, tid: str) -> dict:
    require_office(actor, "cancel transfers")
    t = get_transfer(conn, tid)
    if t["status"] != "requested":
        raise DomainError("Only transfers that haven't left the Secondary Warehouse can be cancelled")
    _bump(conn, t["product_id"], SECONDARY, reserved=-t["qty"])
    conn.execute("UPDATE transfers SET status='cancelled' WHERE id=?", (tid,))
    log(conn, actor, "transfer_cancelled", f"Transfer {tid} cancelled", product_id=t["product_id"])
    return get_transfer(conn, tid)


def list_transfers(conn) -> list[dict]:
    return all_rows(conn, """SELECT t.*, p.sku, p.name, p.variant FROM transfers t JOIN products p ON p.id = t.product_id
                             ORDER BY CASE t.status WHEN 'requested' THEN 0 WHEN 'in_transit' THEN 1 ELSE 2 END,
                             t.requested_at DESC""")


SOURCES = {"supplier": "Supplier delivery", "reorder": "Reorder", "backorder": "Rest of a reorder",
           "manual": "Unplanned arrival"}


def _line_view(l: dict) -> dict:
    counted = l["received_qty"] is not None
    good = (l["received_qty"] or 0) - l["damaged_qty"] if counted else 0
    l["good_qty"] = good
    l["awaiting_putaway"] = max(0, good - l["putaway_qty"]) if counted else 0
    l["missing_qty"] = max(0, l["expected_qty"] - (l["received_qty"] or 0)) if counted else 0
    l["extra_qty"] = max(0, (l["received_qty"] or 0) - l["expected_qty"]) if counted else 0
    return l


def get_inbound(conn, inbound_id: str) -> dict:
    ib = one(conn, "SELECT * FROM inbound WHERE id = ?", (inbound_id,))
    if not ib:
        raise NotFound(f"Delivery {inbound_id}")
    lines = all_rows(conn, """SELECT l.*, p.sku, p.name, p.variant, inv.bin FROM inbound_lines l
                              JOIN products p ON p.id = l.product_id
                              LEFT JOIN inventory inv ON inv.product_id = l.product_id AND inv.warehouse_id = ?
                              WHERE l.inbound_id = ? ORDER BY l.id""", (ib["warehouse_id"], inbound_id))
    lines = [_line_view(l) for l in lines]
    ib = dict(ib)
    ib["source"] = ib.get("source") or "supplier"
    ib["source_label"] = SOURCES.get(ib["source"], "Delivery")
    ib["overdue"] = ib["status"] == "expected" and ib["expected_at"] < clock.now_iso()
    ib["totals"] = {
        "expected": sum(l["expected_qty"] for l in lines),
        "received": sum(l["received_qty"] or 0 for l in lines),
        "good": sum(l["good_qty"] for l in lines),
        "damaged": sum(l["damaged_qty"] for l in lines),
        "missing": sum(l["missing_qty"] for l in lines),
        "awaiting_putaway": sum(l["awaiting_putaway"] for l in lines),
        "putaway": sum(l["putaway_qty"] for l in lines),
    }
    return {**ib, "lines": lines}


def list_inbound(conn) -> list[dict]:
    """To put away first, then expected (soonest / overdue first), then finished and cancelled."""
    ids = all_rows(conn, """SELECT id FROM inbound ORDER BY
                             CASE status WHEN 'received' THEN 0 WHEN 'expected' THEN 1 WHEN 'putaway_done' THEN 2 ELSE 3 END,
                             CASE WHEN status = 'expected' THEN expected_at END ASC,
                             COALESCE(received_at, expected_at) DESC""")
    return [get_inbound(conn, r["id"]) for r in ids]


def _new_inbound(conn, *, supplier: str, warehouse_id: str, expected_at: str, source: str,
                 reorder_id: str | None = None, note: str | None = None) -> str:
    iid = next_id(conn, "inbound", "IN-", 4, start=200)
    conn.execute("""INSERT INTO inbound(id, supplier, warehouse_id, expected_at, status, source, reorder_id, note)
                    VALUES (?,?,?,?,?,?,?,?)""", (iid, supplier, warehouse_id, expected_at, "expected", source, reorder_id, note))
    return iid


def receive_inbound(conn, actor: Actor, inbound_id: str, lines: list[dict], at=None, *,
                    missing_action: str = "close", replace_damaged: bool = False,
                    backorder_expected_at: str | None = None, putaway_now: bool = False) -> dict:
    """Count a delivery. For every line: how many arrived and how many of those are damaged
    (the rest did not arrive). `missing_action`: 'backorder' keeps the missing units on order as a
    follow-up delivery, 'close' records them as not coming. Stock waiting for put-away goes up
    automatically; `putaway_now` shelves the good units in their usual bins straight away."""
    ib = get_inbound(conn, inbound_id)
    if ib["status"] == "cancelled":
        raise DomainError(f"Delivery {inbound_id} was cancelled", code="already_done")
    if ib["status"] != "expected":
        raise DomainError(f"Delivery {inbound_id} has already been received — use “Correct count” to fix a number",
                          code="already_done")
    if missing_action not in ("close", "backorder"):
        raise DomainError("Choose whether the missing units are still coming or not", code="validation", status=422)
    at = at or clock.now_iso()
    by_id = {l["id"]: l for l in ib["lines"]}
    counted = {int(l["line_id"]): l for l in lines}
    if set(counted) != set(by_id):
        raise DomainError("Please count every line on the delivery before confirming", code="validation", status=422)
    problems, follow_up = [], []
    for lid, line in by_id.items():
        rec = int(counted[lid].get("received_qty", 0))
        dmg = int(counted[lid].get("damaged_qty", 0) or 0)
        if rec < 0 or dmg < 0 or dmg > rec:
            raise DomainError(f"Check the counts for {line['sku']}: damaged can't exceed received", code="validation",
                              status=422)
        missing = max(0, line["expected_qty"] - rec)
        action = (missing_action if missing else None)
        conn.execute("UPDATE inbound_lines SET received_qty=?, damaged_qty=?, missing_action=? WHERE id=?",
                     (rec, dmg, action, lid))
        if rec - dmg:
            _bump(conn, line["product_id"], ib["warehouse_id"], awaiting=rec - dmg)
        resend = (missing if missing_action == "backorder" else 0) + (dmg if replace_damaged else 0)
        if resend:
            follow_up.append((line, resend))
        if missing:
            problems.append(f"{line['sku']}: expected {line['expected_qty']}, received {rec} — "
                            + (f"{missing} still coming" if missing_action == "backorder" else f"{missing} not coming"))
        if rec > line["expected_qty"]:
            problems.append(f"{line['sku']}: {rec - line['expected_qty']} more than expected arrived")
        if dmg:
            problems.append(f"{line['sku']}: {dmg} damaged" + (" — replacement requested" if replace_damaged else ""))
    conn.execute("UPDATE inbound SET status='received', received_at=?, received_by=? WHERE id=?",
                 (at, actor.name, inbound_id))
    t = ib["totals"]
    log(conn, actor, "delivery_received", f"Delivery {inbound_id} from {ib['supplier']} counted and received", at=at)
    backorder_id = None
    if follow_up:
        typed = clock.parse_user_date(backorder_expected_at)
        expected = clock.iso(typed) if typed else clock.iso(clock.parse(at) + timedelta(days=config.BACKORDER_DEFAULT_DAYS))
        backorder_id = _new_inbound(conn, supplier=ib["supplier"], warehouse_id=ib["warehouse_id"], expected_at=expected,
                                    source="backorder", reorder_id=ib.get("reorder_id"),
                                    note=f"Rest of {inbound_id}")
        for line, qty in follow_up:
            conn.execute("""INSERT INTO inbound_lines(inbound_id, product_id, expected_qty, reorder_line_id)
                            VALUES (?,?,?,?)""", (backorder_id, line["product_id"], qty, line.get("reorder_line_id")))
        log(conn, actor, "backorder_created",
            f"Delivery {backorder_id} created for the units still to come from {ib['supplier']} "
            f"({sum(q for _, q in follow_up)} units)", at=at)
    unresolved = [p for p in problems if "still coming" not in p and "replacement requested" not in p]
    if unresolved:
        only_damage = all(p.endswith("damaged") for p in unresolved)
        issues_svc.create_issue(conn, actor, type="Damaged Item" if only_damage else "Receiving Shortage",
                                severity="Medium",
                                title=(f"Delivery {inbound_id} arrived with damaged units" if only_damage
                                       else f"Delivery {inbound_id} did not match the expected quantities"),
                                description="; ".join(problems), dedupe_key=f"recv:{inbound_id}", at=at)
    unblocked: list[str] = []
    if putaway_now:
        unblocked = putaway_all(conn, actor, inbound_id, at=at)["unblocked_orders"]
    _refresh_reorder(conn, ib.get("reorder_id"))
    return {**get_inbound(conn, inbound_id), "backorder_id": backorder_id, "problems": problems,
            "unblocked_orders": unblocked}


def correct_count(conn, actor: Actor, line_id: int, received_qty: int, damaged_qty: int, reason: str, at=None) -> dict:
    """Fix a count after a delivery was confirmed. Stock waiting for put-away is adjusted
    automatically; units already on a shelf can only be changed with a stock adjustment."""
    if not reason or not reason.strip():
        raise DomainError("Say why the count is being corrected", code="validation", status=422)
    line = one(conn, "SELECT * FROM inbound_lines WHERE id = ?", (line_id,))
    if not line:
        raise NotFound(f"Delivery line {line_id}")
    ib = one(conn, "SELECT * FROM inbound WHERE id = ?", (line["inbound_id"],))
    if line["received_qty"] is None:
        raise DomainError("This delivery hasn't been counted yet — count it first", code="validation", status=422)
    if received_qty < 0 or damaged_qty < 0 or damaged_qty > received_qty:
        raise DomainError("Damaged can't be more than received", code="validation", status=422)
    new_good = received_qty - damaged_qty
    if new_good < line["putaway_qty"]:
        raise DomainError(f"{line['putaway_qty']} units are already on the shelf. To lower the count below that, "
                          "use Inventory → Adjust after a physical count.", code="below_putaway")
    old_good = line["received_qty"] - line["damaged_qty"]
    delta = new_good - old_good
    p = product(conn, line["product_id"])
    if received_qty == line["received_qty"] and damaged_qty == line["damaged_qty"]:
        return get_inbound(conn, ib["id"])
    if delta:
        _bump(conn, line["product_id"], ib["warehouse_id"], awaiting=delta)
    missing = max(0, line["expected_qty"] - received_qty)
    action = (line["missing_action"] or "close") if missing else None
    conn.execute("UPDATE inbound_lines SET received_qty=?, damaged_qty=?, missing_action=? WHERE id=?",
                 (received_qty, damaged_qty, action, line_id))
    status = "putaway_done" if all_rows(conn, """SELECT 1 FROM inbound_lines WHERE inbound_id = ?
                     AND received_qty - damaged_qty - putaway_qty > 0""", (ib["id"],)) == [] else "received"
    conn.execute("UPDATE inbound SET status=? WHERE id=?", (status, ib["id"]))
    log(conn, actor, "count_corrected",
        f"{ib['id']} {p['sku']}: count corrected from {line['received_qty']} ({line['damaged_qty']} damaged) to "
        f"{received_qty} ({damaged_qty} damaged). Waiting for put-away {'+' if delta >= 0 else ''}{delta}. "
        f"Reason: {reason.strip()}", product_id=p["id"], at=at)
    _refresh_reorder(conn, ib.get("reorder_id"))
    return get_inbound(conn, ib["id"])


def record_arrival(conn, actor: Actor, supplier: str, warehouse_id: str, lines: list[dict], note: str = "",
                   putaway_now: bool = False, at=None) -> dict:
    """Stock that arrived without an expected delivery (walk-in supplier, returned stock found,
    a sample box …). Recorded as a delivery that is counted on arrival."""
    supplier = (supplier or "").strip()
    if not supplier:
        raise DomainError("Who delivered it? Enter a supplier or source", code="validation", status=422)
    if warehouse_id not in (MAIN, SECONDARY):
        raise DomainError("Unknown warehouse", code="validation", status=422)
    merged: dict[int, dict] = {}
    for l in lines:
        rec, dmg = int(l.get("received_qty") or 0), int(l.get("damaged_qty") or 0)
        if rec <= 0:
            continue
        if dmg < 0 or dmg > rec:
            raise DomainError(f"Check {l.get('sku')}: damaged can't exceed received", code="validation", status=422)
        p = product_by_sku(conn, l.get("sku"))
        m = merged.setdefault(p["id"], {"rec": 0, "dmg": 0})
        m["rec"] += rec
        m["dmg"] += dmg
    if not merged:
        raise DomainError("Add at least one item with a quantity", code="validation", status=422)
    at = at or clock.now_iso()
    iid = _new_inbound(conn, supplier=supplier, warehouse_id=warehouse_id, expected_at=at, source="manual",
                       note=(note or "").strip() or None)
    counts = []
    for pid, m in merged.items():
        lid = conn.execute("INSERT INTO inbound_lines(inbound_id, product_id, expected_qty) VALUES (?,?,?)",
                           (iid, pid, m["rec"])).lastrowid
        counts.append({"line_id": lid, "received_qty": m["rec"], "damaged_qty": m["dmg"]})
    log(conn, actor, "arrival_recorded", f"Unplanned arrival {iid} from {supplier} recorded "
        f"({sum(m['rec'] for m in merged.values())} units)", at=at)
    return receive_inbound(conn, actor, iid, counts, at=at, putaway_now=putaway_now)


def putaway_all(conn, actor: Actor, inbound_id: str, at=None) -> dict:
    """Shelve every counted line of a delivery in its usual bin."""
    ib = get_inbound(conn, inbound_id)
    unblocked: list[str] = []
    for l in ib["lines"]:
        if l["awaiting_putaway"] > 0:
            r = putaway_line(conn, actor, l["id"], None, at=at)
            unblocked += r["unblocked_orders"]
    return {**get_inbound(conn, inbound_id), "unblocked_orders": sorted(set(unblocked))}


def _refresh_reorder(conn, reorder_id: str | None) -> None:
    if reorder_id:
        from . import reorders as reorders_svc
        reorders_svc.refresh_status(conn, reorder_id)


def on_order_by_product(conn) -> dict[int, int]:
    """Units still expected from suppliers (deliveries not yet counted), per SKU, both warehouses."""
    return {r["product_id"]: r["qty"] for r in all_rows(conn, """
        SELECT l.product_id, SUM(l.expected_qty) AS qty FROM inbound_lines l JOIN inbound i ON i.id = l.inbound_id
        WHERE i.status = 'expected' GROUP BY l.product_id""")}


def putaway_line(conn, actor: Actor, line_id: int, bin: str | None = None, at=None) -> dict:
    line = one(conn, "SELECT * FROM inbound_lines WHERE id = ?", (line_id,))
    if not line:
        raise NotFound(f"Delivery line {line_id}")
    ib = one(conn, "SELECT * FROM inbound WHERE id = ?", (line["inbound_id"],))
    if line["received_qty"] is None:
        raise DomainError("Count and receive the delivery before putting stock away")
    qty = line["received_qty"] - line["damaged_qty"] - line["putaway_qty"]
    at = at or clock.now_iso()
    unblocked: list[str] = []
    if qty > 0:
        inv = stock_row(conn, line["product_id"], ib["warehouse_id"])
        new_bin = (bin or "").strip().upper()
        if new_bin and new_bin != inv["bin"]:
            other = one(conn, """SELECT p.sku FROM inventory i JOIN products p ON p.id = i.product_id
                                 WHERE i.warehouse_id = ? AND i.bin = ? AND i.product_id != ?""",
                        (ib["warehouse_id"], new_bin, line["product_id"]))
            if other:
                raise DomainError(f"Bin {new_bin} already holds {other['sku']}. Choose an empty bin or keep "
                                  f"the current bin {inv['bin']}.", code="bin_taken")
            conn.execute("UPDATE inventory SET bin=? WHERE id=?", (new_bin, inv["id"]))
        _bump(conn, line["product_id"], ib["warehouse_id"], on_hand=qty, awaiting=-qty)
        conn.execute("UPDATE inbound_lines SET putaway_qty = putaway_qty + ? WHERE id=?", (qty, line_id))
        p = product(conn, line["product_id"])
        bin_now = stock_row(conn, line["product_id"], ib["warehouse_id"])["bin"]
        log(conn, actor, "putaway", f"Put away {qty} × {p['sku']} to bin {bin_now} — now available to sell",
            product_id=p["id"], at=at)
        if ib["warehouse_id"] == MAIN:
            unblocked = allocate_waiting(conn, actor, at=at)
    remaining = all_rows(conn, """SELECT id FROM inbound_lines WHERE inbound_id = ?
                                  AND received_qty - damaged_qty - putaway_qty > 0""", (ib["id"],))
    if not remaining:
        conn.execute("UPDATE inbound SET status='putaway_done' WHERE id=?", (ib["id"],))
    _refresh_reorder(conn, ib.get("reorder_id"))
    return {**get_inbound(conn, ib["id"]), "unblocked_orders": unblocked}


def adjust_stock(conn, actor: Actor, sku: str, warehouse_id: str, on_hand: int, reason: str) -> dict:
    require_office(actor, "adjust inventory")
    if not reason or not reason.strip():
        raise DomainError("Give a reason for the stock adjustment", code="validation", status=422)
    if warehouse_id not in (MAIN, SECONDARY):
        raise DomainError("Unknown warehouse", code="validation", status=422)
    p = product_by_sku(conn, sku)
    row = stock_row(conn, p["id"], warehouse_id)
    if on_hand < row["reserved"]:
        raise DomainError(f"{row['reserved']} units are reserved for orders — on-hand can't go below that. "
                          "Cancel or re-plan those orders first.", code="below_reserved")
    delta = on_hand - row["on_hand"]
    if delta == 0:
        return row
    conn.execute("UPDATE inventory SET on_hand=? WHERE id=?", (on_hand, row["id"]))
    wh = "Main" if warehouse_id == MAIN else "Secondary"
    log(conn, actor, "stock_adjusted", f"{p['sku']} in {wh}: {row['on_hand']} → {on_hand} ({'+' if delta > 0 else ''}{delta}). "
        f"Reason: {reason.strip()}", product_id=p["id"])
    if delta > 0 and warehouse_id == MAIN:
        allocate_waiting(conn, actor)
    return stock_row(conn, p["id"], warehouse_id)


def restock_returned(conn, actor: Actor, issue: dict) -> None:
    payload = loads(issue["payload"]) or {}
    for line in payload.get("lines", []):
        _bump(conn, line["product_id"], MAIN, on_hand=line["qty"])
        p = product(conn, line["product_id"])
        log(conn, actor, "returned_to_shelf", f"Returned {line['qty']} × {p['sku']} to bin {line.get('bin', '')}",
            order_id=issue["order_id"], product_id=p["id"])
    allocate_waiting(conn, actor)


def _snapshot(conn) -> list[dict]:
    """One row per SKU with both warehouses, the shortage (if orders are blocked), open transfer and
    incoming supplier stock — everything the inventory screens and the preventive rule need."""
    rows = all_rows(conn, """
        SELECT p.id, p.sku, p.name, p.variant, p.category, p.substitutable, p.low_stock_threshold,
               m.bin AS m_bin, m.on_hand AS m_on_hand, m.reserved AS m_reserved, m.awaiting_putaway AS m_awaiting,
               m.capacity AS m_capacity,
               s.bin AS s_bin, s.on_hand AS s_on_hand, s.reserved AS s_reserved, s.awaiting_putaway AS s_awaiting,
               s.capacity AS s_capacity
        FROM products p
        LEFT JOIN inventory m ON m.product_id = p.id AND m.warehouse_id = 'MAIN'
        LEFT JOIN inventory s ON s.product_id = p.id AND s.warehouse_id = 'SEC'""")
    short = {s["product_id"]: s for s in shortages(conn)}
    transfers = {t["product_id"]: t for t in all_rows(
        conn, "SELECT * FROM transfers WHERE status IN ('requested','in_transit') ORDER BY requested_at")}
    incoming = {}
    for r in all_rows(conn, """SELECT l.product_id, i.id, i.expected_at, l.expected_qty, i.warehouse_id, i.reorder_id
                               FROM inbound_lines l JOIN inbound i ON i.id = l.inbound_id
                               WHERE i.status = 'expected'
                               ORDER BY CASE i.warehouse_id WHEN 'MAIN' THEN 0 ELSE 1 END, i.expected_at"""):
        incoming.setdefault(r["product_id"], r)
    on_order = on_order_by_product(conn)
    issue_pids = {r["product_id"] for r in all_rows(
        conn, "SELECT product_id FROM issues WHERE status != 'Resolved' AND product_id IS NOT NULL")}
    out = []
    for r in rows:
        main = {"bin": r["m_bin"], "on_hand": r["m_on_hand"] or 0, "reserved": r["m_reserved"] or 0,
                "awaiting_putaway": r["m_awaiting"] or 0, "capacity": r["m_capacity"] or 0}
        sec = {"bin": r["s_bin"], "on_hand": r["s_on_hand"] or 0, "reserved": r["s_reserved"] or 0,
               "awaiting_putaway": r["s_awaiting"] or 0, "capacity": r["s_capacity"] or 0}
        main["capacity"] = capacity_of(main, r["category"], MAIN)
        sec["capacity"] = capacity_of(sec, r["category"], SECONDARY)
        for w in (main, sec):
            w["available"] = w["on_hand"] - w["reserved"]
            w["fill_pct"] = round(w["on_hand"] / w["capacity"] * 100) if w["capacity"] else 0
            w["available_pct"] = round(w["available"] / w["capacity"] * 100) if w["capacity"] else 0
        out.append({
            "product_id": r["id"], "sku": r["sku"], "name": r["name"], "variant": r["variant"],
            "category": r["category"], "substitutable": bool(r["substitutable"]),
            "low_stock_threshold": r["low_stock_threshold"], "main": main, "secondary": sec,
            "shortage": short.get(r["id"]), "open_transfer": transfers.get(r["id"]),
            "incoming_delivery": incoming.get(r["id"]), "has_open_issue": r["id"] in issue_pids,
            "on_order": on_order.get(r["id"], 0),
        })
    for item in out:
        item["replenish"] = _replenish_info(item)
    return out


def _replenish_info(item: dict) -> dict:
    """Preventive rule, in plain words. If AVAILABLE units in Main are below half of the bin's
    capacity, a transfer from Secondary is required — before any order gets stuck."""
    main, sec = item["main"], item["secondary"]
    cap, av = main["capacity"], main["available"]
    line = cap * config.REPLENISH_BELOW_PCT / 100
    below = av < line
    pct = main["available_pct"]
    base = {"below_line": below, "line_units": int(line) if line == int(line) else round(line, 1),
            "available_pct": pct, "suggested_qty": 0, "room": max(0, cap - main["on_hand"] - main["awaiting_putaway"])}
    if not below:
        return {**base, "status": "ok", "level": "ok", "label": "OK",
                "message": f"{av} of {cap} available ({pct}%) — above the {config.REPLENISH_BELOW_PCT}% line."}
    level = "critical" if av <= 0 or av * 100 < cap * config.REPLENISH_CRITICAL_PCT else "warning"
    head = f"Only {av} of {cap} available in Main ({pct}%), below the {config.REPLENISH_BELOW_PCT}% line."
    shortfall = item["shortage"]["shortfall"] if item["shortage"] else 0
    target = max(base["room"], shortfall)
    tr = item["open_transfer"]
    if tr:
        way = "on its way" if tr["status"] == "in_transit" else "requested, not sent yet"
        return {**base, "status": "in_transfer", "level": level, "label": "Transfer open",
                "message": f"{head} Transfer {tr['id']} ({tr['qty']} units) is {way}."}
    if sec["available"] > 0 and target > 0:
        q = min(target, sec["available"])
        where = f" from Secondary bin {sec['bin']}" if sec["bin"] else " from Secondary"
        extra = f" This also unblocks {len(item['shortage']['orders'])} waiting order(s)." if shortfall else ""
        return {**base, "status": "transfer_required", "level": level, "label": "Transfer required",
                "suggested_qty": q, "message": f"{head} Transfer {q} units{where}.{extra}"}
    if main["awaiting_putaway"] > 0:
        return {**base, "status": "putaway", "level": level, "label": "Put away",
                "message": f"{head} {main['awaiting_putaway']} units are in the building — put them away."}
    if item["incoming_delivery"]:
        d = item["incoming_delivery"]
        where = "" if d["warehouse_id"] == MAIN else " (to Secondary)"
        what = f"reorder {d['reorder_id']}" if d.get("reorder_id") else f"supplier delivery {d['id']}"
        return {**base, "status": "incoming", "level": level, "label": "On order",
                "message": f"{head} Secondary has none to spare; {what} brings {item['on_order']}{where}."}
    if sec["available"] <= 0:
        return {**base, "status": "reorder", "level": level, "label": "Reorder",
                "message": f"{head} Secondary Warehouse has none either — reorder from the supplier (Reorders page)."}
    return {**base, "status": "wait", "level": level, "label": "Bin full",
            "message": f"{head} The bin is full of units already reserved for orders — transfer after they are picked."}


def list_inventory(conn, q: str | None = None, view: str | None = None, sort: str | None = None) -> list[dict]:
    out = []
    ql = (q or "").strip().lower()
    for item in _snapshot(conn):
        main_av, sec_av = item["main"]["available"], item["secondary"]["available"]
        item.update({
            "sellable": main_av + sec_av,
            "low_stock": main_av <= item["low_stock_threshold"],
            "blocking": item["shortage"] is not None,
            "transfer_required": item["replenish"]["status"] == "transfer_required",
        })
        if ql and ql not in item["sku"].lower() and ql not in item["name"].lower() \
                and ql not in item["variant"].lower() and ql not in (item["main"]["bin"] or "").lower():
            continue
        if view == "blocking" and not item["blocking"]:
            continue
        if view == "low" and not item["low_stock"]:
            continue
        if view == "replenish" and not item["replenish"]["below_line"]:
            continue
        if view == "putaway" and not (item["main"]["awaiting_putaway"] or item["secondary"]["awaiting_putaway"]):
            continue
        if view == "issues" and not item["has_open_issue"]:
            continue
        if view == "reorder" and not (item["replenish"]["status"] in ("reorder", "incoming") or item["on_order"]):
            continue
        out.append(item)
    if sort == "bin":
        out.sort(key=lambda i: bin_sort_key(i["main"]["bin"]))
    elif sort == "sku":
        out.sort(key=lambda i: i["sku"])
    else:
        out.sort(key=lambda i: (not i["blocking"], not i["replenish"]["below_line"], not i["has_open_issue"],
                                not i["low_stock"], bin_sort_key(i["main"]["bin"])))
    return out


def replenishment(conn) -> dict:
    """Every SKU below the preventive line in Main, most urgent first."""
    items = [i for i in _snapshot(conn) if i["replenish"]["below_line"]]
    rank = {"critical": 0, "warning": 1}
    items.sort(key=lambda i: (i["shortage"] is None, rank.get(i["replenish"]["level"], 2),
                              i["main"]["available_pct"], bin_sort_key(i["main"]["bin"])))
    actionable = [i for i in items if i["replenish"]["status"] == "transfer_required"]
    return {
        "rule": {"below_pct": config.REPLENISH_BELOW_PCT, "critical_pct": config.REPLENISH_CRITICAL_PCT},
        "count": len(items),
        "transfer_required": len(actionable),
        "units_to_move": sum(i["replenish"]["suggested_qty"] for i in actionable),
        "items": [{
            "product_id": i["product_id"], "sku": i["sku"], "name": i["name"], "variant": i["variant"],
            "bin": i["main"]["bin"], "secondary_bin": i["secondary"]["bin"], "capacity": i["main"]["capacity"],
            "on_hand": i["main"]["on_hand"], "reserved": i["main"]["reserved"], "available": i["main"]["available"],
            "secondary_available": i["secondary"]["available"], "blocking_orders": len(i["shortage"]["orders"]) if i["shortage"] else 0,
            "open_transfer": i["open_transfer"], **i["replenish"],
        } for i in items],
    }


def create_replenishment_transfers(conn, actor: Actor, skus: list[str] | None = None, at=None) -> dict:
    """One click: create every suggested preventive transfer (or only the SKUs given)."""
    require_office(actor, "request stock transfers")
    wanted = {s.strip().upper() for s in skus} if skus else None
    created, skipped = [], []
    for i in replenishment(conn)["items"]:
        if wanted is not None and i["sku"] not in wanted:
            continue
        if i["status"] != "transfer_required" or i["suggested_qty"] <= 0:
            skipped.append({"sku": i["sku"], "reason": i["label"]})
            continue
        t = create_transfer(conn, actor, i["sku"], i["suggested_qty"],
                            f"Preventive refill: {i['available']} of {i['capacity']} available in {i['bin']}", at=at)
        created.append({"id": t["id"], "sku": t["sku"], "qty": t["qty"]})
    if wanted:
        for s in wanted - {c["sku"] for c in created} - {k["sku"] for k in skipped}:
            skipped.append({"sku": s, "reason": "Above the refill line — no transfer needed"})
    return {"created": created, "skipped": skipped}


def set_capacity(conn, actor: Actor, sku: str, warehouse_id: str, capacity: int) -> dict:
    require_office(actor, "change bin capacity")
    if warehouse_id not in (MAIN, SECONDARY):
        raise DomainError("Unknown warehouse", code="validation", status=422)
    if capacity < 1 or capacity > 10000:
        raise DomainError("Capacity must be between 1 and 10000 units", code="validation", status=422)
    p = product_by_sku(conn, sku)
    row = stock_row(conn, p["id"], warehouse_id)
    old = capacity_of(row, p["category"], warehouse_id)
    if capacity == old and row["capacity"]:
        return row
    conn.execute("UPDATE inventory SET capacity=? WHERE id=?", (capacity, row["id"]))
    wh = "Main" if warehouse_id == MAIN else "Secondary"
    log(conn, actor, "capacity_changed", f"{p['sku']} bin {row['bin']} ({wh}) capacity {old} → {capacity}",
        product_id=p["id"])
    return stock_row(conn, p["id"], warehouse_id)


def bin_map(conn, warehouse_id: str = MAIN) -> dict:
    """Every bin in walking order, grouped by aisle, with what's in it and how full it is."""
    if warehouse_id not in (MAIN, SECONDARY):
        raise DomainError("Unknown warehouse", code="validation", status=422)
    key = "main" if warehouse_id == MAIN else "secondary"
    bins = []
    for i in _snapshot(conn):
        w = i[key]
        if not w["bin"]:
            continue
        status = "ok"
        if warehouse_id == MAIN:
            if i["shortage"]:
                status = "blocking"
            elif i["replenish"]["below_line"]:
                status = i["replenish"]["level"]
        elif w["on_hand"] == 0:
            status = "empty"
        bins.append({
            "bin": w["bin"], "sku": i["sku"], "name": i["name"], "variant": i["variant"], "category": i["category"],
            "on_hand": w["on_hand"], "reserved": w["reserved"], "available": w["available"],
            "awaiting_putaway": w["awaiting_putaway"], "capacity": w["capacity"], "fill_pct": w["fill_pct"],
            "available_pct": w["available_pct"], "status": status,
            "replenish": i["replenish"] if warehouse_id == MAIN else None,
            "has_open_issue": i["has_open_issue"],
        })
    bins.sort(key=lambda b: bin_sort_key(b["bin"]))
    aisles: dict[str, list] = {}
    for b in bins:
        aisle = b["bin"].split("-")[0] if b["bin"] != "UNASSIGNED" else "Unassigned"
        if warehouse_id == SECONDARY and "-" in b["bin"]:
            aisle = "-".join(b["bin"].split("-")[:2])
        aisles.setdefault(aisle, []).append(b)
    return {
        "warehouse_id": warehouse_id,
        "rule": {"below_pct": config.REPLENISH_BELOW_PCT, "critical_pct": config.REPLENISH_CRITICAL_PCT},
        "totals": {
            "bins": len(bins), "units_on_hand": sum(b["on_hand"] for b in bins),
            "units_available": sum(b["available"] for b in bins), "capacity": sum(b["capacity"] for b in bins),
            "below_line": sum(1 for b in bins if b["status"] in ("warning", "critical", "blocking")),
            "empty": sum(1 for b in bins if b["on_hand"] == 0),
        },
        "aisles": [{"aisle": a, "bins": bs, "units": sum(b["on_hand"] for b in bs),
                    "attention": sum(1 for b in bs if b["status"] in ("warning", "critical", "blocking"))}
                   for a, bs in aisles.items()],
    }
