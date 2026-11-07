---
description: Start (or run one tick of) the Annotatie report responder — pick up new reports, users' follow-ups and rejected drafts, and answer each one.
argument-hint: "[interval e.g. 5m | tick | site id] — omit to self-pace"
---

Load the `annotatie:report-responder` skill and follow it.

- `$ARGUMENTS` is `tick`: run **one tick** exactly as the skill's "One tick" section says, report one line, and
  do nothing else this turn.
- `$ARGUMENTS` is an interval (`5m`, `15m`): run one tick now, then `/loop $ARGUMENTS /annotatie:respond tick`.
- `$ARGUMENTS` is a site id: cover only that site (store it in the ledger's `sites`), then self-pace.
- No argument: run one tick now, then self-pace as the skill says.

After starting the loop, tell the person in one line: the responder is on, which sites, the pacing, whether
auto-approve is on for those sites (replies then reach users at once), and how to stop it ("stop the responder").
