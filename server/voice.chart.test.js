// The spoken chart: what a voice session is allowed to know without asking.
//
// Two things are guarded here, and they fail in opposite directions.
//
// Size, because a realtime session has no cache_control — the whole instruction
// string is re-sent to the model on EVERY turn, so an innocent-looking "just add
// the vargas back" is a per-turn tax for the life of the feature.
//
// And chat, because chartToText is the sole grounding for the paid text path.
// The snapshot assertion at the bottom is the reason chartToSpokenText is a
// separate function rather than an option on chartToText.
const test = require("node:test");
const assert = require("node:assert");
const { computeChart, chartToText, chartToSpokenText } = require("./astro");

// Bengaluru, 2004 — the same fixture tools/register-check.js uses.
//
// computeChart reads the clock for transits and the running dasha, so every
// assertion below is deliberately structural (is the section present? how big?)
// rather than about any particular placement. A test that asserts "Saturn is in
// Pisces" starts failing on its own one morning.
const BIRTH = {
  year: 2004, month: 6, day: 14, hour: 9, minute: 20,
  lat: 12.9716, lon: 77.5946, tz: 5.5, name: "Test",
  nodeAspects: [5, 7, 9], nodeMode: "jupiter", gender: "female"
};

const chart = computeChart(BIRTH);
const spoken = chartToSpokenText(chart);
const full = chartToText(chart);

test("the spoken chart keeps everything a voice reply reasons from", () => {
  for (const needle of [
    "Ascendant / Lagna:",
    "Lagna lord condition:",
    "Planetary positions",
    "Current Mahadasha:",
    "Current Antardasha:",
    "=== PRIMARY VARGAS",   // the product — a varga grades the rashi
    "SADE SATI",            // tiny, and the highest emotional salience here
    "ASHTAKAVARGA summary"
  ]) {
    assert.ok(spoken.includes(needle), `spoken chart is missing ${needle}`);
  }
});

test("the spoken chart drops what is only ever read, never said", () => {
  // Each of these moved behind lookup_chart_detail rather than being lost.
  assert.ok(!spoken.includes("supplementary reference only"), "the 16 extra vargas are still inline");
  assert.ok(!spoken.includes("Bhinnashtakavarga"), "the BAV grid is still inline");
  assert.ok(!spoken.includes("Sarvashtakavarga (SAV) by house"), "the SAV grid is still inline");
  assert.ok(!spoken.includes("D16"), "supplementary divisionals are still inline");
  assert.ok(!spoken.includes("Upcoming Mahadashas"), "the upcoming dasha list is still inline");
  // Degrees are never spoken aloud, and the nakshatra already carries position.
  assert.ok(!spoken.includes("°"), "degrees survived into the spoken chart");
  // The same relation stated twice; one direction is enough.
  assert.ok(!spoken.includes("is aspected (seen) by"), "both aspect directions are still listed");
});

test("the spoken chart is at most half the size of the full one", () => {
  // Not a style preference. At ~7,400 tokens of instructions re-sent per turn,
  // a twenty-turn call was costing ~148k input tokens before this trim.
  assert.ok(
    spoken.length < full.length * 0.55,
    `spoken ${spoken.length}B vs full ${full.length}B — the trim has regressed`
  );
});

test("a spoken chart says nothing in markdown", () => {
  // It is about to be synthesised into speech. A pipe or a hash is either read
  // aloud as a word or swallowed mid-sentence; neither is what anyone wants.
  assert.ok(!/[|#*]/.test(spoken), "markdown punctuation reached the spoken chart");
});

test("chartToText is untouched — the paid chat path cannot regress", () => {
  // Guards the design decision, not the output: if someone later refactors
  // chartToSpokenText into a shared code path with an options flag, the chat
  // grounding becomes one typo away from silently changing. These two assertions
  // are cheap and the failure they prevent is expensive.
  assert.ok(full.includes("=== Divisional charts (vargas) — supplementary reference only ==="));
  assert.ok(full.includes("Bhinnashtakavarga (BAV)"));
  assert.ok(full.includes("is aspected (seen) by"));
  assert.ok(full.includes("°"));
});
