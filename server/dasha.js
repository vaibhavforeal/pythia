// Vimshottari Dasha computation.
//
// The Moon's position within its nakshatra sets the balance of the first
// Mahadasha. From the (theoretical) start of that first Mahadasha we can lay
// out the whole 120-year cycle deterministically and read off which Maha /
// Antar period contains "now".

const VIMS = [
  { lord: "Ketu", years: 7 },
  { lord: "Venus", years: 20 },
  { lord: "Sun", years: 6 },
  { lord: "Moon", years: 10 },
  { lord: "Mars", years: 7 },
  { lord: "Rahu", years: 18 },
  { lord: "Jupiter", years: 16 },
  { lord: "Saturn", years: 19 },
  { lord: "Mercury", years: 17 }
];

const NAKSHATRAS = [
  "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
  "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni",
  "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha",
  "Jyeshtha", "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana",
  "Dhanishta", "Shatabhisha", "Purva Bhadrapada", "Uttara Bhadrapada", "Revati"
];

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000; // Vimshottari solar-ish year
const NAK_LEN = 360 / 27; // 13°20'

// Dasha period dates are read by people (chart card, and the text handed to
// Claude), so they use the app-wide DD-MM-YYYY format. Kept as a named import
// rather than a local copy so the format lives in exactly one place.
const { formatDay: isoDate } = require("./dates");

function humanYears(years) {
  const totalMonths = Math.round(years * 12);
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  return `${y}y ${m}m`;
}

/**
 * @param {number} moonLon  sidereal longitude of the Moon (0-360)
 * @param {object} birth    { year, month, day, hour, minute, tz }
 */
function computeDasha(moonLon, birth) {
  const nakIndex = Math.floor(moonLon / NAK_LEN) % 27;
  const posInNak = moonLon - nakIndex * NAK_LEN;
  const frac = posInNak / NAK_LEN; // fraction of the nakshatra already traversed
  const moonPada = Math.floor(posInNak / (NAK_LEN / 4)) + 1;

  const startLordIdx = nakIndex % 9;
  const firstFull = VIMS[startLordIdx].years;

  // Real birth instant in UTC ms (so we can compare against the real "now").
  const birthUtcMs =
    Date.UTC(birth.year, birth.month - 1, birth.day, birth.hour, birth.minute) -
    birth.tz * 60 * 60 * 1000;

  // Theoretical start of the first Mahadasha (before birth).
  const t0 = birthUtcMs - firstFull * frac * YEAR_MS;

  // Lay out ~2 full cycles of Mahadashas (plenty for any lifespan).
  const mahas = [];
  let cursor = t0;
  for (let i = 0; i < 18; i++) {
    const v = VIMS[(startLordIdx + i) % 9];
    mahas.push({
      lord: v.lord,
      lordIdx: (startLordIdx + i) % 9,
      years: v.years,
      start: cursor,
      end: cursor + v.years * YEAR_MS
    });
    cursor += v.years * YEAR_MS;
  }

  const now = Date.now();
  const curMaha = mahas.find(m => now >= m.start && now < m.end) || mahas[0];

  // Antardashas of the current Mahadasha.
  const antars = [];
  let at = curMaha.start;
  for (let j = 0; j < 9; j++) {
    const v = VIMS[(curMaha.lordIdx + j) % 9];
    const subYears = (curMaha.years * v.years) / 120;
    antars.push({ lord: v.lord, start: at, end: at + subYears * YEAR_MS });
    at += subYears * YEAR_MS;
  }
  const curAntar = antars.find(a => now >= a.start && now < a.end) || antars[0];

  const upcoming = mahas
    .filter(m => m.start > now)
    .slice(0, 4)
    .map(m => ({ lord: m.lord, start: isoDate(m.start) }));

  return {
    moonNakshatra: NAKSHATRAS[nakIndex],
    moonPada,
    balance: `${humanYears(firstFull * (1 - frac))} of ${VIMS[startLordIdx].lord} remaining at birth`,
    maha: { lord: curMaha.lord, start: isoDate(curMaha.start), end: isoDate(curMaha.end) },
    antar: { lord: curAntar.lord, start: isoDate(curAntar.start), end: isoDate(curAntar.end) },
    upcoming
  };
}

module.exports = { computeDasha, NAKSHATRAS };
