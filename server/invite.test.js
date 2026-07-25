// Unit tests for invite-link helpers. The privacy assertions here are the
// point: the invitee has no account, so anything these functions return is
// effectively public. Run with `npm test`.
const test = require("node:test");
const assert = require("node:assert");
const invite = require("./invite");

test("tokens are unguessable, URL-safe and unique", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const t = invite.newToken();
    assert.match(t, /^[A-Za-z0-9_-]+$/, "must survive being pasted into a URL");
    assert.ok(t.length >= 12, `too short to be unguessable: ${t}`);
    assert.ok(!seen.has(t), "collision");
    seen.add(t);
  }
});

test("isValidToken screens junk before it reaches the database", () => {
  assert.strictEqual(invite.isValidToken(invite.newToken()), true);
  for (const bad of ["", "short", "has space", "../../etc/passwd", "a".repeat(65), null, 42, "tok;drop"]) {
    assert.strictEqual(invite.isValidToken(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test("expiry is honoured, and a missing expiry never goes stale", () => {
  const now = Date.UTC(2026, 6, 25);
  assert.strictEqual(invite.isExpired({ expiresAt: invite.expiryFrom(now) }, now), false);
  assert.strictEqual(invite.isExpired({ expiresAt: invite.expiryFrom(now) }, now + 31 * 86400000), true);
  assert.strictEqual(invite.isExpired({ expiresAt: null }, now), false);
  assert.strictEqual(invite.isExpired({ expiresAt: "not a date" }, now), false);
  assert.strictEqual(invite.isExpired(null, now), false);
});

test("safeName trims, collapses and never renders empty", () => {
  assert.strictEqual(invite.safeName("  Vaibhav   Shettar "), "Vaibhav Shettar");
  assert.strictEqual(invite.safeName(""), "Someone");
  assert.strictEqual(invite.safeName(null), "Someone");
  assert.strictEqual(invite.safeName("Unnamed"), "Someone", "the saved-person placeholder isn't a name");
  assert.strictEqual(invite.safeName("x".repeat(200)).length, 40, "bounded for layout and abuse");
  assert.strictEqual(invite.safeName("a\nb\tc"), "a b c");
});

test("publicInviter exposes signs only — never birth data", () => {
  const chart = {
    planets: [{ key: "Moon", sign: "Cancer", nakshatra: "Ashlesha" }],
    ascendant: { sign: "Aries" },
    dasha: { moonNakshatra: "Ashlesha", maha: { lord: "Venus" } }
  };
  const inv = {
    name: "Vaibhav",
    birth: { year: 1995, month: 3, day: 14, hour: 9, minute: 20, lat: 28.6139, lon: 77.209, tz: 5.5 }
  };
  const out = invite.publicInviter(inv, chart);
  assert.deepStrictEqual(out, {
    name: "Vaibhav", moonSign: "Cancer", nakshatra: "Ashlesha", risingSign: "Aries"
  });
  // The real guarantee: nothing identifying leaks through, whatever the shape.
  const blob = JSON.stringify(out);
  for (const secret of ["1995", "28.6139", "77.209", "5.5", "9", "20"]) {
    assert.ok(!blob.includes(secret), `birth detail ${secret} leaked into the public payload`);
  }
});

test("publicInviter degrades safely on a partial chart", () => {
  const out = invite.publicInviter({ name: null }, {});
  assert.deepStrictEqual(out, { name: "Someone", moonSign: null, nakshatra: null, risingSign: null });
});

test("publicMatch drops the embedded charts", () => {
  const result = {
    total: 28, max: 36,
    verdict: { band: "good", label: "Strong match" },
    kutas: [{ name: "Varna", score: 1 }],
    charts: { boy: { planets: [{ key: "Moon" }] }, girl: { planets: [] } }
  };
  const out = invite.publicMatch(result);
  assert.strictEqual(out.charts, undefined, "would hand a stranger the inviter's whole nativity");
  assert.strictEqual(out.total, 28);
  assert.deepStrictEqual(out.verdict, { band: "good", label: "Strong match" });
  assert.ok(Array.isArray(out.kutas), "the scoring breakdown is the point — keep it");
  assert.strictEqual(result.charts !== undefined, true, "must not mutate the caller's object");
  assert.strictEqual(invite.publicMatch(null), null);
});

test("responseSummary keeps scores and drops everything else", () => {
  const r = invite.responseSummary("  Priya ", {
    total: 28, max: 36, verdict: { band: "good", label: "Strong match" },
    charts: { boy: {}, girl: {} },
    manglik: { boy: true }
  });
  assert.deepStrictEqual(r, { name: "Priya", total: 28, max: 36, band: "good", label: "Strong match" });
});

test("responseSummary survives a malformed result", () => {
  assert.deepStrictEqual(invite.responseSummary(null, null),
    { name: "Someone", total: null, max: null, band: null, label: null });
  assert.deepStrictEqual(invite.responseSummary("A", { total: "x", verdict: null }),
    { name: "A", total: null, max: null, band: null, label: null });
});
