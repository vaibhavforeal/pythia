// Date-only formatting, in one place so the producers can't drift apart.
//
// The user-facing format is DD-MM-YYYY.
//
// Two consequences worth knowing before you touch a date anywhere else:
//
//   * These strings are NOT lexicographically sortable — "01-12-2025" sorts
//     before "02-01-2025". Never sort or range-compare them as strings; parse
//     to epoch ms with parseDay() first. (daysBetween below does this.)
//   * This applies to date-only values only. Full timestamps — created_at,
//     updated_at, expires_at, last_sent_at — stay ISO 8601, because they are
//     Postgres `timestamptz` columns and cannot physically hold this format.
//     streak_last is deliberately a `text` column, so it can.

const DAY_MS = 86400000;
const DMY_RE = /^(\d{2})-(\d{2})-(\d{4})$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = n => String(n).padStart(2, "0");

/** epoch ms -> DD-MM-YYYY, in UTC. */
function formatDay(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/**
 * DD-MM-YYYY -> epoch ms at UTC midnight, or NaN if malformed / not a real date.
 *
 * Legacy YYYY-MM-DD is still accepted on read: streak_last holds real user data
 * written before this change, and rejecting it would reset everyone's streak.
 */
function parseDay(s) {
  const str = String(s || "");
  let y, m, d;
  const dmy = DMY_RE.exec(str);
  if (dmy) {
    d = +dmy[1]; m = +dmy[2]; y = +dmy[3];
  } else {
    const iso = ISO_RE.exec(str);
    if (!iso) return NaN;
    y = +iso[1]; m = +iso[2]; d = +iso[3];
  }
  let ms = Date.UTC(y, m - 1, d);
  // Date.UTC maps years 0-99 to 1900-1999; put them back where they belong.
  if (y >= 0 && y < 100) {
    const t = new Date(ms);
    t.setUTCFullYear(y);
    ms = t.getTime();
  }
  const back = new Date(ms);
  // Rejects 31-02-2026 and friends, which Date.UTC would silently roll over.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return NaN;
  return ms;
}

/** Whole days from `a` to `b`. Either may be in either format. */
function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / DAY_MS);
}

module.exports = { formatDay, parseDay, daysBetween, DAY_MS };
