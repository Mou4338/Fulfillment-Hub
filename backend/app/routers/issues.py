from typing import Optional

from fastapi import APIRouter, Depends

from ..deps import get_actor, get_db
from ..schemas import IssueCreateIn, IssueUpdateIn, ResolveIn
from ..services import issues as svc
from ..services import inventory as inv
from ..services.common import Actor

router = APIRouter(prefix="/api/issues", tags=["issues"])


@router.get("")
def list_issues(status: Optional[str] = None, type: Optional[str] = None, severity: Optional[str] = None,
                q: Optional[str] = None, order_id: Optional[str] = None, conn=Depends(get_db)):
    return svc.list_issues(conn, status=status, type=type, severity=severity, q=q, order_id=order_id)


@router.get("/{issue_id}")
def get_issue(issue_id: str, conn=Depends(get_db)):
    return svc.serialize_issue(conn, svc.get_issue_row(conn, issue_id), with_timeline=True)


@router.post("")
def create_issue(body: IssueCreateIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    from ..services import orders as orders_svc
    product_id = inv.product_by_sku(conn, body.sku)["id"] if body.sku else None
    order_id = orders_svc.get_order_row(conn, body.order_id)["id"] if body.order_id else None
    package_id = None
    if body.package_id and body.package_id.strip():
        from ..services import dispatch
        package_id = dispatch.get_package(conn, body.package_id)["id"]
    issue = svc.create_issue(conn, actor, type=body.type, severity=body.severity, title=body.title,
                             description=body.description, order_id=order_id, package_id=package_id,
                             product_id=product_id, assignee=body.assignee, blocking=body.blocking)
    return svc.serialize_issue(conn, issue, with_timeline=True)


@router.patch("/{issue_id}")
def update_issue(issue_id: str, body: IssueUpdateIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    issue = svc.update_issue(conn, actor, issue_id, status=body.status, assignee=body.assignee, severity=body.severity)
    return svc.serialize_issue(conn, issue, with_timeline=True)


@router.post("/{issue_id}/resolve")
def resolve(issue_id: str, body: ResolveIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    svc.resolve_issue(conn, actor, issue_id, body.resolution)
    return svc.serialize_issue(conn, svc.get_issue_row(conn, issue_id), with_timeline=True)
