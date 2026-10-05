"use client";

import Link from "next/link";
import {
  LuShoppingBag, LuFlag, LuTriangleAlert, LuHourglass, LuWarehouse, LuTruck, LuBoxes, LuCircleAlert, LuArrowRight,
  LuChevronRight, LuGauge, LuRefreshCw, LuPackageCheck, LuInbox, LuCircleCheck, LuArrowRightLeft, LuScanLine, LuZap,
  LuListOrdered, LuShieldCheck, LuBookOpen, LuShoppingCart, LuCalendarClock, LuLayoutGrid, LuHandshake, LuSend,
} from "react-icons/lu";
import { useApi, useNow } from "@/lib/hooks";
import { useRole } from "@/lib/context";
import { cx, fmtDateLong, fmtDuration, fmtWhen, localHour, plural } from "@/lib/format";
import type { ActivityRow, OrderSummary, Replenishment } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { ActivityFeed } from "@/components/OrderTimeline";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/EmptyState";
import { PriorityBadge, RiskBadge, TimeLeft } from "@/components/StatusBadge";

interface ActionItem {
  id: string;
  kind: string;
  title: string;
  reason: string;
  link: string;
  cta: string;
  score: number;
  severity: "critical" | "warning" | "normal";
  order_id: string | null;
}

interface Dashboard {
  now: string;
  kpis: Record<string, number>;
  pipeline: { key: string; label: string; count: number; priority: number; attention: number }[];
  action_queue: ActionItem[];
  priority_orders: OrderSummary[];
  attention_orders: OrderSummary[];
  attention_total: number;
  shortages: any[];
  low_stock: { sku: string; name: string; variant: string; available: number; threshold: number }[];
  replenishment: Replenishment;
  couriers: any[];
  bottleneck: { stage: string | null; message: string; count?: number } | null;
  activity: ActivityRow[];
}

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  pick: LuWarehouse, verify: LuScanLine, transfer: LuArrowRightLeft, receive_transfer: LuArrowRightLeft, stock_issue: LuCircleAlert,
  missed_pickup: LuTruck, pickup_soon: LuTruck, hold: LuTriangleAlert, process: LuShoppingBag, process_batch: LuShoppingBag,
  at_risk: LuHourglass, putaway: LuInbox, putaway_unblock: LuInbox, receiving: LuInbox, no_stock: LuBoxes, return: LuBoxes,
  recv_issue: LuInbox, replenish: LuShieldCheck, reorder: LuShoppingCart, late_delivery: LuCalendarClock,
};

function greeting(now: Date) {
  const h = localHour(now);
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { role } = useRole();
  if (role === "warehouse") return <WarehouseHome />;
  return <OfficeDashboard />;
}

function OfficeDashboard() {
  const { data, error, loading, reload } = useApi<Dashboard>("/api/dashboard", { poll: 30000 });
  const now = useNow();
  const { user } = useRole();

  if (loading) return <PageSkeleton />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const k = data.kpis;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={fmtDateLong(now)}
        title={`${greeting(now)}, ${user.split(" ")[0]}`}
        subtitle="Here’s what needs attention right now. Everything below updates as work happens."
        actions={
          <button className="btn btn-secondary" onClick={reload}>
            <LuRefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      {data.bottleneck?.stage && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <LuGauge className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <p className="text-sm text-amber-900">
            <span className="font-semibold">Bottleneck: </span>
            {data.bottleneck.message}
          </p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="To process" value={k.to_process} hint="New orders, in queue order" href="/processing" icon={LuListOrdered} tone={k.to_process ? "brand" : "good"} />
        <KpiCard label="Orders · last 24h" value={k.orders_24h} hint={`${k.shipped_24h} shipped in the same period`} href="/orders?sort=newest" icon={LuShoppingBag} />
        <KpiCard label="Priority orders open" value={k.priority_open} hint="Must ship on their ship-by day" href="/orders?priority=priority&stage=open" icon={LuFlag} tone="brand" />
        <KpiCard label="At risk" value={k.at_risk} hint="Close to ship-by, or blocked priority" href="/orders?risk=at_risk" icon={LuHourglass} tone={k.at_risk ? "warn" : "good"} />
        <KpiCard label="Delayed" value={k.delayed} hint="Ship-by already passed" href="/orders?risk=delayed" icon={LuTriangleAlert} tone={k.delayed ? "danger" : "good"} />
        <KpiCard label="Ready to pick" value={k.ready_to_pick} hint="Stock reserved, waiting for a picker" href="/picking" icon={LuWarehouse} />
        <KpiCard label="Ready to hand over" value={k.ready_to_ship} hint="Staged, waiting for the courier" href="/handover" icon={LuTruck} />
        <KpiCard label="Inventory exceptions" value={k.inventory_issues} hint="Blocking SKUs + stock problems" href="/inventory?view=blocking" icon={LuBoxes} tone={k.inventory_issues ? "warn" : "good"} />
        <KpiCard label="Transfer required" value={k.transfer_required} hint={`${k.below_half} SKUs below half in Main`} href="/inventory?view=replenish" icon={LuShieldCheck} tone={k.transfer_required ? "warn" : "good"} />
        <KpiCard label="Need reordering" value={k.reorder_needed} hint="Low in both warehouses — buy more" href="/reorders" icon={LuShoppingCart} tone={k.reorder_needed ? "warn" : "good"} />
        <KpiCard
          label="Deliveries to receive"
          value={k.deliveries_to_receive}
          hint={k.deliveries_late ? `${k.deliveries_late} late — chase the supplier` : "To count or put away"}
          href="/receiving"
          icon={LuInbox}
          tone={k.deliveries_late ? "warn" : "neutral"}
        />
        <KpiCard label="Open issues" value={k.open_issues} hint="Tracked problems not yet resolved" href="/issues" icon={LuCircleAlert} tone={k.open_issues ? "neutral" : "good"} />
      </section>

      <Pipeline stages={data.pipeline} />

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="card xl:col-span-2">
          <div className="flex items-center justify-between border-b border-line bg-white px-5 py-4 sm:px-6">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <LuZap className="h-4 w-4 text-brand-600" /> Action Queue
              </h2>
              <p className="text-xs text-ink-muted">Ranked by priority, time left and severity — do the top one first.</p>
            </div>
            <span className="chip bg-slate-100 text-ink-muted ring-slate-200">{plural(data.action_queue.length, "action")}</span>
          </div>
          {data.action_queue.length === 0 ? (
            <EmptyState tone="good" icon={LuCircleCheck} title="Nothing needs attention right now" hint="New problems will appear here automatically." />
          ) : (
            <ol className="divide-y divide-line">
              {data.action_queue.map((a, i) => {
                const Icon = KIND_ICON[a.kind] || LuCircleAlert;
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-ink-faint">{i + 1}</span>
                    <span
                      className={cx(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        a.severity === "critical" ? "bg-red-50 text-red-600" : a.severity === "warning" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-ink-muted",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                      <p className="truncate text-xs text-ink-muted">{a.reason}</p>
                    </div>
                    <Link href={a.link} className={cx("btn shrink-0 px-3 py-1.5 text-xs", i === 0 ? "btn-primary" : "btn-secondary")}>
                      {a.cta} <LuArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="card">
          <div className="border-b border-line bg-white px-5 py-4 sm:px-6">
            <h2 className="text-[15px] font-semibold text-ink">Courier pickups</h2>
            <p className="text-xs text-ink-muted">Next collection for each courier and what’s ready for it.</p>
          </div>
          <ul className="divide-y divide-line">
            {data.couriers.map((c: any) => (
              <li key={c.courier.id}>
                <Link href={`/handover?courier=${c.courier.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                  <span className={cx("flex h-9 w-9 items-center justify-center rounded-lg", c.alert ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-ink-muted")}>
                    <LuTruck className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{c.courier.name}</p>
                    <p className="text-xs text-ink-muted">
                      {fmtWhen(c.next_pickup, now)} · in {fmtDuration(c.minutes_to_pickup)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-ink">{c.staged} staged</p>
                    {c.unstaged > 0 ? (
                      <p className={cx("text-xs font-semibold", c.alert ? "text-amber-700" : "text-ink-muted")}>{c.unstaged} not staged</p>
                    ) : (
                      <p className="text-xs text-ink-muted">all staged</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <OrderListCard
          title="Priority orders"
          subtitle="Open priority orders, earliest ship-by first"
          orders={data.priority_orders}
          now={now}
          moreHref="/orders?priority=priority&stage=open"
          empty="No open priority orders."
        />
        <OrderListCard
          title="Delayed & at risk"
          subtitle={`${plural(data.attention_total, "order")} need attention to make ship-by`}
          orders={data.attention_orders}
          now={now}
          moreHref="/orders?risk=attention"
          empty="All orders are on track."
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between border-b border-line bg-white px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Inventory exceptions</h2>
              <p className="text-xs text-ink-muted">SKUs blocking orders, and bins below half that need a transfer</p>
            </div>
            <Link href="/inventory?view=blocking" className="link text-xs">
              Inventory →
            </Link>
          </div>
          {data.shortages.length === 0 && data.replenishment.items.length === 0 ? (
            <EmptyState compact tone="good" icon={LuCircleCheck} title="No inventory is blocking orders" />
          ) : (
            <ul className="divide-y divide-line">
              {data.shortages.map((s: any) => (
                <li key={s.sku} className="px-4 py-3 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        <span className="mono">{s.sku}</span> <span className="font-normal text-ink-muted">· {s.name} ({s.variant})</span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        Needs {s.needed} · Main has {s.main_available} · Secondary has {s.secondary_available} · blocks {plural(s.orders.length, "order")}
                        {s.orders.some((o: any) => o.priority) && <span className="font-semibold text-orange-700"> (incl. priority)</span>}
                      </p>
                    </div>
                    <span className="shrink-0 text-right text-xs font-semibold">
                      {s.open_transfer ? (
                        <span className="text-brand-700">Transfer {s.open_transfer.id} {s.open_transfer.status === "in_transit" ? "on its way" : "requested"}</span>
                      ) : s.suggested_transfer_qty ? (
                        <Link href={`/inventory?view=blocking&sku=${s.sku}`} className="link">
                          Transfer {s.suggested_transfer_qty} →
                        </Link>
                      ) : s.incoming_delivery ? (
                        <Link href="/receiving" className="link">
                          {s.incoming_delivery.status === "received" ? "Put away →" : "Delivery due"}
                        </Link>
                      ) : (
                        <span className="text-red-600">No stock anywhere</span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
              {data.replenishment.items.map((r) => (
                <li key={r.sku} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <p className="min-w-0 truncate text-sm text-ink-soft">
                    <span className="mono font-semibold text-ink">{r.sku}</span> · bin {r.bin} ·{" "}
                    <span className={r.level === "critical" ? "font-semibold text-red-600" : "font-semibold text-amber-700"}>
                      {r.available}/{r.capacity} available
                    </span>
                  </p>
                  <span className="shrink-0 text-xs font-semibold">
                    {r.status === "transfer_required" ? (
                      <Link href="/inventory?view=replenish" className="link">
                        Transfer {r.suggested_qty} →
                      </Link>
                    ) : (
                      <span className="text-ink-muted">{r.label}</span>
                    )}
                  </span>
                </li>
              ))}
              {data.replenishment.transfer_required > 0 && (
                <li className="px-4 py-2.5 sm:px-5">
                  <Link href="/inventory?view=replenish" className="link text-xs">
                    {plural(data.replenishment.transfer_required, "preventive transfer")} suggested ({data.replenishment.units_to_move} units) — review all →
                  </Link>
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-white px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Recent activity</h2>
              <p className="text-xs text-ink-muted">Every action is recorded — nothing is handled “informally”</p>
            </div>
            <Link href="/activity" className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs">
              All records <LuArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ActivityFeed rows={data.activity.slice(0, 10)} />
        </div>
      </section>
    </div>
  );
}

function Pipeline({ stages }: { stages: Dashboard["pipeline"] }) {
  const max = Math.max(...stages.filter((s) => s.key !== "shipped").map((s) => s.count), 1);
  return (
    <section className="card card-pad">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-ink">Fulfillment pipeline</h2>
        <p className="text-xs text-ink-muted">Orders in each stage right now · shipped = last 24h</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stages.map((s, i) => {
          const shipped = s.key === "shipped";
          const biggest = !shipped && s.count === max && s.count > 0;
          return (
            <Link
              key={s.key}
              href={`/orders?stage=${s.key}`}
              className={cx(
                "group relative rounded-xl border p-3 transition-colors",
                shipped ? "border-emerald-200 bg-emerald-50/50 hover:border-emerald-300" : biggest ? "border-amber-200 bg-amber-50/40 hover:border-amber-300" : "border-slate-200 bg-slate-50/50 hover:border-slate-300",
              )}
            >
              <div className="flex items-center justify-between text-xs font-semibold text-ink-muted">
                <span>
                  {i + 1}. {s.label}
                </span>
                {i < stages.length - 1 && <LuChevronRight className="hidden h-4 w-4 text-ink-faint lg:block" />}
              </div>
              <p className={cx("mt-1 text-2xl font-semibold tabular-nums", shipped ? "text-emerald-700" : "text-ink")}>{s.count}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
                <div
                  className={cx("h-full rounded-full", shipped ? "bg-emerald-500" : biggest ? "bg-amber-500" : "bg-brand-500")}
                  style={{ width: `${shipped ? 100 : Math.max(4, (s.count / max) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-ink-muted">
                {s.priority > 0 && <span className="font-semibold text-orange-700">{s.priority} priority</span>}
                {s.priority > 0 && s.attention > 0 && " · "}
                {s.attention > 0 && !shipped && <span className="font-semibold text-amber-700">{s.attention} need attention</span>}
                {!s.priority && !s.attention && <span>&nbsp;</span>}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function OrderListCard({
  title,
  subtitle,
  orders,
  now,
  moreHref,
  empty,
}: {
  title: string;
  subtitle: string;
  orders: OrderSummary[];
  now: Date;
  moreHref: string;
  empty: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-line bg-white px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <p className="text-xs text-ink-muted">{subtitle}</p>
        </div>
        <Link href={moreHref} className="link text-xs">
          View all →
        </Link>
      </div>
      {orders.length === 0 ? (
        <EmptyState compact tone="good" icon={LuCircleCheck} title={empty} />
      ) : (
        <ul className="divide-y divide-line">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/${o.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span className="mono">{o.id}</span>
                    {o.priority && <PriorityBadge priority />}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {o.customer_name} · {o.blocked_short ? <span className="font-semibold text-red-600">{o.blocked_short}</span> : o.status_label}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <RiskBadge risk={o.risk} />
                  <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WarehouseHome() {
  const { data } = useApi<Record<string, number>>("/api/nav-counts", { poll: 20000 });
  const { user } = useRole();
  const now = useNow();
  const tiles = [
    { href: "/picking", label: "Picking", hint: "Collect items from the shelves", icon: LuWarehouse, n: data?.picking },
    { href: "/packing", label: "Packing", hint: "Scan, pack and label", icon: LuPackageCheck, n: data?.packing },
    { href: "/staging", label: "Staging", hint: "Put packed parcels in their area", icon: LuLayoutGrid, n: data?.staging },
    { href: "/handover", label: "Ready to hand over", hint: "Courier here? Hand the parcels over", icon: LuHandshake, n: data?.handover },
    { href: "/shipped", label: "Shipped", hint: "What left today, manifests, courier visits", icon: LuSend, n: undefined as number | undefined },
    { href: "/receiving", label: "Receiving", hint: "Count deliveries, log new arrivals, put stock away", icon: LuInbox, n: data?.receiving },
    { href: "/inventory", label: "Bins & stock", hint: "Every bin in walking order, how full it is", icon: LuBoxes, n: undefined as number | undefined },
    { href: "/guide", label: "Guide", hint: "What every word and button means", icon: LuBookOpen, n: undefined as number | undefined },
  ];
  return (
    <div>
      <PageHeader eyebrow={fmtDateLong(now)} title={`${greeting(now)}, ${user.split(" ")[0]}`} subtitle="Pick a job to start. Priority work is always at the top of each list." />
      <div className="grid gap-4 sm:grid-cols-2">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="card group flex items-center gap-4 p-5 transition-colors hover:border-brand-300">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <t.icon className="h-7 w-7" />
            </span>
            <div className="flex-1">
              <p className="text-lg font-semibold text-ink">{t.label}</p>
              <p className="text-sm text-ink-muted">{t.hint}</p>
            </div>
            {!["/inventory", "/guide", "/shipped"].includes(t.href) && <span className="text-3xl font-semibold tabular-nums text-ink">{t.n ?? "–"}</span>}
          </Link>
        ))}
      </div>
      <div className="mt-4">
        <Link href="/issues" className="card flex items-center gap-3 p-4 text-sm hover:border-slate-300">
          <LuCircleAlert className="h-5 w-5 text-ink-muted" />
          <span className="flex-1 text-ink-soft">
            Something wrong on the floor? <span className="font-semibold text-ink">Report or view issues</span>
          </span>
          <span className="chip bg-slate-100 text-ink-muted ring-slate-200">{data?.issues ?? 0} open</span>
        </Link>
      </div>
    </div>
  );
}

