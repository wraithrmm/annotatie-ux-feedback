# The platform's data: one DynamoDB table (on demand, no GSIs) and the captures bucket.
# No fixed monthly cost: pay per request and per GB stored (cost-register.md).

variable "name" {
  type = string
}

variable "account_id" {
  type = string
}

resource "aws_dynamodb_table" "data" {
  name                        = "${var.name}-data"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = true

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # C-10: backups of conversations and decisions; fractions of a cent at this size.
  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = false # AWS-owned key: free, still encrypted at rest
  }
}

# Captures (screenshots, page copies). Browsers upload by presigned POST into pending/; the API checks
# and moves them. The CI roles are denied reads on annotatie-snapshots-* (bootstrap/iam.tf).
resource "aws_s3_bucket" "captures" {
  bucket = "${var.name}-snapshots-${var.account_id}"
}

resource "aws_s3_bucket_public_access_block" "captures" {
  bucket                  = aws_s3_bucket.captures.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "captures" {
  bucket = aws_s3_bucket.captures.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "captures" {
  bucket = aws_s3_bucket.captures.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The widget runs on any customer origin; a presigned POST policy is what limits what it may upload.
resource "aws_s3_bucket_cors_configuration" "captures" {
  bucket = aws_s3_bucket.captures.id
  cors_rule {
    allowed_methods = ["POST", "GET"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "captures" {
  bucket = aws_s3_bucket.captures.id
  rule {
    id     = "unconfirmed-uploads"
    status = "Enabled"
    filter {
      prefix = "pending/"
    }
    expiration {
      days = 1
    }
  }
  rule {
    id     = "abort-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "captures_tls" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.captures.arn,
      "${aws_s3_bucket.captures.arn}/*",
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

resource "aws_s3_bucket_policy" "captures" {
  bucket = aws_s3_bucket.captures.id
  policy = data.aws_iam_policy_document.captures_tls.json
}

output "table_name" {
  value = aws_dynamodb_table.data.name
}

output "table_arn" {
  value = aws_dynamodb_table.data.arn
}

output "captures_bucket" {
  value = aws_s3_bucket.captures.id
}

output "captures_bucket_arn" {
  value = aws_s3_bucket.captures.arn
}

output "captures_regional_domain" {
  value = aws_s3_bucket.captures.bucket_regional_domain_name
}
