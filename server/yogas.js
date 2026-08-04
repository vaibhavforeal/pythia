// Yoga detection — scans a computed chart for the classic named planetary
// combinations (yogas). Uses house lords (sign lord of each house), planetary
// dignity (exalt/debil/own), aspects and conjunctions already on the chart.
//
// This is a high-confidence subset, not the full canon of hundreds of yogas:
// Pancha Mahapurusha, Gaja Kesari, Budha-Aditya, Chandra-Mangala, Raja (kendra-
// trikona lord links), Dhana, Neecha Bhanga Raja, Vipreet Raja, the lunar
// Sunapha/Anapha/Durudhara/Kemadruma set, Kala Sarpa, and Parivartana.

// Dignity tables live in dignity.js so the synthesis engine and the yoga
// detector cannot drift apart.
const {
  SIGN_LORD, EXALT_SIGN, DEBIL_SIGN, OWN_SIGNS, EXALTED_IN_SIGN
} = require("./dignity");

const MAHAPURUSHA = { Mars: "Ruchaka", Mercury: "Bhadra", Jupiter: "Hamsa", Venus: "Malavya", Saturn: "Sasa" };
const SEVEN = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"];
const CATEGORY_ORDER = { Mahapurusha: 0, Raja: 1, Dhana: 2, Lunar: 3, Special: 4, Challenging: 5 };

function ord(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * @param {object} chart  full chart with .planets and .ascendant (astro.computeChart)
 * @returns {Array} detected yogas [{ key, name, category, favorable, detail }]
 */
function detectYogas(chart) {
  const yogas = [];
  const seen = new Set();
  const add = (key, name, category, favorable, detail) => {
    if (seen.has(key)) return;
    seen.add(key);
    yogas.push({ key, name, category, favorable, detail });
  };

  const P = {};
  for (const pl of chart.planets) P[pl.key] = pl;
  const ascSign = chart.ascendant.signIndex;

  const houseSign = h => (ascSign + h - 1) % 12; // sign index occupying house h
  const houseLord = h => SIGN_LORD[houseSign(h)]; // planet ruling house h
  const signOwner = signIndex => SIGN_LORD[signIndex];
  const houseFrom = (refSign, sign) => ((sign - refSign + 12) % 12) + 1;
  const isKendra = h => h === 1 || h === 4 || h === 7 || h === 10;
  const inter = (set, arr) => arr.some(x => set.has(x));

  // planet → set of houses it lords
  const lords = {};
  for (let h = 1; h <= 12; h++) (lords[houseLord(h)] ||= new Set()).add(h);

  // association between two planets: conjunction, mutual aspect, or exchange
  function associate(a, b) {
    if (!a || !b || a.key === b.key) return null;
    if (a.signIndex === b.signIndex) return "conjunction";
    if (a.aspectsTo.includes(b.key) && b.aspectsTo.includes(a.key)) return "mutual aspect";
    if (signOwner(a.signIndex) === b.key && signOwner(b.signIndex) === a.key) return "exchange";
    return null;
  }

  // --- 1. Pancha Mahapurusha ---
  for (const key of ["Mars", "Mercury", "Jupiter", "Venus", "Saturn"]) {
    const pl = P[key];
    const exalted = EXALT_SIGN[key] === pl.signIndex;
    const own = OWN_SIGNS[key].includes(pl.signIndex);
    if ((exalted || own) && isKendra(pl.house)) {
      add(`mp_${key}`, `${MAHAPURUSHA[key]} Yoga`, "Mahapurusha", true,
        `${key} ${exalted ? "exalted" : "in own sign"} (${pl.sign}) in the ${ord(pl.house)} house — a kendra.`);
    }
  }

  // --- 2. Gaja Kesari ---
  const jFromMoon = houseFrom(P.Moon.signIndex, P.Jupiter.signIndex);
  if (isKendra(jFromMoon)) {
    add("gajakesari", "Gaja Kesari Yoga", "Raja", true,
      `Jupiter in the ${ord(jFromMoon)} from the Moon (a kendra) — wisdom, standing, benevolence.`);
  }

  // --- 3. Budha-Aditya ---
  if (P.Sun.signIndex === P.Mercury.signIndex) {
    add("budhaditya", "Budha-Aditya Yoga", "Special", true,
      `Sun and Mercury conjunct in ${P.Sun.sign} — intellect and communication.`);
  }

  // --- 4. Chandra-Mangala ---
  if (P.Moon.signIndex === P.Mars.signIndex) {
    add("chandramangala", "Chandra-Mangala Yoga", "Dhana", true,
      `Moon and Mars conjunct in ${P.Moon.sign} — earnings through drive and enterprise.`);
  }

  // --- 5. Raja Yoga (kendra lord + trikona lord) ---
  for (const p of SEVEN) {
    const hs = lords[p];
    if (hs && inter(hs, [4, 7, 10]) && inter(hs, [5, 9])) {
      add(`raja_${p}`, "Raja Yoga", "Raja", true,
        `${p} lords both a kendra and a trikona (houses ${[...hs].sort((a, b) => a - b).join(", ")}).`);
    }
  }
  for (let i = 0; i < SEVEN.length; i++) {
    for (let j = i + 1; j < SEVEN.length; j++) {
      const A = SEVEN[i], B = SEVEN[j];
      const aH = lords[A], bH = lords[B];
      if (!aH || !bH) continue;
      const rel = associate(P[A], P[B]);
      if (!rel) continue;
      const aKen = inter(aH, [1, 4, 7, 10]), aTri = inter(aH, [5, 9]);
      const bKen = inter(bH, [1, 4, 7, 10]), bTri = inter(bH, [5, 9]);
      if ((aKen && bTri) || (aTri && bKen)) {
        add(`raja_${A}_${B}`, "Raja Yoga", "Raja", true,
          `${A} and ${B} — a kendra lord and a trikona lord — linked by ${rel}.`);
      }
    }
  }

  // --- 6. Dhana Yoga (2nd & 11th lords) ---
  const l2 = houseLord(2), l11 = houseLord(11);
  if (l2 === l11) {
    add("dhana_single", "Dhana Yoga", "Dhana", true, `${l2} lords both the 2nd and 11th — the wealth houses.`);
  } else {
    const rel = associate(P[l2], P[l11]);
    if (rel) add("dhana", "Dhana Yoga", "Dhana", true, `Lords of the 2nd and 11th (${l2} & ${l11}) linked by ${rel}.`);
  }

  // --- 7. Neecha Bhanga Raja Yoga (cancelled debilitation) ---
  for (const key of SEVEN) {
    const pl = P[key];
    if (DEBIL_SIGN[key] !== pl.signIndex) continue;
    const dispositor = P[signOwner(pl.signIndex)];
    const exaltedThere = EXALTED_IN_SIGN[pl.signIndex];
    const exaltedPl = exaltedThere ? P[exaltedThere] : null;
    const reasons = [];
    if (dispositor && isKendra(dispositor.house)) reasons.push(`its dispositor ${dispositor.key} sits in a kendra`);
    if (exaltedPl && isKendra(exaltedPl.house)) reasons.push(`${exaltedPl.key} (exalted in ${pl.sign}) sits in a kendra`);
    if (pl.aspectedBy.includes(signOwner(pl.signIndex)) || (exaltedThere && pl.aspectedBy.includes(exaltedThere))) {
      reasons.push("it is aspected by its dispositor or the planet exalted there");
    }
    if (reasons.length) {
      add(`nbry_${key}`, `Neecha Bhanga Raja Yoga (${key})`, "Raja", true,
        `${key} is debilitated in ${pl.sign}, but the debilitation is cancelled — ${reasons[0]}. Weakness turns to strength.`);
    }
  }

  // --- 8. Vipreet Raja Yoga (dusthana lord in a dusthana) ---
  const VIP = { 6: "Harsha", 8: "Sarala", 12: "Vimala" };
  for (const h of [6, 8, 12]) {
    const lord = P[houseLord(h)];
    if ([6, 8, 12].includes(lord.house)) {
      add(`vip_${h}`, `Vipreet Raja Yoga — ${VIP[h]}`, "Raja", true,
        `Lord of the ${ord(h)} (${lord.key}) sits in the ${ord(lord.house)}, a dusthana — rise through adversity.`);
    }
  }

  // --- 9. Lunar yogas (planets flanking the Moon) ---
  const moonSign = P.Moon.signIndex;
  let has2 = false, has12 = false, withMoon = false;
  for (const key of ["Mars", "Mercury", "Jupiter", "Venus", "Saturn"]) {
    const hf = houseFrom(moonSign, P[key].signIndex);
    if (hf === 2) has2 = true;
    else if (hf === 12) has12 = true;
    else if (hf === 1) withMoon = true;
  }
  if (has2 && has12) add("durudhara", "Durudhara Yoga", "Lunar", true, "Planets flank the Moon on both sides (2nd & 12th) — comfort and support.");
  else if (has2) add("sunapha", "Sunapha Yoga", "Lunar", true, "A planet occupies the 2nd from the Moon — self-earned means.");
  else if (has12) add("anapha", "Anapha Yoga", "Lunar", true, "A planet occupies the 12th from the Moon — poise and detachment.");
  if (!has2 && !has12 && !withMoon) {
    add("kemadruma", "Kemadruma Yoga", "Challenging", false,
      "The Moon is isolated — no planets in the 2nd, 12th, or with it. A struggle-yoga, but often cancelled by other lunar support.");
  }

  // --- 10. Kala Sarpa (all planets hemmed between Rahu and Ketu) ---
  const r = P.Rahu.lon;
  let side = null, kalasarpa = true;
  for (const key of SEVEN) {
    const d = (((P[key].lon - r) % 360) + 360) % 360; // 0..360 from Rahu
    if (d <= 0.001 || Math.abs(d - 180) <= 0.001) continue; // on the axis
    const s = d < 180 ? "A" : "B";
    if (side === null) side = s;
    else if (side !== s) { kalasarpa = false; break; }
  }
  if (kalasarpa && side !== null) {
    add("kalasarpa", "Kala Sarpa Yoga", "Challenging", false,
      "Every planet is hemmed within the Rahu–Ketu axis — an intense, karmic pattern; effects vary by the axis and houses involved.");
  }

  // --- 11. Parivartana (sign exchange between two planets) ---
  for (let i = 0; i < SEVEN.length; i++) {
    for (let j = i + 1; j < SEVEN.length; j++) {
      const a = P[SEVEN[i]], b = P[SEVEN[j]];
      if (signOwner(a.signIndex) === b.key && signOwner(b.signIndex) === a.key) {
        add(`pari_${a.key}_${b.key}`, `Parivartana Yoga (${a.key} ↔ ${b.key})`, "Special", true,
          `${a.key} and ${b.key} occupy each other's signs (${a.sign} ↔ ${b.sign}) — a mutual exchange linking their houses.`);
      }
    }
  }

  yogas.sort((a, b) => (CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]));
  return yogas;
}

// Plain-text rendering for the LLM context window.
function yogasToText(yogas) {
  if (!yogas || !yogas.length) return "Yogas: none of the major detected combinations are present.";
  const L = ["Yogas (auto-detected planetary combinations):"];
  for (const y of yogas) {
    L.push(`- ${y.name}${y.favorable ? "" : " [challenging]"} — ${y.detail}`);
  }
  return L.join("\n");
}

module.exports = { detectYogas, yogasToText };
