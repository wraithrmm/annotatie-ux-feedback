import { createHash, randomBytes } from "node:crypto";
import type { Role } from "./types.js";

/** Time-sortable id: 10 chars of time (ms, base32) + 16 random chars. Sorts by creation. */
export function newId(now = Date.now()): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = alphabet[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let r = "";
  for (let i = 0; i < 16; i++) r += alphabet[rnd[i]! & 31];
  return time + r;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("base64url");
}

const RANK: Record<Role, number> = { viewer: 1, member: 2, owner: 3 };

/** Does `role` reach `needed`? owner > member > viewer. */
export function roleAtLeast(role: Role | undefined, needed: Role): boolean {
  return !!role && RANK[role] >= RANK[needed];
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const LIMITS = {
  body: 5000,
  title: 200,
  reason: 1000,
  name: 120,
  origins: 20,
  labels: 20,
  reportsPerUserPerDay: 50,
  pageHtmlGz: 2 * 1024 * 1024,
  screenshot: 1.5 * 1024 * 1024,
  closeup: 300 * 1024,
} as const;

/** A string field: trimmed, required unless `optional`, at most `max` characters. */
export function str(v: unknown, field: string, max: number, optional = false): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (optional) return undefined;
    throw new HttpError(400, "invalid_request", `${field} is required.`);
  }
  if (typeof v !== "string") throw new HttpError(400, "invalid_request", `${field} must be text.`);
  const s = v.trim();
  if (!s && !optional) throw new HttpError(400, "invalid_request", `${field} is required.`);
  if (s.length > max) throw new HttpError(400, "too_long", `${field} is longer than ${max} characters.`);
  return s || undefined;
}

export function reqStr(v: unknown, field: string, max: number): string {
  return str(v, field, max, false)!;
}

/** An exact web origin ("https://host[:port]"); http only for localhost. */
export function normaliseOrigin(o: unknown): string {
  if (typeof o !== "string") throw new HttpError(400, "invalid_request", "Origins must be text.");
  let u: URL;
  try {
    u = new URL(o.trim());
  } catch {
    throw new HttpError(400, "invalid_request", `Not an origin: ${o}`);
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) {
    throw new HttpError(400, "invalid_request", `Origins must use https: ${o}`);
  }
  return u.origin;
}
