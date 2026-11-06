# Page capture: the screenshot, the page copy and the chosen part (concept, 6 Nov 2026)

> **Proposal, review owed.** This adds to `platform-design.md` revision 2 (§6 Snapshot, §8 `get_snapshot`, §9.2)
> and to RW-1 §5 ("The snapshot"), and replaces them where they differ. It is drawn in
> `design/prototype/RW-1a-capture.html` (the widget: what the reporter sees) and in `PT-1-portal.html`
> (the thread's "Page when reported" panel: what the reviewer sees). **C1–C5 answered 6 Nov 2026 (§11):
> the capture is always sent, the real screen capture is offered on desktop, there is no covering tool.**

## 1. What is captured with every report

Revision 2 kept one thing: a copy of the page's HTML. A report now carries a **capture** of four parts,
all taken at the same moment:

| Part | What it is | Who uses it most |
|---|---|---|
| **Screenshot** | The visible part of the page (the viewport) as the reporter saw it, WebP, at most 2× pixel density and 2,560 px on its long edge | Reviewers, agents and the reporter: "what did it look like" |
| **Close-up** | A crop of the screenshot around the chosen part, 48 px of margin on each side, with the part outlined, WebP | Agents (one small image that answers "which thing"), the thread's thumbnail |
| **Page copy** | The page's HTML: the settled DOM with styles inlined, scripts and handlers removed, form values and open/closed state frozen, masking applied (§8), the chosen part marked `data-annotatie-target` | Reviewers and agents: "what was in the page", text, attributes, hidden rows, the markup of the part |
| **Part record** | JSON: the selector chain and readable anchor (RW-1 §4), the part's box in page and screenshot coordinates, its role and accessible name, its text (first 500 characters), its `outerHTML` (first 8 KB), its ancestors' tags and classes, a short list of computed styles (display, visibility, colour, background, font size, overflow, z-index, position) | Agents first: the facts without reading a 2 MB page |

The **context** goes with them: URL, route name, page title, viewport, device pixel ratio, scroll position,
browser and OS, the host app's build id, the time, which method made the screenshot (§3), what was masked
(counts only), and the size of each part. The screenshot, close-up and page copy are files in S3; the part
record and the context are a few KB and live on the item in DynamoDB, so `get_item` returns them without
touching S3.

**A "whole page" report** has no chosen part: no close-up, no part record, no target mark.

## 2. When it is taken

**At the moment the reporter chooses the part (or presses "Comment on the whole page"), before the comment
panel opens.** That is the page "as it is when reported". Taking it at Send would picture the comment
panel and whatever the page did while they typed.

- The widget's own nodes (`data-rw`) are left out, so neither the mode bar, the outline nor any pin is in it.
- The work runs in the background while the reporter types. The panel shows "Taking a screenshot…" and
  then the preview (§4).
- If it isn't ready when Send is pressed, Send waits **up to 3 more seconds**, then sends without the
  screenshot. That's state "Sent without a screenshot", and the page copy and part record still go.
- If the page changes between choosing and sending (a Livewire poll, say), the capture is not retaken:
  the copy shows what the reporter chose from.

## 3. How the screenshot is made

| Method | How | Good | Bad | Verdict |
|---|---|---|---|---|
| **A. Drawn in the browser** | A small library (`modern-screenshot`, MIT) draws the DOM clone the page copy is made from onto a canvas through SVG `foreignObject` | No prompt; works on phones; masking (§8) is already in the clone, so the screenshot is masked too; no server work | Not pixel-perfect: video frames, cross-origin iframes and cross-origin images without CORS headers come out blank, and some CSS (backdrop filters, a few blend modes) differs | **Default** |
| **B. Real screen capture** | `getDisplayMedia({preferCurrentTab: true})`, one frame, then the stream is stopped | Pixel-perfect, including video and canvas | The browser asks permission every time; desktop Chrome and Edge only (not phones, not Safari's current-tab mode); cannot mask, so masked parts are painted over afterwards from their boxes | **Optional**, a "Use a real screen capture instead" link in the panel, desktop only, hidden when the site's privacy mode is on |
| C. Rendered on the server | Headless Chromium in a Lambda renders the stored page copy | Same result every time | Can't load anything behind the user's sign-in (images, fonts); adds a ~60 MB Lambda and seconds of cold start per report; renders the copy, not what the user saw | **Not used** |

The context records which method made each screenshot. The reviewer's panel shows "Drawn by the browser:
videos, maps and pictures from other sites may be missing" for method A, so nobody reads a blank video
frame as the bug.

**The library loads only when report mode starts** (a dynamic import), so the widget's first load is no
larger. It runs on the host page with the host's permissions; it fetches nothing new except images the
page already shows, which it reads from the browser cache.

## 4. What the reporter sees and controls (RW-1 amendment, drawn in RW-1a)

- **In the comment panel**, under the comment: "Sent with your report" and a thumbnail of the screenshot
  with the chosen part outlined. A caption gives the size, e.g. "Screenshot and a copy of this page, 340 KB".
  "See what will be sent" opens it full size, with two tabs:
  - **Screenshot**;
  - **Page copy**: the copy rendered in a sandboxed frame (§8), so the reporter sees exactly what reviewers
    will see.
- **The capture is always sent (C1, 6 Nov 2026).** There is no choice to leave it out and no site setting
  for it. The reporter sees what goes before they press Send, and the panel says so: "A screenshot and a copy
  of this page are sent with every report." What keeps private data out is the site's masking (below).
- **No covering tool (C3, 6 Nov 2026).** The reporter has already pointed at the part they mean, so drawing
  boxes over the screenshot adds nothing.
- **Masking is applied before the preview**, so the preview is what is sent: password fields blank, fields
  marked `data-annotatie-mask` blank, and with privacy mode on, every form field's text blank. The note
  under the thumbnail says which: "Password fields are left blank." / "Password fields and the fields this
  site marks as private are left blank."
- **In the thread afterwards**: "Sent with this report", the close-up thumbnail and "View" (the same
  two-tab viewer, read-only). Everyone who can see the thread sees it. That's every client user of the
  site (`platform-design.md` §2), the same rule as the messages.
- Replaces RW-1 state 12. The 2 MB limit now applies to the page copy alone, and the warning reads "Report
  46 sent, without a copy of the page's HTML". The screenshot and part record still go.

## 5. What the reviewer sees (PT-1, the report thread)

The thread's side panel becomes **"Page when reported"** with four tabs:

1. **Screenshot** (opens first): the screenshot at the panel's width with the part outlined and its pin
   number; "Hide the outline" to see what was under it; "Open full size" (a dialog that scrolls and
   zooms). Under it: "390 × 844 at 3× · Chrome 131 on Android · 2 Nov 2026 at 12:04 UTC · drawn by the
   browser".
2. **Page copy**: the copy in a sandboxed frame at the reporter's width, scaled to fit, scrolled to where
   they were, with the part outlined by the frame's own style (no script is needed). Under it:
   - "Open full size";
   - "Open the live page", which opens the URL in a new tab, to compare with today;
   - "Download HTML".
3. **Part**: the part record as a definition list: readable anchor, selector, role and name, box, text,
   the computed styles, and its HTML as a code block with "Copy". It shows "Whole page: no part was
   chosen" for page-level reports.
4. **Details**: the context: URL, route, title, build, viewport, scroll, browser, method, what was masked,
   sizes, and "Captured 2 Nov 2026 at 12:04:31 UTC".

On a phone (< 860 px) the panel moves below the messages as a disclosure, "Page when reported", closed by
default, with the close-up as its summary thumbnail. "Open full size" fills the screen. No tab scrolls
sideways: the HTML code block wraps, and the page copy is scaled to the width.

The **reports list** shows the close-up as a 48 px thumbnail on each row at 860 px and up, so you can see
which part each report is about at a glance.

## 6. What agents get (MCP, replaces `get_snapshot` in `platform-design.md` §8)

| Tool | Returns | Scope |
|---|---|---|
| `get_item` | As before, plus `capture`: the context, the part record, and which files exist with their sizes | read |
| `get_screenshot` | **An MCP image** (`type: "image"`, `image/webp`). `view: "closeup"` (default) or `"page"`; for `"page"`, `marked: true` (default) has the part outlined (the stored close-up shows how). Each image is scaled so its long edge is at most 1,568 px, the size Claude sees without downscaling. Returned with a one-line text part giving the method, viewport and the part's box | snapshot:read |
| `get_page_html` | The page copy, text. `scope: "part"` (default, the part's `outerHTML`, with its ancestors as an indented outline), `"around"` (the part's nearest section, landmark or table, up to 40 KB) or `"page"` (the whole copy, cut at 200 KB with a note saying where); optional `selector` to look anything else up in the copy (for example "the row below it") | snapshot:read |

- **`get_screenshot` with `view: "page"` and `marked: true` needs the outline drawn on the server.** The
  widget therefore uploads the screenshot twice, clean and marked (one extra WebP of about 150 KB). The
  Lambda then only reads files and does no image work, so it needs no native image library.
- **Everything from the page is untrusted.** Text from the page copy and the part record comes back inside
  the marked untrusted block (`platform-design.md` §8). The tool descriptions say that a page can contain
  words written to steer an agent, and that those words are data.
- **Agents can't change or delete a capture,** and nothing an agent posts carries a capture to the user.
  Replies stay text and go through the approval gate as now.
- **MCP resources** (optional): `annotatie://items/{id}/screenshot` and `…/page.html`, for clients that
  attach resources rather than call tools.

The workspace side of the Race Officials pilot (`design.md` §8, `ro-reports show`) uses the same files:
`show <id>` writes `closeup.webp`, `page.webp` and `page.html` into `~/.ro-private/reports/<id>/` and prints
the part record.

## 7. Storage and upload

- **S3 keys:** `sites/<siteId>/items/<itemId>/capture/{page.webp, page-marked.webp, closeup.webp, page.html.gz}`
  in the private snapshot bucket (SSE-S3, public access blocked, TLS only).
- **Upload straight from the browser** with **presigned POST** policies, not PUT: a POST policy can enforce
  `content-length-range` and the content type, and a presigned PUT can't. Creating a report returns the
  item, its number, and one POST policy per file, each valid for 10 minutes.
- **Confirm:** the widget calls `POST /items/{id}/capture` with each file's size and SHA-256. The API then:
  - checks each object with `HeadObject`;
  - re-sanitises the page copy on the server (scripts, `on*` attributes, `javascript:` and `data:text/html`
    URLs, `<base>`, `<meta http-equiv>`, `<iframe>`, `<object>`, `<embed>`), with a pure-JavaScript DOM
    (`linkedom`);
  - writes the capture record.

  A file that is missing or the wrong size is dropped and noted in the context.
- **Uploads that are never confirmed** land under `pending/` and an S3 lifecycle rule deletes them after 1
  day. This replaces the "orphan snapshot clean-up" job in the plan's `services/jobs`: one less scheduled job.
- **Limits:**
  - page copy 2 MB gzipped (as RW-1);
  - screenshot and marked screenshot 1.5 MB each;
  - close-up 300 KB.

  The widget lowers WebP quality, then pixel density, to fit, and leaves a file out only if it still can't.
- **Images in the page copy:** same-origin images of 50 KB or less are inlined as `data:` URLs. Larger or
  cross-origin images become an empty box of the same size, labelled with the image's `alt` text. The
  screenshot shows how the page really looked, and the copy never makes a reviewer's browser call the host
  site. Fonts are not inlined, so the copy falls back to system fonts.
- **Retention:** as revision 2 §9.3. A capture is deleted 90 days after its report is resolved, and when
  its report or site is deleted. A per-site setting can shorten it.

## 8. Security and privacy

| Risk | Answer |
|---|---|
| Personal data in a screenshot | Masking happens in the DOM clone before drawing, so method A's screenshot is masked exactly as the page copy is. Method B paints solid boxes over the masked parts' boxes before upload and is hidden when privacy mode is on. The reporter sees the preview before sending (§4). Because the capture is always sent (C1), a site that shows sensitive data must mark those fields `data-annotatie-mask` or turn privacy mode on; the SDK install guide says so |
| Stored XSS through the page copy | Rendered only in `<iframe sandbox srcdoc>` with **no** `allow-scripts` and **no** `allow-same-origin` (an opaque origin, `implementation-plan.md` 2.8), plus a CSP meta `default-src 'none'; img-src data:; style-src 'unsafe-inline'`; sanitised in the browser and again on the server (§7) |
| The copy calling out to the host or a tracker | Cross-origin images are not loaded (§7); the CSP blocks every other fetch; links in the copy are inert (sandbox without `allow-popups`, `allow-top-navigation`) |
| One site reading another's captures | S3 keys start with the site id taken from the verified token; presigned GETs (5 minutes) are issued only after the same visibility check as the thread |
| A reviewer's link leaking | GET links expire in 5 minutes and are never stored; "Download HTML" streams through the API with the session |
| Prompt injection through the page | §6: every page-derived string is returned as marked untrusted data |
| A huge or hostile upload | POST policy size range and content type; the confirm step checks size and hash; WebP is decoded by the browser only, never on our server |

## 9. Cost

**No fixed cost is added.**

- **Storage:** about 0.5 MB per report across the four files. 10,000 reports is about 5 GB, roughly
  $0.12 a month in S3.
- **Requests:** 4 uploads a report (about $0.00002) and a few GETs to view.
- **Lambda:** the confirm step's sanitising runs in the existing API Lambda, at about 100–300 ms on 256 MB
  per report.
- **Lifecycle rule:** free.
- **Widget download:** larger only when report mode starts, by the screenshot library (tens of KB gzipped).

`cost-register.md` §4 records it.

## 10. Where it lands in the phases

| Phase | Adds |
|---|---|
| P2 API | The capture entity and part record; presigned POST; confirm and re-sanitise; the `pending/` lifecycle rule; retention; the GET links |
| P3 Portal | The "Page when reported" panel with its four tabs, the full-size dialog, the list thumbnail, and the phone disclosure |
| P4 Widget | Capture at selection; method A and the optional B; masking; the marked copy and close-up; the preview and viewer; the thread's "Sent with this report" |
| P5 MCP | `get_screenshot`, `get_page_html`, `capture` on `get_item`, resources |

Tests:
- unit tests: sanitising, masking, the size fallback, POST policy limits, and the part record;
- end to end: a fixture page with a password field, a masked field, a cross-origin image and a video,
  where the test checks each masked value is absent from all four files and from what the MCP returns;
- MCP: an agent fetches the close-up and gets an image no larger than 1,568 px.

## 11. Questions (all answered 6 Nov 2026)

| # | Question | Answer |
|---|---|---|
| C1 | May a reporter leave the capture out? | **No.** Every report carries its capture; no checkbox and no site setting. Privacy is the site's masking (§8) |
| C2 | Offer the real screen capture (method B)? | **Yes**, desktop only, behind a link, hidden in privacy mode |
| C3 | Let the reporter cover part of the screenshot before sending (draw boxes)? | **No.** They have already clicked the part they mean; covering is overkill. Not planned |
| C4 | Screenshot of the visible part only, or the whole scrolled page? | **Visible part only**, as recommended: it is what they saw, and the page copy holds the rest |
| C5 | Should every client user of the site see each other's captures? | **Yes**, the same as the messages (`platform-design.md` §2) |
