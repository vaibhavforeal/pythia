// Phone normalisation and OTP logic. The assertions here are mostly about
// attacks and about one human never becoming two accounts. Run with `npm test`.
const test = require("node:test");
const assert = require("node:assert");
const phone = require("./phone");
const otp = require("./otp");
const soulid = require("./soulid");

// --- phone -------------------------------------------------------------------

test("every way of typing one Indian number normalises to the same E.164", () => {
  const want = "+919876543210";
  for (const input of [
    "9876543210", "09876543210", "+919876543210", "+91 98765 43210",
    "+91-98765-43210", "0091 9876543210", " (+91) 98765 43210 ", "＋919876543210"
  ]) {
    assert.strictEqual(phone.normalize(input), want, `input: ${JSON.stringify(input)}`);
  }
});

test("international numbers keep their own country code", () => {
  assert.strictEqual(phone.normalize("+1 415 555 0132"), "+14155550132");
  assert.strictEqual(phone.normalize("+44 20 7946 0958"), "+442079460958");
  assert.strictEqual(phone.normalize("0044 20 7946 0958"), "+442079460958");
});

test("junk is rejected rather than coerced", () => {
  for (const bad of ["", "   ", null, undefined, "abcdefg", "+", "12", "+0123456789", "+" + "9".repeat(20)]) {
    assert.strictEqual(phone.normalize(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test("isValid only accepts normalised E.164", () => {
  assert.strictEqual(phone.isValid("+919876543210"), true);
  for (const bad of ["9876543210", "+0919876543210", "+91 98765 43210", "", null]) {
    assert.strictEqual(phone.isValid(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test("obvious Indian mobile typos are caught, other countries are left alone", () => {
  assert.strictEqual(phone.isPlausibleIndianMobile("+919876543210"), true);
  assert.strictEqual(phone.isPlausibleIndianMobile("+911123456789"), false, "landline-looking");
  assert.strictEqual(phone.isPlausibleIndianMobile("+9198765"), false, "too short");
  assert.strictEqual(phone.isPlausibleIndianMobile("+14155550132"), true, "not ours to judge");
});

test("mask never reveals the whole number", () => {
  const m = phone.mask("+919876543210");
  assert.ok(!m.includes("9876543210"), `leaked: ${m}`);
  assert.ok(m.includes("•"));
  assert.strictEqual(phone.mask("nonsense"), "");
});

// --- otp ---------------------------------------------------------------------

const PH = "+919876543210";

test("codes are 6 digits and stored only as a hash", () => {
  const code = otp.generateCode();
  assert.match(code, /^\d{6}$/);
  const rec = otp.newRecord(PH, code);
  assert.ok(!JSON.stringify(rec).includes(code), "the plaintext code must never be persisted");
  assert.strictEqual(rec.hash.length, 64);
});

test("a code is bound to its phone number", () => {
  const code = otp.generateCode();
  const rec = otp.newRecord(PH, code);
  assert.strictEqual(otp.verify(rec, PH, code).ok, true);
  assert.strictEqual(otp.verify(rec, "+919999999999", code).ok, false, "must not verify another number");
});

test("wrong codes burn attempts and then lock out", () => {
  const code = otp.generateCode();
  let rec = otp.newRecord(PH, code);
  for (let i = 1; i <= otp.MAX_ATTEMPTS; i++) {
    const r = otp.verify(rec, PH, "000000" === code ? "111111" : "000000");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "bad-code");
    assert.strictEqual(r.attemptsLeft, otp.MAX_ATTEMPTS - i);
    rec = r.record;
  }
  const locked = otp.verify(rec, PH, code);
  assert.strictEqual(locked.ok, false);
  assert.strictEqual(locked.reason, "too-many-attempts", "the right code must not work after lockout");
});

test("expired codes are refused", () => {
  const code = otp.generateCode();
  const rec = otp.newRecord(PH, code, Date.now() - otp.TTL_MS - 1000);
  const r = otp.verify(rec, PH, code, Date.now());
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "expired");
});

test("malformed submissions cost an attempt and never match", () => {
  const code = otp.generateCode();
  const rec = otp.newRecord(PH, code);
  for (const bad of ["", "12345", "1234567", "abcdef", null]) {
    const r = otp.verify(rec, PH, bad);
    assert.strictEqual(r.ok, false, `should reject ${JSON.stringify(bad)}`);
  }
});

test("resend is rate limited, then capped for the day", () => {
  const now = Date.now();
  const rec = otp.newRecord(PH, otp.generateCode(), now);

  const tooSoon = otp.sendBlockedReason(rec, now + 5000);
  assert.strictEqual(tooSoon.reason, "cooldown");
  assert.ok(tooSoon.retryAfter > 0);

  assert.strictEqual(otp.sendBlockedReason(rec, now + otp.RESEND_COOLDOWN_MS + 1), null, "allowed after cooldown");

  const maxed = { ...rec, sends: otp.MAX_SENDS_PER_DAY, lastSentAt: new Date(now).toISOString() };
  const capped = otp.sendBlockedReason(maxed, now + otp.RESEND_COOLDOWN_MS + 1);
  assert.strictEqual(capped.reason, "daily-limit");

  // ...and the cap lifts once the 24h window rolls over.
  assert.strictEqual(otp.sendBlockedReason(maxed, now + 25 * 60 * 60 * 1000), null);
});

test("a resend inside the window keeps counting, outside it starts over", () => {
  const now = Date.now();
  const first = otp.newRecord(PH, otp.generateCode(), now);
  const second = otp.resendRecord(first, PH, otp.generateCode(), now + 2 * 60 * 1000);
  assert.strictEqual(second.sends, 2);
  assert.strictEqual(second.createdAt, first.createdAt, "same 24h window");
  assert.strictEqual(second.attempts, 0, "a new code gets a fresh attempt budget");

  const later = otp.resendRecord(first, PH, otp.generateCode(), now + 25 * 60 * 60 * 1000);
  assert.strictEqual(later.sends, 1, "new window");
});

// --- soul ids ----------------------------------------------------------------

test("Soul IDs have the right shape and a large space", () => {
  for (let i = 0; i < 200; i++) assert.ok(soulid.isValid(soulid.generate()));
  assert.ok(soulid.SPACE > 4_000_000, `space too small: ${soulid.SPACE}`);
});

test("Soul IDs collide rarely enough to assign with a retry", () => {
  const seen = new Set();
  let collisions = 0;
  for (let i = 0; i < 5000; i++) {
    const id = soulid.generate();
    if (seen.has(id)) collisions++;
    seen.add(id);
  }
  assert.ok(collisions < 20, `too many collisions in 5000 draws: ${collisions}`);
});

test("Soul IDs survive being pasted out of a chat app", () => {
  for (const input of [" Ember-Comet-472 ", "@ember-comet-472", "✦ ember-comet-472", "ember‑comet‑472"]) {
    assert.strictEqual(soulid.normalize(input), "ember-comet-472", `input: ${JSON.stringify(input)}`);
  }
});

test("Soul IDs are not derived from the chart", () => {
  // The whole point: a searchable directory must not encode placements.
  const ids = Array.from({ length: 300 }, () => soulid.generate());
  const signs = ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra",
    "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"];
  const leaked = ids.filter(id => signs.some(s => id.includes(s)));
  assert.strictEqual(leaked.length, 0, `sign names in Soul IDs: ${leaked.join(", ")}`);
});
