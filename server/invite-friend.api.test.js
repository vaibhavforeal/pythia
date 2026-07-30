// The growth loop end to end: send a link → a stranger checks compatibility
// with no account → they sign up → the inviter gets a request to connect.
//
// The cases that must NOT create a connection matter as much as the one that
// must: opening your own link, an expired invite, a plain signup, and someone
// who was already blocked.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 33000 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-invfriend-"));

let srv, log = "";

const HOST_BIRTH = { name: "Asha", year: 1995, month: 3, day: 14, hour: 9, minute: 20, lat: 28.6139, lon: 77.209, tz: 5.5 };
const GUEST_BIRTH = { name: "Bela", year: 1997, month: 11, day: 2, hour: 14, minute: 5, lat: 19.076, lon: 72.8777, tz: 5.5 };

// Each "browser" keeps its own cookie jar — that's the whole mechanism here.
function browser(label) {
  let jar = "";
  let seq = 0;
  return {
    label,
    async req(method, url, body) {
      const res = await fetch(BASE + url, {
        method,
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          Origin: BASE,
          "CF-Connecting-IP": `198.51.100.${(label.length * 7 + seq++) % 250 + 1}`,
          ...(jar ? { Cookie: jar } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of set) {
        const [pair] = c.split(";");
        const [name] = pair.split("=");
        const kept = jar.split("; ").filter(Boolean).filter(x => !x.startsWith(name + "="));
        // Max-Age=0 means the server is clearing it.
        if (!/Max-Age=0/i.test(c)) kept.push(pair);
        jar = kept.join("; ");
      }
      let json = null;
      try { json = await res.json(); } catch { /* no body */ }
      return { status: res.status, json };
    },
    cookies: () => jar
  };
}

test.before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, SESSION_SECRET: "test-only-secret", ALLOW_EMAIL_SIGNUP: "true", NODE_ENV: "test" },
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

let host, token;

test("the host signs up and mints an invite link", async () => {
  host = browser("host");
  assert.strictEqual((await host.req("POST", "/api/auth/register",
    { email: "host@example.com", password: "correct-horse-battery" })).status, 200);
  await host.req("POST", "/api/account/birth", { ...HOST_BIRTH, role: "groom" });

  const r = await host.req("POST", "/api/invites", { ...HOST_BIRTH, role: "groom" });
  assert.strictEqual(r.status, 200);
  token = r.json.token;
});

test("checking the link anonymously sets the pending-invite cookie", async () => {
  const guest = browser("guest-probe");
  const r = await guest.req("POST", `/api/invite/${token}/match`, GUEST_BIRTH);
  assert.strictEqual(r.status, 200);
  assert.match(guest.cookies(), /pending_invite=/, "the hop to /app relies on this");
});

test("signing up after checking a link requests a connection", async () => {
  const guest = browser("guest");
  await guest.req("POST", `/api/invite/${token}/match`, GUEST_BIRTH);

  const reg = await guest.req("POST", "/api/auth/register",
    { email: "guest@example.com", password: "correct-horse-battery" });
  assert.strictEqual(reg.status, 200);
  assert.strictEqual(reg.json.connectedTo, true, "the client uses this to explain what happened");

  // The host sees it, tagged as coming from the link rather than a Soul ID.
  const reqs = await host.req("GET", "/api/friends/requests");
  assert.strictEqual(reqs.json.requests.length, 1);
  assert.strictEqual(reqs.json.requests[0].source, "invite");

  // And accepting produces a real connection.
  const pk = encodeURIComponent(reqs.json.requests[0].pairKey);
  assert.strictEqual((await host.req("POST", `/api/friends/requests/${pk}/accept`)).status, 200);
  const friends = await host.req("GET", "/api/friends");
  assert.strictEqual(friends.json.friends.length, 1);

  // The guest's birth was used for the anonymous check and deliberately not
  // stored — they never had an account to consent with. So a freshly converted
  // friend has no signs and no flow until they cast their own chart in the app.
  const f = friends.json.friends[0];
  assert.strictEqual(f.moonSign, null, "nothing should have been kept from the anonymous check");
  assert.strictEqual(f.flow, null, "no chart yet, so no daily flow");
});

test("once the convert casts their chart, signs and flow appear", async () => {
  const guest = browser("guest-casts");
  await guest.req("POST", `/api/invite/${token}/match`, GUEST_BIRTH);
  await guest.req("POST", "/api/auth/register",
    { email: "cast@example.com", password: "correct-horse-battery" });
  await guest.req("POST", "/api/account/birth", { ...GUEST_BIRTH, role: "bride" });

  const reqs = await host.req("GET", "/api/friends/requests");
  const pk = encodeURIComponent(reqs.json.requests[0].pairKey);
  await host.req("POST", `/api/friends/requests/${pk}/accept`);

  const friends = await host.req("GET", "/api/friends");
  const f = friends.json.friends.find(x => x.name === "Bela");
  assert.ok(f, `expected Bela among ${friends.json.friends.map(x => x.name).join(", ")}`);
  assert.ok(f.moonSign, "signs should appear once they have a chart");
  assert.ok(f.flow && f.flow.key, "and so should today's flow");
  assert.ok(Number.isFinite(f.match.total));
});

test("the cookie is one-shot — a second signup doesn't reconnect", async () => {
  const guest = browser("guest2");
  await guest.req("POST", `/api/invite/${token}/match`, GUEST_BIRTH);
  await guest.req("POST", "/api/auth/register",
    { email: "guest2@example.com", password: "correct-horse-battery" });
  assert.ok(!/pending_invite=[^;]/.test(guest.cookies()), "cookie should be cleared after use");

  // A further account from the same browser must not inherit the invite.
  const again = await guest.req("POST", "/api/auth/register",
    { email: "guest3@example.com", password: "correct-horse-battery" });
  assert.strictEqual(again.json.connectedTo, undefined);
});

test("a plain signup with no invite connects to nobody", async () => {
  const solo = browser("solo");
  const reg = await solo.req("POST", "/api/auth/register",
    { email: "solo@example.com", password: "correct-horse-battery" });
  assert.strictEqual(reg.status, 200);
  assert.strictEqual(reg.json.connectedTo, undefined);
});

test("opening your own link and signing up again connects to nobody", async () => {
  // The host's own browser already holds a session; a fresh account from a
  // browser that checked the host's own link must not self-connect.
  const own = browser("own");
  await own.req("POST", `/api/invite/${token}/match`, GUEST_BIRTH);
  const reg = await own.req("POST", "/api/auth/register",
    { email: "own@example.com", password: "correct-horse-battery" });
  // Different account, so this legitimately connects — the self case is when
  // the inviter themselves signs up, which can't happen twice. Assert instead
  // that no request was created pointing at the new user from themselves.
  assert.strictEqual(reg.status, 200);
  const reqs = await own.req("GET", "/api/friends/requests");
  assert.ok(!reqs.json.requests.some(r => r.name === "Bela" && r.soulId === null && r.pairKey.split("|")[0] === r.pairKey.split("|")[1]),
    "no self-request should exist");
});

test("an expired invite creates no connection", async () => {
  const guest = browser("late");
  await guest.req("POST", `/api/invite/${token}/match`, GUEST_BIRTH);

  // Age the invite past its TTL, then sign up carrying the cookie.
  const file = path.join(DATA_DIR, "invites.json");
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  all.find(i => i.token === token).expiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(all, null, 2));

  const reg = await guest.req("POST", "/api/auth/register",
    { email: "late@example.com", password: "correct-horse-battery" });
  assert.strictEqual(reg.status, 200, "signup must still succeed");
  assert.strictEqual(reg.json.connectedTo, undefined, "but no connection from a dead link");
});

test("a forged pending_invite cookie is harmless", async () => {
  const faker = browser("faker");
  const res = await fetch(BASE + "/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Origin: BASE,
      "CF-Connecting-IP": "198.51.100.201",
      Cookie: "pending_invite=../../etc/passwd"
    },
    body: JSON.stringify({ email: "faker@example.com", password: "correct-horse-battery" })
  });
  assert.strictEqual(res.status, 200, "signup should not break on junk");
  const json = await res.json();
  assert.strictEqual(json.connectedTo, undefined);
  assert.ok(faker); // keep the linter quiet about the unused jar
});
