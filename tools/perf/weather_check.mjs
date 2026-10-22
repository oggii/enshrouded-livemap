// Weather check: the local web/ page with a server's live state (weather zones, players), headless.
//   node tools/perf/weather_check.mjs <server url> <key> [screenshot.png]
// Prints per player what the page says (label, rain/snow weights), the zones, how long one
// raster update takes, and page errors. The in-game check is the real judge; this one makes sure
// the page computes and draws without errors or long tasks.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [upstream, key, shot] = process.argv.slice(2);
const web = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "web");
const fetchText = async p => { const r = await fetch(upstream + p + (p.includes("?") ? "&" : "?") + "key=" + key); return r.ok ? r.text() : null; };
const types = { ".html": "text/html", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = async () => { const s = await fetchText("/state"); if (s) res.write("data: " + s + "\n\n"); };
    send(); const t = setInterval(send, 1000); req.on("close", () => clearInterval(t)); return;
  }
  if (["/state", "/finds", "/bases"].includes(u.pathname)) {
    const s = await fetchText(u.pathname);
    res.writeHead(s ? 200 : 404, { "Content-Type": "application/json" }); res.end(s || ""); return;
  }
  const file = path.join(web, u.pathname === "/" ? "index.html" : u.pathname);
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(d); } });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const dir = fs.readdirSync(root).filter(d => d.startsWith("chromium-")).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, dir, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://127.0.0.1:" + server.address().port + "/?key=" + key);
await page.waitForFunction(() => window.livemap && document.getElementById("weather").textContent !== "–", null, { timeout: 20000 });
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const L = window.livemap, w = L.weather;
  const s = w.state();
  const t0 = performance.now(); w.forceUpdate(); const ms = performance.now() - t0;
  const players = s.players.filter(p => p.pos).map(p => {
    const wt = w.weights(p.pos);
    return { name: p.name, pos: p.pos.map(v => Math.round(v)), label: w.label(p.pos), rain: +wt.rain.toFixed(2), snow: +wt.snow.toFixed(2) };
  });
  const zones = s.weather.instances.map(z => ({ layer: z.layer, phenomenon: z.phenomenon, radius: z.radius, minutesLeft: +((z.despawnTime - s.weather.worldTime) / 60).toFixed(1) }));
  return { header: document.getElementById("weather").textContent, players, zones, updateMs: +ms.toFixed(1) };
});
console.log(JSON.stringify(info, null, 1));
if (shot) {
  await page.evaluate(() => window.livemap.map.setView([5000, 5300], -3.2, { animate: false }));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: shot });
}
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
server.close();
