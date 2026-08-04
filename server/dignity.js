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

// Lord of each sign, Aries → Pisces. Source: Brihat Parashara Hora Shastra, ch. 2.
// Also matches astro.js SIGNS.
const SIGN_LORD = [
  "Mars", "Venus", "Mercury", "Moon", "Sun", "Mercury",
  "Venus", "Mars", "Jupiter", "Saturn", "Saturn", "Jupiter"
];

// Exaltation, debilitation, and own signs. Source: Brihat Parashara Hora Shastra, ch. 3.
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
  if (!Number.isInteger(signIndex) || signIndex < 0 || signIndex > 11) {
    throw new TypeError(`signIndex must be an integer 0..11, got ${signIndex}`);
  }
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
