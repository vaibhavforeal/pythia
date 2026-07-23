// ---- State ----------------------------------------------------------------
let chart = null;
const history = []; // [{ role, content }]
let match = null; // last compatibility result + partner chart, shared with the chat
let streaming = false;
let nodeMode = "jupiter"; // Rahu/Ketu aspects: "jupiter" (5/7/9) | "seventh" (7 only)
let lastInput = null; // last birth input, so the node toggle can recompute
let currentVarga = "D10"; // which divisional chart the selector shows
let currentBav = "Saturn"; // which planet's Bhinnashtakavarga the SAV table shows

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

// ---- Live city geocoding --------------------------------------------------
const escAttr = s =>
  String(s).replace(/[&"<>]/g, c => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[c]));

// Wire a city <input> + its <datalist> to /api/geocode: as the user types,
// fetch matching places into the datalist; selecting one fills lat/lon/tz.
// Fields stay editable, so a manual override always wins.
function wireCityGeocode(cityEl, listEl, latEl, lonEl, tzEl) {
  const byLabel = new Map(); // option label -> { lat, lon, tz }
  let timer = null;
  let lastQuery = "";

  const apply = m => {
    latEl.value = m.lat;
    lonEl.value = m.lon;
    if (m.tz !== null && m.tz !== undefined) tzEl.value = m.tz;
  };

  async function search(q) {
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      byLabel.clear();
      listEl.innerHTML = (data.results || [])
        .map(r => {
          let label = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
          if (byLabel.has(label)) label += ` (${r.lat}, ${r.lon})`;
          byLabel.set(label, { lat: r.lat, lon: r.lon, tz: r.tz });
          return `<option value="${escAttr(label)}"></option>`;
        })
        .join("");
    } catch {
      /* network hiccup — leave prior options; manual entry still works */
    }
  }

  cityEl.addEventListener("input", () => {
    // Choosing a suggestion drops its full label into the field — fill on match.
    if (byLabel.has(cityEl.value)) return apply(byLabel.get(cityEl.value));
    const q = cityEl.value.trim();
    if (q.length < 2 || q === lastQuery) return;
    lastQuery = q;
    clearTimeout(timer);
    timer = setTimeout(() => search(q), 250);
  });
  cityEl.addEventListener("change", () => {
    if (byLabel.has(cityEl.value)) apply(byLabel.get(cityEl.value));
  });
}

wireCityGeocode(cityInput, cityList, $("lat"), $("lon"), $("tz"));

// ---- Cast chart -----------------------------------------------------------
form.addEventListener("submit", async e => {
  e.preventDefault();
  $("formErr").hidden = true;

  const dob = $("dob").value; // YYYY-MM-DD
  const tob = $("tob").value || "12:00"; // HH:MM
  if (!dob) return showFormErr("Please enter a date of birth.");

  const [year, month, day] = dob.split("-").map(Number);
  const [hour, minute] = tob.split(":").map(Number);

  lastInput = {
    name: $("name").value.trim(),
    year, month, day, hour, minute,
    lat: $("lat").value, lon: $("lon").value, tz: $("tz").value
  };
  await castChart(lastInput, true);
});

// Compute (or recompute) the chart. reset=true starts a fresh consultation;
// reset=false (node-aspect toggle) keeps the ongoing conversation.
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
    if (res.status === 401) { showAuth(); return; }
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
    }
    renderChartCard(data);
  } catch (err) {
    showFormErr(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Cast chart";
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

function renderCosmicId(c) {
  const moon = c.planets.find(p => p.key === "Moon") || {};
  const asc = c.ascendant || {};
  const vibe = SIGN_VIBES[moon.signIndex] ?? "one of one";
  const star = (c.dasha && c.dasha.moonNakshatra) || moon.nakshatra || "";
  const pada = c.dasha && c.dasha.moonPada;
  const sa = s => (s ? `<small>${s}</small>` : "");
  return `
    <div class="cosmic-id">
      <div class="cid-head">✦ Your Cosmic ID</div>
      <ul class="cid-rows">
        <li><span class="cid-glyph">☾</span><span class="cid-label">Moon</span>
          <span class="cid-val">${moon.sign || "—"}${sa(moon.signSanskrit)}</span></li>
        <li><span class="cid-glyph">★</span><span class="cid-label">Star</span>
          <span class="cid-val">${star || "—"}${pada ? `<small>pada ${pada}</small>` : ""}</span></li>
        <li><span class="cid-glyph">↑</span><span class="cid-label">Rising</span>
          <span class="cid-val">${asc.sign || "—"}${sa(asc.signSanskrit)}</span></li>
      </ul>
      <div class="cid-vibe">“${vibe}”</div>
      <div class="cid-actions">
        <button type="button" class="cid-share" id="cidShare">Share your ID ✦</button>
      </div>
    </div>`;
}

// ---- Shareable "Cosmic ID" story image (9:16) -----------------------------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// The logo mark is dark navy line-art; recolor it to white so it glows on the
// dark story gradient. Returns an offscreen canvas.
async function loadWhiteLogo() {
  const img = await loadImage("logo.png");
  const oc = document.createElement("canvas");
  oc.width = img.naturalWidth || 256;
  oc.height = img.naturalHeight || 256;
  const octx = oc.getContext("2d");
  octx.drawImage(img, 0, 0);
  octx.globalCompositeOperation = "source-in";
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, oc.width, oc.height);
  return oc;
}

function drawStars(ctx, W, H, n) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = Math.random() * 0.5 + 0.2;
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 1.8 + 0.6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

async function ensureStoryFonts() {
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load("600 90px Lora"),
        document.fonts.load("italic 500 46px Lora"),
        document.fonts.load("600 30px Raleway"),
        document.fonts.load("400 34px Raleway")
      ]);
      await document.fonts.ready;
    }
  } catch (_) { /* fall back to system fonts */ }
}

function centerWrap(ctx, text, cx, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  const lines = [];
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((ln, i) => ctx.fillText(ln, cx, y + i * lineHeight));
}

const ls = (ctx, v) => { if ("letterSpacing" in ctx) ctx.letterSpacing = v; };

async function buildStoryImage(data) {
  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, "#0b2a4a");
  g.addColorStop(0.55, "#0a3d68");
  g.addColorStop(1, "#2f5aa8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  drawStars(ctx, W, H, 90);

  await ensureStoryFonts();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  try {
    const logo = await loadWhiteLogo();
    const size = 290;
    ctx.save();
    ctx.shadowColor = "rgba(150,190,255,0.5)";
    ctx.shadowBlur = 40;
    ctx.drawImage(logo, W / 2 - size / 2, 175, size, size);
    ctx.restore();
  } catch (_) { /* logo optional */ }

  ctx.fillStyle = "#ffffff";
  ctx.font = "600 76px Lora, Georgia, serif";
  ctx.fillText("Pythia", W / 2, 585);

  ctx.fillStyle = "rgba(198,222,255,0.72)";
  ctx.font = "600 30px Raleway, sans-serif";
  ls(ctx, "4px");
  ctx.fillText("✦  YOUR COSMIC ID  ✦", W / 2, 650);
  ls(ctx, "0px");

  const items = [
    ["MOON", data.moon.sign, data.moon.signSanskrit],
    ["STAR", data.star, data.pada ? "pada " + data.pada : ""],
    ["RISING", data.asc.sign, data.asc.signSanskrit]
  ];
  let y = 830;
  for (const [label, val, sub] of items) {
    ctx.fillStyle = "rgba(188,216,255,0.85)";
    ctx.font = "600 30px Raleway, sans-serif";
    ls(ctx, "3px");
    ctx.fillText(label, W / 2, y);
    ls(ctx, "0px");

    ctx.fillStyle = "#ffffff";
    ctx.font = "600 90px Lora, Georgia, serif";
    ctx.fillText(val || "—", W / 2, y + 92);

    if (sub) {
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "400 34px Raleway, sans-serif";
      ctx.fillText(sub, W / 2, y + 140);
    }
    y += 232;
  }

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "italic 500 46px Lora, Georgia, serif";
  centerWrap(ctx, "“" + data.vibe + "”", W / 2, 1600, W - 200, 62);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "500 30px Raleway, sans-serif";
  ls(ctx, "2px");
  ctx.fillText("cast yours at pythia", W / 2, 1840);
  ls(ctx, "0px");

  return await new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

async function shareCosmicId(c) {
  const btn = $("cidShare");
  const moon = c.planets.find(p => p.key === "Moon") || {};
  const data = {
    moon,
    asc: c.ascendant || {},
    star: (c.dasha && c.dasha.moonNakshatra) || moon.nakshatra || "",
    pada: c.dasha && c.dasha.moonPada,
    vibe: SIGN_VIBES[moon.signIndex] ?? "one of one"
  };
  const orig = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }
  try {
    const blob = await buildStoryImage(data);
    const file = new File([blob], "pythia-cosmic-id.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "My Cosmic ID", text: "my vedic big three ✦ via Pythia" });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pythia-cosmic-id.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  } catch (e) {
    if (!e || e.name !== "AbortError") console.error("Cosmic ID share failed:", e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig || "Share your ID ✦"; }
  }
}

// ---- Render the chart summary card ----------------------------------------
function renderChartCard(c) {
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

  $("chartCard").hidden = false;
  $("matchCard").hidden = false;
  $("chartCard").innerHTML = `
    ${renderCosmicId(c)}
    <h3>Chart</h3>
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
        <select id="vargaSelect"></select>
      </div>
      <div id="vargaBody"></div>
    </div>
    <div class="ashtaka">
      <div class="aspects-title">Ashtakavarga
        <select id="bavSelect"></select>
      </div>
      <div class="sav-note">Sarvashtakavarga · total ${c.ashtakavarga.savTotal} (avg ~28/house)</div>
      <table>
        <thead><tr><th>H</th><th>Sign</th><th>SAV</th><th id="bavHead">BAV</th></tr></thead>
        <tbody id="savBody"></tbody>
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

  const shareBtn = $("cidShare");
  if (shareBtn) shareBtn.addEventListener("click", () => shareCosmicId(c));

  const nt = $("nodeToggle");
  if (nt) {
    nt.addEventListener("change", () => {
      nodeMode = nt.checked ? "jupiter" : "seventh";
      if (lastInput) castChart(lastInput, false);
    });
  }

  // Divisional-chart selector
  const vs = $("vargaSelect");
  if (vs && c.divisionals) {
    vs.innerHTML = c.divisionals
      .map(v => `<option value="${v.key}"${v.key === currentVarga ? " selected" : ""}>${v.key} · ${v.name}</option>`)
      .join("");
    const renderSel = () => {
      currentVarga = vs.value;
      const v = c.divisionals.find(x => x.key === currentVarga) || c.divisionals[0];
      $("vargaBody").innerHTML = renderVargaHTML(v);
    };
    vs.addEventListener("change", renderSel);
    renderSel();
  }

  // Ashtakavarga: SAV table + BAV planet selector
  const bs = $("bavSelect");
  if (bs && c.ashtakavarga) {
    bs.innerHTML = c.ashtakavarga.targets
      .map(k => `<option value="${k}"${k === currentBav ? " selected" : ""}>${k} BAV</option>`)
      .join("");
    const renderBav = () => {
      currentBav = bs.value;
      $("bavHead").textContent = `${currentBav.slice(0, 3)} BAV`;
      const bav = c.ashtakavarga.bav[currentBav];
      $("savBody").innerHTML = c.ashtakavarga.savByHouse
        .map(h => {
          const cls = h.bindus >= 30 ? "strong" : h.bindus <= 25 ? "weak" : "";
          return `<tr class="${cls}"><td>${h.house}</td><td>${h.sign}</td><td>${h.bindus}</td><td>${bav[h.signIndex]}</td></tr>`;
        })
        .join("");
    };
    bs.addEventListener("change", renderBav);
    renderBav();
  }
}

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
  if (!dob) return showMatchErr("Enter the partner's date of birth.");

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
    btn.textContent = "Check compatibility";
  }
});

const fmtScore = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function renderMatchResult(d) {
  const band = "band-" + d.verdict.band;
  const deg = (d.total / d.max) * 360;

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
    <table class="kuta-table"><tbody>${kutaRows}</tbody></table>
    ${manglikHtml}
    ${caveats ? `<ul class="caveats">${caveats}</ul>` : ""}
    <div class="match-note">Traditional minimum for marriage is ${d.verdict.minimum} of 36 gunas. Manglik is a separate layer, not part of the 36.</div>
    <button type="button" id="askMatchBtn" class="ask-match">Discuss this match in chat →</button>`;
  matchResult.hidden = false;

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
      y => `<li class="yoga${y.favorable ? "" : " bad"}">
        <div class="y-name">${y.name}</div>
        <div class="y-detail">${y.detail}</div>
      </li>`
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
  form.requestSubmit(); // re-cast through the normal flow (resets the consultation)
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
