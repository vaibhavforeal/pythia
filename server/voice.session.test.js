// The voice session config — where the chart guardrail actually lives.
//
// Voice Live takes ONE flat instruction string. No content-block array, no
// cache_control, no per-section weighting. So everything that bounds what the
// agent may say is either in this string or nowhere, and it is re-sent to the
// model on every single turn.
//
// That makes two things worth testing hard: that the string CONTAINS what must
// bound it, and that it stays small enough to afford.
const test = require("node:test");
const assert = require("node:assert");
const voice = require("./voice");
const prompts = require("./prompts");
const { computeChart } = require("./astro");

const BIRTH = {
  year: 2004, month: 6, day: 14, hour: 9, minute: 20,
  lat: 12.9716, lon: 77.5946, tz: 5.5, name: "Test",
  nodeAspects: [5, 7, 9], nodeMode: "jupiter", gender: "female"
};
const chart = computeChart(BIRTH);
const cfg = voice.buildSessionConfig({ chart });
const instructions = cfg.instructions;

test("a session cannot be built without a chart", () => {
  // The whole feature exists to be grounded. An ungrounded session must be
  // impossible to construct, not merely discouraged — the route refuses first,
  // and this is the backstop behind it.
  for (const bad of [null, undefined, 0, ""]) {
    assert.throws(() => voice.buildSessionConfig({ chart: bad }), /no chart/);
  }
  assert.throws(() => voice.voiceInstructions(null), /no chart/);
});

test("the agent is told to answer in the caller's own language", () => {
  // The session can HEAR Hindi — turn detection is the multilingual variant —
  // but nothing made it REPLY in Hindi, so a caller speaking Hindi got English
  // back. For this audience that is the difference between a product people use
  // and one they try once.
  assert.match(instructions, /answer in Hindi/i);
  assert.match(instructions, /Hinglish/i);
  // Mixing languages mid-sentence is how people actually talk here, and the
  // model must not treat it as an error to be tidied up.
  assert.match(instructions, /mix it back/i);
  // Announcing the switch, or asking which language they'd prefer, breaks the
  // illusion harder than answering in the wrong one.
  assert.match(instructions, /Never announce the switch/i);
});

test("every voice on offer is an Indian one", () => {
  // A US voice reading Sanskrit is its own kind of wrong, and the Hindi option
  // exists because a voice is bound to the session and cannot switch mid-call.
  for (const [key, name] of Object.entries(voice.VOICES)) {
    assert.match(name, /^(en-IN|hi-IN)-/, `${key} is not an Indian voice: ${name}`);
  }
  assert.ok(Object.values(voice.VOICES).some(n => n.startsWith("hi-IN-")),
    "no Hindi voice is offered at all");
});

test("the instructions carry the chart and the care protocol", () => {
  assert.ok(instructions.includes("=== CONSULTATION CHART (authoritative) ==="));
  assert.ok(instructions.includes("=== PRIMARY VARGAS"), "the domain verdicts are missing");
  // Both helplines, verbatim. These are the highest-consequence characters in
  // the entire prompt.
  assert.ok(instructions.includes("1860 266 2345"), "Vandrevala number is missing");
  assert.ok(instructions.includes("9152987821"), "iCall number is missing");
  // And the rule that stops the agent inventing figures it doesn't hold.
  assert.ok(instructions.includes("lookup_chart_detail"));
  assert.ok(instructions.includes("GROUNDING."));
});

test("the care protocol is exempted from the brevity rules", () => {
  // This is the collision worth guarding. SPOKEN_NOTE says two or three
  // sentences and one idea per turn; the crisis path has to stop the astrology,
  // ask who they could tell, and read out two helplines. Without an explicit
  // exemption the system is terse at exactly the moment it must not be.
  assert.ok(
    /do NOT apply/.test(prompts.SPOKEN_CARE_ADDENDUM),
    "the brevity exemption has gone missing from the care addendum"
  );
  assert.ok(instructions.includes(prompts.SPOKEN_CARE_ADDENDUM), "the addendum never reached the session");

  // Order matters, because position is the only weighting Voice Live offers.
  // The exemption has to come after the rule it exempts.
  assert.ok(
    instructions.indexOf(prompts.SPOKEN_NOTE) < instructions.indexOf(prompts.SPOKEN_CARE_ADDENDUM),
    "the care addendum precedes the brevity rules it is meant to override"
  );
  // Speech breaks a phone number in ways text does not.
  assert.ok(/digit by digit/i.test(instructions), "helpline read-out guidance is missing");
  assert.ok(/start that number again/i.test(instructions), "interrupted-number guidance is missing");
});

test("nerd mode is never offered on a call", () => {
  // NERD_NOTE tells the model to use Sanskrit names, degrees and house numbers
  // freely — precisely what SPOKEN_NOTE forbids. There is no toggle for it here
  // and there should not be one; this notices if someone wires it through.
  assert.ok(!instructions.includes(prompts.NERD_NOTE));
  assert.ok(instructions.includes(prompts.REGISTER_NOTE));
});

test("the instructions never tell a caller to go and check another app", () => {
  // The skill markdown's Computation Guidelines section suggests verifying in
  // Jagannatha Hora or Astrosage, which made sense when the model was
  // approximating placements. Here the server injects authoritative Swiss
  // Ephemeris output, so that advice is now simply wrong — and mid-call it
  // sounds like being handed off.
  for (const app of ["Jagannatha", "Astrosage", "Kundli app"]) {
    assert.ok(!instructions.includes(app), `the spoken skill still recommends ${app}`);
  }
});

test("the instructions say nothing in markdown", () => {
  // Everything here is synthesised into speech. The spoken chart and the notes
  // must be clean; the skill markdown keeps its own headings, which the model
  // reads as structure rather than reciting.
  const notes = [
    prompts.SPOKEN_BEHAVIOUR_NOTE, prompts.SPOKEN_NOTE,
    prompts.REGISTER_NOTE, prompts.GROUNDING_NOTE, prompts.SPOKEN_CARE_ADDENDUM
  ];
  for (const n of notes) {
    assert.ok(!/[|#]/.test(n), "markdown punctuation in a spoken note");
  }
});

test("the per-turn instruction budget holds", () => {
  // THE COST GUARD. There is no prompt caching in a realtime session, so this
  // string is paid for on every turn of every call. Measured baselines:
  //
  //   chat blocks + full chartToText   29,465 B   ~7,366 tok   (~147k per 20 turns)
  //   spoken blocks + spoken chart     23,632 B   ~5,908 tok   (~118k per 20 turns)
  //
  // If this fails, something large came back. The likely culprits are the 16
  // supplementary divisionals (2,349 B) or the ashtakavarga grids (1,005 B),
  // both of which belong behind lookup_chart_detail. Raising the ceiling is
  // a decision about the bill, not a test fix.
  const bytes = Buffer.byteLength(instructions);
  assert.ok(
    bytes <= voice.MAX_INSTRUCTION_BYTES,
    `instructions are ${bytes} B, over the ${voice.MAX_INSTRUCTION_BYTES} B ceiling`
  );
});

test("the session is configured for a real conversation", () => {
  assert.deepEqual(cfg.modalities, ["text", "audio"]);
  // Multilingual VAD is what lets a caller switch into Hindi mid-sentence.
  assert.equal(cfg.turn_detection.type, "azure_semantic_vad_multilingual");
  // History must match what was actually heard, not what was sent.
  assert.equal(cfg.turn_detection.auto_truncate, true);

  // The session must carry ONLY fields the spike proved against this preview
  // api-version. interrupt_response and input_audio_transcription were both
  // added from the docs without a spike run, and both are in the diff between
  // a config that answered and one that listened in silence. This asserts the
  // discipline, not the fields: anything new here needs evidence first.
  assert.deepEqual(Object.keys(cfg).sort(), [
    "input_audio_echo_cancellation", "input_audio_noise_reduction", "instructions",
    "metadata", "modalities", "tools", "turn_detection", "voice"
  ]);
  assert.deepEqual(Object.keys(cfg.turn_detection).sort(), [
    "auto_truncate", "prefix_padding_ms", "silence_duration_ms", "threshold", "type"
  ]);
  assert.ok(cfg.input_audio_echo_cancellation, "echo cancellation is off");
  assert.equal(cfg.tools.length, 1);
  assert.equal(cfg.tools[0].name, "lookup_chart_detail");
  assert.deepEqual(cfg.tools[0].parameters.required, ["detail"]);
});

test("the caller picks a voice by key, never by name", () => {
  // Otherwise the voice field is a free-text channel from the client into the
  // upstream session object.
  assert.equal(voice.resolveVoice("calm"), "calm");
  assert.equal(voice.resolveVoice("warm"), "warm");
  assert.equal(voice.resolveVoice("hindi"), "hindi");
  for (const junk of ["en-US-AvaNeural", "", null, undefined, 42, "__proto__", "toString"]) {
    assert.equal(voice.resolveVoice(junk), voice.DEFAULT_VOICE, `resolveVoice leaked on ${String(junk)}`);
  }
  const named = voice.buildSessionConfig({ chart, voice: "en-US-AvaNeural" });
  assert.equal(named.voice.name, voice.VOICES[voice.DEFAULT_VOICE]);
});

test("tool calls survive whatever the model sends", () => {
  // Malformed arguments are a live-call certainty, and the failure that matters
  // is the agent going silent, not the argument being wrong.
  const good = voice.handleToolCall(chart, "lookup_chart_detail", '{"detail":"ashtakavarga_sav"}');
  assert.ok(good.includes(String(chart.ashtakavarga.savTotal)));

  for (const raw of ["", "{", "null", "[]", '{"detail":', undefined, null, { detail: "varga", varga: "D10" }]) {
    let out;
    assert.doesNotThrow(() => { out = voice.handleToolCall(chart, "lookup_chart_detail", raw); });
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0 && out.length <= 600);
  }
  // An unknown tool name is answered, not thrown on.
  const unknown = voice.handleToolCall(chart, "drop_tables", "{}");
  assert.equal(typeof unknown, "string");
});

test("voice is off, and unconfigured, by default", () => {
  // The suite runs without VOICE_* set, which is exactly the state a fresh
  // deploy is in. Neither must ever read as "ready".
  assert.equal(voice.ENABLED, false);
  assert.equal(voice.configured(), false);
  assert.equal(voice.signallingUrl(), null);
});

test("the api-version is pinned to the one that actually works", () => {
  // tools/voice-spike.js probed all four candidates: the WebRTC /calls endpoint
  // accepts 2026-01-01-preview and rejects both 2026-04-10 and
  // 2026-06-01-preview, even though BYOM itself is documented against
  // 2026-04-10. Not a value to "update" without re-probing.
  assert.equal(voice.API_VERSION, "2026-01-01-preview");
  assert.equal(voice.PROFILE, "byom-foundry-anthropic-messages");
});
