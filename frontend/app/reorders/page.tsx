"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  LuShoppingCart, LuPlus, LuCalendarClock, LuCircleCheck, LuInbox, LuWarehouse, LuTrash2, LuBan, LuCircleX, LuTriangleAlert,
  LuChevronDown, LuChevronUp, LuArrowRight, LuLock, LuPencil,
} from "react-icons/lu";
import { post } from "@/lib/api";
import { useApi, useNow, useQueryParams } from "@/lib/hooks";
import { useMeta, useRole, useToast } from "@/lib/context";
import { cx, dateInput, fmtWhen, plural } from "@/lib/format";
import type { InventoryRow, Reorder, ReorderList, ReorderSuggestion, ReorderSuggestions } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, ErrorState, PageSkeleton, Skeleton } from "@/components/EmptyState";
import { SearchInput, Tabs } from "@/components/FilterBar";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { QtyInput } from "@/components/QtyInput";

const STATUS_CLS: Record<Reorder["status"], string> = {
  ordered: "bg-slate-100 text-ink-soft ring-slate-200",
  partly_received: "bg-amber-50 text-amber-800 ring-amber-200",
  received: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  closed_short: "bg-orange-50 text-orange-800 ring-orange-200",
  cancelled: "bg-slate-100 text-ink-muted ring-slate-200",
};

type Pick = { qty: number; supplier: string };
type NewLine = { sku: string; qty: number };

export default function ReordersPage() {
  const [params, setParams, ready] = useQueryParams();
  const status = params.get("status") || "open";
  const focusId = params.get("id");
  const focusSku = params.get("sku");
  const [q, setQ] = useState("");
  useEffect(() => setQ(params.get("q") || ""), [params]);
  const { data: list, error, loading, reload } = useApi<ReorderList>(ready ? `/api/reorders?status=${focusId ? "all" : status}&q=${encodeURIComponent(q)}` : null, { poll: 45000 });
  const { data: sug, reload: reloadSug } = useApi<ReorderSuggestions>("/api/reorders/suggestions", { poll: 45000 });
  const { data: suppliers } = useApi<string[]>("/api/reorders/suppliers");
  const { isOffice } = useRole();
  const toast = useToast();
  const now = useNow();
  const { meta } = useMeta();
  const leadDays = meta?.thresholds?.reorder_lead_days ?? 2;

  const [picked, setPicked] = useState<Record<string, Pick>>({});
  const [orderDate, setOrderDate] = useState("");
  const [orderWh, setOrderWh] = useState<"MAIN" | "SEC">("MAIN");
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [newOpen, setNewOpen] = useState<NewLine[] | null>(null);
  const [dateEdit, setDateEdit] = useState<{ r: Reorder; value: string } | null>(null);
  const [ending, setEnding] = useState<{ r: Reorder; kind: "cancel" | "close"; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!orderDate) setOrderDate(dateInput(now, leadDays));
  }, [leadDays]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !focusSku || !sug) return;
    const s = sug.items.find((i) => i.sku === focusSku);
    if (s) {
      setPicked((p) => ({ ...p, [s.sku]: p[s.sku] || { qty: s.suggested_qty, supplier: s.supplier } }));
      setTimeout(() => document.getElementById(`sug-${s.sku}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    }
  }, [ready, focusSku, !!sug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || !focusId || !list) return;
    const t = setTimeout(() => document.getElementById(`ro-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => clearTimeout(t);
  }, [ready, focusId, !!list]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<any>, ok: string | ((r: any) => string), after?: () => void) {
    setBusy(true);
    try {
      const r = await fn();
      toast(typeof ok === "function" ? ok(r) : ok);
      after?.();
      reload();
      reloadSug();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const pickedItems = Object.entries(picked).filter(([, p]) => p.qty > 0);
  const bySupplier = useMemo(() => {
    const m: Record<string, { sku: string; qty: number }[]> = {};
    pickedItems.forEach(([sku, p]) => (m[p.supplier || "—"] ||= []).push({ sku, qty: p.qty }));
    return m;
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = list?.counts;
  const officeTitle = isOffice ? "" : "Office team only";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reorders"
        subtitle="Buy more stock from suppliers. Every reorder becomes an expected delivery on the Receiving page, and what arrives is recorded back here."
        actions={
          <>
            <Link href="/guide#reorders" className="btn btn-secondary">
              How this works
            </Link>
            <button className="btn btn-primary" disabled={!isOffice} title={officeTitle} onClick={() => setNewOpen([{ sku: focusSku || "", qty: 0 }])}>
              <LuPlus className="h-4 w-4" /> New reorder
            </button>
          </>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Need reordering", value: sug?.count, hint: sug?.critical ? `${sug.critical} urgent` : "SKUs below reorder point", tone: sug?.critical ? "text-red-600" : "text-ink", href: "#needs" },
          { label: "Open reorders", value: counts?.open, hint: "Ordered or partly received", tone: "text-ink", onClick: () => setParams({ status: null, id: null }) },
          { label: "Late deliveries", value: counts?.overdue, hint: "Past the expected date", tone: counts?.overdue ? "text-red-600" : "text-ink", onClick: () => setParams({ status: "overdue", id: null }) },
          { label: "Units on the way", value: counts?.units_due, hint: "Not counted yet", tone: "text-ink" },
          { label: "Waiting for put-away", value: counts?.to_put_away, hint: "Arrived, not on a shelf", tone: counts?.to_put_away ? "text-amber-700" : "text-ink", href: "/receiving?tab=putaway" },
        ].map((k) => {
          const body = (
            <>
              <p className="text-xs text-ink-muted">{k.label}</p>
              <p className={cx("text-2xl font-semibold tabular-nums", k.tone)}>{k.value ?? "–"}</p>
              <p className="text-[11px] text-ink-faint">{k.hint}</p>
            </>
          );
          return k.href ? (
            <Link key={k.label} href={k.href} className="card card-pad block hover:border-brand-300">
              {body}
            </Link>
          ) : k.onClick ? (
            <button key={k.label} onClick={k.onClick} className="card card-pad text-left hover:border-brand-300">
              {body}
            </button>
          ) : (
            <div key={k.label} className="card card-pad">
              {body}
            </div>
          );
        })}
      </div>

      {/* Needs reordering */}
      <section id="needs" className={cx("card scroll-mt-24 overflow-hidden", sug?.critical ? "border-red-200" : sug?.count ? "border-amber-200" : "")}>
        <div className="flex flex-col gap-2 border-b border-line bg-amber-50/40 px-5 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <LuShoppingCart className="h-4 w-4 text-amber-700" /> Needs reordering
            </h2>
            <p className="text-xs text-ink-muted">
              Total stock (Main + Secondary + waiting for put-away + already on order) is below the reorder point — half the Main bin plus what waiting orders need. A transfer
              can’t fix these. Suggested quantities refill the Main bin, rounded up to packs of {sug?.rule.round_to ?? 5}.
            </p>
          </div>
          {sug && sug.items.length > 0 && (
            <div className="flex shrink-0 gap-2">
              <button className="btn btn-secondary py-1.5 text-xs" disabled={!isOffice} onClick={() => setPicked(Object.fromEntries(sug.items.map((i) => [i.sku, { qty: i.suggested_qty, supplier: i.supplier }])))}>
                Tick all
              </button>
              {pickedItems.length > 0 && (
                <button className="btn btn-ghost py-1.5 text-xs" onClick={() => setPicked({})}>
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
        {!sug ? (
          <div className="p-4">
            <Skeleton className="h-24" />
          </div>
        ) : sug.items.length === 0 ? (
          <EmptyState compact tone="good" icon={LuCircleCheck} title="Nothing needs reordering" hint="Every SKU has enough stock across both warehouses and what’s on order." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {sug.items.map((s) => (
                <SuggestionRow
                  key={s.sku}
                  s={s}
                  pick={picked[s.sku]}
                  focused={focusSku === s.sku}
                  isOffice={isOffice}
                  suppliers={suppliers || []}
                  onToggle={(on) =>
                    setPicked((p) => {
                      const { [s.sku]: _, ...rest } = p;
                      return on ? { ...rest, [s.sku]: { qty: s.suggested_qty, supplier: s.supplier } } : rest;
                    })
                  }
                  onChange={(pk) => setPicked((p) => ({ ...p, [s.sku]: pk }))}
                />
              ))}
            </ul>
            <div className="flex flex-col gap-3 border-t border-line bg-slate-50/70 px-5 py-3 lg:flex-row lg:items-center">
              <p className="flex-1 text-sm text-ink-soft">
                {pickedItems.length ? (
                  <>
                    <b>{plural(pickedItems.length, "SKU")}</b> · <b>{pickedItems.reduce((a, [, p]) => a + p.qty, 0)} units</b> → {plural(Object.keys(bySupplier).length, "reorder")} (one per supplier)
                  </>
                ) : (
                  "Tick the SKUs you want to order."
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Tabs value={orderWh} onChange={(v) => setOrderWh(v as "MAIN" | "SEC")} tabs={[{ value: "MAIN", label: "To Main" }, { value: "SEC", label: "To Secondary" }]} />
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  Expected
                  <input type="date" className="input h-9 w-auto" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                </label>
                <button className="btn btn-primary" disabled={!isOffice || !pickedItems.length || busy} title={officeTitle} onClick={() => setBulkConfirm(true)}>
                  <LuShoppingCart className="h-4 w-4" /> Order {pickedItems.length || ""} selected
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Reorders list */}
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <Tabs
            value={focusId ? "all" : status}
            onChange={(v) => setParams({ status: v === "open" ? null : v, id: null })}
            tabs={[
              { value: "open", label: "Open", count: counts?.open },
              { value: "overdue", label: "Late", count: counts?.overdue },
              { value: "done", label: "Finished", count: counts?.done },
              { value: "all", label: "All" },
            ]}
          />
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setParams({ q: v, id: null });
            }}
            placeholder="Search reorder, supplier or SKU"
            className="w-full lg:ml-auto lg:w-72"
          />
        </div>
        {loading ? (
          <PageSkeleton />
        ) : error && !list ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : !list?.items.length ? (
          <EmptyState
            icon={status === "overdue" ? LuCircleCheck : LuShoppingCart}
            tone={status === "overdue" ? "good" : "neutral"}
            title={q ? "No reorders match" : status === "overdue" ? "No late deliveries" : status === "open" ? "No open reorders" : "No reorders yet"}
            hint={status === "open" && !q ? "Order from “Needs reordering” above, or press New reorder." : undefined}
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {list.items.map((r) => (
              <ReorderCard
                key={r.id}
                r={r}
                now={now}
                focused={focusId === r.id}
                isOffice={isOffice}
                onDate={() => setDateEdit({ r, value: dateInput(r.next_due_at || r.expected_at) })}
                onCancel={() => setEnding({ r, kind: "cancel", reason: "" })}
                onClose={() => setEnding({ r, kind: "close", reason: "" })}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={bulkConfirm}
        title={`Place ${plural(Object.keys(bySupplier).length, "reorder")}?`}
        message={
          <>
            <p>
              Delivering to <b>{orderWh === "MAIN" ? "Main Warehouse" : "Secondary Warehouse"}</b>, expected <b>{orderDate || "in " + leadDays + " days"}</b>. Each reorder
              appears on the Receiving page to be counted when it arrives.
            </p>
            <div className="mt-2 max-h-56 space-y-2 overflow-auto">
              {Object.entries(bySupplier).map(([sup, lines]) => (
                <div key={sup} className="rounded-lg bg-slate-50 p-2 text-xs">
                  <p className="font-semibold text-ink">{sup}</p>
                  {lines.map((l) => (
                    <p key={l.sku}>
                      <span className="mono">{l.sku}</span> × {l.qty}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </>
        }
        confirmLabel="Place reorders"
        busy={busy}
        onCancel={() => setBulkConfirm(false)}
        onConfirm={() =>
          run(
            () =>
              post("/api/reorders/bulk", {
                items: pickedItems.map(([sku, p]) => ({ sku, qty: p.qty, supplier: p.supplier })),
                warehouse_id: orderWh,
                expected_at: orderDate || null,
              }),
            (r) => `${r.created.map((c: any) => c.id).join(", ")} placed — they’re waiting on the Receiving page`,
            () => {
              setBulkConfirm(false);
              setPicked({});
            },
          )
        }
      />

      <NewReorderModal
        lines={newOpen}
        onClose={() => setNewOpen(null)}
        suppliers={suppliers || []}
        suggestions={sug?.items || []}
        defaultDate={dateInput(now, leadDays)}
        busy={busy}
        onSave={(body) =>
          run(() => post<Reorder>("/api/reorders", body), (r) => `${r.id} placed with ${r.supplier} — ${r.totals.ordered} units expected ${fmtWhen(r.expected_at, now)}`, () => setNewOpen(null))
        }
      />

      <Modal
        open={!!dateEdit}
        onClose={() => setDateEdit(null)}
        title={`New expected date · ${dateEdit?.r.id ?? ""}`}
        subtitle={dateEdit?.r.supplier}
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDateEdit(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !dateEdit?.value}
              onClick={() => dateEdit && run(() => post(`/api/reorders/${dateEdit.r.id}/expected`, { expected_at: dateEdit.value }), `${dateEdit.r.id}: expected date changed`, () => setDateEdit(null))}
            >
              Save date
            </button>
          </>
        }
      >
        {dateEdit && (
          <>
            <label className="label" htmlFor="ro-date">
              When will the supplier deliver?
            </label>
            <input id="ro-date" type="date" className="input" value={dateEdit.value} onChange={(e) => setDateEdit({ ...dateEdit, value: e.target.value })} />
            <p className="mt-1 text-xs text-ink-muted">Moves every delivery of this reorder that hasn’t arrived yet.</p>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!ending}
        tone="danger"
        title={ending?.kind === "cancel" ? `Cancel ${ending?.r.id}?` : `Close ${ending?.r.id} — rest not coming?`}
        message={
          ending?.kind === "cancel"
            ? "Nothing has arrived yet. The expected delivery is removed from the Receiving page."
            : `${ending?.r.totals.still_due ?? 0} units still due will be recorded as not coming. What already arrived stays in stock.`
        }
        confirmLabel={ending?.kind === "cancel" ? "Cancel reorder" : "Close reorder"}
        busy={busy}
        onCancel={() => setEnding(null)}
        onConfirm={() =>
          ending &&
          (ending.reason.trim()
            ? run(() => post(`/api/reorders/${ending.r.id}/${ending.kind}`, { reason: ending.reason }), ending.kind === "cancel" ? `${ending.r.id} cancelled` : `${ending.r.id} closed`, () => setEnding(null))
            : toast("Give a reason first", "error"))
        }
      >
        {ending && (
          <div className="mt-3">
            <label className="label" htmlFor="end-reason">
              Reason (required)
            </label>
            <input
              id="end-reason"
              className="input"
              placeholder={ending.kind === "cancel" ? "e.g. Ordered by mistake" : "e.g. Supplier discontinued the colour"}
              value={ending.reason}
              onChange={(e) => setEnding({ ...ending, reason: e.target.value })}
            />
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}


function SuggestionRow({
  s, pick, focused, isOffice, suppliers, onToggle, onChange,
}: {
  s: ReorderSuggestion;
  pick?: Pick;
  focused: boolean;
  isOffice: boolean;
  suppliers: string[];
  onToggle: (on: boolean) => void;
  onChange: (p: Pick) => void;
}) {
  const on = !!pick;
  const parts: [string, number][] = [
    ["Main", s.main_available],
    ["Secondary", s.secondary_available],
    ["put-away", s.awaiting_putaway],
    ["on order", s.on_order],
  ];
  return (
    <li id={`sug-${s.sku}`} className={cx("flex scroll-mt-24 flex-col gap-3 px-5 py-3.5 lg:flex-row lg:items-center", on && "bg-brand-50/40", focused && "flash")}>
      <label className="flex min-w-0 flex-1 cursor-pointer gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={on} disabled={!isOffice} onChange={(e) => onToggle(e.target.checked)} aria-label={`Order ${s.sku}`} />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            <span className="mono">{s.sku}</span>
            <span className="font-normal text-ink-muted">
              {s.name} · {s.variant}
            </span>
            {s.level === "critical" ? (
              <span className="chip bg-red-50 text-red-700 ring-red-200">
                {s.waiting_orders ? (
                  <>
                    <LuLock className="h-3 w-3" /> {plural(s.waiting_orders, "order")} waiting
                  </>
                ) : (
                  "Out of stock"
                )}
              </span>
            ) : (
              <span className="chip bg-amber-50 text-amber-800 ring-amber-200">Low</span>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            {parts.map(([k, v]) => (
              <span key={k} className={cx("rounded bg-slate-100 px-1.5 py-0.5 tabular-nums", v > 0 && "text-ink-soft")}>
                {k} <b>{v}</b>
              </span>
            ))}
            <LuArrowRight className="h-3 w-3" />
            <span>
              total <b className={s.level === "critical" ? "text-red-600" : "text-amber-700"}>{s.position}</b> vs reorder point <b>{s.reorder_point}</b>
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-ink-faint">{s.why}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2 pl-7 lg:pl-0">
        <div>
          <p className="text-[11px] font-semibold text-ink-muted">Quantity</p>
          <QtyInput size="sm" value={pick?.qty ?? s.suggested_qty} onChange={(v) => onChange({ qty: v, supplier: pick?.supplier ?? s.supplier })} label={`quantity ${s.sku}`} />
        </div>
        <div className="w-52">
          <p className="text-[11px] font-semibold text-ink-muted">Supplier</p>
          <input
            className="input h-9"
            list="ro-suppliers"
            value={pick?.supplier ?? s.supplier}
            disabled={!isOffice}
            onChange={(e) => onChange({ qty: pick?.qty ?? s.suggested_qty, supplier: e.target.value })}
            aria-label={`supplier ${s.sku}`}
          />
          <datalist id="ro-suppliers">{suppliers.map((x) => <option key={x} value={x} />)}</datalist>
        </div>
      </div>
    </li>
  );
}


function ProgressBar({ r }: { r: Reorder }) {
  const t = r.totals;
  const total = Math.max(t.ordered, t.arrived_ok + t.damaged + t.not_coming + t.still_due, 1);
  const seg = [
    { v: t.arrived_ok, cls: "bg-emerald-500", label: "arrived OK" },
    { v: t.damaged, cls: "bg-red-500", label: "damaged" },
    { v: t.not_coming, cls: "bg-slate-400", label: "not coming" },
    { v: t.still_due, cls: "bg-sky-200", label: "still due" },
  ];
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" title={seg.map((s) => `${s.v} ${s.label}`).join(" · ")}>
        {seg.map((s) => s.v > 0 && <div key={s.label} className={s.cls} style={{ width: `${(s.v / total) * 100}%` }} />)}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ink-muted">
        {seg.map(
          (s) =>
            s.v > 0 && (
              <span key={s.label} className="inline-flex items-center gap-1">
                <span className={cx("h-2 w-2 rounded-full", s.cls)} /> {s.v} {s.label}
              </span>
            ),
        )}
        {t.put_away > 0 && <span>· {t.put_away} on shelves</span>}
      </p>
    </div>
  );
}

function ReorderCard({ r, now, focused, isOffice, onDate, onCancel, onClose }: { r: Reorder; now: Date; focused: boolean; isOffice: boolean; onDate: () => void; onCancel: () => void; onClose: () => void }) {
  const isOpen = r.status === "ordered" || r.status === "partly_received";
  const [expanded, setExpanded] = useState(isOpen || focused);
  useEffect(() => {
    if (focused) setExpanded(true);
  }, [focused]);
  const due = r.deliveries.find((d) => d.status === "expected");
  const toShelve = r.deliveries.find((d) => d.status === "received");
  return (
    <li id={`ro-${r.id}`} className={cx("scroll-mt-24", focused && "flash bg-brand-50/30")}>
      <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
            <span className="mono">{r.id}</span> · <span className="truncate">{r.supplier}</span>
            <span className={cx("chip", STATUS_CLS[r.status])}>{r.status_label}</span>
            {r.overdue && (
              <span className="chip bg-red-50 text-red-700 ring-red-200">
                <LuCalendarClock className="h-3 w-3" /> Late
              </span>
            )}
          </p>
          <p className="text-xs text-ink-muted">
            {plural(r.lines.length, "SKU")} · {r.totals.ordered} units → {r.warehouse_label} · ordered {fmtWhen(r.created_at, now)} by {r.created_by}
            {isOpen ? (
              <>
                {" "}
                · <span className={cx(r.overdue && "font-semibold text-red-600")}>expected {fmtWhen(r.next_due_at || r.expected_at, now)}</span>
              </>
            ) : r.closed_at ? (
              <> · finished {fmtWhen(r.closed_at, now)}</>
            ) : null}
          </p>
          <div className="max-w-xl">
            <ProgressBar r={r} />
          </div>
          {(r.note || r.close_reason) && (
            <p className="text-xs text-ink-soft">
              {r.note && <>Note: {r.note}</>}
              {r.close_reason && (
                <>
                  {r.note && " · "}
                  {r.status === "cancelled" ? "Cancelled" : "Closed"} by {r.closed_by}: {r.close_reason}
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {due && (
            <Link href={`/receiving?delivery=${due.id}`} className="btn btn-primary">
              <LuInbox className="h-4 w-4" /> Count arrival ({due.id})
            </Link>
          )}
          {toShelve && (
            <Link href={`/receiving?delivery=${toShelve.id}`} className="btn btn-secondary">
              <LuWarehouse className="h-4 w-4" /> Put away {r.totals.awaiting_putaway}
            </Link>
          )}
          {r.can_edit_date && (
            <button className="btn btn-secondary" disabled={!isOffice} title={isOffice ? "" : "Office team only"} onClick={onDate}>
              <LuPencil className="h-4 w-4" /> Change date
            </button>
          )}
          {r.can_cancel && (
            <button className="btn btn-ghost text-red-700" disabled={!isOffice} title={isOffice ? "" : "Office team only"} onClick={onCancel}>
              <LuBan className="h-4 w-4" /> Cancel
            </button>
          )}
          {r.can_close && (
            <button className="btn btn-ghost text-red-700" disabled={!isOffice} title={isOffice ? "Part arrived, the rest will never come" : "Office team only"} onClick={onClose}>
              <LuCircleX className="h-4 w-4" /> Close — rest not coming
            </button>
          )}
          <button className="btn btn-ghost px-2" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Hide lines" : "Show lines"}>
            {expanded ? <LuChevronUp className="h-4 w-4" /> : <LuChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-line bg-slate-50/40">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  <th className="px-5 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Arrived OK</th>
                  <th className="px-3 py-2 text-right">Damaged</th>
                  <th className="px-3 py-2 text-right">Not coming</th>
                  <th className="px-3 py-2 text-right">Still due</th>
                  <th className="px-3 py-2 text-right">On shelf</th>
                  <th className="px-5 py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-2">
                      <Link href={`/inventory?mode=list&sku=${l.sku}`} className="mono text-xs font-semibold text-ink hover:underline">
                        {l.sku}
                      </Link>
                      <p className="text-xs text-ink-muted">
                        {l.name} · {l.variant}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.ordered}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">{l.arrived_ok || "—"}</td>
                    <td className={cx("px-3 py-2 text-right tabular-nums", l.damaged ? "font-semibold text-red-600" : "text-ink-faint")}>{l.damaged || "—"}</td>
                    <td className={cx("px-3 py-2 text-right tabular-nums", l.not_coming ? "font-semibold text-ink-soft" : "text-ink-faint")}>{l.not_coming || "—"}</td>
                    <td className={cx("px-3 py-2 text-right tabular-nums", l.still_due ? "font-semibold text-sky-800" : "text-ink-faint")}>{l.still_due || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {l.put_away || "—"}
                      {l.awaiting_putaway > 0 && <span className="block text-[11px] text-amber-700">+{l.awaiting_putaway} to put away</span>}
                    </td>
                    <td className="px-5 py-2">
                      {r.status === "cancelled" ? (
                        <span className="chip bg-slate-100 text-ink-muted ring-slate-200">Cancelled</span>
                      ) : l.outcome === "due" ? (
                        <span className="chip bg-sky-50 text-sky-800 ring-sky-200">Waiting</span>
                      ) : l.outcome === "complete" ? (
                        <span className="chip bg-emerald-50 text-emerald-700 ring-emerald-200">
                          <LuCircleCheck className="h-3 w-3" /> Complete
                        </span>
                      ) : (
                        <span className="chip bg-orange-50 text-orange-800 ring-orange-200">
                          <LuTriangleAlert className="h-3 w-3" /> Short
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5 text-xs text-ink-muted">
            <span className="font-semibold text-ink-soft">Deliveries:</span>
            {r.deliveries.map((d) => (
              <Link
                key={d.id}
                href={`/receiving?delivery=${d.id}`}
                className={cx(
                  "chip hover:underline",
                  d.status === "expected"
                    ? d.overdue
                      ? "bg-red-50 text-red-700 ring-red-200"
                      : "bg-sky-50 text-sky-800 ring-sky-200"
                    : d.status === "received"
                      ? "bg-amber-50 text-amber-800 ring-amber-200"
                      : d.status === "cancelled"
                        ? "bg-slate-100 text-ink-muted ring-slate-200"
                        : "bg-emerald-50 text-emerald-700 ring-emerald-200",
                )}
              >
                <span className="mono">{d.id}</span>
                {d.source === "backorder" && " · rest"} ·{" "}
                {d.status === "expected"
                  ? `due ${fmtWhen(d.expected_at, now)}`
                  : d.status === "received"
                    ? "counted, to put away"
                    : d.status === "cancelled"
                      ? "cancelled"
                      : "on shelves"}
              </Link>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}


function NewReorderModal({
  lines, onClose, suppliers, suggestions, defaultDate, busy, onSave,
}: {
  lines: NewLine[] | null;
  onClose: () => void;
  suppliers: string[];
  suggestions: ReorderSuggestion[];
  defaultDate: string;
  busy: boolean;
  onSave: (body: any) => void;
}) {
  const open = !!lines;
  const { data: products } = useApi<InventoryRow[]>(open ? "/api/inventory?sort=sku" : null);
  const [rows, setRows] = useState<NewLine[]>([]);
  const [supplier, setSupplier] = useState("");
  const [wh, setWh] = useState<"MAIN" | "SEC">("MAIN");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const bySku = useMemo(() => Object.fromEntries((products || []).map((p) => [p.sku, p])), [products]);
  const sugBySku = useMemo(() => Object.fromEntries(suggestions.map((s) => [s.sku, s])), [suggestions]);

  useEffect(() => {
    if (!lines) return;
    const first = lines.map((l) => ({ sku: l.sku, qty: l.qty || sugBySku[l.sku]?.suggested_qty || 0 }));
    setRows(first.length ? first : [{ sku: "", qty: 0 }]);
    setSupplier(sugBySku[lines[0]?.sku]?.supplier || "");
    setWh("MAIN");
    setDate(defaultDate);
    setNote("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const unknown = rows.filter((r) => r.sku.trim() && !bySku[r.sku.trim().toUpperCase()]);
  const good = rows.filter((r) => bySku[r.sku.trim().toUpperCase()] && r.qty > 0);
  const total = good.reduce((a, r) => a + r.qty, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New reorder"
      subtitle="Order stock from one supplier. It shows up on the Receiving page as an expected delivery."
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !supplier.trim() || !good.length || unknown.length > 0}
            onClick={() => onSave({ supplier, warehouse_id: wh, expected_at: date || null, note, lines: good.map((r) => ({ sku: r.sku.trim().toUpperCase(), qty: r.qty })) })}
          >
            <LuShoppingCart className="h-4 w-4" /> Place reorder{total ? ` · ${total} units` : ""}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nr-sup">
              Supplier
            </label>
            <input id="nr-sup" className="input" list="nr-suppliers" placeholder="Choose or type a supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            <datalist id="nr-suppliers">{suppliers.map((x) => <option key={x} value={x} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="nr-date">
              Expected delivery
            </label>
            <input id="nr-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <p className="label">Deliver to</p>
          <Tabs value={wh} onChange={(v) => setWh(v as "MAIN" | "SEC")} tabs={[{ value: "MAIN", label: "Main Warehouse (sellable sooner)" }, { value: "SEC", label: "Secondary (overflow)" }]} />
        </div>
        <div className="space-y-2">
          <p className="label">Items</p>
          <datalist id="nr-skus">
            {(products || []).map((p) => (
              <option key={p.sku} value={p.sku}>
                {p.name} · {p.variant}
              </option>
            ))}
          </datalist>
          {rows.map((r, i) => {
            const p = bySku[r.sku.trim().toUpperCase()];
            const s = p ? sugBySku[p.sku] : undefined;
            const set = (patch: Partial<NewLine>) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <input
                    className="input mono min-w-[180px] flex-1 uppercase"
                    list="nr-skus"
                    placeholder="SKU"
                    value={r.sku}
                    onChange={(e) => {
                      const sku = e.target.value.toUpperCase();
                      const sg = sugBySku[sku];
                      set({ sku, qty: r.qty || sg?.suggested_qty || 0 });
                      if (sg && !supplier) setSupplier(sg.supplier);
                    }}
                    aria-label="SKU"
                  />
                  <div>
                    <p className="text-[11px] font-semibold text-ink-muted">Quantity</p>
                    <QtyInput size="sm" value={r.qty} onChange={(v) => set({ qty: v })} label="quantity" />
                  </div>
                  <button className="btn btn-ghost h-9 px-2" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove line">
                    <LuTrash2 className="h-4 w-4" />
                  </button>
                </div>
                {p && (
                  <p className="mt-1.5 text-xs text-ink-muted">
                    {p.name} · {p.variant} · Main {p.main.available} available (bin holds {p.main.capacity}) · Secondary {p.secondary.available}
                    {p.on_order > 0 && <b className="text-sky-800"> · {p.on_order} already on order</b>}
                    {s && (
                      <>
                        {" "}
                        ·{" "}
                        <button className="link" onClick={() => set({ qty: s.suggested_qty })}>
                          suggested {s.suggested_qty}
                        </button>
                      </>
                    )}
                  </p>
                )}
                {r.sku.trim() && !p && <p className="mt-1.5 text-xs font-semibold text-red-600">Unknown SKU.</p>}
              </div>
            );
          })}
          <button className="btn btn-secondary" onClick={() => setRows((rs) => [...rs, { sku: "", qty: 0 }])}>
            <LuPlus className="h-4 w-4" /> Add SKU
          </button>
        </div>
        <div>
          <label className="label" htmlFor="nr-note">
            Note (optional)
          </label>
          <input id="nr-note" className="input" placeholder="e.g. Supplier quote #4471, pay on delivery" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
