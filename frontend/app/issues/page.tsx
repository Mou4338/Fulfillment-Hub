"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LuPlus, LuCircleCheck, LuX, LuUser, LuLock, LuPlay, LuFlag } from "react-icons/lu";
import { api, patch, post } from "@/lib/api";
import { useApi, useNow, useQueryParams } from "@/lib/hooks";
import { useMeta, useRole, useToast } from "@/lib/context";
import { cx, fmtWhen } from "@/lib/format";
import type { Issue } from "@/lib/types";
import { PageHeader } from "@/components/AppShell";
import { EmptyState, ErrorState, Skeleton } from "@/components/EmptyState";
import { FilterBar, SearchInput, Select, Tabs } from "@/components/FilterBar";
import { IssueCard } from "@/components/IssueCard";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { OrderTimeline } from "@/components/OrderTimeline";
import { IssueStatusBadge, SeverityBadge } from "@/components/StatusBadge";

const TEAMS = ["Office team", "Warehouse team", "Packing station", "Priya (Office)", "Arjun (Office)", "Ravi (Warehouse)", "Meena (Warehouse)"];

export default function IssuesPage() {
  const [params, setParams, ready] = useQueryParams();
  const { meta } = useMeta();
  const now = useNow();
  const status = params.has("status") ? params.get("status")! : "open";
  const selectedId = params.get("id");
  const [q, setQ] = useState("");
  const qs = new URLSearchParams();
  if (status !== "all") qs.set("status", status);
  if (params.get("type")) qs.set("type", params.get("type")!);
  if (params.get("severity")) qs.set("severity", params.get("severity")!);
  if (q) qs.set("q", q);
  const { data, error, loading, reload } = useApi<Issue[]>(ready ? `/api/issues?${qs.toString()}` : null, { poll: 30000 });
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title="Issues"
        subtitle="Every problem on the floor becomes a tracked record with an owner and a history — nothing gets forgotten."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <LuPlus className="h-4 w-4" /> Report issue
          </button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs
          value={status}
          onChange={(v) => setParams({ status: v === "open" ? null : v })}
          tabs={[
            { value: "open", label: "Needs action" },
            { value: "In Progress", label: "In progress" },
            { value: "Resolved", label: "Resolved" },
            { value: "all", label: "All" },
          ]}
        />
        <FilterBar active={!!(params.get("type") || params.get("severity") || q)} onReset={() => { setQ(""); setParams({ type: null, severity: null }); }}>
          <Select label="Type" value={params.get("type") || ""} onChange={(v) => setParams({ type: v })} options={[{ value: "", label: "All types" }, ...(meta?.issue_types || []).map((t) => ({ value: t, label: t }))]} />
          <Select label="Severity" value={params.get("severity") || ""} onChange={(v) => setParams({ severity: v })} options={[{ value: "", label: "Any severity" }, ...(meta?.severities || []).map((t) => ({ value: t, label: t }))]} />
          <SearchInput value={q} onChange={setQ} placeholder="Search issues" className="w-full sm:w-56" />
        </FilterBar>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className={cx("space-y-2 lg:col-span-2", selectedId && "hidden lg:block")}>
          {loading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          {error && !data && <ErrorState message={error} onRetry={reload} />}
          {data && data.length === 0 && (
            <div className="card">
              <EmptyState tone="good" icon={LuCircleCheck} title={status === "open" ? "No open issues — nice work" : "No issues match"} />
            </div>
          )}
          {data?.map((i) => (
            <IssueCard key={i.id} issue={i} now={now} active={i.id === selectedId} onClick={() => setParams({ id: i.id })} />
          ))}
        </div>
        <div className={cx("lg:col-span-3", !selectedId && "hidden lg:block")}>
          {selectedId ? (
            <IssueDetail id={selectedId} onClose={() => setParams({ id: null })} onChanged={reload} />
          ) : (
            <div className="card sticky top-20">
              <EmptyState icon={LuFlag} title="Select an issue" hint="Details, history and the actions that fix it appear here." />
            </div>
          )}
        </div>
      </div>

      <NewIssueModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setParams({ id }); reload(); }} />
    </div>
  );
}

function IssueDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data: i, error, loading, reload } = useApi<Issue>(`/api/issues/${id}`);
  const { isOffice } = useRole();
  const toast = useToast();
  const now = useNow();
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const [sub, setSub] = useState<{ open: boolean; options: string[]; sku: string }>({ open: false, options: [], sku: "" });
  const [pending, setPending] = useState<{ key: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setResolution("");
    setResolving(false);
  }, [id]);

  if (loading) return <Skeleton className="h-96" />;
  if (error && !i) return <ErrorState message={error} onRetry={reload} />;
  if (!i) return null;

  async function run(fn: () => Promise<any>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      setResolving(false);
      setPending(null);
      setSub({ open: false, options: [], sku: "" });
      reload();
      onChanged();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function startSubstitute() {
    const base = (i!.sku || "").split("-").slice(0, 2).join("-");
    try {
      const rows = await api<any[]>(`/api/inventory?q=${encodeURIComponent(base)}`);
      const options = rows.filter((r) => r.sku !== i!.sku && r.main.available > 0).map((r) => `${r.sku}|${r.variant} · ${r.main.available} available`);
      setSub({ open: true, options, sku: options[0]?.split("|")[0] || "" });
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  const resolved = i.status === "Resolved";
  const canResolve = isOffice || i.type === "Return to Shelf";

  return (
    <div className="card sticky top-20 overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-sm font-semibold text-ink-muted">{i.id}</span>
            <SeverityBadge severity={i.severity} />
            <IssueStatusBadge status={i.status} />
            {i.blocking && !resolved && (
              <span className="chip bg-red-50 text-red-700 ring-red-200">
                <LuLock className="h-3 w-3" /> Blocks the order
              </span>
            )}
          </div>
          <h2 className="mt-2 text-lg font-semibold leading-snug text-ink">{i.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {i.type} · opened {fmtWhen(i.created_at, now)} by {i.created_by}
          </p>
        </div>
        <button className="btn btn-ghost px-2" onClick={onClose} aria-label="Close">
          <LuX className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-6 p-5">
        {i.description && <p className="text-sm leading-relaxed text-ink-soft">{i.description}</p>}

        <div className="grid grid-cols-2 gap-3 text-sm">
          {i.order_id && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-ink-muted">Order</p>
              <Link href={`/orders/${i.order_id}`} className="link mono">
                {i.order_id}
              </Link>
            </div>
          )}
          {i.package_id && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-ink-muted">Package</p>
              <p className="mono font-semibold text-ink">{i.package_id}</p>
            </div>
          )}
          {i.sku && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-ink-muted">Product</p>
              <Link href={`/inventory?q=${i.sku}`} className="link mono">
                {i.sku}
              </Link>
              <p className="text-xs text-ink-muted">{i.product_name}</p>
            </div>
          )}
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-ink-muted">Owner</p>
            {resolved ? (
              <p className="font-semibold text-ink">{i.assignee || "—"}</p>
            ) : (
              <select
                className="w-full bg-transparent font-semibold text-ink focus:outline-none"
                value={i.assignee || ""}
                onChange={(e) => run(() => patch(`/api/issues/${i.id}`, { assignee: e.target.value }), `Assigned to ${e.target.value}`)}
                aria-label="Assign issue"
              >
                {[i.assignee || "", ...TEAMS.filter((t) => t !== i.assignee)].filter(Boolean).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {resolved && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p className="font-semibold">Resolved {fmtWhen(i.resolved_at, now)}</p>
            <p>{i.resolution}</p>
          </div>
        )}

        {!resolved && (
          <div className="space-y-3">
            {i.actions.length > 0 && (
              <div>
                <p className="section-title mb-2">What happened?</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {i.actions.map((a) => {
                    const disabled = busy || (a.office_only && !isOffice);
                    return (
                      <button
                        key={a.key}
                        disabled={disabled}
                        title={a.office_only && !isOffice ? "Office team only" : ""}
                        className={cx("btn btn-xl justify-start", a.key === "found" ? "btn-primary" : a.key === "cancel_order" ? "btn-secondary text-red-600" : "btn-secondary")}
                        onClick={() => {
                          if (a.key === "found") run(() => post(`/api/issues/${i.id}/pick-action`, { action: "found" }), "Line released — it can be picked again");
                          else if (a.key === "substitute") startSubstitute();
                          else setPending(a);
                        }}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {i.status === "Open" && (
                <button className="btn btn-secondary" disabled={busy} onClick={() => run(() => patch(`/api/issues/${i.id}`, { status: "In Progress" }), "Marked in progress")}>
                  <LuPlay className="h-4 w-4" /> Start working on it
                </button>
              )}
              {i.actions.length === 0 && (
                <button className="btn btn-primary" disabled={busy || !canResolve} onClick={() => setResolving(true)} title={canResolve ? "" : "Office team only"}>
                  <LuCircleCheck className="h-4 w-4" /> Resolve
                </button>
              )}
            </div>
            {!canResolve && i.actions.length === 0 && <p className="text-xs text-ink-muted">The office team resolves issues. You can mark it in progress or reassign it.</p>}
          </div>
        )}

        <div>
          <p className="section-title mb-3">History</p>
          <OrderTimeline rows={i.timeline || []} />
        </div>
      </div>

      <ConfirmDialog
        open={resolving}
        title={`Resolve ${i.id}?`}
        message={i.type === "Return to Shelf" ? "Confirm the items are back in their bins. Stock will be added back to the Main Warehouse." : "Add what was done so the next person understands."}
        confirmLabel="Resolve issue"
        busy={busy}
        onCancel={() => setResolving(false)}
        onConfirm={() => run(() => post(`/api/issues/${i.id}/resolve`, { resolution }), `${i.id} resolved`)}
      >
        <label className="label mt-3" htmlFor="res">
          Resolution note
        </label>
        <textarea id="res" className="input min-h-[80px]" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="e.g. Customer confirmed PIN by phone" />
      </ConfirmDialog>

      <ConfirmDialog
        open={!!pending}
        title={pending?.label || ""}
        tone={pending?.key === "cancel_order" ? "danger" : "primary"}
        message={
          pending?.key === "confirm_missing"
            ? "The missing units are written off Main Warehouse stock (logged with this issue), and the order line is re-planned — it will be picked from other stock or wait for a transfer."
            : "The order is cancelled. Picked items get a return-to-shelf task."
        }
        confirmLabel={pending?.label}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && run(() => post(`/api/issues/${i.id}/pick-action`, { action: pending.key }), "Done — order updated")}
      />

      <Modal
        open={sub.open}
        onClose={() => setSub({ ...sub, open: false })}
        title="Substitute with another variant"
        subtitle="Only for products marked substitutable. The customer should be informed."
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setSub({ ...sub, open: false })}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!sub.sku || busy} onClick={() => run(() => post(`/api/issues/${i.id}/pick-action`, { action: "substitute", substitute_sku: sub.sku }), `Substituted with ${sub.sku}`)}>
              Substitute
            </button>
          </>
        }
      >
        {sub.options.length === 0 ? (
          <p className="text-sm text-ink-muted">No other variant of this product has stock available.</p>
        ) : (
          <select className="input" value={sub.sku} onChange={(e) => setSub({ ...sub, sku: e.target.value })}>
            {sub.options.map((o) => (
              <option key={o} value={o.split("|")[0]}>
                {o.replace("|", " — ")}
              </option>
            ))}
          </select>
        )}
      </Modal>
    </div>
  );
}

function NewIssueModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { meta } = useMeta();
  const toast = useToast();
  const [form, setForm] = useState({ type: "Other", severity: "Medium", title: "", description: "", order_id: "", sku: "", blocking: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm({ type: "Other", severity: "Medium", title: "", description: "", order_id: "", sku: "", blocking: false });
  }, [open]);
  async function submit() {
    setBusy(true);
    try {
      const r = await post<Issue>("/api/issues", {
        ...form,
        order_id: form.order_id.trim() || null,
        sku: form.sku.trim() || null,
      });
      toast(`${r.id} opened`);
      onCreated(r.id);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report an issue"
      subtitle="Anything that could stop an order shipping correctly or on time."
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || form.title.trim().length < 3}>
            Open issue
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Type</label>
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {(meta?.issue_types || ["Other"]).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Severity</label>
          <select className="input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            {(meta?.severities || ["Low", "Medium", "High", "Critical"]).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Title</label>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Short summary" data-autofocus />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Details</label>
          <textarea className="input min-h-[80px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className="label">Order ID (optional)</label>
          <input className="input mono" value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value.toUpperCase() })} placeholder="FH-…" />
        </div>
        <div>
          <label className="label">SKU (optional)</label>
          <input className="input mono" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-soft sm:col-span-2">
          <input type="checkbox" checked={form.blocking} onChange={(e) => setForm({ ...form, blocking: e.target.checked })} className="h-4 w-4 accent-brand-600" />
          Stop this order from shipping until resolved
        </label>
      </div>
    </Modal>
  );
}
