# Jyotish synthesis hierarchy — design

**Date:** 2026-08-04
**Status:** approved, not yet implemented
**Branch:** `feat/jyotish-synthesis-hierarchy`

## Problem

A practising astrologer reviewed the situation cards and said:

> The cards are where you'll lose people — dumping every factor in just reads as
> noise. Anchor each life area to its specific divisional chart (navamsa for
> relationship, dashamsa for career) and the lagna lord's condition, then let
> Vimshottari dasha and transits shade it, not the other way around. That's the
> synthesis that matches how Jyotish is actually practised.

The astrology in that is correct and the defect is real. The prescription is
incomplete in two ways, and this design supplies the missing halves.

## What is wrong today

**The cards never touch a divisional chart.** `server/vargas.js` computes D2–D60
and `server/astro.js` computes D9, but `public/domains.js` reads only D1: house
sign → its lord → where that lord sits → occupants → dasha. The vargas surface
only in the nerd tables and in the LLM dump. The app computes the evidence and
then ignores it.

**The tiers are flat, and the weakest signal is loudest.** `domainLine()`
(`public/domains.js:125`) joins house-ruler, occupants and era with
`bits.join(" ")` — three unconditional sentences of equal weight. The era clause
is actively promoted: "this is genuinely live for you right now, **not background
noise**" (`:134`) argues *for* the timing signal against the structure. That is
precisely the inversion named above.

**The model gets six facts with no order.** `domainContext()` (`:143`) emits a
flat list. Nothing tells the model that the house lord's condition outranks the
running dasha.

**The varga dump is unranked.** `chartToText()` (`server/astro.js:336`) flattens
all fourteen vargas into one table, so D40 Khavedamsa reaches the model weighted
exactly like D9. This is upstream of every chat answer and is the single largest
noise source in the app.

**Lagna lord condition does not exist as a concept.** `EXALT_SIGN`,
`DEBIL_SIGN` and `OWN_SIGNS` are unexported locals in `server/yogas.js:15-22`.
Nothing computes the ascendant ruler's condition, which is why every card reads
at the same emotional temperature — there is no chart-wide baseline modulating
them.

**There is no career card**, so the practitioner's own headline example (D10)
has nowhere to land.

### The two halves the prescription left out

1. **"Anchor to the divisional chart" is the wrong verb.** The varga does not
   replace the rashi, it grades it. D1 says whether the promise exists; the varga
   says whether it holds. Anchoring career to D10 *instead of* the 10th house is
   the classic amateur varga error and produces readings untethered from the
   birth chart. The rule for what to do when D1 and the varga disagree is the
   entire value of adding the varga, and it was not stated.

2. **The fix as given adds factors to a presentation problem.** The cards do not
   read as noise because the wrong factors are in them; they read as noise
   because nothing outranks anything. Stacking the varga and the lagna lord into
   the same flat join makes it worse. The real fix is *compute everything, print
   the top one*.

## The model

Three tiers, evaluated in a fixed order, per domain. Lower tiers never overturn
higher ones; they only qualify them.

```
BASELINE   lagna lord condition            chart-wide, computed once
   ↓
TIER 1     PROMISE   (D1 rashi)            does this area have substance?
   ↓
TIER 2     SUSTAIN   (the domain's varga)  does the promise hold up?
   ↓
TIER 3     SHADE     (dasha, then transit) is it live right now?
```

### Grading a planet

One function, reused for the lagna lord, the domain lord in D1, and the domain
lord in its varga. Produces a small integer, a list of reasons, and a band. The
integer is never shown to the user.

| component | values | applies |
|---|---|---|
| dignity | exalted +2 · own +2 · friend +1 · neutral 0 · enemy −1 · debilitated −2 | both |
| house class | kendra/trikona (1,4,5,7,9,10) +1 · dusthana (6,8,12) −1 · else 0 | both |
| combustion | −1 | **D1 only** |
| vargottama / `sameAsRashi` | +1 | **varga only** |

Bands: `strong` ≥ 2 · `mixed` 0–1 · `weak` ≤ −1.

Combustion is a longitude-versus-Sun fact and therefore a rashi property; it does
not propagate into a varga. It applies once, in tier 1 and to the lagna lord.

Vargottama is the mirror case — it is meaningless in D1 (a planet is trivially in
its own D1 sign) and is the classical marker of divisional strength, so it scores
only in tier 2. `computeDivisionals` already emits `sameAsRashi` per planet
(`server/vargas.js:115`) and the navamsa block already emits `vargottama`
(`server/astro.js:223`).

Retrogradity stays **out** of the score — classically it cuts both ways — and
surfaces as a bare flag.

**This is a documented heuristic, not Shadbala.** Real Shadbala is six-fold
(sthana, dig, kala, chesta, naisargika, drik) and Astroman does not compute it.
`server/dignity.js` must say so in its header, in the manner of the existing
disclaimer at `server/yogas.js:5`.

### The agreement verdict

Grade the domain lord in D1, grade it again in the varga, cross them:

| D1 | varga | verdict | reading |
|---|---|---|---|
| strong | strong | **holds** | real, and it sustains |
| strong | weak | **looks better than it holds** | presents well, thins out under load |
| weak | strong | **grows into it** | starts rough, matures — *not* "good" |
| weak | weak | **needs building** | takes deliberate work |

Bands are ordinal (`weak` < `mixed` < `strong`), so the full 3×3 resolves
deterministically:

```
drop that lands in weak      → looks better than it holds
rise that starts from weak   → grows into it
both weak                    → needs building
everything else              → holds
```

Which gives: strong/strong, strong/mixed, mixed/strong and mixed/mixed all yield
`holds`; strong/weak and mixed/weak yield `looks better than it holds`;
weak/strong and weak/mixed yield `grows into it`; weak/weak yields `needs
building`. Only the two middle verdicts count as DIVERGENCE in the precedence
below.

The asymmetry is load-bearing and is the classical rule: **a strong varga on a
weak D1 does not manufacture a promise that is not there** — it shows the thing
maturing. Getting this backwards turns the feature into the amateur error it was
meant to avoid.

All four verdicts describe conditions, never outcomes, preserving the existing
rule at `public/domains.js:175`.

## Domain map

| card | house | second | varga | role |
|---|---|---|---|---|
| friendships | 11 | 3 | D9 | `strength` |
| situationships | 7 | 5 | D9 | `domain` |
| home | 4 | 9 | D4 Chaturthamsa | `domain` |
| focus | 5 | 10 | D24 Siddhamsa | `domain` |
| career | 10 | 6 | D10 Dasamsa | `domain` |

`career` is new. Copy (emoji, kicker, head, houseLabel, ask) follows the existing
voice in `public/domains.js:42-67`.

**Friendships has no divisional chart** — there is no D11, and D3 is siblings and
courage, not network and gains. Rather than fake one, it uses navamsa in its
classical role as the **general** strength chart: D9 grades every planet for
every topic. `vargaRole: "strength"` marks this, and the copy must never imply
that D9 governs friendship. This is why the role field exists rather than the
varga key alone.

## Suppression

The card line has exactly two slots. Slot 1 is always the compressed promise.
Slot 2 is **one** factor, chosen by fixed precedence. Everything that loses is
still computed and still reaches the model — it is simply not printed.

```
slot 2 precedence
  1. DIVERGENCE   verdict is "looks better than it holds" or "grows into it"
  2. LOUD HOUSE   2+ occupants, or a malefic/benefic conjunct the lord
  3. AGREEMENT    verdict is "needs building"
  4. SHADE        the dasha touches this house
  5. AGREEMENT    verdict is "holds"
  6. — nothing. A one-sentence card is a valid card.
```

The agreement cases split deliberately. "Needs building" is a real finding and
outranks the era. A bare "holds" is the least surprising thing a card can say,
so it sits below the era touch — ranked above it, "holds" would fire on every
ordinary chart and the shade branch would be unreachable. The dasha still ranks
under every structural signal, which is the point; it is simply not ranked under
"nothing to report".

Ranking by divergence is the point: the most useful thing to say is where the
tiers disagree, which is the entire reason to compute a varga. The dasha drops to
fourth, so the era clause appears only when nothing structural is more
interesting — correct, because the dasha is the least informative signal when the
structure is already loud.

### Worked example

Taurus ascendant. 10th = Aquarius, ruled by Saturn, which sits in the 10th in its
own sign. Saturn Mahadasha. In D10 Dasamsa that same Saturn falls in Aries,
debilitated, in the 12th from the D10 lagna.

Today's card:

> Your 10th — work and status — is ruled by Saturn, sitting in your 10th, so it's
> bound to reputation — how it looks matters more than you admit. Saturn sits
> right in it, which makes this area loud for you. And your Saturn era rules it —
> this is genuinely live for you right now, not background noise.

Three sentences, mutually reinforcing, and structurally blind to the D10
collapse. Everything D1 can see says yes; the chart's own career divisional says
it does not sustain.

After:

> Your 10th is ruled by Saturn, sitting in its own sign right there — strong on
> paper. In the D10, the career chart, that same Saturn falls: **this looks
> better than it holds.**

Shorter, and it carries the finding. The occupant fact, the era touch and the
exact D10 house are all still computed and all still handed to the model.

**Tonal consequence, accepted:** cards become shorter and occasionally less
flattering. "Looks better than it holds" on someone's career card is a real thing
to read. It stays inside the conditions-not-outcomes rule, but it is a shift from
the current cards, which never disagree with themselves.

## Model context

`domainContext()` returns a tiered block with the hierarchy stated rather than
inferred:

```
BASELINE — Lagna lord Venus in the 9th, own sign: strong. They can act on what
  follows.
PROMISE (D1) — 10th house, Aquarius, ruled by Saturn, in the 10th in its own
  sign, a kendra: strong. Saturn also occupies the house it rules. Supporting 6th
  holds: Mars.
SUSTAIN (D10 Dasamsa) — that same Saturn falls in Aries, debilitated, 12th from
  the D10 lagna: weak.
VERDICT — looks better than it holds. The structure promises standing; the
  divisional says it does not sustain without deliberate maintenance.
SHADE — Saturn Mahadasha / Mercury Antardasha. The era lord rules this house, so
  the area is live.
RULE — PROMISE outranks SUSTAIN outranks SHADE. Never let the running dasha
  override the structural read. The dasha says when, never whether.
```

The `RULE` line is what makes the hierarchy reach the model. Nothing in the
current flat list tells it that six facts have an order.

For `vargaRole: "strength"` domains the SUSTAIN line is phrased as a general
strength grade, not as a claim that the varga governs the topic.

The supporting-house occupants (`second`) appear in the PROMISE line of the model
context only, never in the card line.

## `chartToText` changes

Ranked, not trimmed.

1. Lagna lord condition appended to the ascendant block (`server/astro.js:270`).
2. New `=== PRIMARY VARGAS ===` section immediately after the navamsa block
   (`:334`), naming each of the five domain anchors and its verdict.
3. The fourteen-row table at `:336` keeps its rows but is relabelled explicitly as
   supplementary reference, so D40 stops arriving weighted like D9. Nerd mode
   wants those rows and they are cheap; they just must not rank equally.

## Data shape

Attached to the chart as `c.synthesis`:

```js
{
  lagnaLord: {
    key: "Venus", house: 9, sign: "Capricorn",
    dignity: "own", combust: false, retro: false,
    score: 3, band: "strong",
    reasons: ["own sign (Capricorn)", "9th house — a trikona"]
  },
  domains: {
    career: {
      house: 10, sign: "Aquarius", lordKey: "Saturn",
      promise: { house: 10, sign: "Aquarius", dignity: "own", combust: false,
                 score: 3, band: "strong", reasons: [...] },
      sustain: { varga: "D10", vargaName: "Dasamsa", role: "domain",
                 house: 12, sign: "Aries", dignity: "debilitated",
                 vargottama: false, score: -3, band: "weak", reasons: [...] },
      verdict: "looks-better-than-it-holds",
      occupants: ["Saturn"], secondOccupants: ["Mars"],
      maha: "Saturn", antar: "Mercury", eraTouches: "rules it",
      slot2: "divergence"
    },
    // … friendships, situationships, home, focus
  }
}
```

`slot2` is computed server-side so the card and any future surface agree on what
was chosen.

## Files

| file | change |
|---|---|
| `server/dignity.js` | **new** — `dignityOf`, `isCombust`, `gradePlanet`; owns the dignity and friendship tables |
| `server/synthesis.js` | **new** — `DOMAIN_SPEC`, `lagnaLordCondition`, `domainSynthesis`, `computeSynthesis` |
| `server/astro.js` | call `computeSynthesis` after `dasha` (`:233`); attach `c.synthesis`; the three `chartToText` edits above |
| `server/yogas.js` | import dignity tables instead of defining them (`:15-22`) |
| `server/store.js` | backfill `synthesis` when reading a stored chart that lacks it |
| `public/domains.js` | rewrite — `DOMAINS` keeps copy only, gains `career`; `domainRead` becomes a lookup; `domainLine` two-slot; `domainContext` tiered |
| `public/app.js` | lagna-lord line in `renderCosmicId`; career card arrives free via `Object.keys(DOMAINS)` at `:1194` |
| `public/styles.css` | one rule for the verdict emphasis |
| `server/synthesis.test.js` | **new** |

`server/synthesis.js` owns the structural half of the domain table (house,
second, varga, role); `public/domains.js` keeps the voice half. Split by
responsibility: structure server-side, copy client-side.

This also removes a live triplication — `SIGN_LORD` currently exists in
`server/yogas.js:11`, `server/vargas.js:7` (as `SIGNS[].lord`) and
`public/domains.js:13` (as `SIGN_LORDS`). `dignity.js` becomes the server-side
source of truth; `public/domains.js` no longer needs its copy once `domainRead`
is a lookup.

## Backward compatibility

Saved conversations persist the **full chart JSON** server-side
(`server/store.js:427`) and rehydrate it wholesale at `public/app.js:2477`. Every
conversation saved before this ships would rehydrate a chart with no `synthesis`
key and break `renderSituationCards`.

Handled at both ends:

- **Server** — when a stored conversation's chart lacks `synthesis`, compute it
  on read. It is a pure function of data the stored chart already holds
  (planets, ascendant, navamsa, divisionals, dasha).
- **Client** — `domainRead` degrades to the current D1-only line if `synthesis`
  is still absent, so a stale payload cannot break the profile.

## Tests

`server/synthesis.test.js`, `node --test`, following the style of
`server/transits.test.js`.

1. **Grading bands** — exalted-in-kendra → `strong`; debilitated-in-dusthana →
   `weak`; both sides of each band boundary.
2. **The asymmetry** — weak D1 + strong varga → `grows into it`, never `holds`.
   The classical rule most likely to regress silently into "strong varga = good".
3. **Combustion is D1-only** — never contributes to a varga grade.
4. **Vargottama is varga-only** — never contributes to a D1 grade.
5. **Suppression** — a chart where divergence, a loud house and a dasha touch are
   all true: the line contains the divergence clause and **does not** contain the
   era clause. The practitioner's complaint, encoded as a regression test.
6. **Key parity** — `DOMAIN_SPEC` keys === `DOMAINS` keys. The client file is
   requirable thanks to the `module.exports` guard at `public/domains.js:180`.
7. **Refactor safety** — yoga detection output is unchanged for a fixed chart
   after the tables move out of `server/yogas.js`.
8. **Backfill** — a chart object with `synthesis` deleted round-trips to an
   identical `synthesis` on read.

## Sourcing

The repository has been burned by inherited tables before, so every table added
here is written from a named source and cited in-file rather than copied from
another implementation.

- **Exaltation, debilitation, own signs** — reused as-is from
  `server/yogas.js:15-22`. Sign-level only. No exact exaltation degrees and no
  moolatrikona degree ranges: those vary by source and would open a sourcing
  problem for marginal gain.
- **Naisargika maitri (natural friendship)** — the only genuinely new table.
  Written from Parashara (BPHS) and cited in `dignity.js`. Rahu and Ketu are
  absent from it and do not need to be: a domain lord and the lagna lord are
  always sign lords, hence always one of the seven.
- **Combustion orbs** — Moon 12°, Mars 17°, Mercury 14°, Jupiter 11°, Venus 10°,
  Saturn 15°. Cited in-file. The common retrograde variants (Mercury 12°, Venus
  8°) are **not** applied; the simple set is used and the variance is documented,
  consistent with the sign-level decision above.

## Out of scope

- **Feed order.** `public/app.js:1259` renders transit-Moon first, dasha second,
  and the structural situation cards fifth — the loudest remaining instance of
  the inversion. Explicitly deferred. It is roughly a six-line change once the
  synthesis exists, and is worth revisiting after this lands.
- **The other feed cards** — today, era, green flags, heads up — keep their
  current logic.
- **Shadbala.** Not computed; see the heuristic note above.
