// The gender/role split is the whole point of this module, so the tests are
// mostly about the seam: gender is what someone told us, role is an index into
// a directional matrix, and "other" must not silently become one of the two.
const test = require("node:test");
const assert = require("node:assert");
const g = require("./gender");

test("normalizeGender accepts the three values, in any casing", () => {
  assert.equal(g.normalizeGender("male"), "male");
  assert.equal(g.normalizeGender("Female"), "female");
  assert.equal(g.normalizeGender("  OTHER "), "other");
});

test("an unanswered gender is null, never a default", () => {
  // The UI keys the manual toggle off this, so "we never asked" has to stay
  // distinguishable from "they answered".
  for (const v of [undefined, null, "", "  ", "man", "M", "nonbinary", 1, {}]) {
    assert.equal(g.normalizeGender(v), null, `${JSON.stringify(v)} should not normalize`);
  }
});

test("roleFromGender maps the two the kutas can index", () => {
  assert.equal(g.roleFromGender("male"), "groom");
  assert.equal(g.roleFromGender("female"), "bride");
});

test("'other' and unknown defer to the role the user picked by hand", () => {
  assert.equal(g.roleFromGender("other", "bride"), "bride");
  assert.equal(g.roleFromGender("other", "groom"), "groom");
  assert.equal(g.roleFromGender(null, "bride"), "bride");
  assert.equal(g.roleFromGender(undefined, "bride"), "bride");
});

test("a stated gender overrides a contradictory fallback role", () => {
  // If someone recorded male, a stale "bride" toggle must not win.
  assert.equal(g.roleFromGender("male", "bride"), "groom");
  assert.equal(g.roleFromGender("female", "groom"), "bride");
});

test("with no gender and no fallback, the role is still valid", () => {
  // gunamilan.js indexes [boy][girl] and cannot take undefined.
  assert.ok(g.ROLES.includes(g.roleFromGender(null, undefined)));
  assert.ok(g.ROLES.includes(g.roleFromGender("other", "nonsense")));
});

test("roleIsImplied is true only when gender settles it", () => {
  assert.equal(g.roleIsImplied("male"), true);
  assert.equal(g.roleIsImplied("female"), true);
  assert.equal(g.roleIsImplied("other"), false, "'other' must still ask");
  assert.equal(g.roleIsImplied(null), false);
});

test("genderFromRole back-fills accounts that predate the field", () => {
  assert.equal(g.genderFromRole("groom"), "male");
  assert.equal(g.genderFromRole("bride"), "female");
  assert.equal(g.genderFromRole(null), null, "no role recorded means no inference");
  assert.equal(g.genderFromRole("other"), null);
});

test("normalizeRole always yields something the matrices can index", () => {
  assert.equal(g.normalizeRole("bride"), "bride");
  assert.equal(g.normalizeRole("groom"), "groom");
  assert.equal(g.normalizeRole(undefined), "groom");
  assert.equal(g.normalizeRole("other"), "groom");
});
