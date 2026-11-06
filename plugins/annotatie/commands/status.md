---
description: One Annotatie status check - new answers delivered to the agents that asked, questions still waiting, drafts waiting for the reviewer.
argument-hint: "[site]"
---

Run **one tick** of the Annotatie liaison now. Load the `annotatie:chat-liaison` skill and follow its "One tick"
section exactly: collect with `get_changes` from the ledger's cursor, deliver each new answer to its asker once,
note withdrawn questions, flag blocking questions past the chase interval, save `.annotatie/liaison.json`, and
report one line.

Limit to site `$ARGUMENTS` if one is given; otherwise all sites the connector can see.

Do nothing else in this turn: no other work, no questions of your own.
