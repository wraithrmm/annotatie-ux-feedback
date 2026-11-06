// @annotatie/sdk-server-node — what a Node host needs to put the Annotatie widget on its pages.
//
//   generateSiteKey()        a new Ed25519 site key (register the public JWK in the portal; keep the
//                            private PEM in your secrets store, never in a repository file)
//   signAssertion(...)       the short-lived JWS the host vouches for its user with (docs/api.md §1)
//   exchange(...)            swaps the assertion for a widget access token (RFC 7523)
//   createTokenHandler(...)  the host's GET /annotatie/token route, run behind the host's own session
//   annotatieTag(...)        the <script> tag, emitted only for users the host permits
//
// node:crypto only: no JOSE library.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const DEFAULT_BASE = "https://annotatie.consulteasy.co.uk";
/** The assertion lives 60 seconds (docs/api.md §1: exp ≤ iat + 60). */
export const ASSERTION_LIFETIME_SECONDS = 60;
export const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

export interface PublicKeyJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
}

export interface SiteKey {
  /** Key id: the RFC 7638 thumbprint of the public key. */
  kid: string;
  privateKeyPem: string;
  publicKeyJwk: PublicKeyJwk;
}

export interface AssertionUser {
  /** The host's stable user id (becomes `sub`). Required. */
  id: string;
  /** Display name. Required. */
  name: string;
  email?: string;
}

export interface SignAssertionOptions {
  siteId: string;
  kid: string;
  /** PKCS#8 PEM or a KeyObject. */
  privateKey: string | KeyObject;
  user: AssertionUser;
  /** Overrides `aud` (default `<base>/oauth/token`). */
  audience?: string;
  base?: string;
  /** For tests: the clock, in seconds since the epoch. */
  now?: number;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type?: string;
}

export class AnnotatieError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AnnotatieError";
    this.status = status;
    this.code = code;
  }
}

const b64url = (buf: Buffer | Uint8Array): string => Buffer.from(buf).toString("base64url");
const trimBase = (base: string): string => base.replace(/\/+$/, "");

/** A new Ed25519 site key. */
export function generateSiteKey(): SiteKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string };
  const publicKeyJwk: PublicKeyJwk = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  return {
    kid: thumbprint(publicKeyJwk),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyJwk,
  };
}

/** RFC 7638 JWK thumbprint (SHA-256, base64url) of an OKP public key. */
export function thumbprint(jwk: PublicKeyJwk): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return b64url(createHash("sha256").update(canonical).digest());
}

/** The public JWK for a private key (to register it, or to check a configuration). */
export function publicJwkFor(privateKey: string | KeyObject): PublicKeyJwk {
  const key = typeof privateKey === "string" ? createPrivateKey(privateKey) : privateKey;
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x: string };
  return { kty: "OKP", crv: "Ed25519", x: jwk.x };
}

/**
 * Signs the assertion (compact JWS, EdDSA) with exactly the claims of docs/api.md §1. Refuses without
 * `user.id` and `user.name`: Annotatie never shows an unnamed reporter.
 */
export function signAssertion(opts: SignAssertionOptions): string {
  const { siteId, kid, user } = opts;
  if (!siteId || typeof siteId !== "string") throw new AnnotatieError("signAssertion: siteId is required");
  if (!kid || typeof kid !== "string") throw new AnnotatieError("signAssertion: kid is required");
  if (!user || typeof user.id !== "string" || !user.id.trim())
    throw new AnnotatieError("signAssertion: user.id is required");
  if (typeof user.name !== "string" || !user.name.trim())
    throw new AnnotatieError("signAssertion: user.name is required");
  if (user.email !== undefined && (typeof user.email !== "string" || !user.email.includes("@")))
    throw new AnnotatieError("signAssertion: user.email must be an email address");

  const key = typeof opts.privateKey === "string" ? createPrivateKey(opts.privateKey) : opts.privateKey;
  if (key.asymmetricKeyType !== "ed25519") throw new AnnotatieError("signAssertion: the site key must be Ed25519");

  const iat = Math.floor(opts.now ?? Date.now() / 1000);
  const header = { alg: "EdDSA", typ: "JWT", kid };
  const claims: Record<string, string | number> = {
    iss: siteId,
    sub: user.id,
    name: user.name.trim(),
    aud: opts.audience ?? `${trimBase(opts.base ?? DEFAULT_BASE)}/oauth/token`,
    iat,
    exp: iat + ASSERTION_LIFETIME_SECONDS,
    jti: b64url(randomBytes(16)),
  };
  if (user.email) claims.email = user.email;
  const signingInput = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(claims)))}`;
  const signature = sign(null, Buffer.from(signingInput), key);
  return `${signingInput}.${b64url(signature)}`;
}

export interface ExchangeOptions {
  base?: string;
  assertion: string;
  fetch?: typeof fetch;
}

/** Swaps an assertion for a widget access token at `<base>/oauth/token`. */
export async function exchange(opts: ExchangeOptions): Promise<TokenResponse> {
  const doFetch = opts.fetch ?? fetch;
  const body = new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion: opts.assertion });
  const res = await doFetch(`${trimBase(opts.base ?? DEFAULT_BASE)}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // An empty or non-JSON body is reported by status below.
  }
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : undefined;
    throw new AnnotatieError(`token exchange refused (${res.status}${code ? ` ${code}` : ""})`, res.status, code);
  }
  if (typeof json.access_token !== "string" || typeof json.expires_in !== "number")
    throw new AnnotatieError("token exchange: unexpected response", res.status);
  return {
    access_token: json.access_token,
    expires_in: json.expires_in,
    scope: typeof json.scope === "string" ? json.scope : "",
    ...(typeof json.token_type === "string" ? { token_type: json.token_type } : {}),
  };
}

export interface TokenHandlerOptions {
  base?: string;
  siteId: string;
  kid: string;
  privateKey: string | KeyObject;
  /**
   * Who is asking, from the host's own session; null when they may not report. It must run behind the
   * host's own authentication: Annotatie trusts whatever it returns.
   */
  getUser: (req: IncomingMessage) => AssertionUser | null | Promise<AssertionUser | null>;
  fetch?: typeof fetch;
}

/**
 * The host's `/annotatie/token` route as a Node (req, res) handler. GET only. The browser receives
 * `{ access_token, expires_in }`, never the site key and never a refresh token.
 */
export function createTokenHandler(opts: TokenHandlerOptions) {
  const key = typeof opts.privateKey === "string" ? createPrivateKey(opts.privateKey) : opts.privateKey;
  return async function annotatieToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        pragma: "no-cache",
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("allow", "GET");
      return send(405, { error: "method_not_allowed" });
    }
    let user: AssertionUser | null;
    try {
      user = await opts.getUser(req);
    } catch {
      return send(500, { error: "server_error" });
    }
    if (!user) return send(403, { error: "forbidden" });
    try {
      const assertion = signAssertion({
        siteId: opts.siteId,
        kid: opts.kid,
        privateKey: key,
        user,
        ...(opts.base ? { base: opts.base } : {}),
      });
      const token = await exchange({
        assertion,
        ...(opts.base ? { base: opts.base } : {}),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      });
      return send(200, { access_token: token.access_token, expires_in: token.expires_in });
    } catch {
      // The browser learns only that it failed; nothing about the key or the refusal reaches it.
      return send(502, { error: "token_unavailable" });
    }
  };
}

export interface TagOptions {
  base?: string;
  siteId: string;
  tokenUrl?: string;
  theme?: "neutral" | "race-officials";
  buildId?: string;
  signInUrl?: string;
}

const attr = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * The script tag that loads the widget. Emit it only for users the host permits to report: for anyone
 * else the page carries no trace of Annotatie (platform-design.md §4.1).
 */
export function annotatieTag(opts: TagOptions): string {
  if (!opts.siteId) throw new AnnotatieError("annotatieTag: siteId is required");
  const base = trimBase(opts.base ?? DEFAULT_BASE);
  const parts = [
    `src="${attr(`${base}/sdk/v1/annotatie.js`)}"`,
    `data-site="${attr(opts.siteId)}"`,
    `data-token-url="${attr(opts.tokenUrl ?? "/annotatie/token")}"`,
  ];
  if (opts.theme) parts.push(`data-theme="${attr(opts.theme)}"`);
  if (opts.buildId) parts.push(`data-build-id="${attr(opts.buildId)}"`);
  if (opts.signInUrl) parts.push(`data-sign-in-url="${attr(opts.signInUrl)}"`);
  return `<script ${parts.join(" ")} async></script>`;
}
