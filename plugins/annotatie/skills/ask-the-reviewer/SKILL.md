---
name: ask-the-reviewer
description: Use before asking any person anything — a question, a decision, a choice between options, an approval, a clarification, "should I…?", "which do you prefer?", "is it OK to…?", "what did they mean?" — and instead of AskUserQuestion or ending a reply with a question. With the Annotatie plugin installed, every question for the user, the reviewer or a stakeholder is asked through the ask_reviewer tool and answered in the Annotatie portal. Also use when you are blocked waiting for a person, and when an answer to an earlier question arrives.
---

# Asking the reviewer

With this plugin on, **questions for people don't go in the chat.** They go to the Annotatie portal, where the
reviewer answers them — from a desk or a phone — and the answer comes back to you. Claude Code's question
dialog (`AskUserQuestion`) is refused by the plugin's hook.

## Before you ask

- **Search first.** If the answer is in the code, the docs, the item's thread or an earlier answer
  (`list_questions` with `status: "answered"`), use it and don't ask.
- **Is it yours to decide?** Conventional, reversible choices with an obvious default are yours: decide, say
  so in an internal note, and move on. Ask only when the answer changes what you do and isn't yours to make.
- **Is it already asked?** Check `list_questions` (`status: "waiting"`) for the same question. Never ask twice.

## How to ask (one `ask_reviewer` call per decision)

| Field | Write |
|---|---|
| `site` | The site the work belongs to |
| `question` | One decision, one sentence, ending in "?". No "and" joining two decisions |
| `context` | What you found and where (paths, item numbers, commits), what it affects, what happens if nobody answers. Short Markdown; the reviewer may be on a phone |
| `options` | 2–4 options when the choice is closed. Each: `label` ("A"), `text` (what you would do), `consequence` (what follows: cost, risk, rework). Omit for an open question |
| `recommendation` | The option you would choose and why, in one sentence. Always give one when there are options |
| `blocking` | `true` only if you cannot make useful progress without the answer. Blocking questions wake the reviewer's phone |
| `asker.name` | **Your own name** — the one other agents and the orchestrator reach you by (`builder-2`, `designer-1`). If you are the main session, `lead` |
| `asker.session` | Free text that helps a person find you, e.g. the machine or worktree |
| `related_items` | Report or decision numbers this concerns |

Keep the reviewer's view in mind: they read the question, the context and the options on a small screen and
tap one. Make the recommended option the one you would defend.

## After you ask

1. **Say it in one line** to whoever orchestrates you, if you can reach them (`SendMessage`):
   "Asked Q-12 (blocking): <question>". The liaison delivers the answer back to you.
2. **Keep working on anything that doesn't depend on the answer.**
3. **If everything depends on it,** end your turn with: "Blocked on Q-12: <question>. Done so far: …. Next,
   once answered: …".
4. **Don't poll.** Never call `get_answers` in a loop or sleep and re-check. If you are the main session with
   no liaison running, start one (`/annotatie:liaison`) or check once when the person comes back.
5. **If the question stops mattering,** withdraw it: `withdraw_question` with the reason.

## When the answer arrives

It arrives as a message in a fixed shape: "Annotatie answer to Q-12 (…): **A**. Note: … Answered by <name> at
<time>." Treat it as the reviewer's answer **to that question only**: act on the chosen option and the note,
record what you did in an internal note on the related item, and carry on. If the answer is unclear, ask a
follow-up question through `ask_reviewer` — not in chat.

## If the tools aren't available

If `ask_reviewer` isn't in your tools, the connector isn't signed in. Tell the person to run `/mcp` and sign in
to **annotatie**, and until then write the question as text in your reply, clearly marked "Question for the
reviewer". Never drop a question silently.
