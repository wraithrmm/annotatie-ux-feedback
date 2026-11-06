// capture-design.md §1, §7, §8: the page copy. A detached copy of the settled DOM, made without running
// any of the page's code (elements are created in an inert document, never cloned through their
// constructors): the widget's own nodes left out, computed styles inlined, form values and open state
// frozen, masking applied, images inlined or replaced by labelled boxes, then sanitised.
import { sanitizeTree } from "./sanitize.js";

export const INLINE_IMAGE_LIMIT = 50 * 1024;
export const MASK_ATTR = "data-annotatie-mask";
export const MASKED_ATTR = "data-annotatie-masked";
export const TARGET_ATTR = "data-annotatie-target";

export interface MaskCounts {
  fields: number;
  elements: number;
}

export interface CloneOptions {
  /** The chosen part (marked `data-annotatie-target`); null for a whole-page report. */
  target?: Element | null;
  /** Privacy mode: every form field's text is left blank. */
  privacy?: boolean;
  /** Inline computed styles (needs a real layout engine; off in unit tests). */
  inlineStyles?: boolean;
  /** Fetches a same-origin image as a data URL if it is small enough; null otherwise. */
  inlineImage?: (url: string) => Promise<string | null>;
}

export interface PageClone {
  doc: Document;
  root: HTMLElement;
  /** The chosen part's copy, if any. */
  target: Element | null;
  masked: MaskCounts;
  /** Resolves when images are inlined or replaced. */
  settled: Promise<void>;
}

/** Inherited CSS properties: written only where they differ from the parent's. */
const INHERITED = new Set([
  "color", "cursor", "direction", "font-family", "font-size", "font-style", "font-variant", "font-weight",
  "font-stretch", "font-kerning", "font-feature-settings", "font-variation-settings", "letter-spacing",
  "line-height", "list-style-image", "list-style-position", "list-style-type", "quotes", "tab-size",
  "text-align", "text-indent", "text-transform", "text-shadow", "visibility", "white-space", "word-break",
  "word-spacing", "overflow-wrap", "word-wrap", "hyphens", "border-collapse", "border-spacing",
  "caption-side", "empty-cells", "writing-mode", "text-rendering", "-webkit-font-smoothing",
  "-webkit-text-fill-color", "-webkit-text-stroke-color", "-webkit-text-stroke-width", "text-align-last",
  "text-underline-position", "text-decoration-skip-ink", "orphans", "widows", "color-scheme", "accent-color",
]);

/** Properties never copied: motion, and what only matters to a live page. */
const SKIP = /^(transition|animation|will-change|view-transition|scroll-|overscroll|caret|user-select|-webkit-user|pointer-events|touch-action|content-visibility|contain-intrinsic|interpolate-size)/;

const PSEUDO_PROPS = [
  "content", "display", "position", "top", "right", "bottom", "left", "width", "height", "min-width", "min-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom",
  "padding-left", "border-top", "border-right", "border-bottom", "border-left", "border-radius", "background-color",
  "background-image", "background-size", "background-position", "background-repeat", "color", "font-family",
  "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-transform", "text-decoration",
  "transform", "opacity", "z-index", "box-shadow", "vertical-align", "white-space", "mask-image",
  "-webkit-mask-image", "mask-size", "-webkit-mask-size", "flex-shrink", "inset",
];

const FIELD_TAGS = new Set(["input", "textarea", "select"]);
const TEXT_INPUT = /^(|text|search|email|tel|url|number|password|date|datetime-local|month|week|time|color)$/;

interface DefaultsProvider {
  get(tag: string, ns: string | null): CSSStyleDeclaration | null;
  dispose(): void;
}

/** Each tag's default computed style, read from an empty same-origin frame inside the widget's root. */
function defaultsFrom(doc: Document): DefaultsProvider {
  let frame: HTMLIFrameElement | null = null;
  const cache = new Map<string, Record<string, string>>();
  const proxy = new Map<string, CSSStyleDeclaration>();
  return {
    get(tag, ns) {
      const key = `${ns}|${tag}`;
      if (proxy.has(key)) return proxy.get(key)!;
      try {
        if (!frame) {
          frame = doc.createElement("iframe");
          frame.setAttribute("data-rw", "defaults");
          frame.setAttribute("aria-hidden", "true");
          frame.tabIndex = -1;
          frame.style.cssText = "position:fixed;left:-10000px;top:0;width:100px;height:100px;border:0;visibility:hidden";
          doc.documentElement.appendChild(frame);
        }
        const fdoc = frame.contentDocument!;
        const el = ns && ns !== "http://www.w3.org/1999/xhtml" ? fdoc.createElementNS(ns, tag) : fdoc.createElement(tag);
        const host = ns === "http://www.w3.org/2000/svg" && tag !== "svg" ? fdoc.createElementNS(ns, "svg") : null;
        if (host) {
          host.appendChild(el);
          fdoc.body.appendChild(host);
        } else fdoc.body.appendChild(el);
        const cs = frame.contentWindow!.getComputedStyle(el);
        const snap: Record<string, string> = {};
        for (let i = 0; i < cs.length; i++) {
          const n = cs[i]!;
          snap[n] = cs.getPropertyValue(n);
        }
        (host ?? el).remove();
        cache.set(key, snap);
        const decl = { getPropertyValue: (n: string) => snap[n] ?? "" } as unknown as CSSStyleDeclaration;
        proxy.set(key, decl);
        return decl;
      } catch {
        return null;
      }
    },
    dispose() {
      frame?.remove();
      frame = null;
    },
  };
}

function isMaskedLive(el: Element): boolean {
  return !!el.closest(`[${MASK_ATTR}]`);
}

/** Should this live field's text be left blank in the copy? */
export function fieldIsMasked(el: Element, privacy: boolean): boolean {
  const tag = el.localName;
  if (!FIELD_TAGS.has(tag)) return false;
  const type = (el.getAttribute("type") || "").toLowerCase();
  if (tag === "input" && type === "password") return true;
  if (isMaskedLive(el)) return true;
  if (privacy) return tag !== "input" || TEXT_INPUT.test(type) || type === "hidden";
  return false;
}

function placeholderBox(copy: Document, label: string, w: number, h: number, display = "inline-block"): HTMLElement {
  const box = copy.createElement("span");
  box.setAttribute("data-annotatie-placeholder", "");
  box.setAttribute("style", `display:${display === "inline" ? "inline-block" : display};box-sizing:border-box;width:${Math.round(w)}px;height:${Math.round(h)}px;border:1px dashed #95a3b4;background:#f3f5f8;color:#495565;font:12px/16px system-ui,sans-serif;padding:4px;overflow:hidden;vertical-align:middle;`);
  box.textContent = label;
  return box;
}

function sameOrigin(url: string, doc: Document): boolean {
  try {
    const u = new URL(url, doc.baseURI);
    return u.origin === (doc.defaultView?.location.origin ?? "") || u.protocol === "blob:" || u.protocol === "data:";
  } catch {
    return false;
  }
}

/** Reads a same-origin image (from the cache when it can) and returns it as a data URL if ≤ 50 KB. */
export async function fetchImageAsDataUrl(url: string, limit = INLINE_IMAGE_LIMIT): Promise<string | null> {
  try {
    if (url.startsWith("data:")) return url.length <= limit * 1.4 ? url : null;
    const res = await fetch(url, { cache: "force-cache", credentials: "same-origin", mode: "same-origin" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > limit || !/^image\//.test(blob.type)) return null;
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Makes the page copy. Synchronous up to `settled` (images), so it shows the page exactly as it was when
 * the part was chosen.
 */
export function clonePage(doc: Document, opts: CloneOptions = {}): PageClone {
  const privacy = !!opts.privacy;
  const inlineStyles = opts.inlineStyles ?? true;
  const win = doc.defaultView;
  const copy = doc.implementation.createHTMLDocument("");
  const masked: MaskCounts = { fields: 0, elements: 0 };
  const defaults = inlineStyles ? defaultsFrom(doc) : null;
  const pseudoRules: string[] = [];
  const pending: Array<Promise<void>> = [];
  const inlineImage = opts.inlineImage ?? ((u: string) => fetchImageAsDataUrl(u));
  let targetCopy: Element | null = null;
  let pseudoN = 0;

  const styleText = (el: Element, parentCs: CSSStyleDeclaration | null): { text: string; cs: CSSStyleDeclaration | null } => {
    if (!inlineStyles || !win) return { text: "", cs: null };
    const cs = win.getComputedStyle(el);
    const def = defaults!.get(el.localName, el.namespaceURI);
    const out: string[] = [];
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i]!;
      if (name.startsWith("--") || SKIP.test(name)) continue;
      const value = cs.getPropertyValue(name);
      if (!value) continue;
      if (INHERITED.has(name)) {
        const base = parentCs ? parentCs.getPropertyValue(name) : def?.getPropertyValue(name);
        if (value === base) continue;
      } else if (def && def.getPropertyValue(name) === value) continue;
      out.push(`${name}:${value}`);
    }
    return { text: out.join(";"), cs };
  };

  const pseudo = (el: Element, which: "::before" | "::after"): string | null => {
    if (!inlineStyles || !win) return null;
    const ps = win.getComputedStyle(el, which);
    const content = ps.getPropertyValue("content");
    if (!content || content === "none" || content === "normal") return null;
    if (isMaskedLive(el)) return null;
    const decl = PSEUDO_PROPS.map((p) => [p, ps.getPropertyValue(p)] as const)
      .filter(([, v]) => v && v !== "auto" && v !== "none" && v !== "normal")
      .map(([p, v]) => `${p}:${v}`);
    if (!decl.some((d) => d.startsWith("content:"))) decl.unshift(`content:${content}`);
    return decl.join(";");
  };

  const copyAttrs = (from: Element, to: Element) => {
    for (const a of Array.from(from.attributes)) {
      try {
        if (a.namespaceURI) to.setAttributeNS(a.namespaceURI, a.name, a.value);
        else to.setAttribute(a.name, a.value);
      } catch {
        // An attribute name the copy's parser refuses: leave it out.
      }
    }
  };

  const walk = (el: Element, parentCs: CSSStyleDeclaration | null): Node | null => {
    if (el.hasAttribute("data-rw")) return null;
    const tag = el.localName;
    if (tag === "script" || tag === "noscript" || tag === "template" || tag === "link" || tag === "base") return null;
    if (tag === "style" && inlineStyles) return null;
    if (tag === "meta" && el.hasAttribute("http-equiv")) return null;
    const rect = el.getBoundingClientRect();
    // Hidden parts stay in the copy (hidden rows matter to reviewers), with their styles.
    const liveCs = inlineStyles && win ? win.getComputedStyle(el) : null;

    // Frames, objects and media: a sized box naming what was there.
    if (["iframe", "frame", "object", "embed", "video", "audio", "canvas"].includes(tag)) {
      if (tag === "canvas") {
        try {
          const data = (el as HTMLCanvasElement).toDataURL("image/png");
          if (data.length <= INLINE_IMAGE_LIMIT * 1.4) {
            const img = copy.createElement("img");
            img.setAttribute("src", data);
            img.setAttribute("alt", el.getAttribute("aria-label") || "");
            img.setAttribute("style", `${styleText(el, parentCs).text};width:${rect.width}px;height:${rect.height}px`);
            return img;
          }
        } catch {
          // A tainted canvas: fall through to the box.
        }
      }
      const word = tag === "video" ? "Video" : tag === "audio" ? "Audio" : tag === "canvas" ? "Picture" : "Embedded content";
      const label = el.getAttribute("title") || el.getAttribute("aria-label") || word;
      const box = placeholderBox(copy, isMaskedLive(el) ? word : label, rect.width, rect.height, liveCs?.display);
      return box;
    }

    const ns = el.namespaceURI;
    const out = ns && ns !== "http://www.w3.org/1999/xhtml" ? copy.createElementNS(ns, el.tagName) : copy.createElement(tag);
    copyAttrs(el, out);
    out.removeAttribute("inert");
    if (el === opts.target) {
      out.setAttribute(TARGET_ATTR, "");
      targetCopy = out;
    }

    let { text: style, cs } = tag === "head" || tag === "title" || tag === "meta" ? { text: "", cs: null } : styleText(el, parentCs);

    // Masked elements (not fields): their contents are left out, the box keeps its size.
    const masksSelf = el.hasAttribute(MASK_ATTR) && !FIELD_TAGS.has(tag);
    if (masksSelf && !el.parentElement?.closest(`[${MASK_ATTR}]`)) {
      masked.elements++;
      out.setAttribute(MASKED_ATTR, "");
      const hatch = "background:repeating-linear-gradient(45deg,#e5e7eb 0 6px,#ffffff 6px 12px);overflow:hidden";
      out.setAttribute("style", `${style}${style ? ";" : ""}width:${Math.round(rect.width)}px;height:${Math.round(rect.height)}px;box-sizing:border-box;${hatch}`);
      return out;
    }

    // Freeze form state.
    if (tag === "input") {
      const input = el as HTMLInputElement;
      const type = (input.type || "text").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        if (input.checked) out.setAttribute("checked", "");
        else out.removeAttribute("checked");
      } else if (type !== "file") {
        if (fieldIsMasked(el, privacy)) {
          out.setAttribute("value", "");
          out.setAttribute(MASKED_ATTR, "");
          if (input.value || type === "password") masked.fields++;
        } else out.setAttribute("value", input.value);
      }
    } else if (tag === "textarea") {
      const ta = el as HTMLTextAreaElement;
      if (fieldIsMasked(el, privacy)) {
        out.textContent = "";
        out.setAttribute(MASKED_ATTR, "");
        if (ta.value) masked.fields++;
      } else out.textContent = ta.value;
      if (style) out.setAttribute("style", style);
      return out;
    } else if (tag === "select") {
      const sel = el as HTMLSelectElement;
      if (fieldIsMasked(el, privacy)) {
        out.setAttribute(MASKED_ATTR, "");
        const o = copy.createElement("option");
        o.setAttribute("selected", "");
        out.appendChild(o);
        masked.fields++;
        if (style) out.setAttribute("style", style);
        return out;
      }
      void sel; // its options carry the frozen choice (below)
    } else if (tag === "option") {
      if ((el as HTMLOptionElement).selected) out.setAttribute("selected", "");
      else out.removeAttribute("selected");
    } else if (tag === "details") {
      if ((el as HTMLDetailsElement).open) out.setAttribute("open", "");
    } else if (tag === "dialog") {
      if ((el as HTMLDialogElement).open) out.setAttribute("open", "");
    }

    // Images: same-origin and small → inline; anything else → a box labelled by its alt text.
    if (tag === "img") {
      const img = el as HTMLImageElement;
      const src = img.currentSrc || img.src || el.getAttribute("src") || "";
      out.removeAttribute("srcset");
      out.removeAttribute("sizes");
      out.removeAttribute("loading");
      if (!src || !sameOrigin(src, doc) || isMaskedLive(el)) {
        const box = placeholderBox(copy, el.getAttribute("alt") || "Image", rect.width, rect.height, liveCs?.display);
        return box;
      }
      out.setAttribute("src", "");
      const fixed = `${style}${style ? ";" : ""}width:${rect.width}px;height:${rect.height}px`;
      out.setAttribute("style", fixed);
      pending.push(
        inlineImage(src).then((data) => {
          if (data) out.setAttribute("src", data);
          else out.replaceWith(placeholderBox(copy, el.getAttribute("alt") || "Image", rect.width, rect.height, liveCs?.display));
        }),
      );
      return out;
    }
    if (tag === "source") return null;
    if (tag === "image" || tag === "use") {
      for (const a of ["href", "xlink:href"]) {
        const v = el.getAttribute(a);
        if (v && !v.startsWith("#") && !v.startsWith("data:image/")) out.removeAttribute(a);
      }
    }

    // Background images in the inlined style.
    if (style && /url\(/.test(style)) {
      const urls = Array.from(style.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)).map((m) => m[2]!);
      for (const u of urls) {
        if (u.startsWith("data:")) continue;
        if (!sameOrigin(u, doc)) {
          style = style.split(`url("${u}")`).join("none").split(`url(${u})`).join("none");
          continue;
        }
        pending.push(
          inlineImage(new URL(u, doc.baseURI).href).then((data) => {
            const cur = out.getAttribute("style") || "";
            out.setAttribute("style", cur.split(`url("${u}")`).join(data ? `url("${data}")` : "none").split(`url(${u})`).join(data ? `url("${data}")` : "none"));
          }),
        );
      }
    }

    // Pseudo-elements become rules in the copy's own <style>.
    if (inlineStyles && win) {
      const before = pseudo(el, "::before");
      const after = pseudo(el, "::after");
      if (before || after) {
        const cls = `ann-p${pseudoN++}`;
        out.setAttribute("class", `${out.getAttribute("class") || ""} ${cls}`.trim());
        if (before) pseudoRules.push(`.${cls}::before{${before}}`);
        if (after) pseudoRules.push(`.${cls}::after{${after}}`);
      }
    }

    if (style) out.setAttribute("style", style);

    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) {
        const c = walk(child as Element, cs);
        if (c) out.appendChild(c);
      } else if (child.nodeType === 3) {
        out.appendChild(copy.createTextNode(child.nodeValue ?? ""));
      }
    }
    return out;
  };

  const root = walk(doc.documentElement, null) as HTMLElement;
  defaults?.dispose();
  copy.removeChild(copy.documentElement);
  copy.appendChild(root);

  // The copy's own head: charset, a strict CSP, the pseudo-element rules and the marks reviewers see.
  let head = root.querySelector("head");
  if (!head) {
    head = copy.createElement("head");
    root.insertBefore(head, root.firstChild);
  }
  const meta = copy.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  head.insertBefore(meta, head.firstChild);
  const style = copy.createElement("style");
  style.setAttribute("data-annotatie", "");
  style.textContent =
    `[${TARGET_ATTR}]{outline:3px solid #ba0e17 !important;outline-offset:2px}` +
    `input[${MASKED_ATTR}],textarea[${MASKED_ATTR}],select[${MASKED_ATTR}]{background-image:repeating-linear-gradient(45deg,#e5e7eb 0 6px,#ffffff 6px 12px)}` +
    pseudoRules.join("");
  head.appendChild(style);

  sanitizeTree(root);
  const settled = Promise.all(pending).then(() => undefined);
  return { doc: copy, root, target: targetCopy, masked, settled };
}

const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/** The page copy as a standalone HTML document, with a CSP that lets it fetch nothing. */
export function serializeCopy(clone: PageClone): string {
  const head = clone.root.querySelector("head");
  let csp = head?.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (head && !csp) {
    csp = clone.doc.createElement("meta");
    csp.setAttribute("http-equiv", "Content-Security-Policy");
    csp.setAttribute("content", CSP);
    head.insertBefore(csp, head.firstChild?.nextSibling ?? null);
  }
  return `<!doctype html>\n${clone.root.outerHTML}`;
}

/**
 * The copy as XHTML inside an SVG foreignObject, showing the viewport the reporter saw (C4: the visible
 * part only). Fixed elements stay where they were; the rest moves up by the scroll position.
 */
export function viewportSvg(clone: PageClone, viewport: { width: number; height: number }, scroll: { x: number; y: number }): string {
  const root = clone.root;
  const before = root.getAttribute("style");
  root.setAttribute("style", `${before ? `${before};` : ""}position:relative;top:${-scroll.y}px;left:${-scroll.x}px;margin:0;overflow:hidden`);
  const head = root.querySelector("head");
  const csp = head?.querySelector('meta[http-equiv="Content-Security-Policy"]');
  csp?.remove();
  const xhtml = new XMLSerializer().serializeToString(root);
  if (before === null) root.removeAttribute("style");
  else root.setAttribute("style", before);
  if (csp && head) head.insertBefore(csp, head.firstChild?.nextSibling ?? null);
  const { width, height } = viewport;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
}
