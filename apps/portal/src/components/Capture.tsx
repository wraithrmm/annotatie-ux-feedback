// "Page when reported" (capture-design.md §5, PT-2 §4.3): Screenshot, Page copy, Part, Details.
// The page copy is rendered ONLY inside <iframe sandbox="" srcdoc>, with a CSP meta tag put first:
// no scripts, no same-origin, nothing loaded from the network.

import { useEffect, useRef, useState } from "preact/hooks";
import type { Item } from "@annotatie/core";
import { bytes, dateTime } from "../format";
import { useStore } from "../store";
import { copyText, useCaptureUrl } from "./bits";

export type CapTab = "shot" | "copy" | "part" | "det";
const TABS: Array<[CapTab, string]> = [
  ["shot", "Screenshot"],
  ["copy", "Page copy"],
  ["part", "Part"],
  ["det", "Details"],
];

export const COPY_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`;

/** Puts the CSP meta tag at the top of the page copy (after a doctype, which must stay first). */
export function srcdocFor(html: string): string {
  const m = /^\s*<!doctype[^>]*>/i.exec(html);
  return m ? m[0] + COPY_CSP + html.slice(m[0].length) : COPY_CSP + html;
}

function describeBrowser(item: Item): string {
  const c = item.capture?.context;
  if (!c) return "";
  const parts = [`${c.viewport.width} × ${c.viewport.height}`];
  if (c.devicePixelRatio && c.devicePixelRatio !== 1) parts[0] += ` at ${c.devicePixelRatio}×`;
  if (c.userAgent) parts.push(c.userAgent);
  parts.push(dateTime(c.capturedAt));
  return parts.join(" · ");
}

export function captureSummary(item: Item): string {
  return describeBrowser(item);
}

export function CaptureTabs(props: { item: Item; tab: CapTab; onTab: (t: CapTab) => void; uid: string }) {
  const { item, tab, uid } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const keys = TABS.map((t) => t[0]);
  const pick = (t: CapTab) => {
    props.onTab(t);
    setTimeout(() => listRef.current?.querySelector<HTMLElement>(`[data-k="${t}"]`)?.focus(), 0);
  };
  return (
    <div>
      <div
        class="tabs"
        role="tablist"
        aria-label="Page when reported"
        ref={listRef}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          let i = keys.indexOf(tab);
          i = e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : (i + (e.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length;
          pick(keys[i]!);
        }}
      >
        {TABS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`${uid}-t-${k}`}
            aria-controls={`${uid}-p`}
            aria-selected={k === tab}
            tabIndex={k === tab ? 0 : -1}
            data-k={k}
            onClick={() => pick(k)}
          >
            {l}
          </button>
        ))}
      </div>
      <div class="tp" role="tabpanel" id={`${uid}-p`} aria-labelledby={`${uid}-t-${tab}`}>
        {tab === "shot" && <ShotTab item={item} />}
        {tab === "copy" && <CopyTab item={item} />}
        {tab === "part" && <PartTab item={item} />}
        {tab === "det" && <DetailsTab item={item} />}
      </div>
    </div>
  );
}

function ShotTab({ item }: { item: Item }) {
  const [outline, setOutline] = useState(true);
  const files = item.capture?.files ?? {};
  const marked = useCaptureUrl(item, "pageMarked");
  const plain = useCaptureUrl(item, "page");
  if (!files.page && !files.pageMarked) return <p class="meta">No screenshot was sent with this report.</p>;
  const src = outline && files.pageMarked ? marked : plain ?? marked;
  const who = item.reporter?.name ?? "the reporter";
  return (
    <>
      <figure style={{ margin: 0 }}>
        {src ? (
          <img class="shot" alt={`Screenshot of ${item.page?.path ?? "the page"} as ${who} saw it${outline && files.pageMarked ? ", with the part outlined" : ""}.`} src={src} />
        ) : (
          <p class="loading">Loading the screenshot…</p>
        )}
      </figure>
      <p class="meta mt8">
        {describeBrowser(item)}
        {item.capture?.context.method === "dom" ? " · drawn by the browser: videos, maps and pictures from other sites may be missing." : ""} Pinch to zoom.
      </p>
      {files.pageMarked && files.page && (
        <p>
          <button class="link" type="button" onClick={() => setOutline(!outline)}>
            {outline ? "Hide the outline" : "Show the outline"}
          </button>
        </p>
      )}
    </>
  );
}

function CopyTab({ item }: { item: Item }) {
  const { api } = useStore();
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const width = item.capture?.context.viewport.width ?? 390;
  const has = !!item.capture?.files?.html;
  useEffect(() => {
    if (!has) return;
    let live = true;
    api.captureHtml(item.siteId, item.id).then(
      (h) => live && setHtml(h),
      (e: Error) => live && setErr(e.message),
    );
    return () => {
      live = false;
    };
  }, [item.id, has]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / width));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html, width]);
  if (!has) return <p class="meta">No page copy was sent with this report.</p>;
  if (err) return <p class="err">{err}</p>;
  if (html === null) return <p class="loading">Loading the page copy…</p>;
  const live = item.page?.url && /^https?:\/\//i.test(item.page.url) ? item.page.url : null;
  const download = () => {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${item.number}-page-copy.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const masked = item.capture?.context.masked;
  return (
    <>
      <div class="copywrap" ref={wrap}>
        <iframe
          sandbox=""
          srcdoc={srcdocFor(html)}
          title={`Copy of the page ${item.page?.path ?? ""} when report ${item.number} was sent`}
          style={{ width: `${width}px`, height: `${Math.round(100 / scale)}%`, transform: `scale(${scale})` }}
        />
      </div>
      <p class="row mt8">
        {live && (
          <a class="link" href={live} target="_blank" rel="noopener noreferrer">
            Open the live page
          </a>
        )}
        <button class="link" type="button" onClick={download}>
          Download HTML
        </button>
      </p>
      <p class="meta">
        Copy of the page's HTML{item.capture?.files.html ? ` · ${bytes(item.capture.files.html.size)} gzipped` : ""} · scripts removed, links do nothing
        {masked?.fields ? ` · ${masked.fields} field${masked.fields === 1 ? "" : "s"} left blank` : ""}.
      </p>
    </>
  );
}

function PartTab({ item }: { item: Item }) {
  const { toast } = useStore();
  const p = item.capture?.part;
  if (!p) return <p class="meta">Whole page: no part was chosen.</p>;
  const b = p.box.screenshot;
  return (
    <>
      <dl>
        <dt>Readable anchor</dt>
        <dd>{p.label ?? item.anchor?.label ?? "—"}</dd>
        <dt>Selector</dt>
        <dd>
          <code>{p.selector}</code>
        </dd>
        {(p.role || p.name) && (
          <>
            <dt>Role and name</dt>
            <dd>{[p.role, p.name ? `“${p.name}”` : ""].filter(Boolean).join(", ")}</dd>
          </>
        )}
        <dt>Box</dt>
        <dd>
          x {Math.round(b.x)}, y {Math.round(b.y)}, {Math.round(b.width)} × {Math.round(b.height)} on the screenshot
        </dd>
        {p.text && (
          <>
            <dt>Text</dt>
            <dd>{p.text}</dd>
          </>
        )}
        {p.styles && Object.keys(p.styles).length > 0 && (
          <>
            <dt>Styles</dt>
            <dd>
              {Object.entries(p.styles)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </dd>
          </>
        )}
        {p.ancestors && p.ancestors.length > 0 && (
          <>
            <dt>Inside</dt>
            <dd>
              <code>{p.ancestors.join(" › ")}</code>
            </dd>
          </>
        )}
      </dl>
      {p.outerHTML && (
        <>
          <h3 class="mt12">HTML of the part</h3>
          <pre>
            <code>{p.outerHTML}</code>
          </pre>
          <p class="mt8">
            <button class="btn" type="button" onClick={async () => toast((await copyText(p.outerHTML!)) ? "HTML copied" : "Couldn't copy. Select the text instead.")}>
              Copy the HTML
            </button>
          </p>
        </>
      )}
    </>
  );
}

function DetailsTab({ item }: { item: Item }) {
  const c = item.capture?.context;
  if (!c) return <p class="meta">No details were sent with this report.</p>;
  const f = item.capture?.files ?? {};
  const method = c.method === "dom" ? "Drawn by the browser" : c.method === "screen" ? "Screen capture" : "None";
  return (
    <dl>
      <dt>Page</dt>
      <dd>
        <code>{c.url}</code>
      </dd>
      {c.route && (
        <>
          <dt>Route</dt>
          <dd>
            <code>{c.route}</code>
            {c.title ? ` · “${c.title}”` : ""}
          </dd>
        </>
      )}
      {!c.route && c.title && (
        <>
          <dt>Title</dt>
          <dd>{c.title}</dd>
        </>
      )}
      {c.buildId && (
        <>
          <dt>Build</dt>
          <dd>
            <code>{c.buildId}</code>
          </dd>
        </>
      )}
      <dt>Screen</dt>
      <dd>
        {c.viewport.width} × {c.viewport.height} at {c.devicePixelRatio}×, scrolled {Math.round(c.scroll.y)} px
      </dd>
      {c.userAgent && (
        <>
          <dt>Browser</dt>
          <dd>{c.userAgent}</dd>
        </>
      )}
      <dt>Screenshot</dt>
      <dd>
        {method}
        {f.page ? ` · ${bytes(f.page.size)}` : ""}
      </dd>
      {f.html && (
        <>
          <dt>Page copy</dt>
          <dd>{bytes(f.html.size)} gzipped</dd>
        </>
      )}
      {c.masked && (
        <>
          <dt>Masked</dt>
          <dd>
            {c.masked.fields} field{c.masked.fields === 1 ? "" : "s"}, {c.masked.elements} element{c.masked.elements === 1 ? "" : "s"}
          </dd>
        </>
      )}
      {c.notes && c.notes.length > 0 && (
        <>
          <dt>Notes</dt>
          <dd>{c.notes.join(" · ")}</dd>
        </>
      )}
      <dt>Captured</dt>
      <dd>{dateTime(c.capturedAt)}</dd>
    </dl>
  );
}
