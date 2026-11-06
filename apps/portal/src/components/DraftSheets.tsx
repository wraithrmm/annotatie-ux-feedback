// The editor sheet (full screen on a phone) and the reject sheet, shared by the queue and the thread.

import { useState } from "preact/hooks";
import { ApiError } from "../api";
import { plainText } from "../markdown";
import { useStore } from "../store";
import { Sheet } from "./Sheet";

export interface DraftTarget {
  siteId: string;
  siteName: string;
  itemId: string;
  itemRef: string;
  messageId: string;
  /** The host-site user the reply goes to. */
  to: string;
  /** Whose name the reply is signed with. */
  signedAs: string;
  userMessage?: string;
  draft: string;
}

export const REJECT_REASONS = ["Wrong facts", "Wrong tone", "Don't promise a date", "Needs a person"];

export function useDraftSheets(opts: { onFail: (t: DraftTarget, body: string | undefined, e: ApiError) => void; onDone?: () => void }) {
  const { approve, api, toast, refresh } = useStore();
  const [edit, setEdit] = useState<{ t: DraftTarget; text: string; orig: string } | null>(null);
  const [discard, setDiscard] = useState(false);
  const [rej, setRej] = useState<{ t: DraftTarget; why: string[]; note: string; err: boolean; busy: boolean } | null>(null);

  const openEdit = (t: DraftTarget, text?: string) => setEdit({ t, text: text ?? t.draft, orig: t.draft });
  const openReject = (t: DraftTarget) => setRej({ t, why: [], note: "", err: false, busy: false });

  const tryCloseEdit = () => {
    if (edit && edit.text !== edit.orig) setDiscard(true);
    else setEdit(null);
  };

  const send = async () => {
    if (!edit) return;
    const body = edit.text.trim();
    if (!body) {
      toast("The reply is empty");
      return;
    }
    const t = edit.t;
    setEdit(null);
    try {
      await approve({ siteId: t.siteId, itemId: t.itemId, messageId: t.messageId, who: t.to, body: body === t.draft ? undefined : body });
      toast("Sending your edited reply");
      opts.onDone?.();
    } catch (e) {
      opts.onFail(t, body, e instanceof ApiError ? e : new ApiError(0, "network", "No connection."));
    }
  };

  const reject = async () => {
    if (!rej) return;
    const note = rej.note.trim();
    if (!rej.why.length && !note) {
      setRej({ ...rej, err: true });
      setTimeout(() => document.getElementById("rej-err")?.focus(), 0);
      return;
    }
    const reason = [rej.why.join(", "), note].filter(Boolean).join(": ");
    setRej({ ...rej, busy: true });
    try {
      await api.reject(rej.t.siteId, rej.t.itemId, rej.t.messageId, reason);
      setRej(null);
      toast("Draft rejected. The agent reads your reason.");
      opts.onDone?.();
      void refresh();
    } catch (e) {
      setRej({ ...rej, busy: false });
      toast(e instanceof ApiError && e.offline ? "Not rejected: no connection. Try again." : (e as Error).message);
    }
  };

  const sheets = (
    <>
      <Sheet
        open={!!edit}
        full
        title="Edit the reply"
        onClose={tryCloseEdit}
        testId="edit-sheet"
        footer={
          <>
            <button class="btn lg" type="button" onClick={tryCloseEdit}>
              Cancel
            </button>
            <button class="btn primary lg" type="button" onClick={send}>
              Approve and send
            </button>
          </>
        }
      >
        {edit && (
          <>
            <p class="meta">
              {edit.t.siteName} · {edit.t.itemRef} · to {edit.t.to}
            </p>
            {edit.t.userMessage && (
              <div class="quote">
                {edit.t.to}: {plainText(edit.t.userMessage)}
              </div>
            )}
            <div class="field">
              <label for="edit-ta">Your reply, sent as {edit.t.signedAs}</label>
              <textarea
                class="big"
                id="edit-ta"
                value={edit.text}
                onInput={(e) => {
                  const el = e.currentTarget;
                  setEdit({ ...edit, text: el.value });
                  el.style.height = "auto";
                  el.style.height = `${Math.max(180, el.scrollHeight + 2)}px`;
                }}
              />
            </div>
          </>
        )}
      </Sheet>

      <Sheet
        open={discard}
        noClose
        title="Discard your edit?"
        onClose={() => setDiscard(false)}
        footer={
          <>
            <button
              class="btn lg"
              type="button"
              onClick={() => {
                setDiscard(false);
                setTimeout(() => document.getElementById("edit-ta")?.focus(), 0);
              }}
            >
              Keep editing
            </button>
            <button
              class="btn danger lg"
              type="button"
              onClick={() => {
                setDiscard(false);
                setEdit(null);
                toast("Edit discarded. The draft is unchanged.");
              }}
            >
              Discard
            </button>
          </>
        }
      >
        <p>Your changes to the reply will be lost. The agent's draft stays as it was.</p>
      </Sheet>

      <Sheet
        open={!!rej}
        title="Reject this draft?"
        onClose={() => setRej(null)}
        testId="reject-sheet"
        footer={
          <>
            <button class="btn lg" type="button" onClick={() => setRej(null)}>
              Cancel
            </button>
            <button class="btn danger lg" type="button" disabled={rej?.busy} onClick={reject}>
              Reject draft
            </button>
          </>
        }
      >
        {rej && (
          <>
            <p>The user never sees it. It stays in the thread as a rejected note, and the agent reads why.</p>
            {rej.err && (
              <p class="err" id="rej-err" tabIndex={-1} role="alert">
                Choose a reason or write a note
              </p>
            )}
            <fieldset class="chips" style={{ margin: 0 }}>
              <legend style={{ fontWeight: 700, marginBottom: "6px" }}>Why</legend>
              {REJECT_REASONS.map((r) => (
                <label key={r}>
                  <input
                    type="checkbox"
                    name="why"
                    value={r}
                    checked={rej.why.includes(r)}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setRej({ ...rej, err: false, why: on ? [...rej.why, r] : rej.why.filter((x) => x !== r) });
                    }}
                  />
                  {r}
                </label>
              ))}
            </fieldset>
            <div class="field">
              <label for="rej-note">Note for the agent</label>
              <span class="meta">Choose a reason, write a note, or both.</span>
              <input id="rej-note" type="text" value={rej.note} onInput={(e) => setRej({ ...rej, err: false, note: e.currentTarget.value })} />
            </div>
          </>
        )}
      </Sheet>
    </>
  );

  return { openEdit, openReject, sheets };
}
