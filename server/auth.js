// Authentication: scrypt password hashing, stateless HMAC-signed session cookies
// (survive restarts, no server-side session store), a per-IP login rate limiter,
// and Express middleware. Hardened for internet deployment — set SESSION_SECRET
// and COOKIE_SECURE=true behind HTTPS.
const crypto = require("crypto");
const { promisify } = require("util");
// Only used by persistentRateLimiter at the bottom. store.js requires nothing
// from here, so this is not a cycle.
const store = require("./store");

const scrypt = promisify(crypto.scrypt);

const COOKIE = "astro_sess";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SECURE = process.env.COOKIE_SECURE === "true";

let SECRET = process.env.SESSION_SECRET || "";
let ephemeralSecret = false;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString("hex");
  ephemeralSecret = true; // sessions won't survive a restart until SESSION_SECRET is set
}

// --- Password hashing -------------------------------------------------------
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)).toString("hex");
  return { salt, hash };
}
async function verifyPassword(password, salt, hash) {
  const known = Buffer.from(hash, "hex");
  const test = await scrypt(password, salt, 64);
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

// --- Signed session tokens (payload.signature, base64url) --------------------
const b64url = buf => Buffer.from(buf).toString("base64url");
function sign(obj) {
  const payload = b64url(JSON.stringify(obj));
  const sig = b64url(crypto.createHmac("sha256", SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}
function verify(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", SECRET).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
  if (!data || !data.uid || !data.exp || Date.now() > data.exp) return null;
  return data;
}
const makeSessionToken = userId =>
  sign({ uid: userId, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS });

// --- Cookies ----------------------------------------------------------------
function appendCookie(res, value) {
  const prev = res.getHeader("Set-Cookie");
  if (!prev) res.setHeader("Set-Cookie", value);
  else res.setHeader("Set-Cookie", (Array.isArray(prev) ? prev : [prev]).concat(value));
}
function setSessionCookie(res, token) {
  const parts = [`${COOKIE}=${token}`, "HttpOnly", "Path=/", "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (SECURE) parts.push("Secure");
  appendCookie(res, parts.join("; "));
}
function clearSessionCookie(res) {
  const parts = [`${COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (SECURE) parts.push("Secure");
  appendCookie(res, parts.join("; "));
}
// Generic short-lived cookie (used for the OAuth `state` CSRF token).
function setCookie(res, name, value, maxAgeSec) {
  const parts = [`${name}=${value}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (SECURE) parts.push("Secure");
  appendCookie(res, parts.join("; "));
}
function clearCookie(res, name) {
  const parts = [`${name}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (SECURE) parts.push("Secure");
  appendCookie(res, parts.join("; "));
}
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const raw = part.slice(i + 1).trim();
    let value;
    // A malformed percent-escape makes decodeURIComponent throw. That cookie is
    // simply not one of ours, and a browser can hold one it never sent us (a
    // sibling subdomain, a third-party script) — throwing here would 500 every
    // authenticated route for that user until they cleared cookies by hand.
    try {
      value = decodeURIComponent(raw);
    } catch {
      value = raw;
    }
    out[part.slice(0, i).trim()] = value;
  }
  return out;
}
// --- Two ways to present a session -------------------------------------------
// Browsers send the httpOnly cookie. The Capacitor app can't: its webview runs
// on capacitor://localhost while the API is on the real domain, so the cookie is
// third-party and gets dropped. Same signed token, carried in a header instead.
//
// This split matters for CSRF. A cookie is attached by the browser
// automatically, which is what makes cross-site requests dangerous. An
// Authorization header never is — a hostile page cannot make the browser add
// one — so bearer-authenticated requests are structurally immune, and the
// origin check below skips them rather than blocking the app.
function bearerToken(req) {
  const h = String((req.headers && req.headers.authorization) || "");
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/** True when this request authenticated by header rather than cookie. */
function usedBearer(req) {
  const t = bearerToken(req);
  return !!(t && verify(t));
}

const currentUserId = req => {
  // Cookie first: a browser session shouldn't be overridden by a stray header.
  const fromCookie = verify(parseCookies(req)[COOKIE]);
  if (fromCookie) return fromCookie.uid;
  const fromHeader = verify(bearerToken(req));
  return fromHeader ? fromHeader.uid : null;
};

// --- Middleware -------------------------------------------------------------
function requireAuth(req, res, next) {
  const uid = currentUserId(req);
  if (!uid) return res.status(401).json({ error: "Not authenticated." });
  req.userId = uid;
  next();
}

// --- Native app (Capacitor) ---------------------------------------------------
// The webview serves the bundled frontend from these origins, so API calls from
// the app are cross-origin and need CORS. Credentials are deliberately NOT
// allowed: the app authenticates with a bearer token, and permitting cookies
// here would re-open the CSRF surface the header approach closes.
const APP_ORIGINS = new Set([
  "capacitor://localhost",  // iOS
  "http://localhost",       // Android
  "https://localhost",      // Android, when configured for https scheme
  "ionic://localhost"       // older Capacitor/Cordova shells
]);

// Reject cross-origin state-changing requests (CSRF defence-in-depth; the
// SameSite=Lax cookie already blocks most). GET/HEAD are exempt.
//
// X-Forwarded-Host is client-supplied, so it's only consulted when no canonical
// host is configured. Set CANONICAL_HOST in production and the allowed set stops
// depending on anything the caller can influence.
const CANONICAL_HOST = (process.env.CANONICAL_HOST || "").trim().toLowerCase();

function checkOrigin(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  // Bearer-authenticated requests carry no ambient credential, so there's
  // nothing for a hostile origin to ride on — and the native app's origin is
  // never going to match the site's host.
  if (usedBearer(req)) return next();
  // Signing in is the one request the app makes before it has a token, so the
  // native webview origins are allowed outright. That isn't a CSRF hole: a
  // browser sets Origin itself and will never claim capacitor://localhost from
  // a web page, and these origins carry no cookie to ride on.
  if (req.headers.origin && APP_ORIGINS.has(req.headers.origin)) return next();
  const origin = req.headers.origin;
  if (origin) {
    const allowed = CANONICAL_HOST
      ? new Set([CANONICAL_HOST])
      : new Set([req.headers.host, req.headers["x-forwarded-host"]].filter(Boolean));
    try {
      if (!allowed.has(new URL(origin).host.toLowerCase())) {
        return res.status(403).json({ error: "Bad origin." });
      }
    } catch {
      return res.status(403).json({ error: "Bad origin." });
    }
  }
  next();
}

function appCors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && APP_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Pythia-Client");
    // PATCH is required: saveConversation() uses it, and the Authorization
    // header forces a preflight, so omitting it made every autosave after the
    // first message fail silently in the native shell.
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    // No Access-Control-Allow-Credentials: bearer only, by design.
    if (req.method === "OPTIONS") return res.status(204).end();
  }
  next();
}

/**
 * Should this response hand back the session token in its body?
 *
 * Only for the native app, which has no usable cookie and must store the token
 * itself. Browsers keep getting the httpOnly cookie and nothing else: putting a
 * long-lived credential where page JavaScript can read it would let an XSS
 * exfiltrate a session that outlives the page, which is strictly worse than the
 * request-forgery an XSS can already manage.
 *
 * A hostile script could of course set this header too. The header is a
 * declaration of intent, not a security boundary — the real boundary is that we
 * never volunteer the token by default.
 */
function wantsToken(req) {
  return String((req.headers && req.headers["x-pythia-client"]) || "").toLowerCase() === "app";
}

// --- Client IP ---------------------------------------------------------------
// Rate limiting is only as good as the address it keys on, and X-Forwarded-For
// is partly caller-supplied. Cloudflare APPENDS the real client to whatever
// arrived, so a request carrying "X-Forwarded-For: 1.2.3.4" reaches the origin
// as "1.2.3.4, <real client>, ...". Reading the LEFTMOST entry therefore keys
// the limiter on an attacker-chosen value that they can rotate at will —
// through the proxy, not just by bypassing it.
//
// Precedence:
//   1. CF-Connecting-IP, but only when the request is *proven* to have come
//      through Cloudflare — the connection is checked against Cloudflare's
//      published ranges (see cloudflare.js). This needs no configuration and
//      can't be left half-set: a request that didn't traverse Cloudflare simply
//      doesn't get the header believed.
//   2. req.ip, which Express derives from X-Forwarded-For honouring
//      `trust proxy` — it walks from the RIGHT, over the hops your own
//      infrastructure appended, so forged leading entries are ignored.
//   3. The socket address, which cannot be forged at all.
//
// TRUST_CLOUDFLARE=true forces step 1 without the range check. That's strictly
// weaker and only for a proxy that isn't Cloudflare-addressed; prefer leaving
// it unset and letting detection do the work.
const cloudflare = require("./cloudflare");
const TRUST_CLOUDFLARE = String(process.env.TRUST_CLOUDFLARE || "").toLowerCase() === "true";

function clientIp(req) {
  if (TRUST_CLOUDFLARE || cloudflare.cameThroughCloudflare(req)) {
    const cf = String(req.headers["cf-connecting-ip"] || "").trim();
    if (cf) return cf;
  }
  return (req.ip || (req.socket && req.socket.remoteAddress) || "?").trim();
}

// Per-IP fixed-window limiter for login/register (brute-force protection).
const attempts = new Map();
const RL_WINDOW_MS = 15 * 60 * 1000;
const RL_MAX = 12;
function rateLimit(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  let rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + RL_WINDOW_MS };
    attempts.set(ip, rec);
  }
  if (++rec.count > RL_MAX) {
    const retry = Math.ceil((rec.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retry));
    return res.status(429).json({ error: `Too many attempts — try again in ${Math.ceil(retry / 60)} min.` });
  }
  next();
}
// Opportunistic cleanup so the Map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) if (now > rec.resetAt) attempts.delete(ip);
}, RL_WINDOW_MS).unref();

// Generic fixed-window limiter keyed by whatever `key(req)` returns (e.g. userId).
// Used to throttle the chat per user. In-memory → single-instance only.
function rateLimiter({ windowMs, max, key, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, rec] of hits) if (now > rec.resetAt) hits.delete(k);
  }, Math.min(windowMs, 60 * 60 * 1000)).unref();

  return (req, res, next) => {
    const k = key(req);
    if (!k) return next(); // no identity → let auth handle it
    const now = Date.now();
    let rec = hits.get(k);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(k, rec);
    }
    if (++rec.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((rec.resetAt - now) / 1000)));
      return res.status(429).json({ error: message || "Too many requests — please slow down." });
    }
    next();
  };
}

// Same fixed-window shape as rateLimiter, but the counter lives in the store.
//
// Use this for any window long enough to outlive the process. A Map resets on
// restart, which is invisible on a long-lived box but not on a container that
// spins down when idle: there, a "daily" cap silently becomes "per wake", and
// anyone who wants a fresh budget just waits for the app to go to sleep. That
// matters most for the chat limiter, which is the cap on a paid API.
//
// Short windows stay in memory on purpose — a per-minute burst cap is worth
// nothing after a restart anyway, and it shouldn't pay for a round trip.
//
// Fails OPEN if the store is unreachable: this runs in front of routes that are
// about to hit the same store, so failing closed would convert a database blip
// into a blanket 429 while adding no protection. The in-memory burst limiter
// stays in front regardless, so an open failure is still bounded.
function persistentRateLimiter({ windowMs, max, key, message, prefix }) {
  return async (req, res, next) => {
    const k = key(req);
    if (!k) return next(); // no identity → let auth handle it
    let rec;
    try {
      rec = await store.rateLimits.hit(`${prefix}:${k}`, windowMs);
    } catch (err) {
      console.error(`rate limit store unavailable for ${prefix}:`, err.message);
      return next();
    }
    if (rec.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((rec.resetAt - Date.now()) / 1000))));
      return res.status(429).json({ error: message || "Too many requests — please slow down." });
    }
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, makeSessionToken,
  setSessionCookie, clearSessionCookie, setCookie, clearCookie, parseCookies, currentUserId,
  requireAuth, checkOrigin, rateLimit, rateLimiter, persistentRateLimiter, ephemeralSecret, SECURE,
  clientIp, TRUST_CLOUDFLARE, bearerToken, usedBearer, APP_ORIGINS, appCors, wantsToken
};
