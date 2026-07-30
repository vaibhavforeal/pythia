// Prints a real chat reply in both voice modes, side by side.
//
// ⚠ THIS MAKES TWO REAL, BILLABLE MODEL CALLS. It is deliberately not part of
// `npm test` — the suite must stay free and offline. Run it by hand after
// touching VOICE_NOTE, NERD_NOTE, BEHAVIOUR_NOTE or the skill markdown:
//
//     node tools/voice-check.js
//     node tools/voice-check.js "should i take this job?"
//
// Why it exists: a prompt change is the one kind of change the test suite
// cannot judge. Tests can prove the flag is plumbed through; only reading the
// output tells you whether the register actually moved. The jargon counter at
// the bottom is a rough regression signal — if the casual number creeps up
// toward the nerd number, the voice instruction has stopped biting.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 39777;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-voice-"));
const QUESTION = process.argv[2] || "what's my career going to look like?";

// A fixed chart, so reruns differ only by the prompt. Bengaluru, 2004.
const BIRTH = {
  year: 2004, month: 6, day: 14, hour: 9, minute: 20,
  lat: 12.9716, lon: 77.5946, tz: 5.5, name: "Test"
};

let cookie = "";

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json", Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function chat(chart, question, nerdMode) {
  const res = await fetch(BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Cookie: cookie },
    body: JSON.stringify({ messages: [{ role: "user", content: question }], chart, nerdMode })
  });
  if (res.status !== 200) throw new Error(`chat ${res.status}: ${await res.text()}`);
  // Decode as UTF-8 and buffer: an SSE frame can straddle two chunks, and
  // String(chunk) on a Uint8Array yields byte numbers rather than text.
  const dec = new TextDecoder();
  let out = "";
  let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const o = JSON.parse(line.slice(6));
      if (o.text) out += o.text;
      if (o.error) out += `\n[ERROR] ${o.error}`;
    }
  }
  return out.trim();
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server", "index.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, SESSION_SECRET: "voice-check" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  srv.stdout.on("data", d => (log += d));
  srv.stderr.on("data", d => (log += d));

  const done = () => {
    srv.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  };

  try {
    for (let i = 0; i < 80; i++) {
      try { await fetch(BASE + "/healthz"); break; } catch { await new Promise(r => setTimeout(r, 250)); }
    }

    const reg = await api("POST", "/api/auth/register",
      { email: "voice@example.com", password: "correct-horse-battery" });
    if (reg.status !== 200) throw new Error(`register: ${JSON.stringify(reg.json)}\n${log}`);

    const c = await api("POST", "/api/chart", BIRTH);
    if (c.status !== 200) throw new Error(`chart: ${JSON.stringify(c.json)}`);

    console.log(`\nQ: ${QUESTION}`);
    const casual = await chat(c.json, QUESTION, false);
    const nerd = await chat(c.json, QUESTION, true);

    console.log("\n=============== CASUAL (nerd mode off) ===============\n");
    console.log(casual);
    console.log("\n\n=============== NERD MODE ON =========================\n");
    console.log(nerd);

    // Rough signal, not a pass/fail: casual should be a small fraction of nerd.
    //
    // Counts references a reader with no astrology background would have to look
    // up. The first version of this missed the most common leak by far — plain
    // house references like "your 10th house" — and so scored a reply as clean
    // while it opened three paragraphs with one. If you widen this, re-baseline:
    // the numbers are only comparable within one version of the pattern.
    //
    // One run is a sample, not a measurement — model output varies between
    // identical calls. Compare configurations over several runs, not one.
    const JARGON = /\b(\d+(st|nd|rd|th)\s+(house|lord)|kendra|trikona|antar ?dasha|maha ?dasha|dasha|nakshatra|lagna|vargottama|varga|rashi|bhava|graha|drishti|navamsa|dasamsa|ayanamsa|exalt\w*|debilit\w*|conjunct\w*|yoga|dosha|manglik|sade ?sati|ascendant)\b/gi;
    const cj = (casual.match(JARGON) || []).length;
    const nj = (nerd.match(JARGON) || []).length;
    console.log(`\n\n---- jargon terms: casual=${cj}  nerd=${nj} ----`);
    if (cj > nj / 2) console.log("     ⚠ casual is drifting technical — check VOICE_NOTE still leads with meaning.");
  } finally {
    done();
  }
})().catch(e => { console.error(e); process.exit(1); });
