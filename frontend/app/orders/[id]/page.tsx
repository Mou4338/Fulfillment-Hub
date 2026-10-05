"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  LuArrowLeft, LuMapPin, LuPhone, LuTruck, LuPackage, LuTag, LuCircleCheck, LuCircleX, LuFlag, LuCheck, LuStore,
} from "react-icons/lu";
import { post } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";
import { useRole, useToast } from "@/lib/context";
import { cx, fmtWhen, inr, plural } from "@/lib/format";
import type { OrderDetail } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { BlockedReason, NextActionBanner } from "@/components/NextActionBanner";
import { OrderTimeline } from "@/components/OrderTimeline";
import { ErrorState, PageSkeleton } from "@/components/EmptyState";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { IssueStatusBadge, PriorityBadge, RiskBadge, SeverityBadge, StatusBadge, TimeLeft } from "@/components/StatusBadge";

const STEPS: { key: string; label: string; ts: string }[] = [
  { key: "received", label: "Received", ts: "received_at" },
  { key: "processed", label: "Processed", ts: "processed_at" },
  { key: "picking", label: "Picked", ts: "picked_at" },
  { key: "packing", label: "Packed", ts: "packed_at" },
  { key: "staging", label: "Staged", ts: "staged_at" },
  { key: "shipped", label: "Shipped", ts: "shipped_at" },
];

const PICK_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "To pick", cls: "text-ink-muted" },
  picked: { text: "Picked", cls: "text-emerald-700" },
  not_found: { text: "Not found", cls: "text-red-600" },
  damaged: { text: "Damaged", cls: "text-red-600" },
};

export default function OrderDetailPage() {
  const params = useParams() as { id: string };
  const id = decodeURIComponent(params.id || "");
  const { data: o, error, loading, reload } = useApi<OrderDetail>(`/api/orders/${id}`, { poll: 30000 });
  const now = useNow();
  const { isOffice } = useRole();
  const toast = useToast();
  const [courierOpen, setCourierOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <PageSkeleton />;
  if (error && !o) return <ErrorState message={error} onRetry={reload} />;
  if (!o) return null;

  const openStatus = !["SHIPPED", "CANCELLED"].includes(o.status);

  async function act(fn: () => Promise<any>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      setCourierOpen(false);
      setCancelOpen(false);
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <LuArrowLeft className="h-4 w-4" /> All orders
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="mono">{o.id}</span>
            <PriorityBadge priority={o.priority} size="lg" />
            <StatusBadge status={o.status} label={o.status_label} className="px-2.5 py-1 text-sm" />
            {openStatus && <RiskBadge risk={o.risk} />}
          </span>
        }
        subtitle={
          <span>
            {o.customer_name} · {o.channel} <span className="mono text-ink-faint">{o.channel_ref}</span> · {plural(o.units, "unit")} · {inr(o.order_value)}
          </span>
        }
        actions={
          isOffice &&
          openStatus && (
            <>
              <button className="btn btn-secondary" onClick={() => setCourierOpen(true)} disabled={!o.courier_options.length}>
                <LuTruck className="h-4 w-4" /> Change courier
              </button>
              <button className="btn btn-secondary text-red-600" onClick={() => setCancelOpen(true)}>
                <LuCircleX className="h-4 w-4" /> Cancel order
              </button>
            </>
          )
        }
      />

      {/* Stage progress */}
      <div className="card card-pad">
        <div className="grid grid-cols-3 gap-y-4 sm:grid-cols-6">
          {STEPS.map((s, i) => {
            const t = o.timestamps[s.ts];
            const done = !!t;
            const current = !done && (i === 0 || !!o.timestamps[STEPS[i - 1].ts]) && o.status !== "CANCELLED";
            return (
              <div key={s.key} className="relative flex flex-col items-center text-center">
                {i > 0 && <span className={cx("absolute right-1/2 top-3.5 hidden h-0.5 w-full sm:block", done ? "bg-brand-500" : "bg-slate-200")} aria-hidden />}
                <span
                  className={cx(
                    "relative z-[1] flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold",
                    done ? "border-brand-600 bg-brand-600 text-white" : current ? "border-brand-500 bg-white text-brand-700" : "border-slate-200 bg-white text-ink-faint",
                  )}
                >
                  {done ? <LuCheck className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <p className={cx("mt-1.5 text-xs font-semibold", done || current ? "text-ink" : "text-ink-faint")}>{s.label}</p>
                <p className="text-[11px] text-ink-muted">{t ? fmtWhen(t, now) : current ? "Next" : "—"}</p>
              </div>
            );
          })}
        </div>
        {openStatus && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
            <span className="text-ink-muted">
              Ship by <span className="font-semibold text-ink">{fmtWhen(o.ship_by, now)}</span>
            </span>
            <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} className="text-sm" />
            {o.risk.reason && <span className="text-xs text-ink-muted">({o.risk.reason})</span>}
            {o.after_cutoff && <span className="chip bg-slate-50 text-ink-muted ring-slate-200">Received after cutoff — ships next day</span>}
          </div>
        )}
        {o.status === "CANCELLED" && <p className="mt-4 border-t border-line pt-3 text-center text-sm text-ink-muted">Cancelled: {o.cancel_reason}</p>}
      </div>

      {o.blocked_info.blocked && <BlockedReason reasons={o.blocked_info.reasons} />}
      <NextActionBanner order={o} onDone={reload} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="border-b border-line px-5 py-3">
              <h2 className="text-[15px] font-semibold text-ink">Items</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="table-head">
                    <th className="px-5 py-2.5">Product</th>
                    <th className="px-3 py-2.5">SKU</th>
                    <th className="px-3 py-2.5 text-right">Qty</th>
                    <th className="px-3 py-2.5">Bin (Main)</th>
                    <th className="px-3 py-2.5">Stock</th>
                    <th className="px-5 py-2.5">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {o.line_items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-ink">{i.name}</p>
                        <p className="text-xs text-ink-muted">{i.variant}</p>
                      </td>
                      <td className="mono px-3 py-3 text-ink-soft">{i.sku}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{i.qty}</td>
                      <td className="mono px-3 py-3 text-ink-soft">{i.bin}</td>
                      <td className="px-3 py-3 text-xs text-ink-muted">
                        {i.reserved_qty > 0 ? <span className="font-semibold text-ink-soft">{i.reserved_qty} reserved</span> : i.picked_qty > 0 ? "—" : `Main ${i.main_available} · Sec ${i.secondary_available}`}
                      </td>
                      <td className="px-5 py-3 text-xs">
                        <span className={cx("font-semibold", PICK_LABEL[i.pick_status].cls)}>{PICK_LABEL[i.pick_status].text}</span>
                        {i.verified_qty > 0 && <span className="text-ink-muted"> · {i.verified_qty}/{i.qty} verified</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-pad">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-ink">Timeline</h2>
              <Link href={`/activity?range=all&order=${encodeURIComponent(o.id)}`} className="link text-xs">
                Full record →
              </Link>
            </div>
            <OrderTimeline rows={o.timeline} />
          </div>
        </div>

        <div className="space-y-6">
          <div className="card card-pad space-y-3 text-sm">
            <h2 className="text-[15px] font-semibold text-ink">Customer & delivery</h2>
            <p className="font-medium text-ink">{o.customer_name}</p>
            <p className="flex gap-2 text-ink-soft">
              <LuMapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
              <span>
                {o.address || <em className="text-red-600">No street address</em>}, {o.city} {o.pincode || <em className="text-red-600">no PIN</em>}
              </span>
            </p>
            <p className="flex gap-2 text-ink-soft">
              <LuPhone className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
              {o.phone || <em className="text-red-600">No phone number</em>}
            </p>
            <p className="flex gap-2 text-ink-soft">
              <LuStore className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
              {o.channel} · received {fmtWhen(o.received_at, now)}
            </p>
          </div>

          <div className="card card-pad space-y-2 text-sm">
            <h2 className="text-[15px] font-semibold text-ink">Courier</h2>
            {o.courier ? (
              <>
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <LuTruck className="h-4 w-4 text-ink-muted" /> {o.courier.name}
                </p>
                <p className="text-ink-soft">
                  {inr(o.courier.cost)} per parcel · delivers in {o.courier.delivery}
                </p>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-ink-soft">
                  <span className="font-semibold">Why this courier: </span>
                  {o.courier.reason}
                </p>
                {o.label_code && (
                  <p className="flex items-center gap-2 text-ink-soft">
                    <LuTag className="h-4 w-4 text-ink-faint" /> Label <span className="mono">{o.label_code}</span>
                  </p>
                )}
              </>
            ) : (
              <p className="text-ink-muted">Chosen when the order is processed.</p>
            )}
          </div>

          {o.package && (
            <div className="card card-pad space-y-2 text-sm">
              <h2 className="text-[15px] font-semibold text-ink">Package</h2>
              <p className="flex items-center gap-2 font-semibold text-ink">
                <LuPackage className="h-4 w-4 text-ink-muted" /> <span className="mono">{o.package.id}</span>
                <span className="chip bg-slate-100 text-ink-soft ring-slate-200">{o.package.status.replace("_", " ")}</span>
              </p>
              <p className="text-ink-soft">
                {o.package.package_type} · {o.package.dims} · {o.package.weight_kg.toFixed(2)} kg
              </p>
              {o.package.staging_location && (
                <p className="text-ink-soft">
                  Location: <span className="font-semibold text-ink">{o.package.staging_location}</span>
                </p>
              )}
              {o.package.pickup_at && o.package.status !== "handed_over" && <p className="text-ink-soft">Pickup: {fmtWhen(o.package.pickup_at, now)}</p>}
              {o.package.manifest_id && <p className="text-ink-soft">Manifest {o.package.manifest_id} · {fmtWhen(o.package.handed_over_at, now)}</p>}
            </div>
          )}

          <div className="card card-pad text-sm">
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Issues</h2>
            {o.issues.length === 0 ? (
              <p className="flex items-center gap-2 text-ink-muted">
                <LuCircleCheck className="h-4 w-4 text-emerald-600" /> No issues on this order.
              </p>
            ) : (
              <ul className="space-y-2">
                {o.issues.map((i) => (
                  <li key={i.id}>
                    <Link href={`/issues?id=${i.id}`} className="block rounded-lg border border-slate-200 p-2.5 hover:border-slate-300">
                      <div className="flex items-center gap-2">
                        <LuFlag className="h-3.5 w-3.5 text-ink-muted" />
                        <span className="mono text-xs text-ink-muted">{i.id}</span>
                        <SeverityBadge severity={i.severity} />
                        <IssueStatusBadge status={i.status} />
                      </div>
                      <p className="mt-1 text-sm font-medium text-ink">{i.title}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Modal open={courierOpen} onClose={() => setCourierOpen(false)} title="Choose courier" subtitle="Next pickup, cost and speed for each option." size="md">
        <ul className="space-y-2">
          {o.courier_options.map((c) => (
            <li key={c.id}>
              <button
                disabled={busy}
                onClick={() => act(() => post(`/api/orders/${o.id}/courier`, { courier_id: c.id }), `Courier changed to ${c.name}`)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl border p-3 text-left hover:border-brand-300",
                  o.courier_id === c.id ? "border-brand-400 bg-brand-50/50" : "border-slate-200",
                )}
              >
                <LuTruck className="h-5 w-5 text-ink-muted" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {c.name} {o.courier_id === c.id && <span className="text-xs font-normal text-brand-700">(current)</span>}
                  </p>
                  <p className="text-xs text-ink-muted">
                    Next pickup {c.next_pickup_label} · {inr(c.cost)} · {c.delivery}
                  </p>
                </div>
                {c.meets_ship_by ? (
                  <span className="chip bg-emerald-50 text-emerald-700 ring-emerald-200">Makes ship-by</span>
                ) : (
                  <span className="chip bg-amber-50 text-amber-800 ring-amber-200">Misses ship-by</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        title={`Cancel ${o.id}?`}
        message="Reserved stock is released. If items were already picked, a return-to-shelf task is created so nothing is lost."
        confirmLabel="Cancel order"
        tone="danger"
        busy={busy}
        onCancel={() => setCancelOpen(false)}
        onConfirm={() => act(() => post(`/api/orders/${o.id}/cancel`, { reason: reason || "Cancelled by office" }), `${o.id} cancelled`)}
      >
        <label className="label mt-3" htmlFor="reason">
          Reason
        </label>
        <input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer cancelled on the marketplace" />
      </ConfirmDialog>
    </div>
  );
}
