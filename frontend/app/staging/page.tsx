"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  LuMapPin, LuTriangleAlert, LuCircleCheck, LuPackage, LuChevronDown, LuChevronUp,
  LuArrowRight, LuMoveRight, LuHandshake, LuFlag,
} from "react-icons/lu";
import { api, post } from "@/lib/api";
import { useApi, useNow, useQueryParams } from "@/lib/hooks";
import { useToast } from "@/lib/context";
import { cx, fmtDuration, fmtWhen, plural } from "@/lib/format";
import type { AreaKind, DispatchPkg, StagingArea, StagingBoard } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { DispatchFlow } from "@/components/DispatchFlow";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/EmptyState";
import { Tabs } from "@/components/FilterBar";
import { AREA_STYLE, ChooseAreaModal, FindPackage, type StageTarget } from "@/components/StagingParts";
import { PriorityBadge } from "@/components/StatusBadge";


export default function StagingPage() {
  const { data, error, loading, reload } = useApi<StagingBoard>("/api/staging", { poll: 20000 });
  const [params, setParams] = useQueryParams();
  const now = useNow();
  const toast = useToast();
  const [find, setFind] = useState("");
  const [found, setFound] = useState<any[] | null>(null);
  const [courierFilter, setCourierFilter] = useState("");
  const [target, setTarget] = useState<StageTarget | null>(null);
  const [openArea, setOpenArea] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const highlight = params.get("package") || "";

  useEffect(() => {
    if (find.trim().length < 3) {
      setFound(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setFound(await api(`/api/packages/find?q=${encodeURIComponent(find.trim())}`));
      } catch {
        setFound([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [find]);

  useEffect(() => {
    if (!data || !highlight) return;
    const packed = data.to_stage.find((p) => p.id === highlight);
    if (packed) setTarget({ pkg: packed, mode: "stage" });
    else {
      const area = data.areas.find((a) => a.packages.some((p) => p.id === highlight));
      if (area) setOpenArea(area.name);
    }
    setTimeout(() => document.getElementById(`pkg-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 200);
  }, [!!data, highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (openArea) setTimeout(() => document.getElementById("area-parcels")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [openArea]);

  const toStage = useMemo(() => (data?.to_stage || []).filter((p) => !courierFilter || p.courier_id === courierFilter), [data, courierFilter]);

  if (loading) return <PageSkeleton />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  async function stage(pkg: DispatchPkg, location: string, confirmOtherLane = false) {
    setBusy(pkg.id);
    try {
      await post(`/api/packages/${pkg.id}/stage`, { location, confirm_other_lane: confirmOtherLane });
      toast(pkg.status === "staged" ? `${pkg.id} moved to ${location}` : `${pkg.id} staged at ${location} — it’s now on Ready to hand over`);
      setTarget(null);
      if (highlight === pkg.id) setParams({ package: null });
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  }

  const c = data.counts;
  const lanes = data.areas.filter((a) => a.kind === "lane");
  const shared = data.areas.filter((a) => a.kind !== "lane");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staging"
        subtitle="Every packed box gets a known place until the courier takes it. Stage it in the suggested area — the parcel then appears on Ready to hand over."
        actions={
          <>
            <Link href="/guide#staging" className="btn btn-secondary">
              How this works
            </Link>
            <Link href="/handover" className="btn btn-primary">
              <LuHandshake className="h-4 w-4" /> Ready to hand over
            </Link>
          </>
        }
      />
      <DispatchFlow current="staging" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { k: "To stage", v: c.to_stage, hint: "Packed, not placed yet", tone: c.to_stage ? "text-amber-700" : "text-ink" },
          { k: "In staging", v: c.staged, hint: "Placed and tracked", tone: "text-ink" },
          { k: "On the hold rack", v: c.on_hold, hint: "Must not go out yet", tone: c.on_hold ? "text-red-600" : "text-ink" },
          { k: "In the wrong lane", v: c.wrong_lane, hint: "Another courier’s lane", tone: c.wrong_lane ? "text-red-600" : "text-ink" },
          { k: "Areas full", v: c.areas_full, hint: "At or over capacity", tone: c.areas_full ? "text-amber-700" : "text-ink" },
        ].map((x) => (
          <div key={x.k} className="card card-pad">
            <p className="text-xs text-ink-muted">{x.k}</p>
            <p className={cx("text-2xl font-semibold tabular-nums", x.tone)}>{x.v}</p>
            <p className="text-[11px] text-ink-faint">{x.hint}</p>
          </div>
        ))}
      </div>

      <FindPackage find={find} setFind={setFind} found={found} />

      {data.pull_from_staging.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <LuTriangleAlert className="h-4 w-4" /> Pull from staging — these orders were cancelled
          </p>
          <ul className="mt-2 space-y-1 text-sm text-red-900">
            {data.pull_from_staging.map((p) => (
              <li key={p.issue_id}>
                <span className="mono font-semibold">{p.package_id}</span> ({p.order_id}) at <b>{p.staging_location}</b> — take it out and return the items (
                <Link className="underline" href={`/issues?id=${p.issue_id}`}>
                  {p.issue_id}
                </Link>
                ). Do not hand it to the courier.
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 1. parcels still to place */}
      <section className={cx("card overflow-hidden", toStage.length ? "border-amber-200" : "")}>
        <div className="flex flex-col gap-3 border-b border-line bg-amber-50/40 px-5 py-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <LuPackage className="h-4 w-4 text-amber-700" /> To stage · {data.to_stage.length}
            </h2>
            <p className="text-xs text-ink-muted">Packed parcels still at the packing station. Press the green button to put each one in its suggested area — or choose another.</p>
          </div>
          <Tabs
            value={courierFilter}
            onChange={setCourierFilter}
            tabs={[{ value: "", label: "All couriers", count: data.to_stage.length }, ...data.couriers.filter((x) => x.to_stage).map((x) => ({ value: x.id, label: x.name, count: x.to_stage }))]}
          />
        </div>
        {toStage.length === 0 ? (
          <EmptyState compact tone="good" icon={LuCircleCheck} title="Nothing to stage" hint="Every packed parcel has a place. Parcels in staging are handed over from “Ready to hand over”." />
        ) : (
          <ul className="divide-y divide-line">
            {toStage.map((p) => {
              const courier = data.couriers.find((x) => x.id === p.courier_id);
              const soon = courier && courier.minutes_to_pickup <= data.alert_minutes;
              return (
                <li key={p.id} id={`pkg-${p.id}`} className={cx("flex scroll-mt-24 flex-col gap-3 px-5 py-3.5 lg:flex-row lg:items-center", highlight === p.id && "flash bg-brand-50/40")}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      <span className="mono">{p.id}</span>
                      <Link href={`/orders/${p.order_id}`} className="mono font-normal text-ink-soft hover:underline">
                        {p.order_id}
                      </Link>
                      {p.priority && <PriorityBadge priority />}
                      <span className="font-normal text-ink-muted">· {p.customer_name}</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                      <span>
                        {p.package_type} · {p.weight_kg.toFixed(2)} kg
                      </span>
                      <span>
                        · <b className="text-ink-soft">{p.courier_name}</b> pickup {courier ? fmtWhen(courier.next_pickup, now) : "—"}
                      </span>
                      {soon && <span className="chip bg-amber-50 text-amber-800 ring-amber-200">Pickup in {fmtDuration(courier!.minutes_to_pickup)}</span>}
                      <span>· packed {fmtDuration(p.waiting_minutes)} ago</span>
                    </p>
                    {p.suggestion && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
                        <LuArrowRight className="h-3.5 w-3.5 text-brand-600" /> {p.suggestion.reason}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {p.suggestion && (
                      <button className="btn btn-primary btn-xl" disabled={busy === p.id} onClick={() => stage(p, p.suggestion!.location)}>
                        <LuMapPin className="h-5 w-5" /> Stage at {p.suggestion.location}
                      </button>
                    )}
                    <button className="btn btn-secondary btn-xl" onClick={() => setTarget({ pkg: p, mode: "stage" })}>
                      Choose area
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 2. every staging area */}
      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Staging areas · where every parcel is</h2>
            <p className="text-xs text-ink-muted">One lane per courier, plus shared areas. Open an area to see its parcels or move one.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["lane", "priority", "overflow", "hold"] as AreaKind[]).map((k) => {
              const S = AREA_STYLE[k];
              return (
                <span key={k} className={cx("chip", S.chip)}>
                  <S.icon className="h-3 w-3" /> {S.label}
                </span>
              );
            })}
          </div>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Courier lanes</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {lanes.map((a) => (
            <AreaCard key={a.name} a={a} open={openArea === a.name} onToggle={() => setOpenArea(openArea === a.name ? null : a.name)} highlight={highlight} onMove={(p) => setTarget({ pkg: p, mode: "move" })} />
          ))}
        </div>
        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Shared areas</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {shared.map((a) => (
            <AreaCard key={a.name} a={a} open={openArea === a.name} onToggle={() => setOpenArea(openArea === a.name ? null : a.name)} highlight={highlight} onMove={(p) => setTarget({ pkg: p, mode: "move" })} />
          ))}
        </div>
        {openArea && (
          <AreaParcels
            area={data.areas.find((a) => a.name === openArea)!}
            highlight={highlight}
            onClose={() => setOpenArea(null)}
            onMove={(p) => setTarget({ pkg: p, mode: "move" })}
          />
        )}
      </section>

      <ChooseAreaModal target={target} areas={data.areas} busy={!!busy} onClose={() => setTarget(null)} onPick={(loc, confirm) => target && stage(target.pkg, loc, confirm)} />
    </div>
  );
}


function AreaCard({ a, open, onToggle }: { a: StagingArea; open: boolean; onToggle: () => void; highlight: string; onMove: (p: DispatchPkg) => void }) {
  const S = AREA_STYLE[a.kind];
  const full = a.count >= a.capacity;
  return (
    <button onClick={onToggle} className={cx("card flex flex-col gap-2 p-4 text-left transition-colors hover:border-brand-300", open && "border-brand-400 ring-2 ring-brand-500/20")}>
      <div className="flex items-start gap-3">
        <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", S.tile)}>
          <S.icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{a.name}</p>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{a.kind === "lane" ? `${a.courier_name} only` : S.label}</p>
        </div>
        <span className="text-right">
          <span className={cx("block text-xl font-semibold tabular-nums", full ? "text-red-600" : a.count ? "text-ink" : "text-ink-faint")}>{a.count}</span>
          <span className="block text-[11px] text-ink-muted">of {a.capacity}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={cx("h-full", full ? "bg-red-500" : S.bar)} style={{ width: `${Math.min(100, a.fill_pct)}%` }} />
      </div>
      <p className="line-clamp-2 text-xs text-ink-muted">{a.purpose}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[11px]">
        {a.count === 0 ? (
          <span className="text-ink-faint">Empty</span>
        ) : (
          <>
            {a.couriers.map((c) => (
              <span key={c} className="chip bg-slate-50 text-ink-soft ring-slate-200">
                {c}
              </span>
            ))}
            {a.priority > 0 && <span className="chip bg-orange-50 text-orange-700 ring-orange-200">{a.priority} priority</span>}
            {full && <span className="chip bg-red-50 text-red-700 ring-red-200">Full</span>}
          </>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5 font-semibold text-brand-700">
          {open ? "Hide" : "Open"} {open ? <LuChevronUp className="h-3.5 w-3.5" /> : <LuChevronDown className="h-3.5 w-3.5" />}
        </span>
      </div>
    </button>
  );
}

function AreaParcels({ area, highlight, onClose, onMove }: { area: StagingArea; highlight: string; onClose: () => void; onMove: (p: DispatchPkg) => void }) {
  const now = useNow();
  const S = AREA_STYLE[area.kind];
  return (
    <div id="area-parcels" className="card scroll-mt-24 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <span className={cx("flex h-8 w-8 items-center justify-center rounded-lg", S.tile)}>
          <S.icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {area.name} · {plural(area.count, "parcel")}
          </p>
          <p className="text-xs text-ink-muted">{area.purpose}</p>
        </div>
        <button className="btn btn-ghost text-xs" onClick={onClose}>
          Close
        </button>
      </div>
      {area.packages.length === 0 ? (
        <EmptyState compact title={`${area.name} is empty`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="table-head">
                <th className="px-5 py-2.5">Package</th>
                <th className="px-3 py-2.5">Order</th>
                <th className="px-3 py-2.5">Courier</th>
                <th className="px-3 py-2.5">Waiting</th>
                <th className="px-3 py-2.5">Can it leave?</th>
                <th className="px-5 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {area.packages.map((p) => (
                <tr key={p.id} id={`pkg-${p.id}`} className={cx(highlight === p.id && "flash bg-brand-50/50", (p.wrong_lane || p.not_ready) && "bg-red-50/30")}>
                  <td className="px-5 py-2.5">
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
                    <p className="text-xs text-ink-muted">{p.customer_name}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-ink">{p.courier_name}</p>
                    <p className="text-xs text-ink-muted">pickup {fmtWhen(p.pickup_at, now)}</p>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-ink-soft">{fmtDuration(p.waiting_minutes)}</td>
                  <td className="px-3 py-2.5">
                    {p.wrong_lane ? (
                      <span className="chip bg-red-50 text-red-700 ring-red-200">
                        <LuTriangleAlert className="h-3 w-3" /> Wrong lane — belongs in {p.courier_lane}
                      </span>
                    ) : p.not_ready ? (
                      <span className="text-xs font-semibold text-red-700">{p.not_ready}</span>
                    ) : (
                      <span className="chip bg-emerald-50 text-emerald-700 ring-emerald-200">
                        <LuCircleCheck className="h-3 w-3" /> Ready for {p.courier_name}
                      </span>
                    )}
                    {p.missed_pickup && (
                      <span className="chip mt-1 bg-red-50 text-red-700 ring-red-200">
                        <LuFlag className="h-3 w-3" /> Missed a pickup
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <button className="btn btn-secondary py-1.5 text-xs" onClick={() => onMove(p)}>
                      <LuMoveRight className="h-3.5 w-3.5" /> Move
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

