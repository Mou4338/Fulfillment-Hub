"use client";

import { LuCircleAlert, LuInbox, LuRefreshCw } from "react-icons/lu";
import { cx } from "@/lib/format";

export function EmptyState({
  title,
  hint,
  icon: Icon = LuInbox,
  tone = "neutral",
  action,
  compact,
}: {
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "good";
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center text-center", compact ? "px-4 py-6" : "px-6 py-12")}>
      <div
        className={cx(
          "mb-3 flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-inset",
          tone === "good" ? "bg-emerald-50 text-emerald-600 ring-emerald-100" : "bg-slate-50 text-ink-faint ring-slate-200",
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-ink-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card card-pad flex items-start gap-3 border-red-200 bg-red-50/60">
      <LuCircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-red-900">Couldn&apos;t load this</p>
        <p className="mt-0.5 text-sm text-red-800">{message}</p>
      </div>
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          <LuRefreshCw className="h-4 w-4" /> Retry
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-slate-200/70", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
