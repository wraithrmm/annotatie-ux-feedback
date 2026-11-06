# The API Lambda behind an API Gateway HTTP API. All on demand: no VPC, no provisioned concurrency.

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
  type = string
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

variable "reserved_concurrency" {
  type    = number
  default = null
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "policy_json" {
  description = "The API Lambda's data permissions (table, captures, secrets)."
  type        = string
}

variable "extra_routes" {
  description = "Other Lambdas behind this HTTP API: route keys to a function alias."
  type = map(object({
    route_keys    = list(string)
    invoke_arn    = string
    function_name = string
    alias_name    = string
  }))
  default = {}
}

locals {
  fn = "${var.name}-api"
}

data "archive_file" "bundle" {
  type        = "zip"
  source_dir  = var.bundle_dir
  output_path = "${path.root}/.build/${local.fn}.zip"
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
  name                 = "${local.fn}-lambda"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  permissions_boundary = var.boundary_arn
}

resource "aws_cloudwatch_log_group" "fn" {
  name              = "/aws/lambda/${local.fn}"
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
  function_name                  = local.fn
  role                           = aws_iam_role.fn.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  filename                       = data.archive_file.bundle.output_path
  source_code_hash               = data.archive_file.bundle.output_base64sha256
  memory_size                    = 256
  timeout                        = 10
  reserved_concurrent_executions = var.reserved_concurrency == null ? -1 : var.reserved_concurrency
  publish                        = true

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

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.name}-http"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "fn" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_alias.live.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

resource "aws_apigatewayv2_route" "api" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "ANY /api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.fn.id}"
}

# ---------------------------------------------------------------- other Lambdas (auth, mcp)
locals {
  extra_route_list = merge([
    for k, v in var.extra_routes : { for rk in v.route_keys : "${k} ${rk}" => { fn = k, route_key = rk } }
  ]...)
}

resource "aws_apigatewayv2_integration" "extra" {
  for_each               = var.extra_routes
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 15000
}

resource "aws_apigatewayv2_route" "extra" {
  for_each  = local.extra_route_list
  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.value.route_key
  target    = "integrations/${aws_apigatewayv2_integration.extra[each.value.fn].id}"
}

resource "aws_lambda_permission" "extra" {
  for_each      = var.extra_routes
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = each.value.function_name
  qualifier     = each.value.alias_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  # Free throttling instead of WAF (C-6).
  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 20
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn.function_name
  qualifier     = aws_lambda_alias.live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "origin_domain" {
  value = replace(aws_apigatewayv2_api.http.api_endpoint, "https://", "")
}

output "api_id" {
  value = aws_apigatewayv2_api.http.id
}

output "function_name" {
  value = aws_lambda_function.fn.function_name
}
