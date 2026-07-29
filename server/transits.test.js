// The Sade Sati memo. This is a performance fix, so the tests have to prove
// two separate things: that it is actually fast, and that it did not quietly
// change any answer to buy that speed.
const test = require("node:test");
const assert = require("node:assert");
const transits = require("./transits");

const DAY = 86400000;
const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);

// Every distinct key costs a real 57ms ephemeris scan, so these use the fewest
// signs and days that still prove the property rather than sweeping all twelve.
test("the memo returns exactly what the real function returns", () => {
  for (const sign of [0, 4, 9]) {
    const direct = transits.computeSadeSatiUncached(sign, Math.floor(NOW / DAY) * DAY);
    const memo = transits.computeSadeSati(sign, NOW);
    assert.deepStrictEqual(memo, direct, `moon sign ${sign} must be unchanged`);
  }
});

test("every moon sign gets its own entry — no collisions", () => {
  const seen = new Map();
  for (let sign = 0; sign < 12; sign++) {
    const r = transits.computeSadeSati(sign, NOW);
    seen.set(sign, r);
  }
  // Saturn is in one place, so exactly three of the twelve signs can be in a
  // Sade Sati window at any instant (12th, 1st and 2nd from that position).
  const active = [...seen.values()].filter(r => r.active).length;
  assert.strictEqual(active, 3, `expected 3 signs in a window, got ${active}`);

  // And each reports a different house, which is what would break on collision.
  const houses = new Set([...seen.values()].map(r => r.houseFromMoon));
  assert.strictEqual(houses.size, 12, "each sign should sit in a distinct house from Saturn");
});

test("the clock is quantised to the day, so time of day does not matter", () => {
  const morning = transits.computeSadeSati(4, Date.UTC(2026, 6, 30, 0, 30));
  const midday = transits.computeSadeSati(4, Date.UTC(2026, 6, 30, 12, 0));
  const night = transits.computeSadeSati(4, Date.UTC(2026, 6, 30, 23, 45));
  assert.deepStrictEqual(morning, midday);
  assert.deepStrictEqual(midday, night);
});

test("a new day is recomputed, not served from yesterday", () => {
  const d1 = Math.floor(Date.UTC(2026, 6, 30, 12) / DAY);
  const d2 = Math.floor(Date.UTC(2026, 6, 31, 12) / DAY);
  assert.notStrictEqual(d1, d2, "the two days must land in different buckets");
  // Same sign, consecutive days: both must equal their own direct computation.
  for (const [label, ms] of [["day 1", Date.UTC(2026, 6, 30, 12)], ["day 2", Date.UTC(2026, 6, 31, 12)]]) {
    const memo = transits.computeSadeSati(7, ms);
    const direct = transits.computeSadeSatiUncached(7, Math.floor(ms / DAY) * DAY);
    assert.deepStrictEqual(memo, direct, `${label} must be computed for that day`);
  }
});

test("callers get their own copy — one mutating can't corrupt the rest", () => {
  const a = transits.computeSadeSati(2, NOW);
  a.phaseLabel = "MUTATED";
  a.smallPanoti.active = "MUTATED";
  const b = transits.computeSadeSati(2, NOW);
  assert.notStrictEqual(b.phaseLabel, "MUTATED", "top-level mutation leaked");
  assert.notStrictEqual(b.smallPanoti.active, "MUTATED", "nested mutation leaked");
});

test("the memo is bounded — it can't grow without limit", () => {
  // 26 distinct days: the fewest that pushes past the 24-entry ceiling and so
  // proves the clear actually fires. More would only cost 57ms each.
  for (let i = 0; i < 26; i++) transits.computeSadeSati(i % 12, NOW + i * DAY);
  assert.ok(transits._memoSize() <= 24, `memo grew to ${transits._memoSize()}`);
});

// The whole point of the change. Not a tight threshold — just proof that a
// repeat lookup is not doing the 42-year ephemeris scan again.
test("a repeat lookup is dramatically cheaper than computing it", () => {
  const ms = Date.UTC(2026, 6, 30, 12);
  const t = () => Number(process.hrtime.bigint()) / 1e6;

  let a = t();
  transits.computeSadeSatiUncached(9, ms);
  const cold = t() - a;

  transits.computeSadeSati(9, ms); // prime
  a = t();
  for (let i = 0; i < 50; i++) transits.computeSadeSati(9, ms);
  const warm = (t() - a) / 50;

  assert.ok(warm < cold / 20,
    `expected a warm lookup to be >20x cheaper; cold=${cold.toFixed(1)}ms warm=${warm.toFixed(3)}ms`);
});
