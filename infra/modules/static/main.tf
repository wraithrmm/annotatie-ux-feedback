# Private bucket for the portal and (later) the SDK, read only by CloudFront (OAC).
# OpenTofu uploads the files, so it owns them like everything else.

variable "name" {
  type = string
}

variable "account_id" {
  type = string
}

variable "source_dir" {
  description = "Built static files (dist/static)."
  type        = string
}

locals {
  content_types = {
    html        = "text/html; charset=utf-8"
    css         = "text/css; charset=utf-8"
    js          = "text/javascript; charset=utf-8"
    mjs         = "text/javascript; charset=utf-8"
    json        = "application/json"
    svg         = "image/svg+xml"
    png         = "image/png"
    ico         = "image/x-icon"
    woff2       = "font/woff2"
    txt         = "text/plain; charset=utf-8"
    map         = "application/json"
    webmanifest = "application/manifest+json"
    webp        = "image/webp"
  }
  files = fileset(var.source_dir, "**")
}

resource "aws_s3_bucket" "this" {
  bucket        = "${var.name}-static-${var.account_id}"
  force_destroy = true # only build output lives here
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_object" "file" {
  for_each = local.files

  bucket       = aws_s3_bucket.this.id
  key          = each.value
  source       = "${var.source_dir}/${each.value}"
  etag         = filemd5("${var.source_dir}/${each.value}")
  content_type = lookup(local.content_types, lower(element(split(".", each.value), length(split(".", each.value)) - 1)), "application/octet-stream")
  # Only the portal's hashed assets are immutable; HTML and the service worker revalidate; the widget
  # SDK (a stable URL customers embed) and icons are cached for five minutes.
  cache_control = (
    startswith(each.value, "board/assets/") ? "public, max-age=31536000, immutable" :
    endswith(each.value, ".html") || endswith(each.value, "sw.js") ? "no-cache" :
    "public, max-age=300"
  )
}

output "bucket_id" {
  value = aws_s3_bucket.this.id
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}

output "bucket_regional_domain_name" {
  value = aws_s3_bucket.this.bucket_regional_domain_name
}
