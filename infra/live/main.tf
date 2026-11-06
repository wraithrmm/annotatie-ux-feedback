data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name         = "annotatie"
  account_id   = data.aws_caller_identity.current.account_id
  boundary_arn = "arn:${data.aws_partition.current.partition}:iam::${local.account_id}:policy/${local.name}-boundary"
}

module "edge" {
  source          = "../modules/edge"
  domain_name     = var.domain_name
  cloudflare_zone = var.cloudflare_zone
  providers = {
    aws = aws.us_east_1
  }
}

module "static" {
  source     = "../modules/static"
  name       = local.name
  account_id = local.account_id
  source_dir = "${path.root}/${var.dist_dir}/static"
}

module "data" {
  source     = "../modules/data"
  name       = local.name
  account_id = local.account_id
}

locals {
  app_env = {
    ANNOTATIE_BASE_URL   = "https://${var.domain_name}"
    TABLE_NAME           = module.data.table_name
    CAPTURE_BUCKET       = module.data.captures_bucket
    AUTO_APPROVE_ALLOWED = var.auto_approve_allowed ? "true" : "false"
  }
  secrets_arn = "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${local.account_id}:parameter/${local.name}/auth/*"
}

# ---------------------------------------------------------------- what each Lambda may touch
data "aws_iam_policy_document" "table" {
  statement {
    sid = "Table"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query",
      "dynamodb:BatchWriteItem", "dynamodb:BatchGetItem", "dynamodb:TransactWriteItems", "dynamodb:ConditionCheckItem",
    ]
    resources = [module.data.table_arn]
  }
  statement {
    sid       = "Secrets"
    actions   = ["ssm:GetParameter", "ssm:PutParameter"]
    resources = [local.secrets_arn]
  }
  statement {
    sid       = "SecretsKey"
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "api" {
  source_policy_documents = [data.aws_iam_policy_document.table.json]
  statement {
    sid       = "Captures"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${module.data.captures_bucket_arn}/*"]
  }
  statement {
    sid       = "CapturesList"
    actions   = ["s3:ListBucket"]
    resources = [module.data.captures_bucket_arn]
  }
}

data "aws_iam_policy_document" "mcp" {
  source_policy_documents = [data.aws_iam_policy_document.table.json]
  statement {
    sid       = "CapturesRead"
    actions   = ["s3:GetObject"]
    resources = ["${module.data.captures_bucket_arn}/sites/*"]
  }
}

data "aws_iam_policy_document" "jobs" {
  source_policy_documents = [data.aws_iam_policy_document.table.json]
  statement {
    sid       = "CapturesPurge"
    actions   = ["s3:DeleteObject"]
    resources = ["${module.data.captures_bucket_arn}/sites/*"]
  }
  statement {
    sid       = "CapturesList"
    actions   = ["s3:ListBucket"]
    resources = [module.data.captures_bucket_arn]
  }
}

# ---------------------------------------------------------------- Lambdas
module "auth" {
  source       = "../modules/function"
  name         = "${local.name}-auth"
  boundary_arn = local.boundary_arn
  bundle_dir   = "${path.root}/${var.dist_dir}/lambda/auth"
  build_sha    = var.build_sha
  environment  = local.app_env
  policy_json  = data.aws_iam_policy_document.table.json
  memory_size  = 512
}

module "mcp" {
  source       = "../modules/function"
  name         = "${local.name}-mcp"
  boundary_arn = local.boundary_arn
  bundle_dir   = "${path.root}/${var.dist_dir}/lambda/mcp"
  build_sha    = var.build_sha
  environment  = local.app_env
  policy_json  = data.aws_iam_policy_document.mcp.json
  memory_size  = 512
  timeout      = 15
}

module "jobs" {
  source       = "../modules/function"
  name         = "${local.name}-jobs"
  boundary_arn = local.boundary_arn
  bundle_dir   = "${path.root}/${var.dist_dir}/lambda/jobs"
  build_sha    = var.build_sha
  environment  = local.app_env
  policy_json  = data.aws_iam_policy_document.jobs.json
  timeout      = 300
}

module "api" {
  source               = "../modules/api"
  name                 = local.name
  boundary_arn         = local.boundary_arn
  bundle_dir           = "${path.root}/${var.dist_dir}/lambda/api"
  build_sha            = var.build_sha
  reserved_concurrency = var.api_reserved_concurrency
  environment          = local.app_env
  policy_json          = data.aws_iam_policy_document.api.json
  extra_routes = {
    auth = {
      route_keys    = ["ANY /oauth/{proxy+}", "ANY /.well-known/{proxy+}"]
      invoke_arn    = module.auth.invoke_arn
      function_name = module.auth.function_name
      alias_name    = module.auth.alias_name
    }
    mcp = {
      route_keys    = ["ANY /mcp", "ANY /mcp/{proxy+}"]
      invoke_arn    = module.mcp.invoke_arn
      function_name = module.mcp.function_name
      alias_name    = module.mcp.alias_name
    }
  }
}

# ---------------------------------------------------------------- daily retention (free tier)
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name                 = "${local.name}-jobs-scheduler"
  assume_role_policy   = data.aws_iam_policy_document.scheduler_assume.json
  permissions_boundary = local.boundary_arn
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [module.jobs.alias_arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "invoke-jobs"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule" "retention" {
  name                         = "${local.name}-retention"
  schedule_expression          = "cron(15 3 * * ? *)"
  schedule_expression_timezone = "Europe/London"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = module.jobs.alias_arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ action = "retention" })
    retry_policy {
      maximum_retry_attempts = 2
    }
  }
}

module "cdn" {
  source                     = "../modules/cdn"
  name                       = local.name
  domain_name                = var.domain_name
  certificate_arn            = module.edge.certificate_arn
  static_bucket_regional_dns = module.static.bucket_regional_domain_name
  api_origin_domain          = module.api.origin_domain
  captures_origin            = "https://${module.data.captures_regional_domain}"
}

# Let only this distribution read the static bucket (OAC).
data "aws_iam_policy_document" "static_read" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${module.static.bucket_arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [module.cdn.distribution_arn]
    }
  }
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      module.static.bucket_arn,
      "${module.static.bucket_arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "static" {
  bucket = module.static.bucket_id
  policy = data.aws_iam_policy_document.static_read.json
}

# annotatie.consulteasy.co.uk -> CloudFront, DNS only (grey cloud).
resource "cloudflare_dns_record" "site" {
  zone_id = module.edge.cloudflare_zone_id
  name    = var.domain_name
  type    = "CNAME"
  content = module.cdn.distribution_domain_name
  ttl     = 300
  proxied = var.cloudflare_proxied
  comment = "Annotatie, managed by OpenTofu"
}

module "observability" {
  source        = "../modules/observability"
  name          = local.name
  alarm_email   = var.alarm_email
  function_name = module.api.function_name
  api_id        = module.api.api_id
}
