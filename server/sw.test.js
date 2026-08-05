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
  const pub = path.join(__dirname, "..", "public");
  // The two extensionless entries are Express routes, not files on disk.
  const routes = { "/": "index.html", "/app": "app.html" };
  const missing = precachedUrls().filter(u => {
    const bare = u.split("?")[0]; // versioned assets carry ?<VERSION>
    return !fs.existsSync(path.join(pub, routes[bare] || bare.replace(/^\//, "")));
  });
  assert.deepStrictEqual(missing, [], "precached paths with no file would silently break offline");
  assert.ok(precachedUrls().length >= 15, `expected a full shell, got ${precachedUrls().length} entries`);
});

// --- Cache-busting: the thing that lets a release reach a stuck client -------
//
// A worker can only replace itself with the cooperation of the page already
// running, and that page is running the PREVIOUS release's JavaScript. When a
// release shipped that fixed the update path, it could not deliver itself: the
// old worker kept answering /app.js from its own cache.
//
// Versioned URLs break that deadlock without needing the old client to do
// anything. Navigations are network-first, so the HTML is always current; if
// that HTML asks for /app.js?v7, no previously-cached entry can match it, and
// staleWhileRevalidate falls through to the network on the FIRST load.
//
// The whole mechanism rests on the query in the HTML matching the worker's
// VERSION. Drift between them silently restores the old behaviour, so it is
// pinned here rather than left to whoever remembers.

function swSource() {
  return fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
}

function swVersion() {
  return swSource().match(/const VERSION = "([^"]+)"/)[1];
}

function precachedUrls() {
  const sw = swSource();
  const versioned = sw.match(/const VERSIONED = \[([\s\S]*?)\];/)[1]
    .replace(/\/\/.*/g, "").match(/"([^"]+)"/g).map(s => s.slice(1, -1));
  const rest = sw.match(/const UNVERSIONED = \[([\s\S]*?)\];/)[1]
    .replace(/\/\/.*/g, "").match(/"([^"]+)"/g).map(s => s.slice(1, -1));
  return [...rest, ...versioned.map(u => `${u}?${swVersion()}`)];
}

/**
 * Local js/css references in an HTML file, with whatever query they carry.
 * Vendor bundles are excluded deliberately: they are content-stable and are
 * precached unversioned, so busting them every release would only cost
 * bandwidth.
 */
function localAssetRefs(file) {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8");
  const refs = [];
  const re = /(?:src|href)="((?!https?:|\/\/)[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  return refs.filter(r => !r.startsWith("vendor/"));
}

for (const file of ["app.html", "index.html"]) {
  test(`${file} versions every local script and stylesheet`, () => {
    const v = swVersion();
    const unversioned = localAssetRefs(file).filter(r => !r.includes("?"));
    assert.deepStrictEqual(unversioned, [],
      "an unversioned asset can be answered from a previous release's cache");
    const wrong = localAssetRefs(file).filter(r => r.split("?")[1] !== v);
    assert.deepStrictEqual(wrong, [],
      `every asset query must equal the worker's VERSION (${v})`);
  });

  test(`${file}'s assets are all precached`, () => {
    // A versioned URL the worker never precached is a guaranteed network fetch
    // on every load, and a blank app offline.
    const precached = new Set(precachedUrls());
    const missing = localAssetRefs(file)
      .map(r => "/" + r.replace(/^\.?\//, ""))
      .filter(u => !precached.has(u));
    assert.deepStrictEqual(missing, [], "referenced but not precached");
  });
}
