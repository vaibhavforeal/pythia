# Jyotish Synthesis Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each situation card read from its own divisional chart and the lagna lord's condition, with dasha and transits demoted to shading, and print only the single highest-ranked factor.

**Architecture:** A new `server/dignity.js` owns planetary dignity, natural friendship and combustion. A new `server/synthesis.js` grades each domain's house lord twice — once in D1 (promise), once in that domain's varga (sustain) — crosses the two into an agreement verdict, and picks which single factor the card prints. `computeChart` attaches the result as `c.synthesis`, so the card and the chat answer read from one source. `public/domains.js` becomes a renderer over that precomputed object.

**Tech Stack:** Node 18+, CommonJS, `node --test` (node:test + node:assert), Express, vanilla browser JS loaded via `<script>` tags.

**Spec:** `docs/superpowers/specs/2026-08-04-jyotish-synthesis-hierarchy-design.md`

## Global Constraints

- CommonJS only (`"type": "commonjs"`). No ESM `import`/`export`.
- Tests run with `npm test` (`node --test`). Use `node:test` and `node:assert`, matching `server/transits.test.js`.
- **D9 is not in `chart.divisionals`.** `VARGA_DEFS` in `server/vargas.js:17` starts at D2 and has no D9 entry. The navamsa lives at `chart.navamsa`. Any code resolving a varga by key must special-case `"D9"`.
- **Field name differs by source.** `chart.navamsa.planets[].vargottama` vs `chart.divisionals[].planets[].sameAsRashi`. Both mean "same sign as D1".
- Dignity is sign-level only. No exaltation degrees, no moolatrikona degree ranges.
- Every new table carries a source citation comment in-file.
- Verdicts describe conditions, never outcomes. Existing rule at `public/domains.js:175`.
- `public/*.js` files run in the browser as globals and must keep the
  `if (typeof module !== "undefined" && module.exports)` guard so tests can require them.
- Commit after every task.

---

## File Structure

| file | responsibility |
|---|---|
| `server/dignity.js` | **new** — dignity tables, natural friendship, combustion, `gradePlanet` |
| `server/dignity.test.js` | **new** — grading bands, combustion, friendship |
| `server/synthesis.js` | **new** — `DOMAIN_SPEC`, lagna lord condition, per-domain three-tier read, verdict, slot-2 pick |
| `server/synthesis.test.js` | **new** — verdict matrix, asymmetry, tier isolation, slot-2 suppression, key parity |
| `server/yogas.js` | modify — import dignity tables instead of defining them |
| `server/yogas.test.js` | **new** — pins detection output across the table extraction |
| `server/astro.js` | modify — attach `c.synthesis`; rank the varga output in `chartToText` |
| `server/index.js` | modify — backfill `synthesis` on stored-conversation read |
| `public/domains.js` | rewrite — copy table + career; renderer over `c.synthesis` |
| `public/app.js` | modify — lagna lord line in `renderCosmicId` |
| `public/styles.css` | modify — one rule for verdict emphasis |

---

### Task 1: `server/dignity.js` — the primitives

**Files:**
- Create: `server/dignity.js`
- Test: `server/dignity.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SIGN_LORD: string[12]`
  - `EXALT_SIGN`, `DEBIL_SIGN`, `OWN_SIGNS`, `EXALTED_IN_SIGN` — objects, shapes identical to the current ones in `server/yogas.js:15-22`
  - `dignityOf(planetKey, signIndex) -> "exalted"|"own"|"friend"|"neutral"|"enemy"|"debilitated"`
  - `isCombust(planet, sun) -> boolean` — both args are D1 planet objects carrying `.key` and `.lon`
  - `gradePlanet({ key, signIndex, house, combust, vargottama }) -> { score: number, band: "strong"|"mixed"|"weak", reasons: string[] }`

- [ ] **Step 1: Write the failing test**

Create `server/dignity.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/dignity.test.js`
Expected: FAIL with `Cannot find module './dignity'`

- [ ] **Step 3: Write the implementation**

Create `server/dignity.js`:

```js
// Planetary dignity, natural friendship and combustion — the primitives behind
// every strength read in the app.
//
// This is a DOCUMENTED HEURISTIC, NOT SHADBALA. Classical six-fold strength
// (sthana, dig, kala, chesta, naisargika, drik bala) is a much larger
// computation and is not attempted here. What this gives you is a small,
// auditable ordinal with its reasoning attached — enough to say "strong in the
// rashi, weak in the varga" honestly, and no more than that.
//
// Dignity is SIGN-LEVEL only: no exact exaltation degrees, no moolatrikona
// degree ranges. Those vary by source and the extra precision would not change
// any band this module produces.

// Lord of each sign, Aries → Pisces. Matches astro.js SIGNS.
const SIGN_LORD = [
  "Mars", "Venus", "Mercury", "Moon", "Sun", "Mercury",
  "Venus", "Mars", "Jupiter", "Saturn", "Saturn", "Jupiter"
];

const EXALT_SIGN = { Sun: 0, Moon: 1, Mars: 9, Mercury: 5, Jupiter: 3, Venus: 11, Saturn: 6 };
const DEBIL_SIGN = { Sun: 6, Moon: 7, Mars: 3, Mercury: 11, Jupiter: 9, Venus: 5, Saturn: 0 };
const OWN_SIGNS = {
  Sun: [4], Moon: [3], Mars: [0, 7], Mercury: [2, 5],
  Jupiter: [8, 11], Venus: [1, 6], Saturn: [9, 10]
};
const EXALTED_IN_SIGN = {}; // sign index → planet exalted there
for (const [p, s] of Object.entries(EXALT_SIGN)) EXALTED_IN_SIGN[s] = p;

// Naisargika maitri — natural friendship. Source: Brihat Parashara Hora Shastra,
// ch. 3 (Graha Maitri). Deliberately asymmetric: Mercury counts the Sun a
// friend while the Sun counts Mercury neutral, and that asymmetry is real, not
// a typo. Rahu and Ketu are absent and do not need to be here — they own no
// sign, so they can never be a house lord or the lagna lord.
const FRIENDS = {
  Sun: ["Moon", "Mars", "Jupiter"],
  Moon: ["Sun", "Mercury"],
  Mars: ["Sun", "Moon", "Jupiter"],
  Mercury: ["Sun", "Venus"],
  Jupiter: ["Sun", "Moon", "Mars"],
  Venus: ["Mercury", "Saturn"],
  Saturn: ["Mercury", "Venus"]
};
const ENEMIES = {
  Sun: ["Venus", "Saturn"],
  Moon: [],
  Mars: ["Mercury"],
  Mercury: ["Moon"],
  Jupiter: ["Mercury", "Venus"],
  Venus: ["Sun", "Moon"],
  Saturn: ["Sun", "Moon", "Mars"]
};

// Combustion (astangata) orbs in degrees from the Sun. Source: BPHS ch. 46.
// The common retrograde variants (Mercury 12°, Venus 8°) are NOT applied — the
// simple set is used, consistent with the sign-level decision above.
const COMBUST_ORB = { Moon: 12, Mars: 17, Mercury: 14, Jupiter: 11, Venus: 10, Saturn: 15 };

const KENDRA_TRIKONA = new Set([1, 4, 5, 7, 9, 10]);
const DUSTHANA = new Set([6, 8, 12]);

function ord(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const SIGN_NAMES = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"
];

/** Where a planet stands in the sign it occupies. */
function dignityOf(planetKey, signIndex) {
  if (EXALT_SIGN[planetKey] === signIndex) return "exalted";
  if (DEBIL_SIGN[planetKey] === signIndex) return "debilitated";
  if ((OWN_SIGNS[planetKey] || []).includes(signIndex)) return "own";
  const host = SIGN_LORD[signIndex];
  if ((FRIENDS[planetKey] || []).includes(host)) return "friend";
  if ((ENEMIES[planetKey] || []).includes(host)) return "enemy";
  return "neutral";
}

/**
 * Combustion is a longitude-versus-Sun fact, so it is a RASHI property and
 * never propagates into a divisional chart. Both args are D1 planet objects.
 */
function isCombust(planet, sun) {
  if (!planet || !sun || planet.key === "Sun") return false;
  const orb = COMBUST_ORB[planet.key];
  if (!orb) return false; // Rahu/Ketu are not burnt
  let sep = Math.abs(planet.lon - sun.lon) % 360;
  if (sep > 180) sep = 360 - sep;
  return sep < orb;
}

const DIGNITY_SCORE = {
  exalted: 2, own: 2, friend: 1, neutral: 0, enemy: -1, debilitated: -2
};

/**
 * One ordinal, its reasons, and a band. The number is internal — the UI only
 * ever shows the band or a phrase derived from it.
 *
 * `combust` applies in the rashi only. `vargottama` applies in a varga only
 * (in D1 a planet is trivially in its own sign, so it would be meaningless).
 * Retrogradity is deliberately absent: classically it cuts both ways, so it is
 * surfaced as a flag elsewhere rather than scored here.
 */
function gradePlanet({ key, signIndex, house, combust = false, vargottama = false }) {
  const reasons = [];
  const dig = dignityOf(key, signIndex);
  let score = DIGNITY_SCORE[dig];

  if (dig === "own") reasons.push(`own sign (${SIGN_NAMES[signIndex]})`);
  else if (dig === "exalted") reasons.push(`exalted in ${SIGN_NAMES[signIndex]}`);
  else if (dig === "debilitated") reasons.push(`debilitated in ${SIGN_NAMES[signIndex]}`);
  else reasons.push(`${dig} sign (${SIGN_NAMES[signIndex]})`);

  if (KENDRA_TRIKONA.has(house)) {
    score += 1;
    reasons.push(`${ord(house)} house — a kendra or trikona`);
  } else if (DUSTHANA.has(house)) {
    score -= 1;
    reasons.push(`${ord(house)} house — a dusthana`);
  }

  if (combust) {
    score -= 1;
    reasons.push("combust — too close to the Sun");
  }
  if (vargottama) {
    score += 1;
    reasons.push("vargottama — same sign as the rashi");
  }

  const band = score >= 2 ? "strong" : score >= 0 ? "mixed" : "weak";
  return { score, band, reasons };
}

module.exports = {
  SIGN_LORD, SIGN_NAMES, EXALT_SIGN, DEBIL_SIGN, OWN_SIGNS, EXALTED_IN_SIGN,
  FRIENDS, ENEMIES, COMBUST_ORB,
  dignityOf, isCombust, gradePlanet, ord
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/dignity.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add server/dignity.js server/dignity.test.js
git commit -m "feat: add dignity, natural friendship and combustion primitives"
```

---

### Task 2: Point `yogas.js` at the shared tables

**Files:**
- Create: `server/yogas.test.js`
- Modify: `server/yogas.js:10-23`

**Interfaces:**
- Consumes: `SIGN_LORD`, `EXALT_SIGN`, `DEBIL_SIGN`, `OWN_SIGNS`, `EXALTED_IN_SIGN` from Task 1.
- Produces: nothing new. `detectYogas` keeps its existing signature and output.

This task changes no behaviour. The test exists to prove that.

- [ ] **Step 1: Write the failing test**

Create `server/yogas.test.js`:

```js
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
const PINNED = [];
```

- [ ] **Step 2: Run it, then pin the real output**

Run: `node --test server/yogas.test.js`
Expected: FAIL on the `deepStrictEqual`, printing the actual sorted key list.

Copy that printed list into `PINNED` verbatim, then re-run. Expected: PASS.

Commit the pinned test before touching `yogas.js` — the pin is only meaningful if it was captured from the pre-refactor code.

```bash
git add server/yogas.test.js
git commit -m "test: pin yoga detection output before extracting the dignity tables"
```

- [ ] **Step 3: Replace the local tables with imports**

In `server/yogas.js`, delete lines 10-23 (the `SIGN_LORD`, `EXALT_SIGN`, `DEBIL_SIGN`, `OWN_SIGNS` and `EXALTED_IN_SIGN` definitions, including the `for` loop that fills `EXALTED_IN_SIGN`) and replace with:

```js
// Dignity tables live in dignity.js so the synthesis engine and the yoga
// detector cannot drift apart.
const {
  SIGN_LORD, EXALT_SIGN, DEBIL_SIGN, OWN_SIGNS, EXALTED_IN_SIGN
} = require("./dignity");
```

Leave the `MAHAPURUSHA`, `SEVEN` and `CATEGORY_ORDER` constants below it untouched.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. `yogas.test.js` proves detection is unchanged; nothing else should move.

- [ ] **Step 5: Commit**

```bash
git add server/yogas.js
git commit -m "refactor: read dignity tables from dignity.js in the yoga detector"
```

---

### Task 3: `server/synthesis.js` — tiers, verdict and slot pick

**Files:**
- Create: `server/synthesis.js`
- Test: `server/synthesis.test.js`

**Interfaces:**
- Consumes: `dignityOf`, `isCombust`, `gradePlanet`, `SIGN_LORD`, `ord` from Task 1.
- Produces:
  - `DOMAIN_SPEC` — object keyed by domain, each `{ house, second, varga, vargaRole }`
  - `lagnaLordCondition(chart) -> { key, house, sign, dignity, combust, retro, score, band, reasons }`
  - `domainSynthesis(chart, key) -> domain object` (shape in the spec's Data shape section)
  - `computeSynthesis(chart) -> { lagnaLord, domains }`
  - `VERDICTS` — the four verdict slugs as an object, for the renderer to switch on

- [ ] **Step 1: Write the failing test**

Create `server/synthesis.test.js`:

```js
// The synthesis hierarchy: D1 promises, the varga sustains, the dasha only
// shades. The tests that matter here are the ones guarding rules that are easy
// to get backwards — the weak-D1/strong-varga asymmetry, and the suppression
// order that keeps the era clause off a card that has something better to say.
const test = require("node:test");
const assert = require("node:assert");
const s = require("./synthesis");

// A chart is built by hand rather than through computeChart, because
// computeChart reads Date.now() for transits and the running dasha and would
// make these tests drift with the calendar.
function chart({ ascSign = 1, planets = {}, d9 = {}, vargas = {}, maha = "Ketu", antar = "Venus" } = {}) {
  const KEYS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"];
  const base = k => ({ key: k, signIndex: 0, lon: 0, retro: false, ...(planets[k] || {}) });
  const withHouse = p => ({ ...p, house: ((p.signIndex - ascSign + 12) % 12) + 1 });
  const list = KEYS.map(k => withHouse(base(k)));

  const navPlanets = KEYS.map(k => {
    const o = d9[k] || { signIndex: 0 };
    return { key: k, signIndex: o.signIndex, house: o.house ?? 1, vargottama: !!o.vargottama };
  });

  const divisionals = ["D4", "D10", "D24"].map(key => ({
    key, name: key, governs: "",
    ascendant: { signIndex: 0, sign: "Aries", signLord: "Mars" },
    planets: KEYS.map(k => {
      const o = (vargas[key] || {})[k] || { signIndex: 0 };
      return { key: k, signIndex: o.signIndex, house: o.house ?? 1, sameAsRashi: !!o.sameAsRashi };
    })
  }));

  return {
    ascendant: { signIndex: ascSign, sign: "x", signLord: s.SIGN_LORD_AT(ascSign) },
    planets: list,
    navamsa: { ascendant: { signIndex: 0 }, planets: navPlanets },
    divisionals,
    dasha: { maha: { lord: maha }, antar: { lord: antar } }
  };
}

test("the verdict matrix resolves every band pair", () => {
  const v = s.verdictFor;
  assert.equal(v("strong", "strong"), "holds");
  assert.equal(v("strong", "mixed"), "holds");
  assert.equal(v("mixed", "strong"), "holds");
  assert.equal(v("mixed", "mixed"), "holds");
  assert.equal(v("strong", "weak"), "looks-better-than-it-holds");
  assert.equal(v("mixed", "weak"), "looks-better-than-it-holds");
  assert.equal(v("weak", "strong"), "grows-into-it");
  assert.equal(v("weak", "mixed"), "grows-into-it");
  assert.equal(v("weak", "weak"), "needs-building");
});

test("a strong varga on a weak D1 never reads as holding", () => {
  // The classical rule: the varga cannot manufacture a promise the rashi does
  // not make. It can only show the thing maturing.
  assert.equal(s.verdictFor("weak", "strong"), "grows-into-it");
  assert.notEqual(s.verdictFor("weak", "strong"), "holds");
});

test("career reads D10 and situationships read the navamsa", () => {
  assert.equal(s.DOMAIN_SPEC.career.varga, "D10");
  assert.equal(s.DOMAIN_SPEC.career.house, 10);
  assert.equal(s.DOMAIN_SPEC.situationships.varga, "D9");
  assert.equal(s.DOMAIN_SPEC.situationships.house, 7);
});

test("friendships uses the navamsa as a general strength grade, not as its topic", () => {
  assert.equal(s.DOMAIN_SPEC.friendships.varga, "D9");
  assert.equal(s.DOMAIN_SPEC.friendships.vargaRole, "strength");
  assert.equal(s.DOMAIN_SPEC.situationships.vargaRole, "domain");
});

test("the worked example from the spec: strong in D1, fallen in D10", () => {
  // Taurus ascendant → 10th is Aquarius → Saturn rules it.
  // Saturn sits in Aquarius (own sign, 10th house, a kendra) = strong.
  // In D10 that Saturn falls in Aries (debilitated) in the 12th = weak.
  const c = chart({
    ascSign: 1,
    planets: { Saturn: { signIndex: 10 } },
    vargas: { D10: { Saturn: { signIndex: 0, house: 12 } } },
    maha: "Saturn"
  });
  const r = s.domainSynthesis(c, "career");
  assert.equal(r.lordKey, "Saturn");
  assert.equal(r.promise.band, "strong");
  assert.equal(r.sustain.band, "weak");
  assert.equal(r.verdict, "looks-better-than-it-holds");
});

test("divergence outranks a loud house and the dasha", () => {
  // Same chart: Saturn occupies the house it rules AND the era lord rules it.
  // All three factors are live; only the divergence may be printed.
  const c = chart({
    ascSign: 1,
    planets: { Saturn: { signIndex: 10 }, Jupiter: { signIndex: 10 } },
    vargas: { D10: { Saturn: { signIndex: 0, house: 12 } } },
    maha: "Saturn"
  });
  const r = s.domainSynthesis(c, "career");
  assert.equal(r.occupants.length >= 2, true, "the house is loud");
  assert.equal(r.eraTouches, "rules it", "the era touches it");
  assert.equal(r.slot2, "divergence", "and divergence still wins");
});

test("the dasha is the last thing printed, never the first", () => {
  // Nothing structural to say: lord is mixed in both charts, house is empty,
  // but the era lord rules the house. Only then does shade win the slot.
  const c = chart({
    ascSign: 0,                                   // Aries asc → 11th is Aquarius → Saturn
    planets: { Saturn: { signIndex: 2 } },        // Gemini: neutral, 3rd house
    d9: { Saturn: { signIndex: 2, house: 3 } },   // neutral again
    maha: "Saturn"
  });
  const r = s.domainSynthesis(c, "friendships");
  assert.equal(r.verdict, "holds");
  assert.equal(r.occupants.length, 0);
  assert.equal(r.slot2, "shade");
});

test("combustion counts in the rashi and never in a varga", () => {
  // Mercury rules the 5th from Taurus (Virgo). Put it beside the Sun.
  const c = chart({
    ascSign: 1,
    planets: { Sun: { signIndex: 5, lon: 155 }, Mercury: { signIndex: 5, lon: 158 } },
    vargas: { D24: { Mercury: { signIndex: 5, house: 1 } } }
  });
  const r = s.domainSynthesis(c, "focus");
  assert.equal(r.promise.combust, true);
  assert.ok(r.promise.reasons.some(x => /combust/i.test(x)));
  assert.ok(!r.sustain.reasons.some(x => /combust/i.test(x)), "the varga grade is never burnt");
});

test("vargottama counts in the varga and never in the rashi", () => {
  // Mercury rules the 5th from Taurus. Same sign in D24 as in D1 → vargottama.
  const c = chart({
    ascSign: 1,
    planets: { Mercury: { signIndex: 5 } },
    vargas: { D24: { Mercury: { signIndex: 5, house: 1, sameAsRashi: true } } }
  });
  const r = s.domainSynthesis(c, "focus");
  assert.equal(r.sustain.vargottama, true);
  assert.ok(r.sustain.reasons.some(x => /vargottama/i.test(x)));
  assert.ok(!r.promise.reasons.some(x => /vargottama/i.test(x)), "the rashi grade never claims it");
});

test("the lagna lord condition is computed once, from D1", () => {
  const c = chart({ ascSign: 1, planets: { Venus: { signIndex: 1 } } }); // Taurus asc, Venus in Taurus
  const l = s.lagnaLordCondition(c);
  assert.equal(l.key, "Venus");
  assert.equal(l.house, 1);
  assert.equal(l.dignity, "own");
  assert.equal(l.band, "strong");
});

test("computeSynthesis covers every domain", () => {
  const out = s.computeSynthesis(chart());
  assert.deepStrictEqual(
    Object.keys(out.domains).sort(),
    ["career", "focus", "friendships", "home", "situationships"]
  );
  assert.ok(out.lagnaLord.band);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/synthesis.test.js`
Expected: FAIL with `Cannot find module './synthesis'`

- [ ] **Step 3: Write the implementation**

Create `server/synthesis.js`:

```js
// The synthesis hierarchy.
//
// A practising astrologer's note on the cards: anchor each life area to its
// divisional chart and the lagna lord's condition, and let the dasha shade the
// result rather than drive it. That is the classical sequence — promise, then
// strength, then timing — and this module makes it mechanical:
//
//   BASELINE  lagna lord condition       chart-wide, computed once
//   TIER 1    PROMISE  (D1 rashi)        does this area have substance?
//   TIER 2    SUSTAIN  (domain's varga)  does the promise hold up?
//   TIER 3    SHADE    (dasha)           is it live right now?
//
// A lower tier never overturns a higher one. It only qualifies it.
//
// The varga GRADES the rashi, it does not replace it. Reading career off D10
// alone — rather than off the 10th house and then D10 — is the classic varga
// error and produces readings untethered from the birth chart.

const { gradePlanet, dignityOf, isCombust, SIGN_LORD } = require("./dignity");

// The structural half of the domain table. The voice half — emoji, kicker,
// headline, the question each card asks — lives in public/domains.js, because
// it is copy and belongs next to the renderer.
//
// vargaRole "domain" means the varga governs this topic. "strength" means it is
// only being used as a general strength grade — which is what the navamsa
// classically is for every planet and every topic. Friendships needs that
// escape hatch: there is no D11, and D3 is siblings and courage, not network
// and gains, so grading the 11th lord in D9 is the honest option and inventing
// a friendship varga is not.
const DOMAIN_SPEC = {
  friendships:    { house: 11, second: 3,  varga: "D9",  vargaRole: "strength" },
  situationships: { house: 7,  second: 5,  varga: "D9",  vargaRole: "domain" },
  home:           { house: 4,  second: 9,  varga: "D4",  vargaRole: "domain" },
  focus:          { house: 5,  second: 10, varga: "D24", vargaRole: "domain" },
  career:         { house: 10, second: 6,  varga: "D10", vargaRole: "domain" }
};

const VARGA_LABEL = {
  D9: "navamsa", D4: "Chaturthamsa", D10: "Dasamsa", D24: "Siddhamsa"
};

const VERDICTS = {
  HOLDS: "holds",
  LOOKS_BETTER: "looks-better-than-it-holds",
  GROWS: "grows-into-it",
  NEEDS_BUILDING: "needs-building"
};

const BAND_RANK = { weak: 0, mixed: 1, strong: 2 };

/**
 * Cross the rashi band with the varga band.
 *
 * The asymmetry is the whole point and is easy to get backwards: a strong varga
 * on a weak D1 does NOT manufacture a promise that was never made. It shows the
 * thing maturing — "grows into it", not "holds".
 */
function verdictFor(d1Band, vargaBand) {
  const a = BAND_RANK[d1Band], b = BAND_RANK[vargaBand];
  if (b < a && b === 0) return VERDICTS.LOOKS_BETTER;   // a drop that lands in weak
  if (b > a && a === 0) return VERDICTS.GROWS;          // a rise that starts from weak
  if (a === 0 && b === 0) return VERDICTS.NEEDS_BUILDING;
  return VERDICTS.HOLDS;
}

/** Whole-sign: the sign occupying the nth house from the ascendant. */
function houseSignIndex(chart, n) {
  const asc = chart && chart.ascendant && chart.ascendant.signIndex;
  if (!Number.isInteger(asc)) return null;
  return (((asc + n - 1) % 12) + 12) % 12;
}

/**
 * Find a planet in a divisional chart. D9 is NOT in chart.divisionals — the
 * VARGA_DEFS list in vargas.js starts at D2 — so the navamsa is fetched from
 * its own top-level slot. The two sources also disagree on the field name for
 * "same sign as the rashi", hence the normalisation.
 */
function vargaPlacement(chart, vargaKey, planetKey) {
  if (vargaKey === "D9") {
    const p = ((chart.navamsa && chart.navamsa.planets) || []).find(x => x.key === planetKey);
    return p ? { signIndex: p.signIndex, house: p.house, vargottama: !!p.vargottama } : null;
  }
  const v = (chart.divisionals || []).find(x => x.key === vargaKey);
  if (!v) return null;
  const p = (v.planets || []).find(x => x.key === planetKey);
  return p ? { signIndex: p.signIndex, house: p.house, vargottama: !!p.sameAsRashi } : null;
}

/** BASELINE: can this person act on anything the rest of the chart shows? */
function lagnaLordCondition(chart) {
  const ascIdx = chart && chart.ascendant && chart.ascendant.signIndex;
  if (!Number.isInteger(ascIdx)) return null;
  const key = SIGN_LORD[ascIdx];
  const pl = (chart.planets || []).find(p => p.key === key);
  if (!pl) return null;
  const sun = (chart.planets || []).find(p => p.key === "Sun");
  const combust = isCombust(pl, sun);
  const g = gradePlanet({ key, signIndex: pl.signIndex, house: pl.house, combust });
  return {
    key, house: pl.house, sign: pl.sign, signIndex: pl.signIndex,
    dignity: dignityOf(key, pl.signIndex),
    combust, retro: !!pl.retro,
    ...g
  };
}

/**
 * Which single factor the card is allowed to print. Everything that loses is
 * still computed and still reaches the model — it is just not shown.
 *
 * Divergence ranks first because the most useful thing to say is where the
 * tiers disagree, which is the entire reason to compute a varga.
 *
 * Note the split in the agreement cases. "Needs building" is a real finding and
 * outranks the era. A bare "holds" is the least surprising thing a card can
 * say, so it drops BELOW the era touch — otherwise it would fire on every
 * ordinary chart and the shade branch could never be reached at all. The dasha
 * still ranks under every structural signal, which is the point; it just is not
 * ranked under "nothing to report".
 */
function pickSlot2({ verdict, occupants, lordCompany, eraTouches }) {
  if (verdict === VERDICTS.LOOKS_BETTER || verdict === VERDICTS.GROWS) return "divergence";
  if (occupants.length >= 2 || lordCompany.length) return "loud";
  if (verdict === VERDICTS.NEEDS_BUILDING) return "agreement";
  if (eraTouches) return "shade";
  if (verdict === VERDICTS.HOLDS) return "agreement";
  return null;
}

function domainSynthesis(chart, key) {
  const spec = DOMAIN_SPEC[key];
  if (!spec || !chart || !chart.planets) return null;

  const signIdx = houseSignIndex(chart, spec.house);
  if (signIdx === null) return null;

  const lordKey = SIGN_LORD[signIdx];
  const lord = chart.planets.find(p => p.key === lordKey);
  if (!lord) return null;

  const sun = chart.planets.find(p => p.key === "Sun");

  // TIER 1 — promise, from the rashi. Combustion belongs here and only here.
  const combust = isCombust(lord, sun);
  const promise = {
    house: lord.house,
    signIndex: lord.signIndex,
    sign: lord.sign,
    dignity: dignityOf(lordKey, lord.signIndex),
    combust,
    retro: !!lord.retro,
    ...gradePlanet({ key: lordKey, signIndex: lord.signIndex, house: lord.house, combust })
  };

  // TIER 2 — sustain, from the domain's varga. Vargottama belongs here and only
  // here; in D1 a planet is trivially in its own sign.
  const vp = vargaPlacement(chart, spec.varga, lordKey);
  const sustain = vp
    ? {
        varga: spec.varga,
        vargaName: VARGA_LABEL[spec.varga] || spec.varga,
        role: spec.vargaRole,
        house: vp.house,
        signIndex: vp.signIndex,
        dignity: dignityOf(lordKey, vp.signIndex),
        vargottama: vp.vargottama,
        ...gradePlanet({
          key: lordKey, signIndex: vp.signIndex, house: vp.house, vargottama: vp.vargottama
        })
      }
    : null;

  const verdict = sustain ? verdictFor(promise.band, sustain.band) : null;

  const occupants = chart.planets.filter(p => p.house === spec.house && p.key !== "Ketu").map(p => p.key);
  const secondOccupants = chart.planets.filter(p => p.house === spec.second).map(p => p.key);

  // Malefics and benefics sitting with the lord — the "loud" signal.
  const MALEFIC = ["Saturn", "Mars", "Rahu", "Ketu"];
  const BENEFIC = ["Jupiter", "Venus"];
  const lordCompany = chart.planets
    .filter(p => p.key !== lordKey && p.signIndex === lord.signIndex)
    .filter(p => MALEFIC.includes(p.key) || BENEFIC.includes(p.key))
    .map(p => p.key);

  // TIER 3 — shade. Three ways the running era can touch this part of life.
  const maha = (chart.dasha && chart.dasha.maha && chart.dasha.maha.lord) || null;
  const antar = (chart.dasha && chart.dasha.antar && chart.dasha.antar.lord) || null;
  const mahaPlanet = chart.planets.find(p => p.key === maha);
  const eraTouches =
    maha === lordKey ? "rules it" :
    mahaPlanet && mahaPlanet.house === spec.house ? "sits in it" :
    null;

  const slot2 = pickSlot2({ verdict, occupants, lordCompany, eraTouches });

  return {
    key,
    house: spec.house, second: spec.second, sign: lord.sign, signIndex: signIdx,
    lordKey, promise, sustain, verdict,
    occupants, secondOccupants, lordCompany,
    maha, antar, eraTouches, slot2
  };
}

function computeSynthesis(chart) {
  const domains = {};
  for (const key of Object.keys(DOMAIN_SPEC)) {
    const r = domainSynthesis(chart, key);
    if (r) domains[key] = r;
  }
  return { lagnaLord: lagnaLordCondition(chart), domains };
}

// Exposed for the test fixture, which needs to name the lord of an ascendant.
const SIGN_LORD_AT = i => SIGN_LORD[i];

module.exports = {
  DOMAIN_SPEC, VERDICTS, VARGA_LABEL,
  verdictFor, lagnaLordCondition, domainSynthesis, computeSynthesis,
  vargaPlacement, pickSlot2, SIGN_LORD_AT
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/synthesis.test.js`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add server/synthesis.js server/synthesis.test.js
git commit -m "feat: add the three-tier synthesis engine with the D1-vs-varga verdict"
```

---

### Task 4: Attach `synthesis` to every computed chart

**Files:**
- Modify: `server/astro.js:9` (imports), `server/astro.js:228-262` (compute and return)

**Interfaces:**
- Consumes: `computeSynthesis` from Task 3.
- Produces: `chart.synthesis` on every object returned by `computeChart`.

- [ ] **Step 1: Write the failing test**

Append to `server/synthesis.test.js`:

```js
test("computeChart attaches synthesis to a real chart", () => {
  const { computeChart } = require("./astro");
  const c = computeChart({
    year: 1996, month: 3, day: 14, hour: 9, minute: 25,
    lat: 12.9716, lon: 77.5946, tz: 5.5
  });
  assert.ok(c.synthesis, "synthesis is attached");
  assert.ok(c.synthesis.lagnaLord.key, "the lagna lord is named");
  assert.equal(Object.keys(c.synthesis.domains).length, 5);
  // The career read must have actually looked at D10, not at D1 twice.
  assert.equal(c.synthesis.domains.career.sustain.varga, "D10");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/synthesis.test.js`
Expected: FAIL — `synthesis is attached` (the property is undefined)

- [ ] **Step 3: Wire it in**

In `server/astro.js`, add to the imports beside line 9:

```js
const { computeSynthesis } = require("./synthesis");
```

Then, immediately after the `const dasha = computeDasha(...)` line (currently `:233`), add:

```js
  // Synthesis reads the rashi, the navamsa, the divisionals and the dasha, so
  // it has to run after all four exist.
  const synthesis = computeSynthesis({ ascendant, planets, navamsa, divisionals, dasha });
```

And add `synthesis,` to the returned object, directly after `dasha,` (currently `:259`).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/astro.js server/synthesis.test.js
git commit -m "feat: attach the synthesis read to every computed chart"
```

---

### Task 5: Rank the varga output in `chartToText`

**Files:**
- Modify: `server/astro.js:270-271` (ascendant line), `server/astro.js:336-345` (varga block)

**Interfaces:**
- Consumes: `chart.synthesis` from Task 4, `DOMAIN_SPEC` and `VARGA_LABEL` from Task 3.
- Produces: nothing new. `chartToText` keeps its signature.

- [ ] **Step 1: Write the failing test**

Append to `server/synthesis.test.js`:

```js
test("chartToText ranks the vargas instead of dumping them flat", () => {
  const { computeChart, chartToText } = require("./astro");
  const txt = chartToText(computeChart({
    year: 1996, month: 3, day: 14, hour: 9, minute: 25,
    lat: 12.9716, lon: 77.5946, tz: 5.5
  }));
  assert.ok(/PRIMARY VARGAS/.test(txt), "the anchors get their own section");
  assert.ok(/lagna lord/i.test(txt), "the lagna lord condition is stated");
  assert.ok(/supplementary/i.test(txt), "the remaining vargas are marked as reference");
  // The primary section must precede the supplementary table.
  assert.ok(txt.indexOf("PRIMARY VARGAS") < txt.indexOf("supplementary"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/synthesis.test.js`
Expected: FAIL — `the anchors get their own section`

- [ ] **Step 3: Edit `chartToText`**

**(a)** After the existing ascendant `L.push(...)` block (`:269-272`), append the baseline:

```js
  if (c.synthesis && c.synthesis.lagnaLord) {
    const l = c.synthesis.lagnaLord;
    L.push(
      `Lagna lord condition: ${l.key} in the ${ord(l.house)} house, ${l.dignity}` +
        `${l.combust ? ", combust" : ""} — ${l.band.toUpperCase()}. ` +
        `This is the baseline for how much the native can act on anything below.`
    );
  }
```

**(b)** Replace the varga block at `:336-345` with:

```js
  if (c.synthesis && c.synthesis.domains) {
    L.push("");
    L.push("=== PRIMARY VARGAS — the divisional chart that governs each life area ===");
    L.push(
      "Read these in order: the RASHI states the promise, the varga states whether it " +
        "sustains, and only then does the dasha say whether it is live. A varga grades " +
        "the rashi; it never replaces it."
    );
    for (const [key, dom] of Object.entries(c.synthesis.domains)) {
      if (!dom.sustain) continue;
      const role = dom.sustain.role === "strength" ? " (general strength grade, not a topic chart)" : "";
      L.push(
        `- ${key} — ${ord(dom.house)} house, ruled by ${dom.lordKey}. ` +
          `RASHI: ${dom.promise.dignity}, ${ord(dom.promise.house)} house — ${dom.promise.band}. ` +
          `${dom.sustain.varga} ${dom.sustain.vargaName}${role}: ${dom.sustain.dignity}, ` +
          `${ord(dom.sustain.house)} house — ${dom.sustain.band}. ` +
          `VERDICT: ${dom.verdict.replace(/-/g, " ")}.`
      );
    }
  }

  if (c.divisionals && c.divisionals.length) {
    L.push("");
    L.push(
      "=== Divisional charts (vargas) — supplementary reference only ==="
    );
    L.push(
      "The primary vargas for synthesis are listed above. Everything below is " +
        "background detail and must not outweigh the rashi or the primary vargas."
    );
    for (const v of c.divisionals) {
      const pl = v.planets
        .map(p => `${PLANET_ABBR[p.key] || p.key} ${p.sign.slice(0, 3)}/${p.house}`)
        .join("  ");
      L.push(`${v.key} ${v.name} · ${v.governs} — Lagna ${v.ascendant.sign} | ${pl}`);
    }
  }
```

`ord` and `PLANET_ABBR` in the code above are the ones already defined locally in `server/astro.js` (`:81` and `:14`). No new import is needed for this task.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/astro.js server/synthesis.test.js
git commit -m "feat: rank the varga context so D9 stops arriving weighted like D40"
```

---

### Task 6: Backfill `synthesis` on stored conversations

**Files:**
- Modify: `server/index.js:1378-1387`

**Interfaces:**
- Consumes: `computeSynthesis` from Task 3.
- Produces: nothing new.

Conversations persist the full chart JSON (`server/store.js:427`) and rehydrate it wholesale at `public/app.js:2477`. Every chat saved before this ships holds a chart with no `synthesis` key. The backfill goes in the route rather than in `store.js` so it covers both storage backends at once.

- [ ] **Step 1: Write the failing test**

Append to `server/synthesis.test.js`:

```js
test("a chart stripped of synthesis rebuilds identically", () => {
  const { computeChart } = require("./astro");
  const full = computeChart({
    year: 1996, month: 3, day: 14, hour: 9, minute: 25,
    lat: 12.9716, lon: 77.5946, tz: 5.5
  });
  const stored = JSON.parse(JSON.stringify(full));
  delete stored.synthesis;
  assert.deepStrictEqual(s.computeSynthesis(stored), full.synthesis);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test server/synthesis.test.js`
Expected: PASS already — `computeSynthesis` is a pure function of the stored fields. This test exists to prove the backfill is safe before wiring it, so a pass here is the correct outcome.

- [ ] **Step 3: Wire the backfill into the route**

Add to the requires at the top of `server/index.js`:

```js
const { computeSynthesis } = require("./synthesis");
```

Replace the body of `app.get("/api/conversations/:id", ...)` at `:1378`:

```js
app.get("/api/conversations/:id", async (req, res) => {
  try {
    const c = await conversations.get(req.userId, req.params.id);
    if (!c) return res.status(404).json({ error: "Chat not found." });
    // Chats saved before the synthesis read existed hold a chart without it.
    // It is a pure function of what is already stored, so rebuild on read
    // rather than migrating the table.
    if (c.chart && !c.chart.synthesis) c.chart.synthesis = computeSynthesis(c.chart);
    res.json({ conversation: c });
  } catch (err) {
    console.error("get conversation error:", err);
    res.status(500).json({ error: "Could not load chat." });
  }
});
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/synthesis.test.js
git commit -m "fix: rebuild synthesis when an older saved chat is reopened"
```

---

### Task 7: Rewrite `public/domains.js` as a renderer

**Files:**
- Rewrite: `public/domains.js`
- Test: `server/domains.test.js` (new — lives beside the other server tests so `npm test` picks it up)

**Interfaces:**
- Consumes: `chart.synthesis.domains[key]` from Task 4; `DOMAIN_SPEC` keys from Task 3.
- Produces (browser globals, plus CommonJS exports for tests):
  - `DOMAINS` — copy only, keyed identically to `DOMAIN_SPEC`
  - `domainRead(chart, key)` — merges copy with `chart.synthesis.domains[key]`
  - `domainLine(read) -> string` — two slots, plain text
  - `domainLineHtml(read) -> string` — the same line escaped, verdict phrase wrapped in `<b>`
  - `domainContext(read) -> string` — the tiered block
  - `FOUR_SLOTS` — unchanged, still exported

- [ ] **Step 1: Write the failing test**

Create `server/domains.test.js`:

```js
// The card renderer. Two things are worth guarding: the copy table and the
// structural table must not drift apart, and the two-slot rule must actually
// suppress — a card with a loud house AND a live era AND a divergence prints
// the divergence and nothing else.
const test = require("node:test");
const assert = require("node:assert");
const {
  DOMAINS, domainRead, domainLine, domainLineHtml, domainContext
} = require("../public/domains.js");
const { DOMAIN_SPEC, computeSynthesis } = require("./synthesis");
const { computeChart } = require("./astro");

const CHART = computeChart({
  year: 1996, month: 3, day: 14, hour: 9, minute: 25,
  lat: 12.9716, lon: 77.5946, tz: 5.5
});

test("the copy table and the structural table cover the same domains", () => {
  assert.deepStrictEqual(Object.keys(DOMAINS).sort(), Object.keys(DOMAIN_SPEC).sort());
});

test("every domain carries the copy a card needs", () => {
  for (const [key, d] of Object.entries(DOMAINS)) {
    for (const field of ["emoji", "kicker", "head", "houseLabel", "ask"]) {
      assert.ok(d[field], `${key} is missing ${field}`);
    }
  }
});

test("career exists and asks about work", () => {
  assert.ok(DOMAINS.career);
  assert.match(DOMAINS.career.ask, /\?$/);
});

test("the line prints exactly one factor after the promise", () => {
  for (const key of Object.keys(DOMAINS)) {
    const line = domainLine(domainRead(CHART, key));
    const sentences = line.split(/(?<=\.)\s+/).filter(Boolean);
    assert.ok(sentences.length <= 2, `${key} printed ${sentences.length} sentences: ${line}`);
  }
});

test("divergence suppresses the era clause", () => {
  // Hand-build the spec's worked example: Taurus asc, Saturn strong in D1's
  // 10th, fallen in D10, with Saturn also running as the mahadasha.
  const c = JSON.parse(JSON.stringify(CHART));
  c.ascendant.signIndex = 1;
  const put = (key, signIndex) => {
    const p = c.planets.find(x => x.key === key);
    p.signIndex = signIndex;
    p.house = ((signIndex - 1 + 12) % 12) + 1;
  };
  put("Saturn", 10);           // Aquarius, own sign, 10th house
  put("Jupiter", 10);          // makes the house loud too
  const d10 = c.divisionals.find(v => v.key === "D10");
  const sat = d10.planets.find(p => p.key === "Saturn");
  sat.signIndex = 0; sat.house = 12; sat.sameAsRashi = false;   // Aries, debilitated
  c.dasha.maha.lord = "Saturn";
  c.synthesis = computeSynthesis(c);

  const read = domainRead(c, "career");
  assert.equal(read.slot2, "divergence");
  const line = domainLine(read);
  assert.match(line, /D10/);
  assert.ok(!/era/i.test(line), `the era leaked into the line: ${line}`);
});

test("the html line escapes its fragments and emphasises only the verdict", () => {
  const read = domainRead(CHART, "career");
  const html = domainLineHtml(read);
  assert.ok(!/<(?!\/?b>)/.test(html), `only <b> may appear: ${html}`);
  // Injected markup in the copy must come back escaped, not live.
  const hostile = { ...read, houseLabel: '<img src=x onerror=alert(1)>', stale: true };
  assert.ok(!/<img/.test(domainLineHtml(hostile)));
  assert.match(domainLineHtml(hostile), /&lt;img/);
});

test("the model context states the hierarchy rather than implying it", () => {
  const ctx = domainContext(domainRead(CHART, "career"));
  for (const label of ["BASELINE", "PROMISE", "SUSTAIN", "VERDICT", "SHADE", "RULE"]) {
    assert.ok(ctx.includes(label), `context is missing ${label}`);
  }
  assert.ok(ctx.indexOf("PROMISE") < ctx.indexOf("SUSTAIN"));
  assert.ok(ctx.indexOf("SUSTAIN") < ctx.indexOf("SHADE"));
});

test("a chart with no synthesis still renders a line", () => {
  const stale = JSON.parse(JSON.stringify(CHART));
  delete stale.synthesis;
  const read = domainRead(stale, "friendships");
  assert.ok(read, "domainRead survives a stale chart");
  assert.ok(domainLine(read).length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/domains.test.js`
Expected: FAIL — `Object.keys(DOMAINS)` has no `career`, and `read.slot2` is undefined.

- [ ] **Step 3: Rewrite `public/domains.js`**

Replace the entire file:

```js
// Situation cards: the structural spine behind "where should my energy go".
//
// The point of this file is that the frame arrives BEFORE the user speaks. Ask
// a general-purpose chatbot "am I overreacting about my friend?" and it mirrors
// your framing back, which is why those conversations loop. Here the chart
// supplies a fixed frame the answer has to fit.
//
// The reasoning itself lives server-side in synthesis.js and arrives on the
// chart as `c.synthesis`. This file is the renderer: it owns the copy, and it
// owns the rule about how much of the reasoning is allowed onto a card.
//
// That rule is the important part. A card prints the promise, then AT MOST ONE
// more thing. Everything else is still computed and still goes to the model —
// it is simply not shown. Stacking every factor into one line is what made
// these cards read as noise.

// Copy only. The structural half — house, supporting house, which varga
// governs the area — lives in server/synthesis.js as DOMAIN_SPEC, and the two
// key sets are asserted equal in the tests.
const DOMAINS = {
  friendships: {
    emoji: "☍", kicker: "friendships", head: "your circle",
    houseLabel: "friend circles and what you gain from them",
    ask: "Who deserves my energy in my friendships right now, and what am I over-giving to?"
  },
  situationships: {
    emoji: "♡", kicker: "situationships", head: "the one you're unsure about",
    houseLabel: "partnership, and how you meet people one to one",
    ask: "Where do I actually stand in this situationship, and what am I holding onto that isn't mine to carry?"
  },
  home: {
    emoji: "⌂", kicker: "parents & home", head: "the house you grew up in",
    houseLabel: "home, mother, and what safety feels like to you",
    ask: "How do I deal with the pressure at home without carrying all of it, and what's actually mine to hold?"
  },
  focus: {
    emoji: "✎", kicker: "studies & focus", head: "your attention",
    houseLabel: "intellect, study and what you can actually concentrate on",
    ask: "Where should my focus go this term, and what am I burning attention on that isn't paying me back?"
  },
  career: {
    emoji: "◈", kicker: "work & direction", head: "what you're building",
    houseLabel: "work, status, and what you get known for",
    ask: "What should I actually be building right now, and what am I doing because it looks right?"
  }
};

// What it means for a ruler to land in each house — written as "where the
// energy actually goes", since that is the question being asked.
const LORD_IN_HOUSE = {
  1: "it comes back to you — you are the one setting the terms here",
  2: "you invest in keeping things, which can tip into holding on too long",
  3: "it runs on your own effort; nobody's handing it to you",
  4: "it's tangled up with home and needing to feel safe",
  5: "it lives in play, attraction and ego — fun, and easy to over-invest in",
  6: "it costs you friction; this area takes maintenance others don't see",
  7: "it depends heavily on other people showing up",
  8: "it moves in sudden shifts, and a lot of it stays private",
  9: "it's shaped by what you believe you're owed, and by who mentors you",
  10: "it's bound to reputation — how it looks matters more than you admit",
  11: "it flows through your circle; the group carries it",
  12: "it drains quietly, often to people or things you can't fully see"
};

const HOUSE_MEANING = {
  1: "yourself", 2: "what you hold onto", 3: "your own effort", 4: "home and comfort",
  5: "play and creativity", 6: "conflict and grind", 7: "other people", 8: "upheaval and depth",
  9: "belief and mentors", 10: "work and status", 11: "your circle and gains", 12: "retreat and letting go"
};

// What each varga is FOR, in the card's own voice.
const VARGA_VOICE = {
  D9: "the strength chart", D4: "the home chart",
  D10: "the career chart", D24: "the learning chart"
};

const VERDICT_PHRASE = {
  "looks-better-than-it-holds": "this looks better than it holds",
  "grows-into-it": "this one you grow into",
  "holds": "this holds",
  "needs-building": "this one needs building"
};

/**
 * Merge the precomputed synthesis with the copy. Falls back to a copy-only
 * object when the chart predates the synthesis field — old saved chats are
 * backfilled server-side, but a stale payload must not break the profile.
 */
function domainRead(chart, key) {
  const d = DOMAINS[key];
  if (!d) return null;
  const syn = chart && chart.synthesis && chart.synthesis.domains && chart.synthesis.domains[key];
  const lagnaLord = (chart && chart.synthesis && chart.synthesis.lagnaLord) || null;
  if (!syn) return { key, ...d, stale: true };
  return { key, ...d, ...syn, lagnaLord };
}

function ord(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Sun, Mercury and Saturn" — not "Sun and Mercury and Saturn". */
function andList(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

/** Slot 1: the promise, in one sentence, carrying the lord's dignity. */
function promiseSentence(read) {
  const gloss = LORD_IN_HOUSE[read.promise.house] || "";
  const dig = read.promise.dignity;
  const flavour =
    dig === "own" ? ", in its own sign" :
    dig === "exalted" ? ", exalted" :
    dig === "debilitated" ? ", and struggling there" : "";
  return `Your ${ord(read.house)} — ${read.houseLabel} — is ruled by ${read.lordKey}, ` +
    `sitting in your ${ord(read.promise.house)}${flavour}, so ${gloss}.`;
}

/** Slot 2: at most one more thing, chosen server-side. */
function secondSentence(read) {
  const su = read.sustain;
  switch (read.slot2) {
    case "divergence": {
      const dir = read.verdict === "looks-better-than-it-holds" ? "falls" : "picks up";
      return `In the ${su.varga}, ${VARGA_VOICE[su.varga] || "the divisional chart"}, ` +
        `that same ${read.lordKey} ${dir} — ${VERDICT_PHRASE[read.verdict]}.`;
    }
    case "loud": {
      const who = read.occupants.length >= 2 ? read.occupants : read.lordCompany;
      return `${andList(who)} ${who.length > 1 ? "sit" : "sits"} right there, ` +
        `which makes this area loud for you.`;
    }
    case "agreement":
      return `The ${su.varga} says the same thing — ${VERDICT_PHRASE[read.verdict]}.`;
    case "shade":
      return `Your ${read.maha} era ${read.eraTouches}, so it's live right now.`;
    default:
      return "";
  }
}

/** One or two sentences. Never three. Plain text. */
function domainLine(read) {
  if (!read) return "";
  if (read.stale) return `Your ${read.houseLabel} — open this one up to see where the energy goes.`;
  return [promiseSentence(read), secondSentence(read)].filter(Boolean).join(" ");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * The same line, escaped, with the verdict phrase emphasised.
 *
 * Everything here is server-computed from a fixed vocabulary, so there is no
 * live injection vector — but the card is rendered with innerHTML, and an
 * unescaped path through it is the kind of thing that stops being safe the
 * first time someone puts a person's name into a domain line. Escape the
 * fragments, then add the one tag we actually want.
 */
function domainLineHtml(read) {
  if (!read) return "";
  if (read.stale) return esc(domainLine(read));
  const parts = [esc(promiseSentence(read))];
  const second = secondSentence(read);
  if (read.slot2 === "divergence" && second) {
    const phrase = VERDICT_PHRASE[read.verdict];
    const [before] = second.split(phrase);
    parts.push(`${esc(before)}<b>${esc(phrase)}</b>.`);
  } else if (second) {
    parts.push(esc(second));
  }
  return parts.join(" ");
}

/**
 * The tiered block handed to the model. The labels and the closing RULE line
 * are the whole point: a flat list of facts gives the model no way to know
 * that the house lord's condition outranks the running dasha.
 */
function domainContext(read) {
  if (!read || read.stale) return "";
  const L = [];
  const l = read.lagnaLord;
  if (l) {
    L.push(
      `BASELINE — Lagna lord ${l.key} in the ${ord(l.house)}, ${l.dignity}` +
        `${l.combust ? ", combust" : ""}: ${l.band}. ` +
        `This is how much they can act on what follows.`
    );
  }
  L.push(
    `PROMISE (D1) — ${ord(read.house)} house (${read.houseLabel}), sign ${read.sign}, ` +
      `ruled by ${read.lordKey}, in the ${ord(read.promise.house)} house ` +
      `(${HOUSE_MEANING[read.promise.house]}), ${read.promise.dignity}` +
      `${read.promise.retro ? ", retrograde" : ""}: ${read.promise.band}. ` +
      (read.occupants.length ? `In the house: ${read.occupants.join(", ")}. ` : "No planets in the house. ") +
      (read.secondOccupants.length ? `Supporting ${ord(read.second)} holds: ${read.secondOccupants.join(", ")}.` : "")
  );
  if (read.sustain) {
    const role = read.sustain.role === "strength"
      ? " — used here as a general strength grade, not as a chart that governs this topic"
      : "";
    L.push(
      `SUSTAIN (${read.sustain.varga} ${read.sustain.vargaName}${role}) — that same ` +
        `${read.lordKey} is ${read.sustain.dignity} in the ${ord(read.sustain.house)} house ` +
        `of that chart${read.sustain.vargottama ? ", vargottama" : ""}: ${read.sustain.band}.`
    );
    L.push(`VERDICT — ${VERDICT_PHRASE[read.verdict]}.`);
  }
  L.push(
    `SHADE — ${read.maha} Mahadasha${read.antar ? ` / ${read.antar} Antardasha` : ""}. ` +
      (read.eraTouches
        ? `The era lord ${read.eraTouches}, so this area is live.`
        : `The era lord neither rules nor occupies this house, so this period is not primarily about this area.`)
  );
  L.push(
    "RULE — PROMISE outranks SUSTAIN outranks SHADE. Never let the running dasha " +
      "override the structural read. The dasha says when, never whether."
  );
  return L.join("\n");
}

// The fixed shape every situation answer takes. Four slots force a decision;
// an open text box invites rumination, which is the thing this is meant to
// replace. Also the line between a wellness product and a therapy one.
const FOUR_SLOTS =
  "Answer in exactly these four short sections, using these headings:\n" +
  "**what this chapter is for** — one or two sentences on what this period of life is actually asking of them here.\n" +
  "**where your energy leaks** — the specific pattern this placement tends to produce, named kindly but plainly.\n" +
  "**one move this week** — a single concrete action, small enough to do in seven days.\n" +
  "**what to stop carrying** — one thing that isn't theirs to hold.\n\n" +
  "Rules: describe conditions and timing, never outcomes — never predict that a relationship will fail, " +
  "that someone will hurt them, or that a period is doomed. Never tell them to cut people off; this is about " +
  "where to spend energy, not who to remove. Keep the whole answer under 200 words. Warm, direct, no jargon, " +
  "no preamble, no disclaimers.";

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DOMAINS, domainRead, domainLine, domainLineHtml, domainContext, FOUR_SLOTS, HOUSE_MEANING
  };
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS

Note `public/app.js:1515` calls `domainRead(chart, kind.slice(7))` and `:1517` builds `[read.ask, "", domainContext(read)]` — both still work, since `ask` and `domainContext` kept their names and shapes.

- [ ] **Step 5: Commit**

```bash
git add public/domains.js server/domains.test.js
git commit -m "feat: rebuild the situation cards on the synthesis read, two slots max"
```

---

### Task 8: Surface the lagna lord, and style the verdict

**Files:**
- Modify: `public/app.js` — inside `renderCosmicId` (`:850-887`)
- Modify: `public/styles.css` — append one rule

**Interfaces:**
- Consumes: `chart.synthesis.lagnaLord` from Task 4.
- Produces: nothing other tasks depend on.

The career card needs no work here: `renderSituationCards` iterates `Object.keys(DOMAINS)` at `public/app.js:1194`, so Task 7 already added it.

- [ ] **Step 1: Add the lagna lord row**

In `public/app.js`, inside `renderCosmicId`, add above the `return`:

```js
  // The lagna lord's condition is a chart-wide baseline — how much of anything
  // else the person can act on. It belongs here, once, and deliberately NOT on
  // each situation card, which is what made the cards read as a pile.
  const ll = c.synthesis && c.synthesis.lagnaLord;
  const llRow = ll
    ? `<li><span class="cid-glyph">⚚</span><span class="cid-label">Ruler</span>
        <span class="cid-val">${ll.key}<small>${ll.dignity}, ${ll.band}</small></span></li>`
    : "";
```

Then insert `${llRow}` into the `<ul class="cid-rows">` block, immediately after the Rising `<li>`.

- [ ] **Step 2: Add the verdict style**

Append to `public/styles.css`:

```css
/* The one phrase on a situation card that carries the D1-vs-varga finding.
   Emphasised because it is the only thing on the card the user could not have
   guessed from the headline. */
.vc-situation .vc-line b {
  font-weight: 600;
  color: var(--accent, currentColor);
}
```

- [ ] **Step 3: Render the escaped, emphasised line**

`domainLineHtml` (Task 7) already escapes every fragment and wraps only the verdict phrase in `<b>`. Swap the render to use it.

In `public/app.js:1202`, change:

```js
      <div class="vc-line">${escAttr(domainLine(read))}</div>
```

to:

```js
      <div class="vc-line">${domainLineHtml(read)}</div>
```

Do **not** wrap this in `escAttr` — that would escape the `<b>` too. `domainLineHtml` is the sanitising boundary here, and it escapes each fragment before adding the one tag. `secondSentence` stays plain text so `domainLine` remains usable for assertions.

- [ ] **Step 4: Verify in the browser**

Run: `npm start`, open `http://localhost:3000/app.html`, cast a chart.

Check, in order:
1. Cosmic ID shows a **Ruler** row with the lagna lord and its band.
2. Five situation cards render, including **work & direction**.
3. No situation card shows more than two sentences.
4. Click "where should my energy go →" on the career card; the streamed answer keeps the four-slot shape.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "feat: show the lagna lord baseline once, and emphasise the varga verdict"
```

---

## Verification

Run the whole suite plus a manual pass:

```bash
npm test
npm start   # then cast a chart at /app.html
```

Expected end state:

1. `npm test` passes, including the pinned yoga output from Task 2.
2. Five situation cards, each at most two sentences.
3. A card whose D1 and varga disagree prints the varga finding and **not** the era clause.
4. Reopening a chat saved before this branch renders normally.
5. `chartToText` output contains `PRIMARY VARGAS` above the supplementary table.

## Out of scope

Deferred deliberately, per the spec:

- Feed order at `public/app.js:1259` — transit Moon still renders first, dasha second, situation cards fifth. This is the loudest remaining instance of the inversion and is worth a follow-up.
- The today / era / green-flags / heads-up cards keep their current logic.
- Shadbala is not computed.
