// The call: microphone in, Pythia's voice out.
//
// Media goes browser-to-Azure directly over WebRTC. The server never touches
// audio — it holds the API key, loads the chart, writes the instructions and
// answers the SDP offer. That split is the guardrail, and the spike confirmed
// it holds: a hostile session.update pushed down this data channel changed
// nothing about what the agent would say.
//
// Deliberately a separate file. app.js is already 2,300 lines and does
// everything; a realtime audio pipeline does not belong inside it. Loaded after
// app.js so it shares that top-level scope and can read `chart` and call
// loadConversations(), the same way domains.js already does.
(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  let pc = null;          // the peer connection
  let stream = null;      // the microphone
  let dc = null;          // data channel, for UI state only
  let sessionId = null;
  let beat = null;        // heartbeat interval
  let hiddenSince = 0;

  const state = s => {
    const el = $("callState");
    if (el) el.textContent = s;
    const shell = $("callOverlay");
    if (shell) shell.dataset.state = s;
  };

  const caption = t => {
    const el = $("callCaption");
    if (el) el.textContent = t;
  };

  function show(view) {
    const o = $("callOverlay");
    if (!o) return;
    o.hidden = false;
    o.dataset.view = view;   // "live" | "error"
    document.body.classList.add("call-open");
  }

  function hide() {
    const o = $("callOverlay");
    if (o) { o.hidden = true; o.dataset.view = ""; }
    document.body.classList.remove("call-open");
  }

  function fail(title, detail) {
    show("error");
    const t = $("callErrTitle");
    const d = $("callErrDetail");
    if (t) t.textContent = title;
    if (d) d.textContent = detail || "";
  }

  // --- Teardown ---------------------------------------------------------------
  // Called from the end button, from a failed connection, and from beforeunload.
  // Must be safe to call twice, and must always stop the microphone — a call
  // that ends with the mic light still on is its own kind of betrayal.
  function teardown(notifyServer) {
    if (beat) { clearInterval(beat); beat = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (dc) { try { dc.close(); } catch (_) {} dc = null; }
    if (pc) { try { pc.close(); } catch (_) {} pc = null; }

    const id = sessionId;
    sessionId = null;
    if (id && notifyServer) {
      fetch(`/api/voice/session/${id}/end`, { method: "POST" })
        .catch(() => {})
        .then(() => { if (typeof loadConversations === "function") loadConversations(); });
    }
  }

  function endCall() {
    teardown(true);
    hide();
  }

  // --- Starting ---------------------------------------------------------------
  async function start() {
    if (sessionId) return;

    // The chart is loaded server-side for the call, but there is no point
    // opening an overlay to be told that: app.js already knows whether one has
    // been cast, so say so before asking for the microphone.
    if (typeof chart === "undefined" || !chart) {
      fail("Cast your chart first", "Pythia reads from your chart on a call — set your birth details, then we can talk.");
      show("error");
      return;
    }

    show("live");
    state("connecting");
    caption("");

    // Asked BEFORE the server is contacted, so a denied prompt costs nothing —
    // no session, no minute charged.
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (err) {
      // These need different instructions, so they get different messages.
      if (err && err.name === "NotAllowedError") {
        fail("Microphone blocked",
          "Allow the microphone for this site — the padlock in the address bar on desktop, " +
          "or Settings › Safari › Microphone on iPhone — then try again.");
      } else if (err && err.name === "NotFoundError") {
        fail("No microphone found", "Plug one in or switch to a device with a mic, then try again.");
      } else {
        fail("Couldn't use the microphone", (err && err.message) || "");
      }
      teardown(false);
      return;
    }

    try {
      // Without STUN the browser gathers only host candidates — a LAN address
      // Azure cannot route back to — and the call connects, then dies silently
      // with no audio. This cost an evening to find in the spike.
      pc = new RTCPeerConnection({
        iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
      });
    } catch (err) {
      fail("Calls aren't supported here", "This browser blocked the connection.");
      teardown(false);
      return;
    }

    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === "connected") state("listening");
      if (pc.connectionState === "failed") {
        fail("The call dropped", "Check your connection and try again.");
        teardown(true);
      }
    };

    pc.ontrack = ev => {
      const a = $("callAudio");
      if (a) a.srcObject = ev.streams[0];
    };

    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    dc = pc.createDataChannel("voice-live-events");
    dc.onmessage = ev => onEvent(ev.data);

    await pc.setLocalDescription(await pc.createOffer());

    // Wait for ICE, but never forever: a network with no reachable STUN never
    // fires the completion event, and without this escape the call hangs on
    // "connecting" with no error at all.
    await new Promise(resolve => {
      if (pc.iceGatheringState === "complete") return resolve();
      const done = () => {
        clearTimeout(timer);
        if (pc) pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => { if (pc && pc.iceGatheringState === "complete") done(); };
      const timer = setTimeout(done, 3000);
      pc.addEventListener("icegatheringstatechange", check);
    });

    let body;
    try {
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: pc.localDescription.sdp, voice: currentVoice() })
      });
      body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 && typeof showAuth === "function") { teardown(false); hide(); return showAuth(); }
        // The server's refusals are written to be read by a person — a missing
        // chart, a spent budget, the feature being off — so show them as-is
        // rather than replacing them with something vaguer.
        fail(res.status === 429 ? "That's today's voice time" : "Couldn't start the call",
          body.error || `Something went wrong (${res.status}).`);
        teardown(false);
        return;
      }
    } catch (err) {
      fail("Couldn't reach Pythia", "Check your connection and try again.");
      teardown(false);
      return;
    }

    sessionId = body.sessionId;
    await pc.setRemoteDescription({ type: "answer", sdp: body.sdpAnswer });
    state("listening");
    showMinutes(body.minutesLeft);

    // Keeps the session alive and surfaces the budget. The server ends a call
    // that stops beating, so a closed tab cannot hold a metered session open.
    const everyMs = Math.max(5, Number(body.heartbeatSeconds) || 15) * 1000;
    beat = setInterval(async () => {
      if (!sessionId) return;
      try {
        const r = await fetch(`/api/voice/session/${sessionId}/heartbeat`, { method: "POST" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.ended) {
          fail("The call ended", j.reason === "budget" ? "That's today's voice time." : "");
          teardown(false);
          return;
        }
        showMinutes(j.minutesLeft, j.secondsLeft);
      } catch (_) { /* one missed beat is not a dropped call */ }
    }, everyMs);
  }

  function currentVoice() {
    const sel = $("callVoice");
    return sel ? sel.value : "warm";
  }

  function showMinutes(minutes, secondsLeft) {
    const el = $("callMeta");
    if (!el) return;
    if (secondsLeft !== undefined && secondsLeft <= 60) {
      el.textContent = `${secondsLeft}s left on this call`;
    } else if (minutes !== undefined) {
      el.textContent = `${minutes} min left today`;
    }
  }

  // --- Live state -------------------------------------------------------------
  // The data channel is used ONLY to drive the interface. Nothing here is
  // trusted, and nothing here is persisted — the server records the call from
  // its own control socket.
  function onEvent(raw) {
    let evt;
    try { evt = JSON.parse(raw); } catch (_) { return; }

    switch (evt.type) {
      case "input_audio_buffer.speech_started":
        state("hearing");
        caption("");
        break;
      case "response.created":
        state("thinking");
        break;
      case "response.audio_transcript.delta":
        state("speaking");
        caption(($("callCaption").textContent || "") + (evt.delta || ""));
        break;
      case "response.done":
        state("listening");
        break;
    }
  }

  // --- Wiring -----------------------------------------------------------------
  function init() {
    const mic = $("micBtn");
    if (!mic) return;

    // The Capacitor shell has no android/ or ios/ project committed, so it has
    // no RECORD_AUDIO permission and getUserMedia would fail after the overlay
    // had already opened. Hide the button there until a native project exists.
    const native = window.PythiaAuth && window.PythiaAuth.native;
    if (native) { mic.hidden = true; return; }

    mic.addEventListener("click", start);
    const endBtn = $("callEnd");
    if (endBtn) endBtn.addEventListener("click", endCall);
    const closeBtn = $("callClose");
    if (closeBtn) closeBtn.addEventListener("click", () => { teardown(true); hide(); });

    const mute = $("callMute");
    if (mute) {
      mute.addEventListener("click", () => {
        if (!stream) return;
        const on = stream.getAudioTracks().some(t => t.enabled);
        stream.getAudioTracks().forEach(t => (t.enabled = !on));
        mute.setAttribute("aria-pressed", String(on));
        mute.textContent = on ? "Unmute" : "Mute";
      });
    }

    // A closed tab must not hold a metered session for the full idle timeout.
    // sendBeacon cannot set headers, so it works on the web (cookie) and the
    // idle timer remains the backstop everywhere else.
    window.addEventListener("beforeunload", () => {
      if (sessionId && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/voice/session/${sessionId}/end`);
      }
    });

    // Backgrounding a tab for a while is almost always someone walking away
    // from a call they forgot to end, and it is billing the whole time.
    document.addEventListener("visibilitychange", () => {
      if (!sessionId) return;
      if (document.hidden) {
        hiddenSince = Date.now();
      } else if (hiddenSince && Date.now() - hiddenSince > 30000) {
        endCall();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.PythiaVoice = { start, end: endCall, get active() { return Boolean(sessionId); } };
})();
