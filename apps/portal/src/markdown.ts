// A small, strict Markdown renderer for message bodies.
// Everything is HTML-escaped first; the only tags that can come out are the ones made here:
// p, br, strong, em, code, pre, ul, ol, li and a (http, https and mailto only).

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function unescapeHtml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]!);
}

/** Returns the URL if it is http(s) or mailto, otherwise null. `escaped` is HTML-escaped text. */
function safeHref(escaped: string): string | null {
  const raw = unescapeHtml(escaped).trim();
  // Reject anything with whitespace or control characters smuggled into the scheme.
  if (!/^(https?:\/\/|mailto:)[^\s]+$/i.test(raw)) return null;
  return escapeHtml(raw);
}

function anchor(href: string, label: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function emphasis(s: string): string {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>");
}

/** Inline formatting of one block of raw (unescaped) text. */
export function renderInline(raw: string): string {
  const held: string[] = [];
  const hold = (html: string) => `\u0001${held.push(html) - 1}\u0002`;
  // Code spans first: nothing inside them is formatted.
  let s = raw
    .split(/(`[^`\n]+`)/g)
    .map((part) => (/^`[^`\n]+`$/.test(part) ? hold(`<code>${escapeHtml(part.slice(1, -1))}</code>`) : escapeHtml(part)))
    .join("");
  // [label](url)
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label: string, url: string) => {
    const href = safeHref(url);
    return href ? hold(anchor(href, emphasis(label))) : whole;
  });
  // Bare links.
  s = s.replace(/\b(https?:\/\/[^\s<>\u0001\u0002]+|mailto:[^\s<>\u0001\u0002]+)/gi, (m: string) => {
    let url = m;
    let tail = "";
    const trail = /(?:[.,;:!?)]|&#39;|&quot;)+$/.exec(url);
    if (trail) {
      tail = trail[0];
      url = url.slice(0, -tail.length);
    }
    const href = safeHref(url);
    return href ? hold(anchor(href, url)) + tail : m;
  });
  s = emphasis(s);
  return s.replace(/\u0001(\d+)\u0002/g, (_, i: string) => held[Number(i)] ?? "");
}

/** Renders a message body to safe HTML. */
export function renderMarkdown(input: string): string {
  const text = input.replace(CTRL, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderInline).join("<br>")}</p>`);
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // Fenced code block.
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flushPara();
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) body.push(lines[i++]!);
      i++; // the closing fence (or the end)
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    // Lists.
    const ul = /^\s*[-*+]\s+(.*)$/;
    const ol = /^\s*\d{1,9}[.)]\s+(.*)$/;
    if (ul.test(line) || ol.test(line)) {
      flushPara();
      const ordered = !ul.test(line);
      const re = ordered ? ol : ul;
      const lis: string[] = [];
      while (i < lines.length && re.test(lines[i]!)) {
        lis.push(`<li>${renderInline(re.exec(lines[i]!)![1]!)}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${lis.join("")}</ol>` : `<ul>${lis.join("")}</ul>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return out.join("");
}

/** Plain text of a body, for previews and quotes. */
export function plainText(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
