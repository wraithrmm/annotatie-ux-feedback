// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { Auth, CLIENT_ID, RT_KEY, type AuthEnv } from "../src/auth";

const ORIGIN = "https://annotatie.example.test";

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

/** A token endpoint that rotates refresh tokens and refuses any reuse. */
function tokenServer() {
  let n = 0;
  const used = new Set<string>();
  const calls: URLSearchParams[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== `${ORIGIN}/oauth/token`) return new Response("{}", { status: 404 });
    const f = new URLSearchParams(String(init?.body));
    calls.push(f);
    await new Promise((r) => setTimeout(r, 5));
    if (f.get("grant_type") === "refresh_token") {
      const rt = f.get("refresh_token")!;
      if (used.has(rt) || !rt.startsWith("rt-")) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      used.add(rt);
    }
    n++;
    return new Response(JSON.stringify({ access_token: `at-${n}`, expires_in: 900, refresh_token: `rt-${n}` }), { status: 200 });
  });
  return { fetch, calls };
}

function makeEnv(fetch: AuthEnv["fetch"], storage = memStore()) {
  const navigate = vi.fn();
  const env: AuthEnv = { origin: ORIGIN, fetch, storage, session: memStore(), navigate, setTimer: () => 0, clearTimer: () => undefined };
  return { env, navigate, storage };
}

/** A tiny Web Locks stand-in shared between "tabs". */
function sharedLocks() {
  let tail = Promise.resolve();
  return {
    request<T>(_name: string, cb: () => Promise<T>): Promise<T> {
      const run = tail.then(cb);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

describe("sign-in", () => {
  it("sends the user to /oauth/authorize with PKCE S256, resource and state", async () => {
    const { env, navigate } = makeEnv(tokenServer().fetch as unknown as typeof fetch);
    await new Auth(env).signIn();
    const u = new URL(navigate.mock.calls[0]![0] as string);
    expect(u.origin + u.pathname).toBe(`${ORIGIN}/oauth/authorize`);
    expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(u.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/board/`);
    expect(u.searchParams.get("scope")).toBe("openid offline_access");
    expect(u.searchParams.get("resource")).toBe(`${ORIGIN}/api`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get("state")).toBeTruthy();
  });

  it("exchanges ?code with the verifier, keeps the refresh token and strips the URL", async () => {
    const srv = tokenServer();
    const { env, navigate, storage } = makeEnv(srv.fetch as unknown as typeof fetch);
    const auth = new Auth(env);
    await auth.signIn();
    const state = new URL(navigate.mock.calls[0]![0] as string).searchParams.get("state");
    const clean = await auth.handleRedirect(new URL(`${ORIGIN}/board/?code=abc&state=${state}&iss=x#/attention`));
    expect(clean).toBe("/board/#/attention");
    const f = srv.calls[0]!;
    expect(f.get("grant_type")).toBe("authorization_code");
    expect(f.get("code")).toBe("abc");
    expect(f.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.get("resource")).toBe(`${ORIGIN}/api`);
    expect(storage.getItem(RT_KEY)).toBe("rt-1");
    expect(await auth.getAccessToken()).toBe("at-1");
  });

  it("refuses a code whose state doesn't match", async () => {
    const { env } = makeEnv(tokenServer().fetch as unknown as typeof fetch);
    await expect(new Auth(env).handleRedirect(new URL(`${ORIGIN}/board/?code=abc&state=nope`))).rejects.toMatchObject({ code: "state_mismatch" });
  });
});

describe("refresh", () => {
  it("is single-flight within a tab: concurrent callers share one refresh", async () => {
    const srv = tokenServer();
    const storage = memStore();
    storage.setItem(RT_KEY, "rt-0");
    const { env } = makeEnv(srv.fetch as unknown as typeof fetch, storage);
    const auth = new Auth(env);
    const tokens = await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
    expect(new Set(tokens).size).toBe(1);
    expect(srv.calls.filter((c) => c.get("grant_type") === "refresh_token")).toHaveLength(1);
    expect(storage.getItem(RT_KEY)).toBe("rt-1");
  });

  it("never sends the same refresh token from two tabs (Web Lock, token read inside the lock)", async () => {
    const srv = tokenServer();
    const storage = memStore();
    storage.setItem(RT_KEY, "rt-0");
    const locks = sharedLocks();
    const a = new Auth({ ...makeEnv(srv.fetch as unknown as typeof fetch, storage).env, locks });
    const b = new Auth({ ...makeEnv(srv.fetch as unknown as typeof fetch, storage).env, locks });
    const [ta, tb] = await Promise.all([a.getAccessToken(), b.getAccessToken()]);
    expect(ta).not.toBe(tb);
    const sent = srv.calls.map((c) => c.get("refresh_token"));
    expect(new Set(sent).size).toBe(sent.length);
    expect(storage.getItem(RT_KEY)).toBe("rt-2");
  });

  it("retries a 401 once after a forced refresh", async () => {
    const srv = tokenServer();
    const storage = memStore();
    storage.setItem(RT_KEY, "rt-0");
    let apiCalls = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/oauth/token")) return srv.fetch(url, init);
      apiCalls++;
      const auth = new Headers(init?.headers).get("Authorization");
      return new Response("{}", { status: auth === "Bearer at-2" ? 200 : 401 });
    });
    const auth = new Auth(makeEnv(fetch as unknown as AuthEnv["fetch"], storage).env);
    const res = await auth.fetch(`${ORIGIN}/api/me`);
    expect(res.status).toBe(200);
    expect(apiCalls).toBe(2);
  });

  it("signs out when the refresh token is refused", async () => {
    const srv = tokenServer();
    const storage = memStore();
    storage.setItem(RT_KEY, "bad");
    const auth = new Auth(makeEnv(srv.fetch as unknown as typeof fetch, storage).env);
    const out = vi.fn();
    auth.onSignedOut = out;
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "invalid_grant" });
    expect(out).toHaveBeenCalled();
    expect(storage.getItem(RT_KEY)).toBeNull();
    expect(auth.hasSession()).toBe(false);
  });

  it("sign out clears the token and goes to end_session", () => {
    const storage = memStore();
    storage.setItem(RT_KEY, "rt-9");
    const { env, navigate } = makeEnv(tokenServer().fetch as unknown as typeof fetch, storage);
    new Auth(env).signOut();
    expect(storage.getItem(RT_KEY)).toBeNull();
    expect(String(navigate.mock.calls[0]![0])).toMatch(new RegExp(`^${ORIGIN}/oauth/logout\\?`));
  });
});
