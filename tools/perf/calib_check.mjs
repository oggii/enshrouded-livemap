// Calibration check without a game server: serves web/ with a stub /events stream (one fake
// player whose position can be changed) and drives the calibration in a headless browser.
//   node tools/perf/calib_check.mjs
// Passes when: two clicks at the same spot give a message and keep the map image; two spots far
// apart give finite bounds; Reset restores the original bounds; no page errors at all; and the
// Calibrate button is hidden without &calibrate. Then, with the shipped web/maps.json (game map
// tiles): tiles load, the map is not blank, and calibrating it only shows a notice.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web"), maps = path.join(repo, "local-maps");
const files = {
  "/map-hd.jpg": path.join(maps, "map-hd-q80.jpg"), "/map-hd-preview.jpg": path.join(maps, "map-hd-preview.jpg"),
  "/map-original.jpg": path.join(maps, "map-original-1280.jpg"), "/map-original-preview.jpg": path.join(maps, "map-original-preview.jpg"),
};
// Image maps (for the calibration itself); /?tiles=1 pages get the shipped maps.json instead.
const imageMaps = JSON.stringify({ worldSize: 10240, maps: [
  { name: "HD", file: "map-hd.jpg", preview: "map-hd-preview.jpg" },
  { name: "Original", file: "map-original.jpg", preview: "map-original-preview.jpg" }] });
let useTiles = false, tileHits = 0, tileMisses = 0;
let pos = [3000, 800, 3000];
const state = () => JSON.stringify({ time: { raw: 36e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
  players: [{ entity: 1, name: "Tester", pos, rot: [0, 0, 0, 1], ageMs: 10 }], weather: null, findsVersion: 0 });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 200);
    req.on("close", () => clearInterval(t));
    return;
  }
  if (u.pathname === "/state") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(state()); return; }
  if (u.pathname === "/maps.json" && !useTiles) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(imageMaps); return; }
  if (u.pathname.startsWith("/tiles/")) fs.existsSync(path.join(web, u.pathname)) ? tileHits++ : tileMisses++;
  if (u.pathname === "/finds") { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"version":0,"ore":[],"chests":[]}'); return; }
  if (u.pathname === "/bases") { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"version":0,"bases":[]}'); return; }
  const file = files[u.pathname] || path.join(web, u.pathname === "/" ? "index.html" : u.pathname);
  if (!file.startsWith(web) && !Object.values(files).includes(file)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    const type = file.endsWith(".html") ? "text/html" : file.endsWith(".json") ? "application/json"
      : file.endsWith(".jpg") ? "image/jpeg" : file.endsWith(".png") ? "image/png" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type }); res.end(data);
  });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;

const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const dir = fs.readdirSync(root).filter(d => d.startsWith("chromium-")).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, dir, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : "")); };

await page.goto(base + "/?key=x");
await page.waitForTimeout(2500);
if (process.env.CALIB_DEBUG) { console.log("errors so far:", errors); console.log(await page.evaluate(() => [typeof window.livemap, document.getElementById("calibToggle").style.display, document.getElementById("status").textContent])); }
check("Calibrate hidden without &calibrate", !(await page.isVisible("#calibToggle")));

await page.goto(base + "/?key=x&calibrate=1");
await page.waitForTimeout(3000);
await page.click("#calibToggle");
await page.waitForTimeout(400);
await page.selectOption("#calibPlayer", "1");
const bounds = () => page.evaluate(() => {
  const L = window.livemap.map; let b = null;
  L.eachLayer(l => { if (l.getBounds && l._url && l._url.includes("map-")) { const x = l.getBounds(); b = [x.getSouth(), x.getWest(), x.getNorth(), x.getEast()]; } });
  return b;
});
const orig = await bounds();
const clickWorld = async (x, z) => {   // click the map where world (x, z) is drawn
  const pt = await page.evaluate(([x, z]) => { const p = window.livemap.map.latLngToContainerPoint([z, x]); return [p.x, p.y]; }, [x, z]);
  const box = await page.locator("#map").boundingBox();
  await page.mouse.click(box.x + pt[0], box.y + pt[1]);
  await page.waitForTimeout(300);
};

// The reported case: two clicks while standing on the same spot.
await clickWorld(3000, 3000);
await clickWorld(3000, 3000);
let b = await bounds();
let note = await page.inputValue("#calibOut");
check("same spot twice: map bounds unchanged", JSON.stringify(b) === JSON.stringify(orig), JSON.stringify(b));
check("same spot twice: message shown", /Too close/.test(note), note.slice(0, 80));

// A proper second spot far away on both axes.
pos = [6000, 800, 6500];
await page.waitForTimeout(600);
await clickWorld(6000, 6500);
b = await bounds();
note = await page.inputValue("#calibOut");
check("far second spot: finite bounds", b && b.every(Number.isFinite), JSON.stringify(b));
check("far second spot: bounds text", /"bounds": \[\[/.test(note), note.slice(0, 90));

// A wrong second click (mirrored): rejected, image stays as it was.
await page.click("#calibReset");
await page.waitForTimeout(300);
pos = [3000, 800, 3000];
await page.waitForTimeout(600);
await clickWorld(3000, 3000);
pos = [6000, 800, 6500];
await page.waitForTimeout(600);
await clickWorld(1000, 1000);   // clicked the wrong way round
b = await bounds();
note = await page.inputValue("#calibOut");
check("mirrored click: rejected", JSON.stringify(b) === JSON.stringify(orig) && /does not fit/.test(note), note.slice(0, 80));

await page.click("#calibReset");
await page.waitForTimeout(300);
b = await bounds();
check("Reset restores the original bounds", JSON.stringify(b) === JSON.stringify(orig), JSON.stringify(b));
const visible = await page.evaluate(() => { const img = document.querySelector("img.leaflet-image-layer"); const r = img && img.getBoundingClientRect(); return !!r && r.width > 100 && r.height > 100; });
check("map image visible", visible);
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

// The shipped config: the game map as tiles.
useTiles = true;
await page.goto(base + "/?key=x&calibrate=1");
await page.waitForTimeout(3000);
const tileState = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll("img.leaflet-tile")];
  return { loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length, total: imgs.length,
    bg: getComputedStyle(document.getElementById("map")).backgroundColor };
});
check("game map: tiles shown", tileState.loaded >= 4 && tileHits >= 4 && tileMisses === 0,
  JSON.stringify(tileState) + " hits " + tileHits + " misses " + tileMisses);
check("game map: sea colour behind the tiles", tileState.bg === "rgb(64, 45, 59)", tileState.bg);
await page.click("#calibToggle");
await page.waitForTimeout(300);
await page.selectOption("#calibPlayer", "1");
await clickWorld(3000, 3000);
note = await page.inputValue("#calibOut");
check("game map: calibration only shows a notice", /already fits/.test(note), note.slice(0, 80));
await page.mouse.wheel(0, -1200);   // zoom in past the native tiles
await page.waitForTimeout(1500);
check("game map: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `${failed} check(s) FAILED` : "all calibration checks passed");
process.exit(failed ? 1 : 0);
