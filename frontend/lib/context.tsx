"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { post, setIdentity } from "./api";
import { patchHistoryEvents, useApi } from "./hooks";
import type { Meta } from "./types";

export type Role = "office" | "warehouse";
export const PEOPLE: Record<Role, string> = { office: "Priya (Office)", warehouse: "Ravi (Warehouse)" };

interface RoleCtx {
  role: Role;
  user: string;
  setRole: (r: Role) => void;
  isOffice: boolean;
}
const RoleContext = createContext<RoleCtx>({ role: "office", user: PEOPLE.office, setRole: () => {}, isOffice: true });
export const useRole = () => useContext(RoleContext);

export type WarehouseView = "MAIN" | "SEC";
const WarehouseContext = createContext<{ warehouse: WarehouseView; setWarehouse: (w: WarehouseView) => void }>({
  warehouse: "MAIN",
  setWarehouse: () => {},
});
export const useWarehouse = () => useContext(WarehouseContext);

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastContext);

const MetaContext = createContext<{ meta: Meta | null; reloadMeta: () => void }>({ meta: null, reloadMeta: () => {} });
export const useMeta = () => useContext(MetaContext);

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: role just won't persist */
  }
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>("office");
  const roleRef = useRef<Role>("office");
  const [warehouse, setWarehouse] = useState<WarehouseView>("MAIN");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { data: meta, reload: reloadMeta } = useApi<Meta>("/api/meta");

  useEffect(() => {
    patchHistoryEvents();
    const stored = readStored("fh.role");
    if (stored === "office" || stored === "warehouse") {
      roleRef.current = stored;
      setRoleState(stored);
    }
  }, []);

  useEffect(() => {
    setIdentity({ role, user: PEOPLE[role] });
  }, [role]);

  const setRole = useCallback((r: Role) => {
    const cur = roleRef.current;
    const previous = cur === r ? null : PEOPLE[cur];
    roleRef.current = r;
    setRoleState(r);
    setIdentity({ role: r, user: PEOPLE[r] });
    writeStored("fh.role", r);
    if (previous !== null) post("/api/session", { previous }).catch(() => {});
    window.dispatchEvent(new CustomEvent("fh:changed"));
  }, []);

  const toast = useCallback((text: string, kind: ToastKind = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6500 : 3800);
  }, []);

  const roleValue = useMemo(() => ({ role, user: PEOPLE[role], setRole, isOffice: role === "office" }), [role, setRole]);

  return (
    <RoleContext.Provider value={roleValue}>
      <WarehouseContext.Provider value={{ warehouse, setWarehouse }}>
        <MetaContext.Provider value={{ meta, reloadMeta }}>
          <ToastContext.Provider value={toast}>
            {children}
            <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2 print:hidden">
              {toasts.map((t) => (
                <div
                  key={t.id}
                  role="status"
                  className={
                    "pointer-events-auto rounded-xl border border-l-4 bg-white px-4 py-3 text-sm font-medium text-ink shadow-pop animate-[fhin_.18s_ease-out] " +
                    (t.kind === "error"
                      ? "border-red-200 border-l-red-500"
                      : t.kind === "info"
                        ? "border-slate-200 border-l-navy-500"
                        : "border-emerald-200 border-l-emerald-500")
                  }
                >
                  {t.text}
                </div>
              ))}
            </div>
          </ToastContext.Provider>
        </MetaContext.Provider>
      </WarehouseContext.Provider>
    </RoleContext.Provider>
  );
}
