// Chests, locks and creatures from the server's loaded world, without a game server: web/ with
// stub data, headless.
//   node tools/perf/objects_check.mjs [screenshot.png]
// Passes when a chest the server reports looted dims its marker in the data and stays looted
// although its finds record is older than the refill time, a full one stays full, a looted chest
// not in the data gets its own marker, an unlocked door and a closed barrier land in their two
// categories, the wolf, the bunny and the boss are drawn with their name, level and health (the
// boss's name on the map), the Creatures switch removes them, and there are no page errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shot = process.argv[2];
const web = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "web");
const pois = JSON.parse(fs.readFileSync(path.join(web, "pois.json"), "utf8"));
const catIndex = id => pois.categories.findIndex(c => c.id === id);
const silver = pois.pois.find(p => p[0] === catIndex("chest_silver")), gold = pois.pois.find(p => p[0] === catIndex("chest_gold"));
const now = Math.floor(Date.now() / 1000);
const objects = { version: 3, chests: [
  { id: 11, t: "LootChest_Random_silver_fog", x: silver[1] + 0.4, y: silver[2], z: silver[3] - 0.3, empty: true, at: now - 7200 },
  { id: 12, t: "LootChest_Random_gold", x: gold[1], y: gold[2], z: gold[3], empty: false, at: now - 60 },
  { id: 13, t: "LootChest_Random_wood", x: 5000.5, y: 700, z: 5000.5, empty: true, at: now - 300 }],
  switches: [
    { t: "Prop_Door_Large_Castle_02_Locked_Pickable", x: 3400.6, y: 900, z: 1723.0, k: "l", on: true, at: now - 120 },
    { t: "Door_Magical_Barrier_Skeleton_trigger", x: 3500, y: 910, z: 1700, k: "b", on: false, at: now - 600 }] };
const creatures = { version: 5, creatures: [
  { e: 33410, t: "Enemy_Wildbeast_wolf_earlygame", x: 3725.3, z: 1301.7, hp: 20, max: 34, s: 6, lv: 3, boss: false, animal: false },
  { e: 11783, t: "Animal_Wildlife_T2_Bunny_AG2", x: 3664.7, z: 1405.8, hp: 19, max: 19, s: 0, lv: 1, boss: false, animal: true },
  { e: 501, t: "Enemy_Fogger_Heavy_Berserker_BossHealthBar", x: 3600, z: 1350, hp: 5000, max: 8000, s: 6, lv: 12, boss: true, animal: false }] };
// The silver chest was also looted by Aldra Vey (finds), longer ago than the 30-minute refill.
const finds = { version: 1, ore: [], chests: [{ x: silver[1], y: silver[2], z: silver[3], at: now - 7200, by: "Aldra Vey", rl: true, poi: null }] };
const players = [{ entity: 3, name: "Aldra Vey", pos: [3560, 140, 1380], rot: [0, 0, 0, 1], ageMs: 10 }];
const state = () => JSON.stringify({ time: { raw: 52e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 }, players, weather: null,
  findsVersion: 1, basesVersion: 0, objectsVersion: objects.version, creaturesVersion: creatures.version });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  const stub = { "/state": state(), "/finds": JSON.stringify(finds), "/bases": '{"version":0,"bases":[]}',
    "/objects": JSON.stringify(objects), "/creatures": JSON.stringify(creatures) }[u.pathname];
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
await page.waitForFunction(() => window.livemap?.objects?.data() && window.livemap.objects.creatures().length === 3, null, { timeout: 20000 });
const info = await page.evaluate(([s, g]) => {
  const pois = window.livemap.poiLayer;
  const data = window.livemap.objects;
  const chests = data.chests();
  // what the marker layer makes of each chest: looted when its sprite is the looted one
  return { chests, cats: [...document.querySelectorAll("#poiList label")].map(l => l.textContent.trim()).filter(t => /Unlocked|Locked &|Looted chests/.test(t)) };
}, [silver, gold]);
const silverPoi = pois.pois.indexOf(silver), goldPoi = pois.pois.indexOf(gold);
const bySilver = info.chests.find(c => c.poi === silverPoi), byGold = info.chests.find(c => c.poi === goldPoi);
check("the looted silver chest is keyed to its marker and looted", !!bySilver && bySilver.empty, JSON.stringify(bySilver));
check("the full gold chest is keyed and full", !!byGold && !byGold.empty, JSON.stringify(byGold));
check("categories: the looted chest outside the data, unlocked, closed", info.cats.some(t => /^Looted chests \(not in the data\)\s*1$/.test(t))
  && info.cats.some(t => /^Unlocked & opened\s*1$/.test(t)) && info.cats.some(t => /^Locked & closed\s*1$/.test(t)), info.cats.join(" | "));
// Hover over the silver chest: the tooltip says looted (server state), not "should be full again".
await page.evaluate(() => { const l = [...document.querySelectorAll("#poiList label")].find(l => /^Silver chests/.test(l.textContent.trim())); const i = l.querySelector("input"); if (!i.checked) i.click(); });
await page.evaluate(([x, z]) => window.livemap.map.setView([z, x], 1, { animate: false }), [silver[1], silver[3]]);
await page.waitForTimeout(600);
const pt = await page.evaluate(([x, z]) => { const p = window.livemap.map.latLngToContainerPoint([z, x]); const r = window.livemap.map.getContainer().getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; }, [silver[1], silver[3]]);
await page.mouse.move(pt[0] + 3, pt[1] + 3);
await page.mouse.move(pt[0], pt[1]);
await page.waitForTimeout(400);
const tip = await page.evaluate(() => document.querySelector(".leaflet-tooltip.poi-tip")?.textContent || "");
check("the silver chest's tooltip: looted by Aldra Vey, the server's state", /looted by Aldra Vey, seen .*server's own state/.test(tip) && !/full again/.test(tip), tip);
const cr = await page.evaluate(() => window.livemap.objects.creatures().map(c => c.text + " r" + c.r));
check("creatures with name, level and health; the boss large", cr.some(t => t === "Wolf · Lv 3 · 20/34 HP · fighting r5") && cr.some(t => t === "Bunny · Lv 1 · 19/19 HP r3")
  && cr.some(t => /^Fell Striker · Lv 12 · 5000\/8000 HP · fighting r8$/.test(t)), cr.join(" | "));
await page.evaluate(() => window.livemap.map.setView([1350, 3600], 0, { animate: false }));
await page.waitForTimeout(500);
const bossLabel = await page.evaluate(() => [...document.querySelectorAll(".leaflet-tooltip.player-label")].map(t => t.textContent).find(t => /5000\/8000/.test(t)) || "");
check("the boss carries its label on the map", !!bossLabel, bossLabel);
if (shot) await page.screenshot({ path: shot });
await page.evaluate(() => { const l = [...document.querySelectorAll("#poiList label")].find(l => /Creatures near players/.test(l.textContent)); l.querySelector("input").click(); });
await page.waitForTimeout(300);
const left = await page.evaluate(() => window.livemap.objects.creatures().length);
check("the Creatures switch removes them", left === 0, left + " left");
check("no page errors", !errors.length, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
