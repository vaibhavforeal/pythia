// End-to-end tests for POST /api/streak. Boots the real server against a
// throwaway DATA_DIR (JSON backend), so this covers the route, the auth gate
// and the store round trip together. Run with `npm test`.
//
// Note: the endpoint derives "today" from the client's tzOffsetMinutes and
// ignores any claimed date, so the clock cannot be walked forward through the
// API at all. Multi-day runs are therefore set up by seeding users.json and
// then checking in — which is also what happens between real sessions.
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

// The endpoint derives "today" from tzOffsetMinutes, so the tests run at UTC
// (offset 0) and anchor on the server's UTC date. Dates are DD-MM-YYYY.
const OFFSET = 0;
const utcDay = n => {
  const d = new Date(Date.now() + n * 86400000);
  const p = x => String(x).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
};
const TODAY = utcDay(0);
// Every check-in must carry the offset; the date is no longer client-chosen.
const checkIn = (extra = {}) => ({ tzOffsetMinutes: OFFSET, ...extra });

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
  const r = await api("POST", "/api/streak", checkIn());
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
  const { json } = await api("POST", "/api/streak", checkIn());
  assert.strictEqual(json.current, 1);
  assert.strictEqual(json.isNewDay, true);
  assert.strictEqual(json.nextMilestone, 3);
});

test("a second check-in the same day is idempotent", async () => {
  const { json } = await api("POST", "/api/streak", checkIn());
  assert.strictEqual(json.current, 1);
  assert.strictEqual(json.isNewDay, false);
});

test("checking in the day after continues the run and persists", async () => {
  seedStreak({ current: 4, longest: 9, last: utcDay(-1), days: 20 });
  const { json } = await api("POST", "/api/streak", checkIn());
  assert.strictEqual(json.current, 5);
  assert.strictEqual(json.longest, 9, "an ongoing run shouldn't touch the record");
  assert.strictEqual(json.days, 21);
  assert.strictEqual(readUser().streak.current, 5, "must survive the round trip to disk");
  assert.strictEqual(readUser().streak.last, TODAY);
});

test("a gap resets the run but keeps the record", async () => {
  seedStreak({ current: 30, longest: 30, last: utcDay(-3), days: 60 });
  const { json } = await api("POST", "/api/streak", checkIn());
  assert.strictEqual(json.current, 1);
  assert.strictEqual(json.longest, 30);
});

test("beating the record raises longest and flags the milestone", async () => {
  seedStreak({ current: 6, longest: 6, last: utcDay(-1), days: 10 });
  const { json } = await api("POST", "/api/streak", checkIn());
  assert.strictEqual(json.current, 7);
  assert.strictEqual(json.longest, 7);
  assert.strictEqual(json.milestone, true);
  assert.strictEqual(json.nextMilestone, 14);
});

test("a forged date field is ignored entirely", async () => {
  const before = readUser().streak.current;
  // Every one of these would previously have moved the streak; the date is now
  // derived from the offset, so the field is inert whatever it says.
  for (const date of [utcDay(1), utcDay(-1), utcDay(3), "yesterday", "31-02-2026"]) {
    const { status, json } = await api("POST", "/api/streak", checkIn({ date }));
    assert.strictEqual(status, 200, `offset is valid, so ${JSON.stringify(date)} should not 400`);
    assert.strictEqual(json.isNewDay, false, `${JSON.stringify(date)} must not count as a new day`);
    assert.strictEqual(json.current, before, `${JSON.stringify(date)} must not move the streak`);
  }
  assert.strictEqual(readUser().streak.last, TODAY);
});

test("the walk-forward forgery is dead: three claims in one sitting stay at one day", async () => {
  seedStreak({ current: 0, longest: 0, last: null, days: 0 });
  // The old exploit: post D-1, then D, then D+1 without waiting a real day.
  const runs = [];
  for (const date of [utcDay(-1), utcDay(0), utcDay(1)]) {
    runs.push((await api("POST", "/api/streak", checkIn({ date }))).json);
  }
  assert.strictEqual(runs[0].current, 1, "the first check-in counts");
  assert.strictEqual(runs[1].current, 1, "the second must not advance");
  assert.strictEqual(runs[2].current, 1, "nor the third");
  assert.strictEqual(runs[2].milestone, false, "the 3-day milestone must not fire");
});

test("a missing or invalid offset is refused without touching the store", async () => {
  const before = readUser().streak.current;
  for (const off of [undefined, null, "330", 15 * 60, -13 * 60, NaN, {}]) {
    const body = off === undefined ? { date: TODAY } : { date: TODAY, tzOffsetMinutes: off };
    const r = await api("POST", "/api/streak", body);
    assert.strictEqual(r.status, 400, `should reject offset ${JSON.stringify(off)}`);
  }
  assert.strictEqual(readUser().streak.current, before);
});
