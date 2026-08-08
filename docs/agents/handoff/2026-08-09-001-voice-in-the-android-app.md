# Voice in the Android app — and the three things standing behind it

The session began by picking up the previous handoff, whose next step was to
audition prosody. That never happened. Instead the Capacitor mic permission was
picked up as parallel work, and it turned out to be the thread that ran all the
way to a working call.

Voice now works in the Android app, proven on hardware, and is live in
production behind an allowlist. Prosody remains unauditioned — the research is
done and the shortlist is written, but nobody has listened yet.

## At a glance

**Goal.** Make Pythia's voice agent usable from the installed Android app, and
make it sound less like an announcer. The first half is done. The second half is
researched and untested.

**Current state.** `main` is deployed with voice live behind a one-user
allowlist. 366 tests pass, no known failures. The Android app builds, installs,
and places a real call. It cannot be signed into by a real user, because the
only login production accepts is Google and Google does not work in a webview.

**Blocked on a human ear.** The next step is auditioning voices, which needs
someone to listen to a one-minute call. Nothing else is blocked.

## What was accomplished

**Voice works in the app.** On a Galaxy A52s the permission prompt appears,
Allow works, and Pythia hears the caller and answers. This was the gate the
2026-08-08 design doc named before merging, and it is now cleared.

**`mobile/patch-android.js`** — new. Patches the generated, git-ignored Android
project on every `npm run sync`: adds the two microphone permissions, and
copies `google-services.json` into `android/app/`. 7 tests.

**`mobile/sync-web.js`** — the API-base injection was anchored to the literal
string `<script src="api.js">` and `app.html` now ships `api.js?v9`. The mobile
build had been failing at that line for some time. Nobody noticed because
nothing runs this script until someone is trying to ship. Now matches the src
and ignores the query, with 6 tests.

**The voice allowlist fails closed.** Empty admitted everyone; it now admits
nobody, and opening voice to everyone takes the sentinel `*`.

**Voice is live in production.** `voice-agent` merged to `main` (15 commits) and
deployed, plus 3 more. 366 tests pass.

**The handoff skill itself was rewritten** at `~/.claude/skills/handoff/SKILL.md`
— outside this repo, so it will not show in any diff here. It now requires goal,
current state, files changed, files in flight, failed attempts and next steps as
named sections, which is why this document has a shape earlier handoffs do not.

## Files changed

| File | |
|---|---|
| `mobile/patch-android.js` | new — manifest permissions + `google-services.json` copy |
| `mobile/patch-android.test.js` | new — 7 tests |
| `mobile/sync-web.test.js` | new — 6 tests |
| `mobile/sync-web.js` | anchor now tolerates the `?v9` query; injection extracted as a pure function |
| `mobile/package.json` | `sync` ends with `node patch-android.js` |
| `mobile/README.md` | a "The microphone" section, and the sync-order caveat |
| `public/voice.js` | native hide removed; `NotAllowedError` gets app-appropriate recovery text |
| `server/voice.js` | allowlist fails closed; `isAllowed` exported as a pure function |
| `server/voice.allowlist.test.js` | new — 6 tests |
| `server/voice.api.test.js` | spawned server now needs `VOICE_ALLOWLIST: "*"` |
| `render.yaml` | `VOICE_ENABLED: "true"` for the pilot, with the posture recorded |
| `tools/voice-spike.js` | `--list` audition shortlist |
| `docs/superpowers/specs/2026-08-08-...md` | new design doc |
| `docs/superpowers/specs/2026-08-07-...md` | "Still open" updated to proven |

## Failed attempts, so they aren't repeated

**`--style chat`** — the previous handoff's recommended audition. No such style
on any en-IN or hi-IN voice. Would have read as a bad-sounding voice.

**Gradle's `-all` distribution, then `-bin`, then a longer timeout.** All three
died with `SocketTimeoutException` mid-download from `services.gradle.org` on
this connection. What worked was fetching the zip once with
`curl --retry 8 --retry-all-errors -C -` and pointing `distributionUrl` at a
`file://` path. Raising `networkTimeout` alone does not help; the connection
drops rather than stalls.

**Assuming production ran the `voice-agent` branch.** Two Render env vars were
set on that assumption and did nothing — `server/voice.js` had never been
deployed at all, and `routes()` registers unconditionally, so the 404 could only
ever have meant missing code. Check `git ls-tree origin/main` before diagnosing
production behaviour against a feature branch.

**Probing `/api/voice/session` with a fake SDP.** `{"sdp":"v=0"}` gets past
preflight and reaches the Azure handshake, returning 502. Each attempt is a real
upstream connection and likely a charged minute against the daily budget. It
confirms the route is live and nothing more; only a browser can produce a real
offer. Don't loop on it.

**Suggesting email/password login before checking what production accepts.**
`GET /api/auth/providers` is public and answers this in one call —
`{"google":true,"phone":false,"emailSignup":false}`. Google was the only option.

**Documenting the allowlist hazard instead of fixing it.** Written first as a
`render.yaml` comment; a security review flagged it and was right. Recorded here
because the instinct to write the warning rather than close the hole is the
thing worth catching.

## Key decisions

**Patch the generated Android project rather than commit it.** `mobile/android/`
is build output and git-ignored, which the README already asserts. Committing it
would have bought two permission lines at the cost of inverting that posture and
dragging a large generated tree through review. A 20-line script keeps it
correct through every regeneration. Documenting the manual edit in the README
was rejected outright — it would be forgotten exactly once, on a machine that
isn't this one.

**`RECORD_AUDIO` alone is not enough, and this is the whole finding.** Capacitor's
`BridgeWebChromeClient.onPermissionRequest` requests `MODIFY_AUDIO_SETTINGS`
*and* `RECORD_AUDIO`, and grants only if every entry returns true.
`MODIFY_AUDIO_SETTINGS` is a normal permission — declared it is auto-granted,
undeclared it returns false. A manifest with only `RECORD_AUDIO` therefore shows
the caller a prompt, accepts their Allow, and denies them anyway, with nothing
in any log. Read from Capacitor's source, not its docs. The device dump is the
proof:

```
MODIFY_AUDIO_SETTINGS: granted=true      ← auto-granted, because declared
RECORD_AUDIO:          granted=false     ← awaiting the runtime prompt
```

**Fail closed on the allowlist, rather than documenting the hazard.** The first
attempt was a comment in `render.yaml` warning that an empty allowlist means
everyone and must be set before deploying. A background security review flagged
it, correctly: that is documentation where a control belongs. `VOICE_ENABLED`
lives in `render.yaml` and `VOICE_ALLOWLIST` in the Render dashboard, so a push
can outrun the allowlist, and fail-open that gap is voice live for every user.
It now matches `MAX_CONCURRENT` and `MAX_SESSION_SEC`, which already fail closed
for the same reason: this is billed by the minute, so being wrong costs an
invoice rather than a 500.

**Deploy to production behind the allowlist rather than test locally.** The
alternative was `adb reverse` to a local server, which touches no production —
but the app is served from `https://localhost`, so calling `http://` is mixed
content and would have needed cleartext enabled for the test build. The
allowlist is the mechanism that already exists for exactly this, and testing
against production also tests Render, real latency and real billing.

**Cost measurement was explicitly deprioritised by the user.** It remains the
top open item.

## What a fresh agent would otherwise rediscover

**Google sign-in does not work in the app, and it is the only login production
accepts.** `app.html` renders the button as `<a href="/api/auth/google">`, and an
anchor bypasses the `fetch` patch in `api.js`, so the webview resolves it
against its own bundle:

```
D/Capacitor: Handling local request: https://localhost/api/auth/google
```

Pointing the href at `PythiaAuth.apiBase` fixes the navigation and not the
problem — Google returns `disallowed_useragent` for OAuth in an embedded
webview. The real fix is a Custom Tab plus a deep-link return carrying the
bearer token. Until then **no real user can sign into the Android app.** Note
this does not block the PWA launch, which is the stated launch vehicle.

**A test account exists on production.** `mictest@pythia.cyou`, user id
`bd87be16-31a0-4eea-b9a1-b8135cc56df9`, created by briefly setting
`ALLOW_EMAIL_SIGNUP=true` and closing it again — verified closed. It is the
account in `VOICE_ALLOWLIST`. Delete it when it stops being useful.

**The app used to die three seconds after launch, every launch.**
`PushNotifications.register()` throws `IllegalStateException: Default FirebaseApp
is not initialized` when `google-services.json` is absent from `android/app/` —
`app/build.gradle` applies the google-services plugin only when that file is
present. It surfaces as a FATAL EXCEPTION on the CapacitorPlugins thread, so no
JS `try/catch` reaches it. `patch-android.js` now handles it; if it recurs, that
is why.

**Building on this machine needs three overrides that do not survive
`npx cap add android`,** because they live in git-ignored `android/`:

- `services.gradle.org` times out mid-download here. The distribution was
  fetched once with `curl --retry` and lives at
  `~/gradle-dist/gradle-8.2.1-bin.zip`; point `distributionUrl` at it with
  `file\:///C:/Users/vaibh/gradle-dist/gradle-8.2.1-bin.zip`.
- Default `java` is 1.8, which AGP 8.x refuses. Use Android Studio's bundled
  JBR: `JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`. It is Java 21,
  which Gradle 8.2.1 does not officially support, and it worked.
- First build ~6m30s. `aapt` for inspecting a built APK is under
  `~/AppData/Local/Android/Sdk/build-tools/37.0.0/`.

**Two of the five preconditions in `render.yaml` are unmet with voice live.** A
real call's cost has not been read from Azure Cost Management, so
`VOICE_MINUTES_PER_DAY` is still a guess; and the care protocol has not been
walked through out loud. The allowlist is the only thing making that safe. Do
not set it to `*` until both are done. The service is also still on Render's
free plan, which the same comment block warns against — a cold start fails the
first call of a quiet period at the SDP exchange.

## Prosody: researched, not auditioned

The previous handoff's recommended command could not have worked. It suggested
`--style chat`, and **there is no `chat` style on any en-IN or hi-IN voice** —
it belongs to `zh-CN`. `en-IN-NeerjaNeural` and `hi-IN-SwaraNeural` declare
exactly `cheerful`, `empathetic`, `newscast`. A style a voice does not declare
is not a soft fallback; the service can reject it, and a rejected session update
reads as "this voice sounds bad".

**Neural HD exists for en-IN** as six personas, including a `Neerja` — so the
upgrade is a like-for-like comparison of the same voice in a better model. HD
voices also document paralinguistic tags (`breathing`, `sighing`), which is the
only documented answer to "announcer prosody, never breathes" — previously
listed as unfixable by any prompt. **Hindi has no DragonHD at all**; its
expressive family is `MAI-Voice-2`.

`node tools/voice-spike.js --list` prints the shortlist. Two calls, in this
order, each changing one variable:

```
node tools/voice-spike.js --voice en-IN-Neerja:DragonHDLatestNeural
node tools/voice-spike.js --voice en-IN-NeerjaNeural --style empathetic --rate "-8%"
```

The first answers the question that decides the whole path: whether Voice Live's
`voice.type: "azure-standard"` accepts an HD name at all. If it connects and
never speaks, HD is dead and the prompt is the only remaining lever.

**ElevenLabs was evaluated and is not a drop-in.** v3 is the wrong model —
ElevenLabs' own Agents Platform recommends Flash, not v3, and gives v3 no
latency figure. Flash v2.5 is the realtime one at ~75ms, but its number
normalization is off by default to protect latency, which lands badly on a care
protocol that reads helplines digit by digit. The deeper problem is
architectural: Azure Voice Live provides STT, semantic multilingual turn
detection, echo cancellation and barge-in in one managed loop with media never
touching our server. TTS is the easy piece. Whether Voice Live accepts a
third-party TTS at all is unchecked, and that single fact decides whether this
is a config change or a rebuild.

## Next steps, in order

1. **Audition the two calls above.** One minute each. The first decides whether
   Neural HD is reachable through Voice Live at all, and everything about
   prosody follows from the answer.
2. **Read a real call's cost** from Azure Cost Management and set
   `VOICE_MINUTES_PER_DAY` from the number rather than the guess. Deprioritised
   by the user this session; still the top blocker on opening the allowlist.
3. **Walk the care protocol out loud** — three escalating phrasings. The second
   of the two unmet preconditions.
4. **Fix Google sign-in in the app** — Custom Tab plus deep-link return carrying
   the bearer token, plus the intent filter and `assetlinks.json`. Roughly half
   a day. Only matters if the native shell ships; the stated launch vehicle is
   the PWA.
5. **Check whether Voice Live accepts a third-party TTS**, if ElevenLabs is
   still of interest. That one fact decides config change versus rebuild.

Do not open `VOICE_ALLOWLIST` to `*` until 2 and 3 are done.

## Branch and tree state

- `main` = `bafb311`, pushed and deployed. Voice is live there behind the
  allowlist.
- `voice-prosody` = `cf11810`, **two commits ahead of `main`, unpushed** — the
  audition shortlist and this handoff. Currently checked out. Neither is server
  code, so nothing on this branch needs deploying.
- Untracked and deliberately left alone: `mobile/package-lock.json` (new, from
  `npm install` in `mobile/`; probably should be committed) and a 563 KB session
  transcript `.txt` in the repo root.
- 366 tests pass. No known failures.
