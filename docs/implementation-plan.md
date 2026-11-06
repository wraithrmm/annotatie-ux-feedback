# Annotatie — implementation plan and proposal (revision 3, 5 Nov 2026)

> **Status: proposal, waiting for your go-ahead.** You asked on 5 Nov 2026 for a full plan, designs and an
> implementation proposal for a new repository. Nothing is built until you approve this plan. It builds on
> `platform-design.md` (revision 2), the approved widget design RW-1, and the new portal design PT-1, and
> changes what this document says it changes in §2. Costs are in `cost-register.md`.
> **6 Nov 2026:** every report now carries a capture (screenshot, close-up, page copy, part record), seen by
> the reporter, the reviewer and agents: `capture-design.md` (2.12, RW-1a, phases P2–P5, questions C1–C5).

## 1. What we're building, in one paragraph

**Users give feedback** on any site through a small widget (RW-1): they pin a comment to the exact part of
the page, and the widget saves a snapshot. **Your AI agents read that feedback** through an MCP server and
write replies, notes and decisions. **Nothing an agent writes reaches a user until you approve it** in the
portal, the one place where you see everything. One **auto-approve flag per site** lets agent replies go
straight to that site's users when you want them to. The whole service deploys from GitHub to one AWS
account **on merge to `main`**, with **no GitHub secrets**. Every piece is on demand, so the idle cost is
cents (`cost-register.md`).

```
 Cloudflare DNS: annotatie.consulteasy.co.uk ── CNAME (DNS only) ──┐
                       ┌──────────────── one AWS account, one OpenTofu root ▼───────────────┐
 User on a host site   │ CloudFront (annotatie.consulteasy.co.uk, free ACM certificate)       │
  widget (RW-1) ───────┼─► /sdk/*  ─────────────► S3 static (SDK bundle)                     │
  host server signs ───┼─► /oauth/*, /.well-known/* ─► API GW (HTTP API) ─► λ auth ─┐        │
  an assertion         │                                                           │        │
 You, in the portal ───┼─► /board/* ───────────► S3 static (portal SPA, PT-1)      ├─► DynamoDB (on demand)
  (PT-1)               │   /api/*   ─────────► API GW ─► λ api ──────────────────────┤   S3 snapshots
 Agents (Claude Code) ─┼─► /mcp     ─────────► API GW ─► λ mcp ──────────────────────┘   SSM (signing key)
                       │   EventBridge Scheduler ─► λ jobs (retention, clean-up)                │
                       └─────────────────────────────────────────────────────────────────────┘
 GitHub Actions ──OIDC (no keys)──► deploy role ──► tofu apply ──► the above
```

## 2. What changes from revision 2

| # | Change | Why |
|---|---|---|
| 2.1 | **Repository host is GitHub** (closes revision 2's open Q6). CI is GitHub Actions; deploy on merge to `main` | Your request |
| 2.2 | **IaC is OpenTofu** (≥ 1.10), with native S3 state locking and no DynamoDB lock table | Your request; no extra fixed cost |
| 2.3 | **The approval gate is enforced by the platform**, not left as a convention (§4). Revision 2 §1 said the platform "never enforces" anything except security. This one rule moves into what it enforces: an agent can't publish to a user unless that site's auto-approve flag is on | Your request: agents never go direct to the end user unless you choose |
| 2.4 | **Auto-approve flag per site**, owner-only, audited, shown on every portal page while it's on (PT-1) | Your request |
| 2.5 | **JWT signing key in SSM Parameter Store**, not KMS. KMS stays as an option behind one variable | Saves the $1/month fixed fee (C-1) |
| 2.6 | **SSE-S3 and AWS-owned encryption keys**, not a customer-managed KMS key | Saves $1/month (C-2) |
| 2.7 | **No email in the first release.** Invites are one-time links you send yourself; SES digests come later | SES needs a domain, a hosted zone and a production-access request (C-13) |
| 2.8 | **Snapshots are rendered in a sandboxed `iframe srcdoc`** (no scripts, opaque origin), not on a second origin | Same isolation with no second distribution (cost register §3) |
| 2.9 | **`annotatie.consulteasy.co.uk` from day one, DNS on Cloudflare (Free), DNS only (grey cloud).** OpenTofu manages the Cloudflare records (the CNAME to CloudFront, ACM validation, and SES DKIM later) with the `cloudflare` provider. The ACM certificate (`us-east-1`) is free | You own the domain and want Cloudflare (5 Nov 2026). $0, and the OAuth issuer and passkeys never have to move. Proxy mode is an option: `cost-register.md` §5 |
| 2.10 | **Team sign-in is passkeys only in v1**, with one-time recovery codes. Passwords + TOTP come later if anyone needs them | Smaller attack surface; no password hashing (no native Argon2 build) in Lambda |
| 2.11 | **Lambda code ships as zips built by CI and referenced by OpenTofu** (`filename` + `source_code_hash`). No artefact bucket, no ECR | No storage line, simpler deploys |
| 2.12 | **Every report carries a capture** (`capture-design.md`, 6 Nov 2026): a screenshot of what the reporter saw, a close-up of the part, a copy of the page's HTML and a part record, all taken when the part is chosen. The reporter sees a preview; it is always sent (C1); reviewers get "Page when reported" in the thread (PT-1); agents get `get_screenshot` (an image) and `get_page_html`. Replaces revision 2's `get_snapshot` | Your request, 6 Nov 2026. Storage only, no fixed cost (`cost-register.md` §4) |

Everything else in revision 2 stands: the three audiences, site assertions (RFC 7523), `node-oidc-provider`,
MCP discovery and dynamic registration, item kinds, the data model, the security table and the SDK install
experience.

## 3. The designs

| Id | What | Files | Status |
|---|---|---|---|
| RW-1 | The widget on a host site: report mode, pins, comment panel, thread, page and "My reports" lists, every error state, phone first | `design/RW-screens.md`, `design/prototype/RW-1-approved-2026-11-03.html` | **Approved** by you, 3 Nov 2026 |
| PT-1 | **The portal** (revision 2's "board") and the auth pages: sign-in, agent consent, Attention (approval queue, decisions, new from users, unanswered), site reports list, thread with a draft (approve / edit / reject, internal notes, snapshot with the pin), decisions, site settings with the **auto-approve** switch and its confirmation, agents and tokens. Phone layout under 860 px: top bar, drawer, bottom tabs, lists as rows | `design/prototype/PT-1-portal.html` (open it in a browser; the black bar at the top switches screens); frozen copy `design/prototype/PT-1-approved-2026-11-06.html` | **Approved 6 Nov 2026**, including the thread's "Page when reported" panel |
| RW-1a | **Amendment to RW-1: the capture.** The preview in the comment panel, "See what will be sent" (Screenshot / Page copy), leaving it out, the failure notes, and "Sent with this report" in the thread. PT-1's thread gains the "Page when reported" panel (Screenshot, Page copy, Part, Details) and the reports list gains close-up thumbnails | `capture-design.md` §4–§5, `design/RW-screens.md` (Amendment A1), `design/prototype/RW-1a-capture.html`, `design/prototype/PT-1-portal.html` | **Approved 6 Nov 2026**; frozen copy `design/prototype/RW-1a-approved-2026-11-06.html` |
| PT-2 | **Portal UX pass, phone first** (6 Nov 2026). Every PT-1 feature re-laid out so a reviewer can approve, edit or reject with one thumb: bottom bar (Attention, Reports, Decisions, More), queue cards with the close-up and the full draft, approve with a 10-second undo, full-screen editor, reject sheet with reasons, a report screen that shows what the user saw before the messages, a sticky action bar, full-screen capture viewer, passkey-only sign-in. Includes M1 (phone notifications) and M2 (server-held undo), both approved 6 Nov 2026 | `design/PT-2-mobile-ux-pass.md`, `design/prototype/PT-2-portal.html` | New, 6 Nov 2026: review owed. Replaces PT-1 for P3 once approved |

PT-1 decisions you may want to change:
- **Approve and send** is the primary action on every draft, and **Edit** sends your edited text. **Reject**
  asks for a reason that the agent can read, so it can try again.
- Drafts are visibly different (dashed edge, "user can't see it yet") from internal notes (grey, "Internal
  note") and sent replies ("User"). The difference is never colour alone.
- Every agent write shows "via Claude Code on WORKSTATION-7" **on the portal only**. Users see your name,
  with no AI marker (D-499 (3)).
- Turning auto-approve **on** needs a confirmation dialog. Turning it **off** is one click. While it's on,
  every page of that site shows a warning banner.

When implementation starts, the widget gets **theme tokens**, so a host site can match its own palette.
RW-1's Race Officials colours become one preset; the default theme is neutral.

## 4. The approval gate (the heart of it)

Each message has **visibility** (`internal` | `user`) and **state** (`draft` | `published` | `rejected`).

| Who writes | Visibility asked for | Result |
|---|---|---|
| A user, through the widget | user | `published` (it's their own message) |
| A person, in the portal | internal | `published` |
| A person, in the portal | user | `published` straight away (a person is the gate) |
| An **agent** (MCP token or personal access token) | internal | `published` (internal notes need no approval) |
| An **agent** | user, site auto-approve **off** | **`draft`**, always. The agent can't override it |
| An **agent** | user, site auto-approve **on** | `published`, recorded as auto-approved |

**Enforced on the server, in one function** (`decideMessageState(site, principal, visibility)`), with
tests for every row:
- The widget API **filters on `visibility = user AND state = published`**. It has no route that can
  return drafts, rejected messages or internal notes.
- **Publishing a draft** (`POST /api/items/{id}/messages/{msgId}/publish`, optionally with an edited
  body) is accepted **only from a portal session** (token audience `api`, client = the portal) of a site
  owner or member. MCP tokens and personal access tokens have **no `publish` scope** and can't be given one.
- **Rejecting** keeps the draft as an internal note with your reason, and the agent reads it with `get_item`.
- **Auto-approve** (`site.autoApprove`) can be set only by an owner, in the portal. Each change is audited
  (who, when, on or off). Optional: it switches itself off after a time limit you set (Q7).
- **Kill switch:** an OpenTofu variable `auto_approve_allowed` (default `true`). Set to `false`, it forces
  every agent reply to be a draft on every site, whatever the site flags say.
- Agents see the state in every tool result (`"state": "draft", "waiting_for": "approval"`), so they
  don't retry or post twice. `get_changes` tells them when a draft was published or rejected.
- The draft's author is the person whose token the agent used. A published reply is signed as them. The
  approver, and any edit, is recorded in the audit.

## 5. The repository

```
annotatie/                         GitHub, one repo, npm workspaces, TypeScript, Node 22 (arm64 Lambda)
  .github/workflows/
    ci.yml                         PRs: lint, typecheck, unit + integration tests, build, tofu fmt/validate/plan
    deploy.yml                     push to main: build → tofu apply → static upload → invalidate → smoke tests
  packages/
    core/                          domain logic: approval gate, permissions, item/message rules (no AWS imports)
    store-dynamo/                  DynamoDB repository + the oidc-provider adapter
    api-client/                    typed client used by portal, MCP, CLI, SDK
    sdk-browser/                   the RW-1 widget (Shadow DOM, zero runtime deps, theme tokens)
    sdk-server-node/               sign site assertions, exchange for a token
    sdk-php/                       PHP core + Laravel package (Phase 6)
  services/
    auth/                          λ: node-oidc-provider, passkeys (SimpleWebAuthn), invites, consent pages
    api/                           λ: HTTP API (sites, items, messages, publish, snapshots, decisions, settings)
    mcp/                           λ: MCP Streamable HTTP, stateless (@modelcontextprotocol/sdk)
    jobs/                          λ: retention, expired drafts report, orphan snapshot clean-up
  apps/
    portal/                        PT-1: Preact + Vite SPA, served at /board
  cli/                             `annotatie`: owner bootstrap, site add, key add/rotate, export, delete-site
  infra/
    bootstrap/                     run ONCE locally (§6.1): state bucket, GitHub OIDC, roles, GitHub env + vars
    live/                          the deployment root CI applies: calls the modules
    modules/                       core, auth, api, mcp, static, jobs, observability, edge (ACM + Cloudflare DNS)
  test/e2e/                        Playwright: fixture host page + portal + MCP, end to end
  docs/                            install guides, threat model, MCP tool reference, runbook
```

## 6. Deployment: GitHub to AWS with no secrets

### 6.1 Bootstrap, once, from your machine

`infra/bootstrap/` is an OpenTofu root you apply once with admin credentials for the target account
(`aws sso login`) and your GitHub CLI login (`GITHUB_TOKEN=$(gh auth token)`, for that run only and never
stored). It creates:

| Resource | Detail |
|---|---|
| S3 state bucket | Versioned, SSE-S3, public access blocked, TLS only, old versions expire after 90 days. The bootstrap's own state moves into it after the first apply (`tofu init -migrate-state`) |
| GitHub OIDC provider | `token.actions.githubusercontent.com` in IAM |
| Role `annotatie-gh-plan` | Trusted only for `repo:<owner>/annotatie:pull_request`. Read-only plus state read/lock, so a PR can plan but never change anything |
| Role `annotatie-gh-deploy` | Trusted only for `repo:<owner>/annotatie:environment:production`. Rights limited to `annotatie-*` resources, under a **permissions boundary** it can't remove, so it can't create admin roles |
| GitHub environment `production` | Deployment branch policy: `main` only |
| GitHub **variables** (not secrets) | `AWS_ACCOUNT_ID`, `AWS_REGION`, `TF_STATE_BUCKET`. None of them is secret |
| Branch protection on `main` | PR required, `ci` checks required |
| AWS Budget | $5/month, alerts to your email (C-16) |
| Deploy role's read access to `/annotatie/cloudflare/api-token` | That parameter only (§6.2) |

**Before bootstrap (one-time, by you):** make sure `consulteasy.co.uk` uses Cloudflare's nameservers, then
create a Cloudflare **API token limited to "Zone → DNS → Edit" on `consulteasy.co.uk` only** and store it
with one command (it never goes into a file, OpenTofu state or GitHub):

```bash
aws ssm put-parameter --name /annotatie/cloudflare/api-token --type SecureString --value "<token>"
```

**GitHub secrets: none.** AWS access is by OIDC, so there are no access keys. The workflows use only
GitHub's built-in `GITHUB_TOKEN`, which GitHub creates for each job.

### 6.2 Secrets that do exist, and where they live

| Secret | Where | Created by |
|---|---|---|
| Token-signing private key (ES256) | SSM SecureString `/annotatie/auth/signing/<kid>` | The auth Lambda on first start, if it's missing (conditional write). **Never in OpenTofu state**, never in CI. Rotated with `annotatie keys rotate` |
| Cookie keys for `oidc-provider` | SSM SecureString | Same: generated in place |
| Cloudflare API token (DNS Edit, `consulteasy.co.uk` only) | SSM SecureString `/annotatie/cloudflare/api-token` | You, once, by CLI (§6.1). The deploy job reads it through its OIDC role and passes it to OpenTofu as `CLOUDFLARE_API_TOKEN` (masked in logs). **Still no GitHub secret** |
| Site private keys | **The host site's own secrets store.** Annotatie keeps only the public key | `annotatie site key add` |
| Recovery codes, personal access tokens | DynamoDB, hashed | The portal |

### 6.3 The workflows

**`ci.yml` — every PR:** `npm ci` → lint → typecheck → unit tests → integration
tests (DynamoDB Local in a service container) → build zips and static assets → `tofu fmt -check` →
`tofu validate` → `tofu plan` with the plan role. The plan summary goes into the job summary. About 3 minutes.

**`deploy.yml` — push to `main`** (one deploy at a time, `concurrency: production`):
1. Build (same as CI) and keep the zips and `dist/` as the job's inputs.
2. Read the Cloudflare token from SSM into the job's environment, then `tofu apply` on `infra/live`
   (AWS resources, the ACM certificate and its Cloudflare records). Lambdas update from the zips. Static files (portal, SDK) upload as
   `aws_s3_object`s with content types and hashed names, so OpenTofu owns them too.
3. `aws cloudfront create-invalidation --paths "/board/index.html" "/sdk/v1/*"`.
4. Smoke tests against the live URL: `/.well-known/oauth-authorization-server` answers, `/mcp` answers
   `401` with `WWW-Authenticate` naming the resource metadata, `/api/health` is `200`, `/board/` loads.
5. If anything fails, the job fails and the alarm emails you. To roll back, revert the commit (another
   deploy). Lambda versions with a `live` alias keep the previous version one switch away.

About 5 minutes per merge, inside the free GitHub minutes (C-17).

### 6.4 The first owner

After the first deploy, `annotatie owner bootstrap --email you@…` (run locally with your AWS credentials)
writes a one-time invite and prints the link. You open it and register a passkey. From then on everything
happens in the portal.

## 7. Delivery in phases

Each phase merges to `main` and deploys. None is done until its acceptance checks pass on the live
deployment.

| Phase | Delivers | Done when |
|---|---|---|
| **P0 Skeleton and pipeline** | Repo, workspaces, bootstrap root, `live` root with `static` + one health Lambda behind CloudFront and API GW, both workflows, budget, alarms | A merge to `main` deploys with no secrets; `/api/health` is 200; **a week's Cost Explorer shows ≈ $0 idle**. This is the cost proof before anything else is built |
| **P1 Auth** | `node-oidc-provider` on Lambda with the DynamoDB adapter, SSM signing keys and JWKS, discovery (RFC 8414, 9728), code + PKCE, dynamic client registration, resource indicators, revocation, passkeys + recovery codes, invites, consent screen (PT-1) | The portal client signs in with a passkey; a test MCP client registers, gets consent and receives a token for audience `mcp`; refresh rotation with reuse detection passes its tests |
| **P2 API, data and the approval gate** | Data model (revision 2 §6 + message `state`, `approvedBy`, `autoApprove`, audit), every API route, `decideMessageState`, publish/reject, snapshots via presigned PUT/GET, rate limits; the capture: presigned POST uploads, confirm and server re-sanitising, the `pending/` lifecycle rule (`capture-design.md` §7); M2: `releaseAt` on messages, a 10-second hold on Approve and send (skipped under auto-approve), Undo within the window, and the widget read filtered by it (`design/PT-2-mobile-ux-pass.md` §6) | Every row of §4 has a passing test; a user token can't read a draft, an internal note or another site's anything (negative tests) |
| **P3 Portal (PT-1)** | Every PT-1 screen against the real API: Attention, reports, thread with draft approve/edit/reject, snapshot in a sandboxed iframe, decisions, settings with auto-approve, agents and tokens; the "Page when reported" panel and list thumbnails (`capture-design.md` §5); built to PT-2 (phone first). M1: web app manifest and service worker, Web Push subscriptions per device (DynamoDB), VAPID key pair in SSM, a push when a draft or decision is created, quiet hours | Playwright runs the approve, edit, reject and auto-approve flows at 390 px and desktop |
| **P4 Widget and server SDK** | `sdk-browser` from RW-1 (capture layer, anchoring, pins, snapshot, threads, theme tokens), `sdk-server-node`, the assertion exchange, a fixture host site for tests; the capture at selection, masking and preview (`capture-design.md` §2–§4) | End to end: a fixture user reports → an agent drafts → you approve in the portal → the user sees the reply on the pin. With auto-approve on, the reply arrives with no approval |
| **P5 MCP server** | Tools from revision 2 §8, plus `state` in every result, `get_changes` for publish/reject events, untrusted-content wrapping; `get_screenshot` (MCP image) and `get_page_html` in place of `get_snapshot` (`capture-design.md` §6) | Claude Code connects with only the URL (discovery → registration → browser consent), lists items, drafts a reply and sees it waiting for approval |
| **P6 First real site** | `sdk-php` Laravel package; installing it on a site you choose | Your chosen site shows the widget to permitted users only, and to no one else (no tag, no request) |
| **Later** | SES invites and digests (DKIM records in Cloudflare), Cloudflare proxy mode, KMS option, passwords + TOTP, privacy mode | When you ask |

If Race Officials is the first real site, P6 is work in the `race-fficials` repo. That repo's own rules apply
(design gates, branch model), and it needs its own approval. It isn't part of this repo's delivery.

## 8. Testing

- **Unit** (Vitest): the approval gate table, permissions, anchoring, snapshot sanitising, assertion checks.
- **Integration**: the API and MCP handlers against DynamoDB Local; the OIDC flows with a real
  `oidc-provider` instance in-process.
- **Security tests that must stay green:** user tokens never see drafts or internal notes; agents never
  publish to users while auto-approve is off; site isolation; origin checks; assertion replay; refresh-token
  reuse; snapshot sanitising (scripts, handlers, `javascript:` URLs); oversize limits.
- **End to end** (Playwright): the fixture host site, portal and MCP against a local stack in CI, and
  against the live deployment as the smoke suite.
- **Infra**: `tofu validate`, plan on every PR, and a check that the plan creates nothing from the
  fixed-cost list (no KMS key, no NAT, no WAF, no Secrets Manager secret) unless a variable allows it.
  That check guards the cost register.

## 9. Questions for you

| # | Question | Recommendation |
|---|---|---|
| Q1 | **Where does the repo live?** A new GitHub repo, named, under which owner, private or public, and cloned to which folder? | `annotatie`, private, under your account, cloned to `C:\Users\Wraith\repos\annotatie`. The plan and designs stay here and get copied into its `docs/` |
| Q2 | **The target AWS account and region.** Is it a fresh account (C-14), and which region? | A dedicated account under your organisation; `eu-west-2` (London) for UK data residency |
| Q3 | ~~Approve PT-1~~ **Answered 6 Nov 2026: approved**, with the capture panel | — |
| Q4 | ~~Domain~~ **Answered 5 Nov 2026:** a subdomain of `consulteasy.co.uk`, DNS on Cloudflare | — |
| Q4a | **Which subdomain?** | `annotatie.consulteasy.co.uk` |
| Q4b | **Is `consulteasy.co.uk` already on Cloudflare's nameservers?** If not, the whole zone has to move (Free plan), and your email records must be copied first | Move it before P0 and check the MX/SPF/DKIM records after the switch |
| Q4c | **Cloudflare DNS only, or proxy in front?** (`cost-register.md` §5) | DNS only now; proxy later only if there's abuse |
| Q5 | ~~Signing key~~ **Answered 6 Nov 2026: SSM now**; KMS when there's a paying client | — |
| Q6 | ~~Team sign-in~~ **Answered 6 Nov 2026: passkeys only in v1** | — |
| Q7 | ~~Auto-approve time limit~~ **Answered 6 Nov 2026: optional per site, default none** | — |
| Q8 | **Go-ahead to implement**, starting with P0 (the cost proof) | Yes, P0 first, then pause to look at a week of real cost before P1 |
| C1–C5 | ~~The capture's questions~~ **Answered 6 Nov 2026:** always sent, no leave-out (C1); real screen capture on desktop (C2); no covering tool (C3); visible part only (C4); every site user sees captures (C5). `capture-design.md` §11 | — |
| M1, M2 | ~~From the phone UX pass~~ **Answered 6 Nov 2026: both yes.** M1 notifications on your phone (installable portal, Web Push, quiet hours, no fixed cost); M2 a 10-second undo on Approve and send, held by the server. `design/PT-2-mobile-ux-pass.md` §6 | — |
