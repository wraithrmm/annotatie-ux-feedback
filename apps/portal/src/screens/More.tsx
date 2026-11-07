// More (PT-2 §4.6): the sites with their counts, notifications on this device (M1) with quiet hours,
// and the desk work.

import { useEffect, useState } from "preact/hooks";
import type { Preferences } from "@annotatie/core";
import { href } from "../router";
import { disablePush, enablePush, isIos, pushState, type PushState } from "../push";
import { useStore } from "../store";
import { Switch } from "../components/bits";

export function MoreScreen() {
  const { me, signOut } = useStore();
  const sites = me?.sites ?? [];
  return (
    <section>
      <h2 class="sec-h">Sites</h2>
      <div class="menu">
        {sites.map((s) => {
          const c = s.counts;
          const att = c ? c.drafts + c.decisions + c.unanswered : 0;
          return (
            <a href={href.reports(s.id)} key={s.id}>
              <span>
                {s.name}
                <br />
                <span class="meta">
                  {att} need{att === 1 ? "s" : ""} attention · {c?.open ?? 0} open report{c?.open === 1 ? "" : "s"}
                  {s.autoApprove ? " · auto-approve on" : ""}
                </span>
              </span>
              <span class={`count${att ? " hot" : ""}`}>{att}</span>
            </a>
          );
        })}
        <a href={href.newSite()}>
          <span>Add a site</span>
          <span aria-hidden="true">›</span>
        </a>
      </div>
      <h2 class="sec-h">This device</h2>
      <PushCard />
      <h2 class="sec-h">Desk work</h2>
      <div class="menu">
        <a href={href.settingsPicker()}>
          <span>Site settings</span>
          <span aria-hidden="true">›</span>
        </a>
        <a href={href.agents()}>
          <span>Agents and tokens</span>
          <span aria-hidden="true">›</span>
        </a>
        <a href={href.passkeys()}>
          <span>Passkeys</span>
          <span aria-hidden="true">›</span>
        </a>
        <a href={href.guide()}>
          <span>
            How-to guide
            <br />
            <span class="meta">Connect Claude, install the widget</span>
          </span>
          <span aria-hidden="true">›</span>
        </a>
        <button type="button" onClick={signOut}>
          <span>
            Sign out
            <br />
            <span class="meta">{me?.user.name}</span>
          </span>
          <span />
        </button>
      </div>
    </section>
  );
}

function PushCard() {
  const { api, me, toast, refreshQuiet } = useStore();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const prefs = me?.preferences;
  useEffect(() => {
    pushState().then(setState, () => setState("unsupported"));
  }, []);
  const on = state === "on";
  const toggle = async (want: boolean) => {
    setBusy(true);
    try {
      const s = want ? await enablePush(api) : await disablePush(api);
      setState(s);
      toast(s === "on" ? "Notifications are on for this device" : s === "denied" ? "Notifications are blocked in this browser's settings" : "Notifications are off");
    } catch (e) {
      toast(`Couldn't turn on notifications: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const desc =
    state === "on"
      ? "On for drafts and decisions waiting for you. This device only."
      : state === "denied"
        ? "Blocked in this browser's settings. Allow notifications for this site, then try again."
        : state === "needs-install"
          ? "Add the portal to your home screen first (below), then open it from there."
          : state === "unsupported"
            ? "This browser can't show notifications from the portal."
            : "Off. Turn on to hear when a draft or a decision is waiting.";
  return (
    <div class="card stack">
      <div class="set" style={{ border: 0, padding: 0 }}>
        <div>
          <b>Notifications on this device</b>
          <br />
          <span class="meta">{desc}</span>
        </div>
        <Switch
          id="push"
          checked={on}
          label="Notifications on this device"
          disabled={busy || state === null || state === "unsupported" || state === "needs-install"}
          onChange={(want) => void toggle(want)}
        />
      </div>
      {(isIos() || state === "needs-install") && <p class="meta">On an iPhone or iPad, add the portal to your home screen first: Share › Add to Home Screen. Then open it from there and turn this on.</p>}
      {prefs && <PrefsEditor prefs={prefs} onSaved={() => void refreshQuiet()} />}
    </div>
  );
}

function PrefsEditor({ prefs, onSaved }: { prefs: Preferences; onSaved: () => void }) {
  const { api, toast } = useStore();
  const tz = prefs.quietHours?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [quiet, setQuiet] = useState(!!prefs.quietHours);
  const [start, setStart] = useState(prefs.quietHours?.start ?? "22:00");
  const [end, setEnd] = useState(prefs.quietHours?.end ?? "07:00");
  const [drafts, setDrafts] = useState(prefs.push.drafts);
  const [decisions, setDecisions] = useState(prefs.push.decisions);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.putPreferences({ quietHours: quiet ? { start, end, timeZone: tz } : null, push: { drafts, decisions } });
      toast("Notification settings saved");
      onSaved();
    } catch (e) {
      toast(`Not saved: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      class="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset class="check-list">
        <legend>Tell me when</legend>
        <label class="check">
          <input type="checkbox" checked={drafts} onChange={(e) => setDrafts(e.currentTarget.checked)} /> A draft is waiting for approval
        </label>
        <label class="check">
          <input type="checkbox" checked={decisions} onChange={(e) => setDecisions(e.currentTarget.checked)} /> A decision or question is waiting
        </label>
      </fieldset>
      <label class="check">
        <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.currentTarget.checked)} /> Quiet hours
      </label>
      {quiet && (
        <div class="row">
          <div class="field">
            <label for="qh-start">From</label>
            <input id="qh-start" type="time" value={start} onInput={(e) => setStart(e.currentTarget.value)} />
          </div>
          <div class="field">
            <label for="qh-end">To</label>
            <input id="qh-end" type="time" value={end} onInput={(e) => setEnd(e.currentTarget.value)} />
          </div>
        </div>
      )}
      <p class="meta">
        {quiet ? `Times are in ${tz}. ` : ""}Blocking questions notify at once, even in quiet hours. These settings apply on every device.
      </p>
      <div>
        <button class="btn" type="submit" disabled={busy}>
          Save notification settings
        </button>
      </div>
    </form>
  );
}
