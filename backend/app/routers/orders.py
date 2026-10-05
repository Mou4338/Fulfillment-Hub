from typing import Optional

from fastapi import APIRouter, Depends

from ..deps import get_actor, get_db
from ..schemas import CancelIn, CourierIn, CreateOrderIn, NoteIn, ProcessOrderIn
from ..services import orders as svc
from ..services.common import Actor

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.get("")
def list_orders(q: Optional[str] = None, stage: Optional[str] = None, status: Optional[str] = None,
                priority: Optional[str] = None, risk: Optional[str] = None, courier: Optional[str] = None,
                channel: Optional[str] = None, has_issue: Optional[str] = None, blocked: Optional[str] = None,
                date_from: Optional[str] = None, date_to: Optional[str] = None, sort: str = "urgency",
                limit: int = 25, offset: int = 0, conn=Depends(get_db)):
    rows = svc.list_orders(conn, q=q, stage=stage, status=status, priority=priority, risk=risk, courier_id=courier,
                           channel=channel, has_issue=has_issue, blocked=blocked, date_from=date_from,
                           date_to=date_to, sort=sort)
    limit = max(1, min(limit, 200))
    return {"total": len(rows), "items": rows[offset:offset + limit]}


@router.post("")
def create_order(body: CreateOrderIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    o = svc.create_order(conn, actor, channel=body.channel, channel_ref=body.channel_ref,
                         customer_name=body.customer_name, phone=body.phone, address=body.address, city=body.city,
                         pincode=body.pincode, priority=body.priority,
                         items=[i.model_dump() for i in body.items])
    return svc.order_detail(conn, o["id"])


@router.get("/{order_id}")
def get_order(order_id: str, conn=Depends(get_db)):
    return svc.order_detail(conn, order_id)


@router.post("/{order_id}/process")
def process(order_id: str, body: ProcessOrderIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    svc.process_order(conn, actor, order_id, body.courier_id)
    return svc.order_detail(conn, order_id)


@router.post("/{order_id}/release-hold")
def release_hold(order_id: str, body: NoteIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    svc.release_hold(conn, actor, order_id, body.note)
    return svc.order_detail(conn, order_id)


@router.post("/{order_id}/cancel")
def cancel(order_id: str, body: CancelIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    svc.cancel_order(conn, actor, order_id, body.reason)
    return svc.order_detail(conn, order_id)


@router.post("/{order_id}/courier")
def change_courier(order_id: str, body: CourierIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    svc.change_courier(conn, actor, order_id, body.courier_id)
    return svc.order_detail(conn, order_id)
