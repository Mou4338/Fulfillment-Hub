"use client";

import { LuFlag, LuClock, LuTriangleAlert, LuCircleCheck, LuLock } from "react-icons/lu";
import { cx, fmtDuration, minutesUntil } from "@/lib/format";
import type { Risk } from "@/lib/types";

const STATUS_TONE: Record<string, string> = {
  RECEIVED: "bg-slate-100 text-slate-700 ring-slate-200",
  ON_HOLD: "bg-amber-50 text-amber-800 ring-amber-200",
  AWAITING_STOCK: "bg-amber-50 text-amber-800 ring-amber-200",
  READY_TO_PICK: "bg-slate-100 text-slate-700 ring-slate-200",
  PICKING: "bg-sky-50 text-sky-800 ring-sky-200",
  READY_TO_PACK: "bg-sky-50 text-sky-800 ring-sky-200",
  PACKED: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  STAGED: "bg-violet-50 text-violet-800 ring-violet-200",
  SHIPPED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  CANCELLED: "bg-slate-50 text-slate-500 ring-slate-200",
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <span className={cx("chip", STATUS_TONE[status] || STATUS_TONE.RECEIVED, className)}>
      {label || status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

export function PriorityBadge({ priority, size = "sm" }: { priority: boolean; size?: "sm" | "lg" }) {
  if (!priority) return <span className="text-xs text-ink-faint">Normal</span>;
  return (
    <span
      className={cx(
        "chip bg-orange-50 text-orange-700 ring-orange-200",
        size === "lg" && "px-2.5 py-1 text-sm",
      )}
    >
      <LuFlag className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} /> Priority
    </span>
  );
}

const RISK_TONE: Record<string, string> = {
  on_track: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  at_risk: "bg-amber-50 text-amber-800 ring-amber-300",
  delayed: "bg-red-50 text-red-700 ring-red-200",
  done: "bg-slate-50 text-slate-500 ring-slate-200",
};

export function RiskBadge({ risk }: { risk: Risk }) {
  const Icon = risk.state === "delayed" || risk.state === "at_risk" ? LuTriangleAlert : LuCircleCheck;
  return (
    <span className={cx("chip", RISK_TONE[risk.state])} title={risk.reason || undefined}>
      <Icon className="h-3 w-3" />
      {risk.label}
    </span>
  );
}

export function TimeLeft({ shipBy, risk, now, className }: { shipBy: string; risk?: Risk; now: Date; className?: string }) {
  const m = minutesUntil(shipBy, now);
  if (m === null) return <span>—</span>;
  const state = risk?.state;
  if (state === "done") return <span className={cx("text-xs text-ink-faint", className)}>—</span>;
  const late = m < 0;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
        late || state === "delayed" ? "text-red-600" : state === "at_risk" ? "text-amber-700" : "text-ink-soft",
        className,
      )}
    >
      <LuClock className="h-3.5 w-3.5" />
      {late ? `${fmtDuration(m)} late` : `${fmtDuration(m)} left`}
    </span>
  );
}

const SEV_TONE: Record<string, string> = {
  Low: "bg-slate-100 text-slate-600 ring-slate-200",
  Medium: "bg-amber-50 text-amber-800 ring-amber-200",
  High: "bg-orange-50 text-orange-700 ring-orange-200",
  Critical: "bg-red-600 text-white ring-red-600",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={cx("chip", SEV_TONE[severity] || SEV_TONE.Low)}>{severity}</span>;
}

const ISSUE_STATUS_TONE: Record<string, string> = {
  Open: "bg-white text-ink ring-slate-300",
  "In Progress": "bg-sky-50 text-sky-800 ring-sky-200",
  Resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export function IssueStatusBadge({ status }: { status: string }) {
  return <span className={cx("chip", ISSUE_STATUS_TONE[status])}>{status}</span>;
}

export function BlockedChip({ label }: { label: string }) {
  return (
    <span className="chip bg-red-50 text-red-700 ring-red-200">
      <LuLock className="h-3 w-3" /> {label}
    </span>
  );
}
