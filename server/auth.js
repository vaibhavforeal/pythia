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
function checkOrigin(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const origin = req.headers.origin;
  if (origin) {
    // Behind a proxy (e.g. Render), the public host arrives as X-Forwarded-Host.
    const allowed = new Set([req.headers.host, req.headers["x-forwarded-host"]].filter(Boolean));
    try {
      if (!allowed.has(new URL(origin).host)) return res.status(403).json({ error: "Bad origin." });
    } catch {
      return res.status(403).json({ error: "Bad origin." });
    }
  }
  next();
}

// Per-IP fixed-window limiter for login/register (brute-force protection).
const attempts = new Map();
const RL_WINDOW_MS = 15 * 60 * 1000;
const RL_MAX = 12;
function rateLimit(req, res, next) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?")
    .split(",")[0].trim();
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
  setSessionCookie, clearSessionCookie, currentUserId,
  requireAuth, checkOrigin, rateLimit, rateLimiter, ephemeralSecret, SECURE
};
