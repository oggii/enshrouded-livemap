// Deadly shroud check without a game server: serves web/ with a stub /events stream whose
// flameLevel can be changed, headless.
//   node tools/perf/shroud_check.mjs <points.json> [screenshot.png]
// points.json: {"<level>": {"x": .., "z": ..}} world points deep inside zones of that level (and
// "0" for land), picked from web/shroud.png by a separate script.
// Passes when: the page reads every point's level; at Flame level 3 the overlay pixel over a
// level 4/5/9 zone is pink and over level 2/3 and land it is clear; the tooltip says
// deadly / enough; Flame level 5 makes level 4 and 5 clear; the clock shows the level; a state
// without flameLevel (older server part) labels the switch; the switch hides the overlay;
// no page errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [pointsFile, shot] = process.argv.slice(2);
const points = JSON.parse(fs.readFileSync(pointsFile, "utf8"));
const web = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "web");
let flame = 3, withFlame = true;
const state = () => JSON.stringify(Object.assign({ time: { raw: 36e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
  players: [], weather: null, findsVersion: 0, basesVersion: 0 }, withFlame ? { flameLevel: flame } : {}));
const types = { ".html": "text/html", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  const stub = { "/state": state(), "/finds": '{"version":0,"ore":[],"chests":[]}', "/bases": '{"version":0,"bases":[]}' }[u.pathname];
  if (stub) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(stub); return; }
  const file = path.join(web, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(d); } });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const chrome = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, chrome, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x");
const results = [];
const check = (label, pass, detail) => { results.push(pass); console.log((pass ? "PASS " : "FAIL ") + label + " (" + detail + ")"); };
const ready = () => page.waitForFunction(() => window.livemap?.shroud?.ready(), null, { timeout: 20000 });
await ready();

// Overlay pixel at a world point: read the overlay's current image through a canvas.
const overlayAt = (x, z) => page.evaluate(async ([x, z]) => {
  const img = [...document.querySelectorAll(".leaflet-shroud-pane img")][0];
  if (!img || !img.complete) return null;
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const col = Math.floor(x / 10240 * c.width), row = Math.floor((1 - z / 10240) * c.height);
  return [...ctx.getImageData(col, row, 1, 1).data];
}, [x, z]);
await page.waitForTimeout(800);
const levels = await page.evaluate(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, window.livemap.shroud.levelAt(v.x, v.z)])), points);
check("page reads every zone level from shroud.png", Object.entries(levels).every(([k, v]) => String(v) === k), JSON.stringify(levels));
const pinkAt = async lv => { const px = await overlayAt(points[lv].x, points[lv].z); return px && px[3] > 50 && px[0] > 200 && px[2] > 120; };
const at3 = {}; for (const lv of Object.keys(points)) at3[lv] = await pinkAt(lv);
check("Flame level 3: zones 4, 5, 9 pink; 2, 3 and land clear",
  at3[4] && at3[5] && at3[9] && !at3[2] && !at3[3] && !at3[0], JSON.stringify(at3));
check("clock shows the Flame level", (await page.textContent("#flameLevel")) === "3", await page.textContent("#flameLevel"));
const tip = lv => page.evaluate(([x, z]) => {
  const map = window.livemap.map; map.setView([z, x], -1, { animate: false });
  return new Promise(r => setTimeout(() => {
    const pt = map.latLngToContainerPoint([z, x]);
    map.fire("mousemove", { containerPoint: pt, latlng: map.containerPointToLatLng(pt), originalEvent: {} });
    setTimeout(() => r(document.querySelector(".leaflet-tooltip")?.textContent || ""), 150);
  }, 300));
}, [points[lv].x, points[lv].z]);
// Markers win the tooltip over the shroud (a point can sit under an Elixir Well): hide them.
await page.click("#poiToggle");
await page.evaluate(() => document.querySelectorAll("#poiList input:not([data-extra])").forEach(b => { if (b.checked) { b.checked = false; b.dispatchEvent(new Event("change")); } }));
const t5 = await tip(5), t2 = await tip(2);
check("tooltip: deadly at level 5, enough at level 2", /Shroud level 5 · deadly at Flame level 3/.test(t5) && /Shroud level 2 · Flame level 3 is enough/.test(t2), `"${t5}" / "${t2}"`);
flame = 5;
await page.waitForTimeout(600); await ready(); await page.waitForTimeout(600);
const at5 = {}; for (const lv of Object.keys(points)) at5[lv] = await pinkAt(lv);
check("Flame level 5: zones 4 and 5 clear, 9 still pink", !at5[4] && !at5[5] && at5[9], JSON.stringify(at5));
const box = page.locator("label", { has: page.locator("#shroudLabel") }).locator("input");
await box.uncheck();
check("switch off removes the overlay", (await page.locator(".leaflet-shroud-pane img").count()) === 0, "images in pane: " + (await page.locator(".leaflet-shroud-pane img").count()));
await box.check();
withFlame = false;
await page.waitForTimeout(800);
check("older server part (no flameLevel): switch says so", /needs the server part/.test(await page.textContent("#shroudLabel")), await page.textContent("#shroudLabel"));
if (shot) { withFlame = true; flame = 3; await page.waitForTimeout(800); await page.evaluate(() => window.livemap.map.setView([4500, 5400], -3, { animate: false })); await page.waitForTimeout(1500); await page.screenshot({ path: shot }); }
check("no page errors", errors.length === 0, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
