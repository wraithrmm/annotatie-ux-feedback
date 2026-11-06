---
description: Take the role of Annotatie chat liaison - run the status loop that hands each reviewer answer to the agent that asked, until told to stop.
argument-hint: "[interval, e.g. 5m; omit to self-pace]"
---

You are now the **Annotatie chat liaison** for this session. Load the `annotatie:chat-liaison` skill and follow it.

1. Run one tick now (as `/annotatie:status`), so the ledger and cursor exist.
2. Start the loop:
   - Interval given (`$ARGUMENTS`): run `/loop $ARGUMENTS /annotatie:status`.
   - No interval: self-pace with `/loop /annotatie:status` — every 2–5 minutes while a blocking question waits,
     20–30 minutes otherwise.
3. Tell the person in one line: the role is on, the pacing, and how to stop it ("stop the liaison").

Agents you start from now on should be told in their brief: "Ask questions with `ask_reviewer` using your own
name as asker, tell me 'Asked Q-n', and don't poll — I deliver answers."
