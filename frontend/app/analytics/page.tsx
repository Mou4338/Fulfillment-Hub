"use client";

import { LuGauge, LuShieldCheck, LuTimer, LuFlag, LuTruck } from "react-icons/lu";
import { useApi } from "@/lib/hooks";
import { cx } from "@/lib/format";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/EmptyState";

interface Bar {
  label: string;
  count: number;
}

function Bars({ rows, tone = "brand", empty }: { rows: Bar[]; tone?: "brand" | "red" | "amber"; empty?: string }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  if (!rows.length || rows.every((r) => !r.count)) return <p className="py-4 text-sm text-ink-muted">{empty || "Nothing to show."}</p>;
  const color = tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-500" : "bg-brand-500";
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[140px_1fr_40px] items-center gap-3 text-sm">
          <span className="truncate text-ink-soft">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <span className={cx("block h-full rounded-full", color)} style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="text-right font-semibold tabular-nums text-ink">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-[13px] font-medium text-ink-muted">
        {label}
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-[28px] font-semibold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-2 text-xs text-ink-muted">{hint}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const { data: a, error, loading, reload } = useApi<any>("/api/analytics");
  if (loading) return <PageSkeleton />;
  if (error && !a) return <ErrorState message={error} onRetry={reload} />;
  if (!a) return null;
  const pct = (v: number | null) => (v === null || v === undefined ? "—" : `${v}%`);
  const hrs = (v: number | null) => (v === null || v === undefined ? "—" : `${v}h`);
  const maxDay = Math.max(...a.per_day.map((d: any) => Math.max(d.received, d.shipped)), 1);

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="A few numbers that show where fulfillment slows down — calculated from the same data the team works on." />

      {a.bottleneck?.message && (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
          <LuGauge className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <p className="text-sm text-ink-soft">
            <span className="font-semibold text-ink">Where work is piling up: </span>
            {a.bottleneck.message}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Received → packed" value={hrs(a.avg_hours_received_to_packed)} hint="Average hours, all packed orders" icon={LuTimer} />
        <Stat label="Received → shipped" value={hrs(a.avg_hours_received_to_shipped)} hint="Average hours, all shipped orders" icon={LuTruck} />
        <Stat label="Priority shipped on time" value={pct(a.priority_on_time_rate)} hint={`${a.priority_shipped} priority orders shipped`} icon={LuFlag} />
        <Stat
          label="Mistakes caught at packing"
          value={String(a.verification.failures)}
          hint={`Wrong items/labels stopped · ${a.verification.verified_units} units verified`}
          icon={LuShieldCheck}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card card-pad">
          <h2 className="mb-4 text-[15px] font-semibold text-ink">Orders by stage</h2>
          <Bars rows={a.orders_by_stage} />
        </div>
        <div className="card card-pad">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Delayed orders — where they are stuck</h2>
          <p className="mb-4 text-xs text-ink-muted">Open orders past their ship-by time, by current stage</p>
          <Bars rows={a.delayed_by_stage} tone="red" empty="No delayed orders." />
        </div>
        <div className="card card-pad">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Received vs shipped per day</h2>
          <p className="mb-4 text-xs text-ink-muted">If shipped stays below received, a backlog is building</p>
          <div className="flex h-44 items-end gap-4">
            {a.per_day.map((d: any) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-36 w-full items-end justify-center gap-1.5">
                  <span className="w-1/3 rounded-t bg-slate-300" style={{ height: `${(d.received / maxDay) * 100}%` }} title={`${d.received} received`} />
                  <span className="w-1/3 rounded-t bg-brand-500" style={{ height: `${(d.shipped / maxDay) * 100}%` }} title={`${d.shipped} shipped`} />
                </div>
                <span className="text-xs text-ink-muted">{d.day}</span>
                <span className="text-[11px] tabular-nums text-ink-soft">
                  {d.received} / {d.shipped}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" /> Received
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-brand-500" /> Shipped
            </span>
          </div>
        </div>
        <div className="card card-pad">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Issues by type · last 7 days</h2>
          <p className="mb-4 text-xs text-ink-muted">What goes wrong most often</p>
          <Bars rows={a.issues_by_type_7d.slice(0, 8)} tone="amber" empty="No issues logged." />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold text-ink">Courier pickup performance</h2>
          <p className="text-xs text-ink-muted">Parcels collected vs parcels that missed a pickup</p>
        </div>
        {a.courier_performance.length === 0 ? (
          <EmptyState compact title="No courier data yet" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="table-head">
                <th className="px-5 py-2.5">Courier</th>
                <th className="px-3 py-2.5 text-right">Handed over</th>
                <th className="px-3 py-2.5 text-right">Missed pickups</th>
                <th className="px-5 py-2.5 text-right">Collected on first pickup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {a.courier_performance.map((c: any) => (
                <tr key={c.courier}>
                  <td className="px-5 py-2.5 font-medium text-ink">{c.courier}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{c.handed_over}</td>
                  <td className={cx("px-3 py-2.5 text-right tabular-nums", c.missed ? "font-semibold text-red-600" : "text-ink-muted")}>{c.missed}</td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{pct(c.on_time_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
