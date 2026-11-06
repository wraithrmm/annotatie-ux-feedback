// RFC 7523: a host site's server swaps a signed assertion about its user for a 5-minute widget token
// (platform-design.md §5.3, docs/api.md §1). The browser never sees the site key or a refresh token.
import { randomUUID } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, SignJWT } from "jose";
import { HttpError } from "@annotatie/core";
import type { Service } from "@annotatie/store";
import type { SigningKey } from "./keys.js";

export const JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer";
export const WIDGET_TOKEN_TTL = 300;

export async function exchangeAssertion(
  assertion: string,
  deps: { svc: Service; baseUrl: string; signing: SigningKey },
): Promise<{ access_token: string; token_type: "Bearer"; expires_in: number; scope: string }> {
  const fail = (why: string): never => {
    throw new HttpError(400, "invalid_grant", why);
  };
  let header: ReturnType<typeof decodeProtectedHeader>;
  let unverified: ReturnType<typeof decodeJwt>;
  try {
    header = decodeProtectedHeader(assertion);
    unverified = decodeJwt(assertion);
  } catch {
    return fail("The assertion is not a JWT.");
  }
  if (header.alg !== "EdDSA" || typeof header.kid !== "string") fail("The assertion must be EdDSA-signed with a kid.");
  const siteId = typeof unverified.iss === "string" ? unverified.iss : fail("The assertion has no iss (site id).");
  const key = await deps.svc.activeSiteKey(siteId, header.kid!);
  if (!key) fail("Unknown or retired site key.");

  const { payload } = await jwtVerify(assertion, await importJWK(key!.publicKeyJwk, "EdDSA"), {
    issuer: siteId,
    audience: `${deps.baseUrl}/oauth/token`,
    algorithms: ["EdDSA"],
    clockTolerance: 5,
    requiredClaims: ["sub", "iat", "exp", "jti"],
  }).catch(() => fail("The assertion's signature, audience or lifetime is wrong."));

  if (typeof payload.name !== "string" || !payload.name.trim()) fail("The assertion needs a name.");
  if (typeof payload.sub !== "string" || payload.sub.length > 200) fail("The assertion needs a sub.");
  if (payload.exp! - payload.iat! > 60) fail("The assertion may live at most 60 seconds.");
  if (payload.iat! > Math.floor(Date.now() / 1000) + 5) fail("The assertion is from the future.");
  if (!(await deps.svc.rememberJti(siteId, String(payload.jti), payload.exp!))) fail("The assertion was already used.");

  const site = await deps.svc.db.get(`SITE#${siteId}`, "META");
  if (!site) fail("Unknown site.");
  await deps.svc.rateLimit(`exchange#${siteId}#${Math.floor(Date.now() / 60000)}`, 600, 120);

  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    client_id: `site:${siteId}`,
    scope: "report",
    site: siteId,
    name: String(payload.name).trim().slice(0, 120),
    ...(typeof payload.email === "string" ? { email: payload.email.slice(0, 254) } : {}),
  })
    .setProtectedHeader({ alg: "ES256", kid: deps.signing.privateJwk.kid, typ: "at+jwt" })
    .setIssuer(deps.baseUrl)
    .setSubject(payload.sub!)
    .setAudience(`${deps.baseUrl}/api`)
    .setIssuedAt(now)
    .setExpirationTime(now + WIDGET_TOKEN_TTL)
    .setJti(randomUUID())
    .sign(deps.signing.key);
  return { access_token: token, token_type: "Bearer", expires_in: WIDGET_TOKEN_TTL, scope: "report" };
}
