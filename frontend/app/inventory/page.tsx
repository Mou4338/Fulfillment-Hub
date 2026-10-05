"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  LuArrowRightLeft, LuCircleCheck, LuLock, LuPencil, LuTriangleAlert, LuTruck, LuInbox, LuRuler,
  LuShieldCheck, LuChevronDown, LuChevronUp, LuShoppingCart,
} from "react-icons/lu";
import { post } from "@/lib/api";
import { useApi, useNow, useQueryParams } from "@/lib/hooks";
import { useRole, useToast, useWarehouse } from "@/lib/context";
import { cx, fmtWhen, plural } from "@/lib/format";
import type { BinCell, BinMap, InventoryRow, Replenishment, ReplenishItem } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, ErrorState, PageSkeleton, Skeleton } from "@/components/EmptyState";
import { SearchInput, Select, Tabs } from "@/components/FilterBar";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { QtyInput } from "@/components/QtyInput";

type TransferDraft = { sku: string; qty: number; note: string; max?: number };

export default function InventoryPage() {
  const [params, setParams, ready] = useQueryParams();
  const view = params.get("view") || "";
  const mode = params.get("mode") || (view || params.get("sku") ? "list" : "bins");
  const sort = params.get("sort") || "";
  const [q, setQ] = useState("");
  useEffect(() => setQ(params.get("q") || params.get("sku") || ""), [params]);
  const { data, error, loading, reload } = useApi<InventoryRow[]>(
    ready && mode === "list" ? `/api/inventory?view=${view}&sort=${sort}&q=${encodeURIComponent(q)}` : null,
  );
  const { warehouse, setWarehouse } = useWarehouse();
  const { data: bins, error: binsError, reload: reloadBins } = useApi<BinMap>(ready && mode === "bins" ? `/api/inventory/bins?warehouse=${warehouse}` : null);
  const { data: shortages } = useApi<any[]>("/api/inventory/shortages");
  const { data: rep } = useApi<Replenishment>("/api/inventory/replenishment");
  const { data: transfers } = useApi<any[]>("/api/transfers");
  const { isOffice } = useRole();
  const toast = useToast();
  const now = useNow();
  const [transfer, setTransfer] = useState<TransferDraft | null>(null);
  const [adjust, setAdjust] = useState<{ row: InventoryRow; wh: "MAIN" | "SEC"; value: string; reason: string } | null>(null);
  const [capacity, setCapacity] = useState<{ sku: string; bin: string | null; wh: "MAIN" | "SEC"; value: string; current: number } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [showAllRep, setShowAllRep] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<any>, ok: string | ((r: any) => string)) {
    setBusy(true);
    try {
      const r = await fn();
      toast(typeof ok === "function" ? ok(r) : ok);
      setTransfer(null);
      setAdjust(null);
      setCapacity(null);
      setBulkOpen(false);
      reload();
      reloadBins();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const openTransfers = (transfers || []).filter((t) => t.status === "requested" || t.status === "in_transit");
  const recentTransfers = (transfers || []).filter((t) => t.status === "received").slice(0, 4);
  const repItems = (rep?.items || []).filter((i) => !i.blocking_orders);
  const shownRep = showAllRep ? repItems : repItems.slice(0, 6);
  const officeTitle = isOffice ? "" : "Office team only";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory & bins"
        subtitle="Available = on hand − reserved. Only the Main Warehouse ships. Stock waiting for put-away can’t be sold yet."
        actions={
          <Link href="/guide#inventory" className="btn btn-secondary">
            How this works
          </Link>
        }
      />

      {shortages && shortages.length > 0 && (
        <section className="card overflow-hidden border-amber-200">
          <div className="border-b border-amber-100 bg-amber-50/60 px-5 py-3">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-amber-900">
              <LuTriangleAlert className="h-4 w-4" /> Stock blocking orders
            </h2>
            <p className="text-xs text-amber-800">Orders are already stuck on these SKUs. Each row shows the fastest fix.</p>
          </div>
          <ul className="divide-y divide-line">
            {shortages.map((s) => (
              <li key={s.sku} className={cx("flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center", params.get("sku") === s.sku && "flash bg-brand-50/40")}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    <span className="mono">{s.sku}</span> <span className="font-normal text-ink-muted">· {s.name} ({s.variant})</span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    Waiting orders need <b>{s.needed}</b>. Main has <b>{s.main_available}</b> available, Secondary has <b>{s.secondary_available}</b>.
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {s.orders.map((o: any) => (
                      <Link key={o.order_id} href={`/orders/${o.order_id}`} className={cx("chip", o.priority ? "bg-orange-50 text-orange-700 ring-orange-200" : "bg-slate-100 text-ink-soft ring-slate-200")}>
                        {o.order_id} × {o.qty}
                      </Link>
                    ))}
                  </p>
                </div>
                <div className="shrink-0">
                  {s.open_transfer ? (
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                      <LuTruck className="h-4 w-4" /> {s.open_transfer.id} {s.open_transfer.status === "in_transit" ? "on its way" : "requested"}
                    </span>
                  ) : s.suggested_transfer_qty > 0 ? (
                    <button
                      className="btn btn-primary"
                      disabled={!isOffice}
                      title={officeTitle}
                      onClick={() =>
                        setTransfer({
                          sku: s.sku,
                          qty: s.suggested_transfer_qty,
                          max: s.secondary_available,
                          note:
                            s.suggested_transfer_qty > s.shortfall
                              ? `Covers the ${plural(s.orders.length, "waiting order")} (${s.shortfall} units) and refills the bin.`
                              : `Covers all ${plural(s.orders.length, "waiting order")}.`,
                        })
                      }
                    >
                      <LuArrowRightLeft className="h-4 w-4" /> Transfer {s.suggested_transfer_qty} from Secondary
                    </button>
                  ) : s.incoming_delivery ? (
                    <Link href={`/receiving?delivery=${s.incoming_delivery.id}`} className="btn btn-secondary">
                      <LuInbox className="h-4 w-4" /> {s.incoming_delivery.status === "received" ? "Put away delivery" : `Delivery ${s.incoming_delivery.id} due`}
                    </Link>
                  ) : (
                    <span className="flex flex-col items-start gap-1 sm:items-end">
                      <Link href={`/reorders?sku=${s.sku}`} className="btn btn-primary">
                        <LuShoppingCart className="h-4 w-4" /> Reorder from supplier
                      </Link>
                      <span className="text-xs font-semibold text-red-600">No stock in either warehouse</span>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Preventive refills: below half of the bin's capacity */}
      <section className={cx("card overflow-hidden", repItems.length ? "border-sky-200" : "")} id="replenish">
        <div className="flex flex-col gap-3 border-b border-line bg-sky-50/50 px-5 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-sky-950">
              <LuShieldCheck className="h-4 w-4 text-sky-700" /> Transfer required — below {rep?.rule.below_pct ?? 50}% in Main (preventive)
            </h2>
            <p className="text-xs text-sky-900/80">
              When the <b>available</b> units of a SKU in its Main bin drop below half of the bin’s capacity, refill it from the Secondary Warehouse — before
              any order gets stuck.
            </p>
          </div>
          {rep && rep.transfer_required > 0 && (
            <button className="btn btn-primary shrink-0" disabled={!isOffice || busy} title={officeTitle} onClick={() => setBulkOpen(true)}>
              <LuArrowRightLeft className="h-4 w-4" /> Create all {rep.transfer_required} transfers ({rep.units_to_move} units)
            </button>
          )}
        </div>
        {!rep ? (
          <div className="p-4">
            <Skeleton className="h-24" />
          </div>
        ) : repItems.length === 0 ? (
          <EmptyState compact tone="good" icon={LuCircleCheck} title="Every Main bin is at least half full" hint="Nothing to refill right now." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {shownRep.map((i) => (
                <RepRow key={i.sku} i={i} isOffice={isOffice} onTransfer={() => setTransfer({ sku: i.sku, qty: i.suggested_qty, max: i.secondary_available, note: i.message })} />
              ))}
            </ul>
            {repItems.length > 6 && (
              <button className="flex w-full items-center justify-center gap-1 border-t border-line py-2 text-xs font-semibold text-ink-muted hover:bg-slate-50" onClick={() => setShowAllRep(!showAllRep)}>
                {showAllRep ? <LuChevronUp className="h-4 w-4" /> : <LuChevronDown className="h-4 w-4" />}
                {showAllRep ? "Show fewer" : `Show all ${repItems.length}`}
              </button>
            )}
          </>
        )}
      </section>

      {/* Main view: bins in order, or the stock list */}
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:flex-wrap lg:items-center">
          <Tabs
            value={mode}
            onChange={(v) => setParams({ mode: v, view: v === "bins" ? null : view || null })}
            tabs={[
              { value: "bins", label: "Bins in order" },
              { value: "list", label: "Stock list" },
            ]}
          />
          {mode === "bins" ? (
            <Tabs
              value={warehouse}
              onChange={(v) => setWarehouse(v as "MAIN" | "SEC")}
              tabs={[
                { value: "MAIN", label: "Main Warehouse" },
                { value: "SEC", label: "Secondary" },
              ]}
            />
          ) : (
            <Tabs
              value={view}
              onChange={(v) => setParams({ view: v || null })}
              tabs={[
                { value: "", label: "All SKUs" },
                { value: "replenish", label: "Below half", count: rep?.count },
                { value: "blocking", label: "Blocking orders", count: shortages?.length },
                { value: "low", label: "Low stock" },
                { value: "putaway", label: "Awaiting put-away" },
                { value: "reorder", label: "Reorder / on order" },
                { value: "issues", label: "Open issues" },
              ]}
            />
          )}
          <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
            {mode === "list" && (
              <Select
                label="Sort"
                value={sort}
                onChange={(v) => setParams({ sort: v || null })}
                options={[
                  { value: "", label: "Sort: needs attention" },
                  { value: "bin", label: "Sort: bin order" },
                  { value: "sku", label: "Sort: SKU" },
                ]}
              />
            )}
            <SearchInput
              value={q}
              onChange={(v) => {
                setQ(v);
                setParams({ q: v, sku: null });
              }}
              placeholder="Search SKU, product or bin"
              className="w-full sm:w-64"
            />
          </div>
        </div>

        {mode === "bins" ? (
          binsError && !bins ? (
            <div className="p-4">
              <ErrorState message={binsError} onRetry={reloadBins} />
            </div>
          ) : !bins ? (
            <PageSkeleton />
          ) : (
            <BinsView
              map={bins}
              q={q}
              isOffice={isOffice}
              onTransfer={(b) => b.replenish && setTransfer({ sku: b.sku, qty: b.replenish.suggested_qty, note: b.replenish.message })}
              onCapacity={(b) => setCapacity({ sku: b.sku, bin: b.bin, wh: bins.warehouse_id, value: String(b.capacity), current: b.capacity })}
            />
          )
        ) : loading ? (
          <PageSkeleton />
        ) : error && !data ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : !data?.length ? (
          <EmptyState
            tone={view ? "good" : "neutral"}
            icon={view ? LuCircleCheck : undefined}
            title={view === "reorder" ? "Nothing needs reordering or is on order" : view === "blocking" ? "No SKU is blocking orders" : view === "low" ? "Nothing is low on stock" : view === "replenish" ? "Every Main bin is at least half full" : "No SKUs match"}
          />
        ) : (
          <StockTable rows={data} isOffice={isOffice} highlight={params.get("sku")} onAdjust={(r) => setAdjust({ row: r, wh: "MAIN", value: String(r.main.on_hand), reason: "" })} />
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold text-ink">Transfers · Secondary → Main</h2>
          <p className="text-xs text-ink-muted">Mark “sent” when the stock leaves Secondary and “received” when it is on the Main shelf — waiting orders get it automatically.</p>
        </div>
        {openTransfers.length === 0 && recentTransfers.length === 0 ? (
          <EmptyState compact title="No transfers" />
        ) : (
          <ul className="divide-y divide-line">
            {[...openTransfers, ...recentTransfers].map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="mono font-semibold text-ink">{t.id}</span>
                <span className="text-ink-soft">
                  {t.qty} × <span className="mono">{t.sku}</span> · requested {fmtWhen(t.requested_at, now)} by {t.requested_by}
                  {t.note && <span className="text-ink-muted"> · {t.note}</span>}
                </span>
                <span
                  className={cx(
                    "chip",
                    t.status === "received" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : t.status === "in_transit" ? "bg-sky-50 text-sky-800 ring-sky-200" : "bg-slate-100 text-ink-soft ring-slate-200",
                  )}
                >
                  {t.status === "in_transit" ? "In transit" : t.status === "received" ? "Received" : "Requested"}
                </span>
                <span className="ml-auto flex gap-2">
                  {t.status === "requested" && (
                    <button className="btn btn-secondary py-1.5 text-xs" disabled={busy} onClick={() => run(() => post(`/api/transfers/${t.id}/dispatch`), `${t.id} marked as sent`)}>
                      Mark sent
                    </button>
                  )}
                  {(t.status === "requested" || t.status === "in_transit") && (
                    <button
                      className="btn btn-primary py-1.5 text-xs"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => post(`/api/transfers/${t.id}/receive`),
                          (r) => `${t.id} received at Main${r?.unblocked_orders?.length ? ` — ${plural(r.unblocked_orders.length, "waiting order")} now ready to pick` : ""}`,
                        )
                      }
                    >
                      <LuCircleCheck className="h-3.5 w-3.5" /> Received at Main
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={!!transfer}
        onClose={() => setTransfer(null)}
        title={`Transfer ${transfer?.sku}`}
        subtitle="Secondary Warehouse → Main Warehouse"
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setTransfer(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !transfer || !(transfer.qty >= 1)}
              onClick={() => transfer && run(() => post("/api/transfers", { sku: transfer.sku, qty: transfer.qty, note: "Requested from Inventory" }), `Transfer requested: ${transfer.qty} × ${transfer.sku}`)}
            >
              Request transfer
            </button>
          </>
        }
      >
        <label className="label" htmlFor="tq">
          Units
        </label>
        <input id="tq" type="number" min={1} max={transfer?.max} className="input" value={transfer?.qty ?? 1} onChange={(e) => transfer && setTransfer({ ...transfer, qty: Number(e.target.value) })} />
        {transfer?.note && <p className="mt-2 text-xs text-ink-muted">{transfer.note}</p>}
        <p className="mt-1 text-xs text-ink-muted">Units are held in Secondary as soon as you request, so they can’t be moved twice.</p>
      </Modal>

      <ConfirmDialog
        open={bulkOpen}
        title={`Create ${rep?.transfer_required} preventive transfers?`}
        message={
          <>
            <p>
              Moves <b>{rep?.units_to_move} units</b> from the Secondary Warehouse so every SKU below the {rep?.rule.below_pct}% line is refilled. Each transfer fills the
              bin up to its capacity (or as much as Secondary has).
            </p>
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-xs">
              {rep?.items
                .filter((i) => i.status === "transfer_required")
                .map((i) => (
                  <li key={i.sku}>
                    <span className="mono font-semibold">{i.sku}</span> × {i.suggested_qty} → bin {i.bin}
                  </li>
                ))}
            </ul>
          </>
        }
        confirmLabel="Create transfers"
        busy={busy}
        onCancel={() => setBulkOpen(false)}
        onConfirm={() => run(() => post("/api/inventory/replenish", {}), (r) => `${plural(r.created.length, "transfer")} requested — mark them sent when they leave Secondary`)}
      />

      <ConfirmDialog
        open={!!capacity}
        title={`Bin capacity: ${capacity?.sku}`}
        message={`How many units fit in bin ${capacity?.bin}? The “below half” line is worked out from this number.`}
        confirmLabel="Save capacity"
        busy={busy}
        onCancel={() => setCapacity(null)}
        onConfirm={() =>
          capacity && run(() => post("/api/inventory/capacity", { sku: capacity.sku, warehouse_id: capacity.wh, capacity: Number(capacity.value) }), `${capacity.sku}: capacity set to ${capacity.value}`)
        }
      >
        {capacity && (
          <div className="mt-3">
            <label className="label" htmlFor="cap">
              Units the bin holds
            </label>
            <input id="cap" type="number" min={1} className="input" value={capacity.value} onChange={(e) => setCapacity({ ...capacity, value: e.target.value })} />
            <p className="mt-1 text-xs text-ink-muted">Currently {capacity.current}. Half = {Math.floor((Number(capacity.value) || 0) / 2)} units.</p>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!adjust}
        title={`Adjust stock: ${adjust?.row.sku}`}
        message="Use this after a physical count. The change and reason are recorded in the activity log."
        confirmLabel="Save adjustment"
        busy={busy}
        onCancel={() => setAdjust(null)}
        onConfirm={() =>
          adjust &&
          run(
            () => post("/api/inventory/adjust", { sku: adjust.row.sku, warehouse_id: adjust.wh, on_hand: Number(adjust.value), reason: adjust.reason }),
            `${adjust.row.sku} updated`,
          )
        }
      >
        {adjust && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["MAIN", "SEC"] as const).map((w) => (
                <button
                  key={w}
                  className={cx("btn", adjust.wh === w ? "btn-primary" : "btn-secondary")}
                  onClick={() => setAdjust({ ...adjust, wh: w, value: String(w === "MAIN" ? adjust.row.main.on_hand : adjust.row.secondary.on_hand) })}
                >
                  {w === "MAIN" ? "Main" : "Secondary"}
                </button>
              ))}
            </div>
            {(() => {
              const w = adjust.wh === "MAIN" ? adjust.row.main : adjust.row.secondary;
              const delta = (Number(adjust.value) || 0) - w.on_hand;
              return (
                <div>
                  <label className="label">Counted on hand (bin {w.bin})</label>
                  <div className="flex items-center gap-3">
                    <QtyInput value={Number(adjust.value) || 0} min={w.reserved} onChange={(v) => setAdjust({ ...adjust, value: String(v) })} label="counted on hand" />
                    <span className={cx("text-sm font-semibold tabular-nums", delta > 0 ? "text-emerald-700" : delta < 0 ? "text-red-600" : "text-ink-muted")}>
                      {delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${delta} units`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    System says {w.on_hand} on hand, {w.reserved} reserved for orders (can’t go below that).
                    {delta > 0 && adjust.wh === "MAIN" && " Extra units go to waiting orders automatically."}
                  </p>
                </div>
              );
            })()}
            <div>
              <label className="label">Reason</label>
              <div className="mb-1.5 flex flex-wrap gap-1">
                {["Cycle count", "Found in another bin", "Damaged in storage", "Lost / missing", "Returned by customer"].map((r) => (
                  <button key={r} type="button" className={cx("chip", adjust.reason === r ? "bg-brand-50 text-brand-800 ring-brand-300" : "bg-slate-50 text-ink-soft ring-slate-200 hover:bg-slate-100")} onClick={() => setAdjust({ ...adjust, reason: r })}>
                    {r}
                  </button>
                ))}
              </div>
              <input className="input" placeholder="e.g. Cycle count on aisle B" value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} />
            </div>
            <p className="rounded-lg bg-slate-50 p-2 text-xs text-ink-muted">
              Stock from deliveries is adjusted automatically when it is counted and put away on the{" "}
              <Link href="/receiving" className="link">
                Receiving
              </Link>{" "}
              page. Use this only when a physical count differs from the system.
            </p>
            <button
              type="button"
              className="btn btn-ghost px-0 text-xs"
              onClick={() => {
                const w = adjust.wh === "MAIN" ? adjust.row.main : adjust.row.secondary;
                setAdjust(null);
                setCapacity({ sku: adjust.row.sku, bin: w.bin, wh: adjust.wh, value: String(w.capacity), current: w.capacity });
              }}
            >
              <LuRuler className="h-3.5 w-3.5" /> Change bin capacity instead
            </button>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}


const LEVEL = {
  critical: { bar: "bg-red-500", text: "text-red-600", chip: "bg-red-50 text-red-700 ring-red-200" },
  warning: { bar: "bg-amber-500", text: "text-amber-700", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  ok: { bar: "bg-brand-500", text: "text-ink", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

function FillBar({ onHand, reserved, capacity, level, linePct = 50 }: { onHand: number; reserved: number; capacity: number; level: "ok" | "warning" | "critical"; linePct?: number }) {
  const cap = Math.max(capacity, 1);
  const av = Math.max(onHand - reserved, 0);
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200/70" title={`${av} available + ${reserved} reserved of ${capacity}`}>
      <div className={cx("absolute inset-y-0 left-0", LEVEL[level].bar)} style={{ width: `${Math.min(100, (av / cap) * 100)}%` }} />
      <div className="absolute inset-y-0 bg-slate-400/60" style={{ left: `${Math.min(100, (av / cap) * 100)}%`, width: `${Math.min(100, (reserved / cap) * 100)}%` }} />
      <div className="absolute inset-y-0 w-0 border-l-2 border-dashed border-ink/50" style={{ left: `${linePct}%` }} />
    </div>
  );
}

function RepRow({ i, isOffice, onTransfer }: { i: ReplenishItem; isOffice: boolean; onTransfer: () => void }) {
  const lvl = i.level === "critical" ? "critical" : "warning";
  return (
    <li className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          <span className="mono rounded bg-ink px-1.5 py-0.5 text-xs text-white">{i.bin}</span>
          <span className="mono">{i.sku}</span>
          <span className="font-normal text-ink-muted">
            {i.name} ({i.variant})
          </span>
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <div className="w-40 shrink-0 sm:w-56">
            <FillBar onHand={i.on_hand} reserved={i.reserved} capacity={i.capacity} level={lvl} />
          </div>
          <span className={cx("text-xs font-semibold tabular-nums", LEVEL[lvl].text)}>
            {i.available} / {i.capacity} available ({i.available_pct}%)
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-muted">{i.message}</p>
      </div>
      <div className="shrink-0">
        {i.status === "transfer_required" ? (
          <button className="btn btn-secondary" disabled={!isOffice} title={isOffice ? "" : "Office team only"} onClick={onTransfer}>
            <LuArrowRightLeft className="h-4 w-4" /> Transfer {i.suggested_qty}
          </button>
        ) : i.status === "reorder" ? (
          <Link href={`/reorders?sku=${i.sku}`} className="btn btn-secondary">
            <LuShoppingCart className="h-4 w-4" /> Reorder
          </Link>
        ) : i.status === "incoming" ? (
          <Link href={`/reorders?q=${i.sku}&status=all`} className="chip bg-sky-50 text-sky-800 ring-sky-200 hover:underline">
            {i.label}
          </Link>
        ) : i.status === "putaway" ? (
          <Link href="/receiving?tab=putaway" className="chip bg-amber-50 text-amber-800 ring-amber-200 hover:underline">
            {i.label}
          </Link>
        ) : (
          <span className={cx("chip", i.status === "in_transfer" ? "bg-sky-50 text-sky-800 ring-sky-200" : LEVEL[lvl].chip)}>{i.label}</span>
        )}
      </div>
    </li>
  );
}

const BIN_STATUS: Record<BinCell["status"], { label: string; chip: string; row?: string }> = {
  ok: { label: "OK", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  warning: { label: "Below half", chip: "bg-amber-50 text-amber-800 ring-amber-200", row: "bg-amber-50/25" },
  critical: { label: "Critical", chip: "bg-red-50 text-red-700 ring-red-200", row: "bg-red-50/30" },
  blocking: { label: "Blocking orders", chip: "bg-red-600 text-white ring-red-600", row: "bg-red-50/40" },
  empty: { label: "Empty", chip: "bg-slate-100 text-ink-muted ring-slate-200" },
};

function BinsView({
  map,
  q,
  isOffice,
  onTransfer,
  onCapacity,
}: {
  map: BinMap;
  q: string;
  isOffice: boolean;
  onTransfer: (b: BinCell) => void;
  onCapacity: (b: BinCell) => void;
}) {
  const ql = q.trim().toLowerCase();
  const aisles = map.aisles
    .map((a) => ({ ...a, bins: a.bins.filter((b) => !ql || b.bin.toLowerCase().includes(ql) || b.sku.toLowerCase().includes(ql) || b.name.toLowerCase().includes(ql)) }))
    .filter((a) => a.bins.length);
  const t = map.totals;
  const main = map.warehouse_id === "MAIN";
  return (
    <div>
      <div className="grid grid-cols-2 gap-px border-b border-line bg-slate-100 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Bins", t.bins],
          ["Units on hand", t.units_on_hand],
          ["Available to sell", t.units_available],
          ["Space used", `${t.capacity ? Math.round((t.units_on_hand / t.capacity) * 100) : 0}%`],
          [main ? "Below half" : "—", main ? t.below_line : "—"],
          ["Empty bins", t.empty],
        ].map(([k, v]) => (
          <div key={k} className="bg-white px-4 py-3">
            <p className="text-xs text-ink-muted">{k}</p>
            <p className="text-lg font-semibold tabular-nums text-ink">{v}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-xs text-ink-muted">
        <span className="font-semibold text-ink-soft">How to read a bar:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded bg-brand-500" /> available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded bg-slate-400/60" /> reserved (still in the bin, promised to orders)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0 border-l-2 border-dashed border-ink/50" /> {map.rule.below_pct}% line
        </span>
        {main && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded bg-amber-500" /> below half · <span className="h-2 w-4 rounded bg-red-500" /> below {map.rule.critical_pct}%
          </span>
        )}
      </div>
      {!aisles.length && <EmptyState title="No bins match" />}
      {aisles.map((a) => (
        <div key={a.aisle}>
          <div className="flex items-center gap-3 border-b border-line bg-slate-50/80 px-4 py-2">
            <span className="flex h-7 min-w-[28px] items-center justify-center rounded-lg bg-ink px-1.5 text-xs font-bold text-white">{a.aisle}</span>
            <p className="text-sm font-semibold text-ink">{main ? `Aisle ${a.aisle}` : `Rack ${a.aisle}`}</p>
            <p className="text-xs text-ink-muted">
              {plural(a.bins.length, "bin")} · {a.units} units
              {a.attention > 0 && <span className="font-semibold text-amber-700"> · {a.attention} below half</span>}
            </p>
          </div>
          <ul className="divide-y divide-line md:hidden">
            {a.bins.map((b) => {
              const st = BIN_STATUS[b.status];
              const lvl = b.status === "critical" || b.status === "blocking" ? "critical" : b.status === "warning" ? "warning" : "ok";
              return (
                <li key={b.bin + b.sku} className={cx("space-y-1.5 px-4 py-2.5", st.row)}>
                  <div className="flex items-center gap-2">
                    <span className="mono whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-ink">{b.bin}</span>
                    <span className="mono min-w-0 flex-1 truncate text-xs font-semibold text-ink">{b.sku}</span>
                    <span className={cx("chip", st.chip)}>{st.label}</span>
                  </div>
                  <FillBar onHand={b.on_hand} reserved={b.reserved} capacity={b.capacity} level={lvl} linePct={map.rule.below_pct} />
                  <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                    <span>
                      <b className={LEVEL[lvl].text}>{b.available}</b> available · {b.reserved} reserved · {b.on_hand}/{b.capacity} in bin
                    </span>
                    {b.replenish?.status === "transfer_required" && (
                      <button className="btn btn-secondary px-2 py-1 text-xs" disabled={!isOffice} onClick={() => onTransfer(b)}>
                        Transfer {b.replenish.suggested_qty}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] table-fixed text-sm">
              <colgroup>
                <col className="w-[110px]" />
                <col />
                <col className="w-[80px]" />
                <col className="w-[80px]" />
                <col className="w-[80px]" />
                <col className="w-[80px]" />
                <col className="w-[190px]" />
                <col className="w-[230px]" />
              </colgroup>
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-1.5">Bin</th>
                  <th className="px-3 py-1.5">Item</th>
                  <th className="px-3 py-1.5 text-right">On hand</th>
                  <th className="px-3 py-1.5 text-right">Reserved</th>
                  <th className="px-3 py-1.5 text-right">Available</th>
                  <th className="px-3 py-1.5 text-right">Capacity</th>
                  <th className="min-w-[160px] px-3 py-1.5">Fill</th>
                  <th className="px-4 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {a.bins.map((b) => {
                  const st = BIN_STATUS[b.status];
                  const lvl = b.status === "critical" || b.status === "blocking" ? "critical" : b.status === "warning" ? "warning" : "ok";
                  return (
                    <tr key={b.bin + b.sku} className={st.row}>
                      <td className="px-4 py-2">
                        <span className="mono whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-ink">{b.bin}</span>
                      </td>
                      <td className="px-3 py-2">
                        <p className="mono truncate text-xs font-semibold text-ink">{b.sku}</p>
                        <p className="truncate text-xs text-ink-muted">
                          {b.name} · {b.variant}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.on_hand}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{b.reserved || "—"}</td>
                      <td className={cx("px-3 py-2 text-right font-semibold tabular-nums", LEVEL[lvl].text)}>{b.available}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {isOffice ? (
                          <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => onCapacity(b)} title="Change bin capacity">
                            {b.capacity} <LuPencil className="h-3 w-3" />
                          </button>
                        ) : (
                          b.capacity
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <FillBar onHand={b.on_hand} reserved={b.reserved} capacity={b.capacity} level={lvl} linePct={map.rule.below_pct} />
                        <p className="mt-0.5 text-[11px] text-ink-muted">
                          {b.available_pct}% available{b.awaiting_putaway ? ` · ${b.awaiting_putaway} waiting to be put away` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cx("chip", st.chip)}>{st.label}</span>
                          {b.replenish?.status === "transfer_required" && (
                            <button className="btn btn-secondary px-2 py-1 text-xs" disabled={!isOffice} title={isOffice ? b.replenish.message : "Office team only"} onClick={() => onTransfer(b)}>
                              <LuArrowRightLeft className="h-3.5 w-3.5" /> Transfer {b.replenish.suggested_qty}
                            </button>
                          )}
                          {b.replenish && b.replenish.below_line && b.replenish.status !== "transfer_required" && (
                            b.replenish.status === "reorder" ? (
                              <Link href={`/reorders?sku=${b.sku}`} className="text-[11px] font-semibold text-red-700 hover:underline" title={b.replenish.message}>
                                <LuShoppingCart className="mr-0.5 inline h-3 w-3" /> Reorder
                              </Link>
                            ) : (
                              <span className="text-[11px] font-semibold text-ink-muted" title={b.replenish.message}>
                                {b.replenish.label}
                              </span>
                            )
                          )}
                          {b.has_open_issue && <span className="chip bg-orange-50 text-orange-700 ring-orange-200">Issue</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function StockTable({ rows, isOffice, highlight, onAdjust }: { rows: InventoryRow[]; isOffice: boolean; highlight: string | null; onAdjust: (r: InventoryRow) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="table-head">
            <th className="px-4 py-2.5">SKU</th>
            <th className="whitespace-nowrap px-3 py-2.5">Main bin</th>
            <th className="px-3 py-2.5 text-right">On hand</th>
            <th className="px-3 py-2.5 text-right">Reserved</th>
            <th className="px-3 py-2.5 text-right">Available</th>
            <th className="min-w-[140px] px-3 py-2.5">Bin fill</th>
            <th className="px-3 py-2.5 text-right">Put-away</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">On order</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">Secondary avail.</th>
            <th className="px-3 py-2.5 text-right">Sellable</th>
            <th className="px-4 py-2.5">Status</th>
            {isOffice && <th className="px-4 py-2.5" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const lvl = r.replenish.level === "critical" ? "critical" : r.replenish.level === "warning" ? "warning" : "ok";
            return (
              <tr key={r.sku} className={cx(r.blocking && "bg-amber-50/30", highlight === r.sku && "flash")}>
                <td className="px-4 py-2.5">
                  <p className="mono font-semibold text-ink">{r.sku}</p>
                  <p className="text-xs text-ink-muted">
                    {r.name} · {r.variant}
                  </p>
                </td>
                <td className="mono px-3 py-2.5 text-ink-muted">{r.main.bin}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.main.on_hand}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{r.main.reserved || "—"}</td>
                <td className={cx("px-3 py-2.5 text-right font-semibold tabular-nums", r.main.available <= 0 ? "text-red-600" : LEVEL[lvl].text)}>{r.main.available}</td>
                <td className="px-3 py-2.5">
                  <FillBar onHand={r.main.on_hand} reserved={r.main.reserved} capacity={r.main.capacity} level={lvl} />
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {r.main.available_pct}% of {r.main.capacity}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                  {r.main.awaiting_putaway + r.secondary.awaiting_putaway ? (
                    <Link href="/receiving?tab=putaway" className="font-semibold text-amber-700 hover:underline">
                      {r.main.awaiting_putaway + r.secondary.awaiting_putaway}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                  {r.on_order ? (
                    <Link href={`/reorders?q=${r.sku}&status=all`} className="font-semibold text-sky-800 hover:underline" title={r.incoming_delivery ? `Next: ${r.incoming_delivery.id}` : ""}>
                      {r.on_order}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.secondary.available}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{r.sellable}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {r.blocking && (
                      <span className="chip bg-red-50 text-red-700 ring-red-200">
                        <LuLock className="h-3 w-3" /> Blocking {plural(r.shortage?.orders?.length || 0, "order")}
                      </span>
                    )}
                    {r.replenish.below_line && !r.blocking && r.replenish.status !== "reorder" && (
                      <span className={cx("chip", r.replenish.status === "in_transfer" || r.replenish.status === "incoming" ? "bg-sky-50 text-sky-800 ring-sky-200" : LEVEL[lvl].chip)} title={r.replenish.message}>
                        {r.replenish.status === "transfer_required" ? `Transfer required (${r.replenish.suggested_qty})` : r.replenish.label}
                      </span>
                    )}
                    {r.replenish.status === "reorder" && (
                      <Link href={`/reorders?sku=${r.sku}`} className={cx("chip hover:underline", LEVEL[lvl].chip)} title={r.replenish.message}>
                        <LuShoppingCart className="h-3 w-3" /> Reorder
                      </Link>
                    )}
                    {r.low_stock && !r.blocking && !r.replenish.below_line && <span className="chip bg-amber-50 text-amber-800 ring-amber-200">Low</span>}
                    {r.has_open_issue && <span className="chip bg-orange-50 text-orange-700 ring-orange-200">Issue</span>}
                    {!r.blocking && !r.low_stock && !r.has_open_issue && !r.replenish.below_line && <span className="text-xs text-ink-faint">OK</span>}
                  </div>
                </td>
                {isOffice && (
                  <td className="px-4 py-2.5 text-right">
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => onAdjust(r)}>
                      <LuPencil className="h-3.5 w-3.5" /> Adjust
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
