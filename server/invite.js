// Invite links: "cast your chart, we'll compare".
//
// The whole point is that the invitee needs no account — an invite that stops
// at a signup wall doesn't spread — so these endpoints are public. That drives
// every decision here:
//
//   * The inviter's birth details are stored server-side against an opaque
//     token, never encoded in the URL. Birth time and place are precise
//     personal data; a link gets pasted into group chats and screenshotted.
//   * The invitee is shown the inviter's NAME and big three only. Signs are
//     what people already post publicly; the underlying birth data never
//     leaves the server.
//   * Responses are recorded as a summary (name, score, band) — never the
//     responder's birth details, since they never consented to an account.

const crypto = require("crypto");

const TOKEN_BYTES = 9;                       // 72 bits, base64url — 12 chars
const DEFAULT_TTL_DAYS = 30;
const MAX_NAME = 40;

/** URL-safe, unguessable, short enough to paste into a chat. */
function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Tokens we minted are 12 base64url chars; reject anything else without a DB hit. */
function isValidToken(t) {
  return typeof t === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(t);
}

function expiryFrom(nowMs, days = DEFAULT_TTL_DAYS) {
  return new Date(nowMs + days * 86400000).toISOString();
}

function isExpired(invite, nowMs = Date.now()) {
  if (!invite || !invite.expiresAt) return false; // no expiry set → never stale
  const t = Date.parse(invite.expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

/** Trim a display name to something safe to render on a public page. */
function safeName(name, fallback = "Someone") {
  const s = String(name == null ? "" : name).replace(/\s+/g, " ").trim();
  if (!s || s === "Unnamed") return fallback;
  return s.slice(0, MAX_NAME);
}

/**
 * What a stranger holding the link is allowed to see about the inviter.
 * Deliberately derived from the computed chart, never from the birth input —
 * so no date, time or coordinates can leak through this path.
 */
function publicInviter(invite, chart) {
  const moon = ((chart && chart.planets) || []).find(p => p.key === "Moon") || {};
  const asc = (chart && chart.ascendant) || {};
  return {
    name: safeName(invite && invite.name),
    moonSign: moon.sign || null,
    nakshatra: (chart && chart.dasha && chart.dasha.moonNakshatra) || moon.nakshatra || null,
    risingSign: asc.sign || null
  };
}

/**
 * Strip a Guna Milan result down to what's safe to hand a stranger: scores and
 * verdicts, no charts. /api/match returns full charts for both people, which
 * would hand over the inviter's entire nativity — this is why the invite flow
 * doesn't reuse that response.
 */
function publicMatch(result) {
  if (!result) return null;
  const { charts, ...rest } = result;
  return rest;
}

/** The row we keep so the inviter can see who checked — no birth data. */
function responseSummary(name, result) {
  return {
    name: safeName(name, "Someone"),
    total: result && Number.isFinite(result.total) ? result.total : null,
    max: result && Number.isFinite(result.max) ? result.max : null,
    band: (result && result.verdict && result.verdict.band) || null,
    label: (result && result.verdict && result.verdict.label) || null
  };
}

module.exports = {
  newToken, isValidToken, expiryFrom, isExpired,
  safeName, publicInviter, publicMatch, responseSummary,
  DEFAULT_TTL_DAYS
};
