// Cost guard: fails a plan that would create anything with a fixed monthly cost.
// The list is the "not on demand" register in docs/cost-register.md. A resource
// type may be allowed only by naming it explicitly (e.g. --allow aws_kms_key when
// signing_backend = "kms" has been agreed).

/** Resource types that cost money every month whether used or not. */
export const FIXED_COST_TYPES = Object.freeze({
  aws_kms_key: "KMS customer-managed key: $1/month (C-1, C-2)",
  aws_kms_replica_key: "KMS replica key: $1/month",
  aws_route53_zone: "Route 53 hosted zone: $0.50/month (C-3; DNS is on Cloudflare)",
  aws_wafv2_web_acl: "WAF web ACL: $5/month + $1/rule (C-6)",
  aws_waf_web_acl: "WAF classic web ACL: $5/month",
  aws_secretsmanager_secret: "Secrets Manager: $0.40/secret/month (C-7; use SSM standard)",
  aws_cloudwatch_dashboard: "CloudWatch dashboard: $3/month (C-9)",
  aws_nat_gateway: "NAT gateway: ~$35/month",
  aws_eip: "Elastic IP: $3.60/month",
  aws_lb: "Load balancer: ~$18/month",
  aws_alb: "Load balancer: ~$18/month",
  aws_instance: "EC2 instance: hourly",
  aws_db_instance: "RDS instance: hourly",
  aws_rds_cluster: "Aurora cluster: hourly or ACU minimum",
  aws_elasticache_cluster: "ElastiCache: hourly",
  aws_elasticache_serverless_cache: "ElastiCache Serverless: minimum storage charge",
  aws_opensearch_domain: "OpenSearch: hourly",
  aws_vpc_endpoint: "Interface VPC endpoint: ~$7/month per AZ",
  aws_ecs_service: "ECS service: runs continuously",
  aws_ecr_repository: "ECR: $0.10/GB-month (zips are used instead)",
  aws_lambda_provisioned_concurrency_config: "Provisioned concurrency: ~$3-4/month per instance",
  aws_apigatewayv2_vpc_link: "VPC link implies private integrations and NAT/ALB",
  aws_shield_protection: "Shield Advanced: $3,000/month",
  aws_cloudtrail: "Additional CloudTrail trails bill data events",
});

/**
 * @param {{ resource_changes?: Array<{ address: string, type: string, change: { actions: string[], after?: Record<string, unknown> | null } }> }} plan
 *   the output of `tofu show -json <planfile>`
 * @param {{ allow?: string[] }} [options]
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkPlan(plan, options = {}) {
  const allow = new Set(options.allow ?? []);
  /** @type {string[]} */
  const problems = [];

  for (const rc of plan.resource_changes ?? []) {
    const actions = rc.change?.actions ?? [];
    const creatingOrUpdating = actions.includes("create") || actions.includes("update");
    if (!creatingOrUpdating) continue;
    const after = rc.change.after ?? {};

    const reason = /** @type {Record<string, string>} */ (FIXED_COST_TYPES)[rc.type];
    if (reason && !allow.has(rc.type)) {
      problems.push(`${rc.address}: ${reason}`);
      continue;
    }

    if (rc.type === "aws_dynamodb_table" && after.billing_mode !== "PAY_PER_REQUEST") {
      problems.push(`${rc.address}: DynamoDB must be on demand (billing_mode = PAY_PER_REQUEST)`);
    }
    if (rc.type === "aws_cloudwatch_log_group") {
      const days = after.retention_in_days;
      if (typeof days !== "number" || days <= 0 || days > 30) {
        problems.push(`${rc.address}: log group needs a retention of 1-30 days (C-12)`);
      }
    }
    if (rc.type === "aws_lambda_function" && after.vpc_config && Array.isArray(after.vpc_config) && after.vpc_config.length > 0) {
      problems.push(`${rc.address}: Lambda in a VPC needs NAT or endpoints (fixed cost)`);
    }
    if (rc.type === "aws_ssm_parameter" && after.tier && after.tier !== "Standard") {
      problems.push(`${rc.address}: SSM parameter must be Standard tier (Advanced is $0.05/month)`);
    }
  }

  return { ok: problems.length === 0, problems };
}
