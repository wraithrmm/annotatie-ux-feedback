> **Concept design, not approved for implementation (D-500).** Designed in this folder only (R-323). Not a
> Race Officials page: no S-id, no catalogue row, no block card. Its id is **RW-1**.

# RW-1 · Report widget

- **Id:** RW-1 (concept id; no S-id, nothing reserved in `30-system/surfaces.md`).
- **Block:** none (concept, D-500). Behaviour: `../design.md` (R-319, R-320 → D-499).
- **Stack:** A (the Race Officials app, `race-fficials`), staging only (D-499 (2)).
- **Actors:** a signed-in person holding the "Report widget" feature permission: **add** (report, reply,
  resolve, reopen) or **read** only (see pins and threads). Replies from the workspace appear under the
  product owner's own account (D-499 (3)); there is no other author kind and no AI marker anywhere.
- **Frame:** S-101 (the staff shell). The widget is an overlay on every page of every frame; it is drawn
  over S-101 hosting the officials register (S-306's list, abridged). On S-105 and S-107 pages the same
  rules place it (bottom-end at 1024 px and up; in the 56 px app bar below 1024 px; on S-107, which has
  no app bar, the floating button is used at every width, see open reading OR-3).
- **Traces:** design.md §1 (the button, report mode, Bug / Feature / Question, the snapshot), §2 (nothing
  rendered without the permission), §3 (capture layer, hover outline, keyboard, phone bottom sheet, never
  covering a primary action or bulk bar), §4 (pins by selector, readable anchor, else page-level), §5
  (snapshot refused above 2 MB with a page-level note; passwords blanked), §6 (Open, Answered, In
  progress, Resolved; Show resolved pins; My reports; the page's list; everyone permitted sees and
  answers everything).
- **Purpose:** let a tester say "this, here, is wrong" about any part of any page without leaving it, and
  read the answer in place.
- **Replaces:** nothing.
- **Viewports:** 390 (designed first), 820, 1280; verified at 320.
- **Phone form:** the Report control sits in the 56 px app bar, before Help (never floating, so it can
  cover no bottom bar, primary action or navigation, M-11). Report mode adds a bar between the app bar
  and the page that pushes the page down. The comment panel is a bottom sheet (MOB-r1 §3.11) that grows
  to full height when the on-screen keyboard opens; the chosen part is scrolled into view above it.
  Threads and the Reports panel are full-height sheets (§3.13). Lists in the panel are `<ul>` list rows
  at every width (four-way case 4). **No table** in the widget at any width. Pins are drawn 28 px with a
  44 px hit area on a phone (M-5).
- **Approved:** 2026-11-03 by Richard (R-328) as the concept design. Still not approved for implementation (D-500); implementation goes to its own repository.
- **Made from (approved patterns, by id):** S-101 (shell, app bar, banner, page-header anatomy, Help
  flyout geometry), S-306 (list rows, result line, table at 640 px and up, segmented control of real
  radios, sheet header and footer), S-415 (sheet with real controls and a full-width footer), palette
  §4.2 (labels, error summary, the 4 px error bar), §4.3 (status tags), §4.4 (callouts, empty, loading,
  error panel), §4.6 (tab counts as neutral pills), §4.7 (flyout); MOB-r1 §3.1, §3.11, §3.13, §3.15.
- **New components (none in the catalogue):** the Report control (`report-button`), the report-mode bar
  (`report-mode-bar`), the part outline with its name label (`report-outline`), the pin
  (`report-pin`), the anchored comment popover / bottom sheet (`report-compose`), the thread panel
  (`report-thread`) and the Reports panel (`report-list`). Each is built from the nearest approved
  pattern named above.
- **Prototype:** `prototype/RW-1.html` (self-contained; fonts from the Google URL only).

## Layout

### Phone, 390 (drawn first)

1. **App bar** (S-101): menu · "Race Officials" · **Report control** · Help. The control is a 44 px ghost
   button: chat icon + neutral count pill; the word "Report" is visible from 640 px. Accessible name
   "Report, 4 reports on this page not yet resolved"; `aria-pressed` true while report mode is on, when
   it takes the accent fill.
2. **Report-mode bar** (only in report mode): selection ground (`--color-selection`), 2 px
   `--color-selection-bar` bottom edge, cursor icon, the sentence, then three 44 px outline buttons in one
   row: "Whole page" (named "Comment on the whole page"), "Reports" + count pill, "Done". 126 px tall at
   320 and 390.
3. **The page**, unchanged, with **pins** on the parts reported on.
4. **Comment sheet**: bottom sheet, radius 16 top corners, max height = screen − 56 px; header "New
   report", "About: {part}", Close 44 px; full-width "Send report" (primary) then "Cancel" (outline),
   both 44 px. With the keyboard open: full height, square corners, the "About" line keeps the part.
5. **Thread / Reports**: full-height sheets with visible Close, focus to the heading, page inert.

### Tablet, 820

As the phone for the control (in the app bar, now with the word "Report") and the mode bar (one row of
text and the three sm buttons; the keyboard line shows). Comment panel: the anchored popover (below).
Thread and Reports: the 25rem flyout from the end edge.

### Desktop, 1280

- **Report control:** floating at the frame's bottom-end corner, 24 px in, 44 px tall pill: chat icon +
  "Report" + count pill, `--shadow-lg`. It lifts by the height of any sticky bottom bar or toast stack
  the page shows (`data-bottom-bar` elements and the toast region), so it never covers a bulk bar or a
  toast. The page reserves 96 px at its end and `scroll-padding-bottom: 96px`, so nothing is stuck
  under it and no focused control settles beneath it.
- **Mode bar:** across the top of the main column, above the page (pushes it down, covers nothing):
  sentence, keyboard line, then "Comment on the whole page", "Reports" + pill, "Done" (all outline sm).
- **Comment popover:** 24rem, radius 12, `--shadow-lg`, anchored 12 px below the part (above it when
  there is no room), aligned to the part's start, kept 16 px inside the frame. Modal: page inert, no
  scrim colour change beyond the backdrop token, the outlined part stays visible.
- **Thread / Reports:** S-101's Help flyout geometry: 25rem, full height, end edge, backdrop.

### The outline (report mode)

| Cue | Drawn | When |
|---|---|---|
| Hover | 2 px solid `--color-selection-bar`, 7 % tint, radius 4, dark label above naming the part | pointer over a part |
| Keyboard | the same plus a 2 px white gap and 2 px `--focus-ring` (the focus ring's geometry) | Tab or arrow keys |
| Selected | 3 px solid `--color-selection-bar` + label | comment panel open; "Show on the page" |

The label is `--color-zinc-900` ground, white 13/18 500 text, e.g. `button “Export this list”`, wrapping
(never `nowrap`), flipped below the part when it would leave the page's top. The outline is never colour
alone: the label names the part in words (rule 21).

### Pins

28 px pill, white ground, 2 px edge in the status tone, status icon (16) + report number, 600 13/18
tabular. Placed at the part's top-end corner, covering at most 10 px of it (padding, never text); where
the page edge would push it back over the part it sits wholly above it. Two pins never overlap: a pin
that would land on another moves 40 px towards the inline start. Accessible name "Report 41, Answered,
Bug, about button “Export this list”". Resolved pins (only with Show resolved pins ticked) have a dashed
success edge. Pins re-place after Livewire morphs, navigation and resize (design.md §4). A pin is a
widget node: report mode never captures it, so pressing a pin always opens its thread.

### Status tone map (reports)

| Status | Tag | Pin edge | Sentence in the thread |
|---|---|---|---|
| Open | neutral, `minus-circle`, "Open" | zinc-500 | "Open: not yet answered." |
| Answered | info, chat bubble, "Answered" | info border | "Answered: a reply is waiting for you." / "… waiting for {reporter}." |
| In progress | neutral, `clock`, "In progress" | zinc-500 | "In progress: a fix is being made." |
| Resolved | success, open `check`, "Resolved" | success border, dashed | "Resolved by {name} on {date} at {time} UTC. Its pin shows only when Show resolved pins is ticked." |

## States (every one drawn in the prototype's state switch; copy as shown)

| # | State | Trigger | What shows (copy verbatim) | Announced (`role="status"` unless stated) |
|---|---|---|---|---|
| 1 | **Idle** | page load, permission held | Report control with pill "4"; pins 38, 41, 44 | — |
| 2 | **Idle, no reports** | page with none | Report control, no pill | — |
| 3 | **Report mode on** | press Report | Mode bar: "Report mode: select any part of the page to report on it. Nothing on the page works until you leave." / phone "Report mode: tap any part of the page to report on it."; keyboard line "Tab or the arrow keys move the outline, Enter chooses, Esc leaves report mode."; buttons "Comment on the whole page" (phone "Whole page"), "Reports" + pill, "Done". Control `aria-pressed="true"` | "Report mode is on. Select any part of the page to report on it." |
| 4 | **Hover** | pointer over a part (mode on) | outline + label `button “Export this list”` | — |
| 5 | **Keyboard highlight** | Tab, or an arrow key (mode on) | keyboard outline + label; the part takes focus (`tabindex="-1"` if it has none) | "Outlined: heading “Officials register”. Press Enter to report on it." |
| 6 | **Part selected** | click / tap / Enter on a part | selected outline; comment panel: h2 "New report"; "About: button “Export this list”"; legend "Type", radios "Bug" (chosen) "Feature" "Question"; label "Comment", hint "Say what you expected and what you saw."; note "A copy of this page as you see it is sent with your report, with password fields left blank."; "Send report" (primary), "Cancel" | "New report about button “Export this list”." Focus to the heading |
| 7 | **Whole page** | "Comment on the whole page" | as 6 with "About: the whole page"; no outline; popover at the frame's end | "New report about the whole page." |
| 8 | **Comment missing** | Send report with an empty comment | error summary "There is a problem" → link "Enter your comment" (`role="group"`, takes focus); field 4 px bar; message "Enter your comment"; page title prefixed "Error: " | "There is a problem: enter your comment." |
| 9 | **Comment too long** (422) | server refuses | summary and message "Your comment is 5,213 characters. Shorten it to 5,000 or fewer." (text kept) | as 8 with the sentence |
| 10 | **Sending** | Send report | button "Sending…" with spinner, still enabled; panel `aria-busy`; a second press sends nothing more | "Sending your report." / second press: "Your report is still sending." |
| 11 | **Sent** | 201 | success callout "Report 46 sent" / "It is pinned on this page as 46. Replies appear in its thread and under My reports."; "Close" (primary), "Open the thread"; the new pin appears; report mode stays on | "Report 46 sent." |
| 12 | **Sent without the copy** | snapshot over 2 MB (decided in the browser) | warning callout "Report 46 sent, without a copy of the page" / "The page was larger than 2 MB, so the copy was left out. Your comment, the address, the screen size and the part you chose were sent. If the copy would have shown something, describe it in a reply." | "Report 46 sent." |
| 13 | **Not sent: server error** (500) | server | danger callout (`role="alert"`) "Your report was not sent" / "Something went wrong on the server. Your comment is still here. Press Send report to try again. If it fails again, send reference RPT-7K2Q to the system team." | alert text |
| 14 | **Not sent again** | second 500 | "Your report was still not sent" / "Something went wrong on the server again. Your comment is still here. Send reference RPT-7K3A to the system team, and try again later." | alert text |
| 15 | **Not sent: no connection** | network error | "Your report was not sent" / "There is no connection. Your comment is still here. Press Send report when you are back online." (no reference: the service was never reached) | alert text |
| 16 | **Not sent: sign-in ended** (401/419) | session expired | "Your report was not sent" / "Your sign-in has ended. Your comment is still here. Sign in again in a new tab, then come back to this tab and press Send report." + link "Sign in again (opens a new tab)" | alert text |
| 17 | **Pins on load** | page load | Open 38, Answered 41, In progress 44; 45 (part gone) has no pin and is listed as on the whole page; 29 (Resolved) hidden | — |
| 18 | **Show resolved pins** | tick in the Reports panel | dashed resolved pin 29 on the heading | "Resolved pins are shown." / "… hidden." |
| 19 | **Thread** | press a pin, a list row, or "Open the thread" | h2 "Report 41"; "Bug · Officials register · sent by Ellis Varnholt"; status tag; status sentence; "About: button “Export this list”." + "Show on the page"; "A copy of the page was sent with the report." / "Sent without a copy of the page: it was larger than 2 MB."; h3 "Messages": avatar, name, "2 Nov 2026 at 11:40 UTC", body; label "Your reply"; "Send reply" (primary); "Mark as resolved" or "Reopen" | focus to the heading |
| 20 | **Thread, part gone** | — | "About: button “Saved views”, which is no longer on this page. The report is kept as a report on the whole page." | — |
| 21 | **Thread, another page** (from My reports) | — | "About: list “What needs the office” on Today. Go to Today" | — |
| 22 | **Reply missing** | Send reply empty | summary "There is a problem" → "Enter your reply"; 4 px bar; "Enter your reply" | "There is a problem: enter your reply." |
| 23 | **Reply sent** | 201 | success callout "Reply sent" (+ "Report 41 is open again until it is answered." when the reporter answers an Answered report) | "Reply sent." / "Reply sent. Report 41 is open again." |
| 24 | **Reply not sent** (500) | server | danger callout "Your reply was not sent" / "Something went wrong on the server. Your reply is still here. Press Send reply to try again. If it fails again, send reference RPT-3M8D to the system team." | alert text |
| 24a | **Reply too long** (422) | server refuses | summary and message "Your reply is 5,213 characters. Shorten it to 5,000 or fewer." (reply kept) | "There is a problem: …" |
| 24b | **Status change not saved** (500) | Mark as resolved / Reopen fails | danger callout "The change was not saved" / "Something went wrong on the server. Nothing has changed. Try again. If it fails again, send reference RPT-4R2B to the system team." | alert text |
| 24c | **Already resolved** (409) | someone resolved it first | info callout "Report 38 was already resolved by Lavanya Kodandaram" / "Nothing more was changed. Reopen it if it is not done."; the thread shows Resolved | callout text |
| 25 | **Resolved now** | Mark as resolved | tag Resolved; event line "Ellis Varnholt marked this report resolved on 2 Nov 2026 at 14:26 UTC."; callout "Report 41 is resolved" / "Its pin is hidden. Tick Show resolved pins to see it."; button becomes "Reopen" | "Report 41 is resolved. Its pin is hidden." |
| 26 | **Reopened** | Reopen | tag Open; event line "… reopened this report on …"; callout "Report 29 is open again" / "Its pin is back on the page." | "Report 29 is open again." |
| 27 | **Reports: this page** | "Reports" in the mode bar | h2 "Reports"; tabs "This page" + pill, "My reports" + pill; tick "Show resolved pins"; result line "5 reports on Officials register: 4 not yet resolved, 1 resolved (its pin is hidden). As at 2 Nov 2026, 14:20 UTC."; rows: "Report 45" + tag / first message (up to three lines) / "Bug · on the whole page (button “Saved views” is no longer here) · Ellis Varnholt · 1 Nov 2026"; unresolved first, newest first | — |
| 28 | **Only resolved reports** | — | result line "1 report on Officials register: 0 not yet resolved, 1 resolved (its pin is hidden). …" + "Every report on this page is resolved. Their pins show when Show resolved pins is ticked." | — |
| 29 | **No reports on this page** | — | empty: "No reports on this page yet" / "Choose any part of the page while report mode is on, or comment on the whole page." + "Comment on the whole page" | — |
| 30 | **Loading** | opening the panel | "Loading the reports" + three skeleton rows at the row's height, `aria-busy` | "Loading the reports" |
| 31 | **Could not be loaded** | 500 on list-by-route | error panel (`role="alert"`, it arrives after an action) "The reports could not be loaded" / "Nothing has changed. Try again. If it fails again, send reference RPT-5C1D to the system team." + "Try again" | alert text |
| 32 | **Try again failed again** | second 500 | "Error: the reports still could not be loaded" / "Nothing has changed. Send reference RPT-5C1E to the system team, and try again later." + "Try again" | alert text |
| 33 | **My reports** | tab | result line "5 reports you sent, on 3 pages. As at 2 Nov 2026, 14:20 UTC."; rows with the page name first on line 3 ("Today · Bug · on list “What needs the office” · 31 Oct 2026"); a row opens that page at the pin with the thread open | — |
| 34 | **My reports, none** | — | empty: "You have not sent any reports yet" / "Reports you send from any page are listed here, with their replies. Choose any part of a page while report mode is on to send one." | — |
| 35 | **Read permission only** | permission read without add | the control reads "Reports" (no `aria-pressed`) and opens the Reports panel; no report mode; threads end with "You can read reports, but not send or answer them."; no reply box, Resolve or Reopen; list empty state "Reports people send from this page appear here, with their replies." with no button | — |
| 36 | **Without the permission** | no permission, or `REPORT_WIDGET_ENABLED` off | **nothing is rendered**: no control, pin, script, stylesheet, Livewire name, comment or data attribute (design.md §2); the page is the plain S-101 page | — |
| 37 | **Longest values** | — | a 200-character unbroken comment and part name wrap in the thread, list row and label at 320 (`overflow-wrap: anywhere`) | — |

**Focus:** opening any panel moves focus to its heading; Close, Cancel or Esc returns it to the trigger
(the pin, the "Reports" button, or the part itself, given `tabindex="-1"` if it had none). Esc closes the
open panel first, then the navigation drawer, then leaves report mode. Panels are `role="dialog"
aria-modal="true" aria-labelledby`, the page and app bar inert behind them. Only the error summary moves
focus on its own.

**Capture layer (behaviour from design.md §3, drawn):** while report mode is on and no panel is open,
click, auxclick, submit, pointer and mouse down/up, dragstart, and Enter/Space on the page are stopped
before any handler; a press chooses the part. The widget's own nodes (`data-rw`) are never captured.
Scrolling still works.

**Server outcomes the page cannot reach from its own controls:** states 9 (422), 12 (snapshot over 2 MB,
measured in the browser), 13–14 (500), 15 (no connection), 16 (401/419), 24 (500), 24a (422), 24b (500),
24c (409), 31–32 (500 on list-by-route; the prototype's Try again fails once, then succeeds). Each is in
the prototype's state switch.

## States table (`states-to-draw.md`)

| # | State | Designed |
|---|---|---|
| ST-1 | Failure in transit | Every write: Send report (13–16), Send reply (24), Mark as resolved / Reopen (24b). Comment and reply always kept; a reference only when the service was reached. A sign-in that ends during a reply or status change shows state 16's sentence with "reply" / "change" |
| ST-2 | Refused by the server | 9 (comment over 5,000 characters), 24a (reply), 24c (409, decided first) |
| ST-3 | Unset configuration | `REPORT_WIDGET_ENABLED` off = state 36. No other configured value is shown |
| ST-4 | Acting for someone | Report mode on an on-behalf session: the widget reports as the signed-in member of staff (the reporter is always the person signed in); the behalf banner is part of the page and can itself be reported on. Copy uses "you" for the viewer and the name for anyone else (states 19, 33); never a gendered pronoun |
| ST-5 | Each permission set | add (all states), read only (35), none (36). A 403 is never shown: without the permission the routes answer 404 and nothing renders (design.md §2) |
| ST-6 | Repeat | Second press of Send report while sending (10); Mark as resolved on a report someone else resolved first (24c); Reopen on one already reopened: "Report {n} was already reopened by {name}" / "Nothing more was changed." |
| ST-7 | Empty | 2, 28, 29, 34; filtered to nothing n/a (the list has no filter; the tick governs pins only) |
| ST-8 | Loading; retry fails again | 30, 31, 32; compose retry failing again 14 |
| ST-9 | Null, one, many | "1 report" / "5 reports"; "on 1 page" / "on 3 pages"; "its pin is hidden" / "their pins are hidden"; no pill at 0; a reporter with no name n/a (every reporter is a signed-in account) |
| ST-10 | Longest value | 37 |
| ST-11 | Send to many | n/a: the widget sends nothing to many and no mail (no email in scope) |
| ST-12 | Announcements | the last column of the states table above |

## Checklist A (adapted to a concept; spec references are palette-spec.md)

**Record**
- [x] Entry with every line — written here, not in `screens.md`, by the brief (concept, D-500)
- [x] Design basis: designed from patterns, review owed (D-389), patterns named by id; prototype made first. Catalogue row: n/a, concept (brief §3)
- [ ] S-nnn in `surfaces.md` — n/a: concept id RW-1, no S-id by the brief
- [x] Stack A, frame S-101
- [x] Open readings raised as named readings below, not baked in
- [x] Synthetic cast only (Ellis Varnholt, Eero Halmelahti, Lavanya Kodandaram; officials NZLX901 …); the replier is the product owner's account by D-499 (3) and the brief (§7) — see OR-1
- [x] Real numbers and vocabulary: the register's 757 positions / 743 people; D-499's statuses
- [ ] The product owner named nowhere a reviewer could see — **deliberately not met**: the brief and D-499 (3) require replies to show as the product owner; see OR-1

**States**
- [x] ST-1…ST-12 table above; every string belongs to a state
- [x] Only what a real user would see, in every state; assumptions in the closed review notes panel

**Prototype**
- [x] Review bar: RW-1 · name · traces · 390/820/1280 · state switch · `Approved: — (awaiting approval)`; both switches keyboard-operable
- [x] Every state switchable; live triggers for 1–8, 10, 11, 17–19, 22, 23, 25–27, 33; server outcomes named above
- [x] `data-flux` / `data-variant` / `data-size` on Flux elements; `data-component` on ours
- [x] Review notes panel: one closed `<details>`, 14 items
- [x] Provenance strip (design.md sections in place of spec lines)
- [x] Fonts Inter + Jost from the Google URL

**Palette**
- [x] Tokens only (the outline tint is `color-mix` of `--color-selection-bar`)
- [x] One primary per view: Send report; Close on the sent panel; Send reply. The mode bar has none
- [x] No disabled buttons; Send report stays enabled while sending
- [x] Validate on submit; summary with focus; "Error: " title prefix
- [x] Dates: n/a — no date is entered
- [x] Labels above, no colon; no optional field (the type is pre-chosen, the comment required)
- [x] Status = tag with icon + word (tone map above); success is the open `check`; neutral text zinc-800
- [x] Danger roles by token in the callouts and the 4 px bar
- [x] 4 px error bar on the comment and reply fields
- [x] Coloured segments: n/a
- [x] Selection survives hover: the selected outline is drawn instead of the hover outline, never under it
- [x] Callout for results and failures; no toast at all (the result is on the panel)
- [x] Live regions as rule 9; summaries present at load `role="group"`; post-action failures `role="alert"`
- [x] Staging banner first (the only banner the tool can meet besides behalf, which follows it)
- [x] Tables: the host's only; the widget has none
- [x] Counts are reports, never people or positions; as-at stamp on both lists
- [x] Dates "2 Nov 2026 at 11:40 UTC"
- [x] Sentence case
- [x] Whole sentences; wraps at 320 and +200 %
- [x] Targets ≥ 24; 44 px on a phone (pins by hit area); icon-only buttons named ("Close", "Report, 4 …")
- [x] Focus ring 2 px / 2 px; the page reserves 96 px under the floating control
- [x] Contrast pairs from §3: label white on zinc-900; aqua bar 4.04 on white; pin edges ≥ 3:1
- [x] Non-colour cues: outline + label; pin icon + number + name; tab underline + weight
- [x] Read only: n/a (no read-only field); read permission is absence, not greying
- [x] Confirmations: none needed (resolve is reversible by Reopen)
- [x] Empty, loading, error per §4.4
- [x] Navigation is S-101's, unchanged
- [x] Identity slot text only
- [x] Counts: neutral pills, never magenta (rule 26: everyone's reports, not the person's own queue); nothing at 0; nothing on `bars-3`
- [x] Tab counts: neutral pill after the label with hidden ", "
- [x] Tab overflow: n/a (two tabs fit at 320)
- [x] Responsive 390 / 820 / 1280; no sideways scroll at 320 (measured)
- [x] Phone layout first
- [x] MOB-r1: rows below 640 px; one control bar; sheets full height with Close; one bottom sheet, never a sheet from a sheet; 16 px inputs; nothing `position: fixed` in the phone layout
- [x] Mail: n/a — no email in scope
- [x] No `flux:publish`; overrides: ours (C) for the seven new components

## Checklist B (accessibility)

1. [x] Keyboard: every action; Tab and arrows move the outline, Enter chooses, Esc leaves; tabs use arrows, Home, End
2. [x] Focus visible, ordered, never under the floating control (96 px reservation)
3. [x] Names: "Report, 4 reports on this page not yet resolved"; pins "Report 41, Answered, Bug, about …"; "Close"
4. [x] Headings: one h2 per panel, h3 "Messages"; panels are dialogs named by their heading
5. [x] Announcements as the states table
6. [x] Contrast from the palette's measured pairs (the outline label is zinc-900/white, 17.69)
7. [x] Not colour alone: outline labelled; status icon + word; resolved pins dashed
8. [x] Targets ≥ 24; phone 44
9. [x] Errors identified, same words in summary and inline; text kept
10. [x] No toast; spinner static under reduced motion
11. [x] Reflow at 320 measured: no sideways scroll in the frame, the mode bar, the panels or the sheet
12. [ ] Colour vision: `cvd_check.py` not run (concept; owed if the design is approved for implementation)
13. [x] `lang="en"`

## Open readings (named; no P-nn reserved)

- **OR-1 — the replier is the product owner by name.** Rule S says the product owner is never named
  where a reviewer could see; D-499 (3) and this brief make every reply appear under the product
  owner's account. The tool runs on staging only, for the team's own testers. Recommendation: keep it as
  D-499 (3) says, and record that the widget is the one recorded exception to rule S.
- **OR-2 — report numbers.** The tables in design.md §7 hold no number. Recommendation: a sequential
  `number` column on `ro_report_widget_reports`, shown as "Report 41" on pins, rows and threads.
- **OR-3 — S-107 pages have no app bar.** Recommendation: on the public frame the floating control is
  used at every width, bottom-end, lifted above anything pinned to the bottom; S-107 has no bottom bar
  today.
- **OR-4 — length limit.** Recommendation: 5,000 characters for a comment and a reply.

## Amendment A1 — the capture (6 Nov 2026, review owed)

Behaviour: `../capture-design.md` §2–§4. Prototype: `prototype/RW-1a-capture.html` (the approved
`RW-1-approved-2026-11-03.html` is unchanged). New component: the capture block (`report-capture`), built from
the list row's thumbnail and the callout, and its viewer (`report-capture-viewer`), built from the thread panel
with a tab list. **Changes to approved states:** state 6's note is replaced by the capture block; state 12's
copy changes (A1-11); state 19's "A copy of the page was sent…" line is replaced by A1-12. **C1/C3 (6 Nov 2026):**
the capture is always sent and cannot be covered, so the former A1-5 (left out), A1-6 (required by the site) and
A1-15 (thread without a capture) are withdrawn; the numbers are not reused.

| # | State | Trigger | What shows (copy verbatim) | Announced |
|---|---|---|---|---|
| A1-1 | **Taking the screenshot** | part chosen | block h3 "Sent with your report"; skeleton thumbnail; "Taking a screenshot…" / "You can write your comment meanwhile." (`aria-busy`) | — |
| A1-2 | **Ready** | capture done | close-up thumbnail (a button, "See the screenshot full size"); "A screenshot and a copy of this page, 340 KB"; "Password fields and the fields this site marks as private are left blank." (or "Password fields are left blank." when the site marks none); note "A screenshot and a copy of this page are sent with every report."; link "See what will be sent" (no leave-out choice, C1) | — |
| A1-3 | **Real capture offered** | ready, desktop Chrome/Edge, privacy mode off | as A1-2 + "Something missing from the picture, such as a video or a map? Use a real screen capture instead" (link) | — |
| A1-4 | **Real capture asked** | the link | info callout "Your browser will ask what to share" / "Choose “This tab”. Only one picture is taken, then sharing stops." | callout text |
| A1-7 | **Screenshot failed** | drawing failed or timed out | "No picture" box; "A copy of this page, 180 KB" / "The screenshot could not be taken, so only the page copy goes. Password fields are left blank." | — |
| A1-8 | **Viewer: Screenshot** | thumbnail or "See what will be sent" | dialog h2 "What will be sent"; "Officials register · 2 Nov 2026 at 12:04 UTC"; tabs "Screenshot" "Page copy"; the screenshot with the part outlined; note "Screenshot · 390 × 844 at 3× · drawn by the browser: videos, maps and pictures from other sites may be missing." Full screen on a phone | focus to the heading |
| A1-9 | **Viewer: Page copy** | tab | the page copy in a sandboxed frame (no scripts), part outlined; note "Copy of the page’s HTML · 180 KB · links and buttons in it do nothing. Password fields and private fields are left blank." | — |
| A1-10 | **Sent without a screenshot** | not ready 3 s after Send | warning callout "Report 46 sent, without a screenshot" / "The screenshot was not ready in time, so it was left out. The page copy, your comment, the address, the screen size and the part you chose were sent." | "Report 46 sent." |
| A1-11 | **Sent without the page HTML** (replaces 12) | page copy over 2 MB | warning callout "Report 46 sent, without a copy of the page’s HTML" / "The page was larger than 2 MB, so its HTML was left out. The screenshot, your comment, the address, the screen size and the part you chose were sent." | "Report 46 sent." |
| A1-12 | **Thread: sent with this report** | thread opened | block h3 "Sent with this report"; close-up thumbnail; "A screenshot and a copy of the page, taken when the report was sent"; link "View" | — |
| A1-13 | **Thread: viewer, Screenshot** | "View" | as A1-8 with h2 "Sent with Report 41", read-only | focus to the heading |
| A1-14 | **Thread: viewer, Page copy** | tab | as A1-9 | — |

**Tabs:** `role="tablist"`, arrow keys move between tabs, Esc closes the viewer and returns focus to the thumbnail
or link that opened it. **Phone:** the block sits under the comment in the bottom sheet; the viewer is full screen;
the page copy is scaled to the width, never scrolled sideways (MOB-r1 §3.13).
