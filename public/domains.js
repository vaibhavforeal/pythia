// Situation cards: the structural spine behind "where should my energy go".
//
// The point of this file is that the frame arrives BEFORE the user speaks. Ask
// a general-purpose chatbot "am I overreacting about my friend?" and it mirrors
// your framing back, which is why those conversations loop. Here the chart
// supplies a fixed frame the answer has to fit.
//
// The reasoning itself lives server-side in synthesis.js and arrives on the
// chart as `c.synthesis`. This file is the renderer: it owns the copy, and it
// owns the rule about how much of the reasoning is allowed onto a card.
//
// That rule is the important part. A card prints the promise, then AT MOST ONE
// more thing. Everything else is still computed and still goes to the model —
// it is simply not shown. Stacking every factor into one line is what made
// these cards read as noise.

// Copy only. The structural half — house, supporting house, which varga
// governs the area — lives in server/synthesis.js as DOMAIN_SPEC, and the two
// key sets are asserted equal in the tests.
const DOMAINS = {
  friendships: {
    emoji: "☍", kicker: "friendships", head: "your circle",
    houseLabel: "friend circles and what you gain from them",
    ask: "Who deserves my energy in my friendships right now, and what am I over-giving to?"
  },
  situationships: {
    emoji: "♡", kicker: "situationships", head: "the one you're unsure about",
    houseLabel: "partnership, and how you meet people one to one",
    ask: "Where do I actually stand in this situationship, and what am I holding onto that isn't mine to carry?"
  },
  home: {
    emoji: "⌂", kicker: "parents & home", head: "the house you grew up in",
    houseLabel: "home, mother, and what safety feels like to you",
    ask: "How do I deal with the pressure at home without carrying all of it, and what's actually mine to hold?"
  },
  focus: {
    emoji: "✎", kicker: "studies & focus", head: "your attention",
    houseLabel: "intellect, study and what you can actually concentrate on",
    ask: "Where should my focus go this term, and what am I burning attention on that isn't paying me back?"
  },
  career: {
    emoji: "◈", kicker: "work & direction", head: "what you're building",
    houseLabel: "work, status, and what you get known for",
    ask: "What should I actually be building right now, and what am I doing because it looks right?"
  }
};

// What it means for a ruler to land in each house — written as "where the
// energy actually goes", since that is the question being asked.
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

const HOUSE_MEANING = {
  1: "yourself", 2: "what you hold onto", 3: "your own effort", 4: "home and comfort",
  5: "play and creativity", 6: "conflict and grind", 7: "other people", 8: "upheaval and depth",
  9: "belief and mentors", 10: "work and status", 11: "your circle and gains", 12: "retreat and letting go"
};

// What each varga is FOR, in the card's own voice — when it actually governs
// the topic. The navamsa IS the partnership chart, so situationships must not
// hear it described as a generic strength grade.
const VARGA_VOICE = {
  D9: "the partnership chart", D4: "the home chart",
  D10: "the career chart", D24: "the learning chart"
};

/**
 * The other reading of a varga: role "strength" means it is only borrowed as a
 * general strength grade, not as the chart that owns the topic. Only
 * friendships does this — see vargaRole in server/synthesis.js — and calling D9
 * "the partnership chart" on a card about your circle would be wrong.
 */
function vargaVoice(sustain) {
  if (!sustain) return "the divisional chart";
  if (sustain.role === "strength") return "the strength chart";
  return VARGA_VOICE[sustain.varga] || "the divisional chart";
}

const VERDICT_PHRASE = {
  "looks-better-than-it-holds": "this looks better than it holds",
  "grows-into-it": "this one you grow into",
  "holds": "this holds",
  "needs-building": "this one needs building"
};

/**
 * Merge the precomputed synthesis with the copy. Falls back to a copy-only
 * object when the chart predates the synthesis field — old saved chats are
 * backfilled server-side, but a stale payload must not break the profile.
 */
function domainRead(chart, key) {
  const d = DOMAINS[key];
  if (!d) return null;
  const syn = chart && chart.synthesis && chart.synthesis.domains && chart.synthesis.domains[key];
  const lagnaLord = (chart && chart.synthesis && chart.synthesis.lagnaLord) || null;
  if (!syn) return { key, ...d, stale: true };
  return { key, ...d, ...syn, lagnaLord };
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

/** Slot 1: the promise, in one sentence, carrying the lord's dignity. */
function promiseSentence(read) {
  const gloss = LORD_IN_HOUSE[read.promise.house] || "";
  const dig = read.promise.dignity;
  const flavour =
    dig === "own" ? ", in its own sign" :
    dig === "exalted" ? ", exalted" :
    dig === "debilitated" ? ", and struggling there" : "";
  return `Your ${ord(read.house)} — ${read.houseLabel} — is ruled by ${read.lordKey}, ` +
    `sitting in your ${ord(read.promise.house)}${flavour}, so ${gloss}.`;
}

/** Slot 2: at most one more thing, chosen server-side. */
function secondSentence(read) {
  const su = read.sustain;
  switch (read.slot2) {
    case "divergence": {
      const dir = read.verdict === "looks-better-than-it-holds" ? "falls" : "picks up";
      return `In the ${su.varga}, ${vargaVoice(su)}, ` +
        `that same ${read.lordKey} ${dir} — ${VERDICT_PHRASE[read.verdict]}.`;
    }
    case "loud": {
      if (read.loudWhere === "house") {
        // A lord sitting in the house it rules is itself an occupant, and slot 1
        // has already named it. Printing it again spends the whole second slot
        // restating the first. Safe by construction: this arm only fires on 2+
        // occupants, so dropping one always leaves at least one name.
        const others = read.loudSet.filter(k => k !== read.lordKey);
        return `${andList(others)} ${others.length > 1 ? "sit" : "sits"} right in the ${ord(read.house)}, ` +
          `which makes this area loud for you.`;
      } else {
        return `${andList(read.loudSet)} ${read.loudSet.length > 1 ? "sit" : "sits"} alongside ${read.lordKey}, ` +
          `which makes this area loud for you.`;
      }
    }
    case "agreement":
      return `The ${su.varga} says the same thing — ${VERDICT_PHRASE[read.verdict]}.`;
    case "shade":
      return `Your ${read.maha} era ${read.eraTouches}, so it's live right now.`;
    default:
      return "";
  }
}

/** One or two sentences. Never three. Plain text. */
function domainLine(read) {
  if (!read) return "";
  if (read.stale) return `Your ${read.houseLabel} — open this one up to see where the energy goes.`;
  return [promiseSentence(read), secondSentence(read)].filter(Boolean).join(" ");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * The same line, escaped, with the verdict phrase emphasised.
 *
 * Everything here is server-computed from a fixed vocabulary, so there is no
 * live injection vector — but the card is rendered with innerHTML, and an
 * unescaped path through it is the kind of thing that stops being safe the
 * first time someone puts a person's name into a domain line. Escape the
 * fragments, then add the one tag we actually want.
 */
function domainLineHtml(read) {
  if (!read) return "";
  if (read.stale) return esc(domainLine(read));
  const parts = [esc(promiseSentence(read))];
  const second = secondSentence(read);
  if (read.slot2 === "divergence" && second) {
    const phrase = VERDICT_PHRASE[read.verdict];
    const [before] = second.split(phrase);
    parts.push(`${esc(before)}<b>${esc(phrase)}</b>.`);
  } else if (second) {
    parts.push(esc(second));
  }
  return parts.join(" ");
}

/**
 * The tiered block handed to the model. The labels and the closing RULE line
 * are the whole point: a flat list of facts gives the model no way to know
 * that the house lord's condition outranks the running dasha.
 */
function domainContext(read) {
  if (!read) return "";
  if (read.stale) {
    return `STALE — Domain: ${read.kicker}. The birth chart data is missing or predates this analysis. ` +
      `No structural read is available. Ground the answer in what the person tells you, ` +
      `not in chart placements, houses, or timing. Ask clarifying questions rather than ` +
      `inventing a chart structure from their description.`;
  }
  const L = [];
  const l = read.lagnaLord;
  if (l) {
    L.push(
      `BASELINE — Lagna lord ${l.key} in the ${ord(l.house)}, ${l.dignity}` +
        `${l.combust ? ", combust" : ""}: ${l.band}. ` +
        `This is how much they can act on what follows.`
    );
  }
  L.push(
    `PROMISE (D1) — ${ord(read.house)} house (${read.houseLabel}), sign ${read.sign}, ` +
      `ruled by ${read.lordKey}, in the ${ord(read.promise.house)} house ` +
      `(${HOUSE_MEANING[read.promise.house]}), ${read.promise.dignity}` +
      `${read.promise.retro ? ", retrograde" : ""}: ${read.promise.band}. ` +
      (read.occupants.length ? `In the house: ${read.occupants.join(", ")}. ` : "No planets in the house. ") +
      (read.secondOccupants.length ? `Supporting ${ord(read.second)} holds: ${read.secondOccupants.join(", ")}.` : "")
  );
  if (read.sustain) {
    const role = read.sustain.role === "strength"
      ? " — used here as a general strength grade, not as a chart that governs this topic"
      : "";
    L.push(
      `SUSTAIN (${read.sustain.varga} ${read.sustain.vargaName}${role}) — that same ` +
        `${read.lordKey} is ${read.sustain.dignity} in the ${ord(read.sustain.house)} house ` +
        `of that chart${read.sustain.vargottama ? ", vargottama" : ""}: ${read.sustain.band}.`
    );
    L.push(`VERDICT — ${VERDICT_PHRASE[read.verdict]}.`);
  }
  L.push(
    `SHADE — ${read.maha} Mahadasha${read.antar ? ` / ${read.antar} Antardasha` : ""}. ` +
      (read.eraTouches
        ? `The era lord ${read.eraTouches}, so this area is live.`
        : `The era lord neither rules nor occupies this house, so this period is not primarily about this area.`)
  );
  L.push(
    "RULE — PROMISE outranks SUSTAIN outranks SHADE. Never let the running dasha " +
      "override the structural read. The dasha says when, never whether."
  );
  return L.join("\n");
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
  module.exports = {
    DOMAINS, domainRead, domainLine, domainLineHtml, domainContext, FOUR_SLOTS, HOUSE_MEANING
  };
}
