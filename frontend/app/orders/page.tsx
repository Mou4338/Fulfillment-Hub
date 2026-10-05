"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LuChevronLeft, LuChevronRight, LuCircleCheck, LuTriangleAlert } from "react-icons/lu";
import { useApi, useNow, useQueryParams } from "@/lib/hooks";
import { useMeta } from "@/lib/context";
import { fmtWhen, plural } from "@/lib/format";
import type { OrderSummary } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { DataTable, Column } from "@/components/DataTable";
import { FilterBar, SearchInput, Select } from "@/components/FilterBar";
import { EmptyState, ErrorState, Skeleton } from "@/components/EmptyState";
import { BlockedChip, PriorityBadge, RiskBadge, StatusBadge, TimeLeft } from "@/components/StatusBadge";

const PAGE = 25;
const FILTER_KEYS = ["q", "stage", "priority", "risk", "courier", "channel", "has_issue", "date_from", "date_to", "sort"];

export default function OrdersPage() {
  const [params, setParams, ready] = useQueryParams();
  const { meta } = useMeta();
  const router = useRouter();
  const now = useNow();
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");

  useEffect(() => setQ(params.get("q") || ""), [params]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") || "") !== q) setParams({ q });
    }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = (k: string) => params.get(k) || "";
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    FILTER_KEYS.forEach((k) => params.get(k) && p.set(k, params.get(k)!));
    p.set("limit", String(PAGE));
    p.set("offset", String(page * PAGE));
    return p.toString();
  }, [params, page]);
  useEffect(() => setPage(0), [params]);

  const { data, error, loading, reload } = useApi<{ total: number; items: OrderSummary[] }>(ready ? `/api/orders?${qs}` : null, { poll: 45000 });
  const active = FILTER_KEYS.some((k) => k !== "sort" && params.get(k));
  const set = (k: string) => (v: string) => setParams({ [k]: v });

  const columns: Column<OrderSummary>[] = [
    {
      key: "id",
      header: "Order",
      cell: (o) => (
        <div>
          <p className="mono font-semibold text-ink">{o.id}</p>
          <p className="text-xs text-ink-muted">{o.channel}</p>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (o) => (
        <div className="max-w-[180px]">
          <p className="truncate font-medium text-ink">{o.customer_name}</p>
          <p className="truncate text-xs text-ink-muted">{o.city}</p>
        </div>
      ),
    },
    { key: "items", header: "Items", cell: (o) => <span className="tabular-nums text-ink-soft">{plural(o.units, "unit")}</span> },
    { key: "priority", header: "Priority", cell: (o) => <PriorityBadge priority={o.priority} /> },
    { key: "status", header: "Status", cell: (o) => <StatusBadge status={o.status} label={o.status_label} /> },
    {
      key: "ship_by",
      header: "Ship by",
      cell: (o) => (
        <div>
          <p className="whitespace-nowrap text-sm text-ink">{fmtWhen(o.ship_by, now)}</p>
          {o.status !== "SHIPPED" && o.status !== "CANCELLED" ? (
            <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} />
          ) : (
            <span className="text-xs text-ink-muted">{o.status === "SHIPPED" ? `Shipped ${fmtWhen(o.shipped_at, now)}` : "—"}</span>
          )}
        </div>
      ),
    },
    { key: "courier", header: "Courier", cell: (o) => <span className="text-ink-soft">{o.courier_name || <span className="text-ink-faint">Not chosen</span>}</span> },
    {
      key: "exceptions",
      header: "Exceptions",
      cell: (o) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {o.risk.state !== "on_track" && o.risk.state !== "done" && <RiskBadge risk={o.risk} />}
          {o.blocked_short && <BlockedChip label={o.blocked_short} />}
          {o.scan_error && <span className="chip bg-red-50 text-red-700 ring-red-200">Scan failed</span>}
          {o.open_issues > 0 && !o.blocked_short && <span className="chip bg-slate-100 text-ink-soft ring-slate-200">{plural(o.open_issues, "issue")}</span>}
          {o.after_cutoff && o.risk.state !== "done" && <span className="chip bg-slate-50 text-ink-muted ring-slate-200">After cutoff</span>}
          {o.risk.state === "on_track" && !o.blocked_short && !o.open_issues && !o.scan_error && <span className="text-xs text-ink-faint">—</span>}
        </div>
      ),
    },
  ];

  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Every order, its stage, and whether it will make its ship-by time. Click a row for the full story."
      />

      <div className="card mb-4 p-3">
        <FilterBar
          active={active}
          onReset={() => setParams(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}
        >
          <SearchInput value={q} onChange={setQ} placeholder="Order ID, customer, city, marketplace ref…" className="w-full sm:w-72" />
          <Select
            label="Stage"
            value={f("stage")}
            onChange={set("stage")}
            options={[{ value: "", label: "All stages" }, { value: "open", label: "All open orders" }, ...(meta?.stages || []).map((s) => ({ value: s.key, label: s.label }))]}
          />
          <Select label="Priority" value={f("priority")} onChange={set("priority")} options={[{ value: "", label: "Any priority" }, { value: "priority", label: "Priority only" }, { value: "normal", label: "Normal only" }]} />
          <Select
            label="Risk"
            value={f("risk")}
            onChange={set("risk")}
            options={[
              { value: "", label: "Any risk" },
              { value: "attention", label: "Delayed or at risk" },
              { value: "delayed", label: "Delayed" },
              { value: "at_risk", label: "At risk" },
              { value: "on_track", label: "On track" },
            ]}
          />
          <Select label="Courier" value={f("courier")} onChange={set("courier")} options={[{ value: "", label: "Any courier" }, ...(meta?.couriers || []).map((c) => ({ value: c.id, label: c.name }))]} />
          <Select label="Channel" value={f("channel")} onChange={set("channel")} options={[{ value: "", label: "Any channel" }, ...(meta?.channels || []).map((c) => ({ value: c, label: c }))]} />
          <Select label="Issues" value={f("has_issue")} onChange={set("has_issue")} options={[{ value: "", label: "Issues: any" }, { value: "yes", label: "Has open issue" }]} />
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            From
            <input type="date" className="input w-auto py-1.5" value={f("date_from")} onChange={(e) => setParams({ date_from: e.target.value })} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            To
            <input type="date" className="input w-auto py-1.5" value={f("date_to")} onChange={(e) => setParams({ date_to: e.target.value })} />
          </label>
          <Select
            label="Sort"
            value={f("sort")}
            onChange={set("sort")}
            options={[{ value: "", label: "Sort: most urgent" }, { value: "ship_by", label: "Sort: ship-by" }, { value: "newest", label: "Sort: newest" }]}
          />
        </FilterBar>
      </div>

      {error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm">
            <span className="text-ink-muted">{loading ? "Loading…" : <><span className="font-semibold text-ink">{total}</span> orders</>}</span>
            {data && data.items.some((o) => o.risk.state === "delayed") && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                <LuTriangleAlert className="h-3.5 w-3.5" /> Delayed orders are listed first
              </span>
            )}
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <DataTable
              rows={data?.items || []}
              columns={columns}
              rowKey={(o) => o.id}
              onRowClick={(o) => router.push(`/orders/${o.id}`)}
              rowClassName={(o) => (o.risk.state === "delayed" ? "bg-red-50/30" : undefined)}
              empty={
                <EmptyState
                  tone={params.get("risk") ? "good" : "neutral"}
                  icon={params.get("risk") ? LuCircleCheck : undefined}
                  title={params.get("risk") === "delayed" ? "No delayed orders right now" : params.get("risk") ? "Nothing at risk — all on track" : "No orders match these filters"}
                  hint={active ? "Try clearing a filter." : undefined}
                />
              }
              mobile={(o) => (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono font-semibold text-ink">{o.id}</span>
                    <StatusBadge status={o.status} label={o.status_label} />
                  </div>
                  <p className="text-sm text-ink-soft">
                    {o.customer_name} · {plural(o.units, "unit")} · {o.courier_name || "no courier yet"}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {o.priority && <PriorityBadge priority />}
                    {o.risk.state !== "done" && <RiskBadge risk={o.risk} />}
                    {o.blocked_short && <BlockedChip label={o.blocked_short} />}
                    {o.risk.state !== "done" && <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} />}
                  </div>
                </div>
              )}
            />
          )}
          {total > PAGE && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-sm">
              <span className="text-ink-muted">
                Page {page + 1} of {pages}
              </span>
              <div className="flex gap-2">
                <button className="btn btn-secondary px-2.5 py-1.5" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <LuChevronLeft className="h-4 w-4" />
                </button>
                <button className="btn btn-secondary px-2.5 py-1.5" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <LuChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
