// RW-1 (approved 3 Nov 2026) with amendment RW-1a (the capture, approved 6 Nov 2026), built as a
// host-page overlay inside a closed shadow root. Copy is the prototypes' own; every string that came
// from the page or the API is escaped before it is drawn.
import type { Anchor, CaptureFile, Item, Message, PageRef } from "@annotatie/core";
import { buildAnchor, findAnchor, isWidgetNode, pickPart, readableLabel, SELECTABLE } from "../anchor.js";
import { ApiError, type Api, type Me } from "../api.js";
import { CaptureJob } from "../capture/index.js";
import { screenCaptureOffered } from "../capture/screen.js";
import { asAt, dateOnly, dateTime, esc, initials, plural, size, thousands } from "../format.js";
import { watchDom, watchUrl, type Watcher } from "../spa.js";
import { uploadCapture } from "../upload.js";
import { mi, oi, si } from "./icons.js";
import { isResolved, listOrder, makeTitle, pageName, samePath, splitTitle, STATUS, statusTag, toneOf, TYPES, type ReportType } from "./model.js";
import { STYLES } from "./styles.js";
import { themeCss, type ThemeName } from "./theme.js";

export const MAX_BODY = 5000;
const SHOT_GRACE_MS = 3000;
const OPEN_KEY = "annotatie:open";

export interface WidgetConfig {
  api: Api;
  theme: ThemeName;
  buildId?: string;
  signInUrl?: string;
  route?: () => string | undefined;
}

type Failure = "" | "failed" | "failed-again" | "offline" | "signedout" | "limit";

interface ComposeState {
  target: Element | null;
  label: string;
  anchor?: Anchor;
  type: ReportType;
  draft: string;
  status: "" | "invalid" | "toolong" | "sending" | "sent" | Failure;
  failures: number;
  reference?: string;
  length?: number;
  job: CaptureJob;
  sent?: Item;
  sentVariant?: "ok" | "noshot" | "nohtml";
  realAsked: boolean;
  thumbUrl?: string;
  page: PageRef;
}

interface ListState {
  kind: "list";
  tab: "page" | "mine";
  load: "loading" | "ready" | "error" | "error-again";
  mine: Item[] | null;
  asAt: Date;
  failures: number;
  reference?: string;
}

interface ThreadState {
  kind: "thread";
  id: string;
  item?: Item;
  messages?: Message[];
  load: "loading" | "ready" | "error" | "error-again";
  failures: number;
  back: boolean;
  reply: string;
  sub: "" | "invalid" | "toolong" | "sent" | Failure;
  replyFailures: number;
  /** The reporter's "it's sorted" button: idle, sending, done, or failed. */
  closing?: "sending" | "closed" | "failed";
  reference?: string;
  reopened?: boolean;
  thumbUrl?: string;
  length?: number;
}

interface ViewerState {
  from: "compose" | "thread";
  tab: "shot" | "copy";
  opener: string;
  shotUrl?: string | null;
  html?: string | null;
  loading?: boolean;
}

const phoneQuery = "(max-width: 639px)";

export class Widget {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly doc: Document;
  private readonly win: Window;
  private readonly api: Api;
  private me: Me | null = null;
  private items: Item[] = [];
  private itemsLoaded = false;
  private mode = false;
  private hover: Element | null = null;
  private hl: Element | null = null;
  private show: string | null = null;
  private compose: ComposeState | null = null;
  private panel: ListState | ThreadState | null = null;
  private viewer: ViewerState | null = null;
  private showResolved = false;
  private path: string;
  private titleBefore: string | null = null;
  private bodyInertBefore = false;
  private addedTabindex = new Set<Element>();
  private partCache = new Map<string, Element | null>();
  private watchers: Watcher[] = [];
  private cleanups: Array<() => void> = [];
  private rafPending = false;
  private phone: boolean;
  private stopped = false;
  private lastFocus: Element | null = null;

  constructor(private readonly cfg: WidgetConfig, doc: Document = document) {
    this.doc = doc;
    this.win = doc.defaultView!;
    this.api = cfg.api;
    this.path = this.win.location.pathname;
    this.phone = this.win.matchMedia?.(phoneQuery).matches ?? false;
    this.host = doc.createElement("div");
    this.host.setAttribute("data-rw", "annotatie");
    // Nothing of the host's CSS reaches in; the host element takes no space and no pointer events.
    this.host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;";
    this.root = this.host.attachShadow({ mode: "closed" });
    this.root.innerHTML = `<style>${themeCss(cfg.theme)}${STYLES}</style>
      <div class="rw" data-rw>
        <div class="rw-boxes" data-slot="boxes"></div>
        <div class="rw-pins" data-slot="pins"></div>
        <div data-slot="fab"></div>
        <div data-slot="mode"></div>
        <div data-slot="overlay"></div>
        <div data-slot="viewer"></div>
        <p class="sr-only" role="status" aria-live="polite" data-slot="live"></p>
      </div>`;
  }

  private slot(name: string): HTMLElement {
    return this.root.querySelector(`[data-slot="${name}"]`) as HTMLElement;
  }
  private q<T extends Element = HTMLElement>(sel: string): T | null {
    return this.root.querySelector(sel) as T | null;
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    try {
      this.me = await this.api.me();
    } catch {
      this.me = null; // privacy mode unknown: treated as on (below), reporting still works
    }
    this.doc.documentElement.appendChild(this.host);
    this.bind();
    this.render();
    await this.loadItems();
    try {
      const open = this.win.sessionStorage.getItem(OPEN_KEY);
      if (open) {
        this.win.sessionStorage.removeItem(OPEN_KEY);
        this.openThread(open, false);
      }
    } catch {
      // Storage blocked: nothing to reopen.
    }
  }

  stop(): void {
    this.stopped = true;
    this.cleanups.forEach((f) => f());
    this.watchers.forEach((w) => w.stop());
    this.setPageInert(false);
    this.restoreTitle();
    this.addedTabindex.forEach((el) => el.removeAttribute("tabindex"));
    this.compose?.job.dispose();
    this.host.remove();
  }

  private get privacy(): boolean {
    return this.me ? this.me.site.privacyMode : true;
  }

  private on(target: Window | Document, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions | boolean) {
    target.addEventListener(type, fn as EventListener, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  private fromWidget(e: Event): boolean {
    return e.composedPath().includes(this.host);
  }

  private bind(): void {
    // The capture layer (RW-1 "Capture layer"): while report mode is on and no panel is open, the page's
    // own handlers never see a press; a press chooses the part. Scrolling still works.
    for (const type of ["click", "auxclick", "submit", "pointerdown", "pointerup", "mousedown", "mouseup", "dragstart", "contextmenu", "dblclick"]) {
      this.on(this.win, type, (e: MouseEvent) => this.onCapture(e), true);
    }
    this.on(this.win, "pointermove", (e: PointerEvent) => this.onPointerMove(e), { capture: true, passive: true });
    this.on(this.doc, "mouseout", (e: MouseEvent) => {
      if (!e.relatedTarget && this.hover) {
        this.hover = null;
        this.drawBoxes();
      }
    });
    this.on(this.win, "focusin", (e: FocusEvent) => this.onFocusIn(e), true);
    this.on(this.win, "keydown", (e: KeyboardEvent) => this.onKeyDown(e), true);
    this.on(this.win, "scroll", () => this.scheduleLayout(), { capture: true, passive: true });
    this.on(this.win, "resize", () => this.onResize(), { passive: true });
    const vv = this.win.visualViewport;
    if (vv) {
      const f = () => this.onResize();
      vv.addEventListener("resize", f);
      this.cleanups.push(() => vv.removeEventListener("resize", f));
    }
    this.root.addEventListener("click", (e) => this.onClick(e as MouseEvent));
    this.root.addEventListener("input", (e) => this.onInput(e));
    this.root.addEventListener("change", (e) => this.onChange(e));
    this.root.addEventListener("keydown", (e) => this.onRootKey(e as KeyboardEvent));
    this.watchers.push(
      watchUrl(this.win, () => this.onUrlChange()),
      watchDom(this.doc, () => {
        this.partCache.clear();
        this.renderPins();
      }),
    );
  }

  // ---------------------------------------------------------------- data

  private async loadItems(): Promise<boolean> {
    try {
      const { items } = await this.api.itemsOnPage(this.path);
      this.items = items.filter((i) => i.kind === "report");
      this.itemsLoaded = true;
      this.partCache.clear();
      this.renderFab();
      this.renderMode();
      this.renderPins();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.kind === "signin" && !this.mode && !this.panel) {
        // The host withdrew permission: show nothing more than the control (its next use reports it).
      }
      return false;
    }
  }

  private onUrlChange(): void {
    const path = this.win.location.pathname;
    if (path === this.path) {
      this.partCache.clear();
      this.renderPins();
      return;
    }
    this.path = path;
    this.items = [];
    this.show = null;
    this.hover = this.hl = null;
    this.partCache.clear();
    this.renderPins();
    this.renderFab();
    void this.loadItems();
  }

  private partFor(item: Item): Element | null {
    if (!item.anchor || !samePath(item, this.path)) return null;
    const cached = this.partCache.get(item.id);
    if (cached && cached.isConnected) return cached;
    if (cached === null && this.partCache.has(item.id)) return null;
    const el = findAnchor(item.anchor, this.doc);
    this.partCache.set(item.id, el);
    return el;
  }

  private unresolvedCount(): number {
    return this.items.filter((i) => !isResolved(i)).length;
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    this.renderFab();
    this.renderMode();
    this.renderOverlay();
    this.renderViewer();
    this.renderPins();
  }

  private say(text: string): void {
    const live = this.slot("live");
    live.textContent = "";
    this.win.setTimeout(() => (live.textContent = text), 30);
  }

  private overlayOpen(): boolean {
    return !!(this.compose || this.panel);
  }

  /** Re-renders a slot without losing the keyboard focus that was inside it. */
  private keepFocus(fn: () => void): void {
    const a = this.root.activeElement as HTMLElement | null;
    const act = a?.dataset?.act;
    const id = a?.dataset?.id;
    fn();
    if (!a || a.isConnected) return;
    const sel = act ? `[data-act="${act}"]${id ? `[data-id="${cssId(id)}"]` : ""}` : null;
    if (sel) this.q<HTMLElement>(sel)?.focus({ preventScroll: true });
  }

  private renderFab(): void {
    this.keepFocus(() => this.renderFabNow());
  }

  private renderFabNow(): void {
    const n = this.unresolvedCount();
    const what = n ? `${plural(n, "report")} on this page not yet resolved` : "no reports on this page";
    const pill = n ? `<span class="cpill" aria-hidden="true">${n}</span>` : "";
    const inert = this.overlayOpen() ? " inert" : "";
    this.slot("fab").innerHTML = `<button type="button" class="btn rw-fab" data-act="report" aria-pressed="${this.mode}" aria-label="Report, ${what}"${inert}>${oi("chat")}<span class="rw-word">Report</span>${pill}</button>`;
    this.liftFab();
  }

  private renderMode(): void {
    this.keepFocus(() => this.renderModeNow());
  }

  private renderModeNow(): void {
    const slot = this.slot("mode");
    if (!this.mode) {
      slot.innerHTML = "";
      return;
    }
    const n = this.unresolvedCount();
    const pill = n ? `<span class="sr-only">, </span><span class="cpill">${n}</span>` : "";
    const inert = this.overlayOpen() ? " inert" : "";
    slot.innerHTML = `<div class="rw-modebar" role="region" aria-label="Report mode"${inert}>
      <div class="mb-text">${si("cursor")}<p class="mb-h">${this.phone ? "Report mode: tap any part of the page to report on it." : "Report mode: select any part of the page to report on it. Nothing on the page works until you leave."}</p>
        <p class="mb-k">Tab or the arrow keys move the outline, Enter chooses, Esc leaves report mode.</p></div>
      <div class="mb-acts">
        <button type="button" class="btn btn--outline btn--sm" data-act="whole">${this.phone ? '<span aria-hidden="true">Whole page</span><span class="sr-only">Comment on the whole page</span>' : "Comment on the whole page"}</button>
        <button type="button" class="btn btn--outline btn--sm" data-act="list" aria-haspopup="dialog">Reports${pill}</button>
        <button type="button" class="btn btn--outline btn--sm" data-act="done">Done</button>
      </div></div>`;
  }

  private modeBarHeight(): number {
    const bar = this.q(".rw-modebar");
    return bar ? bar.getBoundingClientRect().height : 0;
  }

  /** The control lifts above the host's sticky bottom bars (elements marked `data-bottom-bar`). */
  private liftFab(): void {
    let lift = 0;
    this.doc.querySelectorAll("[data-bottom-bar]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height && r.bottom >= this.win.innerHeight - 2) lift = Math.max(lift, this.win.innerHeight - r.top);
    });
    const fab = this.q<HTMLElement>(".rw-fab");
    fab?.style.setProperty("--rw-lift", `${Math.round(lift)}px`);
  }

  private renderPins(): void {
    const slot = this.slot("pins");
    if (this.stopped) return;
    const visible = this.items
      .filter((i) => samePath(i, this.path) && (!isResolved(i) || this.showResolved) && this.partFor(i))
      .sort((a, b) => a.number - b.number);
    const inert = this.overlayOpen() ? " inert" : "";
    this.keepFocus(() => (slot.innerHTML = visible
      .map((i) => {
        const t = toneOf(i.status);
        const type = splitTitle(i.title).type;
        const label = `Report ${i.number}, ${STATUS[t].word}, ${type ? `${type}, ` : ""}about ${i.anchor?.label ?? "a part of the page"}`;
        return `<button type="button" class="rw-pin st-${t}${this.show === i.id ? " is-shown" : ""}" data-act="pin" data-id="${esc(i.id)}" aria-label="${esc(label)}"${inert}>${mi(STATUS[t].icon)}${i.number}</button>`;
      })
      .join("")));
    this.layout();
  }

  private scheduleLayout(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    this.win.requestAnimationFrame(() => {
      this.rafPending = false;
      this.layout();
    });
  }

  private onResize(): void {
    const phone = this.win.matchMedia?.(phoneQuery).matches ?? false;
    if (phone !== this.phone) {
      this.phone = phone;
      this.renderMode();
      if (this.compose) this.renderOverlay();
    }
    this.scheduleLayout();
  }

  /** Places pins, outlines and the anchored popover from the live page's geometry. */
  private layout(): void {
    if (this.stopped) return;
    const vw = this.win.innerWidth;
    const vh = this.win.innerHeight;
    const top = this.mode ? this.modeBarHeight() : 0;
    const placed: Array<{ x: number; y: number }> = [];
    this.root.querySelectorAll<HTMLElement>(".rw-pin").forEach((pin) => {
      const item = this.items.find((i) => i.id === pin.dataset.id);
      const el = item && this.partFor(item);
      if (!el) {
        pin.hidden = true;
        return;
      }
      const r = el.getBoundingClientRect();
      const pw = pin.offsetWidth || 50;
      let x = r.right - 10;
      let y = r.top - 18;
      if (x + pw > vw - 4) {
        x = vw - pw - 4;
        y = r.top - 30;
      }
      while (placed.some((q) => Math.abs(q.x - x) < 40 && Math.abs(q.y - y) < 30)) x -= 40;
      x = Math.max(4, x);
      placed.push({ x, y });
      pin.hidden = r.bottom < top || r.top > vh || r.width === 0;
      pin.style.left = `${Math.round(x)}px`;
      pin.style.top = `${Math.round(Math.max(top + 4, y))}px`;
    });
    this.drawBoxes();
    this.placePopover();
    this.liftFab();
  }

  private boxHtml(el: Element, kind: string): string {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > this.win.innerHeight || (!r.width && !r.height)) return "";
    const below = r.top - this.modeBarHeight() < 30;
    return `<div class="rw-box ${kind}${below ? " lbl-below" : ""}" style="left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px"><span class="rw-lbl">${esc(readableLabel(el))}</span></div>`;
  }

  private drawBoxes(): void {
    let h = "";
    const sel = this.compose?.target ?? null;
    const shownItem = this.show ? this.items.find((i) => i.id === this.show) : null;
    const shown = shownItem ? this.partFor(shownItem) : null;
    if (sel && this.compose) h += this.boxHtml(sel, "is-sel");
    else if (shown && !this.panel) h += this.boxHtml(shown, "is-sel");
    if (this.mode && !this.overlayOpen()) {
      if (this.hl && this.hl.isConnected) h += this.boxHtml(this.hl, "is-key");
      if (this.hover && this.hover !== this.hl && this.hover.isConnected) h += this.boxHtml(this.hover, "");
    }
    this.slot("boxes").innerHTML = h;
  }

  private placePopover(): void {
    const pop = this.q<HTMLElement>(".rw-pop");
    if (!pop || !this.compose) return;
    const vw = this.win.innerWidth;
    const vh = this.win.innerHeight;
    if (this.phone) {
      const vv = this.win.visualViewport;
      pop.classList.toggle("is-tall", !!vv && vv.height < vh - 120);
      pop.style.left = pop.style.top = "";
      return;
    }
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let x: number;
    let y: number;
    const el = this.compose.target;
    if (el && el.isConnected) {
      const r = el.getBoundingClientRect();
      x = Math.max(16, Math.min(r.left, vw - pw - 16));
      y = r.bottom + 12;
      if (y + ph > vh - 16) y = r.top - ph - 12;
      if (y < 16) y = Math.max(16, vh - ph - 16);
    } else {
      x = vw - pw - 24;
      y = Math.max(16, (vh - ph) / 2);
    }
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
  }

  // ---------------------------------------------------------------- the comment panel (RW-1 6–16, RW-1a)

  private renderOverlay(): void {
    const slot = this.slot("overlay");
    if (this.compose) slot.innerHTML = `<div class="rw-scrim" data-act="scrim"></div>${this.composeHtml(this.compose)}`;
    else if (this.panel?.kind === "list") slot.innerHTML = `<div class="rw-scrim" data-act="scrim"></div>${this.listHtml(this.panel)}`;
    else if (this.panel?.kind === "thread") slot.innerHTML = `<div class="rw-scrim" data-act="scrim"></div>${this.threadHtml(this.panel)}`;
    else slot.innerHTML = "";
    if (this.viewer) slot.querySelector('[role="dialog"]')?.setAttribute("inert", "");
    this.setPageInert(this.overlayOpen());
    this.renderFab();
    this.renderMode();
    this.layout();
  }

  private composeHtml(c: ComposeState): string {
    const head = `<div class="pop-hd"><div class="ht"><h2 id="rw-ph" tabindex="-1">New report</h2><p class="about">About: ${esc(c.label)}</p></div>
      <button type="button" class="btn btn--ghost btn--icon" aria-label="Close" data-act="cancel">${mi("x-mark")}</button></div>`;
    if (c.status === "sent" && c.sent) {
      const no = c.sent.number;
      const body =
        c.sentVariant === "noshot"
          ? this.callout("warning", `Report ${no} sent, without a screenshot`, "The screenshot was not ready in time, so it was left out. The page copy, your comment, the address, the screen size and the part you chose were sent.", "status")
          : c.sentVariant === "nohtml"
            ? this.callout("warning", `Report ${no} sent, without a copy of the page’s HTML`, "The page was larger than 2 MB, so its HTML was left out. The screenshot, your comment, the address, the screen size and the part you chose were sent.", "status")
            : this.callout("success", `Report ${no} sent`, `It is pinned on this page as ${no}. Replies appear in its thread and under My reports.`, "status");
      return `<div class="rw-pop" role="dialog" aria-modal="true" aria-labelledby="rw-ph">${head}
        <div class="pop-bd">${body}</div>
        <div class="pop-ft"><button type="button" class="btn btn--primary" data-act="sent-close">Close</button>
        <button type="button" class="btn btn--outline" data-act="open-new">Open the thread</button></div></div>`;
    }
    const ref = c.reference;
    const failCopy: Partial<Record<string, [string, string]>> = {
      failed: ["Your report was not sent", `Something went wrong on the server. Your comment is still here. Press Send report to try again. ${ref ? `If it fails again, send reference ${ref} to the system team.` : "If it fails again, tell the system team."}`],
      "failed-again": ["Your report was still not sent", `Something went wrong on the server again. Your comment is still here. ${ref ? `Send reference ${ref} to the system team, and try again later.` : "Tell the system team, and try again later."}`],
      offline: ["Your report was not sent", "There is no connection. Your comment is still here. Press Send report when you are back online."],
      signedout: ["Your report was not sent", "Your sign-in has ended. Your comment is still here. Sign in again in a new tab, then come back to this tab and press Send report."],
      limit: ["Your report was not sent", "You have sent as many reports as one person can in a day. Your comment is still here. Press Send report again tomorrow."],
    };
    const fc = failCopy[c.status];
    const fail = fc ? this.callout("danger", fc[0], fc[1], "alert", c.status === "signedout" ? this.signInLink() : "") : "";
    const invalid = c.status === "invalid";
    const toolong = c.status === "toolong";
    const errWords = invalid ? "Enter your comment" : `Your comment is ${thousands(c.length ?? c.draft.length)} characters. Shorten it to ${thousands(MAX_BODY)} or fewer.`;
    const sum = invalid || toolong ? this.errSummary("rw-es", "rw-ta", errWords) : "";
    const sending = c.status === "sending";
    const real = c.realAsked ? this.callout("info", "Your browser will ask what to share", "Choose “This tab”. Only one picture is taken, then sharing stops.", "status") : "";
    const types = TYPES.map((t) => `<label><input type="radio" name="rw-type" value="${t}"${c.type === t ? " checked" : ""}>${t}</label>`).join("");
    return `<div class="rw-pop" role="dialog" aria-modal="true" aria-labelledby="rw-ph"${sending ? ' aria-busy="true"' : ""}>${head}
      <div class="pop-bd">${real}${fail}${sum}
        <fieldset><legend class="legend">Type</legend><div class="segc">${types}</div></fieldset>
        <div class="fld${invalid || toolong ? " is-invalid" : ""}"><label class="lab" for="rw-ta">Comment</label><span class="hint" id="rw-hint">Say what you expected and what you saw.</span>
          ${invalid || toolong ? `<p class="err-msg" id="rw-err">${warnIcon()}${esc(errWords)}</p>` : ""}
          <textarea class="ta" id="rw-ta" rows="4" aria-describedby="rw-hint${invalid || toolong ? " rw-err" : ""}"${invalid || toolong ? ' aria-invalid="true"' : ""}>${esc(c.draft)}</textarea></div>
        <div id="rw-cap">${this.captureHtml(c)}</div>
      </div>
      <div class="pop-ft"><button type="button" class="btn btn--primary" data-act="send">${sending ? '<span class="spin" aria-hidden="true"></span>Sending…' : "Send report"}</button>
        <button type="button" class="btn btn--outline" data-act="cancel">Cancel</button></div></div>`;
  }

  private maskNote(): string {
    if (this.privacy) return "Password fields and every other form field are left blank.";
    return this.doc.querySelector("[data-annotatie-mask]") ? "Password fields and the fields this site marks as private are left blank." : "Password fields are left blank.";
  }

  /** RW-1a A1-1, A1-2, A1-3, A1-7. */
  private captureHtml(c: ComposeState): string {
    const job = c.job;
    if (job.shotStage === "working" || (job.copyStage === "working" && job.shotStage !== "ready")) {
      return `<div class="cap" aria-busy="true"><h3>Sent with your report</h3><span class="thumb skel-t" aria-hidden="true"></span><p class="cap-t">Taking a screenshot…</p><p class="cap-m">You can write your comment meanwhile.</p></div>`;
    }
    if (job.shotStage === "failed" || !job.shot) {
      const copy = job.html ? `A copy of this page, ${size(job.html.size)}` : "Your comment, the address, the screen size and the part you chose";
      return `<div class="cap"><h3>Sent with your report</h3><span class="thumb none" aria-hidden="true">No picture</span><p class="cap-t">${copy}</p>
        <p class="cap-m">${job.html ? `The screenshot could not be taken, so only the page copy goes. ${this.maskNote()}` : "The screenshot and the page copy could not be taken."}</p>
        ${job.htmlText ? '<p><button type="button" class="linkbtn" data-act="view" data-tab="copy" id="rw-see">See what will be sent</button></p>' : ""}</div>`;
    }
    const pic = job.shot.closeup ?? job.shot.pageMarked ?? job.shot.page;
    if (!c.thumbUrl) c.thumbUrl = job.url(pic);
    const what = job.html ? `A screenshot and a copy of this page, ${size(job.totalSize())}` : `A screenshot, ${size(job.totalSize())}`;
    const offered = job.shot.method === "dom" && !c.realAsked && screenCaptureOffered(this.win, this.privacy);
    return `<div class="cap"><h3>Sent with your report</h3>
      <button type="button" class="thumb" data-act="view" data-tab="shot" id="rw-thumb" aria-label="See the screenshot full size"><img alt="" src="${esc(c.thumbUrl)}"></button>
      <p class="cap-t">${what}</p>
      <p class="cap-m">A screenshot and a copy of this page are sent with every report. ${this.maskNote()}</p>
      <p><button type="button" class="linkbtn" data-act="view" data-tab="shot" id="rw-see">See what will be sent</button></p>
      ${offered ? '<p class="cap-m">Something missing from the picture, such as a video or a map? <button type="button" class="linkbtn" data-act="real">Use a real screen capture instead</button></p>' : ""}
    </div>`;
  }

  private updateCaptureBlock(): void {
    const slot = this.q("#rw-cap");
    if (!slot || !this.compose) return;
    const had = this.root.activeElement?.id;
    slot.innerHTML = this.captureHtml(this.compose);
    if (had === "rw-see" || had === "rw-thumb") this.q<HTMLElement>(`#${had}`)?.focus();
  }

  private callout(kind: "success" | "warning" | "danger" | "info", heading: string, text: string, role: "status" | "alert", extra = ""): string {
    const icon = { success: "check", warning: "exclamation-triangle", danger: "x-circle", info: "information-circle" }[kind];
    return `<div class="callout callout--${kind}" role="${role}">${si(icon)}<p class="c-h">${esc(heading)}</p><p>${esc(text)}</p>${extra}</div>`;
  }

  private signInLink(): string {
    const url = this.cfg.signInUrl;
    return url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Sign in again (opens a new tab)</a></p>` : "";
  }

  private errSummary(id: string, field: string, words: string): string {
    return `<div class="errsum" role="group" aria-labelledby="${id}-h" tabindex="-1" id="${id}"><h3 id="${id}-h">There is a problem</h3><ul><li><a href="#${field}" data-act="to-field" data-field="${field}">${esc(words)}</a></li></ul></div>`;
  }

  private setErrorTitle(on: boolean): void {
    if (on) {
      if (this.titleBefore === null) this.titleBefore = this.doc.title;
      this.doc.title = `Error: ${this.titleBefore}`;
    } else this.restoreTitle();
  }

  private restoreTitle(): void {
    if (this.titleBefore !== null) {
      this.doc.title = this.titleBefore;
      this.titleBefore = null;
    }
  }

  private setPageInert(on: boolean): void {
    const body = this.doc.body;
    if (!body) return;
    if (on && !body.hasAttribute("data-rw-inert")) {
      this.bodyInertBefore = body.inert;
      body.inert = true;
      body.setAttribute("data-rw-inert", "");
    } else if (!on && body.hasAttribute("data-rw-inert")) {
      body.inert = this.bodyInertBefore;
      body.removeAttribute("data-rw-inert");
    }
  }

  private focus(sel: string): void {
    this.win.requestAnimationFrame(() => this.q<HTMLElement>(sel)?.focus({ preventScroll: true }));
  }

  private pageRef(): PageRef {
    const ref: PageRef = { url: this.win.location.href, path: this.win.location.pathname };
    if (this.titleBefore ?? this.doc.title) ref.title = this.titleBefore ?? this.doc.title;
    const route = this.cfg.route?.();
    if (route) ref.route = route;
    return ref;
  }

  /** RW-1 states 6 and 7: the part is chosen; the capture starts before the panel opens (capture-design §2). */
  private choose(el: Element | null, point?: { clientX: number; clientY: number }): void {
    this.show = null;
    const label = el ? readableLabel(el) : "the whole page";
    const page = this.pageRef();
    const route = this.cfg.route?.();
    const job = new CaptureJob(this.doc, {
      target: el,
      privacy: this.privacy,
      ...(this.cfg.buildId ? { buildId: this.cfg.buildId } : {}),
      ...(route ? { route } : {}),
    });
    this.compose = { target: el, label, type: "Bug", draft: "", status: "", failures: 0, job, realAsked: false, page };
    if (el) this.compose.anchor = buildAnchor(el, point);
    this.hover = null;
    job.onChange(() => {
      if (this.compose?.job === job && this.compose.status !== "sent") this.updateCaptureBlock();
    });
    this.lastFocus = el;
    this.renderOverlay();
    this.focus("#rw-ph");
    this.say(el ? `New report about ${label}.` : "New report about the whole page.");
    if (el && this.phone) this.win.requestAnimationFrame(() => this.revealAboveSheet(el));
  }

  /** Phone: the chosen part is scrolled into view above the bottom sheet. */
  private revealAboveSheet(el: Element): void {
    const sheet = this.q(".rw-pop");
    if (!sheet) return;
    const r = el.getBoundingClientRect();
    const limit = sheet.getBoundingClientRect().top;
    const top = this.modeBarHeight();
    if (r.top < top + 8 || r.bottom > limit - 8) this.win.scrollBy(0, r.top - top - 24);
    this.scheduleLayout();
  }

  private closeCompose(returnFocus = true): void {
    const c = this.compose;
    if (!c) return;
    c.job.dispose();
    this.compose = null;
    this.restoreTitle();
    this.renderOverlay();
    if (!returnFocus) return;
    const el = c.target;
    if (el && el.isConnected && c.status !== "sent") {
      this.hl = el;
      this.makeFocusable(el);
      (el as HTMLElement).focus?.({ preventScroll: true });
      this.drawBoxes();
    } else this.focus(this.mode ? '[data-act="whole"]' : '[data-act="report"]');
  }

  private makeFocusable(el: Element): void {
    if (!el.matches("a[href],button,input,select,textarea,[tabindex],summary")) {
      el.setAttribute("tabindex", "-1");
      this.addedTabindex.add(el);
    }
  }

  private async send(): Promise<void> {
    const c = this.compose;
    if (!c) return;
    const ta = this.q<HTMLTextAreaElement>("#rw-ta");
    if (ta) c.draft = ta.value;
    if (c.status === "sending") {
      this.say("Your report is still sending.");
      return;
    }
    if (!c.draft.trim()) {
      c.status = "invalid";
      this.renderOverlay();
      this.setErrorTitle(true);
      this.focus("#rw-es");
      this.say("There is a problem: enter your comment.");
      return;
    }
    if (c.draft.length > MAX_BODY) {
      c.status = "toolong";
      c.length = c.draft.length;
      this.renderOverlay();
      this.setErrorTitle(true);
      this.focus("#rw-es");
      this.say(`There is a problem: your comment is ${thousands(c.length)} characters. Shorten it to ${thousands(MAX_BODY)} or fewer.`);
      return;
    }
    this.setErrorTitle(false);
    const prior = c.status;
    c.status = "sending";
    this.renderOverlay();
    this.focus('[data-act="send"]');
    this.say("Sending your report.");

    const job = c.job;
    await job.copyDone;
    if (job.shotStage === "working") await Promise.race([job.shotDone, new Promise((r) => setTimeout(r, SHOT_GRACE_MS))]);
    if (this.compose !== c) return;
    const includeShot = job.shotStage === "ready";
    const lateShot = job.shotStage === "working";
    if (lateShot) job.note("The screenshot was not ready in time, so it was left out.");
    const files = job.files(includeShot);
    const sizes: Partial<Record<CaptureFile, { size: number }>> = {};
    for (const [k, b] of Object.entries(files)) sizes[k as CaptureFile] = { size: b!.size };
    const body = {
      title: makeTitle(c.type, c.draft),
      body: c.draft,
      page: c.page,
      ...(c.anchor ? { anchor: c.anchor } : {}),
      capture: { context: job.context, ...(job.part ? { part: job.part } : {}), files: sizes },
    };
    try {
      const { item, uploads } = await this.api.createItem(body);
      if (this.compose !== c) return;
      c.status = "sent";
      c.sent = item;
      c.sentVariant = lateShot ? "noshot" : job.htmlTooLarge ? "nohtml" : "ok";
      if (samePath(item, this.path) || !item.page) {
        this.items = [...this.items.filter((i) => i.id !== item.id), item];
        this.renderPins();
      }
      this.renderOverlay();
      this.focus("#rw-ph");
      this.say(`Report ${item.number} sent.`);
      void uploadCapture(this.api, item.id, uploads ?? {}, files).then(() => this.loadItems());
    } catch (e) {
      if (this.compose !== c) return;
      const err = e instanceof ApiError ? e : new ApiError("server", 0);
      if (err.kind === "invalid" && c.draft.length > MAX_BODY) {
        c.status = "toolong";
        c.length = c.draft.length;
        this.renderOverlay();
        this.setErrorTitle(true);
        this.focus("#rw-es");
        return;
      }
      c.reference = err.reference;
      c.status = this.failureOf(err, prior === "failed" || prior === "failed-again" || c.failures > 0);
      if (c.status === "failed" || c.status === "failed-again") c.failures++;
      this.renderOverlay();
      this.focus('[data-act="send"]');
    }
  }

  private failureOf(err: ApiError, again: boolean): Failure {
    if (err.kind === "offline") return "offline";
    if (err.kind === "signin") return "signedout";
    if (err.kind === "limit") return "limit";
    return again ? "failed-again" : "failed";
  }

  private async useRealCapture(): Promise<void> {
    const c = this.compose;
    if (!c) return;
    c.realAsked = true;
    this.renderOverlay();
    this.focus('.callout--info');
    this.say("Your browser will ask what to share. Choose “This tab”.");
    const host = this.host;
    const ok = await c.job.useScreen(
      () => (host.style.visibility = "hidden"),
      () => (host.style.visibility = ""),
    );
    if (this.compose !== c) return;
    c.realAsked = false;
    c.thumbUrl = undefined;
    this.renderOverlay();
    this.focus(ok ? "#rw-thumb" : "#rw-ta");
  }

  // ---------------------------------------------------------------- Reports panel (RW-1 27–34)

  private async openList(tab: "page" | "mine" = "page"): Promise<void> {
    this.show = null;
    const st: ListState = { kind: "list", tab, load: "loading", mine: null, asAt: new Date(), failures: 0 };
    this.panel = st;
    this.lastFocus = null;
    this.renderOverlay();
    this.focus("#rw-lh");
    this.say("Loading the reports");
    await this.loadList(st);
  }

  private async loadList(st: ListState): Promise<void> {
    try {
      if (st.tab === "page") {
        const [page, mine] = await Promise.allSettled([this.api.itemsOnPage(this.path), st.mine ? Promise.resolve({ items: st.mine }) : this.api.myItems()]);
        if (page.status === "rejected") throw page.reason;
        this.items = page.value.items.filter((i) => i.kind === "report");
        if (mine.status === "fulfilled") st.mine = mine.value.items.filter((i) => i.kind === "report");
        this.partCache.clear();
      } else {
        const { items } = await this.api.myItems();
        st.mine = items.filter((i) => i.kind === "report");
      }
      st.load = "ready";
      st.asAt = new Date();
      st.failures = 0;
    } catch (e) {
      st.reference = e instanceof ApiError ? e.reference : undefined;
      st.load = st.failures > 0 ? "error-again" : "error";
      st.failures++;
    }
    if (this.panel !== st) return;
    const focusedTab = this.root.activeElement?.getAttribute("role") === "tab";
    this.renderOverlay();
    this.renderPins();
    if (focusedTab) this.focus(`#rw-tab-${st.tab}`);
    if (st.load === "error") this.say("The reports could not be loaded.");
    else if (st.load === "error-again") this.say("Error: the reports still could not be loaded.");
  }

  private listHtml(st: ListState): string {
    const pageCount = this.items.length;
    const mineCount = st.mine?.length ?? 0;
    const tab = (k: "page" | "mine", label: string, n: number) =>
      `<button type="button" class="tab" role="tab" id="rw-tab-${k}" aria-selected="${st.tab === k}" aria-controls="rw-tp" tabindex="${st.tab === k ? 0 : -1}" data-act="tab" data-tab="${k}">${label}${n ? `<span class="sr-only">, </span><span class="cpill">${n}</span>` : ""}</button>`;
    let body: string;
    const pageTitle = esc(this.titleBefore ?? this.doc.title) || "this page";
    if (st.load === "loading") {
      body = `<p class="resline" role="status">Loading the reports</p><ul class="rw-rows" aria-busy="true">${[1, 2, 3]
        .map(() => '<li class="rw-skel"><span class="skel" style="width:40%"></span><span class="skel" style="width:90%"></span><span class="skel" style="width:60%"></span></li>')
        .join("")}</ul>`;
    } else if (st.load === "error" || st.load === "error-again") {
      const again = st.load === "error-again";
      const ref = st.reference;
      const words = again
        ? ref ? `Nothing has changed. Send reference ${ref} to the system team, and try again later.` : "Nothing has changed. Tell the system team, and try again later."
        : ref ? `Nothing has changed. Try again. If it fails again, send reference ${ref} to the system team.` : "Nothing has changed. Try again. If it fails again, tell the system team.";
      body = `<div class="err-panel" role="alert" aria-labelledby="rw-eh"><p class="h" id="rw-eh">${si("x-circle")}${again ? "Error: the reports still could not be loaded" : "The reports could not be loaded"}</p>
        <p>${esc(words)}</p><button type="button" class="btn btn--outline" data-act="retry">Try again</button></div>`;
    } else if (st.tab === "page") {
      const R = this.items;
      const unres = R.filter((i) => !isResolved(i)).length;
      const resolvedN = R.length - unres;
      const tick = `<label class="tick"><input type="checkbox" data-act="resolved"${this.showResolved ? " checked" : ""}>Show resolved pins</label>`;
      if (!R.length) {
        body = `${tick}<div class="empty"><p class="h">No reports on this page yet</p><p>Choose any part of the page while report mode is on, or comment on the whole page.</p>
          <button type="button" class="btn btn--outline" data-act="whole-from-list">Comment on the whole page</button></div>`;
      } else {
        const hidden = resolvedN && !this.showResolved ? (resolvedN === 1 ? " (its pin is hidden)" : " (their pins are hidden)") : "";
        const line = `${plural(R.length, "report")} on ${pageTitle}: ${unres} not yet resolved, ${resolvedN} resolved${hidden}. ${asAt(st.asAt)}`;
        body = `${tick}<p class="resline" role="status">${line}</p>${!unres ? "<p>Every report on this page is resolved. Their pins show when Show resolved pins is ticked.</p>" : ""}
          <ul class="rw-rows" role="list" aria-label="Reports on this page">${listOrder(R).map((i) => this.rowHtml(i, false)).join("")}</ul>`;
      }
    } else {
      const mine = st.mine ?? [];
      if (!mine.length) {
        body = `<div class="empty"><p class="h">You have not sent any reports yet</p><p>Reports you send from any page are listed here, with their replies. Choose any part of a page while report mode is on to send one.</p></div>`;
      } else {
        const pages = new Set(mine.map((i) => i.page?.path ?? "")).size;
        body = `<p class="resline" role="status">${plural(mine.length, "report")} you sent, on ${plural(pages, "page")}. ${asAt(st.asAt)}</p>
          <ul class="rw-rows" role="list" aria-label="My reports">${listOrder(mine).map((i) => this.rowHtml(i, true)).join("")}</ul>`;
      }
    }
    return `<div class="rw-fly" role="dialog" aria-modal="true" aria-labelledby="rw-lh">
      <div class="fly-hd"><div class="ht"><h2 id="rw-lh" tabindex="-1">Reports</h2></div>
        <button type="button" class="btn btn--ghost btn--icon" aria-label="Close" data-act="close">${mi("x-mark")}</button></div>
      <div class="tabs" role="tablist" aria-label="Which reports">${tab("page", "This page", pageCount)}${tab("mine", "My reports", mineCount)}</div>
      <div class="fly-bd" role="tabpanel" id="rw-tp" aria-labelledby="rw-tab-${st.tab}">${body}</div></div>`;
  }

  /** Where a report points, in the list row's words. */
  private whereText(i: Item): string {
    if (!i.anchor) return "on the whole page";
    const label = i.anchor.label ?? "a part of the page";
    if (samePath(i, this.path) && !this.partFor(i)) return `on the whole page (${label} is no longer here)`;
    return `on ${label}`;
  }

  private rowHtml(i: Item, mineTab: boolean): string {
    const { type, text } = splitTitle(i.title);
    const meta = [
      mineTab ? pageName(i) : "",
      type ?? "",
      this.whereText(i),
      mineTab ? "" : i.reporter?.name ?? "",
      dateOnly(i.createdAt),
    ].filter(Boolean);
    return `<li><button type="button" class="rw-row" data-act="open" data-id="${esc(i.id)}"><span class="nm">Report ${i.number}</span><span class="stat">${statusTag(i.status, true)}</span>
      <span class="ex">${esc(text)}</span><span class="meta">${meta.map(esc).join(" · ")}</span></button></li>`;
  }

  // ---------------------------------------------------------------- thread (RW-1 19–24a, RW-1a A1-12)

  private async openThread(id: string, back: boolean, opener?: Element | null): Promise<void> {
    this.show = null;
    const known = this.items.find((i) => i.id === id) ?? (this.panel?.kind === "list" ? this.panel.mine?.find((i) => i.id === id) : undefined);
    const st: ThreadState = { kind: "thread", id, load: "loading", failures: 0, back, reply: "", sub: "", replyFailures: 0, ...(known ? { item: known } : {}) };
    this.panel = st;
    if (opener !== undefined) this.lastFocus = opener;
    this.renderOverlay();
    this.focus("#rw-th");
    await this.loadThread(st);
  }

  private async loadThread(st: ThreadState, keepFocus = false): Promise<void> {
    try {
      const { item, messages } = await this.api.item(st.id);
      st.item = item;
      st.messages = messages;
      st.load = "ready";
      st.failures = 0;
      this.items = this.items.map((i) => (i.id === item.id ? item : i));
    } catch (e) {
      st.reference = e instanceof ApiError ? e.reference : undefined;
      st.load = st.failures > 0 ? "error-again" : "error";
      st.failures++;
    }
    if (this.panel !== st) return;
    const active = this.root.activeElement as HTMLElement | null;
    const activeId = active?.id;
    this.renderOverlay();
    if (keepFocus && activeId) this.focus(`#${activeId}`);
    else if (!keepFocus) this.focus("#rw-th");
    void this.loadThreadThumb(st);
  }

  private async loadThreadThumb(st: ThreadState): Promise<void> {
    const f = st.item?.capture?.confirmed ? st.item.capture.files : undefined;
    if (!f || st.thumbUrl) return;
    const file = f.closeup ? "closeup" : f.pageMarked ? "pageMarked" : f.page ? "page" : null;
    if (!file) return;
    try {
      st.thumbUrl = (await this.api.captureUrl(st.id, file)).url;
      if (this.panel !== st) return;
      const img = this.q<HTMLImageElement>("#rw-tthumb img");
      if (img) img.src = st.thumbUrl;
    } catch {
      // The thumbnail is optional; "View" still opens the viewer.
    }
  }

  private statusSentence(i: Item): string {
    const t = toneOf(i.status);
    const mine = this.me && i.reporter?.id === this.me.user.id;
    if (t === "open") return "Open: not yet answered.";
    if (t === "answered") return mine || !i.reporter ? "Answered: a reply is waiting for you." : `Answered: a reply is waiting for ${i.reporter.name}.`;
    if (t === "progress") return "In progress: a fix is being made.";
    if (t === "closed") return `Closed on ${dateTime(i.updatedAt)}. Its pin shows only when Show resolved pins is ticked.`;
    if (mine) return `Resolved on ${dateTime(i.updatedAt)}. If it is sorted for you, close the report. If not, reply and it opens again.`;
    return `Resolved on ${dateTime(i.updatedAt)}. Its pin shows only when Show resolved pins is ticked.`;
  }

  private threadHtml(st: ThreadState): string {
    const i = st.item;
    const close = `<button type="button" class="btn btn--ghost btn--icon" aria-label="Close" data-act="close">${mi("x-mark")}</button>`;
    const backBtn = st.back ? `<button type="button" class="linkbtn" data-act="back">${mi("chevron-left")}All reports</button>` : "";
    if (!i || st.load !== "ready") {
      let body = `<p class="resline" role="status">Loading the report</p><div class="rw-skel"><span class="skel" style="width:40%"></span><span class="skel" style="width:90%"></span><span class="skel" style="width:60%"></span></div>`;
      if (st.load === "error" || st.load === "error-again") {
        const again = st.load === "error-again";
        const ref = st.reference;
        const words = again
          ? ref ? `Nothing has changed. Send reference ${ref} to the system team, and try again later.` : "Nothing has changed. Tell the system team, and try again later."
          : ref ? `Nothing has changed. Try again. If it fails again, send reference ${ref} to the system team.` : "Nothing has changed. Try again. If it fails again, tell the system team.";
        body = `<div class="err-panel" role="alert" aria-labelledby="rw-teh"><p class="h" id="rw-teh">${si("x-circle")}${again ? "Error: the report still could not be loaded" : "The report could not be loaded"}</p>
          <p>${esc(words)}</p><button type="button" class="btn btn--outline" data-act="thread-retry">Try again</button></div>`;
      }
      return `<div class="rw-fly" role="dialog" aria-modal="true" aria-labelledby="rw-th"><div class="fly-hd"><div class="ht">${backBtn}<h2 id="rw-th" tabindex="-1">${i ? `Report ${i.number}` : "Report"}</h2></div>${close}</div><div class="fly-bd">${body}</div></div>`;
    }
    const { type } = splitTitle(i.title);
    const sub = [type ?? "", pageName(i), i.reporter ? `sent by ${i.reporter.name}` : ""].filter(Boolean).map(esc).join(" · ");
    const here = samePath(i, this.path);
    const part = here ? this.partFor(i) : null;
    const label = i.anchor?.label ?? "";
    let about: string;
    if (!i.anchor) about = `<p>About: the whole page.</p>`;
    else if (!here) about = `<p>About: ${esc(label)} on ${esc(pageName(i))}. ${i.page?.url ? `<a href="${esc(safeHref(i.page.url))}" data-act="goto" data-id="${esc(i.id)}">Go to ${esc(pageName(i))}</a>` : ""}</p>`;
    else if (!part) about = `<p>About: ${esc(label)}, which is no longer on this page. The report is kept as a report on the whole page.</p>`;
    else about = `<p>About: ${esc(label)}. <button type="button" class="linkbtn" data-act="show" data-id="${esc(i.id)}">Show on the page</button></p>`;
    const files = i.capture?.confirmed ? i.capture.files : undefined;
    const hasCap = !!files && (files.page || files.pageMarked || files.closeup || files.html);
    const cap = hasCap
      ? `<div class="cap"><h3>Sent with this report</h3><button type="button" class="thumb" id="rw-tthumb" data-act="tview" data-tab="${files!.page || files!.pageMarked ? "shot" : "copy"}" aria-label="View the screenshot and page copy sent with Report ${i.number}">${st.thumbUrl ? `<img alt="" src="${esc(st.thumbUrl)}">` : files!.closeup || files!.page ? '<img alt="">' : "No picture"}</button>
        <p class="cap-t">${files!.page ? "A screenshot and a copy of the page, taken when the report was sent" : "A copy of the page, taken when the report was sent"}</p><p><button type="button" class="linkbtn" data-act="tview" data-tab="${files!.page || files!.pageMarked ? "shot" : "copy"}" id="rw-tview">View</button></p></div>`
      : "";
    const msgs = (st.messages ?? [])
      .map((m) => `<li class="msg"><span class="avatar" aria-hidden="true">${esc(initials(m.author.name))}</span><p class="by"><b>${esc(m.author.name)}</b><span>${esc(dateTime(m.publishedAt ?? m.createdAt))}</span></p><p class="body">${esc(m.body)}</p></li>`)
      .join("");
    const ref = st.reference;
    let notice = "";
    if (st.closing === "closed") notice = this.callout("success", `Report ${i.number} closed`, "Thank you for confirming. Its pin shows only when Show resolved pins is ticked.", "status");
    else if (st.closing === "failed") notice = this.callout("danger", `Report ${i.number} was not closed`, "Something went wrong. Nothing has changed. Try again.", "alert");
    const mine = !!this.me && i.reporter?.id === this.me.user.id;
    const confirm =
      mine && i.status === "resolved"
        ? `<div class="acts"><button type="button" class="btn btn--outline" data-act="confirm-close">${st.closing === "sending" ? '<span class="spin" aria-hidden="true"></span>Closing…' : "It’s sorted: close the report"}</button></div>`
        : "";
    if (st.sub === "sent") notice = this.callout("success", "Reply sent", st.reopened ? `Report ${i.number} is open again until it is answered.` : "", "status").replace("<p></p>", "");
    const replyFail: Partial<Record<string, [string, string]>> = {
      failed: ["Your reply was not sent", `Something went wrong on the server. Your reply is still here. Press Send reply to try again. ${ref ? `If it fails again, send reference ${ref} to the system team.` : "If it fails again, tell the system team."}`],
      "failed-again": ["Your reply was still not sent", `Something went wrong on the server again. Your reply is still here. ${ref ? `Send reference ${ref} to the system team, and try again later.` : "Tell the system team, and try again later."}`],
      offline: ["Your reply was not sent", "There is no connection. Your reply is still here. Press Send reply when you are back online."],
      signedout: ["Your reply was not sent", "Your sign-in has ended. Your reply is still here. Sign in again in a new tab, then come back to this tab and press Send reply."],
      limit: ["Your reply was not sent", "Too many replies were sent in a short time. Your reply is still here. Wait a minute, then press Send reply."],
    };
    const rf = replyFail[st.sub];
    const invalid = st.sub === "invalid" || st.sub === "toolong";
    const errWords = st.sub === "toolong" ? `Your reply is ${thousands(st.length ?? st.reply.length)} characters. Shorten it to ${thousands(MAX_BODY)} or fewer.` : "Enter your reply";
    const form = `<hr class="divider">
      ${rf ? this.callout("danger", rf[0], rf[1], "alert", st.sub === "signedout" ? this.signInLink() : "") : ""}
      ${invalid ? this.errSummary("rw-res", "rw-rta", errWords) : ""}
      <div class="fld${invalid ? " is-invalid" : ""}"><label class="lab" for="rw-rta">Your reply</label>${invalid ? `<p class="err-msg" id="rw-rerr">${warnIcon()}${esc(errWords)}</p>` : ""}
        <textarea class="ta" id="rw-rta" rows="3"${invalid ? ' aria-invalid="true" aria-describedby="rw-rerr"' : ""}>${esc(st.reply)}</textarea></div>
      <div class="acts"><button type="button" class="btn btn--primary" data-act="reply">${st.sub === "" && this.replySending ? '<span class="spin" aria-hidden="true"></span>Sending…' : "Send reply"}</button></div>`;
    return `<div class="rw-fly" role="dialog" aria-modal="true" aria-labelledby="rw-th">
      <div class="fly-hd"><div class="ht">${backBtn}<h2 id="rw-th" tabindex="-1">Report ${i.number}</h2>
        <p class="sub">${sub}</p><p>${statusTag(i.status)}</p></div>${close}</div>
      <div class="fly-bd">${notice}
        <div class="facts"><p><b>${esc(this.statusSentence(i))}</b></p>${confirm}${about}</div>${cap}
        <h3>Messages</h3><ol class="msgs">${msgs}</ol>${form}</div></div>`;
  }

  private replySending = false;

  private async confirmClose(): Promise<void> {
    const st = this.panel;
    if (!st || st.kind !== "thread" || !st.item || st.closing === "sending") return;
    st.closing = "sending";
    this.renderOverlay();
    this.focus('[data-act="confirm-close"]');
    this.say("Closing the report.");
    try {
      await this.api.closeReport(st.id);
      st.closing = "closed";
      await this.loadThread(st, true);
      this.renderOverlay();
      this.focus("#rw-th");
      this.say(`Report ${st.item!.number} closed.`);
    } catch {
      st.closing = "failed";
      this.renderOverlay();
      this.focus('[data-act="confirm-close"]');
    }
  }

  private async sendReply(): Promise<void> {
    const st = this.panel;
    if (!st || st.kind !== "thread" || !st.item) return;
    const ta = this.q<HTMLTextAreaElement>("#rw-rta");
    if (ta) st.reply = ta.value;
    if (this.replySending) {
      this.say("Your reply is still sending.");
      return;
    }
    if (!st.reply.trim()) {
      st.sub = "invalid";
      this.renderOverlay();
      this.setErrorTitle(true);
      this.focus("#rw-res");
      this.say("There is a problem: enter your reply.");
      return;
    }
    if (st.reply.length > MAX_BODY) {
      st.sub = "toolong";
      st.length = st.reply.length;
      this.renderOverlay();
      this.setErrorTitle(true);
      this.focus("#rw-res");
      this.say(`There is a problem: your reply is ${thousands(st.length)} characters. Shorten it to ${thousands(MAX_BODY)} or fewer.`);
      return;
    }
    this.setErrorTitle(false);
    const before = toneOf(st.item.status);
    const prior = st.sub;
    st.sub = "";
    this.replySending = true;
    this.renderOverlay();
    this.focus('[data-act="reply"]');
    this.say("Sending your reply.");
    try {
      await this.api.reply(st.id, st.reply);
      this.replySending = false;
      st.reply = "";
      st.replyFailures = 0;
      st.sub = "sent";
      await this.loadThread(st, true);
      st.closing = undefined;
      st.reopened = before !== "open" && before !== "progress" && !!st.item && toneOf(st.item.status) === "open";
      this.renderOverlay();
      this.focus("#rw-th");
      this.say(st.reopened ? `Reply sent. Report ${st.item!.number} is open again.` : "Reply sent.");
    } catch (e) {
      this.replySending = false;
      const err = e instanceof ApiError ? e : new ApiError("server", 0);
      if (err.kind === "invalid" && st.reply.length > MAX_BODY) {
        st.sub = "toolong";
        st.length = st.reply.length;
      } else {
        st.reference = err.reference;
        st.sub = this.failureOf(err, prior === "failed" || prior === "failed-again" || st.replyFailures > 0);
        if (st.sub === "failed" || st.sub === "failed-again") st.replyFailures++;
      }
      this.renderOverlay();
      this.focus(st.sub === "toolong" ? "#rw-res" : '[data-act="reply"]');
    }
  }

  private closePanel(): void {
    const was = this.panel;
    this.panel = null;
    this.restoreTitle();
    this.renderOverlay();
    if (was?.kind === "thread") {
      const pin = this.q<HTMLElement>(`.rw-pin[data-id="${cssId(was.id)}"]`);
      if (pin && !pin.hidden) return pin.focus();
    }
    const opener = this.lastFocus;
    if (opener instanceof HTMLElement && opener.isConnected) return opener.focus();
    this.focus(this.mode ? '[data-act="list"]' : '[data-act="report"]');
  }

  private showOnPage(id: string): void {
    const item = this.items.find((i) => i.id === id);
    const el = item && this.partFor(item);
    this.panel = null;
    this.show = id;
    this.renderOverlay();
    this.renderPins();
    if (!item || !el) return;
    (el as HTMLElement).scrollIntoView?.({ block: "center", behavior: "auto" });
    this.layout();
    this.q<HTMLElement>(`.rw-pin[data-id="${cssId(id)}"]`)?.focus();
    this.say(`Report ${item.number} is about ${item.anchor?.label ?? "a part of the page"}, outlined on the page.`);
  }

  // ---------------------------------------------------------------- viewer (RW-1a A1-8, A1-9, A1-13, A1-14)

  private renderViewer(): void {
    const slot = this.slot("viewer");
    const v = this.viewer;
    if (!v) {
      slot.innerHTML = "";
      return;
    }
    let title: string;
    let about: string;
    let shot: string | null = null;
    let html: string | null = null;
    let shotNote = "";
    let copyNote = "";
    let alt = "";
    const ctx = v.from === "compose" ? this.compose?.job.context : this.panel?.kind === "thread" ? this.panel.item?.capture?.context : undefined;
    const vpText = ctx ? `${ctx.viewport.width} × ${ctx.viewport.height} at ${Math.round(ctx.devicePixelRatio * 100) / 100}×` : "";
    if (v.from === "compose" && this.compose) {
      const job = this.compose.job;
      title = "What will be sent";
      about = `${this.compose.page.title ?? ""} · ${dateTime(job.context.capturedAt)}`;
      if (job.shot) shot = job.url(job.shot.pageMarked ?? job.shot.page);
      html = job.htmlText;
      alt = this.compose.target ? `Screenshot of ${this.compose.page.title ?? "this page"} as you see it, with ${this.compose.label} outlined as the part reported.` : `Screenshot of ${this.compose.page.title ?? "this page"} as you see it.`;
      shotNote = `Screenshot · ${vpText} · ${job.shot?.method === "screen" ? "a real screen capture." : "drawn by the browser: videos, maps and pictures from other sites may be missing."}`;
      copyNote = `Copy of the page’s HTML · ${job.html ? size(job.html.size) : job.htmlText ? size(job.htmlText.length) : "none"} · links and buttons in it do nothing. Password fields and private fields are left blank.`;
    } else if (this.panel?.kind === "thread" && this.panel.item) {
      const item = this.panel.item;
      title = `Sent with Report ${item.number}`;
      about = `${pageName(item)} · ${dateTime(ctx?.capturedAt ?? item.createdAt)}`;
      shot = v.shotUrl ?? null;
      html = v.html ?? null;
      alt = item.anchor ? `Screenshot of ${pageName(item)} as it was reported, with ${item.anchor.label ?? "the part"} outlined as the part reported.` : `Screenshot of ${pageName(item)} as it was reported.`;
      shotNote = `Screenshot · ${vpText} · ${ctx?.method === "screen" ? "a real screen capture." : "drawn by the browser: videos, maps and pictures from other sites may be missing."}`;
      const f = item.capture?.files.html;
      copyNote = `Copy of the page’s HTML · ${f ? size(f.size) : "none"} · links and buttons in it do nothing. Password fields and private fields are left blank.`;
    } else {
      slot.innerHTML = "";
      return;
    }
    const body =
      v.loading
        ? '<p class="resline" role="status">Loading</p>'
        : v.tab === "shot"
          ? shot
            ? `<figure><img src="${esc(shot)}" alt="${esc(alt)}"></figure>`
            : "<p>The screenshot could not be taken.</p>"
          : html
            ? `<iframe class="copyframe" sandbox="" referrerpolicy="no-referrer" title="${esc(`Copy of the page, ${about.split(" · ")[0]}`)}" srcdoc="${esc(html)}"></iframe>`
            : "<p>The page was larger than 2 MB, so its HTML is not sent.</p>";
    const tabBtn = (k: "shot" | "copy", label: string) =>
      `<button type="button" role="tab" class="tab" id="rw-vt-${k}" aria-selected="${v.tab === k}" aria-controls="rw-vp" tabindex="${v.tab === k ? 0 : -1}" data-act="vtab" data-tab="${k}">${label}</button>`;
    slot.innerHTML = `<div class="rw-vscrim" data-act="viewer-scrim"><div class="viewer" role="dialog" aria-modal="true" aria-labelledby="rw-vh">
      <div class="pop-hd"><div class="ht"><h2 id="rw-vh" tabindex="-1">${esc(title)}</h2><p class="about">${esc(about)}</p></div>
        <button type="button" class="btn btn--ghost btn--icon" aria-label="Close" data-act="viewer-close">${mi("x-mark")}</button></div>
      <div class="tabs" role="tablist" aria-label="View">${tabBtn("shot", "Screenshot")}${tabBtn("copy", "Page copy")}</div>
      <div class="vbody" role="tabpanel" id="rw-vp" aria-labelledby="rw-vt-${v.tab}">${body}</div>
      <p class="vnote">${esc(v.tab === "shot" ? shotNote : copyNote)}</p></div></div>`;
  }

  private openViewer(from: "compose" | "thread", tab: "shot" | "copy", opener: string): void {
    this.viewer = { from, tab, opener };
    this.renderOverlay();
    this.renderViewer();
    this.focus("#rw-vh");
    if (from === "thread") void this.loadViewer();
  }

  private async loadViewer(): Promise<void> {
    const v = this.viewer;
    const st = this.panel;
    if (!v || !st || st.kind !== "thread" || !st.item) return;
    const files = st.item.capture?.files ?? {};
    v.loading = true;
    this.renderViewer();
    const [shotUrl, html] = await Promise.all([
      files.pageMarked || files.page ? this.api.captureUrl(st.id, files.pageMarked ? "pageMarked" : "page").then((r) => r.url, () => null) : Promise.resolve(null),
      files.html ? this.api.captureHtml(st.id).catch(() => null) : Promise.resolve(null),
    ]);
    if (this.viewer !== v) return;
    v.shotUrl = shotUrl;
    v.html = html;
    v.loading = false;
    const tabFocused = this.root.activeElement?.getAttribute("role") === "tab";
    this.renderViewer();
    this.focus(tabFocused ? `#rw-vt-${v.tab}` : "#rw-vh");
  }

  private closeViewer(): void {
    const v = this.viewer;
    this.viewer = null;
    this.renderViewer();
    this.renderOverlay();
    if (v) this.focus(`#${v.opener}`);
  }

  // ---------------------------------------------------------------- modes

  private enterMode(): void {
    this.mode = true;
    this.show = null;
    this.hover = this.hl = null;
    this.render();
    this.focus('[data-act="report"]');
    this.say("Report mode is on. Select any part of the page to report on it.");
  }

  private leaveMode(): void {
    this.mode = false;
    if (this.compose) {
      this.compose.job.dispose();
      this.compose = null;
    }
    this.panel = null;
    this.hover = this.hl = null;
    this.show = null;
    this.restoreTitle();
    this.addedTabindex.forEach((el) => el.removeAttribute("tabindex"));
    this.addedTabindex.clear();
    this.render();
    this.focus('[data-act="report"]');
    this.say("Report mode is off.");
  }

  // ---------------------------------------------------------------- events

  private onCapture(e: MouseEvent): void {
    if (!this.mode || this.overlayOpen() || this.viewer || this.fromWidget(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "click") {
      const el = pickPart(e.target as Element);
      if (el) this.choose(el, { clientX: e.clientX, clientY: e.clientY });
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.mode || this.overlayOpen() || this.fromWidget(e)) return;
    const el = pickPart(e.target as Element);
    if (el !== this.hover) {
      this.hover = el;
      this.drawBoxes();
    }
  }

  private onFocusIn(e: FocusEvent): void {
    if (!this.mode || this.overlayOpen() || this.fromWidget(e)) return;
    const el = e.target as Element;
    if (!el || el === this.doc.body || isWidgetNode(el)) return;
    this.hl = el;
    this.drawBoxes();
    this.say(`Outlined: ${readableLabel(el)}. Press Enter to report on it.`);
  }

  private candidates(): Element[] {
    return Array.from(this.doc.querySelectorAll(SELECTABLE)).filter((el) => !isWidgetNode(el) && el.getClientRects().length > 0);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (this.viewer) this.closeViewer();
      else if (this.compose) this.closeCompose();
      else if (this.panel) this.closePanel();
      else if (this.show) {
        this.show = null;
        this.renderPins();
      } else if (this.mode) this.leaveMode();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (!this.mode || this.overlayOpen() || this.viewer || this.fromWidget(e)) return;
    const t = e.target as Element;
    const typing = t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
    if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key) && !typing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const list = this.candidates();
      const cur = this.hl && list.indexOf(this.hl);
      let i = typeof cur === "number" ? cur : -1;
      i = e.key === "ArrowDown" || e.key === "ArrowRight" ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
      const el = list[i];
      if (!el) return;
      this.makeFocusable(el);
      el.scrollIntoView?.({ block: "nearest" });
      const r = el.getBoundingClientRect();
      const top = this.modeBarHeight();
      if (r.top < top + 8) this.win.scrollBy(0, r.top - top - 16);
      (el as HTMLElement).focus?.({ preventScroll: true });
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (typing && e.key === " ") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = this.hl && this.hl.isConnected ? this.hl : pickPart(t);
      if (el) this.choose(el);
    }
  }

  /** Tabs: arrows, Home and End move between tabs (RW-1 checklist B 1). */
  private onRootKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t.getAttribute("role") !== "tab") return;
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const tabs = Array.from(t.parentElement!.querySelectorAll<HTMLElement>('[role="tab"]'));
    let i = tabs.indexOf(t);
    if (e.key === "ArrowRight") i = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") i = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") i = 0;
    else i = tabs.length - 1;
    tabs[i]!.click();
    this.focus(`#${tabs[i]!.id}`);
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLElement;
    if (t.id === "rw-ta" && this.compose) this.compose.draft = (t as HTMLTextAreaElement).value;
    if (t.id === "rw-rta" && this.panel?.kind === "thread") this.panel.reply = (t as HTMLTextAreaElement).value;
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.name === "rw-type" && this.compose) this.compose.type = t.value as ReportType;
    if (t.dataset.act === "resolved") {
      this.showResolved = t.checked;
      this.renderPins();
      this.say(t.checked ? "Resolved pins are shown." : "Resolved pins are hidden.");
    }
  }

  private onClick(e: MouseEvent): void {
    const t = (e.target as Element).closest<HTMLElement>("[data-act]");
    if (!t) return;
    const act = t.dataset.act!;
    if (act === "resolved" || act === "goto") {
      if (act === "goto") {
        try {
          this.win.sessionStorage.setItem(OPEN_KEY, t.dataset.id ?? "");
        } catch {
          // The link still navigates; the thread is simply not reopened there.
        }
      }
      return;
    }
    e.preventDefault();
    switch (act) {
      case "report":
        if (this.mode) this.leaveMode();
        else this.enterMode();
        break;
      case "done":
        this.leaveMode();
        break;
      case "whole":
        this.lastFocus = null;
        this.choose(null);
        break;
      case "whole-from-list":
        this.panel = null;
        this.choose(null);
        break;
      case "list":
        void this.openList("page");
        break;
      case "scrim":
        if (this.compose && this.compose.status !== "sending") this.closeCompose();
        else if (this.panel) this.closePanel();
        break;
      case "cancel":
        this.closeCompose();
        break;
      case "close":
        this.closePanel();
        break;
      case "sent-close":
        this.closeCompose(false);
        this.focus('[data-act="whole"]');
        break;
      case "open-new": {
        const id = this.compose?.sent?.id;
        this.closeCompose(false);
        if (id) void this.openThread(id, false, null);
        break;
      }
      case "send":
        void this.send();
        break;
      case "real":
        void this.useRealCapture();
        break;
      case "view":
        this.openViewer("compose", (t.dataset.tab as "shot" | "copy") ?? "shot", t.id || "rw-see");
        break;
      case "tview":
        this.openViewer("thread", (t.dataset.tab as "shot" | "copy") ?? "shot", t.id || "rw-tview");
        break;
      case "vtab":
        if (this.viewer) {
          this.viewer.tab = t.dataset.tab as "shot" | "copy";
          this.renderViewer();
          this.focus(`#rw-vt-${this.viewer.tab}`);
        }
        break;
      case "viewer-close":
        this.closeViewer();
        break;
      case "viewer-scrim":
        if (e.target === t) this.closeViewer();
        break;
      case "to-field": {
        const f = this.q<HTMLElement>(`#${t.dataset.field}`);
        f?.focus();
        break;
      }
      case "pin":
        void this.openThread(t.dataset.id!, false, t);
        break;
      case "open":
        void this.openThread(t.dataset.id!, true, null);
        break;
      case "back":
        void this.openList("page");
        break;
      case "tab":
        if (this.panel?.kind === "list") {
          const st = this.panel;
          st.tab = t.dataset.tab as "page" | "mine";
          st.load = "loading";
          st.failures = 0;
          this.renderOverlay();
          this.focus(`#rw-tab-${st.tab}`);
          void this.loadList(st);
        }
        break;
      case "retry":
        if (this.panel?.kind === "list") {
          const st = this.panel;
          const failures = st.failures;
          st.load = "loading";
          this.renderOverlay();
          this.say("Loading the reports");
          st.failures = failures;
          void this.loadList(st);
        }
        break;
      case "thread-retry":
        if (this.panel?.kind === "thread") {
          const st = this.panel;
          st.load = "loading";
          this.renderOverlay();
          void this.loadThread(st);
        }
        break;
      case "show":
        this.showOnPage(t.dataset.id!);
        break;
      case "reply":
        void this.sendReply();
        break;
      case "confirm-close":
        void this.confirmClose();
        break;
    }
  }
}

const warnIcon = () => si("exclamation-triangle").replace('class="i i-20"', 'class="i"');

const cssId = (s: string) => s.replace(/["\\]/g, "\\$&");

/** Only http(s) links from the API are followed. */
function safeHref(url: string): string {
  try {
    const u = new URL(url, location.href);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "#";
  } catch {
    return "#";
  }
}
