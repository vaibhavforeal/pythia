// The voice agent: Claude's brain, Azure's ears and mouth.
//
// Azure Voice Live runs a Foundry-deployed Claude as the LLM inside a managed
// realtime loop, so the practitioner prompt and the chart grounding that make
// chat worth using carry over unchanged, and Azure handles speech recognition,
// semantic turn detection, echo cancellation, neural TTS and barge-in.
//
// Transport is WebRTC: media goes browser-to-Azure directly and never crosses
// this server. What DOES stay here is the part that matters — the API key, the
// chart, and the instructions. See docs in the plan for why that split is the
// whole guardrail.
//
// This file currently holds only the pure, testable half: config, the tool
// schema, and the session builder. Routes, metering and the control socket
// land in the next change, once the spike has earned its criteria.

const { chartToSpokenText, chartDetail, DETAIL_TOPICS } = require("./astro");
const {
  SKILL_PROMPT_SPOKEN, SPOKEN_BEHAVIOUR_NOTE, SPOKEN_NOTE,
  REGISTER_NOTE, SPOKEN_CARE_NOTE, GROUNDING_NOTE
} = require("./prompts");

// --- Configuration -----------------------------------------------------------
// Off unless deliberately switched on, per environment. A realtime session is
// metered in minutes rather than requests, and BYOM billing is not covered by
// the published Voice Live tier table, so this is not a feature to discover you
// left enabled.
const ENABLED = String(process.env.VOICE_ENABLED || "").trim().toLowerCase() === "true";

// Pinned, not defaulted to "latest": these are preview APIs. The probe in
// tools/voice-spike.js found 2026-01-01-preview is the ONLY api-version that
// accepts the WebRTC /calls endpoint — 2026-04-10 and 2026-06-01-preview are
// both rejected on it, even though BYOM itself is documented against 2026-04-10.
const API_VERSION = process.env.VOICE_API_VERSION || "2026-01-01-preview";
const PROFILE = process.env.VOICE_PROFILE || "byom-foundry-anthropic-messages";

// Same Foundry resource as chat, so the host is derived from the chat endpoint
// rather than being a second env var that can drift out of sync with the first.
function voiceHost() {
  try {
    return new URL(process.env.VOICE_ENDPOINT || process.env.AZURE_INFERENCE_ENDPOINT).host;
  } catch (_) {
    return null;
  }
}

// Deliberately separate from AZURE_DEPLOYMENT. Chat runs Opus with adaptive
// thinking, which is right for a written reading and much too slow for a
// conversation — neither `thinking` nor `output_config.effort` is expressible
// through a Voice Live session, so the model itself is the only latency lever.
const DEPLOYMENT = process.env.VOICE_DEPLOYMENT || process.env.AZURE_DEPLOYMENT;

const KEY = process.env.VOICE_KEY || process.env.AZURE_INFERENCE_KEY;

/**
 * One persona, two voices.
 *
 * The character is the same either way — this is a voice preference, not a
 * choice between astrologers. Indian-English throughout, because that is who
 * this is for and a US voice reading Sanskrit is its own kind of wrong.
 */
const VOICES = {
  warm: process.env.VOICE_NAME_WARM || "en-IN-NeerjaNeural",
  calm: process.env.VOICE_NAME_CALM || "en-IN-PrabhatNeural"
};
const DEFAULT_VOICE = "warm";

/**
 * A client may pick a voice; it may not name one.
 *
 * hasOwnProperty rather than a truthiness check on VOICES[key]: "toString" and
 * "constructor" are inherited from Object.prototype and read as truthy, so a
 * plain lookup would accept them and put a function where the voice name goes.
 */
function resolveVoice(key) {
  const k = String(key == null ? "" : key).trim();
  return Object.prototype.hasOwnProperty.call(VOICES, k) ? k : DEFAULT_VOICE;
}

// --- The tool ----------------------------------------------------------------
// chartToSpokenText withholds every exact figure a model is prone to
// half-remembering. This is the only way to get them back, which means the
// model's options are "ask" or "say I don't know" — never "guess".
const VOICE_TOOL = {
  type: "function",
  name: "lookup_chart_detail",
  description:
    "Look up an exact figure from this person's chart that is NOT in your instructions: " +
    "any divisional chart beyond D1 and D9, any ashtakavarga bindu count, the full " +
    "transit list, exact dasha dates, or the full navamsa. You MUST call this rather " +
    "than recalling or estimating any such number — a wrong number is worse than a pause. " +
    "Say one short line first, like 'let me pull that up', then call it.",
  parameters: {
    type: "object",
    required: ["detail"],
    additionalProperties: false,
    properties: {
      detail: {
        type: "string",
        enum: DETAIL_TOPICS,
        description: "Which kind of figure to retrieve."
      },
      varga: {
        type: "string",
        description:
          "Required when detail is varga. One of D2 D3 D4 D7 D10 D12 D16 D20 D24 D27 D30 D40 D45 D60."
      },
      planet: {
        type: "string",
        description:
          "Required when detail is ashtakavarga_bav. Sun Moon Mars Mercury Jupiter Venus Saturn."
      },
      lord: {
        type: "string",
        description: "Optional when detail is dasha_dates. Omit for the running sequence."
      }
    }
  }
};

/** Answer one tool call against the session's chart. Never throws. */
function handleToolCall(chart, name, rawArguments) {
  if (name !== VOICE_TOOL.name) {
    return `I don't have a way to look that up.`;
  }
  let args = {};
  try {
    args = typeof rawArguments === "string" ? JSON.parse(rawArguments) : rawArguments || {};
  } catch (_) {
    // A model told to call a tool will eventually call it with malformed JSON.
    // Answering the question it probably meant beats stalling the call.
    args = {};
  }
  return chartDetail(chart, args);
}

// --- Instructions ------------------------------------------------------------
// Order is load-bearing. Voice Live takes ONE flat instruction string — there is
// no content-block array, no cache_control, and no way to weight a section — so
// position is the only lever there is, and later means stronger.
//
// SPOKEN_CARE_NOTE therefore sits last among the behavioural blocks, after
// SPOKEN_NOTE, and carries an explicit exemption from SPOKEN_NOTE's brevity
// rules. Without that exemption the two genuinely contradict: one says two or
// three sentences and stop, the other requires stopping the astrology entirely,
// asking who they could tell, and reading out two helpline numbers.
//
// GROUNDING_NOTE goes after the chart because it is about the chart's edges —
// stated before it, it would be describing something the model hasn't read yet.
function voiceInstructions(chart) {
  if (!chart) {
    // An ungrounded voice session is the exact failure this feature is designed
    // to prevent, so it must be impossible to construct rather than merely
    // discouraged. The route refuses earlier; this is the backstop.
    throw new Error("voiceInstructions: refusing to build a session with no chart");
  }
  return [
    SKILL_PROMPT_SPOKEN,
    SPOKEN_BEHAVIOUR_NOTE,
    SPOKEN_NOTE,
    REGISTER_NOTE,
    SPOKEN_CARE_NOTE,
    "=== CONSULTATION CHART (authoritative) ===\n" + chartToSpokenText(chart),
    GROUNDING_NOTE
  ].join("\n\n");
}

// Re-sent to the model on EVERY turn, so this is a per-turn tax rather than a
// one-off. Measured at 23,632 B for the fixture chart; the ceiling leaves room
// for a chart with more yogas and conjunctions without leaving room for someone
// to quietly paste the full varga tables back in. See voice.session.test.js.
const MAX_INSTRUCTION_BYTES = 26000;

/**
 * The `session` object sent to Voice Live.
 *
 * Every input is server-derived. The caller picks a voice by key, and nothing
 * else about this is negotiable from the client side — the chart comes from the
 * store, the instructions are built here, and the tool list is fixed.
 */
function buildSessionConfig({ chart, voice, sessionId, userHash } = {}) {
  const instructions = voiceInstructions(chart);
  const voiceKey = resolveVoice(voice);

  return {
    modalities: ["text", "audio"],
    instructions,
    // A BYOM text model has no native audio, so output is Azure neural TTS.
    voice: { type: "azure-standard", name: VOICES[voiceKey] },
    turn_detection: {
      // Multilingual, so a caller code-switching into Hindi mid-sentence is
      // still segmented correctly. Semantic rather than silence-based: it waits
      // for a finished thought instead of a gap, which is the difference
      // between being interrupted and being heard out.
      type: "azure_semantic_vad_multilingual",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      // Barge-in must actually stop the agent, not just duck it.
      interrupt_response: true,
      // Truncate history to what was ACTUALLY heard. Without this the model
      // believes it delivered a sentence the caller talked over — which for a
      // half-spoken helpline number is the difference between having it and
      // thinking you do.
      auto_truncate: true
    },
    input_audio_noise_reduction: { type: "azure_deep_noise_suppression" },
    input_audio_echo_cancellation: {},
    input_audio_transcription: { model: "azure-speech" },
    tools: [VOICE_TOOL],
    // The only mechanism tying real Azure spend back to a call: token counts are
    // not reportable server-side here (BYOM reports audio tokens only, and under
    // WebRTC response.done never reaches us at all). Ground truth is Cost
    // Management, filtered on these. The user id is hashed — it lands in
    // Microsoft's resource logs.
    metadata: { app: "pythia", sessionId: sessionId || "", userHash: userHash || "" }
  };
}

/** The upstream signalling URL. Key is a query param: headers are unavailable in browsers. */
function signallingUrl() {
  const host = voiceHost();
  if (!host || !KEY || !DEPLOYMENT) return null;
  return (
    `wss://${host}/voice-live/realtime/calls` +
    `?api-version=${encodeURIComponent(API_VERSION)}` +
    `&profile=${encodeURIComponent(PROFILE)}` +
    `&model=${encodeURIComponent(DEPLOYMENT)}` +
    `&api-key=${encodeURIComponent(KEY)}`
  );
}

/** True when every piece of config a call needs is actually present. */
function configured() {
  return Boolean(ENABLED && voiceHost() && KEY && DEPLOYMENT);
}

module.exports = {
  ENABLED,
  API_VERSION,
  PROFILE,
  VOICES,
  DEFAULT_VOICE,
  VOICE_TOOL,
  MAX_INSTRUCTION_BYTES,
  resolveVoice,
  handleToolCall,
  voiceInstructions,
  buildSessionConfig,
  signallingUrl,
  configured
};
