// Explore mode check without a game server: web/ with stub /state (exploreMode), /discovered,
// /explored and /near, headless.
//   node tools/perf/explore_check.mjs [screenshot.png]
// Alice explored the west half (x < 5120) and discovered 20 keyed places; her near grid holds
// the cells around one unkeyed point in the west ("spot"). Passes when the fog switch and the
// Discovered mode are hidden, the fog is opaque east and clear west, keyed points = Alice's keys,
// unkeyed points = only those in her near grid, an unkeyed west point outside it shows once Alice
// walks up to it, and the page has no errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shot = process.argv[2];
const web = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "web");
const pois = JSON.parse(fs.readFileSync(path.join(web, "pois.json"), "utf8"));
const keyed = Object.entries(pois.discoveryKeys).map(([i, k]) => [Number(i), k]);
const keyedIdx = new Set(keyed.map(e => e[0]));
const alice = keyed.slice(0, 20).map(e => e[1]);
const N = 512, CELL = 20, cellOf = (x, z) => Math.floor(z / CELL) * N + Math.floor(x / CELL);
const bits = () => new Uint8Array(N * N / 8);
const set = (b, i) => { b[i >> 3] |= 1 << (i & 7); };
const west = bits();
for (let row = 0; row < N; row++) for (let col = 0; col < N / 2; col++) set(west, row * N + col);
// Unkeyed, non-find points in the west, away from the edges; the first is in the near grid.
const westUnkeyed = pois.pois.map((p, i) => ({ i, x: p[1], z: p[3] }))
  .filter(p => !keyedIdx.has(p.i) && p.x > 1000 && p.x < 4500 && p.z > 1000 && p.z < 9000);
const spot = westUnkeyed[0];
const walkTo = westUnkeyed.find(p => Math.hypot(p.x - spot.x, p.z - spot.z) > 500);
const near = bits();
set(near, cellOf(spot.x, spot.z));
const grid = (b, v) => JSON.stringify({ version: v, cells: N, cellMetres: CELL, players: { Alice: Buffer.from(b).toString("base64") } });
const discovered = JSON.stringify({ version: 7, players: { Alice: { online: true, at: 1792780000, keys: alice } } });
let live = null;
const state = () => JSON.stringify({ time: { raw: 36e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
  players: live ? [{ entity: 7, name: "Alice", pos: live, rot: [0, 0, 0, 1], ageMs: 10 }] : [],
  weather: null, findsVersion: 0, basesVersion: 0, flameLevel: 3, discoveredVersion: 7, exploredVersion: 3,
  exploreMode: true, nearVersion: 2 });
const types = { ".html": "text/html", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  const stub = { "/state": state(), "/finds": '{"version":0,"ore":[],"chests":[]}', "/bases": '{"version":0,"bases":[]}',
    "/discovered": discovered, "/explored": grid(west, 3), "/near": grid(near, 2) }[u.pathname];
  if (stub) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(stub); return; }
  const file = path.join(web, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(d); } });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const chrome = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, chrome, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const results = [];
const check = (label, pass, detail) => { results.push(pass); console.log((pass ? "PASS " : "FAIL ") + label + " (" + detail + ")"); };
const errors = [];
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", e => errors.push(e.message));
await page.addInitScript(() => { try { localStorage.clear(); } catch {} });   // fog off and "All places" in storage: the mode must win
await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x");
await page.waitForFunction(() => window.livemap?.discovered?.explore?.() && window.livemap.discovered.exp() && window.livemap.discovered.state(), null, { timeout: 20000 });
await page.click("#poiToggle");
await page.evaluate(() => document.querySelectorAll("#poiList input:not([data-extra])").forEach(b => { if (!b.checked) { b.checked = true; b.dispatchEvent(new Event("change")); } }));
await page.evaluate(() => window.livemap.map.setView([5120, 5120], -3, { animate: false }));
await page.waitForTimeout(1500);
const hidden = await page.evaluate(() => ["fogSwitch", "discMode"].map(id => { const e = document.getElementById(id); return !e || e.offsetParent === null; }));
check("fog switch and Discovered mode are hidden", hidden.every(Boolean), JSON.stringify(hidden));
const note = await page.evaluate(() => document.getElementById("discNote")?.textContent || "");
check("panel explains explore mode", note.startsWith("Explore mode:"), note);
const alpha = await page.evaluate(() => [window.livemap.discovered.fogAlpha(2000, 5000), window.livemap.discovered.fogAlpha(8000, 5000)]);
check("fog: clear west, opaque east", alpha[0] === 0 && alpha[1] === 255, JSON.stringify(alpha));
const drawn = () => page.evaluate(() => {
  const h = window.livemap.poiLayer._hits, out = [];
  for (let i = 0; i < h.n; i++) { const p = h.p[i]; out.push({ k: p.k === undefined ? null : p.k, x: p[1], z: p[3], find: !!p.isFind, base: !!(p[5] && p[5].base) }); }
  return out;
});
const d = (await drawn()).filter(p => !p.find && !p.base);
const keys = new Set(alice);
const wrongKeyed = d.filter(p => p.k !== null && !keys.has(p.k));
const unkeyed = d.filter(p => p.k === null);
const nearCell = cellOf(spot.x, spot.z);
check("keyed places: only the ones Alice discovered", wrongKeyed.length === 0 && d.filter(p => p.k !== null).length === keys.size,
  `${d.filter(p => p.k !== null).length} keyed drawn, ${wrongKeyed.length} wrong`);
check("small markers: only inside the near grid", unkeyed.length > 0 && unkeyed.every(p => cellOf(p.x, p.z) === nearCell),
  `${unkeyed.length} unkeyed drawn`);
const shownBefore = (await drawn()).some(p => p.x === walkTo.x && p.z === walkTo.z);
live = [walkTo.x + 20, 120, walkTo.z];
await page.waitForTimeout(1500);
const shownAfter = (await drawn()).some(p => p.x === walkTo.x && p.z === walkTo.z);
check("live: a small marker shows once Alice is within 50 m", !shownBefore && shownAfter, `${shownBefore} -> ${shownAfter}`);
if (shot) { await page.screenshot({ path: shot }); }
check("no page errors", errors.length === 0, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
