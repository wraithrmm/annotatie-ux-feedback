// A small in-memory stand-in for Annotatie's widget API (docs/api.md §1 token exchange and §3 widget
// routes), plus a fake S3 presigned-POST endpoint and the widget script itself, for the Playwright specs.
// It is a test double, not the service: it keeps everything in memory and forgets it on restart.
//
// Env: MOCK_PORT (4311), ALLOWED_ORIGIN (the fixture host's origin), ANNOTATIE_SITE_ID,
//      SITE_PUBLIC_JWK (the site key's public JWK as JSON), PRIVACY_MODE ("1" for on).
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const PORT = Number(process.env.MOCK_PORT ?? 4311);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = process.env.ALLOWED_ORIGIN ?? "http://127.0.0.1:4310";
const SITE = process.env.ANNOTATIE_SITE_ID ?? "site_fixture";
const JWK = process.env.SITE_PUBLIC_JWK ? JSON.parse(process.env.SITE_PUBLIC_JWK) : null;

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const bundle = await build({ entryPoints: [entry], bundle: true, write: false, format: "iife", target: ["es2020"], platform: "browser", minify: false, legalComments: "none" });
const WIDGET_JS = bundle.outputFiles[0].text;

let state;
function reset() {
  state = { items: [], messages: [], tokens: new Map(), jtis: new Set(), objects: new Map(), next: 1, failNext: {} };
}
reset();

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { "content-type": "application/json", "x-request-id": randomUUID(), ...extra });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const err = (res, status, error, message = error) => json(res, status, { error, message });

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && origin === ORIGIN) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-expose-headers", "x-request-id");
    res.setHeader("access-control-max-age", "600");
  }
}

function verifyAssertion(jws) {
  const [h, p, s] = String(jws).split(".");
  if (!h || !p || !s) return null;
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (header.alg !== "EdDSA" || !JWK) return null;
  const ok = verify(null, Buffer.from(`${h}.${p}`), createPublicKey({ key: JWK, format: "jwk" }), Buffer.from(s, "base64url"));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== SITE || claims.aud !== `${BASE}/oauth/token`) return null;
  if (!claims.sub || !claims.name || !claims.jti) return null;
  if (claims.exp - claims.iat > 60 || claims.exp < now - 5) return null;
  if (state.jtis.has(claims.jti)) return null;
  state.jtis.add(claims.jti);
  return claims;
}

function caller(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  const t = m && state.tokens.get(m[1]);
  return t && t.exp > Date.now() ? t : null;
}

const publicItem = (i) => i;
const visibleMessages = (id) => state.messages.filter((m) => m.itemId === id && m.visibility === "user" && m.state === "published");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  cors(req, res);
  if (req.method === "OPTIONS") return json(res, 204);
  try {
    // ---- the widget script, served from the API's own origin
    if (req.method === "GET" && url.pathname === "/sdk/v1/annotatie.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      return res.end(WIDGET_JS);
    }

    // ---- test hooks (not part of the contract)
    if (url.pathname === "/__test/reset") {
      reset();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/__test/state") {
      return json(res, 200, { items: state.items, messages: state.messages, objects: [...state.objects.keys()] });
    }
    if (url.pathname.startsWith("/__test/html/")) {
      const id = url.pathname.slice("/__test/html/".length);
      const obj = state.objects.get(`sites/${SITE}/items/${id}/capture/page.html.gz`);
      if (!obj) return err(res, 404, "not_found");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end(gunzipSync(obj.bytes).toString("utf8"));
    }
    if (url.pathname === "/__test/fail" && req.method === "POST") {
      const { route, status } = JSON.parse((await readBody(req)).toString() || "{}");
      state.failNext[route] = status;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/__test/team-reply" && req.method === "POST") {
      const { itemId, body } = JSON.parse((await readBody(req)).toString());
      const item = state.items.find((i) => i.id === itemId);
      const now = new Date().toISOString();
      state.messages.push({ id: randomUUID(), itemId, siteId: SITE, author: { kind: "team", id: "t1", name: "Sam Okafor" }, body, visibility: "user", state: "published", createdAt: now, publishedAt: now, releaseAt: now });
      item.status = "answered";
      item.updatedAt = now;
      return json(res, 200, { ok: true });
    }

    // ---- token exchange (RFC 7523)
    if (req.method === "POST" && url.pathname === "/oauth/token") {
      const form = new URLSearchParams((await readBody(req)).toString());
      if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return err(res, 400, "unsupported_grant_type");
      const claims = verifyAssertion(form.get("assertion"));
      if (!claims) return err(res, 400, "invalid_grant");
      const token = `wt_${randomUUID()}`;
      state.tokens.set(token, { sub: claims.sub, name: claims.name, exp: Date.now() + 300_000 });
      return json(res, 200, { access_token: token, token_type: "Bearer", expires_in: 300, scope: "report" });
    }

    // ---- fake S3: presigned POST in, GET out
    if (req.method === "POST" && url.pathname === "/s3") {
      const raw = await readBody(req);
      const form = await new Request(BASE, { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: raw }).formData();
      const key = form.get("key");
      const file = form.get("file");
      if (typeof key !== "string" || !file || typeof file === "string") return err(res, 400, "bad_upload");
      const bytes = Buffer.from(await file.arrayBuffer());
      state.objects.set(key.replace(/^pending\//, ""), { bytes, type: form.get("Content-Type") ?? "application/octet-stream" });
      return json(res, 204);
    }
    if (req.method === "GET" && url.pathname.startsWith("/s3obj/")) {
      const obj = state.objects.get(decodeURIComponent(url.pathname.slice("/s3obj/".length)));
      if (!obj) return err(res, 404, "not_found");
      res.writeHead(200, { "content-type": obj.type, "access-control-allow-origin": "*" });
      return res.end(obj.bytes);
    }

    // ---- widget routes
    if (!url.pathname.startsWith("/api/w/")) return err(res, 404, "not_found");
    if (req.headers.origin && req.headers.origin !== ORIGIN) return err(res, 403, "origin_not_allowed");
    const who = caller(req);
    if (!who) return err(res, 401, "invalid_token");
    const parts = url.pathname.split("/").filter(Boolean); // api, w, ...
    const fail = state.failNext[`${req.method} ${parts.slice(2, 3).join("/")}`];
    if (fail) {
      delete state.failNext[`${req.method} ${parts.slice(2, 3).join("/")}`];
      return err(res, fail, "test_failure");
    }

    if (req.method === "GET" && url.pathname === "/api/w/me") {
      return json(res, 200, { user: { id: who.sub, name: who.name }, site: { id: SITE, name: "Fixture site", privacyMode: process.env.PRIVACY_MODE === "1" } });
    }
    if (req.method === "GET" && url.pathname === "/api/w/items") {
      const path = url.searchParams.get("path");
      const mine = url.searchParams.get("mine") === "1";
      const items = state.items
        .filter((i) => (mine ? i.reporter.id === who.sub : i.page?.path === path))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(res, 200, { items: items.map(publicItem) });
    }
    if (req.method === "POST" && url.pathname === "/api/w/items") {
      const body = JSON.parse((await readBody(req)).toString());
      if (typeof body.body !== "string" || !body.body.trim()) return err(res, 422, "body_required");
      if (body.body.length > 5000) return err(res, 422, "body_too_long");
      if (body.title && body.title.length > 200) return err(res, 422, "title_too_long");
      const now = new Date().toISOString();
      const id = randomUUID();
      const item = {
        id, siteId: SITE, number: state.next++, kind: "report", title: body.title ?? body.body.slice(0, 200), status: "open",
        page: body.page, anchor: body.anchor, reporter: { kind: "user", id: who.sub, name: who.name }, labels: [], links: [],
        capture: { context: body.capture.context, part: body.capture.part, files: {}, confirmed: false },
        counts: { messages: 1, drafts: 0 }, createdAt: now, updatedAt: now, lastUserMessageAt: now,
      };
      state.items.push(item);
      state.messages.push({ id: randomUUID(), itemId: id, siteId: SITE, author: { kind: "user", id: who.sub, name: who.name }, body: body.body, visibility: "user", state: "published", createdAt: now, publishedAt: now });
      const names = { page: "page.webp", pageMarked: "page-marked.webp", closeup: "closeup.webp", html: "page.html.gz" };
      const uploads = {};
      for (const f of Object.keys(body.capture.files ?? {})) {
        const key = `pending/sites/${SITE}/items/${id}/capture/${names[f]}`;
        uploads[f] = { url: `${BASE}/s3`, fields: { key, "Content-Type": f === "html" ? "text/html" : "image/webp", ...(f === "html" ? { "Content-Encoding": "gzip" } : {}), policy: "mock", "x-amz-signature": "mock" } };
      }
      return json(res, 201, { item, uploads });
    }
    const id = parts[3];
    const item = state.items.find((i) => i.id === id);
    if (!item) return err(res, 404, "not_found");
    if (req.method === "GET" && parts.length === 4) return json(res, 200, { item, messages: visibleMessages(id) });
    if (req.method === "POST" && parts[4] === "messages") {
      const { body } = JSON.parse((await readBody(req)).toString());
      if (typeof body !== "string" || !body.trim()) return err(res, 422, "body_required");
      if (body.length > 5000) return err(res, 422, "body_too_long");
      const now = new Date().toISOString();
      const m = { id: randomUUID(), itemId: id, siteId: SITE, author: { kind: "user", id: who.sub, name: who.name }, body, visibility: "user", state: "published", createdAt: now, publishedAt: now };
      state.messages.push(m);
      if (item.status === "answered" && item.reporter.id === who.sub) item.status = "open";
      item.updatedAt = now;
      return json(res, 201, m);
    }
    if (req.method === "POST" && parts[4] === "capture" && parts.length === 5) {
      const { files } = JSON.parse((await readBody(req)).toString());
      const names = { page: "page.webp", pageMarked: "page-marked.webp", closeup: "closeup.webp", html: "page.html.gz" };
      for (const [f, meta] of Object.entries(files ?? {})) {
        const obj = state.objects.get(`sites/${SITE}/items/${id}/capture/${names[f]}`);
        if (!obj || obj.bytes.length !== meta.size) continue;
        if (createHash("sha256").update(obj.bytes).digest("hex") !== meta.sha256) continue;
        item.capture.files[f] = { size: meta.size };
      }
      item.capture.confirmed = true;
      return json(res, 200, item);
    }
    if (req.method === "GET" && parts[4] === "capture" && parts[5]) {
      const names = { page: "page.webp", pageMarked: "page-marked.webp", closeup: "closeup.webp", html: "page.html.gz" };
      const key = `sites/${SITE}/items/${id}/capture/${names[parts[5]]}`;
      const obj = state.objects.get(key);
      if (!obj) return err(res, 404, "not_found");
      if (parts[5] === "html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(gunzipSync(obj.bytes));
      }
      return json(res, 200, { url: `${BASE}/s3obj/${encodeURIComponent(key)}` });
    }
    return err(res, 404, "not_found");
  } catch (e) {
    console.error(e);
    return err(res, 500, "server_error");
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock Annotatie API on ${BASE} (allowing ${ORIGIN})`));
