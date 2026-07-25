// Rate-limit identity: proves we no longer key on a caller-controlled value.
//
// The bug: rateLimit() used the LEFTMOST X-Forwarded-For entry. Cloudflare
// appends the real client to whatever arrived, so "XFF: 1.2.3.4" reaches the
// origin as "1.2.3.4, <real client>" — the limiter keyed on a value the caller
// chose, and rotating it made the limit unreachable through the proxy.
//
// Worth being precise about what code can and can't guarantee here:
//   * We CAN guarantee we never key on the forgeable part of X-Forwarded-For.
//     That's what these tests check.
//   * We CANNOT prove CF-Connecting-IP is honest — that guarantee comes from
//     Cloudflare overwriting any copy the caller sent, and it only holds while
//     the origin can't be reached directly. ORIGIN_SECRET closes that path, and
//     is tested below.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-rl-test-"));
const servers = [];

async function startServer(env, port) {
  const srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: {
      ...process.env, PORT: String(port), DATA_DIR,
      SESSION_SECRET: "test-only-secret", NODE_ENV: "test", ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  srv.stdout.on("data", d => (log += d));
  srv.stderr.on("data", d => (log += d));
  servers.push(srv);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + "/healthz"); return { srv, base }; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error("server never came up:\n" + log);
}

const login = (base, headers) =>
  fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, ...headers },
    body: JSON.stringify({ identifier: "nobody@example.com", password: "wrong-password" })
  }).then(r => r.status);

/** Hammer until blocked; returns the attempt number, or null if never blocked. */
async function attemptsUntilBlocked(base, headersFor, max = 40) {
  for (let i = 1; i <= max; i++) {
    if ((await login(base, headersFor(i))) === 429) return i;
  }
  return null;
}

let cf;
test.before(async () => {
  // Mirrors production: Cloudflare in front, so CF-Connecting-IP is authoritative.
  cf = await startServer({ TRUST_CLOUDFLARE: "true", TRUST_PROXY: "1" }, 36000 + (process.pid % 400));
});

test.after(() => {
  for (const s of servers) s.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("rotating a forged X-Forwarded-For no longer evades the limiter", async () => {
  // The attack: a fresh fake leading entry each time. Under the old logic every
  // request looked like a brand-new client, so the limit was never reached.
  const blockedAfter = await attemptsUntilBlocked(cf.base, i => ({
    "X-Forwarded-For": `198.51.100.${i}`,
    "CF-Connecting-IP": "203.0.113.9"   // what the edge actually saw
  }));
  assert.ok(blockedAfter !== null, "forged X-Forwarded-For still bypasses the rate limit");
  assert.ok(blockedAfter <= 13, `blocked only after ${blockedAfter} attempts — limit is 12`);
});

test("the forged-then-appended shape Cloudflare really produces is also ignored", async () => {
  const blockedAfter = await attemptsUntilBlocked(cf.base, i => ({
    "X-Forwarded-For": `203.0.113.${i}, 198.51.100.7`,
    "CF-Connecting-IP": "203.0.113.77"
  }));
  assert.ok(blockedAfter !== null, "appended forgery still bypasses the limiter");
});

test("genuinely different clients keep their own budget", async () => {
  // The limiter still has to be useful: one abuser must not lock out a network.
  const a = await login(cf.base, { "CF-Connecting-IP": "192.0.2.31" });
  const b = await login(cf.base, { "CF-Connecting-IP": "192.0.2.32" });
  assert.ok([401, 429].includes(a));
  assert.strictEqual(b, 401, "a fresh client should not start out blocked");
});

test("ORIGIN_SECRET refuses requests that skipped the proxy", async () => {
  // This is what makes CF-Connecting-IP trustworthy: without it, anyone hitting
  // the origin directly could set that header to whatever they liked.
  const port = 36500 + (process.pid % 400);
  const { base } = await startServer(
    { TRUST_CLOUDFLARE: "true", ORIGIN_SECRET: "s3cret-from-cloudflare" }, port);

  const direct = await fetch(base + "/api/auth/providers");
  assert.strictEqual(direct.status, 403, "direct origin access should be refused");

  const viaProxy = await fetch(base + "/api/auth/providers", {
    headers: { "X-Origin-Secret": "s3cret-from-cloudflare" }
  });
  assert.strictEqual(viaProxy.status, 200, "requests through the proxy still work");

  const health = await fetch(base + "/healthz");
  assert.strictEqual(health.status, 200, "platform health checks must stay reachable");
});

test("clientIp prefers CF-Connecting-IP only when configured to", () => {
  const req = {
    headers: { "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" },
    ip: "5.5.5.5",
    socket: { remoteAddress: "127.0.0.1" }
  };

  delete require.cache[require.resolve("./auth")];
  process.env.TRUST_CLOUDFLARE = "false";
  const off = require("./auth");
  assert.strictEqual(off.clientIp(req), "5.5.5.5", "an untrusted CF header must be ignored");

  delete require.cache[require.resolve("./auth")];
  process.env.TRUST_CLOUDFLARE = "true";
  const on = require("./auth");
  assert.strictEqual(on.clientIp(req), "9.9.9.9", "a trusted CF header wins");

  // Never the raw caller-supplied X-Forwarded-For string.
  assert.notStrictEqual(on.clientIp({ headers: {}, ip: "5.5.5.5", socket: {} }), "1.2.3.4");

  delete require.cache[require.resolve("./auth")];
  delete process.env.TRUST_CLOUDFLARE;
});
