"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LuSend, LuFileText, LuTruck, LuCircleCheck, LuClock, LuHandshake, LuDoorOpen, LuPrinter } from "react-icons/lu";
import { api } from "@/lib/api";
import { useApi, useNow, useQueryParams } from "@/lib/hooks";
import { useToast } from "@/lib/context";
import { cx, fmtWhen, plural } from "@/lib/format";
import type { Manifest, ShippedData } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { DispatchFlow } from "@/components/DispatchFlow";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/EmptyState";
import { SearchInput, Select, Tabs } from "@/components/FilterBar";
import { ManifestModal, TriggerChip } from "@/components/ManifestModal";
import { PriorityBadge } from "@/components/StatusBadge";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "all", label: "All" },
];

export default function ShippedPage() {
  const [params, setParams, ready] = useQueryParams();
  const range = params.get("range") || "today";
  const courier = params.get("courier") || "";
  const view = params.get("view") || "parcels";
  const [q, setQ] = useState("");
  useEffect(() => setQ(params.get("q") || ""), [params]);
  const { data, error, loading, reload } = useApi<ShippedData>(
    ready ? `/api/shipped?range=${range}&courier=${courier}&q=${encodeURIComponent(q)}` : null,
    { poll: 60000 },
  );
  const now = useNow();
  const toast = useToast();
  const [manifest, setManifest] = useState<Manifest | null>(null);

  async function openManifest(id: string) {
    try {
      setManifest(await api<Manifest>(`/api/manifests/${id}`));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  const s = data?.stats;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipped"
        subtitle="Every parcel that has left the building — who took it, when, on which manifest, and whether it went by hand or automatically."
        actions={
          <>
            <Link href="/guide#shipped" className="btn btn-secondary">
              How this works
            </Link>
            <Link href="/handover" className="btn btn-secondary">
              <LuHandshake className="h-4 w-4" /> Ready to hand over
            </Link>
          </>
        }
      />
      <DispatchFlow current="shipped" />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs value={range} onChange={(v) => setParams({ range: v === "today" ? null : v })} tabs={RANGES} />
        <Select
          label="Courier"
          value={courier}
          onChange={(v) => setParams({ courier: v || null })}
          options={[{ value: "", label: "All couriers" }, ...(data?.couriers || []).map((c) => ({ value: c.id, label: c.name }))]}
        />
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setParams({ q: v || null });
          }}
          placeholder="Package, order, customer, city or manifest"
          className="w-full lg:ml-auto lg:w-80"
        />
      </div>

      {loading ? (
        <PageSkeleton />
      ) : error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || !s ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { k: "Parcels shipped", v: s.parcels, hint: `${s.priority} priority`, icon: LuSend },
              { k: "Manifests", v: s.manifests, hint: "Proof of each handover", icon: LuFileText },
              { k: "Handed over automatically", v: s.automatic, hint: s.parcels ? `${Math.round((s.automatic / s.parcels) * 100)}% of parcels` : "—", icon: LuTruck },
              { k: "Left before ship-by", v: s.on_time_pct === null ? "—" : `${s.on_time_pct}%`, hint: "Handed over on time", icon: LuClock },
            ].map((x) => (
              <div key={x.k} className="card card-pad">
                <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <x.icon className="h-3.5 w-3.5" /> {x.k}
                </p>
                <p className="text-2xl font-semibold tabular-nums text-ink">{x.v}</p>
                <p className="text-[11px] text-ink-faint">{x.hint}</p>
              </div>
            ))}
          </div>
          {s.by_courier.length > 0 && (
            <div className="card flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
              <span className="font-semibold text-ink-soft">By courier:</span>
              {s.by_courier.map((b) => (
                <span key={b.courier} className="chip bg-slate-50 text-ink-soft ring-slate-200">
                  {b.courier} · {b.parcels}
                </span>
              ))}
            </div>
          )}

          <section className="card overflow-hidden">
            <div className="border-b border-line p-4">
              <Tabs
                value={view}
                onChange={(v) => setParams({ view: v === "parcels" ? null : v })}
                tabs={[
                  { value: "parcels", label: "Parcels", count: data.parcels.length },
                  { value: "manifests", label: "Manifests", count: data.manifests.length },
                  { value: "visits", label: "Courier visits", count: data.visits.length },
                ]}
              />
            </div>

            {view === "parcels" &&
              (data.parcels.length === 0 ? (
                <EmptyState icon={LuSend} title={q ? "No shipped parcel matches" : "Nothing shipped in this period"} hint="Parcels appear here the moment a courier takes them." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="table-head">
                        <th className="px-4 py-2.5">Package</th>
                        <th className="px-3 py-2.5">Order</th>
                        <th className="px-3 py-2.5">Destination</th>
                        <th className="px-3 py-2.5">Courier</th>
                        <th className="px-3 py-2.5">Left at</th>
                        <th className="px-3 py-2.5">How</th>
                        <th className="px-4 py-2.5">Manifest</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.parcels.map((p) => (
                        <tr key={p.id} className={cx(q && p.id === q.toUpperCase() && "flash bg-brand-50/40")}>
                          <td className="px-4 py-2.5">
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
                              {p.customer_name} · {p.channel}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 text-ink-soft">
                            {p.city} {p.pincode}
                          </td>
                          <td className="px-3 py-2.5 font-medium text-ink">{p.courier_name}</td>
                          <td className="px-3 py-2.5">
                            <p className="text-ink-soft">{fmtWhen(p.handed_over_at, now)}</p>
                            {p.on_time ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                <LuCircleCheck className="h-3 w-3" /> before ship-by
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold text-red-600">after ship-by</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <TriggerChip trigger={p.trigger} />
                            {p.handed_by && <p className="mt-0.5 text-[11px] text-ink-muted">{p.handed_by}</p>}
                          </td>
                          <td className="px-4 py-2.5">
                            {p.manifest_id && (
                              <button className="link mono text-xs" onClick={() => openManifest(p.manifest_id!)}>
                                {p.manifest_id}
                              </button>
                            )}
                            {p.staging_location && <p className="text-[11px] text-ink-muted">from {p.staging_location}</p>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

            {view === "manifests" &&
              (data.manifests.length === 0 ? (
                <EmptyState icon={LuFileText} title="No manifests in this period" />
              ) : (
                <ul className="divide-y divide-line">
                  {data.manifests.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                      <LuFileText className="h-4 w-4 text-ink-muted" />
                      <span className="mono font-semibold text-ink">{m.id}</span>
                      <span className="text-ink-soft">
                        {m.courier_name} · {plural(m.parcel_count, "parcel")} · {fmtWhen(m.created_at, now)} · {m.created_by}
                      </span>
                      <TriggerChip trigger={m.trigger} />
                      <button className="btn btn-secondary ml-auto py-1.5 text-xs" onClick={() => openManifest(m.id)}>
                        <LuPrinter className="h-3.5 w-3.5" /> View & print
                      </button>
                    </li>
                  ))}
                </ul>
              ))}

            {view === "visits" &&
              (data.visits.length === 0 ? (
                <EmptyState icon={LuDoorOpen} title="No courier visits recorded in this period" />
              ) : (
                <ul className="divide-y divide-line">
                  {data.visits.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                      <LuDoorOpen className="h-4 w-4 text-ink-muted" />
                      <span className="font-semibold text-ink">{v.courier_name}</span>
                      <span className="text-ink-soft">
                        arrived {fmtWhen(v.arrived_at, now)} · recorded by {v.recorded_by}
                      </span>
                      <TriggerChip trigger={v.trigger} />
                      <span className="ml-auto text-xs text-ink-muted">
                        took <b className="text-ink">{v.parcels}</b>
                        {v.left_behind > 0 && <b className="text-amber-700"> · {v.left_behind} left behind</b>}
                        {v.manifest_id && (
                          <>
                            {" "}
                            ·{" "}
                            <button className="link mono" onClick={() => openManifest(v.manifest_id!)}>
                              {v.manifest_id}
                            </button>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
          </section>
        </>
      )}

      <ManifestModal manifest={manifest} onClose={() => setManifest(null)} />
    </div>
  );
}
