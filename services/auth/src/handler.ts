// The auth Lambda: /oauth/* and /.well-known/*. node-oidc-provider runs behind serverless-http; the
// site-assertion exchange (RFC 7523) and the registration clean-up happen on the raw event first.
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from "aws-lambda";
import serverless from "serverless-http";
import { AGENT_SCOPES, HttpError } from "@annotatie/core";
import { PORTAL_CLIENT_ID } from "@annotatie/store";
import { Db, Service } from "@annotatie/store";
import { exchangeAssertion, JWT_BEARER } from "./assertion.js";
import { mountRoutes } from "./app.js";
import { cookieKeys, signingKey, type SigningKey } from "./keys.js";
import { createProvider } from "./provider.js";

/** The provider's own scopes; anything else in a registration's `scope` is dropped. */
const OIDC_SCOPES = ["openid", "offline_access", "profile", "email"];

const baseUrl = process.env.ANNOTATIE_BASE_URL ?? "https://annotatie.consulteasy.co.uk";
const host = new URL(baseUrl).host;

interface App {
  svc: Service;
  signing: SigningKey;
  run: (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyStructuredResultV2>;
}
let app: Promise<App> | undefined;

export async function createAuthApp(svc: Service): Promise<App> {
  const signing = await signingKey();
  const provider = createProvider({ svc, baseUrl, signing, cookieKeys: await cookieKeys() });
  mountRoutes(provider, { svc, baseUrl });
  const run = serverless(provider.app, { binary: false }) as unknown as App["run"];
  return { svc, signing, run };
}

function body(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

const isLoopback = (u: string) => {
  try {
    const url = new URL(u);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
};

export async function handleAuth(a: App, event: APIGatewayProxyEventV2, context: Context): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? "/";
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const ip = (headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() || event.requestContext?.http?.sourceIp || "unknown";

  // An authorize request with no scope would be granted nothing; MCP clients often omit it.
  if (method === "GET" && path === "/oauth/authorize") {
    const q = new URLSearchParams(event.rawQueryString ?? "");
    if (!q.get("scope")) {
      q.set("scope", q.get("client_id") === PORTAL_CLIENT_ID ? "openid offline_access profile email" : AGENT_SCOPES.join(" "));
      const raw = q.toString();
      event = { ...event, rawQueryString: raw, queryStringParameters: Object.fromEntries(q) };
    }
  }

  try {
    // RFC 7523: a site's server exchanges its assertion for a widget token.
    if (method === "POST" && path === "/oauth/token") {
      const form = new URLSearchParams(body(event));
      if (form.get("grant_type") === JWT_BEARER) {
        const out = await exchangeAssertion(form.get("assertion") ?? "", { svc: a.svc, baseUrl, signing: a.signing });
        return { statusCode: 200, headers: { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache" }, body: JSON.stringify(out) };
      }
    }
    // Dynamic registration: rate-limited; loopback redirect URIs mean a native app (any port, RFC 8252).
    if (method === "POST" && path === "/oauth/register") {
      await a.svc.rateLimit(`register#${ip}#${Math.floor(Date.now() / 3600000)}`, 20, 7200);
      try {
        const meta = JSON.parse(body(event)) as Record<string, unknown>;
        const uris = Array.isArray(meta.redirect_uris) ? (meta.redirect_uris as string[]) : [];
        let changed = false;
        if (uris.length && uris.every(isLoopback) && !meta.application_type) {
          meta.application_type = "native";
          changed = true;
        }
        // Clients such as claude.ai's connectors register with `scope` set to the MCP resource's scopes
        // (read, reply, ...). Those are resource scopes, not the provider's, which refuses them; what an
        // agent may do is chosen on the consent screen anyway. Keep only the OpenID scopes.
        if (typeof meta.scope === "string") {
          const kept = meta.scope.split(" ").filter((s) => OIDC_SCOPES.includes(s));
          if (kept.length) meta.scope = kept.join(" ");
          else delete meta.scope;
          changed = true;
        }
        if (changed) {
          const rewritten = JSON.stringify(meta);
          event = { ...event, body: rewritten, isBase64Encoded: false };
          // The body changed length: the provider reads exactly content-length bytes.
          headers["content-length"] = String(Buffer.byteLength(rewritten));
        }
      } catch {
        /* let the provider answer the bad request */
      }
    }
  } catch (e) {
    if (e instanceof HttpError) {
      return {
        statusCode: e.status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify({ error: e.code, error_description: e.message }),
      };
    }
    throw e;
  }

  // CloudFront sends API Gateway's host; the provider must build URLs for ours.
  const fixed: APIGatewayProxyEventV2 = {
    ...event,
    headers: { ...headers, host, "x-forwarded-proto": "https", "x-forwarded-host": host, "x-forwarded-for": ip },
  };
  return a.run(fixed, context);
}

export async function handler(event: APIGatewayProxyEventV2, context: Context): Promise<APIGatewayProxyStructuredResultV2> {
  app ??= createAuthApp(new Service(new Db(process.env.TABLE_NAME ?? "annotatie-data"), { autoApproveAllowed: process.env.AUTO_APPROVE_ALLOWED !== "false", baseUrl }));
  try {
    return await handleAuth(await app, event, context);
  } catch (e) {
    console.error(JSON.stringify({ msg: "unhandled", path: event.rawPath, error: String(e), stack: (e as Error).stack }));
    return { statusCode: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "server_error" }) };
  }
}
