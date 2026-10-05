"""Operational settings in one place.

Everything a warehouse lead might want to tune lives here instead of being
scattered through the code. Values can be overridden with environment variables
where noted.
"""
import os

BUSINESS_TZ = os.getenv("FH_TZ", "Asia/Kolkata")

DB_PATH = os.getenv("FH_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "fulfillment_hub.db"))

PRIORITY_CUTOFF = "14:00"
NORMAL_CUTOFF = "16:00"
SHIP_BY_TIME = "18:00"

AT_RISK_WINDOW_PRIORITY_MIN = 180
AT_RISK_WINDOW_NORMAL_MIN = 360

PICKUP_ALERT_MIN = 60
MISSED_PICKUP_GRACE_MIN = 15

HIGH_VALUE_THRESHOLD = 25000
MAX_QTY_PER_LINE = 8

WEIGHT_TOLERANCE_PCT = 25
PACKAGE_TYPES = {
    "Mailer bag": {"tare_kg": 0.05, "dims": "30 x 40 cm"},
    "Small box": {"tare_kg": 0.20, "dims": "25 x 20 x 10 cm"},
    "Medium box": {"tare_kg": 0.35, "dims": "35 x 25 x 15 cm"},
    "Large box": {"tare_kg": 0.55, "dims": "45 x 35 x 25 cm"},
}

LANE_CAPACITY = 60
STAGING_AREAS = [
    {"name": "Priority Shelf P-01", "kind": "priority", "capacity": 15,
     "purpose": "Priority parcels for any courier — kept apart so they are handed over first and never buried."},
    {"name": "Dispatch Zone 1", "kind": "overflow", "capacity": 30,
     "purpose": "Overflow for any courier when its lane is full. Parcels are handed over from here like from a lane."},
    {"name": "Dispatch Zone 2", "kind": "overflow", "capacity": 30,
     "purpose": "Second overflow area, used when Dispatch Zone 1 is full."},
    {"name": "Rack B-04", "kind": "hold", "capacity": 20,
     "purpose": "Hold rack — parcels that must NOT go out yet (open issue, re-label, cancelled order). Never handed over "
                "from here; move the parcel back to a lane when it is cleared."},
]
EXTRA_STAGING_LOCATIONS = [a["name"] for a in STAGING_AREAS]

HANDOVER_MODES = ["manual", "on_arrival", "scheduled"]
DEFAULT_HANDOVER_MODE = "manual"
COURIER_ON_SITE_MIN = 45

DEFAULT_BIN_CAPACITY = 60
BIN_CAPACITY_BY_CATEGORY = {
    "Apparel": 60, "Accessories": 60, "Stationery": 60, "Bags": 40, "Home": 40, "Electronics": 40,
    "Footwear": 30, "Fitness": 24,
}
SECONDARY_BIN_CAPACITY = 120
REPLENISH_BELOW_PCT = 50
REPLENISH_CRITICAL_PCT = 25

REORDER_ROUND_TO = 5
REORDER_LEAD_DAYS = 2
BACKORDER_DEFAULT_DAYS = 2
DEFAULT_SUPPLIER = "General Supplier"
SUPPLIER_BY_CATEGORY = {
    "Apparel": "Urban Threads Pvt Ltd", "Accessories": "Urban Threads Pvt Ltd", "Bags": "Urban Threads Pvt Ltd",
    "Footwear": "StepUp Footwear", "Home": "HomeGoods Traders", "Stationery": "PaperWorks Supplies",
    "Electronics": "Sonic Gadgets India", "Fitness": "FitGear Wholesale",
}

PROCESS_BATCH_MAX = 50

BOTTLENECK_MIN_QUEUE = 10
ACTION_QUEUE_LIMIT = 15
