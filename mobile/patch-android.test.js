// The Android manifest patch.
//
// These assertions exist because the failure they guard against is invisible:
// a manifest missing MODIFY_AUDIO_SETTINGS still builds, still installs, still
// shows the caller a microphone prompt — and denies them the moment they tap
// Allow, with nothing in any log. The only place that can be caught is here.
const test = require("node:test");
const assert = require("node:assert");
const { patchManifest } = require("./patch-android");

// The Capacitor 6 template, trimmed to the part this touches.
const TEMPLATE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
  '    <application android:label="Pythia"></application>',
  '',
  '    <!-- Permissions -->',
  '    <uses-permission android:name="android.permission.INTERNET" />',
  '</manifest>',
  ''
].join("\n");

const has = (xml, name) =>
  new RegExp(`<uses-permission android:name="${name.replace(/\./g, "\\.")}" />`).test(xml);

test("both microphone permissions are added, not just RECORD_AUDIO", () => {
  const { xml, added } = patchManifest(TEMPLATE);
  assert.ok(has(xml, "android.permission.RECORD_AUDIO"));
  assert.ok(
    has(xml, "android.permission.MODIFY_AUDIO_SETTINGS"),
    "Capacitor requests this alongside RECORD_AUDIO and denies the call if it is missing"
  );
  assert.strictEqual(added.length, 2);
});

test("the existing INTERNET permission survives", () => {
  const { xml } = patchManifest(TEMPLATE);
  assert.ok(has(xml, "android.permission.INTERNET"));
  assert.ok(xml.includes("</manifest>"));
});

test("running twice changes nothing", () => {
  const once = patchManifest(TEMPLATE).xml;
  const twice = patchManifest(once);
  assert.strictEqual(twice.xml, once, "the patch must be idempotent — sync runs on every build");
  assert.deepStrictEqual(twice.added, []);
});

test("a manifest already holding one permission gains only the other", () => {
  const partial = TEMPLATE.replace(
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.INTERNET" />\n' +
    '    <uses-permission android:name="android.permission.RECORD_AUDIO" />'
  );
  const { added } = patchManifest(partial);
  assert.deepStrictEqual(added, ["android.permission.MODIFY_AUDIO_SETTINGS"]);
});

test("a manifest without the anchor throws rather than guessing", () => {
  // If the Capacitor template stops shipping INTERNET, inserting the
  // microphone permissions "somewhere near the end" produces a file that
  // parses and may well not work. Fail the build instead.
  const noAnchor = TEMPLATE.replace(
    '    <uses-permission android:name="android.permission.INTERNET" />',
    ''
  );
  assert.throws(() => patchManifest(noAnchor), /template has changed/i);
});

test("a commented-out permission does not count as declared", () => {
  const commented = TEMPLATE.replace(
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.INTERNET" />\n' +
    '    <!-- <uses-permission android:name="android.permission.RECORD_AUDIO" /> -->'
  );
  const { added } = patchManifest(commented);
  assert.ok(
    added.includes("android.permission.RECORD_AUDIO"),
    "a commented line grants nothing, so it must not suppress the real one"
  );
});

test("CRLF manifests stay CRLF", () => {
  // Android Studio on Windows writes CRLF; mixing line endings makes the diff
  // unreadable and hides what actually changed.
  const { xml } = patchManifest(TEMPLATE.replace(/\n/g, "\r\n"));
  assert.ok(!/[^\r]\n/.test(xml), "introduced a bare LF into a CRLF file");
});
