// capture-design.md §7–§8: the page copy carries no script, no handler, no way to call out and no way to
// navigate. The server sanitises it again; this is the first of the two passes.

/** Elements removed outright, with their contents. */
export const DROP_ELEMENTS = new Set([
  "script", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "link",
  "portal", "template", "slot",
]);

const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "background", "cite", "data", "codebase", "longdesc", "manifest", "lowsrc", "dynsrc", "ping"];

/** True for URLs that run code or render a document: javascript:, vbscript:, data: other than an image. */
export function isDangerousUrl(value: string): boolean {
  // Browsers ignore control characters and whitespace inside the scheme ("java\tscript:").
  const v = value.replace(/[\x00-\x20\x7f-\x9f]/g, "").toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("vbscript:") || v.startsWith("livescript:")) return true;
  if (v.startsWith("data:")) return !/^data:image\/(png|gif|jpe?g|webp|avif|bmp)[,;]/.test(v);
  return false;
}

/** Removes url(...) that is not an inline image, @import, and old IE expression() from CSS text. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "invalid(")
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q: string, u: string) =>
      /^data:image\/(png|gif|jpe?g|webp|avif|bmp|svg\+xml)[;,]/i.test(u.trim()) ? m : "none",
    )
    .replace(/-moz-binding\s*:[^;]*/gi, "")
    .replace(/behavior\s*:[^;]*/gi, "");
}

function cleanElementAttrs(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on") || name === "srcdoc" || name === "srcset" || name === "imagesrcset" || name === "http-equiv" || name === "nonce" || name === "integrity") {
      el.removeAttribute(attr.name);
      continue;
    }
    if (URL_ATTRS.includes(name) && isDangerousUrl(attr.value)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === "style") {
      const clean = sanitizeCss(attr.value);
      if (clean !== attr.value) el.setAttribute("style", clean);
    }
  }
}

/**
 * Sanitises a copy of a page in place: removes scripts, frames, objects, `<base>`, `<link>`,
 * `<meta http-equiv>` and SVG animations of links; strips `on*` handlers, `srcdoc`, `srcset` and
 * `javascript:` / `data:text/html` URLs; neutralises `url()` and `@import` in styles. The root may be a
 * document element or any element of a detached copy (never the live page).
 */
export function sanitizeTree(root: Element): void {
  const doomed: Element[] = [];
  const walk = (el: Element) => {
    const tag = el.localName.toLowerCase();
    if (
      DROP_ELEMENTS.has(tag) ||
      (tag === "meta" && el.hasAttribute("http-equiv")) ||
      ((tag === "set" || tag === "animate") && /href/i.test(el.getAttribute("attributeName") || ""))
    ) {
      doomed.push(el);
      return;
    }
    cleanElementAttrs(el);
    if (tag === "style") el.textContent = sanitizeCss(el.textContent || "");
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  for (const el of doomed) el.remove();
}

/** Sanitises an HTML string (for tests and for anything that arrives as text). */
export function sanitizeHtml(html: string, doc: Document = document): string {
  const copy = doc.implementation.createHTMLDocument("");
  copy.documentElement.innerHTML = html.replace(/^<!doctype[^>]*>/i, "").replace(/^\s*<html[^>]*>|<\/html>\s*$/gi, "");
  sanitizeTree(copy.documentElement);
  return copy.documentElement.outerHTML;
}
