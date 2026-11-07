// The HTTP API (docs/api.md): portal routes under /api, widget routes under /api/w. A thin layer over
// the domain service; every permission check lives there.
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { type CaptureFile, HttpError } from "@annotatie/core";
import {
  apiPrincipal,
  bearer,
  revokeGrantRecords,
  type PersonPrincipal,
  type Service,
  verifyJwt,
  type WidgetPrincipal,
} from "@annotatie/store";
import type { JWTVerifyGetKey } from "jose";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { CaptureStore } from "./captures.js";
import { exchange as sdkExchange, signAssertion, type TokenResponse } from "@annotatie/sdk-server-node";

/** Annotatie's own site: the portal hosts the widget, so its team can report on Annotatie itself. */
export interface SelfSite {
  siteId: string;
  kid: string;
  privateKeyPem: string;
}

export interface AppDeps {
  svc: Service;
  captures: CaptureStore;
  baseUrl: string;
  keys: JWTVerifyGetKey;
  vapidPublicKey: () => Promise<string>;
  buildSha: string;
  /** Annotatie's own site, once `setup-self-site` has run; undefined until then. */
  selfSite?: () => Promise<SelfSite | undefined>;
  /** The RFC 7523 exchange (default: POST <base>/oauth/token, exactly as any host does). */
  exchange?: (assertion: string) => Promise<TokenResponse>;
}

type Res = APIGatewayProxyStructuredResultV2;
type Ctx = { method: string; path: string; query: Record<string, string>; body: Record<string, unknown>; origin?: string };
type Handler = (ctx: Ctx, params: string[], p: PersonPrincipal | WidgetPrincipal) => Promise<unknown>;

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function createApp(deps: AppDeps) {
  const { svc, captures } = deps;

  const person = (p: PersonPrincipal | WidgetPrincipal): PersonPrincipal => {
    if (p.kind !== "person") throw new HttpError(403, "forbidden", "Portal only.");
    return p;
  };
  const widget = (p: PersonPrincipal | WidgetPrincipal): WidgetPrincipal => {
    if (p.kind !== "widget") throw new HttpError(403, "forbidden", "Widget only.");
    return p;
  };

  const routes: Array<[string, RegExp, Handler]> = [];
  const on = (method: string, pattern: string, h: Handler) => {
    const re = new RegExp("^" + pattern.replace(/\{[a-zA-Z]+\}/g, "([A-Za-z0-9_.-]+)") + "$");
    routes.push([method, re, h]);
  };

  // ---------------------------------------------------------------- portal
  on("GET", "/api/me", (_c, _p, p) => svc.me(person(p)));
  // The portal as a host site: it vouches for its signed-in person exactly as any host's server does
  // (signed assertion → token exchange). Only members of Annotatie's own site get a token; everyone
  // else gets 404 and the portal never loads the widget.
  on("GET", "/api/self/widget-token", async (_c, _p, p) => {
    const me = person(p);
    const self = await deps.selfSite?.();
    if (!self) throw new HttpError(404, "not_found");
    await svc.access(me, self.siteId, "viewer");
    const user = await svc.getUser(me.userId);
    if (!user) throw new HttpError(404, "not_found");
    const assertion = signAssertion({
      siteId: self.siteId,
      kid: self.kid,
      privateKey: self.privateKeyPem,
      user: { id: me.userId, name: user.name, ...(user.email ? { email: user.email } : {}) },
      base: deps.baseUrl,
    });
    const exchange = deps.exchange ?? ((a: string) => sdkExchange({ assertion: a, base: deps.baseUrl }));
    const t = await exchange(assertion).catch((e) => {
      console.error(JSON.stringify({ msg: "self widget token refused", error: String(e) }));
      throw new HttpError(502, "token_unavailable", "The feedback widget is unavailable right now.");
    });
    return { siteId: self.siteId, access_token: t.access_token, expires_in: t.expires_in };
  });
  on("PUT", "/api/me/preferences", (c, _p, p) => svc.setPreferences(person(p), c.body));
  on("GET", "/api/attention", (_c, _p, p) => svc.attention(person(p)));
  on("GET", "/api/decisions", (c, _p, p) => svc.decisions(person(p), { site: c.query.site, status: c.query.status }).then((decisions) => ({ decisions })));
  on("POST", "/api/sites", (c, _p, p) => svc.createSite(person(p), c.body));
  on("GET", "/api/sites/{s}", (_c, [s], p) => svc.getSite(person(p), s!));
  on("PATCH", "/api/sites/{s}", (c, [s], p) => svc.updateSite(person(p), s!, c.body));
  on("PUT", "/api/sites/{s}/auto-approve", (c, [s], p) => svc.setAutoApprove(person(p), s!, c.body));
  on("GET", "/api/sites/{s}/keys", (_c, [s], p) => svc.listKeys(person(p), s!).then((keys) => ({ keys })));
  on("POST", "/api/sites/{s}/keys", (c, [s], p) => svc.addKey(person(p), s!, c.body));
  on("DELETE", "/api/sites/{s}/keys/{kid}", (_c, [s, kid], p) => svc.retireKey(person(p), s!, kid!));
  on("GET", "/api/sites/{s}/members", (_c, [s], p) => svc.listMembers(person(p), s!));
  on("POST", "/api/sites/{s}/invites", (c, [s], p) => svc.createInvite(person(p), c.body.email, { siteId: s!, role: c.body.role as "member" }));
  on("DELETE", "/api/sites/{s}/invites/{id}", (_c, [s, id], p) => svc.revokeInvite(person(p), s!, id!).then(() => null));
  on("PATCH", "/api/sites/{s}/members/{u}", (c, [s, u], p) => svc.setMemberRole(person(p), s!, u!, c.body.role));
  on("DELETE", "/api/sites/{s}/members/{u}", (_c, [s, u], p) => svc.removeMember(person(p), s!, u!).then(() => null));
  on("GET", "/api/sites/{s}/items", (c, [s], p) => svc.listItems(person(p), s!, { kind: c.query.kind, status: c.query.status, q: c.query.q }).then((items) => ({ items })));
  on("POST", "/api/sites/{s}/items", (c, [s], p) => svc.createItem(person(p), s!, c.body));
  on("GET", "/api/sites/{s}/items/{i}", (_c, [s, i], p) => svc.getItem(person(p), s!, i!));
  on("PATCH", "/api/sites/{s}/items/{i}", (c, [s, i], p) => svc.updateItem(person(p), s!, i!, c.body));
  on("POST", "/api/sites/{s}/items/{i}/messages", (c, [s, i], p) => svc.postMessage(person(p), s!, i!, c.body));
  on("POST", "/api/sites/{s}/items/{i}/messages/{m}/approve", (c, [s, i, m], p) => svc.approve(person(p), s!, i!, m!, c.body));
  on("POST", "/api/sites/{s}/items/{i}/messages/{m}/undo", (_c, [s, i, m], p) => svc.undo(person(p), s!, i!, m!));
  on("POST", "/api/sites/{s}/items/{i}/messages/{m}/reject", (c, [s, i, m], p) => svc.reject(person(p), s!, i!, m!, c.body));
  on("POST", "/api/sites/{s}/items/{i}/answer", (c, [s, i], p) => svc.answer(person(p), s!, i!, c.body));
  on("GET", "/api/sites/{s}/items/{i}/capture/{f}", (_c, [s, i, f], p) => captureView(person(p), s!, i!, f!));
  on("GET", "/api/sites/{s}/log", (c, [s], p) => svc.listLog(person(p), s!, c.query.before).then((events) => ({ events })));
  on("GET", "/api/tokens", (_c, _p, p) => svc.listTokens(person(p)).then((tokens) => ({ tokens })));
  on("POST", "/api/tokens", (c, _p, p) => svc.createToken(person(p), c.body));
  on("DELETE", "/api/tokens/{id}", (_c, [id], p) => svc.revokeToken(person(p), id!).then(() => null));
  on("GET", "/api/agents", (_c, _p, p) => svc.listAgents(person(p)).then((agents) => ({ agents })));
  on("DELETE", "/api/agents/{g}", async (_c, [g], p) => {
    const me = person(p);
    if (!(await svc.removeGrant(me.userId, g!))) throw new HttpError(404, "not_found");
    await revokeGrantRecords(svc.db, g!);
    return null;
  });
  on("GET", "/api/me/passkeys", async (_c, _p, p) => ({
    passkeys: (await svc.passkeys(person(p).userId)).map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt })),
  }));
  on("POST", "/api/me/passkeys/options", async (_c, _p, p) => {
    const me = person(p);
    const user = (await svc.getUser(me.userId))!;
    const existing = await svc.passkeys(me.userId);
    const options = await generateRegistrationOptions({
      rpName: "Annotatie",
      rpID: new URL(deps.baseUrl).hostname,
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(me.userId),
      attestationType: "none",
      excludeCredentials: existing.map((k) => ({ id: k.id, transports: k.transports as never })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    const challengeId = await svc.saveChallenge(options.challenge, { userId: me.userId, purpose: "register" });
    return { ...options, challengeId };
  });
  on("POST", "/api/me/passkeys", async (c, _p, p) => {
    const me = person(p);
    const chal = await svc.takeChallenge(String(c.body.challengeId ?? ""));
    if (!chal || chal.userId !== me.userId || chal.purpose !== "register") throw new HttpError(400, "invalid_request", "The passkey request expired. Try again.");
    const v = await verifyRegistrationResponse({
      response: c.body.response as never,
      expectedChallenge: chal.challenge,
      expectedOrigin: deps.baseUrl,
      expectedRPID: new URL(deps.baseUrl).hostname,
    }).catch(() => ({ verified: false, registrationInfo: undefined }));
    if (!v.verified || !v.registrationInfo) throw new HttpError(400, "invalid_request", "The passkey could not be verified.");
    const cred = v.registrationInfo.credential;
    return svc.addPasskey(me.userId, {
      id: cred.id,
      name: String(c.body.name ?? "Passkey").slice(0, 60),
      publicKey: Buffer.from(cred.publicKey).toString("base64url"),
      counter: cred.counter,
      transports: cred.transports,
    });
  });
  on("DELETE", "/api/me/passkeys/{id}", (_c, [id], p) => svc.removePasskey(person(p).userId, id!).then(() => null));
  on("GET", "/api/push/key", async (_c, _p, p) => (person(p), { publicKey: await deps.vapidPublicKey() }));
  on("POST", "/api/push/subscriptions", (c, _p, p) => svc.addPushSubscription(person(p), c.body).then(() => null));
  on("DELETE", "/api/push/subscriptions", (c, _p, p) => svc.removePushSubscription(person(p).userId, String(c.body.endpoint ?? c.query.endpoint ?? "")).then(() => null));

  // ---------------------------------------------------------------- widget
  on("GET", "/api/w/me", async (_c, _p, p) => {
    const w = widget(p);
    const site = await svc.getSite(w, w.siteId);
    return { user: { id: w.userId, name: w.name }, site: { id: site.id, name: site.name, privacyMode: site.privacyMode } };
  });
  on("GET", "/api/w/items", (c, _p, p) => {
    const w = widget(p);
    return svc.listItems(w, w.siteId, { path: c.query.path, mine: c.query.mine === "1" }).then((items) => ({ items }));
  });
  on("POST", "/api/w/items", async (c, _p, p) => {
    const w = widget(p);
    const item = await svc.createReport(w, c.body);
    const wanted = Object.keys(((c.body.capture as Record<string, unknown> | undefined)?.files ?? {}) as Record<string, unknown>).filter((f): f is CaptureFile =>
      ["page", "pageMarked", "closeup", "html"].includes(f),
    );
    const uploads = item.capture && wanted.length ? await captures.uploadPolicies(w.siteId, item.id, wanted) : {};
    return { item, uploads };
  });
  on("POST", "/api/w/items/{i}/capture", async (c, [i], p) => {
    const w = widget(p);
    await svc.getItem(w, w.siteId, i!); // visibility check before touching S3
    const claimed = (c.body.files ?? {}) as Record<string, { size: number; sha256: string }>;
    const clean: Record<string, { size: number; sha256: string }> = {};
    for (const [f, v] of Object.entries(claimed)) {
      if (["page", "pageMarked", "closeup", "html"].includes(f) && typeof v?.size === "number" && typeof v?.sha256 === "string") clean[f] = v;
    }
    const { files, notes } = await captures.confirm(w.siteId, i!, clean);
    return svc.confirmCapture(w, i!, files, notes);
  });
  on("GET", "/api/w/items/{i}", (_c, [i], p) => {
    const w = widget(p);
    return svc.getItem(w, w.siteId, i!);
  });
  on("POST", "/api/w/items/{i}/messages", (c, [i], p) => {
    const w = widget(p);
    return svc.postMessage(w, w.siteId, i!, { body: c.body.body });
  });
  on("GET", "/api/w/items/{i}/capture/{f}", (_c, [i, f], p) => {
    const w = widget(p);
    return captureView(w, w.siteId, i!, f!);
  });

  async function captureView(p: PersonPrincipal | WidgetPrincipal, siteId: string, itemId: string, f: string): Promise<unknown> {
    const { file } = await svc.captureFor(p, siteId, itemId, f);
    if (file === "html") {
      const gz = await captures.html(siteId, itemId);
      // Never served as an HTML page: the portal reads it as text into a sandboxed srcdoc iframe.
      return raw(200, gz.toString("base64"), {
        "content-type": "text/plain; charset=utf-8",
        "content-encoding": "gzip",
        "content-security-policy": "sandbox; default-src 'none'",
        "content-disposition": "attachment; filename=page.html",
      }, true);
    }
    return { url: await captures.viewUrl(siteId, itemId, file) };
  }

  // ---------------------------------------------------------------- dispatch
  return async function handle(event: APIGatewayProxyEventV2): Promise<Res> {
    const method = event.requestContext?.http?.method ?? "GET";
    const path = (event.rawPath ?? "/").replace(/\/+$/, "") || "/";
    const headers = lower(event.headers ?? {});
    const origin = headers.origin;
    const isWidget = path.startsWith("/api/w/");
    const cors = isWidget && origin ? corsHeaders(origin) : {};

    try {
      if (path === "/api/health" && (method === "GET" || method === "HEAD")) {
        return json(200, { status: "ok", service: "annotatie-api", version: deps.buildSha });
      }
      if (method === "OPTIONS") {
        // Preflight carries no token, so the site is unknown here: the real request is checked below.
        return { statusCode: 204, headers: { ...cors, ...SECURITY_HEADERS } };
      }
      const match = routes.find(([m, re]) => m === method && re.test(path));
      if (!match) {
        const anyMethod = routes.some(([, re]) => re.test(path));
        throw new HttpError(anyMethod ? 405 : 404, anyMethod ? "method_not_allowed" : "not_found");
      }
      const params = match[1].exec(path)!.slice(1).map(decodeURIComponent);

      const claims = await verifyJwt(bearer(headers), deps.baseUrl, `${deps.baseUrl}/api`, deps.keys);
      const p = await apiPrincipal(claims, svc);
      if (p.kind === "widget") {
        if (!isWidget) throw new HttpError(403, "forbidden", "Widget tokens are for /api/w only.");
        const site = await svc.getSite(p, p.siteId);
        // Browsers omit Origin on same-origin GETs. That only happens when the widget runs on
        // Annotatie's own pages (the portal hosting it), which Sec-Fetch-Site says; then the page's
        // origin is ours.
        const pageOrigin = origin ?? (headers["sec-fetch-site"] === "same-origin" ? deps.baseUrl : undefined);
        if (!pageOrigin || !site.origins.includes(pageOrigin)) throw new HttpError(403, "origin_not_allowed", "This page's origin is not allowed for the site.");
      } else if (isWidget) {
        throw new HttpError(403, "forbidden", "Portal tokens are not for the widget API.");
      } else if (origin && origin !== deps.baseUrl) {
        throw new HttpError(403, "origin_not_allowed");
      }

      const body = parseBody(event);
      const result = await match[2]({ method, path, query: (event.queryStringParameters ?? {}) as Record<string, string>, body, origin }, params, p);
      if (isRaw(result)) return { ...result, headers: { ...SECURITY_HEADERS, ...result.headers, ...cors } };
      if (result === null) return { statusCode: 204, headers: { ...SECURITY_HEADERS, ...cors } };
      return json(method === "POST" && /\/(sites|items|tokens|invites|keys|passkeys|messages)$/.test(path) ? 201 : 200, result, cors);
    } catch (e) {
      if (e instanceof HttpError) {
        const extra: Record<string, string> = e.status === 401 ? { "www-authenticate": `Bearer error="invalid_token"` } : {};
        return json(e.status, { error: e.code, message: e.message }, { ...cors, ...extra });
      }
      console.error(JSON.stringify({ msg: "unhandled", path, method, error: String(e), stack: (e as Error).stack }));
      return json(500, { error: "server_error", message: "Something went wrong." }, cors);
    }
  };
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function lower(h: Record<string, string | undefined>): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h)) o[k.toLowerCase()] = v;
  return o;
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  if (text.length > 256 * 1024) throw new HttpError(413, "too_large", "The request is too large.");
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid_json", "The body must be a JSON object.");
  }
}

export function json(statusCode: number, body: unknown, extra: Record<string, string> = {}): Res {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
    body: JSON.stringify(body),
  };
}

const RAW = Symbol("raw");
function raw(statusCode: number, body: string, headers: Record<string, string>, isBase64Encoded = false) {
  return { [RAW]: true, statusCode, body, headers, isBase64Encoded };
}
function isRaw(v: unknown): v is Res & { headers: Record<string, string> } {
  return !!v && typeof v === "object" && RAW in (v as object);
}
