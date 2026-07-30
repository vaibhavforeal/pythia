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

  // --- PWA Installation Management -----------------------------------------
  let deferredPrompt = null;

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true ||
      document.referrer.includes("android-app://")
    );
  }

  function updateInstallUI() {
    const standalone = isStandalone();
    const targets = document.querySelectorAll("[data-pwa-install], .pwa-install-btn, .pwa-install-chip, #pwaInstallCard");
    targets.forEach(el => {
      if (standalone) {
        el.hidden = true;
      } else {
        el.hidden = false;
      }
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.deferredPwaPrompt = e;
    updateInstallUI();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    window.deferredPwaPrompt = null;
    updateInstallUI();
  });

  function showPwaModal() {
    let overlay = document.getElementById("pwaModalOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "pwaModalOverlay";
      overlay.className = "pwa-modal-overlay";

      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;

      const title = isIOS ? "Install Pythia on iOS" : "Install Pythia App";
      const stepsHTML = isIOS
        ? `<li><span>1</span> Tap the <b>Share</b> button in Safari <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin:0 2px;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></li>
           <li><span>2</span> Scroll down &amp; tap <b>Add to Home Screen</b> ➕</li>
           <li><span>3</span> Tap <b>Add</b> in the top right corner</li>`
        : `<li><span>1</span> Tap browser menu <b>(⋮)</b> or address bar icon</li>
           <li><span>2</span> Select <b>Install Pythia</b> or <b>Add to Home Screen</b></li>
           <li><span>3</span> Confirm to add Pythia to your device</li>`;

      overlay.innerHTML = `
        <div class="pwa-modal">
          <div class="pwa-modal-glyph">📲</div>
          <h3>${title}</h3>
          <p>Get quick access to your birth charts and daily vibes directly from your home screen.</p>
          <ol class="pwa-steps">
            ${stepsHTML}
          </ol>
          <button type="button" class="pwa-modal-close" id="pwaModalClose">Got it</button>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector("#pwaModalClose").addEventListener("click", () => {
        overlay.classList.remove("open");
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.remove("open");
      });
    }

    void overlay.offsetWidth;
    overlay.classList.add("open");
  }

  async function handleInstallClick(e) {
    if (e) e.preventDefault();

    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          deferredPrompt = null;
          window.deferredPwaPrompt = null;
          updateInstallUI();
        }
      } catch (err) {
        showPwaModal();
      }
    } else {
      showPwaModal();
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("[data-pwa-install], .pwa-install-btn, .pwa-install-chip, .pwa-btn");
    if (btn) {
      handleInstallClick(e);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateInstallUI);
  } else {
    updateInstallUI();
  }
})();
