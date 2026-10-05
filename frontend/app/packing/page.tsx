"use client";

import Link from "next/link";
import { LuArrowRight, LuCircleCheck, LuCircleX, LuScanLine } from "react-icons/lu";
import { useApi, useNow } from "@/lib/hooks";
import { cx, fmtWhen, plural } from "@/lib/format";
import type { OrderSummary } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, ErrorState, Skeleton } from "@/components/EmptyState";
import { PriorityBadge, RiskBadge, TimeLeft } from "@/components/StatusBadge";

export default function PackingQueuePage() {
  const { data, error, loading, reload } = useApi<OrderSummary[]>("/api/packing/queue", { poll: 20000 });
  const now = useNow();
  return (
    <div>
      <PageHeader title="Packing" subtitle="Every unit is scanned before it goes in the box, and the label is checked before the box is sealed." />
      {error && !data && <ErrorState message={error} onRetry={reload} />}
      {loading && <Skeleton className="h-64" />}
      {data && data.length === 0 && (
        <div className="card">
          <EmptyState tone="good" icon={LuCircleCheck} title="Nothing waiting at the packing station" hint="Orders arrive here when picking is complete." />
        </div>
      )}
      {data && data.length > 0 && (
        <div className="card divide-y divide-line">
          {data.map((o, i) => (
            <Link key={o.id} href={`/packing/${o.id}`} className="flex flex-col gap-3 p-4 hover:bg-slate-50 sm:flex-row sm:items-center">
              <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", o.scan_error ? "bg-red-50 text-red-600" : "bg-brand-50 text-brand-700")}>
                {o.scan_error ? <LuCircleX className="h-5 w-5" /> : <LuScanLine className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="mono text-base font-semibold text-ink">{o.id}</span>
                  {o.priority && <PriorityBadge priority />}
                  {o.risk.state !== "on_track" && <RiskBadge risk={o.risk} />}
                  {o.scan_error && <span className="chip bg-red-50 text-red-700 ring-red-200">Last scan was wrong</span>}
                </p>
                <p className="text-sm text-ink-muted">
                  {o.customer_name} · {plural(o.units, "unit")} · {o.courier_name} · ship by {fmtWhen(o.ship_by, now)}{" "}
                  <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} />
                </p>
              </div>
              <span className={cx("btn btn-xl self-start sm:self-auto", i === 0 ? "btn-primary" : "btn-secondary")}>
                {o.scan_error ? "Re-check" : "Pack"} <LuArrowRight className="h-5 w-5" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
