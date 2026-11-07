// The widget's access token, fetched from the host's own endpoint (same origin, the host's session
// cookies), refreshed 60 s before it expires, and fetched again once when the API answers 401.

export const REFRESH_EARLY_MS = 60_000;

/** The host said no (401/403): the user's sign-in ended or their permission was removed. */
export class SignInEnded extends Error {
  constructor(readonly status: number) {
    super("sign-in ended");
    this.name = "SignInEnded";
  }
}

/** The token endpoint could not be reached at all. */
export class Offline extends Error {
  constructor() {
    super("offline");
    this.name = "Offline";
  }
}

/** What a host's own token function returns: null when this person may not report. */
export interface HostToken {
  access_token: string;
  expires_in: number;
}

export interface TokenSourceOptions {
  /** The host's same-origin token endpoint (cookie session). Ignored when `getToken` is given. */
  url: string;
  /**
   * For hosts whose session is not a cookie (a single-page app holding a bearer token): fetch the widget
   * token from the host's server yourself. Resolve null when the person may not report; throw when the
   * host's server could not be reached.
   */
  getToken?: () => Promise<HostToken | null>;
  fetch?: typeof fetch;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class TokenSource {
  private token: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;
  private timer: unknown = null;
  private stopped = false;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(private readonly opts: TokenSourceOptions) {
    this.fetchFn = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** A token valid for at least another minute. */
  async get(): Promise<string> {
    if (this.token && this.now() < this.expiresAt - REFRESH_EARLY_MS) return this.token;
    return this.refresh();
  }

  /** Drops the current token (after a 401) and fetches a new one. Concurrent callers share one fetch. */
  invalidate(): Promise<string> {
    this.token = null;
    this.expiresAt = 0;
    return this.refresh();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.token = null;
  }

  private refresh(): Promise<string> {
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    if (this.opts.getToken) {
      let host: HostToken | null;
      try {
        host = await this.opts.getToken();
      } catch {
        throw new Offline();
      }
      if (!host) throw new SignInEnded(403);
      return this.accept(host);
    }
    let res: Response;
    try {
      res = await this.fetchFn(this.opts.url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
    } catch {
      throw new Offline();
    }
    if (res.status === 401 || res.status === 403 || res.status === 419) throw new SignInEnded(res.status);
    if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
    return this.accept((await res.json()) as { access_token?: unknown; expires_in?: unknown });
  }

  private accept(json: { access_token?: unknown; expires_in?: unknown }): string {
    if (typeof json.access_token !== "string" || typeof json.expires_in !== "number" || json.expires_in <= 0)
      throw new Error("token endpoint: unexpected response");
    this.token = json.access_token;
    this.expiresAt = this.now() + json.expires_in * 1000;
    this.schedule(json.expires_in * 1000);
    return json.access_token;
  }

  private schedule(lifetimeMs: number): void {
    if (this.stopped) return;
    if (this.timer !== null) this.clearTimer(this.timer);
    const wait = Math.max(5_000, lifetimeMs - REFRESH_EARLY_MS);
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.stopped) return;
      this.refresh().catch(() => {
        // The next API call fetches again and reports the failure where the user can see it.
      });
    }, wait);
  }
}
