// The birth-details cache is the one piece of per-user data this app keeps in
// localStorage, and localStorage is scoped to the device, not the account.
//
// The bug these tests exist for: log out, sign in as someone else, and the new
// account was shown the previous one's chart, labelled "your chart". Logout
// cleared the push token and the auth token but not this, and restoreMyChart
// falls back to it whenever the server has no birth on file — which is exactly
// the case for a brand-new account.
//
// So the rule under test is: a cached record belongs to one account id and is
// invisible to every other, including to nobody-signed-in. Clearing on logout
// is a second line of defence, not the fix — logout does not always run.
const test = require("node:test");
const assert = require("node:assert");
const { readBirthCache, writeBirthCache, clearBirthCache, BIRTH_KEY } = require("../public/birth-cache.js");

// Minimal stand-in for localStorage. Deliberately not a mock of behaviour we
// then assert against — it just stores strings, like the real thing.
function fakeStore(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    _dump: () => Object.fromEntries(map)
  };
}

const ALICE = { name: "Alice Aardvark", year: 1990, month: 1, day: 2, hour: 3, minute: 4, lat: 51.5074, lon: -0.1278, tz: 0 };

test("a record written by one account is invisible to another", () => {
  const store = fakeStore();
  writeBirthCache(store, "user-alice", ALICE);
  assert.deepStrictEqual(readBirthCache(store, "user-alice"), ALICE, "the owner still reads it");
  assert.equal(readBirthCache(store, "user-bob"), null, "a different account must not see it");
});

test("a signed-out reader gets nothing", () => {
  const store = fakeStore();
  writeBirthCache(store, "user-alice", ALICE);
  assert.equal(readBirthCache(store, null), null);
  assert.equal(readBirthCache(store, undefined), null);
  assert.equal(readBirthCache(store, ""), null);
});

test("a legacy record with no owner belongs to nobody", () => {
  // Records written before this fix are the bare input object. We cannot know
  // whose they are, so they must not be handed to whoever signs in next. The
  // server copy restores the rightful owner on their next load.
  const store = fakeStore({ [BIRTH_KEY]: JSON.stringify(ALICE) });
  assert.equal(readBirthCache(store, "user-alice"), null);
  assert.equal(readBirthCache(store, "user-bob"), null);
});

test("writing without an account id caches nothing", () => {
  const store = fakeStore();
  writeBirthCache(store, null, ALICE);
  assert.equal(store.getItem(BIRTH_KEY), null, "an unattributable record is worse than no record");
});

test("clearing removes the record", () => {
  const store = fakeStore();
  writeBirthCache(store, "user-alice", ALICE);
  clearBirthCache(store);
  assert.equal(store.getItem(BIRTH_KEY), null);
  assert.equal(readBirthCache(store, "user-alice"), null);
});

test("a malformed record reads as absent rather than throwing", () => {
  const store = fakeStore({ [BIRTH_KEY]: "{not json" });
  assert.equal(readBirthCache(store, "user-alice"), null);
});

test("a record without a usable year is rejected", () => {
  // Preserves the existing guard: the cached input must be castable.
  const store = fakeStore();
  writeBirthCache(store, "user-alice", { name: "No Year" });
  assert.equal(readBirthCache(store, "user-alice"), null);
});

test("storage that throws does not take the app down", () => {
  // Safari private mode throws on setItem; the original code swallowed it.
  const hostile = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("SecurityError"); },
    removeItem: () => { throw new Error("SecurityError"); }
  };
  assert.doesNotThrow(() => writeBirthCache(hostile, "user-alice", ALICE));
  assert.equal(readBirthCache(hostile, "user-alice"), null);
  assert.doesNotThrow(() => clearBirthCache(hostile));
});
