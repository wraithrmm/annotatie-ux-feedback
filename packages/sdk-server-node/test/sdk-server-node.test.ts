import { createPublicKey, verify } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  ASSERTION_LIFETIME_SECONDS,
  JWT_BEARER_GRANT,
  annotatieTag,
  createTokenHandler,
  exchange,
  generateSiteKey,
  publicJwkFor,
  signAssertion,
  thumbprint,
} from "../src/index.js";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

function verifyJws(jws: string, jwk: { kty: string; crv: string; x: string }): boolean {
  const [h, p, s] = jws.split(".");
  const key = createPublicKey({ key: jwk, format: "jwk" });
  return verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s!, "base64url"));
}

describe("generateSiteKey", () => {
  it("makes an Ed25519 key whose kid is the public key's thumbprint", () => {
    const k = generateSiteKey();
    expect(k.publicKeyJwk).toMatchObject({ kty: "OKP", crv: "Ed25519" });
    expect(k.publicKeyJwk.x).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(k.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(k.kid).toBe(thumbprint(k.publicKeyJwk));
    expect(publicJwkFor(k.privateKeyPem)).toEqual(k.publicKeyJwk);
    expect(generateSiteKey().kid).not.toBe(k.kid);
  });
});

describe("signAssertion", () => {
  const key = generateSiteKey();
  const base = "https://annotatie.example.test";

  it("signs a JWS that verifies with the public JWK and carries exactly the contract's claims", () => {
    const jws = signAssertion({
      siteId: "site_1",
      kid: key.kid,
      privateKey: key.privateKeyPem,
      user: { id: "u-42", name: "Ellis Varnholt", email: "ellis@example.test" },
      base,
      now: 1_800_000_000,
    });
    expect(jws.split(".")).toHaveLength(3);
    expect(verifyJws(jws, key.publicKeyJwk)).toBe(true);
    const [h, p] = jws.split(".");
    expect(decode(h!)).toEqual({ alg: "EdDSA", typ: "JWT", kid: key.kid });
    const claims = decode(p!);
    expect(Object.keys(claims).sort()).toEqual(["aud", "email", "exp", "iat", "iss", "jti", "name", "sub"]);
    expect(claims).toMatchObject({
      iss: "site_1",
      sub: "u-42",
      name: "Ellis Varnholt",
      email: "ellis@example.test",
      aud: `${base}/oauth/token`,
      iat: 1_800_000_000,
      exp: 1_800_000_000 + 60,
    });
    expect(ASSERTION_LIFETIME_SECONDS).toBe(60);
    expect(claims.jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("leaves email out when none is given, uses a fresh jti each time and honours audience", () => {
    const a = signAssertion({ siteId: "s", kid: "k", privateKey: key.privateKeyPem, user: { id: "1", name: "A" } });
    const b = signAssertion({ siteId: "s", kid: "k", privateKey: key.privateKeyPem, user: { id: "1", name: "A" }, audience: "x:aud" });
    const ca = decode(a.split(".")[1]!);
    const cb = decode(b.split(".")[1]!);
    expect(ca.email).toBeUndefined();
    expect(ca.aud).toBe("https://annotatie.consulteasy.co.uk/oauth/token");
    expect(cb.aud).toBe("x:aud");
    expect(ca.jti).not.toBe(cb.jti);
    expect(ca.exp - ca.iat).toBe(60);
    expect(Math.abs(ca.iat - Date.now() / 1000)).toBeLessThan(5);
  });

  it("does not verify with another key, or once tampered", () => {
    const jws = signAssertion({ siteId: "s", kid: "k", privateKey: key.privateKeyPem, user: { id: "1", name: "A" } });
    expect(verifyJws(jws, generateSiteKey().publicKeyJwk)).toBe(false);
    const [h, , s] = jws.split(".");
    const forged = Buffer.from(JSON.stringify({ iss: "s", sub: "admin", name: "A" })).toString("base64url");
    expect(verifyJws(`${h}.${forged}.${s}`, key.publicKeyJwk)).toBe(false);
  });

  it("refuses without user.id, user.name, siteId or kid, and with a non-Ed25519 key", () => {
    const base = { siteId: "s", kid: "k", privateKey: key.privateKeyPem };
    expect(() => signAssertion({ ...base, user: { id: "", name: "A" } })).toThrow(/user.id/);
    expect(() => signAssertion({ ...base, user: { id: "1", name: "  " } })).toThrow(/user.name/);
    expect(() => signAssertion({ ...base, user: { id: "1" } as never })).toThrow(/user.name/);
    expect(() => signAssertion({ ...base, user: undefined as never })).toThrow(/user.id/);
    expect(() => signAssertion({ ...base, siteId: "", user: { id: "1", name: "A" } })).toThrow(/siteId/);
    expect(() => signAssertion({ ...base, kid: "", user: { id: "1", name: "A" } })).toThrow(/kid/);
    expect(() => signAssertion({ ...base, user: { id: "1", name: "A", email: "nope" } })).toThrow(/email/);
    const rsa = `-----BEGIN PRIVATE KEY-----\n${"x"}\n-----END PRIVATE KEY-----`;
    expect(() => signAssertion({ ...base, privateKey: rsa, user: { id: "1", name: "A" } })).toThrow();
  });
});

describe("exchange", () => {
  it("posts the jwt-bearer grant and returns the token", async () => {
    let seen: { url: string; body: string; type: string } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, body: String(init.body), type: (init.headers as Record<string, string>)["content-type"]! };
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 300, scope: "report", token_type: "Bearer" }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await exchange({ base: "https://a.test/", assertion: "x.y.z", fetch: fake });
    expect(t).toEqual({ access_token: "tok", expires_in: 300, scope: "report", token_type: "Bearer" });
    expect(seen!.url).toBe("https://a.test/oauth/token");
    expect(seen!.type).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(seen!.body);
    expect(params.get("grant_type")).toBe(JWT_BEARER_GRANT);
    expect(params.get("assertion")).toBe("x.y.z");
  });

  it("throws with the status and error code when refused", async () => {
    const fake = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    await expect(exchange({ assertion: "a", fetch: fake })).rejects.toMatchObject({ status: 400, code: "invalid_grant" });
  });
});

describe("createTokenHandler", () => {
  async function serve(getUser: () => { id: string; name: string } | null, tokenStatus = 200) {
    const key = generateSiteKey();
    let assertion = "";
    const fake = (async (_url: string, init: RequestInit) => {
      assertion = new URLSearchParams(String(init.body)).get("assertion")!;
      return tokenStatus === 200
        ? new Response(JSON.stringify({ access_token: "tok", expires_in: 300, scope: "report", refresh_token: "never" }), { status: 200 })
        : new Response(JSON.stringify({ error: "invalid_grant" }), { status: tokenStatus });
    }) as unknown as typeof fetch;
    const handler = createTokenHandler({ base: "https://a.test", siteId: "s1", kid: key.kid, privateKey: key.privateKeyPem, getUser, fetch: fake });
    const server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/annotatie/token`;
    return { url, key, close: () => new Promise<void>((r) => server.close(() => r())), assertion: () => assertion };
  }

  it("returns only the access token and its lifetime, uncached, for a permitted user", async () => {
    const s = await serve(() => ({ id: "u1", name: "Ellis" }));
    try {
      const res = await fetch(s.url);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ access_token: "tok", expires_in: 300 });
      expect(verifyJws(s.assertion(), s.key.publicKeyJwk)).toBe(true);
      expect(decode(s.assertion().split(".")[1]!)).toMatchObject({ iss: "s1", sub: "u1", aud: "https://a.test/oauth/token" });
    } finally {
      await s.close();
    }
  });

  it("answers 403 when getUser returns null, 405 for POST, 502 when the exchange is refused", async () => {
    const none = await serve(() => null);
    try {
      expect((await fetch(none.url)).status).toBe(403);
      expect((await fetch(none.url, { method: "POST" })).status).toBe(405);
    } finally {
      await none.close();
    }
    const refused = await serve(() => ({ id: "u1", name: "E" }), 400);
    try {
      const res = await fetch(refused.url);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "token_unavailable" });
    } finally {
      await refused.close();
    }
  });
});

describe("annotatieTag", () => {
  it("emits the script tag with escaped attributes", () => {
    expect(annotatieTag({ siteId: "site_1" })).toBe(
      '<script src="https://annotatie.consulteasy.co.uk/sdk/v1/annotatie.js" data-site="site_1" data-token-url="/annotatie/token" async></script>',
    );
    const t = annotatieTag({ base: "https://a.test/", siteId: 'x"><script>', tokenUrl: "/t?a=1&b=2", theme: "race-officials", buildId: "b1" });
    expect(t).toContain('src="https://a.test/sdk/v1/annotatie.js"');
    expect(t).toContain('data-site="x&quot;&gt;&lt;script&gt;"');
    expect(t).toContain('data-token-url="/t?a=1&amp;b=2"');
    expect(t).toContain('data-theme="race-officials"');
    expect(t).toContain('data-build-id="b1"');
    expect(() => annotatieTag({ siteId: "" })).toThrow();
  });
});
