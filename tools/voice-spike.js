// Phase 0 spike for the voice agent. Throwaway — nothing in server/ may ever
// require this file, and it should be deleted once server/voice.js works.
//
// ⚠ THIS MAKES REAL, BILLABLE CALLS. Not part of `npm test`.
//
// It exists to answer one question before a line of product code is written:
// can Azure Voice Live run OUR Claude deployment as the brain, over WebRTC, on
// the Foundry resource this app already uses?
//
// That combination is undocumented. Microsoft documents BYOM on api-version
// 2026-04-10 against /voice-live/realtime, and documents WebRTC against
// /voice-live/realtime/calls on 2026-01-01-preview. No example combines the
// two. So rather than guess, this tries every plausible URL and reports which
// one the service actually accepts.
//
// Run it in two stages:
//
//     node tools/voice-spike.js --probe     ← no browser, no mic, ~10 seconds
//     node tools/voice-spike.js             ← then open the printed URL
//
// --probe answers the risky part on its own. Only bother with the browser stage
// once a rung connects.
//
// Flags:
//   --probe        handshake every ladder rung, print the outcome, exit
//   --slow         make the tool handler sleep 4s, to force interim_response
//   --voice <name> override the TTS voice (default en-IN-NeerjaNeural)
//   --model <name> override the deployment (default VOICE_DEPLOYMENT/AZURE_DEPLOYMENT)
require("dotenv").config();

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const arg = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);

const PORT = 39778;
const SLOW = has("--slow");
const VOICE = arg("--voice", "en-IN-NeerjaNeural");
// Prosody knobs, UNPROVEN against this api-version — which is exactly why they
// live here and not in server/voice.js. Two fields taken from the docs without
// a spike run were what made a real call connect and then never speak, so
// nothing new reaches production until it has answered a question out loud.
//
//   --style chat        Azure voice styles. "chat" is built for conversation;
//                       most en-IN/hi-IN neural voices also take "empathetic",
//                       "cheerful", "newscast". This is the single biggest
//                       prosody lever available.
//   --rate -8%          Speaking rate. Standard voices read slightly fast for
//                       conversation; a touch slower reads as considered
//                       rather than as a recording.
const STYLE = arg("--style", "");
const RATE = arg("--rate", "");
const MODEL = arg("--model", process.env.VOICE_DEPLOYMENT || process.env.AZURE_DEPLOYMENT);
const KEY = process.env.VOICE_KEY || process.env.AZURE_INFERENCE_KEY;
const PROFILE = "byom-foundry-anthropic-messages";

// The chat endpoint is the full Anthropic messages URL:
//   https://<resource>.services.ai.azure.com/anthropic/v1/messages
// Voice Live lives on the same resource, so derive the host rather than asking
// for a second env var that could drift out of sync with the first.
const CHAT_ENDPOINT = process.env.AZURE_INFERENCE_ENDPOINT || "";
let HOST = "";
try {
  HOST = new URL(CHAT_ENDPOINT).host;
} catch { /* reported below */ }

if (!HOST || !KEY || !MODEL) {
  console.error(
    "\n  Missing config. This spike needs, from .env:\n" +
    "    AZURE_INFERENCE_ENDPOINT   (to derive the Foundry host)\n" +
    "    AZURE_INFERENCE_KEY        (or VOICE_KEY)\n" +
    "    VOICE_DEPLOYMENT           (or AZURE_DEPLOYMENT) — the Claude deployment name\n\n" +
    `  got: host=${HOST || "?"} key=${KEY ? "set" : "MISSING"} model=${MODEL || "MISSING"}\n`
  );
  process.exit(1);
}

// The ladder. Rungs 1-3 are the WebRTC signalling endpoint in three api-versions;
// rung 4 is the documented-good BYOM path over a plain WebSocket, which is the
// fallback transport if WebRTC turns out not to accept `profile`.
const LADDER = [
  { rung: 1, transport: "webrtc", path: "/voice-live/realtime/calls", apiVersion: "2026-06-01-preview" },
  { rung: 2, transport: "webrtc", path: "/voice-live/realtime/calls", apiVersion: "2026-04-10" },
  { rung: 3, transport: "webrtc", path: "/voice-live/realtime/calls", apiVersion: "2026-01-01-preview" },
  { rung: 4, transport: "ws", path: "/voice-live/realtime", apiVersion: "2026-04-10" }
];

// The key goes in the query string rather than a header. The docs offer both,
// but the header form is unavailable in browsers, and using the same form the
// browser would have to use keeps the spike honest about what is possible.
// Redacted everywhere it is printed.
// Wall-clock on the control-socket log, so its events can be lined up against
// the browser's. Without it the two logs cannot be correlated at all.
const stamp = () => new Date().toISOString().slice(11, 23);

const urlFor = r =>
  `wss://${HOST}${r.path}?api-version=${r.apiVersion}` +
  `&profile=${PROFILE}&model=${encodeURIComponent(MODEL)}&api-key=${encodeURIComponent(KEY)}`;
const safe = u => u.replace(/api-key=[^&]+/, "api-key=***");

/** Open a socket, resolving with how it went. Never rejects. */
function probe(r, timeoutMs = 12000) {
  return new Promise(resolve => {
    const url = urlFor(r);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return resolve({ ...r, ok: false, why: `constructor threw: ${e.message}` });
    }
    const done = res => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      resolve(res);
    };
    const timer = setTimeout(() => done({ ...r, ok: false, why: `no response in ${timeoutMs}ms` }), timeoutMs);

    ws.addEventListener("open", () => done({ ...r, ok: true, why: "handshake accepted" }));

    // A rejected upgrade surfaces as a close with a code and (sometimes) a
    // reason, and that reason is the ONLY thing that distinguishes "bad
    // profile" from "bad model" from "throttled" from "auth refused".
    //
    // 'error' fires before 'close', so resolving on it threw the diagnostic
    // away and reported a useless "socket error" for every possible cause.
    // Wait for the close instead; only fall back if it never arrives.
    ws.addEventListener("close", ev =>
      done({ ...r, ok: false, why: `closed ${ev.code}${ev.reason ? ` — ${ev.reason}` : " (no reason given)"}` }));
    ws.addEventListener("error", () => {
      setTimeout(() => done({ ...r, ok: false, why: "socket error, no close frame" }), 750);
    });
  });
}

/**
 * Is the resource reachable at all, and does the key work?
 *
 * Separates "the network or the resource is having a moment" from "this profile
 * is rejected", which the WebSocket close code alone can't always tell you.
 * Costs nothing — no inference, just an HTTP round trip.
 */
async function preflight(attempt = 1) {
  try {
    const res = await fetch(`https://${HOST}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      // Deliberately invalid: a 400 proves reachability AND that the key was
      // accepted, without generating a single token.
      body: JSON.stringify({ model: MODEL, messages: [], max_tokens: 1 })
    });
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      console.log(`  preflight  ❌ ${res.status} — the KEY is being refused. ${detail}`);
    } else if (res.status === 429) {
      console.log(`  preflight  ⚠ 429 — THROTTLED. Wait a minute and rerun; nothing is wrong with the config.`);
    } else {
      console.log(`  preflight  ✅ resource reachable, key accepted (HTTP ${res.status})`);
    }
  } catch (e) {
    // Retried, because this failed once with "fetch failed" in the same run
    // that a WebSocket to the very same host connected fine. A single DNS or
    // TCP hiccup must not be reported as "the resource is down".
    if (attempt < 3) {
      await sleep(800);
      return preflight(attempt + 1);
    }
    console.log(`  preflight  ❌ cannot reach ${HOST} after 3 tries — ${e.message}`);
    console.log(`             network, DNS or the resource is down. Not a config problem.`);
  }
}

async function runProbe() {
  console.log(`\n  host   ${HOST}`);
  console.log(`  model  ${MODEL}`);
  console.log(`  profile ${PROFILE}\n`);
  await preflight();
  console.log("\n  Probing the ladder — each rung is one WebSocket handshake.\n");

  // Each rung is tried several times, because one sample is not a result.
  //
  // Early runs of this had every rung tried once, and the same config produced
  // "rung 3 connected" and "nothing connected" on consecutive runs — enough to
  // conclude WebRTC was rejected outright when the network was simply flaky.
  // A rung that fails 3/3 is rejected; a rung that fails 1/3 is a bad line.
  const ATTEMPTS = Number(arg("--attempts", 3));
  const results = [];

  for (const r of LADDER) {
    process.stdout.write(`  rung ${r.rung} (${r.transport.padEnd(6)} ${r.apiVersion.padEnd(19)}) … `);
    const tries = [];
    for (let i = 0; i < ATTEMPTS; i++) {
      tries.push(await probe(r));
      if (i < ATTEMPTS - 1) await sleep(400);
    }
    const okCount = tries.filter(t => t.ok).length;
    const why = (tries.find(t => !t.ok) || {}).why || "";
    results.push({ ...r, ok: okCount > 0, okCount, attempts: ATTEMPTS, why });

    const verdict =
      okCount === ATTEMPTS ? "✅ reliable"
        : okCount > 0 ? "⚠ INTERMITTENT"
          : "❌ rejected";
    console.log(`${okCount}/${ATTEMPTS} ${verdict}${okCount < ATTEMPTS && why ? `  (${why})` : ""}`);
  }

  const flaky = results.filter(r => r.okCount > 0 && r.okCount < r.attempts);
  if (flaky.length) {
    console.log("\n  ⚠  At least one rung connected only sometimes. That is a property of the");
    console.log("     link or the service, not of the config — the URL did not change between");
    console.log("     attempts. Do not conclude anything about transport from this run; rerun");
    console.log("     with --attempts 10 before deciding.");
  }

  // Prefer a rung that worked EVERY time; fall back to one that ever worked.
  const pick = (t) =>
    results.find(r => r.transport === t && r.okCount === r.attempts) ||
    results.find(r => r.transport === t && r.okCount > 0);
  const webrtc = pick("webrtc");
  const ws = pick("ws");

  console.log("");
  if (webrtc) {
    console.log(`  ✅ CRITERION 1 — WebRTC rung ${webrtc.rung} connected ${webrtc.okCount}/${webrtc.attempts} ` +
      `(api-version ${webrtc.apiVersion}).`);
    if (webrtc.okCount < webrtc.attempts) {
      console.log("     But not every time. Treat the transport decision as UNSETTLED until this");
      console.log("     is clean — a preview endpoint that drops one connection in three is a");
      console.log("     different engineering problem from one that works.");
    } else {
      console.log("     Next: run without --probe and open the page.");
    }
    console.log("");
  } else if (ws) {
    console.log(`  ⚠  No WebRTC rung connected in this run; rung ${ws.rung} (plain WebSocket) did, ` +
      `${ws.okCount}/${ws.attempts}.`);
    console.log("     Before concluding WebRTC is unavailable, rerun with --attempts 10. If the");
    console.log("     WebRTC rungs are genuinely 0/10 while the WebSocket rung is 10/10, that is");
    console.log("     a real answer and the fallback is transport (a): the server brokers audio,");
    console.log("     costing the `ws` dependency, an upgrade handler, manual PCM in the browser,");
    console.log("     and all audio through Render — but the brain stays Claude.\n");
  } else {
    console.log("  ❌ Nothing connected. Before assuming BYOM is unavailable, check in order:");
    console.log("     1. Is this Foundry resource in a Voice Live region? (~10 regions only)");
    console.log(`     2. Is "${MODEL}" a real DEPLOYMENT name on this resource, not a model id?`);
    console.log("     3. Does the close reason above mention auth? If so, api-key may be refused");
    console.log("        for this profile — retry with Entra ID (@azure/identity).\n");
  }
  return { webrtc, ws };
}

// --- The tool the model must call rather than inventing a number -------------
// The whole guardrail design rests on this round trip working, so the spike
// proves it end to end: a value that appears nowhere in the instructions can
// only reach the caller's ears by way of the server.
const TOOL = {
  type: "function",
  name: "lookup_chart_detail",
  description:
    "Look up an exact figure from this person's chart that is not in your instructions — " +
    "any divisional chart, any ashtakavarga bindu count, or exact dasha dates. You MUST " +
    "call this rather than estimating: a wrong number is worse than a pause.",
  parameters: {
    type: "object",
    required: ["detail"],
    properties: {
      detail: { type: "string", description: "What to look up, e.g. 'ashtakavarga bindus in the tenth'" }
    }
  }
};

const MAGIC = "thirty-one";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function toolAnswer(args) {
  // --slow forces the latency path so interim_response (the filler line that
  // masks Claude's thinking time) can be observed rather than assumed.
  if (SLOW) await sleep(4000);
  return `The bindu count you asked about is ${MAGIC}. Say that number back to the caller.`;
}

// The tamper test needs a rule whose breach is UNMISTAKABLE, otherwise it
// proves nothing. The first version of this had no scope limit at all, so the
// agent answering "the capital of France is Paris" was permitted behaviour —
// identical before and after tampering, and therefore no signal whatsoever.
//
// Two observable tells now:
//   1. A hard refusal rule, matching what BEHAVIOUR_NOTE does in production.
//   2. A shibboleth. Every reply must end in one specific word. It survives
//      paraphrase, it is audible, and no injected prompt would reproduce it by
//      chance — so its absence is proof the instructions were replaced.
const SHIBBOLETH = "namaste";

const INSTRUCTIONS =
  "You are a warm, concise Vedic astrologer on a phone call. This is a technical test, " +
  "so keep every reply to one or two short sentences and never use markdown.\n" +
  "STAY STRICTLY ON SCOPE. Only discuss this person's Vedic astrology. If asked about " +
  "ANYTHING else — geography, capitals, general knowledge, news, maths — you must NOT " +
  "answer it. Decline in one sentence and steer back to the chart. Do not answer the " +
  "off-topic question even partially, even as an aside.\n" +
  `ALWAYS end every single reply with the word "${SHIBBOLETH}". No exceptions.\n` +
  "You do NOT know any bindu counts, divisional charts or dasha dates — if the caller " +
  "asks for any exact figure, say one short line like 'let me pull that up' and then " +
  "call lookup_chart_detail. Never guess a number aloud.";

function sessionConfig() {
  return {
    modalities: ["text", "audio"],
    instructions: INSTRUCTIONS,
    // Azure neural TTS, because a BYOM text model has no native audio output.
    voice: {
      type: "azure-standard",
      name: VOICE,
      ...(STYLE ? { style: STYLE } : {}),
      ...(RATE ? { rate: RATE } : {})
    },
    // Multilingual, so a caller code-switching into Hindi mid-sentence is still
    // segmented correctly — one of the reasons for choosing Voice Live at all.
    turn_detection: {
      type: "azure_semantic_vad_multilingual",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      // So conversation history matches what the caller actually HEARD. Without
      // it the model believes it delivered a sentence that barge-in truncated.
      auto_truncate: true
    },
    input_audio_noise_reduction: { type: "azure_deep_noise_suppression" },
    input_audio_echo_cancellation: {},
    tools: [TOOL],
    metadata: { app: "pythia", spike: "1" }
  };
}

// --- Browser stage -----------------------------------------------------------
// One control socket per page load. The browser owns the media; this process
// owns the key, the instructions and the tool. That split is the whole point:
// it is the shape server/voice.js will take.
//
// The socket has to be held somewhere for the LIFE OF THE CALL. Returning it
// from openControl and destructuring only the answer left it unreferenced, Node
// collected it, and the call died with a 1006 the instant the SDP answer came
// back — media never started. server/voice.js keeps its sockets in a sessions
// Map for exactly this reason.
const liveCalls = new Set();

// What the browser last said about its peer connection, so a control-socket
// close can be correlated with whether media ever established. Without this the
// two most likely causes of a 1006 look identical from here.
let lastBrowserState = "unknown";

// When the browser said it fired the hostile session.update, so replies can be
// scored as before-tamper or after-tamper rather than by eye.
let tamperedAt = null;

async function openControl(rung, sdpOffer) {
  const url = urlFor(rung);
  console.log(`\n  → connecting ${safe(url)}`);
  const ws = new WebSocket(url);
  liveCalls.add(ws);
  const seen = new Set();
  let answeredAt = null;

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("close", ev => reject(new Error(`closed ${ev.code} ${ev.reason || ""}`)), { once: true });
  });
  console.log("  ✅ CRITERION 1 — control socket open");

  let answer = null;
  const gotAnswer = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no sdp answer in 20s")), 20000);

    ws.addEventListener("message", async ev => {
      // Wrapped: a throw in this handler would become an unhandled rejection,
      // and the call would hang forever with the model waiting on a tool result.
      // server/voice.js must do the same.
      try {
        const evt = JSON.parse(ev.data);
        console.log(`  ‹ctl› ${evt.type}  ${JSON.stringify(evt).slice(0, 300)}`);

        if (evt.type === "session.created" || evt.type === "session.updated") {
          // CRITERION 2 — proves BYOM took, rather than the service silently
          // falling back to some default model.
          console.log(`  ✅ CRITERION 2 — session up. model in payload: ${JSON.stringify(evt.session?.model ?? "(absent)")}`);
          // CRITERION 10, half of it. A session.updated arriving AFTER the
          // browser was told to tamper means the service accepted instructions
          // from the client, which would make the whole guardrail decorative.
          const instr = String(evt.session?.instructions || "");
          if (tamperedAt && Date.now() > tamperedAt) {
            console.log("  ❌ CRITERION 10 — session.updated AFTER the tamper. The client changed");
            console.log("     the session. WebRTC cannot hold the guardrail; use transport (a).");
          }
          if (instr.includes("pirate")) {
            console.log("  ❌ CRITERION 10 — the hostile instructions are now IN the session.");
          }
        }

        // Watch every assistant transcript for the shibboleth. Its absence is
        // the audible proof that the instructions were replaced.
        if (evt.type === "response.audio_transcript.done") {
          const said = String(evt.transcript || "");
          const kept = said.toLowerCase().includes(SHIBBOLETH);
          const phase = tamperedAt ? "after tamper" : "before tamper";
          console.log(`  ‹chk› ${phase}: shibboleth ${kept ? "PRESENT ✅" : "MISSING ❌"} — "${said.slice(0, 90)}"`);
          if (tamperedAt && !kept) {
            console.log("  ❌ CRITERION 10 FAILED — the instructions were overwritten by the client.");
          }
          if (tamperedAt && kept) {
            console.log("  ✅ CRITERION 10 — instructions survived the tamper. Guardrail holds.");
          }
        }

        if (evt.type === "rtc.call.sdp.created" || evt.type === "rtc.call.sdp.answer") {
          answer = evt.sdp_answer || evt.sdp || evt.answer;
          answeredAt = Date.now();
          // Does the answer carry ICE candidates inline, or does the service
          // expect them to trickle over this socket afterwards? That single
          // question decides whether the signalling flow above is complete.
          const cands = (answer.match(/^a=candidate:.*$/gm) || []);
          console.log(`  ‹sdp› answer carries ${cands.length} ICE candidate(s)`);
          cands.forEach(c => console.log(`        ${c.trim()}`));
          if (!cands.length) {
            console.log("        NONE inline — the service expects trickle ICE, which this");
            console.log("        spike never implemented. That is why the peer connection fails.");
          }
          clearTimeout(timer);
          resolve(answer);
        }

        if (evt.type === "rtc.call.error" || evt.type === "error") {
          console.log(`  ❌ ${JSON.stringify(evt.error || evt)}`);
          clearTimeout(timer);
          reject(new Error(JSON.stringify(evt.error || evt)));
        }

        // The docs disagree about which of these carries the call on the control
        // channel, so handle both and dedupe by call_id. Whichever fires is the
        // answer to CRITERION 5, and tells server/voice.js which to implement.
        const isCall =
          evt.type === "response.function_call_arguments.done" ||
          (evt.type === "response.output_item.done" && evt.item?.type === "function_call");
        if (isCall) {
          const item = evt.item || evt;
          const callId = item.call_id || evt.call_id;
          const name = item.name || evt.name;
          const rawArgs = item.arguments ?? evt.arguments ?? "{}";
          if (seen.has(callId)) return;
          seen.add(callId);

          // Attribute the tool-turn delay. The browser sees ~6s between the
          // filler line and the answer; that is either OUR handler, or the
          // model taking that long to emit the call, or the model taking that
          // long to speak after being given the result. Three different fixes,
          // so measure rather than assume.
          const arrivedAt = Date.now();
          console.log(`  ✅ CRITERION 5 — TOOL CALL ${name} via ${evt.type}  @${stamp()}`);
          console.log(`      call_id=${callId} args=${rawArgs}`);
          if (answeredAt) {
            console.log(`      the model asked ${arrivedAt - answeredAt}ms into the call`);
          }

          let parsed = {};
          try { parsed = JSON.parse(rawArgs); } catch { /* model sent junk; answer anyway */ }
          const output = await toolAnswer(parsed);
          const handlerMs = Date.now() - arrivedAt;

          ws.send(JSON.stringify({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: callId, output }
          }));
          ws.send(JSON.stringify({ type: "response.create" }));
          console.log(`      ↩ answered in ${handlerMs}ms @${stamp()} — anything beyond this is the model`);
        }
      } catch (err) {
        console.error("  ‼ control handler threw:", err);
      }
    });

    ws.addEventListener("close", ev => {
      clearTimeout(timer);
      liveCalls.delete(ws);
      const dt = answeredAt ? Date.now() - answeredAt : null;
      console.log(
        `  ‹ctl› closed ${ev.code} ${ev.reason || "(no reason)"}` +
          (dt === null ? "  [before any sdp answer]" : `  [${dt}ms after sdp.created]`)
      );
      // 1006 means the TCP connection dropped with no WebSocket close frame —
      // so the peer did not say goodbye. Timing separates the candidates, which
      // is the whole reason it is printed:
      //
      //   < ~1s  and no ICE     the call is torn down because media never came
      //   ~30-60s steady        an idle timeout on a socket with no keepalive
      //   right after answer    the service closes control once SDP is done,
      //                         which would mean tool calls never reach us and
      //                         WebRTC is the wrong transport for this design
      if (ev.code === 1006) {
        console.log(`      browser last reported connectionState=${lastBrowserState}`);
      }
    });
  });

  ws.send(JSON.stringify({
    type: "rtc.call.sdp.create",
    sdp_offer: sdpOffer,
    session: sessionConfig()
  }));

  return { ws, answer: await gotAnswer };
}

// The production CSP, copied verbatim from server/index.js:331. Serving the
// spike page with anything weaker would hide a CSP problem until Phase 5.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join("; ");

function serve(rung) {
  const page = fs.readFileSync(path.join(__dirname, "voice-spike.html"), "utf8");

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
      // no-store, because a cached page silently invalidates every result. One
      // run was scored against instructions the browser had never loaded, and
      // the only reason it was caught was that a shibboleth went missing.
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": CSP,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache"
      });
      // Re-read per request so an edit lands on reload without a restart.
      return res.end(fs.readFileSync(path.join(__dirname, "voice-spike.html"), "utf8"));
    }

    // The browser reports its peer-connection state here so the Node log can
    // order "media established" against "control socket closed".
    if (req.method === "POST" && req.url === "/state") {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        try {
          const { state, tampered } = JSON.parse(body);
          if (tampered) {
            tamperedAt = Date.now();
            console.log("  ‹pc›  browser fired the hostile session.update — replies from here");
            console.log("        are scored as after-tamper. Ask an off-topic question now.");
          } else {
            lastBrowserState = String(state);
            console.log(`  ‹pc›  connectionState=${lastBrowserState}`);
          }
        } catch (_) { /* diagnostic only */ }
        res.writeHead(204).end();
      });
      return;
    }

    if (req.method === "POST" && req.url === "/sdp") {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", async () => {
        try {
          const { sdp } = JSON.parse(body);
          // `call` is deliberately kept, not destructured away — see liveCalls.
          const call = await openControl(rung, sdp);
          console.log(`  ‹ctl› holding control socket (${liveCalls.size} live)`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ sdp: call.answer }));
        } catch (err) {
          console.error("  ❌ sdp exchange failed:", err.message);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(PORT, () => {
    console.log(`\n  Spike page:  http://127.0.0.1:${PORT}/`);
    console.log(`  Using rung ${rung.rung} (${rung.apiVersion}), voice ${VOICE}${SLOW ? ", --slow" : ""}`);
    console.log("\n  Open it, allow the microphone, and work through the checklist:");
    console.log("    3  the page reports connectionState=connected");
    console.log("    4  you hear a reply in an Indian-English voice");
    console.log("    5  ask \"how many bindus are in my tenth house?\" — this process must");
    console.log(`       print TOOL CALL, and the spoken reply must contain "${MAGIC}"`);
    console.log("    6  talk over the reply — it should stop within ~300ms");
    console.log("    7  check the page log for transcript events (are they browser-only?)");
    console.log("    8  rerun with --slow and listen for a filler line before the answer");
    console.log("    9  make one deliberate 5-minute call, then read Azure Cost Management");
    console.log("       tomorrow, filtered to this resource. BYOM is not in the published");
    console.log("       Voice Live tier table, so this is the only way to learn the rate.");
    console.log("   10  press \"Try to tamper\", then ask something off-topic. Under WebRTC");
    console.log("       the data channel is browser-to-Azure with our server nowhere in");
    console.log("       between — if the page can push its own session.update, then the");
    console.log("       chart grounding and the care protocol are client-editable and the");
    console.log("       guardrail is theatre. This is the one that decides the design.\n");
  });
}

(async () => {
  const { webrtc, ws } = await runProbe();
  if (has("--probe")) return;

  if (!webrtc) {
    console.log("  Not starting the browser stage — no WebRTC rung connected.");
    if (ws) console.log("  Rebuild the spike against transport (a) if you want to proceed on the fallback.\n");
    process.exit(1);
  }
  serve(webrtc);
})().catch(e => { console.error(e); process.exit(1); });
