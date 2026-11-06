// Attention: the queue (PT-2 §4.2). Drafts first, then decisions and questions, new from users,
// unanswered. Approve has a 10-second undo; Edit opens the editor sheet over the queue; Reject opens
// the reject sheet. A failed approval keeps the edit and offers Try again.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Attention as AttentionT, Item, Message, Site } from "@annotatie/core";
import { ApiError } from "../api";
import { ago, itemRef, itemType } from "../format";
import { href, go } from "../router";
import { useStore } from "../store";
import { Empty, ErrorCard, Markdown, Thumb, UndoBar } from "../components/bits";
import { CaptureViewer } from "../components/CaptureViewer";
import { useDraftSheets, type DraftTarget } from "../components/DraftSheets";
import { Sheet } from "../components/Sheet";

type Filter = "all" | "draft" | "decision" | "new" | "unanswered";
type Entry =
  | { kind: "draft"; key: string; site: Pick<Site, "id" | "name">; item: Item; message: Message; userMessage?: string; at: string }
  | { kind: "decision"; key: string; site: Pick<Site, "id" | "name">; item: Item; at: string }
  | { kind: "new"; key: string; site: Pick<Site, "id" | "name">; item: Item; message: Message; at: string }
  | { kind: "unanswered"; key: string; site: Pick<Site, "id" | "name">; item: Item; at: string };

const ORDER = { draft: 0, decision: 1, new: 2, unanswered: 3 } as const;

export function entriesOf(a: AttentionT): Entry[] {
  const out: Entry[] = [
    ...a.drafts.map((d) => ({ kind: "draft" as const, key: `d-${d.message.id}`, site: d.site, item: d.item, message: d.message, at: d.message.createdAt })),
    ...a.decisions.map((d) => ({ kind: "decision" as const, key: `q-${d.item.id}`, site: d.site, item: d.item, at: d.item.createdAt })),
    ...a.newFromUsers.map((d) => ({ kind: "new" as const, key: `n-${d.item.id}`, site: d.site, item: d.item, message: d.message, at: d.message.createdAt })),
    ...a.unanswered.map((d) => ({ kind: "unanswered" as const, key: `u-${d.item.id}`, site: d.site, item: d.item, at: d.item.lastUserMessageAt ?? d.item.updatedAt })),
  ];
  // Drafts first, then the rest; blocking questions lead the decisions; newest first within each.
  return out.sort((x, y) => {
    if (ORDER[x.kind] !== ORDER[y.kind]) return ORDER[x.kind] - ORDER[y.kind];
    if (x.kind === "decision" && y.kind === "decision") {
      const b = Number(!!y.item.decision?.blocking) - Number(!!x.item.decision?.blocking);
      if (b) return b;
    }
    return y.at.localeCompare(x.at);
  });
}

export function AttentionScreen() {
  const { attention, api, pending, approve, me, meError, refreshQuiet } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [failed, setFailed] = useState<Record<string, { body?: string; offline: boolean; message: string }>>({});
  const [userMsgs, setUserMsgs] = useState<Record<string, Message | null>>({});
  const [viewer, setViewer] = useState<Item | null>(null);
  const [keys, setKeys] = useState(false);
  const [cur, setCur] = useState(0);
  // Cards stay where they were while their undo runs, even after the queue reloads.
  const held = useRef(new Map<string, Entry>());

  const live = useMemo(() => (attention ? entriesOf(attention) : []), [attention]);
  const entries = useMemo(() => {
    const ids = new Set(live.map((e) => e.key));
    const out = [...live];
    for (const p of pending) {
      const key = `d-${p.messageId}`;
      const h = held.current.get(key);
      if (h && !ids.has(key)) out.push(h);
    }
    for (const e of live) if (e.kind === "draft") held.current.set(e.key, e);
    return out.sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || y.at.localeCompare(x.at));
  }, [live, pending]);

  // The user's last message for each draft card (the reason the agent replied).
  useEffect(() => {
    for (const e of entries) {
      if (e.kind !== "draft" || e.item.id in userMsgs) continue;
      setUserMsgs((m) => ({ ...m, [e.item.id]: null }));
      api.item(e.site.id, e.item.id).then(
        (r) => {
          const last = [...r.messages].reverse().find((m) => m.author.kind === "user" && m.createdAt <= e.message.createdAt);
          setUserMsgs((m) => ({ ...m, [e.item.id]: last ?? null }));
        },
        () => undefined,
      );
    }
  }, [entries]);

  const isPending = (e: Entry) => e.kind === "draft" && pending.some((p) => p.messageId === e.message.id);
  const notPending = entries.filter((e) => !isPending(e));
  const counts = {
    all: notPending.length,
    draft: notPending.filter((e) => e.kind === "draft").length,
    decision: notPending.filter((e) => e.kind === "decision").length,
    new: notPending.filter((e) => e.kind === "new").length,
    unanswered: notPending.filter((e) => e.kind === "unanswered").length,
  };
  const shown = entries.filter((e) => filter === "all" || e.kind === filter);

  const target = (e: Extract<Entry, { kind: "draft" }>): DraftTarget => ({
    siteId: e.site.id,
    siteName: e.site.name,
    itemId: e.item.id,
    itemRef: itemRef(e.item),
    messageId: e.message.id,
    to: e.item.reporter?.name ?? "the user",
    signedAs: e.message.author.name,
    userMessage: userMsgs[e.item.id]?.body,
    draft: e.message.body,
  });

  const fail = (t: DraftTarget, body: string | undefined, err: ApiError) =>
    setFailed((f) => ({ ...f, [t.messageId]: { body, offline: err.offline, message: err.message } }));

  const doApprove = async (t: DraftTarget, body?: string) => {
    setFailed((f) => {
      const n = { ...f };
      delete n[t.messageId];
      return n;
    });
    try {
      await approve({ siteId: t.siteId, itemId: t.itemId, messageId: t.messageId, who: t.to, body });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "network", "No connection.");
      if (err.status === 409) {
        void refreshQuiet();
        return;
      }
      fail(t, body, err);
    }
  };

  const draftSheets = useDraftSheets({ onFail: fail });

  // Desktop shortcuts: j/k next and previous, a approve, e edit, r reject, ? the list.
  useEffect(() => {
    const on = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (ev.key === "?") {
        setKeys(true);
        return;
      }
      const cards = [...document.querySelectorAll<HTMLElement>("#queue article")];
      if (!cards.length) return;
      if (ev.key === "j" || ev.key === "k") {
        const n = Math.max(0, Math.min(cards.length - 1, cur + (ev.key === "j" ? 1 : -1)));
        setCur(n);
        cards[n]!.focus();
        return;
      }
      const c = cards[Math.min(cur, cards.length - 1)];
      const btn = (sel: string) => c?.querySelector<HTMLButtonElement>(sel);
      if (ev.key === "a") btn("[data-act=approve]")?.click();
      if (ev.key === "e") btn("[data-act=edit]")?.click();
      if (ev.key === "r") btn("[data-act=reject]")?.click();
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [cur]);

  const chips: Array<[Filter, string, boolean]> = [
    ["all", "All", false],
    ["draft", "To approve", true],
    ["decision", "Decisions and questions", false],
    ["new", "New from users", false],
    ["unanswered", "Unanswered", false],
  ];

  return (
    <section>
      <p class="sub">Everything waiting for a person, across your sites.</p>
      {meError && <ErrorCard error={{ message: meError, offline: true }} onRetry={() => void refreshQuiet()} />}
      <fieldset class="chips" aria-label="Show">
        <legend class="sr">Show</legend>
        {chips.map(([v, l, hot]) => (
          <label key={v}>
            <input type="radio" name="qf" value={v} checked={filter === v} onChange={() => setFilter(v)} />
            {l} <span class={`count${hot && counts[v] ? " hot" : ""}`}>{counts[v]}</span>
          </label>
        ))}
      </fieldset>
      {!attention && !meError && <p class="loading">Loading…</p>}
      <div class="stack" id="queue" aria-live="polite">
        {shown.map((e) => {
          const p = e.kind === "draft" ? pending.find((x) => x.messageId === e.message.id) : undefined;
          if (p) return <UndoBar key={e.key} pending={p} />;
          if (e.kind === "decision") return <DecisionCard key={e.key} e={e} />;
          if (e.kind === "new" || e.kind === "unanswered") return <UserCard key={e.key} e={e} onViewer={setViewer} />;
          const t = target(e);
          const f = failed[e.message.id];
          return (
            <article class="card qcard" key={e.key} data-id={e.message.id} tabIndex={-1} data-testid="draft-card">
              <CardHead e={e} tag={<span class="tag t-draft">Draft waiting</span>} />
              <div class="user">
                <Thumb item={e.item} button onOpen={() => setViewer(e.item)} label={`Open the screenshot sent with ${itemRef(e.item)}`} />
                <div>
                  <p class="meta">
                    <b style={{ color: "var(--text)" }}>{t.to}</b> · {itemType(e.item)}
                    {e.item.page?.path && (
                      <>
                        {" "}
                        · <code>{e.item.page.path}</code>
                      </>
                    )}
                  </p>
                  {userMsgs[e.item.id] && <Clamped text={userMsgs[e.item.id]!.body} />}
                </div>
              </div>
              <div class="draftbox">
                <p class="lbl">Agent's reply, to send as {t.signedAs}</p>
                <Markdown text={e.message.body} />
              </div>
              {f && (
                <div class="fail" role="alert">
                  <b>{f.offline ? "Not sent: no connection." : `Not sent: ${f.message}`}</b> {f.body ? "Your edit is kept." : "Your reply is kept."}{" "}
                  <button class="link" type="button" onClick={() => doApprove(t, f.body)}>
                    Try again
                  </button>
                  {f.body && (
                    <>
                      {" · "}
                      <button class="link" type="button" onClick={() => draftSheets.openEdit(t, f.body)}>
                        Edit
                      </button>
                    </>
                  )}
                </div>
              )}
              <div class="actions">
                <button class="btn primary lg" type="button" data-act="approve" onClick={() => doApprove(t, f?.body)}>
                  Approve and send
                </button>
                <button class="btn lg" type="button" data-act="edit" onClick={() => draftSheets.openEdit(t, f?.body)}>
                  Edit
                </button>
                <button class="btn danger lg" type="button" data-act="reject" onClick={() => draftSheets.openReject(t)}>
                  Reject
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {attention && shown.length === 0 && (
        <Empty title="Nothing is waiting for you">
          {filter === "all" ? "No drafts to approve, no decisions to answer, and every report has a reply." : "Nothing here. Choose All to see everything else."}
        </Empty>
      )}
      {me && (
        <p class="meta mt16 kbd">
          Press <kbd>?</kbd> for shortcuts
        </p>
      )}
      {draftSheets.sheets}
      <CaptureViewer item={viewer} tab="shot" onClose={() => setViewer(null)} />
      <Sheet open={keys} title="Keyboard shortcuts" onClose={() => setKeys(false)}>
        <p>
          <kbd>j</kbd> / <kbd>k</kbd> next / previous card · <kbd>a</kbd> approve · <kbd>e</kbd> edit · <kbd>r</kbd> reject · <kbd>?</kbd> this list
        </p>
      </Sheet>
    </section>
  );
}

function CardHead({ e, tag }: { e: Entry; tag: preact.ComponentChildren }) {
  return (
    <>
      <div class="top">
        <b>
          {e.site.name} · {itemRef(e.item)}
        </b>
        {tag}
        <span class="grow" />
        <span>{ago(e.at)}</span>
      </div>
      <h2>
        <a href={href.item(e.site.id, e.item.id)}>{e.item.title}</a>
      </h2>
    </>
  );
}

function Clamped({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el && !open) setOver(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <>
      <div ref={ref} class={open ? "" : "clamp clamp-3"}>
        <Markdown text={text} />
      </div>
      {over && !open && (
        <button class="link" type="button" onClick={() => setOpen(true)}>
          More
        </button>
      )}
    </>
  );
}

function DecisionCard({ e }: { e: Extract<Entry, { kind: "decision" }> }) {
  const d = e.item.decision;
  const n = d?.options.length ?? 0;
  const rec = d?.recommendation;
  return (
    <article class="card qcard" tabIndex={-1} data-testid="decision-card">
      <CardHead
        e={e}
        tag={
          <>
            <span class="tag t-open">{n ? "Decision waiting" : "Question waiting"}</span>
            {d?.blocking && <span class="tag t-block">Blocking</span>}
          </>
        }
      />
      <p class="meta">
        {d?.asker ? `Asked by ${d.asker.name}. ` : ""}
        {n ? `${n} option${n === 1 ? "" : "s"}${rec ? `; ${rec} is recommended` : ""}.` : "No options: it needs a written answer."}
      </p>
      <div class="actions">
        <button class="btn primary lg" type="button" onClick={() => go(href.item(e.site.id, e.item.id))}>
          Answer
        </button>
      </div>
    </article>
  );
}

function UserCard({ e, onViewer }: { e: Extract<Entry, { kind: "new" | "unanswered" }>; onViewer: (i: Item) => void }) {
  return (
    <article class="card qcard" tabIndex={-1}>
      <CardHead e={e} tag={e.kind === "new" ? <span class="tag t-open">New, no reply yet</span> : <span class="tag t-progress">Waiting for a reply</span>} />
      <div class="user">
        <Thumb item={e.item} button onOpen={() => onViewer(e.item)} label={`Open the screenshot sent with ${itemRef(e.item)}`} />
        <div>
          <p class="meta">
            <b style={{ color: "var(--text)" }}>{e.item.reporter?.name ?? "A user"}</b> · {itemType(e.item)}
            {e.item.page?.path && (
              <>
                {" "}
                · <code>{e.item.page.path}</code>
              </>
            )}
          </p>
          {e.kind === "new" && <Clamped text={e.message.body} />}
        </div>
      </div>
      <div class="actions">
        <button class="btn primary lg" type="button" onClick={() => go(href.item(e.site.id, e.item.id))}>
          Open and reply
        </button>
      </div>
    </article>
  );
}
