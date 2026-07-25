// Public invite page. No session, no app state — it reads the token from the
// URL, shows who invited you, takes your birth details and returns the match.
//
// Everything sensitive stays server-side: this page never receives the
// inviter's birth date, time or place (see server/invite.js).
const $ = id => document.getElementById(id);

// /i/<token>
const TOKEN = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");

const SHIP = {
  excellent: { emoji: "✦", head: "written in the stars", sub: "basically soulmates" },
  good: { emoji: "♡", head: "green-flag energy", sub: "strong match" },
  average: { emoji: "◑", head: "worth a shot", sub: "potential, needs effort" },
  poor: { emoji: "△", head: "the stars said pause", sub: "proceed with caution" }
};

const ZODIAC_GLYPH = {
  Aries: "♈︎", Taurus: "♉︎", Gemini: "♊︎", Cancer: "♋︎", Leo: "♌︎", Virgo: "♍︎",
  Libra: "♎︎", Scorpio: "♏︎", Sagittarius: "♐︎", Capricorn: "♑︎", Aquarius: "♒︎", Pisces: "♓︎"
};

// Scores can be halves (Nadi/Bhakoot), so trim a trailing .0 rather than round.
const fmtScore = n => (Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(1));

function showError(msg) {
  $("inviteLoading").hidden = true;
  $("inviteMain").hidden = true;
  $("inviteError").hidden = false;
  if (msg) $("inviteErrorMsg").textContent = msg;
}

function showFormErr(msg) {
  const el = $("g_err");
  el.textContent = msg;
  el.hidden = false;
}

// ---- Advanced (manual coordinates) toggle ---------------------------------
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
const revealAdvanced = wireAdvanced("g_advToggle", "g_advFields");

wireCityGeocode($("g_city"), $("g_cityList"), $("g_lat"), $("g_lon"), $("g_tz"));

// ---- Load the invite ------------------------------------------------------
async function loadInvite() {
  if (!TOKEN) return showError("That link looks incomplete.");
  try {
    const res = await fetch(`/api/invite/${encodeURIComponent(TOKEN)}`);
    const data = await res.json().catch(() => ({}));
    if (res.status === 410) return showError("This invite has expired. Ask them for a fresh link.");
    if (!res.ok) return showError(data.error || "We couldn't find this invite.");

    const inv = data.inviter || {};
    $("ivName").textContent = inv.name || "Someone";
    document.title = `${inv.name || "Someone"} wants to check your compatibility · Pythia`;
    if (inv.moonSign && ZODIAC_GLYPH[inv.moonSign]) $("ivGlyph").textContent = ZODIAC_GLYPH[inv.moonSign];

    // Their signs only — enough to feel personal, nothing identifying.
    const bits = [
      inv.moonSign ? `<span><i>☾</i>${inv.moonSign}</span>` : "",
      inv.nakshatra ? `<span><i>★</i>${inv.nakshatra}</span>` : "",
      inv.risingSign ? `<span><i>↑</i>${inv.risingSign}</span>` : ""
    ].filter(Boolean).join("");
    $("ivSigns").innerHTML = bits;

    $("inviteLoading").hidden = true;
    $("inviteMain").hidden = false;
  } catch (_) {
    showError("Couldn't reach Pythia — check your connection and reload.");
  }
}

// ---- Submit ---------------------------------------------------------------
$("inviteForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("g_err").hidden = true;

  const dob = $("g_dob").value;
  const tob = $("g_tob").value || "12:00";
  if (!dob) return showFormErr("Please enter your date of birth.");

  if (coordsMissing($("g_lat"), $("g_lon"), $("g_tz"))) {
    revealAdvanced();
    const located = [$("g_lat"), $("g_lon")].every(el => String(el.value).trim() !== "");
    return showFormErr(
      located
        ? "We couldn't work out the UTC offset for that place — please enter it below."
        : "Pick your city from the list so we can locate your chart — or add coordinates manually below."
    );
  }

  const [year, month, day] = dob.split("-").map(Number);
  const [hour, minute] = tob.split(":").map(Number);
  const btn = $("g_submit");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Checking…";

  try {
    const res = await fetch(`/api/invite/${encodeURIComponent(TOKEN)}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: $("g_name").value.trim(),
        year, month, day, hour, minute,
        lat: $("g_lat").value, lon: $("g_lon").value, tz: $("g_tz").value
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 410) return showError("This invite expired while you were filling it in.");
    if (!res.ok) return showFormErr(data.error || "Compatibility check failed.");
    renderResult(data);
  } catch (_) {
    showFormErr("Couldn't reach Pythia — check your connection and try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

function renderResult(data) {
  const m = data.match || {};
  const inviterName = (data.inviter && data.inviter.name) || "Them";
  const yourName = $("g_name").value.trim() || "You";
  const ship = SHIP[m.verdict && m.verdict.band] || SHIP.average;
  const pct = m.max ? Math.round((m.total / m.max) * 100) : 0;

  const kutas = (m.kutas || [])
    .map(k => `<li><span>${k.name}</span><b>${fmtScore(k.score)}/${fmtScore(k.max)}</b></li>`)
    .join("");

  // doshas is a flag object — { nadi: bool, bhakoot: bool } — not a list, and
  // the manglik verdict carries `label`. Getting either wrong throws in here
  // and the guest sees nothing at all, so both are read defensively.
  const flags = [];
  const mv = (m.manglik && m.manglik.verdict) || null;
  if (mv && (mv.label || mv.note)) flags.push(mv.label || mv.note);
  const d = m.doshas || {};
  if (d.nadi) flags.push("Nadi dosha — you share a nadi, traditionally the heaviest flag in this system.");
  if (d.bhakoot) flags.push("Bhakoot dosha — your Moon signs sit awkwardly to each other (6/8 or 2/12).");

  $("ivResult").innerHTML = `
    <div class="ivr-head">
      <div class="ivr-emoji">${ship.emoji}</div>
      <div class="ivr-score">${fmtScore(m.total)} <small>/ ${fmtScore(m.max)}</small></div>
      <div class="ivr-verdict">${ship.head}</div>
      <div class="ivr-sub">${(m.verdict && m.verdict.label) || ship.sub} · ${pct}% matched</div>
      <div class="ivr-who">${escAttr(yourName)} <i>✕</i> ${escAttr(inviterName)}</div>
    </div>
    ${kutas ? `<ul class="ivr-kutas">${kutas}</ul>` : ""}
    ${flags.length ? `<div class="ivr-flags">${flags.map(f => `<p>${escAttr(f)}</p>`).join("")}</div>` : ""}
    <div class="ivr-share">
      <button type="button" id="ivShare">Share this ✦</button>
    </div>
    <div class="ivr-cta">
      <p>That's the 36-guna Ashtakoot score — real Vedic math, not a vibe check.</p>
      <a class="invite-cta" href="/app">Get your own full chart ✦</a>
      <small>Your Cosmic ID, today's vibe, the era you're in — free.<br />
        Sign up and we'll send ${escAttr(inviterName)} a request to connect.</small>
    </div>`;

  // Same 9:16 card the app produces — buildMatchStoryImage needs exactly the
  // match object, and boy/girl survive publicMatch since they're sign-level.
  const shareBtn = $("ivShare");
  if (shareBtn) {
    shareBtn.addEventListener("click", () =>
      runShare(shareBtn, "Creating…", async () => {
        const blob = await buildMatchStoryImage(m);
        await shareOrDownload(blob, "pythia-match.png", "Our Cosmic Match", "our cosmic compatibility ✦ via Pythia");
      })
    );
  }

  $("inviteForm").hidden = true;
  $("ivResult").hidden = false;
  $("ivResult").scrollIntoView({ behavior: "smooth", block: "start" });
}

loadInvite();
