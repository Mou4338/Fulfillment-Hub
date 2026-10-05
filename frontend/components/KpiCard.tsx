"use client";

import Link from "next/link";
import { LuArrowUpRight } from "react-icons/lu";
import { cx } from "@/lib/format";

type Tone = "neutral" | "warn" | "danger" | "good" | "brand";

const TONES: Record<Tone, { value: string; ring: string; icon: string; bar: string }> = {
  neutral: { value: "text-ink", ring: "hover:border-slate-300", icon: "bg-slate-100 text-ink-muted", bar: "bg-slate-300" },
  brand: { value: "text-ink", ring: "hover:border-brand-300", icon: "bg-brand-50 text-brand-700", bar: "bg-brand-500" },
  warn: { value: "text-amber-700", ring: "border-amber-200 hover:border-amber-300", icon: "bg-amber-50 text-amber-700", bar: "bg-amber-400" },
  danger: { value: "text-red-600", ring: "border-red-200 hover:border-red-300", icon: "bg-red-50 text-red-600", bar: "bg-red-500" },
  good: { value: "text-emerald-700", ring: "hover:border-emerald-300", icon: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
};

export function KpiCard({
  label,
  value,
  hint,
  href,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  hint?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: Tone;
}) {
  const t = TONES[tone];
  return (
    <Link
      href={href}
      className={cx(
        "card group relative flex flex-col justify-between gap-3 overflow-hidden p-4 pl-5 transition-all hover:-translate-y-px hover:shadow-raised",
        t.ring,
      )}
    >
      <span className={cx("absolute inset-y-0 left-0 w-1", t.bar)} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold leading-5 text-ink-muted">{label}</span>
        <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", t.icon)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className={cx("text-[30px] font-bold leading-none tabular-nums tracking-tight", t.value)}>{value}</span>
        <LuArrowUpRight className="h-4 w-4 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      {hint && <span className="truncate text-xs text-ink-muted">{hint}</span>}
    </Link>
  );
}
