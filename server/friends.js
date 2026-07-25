// Friendships: requests, acceptance, blocking, and the daily flow reading.
//
// Privacy model, which drives the shapes here: a friend sees your name, your
// Soul ID, your signs (Moon / nakshatra / rising) and your compatibility with
// them. A friend never sees your birth date, time or place — the same boundary
// the public invite page uses (server/invite.js).

const DAY_MS = 86400000;

// A friendship is stored once, with the pair ordered, so "a befriends b" and
// "b befriends a" can't create two rows that disagree.
const pairKey = (a, b) => (String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`);
const otherId = (row, me) => (row.userA === me ? row.userB : row.userA);

/**
 * Classical Chandra Bala: counted from a natal Moon sign, the transiting Moon
 * is supportive in the 1st, 3rd, 6th, 7th, 10th and 11th, and difficult in the
 * 4th, 8th and 12th. Everything else is neutral.
 */
const GOOD_FROM_MOON = [1, 3, 6, 7, 10, 11];
const HARD_FROM_MOON = [4, 8, 12];

/** 1-12, counting from `fromSign` to `toSign` inclusive. */
function houseFrom(fromSign, toSign) {
  return (((toSign - fromSign) % 12) + 12) % 12 + 1;
}

function chandraBala(natalMoonSign, transitMoonSign) {
  const h = houseFrom(natalMoonSign, transitMoonSign);
  if (GOOD_FROM_MOON.includes(h)) return 1;
  if (HARD_FROM_MOON.includes(h)) return -1;
  return 0;
}

/**
 * Today between two people: combine each side's Chandra Bala. Both supported
 * reads as flowing, both strained as friction, anything mixed as steady.
 *
 * This is a real transit measure per person; combining the two into a "you and
 * them today" verdict is our framing, not a classical technique.
 */
function dailyFlow(myMoonSign, theirMoonSign, transitMoonSign) {
  if (![myMoonSign, theirMoonSign, transitMoonSign].every(Number.isInteger)) {
    return { key: "steady", label: "steady", score: 0 };
  }
  const score = chandraBala(myMoonSign, transitMoonSign) + chandraBala(theirMoonSign, transitMoonSign);
  if (score >= 2) return { key: "flowing", label: "flowing", score };
  if (score <= -1) return { key: "friction", label: "friction", score };
  return { key: "steady", label: "steady", score };
}

/**
 * What one friend may see about another. Built from the computed chart, never
 * from the birth input, so no date/time/place can leak through this path.
 */
function publicFriend(user, chart) {
  const moon = ((chart && chart.planets) || []).find(p => p.key === "Moon") || {};
  const asc = (chart && chart.ascendant) || {};
  return {
    id: user.id,
    soulId: user.soulId || null,
    name: user.name || "Someone",
    moonSign: moon.sign || null,
    moonSignIndex: Number.isInteger(moon.signIndex) ? moon.signIndex : null,
    nakshatra: (chart && chart.dasha && chart.dasha.moonNakshatra) || moon.nakshatra || null,
    risingSign: asc.sign || null
  };
}

/**
 * Can `me` send `them` a request right now? Returns a reason rather than a
 * bare boolean so the API can say something useful.
 */
function requestBlockedReason({ me, them, existingFriendship, existingRequest, blocks }) {
  if (!them) return "no-such-user";
  if (me === them) return "self";
  if (existingFriendship) return "already-friends";
  if (blocks && blocks.some(b => b.blocker === them && b.blocked === me)) return "blocked";
  if (blocks && blocks.some(b => b.blocker === me && b.blocked === them)) return "you-blocked";
  if (existingRequest) {
    return existingRequest.from === me ? "already-requested" : "they-requested-you";
  }
  return null;
}

const REASON_MESSAGE = {
  "no-such-user": "No one with that Soul ID.",
  self: "That's your own Soul ID.",
  "already-friends": "You're already connected.",
  blocked: "No one with that Soul ID.", // never confirm a block exists
  "you-blocked": "You've blocked them — unblock to send a request.",
  "already-requested": "Request already sent.",
  "they-requested-you": "They've already asked you — accept it instead."
};

module.exports = {
  pairKey, otherId, dailyFlow, chandraBala, houseFrom,
  publicFriend, requestBlockedReason, REASON_MESSAGE,
  GOOD_FROM_MOON, HARD_FROM_MOON, DAY_MS
};
