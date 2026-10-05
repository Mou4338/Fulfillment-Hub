"""Reorders: buying more stock from suppliers.

A reorder (purchase order) lists SKUs and quantities for one supplier. Creating it also creates the
expected delivery that the warehouse counts on the Receiving page, so what was ordered and what
arrived are always linked:

  ordered      units on the reorder
  arrived OK   counted and good (these wait for put-away, then become sellable)
  damaged      arrived but unusable
  not coming   did not arrive and the supplier won't send them (closed)
  still due    on a delivery that hasn't been counted yet (the original, or a follow-up for the rest)

Status: ordered -> partly_received -> received (everything arrived) | closed_short (some never came)
        | cancelled (before anything arrived)
"""
import math
from collections import defaultdict
from datetime import timedelta

from .. import clock, config
from ..db import one, all_rows
from .common import Actor, DomainError, NotFound, MAIN, SECONDARY, next_id, log, require_office
from . import inventory as inv

STATUS_LABELS = {
    "ordered": "Ordered",
    "partly_received": "Partly received",
    "received": "Received",
    "closed_short": "Closed short",
    "cancelled": "Cancelled",
}
OPEN = ("ordered", "partly_received")


def default_supplier(conn, product: dict) -> str:
    """The supplier who last delivered this SKU; otherwise the usual supplier for its category."""
    last = one(conn, """SELECT i.supplier FROM inbound_lines l JOIN inbound i ON i.id = l.inbound_id
                        WHERE l.product_id = ? AND i.source != 'manual' ORDER BY i.expected_at DESC LIMIT 1""",
               (product["id"],))
    if last:
        return last["supplier"]
    return config.SUPPLIER_BY_CATEGORY.get(product["category"], config.DEFAULT_SUPPLIER)


def _round_up(n: int) -> int:
    step = max(1, config.REORDER_ROUND_TO)
    return int(math.ceil(n / step) * step) if n > 0 else 0


def suggestions(conn) -> dict:
    """SKUs that need buying: the whole stock position is below the Main refill line (plus what
    waiting orders need), so a transfer from Secondary can't fix it. Most urgent first."""
    items = []
    for i in inv._snapshot(conn):
        main, sec = i["main"], i["secondary"]
        shortfall = i["shortage"]["shortfall"] if i["shortage"] else 0
        waiting_orders = len(i["shortage"]["orders"]) if i["shortage"] else 0
        awaiting = main["awaiting_putaway"] + sec["awaiting_putaway"]
        position = max(0, main["available"]) + max(0, sec["available"]) + awaiting + i["on_order"]
        line = main["capacity"] * config.REPLENISH_BELOW_PCT / 100
        reorder_point = line + shortfall
        if position >= reorder_point:
            continue
        target = main["capacity"] + shortfall
        qty = _round_up(target - position)
        if qty <= 0:
            continue
        p = {"id": i["product_id"], "category": i["category"]}
        level = "critical" if (waiting_orders or position <= 0) else "warning"
        parts = [f"Only {position} unit{'s' if position != 1 else ''} in total"]
        detail = []
        if main["available"] > 0:
            detail.append(f"{main['available']} in Main")
        if sec["available"] > 0:
            detail.append(f"{sec['available']} in Secondary")
        if awaiting:
            detail.append(f"{awaiting} waiting for put-away")
        if i["on_order"]:
            detail.append(f"{i['on_order']} already on order")
        if detail:
            parts[0] += f" ({', '.join(detail)})"
        parts.append(f"below the reorder point of {math.ceil(reorder_point)}")
        why = " — ".join(parts) + "."
        if waiting_orders:
            why += f" {waiting_orders} order{'s' if waiting_orders != 1 else ''} waiting for {shortfall} unit{'s' if shortfall != 1 else ''}."
        items.append({
            "product_id": i["product_id"], "sku": i["sku"], "name": i["name"], "variant": i["variant"],
            "category": i["category"], "supplier": default_supplier(conn, p),
            "main_bin": main["bin"], "main_capacity": main["capacity"], "main_available": main["available"],
            "secondary_available": sec["available"], "awaiting_putaway": awaiting, "on_order": i["on_order"],
            "waiting_orders": waiting_orders, "waiting_units": shortfall,
            "position": position, "reorder_point": math.ceil(reorder_point), "target": target,
            "suggested_qty": qty, "level": level, "why": why,
        })
    items.sort(key=lambda s: (s["level"] != "critical", -s["waiting_orders"], s["position"] - s["reorder_point"], s["sku"]))
    return {
        "rule": {"below_pct": config.REPLENISH_BELOW_PCT, "round_to": config.REORDER_ROUND_TO,
                 "lead_days": config.REORDER_LEAD_DAYS},
        "count": len(items),
        "critical": sum(1 for s in items if s["level"] == "critical"),
        "units": sum(s["suggested_qty"] for s in items),
        "items": items,
    }


def get_reorder(conn, rid: str) -> dict:
    r = one(conn, "SELECT * FROM reorders WHERE id = ?", (rid,))
    if not r:
        raise NotFound(f"Reorder {rid}")
    r = dict(r)
    lines = all_rows(conn, """SELECT rl.*, p.sku, p.name, p.variant FROM reorder_lines rl
                              JOIN products p ON p.id = rl.product_id WHERE rl.reorder_id = ? ORDER BY rl.id""", (rid,))
    deliveries = all_rows(conn, "SELECT * FROM inbound WHERE reorder_id = ? ORDER BY expected_at, id", (rid,))
    dl_status = {d["id"]: d["status"] for d in deliveries}
    agg = defaultdict(lambda: defaultdict(int))
    for l in all_rows(conn, """SELECT l.* FROM inbound_lines l JOIN inbound i ON i.id = l.inbound_id
                               WHERE i.reorder_id = ?""", (rid,)):
        a = agg[l["reorder_line_id"]]
        st = dl_status.get(l["inbound_id"])
        if st == "expected":
            a["due"] += l["expected_qty"]
        elif st == "cancelled":
            a["not_coming"] += l["expected_qty"]
        elif l["received_qty"] is not None:
            good = l["received_qty"] - l["damaged_qty"]
            a["good"] += good
            a["damaged"] += l["damaged_qty"]
            a["putaway"] += l["putaway_qty"]
            a["awaiting_putaway"] += max(0, good - l["putaway_qty"])
            if l["missing_action"] == "close" or (l["missing_action"] is None and l["received_qty"] < l["expected_qty"]):
                a["not_coming"] += max(0, l["expected_qty"] - l["received_qty"])
    out_lines = []
    for l in lines:
        a = agg[l["id"]]
        arrived = a["good"]
        out_lines.append({
            "id": l["id"], "product_id": l["product_id"], "sku": l["sku"], "name": l["name"], "variant": l["variant"],
            "ordered": l["ordered_qty"], "arrived_ok": arrived, "damaged": a["damaged"],
            "not_coming": a["not_coming"], "still_due": a["due"], "put_away": a["putaway"],
            "awaiting_putaway": a["awaiting_putaway"],
            "outcome": ("due" if a["due"] else "complete" if arrived >= l["ordered_qty"] else
                        "short" if (a["not_coming"] or a["damaged"]) else "complete"),
        })
    tot = {k: sum(x[k] for x in out_lines) for k in ("ordered", "arrived_ok", "damaged", "not_coming", "still_due",
                                                     "put_away", "awaiting_putaway")}
    open_deliveries = [d for d in deliveries if d["status"] == "expected"]
    now = clock.now_iso()
    next_due = min((d["expected_at"] for d in open_deliveries), default=None)
    return {
        **r,
        "status_label": STATUS_LABELS.get(r["status"], r["status"]),
        "warehouse_label": "Main Warehouse" if r["warehouse_id"] == MAIN else "Secondary Warehouse",
        "lines": out_lines,
        "totals": tot,
        "progress_pct": round(tot["arrived_ok"] / tot["ordered"] * 100) if tot["ordered"] else 0,
        "deliveries": [{"id": d["id"], "status": d["status"], "expected_at": d["expected_at"],
                        "received_at": d["received_at"], "received_by": d["received_by"],
                        "source": d.get("source") or "supplier",
                        "overdue": d["status"] == "expected" and d["expected_at"] < now} for d in deliveries],
        "next_due_at": next_due,
        "overdue": bool(next_due and next_due < now),
        "can_cancel": r["status"] == "ordered",
        "can_close": r["status"] == "partly_received",
        "can_edit_date": r["status"] in OPEN,
    }


def list_reorders(conn, status: str | None = None, q: str | None = None) -> dict:
    rows = all_rows(conn, """SELECT id FROM reorders ORDER BY
                             CASE status WHEN 'partly_received' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END,
                             CASE WHEN status IN ('ordered','partly_received') THEN expected_at END ASC,
                             created_at DESC""")
    all_ro = [get_reorder(conn, r["id"]) for r in rows]
    ql = (q or "").strip().lower()
    out = []
    for r in all_ro:
        if status == "open" and r["status"] not in OPEN:
            continue
        if status == "done" and r["status"] in OPEN:
            continue
        if status == "overdue" and not r["overdue"]:
            continue
        if ql and ql not in r["id"].lower() and ql not in r["supplier"].lower() \
                and not any(ql in l["sku"].lower() or ql in l["name"].lower() for l in r["lines"]):
            continue
        out.append(r)
    open_ro = [r for r in all_ro if r["status"] in OPEN]
    return {
        "counts": {
            "open": len(open_ro),
            "overdue": sum(1 for r in open_ro if r["overdue"]),
            "units_due": sum(r["totals"]["still_due"] for r in open_ro),
            "to_put_away": sum(r["totals"]["awaiting_putaway"] for r in all_ro),
            "done": len(all_ro) - len(open_ro),
        },
        "items": out,
    }


def _parse_expected(expected_at: str | None, at: str) -> str:
    if expected_at:
        dt = clock.parse_user_date(expected_at)
        if dt is None:
            raise DomainError("Expected date is not a valid date", code="validation", status=422)
        return clock.iso(dt)
    return clock.iso(clock.parse(at) + timedelta(days=config.REORDER_LEAD_DAYS))


def create_reorder(conn, actor: Actor, supplier: str, lines: list[dict], warehouse_id: str = MAIN,
                   expected_at: str | None = None, note: str = "", at=None) -> dict:
    require_office(actor, "create reorders")
    supplier = (supplier or "").strip()
    if not supplier:
        raise DomainError("Choose a supplier", code="validation", status=422)
    if warehouse_id not in (MAIN, SECONDARY):
        raise DomainError("Unknown warehouse", code="validation", status=422)
    merged: dict[int, int] = {}
    for l in lines:
        qty = int(l.get("qty") or 0)
        if qty <= 0:
            continue
        if qty > 10000:
            raise DomainError(f"{l.get('sku')}: quantity is too large", code="validation", status=422)
        p = inv.product_by_sku(conn, l.get("sku"))
        merged[p["id"]] = merged.get(p["id"], 0) + qty
    if not merged:
        raise DomainError("Add at least one SKU with a quantity", code="validation", status=422)
    at = at or clock.now_iso()
    expected = _parse_expected(expected_at, at)
    rid = next_id(conn, "reorder", "RO-", 4)
    conn.execute("""INSERT INTO reorders(id, supplier, warehouse_id, status, created_at, created_by, expected_at, note)
                    VALUES (?,?,?,?,?,?,?,?)""", (rid, supplier, warehouse_id, "ordered", at, actor.name, expected,
                                                  (note or "").strip() or None))
    iid = inv._new_inbound(conn, supplier=supplier, warehouse_id=warehouse_id, expected_at=expected, source="reorder",
                           reorder_id=rid, note=(note or "").strip() or None)
    for pid, qty in merged.items():
        lid = conn.execute("INSERT INTO reorder_lines(reorder_id, product_id, ordered_qty) VALUES (?,?,?)",
                           (rid, pid, qty)).lastrowid
        conn.execute("INSERT INTO inbound_lines(inbound_id, product_id, expected_qty, reorder_line_id) VALUES (?,?,?,?)",
                     (iid, pid, qty, lid))
    units = sum(merged.values())
    log(conn, actor, "reorder_created",
        f"Reorder {rid} placed with {supplier}: {len(merged)} SKU{'s' if len(merged) != 1 else ''}, {units} units "
        f"→ {'Main' if warehouse_id == MAIN else 'Secondary'} (delivery {iid})", at=at)
    return get_reorder(conn, rid)


def create_from_suggestions(conn, actor: Actor, items: list[dict], warehouse_id: str = MAIN,
                            expected_at: str | None = None, at=None) -> dict:
    """One reorder per supplier for the chosen suggestions."""
    require_office(actor, "create reorders")
    by_supplier: dict[str, list] = defaultdict(list)
    for it in items:
        if int(it.get("qty") or 0) > 0:
            p = inv.product_by_sku(conn, it.get("sku"))
            by_supplier[(it.get("supplier") or "").strip() or default_supplier(conn, p)].append(it)
    if not by_supplier:
        raise DomainError("Tick at least one SKU with a quantity", code="validation", status=422)
    created = [create_reorder(conn, actor, sup, lines, warehouse_id, expected_at,
                              note="From reorder suggestions", at=at)
               for sup, lines in sorted(by_supplier.items())]
    return {"created": [{"id": r["id"], "supplier": r["supplier"], "units": r["totals"]["ordered"]} for r in created]}


def refresh_status(conn, rid: str) -> str:
    r = one(conn, "SELECT status FROM reorders WHERE id = ?", (rid,))
    if not r or r["status"] == "cancelled":
        return r["status"] if r else ""
    ro = get_reorder(conn, rid)
    t = ro["totals"]
    counted = any(d["status"] in ("received", "putaway_done") for d in ro["deliveries"])
    if t["still_due"] > 0:
        status = "partly_received" if counted else "ordered"
    elif t["not_coming"] > 0 or t["arrived_ok"] < t["ordered"]:
        status = "closed_short"
    else:
        status = "received"
    if status != ro["status"]:
        conn.execute("UPDATE reorders SET status = ?, closed_at = CASE WHEN ? IN ('received','closed_short') "
                     "THEN COALESCE(closed_at, ?) ELSE NULL END WHERE id = ?", (status, status, clock.now_iso(), rid))
    return status


def update_expected(conn, actor: Actor, rid: str, expected_at: str) -> dict:
    require_office(actor, "change reorders")
    ro = get_reorder(conn, rid)
    if not ro["can_edit_date"]:
        raise DomainError(f"Reorder {rid} is {ro['status_label'].lower()} — nothing is still due")
    new = _parse_expected(expected_at, clock.now_iso())
    conn.execute("UPDATE reorders SET expected_at = ? WHERE id = ?", (new, rid))
    conn.execute("UPDATE inbound SET expected_at = ? WHERE reorder_id = ? AND status = 'expected'", (new, rid))
    log(conn, actor, "reorder_rescheduled", f"Reorder {rid}: expected delivery moved to "
        f"{clock.fmt_local(clock.parse(new))}")
    return get_reorder(conn, rid)


def cancel_reorder(conn, actor: Actor, rid: str, reason: str) -> dict:
    require_office(actor, "cancel reorders")
    if not (reason or "").strip():
        raise DomainError("Give a reason for cancelling", code="validation", status=422)
    ro = get_reorder(conn, rid)
    if ro["status"] == "cancelled":
        return ro
    if not ro["can_cancel"]:
        raise DomainError("Part of this reorder has already arrived. Use “Close — rest not coming” instead.")
    conn.execute("UPDATE inbound SET status = 'cancelled' WHERE reorder_id = ? AND status = 'expected'", (rid,))
    conn.execute("UPDATE reorders SET status='cancelled', closed_at=?, closed_by=?, close_reason=? WHERE id=?",
                 (clock.now_iso(), actor.name, reason.strip(), rid))
    log(conn, actor, "reorder_cancelled", f"Reorder {rid} cancelled. Reason: {reason.strip()}")
    return get_reorder(conn, rid)


def close_reorder(conn, actor: Actor, rid: str, reason: str) -> dict:
    """Part arrived and the supplier won't send the rest: cancel the open deliveries."""
    require_office(actor, "close reorders")
    if not (reason or "").strip():
        raise DomainError("Give a reason for closing", code="validation", status=422)
    ro = get_reorder(conn, rid)
    if not ro["can_close"]:
        raise DomainError(f"Reorder {rid} is {ro['status_label'].lower()} — nothing is still due")
    due = ro["totals"]["still_due"]
    conn.execute("UPDATE inbound SET status = 'cancelled' WHERE reorder_id = ? AND status = 'expected'", (rid,))
    conn.execute("UPDATE reorders SET closed_by=?, close_reason=? WHERE id=?", (actor.name, reason.strip(), rid))
    refresh_status(conn, rid)
    log(conn, actor, "reorder_closed", f"Reorder {rid} closed — {due} unit{'s' if due != 1 else ''} not coming. "
        f"Reason: {reason.strip()}")
    return get_reorder(conn, rid)


def suppliers(conn) -> list[str]:
    names = {r["supplier"] for r in all_rows(conn, "SELECT DISTINCT supplier FROM inbound WHERE source != 'manual'")}
    names |= set(config.SUPPLIER_BY_CATEGORY.values())
    return sorted(names)
