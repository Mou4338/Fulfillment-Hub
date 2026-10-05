"""Warehouse workflows: picking, packing, staging and courier handover."""
from typing import Optional

from fastapi import APIRouter, Depends

from ..deps import get_actor, get_db
from ..schemas import CourierArrivalIn, CompletePackIn, HandoverIn, HandoverModeIn, PickActionIn, PickProblemIn, ScanIn, StageIn
from ..services import dispatch, packing, picking
from ..services import orders as orders_svc
from ..services.common import Actor

router = APIRouter(prefix="/api", tags=["warehouse"])


@router.get("/picking/queue")
def pick_queue(conn=Depends(get_db)):
    return picking.pick_queue(conn)


@router.get("/picking/{order_id}")
def pick_detail(order_id: str, conn=Depends(get_db)):
    return picking.pick_detail(conn, order_id)


@router.post("/picking/{order_id}/start")
def start_picking(order_id: str, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    picking.start_picking(conn, actor, order_id)
    return picking.pick_detail(conn, order_id)


@router.post("/order-items/{item_id}/pick")
def pick_item(item_id: int, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    r = picking.pick_item(conn, actor, item_id)
    return {"already": r["already"], "order": picking.pick_detail(conn, r["order"]["id"])}


@router.post("/order-items/{item_id}/problem")
def report_problem(item_id: int, body: PickProblemIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    issue = picking.report_problem(conn, actor, item_id, body.kind, body.note)
    return {"issue_id": issue["id"], "order": picking.pick_detail(conn, issue["order_id"])}


@router.post("/issues/{issue_id}/pick-action")
def pick_action(issue_id: str, body: PickActionIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    from ..services import issues as issues_svc
    picking.resolve_pick_problem(conn, actor, issue_id, body.action, substitute_sku=body.substitute_sku, note=body.note)
    return issues_svc.serialize_issue(conn, issues_svc.get_issue_row(conn, issue_id), with_timeline=True)


@router.get("/packing/queue")
def pack_queue(conn=Depends(get_db)):
    return packing.pack_queue(conn)


@router.get("/packing/{order_id}")
def pack_detail(order_id: str, conn=Depends(get_db)):
    return packing.pack_detail(conn, order_id)


@router.post("/packing/{order_id}/scan")
def scan(order_id: str, body: ScanIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    result = packing.scan_item(conn, actor, order_id, body.code)
    return {"result": result, "order": packing.pack_detail(conn, order_id)}


@router.post("/packing/{order_id}/reset")
def reset_scans(order_id: str, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    packing.reset_scans(conn, actor, order_id)
    return packing.pack_detail(conn, order_id)


@router.post("/packing/{order_id}/complete")
def complete(order_id: str, body: CompletePackIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    r = packing.complete_packing(conn, actor, order_id, package_type=body.package_type, weight_kg=body.weight_kg,
                                 label_code=body.label_code, confirm_weight=body.confirm_weight)
    return {"ok": r["ok"], "message": r.get("message"), "package": r.get("package"),
            "order": orders_svc.order_detail(conn, order_id)}


@router.get("/staging")
def staging(conn=Depends(get_db)):
    """Staging page: parcels still to place (with a suggested area) and every staging area."""
    dispatch.sweep(conn)
    return dispatch.staging_board(conn)


@router.get("/staging/areas")
def staging_areas(conn=Depends(get_db)):
    return dispatch.areas(conn)


@router.get("/handover")
def handover_board(conn=Depends(get_db)):
    """Ready to hand over: per courier, what can leave now, what can't (and why), mode and arrival."""
    dispatch.sweep(conn)
    return dispatch.handover_board(conn)


@router.get("/shipped")
def shipped(range: str = "today", courier: Optional[str] = None, q: Optional[str] = None, conn=Depends(get_db)):
    dispatch.sweep(conn)
    return dispatch.shipped(conn, range, courier, q)


@router.post("/couriers/{courier_id}/arrived")
def courier_arrived(courier_id: str, body: CourierArrivalIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return dispatch.courier_arrived(conn, actor, courier_id, body.package_ids)


@router.post("/couriers/{courier_id}/handover-mode")
def handover_mode(courier_id: str, body: HandoverModeIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return dispatch.set_handover_mode(conn, actor, courier_id, body.mode)


@router.get("/packages/find")
def find_package(q: str = "", conn=Depends(get_db)):
    return dispatch.find_package(conn, q)


@router.post("/packages/{package_id}/stage")
def stage(package_id: str, body: StageIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return dispatch.stage_package(conn, actor, package_id, body.location, confirm_other_lane=body.confirm_other_lane)


@router.post("/handover")
def handover(body: HandoverIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return dispatch.handover(conn, actor, body.courier_id, body.package_ids)


@router.get("/manifests/{manifest_id}")
def manifest(manifest_id: str, conn=Depends(get_db)):
    return dispatch.get_manifest(conn, manifest_id)
