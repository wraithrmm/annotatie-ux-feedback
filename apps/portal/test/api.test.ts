// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "../src/api";

function recorder(respond: (path: string, init: RequestInit) => Response) {
  const calls: Array<{ path: string; method: string; body: unknown; headers: Headers }> = [];
  const request = vi.fn(async (path: string, init: RequestInit = {}) => {
    calls.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers) });
    return respond(path, init);
  });
  return { api: createApi(request), calls };
}
const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

describe("api client", () => {
  it("builds the routes of docs/api.md §2", async () => {
    const { api, calls } = recorder(() => ok({}));
    await api.me();
    await api.attention();
    await api.items("s 1", { kind: "report", status: "open", q: "a b" });
    await api.approve("s1", "i1", "m1", "edited");
    await api.approve("s1", "i1", "m2");
    await api.undo("s1", "i1", "m1");
    await api.reject("s1", "i1", "m1", "Wrong tone");
    await api.answer("s1", "q1", { option: "A" });
    await api.setAutoApprove("s1", true, "2026-12-01T00:00:00.000Z");
    await api.setAutoApprove("s1", false);
    await api.captureUrl("s1", "i1", "closeup");
    await api.createToken({ name: "t", sites: ["s1"], scopes: ["read"], expiresInDays: 30 });
    await api.invite("s1", { email: "a@example.com", role: "member" });
    await api.addKey("s1", { publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: "x" } });
    await api.subscribePush({ endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" }, device: "iPhone" });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/me",
      "GET /api/attention",
      "GET /api/sites/s%201/items?kind=report&status=open&q=a+b",
      "POST /api/sites/s1/items/i1/messages/m1/approve",
      "POST /api/sites/s1/items/i1/messages/m2/approve",
      "POST /api/sites/s1/items/i1/messages/m1/undo",
      "POST /api/sites/s1/items/i1/messages/m1/reject",
      "POST /api/sites/s1/items/q1/answer",
      "PUT /api/sites/s1/auto-approve",
      "PUT /api/sites/s1/auto-approve",
      "GET /api/sites/s1/items/i1/capture/closeup",
      "POST /api/tokens",
      "POST /api/sites/s1/invites",
      "POST /api/sites/s1/keys",
      "POST /api/push/subscriptions",
    ]);
    expect(calls[3]!.body).toEqual({ body: "edited" });
    expect(calls[4]!.body).toEqual({});
    expect(calls[6]!.body).toEqual({ reason: "Wrong tone" });
    expect(calls[8]!.body).toEqual({ on: true, until: "2026-12-01T00:00:00.000Z" });
    expect(calls[9]!.body).toEqual({ on: false });
    expect(calls[3]!.headers.get("Content-Type")).toBe("application/json");
  });

  it("returns undefined for 204", async () => {
    const { api } = recorder(() => new Response(null, { status: 204 }));
    await expect(api.revokeToken("t1")).resolves.toBeUndefined();
  });

  it("turns error bodies into ApiError with the code (409 too_late)", async () => {
    const { api } = recorder(() => ok({ error: "too_late", message: "It was already sent." }, 409));
    const e = await api.undo("s", "i", "m").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: "too_late", message: "It was already sent." });
  });

  it("reports a network failure as offline", async () => {
    const api = createApi(async () => {
      throw new TypeError("Failed to fetch");
    });
    const e = (await api.me().catch((x: unknown) => x)) as ApiError;
    expect(e.offline).toBe(true);
  });

  it("reads the page copy as text", async () => {
    const { api, calls } = recorder(() => new Response("<p>copy</p>", { status: 200, headers: { "Content-Type": "text/html" } }));
    expect(await api.captureHtml("s1", "i1")).toBe("<p>copy</p>");
    expect(calls[0]!.path).toBe("/api/sites/s1/items/i1/capture/html");
  });
});
