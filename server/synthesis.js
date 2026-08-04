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

const { gradePlanet, dignityOf, isCombust, SIGN_LORD, SIGN_NAMES } = require("./dignity");

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
    house: spec.house, second: spec.second, sign: SIGN_NAMES[signIdx], signIndex: signIdx,
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
