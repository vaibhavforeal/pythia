// Situation reads: the structural spine behind "where should my energy go".
//
// The point of this file is that the frame arrives BEFORE the user speaks. Ask
// a general-purpose chatbot "am I overreacting about my friend?" and it mirrors
// your framing back, which is why those conversations loop. Here the chart
// supplies a fixed frame the answer has to fit: which house governs the domain,
// who rules it, where that ruler sits, and what the running dasha wants.
//
// Everything here is computed from the chart the client already holds — no
// round trip, no model call. The model only writes the four slots afterwards,
// grounded in this.

const SIGN_LORDS = [
  "Mars", "Venus", "Mercury", "Moon", "Sun", "Mercury",
  "Venus", "Mars", "Jupiter", "Saturn", "Saturn", "Jupiter"
];

// What it means for a house to be where your domain's ruler ended up.
const HOUSE_MEANING = {
  1: "yourself", 2: "what you hold onto", 3: "your own effort", 4: "home and comfort",
  5: "play and creativity", 6: "conflict and grind", 7: "other people", 8: "upheaval and depth",
  9: "belief and mentors", 10: "work and status", 11: "your circle and gains", 12: "retreat and letting go"
};

// Plain-language gloss for a ruler landing in each house — written as "where
// the energy actually goes", since that's the question being asked.
const LORD_IN_HOUSE = {
  1: "it comes back to you — you are the one setting the terms here",
  2: "you invest in keeping things, which can tip into holding on too long",
  3: "it runs on your own effort; nobody's handing it to you",
  4: "it's tangled up with home and needing to feel safe",
  5: "it lives in play, attraction and ego — fun, and easy to over-invest in",
  6: "it costs you friction; this area takes maintenance others don't see",
  7: "it depends heavily on other people showing up",
  8: "it moves in sudden shifts, and a lot of it stays private",
  9: "it's shaped by what you believe you're owed, and by who mentors you",
  10: "it's bound to reputation — how it looks matters more than you admit",
  11: "it flows through your circle; the group carries it",
  12: "it drains quietly, often to people or things you can't fully see"
};

const DOMAINS = {
  friendships: {
    emoji: "☍", kicker: "friendships", head: "your circle",
    house: 11, second: 3,
    houseLabel: "friend circles and what you gain from them",
    ask: "Who deserves my energy in my friendships right now, and what am I over-giving to?"
  },
  situationships: {
    emoji: "♡", kicker: "situationships", head: "the one you're unsure about",
    house: 7, second: 5,
    houseLabel: "partnership, and how you meet people one to one",
    ask: "Where do I actually stand in this situationship, and what am I holding onto that isn't mine to carry?"
  },
  home: {
    emoji: "⌂", kicker: "parents & home", head: "the house you grew up in",
    house: 4, second: 9,
    houseLabel: "home, mother, and what safety feels like to you",
    ask: "How do I deal with the pressure at home without carrying all of it, and what's actually mine to hold?"
  },
  focus: {
    emoji: "✎", kicker: "studies & focus", head: "your attention",
    house: 5, second: 10,
    houseLabel: "intellect, study and what you can actually concentrate on",
    ask: "Where should my focus go this term, and what am I burning attention on that isn't paying me back?"
  }
};

/** Whole-sign: the sign on the nth house from the ascendant. */
function houseSignIndex(chart, n) {
  const asc = chart && chart.ascendant && chart.ascendant.signIndex;
  if (!Number.isInteger(asc)) return null;
  return (((asc + n - 1) % 12) + 12) % 12;
}

/**
 * The structural read for one domain. Deliberately returns facts, not verdicts
 * — a chart describes conditions and timing, never how something turns out.
 */
function domainRead(chart, key) {
  const d = DOMAINS[key];
  if (!d || !chart || !chart.planets) return null;

  const signIdx = houseSignIndex(chart, d.house);
  if (signIdx === null) return null;

  const lordKey = SIGN_LORDS[signIdx];
  const lord = chart.planets.find(p => p.key === lordKey) || null;
  const occupants = chart.planets.filter(p => p.house === d.house && p.key !== "Ketu");
  const secondOccupants = chart.planets.filter(p => p.house === d.second);

  const maha = (chart.dasha && chart.dasha.maha && chart.dasha.maha.lord) || null;
  const antar = (chart.dasha && chart.dasha.antar && chart.dasha.antar.lord) || null;

  // Does the era actually touch this part of life? Three ways it can: it rules
  // the house, it sits in the house, or it's the ruler itself.
  const eraTouches =
    maha === lordKey ? "rules it" :
    (chart.planets.find(p => p.key === maha) || {}).house === d.house ? "sits in it" :
    occupants.some(p => p.key === maha) ? "sits in it" : null;

  return {
    key,
    ...d,
    sign: SIGNS_EN[signIdx] || "",
    signIndex: signIdx,
    lordKey,
    lordHouse: lord ? lord.house : null,
    lordSign: lord ? lord.sign : null,
    lordRetro: !!(lord && lord.retro),
    occupants: occupants.map(p => p.key),
    secondOccupants: secondOccupants.map(p => p.key),
    maha,
    antar,
    eraTouches
  };
}

const SIGNS_EN = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"
];

/** One honest sentence about where this domain's energy goes. */
function domainLine(read) {
  if (!read) return "";
  const where = LORD_IN_HOUSE[read.lordHouse];
  const bits = [];
  if (where) bits.push(`Your ${ord(read.house)} — ${read.houseLabel} — is ruled by ${read.lordKey}, sitting in your ${ord(read.lordHouse)}, so ${where}.`);
  if (read.occupants.length) {
    bits.push(`${andList(read.occupants)} ${read.occupants.length > 1 ? "sit" : "sits"} right in it, which makes this area loud for you.`);
  }
  if (read.eraTouches) {
    bits.push(`And your ${read.maha} era ${read.eraTouches} — this is genuinely live for you right now, not background noise.`);
  }
  return bits.join(" ");
}

/**
 * Compact context handed to the model, so its four slots are grounded in the
 * same structure the card already showed rather than invented alongside it.
 */
function domainContext(read) {
  if (!read) return "";
  return [
    `Domain: ${read.kicker}.`,
    `Governing house: ${read.house}th (${read.houseLabel}), sign ${read.sign}, ruled by ${read.lordKey}.`,
    `That ruler sits in the ${ord(read.lordHouse)} house (${HOUSE_MEANING[read.lordHouse] || "?"})${read.lordRetro ? ", retrograde" : ""}.`,
    read.occupants.length ? `Planets in the ${ord(read.house)}: ${read.occupants.join(", ")}.` : `No planets in the ${ord(read.house)}.`,
    read.secondOccupants.length ? `Supporting ${ord(read.second)} house holds: ${read.secondOccupants.join(", ")}.` : "",
    `Running era: ${read.maha} Mahadasha${read.antar ? ` / ${read.antar} Antardasha` : ""}${read.eraTouches ? ` — the era ${read.eraTouches} this house` : ""}.`
  ].filter(Boolean).join(" ");
}

function ord(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Sun, Mercury and Saturn" — not "Sun and Mercury and Saturn". */
function andList(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

// The fixed shape every situation answer takes. Four slots force a decision;
// an open text box invites rumination, which is the thing this is meant to
// replace. Also the line between a wellness product and a therapy one.
const FOUR_SLOTS =
  "Answer in exactly these four short sections, using these headings:\n" +
  "**what this chapter is for** — one or two sentences on what this period of life is actually asking of them here.\n" +
  "**where your energy leaks** — the specific pattern this placement tends to produce, named kindly but plainly.\n" +
  "**one move this week** — a single concrete action, small enough to do in seven days.\n" +
  "**what to stop carrying** — one thing that isn't theirs to hold.\n\n" +
  "Rules: describe conditions and timing, never outcomes — never predict that a relationship will fail, " +
  "that someone will hurt them, or that a period is doomed. Never tell them to cut people off; this is about " +
  "where to spend energy, not who to remove. Keep the whole answer under 200 words. Warm, direct, no jargon, " +
  "no preamble, no disclaimers.";

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DOMAINS, domainRead, domainLine, domainContext, FOUR_SLOTS, SIGN_LORDS, HOUSE_MEANING };
}
