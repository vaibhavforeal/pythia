// The local copy of your birth details, scoped to the account that owns them.
//
// localStorage is scoped to the device, not the account, and this app supports
// signing out and signing in as someone else on the same phone. The cache used
// to be a bare input object under a fixed key, so after a logout the next
// account to sign in inherited it: restoreMyChart() falls back to this whenever
// the server has no birth on file, which is precisely the case for a brand-new
// account. The new account was then shown the previous one's chart — their
// name, date, time and place — labelled "your chart".
//
// The fix is ownership, not cleanup. Every record carries the account id it
// belongs to and is invisible to any other reader, including a signed-out one.
// Clearing on logout is worth doing as well, and app.js does, but it cannot be
// the fix on its own: a session can end without logout ever running — expiry, a
// cleared cookie, an app killed mid-flow, a revoked native token.
//
// Records written before this existed have no owner. They are treated as
// belonging to nobody rather than guessed at; the server copy restores the
// rightful owner on their next load, so the only cost is one extra fetch.

const BIRTH_KEY = "myBirth";

// The cached input still has to be castable — the same guard the old
// loadMyBirth() applied, kept so a half-written record can't reach the chart.
function usableBirth(input) {
  return input && Number.isFinite(Number(input.year)) ? input : null;
}

/** The birth details belonging to `uid`, or null. Never another account's. */
function readBirthCache(store, uid) {
  if (!uid) return null;
  try {
    const raw = store.getItem(BIRTH_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || rec.uid !== uid) return null;
    return usableBirth(rec.input);
  } catch (_) {
    return null; // malformed, or storage denied us — treat as absent
  }
}

/** Cache `input` against `uid`. Without a uid we cache nothing at all. */
function writeBirthCache(store, uid, input) {
  if (!uid) return;
  try {
    store.setItem(BIRTH_KEY, JSON.stringify({ uid, input }));
  } catch (_) {
    /* private mode — the server copy is the durable one anyway */
  }
}

function clearBirthCache(store) {
  try {
    store.removeItem(BIRTH_KEY);
  } catch (_) {
    /* nothing to do if storage is denied */
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { readBirthCache, writeBirthCache, clearBirthCache, BIRTH_KEY };
}
