const VERSION = "kakeibo-shell-v4";
const SCOPE = new URL(self.registration.scope).pathname;
const PREFIX = `kakeibo:${SCOPE}:`;
const CACHE = PREFIX + VERSION;
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/schema.js",
  "./js/db.js",
  "./js/share-state.js",
  "./js/share.js",
  "./js/share-ui.js",
  "./js/domain.js",
  "./js/budget.js",
  "./js/budget-ui.js",
  "./js/validation.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(
        ASSETS.map(
          (p) =>
            new Request(new URL(p, self.registration.scope), {
              cache: "reload",
            }),
        ),
      );
    })(),
  );
});
// A new worker waits until the user explicitly chooses to apply it.
self.addEventListener("message", (event) => {
  if (event.data?.type === "APPLY_UPDATE") self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(SCOPE)
  )
    return;
  const path = url.pathname.slice(SCOPE.length),
    allowed = new Set(ASSETS.map((p) => p.slice(2)));
  if (!allowed.has(path)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = new Request(new URL(path || "./", self.registration.scope));
      const hit = await cache.match(key);
      return hit || fetch(event.request);
    })(),
  );
});
