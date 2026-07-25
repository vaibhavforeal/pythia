// Shared birth-form plumbing: live city geocoding and the coordinate guard.
// Loaded by both the app (app.js) and the public invite page (invite.js), so
// an invitee gets exactly the same city lookup without pulling in the app.

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
  let fromPick = false; // true while lat/lon/tz hold values we filled from a pick

  const apply = m => {
    latEl.value = m.lat;
    lonEl.value = m.lon;
    // A place with no known timezone yields tz: null — blank the field rather
    // than leaving the previous city's offset behind (it's hidden by default).
    tzEl.value = m.tz === null || m.tz === undefined ? "" : m.tz;
    fromPick = true;
  };

  // Typing past a picked city invalidates its coordinates: drop them so we
  // can't cast a chart for one place while the city box names another.
  const dropPicked = () => {
    if (!fromPick) return;
    latEl.value = lonEl.value = tzEl.value = "";
    fromPick = false;
  };

  // A manual edit takes ownership of the fields — never wipe those.
  [latEl, lonEl, tzEl].forEach(el => el.addEventListener("input", () => (fromPick = false)));

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
    dropPicked();
    const q = cityEl.value.trim();
    if (q.length < 2 || q === lastQuery) return;
    lastQuery = q;
    clearTimeout(timer);
    timer = setTimeout(() => search(q), 250);
  });
  cityEl.addEventListener("change", () => {
    if (byLabel.has(cityEl.value)) apply(byLabel.get(cityEl.value));
  });

  // Lets callers that fill lat/lon/tz themselves (e.g. loading a saved person)
  // claim the fields, so later city typing doesn't clear them as stale picks.
  return () => (fromPick = false);
}

// True only when lat, lon and tz are all present (a picked city fills them).
// tz can legitimately be "0" (UTC), so test for empty strings, not falsiness.
function coordsMissing(latEl, lonEl, tzEl) {
  return [latEl, lonEl, tzEl].some(el => String(el.value).trim() === "");
}
