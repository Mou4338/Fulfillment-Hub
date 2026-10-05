"use client";

import { LuBot, LuHand, LuPrinter } from "react-icons/lu";
import { useNow } from "@/lib/hooks";
import { cx, fmtWhen, plural } from "@/lib/format";
import type { Manifest } from "@/lib/types";
import { Modal } from "./Modal";

export function TriggerChip({ trigger }: { trigger: string | null | undefined }) {
  const auto = trigger === "on_arrival" || trigger === "scheduled";
  return (
    <span className={cx("chip", auto ? "bg-violet-50 text-violet-800 ring-violet-200" : "bg-slate-100 text-ink-soft ring-slate-200")} title={auto ? "Handed over automatically" : "Ticked and handed over by a person"}>
      {auto ? <LuBot className="h-3 w-3" /> : <LuHand className="h-3 w-3" />}
      {trigger === "scheduled" ? "Auto · pickup time" : trigger === "on_arrival" ? "Auto · on arrival" : "By hand"}
    </span>
  );
}

export function ManifestModal({ manifest, onClose }: { manifest: Manifest | null; onClose: () => void }) {
  const now = useNow();
  return (
    <Modal
      open={!!manifest}
      onClose={onClose}
      title={`Manifest ${manifest?.id || ""}`}
      subtitle={manifest ? `${manifest.courier_name} · ${fmtWhen(manifest.created_at, now)} · ${manifest.trigger_label} · recorded by ${manifest.created_by}` : ""}
      size="lg"
      footer={
        <button className="btn btn-secondary" onClick={() => window.print()}>
          <LuPrinter className="h-4 w-4" /> Print
        </button>
      }
    >
      {manifest && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="table-head">
                <th className="px-3 py-2">Package</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Destination</th>
                <th className="px-3 py-2">Taken from</th>
                <th className="px-3 py-2 text-right">Weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {manifest.parcels.map((p) => (
                <tr key={p.id}>
                  <td className="mono px-3 py-2 font-semibold">{p.id}</td>
                  <td className="mono px-3 py-2">{p.order_id}</td>
                  <td className="px-3 py-2">{p.customer_name}</td>
                  <td className="px-3 py-2">
                    {p.city} {p.pincode}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{p.staging_location || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(p.weight_kg).toFixed(2)} kg</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="px-3 pt-3 text-right text-sm font-semibold">
                  {plural(manifest.parcels.length, "parcel")} · <TriggerChip trigger={manifest.trigger} /> · courier signature: ____________________
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}
