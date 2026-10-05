"""Staging areas, courier arrival, automatic / manual handover modes and the shipped list."""
from datetime import timedelta

from helpers import FHTestCase, OFFICE, WORKER

from app import clock
from app.services import dispatch, issues as issues_svc
from app.services.common import DomainError, SHIPPED, STAGED


class Base(FHTestCase):
    def packed(self, priority=False):
        o = self.processed([("TSH-1-BLU-M", 1)], priority=priority)
        self.pick_all(o["id"])
        self.scan_all(o["id"])
        return self.pack(o["id"])["package"]


class StagingAreas(Base):
    def test_every_area_is_listed_with_a_purpose(self):
        names = {a["name"]: a for a in dispatch.areas(self.conn)}
        for n in ("Lane F", "Lane C", "Priority Shelf P-01", "Dispatch Zone 1", "Dispatch Zone 2", "Rack B-04"):
            self.assertIn(n, names)
            self.assertTrue(names[n]["purpose"])
        board = dispatch.staging_board(self.conn)
        self.assertEqual({a["name"] for a in board["areas"]}, set(names))

    def test_unknown_area_and_wrong_lane_are_refused(self):
        pkg = self.packed()
        with self.assertRaises(DomainError):
            dispatch.stage_package(self.conn, WORKER, pkg["id"], "Somewhere")
        with self.assertRaises(DomainError) as e:
            dispatch.stage_package(self.conn, WORKER, pkg["id"], "Lane F")
        self.assertEqual(e.exception.code, "wrong_lane")
        dispatch.stage_package(self.conn, WORKER, pkg["id"], "Lane F", confirm_other_lane=True)
        self.assertTrue(dispatch.staging_board(self.conn)["counts"]["wrong_lane"])
        dispatch.stage_package(self.conn, WORKER, pkg["id"], "dispatch zone 1")
        self.assertEqual(dispatch.get_package(self.conn, pkg["id"])["staging_location"], "Dispatch Zone 1")

    def test_suggestions(self):
        normal, prio = self.packed(), self.packed(priority=True)
        self.assertEqual(dispatch.suggest_location(self.conn, normal)["location"], "Lane C")
        self.assertEqual(dispatch.suggest_location(self.conn, prio)["location"], "Priority Shelf P-01")
        issues_svc.create_issue(self.conn, OFFICE, type="Other", severity="High", title="Check address", blocking=True,
                                order_id=normal["order_id"])
        self.assertEqual(dispatch.suggest_location(self.conn, normal)["location"], "Rack B-04")

    def test_hold_rack_parcels_never_leave(self):
        pkg = self.packed()
        dispatch.stage_package(self.conn, WORKER, pkg["id"], "Rack B-04")
        with self.assertRaises(DomainError):
            dispatch.handover(self.conn, WORKER, "CHEAP", [pkg["id"]])
        ready, not_ready = dispatch.ready_parcels(self.conn, "CHEAP")
        self.assertEqual((len(ready), len(not_ready)), (0, 1))
        self.assertIn("hold rack", not_ready[0]["reason"])


class CourierArrival(Base):
    def test_manual_mode_records_arrival_then_hands_over_the_ticked_parcels(self):
        a, b = self.packed(), self.packed()
        for p in (a, b):
            dispatch.stage_package(self.conn, WORKER, p["id"], "Lane C")
        r = dispatch.courier_arrived(self.conn, WORKER, "CHEAP")
        self.assertEqual(r["handed_over"], [])
        self.assertEqual(sorted(r["ready"]), sorted([a["id"], b["id"]]))
        self.assertTrue(dispatch.handover_board(self.conn)["couriers"][0]["on_site"])
        r = dispatch.courier_arrived(self.conn, WORKER, "CHEAP", [a["id"]])
        self.assertEqual(r["handed_over"], [a["id"]])
        self.assertEqual(r["manifest"]["trigger"], "manual")
        self.assertEqual(self.status(a["order_id"]), SHIPPED)
        self.assertEqual(self.status(b["order_id"]), STAGED)

    def test_automatic_on_arrival_hands_over_everything_ready(self):
        dispatch.set_handover_mode(self.conn, OFFICE, "CHEAP", "on_arrival")
        a, b, blocked = self.packed(), self.packed(), self.packed()
        for p in (a, b, blocked):
            dispatch.stage_package(self.conn, WORKER, p["id"], "Lane C")
        issues_svc.create_issue(self.conn, OFFICE, type="Other", severity="Critical", title="Fraud check",
                                order_id=blocked["order_id"])
        r = dispatch.courier_arrived(self.conn, WORKER, "CHEAP")
        self.assertEqual(sorted(r["handed_over"]), sorted([a["id"], b["id"]]))
        self.assertEqual(r["manifest"]["trigger"], "on_arrival")
        self.assertEqual([x["id"] for x in r["not_ready"]], [blocked["id"]])
        visit = self.conn.execute("SELECT * FROM courier_visits").fetchone()
        self.assertEqual((visit["parcels"], visit["left_behind"], visit["trigger"]), (2, 1, "on_arrival"))

    def test_scheduled_mode_hands_over_at_pickup_time_instead_of_missing_it(self):
        dispatch.set_handover_mode(self.conn, OFFICE, "CHEAP", "scheduled")
        pkg = self.packed()
        dispatch.stage_package(self.conn, WORKER, pkg["id"], "Lane C")
        pickup = clock.parse(dispatch.get_package(self.conn, pkg["id"])["pickup_at"])
        clock.set_now(pickup - timedelta(minutes=5))
        dispatch.sweep(self.conn)
        self.assertEqual(self.status(pkg["order_id"]), STAGED)
        clock.set_now(pickup + timedelta(minutes=30))
        self.assertEqual(dispatch.sweep(self.conn), 0)
        self.assertEqual(self.status(pkg["order_id"]), SHIPPED)
        shipped = dispatch.get_package(self.conn, pkg["id"])
        self.assertEqual(shipped["handed_over_at"], clock.iso(pickup))
        s = dispatch.shipped(self.conn, "all")
        self.assertEqual(s["parcels"][0]["trigger"], "scheduled")
        self.assertEqual(s["stats"]["automatic"], 1)

    def test_only_the_office_changes_the_mode(self):
        with self.assertRaises(DomainError) as e:
            dispatch.set_handover_mode(self.conn, WORKER, "CHEAP", "on_arrival")
        self.assertEqual(e.exception.status, 403)
        with self.assertRaises(DomainError):
            dispatch.set_handover_mode(self.conn, OFFICE, "CHEAP", "teleport")


class ShippedList(Base):
    def test_filters(self):
        pkg = self.packed()
        dispatch.stage_package(self.conn, WORKER, pkg["id"], "Lane C")
        dispatch.handover(self.conn, WORKER, "CHEAP", [pkg["id"]])
        self.assertEqual(len(dispatch.shipped(self.conn, "today")["parcels"]), 1)
        self.assertEqual(len(dispatch.shipped(self.conn, "yesterday")["parcels"]), 0)
        self.assertEqual(len(dispatch.shipped(self.conn, "all", "FAST")["parcels"]), 0)
        self.assertEqual(len(dispatch.shipped(self.conn, "all", q=pkg["order_id"])["parcels"]), 1)
        self.assertEqual(len(dispatch.shipped(self.conn, "all")["visits"]), 1)
