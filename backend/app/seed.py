"""Demo data.

Builds a believable warehouse relative to *now*: ~270 orders over the last day and a half
(plus a few stuck older ones), 50 SKUs, two warehouses, four couriers, and a set of deliberate
exceptions. Orders are pushed through the REAL service functions with a simulated clock, so
inventory, reservations, packages, issues and the activity log are always consistent.

Run:  python -m app.seed      (drops and rebuilds the database)
"""
import random
from datetime import datetime, timedelta, timezone

from . import clock, config
from .db import connect, drop_all, init_schema, transaction, one, all_rows
from .services import dispatch, inventory as inv, issues as issues_svc, orders as orders_svc, packing, picking
from .services import reorders as reorders_svc
from .services.common import (
    Actor, MAIN, SECONDARY, READY_TO_PICK, PICKING, READY_TO_PACK, PACKED, STAGED, SHIPPED, AWAITING_STOCK, set_meta,
)

OFFICE = [Actor("Priya (Office)", "office"), Actor("Arjun (Office)", "office")]
FLOOR = [Actor("Ravi (Warehouse)", "warehouse"), Actor("Meena (Warehouse)", "warehouse"),
         Actor("Suresh (Warehouse)", "warehouse")]

COURIERS = [
    ("DLV", "Delhivery", "11:00,17:00", 55, 3, 5, "Lane 1 · Delhivery"),
    ("BLD", "BlueDart", "15:00", 95, 1, 2, "Lane 2 · BlueDart"),
    ("XPB", "XpressBees", "12:00,18:30", 45, 4, 6, "Lane 3 · XpressBees"),
    ("SFX", "Shadowfax", "16:00", 65, 2, 3, "Lane 4 · Shadowfax"),
]

COLORS = {"BLU": "Blue", "BLK": "Black", "WHT": "White", "GRY": "Grey", "NVY": "Navy", "IND": "Indigo", "NAT": "Natural",
          "OLV": "Olive", "SLV": "Silver", "TEAL": "Teal", "KHK": "Khaki", "MIX": "Mixed", "CRM": "Cream", "SGE": "Sage",
          "BRN": "Brown", "SND": "Sand", "CHR": "Charcoal", "YEL": "Yellow", "PPL": "Purple", "GRN": "Green"}

FAMILIES = [
    ("TSH-014", "Essential Cotton Tee", "Apparel", ["BLU-M", "BLU-L", "BLK-M", "BLK-L", "WHT-M", "WHT-L"], 0.22, 599, True, 5),
    ("HOD-002", "Everyday Hoodie", "Apparel", ["GRY-M", "GRY-L", "NVY-M", "NVY-L"], 0.65, 1799, True, 3),
    ("SHO-009", "Stride Runner Shoe", "Footwear", ["BLK-41", "BLK-42", "BLK-43", "WHT-42"], 0.90, 3499, False, 3),
    ("JNS-021", "Slim Fit Jeans", "Apparel", ["IND-30", "IND-32", "IND-34", "BLK-32"], 0.70, 2199, False, 3),
    ("BAG-004", "Canvas Tote Bag", "Bags", ["NAT", "OLV", "BLK"], 0.35, 899, True, 3),
    ("BTL-010", "Insulated Steel Bottle 750ml", "Home", ["SLV", "BLK", "TEAL"], 0.45, 1099, True, 3),
    ("CAP-006", "Classic Baseball Cap", "Accessories", ["NVY", "BLK", "KHK"], 0.12, 499, True, 3),
    ("SCK-003", "Ankle Socks (3-pack)", "Apparel", ["WHT", "BLK", "MIX"], 0.15, 349, True, 4),
    ("MUG-007", "Stoneware Mug", "Home", ["CRM", "SGE"], 0.50, 649, True, 2),
    ("WAL-012", "Leather Bifold Wallet", "Accessories", ["BRN", "BLK"], 0.15, 1299, False, 2),
    ("NBK-001", "A5 Dotted Notebook", "Stationery", ["SND", "CHR"], 0.30, 399, True, 2),
    ("JKT-018", "Lightweight Rain Jacket", "Apparel", ["YEL-M", "YEL-L", "NVY-M", "NVY-L"], 0.55, 2999, False, 2),
    ("YGM-005", "Yoga Mat 6mm", "Fitness", ["PPL", "GRN"], 1.20, 1499, True, 2),
    ("LMP-011", "LED Desk Lamp", "Home", ["WHT", "BLK"], 1.10, 1899, True, 1),
    ("EAR-015", "Wireless Earbuds", "Electronics", ["BLK", "WHT"], 0.18, 2499, False, 3),
    ("CHG-008", "20W USB-C Charger", "Electronics", ["WHT"], 0.12, 999, False, 3),
    ("PHC-016", "Silicone Phone Case", "Accessories", ["BLK-IP15", "BLU-IP15", "BLK-S24"], 0.06, 599, False, 4),
]

FIRST = ["Aarav", "Ananya", "Vihaan", "Diya", "Arjun", "Ishita", "Kabir", "Meera", "Rohan", "Sneha", "Aditya", "Kavya",
         "Rahul", "Pooja", "Siddharth", "Nisha", "Karthik", "Lakshmi", "Varun", "Priyanka", "Farhan", "Zoya", "Manoj",
         "Divya", "Nikhil", "Ritu", "Harish", "Swati", "Imran", "Neha", "Gaurav", "Tanvi", "Deepak", "Aishwarya"]
LAST = ["Sharma", "Iyer", "Reddy", "Patel", "Nair", "Gupta", "Menon", "Rao", "Singh", "Kumar", "Das", "Joshi",
        "Pillai", "Verma", "Khan", "Bose", "Chatterjee", "Kulkarni", "Mehta", "Subramanian", "Fernandes", "Agarwal"]
CITIES = [("Chennai", "6000"), ("Bengaluru", "5600"), ("Mumbai", "4000"), ("Hyderabad", "5000"), ("Pune", "4110"),
          ("New Delhi", "1100"), ("Kolkata", "7000"), ("Coimbatore", "6410"), ("Kochi", "6820"), ("Jaipur", "3020"),
          ("Ahmedabad", "3800"), ("Mysuru", "5700")]
STREETS = ["MG Road", "3rd Cross, Indiranagar", "Anna Salai", "Linking Road", "Banjara Hills Rd 12", "FC Road",
           "Park Street", "Sector 21", "Race Course Road", "Panampilly Nagar", "C-Scheme", "Satellite Road",
           "Besant Nagar 2nd Ave", "Koramangala 5th Block", "Powai Hiranandani"]
CHANNELS = [("Amazon", 35), ("Website", 30), ("Flipkart", 25), ("Myntra", 10)]

WORK_START, WORK_END = 8, 21


class Sim:
    def __init__(self, conn, now: datetime, seed: int = 7):
        self.conn = conn
        self.now = now
        self.rng = random.Random(seed)
        self.handovers: dict[tuple[str, str], list[str]] = {}

    def at(self, t: datetime):
        clock.set_now(t.replace(microsecond=0))

    def work(self, t: datetime) -> datetime:
        """Push a timestamp into working hours."""
        lt = clock.local(t)
        if lt.hour < WORK_START:
            lt = lt.replace(hour=WORK_START, minute=self.rng.randint(0, 25), second=0)
        elif lt.hour >= WORK_END:
            lt = (lt + timedelta(days=1)).replace(hour=WORK_START, minute=self.rng.randint(0, 25), second=0)
        return lt.astimezone(timezone.utc)

    def later(self, t: datetime, lo: int, hi: int, force: bool = False) -> datetime:
        nxt = t + timedelta(minutes=self.rng.randint(lo, hi), seconds=self.rng.randint(0, 59))
        return nxt if force else self.work(nxt)

    def reference(self):
        c = self.conn
        c.execute("INSERT INTO warehouses VALUES ('MAIN','Main Warehouse','shipping',1)")
        c.execute("INSERT INTO warehouses VALUES ('SEC','Secondary Warehouse','overflow',0)")
        for row in COURIERS:
            c.execute("INSERT INTO couriers(id, name, pickup_times, cost_per_parcel, delivery_days_min, delivery_days_max,"
                      " staging_lane) VALUES (?,?,?,?,?,?,?)", row)
        aisles = "ABCDEF"
        pid = 0
        self.popularity = []
        for fi, (base, name, cat, variants, w, price, sub, pop) in enumerate(FAMILIES):
            for vi, v in enumerate(variants):
                pid += 1
                sku = f"{base}-{v}"
                parts = v.split("-")
                label = " / ".join([COLORS.get(parts[0], parts[0])] + parts[1:]) if parts[0] in COLORS else \
                    " / ".join(parts)
                if base == "PHC-016":
                    label = {"BLK-IP15": "Black / iPhone 15", "BLU-IP15": "Blue / iPhone 15",
                             "BLK-S24": "Black / Galaxy S24"}[v]
                c.execute("INSERT INTO products(id, sku, base_code, name, category, variant, weight_kg, price,"
                          " substitutable, low_stock_threshold) VALUES (?,?,?,?,?,?,?,?,?,?)",
                          (pid, sku, base, name, cat, label, w, price, 1 if sub else 0, 5))
                main_bin = f"{aisles[fi % 6]}-{(fi // 6) * 3 + vi // 4 + 1:02d}-{vi % 4 + 1:02d}"
                sec_bin = f"S-{fi + 1:02d}-{vi + 1:02d}"
                main_cap = inv.default_capacity(cat, MAIN)
                sec_cap = inv.default_capacity(cat, SECONDARY)
                main_qty = self.rng.randint(int(main_cap * 0.8), main_cap)
                sec_qty = self.rng.randint(10, 40)
                c.execute("INSERT INTO inventory(product_id, warehouse_id, bin, on_hand, capacity) VALUES (?,?,?,?,?)",
                          (pid, MAIN, main_bin, main_qty, main_cap))
                c.execute("INSERT INTO inventory(product_id, warehouse_id, bin, on_hand, capacity) VALUES (?,?,?,?,?)",
                          (pid, SECONDARY, sec_bin, sec_qty, sec_cap))
                self.popularity.append((sku, pop))
        self.set_stock("SHO-009-BLK-42", main=0, sec=8)
        self.set_stock("BAG-004-OLV", main=0, sec=0)
        self.set_stock("EAR-015-BLK", main=14, sec=20)
        self.set_stock("SHO-009-WHT-42", main=6, sec=0)
        self.set_stock("LMP-011-BLK", main=9, sec=4)
        self.set_stock("HOD-002-GRY-L", main=12, sec=6)
        self.special_skus = {"SHO-009-BLK-42", "BAG-004-OLV"}

    def set_stock(self, sku, main, sec):
        p = inv.product_by_sku(self.conn, sku)
        self.conn.execute("UPDATE inventory SET on_hand=? WHERE product_id=? AND warehouse_id='MAIN'", (main, p["id"]))
        self.conn.execute("UPDATE inventory SET on_hand=? WHERE product_id=? AND warehouse_id='SEC'", (sec, p["id"]))

    def customer(self):
        r = self.rng
        city, pin = r.choice(CITIES)
        return {
            "customer_name": f"{r.choice(FIRST)} {r.choice(LAST)}",
            "phone": f"9{r.randint(100000000, 999999999)}",
            "address": f"{r.randint(1, 240)}, {r.choice(STREETS)}",
            "city": city, "pincode": f"{pin}{r.randint(10, 99)}",
        }

    def channel(self, ch: str | None = None):
        r = self.rng
        ch = ch or r.choices([c for c, _ in CHANNELS], weights=[w for _, w in CHANNELS])[0]
        ref = {"Amazon": lambda: f"402-{r.randint(1000000, 9999999)}-{r.randint(1000000, 9999999)}",
               "Flipkart": lambda: f"OD{r.randint(10**17, 10**18 - 1)}",
               "Myntra": lambda: f"MYN{r.randint(10**9, 10**10 - 1)}",
               "Website": lambda: f"#WEB{r.randint(10000, 99999)}"}[ch]()
        return ch, ref

    def items(self):
        r = self.rng
        n = r.choices([1, 2, 3, 4], weights=[55, 30, 11, 4])[0]
        pool = [(s, w) for s, w in self.popularity if s not in self.special_skus]
        skus = set()
        while len(skus) < n:
            skus.add(r.choices([s for s, _ in pool], weights=[w for _, w in pool])[0])
        return [{"sku": s, "qty": r.choices([1, 2, 3], weights=[82, 14, 4])[0]} for s in sorted(skus)]

    def received_times(self, n: int) -> list[datetime]:
        """Weighted to daytime hours, spread over the last ~36 hours."""
        out = []
        weights = {h: (0.15 if h < 7 else 0.6 if h < 9 else 1.0 if h < 22 else 0.4) for h in range(24)}
        while len(out) < n:
            t = self.now - timedelta(minutes=self.rng.randint(8, 36 * 60))
            if self.rng.random() < weights[clock.local(t).hour]:
                out.append(t.replace(microsecond=0))
        return sorted(out)

    def flow(self, spec: dict):
        """Push one order as far as time allows (or up to spec['cap'])."""
        c, r = self.conn, self.rng
        cap = spec.get("cap", SHIPPED)
        order_rank = [READY_TO_PICK, PICKING, READY_TO_PACK, PACKED, STAGED, SHIPPED]
        allowed = lambda s: order_rank.index(s) <= order_rank.index(cap) if cap in order_rank else False
        self.at(spec["received"])
        o = orders_svc.create_order(c, Actor("System", "system"), channel=spec["channel"], channel_ref=spec["ref"],
                                    priority=spec["priority"], items=spec["items"], received_at=spec["received"],
                                    **spec["customer"])
        spec["id"] = o["id"]
        if cap == "RECEIVED":
            return o
        pr = spec["priority"]
        f = spec.get("force", False)
        t = spec.get("process_at") or self.later(spec["received"], 5 if pr else 10, 25 if pr else 70, f)
        if t > self.now:
            return o
        self.at(t)
        o = orders_svc.process_order(c, r.choice(OFFICE), o["id"])
        if o["status"] != READY_TO_PICK or cap == AWAITING_STOCK or not allowed(PICKING):
            return o
        picker = r.choice(FLOOR)
        t = self.later(t, 10 if pr else 25, 60 if pr else 260, f)
        if t > self.now:
            return o
        self.at(t)
        picking.start_picking(c, picker, o["id"])
        items = sorted(orders_svc.items_for(c, o["id"]), key=lambda i: i["bin"] or "")
        stop_after = len(items) if allowed(READY_TO_PACK) else r.randint(0, len(items) - 1)
        for k, it in enumerate(items):
            if k >= stop_after:
                return o
            t = t + timedelta(minutes=r.randint(2, 6), seconds=r.randint(0, 59))
            if t > self.now:
                return o
            self.at(t)
            picking.pick_item(c, picker, it["id"])
        if not allowed(PACKED):
            return o
        packer = r.choice(FLOOR)
        t = self.later(t, 5 if pr else 10, 30 if pr else 110, f)
        if t > self.now:
            return o
        self.at(t)
        if spec.get("wrong_scan"):
            first = items[0]
            sib = one(c, "SELECT sku FROM products WHERE base_code = ? AND sku != ? ORDER BY sku LIMIT 1",
                      (first["base_code"], first["sku"]))
            packing.scan_item(c, packer, o["id"], sib["sku"] if sib else "PHC-016-BLK-S24")
            if spec.get("stop_after_wrong_scan"):
                return o
            t += timedelta(minutes=1)
            self.at(t)
        for it in items:
            for _ in range(it["qty"]):
                packing.scan_item(c, packer, o["id"], it["sku"])
        ptype = packing.suggest_package_type(c, o["id"])
        w = packing._expected_weight(c, o["id"], ptype) * r.uniform(0.96, 1.05)
        t += timedelta(minutes=r.randint(2, 5))
        self.at(t)
        res = packing.complete_packing(c, packer, o["id"], package_type=ptype, weight_kg=round(w, 2),
                                       label_code=f"LBL-{o['id']}")
        pkg = res["package"]
        if not allowed(STAGED):
            return o
        t = t + timedelta(minutes=r.randint(4, 35))
        if t > self.now:
            return o
        self.at(t)
        where = dispatch.suggest_location(c, pkg)["location"]
        dispatch.stage_package(c, r.choice(FLOOR), pkg["id"], where)
        pkg = dispatch.get_package(c, pkg["id"])
        if clock.parse(pkg["pickup_at"]) <= t and not spec.get("miss_pickup"):
            cour = orders_svc.courier(c, pkg["courier_id"])
            nxt = clock.next_pickup(cour["pickups"], t)
            c.execute("UPDATE packages SET pickup_at=? WHERE id=?", (clock.iso(nxt), pkg["id"]))
            pkg = dispatch.get_package(c, pkg["id"])
        if cap == SHIPPED and not spec.get("miss_pickup") and clock.parse(pkg["pickup_at"]) <= self.now:
            self.handovers.setdefault((pkg["pickup_at"], pkg["courier_id"]), []).append(pkg["id"])
        return o

    def run_handovers(self):
        for (slot, courier_id), ids in sorted(self.handovers.items()):
            t = clock.parse(slot) + timedelta(minutes=self.rng.randint(2, 12))
            if t > self.now:
                t = self.now - timedelta(minutes=1)
            self.at(t)
            trig = "on_arrival" if courier_id == "XPB" else "manual"
            dispatch.handover(self.conn, self.rng.choice(FLOOR), courier_id, ids, trigger=trig)


def build(conn, now: datetime | None = None) -> dict:
    now = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    sim = Sim(conn, now)
    r = sim.rng
    sim.reference()

    specs = []
    for t in sim.received_times(262):
        ch, ref = sim.channel()
        specs.append({"received": t, "priority": r.random() < 0.15, "channel": ch, "ref": ref,
                      "customer": sim.customer(), "items": sim.items()})
    for s in r.sample(specs[:120], 9):
        s["cap"] = r.choice([READY_TO_PICK, PICKING, READY_TO_PACK, PACKED])
    for s in r.sample(specs[40:200], 3):
        s["wrong_scan"] = True

    def spec(received, priority, items, customer=None, channel=None, **kw):
        ch, ref = sim.channel(channel)
        d = {"received": received.replace(microsecond=0), "priority": priority, "channel": ch, "ref": ref,
             "customer": customer or sim.customer(), "items": items}
        d.update(kw)
        return d

    older = now - timedelta(hours=52)
    specials = {
        "delayed_priority": spec(older, True, [{"sku": "JNS-021-IND-32", "qty": 1}, {"sku": "SCK-003-BLK", "qty": 2}],
                                 cap=READY_TO_PICK),
        "delayed_normal": spec(older + timedelta(minutes=40), False, [{"sku": "BTL-010-TEAL", "qty": 1}], cap=PICKING),
        "missed_1": spec(now - timedelta(hours=30), False, [{"sku": "MUG-007-SGE", "qty": 2}], miss_pickup=True, cap=STAGED),
        "missed_2": spec(now - timedelta(hours=29), True, [{"sku": "YGM-005-GRN", "qty": 1}], miss_pickup=True, cap=STAGED),
        "shoe_wait": spec(now - timedelta(hours=5), False, [{"sku": "SHO-009-BLK-42", "qty": 1}],
                          process_at=now - timedelta(hours=4, minutes=40), cap=AWAITING_STOCK),
        "bag_wait": spec(now - timedelta(hours=6), False, [{"sku": "BAG-004-OLV", "qty": 1}, {"sku": "NBK-001-SND", "qty": 1}],
                         process_at=now - timedelta(hours=5, minutes=30), cap=AWAITING_STOCK),
        "not_found": spec(now - timedelta(hours=9), False, [{"sku": "HOD-002-GRY-L", "qty": 1}, {"sku": "CAP-006-NVY", "qty": 1}],
                          process_at=now - timedelta(hours=8, minutes=20), cap="SPECIAL"),
        "dup_original": spec(now - timedelta(hours=20), False, [{"sku": "PHC-016-BLU-IP15", "qty": 1}], channel="Amazon"),
        "dup_copy": spec(now - timedelta(hours=3), False, [{"sku": "PHC-016-BLU-IP15", "qty": 1}], channel="Amazon",
                         process_at=now - timedelta(hours=2, minutes=45)),
        "bad_address": spec(now - timedelta(hours=2), True, [{"sku": "WAL-012-BRN", "qty": 1}],
                            customer={"customer_name": "Farhan Qureshi", "phone": "", "address": "Flat 4B",
                                      "city": "Hyderabad", "pincode": ""},
                            process_at=now - timedelta(hours=1, minutes=40)),
        "cancel_after_pick": spec(now - timedelta(hours=7), False, [{"sku": "JKT-018-NVY-L", "qty": 1},
                                                                    {"sku": "CAP-006-BLK", "qty": 1}],
                                  process_at=now - timedelta(hours=6, minutes=30), cap="CANCEL"),
        "scan_error": spec(now - timedelta(hours=4), True, [{"sku": "TSH-014-WHT-M", "qty": 2}],
                           process_at=now - timedelta(hours=3, minutes=50), wrong_scan=True, stop_after_wrong_scan=True,
                           cap=PACKED),
        "fresh_priority": spec(now - timedelta(minutes=18), True, [{"sku": "EAR-015-WHT", "qty": 1},
                                                                   {"sku": "CHG-008-WHT", "qty": 1}], cap="RECEIVED"),
    }
    specials["dup_copy"]["ref"] = specials["dup_original"]["ref"]
    demo = spec(now - timedelta(minutes=52), True, [{"sku": "SHO-009-BLK-42", "qty": 2}, {"sku": "TSH-014-BLU-M", "qty": 1}],
                customer={"customer_name": "Ananya Iyer", "phone": "9840012345", "address": "14, Besant Nagar 2nd Avenue",
                          "city": "Chennai", "pincode": "600090"},
                channel="Website", process_at=now - timedelta(minutes=38), cap=AWAITING_STOCK)
    specials["demo"] = demo
    for s in specials.values():
        s["force"] = True
        if s.get("process_at") and s["process_at"] > now:
            s["process_at"] = now - timedelta(minutes=1)

    all_specs = specs + list(specials.values())
    all_specs.sort(key=lambda s: s["received"])
    for s in all_specs:
        cap = s.get("cap")
        if cap in ("SPECIAL", "CANCEL"):
            s["cap"] = READY_TO_PACK if cap == "CANCEL" else READY_TO_PICK
        sim.flow(s)

    c = conn
    nf = specials["not_found"]
    o = orders_svc.get_order_row(c, nf["id"])
    if o["status"] in (READY_TO_PICK, PICKING):
        t = now - timedelta(hours=1, minutes=5)
        sim.at(t)
        picker = FLOOR[0]
        for it in orders_svc.items_for(c, o["id"]):
            if it["sku"] == "CAP-006-NVY" and it["pick_status"] == "pending":
                picking.pick_item(c, picker, it["id"])
        sim.at(t + timedelta(minutes=3))
        hood = next(i for i in orders_svc.items_for(c, o["id"]) if i["sku"] == "HOD-002-GRY-L")
        if hood["pick_status"] == "pending":
            picking.report_problem(c, picker, hood["id"], "not_found", "Bin A-01-02 has navy hoodies only")

    ca = specials["cancel_after_pick"]
    o = orders_svc.get_order_row(c, ca["id"])
    if o["status"] in (PICKING, READY_TO_PACK):
        sim.at(now - timedelta(hours=1, minutes=10))
        orders_svc.cancel_order(c, OFFICE[0], o["id"], "Customer cancelled on the marketplace")

    sim.at(now - timedelta(hours=46))
    ro1 = reorders_svc.create_reorder(c, OFFICE[0], "Sonic Gadgets India",
                                      [{"sku": "CHG-008-WHT", "qty": 12}, {"sku": "EAR-015-WHT", "qty": 6}],
                                      MAIN, clock.iso(now - timedelta(hours=30)), "Weekly electronics top-up")
    sim.at(now - timedelta(hours=29, minutes=30))
    d1 = ro1["deliveries"][0]["id"]
    got = {"CHG-008-WHT": 12, "EAR-015-WHT": 5}
    r1 = inv.receive_inbound(c, FLOOR[0], d1, [{"line_id": l["id"], "received_qty": got[l["sku"]], "damaged_qty": 0}
                                              for l in inv.get_inbound(c, d1)["lines"]],
                             missing_action="close", putaway_now=True)
    short = one(c, "SELECT id FROM issues WHERE dedupe_key = ?", (f"recv:{d1}",))
    if short:
        sim.at(now - timedelta(hours=27))
        issues_svc.resolve_issue(c, OFFICE[0], short["id"], "Supplier out of stock on white earbuds — credit note received.")

    sim.at(now - timedelta(hours=26))
    reorders_svc.create_reorder(c, OFFICE[1], "Urban Threads Pvt Ltd",
                                [{"sku": "BAG-004-OLV", "qty": 12}, {"sku": "TSH-014-BLK-M", "qty": 20},
                                 {"sku": "SCK-003-MIX", "qty": 24}],
                                MAIN, clock.iso(now + timedelta(hours=3)), "Totes sold out in both warehouses")

    c.execute("""INSERT INTO inbound(id, supplier, warehouse_id, expected_at, status, source)
                 VALUES ('IN-0099','HomeGoods Traders','SEC',?, 'expected', 'supplier')""",
              (clock.iso(now - timedelta(hours=28)),))
    lines_99 = []
    for sku, q in [("MUG-007-CRM", 18), ("BTL-010-SLV", 15)]:
        cur = c.execute("INSERT INTO inbound_lines(inbound_id, product_id, expected_qty) VALUES ('IN-0099', ?, ?)",
                        (inv.product_by_sku(c, sku)["id"], q))
        lines_99.append((cur.lastrowid, q))
    sim.at(now - timedelta(hours=27, minutes=30))
    inv.receive_inbound(c, FLOOR[1], "IN-0099", [{"line_id": l, "received_qty": q, "damaged_qty": 0} for l, q in lines_99])
    sim.at(now - timedelta(hours=27))
    for l, _ in lines_99:
        inv.putaway_line(c, FLOOR[1], l)

    sim.at(now - timedelta(hours=50))
    ro3 = reorders_svc.create_reorder(c, OFFICE[0], "StepUp Footwear",
                                      [{"sku": "SHO-009-WHT-42", "qty": 10}, {"sku": "SHO-009-BLK-41", "qty": 8},
                                       {"sku": "JNS-021-BLK-32", "qty": 6}],
                                      MAIN, clock.iso(now - timedelta(hours=5)))
    sim.at(now - timedelta(hours=3, minutes=40))
    d3 = ro3["deliveries"][0]["id"]
    got = {"SHO-009-WHT-42": (9, 0), "SHO-009-BLK-41": (8, 1), "JNS-021-BLK-32": (6, 0)}
    inv.receive_inbound(c, FLOOR[2], d3, [{"line_id": l["id"], "received_qty": got[l["sku"]][0],
                                           "damaged_qty": got[l["sku"]][1]} for l in inv.get_inbound(c, d3)["lines"]],
                        missing_action="backorder", backorder_expected_at=clock.iso(now + timedelta(days=1, hours=2)))

    sim.at(now - timedelta(hours=40))
    reorders_svc.create_reorder(c, OFFICE[1], "FitGear Wholesale", [{"sku": "YGM-005-GRN", "qty": 10}],
                                MAIN, clock.iso(now - timedelta(hours=16)), "Green mats running low")

    sim.at(now - timedelta(hours=2, minutes=15))
    tr = inv.create_transfer(c, OFFICE[1], "EAR-015-BLK", 8, "Top-up: earbuds selling fast")
    sim.at(now - timedelta(hours=1, minutes=50))
    inv.dispatch_transfer(c, FLOOR[0], tr["id"])
    sim.at(now - timedelta(hours=24))
    tr2 = inv.create_transfer(c, OFFICE[0], "YGM-005-PPL", 6, "Weekly rebalance")
    sim.at(now - timedelta(hours=22))
    inv.receive_transfer(c, FLOOR[2], tr2["id"])

    sim.run_handovers()

    sim.at(now - timedelta(hours=23))
    i1 = issues_svc.create_issue(c, OFFICE[0], type="Courier Delay", severity="Low",
                                 title="BlueDart pickup arrived 40 minutes late",
                                 description="Driver reported traffic on the ring road. All parcels collected.")
    sim.at(now - timedelta(hours=22, minutes=30))
    issues_svc.close_issue(c, OFFICE[0], i1["id"], "Logged with BlueDart account manager")
    sim.at(now - timedelta(hours=10))
    i2 = issues_svc.create_issue(c, FLOOR[1], type="Packing Problem", severity="Low",
                                 title="Running low on medium boxes",
                                 description="About 30 medium boxes left at the packing station.")
    sim.at(now - timedelta(hours=9, minutes=20))
    issues_svc.update_issue(c, OFFICE[1], i2["id"], status="In Progress", assignee="Arjun (Office)")
    sim.at(now - timedelta(hours=5))
    issues_svc.create_issue(c, FLOOR[0], type="Other", severity="Low", title="Label printer at station 2 jams occasionally",
                            description="Works after reloading the roll. Needs a service visit.")

    sim.at(now - timedelta(minutes=50))
    held = one(c, """SELECT p.* FROM packages p JOIN orders o ON o.id = p.order_id
                     WHERE p.status = 'staged' AND o.priority = 0 ORDER BY p.staged_at LIMIT 1""")
    if held:
        issues_svc.create_issue(c, OFFICE[0], type="Address Problem", severity="High", blocking=True,
                                title=f"Customer asked to change the delivery address for {held['order_id']}",
                                description="Confirm the new address with the customer and reprint the label before it ships.",
                                order_id=held["order_id"], package_id=held["id"])
        dispatch.stage_package(c, FLOOR[0], held["id"], "Rack B-04")

    clock.set_now(now)
    dispatch.sweep(c)
    for cid, mode in (("XPB", "on_arrival"), ("SFX", "scheduled")):
        c.execute("UPDATE couriers SET handover_mode = ? WHERE id = ?", (mode, cid))
    set_meta(c, "demo_order_id", demo["id"])
    set_meta(c, "seeded_at", clock.iso(now))
    clock.set_now(None)
    return summary(conn) | {"demo_order_id": demo["id"]}


def summary(conn) -> dict:
    s = lambda sql: conn.execute(sql).fetchone()["n"]
    return {
        "orders": s("SELECT COUNT(*) AS n FROM orders"),
        "products": s("SELECT COUNT(*) AS n FROM products"),
        "packages": s("SELECT COUNT(*) AS n FROM packages"),
        "issues_open": s("SELECT COUNT(*) AS n FROM issues WHERE status != 'Resolved'"),
        "activity": s("SELECT COUNT(*) AS n FROM activity"),
    }


def reset_database(path: str | None = None, now: datetime | None = None) -> dict:
    conn = connect(path)
    try:
        with transaction(conn):
            drop_all(conn)
            init_schema(conn)
            result = build(conn, now)
        return {"ok": True, **result}
    finally:
        clock.set_now(None)
        conn.close()


if __name__ == "__main__":
    import json
    print(json.dumps(reset_database(), indent=2))
