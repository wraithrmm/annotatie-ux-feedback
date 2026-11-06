variable "aws_region" {
  description = "Region for everything regional (CloudFront certificates still go to us-east-1)."
  type        = string
  default     = "eu-west-2"
}

variable "expected_account_id" {
  description = "The target AWS account. The apply refuses to run against any other account."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must be a 12-digit AWS account id."
  }
}

variable "github_owner" {
  description = "GitHub user or organisation that owns the repository."
  type        = string
}

variable "github_repo" {
  description = "Repository name."
  type        = string
  default     = "annotatie"
}

variable "create_github_repo" {
  description = "Create the repository with OpenTofu. Set false if it already exists (it is then read, not managed)."
  type        = bool
  default     = true
}

variable "enable_branch_protection" {
  description = "Protect main (needs GitHub Pro/Team for a private repository on a personal account)."
  type        = bool
  default     = false
}

variable "budget_email" {
  description = "Where AWS Budget alerts go."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly budget that triggers alerts (C-16)."
  type        = number
  default     = 5
}

variable "domain_name" {
  description = "The platform's hostname."
  type        = string
  default     = "annotatie.consulteasy.co.uk"
}

variable "cloudflare_zone" {
  description = "The Cloudflare zone that holds domain_name."
  type        = string
  default     = "consulteasy.co.uk"
}

variable "cloudflare_token_parameter" {
  description = "SSM SecureString holding the Cloudflare API token (DNS Edit on the zone). You put it there by CLI; OpenTofu never sees its value."
  type        = string
  default     = "/annotatie/cloudflare/api-token"
}

variable "cloudflare_read_token_parameter" {
  description = "SSM SecureString holding a read-only Cloudflare token (Zone Read + DNS Read), used by PR plans."
  type        = string
  default     = "/annotatie/cloudflare/api-token-read"
}
