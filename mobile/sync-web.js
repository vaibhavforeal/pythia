// Copies the web frontend into mobile/www for Capacitor to bundle.
//
// Two things this has to get right:
//
//   1. Entry point. Capacitor loads www/index.html, but in public/ that's the
//      marketing landing page. Someone who downloaded the app has already been
//      marketed to — the app must open on the app. So app.html becomes
//      index.html in the bundle.
//
//   2. API base. Bundled assets are served from capacitor://localhost, so the
//      frontend needs to know where the real API is. Injected here as a config
//      script rather than hard-coded, so a staging build is one env var:
//        PYTHIA_API_BASE=https://staging.pythia.cyou npm run sync
//
// Run via `npm run sync` (which then calls `cap sync`).

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "public");
const OUT = path.join(__dirname, "www");
const API_BASE = process.env.PYTHIA_API_BASE || "https://pythia.cyou";

// Server-rendered marketing pages have no place in an installed app; they'd
// just be dead weight the store has to review.
const SKIP = new Set(["index.html"]);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

// api.js carries a cache-busting query string that changes whenever the
// frontend ships (?v9 at the time of writing). Anchoring on the literal tag
// meant every bump silently broke the mobile build — silently because nobody
// runs this script until the day they are trying to ship. Match the src and
// ignore the query.
const API_TAG = /([ \t]*)<script src="api\.js[^"]*"><\/script>/;

/**
 * Put the real API origin in front of api.js, so the bundled app calls the
 * server instead of its own webview.
 *
 * Pure string in, string out, so the anchor can be tested without a build.
 */
function injectApiBase(html, apiBase) {
  const m = html.match(API_TAG);
  if (!m) {
    throw new Error(
      "Couldn't find the api.js <script> tag in app.html — the API base has " +
      "nowhere to go, and every request in the bundled app would resolve " +
      "against the webview."
    );
  }
  // A second pass must not stack a second global.
  if (html.includes("PYTHIA_API_BASE")) return html;

  const [tag, indent] = [m[0], m[1]];
  return html.replace(
    tag,
    `${indent}<script>window.PYTHIA_API_BASE = ${JSON.stringify(apiBase)};</script>\n${tag}`
  );
}

function main() {
if (!fs.existsSync(SRC)) {
  console.error(`✗ No public/ directory at ${SRC}`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(SRC, OUT);

// app.html is the real entry point.
const appHtml = path.join(OUT, "app.html");
if (!fs.existsSync(appHtml)) {
  console.error("✗ public/app.html is missing — nothing to use as the app entry point.");
  process.exit(1);
}
let html = fs.readFileSync(appHtml, "utf8");

// Tell the frontend where the API lives, before api.js reads it.
html = injectApiBase(html, API_BASE);

fs.writeFileSync(path.join(OUT, "index.html"), html);
fs.rmSync(appHtml);

const count = (function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .reduce((n, e) => n + (e.isDirectory() ? walk(path.join(dir, e.name)) : 1), 0);
})(OUT);

console.log(`✓ Synced ${count} files into mobile/www`);
console.log(`  entry point : app.html → index.html`);
console.log(`  API base    : ${API_BASE}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

module.exports = { injectApiBase };
