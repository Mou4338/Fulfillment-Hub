"""Small, fully controlled fixture for business-rule tests (the demo seed is tested separately)."""
import unittest
from datetime import datetime, timezone

from app import clock
from app.db import connect, init_schema
from app.services import orders as orders_svc
from app.services.common import Actor

OFFICE = Actor("Test Office", "office")
WORKER = Actor("Test Picker", "warehouse")

T0 = datetime(2026, 9, 28, 4, 30, tzinfo=timezone.utc)

PRODUCTS = [
    ("TSH-1-BLU-M", "TSH-1", "Tee", "Blue / M", 0.2, 500, 1),
    ("TSH-1-BLU-L", "TSH-1", "Tee", "Blue / L", 0.2, 500, 1),
    ("SHO-1-BLK-42", "SHO-1", "Shoe", "Black / 42", 0.9, 3000, 0),
    ("CAP-1-NVY", "CAP-1", "Cap", "Navy", 0.1, 400, 0),
]


class FHTestCase(unittest.TestCase):
    """Fresh in-memory database per test with two warehouses, two couriers and four SKUs."""

    stock = {"TSH-1-BLU-M": (10, 5), "TSH-1-BLU-L": (10, 5), "SHO-1-BLK-42": (0, 8), "CAP-1-NVY": (3, 0)}

    def setUp(self):
        clock.set_now(T0)
        self.conn = connect(":memory:")
        init_schema(self.conn)
        c = self.conn
        c.execute("INSERT INTO warehouses VALUES ('MAIN','Main Warehouse','shipping',1)")
        c.execute("INSERT INTO warehouses VALUES ('SEC','Secondary Warehouse','overflow',0)")
        c.execute("INSERT INTO couriers(id, name, pickup_times, cost_per_parcel, delivery_days_min, delivery_days_max, staging_lane) VALUES ('FAST','FastShip','15:00',90,1,2,'Lane F')")
        c.execute("INSERT INTO couriers(id, name, pickup_times, cost_per_parcel, delivery_days_min, delivery_days_max, staging_lane) VALUES ('CHEAP','CheapShip','12:00,17:00',40,3,5,'Lane C')")
        for i, (sku, base, name, variant, w, price, sub) in enumerate(PRODUCTS, start=1):
            c.execute("INSERT INTO products(id, sku, base_code, name, category, variant, weight_kg, price, substitutable,"
                      " low_stock_threshold) VALUES (?,?,?,?,?,?,?,?,?,2)", (i, sku, base, name, "Test", variant, w, price, sub))
            main, sec = self.stock.get(sku, (10, 0))
            c.execute("INSERT INTO inventory(product_id, warehouse_id, bin, on_hand) VALUES (?, 'MAIN', ?, ?)",
                      (i, f"A-01-0{i}", main))
            c.execute("INSERT INTO inventory(product_id, warehouse_id, bin, on_hand) VALUES (?, 'SEC', ?, ?)",
                      (i, f"S-01-0{i}", sec))

    def tearDown(self):
        clock.set_now(None)
        self.conn.close()

    def order(self, items, priority=False, **kw):
        base = dict(channel="Website", channel_ref=kw.pop("ref", f"#T{self.conn.execute('SELECT COUNT(*) AS n FROM orders').fetchone()['n']}"),
                    customer_name="Test Customer", phone="9876543210", address="12, Test Street, Test Nagar",
                    city="Chennai", pincode="600001")
        base.update(kw)
        return orders_svc.create_order(self.conn, OFFICE, priority=priority,
                                       items=[{"sku": s, "qty": q} for s, q in items], **base)

    def processed(self, items, priority=False, **kw):
        o = self.order(items, priority, **kw)
        return orders_svc.process_order(self.conn, OFFICE, o["id"])

    def stock_of(self, sku, wh="MAIN"):
        return self.conn.execute("""SELECT i.* FROM inventory i JOIN products p ON p.id = i.product_id
                                    WHERE p.sku = ? AND i.warehouse_id = ?""", (sku, wh)).fetchone()

    def items(self, order_id):
        return orders_svc.items_for(self.conn, order_id)

    def status(self, order_id):
        return orders_svc.get_order_row(self.conn, order_id)["status"]

    def pick_all(self, order_id):
        from app.services import picking
        for it in self.items(order_id):
            picking.pick_item(self.conn, WORKER, it["id"])

    def scan_all(self, order_id):
        from app.services import packing
        for it in self.items(order_id):
            for _ in range(it["qty"] - it["verified_qty"]):
                r = packing.scan_item(self.conn, WORKER, order_id, it["sku"])
                assert r["ok"], r

    def pack(self, order_id, **kw):
        from app.services import packing
        exp = packing._expected_weight(self.conn, order_id, "Small box")
        args = dict(package_type="Small box", weight_kg=exp, label_code=f"LBL-{order_id}")
        args.update(kw)
        return packing.complete_packing(self.conn, WORKER, order_id, **args)
