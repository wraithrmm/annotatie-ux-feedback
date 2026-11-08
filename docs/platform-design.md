> **DESIGN ONLY — implementation held back (R-328, 3 Nov 2026; D-500).** The product is built in its own
> repository, not in this workspace and not in any World Sailing repo. Nothing here is built, provisioned
> or installed until Richard approves implementation in his own words.

# Annotatie — technical design (concept, revision 2, 3 Nov 2026)

> **6 Nov 2026:** the snapshot is now a **capture** (screenshot, close-up, page copy, part record), designed in
> `capture-design.md`, which replaces the Snapshot row in §6, `get_snapshot` in §8 and §9.2 where they differ.

**Annotatie** — "annotate, but cute" (R-329). Revision 2 applies Richard's answers (R-329 → D-512): a
totally separate deployment, joined to sites only by the JS SDK; AWS; **Annotatie's own OAuth 2.1
server** for sites, the board and agents alike; no mail to client users for now; repository host to be
confirmed.
The approved interaction design is RW-1 (`design/RW-screens.md`, `design/prototype/RW-1-approved-2026-11-03.html`).
This document turns it into a standalone product: one SDK any site can install, one on-demand back end
deployed with Terraform, one message board for us, and one MCP server for agents.

## 1. What it is, and what it is not

**It is a messaging system with pins.** People on a client's site report bugs and requests against the
exact part of the page they saw. We and our agents read them, talk among ourselves, raise decisions for
the stakeholder, and post answers back to the client. Each site is its own section.

**It facilitates; it never enforces (R-328).** The platform stores, shows, routes and notifies. It does
not decide who approves what, does not run agents, does not assign work and does not impose a workflow.
Every such behaviour is a *convention* the people and agents using it follow. The only things it
enforces are security: who someone is, what they may see, and what they may write.

**Out of scope:** running or scheduling agents; issue-tracker features (sprints, estimates);
Git integration; analytics on the host site; anything inside the host site beyond the SDK.

## 2. The three audiences and what each one sees

| Audience | Where | Sees | Signs in by |
|---|---|---|---|
| **Client users** (people on the host site holding its report permission) | The widget on the host site (RW-1) | Pins and threads on their site; only **client-visible** messages | The host site's own sign-in, which the host's server exchanges for an Annotatie access token (§5.3) |
| **Our team** (Richard, other developers) | The board (§7) | Every site they belong to; client-visible and **internal** messages; decisions; activity | Annotatie's own sign-in — passkey, or password plus TOTP (§5.2, §5.4) |
| **Agents** (Claude Code sessions) | The MCP server (§8) | What their token's owner sees, narrowed to the token's sites and scopes | OAuth in Claude Code's browser hand-off, as their owner (§5.5) |

**Agents act as the person who owns the token.** A reply an agent posts is authored by that person and
signed as them; the client never sees "Claude" or any agent marker (D-499 (3)). The platform records,
internally only, which token made each write (audit, §9.5), shown on the board as a small "via token"
detail and never in anything a client can read.

## 3. The shape of the system

```
 Host site (any stack)                         Platform (one Terraform deployment, AWS)
 ┌───────────────────────────┐                 ┌──────────────────────────────────────────────┐
 │ server SDK: decides who   │  assertion →    │ CloudFront ─┬─ /sdk/*      S3 (SDK bundle)    │
 │ may report; signs an      │  /oauth/token   │             ├─ /board/*    S3 (board SPA)     │
 │ assertion, gets a token   │ ───────────────►│             ├─ /oauth/*, /.well-known/*  ─┐   │
 │ browser SDK (RW-1 widget) │  HTTPS + access │             └─ /api/*, /mcp ─► API GW ─┐  │   │
 │ loaded only for permitted │  token          │                                        ▼  ▼   │
 │ users                     │ ───────────────►│   Lambda: auth · api · mcp ──► DynamoDB      │
 └───────────────────────────┘                 │   (KMS signs tokens)        ──► S3 snapshots  │
                                                │   snapshot viewer origin (sandboxed)          │
 Board users ──► /board → /oauth/authorize      │   SES (team mail) · EventBridge Scheduler     │
 Agents ──► /mcp (OAuth access token)           │                                               │
                                                └──────────────────────────────────────────────┘
```

The deployment is **totally separate** from every site it serves (D-512 Q1): its own AWS account (or
at least its own Terraform root and state), its own domain, its own data. A site touches it only
through the SDK.

**On demand only (R-328).** Everything scales to zero: Lambda, API Gateway HTTP API, DynamoDB on-demand,
S3, CloudFront. Idle cost is the KMS key and a few cents of storage — a low single-figure
dollars a month per deployment. No servers, containers, databases or NAT gateways run idle. The functions
need no VPC (DynamoDB and S3 are reached through IAM), which avoids NAT cost.

**Why DynamoDB rather than Aurora.** Aurora Serverless v2 can pause, but resuming takes seconds, and that
is too slow for the first request of the day. Access is by key — site, item, thread — which suits one
table with two secondary indexes (§6). Search across bodies is not needed at this traffic; the board
filters in memory per site.

## 4. Repository and packages (own repo, R-328)

```
annotatie/                                   one repository, one version line
  packages/
    sdk-browser/        TypeScript: the RW-1 widget, capture layer, anchoring, snapshot, pins (npm)
    sdk-server-node/    Node: sign site tokens, verify webhooks (npm)
    sdk-php/            PHP core + Laravel package: token signing, Blade directive, gate hook (Composer)
    api-client/         shared typed client for the HTTP API (used by board, MCP, CLIs)
  services/
    auth/               Lambda: Annotatie's OAuth 2.1 authorization server and sign-in pages (§5)
    api/                Lambda: HTTP API (sites, items, messages, snapshots, decisions)
    mcp/                Lambda: MCP server, Streamable HTTP transport
    jobs/               Lambda: digests, retention, snapshot clean-up
  apps/
    board/              the message board SPA (static)
    snapshot-viewer/    the sandboxed snapshot renderer, served from its own origin
  infra/
    modules/            Terraform modules: core, api, auth, board, mcp, mail, observability
    deployments/example/ a root module showing one deployment
  cli/                  `annotatie` CLI: site add, key rotate, token create, export, delete-site
  docs/                 install guides per stack, threat model, MCP tool reference
```

The browser SDK has **no runtime dependencies** and is shipped two ways: as a script served by the
platform (`/sdk/v1/annotatie.js`), and as an npm package for hosts that bundle. Hosts that care about
detection (§4.1) use the served script.

### 4.1 Detachable and undetectable on the host site

| Requirement (R-319) | How the SDK meets it |
|---|---|
| Nothing reaches a browser without the permission | The **server** SDK decides. The Laravel package's `@annotatie` directive and the Node `annotatieTag(user)` helper emit the script tag only when the host's own gate passes. The bundle is never in the host's build, so the host's asset manifest does not name it. |
| No trace in the page | Without the permission there is no markup, no script, no global, no cookie and no network call. With it, the widget lives in a closed Shadow DOM root, so host CSS and scripts cannot see into it. |
| Host's own permission model | The host keeps its permission (for Race Officials, a feature row in its permission model). The platform never knows the host's roles; it trusts the host's signed assertion. |
| Detach | Remove the package and the one directive. The platform keeps the site's data until the site is deleted (`annotatie site delete`, §9.4). |
| CSP | The host adds the platform origin to `script-src` and `connect-src`. The install guide gives the exact lines. |

## 5. Authentication and identity: Annotatie's own OAuth 2.1 server (D-512 Q3)

**Yes — we do not need AWS's.** Annotatie runs its own authorization server, and every caller — a
site's widget, a person on the board, an agent through the MCP — gets an Annotatie access token from
it. One issuer, one token format, one set of scopes, one place to revoke.

### 5.1 What the server is

- **Built on a certified library, not written from scratch:** `node-oidc-provider` (OpenID Certified,
  supports everything below), with a DynamoDB adapter, running in the `auth` Lambda. Writing the
  protocol by hand is where security bugs come from; we write configuration, the sign-in pages and the
  adapter.
- **Standards it implements:**

  | Standard | Used for |
  |---|---|
  | OAuth 2.1: authorization code + PKCE only (no implicit, no password grant) | The board and agents |
  | RFC 8414 authorization server metadata, RFC 9728 protected resource metadata | Discovery — what the MCP spec requires, so Claude Code finds the server by itself |
  | RFC 7591 dynamic client registration | Agents' MCP clients register themselves (open registration is limited: a registered client can do nothing until a person signs in and consents) |
  | RFC 7523 JWT-bearer grant | Sites swap their signed assertion for an access token (§5.3) |
  | RFC 8707 resource indicators | A token is minted for one audience: `api` or `mcp` |
  | RFC 7009 revocation, RFC 7662 introspection | Revoke at once; the API checks revocation for long-lived refresh tokens |

- **Tokens:** access tokens are JWTs signed by an **AWS KMS asymmetric key (ES256)** — the private key
  never leaves KMS, and rotation is a new key id published in the JWKS. Access tokens live **5 minutes**
  for the widget and **15 minutes** for the board and agents. Refresh tokens (board and agents only) are
  rotated on every use, with reuse detection that revokes the whole family.
- **On demand:** it is a Lambda like the rest; signing a token is one KMS call.

### 5.2 Our team: accounts on Annotatie

Invite-only. An owner invites by email (SES, the one use of mail — team mail is not client mail, so
D-512 Q4 does not stop it); the invitee sets up a **passkey** (WebAuthn, preferred) or a password plus
**TOTP**. Sign-up is off. Sessions are cookies on the auth origin only (`HttpOnly`, `Secure`,
`SameSite=Lax`), and the board itself holds only short access tokens. Membership is per site:
**owner** (manages keys, members, retention), **member** (reads and writes everything on the site),
**viewer** (reads). These are security scopes, not workflow roles (§1).

### 5.3 Client users: the host vouches for them (enforced username and secure auth)

The host's server is the only thing that knows who the user is and whether they may report.

- **Site keys.** Registering a site gives it an **Ed25519 key pair** with an id (`kid`). Annotatie keeps
  the public key; the host keeps the private key in its secrets store, never in a repository file. A new
  key can be added and the old one retired without downtime.
- **The assertion** the host's server signs is a JWS (EdDSA), valid **60 seconds**, with `iss` = site
  id, `sub` = the host's stable user id, `name` = display name (**required**), `email` (optional),
  `aud` = Annotatie's token endpoint, `iat`, `exp`, `jti`. The server SDKs refuse to sign without `sub`
  and `name` — this is the "enforces username" part of R-328.
- **The exchange (RFC 7523).** The host's server posts the assertion to `/oauth/token` and receives a
  5-minute access token for that user, audience `api`, scope `report`. The browser SDK gets it from the
  host's endpoint (`/annotatie/token`, behind the host's own session) and calls it again within 60 s of
  expiry. The host re-checks its permission every time, so removing someone's permission takes effect
  within 5 minutes. The browser never sees the site key, and never receives a refresh token.
- **Origins.** Each site lists its allowed origins; the API answers CORS only for them, and a widget
  token is honoured only from its site's origins.
- **Replay.** Assertion `jti`s are remembered until they expire (a DynamoDB TTL item).
- **What Annotatie stores about a client user:** `sub`, display name and email as last asserted. Never a
  password or session.

### 5.4 The board

The board is an OAuth public client (authorization code + PKCE) of the same server. Signing in sends the
person to `/oauth/authorize`, which shows Annotatie's own sign-in page (passkey or password + TOTP).

### 5.5 Agents (MCP)

- **Interactive set-up, once.** Claude Code is pointed at `https://<domain>/mcp`. The MCP endpoint
  answers `401` with its protected-resource metadata; Claude Code discovers the authorization server,
  registers itself (RFC 7591), and opens the browser. The person signs in and sees a **consent screen**:
  which sites and which scopes this agent client gets. Claude Code stores the tokens in its own
  credential store — never in a project file.
- **Scopes:** `read`, `reply`, `reply:client` (may post client-visible messages), `status`, `decide`
  (may raise decisions), `snapshot:read`. The consent screen lets the person untick any of them and pick
  the sites. Refresh tokens expire after 90 days without use.
- **The agent acts as the person who consented.** Its replies are authored and signed as that person
  (D-499 (3)). The consented client's name ("Claude Code on Richard's PC") is recorded in the internal
  audit only (§9.5).
- **Unattended agents** (no browser to hand off to) use a **personal access token** the person creates
  on the board, with the same scopes, sites and expiry, stored hashed. The MCP accepts either.
- **Managing access:** the board lists every connected agent client and token, when each was last used,
  and revokes any of them at once.

## 6. Data model

One DynamoDB table (`pk`, `sk`) plus two global secondary indexes; snapshot bodies in S3.

| Entity | Key | Holds |
|---|---|---|
| Site | `SITE#<id>` / `META` | name, origins, assertion public keys (`kid` → key, status), retention, privacy mode, client-reply default (§7.3), created |
| User (team) | `USER#<id>` / `META` | email, name, passkeys (credential ids, public keys), password hash (Argon2id) and TOTP secret (KMS-encrypted) if used, status |
| Member | `SITE#<id>` / `MEMBER#<userId>` | role (owner/member/viewer) |
| Item | `SITE#<id>` / `ITEM#<itemId>` | **kind** (report, conversation, decision), number per site, title, status, page (URL path, route name), anchors, bounding box, reporter, visibility, labels, counts, updated |
| Message | `ITEM#<itemId>` / `MSG#<ts>#<msgId>` | author (user id), body (Markdown, sanitised on render), **visibility** (client / internal), state (published / draft), via client or token id (internal), edited |
| Decision | on the Item | question, options (label, text, consequence), recommendation, answer, answered by, answered at |
| Snapshot | `ITEM#<itemId>` / `SNAP#<id>` | S3 key, size, viewport, scroll, build id, captured at |
| Capture (6 Nov 2026) | on the Item | the part record and context; S3 keys of the screenshot, marked screenshot, close-up and page copy (`capture-design.md` §1, §7) |
| OAuth records | `OIDC#<kind>#<id>` | the authorization server's own records (clients, grants, sessions, authorization codes, refresh tokens), through the `node-oidc-provider` DynamoDB adapter, with TTLs |
| Personal access token | `PAT#<hash>` / `META` | owner, name, sites, scopes, expiry, last used |
| Audit | `SITE#<id>` / `AUDIT#<ts>` | who, via which token, what, item — internal only |
| Replay guard | `JTI#<jti>` | TTL = assertion `exp` |

GSI1 is **site + status + updated** (board columns, MCP "open items"). GSI2 is **site + page + status**
(the widget's pins for the current page).

**Item kinds** (the board's vocabulary; none of them carries a workflow):
- **Report** — created by a client through the widget (RW-1), always has a page and usually a snapshot.
- **Conversation** — an internal thread among us and our agents, optionally linked to reports.
- **Decision** — a question for the stakeholder with options and a recommendation, and an answer field.
  Can be internal (for Richard) or client-visible (for the client to choose).

**Statuses** are a small, fixed set shared by every kind — Open, Answered, In progress, Waiting on us,
Waiting on client, Resolved, Closed — matching RW-1's tones. Resolved is the team saying it's fixed or
answered (an agent's reply marks it so when published, `resolves: true`); Closed is the person who reported it
agreeing, from the widget (the team can close too). A reply from the user on either opens it again. Labels are
free text per site for anything else.

## 7. The board (for us)

A static single-page app at `/board`. It surfaces things for attention, and does nothing on its own.

### 7.1 Layout

- **Sites** in the side navigation, one section each (R-328), each with its count of things needing
  attention.
- **Attention** — the home view across all sites: decisions awaiting an answer, drafts awaiting
  publishing, client messages since you last looked, reports nobody has answered.
- Per site: **Reports** (list, and on wide screens the page with its pins — the RW-1 thread panel
  reused), **Conversations**, **Decisions**, **Activity** (a time-ordered feed).
- Item view: the thread with client-visible and internal messages told apart by more than colour, the
  snapshot (§9.2) with the pin drawn, linked items, and the audit detail.

### 7.2 Decisions

A decision shows its question, options with consequences, and the recommendation, on one page — the same
shape as Richard's P-nn practice. Answering records who answered and when. What an agent does with the
answer is outside the platform.

### 7.3 Drafts: the approval convention

Any message can be posted as a **draft**. A draft is internal until someone with the right permission
publishes it, at which point it goes to the client as written, signed by its author. Each site has a
setting for whether client-visible messages from tokens start as drafts (**default: yes**). This lets
Claude write answers that Richard approves before the client sees them, without the platform deciding
anything — a person can always post directly.

### 7.4 Notifications

Email to **our team only**, through SES, opt-in per person and site: a daily digest at a chosen hour, and
immediate mail for decisions addressed to you. **No mail to client users for now (D-512 Q4)** — they see
replies on their next visit, through the pin and the "Answered" tone (RW-1).

## 8. The MCP server

A Lambda behind `/mcp`, using the MCP Streamable HTTP transport, stateless (each call carries the token).
Every tool checks the token's sites and scopes.

| Tool | Does | Scope |
|---|---|---|
| `list_sites` | Sites the token can see, with counts by status | read |
| `list_items` | Filter by site, kind, status, page, label, `updated_since`; paginated | read |
| `get_item` | The item, its messages (internal and client), its decision, its links, snapshot metadata | read |
| `get_snapshot` | The sanitised snapshot HTML (size-capped) with the selected element marked, plus its anchors and box | snapshot:read |
| `get_screenshot`, `get_page_html` (6 Nov 2026) | Replace `get_snapshot`: the screenshot or close-up as an MCP image, and the page copy scoped to the part, its surroundings or the page (`capture-design.md` §6) | snapshot:read |
| `get_changes` | Everything changed since a cursor, so an agent can poll without missing anything | read |
| `post_message` | Reply on an item: `visibility` internal or client, `draft` true/false (the site's default applies) | reply / reply:client |
| `set_status` | Change an item's status | status |
| `create_item` | Raise a conversation or a decision (question, options, recommendation) | decide |
| `create_site`, `add_site_origin`, `add_site_key`, `get_install_kit` (7 Nov 2026) | Put the widget on a site from its repository (plugin skill `install-sdk`): create a site the person owns (it joins the agent's grant), allow an origin, register a **public** site key (owner only; private keys refused), and read the tag, token-route contract and Node SDK URL (`/sdk/v1/annotatie-node.mjs`) | sites (ticked on consent by default) |
| `link_items` | Link items (a decision to the reports it affects) | reply |

**Untrusted content.** Every tool result that contains words written by a client or a snapshot wraps
them in a marked block and the tool descriptions say that text is data, not instructions. That is how
the platform supports the agents' own rule (as `ro-snapshot-comments` already does) without enforcing it.

## 9. Security

### 9.1 Threats and answers

| Threat | Answer |
|---|---|
| Forged identity from a browser | A widget token is only issued against an assertion signed by the host's private key, which never reaches a browser; origins checked; 5-minute token; 60-second assertion; replay guard |
| Attacks on the authorization server itself | A certified library, not our own protocol code; code + PKCE only; exact redirect-URI matching; signing key held in KMS; refresh-token rotation with reuse detection; rate limits and lock-out on sign-in; passkeys preferred; the sign-in pages on their own origin with a strict CSP |
| A dynamically registered client abusing registration | Registration grants nothing; every grant needs a signed-in person's consent naming sites and scopes; unused clients expire after 30 days; registration is rate-limited |
| A leaked site private key | Rotate with `kid` in minutes; the old key is refused at once; audit shows what it signed |
| Stored XSS through a snapshot (it is a copy of a page and can contain anything) | Snapshots are never rendered on the board's origin. The viewer is a separate origin and renders into a `sandbox` iframe with no `allow-scripts`, and a CSP of `default-src 'none'`; styles are inlined at capture; scripts, event-handler attributes and `javascript:` URLs are stripped at capture **and** again on the server |
| XSS through messages | Markdown rendered with a strict allow-list sanitiser; no raw HTML |
| A client reading internal messages | Visibility is checked on the server for every read; the widget API has no route that returns internal messages or drafts |
| One site's users reading another site | Every key and query is scoped by site id taken from the verified token, never from the request body |
| A stolen agent token | Access tokens live 15 minutes; refresh tokens rotate and are revoked as a family on reuse; personal access tokens are hashed at rest; all are scoped to sites and actions, revocable on the board, and every use is in the audit log |
| Abuse or floods | API Gateway throttling per route; per-site and per-user limits in the API; snapshot size cap 2 MB; message size cap (5,000 characters, RW-1) |
| Passwords and secrets in snapshots | Password inputs and fields marked `data-annotatie-mask` are blanked at capture; a site can turn on **privacy mode**, masking all text in form fields |

### 9.2 Snapshots

> Superseded where it differs by `capture-design.md` §7–§8 (6 Nov 2026): presigned **POST** with a size range, SSE-S3 rather than KMS, the screenshot masked like the copy.

Captured in the browser (RW-1 §5), gzipped, uploaded straight to S3 with a presigned PUT limited to
2 MB and the right content type, encrypted with the deployment's KMS key, in a bucket with public access
blocked. Viewing is by short-lived presigned GET, issued only after a visibility check.

### 9.3 Personal data

The platform holds client users' names and emails, their messages, and snapshots that may contain the
host site's personal data. It is therefore a processor for each host. Each site has a retention setting
(default: snapshots deleted 90 days after the item is resolved; items kept until the site is deleted).
Export and deletion per site are CLI commands. Annotatie is a totally separate deployment (D-512 Q1), so a
site's data is held by Annotatie, not inside the site's own estate.

### 9.4 Detaching a site

`annotatie site delete` removes the site's keys at once (the widget stops working), then deletes its items,
messages, snapshots and audit after an export, in a recorded job.

### 9.5 Audit

Every write records who did it, through which agent client or token if any, and when. It is visible to the site's owners
on the board, never to clients.

## 10. Terraform

- **One deployment = one root module** calling `infra/modules/*`, for example `deployments/ours/`. Inputs:
  a domain name, the ACM certificate, the hosted zone, the SES sender, the team's email addresses for
  the first invite, and tags. Outputs: the SDK URL, the API URL, the MCP URL and the board URL.
- **Modules:** `core` (DynamoDB, KMS, snapshot bucket), `api`, `mcp`, `auth` (the OAuth server Lambda, its KMS signing key, the sign-in origin), `board`
  (bucket, CloudFront, viewer origin), `mail` (SES), `jobs` (EventBridge Scheduler), `observability`
  (log groups with retention, alarms on 5xx and throttles to the team's email).
- **Sites are data, not infrastructure:** registering a site does not need a `terraform apply`. It uses
  `annotatie site add` or the board.
- State in an S3 backend with locking. Lambda code is built by CI and referenced by version.
- **One deployment, ours, separate from every site (D-512 Q1)**, serving any number of sites. The same
  modules could stand up a second deployment, but none is planned.

## 11. Installing on a site (the SDK experience)

**Laravel (Race Officials, for example):**
1. `composer require annotatie/laravel`, then add `ANNOTATIE_SITE_ID`, `ANNOTATIE_KEY_ID` and `ANNOTATIE_PRIVATE_KEY`
   to the environment (secrets store).
2. Bind the gate: `Annotatie::allowWhen(fn ($user) => $user->can('report'))`.
3. Put `@annotatie` in the layout.
The package registers `/annotatie/token` behind the host's own auth and emits the script only when the gate
passes.

**Node / any other stack:** use `sdk-server-node` (or any JWS and OAuth library, by following the documented
assertion format) to sign the assertion and exchange it for a token at an authenticated endpoint, and output
`<script src="…/sdk/v1/annotatie.js" data-site="…" data-token-url="/annotatie/token">` for permitted users only.

**SPAs with their own bundle:** `import { start } from '@annotatie/sdk'` behind the app's own permission
check; this trades the "no trace in the bundle" property for convenience.

## 12. How Race Officials would use it (when approved)

Race Officials would be the first site. This replaces D-499 (5)'s storage in Aurora through the API: no
Race Officials tables, routes or migrations are needed, and the app's work is only the Laravel package,
its gate and the directive. Staging snapshots, which can contain World Sailing personal data, are held in
Annotatie's own deployment (D-512 Q1).

## 13. Answers (R-329 → D-512) and what is still open

| # | Question | Answer |
|---|---|---|
| Q1 | Where a site's data lives | A totally separate Annotatie deployment, joined to sites only by the JS SDK |
| Q2 | Cloud | AWS |
| Q3 | Agent and site auth | Annotatie's own OAuth 2.1 server, for sites, the board and agents alike (§5) |
| Q4 | Mail to client users | Not for now |
| Q5 | Name | Annotatie |
| Q6 | Repository host | **Open — to be confirmed** (GitLab or GitHub; sets CI and package publishing) |

## 14. What implementation would involve (held back)

In order, once approved and once the repository exists: the core module, the OAuth server and the API → the
browser SDK built from RW-1 → the Laravel package → the board → the MCP server → mail and jobs →
Race Officials install on staging. Each step ships with its tests. The estimate goes in a separate quote
when asked for; none is given here.
