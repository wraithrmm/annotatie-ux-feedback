// The shared vocabulary of Annotatie: every service, the portal, the widget and the MCP server use
// these shapes. The HTTP routes that carry them are listed in docs/api.md.

export type Role = "owner" | "member" | "viewer";
export type ItemKind = "report" | "conversation" | "decision";
export type ItemStatus =
  | "open"
  | "answered"
  | "in_progress"
  | "waiting_on_us"
  | "waiting_on_user"
  | "resolved";
export type Visibility = "internal" | "user";
export type MessageState = "draft" | "published" | "rejected";

export const ITEM_STATUSES: readonly ItemStatus[] = [
  "open",
  "answered",
  "in_progress",
  "waiting_on_us",
  "waiting_on_user",
  "resolved",
];

/** Agent scopes (consent screen and personal access tokens). There is deliberately no publish scope. */
/** "sites": create sites, allow their origins and register their site keys (installing the widget). */
export const AGENT_SCOPES = ["read", "reply", "reply:user", "status", "decide", "capture:read", "sites"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export interface Person {
  id: string;
  name: string;
  email?: string;
}

/** Who wrote something. `user` is a person on a host site; `team` is one of us (or an agent acting as us). */
export interface Author {
  kind: "team" | "user";
  id: string;
  name: string;
}

/** How a write was made. Portal-only detail: never returned by the widget API. */
export interface Via {
  kind: "portal" | "agent" | "token" | "widget";
  /** OAuth client name ("Claude Code on WORKSTATION-7") or token name. */
  clientName?: string;
  clientId?: string;
  /** Question asker name and session, for questions. */
  asker?: string;
  session?: string;
}

export interface Site {
  id: string;
  name: string;
  /** Exact origins the widget may run on, e.g. "https://app.example.com". */
  origins: string[];
  autoApprove: boolean;
  /** ISO time auto-approve switches itself off; null = no limit (Q7). */
  autoApproveUntil: string | null;
  /** Days a capture is kept after its report is resolved (default 90). */
  retentionDays: number;
  privacyMode: boolean;
  createdAt: string;
  /** The caller's role on this site (portal reads only). */
  role?: Role;
  counts?: SiteCounts;
}

export interface SiteCounts {
  open: number;
  drafts: number;
  decisions: number;
  unanswered: number;
}

export interface SiteKey {
  kid: string;
  /** Ed25519 public key as a JWK ({ kty: "OKP", crv: "Ed25519", x }). */
  publicKeyJwk: { kty: "OKP"; crv: "Ed25519"; x: string };
  status: "active" | "retired";
  createdAt: string;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  addedAt: string;
}

export interface PageRef {
  url: string;
  path: string;
  title?: string;
  route?: string;
}

/** RW-1 §4: how a pin finds its element again. */
export interface Anchor {
  selector: string;
  /** Human-readable description of the part ("Button "Save" in "Contact details""). */
  label?: string;
  /** Pin position relative to the element's box, 0..1. */
  offset?: { x: number; y: number };
  /** Fallback point in page coordinates. */
  point?: { x: number; y: number };
}

export interface DecisionOption {
  label: string;
  text: string;
  consequence?: string;
}

export interface Decision {
  question: string;
  context?: string;
  options: DecisionOption[];
  recommendation?: string;
  blocking: boolean;
  /** Set for questions an agent asked (agent-plugin-design.md §3). */
  asker?: { name: string; session?: string };
  status: "waiting" | "answered" | "withdrawn";
  answer?: { option?: string; text?: string; by: Person; at: string };
  withdrawnReason?: string;
}

export type CaptureFile = "page" | "pageMarked" | "closeup" | "html";

export interface CaptureContext {
  url: string;
  route?: string;
  title?: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  scroll: { x: number; y: number };
  userAgent?: string;
  buildId?: string;
  capturedAt: string;
  /** "dom" (method A, drawn from the DOM) or "screen" (method B, getDisplayMedia). */
  method: "dom" | "screen" | "none";
  masked?: { fields: number; elements: number };
  notes?: string[];
}

export interface PartRecord {
  selector: string;
  label?: string;
  box: { page: Rect; screenshot: Rect };
  role?: string;
  name?: string;
  text?: string;
  outerHTML?: string;
  ancestors?: string[];
  styles?: Record<string, string>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Capture {
  context: CaptureContext;
  part?: PartRecord;
  /** Files that were uploaded and confirmed, with their sizes in bytes. */
  files: Partial<Record<CaptureFile, { size: number }>>;
  confirmed: boolean;
}

export interface Item {
  id: string;
  siteId: string;
  /** Per-site number, shown as #12 (or Q-12 for questions). */
  number: number;
  kind: ItemKind;
  title: string;
  status: ItemStatus;
  page?: PageRef;
  anchor?: Anchor;
  reporter?: Author;
  labels: string[];
  links: string[];
  decision?: Decision;
  capture?: Capture;
  counts: { messages: number; drafts: number };
  createdAt: string;
  updatedAt: string;
  /** Last time a host-site user wrote on it. */
  lastUserMessageAt?: string;
  /** Last time the team published a user-visible message on it. */
  lastTeamReplyAt?: string;
}

export interface Message {
  id: string;
  itemId: string;
  siteId: string;
  author: Author;
  /** Markdown; rendered with a strict sanitiser, never as raw HTML. */
  body: string;
  visibility: Visibility;
  state: MessageState;
  createdAt: string;
  editedAt?: string;
  publishedAt?: string;
  /** M2: the widget shows the message only from this time (approve + 10 s). */
  releaseAt?: string;
  approvedBy?: Person;
  autoApproved?: boolean;
  rejectedReason?: string;
  rejectedBy?: Person;
  /** Portal and agents only. */
  via?: Via;
}

export type EventType =
  | "item.created"
  | "item.updated"
  | "message.created"
  | "message.published"
  | "message.unpublished"
  | "message.rejected"
  | "decision.answered"
  | "question.asked"
  | "question.answered"
  | "question.withdrawn"
  | "site.updated"
  | "site.auto_approve"
  | "site.key"
  | "site.member";

/** One entry of a site's log: both the audit trail and the feed behind get_changes. */
export interface LogEvent {
  id: string;
  siteId: string;
  at: string;
  type: EventType;
  itemId?: string;
  messageId?: string;
  actor: Author;
  via?: Via;
  detail?: Record<string, unknown>;
}

export interface PersonalAccessToken {
  id: string;
  name: string;
  sites: string[];
  scopes: AgentScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
}

export interface AgentGrant {
  grantId: string;
  clientId: string;
  clientName: string;
  sites: string[];
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface Preferences {
  /** Quiet hours in the user's time zone; null = none. Blocking questions ignore them. */
  quietHours: { start: string; end: string; timeZone: string } | null;
  push: { drafts: boolean; decisions: boolean };
}

/** Portal home (PT-1/PT-2 "Attention"). */
export interface Attention {
  drafts: Array<{ site: Pick<Site, "id" | "name">; item: Item; message: Message }>;
  decisions: Array<{ site: Pick<Site, "id" | "name">; item: Item }>;
  newFromUsers: Array<{ site: Pick<Site, "id" | "name">; item: Item; message: Message }>;
  unanswered: Array<{ site: Pick<Site, "id" | "name">; item: Item }>;
}
