"""Seed data sanity + HTTP API tests (API tests run when FastAPI is installed)."""
import os
import tempfile
import unittest
from datetime import datetime, timezone

from app import clock
from app.db import connect
from app.seed import reset_database
from app.services import dashboard, orders as orders_svc


class SeedData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        cls.tmp.close()
        cls.now = datetime(2026, 9, 28, 9, 0, tzinfo=timezone.utc)
        cls.result = reset_database(cls.tmp.name, now=cls.now)
        cls.conn = connect(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()
        clock.set_now(None)
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(cls.tmp.name + suffix)
            except FileNotFoundError:
                pass

    def setUp(self):
        clock.set_now(self.now)

    def test_volume(self):
        self.assertGreaterEqual(self.result["orders"], 250)
        self.assertEqual(self.result["products"], 50)

    def test_reservations_reconcile(self):
        rows = self.conn.execute("""SELECT p.sku, m.reserved,
              (SELECT COALESCE(SUM(reserved_qty), 0) FROM order_items oi WHERE oi.product_id = p.id) AS items
              FROM products p JOIN inventory m ON m.product_id = p.id AND m.warehouse_id = 'MAIN'""").fetchall()
        for r in rows:
            self.assertEqual(r["reserved"], r["items"], r["sku"])

    def test_every_shipped_order_has_a_handed_over_package(self):
        n = self.conn.execute("""SELECT COUNT(*) AS n FROM orders o LEFT JOIN packages p ON p.order_id = o.id
                                 WHERE o.status = 'SHIPPED' AND (p.status IS NULL OR p.status != 'handed_over')""").fetchone()["n"]
        self.assertEqual(n, 0)

    def test_demo_order_is_set_up_for_the_walkthrough(self):
        o = orders_svc.order_detail(self.conn, self.result["demo_order_id"])
        self.assertTrue(o["priority"])
        self.assertEqual(o["status"], "AWAITING_STOCK")
        self.assertIn("Transfer required", o["blocked_info"]["reasons"][0])
        self.assertEqual(o["next_action"]["cta"]["kind"], "create_transfer")

    def test_scenarios_exist(self):
        types = {r["type"] for r in self.conn.execute("SELECT type FROM issues").fetchall()}
        for t in ("Stock Not Found", "Missed Pickup", "Duplicate Order", "Address Problem", "Return to Shelf",
                  "Wrong Variant", "Receiving Shortage"):
            self.assertIn(t, types)
        d = dashboard.dashboard(self.conn)
        self.assertGreater(d["kpis"]["delayed"], 0)
        self.assertTrue(d["action_queue"])


try:
    from fastapi.testclient import TestClient
    HAVE_FASTAPI = True
except ImportError:  # pragma: no cover
    HAVE_FASTAPI = False


@unittest.skipUnless(HAVE_FASTAPI, "FastAPI not installed")
class Api(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        cls.tmp.close()
        os.environ["FH_DB_PATH"] = cls.tmp.name
        from app import config
        config.DB_PATH = cls.tmp.name
        reset_database(cls.tmp.name)
        from app.main import app
        cls.client_cm = TestClient(app)
        cls.c = cls.client_cm.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_cm.__exit__(None, None, None)

    def test_demo_flow_over_http(self):
        c, W = self.c, {"X-Role": "warehouse"}
        demo = c.get("/api/meta").json()["demo_order_id"]
        cta = c.get(f"/api/orders/{demo}").json()["next_action"]["cta"]
        self.assertEqual(c.post("/api/transfers", json={"sku": cta["sku"], "qty": 1}, headers=W).status_code, 403)
        tr = c.post("/api/transfers", json={"sku": cta["sku"], "qty": cta["qty"]}).json()
        self.assertEqual(c.post("/api/transfers", json={"sku": cta["sku"], "qty": cta["qty"]}).status_code, 409)
        self.assertIn(demo, c.post(f"/api/transfers/{tr['id']}/receive", headers=W).json()["unblocked_orders"])
        for it in c.get(f"/api/picking/{demo}").json()["line_items"]:
            self.assertEqual(c.post(f"/api/order-items/{it['id']}/pick", headers=W).status_code, 200)
        bad = c.post(f"/api/packing/{demo}/scan", json={"code": "TSH-014-BLU-L"}, headers=W).json()["result"]
        self.assertEqual(bad["kind"], "wrong_variant")
        for it in c.get(f"/api/packing/{demo}").json()["line_items"]:
            for _ in range(it["qty"]):
                self.assertTrue(c.post(f"/api/packing/{demo}/scan", json={"code": it["sku"]}, headers=W).json()["result"]["ok"])
        d = c.get(f"/api/packing/{demo}").json()
        t = d["suggested_package_type"]
        r = c.post(f"/api/packing/{demo}/complete", headers=W, json={
            "package_type": t, "weight_kg": d["expected_weight_by_type"][t], "label_code": f"LBL-{demo}"}).json()
        pkg = r["package"]
        self.assertEqual(c.post("/api/handover", headers=W, json={"courier_id": pkg["courier_id"],
                                                                    "package_ids": [pkg["id"]]}).status_code, 409)
        c.post(f"/api/packages/{pkg['id']}/stage", headers=W, json={"location": "Dispatch Zone 1"})
        h = c.post("/api/handover", headers=W, json={"courier_id": pkg["courier_id"], "package_ids": [pkg["id"]]}).json()
        self.assertEqual(h["handed_over"], [pkg["id"]])
        self.assertEqual(c.get(f"/api/orders/{demo}").json()["status"], "SHIPPED")

    def test_reorder_and_receiving_over_http(self):
        c, W = self.c, {"X-Role": "warehouse"}
        sug = c.get("/api/reorders/suggestions").json()
        self.assertGreater(sug["count"], 0)
        first = sug["items"][0]
        body = {"items": [{"sku": first["sku"], "qty": first["suggested_qty"]}], "expected_at": "2030-01-02"}
        self.assertEqual(c.post("/api/reorders/bulk", json=body, headers=W).status_code, 403)
        rid = c.post("/api/reorders/bulk", json=body).json()["created"][0]["id"]
        ro = c.get(f"/api/reorders/{rid}").json()
        did = ro["deliveries"][0]["id"]
        line = next(d for d in c.get("/api/inbound").json() if d["id"] == did)["lines"][0]
        r = c.post(f"/api/inbound/{did}/receive", headers=W, json={
            "lines": [{"line_id": line["id"], "received_qty": line["expected_qty"] - 1, "damaged_qty": 0}],
            "missing_action": "backorder", "putaway_now": True}).json()
        self.assertTrue(r["backorder_id"])
        self.assertEqual(c.get(f"/api/reorders/{rid}").json()["status"], "partly_received")
        self.assertEqual(c.post(f"/api/inbound-lines/{line['id']}/correct", headers=W,
                                json={"received_qty": 1, "damaged_qty": 0, "reason": "x"}).status_code, 409)
        a = c.post("/api/inbound/arrival", headers=W, json={"supplier": "Walk-in", "lines": [
            {"sku": first["sku"], "received_qty": 2}], "putaway_now": True}).json()
        self.assertEqual(a["status"], "putaway_done")

    def test_staging_handover_and_shipped_over_http(self):
        c, W = self.c, {"X-Role": "warehouse"}
        board = c.get("/api/staging").json()
        self.assertTrue({"Priority Shelf P-01", "Dispatch Zone 1", "Rack B-04"} <= {a["name"] for a in board["areas"]})
        hb = c.get("/api/handover").json()
        g = next(x for x in hb["couriers"] if x["ready"])
        self.assertEqual(c.post(f"/api/couriers/{g['courier']['id']}/handover-mode", json={"mode": "on_arrival"},
                                headers=W).status_code, 403)
        ids = [p["id"] for p in g["ready"]][:1]
        r = c.post(f"/api/couriers/{g['courier']['id']}/arrived", json={"package_ids": ids}, headers=W).json()
        self.assertEqual(r["handed_over"], ids)
        self.assertEqual(c.post(f"/api/couriers/{g['courier']['id']}/handover-mode", json={"mode": "on_arrival"}).status_code, 200)
        r = c.post(f"/api/couriers/{g['courier']['id']}/arrived", json={}, headers=W).json()
        self.assertEqual(len(r["handed_over"]), len(g["ready"]) - 1)
        shipped = c.get("/api/shipped?range=all&q=" + ids[0]).json()
        self.assertEqual(shipped["parcels"][0]["id"], ids[0])

    def test_errors_are_friendly(self):
        r = self.c.get("/api/orders/FH-00000")
        self.assertEqual(r.status_code, 404)
        self.assertIn("not found", r.json()["detail"])
        self.assertEqual(self.c.post("/api/transfers", json={"sku": "X"}).status_code, 422)

    def test_processing_desk_over_http(self):
        W = {"X-Role": "warehouse"}
        b = self.c.get("/api/processing").json()
        self.assertEqual([o["position"] for o in b["queue"]], list(range(1, len(b["queue"]) + 1)))
        pri = [o["priority"] for o in b["queue"]]
        self.assertEqual(pri, sorted(pri, reverse=True))
        self.assertEqual(self.c.post("/api/processing/batch", json={"count": 1}, headers=W).status_code, 403)
        if b["queue"]:
            first = b["queue"][0]["id"]
            r = self.c.post("/api/processing/batch", json={"count": 1}).json()
            self.assertEqual(r["results"][0]["id"], first)
        self.assertEqual(self.c.post("/api/processing/batch", json={"count": 0}).status_code, 422)

    def test_bins_and_replenishment_over_http(self):
        m = self.c.get("/api/inventory/bins?warehouse=MAIN").json()
        bins = [b["bin"] for a in m["aisles"] for b in a["bins"]]
        from app.services.inventory import bin_sort_key
        self.assertEqual(bins, sorted(bins, key=bin_sort_key))
        self.assertEqual(self.c.get("/api/inventory/bins?warehouse=XYZ").status_code, 422)
        rep = self.c.get("/api/inventory/replenishment").json()
        self.assertTrue(all(i["below_line"] for i in rep["items"]))
        todo = [i for i in rep["items"] if i["status"] == "transfer_required" and not i["blocking_orders"]]
        if todo:
            r = self.c.post("/api/inventory/replenish", json={"skus": [todo[0]["sku"]]}).json()
            self.assertEqual(r["created"][0]["sku"], todo[0]["sku"])
        self.assertEqual(self.c.post("/api/inventory/capacity", json={"sku": "TSH-014-BLU-M", "capacity": 70},
                                     headers={"X-Role": "warehouse"}).status_code, 403)
        self.assertEqual(self.c.post("/api/inventory/capacity", json={"sku": "TSH-014-BLU-M", "capacity": 70}).json()["capacity"], 70)
        counts = self.c.get("/api/nav-counts").json()
        self.assertIn("processing", counts)
        self.assertIn("replenish", counts)

    def test_dashboard_and_search(self):
        d = self.c.get("/api/dashboard").json()
        self.assertIn("action_queue", d)
        res = self.c.get("/api/search?q=SHO-009").json()
        self.assertTrue(any(r["type"] == "Product" for r in res))


if __name__ == "__main__":
    unittest.main()
