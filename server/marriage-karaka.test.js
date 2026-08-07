// The kalatra-karaka is one of the few places a chart is read differently
// depending on whose it is: Venus for a man, Jupiter for a woman. The tests
// that matter are the ones about NOT knowing — the tradition gives no rule
// beyond those two, and a silent default to Venus would be a wrong reading
// delivered with full confidence.
const test = require("node:test");
const assert = require("node:assert");
const { computeChart } = require("./astro");
const { marriageKaraka, KALATRA_KARAKA } = require("./synthesis");

const BIRTH = { year: 2004, month: 8, day: 17, hour: 12, minute: 55, lat: 15.4315, lon: 75.6355, tz: 5.5 };
const chartFor = gender => computeChart({ ...BIRTH, gender });

test("a male nativity reads the spouse from Venus", () => {
  const mk = chartFor("male").synthesis.marriageKaraka;
  assert.equal(mk.planets.length, 1);
  assert.equal(mk.planets[0].key, "Venus");
  assert.equal(mk.ambiguous, false);
});

test("a female nativity reads the spouse from Jupiter", () => {
  const mk = chartFor("female").synthesis.marriageKaraka;
  assert.equal(mk.planets.length, 1);
  assert.equal(mk.planets[0].key, "Jupiter");
  assert.equal(mk.ambiguous, false);
});

test("the two genders genuinely land on different planets", () => {
  // Guards against the field being threaded through but ignored.
  assert.notEqual(
    chartFor("male").synthesis.marriageKaraka.planets[0].key,
    chartFor("female").synthesis.marriageKaraka.planets[0].key
  );
  assert.deepEqual(KALATRA_KARAKA, { male: "Venus", female: "Jupiter" });
});

test("an unanswered gender asserts no karaka at all", () => {
  for (const g of [undefined, null, ""]) {
    assert.equal(chartFor(g).synthesis.marriageKaraka, null, `gender ${JSON.stringify(g)} must not pick one`);
  }
});

test("'other' shows both rather than picking one", () => {
  const mk = chartFor("other").synthesis.marriageKaraka;
  assert.equal(mk.ambiguous, true);
  assert.deepEqual(mk.planets.map(p => p.key).sort(), ["Jupiter", "Venus"]);
  assert.match(mk.why, /gives none here/);
});

test("the karaka is graded, not just named", () => {
  // A karaka nobody has assessed is useless — house, dignity and band are what
  // a marriage reading actually leans on.
  const p = chartFor("male").synthesis.marriageKaraka.planets[0];
  for (const key of ["house", "sign", "dignity", "band", "combust", "retro"]) {
    assert.ok(p[key] !== undefined, `missing ${key}`);
  }
  assert.ok(["weak", "mixed", "strong"].includes(p.band));
});

test("marriageKaraka is null when the chart has no planets to grade", () => {
  assert.equal(marriageKaraka({ planets: [] }, "male"), null);
  assert.equal(marriageKaraka({ planets: [] }, "other"), null);
});

test("the LLM context states the karaka, and flags when it's ambiguous", () => {
  const { chartToText } = require("./astro");
  const male = chartToText(chartFor("male"));
  assert.match(male, /Kalatra-karaka \(spouse significator\): Venus/);
  assert.ok(!/Weigh both/.test(male));

  const other = chartToText(chartFor("other"));
  assert.match(other, /Weigh both; do not assert one as the karaka/);

  const unknown = chartToText(chartFor(undefined));
  assert.ok(!/Kalatra-karaka/.test(unknown), "silence beats a guess");
});

test("gender changes only the karaka, not the rest of the chart", () => {
  const male = chartFor("male");
  const female = chartFor("female");
  assert.equal(male.ascendant.sign, female.ascendant.sign);
  assert.equal(male.ashtakavarga.savTotal, female.ashtakavarga.savTotal);
  assert.deepEqual(male.synthesis.domains, female.synthesis.domains);
  assert.deepEqual(male.synthesis.lagnaLord, female.synthesis.lagnaLord);
});
