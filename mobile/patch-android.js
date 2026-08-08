// Adds the microphone permissions to the generated Android manifest.
//
// mobile/android/ is build output — created by `npx cap add android` and
// git-ignored, exactly like mobile/www. So a permission added there by hand
// survives until the next person regenerates the project, and then silently
// doesn't. This script is to the manifest what sync-web.js is to the web
// assets: post-process the generated thing, from a place that IS committed.
//
// Why two permissions and not just RECORD_AUDIO — Capacitor turns a WebView
// getUserMedia call into an Android runtime prompt in
// BridgeWebChromeClient.onPermissionRequest, and for audio capture it requests
// BOTH of these, then treats the result as granted only if every entry came
// back true. MODIFY_AUDIO_SETTINGS is a normal permission: declared, it is
// granted at install with no prompt; undeclared, it comes back false. So a
// manifest carrying RECORD_AUDIO alone gives the caller a prompt, accepts
// their Allow, and denies them anyway — with nothing in any log to explain it.
//
// Run via `npm run sync`.

const fs = require("fs");
const path = require("path");

// The Capacitor template ships exactly one permission and it is the last
// markup before </manifest>. Anchoring to it rather than to the closing tag
// keeps our additions in the block where a human would look for them.
const ANCHOR = "android.permission.INTERNET";

const REQUIRED = [
  ["android.permission.RECORD_AUDIO", "Voice calls. Requested on tap, not at launch."],
  ["android.permission.MODIFY_AUDIO_SETTINGS", "Requested alongside RECORD_AUDIO by Capacitor's WebView bridge."]
];

// A commented-out permission grants nothing, so it must not read as declared —
// otherwise the one case where someone disabled the mic to test something
// becomes the case where the patch quietly declines to put it back.
const uncomment = s => s.replace(/<!--[\s\S]*?-->/g, "");

const declared = (xml, name) =>
  new RegExp(`<uses-permission[^>]*android:name="${name.replace(/\./g, "\\.")}"`)
    .test(uncomment(xml));

/**
 * Add any missing permission to the manifest text.
 *
 * Pure string in, string out, so the interesting cases are testable without an
 * Android project on disk. Throws when the anchor is absent — that means the
 * Capacitor template changed, and guessing at an insertion point is how you
 * end up with a manifest that parses and doesn't work.
 *
 * @returns {{ xml: string, added: string[] }}
 */
function patchManifest(xml) {
  const anchorLine = xml.split(/\r?\n/).find(l => {
    const live = uncomment(l);
    return live.includes(ANCHOR) && live.includes("<uses-permission");
  });
  if (!anchorLine) {
    throw new Error(
      `No <uses-permission> line for ${ANCHOR} in the manifest. The Capacitor ` +
      `template has changed; update mobile/patch-android.js rather than ` +
      `inserting the microphone permissions somewhere plausible.`
    );
  }

  const added = REQUIRED.filter(([name]) => !declared(xml, name));
  if (!added.length) return { xml, added: [] };

  // Match the file's own conventions, so the diff a human reads in Android
  // Studio looks like the rest of the manifest.
  const eol = xml.includes("\r\n") ? "\r\n" : "\n";
  const indent = (anchorLine.match(/^\s*/) || [""])[0];

  const lines = added.map(([name, why]) =>
    `${indent}<!-- ${why} -->${eol}${indent}<uses-permission android:name="${name}" />`
  );

  return {
    xml: xml.replace(anchorLine, [anchorLine, ...lines].join(eol)),
    added: added.map(([name]) => name)
  };
}

const ANDROID_DIR = path.join(__dirname, "android");
const MANIFEST = path.join(ANDROID_DIR, "app", "src", "main", "AndroidManifest.xml");

function main() {
  // Legitimate: `npm run sync` is run before the native project exists, and on
  // machines that only ever build the website. Not an error, but say so —
  // silence here reads as "the permissions are handled".
  if (!fs.existsSync(ANDROID_DIR)) {
    console.log("• No mobile/android yet — skipping the manifest patch.");
    console.log("  Run `npx cap add android`, then `npm run sync` again.");
    return;
  }

  if (!fs.existsSync(MANIFEST)) {
    console.error(`✗ mobile/android exists but ${path.relative(__dirname, MANIFEST)} does not.`);
    console.error("  The native project looks half-generated. Delete mobile/android and re-add it.");
    process.exit(1);
  }

  const before = fs.readFileSync(MANIFEST, "utf8");
  const { xml, added } = patchManifest(before);

  if (!added.length) {
    console.log("✓ Microphone permissions already declared.");
    return;
  }

  fs.writeFileSync(MANIFEST, xml);
  console.log(`✓ Added to AndroidManifest.xml: ${added.join(", ")}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

module.exports = { patchManifest, REQUIRED, ANCHOR };
