// Authentication: scrypt password hashing, stateless HMAC-signed session cookies
// (survive restarts, no server-side session store), a per-IP login rate limiter,
// and Express middleware. Hardened for internet deployment — set SESSION_SECRET
// and COOKIE_SECURE=true behind HTTPS.
const crypto = require("crypto");
const { promisify } = require("util");

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
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const currentUserId = req => {
  const data = verify(parseCookies(req)[COOKIE]);
  return data ? data.uid : null;
};

// --- Middleware -------------------------------------------------------------
function requireAuth(req, res, next) {
  const uid = currentUserId(req);
  if (!uid) return res.status(401).json({ error: "Not authenticated." });
  req.userId = uid;
  next();
}

// Reject cross-origin state-changing requests (CSRF defence-in-depth; the
// SameSite=Lax cookie already blocks most). GET/HEAD are exempt.
//
// X-Forwarded-Host is client-supplied, so it's only consulted when no canonical
// host is configured. Set CANONICAL_HOST in production and the allowed set stops
// depending on anything the caller can influence.
const CANONICAL_HOST = (process.env.CANONICAL_HOST || "").trim().toLowerCase();

function checkOrigin(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
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

module.exports = {
  hashPassword, verifyPassword, makeSessionToken,
  setSessionCookie, clearSessionCookie, setCookie, clearCookie, parseCookies, currentUserId,
  requireAuth, checkOrigin, rateLimit, rateLimiter, ephemeralSecret, SECURE,
  clientIp, TRUST_CLOUDFLARE
};
