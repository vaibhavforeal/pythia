// Makes the same frontend work as a website and as a bundled native app.
//
// In the Capacitor build the web assets are served from capacitor://localhost
// (iOS) or http://localhost (Android), so a relative "/api/chart" would resolve
// against the webview instead of the server, and the session cookie — being
// third-party at that point — is dropped. Rather than rewriting ~25 call sites,
// this patches fetch once: /api/* requests get the real origin and an
// Authorization header, and the token is captured out of auth responses.
//
// On the web this is a passthrough. Same-origin requests, same cookie, nothing
// changes — which matters, because the website is the thing that already works.

(function () {
  // Capacitor injects this global. Android serves from http://localhost, which
  // is indistinguishable from a local dev server by URL alone, so the global is
  // the only reliable signal.
  const NATIVE = !!(window.Capacitor &&
    (typeof window.Capacitor.isNativePlatform === "function"
      ? window.Capacitor.isNativePlatform()
      : true));

  // Where the API lives when the frontend isn't served by it. Overridable at
  // build time by defining window.PYTHIA_API_BASE before this script.
  const API_BASE = (window.PYTHIA_API_BASE || "https://pythia.cyou").replace(/\/+$/, "");
  const TOKEN_KEY = "pythia_token";

  const store = {
    get() {
      try { return localStorage.getItem(TOKEN_KEY) || null; } catch (_) { return null; }
    },
    set(t) {
      try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (_) { /* ignore */ }
    }
  };

  // Exposed so the app can clear the session on logout, and so a future
  // Capacitor Preferences/Keychain migration has one place to change.
  window.PythiaAuth = {
    native: NATIVE,
    apiBase: NATIVE ? API_BASE : "",
    getToken: store.get,
    setToken: store.set,
    clear: () => store.set(null)
  };

  if (!NATIVE) return; // the website is already correct; don't touch it

  const isApiPath = url => typeof url === "string" && url.startsWith("/api/");
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url);
    if (!isApiPath(url)) return nativeFetch(input, init);

    const opts = { ...(init || {}) };
    const headers = new Headers((init && init.headers) || (input && input.headers) || {});
    headers.set("X-Pythia-Client", "app");
    const token = store.get();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    opts.headers = headers;

    const res = await nativeFetch(API_BASE + url, opts);

    // Auth responses carry the token for native clients; grab it in passing so
    // no call site has to know about any of this.
    if (url.startsWith("/api/auth/")) {
      try {
        const copy = res.clone();
        const data = await copy.json();
        if (data && data.token) store.set(data.token);
        if (url.includes("/logout")) store.set(null);
      } catch (_) {
        /* not JSON, or already consumed — nothing to capture */
      }
    }
    // A rejected session is worth forgetting, or the app retries a dead token
    // on every request for the rest of its life.
    if (res.status === 401) store.set(null);
    return res;
  };
})();
