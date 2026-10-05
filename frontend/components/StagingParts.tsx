"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LuLayers, LuMapPin, LuShieldAlert, LuStar, LuTruck } from "react-icons/lu";
import { cx } from "@/lib/format";
import type { AreaKind, DispatchPkg, StagingArea } from "@/lib/types";
import { SearchInput } from "./FilterBar";
import { Modal } from "./Modal";

export type StageTarget = { pkg: DispatchPkg; mode: "stage" | "move" };
type Target = StageTarget;

export const AREA_STYLE: Record<AreaKind, { label: string; icon: React.ComponentType<{ className?: string }>; tile: string; bar: string; chip: string }> = {
  lane: { label: "Courier lane", icon: LuTruck, tile: "bg-brand-50 text-brand-700", bar: "bg-brand-500", chip: "bg-brand-50 text-brand-800 ring-brand-200" },
  priority: { label: "Priority shelf", icon: LuStar, tile: "bg-orange-50 text-orange-700", bar: "bg-orange-500", chip: "bg-orange-50 text-orange-800 ring-orange-200" },
  overflow: { label: "Overflow · any courier", icon: LuLayers, tile: "bg-sky-50 text-sky-700", bar: "bg-sky-500", chip: "bg-sky-50 text-sky-800 ring-sky-200" },
  hold: { label: "Hold rack · not going out", icon: LuShieldAlert, tile: "bg-red-50 text-red-700", bar: "bg-red-500", chip: "bg-red-50 text-red-700 ring-red-200" },
  other: { label: "Unknown place", icon: LuMapPin, tile: "bg-slate-100 text-ink-muted", bar: "bg-slate-400", chip: "bg-slate-100 text-ink-soft ring-slate-200" },
};


export function FindPackage({ find, setFind, found }: { find: string; setFind: (v: string) => void; found: any[] | null }) {
  return (
    <div className="card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm font-semibold text-ink">Find a package</p>
        <SearchInput value={find} onChange={setFind} placeholder="Order ID, package ID or label (e.g. PKG-50012)" className="flex-1" />
      </div>
      {found && (
        <div className="mt-3">
          {found.length === 0 ? (
            <p className="text-sm text-ink-muted">No package matches “{find}”.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-slate-200">
              {found.map((p) => {
                const href = p.status === "packed" ? `/staging?package=${p.id}` : p.status === "staged" ? `/handover?package=${p.id}` : p.status === "handed_over" ? `/shipped?range=all&q=${p.id}` : `/orders/${p.order_id}`;
                return (
                  <li key={p.id}>
                    <Link href={href} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
                      <span className="mono font-semibold text-ink">{p.id}</span>
                      <span className="mono text-ink-muted">{p.order_id}</span>
                      <span className="text-ink-soft">{p.customer_name}</span>
                      <span className="ml-auto flex items-center gap-1.5 font-semibold text-ink">
                        <LuMapPin className="h-4 w-4 text-brand-600" />
                        {p.status === "handed_over"
                          ? `Shipped with ${p.courier_name} (${p.manifest_id})`
                          : p.status === "staged"
                            ? `${p.staging_location} · ready for ${p.courier_name}`
                            : p.status === "cancelled"
                              ? "Cancelled — pull from staging"
                              : "At the packing station (not staged yet)"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function ChooseAreaModal({
  target, areas, busy, onClose, onPick,
}: {
  target: Target | null;
  areas: StagingArea[];
  busy: boolean;
  onClose: () => void;
  onPick: (location: string, confirmOtherLane: boolean) => void;
}) {
  const [loc, setLoc] = useState("");
  const [confirmOther, setConfirmOther] = useState(false);
  const pkg = target?.pkg;
  useEffect(() => {
    if (!pkg) return;
    setLoc(pkg.status === "staged" ? pkg.staging_location || "" : pkg.suggestion?.location || pkg.courier_lane);
    setConfirmOther(false);
  }, [pkg?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pkg) return null;
  const chosen = areas.find((a) => a.name === loc);
  const otherLane = chosen?.kind === "lane" && chosen.courier_id !== pkg.courier_id;
  const groups: { title: string; items: StagingArea[] }[] = [
    { title: `Lane for ${pkg.courier_name}`, items: areas.filter((a) => a.kind === "lane" && a.courier_id === pkg.courier_id) },
    { title: "Shared areas", items: areas.filter((a) => a.kind === "priority" || a.kind === "overflow") },
    { title: "Hold rack — parcel must not go out yet", items: areas.filter((a) => a.kind === "hold") },
    { title: "Other couriers’ lanes (not recommended)", items: areas.filter((a) => a.kind === "lane" && a.courier_id !== pkg.courier_id) },
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title={`${target!.mode === "move" ? "Move" : "Stage"} ${pkg.id}`}
      subtitle={`${pkg.courier_name} parcel${pkg.priority ? " · priority" : ""}${pkg.status === "staged" ? ` · now at ${pkg.staging_location}` : ""}. Where are you putting it?`}
      size="md"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !loc || (otherLane && !confirmOther) || (pkg.status === "staged" && loc === pkg.staging_location)} onClick={() => onPick(loc, otherLane)}>
            <LuMapPin className="h-4 w-4" /> {target!.mode === "move" ? `Move to ${loc || "…"}` : `Stage at ${loc || "…"}`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {pkg.suggestion && (
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">
            <b>Suggested: {pkg.suggestion.location}</b> — {pkg.suggestion.reason}
          </p>
        )}
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.title}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{g.title}</p>
                <div className="grid gap-2">
                  {g.items.map((a) => {
                    const S = AREA_STYLE[a.kind];
                    const full = a.count >= a.capacity;
                    const here = pkg.status === "staged" && pkg.staging_location === a.name;
                    const suggested = pkg.suggestion?.location === a.name;
                    return (
                      <button
                        key={a.name}
                        onClick={() => {
                          setLoc(a.name);
                          setConfirmOther(false);
                        }}
                        className={cx(
                          "flex min-h-[52px] items-center gap-3 rounded-xl border px-3 py-2 text-left",
                          loc === a.name ? "border-brand-500 bg-brand-50 ring-1 ring-brand-300" : "border-slate-200 hover:border-slate-300",
                        )}
                      >
                        <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", S.tile)}>
                          <S.icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                            {a.name}
                            {suggested && <span className="chip bg-brand-100 text-brand-800 ring-brand-200">Suggested</span>}
                            {here && <span className="chip bg-slate-100 text-ink-soft ring-slate-200">It’s here now</span>}
                            {full && <span className="chip bg-red-50 text-red-700 ring-red-200">Full</span>}
                          </span>
                          <span className="block truncate text-xs text-ink-muted">{a.purpose}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs tabular-nums text-ink-muted">
                          {a.count}/{a.capacity}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ),
        )}
        {otherLane && chosen && (
          <label className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <input type="checkbox" className="mt-0.5" checked={confirmOther} onChange={(e) => setConfirmOther(e.target.checked)} />
            <span>
              <b>{chosen.name} is for {chosen.courier_name}.</b> The {chosen.courier_name} driver could take this {pkg.courier_name} parcel by mistake. Tick to put it there anyway.
            </span>
          </label>
        )}
        {chosen?.kind === "hold" && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">Parcels on the hold rack are never handed over. Move it back to a lane when the problem is cleared.</p>}
      </div>
    </Modal>
  );
}
