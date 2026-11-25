// Explore mode check without a game server: web/ with stub /state (exploreMode), /discovered,
// /explored and /near, headless.
//   node tools/perf/explore_check.mjs [screenshot.png]
// Alice explored the west half (x < 5120) and discovered 20 keyed places; her near grid holds
// the cells around one unkeyed point in the west ("spot"). Passes when the fog switch and the
// Discovered mode are hidden, the fog is opaque east and clear west, keyed points = Alice's keys,
// unkeyed points = only those in her near grid, an unkeyed west point outside it shows once Alice
// walks up to it, search offers no undiscovered place, region and place names follow the explored
// area, a loot source lists its places only once Alice was within 50 m, and the page has no errors.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shot = process.argv[2];
const web = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), "web");
const pois = JSON.parse(fs.readFileSync(path.join(web, "pois.json"), "utf8"));
const keyed = Object.entries(pois.discoveryKeys).map(([i, k]) => [Number(i), k]);
const keyedIdx = new Set(keyed.map(e => e[0]));
const alice = keyed.slice(0, 20).map(e => e[1]);
const N = 512, CELL = 20, cellOf = (x, z) => Math.floor(z / CELL) * N + Math.floor(x / CELL);
const bits = () => new Uint8Array(N * N / 8);
const set = (b, i) => { b[i >> 3] |= 1 << (i & 7); };
const west = bits();
for (let row = 0; row < N; row++) for (let col = 0; col < N / 2; col++) set(west, row * N + col);
// Unkeyed, non-find points in the west, away from the edges; the first chest is in the near grid.
const westUnkeyed = pois.pois.map((p, i) => ({ i, x: p[1], z: p[3], cat: pois.categories[p[0]].id }))
  .filter(p => !keyedIdx.has(p.i) && p.x > 1000 && p.x < 4500 && p.z > 1000 && p.z < 9000);
const spot = westUnkeyed.find(p => /^chest_/.test(p.cat));
const walkTo = westUnkeyed.find(p => Math.hypot(p.x - spot.x, p.z - spot.z) > 500);
const near = bits();
set(near, cellOf(spot.x, spot.z));
const grid = (b, v) => JSON.stringify({ version: v, cells: N, cellMetres: CELL, players: { Alice: Buffer.from(b).toString("base64") } });
const discovered = JSON.stringify({ version: 7, players: { Alice: { online: true, at: 1792780000, keys: alice } } });
// One iron deposit Alice found far out in the unexplored east: finds are never hidden.
const find = { sort: "Material_T4_Ore_Iron", x: 8000, y: 100, z: 5000, xp: 5, hits: 3, by: ["Alice"], first: 1792780000 };
let live = null;
const state = () => JSON.stringify({ time: { raw: 36e12, dayStart: 216e11, dayEnd: 792e11, isDay: true, ageMs: 10 },
  players: live ? [{ entity: 7, name: "Alice", pos: live, rot: [0, 0, 0, 1], ageMs: 10 }] : [],
  weather: null, findsVersion: 0, basesVersion: 0, flameLevel: 3, discoveredVersion: 7, exploredVersion: 3,
  exploreMode: true, nearVersion: 2 });
const types = { ".html": "text/html", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    const t = setInterval(() => res.write("data: " + state() + "\n\n"), 250);
    req.on("close", () => clearInterval(t));
    return;
  }
  const stub = { "/state": state(), "/finds": JSON.stringify({ version: 0, ore: [find], chests: [] }), "/bases": '{"version":0,"bases":[]}',
    "/discovered": discovered, "/explored": grid(west, 3), "/near": grid(near, 2) }[u.pathname];
  if (stub) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(stub); return; }
  const file = path.join(web, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(d); } });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const chrome = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, chrome, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const results = [];
const check = (label, pass, detail) => { results.push(pass); console.log((pass ? "PASS " : "FAIL ") + label + " (" + detail + ")"); };
const errors = [];
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", e => errors.push(e.message));
await page.addInitScript(() => { try { localStorage.clear(); } catch {} });   // fog off and "All places" in storage: the mode must win
await page.goto("http://127.0.0.1:" + server.address().port + "/?key=x");
await page.waitForFunction(() => window.livemap?.discovered?.explore?.() && window.livemap.discovered.exp() && window.livemap.discovered.state(), null, { timeout: 20000 });
await page.click("#poiToggle");
await page.evaluate(() => document.querySelectorAll("#poiList input:not([data-extra])").forEach(b => { if (!b.checked) { b.checked = true; b.dispatchEvent(new Event("change")); } }));
await page.evaluate(() => window.livemap.map.setView([5120, 5120], -3, { animate: false }));
await page.waitForTimeout(1500);
// Each element must exist and be hidden by its own computed style (an absent element or a hidden
// parent would pass a looser test); the by-player picker stays.
const hidden = await page.evaluate(() => ["fogSwitch", "discMode"].map(id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display === "none"; }));
check("fog switch and Discovered mode are hidden", hidden.every(Boolean), JSON.stringify(hidden));
const discByDisplay = await page.evaluate(() => { const e = document.getElementById("discBy"); return e ? getComputedStyle(e).display : "missing"; });
check("by-player picker stays shown", discByDisplay !== "none" && discByDisplay !== "missing", discByDisplay);
const note = await page.evaluate(() => document.getElementById("discNote")?.textContent || "");
check("panel explains explore mode", note.startsWith("Explore mode:"), note);
const alpha = await page.evaluate(() => [window.livemap.discovered.fogAlpha(2000, 5000), window.livemap.discovered.fogAlpha(8000, 5000)]);
check("fog: clear west, opaque east", alpha[0] === 0 && alpha[1] === 255, JSON.stringify(alpha));
const drawn = () => page.evaluate(() => {
  const h = window.livemap.poiLayer._hits, out = [];
  for (let i = 0; i < h.n; i++) { const p = h.p[i]; out.push({ k: p.k === undefined ? null : p.k, x: p[1], z: p[3], find: !!p.isFind, base: !!(p[5] && p[5].base) }); }
  return out;
});
const d = (await drawn()).filter(p => !p.find && !p.base);
const keys = new Set(alice);
const wrongKeyed = d.filter(p => p.k !== null && !keys.has(p.k));
const unkeyed = d.filter(p => p.k === null);
const nearCell = cellOf(spot.x, spot.z);
check("keyed places: only the ones Alice discovered", wrongKeyed.length === 0 && d.filter(p => p.k !== null).length === keys.size,
  `${d.filter(p => p.k !== null).length} keyed drawn, ${wrongKeyed.length} wrong`);
check("small markers: only inside the near grid", unkeyed.length > 0 && unkeyed.every(p => cellOf(p.x, p.z) === nearCell),
  `${unkeyed.length} unkeyed drawn`);
const shownBefore = (await drawn()).some(p => p.x === walkTo.x && p.z === walkTo.z);
live = [walkTo.x + 20, 120, walkTo.z];
await page.waitForTimeout(1500);
const shownAfter = (await drawn()).some(p => p.x === walkTo.x && p.z === walkTo.z);
check("live: a small marker shows once Alice is within 50 m", !shownBefore && shownAfter, `${shownBefore} -> ${shownAfter}`);
// Search: a keyed place Alice has not discovered (in the unexplored east, so no explored place
// label sits on the same spot) is not offered; one she discovered is.
const hiddenPlace = keyed.filter(([i, k]) => !keys.has(k) && pois.pois[i][4] && pois.pois[i][1] > 5600).map(([i]) => pois.pois[i])[0];
const knownPlace = keyed.filter(([, k]) => keys.has(k)).map(([i]) => pois.pois[i]).find(p => p[4]);
const nameOf = p => String(p[4]).split(" · ").pop();
const found = async p => (await page.evaluate(t => window.livemap.search(t), nameOf(p))).some(h => h.x === p[1] && h.z === p[3]);
check("search hides an undiscovered place", !(await found(hiddenPlace)), nameOf(hiddenPlace));
check("search finds a discovered place", await found(knownPlace), nameOf(knownPlace));
// A kind word lists the nearest five of that kind (the category branch). Chests are unkeyed, so
// only the ones in the near grid may come up, and the one in the fixture's near grid must.
const chestHits = await page.evaluate(() => window.livemap.search("chest").filter(h => /chest/i.test(h.kind)).map(h => ({ ...h, near: window.livemap.discovered.near(h.x, h.z) })));
check("search by kind: chests only from the near grid", chestHits.length > 0 && chestHits.every(h => h.near),
  `${chestHits.length} chest hits, ${chestHits.filter(h => !h.near).length} outside the near grid`);
// Finds are never hidden, wherever they lie.
const ironHits = await page.evaluate(() => window.livemap.search("iron"));
check("search by kind: a find outside the explored area is offered", ironHits.some(h => h.x === find.x && h.z === find.z),
  `${ironHits.length} hits for iron`);

// Region and place names follow the explored area. Alice explored x < 5120; the checks centre the
// view, wait for a redraw (and the font), then read what the layer drew.
await page.evaluate(() => document.fonts.ready);
const names = (x, z, zoom) => page.evaluate(([x, z, zoom, places]) => new Promise(r => {
  const m = window.livemap.map, l = window.livemap.poiLayer;
  m.setView([z, x], zoom, { animate: false });
  setTimeout(() => {
    l.redraw();
    const b = m.getBounds(), inView = (px, pz) => px >= b.getWest() && px <= b.getEast() && pz >= b.getSouth() && pz <= b.getNorth();
    r({ regions: l._regionsDrawn, boxes: l._placeBoxes.length,
      regionsInView: window.livemap.discovered.regions().filter(([, px, pz]) => inView(px, pz)).length,
      placesInView: places.filter(([, px, pz]) => inView(px, pz)).length });
  }, 500);
}), [x, z, zoom, pois.places]);
// (a) Zoomed out over the whole world: only the regions with x < 5120 are named. All of them lie
// in the view, so the expected count is not cut down by the view; it must be neither 0 nor all.
const world = await names(5120, 5120, -3);
const wantRegions = pois.regions.filter(r => r[1] < 5120).length;
check("region names: only the explored ones", world.regionsInView === pois.regions.length
  && wantRegions > 0 && wantRegions < pois.regions.length && world.regions === wantRegions,
  `${world.regions} drawn, ${wantRegions} of ${pois.regions.length} explored, ${world.regionsInView} in view`);
// (b) Place names: none over the unexplored east although the view holds places; some over an
// explored spot in the west (the control: without it "none" would pass for any reason). The east
// spot is picked so that the canvas around the view (1960 x 1400 m at zoom -1, 20 % padding) stays
// clear of the 300 m circles around the places Alice discovered in the east, and holds many places.
const aliceEast = keyed.filter(([, k]) => keys.has(k)).map(([i]) => pois.pois[i]).filter(p => p[1] > 4800);
let eastAt = null;
for (let x = 7400; x <= 9600; x += 100) for (let z = 1000; z <= 9500; z += 100) {
  if (!aliceEast.every(p => Math.abs(p[1] - x) > 2260 || Math.abs(p[3] - z) > 1700)) continue;
  const n = pois.places.filter(q => Math.abs(q[1] - x) < 1400 && Math.abs(q[2] - z) < 1000).length;
  if (!eastAt || n > eastAt.n) eastAt = { x, z, n };
}
const eastNames = await names(eastAt.x, eastAt.z, -1);
check("place names: none over the unexplored east", eastNames.boxes === 0 && eastNames.placesInView >= 10,
  `${eastNames.boxes} drawn, ${eastNames.placesInView} places in view at ${eastAt.x}, ${eastAt.z}`);
const westPlaces = pois.places.filter(p => p[1] > 2000 && p[1] < 3500);
const westSpot = westPlaces.map(p => ({ p, n: westPlaces.filter(q => Math.hypot(q[1] - p[1], q[2] - p[2]) < 700).length })).sort((a, b) => b.n - a.n)[0].p;
const westNames = await names(westSpot[1], westSpot[2], -1);
check("place names: shown over an explored spot in the west", westNames.boxes > 0, `${westNames.boxes} drawn around ${westSpot[0]}`);
await page.evaluate(() => window.livemap.map.setView([5120, 5120], -3, { animate: false }));
await page.waitForTimeout(500);

// Item sources: "where to get" lists a source's places only once Alice was within 50 m of one. A
// source with a place in the west that no near cell covers yet says "no place found yet"; once
// Alice stands on that place it counts 1 place, nearest here, and picking it rings that one place.
const loot = JSON.parse(fs.readFileSync(path.join(web, "loot.json"), "utf8"));
const lonePoint = g => {
  const pts = g[4] || [], clear = (x, z, p) => Math.hypot(x - p.x, z - p.z) > 200;
  // None of the source's places lies near the fixture's near grid (the chest, the walk-to point).
  if (!pts.every((v, j) => j % 2 || (clear(v, pts[j + 1], spot) && clear(v, pts[j + 1], walkTo)))) return null;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < 4500 && pts.every((v, j) => j % 2 || j === i || Math.hypot(v - pts[i], pts[j + 1] - pts[i + 1]) > 100)) return [pts[i], pts[i + 1]];
  }
  return null;
};
const sourceCases = loot.items.map(it => {
  const gs = it[2].map(([gi]) => loot.groups[gi]);
  const g = gs.find(g => lonePoint(g) && gs.filter(o => o[0] === g[0]).length === 1);
  return g && { item: it[1], g, at: lonePoint(g) };
}).filter(Boolean);
await page.focus("#searchBox");   // the first use loads loot.json
await page.waitForFunction(() => window.livemap.search.loot(), null, { timeout: 20000 });
// The first case whose item is the only search hit for its own name.
const singleItem = async cases => {
  for (const c of cases.slice(0, 80)) {
    const hits = await page.evaluate(t => window.livemap.search(t), c.item);
    if (hits.length === 1 && hits[0].kind === "Item") return c;
  }
  return null;
};
const pick = await singleItem(sourceCases);
const sourceMeta = c => page.evaluate(([item, name]) => {
  window.livemap.search(item); window.livemap.search.go();
  const li = [...document.querySelectorAll("#searchResults li[data-i]")].find(l => l.firstChild.textContent === name);
  return li ? li.querySelector(".m").textContent : null;
}, [c.item, c.g[0]]);
const metaBefore = await sourceMeta(pick);
check("item source: no place until a player was within 50 m", metaBefore !== null && metaBefore.endsWith("no place found yet"), `${pick.item} / ${pick.g[0]}: ${metaBefore}`);
live = [pick.at[0], 120, pick.at[1]];
await page.waitForTimeout(1500);
const metaAfter = await sourceMeta(pick);
const ringed = await page.evaluate(name => {
  const li = [...document.querySelectorAll("#searchResults li[data-i]")].find(l => l.firstChild.textContent === name);
  li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  return window.livemap.search.ringed();
}, pick.g[0]);
check("item source: the place counts once Alice stands on it", metaAfter !== null && metaAfter.includes("1 place · nearest here") && ringed === 1,
  `${metaAfter}, ${ringed} ringed`);

// A source without places says where it is found, but only in regions whose label Alice has
// explored (here x < 5120, as in the region names check); with none of them, "no place found yet".
const exploredRegions = new Set(pois.regions.filter(r => r[1] < 5120).map(r => r[0]));
const regionsOf = g => loot.regions.filter((_, i) => (g[3] >> i) & 1);
const regionCases = keep => loot.items.map(it => {
  const gs = it[2].map(([gi]) => loot.groups[gi]);
  const g = gs.find(g => !g[4] && gs.filter(o => o[0] === g[0]).length === 1 && keep(regionsOf(g).filter(r => exploredRegions.has(r)), regionsOf(g)));
  return g && { item: it[1], g };
}).filter(Boolean);
const mixed = await singleItem(regionCases((seen, all) => seen.length >= 1 && seen.length <= 3 && seen.length < all.length));
const mixedMeta = await sourceMeta(mixed);
const mixedSeen = regionsOf(mixed.g).filter(r => exploredRegions.has(r)), mixedUnseen = regionsOf(mixed.g).filter(r => !exploredRegions.has(r));
check("item source without places: only the explored regions", mixedMeta !== null && mixedMeta.endsWith("found in " + mixedSeen.join(", ")) && mixedUnseen.every(r => !mixedMeta.includes(r)),
  `${mixed.item} / ${mixed.g[0]}: ${mixedMeta} (unexplored: ${mixedUnseen.join(", ")})`);
const none = await singleItem(regionCases((seen, all) => all.length >= 1 && seen.length === 0));
const noneMeta = await sourceMeta(none);
check("item source without places: no explored region, no place found yet", noneMeta !== null && noneMeta.endsWith("no place found yet"),
  `${none.item} / ${none.g[0]}: ${noneMeta} (in ${regionsOf(none.g).join(", ")})`);

if (shot) { await page.screenshot({ path: shot }); }

check("no page errors", errors.length === 0, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
