// Canvas share images (9:16 story format).
//
// Shared by the app (app.js) and the public invite page (invite.js) — the
// invite page has no app shell, so anything here must stay free of app state:
// callers pass in the data and the button to show busy state on.
//
// Two symbols come from the caller's page rather than from here: SHIP (the
// verdict copy per compatibility band) and fmtScore. Both app.js and invite.js
// define them before loading this file.

// ---- Shareable "Cosmic ID" story image (9:16) -----------------------------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// The logo mark is dark navy line-art; recolor it to white so it glows on the
// dark story gradient. Returns an offscreen canvas.
async function loadWhiteLogo() {
  // Absolute: this also renders from /i/<token>, where a relative "logo.png"
  // would resolve to /i/logo.png and silently drop the mark from the image.
  const img = await loadImage("/logo.png");
  const oc = document.createElement("canvas");
  oc.width = img.naturalWidth || 256;
  oc.height = img.naturalHeight || 256;
  const octx = oc.getContext("2d");
  octx.drawImage(img, 0, 0);
  octx.globalCompositeOperation = "source-in";
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, oc.width, oc.height);
  return oc;
}

function drawStars(ctx, W, H, n) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = Math.random() * 0.5 + 0.2;
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 1.8 + 0.6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

async function ensureStoryFonts() {
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load("600 90px Lora"),
        document.fonts.load("italic 500 46px Lora"),
        document.fonts.load("600 30px Raleway"),
        document.fonts.load("400 34px Raleway")
      ]);
      await document.fonts.ready;
    }
  } catch (_) { /* fall back to system fonts */ }
}

function centerWrap(ctx, text, cx, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  const lines = [];
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((ln, i) => ctx.fillText(ln, cx, y + i * lineHeight));
}

const ls = (ctx, v) => { if ("letterSpacing" in ctx) ctx.letterSpacing = v; };

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

// Shared 9:16 story scaffold: gradient + starfield + white logo, "Pythia"
// wordmark, a section label and the footer. Callers draw the middle content.
async function storyScaffold(ctx, W, H, sectionLabel) {
  const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, "#0b2a4a");
  g.addColorStop(0.55, "#0a3d68");
  g.addColorStop(1, "#2f5aa8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  drawStars(ctx, W, H, 90);

  await ensureStoryFonts();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  try {
    const logo = await loadWhiteLogo();
    const size = 290;
    ctx.save();
    ctx.shadowColor = "rgba(150,190,255,0.5)";
    ctx.shadowBlur = 40;
    ctx.drawImage(logo, W / 2 - size / 2, 175, size, size);
    ctx.restore();
  } catch (_) { /* logo optional */ }

  ctx.fillStyle = "#ffffff";
  ctx.font = "600 76px Lora, Georgia, serif";
  ctx.fillText("Pythia", W / 2, 585);

  ctx.fillStyle = "rgba(198,222,255,0.72)";
  ctx.font = "600 30px Raleway, sans-serif";
  ls(ctx, "4px");
  ctx.fillText(sectionLabel, W / 2, 650);
  ls(ctx, "0px");

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "500 30px Raleway, sans-serif";
  ls(ctx, "2px");
  ctx.fillText("cast yours at pythia.cyou", W / 2, 1840);
  ls(ctx, "0px");
}

// roundRect is recent (Chrome 99 / Safari 16) — fall back to a square bar
// rather than throwing on older browsers.
function barPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// One labelled stat row: NAME on the left, value on the right, bar beneath.
function drawStatBar(ctx, stat, x, y, w, accent) {
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(198,222,255,0.85)";
  ctx.font = "600 30px Raleway, sans-serif";
  ls(ctx, "4px");
  ctx.fillText(stat.label, x, y);
  ls(ctx, "0px");

  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 42px Lora, Georgia, serif";
  ctx.fillText(String(stat.value), x + w, y + 6);

  const by = y + 28, bh = 20, r = bh / 2;
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  barPath(ctx, x, by, w, bh, r);
  ctx.fill();

  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 24;
  ctx.fillStyle = accent;
  barPath(ctx, x, by, Math.max(bh, Math.round((w * stat.value) / 100)), bh, r);
  ctx.fill();
  ctx.restore();
}

async function buildStoryImage(data) {
  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  await storyScaffold(ctx, W, H, "✦  YOUR COSMIC ID  ✦");

  const accent = (data.element && data.element.color) || "#7dd3fc";

  // Big three, compact — the stat bars carry the card now.
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 60px Lora, Georgia, serif";
  ctx.fillText(`☾ ${data.moon.sign || "—"}    ★ ${data.star || "—"}`, W / 2, 800);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "500 44px Lora, Georgia, serif";
  ctx.fillText(`↑ ${data.asc.sign || "—"} rising`, W / 2, 864);

  // Archetype chip, named after whichever stat came out on top.
  ctx.fillStyle = accent;
  ctx.font = "600 34px Raleway, sans-serif";
  ls(ctx, "6px");
  ctx.fillText(String(data.archetype).toUpperCase(), W / 2, 958);
  ls(ctx, "0px");

  let y = 1064;
  for (const s of data.stats) {
    drawStatBar(ctx, s, 150, y, 780, accent);
    y += 118;
  }

  ctx.textAlign = "center"; // drawStatBar leaves it right-aligned
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "italic 500 44px Lora, Georgia, serif";
  centerWrap(ctx, "“" + data.vibe + "”", W / 2, 1650, W - 200, 58);

  return canvasBlob(canvas);
}

async function buildMatchStoryImage(d) {
  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  await storyScaffold(ctx, W, H, "✦  COMPATIBILITY  ✦");

  const ship = SHIP[d.verdict.band] || SHIP.average;
  const pct = Math.round((d.total / d.max) * 100);

  ctx.fillStyle = "#ffffff";
  ctx.font = "112px 'Segoe UI Symbol', Georgia, 'Segoe UI Emoji', serif";
  ctx.fillText(ship.emoji, W / 2, 900);

  ctx.fillStyle = "#ffffff";
  ctx.font = "600 150px Lora, Georgia, serif";
  ctx.fillText(fmtScore(d.total) + " / " + d.max, W / 2, 1080);

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "italic 600 58px Lora, Georgia, serif";
  ctx.fillText(ship.head, W / 2, 1175);

  ctx.fillStyle = "rgba(198,222,255,0.78)";
  ctx.font = "500 32px Raleway, sans-serif";
  ctx.fillText(d.verdict.label + "  ·  " + pct + "% matched", W / 2, 1240);

  ctx.fillStyle = "#ffffff";
  ctx.font = "600 46px Lora, Georgia, serif";
  ctx.fillText(d.boy.nakshatra + "   ✕   " + d.girl.nakshatra, W / 2, 1420);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "400 32px Raleway, sans-serif";
  ctx.fillText(d.boy.sign + "  ·  " + d.girl.sign, W / 2, 1470);

  return canvasBlob(canvas);
}

// Web Share (with files) where supported, else download the PNG.
async function shareOrDownload(blob, filename, title, text) {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title, text, url: "https://pythia.cyou" });
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

// Runs an image-builder with button busy-state + graceful cancel/error handling.
async function runShare(btn, busyLabel, build) {
  const orig = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = busyLabel; }
  try {
    await build();
  } catch (e) {
    if (!e || e.name !== "AbortError") console.error("Share failed:", e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}
