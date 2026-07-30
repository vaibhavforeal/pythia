// Registers the service worker, and shows a banner when the connection drops.
//
// Loaded by both app.html and index.html, so it must not assume the app's
// globals exist — index.html loads only theme.js.

(function () {
  // Not in the native shell. sync-web.js copies public/ wholesale into
  // mobile/www, so this file rides along into Capacitor, where a worker is
  // unnecessary (assets are already local) and can interfere with how the
  // shell serves them. PythiaAuth is undefined on the marketing page, which is
  // the web — so absence means register.
  const native = !!(window.PythiaAuth && window.PythiaAuth.native);

  if (!native && "serviceWorker" in navigator) {
    // After load: registration competes with the app's first API calls for
    // connections otherwise, and the worker is a repeat-visit optimisation —
    // it has nothing to contribute to the load that registers it.
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(err => {
        // Not fatal in any way: no worker simply means no offline and no install
        // prompt. Never let it break the page.
        console.warn("service worker registration failed:", err);
      });
    });
  }

  // --- Offline banner ------------------------------------------------------
  // The shell opens offline, which is the point — but every chart, reading and
  // reply comes from the API, so without a signal the app looks broken rather
  // than disconnected. navigator.onLine is only trustworthy in the negative
  // (false definitely means no network; true can still mean a captive portal),
  // which is exactly the direction being used here.
  let banner;
  function render() {
    if (navigator.onLine) {
      if (banner) { banner.remove(); banner = null; }
      return;
    }
    if (banner) return;
    banner = document.createElement("div");
    banner.className = "offline-banner";
    banner.setAttribute("role", "status");
    banner.textContent = "You're offline — reconnect to cast or read a chart.";
    document.body.appendChild(banner);
  }

  window.addEventListener("online", render);
  window.addEventListener("offline", render);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
