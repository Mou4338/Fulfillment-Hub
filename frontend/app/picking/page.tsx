"use client";

import Link from "next/link";
import { LuArrowRight, LuCircleCheck, LuMapPin, LuWarehouse } from "react-icons/lu";
import { useApi, useNow } from "@/lib/hooks";
import { cx, fmtWhen } from "@/lib/format";
import type { OrderSummary } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, ErrorState, Skeleton } from "@/components/EmptyState";
import { PriorityBadge, RiskBadge, TimeLeft } from "@/components/StatusBadge";

export default function PickingQueuePage() {
  const { data, error, loading, reload } = useApi<OrderSummary[]>("/api/picking/queue", { poll: 20000 });
  const now = useNow();

  return (
    <div>
      <PageHeader
        title="Picking"
        subtitle="Priority orders first, then earliest ship-by. Open one order and walk the bins in order."
      />
      {error && !data && <ErrorState message={error} onRetry={reload} />}
      {loading && (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}
      {data && data.length === 0 && (
        <div className="card">
          <EmptyState tone="good" icon={LuCircleCheck} title="Nothing to pick right now" hint="Orders appear here as soon as stock is reserved for them." />
        </div>
      )}
      {data && data.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {data.map((o, idx) => {
            const started = o.status === "PICKING";
            return (
              <Link
                key={o.id}
                href={`/picking/${o.id}`}
                className={cx(
                  "card group flex flex-col gap-3 p-4 transition-colors hover:border-brand-300",
                  o.priority && "border-l-4 border-l-orange-400",
                  idx === 0 && "ring-2 ring-brand-500/20",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="mono text-lg font-semibold text-ink">{o.id}</p>
                    <p className="text-sm text-ink-muted">{o.customer_name}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {o.priority && <PriorityBadge priority />}
                    {o.risk.state !== "on_track" && <RiskBadge risk={o.risk} />}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
                  <span className="inline-flex items-center gap-1.5">
                    <LuWarehouse className="h-4 w-4 text-ink-faint" />
                    {started ? `${o.picked_lines} of ${o.total_lines} lines picked` : `${o.total_lines} line${o.total_lines === 1 ? "" : "s"} · ${o.units} units`}
                  </span>
                  {o.first_bin && (
                    <span className="inline-flex items-center gap-1.5">
                      <LuMapPin className="h-4 w-4 text-ink-faint" /> Start at <span className="mono font-semibold text-ink">{o.first_bin}</span>
                    </span>
                  )}
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
                  <span className="text-xs text-ink-muted">
                    Ship by {fmtWhen(o.ship_by, now)} · <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} />
                  </span>
                  <span className={cx("btn px-3 py-1.5 text-xs", idx === 0 ? "btn-primary" : "btn-secondary")}>
                    {started ? "Continue" : "Start"} <LuArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
