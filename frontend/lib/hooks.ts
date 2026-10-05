"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export function useApi<T = any>(path: string | null, opts: { poll?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const pathRef = useRef(path);
  pathRef.current = path;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    const my = ++seq.current;
    try {
      const d = await api<T>(p);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e: any) {
      if (my === seq.current) setError(e?.message || "Could not load data");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  const basePath = path ? path.split("?")[0] : null;
  const lastBase = useRef(basePath);
  useEffect(() => {
    if (lastBase.current !== basePath) {
      lastBase.current = basePath;
      seq.current++;
      setData(null);
      setError(null);
    }
    setLoading(!!path);
    load();
  }, [path, basePath, load]);

  useEffect(() => {
    const onChange = () => load();
    const onFocus = () => load();
    window.addEventListener("fh:changed", onChange);
    window.addEventListener("focus", onFocus);
    let timer: any = null;
    if (opts.poll) timer = setInterval(load, opts.poll);
    return () => {
      window.removeEventListener("fh:changed", onChange);
      window.removeEventListener("focus", onFocus);
      if (timer) clearInterval(timer);
    };
  }, [load, opts.poll]);

  return { data, error, loading: loading && !data, reload: load, setData };
}

export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useQueryParams(): [URLSearchParams, (next: Record<string, string | null | undefined>) => void, boolean] {
  const [params, setParams] = useState<URLSearchParams>(() => new URLSearchParams());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sync = () => {
      setParams(new URLSearchParams(window.location.search));
      setReady(true);
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("fh:navigated", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("fh:navigated", sync);
    };
  }, []);
  const update = useCallback((next: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams(window.location.search);
    Object.entries(next).forEach(([k, v]) => {
      if (v === null || v === undefined || v === "") p.delete(k);
      else p.set(k, v);
    });
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? "?" + qs : ""));
  }, []);
  return [params, update, ready];
}

let historyPatched = false;
export function patchHistoryEvents() {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;
  (["pushState", "replaceState"] as const).forEach((m) => {
    const orig = window.history[m].bind(window.history);
    (window.history as any)[m] = (...args: any[]) => {
      const r = (orig as any)(...args);
      queueMicrotask(() => window.dispatchEvent(new Event("fh:navigated")));
      return r;
    };
  });
}
