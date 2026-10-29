// Service worker Operations01 — hors ligne + mises à jour automatiques.
// Stratégie « réseau d'abord » : en ligne, on récupère toujours la dernière version
// (plus besoin de vider le cache à la main) ; hors ligne, on sert la copie en cache.
const CACHE = "operations01-v155";
const ASSETS = [".", "index.html", "styles.css", "config.js", "drive.js", "app.js", "manifest.webmanifest", "icon.svg", "logo.png", "logo-mark.png", "icon-64.png", "icon-180.png", "icon-192.png", "icon-512.png"];

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
  const sameOrigin = event.request.url.indexOf(self.location.origin) === 0;
  // Sur nos propres fichiers, on force la revalidation auprès du serveur :
  // sinon le cache HTTP de Safari (iOS) peut servir une version périmée
  // pendant plusieurs minutes malgré la stratégie « réseau d'abord ».
  const req = sameOrigin
    ? new Request(event.request.url, { cache: "no-cache", credentials: "same-origin" })
    : event.request;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// ---- Notifications poussées : envoyées par le Mac mini (voir ASSISTANT-REPONSES.md, section 6) ----
// Charge utile JSON : { titre, corps, url, section, id, tag, urgence, badge }. Bannière système, et
// pastille sur l'icône (nombre de messages urgents non traités) quand l'appareil le permet.
self.addEventListener("push", (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch (e) { p = { titre: "choice", corps: event.data ? event.data.text() : "" }; }
  const titre = p.titre || p.title || "choice";
  const opts = { body: p.corps || p.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: p.tag || p.id || undefined, renotify: !!(p.tag || p.id),
    data: { url: p.url || "./", section: p.section || "", id: p.id || "" }, requireInteraction: Number(p.urgence) === 1 };
  const jobs = [self.registration.showNotification(titre, opts)];
  if (typeof p.badge === "number" && self.navigator && "setAppBadge" in self.navigator) jobs.push(p.badge > 0 ? self.navigator.setAppBadge(p.badge) : self.navigator.clearAppBadge());
  event.waitUntil(Promise.all(jobs).catch(() => {}));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const target = new URL(d.url || "./", self.location.href).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const c = list.find((x) => x.url.indexOf(self.location.origin) === 0);
    if (c) { c.postMessage({ type: "ouvrir", section: d.section || "", id: d.id || "", url: target }); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
// Abonnement renouvelé par le navigateur : la page le réconcilie à sa prochaine ouverture (syncPushSubscription).
self.addEventListener("pushsubscriptionchange", () => {});
