// capture-design.md §1–§4: everything sent with a report, taken at the moment the part is chosen and
// finished in the background while the reporter types.
import type { CaptureContext, CaptureFile, PartRecord, Rect } from "@annotatie/core";
import { accessibleName, buildSelector, readableLabel } from "../anchor.js";
import { clonePage, fieldIsMasked, MASK_ATTR, serializeCopy, viewportSvg, type PageClone } from "./clone.js";
import { baseScale, closeupRect, crop, drawSvg, fitCanvas, gzip, LIMITS, marked, paintMasks, scaled } from "./render.js";
import { grabTabFrame } from "./screen.js";

export type Stage = "working" | "ready" | "failed";

export interface Shot {
  page: Blob;
  pageMarked?: Blob;
  closeup?: Blob;
  /** Screenshot px per CSS px of the `page` file. */
  scale: number;
  method: "dom" | "screen";
}

export interface CaptureOptions {
  target: Element | null;
  privacy: boolean;
  buildId?: string;
  route?: string;
}

const IMPLICIT_ROLES: Record<string, string> = {
  a: "link", button: "button", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
  img: "img", input: "textbox", textarea: "textbox", select: "combobox", td: "cell", th: "columnheader", tr: "row",
  li: "listitem", ul: "list", ol: "list", nav: "navigation", header: "banner", footer: "contentinfo", main: "main",
  form: "form", table: "table", dialog: "dialog", aside: "complementary", summary: "button", option: "option",
};

const STYLE_KEYS = ["display", "visibility", "color", "background-color", "font-size", "overflow", "z-index", "position"];

function implicitRole(el: Element): string | undefined {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.split(/\s+/)[0];
  if (el.localName === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (t === "checkbox" || t === "radio") return t;
    if (["button", "submit", "reset"].includes(t)) return "button";
  }
  return IMPLICIT_ROLES[el.localName];
}

const rectOf = (r: DOMRect): Rect => ({ x: r.left, y: r.top, width: r.width, height: r.height });
const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });

/** The facts about the part an agent reads first (capture-design.md §1, "Part record"). */
export function partRecord(live: Element, copy: Element | null, viewportRect: Rect, scroll: { x: number; y: number }, shotScale: number): PartRecord {
  const masked = !!live.closest(`[${MASK_ATTR}]`);
  const text = masked ? "" : (live.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const ancestors: string[] = [];
  for (let p = live.parentElement; p && ancestors.length < 12; p = p.parentElement) {
    const id = p.id ? `#${p.id}` : "";
    const cls = Array.from(p.classList).slice(0, 4).map((c) => `.${c}`).join("");
    ancestors.push(`${p.localName}${id}${cls}`);
    if (p.localName === "body") break;
  }
  const cs = live.ownerDocument.defaultView?.getComputedStyle(live);
  const styles: Record<string, string> = {};
  if (cs) for (const k of STYLE_KEYS) styles[k] = cs.getPropertyValue(k);
  const record: PartRecord = {
    selector: buildSelector(live),
    label: readableLabel(live),
    box: {
      page: round({ x: viewportRect.x + scroll.x, y: viewportRect.y + scroll.y, width: viewportRect.width, height: viewportRect.height }),
      screenshot: round({ x: viewportRect.x * shotScale, y: viewportRect.y * shotScale, width: viewportRect.width * shotScale, height: viewportRect.height * shotScale }),
    },
    ancestors,
    styles,
  };
  const role = implicitRole(live);
  if (role) record.role = role;
  const name = accessibleName(live);
  if (name) record.name = name.slice(0, 500);
  if (text) record.text = text;
  if (copy) record.outerHTML = copy.outerHTML.slice(0, 8192);
  return record;
}

/** Boxes (viewport px) of everything masked, for painting over a real screen capture. */
export function maskedBoxes(doc: Document, privacy: boolean): Rect[] {
  const out: Rect[] = [];
  doc.querySelectorAll(`input,textarea,select,[${MASK_ATTR}]`).forEach((el) => {
    if (el.closest("[data-rw]")) return;
    const isField = /^(input|textarea|select)$/.test(el.localName);
    if (isField ? fieldIsMasked(el, privacy) : true) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out.push(rectOf(r));
    }
  });
  return out;
}

export class CaptureJob {
  readonly context: CaptureContext;
  part: PartRecord | undefined;
  /** The page copy, uncompressed, for the "Page copy" tab. */
  htmlText: string | null = null;
  /** The page copy, gzipped, or null when it could not be made or was over 2 MB. */
  html: Blob | null = null;
  htmlTooLarge = false;
  shot: Shot | null = null;
  copyStage: Stage = "working";
  shotStage: Stage = "working";
  readonly copyDone: Promise<void>;
  readonly shotDone: Promise<void>;
  private readonly clone: PageClone | null;
  private readonly viewportRect: Rect | null;
  private listeners = new Set<() => void>();
  private urls: string[] = [];
  private readonly win: Window;

  constructor(private readonly doc: Document, private readonly opts: CaptureOptions) {
    const win = doc.defaultView!;
    this.win = win;
    const viewport = { width: win.innerWidth, height: win.innerHeight };
    const scroll = { x: Math.round(win.scrollX), y: Math.round(win.scrollY) };
    this.context = {
      url: win.location.href,
      title: doc.title,
      viewport,
      devicePixelRatio: win.devicePixelRatio || 1,
      scroll,
      userAgent: win.navigator.userAgent,
      capturedAt: new Date().toISOString(),
      method: "dom",
      notes: [],
    };
    if (opts.route) this.context.route = opts.route;
    if (opts.buildId) this.context.buildId = opts.buildId;
    this.viewportRect = opts.target ? rectOf(opts.target.getBoundingClientRect()) : null;

    // The copy is taken now, synchronously: the page as it was when the part was chosen.
    let clone: PageClone | null = null;
    try {
      clone = clonePage(doc, { target: opts.target, privacy: opts.privacy });
      this.context.masked = { ...clone.masked };
    } catch {
      this.note("The page copy could not be made.");
    }
    this.clone = clone;
    if (opts.target && this.viewportRect) this.part = partRecord(opts.target, clone?.target ?? null, this.viewportRect, scroll, 1);

    this.copyDone = this.finishCopy();
    this.shotDone = this.copyDone.then(() => this.drawDom());
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.listeners.forEach((fn) => fn());
  }

  note(text: string): void {
    (this.context.notes ??= []).push(text);
  }

  private async finishCopy(): Promise<void> {
    if (!this.clone) {
      this.copyStage = "failed";
      this.changed();
      return;
    }
    try {
      await this.clone.settled;
      if (this.part && this.clone.target) this.part.outerHTML = this.clone.target.outerHTML.slice(0, 8192);
      const text = serializeCopy(this.clone);
      const gz = await gzip(text);
      this.htmlText = text;
      if (!gz) this.note("The page copy could not be compressed in this browser, so it was left out.");
      else if (gz.size > LIMITS.html) {
        this.htmlTooLarge = true;
        this.note("The page copy was larger than 2 MB, so it was left out.");
      } else this.html = gz;
      this.copyStage = "ready";
    } catch {
      this.copyStage = "failed";
      this.note("The page copy could not be made.");
    }
    this.changed();
  }

  private async drawDom(): Promise<void> {
    if (!this.clone) {
      this.shotStage = "failed";
      this.changed();
      return;
    }
    try {
      const vp = this.context.viewport;
      const scale = baseScale(vp, this.context.devicePixelRatio);
      const svg = viewportSvg(this.clone, vp, this.context.scroll);
      const canvas = await drawSvg(svg, vp, scale);
      if (this.shot?.method === "screen") return; // a real capture arrived first
      await this.useCanvas(canvas, scale, "dom");
    } catch {
      if (this.shot) return;
      this.shotStage = "failed";
      this.note("The screenshot could not be drawn.");
      this.changed();
    }
  }

  private async useCanvas(canvas: HTMLCanvasElement, scale: number, method: "dom" | "screen"): Promise<void> {
    const page = await fitCanvas(canvas, LIMITS.page);
    if (!page) throw new Error("screenshot too large");
    const shot: Shot = { page: page.blob, scale: scale * page.density, method };
    const part = this.viewportRect;
    if (part) {
      const m = marked(canvas, part, scale);
      const pm = await fitCanvas(m, LIMITS.pageMarked);
      if (pm) shot.pageMarked = pm.blob;
      const cr = closeupRect(part, this.context.viewport);
      if (cr) {
        const cu = await fitCanvas(crop(m, cr, scale), LIMITS.closeup);
        if (cu) shot.closeup = cu.blob;
      }
      if (this.part && this.opts.target) {
        const s = shot.scale;
        this.part.box.screenshot = round({ x: part.x * s, y: part.y * s, width: part.width * s, height: part.height * s });
      }
    }
    this.shot = shot;
    this.context.method = method;
    this.shotStage = "ready";
    this.changed();
  }

  /** Method B. Resolves true when the real capture replaced the drawn one. */
  async useScreen(hide: () => void, show: () => void): Promise<boolean> {
    try {
      const { canvas, scale: frameScale } = await grabTabFrame(this.win, hide, show);
      // Paint masks at the frame's own scale, then bring it to ≤ 2× and ≤ 2,560 px.
      paintMasks(canvas, maskedBoxes(this.doc, this.opts.privacy), frameScale);
      const want = baseScale(this.context.viewport, this.context.devicePixelRatio);
      const factor = Math.min(1, want / frameScale);
      const sized = scaled(canvas, factor);
      await this.useCanvas(sized, frameScale * factor, "screen");
      return true;
    } catch {
      show();
      return false;
    }
  }

  /** Files to send now: the page copy always (when it exists), the screenshot only when ready. */
  files(includeShot = true): Partial<Record<CaptureFile, Blob>> {
    const f: Partial<Record<CaptureFile, Blob>> = {};
    if (this.html) f.html = this.html;
    if (includeShot && this.shot) {
      f.page = this.shot.page;
      if (this.shot.pageMarked) f.pageMarked = this.shot.pageMarked;
      if (this.shot.closeup) f.closeup = this.shot.closeup;
    }
    return f;
  }

  totalSize(includeShot = true): number {
    return Object.values(this.files(includeShot)).reduce((n, b) => n + (b?.size ?? 0), 0);
  }

  /** An object URL for a captured image (revoked by dispose). */
  url(blob: Blob): string {
    const u = URL.createObjectURL(blob);
    this.urls.push(u);
    return u;
  }

  dispose(): void {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
    this.listeners.clear();
  }
}
