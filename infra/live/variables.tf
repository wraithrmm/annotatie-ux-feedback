variable "aws_region" {
  type    = string
  default = "eu-west-2"
}

variable "domain_name" {
  description = "The platform's hostname."
  type        = string
  default     = "annotatie.consulteasy.co.uk"
}

variable "cloudflare_zone" {
  type    = string
  default = "consulteasy.co.uk"
}

variable "cloudflare_proxied" {
  description = "Put Cloudflare's proxy in front (cost-register.md §5, option B). Needs the origin lock first; keep false."
  type        = bool
  default     = false
  validation {
    condition     = var.cloudflare_proxied == false
    error_message = "Proxy mode needs the origin-lock work (cost-register.md §5) before it can be turned on."
  }
}

variable "build_sha" {
  description = "The commit being deployed; shown by /api/health."
  type        = string
  default     = "dev"
}

variable "dist_dir" {
  description = "Where `npm run build` put its output, relative to this root."
  type        = string
  default     = "../../dist"
}

variable "alarm_email" {
  description = "Where alarms go. Empty = alarms exist but notify nobody."
  type        = string
  default     = ""
}

variable "api_reserved_concurrency" {
  description = "Hard ceiling on concurrent API Lambdas (free). null = none; new accounts with a 10 limit can't reserve."
  type        = number
  default     = null
}

variable "auto_approve_allowed" {
  description = "Kill switch: false stops every site's auto-approve at once (agent replies always wait for a person)."
  type        = bool
  default     = true
}
