"""Shared building blocks for the service layer: errors, actors, IDs, activity log."""
import json
from dataclasses import dataclass

from .. import clock
from ..db import one, scalar

RECEIVED = "RECEIVED"
ON_HOLD = "ON_HOLD"
AWAITING_STOCK = "AWAITING_STOCK"
READY_TO_PICK = "READY_TO_PICK"
PICKING = "PICKING"
READY_TO_PACK = "READY_TO_PACK"
PACKED = "PACKED"
STAGED = "STAGED"
SHIPPED = "SHIPPED"
CANCELLED = "CANCELLED"

OPEN_STATUSES = [RECEIVED, ON_HOLD, AWAITING_STOCK, READY_TO_PICK, PICKING, READY_TO_PACK, PACKED, STAGED]

STATUS_LABELS = {
    RECEIVED: "Received",
    ON_HOLD: "On hold",
    AWAITING_STOCK: "Waiting for stock",
    READY_TO_PICK: "Ready to pick",
    PICKING: "Picking",
    READY_TO_PACK: "Ready to pack",
    PACKED: "Packed",
    STAGED: "Staged",
    SHIPPED: "Shipped",
    CANCELLED: "Cancelled",
}

STAGES = [
    ("received", "Received", [RECEIVED, ON_HOLD]),
    ("processed", "Processed", [AWAITING_STOCK, READY_TO_PICK]),
    ("picking", "Picking", [PICKING]),
    ("packing", "Packing", [READY_TO_PACK]),
    ("staging", "Staging", [PACKED, STAGED]),
    ("shipped", "Shipped", [SHIPPED]),
]
STATUS_TO_STAGE = {s: key for key, _, sts in STAGES for s in sts}

MAIN = "MAIN"
SECONDARY = "SEC"

ISSUE_TYPES = [
    "Stock Not Found", "Damaged Item", "Inventory Mismatch", "Receiving Shortage",
    "Wrong SKU", "Wrong Variant", "Label Mismatch", "Weight Mismatch",
    "Address Problem", "Duplicate Order", "Unusual Order", "Return to Shelf",
    "Picking Delay", "Packing Problem", "Staging Problem", "Courier Delay", "Missed Pickup", "Other",
]
INVENTORY_ISSUE_TYPES = ["Stock Not Found", "Damaged Item", "Inventory Mismatch", "Receiving Shortage"]
HOLD_ISSUE_TYPES = ["Address Problem", "Duplicate Order", "Unusual Order"]
SEVERITIES = ["Low", "Medium", "High", "Critical"]
SEVERITY_RANK = {s: i for i, s in enumerate(SEVERITIES)}
ISSUE_STATUSES = ["Open", "In Progress", "Resolved"]


class DomainError(Exception):
    """A business rule said no. Carries a plain-language message for the UI."""

    def __init__(self, message: str, code: str = "rule_violation", status: int = 409, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.details = details or {}


class NotFound(DomainError):
    def __init__(self, what: str):
        super().__init__(f"{what} was not found", code="not_found", status=404)


@dataclass
class Actor:
    name: str = "Priya (Office)"
    role: str = "office"

    @property
    def is_office(self) -> bool:
        return self.role == "office"


SYSTEM = Actor("System", "system")


def require_office(actor: Actor, action: str) -> None:
    if actor.role not in ("office", "system"):
        raise DomainError(f"Only the office team can {action}. Switch to the Office Operator role.",
                          code="forbidden", status=403)


def next_id(conn, name: str, prefix: str, width: int = 4, start: int = 1) -> str:
    row = one(conn, "SELECT value FROM counters WHERE name = ?", (name,))
    if row is None:
        value = start
        conn.execute("INSERT INTO counters(name, value) VALUES (?, ?)", (name, value))
    else:
        value = row["value"] + 1
        conn.execute("UPDATE counters SET value = ? WHERE name = ?", (value, name))
    return f"{prefix}{str(value).zfill(width)}"


def log(conn, actor: Actor, action: str, message: str, *, order_id=None, package_id=None,
        issue_id=None, product_id=None, at: str | None = None) -> None:
    conn.execute(
        "INSERT INTO activity(at, actor, role, action, message, order_id, package_id, issue_id, product_id)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (at or clock.now_iso(), actor.name, actor.role, action, message, order_id, package_id, issue_id, product_id),
    )


def get_meta(conn, key: str, default=None):
    v = scalar(conn, "SELECT value FROM meta WHERE key = ?", (key,))
    return default if v is None else v


def set_meta(conn, key: str, value: str) -> None:
    conn.execute("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (key, value))


def dumps(obj) -> str:
    return json.dumps(obj, separators=(",", ":"))


def loads(s):
    return json.loads(s) if s else None


def fmt_minutes(mins: float) -> str:
    """'2h 15m', '45m', '3d 4h'."""
    m = int(abs(mins))
    d, rem = divmod(m, 1440)
    h, mm = divmod(rem, 60)
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {mm}m"
    return f"{mm}m"
