"""Issues: every operational problem becomes a tracked record with its own timeline."""
from .. import clock
from ..db import one, all_rows
from .common import (
    Actor, DomainError, NotFound, ISSUE_TYPES, SEVERITIES, ISSUE_STATUSES, SEVERITY_RANK,
    next_id, log, dumps, loads, require_office,
)


def create_issue(conn, actor: Actor, *, type: str, severity: str, title: str, description: str = "",
                 order_id=None, package_id=None, product_id=None, item_id=None, blocking=False,
                 assignee=None, payload=None, dedupe_key=None, at=None) -> dict:
    if type not in ISSUE_TYPES:
        raise DomainError(f"Unknown issue type '{type}'", code="validation", status=422)
    if severity not in SEVERITIES:
        raise DomainError(f"Unknown severity '{severity}'", code="validation", status=422)
    if not title.strip():
        raise DomainError("Please give the issue a short title", code="validation", status=422)
    if dedupe_key:
        existing = one(conn, "SELECT * FROM issues WHERE dedupe_key = ?", (dedupe_key,))
        if existing:
            return existing
    at = at or clock.now_iso()
    issue_id = next_id(conn, "issue", "ISS-", 4)
    if assignee is None:
        assignee = default_assignee(type)
    conn.execute(
        "INSERT INTO issues(id, type, severity, status, title, description, order_id, package_id, product_id,"
        " item_id, blocking, assignee, created_by, created_at, updated_at, payload, dedupe_key)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (issue_id, type, severity, "Open", title.strip(), description, order_id, package_id, product_id,
         item_id, 1 if blocking else 0, assignee, actor.name, at, at, dumps(payload) if payload else None, dedupe_key),
    )
    log(conn, actor, "issue_created", f"Issue {issue_id} opened: {title}", order_id=order_id,
        package_id=package_id, issue_id=issue_id, product_id=product_id, at=at)
    return get_issue_row(conn, issue_id)


def default_assignee(type: str) -> str:
    if type in ("Stock Not Found", "Damaged Item", "Inventory Mismatch", "Receiving Shortage", "Return to Shelf",
                "Picking Delay", "Staging Problem"):
        return "Warehouse team"
    if type in ("Wrong SKU", "Wrong Variant", "Label Mismatch", "Weight Mismatch", "Packing Problem"):
        return "Packing station"
    return "Office team"


def get_issue_row(conn, issue_id: str) -> dict:
    row = one(conn, "SELECT * FROM issues WHERE id = ?", (issue_id,))
    if not row:
        raise NotFound(f"Issue {issue_id}")
    return row


def update_issue(conn, actor: Actor, issue_id: str, *, status=None, assignee=None, severity=None) -> dict:
    issue = get_issue_row(conn, issue_id)
    if issue["status"] == "Resolved":
        raise DomainError("This issue is already resolved", code="already_resolved")
    now = clock.now_iso()
    if status is not None:
        if status not in ("Open", "In Progress"):
            raise DomainError("Use Resolve to close an issue (a resolution note is required)", code="validation", status=422)
        if status != issue["status"]:
            conn.execute("UPDATE issues SET status = ?, updated_at = ? WHERE id = ?", (status, now, issue_id))
            log(conn, actor, "issue_status", f"{issue_id} marked {status}", issue_id=issue_id, order_id=issue["order_id"])
    if assignee is not None and assignee != issue["assignee"]:
        conn.execute("UPDATE issues SET assignee = ?, updated_at = ? WHERE id = ?", (assignee, now, issue_id))
        log(conn, actor, "issue_assigned", f"{issue_id} assigned to {assignee}", issue_id=issue_id, order_id=issue["order_id"])
    if severity is not None and severity != issue["severity"]:
        if severity not in SEVERITIES:
            raise DomainError(f"Unknown severity '{severity}'", code="validation", status=422)
        conn.execute("UPDATE issues SET severity = ?, updated_at = ? WHERE id = ?", (severity, now, issue_id))
        log(conn, actor, "issue_severity", f"{issue_id} severity changed to {severity}", issue_id=issue_id, order_id=issue["order_id"])
    return get_issue_row(conn, issue_id)


def close_issue(conn, actor: Actor, issue_id: str, resolution: str, at=None) -> dict:
    """Low-level close. Callers are responsible for any side effects."""
    issue = get_issue_row(conn, issue_id)
    if issue["status"] == "Resolved":
        return issue
    at = at or clock.now_iso()
    conn.execute("UPDATE issues SET status='Resolved', resolution=?, resolved_at=?, updated_at=? WHERE id=?",
                 (resolution, at, at, issue_id))
    log(conn, actor, "issue_resolved", f"{issue_id} resolved: {resolution}", issue_id=issue_id,
        order_id=issue["order_id"], package_id=issue["package_id"], product_id=issue["product_id"], at=at)
    return get_issue_row(conn, issue_id)


def resolve_issue(conn, actor: Actor, issue_id: str, resolution: str) -> dict:
    """Resolve from the Issues page. Some issue types carry side effects."""
    from . import inventory, picking

    issue = get_issue_row(conn, issue_id)
    if issue["status"] == "Resolved":
        return issue
    if not resolution or not resolution.strip():
        raise DomainError("Add a short resolution note so the next person knows what was done",
                          code="validation", status=422)
    t = issue["type"]
    if t in ("Stock Not Found", "Damaged Item") and issue["item_id"]:
        return picking.resolve_pick_problem(conn, actor, issue_id, "found", note=resolution)
    if t == "Return to Shelf":
        inventory.restock_returned(conn, actor, issue)
        return close_issue(conn, actor, issue_id, resolution.strip())
    require_office(actor, "resolve issues")
    closed = close_issue(conn, actor, issue_id, resolution.strip())
    if issue["order_id"] and (issue["blocking"] or issue["severity"] == "Critical"):
        from .common import AWAITING_STOCK
        o = one(conn, "SELECT status FROM orders WHERE id = ?", (issue["order_id"],))
        if o and o["status"] == AWAITING_STOCK:
            inventory.allocate_waiting(conn, actor)
    return closed


def auto_resolve(conn, actor: Actor, *, order_id=None, package_id=None, types=None, resolution: str) -> int:
    sql = "SELECT id FROM issues WHERE status != 'Resolved'"
    params: list = []
    if order_id:
        sql += " AND order_id = ?"
        params.append(order_id)
    if package_id:
        sql += " AND package_id = ?"
        params.append(package_id)
    if types:
        sql += f" AND type IN ({','.join('?' * len(types))})"
        params.extend(types)
    ids = [r["id"] for r in all_rows(conn, sql, params)]
    for i in ids:
        close_issue(conn, actor, i, resolution)
    return len(ids)


def open_issues_for_order(conn, order_id: str) -> list[dict]:
    return all_rows(conn, "SELECT * FROM issues WHERE order_id = ? AND status != 'Resolved' ORDER BY created_at", (order_id,))


def blocking_issues_for_order(conn, order_id: str) -> list[dict]:
    return all_rows(conn, "SELECT * FROM issues WHERE order_id = ? AND status != 'Resolved'"
                          " AND (blocking = 1 OR severity = 'Critical') ORDER BY created_at", (order_id,))


def serialize_issue(conn, issue: dict, with_timeline: bool = False) -> dict:
    d = dict(issue)
    d["blocking"] = bool(issue["blocking"])
    d["payload"] = loads(issue["payload"])
    d.pop("dedupe_key", None)
    d["sku"] = None
    d["product_name"] = None
    if issue["product_id"]:
        p = one(conn, "SELECT sku, name, variant FROM products WHERE id = ?", (issue["product_id"],))
        if p:
            d["sku"] = p["sku"]
            d["product_name"] = f"{p['name']} ({p['variant']})"
    d["actions"] = issue_actions(issue)
    if with_timeline:
        d["timeline"] = all_rows(conn, "SELECT at, actor, role, action, message FROM activity WHERE issue_id = ?"
                                       " ORDER BY at, id", (issue["id"],))
    return d


def issue_actions(issue: dict) -> list[dict]:
    """Which one-click actions make sense for this issue (UI renders these as buttons)."""
    if issue["status"] == "Resolved":
        return []
    t = issue["type"]
    if t in ("Stock Not Found", "Damaged Item") and issue["item_id"]:
        acts = [{"key": "found", "label": "Found it on recount" if t == "Stock Not Found" else "Item is fine",
                 "office_only": False}]
        acts.append({"key": "confirm_missing",
                     "label": "Confirm missing & adjust stock" if t == "Stock Not Found" else "Write off damaged unit",
                     "office_only": True})
        acts.append({"key": "substitute", "label": "Substitute variant", "office_only": True})
        acts.append({"key": "cancel_order", "label": "Cancel order", "office_only": True})
        return acts
    return []


def list_issues(conn, *, status=None, type=None, severity=None, q=None, order_id=None) -> list[dict]:
    sql = "SELECT * FROM issues WHERE 1=1"
    params: list = []
    if status == "open":
        sql += " AND status != 'Resolved'"
    elif status:
        sql += " AND status = ?"
        params.append(status)
    if type:
        sql += " AND type = ?"
        params.append(type)
    if severity:
        sql += " AND severity = ?"
        params.append(severity)
    if order_id:
        sql += " AND order_id = ?"
        params.append(order_id)
    if q:
        like = f"%{q.strip()}%"
        sql += " AND (id LIKE ? OR title LIKE ? OR order_id LIKE ? OR package_id LIKE ? OR description LIKE ?)"
        params.extend([like] * 5)
    rows = all_rows(conn, sql, params)
    status_rank = {"Open": 0, "In Progress": 1, "Resolved": 2}
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    rows.sort(key=lambda r: (status_rank.get(r["status"], 3), -SEVERITY_RANK.get(r["severity"], 0)))
    return [serialize_issue(conn, r) for r in rows]
