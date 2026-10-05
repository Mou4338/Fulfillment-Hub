"use client";

import { LuMinus, LuPlus } from "react-icons/lu";
import { cx } from "@/lib/format";

export function QtyInput({
  value,
  onChange,
  min = 0,
  max,
  label,
  tone,
  size = "md",
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
  tone?: "bad" | "warn";
  size?: "sm" | "md";
}) {
  const clamp = (n: number) => Math.max(min, max !== undefined ? Math.min(max, n) : n);
  const h = size === "sm" ? "h-9" : "h-11";
  return (
    <div className={cx("inline-flex items-stretch overflow-hidden rounded-lg border bg-white", tone === "bad" ? "border-red-300" : tone === "warn" ? "border-amber-300" : "border-slate-300")}>
      <button type="button" className={cx(h, "w-9 text-ink-muted hover:bg-slate-50 disabled:opacity-40")} onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={`Less ${label}`}>
        <LuMinus className="mx-auto h-4 w-4" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className={cx(h, "w-14 border-x border-slate-200 text-center text-base font-semibold tabular-nums text-ink focus:outline-none", tone === "bad" && "text-red-700", tone === "warn" && "text-amber-800")}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(clamp(Math.floor(Number(e.target.value) || 0)))}
        onFocus={(e) => e.target.select()}
        aria-label={label}
      />
      <button type="button" className={cx(h, "w-9 text-ink-muted hover:bg-slate-50 disabled:opacity-40")} onClick={() => onChange(clamp(value + 1))} disabled={max !== undefined && value >= max} aria-label={`More ${label}`}>
        <LuPlus className="mx-auto h-4 w-4" />
      </button>
    </div>
  );
}
