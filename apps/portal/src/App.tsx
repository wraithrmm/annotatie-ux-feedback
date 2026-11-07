// The shell (PT-2 §3): bottom bar (Attention, Reports, Decisions, More) on phones and tablets,
// PT-1's side navigation on wide screens; a top bar with the title, freshness and Refresh; pushed
// screens swap the bottom bar for a back arrow; the auto-approve banner on every screen while it is on.

import { useEffect, useState } from "preact/hooks";
import { clock } from "./format";
import { href, goBack, parentOf, useRoute, type Route } from "./router";
import { useStore } from "./store";
import { Icon } from "./components/bits";
import { AttentionScreen, entriesOf } from "./screens/Attention";
import { ItemScreen } from "./screens/Item";
import { DecisionsScreen, ReportsScreen } from "./screens/Lists";
import { MoreScreen } from "./screens/More";
import { LogScreen, NewSite, SettingsPicker, SiteSettings } from "./screens/Settings";
import { AgentsScreen, PasskeysScreen } from "./screens/Agents";
import { GuideScreen } from "./screens/Guide";

const TITLES: Partial<Record<Route["name"], string>> = {
  attention: "Attention",
  reports: "Reports",
  decisions: "Decisions",
  more: "More",
  settingsPicker: "Site settings",
  settings: "Site settings",
  log: "Activity log",
  newSite: "Add a site",
  agents: "Agents and tokens",
  passkeys: "Passkeys",
  guide: "How-to guide",
  notFound: "Not found",
};

/** Screens that draw their own heading. */
const OWN_HEADING = new Set<Route["name"]>(["item", "settings"]);

export function App() {
  const route = useRoute();
  const store = useStore();
  const { me, attention, pending, updatedAt, refresh, toastText, api, toast, signOut } = store;
  const [itemTitle, setItemTitle] = useState("");
  const pushed = parentOf(route) !== null;
  const title = route.name === "item" ? itemTitle || "Report" : (TITLES[route.name] ?? "");

  useEffect(() => {
    document.body.classList.toggle("pushed", pushed);
  }, [pushed]);
  useEffect(() => {
    document.title = `${title} · Annotatie`;
  }, [title]);
  useEffect(() => {
    setItemTitle("");
    window.scrollTo(0, 0);
    // Move focus to the screen's heading once it has rendered.
    const t = setTimeout(() => {
      const h = document.querySelector<HTMLElement>("#main h1");
      if (h) {
        h.setAttribute("tabindex", "-1");
        h.focus({ preventScroll: true });
      }
    }, 60);
    return () => clearTimeout(t);
  }, [route.name, (route as { siteId?: string }).siteId, (route as { itemId?: string }).itemId]);

  const live = attention ? entriesOf(attention).filter((e) => !(e.kind === "draft" && pending.some((p) => p.messageId === e.message.id))) : [];
  const attCount = live.length;
  const decCount = live.filter((e) => e.kind === "decision").length;
  const sites = me?.sites ?? [];
  const autoSites = sites.filter((s) => s.autoApprove);

  const base = route.name === "item" ? "reports" : route.name;
  const current = (n: string) => (base === n ? ("page" as const) : undefined);

  const back = () => {
    const parent = parentOf(route);
    goBack(parent);
  };

  const turnOff = async () => {
    try {
      await Promise.all(autoSites.filter((s) => s.role === "owner").map((s) => api.setAutoApprove(s.id, false)));
      toast("Auto-approve is off");
      await refresh();
    } catch (e) {
      toast(`Not turned off: ${(e as Error).message}`);
    }
  };

  const fresh = updatedAt ? `Updated ${clock(updatedAt)}` : "";

  return (
    <>
      <div class="app">
        <nav class="side" aria-label="Portal">
          <div class="brand">
            <i>A</i> Annotatie
          </div>
          <div class="nav">
            <a href={href.attention()} aria-current={current("attention")}>
              <span>Attention</span>
              <span class={`count${attCount ? " hot" : ""}`}>{attCount}</span>
            </a>
            <a href={href.reports()} aria-current={current("reports")}>
              <span>Reports</span>
              <span />
            </a>
            <a href={href.decisions()} aria-current={current("decisions")}>
              <span>Decisions</span>
              <span class={`count${decCount ? " hot" : ""}`}>{decCount}</span>
            </a>
          </div>
          <div class="nav-h">Sites</div>
          <div class="nav">
            {sites.map((s) => {
              const n = s.counts ? s.counts.drafts + s.counts.decisions + s.counts.unanswered : 0;
              return (
                <a href={href.reports(s.id)} key={s.id}>
                  <span>{s.name}</span>
                  <span class={`count${n ? " hot" : ""}`}>{n}</span>
                </a>
              );
            })}
            <a href={href.newSite()} aria-current={current("newSite")}>
              <span>Add a site</span>
              <span />
            </a>
          </div>
          <div class="nav-h">You</div>
          <div class="nav">
            <a href={href.settingsPicker()} aria-current={route.name === "settings" || route.name === "settingsPicker" || route.name === "log" ? "page" : undefined}>
              <span>Settings</span>
              <span />
            </a>
            <a href={href.agents()} aria-current={current("agents")}>
              <span>Agents and tokens</span>
              <span />
            </a>
            <a href={href.passkeys()} aria-current={current("passkeys")}>
              <span>Passkeys</span>
              <span />
            </a>
            <a href={href.guide()} aria-current={current("guide")}>
              <span>How-to guide</span>
              <span />
            </a>
            <a href={href.more()} aria-current={current("more")}>
              <span>More</span>
              <span />
            </a>
          </div>
          <p class="meta" style={{ marginTop: "auto", padding: "8px" }}>
            {me?.user.name}
            <br />
            <span class="kbd">
              Press <kbd>?</kbd> for shortcuts
            </span>
            <br />
            <button class="link signout" type="button" onClick={signOut}>
              Sign out
            </button>
          </p>
        </nav>

        <div>
          <header class="topbar">
            <button class="btn ghost icon back" type="button" aria-label="Back" onClick={back}>
              <Icon.back />
            </button>
            <span class="t">{title}</span>
            <span class="meta refresh" aria-live="off">
              {fresh}
            </span>
            <button class="btn ghost icon refresh" type="button" aria-label="Refresh" onClick={() => void refresh().then(() => toast("Up to date"))}>
              <Icon.refresh />
            </button>
          </header>
          <div class={`autobar${autoSites.length ? " on" : ""}`} role="status" data-testid="autobar">
            {autoSites.length > 0 && (
              <>
                <span class="grow">Auto-approve is on for {autoSites.map((s) => s.name).join(", ")}</span>
                {autoSites.some((s) => s.role === "owner") && (
                  <button class="link" type="button" onClick={turnOff}>
                    Turn off
                  </button>
                )}
              </>
            )}
          </div>

          <main class="main" id="main">
            {!OWN_HEADING.has(route.name) && (
              <div class="page-h">
                <h1 class="grow" tabIndex={-1}>
                  {title}
                </h1>
                {!pushed && (
                  <span class="fresh meta">
                    {fresh}{" "}
                    <button class="btn ghost" type="button" onClick={() => void refresh().then(() => toast("Up to date"))}>
                      Refresh
                    </button>
                  </span>
                )}
              </div>
            )}
            <Screen route={route} setItemTitle={setItemTitle} />
          </main>

          <nav class="bottombar" aria-label="Portal">
            <a href={href.attention()} aria-current={current("attention")}>
              <Icon.attention />
              Attention
              {attCount > 0 && (
                <span class="badge" aria-label={`${attCount} waiting`}>
                  {attCount}
                </span>
              )}
            </a>
            <a href={href.reports()} aria-current={current("reports")}>
              <Icon.reports />
              Reports
            </a>
            <a href={href.decisions()} aria-current={current("decisions")}>
              <Icon.decisions />
              Decisions
              {decCount > 0 && (
                <span class="badge" aria-label={`${decCount} waiting`}>
                  {decCount}
                </span>
              )}
            </a>
            <a href={href.more()} aria-current={current("more")}>
              <Icon.more />
              More
            </a>
          </nav>
        </div>
      </div>
      <div class={`toast${toastText ? " show" : ""}`} role="status" aria-live="polite" data-testid="toast">
        {toastText}
      </div>
    </>
  );
}

function Screen(props: { route: Route; setItemTitle: (t: string) => void }) {
  const r = props.route;
  switch (r.name) {
    case "attention":
      return <AttentionScreen />;
    case "reports":
      return <ReportsScreen siteId={r.siteId} />;
    case "item":
      return <ItemScreen key={r.itemId} siteId={r.siteId} itemId={r.itemId} setTitle={props.setItemTitle} />;
    case "decisions":
      return <DecisionsScreen />;
    case "more":
      return <MoreScreen />;
    case "settingsPicker":
      return <SettingsPicker />;
    case "settings":
      return <SiteSettings key={r.siteId} siteId={r.siteId} />;
    case "log":
      return <LogScreen siteId={r.siteId} />;
    case "newSite":
      return <NewSite />;
    case "agents":
      return <AgentsScreen />;
    case "passkeys":
      return <PasskeysScreen />;
    case "guide":
      return <GuideScreen />;
    default:
      return (
        <p>
          There's no such page. <a href={href.attention()}>Go to Attention</a>
        </p>
      );
  }
}
