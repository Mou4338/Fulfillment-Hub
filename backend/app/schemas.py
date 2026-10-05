"""Typed request bodies. FastAPI validates these and returns 422 with field errors automatically."""
from typing import Optional

from pydantic import BaseModel, Field


class ProcessOrderIn(BaseModel):
    courier_id: Optional[str] = None


class NoteIn(BaseModel):
    note: str = Field(default="", max_length=500)


class SessionIn(BaseModel):
    previous: Optional[str] = Field(default=None, max_length=60)


class CancelIn(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


class CourierIn(BaseModel):
    courier_id: str


class OrderItemIn(BaseModel):
    sku: str
    qty: int = Field(ge=1, le=100)


class CreateOrderIn(BaseModel):
    channel: str = "Website"
    channel_ref: str
    customer_name: str = Field(min_length=1)
    phone: str = ""
    address: str = ""
    city: str = ""
    pincode: str = ""
    priority: bool = False
    items: list[OrderItemIn] = Field(min_length=1)


class PickProblemIn(BaseModel):
    kind: str
    note: str = ""


class ScanIn(BaseModel):
    code: str


class CompletePackIn(BaseModel):
    package_type: str
    weight_kg: float = Field(gt=0, le=100)
    label_code: str
    confirm_weight: bool = False


class StageIn(BaseModel):
    location: str
    confirm_other_lane: bool = False


class CourierArrivalIn(BaseModel):
    package_ids: Optional[list[str]] = None


class HandoverModeIn(BaseModel):
    mode: str


class HandoverIn(BaseModel):
    courier_id: str
    package_ids: list[str] = Field(min_length=1)


class TransferIn(BaseModel):
    sku: str
    qty: int = Field(ge=1, le=10000)
    note: str = ""


class AdjustIn(BaseModel):
    sku: str
    warehouse_id: str
    on_hand: int = Field(ge=0)
    reason: str


class CapacityIn(BaseModel):
    sku: str
    warehouse_id: str = "MAIN"
    capacity: int = Field(ge=1, le=10000)


class ReplenishIn(BaseModel):
    skus: Optional[list[str]] = None


class ProcessBatchIn(BaseModel):
    order_ids: Optional[list[str]] = None
    count: Optional[int] = Field(default=None, ge=1, le=200)


class ReceiveLineIn(BaseModel):
    line_id: int
    received_qty: int = Field(ge=0)
    damaged_qty: int = Field(default=0, ge=0)


class ReceiveIn(BaseModel):
    lines: list[ReceiveLineIn]
    missing_action: str = "close"
    replace_damaged: bool = False
    backorder_expected_at: Optional[str] = None
    putaway_now: bool = False


class CorrectCountIn(BaseModel):
    received_qty: int = Field(ge=0)
    damaged_qty: int = Field(default=0, ge=0)
    reason: str = Field(min_length=1, max_length=300)


class ArrivalLineIn(BaseModel):
    sku: str
    received_qty: int = Field(ge=0, le=10000)
    damaged_qty: int = Field(default=0, ge=0)


class ArrivalIn(BaseModel):
    supplier: str = Field(min_length=1, max_length=120)
    warehouse_id: str = "MAIN"
    note: str = Field(default="", max_length=300)
    putaway_now: bool = False
    lines: list[ArrivalLineIn] = Field(min_length=1)


class ReorderLineIn(BaseModel):
    sku: str
    qty: int = Field(ge=0, le=10000)
    supplier: Optional[str] = None


class ReorderIn(BaseModel):
    supplier: str = Field(min_length=1, max_length=120)
    warehouse_id: str = "MAIN"
    expected_at: Optional[str] = None
    note: str = Field(default="", max_length=300)
    lines: list[ReorderLineIn] = Field(min_length=1)


class ReorderBulkIn(BaseModel):
    items: list[ReorderLineIn] = Field(min_length=1)
    warehouse_id: str = "MAIN"
    expected_at: Optional[str] = None


class ReorderDateIn(BaseModel):
    expected_at: str


class ReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


class PutawayIn(BaseModel):
    bin: Optional[str] = None


class IssueCreateIn(BaseModel):
    type: str
    severity: str = "Medium"
    title: str = Field(min_length=3, max_length=200)
    description: str = ""
    order_id: Optional[str] = None
    package_id: Optional[str] = None
    sku: Optional[str] = None
    assignee: Optional[str] = None
    blocking: bool = False


class IssueUpdateIn(BaseModel):
    status: Optional[str] = None
    assignee: Optional[str] = None
    severity: Optional[str] = None


class ResolveIn(BaseModel):
    resolution: str


class PickActionIn(BaseModel):
    action: str
    substitute_sku: Optional[str] = None
    note: str = ""
