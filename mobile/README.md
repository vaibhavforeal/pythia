# Pythia — mobile shell

Capacitor wrapper that ships the existing frontend to the Play Store (and, from
the same source, the App Store).

It is deliberately a separate npm project. The server deploys from the repo
root, and Capacitor's toolchain has no business in a Render build.

## How the pieces fit

`public/` is the single source of truth for the UI. `sync-web.js` copies it into
`mobile/www` and makes two adjustments:

- **`app.html` becomes `index.html`.** Capacitor opens `www/index.html`, but in
  `public/` that's the marketing landing page. Someone who installed the app has
  already been marketed to, so the app opens on the app.
- **The API base is injected.** Bundled assets load from `capacitor://localhost`,
  so relative `/api/...` paths would resolve against the webview. `public/api.js`
  patches `fetch` to prefix the real origin and attach the bearer token; this
  script tells it which origin.

Auth differs from the website by necessity: the session cookie is third-party
inside the webview and gets dropped, so the app authenticates with a bearer
token instead. The server supports both — see `server/auth.js`.

## First-time setup

```bash
cd mobile
npm install
npx cap add android          # creates mobile/android (git-ignored)
npm run sync                 # copy public/ → www/, then cap sync
npm run android              # opens Android Studio
```

Requires Android Studio and a JDK. `npx cap add ios` needs macOS and Xcode.

## Every time the web app changes

```bash
npm run sync
```

Then rebuild in Android Studio, or:

```bash
npm run build:aab            # release bundle for the Play Store
```

Point at a different backend with:

```bash
PYTHIA_API_BASE=https://staging.pythia.cyou npm run sync
```

## Still to wire up

- **Push notifications.** `@capacitor/push-notifications` is installed but not
  used. Needs a Firebase project, `google-services.json` in `android/app/`, a
  device-token table server-side, and a send path. This is the daily-ritual
  retention engine, so it's the highest-value remaining piece.
- **Native share.** `@capacitor/share` is installed but the canvas PNGs still go
  through the Web Share API. That works in the webview; the plugin is more
  reliable, especially on Android.
- **Deep links.** `/i/<token>` invite links should open the app when installed.
  Needs an intent filter plus `assetlinks.json` on the domain.

## Play Console notes

- $25 one-time developer registration.
- **Data safety** form: the app collects birth date, time and place, plus phone
  numbers. Declare it accurately — the friend graph also means user-to-user
  contact, which affects the questionnaire.
- **Target audience:** the users are teenagers. Declaring 13+ brings extra
  obligations around ads and data collection, and a social feature set draws
  more scrutiny. Read this before building out store setup, not after.
- A pure webview wrapper can be rejected under the *minimum functionality*
  policy. Shipping the native integrations above (push, share, deep links) is
  what makes this an app rather than a bookmark.
