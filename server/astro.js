// Sidereal (Vedic) chart computation using the Swiss Ephemeris.
//
// Uses the built-in Moshier ephemeris (SEFLG_MOSEPH) so no external .se1 data
// files are required — good accuracy for modern dates with zero setup. Sidereal
// mode is Lahiri (SE_SIDM_LAHIRI); houses are whole-sign ('W'), the Vedic norm.

const sweph = require("sweph");
const { computeDasha, NAKSHATRAS } = require("./dasha");
const { computeDivisionals } = require("./vargas");
const { computeTransits, computeSadeSati } = require("./transits");
const { computeAshtakavarga } = require("./ashtakavarga");
const { detectYogas, yogasToText } = require("./yogas");
const { computeSynthesis } = require("./synthesis");

const PLANET_ABBR = {
  Sun: "Su", Moon: "Mo", Mars: "Ma", Mercury: "Me", Jupiter: "Ju",
  Venus: "Ve", Saturn: "Sa", Rahu: "Ra", Ketu: "Ke"
};

const C = sweph.constants;

sweph.set_ephe_path(null);
sweph.set_sid_mode(C.SE_SIDM_LAHIRI, 0, 0);

const CALC_FLAGS = C.SEFLG_MOSEPH | C.SEFLG_SPEED | C.SEFLG_SIDEREAL;
const HOUSE_FLAGS = C.SEFLG_SIDEREAL;

const SIGNS = [
  { en: "Aries", sa: "Mesha", lord: "Mars" },
  { en: "Taurus", sa: "Vrishabha", lord: "Venus" },
  { en: "Gemini", sa: "Mithuna", lord: "Mercury" },
  { en: "Cancer", sa: "Karka", lord: "Moon" },
  { en: "Leo", sa: "Simha", lord: "Sun" },
  { en: "Virgo", sa: "Kanya", lord: "Mercury" },
  { en: "Libra", sa: "Tula", lord: "Venus" },
  { en: "Scorpio", sa: "Vrishchika", lord: "Mars" },
  { en: "Sagittarius", sa: "Dhanu", lord: "Jupiter" },
  { en: "Capricorn", sa: "Makara", lord: "Saturn" },
  { en: "Aquarius", sa: "Kumbha", lord: "Saturn" },
  { en: "Pisces", sa: "Meena", lord: "Jupiter" }
];

const PLANETS = [
  { key: "Sun", sanskrit: "Surya", id: C.SE_SUN },
  { key: "Moon", sanskrit: "Chandra", id: C.SE_MOON },
  { key: "Mars", sanskrit: "Mangala", id: C.SE_MARS },
  { key: "Mercury", sanskrit: "Budha", id: C.SE_MERCURY },
  { key: "Jupiter", sanskrit: "Guru", id: C.SE_JUPITER },
  { key: "Venus", sanskrit: "Shukra", id: C.SE_VENUS },
  { key: "Saturn", sanskrit: "Shani", id: C.SE_SATURN }
];

// Graha drishti (Vedic full aspects). Values are house-counts from the planet's
// own sign (1 = same sign, 7 = opposite). Every planet aspects the 7th; Mars,
// Jupiter and Saturn have extra "special" full aspects. The lunar nodes' special
// aspects vary by school — default to the 7th only; set NODE_ASPECTS = [5, 7, 9]
// to apply the Jupiter-like convention some astrologers use for Rahu/Ketu.
// Rahu/Ketu special-aspect convention. Default is Jupiter-like (5/7/9); the UI
// can switch to [7] (conservative). Passed per-request via input.nodeAspects.
const DEFAULT_NODE_ASPECTS = [5, 7, 9];
const BASE_ASPECT_HOUSES = {
  Sun: [7], Moon: [7], Mercury: [7], Venus: [7],
  Mars: [4, 7, 8], Jupiter: [5, 7, 9], Saturn: [3, 7, 10]
};
function aspectHousesFor(key, nodeAspects) {
  if (key === "Rahu" || key === "Ketu") return nodeAspects;
  return BASE_ASPECT_HOUSES[key] || [7];
}

const NAK_LEN = 360 / 27;

const norm360 = x => ((x % 360) + 360) % 360;
const round = (x, n = 4) => Number(x.toFixed(n));

function fmtDeg(d) {
  const deg = Math.floor(d);
  const min = Math.round((d - deg) * 60);
  if (min === 60) return `${deg + 1}°00'`;
  return `${deg}°${String(min).padStart(2, "0")}'`;
}

function ord(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function placeInfo(lon) {
  const signIndex = Math.floor(lon / 30);
  const degInSign = lon - signIndex * 30;
  const nakIndex = Math.floor(lon / NAK_LEN) % 27;
  const posInNak = lon - Math.floor(lon / NAK_LEN) * NAK_LEN;
  const pada = Math.floor(posInNak / (NAK_LEN / 4)) + 1;
  return { signIndex, degInSign, nakIndex, pada };
}

function describe(lon) {
  const p = placeInfo(lon);
  const sign = SIGNS[p.signIndex];
  return {
    lon: round(lon),
    signIndex: p.signIndex,
    sign: sign.en,
    signSanskrit: sign.sa,
    signLord: sign.lord,
    degInSign: round(p.degInSign),
    degInSignFmt: fmtDeg(p.degInSign),
    nakshatra: NAKSHATRAS[p.nakIndex],
    pada: p.pada
  };
}

// Navamsa (D9): each 30° sign is split into nine 3°20' parts. Counting parts
// continuously from Aries 0° (partIndex % 12) reproduces the classic
// movable/fixed/dual starting-sign rule exactly.
const NAV_PART = 30 / 9; // 3°20'
function navamsaOf(lon) {
  const partIndex = Math.floor(lon / NAV_PART) % 108;
  const signIndex = partIndex % 12;
  const degInSign = (lon - Math.floor(lon / NAV_PART) * NAV_PART) * 9; // 0-30 within D9 sign
  const sign = SIGNS[signIndex];
  return {
    signIndex,
    sign: sign.en,
    signSanskrit: sign.sa,
    signLord: sign.lord,
    degInSign: round(degInSign),
    degInSignFmt: fmtDeg(degInSign)
  };
}

function calcLongitude(jd, id) {
  const r = sweph.calc_ut(jd, id, CALC_FLAGS);
  if (!r || !r.data || r.data.length < 1 || Number.isNaN(r.data[0])) {
    throw new Error(`Ephemeris calc failed for body ${id}: ${r && r.error}`);
  }
  return { lon: norm360(r.data[0]), speed: r.data[3] };
}

// Annotate each planet with the aspects it casts and receives (graha drishti),
// plus any conjunctions (planets sharing the same sign).
function computeAspects(planets, nodeAspects) {
  const bySign = {};
  for (const p of planets) (bySign[p.signIndex] ||= []).push(p);

  for (const a of planets) {
    const houses = aspectHousesFor(a.key, nodeAspects);
    a.aspectHouses = houses.slice(); // relative house-counts (e.g. Mars → 4,7,8)
    a.aspectsHousesAbs = houses.map(h => ((a.house - 1 + (h - 1)) % 12) + 1); // absolute houses seen
    a.conjunctWith = (bySign[a.signIndex] || []).filter(b => b.key !== a.key).map(b => b.key);

    a.aspectsTo = [];
    for (const h of houses) {
      const sign = (a.signIndex + (h - 1)) % 12;
      for (const b of bySign[sign] || []) {
        if (b.key !== a.key && !a.aspectsTo.includes(b.key)) a.aspectsTo.push(b.key);
      }
    }
  }
  // Inverse view: who is looking at each planet ("being seen by").
  for (const b of planets) {
    b.aspectedBy = planets.filter(a => a.aspectsTo.includes(b.key)).map(a => a.key);
  }
}

/**
 * @param {object} input { year, month, day, hour, minute, lat, lon, tz }
 * @returns full chart object
 */
function computeChart(input) {
  const { year, month, day, hour, minute, lat, lon, tz } = input;
  const nodeAspects =
    Array.isArray(input.nodeAspects) && input.nodeAspects.length
      ? input.nodeAspects
      : DEFAULT_NODE_ASPECTS;

  // Local civil time -> Universal Time (decimal hours). swe_julday handles
  // fractional/negative hours by shifting the Julian day linearly, so no need
  // to normalise the calendar date across midnight.
  const utHour = hour + minute / 60 - tz;
  const jd = sweph.julday(year, month, day, utHour, C.SE_GREG_CAL);

  const planets = [];
  for (const p of PLANETS) {
    const { lon: pl, speed } = calcLongitude(jd, p.id);
    planets.push({ key: p.key, sanskrit: p.sanskrit, retro: speed < 0, ...describe(pl) });
  }

  // Rahu (mean node) & Ketu (always retrograde by nature).
  const rahu = calcLongitude(jd, C.SE_MEAN_NODE);
  const rahuLon = rahu.lon;
  const ketuLon = norm360(rahuLon + 180);
  planets.push({ key: "Rahu", sanskrit: "Rahu (mean node)", retro: true, ...describe(rahuLon) });
  planets.push({ key: "Ketu", sanskrit: "Ketu", retro: true, ...describe(ketuLon) });

  // Ascendant (Lagna) + whole-sign houses.
  const houses = sweph.houses_ex2(jd, HOUSE_FLAGS, lat, lon, "W");
  if (!houses || !houses.data || !houses.data.points) {
    throw new Error(`House computation failed: ${houses && houses.error}`);
  }
  const ascLon = norm360(houses.data.points[0]);
  const ascendant = describe(ascLon);
  const ascSign = ascendant.signIndex;

  for (const pl of planets) {
    pl.house = ((pl.signIndex - ascSign + 12) % 12) + 1;
  }

  computeAspects(planets, nodeAspects);

  // Navamsa (D9) chart: divisional positions + whole-sign houses from the
  // Lagnamsa (D9 ascendant), with vargottama flags (same sign in D1 and D9).
  const navAsc = navamsaOf(ascLon);
  const navamsa = {
    ascendant: navAsc,
    planets: planets.map(p => {
      const n = navamsaOf(p.lon);
      return {
        key: p.key,
        sanskrit: p.sanskrit,
        retro: p.retro,
        ...n,
        house: ((n.signIndex - navAsc.signIndex + 12) % 12) + 1,
        vargottama: n.signIndex === p.signIndex
      };
    })
  };

  const divisionals = computeDivisionals(planets, ascLon);
  const ashtakavarga = computeAshtakavarga(planets, ascSign);
  const yogas = detectYogas({ planets, ascendant });

  const moon = planets.find(p => p.key === "Moon");
  const dasha = computeDasha(moon.lon, { year, month, day, hour, minute, tz });

  // Synthesis reads the rashi, the navamsa, the divisionals and the dasha, so
  // it has to run after all four exist.
  const synthesis = computeSynthesis({ ascendant, planets, navamsa, divisionals, dasha });

  const nowMs = Date.now();
  const transits = computeTransits(moon.signIndex, ascSign, nowMs);
  const sadeSati = computeSadeSati(moon.signIndex, nowMs);

  let ayanamsa = 0;
  try {
    ayanamsa = round(sweph.get_ayanamsa_ex_ut(jd, C.SEFLG_MOSEPH).data, 4);
  } catch (_) {
    /* non-fatal */
  }

  return {
    input,
    julianDay: round(jd, 6),
    ayanamsa,
    ayanamsaSystem: "Lahiri",
    nodeAspects,
    nodeMode: input.nodeMode || null,
    ascendant,
    planets,
    navamsa,
    divisionals,
    ashtakavarga,
    yogas,
    dasha,
    synthesis,
    transits,
    sadeSati
  };
}

/** Compact plain-text rendering of the chart for the LLM context window. */
function chartToText(c) {
  const L = [];
  if (c.input && c.input.name) L.push(`Name: ${c.input.name}`);
  L.push(
    `Ascendant / Lagna: ${c.ascendant.sign} (${c.ascendant.signSanskrit}) ${c.ascendant.degInSignFmt}, ` +
      `lord ${c.ascendant.signLord}, nakshatra ${c.ascendant.nakshatra} pada ${c.ascendant.pada}`
  );
  L.push(`Ayanamsa (${c.ayanamsaSystem}): ${c.ayanamsa}°`);

  if (c.synthesis && c.synthesis.lagnaLord) {
    const l = c.synthesis.lagnaLord;
    L.push(
      `Lagna lord condition: ${l.key} in the ${ord(l.house)} house, ${l.dignity}` +
        `${l.combust ? ", combust" : ""} — ${l.band.toUpperCase()}. ` +
        `This is the baseline for how much the native can act on anything below.`
    );
  }

  L.push("");
  L.push("Planetary positions (sidereal, whole-sign houses):");
  for (const p of c.planets) {
    L.push(
      `- ${p.key} (${p.sanskrit}): ${p.sign} ${p.degInSignFmt}, house ${p.house}, ` +
        `${p.nakshatra} pada ${p.pada}, sign-lord ${p.signLord}${p.retro ? ", RETROGRADE" : ""}`
    );
  }
  L.push("");
  const d = c.dasha;
  L.push(`Moon nakshatra: ${d.moonNakshatra} pada ${d.moonPada}`);
  L.push(`Dasha balance at birth: ${d.balance}`);
  L.push(`Current Mahadasha: ${d.maha.lord} (${d.maha.start} → ${d.maha.end})`);
  L.push(`Current Antardasha: ${d.antar.lord} (${d.antar.start} → ${d.antar.end})`);
  if (d.upcoming.length) {
    L.push("Upcoming Mahadashas: " + d.upcoming.map(m => `${m.lord} (from ${m.start})`).join(", "));
  }

  L.push("");
  const na = (c.nodeAspects && c.nodeAspects.length ? c.nodeAspects : DEFAULT_NODE_ASPECTS)
    .slice()
    .sort((a, b) => a - b);
  const nodesLegend = na.length === 1 ? `${na[0]}th only` : na.join("/");
  L.push(
    "Graha drishti — full Vedic aspects (rules: all planets aspect the 7th; " +
      `Mars also 4th & 8th; Jupiter also 5th & 9th; Saturn also 3rd & 10th; Rahu/Ketu ${nodesLegend}):`
  );
  const seenBy = c.planets
    .filter(p => p.aspectedBy.length)
    .map(p => `- ${p.key} is aspected (seen) by: ${p.aspectedBy.join(", ")}`);
  L.push(...(seenBy.length ? seenBy : ["- (no planet is aspected by another planet)"]));

  const casts = c.planets
    .filter(p => p.aspectsTo.length)
    .map(p => `- ${p.key} aspects: ${p.aspectsTo.join(", ")}`);
  if (casts.length) {
    L.push("Aspects cast (planet → planets it sees):");
    L.push(...casts);
  }

  const groups = {};
  for (const p of c.planets) (groups[p.signIndex] ||= []).push(p);
  const conj = Object.values(groups)
    .filter(g => g.length > 1)
    .map(g => `${g.map(p => p.key).join(" + ")} (conjunct in ${g[0].sign})`);
  if (conj.length) L.push("Conjunctions (same sign): " + conj.join("; "));

  if (c.navamsa) {
    L.push("");
    L.push("Navamsa (D9) — divisional chart for marriage, partnerships, dharma and planetary strength:");
    L.push(
      `D9 Ascendant (Lagnamsa): ${c.navamsa.ascendant.sign} ` +
        `(${c.navamsa.ascendant.signSanskrit}), lord ${c.navamsa.ascendant.signLord}`
    );
    for (const p of c.navamsa.planets) {
      L.push(
        `- ${p.key}: ${p.sign}, D9 house ${p.house}` +
          (p.vargottama ? " [VARGOTTAMA — same sign in D1 & D9, notably strengthened]" : "")
      );
    }
  }

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

  if (c.transits) {
    L.push("");
    L.push(`=== CURRENT TRANSITS / Gochar (as of ${c.transits.date}) — house from natal Moon | from natal Lagna ===`);
    for (const p of c.transits.planets) {
      L.push(
        `- ${p.key}: ${p.sign} ${p.degInSignFmt}, ${ord(p.fromMoon)} from Moon, ${ord(p.fromLagna)} from Lagna` +
          `${p.retro ? ", retrograde" : ""}${p.slow ? " (slow-mover)" : ""}`
      );
    }
  }

  if (c.sadeSati) {
    const s = c.sadeSati;
    L.push("");
    L.push("=== SADE SATI (Saturn's 7.5-year transit over 12th/1st/2nd from natal Moon) ===");
    if (!s.found) {
      L.push("No Sade Sati window found in the scanned range.");
    } else if (s.active) {
      L.push(`Status: ACTIVE — ${s.phaseLabel}. Saturn currently in ${s.saturnSign}.`);
      L.push(`Full window: ${s.start} → ${s.end}.`);
      L.push(`Phases: rising from ${s.rising}, peak from ${s.peak}, setting from ${s.setting}.`);
    } else {
      L.push(`Status: NOT currently in Sade Sati. Next window: ${s.start} → ${s.end}.`);
    }
    if (s.smallPanoti && s.smallPanoti.active) {
      L.push(`Note: currently under ${s.smallPanoti.type} — a 2.5-year "small panoti" Saturn phase.`);
    }
  }

  if (c.ashtakavarga) {
    const a = c.ashtakavarga;
    L.push("");
    L.push(
      `=== ASHTAKAVARGA (benefic bindu strength; SAV total ${a.savTotal}, house avg ~28 — ` +
        `>=30 strong, <=25 relatively weak) ===`
    );
    L.push("Sarvashtakavarga (SAV) by house from Lagna:");
    for (const h of a.savByHouse) L.push(`- ${ord(h.house)} house (${h.sign}): ${h.bindus} bindus`);
    L.push("Bhinnashtakavarga (BAV) — bindus per sign Aries→Pisces:");
    for (const P of a.targets) {
      const total = a.bav[P].reduce((x, y) => x + y, 0);
      L.push(`- ${P}: [${a.bav[P].join(", ")}] (total ${total})`);
    }
  }

  if (c.yogas) {
    L.push("");
    L.push("=== " + yogasToText(c.yogas));
  }

  return L.join("\n");
}

module.exports = { computeChart, chartToText };
