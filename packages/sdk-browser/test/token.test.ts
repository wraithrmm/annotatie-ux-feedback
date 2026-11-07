// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Api, ApiError, classify, referenceFrom } from "../src/api.js";
import { Offline, REFRESH_EARLY_MS, SignInEnded, TokenSource } from "../src/token.js";

function clock() {
  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const t = { at: now + ms, fn };
      timers.push(t);
      return t;
    },
    clearTimer: (h: unknown) => {
      const i = timers.indexOf(h as never);
      if (i >= 0) timers.splice(i, 1);
    },
    async advance(ms: number) {
      now += ms;
      for (const t of timers.filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
      await new Promise((r) => setTimeout(r, 0));
    },
    pending: () => timers.map((t) => t.at - now),
  };
}

function tokenEndpoint(responses: Array<number | { token: string; expires: number }>) {
  const calls: RequestInit[] = [];
  const fetch = (async (_u: string, init: RequestInit) => {
    calls.push(init);
    const r = responses.shift() ?? { token: "t-last", expires: 300 };
    if (typeof r === "number") return new Response("{}", { status: r });
    return new Response(JSON.stringify({ access_token: r.token, expires_in: r.expires }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("TokenSource with a host getToken (bearer-session hosts)", () => {
  it("uses getToken instead of the URL, caches, and refreshes through it", async () => {
    const c = clock();
    let n = 0;
    const fetch = (async () => {
      throw new Error("the URL must not be fetched");
    }) as unknown as typeof globalThis.fetch;
    const ts = new TokenSource({ url: "/annotatie/token", fetch, getToken: async () => ({ access_token: `g${++n}`, expires_in: 300 }), ...c });
    expect(await ts.get()).toBe("g1");
    expect(await ts.get()).toBe("g1");
    await c.advance(300_000 - REFRESH_EARLY_MS);
    expect(await ts.get()).toBe("g2");
  });

  it("null means not permitted (SignInEnded); a throw means offline", async () => {
    const c = clock();
    await expect(new TokenSource({ url: "/x", getToken: async () => null, ...c }).get()).rejects.toBeInstanceOf(SignInEnded);
    await expect(
      new TokenSource({ url: "/x", getToken: async () => Promise.reject(new Error("down")), ...c }).get(),
    ).rejects.toBeInstanceOf(Offline);
  });

  it("rejects a malformed host token", async () => {
    const c = clock();
    const ts = new TokenSource({ url: "/x", getToken: async () => ({ access_token: "a", expires_in: 0 }), ...c });
    await expect(ts.get()).rejects.toThrow(/unexpected/);
  });
});

describe("TokenSource", () => {
  it("fetches with the host's cookies, caches, and schedules a refresh 60 s before expiry", async () => {
    const c = clock();
    const ep = tokenEndpoint([{ token: "t1", expires: 300 }, { token: "t2", expires: 300 }]);
    const ts = new TokenSource({ url: "/annotatie/token", fetch: ep.fetch, ...c });
    expect(await ts.get()).toBe("t1");
    expect(ep.calls[0]!.credentials).toBe("include");
    expect(await ts.get()).toBe("t1");
    expect(ep.calls).toHaveLength(1);
    expect(c.pending()).toEqual([300_000 - REFRESH_EARLY_MS]);
    await c.advance(240_000);
    expect(ep.calls).toHaveLength(2);
    expect(await ts.get()).toBe("t2");
    ts.stop();
    expect(c.pending()).toEqual([]);
  });

  it("refetches when within a minute of expiry even if the timer has not fired", async () => {
    const c = clock();
    const ep = tokenEndpoint([{ token: "t1", expires: 300 }, { token: "t2", expires: 300 }]);
    const ts = new TokenSource({ url: "/t", fetch: ep.fetch, now: c.now, setTimer: () => 0, clearTimer: () => undefined });
    await ts.get();
    await c.advance(241_000);
    expect(await ts.get()).toBe("t2");
  });

  it("shares one fetch between concurrent callers and invalidate() fetches a new token", async () => {
    const c = clock();
    const ep = tokenEndpoint([{ token: "t1", expires: 300 }, { token: "t2", expires: 300 }]);
    const ts = new TokenSource({ url: "/t", fetch: ep.fetch, ...c });
    const [a, b] = await Promise.all([ts.get(), ts.get()]);
    expect([a, b]).toEqual(["t1", "t1"]);
    expect(ep.calls).toHaveLength(1);
    expect(await ts.invalidate()).toBe("t2");
  });

  it("reports a refused host endpoint as a sign-in that ended", async () => {
    const ts = new TokenSource({ url: "/t", fetch: tokenEndpoint([403]).fetch, setTimer: () => 0, clearTimer: () => undefined });
    await expect(ts.get()).rejects.toBeInstanceOf(SignInEnded);
  });
});

describe("Api", () => {
  it("repeats a call once with a fresh token after a 401", async () => {
    const c = clock();
    const ep = tokenEndpoint([{ token: "old", expires: 300 }, { token: "new", expires: 300 }]);
    const ts = new TokenSource({ url: "/t", fetch: ep.fetch, ...c });
    const seen: string[] = [];
    const apiFetch = (async (_u: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).authorization!;
      seen.push(auth);
      return auth === "Bearer old" ? new Response("{}", { status: 401 }) : new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = new Api("https://a.test", ts, apiFetch);
    expect(await api.itemsOnPage("/x y")).toEqual({ items: [] });
    expect(seen).toEqual(["Bearer old", "Bearer new"]);
  });

  it("gives up after the second 401, and sorts failures into what the states need", async () => {
    const ep = tokenEndpoint([{ token: "a", expires: 300 }, { token: "b", expires: 300 }]);
    const ts = new TokenSource({ url: "/t", fetch: ep.fetch, setTimer: () => 0, clearTimer: () => undefined });
    const api = new Api("https://a.test", ts, (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
    await expect(api.me()).rejects.toMatchObject({ kind: "signin", status: 401 });

    const headers = new Headers({ "apigw-requestid": "Abc123=x7k2q" });
    const api500 = new Api("https://a.test", ts, (async () => new Response(JSON.stringify({ error: "boom" }), { status: 500, headers })) as unknown as typeof fetch);
    const err = (await api500.me().catch((e) => e)) as ApiError;
    expect(err.kind).toBe("server");
    expect(err.reference).toBe("RPT-7K2Q");
    expect(err.code).toBe("boom");

    const offline = new Api("https://a.test", ts, (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    await expect(offline.me()).rejects.toMatchObject({ kind: "offline" });

    expect(classify(422)).toBe("invalid");
    expect(classify(409)).toBe("conflict");
    expect(classify(429)).toBe("limit");
    expect(classify(419)).toBe("signin");
    expect(referenceFrom(new Headers())).toBeUndefined();
  });
});
