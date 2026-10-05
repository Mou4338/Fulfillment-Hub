"""Inventory, transfers between warehouses, and inbound receiving."""
from typing import Optional

from fastapi import APIRouter, Depends

from ..deps import get_actor, get_db
from ..schemas import (AdjustIn, ArrivalIn, CapacityIn, CorrectCountIn, PutawayIn, ReasonIn, ReceiveIn, ReorderBulkIn,
                       ReorderDateIn, ReorderIn, ReplenishIn, TransferIn)
from ..services import inventory as svc, reorders as ro_svc
from ..services.common import Actor

router = APIRouter(prefix="/api", tags=["inventory"])


@router.get("/inventory")
def list_inventory(q: Optional[str] = None, view: Optional[str] = None, sort: Optional[str] = None,
                   conn=Depends(get_db)):
    return svc.list_inventory(conn, q=q, view=view, sort=sort)


@router.get("/inventory/bins")
def bin_map(warehouse: str = "MAIN", conn=Depends(get_db)):
    """Every bin in walking order (aisle → bay → level) with stock and fill level."""
    return svc.bin_map(conn, warehouse.upper())


@router.get("/inventory/replenishment")
def replenishment(conn=Depends(get_db)):
    """SKUs whose available stock in Main is below half of the bin's capacity (preventive transfers)."""
    return svc.replenishment(conn)


@router.post("/inventory/replenish")
def replenish(body: ReplenishIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.create_replenishment_transfers(conn, actor, body.skus)


@router.post("/inventory/capacity")
def set_capacity(body: CapacityIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.set_capacity(conn, actor, body.sku, body.warehouse_id, body.capacity)


@router.get("/inventory/shortages")
def shortages(conn=Depends(get_db)):
    return svc.shortages(conn)


@router.post("/inventory/adjust")
def adjust(body: AdjustIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.adjust_stock(conn, actor, body.sku, body.warehouse_id, body.on_hand, body.reason)


@router.get("/transfers")
def transfers(conn=Depends(get_db)):
    return svc.list_transfers(conn)


@router.post("/transfers")
def create_transfer(body: TransferIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.create_transfer(conn, actor, body.sku, body.qty, body.note)


@router.post("/transfers/{transfer_id}/dispatch")
def dispatch_transfer(transfer_id: str, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.dispatch_transfer(conn, actor, transfer_id)


@router.post("/transfers/{transfer_id}/receive")
def receive_transfer(transfer_id: str, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.receive_transfer(conn, actor, transfer_id)


@router.post("/transfers/{transfer_id}/cancel")
def cancel_transfer(transfer_id: str, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.cancel_transfer(conn, actor, transfer_id)


@router.get("/inbound")
def list_inbound(conn=Depends(get_db)):
    return svc.list_inbound(conn)


@router.post("/inbound/{inbound_id}/receive")
def receive_inbound(inbound_id: str, body: ReceiveIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.receive_inbound(conn, actor, inbound_id, [l.model_dump() for l in body.lines],
                               missing_action=body.missing_action, replace_damaged=body.replace_damaged,
                               backorder_expected_at=body.backorder_expected_at, putaway_now=body.putaway_now)


@router.post("/inbound/arrival")
def record_arrival(body: ArrivalIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    """Stock that arrived without an expected delivery — counted and recorded on arrival."""
    return svc.record_arrival(conn, actor, body.supplier, body.warehouse_id.upper(),
                              [l.model_dump() for l in body.lines], body.note, body.putaway_now)


@router.post("/inbound/{inbound_id}/putaway-all")
def putaway_all(inbound_id: str, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.putaway_all(conn, actor, inbound_id)


@router.post("/inbound-lines/{line_id}/correct")
def correct_count(line_id: int, body: CorrectCountIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.correct_count(conn, actor, line_id, body.received_qty, body.damaged_qty, body.reason)


@router.post("/inbound-lines/{line_id}/putaway")
def putaway(line_id: int, body: PutawayIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.putaway_line(conn, actor, line_id, body.bin)


@router.get("/reorders")
def list_reorders(status: Optional[str] = None, q: Optional[str] = None, conn=Depends(get_db)):
    return ro_svc.list_reorders(conn, status, q)


@router.get("/reorders/suggestions")
def reorder_suggestions(conn=Depends(get_db)):
    """SKUs whose whole stock position is below the reorder point — buy more from the supplier."""
    return ro_svc.suggestions(conn)


@router.get("/reorders/suppliers")
def reorder_suppliers(conn=Depends(get_db)):
    return ro_svc.suppliers(conn)


@router.post("/reorders")
def create_reorder(body: ReorderIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return ro_svc.create_reorder(conn, actor, body.supplier, [l.model_dump() for l in body.lines],
                                 body.warehouse_id.upper(), body.expected_at, body.note)


@router.post("/reorders/bulk")
def create_reorders_bulk(body: ReorderBulkIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return ro_svc.create_from_suggestions(conn, actor, [i.model_dump() for i in body.items],
                                          body.warehouse_id.upper(), body.expected_at)


@router.get("/reorders/{reorder_id}")
def get_reorder(reorder_id: str, conn=Depends(get_db)):
    return ro_svc.get_reorder(conn, reorder_id)


@router.post("/reorders/{reorder_id}/expected")
def reschedule_reorder(reorder_id: str, body: ReorderDateIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return ro_svc.update_expected(conn, actor, reorder_id, body.expected_at)


@router.post("/reorders/{reorder_id}/cancel")
def cancel_reorder(reorder_id: str, body: ReasonIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return ro_svc.cancel_reorder(conn, actor, reorder_id, body.reason)


@router.post("/reorders/{reorder_id}/close")
def close_reorder(reorder_id: str, body: ReasonIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return ro_svc.close_reorder(conn, actor, reorder_id, body.reason)
