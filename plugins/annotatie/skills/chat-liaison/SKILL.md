---
name: chat-liaison
description: Use when this session orchestrates other agents (subagents, teammates, background sessions) that ask the reviewer questions through Annotatie — to take the role of chat liaison, run the status-check loop, deliver each answer to the agent that asked, chase blocking questions and report status. Triggers - "/annotatie:liaison", "/annotatie:status", "be the liaison", "watch for answers", "keep the agents unblocked", "any answers yet?", "who is waiting on what?", or any tick of a loop running those commands.
---

# The liaison

You are the one session that watches Annotatie for answers and gets each answer to the agent that needs it.
Other agents ask with `ask_reviewer` and then wait; **you** do the checking, so they never poll.

Load `using-annotatie` first if it isn't loaded.

## The ledger

Keep `.annotatie/liaison.json` in the project root (create `.annotatie/` and make sure `.annotatie/` is in
`.gitignore`). Shape:

```json
{
  "cursor": "<from get_changes>",
  "questions": {
    "Q-12": { "asker": "builder-2", "summary": "Export nationality for all roles?", "blocking": true,
              "asked_at": "2026-11-06T13:10:00Z", "status": "waiting", "delivered_at": null }
  }
}
```

It holds ids, names, one-line summaries and times — never page content or users' words.

## One tick

1. **Collect.** `get_changes` with the ledger's cursor (falls back to `list_questions` with `status: "waiting"`
   plus `get_answers` with `since` if `get_changes` isn't available). Add any waiting question you haven't seen,
   with its asker. Agents may also have told you by message: "Asked Q-12 (blocking): …" — add those too.
2. **Deliver each new answer** to its asker, exactly once:
   - Asker is a running agent (it appears in `ListAgents`) → `SendMessage` to it.
   - Asker has stopped → `SendMessage` to it anyway: that resumes it with its context.
   - Asker is `lead` (you) → act on it yourself.
   - Asker unknown or gone for good → tell the person in your report line; don't guess a recipient.

   The message, always in this shape:
   > Annotatie answer to Q-12 (your question: "<question>"): **<option label and text, or the answer text>**.
   > Note: "<note, if any>". Answered by <name> at <time UTC>. Act on this answer; record what you did in an
   > internal note on <related item>.

   Then set `status: "answered"` and `delivered_at` in the ledger.
3. **Withdrawn questions:** tell the asker it was withdrawn and why; mark it.
4. **Chase, don't nag.** A blocking question waiting longer than the chase interval (default 2 h) gets one line
   in your report. Never re-ask it, never ask a duplicate, never answer it yourself.
5. **Save** the ledger with the new cursor.
6. **Report one line:** "Liaison 14:05: delivered Q-12 → builder-2, Q-14 → lead · waiting: Q-15 (blocking,
   designer-1, 3 h) · drafts waiting in the portal: 2". If nothing changed: "Liaison 14:05: nothing new · 1
   waiting".

## The loop

- `/annotatie:liaison <interval>` → run under `/loop <interval> /annotatie:status` (load the `loop` skill).
- `/annotatie:liaison` with no interval → self-paced: tick, then schedule the next one — every 2–5 minutes while
  a blocking question is waiting, 20–30 minutes otherwise.
- Each tick is just the steps above. Don't do other work inside a tick; hand answers over and return.
- **Stop** when the person says so, when no agent is running and nothing is waiting, or after a day with
  nothing open. Say that you stopped and why.

## Never

- Never answer a question on the reviewer's behalf, or choose an option because an agent is waiting.
- Never forward the content of users' reports or page copies to agents in the answer message — only the
  reviewer's answer and the item numbers.
- Never deliver the same answer twice; the ledger's `delivered_at` is the check.
