// The OAuth flows end to end against a real node-oidc-provider instance in-process (DynamoDB Local).
// Sign-in uses a recovery code here (a passkey needs a browser authenticator; see e2e).
import { beforeAll, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from "aws-lambda";
import { createLocalJWKSet, decodeJwt, exportJWK, jwtVerify, SignJWT, importPKCS8 } from "jose";
import { Service, revokeGrantRecords } from "@annotatie/store";
import { freshDb } from "../../../packages/store/test/helpers.js";

const BASE = "https://annotatie.consulteasy.co.uk"; // the handler's default
let handleAuth: typeof import("../src/handler.js").handleAuth;
let app: Awaited<ReturnType<typeof import("../src/handler.js").createAuthApp>>;
let svc: Service;
let userId: string;
let codes: string[];
let siteId: string;

class Browser {
  jar = new Map<string, { value: string; path: string }>();
  async req(method: string, url: string, opts: { form?: Record<string, string | string[]>; json?: unknown; headers?: Record<string, string> } = {}) {
    const u = new URL(url, BASE);
    const cookies = [...this.jar.entries()].filter(([, c]) => u.pathname.startsWith(c.path)).map(([k, c]) => `${k}=${c.value}`);
    let body: string | undefined;
    const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.9", ...(opts.headers ?? {}) };
    if (opts.form) {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.form)) for (const x of [v].flat()) p.append(k, x);
      body = p.toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers["content-type"] = "application/json";
    }
    // Real clients send content-length; API Gateway passes it through.
    if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));
    const event = {
      version: "2.0",
      routeKey: "$default",
      rawPath: u.pathname,
      rawQueryString: u.search.slice(1),
      queryStringParameters: Object.fromEntries(u.searchParams),
      cookies,
      headers: { host: "abc.execute-api.eu-west-2.amazonaws.com", ...headers },
      requestContext: { http: { method, path: u.pathname, sourceIp: "198.51.100.1", protocol: "HTTP/1.1", userAgent: "test" }, stage: "$default" },
      body,
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;
    const res = (await handleAuth(app, event, {} as Context)) as APIGatewayProxyStructuredResultV2 & { multiValueHeaders?: Record<string, string[]> };
    const setCookies = [...(res.cookies ?? []), ...((res.multiValueHeaders?.["set-cookie"] as string[]) ?? [])];
    for (const sc of setCookies) {
      const [nv, ...attrs] = sc.split(";").map((s) => s.trim());
      const [name, ...rest] = nv!.split("=");
      const path = attrs.find((a) => a.toLowerCase().startsWith("path="))?.slice(5) ?? "/";
      const expired = attrs.some((a) => /^expires=thu, 01 jan 1970/i.test(a)) || attrs.some((a) => a.toLowerCase() === "max-age=0");
      if (expired) this.jar.delete(name!);
      else this.jar.set(name!, { value: rest.join("="), path });
    }
    const h = Object.fromEntries(Object.entries(res.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const text = res.body ? (res.isBase64Encoded ? Buffer.from(res.body, "base64").toString("utf8") : res.body) : "";
    return { status: res.statusCode ?? 200, headers: h, text, json: () => JSON.parse(text) };
  }
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

beforeAll(async () => {
  process.env.SECRETS_LOCAL = "1";
  const mod = await import("../src/handler.js");
  handleAuth = mod.handleAuth;
  svc = new Service(await freshDb(), { autoApproveAllowed: true, baseUrl: BASE });
  app = await mod.createAuthApp(svc);
  userId = await svc.createUser("Riley Chen", "riley@example.com");
  codes = await svc.newRecoveryCodes(userId);
  const site = await svc.createSite({ kind: "person", userId, name: "Riley Chen", via: { kind: "portal" } }, { name: "Acme Shop", origins: ["https://shop.example.com"] });
  siteId = site.id;
});

/** Authorize → sign in with a recovery code → (consent) → code. Returns the code. */
async function authorize(b: Browser, params: Record<string, string>, opts: { consent?: { sites: string[]; scopes: string[] } | "deny"; codeIndex: number }) {
  let r = await b.req("GET", `/oauth/authorize?${new URLSearchParams(params)}`);
  expect(r.status).toBe(303);
  let loc = r.headers.location!;
  for (let i = 0; i < 8; i++) {
    const u = new URL(loc, BASE);
    if (u.origin !== BASE || u.pathname.startsWith("/board")) return u;
    if (u.pathname.startsWith("/oauth/interaction/")) {
      const page = await b.req("GET", u.pathname);
      expect(page.status).toBe(200);
      if (page.text.includes("Sign in with a passkey")) {
        expect(page.headers["content-security-policy"]).toContain("script-src 'self'");
        r = await b.req("POST", `${u.pathname}/recovery`, { form: { email: "riley@example.com", code: codes[opts.codeIndex]! } });
      } else if (page.text.includes("Allow an agent?")) {
        expect(page.text).toContain("Acme Shop");
        if (opts.consent === "deny") r = await b.req("POST", `${u.pathname}/abort`, { form: {} });
        else r = await b.req("POST", `${u.pathname}/consent`, { form: { site: opts.consent!.sites, scope: opts.consent!.scopes } });
      } else throw new Error(`unexpected page ${page.text.slice(0, 200)}`);
    } else {
      r = await b.req("GET", u.pathname + u.search);
    }
    expect([302, 303]).toContain(r.status);
    loc = r.headers.location!;
  }
  throw new Error("too many redirects");
}

describe("discovery", () => {
  it("serves RFC 8414 and RFC 9728 metadata and the JWKS", async () => {
    const b = new Browser();
    const as = (await b.req("GET", "/.well-known/oauth-authorization-server")).json();
    expect(as.issuer).toBe(BASE);
    expect(as.authorization_endpoint).toBe(`${BASE}/oauth/authorize`);
    expect(as.token_endpoint).toBe(`${BASE}/oauth/token`);
    expect(as.registration_endpoint).toBe(`${BASE}/oauth/register`);
    expect(as.code_challenge_methods_supported).toContain("S256");
    expect(as.response_types_supported).toEqual(["code"]);
    const prm = (await b.req("GET", "/.well-known/oauth-protected-resource/mcp")).json();
    expect(prm).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
    const jwks = (await b.req("GET", "/oauth/jwks")).json();
    expect(jwks.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256" });
    expect(jwks.keys[0].d).toBeUndefined();
  });
});

describe("an agent (MCP client)", () => {
  it("registers, gets consent for chosen sites and scopes, receives an mcp token, refresh rotates with reuse detection", async () => {
    const b = new Browser();
    const reg = await b.req("POST", "/oauth/register", {
      json: { client_name: "Claude Code (annotatie)", redirect_uris: ["http://localhost:53682/callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
    });
    expect(reg.status).toBe(201);
    const client = reg.json();
    expect(client.application_type).toBe("native");

    const { verifier, challenge } = pkce();
    const redirect = await authorize(
      b,
      { client_id: client.client_id, response_type: "code", redirect_uri: "http://localhost:53682/callback", code_challenge: challenge, code_challenge_method: "S256", resource: `${BASE}/mcp`, scope: "read reply", state: "s1" },
      { consent: { sites: [siteId], scopes: ["reply", "status"] }, codeIndex: 0 },
    );
    expect(redirect.searchParams.get("state")).toBe("s1");
    const code = redirect.searchParams.get("code")!;
    expect(code).toBeTruthy();

    const tok = await b.req("POST", "/oauth/token", {
      form: { grant_type: "authorization_code", code, redirect_uri: "http://localhost:53682/callback", client_id: client.client_id, code_verifier: verifier, resource: `${BASE}/mcp` },
    });
    expect(tok.status).toBe(200);
    const t = tok.json();
    const jwks = createLocalJWKSet((await b.req("GET", "/oauth/jwks")).json());
    const { payload } = await jwtVerify(t.access_token, jwks, { issuer: BASE, audience: `${BASE}/mcp` });
    expect(payload.sub).toBe(userId);
    expect(typeof payload.gid).toBe("string");
    const grant = await svc.grant(String(payload.gid));
    expect(grant?.sites).toEqual([siteId]);
    expect(grant?.scopes.sort()).toEqual(["read", "reply", "status"]);
    expect(t.refresh_token).toBeTruthy();

    // refresh rotates
    const r1 = await b.req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id } });
    expect(r1.status).toBe(200);
    const t2 = r1.json();
    expect(t2.refresh_token).not.toBe(t.refresh_token);
    // reusing the old one fails and revokes the family
    const reuse = await b.req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id } });
    expect(reuse.status).toBe(400);
    const after = await b.req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: client.client_id } });
    expect(after.status).toBe(400);
  });

  it("can never get a token for the portal API, and deny ends the flow", async () => {
    const b = new Browser();
    const client = (await b.req("POST", "/oauth/register", { json: { client_name: "Sneaky", redirect_uris: ["http://127.0.0.1:9999/cb"], token_endpoint_auth_method: "none" } })).json();
    const { challenge } = pkce();
    const r = await b.req("GET", `/oauth/authorize?${new URLSearchParams({ client_id: client.client_id, response_type: "code", redirect_uri: "http://127.0.0.1:9999/cb", code_challenge: challenge, code_challenge_method: "S256", resource: `${BASE}/api` })}`);
    const loc = new URL(r.headers.location!, BASE);
    expect(loc.origin).toBe("http://127.0.0.1:9999");
    expect(loc.searchParams.get("error")).toBe("invalid_target");

    const denied = await authorize(
      b,
      { client_id: client.client_id, response_type: "code", redirect_uri: "http://127.0.0.1:9999/cb", code_challenge: challenge, code_challenge_method: "S256", resource: `${BASE}/mcp` },
      { consent: "deny", codeIndex: 1 },
    );
    expect(denied.searchParams.get("error")).toBe("access_denied");
  });

  it("requires PKCE", async () => {
    const b = new Browser();
    const client = (await b.req("POST", "/oauth/register", { json: { redirect_uris: ["http://127.0.0.1:9999/cb"], token_endpoint_auth_method: "none" } })).json();
    const r = await b.req("GET", `/oauth/authorize?${new URLSearchParams({ client_id: client.client_id, response_type: "code", redirect_uri: "http://127.0.0.1:9999/cb", resource: `${BASE}/mcp` })}`);
    expect(new URL(r.headers.location!).searchParams.get("error")).toBe("invalid_request");
  });

  it("a revoked grant can't refresh", async () => {
    const b = new Browser();
    const client = (await b.req("POST", "/oauth/register", { json: { client_name: "Revokee", redirect_uris: ["http://localhost:1234/cb"], token_endpoint_auth_method: "none" } })).json();
    const { verifier, challenge } = pkce();
    const redirect = await authorize(
      b,
      { client_id: client.client_id, response_type: "code", redirect_uri: "http://localhost:1234/cb", code_challenge: challenge, code_challenge_method: "S256", resource: `${BASE}/mcp` },
      { consent: { sites: [siteId], scopes: [] }, codeIndex: 2 },
    );
    const t = (await b.req("POST", "/oauth/token", { form: { grant_type: "authorization_code", code: redirect.searchParams.get("code")!, redirect_uri: "http://localhost:1234/cb", client_id: client.client_id, code_verifier: verifier } })).json();
    const gid = String(decodeJwt(t.access_token).gid);
    expect((await svc.grant(gid))?.scopes).toEqual(["read"]);
    await svc.removeGrant(userId, gid);
    await revokeGrantRecords(svc.db, gid);
    const r = await b.req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id } });
    expect(r.status).toBe(400);
  });
});

describe("the portal", () => {
  it("signs in with no consent screen and gets an api token", async () => {
    const b = new Browser();
    const { verifier, challenge } = pkce();
    const redirect = await authorize(
      b,
      { client_id: "annotatie-portal", response_type: "code", redirect_uri: `${BASE}/board/`, code_challenge: challenge, code_challenge_method: "S256", resource: `${BASE}/api`, scope: "openid offline_access" },
      { codeIndex: 3 },
    );
    const tok = await b.req("POST", "/oauth/token", {
      form: { grant_type: "authorization_code", code: redirect.searchParams.get("code")!, redirect_uri: `${BASE}/board/`, client_id: "annotatie-portal", code_verifier: verifier, resource: `${BASE}/api` },
      headers: { origin: BASE },
    });
    expect(tok.status).toBe(200);
    const t = tok.json();
    const claims = decodeJwt(t.access_token);
    expect(claims.aud).toBe(`${BASE}/api`);
    expect(claims.client_id).toBe("annotatie-portal");
    expect(t.refresh_token).toBeTruthy();
    expect(t.id_token).toBeTruthy();

    // a second authorize reuses the session: straight back with a code
    const again = await b.req("GET", `/oauth/authorize?${new URLSearchParams({ client_id: "annotatie-portal", response_type: "code", redirect_uri: `${BASE}/board/`, code_challenge: challenge, code_challenge_method: "S256", resource: `${BASE}/api` })}`);
    let loc = again.headers.location!;
    for (let i = 0; i < 4 && new URL(loc, BASE).origin === BASE && !new URL(loc, BASE).pathname.startsWith("/board"); i++) loc = (await b.req("GET", loc)).headers.location!;
    expect(new URL(loc, BASE).searchParams.get("code")).toBeTruthy();
  });

  it("a wrong recovery code shows the sign-in page again", async () => {
    const b = new Browser();
    const { challenge } = pkce();
    const r = await b.req("GET", `/oauth/authorize?${new URLSearchParams({ client_id: "annotatie-portal", response_type: "code", redirect_uri: `${BASE}/board/`, code_challenge: challenge, code_challenge_method: "S256" })}`);
    const path = new URL(r.headers.location!, BASE).pathname;
    await b.req("GET", path);
    const bad = await b.req("POST", `${path}/recovery`, { form: { email: "riley@example.com", code: "WRONG-CODE0" } });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain("don&#39;t match");
  });
});

describe("site assertions (RFC 7523)", () => {
  async function siteKey(kid: string) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const jwk = await exportJWK(publicKey);
    await svc.addKey({ kind: "person", userId, name: "Riley", via: { kind: "portal" } }, siteId, { kid, publicKeyJwk: jwk });
    return importPKCS8(privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "EdDSA");
  }
  const assertion = (key: Parameters<SignJWT["sign"]>[0], kid: string, over: Record<string, unknown> = {}, life = 60) =>
    new SignJWT({ name: "Sam Patel", ...over })
      .setProtectedHeader({ alg: "EdDSA", kid })
      .setIssuer(String(over.iss ?? siteId))
      .setSubject("host-42")
      .setAudience(String(over.aud ?? `${BASE}/oauth/token`))
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + life)
      .setJti(randomUUID())
      .sign(key);

  it("swaps a signed assertion for a 5-minute widget token, once", async () => {
    const key = await siteKey("k-test");
    const b = new Browser();
    const a = await assertion(key, "k-test");
    const r = await b.req("POST", "/oauth/token", { form: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: a } });
    expect(r.status).toBe(200);
    const t = r.json();
    expect(t.expires_in).toBe(300);
    expect(t.refresh_token).toBeUndefined();
    const jwks = createLocalJWKSet((await b.req("GET", "/oauth/jwks")).json());
    const { payload } = await jwtVerify(t.access_token, jwks, { issuer: BASE, audience: `${BASE}/api` });
    expect(payload).toMatchObject({ sub: "host-42", client_id: `site:${siteId}`, scope: "report", site: siteId, name: "Sam Patel" });
    // replay
    const again = await b.req("POST", "/oauth/token", { form: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: a } });
    expect(again.status).toBe(400);
    expect(again.json().error).toBe("invalid_grant");
  });

  it("refuses a wrong audience, a long life, no name, an unknown or retired key", async () => {
    const key = await siteKey("k-two");
    const b = new Browser();
    const ex = async (a: string) => (await b.req("POST", "/oauth/token", { form: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: a } })).status;
    expect(await ex(await assertion(key, "k-two", { aud: "https://elsewhere/token" }))).toBe(400);
    expect(await ex(await assertion(key, "k-two", {}, 600))).toBe(400);
    expect(await ex(await assertion(key, "k-two", { name: "" }))).toBe(400);
    expect(await ex(await assertion(key, "k-nope"))).toBe(400);
    await svc.retireKey({ kind: "person", userId, name: "Riley", via: { kind: "portal" } }, siteId, "k-two");
    expect(await ex(await assertion(key, "k-two"))).toBe(400);
  });
});
