---
name: triage-reports
description: Use when working through feedback reports from a site's users in Annotatie — "triage the reports", "what's open", "answer the new reports", "look at report 41", "fix what users reported", "draft replies" — or when a report's screenshot, page copy or part needs reading. Covers reading the capture, deciding to answer, fix or ask, and writing the internal note and the draft reply.
---

# Triage reports

Load `using-annotatie` first if it isn't loaded. Its rules apply throughout.

## 1. Find the work

`list_items` with `kind: "report"` and `status: "open"` (and `"answered"` where the user has replied since),
newest first. For a single report, `get_item`.

## 2. See what the user saw — before reading theories

1. `get_screenshot` with `view: "closeup"`: the part they chose, outlined.
2. `get_item`'s `capture.part`: the selector, role, name, text and box. Often enough on its own.
3. `get_page_html` with `scope: "part"`, then `"around"` if the bug is in the surroundings (a list, a form).
   Use `selector` to look up a related element. Ask for `"page"` only when you must.
4. `get_screenshot` with `view: "page"` if position or layout matters.

The capture method matters: "drawn by the browser" can miss video, maps and images from other sites. A blank
area there is not the bug.

## 3. Decide

| The report is | Do |
|---|---|
| A question you can answer from the product or the code | Draft the answer |
| A bug you can reproduce and fix in scope | Fix it by the repo's own rules, then note the commit and where it's deployed |
| A feature request or anything needing a decision | Ask the reviewer (`ask-the-reviewer`), link the report |
| Unclear | Draft a reply asking the user one specific question — it's a draft, the reviewer approves it |
| Not something to act on | Internal note saying why; leave the status for the reviewer |

## 4. Write

- **Internal note first** (`visibility: "internal"`): what you saw in the capture, the cause, the fix or the
  question number, commit and deployment.
- **Then the reply** (`visibility: "user"`): plain words, what changed and where they'll see it, or the one
  thing you need from them. No promises of dates. Never mention being an AI. It is signed by the reviewer. It
  waits as a draft for the reviewer, **unless the site has auto-approve on (`list_sites`), when it reaches the
  user at once**: then write only what you would send unchecked, and ask the reviewer when in doubt.
- **Status:** `in_progress` while you fix. When the reply tells the user the problem is fixed (deployed where
  they can see it) or their question is fully answered, post it with **`resolves: true`**: the report becomes
  `resolved` when the reply is published (at once with auto-approve, otherwise when the reviewer approves it).
  End that reply by telling them they can close the report if it's sorted for them, or reply if it isn't.
  Never set `closed`: closing is the reporter's confirmation (from the widget), or the team's call. A reply that
  only asks a question or says work is under way doesn't resolve. "Fixed" means deployed where the user can
  see it.

## 5. Report back

One line per report: "41: fixed (4be1c0a, staging), draft waiting · 44: asked Q-12 (blocking) · 45: draft
asks for the browser". Nothing else is needed: the reviewer sees the details in the portal.
