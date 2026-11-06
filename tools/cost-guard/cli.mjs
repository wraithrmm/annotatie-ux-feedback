#!/usr/bin/env node
// Usage: tofu show -json tfplan > plan.json && node tools/cost-guard/cli.mjs plan.json [--allow aws_kms_key ...]
import { readFileSync } from "node:fs";
import { checkPlan } from "./guard.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
/** @type {string[]} */
const allow = [];
args.forEach((a, i) => {
  const next = args[i + 1];
  if (a === "--allow" && next) allow.push(next);
});

if (!file) {
  console.error("usage: cost-guard <plan.json> [--allow <resource_type>]...");
  process.exit(2);
}

const result = checkPlan(JSON.parse(readFileSync(file, "utf8")), { allow });
if (result.ok) {
  console.log("cost-guard: no fixed-cost resources in this plan.");
} else {
  console.error("cost-guard: this plan adds cost that isn't on demand:");
  for (const p of result.problems) console.error(`  - ${p}`);
  console.error("Agree it first and record it in docs/cost-register.md, then pass --allow <type>.");
  process.exit(1);
}
