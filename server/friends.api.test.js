// End-to-end friend graph: Soul ID lookup, requests, blocking, and the
// constellation. The assertions that matter most are the privacy ones — a
// friend is shown signs and scores, never birth details or a chart.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 35000 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-friends-test-"));

let srv, log = "";

// Three people with distinct charts.
const BIRTHS = {
  asha: { name: "Asha", year: 1995, month: 3, day: 14, hour: 9, minute: 20, lat: 28.6139, lon: 77.209, tz: 5.5 },
  bela: { name: "Bela", year: 1997, month: 11, day: 2, hour: 14, minute: 5, lat: 19.076, lon: 72.8777, tz: 5.5 },
  chai: { name: "Chai", year: 2001, month: 6, day: 30, hour: 4, minute: 45, lat: 12.9716, lon: 77.5946, tz: 5.5 }
};

const sessions = {}; // name -> cookie
let current = null;

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      "CF-Connecting-IP": `203.0.113.${(Math.abs(hash(current || "x")) % 250) + 1}`,
      ...(current && sessions[current] ? { Cookie: sessions[current] } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length && current) sessions[current] = set.map(c => c.split(";")[0]).join("; ");
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const hash = s => [...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0);

/**
 * Scan a payload for leaked birth values. Opaque ids are stripped first: they
 * are random hex, so "1997" or "19" turns up in one by chance and would fail
 * this check for no reason. What we're actually asserting is that no birth
 * field survives into a friend-facing response.
 */
function assertNoBirthData(payload, values) {
  const scrubbed = JSON.stringify(payload, (k, v) =>
    (k === "id" || k === "pairKey" || k === "since" || k === "createdAt") ? undefined : v);
  for (const v of values) {
    assert.ok(!scrubbed.includes(v), `leaked ${v}: ${scrubbed.slice(0, 300)}`);
  }
}
const as = who => { current = who; };

/** Register, save birth details, return the Soul ID. */
async function makeUser(who) {
  as(who);
  sessions[who] = "";
  const reg = await api("POST", "/api/auth/register",
    { email: `${who}@example.com`, password: "correct-horse-battery" });
  assert.strictEqual(reg.status, 200, `register ${who}: ${JSON.stringify(reg.json)}`);
  const birth = await api("POST", "/api/account/birth", { ...BIRTHS[who], role: who === "asha" ? "groom" : "bride" });
  assert.strictEqual(birth.status, 200, `birth ${who}: ${JSON.stringify(birth.json)}`);
  // Soul IDs are minted on phone verification; assign directly for this suite.
  const soulId = await forceSoulId(who);
  return soulId;
}

/** Soul IDs normally come with phone verification; set one straight in the store. */
async function forceSoulId(who) {
  const file = path.join(DATA_DIR, "users.json");
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  const u = all.find(x => x.email === `${who}@example.com`);
  u.soulId = `test-${who}-001`;
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  return u.soulId;
}

const idOf = who => {
  const all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "users.json"), "utf8"));
  return all.find(x => x.email === `${who}@example.com`).id;
};

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

let ashaSoul, belaSoul, chaiSoul;

test("three accounts with saved birth details", async () => {
  ashaSoul = await makeUser("asha");
  belaSoul = await makeUser("bela");
  chaiSoul = await makeUser("chai");
  assert.ok(ashaSoul && belaSoul && chaiSoul);
});

test("a request needs a real Soul ID", async () => {
  as("asha");
  for (const bad of ["", "nonsense", "@@@"]) {
    assert.strictEqual((await api("POST", "/api/friends/request", { soulId: bad })).status, 400, bad);
  }
  const missing = await api("POST", "/api/friends/request", { soulId: "silver-comet-999" });
  assert.strictEqual(missing.status, 404);
});

test("you cannot befriend yourself", async () => {
  as("asha");
  const r = await api("POST", "/api/friends/request", { soulId: ashaSoul });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.reason, "self");
});

test("a request arrives, showing signs but no birth data", async () => {
  as("asha");
  assert.strictEqual((await api("POST", "/api/friends/request", { soulId: belaSoul })).status, 200);

  as("bela");
  const r = await api("GET", "/api/friends/requests");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.requests.length, 1);
  const req = r.json.requests[0];
  assert.ok(req.moonSign, "signs are the point of the card");
  assert.strictEqual(req.soulId, ashaSoul);

  assertNoBirthData(r.json, ["1995", "28.6139", "77.209", "birth", "planets"]);
});

test("duplicate requests are refused, in both directions", async () => {
  as("asha");
  const again = await api("POST", "/api/friends/request", { soulId: belaSoul });
  assert.strictEqual(again.json.reason, "already-requested");

  as("bela");
  const reverse = await api("POST", "/api/friends/request", { soulId: ashaSoul });
  assert.strictEqual(reverse.json.reason, "they-requested-you", "should point at the pending one");
});

test("only the recipient can accept", async () => {
  const key = [idOf("asha"), idOf("bela")].sort().join("|");
  as("asha");
  assert.strictEqual((await api("POST", `/api/friends/requests/${encodeURIComponent(key)}/accept`)).status, 404);

  as("bela");
  assert.strictEqual((await api("POST", `/api/friends/requests/${encodeURIComponent(key)}/accept`)).status, 200);
});

test("the constellation shows today's flow and a real compatibility score", async () => {
  as("asha");
  const r = await api("GET", "/api/friends");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.friends.length, 1);

  const f = r.json.friends[0];
  assert.strictEqual(f.soulId, belaSoul);
  assert.ok(["flowing", "steady", "friction"].includes(f.flow.key), `odd flow: ${JSON.stringify(f.flow)}`);
  assert.ok(Number.isFinite(f.match.total) && f.match.total >= 0 && f.match.total <= 36);
  assert.strictEqual(f.match.max, 36);
  assert.ok(f.match.band);

  assertNoBirthData(r.json, ["1997", "19.076", "72.8777", "degInSignFmt", "julianDay"]);
});

test("the friendship is mutual without a second accept", async () => {
  as("bela");
  const r = await api("GET", "/api/friends");
  assert.strictEqual(r.json.friends.length, 1);
  assert.strictEqual(r.json.friends[0].soulId, ashaSoul);
});

test("both sides compute the same score", async () => {
  as("asha");
  const mine = (await api("GET", "/api/friends")).json.friends[0].match.total;
  as("bela");
  const theirs = (await api("GET", "/api/friends")).json.friends[0].match.total;
  assert.strictEqual(mine, theirs, "Guna Milan must not depend on who is asking");
});

test("blocking severs the friendship and hides the blocker", async () => {
  as("bela");
  assert.strictEqual((await api("POST", `/api/friends/${idOf("asha")}/block`)).status, 200);
  assert.strictEqual((await api("GET", "/api/friends")).json.friends.length, 0);

  as("asha");
  assert.strictEqual((await api("GET", "/api/friends")).json.friends.length, 0, "block must cut both edges");

  // And a fresh request is refused without revealing that a block exists.
  const retry = await api("POST", "/api/friends/request", { soulId: belaSoul });
  assert.strictEqual(retry.status, 404);
  assert.strictEqual(retry.json.error, "No one with that Soul ID.", "must not confirm the block");
});

test("unblocking restores the ability to connect", async () => {
  as("bela");
  assert.strictEqual((await api("DELETE", `/api/friends/${idOf("asha")}/block`)).status, 200);
  as("asha");
  assert.strictEqual((await api("POST", "/api/friends/request", { soulId: belaSoul })).status, 200);
});

test("declining removes the request without connecting", async () => {
  const key = [idOf("asha"), idOf("bela")].sort().join("|");
  as("bela");
  assert.strictEqual((await api("POST", `/api/friends/requests/${encodeURIComponent(key)}/decline`)).status, 200);
  assert.strictEqual((await api("GET", "/api/friends/requests")).json.requests.length, 0);
  assert.strictEqual((await api("GET", "/api/friends")).json.friends.length, 0);
});

test("unfriending is available to either side", async () => {
  as("asha");
  await api("POST", "/api/friends/request", { soulId: chaiSoul });
  const key = [idOf("asha"), idOf("chai")].sort().join("|");
  as("chai");
  await api("POST", `/api/friends/requests/${encodeURIComponent(key)}/accept`);
  assert.strictEqual((await api("GET", "/api/friends")).json.friends.length, 1);

  assert.strictEqual((await api("DELETE", `/api/friends/${idOf("asha")}`)).status, 200);
  assert.strictEqual((await api("GET", "/api/friends")).json.friends.length, 0);
  as("asha");
  assert.strictEqual((await api("GET", "/api/friends")).json.friends.length, 0);
});

test("a user without birth details still loads, flagged", async () => {
  as("nobirth");
  sessions.nobirth = "";
  await api("POST", "/api/auth/register", { email: "nobirth@example.com", password: "correct-horse-battery" });
  const r = await api("GET", "/api/friends");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.needsBirth, true, "the UI needs to know why there's no flow");
});

test("friend endpoints require a session", async () => {
  const anon = await fetch(BASE + "/api/friends", { headers: { Origin: BASE } });
  assert.strictEqual(anon.status, 401);
});
