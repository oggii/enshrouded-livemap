// Death counts in the player list without a game server: web/ with stub data, headless.
//   node tools/perf/deaths_check.mjs [screenshot.png]
// Passes when Brom's row shows "☠ 2" with the causes in its title, Aldra Vey (no deaths) shows
// nothing, a new deathsVersion makes the page fetch /deaths again and the row follows (3), and
// there are no page errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shot = process.argv[2];
const web = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "web");
const players = [{ entity: 3, name: "Aldra Vey", pos: [3560, 140, 4380], rot: [0, 0, 0, 1], ageMs: 10 }, { entity: 4, name: "Brom", pos: [3700, 120, 4250], rot: [0, 0, 0, 1], ageMs: 10 }];
const now = Math.floor(Date.now() / 1000);
let deaths = { version: 2, players: { Brom: { count: 2, causes: [0, 1, 1, 0], at: now - 600 } }, recent: [] };
let fetches = 0;
const state = () => JSON.stringify({ time: { raw: 52e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 }, players, weather: null, findsVersion: 0, basesVersion: 0, deathsVersion: deaths.version });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  if (u.pathname === "/deaths") fetches++;
  const stub = { "/state": state(), "/finds": '{"version":0,"ore":[],"chests":[]}', "/bases": '{"version":0,"bases":[]}', "/deaths": JSON.stringify(deaths) }[u.pathname];
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
const row = name => page.evaluate(name => {
  const li = [...document.querySelectorAll("#playerList li")].find(l => l.querySelector(".name")?.textContent === name);
  const d = li && li.querySelector(".deaths");
  return d ? { text: d.textContent, title: d.title, shown: getComputedStyle(d).display !== "none" } : null;
}, name);
await page.waitForFunction(() => [...document.querySelectorAll("#playerList .deaths")].some(d => d.textContent), null, { timeout: 20000 });
const brom = await row("Brom");
check("Brom shows his two deaths", brom && brom.shown && brom.text === "☠︎2", JSON.stringify(brom));
check("the title names the causes and when", brom && brom.title === "2 deaths: 1 fell, 1 shroud · last 10 min ago", brom && brom.title);
const aldra = await row("Aldra Vey");
check("Aldra Vey (no deaths) shows nothing", aldra && !aldra.shown && aldra.text === "", JSON.stringify(aldra));
if (shot) await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 520, height: 260 } });
const before = fetches;
deaths = { version: 3, players: { Brom: { count: 3, causes: [1, 1, 1, 0], at: now } }, recent: [] };
await page.waitForFunction(() => [...document.querySelectorAll("#playerList .deaths")].some(d => d.textContent.endsWith("3")), null, { timeout: 5000 }).catch(() => {});
const after = await row("Brom");
check("a new deathsVersion is fetched and shown", fetches > before && after && after.text.endsWith("3") && /1 killed/.test(after.title), `${fetches - before} fetch(es), ${JSON.stringify(after)}`);
check("no page errors", !errors.length, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
