// Annotatie's OAuth 2.1 authorization server: node-oidc-provider (a certified library) configured for
// code + PKCE only, dynamic registration, resource indicators (audiences BASE/api and BASE/mcp),
// refresh-token rotation with reuse detection, JWT access tokens signed ES256 (platform-design.md §5).
import Provider, { interactionPolicy, type Configuration, type KoaContextWithOIDC } from "oidc-provider";
import { AGENT_SCOPES } from "@annotatie/core";
import { makeOidcAdapter, PORTAL_CLIENT_ID, type Service } from "@annotatie/store";
import type { SigningKey } from "./keys.js";
import { esc, logoutPage, messagePage, PAGE_HEADERS } from "./pages.js";

export interface ProviderDeps {
  svc: Service;
  baseUrl: string;
  signing: SigningKey;
  cookieKeys: string[];
}

const DAY = 86400;

export function createProvider({ svc, baseUrl, signing, cookieKeys }: ProviderDeps): Provider {
  const API = `${baseUrl}/api`;
  const MCP = `${baseUrl}/mcp`;

  const policy = interactionPolicy.base();
  const consent = policy.get("consent")!;
  // Every agent client needs a person's consent naming sites and scopes, recorded in our table.
  consent.checks.add(
    new interactionPolicy.Check("annotatie_consent", "an agent needs consent", async (ctx: KoaContextWithOIDC) => {
      const { oidc } = ctx;
      if (oidc.client?.clientId === PORTAL_CLIENT_ID) return interactionPolicy.Check.NO_NEED_TO_PROMPT;
      if (oidc.result && "consent" in oidc.result) return interactionPolicy.Check.NO_NEED_TO_PROMPT;
      const jti = (oidc as unknown as { grant?: { jti?: string } }).grant?.jti;
      if (jti && (await svc.grant(jti))) return interactionPolicy.Check.NO_NEED_TO_PROMPT;
      return interactionPolicy.Check.REQUEST_PROMPT;
    }),
  );

  const configuration: Configuration = {
    adapter: makeOidcAdapter(svc.db) as unknown as Configuration["adapter"],
    clients: [
      {
        client_id: PORTAL_CLIENT_ID,
        client_name: "Annotatie portal",
        application_type: "web",
        token_endpoint_auth_method: "none",
        redirect_uris: [`${baseUrl}/board/`],
        post_logout_redirect_uris: [`${baseUrl}/board/`],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        id_token_signed_response_alg: "ES256",
      },
    ],
    clientDefaults: {
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      id_token_signed_response_alg: "ES256",
    },
    jwks: { keys: [signing.privateJwk as never] },
    cookies: {
      keys: cookieKeys,
      long: { signed: true, httpOnly: true, sameSite: "lax", secure: true },
      short: { signed: true, httpOnly: true, sameSite: "lax", secure: true },
    },
    claims: { openid: ["sub"], profile: ["name"], email: ["email"] },
    scopes: ["openid", "offline_access", "profile", "email"],
    pkce: { required: () => true },
    enabledJWA: {
      idTokenSigningAlgValues: ["ES256"],
      requestObjectSigningAlgValues: ["ES256", "EdDSA"],
      userinfoSigningAlgValues: ["ES256"],
      introspectionSigningAlgValues: ["ES256"],
      authorizationSigningAlgValues: ["ES256"],
    },
    responseTypes: ["code"],
    routes: {
      authorization: "/oauth/authorize",
      token: "/oauth/token",
      jwks: "/oauth/jwks",
      registration: "/oauth/register",
      revocation: "/oauth/revoke",
      introspection: "/oauth/introspect",
      end_session: "/oauth/logout",
      userinfo: "/oauth/me",
      pushed_authorization_request: "/oauth/par",
      code_verification: "/oauth/device",
      device_authorization: "/oauth/device/auth",
      backchannel_authentication: "/oauth/backchannel",
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true },
      revocation: { enabled: true },
      introspection: { enabled: false },
      userinfo: { enabled: true },
      rpInitiatedLogout: {
        enabled: true,
        logoutSource: async (ctx, form) => {
          ctx.set(PAGE_HEADERS);
          ctx.body = logoutPage(form);
        },
        postLogoutSuccessSource: async (ctx) => {
          ctx.set(PAGE_HEADERS);
          ctx.body = messagePage("Signed out", "You have signed out of Annotatie.", { href: "/board/", label: "Sign in again" });
        },
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: async (_ctx, client) => (client.clientId === PORTAL_CLIENT_ID ? API : MCP),
        useGrantedResource: async () => true,
        getResourceServerInfo: async (_ctx, resource, client) => {
          if (resource === API && client.clientId === PORTAL_CLIENT_ID) {
            return { scope: "", audience: API, accessTokenTTL: 900, accessTokenFormat: "jwt", jwt: { sign: { alg: "ES256" } } };
          }
          if (resource === MCP && client.clientId !== PORTAL_CLIENT_ID) {
            return { scope: AGENT_SCOPES.join(" "), audience: MCP, accessTokenTTL: 900, accessTokenFormat: "jwt", jwt: { sign: { alg: "ES256" } } };
          }
          // An agent can never get a token for the portal API, and the portal never for /mcp.
          throw new (await import("oidc-provider")).errors.InvalidTarget();
        },
      },
    },
    extraTokenClaims: async (_ctx, token) => {
      const t = token as { kind?: string; grantId?: string; resourceServer?: { audience?: string } };
      if (t.kind === "AccessToken" && t.resourceServer?.audience === MCP && t.grantId) return { gid: t.grantId };
      return undefined;
    },
    findAccount: async (_ctx, sub) => {
      const user = await svc.getUser(sub);
      if (!user) return undefined;
      return { accountId: sub, claims: async () => ({ sub, name: user.name, email: user.email }) };
    },
    loadExistingGrant: async (ctx) => {
      const { oidc } = ctx;
      const clientId = oidc.client!.clientId;
      const grantId = oidc.result?.consent?.grantId || oidc.session!.grantIdFor(clientId);
      if (grantId) {
        const g = await oidc.provider.Grant.find(grantId);
        if (g) return g;
      }
      if (clientId === PORTAL_CLIENT_ID) {
        // First-party: no consent screen.
        const grant = new oidc.provider.Grant({ clientId, accountId: oidc.session!.accountId! });
        grant.addOIDCScope("openid offline_access profile email");
        grant.addResourceScope(API, "");
        await grant.save();
        return grant;
      }
      return undefined;
    },
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed("refresh_token"),
    rotateRefreshToken: true,
    ttl: {
      AccessToken: 900,
      AuthorizationCode: 60,
      IdToken: 3600,
      Interaction: 600,
      Session: 14 * DAY,
      Grant: 365 * DAY,
      RefreshToken: (_ctx, _token, client) => (client.clientId === PORTAL_CLIENT_ID ? 14 * DAY : 90 * DAY),
    },
    interactions: { policy, url: (_ctx, interaction) => `/oauth/interaction/${interaction.uid}` },
    clientBasedCORS: (_ctx, origin) => origin === baseUrl,
    renderError: async (ctx, out) => {
      ctx.set(PAGE_HEADERS);
      ctx.body = messagePage("Sign-in problem", `${out.error_description ?? out.error ?? "Something went wrong."}`, { href: "/board/", label: "Back to the portal" });
      void esc;
    },
  };

  const provider = new Provider(baseUrl, configuration);
  provider.proxy = true;
  // Without these, a failure inside the provider reaches the browser as "oops! something went wrong"
  // and leaves nothing in the logs.
  const logError = (event: string) => (...args: unknown[]) => {
    const err = args.find((a): a is Error => a instanceof Error);
    console.error(JSON.stringify({ msg: "oidc error", event, error: err ? `${err.name}: ${err.message}` : undefined, stack: event === "server_error" ? err?.stack : undefined }));
  };
  for (const event of ["server_error", "authorization.error", "grant.error", "registration_create.error", "end_session.error"]) provider.on(event, logError(event));
  return provider;
}
