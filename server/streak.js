// Daily check-in streaks.
//
// "Today" is the user's LOCAL date, not the server's — a streak that breaks at
// 5:30am because the server is on UTC would be a bug the user can feel. So the
// client sends its own YYYY-MM-DD and we sanity-check it rather than trust it
// blindly: any real timezone (UTC-12..UTC+14) puts the local date within one
// day of the UTC date, so anything further out is a wrong clock or a spoof.

const { formatDay, parseDay, daysBetween, DAY_MS } = require("./dates");

const toDay = formatDay;

/**
 * Is `claimed` a plausible local date given the server's UTC now?
 * Allows exactly ±1 day, which covers every real UTC offset.
 *
 * NOTE this check alone cannot stop a client walking its streak forward: the
 * window admits D-1, D and D+1, and `advance` counts each step as consecutive,
 * so three posts in one real day yield a streak of 3. It is not fixable from
 * the claimed date plus the server clock, because the cheat is observationally
 * IDENTICAL to a legitimate user at, say, UTC-11 — whose two consecutive local
 * days genuinely fall inside one UTC day, hours apart, claiming D then D+1.
 * Distinguishing them needs the client's actual offset, so prefer localDay()
 * below whenever the client supplies one; this stays as the fallback for
 * clients that don't.
 */
function plausibleToday(claimed, nowMs = Date.now()) {
  if (Number.isNaN(parseDay(claimed))) return false;
  return Math.abs(daysBetween(toDay(nowMs), claimed)) <= 1;
}

// Minutes to ADD to UTC to reach local time — same convention and range as
// devices.tzOffsetMinutes (see notify.js), so the two can't drift apart.
const MIN_OFFSET_MIN = -12 * 60;
const MAX_OFFSET_MIN = 14 * 60;

function isValidOffset(v) {
  // typeof, not Number(): Number(null), Number("") and Number([]) are all 0,
  // which is a perfectly valid offset (UTC) — so coercing would treat a missing
  // or junk value as "this user is on UTC" instead of falling back to `date`.
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  return v >= MIN_OFFSET_MIN && v <= MAX_OFFSET_MIN;
}

/**
 * The user's local YYYY-MM-DD, derived from their UTC offset and the server's
 * clock. There is exactly one answer at any instant, so there is nothing to
 * walk forward — the date stops being a client claim at all.
 */
function localDay(offsetMinutes, nowMs = Date.now()) {
  return toDay(nowMs + Number(offsetMinutes) * 60000);
}

/**
 * Fold a check-in into the stored streak. Pure — no clock, no I/O.
 *
 * @param {{current:number,longest:number,last:string|null,days:number}} prev
 * @param {string} today  the user's local YYYY-MM-DD (already validated)
 * @returns {{current,longest,last,days,changed:boolean,milestone:boolean}}
 *   `changed` is false when today was already counted, so the caller can skip
 *   the write. `milestone` marks a streak worth celebrating in the UI.
 */
function advance(prev, today) {
  const cur = {
    current: Number(prev && prev.current) || 0,
    longest: Number(prev && prev.longest) || 0,
    last: (prev && prev.last) || null,
    days: Number(prev && prev.days) || 0
  };
  const unchanged = { ...cur, changed: false, milestone: false };

  // Already counted today. Compared by parsed value, not string equality: a
  // stored date may still be in the legacy YYYY-MM-DD format, and comparing
  // "2026-07-27" === "27-07-2026" as strings would count the same day twice.
  if (cur.last && daysBetween(cur.last, today) === 0) return unchanged;

  // A stored date in the future means a bad clock or a tampered payload; don't
  // let it advance the streak, and don't destroy what's already there.
  if (cur.last && daysBetween(cur.last, today) < 0) return unchanged;

  // Consecutive only if the last check-in was literally yesterday.
  const current = cur.last && daysBetween(cur.last, today) === 1 ? cur.current + 1 : 1;
  const next = {
    current,
    longest: Math.max(cur.longest, current),
    last: today,
    days: cur.days + 1,
    changed: true
  };
  next.milestone = MILESTONES.includes(current);
  return next;
}

// Streak lengths the UI makes a fuss about.
const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

/** Days until the next milestone, or null once they're all passed. */
function nextMilestone(current) {
  return MILESTONES.find(m => m > current) ?? null;
}

module.exports = {
  advance, plausibleToday, parseDay, daysBetween, nextMilestone, MILESTONES,
  isValidOffset, localDay
};
