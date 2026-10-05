"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LuSearch, LuShoppingBag, LuPackage, LuFlag, LuTag, LuShoppingCart, LuInbox } from "react-icons/lu";
import { api } from "@/lib/api";
import { cx } from "@/lib/format";

interface Result {
  type: "Order" | "Product" | "Package" | "Issue" | "Reorder" | "Delivery";
  id: string;
  title: string;
  subtitle: string;
  link: string;
}

const ICONS = { Order: LuShoppingBag, Product: LuTag, Package: LuPackage, Issue: LuFlag, Reorder: LuShoppingCart, Delivery: LuInbox };

export function SearchBar() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setResults(await api<Result[]>(`/api/search?q=${encodeURIComponent(q.trim())}`));
        setActive(0);
      } catch {
        setResults([]);
      }
    }, 160);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function go(r: Result) {
    setOpen(false);
    setQ("");
    router.push(r.link);
  }

  const groups = (["Order", "Package", "Product", "Reorder", "Delivery", "Issue"] as const)
    .map((type) => ({ type, items: results.filter((r) => r.type === type) }))
    .filter((g) => g.items.length);
  const flat = groups.flatMap((g) => g.items);

  return (
    <div ref={box} className="relative w-full max-w-lg">
      <LuSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, flat.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && flat[active]) {
            go(flat[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search orders, customers, SKUs, parcels, issues…"
        className="input h-10 rounded-full border-transparent bg-slate-100 pl-10 pr-9 hover:border-slate-200 focus:bg-white"
        aria-label="Global search"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 text-[10px] font-semibold text-ink-faint lg:block">
        /
      </kbd>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-pop">
          {!flat.length && <p className="px-3 py-4 text-center text-sm text-ink-muted">No matches for “{q}”</p>}
          {groups.map((g) => (
            <div key={g.type} className="py-1">
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{g.type}s</p>
              {g.items.map((r) => {
                const Icon = ICONS[r.type];
                const idx = flat.indexOf(r);
                return (
                  <Link
                    key={r.type + r.id}
                    href={r.link}
                    onClick={() => {
                      setOpen(false);
                      setQ("");
                    }}
                    onMouseEnter={() => setActive(idx)}
                    className={cx("flex items-center gap-3 rounded-lg px-2.5 py-2", idx === active ? "bg-brand-50" : "")}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                      <span className="block truncate text-xs text-ink-muted">{r.subtitle}</span>
                    </span>
                    <span className="chip bg-slate-50 text-ink-muted ring-slate-200">{r.type}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
