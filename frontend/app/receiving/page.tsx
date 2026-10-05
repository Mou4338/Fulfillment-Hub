"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  LuCircleCheck, LuInbox, LuMapPin, LuTriangleAlert, LuWarehouse, LuPlus, LuPencil, LuTrash2, LuShoppingCart,
  LuCalendarClock, LuChevronDown, LuChevronUp, LuPackagePlus, LuCircleX, LuInfo,
} from "react-icons/lu";
import { post } from "@/lib/api";
import { useApi, useNow, useQueryParams } from "@/lib/hooks";
import { useRole, useToast } from "@/lib/context";
import { cx, dateInput, fmtWhen, plural } from "@/lib/format";
import type { Delivery, DeliveryLine, InventoryRow } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/EmptyState";
import { SearchInput, Tabs } from "@/components/FilterBar";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { QtyInput } from "@/components/QtyInput";

type Count = { arrived: number; damaged: number };
type Draft = {
  counts: Record<number, Count>;
  missing: "backorder" | "close";
  backorderDate: string;
  replaceDamaged: boolean;
  putawayNow: boolean;
};

const STATUS: Record<Delivery["status"], { label: string; cls: string }> = {
  expected: { label: "To count", cls: "bg-slate-100 text-ink-soft ring-slate-200" },
  received: { label: "Counted — put away next", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  putaway_done: { label: "On the shelves", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  cancelled: { label: "Cancelled", cls: "bg-slate-100 text-ink-muted ring-slate-200" },
};

const SOURCE_CLS: Record<Delivery["source"], string> = {
  reorder: "bg-brand-50 text-brand-800 ring-brand-200",
  backorder: "bg-sky-50 text-sky-800 ring-sky-200",
  manual: "bg-violet-50 text-violet-800 ring-violet-200",
  supplier: "bg-slate-100 text-ink-soft ring-slate-200",
};

export default function ReceivingPage() {
  const { data, error, loading, reload } = useApi<Delivery[]>("/api/inbound", { poll: 30000 });
  const [params, setParams, ready] = useQueryParams();
  const focus = params.get("delivery");
  const tab = params.get("tab") || (focus ? "all" : "open");
  const now = useNow();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [bins, setBins] = useState<Record<number, string>>({});
  const [confirm, setConfirm] = useState<Delivery | null>(null);
  const [correct, setCorrect] = useState<{ d: Delivery; l: DeliveryLine; received: number; damaged: number; reason: string } | null>(null);
  const [arrivalOpen, setArrivalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || !focus || !data) return;
    const t = setTimeout(() => document.getElementById(`delivery-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    return () => clearTimeout(t);
  }, [ready, focus, !!data]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = data || [];
  const counts = {
    count: list.filter((d) => d.status === "expected").length,
    putaway: list.filter((d) => d.status === "received").length,
    late: list.filter((d) => d.overdue).length,
    done: list.filter((d) => d.status === "putaway_done" || d.status === "cancelled").length,
  };
  const ql = q.trim().toLowerCase();
  const shown = list.filter((d) => {
    if (tab === "open" && !(d.status === "expected" || d.status === "received")) return false;
    if (tab === "count" && d.status !== "expected") return false;
    if (tab === "putaway" && d.status !== "received") return false;
    if (tab === "done" && !(d.status === "putaway_done" || d.status === "cancelled")) return false;
    if (!ql) return true;
    return (
      d.id.toLowerCase().includes(ql) ||
      d.supplier.toLowerCase().includes(ql) ||
      (d.reorder_id || "").toLowerCase().includes(ql) ||
      d.lines.some((l) => l.sku.toLowerCase().includes(ql) || l.name.toLowerCase().includes(ql))
    );
  });

  if (loading) return <PageSkeleton />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const draftOf = (d: Delivery): Draft =>
    drafts[d.id] || {
      counts: Object.fromEntries(d.lines.map((l) => [l.id, { arrived: l.expected_qty, damaged: 0 }])),
      missing: d.source === "reorder" || d.source === "backorder" ? "backorder" : "close",
      backorderDate: dateInput(now, 2),
      replaceDamaged: false,
      putawayNow: false,
    };
  const setDraft = (d: Delivery, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [d.id]: { ...draftOf(d), ...patch } }));
  const setCount = (d: Delivery, l: DeliveryLine, c: Partial<Count>) => {
    const dr = draftOf(d);
    const cur = dr.counts[l.id] || { arrived: l.expected_qty, damaged: 0 };
    const next = { ...cur, ...c };
    if (next.damaged > next.arrived) next.damaged = next.arrived;
    setDraft(d, { counts: { ...dr.counts, [l.id]: next } });
  };

  function summary(d: Delivery) {
    const dr = draftOf(d);
    let ok = 0, damaged = 0, missing = 0, extra = 0;
    d.lines.forEach((l) => {
      const c = dr.counts[l.id] || { arrived: l.expected_qty, damaged: 0 };
      ok += c.arrived - c.damaged;
      damaged += c.damaged;
      missing += Math.max(0, l.expected_qty - c.arrived);
      extra += Math.max(0, c.arrived - l.expected_qty);
    });
    return { ok, damaged, missing, extra, matches: !damaged && !missing && !extra };
  }

  async function receive(d: Delivery) {
    const dr = draftOf(d);
    setBusy(true);
    try {
      const r = await post<Delivery & { backorder_id: string | null; unblocked_orders: string[] }>(`/api/inbound/${d.id}/receive`, {
        lines: d.lines.map((l) => ({ line_id: l.id, received_qty: dr.counts[l.id]?.arrived ?? l.expected_qty, damaged_qty: dr.counts[l.id]?.damaged ?? 0 })),
        missing_action: dr.missing,
        replace_damaged: dr.replaceDamaged,
        backorder_expected_at: dr.backorderDate || null,
        putaway_now: dr.putawayNow,
      });
      const bits = [`${d.id} counted`];
      if (r.backorder_id) bits.push(`rest expected on ${r.backorder_id}`);
      if (dr.putawayNow) bits.push("stock is on the shelves");
      else bits.push("now put the stock away so it can be sold");
      if (r.unblocked_orders?.length) bits.push(`${plural(r.unblocked_orders.length, "waiting order")} ready to pick`);
      toast(bits.join(" — "));
      setConfirm(null);
      setDrafts(({ [d.id]: _, ...rest }) => rest);
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function putaway(l: DeliveryLine) {
    setBusy(true);
    try {
      const r = await post<{ unblocked_orders: string[] }>(`/api/inbound-lines/${l.id}/putaway`, { bin: bins[l.id] || l.bin });
      toast(r.unblocked_orders.length ? `${l.sku} on the shelf — ${plural(r.unblocked_orders.length, "waiting order")} now ready to pick` : `${l.sku} is on the shelf and available to sell`);
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function putawayAll(d: Delivery) {
    setBusy(true);
    try {
      const r = await post<{ unblocked_orders: string[] }>(`/api/inbound/${d.id}/putaway-all`);
      toast(`${d.id}: ${d.totals.awaiting_putaway} units on the shelves${r.unblocked_orders.length ? ` — ${plural(r.unblocked_orders.length, "waiting order")} ready to pick` : ""}`);
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveCorrection() {
    if (!correct) return;
    setBusy(true);
    try {
      await post(`/api/inbound-lines/${correct.l.id}/correct`, { received_qty: correct.received, damaged_qty: correct.damaged, reason: correct.reason });
      toast(`${correct.l.sku}: count corrected — stock waiting for put-away updated`);
      setCorrect(null);
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receiving"
        subtitle="Count every delivery — what arrived OK, what is damaged, what didn’t come — then put it on a shelf. Stock is only sellable once it’s put away."
        actions={
          <>
            <Link href="/guide#receiving" className="btn btn-secondary">
              How this works
            </Link>
            <button className="btn btn-primary" onClick={() => setArrivalOpen(true)}>
              <LuPackagePlus className="h-4 w-4" /> Log a new arrival
            </button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { n: 1, t: "Count what arrived", d: "Per item: arrived OK, damaged, or not arrived. Say if the missing units are still coming." },
          { n: 2, t: "Put it away", d: "Place it in its bin and confirm — or tick “put away now” while counting." },
          { n: 3, t: "Everything updates", d: "Waiting orders get the stock, the reorder shows what arrived, problems become issues." },
        ].map((s) => (
          <div key={s.n} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">{s.n}</span>
            <div>
              <p className="text-sm font-semibold text-ink">{s.t}</p>
              <p className="text-xs text-ink-muted">{s.d}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs
          value={tab}
          onChange={(v) => setParams({ tab: v === "open" ? null : v, delivery: null })}
          tabs={[
            { value: "open", label: "Needs action", count: counts.count + counts.putaway },
            { value: "count", label: "To count", count: counts.count },
            { value: "putaway", label: "To put away", count: counts.putaway },
            { value: "done", label: "Done", count: counts.done },
            { value: "all", label: "All" },
          ]}
        />
        {counts.late > 0 && (
          <span className="chip bg-red-50 text-red-700 ring-red-200">
            <LuCalendarClock className="h-3.5 w-3.5" /> {plural(counts.late, "delivery", "deliveries")} late
          </span>
        )}
        <SearchInput value={q} onChange={setQ} placeholder="Search delivery, supplier, reorder or SKU" className="w-full lg:ml-auto lg:w-80" />
      </div>

      {shown.length === 0 && (
        <div className="card">
          <EmptyState
            icon={tab === "open" ? LuCircleCheck : LuInbox}
            tone={tab === "open" && !ql ? "good" : "neutral"}
            title={ql ? "No deliveries match" : tab === "open" ? "Nothing to count or put away" : "No deliveries here"}
            hint={tab === "open" && !ql ? "When a delivery turns up that nobody expected, use “Log a new arrival”." : undefined}
          />
        </div>
      )}

      {shown.map((d) => (
        <DeliveryCard
          key={d.id}
          d={d}
          now={now}
          focused={focus === d.id}
          draft={draftOf(d)}
          sum={summary(d)}
          busy={busy}
          bins={bins}
          onBin={(id, v) => setBins((b) => ({ ...b, [id]: v }))}
          onCount={(l, c) => setCount(d, l, c)}
          onDraft={(p) => setDraft(d, p)}
          onAllArrived={() => setDraft(d, { counts: Object.fromEntries(d.lines.map((l) => [l.id, { arrived: l.expected_qty, damaged: 0 }])) })}
          onConfirm={() => (summary(d).matches ? receive(d) : setConfirm(d))}
          onPutaway={putaway}
          onPutawayAll={() => putawayAll(d)}
          onCorrect={(l) => setCorrect({ d, l, received: l.received_qty ?? 0, damaged: l.damaged_qty, reason: "" })}
        />
      ))}

      <ConfirmDialog
        open={!!confirm}
        title={`Confirm count for ${confirm?.id}?`}
        message="The count doesn’t match what was expected. Check the numbers below — you can still correct a line afterwards if you made a mistake."
        confirmLabel="Confirm count"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && receive(confirm)}
      >
        {confirm && (
          <>
            <ul className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
              {confirm.lines.map((l) => {
                const c = draftOf(confirm).counts[l.id] || { arrived: l.expected_qty, damaged: 0 };
                const miss = Math.max(0, l.expected_qty - c.arrived);
                const diff = c.arrived !== l.expected_qty || c.damaged > 0;
                return (
                  <li key={l.id} className={cx("flex justify-between gap-3", diff && "font-semibold text-amber-800")}>
                    <span className="mono">{l.sku}</span>
                    <span className="text-right">
                      {c.arrived - c.damaged} OK
                      {c.damaged > 0 && ` · ${c.damaged} damaged`}
                      {miss > 0 && ` · ${miss} not arrived`}
                      {c.arrived > l.expected_qty && ` · ${c.arrived - l.expected_qty} extra`}
                    </span>
                  </li>
                );
              })}
            </ul>
            <ConsequenceList d={confirm} draft={draftOf(confirm)} sum={summary(confirm)} />
          </>
        )}
      </ConfirmDialog>

      <Modal
        open={!!correct}
        onClose={() => setCorrect(null)}
        title={`Correct count · ${correct?.l.sku ?? ""}`}
        subtitle={correct ? `${correct.d.id} · expected ${correct.l.expected_qty}` : undefined}
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setCorrect(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy || !correct?.reason.trim()} onClick={saveCorrection}>
              Save correction
            </button>
          </>
        }
      >
        {correct && (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              Counted <b>{correct.l.received_qty}</b> ({correct.l.damaged_qty} damaged). {correct.l.putaway_qty > 0 && <>{correct.l.putaway_qty} already on the shelf.</>}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="label">Arrived in total</p>
                <QtyInput value={correct.received} onChange={(v) => setCorrect({ ...correct, received: v, damaged: Math.min(correct.damaged, v) })} label="arrived" />
              </div>
              <div>
                <p className="label">of which damaged</p>
                <QtyInput value={correct.damaged} max={correct.received} onChange={(v) => setCorrect({ ...correct, damaged: v })} label="damaged" tone={correct.damaged ? "bad" : undefined} />
              </div>
            </div>
            <p className="text-xs text-ink-muted">
              Good units: <b>{correct.received - correct.damaged}</b> (was {(correct.l.received_qty ?? 0) - correct.l.damaged_qty}). Stock waiting for put-away changes by{" "}
              <b>{correct.received - correct.damaged - ((correct.l.received_qty ?? 0) - correct.l.damaged_qty)}</b> automatically.
            </p>
            {correct.received - correct.damaged < correct.l.putaway_qty && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                {correct.l.putaway_qty} units are already on the shelf. To go below that, count the bin and use{" "}
                <Link className="link" href={`/inventory?mode=list&sku=${correct.l.sku}`}>
                  Inventory → Adjust
                </Link>
                .
              </p>
            )}
            <div>
              <label className="label" htmlFor="corr-reason">
                Why? (required)
              </label>
              <input id="corr-reason" className="input" placeholder="e.g. Recounted the carton, 2 caps crushed" value={correct.reason} onChange={(e) => setCorrect({ ...correct, reason: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>

      <ArrivalModal open={arrivalOpen} onClose={() => setArrivalOpen(false)} deliveries={list} onJump={(id) => {
        setArrivalOpen(false);
        setParams({ delivery: id, tab: "all" });
      }} />
    </div>
  );
}


function DeliveryCard({
  d, now, focused, draft, sum, busy, bins, onBin, onCount, onDraft, onAllArrived, onConfirm, onPutaway, onPutawayAll, onCorrect,
}: {
  d: Delivery;
  now: Date;
  focused: boolean;
  draft: Draft;
  sum: { ok: number; damaged: number; missing: number; extra: number; matches: boolean };
  busy: boolean;
  bins: Record<number, string>;
  onBin: (lineId: number, v: string) => void;
  onCount: (l: DeliveryLine, c: Partial<Count>) => void;
  onDraft: (p: Partial<Draft>) => void;
  onAllArrived: () => void;
  onConfirm: () => void;
  onPutaway: (l: DeliveryLine) => void;
  onPutawayAll: () => void;
  onCorrect: (l: DeliveryLine) => void;
}) {
  const finished = d.status === "putaway_done" || d.status === "cancelled";
  const [open, setOpen] = useState(!finished || focused);
  useEffect(() => {
    if (focused) setOpen(true);
  }, [focused]);
  const counting = d.status === "expected";
  const st = STATUS[d.status];

  return (
    <section id={`delivery-${d.id}`} className={cx("card scroll-mt-24 overflow-hidden", focused && "flash ring-2 ring-brand-300", finished && !focused && "opacity-90")}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", d.overdue ? "bg-red-50 text-red-600" : "bg-slate-100 text-ink-muted")}>
          <LuInbox className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
            <span className="mono">{d.id}</span> · <span className="truncate">{d.supplier}</span>
            <span className={cx("chip", st.cls)}>{st.label}</span>
            {d.overdue && (
              <span className="chip bg-red-50 text-red-700 ring-red-200">
                <LuCalendarClock className="h-3 w-3" /> Late
              </span>
            )}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <span className={cx("chip", SOURCE_CLS[d.source])}>{d.source_label}</span>
            {d.reorder_id && (
              <Link href={`/reorders?id=${d.reorder_id}`} className="link inline-flex items-center gap-1 text-xs">
                <LuShoppingCart className="h-3.5 w-3.5" /> {d.reorder_id}
              </Link>
            )}
            <span>
              To {d.warehouse_id === "MAIN" ? "Main Warehouse" : "Secondary Warehouse"} ·{" "}
              {d.status === "expected" ? `expected ${fmtWhen(d.expected_at, now)}` : d.status === "cancelled" ? "cancelled" : `counted ${fmtWhen(d.received_at, now)} by ${d.received_by}`}
            </span>
            {d.note && <span className="text-ink-faint">· {d.note}</span>}
          </p>
          {!counting && d.status !== "cancelled" && (
            <p className="mt-1 text-xs text-ink-soft">
              <b className="text-emerald-700">{d.totals.good} OK</b>
              {d.totals.damaged > 0 && <b className="text-red-600"> · {d.totals.damaged} damaged</b>}
              {d.totals.missing > 0 && <b className="text-amber-700"> · {d.totals.missing} not arrived</b>} · {d.totals.putaway} on shelf
              {d.totals.awaiting_putaway > 0 && <b className="text-amber-700"> · {d.totals.awaiting_putaway} to put away</b>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counting && (
            <button className="btn btn-secondary" onClick={onAllArrived} title="Fill every line with the expected quantity">
              <LuCircleCheck className="h-4 w-4" /> Everything arrived
            </button>
          )}
          {d.status === "received" && d.totals.awaiting_putaway > 0 && (
            <button className="btn btn-primary btn-xl" disabled={busy} onClick={onPutawayAll}>
              <LuWarehouse className="h-5 w-5" /> Put away all {d.totals.awaiting_putaway}
            </button>
          )}
          {finished && (
            <button className="btn btn-ghost" onClick={() => setOpen(!open)}>
              {open ? <LuChevronUp className="h-4 w-4" /> : <LuChevronDown className="h-4 w-4" />} {open ? "Hide" : `${plural(d.lines.length, "item")}`}
            </button>
          )}
        </div>
      </div>

      {open && (
        <>
          {/* phone: one card per line */}
          <ul className="divide-y divide-line md:hidden">
            {d.lines.map((l) => (
              <li key={l.id} className="space-y-2 px-4 py-3">
                <LineTitle l={l} />
                {counting ? (
                  <CountControls l={l} c={draft.counts[l.id] || { arrived: l.expected_qty, damaged: 0 }} onCount={(c) => onCount(l, c)} />
                ) : (
                  <CountedLine l={l} d={d} busy={busy} bin={bins[l.id]} onBin={(v) => onBin(l.id, v)} onPutaway={() => onPutaway(l)} onCorrect={() => onCorrect(l)} />
                )}
              </li>
            ))}
          </ul>
          {/* desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="table-head">
                  <th className="px-4 py-2.5">Item</th>
                  <th className="px-3 py-2.5 text-right">Expected</th>
                  {counting ? (
                    <>
                      <th className="px-3 py-2.5">Arrived in total</th>
                      <th className="px-3 py-2.5">of which damaged</th>
                      <th className="px-3 py-2.5">Result</th>
                      <th className="px-3 py-2.5" />
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2.5 text-right">OK</th>
                      <th className="px-3 py-2.5 text-right">Damaged</th>
                      <th className="px-3 py-2.5 text-right">Not arrived</th>
                      <th className="px-4 py-2.5">Put away</th>
                      <th className="px-3 py-2.5" />
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.lines.map((l) => {
                  const c = draft.counts[l.id] || { arrived: l.expected_qty, damaged: 0 };
                  return (
                    <tr key={l.id} className="align-middle">
                      <td className="px-4 py-3">
                        <LineTitle l={l} />
                      </td>
                      <td className="px-3 py-3 text-right text-base font-semibold tabular-nums">{l.expected_qty}</td>
                      {counting ? (
                        <>
                          <td className="px-3 py-3">
                            <QtyInput value={c.arrived} onChange={(v) => onCount(l, { arrived: v })} label={`arrived ${l.sku}`} tone={c.arrived < l.expected_qty ? "warn" : undefined} />
                          </td>
                          <td className="px-3 py-3">
                            <QtyInput value={c.damaged} max={c.arrived} onChange={(v) => onCount(l, { damaged: v })} label={`damaged ${l.sku}`} tone={c.damaged ? "bad" : undefined} />
                          </td>
                          <td className="px-3 py-3">
                            <ResultChips l={l} c={c} />
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex justify-end gap-1">
                              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => onCount(l, { arrived: l.expected_qty, damaged: 0 })}>
                                All OK
                              </button>
                              <button className="btn btn-ghost px-2 py-1 text-xs text-amber-800" onClick={() => onCount(l, { arrived: 0, damaged: 0 })}>
                                Not arrived
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-emerald-700">{l.good_qty}</td>
                          <td className={cx("px-3 py-3 text-right tabular-nums", l.damaged_qty ? "font-semibold text-red-600" : "text-ink-faint")}>{l.damaged_qty || "—"}</td>
                          <td className="px-3 py-3 text-right">
                            {l.missing_qty ? (
                              <span className="inline-flex flex-col items-end">
                                <span className="font-semibold tabular-nums text-amber-700">{l.missing_qty}</span>
                                <span className="text-[11px] text-ink-muted">{l.missing_action === "backorder" ? "still coming" : "not coming"}</span>
                              </span>
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <PutawayCell l={l} d={d} busy={busy} bin={bins[l.id]} onBin={(v) => onBin(l.id, v)} onPutaway={() => onPutaway(l)} />
                          </td>
                          <td className="px-3 py-3 text-right">
                            {d.status !== "cancelled" && (
                              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => onCorrect(l)} title="Fix a counting mistake">
                                <LuPencil className="h-3.5 w-3.5" /> Correct
                              </button>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {counting && (
            <div className="space-y-3 border-t border-line bg-slate-50/60 p-4">
              {sum.missing > 0 && (
                <fieldset className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <legend className="px-1 text-sm font-semibold text-amber-900">{plural(sum.missing, "unit")} didn’t arrive — what happens to them?</legend>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    <label className={cx("flex cursor-pointer gap-2 rounded-lg border bg-white p-2.5 text-sm", draft.missing === "backorder" ? "border-brand-400 ring-1 ring-brand-300" : "border-slate-200")}>
                      <input type="radio" className="mt-0.5" checked={draft.missing === "backorder"} onChange={() => onDraft({ missing: "backorder" })} />
                      <span>
                        <b>Still coming</b> — keep them on order.
                        <span className="block text-xs text-ink-muted">A follow-up delivery is created for the rest.</span>
                        {draft.missing === "backorder" && (
                          <span className="mt-1.5 flex items-center gap-2 text-xs">
                            Expected
                            <input type="date" className="input h-8 w-auto py-0 text-xs" value={draft.backorderDate} onChange={(e) => onDraft({ backorderDate: e.target.value })} />
                          </span>
                        )}
                      </span>
                    </label>
                    <label className={cx("flex cursor-pointer gap-2 rounded-lg border bg-white p-2.5 text-sm", draft.missing === "close" ? "border-brand-400 ring-1 ring-brand-300" : "border-slate-200")}>
                      <input type="radio" className="mt-0.5" checked={draft.missing === "close"} onChange={() => onDraft({ missing: "close" })} />
                      <span>
                        <b>Not coming</b> — close them.
                        <span className="block text-xs text-ink-muted">Logged as a Receiving Shortage issue for the office.</span>
                      </span>
                    </label>
                  </div>
                </fieldset>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex flex-1 flex-col gap-1.5">
                  {sum.damaged > 0 && (
                    <label className="flex items-center gap-2 text-sm text-ink-soft">
                      <input type="checkbox" checked={draft.replaceDamaged} onChange={(e) => onDraft({ replaceDamaged: e.target.checked })} />
                      Ask the supplier to replace the {plural(sum.damaged, "damaged unit")} (added to the follow-up delivery)
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-sm text-ink-soft">
                    <input type="checkbox" checked={draft.putawayNow} onChange={(e) => onDraft({ putawayNow: e.target.checked })} />
                    Put the good units away now, in their usual bins
                  </label>
                  <p className="text-xs text-ink-muted">
                    You’re confirming <b className="text-emerald-700">{sum.ok} OK</b>
                    {sum.damaged > 0 && <b className="text-red-600"> · {sum.damaged} damaged</b>}
                    {sum.missing > 0 && <b className="text-amber-700"> · {sum.missing} not arrived ({draft.missing === "backorder" ? "still coming" : "not coming"})</b>}
                    {sum.extra > 0 && <b className="text-amber-700"> · {sum.extra} more than expected</b>}.
                  </p>
                </div>
                <button className="btn btn-primary btn-xl shrink-0" disabled={busy} onClick={onConfirm}>
                  <LuCircleCheck className="h-5 w-5" /> {sum.matches ? "Confirm — all arrived OK" : "Confirm count"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LineTitle({ l }: { l: DeliveryLine }) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-ink">
        {l.name} <span className="text-ink-muted">({l.variant})</span>
      </p>
      <p className="mono text-xs text-ink-muted">
        {l.sku}
        {l.bin && <span className="ml-2 text-ink-faint">bin {l.bin}</span>}
      </p>
    </div>
  );
}

function ResultChips({ l, c }: { l: DeliveryLine; c: Count }) {
  const ok = c.arrived - c.damaged;
  const miss = Math.max(0, l.expected_qty - c.arrived);
  const extra = Math.max(0, c.arrived - l.expected_qty);
  return (
    <div className="flex flex-wrap gap-1">
      <span className="chip bg-emerald-50 text-emerald-700 ring-emerald-200">{ok} OK</span>
      {c.damaged > 0 && <span className="chip bg-red-50 text-red-700 ring-red-200">{c.damaged} damaged</span>}
      {miss > 0 && <span className="chip bg-amber-50 text-amber-800 ring-amber-200">{miss} not arrived</span>}
      {extra > 0 && <span className="chip bg-sky-50 text-sky-800 ring-sky-200">{extra} extra</span>}
    </div>
  );
}

function CountControls({ l, c, onCount }: { l: DeliveryLine; c: Count; onCount: (c: Partial<Count>) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="label">Arrived (expected {l.expected_qty})</p>
          <QtyInput value={c.arrived} onChange={(v) => onCount({ arrived: v })} label={`arrived ${l.sku}`} tone={c.arrived < l.expected_qty ? "warn" : undefined} />
        </div>
        <div>
          <p className="label">of which damaged</p>
          <QtyInput value={c.damaged} max={c.arrived} onChange={(v) => onCount({ damaged: v })} label={`damaged ${l.sku}`} tone={c.damaged ? "bad" : undefined} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ResultChips l={l} c={c} />
        <span className="ml-auto flex gap-1">
          <button className="btn btn-secondary px-2 py-1 text-xs" onClick={() => onCount({ arrived: l.expected_qty, damaged: 0 })}>
            All OK
          </button>
          <button className="btn btn-secondary px-2 py-1 text-xs" onClick={() => onCount({ arrived: 0, damaged: 0 })}>
            Not arrived
          </button>
        </span>
      </div>
    </div>
  );
}

function CountedLine({ l, d, busy, bin, onBin, onPutaway, onCorrect }: { l: DeliveryLine; d: Delivery; busy: boolean; bin?: string; onBin: (v: string) => void; onPutaway: () => void; onCorrect: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 text-xs">
        <span className="chip bg-slate-100 text-ink-soft ring-slate-200">expected {l.expected_qty}</span>
        <span className="chip bg-emerald-50 text-emerald-700 ring-emerald-200">{l.good_qty} OK</span>
        {l.damaged_qty > 0 && <span className="chip bg-red-50 text-red-700 ring-red-200">{l.damaged_qty} damaged</span>}
        {l.missing_qty > 0 && (
          <span className="chip bg-amber-50 text-amber-800 ring-amber-200">
            {l.missing_qty} {l.missing_action === "backorder" ? "still coming" : "not coming"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PutawayCell l={l} d={d} busy={busy} bin={bin} onBin={onBin} onPutaway={onPutaway} />
        {d.status !== "cancelled" && (
          <button className="btn btn-ghost ml-auto px-2 py-1 text-xs" onClick={onCorrect}>
            <LuPencil className="h-3.5 w-3.5" /> Correct count
          </button>
        )}
      </div>
    </div>
  );
}

function PutawayCell({ l, d, busy, bin, onBin, onPutaway }: { l: DeliveryLine; d: Delivery; busy: boolean; bin?: string; onBin: (v: string) => void; onPutaway: () => void }) {
  if (d.status === "cancelled") return <span className="text-xs text-ink-faint">—</span>;
  if (l.awaiting_putaway > 0)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <LuMapPin className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input mono h-11 w-32 pl-8" value={bin ?? l.bin ?? ""} onChange={(e) => onBin(e.target.value.toUpperCase())} aria-label={`Bin for ${l.sku}`} />
        </div>
        <button className="btn btn-primary h-11" disabled={busy} onClick={onPutaway}>
          <LuWarehouse className="h-4 w-4" /> Put away {l.awaiting_putaway}
        </button>
      </div>
    );
  if (l.good_qty === 0)
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
        <LuCircleX className="h-4 w-4" /> Nothing to shelve
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
      <LuCircleCheck className="h-4 w-4" /> {l.putaway_qty} on shelf {l.bin && <span className="mono font-normal text-ink-muted">({l.bin})</span>}
    </span>
  );
}

function ConsequenceList({ d, draft, sum }: { d: Delivery; draft: Draft; sum: { ok: number; damaged: number; missing: number; extra: number } }) {
  const items: string[] = [];
  if (sum.ok) items.push(draft.putawayNow ? `${sum.ok} good units go straight onto their shelves and can be sold.` : `${sum.ok} good units wait for put-away (not sellable until shelved).`);
  if (sum.missing) items.push(draft.missing === "backorder" ? `${sum.missing} missing units stay on order — a follow-up delivery is created.` : `${sum.missing} missing units are closed as not coming and logged as an issue.`);
  if (sum.damaged) items.push(draft.replaceDamaged ? `${sum.damaged} damaged units are added to the follow-up delivery as replacements.` : `${sum.damaged} damaged units are logged as an issue.`);
  if (d.reorder_id) items.push(`Reorder ${d.reorder_id} is updated with what arrived.`);
  return (
    <ul className="mt-3 space-y-1 text-xs text-ink-soft">
      {items.map((t) => (
        <li key={t} className="flex gap-1.5">
          <LuInfo className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" /> {t}
        </li>
      ))}
    </ul>
  );
}


type ArrivalLine = { sku: string; arrived: number; damaged: number };

function ArrivalModal({ open, onClose, deliveries, onJump }: { open: boolean; onClose: () => void; deliveries: Delivery[]; onJump: (id: string) => void }) {
  const toast = useToast();
  const { data: products } = useApi<InventoryRow[]>(open ? "/api/inventory?sort=sku" : null);
  const { data: suppliers } = useApi<string[]>(open ? "/api/reorders/suppliers" : null);
  const [supplier, setSupplier] = useState("");
  const [wh, setWh] = useState<"MAIN" | "SEC">("MAIN");
  const [note, setNote] = useState("");
  const [putawayNow, setPutawayNow] = useState(true);
  const [lines, setLines] = useState<ArrivalLine[]>([{ sku: "", arrived: 1, damaged: 0 }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSupplier("");
      setWh("MAIN");
      setNote("");
      setPutawayNow(true);
      setLines([{ sku: "", arrived: 1, damaged: 0 }]);
    }
  }, [open]);

  const bySku = useMemo(() => Object.fromEntries((products || []).map((p) => [p.sku, p])), [products]);
  const expectedFor = (sku: string) =>
    deliveries.filter((d) => d.status === "expected" && d.warehouse_id === wh && d.lines.some((l) => l.sku === sku.toUpperCase()));
  const valid = supplier.trim() && lines.some((l) => bySku[l.sku.trim().toUpperCase()] && l.arrived > 0);
  const unknown = lines.filter((l) => l.sku.trim() && !bySku[l.sku.trim().toUpperCase()]);

  async function save() {
    setBusy(true);
    try {
      const r = await post<Delivery & { unblocked_orders: string[] }>("/api/inbound/arrival", {
        supplier,
        warehouse_id: wh,
        note,
        putaway_now: putawayNow,
        lines: lines.filter((l) => l.sku.trim() && l.arrived > 0).map((l) => ({ sku: l.sku.trim().toUpperCase(), received_qty: l.arrived, damaged_qty: l.damaged })),
      });
      toast(
        `${r.id} recorded — ${r.totals.good} units ${putawayNow ? "on the shelves" : "waiting for put-away"}` +
          (r.unblocked_orders?.length ? `, ${plural(r.unblocked_orders.length, "waiting order")} ready to pick` : ""),
      );
      onClose();
      onJump(r.id);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a new arrival"
      subtitle="Stock that turned up without an expected delivery — count it and record it here."
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !valid || unknown.length > 0} onClick={save}>
            <LuCircleCheck className="h-4 w-4" /> Record arrival
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="arr-sup">
              From (supplier or source)
            </label>
            <input id="arr-sup" className="input" list="arr-suppliers" placeholder="e.g. Urban Threads Pvt Ltd" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            <datalist id="arr-suppliers">{(suppliers || []).map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <p className="label">Arrived at</p>
            <Tabs value={wh} onChange={(v) => setWh(v as "MAIN" | "SEC")} tabs={[{ value: "MAIN", label: "Main Warehouse" }, { value: "SEC", label: "Secondary" }]} />
          </div>
        </div>

        <div className="space-y-2">
          <p className="label">Items</p>
          <datalist id="arr-skus">
            {(products || []).map((p) => (
              <option key={p.sku} value={p.sku}>
                {p.name} · {p.variant}
              </option>
            ))}
          </datalist>
          {lines.map((l, i) => {
            const p = bySku[l.sku.trim().toUpperCase()];
            const exp = p ? expectedFor(p.sku) : [];
            const set = (patch: Partial<ArrivalLine>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch, damaged: Math.min(patch.damaged ?? x.damaged, patch.arrived ?? x.arrived) } : x)));
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[180px] flex-1">
                    <input className="input mono uppercase" list="arr-skus" placeholder="Scan or type SKU" value={l.sku} onChange={(e) => set({ sku: e.target.value.toUpperCase() })} aria-label="SKU" />
                  </div>
                  <div>
                    <p className="label">Arrived</p>
                    <QtyInput size="sm" value={l.arrived} onChange={(v) => set({ arrived: v })} label="arrived" />
                  </div>
                  <div>
                    <p className="label">Damaged</p>
                    <QtyInput size="sm" value={l.damaged} max={l.arrived} onChange={(v) => set({ damaged: v })} label="damaged" tone={l.damaged ? "bad" : undefined} />
                  </div>
                  <button className="btn btn-ghost h-9 px-2" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line">
                    <LuTrash2 className="h-4 w-4" />
                  </button>
                </div>
                {p && (
                  <p className="mt-1.5 text-xs text-ink-muted">
                    {p.name} · {p.variant} · {wh === "MAIN" ? `Main bin ${p.main.bin} (${p.main.on_hand} on hand)` : `Secondary bin ${p.secondary.bin} (${p.secondary.on_hand} on hand)`}
                  </p>
                )}
                {l.sku.trim() && !p && <p className="mt-1.5 text-xs font-semibold text-red-600">Unknown SKU — check the label.</p>}
                {exp.length > 0 && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    <LuTriangleAlert className="h-3.5 w-3.5" /> This SKU is on {exp.map((d) => d.id).join(", ")}
                    {exp[0].reorder_id ? ` (reorder ${exp[0].reorder_id})` : ""}. If it’s that delivery, count it there so the reorder is updated.
                    <button className="link" onClick={() => onJump(exp[0].id)}>
                      Open {exp[0].id}
                    </button>
                  </p>
                )}
              </div>
            );
          })}
          <button className="btn btn-secondary" onClick={() => setLines((ls) => [...ls, { sku: "", arrived: 1, damaged: 0 }])}>
            <LuPlus className="h-4 w-4" /> Add another item
          </button>
        </div>

        <div>
          <label className="label" htmlFor="arr-note">
            Note (optional)
          </label>
          <input id="arr-note" className="input" placeholder="e.g. No paperwork, driver said it was a replacement" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={putawayNow} onChange={(e) => setPutawayNow(e.target.checked)} />
          Put the good units away now, in their usual bins (untick if they’ll be shelved later)
        </label>
      </div>
    </Modal>
  );
}
