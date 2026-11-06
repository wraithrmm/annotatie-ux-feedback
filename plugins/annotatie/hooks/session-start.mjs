#!/usr/bin/env node
// SessionStart: put the plugin's mandatory rules into context before the agent does anything.
import { GUIDANCE, LOCAL_NOTE, localQuestionsAllowed, readInput } from "./lib.mjs";

const input = readInput();

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: localQuestionsAllowed(input) ? LOCAL_NOTE : GUIDANCE,
    },
  }),
);
