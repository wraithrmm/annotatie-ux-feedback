// Access-token verification shared by the API and MCP Lambdas. Tokens are JWTs signed by the auth
// service (ES256, JWKS at /oauth/jwks). The audience decides who may use them: BASE/api for the portal
// and the widget, BASE/mcp for agents.
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { AGENT_SCOPES, type AgentScope, HttpError } from "@annotatie/core";
import type { AgentPrincipal, PersonPrincipal, WidgetPrincipal } from "./principal.js";
import type { Service } from "./service.js";

export const PORTAL_CLIENT_ID = "annotatie-portal";

let remote: JWTVerifyGetKey | undefined;

export function jwksFor(baseUrl: string): JWTVerifyGetKey {
  if (process.env.JWKS_JSON) return createLocalJWKSet(JSON.parse(process.env.JWKS_JSON));
  remote ??= createRemoteJWKSet(new URL(`${baseUrl}/oauth/jwks`), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
  return remote;
}

export async function verifyJwt(token: string, baseUrl: string, audience: string, keys: JWTVerifyGetKey): Promise<JWTPayload & Record<string, unknown>> {
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: baseUrl, audience, algorithms: ["ES256"], clockTolerance: 5 });
    return payload as JWTPayload & Record<string, unknown>;
  } catch {
    throw new HttpError(401, "invalid_token", "The access token is missing, expired or not for this service.");
  }
}

export function bearer(headers: Record<string, string | undefined>): string {
  const h = headers.authorization ?? headers.Authorization ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (!m) throw new HttpError(401, "invalid_token", "Sign in first.");
  return m[1]!;
}

/** A portal or widget principal from an `api` token. Anything else is refused. */
export async function apiPrincipal(
  claims: JWTPayload & Record<string, unknown>,
  svc: Service,
): Promise<PersonPrincipal | WidgetPrincipal> {
  const clientId = String(claims.client_id ?? "");
  if (clientId === PORTAL_CLIENT_ID && claims.sub) {
    const user = await svc.getUser(claims.sub);
    if (!user) throw new HttpError(401, "invalid_token");
    return { kind: "person", userId: user.id, name: user.name, via: { kind: "portal" } };
  }
  if (clientId.startsWith("site:") && claims.scope === "report" && typeof claims.site === "string" && clientId === `site:${claims.site}` && claims.sub) {
    return {
      kind: "widget",
      siteId: claims.site,
      userId: claims.sub,
      name: typeof claims.name === "string" ? claims.name : "Site user",
      email: typeof claims.email === "string" ? claims.email : undefined,
    };
  }
  throw new HttpError(401, "invalid_token", "This token can't be used here.");
}

/** An agent principal from an `mcp` token: the grant must still exist (revocation is immediate). */
export async function mcpPrincipal(claims: JWTPayload & Record<string, unknown>, svc: Service): Promise<AgentPrincipal> {
  const grantId = typeof claims.gid === "string" ? claims.gid : undefined;
  if (!claims.sub || !grantId) throw new HttpError(401, "invalid_token");
  const grant = await svc.grant(grantId);
  if (!grant || grant.userId !== claims.sub) throw new HttpError(401, "invalid_token", "This agent's access was revoked.");
  const user = await svc.getUser(claims.sub);
  if (!user) throw new HttpError(401, "invalid_token");
  await svc.touchGrant(grantId, user.id);
  // What the agent may do is what the person ticked on the consent screen (our record), not the
  // OAuth scope string.
  const scopes = new Set(grant.scopes.filter((s): s is AgentScope => (AGENT_SCOPES as readonly string[]).includes(s)));
  return {
    kind: "agent",
    userId: user.id,
    name: user.name,
    sites: grant.sites,
    scopes,
    via: { kind: "agent", clientName: grant.clientName, clientId: grant.clientId },
    grantId,
  };
}
