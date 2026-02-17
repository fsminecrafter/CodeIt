const CACHE = "pydiode-v1";

const ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/worker.js",
  "/manifest.json"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(ASSETS)
    )
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(
      r => r || fetch(e.request)
    )
  );
});
