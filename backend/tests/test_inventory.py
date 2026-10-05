from app.services import inventory as inv
from app.services import orders as orders_svc
from app.services.common import AWAITING_STOCK, READY_TO_PICK, DomainError

from helpers import FHTestCase, OFFICE, WORKER


class Reservation(FHTestCase):
    def test_processing_reserves_stock(self):
        self.processed([("TSH-1-BLU-M", 3)])
        s = self.stock_of("TSH-1-BLU-M")
        self.assertEqual((s["on_hand"], s["reserved"]), (10, 3))

    def test_same_stock_cannot_be_allocated_twice(self):
        a = self.processed([("CAP-1-NVY", 2)])
        b = self.processed([("CAP-1-NVY", 2)])
        self.assertEqual(a["status"], READY_TO_PICK)
        self.assertEqual(b["status"], AWAITING_STOCK)
        self.assertEqual(self.stock_of("CAP-1-NVY")["reserved"], 2)

    def test_reservation_is_all_or_nothing(self):
        o = self.processed([("TSH-1-BLU-M", 1), ("SHO-1-BLK-42", 1)])
        self.assertEqual(o["status"], AWAITING_STOCK)
        self.assertEqual(self.stock_of("TSH-1-BLU-M")["reserved"], 0)

    def test_cancel_releases_reservation_and_feeds_waiting_order(self):
        a = self.processed([("CAP-1-NVY", 2)])
        b = self.processed([("CAP-1-NVY", 2)])
        orders_svc.cancel_order(self.conn, OFFICE, a["id"], "Customer changed mind")
        self.assertEqual(self.status(b["id"]), READY_TO_PICK)
        self.assertEqual(self.stock_of("CAP-1-NVY")["reserved"], 2)

    def test_adjust_cannot_go_below_reserved(self):
        self.processed([("TSH-1-BLU-M", 4)])
        with self.assertRaises(DomainError):
            inv.adjust_stock(self.conn, OFFICE, "TSH-1-BLU-M", "MAIN", 3, "cycle count")
        row = inv.adjust_stock(self.conn, OFFICE, "TSH-1-BLU-M", "MAIN", 6, "cycle count")
        self.assertEqual(row["on_hand"], 6)


class Transfers(FHTestCase):
    def test_blocked_reason_explains_transfer(self):
        o = self.processed([("SHO-1-BLK-42", 2)], priority=True)
        b = orders_svc.blocked_info(self.conn, o)
        self.assertIn("needs 2 units", b["reasons"][0])
        self.assertIn("Main Warehouse has 0 available", b["reasons"][0])
        self.assertIn("Secondary Warehouse has 8", b["reasons"][0])
        nxt = orders_svc.next_action(self.conn, o, b, None)
        self.assertEqual(nxt["cta"]["kind"], "create_transfer")
        self.assertEqual(nxt["cta"]["qty"], 8)

    def test_suggestion_covers_all_waiting_orders(self):
        self.processed([("SHO-1-BLK-42", 2)], priority=True)
        self.processed([("SHO-1-BLK-42", 1)])
        s = inv.shortages(self.conn)[0]
        self.assertEqual(s["shortfall"], 3)
        self.assertEqual(s["suggested_transfer_qty"], 8)
        inv.set_capacity(self.conn, OFFICE, "SHO-1-BLK-42", "MAIN", 2)
        self.assertEqual(inv.shortages(self.conn)[0]["suggested_transfer_qty"], 3)
        self.assertEqual(len(s["orders"]), 2)
        self.assertTrue(s["orders"][0]["priority"])

    def test_transfer_moves_stock_and_unblocks_priority_first(self):
        normal = self.processed([("SHO-1-BLK-42", 2)])
        pri = self.processed([("SHO-1-BLK-42", 2)], priority=True)
        t = inv.create_transfer(self.conn, OFFICE, "SHO-1-BLK-42", 2)
        sec = self.stock_of("SHO-1-BLK-42", "SEC")
        self.assertEqual((sec["on_hand"], sec["reserved"]), (8, 2))
        res = inv.receive_transfer(self.conn, WORKER, t["id"])
        self.assertEqual(res["unblocked_orders"], [pri["id"]])
        self.assertEqual(self.status(pri["id"]), READY_TO_PICK)
        self.assertEqual(self.status(normal["id"]), AWAITING_STOCK)
        main, sec = self.stock_of("SHO-1-BLK-42"), self.stock_of("SHO-1-BLK-42", "SEC")
        self.assertEqual((main["on_hand"], main["reserved"]), (2, 2))
        self.assertEqual((sec["on_hand"], sec["reserved"]), (6, 0))

    def test_duplicate_open_transfer_is_prevented(self):
        inv.create_transfer(self.conn, OFFICE, "SHO-1-BLK-42", 2)
        with self.assertRaises(DomainError) as e:
            inv.create_transfer(self.conn, OFFICE, "SHO-1-BLK-42", 2)
        self.assertEqual(e.exception.code, "duplicate_transfer")

    def test_receive_transfer_twice_is_idempotent(self):
        t = inv.create_transfer(self.conn, OFFICE, "SHO-1-BLK-42", 3)
        inv.receive_transfer(self.conn, WORKER, t["id"])
        inv.receive_transfer(self.conn, WORKER, t["id"])
        self.assertEqual(self.stock_of("SHO-1-BLK-42")["on_hand"], 3)

    def test_cannot_transfer_more_than_secondary_has(self):
        with self.assertRaises(DomainError) as e:
            inv.create_transfer(self.conn, OFFICE, "SHO-1-BLK-42", 9)
        self.assertEqual(e.exception.code, "insufficient_secondary")


class Receiving(FHTestCase):
    def _delivery(self, sku="CAP-1-NVY", qty=10):
        self.conn.execute("INSERT INTO inbound(id, supplier, warehouse_id, expected_at, status) VALUES ('IN-1','Supplier','MAIN','2026-09-28T06:00:00Z','expected')")
        pid = inv.product_by_sku(self.conn, sku)["id"]
        cur = self.conn.execute("INSERT INTO inbound_lines(inbound_id, product_id, expected_qty) VALUES ('IN-1', ?, ?)", (pid, qty))
        return cur.lastrowid

    def test_received_stock_is_not_sellable_until_put_away(self):
        waiting = self.processed([("CAP-1-NVY", 5)])
        self.assertEqual(waiting["status"], AWAITING_STOCK)
        line = self._delivery()
        inv.receive_inbound(self.conn, WORKER, "IN-1", [{"line_id": line, "received_qty": 10, "damaged_qty": 0}])
        s = self.stock_of("CAP-1-NVY")
        self.assertEqual((s["on_hand"], s["awaiting_putaway"]), (3, 10))
        self.assertEqual(self.status(waiting["id"]), AWAITING_STOCK)
        res = inv.putaway_line(self.conn, WORKER, line, "B-02-01")
        s = self.stock_of("CAP-1-NVY")
        self.assertEqual((s["on_hand"], s["awaiting_putaway"], s["bin"]), (13, 0, "B-02-01"))
        self.assertEqual(res["unblocked_orders"], [waiting["id"]])

    def test_short_delivery_creates_issue_and_receive_is_once_only(self):
        line = self._delivery()
        inv.receive_inbound(self.conn, WORKER, "IN-1", [{"line_id": line, "received_qty": 8, "damaged_qty": 1}])
        issue = self.conn.execute("SELECT * FROM issues WHERE type='Receiving Shortage'").fetchone()
        self.assertIn("expected 10, received 8", issue["description"])
        self.assertEqual(self.stock_of("CAP-1-NVY")["awaiting_putaway"], 7)
        with self.assertRaises(DomainError):
            inv.receive_inbound(self.conn, WORKER, "IN-1", [{"line_id": line, "received_qty": 8, "damaged_qty": 1}])
