// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown";

/** Parses the output and lists every element and attribute, to prove nothing unexpected came out. */
function inspect(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  const tags = new Set<string>();
  const attrs: string[] = [];
  host.querySelectorAll("*").forEach((el) => {
    tags.add(el.tagName.toLowerCase());
    for (const a of Array.from(el.attributes)) attrs.push(`${a.name}=${a.value}`);
  });
  return { host, tags, attrs };
}
const ALLOWED = new Set(["p", "br", "strong", "em", "code", "pre", "ul", "ol", "li", "a"]);

describe("markdown", () => {
  it("renders paragraphs, line breaks, bold, italic and code", () => {
    expect(renderMarkdown("Hello **you** and *them*\nnext `x<y`\n\nTwo")).toBe(
      "<p>Hello <strong>you</strong> and <em>them</em><br>next <code>x&lt;y</code></p><p>Two</p>",
    );
  });

  it("renders fenced code without formatting inside it", () => {
    expect(renderMarkdown("```\n**not bold** <b>\n```")).toBe("<pre><code>**not bold** &lt;b&gt;</code></pre>");
  });

  it("renders lists", () => {
    expect(renderMarkdown("- a\n- b\n\n1. one\n2. two")).toBe("<ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol>");
  });

  it("links http(s) and mailto, safely", () => {
    const out = renderMarkdown("See [the docs](https://example.com/a?b=1&c=2) or https://example.org/x. Mail mailto:a@example.com");
    const { host } = inspect(out);
    const links = Array.from(host.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://example.com/a?b=1&c=2", "https://example.org/x", "mailto:a@example.com"]);
    for (const a of links) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });

  it("makes <script> inert", () => {
    const out = renderMarkdown("<script>alert(1)</script>");
    expect(out).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(inspect(out).tags.has("script")).toBe(false);
  });

  it("makes <img onerror> inert", () => {
    const out = renderMarkdown('<img src=x onerror="alert(1)"> and **<svg onload=alert(1)>**');
    const { tags, attrs } = inspect(out);
    expect([...tags].every((t) => ALLOWED.has(t))).toBe(true);
    expect(tags.has("img")).toBe(false);
    expect(attrs.some((a) => a.startsWith("on"))).toBe(false);
  });

  it("refuses javascript:, data: and vbscript: links", () => {
    for (const bad of ["[x](javascript:alert(1))", "[x](JaVaScRiPt:alert(1))", "[x](data:text/html,<script>alert(1)</script>)", "[x](vbscript:msgbox)", "javascript:alert(1)"]) {
      const { host, attrs } = inspect(renderMarkdown(bad));
      expect(host.querySelectorAll("a")).toHaveLength(0);
      expect(attrs).toEqual([]);
    }
  });

  it("can't break out of an href with quotes", () => {
    const { host } = inspect(renderMarkdown('[x](https://a.example/"onmouseover="alert(1))'));
    const a = host.querySelector("a");
    expect(a?.getAttributeNames().sort()).toEqual(["href", "rel", "target"]);
  });

  it("escapes entities and HTML inside link labels", () => {
    const { host, tags } = inspect(renderMarkdown("[<b>hi</b>](https://example.com)"));
    expect(tags.has("b")).toBe(false);
    expect(host.querySelector("a")?.textContent).toBe("<b>hi</b>");
  });
});
