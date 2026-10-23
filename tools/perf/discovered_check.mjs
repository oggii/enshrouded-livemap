// Discovered-markers check without a game server: serves web/ with a stub /events stream and a
// stub /discovered for two players, headless.
//   node tools/perf/discovered_check.mjs [screenshot.png]
// Passes when: "Discovered" shows exactly the keyed points in the chosen set, "Not discovered" the
// other keyed points, points without a key always show; "by <player>" narrows to that player;
// the tooltip names who discovered a place; a server without /discovered says it needs the
// server part; no page errors.
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
// Alice discovered the first 20 keyed places (and Riverreach), Bob places 10..40.
const RIVERREACH = 2101964388;
const alice = keyed.slice(0, 20).map(e => e[1]).concat([RIVERREACH, 12345]);
const bob = keyed.slice(10, 40).map(e => e[1]);
let serverPart = true;
const state = () => JSON.stringify(Object.assign({ time: { raw: 36e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
  players: [], weather: null, findsVersion: 0, basesVersion: 0, flameLevel: 3 }, serverPart ? { discoveredVersion: 7 } : {}));
const discovered = JSON.stringify({ version: 7, players: {
  Alice: { online: true, at: 1792780000, keys: alice },
  Bob: { online: false, at: 1792770000, keys: bob },
} });
const types = { ".html": "text/html", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  if (u.pathname === "/discovered" && !serverPart) { res.writeHead(404); res.end(); return; }
  const stub = { "/state": state(), "/finds": '{"version":0,"ore":[],"chests":[]}', "/bases": '{"version":0,"bases":[]}', "/discovered": discovered }[u.pathname];
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

async function open() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x");
  await page.waitForFunction(() => window.livemap?.poiLayer && document.querySelector("#discMode"), null, { timeout: 20000 });
  await page.click("#poiToggle");
  // every category on, the whole world in view
  await page.evaluate(() => document.querySelectorAll("#poiList input:not([data-extra])").forEach(b => { if (!b.checked) { b.checked = true; b.dispatchEvent(new Event("change")); } }));
  await page.evaluate(() => window.livemap.map.setView([5120, 5120], -3, { animate: false }));
  await page.waitForTimeout(1200);
  return page;
}
// Indices (in pois.json order) of the points drawn right now.
const drawn = page => page.evaluate(() => {
  const h = window.livemap.poiLayer._hits;
  const pts = [];
  for (let i = 0; i < h.n; i++) pts.push(h.p[i]);
  return pts.map(p => p.k === undefined ? -1 : p.k);
});
const setMode = (page, mode, by = "") => page.evaluate(([m, b]) => {
  const s = document.querySelector("#discMode"), t = document.querySelector("#discBy");
  s.value = m; s.dispatchEvent(new Event("change")); t.value = b; t.dispatchEvent(new Event("change"));
}, [mode, by]).then(() => page.waitForTimeout(700));

let page = await open();
await page.waitForFunction(() => window.livemap.discovered.state(), null, { timeout: 10000 });
const allKeys = new Set(keyed.map(e => e[1]));
const aliceSet = new Set(alice), bobSet = new Set(bob), anyone = new Set([...alice, ...bob]);
let d = await drawn(page);
const total = d.length, unkeyed = d.filter(k => k === -1).length;
check("All places: keyed and unkeyed points drawn", d.filter(k => k !== -1).length > 250 && unkeyed > 1000, `${total} drawn, ${unkeyed} without key`);
await setMode(page, "known");
d = await drawn(page);
check("Discovered (anyone): only keyed points of Alice or Bob, all unkeyed points",
  d.filter(k => k !== -1).every(k => anyone.has(k)) && d.filter(k => k !== -1).length === [...allKeys].filter(k => anyone.has(k)).length && d.filter(k => k === -1).length === unkeyed,
  `${d.filter(k => k !== -1).length} keyed drawn, expected ${[...allKeys].filter(k => anyone.has(k)).length}`);
await setMode(page, "known", "Bob");
d = await drawn(page);
check("Discovered by Bob: only Bob's places", d.filter(k => k !== -1).every(k => bobSet.has(k)) && d.filter(k => k !== -1).length === bob.length,
  `${d.filter(k => k !== -1).length} keyed drawn, Bob has ${bob.length}`);
await setMode(page, "unknown", "Alice");
d = await drawn(page);
check("Not discovered by Alice: Riverreach hidden, none of Alice's places, all unkeyed",
  d.every(k => !aliceSet.has(k)) && !d.includes(RIVERREACH) && d.filter(k => k === -1).length === unkeyed,
  `${d.filter(k => k !== -1).length} keyed drawn`);
await setMode(page, "all");
const riverTip = await page.evaluate(() => {
  const map = window.livemap.map, poi = window.livemap.poiLayer._hits;
  let target = null;
  for (let i = 0; i < poi.n; i++) if (poi.p[i].k === 2101964388) target = poi.p[i];
  if (!target) return "riverreach not drawn";
  map.setView([target[3], target[1]], 0, { animate: false });
  return new Promise(r => setTimeout(() => {
    const pt = map.latLngToContainerPoint([target[3], target[1]]);
    map.fire("mousemove", { containerPoint: pt, latlng: map.containerPointToLatLng(pt), originalEvent: {} });
    setTimeout(() => r(document.querySelector(".leaflet-tooltip")?.textContent || ""), 200);
  }, 600));
});
check("tooltip names who discovered Riverreach", /Riverreach .*discovered by Alice/.test(riverTip), riverTip);
if (shot) {
  await setMode(page, "unknown");
  await page.evaluate(() => window.livemap.map.setView([4200, 5200], -3, { animate: false }));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: shot });
}
await page.close();
serverPart = false;
page = await open();
await page.waitForTimeout(1200);
const note = await page.textContent("#discNote");
d = await drawn(page);
check("older server part: note says so, nothing filtered", /needs the server part/i.test(note) && d.length === total, `"${note}", ${d.length} drawn`);
check("no page errors", errors.length === 0, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
