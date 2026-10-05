"use client";

import { LuSearch, LuX } from "react-icons/lu";
import { cx } from "@/lib/format";

export function Select({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <label className={cx("relative block", className)}>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          "input appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8",
          value ? "border-brand-400 bg-brand-50/40 font-semibold text-brand-800" : "",
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cx("relative", className)}>
      <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
      <input
        className="input pl-9 pr-8"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink" onClick={() => onChange("")} aria-label="Clear search">
          <LuX className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function FilterBar({ children, onReset, active }: { children: React.ReactNode; onReset?: () => void; active?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {onReset && active && (
        <button className="btn btn-ghost text-xs" onClick={onReset}>
          <LuX className="h-3.5 w-3.5" /> Clear filters
        </button>
      )}
    </div>
  );
}

export function Tabs({
  value,
  onChange,
  tabs,
}: {
  value: string;
  onChange: (v: string) => void;
  tabs: { value: string; label: string; count?: number }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx("tab", value === t.value && "tab-active")}
        >
          {t.label}
          {t.count !== undefined && (
            <span
              className={cx(
                "ml-1.5 rounded-full px-1.5 text-xs tabular-nums",
                value === t.value ? "bg-white/20 text-white" : "bg-slate-100 text-ink-muted",
              )}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
