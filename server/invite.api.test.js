// End-to-end tests for the invite flow against a real server on a throwaway
// DATA_DIR. The critical cases are the anonymous ones: the invitee has no
// session, so whatever these routes return is effectively public.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 38000 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-invite-test-"));

let srv, serverLog = "", cookie = "", token = "";

// The inviter's birth — every one of these values must stay server-side.
const INVITER_BIRTH = {
  name: "Vaibhav", year: 1995, month: 3, day: 14, hour: 9, minute: 20,
  lat: 28.6139, lon: 77.209, tz: 5.5
};
const GUEST_BIRTH = {
  name: "Priya", year: 1997, month: 11, day: 2, hour: 14, minute: 5,
  lat: 19.076, lon: 72.8777, tz: 5.5
};

async function api(method, url, body, opts = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(opts.anonymous ? {} : cookie ? { Cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length && !opts.anonymous) cookie = set.map(c => c.split(";")[0]).join("; ");
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

test.before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, SESSION_SECRET: "test-only-secret", ALLOW_EMAIL_SIGNUP: "true" },
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

test("minting an invite requires a session", async () => {
  const r = await api("POST", "/api/invites", INVITER_BIRTH, { anonymous: true });
  assert.strictEqual(r.status, 401);
});

test("a signed-in user mints a link", async () => {
  assert.strictEqual((await api("POST", "/api/auth/register", {
    email: "inviter@example.com", password: "correct-horse-battery"
  })).status, 200, serverLog.slice(-400));

  const r = await api("POST", "/api/invites", { ...INVITER_BIRTH, role: "groom" });
  assert.strictEqual(r.status, 200);
  assert.match(r.json.token, /^[A-Za-z0-9_-]{8,64}$/);
  assert.ok(Date.parse(r.json.expiresAt) > Date.now(), "should expire in the future");
  token = r.json.token;
});

test("an anonymous visitor sees the inviter's signs and nothing else", async () => {
  const r = await api("GET", `/api/invite/${token}`, undefined, { anonymous: true });
  assert.strictEqual(r.status, 200, "must work with no account — that's the whole loop");
  assert.strictEqual(r.json.inviter.name, "Vaibhav");
  assert.ok(r.json.inviter.moonSign, "signs are the personal hook");

  const blob = JSON.stringify(r.json);
  for (const secret of ["1995", "28.6139", "77.209", "birth"]) {
    assert.ok(!blob.includes(secret), `leaked ${secret} to an anonymous visitor`);
  }
});

test("unknown and malformed tokens 404 alike", async () => {
  for (const t of ["doesnotexist1", "../../etc/passwd", "short"]) {
    const r = await api("GET", `/api/invite/${encodeURIComponent(t)}`, undefined, { anonymous: true });
    assert.strictEqual(r.status, 404, `token ${t}`);
  }
});

test("an anonymous guest gets a real compatibility result", async () => {
  const r = await api("POST", `/api/invite/${token}/match`, GUEST_BIRTH, { anonymous: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.inviter.name, "Vaibhav");

  const m = r.json.match;
  assert.ok(Number.isFinite(m.total) && m.total >= 0 && m.total <= m.max, "a real Guna Milan score");
  assert.strictEqual(m.max, 36);
  assert.ok(m.verdict && m.verdict.band, "needs a band to render the card");
  assert.ok(Array.isArray(m.kutas) && m.kutas.length, "the breakdown is the substance");
  assert.ok(m.manglik, "manglik analysis should survive");
});

test("the match response never carries either full chart", async () => {
  const r = await api("POST", `/api/invite/${token}/match`, GUEST_BIRTH, { anonymous: true });
  assert.strictEqual(r.json.match.charts, undefined);
  const blob = JSON.stringify(r.json);
  for (const secret of ["1995", "28.6139", "77.209", "degInSignFmt", "julianDay"]) {
    assert.ok(!blob.includes(secret), `leaked ${secret} through the match response`);
  }
});

test("a garbage birth payload is rejected, not crashed on", async () => {
  for (const bad of [{}, { year: "abc" }, { ...GUEST_BIRTH, month: 13 }]) {
    const r = await api("POST", `/api/invite/${token}/match`, bad, { anonymous: true });
    assert.strictEqual(r.status, 400, JSON.stringify(bad));
  }
});

test("the inviter sees who checked — scores only, no birth details", async () => {
  const r = await api("GET", "/api/invites/responses");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.token, token);
  assert.ok(r.json.responses.length >= 2, "both anonymous checks should be recorded");

  const first = r.json.responses[0];
  assert.strictEqual(first.name, "Priya");
  assert.ok(Number.isFinite(first.total));
  assert.ok(first.band);
  const blob = JSON.stringify(r.json);
  for (const secret of ["1997", "19.076", "72.8777"]) {
    assert.ok(!blob.includes(secret), `stored the responder's ${secret} without an account`);
  }
});

test("responses are private to the inviter", async () => {
  const r = await api("GET", "/api/invites/responses", undefined, { anonymous: true });
  assert.strictEqual(r.status, 401);
});

test("re-minting replaces the old link rather than piling up", async () => {
  const r = await api("POST", "/api/invites", { ...INVITER_BIRTH, role: "groom" });
  assert.strictEqual(r.status, 200);
  assert.notStrictEqual(r.json.token, token, "a fresh token");
  const old = await api("GET", `/api/invite/${token}`, undefined, { anonymous: true });
  assert.strictEqual(old.status, 404, "the superseded link should stop working");
});

test("an expired invite reports itself as expired", async () => {
  // Age the stored invite past its TTL, the one thing the API can't do for us.
  const file = path.join(DATA_DIR, "invites.json");
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  all[all.length - 1].expiresAt = new Date(Date.now() - 1000).toISOString();
  const stale = all[all.length - 1].token;
  fs.writeFileSync(file, JSON.stringify(all, null, 2));

  const view = await api("GET", `/api/invite/${stale}`, undefined, { anonymous: true });
  assert.strictEqual(view.status, 410);
  const match = await api("POST", `/api/invite/${stale}/match`, GUEST_BIRTH, { anonymous: true });
  assert.strictEqual(match.status, 410);
});

test("the invite page is served at its short URL", async () => {
  const res = await fetch(`${BASE}/i/${token}`);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /<html/i);
  assert.ok(!html.includes("28.6139"), "the page itself must not embed birth data");
});
