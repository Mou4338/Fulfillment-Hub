"use client";

import { LuFlag, LuLock, LuUser } from "react-icons/lu";
import { ago, cx } from "@/lib/format";
import type { Issue } from "@/lib/types";
import { IssueStatusBadge, SeverityBadge } from "./StatusBadge";

export function IssueCard({ issue, active, onClick, now }: { issue: Issue; active?: boolean; onClick?: () => void; now: Date }) {
  const resolved = issue.status === "Resolved";
  return (
    <button
      onClick={onClick}
      className={cx(
        "w-full rounded-xl border bg-white p-3.5 text-left transition-colors",
        active ? "border-brand-400 ring-2 ring-brand-500/20" : "border-slate-200 hover:border-slate-300",
        resolved && "opacity-70",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="mono text-xs font-semibold text-ink-muted">{issue.id}</span>
        <SeverityBadge severity={issue.severity} />
        <IssueStatusBadge status={issue.status} />
        {issue.blocking && !resolved && (
          <span className="chip bg-red-50 text-red-700 ring-red-200">
            <LuLock className="h-3 w-3" /> Blocks order
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-semibold text-ink">{issue.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <LuFlag className="h-3 w-3" /> {issue.type}
        </span>
        {issue.order_id && <span className="mono">{issue.order_id}</span>}
        {issue.assignee && (
          <span className="inline-flex items-center gap-1">
            <LuUser className="h-3 w-3" /> {issue.assignee}
          </span>
        )}
        <span>{ago(issue.created_at, now)}</span>
      </div>
    </button>
  );
}
