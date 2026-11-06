// Annotatie portal service worker (M1): shows push notifications and opens the right screen.
// It caches nothing: the portal always loads fresh from the network.
/* eslint-env serviceworker */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const SCOPE = new URL("./", self.location.href).href; // .../board/

function sameScope(url) {
  try {
    const u = new URL(url, SCOPE);
    return u.href.startsWith(SCOPE) ? u.href : SCOPE;
  } catch {
    return SCOPE;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Annotatie";
  const body = typeof data.body === "string" ? data.body : "Something is waiting for you.";
  const url = sameScope(typeof data.url === "string" ? data.url : SCOPE);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: SCOPE + "icon-192.png",
      badge: SCOPE + "icon-192.png",
      tag: url,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = sameScope(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (w.url.startsWith(SCOPE) && "focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
