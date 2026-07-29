// One-time passcodes for phone verification.
//
// Rules worth stating, because each one exists to stop a specific attack:
//   * Codes are HMAC-hashed before storage. A database read must not hand
//     someone a working code for every pending signup.
//   * Constant-time comparison, so a timing signal can't leak the code.
//   * Attempts are capped: a 6-digit code is only 1,000,000 wide, and
//     unlimited guesses make that a formality.
//   * Sends are capped per number per day — SMS costs real money, and an
//     uncapped endpoint is someone else's phone being used as a doorbell.
//   * Codes expire, and a consumed code is deleted rather than marked, so a
//     replay has nothing to match against.

const crypto = require("crypto");

const CODE_LENGTH = 6;
const TTL_MS = 10 * 60 * 1000;      // 10 minutes
const MAX_ATTEMPTS = 5;             // per code
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_DAY = 8;        // per phone number

// Codes are hashed with a server secret; falls back to the session secret so a
// deployment that only sets SESSION_SECRET still stores hashes, not plaintext.
// With neither set we generate a random one rather than using a constant: a
// literal baked into the source is public, which would make the stored hash
// plaintext-equivalent (10^6 offline HMACs recovers every pending code) and
// defeat the first rule above. Pending codes then don't survive a restart —
// the same trade-off auth.js makes for sessions, and they only live 10 minutes.
let SECRET = process.env.OTP_SECRET || process.env.SESSION_SECRET || "";
let ephemeralSecret = false;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString("hex");
  ephemeralSecret = true;
}

/** Uniform 6-digit code, zero-padded, from a CSPRNG. */
function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** Hash bound to the phone number, so a code for one number can't verify another. */
function hashCode(code, phone) {
  return crypto.createHmac("sha256", SECRET).update(`${phone}:${code}`).digest("hex");
}

function timingSafeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

const isExpired = (rec, now = Date.now()) => !rec || !rec.expiresAt || Date.parse(rec.expiresAt) <= now;

/** Build the record to persist for a freshly sent code. */
function newRecord(phone, code, now = Date.now()) {
  return {
    phone,
    hash: hashCode(code, phone),
    attempts: 0,
    sends: 1,
    createdAt: new Date(now).toISOString(),
    lastSentAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString()
  };
}

/**
 * May we send (another) code to this number right now?
 * Returns null when allowed, or a reason with retryAfter seconds.
 */
function sendBlockedReason(existing, now = Date.now()) {
  if (!existing) return null;
  const sinceLast = now - Date.parse(existing.lastSentAt || 0);
  if (sinceLast < RESEND_COOLDOWN_MS) {
    return { reason: "cooldown", retryAfter: Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000) };
  }
  // The daily cap only counts sends inside the last 24h window.
  const windowStart = now - 24 * 60 * 60 * 1000;
  const startedAt = Date.parse(existing.createdAt || 0);
  if (startedAt > windowStart && (existing.sends || 0) >= MAX_SENDS_PER_DAY) {
    return { reason: "daily-limit", retryAfter: Math.ceil((startedAt + 24 * 60 * 60 * 1000 - now) / 1000) };
  }
  return null;
}

/** Fold a resend into an existing record (keeps the daily counter running). */
function resendRecord(existing, phone, code, now = Date.now()) {
  const windowStart = now - 24 * 60 * 60 * 1000;
  const withinWindow = existing && Date.parse(existing.createdAt || 0) > windowStart;
  return {
    phone,
    hash: hashCode(code, phone),
    attempts: 0, // a new code gets a fresh budget
    sends: withinWindow ? (existing.sends || 0) + 1 : 1,
    createdAt: withinWindow ? existing.createdAt : new Date(now).toISOString(),
    lastSentAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString()
  };
}

/**
 * Check a submitted code.
 * @returns {{ok:boolean, reason?:string, attemptsLeft?:number, record?:object}}
 *   `record` is the updated row to persist when the attempt failed but the
 *   code is still live; on success the caller should delete the row.
 */
function verify(existing, phone, submitted, now = Date.now()) {
  if (!existing) return { ok: false, reason: "no-code" };
  if (isExpired(existing, now)) return { ok: false, reason: "expired" };
  if ((existing.attempts || 0) >= MAX_ATTEMPTS) return { ok: false, reason: "too-many-attempts" };

  const clean = String(submitted == null ? "" : submitted).replace(/\D/g, "");
  if (clean.length !== CODE_LENGTH) {
    const record = { ...existing, attempts: (existing.attempts || 0) + 1 };
    return { ok: false, reason: "bad-code", attemptsLeft: MAX_ATTEMPTS - record.attempts, record };
  }

  if (timingSafeEqual(hashCode(clean, phone), existing.hash)) return { ok: true };

  const record = { ...existing, attempts: (existing.attempts || 0) + 1 };
  return { ok: false, reason: "bad-code", attemptsLeft: MAX_ATTEMPTS - record.attempts, record };
}

const REASON_MESSAGE = {
  "no-code": "Ask for a code first.",
  expired: "That code expired — send a new one.",
  "too-many-attempts": "Too many wrong tries. Send a fresh code.",
  "bad-code": "That code isn't right.",
  cooldown: "Hang on a moment before asking for another code.",
  "daily-limit": "Too many codes sent to this number today."
};

module.exports = {
  generateCode, hashCode, newRecord, resendRecord, sendBlockedReason, verify,
  isExpired, REASON_MESSAGE, ephemeralSecret,
  CODE_LENGTH, TTL_MS, MAX_ATTEMPTS, RESEND_COOLDOWN_MS, MAX_SENDS_PER_DAY
};
