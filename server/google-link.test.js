// Which account a Google sign-in lands in.
//
// The first test here is a regression test for a real account takeover, and is
// the reason this logic was pulled out of the route at all. The rest exist so
// that fixing it didn't quietly break the legitimate paths.
const test = require("node:test");
const assert = require("node:assert");
const { resolveGoogleAccount } = require("./google-link");

// Minimal in-memory stand-in for the store's users API.
function fakeUsers(seed = []) {
  const rows = seed.map(r => ({ ...r }));
  return {
    rows,
    async findByGoogleId(gid) { return rows.find(r => r.googleId === gid); },
    async findByEmail(email) { return rows.find(r => r.email === email); },
    async findById(id) { return rows.find(r => r.id === id); },
    async update(id, patch) { Object.assign(rows.find(r => r.id === id), patch); },
    async add(u) { rows.push({ ...u }); return rows[rows.length - 1]; }
  };
}

const SQUATTER = {
  id: "squatter-1",
  email: "victim@example.com",
  salt: "s", hash: "h",            // registered with a password, never verified
  googleId: null
};

test("a squatted email cannot be taken over by signing in with Google", async () => {
  // The attack: register victim@example.com (registration verifies nothing),
  // then wait. Before the fix the victim's Google sign-in was linked straight
  // into this account, which the attacker's password still opened.
  const users = fakeUsers([SQUATTER]);
  const out = await resolveGoogleAccount(users, {
    gid: "google-victim", email: "victim@example.com", sessionUserId: null
  });

  assert.strictEqual(out.error, "email_taken", "must refuse rather than link");
  assert.strictEqual(out.user, undefined, "no session may be issued");
  // And nothing about the attacker's row may have changed.
  assert.strictEqual(users.rows[0].googleId, null, "Google must not be attached");
  assert.strictEqual(users.rows.length, 1, "no account should be created either");
});

test("a brand new Google user gets an account", async () => {
  const users = fakeUsers();
  const out = await resolveGoogleAccount(users, {
    gid: "google-new", email: "new@example.com", sessionUserId: null
  });
  assert.ok(out.user, out.error);
  assert.strictEqual(out.user.email, "new@example.com");
  assert.strictEqual(out.user.googleId, "google-new");
});

test("returning Google users land in their own account, not a new one", async () => {
  const users = fakeUsers([{ id: "u1", email: "a@example.com", googleId: "google-a" }]);
  const out = await resolveGoogleAccount(users, {
    gid: "google-a", email: "a@example.com", sessionUserId: null
  });
  assert.strictEqual(out.user.id, "u1");
  assert.strictEqual(users.rows.length, 1, "must not duplicate the account");
});

// The legitimate route for someone who signed up with a password: prove the
// account with the password first, THEN attach Google.
test("a signed-in user can link Google to their own account", async () => {
  const users = fakeUsers([{ ...SQUATTER, id: "u1" }]);
  const out = await resolveGoogleAccount(users, {
    gid: "google-victim", email: "victim@example.com", sessionUserId: "u1"
  });
  assert.strictEqual(out.user.id, "u1");
  assert.strictEqual(users.rows[0].googleId, "google-victim", "link should be recorded");
});

test("linking is refused when that Google identity is already on someone else", async () => {
  const users = fakeUsers([
    { id: "u1", email: "mine@example.com", salt: "s", hash: "h" },
    { id: "u2", email: "theirs@example.com", googleId: "google-taken" }
  ]);
  const out = await resolveGoogleAccount(users, {
    gid: "google-taken", email: "theirs@example.com", sessionUserId: "u1"
  });
  assert.strictEqual(out.error, "google_taken");
  assert.strictEqual(users.rows[0].googleId, undefined, "u1 must not be modified");
  assert.strictEqual(users.rows[1].id, "u2", "u2 keeps its identity");
});

// The email address carries no authority on its own — only the session does.
test("a link uses the session's account even when the emails differ", async () => {
  const users = fakeUsers([
    { id: "u1", email: "personal@example.com", salt: "s", hash: "h" },
    { id: "u2", email: "work@example.com", salt: "s", hash: "h" }
  ]);
  const out = await resolveGoogleAccount(users, {
    gid: "google-work", email: "work@example.com", sessionUserId: "u1"
  });
  assert.strictEqual(out.user.id, "u1", "the session decides, not the address");
  assert.strictEqual(users.rows[1].googleId, undefined, "u2 must be untouched");
});
