// Soul IDs — the shareable identity handle, instead of usernames.
//
// Deliberately NOT derived from the chart, for two reasons:
//
//   1. Enumeration. A searchable directory keyed on placements (27 nakshatras
//      × 12 signs) is a space you can walk in an afternoon, which would let
//      strangers read your Moon and rising before you've accepted anything.
//      A random pair drawn from these lists is ~4.1M combinations, and the
//      search endpoint is rate limited on top.
//   2. Stability. Correcting your birth time must not silently change an
//      identifier you've already given people. Assigned once, then frozen.
//
// Format: adjective-noun-NNN, e.g. "ember-comet-472". Lowercase, hyphenated,
// sayable out loud and typable on a phone without a keyboard fight.

const crypto = require("crypto");

const ADJECTIVES = [
  "amber", "argent", "astral", "aurora", "azure", "bright", "burning", "celestial",
  "cobalt", "cosmic", "crimson", "crystal", "dawn", "distant", "drifting", "dusk",
  "ember", "eternal", "falling", "fervent", "first", "gentle", "gilded", "glowing",
  "golden", "hidden", "hollow", "indigo", "infinite", "ivory", "jade", "lucent",
  "lunar", "midnight", "mirrored", "molten", "night", "noble", "obsidian", "opal",
  "orbital", "pale", "quiet", "radiant", "rising", "roaming", "rose", "sable",
  "sapphire", "scarlet", "shifting", "silent", "silver", "solar", "sovereign", "still",
  "stellar", "sunlit", "tidal", "velvet", "violet", "wandering", "waning", "waxing"
];

const NOUNS = [
  "arc", "ash", "aster", "aurora", "beacon", "blaze", "bloom", "cinder",
  "comet", "compass", "corona", "crescent", "crown", "current", "dawn", "delta",
  "drift", "dusk", "echo", "eclipse", "ember", "equinox", "field", "flame",
  "flare", "flux", "gate", "glow", "grove", "halo", "harbor", "haze",
  "horizon", "lantern", "ledger", "lotus", "meridian", "mirror", "nebula", "nova",
  "ocean", "omen", "orbit", "oracle", "pathway", "phase", "prism", "pulse",
  "quasar", "reef", "relic", "river", "shore", "signal", "solstice", "spark",
  "sphere", "spire", "storm", "thread", "tide", "vessel", "void", "zenith"
];

// 64 × 64 × 1000 ≈ 4.1M. Leading zeros are kept ("ember-comet-047") so the
// range is a full 1000 rather than 900.
const NUM_MIN = 0;
const NUM_MAX = 999;

/** Uniform pick without modulo bias. */
function pick(arr) {
  return arr[crypto.randomInt(arr.length)];
}

/** Generate a candidate Soul ID. Callers must check uniqueness and retry. */
function generate() {
  const n = String(crypto.randomInt(NUM_MIN, NUM_MAX + 1)).padStart(3, "0");
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${n}`;
}

/**
 * Shape check only — says nothing about whether it exists. Kept strict so a
 * lookup can reject junk without touching the database.
 */
function isValid(id) {
  return typeof id === "string" && /^[a-z]+-[a-z]+-\d{3}$/.test(id);
}

/**
 * People will paste these with stray spaces, capitals, a leading "@" or the
 * fancy "✦" we render alongside them. Normalise before comparing.
 */
function normalize(input) {
  return String(input == null ? "" : input)
    .trim()
    .toLowerCase()
    .replace(/^[@✦\s]+/, "")
    .replace(/\s+/g, "-")
    .replace(/[‐-―]/g, "-") // unicode dashes from chat apps
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** How it reads in the UI. */
const display = id => (isValid(id) ? `✦ ${id}` : "");

/** Total addressable space, for reasoning about enumeration. */
const SPACE = ADJECTIVES.length * NOUNS.length * (NUM_MAX - NUM_MIN + 1);

module.exports = { generate, isValid, normalize, display, SPACE, ADJECTIVES, NOUNS };
