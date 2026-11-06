// Portal sign-in: OAuth 2.1 authorization code + PKCE (docs/api.md §1).
// - The refresh token lives in localStorage (it rotates on every use; only the latest is kept).
// - The access token lives in memory only, and is refreshed about 60 s before it expires.
// - Refreshing is single-flight: one request per tab (a shared promise) and one across tabs
//   (a Web Lock), so the same refresh token is never sent twice.

import { challengeS256, makeVerifier, randomString } from "./pkce";

export const CLIENT_ID = "annotatie-portal";
export const RT_KEY = "annotatie.rt";
const PENDING_KEY = "annotatie.pkce";
const LOCK_NAME = "annotatie-refresh";
const EARLY_MS = 60_000;

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AuthEnv {
  /** The portal's origin, e.g. "https://annotatie.consulteasy.co.uk". */
  origin: string;
  fetch: typeof fetch;
  /** Durable storage for the refresh token (localStorage). */
  storage: KV;
  /** Per-tab storage for the PKCE verifier and state while the browser is away (sessionStorage). */
  session: KV;
  navigate: (url: string) => void;
  locks?: { request: <T>(name: string, cb: () => Promise<T>) => Promise<T> } | undefined;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export class Auth {
  private access: { token: string; exp: number } | null = null;
  private inflight: Promise<string> | null = null;
  private timer: unknown = null;
  /** Called when the session can't be recovered (refresh refused); the app then asks to sign in. */
  onSignedOut: (() => void) | null = null;

  constructor(private env: AuthEnv) {}

  get redirectUri(): string {
    return `${this.env.origin}/board/`;
  }
  get resource(): string {
    return `${this.env.origin}/api`;
  }
  private now(): number {
    return this.env.now ? this.env.now() : Date.now();
  }

  hasSession(): boolean {
    return !!this.access || !!this.env.storage.getItem(RT_KEY);
  }

  /** Builds the authorize URL, keeps the verifier and state for this tab, and leaves for the sign-in page. */
  async signIn(): Promise<void> {
    const verifier = makeVerifier();
    const state = randomString(16);
    this.env.session.setItem(PENDING_KEY, JSON.stringify({ verifier, state }));
    const q = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: this.redirectUri,
      scope: "openid offline_access",
      resource: this.resource,
      state,
      code_challenge: await challengeS256(verifier),
      code_challenge_method: "S256",
    });
    this.env.navigate(`${this.env.origin}/oauth/authorize?${q}`);
  }

  /**
   * If the URL carries `?code=` (or `?error=`), finishes the sign-in. Returns the address to put in the
   * address bar (without code, state, iss and error), or null when there was nothing to do.
   */
  async handleRedirect(url: URL): Promise<string | null> {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (!code && !error) return null;
    const clean = new URL(url.href);
    for (const k of ["code", "state", "iss", "error", "error_description", "session_state"]) clean.searchParams.delete(k);
    const cleanHref = clean.pathname + clean.search + clean.hash;

    const pendingRaw = this.env.session.getItem(PENDING_KEY);
    this.env.session.removeItem(PENDING_KEY);
    if (error) throw new AuthError(error, url.searchParams.get("error_description") || "Sign-in was cancelled.");
    const pending = pendingRaw ? (JSON.parse(pendingRaw) as { verifier: string; state: string }) : null;
    if (!pending || pending.state !== url.searchParams.get("state")) {
      throw new AuthError("state_mismatch", "This sign-in link is out of date. Sign in again.");
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: this.redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pending.verifier,
      resource: this.resource,
    });
    const tok = await this.tokenRequest(body);
    this.accept(tok);
    return cleanHref;
  }

  /** A valid access token: the one in memory, or a fresh one. */
  async getAccessToken(): Promise<string> {
    if (this.access && this.access.exp - EARLY_MS > this.now()) return this.access.token;
    return this.refresh();
  }

  /** Single-flight refresh. `force` refreshes even when the token in memory still looks valid (after a 401). */
  refresh(force = false): Promise<string> {
    if (this.inflight) return this.inflight;
    const staleToken = this.access?.token;
    const run = async (): Promise<string> => {
      // An earlier call may have refreshed while this one waited for the lock.
      if (!force && this.access && this.access.exp - EARLY_MS > this.now()) return this.access.token;
      if (force && this.access && this.access.token !== staleToken) return this.access.token;
      // Read the refresh token inside the lock: another tab may have rotated it while we waited.
      const rt = this.env.storage.getItem(RT_KEY);
      if (!rt) {
        this.access = null;
        this.onSignedOut?.();
        throw new AuthError("no_session", "You're signed out.");
      }
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: rt,
        client_id: CLIENT_ID,
        resource: this.resource,
      });
      let tok: TokenResponse;
      try {
        tok = await this.tokenRequest(body);
      } catch (e) {
        if (e instanceof AuthError && e.code !== "network") {
          // Forget the token only if no other tab replaced it meanwhile.
          if (this.env.storage.getItem(RT_KEY) === rt) this.env.storage.removeItem(RT_KEY);
          this.access = null;
          this.onSignedOut?.();
        }
        throw e;
      }
      this.accept(tok);
      return tok.access_token;
    };
    const locks = this.env.locks;
    const p = locks ? locks.request(LOCK_NAME, run) : run();
    this.inflight = p.finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** fetch with the access token; a 401 is retried once after a forced refresh. */
  async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return this.env.fetch(input, { ...init, headers });
    };
    const res = await send(await this.getAccessToken());
    if (res.status !== 401) return res;
    return send(await this.refresh(true));
  }

  /** Clears everything and ends the server session (end_session). */
  signOut(): void {
    this.clear();
    const q = new URLSearchParams({ client_id: CLIENT_ID, post_logout_redirect_uri: this.redirectUri });
    this.env.navigate(`${this.env.origin}/oauth/logout?${q}`);
  }

  clear(): void {
    this.access = null;
    this.env.storage.removeItem(RT_KEY);
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private clearTimer(t: unknown) {
    if (this.env.clearTimer) this.env.clearTimer(t);
    else clearTimeout(t as ReturnType<typeof setTimeout>);
  }

  private accept(tok: TokenResponse) {
    this.access = { token: tok.access_token, exp: this.now() + tok.expires_in * 1000 };
    if (tok.refresh_token) this.env.storage.setItem(RT_KEY, tok.refresh_token);
    if (this.timer != null) this.clearTimer(this.timer);
    const due = Math.max(5_000, tok.expires_in * 1000 - EARLY_MS);
    const fire = () => {
      this.timer = null;
      this.refresh().catch(() => undefined);
    };
    this.timer = this.env.setTimer ? this.env.setTimer(fire, due) : setTimeout(fire, due);
  }

  private async tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
    let res: Response;
    try {
      res = await this.env.fetch(`${this.env.origin}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body.toString(),
      });
    } catch {
      throw new AuthError("network", "No connection.");
    }
    const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & {
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new AuthError(json.error || `http_${res.status}`, json.error_description || "Sign-in failed.");
    }
    return json as TokenResponse;
  }
}
