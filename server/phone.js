// Phone numbers as the identity anchor.
//
// Stored in E.164 ("+919876543210") so a number has exactly one representation
// — otherwise "9876543210", "+91 98765 43210" and "098765-43210" become three
// different accounts for one human, and uniqueness stops meaning anything.
//
// India-first: a bare 10-digit number is assumed to be +91, since that's the
// audience. Anything with an explicit + is taken at its word.

const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || "91";

// Digit counts for a national subscriber number, before the country code.
const MIN_NSN = 6;
const MAX_NSN = 14;

/**
 * Normalise user input to E.164, or null if it can't be one.
 * Accepts: "+91 98765 43210", "09876543210", "9876543210", "(+91)98765-43210".
 */
function normalize(input, defaultCc = DEFAULT_CC) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  // Some keyboards produce a unicode plus or full-width digits.
  s = s.replace(/[＋﹢]/g, "+").replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

  // Strip formatting first, so a wrapped country code like "(+91) 98765 43210"
  // is still recognised as international rather than having +91 prepended again.
  const cleaned = s.replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (!digits) return null;

  let e164;
  if (cleaned.startsWith("+")) {
    e164 = digits;
  } else if (digits.startsWith("00")) {
    e164 = digits.slice(2);                     // 00 is the international prefix
  } else {
    // National format: drop a single trunk "0", then prepend the country code.
    const national = digits.replace(/^0+/, "");
    if (!national) return null;
    e164 = defaultCc + national;
  }

  if (e164.length < MIN_NSN + 1 || e164.length > 15) return null; // E.164 caps at 15
  if (e164.startsWith("0")) return null;                          // no country code starts with 0
  return "+" + e164;
}

/** Shape check on an already-normalised value. */
function isValid(e164) {
  return typeof e164 === "string" && /^\+[1-9]\d{6,14}$/.test(e164);
}

/**
 * Indian mobile numbers are 10 digits starting 6-9. Worth checking, because
 * a typo'd landline silently costs an SMS and a confused user.
 */
function isPlausibleIndianMobile(e164) {
  if (!isValid(e164) || !e164.startsWith("+91")) return true; // not ours to judge
  const nsn = e164.slice(3);
  return /^[6-9]\d{9}$/.test(nsn);
}

/** For UI and logs: never print a full number. "+9198765•••10" */
function mask(e164) {
  if (!isValid(e164)) return "";
  return e164.slice(0, Math.max(3, e164.length - 5)) + "•••" + e164.slice(-2);
}

module.exports = { normalize, isValid, isPlausibleIndianMobile, mask, DEFAULT_CC };
