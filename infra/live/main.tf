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

module "api" {
  source               = "../modules/api"
  name                 = local.name
  boundary_arn         = local.boundary_arn
  bundle_dir           = "${path.root}/${var.dist_dir}/lambda/api"
  build_sha            = var.build_sha
  reserved_concurrency = var.api_reserved_concurrency
}

module "cdn" {
  source                     = "../modules/cdn"
  name                       = local.name
  domain_name                = var.domain_name
  certificate_arn            = module.edge.certificate_arn
  static_bucket_regional_dns = module.static.bucket_regional_domain_name
  api_origin_domain          = module.api.origin_domain
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
