"""Dashboard, search, analytics, shift handover, reference data and demo reset."""
from fastapi import APIRouter, Depends

from .. import clock, config
from ..deps import get_actor, get_db
from ..schemas import NoteIn, SessionIn
from ..services import dashboard as dash
from ..services import activity as activity_svc
from ..services import dispatch
from ..services import orders as orders_svc
from ..services.common import Actor, ISSUE_TYPES, SEVERITIES, STAGES, STATUS_LABELS, get_meta, require_office

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health():
    return {"ok": True, "time": clock.now_iso()}


@router.get("/meta")
def meta(conn=Depends(get_db)):
    return {
        "now": clock.now_iso(),
        "timezone": config.BUSINESS_TZ,
        "couriers": [{"id": c["id"], "name": c["name"], "pickups": c["pickups"], "cost": c["cost_per_parcel"],
                      "delivery": f"{c['delivery_days_min']}–{c['delivery_days_max']} days", "lane": c["staging_lane"]}
                     for c in orders_svc.couriers(conn)],
        "warehouses": conn.execute("SELECT * FROM warehouses").fetchall(),
        "channels": [r["channel"] for r in conn.execute("SELECT DISTINCT channel FROM orders ORDER BY channel").fetchall()],
        "package_types": config.PACKAGE_TYPES,
        "staging_locations": dispatch.staging_locations(conn),
        "issue_types": ISSUE_TYPES,
        "severities": SEVERITIES,
        "statuses": STATUS_LABELS,
        "stages": [{"key": k, "label": l} for k, l, _ in STAGES],
        "thresholds": {"replenish_below_pct": config.REPLENISH_BELOW_PCT,
                       "reorder_round_to": config.REORDER_ROUND_TO, "reorder_lead_days": config.REORDER_LEAD_DAYS,
                       "backorder_default_days": config.BACKORDER_DEFAULT_DAYS,
                       "replenish_critical_pct": config.REPLENISH_CRITICAL_PCT,
                       "high_value_threshold": config.HIGH_VALUE_THRESHOLD,
                       "max_qty_per_line": config.MAX_QTY_PER_LINE,
                       "at_risk_priority_min": config.AT_RISK_WINDOW_PRIORITY_MIN,
                       "at_risk_normal_min": config.AT_RISK_WINDOW_NORMAL_MIN,
                       "priority_cutoff": config.PRIORITY_CUTOFF, "normal_cutoff": config.NORMAL_CUTOFF,
                       "ship_by_time": config.SHIP_BY_TIME, "weight_tolerance_pct": config.WEIGHT_TOLERANCE_PCT,
                       "pickup_alert_min": config.PICKUP_ALERT_MIN,
                       "missed_pickup_grace_min": config.MISSED_PICKUP_GRACE_MIN},
        "demo_order_id": get_meta(conn, "demo_order_id"),
        "seeded_at": get_meta(conn, "seeded_at"),
    }


@router.get("/dashboard")
def dashboard(conn=Depends(get_db)):
    return dash.dashboard(conn)


@router.get("/nav-counts")
def nav_counts(conn=Depends(get_db)):
    """Small badge numbers for the sidebar."""
    n = lambda sql: conn.execute(sql).fetchone()["n"]
    from ..services import inventory as inv, reorders as ro
    return {
        "reorders": ro.suggestions(conn)["count"],
        "processing": n("SELECT COUNT(*) AS n FROM orders WHERE status = 'RECEIVED'"),
        "replenish": inv.replenishment(conn)["transfer_required"],
        "orders_attention": n("SELECT COUNT(*) AS n FROM orders WHERE status IN ('RECEIVED','ON_HOLD')"),
        "picking": n("SELECT COUNT(*) AS n FROM orders WHERE status IN ('READY_TO_PICK','PICKING')"),
        "packing": n("SELECT COUNT(*) AS n FROM orders WHERE status = 'READY_TO_PACK'"),
        "staging": n("SELECT COUNT(*) AS n FROM packages WHERE status = 'packed'"),
        "handover": n("SELECT COUNT(*) AS n FROM packages WHERE status = 'staged'"),
        "receiving": n("SELECT COUNT(*) AS n FROM inbound WHERE status IN ('expected','received')"),
        "issues": n("SELECT COUNT(*) AS n FROM issues WHERE status != 'Resolved'"),
    }


@router.get("/notifications")
def notifications(conn=Depends(get_db)):
    return dash.notifications(conn)


@router.get("/search")
def search(q: str = "", conn=Depends(get_db)):
    return dash.search(conn, q)


@router.get("/analytics")
def analytics(conn=Depends(get_db)):
    return dash.analytics(conn)


@router.get("/activity")
def activity(limit: int = 50, conn=Depends(get_db)):
    limit = max(1, min(limit, 500))
    return conn.execute("SELECT * FROM activity ORDER BY at DESC, id DESC LIMIT ?", (limit,)).fetchall()


@router.get("/activity/records")
def activity_records(limit: int = 100, offset: int = 0, actor: str | None = None, role: str | None = None,
                     category: str | None = None, action: str | None = None, q: str | None = None,
                     date_from: str | None = None, date_to: str | None = None, order_id: str | None = None,
                     issue_id: str | None = None, package_id: str | None = None, conn=Depends(get_db)):
    """Every recorded action, newest first, with filters. Dates are local business days (YYYY-MM-DD)."""
    return activity_svc.records(conn, limit=limit, offset=offset, actor=actor, role=role, category=category,
                                action=action, q=q, date_from=date_from, date_to=date_to, order_id=order_id,
                                issue_id=issue_id, package_id=package_id)


@router.get("/activity/people")
def activity_people(conn=Depends(get_db)):
    """One summary per person who has done anything (plus the system)."""
    return activity_svc.people(conn)


@router.get("/activity/actions")
def activity_actions():
    return {"categories": activity_svc.CATEGORIES, "actions": activity_svc.actions_catalog()}


@router.post("/session")
def session(body: SessionIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    """Called when someone picks a demo person — the closest thing this demo has to signing in."""
    return activity_svc.record_session(conn, actor, body.previous)


@router.get("/shift")
def shift(conn=Depends(get_db)):
    return dash.shift_summary(conn)


@router.post("/shift/notes")
def shift_note(body: NoteIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return dash.save_shift_note(conn, actor, body.note)


@router.post("/demo/reset")
def reset(actor: Actor = Depends(get_actor)):
    """Rebuilds the demo database from the seed script (times are relative to 'now')."""
    from ..seed import reset_database
    require_office(actor, "reset demo data")
    result = reset_database()
    from ..db import connect, transaction
    conn = connect()
    try:
        with transaction(conn):
            activity_svc.log(conn, actor, "demo_reset", f"{actor.name} reset the demo data")
    finally:
        conn.close()
    return result
