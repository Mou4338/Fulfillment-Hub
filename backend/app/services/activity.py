"""Activity records: a searchable, filterable record of every action every person (and the system) took.

Every write in the service layer already calls `common.log(...)`, so this module only reads the
`activity` table: filters, per-person summaries, labels and categories for the UI.
"""
from datetime import datetime, time, timedelta

from .. import clock
from ..db import all_rows, scalar
from .common import Actor, log

CATEGORIES = [
    {"key": "orders", "label": "Orders & processing"},
    {"key": "picking", "label": "Picking"},
    {"key": "packing", "label": "Packing"},
    {"key": "dispatch", "label": "Staging & handover"},
    {"key": "stock", "label": "Stock & transfers"},
    {"key": "receiving", "label": "Receiving & reorders"},
    {"key": "issues", "label": "Issues"},
    {"key": "team", "label": "Team & system"},
]
CATEGORY_KEYS = {c["key"] for c in CATEGORIES}

ACTIONS: dict[str, tuple[str, str]] = {
    "processed": ("orders", "Order processed"),
    "stock_reserved": ("orders", "Stock reserved"),
    "awaiting_stock": ("orders", "Waiting for stock"),
    "on_hold": ("orders", "Put on hold"),
    "hold_released": ("orders", "Hold released"),
    "unblocked": ("orders", "Order unblocked"),
    "cancelled": ("orders", "Order cancelled"),
    "courier_changed": ("orders", "Courier changed"),
    "replanned": ("orders", "Order re-planned"),
    "substituted": ("orders", "Item substituted"),
    "backorder_created": ("orders", "Backorder created"),
    "picking_started": ("picking", "Picking started"),
    "item_picked": ("picking", "Item picked"),
    "picking_completed": ("picking", "Picking completed"),
    "pick_problem": ("picking", "Pick problem reported"),
    "pick_resumed": ("picking", "Picking resumed"),
    "returned_to_shelf": ("picking", "Returned to shelf"),
    "item_verified": ("packing", "Item scanned OK"),
    "scan_failed": ("packing", "Wrong item scanned"),
    "scans_reset": ("packing", "Scans reset"),
    "label_failed": ("packing", "Wrong label scanned"),
    "packed": ("packing", "Parcel packed"),
    "staged": ("dispatch", "Parcel staged"),
    "moved": ("dispatch", "Parcel moved"),
    "restage_needed": ("dispatch", "Needs re-staging"),
    "courier_arrived": ("dispatch", "Courier arrived"),
    "handed_over": ("dispatch", "Handed to courier"),
    "manifest": ("dispatch", "Manifest created"),
    "handover_mode": ("dispatch", "Handover mode changed"),
    "pickup_rolled": ("dispatch", "Pickup moved to next slot"),
    "stock_adjusted": ("stock", "Stock adjusted"),
    "capacity_changed": ("stock", "Bin capacity changed"),
    "transfer_requested": ("stock", "Transfer requested"),
    "transfer_dispatched": ("stock", "Transfer sent"),
    "transfer_received": ("stock", "Transfer received"),
    "transfer_cancelled": ("stock", "Transfer cancelled"),
    "delivery_received": ("receiving", "Delivery counted"),
    "received": ("receiving", "Stock received"),
    "arrival_recorded": ("receiving", "Unexpected arrival logged"),
    "putaway": ("receiving", "Put away"),
    "count_corrected": ("receiving", "Count corrected"),
    "reorder_created": ("receiving", "Reorder placed"),
    "reorder_rescheduled": ("receiving", "Reorder date changed"),
    "reorder_cancelled": ("receiving", "Reorder cancelled"),
    "reorder_closed": ("receiving", "Reorder closed short"),
    "issue_created": ("issues", "Issue raised"),
    "issue_assigned": ("issues", "Issue assigned"),
    "issue_status": ("issues", "Issue status changed"),
    "issue_severity": ("issues", "Issue severity changed"),
    "issue_resolved": ("issues", "Issue resolved"),
    "shift_note": ("team", "Shift note saved"),
    "role_switched": ("team", "Signed in"),
    "demo_reset": ("team", "Demo data reset"),
}


def describe(action: str) -> tuple[str, str]:
    """(category, label) for any action — unknown actions still get a readable label."""
    if action in ACTIONS:
        return ACTIONS[action]
    return "team", action.replace("_", " ").capitalize()


def _actions_in(category: str) -> list[str]:
    return [a for a, (c, _) in ACTIONS.items() if c == category]


def _day_bounds_utc(day: str) -> tuple[str, str] | None:
    """'2026-09-27' (a local business day) -> [start, end) as UTC ISO strings."""
    try:
        d = datetime.fromisoformat(day[:10]).date()
    except ValueError:
        return None
    start = datetime.combine(d, time(0, 0), tzinfo=clock.TZ)
    return clock.iso(start), clock.iso(start + timedelta(days=1))


def _where(*, actor=None, role=None, category=None, action=None, q=None, date_from=None, date_to=None,
           order_id=None, issue_id=None, package_id=None):
    where, params = [], []
    if actor:
        where.append("actor = ?"); params.append(actor)
    if role:
        where.append("role = ?"); params.append(role)
    if action:
        where.append("action = ?"); params.append(action)
    if category and category in CATEGORY_KEYS:
        acts = _actions_in(category)
        if category == "team":
            known = list(ACTIONS)
            where.append(f"(action IN ({','.join('?' * len(acts))}) OR action NOT IN ({','.join('?' * len(known))}))")
            params += acts + known
        else:
            where.append(f"action IN ({','.join('?' * len(acts))})"); params += acts
    if date_from:
        b = _day_bounds_utc(date_from)
        if b:
            where.append("at >= ?"); params.append(b[0])
    if date_to:
        b = _day_bounds_utc(date_to)
        if b:
            where.append("at < ?"); params.append(b[1])
    for col, val in (("order_id", order_id), ("issue_id", issue_id), ("package_id", package_id)):
        if val:
            where.append(f"{col} = ?"); params.append(val)
    if q:
        like = f"%{q.strip()}%"
        where.append("(message LIKE ? OR actor LIKE ? OR action LIKE ? OR IFNULL(order_id,'') LIKE ?"
                     " OR IFNULL(package_id,'') LIKE ? OR IFNULL(issue_id,'') LIKE ?)")
        params += [like] * 6
    return (" WHERE " + " AND ".join(where)) if where else "", params


def _decorate(row: dict) -> dict:
    cat, label = describe(row["action"])
    row["category"] = cat
    row["label"] = label
    return row


def records(conn, *, limit: int = 100, offset: int = 0, **filters) -> dict:
    limit = max(1, min(int(limit), 1000))
    offset = max(0, int(offset))
    where, params = _where(**filters)
    total = scalar(conn, f"SELECT COUNT(*) FROM activity{where}", params) or 0
    rows = all_rows(conn, f"SELECT * FROM activity{where} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?",
                    params + [limit, offset])
    f2 = {k: v for k, v in filters.items() if k != "category"}
    w2, p2 = _where(**f2)
    by_action = all_rows(conn, f"SELECT action, COUNT(*) AS n FROM activity{w2} GROUP BY action", p2)
    cat_counts = {c["key"]: 0 for c in CATEGORIES}
    for r in by_action:
        cat_counts[describe(r["action"])[0]] += r["n"]
    return {
        "items": [_decorate(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(rows) < total,
        "categories": [{**c, "count": cat_counts[c["key"]]} for c in CATEGORIES],
    }


def people(conn) -> list[dict]:
    """One card per person: total actions, actions today, last action, busiest area."""
    today = _day_bounds_utc(clock.local(clock.now()).date().isoformat())
    rows = all_rows(
        conn,
        "SELECT actor, role, COUNT(*) AS total, SUM(CASE WHEN at >= ? AND at < ? THEN 1 ELSE 0 END) AS today,"
        " MAX(at) AS last_at FROM activity GROUP BY actor, role ORDER BY (role = 'system'), last_at DESC",
        today,
    )
    out = []
    for r in rows:
        last = conn.execute("SELECT action, message, at FROM activity WHERE actor = ? AND role = ?"
                            " ORDER BY at DESC, id DESC LIMIT 1", (r["actor"], r["role"])).fetchone()
        acts = all_rows(conn, "SELECT action, COUNT(*) AS n FROM activity WHERE actor = ? AND role = ? GROUP BY action",
                        (r["actor"], r["role"]))
        per_cat: dict[str, int] = {}
        for a in acts:
            c = describe(a["action"])[0]
            per_cat[c] = per_cat.get(c, 0) + a["n"]
        top = max(per_cat.items(), key=lambda kv: kv[1])[0] if per_cat else None
        out.append({
            **r,
            "today": r["today"] or 0,
            "last": _decorate(dict(last)) if last else None,
            "top_category": top,
            "by_category": per_cat,
        })
    return out


def actions_catalog() -> list[dict]:
    return [{"action": a, "category": c, "label": l} for a, (c, l) in ACTIONS.items()]


def record_session(conn, actor: Actor, previous: str | None = None) -> dict:
    """The demo has no passwords; switching person is the 'sign in', so it goes on the record too."""
    msg = f"{actor.name} started working" + (f" (switched from {previous})" if previous and previous != actor.name else "")
    log(conn, actor, "role_switched", msg)
    return {"ok": True}
