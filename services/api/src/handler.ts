import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

/**
 * P0: the API Lambda answers only the health check. Every other route is a 404.
 * Later phases add the real routes (implementation-plan.md §7, P2).
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? "/";

  if (path === "/api/health" && (method === "GET" || method === "HEAD")) {
    return json(200, {
      status: "ok",
      service: "annotatie-api",
      version: process.env.BUILD_SHA ?? "dev",
    });
  }

  return json(404, { error: "not_found" });
}

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    body: JSON.stringify(body),
  };
}
