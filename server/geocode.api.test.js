// City lookup has to work for someone with no account.
//
// The invite flow's whole premise is that a friend opens a link, types their
// birth details and gets a compatibility score without signing up. But city
// search goes through /api/geocode, and every /api route except auth, invite
// and cron sits behind requireAuth — so the invitee got a 401 the moment they
// typed a city.
//
// It failed silently, which is why it took a person testing the flow to catch
// it: geocode.js reads `data.results || []` off the response, and a 401 body
// has no `results`, so the datalist simply stayed empty. No error, no console
// warning, just a city box that never suggests anything.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 38900 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-geocode-test-"));

let srv, serverLog = "";

test.before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, SESSION_SECRET: "test-only-secret" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  srv.stdout.on("data", d => (serverLog += d));
  srv.stderr.on("data", d => (serverLog += d));
  for (let i = 0; i < 80; i++) {
    try { await fetch(BASE + "/healthz"); return; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error("server never came up:\n" + serverLog);
});

test.after(() => {
  if (srv) srv.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("an anonymous visitor can search for a city", async () => {
  // No cookie, no bearer — exactly what someone opening an invite link has.
  const res = await fetch(`${BASE}/api/geocode?q=Bangalore`);
  assert.equal(res.status, 200, "the invitee cannot sign in to look up their own birthplace");
  const data = await res.json();
  assert.ok(Array.isArray(data.results), "results must be an array, not an error body");
  assert.ok(data.results.length > 0, "a well-known city must return at least one option");
  const first = data.results[0];
  for (const field of ["name", "lat", "lon"]) {
    assert.ok(first[field] !== undefined, `a result needs ${field} to place a chart`);
  }
});

test("the builtin fallback also answers anonymously", async () => {
  // The handler falls back to a bundled city list when the upstream geocoder is
  // slow or down. That path must be public too, or the flow breaks precisely
  // when the network is worst.
  const res = await fetch(`${BASE}/api/geocode?q=Mumbai`);
  assert.equal(res.status, 200);
  const data = await res.json();
  // "merged" is the normal case for a curated city, "builtin" when upstream is
  // unreachable, "open-meteo" for anywhere not in the curated list.
  assert.ok(["merged", "open-meteo", "builtin"].includes(data.source), `unexpected source: ${data.source}`);
  assert.ok(data.results.length > 0);
});

test("a too-short query is answered, not rejected", async () => {
  const res = await fetch(`${BASE}/api/geocode?q=a`);
  assert.equal(res.status, 200);
  assert.deepStrictEqual((await res.json()).results, []);
});

// --- Names people actually type -------------------------------------------
//
// The upstream geocoder indexes official names. Half of India's cities were
// renamed within living memory and most people still type the old spelling, so
// "Bangalore" returned exactly one result — Bangalore Town, Sindh, Pakistan —
// and the city of eight million was absent. The builtin list only ran when
// upstream returned NOTHING, so one wrong hit was enough to suppress it.
//
// These do not depend on the network: the builtin matches are merged in and
// ranked first, so they hold even when open-meteo is unreachable.

const label = r => [r.name, r.admin1, r.country].filter(Boolean).join(", ");

test("the old name and the new name both find the city", async () => {
  for (const [typed, expect] of [
    ["Bangalore", /Bengaluru/i],
    ["Bengaluru", /Bengaluru/i],
    ["Shimoga", /Shivamogga/i],
    ["Shivamogga", /Shivamogga/i],
    ["Bombay", /Mumbai/i],
    ["Madras", /Chennai/i],
    ["Calcutta", /Kolkata/i],
    ["Mysore", /Mysuru/i]
  ]) {
    const res = await fetch(`${BASE}/api/geocode?q=${encodeURIComponent(typed)}`);
    const { results } = await res.json();
    assert.ok(results.some(r => expect.test(label(r))),
      `typing "${typed}" must offer ${expect} — got: ${results.map(label).join(" | ") || "nothing"}`);
  }
});

test("a curated match outranks a far-away namesake", async () => {
  // The whole point: someone in Karnataka typing their own city should not have
  // to scroll past a town in Sindh, or miss it entirely.
  const res = await fetch(`${BASE}/api/geocode?q=Bangalore`);
  const { results } = await res.json();
  assert.match(label(results[0]), /Bengaluru/i,
    `first suggestion was "${label(results[0])}"`);
});

test("the label carries both names, so the old one is recognisable", async () => {
  const res = await fetch(`${BASE}/api/geocode?q=Shimoga`);
  const { results } = await res.json();
  const hit = results.find(r => /Shivamogga/i.test(label(r)));
  assert.match(label(hit), /Shimoga/i,
    "someone who typed Shimoga needs to see Shimoga in the option they are picking");
});

test("an alias does not produce a duplicate of the same city", async () => {
  const res = await fetch(`${BASE}/api/geocode?q=Bengaluru`);
  const { results } = await res.json();
  const blr = results.filter(r => /Bengaluru/i.test(label(r)));
  assert.equal(blr.length, 1, `one entry per city — got ${blr.map(label).join(" | ")}`);
});

test("opening it up did not open up the rest of the API", async () => {
  // The fix widens a deliberately narrow allowlist, so this pins the boundary:
  // geocode is public, its neighbours are not.
  for (const url of ["/api/account", "/api/people", "/api/conversations"]) {
    const res = await fetch(BASE + url);
    assert.equal(res.status, 401, `${url} must still require a session`);
  }
});
