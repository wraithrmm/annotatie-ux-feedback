// Reports (PT-2 §4.4) and Decisions (§4.5) lists.

import { useState } from "preact/hooks";
import { isDone, type Item, type Site } from "@annotatie/core";
import { ago, itemRef, itemType, STATUS_CLASS, STATUS_LABEL } from "../format";
import { go, href } from "../router";
import { useLoad, useStore } from "../store";
import { Empty, ErrorCard, Thumb } from "../components/bits";

type RFilter = "active" | "approval" | "resolved" | "all";

async function itemsAcross(api: ReturnType<typeof useStore>["api"], sites: Site[], kind: "report" | "decision") {
  const lists = await Promise.all(sites.map((s) => api.items(s.id, { kind }).then((r) => r.items)));
  return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function ReportsScreen(props: { siteId?: string }) {
  const { api, me } = useStore();
  const [filter, setFilter] = useState<RFilter>("active");
  const sites = me?.sites ?? [];
  const chosen = props.siteId ? sites.filter((s) => s.id === props.siteId) : sites;
  const q = useLoad(() => (me ? itemsAcross(api, chosen, "report") : Promise.resolve([] as Item[])), [me?.sites.map((s) => s.id).join(), props.siteId]);
  const all = q.data ?? [];
  const pick = (f: RFilter) =>
    all.filter((it) => (f === "all" ? true : f === "resolved" ? isDone(it.status) : f === "approval" ? it.counts.drafts > 0 : !isDone(it.status)));
  const shown = pick(filter);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "";
  const waiting = pick("approval").length;
  return (
    <section>
      <div class="filters">
        <div class="field">
          <label for="site">Site</label>
          <select id="site" value={props.siteId ?? ""} onChange={(e) => go(href.reports(e.currentTarget.value || undefined))}>
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset class="chips">
          <legend class="sr">Status</legend>
          {(
            [
              ["active", "Open and active"],
              ["approval", "Waiting for approval"],
              ["resolved", "Resolved or closed"],
              ["all", "All"],
            ] as Array<[RFilter, string]>
          ).map(([v, l]) => (
            <label key={v}>
              <input type="radio" name="rf" checked={filter === v} onChange={() => setFilter(v)} />
              {l}
              {v === "approval" && waiting > 0 && <span class="count hot">{waiting}</span>}
            </label>
          ))}
        </fieldset>
      </div>
      {q.error && <ErrorCard error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data ? (
        <p class="loading">Loading…</p>
      ) : (
        <>
          <p class="meta" style={{ margin: "12px 0 8px" }}>
            {shown.length} report{shown.length === 1 ? "" : "s"}, newest first
          </p>
          {shown.length === 0 ? (
            <Empty title="No reports here">{all.length ? "Try another filter." : "When a user sends a report from a site, it appears here."}</Empty>
          ) : (
            <div class="list" role="list">
              {shown.map((it) => (
                <a class="li" role="listitem" href={href.item(it.siteId, it.id)} key={it.id}>
                  <Thumb item={it} />
                  <span class="body">
                    <span class="t">{it.title}</span>
                    <br />
                    <span class="meta">
                      {it.number} · {props.siteId ? "" : `${siteName(it.siteId)} · `}
                      {itemType(it)}
                      {it.page?.path ? ` · ${it.page.path}` : ""}
                      {it.reporter ? ` · ${it.reporter.name}` : ""} · {ago(it.createdAt)}
                    </span>
                  </span>
                  <span class="st">{it.counts.drafts > 0 ? <span class="tag t-draft">Draft waiting</span> : <span class={`tag ${STATUS_CLASS[it.status]}`}>{STATUS_LABEL[it.status]}</span>}</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function DecisionsScreen() {
  const { api, me } = useStore();
  const sites = me?.sites ?? [];
  const q = useLoad(() => (me ? itemsAcross(api, sites, "decision") : Promise.resolve([] as Item[])), [sites.map((s) => s.id).join()]);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "";
  const rank = (it: Item) => (it.decision?.status === "waiting" ? (it.decision.blocking ? 0 : 1) : 2);
  const list = [...(q.data ?? [])].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
  return (
    <section>
      <p class="sub">Questions agents raised for you. Answering records your choice; the agent reads it.</p>
      {q.error && <ErrorCard error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data ? (
        <p class="loading">Loading…</p>
      ) : list.length === 0 ? (
        <div class="mt16">
          <Empty title="No decisions or questions">When an agent asks you something, it appears here.</Empty>
        </div>
      ) : (
        <div class="list mt16" role="list">
          {list.map((it) => {
            const d = it.decision;
            const waiting = d?.status === "waiting";
            const answer = d?.answer;
            return (
              <a class="li noimg" role="listitem" href={href.item(it.siteId, it.id)} key={it.id} data-testid="decision-row">
                <span class="body">
                  <span class="t">{it.title}</span>
                  <br />
                  <span class="meta">
                    {siteName(it.siteId)} · {itemRef(it)}
                    {d?.asker ? ` · asked by ${d.asker.name}` : ""}
                    {it.links.length ? " · linked to a report" : ""}
                    {answer ? ` · answered${answer.option ? ` ${answer.option}` : ""} by ${answer.by.name} · ${ago(answer.at)}` : ` · ${ago(it.createdAt)}`}
                  </span>
                </span>
                <span class="st row">
                  {d?.blocking && waiting && <span class="tag t-block">Blocking</span>}
                  <span class={`tag ${waiting ? "t-open" : "t-resolved"}`}>{waiting ? "Waiting for you" : d?.status === "withdrawn" ? "Withdrawn" : "Answered"}</span>
                </span>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
