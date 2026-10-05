"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LuArrowLeft, LuCheck, LuCircleCheck, LuPrinter, LuSearch, LuTriangleAlert, LuArrowRight, LuPackageCheck, LuFlag,
} from "react-icons/lu";
import { post } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";
import { useToast } from "@/lib/context";
import { cx, fmtWhen } from "@/lib/format";
import type { LineItem, OrderDetail } from "@/lib/types";
import { BlockedReason } from "@/components/NextActionBanner";
import { ErrorState, PageSkeleton } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { PriorityBadge, TimeLeft } from "@/components/StatusBadge";

export default function PickOrderPage() {
  const { id } = useParams() as { id: string };
  const { data: o, error, loading, reload, setData } = useApi<OrderDetail>(`/api/picking/${id}`);
  const now = useNow();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<LineItem | null>(null);
  const [kind, setKind] = useState<"not_found" | "damaged">("not_found");
  const [note, setNote] = useState("");

  if (loading) return <PageSkeleton />;
  if (error && !o) return <ErrorState message={error} onRetry={reload} />;
  if (!o) return null;

  const lines = o.line_items;
  const picked = lines.filter((l) => l.pick_status === "picked").length;
  const done = o.status === "READY_TO_PACK" || (picked === lines.length && lines.length > 0);
  const pickable = o.status === "READY_TO_PICK" || o.status === "PICKING";
  const nextLine = lines.find((l) => l.pick_status === "pending");

  async function pick(line: LineItem) {
    setBusy(line.id);
    try {
      const r = await post<{ already: boolean; order: OrderDetail }>(`/api/order-items/${line.id}/pick`);
      setData(r.order);
      if (r.order.status === "READY_TO_PACK") toast("All items picked — take the order to packing");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function report() {
    if (!problem) return;
    setBusy(problem.id);
    try {
      const r = await post<{ issue_id: string; order: OrderDetail }>(`/api/order-items/${problem.id}/problem`, { kind, note });
      setData(r.order);
      toast(`Reported. Issue ${r.issue_id} is open and the office has been alerted.`, "info");
      setProblem(null);
      setNote("");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href="/picking" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
          <LuArrowLeft className="h-4 w-4" /> Picking queue
        </Link>
        <button className="btn btn-secondary" onClick={() => window.print()}>
          <LuPrinter className="h-4 w-4" /> Print pick list
        </button>
      </div>

      <div className="card mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-ink-muted">Pick order</p>
            <h1 className="mono text-3xl font-bold text-ink">{o.id}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {o.customer_name} · {o.courier_name || "courier TBC"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <PriorityBadge priority={o.priority} size="lg" />
            <span className="text-sm text-ink-muted">Ship by {fmtWhen(o.ship_by, now)}</span>
            <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} className="text-sm" />
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-sm font-semibold">
            <span className="text-ink">
              {picked} of {lines.length} lines picked
            </span>
            <span className="text-ink-muted">{Math.round((picked / Math.max(lines.length, 1)) * 100)}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(picked / Math.max(lines.length, 1)) * 100}%` }} />
          </div>
        </div>
      </div>

      {o.blocked_info.blocked && (
        <div className="mb-4">
          <BlockedReason reasons={o.blocked_info.reasons} title="This order can't be finished yet" />
        </div>
      )}

      {!pickable && !done && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This order is <b>{o.status_label.toLowerCase()}</b> — it isn&apos;t ready for picking. {o.next_action.text}
        </div>
      )}

      <ol className="space-y-3">
        {lines.map((l, idx) => {
          const isPicked = l.pick_status === "picked";
          const problemLine = l.pick_status === "not_found" || l.pick_status === "damaged";
          const isNext = nextLine?.id === l.id && pickable;
          return (
            <li
              key={l.id}
              className={cx(
                "card overflow-hidden p-0",
                isPicked && "border-emerald-200 bg-emerald-50/40",
                problemLine && "border-red-200 bg-red-50/40",
                isNext && "ring-2 ring-brand-500/30",
              )}
            >
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4 sm:w-44 sm:shrink-0 sm:flex-col sm:items-start sm:gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Step {idx + 1} · Bin</span>
                  <span className="mono rounded-lg bg-ink px-3 py-1.5 text-2xl font-bold text-white">{l.bin}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold leading-snug text-ink">{l.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="chip bg-sky-50 px-2.5 py-1 text-sm text-sky-800 ring-sky-200">{l.variant}</span>
                    <span className="mono text-sm text-ink-muted">{l.sku}</span>
                  </div>
                  {problemLine && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-red-700">
                      <LuFlag className="h-4 w-4" /> {l.pick_status === "not_found" ? "Reported not found" : "Reported damaged"} — waiting for a decision
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-2">
                  <span className="text-3xl font-bold tabular-nums text-ink">× {l.qty}</span>
                </div>
              </div>
              {pickable && !isPicked && !problemLine && (
                <div className="no-print flex flex-col gap-2 border-t border-line bg-slate-50/50 p-3 sm:flex-row">
                  <button className="btn btn-primary btn-xl flex-1" onClick={() => pick(l)} disabled={busy !== null}>
                    <LuCheck className="h-5 w-5" /> {busy === l.id ? "Saving…" : `Picked ${l.qty}`}
                  </button>
                  <button
                    className="btn btn-secondary btn-xl"
                    onClick={() => {
                      setKind("not_found");
                      setProblem(l);
                    }}
                    disabled={busy !== null}
                  >
                    <LuSearch className="h-5 w-5" /> Can&apos;t find it
                  </button>
                  <button
                    className="btn btn-secondary btn-xl"
                    onClick={() => {
                      setKind("damaged");
                      setProblem(l);
                    }}
                    disabled={busy !== null}
                  >
                    <LuTriangleAlert className="h-5 w-5" /> Damaged
                  </button>
                </div>
              )}
              {isPicked && (
                <div className="flex items-center gap-2 border-t border-emerald-100 px-4 py-2.5 text-sm font-semibold text-emerald-700">
                  <LuCircleCheck className="h-5 w-5" /> Picked
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {done && (
        <div className="no-print mt-5 flex flex-col items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <LuCircleCheck className="h-10 w-10 text-emerald-600" />
          <div>
            <p className="text-lg font-semibold text-emerald-900">All items picked</p>
            <p className="text-sm text-emerald-800">Take the tote to the packing station. Every item will be scanned before it goes in the box.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button className="btn btn-primary btn-xl" onClick={() => router.push(`/packing/${o.id}`)}>
              <LuPackageCheck className="h-5 w-5" /> Go to packing
            </button>
            <button className="btn btn-secondary btn-xl" onClick={() => router.push("/picking")}>
              Next order <LuArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <Modal
        open={!!problem}
        onClose={() => setProblem(null)}
        title={kind === "not_found" ? "Can't find this item?" : "Item damaged?"}
        subtitle={problem ? `${problem.name} (${problem.variant}) · bin ${problem.bin}` : ""}
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setProblem(null)}>
              Go back
            </button>
            <button className="btn btn-danger" onClick={report} disabled={busy !== null}>
              Report problem
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          Stock numbers will <b>not</b> change. An issue is opened for the office, and this order is paused until someone decides what to do (recount, other bin,
          transfer, substitute or cancel).
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["not_found", "damaged"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cx("btn", kind === k ? "btn-primary" : "btn-secondary")}>
              {k === "not_found" ? "Not in bin" : "Damaged"}
            </button>
          ))}
        </div>
        <label className="label mt-3" htmlFor="pnote">
          Note (optional)
        </label>
        <input id="pnote" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bin has navy instead of grey" />
      </Modal>
    </div>
  );
}
