# Voice agent — design, and what the build changed about it

Astrotalk's product is chat with a human astrologer. Pythia already had the
harder half: a Claude-backed practitioner prompt grounded in a real Swiss
Ephemeris chart, with a tuned register and a genuine safety protocol. What it
lacked was a voice — someone who already knows your chart, answers in real time,
can be interrupted, and cannot say anything the chart doesn't support.

Chat is unchanged. Voice is another way into the same brain, and a call lands in
the same conversation history so it can be continued by typing.

## Architecture

Azure Voice Live in BYOM mode runs a Foundry-deployed Claude as the LLM inside a
managed realtime loop, on the same resource and key chat already uses. Azure
does speech recognition, semantic turn detection, echo cancellation, neural TTS
and barge-in; Claude does the astrology.

```
browser  public/voice.js ──── audio (Opus/RTP, direct) ─────────────────┐
              │ POST /api/voice/session {sdp}                           ▼
Pythia   server/voice.js ── control WebSocket (holds the key) ──►  Azure Voice Live
         loads the chart, writes the instructions                       │
                                                                        ▼
                                                          Claude (Anthropic Messages)
```

Media never crosses our server. Signalling is a plain POST, so the routes sit
under the existing `/api` gate and inherit `requireAuth`, `checkOrigin` and
`appCors` with no new auth code.

```
wss://<resource>.services.ai.azure.com/voice-live/realtime/calls
  ?api-version=2026-01-01-preview
  &profile=byom-foundry-anthropic-messages
  &model=<deployment>
```

## The guardrail

Three parts, all load-bearing.

**The chart is loaded server-side.** `/api/chat` trusts a chart the browser
POSTs — harmless there, because it only feeds a prompt the server also controls.
In voice the instructions *are* the safety boundary, so `preflight()` loads the
chart from the store for `req.userId` and refuses the call outright if there
isn't one. An ungrounded session must be impossible to construct, not merely
discouraged.

**The client cannot rewrite the instructions.** Verified, not assumed: the spike
pushed a hostile `session.update` down the WebRTC data channel mid-call. The
next reply still refused the off-topic question and still carried the
shibboleth. Nothing changed.

**The model must ask for numbers it doesn't hold.** `chartToSpokenText` withholds
every exact figure a model is prone to half-remembering — divisionals beyond
D1/D9, ashtakavarga bindus, the full transit list, exact dasha dates. They are
reachable only through `lookup_chart_detail`, so the options are "ask" or "say I
don't know", never "guess". Proven end to end: a value present nowhere in the
instructions was spoken back to the caller.

## The care protocol conflict

`SPOKEN_NOTE` says two or three sentences, one idea per turn, then stop — most
of what makes an agent feel like a person. `CARE_NOTE` requires the opposite on
a disclosure of self-harm or abuse: stop the astrology entirely, ask who they
could tell, name two helplines.

Voice Live takes one flat instruction string — no content-block array, no
`cache_control`, no way to weight a section — so ordering is the only lever, and
ordering alone cannot resolve a contradiction. The exemption is stated inside
the care block: the brevity rules do not apply here, take as long as this needs.

Speech also breaks a phone number in ways text does not. "1860 266 2345, and on
WhatsApp" is fine to read and useless to hear at conversational speed, so it is
read digit by digit with an offer to repeat. And because barge-in can truncate a
number halfway while the model believes it delivered it, an interrupted number
restarts from the beginning — half a helpline is worse than none, because they
will think they have it. `turn_detection.auto_truncate` is set for the same
reason.

The addendum is appended rather than edited in, so chat's `CARE_NOTE` stays
byte-identical. A test asserts that, and asserts the ordering.

## Cost

No prompt caching exists in a realtime session, so the whole instruction string
is re-sent on every turn. That, not audio, is the bill.

```
chat blocks + full chartToText   29,465 B  ~7,366 tok  (~147k per 20-turn call)
spoken blocks + spoken chart      23,632 B  ~5,908 tok  (~118k per 20-turn call)
```

`chartToSpokenText` runs 4,260 B against `chartToText`'s 8,665. `loadSkill` can
drop named sections rather than there being a forked markdown file that would
drift within a couple of edits; dropped for voice are Computation Guidelines
(tells the model to approximate the lagna and suggest verifying in Astrosage —
wrong when the server injects authoritative ephemeris output, and mid-call it
sounds like being handed off), the Kundli-paste section, Tone and Communication
(contradicts `REGISTER_NOTE`), and Gathering Information.

Numerology stays despite being 2.3 KB. Chat answers "what's my life path
number"; making voice worse at it is a product decision, not an optimisation.

A 26,000 B ceiling is enforced by test, because the failure is silent — pasting
the varga tables back in costs nothing visible until the invoice.

## Limits, layered by how they fail

`persistentRateLimiter` fails open by design: right for chat, which is about to
hit the same store anyway, and dangerous for something billed by the minute.

| Limit | Mechanism | Fails |
|---|---|---|
| `VOICE_MINUTES_PER_DAY` 10 | persistent | open |
| `VOICE_STARTS_PER_HOUR` 6 | in-memory | open, bounded |
| `VOICE_MAX_CONCURRENT` 2 | a Map | **closed** |
| `VOICE_MAX_SESSION_SEC` 600 | setTimeout | **closed** |
| `VOICE_IDLE_SEC` 45 | setTimeout | **closed** |

A store outage therefore leaks at most `MAX_CONCURRENT × MAX_SESSION_SEC`.

Every refusal runs before the meter. The first version charged a paid minute to
answer 400 for a missing SDP; the symptom was indirect — the budget quietly
drained and a *later* test began failing with 429s.

## What the spike overturned

The plan was wrong about four things, and each would have cost real work.

**Transcripts are not browser-only.** The plan budgeted a `/transcript` relay
route and treated call transcripts as client-supplied data. They arrive on the
server's control socket. The route was deleted and persistence became more
trustworthy, not less.

**Sonnet is the slowest of the three.** The plan named it as the upgrade from
Opus. Measured time from end-of-speech to first audio:

```
haiku-4-5     1779, 1425 ms            mean 1602 ms
opus-4-8      1.7-2.5 s                mean ~2100 ms
sonnet-4-6    2563, 2843, 2223, 3021   mean 2663 ms
```

Sonnet writes longer replies — 251–358 output audio tokens against Opus's
116–214 — and more words means more to generate before the first sentence can be
synthesised. `VOICE_DEPLOYMENT` is haiku-4-5. Chat keeps Opus: a written reading
is not a conversation.

**Only one api-version accepts the WebRTC endpoint.** BYOM is documented against
`2026-04-10` and WebRTC against `2026-01-01-preview`, and no Microsoft example
combines them. Probed 6 times each: rungs on `2026-06-01-preview` and
`2026-04-10` are 0/6, `2026-01-01-preview` is 6/6.

**Documented fields are not proven fields.** `turn_detection.interrupt_response`
and `input_audio_transcription` were added from the docs. They were the entire
diff between a config that answered and one that connected, said "listening",
and never spoke — with no error anywhere. Neither is needed: barge-in measured
841ms without the first, and transcripts arrived without the second. A test now
asserts the session carries only fields a spike has run.

## Verification

`node --test`, 344 passing. The load-bearing ones: instructions contain the
chart and both helpline numbers; the care addendum follows the brevity rules it
overrides; `chartToText` is byte-identical to before the change; `chartDetail`
never throws and never exceeds 600 spoken characters; every voice error body
leaks none of the key, the endpoint, the instructions or the chart.

Two things cannot be tested and must be walked through out loud before launch:
the care protocol on three escalating phrasings, and the cost of a real
five-minute call read from Azure Cost Management — BYOM is not in the published
Voice Live tier table, so there is no other way to learn the rate.

## Still open

- `VOICE_DEBUG=false` before real users: it logs what callers say.
- Render Starter, not free. A ~50s cold start fails the first call of a quiet
  period at the SDP exchange. WebRTC keeps audio off the server, so Starter is
  enough — free is not.
- `VOICE_MINUTES_PER_DAY` is a guess until a real call is costed.
- The mic button is hidden in the Capacitor shell. No `android/` or `ios/`
  project is committed, so there is no `RECORD_AUDIO` permission and
  `getUserMedia` would fail after the overlay had opened.
- The two `en-IN` voices were chosen without hearing them. Azure's HD variants
  are a config string away and are the cheapest quality win available.
