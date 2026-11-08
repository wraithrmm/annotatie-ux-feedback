// What the widget shows about a report, from the API's Item: RW-1's status tone map, the report type,
// and the sentences the panels write.
import type { Item, ItemStatus } from "@annotatie/core";
import { esc } from "../format.js";
import { mi } from "./icons.js";

export type Tone = "open" | "answered" | "progress" | "resolved" | "closed";
export const TYPES = ["Bug", "Feature", "Question"] as const;
export type ReportType = (typeof TYPES)[number];

export const STATUS: Record<Tone, { word: string; tone: "neutral" | "info" | "success"; icon: string }> = {
  open: { word: "Open", tone: "neutral", icon: "minus-circle" },
  answered: { word: "Answered", tone: "info", icon: "chat" },
  progress: { word: "In progress", tone: "neutral", icon: "clock" },
  resolved: { word: "Resolved", tone: "success", icon: "check" },
  closed: { word: "Closed", tone: "success", icon: "check" },
};

/** The API's seven statuses on RW-1's tones: "waiting on user" reads as Answered, "waiting on us" as Open. */
export function toneOf(status: ItemStatus): Tone {
  switch (status) {
    case "answered":
    case "waiting_on_user":
      return "answered";
    case "in_progress":
      return "progress";
    case "resolved":
      return "resolved";
    case "closed":
      return "closed";
    default:
      return "open";
  }
}

export const statusTag = (status: ItemStatus, small = false): string => {
  const s = STATUS[toneOf(status)];
  const cls = s.tone === "neutral" ? "" : ` tag--${s.tone}`;
  return `<span class="tag${cls}${small ? " tag--sm" : ""}">${mi(s.icon)}${s.word}</span>`;
};

/**
 * The widget route takes no report type (docs/api.md §3), so the type travels as the title's prefix:
 * "Bug: The export opens nothing". Titles without a known prefix have no type.
 */
export function makeTitle(type: ReportType, body: string): string {
  const first = body.replace(/\s+/g, " ").trim();
  const room = 200 - type.length - 2;
  return `${type}: ${first.length > room ? `${first.slice(0, room - 1).trimEnd()}…` : first}`;
}

export function splitTitle(title: string): { type?: ReportType; text: string } {
  const m = /^(Bug|Feature|Question):\s*/.exec(title);
  if (!m) return { text: title };
  return { type: m[1] as ReportType, text: title.slice(m[0].length) };
}

/** Resolved or closed: done, so its pin is hidden unless Show resolved pins is ticked. */
export const isResolved = (i: Item) => i.status === "resolved" || i.status === "closed";

export const pageName = (i: Item, fallback = "this page"): string => i.page?.title?.trim() || i.page?.path || fallback;

/** Unresolved first, then newest first (RW-1 state 27). */
export function listOrder(items: Item[]): Item[] {
  return items.slice().sort((a, b) => Number(isResolved(a)) - Number(isResolved(b)) || b.number - a.number);
}

export function samePath(item: Item, path: string): boolean {
  return (item.page?.path ?? "") === path;
}

export { esc };
