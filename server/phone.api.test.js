// End-to-end phone signup, OTP and Soul ID against a real server.
// SMS_PROVIDER=console prints the code to stdout, which this harness scrapes —
// that provider refuses to run in production, so this can't leak anywhere real.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 37000 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-phone-test-"));

let srv, log = "", cookie = "";
const PHONE = "+919876500001";

// The IP rate limiter allows 12 attempts per 15 minutes per address, and every
// request here would otherwise come from 127.0.0.1 — the suite would trip it
// and test the limiter instead of the OTP logic. Each call gets its own
// client address; the per-number cooldown and daily cap still apply, and those
// are the limits these tests are actually about.
let clientSeq = 0;
async function api(method, url, body, opts = {}) {
  const ip = opts.ip || `203.0.113.${(clientSeq++ % 250) + 1}`;
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      "X-Forwarded-For": ip,
      ...(opts.anonymous ? {} : cookie ? { Cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  // `anonymous` means "send no session", not "ignore the one we're given" —
  // registering is anonymous going in but hands back the session we then use.
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

/** Drop any pending OTP row, so a test can request a fresh code without
    waiting out the (deliberate, 60s) resend cooldown. */
function clearOtps() {
  fs.writeFileSync(path.join(DATA_DIR, "otps.json"), "[]");
}

/** Ask for a code and scrape it out of the console provider's output. */
async function requestCode(number) {
  const before = log.length;
  const r = await api("POST", "/api/auth/otp/request", { phone: number }, { anonymous: true });
  for (let i = 0; i < 40 && !/OTP for .*: \d{6}/.test(log.slice(before)); i++) {
    await new Promise(res => setTimeout(res, 50));
  }
  const m = log.slice(before).match(/OTP for (\S+): (\d{6})/);
  return { res: r, code: m && m[2] };
}

test.before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR,
      SESSION_SECRET: "test-only-secret", ALLOW_EMAIL_SIGNUP: "true", OTP_SECRET: "test-otp-secret",
      SMS_PROVIDER: "console", NODE_ENV: "test"
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

test("providers endpoint advertises phone sign-in", async () => {
  const r = await api("GET", "/api/auth/providers", undefined, { anonymous: true });
  assert.strictEqual(r.json.phone, true);
  assert.strictEqual(r.json.requirePhone, false, "must default off so live signup can't break");
});

test("a code is sent and the response never contains it", async () => {
  const { res, code } = await requestCode(PHONE);
  assert.strictEqual(res.status, 200);
  assert.ok(code, "console provider should have printed a code");
  assert.ok(!JSON.stringify(res.json).includes(code), "the API must not echo the code back");
  assert.ok(!res.json.to.includes("9876500001"), `masked number leaked: ${res.json.to}`);
});

test("malformed numbers are rejected before any send", async () => {
  for (const bad of ["", "abc", "12", "+911123456789"]) {
    const r = await api("POST", "/api/auth/otp/request", { phone: bad }, { anonymous: true });
    assert.strictEqual(r.status, 400, `should reject ${JSON.stringify(bad)}`);
  }
});

test("resending immediately is rate limited", async () => {
  const r = await api("POST", "/api/auth/otp/request", { phone: PHONE }, { anonymous: true });
  assert.strictEqual(r.status, 429);
  assert.ok(r.json.retryAfter > 0);
});

test("a wrong code is refused and burns an attempt", async () => {
  const r = await api("POST", "/api/auth/phone/register",
    { phone: PHONE, code: "000000", password: "correct-horse-battery" }, { anonymous: true });
  assert.strictEqual(r.status, 400);
  assert.ok(r.json.attemptsLeft < 5, `attempts should decrease, got ${r.json.attemptsLeft}`);
});

test("a short password is refused before the code is consumed", async () => {
  const r = await api("POST", "/api/auth/phone/register",
    { phone: PHONE, code: "123456", password: "short" }, { anonymous: true });
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error, /8 characters/);
});

let soulId = null;

test("the right code creates an account with a Soul ID", async () => {
  clearOtps(); // a fresh code, without waiting out the 60s resend cooldown
  const { code } = await requestCode(PHONE);
  assert.ok(code);

  const r = await api("POST", "/api/auth/phone/register",
    { phone: PHONE, code, password: "correct-horse-battery" }, { anonymous: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.user.soulId, /^[a-z]+-[a-z]+-\d{3}$/);
  assert.ok(!JSON.stringify(r.json).includes("9876500001"), "full number must not come back");
  soulId = r.json.user.soulId;
});

test("a consumed code cannot be replayed", async () => {
  const r = await api("POST", "/api/auth/phone/register",
    { phone: PHONE, code: "123456", password: "correct-horse-battery" }, { anonymous: true });
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error, /Ask for a code first|isn't right/);
});

test("the account reports its Soul ID and a masked number", async () => {
  const r = await api("GET", "/api/account");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.soulId, soulId, "Soul ID must be frozen, not regenerated");
  assert.strictEqual(r.json.phoneVerified, true);
  assert.ok(r.json.phone.includes("•"), "phone should be masked");
  assert.ok(!r.json.phone.includes("9876500001"));
});

test("login works with the phone number, in any format", async () => {
  for (const form of ["+919876500001", "9876500001", "09876500001", "+91 98765 00001"]) {
    cookie = "";
    const r = await api("POST", "/api/auth/login", { identifier: form, password: "correct-horse-battery" });
    assert.strictEqual(r.status, 200, `login failed for ${form}: ${JSON.stringify(r.json)}`);
  }
});

test("a wrong password still fails", async () => {
  cookie = "";
  const r = await api("POST", "/api/auth/login", { identifier: PHONE, password: "not-the-password" });
  assert.strictEqual(r.status, 401);
});

test("one number cannot become two accounts", async () => {
  clearOtps();
  const { code } = await requestCode("09876500001"); // same human, different formatting
  const r = await api("POST", "/api/auth/phone/register",
    { phone: "09876500001", code, password: "correct-horse-battery" }, { anonymous: true });
  assert.strictEqual(r.status, 409, "should recognise the existing account");
});

test("an email/Google account can attach a phone and get a Soul ID", async () => {
  cookie = "";
  assert.strictEqual((await api("POST", "/api/auth/register", {
    email: "legacy@example.com", password: "correct-horse-battery"
  })).status, 200);

  const before = await api("GET", "/api/account");
  assert.strictEqual(before.json.soulId, null, "no Soul ID until a number is verified");

  const other = "+919876500002";
  const { code } = await requestCode(other);
  const r = await api("POST", "/api/account/phone", { phone: other, code });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.soulId, /^[a-z]+-[a-z]+-\d{3}$/);

  const after = await api("GET", "/api/account");
  assert.strictEqual(after.json.soulId, r.json.soulId);
  assert.notStrictEqual(after.json.soulId, soulId, "two accounts must not share a Soul ID");
});

test("a number already on another account is refused", async () => {
  clearOtps();
  const { code } = await requestCode(PHONE); // belongs to the first account
  const r = await api("POST", "/api/account/phone", { phone: PHONE, code });
  assert.strictEqual(r.status, 409);
});

test("email can be attached to the phone-first account", async () => {
  const r = await api("POST", "/api/account/email", { email: "added@example.com" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await api("GET", "/api/account")).json.email, "added@example.com");
});

test("stored OTP rows never contain a usable code", () => {
  const otps = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "otps.json"), "utf8"));
  for (const rec of otps) {
    assert.strictEqual(rec.hash.length, 64, "should be an HMAC, not a code");
    assert.ok(!("code" in rec), "plaintext code must never be persisted");
  }
});
