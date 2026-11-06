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

output "jobs_function" {
  description = "Invoke with {\"action\":\"bootstrap-owner\",\"email\":\"...\"} for the first invite."
  value       = module.jobs.function_name
}

output "table_name" {
  value = module.data.table_name
}
