"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  LuClipboardCheck, LuFileText, LuRefreshCw, LuUsers, LuShoppingBag, LuPackage, LuFlag, LuX, LuBot,
  LuCalendarClock, LuSlidersHorizontal,
} from "react-icons/lu";
import { api } from "@/lib/api";
import { useApi, useNow, useQueryParams } from "@/lib/hooks";
import { useRole, useToast } from "@/lib/context";
import { ago, cx, dateInput, fmtDateLong, fmtTime, plural, toDate } from "@/lib/format";
import type { ActivityCategory, ActivityPerson, ActivityRecord, ActivityRecords } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { EmptyState, ErrorState, Skeleton } from "@/components/EmptyState";
import { SearchInput, Select, Tabs } from "@/components/FilterBar";

const CAT: Record<ActivityCategory, { label: string; chip: string; dot: string; bar: string }> = {
  orders: { label: "Orders & processing", chip: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-500", bar: "bg-slate-400" },
  picking: { label: "Picking", chip: "bg-sky-50 text-sky-800 ring-sky-200", dot: "bg-sky-500", bar: "bg-sky-400" },
  packing: { label: "Packing", chip: "bg-indigo-50 text-indigo-800 ring-indigo-200", dot: "bg-indigo-500", bar: "bg-indigo-400" },
  dispatch: { label: "Staging & handover", chip: "bg-violet-50 text-violet-800 ring-violet-200", dot: "bg-violet-500", bar: "bg-violet-400" },
  stock: { label: "Stock & transfers", chip: "bg-teal-50 text-teal-800 ring-teal-200", dot: "bg-teal-500", bar: "bg-teal-400" },
  receiving: { label: "Receiving & reorders", chip: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500", bar: "bg-emerald-400" },
  issues: { label: "Issues", chip: "bg-orange-50 text-orange-800 ring-orange-200", dot: "bg-orange-500", bar: "bg-orange-400" },
  team: { label: "Team & system", chip: "bg-rose-50 text-rose-800 ring-rose-200", dot: "bg-rose-500", bar: "bg-rose-400" },
};
const WARN_ACTIONS = new Set(["scan_failed", "label_failed", "pick_problem", "issue_created", "cancelled", "on_hold", "restage_needed"]);

const RANGES = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Pick dates" },
];

const PAGE = 50;

function rangeDates(range: string, from: string, to: string, now: Date): { from?: string; to?: string } {
  const today = dateInput(now);
  if (range === "today") return { from: today, to: today };
  if (range === "yesterday") {
    const y = dateInput(now, -1);
    return { from: y, to: y };
  }
  if (range === "7d") return { from: dateInput(now, -6), to: today };
  if (range === "custom") return { from: from || undefined, to: to || undefined };
  return {};
}

function roleLabel(role: string) {
  return role === "office" ? "Office" : role === "warehouse" ? "Warehouse" : "Automatic";
}
function shortName(actor: string) {
  return actor.replace(/ \(.*\)$/, "");
}

export default function ActivityPage() {
  const [params, setParams, ready] = useQueryParams();
  const now = useNow(60000);
  const toast = useToast();
  const { user } = useRole();

  const actor = params.get("actor") || "";
  const role = params.get("role") || "";
  const category = (params.get("category") || "") as ActivityCategory | "";
  const range = params.get("range") || "today";
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const order = params.get("order") || "";
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [pages, setPages] = useState(1);
  const [exporting, setExporting] = useState(false);

  useEffect(() => setQ(params.get("q") || ""), [params]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const dates = rangeDates(range, from, to, now);
  const filterQs = useMemo(() => {
    const p = new URLSearchParams();
    if (actor) p.set("actor", actor);
    if (role) p.set("role", role);
    if (category) p.set("category", category);
    if (dates.from) p.set("date_from", dates.from);
    if (dates.to) p.set("date_to", dates.to);
    if (debouncedQ) p.set("q", debouncedQ);
    if (order) p.set("order_id", order);
    return p.toString();
  }, [actor, role, category, dates.from, dates.to, debouncedQ, order]);

  useEffect(() => setPages(1), [filterQs]);

  const limit = Math.min(PAGE * pages, 1000);
  const { data, error, loading, reload } = useApi<ActivityRecords>(
    ready ? `/api/activity/records?limit=${limit}&${filterQs}` : null,
    { poll: 30000 },
  );
  const { data: people } = useApi<ActivityPerson[]>("/api/activity/people", { poll: 60000 });

  const groups = useMemo(() => groupByDay(data?.items || [], now), [data, now]);
  const activeFilters = [actor, role, category, debouncedQ, order, range !== "today" ? range : ""].filter(Boolean).length;

  function setFilter(next: Record<string, string | null>) {
    setParams(next);
  }
  function clearAll() {
    setQ("");
    setParams({ actor: null, role: null, category: null, range: null, from: null, to: null, q: null, order: null });
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await api<ActivityRecords>(`/api/activity/records?limit=1000&${filterQs}`);
      const header = ["Date", "Time", "Person", "Role", "Area", "Action", "Details", "Order", "Parcel", "Issue"];
      const rows = res.items.map((r) => [
        dateInput(r.at), fmtTime(r.at), r.actor, roleLabel(r.role), CAT[r.category]?.label || r.category, r.label, r.message,
        r.order_id || "", r.package_id || "", r.issue_id || "",
      ]);
      const csv = [header, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-records-${dateInput(now)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(res.total > res.items.length ? `Exported the newest ${res.items.length} of ${res.total} records` : `Exported ${plural(res.items.length, "record")}`);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setExporting(false);
    }
  }

  const peopleList = people || [];
  const maxToday = Math.max(1, ...peopleList.map((p) => p.today));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LuClipboardCheck}
        title="Activity records"
        subtitle="Every action taken in the hub — who did it, when, and to which order, parcel or issue. Nothing can be edited or deleted here."
        actions={
          <>
            <Link href={`/activity?actor=${encodeURIComponent(user)}`} className="btn btn-secondary">
              <Avatar name={user} size="xs" /> My activity
            </Link>
            <button className="btn btn-secondary" onClick={reload} title="Refresh now">
              <LuRefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button className="btn btn-primary" onClick={exportCsv} disabled={exporting || !data?.total}>
              <LuFileText className="h-4 w-4" /> {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </>
        }
      />

      {/* ------------------------------------------------------------------ people */}
      <section aria-labelledby="people-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="people-title" className="section-title">People on the record</h2>
          <p className="text-xs text-ink-muted">Click a person to see only their records</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PersonCard
            selected={!actor}
            onClick={() => setFilter({ actor: null })}
            title="Everyone"
            subtitle={`${plural(peopleList.length, "person", "people")} incl. the system`}
            icon={<span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-900 text-white"><LuUsers className="h-5 w-5" /></span>}
            today={peopleList.reduce((a, p) => a + p.today, 0)}
            total={peopleList.reduce((a, p) => a + p.total, 0)}
          />
          {peopleList.map((p) => (
            <PersonCard
              key={p.actor + p.role}
              selected={actor === p.actor}
              onClick={() => setFilter({ actor: actor === p.actor ? null : p.actor })}
              title={shortName(p.actor)}
              subtitle={`${roleLabel(p.role)}${p.actor === user ? " · you" : ""}`}
              icon={
                p.role === "system" ? (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-700"><LuBot className="h-5 w-5" /></span>
                ) : (
                  <Avatar name={p.actor} size="md" />
                )
              }
              today={p.today}
              total={p.total}
              share={p.today / maxToday}
              last={p.last ? `${p.last.label} · ${ago(p.last.at, now)}` : undefined}
              top={p.top_category ? CAT[p.top_category]?.label : undefined}
            />
          ))}
          {!people && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[132px]" />)}
        </div>
      </section>

      {/* ------------------------------------------------------------------ filters */}
      <section className="card">
        <div className="flex flex-col gap-3 p-4 sm:p-5 xl:flex-row xl:items-center">
          <Tabs value={range} onChange={(v) => setFilter({ range: v === "today" ? null : v })} tabs={RANGES} />
          {range === "custom" && (
            <div className="flex items-center gap-2">
              <input type="date" className="input w-40" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFilter({ from: e.target.value || null })} />
              <span className="text-ink-faint">–</span>
              <input type="date" className="input w-40" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setFilter({ to: e.target.value || null })} />
            </div>
          )}
          <div className="flex flex-1 flex-col gap-3 sm:flex-row xl:justify-end">
            <Select
              label="Role"
              value={role}
              onChange={(v) => setFilter({ role: v || null })}
              options={[
                { value: "", label: "All roles" },
                { value: "office", label: "Office" },
                { value: "warehouse", label: "Warehouse" },
                { value: "system", label: "Automatic (system)" },
              ]}
              className="sm:w-48"
            />
            <SearchInput
              value={q}
              onChange={(v) => {
                setQ(v);
                setParams({ q: v || null });
              }}
              placeholder="Search details, order, parcel or issue ID"
              className="w-full sm:w-80"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
          <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
            <LuSlidersHorizontal className="h-3.5 w-3.5" /> Area
          </span>
          <button
            onClick={() => setFilter({ category: null })}
            className={cx(
              "chip transition-colors",
              !category ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-ink-soft ring-slate-300 hover:bg-slate-50",
            )}
          >
            All areas
          </button>
          {(data?.categories || []).map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter({ category: category === c.key ? null : c.key })}
              className={cx(
                "chip transition-colors",
                category === c.key ? CAT[c.key].chip + " ring-2" : "bg-white text-ink-soft ring-slate-300 hover:bg-slate-50",
                !c.count && category !== c.key && "opacity-50",
              )}
            >
              <span className={cx("h-2 w-2 rounded-full", CAT[c.key].dot)} />
              {c.label}
              <span className="tabular-nums text-ink-muted">{c.count}</span>
            </button>
          ))}
          {activeFilters > 0 && (
            <button className="btn btn-ghost ml-auto px-2 py-1 text-xs" onClick={clearAll}>
              <LuX className="h-3.5 w-3.5" /> Clear filters
            </button>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ records */}
      <section className="card overflow-hidden">
        <div className="card-header">
          <div>
            <p className="card-title">
              {data ? plural(data.total, "record") : "Records"}
              {actor && <span className="font-normal text-ink-muted"> by {actor}</span>}
              {order && (
                <span className="ml-2 inline-flex align-middle">
                  <button className="chip bg-brand-50 text-brand-800 ring-brand-200 hover:bg-brand-100" onClick={() => setFilter({ order: null })} title="Remove order filter">
                    Order <span className="mono">{order}</span> <LuX className="h-3 w-3" />
                  </button>
                </span>
              )}
            </p>
            <p className="card-sub flex items-center gap-1.5">
              <LuCalendarClock className="h-3.5 w-3.5" />
              {range === "all" ? "All time" : range === "custom" ? `${from || "start"} → ${to || "today"}` : RANGES.find((r) => r.value === range)?.label}
              {category && ` · ${CAT[category].label}`}
              {" · newest first · refreshes every 30s"}
            </p>
          </div>
        </div>

        {loading && !data ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : error && !data ? (
          <div className="p-5">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            icon={LuClipboardCheck}
            title="No records match"
            hint={activeFilters ? "Try another date range, person or area." : "Actions appear here as soon as anyone does anything."}
            action={activeFilters ? <button className="btn btn-secondary" onClick={clearAll}>Clear filters</button> : undefined}
          />
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="sticky top-16 z-[5] flex items-center justify-between border-y border-line bg-slate-50/95 px-5 py-2 backdrop-blur first:border-t-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-ink-soft">{g.label}</p>
                  <p className="text-xs text-ink-muted">{plural(g.items.length, "action")} shown</p>
                </div>
                <ol className="divide-y divide-line">
                  {g.items.map((r) => (
                    <RecordRow key={r.id} r={r} onActor={(a) => setFilter({ actor: a })} />
                  ))}
                </ol>
              </div>
            ))}
            <div className="flex flex-col items-center gap-2 border-t border-line bg-slate-50/60 px-5 py-4 sm:flex-row sm:justify-between">
              <p className="text-xs text-ink-muted">
                Showing {data.items.length} of {data.total}
              </p>
              {data.has_more && limit < 1000 ? (
                <button className="btn btn-secondary" onClick={() => setPages((p) => p + 1)}>
                  Show {Math.min(PAGE, data.total - data.items.length)} more
                </button>
              ) : data.has_more ? (
                <p className="text-xs text-ink-muted">Narrow the filters or export to see older records.</p>
              ) : (
                <p className="text-xs text-ink-muted">That&apos;s everything for these filters.</p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function PersonCard({
  selected, onClick, title, subtitle, icon, today, total, share, last, top,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  today: number;
  total: number;
  share?: number;
  last?: string;
  top?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "card group flex flex-col gap-3 p-4 text-left transition-all hover:-translate-y-px hover:shadow-raised",
        selected ? "border-brand-500 ring-2 ring-brand-500/20" : "hover:border-slate-300",
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <p className="truncate text-xs text-ink-muted">{subtitle}</p>
        </div>
        <div className="text-right leading-tight">
          <p className="text-xl font-bold tabular-nums text-ink">{today}</p>
          <p className="text-[11px] text-ink-muted">today</p>
        </div>
      </div>
      {share !== undefined && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(4, share * 100)}%` }} />
        </div>
      )}
      <div className="space-y-0.5 text-xs text-ink-muted">
        <p className="truncate">
          <span className="font-semibold text-ink-soft">{total.toLocaleString("en-IN")}</span> actions in total
          {top && <> · mostly {top.toLowerCase()}</>}
        </p>
        {last && <p className="truncate">Last: {last}</p>}
      </div>
    </button>
  );
}

function RecordRow({ r, onActor }: { r: ActivityRecord; onActor: (a: string) => void }) {
  const c = CAT[r.category] || CAT.team;
  const warn = WARN_ACTIONS.has(r.action);
  return (
    <li className="group grid grid-cols-[56px_minmax(0,1fr)] gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50/80 sm:grid-cols-[72px_minmax(0,1fr)]">
      <div className="pt-1 text-right">
        <p className="text-[13px] font-semibold tabular-nums text-ink-soft">{fmtTime(r.at)}</p>
      </div>
      <div className="flex min-w-0 gap-3">
        <div className="relative shrink-0">
          {r.role === "system" ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-700"><LuBot className="h-4 w-4" /></span>
          ) : (
            <Avatar name={r.actor} size="sm" />
          )}
          <span className={cx("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white", warn ? "bg-red-500" : c.dot)} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button className="text-sm font-semibold text-ink hover:text-brand-700 hover:underline" onClick={() => onActor(r.actor)} title="Show only this person">
              {shortName(r.actor)}
            </button>
            <span className="text-xs text-ink-faint">{roleLabel(r.role)}</span>
            <span className={cx("chip", warn ? "bg-red-50 text-red-700 ring-red-200" : c.chip)}>{r.label}</span>
          </div>
          <p className="mt-0.5 text-sm text-ink-soft">{r.message}</p>
          {(r.order_id || r.package_id || r.issue_id) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {r.order_id && (
                <Link href={`/orders/${r.order_id}`} className="chip bg-white text-ink-soft ring-slate-300 hover:bg-brand-50 hover:text-brand-800 hover:ring-brand-300">
                  <LuShoppingBag className="h-3 w-3" /> <span className="mono">{r.order_id}</span>
                </Link>
              )}
              {r.package_id && (
                <Link href={`/staging?package=${r.package_id}`} className="chip bg-white text-ink-soft ring-slate-300 hover:bg-brand-50 hover:text-brand-800 hover:ring-brand-300">
                  <LuPackage className="h-3 w-3" /> <span className="mono">{r.package_id}</span>
                </Link>
              )}
              {r.issue_id && (
                <Link href={`/issues?id=${r.issue_id}`} className="chip bg-white text-ink-soft ring-slate-300 hover:bg-brand-50 hover:text-brand-800 hover:ring-brand-300">
                  <LuFlag className="h-3 w-3" /> <span className="mono">{r.issue_id}</span>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function groupByDay(items: ActivityRecord[], now: Date) {
  const today = dateInput(now);
  const yesterday = dateInput(now, -1);
  const out: { key: string; label: string; items: ActivityRecord[] }[] = [];
  for (const r of items) {
    const key = dateInput(r.at);
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      const d = toDate(r.at);
      const label = key === today ? `Today · ${d ? fmtDateLong(d) : ""}` : key === yesterday ? `Yesterday · ${d ? fmtDateLong(d) : ""}` : d ? fmtDateLong(d) : key;
      g = { key, label, items: [] };
      out.push(g);
    }
    g.items.push(r);
  }
  return out;
}
