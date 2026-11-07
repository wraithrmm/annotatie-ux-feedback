// The jobs Lambda. Invoked by EventBridge Scheduler once a day for retention (captures of resolved
// reports are deleted after the site's retention period), and by an operator for the one-off owner
// bootstrap (`{"action":"bootstrap-owner","email":"..."}`), which returns the first invite link, and
// for the one-off `{"action":"setup-self-site","email":"..."}`: Annotatie's own site, so the portal
// hosts the widget for that person (and anyone they later invite to the site).
import { Db, getOrCreateSecret, SECRET_NAMES, Service, type PersonPrincipal } from "@annotatie/store";
import { generateSiteKey } from "@annotatie/sdk-server-node";
import { type CaptureStore, s3Captures } from "@annotatie/api/src/captures.js";

export interface JobDeps {
  svc: Service;
  captures: Pick<CaptureStore, "purge">;
}

export async function purgeExpired({ svc, captures }: JobDeps): Promise<{ purged: number; failed: number }> {
  let purged = 0;
  let failed = 0;
  for (const { siteId, itemId } of await svc.capturesToPurge()) {
    try {
      await captures.purge(siteId, itemId);
      await svc.markCapturePurged(siteId, itemId);
      purged++;
    } catch (e) {
      failed++;
      console.error(JSON.stringify({ msg: "purge failed", siteId, itemId, error: String(e) }));
    }
  }
  return { purged, failed };
}

/** The first person's invite. Refused once that email has an account (sign in instead). */
export async function bootstrapOwner(svc: Service, email: unknown): Promise<{ inviteUrl: string; expiresAt: string }> {
  if (typeof email !== "string" || !email) throw new Error("email is required");
  if (await svc.userByEmail(email.toLowerCase())) throw new Error("That email already has an account; sign in at /board/.");
  const inv = await svc.createInvite(null, email);
  return { inviteUrl: inv.url, expiresAt: inv.expiresAt };
}

/**
 * Creates Annotatie's own site, owned by `email`'s account, allowing the portal's origin, with a new
 * site key whose private half goes straight into SSM (it is never returned) and auto-approve on. Runs
 * once: when the secret exists it only reports the site id.
 */
export async function setupSelfSite(
  svc: Service,
  email: unknown,
  baseUrl: string,
  getOrCreate: (name: string, make: () => Promise<string>) => Promise<string> = getOrCreateSecret,
): Promise<{ siteId: string; kid: string; created: boolean }> {
  if (typeof email !== "string" || !email) throw new Error("email is required");
  const userId = await svc.userByEmail(email.toLowerCase());
  if (!userId) throw new Error("That email has no account yet.");
  const user = (await svc.getUser(userId))!;
  let created = false;
  const raw = await getOrCreate(SECRET_NAMES.selfSite, async () => {
    const owner: PersonPrincipal = { kind: "person", userId, name: user.name, via: { kind: "portal" } };
    const site = await svc.createSite(owner, { name: "Annotatie", origins: [baseUrl] });
    const key = generateSiteKey();
    await svc.addKey(owner, site.id, { kid: key.kid, publicKeyJwk: key.publicKeyJwk });
    await svc.setAutoApprove(owner, site.id, { on: true });
    created = true;
    return JSON.stringify({ siteId: site.id, kid: key.kid, privateKeyPem: key.privateKeyPem });
  });
  const { siteId, kid } = JSON.parse(raw) as { siteId: string; kid: string };
  return { siteId, kid, created };
}

let deps: JobDeps | undefined;

export async function handler(event: { action?: string; email?: string }): Promise<unknown> {
  const baseUrl = process.env.ANNOTATIE_BASE_URL ?? "https://annotatie.consulteasy.co.uk";
  deps ??= {
    svc: new Service(new Db(process.env.TABLE_NAME ?? "annotatie-data"), { autoApproveAllowed: process.env.AUTO_APPROVE_ALLOWED !== "false", baseUrl }),
    captures: s3Captures(process.env.CAPTURE_BUCKET ?? ""),
  };
  if (event?.action === "bootstrap-owner") return bootstrapOwner(deps.svc, event.email);
  if (event?.action === "setup-self-site") return setupSelfSite(deps.svc, event.email, baseUrl);
  const out = await purgeExpired(deps);
  console.log(JSON.stringify({ msg: "retention", ...out }));
  return out;
}
