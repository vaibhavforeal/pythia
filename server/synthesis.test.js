// The synthesis hierarchy: D1 promises, the varga sustains, the dasha only
// shades. The tests that matter here are the ones guarding rules that are easy
// to get backwards — the weak-D1/strong-varga asymmetry, and the suppression
// order that keeps the era clause off a card that has something better to say.
const test = require("node:test");
const assert = require("node:assert");
const s = require("./synthesis");
const { SIGN_NAMES } = require("./dignity");

// A chart is built by hand rather than through computeChart, because
// computeChart reads Date.now() for transits and the running dasha and would
// make these tests drift with the calendar.
function chart({ ascSign = 1, planets = {}, d9 = {}, vargas = {}, maha = "Ketu", antar = "Venus" } = {}) {
  const KEYS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"];
  const base = k => ({ key: k, signIndex: 0, sign: SIGN_NAMES[0], lon: 0, retro: false, ...(planets[k] || {}) });
  const withHouse = p => ({ ...p, house: ((p.signIndex - ascSign + 12) % 12) + 1, sign: SIGN_NAMES[p.signIndex] });
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

test("the domain sign is the house cusp sign, not the lord's sign", () => {
  // Taurus ascendant, Saturn in Gemini, career (10th house = Aquarius).
  // The domain sign should be Aquarius (the 10th cusp), not Gemini (Saturn's sign).
  const c = chart({
    ascSign: 1,                              // Taurus asc
    planets: { Saturn: { signIndex: 2 } }   // Gemini (signIndex 2)
  });
  const r = s.domainSynthesis(c, "career");
  assert.equal(r.sign, "Aquarius", "domain sign is the house cusp");
  assert.equal(r.signIndex, 10, "signIndex is 10");
  assert.equal(r.promise.sign, "Gemini", "but the lord's own sign is Gemini");
  assert.notEqual(r.sign, r.promise.sign, "they disagree when lord doesn't sit in its own house");
});

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

test("loudWhere = 'house' when 2+ occupants in the domain house", () => {
  // Fixture: Cancer asc (signIndex 2), career (10th = Pisces at signIndex 11, lord Jupiter).
  // Jupiter in 10th, Sun + Mercury also in 10th → 3 occupants → slot2 = "loud" → loudWhere = "house".
  // With Cancer asc (signIndex 2), house 10 has signIndex (2 + 10 - 1) % 12 = 11 (Pisces).
  const c = chart({
    ascSign: 2,  // Cancer asc
    planets: {
      "Jupiter": { signIndex: 11 },  // Pisces, 10th house (career lord, occupant 1)
      "Sun": { signIndex: 11 },      // also Pisces, 10th house (occupant 2)
      "Mercury": { signIndex: 11 },  // also Pisces, 10th house (occupant 3, benefic)
      "Moon": { signIndex: 0 },      // Aries, 11th house
      "Mars": { signIndex: 1 },      // Taurus, 12th house
      "Venus": { signIndex: 3 },     // Leo, 2nd house
      "Saturn": { signIndex: 4 },    // Virgo, 3rd house
      "Rahu": { signIndex: 5 },      // Libra, 4th house
      "Ketu": { signIndex: 6 }       // Scorpio, 5th house
    }
  });
  const career = s.domainSynthesis(c, "career");
  // Verify the fixture conditions
  assert.equal(career.occupants.length, 3, `occupants must be 3, got ${career.occupants.length}`);
  assert.equal(career.lordCompany.length, 0, `lordCompany should be 0 when all are occupants`);
  // The rule in synthesis: loudWhere = occupants.length >= 2 ? "house" : "company"
  assert.equal(career.loudWhere, "house", `loudWhere MUST be 'house' (literal string) when occupants >= 2, got '${career.loudWhere}'`);
  // Double-check slot2 is actually "loud"
  assert.equal(career.slot2, "loud", `slot2 must be 'loud'`);
});

test("loudWhere = 'company' when < 2 occupants but malefic/benefic in lord's sign", () => {
  // Use the actual fixture: focus has 0 occupants but 2 in lordCompany (Saturn, Ketu).
  // Verify the hard-coded discriminator is literally "company", not recomputed.
  const { computeChart } = require("./astro");
  const full = computeChart({
    year: 1996, month: 3, day: 14, hour: 9, minute: 25,
    lat: 12.9716, lon: 77.5946, tz: 5.5
  });
  const focus = full.synthesis.domains.focus;
  assert.equal(focus.occupants.length, 0, `fixture: focus occupants should be 0`);
  assert.ok(focus.lordCompany.length > 0, `fixture: focus lordCompany should be > 0`);
  // The critical assertion: loudWhere is the LITERAL STRING "company", not a recomputation
  assert.strictEqual(focus.loudWhere, "company", `loudWhere MUST be 'company' (literal string), not recomputed`);
  assert.equal(focus.slot2, "loud", `slot2 must be 'loud'`);
});
