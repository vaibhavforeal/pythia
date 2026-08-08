// Where the bundled app thinks the API lives.
//
// This is worth a test because of how it fails: the injection is anchored to a
// <script> tag whose src carries a cache-busting query string, so bumping ?v9
// to ?v10 in app.html breaks the mobile build — and nobody finds out until the
// day they try to ship, because the website never runs this script.
const test = require("node:test");
const assert = require("node:assert");
const { injectApiBase } = require("./sync-web");

const page = tag => [
  "<!doctype html>",
  "<html><body>",
  `    ${tag}`,
  '    <script src="app.js"></script>',
  "</body></html>"
].join("\n");

test("the version query string on api.js does not break the anchor", () => {
  for (const tag of [
    '<script src="api.js"></script>',
    '<script src="api.js?v9"></script>',
    '<script src="api.js?v10"></script>',
    '<script src="api.js?v=123&x=1"></script>'
  ]) {
    const out = injectApiBase(page(tag), "https://pythia.cyou");
    assert.ok(out.includes('window.PYTHIA_API_BASE = "https://pythia.cyou"'), `missed: ${tag}`);
  }
});

test("the global is set before api.js runs, not after", () => {
  const out = injectApiBase(page('<script src="api.js?v9"></script>'), "https://pythia.cyou");
  assert.ok(
    out.indexOf("PYTHIA_API_BASE") < out.indexOf('src="api.js'),
    "api.js reads the global on load — set afterwards it would read undefined"
  );
});

test("the original tag survives", () => {
  const out = injectApiBase(page('<script src="api.js?v9"></script>'), "https://pythia.cyou");
  assert.ok(out.includes('<script src="api.js?v9"></script>'));
});

test("running twice does not stack a second global", () => {
  const once = injectApiBase(page('<script src="api.js?v9"></script>'), "https://pythia.cyou");
  assert.strictEqual(injectApiBase(once, "https://pythia.cyou"), once);
});

test("the base is JSON-encoded, not concatenated", () => {
  // PYTHIA_API_BASE is a developer-supplied env var, so this is about a
  // staging URL with an odd character breaking the page, not about attack.
  const base = 'https://x.test/"weird';
  const out = injectApiBase(page('<script src="api.js"></script>'), base);
  assert.ok(
    out.includes(`window.PYTHIA_API_BASE = ${JSON.stringify(base)};`),
    "the quote must be escaped, or the injected script is a syntax error"
  );
});

test("a missing api.js tag throws rather than shipping a broken bundle", () => {
  // Every request would resolve against capacitor://localhost and fail. Better
  // to stop the build than to hand someone an app that opens and does nothing.
  assert.throws(
    () => injectApiBase("<html><body>no scripts here</body></html>", "https://pythia.cyou"),
    /nowhere to go/
  );
});
