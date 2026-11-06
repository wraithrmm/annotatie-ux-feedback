terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.4"
    }
  }

  # First apply: leave this commented out (local state creates the bucket).
  # Then uncomment, and run:  tofu init -migrate-state -backend-config=backend.hcl
  # backend "s3" {
  #   key          = "bootstrap/terraform.tfstate"
  #   use_lockfile = true
  #   encrypt      = true
  # }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      project    = "annotatie"
      managed-by = "opentofu"
      root       = "bootstrap"
    }
  }
}

# Auth comes from GITHUB_TOKEN in your shell for this run only:
#   export GITHUB_TOKEN=$(gh auth token)
provider "github" {
  owner = var.github_owner
}
