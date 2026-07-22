// Service worker Operations01 — hors ligne + mises à jour automatiques.
// Stratégie « réseau d'abord » : en ligne, on récupère toujours la dernière version
// (plus besoin de vider le cache à la main) ; hors ligne, on sert la copie en cache.
const CACHE = "operations01-v7";
const ASSETS = [".", "index.html", "styles.css", "config.js", "drive.js", "app.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
