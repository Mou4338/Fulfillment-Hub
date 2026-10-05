
export const TZ = process.env.NEXT_PUBLIC_TZ || "Asia/Kolkata";

const parts = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...opts }).format(d);

function dayKey(d: Date) {
  return parts(d, { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function toDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtTime(iso?: string | null) {
  const d = toDate(iso);
  if (!d) return "—";
  return parts(d, { hour: "numeric", minute: "2-digit", hour12: true }).replace(" am", " AM").replace(" pm", " PM");
}

export function fmtWhen(iso?: string | null, now: Date = new Date()) {
  const d = toDate(iso);
  if (!d) return "—";
  const t = fmtTime(iso);
  const k = dayKey(d);
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + 86400000));
  const yesterday = dayKey(new Date(now.getTime() - 86400000));
  if (k === today) return `Today ${t}`;
  if (k === tomorrow) return `Tomorrow ${t}`;
  if (k === yesterday) return `Yesterday ${t}`;
  return `${parts(d, { weekday: "short", day: "numeric", month: "short" })} ${t}`;
}

export function fmtDateLong(d: Date) {
  return parts(d, { weekday: "long", day: "numeric", month: "long" });
}

export function fmtClock(d: Date) {
  return parts(d, { hour: "numeric", minute: "2-digit", hour12: true }).replace(" am", " AM").replace(" pm", " PM");
}

export function localHour(d: Date) {
  return Number(parts(d, { hour: "numeric", hour12: false }));
}

export function fmtDuration(mins: number) {
  const m = Math.abs(Math.round(mins));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${mm}m`;
  return `${mm}m`;
}

export function minutesUntil(iso?: string | null, now: Date = new Date()) {
  const d = toDate(iso);
  if (!d) return null;
  return (d.getTime() - now.getTime()) / 60000;
}

export function timeLeftLabel(iso?: string | null, now: Date = new Date()) {
  const m = minutesUntil(iso, now);
  if (m === null) return "—";
  return m >= 0 ? `${fmtDuration(m)} left` : `${fmtDuration(m)} late`;
}

export function ago(iso?: string | null, now: Date = new Date()) {
  const m = minutesUntil(iso, now);
  if (m === null) return "—";
  const past = -m;
  if (past < 1) return "just now";
  return `${fmtDuration(past)} ago`;
}

export const inr = (n?: number | null) =>
  n === null || n === undefined ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");

export const plural = (n: number, word: string, pluralWord?: string) => `${n} ${n === 1 ? word : pluralWord || word + "s"}`;

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function dateInput(d: Date | string | null | undefined, addDays = 0): string {
  const base = typeof d === "string" ? toDate(d) : d || new Date();
  if (!base) return "";
  const shifted = new Date(base.getTime() + addDays * 86400000);
  return parts(shifted, { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-");
}
