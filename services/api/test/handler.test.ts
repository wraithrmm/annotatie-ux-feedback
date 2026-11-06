import { describe, expect, it, beforeEach } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "../src/handler.js";

function event(method: string, path: string): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2;
}

describe("api handler (P0)", () => {
  beforeEach(() => {
    process.env.BUILD_SHA = "abc1234";
  });

  it("answers the health check with the build sha", async () => {
    const res = await handler(event("GET", "/api/health"));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      status: "ok",
      service: "annotatie-api",
      version: "abc1234",
    });
    expect(res.headers?.["cache-control"]).toBe("no-store");
  });

  it("refuses everything else with 404", async () => {
    for (const [m, p] of [
      ["POST", "/api/health"],
      ["GET", "/api/items"],
      ["GET", "/"],
    ] as const) {
      const res = await handler(event(m, p));
      expect(res.statusCode).toBe(404);
    }
  });
});
