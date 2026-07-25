// End-to-end tests for POST /api/streak. Boots the real server against a
// throwaway DATA_DIR (JSON backend), so this covers the route, the auth gate
// and the store round trip together. Run with `npm test`.
//
// Note: the ±1-day plausibility guard means the clock can't be walked forward
// through the API, so multi-day runs are set up by seeding users.json and then
// checking in — which is also what actually happens between real sessions.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Derived from the pid so concurrent test files can't collide on a port.
const PORT = 39000 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-streak-test-"));
const USERS = path.join(DATA_DIR, "users.json");

let srv;
let serverLog = "";
let cookie = "";

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE, // same-origin check on mutating requests
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
  let json = null;
  try { json = await res.json(); } catch { /* not every response has a body */ }
  return { status: res.status, json };
}

// Anchor on the server's UTC date so "today" is plausible whatever hour the
// suite runs at (a local-midnight anchor makes today+1 a ±2 jump).
const utcDay = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const TODAY = utcDay(0);

const readUser = () => JSON.parse(fs.readFileSync(USERS, "utf8"))[0];
function seedStreak(s) {
  const all = JSON.parse(fs.readFileSync(USERS, "utf8"));
  all[0].streak = s;
  fs.writeFileSync(USERS, JSON.stringify(all, null, 2));
}

test.before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, SESSION_SECRET: "test-only-secret" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  srv.stdout.on("data", d => (serverLog += d));
  srv.stderr.on("data", d => (serverLog += d));

  for (let i = 0; i < 80; i++) {
    try {
      await fetch(BASE + "/healthz");
      return;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error("server never came up:\n" + serverLog);
});

test.after(() => {
  if (srv) srv.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("rejects anonymous check-ins", async () => {
  const r = await api("POST", "/api/streak", { date: TODAY });
  assert.strictEqual(r.status, 401);
});

test("registers a user for the rest of the suite", async () => {
  const r = await api("POST", "/api/auth/register", {
    email: "streaker@example.com",
    password: "correct-horse-battery"
  });
  assert.strictEqual(r.status, 200, serverLog.slice(-500));
});

test("first check-in returns a streak of 1", async () => {
  const { json } = await api("POST", "/api/streak", { date: TODAY });
  assert.strictEqual(json.current, 1);
  assert.strictEqual(json.isNewDay, true);
  assert.strictEqual(json.nextMilestone, 3);
});

test("a second check-in the same day is idempotent", async () => {
  const { json } = await api("POST", "/api/streak", { date: TODAY });
  assert.strictEqual(json.current, 1);
  assert.strictEqual(json.isNewDay, false);
});

test("checking in the day after continues the run and persists", async () => {
  seedStreak({ current: 4, longest: 9, last: utcDay(-1), days: 20 });
  const { json } = await api("POST", "/api/streak", { date: TODAY });
  assert.strictEqual(json.current, 5);
  assert.strictEqual(json.longest, 9, "an ongoing run shouldn't touch the record");
  assert.strictEqual(json.days, 21);
  assert.strictEqual(readUser().streak.current, 5, "must survive the round trip to disk");
  assert.strictEqual(readUser().streak.last, TODAY);
});

test("a gap resets the run but keeps the record", async () => {
  seedStreak({ current: 30, longest: 30, last: utcDay(-3), days: 60 });
  const { json } = await api("POST", "/api/streak", { date: TODAY });
  assert.strictEqual(json.current, 1);
  assert.strictEqual(json.longest, 30);
});

test("beating the record raises longest and flags the milestone", async () => {
  seedStreak({ current: 6, longest: 6, last: utcDay(-1), days: 10 });
  const { json } = await api("POST", "/api/streak", { date: TODAY });
  assert.strictEqual(json.current, 7);
  assert.strictEqual(json.longest, 7);
  assert.strictEqual(json.milestone, true);
  assert.strictEqual(json.nextMilestone, 14);
});

test("backdating cannot clobber a later check-in", async () => {
  const { json } = await api("POST", "/api/streak", { date: utcDay(-1) });
  assert.strictEqual(json.current, 7);
  assert.strictEqual(json.isNewDay, false);
  assert.strictEqual(readUser().streak.last, TODAY);
});

test("implausible and malformed dates are rejected without touching the store", async () => {
  const before = readUser().streak.current;
  for (const date of [utcDay(3), utcDay(-3), "yesterday", "2026-02-31", undefined]) {
    const r = await api("POST", "/api/streak", date === undefined ? {} : { date });
    assert.strictEqual(r.status, 400, `should reject ${JSON.stringify(date)}`);
  }
  assert.strictEqual(readUser().streak.current, before);
});
