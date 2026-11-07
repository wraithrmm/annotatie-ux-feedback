---
name: install-sdk
description: Use when the Annotatie widget is to be put on a website — "/annotatie:install", "install Annotatie", "add the feedback widget to this site", "set up the SDK", "connect this app to Annotatie", "let our users report bugs on the site". Covers finding or creating the site in Annotatie, the site key (private half only in the host's secret store), the host's token route, the script tag for permitted users, CSP, and checking it works. Works from inside the host site's own repository.
---

# Install the Annotatie widget on a site

You are in the host site's repository. The end state: signed-in users the site permits see the widget and can
report; everyone else's pages carry no trace of Annotatie. Do it all yourself; the person only confirms the
facts in step 1 and signs the connector in once.

Load `using-annotatie` first. If the annotatie tools aren't there, the connector isn't signed in: tell the
person to run `/mcp`, sign in to **annotatie**, and leave **"Set up sites"** ticked on the consent screen.

## 1. Understand the host (read, don't ask)

Find from the code: the framework and language; how users sign in and where the current user comes from on
the server; where secrets live (`.env` plus the deploy's secret store, a secrets manager, platform variables);
the main layout or template; whether it sends a Content-Security-Policy; the production origin and any staging
origin (config, deploy files, README).

Then confirm in **one** `ask_reviewer` question (or one question in your reply if the question gate is off):
the origin(s) to allow, **who may report** (default: every signed-in user; or staff only, or a role), and the
site's display name. Offer your findings as the recommended option.

## 2. The site in Annotatie

1. `list_sites`: if a site already allows this origin, use it. Otherwise `create_site` with the name and
   origin(s). Add a later origin (staging, local) with `add_site_origin`.
2. A "lacks the sites scope" error means the connection was made without **Set up sites**. Tell the person to
   remove the agent under More › Agents and tokens in the portal, run `/mcp` again and leave it ticked.

## 3. The site key — the private half never leaves the host

1. Generate an Ed25519 key on this machine **by running code**, never by writing key material yourself. With
   the Node SDK (step 4): a short script that calls `generateSiteKey()`, writes the private PEM straight into
   the untracked secrets file as one line, base64 of the PEM (for example `.env` as
   `ANNOTATIE_SITE_KEY=<base64>`; the route decodes it), and prints only `kid` and `publicKeyJwk`. The portal's
   How-to guide (`/board/#/guide`) has the exact command. Other stacks: the standard library (PHP
   `sodium_crypto_sign_keypair`, Python `cryptography`'s Ed25519, Go `crypto/ed25519`); the kid is the RFC 7638
   thumbprint, or any id of letters, digits, `.`, `_` and `-`.
2. Make sure the secrets file is git-ignored (`git check-ignore`). If it isn't, stop and fix that first.
3. `add_site_key` with the site, kid and **public** JWK (`kty`, `crv`, `x` only; the tool refuses `d`).
4. Tell the person the production secret must be set in the deploy's secret store: give the exact variable
   name, never the value. Never print, log, commit or pass the private key to a tool.

## 4. The code

`get_install_kit` for the site gives the script tag, the token route contract and the Node SDK's URL.

**Node hosts.** Download `<annotatie_base>/sdk/v1/annotatie-node.mjs` into the repository (for example
`lib/annotatie/annotatie-node.mjs`): one file, `node:crypto` only, no dependencies. Then:

- **The token route**, `GET /annotatie/token`, behind the host's own sign-in. Plain Node:
  `createTokenHandler({ siteId, kid, privateKey: Buffer.from(process.env.ANNOTATIE_SITE_KEY, "base64").toString(), getUser })`. Express, Next,
  Fastify and the like: call `signAssertion` then `exchange`, and return `{ access_token, expires_in }` with
  `Cache-Control: no-store`. `getUser` returns `{ id, name, email? }` for people who may report and `null` for
  everyone else (403).
- **The tag**, emitted on the server only for permitted users: `annotatieTag({ siteId })` or the kit's
  `script_tag`. A single-page app whose session is a bearer token rather than a cookie bundles the widget
  (`start({ siteId, getToken })`) with a `getToken` that calls its own server route.

**Other stacks** (PHP/Laravel, Python, Ruby, Go and so on): implement the kit's `host_token_route.how` with the
language's own crypto and HTTP client (a 60-second EdDSA JWS with the listed claims, POSTed as a
`jwt-bearer` grant), and print the kit's script tag in the main layout for permitted users only.

**CSP:** if the host sends one, add the kit's origins to `script-src`, `connect-src` and `img-src` exactly as
its `rules` say. Nothing else: the widget draws inside a closed shadow root.

Configuration by environment variables: `ANNOTATIE_SITE_ID`, `ANNOTATIE_SITE_KID`, `ANNOTATIE_SITE_KEY`. The
site id and kid are not secret and may be committed as defaults; the key never is.

## 5. Prove it

1. A test for the token route: a permitted user gets 200 with a token (mock the exchange); anonymous or
   not-permitted users get 401/403; no response ever contains the key.
2. A test or check that the tag is absent for users who may not report.
3. Run the host locally if you can: sign in, open a page, see the widget's button. If the local origin isn't
   allowed, add it with `add_site_origin` and say so.
4. Report: site id, origins, files changed, the secret's variable name to set in production, and how to turn
   it off (remove the tag and route, or retire the key in the portal's site settings).

## Never

- Never put the private key in a committed file, a log, a tool call, a message or your reply.
- Never show the tag to anonymous visitors or to users the person didn't permit.
- Never loosen the host's CSP beyond the kit's origins, or its sign-in, to make the widget work.
