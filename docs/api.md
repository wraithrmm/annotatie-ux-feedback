# Annotatie HTTP API (the contract)

All shapes are in `packages/core/src/types.ts`. Base URL `https://annotatie.consulteasy.co.uk`
(`BASE` below). JSON in and out; errors are `{ "error": "<code>", "message": "<words>" }` with a 4xx/5xx.

## 1. Tokens

| Caller | How it gets a token | Token |
|---|---|---|
| **Portal** (`/board/`) | OAuth 2.1 code + PKCE. `client_id=annotatie-portal`, `redirect_uri=BASE/board/` (the app reads `?code=` on load; portal routes are hash routes, `/board/#/…`), `scope=openid offline_access`, `resource=BASE/api`, `prompt=consent` is never needed (first-party). Token endpoint `BASE/oauth/token`. Refresh tokens rotate on every use; keep the latest only | JWT, `aud=BASE/api`, `client_id=annotatie-portal`, 15 min |
| **Widget** (host site) | The host's **server** signs an assertion (EdDSA, 60 s) and posts `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=…` to `BASE/oauth/token`. The browser gets the result from the host's own `/annotatie/token` endpoint | JWT, `aud=BASE/api`, `client_id=site:<siteId>`, `scope=report`, `site`, `name`, 5 min. No refresh token |
| **Agents** | MCP discovery → dynamic registration → code + PKCE with `resource=BASE/mcp`; or a personal access token `ann_pat_…` made in the portal | JWT `aud=BASE/mcp` (15 min, refresh 90 days), or the opaque PAT. **Never accepted by `/api/*`** |

Discovery: `BASE/.well-known/oauth-authorization-server`, `BASE/.well-known/openid-configuration`,
`BASE/.well-known/oauth-protected-resource/mcp`, JWKS `BASE/oauth/jwks`.

**Assertion** (the host signs it; `packages/sdk-server-node` does this): header `{ alg: "EdDSA", kid }`, claims
`iss=<siteId>`, `sub=<host user id>`, `name` (required), `email` (optional), `aud=BASE/oauth/token`, `iat`,
`exp` (≤ iat + 60), `jti` (single use).

## 2. Portal routes (`Authorization: Bearer <portal token>`)

| Method and path | Body → result | Who |
|---|---|---|
| `GET /api/me` | → `{ user: Person, sites: Site[] (with role, counts), preferences: Preferences }` | any |
| `PUT /api/me/preferences` | `Preferences` → `Preferences` | any |
| `GET /api/attention` | → `Attention` (across every site the user belongs to) | any |
| `POST /api/sites` | `{ name, origins: string[] }` → `Site` (caller becomes owner) | any |
| `GET /api/sites/{s}` | → `Site` | viewer+ |
| `PATCH /api/sites/{s}` | `{ name?, origins?, retentionDays?, privacyMode? }` → `Site` | owner |
| `PUT /api/sites/{s}/auto-approve` | `{ on: boolean, until?: string \| null }` → `Site`. Audited. Refused with `409 auto_approve_disabled` when the platform kill switch is off | owner |
| `GET /api/sites/{s}/keys` | → `{ keys: SiteKey[] }` | owner |
| `POST /api/sites/{s}/keys` | `{ kid?, publicKeyJwk }` → `SiteKey` | owner |
| `DELETE /api/sites/{s}/keys/{kid}` | → `SiteKey` (retired; refused at once) | owner |
| `GET /api/sites/{s}/members` | → `{ members: Member[], invites: [{ id, email, role, expiresAt }] }` | viewer+ |
| `POST /api/sites/{s}/invites` | `{ email, role }` → `{ id, url, expiresAt }` (one-time link, 7 days; you send it yourself) | owner |
| `PATCH /api/sites/{s}/members/{userId}` | `{ role }` → `Member` | owner |
| `DELETE /api/sites/{s}/members/{userId}` | → 204 | owner |
| `GET /api/sites/{s}/items?kind=&status=&q=` | → `{ items: Item[] }` newest first | viewer+ |
| `POST /api/sites/{s}/items` | `{ kind: "conversation" \| "decision", title, body?, decision?: { question, context?, options, recommendation?, blocking } }` → `Item` | member+ |
| `GET /api/sites/{s}/items/{i}` | → `{ item: Item, messages: Message[] (every visibility and state, oldest first), log: LogEvent[] }` | viewer+ |
| `PATCH /api/sites/{s}/items/{i}` | `{ status?, title?, labels? }` → `Item` | member+ |
| `POST /api/sites/{s}/items/{i}/messages` | `{ body, visibility }` → `Message` (a person's message is published at once) | member+ |
| `POST /api/sites/{s}/items/{i}/messages/{m}/approve` | `{ body? }` (edited text) → `Message` with `state=published`, `releaseAt = now + 10 s` (M2) | member+ |
| `POST /api/sites/{s}/items/{i}/messages/{m}/undo` | → `Message` back to `draft`; `409 too_late` after `releaseAt` | member+ |
| `POST /api/sites/{s}/items/{i}/messages/{m}/reject` | `{ reason }` → `Message` with `state=rejected` (kept as an internal note the agent reads) | member+ |
| `POST /api/sites/{s}/items/{i}/answer` | `{ option?, text? }` (one is required; `text` required when there are no options) → `Item` | member+ |
| `GET /api/sites/{s}/items/{i}/capture/{file}` | `file` = `page`, `pageMarked`, `closeup` → `{ url }` (presigned GET, 5 min); `html` → the page copy as `text/html` (rendered by the portal only in `<iframe sandbox srcdoc>`) | viewer+ |
| `GET /api/sites/{s}/log?before=` | → `{ events: LogEvent[] }` newest first | owner |
| `GET /api/tokens` | → `{ tokens: PersonalAccessToken[] }` | any |
| `POST /api/tokens` | `{ name, sites, scopes, expiresInDays (1-365) }` → `{ token: "ann_pat_…" (shown once), pat: PersonalAccessToken }` | any (sites must be the caller's, member+) |
| `DELETE /api/tokens/{id}` | → 204 | owner of the token |
| `GET /api/agents` | → `{ agents: AgentGrant[] }` (OAuth-connected agent clients) | any |
| `DELETE /api/agents/{grantId}` | → 204 (revokes every token of that grant) | any (own) |
| `GET /api/me/passkeys` | → `{ passkeys: Passkey[] }` | any |
| `POST /api/me/passkeys/options` | → WebAuthn creation options (JSON) | any |
| `POST /api/me/passkeys` | `{ name, response }` (the `RegistrationResponseJSON`) → `Passkey` | any |
| `DELETE /api/me/passkeys/{id}` | → 204 (refused for the last one) | any |
| `GET /api/push/key` | → `{ publicKey }` (VAPID, for `pushManager.subscribe`) | any |
| `POST /api/push/subscriptions` | `{ endpoint, keys: { p256dh, auth }, device }` → 204 | any |
| `DELETE /api/push/subscriptions` | `{ endpoint }` → 204 | any |

**The approval gate** (implementation-plan.md §4) is `decideMessageState` in `packages/core`. Nothing in
the portal decides a message's state: it reads `state`, `releaseAt`, `autoApproved` from the server.

## 3. Widget routes (`Authorization: Bearer <widget token>`, from an allowed origin)

CORS: answered only for the site's `origins`. A widget token is refused from any other origin.
The widget API **never** returns internal messages, drafts, rejected messages, `via`, or a message before
its `releaseAt`.

| Method and path | Body → result |
|---|---|
| `GET /api/w/me` | → `{ user: { id, name }, site: { id, name, privacyMode } }` |
| `GET /api/w/items?path=/some/page` | → `{ items: Item[] }` the site's reports on that page (pins) |
| `GET /api/w/items?mine=1` | → `{ items: Item[] }` the caller's reports, every page |
| `POST /api/w/items` | `{ title?, body, page: PageRef, anchor?, capture: { context, part?, files: { page?: { size }, pageMarked?: { size }, closeup?: { size }, html?: { size } } } }` → `{ item: Item, uploads: { [file]: { url, fields } } }` (S3 presigned POST policies, 10 min; send `fields` + `file` as multipart form data; `html` is gzipped HTML, `Content-Type: text/html`, `Content-Encoding: gzip`) |
| `POST /api/w/items/{i}/capture` | `{ files: { [file]: { size, sha256 } } }` → `Item` (with `capture.confirmed = true`) |
| `GET /api/w/items/{i}` | → `{ item: Item, messages: Message[] }` (user-visible, published, released only) |
| `POST /api/w/items/{i}/messages` | `{ body }` (≤ 5,000 characters) → `Message` |
| `GET /api/w/items/{i}/capture/{file}` | as the portal route (C5: every site user sees captures) |

Item fields a widget never receives: `log`, `via`, `decision` of internal items, `counts.drafts`.
Only `kind = report` items are returned to the widget.

## 4. Limits

Message body 5,000 characters; title 200; page copy 2 MB gzipped; screenshots 1.5 MB each; close-up
300 KB; 50 reports per user per day; API Gateway throttles at 20 req/s, burst 50.
