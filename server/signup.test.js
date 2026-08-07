// Unverified email sign-up is closed by default.
//
// Every other API test in this repo passes ALLOW_EMAIL_SIGNUP: "true" so it can
// mint fixtures, which means none of them would notice if the guard were
// deleted. This file is the one that runs WITHOUT the flag and asserts the
// production default.
//
// What the guard is for: registration never proved the person owned the address
// — it checked the format and that it was unused, then issued a session. So
// anyone could claim anyone else's address, and after the Google-linking fix
// that became permanent, since the real owner's later Google sign-in is refused
// with email_taken. The same hole also let anyone mint chat budget, because an
// unverified account can use the one endpoint that costs money.
//
// Login is deliberately NOT gated: existing password accounts must keep working.
// That asymmetry is the whole design, so it is asserted here too.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 39100 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-signup-test-"));

let srv;
let log = "";

/** Boot the server with the given extra env; no ALLOW_EMAIL_SIGNUP by default. */
async function start(extra = {}) {
  srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR,
      SESSION_SECRET: "test-only-secret",
      NODE_ENV: "test",
      // Explicitly cleared, not merely omitted. index.js loads .env through
      // dotenv, so a developer who set ALLOW_EMAIL_SIGNUP=true locally — an
      // ordinary thing to do, since email signup is off by default and you
      // cannot otherwise make a test account — would inherit it here and see
      // the "refused by default" tests fail with nothing to connect it to.
      ALLOW_EMAIL_SIGNUP: "",
      ...extra
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  srv.stdout.on("data", d => (log += d));
  srv.stderr.on("data", d => (log += d));
  for (let i = 0; i < 80; i++) {
    try { await fetch(BASE + "/healthz"); return; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error("server never came up:\n" + log);
}

async function stop() {
  if (!srv) return;
  const dead = new Promise(r => srv.on("exit", r));
  srv.kill();
  await dead;
  srv = null;
}

async function post(url, body) {
  const res = await fetch(BASE + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { /* some responses carry no body */ }
  return { status: res.status, json };
}

test.after(() => { fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

test("with no flag set, registration is refused", async () => {
  await start();
  try {
    const r = await post("/api/auth/register", {
      email: "squatter@example.com", password: "correct-horse-battery"
    });
    assert.strictEqual(r.status, 403, `expected 403, got ${r.status} ${JSON.stringify(r.json)}`);
    assert.match(r.json.error, /Google/i, "the error should point at the route that does work");

    // The account must not exist. A 403 that still wrote the row would leave the
    // address claimed — exactly the outcome this is meant to prevent.
    const again = await post("/api/auth/login", {
      identifier: "squatter@example.com", password: "correct-horse-battery"
    });
    assert.strictEqual(again.status, 401, "no account should have been created");
  } finally {
    await stop();
  }
});

test("the UI is told, so it stops offering a path the server refuses", async () => {
  await start();
  try {
    const res = await fetch(BASE + "/api/auth/providers");
    const data = await res.json();
    assert.strictEqual(data.emailSignup, false);
  } finally {
    await stop();
  }
});

test("login still works for accounts that already exist", async () => {
  // Create one the way a pre-existing user was created...
  await start({ ALLOW_EMAIL_SIGNUP: "true" });
  const made = await post("/api/auth/register", {
    email: "legacy@example.com", password: "correct-horse-battery"
  });
  assert.strictEqual(made.status, 200, JSON.stringify(made.json));
  await stop();

  // ...then close signup and confirm they can still get in. Closing the door on
  // new unverified accounts must not lock out the ones already through it.
  await start();
  try {
    const ok = await post("/api/auth/login", {
      identifier: "legacy@example.com", password: "correct-horse-battery"
    });
    assert.strictEqual(ok.status, 200, `existing user locked out: ${JSON.stringify(ok.json)}`);

    const wrong = await post("/api/auth/login", {
      identifier: "legacy@example.com", password: "not-the-password"
    });
    assert.strictEqual(wrong.status, 401, "the password check must still apply");
  } finally {
    await stop();
  }
});

test("the flag reopens it, for whenever email verification exists", async () => {
  await start({ ALLOW_EMAIL_SIGNUP: "true" });
  try {
    const r = await post("/api/auth/register", {
      email: "opted-in@example.com", password: "correct-horse-battery"
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  } finally {
    await stop();
  }
});
