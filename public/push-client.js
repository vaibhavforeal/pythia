// Registering this device for the daily notification.
//
// No-ops entirely on the web: there's no plugin, and the whole flow only means
// anything inside the native shell.
//
// WHEN it asks matters more than the code. Asking on first launch is the
// classic way to lose the permission forever — the user has seen nothing, says
// no, and on Android 13+ that answer sticks. So this is called after a chart
// has been cast, when there's an obvious reason to want a daily line.
//
// The plugin is reached through window.Capacitor.Plugins rather than an import,
// because the frontend ships as plain scripts with no bundler.

(function () {
  const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  const PN = plugins.PushNotifications;
  let started = false;

  /** The device's own offset — the server sends at 8am local, wherever that is. */
  function tzOffsetMinutes() {
    // getTimezoneOffset is minutes BEHIND local, i.e. inverted from what we want.
    return -new Date().getTimezoneOffset();
  }

  function platform() {
    try {
      return (window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || "web";
    } catch (_) {
      return "web";
    }
  }

  async function sendToken(token) {
    if (!token) return;
    try {
      await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, platform: platform(), tzOffsetMinutes: tzOffsetMinutes() })
      });
      try { localStorage.setItem("pythia_device_token", token); } catch (_) { /* ignore */ }
    } catch (_) {
      // Not worth surfacing: the reading on screen is unaffected, and the next
      // launch registers again.
    }
  }

  /**
   * Ask for permission and register. Safe to call repeatedly — it only runs
   * once per launch, and never on the web.
   */
  async function initPush() {
    if (started || !PN) return;
    started = true;
    try {
      let status = (await PN.checkPermissions()).receive;
      if (status === "prompt" || status === "prompt-with-rationale") {
        status = (await PN.requestPermissions()).receive;
      }
      if (status !== "granted") return; // declined; nothing more to do

      // The token arrives asynchronously via the listener, not from register().
      PN.addListener("registration", ({ value }) => sendToken(value));
      PN.addListener("registrationError", err =>
        console.warn("push registration failed:", err && err.error));

      // Tapping a notification should land somewhere relevant rather than just
      // opening the app. The daily line's `kind` says which card it came from.
      PN.addListener("pushNotificationActionPerformed", ev => {
        const kind = ev && ev.notification && ev.notification.data && ev.notification.data.kind;
        if (!kind) return;
        const card = document.querySelector(".vc-today") || document.querySelector("#profile");
        if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      await PN.register();
    } catch (err) {
      console.warn("push setup failed:", err && err.message);
    }
  }

  /**
   * Forget this device on logout. Without it, whoever had the app last keeps
   * receiving another person's daily line on a shared phone.
   */
  async function unregisterPush() {
    let token = null;
    try { token = localStorage.getItem("pythia_device_token"); } catch (_) { /* ignore */ }
    if (!token) return;
    try {
      await fetch(`/api/devices/${encodeURIComponent(token)}`, { method: "DELETE" });
    } catch (_) {
      /* best effort */
    }
    try { localStorage.removeItem("pythia_device_token"); } catch (_) { /* ignore */ }
  }

  window.PythiaPush = { init: initPush, unregister: unregisterPush, available: !!PN };
})();
