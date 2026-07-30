// Device registration and the daily send, end to end.
//
// PUSH_PROVIDER=console prints instead of calling FCM (and refuses to run in
// production), so the whole loop is exercisable without Firebase credentials.
// PUSH_HOUR_LOCAL is pinned to the current UTC hour so a device on offset 0 is
// "due" right now — otherwise this would only pass at 8am.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 30000 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-push-"));
const CRON_SECRET = "cron-secret-for-tests";
const SEND_HOUR = new Date().getUTCHours();

let srv, log = "", cookie = "", seq = 0;
const DEVICE = "d".repeat(64);

async function api(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      "CF-Connecting-IP": `198.51.100.${(seq++ % 250) + 1}`,
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
  return { status: res.status, json: await res.json().catch(() => null) };
}

const devices = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, "devices.json"), "utf8"));

test.before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR, SESSION_SECRET: "test-only-secret", ALLOW_EMAIL_SIGNUP: "true",
      NODE_ENV: "test", PUSH_PROVIDER: "console", CRON_SECRET,
      PUSH_HOUR_LOCAL: String(SEND_HOUR)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  srv.stdout.on("data", d => (log += d));
  srv.stderr.on("data", d => (log += d));
  for (let i = 0; i < 80; i++) {
    try { await fetch(BASE + "/healthz"); return; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error("server never came up:\n" + log);
});

test.after(() => {
  if (srv) srv.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("registering a device needs a session", async () => {
  const res = await fetch(BASE + "/api/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ token: DEVICE })
  });
  assert.strictEqual(res.status, 401);
});

test("a signed-in user registers a device with its own timezone", async () => {
  assert.strictEqual((await api("POST", "/api/auth/register",
    { email: "push@example.com", password: "correct-horse-battery" })).status, 200);
  await api("POST", "/api/account/birth",
    { name: "Asha", year: 1995, month: 3, day: 14, hour: 9, minute: 20, lat: 28.6139, lon: 77.209, tz: 5.5 });

  const r = await api("POST", "/api/devices", { token: DEVICE, platform: "android", tzOffsetMinutes: 0 });
  assert.strictEqual(r.status, 200);

  const d = devices()[0];
  assert.strictEqual(d.token, DEVICE);
  assert.strictEqual(d.platform, "android");
  assert.strictEqual(d.tzOffsetMinutes, 0);
  assert.strictEqual(d.lastSentAt, null, "nothing sent yet");
});

test("junk tokens and absurd offsets are rejected or clamped", async () => {
  assert.strictEqual((await api("POST", "/api/devices", { token: "short" })).status, 400);
  assert.strictEqual((await api("POST", "/api/devices", { token: "" })).status, 400);

  await api("POST", "/api/devices", { token: "e".repeat(64), tzOffsetMinutes: 99999 });
  const odd = devices().find(d => d.token.startsWith("e"));
  assert.ok(Math.abs(odd.tzOffsetMinutes) <= 840, `offset not clamped: ${odd.tzOffsetMinutes}`);
});

test("the cron endpoint refuses without the right secret", async () => {
  assert.strictEqual((await api("POST", "/api/cron/daily-push")).status, 403);
  assert.strictEqual((await api("POST", "/api/cron/daily-push", undefined,
    { "X-Cron-Secret": "wrong" })).status, 403);
  assert.strictEqual((await api("POST", "/api/cron/daily-push", undefined,
    { "X-Cron-Secret": CRON_SECRET + "x" })).status, 403, "length mismatch must not throw");
});

test("the daily run sends to a device whose local hour has come", async () => {
  const before = log.length;
  const r = await api("POST", "/api/cron/daily-push", undefined, { "X-Cron-Secret": CRON_SECRET });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.sent >= 1, `nothing sent: ${JSON.stringify(r.json)}`);

  // The console provider prints what would have gone out — check it's real copy.
  const printed = log.slice(before);
  assert.match(printed, /🔔/, "the provider should have printed a notification");
  assert.ok(!/undefined|NaN/.test(printed), `broken copy: ${printed.slice(0, 200)}`);

  const d = devices().find(x => x.token === DEVICE);
  assert.ok(d.lastSentAt, "the send should be recorded");
});

test("running again the same day sends nothing", async () => {
  const r = await api("POST", "/api/cron/daily-push", undefined, { "X-Cron-Secret": CRON_SECRET });
  assert.strictEqual(r.json.sent, 0, "a scheduler firing twice must not double-notify");
  assert.ok(r.json.skipped >= 1);
});

test("a device in another timezone isn't woken", async () => {
  // Twelve hours out from the send hour: nowhere near their morning.
  await api("POST", "/api/devices", { token: "f".repeat(64), tzOffsetMinutes: 720 });
  const r = await api("POST", "/api/cron/daily-push", undefined, { "X-Cron-Secret": CRON_SECRET });
  const woken = devices().find(x => x.token.startsWith("f"));
  assert.strictEqual(woken.lastSentAt, null, `sent at the wrong local hour: ${JSON.stringify(r.json)}`);
});

test("a user with no birth details is skipped, not crashed on", async () => {
  cookie = "";
  await api("POST", "/api/auth/register", { email: "nobirth@example.com", password: "correct-horse-battery" });
  await api("POST", "/api/devices", { token: "g".repeat(64), tzOffsetMinutes: 0 });
  const r = await api("POST", "/api/cron/daily-push", undefined, { "X-Cron-Secret": CRON_SECRET });
  assert.strictEqual(r.status, 200, "one unusable user must not fail the whole run");
  const d = devices().find(x => x.token.startsWith("g"));
  assert.strictEqual(d.lastSentAt, null);
});

test("you can only delete your own device", async () => {
  assert.strictEqual((await api("DELETE", `/api/devices/${DEVICE}`)).status, 404,
    "this session belongs to the other account");

  cookie = "";
  await api("POST", "/api/auth/login", { identifier: "push@example.com", password: "correct-horse-battery" });
  assert.strictEqual((await api("DELETE", `/api/devices/${DEVICE}`)).status, 200);
  assert.ok(!devices().some(d => d.token === DEVICE), "logging out should really forget the device");
});
