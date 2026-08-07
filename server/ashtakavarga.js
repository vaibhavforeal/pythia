// Ashtakavarga — the benefic-point (bindu) strength system.
//
// For each of the 7 planets we build a Bhinnashtakavarga (BAV): a 12-sign array
// of bindus contributed by 8 references (the 7 planets + the Lagna). A reference
// gives the target planet a bindu in certain houses counted FROM that reference.
// Summing all 7 BAVs gives the Sarvashtakavarga (SAV), total 337 bindus.
//
// The benefic-house tables below are the classical Parashari set; each planet's
// grand total is asserted at load time so a typo can't slip through.

const SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"
];

const CONTRIBUTORS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Lagna"];
const TARGETS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"];

// TABLES[target][contributor] = benefic house numbers (1-12) from the contributor.
const TABLES = {
  Sun: {
    Sun: [1, 2, 4, 7, 8, 9, 10, 11],
    Moon: [3, 6, 10, 11],
    Mars: [1, 2, 4, 7, 8, 9, 10, 11],
    Mercury: [3, 5, 6, 9, 10, 11, 12],
    Jupiter: [5, 6, 9, 11],
    Venus: [6, 7, 12],
    Saturn: [1, 2, 4, 7, 8, 9, 10, 11],
    Lagna: [3, 4, 6, 10, 11, 12]
  },
  Moon: {
    Sun: [3, 6, 7, 8, 10, 11],
    Moon: [1, 3, 6, 7, 10, 11],
    Mars: [2, 3, 5, 6, 9, 10, 11],
    Mercury: [1, 3, 4, 5, 7, 8, 10, 11],
    Jupiter: [1, 4, 7, 8, 10, 11, 12],
    Venus: [3, 4, 5, 7, 9, 10, 11],
    Saturn: [3, 5, 6, 11],
    Lagna: [3, 6, 10, 11]
  },
  Mars: {
    Sun: [3, 5, 6, 10, 11],
    Moon: [3, 6, 11],
    Mars: [1, 2, 4, 7, 8, 10, 11],
    Mercury: [3, 5, 6, 11],
    Jupiter: [6, 10, 11, 12],
    Venus: [6, 8, 11, 12],
    Saturn: [1, 4, 7, 8, 9, 10, 11],
    Lagna: [1, 3, 6, 10, 11]
  },
  Mercury: {
    Sun: [5, 6, 9, 11, 12],
    Moon: [2, 4, 6, 8, 10, 11],
    Mars: [1, 2, 4, 7, 8, 9, 10, 11],
    Mercury: [1, 3, 5, 6, 9, 10, 11, 12],
    Jupiter: [6, 8, 11, 12],
    Venus: [1, 2, 3, 4, 5, 8, 9, 11],
    Saturn: [1, 2, 4, 7, 8, 9, 10, 11],
    Lagna: [1, 2, 4, 6, 8, 10, 11]
  },
  Jupiter: {
    Sun: [1, 2, 3, 4, 7, 8, 9, 10, 11],
    Moon: [2, 5, 7, 9, 11],
    Mars: [1, 2, 4, 7, 8, 10, 11],
    Mercury: [1, 2, 4, 5, 6, 9, 10, 11],
    Jupiter: [1, 2, 3, 4, 7, 8, 10, 11],
    Venus: [2, 5, 6, 9, 10, 11],
    Saturn: [3, 5, 6, 12],
    Lagna: [1, 2, 4, 5, 6, 7, 9, 10, 11]
  },
  Venus: {
    Sun: [8, 11, 12],
    Moon: [1, 2, 3, 4, 5, 8, 9, 11, 12],
    Mars: [3, 4, 6, 9, 11, 12],
    Mercury: [3, 5, 6, 9, 11],
    Jupiter: [5, 8, 9, 10, 11],
    Venus: [1, 2, 3, 4, 5, 8, 9, 10, 11],
    Saturn: [3, 4, 5, 8, 9, 10, 11],
    Lagna: [1, 2, 3, 4, 5, 8, 9, 11]
  },
  // NOTE — Venus.Mars above is the one cell where the classical sources fork,
  // and the 4 is deliberate. Phaladeepika (Mantreswara) ch.23 sl.8 and Brihat
  // Jataka (Varahamihira) ch.9 v.6 both read [3, 5, 6, 9, 11, 12]; Phaladeepika
  // then footnotes the alternative — "According to Parasara, the 3rd, 4th, 6th,
  // 9th, 11th and 12th places from Mars" — which is what we use, matching the
  // Parashari lineage the rest of this table follows. Engines that read
  // Varahamihira here will differ from us by one bindu in two signs, and both
  // are right. Don't "correct" the 4 to a 5 without changing lineage on purpose.
  Saturn: {
    Sun: [1, 2, 4, 7, 8, 10, 11],
    Moon: [3, 6, 11],
    Mars: [3, 5, 6, 10, 11, 12],
    Mercury: [6, 8, 9, 10, 11, 12],
    Jupiter: [5, 6, 11, 12],
    Venus: [6, 11, 12],
    Saturn: [3, 5, 6, 11],
    Lagna: [1, 3, 4, 6, 10, 11]
  }
};

// Guard: each planet's BAV must total its canonical bindu count.
const EXPECTED_TOTALS = { Sun: 48, Moon: 49, Mars: 39, Mercury: 54, Jupiter: 56, Venus: 52, Saturn: 39 };

// Counting the bindus only proves we typed the right NUMBER of houses — a 4
// where a 5 belongs sails straight through, and shifts a bindu into the wrong
// sign for every chart. So we also pin the sum of the house numbers themselves,
// which no single-digit typo can survive.
const EXPECTED_HOUSE_SUMS = { Sun: 344, Moon: 335, Mars: 280, Mercury: 367, Jupiter: 350, Venus: 354, Saturn: 289 };

for (const P of TARGETS) {
  let total = 0;
  let houseSum = 0;
  for (const C of CONTRIBUTORS) {
    const houses = TABLES[P][C];
    if (new Set(houses).size !== houses.length) {
      throw new Error(`Ashtakavarga table ${P}/${C} repeats a house`);
    }
    for (const h of houses) {
      if (!Number.isInteger(h) || h < 1 || h > 12) {
        throw new Error(`Ashtakavarga table ${P}/${C} has out-of-range house ${h}`);
      }
      houseSum += h;
    }
    total += houses.length;
  }
  if (total !== EXPECTED_TOTALS[P]) {
    throw new Error(`Ashtakavarga table for ${P} totals ${total}, expected ${EXPECTED_TOTALS[P]}`);
  }
  if (houseSum !== EXPECTED_HOUSE_SUMS[P]) {
    throw new Error(
      `Ashtakavarga table for ${P} has house-number sum ${houseSum}, expected ${EXPECTED_HOUSE_SUMS[P]} — ` +
      `a benefic house was changed, not just miscounted`
    );
  }
}

// planets: array with { key, signIndex } for the 7 grahas. ascSignIndex: Lagna sign.
function computeAshtakavarga(planets, ascSignIndex) {
  const signOf = { Lagna: ascSignIndex };
  for (const key of TARGETS) signOf[key] = planets.find(p => p.key === key).signIndex;

  const bav = {};
  const sav = new Array(12).fill(0);
  for (const P of TARGETS) {
    const arr = new Array(12).fill(0);
    for (const C of CONTRIBUTORS) {
      const cSign = signOf[C];
      for (const h of TABLES[P][C]) arr[(cSign + h - 1) % 12] += 1;
    }
    bav[P] = arr;
    for (let i = 0; i < 12; i++) sav[i] += arr[i];
  }

  const savByHouse = [];
  for (let h = 1; h <= 12; h++) {
    const signIndex = (ascSignIndex + h - 1) % 12;
    savByHouse.push({ house: h, signIndex, sign: SIGNS[signIndex], bindus: sav[signIndex] });
  }

  return {
    bav,
    sav,
    savByHouse,
    savTotal: sav.reduce((a, b) => a + b, 0),
    signs: SIGNS,
    targets: TARGETS
  };
}

module.exports = { computeAshtakavarga };
