import { describe, expect, it } from "vitest";
import { freshService, person, widgetUser, page } from "../../../packages/store/test/helpers.js";
import { bootstrapOwner, purgeExpired, setupSelfSite } from "../src/handler.js";

describe("retention", () => {
  it("purges captures of reports resolved longer ago than the site's retention, once", async () => {
    const svc = await freshService();
    const owner = await person(svc);
    const site = await svc.createSite(owner, { name: "Acme", origins: ["https://shop.example.com"] });
    const user = widgetUser(site.id);
    const make = async () => {
      const r = await svc.createReport(user, { body: "Broken", page, capture: { context: { url: page.url, viewport: { width: 1, height: 1 }, method: "dom" } } });
      await svc.confirmCapture(user, r.id, { page: { size: 1 } }, []);
      return r.id;
    };
    const old = await make();
    const recent = await make();
    const open = await make();
    await svc.updateItem(owner, site.id, old, { status: "resolved" });
    await svc.updateItem(owner, site.id, recent, { status: "resolved" });
    void open;
    // 91 days later, only the first resolution is past retention — move the clock by resolving "old" earlier
    await svc.db.update(`SITE#${site.id}`, `ITEM#${old}`, { resolvedAt: new Date(Date.now() - 91 * 86400_000).toISOString() });

    const purged: string[] = [];
    const deps = { svc, captures: { purge: async (_s: string, i: string) => void purged.push(i) } };
    expect(await purgeExpired(deps)).toEqual({ purged: 1, failed: 0 });
    expect(purged).toEqual([old]);
    const { item } = await svc.getItem(owner, site.id, old);
    expect(item.capture?.files).toEqual({});
    expect(await purgeExpired(deps)).toEqual({ purged: 0, failed: 0 });
  });
});

describe("bootstrap", () => {
  it("creates the first invite and refuses an email that already has an account", async () => {
    const svc = await freshService();
    const out = await bootstrapOwner(svc, "Owner@Example.com");
    expect(out.inviteUrl).toMatch(/^https:\/\/annotatie\.test\/oauth\/invite\/[A-Za-z0-9_-]{20,}$/);
    await svc.createUser("Riley", "riley@example.com");
    await expect(bootstrapOwner(svc, "riley@example.com")).rejects.toThrow(/already has an account/);
  });
});

describe("setup-self-site", () => {
  it("creates Annotatie's own site once: owned by the person, portal origin, active key, auto-approve on", async () => {
    const svc = await freshService();
    const userId = await svc.createUser("Riley", "riley@example.com");
    const store = new Map<string, string>();
    const getOrCreate = async (name: string, make: () => Promise<string>) => {
      if (!store.has(name)) store.set(name, await make());
      return store.get(name)!;
    };
    const out = await setupSelfSite(svc, "Riley@example.com", "https://annotatie.test", getOrCreate);
    expect(out.created).toBe(true);
    const saved = JSON.parse([...store.values()][0]!);
    expect(saved.siteId).toBe(out.siteId);
    expect(saved.privateKeyPem).toMatch(/BEGIN PRIVATE KEY/);
    expect(JSON.stringify(out)).not.toContain("PRIVATE");

    const owner = { kind: "person" as const, userId, name: "Riley", via: { kind: "portal" as const } };
    const site = await svc.getSite(owner, out.siteId);
    expect(site.role).toBe("owner");
    expect(site.origins).toEqual(["https://annotatie.test"]);
    expect(site.autoApprove).toBe(true);
    expect(await svc.activeSiteKey(out.siteId, out.kid)).toBeTruthy();

    const again = await setupSelfSite(svc, "riley@example.com", "https://annotatie.test", getOrCreate);
    expect(again).toEqual({ siteId: out.siteId, kid: out.kid, created: false });
    expect((await svc.mySites(owner)).length).toBe(1);
  });

  it("refuses an email with no account", async () => {
    const svc = await freshService();
    await expect(setupSelfSite(svc, "nobody@example.com", "https://annotatie.test", async (_n, m) => m())).rejects.toThrow(/no account/);
  });
});
