// Notices when a single-page app changes its URL (popstate, hashchange, and pushState / replaceState,
// wrapped so the host's own calls behave exactly as before), and when the page's DOM settles after a
// change, so pins can be placed again.

export interface Watcher {
  stop(): void;
}

/** Calls `onChange(url)` after every change of location.href. */
export function watchUrl(win: Window, onChange: (url: string) => void): Watcher {
  let last = win.location.href;
  const check = () => {
    const now = win.location.href;
    if (now !== last) {
      last = now;
      onChange(now);
    }
  };
  const h = win.history;
  const origPush = h.pushState;
  const origReplace = h.replaceState;
  // Wrapped on the instance (not the prototype); the host's arguments, `this` and result pass through.
  const wrap = (orig: History["pushState"]) =>
    function (this: History, ...args: Parameters<History["pushState"]>) {
      const r = orig.apply(this, args);
      queueMicrotask(check);
      return r;
    };
  const pushW = wrap(origPush);
  const replaceW = wrap(origReplace);
  h.pushState = pushW;
  h.replaceState = replaceW;
  win.addEventListener("popstate", check);
  win.addEventListener("hashchange", check);
  return {
    stop() {
      // Only unwrap if nobody wrapped on top of us since.
      if (h.pushState === pushW) h.pushState = origPush;
      if (h.replaceState === replaceW) h.replaceState = origReplace;
      win.removeEventListener("popstate", check);
      win.removeEventListener("hashchange", check);
    },
  };
}

/** Calls `fn` (debounced) when the host's DOM changes, ignoring the widget's own nodes. */
export function watchDom(doc: Document, fn: () => void, waitMs = 250): Watcher {
  let t: ReturnType<typeof setTimeout> | null = null;
  const mo = new MutationObserver((records) => {
    if (records.every((r) => r.target instanceof Element && r.target.closest("[data-rw]"))) return;
    if (t) clearTimeout(t);
    t = setTimeout(fn, waitMs);
  });
  mo.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] });
  return {
    stop() {
      mo.disconnect();
      if (t) clearTimeout(t);
    },
  };
}
