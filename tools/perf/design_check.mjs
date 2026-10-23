// Design check without a game server: web/ (or another folder with an index.html) with stub
// /events (two players, one walking, weather from fixtures/weather-sample.json), /discovered and
// /explored, headless.
//   node tools/perf/design_check.mjs [out dir for screenshots] [web dir]
// Per screen size (390x844, 768x1024, 1440x900, 1920x1080, 2560x1311), with the marker panel open:
//   - no sideways page scroll, every panel inside the screen, no two panels on top of each other;
//   - every visible text: WCAG contrast against what is behind it, its panels composited over the
//     darkest and the lightest map colour (worst case); 4.5:1, or 3:1 for large text (24 px, or
//     18.66 px bold). Text straight on the map counts only with a halo (text-shadow).
// At 1920 x 1080 with every category, fog, weather and the shroud on and the CPU throttled 4x:
// frame times while panning (3 s) and while zooming in and out (3 s). Every request needs ?key=x,
// as on the real server; a request without it fails the "no failed requests" check.
// Pass: no overflow or overlap, no text below its contrast, while panning at least 55 frames a
// second on average and p95 <= 25 ms (frames come in vsync steps of 16.7 ms, so the median jumps);
// after a pan that does not redraw the markers, hovering a marker still shows its own name; the
// players, clock and marker panels move by their titles (snap, kept after a reload, back on a
// double-click, in view in a smaller window, a click on a title button is no drag). Prints the numbers either way, so old and new pages can be compared.
// For finding what costs frames: PERF_ONLY=1 skips the four sizes, EXTRA_CSS="..." adds CSS.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
const web = process.argv[3] ? path.resolve(process.argv[3]) : path.join(here, "../..", "web");
const realWeb = path.join(here, "../..", "web");
const weather = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "weather-sample.json"), "utf8"));
const pois = JSON.parse(fs.readFileSync(path.join(realWeb, "pois.json"), "utf8"));
const keys = Object.values(pois.discoveryKeys);
const N = 512;
const bits = new Uint8Array(N * N / 8);
for (let row = 0; row < N; row++) for (let col = 0; col < N * 0.45; col++) { const i = row * N + col; bits[i >> 3] |= 1 << (i & 7); }
const explored = JSON.stringify({ version: 2, cells: N, cellMetres: 20, players: { "Aldra Vey": Buffer.from(bits).toString("base64") } });
const discovered = JSON.stringify({ version: 5, players: { "Aldra Vey": { online: true, at: 1792780000, keys: keys.slice(0, 60) },
  "Brom": { online: true, at: 1792780000, keys: keys.slice(60, 90) } } });
const t0 = Date.now();
const state = () => {
  const a = (Date.now() - t0) / 20000 * Math.PI * 2;
  return JSON.stringify({ time: { raw: 52e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
    players: [
      { entity: 3, name: "Aldra Vey", pos: [3900 + 400 * Math.cos(a), 140, 4300 + 400 * Math.sin(a)], rot: [0, Math.sin(a / 2), 0, Math.cos(a / 2)], ageMs: 10 },
      { entity: 4, name: "Brom", pos: [4400, 120, 3700], rot: [0, 0, 0, 1], ageMs: 10 }],
    weather, findsVersion: 0, basesVersion: 0, flameLevel: 3, discoveredVersion: 5, exploredVersion: 2 });
};
const types = { ".html": "text/html", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".gz": "application/gzip" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  // Like the DLL: every request needs the key, also the ones the page's CSS makes.
  if (u.searchParams.get("key") !== "x") { res.writeHead(403); res.end(); return; }
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  const stub = { "/state": state(), "/finds": '{"version":0,"ore":[],"chests":[]}', "/bases": '{"version":0,"bases":[]}',
    "/discovered": discovered, "/explored": explored }[u.pathname];
  if (stub) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(stub); return; }
  const rel = u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname).replace(/^\/+/, "");
  const file = fs.existsSync(path.join(web, rel)) ? path.join(web, rel) : path.join(realWeb, rel);
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(d); } });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = "http://127.0.0.1:" + server.address().port + "/?key=x";
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const chrome = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, chrome, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const results = [];
const check = (label, pass, detail) => { results.push(pass); console.log((pass ? "PASS " : "FAIL ") + label + " (" + detail + ")"); };
if (out) fs.mkdirSync(out, { recursive: true });

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.status() >= 400) errors.push("HTTP " + r.status() + " " + new URL(r.url()).pathname); });
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem("livemap.fog", "1"); localStorage.setItem("livemap.discBy", "Aldra Vey"); } catch {} });
  await page.goto(url);
  if (process.env.EXTRA_CSS) await page.addStyleTag({ content: process.env.EXTRA_CSS });
  await page.waitForFunction(() => window.livemap?.discovered?.exp() && window.livemap.weather.state()?.players?.length, null, { timeout: 30000 });
  const toggle = await page.$("#poiToggle");
  if (toggle && await toggle.isVisible()) await toggle.click();
  await page.evaluate(() => window.livemap.map.setView([4200, 4100], -2, { animate: false }));
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(1500);
  return { page, errors };
}

// Layout and contrast, measured in the page.
const measure = () => {
  const vw = innerWidth, vh = innerHeight;
  const parse = c => { const m = c.match(/[\d.]+/g); return m ? { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] } : null; };
  const over = (top, bot) => { const a = top.a; return { r: top.r * a + bot.r * (1 - a), g: top.g * a + bot.g * (1 - a), b: top.b * a + bot.b * (1 - a), a: 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const MAP_DARK = { r: 18, g: 14, b: 24, a: 1 }, MAP_LIGHT = { r: 207, g: 198, b: 180, a: 1 };
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw; };
  const low = [], halo = [];
  let texts = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".leaflet-tile-pane, .leaflet-marker-pane .leaflet-marker-icon svg, script, style, textarea, #calib, #calibToggle") || !visible(el)) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(" ");
    if (!own) continue;
    let p = el.parentElement, hidden = false;
    while (p) { if (!visible(p) && getComputedStyle(p).display !== "contents") { hidden = true; break; } p = p.parentElement; }
    if (hidden) continue;
    texts++;
    const s = getComputedStyle(el), fg = parse(s.color);
    const layers = [];
    let opaque = 0;
    for (let a = el; a; a = a.parentElement) { const bg = parse(getComputedStyle(a).backgroundColor); if (bg && bg.a > 0) { layers.push(bg); opaque = 1 - (1 - opaque) * (1 - bg.a); } }
    const size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700, need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (opaque < 0.5) { (s.textShadow !== "none" ? halo : low).push({ t: own.slice(0, 40), why: s.textShadow !== "none" ? "halo" : "on map, no panel" }); continue; }
    let worst = Infinity;
    for (const base of [MAP_DARK, MAP_LIGHT]) {
      let bg = base;
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
      worst = Math.min(worst, ratio(over(fg, bg), bg));
    }
    if (worst < need) low.push({ t: own.slice(0, 40), ratio: +worst.toFixed(2), need, size });
  }
  // Panels: the UI boxes over the map.
  const boxes = [...document.querySelectorAll("#left > *, #clock, #status, #tileNote, .leaflet-control-zoom, .leaflet-control-layers, .leaflet-control-attribution, [data-ui-box]")]
    .filter(visible).map(el => ({ id: el.id || el.className.toString().split(" ")[0] || el.tagName, r: el.getBoundingClientRect() }));
  const outside = boxes.filter(b => b.r.left < -1 || b.r.top < -1 || b.r.right > vw + 1 || b.r.bottom > vh + 1).map(b => b.id);
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].r, b = boxes[j].r;
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 2 && iy > 2) overlaps.push(boxes[i].id + " / " + boxes[j].id);
  }
  return { scrollX: document.documentElement.scrollWidth - vw, outside, overlaps, texts, low, halo: halo.length };
};

for (const [w, h] of process.env.PERF_ONLY ? [] : [[390, 844], [768, 1024], [1440, 900], [1920, 1080], [2560, 1311]]) {
  const { page, errors } = await open(w, h);
  const m = await page.evaluate(measure);
  if (out) await page.screenshot({ path: path.join(out, `${w}x${h}.png`) });
  check(`${w}x${h} layout`, m.scrollX <= 0 && !m.outside.length && !m.overlaps.length,
    `sideways ${m.scrollX}px, outside [${m.outside.join(", ")}], overlapping [${m.overlaps.join(", ")}]`);
  check(`${w}x${h} contrast`, !m.low.length, `${m.texts} texts, ${m.low.length} too low${m.low.length ? ": " + m.low.slice(0, 4).map(l => `"${l.t}" ${l.ratio ?? l.why}${l.need ? "/" + l.need : ""}`).join("; ") : ""}, ${m.halo} on the map with a halo`);
  check(`${w}x${h} no page errors`, !errors.length, errors.join(" | ") || "none");
  await page.close();
}

// Hover after a small pan (the marker canvas only moves, it is not drawn again).
{
  const { page, errors } = await open(1440, 900);
  await page.evaluate(() => window.livemap.map.panBy([90, 60], { animate: false }));
  await page.waitForTimeout(400);
  const target = await page.evaluate(() => {
    const m = window.livemap.map, size = m.getSize(), h = window.livemap.poiLayer._hits;
    for (let i = h.n - 1; i >= 0; i--) {
      const p = h.p[i], c = m.latLngToContainerPoint([p[3], p[1]]);
      if (c.x > 450 && c.y > 150 && c.x < size.x - 300 && c.y < size.y - 150 && !p.isFind) return { x: c.x, y: c.y, name: p[4] };
    }
    return null;
  });
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(300);
  const tip = await page.evaluate(() => { const t = document.querySelector(".poi-tip"); return t ? t.textContent : ""; });
  check("hover after a pan names the marker under the cursor", !!target && tip.startsWith(target.name), `"${target && target.name}" -> "${tip.slice(0, 60)}"`);
  check("no page errors (hover)", !errors.length, errors.join(" | ") || "none");
  await page.close();
}

// Region names: all nine when the whole world is in view, none once zoomed in to places.
{
  const { page, errors } = await open(1920, 1080);
  const at = z => page.evaluate(z => new Promise(r => { const m = window.livemap.map; m.setView([5120, 5120], z, { animate: false });
    setTimeout(() => { window.livemap.poiLayer.redraw(); r(window.livemap.poiLayer._regionsDrawn); }, 300); }), z);
  const total = await page.evaluate(() => (window.livemap.discovered.regions() || []).length);
  const far = await at(-3), near = await at(0.5);
  check("region names: all when zoomed out, none when zoomed in", total >= 9 && far === total && near === 0, `${far} of ${total} at zoom -3, ${near} at zoom 0.5`);
  check("no page errors (regions)", !errors.length, errors.join(" | ") || "none");
  await page.close();
}

// Movable panels at 1440 x 900, in one browser context so the place survives a reload.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.status() >= 400) errors.push("HTTP " + r.status() + " " + new URL(r.url()).pathname); });
  const ready = () => page.waitForFunction(() => window.livemap?.discovered?.exp() && window.livemap.weather.state()?.players?.length, null, { timeout: 30000 });
  await page.goto(url);
  await ready();
  const box = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, sel);
  // Grab the title 30 px in and drop it so the panel's top left lands on (x, y).
  const drag = async (sel, x, y) => {
    const c = await box(sel), h = await box(sel + " h2");
    const gx = h.l + 30, gy = h.t + 6;
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx + 20, gy + 20, { steps: 3 });
    await page.mouse.move(x + gx - c.l, y + gy - c.t, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const near = (a, b) => Math.abs(a - b) <= 2;
  const home = await box("#clock");
  await drag("#clock", 15, 400);
  const moved = await box("#clock");
  check("move: the clock lands where it is dropped and snaps to the edge", near(moved.l, 10) && near(moved.t, 400),
    `(${home.l.toFixed(0)}, ${home.t.toFixed(0)}) -> (${moved.l.toFixed(0)}, ${moved.t.toFixed(0)})`);
  await page.reload();
  await ready();
  const kept = await box("#clock");
  check("move: the place is kept after a reload", near(kept.l, moved.l) && near(kept.t, moved.t), `(${kept.l.toFixed(0)}, ${kept.t.toFixed(0)})`);
  await page.setViewportSize({ width: 900, height: 560 });
  await page.waitForTimeout(300);
  const small = await box("#clock");
  check("move: still whole in a smaller window", small.l >= 0 && small.t >= 0 && small.r <= 900 && small.b <= 560,
    `(${small.l.toFixed(0)}, ${small.t.toFixed(0)}, ${small.r.toFixed(0)}, ${small.b.toFixed(0)}) in 900 x 560`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const t = await box("#clock h2");
  await page.mouse.dblclick(t.l + 30, t.t + 6);
  await page.waitForTimeout(250);
  const back = await box("#clock");
  check("move: a double-click on the title puts it back", near(back.l, home.l) && near(back.t, home.t), `(${back.l.toFixed(0)}, ${back.t.toFixed(0)})`);
  await page.click("#poiToggle");
  await page.waitForTimeout(200);
  const p0 = await box("#pois");
  await page.click("#poiAll");
  await page.waitForTimeout(200);
  const p1 = await box("#pois"), still = await page.evaluate(() => !document.querySelector("#pois").classList.contains("moved"));
  check("move: a click on a title button is no drag", still && near(p0.l, p1.l) && near(p0.t, p1.t), `moved class ${!still}`);
  await drag("#pois", 1100, 120);
  const pm = await box("#pois");
  check("move: the marker panel fits the window where it is dropped", near(pm.l, 1100) && near(pm.t, 120) && pm.b <= 900 && pm.r <= 1440,
    `(${pm.l.toFixed(0)}, ${pm.t.toFixed(0)}) to (${pm.r.toFixed(0)}, ${pm.b.toFixed(0)})`);
  check("no page errors (move)", !errors.length, errors.join(" | ") || "none");
  await context.close();
}

// Frame times under load.
{
  const { page, errors } = await open(1920, 1080);
  await page.evaluate(() => document.querySelectorAll("#poiList input").forEach(b => { if (!b.checked) { b.checked = true; b.dispatchEvent(new Event("change")); } }));
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const run = kind => page.evaluate(kind => new Promise(res => {
    const m = window.livemap.map, frames = [];
    let last = performance.now(), zoomIn = true, nextZoom = 0;
    const start = last;
    function step(now) {
      frames.push(now - last); last = now;
      if (now - start > 3000) return res(frames);
      if (kind === "pan") m.panBy([7, 4], { animate: false });
      else if (now >= nextZoom) { m.setZoom(m.getZoom() + (zoomIn ? 1 : -1)); zoomIn = !zoomIn; nextZoom = now + 400; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }), kind);
  const stats = f => { const s = [...f].sort((a, b) => a - b), sum = f.reduce((a, b) => a + b, 0);
    return { n: f.length, fps: f.length / (sum / 1000), p95: s[Math.floor(s.length * 0.95)], long: f.filter(x => x > 50).length }; };
  const pan = stats(await run("pan")), zoom = stats(await run("zoom"));
  const fmt = s => `${s.fps.toFixed(1)} fps, p95 ${s.p95.toFixed(1)} ms, ${s.long} over 50 ms`;
  check("pan, 4x slower CPU, everything on", pan.fps >= 55 && pan.p95 <= 25, fmt(pan));
  console.log("INFO zoom, 4x slower CPU: " + fmt(zoom));
  check("no page errors under load", !errors.length, errors.join(" | ") || "none");
  await page.close();
}
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
