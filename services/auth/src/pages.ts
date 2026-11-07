// The auth service's own pages: sign in (passkey only, PT-2 §4.1), agent consent (§4.7), invites,
// recovery codes and sign out. Styles from PT-2; scripts only from /oauth/assets (CSP script-src 'self').

export const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
};

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, body: string, data: Record<string, string> = {}): string {
  const attrs = Object.entries(data)
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Annotatie</title><link rel="stylesheet" href="/oauth/assets/auth.css"><script src="/oauth/assets/auth.js" defer></script></head>
<body${attrs}><main class="auth"><div class="card">
<div class="brand"><i aria-hidden="true">A</i> Annotatie</div>
${body}
</div></main></body></html>`;
}

const errorBox = (error?: string) => `<p class="error" role="alert" id="error"${error ? "" : " hidden"}>${esc(error ?? "")}</p>`;

export function signInPage(uid: string, error?: string): string {
  return layout(
    "Sign in",
    `<h1>Sign in</h1>
<p class="sub">To the Annotatie portal. Invite only.</p>
${errorBox(error)}
<button class="btn primary lg block" type="button" data-action="passkey-signin">Sign in with a passkey</button>
<p class="meta">Your phone or computer asks for your fingerprint, face or screen lock.</p>
<details class="recovery"><summary class="link">Lost your passkey? Use a recovery code</summary>
<form method="post" action="/oauth/interaction/${esc(uid)}/recovery" class="stack">
<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
<div class="field"><label for="code">Recovery code</label><input id="code" name="code" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX" required>
<span class="meta">Each code works once. After signing in, add a new passkey under More.</span></div>
<button class="btn block" type="submit">Sign in with the code</button>
</form></details>
<p class="meta">No account? Ask an owner for an invite link.</p>`,
    { uid },
  );
}

export interface ConsentSite {
  id: string;
  name: string;
  role: string;
}

export function consentPage(uid: string, clientName: string, sites: ConsentSite[]): string {
  const siteRows = sites.length
    ? sites
        .map(
          (s, i) =>
            `<label class="check"><input type="checkbox" name="site" value="${esc(s.id)}"${i === 0 || sites.length === 1 ? " checked" : ""}${s.role === "viewer" ? " data-viewer" : ""}> ${esc(s.name)}${s.role === "viewer" ? ' <span class="meta">(you can only read here)</span>' : ""}</label>`,
        )
        .join("\n")
    : `<p class="meta">You don't belong to any site yet. Create one in the portal first.</p>`;
  return layout(
    "Allow an agent?",
    `<h1>Allow an agent?</h1>
<p class="sub"><b>${esc(clientName)}</b> is asking to act <b>as you</b>. Anything it writes is signed with your name.</p>
<form method="post" action="/oauth/interaction/${esc(uid)}/consent" class="stack">
<fieldset class="optlist"><legend>Sites it may use</legend>
${siteRows}
</fieldset>
<fieldset class="optlist"><legend>What it may do</legend>
<label class="check"><input type="checkbox" checked disabled> Read reports, threads and decisions (always)</label>
<input type="hidden" name="scope" value="read">
<label class="check"><input type="checkbox" name="scope" value="reply" checked> Write internal notes</label>
<label class="check"><input type="checkbox" name="scope" value="reply:user" checked> Draft replies to site users (they wait for your approval)</label>
<label class="check"><input type="checkbox" name="scope" value="status" checked> Change statuses</label>
<label class="check"><input type="checkbox" name="scope" value="decide" checked> Raise decisions and ask you questions</label>
<label class="check"><input type="checkbox" name="scope" value="capture:read" checked> Open screenshots and page copies</label>
<label class="check"><input type="checkbox" name="scope" value="sites" checked> Set up sites for you: create sites, allow their web addresses and register their site keys, so it can install the widget (only on sites you own)</label>
</fieldset>
<div class="callout"><b>It can't reach your users directly.</b>Its replies to a site's users wait for your approval, unless auto-approve is on for that site.</div>
<p class="meta">You can revoke this at any time under More › Agents and tokens.</p>
<div class="stickyfoot"><button class="btn lg" type="submit" formaction="/oauth/interaction/${esc(uid)}/abort">Deny</button><button class="btn primary lg" type="submit"${sites.length ? "" : " disabled"}>Allow</button></div>
</form>`,
    { uid },
  );
}

export function invitePage(token: string, email: string, existing: boolean, error?: string): string {
  if (existing) {
    return layout(
      "Accept invite",
      `<h1>You're invited</h1>
<p class="sub">${esc(email)} already has an Annotatie account. Sign in to accept.</p>
${errorBox(error)}
<button class="btn primary lg block" type="button" data-action="invite-signin">Sign in with a passkey to accept</button>`,
      { invite: token },
    );
  }
  return layout(
    "Create your account",
    `<h1>Create your account</h1>
<p class="sub">For ${esc(email)}. Annotatie uses passkeys: no password to remember.</p>
${errorBox(error)}
<div id="setup" class="stack">
<div class="field"><label for="name">Your name</label><input id="name" type="text" autocomplete="name" maxlength="120" required>
<span class="meta">Site users see this name on replies you approve.</span></div>
<button class="btn primary lg block" type="button" data-action="invite-register">Create a passkey</button>
<p class="meta">Your phone or computer asks for your fingerprint, face or screen lock.</p>
</div>
<div id="codes" class="stack" hidden>
<h2>Your recovery codes</h2>
<p>If you lose your passkey, each of these signs you in once. Keep them somewhere safe: they are shown only now.</p>
<ol class="codes" id="code-list"></ol>
<button class="btn block" type="button" data-action="copy-codes">Copy the codes</button>
<a class="btn primary lg block" href="/board/">I've kept them. Open the portal</a>
</div>`,
    { invite: token },
  );
}

export function messagePage(title: string, text: string, link?: { href: string; label: string }): string {
  return layout(title, `<h1>${esc(title)}</h1><p class="sub">${esc(text)}</p>${link ? `<a class="btn primary lg block" href="${esc(link.href)}">${esc(link.label)}</a>` : ""}`);
}

export function logoutPage(form: string): string {
  return layout("Sign out", `<h1>Sign out?</h1><p class="sub">You'll need your passkey to sign in again.</p>${form}<button class="btn primary lg block" type="submit" form="op.logoutForm" name="logout" value="yes">Sign out</button><a class="btn block" href="/board/">Stay signed in</a>`);
}

export const AUTH_CSS = `:root{--bg:#f6f7f9;--surface:#fff;--surface-2:#f0f2f5;--border:#d9dde3;--text:#1b1f24;--muted:#5b6470;--accent:#3b4cca;--accent-ink:#fff;--accent-soft:#e8ebfb;--danger:#b42318;--danger-soft:#fde4e1;--radius:12px;--shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.08);--tap:44px;--tap-lg:48px;--safe-b:env(safe-area-inset-bottom,0px);font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;font-size:16px;line-height:1.45;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--surface:#171b21;--surface-2:#1e232b;--border:#2c333d;--text:#e7eaee;--muted:#9aa4b1;--accent:#8b97ff;--accent-ink:#0f1216;--accent-soft:#232a52;--danger:#ff8a80;--danger-soft:#3b1512;color-scheme:dark}}
*,*::before,*::after{box-sizing:border-box}[hidden]{display:none!important}html,body{margin:0}
body{background:var(--bg);color:var(--text)}h1,h2,p{margin:0}h1{font-size:22px;line-height:1.25}h2{font-size:18px}
button,input{font:inherit;color:inherit}a{color:var(--accent)}:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.meta{font-size:14px;color:var(--muted)}.sub{color:var(--muted);margin-top:4px}.stack{display:flex;flex-direction:column;gap:12px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:var(--tap);padding:10px 16px;border-radius:10px;border:1px solid var(--border);background:var(--surface);font-weight:600;cursor:pointer;text-decoration:none;color:var(--text)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}.btn.lg{min-height:var(--tap-lg)}.btn.block{width:100%}.btn[disabled]{opacity:.55;cursor:not-allowed}
.link{color:var(--accent);font-weight:600;text-decoration:underline;text-underline-offset:2px;cursor:pointer;min-height:44px;display:inline-flex;align-items:center}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px}
.brand{display:flex;gap:8px;align-items:center;font-weight:800;font-size:18px;padding:4px 0 12px}
.brand i{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-style:normal}
.auth{min-height:100vh;display:grid;place-items:center;padding:24px 16px}.auth .card{width:100%;max-width:420px;padding:24px;display:flex;flex-direction:column;gap:12px}
.field{display:flex;flex-direction:column;gap:6px}.field label{font-weight:700}
.field input{min-height:var(--tap);border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--bg);font-size:16px}
.optlist{display:flex;flex-direction:column;gap:8px;border:0;padding:0;margin:0}.optlist legend{font-weight:700;margin:8px 0 4px;padding:0}
.check{display:flex;gap:12px;align-items:center;min-height:var(--tap-lg);padding:4px 0}.check input{width:22px;height:22px;flex:none}
.callout{border-radius:var(--radius);padding:12px 14px;border:1px solid var(--accent);background:var(--accent-soft)}.callout b{display:block}
.stickyfoot{position:sticky;bottom:0;background:var(--surface);padding:12px 0 calc(4px + var(--safe-b));display:flex;gap:8px}.stickyfoot .btn{flex:1}
.error{border-radius:10px;padding:10px 12px;background:var(--danger-soft);color:var(--danger);font-weight:600}
details.recovery summary{list-style:none}details.recovery summary::-webkit-details-marker{display:none}details.recovery[open] summary{margin-bottom:8px}
.codes{font-family:ui-monospace,Consolas,monospace;font-size:17px;display:grid;grid-template-columns:repeat(2,1fr);gap:6px 16px;padding-left:24px;margin:0}
`;

export const AUTH_JS = `(() => {
  const b64u = {
    enc(buf) { const s = String.fromCharCode(...new Uint8Array(buf)); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); },
    dec(str) { const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)).buffer; },
  };
  const err = (msg) => { const e = document.getElementById("error"); if (e) { e.textContent = msg; e.hidden = false; e.focus?.(); } else alert(msg); };
  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}), credentials: "same-origin" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || "Something went wrong. Try again.");
    return j;
  }
  function credJSON(c) {
    const r = c.response;
    const out = { id: c.id, rawId: b64u.enc(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults ? c.getClientExtensionResults() : {}, authenticatorAttachment: c.authenticatorAttachment || undefined, response: { clientDataJSON: b64u.enc(r.clientDataJSON) } };
    if (r.attestationObject) { out.response.attestationObject = b64u.enc(r.attestationObject); out.response.transports = r.getTransports ? r.getTransports() : []; }
    if (r.authenticatorData) { out.response.authenticatorData = b64u.enc(r.authenticatorData); out.response.signature = b64u.enc(r.signature); if (r.userHandle) out.response.userHandle = b64u.enc(r.userHandle); }
    return out;
  }
  async function getAssertion(optionsUrl, finishUrl, extra) {
    const o = await post(optionsUrl, extra);
    const publicKey = { challenge: b64u.dec(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification, allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: b64u.dec(c.id) })) };
    const cred = await navigator.credentials.get({ publicKey });
    if (!cred) throw new Error("No passkey was chosen.");
    return post(finishUrl, { ...extra, challengeId: o.challengeId, response: credJSON(cred) });
  }
  async function createCredential(o) {
    const publicKey = { ...o, challenge: b64u.dec(o.challenge), user: { ...o.user, id: b64u.dec(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: b64u.dec(c.id) })) };
    delete publicKey.challengeId;
    const cred = await navigator.credentials.create({ publicKey });
    if (!cred) throw new Error("No passkey was created.");
    return credJSON(cred);
  }
  const busy = (btn, on) => { btn.disabled = on; btn.setAttribute("aria-busy", on ? "true" : "false"); };
  const actions = {
    async "passkey-signin"(btn) {
      const uid = document.body.dataset.uid;
      const r = await getAssertion("/oauth/interaction/" + uid + "/passkey/options", "/oauth/interaction/" + uid + "/passkey");
      location.assign(r.redirect);
    },
    async "invite-signin"() {
      const t = document.body.dataset.invite;
      const r = await getAssertion("/oauth/invite/" + t + "/signin/options", "/oauth/invite/" + t + "/signin");
      location.assign(r.redirect);
    },
    async "invite-register"() {
      const t = document.body.dataset.invite;
      const name = document.getElementById("name").value.trim();
      if (!name) { err("Write your name first."); return; }
      const o = await post("/oauth/invite/" + t + "/options", { name });
      const response = await createCredential(o);
      const r = await post("/oauth/invite/" + t, { name, challengeId: o.challengeId, response });
      const list = document.getElementById("code-list");
      list.textContent = "";
      for (const c of r.codes) { const li = document.createElement("li"); li.textContent = c; list.append(li); }
      document.getElementById("setup").hidden = true;
      document.getElementById("codes").hidden = false;
      document.getElementById("error").hidden = true;
    },
    async "copy-codes"(btn) {
      const codes = [...document.querySelectorAll("#code-list li")].map((l) => l.textContent).join("\\n");
      await navigator.clipboard.writeText(codes); btn.textContent = "Copied";
    },
  };
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (!window.PublicKeyCredential && btn.dataset.action !== "copy-codes") { err("This browser doesn't support passkeys. Try an up-to-date browser."); return; }
    busy(btn, true);
    try { await actions[btn.dataset.action](btn); }
    catch (x) { err(x && x.name === "NotAllowedError" ? "The passkey request was cancelled or timed out. Try again." : (x && x.message) || "Something went wrong. Try again."); }
    finally { busy(btn, false); }
  });
})();
`;
