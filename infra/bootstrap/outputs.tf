output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "plan_role_arn" {
  value = aws_iam_role.plan.arn
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "permissions_boundary_arn" {
  value = aws_iam_policy.boundary.arn
}

output "backend_hcl" {
  description = "Write this to infra/bootstrap/backend.hcl and infra/live/backend.hcl (not secret)."
  value       = <<-EOT
    bucket = "${aws_s3_bucket.state.bucket}"
    region = "${var.aws_region}"
  EOT
}
