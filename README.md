# Annotatie

Users pin feedback to the exact part of a page. AI agents read it through MCP and draft replies.
**Nothing an agent writes reaches a user until a person approves it in the portal**, unless that site's
auto-approve flag is on. Design and plan: [`docs/implementation-plan.md`](docs/implementation-plan.md);
costs: [`docs/cost-register.md`](docs/cost-register.md).

**Phase P0 (this commit):** the repository, the pipeline and the cost proof. It contains a health-check
API Lambda behind CloudFront at `https://annotatie.consulteasy.co.uk`, a placeholder portal page, and a
cost guard that fails any plan adding a resource with a fixed monthly fee.

## Layout

| Path | What |
|---|---|
| `services/api` | API Lambda (P0: `GET /api/health`) |
| `apps/portal` | Portal (P0: a placeholder page at `/board/`) |
| `tools/cost-guard` | Fails a plan that adds fixed-cost resources (KMS keys, NAT, WAF, …) |
| `bin/toolbox`, `tools/toolbox` | Runs `tofu`, `gh` and `aws` in Docker, so none of them is installed locally |
| `infra/bootstrap` | Run **once, locally**: state bucket, GitHub OIDC, CI roles, the GitHub repo, environment and variables, budget |
| `infra/live` | Applied by CI on every merge to `main` |
| `infra/modules` | `edge` (ACM + Cloudflare DNS), `static`, `api`, `cdn`, `observability` |

## Develop

```bash
npm ci && npm run typecheck && npm test && npm run build
```

## Secrets: where each one lives

**GitHub holds none.** AWS access is by OIDC. The workflows read the Cloudflare tokens from SSM with their
AWS role. PR plans get a read-only token; only deploys from `main` get the DNS-edit token.

## One-time setup (about 15 minutes)

You need Docker, an AWS profile that is an admin **of the target account**, and `consulteasy.co.uk` on
Cloudflare's nameservers. Nothing else is installed: `bin/toolbox` runs OpenTofu 1.10.10 (the CI version),
the GitHub CLI and the AWS CLI in a container, from the folder you are in. Run it from Git Bash on Windows.
It mounts your `~/.aws`; the GitHub login stays in the Docker volume `annotatie-gh`. Set the profile first:

```bash
export AWS_PROFILE=<target-account profile> AWS_REGION=eu-west-2
```

```bash
bin/toolbox aws sts get-caller-identity
```

```bash
bin/toolbox gh auth login
```

**1. Two Cloudflare API tokens** (Cloudflare → My Profile → API Tokens → Create custom token), both
limited to the zone `consulteasy.co.uk`:
- *annotatie-deploy*: Zone → DNS → **Edit**, Zone → Zone → Read
- *annotatie-plan*: Zone → DNS → **Read**, Zone → Zone → Read

**2. Put them in SSM** (in the target account and region; never in a file):

```bash
bin/toolbox aws ssm put-parameter --name /annotatie/cloudflare/api-token --type SecureString --value "<deploy token>"
```

```bash
bin/toolbox aws ssm put-parameter --name /annotatie/cloudflare/api-token-read --type SecureString --value "<plan token>"
```

**3. Bootstrap** (creates the GitHub repo too):

```bash
cd infra/bootstrap && cp bootstrap.example.tfvars bootstrap.tfvars   # fill in account id, GitHub owner, email
```

```bash
../../bin/toolbox sh -c 'GITHUB_TOKEN=$(gh auth token) && tofu init && tofu apply -var-file=bootstrap.tfvars'
```

**4. Move the bootstrap state into its bucket.** Uncomment the `backend "s3"` block in
`infra/bootstrap/versions.tf`, write the `backend_hcl` output to `infra/bootstrap/backend.hcl`, then:

```bash
../../bin/toolbox tofu init -migrate-state -backend-config=backend.hcl
```

**5. Push.** The first push to `main` deploys:

```bash
git remote add origin git@github.com:<owner>/annotatie.git && git push -u origin main
```

**6. Confirm** the AWS Budget and SNS alarm emails (one click each), then open
`https://annotatie.consulteasy.co.uk/board/`. It shows the deployed commit.

## Deploy your own copy

The workflows contain nothing specific to one AWS account or domain. Everything comes from repository
variables that the bootstrap writes, so a fork deploys to your own infrastructure without code changes:

1. Fork this repository. Until step 3 is done, `deploy` only prints a notice and the CI `infra` plan is
   skipped; nothing tries to reach AWS.
2. Follow **One-time setup** above against your own AWS account and Cloudflare zone. In `bootstrap.tfvars`
   also set:
   ```hcl
   github_owner       = "<your GitHub user or org>"
   github_repo        = "<your fork's name>"
   create_github_repo = false                     # the fork already exists
   domain_name        = "feedback.example.com"
   cloudflare_zone    = "example.com"
   ```
   The bootstrap trusts only your fork for OIDC and writes its Actions variables (`AWS_ACCOUNT_ID`,
   `AWS_REGION`, `DOMAIN_NAME`, …).
3. Push to your fork's `main`. It deploys to your account.

To take later updates, sync your fork with this repository. Keep your changes out of tracked files where
you can (they belong in `bootstrap.tfvars` and the repository variables), and syncing stays conflict-free.

## Cost proof (end of P0)

Leave it running for a week, then check Cost Explorer filtered by the tag `project = annotatie`. The
expected total is **≈ $0.00–$0.05**. The budget alert fires at $2.50 actual and at $5 forecast.

## License

Copyright (c) 2026 ConsultEZ. Released under the [MIT License](LICENSE).

You are free to use, copy, modify, fork, self-host and redistribute this code,
including commercially, as long as the copyright and licence notice stay with
it. ConsultEZ maintains this repository and decides what goes into it; forks
are welcome to go their own way.
