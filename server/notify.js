// What the daily notification says.
//
// This is the product, not the plumbing. A generic "check your horoscope ✨"
// gets muted in a week; the reason to open is that the line is specific, true
// of today, and true of *you*.
//
// Everything here is derived from the transiting Moon against the user's natal
// Moon — classical Chandra Bala, the same measure the constellation uses. The
// Moon changes sign every ~2.25 days, so the line naturally rotates without
// anyone writing a content calendar.

const DAY_MS = 86400000;

// Moon transiting the Nth sign from your natal Moon. 1/3/6/7/10/11 are the
// classically supportive positions, 4/8/12 the difficult ones.
const MOON_FROM_MOON = {
  1: { key: "janma", title: "everything's louder today", body: "the Moon's sat on your Moon — feelings are running at full volume. Don't make anything permanent today." },
  2: { key: "gain", title: "good day for the ask", body: "money, food and words are favoured. If you've been putting off asking for something, ask today." },
  3: { key: "push", title: "today rewards effort", body: "one of the best days in your month for pushing. Nothing's handed over, but what you push moves." },
  4: { key: "rest", title: "go gentle today", body: "the Moon's in an awkward spot from yours. Home stuff feels heavier than it is — this is a rest day, not a decide day." },
  5: { key: "play", title: "your fun day", body: "romance, creativity and showing off are all lit up. Post the thing. Text them back." },
  6: { key: "grind", title: "you win the argument today", body: "conflict is favoured — if something needs confronting, today you have the edge. Health and routines respond too." },
  7: { key: "people", title: "today's about other people", body: "partnerships and conversations flow. Good day to meet, make up, or say the thing you've been drafting." },
  8: { key: "low", title: "low battery day", body: "the Moon's in the hardest spot from yours. Energy dips and small things sting. Protect the day — don't start anything big." },
  9: { key: "luck", title: "the day things go your way", body: "belief, luck and mentors are switched on. Ask the person you've been nervous to ask." },
  10: { key: "work", title: "you're visible today", body: "work and status are favoured — people are watching more than usual. Put the effort where it's seen." },
  11: { key: "wins", title: "your circle comes through", body: "gains and friends are favoured. Today's the day the group chat delivers something." },
  12: { key: "retreat", title: "spend nothing, decide nothing", body: "the Moon's in your 12th — energy leaks quietly today. Cancel what you can, rest without guilt." }
};

/** 1-12, counting from `fromSign` to `toSign` inclusive. */
function houseFrom(fromSign, toSign) {
  return ((((toSign - fromSign) % 12) + 12) % 12) + 1;
}

/**
 * The daily line for one person.
 * @returns {{title, body, kind}|null} null when we can't say anything true.
 */
function dailyMessage({ natalMoonSign, transitMoonSign, name, streak, friend }) {
  if (!Number.isInteger(natalMoonSign) || !Number.isInteger(transitMoonSign)) return null;
  const h = houseFrom(natalMoonSign, transitMoonSign);
  const base = MOON_FROM_MOON[h];
  if (!base) return null;

  const who = firstName(name);
  let title = base.title;
  let body = base.body;

  // A friend having a notably good or bad day with you is more interesting than
  // anything about you alone — it's the thing only this app knows.
  if (friend && friend.name && friend.flow === "flowing") {
    title = `you and ${firstName(friend.name)} are flowing today`;
    body = `${base.body} And the Moon's good to both of you — worth reaching out.`;
  } else if (friend && friend.name && friend.flow === "friction") {
    body = `${base.body} Heads up: it's an awkward day between you and ${firstName(friend.name)}.`;
  }

  // A streak worth protecting is a reason to open; a streak of 1 isn't.
  if (Number.isFinite(streak) && streak >= 3) {
    body += ` (${streak}-day streak — don't break it.)`;
  }

  return { title: who ? `${who}, ${title}` : capitalise(title), body, kind: base.key };
}

const firstName = n => String(n || "").trim().split(/\s+/)[0] || "";
const capitalise = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Is it the right local hour to notify this device?
 *
 * Devices record their own UTC offset at registration, because a birth timezone
 * says nothing about where someone lives now. Anyone without one is skipped
 * rather than woken at 3am.
 */
function isSendHour(device, atMs = Date.now(), hour = 8) {
  if (!device || !Number.isFinite(Number(device.tzOffsetMinutes))) return false;
  const localMs = atMs + Number(device.tzOffsetMinutes) * 60000;
  return new Date(localMs).getUTCHours() === hour;
}

/** Guard against double-sending when the scheduler runs more than once an hour. */
function alreadySentToday(device, atMs = Date.now()) {
  if (!device || !device.lastSentAt) return false;
  const off = Number(device.tzOffsetMinutes) || 0;
  const localDay = ms => new Date(ms + off * 60000).toISOString().slice(0, 10);
  return localDay(Date.parse(device.lastSentAt)) === localDay(atMs);
}

module.exports = { dailyMessage, isSendHour, alreadySentToday, houseFrom, MOON_FROM_MOON, DAY_MS };
