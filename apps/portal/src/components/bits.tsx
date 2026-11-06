// Small shared pieces: icons, Markdown, the undo bar, thumbnails, the switch.

import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Item, ItemStatus } from "@annotatie/core";
import { renderMarkdown } from "../markdown";
import { STATUS_CLASS, STATUS_LABEL } from "../format";
import { useStore, type Pending } from "../store";

export const Icon = {
  back: () => (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  refresh: () => (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
    </svg>
  ),
  attention: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4 13h4l2 3h4l2-3h4M5 5h14l1 8v6H4v-6z" />
    </svg>
  ),
  reports: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  decisions: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />
    </svg>
  ),
  more: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
  chevron: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
};

/** A message body: Markdown rendered by our own escaping renderer (never raw HTML). */
export function Markdown(props: { text: string; class?: string }) {
  const html = useMemo(() => renderMarkdown(props.text), [props.text]);
  return <div class={`md ${props.class ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function StatusTag(props: { status: ItemStatus }) {
  return <span class={`tag ${STATUS_CLASS[props.status]}`}>{STATUS_LABEL[props.status]}</span>;
}

/** The 10-second undo bar (M2). The countdown bar starts part-way when the window began earlier. */
export function UndoBar(props: { pending: Pending; testId?: string }) {
  const { undo } = useStore();
  const p = props.pending;
  const total = p.releaseAt - p.startedAt;
  const elapsed = Math.max(0, Date.now() - p.startedAt);
  const [busy, setBusy] = useState(false);
  return (
    <div class="undo" role="status" aria-live="polite" data-testid={props.testId ?? "undo"}>
      <span class="grow">Sent to {p.who}</span>
      <button
        class="btn"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await undo(p.messageId);
          setBusy(false);
        }}
      >
        Undo
      </button>
      <span class="bar" aria-hidden="true" style={{ animationDuration: `${total}ms`, animationDelay: `-${elapsed}ms` }} />
    </div>
  );
}

const thumbCache = new Map<string, { url: string; at: number }>();

/** A capture image (close-up, page or marked page) from a presigned URL, cached for 4 minutes. */
export function useCaptureUrl(item: Pick<Item, "id" | "siteId" | "capture">, file: "closeup" | "page" | "pageMarked"): string | null {
  const { api } = useStore();
  const has = !!item.capture?.files?.[file];
  const key = `${item.siteId}/${item.id}/${file}`;
  const cached = thumbCache.get(key);
  const [url, setUrl] = useState<string | null>(cached && Date.now() - cached.at < 240_000 ? cached.url : null);
  useEffect(() => {
    if (!has) return;
    const c = thumbCache.get(key);
    if (c && Date.now() - c.at < 240_000) {
      setUrl(c.url);
      return;
    }
    let live = true;
    api.captureUrl(item.siteId, item.id, file).then(
      (r) => {
        thumbCache.set(key, { url: r.url, at: Date.now() });
        if (live) setUrl(r.url);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [key, has]);
  return has ? url : null;
}

export function Thumb(props: { item: Item; button?: boolean; onOpen?: () => void; label?: string }) {
  const url = useCaptureUrl(props.item, "closeup");
  if (!props.item.capture?.files?.closeup) {
    const t = props.item.anchor ? "No picture" : "Whole page";
    return props.button ? (
      <span class="thumbbtn none" aria-hidden="true">
        {t}
      </span>
    ) : (
      <span class="th" aria-hidden="true">
        {t}
      </span>
    );
  }
  const img = url ? <img alt="" src={url} /> : null;
  if (!props.button) return url ? <img alt="" src={url} /> : <span class="th" aria-hidden="true" />;
  return (
    <button class="thumbbtn" type="button" aria-label={props.label ?? "Open the screenshot"} onClick={props.onOpen}>
      {img}
    </button>
  );
}

export function Switch(props: { checked: boolean; label: string; onChange: (on: boolean, e: Event) => void; disabled?: boolean; id?: string }) {
  return (
    <div class="switch">
      <input
        id={props.id}
        type="checkbox"
        role="switch"
        aria-label={props.label}
        checked={props.checked}
        disabled={props.disabled}
        onClick={(e) => {
          // The parent's state drives the switch: the click is undone here and re-applied on render.
          const t = e.currentTarget as HTMLInputElement;
          const next = t.checked;
          e.preventDefault();
          props.onChange(next, e);
        }}
      />
      <span />
    </div>
  );
}

export function Empty(props: { title: string; children?: ComponentChildren }) {
  return (
    <div class="card empty">
      <h2>{props.title}</h2>
      {props.children && <p class="meta mt8">{props.children}</p>}
    </div>
  );
}

export function ErrorCard(props: { error: { message: string; offline?: boolean }; onRetry?: () => void }) {
  return (
    <div class="fail" role="alert">
      <b>{props.error.offline ? "No connection." : "Something went wrong."}</b> {props.error.offline ? "Check your signal and try again." : props.error.message}{" "}
      {props.onRetry && (
        <button class="link" type="button" onClick={props.onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
