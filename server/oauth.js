// Google Sign-In (OAuth 2.0 Authorization Code flow), server-side. Enabled only
// when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set. The redirect URI is
// derived from the request (works on localhost and behind Render's proxy) unless
// GOOGLE_REDIRECT_URI is set explicitly — it must match a URI registered in the
// Google Cloud console exactly.
const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const REDIRECT_OVERRIDE = (process.env.GOOGLE_REDIRECT_URI || "").trim();

const enabled = !!(CLIENT_ID && CLIENT_SECRET);

function redirectUri(req) {
  if (REDIRECT_OVERRIDE) return REDIRECT_OVERRIDE;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/auth/google/callback`;
}

function authUrl(req, state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCode(req, code) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(req)
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  return res.json(); // { access_token, id_token, expires_in, ... }
}

async function fetchProfile(accessToken) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Profile fetch failed (${res.status})`);
  return res.json(); // { sub, email, email_verified, name, picture }
}

module.exports = { enabled, authUrl, exchangeCode, fetchProfile, redirectUri };
