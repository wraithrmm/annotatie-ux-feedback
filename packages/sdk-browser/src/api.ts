// The widget routes of docs/api.md §3. Every call carries the widget token; a 401 fetches the token
// again once and repeats the call. Failures are sorted into what RW-1's states need to say.
import type { CaptureContext, CaptureFile, Item, Message, PageRef, Anchor, PartRecord } from "@annotatie/core";
import { Offline, SignInEnded, type TokenSource } from "./token.js";

export type FailureKind = "offline" | "signin" | "invalid" | "conflict" | "notfound" | "limit" | "server";

export class ApiError extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly status: number,
    readonly code?: string,
    /** "RPT-7K2Q": only when the service was reached and named the request. */
    readonly reference?: string,
    readonly detail?: string,
  ) {
    super(`${kind} (${status}${code ? ` ${code}` : ""})`);
    this.name = "ApiError";
  }
}

export interface Me {
  user: { id: string; name: string };
  site: { id: string; name: string; privacyMode: boolean };
}

export interface NewItemBody {
  title?: string;
  body: string;
  page: PageRef;
  anchor?: Anchor;
  capture: {
    context: CaptureContext;
    part?: PartRecord;
    files: Partial<Record<CaptureFile, { size: number }>>;
  };
}

export interface UploadPolicy {
  url: string;
  fields: Record<string, string>;
}

/** A short reference the system team can find in the logs, from the request id the API returned. */
export function referenceFrom(headers: Headers | null | undefined): string | undefined {
  if (!headers) return undefined;
  const id = headers.get("x-request-id") || headers.get("apigw-requestid") || headers.get("x-amzn-requestid");
  if (!id) return undefined;
  const tail = id.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
  return tail.length === 4 ? `RPT-${tail}` : undefined;
}

export function classify(status: number): FailureKind {
  if (status === 401 || status === 403 || status === 419) return "signin";
  if (status === 404) return "notfound";
  if (status === 409) return "conflict";
  if (status === 400 || status === 413 || status === 422) return "invalid";
  if (status === 429) return "limit";
  return "server";
}

export class Api {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly base: string,
    private readonly tokens: TokenSource,
    fetchFn?: typeof fetch,
  ) {
    this.fetchFn = fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  private async token(fresh: boolean): Promise<string> {
    try {
      return fresh ? await this.tokens.invalidate() : await this.tokens.get();
    } catch (e) {
      if (e instanceof SignInEnded) throw new ApiError("signin", e.status);
      if (e instanceof Offline) throw new ApiError("offline", 0);
      throw new ApiError("server", 0);
    }
  }

  async raw(method: string, path: string, body?: unknown, accept = "application/json"): Promise<Response> {
    let retried = false;
    for (;;) {
      const token = await this.token(retried);
      let res: Response;
      try {
        res = await this.fetchFn(this.base + path, {
          method,
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          headers: {
            authorization: `Bearer ${token}`,
            accept,
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        throw new ApiError("offline", 0);
      }
      if (res.status === 401 && !retried) {
        retried = true;
        continue;
      }
      if (!res.ok) {
        let code: string | undefined;
        let detail: string | undefined;
        try {
          const j = (await res.json()) as { error?: unknown; message?: unknown };
          if (typeof j.error === "string") code = j.error;
          if (typeof j.message === "string") detail = j.message;
        } catch {
          // No JSON body.
        }
        throw new ApiError(classify(res.status), res.status, code, referenceFrom(res.headers), detail);
      }
      return res;
    }
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  me(): Promise<Me> {
    return this.json("GET", "/api/w/me");
  }
  itemsOnPage(path: string): Promise<{ items: Item[] }> {
    return this.json("GET", `/api/w/items?path=${encodeURIComponent(path)}`);
  }
  myItems(): Promise<{ items: Item[] }> {
    return this.json("GET", "/api/w/items?mine=1");
  }
  createItem(body: NewItemBody): Promise<{ item: Item; uploads: Partial<Record<CaptureFile, UploadPolicy>> }> {
    return this.json("POST", "/api/w/items", body);
  }
  confirmCapture(itemId: string, files: Partial<Record<CaptureFile, { size: number; sha256: string }>>): Promise<Item> {
    return this.json("POST", `/api/w/items/${encodeURIComponent(itemId)}/capture`, { files });
  }
  item(itemId: string): Promise<{ item: Item; messages: Message[] }> {
    return this.json("GET", `/api/w/items/${encodeURIComponent(itemId)}`);
  }
  /** The reporter confirms a resolved report is sorted: resolved → closed. */
  closeReport(itemId: string): Promise<Item> {
    return this.json("POST", `/api/w/items/${encodeURIComponent(itemId)}/close`);
  }
  reply(itemId: string, body: string): Promise<Message> {
    return this.json("POST", `/api/w/items/${encodeURIComponent(itemId)}/messages`, { body });
  }
  captureUrl(itemId: string, file: Exclude<CaptureFile, "html">): Promise<{ url: string }> {
    return this.json("GET", `/api/w/items/${encodeURIComponent(itemId)}/capture/${file}`);
  }
  async captureHtml(itemId: string): Promise<string> {
    const res = await this.raw("GET", `/api/w/items/${encodeURIComponent(itemId)}/capture/html`, undefined, "text/html");
    return res.text();
  }
}

/** S3 presigned POST: the policy's fields first, then the file. No credentials, no token. */
export async function postToPolicy(policy: UploadPolicy, blob: Blob, filename: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(policy.fields)) form.append(k, v);
  form.append("file", blob, filename);
  const res = await fetchFn(policy.url, { method: "POST", body: form, mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`upload refused (${res.status})`);
}
