require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");

const { computeChart, chartToText } = require("./astro");
const {
  computeGunaMilan, moonInputFromChart, computeManglik, manglikVerdict, matchToText
} = require("./gunamilan");
const { loadSkill } = require("./skill");
const { CITIES } = require("./cities");
const auth = require("./auth");
const store = require("./store");
const { users, people } = store;

// --- Azure AI Foundry config -------------------------------------------------
// Claude is served through Foundry's Anthropic-native Messages API. The chat
// handler POSTs the standard Anthropic Messages body straight to the endpoint.
// Set these in .env:
//   AZURE_INFERENCE_ENDPOINT  the full Anthropic messages URL, e.g.
//                             https://<resource>.services.ai.azure.com/anthropic/v1/messages
//   AZURE_INFERENCE_KEY       the endpoint key (sent as the `x-api-key` header)
//   AZURE_DEPLOYMENT          the deployed model name (e.g. your Claude deployment)
const ENDPOINT = process.env.AZURE_INFERENCE_ENDPOINT;
const API_KEY = process.env.AZURE_INFERENCE_KEY;
const MODEL = process.env.AZURE_DEPLOYMENT || process.env.ASTROMAN_MODEL || "claude-opus-4-8";
const PORT = process.env.PORT || 3030;

const SKILL_PROMPT = loadSkill();

const BEHAVIOUR_NOTE =
  "You are running inside a live chat application called Astroman. A birth chart " +
  "has already been computed for the user with the Swiss Ephemeris (Lahiri sidereal " +
  "ayanamsa) and is provided below — treat it as authoritative and DO NOT recompute " +
  "planetary positions, the ascendant, or the dasha. You may still compute numerology " +
  "from the birth date/name and reason about the given placements. Reply in GitHub-" +
  "flavoured Markdown (headings, bold, bullet lists, and tables render). Be warm and " +
  "conversational, answer what was actually asked first, then offer to go deeper.";

const MATCH_NOTE =
  "A compatibility check (Ashtakoot Guna Milan + Manglik/Mangal dosha) has also been " +
  "computed for this user and a prospective partner, and the partner's full chart is " +
  "provided below — all authoritative, do NOT recompute. When the user asks about the " +
  "relationship, marriage, or compatibility, ground your answer in these numbers (the kuta " +
  "scores, the total out of 36, the Nadi/Bhakoot dosha flags, and the Manglik verdict) and " +
  "explain what they mean together — warmly and honestly, without sugar-coating real doshas.";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// Public health check (for the hosting platform) — no auth, before the gate.
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// --- Auth gate --------------------------------------------------------------
// API responses are dynamic and auth-sensitive — never cache them (this also
// avoids 304 Not Modified responses, which carry no body for the client to read).
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Every /api route except /api/auth/* requires a valid session, and every
// mutating request must be same-origin. Static assets (the SPA shell) stay
// public so the login screen can load.
app.use("/api", auth.checkOrigin, (req, res, next) => {
  if (req.path.startsWith("/auth/")) return next();
  return auth.requireAuth(req, res, next);
});

app.post("/api/auth/register", auth.rateLimit, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const u = String(username || "").trim();
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(u)) {
      return res.status(400).json({ error: "Username must be 3–32 characters (letters, numbers, _ or -)." });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    if (await users.findByUsername(u)) return res.status(409).json({ error: "That username is taken." });
    const { salt, hash } = await auth.hashPassword(password);
    const user = await users.add({ id: crypto.randomUUID(), username: u, salt, hash, createdAt: new Date().toISOString() });
    auth.setSessionCookie(res, auth.makeSessionToken(user.id));
    res.json({ user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/auth/login", auth.rateLimit, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = await users.findByUsername(String(username || "").trim());
    const ok = user && (await auth.verifyPassword(String(password || ""), user.salt, user.hash));
    if (!ok) return res.status(401).json({ error: "Invalid username or password." });
    auth.setSessionCookie(res, auth.makeSessionToken(user.id));
    res.json({ user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const uid = auth.currentUserId(req);
    const user = uid ? await users.findById(uid) : null;
    if (!user) return res.status(401).json({ error: "Not authenticated." });
    res.json({ user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error("me error:", err);
    res.status(500).json({ error: "Lookup failed." });
  }
});

// --- Saved people (per user) ------------------------------------------------
app.get("/api/people", async (req, res) => {
  try {
    res.json({ people: await people.forUser(req.userId) });
  } catch (err) {
    console.error("list people error:", err);
    res.status(500).json({ error: "Could not load saved people." });
  }
});

app.post("/api/people", async (req, res) => {
  try {
    const b = req.body || {};
    const birth = parseBirth(b); // validates the birth fields (throws HttpError)
    const person = await people.add({
      id: crypto.randomUUID(),
      userId: req.userId,
      name: String(b.name || "").trim().slice(0, 80) || "Unnamed",
      year: birth.year, month: birth.month, day: birth.day, hour: birth.hour, minute: birth.minute,
      lat: birth.lat, lon: birth.lon, tz: birth.tz,
      createdAt: new Date().toISOString()
    });
    res.json({ person });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error("save person error:", err);
    res.status(500).json({ error: "Save failed." });
  }
});

app.delete("/api/people/:id", async (req, res) => {
  try {
    res.json({ ok: await people.remove(req.userId, req.params.id) });
  } catch (err) {
    console.error("delete person error:", err);
    res.status(500).json({ error: "Delete failed." });
  }
});

// --- Geocoding (live city search → lat/lon + standard UTC offset) -----------
// Uses the free Open-Meteo geocoding API (no key). Falls back to the built-in
// gazetteer when the network is unavailable, so the picker still works offline.
app.get("/api/geocode", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ results: [] });
  try {
    const url =
      "https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=" +
      encodeURIComponent(q);
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`geocoder HTTP ${r.status}`);
    const data = await r.json();
    const results = (data.results || []).map(p => ({
      name: p.name,
      admin1: p.admin1 || "",
      country: p.country || p.country_code || "",
      lat: round4(p.latitude),
      lon: round4(p.longitude),
      timezone: p.timezone || null,
      tz: p.timezone ? standardOffsetHours(p.timezone) : null
    }));
    if (results.length) return res.json({ results, source: "open-meteo" });
    return res.json({ results: fallbackCities(q), source: "builtin" });
  } catch (err) {
    console.error("geocode error:", err.message);
    res.json({ results: fallbackCities(q), source: "builtin" });
  }
});

// --- Compute a chart --------------------------------------------------------
app.post("/api/chart", (req, res) => {
  try {
    const chart = computeChart(parseBirth(req.body || {}));
    res.json(chart);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error("chart error:", err);
    res.status(500).json({ error: "Chart computation failed: " + err.message });
  }
});

// --- Ashtakoot Guna Milan (36-guna compatibility) ---------------------------
app.post("/api/match", (req, res) => {
  try {
    const body = req.body || {};
    if (!body.boy || !body.girl) {
      return res.status(400).json({ error: "Provide birth details for both people (boy and girl)." });
    }
    const chartBoy = computeChart(parseBirth(body.boy));
    const chartGirl = computeChart(parseBirth(body.girl));
    const result = computeGunaMilan(moonInputFromChart(chartBoy), moonInputFromChart(chartGirl));
    const boyM = computeManglik(chartBoy);
    const girlM = computeManglik(chartGirl);
    result.manglik = { boy: boyM, girl: girlM, verdict: manglikVerdict(boyM, girlM) };
    res.json({ ...result, charts: { boy: chartBoy, girl: chartGirl } });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error("match error:", err);
    res.status(500).json({ error: "Match computation failed: " + err.message });
  }
});

// --- Chat (streamed via SSE) ------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { messages, chart, match } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "No messages provided." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (res.flushHeaders) res.flushHeaders();

  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  if (!ENDPOINT || !API_KEY) {
    send({ error: "Azure AI Foundry is not configured — set AZURE_INFERENCE_ENDPOINT and AZURE_INFERENCE_KEY in your .env file." });
    return res.end();
  }

  // Anthropic Messages API system prompt: the practitioner skill (cached), the
  // behaviour note, and the computed chart as separate blocks.
  const system = [
    { type: "text", text: SKILL_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: BEHAVIOUR_NOTE }
  ];
  if (chart) {
    system.push({
      type: "text",
      text: "=== CONSULTATION CHART (authoritative) ===\n" + chartToText(chart)
    });
  }
  if (match && match.summary) {
    system.push({ type: "text", text: MATCH_NOTE });
    system.push({
      type: "text",
      text: "=== COMPATIBILITY — GUNA MILAN + MANGLIK (authoritative) ===\n" + matchToText(match.summary)
    });
    if (match.partnerChart) {
      system.push({
        type: "text",
        text: "=== PARTNER'S CHART (authoritative) ===\n" + chartToText(match.partnerChart)
      });
    }
  }

  const body = {
    model: MODEL,
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system,
    messages: messages.map(m => ({ role: m.role, content: String(m.content) })),
    stream: true
  };

  try {
    const upstream = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY, // Foundry's Anthropic route uses native Anthropic auth
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });

    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text().catch(() => "")).slice(0, 800);
      const msg =
        upstream.status === 401 || upstream.status === 403
          ? "Authentication failed — check AZURE_INFERENCE_KEY and AZURE_INFERENCE_ENDPOINT in your .env file."
          : `Chat request failed (HTTP ${upstream.status}). ${detail}`.trim();
      send({ error: msg });
      return res.end();
    }

    // Parse the Anthropic Messages SSE stream, forwarding only text deltas.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let refused = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of chunk.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const data = t.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let evt;
          try { evt = JSON.parse(data); } catch { continue; }
          if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
            send({ text: evt.delta.text });
          } else if (evt.type === "message_delta" && evt.delta && evt.delta.stop_reason === "refusal") {
            refused = true;
          } else if (evt.type === "error") {
            send({ error: (evt.error && evt.error.message) || "Streaming error." });
          }
        }
      }
    }

    if (refused) send({ error: "The model declined to answer that request." });
    send({ done: true });
    res.end();
  } catch (err) {
    console.error("chat error:", err);
    send({ error: "Chat request failed: " + (err && err.message ? err.message : "unknown error") });
    res.end();
  }
});

const int = v => (v === undefined || v === null || v === "" ? null : parseInt(v, 10));
const num = v => (v === undefined || v === null || v === "" ? null : parseFloat(v));
const round4 = x => Math.round(Number(x) * 10000) / 10000;

// Standard-time UTC offset (hours) for an IANA timezone — the non-DST offset,
// to match the app's "standard offset, add +1 for DST" convention.
function offsetHoursAt(timeZone, date) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find(p => p.type === "timeZoneName");
  const m = part && part.value.match(/([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0; // "GMT" / "UTC"
  return (m[1] === "-" ? -1 : 1) * (parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0));
}
function standardOffsetHours(timeZone) {
  const y = new Date().getUTCFullYear();
  const jan = offsetHoursAt(timeZone, new Date(Date.UTC(y, 0, 1, 12)));
  const jul = offsetHoursAt(timeZone, new Date(Date.UTC(y, 6, 1, 12)));
  return Math.round(Math.min(jan, jul) * 100) / 100; // standard = the smaller (winter) offset
}
function fallbackCities(q) {
  const needle = q.toLowerCase();
  return CITIES.filter(c => c.name.toLowerCase().includes(needle))
    .slice(0, 8)
    .map(c => ({ name: c.name, admin1: "", country: "", lat: c.lat, lon: c.lon, timezone: null, tz: c.tz }));
}

// A validation failure that maps to an HTTP status instead of a 500.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Validate one person's birth details and return the input computeChart expects.
function parseBirth(b) {
  const nums = {
    year: int(b.year),
    month: int(b.month),
    day: int(b.day),
    hour: int(b.hour),
    minute: int(b.minute),
    lat: num(b.lat),
    lon: num(b.lon),
    tz: num(b.tz)
  };
  for (const [k, v] of Object.entries(nums)) {
    if (v === null || Number.isNaN(v)) throw new HttpError(400, `Missing or invalid field: ${k}`);
  }
  if (nums.month < 1 || nums.month > 12 || nums.day < 1 || nums.day > 31) {
    throw new HttpError(400, "Invalid date.");
  }
  // Rahu/Ketu aspect convention: "seventh" (7th only) or Jupiter-like (5/7/9).
  const nodeMode = b.nodeMode === "seventh" ? "seventh" : "jupiter";
  const nodeAspects = nodeMode === "seventh" ? [7] : [5, 7, 9];
  const name = b.name ? String(b.name).trim().slice(0, 80) : undefined;
  return { ...nums, nodeAspects, nodeMode, name };
}

app.listen(PORT, () => {
  console.log(`\n  ✨ Astroman running at http://localhost:${PORT}`);
  console.log(`  ℹ  Data store: ${store.name}`);
  if (!ENDPOINT || !API_KEY) {
    console.log(
      "  ⚠  Azure AI Foundry not configured — set AZURE_INFERENCE_ENDPOINT and " +
        "AZURE_INFERENCE_KEY in .env; chat will fail until then."
    );
  }
  if (auth.ephemeralSecret) {
    console.log(
      "  ⚠  SESSION_SECRET is not set — using a random one; logins reset on restart. " +
        "Set SESSION_SECRET in .env for persistent sessions."
    );
  }
  if (!auth.SECURE) {
    console.log("  ℹ  COOKIE_SECURE is off (fine for http://localhost; set it to true behind HTTPS).");
  }
  console.log("");
});
