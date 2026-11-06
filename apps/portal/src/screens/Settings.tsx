// Site settings (PT-1 content, PT-2 layout): auto-approve with its confirmation, name, origins,
// captures, site keys, members and invites. Owners change things; others see them read-only.

import { useState } from "preact/hooks";
import type { Member, Role, Site, SiteKey } from "@annotatie/core";
import { ApiError, type Invite } from "../api";
import { ago, date, dateTime } from "../format";
import { go, href } from "../router";
import { useLoad, useStore } from "../store";
import { copyText, Empty, ErrorCard, Switch } from "../components/bits";
import { Sheet } from "../components/Sheet";

export function SettingsPicker() {
  const { me } = useStore();
  return (
    <section>
      <p class="sub">Choose a site.</p>
      <div class="menu mt16">
        {(me?.sites ?? []).map((s) => (
          <a href={href.settings(s.id)} key={s.id}>
            <span>
              {s.name}
              <br />
              <span class="meta">
                {s.role === "owner" ? "Owner" : s.role === "member" ? "Member" : "Viewer"}
                {s.autoApprove ? " · auto-approve on" : ""}
              </span>
            </span>
            <span aria-hidden="true">›</span>
          </a>
        ))}
        <a href={href.newSite()}>
          <span>Add a site</span>
          <span aria-hidden="true">›</span>
        </a>
      </div>
    </section>
  );
}

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", member: "Member", viewer: "Viewer" };
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

export function parseOrigins(text: string): { origins: string[]; bad: string[] } {
  const lines = text
    .split(/[\s,]+/)
    .map((x) => x.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const bad = lines.filter((l) => !ORIGIN_RE.test(l));
  return { origins: [...new Set(lines.filter((l) => ORIGIN_RE.test(l)).map((l) => l.toLowerCase()))], bad };
}

/** Accepts a public JWK, or an object holding one as publicKeyJwk. Refuses a private key. */
export function parseJwk(text: string): { jwk?: SiteKey["publicKeyJwk"]; kid?: string; error?: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { error: "That isn't JSON. Paste the public key as a JWK, for example {\"kty\":\"OKP\",\"crv\":\"Ed25519\",\"x\":\"…\"}." };
  }
  const o = (v && typeof v === "object" && "publicKeyJwk" in v ? (v as { publicKeyJwk: unknown }).publicKeyJwk : v) as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return { error: "That isn't a JWK." };
  if ("d" in o) return { error: "That is a private key. Keep it on your server and paste only the public key (without \"d\")." };
  if (o.kty !== "OKP" || o.crv !== "Ed25519" || typeof o.x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(o.x)) {
    return { error: "It must be an Ed25519 public key: kty \"OKP\", crv \"Ed25519\" and a 43-character x." };
  }
  return { jwk: { kty: "OKP", crv: "Ed25519", x: o.x }, kid: typeof o.kid === "string" ? o.kid : undefined };
}

export function SiteSettings(props: { siteId: string }) {
  const { api, me, toast, refreshQuiet } = useStore();
  const siteQ = useLoad(() => api.site(props.siteId), [props.siteId]);
  const site: Site | null = siteQ.data ?? me?.sites.find((s) => s.id === props.siteId) ?? null;
  const role = me?.sites.find((s) => s.id === props.siteId)?.role ?? site?.role;
  const owner = role === "owner";
  const keysQ = useLoad(() => (owner ? api.keys(props.siteId) : Promise.resolve({ keys: [] as SiteKey[] })), [props.siteId, owner]);
  const membersQ = useLoad(() => api.members(props.siteId), [props.siteId]);

  const [autoSheet, setAutoSheet] = useState<{ until: string } | null>(null);
  const [edit, setEdit] = useState<null | "name" | "origins" | "captures">(null);
  const [name, setName] = useState("");
  const [origins, setOrigins] = useState("");
  const [retention, setRetention] = useState(90);
  const [privacy, setPrivacy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [keySheet, setKeySheet] = useState<{ text: string; kid: string; err?: string } | null>(null);
  const [retire, setRetire] = useState<SiteKey | null>(null);
  const [inviteSheet, setInviteSheet] = useState<{ email: string; role: Role; link?: { url: string; expiresAt: string }; err?: string } | null>(null);
  const [memberSheet, setMemberSheet] = useState<{ m: Member; role: Role } | null>(null);

  if (siteQ.error && !site) return <ErrorCard error={siteQ.error} onRetry={siteQ.reload} />;
  if (!site) return <p class="loading">Loading…</p>;

  const fail = (e: unknown) => toast(e instanceof ApiError && e.offline ? "Not saved: no connection." : (e as Error).message);
  const afterSite = (s: Site) => {
    siteQ.set(s);
    void refreshQuiet();
  };

  const setAuto = async (on: boolean, until?: string | null) => {
    try {
      const s = await api.setAutoApprove(site.id, on, on ? until ?? null : null);
      afterSite(s);
      toast(on ? `Auto-approve is on for ${site.name}` : "Auto-approve is off");
      setAutoSheet(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "auto_approve_disabled") toast("Auto-approve is switched off for the whole platform. Every agent reply waits for approval.");
      else fail(e);
    }
  };

  const patch = async (b: Parameters<typeof api.patchSite>[1]) => {
    try {
      afterSite(await api.patchSite(site.id, b));
      setEdit(null);
      toast("Saved");
    } catch (e) {
      setFormErr(e instanceof ApiError && e.offline ? "Not saved: no connection." : (e as Error).message);
    }
  };

  const until = site.autoApprove && site.autoApproveUntil ? ` It switches itself off on ${dateTime(site.autoApproveUntil)}.` : "";
  const keys = keysQ.data?.keys ?? [];
  const members = membersQ.data?.members ?? [];
  const invites: Invite[] = membersQ.data?.invites ?? [];

  return (
    <section>
      <p class="meta">{site.name}</p>
      <h1 tabIndex={-1}>Site settings</h1>
      <p class="sub">{owner ? "Only owners can change these." : "Owners only: you can see these settings but not change them."}</p>

      <div class="card mt16">
        <h2>Replies from agents</h2>
        <div class="set">
          <div>
            <b>Auto-approve agent replies</b>
            <br />
            <span class="meta" id="autodesc">
              {site.autoApprove
                ? `On: agent replies to users are sent straight away, signed with the connecting person's name.${until}`
                : "Off: every reply an agent writes for a user waits as a draft until a person approves it."}
            </span>
          </div>
          <Switch
            id="auto"
            checked={site.autoApprove}
            label="Auto-approve agent replies"
            disabled={!owner}
            onChange={(on) => (on ? setAutoSheet({ until: "" }) : void setAuto(false))}
          />
        </div>
      </div>

      <div class="card mt16">
        <h2>Site</h2>
        <div class="set">
          <div>
            <b>Name</b>
            <br />
            <span class="meta">{site.name}</span>
          </div>
          {owner && (
            <button class="btn" type="button" onClick={() => (setName(site.name), setFormErr(null), setEdit("name"))}>
              Rename
            </button>
          )}
        </div>
        <div class="set">
          <div>
            <b>Allowed origins</b>
            <br />
            <span class="meta">
              {site.origins.length
                ? site.origins.map((o, i) => (
                    <span key={o}>
                      {i > 0 && " · "}
                      <code>{o}</code>
                    </span>
                  ))
                : "None yet: the widget won't run anywhere."}
            </span>
          </div>
          {owner && (
            <button class="btn" type="button" onClick={() => (setOrigins(site.origins.join("\n")), setFormErr(null), setEdit("origins"))}>
              Edit
            </button>
          )}
        </div>
        <div class="set">
          <div>
            <b>Captures</b>
            <br />
            <span class="meta">
              Deleted {site.retentionDays} days after a report is resolved · privacy mode {site.privacyMode ? "on" : "off"}
            </span>
          </div>
          {owner && (
            <button class="btn" type="button" onClick={() => (setRetention(site.retentionDays), setPrivacy(site.privacyMode), setFormErr(null), setEdit("captures"))}>
              Change
            </button>
          )}
        </div>
      </div>

      {owner && (
        <div class="card mt16">
          <h2>Site keys</h2>
          <p class="meta mt8">Your server signs each user's sign-in to the widget with the private key. Annotatie keeps only the public key.</p>
          {keysQ.error && <ErrorCard error={keysQ.error} onRetry={keysQ.reload} />}
          {keys.map((k) => (
            <div class="set" key={k.kid}>
              <div>
                <b>
                  Key <code>{k.kid}</code>
                </b>
                <br />
                <span class="meta">
                  {k.status === "active" ? "Active" : "Retired"} · added {date(k.createdAt)}
                </span>
              </div>
              {k.status === "active" && (
                <button class="btn danger" type="button" onClick={() => setRetire(k)}>
                  Retire
                </button>
              )}
            </div>
          ))}
          {!keysQ.loading && keys.length === 0 && <p class="meta mt8">No keys yet. Add one before installing the widget.</p>}
          <div class="set">
            <div>
              <b>Add a key</b>
              <br />
              <span class="meta">Paste the public key as a JWK.</span>
            </div>
            <button class="btn" type="button" onClick={() => setKeySheet({ text: "", kid: "" })}>
              Add key
            </button>
          </div>
        </div>
      )}

      <div class="card mt16">
        <h2>Members</h2>
        {membersQ.error && <ErrorCard error={membersQ.error} onRetry={membersQ.reload} />}
        {members.map((m) => (
          <div class="set" key={m.userId}>
            <div>
              <b>{m.name}</b>
              <br />
              <span class="meta">
                {ROLE_LABEL[m.role]} · {m.email}
              </span>
            </div>
            {owner && m.userId !== me?.user.id && (
              <button class="btn" type="button" onClick={() => setMemberSheet({ m, role: m.role })}>
                Change
              </button>
            )}
          </div>
        ))}
        {invites.map((i) => (
          <div class="set" key={i.id}>
            <div>
              <b>{i.email}</b>
              <br />
              <span class="meta">
                Invited as {ROLE_LABEL[i.role].toLowerCase()} · link valid until {dateTime(i.expiresAt)}
              </span>
            </div>
          </div>
        ))}
        {owner && (
          <div class="set">
            <div>
              <b>Invite someone</b>
              <br />
              <span class="meta">A one-time link, valid for 7 days, for you to send yourself.</span>
            </div>
            <button class="btn" type="button" onClick={() => setInviteSheet({ email: "", role: "member" })}>
              Make link
            </button>
          </div>
        )}
      </div>

      {owner && (
        <p class="mt16">
          <a class="btn" href={href.log(site.id)}>
            Activity log
          </a>
        </p>
      )}

      {/* Turning auto-approve on: a confirmation, the destructive button last and full width. */}
      <Sheet
        open={!!autoSheet}
        noClose
        title={`Turn on auto-approve for ${site.name}?`}
        onClose={() => setAutoSheet(null)}
        testId="auto-sheet"
        footer={
          <>
            <button class="btn lg" type="button" onClick={() => setAutoSheet(null)}>
              Keep it off
            </button>
            <button
              class="btn danger lg"
              type="button"
              onClick={() => {
                const u = autoSheet?.until ? new Date(autoSheet.until) : null;
                if (u && !(u.getTime() > Date.now())) {
                  toast("Choose a time in the future, or leave it empty");
                  return;
                }
                void setAuto(true, u ? u.toISOString() : null);
              }}
            >
              Turn on auto-approve
            </button>
          </>
        }
      >
        <p>
          Replies agents write for this site's users will be sent <b>straight away, without anyone checking them</b>, signed with the name of whoever connected the agent.
        </p>
        <p class="meta">Internal notes, statuses and decisions are unaffected. The drafts already waiting stay drafts.</p>
        {autoSheet && (
          <div class="field">
            <label for="auto-until">Switch it off again at (optional)</label>
            <input id="auto-until" type="datetime-local" value={autoSheet.until} onInput={(e) => setAutoSheet({ until: e.currentTarget.value })} />
            <span class="meta">Leave empty to keep it on until you turn it off.</span>
          </div>
        )}
      </Sheet>

      <Sheet
        open={edit !== null}
        title={edit === "name" ? "Rename the site" : edit === "origins" ? "Allowed origins" : "Captures"}
        onClose={() => setEdit(null)}
        footer={
          <>
            <button class="btn lg" type="button" onClick={() => setEdit(null)}>
              Cancel
            </button>
            <button
              class="btn primary lg"
              type="button"
              onClick={() => {
                setFormErr(null);
                if (edit === "name") {
                  if (!name.trim()) return setFormErr("A name is needed");
                  void patch({ name: name.trim() });
                } else if (edit === "origins") {
                  const r = parseOrigins(origins);
                  if (r.bad.length) return setFormErr(`Not an origin: ${r.bad.join(", ")}. Use the scheme and host only, like https://app.example.com`);
                  void patch({ origins: r.origins });
                } else {
                  if (!(retention >= 1 && retention <= 3650)) return setFormErr("Choose 1 to 3,650 days");
                  void patch({ retentionDays: retention, privacyMode: privacy });
                }
              }}
            >
              Save
            </button>
          </>
        }
      >
        {formErr && (
          <p class="err" role="alert">
            {formErr}
          </p>
        )}
        {edit === "name" && (
          <div class="field">
            <label for="site-name">Name</label>
            <input id="site-name" type="text" value={name} maxLength={100} onInput={(e) => setName(e.currentTarget.value)} />
          </div>
        )}
        {edit === "origins" && (
          <div class="field">
            <label for="site-origins">Origins, one per line</label>
            <span class="meta">The exact addresses the widget may run on, such as https://app.example.com. No paths.</span>
            <textarea id="site-origins" value={origins} onInput={(e) => setOrigins(e.currentTarget.value)} />
          </div>
        )}
        {edit === "captures" && (
          <>
            <div class="field">
              <label for="site-ret">Keep captures for this many days after a report is resolved</label>
              <input id="site-ret" type="number" min={1} max={3650} value={retention} onInput={(e) => setRetention(Number(e.currentTarget.value))} />
            </div>
            <label class="check">
              <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.currentTarget.checked)} /> Privacy mode: send no screenshots or page copies from this site
            </label>
          </>
        )}
      </Sheet>

      <Sheet
        open={!!keySheet}
        title="Add a site key"
        onClose={() => setKeySheet(null)}
        footer={
          <>
            <button class="btn lg" type="button" onClick={() => setKeySheet(null)}>
              Cancel
            </button>
            <button
              class="btn primary lg"
              type="button"
              onClick={async () => {
                if (!keySheet) return;
                const r = parseJwk(keySheet.text);
                if (r.error || !r.jwk) return setKeySheet({ ...keySheet, err: r.error });
                try {
                  const k = await api.addKey(site.id, { publicKeyJwk: r.jwk, ...(keySheet.kid.trim() || r.kid ? { kid: keySheet.kid.trim() || r.kid } : {}) });
                  setKeySheet(null);
                  keysQ.reload();
                  toast(`Key ${k.kid} added`);
                } catch (e) {
                  setKeySheet({ ...keySheet, err: (e as Error).message });
                }
              }}
            >
              Add key
            </button>
          </>
        }
      >
        {keySheet && (
          <>
            {keySheet.err && (
              <p class="err" role="alert">
                {keySheet.err}
              </p>
            )}
            <div class="field">
              <label for="key-jwk">Public key (JWK)</label>
              <span class="meta">Made by your server, e.g. with the Annotatie server package. Never paste the private key.</span>
              <textarea id="key-jwk" spellcheck={false} value={keySheet.text} onInput={(e) => setKeySheet({ ...keySheet, text: e.currentTarget.value, err: undefined })} />
            </div>
            <div class="field">
              <label for="key-kid">Key id (optional)</label>
              <input id="key-kid" type="text" value={keySheet.kid} onInput={(e) => setKeySheet({ ...keySheet, kid: e.currentTarget.value })} />
            </div>
          </>
        )}
      </Sheet>

      <Sheet
        open={!!retire}
        noClose
        title={`Retire key ${retire?.kid ?? ""}?`}
        onClose={() => setRetire(null)}
        footer={
          <>
            <button class="btn lg" type="button" onClick={() => setRetire(null)}>
              Keep it
            </button>
            <button
              class="btn danger lg"
              type="button"
              onClick={async () => {
                if (!retire) return;
                try {
                  await api.retireKey(site.id, retire.kid);
                  setRetire(null);
                  keysQ.reload();
                  toast("Key retired");
                } catch (e) {
                  fail(e);
                }
              }}
            >
              Retire key
            </button>
          </>
        }
      >
        <p>Sign-ins signed with this key are refused at once. Add the new key first if your server is switching keys.</p>
      </Sheet>

      <Sheet
        open={!!inviteSheet}
        title="Invite someone"
        onClose={() => setInviteSheet(null)}
        footer={
          inviteSheet?.link ? (
            <button class="btn lg" type="button" onClick={() => (setInviteSheet(null), membersQ.reload())}>
              Done
            </button>
          ) : (
            <>
              <button class="btn lg" type="button" onClick={() => setInviteSheet(null)}>
                Cancel
              </button>
              <button
                class="btn primary lg"
                type="button"
                onClick={async () => {
                  if (!inviteSheet) return;
                  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteSheet.email.trim())) return setInviteSheet({ ...inviteSheet, err: "Enter an email address" });
                  try {
                    const r = await api.invite(site.id, { email: inviteSheet.email.trim(), role: inviteSheet.role });
                    setInviteSheet({ ...inviteSheet, err: undefined, link: { url: r.url, expiresAt: r.expiresAt } });
                  } catch (e) {
                    setInviteSheet({ ...inviteSheet, err: (e as Error).message });
                  }
                }}
              >
                Make link
              </button>
            </>
          )
        }
      >
        {inviteSheet &&
          (inviteSheet.link ? (
            <>
              <p>
                Send this link to <b>{inviteSheet.email}</b> yourself. It works once, until {dateTime(inviteSheet.link.expiresAt)}. It isn't shown again.
              </p>
              <code class="secret" data-testid="invite-link">
                {inviteSheet.link.url}
              </code>
              <button class="btn primary lg" type="button" onClick={async () => toast((await copyText(inviteSheet.link!.url)) ? "Link copied" : "Couldn't copy. Select the link instead.")}>
                Copy
              </button>
            </>
          ) : (
            <>
              {inviteSheet.err && (
                <p class="err" role="alert">
                  {inviteSheet.err}
                </p>
              )}
              <div class="field">
                <label for="inv-email">Email</label>
                <input id="inv-email" type="email" autocomplete="off" value={inviteSheet.email} onInput={(e) => setInviteSheet({ ...inviteSheet, email: e.currentTarget.value, err: undefined })} />
              </div>
              <RoleRadios name="inv-role" value={inviteSheet.role} onChange={(role) => setInviteSheet({ ...inviteSheet, role })} />
            </>
          ))}
      </Sheet>

      <Sheet
        open={!!memberSheet}
        title={memberSheet ? memberSheet.m.name : ""}
        onClose={() => setMemberSheet(null)}
        footer={
          <>
            <button
              class="btn danger lg"
              type="button"
              onClick={async () => {
                if (!memberSheet) return;
                try {
                  await api.removeMember(site.id, memberSheet.m.userId);
                  setMemberSheet(null);
                  membersQ.reload();
                  toast(`${memberSheet.m.name} removed`);
                } catch (e) {
                  fail(e);
                }
              }}
            >
              Remove from site
            </button>
            <button
              class="btn primary lg"
              type="button"
              onClick={async () => {
                if (!memberSheet) return;
                try {
                  await api.setMemberRole(site.id, memberSheet.m.userId, memberSheet.role);
                  setMemberSheet(null);
                  membersQ.reload();
                  toast("Role changed");
                } catch (e) {
                  fail(e);
                }
              }}
            >
              Save role
            </button>
          </>
        }
      >
        {memberSheet && <RoleRadios name="mem-role" value={memberSheet.role} onChange={(role) => setMemberSheet({ ...memberSheet, role })} />}
      </Sheet>
    </section>
  );
}

function RoleRadios(props: { name: string; value: Role; onChange: (r: Role) => void }) {
  const desc: Record<Role, string> = {
    owner: "Changes settings, keys, members and auto-approve.",
    member: "Approves, edits and rejects drafts; replies; answers decisions.",
    viewer: "Reads reports and threads.",
  };
  return (
    <fieldset class="optlist">
      <legend style={{ fontWeight: 700, marginBottom: "4px" }}>Role</legend>
      {(["member", "viewer", "owner"] as Role[]).map((r) => (
        <label class="opt" key={r}>
          <input type="radio" name={props.name} checked={props.value === r} onChange={() => props.onChange(r)} />
          <span>
            <b>{ROLE_LABEL[r]}</b>
            <br />
            <span class="meta">{desc[r]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function NewSite() {
  const { api, toast, refreshQuiet } = useStore();
  const [name, setName] = useState("");
  const [origins, setOrigins] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section>
      <p class="sub">You become its owner. Next, add a site key and install the widget.</p>
      <form
        class="card stack mt16"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          if (!name.trim()) return setErr("A name is needed");
          const r = parseOrigins(origins);
          if (r.bad.length) return setErr(`Not an origin: ${r.bad.join(", ")}. Use the scheme and host only, like https://app.example.com`);
          setBusy(true);
          try {
            const s = await api.createSite({ name: name.trim(), origins: r.origins });
            await refreshQuiet();
            toast(`${s.name} added. Add a site key next.`);
            go(href.settings(s.id));
          } catch (e2) {
            setBusy(false);
            setErr((e2 as Error).message);
          }
        }}
      >
        {err && (
          <p class="err" role="alert">
            {err}
          </p>
        )}
        <div class="field">
          <label for="ns-name">Name</label>
          <input id="ns-name" type="text" maxLength={100} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </div>
        <div class="field">
          <label for="ns-origins">Allowed origins, one per line</label>
          <span class="meta">Where the widget will run, such as https://app.example.com. You can change these later.</span>
          <textarea id="ns-origins" value={origins} onInput={(e) => setOrigins(e.currentTarget.value)} />
        </div>
        <div>
          <button class="btn primary lg" type="submit" disabled={busy}>
            Add the site
          </button>
        </div>
      </form>
    </section>
  );
}

const EVENT_LABEL: Record<string, string> = {
  "item.created": "Item created",
  "item.updated": "Item changed",
  "message.created": "Message written",
  "message.published": "Reply sent",
  "message.unpublished": "Reply undone",
  "message.rejected": "Draft rejected",
  "decision.answered": "Decision answered",
  "question.asked": "Question asked",
  "question.answered": "Question answered",
  "question.withdrawn": "Question withdrawn",
  "site.updated": "Settings changed",
  "site.auto_approve": "Auto-approve changed",
  "site.key": "Site key changed",
  "site.member": "Members changed",
};

export function LogScreen(props: { siteId: string }) {
  const { api, me } = useStore();
  const q = useLoad(() => api.log(props.siteId), [props.siteId]);
  const site = me?.sites.find((s) => s.id === props.siteId);
  return (
    <section>
      <p class="meta">{site?.name}</p>
      <p class="sub">Who did what, newest first. Owners only.</p>
      {q.error && <ErrorCard error={q.error} onRetry={q.reload} />}
      {q.data && q.data.events.length === 0 && (
        <div class="mt16">
          <Empty title="Nothing recorded yet" />
        </div>
      )}
      {q.data && q.data.events.length > 0 && (
        <div class="list mt16" role="list">
          {q.data.events.map((e) => (
            <div class="li noimg static" role="listitem" key={e.id}>
              <span class="body">
                <span class="t">{EVENT_LABEL[e.type] ?? e.type}</span>
                {e.type === "site.auto_approve" && e.detail && <span> · {(e.detail as { on?: boolean }).on ? "on" : "off"}</span>}
                <br />
                <span class="meta">
                  {e.actor.name}
                  {e.via?.clientName ? ` via ${e.via.clientName}` : ""} · {ago(e.at)}
                </span>
              </span>
              {e.itemId ? (
                <span class="st">
                  <a href={href.item(e.siteId, e.itemId)}>Open</a>
                </span>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
