import type { AgentScope, Via } from "@annotatie/core";

/** Who is calling, from a verified token. Every service function takes one. */
export type Principal = PersonPrincipal | AgentPrincipal | WidgetPrincipal;

/** A person in the portal. */
export interface PersonPrincipal {
  kind: "person";
  userId: string;
  name: string;
  via: Via;
}

/** An agent acting as a person: an MCP OAuth token or a personal access token. */
export interface AgentPrincipal {
  kind: "agent";
  userId: string;
  name: string;
  /** Sites the token is limited to; null = every site the person belongs to. */
  sites: string[] | null;
  scopes: ReadonlySet<AgentScope>;
  via: Via;
}

/** A person on a host site, through the widget. */
export interface WidgetPrincipal {
  kind: "widget";
  siteId: string;
  /** The host's stable user id (assertion `sub`). */
  userId: string;
  name: string;
  email?: string;
}
