// Follow check without a game server: serves web/ with a stub /events stream of two players who
// walk (Alice east, Bob north), headless.
//   node tools/perf/follow_check.mjs [screenshot.png]
// Passes when: &follow=Bob keeps Bob in the middle while he walks; a click on Alice's row
// switches to her; a second click stops; dragging the map stops; Bob's relog (new entity) is
// followed again by name; no page errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shot = process.argv[2];
const web = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "web");
const t0 = Date.now();
let bobEntity = 2;
const players = () => {
  const s = (Date.now() - t0) / 1000;
  return [
    { entity: 1, name: "Alice", pos: [3000 + 8 * s, 800, 3000], rot: [0, 0, 0, 1], ageMs: 10 },
    { entity: bobEntity, name: "Bob", pos: [6000, 800, 5000 + 8 * s], rot: [0, 0, 0, 1], ageMs: 10 },
  ];
};
const state = () => JSON.stringify({ time: { raw: 36e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
  players: players(), weather: null, findsVersion: 0, basesVersion: 0 });
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
const chrome = fs.readdirSync(root).filter(d => d.startsWith("chromium-")).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, chrome, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x&follow=Bob");
await page.waitForFunction(() => document.querySelectorAll("#playerList li .name").length === 2, null, { timeout: 15000 });

// Distance in metres between the map centre and a player now.
const off = name => page.evaluate(n => {
  const c = window.livemap.map.getCenter();
  const s = [...document.querySelectorAll("#playerList li")].find(li => li.querySelector(".name").textContent === n);
  const [x, z] = s.querySelector(".coords").textContent.split(",").map(v => parseFloat(v));
  return Math.round(Math.hypot(c.lng - x, c.lat - z));
}, name);
const following = () => page.evaluate(() => [...document.querySelectorAll("#playerList li.following .name")].map(e => e.textContent).join(","));
const results = [];
const check = (label, pass, detail) => { results.push(pass); console.log((pass ? "PASS " : "FAIL ") + label + " (" + detail + ")"); };

await page.waitForTimeout(3000);
let d = await off("Bob");
check("&follow=Bob keeps Bob in the middle while he walks", d <= 25 && (await following()) === "Bob", `${d} m off, following ${await following()}`);
const row = n => page.locator("#playerList li", { has: page.locator(".name", { hasText: n }) });
await row("Alice").click();
await page.waitForTimeout(2500);
d = await off("Alice");
check("click on Alice follows her", d <= 25 && (await following()) === "Alice", `${d} m off, following ${await following()}`);
await row("Alice").click();
await page.waitForTimeout(2500);
d = await off("Alice");
check("second click stops", (await following()) === "" && d > 15, `${d} m behind after 2.5 s, following "${await following()}"`);
await row("Alice").click();
await page.waitForTimeout(800);
await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(400, 300, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(2500);
check("dragging the map stops", (await following()) === "", `following "${await following()}"`);
await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x&follow=Bob");
await page.waitForTimeout(2000);
bobEntity = 7;   // Bob relogs: new entity, same name
await page.waitForTimeout(3000);
d = await off("Bob");
check("Bob's relog is followed again by name", d <= 25 && (await following()) === "Bob", `${d} m off, following ${await following()}`);
if (shot) await page.screenshot({ path: shot });
check("no page errors", errors.length === 0, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
