// Banners and cover for Nexus and GitHub: the real page's HD map with the region names behind
// the game's logo, "LIVE MAP" in the page's type and the game's gold frame. Needs the HD tiles
// (local-maps/tiles-hd, only the maintainer has them).
//   node tools/perf/promo_banner.mjs <out dir> <logo.png> [version]
// Writes banner.jpg (1300 x 372, Nexus header), banner-1600x400.jpg and cover.jpg (1920 x 1080).
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "../..");
const web = path.join(repo, "web");
const [outDir, logoFile, version = "1.7"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const state = JSON.stringify({ time: { raw: 52e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 }, players: [], weather: null, findsVersion: 0, basesVersion: 0 });
const types = { ".html": "text/html", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const t = setInterval(() => res.write("data: " + state + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  const stub = { "/state": state, "/finds": '{"version":0,"ore":[],"chests":[]}', "/bases": '{"version":0,"bases":[]}' }[u.pathname];
  if (stub) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(stub); return; }
  const rel = decodeURIComponent(u.pathname);
  const file = rel === "/maps.json" ? path.join(repo, "package", "hd", "maps.json")
    : rel.startsWith("/tiles-hd/") ? path.join(repo, "local-maps", rel)
    : rel === "/logo.png" ? logoFile
    : path.join(web, rel === "/" ? "index.html" : rel);
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(d); } });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const chrome = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
const browser = await chromium.launch({ executablePath: path.join(root, chrome, "chrome-win64", "chrome.exe") });
const pois = JSON.parse(fs.readFileSync(path.join(web, "pois.json"), "utf8"));
const noMarkers = JSON.stringify(Object.fromEntries(pois.categories.map(c => [c.id, false])));

// The map alone: HD style, region names, no markers, panels or controls.
async function backdrop(w, h, scale, view) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.addInitScript(s => { try { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch {} },
    { "livemap.style": "HD", "livemap.pois": noMarkers, "livemap.weather": "0", "livemap.shroud": "0" });
  await page.goto(base + "/?key=x");
  await page.waitForFunction(() => window.livemap?.discovered?.regions(), null, { timeout: 30000 });
  await page.addStyleTag({ content: "#left, #clock, #status, #compass, #tileNote, #calibToggle, .leaflet-control-container { display: none !important; } #map::after { display: none; }" });
  await page.evaluate(v => window.livemap.map.setView([v[1], v[0]], v[2], { animate: false }), view);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3000);
  const png = await page.screenshot();
  await page.close();
  return png;
}

async function compose(name, w, h, scale, png, layout) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.goto(base + "/fonts/OFL.txt");
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Alegreya; src: url("${base}/fonts/alegreya-latin.woff2") format("woff2"); font-weight: 400 900; }
    html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: #120f18; font-family: Alegreya, Georgia, serif; }
    .map { position: absolute; inset: 0; width: ${w}px; height: ${h}px; }
    .shade { position: absolute; inset: 0; background:
      linear-gradient(90deg, rgba(12, 9, 18, 0.96) 0%, rgba(12, 9, 18, 0.88) ${layout.fade[0]}%, rgba(12, 9, 18, 0) ${layout.fade[1]}%),
      ${layout.rfade ? `linear-gradient(270deg, rgba(12, 9, 18, 0.97) 0%, rgba(12, 9, 18, 0.9) ${layout.rfade[0]}%, rgba(12, 9, 18, 0) ${layout.rfade[1]}%),` : ""}
      radial-gradient(ellipse 110% 120% at 70% 50%, rgba(0, 0, 0, 0) 55%, rgba(8, 6, 12, 0.7) 100%); }
    .frame { position: absolute; inset: ${layout.inset}px; border: ${layout.border}px solid transparent;
      border-image: url("${base}/ui/frame.webp") 40 / ${layout.border}px / 0 stretch; pointer-events: none; }
    .text { position: absolute; left: ${layout.left}px; top: 50%; transform: translateY(-50%); color: #f6ead0; }
    .logo { display: block; width: ${layout.logo}px; filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.8)); margin-left: -6px; }
    .title { font-weight: 700; font-size: ${layout.title}px; letter-spacing: 0.08em; line-height: 1; margin-top: ${layout.gap}px;
      background: linear-gradient(180deg, #fff1cf 0%, #e8c477 55%, #b8893f 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
      filter: drop-shadow(0 3px 10px rgba(0, 0, 0, 0.75)); }
    .rule { width: ${layout.rule}px; height: 6px; margin: ${layout.gap * 0.7}px 0; background: url("${base}/ui/separator.webp") left center / 100% 100% no-repeat; }
    .tag { font-weight: 600; font-size: ${layout.tag}px; letter-spacing: 0.02em; text-shadow: 0 2px 8px #000; }
    .small { font-weight: 700; font-size: ${layout.small}px; letter-spacing: 0.22em; color: #e8c477; text-transform: uppercase; margin-top: ${layout.gap * 0.6}px; text-shadow: 0 2px 6px #000; }
  </style></head><body>
    <img class="map" src="data:image/png;base64,${png.toString("base64")}">
    <div class="shade"></div>
    <div class="text">
      <img class="logo" src="${base}/logo.png">
      <div class="title">LIVE MAP</div>
      <div class="rule"></div>
      <div class="tag">${layout.tagline}</div>
      ${layout.features ? `<div class="small">${layout.features}</div>` : ""}
      <div class="small">Server-side mod · version ${version}</div>
    </div>
    <div class="frame"></div>
  </body></html>`);
  await page.evaluate(() => document.fonts.load("700 40px Alegreya"));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, name), type: "jpeg", quality: 90 });
  await page.close();
}

// Banners: the island on the right of a wide strip, the text on the sea to its left.
for (const [name, w, h] of [["banner.jpg", 1300, 372], ["banner-1600x400.jpg", 1600, 400]]) {
  const png = await backdrop(w, h, 2, [w === 1300 ? 3550 : 3000, 4700, -3]);
  await compose(name, w, h, 1, png, { fade: [24, 46], rfade: w === 1600 ? [5, 12] : null, inset: 8, border: 14, left: 54, logo: w === 1300 ? 250 : 280, title: w === 1300 ? 56 : 62,
    gap: 6, rule: 300, tag: 19, small: 11, tagline: "The game's own map, live in your browser" });
}
// Cover: the whole island on the right, a bigger title and what the map shows.
{
  const png = await backdrop(1920, 1080, 1, [2750, 5150, -3.05]);   // the world ends right of the island: faded out too
  await compose("cover.jpg", 1920, 1080, 1, png, { fade: [30, 52], rfade: [12, 24], inset: 16, border: 22, left: 120, logo: 520, title: 120, gap: 16, rule: 560,
    tag: 38, small: 17, tagline: "The game's own map, live in your browser.<br>Players install nothing.",
    features: "Players live · Region names · Fog of war · Deadly shroud · Ore and loot map" });
}
console.log("wrote banner.jpg, banner-1600x400.jpg, cover.jpg to", outDir);
await browser.close();
server.close();
