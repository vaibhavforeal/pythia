// ---- State ----------------------------------------------------------------
let chart = null;
const history = []; // [{ role, content }]
let match = null; // last compatibility result + partner chart, shared with the chat
let streaming = false;
let nodeMode = "jupiter"; // Rahu/Ketu aspects: "jupiter" (5/7/9) | "seventh" (7 only)
let lastInput = null; // last birth input, so the node toggle can recompute
let currentVarga = "D10"; // which divisional chart the selector shows
let currentBav = "Saturn"; // which planet's Bhinnashtakavarga the SAV table shows
// Nerd mode is a sticky preference (sidebar switch), not a per-visit disclosure.
let nerdOpen = (() => {
  try { return localStorage.getItem("nerdMode") === "1"; } catch (_) { return false; }
})();

// ---- Elements -------------------------------------------------------------
const $ = id => document.getElementById(id);
const form = $("birthForm");
const cityInput = $("city");
const cityList = $("cityList");
const messagesEl = $("messages");
const welcomeEl = $("welcome");
const suggestionsEl = $("suggestions");
const composer = $("composer");
const input = $("input");
const sendBtn = $("sendBtn");

// Auth + saved-people elements
const authOverlay = $("authOverlay");
const account = $("account");
const authForm = $("authForm");
const authErr = $("authErr");
const authSubmit = $("authSubmit");
const googleBtn = $("googleBtn");
const authDivider = $("authDivider");
let pendingAuthError = null; // a Google-redirect error to show on the login screen
const peopleCard = $("peopleCard");
const peopleList = $("peopleList");
const peopleEmpty = $("peopleEmpty");
const peopleErr = $("peopleErr");
const savePersonBtn = $("savePersonBtn");
// Saved-chats (conversations) elements
const convCard = $("convCard");
const convList = $("convList");
const convEmpty = $("convEmpty");
const newChatBtn = $("newChatBtn");
let authMode = "login";
let peopleById = {};
let currentConvId = null; // the saved conversation the chat is currently writing to
const pad = n => String(n).padStart(2, "0");

// Mobile slide-in drawer for the chart / compatibility panel (no effect on desktop)
const appEl = document.querySelector(".app");
const panelToggle = $("panelToggle");
const panelClose = $("panelClose");
const panelScrim = $("panelScrim");
const mobileBar = $("mobileBar");
function setPanelOpen(open) {
  appEl.classList.toggle("panel-open", open);
  if (panelToggle) panelToggle.setAttribute("aria-expanded", open ? "true" : "false");
}
if (panelToggle) panelToggle.addEventListener("click", () => setPanelOpen(!appEl.classList.contains("panel-open")));
if (panelClose) panelClose.addEventListener("click", () => setPanelOpen(false));
if (panelScrim) panelScrim.addEventListener("click", () => setPanelOpen(false));

if (window.marked) {
  marked.setOptions({ breaks: true, gfm: true });
}

// escAttr / wireCityGeocode / coordsMissing live in geocode.js (shared with
// the public invite page); that script loads first.
const releaseCoords = wireCityGeocode(cityInput, cityList, $("lat"), $("lon"), $("tz"));

// ---- "Enter coordinates manually" toggle ----------------------------------
// Lat/lon/tz are auto-filled from the city pick, so they're hidden by default.
// This reveals them for manual entry / overrides (and validation opens them if
// a city wasn't picked). Returns a fn that force-reveals the section.
function wireAdvanced(toggleId, fieldsId) {
  const t = $(toggleId), f = $(fieldsId);
  if (!t || !f) return () => {};
  const set = open => {
    f.hidden = !open;
    t.setAttribute("aria-expanded", open ? "true" : "false");
    const caret = t.querySelector(".adv-caret");
    if (caret) caret.textContent = open ? "▴" : "▾";
    const label = t.querySelector(".adv-label");
    if (label) label.textContent = open ? "hide coordinates" : "enter coordinates manually";
  };
  t.addEventListener("click", () => set(f.hidden));
  return () => set(true);
}
const revealAdvanced = wireAdvanced("advToggle", "advFields");

// ---- Birth form collapse --------------------------------------------------
// Mirrors wireAdvanced's toggle vocabulary. The form starts open (nothing cast
// yet) and collapses once there's a chart, since your chart sticks.
function setFormOpen(open) {
  const f = $("birthForm"), t = $("formToggle");
  if (!f || !t) return;
  f.hidden = !open;
  t.hidden = false;
  t.setAttribute("aria-expanded", open ? "true" : "false");
  const label = t.querySelector(".ft-label");
  if (label) label.textContent = open ? "hide birth details" : "edit my birth details";
  const caret = t.querySelector(".ft-caret");
  if (caret) caret.textContent = open ? "⌃" : "⌄";
}

// Drop a birth input back into the form fields.
function fillBirthForm(b) {
  if (!b) return;
  $("name").value = b.name && b.name !== "Unnamed" ? b.name : "";
  $("dob").value = `${b.year}-${pad(b.month)}-${pad(b.day)}`;
  $("tob").value = `${pad(b.hour)}:${pad(b.minute)}`;
  $("lat").value = b.lat;
  $("lon").value = b.lon;
  $("tz").value = b.tz;
  $("city").value = "";
  releaseCoords(); // these coordinates are the saved ones, not a city pick
}

function setupChartControls() {
  const toggle = $("formToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const opening = $("birthForm").hidden;
      // While a one-off chart is on screen the fields hold *their* details, so
      // reload yours — otherwise "edit my birth details" would quietly save
      // someone else's birth as your profile.
      if (opening && viewingOther) fillBirthForm(loadMyBirth());
      setFormOpen(opening);
    });
  }

  const other = $("checkOther");
  if (other) {
    other.addEventListener("click", () => {
      pendingOther = true;
      setFormOpen(true);
      // Blank the identity fields so nobody accidentally recasts themselves,
      // and drop the coordinates so a stale city can't be reused.
      for (const id of ["name", "city", "dob", "tob", "lat", "lon", "tz"]) {
        const el = $(id);
        if (el) el.value = "";
      }
      releaseCoords();
      $("formErr").hidden = true;
      $("name").focus();
    });
  }

  const back = $("backToMine");
  if (back) {
    back.addEventListener("click", async () => {
      const mine = loadMyBirth();
      if (!mine) return;
      pendingOther = false;
      lastInput = mine;
      if (await castChart(mine, true)) setViewing(null);
    });
  }
}
setupChartControls();

// ---- Cast chart -----------------------------------------------------------
form.addEventListener("submit", async e => {
  e.preventDefault();
  $("formErr").hidden = true;

  const dob = $("dob").value; // YYYY-MM-DD
  const tob = $("tob").value || "12:00"; // HH:MM
  if (!dob) return showFormErr("Please enter a date of birth.");

  if (coordsMissing($("lat"), $("lon"), $("tz"))) {
    revealAdvanced(); // show the fields so the user can see what's needed
    // Lat/lon present but no tz means the geocoder knew the place but not its
    // timezone — say so, rather than sending the user back to the city box.
    const located = [$("lat"), $("lon")].every(el => String(el.value).trim() !== "");
    return showFormErr(
      located
        ? "We couldn't work out the UTC offset for that place — please enter it below."
        : "Pick your city from the list so we can locate your chart — or add coordinates manually below."
    );
  }

  const [year, month, day] = dob.split("-").map(Number);
  const [hour, minute] = tob.split(":").map(Number);

  lastInput = {
    name: $("name").value.trim(),
    year, month, day, hour, minute,
    lat: $("lat").value, lon: $("lon").value, tz: $("tz").value
  };
  // A cast started from "check someone else" is a one-off view; anything else
  // is you, and becomes the profile that sticks.
  const asOther = pendingOther;
  pendingOther = false;
  const ok = await castChart(lastInput, true);
  if (!ok) return; // cast failed — leave whatever was on screen alone
  if (asOther) setViewing(lastInput.name || "their chart");
  else { saveMyBirth(lastInput); setViewing(null); }
});

// ---- Invite links ---------------------------------------------------------
// "cast your chart, we'll compare": mint a link, they open it with no account,
// you both get the score. The link always encodes YOUR birth — deliberately
// read from myBirth, not lastInput, so minting while viewing someone else's
// chart can't send their details out into the world.
function inviteUrl(token) {
  return `${location.origin}/i/${token}`;
}

async function createInvite() {
  const btn = $("inviteBtn"), err = $("inviteErr");
  const mine = loadMyBirth();
  if (!mine) {
    err.textContent = "Cast your own chart first.";
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Creating…";
  try {
    const roleEl = document.querySelector('input[name="inviteRole"]:checked');
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...mine, role: roleEl ? roleEl.value : "groom" })
    });
    if (res.status === 401) return showAuth();
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not create your link.");

    const url = inviteUrl(data.token);
    $("inviteLink").value = url;
    $("inviteLinkRow").hidden = false;
    await shareInvite(url);
    loadInviteResponses();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Native share sheet where it exists (that's where the link actually spreads),
// clipboard otherwise. Neither is guaranteed, so the URL stays on screen too.
async function shareInvite(url) {
  const text = "check our cosmic compatibility ✦";
  try {
    if (navigator.share) return await navigator.share({ title: "Pythia", text, url });
  } catch (e) {
    if (e && e.name === "AbortError") return; // user dismissed the sheet
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("link copied ✦");
  } catch (_) {
    $("inviteLink").select();
  }
}

async function loadInviteResponses() {
  const host = $("inviteResponses");
  if (!host) return;
  try {
    const res = await fetch("/api/invites/responses");
    if (!res.ok) return;
    const data = await res.json();
    if (data.token) {
      $("inviteLink").value = inviteUrl(data.token);
      $("inviteLinkRow").hidden = false;
    }
    const rows = (data.responses || []).map(r => {
      const score = Number.isFinite(r.total) ? `${fmtScore(r.total)}/${r.max}` : "—";
      return `<li><span class="ir-name">${escAttr(r.name || "Someone")}</span>
        <span class="ir-score ir-${escAttr(r.band || "average")}">${score}</span></li>`;
    }).join("");
    host.innerHTML = rows
      ? `<div class="ir-title">who's checked</div><ul>${rows}</ul>`
      : "";
  } catch (_) {
    /* the invite box still works without the list */
  }
}

function setupInvite() {
  const btn = $("inviteBtn");
  if (btn) btn.addEventListener("click", createInvite);
  const copy = $("inviteCopy");
  if (copy) {
    copy.addEventListener("click", async () => {
      const url = $("inviteLink").value;
      if (url) await shareInvite(url);
    });
  }
}
setupInvite();

// ---- Friends: Soul ID, requests, constellation ----------------------------
// Everything here deals in names, Soul IDs, signs and scores. The server never
// sends another person's birth details, so there's nothing sensitive to guard
// on this side — see server/friends.js.
let myAccount = null;

const FLOW_COPY = {
  flowing: { label: "flowing", hint: "the Moon's good to you both today" },
  steady: { label: "steady", hint: "an ordinary day between you" },
  friction: { label: "friction", hint: "the Moon's awkward for one of you" }
};

async function loadAccount() {
  try {
    const res = await fetch("/api/account");
    if (!res.ok) return null;
    myAccount = await res.json();
    renderSoulId();
    return myAccount;
  } catch (_) {
    return null;
  }
}

function renderSoulId() {
  const row = $("soulRow"), hint = $("soulHint"), card = $("friendsCard");
  if (!row || !card) return;
  card.hidden = false;
  const id = myAccount && myAccount.soulId;
  row.hidden = !id;
  if (hint) hint.hidden = !!id;
  if (id) $("soulValue").textContent = id;
  // Without a Soul ID you can still receive requests, but not be found.
  const form = $("addFriendForm");
  if (form) form.hidden = false;
}

async function loadFriends() {
  const host = $("constellation");
  if (!host) return;
  try {
    const res = await fetch("/api/friends");
    if (!res.ok) return;
    const data = await res.json();
    const n = (data.friends || []).length;
    const count = $("friendCount");
    if (count) count.textContent = n ? String(n) : "";

    if (!n) {
      host.innerHTML = data.needsBirth
        ? `<p class="fr-empty">Cast your chart to see how you line up with people.</p>`
        : `<p class="fr-empty">No one here yet — share your Soul ID or add someone by theirs.</p>`;
      return;
    }
    host.innerHTML = data.friends.map(friendRow).join("");
  } catch (_) {
    /* the rest of the sidebar still works */
  }
}

function friendRow(f) {
  const glyph = Number.isInteger(f.moonSignIndex) ? ZODIAC_GLYPH[f.moonSignIndex] : "✦";
  const flow = f.flow && FLOW_COPY[f.flow.key];
  const score = f.match ? `${fmtScore(f.match.total)}/${f.match.max}` : "—";
  return `
    <div class="fr-row" data-id="${escAttr(f.id)}">
      <span class="fr-glyph" aria-hidden="true">${glyph}</span>
      <div class="fr-main">
        <b>${escAttr(f.name)}</b>
        <small>${escAttr(f.soulId || "")}</small>
      </div>
      ${flow ? `<span class="fr-flow fr-${escAttr(f.flow.key)}" title="${escAttr(flow.hint)}">${flow.label}</span>` : ""}
      <span class="fr-score">${score}</span>
      <button type="button" class="fr-menu" data-act="remove" title="Remove or block">⋯</button>
    </div>`;
}

async function loadFriendRequests() {
  const host = $("friendRequests");
  if (!host) return;
  try {
    const res = await fetch("/api/friends/requests");
    if (!res.ok) return;
    const { requests } = await res.json();
    if (!requests || !requests.length) { host.innerHTML = ""; return; }
    host.innerHTML =
      `<div class="fr-title">wants to connect</div>` +
      requests.map(r => `
        <div class="fr-req" data-pair="${escAttr(r.pairKey)}">
          <span class="fr-glyph" aria-hidden="true">${Number.isInteger(r.moonSignIndex) ? ZODIAC_GLYPH[r.moonSignIndex] : "✦"}</span>
          <div class="fr-main">
            <b>${escAttr(r.name)}</b>
            <small>${escAttr([r.moonSign, r.risingSign].filter(Boolean).join(" · "))}</small>
          </div>
          <button type="button" data-act="accept">accept</button>
          <button type="button" data-act="decline" class="fr-decline">✕</button>
        </div>`).join("");
  } catch (_) {
    /* non-fatal */
  }
}

function showFriendErr(msg) {
  const el = $("friendErr");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function setupFriends() {
  const form = $("addFriendForm");
  if (form) {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      $("friendErr").hidden = true;
      const input = $("addFriendInput");
      const soulId = input.value.trim();
      if (!soulId) return;
      const btn = $("addFriendBtn");
      btn.disabled = true;
      try {
        const res = await fetch("/api/friends/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ soulId })
        });
        if (res.status === 401) return showAuth();
        const data = await res.json();
        if (!res.ok) return showFriendErr(data.error || "Couldn't send that request.");
        input.value = "";
        toast("request sent ✦");
      } catch (_) {
        showFriendErr("Couldn't reach Pythia — try again.");
      } finally {
        btn.disabled = false;
      }
    });
  }

  const copy = $("soulCopy");
  if (copy) {
    copy.addEventListener("click", async () => {
      const id = myAccount && myAccount.soulId;
      if (!id) return;
      try {
        await navigator.clipboard.writeText(id);
        toast("Soul ID copied ✦");
      } catch (_) {
        /* clipboard blocked — the value is on screen to select */
      }
    });
  }

  // Requests and rows are re-rendered constantly, so delegate from the card.
  const card = $("friendsCard");
  if (!card) return;
  card.addEventListener("click", async e => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;

    const req = btn.closest(".fr-req");
    if (req && (act === "accept" || act === "decline")) {
      const pair = encodeURIComponent(req.dataset.pair);
      btn.disabled = true;
      try {
        await fetch(`/api/friends/requests/${pair}/${act}`, { method: "POST" });
        await Promise.all([loadFriendRequests(), loadFriends()]);
        if (act === "accept") toast("connected ✦");
      } catch (_) {
        showFriendErr("That didn't go through — try again.");
      }
      return;
    }

    const row = btn.closest(".fr-row");
    if (row && act === "remove") {
      const id = row.dataset.id;
      const name = (row.querySelector("b") || {}).textContent || "them";
      // Two destructive options behind one control; confirm which.
      const choice = window.prompt(
        `Type "remove" to disconnect from ${name}, or "block" to also stop them contacting you.`, "remove");
      if (!choice) return;
      const c = choice.trim().toLowerCase();
      if (c !== "remove" && c !== "block") return;
      try {
        await fetch(c === "block" ? `/api/friends/${id}/block` : `/api/friends/${id}`, {
          method: c === "block" ? "POST" : "DELETE"
        });
        await loadFriends();
        toast(c === "block" ? "blocked" : "removed");
      } catch (_) {
        showFriendErr("That didn't go through — try again.");
      }
    }
  });
}
setupFriends();

// ---- Whose chart is on screen ---------------------------------------------
// Your own chart is the profile: stored locally and restored on load, so it
// never has to be cast again. Anyone else is a transient view — never written
// to myBirth, never becomes the profile.
const MY_BIRTH_KEY = "myBirth";
let pendingOther = false; // the next submit is a one-off, not you
let viewingOther = false;

// Local cache only — used when echoing back what the server just gave us, so we
// don't POST it straight home again.
function cacheMyBirth(input) {
  try { localStorage.setItem(MY_BIRTH_KEY, JSON.stringify(input)); } catch (_) { /* private mode */ }
  syncInviteBox(); // the first cast stores the profile *after* the render runs
}

function saveMyBirth(input) {
  cacheMyBirth(input);
  // Also server-side: friend compatibility needs it there, and it's what makes
  // the profile follow you to a new device. Fire-and-forget — a failure here
  // must not block the reading that's already on screen.
  const role = (document.querySelector('input[name="inviteRole"]:checked') || {}).value;
  fetch("/api/account/birth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, role: role === "bride" ? "bride" : "groom" })
  }).catch(() => { /* stays local until the next successful save */ });
}

// The invite link always encodes your own birth, so the box needs a stored
// profile — not merely a chart on screen. Driven from both the render and
// saveMyBirth so the two can't disagree about whether a profile exists.
function syncInviteBox() {
  const ib = $("inviteBox");
  if (ib) ib.hidden = !loadMyBirth();
}
function loadMyBirth() {
  try {
    const raw = localStorage.getItem(MY_BIRTH_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && Number.isFinite(Number(v.year)) ? v : null;
  } catch (_) {
    return null;
  }
}

// label === null means "this is you".
function setViewing(label) {
  viewingOther = label !== null;
  const who = $("phWho"), back = $("backToMine"), head = $("profileHead");
  if (head) head.hidden = false;
  if (who) {
    who.textContent = viewingOther ? `viewing · ${label}` : "your chart";
    who.classList.toggle("is-other", viewingOther);
  }
  if (back) back.hidden = !viewingOther;
  const app = document.querySelector(".app");
  if (app) app.classList.toggle("viewing-other", viewingOther);
}

// Restore the profile on load so a returning user lands on their own chart.
// The server copy wins: it's the one that followed you to this device.
async function restoreMyChart(serverBirth) {
  const mine = serverBirth || loadMyBirth();
  if (!mine) return false;
  if (serverBirth) cacheMyBirth(serverBirth); // cache, don't POST it back
  lastInput = mine;
  const ok = await castChart(mine, true);
  if (ok) setViewing(null);
  return ok;
}

// Compute (or recompute) the chart. reset=true starts a fresh consultation;
// reset=false (node-aspect toggle) keeps the ongoing conversation.
// Returns true only if a new chart was actually cast — a failure leaves the
// previous `chart` in place, so callers can't use it to detect success.
async function castChart(input, reset) {
  const btn = $("computeBtn");
  btn.disabled = true;
  if (reset) btn.textContent = "Casting…";
  try {
    const res = await fetch("/api/chart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, nodeMode })
    });
    if (res.status === 401) { showAuth(); return false; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to compute chart.");

    chart = data;
    if (savePersonBtn) savePersonBtn.disabled = false;
    if (reset) {
      history.length = 0;
      match = null; // a new person → any prior compatibility result is stale
      currentConvId = null; // a new chart starts a new saved conversation
      clearConversation();
      enableChat();
      highlightActiveConv();
      const mr = $("matchResult");
      if (mr) { mr.hidden = true; mr.innerHTML = ""; }
      // A new person means any prior ship check is stale, so fold the form
      // away again — the ship-check card reopens it on demand.
      const mc = $("matchCard");
      if (mc) mc.hidden = true;
    }
    renderChartCard(data);
    return true;
  } catch (err) {
    showFormErr(err.message);
    return false;
  } finally {
    btn.disabled = false;
    btn.textContent = "cast my chart ✦";
  }
}

function showFormErr(msg) {
  const errEl = $("formErr");
  errEl.textContent = msg;
  errEl.hidden = false;
}

// ---- Cosmic ID: the "big three" identity snapshot -------------------------
// One short vibe per Moon rashi (signIndex 0=Aries … 11=Pisces). The Moon is
// the emotional/identity core in Jyotish, so it headlines the card.
const SIGN_VIBES = [
  "bold, first-mover, zero chill",             // Aries · Mesha
  "grounded, magnetic, worth the wait",        // Taurus · Vrishabha
  "quick-witted, curious, always dual-tasking",// Gemini · Mithuna
  "soft heart, steel core, deeply felt",       // Cancer · Karka
  "main-character energy, born to shine",       // Leo · Simha
  "sharp eye, quiet flex, low-key perfectionist",// Virgo · Kanya
  "charming, fair, aesthetic-coded",            // Libra · Tula
  "intense, magnetic, sees everything",         // Scorpio · Vrishchika
  "free spirit, big vision, forever wandering", // Sagittarius · Dhanu
  "ambitious, patient, plays the long game",    // Capricorn · Makara
  "original, humane, ahead of the curve",       // Aquarius · Kumbha
  "dreamy, intuitive, feels the unseen"         // Pisces · Meena
];

// Zodiac glyphs + classical elements by signIndex (0=Aries…11=Pisces) — powers
// the Cosmic ID's element identity, accent colour and inline sign glyphs.
// The trailing ︎ forces text (monochrome) presentation — without it these
// render as colour emoji on Windows/Android.
const ZODIAC_GLYPH = ["♈︎", "♉︎", "♊︎", "♋︎", "♌︎", "♍︎", "♎︎", "♏︎", "♐︎", "♑︎", "♒︎", "♓︎"];
const ELEMENTS = [
  { name: "Fire",  color: "#fb7185" },
  { name: "Earth", color: "#34d399" },
  { name: "Air",   color: "#7dd3fc" },
  { name: "Water", color: "#60a5fa" }
];
// Aries=Fire, Taurus=Earth, Gemini=Air, Cancer=Water, then repeating.
const elementOf = i => ELEMENTS[(((i % 4) + 4) % 4)] || ELEMENTS[0];

// Astrological glyph per graha, for the "era" card (Mars/Venus need ︎ to
// stay monochrome). Rahu/Ketu use the ascending/descending node symbols.
const PLANET_GLYPH = {
  Sun: "☉", Moon: "☽", Mars: "♂︎", Mercury: "☿",
  Jupiter: "♃", Venus: "♀︎", Saturn: "♄", Rahu: "☊", Ketu: "☋"
};

// Gen Z headline per Guna Milan band (thresholds set server-side in
// gunamilan.js: poor <18, average 18-24, good 25-32, excellent ≥33).
const SHIP = {
  excellent: { emoji: "✦", head: "written in the stars", sub: "basically soulmates" },
  good:      { emoji: "♡", head: "green-flag energy",     sub: "strong match" },
  average:   { emoji: "◑", head: "worth a shot",          sub: "potential, needs effort" },
  poor:      { emoji: "△", head: "the stars said pause",  sub: "proceed with caution" }
};

// Gen Z gloss for the running Vimshottari dasha lord — the "era" you're in.
// Keyed by planet name (server sends d.maha.lord / d.antar.lord).
const PLANET_ERA = {
  Sun:     { head: "main-character era",     line: "visibility, authority, ego glow-up. time to be seen and take the lead." },
  Moon:    { head: "soft / all-feels era",   line: "emotions, home and comfort run the show. nurture yourself and your people." },
  Mars:    { head: "beast-mode era",         line: "drive, courage, competition. channel the heat into the goal — don't burn out." },
  Mercury: { head: "hustle & comms era",     line: "deals, skills, networking, side quests. your mind is the money right now." },
  Jupiter: { head: "glow-up era",            line: "growth, luck, wisdom, expansion. say yes to the bigger thing." },
  Venus:   { head: "soft-life & love era",   line: "romance, beauty, luxury, art. treat yourself and let people in." },
  Saturn:  { head: "lock-in / hard-mode era", line: "discipline, patience, real results. put in the reps — it pays off later." },
  Rahu:    { head: "chaotic-ambition era",   line: "obsession, hype, big swings, foreign vibes. dream huge but stay grounded." },
  Ketu:    { head: "detachment / inner era", line: "letting go, spirituality, quiet endings. less noise, more meaning." }
};

// Gen Z one-liner per yoga category (server tags each yoga with .category).
// Favorable yogas become "green flags"; challenging ones surface under Heads-up.
// Multiple yogas can share a category, so cards group by category (see
// groupYogas) to avoid repeating the same gloss.
const YOGA_VIBES = {
  Mahapurusha: { emoji: "✶", title: "great-person energy", line: "a rare 'great person' placement — genuine main-character coding." },
  Raja:        { emoji: "✦", title: "built to rise",       line: "power & status yoga — you climb, and people notice." },
  Dhana:       { emoji: "◈", title: "money magnet",        line: "wealth yoga — the bag follows when you lean in." },
  Lunar:       { emoji: "☾", title: "emotionally held",    line: "support yoga — you're rarely left carrying it alone." },
  Special:     { emoji: "✧", title: "one of one",          line: "a rare combo — a genuine one-of-one edge." },
  Challenging: { emoji: "△", title: "plot-twist arc",      line: "an intense pattern — real growth through the hard stuff." }
};

// YOGA_ALIAS / yogaAlias() live in yoga-names.js (shared with the rarity
// generator); YOGA_RARITY in the generated yoga-rarity.js. Both load first.

// How rare a yoga is, as a share of sampled charts — see tools/yoga-frequency.js.
// Anything at or above this is too common to call a superpower, so it renders
// without a badge rather than bragging about a coin flip.
const RARITY_BADGE_MAX = 25;
function yogaRarity(alias) {
  if (typeof YOGA_RARITY === "undefined") return null;
  const pct = YOGA_RARITY[alias];
  return Number.isFinite(pct) ? pct : null;
}
// "6%" for the genuinely rare, "<1%" rather than "0%" for the very rare.
function rarityLabel(pct) {
  if (pct === null || pct >= RARITY_BADGE_MAX) return "";
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

// Group yogas by category into de-duplicated rows (emoji, title, line, names[]),
// so several yogas of one category collapse into a single card row.
function groupYogas(yogas) {
  const order = [];
  const by = {};
  for (const y of yogas || []) {
    if (!by[y.category]) { by[y.category] = []; order.push(y.category); }
    const alias = yogaAlias(y);
    if (!by[y.category].includes(alias)) by[y.category].push(alias);
  }
  return order.map(cat => {
    const g = YOGA_VIBES[cat] || { emoji: "✅", title: cat, line: "" };
    return { emoji: g.emoji, title: g.title || cat, line: g.line, names: by[cat] };
  });
}

function renderCosmicId(c) {
  const moon = c.planets.find(p => p.key === "Moon") || {};
  const asc = c.ascendant || {};
  const mi = moon.signIndex;
  const vibe = SIGN_VIBES[mi] ?? "one of one";
  const { stats, archetype } = cosmicStats(c);
  const bars = stats
    .map(
      s => `<li><span class="cid-stat-label">${s.label}</span>
          <span class="cid-bar"><i style="width:${s.value}%"></i></span>
          <span class="cid-stat-val">${s.value}</span></li>`
    )
    .join("");
  const star = (c.dasha && c.dasha.moonNakshatra) || moon.nakshatra || "";
  const pada = c.dasha && c.dasha.moonPada;
  const el = Number.isInteger(mi) ? elementOf(mi) : ELEMENTS[0];
  const sa = s => (s ? `<small>${s}</small>` : "");
  const zg = i => (Number.isInteger(i) ? `<span class="cid-zodiac">${ZODIAC_GLYPH[i]}</span>` : "");
  const watermark = Number.isInteger(mi) ? ZODIAC_GLYPH[mi] : "✦";
  return `
    <div class="cosmic-id" style="--elem:${el.color}">
      <div class="cid-watermark" aria-hidden="true">${watermark}</div>
      <div class="cid-top">
        <div class="cid-head">✦ Your Cosmic ID</div>
        <span class="cid-elem">${el.name}</span>
      </div>
      <ul class="cid-rows">
        <li><span class="cid-glyph">☾</span><span class="cid-label">Moon</span>
          <span class="cid-val">${moon.sign || "—"}${zg(mi)}${sa(moon.signSanskrit)}</span></li>
        <li><span class="cid-glyph">★</span><span class="cid-label">Star</span>
          <span class="cid-val">${star || "—"}${pada ? `<small>pada ${pada}</small>` : ""}</span></li>
        <li><span class="cid-glyph">↑</span><span class="cid-label">Rising</span>
          <span class="cid-val">${asc.sign || "—"}${zg(asc.signIndex)}${sa(asc.signSanskrit)}</span></li>
      </ul>
      <div class="cid-arch">${archetype}</div>
      <ul class="cid-stats">${bars}</ul>
      <div class="cid-vibe">“${vibe}”</div>
    </div>`;
}

// ---- Cosmic stats: the character-sheet bars on the share card -------------
// Four playful axes, each a weighted blend of real placements, so two people
// rarely score alike. Fully deterministic — the same chart always draws the
// same bars. These are a vibe read, not a classical Jyotish measure; the
// ingredients are classical (bindus, element, house, dasha lord), the framing
// is not.
const MOVABLE_SIGNS = [0, 3, 6, 9];  // chara — initiating
const FIXED_SIGNS = [1, 4, 7, 10];   // sthira — persistent

// Weight a sign by its element, reusing elementOf() so these can't drift from
// the accent colour the card is tinted with. `w` maps element name -> 0-1.
const byElement = (sign, w) =>
  Number.isInteger(sign) && sign >= 0 ? w[elementOf(sign).name] ?? 0.5 : 0.5;

// Each axis blends a different set of terms, so their raw scores don't sit at
// the same height — CHARM ran ~13 points hotter than SOFTNESS before this. These
// centres were measured over 200 sample charts; subtracting them puts every
// axis at a ~50 median, so the winning stat (which names the archetype) says
// something about the chart rather than about which formula runs hot.
const STAT_CENTER = { CHAOS: 0.492, SOFTNESS: 0.449, "LOCK-IN": 0.463, CHARM: 0.557 };

// Raw blends cluster near their centre, so apply gain on the way out or every
// card reads as a wall of 50s. Clamped to leave the bar visibly un-maxed.
const statPct = (label, raw) =>
  Math.max(15, Math.min(97, Math.round(50 + (raw - (STAT_CENTER[label] ?? 0.5)) * 138)));

// Highest stat names the archetype chip.
const ARCHETYPES = {
  CHAOS: "the plot twist",
  SOFTNESS: "the safe place",
  "LOCK-IN": "the quiet grind",
  CHARM: "the magnet"
};

function cosmicStats(c) {
  const P = {};
  (c.planets || []).forEach(p => (P[p.key] = p));
  const av = c.ashtakavarga || {};

  // A graha's own bindus in the sign it occupies (0-8) — the classical "how
  // supported is this planet" number — normalised to 0-1. Rahu/Ketu have no
  // Bhinnashtakavarga of their own, so they read as neutral.
  const b = k => {
    const p = P[k], arr = av.bav && av.bav[k];
    if (!p || !arr) return 0.5;
    const v = arr[p.signIndex];
    return Number.isFinite(v) ? v / 8 : 0.5;
  };
  const houseOf = k => (P[k] ? P[k].house : 0);
  const inH = (k, hs) => hs.includes(houseOf(k));
  const countIn = (keys, hs) => keys.filter(k => inH(k, hs)).length / keys.length;
  const touches = (k, target) => {
    const t = P[target];
    if (!t) return false;
    return (t.aspectedBy || []).includes(k) || (t.conjunctWith || []).includes(k);
  };

  const moonSign = P.Moon ? P.Moon.signIndex : -1;
  const ascSign = (c.ascendant && c.ascendant.signIndex) ?? -1;
  const ascLord = (c.ascendant && c.ascendant.signLord) || "";
  const lord = (c.dasha && c.dasha.maha && c.dasha.maha.lord) || "";
  const era = keys => (keys.includes(lord) ? 0.08 : 0); // the era you're in nudges its own axis
  const retros = (c.planets || []).filter(p => p.retro && p.key !== "Rahu" && p.key !== "Ketu").length;
  const dusthana = (c.planets || []).filter(p => [6, 8, 12].includes(p.house)).length;

  // Rahu on an angle is loud; tucked in a trine it's quieter.
  const rahuLoud = inH("Rahu", [1, 4, 7, 10]) ? 1 : inH("Rahu", [5, 9]) ? 0.55 : 0.2;
  const moonHeld = touches("Jupiter", "Moon") ? 1 : 0.25;
  const moonPressed = touches("Saturn", "Moon") || touches("Mars", "Moon") ? 1 : 0;

  const raw = {
    // Rahu, Mars, the difficult houses and retrogrades — the unpredictable stuff.
    CHAOS:
      0.26 * b("Mars") + 0.24 * rahuLoud + 0.20 * Math.min(dusthana / 4, 1) +
      0.14 * Math.min(retros / 3, 1) +
      0.16 * byElement(moonSign, { Fire: 1, Earth: 0.25, Air: 0.55, Water: 0.35 }) +
      era(["Rahu", "Ketu", "Mars"]),
    // Moon and Venus, water, benefics on the angles — how gently you land.
    SOFTNESS:
      0.30 * b("Moon") + 0.20 * b("Venus") +
      0.18 * byElement(moonSign, { Fire: 0.2, Earth: 0.6, Air: 0.35, Water: 1 }) +
      0.16 * moonHeld + 0.16 * countIn(["Jupiter", "Venus", "Moon"], [1, 4, 7, 10]) -
      0.10 * moonPressed + era(["Moon", "Venus"]),
    // Saturn, Sun, the 10th and fixed signs — capacity to sit in the reps.
    "LOCK-IN":
      0.28 * b("Saturn") + 0.22 * b("Sun") + 0.18 * Math.min(
        (c.planets || []).filter(p => p.house === 10).length / 2, 1
      ) + 0.16 * (FIXED_SIGNS.includes(ascSign) ? 1 : MOVABLE_SIGNS.includes(ascSign) ? 0.75 : 0.45) +
      0.16 * b("Mars") + era(["Saturn", "Sun", "Mars"]),
    // Venus, Mercury, and the houses people actually see you in.
    CHARM:
      0.30 * b("Venus") + 0.20 * b("Mercury") +
      0.18 * countIn(["Venus", "Moon", "Mercury"], [1, 5, 7, 11]) +
      0.16 * (["Venus", "Mercury", "Moon"].includes(ascLord) ? 1 : ascLord === "Jupiter" ? 0.6 : 0.3) +
      0.16 * b("Moon") + era(["Venus", "Mercury", "Moon"])
  };

  const stats = Object.keys(raw).map(label => ({ label, value: statPct(label, raw[label]) }));
  const top = stats.reduce((a, s) => (s.value > a.value ? s : a), stats[0]);
  return { stats, archetype: ARCHETYPES[top.label] || "one of one" };
}

// The canvas share-image stack lives in share-image.js (shared with the
// public invite page); that script loads first. These two wrappers stay
// here because they read app state.
function shareCosmicId(c) {
  const moon = c.planets.find(p => p.key === "Moon") || {};
  const { stats, archetype } = cosmicStats(c);
  const data = {
    moon,
    asc: c.ascendant || {},
    star: (c.dasha && c.dasha.moonNakshatra) || moon.nakshatra || "",
    pada: c.dasha && c.dasha.moonPada,
    vibe: SIGN_VIBES[moon.signIndex] ?? "one of one",
    element: Number.isInteger(moon.signIndex) ? elementOf(moon.signIndex) : ELEMENTS[0],
    stats,
    archetype
  };
  return runShare($("cidShare"), "Creating…", async () => {
    const blob = await buildStoryImage(data);
    await shareOrDownload(blob, "pythia-cosmic-id.png", "My Cosmic ID", "my vedic big three ✦ via Pythia");
  });
}

function shareMatch(d) {
  return runShare($("shipShareBtn"), "Creating…", async () => {
    const blob = await buildMatchStoryImage(d);
    await shareOrDownload(blob, "pythia-match.png", "Our Cosmic Match", "our cosmic compatibility ✦ via Pythia");
  });
}

// ---- Daily cosmic weather -------------------------------------------------
// The transit Moon's house from the natal Moon (Chandra gochar, 1–12) is the
// classic daily indicator. Auspicious houses (1,3,6,7,10,11) read upbeat;
// mixed (4,9); tough (8=Chandrashtama, 12) read as rest days.
const DAILY = {
  1:  { head: "main-character day", line: "the Moon's on your sign — you're the moment. lead with it.", mood: "good" },
  2:  { head: "soft-launch your bag", line: "good energy for money, food and slow wins. treat yourself.", mood: "good" },
  3:  { head: "unstoppable energy", line: "courage is high — send the text, start the thing. you win today.", mood: "good" },
  4:  { head: "cozy recharge", line: "big homebody energy. protect your peace, don't force it.", mood: "mixed" },
  5:  { head: "romance & main quests", line: "creative, flirty, a little lucky. put yourself out there.", mood: "good" },
  6:  { head: "you vs the problem", line: "upper hand on rivals and the to-do list. handle it.", mood: "good" },
  7:  { head: "connection mode", line: "people, dates, collabs flow. say yes to the plans.", mood: "good" },
  8:  { head: "low-key rest day", line: "Chandrashtama — energy dips. rest, don't start big things.", mood: "low" },
  9:  { head: "keep it steady", line: "luck's a little shy today. don't gamble the important stuff.", mood: "mixed" },
  10: { head: "lock in", line: "career and action are favored. get the hard thing done.", mood: "good" },
  11: { head: "wins & clout", line: "gains, good news, social glow — best day of the cycle.", mood: "good" },
  12: { head: "battery low", line: "expenses and tiredness creep in. slow down, guard your energy.", mood: "low" }
};

const WX_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtWeatherDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return WX_MONTHS[(m || 1) - 1] + " " + (d || "");
}

// ---- Vibe-card feed builders ----------------------------------------------
// Each returns an HTML string; renderChartCard stitches them into the sidebar
// profile (#profile). The
// "go deeper →" buttons carry a data-cta the delegated handler turns into a
// grounded chat question (see handleCta).

// Today's vibe — the transit Moon's house from the natal Moon (reuses DAILY).
function renderTodayCard(c) {
  const tm = c.transits && c.transits.planets && c.transits.planets.find(p => p.key === "Moon");
  if (!tm) return "";
  const w = DAILY[tm.fromMoon] || DAILY[1];
  const notes = [];
  if (c.sadeSati && c.sadeSati.active) notes.push("Sade Sati" + (c.sadeSati.phase ? " (" + c.sadeSati.phase + ")" : ""));
  else if (c.sadeSati && c.sadeSati.smallPanoti && c.sadeSati.smallPanoti.active) notes.push("small panoti");
  return `
    <div class="vibe-card vc-today dw-${w.mood}">
      <div class="vc-emoji">${({ good: "✦", mixed: "✧", low: "☾" })[w.mood] || "✦"}</div>
      <div class="vc-kicker">today's vibe · ${fmtWeatherDate(c.transits.date)}</div>
      <div class="vc-head">${w.head}</div>
      <div class="vc-line">${w.line}</div>
      <div class="vc-meta">☾ Moon in ${tm.sign} · ${ordJS(tm.fromMoon)} from your Moon${notes.length ? " · " + notes.join(" · ") : ""}</div>
      <button type="button" class="vibe-cta" data-cta="today">what's today about? →</button>
    </div>`;
}

// The era you're in — from the running Mahadasha / Antardasha lords.
function renderEraCard(c) {
  const d = c.dasha;
  if (!d || !d.maha) return "";
  const maha = PLANET_ERA[d.maha.lord] || { head: d.maha.lord + " era", line: "a big chapter of life is running." };
  const antar = PLANET_ERA[d.antar && d.antar.lord];
  const sub = d.antar
    ? `<span class="vc-sub">right now: <b>${d.antar.lord}</b> sub-vibe${antar ? " — " + antar.head : ""}</span>`
    : "";
  const yr = s => (s || "").slice(0, 4);
  return `
    <div class="vibe-card vc-era">
      <div class="vc-emoji vc-era-glyph">${PLANET_GLYPH[d.maha.lord] || "✦"}</div>
      <div class="vc-kicker">the era you're in</div>
      <div class="vc-head">${maha.head}</div>
      <div class="vc-line">${maha.line}</div>
      ${sub}
      <div class="vc-meta">${PLANET_GLYPH[d.maha.lord] || "☉"} ${d.maha.lord} Mahadasha · ${yr(d.maha.start)} → ${yr(d.maha.end)}</div>
      <button type="button" class="vibe-cta" data-cta="era">what's this era mean for me? →</button>
    </div>`;
}

// Your green flags — favorable yogas, glossed by category.
function renderPowerCard(c) {
  const fav = (c.yogas || []).filter(y => y.favorable);
  if (!fav.length) {
    return `
    <div class="vibe-card vc-power">
      <div class="vc-emoji">✧</div>
      <div class="vc-kicker">your green flags</div>
      <div class="vc-head">quiet-luck coded</div>
      <div class="vc-line">no loud power-yogas here — which just means your wins sneak up quietly and <b>stick</b>. underdog arc energy. ✦</div>
      <button type="button" class="vibe-cta" data-cta="power">where's my edge? →</button>
    </div>`;
  }
  const groups = groupYogas(fav);
  const rows = groups.map(g =>
    `<li><span class="pw-emoji">${g.emoji}</span><div>
        <b>${g.title}</b>
        <small>${g.line}</small>
        <span class="pw-tag">${g.names.map(rarityChip).join("")}</span>
      </div></li>`
  ).join("");
  return `
    <div class="vibe-card vc-power">
      <div class="vc-emoji">✧</div>
      <div class="vc-kicker">your green flags <span class="vc-badge">${groups.length}</span></div>
      <div class="vc-head">your superpowers</div>
      <ul class="pw-list">${rows}</ul>
      ${renderRarestLine(fav)}
      <button type="button" class="vibe-cta" data-cta="power">break down my strengths →</button>
    </div>`;
}

// A yoga name, with how rare it is when that's actually a flex.
function rarityChip(alias) {
  const label = rarityLabel(yogaRarity(alias));
  return `<span class="pw-chip">${escAttr(alias)}${label ? `<i class="pw-rare">${label}</i>` : ""}</span>`;
}

// Headline the single rarest thing in the chart — the most postable fact here.
function renderRarestLine(yogas) {
  let best = null;
  for (const y of yogas || []) {
    const alias = yogaAlias(y);
    const pct = yogaRarity(alias);
    if (pct === null) continue;
    if (!best || pct < best.pct) best = { alias, pct };
  }
  if (!best || best.pct >= RARITY_BADGE_MAX) return "";
  const share = best.pct < 1 ? "under 1%" : `just ${Math.round(best.pct)}%`;
  return `<div class="pw-rarest">rarest in your chart · <b>${escAttr(best.alias)}</b>
    — ${share} of charts have it</div>`;
}

// Heads up — challenging yogas + active Sade Sati / small panoti.
function renderHeadsUpCard(c) {
  const items = groupYogas((c.yogas || []).filter(y => !y.favorable)).map(g => ({
    emoji: g.emoji,
    name: g.title,
    line: g.line,
    tag: g.names.map(rarityChip).join("")
  }));
  const ss = c.sadeSati;
  if (ss && ss.active) {
    items.push({
      emoji: "♄",
      name: "Sade Sati" + (ss.phase ? " · " + ss.phase + " phase" : ""),
      line: "Saturn's running its long lesson arc. go gentle, don't start huge things on impulse" + (ss.end ? " — it eases up around " + ss.end + "." : ".")
    });
  } else if (ss && ss.smallPanoti && ss.smallPanoti.active) {
    items.push({ emoji: "☾", name: ss.smallPanoti.type, line: "a shorter Saturn dip — pace yourself, protect your energy." });
  }
  if (!items.length) {
    return `
    <div class="vibe-card vc-heads calm">
      <div class="vc-emoji">✓</div>
      <div class="vc-kicker">heads up</div>
      <div class="vc-head">all clear rn</div>
      <div class="vc-line">no major red flags in your chart or in the sky today. cruise. ✦</div>
      <button type="button" class="vibe-cta" data-cta="heads">any remedies for me anyway? →</button>
    </div>`;
  }
  const rows = items.slice(0, 4).map(i =>
    `<li><span class="pw-emoji">${i.emoji}</span><div><b>${escAttr(i.name)}</b><small>${i.line}</small>${i.tag ? `<span class="pw-tag">${i.tag}</span>` : ""}</div></li>`
  ).join("");
  return `
    <div class="vibe-card vc-heads">
      <div class="vc-emoji">△</div>
      <div class="vc-kicker">heads up</div>
      <div class="vc-head">go gentle on…</div>
      <ul class="pw-list">${rows}</ul>
      <button type="button" class="vibe-cta" data-cta="heads">what do i do about these? →</button>
    </div>`;
}

// Ship-check entry — opens the compatibility form (in the sidebar drawer).
function renderShipCta() {
  return `
    <div class="vibe-card vc-ship">
      <div class="vc-emoji">♡</div>
      <div class="vc-kicker">ship check</div>
      <div class="vc-head">will it work?</div>
      <div class="vc-line">check your compatibility with anyone — crush, situationship, whoever. real Vedic math, one big verdict.</div>
      <button type="button" class="vibe-cta" data-cta="ship">check a ship →</button>
    </div>`;
}

// ---- Compact identity strip, pinned above the chat ------------------------
// The one card that turns into a shareable image, so Share lives here. The
// full Cosmic ID (stat bars, vibe quote) sits in the sidebar profile.
function renderIdBanner(c) {
  const moon = c.planets.find(p => p.key === "Moon") || {};
  const asc = c.ascendant || {};
  const mi = moon.signIndex;
  const el = Number.isInteger(mi) ? elementOf(mi) : ELEMENTS[0];
  const star = (c.dasha && c.dasha.moonNakshatra) || moon.nakshatra || "";
  const { archetype } = cosmicStats(c);
  const glyph = Number.isInteger(mi) ? ZODIAC_GLYPH[mi] : "✦";
  return `
    <div class="idb-glyph" aria-hidden="true">${glyph}</div>
    <div class="idb-main">
      <div class="idb-triple">
        <span><i>☾</i>${escAttr(moon.sign || "—")}</span>
        <span><i>★</i>${escAttr(star || "—")}</span>
        <span><i>↑</i>${escAttr(asc.sign || "—")}</span>
      </div>
      <div class="idb-arch">${escAttr(archetype)}</div>
    </div>
    <button type="button" class="cid-share idb-share" id="cidShare">Share ✦</button>`;
}

// ---- Render the reading ---------------------------------------------------
// Called on every cast (and node-toggle recompute). Fills three stable hosts:
// the pinned banner, the sidebar profile, and the nerd tables in the chat
// column. Interactions are delegated once (setupCards).
function renderChartCard(c) {
  const banner = $("idBanner");
  if (banner) {
    banner.hidden = false;
    banner.style.setProperty("--elem", (cosmicIdElement(c) || ELEMENTS[0]).color);
    banner.innerHTML = renderIdBanner(c);
  }

  const profile = $("profile");
  if (profile) {
    profile.hidden = false;
    profile.innerHTML =
      renderCosmicId(c) +
      renderTodayCard(c) +
      renderEraCard(c) +
      renderPowerCard(c) +
      renderHeadsUpCard(c) +
      renderShipCta();
  }

  const nerdHost = $("nerdHost");
  if (nerdHost) {
    nerdHost.innerHTML =
      `<div class="nerd-card"${nerdOpen ? "" : " hidden"}>
        <div class="nerd-panel"><div class="chart-card nerd-inner">${renderNerdPanel(c)}</div></div>
      </div>`;
  }

  // The ship-check form stays hidden until the card is clicked (openShipCheck).
  // These only make sense once a chart exists — reveal on the first cast.
  const sw = $("nerdSwitch");
  if (sw) sw.hidden = false;
  const cb = $("nerdMode");
  if (cb) cb.checked = nerdOpen;
  const co = $("checkOther");
  if (co) co.hidden = false;
  syncInviteBox();
  const fh = $("profileHead");
  if (fh) fh.hidden = false;

  // The form has done its job; the profile owns the top of the sidebar now.
  setFormOpen(false);

  // Once the reading is up, the welcome placeholder is redundant.
  const w = $("welcome");
  if (w) w.remove();
}

// Moon-sign element, used for the banner accent.
function cosmicIdElement(c) {
  const moon = (c.planets || []).find(p => p.key === "Moon") || {};
  return Number.isInteger(moon.signIndex) ? elementOf(moon.signIndex) : ELEMENTS[0];
}

// The full expert tables (unchanged content) — shown only inside "nerd mode".
// Selects are pre-rendered to their current selection; a delegated change
// handler (setupCards) updates the varga / BAV bodies and the node convention.
function renderNerdPanel(c) {
  const rows = c.planets
    .map(
      p => `<tr>
        <td>${p.key}</td>
        <td>${p.sign} ${p.degInSignFmt}${p.retro ? ' <span class="retro">℞</span>' : ""}</td>
        <td>${p.house}</td>
        <td>${p.nakshatra} <small>(${p.pada})</small></td>
      </tr>`
    )
    .join("");

  const d = c.dasha;

  // Aspects: which planets are "seen by" another (graha drishti).
  const aspected = c.planets
    .filter(p => p.aspectedBy.length)
    .map(p => `<li><b>${p.key}</b> <span class="by">◂ ${p.aspectedBy.join(", ")}</span></li>`)
    .join("");
  const groups = {};
  c.planets.forEach(p => (groups[p.signIndex] ||= []).push(p.key));
  const conj = Object.values(groups).filter(g => g.length > 1).map(g => g.join(" + "));

  // Navamsa (D9) rows
  const navRows = c.navamsa.planets
    .map(
      p => `<tr>
        <td>${p.key}${p.vargottama ? ' <span class="varg">★</span>' : ""}</td>
        <td>${p.sign}</td>
        <td>${p.house}</td>
      </tr>`
    )
    .join("");

  // Divisional-chart selector, pre-rendered to the current varga
  const divs = c.divisionals || [];
  const vInit = divs.find(x => x.key === currentVarga) || divs[0];
  if (vInit) currentVarga = vInit.key; // keep state in step with what's shown
  const vsOptions = divs
    .map(v => `<option value="${v.key}"${vInit && v.key === vInit.key ? " selected" : ""}>${v.key} · ${v.name}</option>`)
    .join("");

  // Ashtakavarga SAV table + BAV selector, pre-rendered to the current planet
  const av = c.ashtakavarga || { targets: [], savByHouse: [], bav: {}, savTotal: 0 };
  const bKey = av.targets.includes(currentBav) ? currentBav : (av.targets[0] || currentBav);
  currentBav = bKey;
  const bav = av.bav[bKey] || [];
  const bsOptions = av.targets
    .map(k => `<option value="${k}"${k === bKey ? " selected" : ""}>${k} BAV</option>`)
    .join("");
  const savRows = av.savByHouse
    .map(h => {
      const cls = h.bindus >= 30 ? "strong" : h.bindus <= 25 ? "weak" : "";
      return `<tr class="${cls}"><td>${h.house}</td><td>${h.sign}</td><td>${h.bindus}</td><td>${bav[h.signIndex] ?? ""}</td></tr>`;
    })
    .join("");

  return `
    <div class="asc">Lagna: <b>${c.ascendant.sign}</b> ${c.ascendant.degInSignFmt}
      · ${c.ascendant.nakshatra}</div>
    <table>
      <thead><tr><th>Graha</th><th>Sign</th><th>H</th><th>Nakshatra</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="dasha">
      <div>Moon: <b>${d.moonNakshatra}</b> pada ${d.moonPada}</div>
      <div>Mahadasha: <b>${d.maha.lord}</b> <small>(${d.maha.start} → ${d.maha.end})</small></div>
      <div>Antardasha: <b>${d.antar.lord}</b> <small>(${d.antar.start} → ${d.antar.end})</small></div>
    </div>
    ${renderYogasHTML(c.yogas)}
    <div class="aspects">
      <div class="aspects-title">Aspects · ◂ seen by
        <label class="node-toggle" title="Rahu/Ketu aspect convention — on: 5/7/9 (Jupiter-like), off: 7th only">
          <input type="checkbox" id="nodeToggle" ${nodeMode === "jupiter" ? "checked" : ""} />
          <span>nodes 5/7/9</span>
        </label>
      </div>
      ${aspected ? `<ul>${aspected}</ul>` : '<div class="none">No planet-to-planet aspects.</div>'}
      ${conj.length ? `<div class="conj">Conjunct: ${conj.join(" · ")}</div>` : ""}
    </div>
    <div class="navamsa">
      <div class="aspects-title">Navamsa · D9</div>
      <div class="nav-lagna">Lagnamsa: <b>${c.navamsa.ascendant.sign}</b></div>
      <table>
        <thead><tr><th>Graha</th><th>D9 sign</th><th>H</th></tr></thead>
        <tbody>${navRows}</tbody>
      </table>
      <div class="varg-note">★ vargottama — same sign in D1 &amp; D9</div>
    </div>
    <div class="divisionals">
      <div class="aspects-title">Divisional charts
        <select id="vargaSelect">${vsOptions}</select>
      </div>
      <div id="vargaBody">${vInit ? renderVargaHTML(vInit) : ""}</div>
    </div>
    <div class="ashtaka">
      <div class="aspects-title">Ashtakavarga
        <select id="bavSelect">${bsOptions}</select>
      </div>
      <div class="sav-note">Sarvashtakavarga · total ${av.savTotal} (avg ~28/house)</div>
      <table>
        <thead><tr><th>H</th><th>Sign</th><th>SAV</th><th id="bavHead">${bKey.slice(0, 3)} BAV</th></tr></thead>
        <tbody id="savBody">${savRows}</tbody>
      </table>
    </div>
    <div class="transits">
      <div class="aspects-title">Transits · ${c.transits.date}</div>
      ${renderSadeSati(c.sadeSati)}
      <table>
        <thead><tr><th>Graha</th><th>Transit</th><th>◦Moon</th></tr></thead>
        <tbody>${c.transits.planets
          .map(
            p => `<tr>
              <td>${p.key}${p.retro ? ' <span class="retro">℞</span>' : ""}</td>
              <td>${p.sign} ${p.degInSignFmt}</td>
              <td>${ordJS(p.fromMoon)}</td>
            </tr>`
          )
          .join("")}</tbody>
      </table>
    </div>`;
}

// Sidebar switch for nerd mode. #nerdSwitch is static markup, so this binds
// once; the panel it controls lives at the foot of the (rebuilt) feed.
function setupNerdSwitch() {
  const cb = $("nerdMode");
  if (!cb) return;
  cb.checked = nerdOpen;
  cb.addEventListener("change", () => {
    nerdOpen = cb.checked;
    try { localStorage.setItem("nerdMode", nerdOpen ? "1" : "0"); } catch (_) { /* private mode */ }
    const card = document.querySelector("#nerdHost .nerd-card");
    if (card) card.hidden = !nerdOpen;
    // Jumping to the tables makes the switch feel connected to something that
    // is otherwise off-screen at the bottom of the reading.
    if (nerdOpen && card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
setupNerdSwitch();

// One-time delegated wiring. The banner, profile and nerd host are stable
// elements whose contents are rebuilt on every cast, so bind on those rather
// than on each generated button/select.
function setupCards() {
  const banner = $("idBanner");
  if (banner) {
    banner.addEventListener("click", e => {
      if (e.target.closest(".cid-share") && chart) shareCosmicId(chart);
    });
  }

  const profile = $("profile");
  if (profile) {
    profile.addEventListener("click", e => {
      const cta = e.target.closest(".vibe-cta");
      if (cta) handleCta(cta.dataset.cta);
    });
  }

  const feed = $("nerdHost");
  if (!feed) return;

  feed.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "nodeToggle") {
      nodeMode = t.checked ? "jupiter" : "seventh";
      if (lastInput) castChart(lastInput, false);
      return;
    }
    if (!chart) return;
    if (t.id === "vargaSelect") {
      currentVarga = t.value;
      const v = (chart.divisionals || []).find(x => x.key === currentVarga) || (chart.divisionals || [])[0];
      const vb = $("vargaBody");
      if (vb && v) vb.innerHTML = renderVargaHTML(v);
    } else if (t.id === "bavSelect") {
      currentBav = t.value;
      const head = $("bavHead");
      if (head) head.textContent = `${currentBav.slice(0, 3)} BAV`;
      const av = chart.ashtakavarga || {};
      const bav = (av.bav && av.bav[currentBav]) || [];
      const body = $("savBody");
      if (body) body.innerHTML = (av.savByHouse || [])
        .map(h => {
          const cls = h.bindus >= 30 ? "strong" : h.bindus <= 25 ? "weak" : "";
          return `<tr class="${cls}"><td>${h.house}</td><td>${h.sign}</td><td>${h.bindus}</td><td>${bav[h.signIndex] ?? ""}</td></tr>`;
        })
        .join("");
    }
  });
}

// A feed card's "go deeper →" → a grounded question streamed into the chat.
function handleCta(kind) {
  if (!chart) return;
  if (kind === "ship") return openShipCheck();
  if (streaming) return;
  const d = chart.dasha;
  const tm = chart.transits && chart.transits.planets && chart.transits.planets.find(p => p.key === "Moon");
  const prompts = {
    today: tm
      ? `What's my cosmic weather today? The transiting Moon is in ${tm.sign}, ${ordJS(tm.fromMoon)} from my natal Moon. How should I approach today, and anything to watch for?`
      : "What's my cosmic weather today, and how should I approach it?",
    era: d && d.maha
      ? `I'm in my ${d.maha.lord} Mahadasha${d.antar ? " with " + d.antar.lord + " Antardasha" : ""} right now. In plain, friendly language, what does this era mean for my life, and how do I make the most of it?`
      : "What life phase am I in right now, and what does it mean for me?",
    power: "Break down my chart's strengths and lucky combinations (yogas) in plain, friendly language — what am I naturally good at, and how do I lean into it?",
    heads: "What challenging placements or doshas are in my chart (and any current Sade Sati), and what simple, practical remedies suit me?"
  };
  const q = prompts[kind];
  if (q) sendMessage(q);
}

// Reveal the Ship-check form (opens the sidebar drawer on mobile) and scroll to
// it. This is the only thing that unhides it — the form is otherwise absent, so
// the ship-check card is the single entry point.
function openShipCheck() {
  const card = $("matchCard");
  if (!card) return;
  card.hidden = false;
  setPanelOpen(true);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  const first = $("m_dob");
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 320);
}

setupCards();

function ordJS(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---- Guna Milan (Ashtakoot compatibility) ---------------------------------
const matchForm = $("matchForm");
const matchErr = $("matchErr");
const matchResult = $("matchResult");
// Partner place field uses the same live geocoding as the main form.
wireCityGeocode($("m_city"), $("m_cityList"), $("m_lat"), $("m_lon"), $("m_tz"));
const revealMatchAdvanced = wireAdvanced("m_advToggle", "m_advFields");

function showMatchErr(msg) {
  matchErr.textContent = msg;
  matchErr.hidden = false;
}

matchForm.addEventListener("submit", async e => {
  e.preventDefault();
  matchErr.hidden = true;
  if (!lastInput) return showMatchErr("Cast your own chart first.");

  const dob = $("m_dob").value;
  const tob = $("m_tob").value || "12:00";
  if (!dob) return showMatchErr("Enter their date of birth.");

  if (coordsMissing($("m_lat"), $("m_lon"), $("m_tz"))) {
    revealMatchAdvanced();
    const located = [$("m_lat"), $("m_lon")].every(el => String(el.value).trim() !== "");
    return showMatchErr(
      located
        ? "We couldn't work out the UTC offset for that place — please enter it below."
        : "Pick their city from the list — or add coordinates manually below."
    );
  }

  const [year, month, day] = dob.split("-").map(Number);
  const [hour, minute] = tob.split(":").map(Number);
  const partner = {
    year, month, day, hour, minute,
    lat: $("m_lat").value, lon: $("m_lon").value, tz: $("m_tz").value
  };

  // The kutas are boy→girl directional, so map by the primary chart's role.
  const role = document.querySelector('input[name="primaryRole"]:checked').value;
  const boy = role === "groom" ? lastInput : partner;
  const girl = role === "groom" ? partner : lastInput;

  const btn = $("matchBtn");
  btn.disabled = true;
  btn.textContent = "Matching…";
  try {
    const res = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boy, girl })
    });
    if (res.status === 401) { showAuth(); throw new Error("Session expired — please log in."); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Match failed.");
    // Share a lean summary + the partner's chart with the chat, so compatibility
    // questions are grounded in the computed result.
    const { charts, ...summary } = data;
    const partnerChart = charts ? (role === "groom" ? charts.girl : charts.boy) : null;
    match = { summary, partnerChart };
    renderMatchResult(data);
  } catch (err) {
    showMatchErr(err.message);
    matchResult.hidden = true;
  } finally {
    btn.disabled = false;
    btn.textContent = "check our vibe ♡";
  }
});

const fmtScore = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function renderMatchResult(d) {
  const band = "band-" + d.verdict.band;
  const deg = (d.total / d.max) * 360;
  const pct = Math.round((d.total / d.max) * 100);
  const ship = SHIP[d.verdict.band] || SHIP.average;

  const kutaRows = d.kutas
    .map(k => {
      const w = Math.round((k.score / k.max) * 100);
      const bad = k.dosha ? " dosha" : "";
      return `<tr class="kuta${bad}">
          <td class="kt-name">${k.name}<small>${k.governs}</small></td>
          <td class="kt-bar"><span style="width:${w}%"></span></td>
          <td class="kt-score">${fmtScore(k.score)}<small>/${k.max}</small></td>
        </tr>
        <tr class="kuta-detail${bad}"><td colspan="3">${k.detail}</td></tr>`;
    })
    .join("");

  const badges = [];
  if (d.doshas.nadi) badges.push('<span class="dosha-badge">Nadi dosha</span>');
  if (d.doshas.bhakoot) badges.push('<span class="dosha-badge">Bhakoot dosha</span>');
  if (!badges.length) badges.push('<span class="dosha-badge ok">No Nadi / Bhakoot dosha</span>');

  const caveats = (d.verdict.caveats || []).map(c => `<li>${c}</li>`).join("");
  const manglikHtml = d.manglik ? renderManglik(d.manglik) : "";

  matchResult.innerHTML = `
    <div class="ship-banner ${band}">
      <span class="ship-emoji">${ship.emoji}</span>
      <div class="ship-text">
        <div class="ship-title">${ship.head}</div>
        <div class="ship-sub">${fmtScore(d.total)}/${d.max} · ${pct}% matched — ${ship.sub}</div>
      </div>
    </div>
    <div class="score-head">
      <div class="score-ring ${band}" style="--deg:${deg}deg">
        <div class="score-inner"><b>${fmtScore(d.total)}</b><span>/${d.max}</span></div>
      </div>
      <div class="score-meta">
        <div class="verdict ${band}">${d.verdict.label}</div>
        <div class="pair">
          <span>♂ <b>${d.boy.nakshatra}</b> <small>${d.boy.sign}</small></span>
          <span>♀ <b>${d.girl.nakshatra}</b> <small>${d.girl.sign}</small></span>
        </div>
        <div class="dosha-badges">${badges.join("")}</div>
      </div>
    </div>
    <div class="match-actions">
      <button type="button" id="shipShareBtn" class="ship-share">Share this ✦</button>
      <button type="button" id="askMatchBtn" class="ask-match">Talk it through →</button>
    </div>
    <button type="button" class="breakdown-toggle" id="breakdownToggle" aria-expanded="false">
      <span class="bd-label">see the breakdown</span><span class="bd-caret">▼</span>
    </button>
    <div class="ship-breakdown" id="shipBreakdown" hidden>
      <table class="kuta-table"><tbody>${kutaRows}</tbody></table>
      ${manglikHtml}
      ${caveats ? `<ul class="caveats">${caveats}</ul>` : ""}
      <div class="match-note">The traditional minimum for marriage is ${d.verdict.minimum} of 36 gunas (Guna Milan · Ashtakoot). Manglik is a separate layer, not part of the 36.</div>
    </div>`;
  matchResult.hidden = false;

  const shipBtn = $("shipShareBtn");
  if (shipBtn) shipBtn.addEventListener("click", () => shareMatch(d));

  // "see the breakdown" reveals the full kuta table + Manglik panel.
  const bdToggle = $("breakdownToggle");
  const bd = $("shipBreakdown");
  if (bdToggle && bd) {
    bdToggle.addEventListener("click", () => {
      const open = bd.hidden;
      bd.hidden = !open;
      bdToggle.setAttribute("aria-expanded", open ? "true" : "false");
      const caret = bdToggle.querySelector(".bd-caret");
      if (caret) caret.textContent = open ? "▲" : "▼";
      const label = bdToggle.querySelector(".bd-label");
      if (label) label.textContent = open ? "hide the breakdown" : "see the breakdown";
    });
  }

  const askBtn = $("askMatchBtn");
  if (askBtn) {
    askBtn.addEventListener("click", () => {
      if (streaming || !chart) return;
      sendMessage(
        "Interpret our compatibility using the computed Guna Milan and Manglik results — " +
          "the total score out of 36, the key kutas and any Nadi/Bhakoot dosha, and the Manglik " +
          "situation. What does it mean for us, and what should we keep in mind?"
      );
    });
  }
}

// Manglik (Mangal dosha) panel: mutual/one-sided verdict plus each partner's status.
function renderManglik(mk) {
  const v = mk.verdict;
  const person = (who, m) => {
    const detail = m.manglik
      ? `Mars in ${m.marsSign} · dosha from ${m.triggeredFrom.join(", ")}`
      : `Mars in ${m.marsSign} · clear`;
    const mit = m.selfCancellations.length
      ? ` · ${m.selfCancellations.length} mitigator${m.selfCancellations.length > 1 ? "s" : ""}`
      : "";
    return `<div class="mk-person">
        <span class="mk-who">${who}</span>
        <span class="mk-flag ${m.manglik ? "on" : "off"}">${m.manglik ? "Manglik" : "Not Manglik"}</span>
        <small>${detail}${mit}</small>
      </div>`;
  };
  return `<div class="manglik mk-${v.status}">
      <div class="aspects-title">Manglik · Mangal dosha</div>
      <div class="mk-verdict">${v.label}</div>
      ${person("♂ Groom", mk.boy)}
      ${person("♀ Bride", mk.girl)}
    </div>`;
}

// Detected yogas panel for the chart card.
function renderYogasHTML(yogas) {
  if (!yogas || !yogas.length) {
    return `<div class="yogas">
      <div class="aspects-title">Yogas</div>
      <div class="none">No major yogas detected.</div>
    </div>`;
  }
  const rows = yogas
    .map(
      y => {
        const pct = yogaRarity(yogaAlias(y));
        // Nerd mode gets the real number even when it's common — no threshold.
        const rare = pct === null ? "" :
          `<span class="y-rare">${pct < 1 ? "<1" : Math.round(pct)}% of charts</span>`;
        return `<li class="yoga${y.favorable ? "" : " bad"}">
        <div class="y-name">${yogaAlias(y)}${rare}<small class="y-classic">${y.name}</small></div>
        <div class="y-detail">${y.detail}</div>
      </li>`;
      }
    )
    .join("");
  return `<div class="yogas">
    <div class="aspects-title">Yogas <span class="y-count">${yogas.length}</span></div>
    <ul class="yoga-list">${rows}</ul>
  </div>`;
}

function renderSadeSati(ss) {
  if (!ss || !ss.found) return '<div class="ss-badge off">Sade Sati · none in range</div>';
  if (ss.active) {
    const cap = ss.phase.charAt(0).toUpperCase() + ss.phase.slice(1);
    let h = `<div class="ss-badge on">Sade Sati · ${cap} phase</div>
      <div class="ss-detail">Saturn in <b>${ss.saturnSign}</b> · window ${ss.start} → <b>${ss.end}</b></div>`;
    if (ss.smallPanoti && ss.smallPanoti.active) {
      h += `<div class="ss-detail small">Also: ${ss.smallPanoti.type}</div>`;
    }
    return h;
  }
  let h = `<div class="ss-badge off">Sade Sati · not active</div>
    <div class="ss-detail">Next window: ${ss.start} → ${ss.end}</div>`;
  if (ss.smallPanoti && ss.smallPanoti.active) {
    h += `<div class="ss-detail small">Current: ${ss.smallPanoti.type}</div>`;
  }
  return h;
}

function renderVargaHTML(v) {
  const rows = v.planets
    .map(
      p => `<tr>
        <td>${p.key}${p.sameAsRashi ? ' <span class="same" title="same sign as D1 (Rashi)">•</span>' : ""}</td>
        <td>${p.sign}</td>
        <td>${p.house}</td>
      </tr>`
    )
    .join("");
  return `<div class="varga-governs">${v.governs}</div>
    <div class="nav-lagna">Lagna: <b>${v.ascendant.sign}</b></div>
    <table>
      <thead><tr><th>Graha</th><th>Sign</th><th>H</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="varg-note">• same sign as D1 (Rashi)</div>`;
}

// ---- Chat -----------------------------------------------------------------
function enableChat() {
  input.disabled = false;
  sendBtn.disabled = false;
  if (newChatBtn) newChatBtn.disabled = false;
  input.placeholder = "Ask about your chart…";
  suggestionsEl.hidden = false;
  input.focus();
}

function clearConversation() {
  messagesEl.querySelectorAll(".msg").forEach(n => n.remove());
  if (welcomeEl) welcomeEl.remove();
}

suggestionsEl.addEventListener("click", e => {
  const btn = e.target.closest("button[data-q]");
  if (btn && !streaming) sendMessage(btn.dataset.q);
});

composer.addEventListener("submit", e => {
  e.preventDefault();
  const text = input.value.trim();
  if (text) sendMessage(text);
});

// Enter to send, Shift+Enter for newline; auto-grow textarea.
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
});

function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.innerHTML = `<div class="avatar">${role === "user" ? "you" : "✦"}</div><div class="body"></div>`;
  const body = el.querySelector(".body");
  if (role === "user") body.textContent = text;
  else body.innerHTML = "";
  messagesEl.appendChild(el);
  scrollDown();
  return body;
}

function renderMarkdown(el, text) {
  el.innerHTML = window.marked ? marked.parse(text) : text.replace(/\n/g, "<br>");
}

function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// True when the view is at (or within ~120px of) the bottom. Used to keep the
// stream pinned to the newest text only while the user hasn't scrolled up to read.
function isNearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
}

async function sendMessage(text) {
  if (streaming || !chart) return;
  setPanelOpen(false); // on mobile, close the drawer so the reply is visible
  streaming = true;
  input.value = "";
  input.style.height = "auto";
  sendBtn.disabled = true;

  addMessage("user", text);
  history.push({ role: "user", content: text });

  const body = addMessage("assistant", "");
  body.classList.add("cursor");
  let acc = "";   // full received text (source of truth for history)
  let shown = 0;  // chars currently revealed on screen
  let raf = null;

  // Smoothly reveal received text at a steady, self-adjusting pace, capping
  // markdown re-parsing to one animation frame instead of once per streamed
  // token — this removes the flicker/jank of re-rendering on every chunk.
  const pump = () => {
    raf = null;
    const backlog = acc.length - shown;
    if (backlog > 0) {
      shown = Math.min(acc.length, shown + Math.max(2, Math.ceil(backlog / 4)));
      const stick = isNearBottom();
      renderMarkdown(body, acc.slice(0, shown));
      if (stick) scrollDown();
    }
    if (shown < acc.length) raf = requestAnimationFrame(pump);
  };
  const schedule = () => { if (raf == null) raf = requestAnimationFrame(pump); };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, chart, match })
    });
    if (res.status === 401) { showAuth(); throw new Error("Session expired — please log in again."); }
    if (!res.ok || !res.body) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Request failed.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.replace(/^data: /, "").trim();
        if (!line) continue;

        let obj;
        try { obj = JSON.parse(line); } catch { continue; }

        if (obj.text) {
          acc += obj.text;
          schedule();
        } else if (obj.error) {
          acc += (acc ? "\n\n" : "") + "⚠️ " + obj.error;
          schedule();
        }
      }
    }
  } catch (err) {
    acc += (acc ? "\n\n" : "") + "⚠️ " + err.message;
  } finally {
    if (raf != null) { cancelAnimationFrame(raf); raf = null; }
    const stick = isNearBottom();
    body.classList.remove("cursor");
    renderMarkdown(body, acc || "*(no response)*"); // ensure the full text is shown
    shown = acc.length;
    if (acc) history.push({ role: "assistant", content: acc });
    streaming = false;
    sendBtn.disabled = false;
    if (stick) scrollDown();
    input.focus({ preventScroll: true });
    saveConversation(); // persist this turn (best-effort, non-blocking)
  }
}

// ---- Authentication -------------------------------------------------------
function showAuth() {
  authMode = "login";
  applyAuthMode();
  $("authPass").value = "";
  if (pendingAuthError) { // surface a failed Google redirect
    authErr.textContent = pendingAuthError;
    authErr.hidden = false;
    pendingAuthError = null;
  }
  authOverlay.hidden = false;
  panelToggle.hidden = true; // keep the drawer toggle off the login screen
  if (mobileBar) mobileBar.hidden = true; // and the branding bar (login has its own)
  setPanelOpen(false);
  $("authUser").focus();
}

function onAuthed(user) {
  authOverlay.hidden = true;
  account.hidden = false;
  $("accountName").textContent = user.name;
  peopleCard.hidden = false;
  convCard.hidden = false;
  panelToggle.hidden = false; // reveal the mobile drawer toggle
  if (mobileBar) mobileBar.hidden = false; // and the fixed mobile branding bar
  loadPeople();
  loadConversations();
  checkInStreak();
  loadInviteResponses();
  loadFriendRequests();
  // Your chart sticks: bring it straight back rather than making you cast again.
  // The account carries the server-side copy, which beats this browser's cache.
  loadAccount().then(acct => {
    restoreMyChart(acct && acct.birth).then(() => loadFriends());
  });
}

// ---- Daily streak ---------------------------------------------------------
// One round trip records today's visit and returns the resulting streak. The
// date is the browser's own local date — the server only sanity-checks it,
// because "today" has to mean today where the user is (see server/streak.js).
async function checkInStreak() {
  const d = new Date();
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  try {
    const res = await fetch("/api/streak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: today })
    });
    // The streak is decoration — a failure must never block the app. But it
    // must not fail *silently* either, or a broken endpoint is indistinguishable
    // from a missing feature (e.g. Supabase serving a stale schema cache).
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`Streak check-in failed (HTTP ${res.status}).`, detail.slice(0, 300));
      return;
    }
    renderStreak(await res.json());
  } catch (err) {
    console.warn("Streak check-in did not complete:", err && err.message);
  }
}

function renderStreak(s) {
  if (!s || !Number.isFinite(s.current)) return;
  const title =
    `${s.current}-day streak · best ${s.longest} · ${s.days} day${s.days === 1 ? "" : "s"} total` +
    (s.nextMilestone ? ` · ${s.nextMilestone - s.current} to go` : "");
  for (const id of ["streakChip", "streakChipMobile"]) {
    const el = $(id);
    if (!el) continue;
    el.hidden = false;
    el.title = title;
    const n = el.querySelector(".streak-n");
    if (n) n.textContent = String(s.current);
    if (s.isNewDay) {
      el.classList.remove("pop");
      void el.offsetWidth; // restart the animation on a re-render
      el.classList.add("pop");
    }
  }
  if (!s.isNewDay) return;
  if (s.milestone) toast(`🔥 ${s.current}-day streak — you're locked in`);
  else if (s.current > 1) toast(`🔥 day ${s.current}`);
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  setTimeout(() => {
    el.classList.remove("in");
    setTimeout(() => el.remove(), 320);
  }, 2800);
}

function applyAuthMode() {
  const reg = authMode === "register";
  $("authTitle").textContent = reg ? "Start your chart." : "Your chart's waiting.";
  $("authSub").textContent = reg
    ? "Sign up with email + a password (8+ characters). Takes a sec."
    : "Log in to cast, save and talk to your chart.";
  authSubmit.textContent = reg ? "Create account" : "Log in";
  $("authSwitchText").textContent = reg ? "Already have an account?" : "New here?";
  $("authSwitch").textContent = reg ? "Log in" : "Create an account";
  // Registration is email-only; login also accepts a legacy username.
  const idField = $("authUser");
  idField.type = reg ? "email" : "text";
  idField.placeholder = reg ? "Email" : "Email or username";
  idField.setAttribute("autocomplete", reg ? "email" : "username");
  $("authPass").setAttribute("autocomplete", reg ? "new-password" : "current-password");
  authErr.hidden = true;
}

$("authSwitch").addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  applyAuthMode();
  $("authUser").focus();
});

authForm.addEventListener("submit", async e => {
  e.preventDefault();
  authErr.hidden = true;
  const idv = $("authUser").value.trim();
  const password = $("authPass").value;
  // register → email account; login → email OR legacy username in `identifier`
  const payload = authMode === "register" ? { email: idv, password } : { identifier: idv, password };
  const label = authSubmit.textContent;
  authSubmit.disabled = true;
  authSubmit.textContent = "…";
  try {
    const res = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    onAuthed(data.user);
    $("authPass").value = "";
  } catch (err) {
    authErr.textContent = err.message;
    authErr.hidden = false;
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = label;
  }
});

$("logoutBtn").addEventListener("click", async () => {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
  location.reload();
});

// Show the "Continue with Google" button only when the server has it configured.
async function loadProviders() {
  try {
    const res = await fetch("/api/auth/providers");
    const data = await res.json();
    const on = !!(data && data.google);
    if (googleBtn) googleBtn.hidden = !on;
    if (authDivider) authDivider.hidden = !on;
  } catch {
    /* leave the Google button hidden */
  }
}

// After a failed Google redirect the server sends us back to /?auth_error=…
const AUTH_ERRORS = {
  state: "Google sign-in expired — please try again.",
  email: "Google didn't share a verified email address.",
  oauth: "Google sign-in failed — please try again.",
  google_off: "Google sign-in isn't configured."
};
function checkAuthError() {
  const code = new URLSearchParams(location.search).get("auth_error");
  if (!code) return;
  history.replaceState(null, "", location.pathname); // strip it from the URL
  pendingAuthError = AUTH_ERRORS[code] || "Sign-in failed — please try again.";
}

async function initAuth() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      const data = await res.json();
      onAuthed(data.user);
      return;
    }
  } catch {
    /* fall through to login */
  }
  showAuth();
}

// ---- Saved people ---------------------------------------------------------
async function loadPeople() {
  try {
    const res = await fetch("/api/people");
    if (res.status === 401) return showAuth();
    const data = await res.json();
    renderPeople(data.people || []);
  } catch {
    /* leave the list as-is */
  }
}

function renderPeople(list) {
  peopleById = {};
  list.forEach(p => (peopleById[p.id] = p));
  peopleList.innerHTML = list
    .map(
      p => `<li data-id="${p.id}">
        <button type="button" class="p-load">${escAttr(p.name)} <small>${p.year}-${pad(p.month)}-${pad(p.day)}</small></button>
        <button type="button" class="p-del" title="Delete ${escAttr(p.name)}">✕</button>
      </li>`
    )
    .join("");
  peopleEmpty.hidden = list.length > 0;
}

peopleList.addEventListener("click", async e => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const id = li.dataset.id;
  if (e.target.closest(".p-del")) {
    try {
      const res = await fetch(`/api/people/${id}`, { method: "DELETE" });
      if (res.status === 401) return showAuth();
      await loadPeople();
    } catch {
      /* ignore */
    }
    return;
  }
  if (e.target.closest(".p-load") && peopleById[id]) loadPerson(peopleById[id]);
});

function loadPerson(p) {
  $("name").value = p.name === "Unnamed" ? "" : p.name;
  $("dob").value = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  $("tob").value = `${pad(p.hour)}:${pad(p.minute)}`;
  $("lat").value = p.lat;
  $("lon").value = p.lon;
  $("tz").value = p.tz;
  $("city").value = "";
  $("formErr").hidden = true;
  releaseCoords(); // these coordinates are the saved person's, not a city pick
  // Cast directly rather than via requestSubmit(): people saved as "Unnamed"
  // leave the (required) name field empty, which would fail form validation.
  lastInput = {
    name: $("name").value.trim(),
    year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute,
    lat: p.lat, lon: p.lon, tz: p.tz
  };
  // Opening a saved person is a one-off view, not a change of profile — your
  // own chart stays in myBirth and is one "back to mine" away.
  castChart(lastInput, true).then(ok => {
    if (ok) setViewing(p.name === "Unnamed" ? "their chart" : p.name);
  });
}

savePersonBtn.addEventListener("click", async () => {
  if (!chart || !lastInput) return;
  peopleErr.hidden = true;
  const label = savePersonBtn.textContent;
  savePersonBtn.disabled = true;
  savePersonBtn.textContent = "Saving…";
  try {
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...lastInput, name: $("name").value.trim() || "Unnamed" })
    });
    if (res.status === 401) return showAuth();
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed.");
    await loadPeople();
  } catch (err) {
    peopleErr.textContent = err.message;
    peopleErr.hidden = false;
  } finally {
    savePersonBtn.disabled = false;
    savePersonBtn.textContent = label;
  }
});

// ---- Saved chats (conversations) ------------------------------------------
// The list is metadata-only; loading one fetches its full chart + messages so
// the consultation can be resumed exactly. Saving is automatic as you chat.
async function loadConversations() {
  try {
    const res = await fetch("/api/conversations");
    if (res.status === 401) return showAuth();
    const data = await res.json();
    renderConversations(data.conversations || []);
  } catch {
    /* leave the list as-is */
  }
}

function fmtConvDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderConversations(list) {
  convList.innerHTML = list
    .map(
      c => `<li data-id="${c.id}">
        <button type="button" class="p-load conv-load">${escAttr(c.title)} <small>${fmtConvDate(c.updated_at)}</small></button>
        <button type="button" class="p-del" title="Delete this chat">✕</button>
      </li>`
    )
    .join("");
  convEmpty.hidden = list.length > 0;
  highlightActiveConv();
}

// Mark whichever saved chat the composer is currently writing to.
function highlightActiveConv() {
  if (!convList) return;
  convList.querySelectorAll("li[data-id]").forEach(li =>
    li.classList.toggle("active", String(li.dataset.id) === String(currentConvId)));
}

convList.addEventListener("click", async e => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const id = li.dataset.id;
  if (e.target.closest(".p-del")) {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (res.status === 401) return showAuth();
      if (id === currentConvId) currentConvId = null; // deleted the open chat
      await loadConversations();
    } catch {
      /* ignore */
    }
    return;
  }
  if (e.target.closest(".conv-load")) loadConversation(id);
});

// Render the stored history into the chat pane (user bubbles + assistant markdown).
function renderHistory() {
  clearConversation();
  for (const m of history) {
    const b = addMessage(m.role, m.content);
    if (m.role === "assistant") renderMarkdown(b, m.content);
  }
}

async function loadConversation(id) {
  if (streaming) return;
  try {
    const res = await fetch(`/api/conversations/${id}`);
    if (res.status === 401) return showAuth();
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load chat.");
    const conv = data.conversation;

    chart = conv.chart;
    match = conv.match || null;
    lastInput = conv.input || null; // restores the node toggle / save-person / match form
    history.length = 0;
    (conv.messages || []).forEach(m => history.push(m));
    currentConvId = conv.id;

    renderChartCard(chart);
    if (savePersonBtn) savePersonBtn.disabled = !lastInput;
    // Restore the compatibility panel if this chat had one (summary carries all
    // the fields renderMatchResult needs; the charts were stripped out on save).
    const mr = $("matchResult");
    if (match && match.summary) renderMatchResult(match.summary);
    else if (mr) { mr.hidden = true; mr.innerHTML = ""; }
    renderHistory();
    enableChat();
    highlightActiveConv();
    setPanelOpen(false); // on mobile, reveal the chat
    scrollDown();
  } catch {
    /* transient — the sidebar item stays, user can retry */
  }
}

// Start a fresh conversation about the current chart, keeping the chart itself.
function newChat() {
  if (!chart || streaming) return;
  currentConvId = null;
  history.length = 0;
  clearConversation();
  enableChat();
  highlightActiveConv();
  setPanelOpen(false);
}
if (newChatBtn) newChatBtn.addEventListener("click", newChat);

// Auto-save the current chat. Creates the conversation on the first reply, then
// patches it on every subsequent turn. Best-effort — never disrupts the chat.
async function saveConversation() {
  if (!chart || !history.length) return;
  const firstUser = history.find(m => m.role === "user");
  const base = (firstUser ? firstUser.content : "New chat").replace(/\s+/g, " ").trim();
  const who = lastInput && lastInput.name ? lastInput.name.trim() : "";
  const title = (who ? who + ": " : "") + base.slice(0, 60);
  try {
    if (!currentConvId) {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, chart, input: lastInput, match, messages: history })
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.id) { currentConvId = data.id; await loadConversations(); }
    } else {
      const res = await fetch(`/api/conversations/${currentConvId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history })
      });
      if (res.status === 404) { currentConvId = null; return saveConversation(); } // was deleted → recreate
    }
  } catch {
    /* saving is best-effort */
  }
}

checkAuthError();
loadProviders();
initAuth();
