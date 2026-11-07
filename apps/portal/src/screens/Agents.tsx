// Agents and tokens (OAuth grants and personal access tokens), and Passkeys.

import { useState } from "preact/hooks";
import { AGENT_SCOPES, type AgentScope } from "@annotatie/core";
import { ApiError } from "../api";
import { ago, date } from "../format";
import { useLoad, useStore } from "../store";
import { copyText, Empty, ErrorCard } from "../components/bits";
import { Sheet } from "../components/Sheet";
import { createPasskey } from "../webauthn";

export const SCOPE_LABEL: Record<AgentScope, string> = {
  read: "Read reports, threads and decisions",
  reply: "Write internal notes",
  "reply:user": "Write drafts of replies to users (they wait for approval)",
  status: "Change statuses",
  decide: "Raise decisions and questions for you",
  "capture:read": "Open screenshots and page copies",
  sites: "Set up sites: create them, allow their addresses, register site keys (on sites you own)",
};
const SCOPE_SHORT: Record<string, string> = { read: "read", reply: "notes", "reply:user": "drafts", status: "statuses", decide: "decisions", "capture:read": "captures", sites: "site setup" };

export function AgentsScreen() {
  const { api, me, toast } = useStore();
  const agentsQ = useLoad(() => api.agents(), []);
  const tokensQ = useLoad(() => api.tokens(), []);
  const [revoke, setRevoke] = useState<{ kind: "agent" | "token"; id: string; name: string } | null>(null);
  const [make, setMake] = useState<{ name: string; sites: string[]; scopes: AgentScope[]; days: number; err?: string; busy?: boolean; token?: string } | null>(null);
  const sites = me?.sites ?? [];
  const usable = sites.filter((s) => s.role === "owner" || s.role === "member");
  const siteNames = (ids: string[]) => ids.map((id) => sites.find((s) => s.id === id)?.name ?? "a site you left").join(", ");
  const scopes = (xs: string[]) => xs.map((x) => SCOPE_SHORT[x] ?? x).join(", ");

  const doRevoke = async () => {
    if (!revoke) return;
    try {
      if (revoke.kind === "agent") {
        await api.revokeAgent(revoke.id);
        agentsQ.reload();
      } else {
        await api.revokeToken(revoke.id);
        tokensQ.reload();
      }
      toast(`${revoke.name} revoked`);
      setRevoke(null);
    } catch (e) {
      toast(e instanceof ApiError && e.offline ? "Not revoked: no connection." : (e as Error).message);
    }
  };

  const create = async () => {
    if (!make) return;
    if (!make.name.trim()) return setMake({ ...make, err: "Give the token a name" });
    if (!make.sites.length) return setMake({ ...make, err: "Choose at least one site" });
    if (!make.scopes.includes("read")) return setMake({ ...make, err: "Every token can read" });
    setMake({ ...make, busy: true, err: undefined });
    try {
      const r = await api.createToken({ name: make.name.trim(), sites: make.sites, scopes: make.scopes, expiresInDays: make.days });
      setMake({ ...make, busy: false, token: r.token });
      tokensQ.reload();
    } catch (e) {
      setMake({ ...make, busy: false, err: (e as Error).message });
    }
  };

  return (
    <section>
      <p class="sub">Everything that can act as you. Revoking takes effect within 15 minutes, or at once for tokens.</p>
      <h2 class="sec-h">Connected agents</h2>
      {agentsQ.error && <ErrorCard error={agentsQ.error} onRetry={agentsQ.reload} />}
      <div class="card">
        {agentsQ.data?.agents.length === 0 && <p class="meta">No agents are connected. An agent connects by asking you in the browser.</p>}
        {agentsQ.data?.agents.map((a) => (
          <div class="set" key={a.grantId}>
            <div>
              <b>{a.clientName}</b>
              <br />
              <span class="meta">
                {siteNames(a.sites)} · {scopes(a.scopes)} · {a.lastUsedAt ? `last used ${ago(a.lastUsedAt)}` : `connected ${date(a.createdAt)}`}
              </span>
            </div>
            <button class="btn danger" type="button" onClick={() => setRevoke({ kind: "agent", id: a.grantId, name: a.clientName })}>
              Revoke
            </button>
          </div>
        ))}
      </div>
      <h2 class="sec-h">Personal access tokens</h2>
      <p class="meta" style={{ margin: "0 4px 8px" }}>
        For agents that can't open a browser. Shown once when you make one.
      </p>
      {tokensQ.error && <ErrorCard error={tokensQ.error} onRetry={tokensQ.reload} />}
      <div class="card">
        {tokensQ.data?.tokens.length === 0 && <p class="meta">No tokens.</p>}
        {tokensQ.data?.tokens.map((t) => (
          <div class="set" key={t.id}>
            <div>
              <b>{t.name}</b>
              <br />
              <span class="meta">
                {siteNames(t.sites)} · {scopes(t.scopes)} · expires {date(t.expiresAt)}
                {t.lastUsedAt ? ` · last used ${ago(t.lastUsedAt)}` : " · not used yet"}
              </span>
            </div>
            <button class="btn danger" type="button" onClick={() => setRevoke({ kind: "token", id: t.id, name: t.name })}>
              Revoke
            </button>
          </div>
        ))}
      </div>
      <p class="mt12">
        <button
          class="btn primary"
          type="button"
          disabled={!usable.length}
          onClick={() => setMake({ name: "", sites: usable.length === 1 ? [usable[0]!.id] : [], scopes: ["read", "reply"], days: 90 })}
        >
          Make a token
        </button>
      </p>

      <Sheet
        open={!!revoke}
        noClose
        title={`Revoke ${revoke?.name ?? ""}?`}
        onClose={() => setRevoke(null)}
        footer={
          <>
            <button class="btn lg" type="button" onClick={() => setRevoke(null)}>
              Keep it
            </button>
            <button class="btn danger lg" type="button" onClick={doRevoke}>
              Revoke
            </button>
          </>
        }
      >
        <p>{revoke?.kind === "agent" ? "It stops working within 15 minutes. To use it again, connect it again." : "It stops working at once."}</p>
      </Sheet>

      <Sheet
        open={!!make}
        title={make?.token ? "Your new token" : "Make a token"}
        onClose={() => setMake(null)}
        footer={
          make?.token ? (
            <button class="btn lg" type="button" onClick={() => setMake(null)}>
              Done
            </button>
          ) : (
            <>
              <button class="btn lg" type="button" onClick={() => setMake(null)}>
                Cancel
              </button>
              <button class="btn primary lg" type="button" disabled={make?.busy} onClick={create}>
                Make the token
              </button>
            </>
          )
        }
      >
        {make &&
          (make.token ? (
            <>
              <p>
                <b>Copy it now.</b> It isn't shown again. Anyone with it can act as you on {siteNames(make.sites)}.
              </p>
              <code class="secret" data-testid="new-token">
                {make.token}
              </code>
              <button class="btn primary lg" type="button" onClick={async () => toast((await copyText(make.token!)) ? "Token copied" : "Couldn't copy. Select the token instead.")}>
                Copy
              </button>
            </>
          ) : (
            <>
              {make.err && (
                <p class="err" role="alert">
                  {make.err}
                </p>
              )}
              <div class="field">
                <label for="tok-name">Name</label>
                <input id="tok-name" type="text" maxLength={100} value={make.name} placeholder="e.g. nightly-triage" onInput={(e) => setMake({ ...make, name: e.currentTarget.value })} />
              </div>
              <fieldset class="check-list">
                <legend>Sites</legend>
                {usable.map((s) => (
                  <label class="check" key={s.id}>
                    <input
                      type="checkbox"
                      checked={make.sites.includes(s.id)}
                      onChange={(e) => setMake({ ...make, sites: e.currentTarget.checked ? [...make.sites, s.id] : make.sites.filter((x) => x !== s.id) })}
                    />{" "}
                    {s.name}
                  </label>
                ))}
              </fieldset>
              <fieldset class="check-list">
                <legend>What it may do</legend>
                {AGENT_SCOPES.map((sc) => (
                  <label class="check" key={sc}>
                    <input
                      type="checkbox"
                      checked={make.scopes.includes(sc)}
                      disabled={sc === "read"}
                      onChange={(e) => setMake({ ...make, scopes: e.currentTarget.checked ? [...make.scopes, sc] : make.scopes.filter((x) => x !== sc) })}
                    />{" "}
                    {SCOPE_LABEL[sc]}
                    {sc === "read" ? " (always)" : ""}
                  </label>
                ))}
              </fieldset>
              <div class="callout">
                <b>It can't reach your users directly.</b>Its replies to a site's users wait for your approval, unless auto-approve is on for that site.
              </div>
              <div class="field">
                <label for="tok-days">Expires after</label>
                <select id="tok-days" value={String(make.days)} onChange={(e) => setMake({ ...make, days: Number(e.currentTarget.value) })}>
                  {[7, 30, 90, 180, 365].map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </div>
            </>
          ))}
      </Sheet>
    </section>
  );
}

export function PasskeysScreen() {
  const { api, toast } = useStore();
  const q = useLoad(() => api.passkeys(), []);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<{ id: string; name: string } | null>(null);
  const list = q.data?.passkeys ?? [];
  const add = async () => {
    setBusy(true);
    try {
      const options = await api.passkeyOptions();
      const response = await createPasskey(options);
      const pk = await api.addPasskey({ name: name.trim() || "Passkey", response });
      setName("");
      q.reload();
      toast(`Passkey "${pk.name}" added`);
    } catch (e) {
      const n = (e as Error).name;
      toast(n === "NotAllowedError" ? "No passkey was made: it was cancelled or timed out." : n === "InvalidStateError" ? "This device already has a passkey for you." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <p class="sub">You sign in with a passkey: your fingerprint, face or screen lock. Add one on each device you use.</p>
      {q.error && <ErrorCard error={q.error} onRetry={q.reload} />}
      <div class="card mt16">
        {list.map((p) => (
          <div class="set" key={p.id}>
            <div>
              <b>{p.name}</b>
              <br />
              <span class="meta">
                Added {date(p.createdAt)}
                {p.lastUsedAt ? ` · last used ${ago(p.lastUsedAt)}` : ""}
              </span>
            </div>
            <button
              class="btn danger"
              type="button"
              disabled={list.length <= 1}
              title={list.length <= 1 ? "You can't delete your last passkey" : undefined}
              onClick={() => setDel({ id: p.id, name: p.name })}
            >
              Delete
            </button>
          </div>
        ))}
        {q.data && list.length === 0 && <Empty title="No passkeys" />}
        {list.length === 1 && <p class="meta mt8">You can't delete your last passkey. Add another first.</p>}
      </div>
      <form
        class="card stack mt16"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <h2>Add a passkey</h2>
        <div class="field">
          <label for="pk-name">Name it</label>
          <input id="pk-name" type="text" maxLength={60} value={name} placeholder="e.g. Work laptop" onInput={(e) => setName(e.currentTarget.value)} />
        </div>
        <div>
          <button class="btn primary lg" type="submit" disabled={busy}>
            Add a passkey on this device
          </button>
        </div>
      </form>
      <Sheet
        open={!!del}
        noClose
        title={`Delete "${del?.name ?? ""}"?`}
        onClose={() => setDel(null)}
        footer={
          <>
            <button class="btn lg" type="button" onClick={() => setDel(null)}>
              Keep it
            </button>
            <button
              class="btn danger lg"
              type="button"
              onClick={async () => {
                if (!del) return;
                try {
                  await api.deletePasskey(del.id);
                  setDel(null);
                  q.reload();
                  toast("Passkey deleted");
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              Delete passkey
            </button>
          </>
        }
      >
        <p>You can no longer sign in with it.</p>
      </Sheet>
    </section>
  );
}
