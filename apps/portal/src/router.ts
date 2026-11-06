// Hash routes only: CloudFront serves just /board/index.html, so no screen may have a real path.

import { useEffect, useState } from "preact/hooks";

export type Route =
  | { name: "attention" }
  | { name: "reports"; siteId?: string }
  | { name: "item"; siteId: string; itemId: string }
  | { name: "decisions" }
  | { name: "more" }
  | { name: "settingsPicker" }
  | { name: "settings"; siteId: string }
  | { name: "log"; siteId: string }
  | { name: "newSite" }
  | { name: "agents" }
  | { name: "passkeys" }
  | { name: "notFound" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/^\/+/, "").replace(/[?].*$/, "");
  const p = path.split("/").filter(Boolean).map((x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  });
  if (p.length === 0 || (p[0] === "attention" && p.length === 1)) return { name: "attention" };
  if (p[0] === "reports" && p.length === 1) return { name: "reports" };
  if (p[0] === "decisions" && p.length === 1) return { name: "decisions" };
  if (p[0] === "more" && p.length === 1) return { name: "more" };
  if (p[0] === "settings" && p.length === 1) return { name: "settingsPicker" };
  if (p[0] === "agents" && p.length === 1) return { name: "agents" };
  if (p[0] === "passkeys" && p.length === 1) return { name: "passkeys" };
  if (p[0] === "sites" && p[1] === "new" && p.length === 2) return { name: "newSite" };
  if (p[0] === "sites" && p[1] && p.length === 3 && p[2] === "reports") return { name: "reports", siteId: p[1] };
  if (p[0] === "sites" && p[1] && p.length === 3 && p[2] === "settings") return { name: "settings", siteId: p[1] };
  if (p[0] === "sites" && p[1] && p.length === 3 && p[2] === "log") return { name: "log", siteId: p[1] };
  if (p[0] === "sites" && p[1] && p[2] === "items" && p[3] && p.length === 4) return { name: "item", siteId: p[1], itemId: p[3] };
  return { name: "notFound" };
}

const e = encodeURIComponent;
export const href = {
  attention: () => "#/attention",
  reports: (siteId?: string) => (siteId ? `#/sites/${e(siteId)}/reports` : "#/reports"),
  item: (siteId: string, itemId: string) => `#/sites/${e(siteId)}/items/${e(itemId)}`,
  decisions: () => "#/decisions",
  more: () => "#/more",
  settingsPicker: () => "#/settings",
  settings: (siteId: string) => `#/sites/${e(siteId)}/settings`,
  log: (siteId: string) => `#/sites/${e(siteId)}/log`,
  newSite: () => "#/sites/new",
  agents: () => "#/agents",
  passkeys: () => "#/passkeys",
};

/** Screens that replace the bottom bar with a back arrow (PT-2 §3), and where back goes. */
export function parentOf(r: Route): string | null {
  switch (r.name) {
    case "item":
      return href.reports();
    case "settings":
    case "log":
      return href.settingsPicker();
    case "settingsPicker":
    case "newSite":
    case "agents":
    case "passkeys":
      return href.more();
    default:
      return null;
  }
}

let steps = 0;
if (typeof window !== "undefined") addEventListener("hashchange", () => steps++);
/** Back to where the reviewer came from (their place in the queue), or up to `parent`. */
export function goBack(parent: string | null) {
  if (steps > 0) {
    steps -= 2; // this step back fires hashchange too
    history.back();
  } else if (parent) location.hash = parent;
}

export function go(h: string) {
  if (location.hash !== h) location.hash = h;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}
