"""Reorders (buying from suppliers) and the receiving outcomes: arrived OK, damaged, not arrived."""
from helpers import FHTestCase, OFFICE, WORKER

from app.services import inventory as inv, reorders as ro
from app.services.common import DomainError, AWAITING_STOCK, READY_TO_PICK


class Suggestions(FHTestCase):
    def test_sku_with_no_stock_anywhere_is_suggested(self):
        inv.adjust_stock(self.conn, OFFICE, "TSH-1-BLU-M", "SEC", 40, "Count")
        s = {i["sku"]: i for i in ro.suggestions(self.conn)["items"]}
        self.assertIn("CAP-1-NVY", s)
        self.assertEqual(s["CAP-1-NVY"]["suggested_qty"], 60)
        self.assertEqual(s["SHO-1-BLK-42"]["suggested_qty"], 55)
        self.assertNotIn("TSH-1-BLU-M", s)

    def test_waiting_orders_make_it_critical_and_add_to_the_quantity(self):
        o = self.processed([("CAP-1-NVY", 5)])
        self.assertEqual(o["status"], AWAITING_STOCK)
        s = {i["sku"]: i for i in ro.suggestions(self.conn)["items"]}["CAP-1-NVY"]
        self.assertEqual(s["level"], "critical")
        self.assertEqual(s["waiting_orders"], 1)
        self.assertEqual(s["waiting_units"], 2)

    def test_units_on_order_remove_the_suggestion(self):
        ro.create_reorder(self.conn, OFFICE, "Cap Co", [{"sku": "CAP-1-NVY", "qty": 60}])
        self.assertNotIn("CAP-1-NVY", {i["sku"] for i in ro.suggestions(self.conn)["items"]})
        row = next(r for r in inv.list_inventory(self.conn) if r["sku"] == "CAP-1-NVY")
        self.assertEqual(row["on_order"], 60)
        self.assertEqual(row["replenish"]["label"], "On order")


class ReorderLifecycle(FHTestCase):
    def _reorder(self, lines=None, **kw):
        return ro.create_reorder(self.conn, OFFICE, "Cap Co", lines or [{"sku": "CAP-1-NVY", "qty": 10}], **kw)

    def _count(self, r, counts, **kw):
        d = r["deliveries"][-1]["id"] if isinstance(r, dict) else r
        lines = inv.get_inbound(self.conn, d)["lines"]
        return inv.receive_inbound(self.conn, WORKER, d, [
            {"line_id": l["id"], "received_qty": counts[l["sku"]][0], "damaged_qty": counts[l["sku"]][1]} for l in lines], **kw)

    def test_warehouse_cannot_place_reorders(self):
        with self.assertRaises(DomainError) as e:
            ro.create_reorder(self.conn, WORKER, "Cap Co", [{"sku": "CAP-1-NVY", "qty": 5}])
        self.assertEqual(e.exception.status, 403)

    def test_reorder_creates_an_expected_delivery(self):
        r = self._reorder([{"sku": "CAP-1-NVY", "qty": 10}, {"sku": "CAP-1-NVY", "qty": 5}])
        self.assertEqual(r["status"], "ordered")
        self.assertEqual(r["totals"]["ordered"], 15)
        self.assertEqual(r["totals"]["still_due"], 15)
        d = inv.get_inbound(self.conn, r["deliveries"][0]["id"])
        self.assertEqual((d["status"], d["source"], d["reorder_id"]), ("expected", "reorder", r["id"]))

    def test_full_arrival_then_put_away(self):
        o = self.processed([("CAP-1-NVY", 5)])
        r = self._reorder()
        res = self._count(r, {"CAP-1-NVY": (10, 0)})
        self.assertIsNone(res["backorder_id"])
        self.assertEqual(ro.get_reorder(self.conn, r["id"])["status"], "received")
        self.assertEqual(self.stock_of("CAP-1-NVY")["awaiting_putaway"], 10)
        self.assertEqual(self.status(o["id"]), AWAITING_STOCK)
        inv.putaway_all(self.conn, WORKER, r["deliveries"][0]["id"])
        self.assertEqual(self.status(o["id"]), READY_TO_PICK)
        self.assertEqual(ro.get_reorder(self.conn, r["id"])["totals"]["put_away"], 10)

    def test_missing_units_still_coming_create_a_follow_up_delivery(self):
        r = self._reorder()
        res = self._count(r, {"CAP-1-NVY": (6, 1)}, missing_action="backorder", replace_damaged=True)
        self.assertTrue(res["backorder_id"])
        follow = inv.get_inbound(self.conn, res["backorder_id"])
        self.assertEqual(follow["lines"][0]["expected_qty"], 5)
        got = ro.get_reorder(self.conn, r["id"])
        self.assertEqual(got["status"], "partly_received")
        self.assertEqual((got["totals"]["arrived_ok"], got["totals"]["damaged"], got["totals"]["still_due"]), (5, 1, 5))
        self.assertIsNone(self.conn.execute("SELECT id FROM issues").fetchone())
        self._count(res["backorder_id"], {"CAP-1-NVY": (5, 0)})
        got = ro.get_reorder(self.conn, r["id"])
        self.assertEqual(got["status"], "received")
        self.assertEqual(got["totals"]["arrived_ok"], 10)

    def test_missing_units_not_coming_close_short_and_raise_an_issue(self):
        r = self._reorder()
        self._count(r, {"CAP-1-NVY": (0, 0)}, missing_action="close")
        got = ro.get_reorder(self.conn, r["id"])
        self.assertEqual(got["status"], "closed_short")
        self.assertEqual(got["totals"]["not_coming"], 10)
        issue = self.conn.execute("SELECT * FROM issues WHERE type='Receiving Shortage'").fetchone()
        self.assertIn("not coming", issue["description"])

    def test_cancel_only_before_anything_arrived_then_close(self):
        r = self._reorder()
        self._count(r, {"CAP-1-NVY": (4, 0)}, missing_action="backorder")
        with self.assertRaises(DomainError):
            ro.cancel_reorder(self.conn, OFFICE, r["id"], "Changed mind")
        got = ro.close_reorder(self.conn, OFFICE, r["id"], "Supplier discontinued it")
        self.assertEqual(got["status"], "closed_short")
        self.assertEqual((got["totals"]["arrived_ok"], got["totals"]["not_coming"], got["totals"]["still_due"]), (4, 6, 0))
        self.assertEqual(self.stock_of("CAP-1-NVY")["awaiting_putaway"], 4)
        r2 = self._reorder()
        c = ro.cancel_reorder(self.conn, OFFICE, r2["id"], "Ordered by mistake")
        self.assertEqual(c["status"], "cancelled")
        self.assertEqual(inv.get_inbound(self.conn, r2["deliveries"][0]["id"])["status"], "cancelled")
        with self.assertRaises(DomainError):
            self._count(r2, {"CAP-1-NVY": (10, 0)})

    def test_reschedule_moves_the_open_delivery(self):
        r = self._reorder()
        got = ro.update_expected(self.conn, OFFICE, r["id"], "2026-10-02T06:00:00+00:00")
        self.assertEqual(got["expected_at"][:10], "2026-10-02")
        self.assertEqual(inv.get_inbound(self.conn, r["deliveries"][0]["id"])["expected_at"][:10], "2026-10-02")
        got = ro.update_expected(self.conn, OFFICE, r["id"], "2026-10-03")
        self.assertEqual(got["expected_at"], "2026-10-03T05:30:00Z")
        with self.assertRaises(DomainError):
            ro.update_expected(self.conn, OFFICE, r["id"], "next week")


class CountCorrections(FHTestCase):
    def test_correction_adjusts_stock_waiting_for_put_away(self):
        r = ro.create_reorder(self.conn, OFFICE, "Cap Co", [{"sku": "CAP-1-NVY", "qty": 10}])
        d = r["deliveries"][0]["id"]
        line = inv.get_inbound(self.conn, d)["lines"][0]
        inv.receive_inbound(self.conn, WORKER, d, [{"line_id": line["id"], "received_qty": 10, "damaged_qty": 0}])
        inv.correct_count(self.conn, WORKER, line["id"], 10, 2, "Two caps crushed at the bottom of the carton")
        self.assertEqual(self.stock_of("CAP-1-NVY")["awaiting_putaway"], 8)
        self.assertEqual(ro.get_reorder(self.conn, r["id"])["status"], "closed_short")
        inv.putaway_all(self.conn, WORKER, d)
        with self.assertRaises(DomainError) as e:
            inv.correct_count(self.conn, WORKER, line["id"], 5, 0, "Recount")
        self.assertEqual(e.exception.code, "below_putaway")
        with self.assertRaises(DomainError):
            inv.correct_count(self.conn, WORKER, line["id"], 12, 0, "")
        inv.correct_count(self.conn, WORKER, line["id"], 12, 2, "Found another inner pack")
        self.assertEqual(self.stock_of("CAP-1-NVY")["awaiting_putaway"], 2)
        self.assertEqual(inv.get_inbound(self.conn, d)["status"], "received")


class UnplannedArrival(FHTestCase):
    def test_manual_arrival_is_counted_and_can_be_shelved_at_once(self):
        o = self.processed([("CAP-1-NVY", 5)])
        res = inv.record_arrival(self.conn, WORKER, "Walk-in supplier", "MAIN",
                                 [{"sku": "cap-1-nvy", "received_qty": 6, "damaged_qty": 1},
                                  {"sku": "TSH-1-BLU-M", "received_qty": 0}], "No paperwork", putaway_now=True)
        self.assertEqual(res["source"], "manual")
        self.assertEqual(res["status"], "putaway_done")
        self.assertEqual(len(res["lines"]), 1)
        self.assertEqual(self.stock_of("CAP-1-NVY")["on_hand"], 8)
        self.assertIn(o["id"], res["unblocked_orders"])
        issue = self.conn.execute("SELECT * FROM issues").fetchone()
        self.assertEqual(issue["type"], "Damaged Item")

    def test_arrival_needs_a_quantity(self):
        with self.assertRaises(DomainError):
            inv.record_arrival(self.conn, WORKER, "Walk-in", "MAIN", [{"sku": "CAP-1-NVY", "received_qty": 0}])
