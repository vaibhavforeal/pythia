// Dignity, natural friendship and combustion — the primitives every strength
// read is built on. These are tables, so the tests are mostly "did we type it
// in correctly", plus the two rules that are easy to get backwards: combustion
// is a rashi-only fact, and vargottama is a varga-only one.
const test = require("node:test");
const assert = require("node:assert");
const d = require("./dignity");

test("dignityOf reads the classical tables", () => {
  assert.equal(d.dignityOf("Sun", 0), "exalted");        // Aries
  assert.equal(d.dignityOf("Sun", 6), "debilitated");    // Libra
  assert.equal(d.dignityOf("Saturn", 10), "own");        // Aquarius
  assert.equal(d.dignityOf("Saturn", 6), "exalted");     // Libra
  assert.equal(d.dignityOf("Mars", 5), "enemy");         // Virgo, Mercury's sign
  assert.equal(d.dignityOf("Jupiter", 0), "friend");     // Aries, Mars' sign
  assert.equal(d.dignityOf("Moon", 9), "neutral");       // Capricorn, Saturn's sign
});

test("natural friendship is not symmetric", () => {
  // Venus counts Saturn a friend; Saturn counts Venus a friend too, but the
  // Sun/Venus pair is the classic asymmetry check in the other direction.
  assert.equal(d.dignityOf("Venus", 4), "enemy");        // Leo, Sun's sign
  assert.equal(d.dignityOf("Sun", 1), "enemy");          // Taurus, Venus' sign
  assert.equal(d.dignityOf("Mercury", 4), "friend");     // Leo, Sun's sign
  assert.equal(d.dignityOf("Sun", 2), "neutral");        // Gemini, Mercury's sign
});

test("combustion is an angular fact, and the Sun is never combust", () => {
  const sun = { key: "Sun", lon: 100 };
  assert.equal(d.isCombust({ key: "Sun", lon: 100 }, sun), false);
  assert.equal(d.isCombust({ key: "Mercury", lon: 105 }, sun), true);   // 5 < 14
  assert.equal(d.isCombust({ key: "Mercury", lon: 120 }, sun), false);  // 20 > 14
  assert.equal(d.isCombust({ key: "Venus", lon: 95 }, sun), true);      // 5 < 10
  assert.equal(d.isCombust({ key: "Saturn", lon: 118 }, sun), false);   // 18 > 15
});

test("combustion wraps across 0 degrees", () => {
  const sun = { key: "Sun", lon: 359 };
  assert.equal(d.isCombust({ key: "Jupiter", lon: 3 }, sun), true);     // 4 < 11
});

test("gradePlanet bands", () => {
  // exalted (+2) in a kendra (+1) = 3
  const strong = d.gradePlanet({ key: "Saturn", signIndex: 6, house: 10 });
  assert.equal(strong.score, 3);
  assert.equal(strong.band, "strong");

  // debilitated (-2) in a dusthana (-1) = -3
  const weak = d.gradePlanet({ key: "Saturn", signIndex: 0, house: 12 });
  assert.equal(weak.score, -3);
  assert.equal(weak.band, "weak");

  // neutral (0) in a neutral house (0) = 0
  const mixed = d.gradePlanet({ key: "Moon", signIndex: 9, house: 3 });
  assert.equal(mixed.score, 0);
  assert.equal(mixed.band, "mixed");
});

test("band boundaries sit at 2 and 0", () => {
  assert.equal(d.gradePlanet({ key: "Jupiter", signIndex: 0, house: 3 }).band, "mixed");   // friend +1
  assert.equal(d.gradePlanet({ key: "Jupiter", signIndex: 0, house: 1 }).band, "strong");  // +1 +1 = 2
  assert.equal(d.gradePlanet({ key: "Mars", signIndex: 5, house: 3 }).band, "weak");       // enemy -1
});

test("combustion costs a point; vargottama earns one", () => {
  const base = d.gradePlanet({ key: "Mercury", signIndex: 5, house: 3 });          // own +2
  const burnt = d.gradePlanet({ key: "Mercury", signIndex: 5, house: 3, combust: true });
  const varg = d.gradePlanet({ key: "Mercury", signIndex: 5, house: 3, vargottama: true });
  assert.equal(burnt.score, base.score - 1);
  assert.equal(varg.score, base.score + 1);
});

test("reasons explain the score", () => {
  const g = d.gradePlanet({ key: "Saturn", signIndex: 0, house: 12, combust: true });
  assert.ok(g.reasons.some(r => /debilitated/i.test(r)));
  assert.ok(g.reasons.some(r => /12th/.test(r)));
  assert.ok(g.reasons.some(r => /combust/i.test(r)));
});
