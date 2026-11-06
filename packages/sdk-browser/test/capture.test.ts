// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://host.example.test/register", "settings": { "disableIframePageLoading": true, "disableCSSFileLoading": true, "disableJavaScriptFileLoading": true, "disableJavaScriptEvaluation": true, "handleDisabledFileLoadingAsSuccess": true } }
import { describe, expect, it } from "vitest";
import { clonePage, fieldIsMasked, serializeCopy } from "../src/capture/clone.js";
import { closeupRect, baseScale, fitToLimit } from "../src/capture/render.js";
import { isDangerousUrl, sanitizeCss, sanitizeHtml } from "../src/capture/sanitize.js";

describe("page-copy sanitising", () => {
  const dirty = `<head><base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test">
    <meta charset="utf-8"><link rel="stylesheet" href="https://cdn.test/a.css"><script>alert(1)</script></head>
    <body onload="steal()"><h1 onclick="x()" onmouseover='y()'>Title</h1>
    <div style="background:url(https://track.test/p.gif);color:red">styled</div>
    <a href="javascript:alert(1)">a</a><a href=" java&#x09;script:alert(2)">b</a><a href="JAVASCRIPT:alert(3)">c</a>
    <a href="data:text/html,<script>alert(4)</script>">d</a><a href="/ok">ok</a>
    <img src="data:image/png;base64,iVBORw0KGgo=" srcset="https://evil.test/x.png 2x">
    <iframe src="https://evil.test"></iframe><iframe srcdoc="<script>1</script>"></iframe>
    <object data="x.swf"></object><embed src="x.swf"><noscript><img src=x></noscript>
    <form action="javascript:alert(5)"><button formaction="javascript:1">go</button></form>
    <svg><a xlink:href="javascript:alert(6)"><text>t</text></a><set attributeName="href" to="javascript:alert(7)"/><script>alert(8)</script></svg>
    <style>@import url(https://evil.test/x.css); .a{background:url('https://evil.test/b.png')}</style>
    <template><script>1</script></template></body>`;
  const out = sanitizeHtml(dirty);

  it("removes scripts, frames, objects, base, links and meta http-equiv", () => {
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/<object|<embed|<noscript|<template/i);
    expect(out).not.toMatch(/<base/i);
    expect(out).not.toMatch(/<link/i);
    expect(out).not.toMatch(/http-equiv/i);
    expect(out).toMatch(/<meta charset="utf-8">/);
  });

  it("strips on* handlers and javascript: and data:text/html URLs, keeping safe links", () => {
    expect(out).not.toMatch(/\son\w+=/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/data:text\/html/i);
    expect(out).not.toMatch(/srcset/i);
    expect(out).toContain('href="/ok"');
    expect(out).toContain("data:image/png;base64");
    expect(out).not.toMatch(/<set\b/i);
  });

  it("neutralises url() and @import in styles", () => {
    expect(out).not.toContain("track.test");
    expect(out).not.toContain("evil.test");
    expect(out).toMatch(/color:\s*red/);
    expect(sanitizeCss("a{background:url(data:image/png;base64,AAA)}")).toContain("data:image/png");
    expect(sanitizeCss("width:expression(alert(1))")).not.toMatch(/expression\(/);
  });

  it("recognises obfuscated dangerous URLs", () => {
    expect(isDangerousUrl("  JaVaScRiPt:alert(1)")).toBe(true);
    expect(isDangerousUrl("java\nscript:alert(1)")).toBe(true);
    expect(isDangerousUrl("vbscript:x")).toBe(true);
    expect(isDangerousUrl("data:image/svg+xml,<svg onload=alert(1)>")).toBe(true);
    expect(isDangerousUrl("data:image/webp;base64,AAA")).toBe(false);
    expect(isDangerousUrl("https://ok.test/")).toBe(false);
  });
});

describe("page copy: masking, frozen state, images, the widget left out", () => {
  function setup() {
    document.body.innerHTML = `
      <form>
        <label>Email <input id="email" type="email"></label>
        <input id="pw" type="password">
        <input id="iban" data-annotatie-mask>
        <div data-annotatie-mask id="acct"><p>Account 12345678</p><input id="inner"></div>
        <textarea id="notes"></textarea>
        <select id="role"><option>Judge</option><option>Umpire</option></select>
        <input id="agree" type="checkbox">
        <details id="more"><summary>More</summary>hidden text</details>
      </form>
      <button id="target" onclick="go()">Export this list</button>
      <img id="local" src="/logo.png" alt="Club logo">
      <img id="remote" src="https://cdn.other.test/x.png" alt="Sponsor banner">
      <iframe src="https://maps.test"></iframe>
      <script>window.secret = 1</script>
      <div data-rw><p>widget node</p></div>`;
    (document.getElementById("email") as HTMLInputElement).value = "ellis@example.test";
    (document.getElementById("pw") as HTMLInputElement).value = "hunter2";
    (document.getElementById("iban") as HTMLInputElement).value = "GB00 1234";
    (document.getElementById("inner") as HTMLInputElement).value = "inner secret";
    (document.getElementById("notes") as HTMLTextAreaElement).value = "my notes";
    (document.getElementById("role") as HTMLSelectElement).selectedIndex = 1;
    (document.getElementById("agree") as HTMLInputElement).checked = true;
    (document.getElementById("more") as HTMLDetailsElement).open = true;
  }

  const inline = async (url: string) => (url.endsWith("/logo.png") ? "data:image/png;base64,AAAA" : null);

  it("blanks password and marked fields, keeps others, and counts what it masked", async () => {
    setup();
    const clone = clonePage(document, { target: document.getElementById("target"), privacy: false, inlineStyles: false, inlineImage: inline });
    await clone.settled;
    const html = serializeCopy(clone);
    expect(html).not.toContain("hunter2");
    expect(html).not.toContain("GB00 1234");
    expect(html).not.toContain("Account 12345678");
    expect(html).not.toContain("inner secret");
    expect(html).toContain('value="ellis@example.test"');
    expect(html).toContain("my notes");
    expect(clone.masked).toEqual({ fields: 2, elements: 1 });
    expect(clone.root.querySelector("#acct")!.hasAttribute("data-annotatie-masked")).toBe(true);
  });

  it("privacy mode blanks every form field's text", async () => {
    setup();
    const clone = clonePage(document, { target: null, privacy: true, inlineStyles: false, inlineImage: inline });
    await clone.settled;
    const html = serializeCopy(clone);
    for (const secret of ["ellis@example.test", "hunter2", "GB00 1234", "my notes", "Umpire"]) expect(html).not.toContain(secret);
    expect(clone.masked.fields).toBeGreaterThanOrEqual(5);
    expect(fieldIsMasked(document.getElementById("agree")!, true)).toBe(false);
  });

  it("freezes form values and open state, marks the part, and leaves out scripts and the widget", async () => {
    setup();
    const clone = clonePage(document, { target: document.getElementById("target"), privacy: false, inlineStyles: false, inlineImage: inline });
    await clone.settled;
    const r = clone.root;
    expect(r.querySelector("#agree")!.hasAttribute("checked")).toBe(true);
    expect(r.querySelectorAll("#role option")[1]!.hasAttribute("selected")).toBe(true);
    expect(r.querySelector("#more")!.hasAttribute("open")).toBe(true);
    expect(r.querySelector("#target")!.hasAttribute("data-annotatie-target")).toBe(true);
    expect(clone.target).toBe(r.querySelector("#target"));
    expect(r.querySelector("#target")!.hasAttribute("onclick")).toBe(false);
    expect(r.querySelector("script")).toBeNull();
    expect(r.querySelector("iframe")).toBeNull();
    expect(r.querySelector("[data-rw]")).toBeNull();
    expect(serializeCopy(clone)).not.toContain("widget node");
    expect(serializeCopy(clone)).toContain("Content-Security-Policy");
  });

  it("inlines small same-origin images and boxes the rest, labelled by alt", async () => {
    setup();
    const clone = clonePage(document, { target: null, privacy: false, inlineStyles: false, inlineImage: inline });
    await clone.settled;
    expect(clone.root.querySelector("#local")!.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(clone.root.querySelector("#remote")).toBeNull();
    const boxes = Array.from(clone.root.querySelectorAll("[data-annotatie-placeholder]")).map((b) => b.textContent);
    expect(boxes).toContain("Sponsor banner");
    expect(boxes).toContain("Embedded content");
    expect(serializeCopy(clone)).not.toContain("cdn.other.test");
  });

  it("does not change the live page", async () => {
    setup();
    const before = document.body.innerHTML;
    const clone = clonePage(document, { target: document.getElementById("target"), privacy: true, inlineStyles: false, inlineImage: inline });
    await clone.settled;
    expect(document.body.innerHTML).toBe(before);
    expect((document.getElementById("pw") as HTMLInputElement).value).toBe("hunter2");
  });
});

describe("size fitting", () => {
  it("lowers quality first, then density, and returns the first that fits", async () => {
    const tried: string[] = [];
    const sizes: Record<string, number> = { "1@0.9": 900, "1@0.5": 600, "0.5@0.9": 400, "0.5@0.5": 200 };
    const r = await fitToLimit(async (d, q) => {
      tried.push(`${d}@${q}`);
      return { size: sizes[`${d}@${q}`]! };
    }, 300, [1, 0.5], [0.9, 0.5]);
    expect(tried).toEqual(["1@0.9", "1@0.5", "0.5@0.9", "0.5@0.5"]);
    expect(r).toEqual({ blob: { size: 200 }, density: 0.5, quality: 0.5 });
  });

  it("returns null when nothing fits or the encoder fails", async () => {
    expect(await fitToLimit(async () => ({ size: 10_000 }), 300, [1, 0.5], [0.9])).toBeNull();
    expect(await fitToLimit(async () => null, 300)).toBeNull();
  });

  it("caps density at 2× and the long edge at 2,560 px", () => {
    expect(baseScale({ width: 390, height: 844 }, 3)).toBe(2);
    expect(baseScale({ width: 1280, height: 800 }, 1)).toBe(1);
    expect(baseScale({ width: 1920, height: 1080 }, 2)).toBeCloseTo(2560 / 1920);
    expect(baseScale({ width: 800, height: 600 }, 0)).toBe(1);
  });

  it("crops the close-up with a 48 px margin, inside the viewport", () => {
    const vp = { width: 390, height: 844 };
    expect(closeupRect({ x: 100, y: 200, width: 50, height: 20 }, vp)).toEqual({ x: 52, y: 152, width: 146, height: 116 });
    expect(closeupRect({ x: 10, y: 5, width: 50, height: 20 }, vp)).toEqual({ x: 0, y: 0, width: 108, height: 73 });
    expect(closeupRect({ x: 370, y: 830, width: 100, height: 100 }, vp)).toEqual({ x: 322, y: 782, width: 68, height: 62 });
    expect(closeupRect({ x: 0, y: 2000, width: 50, height: 20 }, vp)).toBeNull();
  });
});
