// Typed client for every portal route in docs/api.md §2. Shapes come from @annotatie/core.

import type {
  AgentGrant,
  AgentScope,
  Attention,
  CaptureFile,
  Item,
  ItemKind,
  ItemStatus,
  LogEvent,
  Member,
  Message,
  Passkey,
  PersonalAccessToken,
  Person,
  Preferences,
  Role,
  Site,
  SiteKey,
  Visibility,
} from "@annotatie/core";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  get offline(): boolean {
    return this.code === "network";
  }
}

/** Sends a request to a path under the API origin (it adds the token). */
export type Requester = (path: string, init?: RequestInit) => Promise<Response>;

export interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

export interface NewDecision {
  question: string;
  context?: string;
  options: Array<{ label: string; text: string; consequence?: string }>;
  recommendation?: string;
  blocking: boolean;
}

export type Api = ReturnType<typeof createApi>;

const enc = encodeURIComponent;

export function createApi(request: Requester) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await request(path, {
        method,
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e instanceof Error && "code" in e && (e as { code: string }).code !== "network") {
        throw new ApiError(401, (e as unknown as { code: string }).code, e.message);
      }
      throw new ApiError(0, "network", "No connection.");
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!res.ok) {
      const j = (json ?? {}) as { error?: string; message?: string };
      throw new ApiError(res.status, j.error || `http_${res.status}`, j.message || `The request failed (${res.status}).`);
    }
    return json as T;
  }

  const s = (siteId: string) => `/api/sites/${enc(siteId)}`;
  const it = (siteId: string, itemId: string) => `${s(siteId)}/items/${enc(itemId)}`;

  return {
    // me
    me: () => call<{ user: Person; sites: Site[]; preferences: Preferences }>("GET", "/api/me"),
    putPreferences: (p: Preferences) => call<Preferences>("PUT", "/api/me/preferences", p),
    attention: () => call<Attention>("GET", "/api/attention"),

    // sites
    createSite: (b: { name: string; origins: string[] }) => call<Site>("POST", "/api/sites", b),
    site: (siteId: string) => call<Site>("GET", s(siteId)),
    patchSite: (siteId: string, b: { name?: string; origins?: string[]; retentionDays?: number; privacyMode?: boolean }) =>
      call<Site>("PATCH", s(siteId), b),
    setAutoApprove: (siteId: string, on: boolean, until?: string | null) =>
      call<Site>("PUT", `${s(siteId)}/auto-approve`, until === undefined ? { on } : { on, until }),

    // keys
    keys: (siteId: string) => call<{ keys: SiteKey[] }>("GET", `${s(siteId)}/keys`),
    addKey: (siteId: string, b: { kid?: string; publicKeyJwk: SiteKey["publicKeyJwk"] }) =>
      call<SiteKey>("POST", `${s(siteId)}/keys`, b),
    retireKey: (siteId: string, kid: string) => call<SiteKey>("DELETE", `${s(siteId)}/keys/${enc(kid)}`),

    // members
    members: (siteId: string) => call<{ members: Member[]; invites: Invite[] }>("GET", `${s(siteId)}/members`),
    invite: (siteId: string, b: { email: string; role: Role }) =>
      call<{ id: string; url: string; expiresAt: string }>("POST", `${s(siteId)}/invites`, b),
    setMemberRole: (siteId: string, userId: string, role: Role) =>
      call<Member>("PATCH", `${s(siteId)}/members/${enc(userId)}`, { role }),
    removeMember: (siteId: string, userId: string) => call<void>("DELETE", `${s(siteId)}/members/${enc(userId)}`),

    // items
    items: (siteId: string, f: { kind?: ItemKind; status?: ItemStatus; q?: string } = {}) => {
      const q = new URLSearchParams();
      if (f.kind) q.set("kind", f.kind);
      if (f.status) q.set("status", f.status);
      if (f.q) q.set("q", f.q);
      const qs = q.toString();
      return call<{ items: Item[] }>("GET", `${s(siteId)}/items${qs ? `?${qs}` : ""}`);
    },
    createItem: (siteId: string, b: { kind: "conversation" | "decision"; title: string; body?: string; decision?: NewDecision }) =>
      call<Item>("POST", `${s(siteId)}/items`, b),
    item: (siteId: string, itemId: string) =>
      call<{ item: Item; messages: Message[]; log: LogEvent[] }>("GET", it(siteId, itemId)),
    patchItem: (siteId: string, itemId: string, b: { status?: ItemStatus; title?: string; labels?: string[] }) =>
      call<Item>("PATCH", it(siteId, itemId), b),
    postMessage: (siteId: string, itemId: string, b: { body: string; visibility: Visibility }) =>
      call<Message>("POST", `${it(siteId, itemId)}/messages`, b),
    approve: (siteId: string, itemId: string, messageId: string, body?: string) =>
      call<Message>("POST", `${it(siteId, itemId)}/messages/${enc(messageId)}/approve`, body === undefined ? {} : { body }),
    undo: (siteId: string, itemId: string, messageId: string) =>
      call<Message>("POST", `${it(siteId, itemId)}/messages/${enc(messageId)}/undo`, {}),
    reject: (siteId: string, itemId: string, messageId: string, reason: string) =>
      call<Message>("POST", `${it(siteId, itemId)}/messages/${enc(messageId)}/reject`, { reason }),
    answer: (siteId: string, itemId: string, b: { option?: string; text?: string }) =>
      call<Item>("POST", `${it(siteId, itemId)}/answer`, b),
    captureUrl: (siteId: string, itemId: string, file: Exclude<CaptureFile, "html">) =>
      call<{ url: string }>("GET", `${it(siteId, itemId)}/capture/${file}`),
    /** The page copy as HTML text: render it only in a sandboxed srcdoc iframe. */
    captureHtml: async (siteId: string, itemId: string): Promise<string> => {
      let res: Response;
      try {
        res = await request(`${it(siteId, itemId)}/capture/html`, { method: "GET", headers: { Accept: "text/html" } });
      } catch {
        throw new ApiError(0, "network", "No connection.");
      }
      if (!res.ok) throw new ApiError(res.status, `http_${res.status}`, "The page copy isn't available.");
      return res.text();
    },
    log: (siteId: string, before?: string) =>
      call<{ events: LogEvent[] }>("GET", `${s(siteId)}/log${before ? `?before=${enc(before)}` : ""}`),

    // tokens and agents
    tokens: () => call<{ tokens: PersonalAccessToken[] }>("GET", "/api/tokens"),
    createToken: (b: { name: string; sites: string[]; scopes: AgentScope[]; expiresInDays: number }) =>
      call<{ token: string; pat: PersonalAccessToken }>("POST", "/api/tokens", b),
    revokeToken: (id: string) => call<void>("DELETE", `/api/tokens/${enc(id)}`),
    agents: () => call<{ agents: AgentGrant[] }>("GET", "/api/agents"),
    revokeAgent: (grantId: string) => call<void>("DELETE", `/api/agents/${enc(grantId)}`),

    // passkeys
    passkeys: () => call<{ passkeys: Passkey[] }>("GET", "/api/me/passkeys"),
    passkeyOptions: () => call<Record<string, unknown>>("POST", "/api/me/passkeys/options", {}),
    addPasskey: (b: { name: string; response: unknown }) => call<Passkey>("POST", "/api/me/passkeys", b),
    deletePasskey: (id: string) => call<void>("DELETE", `/api/me/passkeys/${enc(id)}`),

    // push (M1)
    pushKey: () => call<{ publicKey: string }>("GET", "/api/push/key"),
    subscribePush: (b: { endpoint: string; keys: { p256dh: string; auth: string }; device: string }) =>
      call<void>("POST", "/api/push/subscriptions", b),
    unsubscribePush: (endpoint: string) => call<void>("DELETE", "/api/push/subscriptions", { endpoint }),
  };
}
