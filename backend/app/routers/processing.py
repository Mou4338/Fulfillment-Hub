"""Processing desk: new orders handled in queue order (priority → ship-by → first received)."""
from fastapi import APIRouter, Depends

from ..deps import get_actor, get_db
from ..schemas import ProcessBatchIn
from ..services import processing as svc
from ..services.common import Actor

router = APIRouter(prefix="/api/processing", tags=["processing"])


@router.get("")
def processing_board(conn=Depends(get_db)):
    return svc.board(conn)


@router.post("/batch")
def process_batch(body: ProcessBatchIn, conn=Depends(get_db), actor: Actor = Depends(get_actor)):
    return svc.process_batch(conn, actor, order_ids=body.order_ids, count=body.count)
