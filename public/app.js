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
const peopleCard = $("peopleCard");
const peopleList = $("peopleList");
const peopleEmpty = $("peopleEmpty");
const peopleErr = $("peopleErr");
const savePersonBtn = $("savePersonBtn");
let authMode = "login";
let peopleById = {};
const pad = n => String(n).padStart(2, "0");

// Mobile slide-in drawer for the chart / compatibility panel (no effect on desktop)
const appEl = document.querySelector(".app");
const panelToggle = $("panelToggle");
const panelScrim = $("panelScrim");
function setPanelOpen(open) {
  appEl.classList.toggle("panel-open", open);
  panelToggle.setAttribute("aria-expanded", open ? "true" : "false");
}
panelToggle.addEventListener("click", () => setPanelOpen(!appEl.classList.contains("panel-open")));
panelScrim.addEventListener("click", () => setPanelOpen(false));

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
      clearConversation();
      enableChat();
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
  }
}

// ---- Authentication -------------------------------------------------------
function showAuth() {
  authMode = "login";
  applyAuthMode();
  $("authPass").value = "";
  authOverlay.hidden = false;
  panelToggle.hidden = true; // keep the drawer toggle off the login screen
  setPanelOpen(false);
  $("authUser").focus();
}

function onAuthed(user) {
  authOverlay.hidden = true;
  account.hidden = false;
  $("accountName").textContent = user.username;
  peopleCard.hidden = false;
  panelToggle.hidden = false; // reveal the mobile drawer toggle
  loadPeople();
}

function applyAuthMode() {
  const reg = authMode === "register";
  $("authTitle").textContent = reg ? "Create your account" : "Welcome to Astroman";
  $("authSub").textContent = reg
    ? "Pick a username and a password (at least 8 characters)."
    : "Log in to cast and save charts.";
  authSubmit.textContent = reg ? "Create account" : "Log in";
  $("authSwitchText").textContent = reg ? "Already have an account?" : "New here?";
  $("authSwitch").textContent = reg ? "Log in" : "Create an account";
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
  const username = $("authUser").value.trim();
  const password = $("authPass").value;
  const label = authSubmit.textContent;
  authSubmit.disabled = true;
  authSubmit.textContent = "…";
  try {
    const res = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
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

initAuth();
