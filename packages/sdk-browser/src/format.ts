// Words and numbers as RW-1 writes them: "2 Nov 2026 at 11:40 UTC", "340 KB", "1 report" / "5 reports".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function parts(iso: string | number | Date): { d: string; t: string } | null {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return {
    d: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    t: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
  };
}

/** "2 Nov 2026 at 11:40 UTC" */
export function dateTime(iso: string | number | Date): string {
  const p = parts(iso);
  return p ? `${p.d} at ${p.t} UTC` : "";
}

/** "2 Nov 2026" */
export function dateOnly(iso: string | number | Date): string {
  return parts(iso)?.d ?? "";
}

/** "As at 2 Nov 2026, 14:20 UTC." */
export function asAt(now: Date = new Date()): string {
  const p = parts(now)!;
  return `As at ${p.d}, ${p.t} UTC.`;
}

/** "340 KB", "1.4 MB" */
export function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "1 report", "5 reports" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "5,213" */
export function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Escapes text for HTML element content and quoted attributes. Every page-derived string goes through it. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Initials for an avatar: "Ellis Varnholt" → "EV". */
export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  const first = w[0]!.charAt(0);
  const last = w.length > 1 ? w[w.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}
