// Who is allowed to place a call.
//
// This gate fails CLOSED, which is the opposite of how allowlists usually read,
// so it is worth pinning down. The reason is the same one that makes
// MAX_CONCURRENT and MAX_SESSION_SEC fail closed: voice is billed by the
// minute, so being wrong costs an invoice rather than a 500. And the two
// settings that govern it live in different places — VOICE_ENABLED in
// render.yaml, VOICE_ALLOWLIST in the Render dashboard — so a deploy can land
// before the allowlist does. Fail-open, that gap is "live for every user".
const test = require("node:test");
const assert = require("node:assert");
const { isAllowed } = require("./voice");

const USER = "bd87be16-31a0-4eea-b9a1-b8135cc56df9";

test("an unset or empty allowlist admits nobody", () => {
  for (const raw of [undefined, null, "", "   ", ",", " , , "]) {
    assert.strictEqual(isAllowed(USER, raw), false, `admitted on ${JSON.stringify(raw)}`);
  }
});

test("a named user is admitted, and only that user", () => {
  assert.strictEqual(isAllowed(USER, USER), true);
  assert.strictEqual(isAllowed("someone-else", USER), false);
});

test("whitespace and multiple entries parse", () => {
  const raw = ` ${USER} , second-user ,, third-user `;
  assert.strictEqual(isAllowed(USER, raw), true);
  assert.strictEqual(isAllowed("second-user", raw), true);
  assert.strictEqual(isAllowed("third-user", raw), true);
  assert.strictEqual(isAllowed("fourth-user", raw), false);
});

test("opening voice to everyone takes an explicit star", () => {
  assert.strictEqual(isAllowed("anyone-at-all", "*"), true);
  assert.strictEqual(isAllowed("anyone-at-all", ` ${USER}, * `), true);
});

test("a non-string user id cannot slip past by type", () => {
  // req.userId comes from a signed token, but the comparison should not depend
  // on that: a number or object must not match a list entry by coercion accident.
  assert.strictEqual(isAllowed(123, "123"), true, "a numeric id still matches its own entry");
  assert.strictEqual(isAllowed({}, USER), false);
  assert.strictEqual(isAllowed(undefined, USER), false);
  assert.strictEqual(isAllowed(null, ""), false);
});

test("a partial match is not a match", () => {
  assert.strictEqual(isAllowed("bd87be16", USER), false, "a prefix of an allowed id is a different user");
  assert.strictEqual(isAllowed(USER + "x", USER), false);
});
