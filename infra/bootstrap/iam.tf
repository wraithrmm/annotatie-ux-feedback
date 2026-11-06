# GitHub Actions reaches AWS by OIDC: no access keys exist, so GitHub holds no AWS secret.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates GitHub's certificate chain itself; these are kept for older tooling.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
  depends_on = [terraform_data.account_guard]
}

locals {
  oidc_arn         = aws_iam_openid_connect_provider.github.arn
  boundary_arn     = "arn:${local.partition}:iam::${local.account_id}:policy/${local.name}-boundary"
  protected_roles  = "arn:${local.partition}:iam::${local.account_id}:role/${local.name}-gh-*"
  app_role_pattern = "arn:${local.partition}:iam::${local.account_id}:role/${local.name}-*"
  # Data the CI roles must never read: snapshots, tables, signing keys.
  snapshot_objects    = "arn:${local.partition}:s3:::${local.name}-snapshots-*/*"
  data_tables         = "arn:${local.partition}:dynamodb:*:${local.account_id}:table/${local.name}-*"
  secret_params       = "arn:${local.partition}:ssm:*:${local.account_id}:parameter/${local.name}/auth/*"
  cf_token_param      = "arn:${local.partition}:ssm:${var.aws_region}:${local.account_id}:parameter${var.cloudflare_token_parameter}"
  cf_read_token_param = "arn:${local.partition}:ssm:${var.aws_region}:${local.account_id}:parameter${var.cloudflare_read_token_parameter}"
}

data "aws_iam_policy_document" "trust_plan" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for r in local.oidc_repos : "repo:${r}:pull_request"]
    }
  }
}

data "aws_iam_policy_document" "trust_deploy" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Only jobs running in the "production" environment, which only main may use.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for r in local.oidc_repos : "repo:${r}:environment:production"]
    }
  }
}

# ---------------------------------------------------------------- shared pieces
data "aws_iam_policy_document" "state_access" {
  statement {
    sid       = "StateBucketList"
    actions   = ["s3:ListBucket", "s3:GetBucketVersioning", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.state.arn]
  }
  statement {
    sid       = "StateObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/*"]
  }
}

# PR plans get a read-only Cloudflare token; only deploys get the DNS-edit token.
data "aws_iam_policy_document" "cf_read_token" {
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [local.cf_read_token_param]
  }
}

data "aws_iam_policy_document" "cf_edit_token" {
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [local.cf_token_param]
  }
}

data "aws_iam_policy_document" "deny_data" {
  statement {
    sid       = "NoSnapshotReads"
    effect    = "Deny"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = [local.snapshot_objects]
  }
  statement {
    sid       = "NoTableDataReads"
    effect    = "Deny"
    actions   = ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:ExportTableToPointInTime"]
    resources = [local.data_tables, "${local.data_tables}/*"]
  }
  statement {
    sid       = "NoSigningKeys"
    effect    = "Deny"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory"]
    resources = [local.secret_params]
  }
}

# ---------------------------------------------------------------- plan role (PRs)
resource "aws_iam_role" "plan" {
  name                 = "${local.name}-gh-plan"
  assume_role_policy   = data.aws_iam_policy_document.trust_plan.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "plan_readonly" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "state"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.state_access.json
}

resource "aws_iam_role_policy" "plan_cf" {
  name   = "cloudflare-read-token"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.cf_read_token.json
}

# ReadOnlyAccess includes ssm:GetParameter; make sure PRs can't read the DNS-edit token.
data "aws_iam_policy_document" "plan_no_edit_token" {
  statement {
    effect    = "Deny"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParameterHistory"]
    resources = [local.cf_token_param]
  }
}

resource "aws_iam_role_policy" "plan_no_edit_token" {
  name   = "deny-cloudflare-edit-token"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_no_edit_token.json
}

resource "aws_iam_role_policy" "plan_deny_data" {
  name   = "deny-data"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.deny_data.json
}

# ---------------------------------------------------------------- permissions boundary
# Every role the deploy role creates must carry this boundary, so a deploy can never
# create a role with more power than the platform needs.
data "aws_iam_policy_document" "boundary" {
  statement {
    sid = "PlatformServices"
    actions = [
      "logs:*", "dynamodb:*", "s3:*", "ssm:GetParameter", "ssm:GetParameters", "ssm:PutParameter",
      "kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:Sign", "kms:GetPublicKey", "kms:DescribeKey",
      "lambda:InvokeFunction", "scheduler:*", "events:*", "sns:Publish", "ses:SendEmail", "ses:SendRawEmail",
      "cloudwatch:PutMetricData", "xray:PutTraceSegments", "xray:PutTelemetryRecords", "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "NoIam"
    effect    = "Deny"
    actions   = ["iam:*", "organizations:*", "account:*"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "boundary" {
  name   = "${local.name}-boundary"
  policy = data.aws_iam_policy_document.boundary.json
}

# ---------------------------------------------------------------- deploy role (main)
data "aws_iam_policy_document" "deploy" {
  statement {
    sid = "ReadEverythingNeededToPlan"
    actions = [
      "lambda:Get*", "lambda:List*", "apigateway:GET", "cloudfront:Get*", "cloudfront:List*",
      "acm:Describe*", "acm:List*", "acm:GetCertificate", "logs:Describe*", "logs:List*", "logs:ListTagsForResource",
      "dynamodb:Describe*", "dynamodb:List*", "s3:ListAllMyBuckets", "cloudwatch:Describe*", "cloudwatch:List*",
      "sns:Get*", "sns:List*", "scheduler:Get*", "scheduler:List*", "iam:Get*", "iam:List*", "ssm:DescribeParameters",
      "sts:GetCallerIdentity", "budgets:View*", "tag:GetResources",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "Lambda"
    actions   = ["lambda:*"]
    resources = ["arn:${local.partition}:lambda:*:${local.account_id}:function:${local.name}-*"]
  }
  statement {
    sid       = "LambdaUnscoped"
    actions   = ["lambda:CreateFunction", "lambda:TagResource", "lambda:UntagResource"]
    resources = ["*"]
  }
  statement {
    sid       = "ApiGatewayCloudFrontAcm"
    actions   = ["apigateway:*", "cloudfront:*", "acm:*"]
    resources = ["*"]
  }
  statement {
    sid       = "Buckets"
    actions   = ["s3:*"]
    resources = ["arn:${local.partition}:s3:::${local.name}-*", "arn:${local.partition}:s3:::${local.name}-*/*"]
  }
  statement {
    sid       = "Tables"
    actions   = ["dynamodb:CreateTable", "dynamodb:UpdateTable", "dynamodb:DeleteTable", "dynamodb:TagResource", "dynamodb:UntagResource", "dynamodb:UpdateTimeToLive", "dynamodb:UpdateContinuousBackups", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTimeToLive"]
    resources = [local.data_tables, "${local.data_tables}/*"]
  }
  statement {
    sid       = "Logs"
    actions   = ["logs:*"]
    resources = ["*"]
  }
  statement {
    sid       = "AlarmsTopicsSchedules"
    actions   = ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:TagResource", "cloudwatch:UntagResource", "sns:*", "scheduler:*"]
    resources = ["*"]
  }
  statement {
    sid       = "PlatformParameters"
    actions   = ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter", "ssm:AddTagsToResource", "ssm:ListTagsForResource"]
    resources = ["arn:${local.partition}:ssm:*:${local.account_id}:parameter/${local.name}/*"]
  }

  # IAM: only app roles named annotatie-*, and only with the boundary attached.
  statement {
    sid       = "CreateAppRolesWithBoundary"
    actions   = ["iam:CreateRole", "iam:PutRolePermissionsBoundary"]
    resources = [local.app_role_pattern]
    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [local.boundary_arn]
    }
  }
  statement {
    sid = "ManageAppRoles"
    actions = [
      "iam:DeleteRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
    ]
    resources = [local.app_role_pattern]
  }
  statement {
    sid       = "PassAppRoles"
    actions   = ["iam:PassRole"]
    resources = [local.app_role_pattern]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com", "scheduler.amazonaws.com", "apigateway.amazonaws.com"]
    }
  }
  statement {
    sid       = "ServiceLinkedRoles"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["*"]
    condition {
      test     = "StringLike"
      variable = "iam:AWSServiceName"
      values   = ["ops.apigateway.amazonaws.com", "replicator.lambda.amazonaws.com", "logger.cloudfront.amazonaws.com"]
    }
  }

  # Never touch the CI roles or the boundary itself.
  statement {
    sid       = "ProtectCiRoles"
    effect    = "Deny"
    actions   = ["iam:*"]
    resources = [local.protected_roles, local.boundary_arn]
  }
  statement {
    sid       = "NoBoundaryRemoval"
    effect    = "Deny"
    actions   = ["iam:DeleteRolePermissionsBoundary"]
    resources = ["*"]
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${local.name}-gh-deploy"
  assume_role_policy   = data.aws_iam_policy_document.trust_deploy.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

resource "aws_iam_role_policy" "deploy_state" {
  name   = "state"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.state_access.json
}

resource "aws_iam_role_policy" "deploy_cf" {
  name   = "cloudflare-edit-token"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.cf_edit_token.json
}

resource "aws_iam_role_policy" "deploy_deny_data" {
  name   = "deny-data"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deny_data.json
}
