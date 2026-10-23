// Gallery pictures for Nexus: the real page and map with sample players, finds and altars
// (stub data, no game server), each with gold callouts that point at what it shows.
//   node tools/perf/promo_shots.mjs <out dir> <shroud points.json> [--hd]
// Writes NN-name.jpg at 1920 x 1080 and titles.json ({file: title}) for `nexus image-add`.
// --hd: the pictures with the optional HD map style instead (package/hd/maps.json, the tiles
// from local-maps/tiles-hd, which only the maintainer has).
// shroud points.json: {"<level>": {"x": .., "z": ..}} as for shroud_check.mjs.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [outDir, shroudPointsFile] = process.argv.slice(2);
const hd = process.argv.includes("--hd");
const repo = path.join(here, "../..");
const web = path.join(here, "../..", "web");
fs.mkdirSync(outDir, { recursive: true });
const weather = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "weather-sample.json"), "utf8"));
const shroudPoints = JSON.parse(fs.readFileSync(shroudPointsFile, "utf8"));
const pois = JSON.parse(fs.readFileSync(path.join(web, "pois.json"), "utf8"));
const now = Math.floor(Date.now() / 1000);

// Sample world: three players near Revelwood, a trail Aldra explored, finds and two altars.
const yaw = deg => { const a = deg * Math.PI / 180; return [0, Math.sin(a / 2), 0, Math.cos(a / 2)]; };
const players = [
  { entity: 3, name: "Aldra Vey", pos: [3560, 140, 4380], rot: yaw(40), ageMs: 10 },
  { entity: 4, name: "Brom", pos: [3700, 120, 4250], rot: yaw(-70), ageMs: 10 },
  { entity: 5, name: "Kesh", pos: [3880, 130, 4420], rot: yaw(160), ageMs: 10 },
];
const N = 512, CELL = 20, bits = new Uint8Array(N * N / 8);
const reveal = (x, z) => {
  for (let row = Math.floor((z - 300) / CELL); row <= Math.ceil((z + 300) / CELL); row++)
    for (let col = Math.floor((x - 300) / CELL); col <= Math.ceil((x + 300) / CELL); col++) {
      if (row < 0 || col < 0 || row >= N || col >= N || Math.hypot((col + 0.5) * CELL - x, (row + 0.5) * CELL - z) > 300) continue;
      const i = row * N + col; bits[i >> 3] |= 1 << (i & 7);
    }
};
for (let t = 0; t <= 1; t += 0.02) { reveal(2700 + t * 860, 3800 + t * 580 + Math.sin(t * 9) * 160); reveal(3560 + t * 500, 4380 - t * 420); }
const keys = Object.entries(pois.discoveryKeys);
const nearKeys = keys.filter(([i]) => { const p = pois.pois[+i]; return Math.hypot(p[1] - 3400, p[3] - 4100) < 900; }).map(([, k]) => k);
const explored = JSON.stringify({ version: 2, cells: N, cellMetres: CELL, players: { "Aldra Vey": Buffer.from(bits).toString("base64") } });
const discovered = JSON.stringify({ version: 5, players: { "Aldra Vey": { online: true, at: now, keys: nearKeys },
  Brom: { online: true, at: now, keys: nearKeys.slice(0, 4) }, Kesh: { online: true, at: now, keys: [] } } });
const ore = (x, z, sort, hits, by) => ({ x, y: 120, z, sort, xp: 0, hits, first: now - 3600, last: now - 300, by });
const finds = JSON.stringify({ version: 1, ore: [
  ore(3520, 4300, "Material_T2_Ore_Copper", 9, ["Aldra Vey"]), ore(3655, 4185, "Material_T4_Ore_Iron", 4, ["Brom"]),
  ore(3770, 4465, "Material_T2_Clay", 12, ["Kesh", "Aldra Vey"]), ore(3940, 4345, "Material_T4_Sulfur", 6, ["Kesh"]),
  ore(3450, 4455, "Material_T1_Stone_Flint", 3, ["Aldra Vey"])],
  chests: [{ x: 3592.8, y: 120, z: 4432.2, poi: null, rl: true, by: "Aldra Vey", at: now - 8 * 60 },
    { x: 3548.0, y: 120, z: 4370.0, poi: null, rl: true, by: "Brom", at: now - 21 * 60 },
    { x: 3601.5, y: 120, z: 4412.5, poi: null, rl: true, by: "Kesh", at: now - 3 * 60 }] });
const bases = JSON.stringify({ version: 1, bases: [{ x: 3720, y: 120, z: 4330, size: [40, 30, 40], abandoned: false },
  { x: 3330, y: 120, z: 3980, size: [80, 40, 80], abandoned: false }] });
const state = () => JSON.stringify({ time: { raw: 61e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
  players, weather, findsVersion: 1, basesVersion: 1, flameLevel: 3, discoveredVersion: 5, exploredVersion: 2 });

const types = { ".html": "text/html", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  const stub = { "/state": state(), "/finds": finds, "/bases": bases, "/discovered": discovered, "/explored": explored }[u.pathname];
  if (stub) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(stub); return; }
  const rel = decodeURIComponent(u.pathname);
  const file = hd && rel === "/maps.json" ? path.join(repo, "package", "hd", "maps.json")
    : hd && rel.startsWith("/tiles-hd/") ? path.join(repo, "local-maps", rel)
    : path.join(web, rel === "/" ? "index.html" : rel);
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(d); } });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const chrome = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
const browser = await chromium.launch({ executablePath: path.join(root, chrome, "chrome-win64", "chrome.exe") });

// One raw screenshot of the page; `prep` runs in the page and returns callout targets in pixels.
async function raw(w, h, storage, view, prep) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(s => { try { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch {} }, storage);
  await page.goto(base + "/?key=x");
  await page.waitForFunction(() => window.livemap?.discovered?.exp() && window.livemap.weather.state()?.players?.length && window.livemap.discovered.regions(), null, { timeout: 30000 });
  await page.evaluate(v => window.livemap.map.setView([v[1], v[0]], v[2], { animate: false }), view);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  const targets = prep ? await prep(page) : {};
  await page.waitForTimeout(900);
  const png = await page.screenshot();
  await page.close();
  return { png, targets };
}
const worldPx = (page, x, z) => page.evaluate(([x, z]) => { const p = window.livemap.map.latLngToContainerPoint([z, x]); return [p.x, p.y]; }, [x, z]);
const elPx = (page, sel, where = "left") => page.evaluate(([s, where]) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return where === "left" ? [r.left, r.top + r.height / 2] : where === "right" ? [r.right, r.top + r.height / 2] : where === "bottom" ? [r.left + r.width / 2, r.bottom] : [r.left + r.width / 2, r.top];
}, [sel, where]);

// The picture with callouts: label boxes in the page's own style, a gold line to a diamond on the target.
async function compose(name, title, shot, callouts, inset) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(base + "/fonts/OFL.txt");   // same origin for the font
  const html = `<!doctype html><html><head><style>
    @font-face { font-family: Alegreya; src: url("${base}/fonts/alegreya-latin.woff2") format("woff2"); font-weight: 400 900; }
    html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #120f18; font-family: Alegreya, Georgia, serif; }
    .shot { position: absolute; inset: 0; width: 1920px; height: 1080px; }
    svg { position: absolute; inset: 0; }
    .c { position: absolute; background: rgba(18, 14, 25, 0.95); border: 1px solid #b8964e; padding: 9px 16px 10px; color: #f6ead0;
      font-size: 23px; font-weight: 600; line-height: 1.2; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.6); max-width: 470px; }
    .c b { display: block; font-size: 13px; letter-spacing: 0.2em; color: #e8c477; margin-bottom: 2px; }
    .c.new { border-color: #e8c477; box-shadow: 0 0 0 1px rgba(232, 196, 119, 0.35), 0 10px 28px rgba(0, 0, 0, 0.6); }
    .phone { position: absolute; border-radius: 38px; border: 10px solid #0b090f; box-shadow: 0 0 0 2px #8f713a, 0 24px 60px rgba(0, 0, 0, 0.7); overflow: hidden; }
    .phone img { display: block; }
  </style></head><body>
    <img class="shot" src="data:image/png;base64,${shot.png.toString("base64")}">
    ${inset ? `<div class="phone" style="left:${inset.x}px;top:${inset.y}px"><img src="data:image/png;base64,${inset.png.toString("base64")}" style="width:${inset.w}px"></div>` : ""}
    <svg width="1920" height="1080"></svg>
  </body></html>`;
  await page.setContent(html);
  await page.evaluate(() => document.fonts.load("600 23px Alegreya"));
  await page.evaluate(cs => {
    const svg = document.querySelector("svg"), ns = "http://www.w3.org/2000/svg";
    for (const c of cs) {
      const el = document.createElement("div");
      el.className = "c" + (c.isNew ? " new" : "");
      el.innerHTML = (c.isNew ? "<b>NEW</b>" : c.tag ? "<b>" + c.tag + "</b>" : "") + c.text;
      el.style.left = c.at[0] + "px"; el.style.top = c.at[1] + "px";
      document.body.appendChild(el);
      if (!c.to) continue;
      const r = el.getBoundingClientRect(), [tx, ty] = c.to;
      // from the label edge that faces the target
      const sx = tx < r.left ? r.left : tx > r.right ? r.right : r.left + r.width / 2;
      const sy = tx >= r.left && tx <= r.right ? (ty < r.top ? r.top : r.bottom) : r.top + r.height / 2;
      const line = document.createElementNS(ns, "line");
      Object.entries({ x1: sx, y1: sy, x2: tx, y2: ty, stroke: "#e8c477", "stroke-width": 2 }).forEach(([k, v]) => line.setAttribute(k, v));
      line.setAttribute("filter", "drop-shadow(0 0 2px #000)");
      svg.appendChild(line);
      const d = document.createElementNS(ns, "rect");
      Object.entries({ x: tx - 6, y: ty - 6, width: 12, height: 12, fill: "#e8c477", stroke: "#1a1208", "stroke-width": 1.5, transform: `rotate(45 ${tx} ${ty})` }).forEach(([k, v]) => d.setAttribute(k, v));
      svg.appendChild(d);
    }
  }, callouts);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, name + ".jpg"), type: "jpeg", quality: 88 });
  await page.close();
  titles[name + ".jpg"] = title;
}
const titles = {};
const allCats = JSON.stringify(Object.fromEntries(pois.categories.map(c => [c.id, true])));

if (!hd) {
// 1. Overview: the game's look and region names.
{
  const s = await raw(1920, 1080, {}, [5600, 5050, -3.05], async page => ({
    region: await worldPx(page, 3830, 3646), clock: await elPx(page, "#clock", "left"), compass: await elPx(page, "#compass", "left"),
    players: await elPx(page, "#players", "right") }));
  await compose("01-overview", "1.7: the game's own map-screen look, with its region names", s, [
    { isNew: true, text: "Region names, as on the game's own map", at: [120, 820], to: [s.targets.region[0] - 140, s.targets.region[1] + 30] },
    { isNew: true, text: "The game's own look: gold frames, separators and type", at: [1190, 300], to: s.targets.clock },
    { isNew: true, text: "Compass rose and a scale in metres", at: [1200, 995], to: s.targets.compass },
    { text: "Who is online, live", at: [400, 60], to: s.targets.players },
  ]);
}
// 2. Players, following, weather, clay.
{
  const s = await raw(1920, 1080, { "livemap.pois": allCats }, [3700, 4330, -0.6], async page => {
    await page.evaluate(() => [...document.querySelectorAll("#playerList li")].find(li => /Brom/.test(li.textContent)).click());
    await page.waitForTimeout(600);
    return { kesh: await worldPx(page, 3880, 4420), row: await elPx(page, "#playerList li.following .name", "right"),
      rain: await worldPx(page, 3300, 4700), clay: await worldPx(page, 3770, 4465) };
  });
  await compose("02-players", "Players live with their walking direction; click a name to follow", s, [
    { isNew: true, text: "Each player's arrow in their own colour", at: [1250, 170], to: [s.targets.kesh[0] + 6, s.targets.kesh[1] - 6] },
    { text: "Click a name to follow that player", at: [420, 150], to: s.targets.row },
    { text: "Rain and snow exactly where they fall", at: [240, 640], to: s.targets.rain },
    { isNew: true, text: "Ore map fills itself, now with clay", at: [1180, 820], to: s.targets.clay },
  ]);
}
// 3. Fog of war and the Discovered filter.
{
  const s = await raw(1920, 1080, { "livemap.fog": "1", "livemap.discBy": "Aldra Vey", "livemap.discMode": "known" }, [3500, 4120, -1.55], async page => {
    await page.click("#poiToggle");
    await page.waitForTimeout(500);
    return { edge: await worldPx(page, 3300, 3520), disc: await elPx(page, "#discBy", "right") };
  });
  await compose("03-fog-discovered", "Fog of war and discovered places, per player", s, [
    { text: "Fog of war: clears live as the player moves, with a soft edge", at: [1040, 840], to: s.targets.edge },
    { text: "Discovered or not yet, by anyone or by one player", at: [470, 470], to: s.targets.disc },
  ]);
}
// 4. Deadly shroud.
{
  const pt = shroudPoints["5"] || shroudPoints["4"] || Object.values(shroudPoints)[0];
  const s = await raw(1920, 1080, {}, [pt.x, pt.z, -1.2], async page => {
    const p = await worldPx(page, pt.x, pt.z);
    await page.mouse.move(p[0], p[1]);
    await page.waitForTimeout(400);
    const flame = await page.evaluate(() => { const c = document.querySelector("#clock").getBoundingClientRect(), f = document.querySelector("#flameLevel").getBoundingClientRect();
      return [c.left + 2, f.top + f.height / 2]; });
    return { zone: p, flame };
  });
  await compose("04-deadly-shroud", "Deadly shroud: the zones above your world's Flame level", s, [
    { text: "Shroud above your Flame level, drawn as in the game; hover for its level", at: [150, 330], to: [s.targets.zone[0] - 4, s.targets.zone[1] + 6] },
    { text: "Flame level straight from the server", at: [1200, 330], to: s.targets.flame },
  ]);
}
// 5. Finds: ore, looted chests, altars.
{
  const s = await raw(1920, 1080, { "livemap.pois": allCats }, [3640, 4360, 0.6], async page => {
    const clay = await worldPx(page, 3770, 4465);
    await page.mouse.move(clay[0], clay[1]);
    await page.waitForTimeout(400);
    return { clay, chest: await worldPx(page, 3601.5, 4412.5), altar: await worldPx(page, 3720, 4330) };
  });
  await compose("05-finds", "Ore veins, looted chests and Flame Altars, saved for everyone", s, [
    { isNew: true, text: "Clay pits now count as deposits", at: [s.targets.clay[0] + 120, s.targets.clay[1] + 120], to: [s.targets.clay[0] + 4, s.targets.clay[1] + 8] },
    { text: "Looted chests turn grey and fill up again after 30 minutes", at: [400, 250], to: [s.targets.chest[0] - 16, s.targets.chest[1] - 4] },
    { text: "Your Flame Altars with their build zone", at: [1150, 160], to: s.targets.altar },
  ]);
}
// 6. Your layout: moved panels on a wide screen, the phone layout beside it.
{
  const moved = { "livemap.pos.clock": JSON.stringify({ h: "right", x: 10, v: "bottom", y: 205 }),
    "livemap.pos.players": JSON.stringify({ h: "right", x: 10, v: "top", y: 10 }) };
  const s = await raw(1920, 1080, moved, [3900, 4500, -1.6], async page => ({
    players: await page.evaluate(() => { const c = document.querySelector("#players").getBoundingClientRect(), h = document.querySelector("#players h2").getBoundingClientRect();
      return [c.left + 2, h.top + h.height / 2]; }) }));
  const phone = await raw(390, 844, { "livemap.fog": "0" }, [3700, 4330, -1.5], async page => { await page.click("#poiToggle"); return {}; });
  await compose("06-layout", "Move the panels where you like; a layout made for phones", s, [
    { isNew: true, text: "Drag a panel by its title; your browser remembers where", at: [900, 300], to: s.targets.players },
    { isNew: true, text: "Phones get their own layout", at: [600, 960], to: [532, 900] },
  ], { png: phone.png, x: 140, y: 120, w: 390 * 0.95 });
}
} else {
const HD = { "livemap.style": "HD" };
const styleSwitch = page => page.evaluate(() => { const r = document.querySelector(".leaflet-control-layers").getBoundingClientRect(); return [r.right, r.top + r.height / 2]; });
// 7. The whole world in the HD style.
{
  const s = await raw(1920, 1080, HD, [5600, 5050, -3.05], async page => ({ hd: await styleSwitch(page), region: await worldPx(page, 6766, 3764) }));
  await compose("07-hd-overview", "Optional HD map style: the whole world with its region names", s, [
    { tag: "OPTIONAL FILE", text: "HD map style: switch between the game map and HD at any time", at: [60, 700], to: s.targets.hd },
    { isNew: true, text: "Region names on the HD map too", at: [1390, 745], to: [s.targets.region[0] + 150, s.targets.region[1] + 30] },
  ]);
}
// 8. Players and weather in HD.
{
  const s = await raw(1920, 1080, { ...HD, "livemap.pois": allCats }, [3700, 4330, -0.6], async page => {
    await page.evaluate(() => [...document.querySelectorAll("#playerList li")].find(li => /Brom/.test(li.textContent)).click());
    await page.waitForTimeout(600);
    return { kesh: await worldPx(page, 3880, 4420), rain: await worldPx(page, 3300, 4700), hd: await styleSwitch(page) };
  });
  await compose("08-hd-players", "HD map style: players live, following and the weather", s, [
    { isNew: true, text: "Each player's arrow in their own colour", at: [1250, 170], to: [s.targets.kesh[0] + 6, s.targets.kesh[1] - 6] },
    { text: "Rain and snow exactly where they fall", at: [240, 640], to: s.targets.rain },
  ]);
}
// 9. Finds in HD.
{
  const s = await raw(1920, 1080, { ...HD, "livemap.pois": allCats }, [3660, 4360, 0], async page => {   // HD is sharp up to zoom 0
    const clay = await worldPx(page, 3770, 4465);
    await page.mouse.move(clay[0], clay[1]);
    await page.waitForTimeout(400);
    return { clay, altar: await worldPx(page, 3720, 4330) };
  });
  await compose("09-hd-finds", "HD map style: ore veins, looted chests and Flame Altars", s, [
    { isNew: true, text: "Clay pits now count as deposits", at: [s.targets.clay[0] + 120, s.targets.clay[1] + 120], to: [s.targets.clay[0] + 4, s.targets.clay[1] + 8] },
    { text: "Your Flame Altars with their build zone", at: [1150, 160], to: s.targets.altar },
  ]);
}
}
fs.writeFileSync(path.join(outDir, "titles.json"), JSON.stringify(titles, null, 2));
console.log("wrote", Object.keys(titles).join(", "));
await browser.close();
server.close();
