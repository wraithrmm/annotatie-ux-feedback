terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.6"
    }
  }

  # bucket and region come from -backend-config (the GitHub variables). S3 lockfile, no DynamoDB.
  backend "s3" {
    key          = "live/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}

locals {
  tags = {
    project    = "annotatie"
    managed-by = "opentofu"
    root       = "live"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = local.tags
  }
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = local.tags
  }
}

# Token from CLOUDFLARE_API_TOKEN, which the workflow reads from SSM (never a GitHub secret).
provider "cloudflare" {}
