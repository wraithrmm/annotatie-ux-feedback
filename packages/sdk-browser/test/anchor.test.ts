// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { accessibleName, buildAnchor, buildSelector, findAnchor, looksGenerated, pickPart, readableLabel, roleWord } from "../src/anchor.js";

function page(html: string) {
  document.body.innerHTML = html;
}

describe("selectors", () => {
  beforeEach(() =>
    page(`
    <header><nav aria-label="Main"><a href="/">Today</a><a href="/reg">Register</a></nav></header>
    <main id="content">
      <h1>Officials register</h1>
      <div class="acts"><button>Export this list</button><button>Saved views</button></div>
      <form id="contact"><label for="nm">Name</label><input id="nm" name="name"><input type="password" name="pw" aria-label="Password"></form>
      <ul><li><button>Edit</button></li><li><button>Edit</button></li><li><button>Edit</button></li></ul>
      <div id=":r5:"><span data-testid="badge">Expiring</span></div>
      <div id="ember1234"><p>Generated id</p></div>
      <div data-rw><button>Widget</button></div>
    </main>`),
  );

  it("matches exactly the element, from a stable ancestor", () => {
    for (const el of Array.from(document.querySelectorAll("main *")).filter((e) => !e.closest("[data-rw]"))) {
      const sel = buildSelector(el);
      const hits = document.querySelectorAll(sel);
      expect(hits.length, sel).toBe(1);
      expect(hits[0], sel).toBe(el);
    }
  });

  it("prefers ids, test ids and field names, and never a generated id", () => {
    expect(buildSelector(document.querySelector("h1")!)).toBe("#content > h1");
    expect(buildSelector(document.querySelector("#nm")!)).toBe("#nm");
    expect(buildSelector(document.querySelector("[name=pw]")!)).toBe('input[name="pw"]');
    expect(buildSelector(document.querySelector("[data-testid]")!)).toBe('span[data-testid="badge"]');
    const gen = buildSelector(document.querySelector("#ember1234 p")!);
    expect(gen).not.toContain("ember1234");
    expect(looksGenerated(":r5:")).toBe(true);
    expect(looksGenerated("ember1234")).toBe(true);
    expect(looksGenerated("contact")).toBe(false);
  });

  it("tells repeated identical buttons apart by position", () => {
    const second = document.querySelectorAll("ul button")[1]!;
    const sel = buildSelector(second);
    expect(sel).toMatch(/li:nth-of-type\(2\)/);
    expect(document.querySelector(sel)).toBe(second);
  });
});

describe("labels", () => {
  beforeEach(() =>
    page(`
    <h1>Officials register</h1>
    <button>Export this list</button>
    <a href="/x">Ngaio Rewiti-Ashcombe</a>
    <label for="q">Search</label><input id="q" value="secret search">
    <input type="password" value="hunter2" aria-label="Password">
    <input type="submit" value="Save">
    <table><tr><td>Ngaio Rewiti-Ashcombe</td><td><span class="tag" role="status">Expiring</span></td></tr></table>
    <p data-annotatie-mask>Account 12345678</p>
    <img src="/a.png" alt="Club logo">
    <p>${"x".repeat(80)}</p>`),
  );

  it("names the part by role and accessible name, in RW-1's words", () => {
    expect(readableLabel(document.querySelector("h1")!)).toBe("heading “Officials register”");
    expect(readableLabel(document.querySelector("button")!)).toBe("button “Export this list”");
    expect(readableLabel(document.querySelector("a")!)).toBe("link “Ngaio Rewiti-Ashcombe”");
    expect(readableLabel(document.querySelector("img")!)).toBe("image “Club logo”");
    expect(readableLabel(document.querySelector("[type=submit]")!)).toBe("button “Save”");
    expect(roleWord(document.querySelector("[type=password]")!)).toBe("password field");
  });

  it("never uses a field's value, nor text inside a masked element", () => {
    expect(readableLabel(document.querySelector("#q")!)).toBe("field “Search”");
    expect(readableLabel(document.querySelector("[type=password]")!)).toBe("password field “Password”");
    expect(readableLabel(document.querySelector("[data-annotatie-mask]")!)).toBe("text");
    expect(accessibleName(document.querySelector("[data-annotatie-mask]")!)).toBe("");
  });

  it("adds the row it sits in, and shortens long names", () => {
    expect(readableLabel(document.querySelector(".tag")!)).toBe("status “Expiring” in the row “Ngaio Rewiti-Ashcombe”");
    const long = readableLabel(document.querySelectorAll("p")[1]!);
    expect(long).toBe(`text “${"x".repeat(60)} …”`);
  });
});

describe("anchors and re-finding", () => {
  it("records the selector, the label and the press point", () => {
    page(`<main id="m"><button>Export this list</button></main>`);
    const el = document.querySelector("button")!;
    const a = buildAnchor(el);
    expect(a.selector).toBe("#m > button");
    expect(a.label).toBe("button “Export this list”");
    expect(a.point).toEqual({ x: 0, y: 0 });
  });

  it("re-finds by selector, then by label when the structure moved, else null (whole page)", () => {
    page(`<main id="m"><div><button>Export this list</button></div><button>Saved views</button></main>`);
    const anchor = buildAnchor(document.querySelector("div button")!);
    expect(findAnchor(anchor)).toBe(document.querySelector("div button"));

    // A re-render wraps the toolbar differently: the selector no longer matches, the label does.
    page(`<main id="m"><section><span><button>Export this list</button></span></section><button>Saved views</button></main>`);
    expect(findAnchor(anchor)).toBe(document.querySelector("section button"));

    // The part has gone.
    page(`<main id="m"><button>Saved views</button></main>`);
    expect(findAnchor(anchor)).toBeNull();
    expect(findAnchor(undefined)).toBeNull();
    expect(findAnchor({ selector: "<<bad", label: "button “Saved views”" })).toBe(document.querySelector("button"));
  });

  it("never finds or picks the widget's own nodes", () => {
    page(`<div data-rw><button>Export this list</button></div><p>Text</p>`);
    expect(findAnchor({ selector: "button", label: "button “Export this list”" })).toBeNull();
    expect(pickPart(document.querySelector("[data-rw] button"))).toBeNull();
    expect(pickPart(document.querySelector("p"))).toBe(document.querySelector("p"));
    expect(pickPart(document.body)).toBeNull();
  });
});
