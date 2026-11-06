// The jobs Lambda. Invoked by EventBridge Scheduler once a day for retention (captures of resolved
// reports are deleted after the site's retention period), and by an operator for the one-off owner
// bootstrap (`{"action":"bootstrap-owner","email":"..."}`), which returns the first invite link.
import { Db, Service } from "@annotatie/store";
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

let deps: JobDeps | undefined;

export async function handler(event: { action?: string; email?: string }): Promise<unknown> {
  const baseUrl = process.env.ANNOTATIE_BASE_URL ?? "https://annotatie.consulteasy.co.uk";
  deps ??= {
    svc: new Service(new Db(process.env.TABLE_NAME ?? "annotatie-data"), { autoApproveAllowed: process.env.AUTO_APPROVE_ALLOWED !== "false", baseUrl }),
    captures: s3Captures(process.env.CAPTURE_BUCKET ?? ""),
  };
  if (event?.action === "bootstrap-owner") return bootstrapOwner(deps.svc, event.email);
  const out = await purgeExpired(deps);
  console.log(JSON.stringify({ msg: "retention", ...out }));
  return out;
}
