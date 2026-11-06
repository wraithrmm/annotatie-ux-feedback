# One CloudFront distribution: static files from S3, /api/* to the HTTP API.
# Later phases add /oauth/*, /.well-known/*, /mcp and /sdk/* behaviours.

variable "name" {
  type = string
}

variable "domain_name" {
  type = string
}

variable "certificate_arn" {
  type = string
}

variable "static_bucket_regional_dns" {
  type = string
}

variable "api_origin_domain" {
  type = string
}

locals {
  # AWS managed policies (fixed ids).
  caching_optimized          = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  caching_disabled           = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  all_viewer_except_host     = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  security_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"
  static_origin_id           = "static"
  api_origin_id              = "api"
}

resource "aws_cloudfront_origin_access_control" "static" {
  name                              = "${var.name}-static"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = "${var.name} (${var.domain_name})"
  aliases             = [var.domain_name]
  default_root_object = "index.html"
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  price_class         = "PriceClass_100"

  origin {
    origin_id                = local.static_origin_id
    domain_name              = var.static_bucket_regional_dns
    origin_access_control_id = aws_cloudfront_origin_access_control.static.id
  }

  origin {
    origin_id   = local.api_origin_id
    domain_name = var.api_origin_domain
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = local.static_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.caching_optimized
    response_headers_policy_id = local.security_headers_policy_id
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = local.api_origin_id
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.caching_disabled
    origin_request_policy_id   = local.all_viewer_except_host
    response_headers_policy_id = local.security_headers_policy_id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "distribution_domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}
