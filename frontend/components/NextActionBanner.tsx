"use client";

import { LuLock, LuLightbulb, LuArrowRight } from "react-icons/lu";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "@/lib/api";
import { useRole, useToast } from "@/lib/context";
import { cx } from "@/lib/format";
import type { OrderDetail } from "@/lib/types";
import { ConfirmDialog, Modal } from "./Modal";

export function BlockedReason({ reasons, title = "Why is this blocked?" }: { reasons: string[]; title?: string }) {
  if (!reasons.length) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/70 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
        <LuLock className="h-4 w-4" /> {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {reasons.map((r, i) => (
          <li key={i} className="text-sm leading-relaxed text-red-900">
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NextActionBanner({ order, onDone }: { order: OrderDetail; onDone?: () => void }) {
  const na = order.next_action;
  const router = useRouter();
  const toast = useToast();
  const { isOffice } = useRole();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "transfer" | "cancel" | "release">(null);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<number>(na.cta?.qty || 1);

  if (!na?.text) return null;
  const cta = na.cta;
  const blocked = order.blocked_info.blocked;
  const officeOnlyBlocked = !!cta?.office_only && !isOffice;

  async function run(fn: () => Promise<any>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      setConfirm(null);
      onDone?.();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function click() {
    if (!cta) return;
    switch (cta.kind) {
      case "go":
        if (cta.href) router.push(cta.href);
        return;
      case "open_issue":
        router.push(`/issues?id=${cta.issue_id}`);
        return;
      case "process":
        run(() => post(`/api/orders/${order.id}/process`, {}), `${order.id} processed`);
        return;
      case "receive_transfer":
        run(() => post(`/api/transfers/${cta.transfer_id}/receive`), `Transfer ${cta.transfer_id} received — stock moved to Main`);
        return;
      case "create_transfer":
        setQty(cta.qty || 1);
        setConfirm("transfer");
        return;
      case "release_hold":
        setNote("");
        setConfirm("release");
        return;
      case "cancel":
        setNote("");
        setConfirm("cancel");
        return;
    }
  }

  return (
    <>
      <div
        className={cx(
          "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center",
          blocked ? "border-amber-200 bg-amber-50/70" : "border-brand-200 bg-brand-50/70",
        )}
      >
        <div className="flex flex-1 items-start gap-3">
          <span className={cx("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", blocked ? "bg-amber-100 text-amber-800" : "bg-brand-100 text-brand-800")}>
            <LuLightbulb className="h-4 w-4" />
          </span>
          <div>
            <p className={cx("text-xs font-semibold uppercase tracking-wide", blocked ? "text-amber-800" : "text-brand-800")}>Next action</p>
            <p className="mt-0.5 text-[15px] font-medium text-ink">{na.text}</p>
            {officeOnlyBlocked && <p className="mt-1 text-xs text-ink-muted">The office team does this step (switch role in the sidebar to try it).</p>}
          </div>
        </div>
        {cta && (
          <button className="btn btn-primary shrink-0" onClick={click} disabled={busy || officeOnlyBlocked}>
            {busy ? "Working…" : cta.label} <LuArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      <Modal
        open={confirm === "transfer"}
        onClose={() => setConfirm(null)}
        title={`Request transfer of ${cta?.sku}`}
        subtitle="Secondary Warehouse → Main Warehouse"
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || qty < 1}
              onClick={() => run(() => post("/api/transfers", { sku: cta?.sku, qty }), `Transfer requested: ${qty} × ${cta?.sku}`)}
            >
              Request transfer
            </button>
          </>
        }
      >
        <label className="label" htmlFor="tqty">
          Units to move
        </label>
        <input id="tqty" type="number" min={1} className="input" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        <p className="mt-2 text-xs text-ink-muted">The suggested amount covers every order currently waiting for this SKU.</p>
      </Modal>

      <ConfirmDialog
        open={confirm === "release"}
        title="Release hold?"
        message="The order will be processed: courier chosen and stock reserved."
        confirmLabel="Release hold"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run(() => post(`/api/orders/${order.id}/release-hold`, { note }), "Hold released")}
      >
        <label className="label mt-3" htmlFor="rnote">
          What was checked?
        </label>
        <input id="rnote" className="input" placeholder="e.g. Customer confirmed the PIN code" value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "cancel"}
        title={`Cancel ${order.id}?`}
        message="Reserved stock is released. If items were already picked, a return-to-shelf task is created."
        confirmLabel="Cancel order"
        tone="danger"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run(() => post(`/api/orders/${order.id}/cancel`, { reason: note || "Cancelled by office" }), `${order.id} cancelled`)}
      >
        <label className="label mt-3" htmlFor="cnote">
          Reason
        </label>
        <input id="cnote" className="input" placeholder="e.g. Out of stock — customer refunded" value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}
