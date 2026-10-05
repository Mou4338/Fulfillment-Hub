"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LuLayoutDashboard, LuShoppingBag, LuInbox, LuWarehouse, LuPackageCheck, LuBoxes, LuFlag, LuChartColumn,
  LuSettings, LuBell, LuMenu, LuX, LuNotebookPen, LuBuilding2, LuTriangleAlert, LuListOrdered, LuBookOpen,
  LuCircleHelp, LuShoppingCart, LuLayoutGrid, LuHandshake, LuSend, LuClipboardCheck, LuChevronDown, LuUser,
  LuUsers, LuCheck, LuChevronRight,
} from "react-icons/lu";
import { useApi, useNow } from "@/lib/hooks";
import { PEOPLE, Role, useRole, useWarehouse } from "@/lib/context";
import { ago, cx, fmtClock, fmtDateLong } from "@/lib/format";
import { SearchBar } from "./SearchBar";
import { Avatar } from "./Avatar";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: string;
  roles: Role[];
};

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LuLayoutDashboard, roles: ["office", "warehouse"] },
      { href: "/processing", label: "Processing desk", icon: LuListOrdered, count: "processing", roles: ["office"] },
      { href: "/orders", label: "Orders", icon: LuShoppingBag, count: "orders_attention", roles: ["office"] },
    ],
  },
  {
    group: "Warehouse floor",
    items: [
      { href: "/receiving", label: "Receiving", icon: LuInbox, count: "receiving", roles: ["office", "warehouse"] },
      { href: "/picking", label: "Picking", icon: LuWarehouse, count: "picking", roles: ["office", "warehouse"] },
      { href: "/packing", label: "Packing", icon: LuPackageCheck, count: "packing", roles: ["office", "warehouse"] },
      { href: "/staging", label: "Staging", icon: LuLayoutGrid, count: "staging", roles: ["office", "warehouse"] },
      { href: "/handover", label: "Ready to hand over", icon: LuHandshake, count: "handover", roles: ["office", "warehouse"] },
      { href: "/shipped", label: "Shipped", icon: LuSend, roles: ["office", "warehouse"] },
    ],
  },
  {
    group: "Control",
    items: [
      { href: "/inventory", label: "Inventory & bins", icon: LuBoxes, count: "replenish", roles: ["office", "warehouse"] },
      { href: "/reorders", label: "Reorders", icon: LuShoppingCart, count: "reorders", roles: ["office", "warehouse"] },
      { href: "/issues", label: "Issues", icon: LuFlag, count: "issues", roles: ["office", "warehouse"] },
      { href: "/analytics", label: "Analytics", icon: LuChartColumn, roles: ["office"] },
    ],
  },
  {
    group: "Team",
    items: [
      { href: "/activity", label: "Activity records", icon: LuClipboardCheck, roles: ["office", "warehouse"] },
      { href: "/shift", label: "Shift handover", icon: LuNotebookPen, roles: ["office", "warehouse"] },
      { href: "/guide", label: "Guide & glossary", icon: LuBookOpen, roles: ["office", "warehouse"] },
      { href: "/settings", label: "Settings & demo", icon: LuSettings, roles: ["office", "warehouse"] },
    ],
  },
];

const EXTRA_TITLES: { prefix: string; title: string; parent?: { href: string; label: string } }[] = [
  { prefix: "/orders/", title: "Order details", parent: { href: "/orders", label: "Orders" } },
  { prefix: "/picking/", title: "Pick list", parent: { href: "/picking", label: "Picking" } },
  { prefix: "/packing/", title: "Pack & verify", parent: { href: "/packing", label: "Packing" } },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function currentPage(pathname: string): { title: string; group?: string; parent?: { href: string; label: string } } {
  for (const x of EXTRA_TITLES) if (pathname.startsWith(x.prefix)) return { title: x.title, parent: x.parent };
  for (const g of NAV) for (const i of g.items) if (isActive(pathname, i.href)) return { title: i.label, group: g.group };
  return { title: "Fulfillment Hub" };
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() || "/";
  const { role, setRole, user } = useRole();
  const { warehouse, setWarehouse } = useWarehouse();
  const { data: counts } = useApi<Record<string, number>>("/api/nav-counts", { poll: 30000 });

  return (
    <div className="flex h-full flex-col bg-navy-900 text-navy-200">
      {/* brand */}
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-lg shadow-brand-900/40">
          <LuPackageCheck className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <p className="text-[15px] font-bold tracking-tight text-white">Fulfillment Hub</p>
          <p className="text-xs text-navy-400">XYZ Commerce</p>
        </div>
      </div>

      {/* warehouse switch */}
      <div className="px-4 pb-4">
        <label className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 transition-colors hover:bg-white/[0.07]">
          <LuBuilding2 className="h-4 w-4 shrink-0 text-brand-300" />
          <span className="sr-only">Warehouse</span>
          <select
            aria-label="Warehouse"
            className="w-full cursor-pointer bg-transparent text-[13px] font-semibold text-white focus:outline-none [&>option]:text-ink"
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value as "MAIN" | "SEC")}
          >
            <option value="MAIN">Main Warehouse · ships</option>
            <option value="SEC">Secondary · overflow</option>
          </select>
        </label>
      </div>

      {/* menu */}
      <nav className="nav-scroll flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => i.roles.includes(role));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <p className="px-3 pb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-navy-500">{g.group}</p>
              <ul className="space-y-0.5">
                {items.map((i) => {
                  const active = isActive(pathname, i.href);
                  const n = i.count && counts ? counts[i.count] : undefined;
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
                          active ? "bg-brand-500/15 text-white" : "text-navy-300 hover:bg-white/[0.06] hover:text-white",
                        )}
                      >
                        {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-brand-400" />}
                        <i.icon className={cx("h-[18px] w-[18px] shrink-0", active ? "text-brand-300" : "text-navy-400 group-hover:text-navy-200")} />
                        <span className="flex-1 truncate">{i.label}</span>
                        {n !== undefined && n > 0 && (
                          <span
                            className={cx(
                              "min-w-[24px] rounded-full px-1.5 py-px text-center text-[11px] font-bold tabular-nums",
                              active ? "bg-brand-400 text-navy-950" : "bg-white/10 text-navy-200",
                            )}
                          >
                            {n}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* who is working */}
      <div className="border-t border-white/10 p-4">
        <div className="mb-3 flex items-center gap-3">
          <Avatar name={user} size="md" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-white">{user.replace(/ \(.*\)$/, "")}</p>
            <p className="text-xs text-navy-400">{role === "office" ? "Office operator" : "Warehouse worker"}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[0.06] p-1" role="group" aria-label="Demo role">
          {(["office", "warehouse"] as Role[]).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className={cx(
                "rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
                role === r ? "bg-white text-navy-900 shadow" : "text-navy-300 hover:text-white",
              )}
            >
              {r === "office" ? "Office" : "Warehouse"}
            </button>
          ))}
        </div>
        <p className="mt-2 px-0.5 text-[11px] text-navy-500">Demo roles · every action is recorded</p>
      </div>
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ count: number; items: { kind: string; title: string; severity: string; at: string; link: string }[] }>(
    "/api/notifications",
    { poll: 30000 },
  );
  const box = useRef<HTMLDivElement>(null);
  const now = useNow();
  useOutside(box, () => setOpen(false));
  const count = data?.count || 0;
  return (
    <div ref={box} className="relative">
      <button
        className={cx("btn btn-ghost btn-icon relative rounded-full", open && "bg-slate-100")}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Urgent alerts: ${count}`}
        title="Urgent alerts"
      >
        <LuBell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="fade-in absolute right-0 top-12 z-50 w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-white shadow-pop">
          <div className="flex items-center justify-between border-b border-line bg-slate-50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">Urgent alerts</p>
              <p className="text-xs text-ink-muted">High-severity problems and delayed priority orders only.</p>
            </div>
            {count > 0 && <span className="chip bg-red-50 text-red-700 ring-red-200">{count} open</span>}
          </div>
          <ul className="max-h-[60vh] divide-y divide-line overflow-auto">
            {!count && <li className="px-4 py-8 text-center text-sm text-ink-muted">All clear — nothing urgent right now.</li>}
            {data?.items.map((n, i) => (
              <li key={i}>
                <Link href={n.link} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 transition-colors hover:bg-slate-50">
                  <span
                    className={cx(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                      n.severity === "Critical" ? "bg-red-50 text-red-600" : "bg-orange-50 text-orange-600",
                    )}
                  >
                    <LuTriangleAlert className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{n.title}</span>
                    <span className="text-xs text-ink-muted">{n.kind === "delayed" ? "Ship-by passed" : ago(n.at, now)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PersonMenu() {
  const [open, setOpen] = useState(false);
  const { role, setRole, user } = useRole();
  const box = useRef<HTMLDivElement>(null);
  useOutside(box, () => setOpen(false));
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div ref={box} className="relative">
      <button
        className={cx("flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-slate-100", open && "bg-slate-100")}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={user} size="sm" />
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-[13px] font-semibold text-ink">{user.replace(/ \(.*\)$/, "")}</span>
          <span className="block text-[11px] text-ink-muted">{role === "office" ? "Office" : "Warehouse"}</span>
        </span>
        <LuChevronDown className="hidden h-4 w-4 text-ink-faint md:block" />
      </button>
      {open && (
        <div role="menu" className="fade-in absolute right-0 top-12 z-50 w-72 overflow-hidden rounded-xl border border-line bg-white shadow-pop">
          <div className="flex items-center gap-3 border-b border-line bg-slate-50 px-4 py-3">
            <Avatar name={user} size="md" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-ink">{user}</p>
              <p className="text-xs text-ink-muted">Everything you do is on the record</p>
            </div>
          </div>
          <div className="p-1.5">
            <Link role="menuitem" href={`/activity?actor=${encodeURIComponent(user)}`} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-slate-100 hover:text-ink">
              <LuUser className="h-4 w-4 text-ink-muted" /> My activity
            </Link>
            <Link role="menuitem" href="/activity" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-slate-100 hover:text-ink">
              <LuUsers className="h-4 w-4 text-ink-muted" /> Everyone&apos;s activity
            </Link>
          </div>
          <div className="border-t border-line p-1.5">
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Switch person</p>
            {(["office", "warehouse"] as Role[]).map((r) => (
              <button
                key={r}
                role="menuitemradio"
                aria-checked={role === r}
                onClick={() => {
                  setRole(r);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink-soft hover:bg-slate-100 hover:text-ink"
              >
                <Avatar name={PEOPLE[r]} size="xs" />
                <span className="flex-1">{PEOPLE[r]}</span>
                {role === r && <LuCheck className="h-4 w-4 text-brand-600" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LiveClock() {
  const now = useNow(15000);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="hidden w-32 xl:block" />;
  return (
    <div className="hidden text-right leading-tight xl:block">
      <p className="text-sm font-semibold tabular-nums text-ink">{fmtClock(now)}</p>
      <p className="text-[11px] text-ink-muted">{fmtDateLong(now)}</p>
    </div>
  );
}

function useOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname() || "/";
  useEffect(() => setDrawer(false), [pathname]);
  const page = currentPage(pathname);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] lg:block print:hidden">
        <Sidebar />
      </aside>
      {/* Mobile / tablet drawer */}
      {drawer && (
        <div className="fixed inset-0 z-[60] lg:hidden print:hidden">
          <div className="absolute inset-0 bg-navy-950/50 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] shadow-pop animate-[fhin_.15s_ease-out]">
            <button
              className="absolute right-3 top-6 z-10 rounded-lg p-1.5 text-navy-300 hover:bg-white/10 hover:text-white"
              onClick={() => setDrawer(false)}
              aria-label="Close menu"
            >
              <LuX className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur print:hidden">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button className="btn btn-ghost -ml-2 px-2 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
              <LuMenu className="h-5 w-5" />
            </button>
            {/* where am I */}
            <div className="hidden min-w-0 shrink-0 leading-tight md:block md:w-48 xl:w-56">
              <p className="flex items-center gap-1 truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {page.parent ? (
                  <>
                    <Link href={page.parent.href} className="hover:text-brand-700">{page.parent.label}</Link>
                    <LuChevronRight className="h-3 w-3" />
                  </>
                ) : (
                  page.group || "Fulfillment Hub"
                )}
              </p>
              <p className="truncate text-[15px] font-semibold text-ink">{page.title}</p>
            </div>
            <div className="min-w-0 flex-1">
              <SearchBar />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
              <LiveClock />
              <span className="mx-1 hidden h-8 w-px bg-line xl:block" />
              <Link href="/guide" className="btn btn-ghost btn-icon rounded-full" aria-label="Guide and glossary" title="Guide & glossary">
                <LuCircleHelp className="h-5 w-5" />
              </Link>
              <Notifications />
              <span className="mx-1 hidden h-8 w-px bg-line sm:block" />
              <PersonMenu />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  icon: Icon,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        {Icon && (
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700 sm:flex">
            <Icon className="h-6 w-6" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="mb-1 text-sm text-ink-muted">{eyebrow}</div>}
          <h1 className="text-[22px] font-bold leading-tight text-ink sm:text-[26px]">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-3xl text-sm text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
