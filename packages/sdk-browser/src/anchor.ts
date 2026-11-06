// RW-1 §4: how a report finds its part again. A selector chain from the nearest stable ancestor, a
// readable label ("button “Export this list”"), and the press point inside the part. Pins re-find their
// part by selector, then by label, else the report is shown as a report on the whole page.
import type { Anchor } from "@annotatie/core";

/** Parts report mode can choose (the nearest one around the pointer wins). */
export const SELECTABLE = [
  "a", "button", "input", "select", "textarea", "label", "summary",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dt", "dd", "td", "th", "caption", "figcaption", "legend",
  "img", "svg", "video", "canvas", "iframe", "picture",
  "nav", "header", "footer", "aside", "form", "fieldset", "table", "ul", "ol", "dl", "figure", "dialog",
  "[role]", "[data-anchor]", "[data-annotatie-id]", "[data-testid]", "[tabindex]",
].join(",");

const MAX_NAME = 60;

export const isWidgetNode = (el: Element | null): boolean => !!el && !!el.closest("[data-rw]");

const collapse = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function cssEscape(value: string): string {
  const g = globalThis as { CSS?: { escape?: (s: string) => string } };
  if (g.CSS?.escape) return g.CSS.escape(value);
  return value.replace(/^-?\d|[^a-zA-Z0-9_\u00a0-\uffff-]/g, (c, i: number) =>
    /\d/.test(c) && i === 0 ? `\\3${c} ` : c.length > 1 ? `\\3${c[1]} ` : `\\${c}`,
  );
}

const attrValue = (v: string) => `"${v.replace(/["\\]/g, "\\$&")}"`;

/** Ids and classes that frameworks generate change between builds; they make bad anchors. */
export function looksGenerated(token: string): boolean {
  return (
    /\d{3,}/.test(token) ||
    /^[:_-]|:/.test(token) ||
    /^(ember|react|radix-|headlessui-|mui-|ng-|svelte-|css-|sc-|jsx-|__)/i.test(token) ||
    /[A-Za-z]+[0-9]+[A-Za-z]+[0-9]/.test(token) ||
    token.length > 40
  );
}

const isMasked = (el: Element) => !!el.closest("[data-annotatie-mask]");

/** Plain words for what a part is, as RW-1 labels write them. */
export function roleWord(el: Element): string {
  const role = el.getAttribute("role");
  if (role) {
    const r = role.split(/\s+/)[0]!.toLowerCase();
    const map: Record<string, string> = {
      button: "button", link: "link", tab: "tab", tablist: "tab list", checkbox: "checkbox", radio: "radio button",
      menuitem: "menu item", menu: "menu", dialog: "dialog", alert: "alert", status: "status", heading: "heading",
      listitem: "list item", list: "list", row: "row", cell: "cell", gridcell: "cell", columnheader: "column header",
      navigation: "navigation", banner: "app bar", img: "image", switch: "switch", combobox: "field",
      textbox: "field", searchbox: "search field", region: "region", table: "table", grid: "table", option: "option",
    };
    if (map[r]) return map[r]!;
  }
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  const map: Record<string, string> = {
    a: "link", button: "button", summary: "button", select: "field", textarea: "field", label: "label",
    img: "image", svg: "image", picture: "image", video: "video", canvas: "picture", iframe: "embedded frame",
    td: "cell", th: "column header", li: "list item", caption: "table caption", table: "table",
    ul: "list", ol: "list", dl: "list", nav: "navigation", header: "app bar", footer: "footer", aside: "aside",
    form: "form", fieldset: "group", legend: "legend", figure: "figure", figcaption: "caption", dialog: "dialog",
    p: "text", dt: "term", dd: "text", main: "main", section: "section", article: "article",
  };
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio button";
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    if (type === "password") return "password field";
    return "field";
  }
  if (tag === "a" && !el.hasAttribute("href")) return "text";
  return map[tag] ?? "text";
}

function labelFor(el: Element): string {
  const doc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id) {
    const l = doc.querySelector(`label[for=${attrValue(id)}]`);
    if (l && !isMasked(l)) return collapse(l.textContent);
  }
  const wrap = el.closest("label");
  if (wrap && !isMasked(wrap)) {
    const clone = wrap.cloneNode(true) as Element;
    clone.querySelectorAll("input,select,textarea").forEach((n) => n.remove());
    return collapse(clone.textContent);
  }
  return "";
}

/** The part's name: never a field's value, and nothing from inside a masked element. */
export function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return collapse(aria);
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id))
      .filter((n): n is HTMLElement => !!n && !isMasked(n))
      .map((n) => collapse(n.textContent))
      .join(" ");
    if (t) return t;
  }
  const tag = el.tagName.toLowerCase();
  if (tag === "img") return collapse(el.getAttribute("alt"));
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (["button", "submit", "reset"].includes(type)) return collapse(el.getAttribute("value")) || type;
    return labelFor(el) || collapse(el.getAttribute("placeholder")) || collapse(el.getAttribute("title"));
  }
  if (isMasked(el)) return "";
  if (tag === "svg") return collapse(el.querySelector("title")?.textContent);
  return collapse(el.textContent) || collapse(el.getAttribute("title"));
}

const clip = (s: string, n = MAX_NAME) => (s.length > n ? `${s.slice(0, n).trim()} …` : s);

/** "button “Export this list”", "cell “NZLX901” in the row “Ngaio Rewiti-Ashcombe”", "password field". */
export function readableLabel(el: Element): string {
  const role = roleWord(el);
  const name = clip(accessibleName(el));
  let label = name ? `${role} “${name}”` : role;
  const row = el.closest("tr");
  if (row && row !== el) {
    const first = row.querySelector("th,td");
    if (first && first !== el && !first.contains(el) && !isMasked(first)) {
      const rowName = clip(collapse(first.textContent), 40);
      if (rowName) label += ` in the row “${rowName}”`;
    }
  }
  return label;
}

/** The parts report mode outlines: the nearest selectable element around the pointer. */
export function pickPart(target: Element | null): Element | null {
  if (!target || isWidgetNode(target)) return null;
  // Inside an SVG, choose the whole drawing.
  const svg = target.closest("svg");
  if (svg) {
    let top: Element = svg;
    while (top.parentElement?.closest("svg")) top = top.parentElement.closest("svg")!;
    return top;
  }
  const el = target.closest(SELECTABLE);
  if (el && el !== el.ownerDocument.documentElement && el !== el.ownerDocument.body) return el;
  const tag = target.tagName.toLowerCase();
  return tag === "html" || tag === "body" ? null : target;
}

function stableStep(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute("id");
  if (id && !looksGenerated(id)) return `#${cssEscape(id)}`;
  for (const a of ["data-annotatie-id", "data-testid", "data-test", "data-cy", "data-anchor"]) {
    const v = el.getAttribute(a);
    if (v) return `${tag}[${a}=${attrValue(v)}]`;
  }
  const name = el.getAttribute("name");
  if (name && /^(input|select|textarea|button|form|fieldset)$/.test(tag)) return `${tag}[name=${attrValue(name)}]`;
  const aria = el.getAttribute("aria-label");
  if (aria && aria.length <= 80) return `${tag}[aria-label=${attrValue(aria)}]`;
  return null;
}

function plainStep(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (same.length === 1) return tag;
  const cls = Array.from(el.classList).filter((c) => !looksGenerated(c));
  for (const c of cls) {
    const sel = `${tag}.${cssEscape(c)}`;
    if (same.filter((s) => s.matches(sel)).length === 1) return sel;
  }
  return `${tag}:nth-of-type(${same.indexOf(el) + 1})`;
}

function count(doc: Document | Element, sel: string): number {
  try {
    return doc.querySelectorAll(sel).length;
  } catch {
    return -1;
  }
}

/**
 * A selector chain that matches exactly this element: from the nearest stable ancestor (an id that is
 * not generated, a test id, a field's name, an aria-label), else from `body`.
 */
export function buildSelector(el: Element): string {
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();
  if (tag === "html" || tag === "body") return tag;
  const steps: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== doc.body && cur !== doc.documentElement) {
    const stable = stableStep(cur);
    if (stable) {
      const chain = [stable, ...steps].join(" > ");
      if (count(doc, chain) === 1) return chain;
      // stable but repeated (a list of identical "Edit" buttons): keep walking, positioned
      const parent = cur.parentElement;
      const siblings = parent ? Array.from(parent.children).filter((c) => c.matches(stable)) : [cur];
      steps.unshift(siblings.length > 1 ? `${stable}:nth-of-type(${Array.from(parent!.children).filter((c) => c.tagName === cur!.tagName).indexOf(cur) + 1})` : stable);
    } else {
      steps.unshift(plainStep(cur));
    }
    cur = cur.parentElement;
  }
  return ["body", ...steps].join(" > ");
}

export function buildAnchor(el: Element, point?: { clientX: number; clientY: number }): Anchor {
  const r = el.getBoundingClientRect();
  const win = el.ownerDocument.defaultView;
  const anchor: Anchor = { selector: buildSelector(el), label: readableLabel(el) };
  if (point && r.width > 0 && r.height > 0) {
    const fx = (point.clientX - r.left) / r.width;
    const fy = (point.clientY - r.top) / r.height;
    anchor.offset = { x: round3(clamp01(fx)), y: round3(clamp01(fy)) };
    anchor.point = { x: Math.round(point.clientX + (win?.scrollX ?? 0)), y: Math.round(point.clientY + (win?.scrollY ?? 0)) };
  } else {
    anchor.point = { x: Math.round(r.left + (win?.scrollX ?? 0)), y: Math.round(r.top + (win?.scrollY ?? 0)) };
  }
  return anchor;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function isRendered(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0 && !el.getClientRects().length) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !style || (style.visibility !== "hidden" && style.display !== "none");
}

/** Finds the anchor's part on this page: by selector, then by label; null means "on the whole page". */
export function findAnchor(anchor: Anchor | undefined, doc: Document = document): Element | null {
  if (!anchor) return null;
  if (anchor.selector) {
    try {
      const hits = Array.from(doc.querySelectorAll(anchor.selector)).filter((e) => !isWidgetNode(e));
      if (hits.length === 1) return hits[0]!;
      if (hits.length > 1 && anchor.label) {
        const same = hits.filter((e) => readableLabel(e) === anchor.label);
        if (same.length === 1) return same[0]!;
      }
    } catch {
      // A selector the browser cannot parse: fall through to the label.
    }
  }
  if (anchor.label) {
    const all = Array.from(doc.querySelectorAll(SELECTABLE)).slice(0, 8000);
    const same = all.filter((e) => !isWidgetNode(e) && readableLabel(e) === anchor.label);
    if (same.length === 1) return same[0]!;
  }
  return null;
}
