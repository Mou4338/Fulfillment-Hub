"use client";

import {
  LuCircle, LuCircleCheck, LuCircleX, LuFlag, LuHandshake, LuInbox, LuLock, LuPackage, LuPackageCheck, LuScanLine,
  LuShoppingBag, LuTriangleAlert, LuTruck, LuWarehouse, LuArrowRightLeft, LuClipboardCheck, LuUndo2, LuPencil,
} from "react-icons/lu";
import { cx, fmtWhen } from "@/lib/format";
import type { ActivityRow } from "@/lib/types";

const STYLE: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: string; milestone?: boolean }> = {
  received: { icon: LuShoppingBag, tone: "text-slate-600 bg-slate-100", milestone: true },
  processed: { icon: LuClipboardCheck, tone: "text-brand-700 bg-brand-50", milestone: true },
  stock_reserved: { icon: LuLock, tone: "text-slate-600 bg-slate-100" },
  awaiting_stock: { icon: LuTriangleAlert, tone: "text-amber-700 bg-amber-50" },
  unblocked: { icon: LuCircleCheck, tone: "text-emerald-700 bg-emerald-50" },
  on_hold: { icon: LuTriangleAlert, tone: "text-amber-700 bg-amber-50", milestone: true },
  hold_released: { icon: LuCircleCheck, tone: "text-emerald-700 bg-emerald-50" },
  picking_started: { icon: LuWarehouse, tone: "text-sky-700 bg-sky-50", milestone: true },
  item_picked: { icon: LuCircleCheck, tone: "text-sky-700 bg-sky-50" },
  picking_completed: { icon: LuCircleCheck, tone: "text-sky-700 bg-sky-50", milestone: true },
  pick_problem: { icon: LuTriangleAlert, tone: "text-red-600 bg-red-50" },
  item_verified: { icon: LuScanLine, tone: "text-emerald-700 bg-emerald-50" },
  scan_failed: { icon: LuCircleX, tone: "text-red-600 bg-red-50" },
  label_failed: { icon: LuCircleX, tone: "text-red-600 bg-red-50" },
  packed: { icon: LuPackageCheck, tone: "text-indigo-700 bg-indigo-50", milestone: true },
  staged: { icon: LuPackage, tone: "text-violet-700 bg-violet-50", milestone: true },
  moved: { icon: LuPackage, tone: "text-violet-700 bg-violet-50" },
  handed_over: { icon: LuTruck, tone: "text-emerald-700 bg-emerald-50", milestone: true },
  manifest: { icon: LuHandshake, tone: "text-emerald-700 bg-emerald-50" },
  cancelled: { icon: LuCircleX, tone: "text-slate-600 bg-slate-100", milestone: true },
  issue_created: { icon: LuFlag, tone: "text-orange-700 bg-orange-50" },
  issue_resolved: { icon: LuCircleCheck, tone: "text-emerald-700 bg-emerald-50" },
  transfer_requested: { icon: LuArrowRightLeft, tone: "text-brand-700 bg-brand-50" },
  transfer_dispatched: { icon: LuArrowRightLeft, tone: "text-brand-700 bg-brand-50" },
  transfer_received: { icon: LuArrowRightLeft, tone: "text-emerald-700 bg-emerald-50" },
  delivery_received: { icon: LuInbox, tone: "text-brand-700 bg-brand-50" },
  putaway: { icon: LuWarehouse, tone: "text-emerald-700 bg-emerald-50" },
  returned_to_shelf: { icon: LuUndo2, tone: "text-slate-600 bg-slate-100" },
  stock_adjusted: { icon: LuPencil, tone: "text-amber-700 bg-amber-50" },
  pickup_rolled: { icon: LuTruck, tone: "text-amber-700 bg-amber-50" },
};

export function OrderTimeline({ rows, compact }: { rows: ActivityRow[]; compact?: boolean }) {
  if (!rows.length) return <p className="text-sm text-ink-muted">No events yet.</p>;
  return (
    <ol className="relative">
      {rows.map((r, i) => {
        const st = STYLE[r.action] || { icon: LuCircle, tone: "text-slate-500 bg-slate-100" };
        const Icon = st.icon;
        const last = i === rows.length - 1;
        return (
          <li key={(r.id ?? i) + r.at + i} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && <span className="absolute left-[13px] top-7 h-[calc(100%-20px)] w-px bg-slate-200" aria-hidden />}
            <span className={cx("relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full", st.tone)}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className={cx("text-sm leading-snug", st.milestone ? "font-semibold text-ink" : "text-ink-soft")}>{r.message}</p>
              {!compact && (
                <p className="mt-0.5 text-xs text-ink-muted">
                  {fmtWhen(r.at)} · {r.actor}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ActivityFeed({ rows }: { rows: ActivityRow[] }) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-ink-muted">No activity yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r, i) => {
        const st = STYLE[r.action] || { icon: LuCircle, tone: "text-slate-500 bg-slate-100" };
        const Icon = st.icon;
        return (
          <li key={(r.id ?? i) + r.at} className="flex gap-3 px-4 py-2.5">
            <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", st.tone)}>
              <Icon className="h-3 w-3" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink-soft">
                {r.order_id && <span className="mr-1 font-semibold text-ink">{r.order_id}</span>}
                {r.message}
              </p>
              <p className="text-xs text-ink-muted">
                {fmtWhen(r.at)} · {r.actor}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
