import { describe, expect, it } from "vitest";
import type { HttpError } from "@annotatie/core";
import type { ServiceOptions } from "../src/service.js";
import { agentOf, freshService, page, person, widgetUser } from "./helpers.js";

async function setup(opts: Partial<ServiceOptions> = {}) {
  const svc = await freshService(opts);
  const owner = await person(svc);
  const site = await svc.createSite(owner, { name: "Acme Shop", origins: ["https://shop.example.com"] });
  const user = widgetUser(site.id);
  const report = await svc.createReport(user, { body: "The total is wrong", page, anchor: { selector: "#total" } });
  return { svc, owner, site, user, report };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as HttpError).code;
  }
  return "ok";
};

describe("the approval gate end to end", () => {
  it("an agent's user-visible reply is a draft the site user can't see", async () => {
    const { svc, owner, site, user, report } = await setup();
    const draft = await svc.postMessage(agentOf(owner), site.id, report.id, { body: "We are on it", visibility: "user" });
    expect(draft.state).toBe("draft");
    const seen = await svc.getItem(user, site.id, report.id);
    expect(seen.messages.map((m) => m.body)).toEqual(["The total is wrong"]);
    const team = await svc.getItem(owner, site.id, report.id);
    expect(team.messages).toHaveLength(2);
    expect(team.item.counts.drafts).toBe(1);
  });

  it("an agent can never approve, reject or undo", async () => {
    const { svc, owner, site, report } = await setup();
    const agent = agentOf(owner);
    const draft = await svc.postMessage(agent, site.id, report.id, { body: "Hi", visibility: "user" });
    expect(await code(svc.approve(agent, site.id, report.id, draft.id))).toBe("forbidden");
    expect(await code(svc.reject(agent, site.id, report.id, draft.id, { reason: "x" }))).toBe("forbidden");
    expect(await code(svc.undo(agent, site.id, report.id, draft.id))).toBe("forbidden");
    expect(await code(svc.approve(widgetUser(site.id), site.id, report.id, draft.id))).toBe("forbidden");
  });

  it("approve holds the message 10 s, undo returns it to draft, then it is sent", async () => {
    let now = new Date("2026-11-06T12:00:00Z");
    const { svc, owner, site, user, report } = await setup({ now: () => now });
    const draft = await svc.postMessage(agentOf(owner), site.id, report.id, { body: "Fixed now", visibility: "user" });
    const approved = await svc.approve(owner, site.id, report.id, draft.id, { body: "Fixed now, thanks!" });
    expect(approved.state).toBe("published");
    expect(approved.releaseAt).toBe("2026-11-06T12:00:10.000Z");
    expect(approved.body).toBe("Fixed now, thanks!");
    expect((await svc.getItem(user, site.id, report.id)).messages).toHaveLength(1);

    now = new Date("2026-11-06T12:00:05Z");
    const undone = await svc.undo(owner, site.id, report.id, draft.id);
    expect(undone.state).toBe("draft");
    expect(undone.body).toBe("Fixed now");

    await svc.approve(owner, site.id, report.id, draft.id);
    now = new Date("2026-11-06T12:00:16Z");
    expect(await code(svc.undo(owner, site.id, report.id, draft.id))).toBe("too_late");
    const seen = await svc.getItem(user, site.id, report.id);
    expect(seen.messages.map((m) => m.body)).toEqual(["The total is wrong", "Fixed now"]);
    expect(seen.messages[1]!.via).toBeUndefined();
    expect(seen.item.status).toBe("answered");
  });

  it("reject keeps the draft as an internal note with the reason", async () => {
    const { svc, owner, site, user, report } = await setup();
    const draft = await svc.postMessage(agentOf(owner), site.id, report.id, { body: "Meh", visibility: "user" });
    const r = await svc.reject(owner, site.id, report.id, draft.id, { reason: "Too curt" });
    expect(r.state).toBe("rejected");
    expect(r.rejectedReason).toBe("Too curt");
    expect(await code(svc.approve(owner, site.id, report.id, draft.id))).toBe("not_a_draft");
    expect((await svc.getItem(user, site.id, report.id)).messages).toHaveLength(1);
  });

  it("auto-approve on: agent replies are published at once and marked", async () => {
    const { svc, owner, site, user, report } = await setup();
    await svc.setAutoApprove(owner, site.id, { on: true });
    const m = await svc.postMessage(agentOf(owner), site.id, report.id, { body: "Done", visibility: "user" });
    expect(m.state).toBe("published");
    expect(m.autoApproved).toBe(true);
    expect((await svc.getItem(user, site.id, report.id)).messages).toHaveLength(2);
  });

  it("the kill switch forces drafts and refuses turning auto-approve on", async () => {
    const { svc, owner, site, report } = await setup({ autoApproveAllowed: false });
    expect(await code(svc.setAutoApprove(owner, site.id, { on: true }))).toBe("auto_approve_disabled");
    const m = await svc.postMessage(agentOf(owner), site.id, report.id, { body: "Done", visibility: "user" });
    expect(m.state).toBe("draft");
  });

  it("only owners change auto-approve, and each change is logged", async () => {
    const { svc, owner, site } = await setup();
    const member = await person(svc, "Ana Lopez");
    await svc.addMember(site.id, member.userId, "member");
    expect(await code(svc.setAutoApprove(member, site.id, { on: true }))).toBe("forbidden");
    await svc.setAutoApprove(owner, site.id, { on: true });
    await svc.setAutoApprove(owner, site.id, { on: false });
    const log = await svc.listLog(owner, site.id);
    expect(log.filter((e) => e.type === "site.auto_approve").map((e) => e.detail?.on)).toEqual([false, true]);
  });
});

describe("isolation (negative tests)", () => {
  it("a site user never sees internal notes, drafts or rejected messages", async () => {
    const { svc, owner, site, user, report } = await setup();
    await svc.postMessage(owner, site.id, report.id, { body: "internal", visibility: "internal" });
    const d = await svc.postMessage(agentOf(owner), site.id, report.id, { body: "draft", visibility: "user" });
    await svc.postMessage(agentOf(owner), site.id, report.id, { body: "draft2", visibility: "user" });
    await svc.reject(owner, site.id, report.id, d.id, { reason: "no" });
    const seen = await svc.getItem(user, site.id, report.id);
    expect(seen.messages.map((m) => m.body)).toEqual(["The total is wrong"]);
    expect(JSON.stringify(seen)).not.toMatch(/"internal"|"draft"|"rejected"|Claude Code/);
  });

  it("a site user can't write internal notes and sees no conversations", async () => {
    const { svc, owner, site, user, report } = await setup();
    const m = await svc.postMessage(user, site.id, report.id, { body: "x", visibility: "internal" });
    expect(m.visibility).toBe("user");
    const conv = await svc.createItem(owner, site.id, { kind: "conversation", title: "Plan", body: "secret" });
    expect(await code(svc.getItem(user, site.id, conv.id))).toBe("not_found");
    expect((await svc.listItems(user, site.id)).map((i) => i.kind)).toEqual(["report"]);
  });

  it("nobody reads another site's anything", async () => {
    const { svc, owner, site, report } = await setup();
    const other = await person(svc, "Kim Other");
    const otherSite = await svc.createSite(other, { name: "Other", origins: [] });
    const otherUser = widgetUser(otherSite.id);
    expect(await code(svc.getItem(otherUser, site.id, report.id))).toBe("not_found");
    expect(await code(svc.getItem(otherUser, otherSite.id, report.id))).toBe("not_found");
    expect(await code(svc.getItem(other, site.id, report.id))).toBe("not_found");
    expect(await code(svc.listItems(agentOf(other), site.id))).toBe("not_found");
    expect(await code(svc.postMessage(agentOf(owner, undefined, [otherSite.id]), site.id, report.id, { body: "x", visibility: "internal" }))).toBe("not_found");
  });

  it("agents need the right scope", async () => {
    const { svc, owner, site, report } = await setup();
    const readOnly = agentOf(owner, ["read"]);
    expect(await code(svc.postMessage(readOnly, site.id, report.id, { body: "x", visibility: "internal" }))).toBe("insufficient_scope");
    const noUser = agentOf(owner, ["read", "reply"]);
    expect(await code(svc.postMessage(noUser, site.id, report.id, { body: "x", visibility: "user" }))).toBe("insufficient_scope");
    expect((await svc.postMessage(noUser, site.id, report.id, { body: "x", visibility: "internal" })).state).toBe("published");
    expect(await code(svc.captureFor(readOnly, site.id, report.id, "page"))).toBe("insufficient_scope");
  });

  it("viewers can read but not write", async () => {
    const { svc, site, report } = await setup();
    const viewer = await person(svc, "Vee Viewer");
    await svc.addMember(site.id, viewer.userId, "viewer");
    expect((await svc.getItem(viewer, site.id, report.id)).messages).toHaveLength(1);
    expect(await code(svc.postMessage(viewer, site.id, report.id, { body: "x", visibility: "internal" }))).toBe("forbidden");
  });
});

describe("questions, decisions and changes", () => {
  it("an agent asks, a person answers, get_changes reports it", async () => {
    const { svc, owner, site } = await setup();
    const agent = agentOf(owner);
    const start = await svc.changes(agent);
    const q = await svc.createItem(
      agent,
      site.id,
      { kind: "decision", decision: { question: "Which colour?", options: [{ label: "A", text: "Blue" }, { label: "B", text: "Green" }], blocking: true } },
      { asker: { name: "builder-2", session: "TEST-PC" } },
    );
    expect(q.decision?.asker?.name).toBe("builder-2");
    expect(await code(svc.answer(owner, site.id, q.id, { option: "C" }))).toBe("invalid_request");
    const a = await svc.answer(owner, site.id, q.id, { option: "B", text: "Green fits" });
    expect(a.decision?.answer?.option).toBe("B");
    const ch = await svc.changes(agent, start.cursor);
    expect(ch.events.map((e) => e.type)).toEqual(["question.asked", "question.answered"]);
    expect((await svc.changes(agent, ch.cursor)).events).toHaveLength(0);
    expect(await svc.decisions(agent, { questionsOnly: true, status: "answered" })).toHaveLength(1);
  });

  it("a question with no options needs a written answer; withdraw takes it off the queue", async () => {
    const { svc, owner, site } = await setup();
    const agent = agentOf(owner);
    const q = await svc.createItem(agent, site.id, { kind: "decision", decision: { question: "Why?" } }, { asker: { name: "lead" } });
    expect(await code(svc.answer(owner, site.id, q.id, {}))).toBe("invalid_request");
    const q2 = await svc.createItem(agent, site.id, { kind: "decision", decision: { question: "Still?" } }, { asker: { name: "lead" } });
    await svc.withdrawQuestion(agent, site.id, q2.id, "Found it");
    const att = await svc.attention(owner);
    expect(att.decisions.map((d) => d.item.id)).toEqual([q.id]);
  });

  it("attention lists drafts, unanswered reports and new user messages", async () => {
    const { svc, owner, site, user, report } = await setup();
    let att = await svc.attention(owner);
    expect(att.unanswered.map((x) => x.item.id)).toEqual([report.id]);
    await svc.postMessage(owner, site.id, report.id, { body: "Looking", visibility: "user" });
    await svc.postMessage(user, site.id, report.id, { body: "Thanks, any news?" });
    await svc.postMessage(agentOf(owner), site.id, report.id, { body: "Soon", visibility: "user" });
    att = await svc.attention(owner);
    expect(att.unanswered).toHaveLength(0);
    expect(att.newFromUsers.map((x) => x.message.body)).toEqual(["Thanks, any news?"]);
    expect(att.drafts.map((x) => x.message.body)).toEqual(["Soon"]);
  });
});

describe("tokens, invites, keys", () => {
  it("personal access tokens resolve to a limited agent and can be revoked", async () => {
    const { svc, owner, site } = await setup();
    const { token, pat } = await svc.createToken(owner, { name: "CI agent", sites: [site.id], scopes: ["read"], expiresInDays: 30 });
    expect(token).toMatch(/^ann_pat_/);
    const p = await svc.principalFromPat(token);
    expect(p?.sites).toEqual([site.id]);
    expect([...p!.scopes]).toEqual(["read"]);
    expect(JSON.stringify(await svc.listTokens(owner))).not.toContain(token);
    await svc.revokeToken(owner, pat.id);
    expect(await svc.principalFromPat(token)).toBeUndefined();
    expect(await svc.principalFromPat("ann_pat_nope")).toBeUndefined();
  });

  it("an invite is single use and adds the member", async () => {
    const { svc, owner, site } = await setup();
    const inv = await svc.createInvite(owner, "ana@example.com", { siteId: site.id, role: "member" });
    const token = inv.url.split("/").pop()!;
    expect((await svc.peekInvite(token))?.email).toBe("ana@example.com");
    const ana = await svc.createUser("Ana", "ana@example.com");
    await svc.acceptInvite(token, ana);
    expect(await code(svc.acceptInvite(token, ana))).toBe("invite_used");
    const { members } = await svc.listMembers(owner, site.id);
    expect(members.find((m) => m.userId === ana)?.role).toBe("member");
  });

  it("site keys: public Ed25519 only; retired keys are not active", async () => {
    const { svc, owner, site } = await setup();
    const x = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo";
    expect(await code(svc.addKey(owner, site.id, { publicKeyJwk: { kty: "OKP", crv: "Ed25519", x, d: x } }))).toBe("invalid_request");
    const k = await svc.addKey(owner, site.id, { kid: "k1", publicKeyJwk: { kty: "OKP", crv: "Ed25519", x } });
    expect((await svc.activeSiteKey(site.id, k.kid))?.kid).toBe("k1");
    await svc.retireKey(owner, site.id, "k1");
    expect(await svc.activeSiteKey(site.id, "k1")).toBeUndefined();
  });

  it("jti replay guard and recovery codes are single use", async () => {
    const { svc, owner } = await setup();
    expect(await svc.rememberJti("s", "j1", 9999999999)).toBe(true);
    expect(await svc.rememberJti("s", "j1", 9999999999)).toBe(false);
    const codes = await svc.newRecoveryCodes(owner.userId);
    const u = await svc.getUser(owner.userId);
    expect(await svc.useRecoveryCode(u!.email, codes[0]!)).toBe(owner.userId);
    expect(await svc.useRecoveryCode(u!.email, codes[0]!)).toBeUndefined();
  });
});

describe("resolved by the team, closed by the reporter", () => {
  it("a reply with resolves: true marks the report resolved when it is published at once", async () => {
    const { svc, owner, site, user, report } = await setup();
    await svc.setAutoApprove(owner, site.id, { on: true });
    const m = await svc.postMessage(agentOf(owner), site.id, report.id, { body: "Fixed and live", visibility: "user", resolves: true });
    expect(m.state).toBe("published");
    expect(m.resolves).toBe(true);
    expect((await svc.getItem(user, site.id, report.id)).item.status).toBe("resolved");
    expect((await svc.mySites(owner))[0]!.counts!.open).toBe(0);
  });

  it("a draft with resolves: true changes nothing until approved, and undo puts the status back", async () => {
    let now = new Date("2026-11-06T12:00:00Z");
    const { svc, owner, site, user, report } = await setup({ now: () => now });
    await svc.updateItem(owner, site.id, report.id, { status: "in_progress" });
    const draft = await svc.postMessage(agentOf(owner), site.id, report.id, { body: "Fixed", visibility: "user", resolves: true });
    expect((await svc.getItem(owner, site.id, report.id)).item.status).toBe("in_progress");
    await svc.approve(owner, site.id, report.id, draft.id);
    expect((await svc.getItem(owner, site.id, report.id)).item.status).toBe("resolved");
    now = new Date("2026-11-06T12:00:05Z");
    await svc.undo(owner, site.id, report.id, draft.id);
    expect((await svc.getItem(owner, site.id, report.id)).item.status).toBe("in_progress");
    await svc.approve(owner, site.id, report.id, draft.id);
    now = new Date("2026-11-06T12:00:20Z");
    expect((await svc.getItem(user, site.id, report.id)).item.status).toBe("resolved");
  });

  it("resolves needs the status scope and is ignored on internal notes", async () => {
    const { svc, owner, site, report } = await setup();
    const noStatus = agentOf(owner, ["read", "reply", "reply:user"]);
    expect(await code(svc.postMessage(noStatus, site.id, report.id, { body: "Fixed", visibility: "user", resolves: true }))).toBe("insufficient_scope");
    const note = await svc.postMessage(agentOf(owner), site.id, report.id, { body: "Cause found", visibility: "internal", resolves: true });
    expect(note.resolves).toBeUndefined();
    expect((await svc.getItem(owner, site.id, report.id)).item.status).toBe("open");
  });

  it("only the reporter closes, only a resolved report, and a reply opens it again", async () => {
    const { svc, owner, site, user, report } = await setup();
    expect(await code(svc.closeReport(user, report.id))).toBe("not_resolved");
    await svc.updateItem(owner, site.id, report.id, { status: "resolved" });
    expect(await code(svc.closeReport(widgetUser(site.id, "someone-else", "Kim"), report.id))).toBe("not_found");
    const closed = await svc.closeReport(user, report.id);
    expect(closed.status).toBe("closed");
    expect((await svc.closeReport(user, report.id)).status).toBe("closed");
    const log = await svc.listLog(owner, site.id);
    expect(log.some((e) => e.type === "item.updated" && e.detail?.status === "closed" && e.actor.kind === "user")).toBe(true);
    await svc.postMessage(user, site.id, report.id, { body: "It broke again" });
    expect((await svc.getItem(user, site.id, report.id)).item.status).toBe("waiting_on_us");
  });

  it("the team can close a report too", async () => {
    const { svc, owner, site, report } = await setup();
    const it2 = await svc.updateItem(owner, site.id, report.id, { status: "closed" });
    expect(it2.status).toBe("closed");
    expect((await svc.mySites(owner))[0]!.counts!.unanswered).toBe(0);
  });
});
