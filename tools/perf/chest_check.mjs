// Chest + weather switch check: the local web/ page with a server's live data, headless.
//   node tools/perf/chest_check.mjs <server url> <key> [refill minutes]
// Prints how many looted chests the page still shows as looted (in a base, waiting, refilled),
// then turns the "Rain and snow" switch off and on and checks the weather layer follows.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [upstream, key, refill] = process.argv.slice(2);
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
  if (["/state", "/finds", "/bases", "/discovered", "/explored"].includes(u.pathname)) {
    const s = await fetchText(u.pathname);
    res.writeHead(s ? 200 : 404, { "Content-Type": "application/json" }); res.end(s || ""); return;
  }
  if (u.pathname === "/maps.json" && refill !== undefined) {
    const m = JSON.parse(fs.readFileSync(path.join(web, "maps.json"), "utf8"));
    m.chestRefillMinutes = Number(refill);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(m)); return;
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
await page.waitForFunction(() => window.livemap && window.livemap.chests && window.livemap.chests().length > 0, null, { timeout: 20000 });
await page.waitForTimeout(2000);
const chests = await page.evaluate(() => window.livemap.chests());
const now = Date.now() / 1000;
const count = { base: 0, waiting: 0, refilled: 0 };
for (const c of chests) count[!c.state ? "refilled" : c.state.never ? "base" : "waiting"]++;
console.log("looted records", chests.length, JSON.stringify(count));
for (const c of chests.filter(c => c.state && !c.state.never).slice(0, 3))
  console.log("  waiting", Math.round((now - c.at) / 60), "min ago, refills in", c.state.left, "min");
const box = page.locator("label", { hasText: "Rain and snow" }).locator("input");
const layerOn = () => page.evaluate(() => !!document.querySelector("canvas.weather-layer"));
console.log("switch present", await box.count() === 1);
await box.evaluate(b => { b.checked = false; b.dispatchEvent(new Event("change")); });
const off = [await page.evaluate(() => localStorage.getItem("livemap.weather")), await layerOn()];
await page.waitForTimeout(4500);   // live states keep coming while the switch is off
await page.reload();                 // and a page opened with the switch already off
await page.waitForTimeout(6000);
await page.click("#poiToggle");
await box.evaluate(b => { b.checked = true; b.dispatchEvent(new Event("change")); });
const on = [await page.evaluate(() => localStorage.getItem("livemap.weather")), await layerOn()];
console.log("switch off -> stored, layer", off.join(" "), "| on ->", on.join(" "));
if (process.env.SHOT) {
  await page.click("#poiToggle");
  await page.waitForTimeout(500);
  await page.locator("#pois").screenshot({ path: process.env.SHOT });
}
console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no page errors");
await browser.close();
server.close();
