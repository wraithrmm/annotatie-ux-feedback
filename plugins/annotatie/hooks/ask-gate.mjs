#!/usr/bin/env node
// PreToolUse on AskUserQuestion: refuse the dialog and send the agent to ask_reviewer,
// unless the person has turned the gate off for this project or environment.
import { DENY_REASON, localQuestionsAllowed, readInput } from "./lib.mjs";

const input = readInput();

if (input.tool_name && input.tool_name !== "AskUserQuestion") process.exit(0);
if (localQuestionsAllowed(input)) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: DENY_REASON,
    },
  }),
);
