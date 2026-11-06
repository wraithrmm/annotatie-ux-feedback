# The CloudFront certificate (free, ACM in us-east-1), validated by CNAMEs in Cloudflare.

terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

variable "domain_name" {
  type = string
}

variable "cloudflare_zone" {
  type = string
}

data "cloudflare_zone" "this" {
  filter = {
    name = var.cloudflare_zone
  }
}

resource "aws_acm_certificate" "this" {
  domain_name       = var.domain_name
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_dns_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.this.domain_validation_options : o.domain_name => o
  }
  zone_id = data.cloudflare_zone.this.id
  name    = trimsuffix(each.value.resource_record_name, ".")
  type    = each.value.resource_record_type
  content = trimsuffix(each.value.resource_record_value, ".")
  ttl     = 300
  proxied = false
  comment = "ACM validation for ${var.domain_name}, managed by OpenTofu"
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in cloudflare_dns_record.validation : r.name]
}

output "certificate_arn" {
  value = aws_acm_certificate_validation.this.certificate_arn
}

output "cloudflare_zone_id" {
  value = data.cloudflare_zone.this.id
}
