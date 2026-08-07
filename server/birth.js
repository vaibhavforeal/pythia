// Validating a birth record, and turning a stored one into a chart.
//
// Extracted from server/index.js so the voice agent can reach it. index.js
// requires voice.js, so voice.js can never require index.js back — anything
// both need has to live somewhere neither owns.
//
// Nothing here touches Express or the store. It takes a plain object and either
// returns the input computeChart expects or throws an HttpError(400) naming the
// field that's wrong.

const { computeChart } = require("./astro");
const { HttpError } = require("./http-error");
const genderLib = require("./gender");

// parseInt/parseFloat stop at the first bad character, so "31st" became 31 and
// "1990-01-01" became 1990 — garbage silently accepted as a confident chart.
// Number() rejects the whole string instead. (parseBirth is the only caller.)
const strictNum = v => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v !== "string") return NaN;
  const s = v.trim();
  if (!s) return NaN; // Number(" ") is 0, which would pass as a real value
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

const int = v => {
  const n = strictNum(v);
  if (n === null || Number.isNaN(n)) return n;
  return Number.isInteger(n) ? n : NaN;
};

const num = strictNum;

// Validate one person's birth details and return the input computeChart expects.
function parseBirth(b) {
  const nums = {
    year: int(b.year),
    month: int(b.month),
    day: int(b.day),
    hour: int(b.hour),
    minute: int(b.minute),
    lat: num(b.lat),
    lon: num(b.lon),
    tz: num(b.tz)
  };
  for (const [k, v] of Object.entries(nums)) {
    if (v === null || Number.isNaN(v)) throw new HttpError(400, `Missing or invalid field: ${k}`);
  }
  // Every one of these was previously unchecked, so the ephemeris happily
  // returned a confident chart for lat 1000 or Feb 31 (silently computed as
  // Mar 3). Wrong answers are worse than refusals here.
  if (nums.year < -4000 || nums.year > 4000) throw new HttpError(400, "Year is out of range.");
  if (nums.month < 1 || nums.month > 12) throw new HttpError(400, "Invalid date.");
  // Day must exist in that month — Date.UTC rolls Feb 31 forward to Mar 3.
  // Computed arithmetically rather than via Date.UTC, which maps years 0-99
  // to 1900-1999 and would get the leap year wrong for ancient dates.
  const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, leap(nums.year) ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31][nums.month - 1];
  if (nums.day < 1 || nums.day > daysInMonth) throw new HttpError(400, "Invalid date.");
  if (nums.hour < 0 || nums.hour > 23) throw new HttpError(400, "Hour must be between 0 and 23.");
  if (nums.minute < 0 || nums.minute > 59) throw new HttpError(400, "Minute must be between 0 and 59.");
  if (nums.lat < -90 || nums.lat > 90) throw new HttpError(400, "Latitude must be between -90 and 90.");
  if (nums.lon < -180 || nums.lon > 180) throw new HttpError(400, "Longitude must be between -180 and 180.");
  // Real UTC offsets span -12..+14; allow a little slack for historical zones.
  if (nums.tz < -12 || nums.tz > 14) throw new HttpError(400, "UTC offset must be between -12 and +14.");
  // Rahu/Ketu aspect convention: "seventh" (7th only) or Jupiter-like (5/7/9).
  const nodeMode = b.nodeMode === "seventh" ? "seventh" : "jupiter";
  const nodeAspects = nodeMode === "seventh" ? [7] : [5, 7, 9];
  const name = b.name ? String(b.name).trim().slice(0, 80) : undefined;
  // Gender rides along with the birth input because the chart needs it: the
  // kalatra-karaka is Venus for a man and Jupiter for a woman. Normalised here
  // so an unrecognised value becomes null rather than reaching the synthesis.
  const gender = genderLib.normalizeGender(b.gender);
  return { ...nums, nodeAspects, nodeMode, name, gender };
}

/**
 * Chart from a stored birth record, or null if it can't be read.
 *
 * Two shapes reach this, because the two tables store birth differently:
 * `users.birth` is a nested jsonb object, while a `people` row carries the
 * fields at the top level. Both are already-validated records that this app
 * wrote, so a failure here means corruption rather than bad user input — hence
 * null rather than a throw. One person's broken row must not break a list.
 */
function chartFromBirth(birth) {
  if (!birth) return null;
  try {
    return computeChart(parseBirth(birth));
  } catch (_) {
    return null;
  }
}

/** Chart for a user, or null when they haven't saved birth details yet. */
async function chartForUser(user) {
  return user ? chartFromBirth(user.birth) : null;
}

module.exports = { strictNum, int, parseBirth, chartFromBirth, chartForUser, HttpError };
