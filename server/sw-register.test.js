// Update handover in the client registration script (public/sw-register.js).
//
// The bug these tests exist for: a shipped change did not reach installed PWAs.
// sw.js was correct — it precaches with cache:"reload", calls skipWaiting(), and
// deletes the previous shell on activate. But the page that is already open is
// still running the JavaScript it loaded before any of that happened, and
// nothing told it to reload. clients.claim() changes who serves the next
// request; it does not re-execute the current page.
//
// So a PWA that gets backgrounded and resumed rather than freshly navigated can
// sit on a stale shell indefinitely, and every future release inherits the same
// problem.
//
// The rule: when a NEW worker takes over a page that already had one, reload
// once. Not on first install — there is nothing stale to replace then, and
// reloading would cost every first-time visitor a second load.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "sw-register.js"), "utf8");

/** Run sw-register.js against a stub browser and expose what it wired up. */
function loadRegister({ hasController = false, native = false } = {}) {
  const on = { window: {}, sw: {}, document: {} };
  const state = { reloads: 0, updateCalls: 0 };
  // update() returns a Promise per the spec, and the caller relies on that.
  const registration = { update: () => { state.updateCalls++; return Promise.resolve(); } };

  const el = () => ({
    classList: { add() {}, remove() {} },
    addEventListener() {},
    appendChild() {},
    querySelector: () => ({ addEventListener() {} }),
    setAttribute() {},
    remove() {},
    offsetWidth: 0
  });

  const ctx = {
    navigator: {
      serviceWorker: {
        controller: hasController ? {} : null,
        register: () => Promise.resolve(registration),
        addEventListener: (t, fn) => { (on.sw[t] ||= []).push(fn); },
        ready: Promise.resolve(registration)
      },
      onLine: true,
      userAgent: "node-test",
      standalone: false
    },
    document: {
      readyState: "complete",
      visibilityState: "visible",
      referrer: "",
      addEventListener: (t, fn) => { (on.document[t] ||= []).push(fn); },
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: el,
      body: { appendChild() {} }
    },
    location: { reload: () => { state.reloads++; } },
    console: { warn() {} }
  };
  ctx.window = {
    addEventListener: (t, fn) => { (on.window[t] ||= []).push(fn); },
    matchMedia: () => ({ matches: false }),
    PythiaAuth: native ? { native: true } : undefined,
    location: ctx.location
  };
  ctx.self = ctx.window;
  ctx.globalThis = ctx;

  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);

  return {
    fireWindow: t => (on.window[t] || []).forEach(fn => fn()),
    fireSW: t => (on.sw[t] || []).forEach(fn => fn()),
    fireDocument: t => (on.document[t] || []).forEach(fn => fn()),
    swListeners: () => Object.keys(on.sw),
    reloads: () => state.reloads,
    updateCalls: () => state.updateCalls
  };
}

test("it listens for a worker takeover", () => {
  const r = loadRegister({ hasController: true });
  assert.ok(r.swListeners().includes("controllerchange"),
    "without this, a new worker serves the next load but never the current page");
});

test("a takeover on a page that already had a worker reloads it once", () => {
  const r = loadRegister({ hasController: true });
  r.fireSW("controllerchange");
  assert.equal(r.reloads(), 1, "the stale page must be replaced");
});

test("repeated takeovers never reload more than once", () => {
  // A reload loop is a worse failure than a stale shell: the app becomes
  // unusable rather than merely out of date.
  const r = loadRegister({ hasController: true });
  r.fireSW("controllerchange");
  r.fireSW("controllerchange");
  r.fireSW("controllerchange");
  assert.equal(r.reloads(), 1);
});

test("the first install does not reload", () => {
  // No previous controller means nothing stale is on screen. Reloading here
  // would cost every first-time visitor an extra round trip for nothing.
  const r = loadRegister({ hasController: false });
  r.fireSW("controllerchange");
  assert.equal(r.reloads(), 0);
});

test("returning to the app checks for a new worker", async () => {
  // The other half of the same problem. A takeover only helps if a takeover
  // happens: the browser checks sw.js on navigation, and an installed PWA that
  // is resumed from the background rather than navigated may not navigate for
  // days. Asking for an update check when the app becomes visible is what makes
  // a release land in hours rather than whenever the user happens to cold-start.
  const r = loadRegister({ hasController: true });
  r.fireWindow("load");
  await new Promise(resolve => setImmediate(resolve)); // register() resolves
  const before = r.updateCalls();
  r.fireDocument("visibilitychange");
  assert.ok(r.updateCalls() > before, "a resumed app must ask whether it is stale");
});

test("the native shell registers nothing at all", () => {
  // Capacitor serves assets locally; a worker there is unnecessary and can
  // interfere. Guarding this so the reload path can never fire in the app.
  const r = loadRegister({ native: true, hasController: true });
  assert.equal(r.swListeners().length, 0);
  r.fireSW("controllerchange");
  assert.equal(r.reloads(), 0);
});
