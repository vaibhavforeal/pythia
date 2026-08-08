// The voice routes' refusals — every one of which runs BEFORE Azure is
// contacted, which is why this needs no credentials and costs nothing.
//
// Two things are being protected. The obvious one is the bill: a realtime
// session is metered in minutes and an idle open socket keeps billing, so every
// gate has to hold when the feature is off, when the caller isn't allowlisted,
// and when they've spent the day's budget.
//
// The less obvious one is that a refusal must not describe the machinery. These
// routes hold the Azure endpoint, the API key and a prompt containing the
// caller's entire birth chart; an error body that names any of them is a leak,
// and error paths are exactly where that tends to happen unnoticed.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 38700 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-voice-test-"));

let srv, serverLog = "", cookie = "";

async function api(method, url, body, opts = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(opts.anonymous ? {} : cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
  return { status: res.status, text: await res.text() };
}

test.before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: {
      ...process.env,
      PORT: String(PORT), DATA_DIR, SESSION_SECRET: "test-only-secret",
      ALLOW_EMAIL_SIGNUP: "true",
      // Deliberately ON, with credentials that would never work. Every
      // assertion here is about a gate that must refuse before any of this is
      // used — if one ever isn't, the test hangs on a real network call rather
      // than passing quietly.
      VOICE_ENABLED: "true",
      // The allowlist fails closed, so an unset one would refuse every request
      // here at the gate and quietly turn the assertions below into tests of
      // the allowlist. The star is the explicit "everyone". See
      // voice.allowlist.test.js for the gate itself.
      VOICE_ALLOWLIST: "*",
      VOICE_DEPLOYMENT: "test-deployment",
      AZURE_INFERENCE_ENDPOINT: "https://example.invalid/anthropic/v1/messages",
      AZURE_INFERENCE_KEY: "not-a-real-key-and-must-never-be-echoed",
      VOICE_MINUTES_PER_DAY: "2"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  srv.stdout.on("data", d => (serverLog += d));
  srv.stderr.on("data", d => (serverLog += d));
  for (let i = 0; i < 80; i++) {
    try { await fetch(BASE + "/healthz"); break; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  const reg = await api("POST", "/api/auth/register",
    { email: "voice@example.com", password: "correct-horse-battery" });
  if (reg.status !== 200) throw new Error(`register failed: ${reg.text}\n${serverLog}`);
});

test.after(() => {
  if (srv) srv.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

/** Nothing about the machinery may appear in a response body. */
function assertNoLeak(text, label) {
  for (const secret of [
    "not-a-real-key-and-must-never-be-echoed",  // the key
    "example.invalid",                          // the endpoint
    "services.ai.azure.com",
    "voice-live",
    "byom-foundry-anthropic-messages",          // the profile
    "instructions",
    "Lagna", "nakshatra", "Ashtakavarga",       // the chart
    "1860 266 2345"                             // the care protocol
  ]) {
    assert.ok(!text.includes(secret), `${label}: response leaked "${secret}" — ${text.slice(0, 200)}`);
  }
}

test("an anonymous caller gets 401, not a hint", async () => {
  const res = await api("POST", "/api/voice/session", { sdp: "v=0" }, { anonymous: true });
  assert.equal(res.status, 401);
  assertNoLeak(res.text, "anonymous");
});

test("a signed-in caller with no birth details saved is refused", async () => {
  // The chart is the guardrail. Without one there is nothing to bound what the
  // agent may say, so the call must not open at all — and the refusal has to
  // tell them what to do rather than reading as a fault.
  const res = await api("POST", "/api/voice/session", { sdp: "v=0" });
  assert.equal(res.status, 503, `expected 503, got ${res.status}: ${res.text}`);
  assert.match(res.text, /birth details/i);
  assertNoLeak(res.text, "no chart");
});

test("a missing offer is a 400 before anything else happens", async () => {
  for (const body of [{}, { sdp: "" }, { sdp: 42 }, { sdp: null }]) {
    const res = await api("POST", "/api/voice/session", body);
    assert.equal(res.status, 400, `body ${JSON.stringify(body)} -> ${res.status}`);
    assertNoLeak(res.text, "bad offer");
  }
});

test("a cross-origin call is refused by the existing origin check", async () => {
  // Voice adds no auth code of its own; it sits under the same /api gate as
  // everything else. This asserts that inheritance actually holds.
  const res = await api("POST", "/api/voice/session", { sdp: "v=0" },
    { headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 403);
  assertNoLeak(res.text, "cross-origin");
});

test("heartbeat and end refuse a session id that isn't yours", async () => {
  // Session ids are UUIDs, but ownership is still checked rather than assumed.
  const fake = "00000000-0000-4000-8000-000000000000";
  const beat = await api("POST", `/api/voice/session/${fake}/heartbeat`);
  assert.equal(beat.status, 404);
  assert.match(beat.text, /ended|gone/);
  assertNoLeak(beat.text, "heartbeat");

  // Ending something that isn't yours is a no-op, not an error — the client
  // fires this from beforeunload and must never see a failure on the way out.
  const end = await api("POST", `/api/voice/session/${fake}/end`);
  assert.equal(end.status, 200);
  assertNoLeak(end.text, "end");
});

test("a refused request never costs a minute", async () => {
  // Ordering, asserted rather than assumed. With the budget middleware in front
  // of validation, every 400 and 503 above spent a paid minute — and the only
  // reason it surfaced was that the next test started failing with 429s.
  //
  // VOICE_MINUTES_PER_DAY is 2 here. By this point the tests above have made
  // well over a dozen refused requests. If any of them charged, the budget is
  // long gone and the request below returns 429 instead of 503.
  const res = await api("POST", "/api/voice/session", { sdp: "v=0" });
  assert.notEqual(res.status, 429, "refused requests are being charged to the minute budget");
  assert.equal(res.status, 503, `expected the no-chart refusal, got ${res.status}: ${res.text}`);
});

test("the daily minute budget refuses with Retry-After", async () => {
  // Now with birth details saved, so the requests get past preflight and are
  // genuinely chargeable. VOICE_MINUTES_PER_DAY is 2, and each start charges
  // minute zero, so the third must be refused by the persistent meter — the cap
  // that survives the container spinning down, which is why it isn't a Map.
  //
  // The upstream endpoint is unreachable on purpose, so each start fails at
  // connect with a 502. That is fine: the meter runs before the connection, and
  // charging for a call that could not be established is the deliberate
  // trade-off — bounded by VOICE_STARTS_PER_HOUR.
  const saved = await api("POST", "/api/account/birth", {
    year: 2004, month: 6, day: 14, hour: 9, minute: 20,
    lat: 12.9716, lon: 77.5946, tz: 5.5, name: "Voice Test"
  });
  assert.equal(saved.status, 200, `could not save birth details: ${saved.text}`);

  let last;
  for (let i = 0; i < 5; i++) {
    last = await fetch(BASE + "/api/voice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE, Cookie: cookie },
      body: JSON.stringify({ sdp: "v=0" })
    });
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429, "the daily minute budget never engaged");
  assert.ok(last.headers.get("Retry-After"), "a 429 must say when to come back");
  assertNoLeak(await last.text(), "budget");
});
