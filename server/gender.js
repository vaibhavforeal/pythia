// Gender on the native, and the marriage role the Ashtakoot kutas need.
//
// Two different things get conflated here, so they are kept apart deliberately:
//
//   gender — a fact about the person, stored once on their profile. Three
//     values, because a two-valued field forces people who are neither to
//     misdescribe themselves just to use the app.
//
//   role — "groom" or "bride", which is NOT a fact about anyone. It is an
//     index into gunamilan.js's kuta matrices, which are [boy][girl]
//     directional: Vashya, Tara, Graha Maitri and Gana all score differently
//     depending on which side of the pair you sit. The matrices need exactly
//     one of each, so a role has to be assigned even when gender doesn't
//     supply one.
//
// Keeping them separate is what lets the profile stay honest while the maths
// still runs. Where gender can't determine a role — "other", or an older
// account that never recorded one — the caller supplies the fallback the user
// picked by hand, and we do not guess from the chart.
//
// Deriving role from gender is a Phase-1 convenience: it stops the app asking
// "are you the guy or the girl?" on every single comparison. It is NOT a fix
// for same-sex pairings — two males still collapse to one groom and one bride
// here, which mislabels someone. That needs gunamilan.js to score both
// directions and reconcile them, which is a scoring change, not a plumbing one.

const GENDERS = ["male", "female", "other"];
const ROLES = ["groom", "bride"];

// Anything unrecognised becomes null rather than a default, so "we never asked"
// stays distinguishable from "they told us". The UI needs that difference to
// know whether to show the manual role toggle.
function normalizeGender(value) {
  if (typeof value !== "string") return null;
  const g = value.trim().toLowerCase();
  return GENDERS.includes(g) ? g : null;
}

function normalizeRole(value) {
  return value === "bride" ? "bride" : "groom";
}

// Back-fill for accounts that predate the gender field: they only ever stored a
// role, so read the gender it implies. A stored gender always wins over this.
function genderFromRole(role) {
  if (role === "groom") return "male";
  if (role === "bride") return "female";
  return null;
}

// The one place the gender -> role mapping lives. `fallback` is whatever the
// user last chose by hand; it decides the cases gender can't.
function roleFromGender(gender, fallback) {
  const g = normalizeGender(gender);
  if (g === "male") return "groom";
  if (g === "female") return "bride";
  return normalizeRole(fallback);
}

// True when gender settles the role on its own, i.e. the client can hide the
// manual toggle instead of asking a question it already knows the answer to.
function roleIsImplied(gender) {
  const g = normalizeGender(gender);
  return g === "male" || g === "female";
}

module.exports = { GENDERS, ROLES, normalizeGender, normalizeRole, genderFromRole, roleFromGender, roleIsImplied };
