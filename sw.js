/* Graphene service worker — full offline support */
const CACHE = "graphene-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/splash.js",
  "./js/core.js",
  "./js/boolean.js",
  "./js/render.js",
  "./js/tools.js",
  "./js/ui.js",
  "./js/extras.js",
  "./js/pro.js",
  "./js/distort.js",
  "./js/trace.js",
  "./js/png.js",
  "./js/pdf.js",
  "./js/arrange.js",
  "./js/fountain.js",
  "./js/mesh.js",
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

/* Network-first, falling back to cache.
 *
 * Only successful, same-origin, basic responses are written back. The previous
 * version cached whatever came off the network, so one 502 from a flaky
 * connection - or a captive-portal interception page - permanently replaced a
 * good asset, leaving the app broken offline until storage was cleared.
 * Opaque cross-origin responses (status 0) were poisonous for the same reason. */
function cacheable(res) {
  return res && res.ok && res.status === 200 && (res.type === "basic" || res.type === undefined);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  /* Don't touch other origins, and never cache range requests (partial content
     stored as if it were the whole file corrupts media playback). */
  if (new URL(req.url, self.location.origin).origin !== self.location.origin) return;
  if (req.headers && req.headers.get && req.headers.get("range")) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (cacheable(res)) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => {
        if (r) return r;
        /* Only fall back to the app shell for navigations; returning index.html
           for a missing .js request would hand the parser HTML and fail
           confusingly. */
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "Offline and not cached" });
      }))
  );
});
