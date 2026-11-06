// M1: Web Push to the team's devices when a draft or a decision is waiting. VAPID keys are generated
// in place and kept in SSM. Quiet hours hold back everything except blocking questions.
import webpush from "web-push";
import type { Preferences } from "@annotatie/core";
import { getOrCreateSecret, SECRET_NAMES } from "./secrets.js";
import type { NotifyEvent, Service } from "./service.js";

export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const raw = await getOrCreateSecret(SECRET_NAMES.vapid, () => JSON.stringify(webpush.generateVAPIDKeys()));
  return JSON.parse(raw) as { publicKey: string; privateKey: string };
}

/** Is `now` inside the person's quiet hours? */
export function inQuietHours(q: Preferences["quietHours"], now: Date): boolean {
  if (!q) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: q.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  const t = `${hh}:${mm}`;
  return q.start <= q.end ? t >= q.start && t < q.end : t >= q.start || t < q.end;
}

export function makePushNotifier(getService: () => Service, baseUrl: string, subject = "mailto:alert@consulteasy.co.uk") {
  return async (e: NotifyEvent): Promise<void> => {
    const svc = getService();
    const keys = await vapidKeys();
    const now = svc.now();
    const isQuestion = e.type === "decision" && !!e.item.decision?.asker;
    const title =
      e.type === "draft" ? `Draft waiting · ${e.siteName}` : `${isQuestion ? "Question" : "Decision"}${e.blocking ? " (blocking)" : ""} · ${e.siteName}`;
    const body = e.type === "draft" ? `#${e.item.number} ${e.item.title}` : (e.item.decision?.question ?? e.item.title);
    const url = `${baseUrl}/board/#/sites/${e.siteId}/items/${e.item.id}`;
    const payload = JSON.stringify({ title, body: body.slice(0, 180), url, tag: `${e.type}-${e.item.id}` });
    for (const userId of e.userIds) {
      const user = await svc.getUser(userId);
      if (!user) continue;
      const prefs = user.preferences;
      if (e.type === "draft" && !prefs.push.drafts) continue;
      if (e.type === "decision" && !prefs.push.decisions) continue;
      if (!e.blocking && inQuietHours(prefs.quietHours, now)) continue;
      for (const sub of await svc.pushSubscriptions(userId)) {
        try {
          await webpush.sendNotification(sub, payload, {
            vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
            TTL: 3600,
            urgency: e.blocking ? "high" : "normal",
            timeout: 3000,
          });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await svc.removePushSubscription(userId, sub.endpoint);
          else console.warn(JSON.stringify({ msg: "push failed", status }));
        }
      }
    }
  };
}
