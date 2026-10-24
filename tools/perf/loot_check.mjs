// "Where do I get it?" in the search, without a game server: web/ (with loot.json) and a stub
// player, headless.
//   node tools/perf/loot_check.mjs [screenshot.png]
// Passes when "animal fur" finds the item with its best source, Enter lists its sources with a
// chance each, choosing a source with places rings all of them and flies to the nearest one (the
// one the list names), a source without places names its regions, Escape clears the rings, and
// there are no page errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shot = process.argv[2];
const web = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "web");
const loot = JSON.parse(fs.readFileSync(path.join(web, "loot.json"), "utf8"));
const players = [{ entity: 4, name: "Brom", pos: [3700, 120, 4250], rot: [0, 0, 0, 1], ageMs: 10 }];
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
await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x&follow=Brom");
await page.waitForFunction(() => window.livemap?.search && window.livemap.search.me() === "Brom", null, { timeout: 20000 });
await page.focus("#searchBox");
await page.waitForFunction(() => window.livemap.search.loot(), null, { timeout: 20000 });
await page.fill("#searchBox", "animal fur");
await page.waitForTimeout(300);
const found = await page.evaluate(() => ({ names: window.livemap.search.find("animal fur"), meta: window.livemap.search.meta() }));
check("'animal fur' finds the item with its best source", found.names[0] === "Animal Fur · Item" && /^best: .+, (always|[\d.]+ %)/.test(found.meta[0]), found.names[0] + " | " + found.meta[0]);
await page.press("#searchBox", "Enter");
await page.waitForTimeout(300);
const list = await page.evaluate(() => ({ head: document.querySelector("#searchResults li.head")?.textContent,
  rows: [...document.querySelectorAll("#searchResults li[data-i]")].map(li => li.innerText.replace(/\n/g, " | ")) }));
const item = loot.items.find(i => i[1] === "Animal Fur");
check("Enter lists where to get it, with a chance per source", list.head === "Where to get Animal Fur" && list.rows.length === item[2].length
  && list.rows.every(r => /(always|[\d.]+ %)/.test(r)), list.rows.slice(0, 3).join(" || "));
// A source with places: ring them all and fly to the nearest.
// (the list puts about equally likely sources nearest first, so find the row by its name)
const withPlaces = list.rows.findIndex(r => / places? · nearest /.test(r));
const group = item[2].map(([g]) => loot.groups[g]).find(g => g[4] && g[0] === list.rows[withPlaces].split(" | ")[0]);
let nearest = null;
for (let i = 0; i < group[4].length; i += 2) {
  const d = Math.hypot(group[4][i] - 3700, group[4][i + 1] - 4250);
  if (!nearest || d < nearest.d) nearest = { d, x: group[4][i], z: group[4][i + 1] };
}
await page.evaluate(i => { const li = document.querySelector('#searchResults li[data-i="' + i + '"]'); li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); }, withPlaces);
await page.waitForTimeout(1200);
const after = await page.evaluate(() => { const c = window.livemap.map.getCenter(); return { ringed: window.livemap.search.ringed(), x: c.lng, z: c.lat }; });
check("a source with places rings all of them and flies to the nearest", after.ringed === group[2] && Math.hypot(after.x - nearest.x, after.z - nearest.z) < 30,
  `${group[0]}: ${after.ringed} of ${group[2]} ringed, ${Math.hypot(after.x - nearest.x, after.z - nearest.z).toFixed(0)} m from the nearest (${nearest.d.toFixed(0)} m from Brom)`);
const row = list.rows[withPlaces];
const km = row.match(/nearest ([\d.]+) (m|km)/);
const said = km ? +km[1] * (km[2] === "km" ? 1000 : 1) : NaN;
check("the list names that nearest distance", Math.abs(said - nearest.d) <= Math.max(15, nearest.d * 0.06), row);
if (shot) await page.screenshot({ path: shot });
// A source without places (plants, scatter loot) names its regions instead.
const twig = loot.items.find(i => i[2].some(([g]) => !loot.groups[g][4] && loot.groups[g][3]));
await page.evaluate(n => { const b = document.getElementById("searchBox"); b.value = n; b.dispatchEvent(new Event("input")); }, twig[1]);
await page.waitForTimeout(200);
await page.evaluate(n => { const hits = window.livemap.search.find(n); return hits; }, twig[1]);
await page.press("#searchBox", "Enter");
await page.waitForTimeout(300);
const rows2 = await page.evaluate(() => [...document.querySelectorAll("#searchResults li[data-i]")].map(li => li.innerText.replace(/\n/g, " | ")));
check("a source without places names its regions", rows2.some(r => /found in /.test(r)), twig[1] + ": " + rows2.find(r => /found in /.test(r)));
await page.press("#searchBox", "Escape");
const cleared = await page.evaluate(() => window.livemap.search.ringed());
check("Escape clears the rings", cleared === 0, cleared + " left");
check("no page errors", !errors.length, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
