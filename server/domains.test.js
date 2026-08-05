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

test("the divergence arm escapes its fragment too, not just the promise", () => {
  // The divergence branch builds its half of the HTML by hand so it can wrap the
  // verdict in <b>, which means it does its own esc() call — and nothing pinned
  // it. Deleting that esc() used to leave the whole suite green while hostile
  // content rendered live. This is the assertion that goes red.
  const read = domainRead(CHART, "career");
  assert.equal(read.slot2, "divergence", "fixture: career must diverge");
  const hostile = { ...read, lordKey: '<img src=x onerror=alert(1)>' };
  const html = domainLineHtml(hostile);
  assert.match(html, /<b>/, "the divergence arm actually fired");
  assert.ok(!/<img/.test(html), `hostile lordKey rendered live: ${html}`);
  // The lord is named twice — once in the promise, once in the divergence — and
  // both occurrences must come back escaped.
  const escaped = html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || [];
  assert.equal(escaped.length, 2, `expected both mentions escaped, got ${escaped.length}: ${html}`);
});

test("D9 is the partnership chart where it governs, and only a strength grade where it is borrowed", () => {
  // situationships owns the navamsa (vargaRole "domain"); friendships only
  // borrows it as a general strength grade because there is no D11. Calling it
  // "the strength chart" on the situationships card understates the single most
  // load-bearing varga in the whole set.
  const sit = domainRead(CHART, "situationships");
  const fr = domainRead(CHART, "friendships");
  assert.equal(sit.slot2, "divergence", "fixture: situationships must print the varga");
  assert.equal(fr.slot2, "divergence", "fixture: friendships must print the varga");
  assert.equal(sit.sustain.varga, "D9");
  assert.equal(fr.sustain.varga, "D9");

  const sitLine = domainLine(sit), frLine = domainLine(fr);
  assert.match(sitLine, /D9, the partnership chart/, `situationships: ${sitLine}`);
  assert.match(frLine, /D9, the strength chart/, `friendships: ${frLine}`);
  assert.ok(!/strength chart/.test(sitLine), `situationships must not read D9 as a grade: ${sitLine}`);
  assert.ok(!/partnership chart/.test(frLine), `friendships must not read D9 as its topic: ${frLine}`);
});

test("a house-loud line never repeats the lord the promise already named", () => {
  // The lord is itself in `occupants` whenever it sits in the house it rules, so
  // the naive rendering spent slot 2 restating slot 1: "...ruled by Saturn,
  // sitting in your 10th... Sun, Mercury and Saturn sit right in the 10th."
  const c = JSON.parse(JSON.stringify(CHART));
  c.ascendant.signIndex = 2;  // Cancer asc → 10th is Pisces → Jupiter rules it
  const putAt = (key, signIndex) => {
    const p = c.planets.find(x => x.key === key);
    p.signIndex = signIndex;
    p.house = ((signIndex - 2 + 12) % 12) + 1;
  };
  putAt("Jupiter", 11);   // the career lord, in the house it rules
  putAt("Sun", 11);
  putAt("Mercury", 11);
  putAt("Moon", 0); putAt("Mars", 1); putAt("Venus", 3);
  putAt("Saturn", 4); putAt("Rahu", 5); putAt("Ketu", 6);
  c.synthesis = computeSynthesis(c);

  const read = domainRead(c, "career");
  assert.equal(read.slot2, "loud");
  assert.equal(read.loudWhere, "house");
  assert.ok(read.loudSet.includes(read.lordKey), "fixture: the lord is one of the occupants");

  const line = domainLine(read);
  const mentions = line.split(read.lordKey).length - 1;
  assert.equal(mentions, 1, `${read.lordKey} is named ${mentions} times: ${line}`);
  // Slot 2 still has something to say — the other occupants.
  assert.match(line, /Sun and Mercury sit right in the 10th/, line);
});

test("a house holding only Ketu is not reported to the model as empty", () => {
  const c = JSON.parse(JSON.stringify(CHART));   // Aries asc; 4th house is Cancer
  const ketu = c.planets.find(p => p.key === "Ketu");
  ketu.signIndex = 3; ketu.house = 4;
  c.synthesis = computeSynthesis(c);

  const ctx = domainContext(domainRead(c, "home"));
  assert.match(ctx, /In the house: Ketu/, `Ketu must be listed: ${ctx}`);
  assert.ok(!/No planets in the house/.test(ctx), `the prompt asserts a false fact: ${ctx}`);
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
