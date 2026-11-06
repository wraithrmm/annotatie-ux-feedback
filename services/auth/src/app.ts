// The auth Lambda's own routes, mounted in front of node-oidc-provider: sign-in and consent
// interactions, invites (account set-up with a passkey), discovery extras and static assets.
import type Provider from "oidc-provider";
import type { KoaContextWithOIDC } from "oidc-provider";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { randomBytes } from "node:crypto";
import { AGENT_SCOPES, HttpError, LIMITS } from "@annotatie/core";
import type { Service } from "@annotatie/store";
import { AUTH_CSS, AUTH_JS, consentPage, invitePage, messagePage, PAGE_HEADERS, signInPage } from "./pages.js";

export interface RouteDeps {
  svc: Service;
  baseUrl: string;
}

type Ctx = KoaContextWithOIDC;

async function readBody(ctx: Ctx): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of ctx.req as AsyncIterable<Buffer | string>) {
    const b = typeof c === "string" ? Buffer.from(c) : c;
    size += b.length;
    if (size > 64 * 1024) throw new HttpError(413, "too_large");
    chunks.push(b);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  if ((ctx.get("content-type") || "").includes("application/json")) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "invalid_json");
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(text)) {
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

const list = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

function clientIp(ctx: Ctx): string {
  return (ctx.get("x-forwarded-for") || "").split(",")[0]!.trim() || "unknown";
}

export function mountRoutes(provider: Provider, { svc, baseUrl }: RouteDeps): void {
  const rpID = new URL(baseUrl).hostname;
  const html = (ctx: Ctx, body: string, status = 200) => {
    ctx.status = status;
    ctx.set(PAGE_HEADERS);
    ctx.body = body;
  };
  const json = (ctx: Ctx, body: unknown, status = 200) => {
    ctx.status = status;
    ctx.set({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
    ctx.type = "application/json";
    ctx.body = JSON.stringify(body);
  };

  async function verifyPasskey(response: Record<string, unknown>, challengeId: unknown, purpose: string) {
    const chal = await svc.takeChallenge(String(challengeId ?? ""));
    if (!chal || chal.purpose !== purpose) throw new HttpError(400, "expired", "The sign-in request expired. Try again.");
    const credId = String(response?.id ?? "");
    const userId = await svc.passkeyOwner(credId);
    if (!userId) throw new HttpError(400, "unknown_passkey", "That passkey isn't registered here.");
    const key = (await svc.passkeys(userId)).find((k) => k.id === credId);
    if (!key) throw new HttpError(400, "unknown_passkey", "That passkey isn't registered here.");
    const v = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: chal.challenge,
      expectedOrigin: baseUrl,
      expectedRPID: rpID,
      credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")), counter: key.counter, transports: key.transports as never },
      requireUserVerification: false,
    }).catch(() => ({ verified: false, authenticationInfo: undefined }));
    if (!v.verified || !v.authenticationInfo) throw new HttpError(400, "not_verified", "The passkey could not be verified.");
    await svc.usedPasskey(userId, key.id, v.authenticationInfo.newCounter);
    return userId;
  }

  async function authOptions(purpose: string, extra: Record<string, unknown> = {}) {
    const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred", allowCredentials: [] });
    const challengeId = await svc.saveChallenge(options.challenge, { purpose, ...extra });
    return { ...options, challengeId };
  }

  provider.use(async (koaCtx, next) => {
    const ctx = koaCtx as unknown as Ctx;
    const path = ctx.path;
    const method = ctx.method;
    try {
      // ---------------------------------------------------------- assets and discovery
      if (method === "GET" && path === "/oauth/assets/auth.css") {
        ctx.set({ "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" });
        ctx.body = AUTH_CSS;
        return;
      }
      if (method === "GET" && path === "/oauth/assets/auth.js") {
        ctx.set({ "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" });
        ctx.body = AUTH_JS;
        return;
      }
      if (method === "GET" && (path === "/.well-known/oauth-protected-resource/mcp" || path === "/.well-known/oauth-protected-resource")) {
        ctx.set({ "access-control-allow-origin": "*", "cache-control": "public, max-age=300" });
        return json(ctx, {
          resource: `${baseUrl}/mcp`,
          authorization_servers: [baseUrl],
          scopes_supported: [...AGENT_SCOPES],
          bearer_methods_supported: ["header"],
          resource_name: "Annotatie",
          resource_documentation: `${baseUrl}/board/`,
        });
      }
      if (method === "GET" && path === "/.well-known/oauth-authorization-server") {
        ctx.path = "/.well-known/openid-configuration";
        await next();
        return;
      }

      // ---------------------------------------------------------- interactions
      const im = /^\/oauth\/interaction\/([A-Za-z0-9_-]+)(?:\/([a-z/]+))?$/.exec(path);
      if (im) {
        const [, uid, action = ""] = im;
        const details = await provider.interactionDetails(ctx.req, ctx.res).catch(() => undefined);
        if (!details || details.uid !== uid) {
          return html(ctx, messagePage("This sign-in has expired", "Go back to the app and start again.", { href: "/board/", label: "Open the portal" }), 400);
        }
        const prompt = details.prompt.name;

        if (method === "GET" && action === "") {
          if (prompt === "login") return html(ctx, signInPage(uid!));
          if (prompt === "consent") {
            const client = await provider.Client.find(String(details.params.client_id));
            const accountId = details.session?.accountId;
            if (!client || !accountId) throw new HttpError(400, "invalid_request");
            const sites = (await svc.mySites({ kind: "person", userId: accountId, name: "", via: { kind: "portal" } }, false)).map((s) => ({
              id: s.id,
              name: s.name,
              role: s.role ?? "viewer",
            }));
            return html(ctx, consentPage(uid!, String(client.clientName ?? "An agent"), sites));
          }
          throw new HttpError(400, "invalid_request");
        }

        if (method === "POST" && action === "passkey/options" && prompt === "login") {
          await svc.rateLimit(`signin#${clientIp(ctx)}#${Math.floor(Date.now() / 60000)}`, 30, 120);
          return json(ctx, await authOptions("signin", { uid }));
        }
        if (method === "POST" && action === "passkey" && prompt === "login") {
          const body = await readBody(ctx);
          const accountId = await verifyPasskey(body.response as Record<string, unknown>, body.challengeId, "signin");
          const redirect = await provider.interactionResult(ctx.req, ctx.res, { login: { accountId, amr: ["webauthn"] } }, { mergeWithLastSubmission: false });
          return json(ctx, { redirect });
        }
        if (method === "POST" && action === "recovery" && prompt === "login") {
          await svc.rateLimit(`recovery#${clientIp(ctx)}#${Math.floor(Date.now() / 3600000)}`, 10, 7200);
          const body = await readBody(ctx);
          const accountId = await svc.useRecoveryCode(String(body.email ?? ""), String(body.code ?? ""));
          if (!accountId) return html(ctx, signInPage(uid!, "That email and recovery code don't match. Each code works once."), 400);
          const to = await provider.interactionResult(ctx.req, ctx.res, { login: { accountId, amr: ["otp"] } }, { mergeWithLastSubmission: false });
          ctx.status = 303;
          ctx.redirect(to);
          return;
        }
        if (method === "POST" && action === "consent" && prompt === "consent") {
          const body = await readBody(ctx);
          const accountId = details.session!.accountId!;
          const clientId = String(details.params.client_id);
          const client = await provider.Client.find(clientId);
          if (!client) throw new HttpError(400, "invalid_request");
          const mine = await svc.mySites({ kind: "person", userId: accountId, name: "", via: { kind: "portal" } }, false);
          const sites = list(body.site).filter((s) => mine.some((m) => m.id === s));
          if (!sites.length) throw new HttpError(400, "invalid_request", "Choose at least one site.");
          const scopes = [...new Set(["read", ...list(body.scope)])].filter((s) => (AGENT_SCOPES as readonly string[]).includes(s));

          let grant = details.grantId ? await provider.Grant.find(details.grantId) : undefined;
          grant ??= new provider.Grant({ accountId, clientId });
          const requested = String(details.params.scope ?? "").split(" ").filter(Boolean);
          const oidcScopes = requested.filter((s) => ["openid", "offline_access", "profile", "email"].includes(s));
          if (oidcScopes.length) grant.addOIDCScope(oidcScopes.join(" "));
          const resource = String(details.params.resource ?? `${baseUrl}/mcp`);
          // The OAuth grant covers every agent scope; what the agent may really do is the person's
          // choice above, recorded in our table and checked by the MCP server on every call.
          grant.addResourceScope(resource, AGENT_SCOPES.join(" "));
          const grantId = await grant.save();
          await svc.recordGrant(accountId, { grantId, clientId, clientName: String(client.clientName ?? clientId).slice(0, LIMITS.name), sites, scopes });
          const to = await provider.interactionResult(ctx.req, ctx.res, { consent: { grantId } }, { mergeWithLastSubmission: true });
          ctx.status = 303;
          ctx.redirect(to);
          return;
        }
        if (method === "POST" && action === "abort") {
          await readBody(ctx);
          const to = await provider.interactionResult(ctx.req, ctx.res, { error: "access_denied", error_description: "The person denied access." }, { mergeWithLastSubmission: false });
          ctx.status = 303;
          ctx.redirect(to);
          return;
        }
        throw new HttpError(404, "not_found");
      }

      // ---------------------------------------------------------- invites
      const inv = /^\/oauth\/invite\/([A-Za-z0-9_-]{20,64})(?:\/([a-z/]+))?$/.exec(path);
      if (inv) {
        const [, token, action = ""] = inv;
        const invite = await svc.peekInvite(token!);
        if (!invite) {
          if (method === "GET") return html(ctx, messagePage("This invite can't be used", "It has been used or has expired. Ask the site owner for a new one."), 410);
          throw new HttpError(410, "invite_used", "This invite has been used or has expired.");
        }
        const existing = await svc.userByEmail(invite.email);
        if (method === "GET" && action === "") return html(ctx, invitePage(token!, invite.email, !!existing));

        await svc.rateLimit(`invite#${clientIp(ctx)}#${Math.floor(Date.now() / 60000)}`, 20, 120);
        if (method === "POST" && action === "options" && !existing) {
          const body = await readBody(ctx);
          const name = String(body.name ?? "").trim();
          if (!name || name.length > LIMITS.name) throw new HttpError(400, "invalid_request", "Write your name (up to 120 characters).");
          const options = await generateRegistrationOptions({
            rpName: "Annotatie",
            rpID,
            userName: invite.email,
            userDisplayName: name,
            userID: randomBytes(16),
            attestationType: "none",
            authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
          });
          const challengeId = await svc.saveChallenge(options.challenge, { purpose: "invite", inviteId: invite.id });
          return json(ctx, { ...options, challengeId });
        }
        if (method === "POST" && action === "" && !existing) {
          const body = await readBody(ctx);
          const name = String(body.name ?? "").trim().slice(0, LIMITS.name);
          const chal = await svc.takeChallenge(String(body.challengeId ?? ""));
          if (!chal || chal.purpose !== "invite" || chal.inviteId !== invite.id) throw new HttpError(400, "expired", "The request expired. Try again.");
          const v = await verifyRegistrationResponse({
            response: body.response as never,
            expectedChallenge: chal.challenge,
            expectedOrigin: baseUrl,
            expectedRPID: rpID,
            requireUserVerification: false,
          }).catch(() => ({ verified: false, registrationInfo: undefined }));
          if (!v.verified || !v.registrationInfo) throw new HttpError(400, "not_verified", "The passkey could not be verified.");
          const userId = await svc.createUser(name || invite.email, invite.email);
          const cred = v.registrationInfo.credential;
          await svc.addPasskey(userId, { id: cred.id, name: "First passkey", publicKey: Buffer.from(cred.publicKey).toString("base64url"), counter: cred.counter, transports: cred.transports });
          await svc.acceptInvite(token!, userId);
          const codes = await svc.newRecoveryCodes(userId);
          return json(ctx, { codes, next: "/board/" });
        }
        if (method === "POST" && action === "signin/options" && existing) return json(ctx, await authOptions("invite-signin", { inviteId: invite.id }));
        if (method === "POST" && action === "signin" && existing) {
          const body = await readBody(ctx);
          const userId = await verifyPasskey(body.response as Record<string, unknown>, body.challengeId, "invite-signin");
          if (userId !== existing) throw new HttpError(403, "wrong_account", `Sign in with the passkey for ${invite.email}.`);
          await svc.acceptInvite(token!, userId);
          return json(ctx, { redirect: "/board/" });
        }
        throw new HttpError(404, "not_found");
      }

      await next();
    } catch (e) {
      if (e instanceof HttpError) {
        if (ctx.get("accept").includes("application/json") || ctx.get("content-type").includes("application/json") || path.endsWith("options")) {
          return json(ctx, { error: e.code, message: e.message }, e.status);
        }
        return html(ctx, messagePage("Something went wrong", e.message, { href: "/board/", label: "Open the portal" }), e.status);
      }
      throw e;
    }
  });
}
