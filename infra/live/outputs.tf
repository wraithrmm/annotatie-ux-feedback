output "url" {
  value = "https://${var.domain_name}"
}

output "distribution_id" {
  description = "Used by the deploy workflow for the invalidation."
  value       = module.cdn.distribution_id
}

output "cloudfront_domain" {
  value = module.cdn.distribution_domain_name
}

output "api_function" {
  value = module.api.function_name
}
