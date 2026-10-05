"use client";

import Link from "next/link";
import { useState } from "react";
import { LuNotebookPen, LuTruck, LuArrowRightLeft, LuTriangleAlert } from "react-icons/lu";
import { post } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";
import { useToast } from "@/lib/context";
import { fmtWhen, plural } from "@/lib/format";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/EmptyState";
import { SeverityBadge } from "@/components/StatusBadge";

export default function ShiftPage() {
  const { data: s, error, loading, reload } = useApi<any>("/api/shift");
  const toast = useToast();
  const now = useNow();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <PageSkeleton />;
  if (error && !s) return <ErrorState message={error} onRetry={reload} />;
  if (!s) return null;

  async function save() {
    setBusy(true);
    try {
      await post("/api/shift/notes", { note });
      toast("Handover note saved — the next shift will see it here");
      setNote("");
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shift handover"
        subtitle={`What happened in the last ${s.hours} hours and what the next shift must pick up. Replaces the verbal handover where things get forgotten.`}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4">
          <p className="text-[13px] text-ink-muted">Shipped this shift</p>
          <p className="mt-1 text-[28px] font-semibold tabular-nums text-emerald-700">{s.shipped}</p>
        </div>
        <div className="card p-4">
          <p className="text-[13px] text-ink-muted">Received this shift</p>
          <p className="mt-1 text-[28px] font-semibold tabular-nums text-ink">{s.received}</p>
        </div>
        <div className="card p-4">
          <p className="text-[13px] text-ink-muted">Delayed, still open</p>
          <p className="mt-1 text-[28px] font-semibold tabular-nums text-red-600">{s.delayed.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-[13px] text-ink-muted">Open issues</p>
          <p className="mt-1 text-[28px] font-semibold tabular-nums text-ink">{s.open_issue_count}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card card-pad">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Work in progress</h2>
          <ul className="space-y-2">
            {s.in_progress.map((x: any) => (
              <li key={x.stage} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <Link href={`/orders?stage=${x.stage}`} className="text-ink-soft hover:text-ink">
                  {x.label}
                </Link>
                <span className="font-semibold tabular-nums text-ink">{x.count}</span>
              </li>
            ))}
          </ul>
          {s.delayed.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 flex items-center gap-1.5 text-sm font-semibold text-red-700">
                <LuTriangleAlert className="h-4 w-4" /> Delayed orders to chase first
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {s.delayed.map((o: any) => (
                  <Link key={o.id} href={`/orders/${o.id}`} className="chip bg-red-50 text-red-700 ring-red-200">
                    {o.id} · {o.status_label}
                  </Link>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="card card-pad">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Open issues to hand over</h2>
          {s.open_issues.length === 0 ? (
            <EmptyState compact tone="good" title="No open issues" />
          ) : (
            <ul className="divide-y divide-line">
              {s.open_issues.map((i: any) => (
                <li key={i.id} className="flex items-center gap-2 py-2 text-sm">
                  <SeverityBadge severity={i.severity} />
                  <Link href={`/issues?id=${i.id}`} className="min-w-0 flex-1 truncate text-ink-soft hover:text-ink">
                    {i.title}
                  </Link>
                  <span className="shrink-0 text-xs text-ink-muted">{i.assignee}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <LuTruck className="h-4 w-4 text-ink-muted" /> Parcels staged, waiting for courier
          </h2>
          {s.staged_parcels.length === 0 ? (
            <p className="text-sm text-ink-muted">None.</p>
          ) : (
            <p className="text-sm text-ink-soft">
              {plural(s.staged_parcels.length, "parcel")} staged. Next collections:{" "}
              {Array.from(new Set(s.staged_parcels.map((p: any) => `${p.courier_name} ${fmtWhen(p.pickup_at, now)}`)))
                .slice(0, 4)
                .join(" · ")}
            </p>
          )}
          <h2 className="mb-3 mt-5 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <LuArrowRightLeft className="h-4 w-4 text-ink-muted" /> Transfers not yet received
          </h2>
          {s.pending_transfers.length === 0 ? (
            <p className="text-sm text-ink-muted">None.</p>
          ) : (
            <ul className="space-y-1 text-sm text-ink-soft">
              {s.pending_transfers.map((t: any) => (
                <li key={t.id}>
                  <span className="mono font-semibold text-ink">{t.id}</span> · {t.qty} × {t.sku} ({t.status === "in_transit" ? "on its way" : "requested"})
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card card-pad">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <LuNotebookPen className="h-4 w-4 text-ink-muted" /> Note for the next shift
          </h2>
          <textarea
            className="input min-h-[100px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Label printer 2 still jamming. BlueDart said tomorrow's pickup may be late."
          />
          <button className="btn btn-primary mt-2" onClick={save} disabled={busy || !note.trim()}>
            Save handover note
          </button>
          <div className="mt-5 space-y-3">
            {s.notes.length === 0 && <p className="text-sm text-ink-muted">No handover notes yet.</p>}
            {s.notes.map((n: any) => (
              <div key={n.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="text-ink">{n.note}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {n.author} · {fmtWhen(n.created_at, now)} · at the time: {n.snapshot.shipped} shipped, {n.snapshot.open_issues} open issues, {n.snapshot.delayed} delayed
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
