// Screenshots for the Nexus page: the local web/ folder (page, tiles, icons, pois) with live
// state, weather and finds from a running server, 1920 x 951 like a browser window.
//   node tools/perf/nexus_shots.mjs <server url> <key> <out dir>
// The 4th shot shows a player: if nobody is online it places one at STAGED_PLAYER (a spot a
// tester really stood on, 22.10.2026); everything else in the shots is the server's real data.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [upstream, key, outDir] = process.argv.slice(2);
if (!upstream || !key || !outDir) { console.error("usage: node nexus_shots.mjs <server url> <key> <out dir>"); process.exit(2); }
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const STAGED_PLAYER = { entity: 7, name: "OG Vanilla K", pos: [3753, 843, 1421], rot: [0, 0.2588, 0, 0.9659], ageMs: 20 };
const W = 1920, H = 951;

let upstreamState = null, stagePlayer = false;
async function pollUpstream() {
  try { const r = await fetch(upstream + "/state?key=" + key); if (r.ok) upstreamState = await r.json(); } catch {}
}
await pollUpstream();
if (!upstreamState) { console.error("no /state from " + upstream); process.exit(1); }
const poller = setInterval(pollUpstream, 1000);
const state = () => {
  const s = JSON.parse(JSON.stringify(upstreamState));
  if (stagePlayer && !s.players.length) s.players = [STAGED_PLAYER];
  return JSON.stringify(s);
};
const types = { ".html": "text/html", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".gz": "application/gzip" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  if (u.pathname === "/state") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(state()); return; }
  if (u.pathname === "/finds") {
    const r = await fetch(upstream + "/finds?key=" + key).catch(() => null);
    res.writeHead(r && r.ok ? 200 : 502, { "Content-Type": "application/json" });
    res.end(r && r.ok ? await r.text() : "{}");
    return;
  }
  const file = path.join(web, u.pathname === "/" ? "index.html" : u.pathname);
  if (!file.startsWith(web)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port + "/?key=" + key;

const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const dir = fs.readdirSync(root).filter(d => d.startsWith("chromium-")).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, dir, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const pois = JSON.parse(fs.readFileSync(path.join(web, "pois.json"), "utf8"));
const catIndex = Object.fromEntries(pois.categories.map((c, i) => [c.id, i]));
const findPoi = (cat, re) => pois.pois.find(p => p[0] === catIndex[cat] && re.test(p[4]));
fs.mkdirSync(outDir, { recursive: true });

// prefs: {category: shown}; view: [z, x, zoom]; then() runs in the page context before the shot
async function shot(name, { prefs = {}, view, panel = false, scroll = 0, hover = null, mark = [] }) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript(p => { localStorage.clear(); localStorage.setItem("livemap.pois", JSON.stringify(p)); }, prefs);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => window.livemap && document.querySelectorAll("#poiList label").length > 10, null, { timeout: 20000 });
  await page.evaluate(([z, x, zoom]) => window.livemap.map.setView([z, x], zoom, { animate: false }), view);
  if (panel) await page.click("#poiToggle");
  if (scroll) await page.evaluate(s => { document.getElementById("pois").scrollTop = s; document.getElementById("poiList").scrollTop = s; }, scroll);
  await page.waitForTimeout(3500);   // tiles, icons, a few state updates
  await page.evaluate(() => window.livemap.poiLayer._draw && window.livemap.poiLayer._draw());
  if (hover) {
    const pt = await page.evaluate(([at, away]) => {
      const m = window.livemap.map, p = m.latLngToContainerPoint(at);
      if (!away) return [p.x, p.y];
      const q = m.latLngToContainerPoint(away), d = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      return [p.x + (p.x - q.x) / d * 12, p.y + (p.y - q.y) / d * 12];
    }, Array.isArray(hover[0]) ? hover : [hover, null]);
    const box = await page.locator("#map").boundingBox();
    await page.mouse.move(box.x + pt[0] - 30, box.y + pt[1] + 20);
    await page.mouse.move(box.x + pt[0], box.y + pt[1], { steps: 5 });
    await page.waitForTimeout(500);
  }
  // Green marks like the hand-made screenshots: a frame around an element and an arrow to a point.
  for (const m of mark) {
    await page.evaluate(m => {
      const layer = document.body.appendChild(Object.assign(document.createElement("div"), { style: "position:fixed;inset:0;pointer-events:none;z-index:5000" }));
      if (m.frame) {
        const el = [...document.querySelectorAll(m.frame.selector)].find(e => !m.frame.text || e.textContent.includes(m.frame.text));
        const r = el.getBoundingClientRect(), pad = 4;
        layer.insertAdjacentHTML("beforeend", `<div style="position:fixed;left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + 2 * pad}px;height:${r.height + 2 * pad}px;border:3px solid #2ee86a;border-radius:4px"></div>`);
      }
      if (m.arrow) {
        const p = window.livemap.map.latLngToContainerPoint([m.arrow.to[0], m.arrow.to[1]]);
        const mr = document.getElementById("map").getBoundingClientRect();
        const x2 = mr.left + p.x + m.arrow.gap[0], y2 = mr.top + p.y + m.arrow.gap[1], x1 = x2 + m.arrow.from[0], y1 = y2 + m.arrow.from[1];
        const a = Math.atan2(y2 - y1, x2 - x1), h = 16;
        const pts = [[x2, y2], [x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45)], [x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45)]];
        layer.insertAdjacentHTML("beforeend", `<svg width="100%" height="100%" style="position:fixed;inset:0"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2ee86a" stroke-width="4" stroke-linecap="round"/><polygon points="${pts.map(q => q.join(",")).join(" ")}" fill="#2ee86a"/></svg>`);
      }
    }, m);
  }
  const file = path.join(outDir, name + ".jpg");
  await page.screenshot({ path: file, type: "jpeg", quality: 90 });
  console.log((errors.length ? "ERRORS " + errors.join(" | ") + " " : "") + file);
  await ctx.close();
}

const ore = await (await fetch(upstream + "/finds?key=" + key)).json();
const flint = ore.ore[0];
const capital = findPoi("spire", /Capital/) || findPoi("spire", /./);
const few = { spire: true, fasttravel: true, shrine: true, well: false, town: false, dungeon: false, nighttemple: false, crypt: false,
  vault: false, cave: false, mine: false, gemforge: false, obelisk: false, grave: false, fognest: false, enemycamp: false,
  bossunlock: false, camp: false, farm: false, questarea: false, chest_gold: false, chest_silver: false, chest_wood: false,
  sarcophagus: false, fishing: false };

await shot("01-world-map-weather", { prefs: few, view: [5050, 5350, -3.3] });
await shot("02-markers-panel", { prefs: {}, view: [capital[3] - 200, capital[1] - 700, -1.8], panel: true,
  hover: [capital[3], capital[1]] });
await shot("03-finds-ore", { prefs: { ...few, chest_wood: true, chest_silver: true, chest_gold: true }, view: [flint.z + 40, flint.x + 260, -0.6],
  panel: true, scroll: 4000, hover: [flint.z, flint.x],
  mark: [{ frame: { selector: "#poiList label", text: "Flint" } }] });
stagePlayer = true;
await shot("04-player-online", { prefs: { ...few, town: true, dungeon: true, cave: true, mine: true, gemforge: true, obelisk: true },
  view: [STAGED_PLAYER.pos[2] + 1200, STAGED_PLAYER.pos[0] + 1700, -2.2], panel: true,
  mark: [{ frame: { selector: "#playerList li", text: STAGED_PLAYER.name } },
         { arrow: { to: [STAGED_PLAYER.pos[2], STAGED_PLAYER.pos[0]], from: [-150, 150], gap: [-14, 14] } }] });

await browser.close();
clearInterval(poller);
server.close();
