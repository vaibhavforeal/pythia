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
  SKILL_PROMPT_SPOKEN, SPOKEN_BEHAVIOUR_NOTE, SPOKEN_NOTE, HUMAN_NOTE,
  REGISTER_NOTE, SPOKEN_CARE_NOTE, GROUNDING_NOTE
} = require("./prompts");

// --- Configuration -----------------------------------------------------------
// Off unless deliberately switched on, per environment. A realtime session is
// metered in minutes rather than requests, and BYOM billing is not covered by
// the published Voice Live tier table, so this is not a feature to discover you
// left enabled.
const ENABLED = String(process.env.VOICE_ENABLED || "").trim().toLowerCase() === "true";

// Prints every upstream control frame. Deliberately opt-in: those frames carry
// transcripts of what a caller said out loud, which has no business sitting in
// a server log by default.
const DEBUG = String(process.env.VOICE_DEBUG || "").trim().toLowerCase() === "true";

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
 * One persona, three voices.
 *
 * The character is the same in each — this is a voice preference, not a choice
 * between astrologers. All Indian: a US voice reading Sanskrit is its own kind
 * of wrong.
 *
 * The `hindi` option exists because a voice is bound to the session and cannot
 * change mid-call, while SPOKEN_NOTE tells the agent to answer in whichever
 * language the caller uses. An en-IN voice reading a Hindi sentence is audibly
 * an English speaker attempting Hindi, which is worse than not offering it.
 *
 * The better answer is one MULTILINGUAL voice that handles both and removes the
 * choice entirely — Azure has them, and swapping is a config string. These
 * defaults were picked without hearing them; audition with
 * `node tools/voice-spike.js --voice <name>` and keep what sounds like a
 * person rather than an announcer.
 */
const VOICES = {
  warm: process.env.VOICE_NAME_WARM || "en-IN-NeerjaNeural",
  calm: process.env.VOICE_NAME_CALM || "en-IN-PrabhatNeural",
  hindi: process.env.VOICE_NAME_HINDI || "hi-IN-SwaraNeural"
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
    HUMAN_NOTE,
    REGISTER_NOTE,
    SPOKEN_CARE_NOTE,
    "=== CONSULTATION CHART (authoritative) ===\n" + chartToSpokenText(chart),
    GROUNDING_NOTE
  ].join("\n\n");
}

// Re-sent to the model on EVERY turn, so this is a per-turn tax rather than a
// one-off. The ceiling leaves room for a chart with more yogas and conjunctions
// without leaving room for someone to quietly paste the full varga tables back
// in. See voice.session.test.js.
//
// Raised 26,000 -> 27,500 to fit HUMAN_NOTE (1,781 B). Recorded rather than
// quietly bumped, because this is a bill:
//
//   23,632 B  ~5,908 tok/turn   before
//   26,266 B  ~6,566 tok/turn   after   (~131k per 20-turn call)
//
// Worth it. "The tone doesn't seem human" was the first thing said about a
// working call, and sounding like a person IS the product here — it is the only
// thing separating this from a text chat with a speaker attached. The guard is
// meant to catch an accidental regression, not to veto a reviewed change; what
// it must never allow is a silent one.
const MAX_INSTRUCTION_BYTES = 27500;

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
    // EXACTLY the shape tools/voice-spike.js proved against this api-version.
    // Nothing is added here speculatively: the endpoint is a preview one, an
    // unrecognised field can sink the whole session update, and a session with
    // no working turn detection presents as a call that listens and never
    // answers — with no error anywhere.
    turn_detection: {
      // Multilingual, so a caller code-switching into Hindi mid-sentence is
      // still segmented correctly. Semantic rather than silence-based: it waits
      // for a finished thought instead of a gap, which is the difference
      // between being interrupted and being heard out.
      type: "azure_semantic_vad_multilingual",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      // Truncate history to what was ACTUALLY heard. Without this the model
      // believes it delivered a sentence the caller talked over — which for a
      // half-spoken helpline number is the difference between having it and
      // thinking you do.
      auto_truncate: true
    },
    input_audio_noise_reduction: { type: "azure_deep_noise_suppression" },
    input_audio_echo_cancellation: {},
    // Deliberately NOT sent:
    //   interrupt_response       barge-in already works without it — measured
    //                            at 841ms in the spike, with the conversation
    //                            item truncated as it should be
    //   input_audio_transcription  the docs say Azure speech-to-text is active
    //                            automatically for a non-multimodal model, and
    //                            the spike had transcripts without asking
    // Both were added from the documentation rather than from evidence, and
    // both are the difference between the config that worked and one that did
    // not. Re-add only with a spike run behind it.
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

// --- Limits ------------------------------------------------------------------
// Voice bills by the minute, and an open socket keeps billing whether or not
// anyone is talking. So the limits are layered by how they FAIL, not by size.
//
// The persistent daily budget fails OPEN by design (see auth.persistentRate-
// Limiter) — correct for chat, which is about to hit the same store anyway, and
// dangerous for a metered realtime API. The last three below need no store and
// no network, so a database outage can leak at most
// VOICE_MAX_CONCURRENT × VOICE_MAX_SESSION_SEC of billable time.
const MINUTES_PER_DAY = Number(process.env.VOICE_MINUTES_PER_DAY) || 10;
const MAX_SESSION_SEC = Number(process.env.VOICE_MAX_SESSION_SEC) || 600;
const IDLE_SEC = Number(process.env.VOICE_IDLE_SEC) || 45;
const STARTS_PER_HOUR = Number(process.env.VOICE_STARTS_PER_HOUR) || 6;
const MAX_CONCURRENT = Number(process.env.VOICE_MAX_CONCURRENT) || 2;
const DAY_MS = 24 * 60 * 60 * 1000;

// Pilot gate, and it FAILS CLOSED: unset or empty admits nobody. Opening voice
// to everyone takes the explicit sentinel "*".
//
// The obvious reading — empty means no restriction — is how every other
// allowlist in the world behaves, and it is wrong here for the same reason
// MAX_CONCURRENT and MAX_SESSION_SEC fail closed: this is billed by the minute,
// so the cost of being wrong is not a 500, it is an invoice. It also removes an
// ordering hazard that no comment can fix — VOICE_ENABLED lives in render.yaml
// and VOICE_ALLOWLIST is set in the dashboard, so a push can land before the
// allowlist does. Fail-open, that window is "voice is live for every user".
function isAllowed(userId, raw) {
  const list = String(raw || "").split(",").map(s => s.trim()).filter(Boolean);
  if (list.includes("*")) return true;
  return list.includes(String(userId));
}

const ALLOWLIST_RAW = process.env.VOICE_ALLOWLIST || "";
const allowed = userId => isAllowed(userId, ALLOWLIST_RAW);

// --- Live sessions -----------------------------------------------------------
// In-memory → single-instance only, exactly like auth.rateLimiter. Correct on
// Render's single container; the day this runs on two, a call started on one
// instance cannot be ended or metered by the other.
const _sessions = new Map();

const countFor = userId => {
  let n = 0;
  for (const s of _sessions.values()) if (s.userId === userId) n++;
  return n;
};

// --- Transcripts -------------------------------------------------------------
// The spike found these arrive on the control socket, not only on the browser's
// data channel — so they are server-observed rather than client-supplied, and a
// voice call can be persisted without trusting anything the page sends.
//
// Pure and exported so the mapping can be tested without a call.
function toConversationMessages(events) {
  const out = [];
  const seen = new Set();
  for (const e of events || []) {
    if (!e || seen.has(e.itemId)) continue;
    const content = String(e.transcript == null ? "" : e.transcript).trim();
    // VAD false positives produce empty transcripts constantly.
    if (!content) continue;
    if (e.role !== "user" && e.role !== "assistant") continue;
    if (e.itemId) seen.add(e.itemId);
    out.push({ role: e.role, content: content.slice(0, 4000), source: "voice" });
    if (out.length >= 200) break;
  }
  return out;
}

// --- Routes ------------------------------------------------------------------
function routes(app) {
  const auth = require("./auth");
  const store = require("./store");
  const crypto = require("node:crypto");
  const { chartFromBirth } = require("./birth");
  const { users, people, conversations } = store;

  // One start per minute-zero charge. Reused verbatim rather than reimplemented,
  // so the daily budget shares the store semantics the chat cap already has.
  const minuteBudget = auth.persistentRateLimiter({
    windowMs: DAY_MS,
    max: MINUTES_PER_DAY,
    key: req => req.userId,
    prefix: "voice-min",
    message: "You've used today's voice minutes. Text chat is still open."
  });

  const startBurst = auth.rateLimiter({
    windowMs: 60 * 60 * 1000,
    max: STARTS_PER_HOUR,
    key: req => req.userId,
    message: "Too many calls started — give it a few minutes."
  });

  /** Charge one minute. Returns false when the day's budget is spent. */
  async function chargeMinute(userId) {
    try {
      const rec = await store.rateLimits.hit(`voice-min:${userId}`, DAY_MS);
      return rec.count <= MINUTES_PER_DAY;
    } catch (err) {
      // Fails open like the middleware it mirrors — the hard timers below are
      // what actually bound the damage.
      console.error("voice: minute meter unavailable:", err.message);
      return true;
    }
  }

  async function minutesLeft(userId) {
    try {
      // hit() has no read-only mode, so derive from the last known charge
      // rather than incrementing to find out.
      const s = [..._sessions.values()].find(x => x.userId === userId);
      return s ? Math.max(0, MINUTES_PER_DAY - s.minutesCharged) : MINUTES_PER_DAY;
    } catch (_) {
      return MINUTES_PER_DAY;
    }
  }

  function endSession(id, reason) {
    const s = _sessions.get(id);
    if (!s) return;
    clearTimeout(s.hardTimer);
    clearTimeout(s.idleTimer);
    clearInterval(s.minuteTimer);
    try { s.ws.close(); } catch (_) { /* already closing */ }
    _sessions.delete(id);

    const dur = Math.round((Date.now() - s.startedAt) / 1000);
    // Wall clock, not tokens: under BYOM the usage field carries audio tokens
    // only and Claude's are never reported here. Ground truth for spend is
    // Azure Cost Management, filtered on the session metadata. This line is
    // observability, not a bill.
    console.log(
      `  🎙 voice: user=${String(s.userId).slice(0, 8)} dur=${dur}s turns=${s.turns} ` +
      `tools=${s.toolCalls} charged=${s.minutesCharged}min end=${reason}`
    );

    // Written once, at the end. Per-turn writes during a live call add latency
    // and failure modes and buy nothing; the cost is that a hard crash loses
    // the transcript, which is worth saying out loud rather than hiding.
    const messages = toConversationMessages(s.transcript);
    if (!messages.length) return;
    const first = messages.find(m => m.role === "user");
    const now = new Date().toISOString();
    conversations.create({
      id: crypto.randomUUID(),
      userId: s.userId,
      title: ("🎙 " + (first ? first.content : "Voice call")).slice(0, 120),
      chart: s.chart,        // the SERVER's chart, so continuing in text inherits the grounding
      input: s.chart.input || null,
      match: null,
      messages,
      createdAt: now,
      updatedAt: now
    }).catch(err => console.error("voice: could not save transcript:", err.message));
  }

  function armTimers(s) {
    // Three timers because they catch three different failures. All unref'd,
    // matching the cleanup intervals in auth.js.
    s.hardTimer = setTimeout(() => endSession(s.id, "max-duration"), MAX_SESSION_SEC * 1000).unref();
    s.minuteTimer = setInterval(async () => {
      s.minutesCharged++;
      if (!(await chargeMinute(s.userId))) endSession(s.id, "budget");
    }, 60_000).unref();
    bumpIdle(s);
  }

  function bumpIdle(s) {
    clearTimeout(s.idleTimer);
    // Catches a tab closed without /end — otherwise a metered session runs on.
    s.idleTimer = setTimeout(() => endSession(s.id, "idle"), IDLE_SEC * 1000).unref();
  }

  /** Open the upstream control socket and exchange SDP. Resolves to the answer. */
  function connectUpstream(s, sdpOffer) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(signallingUrl());
      s.ws = ws;
      const settle = setTimeout(() => reject(new Error("no sdp answer in 20s")), 20_000);

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({
          type: "rtc.call.sdp.create",
          sdp_offer: sdpOffer,
          session: buildSessionConfig({
            chart: s.chart,
            voice: s.voice,
            sessionId: s.id,
            // Hashed: this lands in Microsoft's resource logs.
            userHash: crypto.createHash("sha256").update(String(s.userId)).digest("hex").slice(0, 16)
          })
        }));
      });

      ws.addEventListener("message", ev => {
        // Wrapped, because a throw here becomes an unhandled rejection that
        // index.js only logs — and the call would hang forever with the model
        // waiting on a tool result that never comes.
        try {
          const evt = JSON.parse(ev.data);
          bumpIdle(s);

          // VOICE_DEBUG=true prints every control frame, which is the only way
          // to tell "the model never answered" from "the service rejected the
          // session". Off by default: these frames carry transcripts of what a
          // caller actually said, and that does not belong in a server log.
          if (DEBUG) {
            const line = JSON.stringify(evt);
            console.log(`  ‹voice› ${evt.type} ${line.length > 220 ? line.slice(0, 220) + "…" : line}`);
          }

          switch (evt.type) {
            case "rtc.call.sdp.created":
            case "rtc.call.sdp.answer":
              clearTimeout(settle);
              resolve(evt.sdp_answer || evt.sdp || evt.answer);
              break;

            case "conversation.item.input_audio_transcription.completed":
              s.turns++;
              s.transcript.push({ role: "user", itemId: evt.item_id, transcript: evt.transcript });
              break;

            case "response.audio_transcript.done":
              s.transcript.push({ role: "assistant", itemId: evt.item_id, transcript: evt.transcript });
              break;

            case "rtc.call.error":
            case "error":
              console.error("voice: upstream error:", JSON.stringify(evt.error || evt).slice(0, 300));
              clearTimeout(settle);
              reject(new Error("upstream refused the call"));
              break;

            default: {
              // The docs disagree about which event carries a tool call on the
              // control channel, so handle both and dedupe by call_id.
              const isCall =
                evt.type === "response.function_call_arguments.done" ||
                (evt.type === "response.output_item.done" && evt.item && evt.item.type === "function_call");
              if (!isCall) break;

              const item = evt.item || evt;
              const callId = item.call_id || evt.call_id;
              if (!callId || s.seenCalls.has(callId)) break;
              s.seenCalls.add(callId);

              // A model looping on a tool it cannot satisfy would burn the budget.
              if (++s.toolCalls > 30) break;

              const output = handleToolCall(s.chart, item.name || evt.name, item.arguments ?? evt.arguments);
              ws.send(JSON.stringify({
                type: "conversation.item.create",
                item: { type: "function_call_output", call_id: callId, output }
              }));
              ws.send(JSON.stringify({ type: "response.create" }));
            }
          }
        } catch (err) {
          console.error("voice: control handler threw:", err);
        }
      });

      ws.addEventListener("close", () => {
        clearTimeout(settle);
        if (_sessions.has(s.id)) endSession(s.id, "upstream-closed");
        reject(new Error("control socket closed"));
      });
      ws.addEventListener("error", () => { /* close follows, handled there */ });
    });
  }

  /**
   * Every refusal, and the chart load, BEFORE a single minute is charged.
   *
   * This ordering is the point. With the budget middleware in front, a request
   * with no SDP — or from someone who never saved their birth details — spent a
   * paid minute to be told 400. Nothing here costs anything, so all of it runs
   * first and the meter only sees requests that were going to become a call.
   *
   * Nothing below may echo the instructions, the chart text, the API key or the
   * Azure URL. A test asserts that on every error path.
   */
  async function preflight(req, res, next) {
    if (!configured()) {
      return res.status(503).json({ error: "Voice calls aren't switched on." });
    }
    if (typeof WebSocket === "undefined") {
      console.error("voice: this Node has no global WebSocket (needs >= 22)");
      return res.status(503).json({ error: "Voice calls aren't available on this server." });
    }
    if (!allowed(req.userId)) {
      return res.status(503).json({ error: "Voice calls aren't open to your account yet." });
    }

    const { sdp, personId } = req.body || {};
    if (!sdp || typeof sdp !== "string") {
      return res.status(400).json({ error: "Missing the connection offer." });
    }

    // Fail-closed, no store involved: the backstop behind the budget, and the
    // reason a store outage can only leak MAX_CONCURRENT × MAX_SESSION_SEC.
    if (_sessions.size >= MAX_CONCURRENT) {
      return res.status(503).json({ error: "Too many calls in progress. Try again shortly." });
    }
    if (countFor(req.userId) >= 1) {
      return res.status(409).json({ error: "You're already on a call." });
    }

    // THE GUARDRAIL. The chart is loaded here, from the store, for this user —
    // never accepted from the request. The instructions are built from it and
    // the client never sees nor supplies them.
    let chart = null;
    try {
      if (personId) {
        const list = await people.forUser(req.userId);
        const p = list.find(x => x.id === personId);
        if (p) chart = chartFromBirth(p);
      } else {
        const u = await users.findById(req.userId);
        if (u) chart = chartFromBirth(u.birth);
      }
    } catch (err) {
      console.error("voice: chart load failed:", err.message);
    }
    if (!chart) {
      // An ungrounded call is the exact failure this feature exists to prevent.
      return res.status(503).json({ error: "Save your birth details first, then we can talk." });
    }

    req.voiceChart = chart;
    next();
  }

  app.post("/api/voice/session", startBurst, preflight, minuteBudget, async (req, res) => {
    const { sdp, voice } = req.body || {};
    const chart = req.voiceChart;

    const s = {
      id: crypto.randomUUID(),
      userId: req.userId,
      chart,
      voice: resolveVoice(voice),
      ws: null,
      startedAt: Date.now(),
      minutesCharged: 1,   // minuteBudget above already charged minute zero
      transcript: [],
      seenCalls: new Set(),
      turns: 0,
      toolCalls: 0
    };
    _sessions.set(s.id, s);

    try {
      const sdpAnswer = await connectUpstream(s, sdp);
      armTimers(s);
      res.json({
        sessionId: s.id,
        sdpAnswer,
        maxSeconds: MAX_SESSION_SEC,
        heartbeatSeconds: Math.max(5, Math.floor(IDLE_SEC / 3)),
        minutesLeft: Math.max(0, MINUTES_PER_DAY - s.minutesCharged)
      });
    } catch (err) {
      endSession(s.id, "connect-failed");
      console.error("voice: could not start call:", err.message);
      res.status(502).json({ error: "Couldn't connect the call. Please try again." });
    }
  });

  app.post("/api/voice/session/:id/heartbeat", async (req, res) => {
    const s = _sessions.get(req.params.id);
    if (!s || s.userId !== req.userId) return res.status(404).json({ ended: true, reason: "gone" });
    bumpIdle(s);
    const elapsed = Math.round((Date.now() - s.startedAt) / 1000);
    res.json({
      ok: true,
      secondsLeft: Math.max(0, MAX_SESSION_SEC - elapsed),
      minutesLeft: Math.max(0, MINUTES_PER_DAY - s.minutesCharged)
    });
  });

  app.post("/api/voice/session/:id/end", async (req, res) => {
    const s = _sessions.get(req.params.id);
    if (!s || s.userId !== req.userId) return res.json({ ok: true });
    endSession(s.id, "user");
    res.json({ ok: true });
  });
}

module.exports = {
  ENABLED,
  API_VERSION,
  PROFILE,
  VOICES,
  DEFAULT_VOICE,
  VOICE_TOOL,
  MAX_INSTRUCTION_BYTES,
  MINUTES_PER_DAY,
  MAX_SESSION_SEC,
  IDLE_SEC,
  MAX_CONCURRENT,
  resolveVoice,
  handleToolCall,
  voiceInstructions,
  buildSessionConfig,
  toConversationMessages,
  signallingUrl,
  configured,
  isAllowed,
  routes,
  _sessions
};
