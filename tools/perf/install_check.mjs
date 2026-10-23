// Install check without a game server: serves an unpacked livemap folder (as the DLL would) with
// a stub /events stream and opens every map style headless.
//   node tools/perf/install_check.mjs <livemap folder> [index.html to use instead] [shot prefix]
// Prints per style how many tiles loaded and failed and the missing-tiles notice, if shown.
// A good install: every style loads tiles, no notice, no page errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const [dir, page0, shot] = process.argv.slice(2);
const types = { ".html": "text/html", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gz": "application/gzip" };
const state = JSON.stringify({ time: { raw: 36e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
  players: [], weather: null, findsVersion: 0, basesVersion: 0 });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    const t = setInterval(() => res.write("data: " + state + "\n\n"), 500);
    req.on("close", () => clearInterval(t));
    return;
  }
  const stub = { "/state": state, "/finds": '{"version":0,"ore":[],"chests":[]}', "/bases": '{"version":0,"bases":[]}' }[u.pathname];
  if (stub) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(stub); return; }
  const file = u.pathname === "/" ? (page0 || path.join(dir, "index.html")) : path.join(dir, decodeURIComponent(u.pathname));
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(d);
  });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const chrome = fs.readdirSync(root).filter(d => d.startsWith("chromium-")).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, chrome, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const maps = JSON.parse(fs.readFileSync(path.join(dir, "maps.json"), "utf8")).maps;
const errors = [];
for (const m of maps) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(name => { try { localStorage.setItem("livemap.style", name); } catch {} }, m.name);
  let ok = 0, bad = 0;
  page.on("response", r => { if (/\/tiles[^/]*\//.test(r.url())) r.status() === 200 ? ok++ : bad++; });
  await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x");
  await page.waitForTimeout(3000);
  const note = await page.evaluate(() => { const n = document.getElementById("tileNote"); return n && n.classList.contains("open") ? n.textContent : ""; });
  console.log(`${m.name}: tiles ok ${ok}, failed ${bad}${note ? " | notice: " + note : " | no notice"}`);
  if (shot) await page.screenshot({ path: shot + "-" + m.name.replace(/\W+/g, "_") + ".png" });
  await page.close();
}
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
server.close();
