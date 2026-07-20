// Service worker Operations01 — met l'app en cache pour le fonctionnement hors ligne.
const CACHE = "operations01-v2";
const ASSETS = [
  ".",
  "index.html",
  "styles.css",
  "config.js",
  "drive.js",
  "app.js",
  "manifest.webmanifest",
  "icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie « cache d'abord, réseau ensuite » : l'app s'ouvre instantanément, même hors ligne.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
            return res;
          })
          .catch(() => cached)
      );
    })
  );
});
