"use client";

import Link from "next/link";
import { LuChevronRight, LuHandshake, LuLayoutGrid, LuPackageCheck, LuSend } from "react-icons/lu";
import { useApi } from "@/lib/hooks";
import { cx } from "@/lib/format";

const STEPS = [
  { href: "/packing", key: "packing", label: "Packing", hint: "Scan & box", icon: LuPackageCheck },
  { href: "/staging", key: "staging", label: "Staging", hint: "Put it in its area", icon: LuLayoutGrid },
  { href: "/handover", key: "handover", label: "Ready to hand over", hint: "Courier takes it", icon: LuHandshake },
  { href: "/shipped", key: "shipped", label: "Shipped", hint: "Left the building", icon: LuSend },
] as const;

export function DispatchFlow({ current }: { current: "staging" | "handover" | "shipped" }) {
  const { data: counts } = useApi<Record<string, number>>("/api/nav-counts", { poll: 30000 });
  return (
    <nav aria-label="Dispatch steps" className="card flex items-stretch overflow-x-auto p-1.5">
      {STEPS.map((s, i) => {
        const active = s.key === current;
        const n = s.key === "shipped" ? undefined : counts?.[s.key];
        return (
          <div key={s.key} className="flex min-w-0 flex-1 items-center">
            <Link
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex min-w-[150px] flex-1 items-center gap-2.5 rounded-lg px-3 py-2 transition-colors",
                active ? "bg-brand-600 text-white shadow-card" : "text-ink-soft hover:bg-slate-50",
              )}
            >
              <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", active ? "bg-white/15" : "bg-slate-100 text-ink-muted")}>
                <s.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-semibold">
                  {i + 1}. {s.label}
                </span>
                <span className={cx("block truncate text-[11px]", active ? "text-white/80" : "text-ink-muted")}>
                  {n !== undefined ? `${n} waiting · ` : ""}
                  {s.hint}
                </span>
              </span>
            </Link>
            {i < STEPS.length - 1 && <LuChevronRight className="mx-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />}
          </div>
        );
      })}
    </nav>
  );
}
