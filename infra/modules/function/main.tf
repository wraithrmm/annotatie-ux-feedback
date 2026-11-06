# One Lambda (arm64, Node 22) with its role (under the permissions boundary), log group and "live"
# alias. Used for auth, mcp and jobs; the api Lambda keeps its own module from P0.

terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    archive = {
      source = "hashicorp/archive"
    }
  }
}

variable "name" {
  description = "Function name, e.g. annotatie-auth."
  type        = string
}

variable "boundary_arn" {
  type = string
}

variable "bundle_dir" {
  type = string
}

variable "build_sha" {
  type = string
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "policy_json" {
  description = "Extra permissions for the function's role."
  type        = string
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout" {
  type    = number
  default = 10
}

data "archive_file" "bundle" {
  type        = "zip"
  source_dir  = var.bundle_dir
  output_path = "${path.root}/.build/${var.name}.zip"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  name                 = "${var.name}-lambda"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  permissions_boundary = var.boundary_arn
}

resource "aws_cloudwatch_log_group" "fn" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = 14 # C-12
}

data "aws_iam_policy_document" "logs" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.fn.arn}:*"]
  }
}

resource "aws_iam_role_policy" "logs" {
  name   = "logs"
  role   = aws_iam_role.fn.id
  policy = data.aws_iam_policy_document.logs.json
}

resource "aws_iam_role_policy" "app" {
  name   = "app"
  role   = aws_iam_role.fn.id
  policy = var.policy_json
}

resource "aws_lambda_function" "fn" {
  function_name    = var.name
  role             = aws_iam_role.fn.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.bundle.output_path
  source_code_hash = data.archive_file.bundle.output_base64sha256
  memory_size      = var.memory_size
  timeout          = var.timeout
  publish          = true

  environment {
    variables = merge({
      BUILD_SHA                           = var.build_sha
      NODE_OPTIONS                        = "--enable-source-maps"
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    }, var.environment)
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.fn.name
  }

  depends_on = [aws_iam_role_policy.logs, aws_iam_role_policy.app]
}

resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.fn.function_name
  function_version = aws_lambda_function.fn.version
}

output "function_name" {
  value = aws_lambda_function.fn.function_name
}

output "alias_name" {
  value = aws_lambda_alias.live.name
}

output "alias_arn" {
  value = aws_lambda_alias.live.arn
}

output "invoke_arn" {
  value = aws_lambda_alias.live.invoke_arn
}
