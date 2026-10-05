"""Processing desk (queue order + batch), preventive replenishment, bin map, and bug-fix regressions."""
import sqlite3
from datetime import timedelta

from app import clock
from app.db import connect, migrate
from app.services import dispatch, inventory as inv, issues as issues_svc, orders as orders_svc, picking, processing
from app.services.common import AWAITING_STOCK, ON_HOLD, READY_TO_PICK, RECEIVED, DomainError

from helpers import FHTestCase, OFFICE, WORKER, T0


class ProcessingQueue(FHTestCase):
    def test_queue_is_priority_then_ship_by_then_first_received(self):
        a = self.order([("TSH-1-BLU-M", 1)])
        clock.set_now(T0 + timedelta(minutes=5))
        b = self.order([("TSH-1-BLU-M", 1)], received_at=clock.now())
        c = self.order([("TSH-1-BLU-L", 1)], priority=True, received_at=clock.now())
        ids = [o["id"] for o in processing.board(self.conn)["queue"]]
        self.assertEqual(ids, [c["id"], a["id"], b["id"]])
        self.assertEqual([o["position"] for o in processing.board(self.conn)["queue"]], [1, 2, 3])

    def test_preview_simulates_stock_top_to_bottom(self):
        first = self.order([("CAP-1-NVY", 2)])
        second = self.order([("CAP-1-NVY", 2)])
        q = {o["id"]: o for o in processing.board(self.conn)["queue"]}
        self.assertEqual(q[first["id"]]["preview"]["kind"], "ready")
        self.assertEqual(q[second["id"]]["preview"]["kind"], "needs_stock")
        self.assertIn("Main has 1 left", q[second["id"]]["preview"]["text"])

    def test_preview_flags_holds(self):
        o = self.order([("TSH-1-BLU-M", 1)], pincode="12", phone="")
        q = processing.board(self.conn)["queue"]
        self.assertEqual(q[0]["preview"]["kind"], "hold")
        self.assertIn("Incomplete address", q[0]["preview"]["text"])
        self.assertEqual(o["status"], RECEIVED)

    def test_batch_processes_in_queue_order_and_matches_preview(self):
        normal = self.order([("CAP-1-NVY", 2)])
        pri = self.order([("CAP-1-NVY", 2)], priority=True)
        preview = {o["id"]: o["preview"]["kind"] for o in processing.board(self.conn)["queue"]}
        r = processing.process_batch(self.conn, OFFICE, order_ids=[normal["id"], pri["id"]])
        self.assertEqual([x["id"] for x in r["results"]], [pri["id"], normal["id"]])
        self.assertEqual(self.status(pri["id"]), READY_TO_PICK)
        self.assertEqual(self.status(normal["id"]), AWAITING_STOCK)
        self.assertEqual(preview, {pri["id"]: "ready", normal["id"]: "needs_stock"})

    def test_batch_by_count_and_hold_does_not_stop_the_rest(self):
        bad = self.order([("TSH-1-BLU-M", 1)], pincode="")
        good = self.order([("TSH-1-BLU-M", 1)])
        r = processing.process_batch(self.conn, OFFICE, count=5)
        self.assertEqual(r["summary"], {"hold": 1, "ready": 1})
        self.assertEqual(self.status(bad["id"]), ON_HOLD)
        self.assertEqual(self.status(good["id"]), READY_TO_PICK)

    def test_batch_skips_already_processed_and_is_office_only(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        r = processing.process_batch(self.conn, OFFICE, order_ids=[o["id"]])
        self.assertEqual(r["results"][0]["outcome"], "skipped")
        self.order([("TSH-1-BLU-M", 1)])
        with self.assertRaises(DomainError) as e:
            processing.process_batch(self.conn, WORKER, count=1)
        self.assertEqual(e.exception.status, 403)

    def test_empty_queue_says_so(self):
        with self.assertRaises(DomainError):
            processing.process_batch(self.conn, OFFICE, count=1)


class Replenishment(FHTestCase):
    def test_below_half_needs_a_transfer(self):
        rep = {i["sku"]: i for i in inv.replenishment(self.conn)["items"]}
        t = rep["TSH-1-BLU-M"]
        self.assertEqual(t["status"], "transfer_required")
        self.assertEqual(t["suggested_qty"], 5)
        self.assertEqual(t["level"], "critical")

    def test_above_half_is_fine(self):
        inv.set_capacity(self.conn, OFFICE, "TSH-1-BLU-M", "MAIN", 16)
        rep = {i["sku"] for i in inv.replenishment(self.conn)["items"]}
        self.assertNotIn("TSH-1-BLU-M", rep)

    def test_reserved_stock_counts_against_available(self):
        inv.set_capacity(self.conn, OFFICE, "TSH-1-BLU-M", "MAIN", 16)
        self.processed([("TSH-1-BLU-M", 3)])
        rep = {i["sku"]: i for i in inv.replenishment(self.conn)["items"]}
        self.assertEqual(rep["TSH-1-BLU-M"]["status"], "transfer_required")
        self.assertEqual(rep["TSH-1-BLU-M"]["suggested_qty"], 5)

    def test_no_secondary_stock_means_reorder(self):
        rep = {i["sku"]: i for i in inv.replenishment(self.conn)["items"]}
        self.assertEqual(rep["CAP-1-NVY"]["status"], "reorder")

    def test_bulk_create_then_open_transfer_is_not_duplicated(self):
        r = inv.create_replenishment_transfers(self.conn, OFFICE)
        skus = {c["sku"] for c in r["created"]}
        self.assertIn("TSH-1-BLU-M", skus)
        self.assertIn("SHO-1-BLK-42", skus)
        again = inv.create_replenishment_transfers(self.conn, OFFICE)
        self.assertEqual(again["created"], [])
        rep = {i["sku"]: i for i in inv.replenishment(self.conn)["items"]}
        self.assertEqual(rep["TSH-1-BLU-M"]["status"], "in_transfer")

    def test_receiving_the_refill_clears_the_warning(self):
        inv.set_capacity(self.conn, OFFICE, "TSH-1-BLU-L", "MAIN", 24)
        r = inv.create_replenishment_transfers(self.conn, OFFICE, ["TSH-1-BLU-L"])
        self.assertEqual(r["created"][0]["qty"], 5)
        inv.receive_transfer(self.conn, WORKER, r["created"][0]["id"])
        rep = {i["sku"] for i in inv.replenishment(self.conn)["items"]}
        self.assertNotIn("TSH-1-BLU-L", rep)

    def test_capacity_rules(self):
        with self.assertRaises(DomainError):
            inv.set_capacity(self.conn, WORKER, "TSH-1-BLU-M", "MAIN", 20)
        with self.assertRaises(DomainError):
            inv.set_capacity(self.conn, OFFICE, "TSH-1-BLU-M", "MAIN", 0)


class BinMap(FHTestCase):
    def test_bins_in_natural_walking_order(self):
        keys = ["B-01-01", "A-10-01", "A-02-01", "A-01-10", "A-01-02", "UNASSIGNED"]
        self.assertEqual(sorted(keys, key=inv.bin_sort_key),
                         ["A-01-02", "A-01-10", "A-02-01", "A-10-01", "B-01-01", "UNASSIGNED"])

    def test_bin_map_groups_by_aisle_with_fill(self):
        m = inv.bin_map(self.conn, "MAIN")
        self.assertEqual([a["aisle"] for a in m["aisles"]], ["A"])
        b = m["aisles"][0]["bins"][0]
        self.assertEqual(b["bin"], "A-01-01")
        self.assertEqual((b["on_hand"], b["capacity"], b["fill_pct"]), (10, 60, 17))
        self.assertEqual(m["totals"]["bins"], 4)
        shoe = next(x for x in m["aisles"][0]["bins"] if x["sku"] == "SHO-1-BLK-42")
        self.assertEqual(shoe["status"], "critical")

    def test_putaway_refuses_a_bin_holding_another_sku(self):
        c = self.conn
        c.execute("INSERT INTO inbound(id, supplier, warehouse_id, expected_at, status) VALUES ('IN-1','Sup','MAIN',?, 'expected')", (clock.now_iso(),))
        lid = c.execute("INSERT INTO inbound_lines(inbound_id, product_id, expected_qty) VALUES ('IN-1', 1, 4)").lastrowid
        inv.receive_inbound(c, WORKER, "IN-1", [{"line_id": lid, "received_qty": 4}])
        with self.assertRaises(DomainError) as e:
            inv.putaway_line(c, WORKER, lid, "A-01-02")
        self.assertEqual(e.exception.code, "bin_taken")
        inv.putaway_line(c, WORKER, lid, "A-09-09")
        self.assertEqual(self.stock_of("TSH-1-BLU-M")["bin"], "A-09-09")


class BugFixes(FHTestCase):
    def test_resolving_a_blocking_issue_releases_a_waiting_order(self):
        o = self.processed([("SHO-1-BLK-42", 1)])
        iss = issues_svc.create_issue(self.conn, OFFICE, type="Address Problem", severity="Medium", title="Check flat no.",
                                      order_id=o["id"], blocking=True)
        inv.adjust_stock(self.conn, OFFICE, "SHO-1-BLK-42", "MAIN", 4, "found a carton")
        self.assertEqual(self.status(o["id"]), AWAITING_STOCK)
        issues_svc.resolve_issue(self.conn, OFFICE, iss["id"], "Customer confirmed")
        self.assertEqual(self.status(o["id"]), READY_TO_PICK)

    def test_warehouse_can_confirm_return_to_shelf(self):
        o = self.processed([("TSH-1-BLU-M", 2)])
        self.pick_all(o["id"])
        orders_svc.cancel_order(self.conn, OFFICE, o["id"], "Customer cancelled")
        ret = self.conn.execute("SELECT * FROM issues WHERE type='Return to Shelf'").fetchone()
        issues_svc.resolve_issue(self.conn, WORKER, ret["id"], "Back in A-01-01")
        self.assertEqual(self.stock_of("TSH-1-BLU-M")["on_hand"], 10)

    def test_warehouse_still_cannot_resolve_other_issues(self):
        iss = issues_svc.create_issue(self.conn, OFFICE, type="Other", severity="Low", title="Printer jam")
        with self.assertRaises(DomainError):
            issues_svc.resolve_issue(self.conn, WORKER, iss["id"], "fixed")

    def test_courier_chosen_before_processing_is_kept(self):
        o = self.order([("TSH-1-BLU-M", 1)])
        orders_svc.change_courier(self.conn, OFFICE, o["id"], "FAST")
        done = orders_svc.process_order(self.conn, OFFICE, o["id"])
        self.assertEqual(done["courier_id"], "FAST")

    def test_date_filter_uses_local_days(self):
        late = clock.parse("2026-09-27T23:30:00Z")
        o = self.order([("TSH-1-BLU-M", 1)], received_at=late)
        ids = [x["id"] for x in orders_svc.list_orders(self.conn, date_from="2026-09-28", date_to="2026-09-28")]
        self.assertIn(o["id"], ids)

    def test_old_database_gets_capacity_column(self):
        conn = connect(":memory:")
        conn.execute("CREATE TABLE inventory (id INTEGER PRIMARY KEY, product_id INTEGER, warehouse_id TEXT, bin TEXT,"
                     " on_hand INTEGER, reserved INTEGER, awaiting_putaway INTEGER)")
        migrate(conn)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(inventory)").fetchall()}
        self.assertIn("capacity", cols)
        migrate(conn)
        conn.close()
