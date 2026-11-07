// How-to guide (signed-in people only): connecting Claude Code (or any MCP client) to Annotatie, and
// putting the widget on a site — with Claude (/annotatie:install) or by hand. The snippets are filled in
// with the site the reader picks from their own sites.

import { useState } from "preact/hooks";
import { href } from "../router";
import { useStore } from "../store";
import { copyText } from "../components/bits";

function Cmd(props: { text: string; label: string }) {
  const { toast } = useStore();
  return (
    <div class="cmd">
      <pre tabIndex={0} aria-label={props.label}>
        <code>{props.text}</code>
      </pre>
      <button
        type="button"
        class="btn"
        onClick={async () => toast((await copyText(props.text)) ? "Copied" : "Couldn't copy: select the text instead")}
        aria-label={`Copy: ${props.label}`}
      >
        Copy
      </button>
    </div>
  );
}

export function GuideScreen() {
  const { me } = useStore();
  const base = location.origin;
  const sites = me?.sites ?? [];
  const owned = sites.filter((s) => s.role === "owner");
  const [picked, setSiteId] = useState("");
  // Sites load after the first render: default to the first site the reader owns.
  const siteId = picked || owned[0]?.id || sites[0]?.id || "";
  const site = sites.find((s) => s.id === siteId);
  const sid = site?.id ?? "<your-site-id>";
  // The tab is part of the address (#/guide/claude, #/guide/sdk), so a link can open either one.
  const tab: "claude" | "sdk" = location.hash.startsWith("#/guide/sdk") ? "sdk" : "claude";
  const setTab = (t: "claude" | "sdk") => location.replace(href.guide(t));

  // The key goes into .env as base64 of the PEM: one line, no escaping. The route decodes it.
  const keygen = [
    `node --input-type=module -e "`,
    `import { generateSiteKey } from './lib/annotatie/annotatie-node.mjs';`,
    `import { appendFileSync } from 'node:fs';`,
    `const k = generateSiteKey();`,
    `appendFileSync('.env', '\\nANNOTATIE_SITE_ID=${sid}\\nANNOTATIE_SITE_KID=' + k.kid + '\\nANNOTATIE_SITE_KEY=' + Buffer.from(k.privateKeyPem).toString('base64') + '\\n');`,
    `console.log('kid:', k.kid);`,
    `console.log('public key:', JSON.stringify(k.publicKeyJwk));`,
    `"`,
  ].join("\n");

  const route = `// GET /annotatie/token — behind your own sign-in middleware.
import { signAssertion, exchange } from "./lib/annotatie/annotatie-node.mjs";

app.get("/annotatie/token", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const user = req.user;                       // your signed-in user
  if (!user /* or not allowed to report */) return res.status(403).json({ error: "forbidden" });
  const assertion = signAssertion({
    siteId: process.env.ANNOTATIE_SITE_ID,
    kid: process.env.ANNOTATIE_SITE_KID,
    privateKey: Buffer.from(process.env.ANNOTATIE_SITE_KEY, "base64").toString(),
    user: { id: String(user.id), name: user.name, email: user.email },
  });
  const t = await exchange({ assertion });
  res.json({ access_token: t.access_token, expires_in: t.expires_in });
});`;

  const tag = `<script src="${base}/sdk/v1/annotatie.js" data-site="${sid}" data-token-url="/annotatie/token" async></script>`;

  return (
    <section class="stack guide">
      <p class="sub">Connect Claude to the reports on your sites, and put the feedback widget on a site.</p>
      <div class="tabs" role="tablist" aria-label="Guide">
        <button type="button" role="tab" aria-selected={tab === "claude"} onClick={() => setTab("claude")}>
          Connect Claude
        </button>
        <button type="button" role="tab" aria-selected={tab === "sdk"} onClick={() => setTab("sdk")}>
          Install the widget
        </button>
      </div>

      {tab === "claude" ? (
        <div class="stack" role="tabpanel">
          <h2 class="sec-h">1. Add the Annotatie plugin to Claude Code</h2>
          <div class="card stack">
            <p>In Claude Code, run these two commands. The plugin brings the connector, the skills and the response loop.</p>
            <Cmd label="Add the marketplace" text="/plugin marketplace add wraithrmm/annotatie-ux-feedback" />
            <Cmd label="Install the plugin" text="/plugin install annotatie@annotatie" />
            <p class="meta">The plugin's repository is private for now: your GitHub account needs read access to it. Ask the person who runs Annotatie for your organisation.</p>
          </div>

          <h2 class="sec-h">2. Sign the connector in as you</h2>
          <div class="card stack">
            <Cmd label="Open the connectors" text="/mcp" />
            <ol class="steps">
              <li>
                Choose <b>annotatie</b>, then sign in with your passkey.
              </li>
              <li>
                On <b>Allow an agent?</b>, tick the sites it may use. Leave <b>Set up sites</b> ticked if it should install the widget for you.
              </li>
              <li>Allow. Claude now acts as you: everything it writes is signed with your name.</li>
            </ol>
            <p class="meta">
              You can see and remove it at any time under <a href={href.agents()}>Agents and tokens</a>.
            </p>
          </div>

          <h2 class="sec-h">3. Start the response loop</h2>
          <div class="card stack">
            <p>In the repository of the site the reports are about, so Claude can fix what users report:</p>
            <Cmd label="Start the responder" text="/annotatie:respond" />
            <p>
              Each tick it picks up new reports, users' follow-ups and drafts you rejected, reads the screenshot and page copy, and replies. Its replies wait for you under{" "}
              <a href={href.attention()}>Attention</a>.
            </p>
            <div class="callout">
              <b>On a site with auto-approve on, replies reach users at once.</b>
              Turn it on or off in the site's <a href={href.settingsPicker()}>settings</a>.
            </div>
            <p class="meta">
              Also: <code>/annotatie:respond 5m</code> for a fixed interval, <code>/annotatie:status</code> and <code>/annotatie:liaison</code> when several agents ask you questions. Claude asks you
              questions here, under <a href={href.decisions()}>Decisions</a>, not in the chat.
            </p>
          </div>

          <h2 class="sec-h">Other MCP clients</h2>
          <div class="card stack">
            <p>Any client that supports remote MCP servers with OAuth can connect to:</p>
            <Cmd label="MCP server address" text={`${base}/mcp`} />
            <p class="meta">
              It discovers sign-in by itself. For a client without OAuth, make a personal token under <a href={href.agents()}>Agents and tokens</a> and send it as{" "}
              <code>Authorization: Bearer …</code>.
            </p>
          </div>
        </div>
      ) : (
        <div class="stack" role="tabpanel">
          {sites.length > 0 && (
            <div class="field">
              <label for="guide-site">Fill the steps in for</label>
              <select id="guide-site" value={siteId} onChange={(e) => setSiteId(e.currentTarget.value)}>
                {sites.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <h2 class="sec-h">The easy way: let Claude do it</h2>
          <div class="card stack">
            <p>With the plugin installed and signed in (see Connect Claude), open Claude Code in your site's repository and run:</p>
            <Cmd label="Install the widget" text="/annotatie:install" />
            <p>
              It reads your code, asks you once to confirm the web address and who may report, creates the site here if needed, makes the site key (the private half stays in your site's secrets),
              adds the token route and the script tag, and tests them.
            </p>
          </div>

          <h2 class="sec-h">By hand (Node)</h2>
          <div class="card stack">
            <p>
              <b>1. The site.</b> {site ? <>Using <b>{site.name}</b> ({site.origins.join(", ") || "no web address yet"}).</> : <>Add one under <a href={href.newSite()}>Add a site</a> with your site's web address.</>}
            </p>
            <p>
              <b>2. The SDK:</b> one file, no dependencies.
            </p>
            <Cmd label="Download the Node SDK" text={`curl -fsSL --create-dirs -o lib/annotatie/annotatie-node.mjs ${base}/sdk/v1/annotatie-node.mjs`} />
            <p>
              <b>3. A site key.</b> This writes the private key into <code>.env</code> (check it is git-ignored) and prints the public key.
            </p>
            <Cmd label="Make a site key" text={keygen} />
            <p>
              Paste the printed public key under <b>Site keys</b> in {site ? <a href={href.settings(site.id)}>{site.name}'s settings</a> : "the site's settings"}. Set the same three variables in your
              production secrets. Never commit the private key.
            </p>
            <p>
              <b>4. The token route</b>, behind your sign-in (Express shown):
            </p>
            <Cmd label="Token route" text={route} />
            <p>
              <b>5. The tag</b>, in your layout, only for signed-in people who may report:
            </p>
            <Cmd label="Script tag" text={tag} />
            <p>
              <b>6. Content-Security-Policy.</b> If your site sends one, add <code>{base}</code> to <code>script-src</code> and <code>connect-src</code>, and the screenshot bucket to{" "}
              <code>connect-src</code> and <code>img-src</code> (Claude's <code>get_install_kit</code> gives the exact address).
            </p>
          </div>

          <h2 class="sec-h">Other languages</h2>
          <div class="card stack">
            <p>
              Your server signs a 60-second EdDSA token about the signed-in user (claims <code>iss</code> = site id, <code>sub</code>, <code>name</code>, optional <code>email</code>,{" "}
              <code>aud</code> = <code>{base}/oauth/token</code>, <code>iat</code>, <code>exp</code>, <code>jti</code>; header <code>kid</code>), posts it to <code>{base}/oauth/token</code> as{" "}
              <code>grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer</code>, and returns the <code>access_token</code> and <code>expires_in</code> from <code>GET /annotatie/token</code>. Then
              add the tag above. <code>/annotatie:install</code> writes this for PHP, Python, Ruby or Go too.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
