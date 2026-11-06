import { describe, expect, it } from "vitest";
import { freshService, person, widgetUser, page } from "../../../packages/store/test/helpers.js";
import { bootstrapOwner, purgeExpired } from "../src/handler.js";

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
