// RW-1 and RW-1a's widget styles, inside the closed shadow root. The prototype's container queries on
// its frame become media queries on the real viewport: phone below 640 px, tablet below 1024 px.
// Every value is a theme token (theme.ts).

export const STYLES = String.raw`
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.rw { color: var(--ann-text); font-family: var(--ann-font-sans); font-size: 14px; line-height: 20px; -webkit-font-smoothing: antialiased; text-align: start; }
:where(.rw) :where(p, ul, ol, dl, dd, figure, fieldset, h1, h2, h3) { margin: 0; }
:where(.rw) :where(fieldset) { border: 0; padding: 0; min-width: 0; }
/* Zero specificity, so .btn--primary and every other component rule wins over the reset. */
:where(.rw) :where(button, input, select, textarea) { font: inherit; color: inherit; letter-spacing: inherit; }
.rw a { color: var(--ann-link); text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
.rw a:hover { text-decoration-thickness: 2px; }
.sr-only { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.rw :focus-visible { outline: 2px solid var(--ann-focus-ring); outline-offset: 2px; }
.rw :focus:not(:focus-visible) { outline: none; }
.i { display: inline-block; flex: none; vertical-align: middle; fill: currentColor; width: 16px; height: 16px; }
.i-20 { width: 20px; height: 20px; }
.i-o { fill: none; stroke: currentColor; stroke-width: 1.5; width: 20px; height: 20px; }

/* Buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 9px 16px; border: 1px solid transparent; border-radius: var(--ann-radius-lg); font-size: 14px; line-height: 20px; font-weight: 500; text-align: center; text-decoration: none; cursor: pointer; background: transparent; color: var(--ann-text); max-width: 100%; }
.btn--primary { background: var(--ann-accent); color: var(--ann-accent-fg); border-color: var(--ann-btn-primary-border); box-shadow: inset 0 1px 0 var(--ann-btn-primary-highlight); }
.btn--primary:hover { background: var(--ann-accent-hover); }
.btn--outline { background: var(--ann-surface); border-color: var(--ann-border-control); box-shadow: var(--ann-shadow-xs); }
.btn--outline:hover { background: var(--ann-surface-hover); }
.btn--ghost:hover { background: var(--ann-ghost-hover); }
.btn--sm { min-height: 32px; padding: 5px 12px; border-radius: var(--ann-radius-md); }
.btn--icon { flex: none; padding: 0; width: 40px; }
.linkbtn { display: inline-flex; align-items: center; min-height: 24px; padding: 0; border: 0; background: none; color: var(--ann-link); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; font-weight: 500; text-align: start; }

/* Tags, callouts, empty, error */
.tag { display: inline-flex; align-items: center; gap: 4px; min-height: 24px; padding: 3px 12px; border-radius: var(--ann-radius-full); font-size: 13px; line-height: 18px; font-weight: 500; vertical-align: middle; background: var(--ann-tag-neutral-bg); color: var(--ann-tag-neutral-text); white-space: nowrap; }
.tag > .i { margin-inline-start: -4px; }
.tag--sm { min-height: 20px; padding-block: 1px; }
.tag--success { background: var(--ann-success-tint); color: var(--ann-success-text); }
.tag--info { background: var(--ann-info-tint); color: var(--ann-info-text); }
.callout { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 12px; padding: 12px 16px; border: 1px solid; border-radius: var(--ann-radius-xl); }
.callout > .i { grid-row: span 4; }
.callout .c-h { font-weight: 600; }
.callout p { overflow-wrap: anywhere; }
.callout a { color: inherit; }
.callout--success { background: var(--ann-success-bg); border-color: var(--ann-success-subtle); color: var(--ann-success-text); }
.callout--success > .i { color: var(--ann-success-icon); }
.callout--warning { background: var(--ann-warning-bg); border-color: var(--ann-warning-subtle); color: var(--ann-warning-text); }
.callout--warning > .i { color: var(--ann-warning-icon); }
.callout--danger { background: var(--ann-danger-bg); border-color: var(--ann-danger-subtle); color: var(--ann-danger-text); }
.callout--danger > .i { color: var(--ann-danger-icon); }
.callout--info { background: var(--ann-info-bg); border-color: var(--ann-info-subtle); color: var(--ann-info-text); }
.callout--info > .i { color: var(--ann-info-icon); }
.empty, .err-panel { display: grid; justify-items: start; gap: 12px; padding: 24px 20px; border: 1px solid var(--ann-border-divider); border-radius: var(--ann-radius-xl); }
.empty .h, .err-panel .h { font-size: 16px; line-height: 24px; font-weight: 600; }
.err-panel .h { display: flex; gap: 8px; align-items: center; }
.err-panel .h .i { color: var(--ann-danger-icon); }
.skel { display: block; height: 12px; border-radius: var(--ann-radius-full); background: var(--ann-skeleton); }
.resline { font-size: 13px; line-height: 18px; color: var(--ann-text-muted-strong); font-variant-numeric: tabular-nums; }
.cpill { display: inline-grid; place-items: center; min-width: 20px; min-height: 20px; padding-inline: 6px; border-radius: var(--ann-radius-full); background: var(--ann-tag-neutral-bg); color: var(--ann-tag-neutral-text); font-size: 13px; line-height: 18px; font-weight: 500; font-variant-numeric: tabular-nums; }

/* The Report control: floating at the bottom-end corner, lifted above any sticky bottom bar */
.rw-fab { position: fixed; inset-inline-end: 24px; bottom: calc(24px + var(--rw-lift, 0px)); z-index: 3; min-height: 44px; padding: 10px 14px 10px 12px; border-radius: var(--ann-radius-full); background: var(--ann-surface); border: 1px solid var(--ann-border-control); box-shadow: var(--ann-shadow-lg); font-weight: 600; pointer-events: auto; }
.rw-fab:hover { background: var(--ann-surface-hover); }
.rw-fab[aria-pressed="true"] { background: var(--ann-accent); color: var(--ann-accent-fg); border-color: var(--ann-accent); }
.rw-fab[aria-pressed="true"] .cpill { background: var(--ann-surface); color: var(--ann-text); }

/* The report-mode bar, across the top of the viewport */
.rw-modebar { position: fixed; top: 0; inset-inline: 0; z-index: 4; pointer-events: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px 24px; background: var(--ann-selection); border-bottom: 2px solid var(--ann-selection-bar); box-shadow: var(--ann-shadow-lg); }
.rw-modebar .mb-text { flex: 1 1 26rem; min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 12px; }
.rw-modebar .mb-text .i { grid-row: span 2; color: var(--ann-selection-bar); }
.rw-modebar .mb-h { font-weight: 600; }
.rw-modebar .mb-k { font-size: 13px; line-height: 18px; color: var(--ann-text-muted-strong); }
.rw-modebar .mb-acts { display: flex; flex-wrap: wrap; gap: 8px; }

/* The outline: hover, keyboard, selected; always with a label naming the part */
.rw-boxes, .rw-pins { position: fixed; inset: 0; pointer-events: none; z-index: 1; overflow: hidden; }
.rw-pins { z-index: 2; }
.rw-box { position: absolute; border: 2px solid var(--ann-selection-bar); border-radius: var(--ann-radius-sm); background: color-mix(in srgb, var(--ann-selection-bar) 7%, transparent); }
.rw-box.is-key { box-shadow: 0 0 0 2px var(--ann-surface), 0 0 0 4px var(--ann-focus-ring); }
.rw-box.is-sel { border-width: 3px; }
.rw-box .rw-lbl { position: absolute; bottom: calc(100% + 4px); inset-inline-start: -3px; max-width: min(36ch, 80vw); width: max-content; padding: 2px 8px; border-radius: var(--ann-radius-sm); background: var(--ann-label-bg); color: var(--ann-on-solid); font-size: 13px; line-height: 18px; font-weight: 500; overflow-wrap: anywhere; }
.rw-box.lbl-below .rw-lbl { bottom: auto; top: calc(100% + 4px); }

/* Pins */
.rw-pin { pointer-events: auto; position: absolute; display: inline-flex; align-items: center; gap: 4px; min-height: 28px; min-width: 28px; padding: 2px 8px 2px 6px; border-radius: var(--ann-radius-full); background: var(--ann-surface); border: 2px solid var(--ann-tag-neutral-border); color: var(--ann-text); font-size: 13px; line-height: 18px; font-weight: 600; font-variant-numeric: tabular-nums; box-shadow: var(--ann-shadow-xs); cursor: pointer; font-family: var(--ann-font-sans); }
.rw-pin:hover { background: var(--ann-surface-hover); }
.rw-pin.st-answered { border-color: var(--ann-info-border); color: var(--ann-info-text); }
.rw-pin.st-answered .i { color: var(--ann-info-icon); }
.rw-pin.st-resolved, .rw-pin.st-closed { border-style: dashed; border-color: var(--ann-success-border); color: var(--ann-success-text); }
.rw-pin.st-resolved .i, .rw-pin.st-closed .i { color: var(--ann-success-icon); }
.rw-pin.is-shown { box-shadow: 0 0 0 3px var(--ann-selection-bar); }
.rw-pin::before { content: ""; position: absolute; inset: -2px; }

/* Scrim and modal surfaces */
.rw-scrim { position: fixed; inset: 0; background: var(--ann-backdrop); z-index: 5; pointer-events: auto; }
.rw-pop { position: fixed; z-index: 6; pointer-events: auto; width: min(24rem, calc(100vw - 32px)); max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: var(--ann-surface); border: 1px solid var(--ann-border-divider); border-radius: var(--ann-radius-xl); box-shadow: var(--ann-shadow-lg); }
.pop-hd { display: flex; align-items: flex-start; gap: 12px; padding: 16px 8px 12px 16px; border-bottom: 1px solid var(--ann-border-divider); }
.pop-hd .ht { flex: 1 1 auto; min-width: 0; display: grid; gap: 2px; }
.rw h2 { font-family: var(--ann-font-heading); font-size: 20px; line-height: 26px; font-weight: 500; overflow-wrap: anywhere; }
.rw h2:focus { outline: none; }
.about, .sub { font-size: 13px; line-height: 18px; color: var(--ann-text-muted-strong); overflow-wrap: anywhere; }
.pop-bd { padding: 16px; overflow-y: auto; display: grid; gap: 16px; align-content: start; }
.pop-ft { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--ann-border-divider); }
.note { font-size: 13px; line-height: 18px; color: var(--ann-text-muted-strong); }

/* Forms */
.fld { display: grid; gap: 4px; }
.lab { display: block; font-weight: 500; }
.hint { font-size: 13px; line-height: 18px; color: var(--ann-text-muted-strong); }
.ta { width: 100%; min-height: 112px; padding: 8px 12px; border: 1px solid var(--ann-border-control); border-radius: var(--ann-radius-md); background: var(--ann-surface); box-shadow: var(--ann-shadow-xs); resize: vertical; font-size: 14px; line-height: 20px; }
.fld.is-invalid { border-inline-start: 4px solid var(--ann-danger-border); padding-inline-start: 12px; }
.fld.is-invalid .ta { border-color: var(--ann-danger-border); }
.err-msg { display: flex; gap: 4px; align-items: flex-start; color: var(--ann-danger-text); font-weight: 500; }
.errsum { border: 2px solid var(--ann-danger-border); border-radius: var(--ann-radius-xl); padding: 12px 16px; display: grid; gap: 8px; }
.errsum:focus { outline: 2px solid var(--ann-focus-ring); outline-offset: 2px; }
.errsum h3 { font-size: 16px; line-height: 24px; font-weight: 600; color: var(--ann-danger-text); }
.errsum ul { padding-inline-start: 18px; }
.errsum a { color: var(--ann-danger-text); font-weight: 500; }
.legend { padding: 0 0 4px; font-weight: 500; }
.segc { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px; background: var(--ann-surface-hover); border-radius: var(--ann-radius-md); }
.segc label { position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 5px 12px; border-radius: var(--ann-radius-sm); color: var(--ann-text-data); cursor: pointer; }
.segc input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.segc label:has(input:checked) { background: var(--ann-surface); color: var(--ann-text); font-weight: 600; box-shadow: 0 0 0 1px var(--ann-border-control), var(--ann-shadow-xs); }
.segc label:has(input:focus-visible) { outline: 2px solid var(--ann-focus-ring); outline-offset: 2px; }
.spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid currentColor; border-inline-end-color: transparent; animation: rw-spin .8s linear infinite; flex: none; }
@keyframes rw-spin { to { transform: rotate(360deg); } }

/* The capture block (RW-1a) */
.cap { border: 1px solid var(--ann-border-divider); border-radius: var(--ann-radius-lg); padding: 12px; display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 4px 12px; align-items: start; }
.cap h3 { font-size: 14px; line-height: 20px; font-weight: 600; grid-column: 1 / -1; }
.cap .thumb { grid-row: span 5; width: 112px; height: 72px; border: 1px solid var(--ann-border-chrome); border-radius: var(--ann-radius-md); overflow: hidden; background: var(--ann-surface); padding: 0; cursor: zoom-in; display: grid; place-items: center; color: var(--ann-text-muted); font-size: 12px; }
.cap .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cap .thumb.skel-t { background: linear-gradient(90deg, var(--ann-skeleton), var(--ann-surface), var(--ann-skeleton)); background-size: 200% 100%; animation: rw-sh 1.2s infinite linear; cursor: default; }
.cap .thumb.none { cursor: default; }
@keyframes rw-sh { to { background-position: -200% 0; } }
.cap .cap-t { overflow-wrap: anywhere; }
.cap .cap-m { color: var(--ann-text-muted-strong); font-size: 13px; line-height: 18px; }

/* Flyouts: thread and Reports */
.rw-fly { position: fixed; top: 0; bottom: 0; inset-inline-end: 0; z-index: 6; pointer-events: auto; width: 25rem; max-width: 100vw; background: var(--ann-surface); border-inline-start: 1px solid var(--ann-border-chrome); box-shadow: var(--ann-shadow-lg); display: flex; flex-direction: column; min-height: 0; }
.fly-hd { display: flex; align-items: flex-start; gap: 12px; padding: 16px 12px 12px 20px; border-bottom: 1px solid var(--ann-border-divider); }
.fly-hd .ht { flex: 1 1 auto; min-width: 0; display: grid; gap: 4px; justify-items: start; }
.fly-hd .btn--icon { width: 44px; min-height: 44px; }
.fly-bd { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 20px 24px; display: grid; gap: 16px; align-content: start; }
.fly-bd h3 { font-size: 16px; line-height: 24px; font-weight: 600; }
.tabs { display: flex; gap: 4px; padding-inline: 16px; border-bottom: 1px solid var(--ann-border-divider); flex: none; }
.tab { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 8px 12px; border: 0; background: none; color: var(--ann-text-data); font-weight: 500; cursor: pointer; white-space: nowrap; border-radius: var(--ann-radius-md) var(--ann-radius-md) 0 0; }
.tab:hover { background: var(--ann-surface-hover); }
.tab[aria-selected="true"] { color: var(--ann-text); font-weight: 600; box-shadow: inset 0 -3px 0 var(--ann-accent); }
.tick { display: flex; align-items: center; gap: 12px; min-height: 44px; cursor: pointer; }
.tick input { width: 20px; height: 20px; margin: 0; accent-color: var(--ann-accent); flex: none; }
.rw-rows { list-style: none; margin: 0 -20px; padding: 0; border-top: 1px solid var(--ann-border-divider); }
.rw-rows > li { border-bottom: 1px solid var(--ann-border-divider); }
.rw-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; width: 100%; min-height: 72px; padding: 12px 20px; border: 0; background: none; text-align: start; cursor: pointer; color: inherit; }
.rw-row:hover { background: var(--ann-surface-hover); }
.rw-row:focus-visible { outline-offset: -4px; }
.rw-row .nm { font-weight: 600; color: var(--ann-link); text-decoration: underline; text-underline-offset: 2px; }
.rw-row .stat { justify-self: end; }
.rw-row .ex { grid-column: 1 / -1; color: var(--ann-text-data); overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.rw-row .meta { grid-column: 1 / -1; font-size: 13px; line-height: 18px; color: var(--ann-text-muted-strong); overflow-wrap: anywhere; }
.rw-skel { display: grid; gap: 8px; min-height: 72px; align-content: center; padding: 12px 20px; }
.msgs { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
.msg { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 12px; }
.avatar { width: 32px; height: 32px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ann-surface-hover); color: var(--ann-text); font-size: 13px; font-weight: 600; flex: none; grid-row: span 2; }
.msg .by { display: flex; flex-wrap: wrap; gap: 0 8px; align-items: baseline; }
.msg .by b { font-weight: 600; }
.msg .by span { font-size: 13px; line-height: 18px; color: var(--ann-text-muted-strong); }
.msg .body { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ann-text-data); }
.facts { display: grid; gap: 8px; }
.facts p { overflow-wrap: anywhere; }
.acts { display: flex; flex-wrap: wrap; gap: 8px; }
.divider { border: 0; border-top: 1px solid var(--ann-border-divider); margin: 0; }

/* The capture viewer (RW-1a) */
.rw-vscrim { position: fixed; inset: 0; z-index: 8; pointer-events: auto; background: var(--ann-viewer-backdrop); display: grid; place-items: center; padding: 24px; }
.viewer { width: min(64rem, 100%); max-height: 100%; background: var(--ann-surface); border-radius: var(--ann-radius-xl); box-shadow: var(--ann-shadow-lg); display: flex; flex-direction: column; overflow: hidden; }
.viewer .tabs button { min-height: 44px; }
.vbody { padding: 16px; overflow: auto; flex: 1; min-height: 0; background: var(--ann-surface-sunken); }
.vbody img { max-width: 100%; height: auto; display: block; margin: 0 auto; border: 1px solid var(--ann-border-chrome); background: #fff; }
.copyframe { display: block; width: 100%; height: 480px; border: 1px solid var(--ann-border-chrome); background: #fff; }
.vnote { padding: 10px 16px; font-size: 13px; line-height: 18px; color: var(--ann-text-muted-strong); border-top: 1px solid var(--ann-border-divider); }

/* Tablet and phone */
@media (max-width: 1023px) {
  .rw-fab { inset-inline-end: 16px; bottom: calc(16px + var(--rw-lift, 0px)); }
}
@media (max-width: 639px) {
  .rw-fab .rw-word { display: none; }
  .rw-modebar { padding: 12px 16px; gap: 8px; }
  .rw-modebar .mb-text { flex-basis: 100%; }
  .rw-modebar .mb-k { display: none; }
  .rw-modebar .mb-acts { width: 100%; }
  .rw-modebar .mb-acts .btn { flex: 1 1 0; min-width: 0; min-height: 44px; padding-inline: 8px; white-space: normal; }
  .rw-pin { min-width: 44px; justify-content: center; }
  .rw-pin::before { inset: -10px 0; }
  .rw-pop { inset-inline: 0; bottom: 0; top: auto; width: auto; max-height: calc(100vh - 56px); max-height: calc(100dvh - 56px); border-radius: var(--ann-radius-sheet) var(--ann-radius-sheet) 0 0; border-inline: 0; border-bottom: 0; }
  .rw-pop.is-tall { top: 0; max-height: none; border-radius: 0; border-top: 0; }
  .rw-pop .pop-hd .btn--icon { width: 44px; min-height: 44px; }
  .rw-pop .pop-ft .btn { flex: 1 1 100%; min-height: 44px; }
  .rw-pop .ta, .fly-bd .ta { font-size: 16px; line-height: 22px; }
  .rw-pop .segc { display: flex; }
  .rw-pop .segc label { flex: 1 1 0; min-height: 44px; }
  .rw-fly { width: 100%; border-inline-start: 0; }
  .fly-bd { padding: 16px 16px 32px; }
  .rw-rows { margin-inline: -16px; }
  .rw-row { min-height: 95px; padding-inline: 16px; }
  .rw-skel { min-height: 95px; padding-inline: 16px; }
  .fly-bd .acts .btn, .fly-bd .btn { min-height: 44px; }
  .fly-bd .acts .btn { flex: 1 1 100%; }
  .tabs .tab { flex: 1 1 0; justify-content: center; }
  .rw-vscrim { padding: 0; }
  .viewer { height: 100%; border-radius: 0; }
  .copyframe { height: 70vh; }
}
@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; border-inline-end-color: currentColor; border-style: dotted; }
  .cap .thumb.skel-t { animation: none; }
}
`;
