// Place names and search without a game server: web/ with stub data (two players), headless.
//   node tools/perf/places_check.mjs [screenshot.png]
// Passes when, around Pike's Port at zoom -1, many place names are drawn and no two of them (or a
// region name) overlap; none are drawn far out (zoom -3.5); the switch turns them off; the search
// finds "Pike's Port" first for "pike", a region for "revel" and a player for "brom", and Enter
// lands within 60 m of Pike's Port at zoom 0 or closer; a link with &mark rings two spots and opens
// at the first; no page errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shot = process.argv[2];
const web = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "web");
const pois = JSON.parse(fs.readFileSync(path.join(web, "pois.json"), "utf8"));
const pike = pois.places.find(p => p[0] === "Pike's Port");
const players = [{ entity: 3, name: "Aldra Vey", pos: [3560, 140, 4380], rot: [0, 0, 0, 1], ageMs: 10 }, { entity: 4, name: "Brom", pos: [3700, 120, 4250], rot: [0, 0, 0, 1], ageMs: 10 }];
const state = () => JSON.stringify({ time: { raw: 52e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 }, players, weather: null, findsVersion: 0, basesVersion: 0 });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  const stub = { "/state": state(), "/finds": '{"version":0,"ore":[],"chests":[]}', "/bases": '{"version":0,"bases":[]}' }[u.pathname];
  if (stub) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(stub); return; }
  fs.readFile(path.join(web, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname)), (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200); res.end(d); } });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const chrome = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
const browser = await chromium.launch({ executablePath: path.join(root, chrome, "chrome-win64", "chrome.exe") });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const results = [];
const check = (label, pass, detail) => { results.push(pass); console.log((pass ? "PASS " : "FAIL ") + label + " (" + detail + ")"); };
await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x");
await page.waitForFunction(() => window.livemap?.search && window.livemap.weather.state()?.players?.length, null, { timeout: 20000 });
const drawnAt = (x, z, zoom) => page.evaluate(([x, z, zoom]) => new Promise(r => {
  window.livemap.map.setView([z, x], zoom, { animate: false });
  setTimeout(() => { window.livemap.poiLayer.redraw(); r(window.livemap.search.placeBoxes()); }, 400);
}), [x, z, zoom]);
await page.evaluate(() => document.fonts.ready);
const boxes = await drawnAt(pike[1], pike[2], -1);
let overlaps = 0;
for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
  const a = boxes[i], b = boxes[j];
  if (a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) overlaps++;
}
check("place names around Pike's Port at zoom -1, none overlapping", boxes.length >= 15 && overlaps === 0, `${boxes.length} drawn, ${overlaps} overlaps, ${pois.places.length} in the data`);
if (shot) await page.screenshot({ path: shot });
const far = await drawnAt(5120, 5120, -3.5);
check("none when zoomed far out", far.length === 0, `${far.length} at zoom -3.5`);
await page.click("#poiToggle");
await page.evaluate(() => { const l = [...document.querySelectorAll("#poiList label")].find(l => /Place names/.test(l.textContent)); l.querySelector("input").click(); });
const off = await drawnAt(pike[1], pike[2], -1);
check("the Place names switch turns them off", off.length === 0, `${off.length} drawn when off`);
const found = await page.evaluate(() => window.livemap.search.find("pike"));
check("search 'pike' finds Pike's Port first", found[0] === "Pike's Port · Place", found.slice(0, 3).join(" | "));
const region = await page.evaluate(() => window.livemap.search.find("revel"));
check("search 'revel' finds the region", region.some(r => r === "Revelwood · Region"), region.slice(0, 3).join(" | "));
const player = await page.evaluate(() => window.livemap.search.find("brom"));
check("search 'brom' finds the player", player[0] === "Brom · Player", player.slice(0, 2).join(" | "));
await page.fill("#searchBox", "pike");
await page.waitForTimeout(150);
await page.press("#searchBox", "Enter");
await page.waitForTimeout(1200);
const at = await page.evaluate(() => { const c = window.livemap.map.getCenter(); return { x: c.lng, z: c.lat, zoom: window.livemap.map.getZoom() }; });
const dist = Math.hypot(at.x - pike[1], at.z - pike[2]);
check("Enter lands on Pike's Port", dist < 60 && at.zoom >= -0.01, `${dist.toFixed(0)} m off, zoom ${at.zoom}`);
const marked = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
marked.on("pageerror", e => errors.push(e.message));
await marked.goto("http://127.0.0.1:" + server.address().port + "/?key=x&mark=3596,1348,Pond;4328,5380,Deep%20lake");
await marked.waitForFunction(() => document.querySelectorAll(".mark-pin").length === 2, null, { timeout: 20000 }).catch(() => {});
const view = await marked.evaluate(() => { const c = window.livemap.map.getCenter(); return { x: c.lng, z: c.lat, zoom: window.livemap.map.getZoom(),
  pins: document.querySelectorAll(".mark-pin").length, labels: [...document.querySelectorAll(".player-label")].map(l => l.textContent) }; });
check("&mark rings both spots with their names and opens at the first", view.pins === 2 && view.labels.includes("Pond") && view.labels.includes("Deep lake")
  && Math.hypot(view.x - 3596, view.z - 1348) < 30 && view.zoom === -1, JSON.stringify(view));
await marked.close();
check("no page errors", !errors.length, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
