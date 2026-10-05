"""Activity records: every action lands on the record, labelled, categorised and filterable."""
from helpers import FHTestCase, OFFICE, WORKER

from app import clock
from app.services import activity
from app.services.common import Actor


class ActivityRecords(FHTestCase):
    def flow(self):
        o = self.processed([("TSH-1-BLU-M", 1)])
        self.pick_all(o["id"])
        self.scan_all(o["id"])
        self.pack(o["id"])
        return o

    def test_real_flow_is_recorded_with_labels_and_categories(self):
        o = self.flow()
        res = activity.records(self.conn, order_id=o["id"], limit=200)
        self.assertGreater(res["total"], 0)
        cats = {r["category"] for r in res["items"]}
        self.assertTrue({"orders", "picking", "packing"} <= cats, cats)
        for r in res["items"]:
            self.assertIn(r["action"], activity.ACTIONS, f"unlabelled action {r['action']}")
            self.assertTrue(r["label"])
        ats = [r["at"] for r in res["items"]]
        self.assertEqual(ats, sorted(ats, reverse=True))

    def test_filters(self):
        self.flow()
        everyone = activity.records(self.conn, limit=500)["total"]
        mine = activity.records(self.conn, actor=OFFICE.name, limit=500)
        theirs = activity.records(self.conn, actor=WORKER.name, limit=500)
        self.assertTrue(mine["total"] and theirs["total"])
        self.assertTrue(all(r["actor"] == OFFICE.name for r in mine["items"]))
        self.assertLessEqual(mine["total"] + theirs["total"], everyone)
        wh = activity.records(self.conn, role="warehouse")
        self.assertTrue(all(r["role"] == "warehouse" for r in wh["items"]))
        packing = activity.records(self.conn, category="packing")
        self.assertTrue(packing["total"] and all(r["category"] == "packing" for r in packing["items"]))
        self.assertEqual(sum(c["count"] for c in packing["categories"]), everyone)
        self.assertEqual(activity.records(self.conn, q="no-such-thing-xyz")["total"], 0)
        today = clock.local(clock.now()).date().isoformat()
        self.assertEqual(activity.records(self.conn, date_from=today, date_to=today)["total"], everyone)
        self.assertEqual(activity.records(self.conn, date_from="2001-01-01", date_to="2001-01-01")["total"], 0)

    def test_paging_has_no_gaps_or_overlaps(self):
        self.flow()
        total = activity.records(self.conn)["total"]
        seen = []
        offset = 0
        while True:
            page = activity.records(self.conn, limit=3, offset=offset)
            seen += [r["id"] for r in page["items"]]
            if not page["has_more"]:
                break
            offset += 3
        self.assertEqual(len(seen), total)
        self.assertEqual(len(set(seen)), total)

    def test_people_summary_and_sign_in(self):
        self.flow()
        activity.record_session(self.conn, Actor("Ravi (Warehouse)", "warehouse"), previous="Priya (Office)")
        last = activity.records(self.conn, limit=1)["items"][0]
        self.assertEqual(last["action"], "role_switched")
        self.assertEqual(last["category"], "team")
        self.assertIn("switched from Priya (Office)", last["message"])
        people = {p["actor"]: p for p in activity.people(self.conn)}
        self.assertIn(OFFICE.name, people)
        self.assertEqual(people[OFFICE.name]["total"], activity.records(self.conn, actor=OFFICE.name)["total"])
        self.assertEqual(people["Ravi (Warehouse)"]["last"]["action"], "role_switched")
        self.assertIsNotNone(people[WORKER.name]["top_category"])

    def test_unknown_actions_still_read_well(self):
        from app.services.common import log
        log(self.conn, OFFICE, "something_new", "A future action")
        r = activity.records(self.conn, category="team")["items"][0]
        self.assertEqual(r["label"], "Something new")
