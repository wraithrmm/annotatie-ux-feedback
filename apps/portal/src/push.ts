// M1: notifications on this device (Web Push through the portal's service worker).

import type { Api } from "./api";
import { base64url, fromBase64url } from "./pkce";

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function standalone(): boolean {
  return matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || isIos()) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Windows/.test(ua)) return "Windows computer";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "Linux computer";
  return "This device";
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/board/")) ?? null;
}

export async function pushState(): Promise<PushState> {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return isIos() && !standalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function enablePush(api: Api): Promise<PushState> {
  if (Notification.permission !== "granted") {
    const p = await Notification.requestPermission();
    if (p !== "granted") return p === "denied" ? "denied" : "off";
  }
  const reg = (await registration()) ?? (await navigator.serviceWorker.register("/board/sw.js", { scope: "/board/" }));
  await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64url(publicKey) as BufferSource });
  const p256dh = sub.getKey("p256dh");
  const auth = sub.getKey("auth");
  if (!p256dh || !auth) throw new Error("This browser didn't give the keys notifications need.");
  try {
    await api.subscribePush({ endpoint: sub.endpoint, keys: { p256dh: base64url(p256dh), auth: base64url(auth) }, device: deviceName() });
  } catch (e) {
    await sub.unsubscribe().catch(() => undefined);
    throw e;
  }
  return "on";
}

export async function disablePush(api: Api): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.unsubscribePush(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
  return "off";
}
