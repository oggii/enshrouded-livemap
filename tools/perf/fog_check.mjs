// Fog of war / explored-area check without a game server: web/ with stub /discovered and
// /explored for two players, headless.
//   node tools/perf/fog_check.mjs [screenshot.png]
// Alice explored the west half of the world (x < 5120); Bob explored nothing but has discovered
// 30 keyed places. Passes when, for "Discovered by <player>": keyed points follow that player's
// keys, other points show only inside that player's explored area (Bob: 300 m around his
// discovered places); "Not discovered" is the exact complement; the fog overlay is dark where the
// chosen player has not been and clear where they have; no page errors.
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
const alice = keyed.slice(0, 20).map(e => e[1]);
const bob = keyed.slice(40, 70).map(e => e[1]);
const N = 512, CELL = 20;
const westBits = new Uint8Array(N * N / 8);
for (let row = 0; row < N; row++) for (let col = 0; col < N / 2; col++) { const i = row * N + col; westBits[i >> 3] |= 1 << (i & 7); }
const explored = JSON.stringify({ version: 3, cells: N, cellMetres: CELL, players: { Alice: Buffer.from(westBits).toString("base64") } });
const discovered = JSON.stringify({ version: 7, players: {
  Alice: { online: true, at: 1792780000, keys: alice }, Bob: { online: false, at: 1792770000, keys: bob } } });
const state = () => JSON.stringify({ time: { raw: 36e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
  players: [], weather: null, findsVersion: 0, basesVersion: 0, flameLevel: 3, discoveredVersion: 7, exploredVersion: 3 });
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
    "/discovered": discovered, "/explored": explored }[u.pathname];
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
await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem("livemap.fog", "1"); } catch {} });
await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x");
await page.waitForFunction(() => window.livemap?.discovered?.exp() && window.livemap.discovered.state(), null, { timeout: 20000 });
await page.click("#poiToggle");
await page.evaluate(() => document.querySelectorAll("#poiList input:not([data-extra])").forEach(b => { if (!b.checked) { b.checked = true; b.dispatchEvent(new Event("change")); } }));
await page.evaluate(() => window.livemap.map.setView([5120, 5120], -3, { animate: false }));
await page.waitForTimeout(1000);
const drawn = () => page.evaluate(() => {
  const h = window.livemap.poiLayer._hits, out = [];
  for (let i = 0; i < h.n; i++) { const p = h.p[i]; out.push({ k: p.k === undefined ? null : p.k, x: p[1], z: p[3] }); }
  return out;
});
const setMode = (mode, by) => page.evaluate(([m, b]) => {
  const s = document.querySelector("#discMode"), t = document.querySelector("#discBy");
  s.value = m; s.dispatchEvent(new Event("change")); t.value = b; t.dispatchEvent(new Event("change"));
}, [mode, by]).then(() => page.waitForTimeout(800));
const all = await drawn();
// Cell-exact expectation, as the page and the server count it: a point is explored when its 20 m
// cell is, and a discovered place opens every cell whose centre is within 300 m of it.
const circles = keys => {
  const places = keyed.filter(([, k]) => keys.has(k)).map(([i]) => pois.pois[i]);
  return pt => {
    const col = Math.floor(pt.x / CELL), row = Math.floor(pt.z / CELL);
    return places.some(p => Math.hypot((col + 0.5) * CELL - p[1], (row + 0.5) * CELL - p[3]) <= 300);
  };
};
const aliceCircles = circles(new Set(alice)), bobExplored = circles(new Set(bob));
const aliceExplored = pt => Math.floor(pt.x / CELL) < N / 2 || aliceCircles(pt);
for (const [who, keys, exploredAt] of [["Alice", new Set(alice), aliceExplored], ["Bob", new Set(bob), bobExplored]]) {
  await setMode("known", who);
  const d = await drawn();
  const wrong = d.filter(p => p.k !== null ? !keys.has(p.k) : !exploredAt(p));
  const expectUnkeyed = all.filter(p => p.k === null && exploredAt(p)).length;
  check(`Discovered by ${who}: keyed = their keys, others = their explored area`,
    wrong.length === 0 && d.filter(p => p.k !== null).length === keys.size && d.filter(p => p.k === null).length === expectUnkeyed,
    `${d.length} drawn, ${wrong.length} wrong, unkeyed ${d.filter(p => p.k === null).length} vs ~${expectUnkeyed}`);
  await setMode("unknown", who);
  const u = await drawn();
  check(`Not discovered by ${who}: the complement`, u.length + d.length === all.length && u.every(p => p.k !== null ? !keys.has(p.k) : true),
    `${u.length} + ${d.length} = ${u.length + d.length} of ${all.length}`);
}
// Fog pixels for Alice: dark east, clear west.
await setMode("all", "Alice");
await page.waitForTimeout(600);
const fog = await page.evaluate(async () => {
  const img = document.querySelector(".leaflet-fog-pane img");
  if (!img) return null;
  await img.decode().catch(() => {});
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const at = (x, z) => ctx.getImageData(Math.floor(x / 10240 * c.width), Math.floor((1 - z / 10240) * c.height), 1, 1).data[3];
  return { west: at(2000, 5000), east: at(8000, 5000) };
});
check("fog overlay: clear where Alice has been, dark elsewhere", fog && fog.west === 0 && fog.east > 150, JSON.stringify(fog));
if (shot) {
  await setMode("known", "Bob");
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot });
}
check("no page errors", errors.length === 0, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
