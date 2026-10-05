"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  LuTruck, LuMapPin, LuTriangleAlert, LuCircleCheck, LuSquareCheck, LuSquare, LuHandshake, LuFlag, LuBot, LuHand, LuTimer,
  LuDoorOpen, LuChevronDown, LuChevronUp, LuSend, LuLayoutGrid, LuSettings2,
} from "react-icons/lu";
import { api, post } from "@/lib/api";
import { useApi, useNow, useQueryParams } from "@/lib/hooks";
import { useRole, useToast } from "@/lib/context";
import { ago, cx, fmtDuration, fmtWhen, plural } from "@/lib/format";
import type { DispatchPkg, HandoverBoard, HandoverGroup, HandoverMode, Manifest } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { DispatchFlow } from "@/components/DispatchFlow";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/EmptyState";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { ManifestModal } from "@/components/ManifestModal";
import { PriorityBadge } from "@/components/StatusBadge";

const MODES: Record<HandoverMode, { label: string; short: string; icon: React.ComponentType<{ className?: string }>; chip: string; how: string }> = {
  manual: {
    label: "Manual",
    short: "Manual",
    icon: LuHand,
    chip: "bg-slate-100 text-ink-soft ring-slate-200",
    how: "When the courier arrives, press “Courier arrived”, tick the parcels they take (all ready ones are ticked for you) and confirm.",
  },
  on_arrival: {
    label: "Automatic when the courier arrives",
    short: "Auto · on arrival",
    icon: LuBot,
    chip: "bg-violet-50 text-violet-800 ring-violet-200",
    how: "Press “Courier arrived” (or the gate records it) and every ready parcel is handed over at once. Blocked parcels stay behind.",
  },
  scheduled: {
    label: "Automatic at pickup time",
    short: "Auto · pickup time",
    icon: LuTimer,
    chip: "bg-sky-50 text-sky-800 ring-sky-200",
    how: "The courier comes on schedule: at each pickup time the system hands over every parcel that was ready. Came early? Press “Courier arrived”.",
  },
};

export default function HandoverPage() {
  const { data, error, loading, reload } = useApi<HandoverBoard>("/api/handover", { poll: 20000 });
  const [params] = useQueryParams();
  const now = useNow(15000);
  const toast = useToast();
  const { isOffice } = useRole();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [checklist, setChecklist] = useState<{ g: HandoverGroup; ticked: Record<string, boolean> } | null>(null);
  const [autoConfirm, setAutoConfirm] = useState<HandoverGroup | null>(null);
  const [handSelected, setHandSelected] = useState<HandoverGroup | null>(null);
  const [modeFor, setModeFor] = useState<{ g: HandoverGroup; mode: HandoverMode } | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [busy, setBusy] = useState(false);
  const focusCourier = params.get("courier") || "";
  const highlight = params.get("package") || "";

  useEffect(() => {
    if (!data) return;
    const id = highlight ? `pkg-${highlight}` : focusCourier ? `courier-${focusCourier}` : "";
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: highlight ? "center" : "start", behavior: "smooth" }), 200);
  }, [!!data, focusCourier, highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <PageSkeleton />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  function done(r: { manifest: Manifest | null; handed_over: string[]; not_ready?: { id: string }[] }, courier: string) {
    const left = r.not_ready?.length || 0;
    toast(
      r.handed_over.length
        ? `${plural(r.handed_over.length, "parcel")} handed to ${courier} — shipped${left ? ` · ${left} stayed behind` : ""}`
        : `${courier} arrival recorded — nothing was ready to go`,
    );
    setSelected({});
    if (r.manifest) setManifest(r.manifest);
    reload();
  }

  async function arrive(g: HandoverGroup, ids?: string[]) {
    setBusy(true);
    try {
      const r = await post<any>(`/api/couriers/${g.courier.id}/arrived`, ids ? { package_ids: ids } : {});
      done(r, g.courier.name);
      setChecklist(null);
      setAutoConfirm(null);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handOverSelected(g: HandoverGroup) {
    const ids = g.ready.filter((p) => selected[p.id]).map((p) => p.id);
    setBusy(true);
    try {
      const r = await post<any>("/api/handover", { courier_id: g.courier.id, package_ids: ids });
      done(r, g.courier.name);
      setHandSelected(null);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveMode() {
    if (!modeFor) return;
    setBusy(true);
    try {
      await post(`/api/couriers/${modeFor.g.courier.id}/handover-mode`, { mode: modeFor.mode });
      toast(`${modeFor.g.courier.name}: ${MODES[modeFor.mode].label}`);
      setModeFor(null);
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function courierArrived(g: HandoverGroup) {
    if (g.mode === "manual") setChecklist({ g, ticked: Object.fromEntries(g.ready.map((p) => [p.id, true])) });
    else setAutoConfirm(g);
  }

  const withWork = data.couriers.filter((g) => g.ready.length || g.not_ready.length || g.on_site);
  const idle = data.couriers.filter((g) => !(g.ready.length || g.not_ready.length || g.on_site));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ready to hand over"
        subtitle="Staged parcels waiting for their courier. When the courier arrives, hand them over — by hand or automatically — and each order becomes Shipped."
        actions={
          <>
            <Link href="/guide#handover" className="btn btn-secondary">
              How this works
            </Link>
            <Link href="/shipped" className="btn btn-secondary">
              <LuSend className="h-4 w-4" /> Shipped
            </Link>
          </>
        }
      />
      <DispatchFlow current="handover" />

      <div className="grid gap-3 md:grid-cols-3">
        {(Object.keys(MODES) as HandoverMode[]).map((m) => {
          const M = MODES[m];
          const who = data.couriers.filter((g) => g.mode === m).map((g) => g.courier.name);
          return (
            <div key={m} className="card flex gap-3 p-3.5">
              <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", M.chip)}>
                <M.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{M.label}</p>
                <p className="text-xs text-ink-muted">{M.how}</p>
                <p className="mt-1 text-[11px] font-semibold text-ink-soft">{who.length ? who.join(", ") : "No courier uses this"}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { k: "Ready to leave", v: data.counts.ready, hint: "Staged, nothing blocking", tone: "text-emerald-700" },
          { k: "Can’t leave yet", v: data.counts.not_ready, hint: "Not staged, on hold or blocked", tone: data.counts.not_ready ? "text-amber-700" : "text-ink" },
          { k: "Couriers here now", v: data.counts.on_site, hint: `Arrived in the last ${data.on_site_minutes} min`, tone: data.counts.on_site ? "text-brand-700" : "text-ink" },
        ].map((x) => (
          <div key={x.k} className="card card-pad">
            <p className="text-xs text-ink-muted">{x.k}</p>
            <p className={cx("text-2xl font-semibold tabular-nums", x.tone)}>{x.v}</p>
            <p className="text-[11px] text-ink-faint">{x.hint}</p>
          </div>
        ))}
      </div>

      {data.pull_from_staging.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="flex items-center gap-2 font-semibold text-red-800">
            <LuTriangleAlert className="h-4 w-4" /> Do not hand these to any courier — the orders were cancelled
          </p>
          <p className="mt-1">
            {data.pull_from_staging.map((p) => `${p.package_id} (${p.staging_location})`).join(", ")} ·{" "}
            <Link className="underline" href="/staging">
              pull them from staging
            </Link>
          </p>
        </div>
      )}

      {withWork.length === 0 && (
        <div className="card">
          <EmptyState tone="good" icon={LuCircleCheck} title="Nothing waiting for a courier" hint="Staged parcels appear here, grouped by courier. Stage packed parcels on the Staging page." action={<Link href="/staging" className="btn btn-secondary">Open Staging</Link>} />
        </div>
      )}

      {withWork.map((g) => (
        <CourierCard
          key={g.courier.id}
          g={g}
          now={now}
          focused={focusCourier === g.courier.id}
          highlight={highlight}
          selected={selected}
          setSelected={setSelected}
          isOffice={isOffice}
          busy={busy}
          onArrived={() => courierArrived(g)}
          onHandSelected={() => setHandSelected(g)}
          onMode={(mode) => setModeFor({ g, mode })}
          onManifest={async (id) => setManifest(await api<Manifest>(`/api/manifests/${id}`))}
        />
      ))}

      {idle.length > 0 && (
        <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-sm text-ink-muted">
          <span className="font-semibold text-ink-soft">No parcels waiting:</span>
          {idle.map((g) => (
            <span key={g.courier.id} id={`courier-${g.courier.id}`} className="inline-flex items-center gap-1.5">
              <LuTruck className="h-4 w-4" /> {g.courier.name} · next pickup {fmtWhen(g.next_pickup, now)} ·{" "}
              <span className={cx("chip", MODES[g.mode].chip)}>{MODES[g.mode].short}</span>
            </span>
          ))}
        </div>
      )}

      {/* manual checklist */}
      <Modal
        open={!!checklist}
        onClose={() => setChecklist(null)}
        title={`${checklist?.g.courier.name} courier is here`}
        subtitle="Collect the ticked parcels in this order, check each one goes on the van, then confirm."
        size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setChecklist(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !checklist}
              onClick={() => checklist && arrive(checklist.g, Object.keys(checklist.ticked).filter((k) => checklist.ticked[k]))}
            >
              <LuHandshake className="h-4 w-4" />{" "}
              {checklist && Object.values(checklist.ticked).some(Boolean) ? `Hand over ${Object.values(checklist.ticked).filter(Boolean).length}` : "Record arrival only"}
            </button>
          </>
        }
      >
        {checklist && (
          <div className="space-y-3">
            {checklist.g.ready.length === 0 && <p className="text-sm text-ink-muted">No parcel is ready for {checklist.g.courier.name}. You can still record that the courier came.</p>}
            {groupByLocation(checklist.g.ready).map(([loc, ps]) => (
              <div key={loc}>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  <LuMapPin className="h-3.5 w-3.5" /> {loc} · {ps.length}
                </p>
                <ul className="divide-y divide-line rounded-xl border border-slate-200">
                  {ps.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={!!checklist.ticked[p.id]}
                          onChange={(e) => setChecklist({ ...checklist, ticked: { ...checklist.ticked, [p.id]: e.target.checked } })}
                        />
                        <span className="mono font-semibold text-ink">{p.id}</span>
                        <span className="mono text-xs text-ink-muted">{p.order_id}</span>
                        {p.priority && <PriorityBadge priority />}
                        <span className="ml-auto text-xs text-ink-muted">{p.package_type}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {checklist.g.not_ready.length > 0 && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                {plural(checklist.g.not_ready.length, "parcel")} can’t go today: {checklist.g.not_ready.slice(0, 3).map((p) => `${p.id} — ${p.reason}`).join("; ")}
                {checklist.g.not_ready.length > 3 ? "…" : ""}
              </p>
            )}
            <div className="flex gap-2 text-xs">
              <button className="link" onClick={() => setChecklist({ ...checklist, ticked: Object.fromEntries(checklist.g.ready.map((p) => [p.id, true])) })}>
                Tick all
              </button>
              <button className="link" onClick={() => setChecklist({ ...checklist, ticked: {} })}>
                Untick all
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!autoConfirm}
        title={`${autoConfirm?.courier.name} courier arrived?`}
        message={
          autoConfirm && (
            <>
              <p>
                {autoConfirm.mode === "scheduled" ? "This courier is normally handed over automatically at pickup time. " : ""}
                <b>{plural(autoConfirm.ready.length, "ready parcel")}</b> will be handed over automatically and marked Shipped, and a manifest will be created.
              </p>
              {autoConfirm.ready.length > 0 && <p className="mt-1 text-xs">Collect from: {autoConfirm.locations.join(", ")}.</p>}
              {autoConfirm.not_ready.length > 0 && <p className="mt-1 text-xs text-amber-800">{plural(autoConfirm.not_ready.length, "parcel")} can’t go and will stay behind.</p>}
            </>
          )
        }
        confirmLabel={autoConfirm?.ready.length ? `Hand over ${autoConfirm.ready.length}` : "Record arrival"}
        busy={busy}
        onCancel={() => setAutoConfirm(null)}
        onConfirm={() => autoConfirm && arrive(autoConfirm)}
      />

      <ConfirmDialog
        open={!!handSelected}
        title={`Hand ${handSelected ? plural(handSelected.ready.filter((p) => selected[p.id]).length, "parcel") : ""} to ${handSelected?.courier.name}?`}
        message="These orders will be marked Shipped and a manifest will be created. Make sure the courier has physically taken every parcel listed."
        confirmLabel="Confirm handover"
        busy={busy}
        onCancel={() => setHandSelected(null)}
        onConfirm={() => handSelected && handOverSelected(handSelected)}
      >
        <ul className="mt-3 max-h-48 space-y-1 overflow-auto rounded-lg bg-slate-50 p-3 text-sm">
          {handSelected?.ready
            .filter((p) => selected[p.id])
            .map((p) => (
              <li key={p.id} className="flex justify-between">
                <span className="mono font-semibold">{p.id}</span>
                <span className="text-ink-muted">{p.staging_location}</span>
              </li>
            ))}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!modeFor}
        title={`${modeFor?.g.courier.name}: ${modeFor ? MODES[modeFor.mode].label : ""}?`}
        message={modeFor ? MODES[modeFor.mode].how : ""}
        confirmLabel="Change handover mode"
        busy={busy}
        onCancel={() => setModeFor(null)}
        onConfirm={saveMode}
      />

      <ManifestModal manifest={manifest} onClose={() => setManifest(null)} />
    </div>
  );
}

function groupByLocation(ps: DispatchPkg[]): [string, DispatchPkg[]][] {
  const m = new Map<string, DispatchPkg[]>();
  ps.forEach((p) => {
    const k = p.staging_location || "—";
    m.set(k, [...(m.get(k) || []), p]);
  });
  return Array.from(m.entries());
}

function CourierCard({
  g, now, focused, highlight, selected, setSelected, isOffice, busy, onArrived, onHandSelected, onMode, onManifest,
}: {
  g: HandoverGroup;
  now: Date;
  focused: boolean;
  highlight: string;
  selected: Record<string, boolean>;
  setSelected: (fn: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  isOffice: boolean;
  busy: boolean;
  onArrived: () => void;
  onHandSelected: () => void;
  onMode: (m: HandoverMode) => void;
  onManifest: (id: string) => void;
}) {
  const [showBlocked, setShowBlocked] = useState(() => g.not_ready.some((p) => p.id === highlight));
  const M = MODES[g.mode];
  const sel = g.ready.filter((p) => selected[p.id]);
  const allSel = g.ready.length > 0 && sel.length === g.ready.length;
  const sorted = useMemo(() => [...g.ready].sort((a, b) => (a.staging_location || "").localeCompare(b.staging_location || "") || Number(b.priority) - Number(a.priority)), [g.ready]);
  const late = g.minutes_to_pickup < 0;
  return (
    <section id={`courier-${g.courier.id}`} className={cx("card scroll-mt-24 overflow-hidden", g.on_site && "border-brand-300 ring-2 ring-brand-500/20", focused && "ring-2 ring-brand-500/30")}>
      <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
        <span className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", g.on_site ? "bg-brand-600 text-white" : g.alert ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-ink-muted")}>
          <LuTruck className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
            {g.courier.name}
            {g.on_site && (
              <span className="chip bg-brand-600 text-white ring-brand-600">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Courier is here
              </span>
            )}
            <span className={cx("chip", M.chip)} title={M.how}>
              <M.icon className="h-3 w-3" /> {M.short}
            </span>
          </p>
          <p className="text-sm text-ink-muted">
            Next pickup <b className="text-ink">{fmtWhen(g.next_pickup, now)}</b> ({late ? "now" : `in ${fmtDuration(g.minutes_to_pickup)}`}) · lane <b className="text-ink">{g.courier.lane}</b> · daily at {g.courier.pickups.join(", ")}
          </p>
          <p className="text-xs text-ink-muted">
            {g.last_visit ? (
              <>
                Last visit {ago(g.last_visit.arrived_at, now)} · took {plural(g.last_visit.parcels, "parcel")}
                {g.last_visit.manifest_id && (
                  <>
                    {" "}
                    on{" "}
                    <button className="link" onClick={() => onManifest(g.last_visit!.manifest_id!)}>
                      {g.last_visit.manifest_id}
                    </button>
                  </>
                )}
              </>
            ) : (
              "No visit recorded yet"
            )}{" "}
            · {g.shipped_today} shipped today
          </p>
          {g.mode === "scheduled" && g.ready.length > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-sky-800">
              <LuTimer className="h-4 w-4" /> {plural(g.ready.length, "parcel")} will be handed over automatically at {fmtWhen(g.next_pickup, now)}
            </p>
          )}
          {g.alert && g.unstaged > 0 && (
            <p className="mt-1 text-sm font-semibold text-amber-700">
              Pickup soon — {plural(g.unstaged, "parcel")} still not staged.{" "}
              <Link className="underline" href="/staging">
                Stage now
              </Link>
            </p>
          )}
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {isOffice && (
            <label className="flex items-center gap-1.5 text-xs text-ink-muted" title="How this courier’s parcels are handed over">
              <LuSettings2 className="h-4 w-4" />
              <select className="input h-9 w-auto py-0 text-xs" value={g.mode} onChange={(e) => onMode(e.target.value as HandoverMode)} aria-label={`Handover mode for ${g.courier.name}`}>
                {(Object.keys(MODES) as HandoverMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODES[m].label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {sel.length > 0 && (
            <button className="btn btn-secondary btn-xl" disabled={busy} onClick={onHandSelected}>
              <LuHandshake className="h-5 w-5" /> Hand over {sel.length} ticked
            </button>
          )}
          <button className="btn btn-primary btn-xl" disabled={busy} onClick={onArrived}>
            <LuDoorOpen className="h-5 w-5" /> Courier arrived{g.mode !== "manual" && g.ready.length ? ` · send ${g.ready.length}` : ""}
          </button>
        </div>
      </div>

      {g.ready.length === 0 ? (
        <p className="px-4 py-4 text-center text-sm text-ink-muted">Nothing ready for {g.courier.name} right now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="table-head">
                <th className="w-10 px-4 py-2.5">
                  <button aria-label="Tick all ready" onClick={() => setSelected((s) => ({ ...s, ...Object.fromEntries(g.ready.map((p) => [p.id, !allSel])) }))}>
                    {allSel ? <LuSquareCheck className="h-5 w-5 text-brand-600" /> : <LuSquare className="h-5 w-5 text-ink-faint" />}
                  </button>
                </th>
                <th className="px-3 py-2.5">Package</th>
                <th className="px-3 py-2.5">Order</th>
                <th className="px-3 py-2.5">Collect from</th>
                <th className="px-3 py-2.5">Waiting</th>
                <th className="px-4 py-2.5">Pickup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sorted.map((p) => (
                <tr key={p.id} id={`pkg-${p.id}`} className={cx(highlight === p.id && "flash bg-brand-50/50", selected[p.id] && "bg-brand-50/30")}>
                  <td className="px-4 py-2.5">
                    <button aria-label={`Tick ${p.id}`} onClick={() => setSelected((s) => ({ ...s, [p.id]: !s[p.id] }))}>
                      {selected[p.id] ? <LuSquareCheck className="h-5 w-5 text-brand-600" /> : <LuSquare className="h-5 w-5 text-ink-faint" />}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="mono font-semibold text-ink">{p.id}</p>
                    <p className="text-xs text-ink-muted">
                      {p.package_type} · {p.weight_kg.toFixed(2)} kg
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="flex items-center gap-1.5">
                      <Link href={`/orders/${p.order_id}`} className="mono text-ink-soft hover:underline">
                        {p.order_id}
                      </Link>
                      {p.priority && <PriorityBadge priority />}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {p.customer_name} · {p.city}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1 font-semibold text-ink">
                      <LuMapPin className="h-4 w-4 text-brand-600" /> {p.staging_location}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-ink-soft">{fmtDuration(p.waiting_minutes)}</td>
                  <td className="px-4 py-2.5">
                    <p className="text-ink-soft">{fmtWhen(p.pickup_at, now)}</p>
                    {p.missed_pickup && (
                      <span className="chip mt-0.5 bg-red-50 text-red-700 ring-red-200">
                        <LuFlag className="h-3 w-3" /> Missed a pickup
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {g.not_ready.length > 0 && (
        <div className="border-t border-line bg-amber-50/40">
          <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-amber-900" onClick={() => setShowBlocked(!showBlocked)}>
            <LuTriangleAlert className="h-4 w-4" /> {plural(g.not_ready.length, "parcel")} can’t leave yet
            <span className="ml-auto">{showBlocked ? <LuChevronUp className="h-4 w-4" /> : <LuChevronDown className="h-4 w-4" />}</span>
          </button>
          {showBlocked && (
            <ul className="divide-y divide-amber-100 px-4 pb-3 text-sm">
              {g.not_ready.map((p) => (
                <li key={p.id} id={`pkg-${p.id}`} className={cx("flex flex-wrap items-center gap-2 py-2", highlight === p.id && "flash")}>
                  <span className="mono font-semibold text-ink">{p.id}</span>
                  <Link href={`/orders/${p.order_id}`} className="mono text-xs text-ink-muted hover:underline">
                    {p.order_id}
                  </Link>
                  <span className="text-xs text-amber-900">{p.reason}</span>
                  <Link href={`/staging?package=${p.id}`} className="btn btn-secondary ml-auto py-1 text-xs">
                    <LuLayoutGrid className="h-3.5 w-3.5" /> {p.status === "packed" ? "Stage it" : "Open in Staging"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
