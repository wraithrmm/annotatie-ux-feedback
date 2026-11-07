// Annotatie on Annotatie: the portal is a host site like any other. Its server route
// GET /api/self/widget-token signs an assertion for the signed-in person and exchanges it, and answers
// 404 to anyone who is not a member of Annotatie's own site. Only when it gives a token is the widget's
// code even loaded, so everyone else's portal carries no trace of it.

export interface WidgetToken {
  siteId: string;
  access_token: string;
  expires_in: number;
}

/** GET /api/self/widget-token through the portal's own authenticated fetch. null = not permitted. */
export async function fetchWidgetToken(request: (path: string) => Promise<Response>): Promise<WidgetToken | null> {
  const res = await request("/api/self/widget-token");
  if (res.status === 401 || res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`widget token: ${res.status}`);
  const j = (await res.json()) as Partial<WidgetToken>;
  if (typeof j.siteId !== "string" || typeof j.access_token !== "string" || typeof j.expires_in !== "number") return null;
  return { siteId: j.siteId, access_token: j.access_token, expires_in: j.expires_in };
}

export async function startFeedback(request: (path: string) => Promise<Response>, origin: string): Promise<void> {
  const first = await fetchWidgetToken(request).catch(() => null);
  if (!first) return;
  const { start } = await import("@annotatie/sdk-browser");
  let primed: WidgetToken | null = first;
  await start({
    siteId: first.siteId,
    base: origin,
    getToken: async () => {
      if (primed) {
        const t = primed;
        primed = null;
        return t;
      }
      return fetchWidgetToken(request);
    },
    // Reports carry the portal screen they were made on (#/sites/<id>/items/<id> → "sites/items").
    route: () => location.hash.replace(/^#\/?/, "").split("?")[0]!.split("/").filter((_, i) => i % 2 === 0).join("/") || "attention",
  });
}
