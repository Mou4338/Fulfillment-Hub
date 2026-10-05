"""Database access.

Uses Python's built-in sqlite3 with plain, portable SQL. All SQL lives in the
service layer; this module only owns connections, transactions and the schema.
To move to PostgreSQL, replace `connect()` with a psycopg connection (and the
`?` placeholders with `%s`) — the schema below uses standard types.
"""
import os
import sqlite3
from contextlib import contextmanager

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    can_ship INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    sku TEXT UNIQUE NOT NULL,
    base_code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    variant TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    price REAL NOT NULL,
    substitutable INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5
);
CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    bin TEXT NOT NULL,
    on_hand INTEGER NOT NULL DEFAULT 0,
    reserved INTEGER NOT NULL DEFAULT 0,
    awaiting_putaway INTEGER NOT NULL DEFAULT 0,
    capacity INTEGER NOT NULL DEFAULT 0,
    UNIQUE(product_id, warehouse_id),
    CHECK (on_hand >= 0), CHECK (reserved >= 0), CHECK (reserved <= on_hand), CHECK (awaiting_putaway >= 0)
);
CREATE TABLE IF NOT EXISTS couriers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pickup_times TEXT NOT NULL,
    cost_per_parcel REAL NOT NULL,
    delivery_days_min INTEGER NOT NULL,
    delivery_days_max INTEGER NOT NULL,
    staging_lane TEXT NOT NULL,
    handover_mode TEXT NOT NULL DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS courier_visits (
    id TEXT PRIMARY KEY,
    courier_id TEXT NOT NULL REFERENCES couriers(id),
    arrived_at TEXT NOT NULL,
    recorded_by TEXT NOT NULL,
    trigger TEXT NOT NULL,
    manifest_id TEXT,
    parcels INTEGER NOT NULL DEFAULT 0,
    left_behind INTEGER NOT NULL DEFAULT 0,
    note TEXT
);
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    channel_ref TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    city TEXT,
    pincode TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    received_at TEXT NOT NULL,
    ship_by TEXT NOT NULL,
    after_cutoff INTEGER NOT NULL DEFAULT 0,
    courier_id TEXT REFERENCES couriers(id),
    courier_reason TEXT,
    label_code TEXT,
    hold_reason TEXT,
    order_value REAL NOT NULL DEFAULT 0,
    processed_at TEXT,
    picking_started_at TEXT,
    picked_at TEXT,
    packed_at TEXT,
    staged_at TEXT,
    shipped_at TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT,
    last_scan_error TEXT,
    scan_failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL,
    reserved_qty INTEGER NOT NULL DEFAULT 0,
    picked_qty INTEGER NOT NULL DEFAULT 0,
    verified_qty INTEGER NOT NULL DEFAULT 0,
    pick_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS ix_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
    package_type TEXT NOT NULL,
    dims TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    courier_id TEXT NOT NULL REFERENCES couriers(id),
    label_code TEXT NOT NULL,
    staging_location TEXT,
    status TEXT NOT NULL,
    pickup_at TEXT,
    packed_at TEXT NOT NULL,
    staged_at TEXT,
    handed_over_at TEXT,
    manifest_id TEXT
);
CREATE TABLE IF NOT EXISTS manifests (
    id TEXT PRIMARY KEY,
    courier_id TEXT NOT NULL REFERENCES couriers(id),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    parcel_count INTEGER NOT NULL,
    trigger TEXT NOT NULL DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    from_wh TEXT NOT NULL,
    to_wh TEXT NOT NULL,
    qty INTEGER NOT NULL,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    dispatched_at TEXT,
    received_at TEXT,
    note TEXT
);
CREATE TABLE IF NOT EXISTS inbound (
    id TEXT PRIMARY KEY,
    supplier TEXT NOT NULL,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    expected_at TEXT NOT NULL,
    status TEXT NOT NULL,
    received_at TEXT,
    received_by TEXT,
    source TEXT NOT NULL DEFAULT 'supplier',
    reorder_id TEXT,
    note TEXT
);
CREATE TABLE IF NOT EXISTS inbound_lines (
    id INTEGER PRIMARY KEY,
    inbound_id TEXT NOT NULL REFERENCES inbound(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    expected_qty INTEGER NOT NULL,
    received_qty INTEGER,
    damaged_qty INTEGER NOT NULL DEFAULT 0,
    putaway_qty INTEGER NOT NULL DEFAULT 0,
    reorder_line_id INTEGER,
    missing_action TEXT
);
CREATE TABLE IF NOT EXISTS reorders (
    id TEXT PRIMARY KEY,
    supplier TEXT NOT NULL,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    expected_at TEXT NOT NULL,
    note TEXT,
    closed_at TEXT,
    closed_by TEXT,
    close_reason TEXT
);
CREATE TABLE IF NOT EXISTS reorder_lines (
    id INTEGER PRIMARY KEY,
    reorder_id TEXT NOT NULL REFERENCES reorders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    ordered_qty INTEGER NOT NULL,
    CHECK (ordered_qty > 0)
);
CREATE INDEX IF NOT EXISTS ix_reorder_lines ON reorder_lines(reorder_id);
CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    order_id TEXT,
    package_id TEXT,
    product_id INTEGER,
    item_id INTEGER,
    blocking INTEGER NOT NULL DEFAULT 0,
    assignee TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    resolution TEXT,
    payload TEXT,
    dedupe_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_issues_status ON issues(status);
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    message TEXT NOT NULL,
    order_id TEXT,
    package_id TEXT,
    issue_id TEXT,
    product_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_activity_order ON activity(order_id);
CREATE INDEX IF NOT EXISTS ix_activity_issue ON activity(issue_id);
CREATE INDEX IF NOT EXISTS ix_activity_at ON activity(at);
CREATE INDEX IF NOT EXISTS ix_activity_actor ON activity(actor, at);
CREATE TABLE IF NOT EXISTS shift_notes (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    author TEXT NOT NULL,
    role TEXT NOT NULL,
    note TEXT NOT NULL,
    snapshot TEXT NOT NULL
);
"""

TABLES = [
    "courier_visits", "reorder_lines", "reorders", "shift_notes", "activity", "issues", "inbound_lines", "inbound", "transfers", "manifests",
    "packages", "order_items", "orders", "couriers", "inventory", "products", "warehouses",
    "counters", "meta",
]


def _dict_factory(cursor, row):
    return {col[0]: row[i] for i, col in enumerate(cursor.description)}


def connect(path: str | None = None) -> sqlite3.Connection:
    path = path or config.DB_PATH
    conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=10)
    conn.row_factory = _dict_factory
    conn.execute("PRAGMA foreign_keys = ON")
    if path != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    for stmt in SCHEMA.split(";"):
        if stmt.strip():
            conn.execute(stmt)
    migrate(conn)


_ADDED_COLUMNS = [
    ("inventory", "capacity", "INTEGER NOT NULL DEFAULT 0"),
    ("inbound", "source", "TEXT NOT NULL DEFAULT 'supplier'"),
    ("inbound", "reorder_id", "TEXT"),
    ("inbound", "note", "TEXT"),
    ("inbound_lines", "reorder_line_id", "INTEGER"),
    ("inbound_lines", "missing_action", "TEXT"),
    ("couriers", "handover_mode", "TEXT NOT NULL DEFAULT 'manual'"),
    ("manifests", "trigger", "TEXT NOT NULL DEFAULT 'manual'"),
]


def migrate(conn: sqlite3.Connection) -> None:
    for table, column, ddl in _ADDED_COLUMNS:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if cols and column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def upgrade_existing(path: str | None = None) -> None:
    """Bring an existing database file up to the current schema (safe to run every start)."""
    conn = connect(path)
    try:
        init_schema(conn)
    finally:
        conn.close()


def drop_all(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = OFF")
    for t in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {t}")
    conn.execute("PRAGMA foreign_keys = ON")


@contextmanager
def transaction(conn: sqlite3.Connection):
    """Run a block atomically. BEGIN IMMEDIATE serialises writers so the same
    stock can never be reserved twice by concurrent requests."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def get_db():
    """FastAPI dependency: one connection per request, whole request is one transaction."""
    conn = connect()
    try:
        with transaction(conn):
            yield conn
    finally:
        conn.close()


def one(conn, sql: str, params=()) -> dict | None:
    return conn.execute(sql, params).fetchone()


def all_rows(conn, sql: str, params=()) -> list[dict]:
    return conn.execute(sql, params).fetchall()


def scalar(conn, sql: str, params=()):
    row = conn.execute(sql, params).fetchone()
    if row is None:
        return None
    return next(iter(row.values()))


def db_exists_and_seeded(path: str | None = None) -> bool:
    path = path or config.DB_PATH
    if not os.path.exists(path):
        return False
    conn = connect(path)
    try:
        r = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'").fetchone()
        if not r:
            return False
        return (scalar(conn, "SELECT COUNT(*) FROM orders") or 0) > 0
    finally:
        conn.close()
