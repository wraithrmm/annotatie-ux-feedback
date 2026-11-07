import { beforeAll, describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import type { CaptureFile } from "@annotatie/core";
import { Service } from "@annotatie/store";
import { createApp } from "../src/app.js";
import type { CaptureStore } from "../src/captures.js";
import { sanitisePageCopy } from "../src/captures.js";
import { freshDb } from "../../../packages/store/test/helpers.js";

const BASE = "https://annotatie.test";
const SHOP = "https://shop.example.com";
let sign: (claims: Record<string, unknown>, aud?: string, key?: CryptoKey) => Promise<string>;
let otherKey: CryptoKey;
let app: ReturnType<typeof createApp>;
let svc: Service;
let ownerId: string;
let jwks: ReturnType<typeof createLocalJWKSet>;

const fakeCaptures: CaptureStore = {
  async uploadPolicies(_s, _i, files) {
    return Object.fromEntries(files.map((f) => [f, { url: "https://s3.test/bucket", fields: { key: `pending/${f}` } }]));
  },
  async confirm(_s, _i, claimed) {
    return { files: Object.fromEntries(Object.entries(claimed).map(([f, v]) => [f, { size: v.size }])), notes: [] };
  },
  async viewUrl(_s, _i, f: CaptureFile) {
    return `https://s3.test/view/${f}`;
  },
  async html() {
    return Buffer.from("gz");
  },
  async bytes() {
    return Buffer.from("RIFF0000WEBP");
  },
  async purge() {},
};

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const other = await generateKeyPair("ES256");
  otherKey = other.privateKey as CryptoKey;
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  sign = (claims, aud = `${BASE}/api`, key = privateKey as CryptoKey) =>
    new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(BASE).setAudience(aud).setIssuedAt().setExpirationTime("5m").sign(key);
  svc = new Service(await freshDb(), { autoApproveAllowed: true, baseUrl: BASE });
  ownerId = await svc.createUser("Riley Chen", "riley@example.com");
  jwks = createLocalJWKSet({ keys: [jwk] });
  app = createApp({ svc, captures: fakeCaptures, baseUrl: BASE, keys: jwks, vapidPublicKey: async () => "vapid", buildSha: "abc1234" });
});

function ev(method: string, path: string, opts: { token?: string; body?: unknown; origin?: string; fetchSite?: string; query?: Record<string, string> } = {}): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.fetchSite ? { "sec-fetch-site": opts.fetchSite } : {}),
    },
    queryStringParameters: opts.query,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  } as unknown as APIGatewayProxyEventV2;
}

async function call(...a: Parameters<typeof ev>) {
  const r = await app(ev(...a));
  const headers = (r.headers ?? {}) as Record<string, string>;
  const isJson = headers["content-type"]?.startsWith("application/json");
  return { status: r.statusCode!, body: r.body ? (isJson ? JSON.parse(r.body) : r.body) : null, headers };
}

const portal = () => sign({ sub: ownerId, client_id: "annotatie-portal", scope: "openid offline_access" });
const widgetTok = (site: string, sub = "host-1") => sign({ sub, client_id: `site:${site}`, scope: "report", site, name: "Sam Patel" });

describe("health and routing", () => {
  it("answers the health check with the build sha", async () => {
    const r = await call("GET", "/api/health");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok", service: "annotatie-api", version: "abc1234" });
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("404 for unknown routes, 401 without a token", async () => {
    expect((await call("GET", "/api/does-not-exist")).status).toBe(404);
    const r = await call("GET", "/api/me");
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toContain("Bearer");
  });
});

describe("token checks", () => {
  it("refuses an MCP-audience token, a forged token and an unknown client", async () => {
    expect((await call("GET", "/api/me", { token: await sign({ sub: ownerId, client_id: "x", gid: "g" }, `${BASE}/mcp`) })).status).toBe(401);
    expect((await call("GET", "/api/me", { token: await sign({ sub: ownerId, client_id: "annotatie-portal" }, `${BASE}/api`, otherKey) })).status).toBe(401);
    expect((await call("GET", "/api/me", { token: await sign({ sub: ownerId, client_id: "some-agent" }) })).status).toBe(401);
  });

  it("the portal reads its user", async () => {
    const r = await call("GET", "/api/me", { token: await portal() });
    expect(r.status).toBe(200);
    expect(r.body.user.name).toBe("Riley Chen");
  });
});

describe("portal and widget over HTTP", () => {
  it("full flow: site, report with capture, draft, approve, undo, reject", async () => {
    const tok = await portal();
    const site = (await call("POST", "/api/sites", { token: tok, body: { name: "Acme Shop", origins: [SHOP] } })).body;
    expect(site.role).toBe("owner");
    const wt = await widgetTok(site.id);

    // origin checks
    expect((await call("GET", "/api/w/items", { token: wt })).status).toBe(403);
    expect((await call("GET", "/api/w/items", { token: wt, origin: "https://evil.example" })).status).toBe(403);
    // a widget token can't use portal routes; a portal token can't use widget routes
    expect((await call("GET", "/api/me", { token: wt, origin: SHOP })).status).toBe(403);
    expect((await call("GET", "/api/w/items", { token: tok })).status).toBe(403);

    const created = await call("POST", "/api/w/items", {
      token: wt,
      origin: SHOP,
      body: {
        body: "Price looks wrong",
        page: { url: `${SHOP}/cart`, path: "/cart" },
        anchor: { selector: "#total" },
        capture: { context: { url: `${SHOP}/cart`, viewport: { width: 390, height: 844 }, method: "dom" }, files: { page: { size: 10 }, html: { size: 5 }, bogus: {} } },
      },
    });
    expect(created.status).toBe(201);
    expect(created.headers["access-control-allow-origin"]).toBe(SHOP);
    expect(Object.keys(created.body.uploads).sort()).toEqual(["html", "page"]);
    const itemId = created.body.item.id;

    const conf = await call("POST", `/api/w/items/${itemId}/capture`, { token: wt, origin: SHOP, body: { files: { page: { size: 10, sha256: "x" }, html: { size: 5, sha256: "y" } } } });
    expect(conf.status).toBe(200);
    expect(conf.body.capture.confirmed).toBe(true);

    const view = await call("GET", `/api/w/items/${itemId}/capture/page`, { token: wt, origin: SHOP });
    expect(view.body.url).toBe("https://s3.test/view/page");
    const html = await call("GET", `/api/sites/${site.id}/items/${itemId}/capture/html`, { token: tok });
    expect(html.headers["content-type"]).toContain("text/plain");
    expect(html.headers["content-security-policy"]).toContain("sandbox");

    expect((await call("GET", "/api/w/items", { token: wt, origin: SHOP, query: { path: "/cart" } })).body.items).toHaveLength(1);
    expect((await call("GET", "/api/w/items", { token: await widgetTok(site.id, "host-2"), origin: SHOP, query: { mine: "1" } })).body.items).toHaveLength(0);

    await call("POST", `/api/sites/${site.id}/items/${itemId}/messages`, { token: tok, body: { body: "Checking the tax rule", visibility: "internal" } });
    const draft = await svc.postMessage(
      { kind: "agent", userId: ownerId, name: "Riley Chen", sites: null, scopes: new Set(["reply:user"]), via: { kind: "agent" } },
      site.id,
      itemId,
      { body: "Fixed in the next release", visibility: "user" },
    );
    let thread = await call("GET", `/api/w/items/${itemId}`, { token: wt, origin: SHOP });
    expect(thread.body.messages.map((m: { body: string }) => m.body)).toEqual(["Price looks wrong"]);

    expect((await call("GET", "/api/attention", { token: tok })).body.drafts).toHaveLength(1);

    const approved = await call("POST", `/api/sites/${site.id}/items/${itemId}/messages/${draft.id}/approve`, { token: tok, body: {} });
    expect(approved.body.state).toBe("published");
    const undo = await call("POST", `/api/sites/${site.id}/items/${itemId}/messages/${draft.id}/undo`, { token: tok });
    expect(undo.body.state).toBe("draft");
    const rej = await call("POST", `/api/sites/${site.id}/items/${itemId}/messages/${draft.id}/reject`, { token: tok, body: { reason: "Not yet true" } });
    expect(rej.body.state).toBe("rejected");

    thread = await call("GET", `/api/w/items/${itemId}`, { token: wt, origin: SHOP });
    expect(thread.body.messages).toHaveLength(1);

    const reply = await call("POST", `/api/w/items/${itemId}/messages`, { token: wt, origin: SHOP, body: { body: "Any news?" } });
    expect(reply.status).toBe(201);
    expect(reply.body.via).toBeUndefined();

    const other = (await call("POST", "/api/sites", { token: tok, body: { name: "Other", origins: [SHOP] } })).body;
    expect((await call("GET", `/api/w/items/${itemId}`, { token: await widgetTok(other.id), origin: SHOP })).status).toBe(404);
  });

  it("validation errors are 400 with a message", async () => {
    const r = await call("POST", "/api/sites", { token: await portal(), body: { name: "", origins: ["ftp://x"] } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_request");
  });

  it("preflight answers CORS for the widget only", async () => {
    const r = await call("OPTIONS", "/api/w/items", { origin: SHOP });
    expect(r.status).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe(SHOP);
    const p = await call("OPTIONS", "/api/me", { origin: SHOP });
    expect(p.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("page copy sanitising (server side)", () => {
  it("removes scripts, handlers, javascript: and data:text/html URLs, frames and base", () => {
    const dirty = `<!doctype html><html><head><base href="https://evil/"><meta http-equiv="refresh" content="0;url=https://evil"><link rel="stylesheet" href="https://evil/x.css"><script>alert(1)</script></head>
      <body onload="x()"><a href="javascript:alert(1)">a</a><a href="JaVa&#x09;script:alert(1)">b</a><img src="x" onerror="alert(1)"><img src="https://tracker/p.gif">
      <iframe srcdoc="<script>1</script>"></iframe><object data="x"></object><form action="javascript:1"><button formaction="javascript:1">b</button></form>
      <a href="data:text/html,<script>1</script>">c</a><svg><a xlink:href="javascript:1"></a></svg><div style="background:url(https://tracker/x)">s</div>
      <style>@import url(https://evil/x.css); .a{background:url(https://evil/y)}</style><p data-annotatie-target>kept</p></body></html>`;
    const out = sanitisePageCopy(dirty);
    expect(out).not.toMatch(/<script|onload|onerror|javascript:|<iframe|<object|<base|http-equiv|<link|data:text\/html|https:\/\/tracker|@import|https:\/\/evil/i);
    expect(out).toContain("data-annotatie-target");
    expect(out).toContain("kept");
  });
});

describe("the portal as a host: GET /api/self/widget-token", () => {
  it("signs an assertion for members of Annotatie's own site and exchanges it; 404 for everyone else", async () => {
    expect((await call("GET", "/api/self/widget-token", { token: await portal() })).status).toBe(404);

    const { generateSiteKey } = await import("@annotatie/sdk-server-node");
    const { decodeJwt, decodeProtectedHeader } = await import("jose");
    const key = generateSiteKey();
    const ownerP = { kind: "person" as const, userId: ownerId, name: "Riley Chen", via: { kind: "portal" as const } };
    const site = await svc.createSite(ownerP, { name: "Annotatie", origins: [BASE] });
    const outsiderId = await svc.createUser("Ola Out", "ola@example.com");
    const seen: string[] = [];
    let refuse = false;
    const selfApp = createApp({
      svc,
      captures: fakeCaptures,
      baseUrl: BASE,
      keys: jwks,
      vapidPublicKey: async () => "vapid",
      buildSha: "abc1234",
      selfSite: async () => ({ siteId: site.id, kid: key.kid, privateKeyPem: key.privateKeyPem }),
      exchange: async (a) => {
        if (refuse) throw new Error("invalid_grant");
        seen.push(a);
        return { access_token: "widget-tok", expires_in: 300, scope: "report" };
      },
    });
    const get = async (sub: string) => {
      const r = await selfApp(ev("GET", "/api/self/widget-token", { token: await sign({ sub, client_id: "annotatie-portal", scope: "openid" }) }));
      return { status: r.statusCode!, body: JSON.parse(r.body ?? "null"), headers: r.headers as Record<string, string> };
    };

    const ok = await get(ownerId);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ siteId: site.id, access_token: "widget-tok", expires_in: 300 });
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(ok.body)).not.toContain("PRIVATE");
    expect(decodeProtectedHeader(seen[0]!)).toMatchObject({ alg: "EdDSA", kid: key.kid });
    expect(decodeJwt(seen[0]!)).toMatchObject({ iss: site.id, sub: ownerId, name: "Riley Chen", email: "riley@example.com", aud: `${BASE}/oauth/token` });

    expect((await get(outsiderId)).status).toBe(404);
    expect(seen).toHaveLength(1);

    refuse = true;
    const down = await get(ownerId);
    expect(down.status).toBe(502);
    expect(down.body.error).toBe("token_unavailable");
  });

  it("refuses widget tokens (portal only)", async () => {
    const r = await call("GET", "/api/self/widget-token", { token: await widgetTok("any") });
    expect(r.status).toBe(403);
  });
});

describe("the widget on Annotatie's own pages (same-origin GETs carry no Origin)", () => {
  it("accepts a same-origin GET without Origin when the site allows the portal's origin, and nothing else", async () => {
    const ownerP = { kind: "person" as const, userId: ownerId, name: "Riley Chen", via: { kind: "portal" as const } };
    const own = await svc.createSite(ownerP, { name: "Annotatie itself", origins: [BASE] });
    const shop = await svc.createSite(ownerP, { name: "Shop only", origins: [SHOP] });
    const ownTok = await widgetTok(own.id);
    expect((await call("GET", "/api/w/items", { token: ownTok, fetchSite: "same-origin", query: { mine: "1" } })).status).toBe(200);
    // no Origin and no same-origin marker (a script elsewhere, or a cross-site page): refused
    expect((await call("GET", "/api/w/items", { token: ownTok, query: { mine: "1" } })).status).toBe(403);
    expect((await call("GET", "/api/w/items", { token: ownTok, fetchSite: "cross-site", query: { mine: "1" } })).status).toBe(403);
    // a site that doesn't allow the portal's origin gains nothing from the marker
    expect((await call("GET", "/api/w/items", { token: await widgetTok(shop.id), fetchSite: "same-origin" })).status).toBe(403);
  });
});
