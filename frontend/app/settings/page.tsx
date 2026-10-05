"use client";

import Link from "next/link";
import { useState } from "react";
import { LuRotateCcw, LuPlay, LuTruck, LuSlidersHorizontal, LuUsers, LuArrowRight } from "react-icons/lu";
import { post } from "@/lib/api";
import { useMeta, useRole, useToast } from "@/lib/context";
import { cx, fmtWhen, inr } from "@/lib/format";
import { PageHeader } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/Modal";

export default function SettingsPage() {
  const { meta, reloadMeta } = useMeta();
  const { role, setRole, isOffice } = useRole();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const demo = meta?.demo_order_id || "the demo order";

  async function reset() {
    setBusy(true);
    try {
      const r = await post<any>("/api/demo/reset");
      toast(`Demo data restored — ${r.orders} orders. Demo order is ${r.demo_order_id}.`);
      setConfirm(false);
      reloadMeta();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const steps: { title: string; body: string; href?: string; role?: "office" | "warehouse" }[] = [
    { title: "Start on the Dashboard", body: "Read the Action Queue, the pipeline and the bottleneck banner. Every KPI opens its filtered list.", href: "/", role: "office" },
    { title: `Open priority order ${demo}`, body: "See the ship-by countdown, “Why is this blocked?” (shoes only in the Secondary Warehouse) and the Next action.", href: `/orders/${meta?.demo_order_id || ""}`, role: "office" },
    { title: "Transfer stock from Secondary", body: "Click the Transfer button — it covers both waiting orders and refills the empty bin. Then in Inventory mark the transfer “Received at Main”. The order becomes Ready to pick.", href: "/inventory?view=blocking", role: "office" },
    { title: "Process new orders in order", body: "On the Processing desk the queue is already sorted (priority → ship-by → first received). “What will happen” shows the result before you click. Press Process next.", href: "/processing", role: "office" },
    { title: "Keep bins above half", body: "Inventory → Bins in order shows every bin aisle by aisle. Bins below the 50% line say “Transfer required” — create them one by one or all at once.", href: "/inventory", role: "office" },
    { title: "Switch to Warehouse and pick it", body: "Items are listed in walking order by bin. Tap Picked on each. (Try “Can’t find it” on another order to see the exception flow.)", href: `/picking/${meta?.demo_order_id || ""}`, role: "warehouse" },
    { title: "Packing: scan a wrong variant on purpose", body: "Type TSH-014-BLU-L — it is rejected (expected Blue / M). Then scan TSH-014-BLU-M and SHO-009-BLK-42 twice, scan the label and finish.", href: `/packing/${meta?.demo_order_id || ""}`, role: "warehouse" },
    { title: "Stage the parcel", body: "Staging → press “Stage at …” to put the parcel in its suggested area (courier lane, priority shelf or overflow).", href: "/staging", role: "warehouse" },
    { title: "Hand it to the courier", body: "Ready to hand over → when the courier arrives press “Courier arrived”. Manual couriers get a checklist; automatic couriers take every ready parcel at once. A manifest is created and the order is Shipped.", href: "/handover", role: "warehouse" },
    { title: "Check what left", body: "Shipped → every parcel that left today, its manifest and whether it went by hand or automatically.", href: "/shipped", role: "office" },
    { title: "Back to the Dashboard", body: "Counts, pipeline and activity log have all updated. The order’s timeline shows every step with who and when.", href: "/", role: "office" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Settings & demo" subtitle="Switch demo roles, follow the 5-minute walkthrough, or restore the demo data." />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <LuPlay className="h-4 w-4 text-brand-600" />
            <h2 className="text-[15px] font-semibold text-ink">5-minute demo guide</h2>
          </div>
          <ol className="divide-y divide-line">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-4 px-5 py-3.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{s.title}</p>
                  <p className="text-sm text-ink-muted">{s.body}</p>
                </div>
                {s.href && (
                  <Link
                    href={s.href}
                    onClick={() => s.role && s.role !== role && setRole(s.role)}
                    className="btn btn-secondary shrink-0 self-center px-3 py-1.5 text-xs"
                  >
                    Go {s.role && s.role !== role ? `as ${s.role}` : ""} <LuArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>

        <div className="space-y-6">
          <section className="card card-pad">
            <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-ink">
              <LuUsers className="h-4 w-4 text-ink-muted" /> Demo role
            </h2>
            <p className="mb-3 text-sm text-ink-muted">No passwords — pick who you are. Actions are recorded under this name.</p>
            <div className="grid gap-2">
              {(
                [
                  ["office", "Office Operator", "Process orders, choose couriers, transfers, resolve issues"],
                  ["warehouse", "Warehouse Worker", "Big-button picking, packing, staging and receiving"],
                ] as const
              ).map(([r, t, d]) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={cx("rounded-xl border p-3 text-left", role === r ? "border-brand-400 bg-brand-50/60" : "border-slate-200 hover:border-slate-300")}
                >
                  <p className="text-sm font-semibold text-ink">{t}</p>
                  <p className="text-xs text-ink-muted">{d}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="card card-pad border-red-200">
            <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-ink">
              <LuRotateCcw className="h-4 w-4 text-red-600" /> Reset demo data
            </h2>
            <p className="mb-3 text-sm text-ink-muted">
              Rebuilds all orders, stock, issues and history relative to the current time. Everything you changed will be lost.
              {meta?.seeded_at && <> Last reset {fmtWhen(meta.seeded_at)}.</>}
            </p>
            <button className="btn btn-danger" onClick={() => setConfirm(true)} disabled={!isOffice} title={isOffice ? "" : "Office role only"}>
              Reset demo data
            </button>
          </section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <LuTruck className="h-4 w-4 text-ink-muted" />
            <h2 className="text-[15px] font-semibold text-ink">Couriers</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="table-head">
                <th className="px-5 py-2">Courier</th>
                <th className="px-3 py-2">Pickups</th>
                <th className="px-3 py-2">Cost</th>
                <th className="px-3 py-2">Delivery</th>
                <th className="px-5 py-2">Staging lane</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {meta?.couriers.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-2.5 font-medium text-ink">{c.name}</td>
                  <td className="px-3 py-2.5 text-ink-soft">{c.pickups.join(", ")}</td>
                  <td className="px-3 py-2.5 tabular-nums">{inr(c.cost)}</td>
                  <td className="px-3 py-2.5 text-ink-soft">{c.delivery}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{c.lane}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <LuSlidersHorizontal className="h-4 w-4 text-ink-muted" /> Operating rules
          </h2>
          <p className="mb-3 text-xs text-ink-muted">Configured in <span className="mono">backend/app/config.py</span> — one place, no magic numbers in the code.</p>
          {meta && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ["Priority cutoff", `${meta.thresholds.priority_cutoff} → same-day ship-by`],
                ["Normal cutoff", `${meta.thresholds.normal_cutoff} → next-day ship-by`],
                ["Ship-by time", meta.thresholds.ship_by_time],
                ["At risk (priority)", `${meta.thresholds.at_risk_priority_min / 60}h before ship-by`],
                ["At risk (normal)", `${meta.thresholds.at_risk_normal_min / 60}h before ship-by`],
                ["Pickup alert", `${meta.thresholds.pickup_alert_min} min before pickup`],
                ["Missed pickup after", `${meta.thresholds.missed_pickup_grace_min} min grace`],
                ["Weight tolerance", `±${meta.thresholds.weight_tolerance_pct}%`],
                ["Transfer required when", `available < ${meta.thresholds.replenish_below_pct}% of bin capacity`],
                ["Critical stock below", `${meta.thresholds.replenish_critical_pct}% of bin capacity`],
                ["Time zone", meta.timezone],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirm}
        title="Reset all demo data?"
        message="This deletes every change made during the demo and rebuilds the original scenario. This can't be undone."
        confirmLabel="Yes, reset"
        tone="danger"
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={reset}
      />
    </div>
  );
}
