"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LuArrowLeft, LuCircleCheck, LuCircleX, LuScanLine, LuRotateCcw, LuTag, LuScale, LuPackage, LuTruck, LuTriangleAlert, LuArrowRight,
} from "react-icons/lu";
import { post } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";
import { useMeta, useToast } from "@/lib/context";
import { cx, fmtWhen } from "@/lib/format";
import type { OrderDetail } from "@/lib/types";
import { ErrorState, PageSkeleton } from "@/components/EmptyState";
import { PriorityBadge, TimeLeft } from "@/components/StatusBadge";
import { BlockedReason } from "@/components/NextActionBanner";

interface ScanResult {
  ok: boolean;
  kind: string;
  message: string;
}

export default function PackOrderPage() {
  const { id } = useParams() as { id: string };
  const { data: o, error, loading, reload, setData } = useApi<OrderDetail>(`/api/packing/${id}`);
  const { meta } = useMeta();
  const now = useNow();
  const toast = useToast();
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [feedback, setFeedback] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pkgType, setPkgType] = useState("");
  const [weight, setWeight] = useState("");
  const [label, setLabel] = useState("");
  const [weightWarn, setWeightWarn] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; lane?: string; courier?: string } | null>(null);

  useEffect(() => {
    if (o && !pkgType && o.suggested_package_type) {
      setPkgType(o.suggested_package_type);
      const w = o.expected_weight_by_type?.[o.suggested_package_type];
      if (w) setWeight(w.toFixed(2));
    }
  }, [o, pkgType]);

  useEffect(() => {
    scanRef.current?.focus();
  }, [o?.id]);

  if (loading) return <PageSkeleton />;
  if (error && !o) return <ErrorState message={error} onRetry={reload} />;
  if (!o) return null;

  const total = o.line_items.reduce((s, l) => s + l.qty, 0);
  const verified = o.line_items.reduce((s, l) => s + Math.min(l.verified_qty, l.qty), 0);
  const allVerified = verified === total && total > 0;
  const atStation = o.status === "READY_TO_PACK";

  async function scan(e?: React.FormEvent) {
    e?.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await post<{ result: ScanResult; order: OrderDetail }>(`/api/packing/${o!.id}/scan`, { code: code.trim() });
      setFeedback(r.result);
      setData(r.order);
      setCode("");
    } catch (err: any) {
      setFeedback({ ok: false, kind: "error", message: err.message });
    } finally {
      setBusy(false);
      setTimeout(() => scanRef.current?.focus(), 10);
    }
  }

  async function reset() {
    try {
      setData(await post<OrderDetail>(`/api/packing/${o!.id}/reset`));
      setFeedback(null);
      scanRef.current?.focus();
    } catch (err: any) {
      toast(err.message, "error");
    }
  }

  async function complete(confirmWeight = false) {
    setBusy(true);
    setLabelError(null);
    try {
      const r = await post<{ ok: boolean; message?: string; package?: any; order: OrderDetail }>(`/api/packing/${o!.id}/complete`, {
        package_type: pkgType,
        weight_kg: Number(weight),
        label_code: label,
        confirm_weight: confirmWeight,
      });
      if (!r.ok) {
        setLabelError(r.message || "Label check failed");
        setData({ ...o!, ...r.order, suggested_package_type: o!.suggested_package_type, expected_weight_by_type: o!.expected_weight_by_type });
        return;
      }
      setWeightWarn(null);
      setResult({ id: r.package.id, lane: r.order.courier?.lane, courier: r.order.courier?.name });
      toast(`Packed as ${r.package.id}`);
    } catch (err: any) {
      if (err.code === "weight_mismatch") setWeightWarn(err.message);
      else toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-xl pt-6">
        <div className="card flex flex-col items-center gap-4 p-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <LuCircleCheck className="h-9 w-9" />
          </span>
          <div>
            <p className="text-sm text-ink-muted">{o.id} packed and verified</p>
            <p className="mono mt-1 text-3xl font-bold text-ink">{result.id}</p>
          </div>
          <div className="w-full rounded-xl bg-slate-50 p-4 text-left text-sm">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <LuTruck className="h-4 w-4" /> Next: place it at <span className="text-brand-700">{result.lane}</span>
            </p>
            <p className="mt-1 text-ink-muted">Staging location tells everyone exactly where the box is until {result.courier} collects it.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <button className="btn btn-primary btn-xl flex-1" onClick={() => router.push(`/staging?package=${result.id}`)}>
              Stage package <LuArrowRight className="h-5 w-5" />
            </button>
            <button className="btn btn-secondary btn-xl" onClick={() => router.push("/packing")}>
              Next order
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/packing" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <LuArrowLeft className="h-4 w-4" /> Packing queue
      </Link>

      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm text-ink-muted">Packing station</p>
          <h1 className="mono text-3xl font-bold text-ink">{o.id}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {o.customer_name} · {o.courier_name}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <PriorityBadge priority={o.priority} size="lg" />
          <span className="text-sm text-ink-muted">Ship by {fmtWhen(o.ship_by, now)}</span>
          <TimeLeft shipBy={o.ship_by} risk={o.risk} now={now} className="text-sm" />
        </div>
      </div>

      {!atStation && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This order is <b>{o.status_label.toLowerCase()}</b>. Items can only be verified here after picking is complete. {o.next_action.text}
        </div>
      )}
      {o.blocked_info.blocked && (
        <div className="mb-4">
          <BlockedReason reasons={o.blocked_info.reasons} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Step 1: scan items */}
        <div className="space-y-4 lg:col-span-3">
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-white">1</span> Scan every item
              </h2>
              <span className="text-sm font-semibold tabular-nums text-ink-soft">
                {verified} / {total} verified
              </span>
            </div>
            <form onSubmit={scan} className="flex gap-2">
              <div className="relative flex-1">
                <LuScanLine className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" />
                <input
                  ref={scanRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  disabled={!atStation || allVerified}
                  placeholder={allVerified ? "All items verified" : "Scan barcode or type SKU, then Enter"}
                  className="input mono h-[52px] rounded-xl pl-11 text-lg"
                  aria-label="Scan SKU"
                  autoComplete="off"
                />
              </div>
              <button className="btn btn-primary btn-xl" disabled={!atStation || busy || allVerified || !code.trim()}>
                Scan
              </button>
            </form>

            {feedback && (
              <div
                role="alert"
                className={cx(
                  "mt-3 flex items-start gap-3 rounded-xl border-2 p-4",
                  feedback.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-400 bg-red-50 text-red-900",
                )}
              >
                {feedback.ok ? <LuCircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" /> : <LuCircleX className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />}
                <div>
                  <p className="text-base font-bold">{feedback.ok ? "Correct item" : "Stop — do not pack this item"}</p>
                  <p className="text-sm">{feedback.message}</p>
                </div>
              </div>
            )}
            {!feedback && o.last_scan_error && (
              <div className="mt-3 flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-900">
                <LuCircleX className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
                <div>
                  <p className="text-base font-bold">Last scan didn&apos;t match</p>
                  <p className="text-sm">{o.last_scan_error}</p>
                </div>
              </div>
            )}

            <ul className="mt-4 space-y-2">
              {o.line_items.map((l) => {
                const ok = l.verified_qty >= l.qty;
                return (
                  <li key={l.id} className={cx("flex items-center gap-3 rounded-xl border p-3", ok ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200")}>
                    <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", ok ? "bg-emerald-500 text-white" : "bg-slate-100 text-ink-muted")}>
                      {ok ? <LuCircleCheck className="h-5 w-5" /> : <LuScanLine className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{l.name}</p>
                      <p className="text-sm text-ink-muted">
                        <span className="chip mr-1.5 bg-sky-50 text-sky-800 ring-sky-200">{l.variant}</span>
                        <span className="mono">{l.sku}</span>
                      </p>
                    </div>
                    <span className={cx("text-lg font-bold tabular-nums", ok ? "text-emerald-700" : "text-ink")}>
                      {l.verified_qty}/{l.qty}
                    </span>
                  </li>
                );
              })}
            </ul>
            {atStation && verified > 0 && (
              <button className="btn btn-ghost mt-3 text-xs" onClick={reset}>
                <LuRotateCcw className="h-3.5 w-3.5" /> Start over (clear scans)
              </button>
            )}
          </div>
        </div>

        {/* Step 2: box, weight, label */}
        <div className="lg:col-span-2">
          <div className={cx("card p-5", !allVerified && "opacity-60")}>
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-ink">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-white">2</span> Box, weigh & label
            </h2>
            <fieldset disabled={!allVerified || !atStation || busy} className="space-y-4">
              <div>
                <label className="label" htmlFor="ptype">
                  <LuPackage className="mr-1 inline h-3.5 w-3.5" /> Package type
                </label>
                <select
                  id="ptype"
                  className="input"
                  value={pkgType}
                  onChange={(e) => {
                    setPkgType(e.target.value);
                    setWeightWarn(null);
                  }}
                >
                  {Object.keys(meta?.package_types || { [pkgType]: 1 }).map((t) => (
                    <option key={t} value={t}>
                      {t}
                      {t === o.suggested_package_type ? " (suggested)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="weight">
                  <LuScale className="mr-1 inline h-3.5 w-3.5" /> Weight from scale (kg)
                </label>
                <input
                  id="weight"
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={weight}
                  onChange={(e) => {
                    setWeight(e.target.value);
                    setWeightWarn(null);
                  }}
                />
                <p className="mt-1 text-xs text-ink-muted">Expected about {o.expected_weight_by_type?.[pkgType]?.toFixed(2) ?? "—"} kg</p>
              </div>
              <div>
                <label className="label" htmlFor="label">
                  <LuTag className="mr-1 inline h-3.5 w-3.5" /> Scan the label stuck on the box
                </label>
                <input
                  id="label"
                  className={cx("input mono", labelError && "border-red-400 ring-2 ring-red-500/20")}
                  value={label}
                  onChange={(e) => {
                    setLabel(e.target.value.toUpperCase());
                    setLabelError(null);
                  }}
                  placeholder="LBL-…"
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-ink-muted">
                  Printed label for this order: <span className="mono font-semibold text-ink-soft">{o.label_code}</span>
                </p>
              </div>

              {labelError && (
                <div className="flex gap-2 rounded-xl border-2 border-red-400 bg-red-50 p-3 text-sm text-red-900">
                  <LuCircleX className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  <span>
                    <b>Wrong label.</b> {labelError}
                  </span>
                </div>
              )}
              {weightWarn && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="flex gap-2">
                    <LuTriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /> {weightWarn}
                  </p>
                  <button type="button" className="btn btn-warn mt-2 w-full" onClick={() => complete(true)}>
                    Contents checked — confirm weight
                  </button>
                </div>
              )}

              <button type="button" className="btn btn-primary btn-xl w-full" onClick={() => complete(false)} disabled={!label.trim() || !weight || !pkgType}>
                <LuCircleCheck className="h-5 w-5" /> {busy ? "Checking…" : "Verify label & finish packing"}
              </button>
            </fieldset>
            {!allVerified && atStation && <p className="mt-3 text-center text-xs text-ink-muted">Scan all items first — the box can&apos;t be closed until every unit is verified.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
