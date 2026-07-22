# Pythia ✦

A local **Vedic astrology + numerology** consultation tool with a GPT-style chat
interface. It computes an accurate sidereal (Lahiri) birth chart with the **Swiss
Ephemeris**, then lets you converse with **Claude** — grounded in your
`Vedic Astrology Skill.md` practitioner prompt — for guidance across life,
career, relationships, timing (dasha), doshas, and remedies.

```
Birth details ──► Swiss Ephemeris (sidereal) ──► chart JSON
                                                    │
        your question ──► Claude (Opus 4.8) ◄───────┘  ──► streamed reading
```

## What it computes

- **Rashi** (moon/planet signs), **Nakshatra + pada** for every graha
- **Lagna** (ascendant) with **whole-sign houses** (Vedic standard)
- **Sun · Moon · Mars · Mercury · Jupiter · Venus · Saturn · Rahu · Ketu**, with retrograde flags
- **Graha drishti** (aspects) — which planets each graha sees and is seen by, plus conjunctions
- **Navamsa (D9)** — divisional chart with Lagnamsa, D9 houses, and vargottama flags
- **Divisional charts (vargas)** — the Shodasavarga set (D2 Hora, D3 Drekkana, D4, D7 Saptamsa, D10 Dasamsa/career, D12, D16, D20, D24, D27, D30 Trimsamsa, D40, D45, D60), each with its correct Parashari rule, viewable from a selector
- **Vimshottari Dasha** — current Mahadasha / Antardasha with dates, plus upcoming periods
- **Ashtakavarga** — Bhinnashtakavarga (per-planet) and Sarvashtakavarga (SAV, total 337) bindu strength by sign and house
- **Yogas** — auto-detects the classic named combinations: Pancha Mahapurusha (Ruchaka/Bhadra/Hamsa/Malavya/Sasa), Gaja Kesari, Budha-Aditya, Chandra-Mangala, Raja & Dhana lord-links, Neecha Bhanga Raja, Vipreet Raja, the lunar Sunapha/Anapha/Durudhara/Kemadruma set, Kala Sarpa, and Parivartana — shown on the chart card and fed to the chat
- **Current transits (Gochar)** — today's planetary positions with house-from-Moon and house-from-Lagna
- **Sade Sati** — active/next window with rising/peak/setting phase dates, plus small-panoti (Kantaka/Ashtama Shani) detection
- **Guna Milan (Ashtakoot)** — 36-guna marriage compatibility against a second chart: all eight kutas (Varna, Vashya, Tara, Yoni, Graha Maitri, Gana, Bhakoot, Nadi) with a verdict band and explicit **Nadi / Bhakoot dosha** flags, plus **Manglik (Mangal dosha)** detection (from Lagna, Moon & Venus) with cancellations — mutual (both Manglik), Mars in own/exalted sign, and benefic (Jupiter/Venus) aspect
- **Lahiri ayanamsa**

The engine uses the Swiss Ephemeris' built-in **Moshier** model, so it needs **no
data files** and works offline for the chart math. (The chat step and the city
search reach the internet — the city search falls back to a built-in list offline.)

## Setup

Requires **Node.js 18+**.

```bash
# 1. install dependencies (sweph ships prebuilt binaries — no compiler needed on most systems)
npm install

# 2. configure .env
cp .env.example .env      # set AZURE_INFERENCE_* for chat, and SESSION_SECRET for login cookies

# 3. run
npm start
```

Open **http://localhost:3030**, create an account, cast your chart, and start asking.

> **Accounts:** the app is behind a login (multi-user). Set `SESSION_SECRET` in
> `.env` so sessions survive restarts, and set `COOKIE_SECURE=true` when serving
> over HTTPS. Passwords are scrypt-hashed. Accounts and saved charts are stored
> in **Supabase Postgres** when `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` are set,
> otherwise in local JSON files under `server/data/` (fine for offline dev).

> The chat step calls **Claude via Azure AI Foundry's Anthropic Messages API** —
> set `AZURE_INFERENCE_ENDPOINT` to the full messages URL
> (`https://<resource>.services.ai.azure.com/anthropic/v1/messages`),
> `AZURE_INFERENCE_KEY` to the endpoint key, and `AZURE_DEPLOYMENT` to your
> deployed model name. The chart and Guna-Milan math run offline, so the app
> still boots and casts charts without them.

## Using it

The app is behind a login — **create an account** on first visit. Each account
keeps its own private **Saved people** list: cast a chart, hit **★ Save current**
to store it, and click a saved name any time to reload and re-cast it.

1. Fill in **date**, **time**, and **place** of birth. Type a city and pick a
   match — latitude, longitude and UTC offset are fetched automatically
   (Open-Meteo geocoding); you can still edit them directly.
2. Click **Cast chart** — the summary appears on the left.
3. Ask anything in the chat, or tap a suggestion chip (Overview, Current phase,
   Career, Relationships, Doshas & remedies).
4. For **compatibility**, open the Guna Milan card, enter a partner's birth
   details, and **Check compatibility** — the 36-guna score, Nadi/Bhakoot dosha
   flags and Manglik verdict appear on the left. Hit **Discuss this match in
   chat** and the full result (plus the partner's chart) is handed to Claude for
   a grounded interpretation; you can then keep asking follow-up questions.

**On birth time & timezone:** the offset field is *standard* time. If you were
born during daylight-saving, add **+1** hour to the offset. Positions near a sign
boundary (sandhi) are sensitive to an accurate birth time.

## Higher precision (optional)

Moshier mode is accurate to a fraction of an arc-second for modern dates. If you
want the full Swiss Ephemeris precision, drop the `.se1` data files into an
`ephe/` folder and change the flag in `server/astro.js`:

```js
sweph.set_ephe_path(path.join(__dirname, "..", "ephe"));
const CALC_FLAGS = C.SEFLG_SWIEPH | C.SEFLG_SPEED | C.SEFLG_SIDEREAL;
```

## Project layout

```
server/
  index.js    Express server + Claude streaming (SSE)
  astro.js    Swiss Ephemeris chart computation
  dasha.js    Vimshottari dasha
  gunamilan.js Ashtakoot Guna Milan (36-guna compatibility)
  yogas.js    detects named yogas (Mahapurusha, Raja, Dhana, lunar, Kala Sarpa…)
  auth.js     accounts — scrypt hashing + signed session cookies + rate limit
  store.js    users + saved people — Supabase Postgres, or local JSON fallback
  cities.js   built-in city gazetteer (offline geocoding fallback)
  skill.js    loads the Vedic system prompt
public/
  index.html  UI
  styles.css
  app.js       chart form + streaming chat client
Vedic Astrology Skill.md   the practitioner system prompt (drives the readings)
```

## Deploying online

The app needs a **persistent Node process** (not edge/serverless): it uses a
native ephemeris module and streams the chat over SSE, so **Vercel / Netlify /
Cloudflare Workers won't run it.** Use a managed **Docker host** (Render /
Railway / Fly) with **Supabase Postgres** for accounts — no persistent disk
required. The repo ships a `Dockerfile`, a Render blueprint, and `supabase/schema.sql`.

**1. Supabase (database):**

- Create a project at [supabase.com](https://supabase.com).
- **SQL Editor** → paste `supabase/schema.sql` → **Run** (creates the tables).
- **Settings → API** → copy the **Project URL** and the **`service_role` key**
  (server-side only, keep it secret).

**2. Render (app):**

1. Push this repo to GitHub.
2. On [render.com](https://render.com) → **New → Blueprint**, select the repo.
   `render.yaml` provisions a Docker web service (free tier — no disk),
   sets `COOKIE_SECURE=true`, and auto-generates `SESSION_SECRET`.
3. Set the secrets when prompted: `AZURE_INFERENCE_ENDPOINT`, `AZURE_INFERENCE_KEY`,
   `SUPABASE_URL`, and `SUPABASE_SERVICE_KEY`.
4. Deploy. Render serves it over HTTPS; the health check is `/healthz`.

**Railway / Fly / any Docker host:** build the `Dockerfile` and set the same env
vars (`SESSION_SECRET`, `COOKIE_SECURE=true`, the `AZURE_*` and `SUPABASE_*`
vars). The host's injected `PORT` is used automatically.

Without `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`, the store falls back to local
JSON files under `server/data/` — handy for offline dev, but *don't* rely on it
in production (managed hosts have ephemeral disks). This build assumes a single
instance for session/rate-limit state.

## Notes & limits

- Guidance framework, **not** deterministic fate. For legal, financial, or
  medical decisions, treat it as one perspective among many.
- Uses **mean** lunar node for Rahu/Ketu and **Lahiri** ayanamsa (the most common
  conventions). Both are easy to change in `server/astro.js`.
- **Graha drishti** (aspects) are whole-sign full aspects: all planets aspect the
  7th; Mars also 4th/8th, Jupiter 5th/9th, Saturn 3rd/10th. Rahu/Ketu default to
  the Jupiter-like **5th/7th/9th**; toggle to 7th-only via the switch on the chart
  card (or change the default in `server/astro.js`).
- Dasha uses a 365.25-day year; boundary dates are approximate.
