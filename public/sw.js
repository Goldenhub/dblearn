/* dblearn service worker — offline-first caching for the browser-native labs.

   Strategy:
   - Precached: app shell pages (fallback for offline), manifest, icons.
   - /_next/static/* : cache-first (hashed, immutable).
   - /db/*            : cache-first (DuckDB wasm engine assets).
   - navigations      : network-first, falling back to the cache (last seen
                        page) then to "/".
   - everything else  : stale-while-revalidate.

   Bump VERSION whenever you change this file or ship a release so old
   caches are cleaned out on activate.
*/

const VERSION = "dblearn-v2";
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;

const PRECACHE_URLS = ["/", "/manifest.webmanifest", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("dblearn-") && k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Hashed build assets — immutable, serve from cache without hitting network.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/db/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(RUNTIME).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Navigations: prefer the network, fall back to the cached page, then "/".
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) => cached || caches.match("/"),
          ),
        ),
    );
    return;
  }

  // Manifest, icons, fonts, images — stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});