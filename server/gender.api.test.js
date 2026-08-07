// Gender end-to-end: it has to survive a round trip on the account and on a
// saved person, drive the Guna Milan role without anyone re-answering, and —
// the part that's easy to get wrong — leave "other" and older accounts able to
// state a role by hand instead of being silently assigned one.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 36700 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-gender-test-"));

let srv, log = "";
let cookie = "";

const BIRTH = { name: "Asha", year: 1995, month: 3, day: 14, hour: 9, minute: 20, lat: 28.6139, lon: 77.209, tz: 5.5 };
const PARTNER = { name: "Bela", year: 1997, month: 11, day: 2, hour: 14, minute: 5, lat: 19.076, lon: 72.8777, tz: 5.5 };

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      "CF-Connecting-IP": "203.0.113.7",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const storedUser = () => {
  const all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "users.json"), "utf8"));
  return all[0];
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

test("an account is created", async () => {
  const reg = await api("POST", "/api/auth/register", { email: "asha@example.com", password: "correct-horse-battery" });
  assert.strictEqual(reg.status, 200, JSON.stringify(reg.json));
});

test("gender saves on the account and reads back", async () => {
  const save = await api("POST", "/api/account/birth", { ...BIRTH, gender: "female" });
  assert.strictEqual(save.status, 200, JSON.stringify(save.json));

  const acct = await api("GET", "/api/account");
  assert.strictEqual(acct.json.gender, "female");
});

test("a stated gender sets the kuta role, with no toggle answered", async () => {
  // Nothing sent a role at all — female has to resolve to bride on its own,
  // because that's the index gunamilan.js needs.
  assert.strictEqual(storedUser().birthRole, "bride");
});

test("gender overrides a stale role rather than losing to it", async () => {
  const save = await api("POST", "/api/account/birth", { ...BIRTH, gender: "male", role: "bride" });
  assert.strictEqual(save.status, 200);
  assert.strictEqual(storedUser().birthRole, "groom", "male must win over a leftover 'bride' toggle");
  assert.strictEqual(storedUser().gender, "male");
});

test("'other' keeps the hand-picked role and is stored honestly", async () => {
  const save = await api("POST", "/api/account/birth", { ...BIRTH, gender: "other", role: "bride" });
  assert.strictEqual(save.status, 200);
  assert.strictEqual(storedUser().gender, "other", "stored as stated, not mapped to male/female");
  assert.strictEqual(storedUser().birthRole, "bride", "the role they picked has to survive");
});

test("an unrecognised gender is rejected into null, not stored raw", async () => {
  const save = await api("POST", "/api/account/birth", { ...BIRTH, gender: "<script>", role: "groom" });
  assert.strictEqual(save.status, 200);
  assert.strictEqual(storedUser().gender, null);
  assert.strictEqual(storedUser().birthRole, "groom");
});

test("an account that never stated a gender still reports one from its role", async () => {
  // The back-fill for accounts older than the field: they only ever recorded a
  // role, and the form needs something to pre-select.
  const file = path.join(DATA_DIR, "users.json");
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  delete all[0].gender;
  all[0].birthRole = "bride";
  fs.writeFileSync(file, JSON.stringify(all, null, 2));

  const acct = await api("GET", "/api/account");
  assert.strictEqual(acct.json.gender, "female", "a legacy 'bride' reads back as female");
});

test("a saved person carries their own gender", async () => {
  const saved = await api("POST", "/api/people", { ...PARTNER, gender: "male" });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  assert.strictEqual(saved.json.person.gender, "male");

  const list = await api("GET", "/api/people");
  assert.strictEqual(list.json.people.find(p => p.name === "Bela").gender, "male");
});

test("a person saved without a gender stays null, not defaulted", async () => {
  const saved = await api("POST", "/api/people", { ...PARTNER, name: "Chai" });
  assert.strictEqual(saved.status, 200);
  assert.strictEqual(saved.json.person.gender, null, "unstated must not become male");
});

test("an invite derives its role from gender", async () => {
  const inv = await api("POST", "/api/invites", { ...BIRTH, gender: "male" });
  assert.strictEqual(inv.status, 200, JSON.stringify(inv.json));

  const all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "invites.json"), "utf8"));
  assert.strictEqual(all.at(-1).role, "groom");
});

test("an invite from someone who said 'other' keeps their chosen role", async () => {
  const inv = await api("POST", "/api/invites", { ...BIRTH, gender: "other", role: "bride" });
  assert.strictEqual(inv.status, 200);

  const all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "invites.json"), "utf8"));
  assert.strictEqual(all.at(-1).role, "bride");
});

test("a male/female pair is scored the classical directional way", async () => {
  const r = await api("POST", "/api/match", {
    boy: { ...BIRTH, gender: "male" },
    girl: { ...PARTNER, gender: "female" }
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.symmetric, undefined, "a couple with roles keeps the classical scoring");
});

test("a same-sex pair is scored symmetrically instead of role-assigned", async () => {
  const r = await api("POST", "/api/match", {
    boy: { ...BIRTH, gender: "male" },
    girl: { ...PARTNER, gender: "male" }
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.symmetric, true);
  assert.ok(r.json.passes, "both readings are reported");
});

test("a same-sex score does not depend on who was listed first", async () => {
  const one = await api("POST", "/api/match", {
    boy: { ...BIRTH, gender: "female" },
    girl: { ...PARTNER, gender: "female" }
  });
  const two = await api("POST", "/api/match", {
    boy: { ...PARTNER, gender: "female" },
    girl: { ...BIRTH, gender: "female" }
  });
  assert.strictEqual(one.json.total, two.json.total);
});

test("'other' on either side avoids assigning a role", async () => {
  const r = await api("POST", "/api/match", {
    boy: { ...BIRTH, gender: "other" },
    girl: { ...PARTNER, gender: "female" }
  });
  assert.strictEqual(r.json.symmetric, true);
});

test("an unstated gender keeps the existing behaviour, not a guess", async () => {
  // We only switch to symmetric when we positively know it isn't a male/female
  // pair. Silence must not silently change how anyone's match is scored.
  const r = await api("POST", "/api/match", { boy: BIRTH, girl: PARTNER });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.symmetric, undefined);
});

test("the chart carries a gender-correct kalatra-karaka", async () => {
  const male = await api("POST", "/api/chart", { ...BIRTH, gender: "male" });
  const female = await api("POST", "/api/chart", { ...BIRTH, gender: "female" });
  assert.strictEqual(male.json.synthesis.marriageKaraka.planets[0].key, "Venus");
  assert.strictEqual(female.json.synthesis.marriageKaraka.planets[0].key, "Jupiter");

  const unknown = await api("POST", "/api/chart", { ...BIRTH });
  assert.strictEqual(unknown.json.synthesis.marriageKaraka, null);
});
