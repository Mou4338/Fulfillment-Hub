from datetime import datetime, timedelta, timezone

from app import clock
from app.services import orders as orders_svc
from app.services.common import AWAITING_STOCK, ON_HOLD, READY_TO_PICK, RECEIVED, DomainError

from helpers import FHTestCase, OFFICE, WORKER, T0


class ShipByAndRisk(FHTestCase):
    def test_priority_before_cutoff_ships_same_day(self):
        o = self.order([("TSH-1-BLU-M", 1)], priority=True)
        ship_by = clock.local(clock.parse(o["ship_by"]))
        self.assertEqual(ship_by.date(), clock.local(T0).date())
        self.assertEqual(ship_by.strftime("%H:%M"), "18:00")
        self.assertFalse(o["after_cutoff"])

    def test_priority_after_cutoff_rolls_to_next_day_and_is_flagged(self):
        late = clock.at_local_time(clock.local(T0), clock.hhmm("15:30"))
        clock.set_now(late)
        o = self.order([("TSH-1-BLU-M", 1)], priority=True, received_at=late)
        ship_by = clock.local(clock.parse(o["ship_by"]))
        self.assertEqual(ship_by.date(), clock.local(T0).date() + timedelta(days=1))
        self.assertTrue(o["after_cutoff"])

    def test_normal_ships_next_day(self):
        o = self.order([("TSH-1-BLU-M", 1)])
        self.assertEqual(clock.local(clock.parse(o["ship_by"])).date(), clock.local(T0).date() + timedelta(days=1))

    def test_on_track_at_risk_delayed(self):
        o = self.order([("TSH-1-BLU-M", 1)], priority=True)
        self.assertEqual(orders_svc.risk_of(o)["state"], "on_track")
        clock.set_now(clock.parse(o["ship_by"]) - timedelta(minutes=120))
        self.assertEqual(orders_svc.risk_of(o)["state"], "at_risk")
        clock.set_now(clock.parse(o["ship_by"]) + timedelta(minutes=1))
        r = orders_svc.risk_of(o)
        self.assertEqual(r["state"], "delayed")
        self.assertIn("ago", r["reason"])

    def test_blocked_priority_order_is_at_risk_even_with_time_left(self):
        o = self.processed([("SHO-1-BLK-42", 1)], priority=True)
        self.assertEqual(o["status"], AWAITING_STOCK)
        self.assertEqual(orders_svc.risk_of(o, blocked=True)["state"], "at_risk")

    def test_delayed_priority_order_tops_action_queue(self):
        from app.services import dashboard
        o = self.processed([("TSH-1-BLU-M", 1)], priority=True)
        self.processed([("TSH-1-BLU-L", 1)])
        clock.set_now(clock.parse(o["ship_by"]) + timedelta(hours=1))
        d = dashboard.dashboard(self.conn)
        self.assertEqual(d["kpis"]["delayed"], 1)
        self.assertEqual(d["action_queue"][0]["order_id"], o["id"])


class Processing(FHTestCase):
    def test_courier_recommendation_is_explained(self):
        pri = self.processed([("TSH-1-BLU-M", 1)], priority=True)
        self.assertEqual(pri["courier_id"], "FAST")
        self.assertIn("Fastest delivery", pri["courier_reason"])
        norm = self.processed([("TSH-1-BLU-L", 1)])
        self.assertEqual(norm["courier_id"], "CHEAP")
        self.assertIn("Lowest cost", norm["courier_reason"])

    def test_incomplete_address_goes_on_hold_with_issue(self):
        o = self.order([("TSH-1-BLU-M", 1)], pincode="", phone="")
        o = orders_svc.process_order(self.conn, OFFICE, o["id"])
        self.assertEqual(o["status"], ON_HOLD)
        issues = self.conn.execute("SELECT * FROM issues WHERE order_id=?", (o["id"],)).fetchall()
        self.assertEqual(issues[0]["type"], "Address Problem")
        self.assertEqual(self.stock_of("TSH-1-BLU-M")["reserved"], 0)
        b = orders_svc.blocked_info(self.conn, o)
        self.assertTrue(b["blocked"])

    def test_duplicate_channel_reference_is_held(self):
        self.processed([("TSH-1-BLU-M", 1)], ref="AMZ-1")
        dup = self.order([("TSH-1-BLU-M", 1)], ref="AMZ-1")
        dup = orders_svc.process_order(self.conn, OFFICE, dup["id"])
        self.assertEqual(dup["status"], ON_HOLD)
        self.assertIn("duplicate", dup["hold_reason"].lower())

    def test_release_hold_processes_the_order(self):
        o = self.order([("TSH-1-BLU-M", 1)], pincode="")
        orders_svc.process_order(self.conn, OFFICE, o["id"])
        with self.assertRaises(DomainError):
            orders_svc.release_hold(self.conn, OFFICE, o["id"], "")
        o = orders_svc.release_hold(self.conn, OFFICE, o["id"], "Customer confirmed PIN 600001 by phone")
        self.assertEqual(o["status"], READY_TO_PICK)
        open_ = self.conn.execute("SELECT COUNT(*) AS n FROM issues WHERE status != 'Resolved'").fetchone()["n"]
        self.assertEqual(open_, 0)

    def test_process_twice_is_rejected_without_side_effects(self):
        o = self.processed([("TSH-1-BLU-M", 2)])
        with self.assertRaises(DomainError):
            orders_svc.process_order(self.conn, OFFICE, o["id"])
        self.assertEqual(self.stock_of("TSH-1-BLU-M")["reserved"], 2)

    def test_warehouse_role_cannot_process(self):
        o = self.order([("TSH-1-BLU-M", 1)])
        with self.assertRaises(DomainError) as e:
            orders_svc.process_order(self.conn, WORKER, o["id"])
        self.assertEqual(e.exception.status, 403)
        self.assertEqual(self.status(o["id"]), RECEIVED)
