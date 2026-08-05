// Service worker: makes Pythia installable and fast on repeat visits.
//
// Scope is deliberately narrow. It caches the app SHELL — html, js, css, icons,
// background — and nothing personal. Charts, conversations and account state all
// come from /api/ and are never stored on the device, so an installed copy on a
// shared phone reveals nothing after logout.
//
// Three rules that are load-bearing, in order of how badly they break things:
//
//   1. /api/ is not intercepted AT ALL. Not "not cached" — not touched. The chat
//      endpoint is Server-Sent Events, and a worker that calls respondWith on it
//      risks buffering the body, which turns a streaming reply into a long pause
//      followed by everything at once. Falling through leaves the stream exactly
//      as the network delivered it. It also guarantees auth-bearing responses
//      can never land in CacheStorage.
//
//   2. HTML is network-first. Assets here carry no content hash — app.js is
//      always app.js — so a cache-first page could pin someone to a stale build
//      indefinitely. Network-first means online users always get the current
//      page, and the cached copy exists purely so the app still opens offline.
//
//   3. Assets are stale-while-revalidate: serve instantly from cache, refresh in
//      the background, so the NEXT load is current. Without content hashes this
//      is the honest trade — worst case someone runs one-load-old JS. Fetch
//      failures are swallowed on purpose: a background refresh that fails must
//      never evict a working cached asset.

const VERSION = "v3";
const SHELL = `pythia-shell-${VERSION}`;

// Both HTML entry points plus everything they load. `/app` is the manifest's
// start_url; `/` is the landing page, from which the install prompt also fires.
const PRECACHE = [
  "/", "/app",
  "/styles.css",
  "/theme.js", "/api.js", "/push-client.js", "/geocode.js", "/domains.js",
  "/share-image.js", "/yoga-names.js", "/yoga-rarity.js", "/app.js",
  "/sw-register.js",
  "/vendor/marked.umd.js", "/vendor/purify.min.js",
  "/cosmos-bg.webp", "/manifest.json",
  "/icon-192.png", "/icon-512.png", "/favicon.svg", "/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Individually, not addAll: that rejects the whole batch if any single entry
    // 404s, which would fail the install and leave the app with no worker at all
    // over one renamed icon.
    await Promise.all(PRECACHE.map(url =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => {})
    ));
    // Safe to activate immediately because HTML is network-first and the app
    // loads all its JS up front — there are no lazy chunks to go out of sync
    // mid-session.
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n.startsWith("pythia-shell-") && n !== SHELL)
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Cross-origin (Google Fonts) is left alone: caching it yields opaque
  // responses that can't be validated or evicted meaningfully, and offline it
  // degrades to a system font, which is fine.
  if (url.origin !== self.location.origin) return;

  // Rule 1 — see the header. Do not touch. /healthz is the platform's health
  // probe and equally has no business being served from a cache.
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

/** Always current when online; the cache is only a fallback for being offline. */
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    // Prefer the exact page, then the app shell — an invite or terms link opened
    // offline still lands somewhere usable rather than the browser error page.
    return (await cache.match(req)) ||
           (await cache.match("/app")) ||
           (await cache.match("/")) ||
           new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

/** Instant from cache, refreshed behind it, so the next load is current. */
async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null); // a failed refresh must not evict a working cached copy
  return hit || (await network) ||
    new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
}
