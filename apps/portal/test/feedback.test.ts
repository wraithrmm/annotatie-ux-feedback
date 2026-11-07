import { describe, expect, it } from "vitest";
import { fetchWidgetToken } from "../src/feedback";

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe("fetchWidgetToken", () => {
  it("returns the token from the portal's own route", async () => {
    let asked = "";
    const t = await fetchWidgetToken(async (p) => {
      asked = p;
      return res(200, { siteId: "s1", access_token: "a", expires_in: 300 });
    });
    expect(asked).toBe("/api/self/widget-token");
    expect(t).toEqual({ siteId: "s1", access_token: "a", expires_in: 300 });
  });

  it("is null (no widget at all) for anyone the server does not permit", async () => {
    for (const s of [401, 403, 404]) expect(await fetchWidgetToken(async () => res(s, { error: "x" }))).toBeNull();
    expect(await fetchWidgetToken(async () => res(200, { nope: true }))).toBeNull();
  });

  it("throws when the server fails, so the widget reports it rather than vanishing silently mid-session", async () => {
    await expect(fetchWidgetToken(async () => res(502, { error: "token_unavailable" }))).rejects.toThrow(/502/);
  });
});
