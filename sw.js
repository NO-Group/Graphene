/* Graphene service worker — full offline support */
const CACHE = "graphene-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/core.js",
  "./js/boolean.js",
  "./js/render.js",
  "./js/tools.js",
  "./js/ui.js",
  "./js/extras.js",
  "./js/pro.js",
  "./js/distort.js",
  "./js/trace.js",
  "./js/pdf.js",
  "./js/fountain.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* network-first for navigation (so updates land), cache-first for assets */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
