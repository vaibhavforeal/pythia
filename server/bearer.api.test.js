// Bearer-token auth for the Capacitor app.
//
// The app's webview runs on capacitor://localhost while the API is on the real
// domain, so the session cookie is third-party and gets dropped. Same signed
// token, carried in a header instead.
//
// The security assertions are the point: the token must not be volunteered to
// browsers, cookie requests must keep their CSRF protection, and CORS must not
// hand the app origin credentialed access.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 31000 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-bearer-"));
const APP_ORIGIN = "capacitor://localhost";

let srv, log = "";
let seq = 0;

function call(method, url, { body, headers = {}, cookie, origin } = {}) {
  return fetch(BASE + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": `192.0.2.${(seq++ % 250) + 1}`,
      ...(origin === null ? {} : { Origin: origin || BASE }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
const jsonOf = async res => { try { return await res.json(); } catch { return null; } };
const cookieOf = res => {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return set.map(c => c.split(";")[0]).join("; ");
};

test.before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, SESSION_SECRET: "test-only-secret", ALLOW_EMAIL_SIGNUP: "true", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  srv.stdout.on("data", d => (log += d));
  srv.stderr.on("data", d => (log += d));
  for (let i = 0; i < 80; i++) {
    try { await fetch(BASE + "/healthz"); return; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error("server never came up:\n" + log);
});

test.after(() => {
  if (srv) srv.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

let appToken, webCookie;

test("a browser signup gets a cookie and NO token in the body", async () => {
  const res = await call("POST", "/api/auth/register",
    { body: { email: "web@example.com", password: "correct-horse-battery" } });
  assert.strictEqual(res.status, 200);
  webCookie = cookieOf(res);
  assert.match(webCookie, /astro_sess=/);

  const j = await jsonOf(res);
  assert.strictEqual(j.token, undefined,
    "a readable long-lived credential would let an XSS outlive the page");
});

test("the app asks for the token explicitly and gets one", async () => {
  const res = await call("POST", "/api/auth/register", {
    body: { email: "app@example.com", password: "correct-horse-battery" },
    headers: { "X-Pythia-Client": "app" },
    origin: APP_ORIGIN
  });
  assert.strictEqual(res.status, 200);
  const j = await jsonOf(res);
  assert.ok(j.token, "the app has no usable cookie, so it needs the token");
  appToken = j.token;
});

test("the token authenticates with no cookie at all", async () => {
  const res = await call("GET", "/api/account", {
    headers: { Authorization: `Bearer ${appToken}` },
    origin: APP_ORIGIN
  });
  assert.strictEqual(res.status, 200);
  const j = await jsonOf(res);
  assert.strictEqual(j.user.email, "app@example.com");
});

test("logging in from the app returns a token; from a browser it doesn't", async () => {
  const fromApp = await jsonOf(await call("POST", "/api/auth/login", {
    body: { identifier: "app@example.com", password: "correct-horse-battery" },
    headers: { "X-Pythia-Client": "app" }, origin: APP_ORIGIN
  }));
  assert.ok(fromApp.token);

  const fromWeb = await jsonOf(await call("POST", "/api/auth/login", {
    body: { identifier: "web@example.com", password: "correct-horse-battery" }
  }));
  assert.strictEqual(fromWeb.token, undefined);
});

test("garbage and tampered tokens are refused", async () => {
  const tampered = appToken.slice(0, -4) + "AAAA"; // break the signature
  for (const t of ["", "junk", "Bearer", tampered, appToken + "x"]) {
    const res = await call("GET", "/api/account", { headers: { Authorization: `Bearer ${t}` } });
    assert.strictEqual(res.status, 401, `should reject ${JSON.stringify(t.slice(0, 12))}`);
  }
});

test("a bearer request works cross-origin, where a cookie request would not", async () => {
  // This is the whole point: the app's Origin can never match the site's host.
  const withToken = await call("POST", "/api/account/birth", {
    body: { name: "App", year: 1995, month: 3, day: 14, hour: 9, minute: 20, lat: 28.6139, lon: 77.209, tz: 5.5 },
    headers: { Authorization: `Bearer ${appToken}` },
    origin: APP_ORIGIN
  });
  assert.strictEqual(withToken.status, 200, await withToken.text());
});

test("cookie requests keep their CSRF protection", async () => {
  // A hostile page can make the browser send the cookie, but never the header —
  // so the origin check must still apply whenever a cookie is what's authorising.
  const res = await call("POST", "/api/account/birth", {
    body: { name: "Web", year: 1995, month: 3, day: 14, hour: 9, minute: 20, lat: 28.6139, lon: 77.209, tz: 5.5 },
    cookie: webCookie,
    origin: "https://evil.example"
  });
  assert.strictEqual(res.status, 403, "cross-origin cookie writes must still be refused");
});

test("a stray Authorization header cannot override a real cookie session", async () => {
  const other = await jsonOf(await call("POST", "/api/auth/register", {
    body: { email: "third@example.com", password: "correct-horse-battery" },
    headers: { "X-Pythia-Client": "app" }
  }));
  const res = await call("GET", "/api/account", {
    cookie: webCookie,
    headers: { Authorization: `Bearer ${other.token}` }
  });
  const j = await jsonOf(res);
  assert.strictEqual(j.user.email, "web@example.com", "the cookie owner must win");
});

test("CORS admits the app origin but never with credentials", async () => {
  const res = await call("OPTIONS", "/api/account", {
    origin: APP_ORIGIN,
    headers: { "Access-Control-Request-Method": "GET" }
  });
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers.get("access-control-allow-origin"), APP_ORIGIN);
  assert.ok(/Authorization/i.test(res.headers.get("access-control-allow-headers") || ""));
  assert.strictEqual(res.headers.get("access-control-allow-credentials"), null,
    "allowing cookies from the app origin would re-open the CSRF surface");
});

test("CORS does not admit arbitrary origins", async () => {
  const res = await call("OPTIONS", "/api/account", {
    origin: "https://evil.example",
    headers: { "Access-Control-Request-Method": "GET" }
  });
  assert.strictEqual(res.headers.get("access-control-allow-origin"), null);
});

test("bearer auth does not bypass authentication itself", async () => {
  const res = await call("GET", "/api/friends", { origin: APP_ORIGIN });
  assert.strictEqual(res.status, 401, "no token, no session");
});
