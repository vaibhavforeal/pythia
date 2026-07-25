// Cloudflare origin verification. The point of these tests is the attack cases:
// a caller who wants their CF-Connecting-IP believed can put anything in
// X-Forwarded-For, including a genuine Cloudflare address.
const test = require("node:test");
const assert = require("node:assert");
const cf = require("./cloudflare");

// A real Cloudflare edge address (inside 104.16.0.0/13) and a real non-CF one.
const CF_IP = "104.16.5.7";
const CF_IP6 = "2606:4700:4700::1111";
const NOT_CF = "203.0.113.42";

test("published ranges are recognised, and nothing else is", () => {
  for (const ip of [CF_IP, "173.245.48.1", "131.0.72.3", "162.158.0.1", "172.64.0.1", CF_IP6, "2400:cb00::1"]) {
    assert.strictEqual(cf.isCloudflareIp(ip), true, `${ip} should be Cloudflare`);
  }
  for (const ip of ["8.8.8.8", NOT_CF, "127.0.0.1", "10.0.0.1", "192.168.1.1", "2001:4860:4860::8888"]) {
    assert.strictEqual(cf.isCloudflareIp(ip), false, `${ip} should not be Cloudflare`);
  }
});

test("addresses just outside a range are not matched", () => {
  // 131.0.72.0/22 covers .72.0-.75.255
  assert.strictEqual(cf.isCloudflareIp("131.0.75.255"), true);
  assert.strictEqual(cf.isCloudflareIp("131.0.76.0"), false, "off-by-one at the boundary");
  // 104.16.0.0/13 covers 104.16-104.23
  assert.strictEqual(cf.isCloudflareIp("104.23.255.255"), true);
  assert.strictEqual(cf.isCloudflareIp("104.32.0.0"), false);
});

test("odd but legitimate address forms still parse", () => {
  assert.strictEqual(cf.isCloudflareIp("::ffff:104.16.5.7"), true, "IPv4-mapped IPv6, as Node reports peers");
  assert.strictEqual(cf.isCloudflareIp("[2606:4700::1]"), true, "bracketed");
  assert.strictEqual(cf.isCloudflareIp("2606:4700::1%eth0"), true, "zone index");
  assert.strictEqual(cf.isCloudflareIp("  104.16.5.7  "), true, "surrounding whitespace");
});

test("malformed input is rejected rather than throwing", () => {
  for (const bad of ["", null, undefined, "not-an-ip", "999.999.999.999", "1.2.3", "::::", "12345", {}, []]) {
    assert.strictEqual(cf.isCloudflareIp(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

const reqWith = (headers, socketIp) => ({ headers, socket: { remoteAddress: socketIp } });

test("a genuine Cloudflare request is recognised", () => {
  // Socket peer is Cloudflare (no intermediate load balancer).
  assert.strictEqual(cf.cameThroughCloudflare(
    reqWith({ "cf-connecting-ip": "198.51.100.5" }, CF_IP)), true);

  // Behind Render: the rightmost X-Forwarded-For entry is the Cloudflare edge.
  assert.strictEqual(cf.cameThroughCloudflare(
    reqWith({ "cf-connecting-ip": "198.51.100.5", "x-forwarded-for": `198.51.100.5, ${CF_IP}` },
      "10.0.0.7")), true);
});

test("forging a Cloudflare address in X-Forwarded-For does not work", () => {
  // The attack: hit the origin directly claiming to be Cloudflare. Our own edge
  // appends the real peer, so the forged entry is never the rightmost one.
  assert.strictEqual(cf.cameThroughCloudflare(
    reqWith({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": `${CF_IP}, ${NOT_CF}` },
      "10.0.0.7")), false, "a prepended Cloudflare address must not confer trust");

  // Same attack with the forged address buried mid-chain.
  assert.strictEqual(cf.cameThroughCloudflare(
    reqWith({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": `8.8.8.8, ${CF_IP}, ${NOT_CF}` },
      "10.0.0.7")), false, "checking 'any entry' would be a hole");

  // No proxy at all: direct connection from a non-Cloudflare address.
  assert.strictEqual(cf.cameThroughCloudflare(
    reqWith({ "cf-connecting-ip": "1.2.3.4" }, NOT_CF)), false);
});

test("no CF-Connecting-IP means nothing to trust", () => {
  assert.strictEqual(cf.cameThroughCloudflare(reqWith({}, CF_IP)), false);
  assert.strictEqual(cf.cameThroughCloudflare(reqWith({ "x-forwarded-for": CF_IP }, CF_IP)), false);
});

test("degenerate requests don't throw", () => {
  assert.strictEqual(cf.cameThroughCloudflare(null), false);
  assert.strictEqual(cf.cameThroughCloudflare({}), false);
  assert.strictEqual(cf.cameThroughCloudflare({ headers: {} }), false);
  assert.strictEqual(cf.cameThroughCloudflare(
    { headers: { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": ",,, ," } }), false);
});

test("clientIp believes CF-Connecting-IP only on a verified request", () => {
  delete require.cache[require.resolve("./auth")];
  delete process.env.TRUST_CLOUDFLARE; // detection alone must carry this
  const auth = require("./auth");

  const genuine = {
    headers: { "cf-connecting-ip": "198.51.100.5", "x-forwarded-for": `198.51.100.5, ${CF_IP}` },
    ip: "10.0.0.7", socket: { remoteAddress: "10.0.0.7" }
  };
  assert.strictEqual(auth.clientIp(genuine), "198.51.100.5");

  const forged = {
    headers: { "cf-connecting-ip": "198.51.100.5", "x-forwarded-for": `${CF_IP}, ${NOT_CF}` },
    ip: NOT_CF, socket: { remoteAddress: NOT_CF }
  };
  assert.strictEqual(auth.clientIp(forged), NOT_CF, "must fall back, not believe the header");

  delete require.cache[require.resolve("./auth")];
});

test("the bundled range list looks sane", () => {
  assert.ok(cf.rangeCount >= 20, `only ${cf.rangeCount} ranges parsed`);
  assert.strictEqual(cf.V4.length + cf.V6.length, cf.rangeCount, "every bundled CIDR should parse");
});
