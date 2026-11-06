// The MCP Lambda: POST /mcp, Streamable HTTP, stateless (each request carries the token, no sessions).
// A missing or bad token gets 401 with the RFC 9728 pointer, so a client discovers the authorization
// server and registers itself with only the URL.
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JWTVerifyGetKey } from "jose";
import { HttpError } from "@annotatie/core";
import { type AgentPrincipal, bearer, Db, jwksFor, makePushNotifier, mcpPrincipal, Service, verifyJwt } from "@annotatie/store";
import { s3Captures } from "@annotatie/api/src/captures.js";
import { createMcpServer, type McpDeps } from "./server.js";

export interface McpAppDeps extends McpDeps {
  keys: JWTVerifyGetKey;
}

type Result = APIGatewayProxyStructuredResultV2;

export function createMcpApp(deps: McpAppDeps) {
  const { svc, baseUrl, keys } = deps;
  const resourceMetadata = `${baseUrl}/.well-known/oauth-protected-resource/mcp`;

  async function principal(headers: Record<string, string | undefined>): Promise<AgentPrincipal> {
    const token = bearer(headers);
    if (token.startsWith("ann_pat_")) {
      const p = await svc.principalFromPat(token);
      if (!p) throw new HttpError(401, "invalid_token", "That access token is unknown, expired or revoked.");
      return p;
    }
    return mcpPrincipal(await verifyJwt(token, baseUrl, `${baseUrl}/mcp`, keys), svc);
  }

  return async function handle(event: APIGatewayProxyEventV2): Promise<Result> {
    const method = event.requestContext?.http?.method ?? "GET";
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const base = { "cache-control": "no-store" };

    if (method !== "POST") {
      // Stateless: no server-sent stream to resume and no session to end.
      return { statusCode: 405, headers: { ...base, allow: "POST", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }) };
    }

    let p: AgentPrincipal;
    try {
      p = await principal(headers);
      await svc.rateLimit(`mcp#${p.userId}#${Math.floor(Date.now() / 60000)}`, 240, 120);
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(401, "invalid_token", "Sign in first.");
      const h: Record<string, string> = { ...base, "content-type": "application/json" };
      if (err.status === 401) h["www-authenticate"] = `Bearer resource_metadata="${resourceMetadata}", error="${err.code}"`;
      return { statusCode: err.status, headers: h, body: JSON.stringify({ error: err.code, error_description: err.message }) };
    }

    const server = createMcpServer(p, deps);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body) : undefined;
      const req = new Request(`${baseUrl}/mcp`, {
        method,
        headers: Object.entries(headers).filter((kv): kv is [string, string] => typeof kv[1] === "string"),
        body,
      });
      const res = await transport.handleRequest(req);
      const out: Record<string, string> = { ...base };
      res.headers.forEach((v, k) => (out[k] = v));
      return { statusCode: res.status, headers: out, body: await res.text() };
    } finally {
      await server.close();
    }
  };
}

let app: ReturnType<typeof createMcpApp> | undefined;

export async function handler(event: APIGatewayProxyEventV2): Promise<Result> {
  const baseUrl = process.env.ANNOTATIE_BASE_URL ?? "https://annotatie.consulteasy.co.uk";
  if (!app) {
    const svc: Service = new Service(new Db(process.env.TABLE_NAME ?? "annotatie-data"), {
      autoApproveAllowed: process.env.AUTO_APPROVE_ALLOWED !== "false",
      baseUrl,
      notify: (e) => makePushNotifier(() => svc, baseUrl)(e),
    });
    app = createMcpApp({ svc, captures: s3Captures(process.env.CAPTURE_BUCKET ?? ""), baseUrl, keys: jwksFor(baseUrl) });
  }
  try {
    return await app(event);
  } catch (e) {
    console.error(JSON.stringify({ msg: "unhandled", error: String(e), stack: (e as Error).stack }));
    return { statusCode: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }) };
  }
}
