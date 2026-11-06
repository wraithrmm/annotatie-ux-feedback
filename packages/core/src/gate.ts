// The approval gate (implementation-plan.md §4). Every message's starting state is decided here and
// nowhere else; each row of the plan's table has a test in packages/core/test/gate.test.ts.

import type { MessageState, Site, Visibility } from "./types.js";

/** Who is writing. Taken from the verified token, never from the request body. */
export type PrincipalKind =
  /** A person signed in to the portal (token audience api, client annotatie-portal). */
  | "person"
  /** An agent: an MCP OAuth token or a personal access token. */
  | "agent"
  /** A person on a host site, through the widget (site assertion exchange). */
  | "widget";

/** M2: Approve and send holds a message this long before the widget shows it. */
export const UNDO_WINDOW_MS = 10_000;

export interface GateInput {
  principal: PrincipalKind;
  visibility: Visibility;
  site: Pick<Site, "autoApprove" | "autoApproveUntil">;
  /** The platform kill switch (OpenTofu variable auto_approve_allowed). */
  autoApproveAllowed: boolean;
  now: Date;
}

export interface GateResult {
  state: MessageState;
  autoApproved: boolean;
  /** Only for published user-visible messages. */
  releaseAt?: string;
}

export class GateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Is the site's auto-approve flag in force right now (flag on, not expired, platform allows it)? */
export function autoApproveInForce(
  site: Pick<Site, "autoApprove" | "autoApproveUntil">,
  autoApproveAllowed: boolean,
  now: Date,
): boolean {
  if (!autoApproveAllowed || !site.autoApprove) return false;
  if (site.autoApproveUntil && Date.parse(site.autoApproveUntil) <= now.getTime()) return false;
  return true;
}

export function decideMessageState(input: GateInput): GateResult {
  const { principal, visibility, site, autoApproveAllowed, now } = input;
  const nowIso = now.toISOString();

  switch (principal) {
    case "widget":
      // A host-site user writes only user-visible messages, and they are their own.
      if (visibility !== "user") throw new GateError("forbidden", "Site users can only write visible messages.");
      return { state: "published", autoApproved: false, releaseAt: nowIso };

    case "person":
      // A person in the portal is the gate: internal notes and replies are published at once.
      return visibility === "user"
        ? { state: "published", autoApproved: false, releaseAt: nowIso }
        : { state: "published", autoApproved: false };

    case "agent":
      if (visibility === "internal") return { state: "published", autoApproved: false };
      if (autoApproveInForce(site, autoApproveAllowed, now)) {
        // Auto-approved replies skip the undo delay (M2).
        return { state: "published", autoApproved: true, releaseAt: nowIso };
      }
      // The agent cannot override this: a user-visible agent reply is a draft.
      return { state: "draft", autoApproved: false };
  }
}

/** Only a person in the portal may publish (approve) or reject a draft. */
export function canPublish(principal: PrincipalKind): boolean {
  return principal === "person";
}

/** M2: when an approved message becomes visible to users. */
export function releaseTime(now: Date): string {
  return new Date(now.getTime() + UNDO_WINDOW_MS).toISOString();
}

/** Is a message visible to a host-site user at this moment? The widget API reads only these. */
export function visibleToUsers(
  m: { visibility: Visibility; state: MessageState; releaseAt?: string },
  now: Date,
): boolean {
  if (m.visibility !== "user" || m.state !== "published") return false;
  if (!m.releaseAt) return false;
  return Date.parse(m.releaseAt) <= now.getTime();
}
