// @annotatie/sdk-browser — the Annotatie widget.
//
// Served as https://annotatie.consulteasy.co.uk/sdk/v1/annotatie.js and started from its own tag:
//   <script src=".../sdk/v1/annotatie.js" data-site="<siteId>" data-token-url="/annotatie/token" async></script>
// (optional data-theme="neutral|race-officials", data-build-id, data-sign-in-url). The API is the
// script's own origin. Hosts that bundle call `start(options)` instead.
//
// The host emits the tag only for people it permits to report (platform-design.md §4.1). If the host's
// token endpoint refuses, nothing is drawn. The widget defines no globals, sets no cookies and stores
// nothing personal; everything it draws is inside a closed shadow root.
import { Api } from "./api.js";
import { type HostToken, TokenSource } from "./token.js";
import { themeName, type ThemeName } from "./ui/theme.js";
import { Widget } from "./ui/widget.js";

export const DEFAULT_BASE = "https://annotatie.consulteasy.co.uk";

export interface StartOptions {
  siteId: string;
  /** The host's own token endpoint (same origin). Default `/annotatie/token`. */
  tokenUrl?: string;
  /**
   * Instead of `tokenUrl`, for hosts whose session is a bearer token rather than a cookie: return the
   * widget token from your own server, or null when this person may not report.
   */
  getToken?: () => Promise<HostToken | null>;
  /** Annotatie's origin. Default https://annotatie.consulteasy.co.uk. */
  base?: string;
  theme?: ThemeName;
  buildId?: string;
  /** Where "Sign in again (opens a new tab)" goes when the host's sign-in has ended. */
  signInUrl?: string;
  /** The host's route name for the current page, if it has one. */
  route?: () => string | undefined;
}

export type { HostToken };

export interface Annotatie {
  stop(): void;
}

let running: Widget | null = null;

function ready(doc: Document): Promise<void> {
  if (doc.readyState !== "loading") return Promise.resolve();
  return new Promise((r) => doc.addEventListener("DOMContentLoaded", () => r(), { once: true }));
}

/** Starts the widget. Resolves null (and draws nothing) when the host does not give a token. */
export async function start(options: StartOptions): Promise<Annotatie | null> {
  if (running) return { stop: () => stopRunning() };
  if (!options?.siteId) return null;
  const base = (options.base ?? DEFAULT_BASE).replace(/\/+$/, "");
  const tokens = new TokenSource({
    url: options.tokenUrl ?? "/annotatie/token",
    ...(options.getToken ? { getToken: options.getToken } : {}),
  });
  try {
    await tokens.get();
  } catch {
    tokens.stop();
    return null; // no permission, no sign-in, or no host endpoint: nothing is rendered
  }
  await ready(document);
  const widget = new Widget({
    api: new Api(base, tokens),
    theme: options.theme ?? "neutral",
    ...(options.buildId ? { buildId: options.buildId } : {}),
    ...(options.signInUrl ? { signInUrl: options.signInUrl } : {}),
    ...(options.route ? { route: options.route } : {}),
  });
  running = widget;
  const stopAll = () => {
    tokens.stop();
    widget.stop();
    if (running === widget) running = null;
  };
  stopFn = stopAll;
  await widget.start();
  return { stop: stopAll };
}

let stopFn: (() => void) | null = null;
function stopRunning(): void {
  stopFn?.();
}

/** Reads the options from the script tag that loaded this file. */
export function optionsFromScript(script: HTMLScriptElement | null): StartOptions | null {
  if (!script || !script.src) return null;
  const d = script.dataset;
  if (!d.site) return null;
  let base: string;
  try {
    base = new URL(script.src, document.baseURI).origin;
  } catch {
    return null;
  }
  return {
    siteId: d.site,
    base,
    tokenUrl: d.tokenUrl || "/annotatie/token",
    theme: themeName(d.theme),
    ...(d.buildId ? { buildId: d.buildId } : {}),
    ...(d.signInUrl ? { signInUrl: d.signInUrl } : {}),
  };
}

// Auto-start from our own <script> tag (document.currentScript is set while this file first runs).
if (typeof document !== "undefined") {
  const opts = optionsFromScript(document.currentScript as HTMLScriptElement | null);
  if (opts) void start(opts).catch(() => undefined);
}
