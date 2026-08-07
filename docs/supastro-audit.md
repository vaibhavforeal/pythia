# Supastro — feature audit & gap analysis vs Astroman

**Audited:** 7 Aug 2026 · **Source:** supastro.com public surface (155 URLs from
`sitemap.xml`, plus `/release-notes`, `/roadmap`, `/how-it-works`, `/ai-agent`, `/tools`)

**Scope.** §1–2 are *what they publish about themselves* — marketing pages,
release notes, roadmap. Their headline numbers (127 metrics, 300+ yogas, 21
charts, 148 variables, 50k users, sub-50ms) are claims, not measurements.
**§3 is verified** — the signed-in dashboard was entered on a free "Seeker"
account and the navigation, module list and credit pricing were read directly
off the product. No paid reading was generated, so module *output quality* is
still unverified.

---

## 1. What Supastro is

A Vedic astrology product positioned as an **agentic** system rather than a
chatbot: chart computed first, classical rule retrieved from a Sanskrit corpus
second, LLM only at step 10 of a 13-step pipeline. Brand line is anti-fear /
anti-gemstone ("Math over fear", "No fear · No stones · No guilt").

**Monetisation** — credits, not per-report:

| Plan | Price | Credits |
|---|---|---|
| Free | ₹0 | 5 credits + 7 always-free dashboard tools |
| Plus | ₹599/mo | 15/mo, everything unlocked |
| Agentic Dashboard | ₹1,799/mo | 50/mo, everything unlocked (pushed as "most popular") |
| Premium Vedic Report | ₹4,799 one-time | Human-written, 24h delivery, 20+ pages, bundles dashboard access |

Every paid feature shows its credit cost before running; re-opening a generated
reading is free; monthly credits reset on billing date, top-ups spend after.
Payments via Razorpay.

---

## 2. Feature inventory

### 2.1 Free, no-login tools — 40 of them

This is their entire top-of-funnel and it is the single largest structural
difference from Astroman. Each is its own indexed URL under `/tools/`.

- **Decode yourself (11):** Blueprint (full read), Red Flags, Money Superpower,
  Baby Name by Star, Which Deity to Pray To, Birth Star Finder, Soul & Partner
  Planet, Arudha Lagna ("how others see you"), Aura Palette, Fight Style,
  Pitru Dosha
- **You + them (11):** Compatibility, Celebrity Match, Love Timing,
  Situationship Check, The One You Fall For, Rizz Rating, Text Them Back?,
  Upapada/Marriage Pada, Soulmate Sketch, Ex Autopsy, Manglik Check
- **Your timeline (6):** Dasha Timeline, Sade Sati Check, Muhurta ("Best Time
  To…"), Year Card, Main Character Era, Your 2026 in a Word
- **Today's sky (8):** Mercury Retrograde?, Planetary Weather, Panchang,
  Current Transits, Transits For You, Retrograde Survival Kit, 2026 Transits,
  Choghadiya Now
- **Numbers & names (2):** Name Numerology, Birthday Decoder
- **Ask (2):** Ask the Stars (3 free questions), Prasna/horary

Note the deliberate register split: half are classical (Arudha, Upapada, Pitru
Dosha, Prasna), half are shareable Gen-Z bait (Rizz Rating, Ex Autopsy,
Situationship Check). Same engine, two audiences.

### 2.2 Free tier once signed in — 7 tools

Panchang Today · Choghadiya & Hora · Muhurat Finder · My Calendar (30 days
scored) · Live Transits · 30-Day Destiny Window · My Details. Plus 5 credits.

### 2.3 Dashboard modules

Named across the roadmap's "extends" links and release notes:

Oracle Chat (voice + text) · Life/Karmic Journal · Live Dasha clock ·
Dasa Timeline · Planetary Transits · Ashtakavarga panel · Yogas & Doshas
(with activation timing) · Chart Details · 16 divisional charts · Karma DNA ·
Karmic Patterns · Soul Code ("Your Purpose") · Year Ahead · Compatibility /
Match Report · Family Profiles · Destiny Window + Destiny Calendar ·
Day Score · Panchang Today / Choghadiya / Muhurat · Remedy Panel ·
Ishta Devata + Gotra · Birth Time Rectification · Retrograde Karma report ·
Medical & Accident timing module · Margin Notes · Subscription page ·
Escalate (in-app bug report) · 9-min Explainer Masterclass onboarding

### 2.4 The nine AI agents

Shipped 3 Jul 2026 (six) and 9 Jul 2026 (three more):

| Agent | Mode | Output |
|---|---|---|
| Auspicious Timing | reactive | Ranked timing plan |
| Daily Briefing | proactive | Interpreted day (free tier) |
| Daily Agentic Planner | proactive | Hour-by-hour calendar blocks |
| The Big Day Agent | reactive | Fixed-date playbook |
| The Decision Room | reactive | Scored A/B verdict + live web facts + sources |
| The Sadhana Coach | both | Structured practice plan + reminders |
| The Council | multi-agent | 3 specialists → Verifier → Chief, dissent preserved |
| Saturn Companion | proactive | Phase-aware Sade Sati programme (free) |
| Karmic Life OS | both | Self-updating 90-day plan, 30/60/90 checkpoints |

The Council's five roles: Dasha Timer, Chart Analyst, Karma Reader, Verifier,
Chief — each answer carries a confidence percentage.

### 2.5 Cross-cutting layers

- **Voice:** speak questions, hear answers read back; transcription with
  sentiment polarity + intent classification in one round-trip; 15-state
  emotion model
- **Memory:** behavioural memory tracking dominant life domains, emotional
  trend, expertise level and preferred response stance — stored as aggregate
  signals, explicitly *not* raw chat text
- **Margin Notes:** highlight-to-save from any report, auto-stamped with active
  dasha + tithi + nakshatra; search/filter/pin/export
- **Integrations (17 Jul 2026):** Google / Apple / Outlook Calendar, Todoist,
  Notion, Obsidian, plus .ics / CSV / Markdown export
- **RAG:** vector index over BPHS, Jaimini Sutras, Phaladeepika, Hora Sara,
  Saravali + medical and Nadi treatises
- **Proactive sentinel:** background re-compute on a schedule, one deduplicated
  nudge per real event
- **Guardrails:** pattern screen → classifier gate → locked system prompt
- **Stack:** Next.js-class SSR + Supabase-class Postgres with pgvector and RLS,
  multi-tier LLM router with prompt caching and failover

### 2.6 Content moat

~90 of the 155 URLs are content: 30 blog posts, 12 guides, 16 knowledge-base
articles, 8 founder notes, 13 `/compare/supastro-vs-X` pages (AstroSage,
AstroTalk, Co-Star, The Pattern, CHANI, Sanctuary, TimePassages, KundliGPT,
Vedic AstroGPT, Ask Soma, Askomm, AstroNidan), plus a Partner Portal at
`/astrologer/auth` for human astrologers. Also `/roadmap`, `/release-notes` (78
releases), `/reviews`, `/sample-report`, `/why-jpl` — all public and all
optimised for AI-search citation.

### 2.7 Their roadmap — 34 in the pipeline

Worth reading as a threat map, since it's where they're going next.

- **Discovery (21):** Pilgrimage Planner · Varshaphal (annual solar return) ·
  Medical Karma Report · Remedy Agent · Supastro Score (0–1000 karmic momentum) ·
  Family Karma Matrix · Dream Decoder · Shadow Self Coach · Child Chart
  Companion · The Letting-Go List · **and nine goal-driven life agents** —
  Exam & Admissions, Venture Launch, Big-Ticket Timing, Creator Income,
  Partner Search, Relationship Repair, Family-Planning Window, Heartbreak
  Healing, Visibility, Grief & Remembrance, Life Purpose
- **In development (9):** Soul Contract Report · Festival Intelligence ·
  Dasha Progression Timeline · Financial Window Engine · Multi-chart Family
  Compatibility · Personal Yantra generator · Career Growth Agent ·
  Wealth-Building Autopilot · Marriage Readiness Agent
- **In QA (3):** Birth Chart Accuracy Verifier · Shadbala Strength Report ·
  Vargottama Strength Finder
- **Closed beta (1):** Voice Mood Pulse (weekly emotional baseline)

---

## 3. Verified — inside the dashboard

Entered 7 Aug 2026 on a free account (tier label "Seeker", 5 credits).

### 3.1 Shell

Persistent header carries a live **Day Score** (96 on the day of audit), the
current **Choghadiya** window with countdown ("Labh until 02:04 am · next Shubh
in 1h 59m"), the Moon's **nakshatra**, and the city. Alongside: a **Sentinel
alerts** bell, credit balance with **Top up**, and a **Subscription** button.

Left rail has a **"Reading for" profile switcher** (multi-profile confirmed),
**The Guide**, **Connected apps**, and a standing nudge: *"Complex queries
consume multiple credits. Stay focused."*

The dashboard presents itself as a periodical — "Vol. III · August 7, 2026",
**"36 readings · ordered by section"**, with a table of contents numbered
`01.01`–`10.01`. Routing is client-side: everything renders at `/dashboard`,
so deep links to `/oracle` or `/dashboard/subscription` 404.

### 3.2 The ten sections, verified

| # | Section | Modules |
|---|---|---|
| 01 | AI Agents | Auspicious Timing · Daily Agentic Planner · The Council · Daily Briefing · The Big Day Agent · The Decision Room · The Sadhana Coach · Saturn Companion · Karmic Life OS |
| 02 | Begin here | Explainer Masterclass · Oracle Chat · Destiny Window |
| 03 | Blueprint | Life Timeline · Kaalachakra · Karma DNA · Karmic Patterns · The Shadow · Your Purpose · Ashtakavarga · Planet Strength · Chart Deep-Dive · My Details |
| 04 | Forecast | Year Ahead · Retrograde Karma · Royal Roast |
| 05 | Practice | Remedy · Your Gotra · Ishta Devata · Sadhana Streaks · Life Journal |
| 06 | Archive | Reports (saved PDFs) · Margin Notes |
| 07 | Bonds | Compatibility |
| 08 | Premium | Birth Time Rectification |
| 09 | Product | Roadmap (*personalised* action plan, not the public roadmap) |
| 10 | Support | Escalate |

**Not visible on any marketing page** — found only inside:

- **Kaalachakra** — a live "since you arrived" counter: days on Earth, seconds
  lived, trips around the Sun, full moons seen, days to next birthday. Pure
  vanity-retention surface, zero compute cost, prominently placed on Home.
- **The Shadow** — "Premium · Self only · 18+", a no-filter hidden-self reading
- **Royal Roast** — deliberately unserious chart roast, cheapest paid item
- **Life Timeline** — whole-life dasha map (their roadmap lists this as still
  "in development"; it's shipped)
- **Chart Deep-Dive** — nakshatra, Rahu-Ketu, devatas, amshas, Prana Pada
- **Sadhana Streaks** — daily practice check-in with a 30-day strip
- Birth Time Rectification references **D60, D81, D108, D144, D150** — beyond
  the Shodasavarga set

### 3.3 Credit pricing — the important finding

| Free (deterministic) | Paid (LLM synthesis) | Credits |
|---|---|---|
| Life Timeline | Royal Roast | 2 |
| Kaalachakra | Destiny Window | 3 |
| Ashtakavarga | Karma DNA | 4 |
| **Planet Strength (Shadbala)** | Your Purpose | 4 |
| Chart Deep-Dive | Year Ahead | 5 |
| Birth Time Rectification | Compatibility | 5 |
| Life Journal · Margin Notes | Auspicious Timing | 5 |
| Sadhana Streaks | The Big Day Agent | 5 |
| Oracle Chat (no upfront charge) | The Sadhana Coach | 5 |
| Daily Briefing | Karmic Life OS | 5 |
| Saturn Companion | The Decision Room | 6 |
| Daily Agentic Planner (+ 7pm email) | The Shadow | 6 |
| Explainer Masterclass | **The Council** | **8** |

**The rule they've landed on: deterministic math is free, LLM synthesis costs
credits.** That is a clean, defensible pricing axis and the single most
transferable thing in this audit — it maps token cost to price honestly, and it
makes the free tier genuinely useful rather than crippled.

**The economics that follow:**

- Free tier = 5 credits = **exactly one agent run**, then you're done. Auspicious
  Timing, Big Day, Sadhana Coach and Karmic Life OS all cost precisely 5. That
  is not an accident — it's a one-taste wall.
- Plus (₹599 / 15 credits) ≈ **₹40/credit** → 3 agent runs, or *under two*
  Council convocations, per month.
- Agentic Dashboard (₹1,799 / 50 credits) ≈ **₹36/credit** → a Council run costs
  ~₹288 of subscription.

The per-credit discount from Plus to Agentic is only ~10%, so the ₹1,799 tier
isn't sold on unit price — it's sold on Plus being visibly too thin to use.

### 3.4 Engine cross-check — is their "engine" real?

Their free panels made a decisive test possible: compute the same chart in both
engines and compare. Birth data from their *My Details* page
(2004-08-17 · 12:55 · Gadag · +05:30), run through Astroman's
`server/astro.js` + `server/ashtakavarga.js`.

**Chart layer — total agreement.** Lagna Scorpio; Sun/Moon/Mars/Mercury/Jupiter
in Leo H10, Venus/Saturn Gemini H8, Rahu Aries H6, Ketu Libra H12; Mercury,
Rahu, Ketu retrograde; Moon nakshatra Purva Phalguni pada 1; vargottama = Moon
and Saturn. Every value identical.

**Ashtakavarga — 82 of 84 cells identical.** Both engines return SAV 337 and
the classical BAV totals (48/49/39/54/56/52/39). Sun, Moon, Mars, Mercury,
Jupiter and Saturn match bindu-for-bindu across all twelve houses. The only
divergence is Venus in H1/H2 — they have 2/5, Astroman has 3/4.

**That single difference is a known textual fork, not an error in either
engine.** It traces to one cell: Venus's benefic places counted from Mars.

- *Phaladeepika* (Mantreswara) ch. 23 sl. 8 and *Brihat Jataka* (Varahamihira)
  ch. 9 v. 6 both give **3, 5, 6, 9, 11, 12** — Supastro's reading.
- Phaladeepika's own footnote records the alternative: *"According to Parasara,
  the 3rd, 4th, 6th, 9th, 11th and 12th places from Mars"* — **Astroman's
  reading**, consistent with its declared Parashari lineage.

**Conclusion: their compute engine is real.** An LLM asked to produce 84 bindu
values would not land on a classical recension in 82 cells and differ only on
the single documented variant. Two independent implementations converging this
tightly validates *both*. Supastro is not a wrapper, and the parity fight is on
interpretation and distribution — not arithmetic.

Two corroborating signals: their live header recomputes Choghadiya with a real
countdown, and Kaalachakra's five figures are mutually consistent
(693,318,841 s = 8,024.5 days; 8,024 ÷ 29.53 = 271 full moons).

**One real defect found on their side.** *My Details* labels the ascendant
"Scorpio · Purva Phalguni Pada 0". Purva Phalguni is a Leo nakshatra and padas
run 1–4 — they're rendering the **Moon's** nakshatra against the ascendant,
with an off-by-one pada. The true value for that lagna (Scorpio 5°25′) is
Anuradha pada 1. Their house math is right; the display field is wired wrong.

### 3.5 Integrations — marketing overstates

The `/dashboard/integrations` page shows **four** live OAuth connections:
**Todoist, Notion, ClickUp, Asana**. Microsoft To Do and Google Tasks are
"coming soon". A further 17 logos (Slack, Trello, TickTick, Things, Any.do,
Evernote, **Obsidian**, Airtable, Monday, Basecamp, Linear, Coda, Jira,
Superlist, Height, Miro, Figma) sit in an explicitly aspirational wall.

Their release notes claim Google/Apple/Outlook Calendar and Obsidian support —
none of those are connectable accounts here, so they're almost certainly
`.ics` / Markdown file export rather than true sync. Worth knowing before
treating "17 integrations" as a real gap.

---

## 4. What Astroman has today

Verified from the repo, not claims.

**Compute engine** (`server/`): sidereal Lahiri via Swiss Ephemeris (Moshier,
offline) · rashi + nakshatra + pada per graha · lagna with whole-sign houses ·
9 grahas with retrograde flags · graha drishti + conjunctions · D9 Navamsa with
vargottama flags · Shodasavarga D2/D3/D4/D7/D10/D12/D16/D20/D24/D27/D30/D40/D45/D60 ·
Vimshottari Dasha (MD/AD + upcoming) · Ashtakavarga BAV + SAV · ~15 yoga
families auto-detected · Gochar transits with house-from-Moon and house-from-Lagna ·
Sade Sati with rising/peak/setting phases + Kantaka/Ashtama Shani ·
36-guna Ashtakoot Guna Milan with Nadi/Bhakoot dosha + Manglik with three
cancellation rules · planetary dignity + combustion (documented heuristic,
explicitly *not* Shadbala) · domain synthesis anchored to varga + lagna-lord +
dasha.

**Product:** Claude chat via Azure Foundry grounded in `Vedic Astrology Skill.md` ·
multi-conversation history · situation/domain cards · saved people per account ·
**friends graph with requests, blocking and invite links** · **Soul IDs** ·
**daily check-in streaks** · **push notifications + daily push cron** ·
**PWA with service worker** · share images · Cosmic ID / constellation visual ·
nerd mode · Capacitor mobile wrapper · Open-Meteo geocoding with curated city
fallback · email+password (scrypt), Google OAuth and phone/OTP login.

---

## 5. The gap

### 5.1 Present in both

Chart engine core · divisional charts (they claim 16, you have 15 + D1) ·
Vimshottari dasha · Ashtakavarga · yogas · transits · Sade Sati · Guna Milan +
Manglik · AI chat over the chart · Google login · mobile.

**Your engine is not the gap.** On raw classical computation you are close to
parity, and your yoga/dosha/Guna-Milan work is real code with tests, against
their unverifiable "300+ yogas".

### 5.2 They have it, you don't

Ordered by how much it would cost them if you closed it.

| Gap | Why it matters |
|---|---|
| **40 free no-login tools** | Their entire acquisition engine. Every tool is an indexed landing page and a share loop. You have zero unauthenticated surface — Astroman is login-first. |
| **Content library (~90 URLs)** | Blog + guides + KB + 13 competitor-comparison pages. Built to be cited by ChatGPT/Perplexity, not just ranked by Google. |
| **Credits + subscription billing** | You have no monetisation path in the repo at all. |
| **Agent layer (9 agents)** | Their core differentiation claim. Plans, checklists, calendar exports, saved runs — output that outlives the chat. |
| **Proactive/scheduled intelligence** | Sentinel re-computes and nudges on real events. You have a daily push cron — the plumbing exists, the intelligence behind it doesn't. |
| **Voice in and out** | Transcription + sentiment + intent, answers read back. |
| **Behavioural memory** | Cross-session memory of domains, emotional trend, preferred stance. Your conversations are stored but not mined. |
| **RAG over classical texts** | You ground the model in one skill markdown; they retrieve from a vector index of BPHS/Jaimini/Phaladeepika/Hora Sara/Saravali per query. |
| **Calendar / Notion / Todoist export** | Turns a reading into something on a calendar. |
| **Panchang / Choghadiya / Hora / Muhurta** | Whole daily-timing category you don't compute. Cheap to add — it's deterministic math, no AI. |
| **Shadbala** | You explicitly ship a documented heuristic instead. Their roadmap lists Shadbala as "in QA" — but it is **already live and free** in the dashboard as *Planet Strength · Shadbala intelligence*. This is a current gap, not a future one. |
| **Sadhana Streaks** | They ship a daily practice check-in with a 30-day strip. You have streaks too — but yours are a generic app-open streak, theirs is attached to a prescribed remedy practice, which is a stronger reason to return. |
| **Birth Time Rectification** | Removes the single biggest data-quality blocker for new users. |
| **Relationship type on a profile** | Their "Add a bond" form captures **Relationship (Spouse / Child / Parent / Sibling / Friend)**, which lets them decide which readings even apply to a given profile. Astroman's saved people and friends graph carry no relationship type. |
| ~~Gender on the person~~ | **Closed 7 Aug 2026.** `#birthForm` now captures Male/Female/Other, persisted on `users` and `people`; the Guna Milan role is derived from it, so the groom/bride toggle only appears when gender genuinely can't settle it. See `server/gender.js`. |
| ~~Inclusive compatibility~~ | **Closed 7 Aug 2026.** `computeGunaMilanSymmetric` scores a couple both ways and averages when the pair isn't one man and one woman. Measured first: swapping the two people changes the total for **~68% of pairs**, and the directional kutas are exactly **Varna, Gana and Vashya** (Tara, Yoni, Graha Maitri, Bhakoot and Nadi are side-independent). Both readings and their spread are surfaced rather than hidden behind an average, and the LLM context is told not to call either person the groom or the bride. |
| ~~Gender-dependent karakas~~ | **Closed 7 Aug 2026.** The kalatra-karaka now reads Venus for a male nativity and Jupiter for a female one, graded and fed to the chat context. "Other" shows both, flagged ambiguous; an unanswered gender asserts nothing rather than defaulting to Venus. |
| **Long-form reports** | Karma DNA, Karmic Patterns, Soul Code, Year Ahead, 20+ page PDF. You have chat; they have artifacts. |
| **Day Score / Destiny Window** | A daily scored number is the habit hook that brings people back. |
| **Family profiles + multi-chart** | You have saved people; they build cross-chart analysis on top. |
| **Ishta Devata, Gotra, Arudha, Upapada, Prasna, Varshaphal** | Classical modules you don't compute. |
| **Onboarding masterclass, escalate form, subscription page** | Product-surface polish. |

### 5.3 You have it, they don't

This is the more useful half of the audit — it's the part they can't
copy quickly, because it's a different product shape.

| Yours | Note |
|---|---|
| **Friends graph** — requests, accept/decline, blocking | Supastro has *family profiles* (charts you own). They have no social graph, no other-user relationship at all. |
| **Invite links + invite-based matching** | A viral loop tied to a real astrological payoff (match against the person who invited you). Their sharing is screenshot-only. |
| **Soul IDs** | Shareable identity handles. Nothing equivalent on their side. |
| **Phone/OTP login** | They ship email + Google only — OTP matters for the Indian market. |
| **Offline chart math + PWA** | Moshier needs no ephemeris files and no network; service worker and Capacitor already wired. Theirs is entirely server-rendered — every view needs the network, and their whole dashboard is client-routed under one `/dashboard` URL. |
| **Push already wired** | The plumbing for proactive nudges exists (devices, daily cron); only the intelligence behind it is missing. |
| **Open engine** | Every number is inspectable in your own code, with tests. Their "127 metrics" is a claim on a marketing page — though §3.4 shows the engine behind it is real. |
| **Verified table provenance** | Your Guna Milan and Ashtakavarga tables have traced, deliberate sources (see `memory/gunamilan-table-sourcing.md`, `memory/ashtakavarga-table-sourcing.md`). §3.4 shows you follow Parashara where they follow Varahamihira — a defensible position they almost certainly can't articulate. |

---

## 6. Reading of it

Three honest conclusions:

1. **You're not behind on astrology, you're behind on distribution.** Their 40
   free tools and 90 content pages are the moat, not the ephemeris. The
   cheapest high-value move available to you is unauthenticated tool pages
   built on math you already have — Sade Sati, dasha era, nakshatra, Manglik,
   Guna Milan and transits are all shipped code sitting behind a login wall.

2. **The panchang/muhurta category is a free win.** Choghadiya, Hora, tithi,
   yoga, karana and muhurta scoring are deterministic, need no AI, cost no
   tokens, and are exactly the daily-return habit you currently lack. They put
   these in the *free* tier because they're cheap to run and they retain.

3. **Your social layer is a genuinely different bet.** Supastro's roadmap is
   nine more single-player life agents. Nobody in their 13 compare-pages —
   AstroSage, AstroTalk, Co-Star, The Pattern, CHANI — is building a friend
   graph with invite-based matching. That's the axis where you're not playing
   catch-up.

4. **Steal their pricing axis, not their price.** *Deterministic math free, LLM
   synthesis paid* is the cleanest monetisation rule available to a product
   like this: it tracks your actual marginal cost, it makes the free tier
   genuinely good, and it never forces you to defend charging for arithmetic.
   Astroman's split falls almost exactly along the same line already — the
   whole `server/` engine is deterministic, only `/api/chat` costs tokens.

5. **Their free tier is one taste, deliberately.** 5 credits, and the flagship
   agents cost exactly 5. Note also what they *don't* meter: everything
   habit-forming (Day Score, Choghadiya, streaks, journal, Kaalachakra) is
   free, because retention is worth more than the credit. Only the things a
   user would pay a human astrologer for are metered.

6. **Watch the trial-dedup trick.** Their wall keys on the **birth chart**, not
   the email — "changing your email won't change your karma". For this product
   category that's the one identity a user can't vary without invalidating
   their own reason for being there. If Astroman ever gates a trial, this is
   the control to copy.

## 7. Not covered

- **Output quality of any paid module.** Nothing was generated — running even
  one agent would have consumed the account's entire 5-credit balance. So the
  9 agents, Karma DNA, Year Ahead, The Shadow, Compatibility and the Council
  are confirmed to *exist* at a confirmed price, but their actual reading
  quality is unassessed.
- **Oracle Chat behaviour** — no message was sent, so streaming, citation
  quality and the claimed D1–D60 referencing are unverified.
- **Voice, behavioural memory and the proactive sentinel** — all require sustained
  real usage across days to observe.
- **The ₹4,799 human-written Premium Report.**
