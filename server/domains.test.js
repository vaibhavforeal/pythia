// The card renderer. Two things are worth guarding: the copy table and the
// structural table must not drift apart, and the two-slot rule must actually
// suppress — a card with a loud house AND a live era AND a divergence prints
// the divergence and nothing else.
const test = require("node:test");
const assert = require("node:assert");
const {
  DOMAINS, domainRead, domainLine, domainLineHtml, domainContext
} = require("../public/domains.js");
const { DOMAIN_SPEC, computeSynthesis } = require("./synthesis");
const { computeChart } = require("./astro");

const CHART = computeChart({
  year: 1996, month: 3, day: 14, hour: 9, minute: 25,
  lat: 12.9716, lon: 77.5946, tz: 5.5
});

test("the copy table and the structural table cover the same domains", () => {
  assert.deepStrictEqual(Object.keys(DOMAINS).sort(), Object.keys(DOMAIN_SPEC).sort());
});

test("every domain carries the copy a card needs", () => {
  for (const [key, d] of Object.entries(DOMAINS)) {
    for (const field of ["emoji", "kicker", "head", "houseLabel", "ask"]) {
      assert.ok(d[field], `${key} is missing ${field}`);
    }
  }
});

test("career exists and asks about work", () => {
  assert.ok(DOMAINS.career);
  assert.match(DOMAINS.career.ask, /\?$/);
});

test("the line prints exactly one factor after the promise", () => {
  for (const key of Object.keys(DOMAINS)) {
    const line = domainLine(domainRead(CHART, key));
    const sentences = line.split(/(?<=\.)\s+/).filter(Boolean);
    assert.ok(sentences.length <= 2, `${key} printed ${sentences.length} sentences: ${line}`);
  }
});

test("divergence suppresses the era clause", () => {
  // Hand-build the spec's worked example: Taurus asc, Saturn strong in D1's
  // 10th, fallen in D10, with Saturn also running as the mahadasha.
  const c = JSON.parse(JSON.stringify(CHART));
  c.ascendant.signIndex = 1;
  const put = (key, signIndex) => {
    const p = c.planets.find(x => x.key === key);
    p.signIndex = signIndex;
    p.house = ((signIndex - 1 + 12) % 12) + 1;
  };
  put("Saturn", 10);           // Aquarius, own sign, 10th house
  put("Jupiter", 10);          // makes the house loud too
  const d10 = c.divisionals.find(v => v.key === "D10");
  const sat = d10.planets.find(p => p.key === "Saturn");
  sat.signIndex = 0; sat.house = 12; sat.sameAsRashi = false;   // Aries, debilitated
  c.dasha.maha.lord = "Saturn";
  c.synthesis = computeSynthesis(c);

  const read = domainRead(c, "career");
  assert.equal(read.slot2, "divergence");
  const line = domainLine(read);
  assert.match(line, /D10/);
  assert.ok(!/era/i.test(line), `the era leaked into the line: ${line}`);
});

test("the html line escapes its fragments and emphasises only the verdict", () => {
  const read = domainRead(CHART, "career");
  const html = domainLineHtml(read);
  assert.ok(!/<(?!\/?b>)/.test(html), `only <b> may appear: ${html}`);
  // Injected markup in the copy must come back escaped, not live.
  const hostile = { ...read, houseLabel: '<img src=x onerror=alert(1)>', stale: true };
  assert.ok(!/<img/.test(domainLineHtml(hostile)));
  assert.match(domainLineHtml(hostile), /&lt;img/);
});

test("the model context states the hierarchy rather than implying it", () => {
  const ctx = domainContext(domainRead(CHART, "career"));
  for (const label of ["BASELINE", "PROMISE", "SUSTAIN", "VERDICT", "SHADE", "RULE"]) {
    assert.ok(ctx.includes(label), `context is missing ${label}`);
  }
  assert.ok(ctx.indexOf("PROMISE") < ctx.indexOf("SUSTAIN"));
  assert.ok(ctx.indexOf("SUSTAIN") < ctx.indexOf("SHADE"));
});

test("a chart with no synthesis still renders a line", () => {
  const stale = JSON.parse(JSON.stringify(CHART));
  delete stale.synthesis;
  const read = domainRead(stale, "friendships");
  assert.ok(read, "domainRead survives a stale chart");
  assert.ok(domainLine(read).length > 0);
});
