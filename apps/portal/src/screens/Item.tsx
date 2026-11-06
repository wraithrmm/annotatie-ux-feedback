// A report (thread) or a decision, as a pushed screen (PT-2 §4.3, §4.5).
// Reading order is the order of the decision: summary, then what the user saw, then the messages,
// then a sticky action bar while a draft is pending.

import { useEffect, useState } from "preact/hooks";
import { ITEM_STATUSES, type Item, type ItemStatus, type Message } from "@annotatie/core";
import { ApiError } from "../api";
import { ago, clock, dateTime, initials, itemRef, itemType, STATUS_CLASS, STATUS_LABEL } from "../format";
import { go, href } from "../router";
import { useLoad, useStore, type Pending } from "../store";
import { ErrorCard, Icon, Markdown, Thumb, UndoBar, useCaptureUrl } from "../components/bits";
import { CaptureTabs, captureSummary, type CapTab } from "../components/Capture";
import { CaptureViewer } from "../components/CaptureViewer";
import { useDraftSheets, type DraftTarget } from "../components/DraftSheets";
import { Sheet } from "../components/Sheet";

export function ItemScreen(props: { siteId: string; itemId: string; setTitle: (t: string) => void }) {
  const { api, me } = useStore();
  const q = useLoad(() => api.item(props.siteId, props.itemId), [props.siteId, props.itemId]);
  const site = me?.sites.find((s) => s.id === props.siteId);
  useEffect(() => {
    if (q.data) props.setTitle(itemRef(q.data.item));
  }, [q.data]);
  if (q.error && !q.data) return <ErrorCard error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p class="loading">Loading…</p>;
  const { item, messages } = q.data;
  if (item.kind === "decision") return <DecisionView item={item} siteName={site?.name ?? ""} onSaved={q.reload} />;
  return <Thread item={item} messages={messages} siteName={site?.name ?? ""} reload={q.reload} setItem={(it) => q.set({ ...q.data!, item: it })} />;
}

function Thread(props: { item: Item; messages: Message[]; siteName: string; reload: () => void; setItem: (i: Item) => void }) {
  const { item, messages, siteName } = props;
  const { api, toast, pending, refreshQuiet, approve } = useStore();
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusPick, setStatusPick] = useState<ItemStatus>(item.status);
  const [viewer, setViewer] = useState<CapTab | null>(null);
  const [panelTab, setPanelTab] = useState<CapTab>("shot");
  const [compose, setCompose] = useState<{ vis: "internal" | "user"; text: string; busy: boolean } | null>(null);
  const [failed, setFailed] = useState<{ body?: string; message: string } | null>(null);
  const [, tick] = useState(0);

  const to = item.reporter?.name ?? "the user";
  const draft = [...messages].reverse().find((m) => m.state === "draft" && m.visibility === "user");
  const userMsg = draft ? [...messages].reverse().find((m) => m.author.kind === "user" && m.createdAt <= draft.createdAt) : undefined;
  // The undo window: from this tab's approval, or (after a reload) from the server's releaseAt.
  const now = Date.now();
  const serverHeld = messages.find((m) => m.state === "published" && !m.autoApproved && m.releaseAt && Date.parse(m.releaseAt) > now);
  const held: Pending | undefined =
    pending.find((p) => p.itemId === item.id) ??
    (serverHeld
      ? { siteId: item.siteId, itemId: item.id, messageId: serverHeld.id, who: to, startedAt: Date.parse(serverHeld.publishedAt ?? serverHeld.createdAt), releaseAt: Date.parse(serverHeld.releaseAt!) }
      : undefined);
  useEffect(() => {
    if (!serverHeld || pending.some((p) => p.messageId === serverHeld.id)) return;
    const t = setTimeout(() => {
      tick((x) => x + 1);
      props.reload();
    }, Math.max(0, Date.parse(serverHeld.releaseAt!) - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [serverHeld?.id]);

  const target: DraftTarget | null = draft
    ? { siteId: item.siteId, siteName, itemId: item.id, itemRef: itemRef(item), messageId: draft.id, to, signedAs: draft.author.name, userMessage: userMsg?.body, draft: draft.body }
    : null;
  const sheets = useDraftSheets({
    onFail: (_t, body, e) => setFailed({ body, message: e.offline ? "no connection" : e.message }),
    onDone: () => setFailed(null),
  });
  const doApprove = async (body?: string) => {
    if (!target) return;
    setFailed(null);
    try {
      await approve({ siteId: item.siteId, itemId: item.id, messageId: target.messageId, who: to, body });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "network", "No connection.");
      if (err.status === 409) props.reload();
      else setFailed({ body, message: err.offline ? "no connection" : err.message });
    }
  };

  const saveStatus = async () => {
    try {
      const it = await api.patchItem(item.siteId, item.id, { status: statusPick });
      props.setItem({ ...item, ...it });
      setStatusOpen(false);
      toast(`Status: ${STATUS_LABEL[statusPick]}`);
      void refreshQuiet();
    } catch (e) {
      toast((e as ApiError).offline ? "Not saved: no connection." : (e as Error).message);
    }
  };

  const post = async () => {
    if (!compose) return;
    const body = compose.text.trim();
    if (!body) {
      toast("Write something first");
      return;
    }
    setCompose({ ...compose, busy: true });
    try {
      await api.postMessage(item.siteId, item.id, { body, visibility: compose.vis });
      toast(compose.vis === "user" ? `Reply sent to ${to}` : "Note posted");
      setCompose(null);
      props.reload();
      void refreshQuiet();
    } catch (e) {
      setCompose({ ...compose, busy: false });
      toast((e as ApiError).offline ? "Not posted: no connection. Your text is kept." : (e as Error).message);
    }
  };

  const hasCapture = !!item.capture && Object.keys(item.capture.files ?? {}).length > 0;
  const metaBits = [itemType(item), item.anchor?.label, to, ago(item.createdAt)].filter(Boolean);

  return (
    <section>
      <div class="thread">
        <div class="th-head">
          <div class="row">
            <span class="meta">
              {siteName} · {itemRef(item)}
            </span>
            <span class="grow" />
            <button class="statuschip" type="button" aria-haspopup="dialog" onClick={() => (setStatusPick(item.status), setStatusOpen(true))}>
              <span class={`tag ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span>
              <span class="sr">Change status</span>
              <Icon.chevron />
            </button>
          </div>
          <h1 tabIndex={-1}>{item.title}</h1>
          <p class="meta">
            {metaBits[0]}
            {item.page?.path && (
              <>
                {" · "}
                <code>{item.page.path}</code>
              </>
            )}
            {metaBits.slice(1).map((b) => ` · ${b}`)}
          </p>
        </div>

        <aside class="capcol">
          {hasCapture ? (
            <>
              <CaptureCard item={item} onOpen={setViewer} />
              <div class="card cappanel">
                <h2 style={{ marginBottom: "6px" }}>Page when reported</h2>
                <CaptureTabs item={item} tab={panelTab} onTab={setPanelTab} uid="pn" />
              </div>
            </>
          ) : (
            item.kind === "report" && (
              <div class="card">
                <h2>Page when reported</h2>
                <p class="meta mt8">{item.page ? `Whole page: ${item.page.path}. No screenshot or page copy was sent.` : "Nothing was captured with this report."}</p>
              </div>
            )
          )}
        </aside>

        <div class="stack" id="msgs">
          {messages.map((m) => (
            <MessageView key={m.id} m={m} to={to} held={held?.messageId === m.id} />
          ))}
          {messages.length === 0 && <p class="meta">No messages yet.</p>}
        </div>

        <div class="actionbar" data-testid="actionbar">
          {held ? (
            <UndoBar pending={held} />
          ) : target ? (
            <>
              <p class="lbl">Draft waiting: the user can't see it yet</p>
              {failed && (
                <div class="fail" role="alert">
                  <b>Not sent: {failed.message}.</b> {failed.body ? "Your edit is kept." : "Your reply is kept."}{" "}
                  <button class="link" type="button" onClick={() => doApprove(failed.body)}>
                    Try again
                  </button>
                </div>
              )}
              <div class="acts">
                <button class="btn primary lg" type="button" onClick={() => doApprove(failed?.body)}>
                  Approve and send
                </button>
                <button class="btn lg" type="button" onClick={() => sheets.openEdit(target, failed?.body)}>
                  Edit
                </button>
                <button class="btn danger lg" type="button" onClick={() => sheets.openReject(target)}>
                  Reject
                </button>
              </div>
            </>
          ) : (
            <button class="btn lg block" type="button" onClick={() => setCompose({ vis: "internal", text: "", busy: false })}>
              Write a note or reply
            </button>
          )}
        </div>
      </div>

      {sheets.sheets}
      <CaptureViewer item={viewer ? item : null} tab={viewer ?? "shot"} onClose={() => setViewer(null)} />

      <Sheet
        open={statusOpen}
        title={`Status of ${itemRef(item)}`}
        onClose={() => setStatusOpen(false)}
        footer={
          <>
            <button class="btn lg" type="button" onClick={() => setStatusOpen(false)}>
              Cancel
            </button>
            <button class="btn primary lg" type="button" onClick={saveStatus}>
              Save
            </button>
          </>
        }
      >
        <fieldset class="optlist">
          <legend class="sr">Status</legend>
          {ITEM_STATUSES.map((s) => (
            <label class="opt" key={s}>
              <input type="radio" name="st" value={s} checked={statusPick === s} onChange={() => setStatusPick(s)} />
              <span>{STATUS_LABEL[s]}</span>
            </label>
          ))}
        </fieldset>
      </Sheet>

      <Sheet
        open={!!compose}
        full
        title={`Write on ${itemRef(item)}`}
        onClose={() => setCompose(null)}
        footer={
          <>
            <button class="btn lg" type="button" onClick={() => setCompose(null)}>
              Cancel
            </button>
            <button class="btn primary lg" type="button" disabled={compose?.busy} onClick={post}>
              {compose?.vis === "user" ? "Send reply" : "Post note"}
            </button>
          </>
        }
      >
        {compose && (
          <>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend class="sr">Who sees it</legend>
              <div class="seg">
                <label>
                  <input type="radio" name="vis" value="internal" checked={compose.vis === "internal"} onChange={() => setCompose({ ...compose, vis: "internal" })} />
                  Internal note
                </label>
                <label>
                  <input type="radio" name="vis" value="user" checked={compose.vis === "user"} onChange={() => setCompose({ ...compose, vis: "user" })} />
                  Reply to the user
                </label>
              </div>
            </fieldset>
            {compose.vis === "user" && <p class="warnline">{to} will see this, signed as you.</p>}
            <div class="field">
              <label for="cmp-ta">Message</label>
              <textarea
                class="big"
                id="cmp-ta"
                value={compose.text}
                placeholder={compose.vis === "user" ? `${to} will see this.` : "Only people on the portal see an internal note."}
                onInput={(e) => setCompose({ ...compose, text: e.currentTarget.value })}
              />
            </div>
          </>
        )}
      </Sheet>
    </section>
  );
}

function CaptureCard({ item, onOpen }: { item: Item; onOpen: (t: CapTab) => void }) {
  const shot = useCaptureUrl(item, item.capture?.files.closeup ? "closeup" : "pageMarked");
  return (
    <div class="card capcard phoneonly">
      {(item.capture?.files.closeup || item.capture?.files.pageMarked) && (
        <button class="hero" type="button" aria-label="Open the screenshot full screen" onClick={() => onOpen("shot")}>
          {shot ? <img alt="" src={shot} /> : <span class="th" aria-hidden="true" />}
        </button>
      )}
      <div class="in">
        <h2>Page when reported</h2>
        <p class="meta">{captureSummary(item)}</p>
        <div class="capbtns">
          <button class="btn" type="button" onClick={() => onOpen("shot")}>
            Screenshot
          </button>
          <button class="btn" type="button" onClick={() => onOpen("copy")}>
            Page copy
          </button>
          <button class="btn" type="button" onClick={() => onOpen("part")}>
            Part
          </button>
          <button class="btn" type="button" onClick={() => onOpen("det")}>
            Details
          </button>
        </div>
      </div>
    </div>
  );
}

/** One message. Told apart by more than colour: a labelled tag, a border style and a background. */
function MessageView({ m, to, held }: { m: Message; to: string; held: boolean }) {
  let cls = "msg";
  let tag: { c: string; t: string };
  if (m.state === "draft") {
    cls += " drafted";
    tag = { c: "t-draft", t: "Draft · the user can't see it yet" };
  } else if (m.state === "rejected") {
    cls += " rejected";
    tag = { c: "t-internal", t: `Rejected${m.rejectedReason ? ` · ${m.rejectedReason}` : ""}` };
  } else if (m.visibility === "internal") {
    cls += " internal";
    tag = { c: "t-internal", t: "Internal note" };
  } else if (m.author.kind === "user") {
    tag = { c: "t-client", t: "User" };
  } else if (held) {
    tag = { c: "t-draft", t: "Sending in a few seconds" };
  } else {
    tag = { c: "t-client", t: m.autoApproved ? `Sent to ${to} · auto-approved` : `Sent to ${to}` };
  }
  const via = m.via && m.via.kind !== "portal" && m.via.kind !== "widget" ? m.via.clientName ?? (m.via.kind === "token" ? "a personal access token" : "an agent") : null;
  return (
    <article class={cls} data-state={m.state} data-visibility={m.visibility}>
      <header>
        <span class="av" aria-hidden="true">
          {initials(m.author.name)}
        </span>
        <span class="who">{m.author.name}</span>
        <span class={`tag ${tag.c}`}>{tag.t}</span>
        <span class="meta" title={dateTime(m.createdAt)}>
          {clock(new Date(m.createdAt))}
        </span>
      </header>
      {via && (
        <p class="via" style={{ margin: "-4px 0 6px" }}>
          via {via}
          {m.approvedBy && m.state === "published" ? ` · approved by ${m.approvedBy.name}` : ""}
          {m.editedAt ? " · edited before sending" : ""}
        </p>
      )}
      <Markdown text={m.body} />
    </article>
  );
}

function DecisionView({ item, siteName, onSaved }: { item: Item; siteName: string; onSaved: () => void }) {
  const { api, toast, refreshQuiet } = useStore();
  const d = item.decision!;
  const [opt, setOpt] = useState<string | undefined>(d.recommendation ?? d.options[0]?.label);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const free = d.options.length === 0;
  const answered = d.status !== "waiting";

  const record = async () => {
    if (free && !text.trim()) {
      setErr("Write an answer");
      setTimeout(() => document.getElementById("dn")?.focus(), 0);
      return;
    }
    setBusy(true);
    try {
      await api.answer(item.siteId, item.id, free ? { text: text.trim() } : { option: opt, ...(text.trim() ? { text: text.trim() } : {}) });
      toast(free ? "Answer recorded. The agent will see it." : `Answer recorded: ${opt}. The agent will see it.`);
      void refreshQuiet();
      go(href.decisions());
    } catch (e) {
      setBusy(false);
      setErr((e as ApiError).offline ? "Not recorded: no connection. Try again." : (e as Error).message);
    }
  };

  return (
    <section>
      <p class="meta">
        {siteName} · {itemRef(item)} · internal
        {d.asker ? ` · asked by ${d.asker.name}${d.asker.session ? ` (session ${d.asker.session})` : ""}` : ""}
        {item.links.length > 0 && (
          <>
            {" · linked to "}
            {item.links.map((l, i) => (
              <>
                {i > 0 && ", "}
                <a href={href.item(item.siteId, l)}>a report</a>
              </>
            ))}
          </>
        )}
      </p>
      <div class="row" style={{ margin: "6px 0 8px" }}>
        {d.blocking && <span class="tag t-block">Blocking</span>}
        <span class={`tag ${answered ? "t-resolved" : "t-open"}`}>{d.status === "waiting" ? "Waiting for you" : d.status === "answered" ? "Answered" : "Withdrawn"}</span>
      </div>
      <h1 style={{ margin: "6px 0 8px" }} tabIndex={-1}>
        {d.question}
      </h1>
      {d.context && <Markdown class="sub" text={d.context} />}
      {d.status === "withdrawn" && <p class="callout mt16">Withdrawn{d.withdrawnReason ? `: ${d.withdrawnReason}` : "."}</p>}
      {d.status === "answered" && d.answer && (
        <div class="callout mt16">
          <b>
            Answered {d.answer.option ? d.answer.option : ""} by {d.answer.by.name}, {ago(d.answer.at)}
          </b>
          {d.answer.text && <Markdown text={d.answer.text} />}
        </div>
      )}
      {!free && (
        <fieldset class="optlist" style={{ margin: "16px 0" }} disabled={answered}>
          <legend class="sr">Options</legend>
          {d.options.map((o) => (
            <label class="opt" key={o.label}>
              <input type="radio" name="dopt" value={o.label} checked={(answered ? d.answer?.option : opt) === o.label} onChange={() => setOpt(o.label)} />
              <span>
                <b>
                  {o.label}. {o.text}
                </b>{" "}
                {d.recommendation === o.label && <span class="tag t-client">Recommended</span>}
                {o.consequence && (
                  <>
                    <br />
                    <span class="meta">{o.consequence}</span>
                  </>
                )}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {!answered && (
        <>
          <div class={`field${free ? " mt16" : ""}`}>
            <label for="dn">{free ? "Your answer" : "Note for the agent (optional)"}</label>
            {free && <span class="meta">Required: this question has no options.</span>}
            {err && (
              <p class="err" role="alert">
                {err}
              </p>
            )}
            {free ? (
              <textarea id="dn" required aria-required="true" value={text} onInput={(e) => (setText(e.currentTarget.value), setErr(null))} />
            ) : (
              <input id="dn" type="text" value={text} onInput={(e) => setText(e.currentTarget.value)} />
            )}
          </div>
          <div class="actionbar" style={{ marginTop: "16px" }}>
            <button class="btn primary lg block" type="button" disabled={busy} onClick={record}>
              Record answer
            </button>
          </div>
        </>
      )}
      {answered && (
        <p class="mt16">
          <button class="btn" type="button" onClick={onSaved}>
            Refresh
          </button>
        </p>
      )}
    </section>
  );
}


