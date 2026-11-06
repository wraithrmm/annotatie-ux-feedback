# The repository, its production environment and its (non-secret) variables.
# GitHub holds no secrets: AWS is reached by OIDC, the Cloudflare token lives in SSM.

resource "github_repository" "this" {
  count = var.create_github_repo ? 1 : 0

  name                   = var.github_repo
  description            = "Annotatie: pinned user feedback, agent replies through an approval gate."
  visibility             = "private"
  has_issues             = true
  has_projects           = false
  has_wiki               = false
  delete_branch_on_merge = true
  allow_merge_commit     = false
  allow_rebase_merge     = false
  allow_squash_merge     = true
  auto_init              = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "github_repository_vulnerability_alerts" "this" {
  repository = local.repo_name
}

locals {
  repo_name = var.create_github_repo ? github_repository.this[0].name : var.github_repo
}

resource "github_repository_environment" "production" {
  repository  = local.repo_name
  environment = "production"

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "main_only" {
  repository     = local.repo_name
  environment    = github_repository_environment.production.environment
  branch_pattern = "main"
}

locals {
  actions_variables = {
    AWS_ACCOUNT_ID      = local.account_id
    AWS_REGION          = var.aws_region
    TF_STATE_BUCKET     = aws_s3_bucket.state.bucket
    DOMAIN_NAME         = var.domain_name
    CLOUDFLARE_ZONE     = var.cloudflare_zone
    CF_TOKEN_PARAM      = var.cloudflare_token_parameter
    CF_READ_TOKEN_PARAM = var.cloudflare_read_token_parameter
    ALARM_EMAIL         = var.budget_email
  }
}

resource "github_actions_variable" "this" {
  for_each      = local.actions_variables
  repository    = local.repo_name
  variable_name = each.key
  value         = each.value
}

resource "github_branch_protection" "main" {
  count = var.enable_branch_protection ? 1 : 0

  repository_id           = local.repo_name
  pattern                 = "main"
  enforce_admins          = false
  required_linear_history = true
  allows_force_pushes     = false
  allows_deletions        = false

  required_status_checks {
    strict   = true
    contexts = ["test", "infra"]
  }

  required_pull_request_reviews {
    required_approving_review_count = 0
  }
}
