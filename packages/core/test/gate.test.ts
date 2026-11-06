// One test per row of the approval-gate table (implementation-plan.md §4), plus the kill switch,
// the time limit (Q7) and M2's release time.
import { describe, expect, it } from "vitest";
import {
  autoApproveInForce,
  canPublish,
  decideMessageState,
  GateError,
  releaseTime,
  visibleToUsers,
} from "../src/gate.js";

const now = new Date("2026-11-06T12:00:00Z");
const off = { autoApprove: false, autoApproveUntil: null };
const on = { autoApprove: true, autoApproveUntil: null };

describe("decideMessageState: the §4 table", () => {
  it("a user through the widget, visibility user → published", () => {
    const r = decideMessageState({ principal: "widget", visibility: "user", site: off, autoApproveAllowed: true, now });
    expect(r).toEqual({ state: "published", autoApproved: false, releaseAt: now.toISOString() });
  });

  it("a user through the widget can't write internal notes", () => {
    expect(() =>
      decideMessageState({ principal: "widget", visibility: "internal", site: off, autoApproveAllowed: true, now }),
    ).toThrow(GateError);
  });

  it("a person in the portal, internal → published", () => {
    const r = decideMessageState({ principal: "person", visibility: "internal", site: off, autoApproveAllowed: true, now });
    expect(r.state).toBe("published");
    expect(r.releaseAt).toBeUndefined();
  });

  it("a person in the portal, user → published straight away", () => {
    const r = decideMessageState({ principal: "person", visibility: "user", site: off, autoApproveAllowed: true, now });
    expect(r).toEqual({ state: "published", autoApproved: false, releaseAt: now.toISOString() });
  });

  it("an agent, internal → published (no approval for notes)", () => {
    const r = decideMessageState({ principal: "agent", visibility: "internal", site: off, autoApproveAllowed: true, now });
    expect(r.state).toBe("published");
  });

  it("an agent, user, auto-approve off → draft, always", () => {
    const r = decideMessageState({ principal: "agent", visibility: "user", site: off, autoApproveAllowed: true, now });
    expect(r).toEqual({ state: "draft", autoApproved: false });
  });

  it("an agent, user, auto-approve on → published, recorded as auto-approved, no undo delay", () => {
    const r = decideMessageState({ principal: "agent", visibility: "user", site: on, autoApproveAllowed: true, now });
    expect(r).toEqual({ state: "published", autoApproved: true, releaseAt: now.toISOString() });
  });
});

describe("kill switch and time limit", () => {
  it("auto_approve_allowed = false forces drafts whatever the site says", () => {
    const r = decideMessageState({ principal: "agent", visibility: "user", site: on, autoApproveAllowed: false, now });
    expect(r.state).toBe("draft");
  });

  it("auto-approve switches itself off at its time limit", () => {
    const expired = { autoApprove: true, autoApproveUntil: "2026-11-06T11:59:59Z" };
    const later = { autoApprove: true, autoApproveUntil: "2026-11-06T13:00:00Z" };
    expect(autoApproveInForce(expired, true, now)).toBe(false);
    expect(autoApproveInForce(later, true, now)).toBe(true);
    expect(decideMessageState({ principal: "agent", visibility: "user", site: expired, autoApproveAllowed: true, now }).state).toBe("draft");
  });
});

describe("publishing and visibility", () => {
  it("only a person may publish", () => {
    expect(canPublish("person")).toBe(true);
    expect(canPublish("agent")).toBe(false);
    expect(canPublish("widget")).toBe(false);
  });

  it("approve holds the message 10 seconds (M2)", () => {
    expect(releaseTime(now)).toBe("2026-11-06T12:00:10.000Z");
  });

  it("users see only published, user-visible, released messages", () => {
    const base = { visibility: "user" as const, state: "published" as const, releaseAt: now.toISOString() };
    expect(visibleToUsers(base, now)).toBe(true);
    expect(visibleToUsers({ ...base, releaseAt: releaseTime(now) }, now)).toBe(false);
    expect(visibleToUsers({ ...base, state: "draft" }, now)).toBe(false);
    expect(visibleToUsers({ ...base, state: "rejected" }, now)).toBe(false);
    expect(visibleToUsers({ ...base, visibility: "internal" }, now)).toBe(false);
    expect(visibleToUsers({ visibility: "user", state: "published" }, now)).toBe(false);
  });
});
