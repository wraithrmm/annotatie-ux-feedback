# Annotatie — cost register (5 Nov 2026)

Your rule: close to zero cost at rest, and on demand wherever possible. **Any cost that can't be on
demand has to be found before we build.** This is that list. Prices are AWS list prices in USD as of
Nov 2026, from the AWS pricing pages and AWS's own examples. Check them in the AWS Pricing Calculator
for the target region before bootstrap: the target account's free-tier plan changes some lines (see C-14).

## 1. Idle cost under the recommended design

| Running with the recommendations below | Idle cost per month |
|---|---|
| `annotatie.consulteasy.co.uk` (domain you already own, DNS on Cloudflare Free), signing key in SSM, no WAF, no SES | **≈ $0.00–$0.05** (state and data storage only) |
| + signing key held in KMS instead of SSM | + $1.00 / month |

**Update 5 Nov 2026:** you own `consulteasy.co.uk` and want Cloudflare for DNS. That removes C-3, C-4 and
C-5: no Route 53 zone, no new registration, and no domain move later. Cloudflare's place and limits are in §5.
| Busy month (10k reports, 100k API calls, 50k MCP calls, 1 GB snapshots) | ≈ $0.30–$0.60 on top, nearly all of it inside the always-free allowances |

**Nothing runs while idle.** There are no servers, containers, NAT gateways, databases with an
hourly rate, load balancers, provisioned concurrency or VPC endpoints.

## 2. Every cost that is NOT purely on demand

Fixed means it's charged whether or not anyone uses the system. Each one has a decision and a pivot.

| # | Item | Fixed cost | Needed? | Recommendation | Pivot if too high |
|---|---|---|---|---|---|
| C-1 | **KMS customer-managed key** for JWT signing (revision 2 §5.1) | **$1.00 / month per key** + $0.15 per 10k signatures | No | **Pivot taken:** an ES256 private key in **SSM Parameter Store SecureString** (standard tier: free, encrypted with the AWS-managed `aws/ssm` key, no monthly fee). Generated in CI, written only if absent, never in OpenTofu state. Keys rotate by publishing a new `kid` in the JWKS | Switch on `signing_backend = "kms"` (one variable) if you want the key never to leave an HSM: +$1/month |
| C-2 | **KMS key for S3 / DynamoDB encryption** (revision 2 §9.2) | $1.00 / month | No | **Pivot taken:** SSE-S3 for the buckets and the AWS-owned key for DynamoDB. Both are free, and both are encrypted at rest | `kms_cmk = true`: +$1/month |
| C-3 | ~~Route 53 hosted zone~~ | ~~$0.50 / month~~ → **$0** | — | **Removed:** DNS is on Cloudflare Free | — |
| C-4 | ~~Domain registration~~ | → **$0** | — | **Removed:** you already own `consulteasy.co.uk` | — |
| C-5 | ~~Changing the domain later~~ | — | — | **Removed:** the platform starts on its final domain, so the OAuth issuer and passkeys never move | — |
| C-6 | **AWS WAF** (rate limiting, bot rules) | **$5.00 / month per web ACL** + $1 per rule | No | **Not used.** Use API Gateway throttling (free) + per-site/per-user limits held in DynamoDB + Lambda reserved concurrency as a hard ceiling (free) | Cloudflare's proxy has free DDoS protection and one free rate-limiting rule (§5, option B), at $0 instead of ≥ $6/month |
| C-7 | **Secrets Manager** | $0.40 / month per secret | No | **Not used.** SSM Parameter Store standard tier (free) | — |
| C-8 | **CloudWatch alarms** | $0.10 / month per alarm beyond the 10 always-free | No | **≤ 5 alarms** (API 5xx, Lambda errors, throttles, DynamoDB system errors, budget). Inside the free 10 | Drop alarms, rely on the AWS Budget email |
| C-9 | **CloudWatch dashboards** | $3.00 / month each beyond 3 free | No | **None.** The board shows health; logs go to Logs Insights on demand | — |
| C-10 | **DynamoDB point-in-time recovery** | $0.20 / GB-month of table size | Recommended | **On.** The data is kilobytes to megabytes, so this costs fractions of a cent. Deletion protection on too (free) | Off: no backups of conversations and decisions |
| C-11 | **Storage** (S3 state bucket with versioning, snapshot bucket, static bucket, DynamoDB items) | $0.023 / GB-month S3, $0.25 / GB-month DynamoDB (first 25 GB free) | Yes, unavoidable | No artefact bucket (Lambda zips go up with each deploy). Lifecycle rules: old state versions expire after 90 days; snapshots per site retention (default 90 days after resolved); incomplete uploads cleaned after 1 day | — |
| C-12 | **CloudWatch Logs storage** | $0.03 / GB-month (+ $0.50 / GB ingest, on demand) | Yes | **14-day retention** on every log group, created by OpenTofu so Lambda never creates an "infinite retention" group | 7 days |
| C-13 | **SES** for team invites and digests (revision 2 §7.4) | $0 fixed (no dedicated IP); needs DKIM records (now just Cloudflare records, $0) and a production-access request | Not in the first release | **Phase 1: no email.** Invites are one-time links shown on the board for you to send yourself. SES comes later, as a module you switch on | — |
| C-14 | **The account's free-tier plan** | — | — | Accounts opened after 15 Jul 2025 are on AWS's credit-based Free plan. Some "always free" lines (Lambda 1M requests, DynamoDB 25 GB, CloudFront 1 TB) still apply; the AWS Budget (C-16) catches any surprise. Tell us which plan the target account is on | — |
| C-15 | **CloudFront flat-rate "Free" plan** ($0) | $0 | Optional | Stay on **pay-as-you-go**, which has an always-free 1 TB and 10M requests a month. The flat-rate Free plan is reportedly not available to accounts on the AWS Free plan | Opt in later if you want no-overage billing |
| C-16 | **AWS Budgets** | $0 (budgets that only send alerts are free) | Yes | A **$5/month budget**, alerting at 50 % actual and 100 % forecast, to your email, created by OpenTofu | — |
| C-17 | **GitHub Actions minutes** | $0 for a public repo; 2,000 free minutes a month on a private repo (Free plan) | Yes | ≈ 4–6 minutes per merge and ≈ 3 per PR plan: about 150–300 minutes a month at a normal pace. Inside the free minutes | — |
| C-18 | **CloudFront invalidations** | First 1,000 paths a month free | Yes | One wildcard per deploy (`/board/*`), with hashed asset names; the SDK is versioned (`/sdk/v1/…`) | — |

## 3. Choices that keep it on demand (no fixed cost, recorded so nobody "upgrades" them by accident)

- **API Gateway HTTP API** ($1.00 per million requests), not a Lambda Function URL. A function URL behind
  CloudFront's OAC needs the client to send `x-amz-content-sha256` on every POST, and MCP clients like
  Claude Code don't. Without OAC the function URL is open to anyone who finds it, around every limit.
- **Lambda: zip packages, arm64, no provisioned concurrency, no VPC.** Container images would need ECR
  ($0.10 / GB-month). arm64 is ≈ 20 % cheaper per GB-second.
- **DynamoDB on demand**, one table, two GSIs, TTL for short-lived records (TTL deletes are free).
- **No NAT gateway, no VPC endpoints, no ALB, no RDS/Aurora, no ElastiCache, no OpenSearch.** Each of
  these is $16–$40+ a month idle.
- **Snapshot viewer without a second origin.** The board fetches the snapshot through a presigned URL
  and renders it in an `iframe sandbox` (no `allow-scripts`, no `allow-same-origin`, so its origin is
  opaque). Same isolation as revision 2's separate origin, with no second distribution or certificate.
- **OpenTofu state locking with S3 lockfiles** (`use_lockfile = true`, OpenTofu ≥ 1.10). No DynamoDB
  lock table.
- **GitHub → AWS by OIDC.** No access keys exist, so there is nothing to rotate or leak.

## 4. Costs we deliberately accept (on demand, but worth knowing)

| What | Price | Why it's fine |
|---|---|---|
| Cold starts (Node 22, ≈ 300–900 ms for the auth Lambda) | — | Latency, not cost. Provisioned concurrency would fix it but costs ≈ $3–$4/month per warm instance (rejected) |
| Lambda | $0.20 / M requests + $0.0000133 / GB-s (arm64) | 1M requests and 400k GB-s free each month |
| DynamoDB on demand | $0.625 / M writes, $0.125 / M reads (eu-west-2 slightly higher) | Pennies at this volume |
| S3 PUT / GET | $0.005 / 1k PUT, $0.0004 / 1k GET | Snapshots only |
| SSM `GetParameter` | free (standard throughput) | Cached for the life of the Lambda container |
| Report captures (added 6 Nov 2026) | ≈ 0.5 MB per report in S3 (screenshot ×2, close-up, gzipped page copy): 10k reports ≈ 5 GB ≈ $0.12 / month; 4 uploads per report | Storage, which you accepted. No fixed cost: no image Lambda, no headless browser, and an S3 lifecycle rule (free) instead of a clean-up job (`capture-design.md` §9) |
| Phone notifications, M1 (added 6 Nov 2026) | Free: the browsers' push services (Apple, Google, Mozilla) charge nothing. One Lambda invocation per notification, inside the existing API function; a few DynamoDB rows per device; the VAPID key pair as one SSM SecureString (standard tier, free) | No fixed cost. Sends only happen when a draft or decision is created (`design/PT-2-mobile-ux-pass.md` §6) |

## 5. Cloudflare (added 5 Nov 2026)

**Cost: $0** on the Free plan, for DNS and for proxying. The ACM certificate CloudFront needs is free too
(`us-east-1`, validated by a CNAME in Cloudflare).

**Prerequisite (Free plan):** the **whole `consulteasy.co.uk` zone** must use Cloudflare's nameservers
("full setup"). Moving just a subdomain to Cloudflare ("subdomain setup") is Enterprise-only. If the zone
isn't on Cloudflare yet, moving it means copying every existing record first, above all **MX/SPF/DKIM for
your email**. Cloudflare's import scan finds most of them; check the list before switching nameservers.

**Two ways to use it.** Both cost $0; the choice is about security and simplicity.

| | A. DNS only (grey cloud) — **recommended** | B. Cloudflare proxy in front (orange cloud) |
|---|---|---|
| Path | Browser → CloudFront → AWS | Browser → Cloudflare → CloudFront → AWS |
| DDoS protection | AWS Shield Standard (free, automatic on CloudFront) | Cloudflare's (free), plus AWS Shield behind it |
| Rate limiting | API Gateway throttles + app limits | + one free Cloudflare rate-limiting rule and free managed WAF rules |
| Who can read the traffic | AWS only | Cloudflare too: it terminates TLS, so it sees tokens, snapshots and users' personal data. It becomes another processor in your data-protection chain |
| Bypass | n/a | Anyone can skip Cloudflare by calling the `*.cloudfront.net` address directly, unless we lock the origin: Cloudflare adds a secret header, and a CloudFront Function (≈ $0.10 per million requests, on demand) refuses requests without it. One more secret to keep in SSM and rotate |
| Caching | CloudFront only | Two caches to keep consistent (we'd make Cloudflare bypass `/api`, `/oauth`, `/mcp`) |
| Moving parts | Fewest | More (Transform Rule, origin-lock function, cache rules) |

**Recommendation: A now.** It's free, simple, and keeps personal data inside AWS. B is one OpenTofu
variable (`cloudflare_proxied = true`) later, if you see abuse that API Gateway throttling doesn't handle.

**"Cloudflare for everything"** (Workers + D1 + R2 instead of AWS) would also be about $0. It would mean
dropping your AWS target and rewriting the hosting design, so it isn't proposed. Say if you want it costed.

Sources: [AWS KMS pricing](https://aws.amazon.com/kms/pricing/), [CloudFront pricing and flat-rate plans](https://aws.amazon.com/cloudfront/pricing/),
[flat-rate plans announcement](https://aws.amazon.com/about-aws/whats-new/2025/11/aws-flat-rate-pricing-plans),
[CloudFront OAC with Lambda function URLs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html),
[OpenTofu S3 native locking](https://oneuptime.com/blog/post/2026-03-20-native-s3-state-locking-opentofu-1-10/view).
