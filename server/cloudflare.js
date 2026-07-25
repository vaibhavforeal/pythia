// Proving a request actually came through Cloudflare.
//
// CF-Connecting-IP is only meaningful if Cloudflare set it. Cloudflare
// overwrites any copy the caller sent, so through the proxy it's honest — but
// anything can send that header straight to the origin. Rather than trusting an
// env var someone has to remember to set, this checks the connection itself
// against Cloudflare's published ranges.
//
// WHICH address is checked matters, because a caller can put anything in
// X-Forwarded-For — including a Cloudflare address. Only two positions are not
// caller-controlled:
//
//   * req.socket.remoteAddress — the actual TCP peer, unforgeable.
//   * the RIGHTMOST X-Forwarded-For entry — appended by your own edge (Render's
//     router) recording who connected to it. A caller can prepend entries, but
//     never append past that one.
//
// Checking "any entry in the chain" would be a hole: send X-Forwarded-For:
// 104.16.0.1 directly to the origin and you'd look like Cloudflare.
//
// Ranges from https://www.cloudflare.com/ips-v4 and /ips-v6, fetched
// 2026-07-25. They change rarely; set CLOUDFLARE_IPS_REFRESH=true to pull the
// current lists at boot and fall back to these if the fetch fails.

const V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"
];

const V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"
];

// --- Address parsing ---------------------------------------------------------

/** Dotted-quad → BigInt, or null. */
function parseV4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n = 0n;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = (n << 8n) | BigInt(o);
  }
  return n;
}

/** IPv6 (including "::" compression and ::ffff:1.2.3.4) → BigInt, or null. */
function parseV6(s) {
  let str = s;
  // An embedded IPv4 tail: convert it to two hex groups.
  const v4tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(str);
  if (v4tail) {
    const v4 = parseV4(v4tail[1]);
    if (v4 === null) return null;
    const hi = (v4 >> 16n) & 0xffffn;
    const lo = v4 & 0xffffn;
    str = str.slice(0, v4tail.index) + hi.toString(16) + ":" + lo.toString(16);
  }

  const halves = str.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;

  let groups;
  if (tail === null) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill("0"), ...tail];
  }

  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** @returns {{n: bigint, bits: 32|128} | null} */
function parseIp(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/^\[|\]$/g, "");            // [::1]:443 style
  if (s.includes("%")) s = s.split("%")[0]; // zone index
  // Node reports IPv4 peers as ::ffff:1.2.3.4 — treat those as IPv4.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(s);
  if (mapped) s = mapped[1];
  if (s.includes(".") && !s.includes(":")) {
    const n = parseV4(s);
    return n === null ? null : { n, bits: 32 };
  }
  if (s.includes(":")) {
    const n = parseV6(s);
    return n === null ? null : { n, bits: 128 };
  }
  return null;
}

function parseCidr(cidr) {
  const [addr, lenStr] = String(cidr).split("/");
  const ip = parseIp(addr);
  const len = Number(lenStr);
  if (!ip || !Number.isInteger(len) || len < 0 || len > ip.bits) return null;
  const shift = BigInt(ip.bits - len);
  return { base: (ip.n >> shift) << shift, shift, bits: ip.bits };
}

let ranges = [...V4, ...V6].map(parseCidr).filter(Boolean);

/** Is this address inside one of Cloudflare's published ranges? */
function isCloudflareIp(raw) {
  const ip = parseIp(raw);
  if (!ip) return false;
  for (const r of ranges) {
    if (r.bits !== ip.bits) continue;
    if ((ip.n >> r.shift) << r.shift === r.base) return true;
  }
  return false;
}

/**
 * Did this request demonstrably traverse Cloudflare?
 * Only checks positions a caller cannot control (see the note above).
 */
function cameThroughCloudflare(req) {
  if (!req || !req.headers) return false;
  if (!req.headers["cf-connecting-ip"]) return false; // nothing to trust anyway

  const socketIp = req.socket && req.socket.remoteAddress;
  if (isCloudflareIp(socketIp)) return true;

  // Rightmost X-Forwarded-For entry: appended by our own edge, recording who
  // connected to it. A caller can prepend, never append past this.
  const xff = String(req.headers["x-forwarded-for"] || "");
  if (xff) {
    const parts = xff.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length && isCloudflareIp(parts[parts.length - 1])) return true;
  }
  return false;
}

/**
 * Refresh from Cloudflare at boot. Opt-in: a network call during startup is a
 * liability, and the bundled lists are correct until Cloudflare changes them.
 */
async function refresh() {
  const urls = ["https://www.cloudflare.com/ips-v4", "https://www.cloudflare.com/ips-v6"];
  const out = [];
  for (const url of urls) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    out.push(...(await res.text()).split("\n").map(s => s.trim()).filter(Boolean));
  }
  const parsed = out.map(parseCidr).filter(Boolean);
  if (parsed.length < 10) throw new Error(`suspiciously short list (${parsed.length})`);
  ranges = parsed;
  return out.length;
}

module.exports = {
  isCloudflareIp, cameThroughCloudflare, refresh,
  parseIp, parseCidr, V4, V6,
  get rangeCount() { return ranges.length; }
};
