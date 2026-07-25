// Daily check-in streaks.
//
// "Today" is the user's LOCAL date, not the server's — a streak that breaks at
// 5:30am because the server is on UTC would be a bug the user can feel. So the
// client sends its own YYYY-MM-DD and we sanity-check it rather than trust it
// blindly: any real timezone (UTC-12..UTC+14) puts the local date within one
// day of the UTC date, so anything further out is a wrong clock or a spoof.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

/** YYYY-MM-DD -> epoch ms at UTC midnight, or NaN if malformed/not a real date. */
function parseDay(s) {
  if (!DATE_RE.test(String(s || ""))) return NaN;
  const [y, m, d] = s.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // Rejects 2026-02-31 and friends, which Date.UTC would silently roll over.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return NaN;
  return ms;
}

const toDay = ms => new Date(ms).toISOString().slice(0, 10);

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / DAY_MS);
}

/**
 * Is `claimed` a plausible local date given the server's UTC now?
 * Allows exactly ±1 day, which covers every real UTC offset.
 */
function plausibleToday(claimed, nowMs = Date.now()) {
  if (Number.isNaN(parseDay(claimed))) return false;
  return Math.abs(daysBetween(toDay(nowMs), claimed)) <= 1;
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

  // Already counted today.
  if (cur.last === today) return unchanged;

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

module.exports = { advance, plausibleToday, parseDay, daysBetween, nextMilestone, MILESTONES };
