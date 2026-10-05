from datetime import timedelta

from app import clock
from app.services import dispatch, issues as issues_svc, packing, picking
from app.services import orders as orders_svc
from app.services.common import (
    AWAITING_STOCK, PACKED, PICKING, READY_TO_PACK, READY_TO_PICK, SHIPPED, STAGED, CANCELLED, DomainError,
)

from helpers import FHTestCase, OFFICE, WORKER


class HappyPath(FHTestCase):
    def test_receive_to_shipped(self):
        o = self.order([("TSH-1-BLU-M", 2), ("CAP-1-NVY", 1)], priority=True)
        o = orders_svc.process_order(self.conn, OFFICE, o["id"])
        self.assertEqual(o["status"], READY_TO_PICK)
        self.assertEqual(self.stock_of("TSH-1-BLU-M")["reserved"], 2)
        self.pick_all(o["id"])
        self.assertEqual(self.status(o["id"]), READY_TO_PACK)
        s = self.stock_of("TSH-1-BLU-M")
        self.assertEqual((s["on_hand"], s["reserved"]), (8, 0))
        self.scan_all(o["id"])
        res = self.pack(o["id"])
        self.assertTrue(res["ok"])
        pkg = res["package"]
        self.assertEqual(self.status(o["id"]), PACKED)
        dispatch.stage_package(self.conn, WORKER, pkg["id"], "Lane F")
        self.assertEqual(self.status(o["id"]), STAGED)
        out = dispatch.handover(self.conn, WORKER, pkg["courier_id"], [pkg["id"]])
        self.assertEqual(out["handed_over"], [pkg["id"]])
        final = orders_svc.get_order_row(self.conn, o["id"])
        self.assertEqual(final["status"], SHIPPED)
        for k in ("processed_at", "picking_started_at", "picked_at", "packed_at", "staged_at", "shipped_at"):
            self.assertIsNotNone(final[k], k)
        timeline = [r["action"] for r in self.conn.execute(
            "SELECT action FROM activity WHERE order_id=? ORDER BY id", (o["id"],)).fetchall()]
        for step in ("received", "processed", "stock_reserved", "picking_started", "item_picked", "picking_completed",
                     "item_verified", "packed", "staged", "handed_over"):
            self.assertIn(step, timeline)


class TransitionRules(FHTestCase):
    def test_cannot_verify_or_pack_before_picking(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        with self.assertRaises(DomainError):
            packing.scan_item(self.conn, WORKER, o["id"], "TSH-1-BLU-M")
        with self.assertRaises(DomainError) as e:
            self.pack(o["id"])
        self.assertEqual(e.exception.code, "invalid_transition")

    def test_cannot_pack_until_every_unit_is_scanned(self):
        o = self.processed([("TSH-1-BLU-M", 2)])
        self.pick_all(o["id"])
        packing.scan_item(self.conn, WORKER, o["id"], "TSH-1-BLU-M")
        with self.assertRaises(DomainError) as e:
            self.pack(o["id"])
        self.assertEqual(e.exception.code, "not_verified")

    def test_cannot_stage_before_packing(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        self.pick_all(o["id"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) AS n FROM packages").fetchone()["n"], 0)
        with self.assertRaises(DomainError):
            dispatch.stage_package(self.conn, WORKER, "PKG-NOPE", "Lane F")

    def test_cannot_hand_over_before_staging(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        self.pick_all(o["id"])
        self.scan_all(o["id"])
        pkg = self.pack(o["id"])["package"]
        with self.assertRaises(DomainError) as e:
            dispatch.handover(self.conn, WORKER, pkg["courier_id"], [pkg["id"]])
        self.assertIn("only staged parcels", e.exception.message)
        self.assertEqual(self.status(o["id"]), PACKED)

    def test_cannot_hand_over_to_wrong_courier(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        self.pick_all(o["id"])
        self.scan_all(o["id"])
        pkg = self.pack(o["id"])["package"]
        dispatch.stage_package(self.conn, WORKER, pkg["id"], "Lane C")
        with self.assertRaises(DomainError):
            dispatch.handover(self.conn, WORKER, "FAST", [pkg["id"]])

    def test_critical_issue_blocks_shipping(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        self.pick_all(o["id"])
        self.scan_all(o["id"])
        pkg = self.pack(o["id"])["package"]
        dispatch.stage_package(self.conn, WORKER, pkg["id"], "Lane C")
        issues_svc.create_issue(self.conn, OFFICE, type="Other", severity="Critical", title="Customer reported fraud",
                                order_id=o["id"])
        with self.assertRaises(DomainError) as e:
            dispatch.handover(self.conn, WORKER, pkg["courier_id"], [pkg["id"]])
        self.assertEqual(e.exception.code, "handover_blocked")


class Idempotency(FHTestCase):
    def test_pick_twice_deducts_once(self):
        o = self.processed([("TSH-1-BLU-M", 2)])
        item = self.items(o["id"])[0]
        picking.pick_item(self.conn, WORKER, item["id"])
        again = picking.pick_item(self.conn, WORKER, item["id"])
        self.assertTrue(again["already"])
        s = self.stock_of("TSH-1-BLU-M")
        self.assertEqual((s["on_hand"], s["reserved"]), (8, 0))

    def test_handover_twice_creates_one_shipment(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        self.pick_all(o["id"])
        self.scan_all(o["id"])
        pkg = self.pack(o["id"])["package"]
        dispatch.stage_package(self.conn, WORKER, pkg["id"], "Lane C")
        dispatch.handover(self.conn, WORKER, pkg["courier_id"], [pkg["id"]])
        second = dispatch.handover(self.conn, WORKER, pkg["courier_id"], [pkg["id"]])
        self.assertEqual(second["handed_over"], [])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) AS n FROM manifests").fetchone()["n"], 1)
        n = self.conn.execute("SELECT COUNT(*) AS n FROM activity WHERE action='handed_over'").fetchone()["n"]
        self.assertEqual(n, 1)

    def test_pack_twice_returns_same_package(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        self.pick_all(o["id"])
        self.scan_all(o["id"])
        first = self.pack(o["id"])
        second = self.pack(o["id"])
        self.assertTrue(second["already"])
        self.assertEqual(first["package"]["id"], second["package"]["id"])

    def test_resolve_twice_is_harmless(self):
        i = issues_svc.create_issue(self.conn, OFFICE, type="Other", severity="Low", title="Printer jam")
        issues_svc.resolve_issue(self.conn, OFFICE, i["id"], "Cleared")
        again = issues_svc.resolve_issue(self.conn, OFFICE, i["id"], "Cleared again")
        self.assertEqual(again["resolution"], "Cleared")

    def test_same_issue_is_not_logged_twice(self):
        a = issues_svc.create_issue(self.conn, OFFICE, type="Other", severity="Low", title="X", dedupe_key="k1")
        b = issues_svc.create_issue(self.conn, OFFICE, type="Other", severity="Low", title="X", dedupe_key="k1")
        self.assertEqual(a["id"], b["id"])


class PackingVerification(FHTestCase):
    def _ready(self, items=(("TSH-1-BLU-M", 1),)):
        o = self.processed(list(items))
        self.pick_all(o["id"])
        return o

    def test_wrong_variant_rejected_with_clear_message(self):
        o = self._ready()
        r = packing.scan_item(self.conn, WORKER, o["id"], "TSH-1-BLU-L")
        self.assertFalse(r["ok"])
        self.assertEqual(r["kind"], "wrong_variant")
        self.assertIn("expected TSH-1-BLU-M (Blue / M), scanned TSH-1-BLU-L (Blue / L)", r["message"])
        self.assertEqual(self.items(o["id"])[0]["verified_qty"], 0)
        issue = self.conn.execute("SELECT * FROM issues WHERE order_id=?", (o["id"],)).fetchone()
        self.assertEqual(issue["type"], "Wrong Variant")

    def test_wrong_product_rejected(self):
        o = self._ready()
        r = packing.scan_item(self.conn, WORKER, o["id"], "CAP-1-NVY")
        self.assertEqual(r["kind"], "wrong_sku")
        self.assertIn("not in this order", r["message"])

    def test_over_scan_and_unknown_barcode_rejected(self):
        o = self._ready()
        self.assertTrue(packing.scan_item(self.conn, WORKER, o["id"], "tsh-1-blu-m")["ok"])
        self.assertEqual(packing.scan_item(self.conn, WORKER, o["id"], "TSH-1-BLU-M")["kind"], "over_scan")
        self.assertEqual(packing.scan_item(self.conn, WORKER, o["id"], "ZZZ-999")["kind"], "unknown")

    def test_wrong_label_is_caught_and_recorded(self):
        a = self._ready()
        b = self.processed([("CAP-1-NVY", 1)])
        self.scan_all(a["id"])
        r = self.pack(a["id"], label_code=f"LBL-{b['id']}")
        self.assertFalse(r["ok"])
        self.assertIn(f"different order ({b['id']})", r["message"])
        self.assertEqual(self.status(a["id"]), READY_TO_PACK)
        t = self.conn.execute("SELECT type FROM issues WHERE order_id=?", (a["id"],)).fetchone()["type"]
        self.assertEqual(t, "Label Mismatch")

    def test_weight_mismatch_needs_confirmation(self):
        o = self._ready()
        self.scan_all(o["id"])
        with self.assertRaises(DomainError) as e:
            self.pack(o["id"], weight_kg=5.0)
        self.assertEqual(e.exception.code, "weight_mismatch")
        r = self.pack(o["id"], weight_kg=5.0, confirm_weight=True)
        self.assertTrue(r["ok"])
        t = self.conn.execute("SELECT type FROM issues WHERE order_id=?", (o["id"],)).fetchone()["type"]
        self.assertEqual(t, "Weight Mismatch")

    def test_mismatch_issues_close_when_order_is_packed_correctly(self):
        o = self._ready()
        packing.scan_item(self.conn, WORKER, o["id"], "TSH-1-BLU-L")
        self.scan_all(o["id"])
        self.pack(o["id"])
        st = self.conn.execute("SELECT status FROM issues WHERE order_id=?", (o["id"],)).fetchone()["status"]
        self.assertEqual(st, "Resolved")


class PickingProblems(FHTestCase):
    def test_stock_not_found_blocks_without_changing_inventory(self):
        o = self.processed([("TSH-1-BLU-M", 2), ("CAP-1-NVY", 1)])
        tee = next(i for i in self.items(o["id"]) if i["sku"] == "TSH-1-BLU-M")
        before = self.stock_of("TSH-1-BLU-M")
        issue = picking.report_problem(self.conn, WORKER, tee["id"], "not_found")
        after = self.stock_of("TSH-1-BLU-M")
        self.assertEqual((before["on_hand"], before["reserved"]), (after["on_hand"], after["reserved"]))
        self.assertEqual(issue["type"], "Stock Not Found")
        self.assertEqual(issue["created_by"], WORKER.name)
        b = orders_svc.blocked_info(self.conn, orders_svc.get_order_row(self.conn, o["id"]))
        self.assertTrue(b["blocked"])
        with self.assertRaises(DomainError):
            picking.pick_item(self.conn, WORKER, tee["id"])
        again = picking.report_problem(self.conn, WORKER, tee["id"], "not_found")
        self.assertEqual(again["id"], issue["id"])

    def test_found_on_recount_resumes_picking(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        item = self.items(o["id"])[0]
        issue = picking.report_problem(self.conn, WORKER, item["id"], "not_found")
        picking.resolve_pick_problem(self.conn, WORKER, issue["id"], "found")
        picking.pick_item(self.conn, WORKER, item["id"])
        self.assertEqual(self.status(o["id"]), READY_TO_PACK)

    def test_confirm_missing_adjusts_stock_and_replans(self):
        o = self.processed([("CAP-1-NVY", 3)])
        item = self.items(o["id"])[0]
        issue = picking.report_problem(self.conn, WORKER, item["id"], "not_found")
        with self.assertRaises(DomainError):
            picking.resolve_pick_problem(self.conn, WORKER, issue["id"], "confirm_missing")
        picking.resolve_pick_problem(self.conn, OFFICE, issue["id"], "confirm_missing")
        s = self.stock_of("CAP-1-NVY")
        self.assertEqual((s["on_hand"], s["reserved"]), (0, 0))
        self.assertEqual(self.status(o["id"]), AWAITING_STOCK)
        adj = self.conn.execute("SELECT message FROM activity WHERE action='stock_adjusted'").fetchone()["message"]
        self.assertIn("-3", adj)

    def test_substitute_variant(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        item = self.items(o["id"])[0]
        issue = picking.report_problem(self.conn, WORKER, item["id"], "damaged")
        picking.resolve_pick_problem(self.conn, OFFICE, issue["id"], "substitute", substitute_sku="TSH-1-BLU-L")
        it = self.items(o["id"])[0]
        self.assertEqual((it["sku"], it["reserved_qty"], it["pick_status"]), ("TSH-1-BLU-L", 1, "pending"))
        self.assertEqual(self.status(o["id"]), PICKING)

    def test_cancel_after_picking_creates_return_task_that_restocks(self):
        o = self.processed([("TSH-1-BLU-M", 2)])
        self.pick_all(o["id"])
        orders_svc.cancel_order(self.conn, OFFICE, o["id"], "Customer cancelled")
        self.assertEqual(self.status(o["id"]), CANCELLED)
        task = self.conn.execute("SELECT * FROM issues WHERE type='Return to Shelf'").fetchone()
        self.assertIn("2 × TSH-1-BLU-M", task["description"])
        self.assertEqual(self.stock_of("TSH-1-BLU-M")["on_hand"], 8)
        issues_svc.resolve_issue(self.conn, OFFICE, task["id"], "Back in A-01-01")
        self.assertEqual(self.stock_of("TSH-1-BLU-M")["on_hand"], 10)


class MissedPickup(FHTestCase):
    def test_sweep_flags_missed_pickup_once_and_rolls_to_next(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        self.pick_all(o["id"])
        self.scan_all(o["id"])
        pkg = self.pack(o["id"])["package"]
        dispatch.stage_package(self.conn, WORKER, pkg["id"], "Lane C")
        first_pickup = clock.parse(pkg["pickup_at"])
        clock.set_now(first_pickup + timedelta(minutes=10))
        self.assertEqual(dispatch.sweep(self.conn), 0)
        clock.set_now(first_pickup + timedelta(minutes=30))
        self.assertEqual(dispatch.sweep(self.conn), 1)
        self.assertEqual(dispatch.sweep(self.conn), 0)
        issue = self.conn.execute("SELECT * FROM issues WHERE type='Missed Pickup'").fetchone()
        self.assertEqual(issue["package_id"], pkg["id"])
        rolled = dispatch.get_package(self.conn, pkg["id"])
        self.assertGreater(rolled["pickup_at"], pkg["pickup_at"])
        dispatch.handover(self.conn, WORKER, pkg["courier_id"], [pkg["id"]])
        st = self.conn.execute("SELECT status FROM issues WHERE id=?", (issue["id"],)).fetchone()["status"]
        self.assertEqual(st, "Resolved")
