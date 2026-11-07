# One CloudFront distribution: static files (portal, widget SDK) from S3; /api/*, /oauth/*,
# /.well-known/* and /mcp to the HTTP API, uncached.

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

variable "captures_origin" {
  description = "https://<captures bucket regional host>: presigned capture images load from there."
  type        = string
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

# S3 behind OAC has no folder index: "/board/" would be a 403. Map any path ending in "/" (or with no
# file extension) to its index.html. Billed per request (2M/month free), no fixed cost.
resource "aws_cloudfront_function" "index" {
  name    = "${var.name}-dir-index"
  runtime = "cloudfront-js-2.0"
  comment = "Serve index.html for folder paths"
  publish = true
  code    = <<-JS
    function handler(event) {
      var r = event.request;
      if (r.uri.endsWith('/')) { r.uri += 'index.html'; }
      else if (!r.uri.split('/').pop().includes('.')) { r.uri += '/index.html'; }
      return r;
    }
  JS
}

# The portal's headers: the managed security set plus a strict CSP (no inline script; styles inline for
# the page-copy viewer; images also from the captures bucket by presigned URL). The portal also hosts the
# widget for Annotatie's own site, whose captures upload straight to the bucket by presigned POST.
resource "aws_cloudfront_response_headers_policy" "static" {
  name    = "${var.name}-static"
  comment = "Security headers and CSP for the portal"

  security_headers_config {
    content_security_policy {
      override = true
      content_security_policy = join("; ", [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: ${var.captures_origin}",
        "connect-src 'self' ${var.captures_origin}",
        "worker-src 'self'",
        "manifest-src 'self'",
        "frame-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ])
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      override                   = true
    }
  }
}

# The widget script is loaded by customers' pages: no frame or CSP headers that would mean anything
# there, but cross-origin readable so integrity checks work.
resource "aws_cloudfront_response_headers_policy" "sdk" {
  name    = "${var.name}-sdk"
  comment = "Widget SDK: CORS-readable, nosniff"

  cors_config {
    access_control_allow_credentials = false
    access_control_allow_headers {
      items = ["*"]
    }
    access_control_allow_methods {
      items = ["GET", "HEAD"]
    }
    access_control_allow_origins {
      items = ["*"]
    }
    origin_override = true
  }

  security_headers_config {
    content_type_options {
      override = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      override                   = true
    }
  }
}

locals {
  api_paths = ["/api/*", "/oauth/*", "/.well-known/*", "/mcp", "/mcp/*"]
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
    response_headers_policy_id = aws_cloudfront_response_headers_policy.static.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.api_paths
    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = local.api_origin_id
      viewer_protocol_policy     = "https-only"
      allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = local.caching_disabled
      origin_request_policy_id   = local.all_viewer_except_host
      response_headers_policy_id = local.security_headers_policy_id
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/sdk/*"
    target_origin_id           = local.static_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.caching_optimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.sdk.id
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
