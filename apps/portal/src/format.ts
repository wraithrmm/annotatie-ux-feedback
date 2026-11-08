// Plain-English formatting helpers (en-GB).

import type { Item, ItemStatus } from "@annotatie/core";

export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return date(iso);
}

export function date(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function clock(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  open: "Open",
  answered: "Answered",
  in_progress: "In progress",
  waiting_on_us: "Waiting on us",
  waiting_on_user: "Waiting on user",
  resolved: "Resolved",
  closed: "Closed",
};

export const STATUS_CLASS: Record<ItemStatus, string> = {
  open: "t-open",
  answered: "t-answered",
  in_progress: "t-progress",
  waiting_on_us: "t-progress",
  waiting_on_user: "t-answered",
  resolved: "t-resolved",
  closed: "t-resolved",
};

/** "Report 41" or "Q-3". */
export function itemRef(it: Pick<Item, "kind" | "number">): string {
  if (it.kind === "decision") return `Q-${it.number}`;
  if (it.kind === "conversation") return `Conversation ${it.number}`;
  return `Report ${it.number}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function itemType(it: Item): string {
  return it.labels[0] ?? (it.kind === "report" ? "Report" : it.kind === "decision" ? "Question" : "Conversation");
}
