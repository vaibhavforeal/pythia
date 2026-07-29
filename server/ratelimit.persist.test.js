// The daily rate limits have to survive a restart.
//
// Why this file exists: the limiter used to keep its counters in a Map. On a
// long-lived box that is invisible, but the app runs on a plan that spins down
// when idle, so "300 chat calls per day" quietly meant "300 per wake" — and the
// chat cap is the ceiling on a paid API. Anyone wanting a fresh budget only had
// to wait for the service to go to sleep.
//
// So the test that matters is not "does it count" but "does it still count
// after the process dies". Both servers below share one DATA_DIR, which is
// exactly what a redeploy looks like to the store.
//
// CHAT_RPD is set to 2 so the cap is reachable. The chat route needs no upstream
// credentials to prove the point: both limiters run as middleware ahead of the
// handler, so a 429 is decided before Azure is ever contacted.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 39900 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-rlp-test-"));
const LIMITS = path.join(DATA_DIR, "rate-limits.json");

let srv;
let cookie = "";
let serverLog = "";

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
  let json = null;
  try { json = await res.json(); } catch { /* SSE and 204s have no JSON body */ }
  return { status: res.status, json };
}

async function start() {
  srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR,
      SESSION_SECRET: "test-only-secret",
      CHAT_RPD: "2",
      // Blank, not absent. The child loads .env itself, and dotenv leaves keys
      // that are already present alone — so this is what stops the suite making
      // real, billable calls on a machine that has Azure configured. The route
      // then returns its "not configured" SSE frame, which is all this file
      // needs: the limiters run as middleware ahead of it either way.
      AZURE_INFERENCE_ENDPOINT: "",
      AZURE_INFERENCE_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  srv.stdout.on("data", d => (serverLog += d));
  srv.stderr.on("data", d => (serverLog += d));
  for (let i = 0; i < 80; i++) {
    try { await fetch(BASE + "/healthz"); return; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error("server never came up:\n" + serverLog);
}

async function stop() {
  if (!srv) return;
  const dead = new Promise(r => srv.on("exit", r));
  srv.kill();
  await dead;
  srv = null;
}

const chat = () => api("POST", "/api/chat", { messages: [{ role: "user", content: "hi" }] });

test.before(start);
test.after(async () => {
  await stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("the limiter is per user, so it needs an identity first", async () => {
  const r = await chat();
  assert.strictEqual(r.status, 401, "anonymous chat must not reach the limiter");
});

test("registers a user for the rest of the suite", async () => {
  const r = await api("POST", "/api/auth/register", {
    email: `rl_${process.pid}@example.com`, password: "correct-horse-battery"
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
});

test("requests under the cap are not blocked", async () => {
  for (let i = 1; i <= 2; i++) {
    const r = await chat();
    assert.notStrictEqual(r.status, 429, `call ${i} of 2 should be within the cap`);
  }
});

test("the request past the cap is refused, with Retry-After", async () => {
  const res = await fetch(BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Cookie: cookie },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] })
  });
  assert.strictEqual(res.status, 429);
  const retry = Number(res.headers.get("retry-after"));
  assert.ok(retry > 0, `Retry-After should be a positive number of seconds, got ${retry}`);
  // A 24h window, so the hint should be most of a day away rather than seconds.
  assert.ok(retry > 60 * 60, `expected a long window, got ${retry}s`);
});

test("the counter is on disk, not just in memory", async () => {
  const rows = JSON.parse(fs.readFileSync(LIMITS, "utf8"));
  const row = rows.find(r => r.bucket.startsWith("chat-daily:"));
  assert.ok(row, `no chat-daily row persisted; got ${JSON.stringify(rows)}`);
  assert.ok(row.count >= 3, `expected the over-cap attempt to be counted, got ${row.count}`);
  assert.ok(row.resetAt > Date.now(), "the window should still be open");
});

// The whole point. Before this change the restart handed back a clean budget.
test("a restart does NOT reset the daily budget", async () => {
  await stop();
  await start();
  const r = await chat();
  assert.strictEqual(r.status, 429, "the cap must still apply to a freshly started process");
});

test("a lapsed window starts a new budget", async () => {
  await stop();
  // Expire the window by hand rather than waiting 24h; this is the same row the
  // running server will read back on the next request.
  const rows = JSON.parse(fs.readFileSync(LIMITS, "utf8"));
  for (const r of rows) r.resetAt = Date.now() - 1000;
  fs.writeFileSync(LIMITS, JSON.stringify(rows, null, 2));
  await start();
  const r = await chat();
  assert.notStrictEqual(r.status, 429, "an expired window should allow requests again");
});
