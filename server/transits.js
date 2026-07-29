// Current transits (gochar) and Sade Sati, read against the natal Moon.
//
// Positions are computed for "now" from the same sidereal (Lahiri, Moshier)
// setup as the natal chart. Sade Sati = Saturn transiting the 12th, 1st and 2nd
// signs from the natal Moon (~7.5 years). We scan Saturn's motion to find the
// active/next window and its phase boundaries, refined to day resolution.

const sweph = require("sweph");
const C = sweph.constants;

sweph.set_sid_mode(C.SE_SIDM_LAHIRI, 0, 0);
const FLAGS = C.SEFLG_MOSEPH | C.SEFLG_SPEED | C.SEFLG_SIDEREAL;
const DAY_MS = 86400000;

const SIGN_NAMES = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"
];

const TRANSIT_PLANETS = [
  { key: "Sun", id: C.SE_SUN, slow: false },
  { key: "Moon", id: C.SE_MOON, slow: false },
  { key: "Mars", id: C.SE_MARS, slow: false },
  { key: "Mercury", id: C.SE_MERCURY, slow: false },
  { key: "Jupiter", id: C.SE_JUPITER, slow: true },
  { key: "Venus", id: C.SE_VENUS, slow: false },
  { key: "Saturn", id: C.SE_SATURN, slow: true }
];

const norm360 = x => ((x % 360) + 360) % 360;
const jdFromMs = ms => 2440587.5 + ms / DAY_MS;
// Sade Sati window dates are user-facing (and go into the prompt), so they use
// the app-wide DD-MM-YYYY format. Never compare these as strings — the window
// comparisons in this file all work on epoch ms, deliberately.
const { formatDay: iso } = require("./dates");

function planetLon(jd, id) {
  return norm360(sweph.calc_ut(jd, id, FLAGS).data[0]);
}
function planetSpeed(jd, id) {
  return sweph.calc_ut(jd, id, FLAGS).data[3];
}
function satSignAt(ms) {
  return Math.floor(planetLon(jdFromMs(ms), C.SE_SATURN) / 30);
}
function fmtDeg(d) {
  const deg = Math.floor(d);
  const min = Math.round((d - deg) * 60);
  return min === 60 ? `${deg + 1}°00'` : `${deg}°${String(min).padStart(2, "0")}'`;
}

// First ms (day-stepped) in [aMs, bMs] where pred(satSign) is true; else bMs.
function refineFirst(aMs, bMs, pred) {
  for (let t = aMs; t <= bMs; t += DAY_MS) if (pred(satSignAt(t))) return t;
  return bMs;
}

// --- Current transits snapshot ---------------------------------------------
function computeTransits(natalMoonSign, natalAscSign, nowMs) {
  const jd = jdFromMs(nowMs);
  const rows = [];
  const add = (key, lon, retro, slow) => {
    const signIndex = Math.floor(lon / 30);
    rows.push({
      key,
      sign: SIGN_NAMES[signIndex],
      signIndex,
      degInSignFmt: fmtDeg(lon - signIndex * 30),
      retro,
      slow,
      fromMoon: ((signIndex - natalMoonSign + 12) % 12) + 1,
      fromLagna: ((signIndex - natalAscSign + 12) % 12) + 1
    });
  };
  for (const p of TRANSIT_PLANETS) add(p.key, planetLon(jd, p.id), planetSpeed(jd, p.id) < 0, p.slow);
  const rahu = planetLon(jd, C.SE_MEAN_NODE);
  add("Rahu", rahu, true, true);
  add("Ketu", norm360(rahu + 180), true, true);
  return { date: iso(nowMs), planets: rows };
}

// --- Sade Sati -------------------------------------------------------------
function computeSadeSati(moonSign, nowMs) {
  const targets = [(moonSign + 11) % 12, moonSign, (moonSign + 1) % 12];
  const inSet = s => targets.includes(s);
  const step = 7 * DAY_MS;
  const startScan = nowMs - 12 * 365.25 * DAY_MS;
  const endScan = nowMs + 30 * 365.25 * DAY_MS;

  // Weekly samples of Saturn's sign, grouped into runs, then merged across the
  // short gaps a retrograde loop can carve at a sign boundary.
  const runs = [];
  let cur = null;
  for (let t = startScan; t <= endScan; t += step) {
    if (inSet(satSignAt(t))) {
      if (!cur) cur = { startMs: t, endMs: t };
      cur.endMs = t;
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);

  // Gaps in a Sade Sati passage come in exactly two sizes, so the threshold
  // between them is not a tuned constant. A retrograde loop at a sign boundary
  // takes Saturn out of the three signs for at most ~8 months (measured: up to
  // 238 days). Between two genuine passages Saturn must cross the other nine
  // signs — about 29.5 − 7.4 ≈ 22 years. Anything in between cannot occur, so
  // 2 years sits ~3x above the largest wobble and ~11x below the real gap.
  // The old 160-day value was *below* the wobble, which split real passages in
  // two and left the leading fragment to be reported as the whole window.
  const MERGE_GAP_MS = 2 * 365.25 * DAY_MS;
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.startMs - last.endMs <= MERGE_GAP_MS) last.endMs = r.endMs;
    else merged.push({ ...r });
  }

  const saturnSign = satSignAt(nowMs);
  const houseFromMoon = ((saturnSign - moonSign + 12) % 12) + 1;
  const smallPanoti = {
    active: houseFromMoon === 4 || houseFromMoon === 8,
    type:
      houseFromMoon === 4
        ? "Kantaka Shani (Ardha-ashtama, 4th from Moon)"
        : houseFromMoon === 8
        ? "Ashtama Shani (8th from Moon)"
        : null
  };

  let run = merged.find(r => nowMs >= r.startMs && nowMs <= r.endMs);
  const active = !!run;
  if (!run) run = merged.filter(r => r.startMs > nowMs).sort((a, b) => a.startMs - b.startMs)[0];
  if (!run) {
    return { active: false, found: false, smallPanoti };
  }

  // Refine window + phase boundaries to day resolution.
  const start = refineFirst(run.startMs - step, run.startMs, inSet);
  const clears = refineFirst(run.endMs, run.endMs + step, s => !inSet(s));
  const end = clears - DAY_MS;
  const peak = refineFirst(start, end, s => s === moonSign);
  const setting = refineFirst(peak, end, s => s === (moonSign + 1) % 12);

  // Saturn can sit inside the merged window while briefly retrograde out of the
  // three signs (that is exactly what the gaps above are). The house-based
  // branches only cover 12/1/2, so without the timeline fallback anything else
  // fell through to "setting" — producing a label that contradicted the
  // houseFromMoon reported alongside it.
  const satInSet = inSet(saturnSign);
  const phase = !active
    ? null
    : houseFromMoon === 12
    ? "rising"
    : houseFromMoon === 1
    ? "peak"
    : houseFromMoon === 2
    ? "setting"
    : nowMs < peak
    ? "rising"
    : nowMs < setting
    ? "peak"
    : "setting";
  const PHASE_IN_SET = {
    rising: "Rising phase — Saturn in the 12th from your Moon",
    peak: "Peak phase — Saturn transiting over your natal Moon",
    setting: "Setting phase — Saturn in the 2nd from your Moon"
  };
  // Don't assert a house Saturn isn't in. Deliberately direction-neutral: the
  // gap is as often a forward exit that retrogrades back in as a backward one,
  // so "stepped back out" would be wrong half the time. Saturn always returns
  // here — the window only spans this gap because a later run re-enters.
  const PHASE_OUT_OF_SET = {
    rising: "Rising phase — Saturn is briefly outside the 12th, and returns to it shortly",
    peak: "Peak phase — Saturn is briefly off your natal Moon, and returns to it shortly",
    setting: "Setting phase — Saturn is briefly outside the 2nd, and returns to it shortly"
  };
  const phaseLabel = !phase ? null : (satInSet ? PHASE_IN_SET : PHASE_OUT_OF_SET)[phase];

  return {
    active,
    found: true,
    phase,
    phaseLabel,
    saturnSign: SIGN_NAMES[saturnSign],
    houseFromMoon,
    start: iso(start),
    end: iso(end),
    rising: iso(start),
    peak: iso(peak),
    setting: iso(setting),
    smallPanoti
  };
}

// --- Sade Sati memo ---------------------------------------------------------
//
// computeSadeSati is ~99% of the cost of building a chart: 57ms, against 0.02ms
// for the transit table and under a millisecond for the natal positions. It
// samples Saturn weekly across a 42-year span and then refines the boundaries a
// day at a time, so it makes a few thousand ephemeris calls per invocation.
//
// That matters because sweph is synchronous native code. Those 57ms are not
// "slow for one user" — they are 57ms during which this process serves nobody.
// GET /api/friends computes one chart per friend in sequence, so a 20-friend
// list froze the whole server for over a second.
//
// The saving grace is the signature: the result depends only on the natal Moon
// sign, of which there are exactly TWELVE, and on the time, which the function
// already resolves no finer than a day (every boundary is stepped in whole days
// and rendered as a date). So quantising the clock to the UTC day loses nothing
// that was ever observable, and the whole population shares at most 12 entries
// per day. It is a genuine memo of a pure function, not a staleness trade.
//
// Deliberately NOT cached: computeTransits, which reports live degrees and is
// cheap enough that caching it would only add a way to serve stale positions.
const DAY_MS_KEY = 86400000;
const sadeSatiMemo = new Map();

function computeSadeSatiMemo(moonSign, nowMs = Date.now()) {
  const day = Math.floor(nowMs / DAY_MS_KEY);
  const key = `${moonSign}:${day}`;
  let hit = sadeSatiMemo.get(key);
  if (!hit) {
    // Compute from the START of the day rather than the caller's instant, so a
    // given day always yields one answer no matter who asked first.
    hit = computeSadeSati(moonSign, day * DAY_MS_KEY);
    // Only ever ~12 live keys; anything else is yesterday's. Clearing wholesale
    // is simpler than tracking ages and costs one recompute per sign per day.
    if (sadeSatiMemo.size >= 24) sadeSatiMemo.clear();
    sadeSatiMemo.set(key, hit);
  }
  // Hand back a copy: this object is shared by every request for that sign
  // today, and a caller mutating it would corrupt everyone else's chart. The
  // clone is microseconds against the 57ms it replaces.
  return structuredClone(hit);
}

module.exports = {
  computeTransits,
  computeSadeSati: computeSadeSatiMemo,
  // The uncached function, for tests that need to measure or bypass the memo.
  computeSadeSatiUncached: computeSadeSati,
  _memoSize: () => sadeSatiMemo.size
};
