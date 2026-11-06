// In-memory mock of the Annotatie API and token endpoint, for development and the Playwright specs.
// Loaded only with ?mock=1 in a dev or e2e build (see main.tsx); a production build doesn't contain it.
// It implements the approval gate visibly: approve -> published with releaseAt +10 s, undo within the
// window, reject with a reason, auto-approve on/off, and an agent reply that waits as a draft.
// Synthetic data only.

import type {
  AgentGrant,
  Attention,
  Author,
  Item,
  LogEvent,
  Member,
  Message,
  Passkey,
  PersonalAccessToken,
  Person,
  Preferences,
  Site,
  SiteKey,
  Via,
} from "@annotatie/core";
import { PAGE_COPY, shot, type Shot } from "./pictures";

const UNDO_MS = 10_000;
const ME: Person = { id: "u_riley", name: "Riley Chen", email: "riley@example.com" };
const AGENT_VIA: Via = { kind: "agent", clientName: "Claude Code on WORKSTATION-7", clientId: "c_cc7" };

interface State {
  sites: Site[];
  items: Item[];
  messages: Message[];
  members: Record<string, Member[]>;
  invites: Record<string, Array<{ id: string; email: string; role: Member["role"]; expiresAt: string }>>;
  keys: Record<string, SiteKey[]>;
  tokens: PersonalAccessToken[];
  agents: AgentGrant[];
  passkeys: Passkey[];
  prefs: Preferences;
  log: LogEvent[];
  shots: Record<string, Shot>;
  seq: number;
  pushSubs: string[];
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const team = (p: Person = ME): Author => ({ kind: "team", id: p.id, name: p.name });
const user = (id: string, name: string): Author => ({ kind: "user", id, name });

function seed(): State {
  const sites: Site[] = [
    { id: "s_acme", name: "Acme Shop", origins: ["https://shop.example.com"], autoApprove: false, autoApproveUntil: null, retentionDays: 90, privacyMode: false, createdAt: ago(60 * 24 * 40), role: "owner" },
    { id: "s_north", name: "Northwind Bookings", origins: ["https://book.example.org", "https://staging.book.example.org"], autoApprove: false, autoApproveUntil: null, retentionDays: 30, privacyMode: true, createdAt: ago(60 * 24 * 20), role: "owner" },
  ];
  const ada = user("h_ada", "Ada Example");
  const ben = user("h_ben", "Ben Sample");
  const chloe = user("h_chloe", "Chloe Demo");
  const dana = user("h_dana", "Dana Test");
  const eve = user("h_eve", "Eve Placeholder");
  const capture = (kind: "apply" | "export" | "save", label: string, selector: string): Item["capture"] => ({
    context: {
      url: "https://shop.example.com/checkout?step=2",
      route: "checkout.basket",
      title: "Your basket",
      viewport: { width: 390, height: 844 },
      devicePixelRatio: 3,
      scroll: { x: 0, y: 0 },
      userAgent: "Chrome 131 on Android 15",
      buildId: "4b91e2d",
      capturedAt: ago(14),
      method: "dom",
      masked: { fields: 1, elements: 0 },
    },
    part: {
      selector,
      label,
      role: "button",
      name: label.replace(/^button /, "").replace(/[“”"]/g, ""),
      text: kind === "apply" ? "Apply" : kind === "export" ? "Export" : "Save and pay",
      box: { page: { x: 262, y: 300, width: 112, height: 40 }, screenshot: { x: 262, y: 300, width: 112, height: 40 } },
      outerHTML: `<button type="button" class="btn" data-action="${kind}">${kind === "apply" ? "Apply" : kind === "export" ? "Export" : "Save and pay"}</button>`,
      ancestors: ["main", "form.basket", "div.code"],
      styles: { display: "inline-flex", color: "#24324a", "background-color": "#e9edf3", "font-size": "14px" },
    },
    files: { page: { size: 212_000 }, pageMarked: { size: 214_000 }, closeup: { size: 18_000 }, html: { size: 41_000 } },
    confirmed: true,
  });
  const base = { labels: [] as string[], links: [] as string[], counts: { messages: 0, drafts: 0 } };
  const items: Item[] = [
    { ...base, id: "i41", siteId: "s_acme", number: 41, kind: "report", title: "Discount code is refused when typed in lower case", status: "open", page: { url: "https://shop.example.com/checkout?step=2", path: "/checkout", title: "Your basket" }, anchor: { selector: "form.basket [data-action=apply]", label: "button “Apply”" }, reporter: ada, labels: ["Bug"], capture: capture("apply", "button “Apply”", "form.basket [data-action=apply]"), createdAt: ago(12), updatedAt: ago(3), lastUserMessageAt: ago(12) },
    { ...base, id: "i44", siteId: "s_acme", number: 44, kind: "report", title: "Can the order export include the delivery note?", status: "open", page: { url: "https://shop.example.com/orders", path: "/orders" }, anchor: { selector: "header [data-action=export]", label: "button “Export”" }, reporter: ben, labels: ["Feature"], capture: capture("export", "button “Export”", "header [data-action=export]"), createdAt: ago(40), updatedAt: ago(20), lastUserMessageAt: ago(40) },
    { ...base, id: "i39", siteId: "s_acme", number: 39, kind: "report", title: "Save button hidden under the keyboard on phone", status: "in_progress", page: { url: "https://shop.example.com/checkout", path: "/checkout" }, reporter: dana, labels: ["Bug"], capture: capture("save", "button “Save and pay”", "form.basket button.pay"), createdAt: ago(60 * 26), updatedAt: ago(60 * 2), lastUserMessageAt: ago(60 * 2), lastTeamReplyAt: ago(60 * 20) },
    { ...base, id: "i37", siteId: "s_acme", number: 37, kind: "report", title: "What does “pending dispatch” mean?", status: "answered", page: { url: "https://shop.example.com/orders/1182", path: "/orders/1182" }, reporter: eve, labels: ["Question"], createdAt: ago(60 * 50), updatedAt: ago(60 * 47), lastUserMessageAt: ago(60 * 50), lastTeamReplyAt: ago(60 * 47) },
    { ...base, id: "q3", siteId: "s_acme", number: 3, kind: "decision", title: "Should the order export include phone numbers for every role?", status: "open", links: ["i44"], decision: { question: "Should the order export include phone numbers for every role?", context: "Ben asked for more columns in the export. Viewers can already see phone numbers on screen.", options: [ { label: "A", text: "Yes, for everyone who can export", consequence: "Matches what is on screen; no new permission. One small change." }, { label: "B", text: "Only for staff with “export personal data”", consequence: "Needs a new permission and a test, plus a reply to Ben explaining why." }, { label: "C", text: "No", consequence: "Ben keeps copying them by hand." } ], recommendation: "A", blocking: false, asker: { name: "Claude Code on WORKSTATION-7", session: "triage-0612" }, status: "waiting" }, createdAt: ago(30), updatedAt: ago(30) },
    { ...base, id: "q5", siteId: "s_acme", number: 5, kind: "decision", title: "Which test card should I use to check the fix on staging?", status: "open", decision: { question: "Which test card should I use to check the fix on staging?", context: "The payment step needs a card that the staging provider accepts. I can't find one in the repository.", options: [], blocking: true, asker: { name: "Claude Code on WORKSTATION-7", session: "fix-41" }, status: "waiting" }, createdAt: ago(8), updatedAt: ago(8) },
    { ...base, id: "i7", siteId: "s_north", number: 7, kind: "report", title: "Which date format should bookings use?", status: "open", page: { url: "https://book.example.org/bookings/new", path: "/bookings/new" }, reporter: chloe, labels: ["Question"], createdAt: ago(120), updatedAt: ago(100), lastUserMessageAt: ago(120) },
    { ...base, id: "i8", siteId: "s_north", number: 8, kind: "report", title: "Whole page: the map takes a long time to load", status: "open", page: { url: "https://book.example.org/marina", path: "/marina" }, reporter: chloe, labels: ["Bug"], createdAt: ago(5), updatedAt: ago(5), lastUserMessageAt: ago(5) },
    { ...base, id: "q1", siteId: "s_north", number: 1, kind: "decision", title: "Keep the old booking reference format?", status: "answered", decision: { question: "Keep the old booking reference format?", options: [ { label: "A", text: "Keep it" }, { label: "B", text: "Switch to the new format" } ], blocking: false, asker: { name: "Claude Code on WORKSTATION-7" }, status: "answered", answer: { option: "B", by: ME, at: ago(60 * 24 * 4) } }, createdAt: ago(60 * 24 * 5), updatedAt: ago(60 * 24 * 4) },
  ];
  let mid = 0;
  const msg = (itemId: string, author: Author, body: string, min: number, extra: Partial<Message> = {}): Message => {
    const it = items.find((x) => x.id === itemId)!;
    return { id: `m${++mid}`, itemId, siteId: it.siteId, author, body, visibility: "user", state: "published", createdAt: ago(min), publishedAt: ago(min), ...extra };
  };
  const messages: Message[] = [
    msg("i41", ada, "When I type the code **spring10** in lower case it says *Code not recognised*. In capitals it works.", 12),
    msg("i41", team(), "Reproduced from the page copy. `applyDiscount()` compares the code without normalising case. Fixed in commit 4be1c0a and deployed to staging at 12:14.", 9, { visibility: "internal", via: AGENT_VIA }),
    msg("i41", team(), "Thanks, Ada. You're right: the code was checked letter for letter, so lower case didn't match. That's fixed on staging now, and the code works however you type it. Let me know if you still see the message.", 3, { state: "draft", publishedAt: undefined, via: AGENT_VIA }),
    msg("i44", ben, "Could Export also include the delivery note? We print it afterwards, and at the moment I have to copy it across by hand from each order page, which takes most of a morning each month when the list is long.", 40),
    msg("i44", team(), "Good idea, Ben. We'll add the delivery note to the export and reply here when it's on staging.", 20, { state: "draft", publishedAt: undefined, via: AGENT_VIA }),
    msg("i39", dana, "On my phone the **Save and pay** button sits under the keyboard, so I can't tap it.", 60 * 26),
    msg("i39", team(), "Thanks Dana, we can see it. We're working on a fix.", 60 * 20, { approvedBy: ME, via: AGENT_VIA, releaseAt: ago(60 * 20) }),
    msg("i39", dana, "Any news? It's still happening on the live site.", 60 * 2),
    msg("i37", eve, "What does “pending dispatch” mean on my order?", 60 * 50),
    msg("i37", team(), "It means the order is packed and waiting for the courier. It usually changes within a day.", 60 * 47),
    msg("i7", chloe, "Should we type dates as 05/11 or 11/05?", 120),
    msg("i7", team(), "Day first: 05/11/2026 is 5 November. The calendar picker fills it in for you as well.", 100, { state: "draft", publishedAt: undefined, via: AGENT_VIA }),
    msg("i8", chloe, "Every morning the marina map takes ten seconds or more before I can tap a berth.\n\n- Phone: yes\n- Laptop: also slow", 5),
  ];
  for (const it of items) recount(it, messages);
  return {
    sites,
    items,
    messages,
    members: {
      s_acme: [
        { userId: ME.id, name: ME.name, email: ME.email!, role: "owner", addedAt: ago(60 * 24 * 40) },
        { userId: "u_jo", name: "Jo Fixture", email: "jo@example.com", role: "member", addedAt: ago(60 * 24 * 30) },
      ],
      s_north: [{ userId: ME.id, name: ME.name, email: ME.email!, role: "owner", addedAt: ago(60 * 24 * 20) }],
    },
    invites: { s_acme: [], s_north: [] },
    keys: {
      s_acme: [{ kid: "k-2026-11", publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" }, status: "active", createdAt: ago(60 * 24 * 6) }],
      s_north: [],
    },
    tokens: [
      { id: "t1", name: "nightly-triage", sites: ["s_north"], scopes: ["read", "reply"], createdAt: ago(60 * 24 * 3), expiresAt: later(90), lastUsedAt: ago(60 * 20) },
    ],
    agents: [
      { grantId: "g1", clientId: "c_cc7", clientName: "Claude Code on WORKSTATION-7", sites: ["s_acme"], scopes: ["read", "reply", "reply:user", "status", "decide", "capture:read"], createdAt: ago(60 * 24 * 2), lastUsedAt: ago(3) },
    ],
    passkeys: [{ id: "pk1", name: "This laptop", createdAt: ago(60 * 24 * 40), lastUsedAt: ago(60) }],
    prefs: { quietHours: null, push: { drafts: true, decisions: true } },
    log: [],
    shots: { i41: "apply", i44: "export", i39: "save" },
    seq: 100,
    pushSubs: [],
  };
}

function recount(it: Item, messages: Message[]) {
  const ms = messages.filter((m) => m.itemId === it.id);
  it.counts = { messages: ms.length, drafts: ms.filter((m) => m.state === "draft" && m.visibility === "user").length };
}

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface MockControls {
  /** Every request fails as if there were no connection. */
  offline: boolean;
  /** An agent writes a reply to the user on an item: a draft, or published at once while auto-approve is on. */
  agentReply(itemId: string, body: string): Message;
  reset(): void;
  state(): State;
}

export function createMock(origin: string) {
  let st = seed();
  const id = () => `x${++st.seq}`;
  const site = (sid: string) => {
    const s = st.sites.find((x) => x.id === sid);
    if (!s) throw new HttpError(404, "not_found", "No such site.");
    // Auto-approve switches itself off at its "until" time (Q7).
    if (s.autoApprove && s.autoApproveUntil && Date.parse(s.autoApproveUntil) <= Date.now()) {
      s.autoApprove = false;
      s.autoApproveUntil = null;
    }
    return s;
  };
  const item = (sid: string, iid: string) => {
    const it = st.items.find((x) => x.id === iid && x.siteId === sid);
    if (!it) throw new HttpError(404, "not_found", "No such item.");
    return it;
  };
  const message = (it: Item, mid: string) => {
    const m = st.messages.find((x) => x.id === mid && x.itemId === it.id);
    if (!m) throw new HttpError(404, "not_found", "No such message.");
    return m;
  };
  const log = (siteId: string, type: LogEvent["type"], extra: Partial<LogEvent> = {}) => {
    st.log.unshift({ id: id(), siteId, at: new Date().toISOString(), type, actor: team(), via: { kind: "portal" }, ...extra });
  };
  const withCounts = (s: Site): Site => {
    const its = st.items.filter((x) => x.siteId === s.id);
    const att = attention();
    return {
      ...s,
      counts: {
        open: its.filter((x) => x.kind === "report" && x.status !== "resolved").length,
        drafts: att.drafts.filter((d) => d.site.id === s.id).length,
        decisions: att.decisions.filter((d) => d.site.id === s.id).length,
        unanswered: att.unanswered.filter((d) => d.site.id === s.id).length + att.newFromUsers.filter((d) => d.site.id === s.id).length,
      },
    };
  };
  const pick = (s: Site) => ({ id: s.id, name: s.name });

  function attention(): Attention {
    const out: Attention = { drafts: [], decisions: [], newFromUsers: [], unanswered: [] };
    for (const it of st.items) {
      const s = st.sites.find((x) => x.id === it.siteId)!;
      const ms = st.messages.filter((m) => m.itemId === it.id);
      for (const m of ms) if (m.state === "draft" && m.visibility === "user") out.drafts.push({ site: pick(s), item: it, message: m });
      if (it.kind === "decision" && it.decision?.status === "waiting") out.decisions.push({ site: pick(s), item: it });
      if (it.kind !== "report" || it.status === "resolved" || it.counts.drafts > 0) continue;
      const lastUser = [...ms].reverse().find((m) => m.author.kind === "user");
      if (!it.lastTeamReplyAt && lastUser) out.newFromUsers.push({ site: pick(s), item: it, message: lastUser });
      else if (it.lastTeamReplyAt && it.lastUserMessageAt && it.lastUserMessageAt > it.lastTeamReplyAt) out.unanswered.push({ site: pick(s), item: it });
    }
    out.decisions.sort((a, b) => Number(!!b.item.decision?.blocking) - Number(!!a.item.decision?.blocking));
    return out;
  }

  function handle(method: string, path: string, query: URLSearchParams, body: any): unknown {
    const p = path.split("/").filter(Boolean).map(decodeURIComponent); // ["api", ...]
    const r = p.slice(1);
    const is = (m: string, ...parts: Array<string | null>) =>
      method === m && r.length === parts.length && parts.every((x, i) => x === null || x === r[i]);

    if (is("GET", "me")) return { user: ME, sites: st.sites.map((s) => withCounts(site(s.id))), preferences: st.prefs };
    if (is("PUT", "me", "preferences")) return (st.prefs = body as Preferences);
    if (is("GET", "attention")) return attention();
    if (is("POST", "sites")) {
      if (!body?.name) throw new HttpError(400, "invalid", "A name is needed.");
      const s: Site = { id: id(), name: body.name, origins: body.origins ?? [], autoApprove: false, autoApproveUntil: null, retentionDays: 90, privacyMode: false, createdAt: new Date().toISOString(), role: "owner" };
      st.sites.push(s);
      st.members[s.id] = [{ userId: ME.id, name: ME.name, email: ME.email!, role: "owner", addedAt: s.createdAt }];
      st.keys[s.id] = [];
      st.invites[s.id] = [];
      return withCounts(s);
    }
    if (is("GET", "sites", null)) return withCounts(site(r[1]!));
    if (is("PATCH", "sites", null)) {
      const s = site(r[1]!);
      for (const k of ["name", "origins", "retentionDays", "privacyMode"] as const) if (body[k] !== undefined) (s as any)[k] = body[k];
      log(s.id, "site.updated", { detail: body });
      return withCounts(s);
    }
    if (is("PUT", "sites", null, "auto-approve")) {
      const s = site(r[1]!);
      s.autoApprove = !!body.on;
      s.autoApproveUntil = body.on ? (body.until ?? null) : null;
      log(s.id, "site.auto_approve", { detail: { on: s.autoApprove, until: s.autoApproveUntil } });
      return withCounts(s);
    }
    if (is("GET", "sites", null, "keys")) return { keys: st.keys[site(r[1]!).id] ?? [] };
    if (is("POST", "sites", null, "keys")) {
      const s = site(r[1]!);
      const jwk = body?.publicKeyJwk;
      if (!jwk || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") throw new HttpError(400, "invalid_key", "That isn't an Ed25519 public key (OKP, Ed25519, x).");
      if ("d" in jwk) throw new HttpError(400, "private_key", "That is a private key. Paste the public key only.");
      const k: SiteKey = { kid: body.kid || `k-${new Date().toISOString().slice(0, 7)}-${st.seq++}`, publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: jwk.x }, status: "active", createdAt: new Date().toISOString() };
      st.keys[s.id]!.push(k);
      log(s.id, "site.key", { detail: { kid: k.kid, added: true } });
      return k;
    }
    if (is("DELETE", "sites", null, "keys", null)) {
      const k = (st.keys[site(r[1]!).id] ?? []).find((x) => x.kid === r[3]);
      if (!k) throw new HttpError(404, "not_found", "No such key.");
      k.status = "retired";
      return k;
    }
    if (is("GET", "sites", null, "members")) {
      const s = site(r[1]!);
      return { members: st.members[s.id] ?? [], invites: st.invites[s.id] ?? [] };
    }
    if (is("POST", "sites", null, "invites")) {
      const s = site(r[1]!);
      const inv = { id: id(), email: body.email, role: body.role, expiresAt: later(7) };
      st.invites[s.id]!.push(inv);
      return { id: inv.id, url: `${origin}/invite/${inv.id}-one-time-mock-link`, expiresAt: inv.expiresAt };
    }
    if (is("PATCH", "sites", null, "members", null)) {
      const m = (st.members[site(r[1]!).id] ?? []).find((x) => x.userId === r[3]);
      if (!m) throw new HttpError(404, "not_found", "No such member.");
      m.role = body.role;
      return m;
    }
    if (is("DELETE", "sites", null, "members", null)) {
      const s = site(r[1]!);
      st.members[s.id] = (st.members[s.id] ?? []).filter((x) => x.userId !== r[3]);
      return undefined;
    }
    if (is("GET", "sites", null, "items")) {
      const s = site(r[1]!);
      const kind = query.get("kind");
      const status = query.get("status");
      const q = query.get("q")?.toLowerCase();
      return {
        items: st.items
          .filter((x) => x.siteId === s.id && (!kind || x.kind === kind) && (!status || x.status === status) && (!q || x.title.toLowerCase().includes(q)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
    }
    if (is("POST", "sites", null, "items")) {
      const s = site(r[1]!);
      const n = Math.max(0, ...st.items.filter((x) => x.siteId === s.id && x.kind === body.kind).map((x) => x.number)) + 1;
      const it: Item = { id: id(), siteId: s.id, number: n, kind: body.kind, title: body.title, status: "open", labels: [], links: [], counts: { messages: 0, drafts: 0 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...(body.decision ? { decision: { ...body.decision, status: "waiting" } } : {}) };
      st.items.push(it);
      return it;
    }
    if (is("GET", "sites", null, "items", null)) {
      const it = item(r[1]!, r[3]!);
      return { item: it, messages: st.messages.filter((m) => m.itemId === it.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), log: st.log.filter((e) => e.itemId === it.id) };
    }
    if (is("PATCH", "sites", null, "items", null)) {
      const it = item(r[1]!, r[3]!);
      for (const k of ["status", "title", "labels"] as const) if (body[k] !== undefined) (it as any)[k] = body[k];
      it.updatedAt = new Date().toISOString();
      log(it.siteId, "item.updated", { itemId: it.id, detail: body });
      return it;
    }
    if (is("POST", "sites", null, "items", null, "messages")) {
      const it = item(r[1]!, r[3]!);
      const body2 = String(body.body ?? "").trim();
      if (!body2) throw new HttpError(400, "invalid", "The message is empty.");
      const now = new Date().toISOString();
      const m: Message = { id: id(), itemId: it.id, siteId: it.siteId, author: team(), body: body2, visibility: body.visibility, state: "published", createdAt: now, publishedAt: now, via: { kind: "portal" } };
      st.messages.push(m);
      if (m.visibility === "user") it.lastTeamReplyAt = now;
      recount(it, st.messages);
      return m;
    }
    if (is("POST", "sites", null, "items", null, "messages", null, "approve")) {
      const it = item(r[1]!, r[3]!);
      const m = message(it, r[5]!);
      if (m.state !== "draft") throw new HttpError(409, "not_draft", "This reply was already sent or rejected.");
      const now = Date.now();
      if (typeof body?.body === "string" && body.body.trim() && body.body !== m.body) {
        m.body = body.body.trim();
        m.editedAt = new Date(now).toISOString();
      }
      m.state = "published";
      m.publishedAt = new Date(now).toISOString();
      m.releaseAt = new Date(now + UNDO_MS).toISOString();
      m.approvedBy = ME;
      it.lastTeamReplyAt = m.publishedAt;
      recount(it, st.messages);
      log(it.siteId, "message.published", { itemId: it.id, messageId: m.id });
      return m;
    }
    if (is("POST", "sites", null, "items", null, "messages", null, "undo")) {
      const it = item(r[1]!, r[3]!);
      const m = message(it, r[5]!);
      if (m.state !== "published" || !m.releaseAt || Date.parse(m.releaseAt) <= Date.now()) throw new HttpError(409, "too_late", "It was already sent.");
      m.state = "draft";
      delete m.releaseAt;
      delete m.publishedAt;
      delete m.approvedBy;
      recount(it, st.messages);
      log(it.siteId, "message.unpublished", { itemId: it.id, messageId: m.id });
      return m;
    }
    if (is("POST", "sites", null, "items", null, "messages", null, "reject")) {
      const it = item(r[1]!, r[3]!);
      const m = message(it, r[5]!);
      if (m.state !== "draft") throw new HttpError(409, "not_draft", "This reply was already sent or rejected.");
      if (!String(body?.reason ?? "").trim()) throw new HttpError(400, "invalid", "A reason is needed.");
      m.state = "rejected";
      m.rejectedReason = body.reason;
      m.rejectedBy = ME;
      recount(it, st.messages);
      log(it.siteId, "message.rejected", { itemId: it.id, messageId: m.id, detail: { reason: body.reason } });
      return m;
    }
    if (is("POST", "sites", null, "items", null, "answer")) {
      const it = item(r[1]!, r[3]!);
      const d = it.decision;
      if (!d) throw new HttpError(400, "not_decision", "This item has no question.");
      if (!body.option && !String(body.text ?? "").trim()) throw new HttpError(400, "invalid", "An answer is needed.");
      if (!d.options.length && !String(body.text ?? "").trim()) throw new HttpError(400, "invalid", "Write an answer.");
      d.status = "answered";
      d.answer = { ...(body.option ? { option: body.option } : {}), ...(body.text ? { text: body.text } : {}), by: ME, at: new Date().toISOString() };
      it.status = "answered";
      log(it.siteId, "decision.answered", { itemId: it.id, detail: { option: body.option } });
      return it;
    }
    if (is("GET", "sites", null, "items", null, "capture", null)) {
      const it = item(r[1]!, r[3]!);
      const file = r[5]!;
      if (!it.capture?.files[file as "page"]) throw new HttpError(404, "not_found", "No such file.");
      if (file === "html") return { __html: PAGE_COPY };
      const k = st.shots[it.id] ?? "apply";
      return { url: shot(k, { marked: file !== "page", crop: file === "closeup" }) };
    }
    if (is("GET", "sites", null, "log")) return { events: st.log.filter((e) => e.siteId === site(r[1]!).id) };
    if (is("GET", "tokens")) return { tokens: st.tokens };
    if (is("POST", "tokens")) {
      const days = Number(body.expiresInDays);
      if (!body.name || !(days >= 1 && days <= 365)) throw new HttpError(400, "invalid", "Give it a name and an expiry of 1 to 365 days.");
      const pat: PersonalAccessToken = { id: id(), name: body.name, sites: body.sites, scopes: body.scopes, createdAt: new Date().toISOString(), expiresAt: later(days) };
      st.tokens.push(pat);
      return { token: `ann_pat_mock${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`, pat };
    }
    if (is("DELETE", "tokens", null)) {
      st.tokens = st.tokens.filter((t) => t.id !== r[1]);
      return undefined;
    }
    if (is("GET", "agents")) return { agents: st.agents };
    if (is("DELETE", "agents", null)) {
      st.agents = st.agents.filter((a) => a.grantId !== r[1]);
      return undefined;
    }
    if (is("GET", "me", "passkeys")) return { passkeys: st.passkeys };
    if (is("POST", "me", "passkeys", "options"))
      return {
        challenge: "bW9jay1jaGFsbGVuZ2UtZm9yLWFubm90YXRpZQ",
        rp: { id: location.hostname, name: "Annotatie" },
        user: { id: "dV9yaWxleQ", name: ME.email, displayName: ME.name },
        pubKeyCredParams: [{ type: "public-key", alg: -8 }, { type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        timeout: 60000,
        attestation: "none",
        excludeCredentials: [],
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      };
    if (is("POST", "me", "passkeys")) {
      const pk: Passkey = { id: id(), name: body.name || "Passkey", createdAt: new Date().toISOString() };
      st.passkeys.push(pk);
      return pk;
    }
    if (is("DELETE", "me", "passkeys", null)) {
      if (st.passkeys.length <= 1) throw new HttpError(409, "last_passkey", "You can't delete your last passkey.");
      st.passkeys = st.passkeys.filter((x) => x.id !== r[2]);
      return undefined;
    }
    if (is("GET", "push", "key")) return { publicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" };
    if (is("POST", "push", "subscriptions")) {
      st.pushSubs.push(body.endpoint);
      return undefined;
    }
    if (is("DELETE", "push", "subscriptions")) {
      st.pushSubs = st.pushSubs.filter((e) => e !== body.endpoint);
      return undefined;
    }
    throw new HttpError(404, "not_found", `Mock has no route ${method} ${path}`);
  }

  let tokenSeq = 0;
  const controls: MockControls = {
    offline: false,
    agentReply(itemId, body) {
      const it = st.items.find((x) => x.id === itemId);
      if (!it) throw new Error("no such item");
      const s = site(it.siteId);
      const now = new Date().toISOString();
      const auto = s.autoApprove;
      const m: Message = { id: id(), itemId, siteId: it.siteId, author: team(), body, visibility: "user", state: auto ? "published" : "draft", createdAt: now, via: AGENT_VIA, ...(auto ? { publishedAt: now, releaseAt: now, autoApproved: true } : {}) };
      st.messages.push(m);
      if (auto) it.lastTeamReplyAt = now;
      recount(it, st.messages);
      return m;
    },
    reset() {
      st = seed();
    },
    state: () => st,
  };

  const json = (status: number, data: unknown) =>
    new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  async function mockFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    await new Promise((r) => setTimeout(r, 40));
    if (controls.offline) throw new TypeError("Failed to fetch");
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, origin);
    const method = (init.method || "GET").toUpperCase();
    if (url.pathname === "/oauth/token") {
      const f = new URLSearchParams(String(init.body ?? ""));
      const gt = f.get("grant_type");
      if (gt === "authorization_code" && !f.get("code_verifier")) return json(400, { error: "invalid_request" });
      if (gt === "refresh_token" && !f.get("refresh_token")?.startsWith("mock-rt-")) return json(400, { error: "invalid_grant" });
      tokenSeq++;
      return json(200, { access_token: `mock-at-${tokenSeq}`, token_type: "Bearer", expires_in: 900, refresh_token: `mock-rt-${tokenSeq}-${Date.now()}` });
    }
    if (url.pathname.startsWith("/api/")) {
      const auth = new Headers(init.headers).get("Authorization");
      if (!auth?.startsWith("Bearer mock-at-")) return json(401, { error: "unauthorized", message: "Sign in again." });
      let body: unknown = undefined;
      if (typeof init.body === "string" && init.body) body = JSON.parse(init.body);
      try {
        const out = handle(method, url.pathname, url.searchParams, body);
        if (out && typeof out === "object" && "__html" in out) {
          return new Response((out as { __html: string }).__html, { status: 200, headers: { "Content-Type": "text/html" } });
        }
        return out === undefined ? new Response(null, { status: 204 }) : json(method === "POST" && /\/(sites|items|tokens|invites)$/.test(url.pathname) ? 201 : 200, out);
      } catch (e) {
        if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message });
        throw e;
      }
    }
    return json(404, { error: "not_found" });
  }

  /** Stands in for the server's sign-in pages: authorize redirects straight back with a code. */
  function navigate(target: string) {
    const u = new URL(target, origin);
    if (u.pathname === "/oauth/authorize") {
      const back = new URL(u.searchParams.get("redirect_uri")!);
      back.searchParams.set("mock", "1");
      back.searchParams.set("code", `mock-code-${Date.now()}`);
      back.searchParams.set("state", u.searchParams.get("state") ?? "");
      back.hash = location.hash;
      location.replace(back.href);
      return;
    }
    if (u.pathname === "/oauth/logout") {
      location.replace(`${origin}/board/?mock=1&signedout=1`);
      return;
    }
    location.assign(target);
  }

  return { fetch: mockFetch, navigate, controls };
}
