// Push delivery via Firebase Cloud Messaging.
//
// FCM's legacy server-key API was shut down, so this is HTTP v1: every send
// needs an OAuth2 access token, obtained by signing a JWT with the service
// account's private key. That's RS256 over a JSON header and claim set, which
// node:crypto does natively — no firebase-admin dependency, which would pull in
// a large tree for one HTTP call.
//
// Configure with either:
//   FIREBASE_SERVICE_ACCOUNT       the service account JSON, inline
//   FIREBASE_SERVICE_ACCOUNT_PATH  a path to it
// Or set PUSH_PROVIDER=console for local development, which refuses to run in
// production so a missing config can't silently degrade into logging.

const fs = require("fs");
const crypto = require("crypto");

const PROVIDER = (process.env.PUSH_PROVIDER || "").trim().toLowerCase();
const IS_PROD = process.env.NODE_ENV === "production";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let account = null;
function serviceAccount() {
  if (account !== null) return account;
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  try {
    const raw = inline ? inline : file ? fs.readFileSync(file, "utf8") : null;
    account = raw ? JSON.parse(raw) : false;
  } catch (err) {
    console.error("push: service account is not readable JSON:", err.message);
    account = false;
  }
  return account;
}

const enabled = () => PROVIDER === "console" || !!serviceAccount();

const b64url = buf => Buffer.from(buf).toString("base64url");

/** Cached access token — Google issues them for an hour. */
let cachedToken = null;

async function accessToken() {
  const sa = serviceAccount();
  if (!sa) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signature = b64url(
    crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key)
  );

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`FCM token exchange failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

/**
 * Send one notification.
 * @returns {Promise<{ok:boolean, stale?:boolean, error?:string}>}
 *   `stale` marks a device token FCM says no longer exists, so the caller can
 *   drop it instead of retrying it forever.
 */
async function send(deviceToken, message, data = {}) {
  if (PROVIDER === "console") {
    if (IS_PROD) throw new Error("PUSH_PROVIDER=console is not permitted in production");
    console.log(`\n  🔔 ${deviceToken.slice(0, 12)}… → ${message.title}\n     ${message.body}\n`);
    return { ok: true };
  }

  const sa = serviceAccount();
  if (!sa) return { ok: false, error: "push not configured" };

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: message.title, body: message.body },
        // Strings only — FCM rejects other types in the data payload.
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        android: { priority: "HIGH", notification: { channel_id: "daily", sound: "default" } },
        apns: { payload: { aps: { sound: "default" } } }
      }
    })
  });

  if (res.ok) return { ok: true };
  const body = await res.text().catch(() => "");
  // Only prune on errors that are genuinely about *this token* — the app was
  // uninstalled, or the token was minted for another sender. Deliberately NOT
  // matched: a bare 404 (a wrong project_id 404s every send) and the bare
  // string INVALID_ARGUMENT, which FCM returns for any malformed field — an
  // over-long body or a bad AndroidConfig would otherwise delete the entire
  // device registry on the first run after a bad deploy.
  const stale =
    (res.status === 404 && /UNREGISTERED/i.test(body)) ||
    (res.status === 403 && /SENDER_ID_MISMATCH/i.test(body));
  return { ok: false, stale, error: `FCM ${res.status}: ${body.slice(0, 200)}` };
}

module.exports = { send, enabled, accessToken, PROVIDER };
