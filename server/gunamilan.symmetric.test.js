// Scoring a couple without designating a groom and a bride.
//
// The property that matters is invariance: whichever order the two people are
// passed in, the answer must be the same. The gendered scorer gets that for
// free from the roles; without roles it has to be built, and these tests are
// what stop it regressing back into "whoever was listed first is the groom".
const test = require("node:test");
const assert = require("node:assert");
const { computeGunaMilan, computeGunaMilanSymmetric, matchToText } = require("./gunamilan");

const A = { nakIndex: 10, signIndex: 4, degInSign: 12 };  // Purva Phalguni, Leo
const B = { nakIndex: 3, signIndex: 1, degInSign: 20 };   // Rohini, Taurus

// A pair chosen because the directional kutas disagree across it.
const findAsymmetricPair = () => {
  for (let n1 = 0; n1 < 27; n1++) {
    for (let s1 = 0; s1 < 12; s1++) {
      for (let n2 = 0; n2 < 27; n2++) {
        for (let s2 = 0; s2 < 12; s2++) {
          const x = { nakIndex: n1, signIndex: s1, degInSign: 10 };
          const y = { nakIndex: n2, signIndex: s2, degInSign: 10 };
          if (computeGunaMilan(x, y).total !== computeGunaMilan(y, x).total) return [x, y];
        }
      }
    }
  }
  throw new Error("no asymmetric pair exists — the directional kutas would be pointless");
};

test("the directional problem this exists to solve is real", () => {
  const [x, y] = findAsymmetricPair();
  assert.notEqual(
    computeGunaMilan(x, y).total,
    computeGunaMilan(y, x).total,
    "the gendered scorer must depend on who is named groom"
  );
});

test("the symmetric score does not depend on argument order", () => {
  const [x, y] = findAsymmetricPair();
  const ab = computeGunaMilanSymmetric(x, y);
  const ba = computeGunaMilanSymmetric(y, x);

  assert.equal(ab.total, ba.total, "swapping the two people must not change the total");
  assert.deepEqual(ab.kutas.map(k => k.score), ba.kutas.map(k => k.score));
  assert.equal(ab.spread, ba.spread);
});

test("the total is the mean of the two readings, and stays on the 36 scale", () => {
  const [x, y] = findAsymmetricPair();
  const sym = computeGunaMilanSymmetric(x, y);
  const fwd = computeGunaMilan(x, y).total;
  const rev = computeGunaMilan(y, x).total;

  assert.equal(sym.max, 36);
  assert.ok(Math.abs(sym.total - (fwd + rev) / 2) < 0.06, `${sym.total} should be the mean of ${fwd}/${rev}`);
  assert.ok(sym.total >= 0 && sym.total <= 36);
  assert.equal(sym.spread, Math.round(Math.abs(fwd - rev) * 10) / 10);
});

test("both readings are reported, not just the average", () => {
  // A midpoint presented alone would hide that the tables disagreed.
  const [x, y] = findAsymmetricPair();
  const sym = computeGunaMilanSymmetric(x, y);

  assert.equal(sym.passes.ab, computeGunaMilan(x, y).total);
  assert.equal(sym.passes.ba, computeGunaMilan(y, x).total);
  const directional = sym.kutas.filter(k => k.directional);
  assert.ok(directional.length > 0);
  for (const k of directional) {
    assert.equal(k.scores.length, 2);
    assert.match(k.detail, /reads .* or .* by side/);
  }
});

test("only Varna, Gana and Vashya are ever directional", () => {
  // Verified against the matrices rather than assumed — if another kuta starts
  // varying by side, the module comment is wrong and should be fixed.
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    const x = { nakIndex: i % 27, signIndex: i % 12, degInSign: (i * 7) % 30 };
    const y = { nakIndex: (i * 5) % 27, signIndex: (i * 3) % 12, degInSign: (i * 11) % 30 };
    for (const k of computeGunaMilanSymmetric(x, y).kutas) if (k.directional) seen.add(k.name);
  }
  assert.deepEqual([...seen].sort(), ["Gana", "Varna", "Vashya"]);
});

test("side-independent kutas keep their exact classical score", () => {
  // Averaging must not smear a kuta that both readings agree on.
  const sym = computeGunaMilanSymmetric(A, B);
  const fwd = computeGunaMilan(A, B);
  for (const [i, k] of sym.kutas.entries()) {
    if (!k.directional) assert.equal(k.score, fwd.kutas[i].score, `${k.name} should be untouched`);
  }
});

test("Nadi and Bhakoot doshas survive unchanged", () => {
  const sym = computeGunaMilanSymmetric(A, B);
  const fwd = computeGunaMilan(A, B);
  assert.deepEqual(sym.doshas, fwd.doshas);
});

test("an identical pair still scores Nadi dosha, both ways round", () => {
  const same = { nakIndex: 10, signIndex: 4, degInSign: 12 };
  const sym = computeGunaMilanSymmetric(same, { ...same });
  assert.equal(sym.doshas.nadi, true, "same nakshatra means same nadi");
  assert.equal(sym.spread, 0, "an identical pair cannot disagree by side");
});

test("the result carries the shape existing consumers already read", () => {
  const sym = computeGunaMilanSymmetric(A, B);
  for (const key of ["total", "max", "verdict", "kutas", "boy", "girl", "doshas"]) {
    assert.ok(sym[key] !== undefined, `missing ${key}`);
  }
  assert.equal(sym.symmetric, true);
  assert.ok(sym.a && sym.b, "neutral labels are available too");
});

test("a directional result says so in its caveats", () => {
  const [x, y] = findAsymmetricPair();
  const sym = computeGunaMilanSymmetric(x, y);
  assert.ok(
    sym.verdict.caveats.some(c => /without a groom\/bride assignment/.test(c)),
    "the reader has to be told the score is an average"
  );
});

test("the LLM context never calls either person the groom or the bride", () => {
  // This is the failure that actually reaches a user: a label in the prompt
  // comes straight back out in the reply.
  const [x, y] = findAsymmetricPair();
  const text = matchToText(computeGunaMilanSymmetric(x, y));
  assert.ok(!/\[groom\]|\[bride\]/.test(text), text.slice(0, 200));
  assert.match(text, /Scored symmetrically/);
  assert.match(text, /do not refer to either person as the groom or the bride/);
});

test("the gendered path is untouched by any of this", () => {
  const fwd = computeGunaMilan(A, B);
  assert.equal(fwd.symmetric, undefined);
  assert.equal(matchToText(fwd).includes("[groom]"), true);
});
