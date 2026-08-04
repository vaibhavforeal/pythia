// Yoga detection is about to have its dignity tables pulled out into
// dignity.js. That refactor must not change a single detection, so this pins
// the output for a chart chosen to trip several distinct rules at once.
const test = require("node:test");
const assert = require("node:assert");
const { detectYogas } = require("./yogas");

// Aries ascendant. Mars exalted in Capricorn (the 10th, a kendra) → Ruchaka.
// Jupiter in Cancer (exalted, 4th) with the Moon in Cancer → Gaja Kesari.
const PLANETS = [
  { key: "Sun", signIndex: 0, house: 1, sign: "Aries" },
  { key: "Moon", signIndex: 3, house: 4, sign: "Cancer" },
  { key: "Mars", signIndex: 9, house: 10, sign: "Capricorn" },
  { key: "Mercury", signIndex: 0, house: 1, sign: "Aries" },
  { key: "Jupiter", signIndex: 3, house: 4, sign: "Cancer" },
  { key: "Venus", signIndex: 1, house: 2, sign: "Taurus" },
  { key: "Saturn", signIndex: 6, house: 7, sign: "Libra" },
  { key: "Rahu", signIndex: 2, house: 3, sign: "Gemini" },
  { key: "Ketu", signIndex: 8, house: 9, sign: "Sagittarius" }
];

function fixture() {
  const planets = PLANETS.map(p => ({
    ...p, aspectsTo: [], aspectedBy: [], conjunctWith: []
  }));
  // Same-sign pairs are conjunct.
  for (const a of planets) {
    a.conjunctWith = planets.filter(b => b.key !== a.key && b.signIndex === a.signIndex).map(b => b.key);
  }
  return { planets, ascendant: { signIndex: 0, sign: "Aries" } };
}

test("the fixture chart yields a stable set of yogas", () => {
  const keys = detectYogas(fixture()).map(y => y.key).sort();
  assert.ok(keys.includes("mp_Mars"), "Mars exalted in the 10th is Ruchaka");
  assert.ok(keys.includes("mp_Saturn"), "Saturn exalted in the 7th is Sasa");
  // Snapshot the whole set so an accidental addition or loss is caught too.
  assert.deepStrictEqual(keys, PINNED, `yoga set changed:\n${keys.join("\n")}`);
});

// Filled in at Step 2 from the actual run — this is a pin, not a prediction.
const PINNED = [
  'budhaditya',
  'gajakesari',
  'kalasarpa',
  'mp_Jupiter',
  'mp_Mars',
  'mp_Saturn',
  'raja_Moon_Jupiter'
];
