// Which account does a Google identity map to?
//
// This is small but security-critical, so it lives apart from the route: the
// callback is all redirects and cookies, and the decision underneath it should
// be testable without standing up Google or a server. `users` is passed in for
// the same reason.
//
// The rule it enforces: an account is only reachable by a Google identity when
// someone has PROVEN they hold it — either by already being signed in to it, or
// because the account was created by this Google identity in the first place.
// A matching email address is not proof of anything while registration doesn't
// verify addresses.

const crypto = require("crypto");

/**
 * @param users  the store's users API
 * @param gid    Google's stable subject id ("sub")
 * @param email  the address Google reports, already normalised AND already
 *               checked for email_verified by the caller
 * @param sessionUserId  set only when the user explicitly asked to link Google
 *               to the account they are currently signed in to
 * @returns {Promise<{user: object} | {error: string}>} error is an auth_error code
 */
async function resolveGoogleAccount(users, { gid, email, sessionUserId }) {
  const byGoogle = await users.findByGoogleId(gid);

  if (sessionUserId) {
    // Authenticated link. Safe precisely because it proves BOTH things at once:
    // control of the account (the session, which required the password) and
    // control of the Google identity (the OAuth round trip).
    if (byGoogle && byGoogle.id !== sessionUserId) return { error: "google_taken" };
    await users.update(sessionUserId, { googleId: gid });
    return { user: await users.findById(sessionUserId) };
  }

  if (byGoogle) return { user: byGoogle };

  // The account takeover this exists to stop:
  //
  // This branch used to link Google to any account sharing the email address.
  // Registration never verified addresses, so anyone could sign up as
  // you@example.com and wait. When you later signed in with Google you were
  // dropped into THEIR account — and their password still opened it.
  //
  // Refusing is the only airtight answer. The tempting alternative, letting
  // Google claim the address and wiping the unproven password, does not hold:
  // sessions are stateless signed tokens (see auth.js) with no revocation, so
  // the squatter keeps access until their cookie expires.
  //
  // The cost is real but small: someone whose address was squatted before they
  // ever signed up cannot use Google with it, and needs support. The honest fix
  // for that case is verifying email at registration — not weakening this.
  const existing = await users.findByEmail(email);
  if (existing) return { error: "email_taken" };

  return {
    user: await users.add({
      id: crypto.randomUUID(), email, googleId: gid, createdAt: new Date().toISOString()
    })
  };
}

module.exports = { resolveGoogleAccount };
