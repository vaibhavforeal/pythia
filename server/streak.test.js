// Unit tests for the daily-streak date logic. Run with `npm test`.
//
// This file is pure — no server, no disk. The arithmetic here is the part that
// silently rots (leap days, year ends, clock skew), so it gets tested hard.
const test = require("node:test");
const assert = require("node:assert");
const streak = require("./streak");

const st = (current, longest, last, days) => ({ current, longest, last, days });
// advance() also returns changed/milestone; most assertions only care about state.
const state = r => ({ current: r.current, longest: r.longest, last: r.last, days: r.days, changed: r.changed });

test("first check-in starts the streak at 1", () => {
  assert.deepStrictEqual(state(streak.advance(st(0, 0, null, 0), "2026-07-25")),
    { current: 1, longest: 1, last: "2026-07-25", days: 1, changed: true });
});

test("checking in the next day continues the run", () => {
  assert.deepStrictEqual(state(streak.advance(st(4, 9, "2026-07-24", 20), "2026-07-25")),
    { current: 5, longest: 9, last: "2026-07-25", days: 21, changed: true });
});

test("a missed day resets to 1 but keeps the personal best", () => {
  assert.deepStrictEqual(state(streak.advance(st(30, 30, "2026-07-22", 60), "2026-07-25")),
    { current: 1, longest: 30, last: "2026-07-25", days: 61, changed: true });
});

test("checking in twice on one day changes nothing", () => {
  const r = streak.advance(st(5, 9, "2026-07-25", 21), "2026-07-25");
  assert.strictEqual(r.changed, false, "caller should be able to skip the write");
  assert.deepStrictEqual(state(r),
    { current: 5, longest: 9, last: "2026-07-25", days: 21, changed: false });
});

test("passing the old record raises longest", () => {
  assert.deepStrictEqual(state(streak.advance(st(9, 9, "2026-07-24", 40), "2026-07-25")),
    { current: 10, longest: 10, last: "2026-07-25", days: 41, changed: true });
});

test("a stored date in the future is ignored, not destructive", () => {
  // Bad device clock or a tampered payload: refuse to advance, but don't wipe.
  assert.deepStrictEqual(state(streak.advance(st(7, 7, "2026-08-01", 30), "2026-07-25")),
    { current: 7, longest: 7, last: "2026-08-01", days: 30, changed: false });
});

test("consecutive days across calendar boundaries", () => {
  const cont = (last, today) => streak.advance(st(3, 3, last, 10), today).current;
  assert.strictEqual(cont("2026-07-31", "2026-08-01"), 4, "month end");
  assert.strictEqual(cont("2025-12-31", "2026-01-01"), 4, "new year");
  assert.strictEqual(cont("2024-02-28", "2024-02-29"), 4, "into leap day");
  assert.strictEqual(cont("2024-02-29", "2024-03-01"), 4, "out of leap day");
  assert.strictEqual(cont("2025-02-28", "2025-03-01"), 4, "non-leap February");
});

test("milestones fire on the celebrated days only", () => {
  const at = n => streak.advance(st(n - 1, n - 1, "2026-07-24", n - 1), "2026-07-25").milestone;
  assert.strictEqual(at(3), true);
  assert.strictEqual(at(7), true);
  assert.strictEqual(at(4), false);
  assert.strictEqual(streak.nextMilestone(5), 7);
  assert.strictEqual(streak.nextMilestone(365), null, "nothing left to chase");
});

test("missing or corrupt stored state degrades to a fresh streak", () => {
  const fresh = { current: 1, longest: 1, last: "2026-07-25", days: 1, changed: true };
  assert.deepStrictEqual(state(streak.advance(null, "2026-07-25")), fresh);
  assert.deepStrictEqual(
    state(streak.advance({ current: "x", longest: null, last: "nonsense", days: undefined }, "2026-07-25")),
    fresh
  );
});

test("plausibleToday accepts any real timezone and nothing else", () => {
  const NOW = Date.UTC(2026, 6, 25, 12, 0, 0); // 2026-07-25T12:00Z
  assert.strictEqual(streak.plausibleToday("2026-07-25", NOW), true);
  assert.strictEqual(streak.plausibleToday("2026-07-26", NOW), true, "UTC+14 is a day ahead");
  assert.strictEqual(streak.plausibleToday("2026-07-24", NOW), true, "UTC-12 is a day behind");
  assert.strictEqual(streak.plausibleToday("2026-07-27", NOW), false);
  assert.strictEqual(streak.plausibleToday("2026-07-23", NOW), false);
  // Across the year boundary the ±1 window still has to work.
  assert.strictEqual(streak.plausibleToday("2026-01-01", Date.UTC(2025, 11, 31, 23, 0)), true);
});

test("plausibleToday rejects malformed and impossible dates", () => {
  const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);
  // "25-07-2026" is no longer here: DD-MM-YYYY is now the canonical format.
  for (const bad of ["", "2026-7-5", "31-02-2026", "2026-02-31", "2026-13-01",
    "01-13-2026", "25-07-2026' or 1=1", "5-7-2026", null]) {
    assert.strictEqual(streak.plausibleToday(bad, NOW), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test("DD-MM-YYYY is the canonical format, and legacy ISO still reads", () => {
  const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);
  assert.strictEqual(streak.plausibleToday("25-07-2026", NOW), true);
  assert.strictEqual(streak.plausibleToday("26-07-2026", NOW), true, "UTC+14 is a day ahead");
  assert.strictEqual(streak.plausibleToday("24-07-2026", NOW), true, "UTC-12 is a day behind");
  assert.strictEqual(streak.plausibleToday("27-07-2026", NOW), false);
  // Rows written before the format change must keep working.
  assert.strictEqual(streak.plausibleToday("2026-07-25", NOW), true, "legacy ISO still accepted");
  assert.strictEqual(streak.daysBetween("2026-07-24", "25-07-2026"), 1, "mixed formats compare correctly");

  // A stored legacy date and today's new-format date are the SAME day; a
  // string comparison would miss that and count the day twice.
  const prev = { current: 5, longest: 9, last: "2026-07-25", days: 21 };
  assert.strictEqual(streak.advance(prev, "25-07-2026").changed, false, "same day across formats");
  assert.strictEqual(streak.advance(prev, "26-07-2026").current, 6, "next day still continues the run");
});

test("localDay pins the date to the client's offset, so it can't be walked", () => {
  const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);
  assert.strictEqual(streak.localDay(0, NOW), "25-07-2026");
  assert.strictEqual(streak.localDay(330, NOW), "25-07-2026", "India +5:30");
  assert.strictEqual(streak.localDay(14 * 60, NOW), "26-07-2026", "UTC+14 is already tomorrow");
  assert.strictEqual(streak.localDay(-12 * 60, NOW), "25-07-2026");
  assert.strictEqual(streak.localDay(-12 * 60, Date.UTC(2026, 6, 25, 6, 0)), "24-07-2026");

  assert.strictEqual(streak.isValidOffset(330), true);
  assert.strictEqual(streak.isValidOffset(-12 * 60), true);
  assert.strictEqual(streak.isValidOffset(14 * 60), true);
  for (const bad of [15 * 60, -13 * 60, NaN, "abc", null, undefined, Infinity]) {
    assert.strictEqual(streak.isValidOffset(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});
