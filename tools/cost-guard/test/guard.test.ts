import { describe, expect, it } from "vitest";
import { checkPlan } from "../guard.mjs";

const rc = (type: string, after: Record<string, unknown> = {}, actions = ["create"]) => ({
  address: `${type}.this`,
  type,
  change: { actions, after },
});

describe("cost guard", () => {
  it("passes an on-demand plan", () => {
    const res = checkPlan({
      resource_changes: [
        rc("aws_lambda_function", { vpc_config: [] }),
        rc("aws_apigatewayv2_api"),
        rc("aws_s3_bucket"),
        rc("aws_cloudfront_distribution"),
        rc("aws_cloudwatch_log_group", { retention_in_days: 14 }),
        rc("aws_dynamodb_table", { billing_mode: "PAY_PER_REQUEST" }),
        rc("aws_ssm_parameter", { tier: "Standard" }),
      ],
    });
    expect(res).toEqual({ ok: true, problems: [] });
  });

  it("fails each fixed-cost resource type", () => {
    const res = checkPlan({
      resource_changes: [rc("aws_kms_key"), rc("aws_nat_gateway"), rc("aws_wafv2_web_acl")],
    });
    expect(res.ok).toBe(false);
    expect(res.problems).toHaveLength(3);
    expect(res.problems[0]).toContain("$1/month");
  });

  it("allows a fixed-cost type only when named", () => {
    const res = checkPlan({ resource_changes: [rc("aws_kms_key")] }, { allow: ["aws_kms_key"] });
    expect(res.ok).toBe(true);
  });

  it("ignores deletes and no-ops", () => {
    const res = checkPlan({
      resource_changes: [rc("aws_kms_key", {}, ["delete"]), rc("aws_nat_gateway", {}, ["no-op"])],
    });
    expect(res.ok).toBe(true);
  });

  it("catches provisioned DynamoDB, endless logs, VPC Lambdas and advanced SSM", () => {
    const res = checkPlan({
      resource_changes: [
        rc("aws_dynamodb_table", { billing_mode: "PROVISIONED" }),
        rc("aws_cloudwatch_log_group", { retention_in_days: 0 }),
        rc("aws_lambda_function", { vpc_config: [{ subnet_ids: ["s"] }] }),
        rc("aws_ssm_parameter", { tier: "Advanced" }),
      ],
    });
    expect(res.problems).toHaveLength(4);
  });
});
