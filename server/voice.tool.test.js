// chartDetail — the read side of the chart guardrail.
//
// The spoken chart deliberately withholds every exact figure a model is likely
// to half-remember. This is where those figures live, so the model's only
// options are "ask" or "say I don't know". That only holds if the function is
// impossible to knock over: the worst outcome in a live call is not a wrong
// argument, it is the agent going silent because something threw.
//
// So the recurring assertion here is never throws, always a plain spoken
// sentence, always short enough to say out loud.
const test = require("node:test");
const assert = require("node:assert");
const { computeChart, chartDetail, DETAIL_TOPICS } = require("./astro");

const BIRTH = {
  year: 2004, month: 6, day: 14, hour: 9, minute: 20,
  lat: 12.9716, lon: 77.5946, tz: 5.5, name: "Test",
  nodeAspects: [5, 7, 9], nodeMode: "jupiter", gender: "female"
};
const chart = computeChart(BIRTH);

/** Every answer must survive being spoken. */
function assertSpeakable(out, label) {
  assert.equal(typeof out, "string", `${label}: not a string`);
  assert.ok(out.length > 0, `${label}: empty`);
  assert.ok(out.length <= 600, `${label}: ${out.length} chars is too long to say aloud`);
  assert.ok(!/[|#*]/.test(out), `${label}: contains markdown punctuation`);
  assert.ok(!/\n/.test(out), `${label}: contains a newline`);
}

test("every documented topic returns a speakable answer", () => {
  const args = {
    varga: { detail: "varga", varga: "D10" },
    ashtakavarga_sav: { detail: "ashtakavarga_sav" },
    ashtakavarga_bav: { detail: "ashtakavarga_bav", planet: "Saturn" },
    dasha_dates: { detail: "dasha_dates" },
    transits_full: { detail: "transits_full" },
    navamsa_full: { detail: "navamsa_full" }
  };
  // If a topic is added to the enum without a handler, this notices.
  assert.deepEqual(Object.keys(args).sort(), DETAIL_TOPICS.slice().sort());
  for (const [topic, a] of Object.entries(args)) {
    assertSpeakable(chartDetail(chart, a), topic);
  }
});

test("the figures are the real ones, not a plausible-looking summary", () => {
  const bav = chartDetail(chart, { detail: "ashtakavarga_bav", planet: "Saturn" });
  const row = chart.ashtakavarga.bav.Saturn;
  const total = row.reduce((a, b) => a + b, 0);
  assert.ok(bav.includes(row.join(", ")), "BAV row does not match the chart");
  assert.ok(bav.includes(String(total)), "BAV total does not match the chart");

  const sav = chartDetail(chart, { detail: "ashtakavarga_sav" });
  assert.ok(sav.includes(String(chart.ashtakavarga.savTotal)), "SAV total does not match the chart");

  const d10 = chartDetail(chart, { detail: "varga", varga: "D10" });
  const real = chart.divisionals.find(v => v.key === "D10");
  assert.ok(d10.includes(real.ascendant.sign), "D10 lagna does not match the chart");
});

test("garbage in gets a sentence out, never a throw", () => {
  // A model that has been told to call a tool WILL eventually call it wrong.
  // Every one of these is a live-call scenario, not a hypothetical.
  const junk = [
    {}, null, undefined, "varga", 42, [],
    { detail: "nonsense" },
    { detail: "" },
    { detail: "varga" },                                  // no varga named
    { detail: "varga", varga: "D99" },                    // one we don't compute
    { detail: "varga", varga: 10 },                       // wrong type
    { detail: "ashtakavarga_bav" },                       // no planet named
    { detail: "ashtakavarga_bav", planet: "Pluto" },      // not a target
    { detail: "dasha_dates", lord: "Cthulhu" },
    { detail: "VARGA", varga: "d10" }                     // casing
  ];
  for (const a of junk) {
    let out;
    assert.doesNotThrow(() => { out = chartDetail(chart, a); }, `threw on ${JSON.stringify(a)}`);
    assertSpeakable(out, JSON.stringify(a));
  }
});

test("an unknown topic names what it can actually do", () => {
  // So a confused model can correct itself on the next turn instead of looping.
  const out = chartDetail(chart, { detail: "nonsense" });
  for (const topic of DETAIL_TOPICS) {
    assert.ok(out.includes(topic), `the recovery hint omits ${topic}`);
  }
});

test("a missing chart is refused rather than faked", () => {
  // The route never starts an ungrounded session, so this is defence in depth:
  // if it ever happens, saying so is the only acceptable behaviour.
  for (const c of [null, undefined]) {
    const out = chartDetail(c, { detail: "ashtakavarga_sav" });
    assertSpeakable(out, "no chart");
    assert.ok(/don't have|can't/i.test(out), "a missing chart produced a confident answer");
  }
});
