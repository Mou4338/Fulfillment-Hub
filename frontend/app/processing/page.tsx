"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  LuListOrdered, LuFlag, LuCircleCheck, LuHourglass, LuPause, LuArrowRight, LuFastForward, LuPlay, LuX, LuTruck, LuInbox,
  LuArrowRightLeft, LuTriangleAlert, LuClock,
} from "react-icons/lu";
import { post } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";
import { useRole, useToast } from "@/lib/context";
import { ago, cx, fmtWhen, plural } from "@/lib/format";
import type { ProcessingBoard, QueueOrder } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/EmptyState";
import { PriorityBadge, StatusBadge, TimeLeft } from "@/components/StatusBadge";

interface BatchResult {
  results: { id: string; outcome: "ready" | "waiting" | "hold" | "error" | "skipped" | "other"; message: string }[];
  summary: Record<string, number>;
  processed: number;
}

const PREVIEW_TONE: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  needs_stock: "bg-amber-50 text-amber-800 ring-amber-200",
  hold: "bg-red-50 text-red-700 ring-red-200",
};
const OUTCOME: Record<string, { label: string; cls: string }> = {
  ready: { label: "Ready to pick", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  waiting: { label: "Waiting for stock", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  hold: { label: "On hold", cls: "bg-red-50 text-red-700 ring-red-200" },
  error: { label: "Not processed", cls: "bg-red-50 text-red-700 ring-red-200" },
  skipped: { label: "Skipped", cls: "bg-slate-100 text-ink-soft ring-slate-200" },
  other: { label: "Processed", cls: "bg-slate-100 text-ink-soft ring-slate-200" },
};

export default function ProcessingPage() {
  const { data, error, loading, reload } = useApi<ProcessingBoard>("/api/processing", { poll: 30000 });
  const { isOffice } = useRole();
  const toast = useToast();
  const now = useNow();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [n, setN] = useState("5");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);

  const queue = data?.queue || [];
  const selectedIds = useMemo(() => queue.filter((o) => selected[o.id]).map((o) => o.id), [queue, selected]);
  const allSelected = queue.length > 0 && selectedIds.length === queue.length;

  if (loading) return <PageSkeleton />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.stats;

  async function run(body: { order_ids?: string[]; count?: number }) {
    setBusy(true);
    try {
      const r = await post<BatchResult>("/api/processing/batch", body);
      setResult(r);
      setSelected({});
      const parts = [
        r.summary.ready && `${r.summary.ready} ready to pick`,
        r.summary.waiting && `${r.summary.waiting} waiting for stock`,
        r.summary.hold && `${r.summary.hold} on hold`,
      ].filter(Boolean);
      toast(`Processed ${plural(r.processed, "order")}${parts.length ? " — " + parts.join(", ") : ""}`, r.summary.error ? "info" : "success");
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const count = Math.max(1, Math.min(Number(n) || 1, data.batch_max, queue.length || 1));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Processing desk"
        subtitle="New orders are checked, given a courier and reserved stock — one at a time, strictly in queue order."
        actions={
          <Link href="/guide#processing" className="btn btn-secondary">
            How this works
          </Link>
        }
      />

      {/* The rule, stated once, in plain words */}
      <div className="card card-pad">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <LuListOrdered className="h-4 w-4 text-brand-600" /> Queue order
          </p>
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {["Priority orders first", "Earliest ship-by next", "Then first received (first in, first out)"].map((t, i) => (
              <li key={t} className="flex items-center gap-2">
                <span className="flex items-center gap-2 rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-ink-soft">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">{i + 1}</span>
                  {t}
                </span>
                {i < 2 && <LuArrowRight className="h-4 w-4 text-ink-faint" />}
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Stock is reserved the moment an order is processed, so the order at the top gets stock first. The “What will happen” column already takes the
          orders above it into account.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="To process" value={s.to_process} icon={LuListOrdered} />
        <Stat label="Priority in queue" value={s.priority} icon={LuFlag} tone={s.priority ? "brand" : undefined} />
        <Stat label="Will go to picking" value={s.will_be_ready} icon={LuCircleCheck} tone="good" />
        <Stat label="Will wait for stock" value={s.will_wait} icon={LuHourglass} tone={s.will_wait ? "warn" : undefined} />
        <Stat label="Will be held" value={s.will_hold} icon={LuPause} tone={s.will_hold ? "danger" : undefined} />
        <Stat label="Longest wait" value={s.oldest_wait_label || "—"} icon={LuClock} hint={`${s.processed_today} processed today`} />
      </section>

      {result && (
        <section className="card overflow-hidden border-brand-200">
          <div className="flex items-center justify-between border-b border-line bg-brand-50/50 px-5 py-3">
            <h2 className="text-[15px] font-semibold text-ink">Batch result — {plural(result.processed, "order")} processed, in queue order</h2>
            <button className="btn btn-ghost px-2" onClick={() => setResult(null)} aria-label="Dismiss result">
              <LuX className="h-4 w-4" />
            </button>
          </div>
          <ul className="divide-y divide-line">
            {result.results.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                <span className="w-5 text-xs font-semibold text-ink-faint">{i + 1}</span>
                <Link href={`/orders/${r.id}`} className="link mono">
                  {r.id}
                </Link>
                <span className={cx("chip", OUTCOME[r.outcome]?.cls)}>{OUTCOME[r.outcome]?.label}</span>
                <span className="text-ink-muted">{r.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink">Queue · {plural(queue.length, "order")} to process</h2>
            <p className="text-xs text-ink-muted">Top to bottom is the order they will be processed in.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" disabled={!isOffice || busy || !queue.length} onClick={() => run({ count: 1 })} title={isOffice ? "" : "Office team only"}>
              <LuPlay className="h-4 w-4" /> Process next
            </button>
            <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white pl-2">
              <label htmlFor="bn" className="text-xs font-semibold text-ink-muted">
                Next
              </label>
              <input
                id="bn"
                type="number"
                min={1}
                max={data.batch_max}
                value={n}
                onChange={(e) => setN(e.target.value)}
                className="w-14 bg-transparent px-1 py-2 text-sm font-semibold tabular-nums focus:outline-none"
              />
              <button className="btn btn-secondary rounded-l-none border-0 border-l" disabled={!isOffice || busy || !queue.length} onClick={() => run({ count })}>
                <LuFastForward className="h-4 w-4" /> Process {count}
              </button>
            </div>
            <button className="btn btn-secondary" disabled={!isOffice || busy || !selectedIds.length} onClick={() => run({ order_ids: selectedIds })}>
              Process selected ({selectedIds.length})
            </button>
          </div>
        </div>
        {!isOffice && (
          <p className="border-b border-line bg-slate-50 px-4 py-2 text-xs text-ink-muted">You can see the queue. The office team processes orders (switch role in the sidebar to try it).</p>
        )}

        {queue.length === 0 ? (
          <EmptyState tone="good" icon={LuCircleCheck} title="Every new order has been processed" hint="New orders from all channels appear here the moment they arrive." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="table-head">
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        className="h-4 w-4 accent-brand-600"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? {} : Object.fromEntries(queue.map((o) => [o.id, true])))}
                      />
                    </th>
                    <th className="px-2 py-2.5">#</th>
                    <th className="px-3 py-2.5">Order</th>
                    <th className="px-3 py-2.5">Items</th>
                    <th className="px-3 py-2.5">Received</th>
                    <th className="px-3 py-2.5">Ship by</th>
                    <th className="px-3 py-2.5">What will happen</th>
                    <th className="px-3 py-2.5">Courier (suggested)</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {queue.map((o) => (
                    <QueueRow
                      key={o.id}
                      o={o}
                      now={now}
                      checked={!!selected[o.id]}
                      onCheck={() => setSelected({ ...selected, [o.id]: !selected[o.id] })}
                      canAct={isOffice && !busy}
                      onProcess={() => run({ order_ids: [o.id] })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {queue.map((o) => (
                <li key={o.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`Select ${o.id}`} checked={!!selected[o.id]} onChange={() => setSelected({ ...selected, [o.id]: !selected[o.id] })} />
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-ink-soft">{o.position}</span>
                    <Link href={`/orders/${o.id}`} className="mono font-semibold text-ink">
                      {o.id}
                    </Link>
                    {o.priority && <PriorityBadge priority />}
                    <span className="ml-auto">
                      <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} />
                    </span>
                  </div>
                  <p className="text-sm text-ink-soft">
                    {o.customer_name} · {o.channel} · {plural(o.units, "unit")}
                  </p>
                  <p className="text-xs">
                    <span className={cx("chip mr-1.5", PREVIEW_TONE[o.preview.kind])}>{o.preview.label}</span>
                    <span className="text-ink-muted">{o.preview.text}</span>
                  </p>
                  <button className="btn btn-secondary w-full" disabled={!isOffice || busy} onClick={() => run({ order_ids: [o.id] })}>
                    Process {o.id}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <LuPause className="h-4 w-4 text-red-600" /> On hold · {s.on_hold}
            </h2>
            <p className="text-xs text-ink-muted">A check stopped these. Review, then release the hold or cancel.</p>
          </div>
          {data.on_hold.length === 0 ? (
            <EmptyState compact tone="good" icon={LuCircleCheck} title="Nothing on hold" />
          ) : (
            <ul className="divide-y divide-line">
              {data.on_hold.map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                        <span className="mono">{o.id}</span> {o.priority && <PriorityBadge priority />}
                      </p>
                      <p className="text-xs text-red-700">{o.hold_reasons.join(" · ")}</p>
                      <p className="text-xs text-ink-muted">
                        {o.customer_name} · {o.channel}
                      </p>
                    </div>
                    <span className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs">
                      Review <LuArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <LuHourglass className="h-4 w-4 text-amber-600" /> Processed, waiting for stock · {s.waiting_stock}
            </h2>
            <p className="text-xs text-ink-muted">They get stock automatically (priority first) as soon as it reaches a Main Warehouse shelf.</p>
          </div>
          {data.waiting_stock.length === 0 ? (
            <EmptyState compact tone="good" icon={LuCircleCheck} title="No order is waiting for stock" />
          ) : (
            <ul className="divide-y divide-line">
              {data.waiting_stock.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <Link href={`/orders/${o.id}`} className="mono hover:underline">
                        {o.id}
                      </Link>
                      {o.priority && <PriorityBadge priority />}
                      <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} />
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                      {o.short.map((x) => (
                        <span key={x.sku} className="chip bg-slate-100 text-ink-soft ring-slate-200">
                          <span className="mono">{x.sku}</span> × {x.qty} ·{" "}
                          {x.fix === "transfer_open" ? `transfer ${x.transfer_id} open` : x.fix === "transfer" ? "transfer needed" : x.fix === "putaway" ? "put away the delivery" : x.fix === "delivery" ? "delivery due" : "no stock"}
                        </span>
                      ))}
                    </p>
                  </div>
                  <Link
                    href={o.short.some((x) => x.fix === "delivery" || x.fix === "putaway") ? "/receiving" : `/inventory?view=blocking&sku=${o.short[0]?.sku || ""}`}
                    className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs"
                  >
                    {o.short.some((x) => x.fix === "transfer") ? <LuArrowRightLeft className="h-3.5 w-3.5" /> : o.short.some((x) => x.fix === "delivery" || x.fix === "putaway") ? <LuInbox className="h-3.5 w-3.5" /> : <LuTriangleAlert className="h-3.5 w-3.5" />}
                    Fix
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold text-ink">Recently processed</h2>
          <p className="text-xs text-ink-muted">{s.processed_24h} processed in the last 24 hours · newest first</p>
        </div>
        <ul className="divide-y divide-line">
          {data.recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <Link href={`/orders/${r.id}`} className="link mono">
                {r.id}
              </Link>
              {r.priority && <PriorityBadge priority />}
              <span className="text-ink-soft">{r.customer_name}</span>
              <StatusBadge status={r.status} label={r.status_label} />
              {r.courier_name && (
                <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                  <LuTruck className="h-3.5 w-3.5" /> {r.courier_name}
                </span>
              )}
              <span className="ml-auto text-xs text-ink-muted">{ago(r.processed_at, now)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function QueueRow({
  o,
  now,
  checked,
  onCheck,
  canAct,
  onProcess,
}: {
  o: QueueOrder;
  now: Date;
  checked: boolean;
  onCheck: () => void;
  canAct: boolean;
  onProcess: () => void;
}) {
  return (
    <tr className={cx(checked && "bg-brand-50/40", o.position === 1 && "bg-brand-50/20")}>
      <td className="px-4 py-3">
        <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`Select ${o.id}`} checked={checked} onChange={onCheck} />
      </td>
      <td className="px-2 py-3">
        <span className={cx("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", o.position === 1 ? "bg-brand-600 text-white" : "bg-slate-100 text-ink-soft")}>
          {o.position}
        </span>
      </td>
      <td className="px-3 py-3">
        <p className="flex items-center gap-2">
          <Link href={`/orders/${o.id}`} className="mono whitespace-nowrap font-semibold text-ink hover:underline">
            {o.id}
          </Link>
          {o.priority && <PriorityBadge priority />}
        </p>
        <p className="text-xs text-ink-muted">
          {o.customer_name} · {o.channel}
        </p>
      </td>
      <td className="px-3 py-3">
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {o.lines.map((l) => (
            <span key={l.sku} className="chip bg-slate-50 text-ink-soft ring-slate-200" title={l.variant}>
              <span className="mono">{l.sku}</span>×{l.qty}
            </span>
          ))}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-muted">{ago(o.received_at, now)}</td>
      <td className="px-3 py-3">
        <p className="whitespace-nowrap text-sm text-ink">{fmtWhen(o.ship_by, now)}</p>
        <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} />
      </td>
      <td className="max-w-[300px] px-3 py-3">
        <span className={cx("chip", PREVIEW_TONE[o.preview.kind])}>{o.preview.label}</span>
        <p className="mt-1 text-xs text-ink-muted">{o.preview.text}</p>
      </td>
      <td className="px-3 py-3 text-xs">
        {o.courier_preview ? (
          <>
            <p className="font-semibold text-ink-soft">{o.courier_preview.name}</p>
            <p className="max-w-[180px] text-ink-muted">{o.courier_preview.reason}</p>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <button className="btn btn-secondary px-3 py-1.5 text-xs" disabled={!canAct} onClick={onProcess}>
          Process
        </button>
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "good" | "warn" | "danger" | "brand";
  hint?: string;
}) {
  const t = {
    good: "text-emerald-700 bg-emerald-50",
    warn: "text-amber-700 bg-amber-50",
    danger: "text-red-600 bg-red-50",
    brand: "text-brand-700 bg-brand-50",
  }[tone || "brand"];
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-muted">{label}</span>
        <span className={cx("flex h-7 w-7 items-center justify-center rounded-lg", tone ? t : "bg-slate-100 text-ink-muted")}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={cx("mt-2 text-[26px] font-semibold leading-none tabular-nums", tone ? t.split(" ")[0] : "text-ink")}>{value}</p>
      {hint && <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
