// A full server on the page: 16 players (the game's maximum), with UTF-8, long and one empty
// name, headless, no game server.
//   node tools/perf/players_check.mjs [screenshot.png]
// Passes when the list has a row and the map a marker with the right label for every player,
// the empty name reads "Player <entity>", every player has a colour of their own, and there are
// no page errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shot = process.argv[2];
const web = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "web");
const names = ["OG Vanilla K", "Headshootz4Daze", "Özgür", "Şevê Kurd", "東京の旅人", "a🔥b", "SS Kommandozentrale",
  "FindOnePiece", "Cybertonic", "", "Nightwind416", "laborhexe", "Nipsarefroze", "Dox023", "BeMeTV",
  "a name of thirty-two characters!"];
const players = names.map((name, i) => ({ entity: 2 + i, name, pos: [3200 + (i % 4) * 260, 120, 3600 + Math.floor(i / 4) * 260], rot: [0, 0, 0, 1], ageMs: 10 }));
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
await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x");
await page.waitForFunction(n => document.querySelectorAll("#playerList li:not(.empty):not(.placeholder)").length === n, players.length, { timeout: 20000 }).catch(() => {});
await page.evaluate(() => window.livemap.map.setView([4000, 3600], -1, { animate: false }));
await page.waitForTimeout(1200);
const seen = await page.evaluate(() => ({
  rows: [...document.querySelectorAll("#playerList li .name")].map(e => e.textContent),
  colours: [...document.querySelectorAll("#playerList li .dot")].map(e => e.style.background),
  labels: [...document.querySelectorAll(".player-label")].map(e => e.textContent),
}));
const want = players.map(p => p.name || "Player " + p.entity);
const results = [];
const check = (label, pass, detail) => { results.push(pass); console.log((pass ? "PASS " : "FAIL ") + label + " (" + detail + ")"); };
check("a row for every player, with the right name", JSON.stringify(seen.rows) === JSON.stringify(want), `${seen.rows.length} rows`);
check("a marker label for every player", want.every(n => seen.labels.includes(n)) && seen.labels.length === want.length, `${seen.labels.length} labels`);
check("an empty name reads Player <entity>", seen.rows.includes("Player 11"), "entity 11");
check("a colour of their own for each of the 16", new Set(seen.colours).size === players.length, `${new Set(seen.colours).size} colours`);
if (shot) await page.screenshot({ path: shot });
check("no page errors", !errors.length, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
