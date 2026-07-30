// Routing decisions of the client service worker (public/sw.js).
//
// Lives here because every other test does, and `npm test` finds them here.
//
// The rule these tests exist to protect: /api/ must not be intercepted AT ALL.
// Not "not cached" — the worker must never call respondWith on it. /api/chat is
// Server-Sent Events, and a worker that takes over the response risks buffering
// the body, turning a streaming reply into a long silence followed by the whole
// answer at once. Falling through leaves the stream exactly as the network sent
// it, and guarantees auth-bearing responses can never reach CacheStorage.
//
// A future change that adds API caching "just for GETs" would look reasonable in
// review and break chat in a way that is hard to trace back. Hence this file.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ORIGIN = "https://pythia.cyou";

/** Load sw.js into a stub ServiceWorkerGlobalScope and return its listeners. */
function loadWorker() {
  const handlers = {};
  const cacheStub = {
    match: async () => undefined,
    put: () => {},
    add: async () => {},
    keys: async () => []
  };
  const ctx = {
    self: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      location: { origin: ORIGIN },
      skipWaiting: async () => {},
      clients: { claim: async () => {} }
    },
    caches: { open: async () => cacheStub, keys: async () => [], delete: async () => {} },
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    Request: class { constructor(url) { this.url = url; } },
    Response: class { constructor(body, init) { this.body = body; Object.assign(this, init); } },
    URL,
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8"), ctx);
  return handlers;
}

/** Did the worker take over this request? */
function intercepts(handlers, url, { mode = "no-cors", method = "GET" } = {}) {
  let responded = false;
  handlers.fetch({
    request: { url, method, mode },
    respondWith: () => { responded = true; }
  });
  return responded;
}

test("the worker registers install, activate and fetch listeners", () => {
  const h = loadWorker();
  for (const type of ["install", "activate", "fetch"]) {
    assert.strictEqual(typeof h[type], "function", `missing ${type} listener`);
  }
});

test("/api/ is never intercepted — SSE and auth must reach the network untouched", () => {
  const h = loadWorker();
  for (const p of ["/api/chat", "/api/auth/me", "/api/conversations", "/api/friends",
    "/api/streak", "/api/geocode?q=delhi"]) {
    assert.strictEqual(intercepts(h, ORIGIN + p), false, `${p} must fall through`);
  }
});

test("the health probe is never served from cache", () => {
  const h = loadWorker();
  assert.strictEqual(intercepts(h, ORIGIN + "/healthz"), false);
});

test("navigations and static assets are handled", () => {
  const h = loadWorker();
  assert.strictEqual(intercepts(h, ORIGIN + "/app", { mode: "navigate" }), true);
  assert.strictEqual(intercepts(h, ORIGIN + "/i/abc123", { mode: "navigate" }), true);
  for (const p of ["/app.js", "/styles.css", "/vendor/purify.min.js", "/cosmos-bg.webp"]) {
    assert.strictEqual(intercepts(h, ORIGIN + p), true, `${p} should be served from the shell`);
  }
});

test("cross-origin requests are left alone", () => {
  const h = loadWorker();
  // Caching these yields opaque responses that can't be validated or evicted
  // meaningfully; offline they degrade to a system font, which is acceptable.
  assert.strictEqual(intercepts(h, "https://fonts.gstatic.com/s/lora/x.woff2"), false);
  assert.strictEqual(intercepts(h, "https://fonts.googleapis.com/css2?family=Lora"), false);
});

test("non-GET requests are left alone", () => {
  const h = loadWorker();
  assert.strictEqual(intercepts(h, ORIGIN + "/app.js", { method: "POST" }), false);
  assert.strictEqual(intercepts(h, ORIGIN + "/app", { method: "POST", mode: "navigate" }), false);
});

test("every precached path exists on disk", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
  const body = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1];
  const urls = body.replace(/\/\/.*/g, "").match(/"([^"]+)"/g).map(s => s.slice(1, -1));
  // The two extensionless entries are Express routes, not files on disk.
  const routes = { "/": "index.html", "/app": "app.html" };
  const pub = path.join(__dirname, "..", "public");
  const missing = urls.filter(u => !fs.existsSync(path.join(pub, routes[u] || u.replace(/^\//, ""))));
  assert.deepStrictEqual(missing, [], "precached paths with no file would silently break offline");
  assert.ok(urls.length >= 15, `expected a full shell, got ${urls.length} entries`);
});
