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
let live = null;   // Alice's position once she "logs in" (the live phase at the end)
const state = () => JSON.stringify({ time: { raw: 36e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
  players: live ? [{ entity: 7, name: "Alice", pos: live, rot: [0, 0, 0, 1], ageMs: 10 }] : [],
  weather: null, findsVersion: 0, basesVersion: 0, flameLevel: 3, discoveredVersion: 7, exploredVersion: 3 });
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
// Fog pixels for Alice, read from the canvas on the map: dark east, clear west, and a soft edge
// (several steps between clear and dark across her border at x = 5120) instead of a hard one.
await setMode("all", "Alice");
await page.waitForTimeout(1200);
const fogAt = pts => page.evaluate(pts => {
  const c = document.querySelector(".leaflet-fog-pane canvas");
  if (!c) return null;
  const ctx = c.getContext("2d");
  return pts.map(([x, z]) => ctx.getImageData(Math.floor(x / 10240 * c.width), Math.floor((1 - z / 10240) * c.height), 1, 1).data[3]);
}, pts);
const fog = await fogAt([[2000, 5000], [8000, 5000]]);
check("fog overlay: clear where Alice has been, dark elsewhere", fog && fog[0] === 0 && fog[1] > 150, JSON.stringify(fog));
const edge = await fogAt([4950, 4990, 5030, 5070, 5110, 5150, 5190, 5230, 5270, 5310].map(x => [x, 5000]));
const between = edge ? edge.filter(a => a > 5 && a < 185).length : 0;
check("fog edge is soft: 3+ steps between clear and dark, never lighter further out",
  edge && edge[0] === 0 && edge.at(-1) > 150 && between >= 3 && edge.every((a, i) => i === 0 || a >= edge[i - 1]), JSON.stringify(edge));
// Live: Alice shows up east of her explored area while /explored stays the same. The page clears
// 300 m around her by itself: the fog there fades out (several in-between values, not one jump),
// the cell counts as explored and an unkeyed place there shows under "Discovered by Alice".
const spot = all.find(p => p.k === null && p.x > 6500 && p.x < 9500 && p.z > 1000 && p.z < 9000 && !aliceExplored(p));
await setMode("known", "Alice");
const probe = () => page.evaluate(([x, z]) => ({ explored: window.livemap.discovered.explored(x, z), alpha: window.livemap.discovered.fogAlpha(x, z) }), [spot.x, spot.z]);
const before = await probe(), shownBefore = (await drawn()).some(p => p.x === spot.x && p.z === spot.z);
live = [spot.x, 120, spot.z];
const samples = [], t0 = Date.now();
while (Date.now() - t0 < 2500) { samples.push({ t: Date.now() - t0, a: (await probe()).alpha }); await page.waitForTimeout(40); }
const after = await probe(), shownAfter = (await drawn()).some(p => p.x === spot.x && p.z === spot.z);
const mid = new Set(samples.filter(s => s.a > 5 && s.a < 185).map(s => s.a));
const start = samples.find(s => s.a < 185), end = samples.find(s => s.a === 0);
check("live: fog clears around the player by itself, fading", !before.explored && before.alpha > 150 && after.explored && after.alpha === 0 && mid.size >= 3,
  `alpha ${before.alpha} -> 0 in ${start && end ? end.t - start.t : "?"} ms with ${mid.size} in-between values, explored ${before.explored} -> ${after.explored}`);
check("live: a place there shows under \"Discovered by Alice\"", !shownBefore && shownAfter, `${shownBefore} -> ${shownAfter} at ${spot.x.toFixed(0)}, ${spot.z.toFixed(0)}`);
if (shot) {
  await page.evaluate(([x, z]) => window.livemap.map.setView([z, x], -2, { animate: false }), [spot.x, spot.z]);
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot });
}
check("no page errors", errors.length === 0, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
