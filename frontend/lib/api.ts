
export const API_URL = (process.env.NEXTJS_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

type Identity = { role: "office" | "warehouse"; user: string };
let identity: Identity = { role: "office", user: "Priya (Office)" };

export function setIdentity(next: Identity) {
  identity = next;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  data: any;
  constructor(message: string, status: number, code?: string, data?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

function friendlyDetail(body: any, status: number): string {
  const d = body?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((e: any) => {
        const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : "";
        return field ? `${String(field).replace(/_/g, " ")}: ${e.msg}` : e.msg;
      })
      .join("; ");
  }
  if (status === 0) return "Can't reach the server. Is the backend running on " + API_URL + "?";
  return "Something went wrong. Please try again.";
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: opts.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Role": identity.role,
        "X-User": identity.user,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(friendlyDetail(null, 0), 0, "network");
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new ApiError(friendlyDetail(body, res.status), res.status, body?.code, body);
  }
  const method = (opts.method || "GET").toUpperCase();
  if (method !== "GET" && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fh:changed"));
  }
  return body as T;
}

export const post = <T = any>(path: string, body: any = {}) => api<T>(path, { method: "POST", body });
export const patch = <T = any>(path: string, body: any = {}) => api<T>(path, { method: "PATCH", body });
