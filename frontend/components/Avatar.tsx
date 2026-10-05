"use client";

import { cx } from "@/lib/format";

const PALETTE = [
  "bg-teal-100 text-teal-800 ring-teal-200",
  "bg-sky-100 text-sky-800 ring-sky-200",
  "bg-violet-100 text-violet-800 ring-violet-200",
  "bg-amber-100 text-amber-800 ring-amber-200",
  "bg-rose-100 text-rose-800 ring-rose-200",
  "bg-indigo-100 text-indigo-800 ring-indigo-200",
  "bg-lime-100 text-lime-800 ring-lime-200",
];

export function personColor(name: string) {
  if (name === "System") return "bg-slate-200 text-slate-700 ring-slate-300";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string) {
  const base = name.replace(/\(.*\)/, "").trim();
  if (base === "System") return "SY";
  const parts = base.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
};

export function Avatar({ name, size = "sm", className }: { name: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold ring-1 ring-inset",
        SIZES[size],
        personColor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
