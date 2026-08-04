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
  // Injected markup in the copy must come back escaped, not live. Test promiseSentence path.
  const hostile1 = { ...read, houseLabel: '<img src=x onerror=alert(1)>' };
  assert.ok(!/<img/.test(domainLineHtml(hostile1)));
  assert.match(domainLineHtml(hostile1), /&lt;img/);
  // Also test the secondSentence path: force slot2 to "shade" so maha appears.
  const hostile2 = { ...read, slot2: "shade", maha: '<script>alert(1)</script>', eraTouches: "rules it" };
  assert.ok(!/<script/.test(domainLineHtml(hostile2)));
  assert.match(domainLineHtml(hostile2), /&lt;script/);
});

test("the verdict phrase is emphasised with <b> tags on divergence", () => {
  const read = domainRead(CHART, "career");
  // Career in this chart has divergence (grows-into-it)
  assert.equal(read.slot2, "divergence", "career should have divergence slot2");
  const html = domainLineHtml(read);
  // The verdict phrase "this one you grow into" should be wrapped in <b>.
  assert.match(html, /<b>this one you grow into<\/b>/, `<b> tags must wrap the verdict: ${html}`);
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

test("the stale context instructs the model not to invent placements", () => {
  const stale = JSON.parse(JSON.stringify(CHART));
  delete stale.synthesis;
  const read = domainRead(stale, "friendships");
  const ctx = domainContext(read);
  assert.ok(ctx.length > 0, "stale context is non-empty");
  assert.match(ctx, /STALE/, "context labels the stale state");
  assert.match(ctx, /Domain:.*friendships/i, "context names the domain");
  assert.match(ctx, /missing or predates/i, "context explains the missing data");
  assert.match(ctx, /not in chart placements/i, "context forbids invented structure");
});

test("the loud case with loudWhere='house' names the domain house, not deictic 'there'", () => {
  // Build a chart with 2+ occupants in the career house so loudWhere="house".
  // Cancer asc (signIndex 2), career (10th = Pisces at signIndex 11, lord Jupiter).
  // Jupiter + Sun + Mercury in 10th → 3 occupants → loudWhere="house".
  const c = JSON.parse(JSON.stringify(CHART));
  c.ascendant.signIndex = 2;  // Cancer
  const putAt = (key, signIndex) => {
    const p = c.planets.find(x => x.key === key);
    p.signIndex = signIndex;
    p.house = ((signIndex - 2 + 12) % 12) + 1;  // house formula with Cancer asc
  };
  putAt("Jupiter", 11);   // Pisces, 10th house (career lord)
  putAt("Sun", 11);       // Also in 10th (occupant 2)
  putAt("Mercury", 11);   // Also in 10th (occupant 3, benefic)
  // Put the rest elsewhere
  putAt("Moon", 0);
  putAt("Mars", 1);
  putAt("Venus", 3);
  putAt("Saturn", 4);
  putAt("Rahu", 5);
  putAt("Ketu", 6);

  c.synthesis = computeSynthesis(c);

  const read = domainRead(c, "career");
  assert.equal(read.loudWhere, "house", `must have loudWhere='house', got '${read.loudWhere}'`);
  const line = domainLine(read);

  // The line must name the specific house (10th), not use deictic "right there"
  assert.match(line, /10th/, `line must name the 10th house: ${line}`);
  assert.ok(!/right there/i.test(line), `line must NOT say 'right there': ${line}`);
  assert.match(line, /right in the 10th/, `line must say 'right in the 10th': ${line}`);
});
