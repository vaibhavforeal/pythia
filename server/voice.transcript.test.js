// Turning a call into a conversation row.
//
// The spike found transcripts arrive on the SERVER's control socket, not only
// on the browser's data channel — so these are observed, not client-supplied,
// and a voice call can be persisted without trusting anything the page sends.
// That is a stronger position than the design originally assumed, and the caps
// below are belt-and-braces rather than the only defence.
const test = require("node:test");
const assert = require("node:assert");
const { toConversationMessages } = require("./voice");

const ev = (role, itemId, transcript) => ({ role, itemId, transcript });

test("a call becomes an ordinary conversation, in order", () => {
  const out = toConversationMessages([
    ev("user", "i1", "hello"),
    ev("assistant", "i2", "hello, whose chart are we looking at?"),
    ev("user", "i3", "mine"),
    ev("assistant", "i4", "lovely")
  ]);
  assert.equal(out.length, 4);
  assert.deepEqual(out.map(m => m.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(out[0].content, "hello");
  // So the UI can mark a spoken turn, and so an audit can tell them apart later.
  assert.ok(out.every(m => m.source === "voice"));
});

test("order is arrival order, not id order", () => {
  // item ids are opaque and not sortable — sorting by them would silently
  // scramble the conversation.
  const out = toConversationMessages([
    ev("user", "zzz", "first"),
    ev("assistant", "aaa", "second")
  ]);
  assert.deepEqual(out.map(m => m.content), ["first", "second"]);
});

test("a repeated item id is written once", () => {
  const out = toConversationMessages([
    ev("user", "i1", "hello"),
    ev("user", "i1", "hello"),
    ev("assistant", "i2", "hi")
  ]);
  assert.equal(out.length, 2);
});

test("empty transcripts are dropped", () => {
  // Voice activity detection produces these constantly — a cough, a door, a
  // breath. Persisting them would fill the history with blank turns.
  const out = toConversationMessages([
    ev("user", "i1", ""),
    ev("user", "i2", "   "),
    ev("user", "i3", "\n\t "),
    ev("user", "i4", null),
    ev("user", "i5", undefined),
    ev("user", "i6", "actually said something")
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].content, "actually said something");
});

test("anything that is not a spoken turn is never persisted", () => {
  const out = toConversationMessages([
    { role: "function_call", itemId: "f1", transcript: "lookup_chart_detail" },
    { role: "function_call_output", itemId: "f2", transcript: "thirty-one bindus" },
    { role: "system", itemId: "s1", transcript: "instructions" },
    ev("user", "i1", "real")
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, "user");
});

test("length and count are bounded", () => {
  const long = toConversationMessages([ev("user", "i1", "x".repeat(10000))]);
  assert.equal(long[0].content.length, 4000);

  const many = toConversationMessages(
    Array.from({ length: 300 }, (_, i) => ev(i % 2 ? "assistant" : "user", `i${i}`, `turn ${i}`))
  );
  assert.equal(many.length, 200);
});

test("garbage in the buffer cannot break the flush", () => {
  // This runs on the teardown path. A throw here would lose the transcript AND
  // leave the session half-torn-down.
  for (const input of [null, undefined, [], [null], [undefined], [{}], ["nope"], [0]]) {
    let out;
    assert.doesNotThrow(() => { out = toConversationMessages(input); }, JSON.stringify(input));
    assert.ok(Array.isArray(out));
  }
});
