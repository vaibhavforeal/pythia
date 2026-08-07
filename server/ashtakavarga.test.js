// Ashtakavarga is pure table lookup, so the risk isn't the algorithm — it's a
// mistyped benefic house silently shifting a bindu into the wrong sign for
// every chart ever cast. The load-time guards catch that shape of error; these
// tests pin the arithmetic and one whole real chart as a regression anchor.
//
// The anchor chart was cross-computed against an independent commercial engine
// on 7 Aug 2026: 82 of the 84 bindu cells matched exactly. The two that didn't
// (Venus in Scorpio and Sagittarius) both trace to TABLES.Venus.Mars, where the
// classical sources genuinely fork — see the note beside that table.
const test = require("node:test");
const assert = require("node:assert");
const { computeAshtakavarga } = require("./ashtakavarga");
const { computeChart } = require("./astro");

// Gadag, 17 Aug 2004, 12:55 IST. Scorpio lagna; five grahas in Leo.
const ANCHOR = { year: 2004, month: 8, day: 17, hour: 12, minute: 55, lat: 15.4315, lon: 75.6355, tz: 5.5 };

const BAV_TOTALS = { Sun: 48, Moon: 49, Mars: 39, Mercury: 54, Jupiter: 56, Venus: 52, Saturn: 39 };

test("every BAV totals its classical constant, and the SAV totals 337", () => {
  const { ashtakavarga: av } = computeChart(ANCHOR);

  for (const [planet, expected] of Object.entries(BAV_TOTALS)) {
    const total = av.bav[planet].reduce((a, b) => a + b, 0);
    assert.equal(total, expected, `${planet} BAV should total ${expected}`);
  }
  assert.equal(av.savTotal, 337);
  assert.equal(av.sav.reduce((a, b) => a + b, 0), 337);
});

test("no sign can hold more bindus than there are contributors", () => {
  const { ashtakavarga: av } = computeChart(ANCHOR);

  for (const planet of av.targets) {
    for (const bindus of av.bav[planet]) {
      assert.ok(bindus >= 0 && bindus <= 8, `${planet} has ${bindus} bindus in a sign (max 8)`);
    }
  }
  // Seven planets, at most 8 each.
  for (const bindus of av.sav) assert.ok(bindus >= 0 && bindus <= 56);
});

test("savByHouse walks whole-sign from the lagna and agrees with sav", () => {
  const { ashtakavarga: av, ascendant } = computeChart(ANCHOR);

  assert.equal(av.savByHouse.length, 12);
  assert.equal(av.savByHouse[0].signIndex, ascendant.signIndex, "H1 is the lagna sign");
  for (const row of av.savByHouse) {
    assert.equal(row.bindus, av.sav[row.signIndex], `H${row.house} must mirror sav[${row.signIndex}]`);
  }
});

test("anchor chart reproduces its known bindu distribution", () => {
  const { ashtakavarga: av } = computeChart(ANCHOR);

  // Sign order, Aries → Pisces.
  assert.deepEqual(av.bav.Sun, [6, 5, 6, 2, 3, 4, 3, 3, 4, 5, 4, 3]);
  assert.deepEqual(av.bav.Moon, [4, 5, 5, 1, 6, 3, 6, 3, 3, 4, 5, 4]);
  assert.deepEqual(av.bav.Mars, [3, 4, 6, 1, 2, 3, 3, 3, 3, 7, 2, 2]);
  assert.deepEqual(av.bav.Mercury, [6, 3, 8, 5, 4, 5, 2, 3, 4, 6, 4, 4]);
  assert.deepEqual(av.bav.Jupiter, [5, 6, 5, 2, 6, 6, 4, 7, 3, 1, 6, 5]);
  assert.deepEqual(av.bav.Venus, [6, 1, 7, 5, 3, 4, 5, 3, 4, 5, 3, 6]);
  assert.deepEqual(av.bav.Saturn, [4, 4, 5, 3, 3, 2, 3, 4, 2, 5, 2, 2]);

  // House order from the Scorpio lagna.
  assert.deepEqual(av.savByHouse.map(r => r.bindus), [26, 23, 33, 26, 26, 34, 28, 42, 19, 27, 27, 26]);
});

test("Venus keeps the Parashari reading of its benefic places from Mars", () => {
  // The forked cell. Under Varahamihira's [3,5,6,9,11,12] this chart's Venus
  // would read 2 bindus in Scorpio and 5 in Sagittarius instead of 3 and 4.
  // If this assertion fails, the lineage changed — read the note in the module.
  const { ashtakavarga: av } = computeChart(ANCHOR);

  assert.equal(av.bav.Venus[7], 3, "Venus in Scorpio (Parashara reading)");
  assert.equal(av.bav.Venus[8], 4, "Venus in Sagittarius (Parashara reading)");
});

test("bindus land relative to each contributor, not at fixed signs", () => {
  // Same birth, six hours earlier: the lagna moves, so the Lagna contributor's
  // bindus must move with it while the seven planetary rows stay put.
  const early = computeChart({ ...ANCHOR, hour: 6, minute: 55 });
  const noon = computeChart(ANCHOR);

  assert.notEqual(early.ascendant.signIndex, noon.ascendant.signIndex);
  assert.notDeepEqual(early.ashtakavarga.sav, noon.ashtakavarga.sav);
  assert.equal(early.ashtakavarga.savTotal, 337, "the total is invariant");
});
