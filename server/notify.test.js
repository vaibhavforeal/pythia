// The daily notification's content and timing.
//
// The content assertions matter because a generic line gets muted in a week —
// what earns an open is that it's specific, true of today, and true of you. The
// timing assertions matter because the alternative is waking someone at 3am.
const test = require("node:test");
const assert = require("node:assert");
const notify = require("./notify");

const msg = o => notify.dailyMessage({ natalMoonSign: 3, transitMoonSign: 3, ...o });

test("counting from the natal Moon wraps correctly", () => {
  assert.strictEqual(notify.houseFrom(3, 3), 1, "same sign is the 1st");
  assert.strictEqual(notify.houseFrom(3, 4), 2);
  assert.strictEqual(notify.houseFrom(3, 2), 12, "one behind is the 12th");
  assert.strictEqual(notify.houseFrom(11, 0), 2, "wraps past Pisces");
  assert.strictEqual(notify.houseFrom(0, 11), 12);
});

test("every position produces a distinct, non-empty line", () => {
  const seen = new Set();
  for (let t = 0; t < 12; t++) {
    const m = notify.dailyMessage({ natalMoonSign: 0, transitMoonSign: t });
    assert.ok(m, `no message for transit ${t}`);
    assert.ok(m.title.length > 5 && m.body.length > 20, `too thin: ${JSON.stringify(m)}`);
    assert.ok(!/undefined|NaN/.test(m.title + m.body));
    seen.add(m.title + m.body);
  }
  assert.strictEqual(seen.size, 12, "the line must change as the Moon moves, or it gets muted");
});

test("the hard positions actually say something protective", () => {
  // 4th, 8th and 12th from the Moon are the classically difficult ones; the
  // whole "protect your energy" framing depends on these not being upbeat.
  for (const [transit, word] of [[3, /rest|gentle/i], [7, /low|protect/i], [11, /rest|nothing/i]]) {
    const m = notify.dailyMessage({ natalMoonSign: 0, transitMoonSign: transit });
    assert.match(m.title + " " + m.body, word, `position ${transit} should counsel restraint`);
  }
});

test("a first name is used when there is one", () => {
  assert.match(msg({ name: "Priya Sharma" }).title, /^Priya,/);
  assert.ok(!msg({ name: "" }).title.startsWith(","), "no dangling comma without a name");
  assert.match(msg({ name: "" }).title, /^[A-Z]/, "capitalised when standing alone");
});

test("a friend having a notable day takes the headline", () => {
  const flowing = msg({ friend: { name: "Rohan Das", flow: "flowing" } });
  assert.match(flowing.title, /Rohan/, "only this app knows this — lead with it");
  assert.ok(!/Das/.test(flowing.title), "first names only");

  const friction = msg({ friend: { name: "Rohan", flow: "friction" } });
  assert.match(friction.body, /awkward day/);
  assert.ok(!/Rohan/.test(friction.title), "friction is a heads-up, not a headline");

  const steady = msg({ friend: { name: "Rohan", flow: "steady" } });
  assert.ok(!/Rohan/.test(steady.title + steady.body), "a steady day isn't worth mentioning");
});

test("a streak worth protecting is mentioned; a trivial one isn't", () => {
  assert.match(msg({ streak: 7 }).body, /7-day streak/);
  assert.ok(!/streak/.test(msg({ streak: 1 }).body), "a streak of 1 is not leverage");
  assert.ok(!/streak/.test(msg({ streak: undefined }).body));
});

test("missing chart data produces no message rather than a wrong one", () => {
  assert.strictEqual(notify.dailyMessage({ natalMoonSign: null, transitMoonSign: 3 }), null);
  assert.strictEqual(notify.dailyMessage({ natalMoonSign: 3, transitMoonSign: undefined }), null);
  assert.strictEqual(notify.dailyMessage({}), null);
});

test("send hour follows the device's own timezone", () => {
  // 2026-07-25T02:30Z is 08:00 in India (+330).
  const at = Date.UTC(2026, 6, 25, 2, 30);
  assert.strictEqual(notify.isSendHour({ tzOffsetMinutes: 330 }, at, 8), true, "morning in Delhi");
  assert.strictEqual(notify.isSendHour({ tzOffsetMinutes: 0 }, at, 8), false, "still the night in London");
  assert.strictEqual(notify.isSendHour({ tzOffsetMinutes: -300 }, at, 8), false);

  // 13:00Z is 08:00 in New York (-300): behind UTC means a LATER wall clock.
  const later = Date.UTC(2026, 6, 25, 13, 0);
  assert.strictEqual(notify.isSendHour({ tzOffsetMinutes: -300 }, later, 8), true);
  assert.strictEqual(notify.isSendHour({ tzOffsetMinutes: 330 }, later, 8), false, "evening in Delhi by then");
});

test("a device with no timezone is skipped, not woken at random", () => {
  const at = Date.UTC(2026, 6, 25, 2, 30);
  assert.strictEqual(notify.isSendHour({ tzOffsetMinutes: null }, at), false);
  assert.strictEqual(notify.isSendHour({}, at), false);
  assert.strictEqual(notify.isSendHour(null, at), false);
});

test("nobody gets notified twice in one local day", () => {
  const at = Date.UTC(2026, 6, 25, 2, 30);           // 08:00 IST
  const device = { tzOffsetMinutes: 330, lastSentAt: new Date(at).toISOString() };
  assert.strictEqual(notify.alreadySentToday(device, at), true);
  assert.strictEqual(notify.alreadySentToday(device, at + 60 * 60000), true, "same day, an hour later");
  assert.strictEqual(notify.alreadySentToday(device, at + 24 * 60 * 60000), false, "next day is fair game");
  assert.strictEqual(notify.alreadySentToday({ tzOffsetMinutes: 330 }, at), false, "never sent");
});

test("the local-day boundary is the device's, not UTC's", () => {
  // 18:30Z is already the next day in India (+330 → 00:00).
  const lateUtc = Date.UTC(2026, 6, 25, 18, 30);
  const device = { tzOffsetMinutes: 330, lastSentAt: new Date(Date.UTC(2026, 6, 25, 2, 30)).toISOString() };
  assert.strictEqual(notify.alreadySentToday(device, lateUtc), false,
    "it's tomorrow where they are, so they're due again");
});
