"""Packing verification: every unit is scanned, the label is checked, the weight is sanity-checked."""
from .. import clock, config
from ..db import one, all_rows
from .common import Actor, DomainError, READY_TO_PACK, PACKED, STATUS_LABELS, next_id, log
from . import issues as issues_svc
from . import orders as orders_svc


def pack_queue(conn) -> list[dict]:
    rows = orders_svc.list_orders(conn, sort="urgency")
    q = [r for r in rows if r["status"] == READY_TO_PACK]
    q.sort(key=lambda r: (not r["scan_error"], not r["priority"], r["ship_by"]))
    return q


def _expected_weight(conn, order_id: str, package_type: str | None = None) -> float:
    w = one(conn, """SELECT COALESCE(SUM(p.weight_kg * oi.qty), 0) AS w FROM order_items oi
                     JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?""", (order_id,))["w"]
    tare = config.PACKAGE_TYPES.get(package_type or "", {}).get("tare_kg", 0)
    return round(w + tare, 2)


def suggest_package_type(conn, order_id: str) -> str:
    w = _expected_weight(conn, order_id)
    units = one(conn, "SELECT SUM(qty) AS n FROM order_items WHERE order_id=?", (order_id,))["n"] or 0
    if w <= 0.5 and units <= 2:
        return "Mailer bag"
    if w <= 1.5:
        return "Small box"
    if w <= 4:
        return "Medium box"
    return "Large box"


def scan_item(conn, actor: Actor, order_id: str, code: str, at=None) -> dict:
    """Simulated barcode scan. Returns ok/false with a precise, human message; never raises for a wrong item."""
    o = orders_svc.get_order_row(conn, order_id)
    if o["status"] != READY_TO_PACK:
        raise DomainError(f"Order {o['id']} is {STATUS_LABELS[o['status']].lower()} — items are verified only at "
                          "packing, after picking is complete", code="invalid_transition")
    code = (code or "").strip().upper()
    if not code:
        raise DomainError("Scan or type a SKU", code="validation", status=422)
    at = at or clock.now_iso()
    items = orders_svc.items_for(conn, o["id"])
    match = next((i for i in items if i["sku"] == code), None)
    if match:
        if match["verified_qty"] >= match["qty"]:
            msg = f"Too many — all {match['qty']} × {match['sku']} are already scanned. Put the extra unit back."
            return _fail(conn, actor, o, "over_scan", msg, at)
        conn.execute("UPDATE order_items SET verified_qty = verified_qty + 1 WHERE id=?", (match["id"],))
        conn.execute("UPDATE orders SET last_scan_error=NULL WHERE id=?", (o["id"],))
        n = match["verified_qty"] + 1
        log(conn, actor, "item_verified", f"Verified {match['sku']} ({n}/{match['qty']})", order_id=o["id"],
            product_id=match["product_id"], at=at)
        remaining = sum(i["qty"] - i["verified_qty"] for i in items) - 1
        return {"ok": True, "kind": "match", "sku": match["sku"],
                "message": f"Correct — {match['name']} ({match['variant']}) {n} of {match['qty']}",
                "remaining_units": remaining}
    scanned = one(conn, "SELECT * FROM products WHERE sku = ?", (code,))
    pending = [i for i in items if i["verified_qty"] < i["qty"]]
    if scanned:
        same_product = next((i for i in pending if i["base_code"] == scanned["base_code"]), None) or \
            next((i for i in items if i["base_code"] == scanned["base_code"]), None)
        if same_product:
            msg = (f"Wrong variant — expected {same_product['sku']} ({same_product['variant']}), "
                   f"scanned {scanned['sku']} ({scanned['variant']})")
            return _fail(conn, actor, o, "wrong_variant", msg, at, product_id=scanned["id"])
        exp = ", ".join(f"{i['sku']}" for i in pending) or "nothing else"
        msg = f"Wrong product — {scanned['sku']} ({scanned['name']}) is not in this order. Expected: {exp}"
        return _fail(conn, actor, o, "wrong_sku", msg, at, product_id=scanned["id"])
    msg = f"Unknown barcode '{code}'. Check the label on the item and scan again."
    return _fail(conn, actor, o, "unknown", msg, at)


def _fail(conn, actor, o, kind, msg, at, product_id=None) -> dict:
    conn.execute("UPDATE orders SET last_scan_error=?, scan_failures = scan_failures + 1 WHERE id=?", (msg, o["id"]))
    log(conn, actor, "scan_failed", f"Verification failed: {msg}", order_id=o["id"], product_id=product_id, at=at)
    if kind in ("wrong_variant", "wrong_sku"):
        typ = "Wrong Variant" if kind == "wrong_variant" else "Wrong SKU"
        issues_svc.create_issue(conn, actor, type=typ, severity="Medium", title=f"{o['id']}: {typ.lower()} caught at packing",
                                description=f"{msg}. Caught before shipping — the wrong unit was not packed.",
                                order_id=o["id"], product_id=product_id, dedupe_key=f"scan:{o['id']}:{typ}", at=at)
    return {"ok": False, "kind": kind, "message": msg}


def reset_scans(conn, actor: Actor, order_id: str) -> dict:
    o = orders_svc.get_order_row(conn, order_id)
    if o["status"] != READY_TO_PACK:
        raise DomainError("Only orders at the packing station can be re-scanned")
    conn.execute("UPDATE order_items SET verified_qty = 0 WHERE order_id=?", (o["id"],))
    conn.execute("UPDATE orders SET last_scan_error=NULL WHERE id=?", (o["id"],))
    log(conn, actor, "scans_reset", "Scans cleared — starting verification again", order_id=o["id"])
    return orders_svc.get_order_row(conn, o["id"])


def complete_packing(conn, actor: Actor, order_id: str, *, package_type: str, weight_kg: float, label_code: str,
                     confirm_weight: bool = False, at=None) -> dict:
    o = orders_svc.get_order_row(conn, order_id)
    if o["status"] == PACKED:
        pkg = one(conn, "SELECT * FROM packages WHERE order_id=?", (o["id"],))
        return {"ok": True, "order": o, "package": pkg, "already": True}
    if o["status"] != READY_TO_PACK:
        raise DomainError(f"Order {o['id']} is {STATUS_LABELS[o['status']].lower()} — it can only be packed after all "
                          "items are picked", code="invalid_transition")
    items = orders_svc.items_for(conn, o["id"])
    total = sum(i["qty"] for i in items)
    verified = sum(min(i["verified_qty"], i["qty"]) for i in items)
    if verified < total:
        raise DomainError(f"Scan every item first — {verified} of {total} units verified", code="not_verified")
    blocking = issues_svc.blocking_issues_for_order(conn, o["id"])
    if blocking:
        raise DomainError(f"{blocking[0]['id']} ({blocking[0]['type']}) must be resolved before packing",
                          code="blocking_issue")
    if package_type not in config.PACKAGE_TYPES:
        raise DomainError("Choose a package type", code="validation", status=422)
    label = (label_code or "").strip().upper()
    if not label:
        raise DomainError("Scan the shipping label on the box", code="validation", status=422)
    if label != o["label_code"]:
        other = one(conn, "SELECT id FROM orders WHERE label_code = ?", (label,))
        at_ = at or clock.now_iso()
        if other:
            msg = f"Label belongs to a different order ({other['id']}). Find the label for {o['id']} before sealing the box."
            issues_svc.create_issue(conn, actor, type="Label Mismatch", severity="High",
                                    title=f"{o['id']}: label for {other['id']} scanned at packing",
                                    description=msg + " Caught before shipping.", order_id=o["id"],
                                    dedupe_key=f"label:{o['id']}:{label}", at=at_)
        else:
            msg = f"Label '{label}' is not recognised. The label for this order is {o['label_code']}."
        log(conn, actor, "label_failed", f"Label check failed: {msg}", order_id=o["id"], at=at_)
        return {"ok": False, "code": "label_mismatch", "message": msg}
    if weight_kg is None or weight_kg <= 0:
        raise DomainError("Enter the parcel weight from the scale", code="validation", status=422)
    expected = _expected_weight(conn, o["id"], package_type)
    diff_pct = abs(weight_kg - expected) / expected * 100 if expected else 0
    at = at or clock.now_iso()
    if diff_pct > config.WEIGHT_TOLERANCE_PCT:
        if not confirm_weight:
            raise DomainError(f"Weight looks off: expected about {expected:.2f} kg, scale says {weight_kg:.2f} kg. "
                              "Re-weigh, or confirm if you're sure the box is correct.", code="weight_mismatch",
                              details={"expected_kg": expected, "entered_kg": weight_kg})
        issues_svc.create_issue(conn, actor, type="Weight Mismatch", severity="Low",
                                title=f"{o['id']}: parcel weight {weight_kg:.2f} kg vs expected {expected:.2f} kg",
                                description="Packer confirmed the contents after a weight warning.", order_id=o["id"],
                                dedupe_key=f"weight:{o['id']}", at=at)
    c = orders_svc.courier(conn, o["courier_id"])
    pkg_id = next_id(conn, "package", "PKG-", 5, start=50001)
    pickup = clock.next_pickup(c["pickups"], clock.parse(at))
    conn.execute("INSERT INTO packages(id, order_id, package_type, dims, weight_kg, courier_id, label_code, status,"
                 " pickup_at, packed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (pkg_id, o["id"], package_type, config.PACKAGE_TYPES[package_type]["dims"], round(weight_kg, 2),
                  c["id"], o["label_code"], "packed", clock.iso(pickup), at))
    conn.execute("UPDATE orders SET status=?, packed_at=?, last_scan_error=NULL WHERE id=?", (PACKED, at, o["id"]))
    issues_svc.auto_resolve(conn, actor, order_id=o["id"], types=["Wrong SKU", "Wrong Variant", "Label Mismatch"],
                            resolution="Correct items and label verified at packing")
    log(conn, actor, "packed", f"Packed into {package_type} ({weight_kg:.2f} kg) as {pkg_id}; label {o['label_code']} verified",
        order_id=o["id"], package_id=pkg_id, at=at)
    return {"ok": True, "order": orders_svc.get_order_row(conn, o["id"]),
            "package": one(conn, "SELECT * FROM packages WHERE id=?", (pkg_id,)), "already": False}


def pack_detail(conn, order_id: str) -> dict:
    d = orders_svc.order_detail(conn, order_id)
    d["suggested_package_type"] = suggest_package_type(conn, d["id"])
    d["expected_weight_by_type"] = {t: _expected_weight(conn, d["id"], t) for t in config.PACKAGE_TYPES}
    return d
