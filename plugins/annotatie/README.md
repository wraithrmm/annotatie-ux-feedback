# Annotatie plugin for Claude Code

One install gives an agent the Annotatie connector, its skills, and the rules for asking the reviewer.

## Install

```text
/plugin marketplace add wraithrmm/annotatie-ux-feedback
/plugin install annotatie@annotatie
/mcp                      sign in to "annotatie" as yourself
/annotatie:respond        in the session that answers reports (or /annotatie:respond 5m)
/annotatie:install        in a site's repository, to put the widget on it
/annotatie:liaison 5m     in the session that orchestrates other agents
```

The repository is private: Claude Code clones it with your own git credentials (an SSH key in your agent, or
`gh auth login` then `gh auth setup-git`). Turn on auto-update for the marketplace in `/plugin`, or run
`/plugin marketplace update annotatie`.

## Cloud sessions (web, phone, scheduled)

`/plugin` is not available in cloud sessions. Instead, this repository's `.claude/settings.json` adds the
marketplace and enables `annotatie@annotatie`, so every new cloud session on this repository loads the plugin
at startup. To get the same in another repository's sessions, copy that file into it.

A cloud session can't complete the connector's OAuth sign-in by itself, and a scheduled session has no one at
the keyboard to do it. If the connector shows as needing authentication there, also add
`https://annotatie.consulteasy.co.uk/mcp` as a custom connector at claude.ai/customize/connectors. That
connector's tools are named `mcp__annotatie__<tool>` rather than `mcp__plugin_annotatie_annotatie__<tool>`.

## What's in it

| Part | What it does |
|---|---|
| `.mcp.json` | The connector: `https://annotatie.consulteasy.co.uk/mcp`, signed in through `/mcp` (OAuth). Tools appear as `mcp__plugin_annotatie_annotatie__<tool>` |
| `skills/using-annotatie` | The rules for any Annotatie work, and which tool does what |
| `skills/ask-the-reviewer` | How every question to a person is asked, waited on and resumed |
| `skills/triage-reports` | Working a user's report: capture first, then answer, fix or ask |
| `skills/chat-liaison` | The liaison role and its status loop |
| `skills/report-responder` | The loop that picks up new reports, users' follow-ups and rejected drafts, and answers each |
| `skills/install-sdk` | Puts the widget on the site in the current repository: site, key, token route, tag, CSP, tests |
| `/annotatie:respond [interval]` | Starts the report responder |
| `/annotatie:install [origin]` | Installs the widget on this repository's site |
| `/annotatie:status` | One status tick |
| `/annotatie:liaison [interval]` | Starts the liaison loop |
| `hooks/session-start.mjs` | Puts the mandatory rules into context at the start of every session |
| `hooks/ask-gate.mjs` | Refuses the `AskUserQuestion` dialog and sends the agent to `ask_reviewer` |

## Turning the question gate off

When you are at the keyboard and want the normal dialog: set `ANNOTATIE_LOCAL_QUESTIONS=1`, or create
`.annotatie/local-questions` in the project (`.annotatie/` is git-ignored).

## Hooks need Node

The hooks run `node` (22 or later). Nothing is installed: they use only Node's own modules.

## Checking it

```bash
npm test -- tools/plugin-check
claude plugin validate --strict .
claude plugin validate --strict plugins/annotatie
```

The design is `docs/agent-plugin-design.md`. The connector's tools work once phase P5 is deployed.
