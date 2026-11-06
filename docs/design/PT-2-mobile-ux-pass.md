# PT-2 · Portal UX pass, phone first (6 Nov 2026)

> **Design revision of the approved PT-1, review owed.** You approved every feature on 6 Nov 2026 and
> asked for a UX pass that makes reviewing from a phone smooth. This keeps every PT-1 feature and changes
> how they are laid out and operated. **No feature is added** except the two in §6, M1 and M2, both approved
> on 6 Nov 2026. Prototype: `prototype/PT-2-portal.html`. PT-1 stays frozen as
> `prototype/PT-1-approved-2026-11-06.html`.

## 1. Who is on the phone, and what they need

A reviewer on a phone is usually away from a desk, with a minute to spare and one thumb. The jobs, in order:

1. **Notice** that something is waiting.
2. **Decide on a draft**: read what the user said, see what they saw, read the agent's reply, then approve,
   tweak or reject it.
3. **Answer a decision** an agent raised.
4. **Glance** at a report and leave a short note.

Settings, keys, members and tokens are desk work. They stay reachable on a phone but are never in the way.
The test for every screen: **can a draft be approved, edited or rejected with one thumb, without zooming,
scrolling sideways or losing your place?**

## 2. What the audit found in PT-1 at 390 px

| # | Finding | Where | Severity |
|---|---|---|---|
| F1 | "Page when reported" comes **after every message and the reply box**, so the reviewer reads the agent's answer before seeing what the user saw | Thread | High |
| F2 | The draft's Approve / Edit / Reject **scroll away** in a long thread; nothing on screen says a draft is waiting | Thread | High |
| F3 | **Edit is inline** (`contenteditable`) in the page: the keyboard covers the buttons, and there is no clear way to save or cancel | Thread, Attention | High |
| F4 | Attention's four tabs **scroll sideways** at 390 px (MOB-r1: no sideways scrolling) | Attention | Medium |
| F5 | Edit on an Attention card **navigates away** to the thread, so the reviewer loses their place in the queue | Attention | Medium |
| F6 | Approve is **one tap with no way back**; on a phone a stray tap sends a reply to a user | Attention, Thread | High |
| F7 | Reject is a **centred dialog** with a text field; the keyboard covers it, and typing a reason on a phone is slow | Attention, Thread | Medium |
| F8 | **Two navigations at once**: the hamburger drawer and bottom tabs. The tabs include Settings (rare on a phone) and a Reports tab that doesn't say which site | Shell | Medium |
| F9 | The thread header (long title, tag, meta, a native Status select) takes **a third of the screen** before any message | Thread | Medium |
| F10 | The four capture tabs **squeeze into a 360 px column**; the page copy and the Part tab are hard to use there | Thread | Medium |
| F11 | The reports list **hides the close-up on phones**, which is exactly where it saves a tap | Reports | Low |
| F12 | **Sign-in shows password and code fields**, but Q6 settled on passkeys only | Sign in | Medium |
| F13 | Buttons are 40 px and the segmented control 36 px; **targets under 44 px** | Everywhere | Medium |
| F14 | The bottom tabs ignore the **iPhone home-indicator area** (safe-area insets) | Shell | Low |
| F15 | **Nothing tells a phone that something is waiting**: no email in v1 (plan 2.7) and no notifications | Whole portal | High (see §6) |
| F16 | **No freshness or failure states**: no "updated at", no retry when an approval fails on a weak signal | Attention, Thread | Medium |

## 3. The shell on a phone

- **Bottom bar, four places:**
  - **Attention**, with a count;
  - **Reports**, every site with a site filter;
  - **Decisions**, with a count;
  - **More**: sites, settings, agents and tokens, notifications, sign out.

  The hamburger drawer goes (F8). The bar respects `env(safe-area-inset-bottom)` (F14), and its labels sit
  under icons, 56 px tall.
- **Top bar:** the screen's title, plus a "Refresh" button and "Updated 12:15" (F16). Pushed screens (a
  report, a decision) swap the bottom bar for a **back arrow** in the top bar and their own sticky action bar.
- **The auto-approve banner** stays on every screen while it is on for any site, as one line under the top
  bar: "Auto-approve is on for Race Officials", with "Turn off".
- **Wide screens (≥ 1024 px)** keep PT-1's side navigation and the thread's side panel. 600–1023 px uses the
  phone shell with wider cards.

## 4. Screen by screen

### 4.1 Sign in (F12)

The passkey button only, full width, plus "Lost your passkey? Use a recovery code" (plan 2.10). No password
or code fields.

### 4.2 Attention: the queue (F4, F5, F6, F7)

- **Filter chips that wrap** replace the tabs: All · To approve 3 · Decisions 1 · New from users 1 ·
  Unanswered 0. Real radios, so one is always chosen. The default is All, newest first, and drafts first
  within it.
- **Each draft card**, top to bottom:
  - the site and report number, and the age;
  - the title;
  - **the close-up** (56 × 40) beside the user's message, clamped to 3 lines with "More";
  - "Agent's reply, to send as Sam Okafor", with the draft **always shown in full**: you approve only what
    you have read, so it is never cut short;
  - the actions: **Approve and send** full width, then **Edit** and **Reject** side by side. All three are 48 px.
- **Approve → a 10-second undo.** The card collapses to a row, "Sent to Ada Example · Undo", with a
  countdown bar. The server holds the message for those 10 seconds (§6, M2), so closing the app doesn't
  lose the undo.
- **Edit opens a full-screen editor sheet** over the queue (F5):
  - the user's message stays quoted at the top;
  - the draft is in a text area that grows with its content;
  - a sticky footer above the keyboard holds **Approve and send** and **Cancel**.

  Closing it returns to the same card.
- **Reject opens a bottom sheet** (F7):
  - reason chips the agent can read: "Wrong facts", "Wrong tone", "Don't promise a date", "Needs a person";
  - an optional note;
  - **Reject draft**.

  At least one chip or a note is required.
- **Failure:** if an approval fails, the card shows "Not sent: no connection. Your edit is kept." with
  **Try again**. Nothing is lost.

### 4.3 A report (thread) on a phone (F1, F2, F3, F9, F10)

The reading order is the order of the decision:

1. **Compact sticky header:**
   - back arrow;
   - "Report 41";
   - a **status chip** that opens a status sheet with six radios and Save. This replaces the native select (F9).
2. **Summary:** the title, then "Bug · /register · Ada Example · 12 min ago".
3. **The capture card (F1):**
   - the close-up full width (tap to open);
   - "Page when reported";
   - **Screenshot · Page copy · Part · Details** as four buttons that each open the **full-screen viewer** at that tab (F10).

   The viewer has its own tabs, pinch-zoom on the screenshot, the page copy at the reporter's width and
   scaled, and Close top-left.
4. **Messages,** oldest first. The pending draft carries a dashed border and the label "Draft · the user
   can't see it yet".
5. **A sticky action bar** while a draft is pending (F2): "Draft waiting", with **Approve and send**, **Edit**
   and **Reject**. It is the same behaviour as the queue, with undo, the editor sheet and the reject sheet.
   With no draft pending, the bar is a single **"Write a note or reply"** button.
6. **The composer is a full-screen sheet** (F3):
   - a segmented "Internal note" / "Reply to the user" (44 px). The note is chosen by default.
   - the text;
   - a sticky **Post** above the keyboard;
   - a one-line warning when "Reply to the user" is chosen: "Ada Example will see this, signed as you."

On ≥ 1024 px the thread keeps PT-1's two columns, but the capture panel moves **above** the side column's
fold, and the action bar becomes sticky at the bottom of the message column.

### 4.4 Reports (F11)

- **Site filter** as a select at the top ("All sites" first), and status chips that wrap.
- **Rows** show the close-up as a 56 × 40 leading image, with the number moved into the meta line:
  "41 · Bug · /register · Ada · 12 min". A page-level report shows a "Whole page" tile.

### 4.5 Decisions

Each decision is a card that opens as a pushed screen, with the question, the options as 48 px radio rows
(the recommended one tagged), each option's consequence, and an optional note. A **sticky "Record answer"**
footer stays above the keyboard. Answering returns to the list with "Answer recorded: A".

### 4.6 More, settings, agents

- **More:** a list of the sites (each with its counts) and the desk work: Settings, Agents and tokens,
  Notifications on this phone (§6, M1), Sign out.
- **Settings and agents keep PT-1's content.** Rows stack on a phone. **Turning on auto-approve** keeps
  PT-1's confirmation, as a bottom sheet with the destructive button last and full width.

### 4.7 Agent consent

This is usually opened on a desktop (Claude Code's browser hand-off), but it works on a phone. The checkboxes
become 48 px rows, and **Allow** and **Deny** sit in a sticky footer.

## 5. Rules applied everywhere

- **Touch targets** of at least 44 px, and 48 px for the primary actions (F13). There is at least 8 px
  between destructive and primary buttons.
- **The keyboard never covers the action.** Every sheet's footer is sticky inside the sheet and the sheet
  uses `100dvh`. Focus moves to the sheet's heading, then to its field.
- **Nothing scrolls sideways at 320 px.** Code blocks wrap, chips wrap, and the page copy is scaled.
- **One primary action per screen or sheet.** Destructive actions are never primary and never on swipe:
  there is no swipe-to-approve and no swipe-to-reject.
- **State survives:** an edit in progress is kept if the sheet is closed by accident (a "Discard your edit?"
  confirmation) and if the network drops.
- **Desktop shortcuts** with the same actions: `j`/`k` next and previous, `a` approve, `e` edit, `r`
  reject, `?` lists them. They are shown, never required.
- **Dark mode** follows the system, as PT-1 does.

## 6. Two behaviour changes (both approved 6 Nov 2026)

| # | Change | Why | Cost | Answer |
|---|---|---|---|---|
| **M1** | **Notifications on your phone**: the portal becomes an installable web app (a manifest and a service worker), and you can turn on push notifications per device for "a draft is waiting" and "a decision is waiting", with a quiet-hours setting. iOS shows web push only once the portal is added to the home screen (iOS 16.4+), and the More screen says so | It fixes F15. Without it a phone reviewer only finds drafts by opening the portal, because v1 has no email (plan 2.7) | **No fixed cost.** Web Push is free from the browsers' push services. Sending is the existing API Lambda. Subscriptions are a few DynamoDB rows. The VAPID key pair is in SSM like the other secrets | **Approved 6 Nov 2026**, in P3 with the portal |
| **M2** | **A 10-second undo on Approve and send**: the message is published with a `releaseAt` 10 seconds ahead; the widget API doesn't return it until then; Undo within the window turns it back into a draft | It fixes F6. A stray tap on a phone shouldn't reach a user. Undo is faster than an "Are you sure?" on every approval | None: one timestamp on the message and a filter in the widget read | **Approved 6 Nov 2026**; auto-approved replies skip the delay |

## 7. What changes in the plan

- PT-2 replaces PT-1 as the portal design for P3 once you approve it.
- M1 adds `apps/portal` (manifest, service worker), an API route for push subscriptions and a
  `push.send()` call where drafts and decisions are created. It goes in P3.
- M2 adds `releaseAt` to the message (P2) and Undo to the portal (P3).
- The test plan adds Playwright runs at 390 × 844 for the approve, edit, reject and undo flows. They check
  that the action bar stays visible with the keyboard open, and that nothing scrolls sideways at 320 px.
