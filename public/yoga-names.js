// Plain-language names for the classical yogas. The Sanskrit stays the
// credibility anchor — nerd mode still shows it, and the LLM context in
// server/astro.js is untouched — but the feed leads with what the yoga
// actually means. Keyed by the server's yoga key (server/yogas.js).
//
// Lives in its own file because tools/yoga-frequency.js needs the same mapping
// to aggregate rarity by alias: one source of truth for browser and Node.
const YOGA_ALIAS = {
  mp_Mars: "built different",              // Ruchaka — Mars strong in a kendra
  mp_Mercury: "big brain energy",          // Bhadra
  mp_Jupiter: "old soul energy",           // Hamsa
  mp_Venus: "unfairly attractive",         // Malavya
  mp_Saturn: "quiet power",                // Sasa
  gajakesari: "legend status",             // Jupiter–Moon: lasting reputation
  budhaditya: "speaks it into existence",  // Sun–Mercury: mind and voice
  chandramangala: "money moves",           // Moon–Mars: wealth through enterprise
  dhana_single: "secured the bag",         // one planet lords both 2nd & 11th
  dhana: "secured the bag",                // 2nd & 11th lords linked
  durudhara: "your people show up",        // planets flanking the Moon both sides
  sunapha: "self-made",                    // 2nd from Moon
  anapha: "unbothered",                    // 12th from Moon: poise, detachment
  kemadruma: "lone wolf arc",              // isolated Moon
  kalasarpa: "hard mode enabled"           // all planets between the nodes
};
// Dynamic keys (raja_Venus, vip_8, pari_Sun_Moon…) match on prefix.
const YOGA_ALIAS_PREFIX = [
  ["raja_", "the come-up"],           // kendra–trikona lords linked
  ["nbry_", "underdog arc"],          // debilitation cancelled
  ["vip_", "villain origin story"],   // Vipreet — rise through adversity
  ["pari_", "iconic duo"]             // Parivartana — mutual exchange
];

// Trendy name for a yoga; falls back to the Sanskrit minus its "Yoga" suffix
// so a newly added server-side yoga still renders sensibly.
function yogaAlias(y) {
  if (!y) return "";
  if (YOGA_ALIAS[y.key]) return YOGA_ALIAS[y.key];
  const hit = YOGA_ALIAS_PREFIX.find(([p]) => String(y.key || "").startsWith(p));
  if (hit) return hit[1];
  return String(y.name || "").replace(/\s*Yoga\b.*$/, "").trim() || y.name || "";
}

// Browser: these stay top-level script globals. Node (the rarity generator):
if (typeof module !== "undefined" && module.exports) {
  module.exports = { YOGA_ALIAS, YOGA_ALIAS_PREFIX, yogaAlias };
}
