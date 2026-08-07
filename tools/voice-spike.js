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
    // reason — that reason is the single most useful diagnostic here, because
    // it distinguishes "bad profile" from "bad model" from "bad api-version".
    ws.addEventListener("close", ev =>
      done({ ...r, ok: false, why: `closed ${ev.code}${ev.reason ? ` — ${ev.reason}` : ""}` }));
    ws.addEventListener("error", () =>
      done({ ...r, ok: false, why: "socket error (see close code above, if any)" }));
  });
}

async function runProbe() {
  console.log(`\n  host   ${HOST}`);
  console.log(`  model  ${MODEL}`);
  console.log(`  profile ${PROFILE}\n`);
  console.log("  Probing the ladder — each rung is one WebSocket handshake.\n");

  const results = [];
  for (const r of LADDER) {
    process.stdout.write(`  rung ${r.rung} (${r.transport.padEnd(6)} ${r.apiVersion.padEnd(19)}) … `);
    const res = await probe(r);
    console.log(res.ok ? "✅ connected" : `❌ ${res.why}`);
    results.push(res);
  }

  const webrtc = results.find(r => r.ok && r.transport === "webrtc");
  const ws = results.find(r => r.ok && r.transport === "ws");

  console.log("");
  if (webrtc) {
    console.log(`  ✅ CRITERION 1 — WebRTC rung ${webrtc.rung} connected (api-version ${webrtc.apiVersion}).`);
    console.log("     The planned architecture holds. Next: run without --probe and open the page.\n");
  } else if (ws) {
    console.log(`  ⚠  WebRTC rejected every api-version, but rung ${ws.rung} (plain WebSocket) works.`);
    console.log("     Fall back to transport (a): the server brokers audio. That costs the `ws`");
    console.log("     dependency, a server.on(\"upgrade\") handler, manual PCM capture/playback in");
    console.log("     the browser, and all audio through Render — but the brain stays Claude.\n");
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

const INSTRUCTIONS =
  "You are a warm, concise Vedic astrologer on a phone call. This is a technical test, " +
  "so keep every reply to one or two short sentences and never use markdown. " +
  "You do NOT know any bindu counts, divisional charts or dasha dates — if the caller " +
  "asks for any exact figure, say one short line like 'let me pull that up' and then " +
  "call lookup_chart_detail. Never guess a number aloud.";

function sessionConfig() {
  return {
    modalities: ["text", "audio"],
    instructions: INSTRUCTIONS,
    // Azure neural TTS, because a BYOM text model has no native audio output.
    voice: { type: "azure-standard", name: VOICE },
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
async function openControl(rung, sdpOffer) {
  const url = urlFor(rung);
  console.log(`\n  → connecting ${safe(url)}`);
  const ws = new WebSocket(url);
  const seen = new Set();

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
        }

        if (evt.type === "rtc.call.sdp.created" || evt.type === "rtc.call.sdp.answer") {
          answer = evt.sdp_answer || evt.sdp || evt.answer;
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

          console.log(`  ✅ CRITERION 5 — TOOL CALL ${name} via ${evt.type}`);
          console.log(`      call_id=${callId} args=${rawArgs}`);

          let parsed = {};
          try { parsed = JSON.parse(rawArgs); } catch { /* model sent junk; answer anyway */ }
          const output = await toolAnswer(parsed);

          ws.send(JSON.stringify({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: callId, output }
          }));
          ws.send(JSON.stringify({ type: "response.create" }));
          console.log(`      ↩ answered with "${MAGIC}" — listen for it in the reply`);
        }
      } catch (err) {
        console.error("  ‼ control handler threw:", err);
      }
    });

    ws.addEventListener("close", ev => {
      clearTimeout(timer);
      console.log(`  ‹ctl› closed ${ev.code} ${ev.reason || ""}`);
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
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP });
      return res.end(page);
    }

    if (req.method === "POST" && req.url === "/sdp") {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", async () => {
        try {
          const { sdp } = JSON.parse(body);
          const { answer } = await openControl(rung, sdp);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ sdp: answer }));
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
