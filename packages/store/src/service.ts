// The domain service: every read and write of Annotatie's data, with its permission checks. The API
// and MCP Lambdas are thin layers over this. Principals come from verified tokens (principal.ts).

import { createHash } from "node:crypto";
import {
  AGENT_SCOPES,
  type AgentGrant,
  type AgentScope,
  type Attention,
  type Author,
  type Capture,
  type CaptureFile,
  type Decision,
  type DecisionOption,
  type EventType,
  HttpError,
  type Item,
  type ItemKind,
  type ItemStatus,
  ITEM_STATUSES,
  isDone,
  LIMITS,
  type LogEvent,
  type Member,
  type Message,
  type Passkey,
  type PersonalAccessToken,
  type Preferences,
  type Role,
  type Site,
  type SiteCounts,
  type SiteKey,
  type Via,
  type Visibility,
  canPublish,
  decideMessageState,
  newId,
  normaliseOrigin,
  randomToken,
  releaseTime,
  reqStr,
  roleAtLeast,
  str,
  visibleToUsers,
} from "@annotatie/core";
import { Db, type Rec, isConditionFailure, strip, ttlAt } from "./db.js";
import type { AgentPrincipal, PersonPrincipal, Principal, WidgetPrincipal } from "./principal.js";

export interface ServiceOptions {
  /** The platform kill switch (OpenTofu auto_approve_allowed). */
  autoApproveAllowed: boolean;
  /** Public base URL, for links (portal, invites). */
  baseUrl: string;
  /** Called after a draft or a decision/question is created (M1 push). Errors are swallowed. */
  notify?: (event: NotifyEvent) => Promise<void>;
  now?: () => Date;
}

export interface NotifyEvent {
  type: "draft" | "decision";
  siteId: string;
  siteName: string;
  item: Item;
  blocking: boolean;
  /** Users to notify: the site's owners and members. */
  userIds: string[];
}

const DEFAULT_PREFS: Preferences = { quietHours: null, push: { drafts: true, decisions: true } };

type SiteRec = Site & { nextNumber?: number };
type ItemRec = Item & { visibleCount?: number };

export class Service {
  constructor(
    readonly db: Db,
    readonly opts: ServiceOptions,
  ) {}

  now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  // ------------------------------------------------------------------ access

  private async role(userId: string, siteId: string): Promise<Role | undefined> {
    const m = await this.db.get<{ role: Role }>(`SITE#${siteId}`, `MEMBER#${userId}`);
    return m?.role;
  }

  /**
   * The site, if the principal may act on it with at least `needed`, else 404 (never reveal that a
   * site exists). Agents also need the site in their token and the given scope.
   */
  async access(p: Principal, siteId: string, needed: Role, scope?: AgentScope): Promise<{ site: Site; role?: Role }> {
    if (typeof siteId !== "string" || !siteId) throw new HttpError(404, "not_found");
    if (p.kind === "widget") {
      if (p.siteId !== siteId) throw new HttpError(404, "not_found");
      const site = await this.siteRec(siteId);
      if (!site) throw new HttpError(404, "not_found");
      return { site };
    }
    if (p.kind === "agent") {
      if (p.sites && !p.sites.includes(siteId)) throw new HttpError(404, "not_found");
      if (scope && !p.scopes.has(scope)) throw new HttpError(403, "insufficient_scope", `This token lacks the ${scope} scope.`);
    }
    const role = await this.role(p.userId, siteId);
    if (!role) throw new HttpError(404, "not_found");
    if (!roleAtLeast(role, needed)) throw new HttpError(403, "forbidden", `Needs the ${needed} role on this site.`);
    const site = await this.siteRec(siteId);
    if (!site) throw new HttpError(404, "not_found");
    return { site, role };
  }

  private async siteRec(siteId: string): Promise<Site | undefined> {
    const r = await this.db.get<SiteRec & Rec>(`SITE#${siteId}`, "META");
    if (!r) return undefined;
    const { nextNumber: _n, ...site } = strip<SiteRec>(r)!;
    return site;
  }

  private author(p: Principal): Author {
    return p.kind === "widget" ? { kind: "user", id: p.userId, name: p.name } : { kind: "team", id: p.userId, name: p.name };
  }

  private via(p: Principal): Via | undefined {
    return p.kind === "widget" ? { kind: "widget" } : p.via;
  }

  // ------------------------------------------------------------------ log

  async log(siteId: string, type: EventType, p: Principal, extra: Partial<LogEvent> = {}): Promise<LogEvent> {
    const ev: LogEvent = {
      id: newId(this.now().getTime()),
      siteId,
      at: this.now().toISOString(),
      type,
      actor: this.author(p),
      via: this.via(p),
      ...extra,
    };
    await this.db.put({ pk: `SITE#${siteId}`, sk: `LOG#${ev.id}`, ...ev });
    return ev;
  }

  async listLog(p: Principal, siteId: string, before?: string, limit = 100): Promise<LogEvent[]> {
    await this.access(p, siteId, "owner");
    const rows = await this.db.query<LogEvent & Rec>(`SITE#${siteId}`, {
      prefix: "LOG#",
      ...(before ? { before: `LOG#${before}`, after: "LOG#" } : {}),
      descending: true,
      limit: Math.min(limit, 200),
    });
    return rows.map((r) => strip<LogEvent>(r)!);
  }

  // ------------------------------------------------------------------ users

  async getUser(userId: string): Promise<{ id: string; name: string; email: string; preferences: Preferences } | undefined> {
    const u = await this.db.get<Rec & { id: string; name: string; email: string; preferences?: Preferences }>(`USER#${userId}`, "META");
    if (!u) return undefined;
    return { id: u.id, name: u.name, email: u.email, preferences: u.preferences ?? DEFAULT_PREFS };
  }

  async userByEmail(email: string): Promise<string | undefined> {
    const r = await this.db.get<{ userId: string }>(`EMAIL#${email.toLowerCase()}`, "META");
    return r?.userId;
  }

  /** Create a team user (from an invite). Fails if the email is taken. */
  async createUser(name: string, email: string): Promise<string> {
    const id = newId(this.now().getTime());
    const e = email.toLowerCase();
    try {
      await this.db.transact([
        { Put: { TableName: this.db.table, Item: { pk: `EMAIL#${e}`, sk: "META", userId: id }, ConditionExpression: "attribute_not_exists(pk)" } },
        {
          Put: {
            TableName: this.db.table,
            Item: { pk: `USER#${id}`, sk: "META", id, name, email: e, status: "active", createdAt: this.now().toISOString(), preferences: DEFAULT_PREFS },
          },
        },
      ]);
    } catch (err) {
      if (isConditionFailure(err)) throw new HttpError(409, "email_taken", "That email already has an account.");
      throw err;
    }
    return id;
  }

  async me(p: PersonPrincipal) {
    const user = await this.getUser(p.userId);
    if (!user) throw new HttpError(401, "invalid_token");
    const sites = await this.mySites(p);
    return { user: { id: user.id, name: user.name, email: user.email }, sites, preferences: user.preferences };
  }

  async setPreferences(p: PersonPrincipal, prefs: unknown): Promise<Preferences> {
    const v = parsePreferences(prefs);
    await this.db.update(`USER#${p.userId}`, "META", { preferences: v });
    return v;
  }

  // ------------------------------------------------------------------ sites

  async mySites(p: PersonPrincipal | AgentPrincipal, withCounts = true): Promise<Site[]> {
    const links = await this.db.query<Rec & { role: Role }>(`USER#${p.userId}`, { prefix: "SITE#" });
    const out: Site[] = [];
    for (const l of links) {
      const siteId = l.sk.slice(5);
      if (p.kind === "agent" && p.sites && !p.sites.includes(siteId)) continue;
      const site = await this.siteRec(siteId);
      if (!site) continue;
      site.role = l.role;
      if (withCounts) site.counts = await this.siteCounts(siteId);
      out.push(site);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async siteItems(siteId: string): Promise<ItemRec[]> {
    const rows = await this.db.query<ItemRec & Rec>(`SITE#${siteId}`, { prefix: "ITEM#" });
    return rows.map((r) => strip<ItemRec>(r)!);
  }

  private async siteCounts(siteId: string): Promise<SiteCounts> {
    const items = await this.siteItems(siteId);
    return countsOf(items);
  }

  async createSite(p: PersonPrincipal | AgentPrincipal, body: { name?: unknown; origins?: unknown }): Promise<Site> {
    if (p.kind === "agent" && !p.scopes.has("sites")) throw new HttpError(403, "insufficient_scope", "This token lacks the sites scope.");
    const name = reqStr(body.name, "name", LIMITS.name);
    const origins = parseOrigins(body.origins ?? []);
    const id = newId(this.now().getTime());
    const at = this.now().toISOString();
    const site: SiteRec = {
      id,
      name,
      origins,
      autoApprove: false,
      autoApproveUntil: null,
      retentionDays: 90,
      privacyMode: false,
      createdAt: at,
      nextNumber: 0,
    };
    const user = await this.getUser(p.userId);
    await this.db.transact([
      { Put: { TableName: this.db.table, Item: { pk: `SITE#${id}`, sk: "META", ...site } } },
      {
        Put: {
          TableName: this.db.table,
          Item: { pk: `SITE#${id}`, sk: `MEMBER#${p.userId}`, role: "owner", addedAt: at, name: user?.name ?? p.name, email: user?.email ?? "" },
        },
      },
      { Put: { TableName: this.db.table, Item: { pk: `USER#${p.userId}`, sk: `SITE#${id}`, role: "owner" } } },
      { Put: { TableName: this.db.table, Item: { pk: "SITES", sk: `SITE#${id}` } } },
    ]);
    await this.log(id, "site.updated", p, { detail: { created: true, name } });
    if (p.kind === "agent") await this.addSiteToAgent(p, id);
    const { nextNumber: _n, ...out } = site;
    return { ...out, role: "owner", counts: { open: 0, drafts: 0, decisions: 0, unanswered: 0 } };
  }

  /** A site an agent created joins the sites its grant (or token) may use. */
  private async addSiteToAgent(p: AgentPrincipal, siteId: string): Promise<void> {
    if (!p.sites) return;
    const sites = [...new Set([...p.sites, siteId])];
    if (p.grantId) {
      await this.db.update(`GRANT#${p.grantId}`, "META", { sites });
      await this.db.update(`USER#${p.userId}`, `GRANT#${p.grantId}`, { sites });
    } else if (p.patId) {
      const r = await this.db.get<Rec & { hash: string }>(`USER#${p.userId}`, `PAT#${p.patId}`);
      if (r) {
        await this.db.update(`PAT#${r.hash}`, "META", { sites });
        await this.db.update(`USER#${p.userId}`, `PAT#${p.patId}`, { sites });
      }
    }
    (p as { sites: string[] | null }).sites = sites;
  }

  /** Allow one more origin (an agent installing the widget on a site). Owner only. */
  async addOrigin(p: PersonPrincipal | AgentPrincipal, siteId: string, origin: unknown): Promise<Site> {
    const { site } = await this.access(p, siteId, "owner", "sites");
    const origins = parseOrigins([...site.origins, origin]);
    await this.db.update(`SITE#${siteId}`, "META", { origins });
    await this.log(siteId, "site.updated", p, { detail: { origins } });
    return this.getSite(p, siteId);
  }

  async getSite(p: Principal, siteId: string): Promise<Site> {
    const { site, role } = await this.access(p, siteId, "viewer", "read");
    return { ...site, ...(role ? { role } : {}) };
  }

  async updateSite(p: PersonPrincipal, siteId: string, body: Record<string, unknown>): Promise<Site> {
    await this.access(p, siteId, "owner");
    const set: Record<string, unknown> = {};
    if (body.name !== undefined) set.name = reqStr(body.name, "name", LIMITS.name);
    if (body.origins !== undefined) set.origins = parseOrigins(body.origins);
    if (body.retentionDays !== undefined) {
      const d = Number(body.retentionDays);
      if (!Number.isInteger(d) || d < 1 || d > 3650) throw new HttpError(400, "invalid_request", "retentionDays must be 1-3650.");
      set.retentionDays = d;
    }
    if (body.privacyMode !== undefined) set.privacyMode = body.privacyMode === true;
    if (!Object.keys(set).length) throw new HttpError(400, "invalid_request", "Nothing to change.");
    await this.db.update(`SITE#${siteId}`, "META", set);
    await this.log(siteId, "site.updated", p, { detail: set });
    return this.getSite(p, siteId);
  }

  async setAutoApprove(p: PersonPrincipal, siteId: string, body: { on?: unknown; until?: unknown }): Promise<Site> {
    await this.access(p, siteId, "owner");
    const on = body.on === true;
    if (on && !this.opts.autoApproveAllowed) {
      throw new HttpError(409, "auto_approve_disabled", "Auto-approve is switched off for the whole platform.");
    }
    let until: string | null = null;
    if (on && body.until) {
      const t = Date.parse(String(body.until));
      if (Number.isNaN(t) || t <= this.now().getTime()) throw new HttpError(400, "invalid_request", "until must be a future time.");
      until = new Date(t).toISOString();
    }
    await this.db.update(`SITE#${siteId}`, "META", { autoApprove: on, autoApproveUntil: until });
    await this.log(siteId, "site.auto_approve", p, { detail: { on, until } });
    return this.getSite(p, siteId);
  }

  // ------------------------------------------------------------------ site keys

  async listKeys(p: PersonPrincipal, siteId: string): Promise<SiteKey[]> {
    await this.access(p, siteId, "owner");
    const rows = await this.db.query<SiteKey & Rec>(`SITE#${siteId}`, { prefix: "KEY#" });
    return rows.map((r) => strip<SiteKey>(r)!);
  }

  /** For the assertion exchange (auth service): the active key, or undefined. */
  async activeSiteKey(siteId: string, kid: string): Promise<SiteKey | undefined> {
    const k = await this.db.get<SiteKey & Rec>(`SITE#${siteId}`, `KEY#${kid}`, true);
    return k && k.status === "active" ? strip<SiteKey>(k) : undefined;
  }

  async addKey(p: PersonPrincipal | AgentPrincipal, siteId: string, body: { kid?: unknown; publicKeyJwk?: unknown }): Promise<SiteKey> {
    await this.access(p, siteId, "owner", "sites");
    const jwk = body.publicKeyJwk as Record<string, unknown> | undefined;
    if (!jwk || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x)) {
      throw new HttpError(400, "invalid_request", "publicKeyJwk must be an Ed25519 public JWK ({ kty: OKP, crv: Ed25519, x }).");
    }
    if ("d" in jwk) throw new HttpError(400, "invalid_request", "That is a private key. Paste only the public key.");
    const kid = str(body.kid, "kid", 64, true) ?? newId(this.now().getTime()).slice(-12);
    if (!/^[A-Za-z0-9._-]+$/.test(kid)) throw new HttpError(400, "invalid_request", "kid may use letters, digits, . _ -");
    const key: SiteKey = { kid, publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: jwk.x }, status: "active", createdAt: this.now().toISOString() };
    if (!(await this.db.putNew({ pk: `SITE#${siteId}`, sk: `KEY#${kid}`, ...key }))) {
      throw new HttpError(409, "kid_taken", "A key with that id exists.");
    }
    await this.log(siteId, "site.key", p, { detail: { kid, added: true } });
    return key;
  }

  async retireKey(p: PersonPrincipal, siteId: string, kid: string): Promise<SiteKey> {
    await this.access(p, siteId, "owner");
    try {
      const k = await this.db.update<SiteKey & Rec>(`SITE#${siteId}`, `KEY#${kid}`, { status: "retired" });
      await this.log(siteId, "site.key", p, { detail: { kid, retired: true } });
      return strip<SiteKey>(k)!;
    } catch (e) {
      if (isConditionFailure(e)) throw new HttpError(404, "not_found");
      throw e;
    }
  }

  // ------------------------------------------------------------------ members and invites

  async listMembers(p: PersonPrincipal, siteId: string) {
    await this.access(p, siteId, "viewer");
    const rows = await this.db.query<Rec>(`SITE#${siteId}`, { prefix: "MEMBER#" });
    const members: Member[] = rows.map((r) => ({
      userId: r.sk.slice(7),
      name: String(r.name ?? ""),
      email: String(r.email ?? ""),
      role: r.role as Role,
      addedAt: String(r.addedAt ?? ""),
    }));
    const inv = await this.db.query<Rec>(`SITE#${siteId}`, { prefix: "INVITE#" });
    const now = this.now().getTime();
    const invites = inv
      .filter((r) => Date.parse(String(r.expiresAt)) > now)
      .map((r) => ({ id: r.sk.slice(7), email: String(r.email), role: r.role as Role, expiresAt: String(r.expiresAt) }));
    return { members, invites };
  }

  /**
   * A one-time invite link. With a site, joining adds the person to it; without one (the CLI's owner
   * bootstrap), it only creates the account.
   */
  async createInvite(
    by: PersonPrincipal | null,
    email: unknown,
    site?: { siteId: string; role: Role },
  ): Promise<{ id: string; url: string; expiresAt: string }> {
    const e = reqStr(email, "email", 254).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, "invalid_request", "Not an email address.");
    if (site) {
      if (!by) throw new HttpError(403, "forbidden");
      await this.access(by, site.siteId, "owner");
      if (!["owner", "member", "viewer"].includes(site.role)) throw new HttpError(400, "invalid_request", "role must be owner, member or viewer.");
    }
    const token = randomToken(24);
    const id = newId(this.now().getTime());
    const expiresAt = new Date(this.now().getTime() + 7 * 86400_000).toISOString();
    await this.db.put({
      pk: `INVITE#${sha256(token)}`,
      sk: "META",
      id,
      email: e,
      siteId: site?.siteId,
      role: site?.role,
      invitedBy: by?.userId,
      expiresAt,
      ttl: ttlAt(expiresAt),
    });
    if (site && by) {
      await this.db.put({ pk: `SITE#${site.siteId}`, sk: `INVITE#${id}`, email: e, role: site.role, expiresAt, ttl: ttlAt(expiresAt) });
      await this.log(site.siteId, "site.member", by, { detail: { invited: e, role: site.role } });
    }
    return { id, url: `${this.opts.baseUrl}/oauth/invite/${token}`, expiresAt };
  }

  async peekInvite(token: string): Promise<{ id: string; email: string; siteId?: string; role?: Role } | undefined> {
    const r = await this.db.get<Rec & { id: string; email: string; siteId?: string; role?: Role; expiresAt: string }>(`INVITE#${sha256(token)}`, "META", true);
    if (!r || Date.parse(r.expiresAt) <= this.now().getTime()) return undefined;
    return { id: r.id, email: r.email, siteId: r.siteId, role: r.role };
  }

  /** Use an invite (single use). Returns the user id it now belongs to. */
  async acceptInvite(token: string, userId: string): Promise<void> {
    const r = await this.db.consume<Rec & { id: string; email: string; siteId?: string; role?: Role; expiresAt: string }>(`INVITE#${sha256(token)}`, "META");
    if (!r || Date.parse(r.expiresAt) <= this.now().getTime()) throw new HttpError(410, "invite_used", "This invite has been used or has expired.");
    if (r.siteId && r.role) {
      await this.addMember(r.siteId, userId, r.role);
      await this.db.delete(`SITE#${r.siteId}`, `INVITE#${r.id}`);
    }
  }

  async addMember(siteId: string, userId: string, role: Role): Promise<void> {
    const user = await this.getUser(userId);
    const at = this.now().toISOString();
    await this.db.put({ pk: `SITE#${siteId}`, sk: `MEMBER#${userId}`, role, addedAt: at, name: user?.name ?? "", email: user?.email ?? "" });
    await this.db.put({ pk: `USER#${userId}`, sk: `SITE#${siteId}`, role });
  }

  async setMemberRole(p: PersonPrincipal, siteId: string, userId: string, role: unknown): Promise<Member> {
    await this.access(p, siteId, "owner");
    if (!["owner", "member", "viewer"].includes(String(role))) throw new HttpError(400, "invalid_request", "role must be owner, member or viewer.");
    const m = await this.db.get<Rec>(`SITE#${siteId}`, `MEMBER#${userId}`);
    if (!m) throw new HttpError(404, "not_found");
    if (m.role === "owner" && role !== "owner") await this.ensureAnotherOwner(siteId, userId);
    await this.db.update(`SITE#${siteId}`, `MEMBER#${userId}`, { role });
    await this.db.update(`USER#${userId}`, `SITE#${siteId}`, { role });
    await this.log(siteId, "site.member", p, { detail: { userId, role } });
    return { userId, name: String(m.name), email: String(m.email), role: role as Role, addedAt: String(m.addedAt) };
  }

  async removeMember(p: PersonPrincipal, siteId: string, userId: string): Promise<void> {
    await this.access(p, siteId, "owner");
    const m = await this.db.get<Rec>(`SITE#${siteId}`, `MEMBER#${userId}`);
    if (!m) throw new HttpError(404, "not_found");
    if (m.role === "owner") await this.ensureAnotherOwner(siteId, userId);
    await this.db.delete(`SITE#${siteId}`, `MEMBER#${userId}`);
    await this.db.delete(`USER#${userId}`, `SITE#${siteId}`);
    await this.log(siteId, "site.member", p, { detail: { userId, removed: true } });
  }

  async revokeInvite(p: PersonPrincipal, siteId: string, inviteId: string): Promise<void> {
    await this.access(p, siteId, "owner");
    await this.db.delete(`SITE#${siteId}`, `INVITE#${inviteId}`);
  }

  private async ensureAnotherOwner(siteId: string, leaving: string): Promise<void> {
    const rows = await this.db.query<Rec>(`SITE#${siteId}`, { prefix: "MEMBER#" });
    if (!rows.some((r) => r.role === "owner" && r.sk !== `MEMBER#${leaving}`)) {
      throw new HttpError(409, "last_owner", "A site needs at least one owner.");
    }
  }

  private async teamOf(siteId: string): Promise<string[]> {
    const rows = await this.db.query<Rec>(`SITE#${siteId}`, { prefix: "MEMBER#" });
    return rows.filter((r) => r.role === "owner" || r.role === "member").map((r) => r.sk.slice(7));
  }

  // ------------------------------------------------------------------ items

  private async getItemRec(siteId: string, itemId: string): Promise<ItemRec> {
    if (typeof itemId !== "string" || !itemId) throw new HttpError(404, "not_found");
    const r = await this.db.get<ItemRec & Rec>(`SITE#${siteId}`, `ITEM#${itemId}`, true);
    if (!r) throw new HttpError(404, "not_found");
    return strip<ItemRec>(r)!;
  }

  private async nextNumber(siteId: string): Promise<number> {
    const r = await this.db.update<{ nextNumber: number }>(`SITE#${siteId}`, "META", {}, { add: { nextNumber: 1 } });
    return r.nextNumber;
  }

  async listItems(
    p: Principal,
    siteId: string,
    filter: { kind?: string; status?: string; q?: string; path?: string; mine?: boolean } = {},
  ): Promise<Item[]> {
    await this.access(p, siteId, "viewer", "read");
    let items = await this.siteItems(siteId);
    if (p.kind === "widget") {
      items = items.filter((i) => i.kind === "report");
      if (filter.mine) items = items.filter((i) => i.reporter?.kind === "user" && i.reporter.id === p.userId);
      if (filter.path) items = items.filter((i) => i.page?.path === filter.path);
    } else {
      if (filter.kind) items = items.filter((i) => i.kind === filter.kind);
      if (filter.path) items = items.filter((i) => i.page?.path === filter.path);
    }
    if (filter.status) {
      const ss = filter.status.split(",");
      items = items.filter((i) => ss.includes(i.status));
    }
    if (filter.q) {
      const q = filter.q.toLowerCase();
      items = items.filter((i) => i.title.toLowerCase().includes(q) || String(i.number) === q.replace(/^[#q-]+/i, ""));
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items.map((i) => (p.kind === "widget" ? widgetItem(i) : teamItem(i)));
  }

  async getItem(p: Principal, siteId: string, itemId: string): Promise<{ item: Item; messages: Message[]; log?: LogEvent[] }> {
    await this.access(p, siteId, "viewer", "read");
    const item = await this.getItemRec(siteId, itemId);
    const rows = await this.db.query<Message & Rec>(`ITEM#${itemId}`, { prefix: "MSG#" });
    let messages = rows.map((r) => strip<Message>(r)!);
    if (p.kind === "widget") {
      if (item.kind !== "report") throw new HttpError(404, "not_found");
      const now = this.now();
      messages = messages
        .filter((m) => visibleToUsers(m, now))
        .map(widgetMessage)
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id));
      return { item: widgetItem(item), messages };
    }
    const logRows = await this.db.query<LogEvent & Rec>(`SITE#${siteId}`, { prefix: "LOG#" });
    const log = logRows.map((r) => strip<LogEvent>(r)!).filter((e) => e.itemId === itemId);
    return { item: teamItem(item), messages, log };
  }

  /** A report from a host-site user (widget). Returns the item; the API adds upload policies. */
  async createReport(
    p: WidgetPrincipal,
    body: { title?: unknown; body?: unknown; page?: unknown; anchor?: unknown; capture?: unknown },
  ): Promise<Item> {
    const { site } = await this.access(p, p.siteId, "viewer");
    const text = reqStr(body.body, "body", LIMITS.body);
    const page = parsePage(body.page);
    const day = this.now().toISOString().slice(0, 10);
    await this.rateLimit(`report#${site.id}#${p.userId}#${day}`, LIMITS.reportsPerUserPerDay, 2 * 86400);
    const at = this.now().toISOString();
    const id = newId(this.now().getTime());
    const number = await this.nextNumber(site.id);
    const capture = parseCaptureIntent(body.capture);
    const title = str(body.title, "title", LIMITS.title, true) ?? summarise(text);
    const reporter: Author = { kind: "user", id: p.userId, name: p.name };
    const item: ItemRec = {
      id,
      siteId: site.id,
      number,
      kind: "report",
      title,
      status: "open",
      page,
      anchor: parseAnchor(body.anchor),
      reporter,
      labels: [],
      links: [],
      capture,
      counts: { messages: 1, drafts: 0 },
      visibleCount: 1,
      createdAt: at,
      updatedAt: at,
      lastUserMessageAt: at,
    };
    const msg: Message = {
      id: newId(this.now().getTime()),
      itemId: id,
      siteId: site.id,
      author: reporter,
      body: text,
      visibility: "user",
      state: "published",
      createdAt: at,
      publishedAt: at,
      releaseAt: at,
      via: { kind: "widget" },
    };
    await this.db.put({ pk: `SITE#${site.id}`, sk: `ITEM#${id}`, ...item });
    await this.db.put({ pk: `ITEM#${id}`, sk: `MSG#${msg.id}`, ...msg });
    await this.log(site.id, "item.created", p, { itemId: id, detail: { kind: "report", number } });
    return widgetItem(item);
  }

  /** Record which capture files arrived (the API checks them in S3 first). */
  async confirmCapture(p: WidgetPrincipal, itemId: string, files: Capture["files"], notes: string[]): Promise<Item> {
    await this.access(p, p.siteId, "viewer");
    const item = await this.getItemRec(p.siteId, itemId);
    if (item.reporter?.id !== p.userId) throw new HttpError(404, "not_found");
    if (!item.capture) throw new HttpError(409, "no_capture", "This report has no capture.");
    if (item.capture.confirmed) throw new HttpError(409, "already_confirmed", "The capture is already confirmed.");
    const capture: Capture = {
      ...item.capture,
      files,
      confirmed: true,
      context: { ...item.capture.context, notes: [...(item.capture.context.notes ?? []), ...notes] },
    };
    const r = await this.db.update<ItemRec & Rec>(`SITE#${p.siteId}`, `ITEM#${itemId}`, { capture });
    return widgetItem(strip<ItemRec>(r)!);
  }

  /** The capture record, after the same visibility check as the thread. */
  async captureFor(p: Principal, siteId: string, itemId: string, file: string): Promise<{ item: Item; file: CaptureFile }> {
    if (!["page", "pageMarked", "closeup", "html"].includes(file)) throw new HttpError(404, "not_found");
    await this.access(p, siteId, "viewer", "capture:read");
    const item = await this.getItemRec(siteId, itemId);
    if (p.kind === "widget" && item.kind !== "report") throw new HttpError(404, "not_found");
    if (!item.capture?.confirmed || !item.capture.files[file as CaptureFile]) throw new HttpError(404, "not_found", "That part of the capture was not sent.");
    return { item, file: file as CaptureFile };
  }

  /** A conversation or decision raised by a person or an agent. */
  async createItem(
    p: PersonPrincipal | AgentPrincipal,
    siteId: string,
    body: { kind?: unknown; title?: unknown; body?: unknown; decision?: unknown; links?: unknown },
    extra: { asker?: Decision["asker"] } = {},
  ): Promise<Item> {
    const kind = body.kind as ItemKind;
    if (kind !== "conversation" && kind !== "decision") throw new HttpError(400, "invalid_request", "kind must be conversation or decision.");
    const { site } = await this.access(p, siteId, "member", "decide");
    const at = this.now().toISOString();
    const id = newId(this.now().getTime());
    const decision = kind === "decision" ? parseDecision(body.decision, extra.asker) : undefined;
    const title = str(body.title, "title", LIMITS.title, true) ?? (decision ? summarise(decision.question) : undefined);
    if (!title) throw new HttpError(400, "invalid_request", "title is required.");
    const text = str(body.body, "body", LIMITS.body, true);
    const links = await this.parseLinks(siteId, body.links);
    const number = await this.nextNumber(siteId);
    const item: ItemRec = {
      id,
      siteId,
      number,
      kind,
      title,
      status: "open",
      labels: [],
      links,
      decision,
      counts: { messages: text ? 1 : 0, drafts: 0 },
      visibleCount: 0,
      createdAt: at,
      updatedAt: at,
    };
    await this.db.put({ pk: `SITE#${siteId}`, sk: `ITEM#${id}`, ...item });
    if (text) {
      const msg: Message = {
        id: newId(this.now().getTime()),
        itemId: id,
        siteId,
        author: this.author(p),
        body: text,
        visibility: "internal",
        state: "published",
        createdAt: at,
        publishedAt: at,
        via: this.via(p),
      };
      await this.db.put({ pk: `ITEM#${id}`, sk: `MSG#${msg.id}`, ...msg });
    }
    await this.log(siteId, decision?.asker ? "question.asked" : "item.created", p, {
      itemId: id,
      detail: { kind, number, ...(decision?.asker ? { asker: decision.asker.name, blocking: decision.blocking } : {}) },
    });
    if (decision) await this.notify({ type: "decision", site, item: teamItem(item), blocking: decision.blocking });
    return teamItem(item);
  }

  private async parseLinks(siteId: string, v: unknown): Promise<string[]> {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > 50) throw new HttpError(400, "invalid_request", "links must be a list of item ids.");
    const out: string[] = [];
    for (const id of v) {
      if (typeof id !== "string") throw new HttpError(400, "invalid_request", "links must be item ids.");
      await this.getItemRec(siteId, id);
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  async linkItems(p: PersonPrincipal | AgentPrincipal, siteId: string, itemId: string, links: unknown): Promise<Item> {
    await this.access(p, siteId, "member", "reply");
    const item = await this.getItemRec(siteId, itemId);
    const add = await this.parseLinks(siteId, links);
    const merged = [...new Set([...item.links, ...add.filter((l) => l !== itemId)])];
    const r = await this.db.update<ItemRec & Rec>(`SITE#${siteId}`, `ITEM#${itemId}`, { links: merged, updatedAt: this.now().toISOString() });
    await this.log(siteId, "item.updated", p, { itemId, detail: { links: add } });
    return teamItem(strip<ItemRec>(r)!);
  }

  async updateItem(p: PersonPrincipal | AgentPrincipal, siteId: string, itemId: string, body: { status?: unknown; title?: unknown; labels?: unknown }): Promise<Item> {
    await this.access(p, siteId, "member", "status");
    const item = (await this.getItemRec(siteId, itemId)) as ItemRec & { resolvedAt?: string };
    const set: Record<string, unknown> = {};
    if (body.status !== undefined) {
      if (!ITEM_STATUSES.includes(body.status as ItemStatus)) throw new HttpError(400, "invalid_request", `status must be one of ${ITEM_STATUSES.join(", ")}.`);
      set.status = body.status;
      if (body.status === "resolved") set.resolvedAt = this.now().toISOString();
      if (body.status === "closed") {
        set.closedAt = this.now().toISOString();
        if (!item.resolvedAt) set.resolvedAt = set.closedAt;
      }
    }
    if (body.title !== undefined) set.title = reqStr(body.title, "title", LIMITS.title);
    if (body.labels !== undefined) {
      if (!Array.isArray(body.labels) || body.labels.length > LIMITS.labels) throw new HttpError(400, "invalid_request", "labels must be a list.");
      set.labels = [...new Set(body.labels.map((l) => reqStr(l, "label", 40)))];
    }
    if (!Object.keys(set).length) throw new HttpError(400, "invalid_request", "Nothing to change.");
    set.updatedAt = this.now().toISOString();
    const r = await this.db.update<ItemRec & Rec>(`SITE#${siteId}`, `ITEM#${itemId}`, set);
    await this.log(siteId, "item.updated", p, { itemId, detail: set });
    return teamItem(strip<ItemRec>(r)!);
  }

  /**
   * The person who sent a report agrees it is sorted: resolved → closed, from the widget. Only their own
   * report, and only once the team has marked it resolved. Replying instead reopens it (postMessage).
   */
  async closeReport(p: WidgetPrincipal, itemId: string): Promise<Item> {
    await this.access(p, p.siteId, "viewer");
    const item = await this.getItemRec(p.siteId, itemId);
    if (item.kind !== "report" || item.reporter?.kind !== "user" || item.reporter.id !== p.userId) throw new HttpError(404, "not_found");
    if (item.status === "closed") return widgetItem(item);
    const at = this.now().toISOString();
    let r: ItemRec & Rec;
    try {
      r = await this.db.update<ItemRec & Rec>(`SITE#${p.siteId}`, `ITEM#${itemId}`, { status: "closed", closedAt: at, updatedAt: at }, {
        condition: "#st = :res",
        names: { "#st": "status" },
        values: { ":res": "resolved" },
      });
    } catch (e) {
      if (isConditionFailure(e)) throw new HttpError(409, "not_resolved", "Only a resolved report can be closed.");
      throw e;
    }
    await this.log(p.siteId, "item.updated", p, { itemId, detail: { status: "closed", by: "reporter" } });
    return widgetItem(strip<ItemRec>(r)!);
  }

  // ------------------------------------------------------------------ messages and the gate

  async postMessage(p: Principal, siteId: string, itemId: string, body: { body?: unknown; visibility?: unknown; resolves?: unknown }): Promise<Message> {
    const visibility: Visibility = p.kind === "widget" ? "user" : (body.visibility as Visibility);
    if (visibility !== "user" && visibility !== "internal") throw new HttpError(400, "invalid_request", "visibility must be internal or user.");
    const scope: AgentScope = visibility === "user" ? "reply:user" : "reply";
    const { site } = await this.access(p, siteId, p.kind === "widget" ? "viewer" : "member", scope);
    const item = await this.getItemRec(siteId, itemId);
    if (p.kind === "widget" && item.kind !== "report") throw new HttpError(404, "not_found");
    if (visibility === "user" && item.kind !== "report") {
      throw new HttpError(400, "invalid_request", "Only reports have site users to reply to; use an internal note.");
    }
    const text = reqStr(body.body, "body", LIMITS.body);
    if (body.resolves !== undefined && typeof body.resolves !== "boolean") throw new HttpError(400, "invalid_request", "resolves must be true or false.");
    const resolves = p.kind !== "widget" && visibility === "user" && body.resolves === true;
    if (resolves) await this.access(p, siteId, "member", "status");
    const now = this.now();
    const decided = decideMessageState({
      principal: p.kind,
      visibility,
      site,
      autoApproveAllowed: this.opts.autoApproveAllowed,
      now,
    });
    const at = now.toISOString();
    const msg: Message = {
      id: newId(now.getTime()),
      itemId,
      siteId,
      author: this.author(p),
      body: text,
      visibility,
      state: decided.state,
      createdAt: at,
      ...(decided.state === "published" ? { publishedAt: at } : {}),
      ...(decided.releaseAt ? { releaseAt: decided.releaseAt } : {}),
      ...(decided.autoApproved ? { autoApproved: true } : {}),
      ...(resolves ? { resolves: true } : {}),
      via: this.via(p),
    };
    await this.db.put({ pk: `ITEM#${itemId}`, sk: `MSG#${msg.id}`, ...msg });

    const set: Record<string, unknown> = { updatedAt: at };
    if (p.kind === "widget") {
      set.lastUserMessageAt = at;
      if (item.status !== "in_progress") set.status = "waiting_on_us";
    } else if (visibility === "user" && decided.state === "published") {
      set.lastTeamReplyAt = at;
      if (resolves) Object.assign(set, { status: "resolved", resolvedAt: at });
      else if (["open", "waiting_on_us"].includes(item.status)) set.status = "answered";
    }
    await this.bumpItem(siteId, itemId, set, {
      messages: 1,
      drafts: decided.state === "draft" ? 1 : 0,
      visible: visibility === "user" && decided.state === "published" ? 1 : 0,
    });
    await this.log(siteId, "message.created", p, {
      itemId,
      messageId: msg.id,
      detail: { visibility, state: msg.state, ...(msg.autoApproved ? { autoApproved: true } : {}), ...(resolves ? { resolves: true } : {}) },
    });
    if (msg.state === "draft") {
      await this.notify({ type: "draft", site, item: teamItem({ ...item, ...set } as ItemRec), blocking: false });
    }
    return p.kind === "widget" ? widgetMessage(msg) : msg;
  }

  private async bumpItem(siteId: string, itemId: string, set: Record<string, unknown>, by: { messages?: number; drafts?: number; visible?: number }) {
    const names: Record<string, string> = { "#c": "counts", "#m": "messages", "#d": "drafts", "#v": "visibleCount" };
    const values: Record<string, unknown> = { ":m": by.messages ?? 0, ":d": by.drafts ?? 0, ":v": by.visible ?? 0 };
    const sets: string[] = ["#c.#m = #c.#m + :m", "#c.#d = #c.#d + :d", "#v = if_not_exists(#v, :zero) + :v"];
    values[":zero"] = 0;
    let i = 0;
    for (const [k, v] of Object.entries(set)) {
      names[`#s${i}`] = k;
      values[`:s${i}`] = v;
      sets.push(`#s${i} = :s${i}`);
      i++;
    }
    const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
    await this.db.doc.send(
      new UpdateCommand({
        TableName: this.db.table,
        Key: { pk: `SITE#${siteId}`, sk: `ITEM#${itemId}` },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(pk)",
      }),
    );
  }

  private async getMessage(itemId: string, messageId: string): Promise<Message> {
    if (typeof messageId !== "string" || !messageId) throw new HttpError(404, "not_found");
    const m = await this.db.get<Message & Rec>(`ITEM#${itemId}`, `MSG#${messageId}`, true);
    if (!m) throw new HttpError(404, "not_found");
    return strip<Message>(m)!;
  }

  private async personOf(p: PersonPrincipal) {
    const u = await this.getUser(p.userId);
    return { id: p.userId, name: u?.name ?? p.name };
  }

  /** Approve and send (portal only), optionally with edited text. M2: held 10 seconds. */
  async approve(p: Principal, siteId: string, itemId: string, messageId: string, body: { body?: unknown } = {}): Promise<Message> {
    if (!canPublish(p.kind)) throw new HttpError(403, "forbidden", "Only a person in the portal can approve a draft.");
    const person = p as PersonPrincipal;
    await this.access(person, siteId, "member");
    const item = await this.getItemRec(siteId, itemId);
    const msg = await this.getMessage(itemId, messageId);
    if (msg.siteId !== siteId) throw new HttpError(404, "not_found");
    if (msg.state !== "draft") throw new HttpError(409, "not_a_draft", "This message is not a draft.");
    const edited = body.body !== undefined ? reqStr(body.body, "body", LIMITS.body) : undefined;
    const now = this.now();
    const at = now.toISOString();
    const set: Record<string, unknown> = {
      state: "published",
      publishedAt: at,
      releaseAt: releaseTime(now),
      approvedBy: await this.personOf(person),
      ...(edited !== undefined && edited !== msg.body ? { body: edited, editedAt: at, originalBody: msg.body } : {}),
    };
    let updated: Message;
    try {
      updated = strip<Message>(
        await this.db.update<Message & Rec>(`ITEM#${itemId}`, `MSG#${messageId}`, set, {
          condition: "#st = :draft",
          names: { "#st": "state" },
          values: { ":draft": "draft" },
        }),
      )!;
    } catch (e) {
      if (isConditionFailure(e)) throw new HttpError(409, "not_a_draft", "This message is not a draft.");
      throw e;
    }
    const itemSet: Record<string, unknown> = { updatedAt: at, lastTeamReplyAt: at };
    if (msg.resolves) {
      Object.assign(itemSet, { status: "resolved", resolvedAt: at });
      // Undo within the 10 seconds puts the report back where it was.
      await this.db.update(`ITEM#${itemId}`, `MSG#${messageId}`, { resolvedFrom: item.status });
    } else if (["open", "waiting_on_us"].includes(item.status)) itemSet.status = "answered";
    await this.bumpItem(siteId, itemId, itemSet, { drafts: -1, visible: 1 });
    await this.log(siteId, "message.published", person, { itemId, messageId, detail: { edited: edited !== undefined && edited !== msg.body } });
    return updated;
  }

  /** M2: within the 10 seconds, put an approved message back to draft. */
  async undo(p: Principal, siteId: string, itemId: string, messageId: string): Promise<Message> {
    if (!canPublish(p.kind)) throw new HttpError(403, "forbidden");
    const person = p as PersonPrincipal;
    await this.access(person, siteId, "member");
    const msg = await this.getMessage(itemId, messageId);
    if (msg.siteId !== siteId) throw new HttpError(404, "not_found");
    const nowIso = this.now().toISOString();
    if (msg.state !== "published" || !msg.approvedBy || msg.autoApproved || !msg.releaseAt || msg.releaseAt <= nowIso) {
      throw new HttpError(409, "too_late", "It has already been sent.");
    }
    const m = msg as Message & { originalBody?: string };
    let updated: Message;
    try {
      updated = strip<Message>(
        await this.db.update<Message & Rec>(
          `ITEM#${itemId}`,
          `MSG#${messageId}`,
          {
            state: "draft",
            publishedAt: undefined,
            releaseAt: undefined,
            approvedBy: undefined,
            ...(m.originalBody !== undefined ? { body: m.originalBody, originalBody: undefined, editedAt: undefined } : {}),
          },
          { condition: "#st = :pub AND #ra > :now", names: { "#st": "state", "#ra": "releaseAt" }, values: { ":pub": "published", ":now": nowIso } },
        ),
      )!;
    } catch (e) {
      if (isConditionFailure(e)) throw new HttpError(409, "too_late", "It has already been sent.");
      throw e;
    }
    const back = (m as Message & { resolvedFrom?: ItemStatus }).resolvedFrom;
    const undoSet: Record<string, unknown> = { updatedAt: nowIso };
    if (back) {
      const cur = await this.getItemRec(siteId, itemId);
      if (cur.status === "resolved") undoSet.status = back;
      await this.db.update(`ITEM#${itemId}`, `MSG#${messageId}`, { resolvedFrom: undefined });
    }
    await this.bumpItem(siteId, itemId, undoSet, { drafts: 1, visible: -1 });
    await this.log(siteId, "message.unpublished", person, { itemId, messageId });
    return updated;
  }

  /** Reject a draft with a reason; it stays as an internal note the agent can read. */
  async reject(p: Principal, siteId: string, itemId: string, messageId: string, body: { reason?: unknown }): Promise<Message> {
    if (!canPublish(p.kind)) throw new HttpError(403, "forbidden", "Only a person in the portal can reject a draft.");
    const person = p as PersonPrincipal;
    await this.access(person, siteId, "member");
    const reason = reqStr(body.reason, "reason", LIMITS.reason);
    const msg = await this.getMessage(itemId, messageId);
    if (msg.siteId !== siteId) throw new HttpError(404, "not_found");
    let updated: Message;
    try {
      updated = strip<Message>(
        await this.db.update<Message & Rec>(
          `ITEM#${itemId}`,
          `MSG#${messageId}`,
          { state: "rejected", rejectedReason: reason, rejectedBy: await this.personOf(person), rejectedAt: this.now().toISOString() },
          { condition: "#st = :draft", names: { "#st": "state" }, values: { ":draft": "draft" } },
        ),
      )!;
    } catch (e) {
      if (isConditionFailure(e)) throw new HttpError(409, "not_a_draft", "This message is not a draft.");
      throw e;
    }
    await this.bumpItem(siteId, itemId, { updatedAt: this.now().toISOString() }, { drafts: -1 });
    await this.log(siteId, "message.rejected", person, { itemId, messageId, detail: { reason } });
    return updated;
  }

  // ------------------------------------------------------------------ decisions and questions

  async answer(p: PersonPrincipal, siteId: string, itemId: string, body: { option?: unknown; text?: unknown }): Promise<Item> {
    await this.access(p, siteId, "member");
    const item = await this.getItemRec(siteId, itemId);
    const d = item.decision;
    if (!d) throw new HttpError(400, "invalid_request", "This item is not a decision.");
    if (d.status !== "waiting") throw new HttpError(409, "not_waiting", "This decision is not waiting for an answer.");
    const option = str(body.option, "option", 120, true);
    const text = str(body.text, "text", LIMITS.body, true);
    if (d.options.length && !option) throw new HttpError(400, "invalid_request", "Choose an option.");
    if (option && !d.options.some((o) => o.label === option)) throw new HttpError(400, "invalid_request", "No such option.");
    if (!d.options.length && !text) throw new HttpError(400, "invalid_request", "Write your answer.");
    const at = this.now().toISOString();
    const decision: Decision = { ...d, status: "answered", answer: { option, text, by: await this.personOf(p), at } };
    const r = await this.db.update<ItemRec & Rec>(`SITE#${siteId}`, `ITEM#${itemId}`, { decision, status: "answered", updatedAt: at, answeredAt: at });
    await this.log(siteId, d.asker ? "question.answered" : "decision.answered", p, { itemId, detail: { option, asker: d.asker?.name } });
    return teamItem(strip<ItemRec>(r)!);
  }

  async withdrawQuestion(p: AgentPrincipal | PersonPrincipal, siteId: string, itemId: string, reason: unknown): Promise<Item> {
    await this.access(p, siteId, "member", "decide");
    const item = await this.getItemRec(siteId, itemId);
    const d = item.decision;
    if (!d) throw new HttpError(404, "not_found");
    if (d.status !== "waiting") throw new HttpError(409, "not_waiting", "This question is not waiting.");
    const at = this.now().toISOString();
    const decision: Decision = { ...d, status: "withdrawn", withdrawnReason: str(reason, "reason", LIMITS.reason, true) };
    const r = await this.db.update<ItemRec & Rec>(`SITE#${siteId}`, `ITEM#${itemId}`, { decision, status: "resolved", updatedAt: at, answeredAt: at });
    await this.log(siteId, "question.withdrawn", p, { itemId, detail: { reason: decision.withdrawnReason } });
    return teamItem(strip<ItemRec>(r)!);
  }

  /** Decisions across the principal's sites (questions = decisions with an asker). */
  async decisions(p: PersonPrincipal | AgentPrincipal, filter: { site?: string; status?: string; asker?: string; questionsOnly?: boolean } = {}) {
    const sites = await this.mySites(p, false);
    const out: Array<{ site: Pick<Site, "id" | "name">; item: Item }> = [];
    for (const s of sites) {
      if (filter.site && s.id !== filter.site) continue;
      for (const i of await this.siteItems(s.id)) {
        if (!i.decision) continue;
        if (filter.questionsOnly && !i.decision.asker) continue;
        if (filter.asker && i.decision.asker?.name !== filter.asker) continue;
        if (filter.status && i.decision.status !== filter.status) continue;
        out.push({ site: { id: s.id, name: s.name }, item: teamItem(i) });
      }
    }
    return out.sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt));
  }

  // ------------------------------------------------------------------ attention and changes

  async attention(p: PersonPrincipal): Promise<Attention> {
    const sites = await this.mySites(p, false);
    const out: Attention = { drafts: [], decisions: [], newFromUsers: [], unanswered: [] };
    for (const s of sites) {
      const site = { id: s.id, name: s.name };
      for (const i of await this.siteItems(s.id)) {
        const item = teamItem(i);
        if (i.decision?.status === "waiting") out.decisions.push({ site, item });
        const waitingOnUs =
          i.kind === "report" && !isDone(i.status) && !!i.lastUserMessageAt && (!i.lastTeamReplyAt || i.lastUserMessageAt > i.lastTeamReplyAt);
        if (i.counts.drafts <= 0 && !waitingOnUs) continue;
        const msgs = (await this.db.query<Message & Rec>(`ITEM#${i.id}`, { prefix: "MSG#" })).map((r) => strip<Message>(r)!);
        for (const m of msgs) if (m.state === "draft") out.drafts.push({ site, item, message: m });
        if (waitingOnUs) {
          if (!i.lastTeamReplyAt) out.unanswered.push({ site, item });
          else {
            const last = [...msgs].reverse().find((m) => m.author.kind === "user");
            if (last) out.newFromUsers.push({ site, item, message: last });
          }
        }
      }
    }
    out.decisions.sort((a, b) => Number(b.item.decision?.blocking) - Number(a.item.decision?.blocking) || a.item.createdAt.localeCompare(b.item.createdAt));
    out.drafts.sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt));
    return out;
  }

  /** Everything changed since a cursor (an event id), across the agent's sites. */
  async changes(p: AgentPrincipal | PersonPrincipal, since?: string, limit = 100): Promise<{ events: LogEvent[]; cursor: string }> {
    const sites = await this.mySites(p, false);
    const events: LogEvent[] = [];
    for (const s of sites) {
      const rows = await this.db.query<LogEvent & Rec>(`SITE#${s.id}`, since ? { after: `LOG#${since}`, prefix: "LOG#" } : { prefix: "LOG#" });
      events.push(...rows.map((r) => strip<LogEvent>(r)!));
    }
    events.sort((a, b) => a.id.localeCompare(b.id));
    const page = events.slice(0, Math.min(limit, 500));
    const cursor = page.length ? page[page.length - 1]!.id : (since ?? newId(0));
    return { events: page, cursor };
  }

  // ------------------------------------------------------------------ personal access tokens

  async listTokens(p: PersonPrincipal): Promise<PersonalAccessToken[]> {
    const rows = await this.db.query<PersonalAccessToken & Rec>(`USER#${p.userId}`, { prefix: "PAT#" });
    return rows.map((r) => {
      const t = strip<PersonalAccessToken & { hash?: string }>(r)!;
      delete t.hash;
      return t;
    });
  }

  async createToken(p: PersonPrincipal, body: { name?: unknown; sites?: unknown; scopes?: unknown; expiresInDays?: unknown }) {
    const name = reqStr(body.name, "name", LIMITS.name);
    const sites = Array.isArray(body.sites) ? body.sites.map(String) : [];
    if (!sites.length) throw new HttpError(400, "invalid_request", "Choose at least one site.");
    for (const s of sites) await this.access(p, s, "member");
    const scopes = parseScopes(body.scopes);
    const days = Number(body.expiresInDays ?? 90);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, "invalid_request", "expiresInDays must be 1-365.");
    const token = `ann_pat_${randomToken(32)}`;
    const hash = sha256(token);
    const id = newId(this.now().getTime());
    const expiresAt = new Date(this.now().getTime() + days * 86400_000).toISOString();
    const pat: PersonalAccessToken = { id, name, sites, scopes, createdAt: this.now().toISOString(), expiresAt };
    await this.db.put({ pk: `PAT#${hash}`, sk: "META", ...pat, userId: p.userId, ttl: ttlAt(expiresAt) });
    await this.db.put({ pk: `USER#${p.userId}`, sk: `PAT#${id}`, ...pat, hash, ttl: ttlAt(expiresAt) });
    return { token, pat };
  }

  async revokeToken(p: PersonPrincipal, id: string): Promise<void> {
    const r = await this.db.get<Rec & { hash: string }>(`USER#${p.userId}`, `PAT#${id}`);
    if (!r) throw new HttpError(404, "not_found");
    await this.db.delete(`PAT#${r.hash}`, "META");
    await this.db.delete(`USER#${p.userId}`, `PAT#${id}`);
  }

  /** Resolve a personal access token to an agent principal (MCP). */
  async principalFromPat(token: string): Promise<AgentPrincipal | undefined> {
    if (!token.startsWith("ann_pat_")) return undefined;
    const hash = sha256(token);
    const r = await this.db.get<Rec & PersonalAccessToken & { userId: string }>(`PAT#${hash}`, "META", true);
    if (!r || Date.parse(r.expiresAt) <= this.now().getTime()) return undefined;
    const user = await this.getUser(r.userId);
    if (!user) return undefined;
    const at = this.now().toISOString();
    if (!r.lastUsedAt || Date.parse(r.lastUsedAt) < this.now().getTime() - 60_000) {
      await this.db.update(`PAT#${hash}`, "META", { lastUsedAt: at }).catch(() => {});
      await this.db.update(`USER#${r.userId}`, `PAT#${r.id}`, { lastUsedAt: at }).catch(() => {});
    }
    return {
      kind: "agent",
      userId: r.userId,
      name: user.name,
      sites: r.sites,
      scopes: new Set(r.scopes),
      via: { kind: "token", clientName: r.name, clientId: `pat:${r.id}` },
      patId: r.id,
    };
  }

  // ------------------------------------------------------------------ connected agents (OAuth grants)

  async recordGrant(userId: string, g: { grantId: string; clientId: string; clientName: string; sites: string[]; scopes: string[] }) {
    const at = this.now().toISOString();
    await this.db.put({ pk: `GRANT#${g.grantId}`, sk: "META", userId, ...g, createdAt: at });
    await this.db.put({ pk: `USER#${userId}`, sk: `GRANT#${g.grantId}`, ...g, createdAt: at });
  }

  async grant(grantId: string): Promise<(AgentGrant & { userId: string }) | undefined> {
    const r = await this.db.get<Rec & AgentGrant & { userId: string }>(`GRANT#${grantId}`, "META");
    return strip(r);
  }

  async touchGrant(grantId: string, userId: string): Promise<void> {
    const at = this.now().toISOString();
    await this.db.update(`USER#${userId}`, `GRANT#${grantId}`, { lastUsedAt: at }).catch(() => {});
  }

  async listAgents(p: PersonPrincipal): Promise<AgentGrant[]> {
    const rows = await this.db.query<AgentGrant & Rec>(`USER#${p.userId}`, { prefix: "GRANT#" });
    return rows.map((r) => strip<AgentGrant>(r)!);
  }

  /** Forget a grant here; the caller also revokes its OAuth records (adapter.revokeByGrantId). */
  async removeGrant(userId: string, grantId: string): Promise<boolean> {
    const r = await this.db.get(`USER#${userId}`, `GRANT#${grantId}`);
    if (!r) return false;
    await this.db.delete(`USER#${userId}`, `GRANT#${grantId}`);
    await this.db.delete(`GRANT#${grantId}`, "META");
    return true;
  }

  // ------------------------------------------------------------------ passkeys and recovery codes

  async passkeys(userId: string): Promise<Array<Passkey & { publicKey: string; counter: number; transports?: string[] }>> {
    const rows = await this.db.query<Rec>(`USER#${userId}`, { prefix: "PASSKEY#" });
    return rows.map((r) => strip(r)!) as Array<Passkey & { publicKey: string; counter: number; transports?: string[] }>;
  }

  async addPasskey(userId: string, pk: { id: string; name: string; publicKey: string; counter: number; transports?: string[] }): Promise<Passkey> {
    const at = this.now().toISOString();
    if (!(await this.db.putNew({ pk: `PASSKEY#${pk.id}`, sk: "META", userId }))) throw new HttpError(409, "passkey_exists", "That passkey is already registered.");
    await this.db.put({ pk: `USER#${userId}`, sk: `PASSKEY#${pk.id}`, ...pk, createdAt: at });
    return { id: pk.id, name: pk.name, createdAt: at };
  }

  async passkeyOwner(credentialId: string): Promise<string | undefined> {
    return (await this.db.get<{ userId: string }>(`PASSKEY#${credentialId}`, "META"))?.userId;
  }

  async usedPasskey(userId: string, credentialId: string, counter: number): Promise<void> {
    await this.db.update(`USER#${userId}`, `PASSKEY#${credentialId}`, { counter, lastUsedAt: this.now().toISOString() });
  }

  async removePasskey(userId: string, credentialId: string): Promise<void> {
    const all = await this.passkeys(userId);
    if (!all.some((k) => k.id === credentialId)) throw new HttpError(404, "not_found");
    if (all.length <= 1) throw new HttpError(409, "last_passkey", "Keep at least one passkey.");
    await this.db.delete(`USER#${userId}`, `PASSKEY#${credentialId}`);
    await this.db.delete(`PASSKEY#${credentialId}`, "META");
  }

  /** Ten new recovery codes (replacing any old ones); returned once, stored hashed. */
  async newRecoveryCodes(userId: string): Promise<string[]> {
    const old = await this.db.query<Rec>(`USER#${userId}`, { prefix: "RECOVERY#" });
    await this.db.deleteMany(old.map((r) => ({ pk: r.pk, sk: r.sk })));
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const raw = randomToken(10).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10).padEnd(10, "X");
      const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
      codes.push(code);
      await this.db.put({ pk: `USER#${userId}`, sk: `RECOVERY#${sha256(code)}`, createdAt: this.now().toISOString() });
    }
    return codes;
  }

  /** Use a recovery code (single use). */
  async useRecoveryCode(email: string, code: string): Promise<string | undefined> {
    const userId = await this.userByEmail(email);
    if (!userId) return undefined;
    const norm = code.trim().toUpperCase().replace(/\s+/g, "");
    const used = await this.db.consume(`USER#${userId}`, `RECOVERY#${sha256(norm)}`);
    return used ? userId : undefined;
  }

  // ------------------------------------------------------------------ WebAuthn challenges, replay, rate limits

  async saveChallenge(challenge: string, data: Record<string, unknown>, seconds = 300): Promise<string> {
    const id = randomToken(16);
    await this.db.put({ pk: `CHAL#${id}`, sk: "META", challenge, ...data, expiresAt: Date.now() + seconds * 1000, ttl: ttlAt(Date.now() + seconds * 1000) });
    return id;
  }

  async takeChallenge(id: string): Promise<(Record<string, unknown> & { challenge: string }) | undefined> {
    if (!id) return undefined;
    const r = await this.db.consume<Rec & { challenge: string; expiresAt: number }>(`CHAL#${id}`, "META");
    if (!r || r.expiresAt < Date.now()) return undefined;
    return strip(r);
  }

  /** Remember an assertion jti until it expires. False = seen before (replay). */
  async rememberJti(siteId: string, jti: string, expSeconds: number): Promise<boolean> {
    return this.db.putNew({ pk: `JTI#${siteId}#${jti}`, sk: "META", ttl: expSeconds + 60 });
  }

  async rateLimit(key: string, max: number, windowSeconds: number): Promise<void> {
    const pk = `RATE#${key}`;
    const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
    const r = await this.db.doc.send(
      new UpdateCommand({
        TableName: this.db.table,
        Key: { pk, sk: "META" },
        UpdateExpression: "ADD #n :one SET #t = if_not_exists(#t, :ttl)",
        ExpressionAttributeNames: { "#n": "n", "#t": "ttl" },
        ExpressionAttributeValues: { ":one": 1, ":ttl": Math.floor(Date.now() / 1000) + windowSeconds },
        ReturnValues: "ALL_NEW",
      }),
    );
    if (Number(r.Attributes?.n ?? 0) > max) throw new HttpError(429, "rate_limited", "Too many requests. Try again later.");
  }

  // ------------------------------------------------------------------ push subscriptions

  async addPushSubscription(p: PersonPrincipal, body: { endpoint?: unknown; keys?: unknown; device?: unknown }): Promise<void> {
    const endpoint = reqStr(body.endpoint, "endpoint", 2000);
    if (!endpoint.startsWith("https://")) throw new HttpError(400, "invalid_request", "endpoint must be https.");
    const keys = body.keys as { p256dh?: unknown; auth?: unknown } | undefined;
    const p256dh = reqStr(keys?.p256dh, "keys.p256dh", 200);
    const auth = reqStr(keys?.auth, "keys.auth", 100);
    const device = str(body.device, "device", 120, true) ?? "This device";
    await this.db.put({ pk: `USER#${p.userId}`, sk: `PUSH#${sha256(endpoint)}`, endpoint, keys: { p256dh, auth }, device, createdAt: this.now().toISOString() });
  }

  async removePushSubscription(userId: string, endpoint: string): Promise<void> {
    await this.db.delete(`USER#${userId}`, `PUSH#${sha256(endpoint)}`);
  }

  async pushSubscriptions(userId: string): Promise<Array<{ endpoint: string; keys: { p256dh: string; auth: string }; device: string }>> {
    const rows = await this.db.query<Rec>(`USER#${userId}`, { prefix: "PUSH#" });
    return rows.map((r) => strip(r)!) as Array<{ endpoint: string; keys: { p256dh: string; auth: string }; device: string }>;
  }

  private async notify(e: { type: "draft" | "decision"; site: Site; item: Item; blocking: boolean }): Promise<void> {
    if (!this.opts.notify) return;
    try {
      await this.opts.notify({ type: e.type, siteId: e.site.id, siteName: e.site.name, item: e.item, blocking: e.blocking, userIds: await this.teamOf(e.site.id) });
    } catch (err) {
      console.warn(JSON.stringify({ msg: "notify failed", error: String(err) }));
    }
  }

  // ------------------------------------------------------------------ retention (jobs)

  /** Every site id (the registry written by createSite), for the retention job. */
  async allSiteIds(): Promise<string[]> {
    const rows = await this.db.query<Rec>("SITES", { prefix: "SITE#" });
    return rows.map((r) => r.sk.slice(5));
  }

  /** Captures whose report was resolved longer ago than the site's retention (default 90 days). */
  async capturesToPurge(): Promise<Array<{ siteId: string; itemId: string }>> {
    const out: Array<{ siteId: string; itemId: string }> = [];
    const now = this.now().getTime();
    for (const siteId of await this.allSiteIds()) {
      const site = await this.siteRec(siteId);
      if (!site) continue;
      for (const i of (await this.siteItems(siteId)) as Array<ItemRec & { resolvedAt?: string }>) {
        if (!isDone(i.status) || !i.resolvedAt || !i.capture || i.capture.files === undefined) continue;
        if ((i.capture as Capture & { purged?: boolean }).purged) continue;
        if (Date.parse(i.resolvedAt) + site.retentionDays * 86400_000 < now) out.push({ siteId, itemId: i.id });
      }
    }
    return out;
  }

  async markCapturePurged(siteId: string, itemId: string): Promise<void> {
    const item = await this.getItemRec(siteId, itemId);
    if (!item.capture) return;
    await this.db.update(`SITE#${siteId}`, `ITEM#${itemId}`, {
      capture: { ...item.capture, files: {}, purged: true, context: { ...item.capture.context, notes: [...(item.capture.context.notes ?? []), "Capture deleted after the retention period."] } },
    });
  }
}

// ------------------------------------------------------------------ views

function countsOf(items: ItemRec[]): SiteCounts {
  let open = 0;
  let drafts = 0;
  let decisions = 0;
  let unanswered = 0;
  for (const i of items) {
    if (!isDone(i.status)) open++;
    drafts += i.counts.drafts;
    if (i.decision?.status === "waiting") decisions++;
    if (i.kind === "report" && !isDone(i.status) && !i.lastTeamReplyAt) unanswered++;
  }
  return { open, drafts, decisions, unanswered };
}

function teamItem(i: ItemRec): Item {
  const { visibleCount: _v, ...rest } = i as ItemRec & { resolvedAt?: string; answeredAt?: string };
  return rest;
}

/** What a host-site user may see of an item. */
function widgetItem(i: ItemRec): Item {
  return {
    id: i.id,
    siteId: i.siteId,
    number: i.number,
    kind: i.kind,
    title: i.title,
    status: i.status,
    page: i.page,
    anchor: i.anchor,
    reporter: i.reporter ? { kind: i.reporter.kind, id: i.reporter.kind === "user" ? i.reporter.id : "", name: i.reporter.name } : undefined,
    labels: [],
    links: [],
    capture: i.capture,
    counts: { messages: i.visibleCount ?? 0, drafts: 0 },
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

function widgetMessage(m: Message): Message {
  return {
    id: m.id,
    itemId: m.itemId,
    siteId: m.siteId,
    author: m.author,
    body: m.body,
    visibility: "user",
    state: "published",
    createdAt: m.releaseAt ?? m.createdAt,
    ...(m.editedAt ? {} : {}),
  };
}

// ------------------------------------------------------------------ parsing

function parseOrigins(v: unknown): string[] {
  if (!Array.isArray(v)) throw new HttpError(400, "invalid_request", "origins must be a list.");
  if (v.length > LIMITS.origins) throw new HttpError(400, "invalid_request", `At most ${LIMITS.origins} origins.`);
  return [...new Set(v.map(normaliseOrigin))];
}

function parseScopes(v: unknown): AgentScope[] {
  const all: readonly string[] = AGENT_SCOPES;
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, "invalid_request", "Choose at least one scope.");
  for (const s of v) if (!all.includes(String(s))) throw new HttpError(400, "invalid_request", `Unknown scope: ${s}`);
  return [...new Set(v.map(String))] as AgentScope[];
}

function parsePreferences(v: unknown): Preferences {
  const o = (v ?? {}) as Record<string, unknown>;
  const qh = o.quietHours as Record<string, unknown> | null | undefined;
  let quietHours: Preferences["quietHours"] = null;
  if (qh) {
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (typeof qh.start !== "string" || !re.test(qh.start) || typeof qh.end !== "string" || !re.test(qh.end)) {
      throw new HttpError(400, "invalid_request", "Quiet hours need start and end as HH:MM.");
    }
    const tz = typeof qh.timeZone === "string" ? qh.timeZone : "UTC";
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    } catch {
      throw new HttpError(400, "invalid_request", "Unknown time zone.");
    }
    quietHours = { start: qh.start, end: qh.end, timeZone: tz };
  }
  const push = (o.push ?? {}) as Record<string, unknown>;
  return { quietHours, push: { drafts: push.drafts !== false, decisions: push.decisions !== false } };
}

function parsePage(v: unknown): Item["page"] {
  const o = v as Record<string, unknown> | undefined;
  if (!o || typeof o !== "object") throw new HttpError(400, "invalid_request", "page is required.");
  const url = reqStr(o.url, "page.url", 2000);
  let path = str(o.path, "page.path", 2000, true);
  try {
    path ??= new URL(url).pathname;
  } catch {
    throw new HttpError(400, "invalid_request", "page.url must be a URL.");
  }
  return { url, path, title: str(o.title, "page.title", 300, true), route: str(o.route, "page.route", 200, true) };
}

function parseAnchor(v: unknown): Item["anchor"] {
  if (!v) return undefined;
  const o = v as Record<string, unknown>;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : undefined);
  const pt = (q: unknown) => {
    const r = q as Record<string, unknown> | undefined;
    const x = num(r?.x);
    const y = num(r?.y);
    return x !== undefined && y !== undefined ? { x, y } : undefined;
  };
  return {
    selector: reqStr(o.selector, "anchor.selector", 2000),
    label: str(o.label, "anchor.label", 300, true),
    offset: pt(o.offset),
    point: pt(o.point),
  };
}

const MAX_JSON = 64 * 1024;

function parseCaptureIntent(v: unknown): Capture | undefined {
  if (!v) return undefined;
  const o = v as Record<string, unknown>;
  const ctx = o.context as Record<string, unknown> | undefined;
  if (!ctx || typeof ctx !== "object") throw new HttpError(400, "invalid_request", "capture.context is required.");
  if (JSON.stringify(v).length > MAX_JSON) throw new HttpError(413, "too_large", "The capture record is too large.");
  const method = ctx.method === "screen" || ctx.method === "dom" ? ctx.method : "none";
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const vp = (ctx.viewport ?? {}) as Record<string, unknown>;
  const sc = (ctx.scroll ?? {}) as Record<string, unknown>;
  const context = {
    url: reqStr(ctx.url, "capture.context.url", 2000),
    route: str(ctx.route, "route", 200, true),
    title: str(ctx.title, "title", 300, true),
    viewport: { width: n(vp.width), height: n(vp.height) },
    devicePixelRatio: n(ctx.devicePixelRatio) || 1,
    scroll: { x: n(sc.x), y: n(sc.y) },
    userAgent: str(ctx.userAgent, "userAgent", 500, true),
    buildId: str(ctx.buildId, "buildId", 100, true),
    capturedAt: str(ctx.capturedAt, "capturedAt", 40, true) ?? new Date().toISOString(),
    method: method as "dom" | "screen" | "none",
    masked: ctx.masked && typeof ctx.masked === "object" ? { fields: n((ctx.masked as Record<string, unknown>).fields), elements: n((ctx.masked as Record<string, unknown>).elements) } : undefined,
    notes: Array.isArray(ctx.notes) ? ctx.notes.slice(0, 10).map((x) => String(x).slice(0, 200)) : undefined,
  };
  let part: Capture["part"];
  if (o.part && typeof o.part === "object") {
    const pr = o.part as Record<string, unknown>;
    const rect = (r: unknown) => {
      const q = (r ?? {}) as Record<string, unknown>;
      return { x: n(q.x), y: n(q.y), width: n(q.width), height: n(q.height) };
    };
    const box = (pr.box ?? {}) as Record<string, unknown>;
    part = {
      selector: reqStr(pr.selector, "part.selector", 2000),
      label: str(pr.label, "part.label", 300, true),
      box: { page: rect(box.page), screenshot: rect(box.screenshot) },
      role: str(pr.role, "part.role", 60, true),
      name: str(pr.name, "part.name", 300, true),
      text: typeof pr.text === "string" ? pr.text.slice(0, 500) : undefined,
      outerHTML: typeof pr.outerHTML === "string" ? pr.outerHTML.slice(0, 8192) : undefined,
      ancestors: Array.isArray(pr.ancestors) ? pr.ancestors.slice(0, 30).map((a) => String(a).slice(0, 200)) : undefined,
      styles:
        pr.styles && typeof pr.styles === "object"
          ? Object.fromEntries(Object.entries(pr.styles as Record<string, unknown>).slice(0, 20).map(([k, val]) => [k.slice(0, 40), String(val).slice(0, 200)]))
          : undefined,
    };
  }
  return { context, part, files: {}, confirmed: false };
}

function parseDecision(v: unknown, asker?: Decision["asker"]): Decision {
  const o = (v ?? {}) as Record<string, unknown>;
  const options: DecisionOption[] = [];
  if (o.options !== undefined) {
    if (!Array.isArray(o.options) || o.options.length > 8) throw new HttpError(400, "invalid_request", "options must be a list of at most 8.");
    for (const opt of o.options as Array<Record<string, unknown>>) {
      options.push({
        label: reqStr(opt?.label, "option.label", 120),
        text: reqStr(opt?.text, "option.text", 2000),
        consequence: str(opt?.consequence, "option.consequence", 2000, true),
      });
    }
    if (new Set(options.map((x) => x.label)).size !== options.length) throw new HttpError(400, "invalid_request", "Option labels must differ.");
  }
  return {
    question: reqStr(o.question, "question", 2000),
    context: str(o.context, "context", LIMITS.body * 4, true),
    options,
    recommendation: str(o.recommendation, "recommendation", 2000, true),
    blocking: o.blocking === true,
    asker,
    status: "waiting",
  };
}

function summarise(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 77)}…` : one;
}

function sha256(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("base64url");
}
