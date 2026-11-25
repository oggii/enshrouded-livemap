# Explore Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ExploreMode=1` in `livemap.ini` makes the web map show only what the server's players found: opaque fog over unexplored land, places only once discovered, small markers only once a player was within 50 m, and search and item sources limited the same way.

**Architecture:** The DLL keeps a second explored grid with a 50 m radius ("near"), serves it at `/near`, and announces `exploreMode` and `nearVersion` in `/state`. The page (`web/index.html`, one file) locks the fog and the Discovered filter when it sees `exploreMode`. It decides visibility from the existing `/discovered` and `/explored` data plus the new near grid. The page enforces everything; `pois.json` stays public.

**Tech Stack:**
- C++23 DLL built with MSVC and Ninja (`build.cmd`), plain assert tests run by ctest
- One-file Leaflet page
- Headless page checks with playwright-core (`tools/perf/*.mjs`)

**Spec:** `docs/superpowers/specs/2026-11-25-explore-mode-design.md`

## Global Constraints

- Setting name `ExploreMode`, default `0`. It only works with `Discovered=1`. Otherwise the DLL logs `ExploreMode needs Discovered=1; explore mode off` and stays off.
- Near radius 50 m, on the same 512 x 512 grid of 20 m cells as the explored grid (300 m).
- `/state` adds `"exploreMode":true,"nearVersion":N` only when the mode is on. Nothing changes when it is off.
- Saved to `livemap/near.json` in the same format and on the same 30 s schedule as `explored.json`.
- Fog alpha 255 in explore mode, 190 otherwise.
- Panel line: `Explore mode: this server shows only what your group has found.`
- Finds, Flame Altars, players, creatures, weather and the clock are never hidden.
- Code, comments and commits in English.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nothing goes to the live or test server, Nexus or a GitHub release without Oggi's OK.
- Never use Playwright against Oggi's Chrome. The page checks start their own headless Chromium from `ms-playwright`, as `fog_check.mjs` does.
- Build: `cmd //c "C:\claudino\enshrouded-livemap\build.cmd"`. Use the absolute path: `NoDefaultCurrentDirectoryInExePath` is set.
- Page checks: `cd tools/perf && node <check>.mjs`.

---

### Task 1: Store with its own radius

**Files:**
- Modify: `src/explored.h` (constants, `class Store`)
- Modify: `src/explored.cpp` (`Store::reveal`)
- Test: `tests/explored_test.cpp`

**Interfaces:**
- Produces:
  - `explored::kNearMetres` (50.0)
  - `explicit explored::Store::Store(double radius_metres = kRadiusMetres)`
  - all existing methods unchanged

- [ ] **Step 1: Write the failing test.** In `tests/explored_test.cpp`, insert before `if (failures == 0)`:

```cpp
    // Explore mode's near grid: the same 20 m cells, marked within 50 m. Around a cell centre
    // that is the 5 x 5 block without its 4 corners = 21 cells.
    Store n(kNearMetres);
    EXPECT(n.reveal("A", 5010, 5010));
    EXPECT(n.explored("A", 5010, 5010));
    EXPECT(n.explored("A", 5050, 5010));                // cell centre 40 m away
    EXPECT(!n.explored("A", 5070, 5010));               // 60 m
    EXPECT(!n.explored("A", 5050, 5050));               // corner, 56.6 m
    int near_cells = 0;
    for (int row = 0; row < kCells; ++row)
        for (int col = 0; col < kCells; ++col)
            near_cells += n.explored("A", (col + 0.5) * kCellMetres, (row + 0.5) * kCellMetres);
    EXPECT(near_cells == 21);
    Store m(kNearMetres);
    EXPECT(m.from_json(n.to_json()) && m.explored("A", 5010, 5010) && !m.explored("A", 5070, 5010));
```

- [ ] **Step 2: Run it and confirm it fails to compile.** Run `cmd //c "C:\claudino\enshrouded-livemap\build.cmd"`. Expected: a compile error, because `kNearMetres` is undeclared and `Store` has no constructor that takes a double.

- [ ] **Step 3: Implement.**

In `src/explored.h`, below `constexpr double kRadiusMetres = 300.0;`, add:

```cpp
constexpr double kNearMetres = 50.0;   // explore mode: small markers show once a player was this close
```

In `class Store`, add the first public line:

```cpp
    // radius_metres: how far around a position cells are marked (300 m explored, 50 m near).
    explicit Store(double radius_metres = kRadiusMetres) : radius_(radius_metres) {}
```

Add the first private line:

```cpp
    const double radius_;
```

Update the header comment of `reveal`: replace "marks every cell whose centre is within the radius" with "marks every cell whose centre is within this store's radius".

In `src/explored.cpp` `Store::reveal`, replace all four uses of `kRadiusMetres` with `radius_`. These are the three in the bounds check, the one in `std::ceil(...)`, and the two in the `mx * mx + mz * mz >` comparison.

- [ ] **Step 4: Run the tests.** Run `cmd //c "C:\claudino\enshrouded-livemap\build.cmd"`. Expected: `100% tests passed`, and the explored line still says `one reveal = 7xx cells`.

- [ ] **Step 5: Commit.**

```bash
git add src/explored.h src/explored.cpp tests/explored_test.cpp
git commit -m "Explored store takes its radius (50 m near grid for explore mode)"
```

---

### Task 2: Server side of explore mode

**Files:**
- Modify: `src/config.h` (Config struct), `src/config.cpp` (`load_config`, next to `Discovered`)
- Modify: `src/world.h` (declarations near `explored_store()`), `src/world.cpp`:
  - globals at line 73 (`explored::Store g_explored;`)
  - accessors at line 598
  - `refresh_explored()`
  - the end of `snapshot_json()` (`"exploredVersion"`)
- Modify: `src/main.cpp` (load block at the `explored_path` lines, save loop at "Explored area")
- Modify: `src/web.cpp` (route list after `/explored`)

**Interfaces:**
- Consumes: `explored::Store(double)`, `explored::kNearMetres` (Task 1)
- Produces:
  - `Config::explore_mode` (bool)
  - `world::near_store()`
  - `world::enable_explore_mode()`
  - HTTP `GET /near?key=…`, in the same JSON shape as `/explored`
  - `/state` fields `exploreMode` (true) and `nearVersion` (number), only when on

- [ ] **Step 1: Config.**

In `src/config.h`, after `bool discovered = true; ...`, add:

```cpp
    bool explore_mode = false;   // ExploreMode=1: the page shows only what the players found (needs Discovered)
```

In `src/config.cpp`, after the `c.discovered = ...` line, add:

```cpp
    c.explore_mode = GetPrivateProfileIntW(L"livemap", L"ExploreMode", 0, path.c_str()) != 0;
```

- [ ] **Step 2: World.**

In `src/world.h`, below `explored::Store& explored_store();`, add:

```cpp
// Explore mode: a second grid, marked within explored::kNearMetres of every position.
explored::Store& near_store();
void enable_explore_mode();
```

In `src/world.cpp`, below `explored::Store g_explored;` (line 73), add:

```cpp
explored::Store g_near(explored::kNearMetres);
std::atomic<bool> g_explore_mode{false};
```

Next to `explored::Store& explored_store() { return g_explored; }`, add:

```cpp
explored::Store& near_store() { return g_near; }

void enable_explore_mode() { g_explore_mode.store(true, std::memory_order_relaxed); }
```

In `refresh_explored()`, replace the final line

```cpp
        g_explored.reveal(name, meters(s.x.load(std::memory_order_relaxed)), meters(s.z.load(std::memory_order_relaxed)));
```

with:

```cpp
        const double x = meters(s.x.load(std::memory_order_relaxed)), z = meters(s.z.load(std::memory_order_relaxed));
        g_explored.reveal(name, x, z);
        if (g_explore_mode.load(std::memory_order_relaxed)) g_near.reveal(name, x, z);
```

In `snapshot_json()`, replace

```cpp
    out += ",\"exploredVersion\":" + std::to_string(g_explored.version()) + "}";
```

with:

```cpp
    out += ",\"exploredVersion\":" + std::to_string(g_explored.version());
    if (g_explore_mode.load(std::memory_order_relaxed)) {
        out += ",\"exploreMode\":true,\"nearVersion\":" + std::to_string(g_near.version());
    }
    out += "}";
```

`<atomic>` is already included, because world.cpp uses `std::atomic` for the slots. Check with `grep -n "#include <atomic>" src/world.cpp` and add the include if it is missing.

- [ ] **Step 3: Main: load, log, save.**

In `src/main.cpp`, below `const std::wstring explored_path = ...`, add:

```cpp
    const std::wstring near_path = dir + L"\\livemap\\near.json";
```

Inside `if (config.discovered) { ... }`, after the explored load, add:

```cpp
        if (config.explore_mode) {
            livemap::world::enable_explore_mode();
            if (read_file(near_path, text) && livemap::world::near_store().from_json(text)) {
                livemap::log("near: %zu players loaded", livemap::world::near_store().players());
            }
            livemap::log("explore mode: the map shows only what the players found (small markers within 50 m)");
        }
```

In the `else` branch, after the existing log line, add:

```cpp
        if (config.explore_mode) livemap::log("ExploreMode needs Discovered=1; explore mode off");
```

Below `uint64_t explored_saved = ...`, add:

```cpp
    uint64_t near_saved = livemap::world::near_store().version(), last_near_save = 0;
```

In the save loop, inside `if (config.discovered && now - last_explored >= 1'000) { ... }`, after the explored save `if`, add:

```cpp
            const uint64_t near_version = livemap::world::near_store().version();
            if (config.explore_mode && near_version != near_saved && now - last_near_save >= 30'000) {
                last_near_save = now;
                if (write_file_atomic(near_path, livemap::world::near_store().to_json())) near_saved = near_version;
            }
```

- [ ] **Step 4: Route.** In `src/web.cpp`, after the `/explored` block, add:

```cpp
    if (path == "/near") {
        send_response(s, "200 OK", "application/json", world::near_store().to_json());
        return;
    }
```

- [ ] **Step 5: Build, test and selftest.**
  - Run `cmd //c "C:\claudino\enshrouded-livemap\build.cmd"`. Expected: `100% tests passed`.
  - Run `build/livemap_selftest.exe "C:/claudino/enshrouded-mod/clean-26430253/enshrouded_server.exe"`. Expected: `OK: all hook sites found`. If clean-26430253 has no exe at that path, use `find /c/claudino/enshrouded-mod -name enshrouded_server.exe` and take the 26430253 one.

- [ ] **Step 6: Commit.**

```bash
git add src/config.h src/config.cpp src/world.h src/world.cpp src/main.cpp src/web.cpp
git commit -m "ExploreMode: near grid (50 m), /near, exploreMode and nearVersion in /state"
```

---

### Task 3: Page locks fog and markers in explore mode

**Files:**
- Create: `tools/perf/explore_check.mjs`
- Modify: `web/index.html`. Line numbers are from commit 7ef0aef; search for the quoted code.
  - discovered helpers at about 1105–1230 (`let discMode`, `discInvalidate`, `discHidden`, `revealLive`, `maybeRefreshExplored`)
  - the fog block at about 1621–1710 (`FOG_ALPHA`, `fogTarget`, `fogFrame`)
  - `_drawPlaces` (about 711) and `_drawRegions` (about 750)
  - the marker panel (about 1013, `fg.innerHTML`)
  - `discPanel` (about 1130)
  - `render()` (about 2066)
  - the CSS block in `<style>`
  - `window.livemap.discovered` (about 2024)

**Interfaces:**
- Consumes: `/state` `exploreMode` and `nearVersion`, and `/near` (Task 2)
- Produces, page-internal and used in Task 4:
  - `EXPLORE` (bool)
  - `nearAt(x, z) -> bool`
  - `discHidden(p)`, which now respects explore mode
  - `window.livemap.discovered.explore() -> bool`

- [ ] **Step 1: Write the page check.** Create `tools/perf/explore_check.mjs`:

```js
// Explore mode check without a game server: web/ with stub /state (exploreMode), /discovered,
// /explored and /near, headless.
//   node tools/perf/explore_check.mjs [screenshot.png]
// Alice explored the west half (x < 5120) and discovered 20 keyed places; her near grid holds
// the cells around one unkeyed point in the west ("spot"). Passes when the fog switch and the
// Discovered mode are hidden, the fog is opaque east and clear west, keyed points = Alice's keys,
// unkeyed points = only those in her near grid, an unkeyed west point outside it shows once Alice
// walks up to it, and the page has no errors.
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
// Unkeyed, non-find points in the west, away from the edges; the first is in the near grid.
const westUnkeyed = pois.pois.map((p, i) => ({ i, x: p[1], z: p[3] }))
  .filter(p => !keyedIdx.has(p.i) && p.x > 1000 && p.x < 4500 && p.z > 1000 && p.z < 9000);
const spot = westUnkeyed[0];
const walkTo = westUnkeyed.find(p => Math.hypot(p.x - spot.x, p.z - spot.z) > 500);
const near = bits();
set(near, cellOf(spot.x, spot.z));
const grid = (b, v) => JSON.stringify({ version: v, cells: N, cellMetres: CELL, players: { Alice: Buffer.from(b).toString("base64") } });
const discovered = JSON.stringify({ version: 7, players: { Alice: { online: true, at: 1792780000, keys: alice } } });
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
  const stub = { "/state": state(), "/finds": '{"version":0,"ore":[],"chests":[]}', "/bases": '{"version":0,"bases":[]}',
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
const hidden = await page.evaluate(() => ["fogSwitch", "discMode"].map(id => { const e = document.getElementById(id); return !e || e.offsetParent === null; }));
check("fog switch and Discovered mode are hidden", hidden.every(Boolean), JSON.stringify(hidden));
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
if (shot) { await page.screenshot({ path: shot }); }
check("no page errors", errors.length === 0, errors.join(" | ") || "none");
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
await browser.close();
server.close();
```

- [ ] **Step 2: Run it and confirm it fails.** Run `cd tools/perf && node explore_check.mjs`. Expected: a timeout in `waitForFunction`, because `discovered.explore` does not exist yet.

- [ ] **Step 3: Implement in `web/index.html`.**

(a) CSS: in the `<style>` block, add:

```css
body.explore-mode #fogSwitch, body.explore-mode #discMode { display: none; }
```

(b) Fog switch id: in the marker panel, change `const fg = document.createElement("label");` so the label gets an id:

```js
    const fg = document.createElement("label"); fg.id = "fogSwitch";
```

(c) State and grids. Directly below `let discBy = ...`, add:

```js
  // Explore mode (ExploreMode=1 in livemap.ini, "exploreMode" in /state): the server owner shows
  // only what the players found. Fog on and opaque, the filter fixed to "Discovered", small
  // markers only within 50 m of where a player has been (the near grid, /near).
  let EXPLORE = false;
  let NEAR = null, nearVersion = -1, nearFetching = false, nearLast = 0, nearGrid = null, nearWarned = false;
  const NEAR_RADIUS = 50;
```

Change `function discInvalidate() { discNamesCache = null; expGrid = null; }` to:

```js
  function discInvalidate() { discNamesCache = null; expGrid = null; nearGrid = null; }
```

(d) Visibility. Replace `function discHidden(p) { ... }` with:

```js
  function discHidden(p) {
    if (EXPLORE) return exploreKnown(p) === false;
    if (discMode === "all" || !discNames().length) return false;
    const known = discKnown(p);
    return known === null ? false : discMode === "known" ? !known : known;
  }
  // Explore mode: finds and altars always (players made them); keyed places once a chosen player
  // discovered them in the game; everything else once a player was within 50 m.
  function exploreKnown(p) {
    if (p.isFind || (p[5] && p[5].base)) return null;
    if (p.k !== undefined) return !!DISC && discNames().some(n => DISC.players[n] && DISC.players[n].keys.has(p.k));
    return nearAt(p[1], p[3]);
  }
  function nearAt(x, z) {
    if (!NEAR) return false;
    if (!nearGrid) {
      const n = NEAR.cells, g = new Uint8Array(n * n);
      for (const name of discNames()) {
        const bits = NEAR.players[name];
        if (bits) for (let i = 0; i < n * n; i++) if (bits[i >> 3] >> (i & 7) & 1) g[i] = 1;
      }
      nearGrid = { n, cell: NEAR.cellMetres, g };
    }
    const { n, cell, g } = nearGrid, col = Math.floor(x / cell), row = Math.floor(z / cell);
    return col >= 0 && row >= 0 && col < n && row < n && g[row * n + col] === 1;
  }
```

(e) Shared grid helpers. Replace the body of `revealLive` and the parsing in `maybeRefreshExplored` with shared helpers. Replace the whole `function revealLive(name, x, z) { ... }` with:

```js
  // Marks every cell whose centre is within `radius` of (x, z) in a player's bits and, when
  // given, in the combined grid g. True when a cell was new.
  function markCircle(bits, g, n, cell, x, z, radius) {
    const r = Math.ceil(radius / cell), cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let changed = false;
    for (let dz = -r; dz <= r; dz++) {
      const row = cz + dz;
      if (row < 0 || row >= n) continue;
      const mz = (row + 0.5) * cell - z;
      for (let dx = -r; dx <= r; dx++) {
        const col = cx + dx, mx = (col + 0.5) * cell - x, i = row * n + col;
        if (col < 0 || col >= n || mx * mx + mz * mz > radius * radius || bits[i >> 3] >> (i & 7) & 1) continue;
        bits[i >> 3] |= 1 << (i & 7);
        if (g) g[i] = 1;
        changed = true;
      }
    }
    return changed;
  }
  function revealLive(name, x, z) {
    if (!EXP || !name) return false;
    const n = EXP.cells;
    let bits = EXP.players[name];
    if (!bits) { bits = EXP.players[name] = new Uint8Array(n * n / 8); discInvalidate(); discPanel(); }
    return markCircle(bits, expGrid && discNames().includes(name) ? expGrid.g : null, n, EXP.cellMetres, x, z, EXP_RADIUS);
  }
  function revealNearLive(name, x, z) {
    if (!NEAR || !name) return false;
    const n = NEAR.cells;
    let bits = NEAR.players[name];
    if (!bits) { bits = NEAR.players[name] = new Uint8Array(n * n / 8); nearGrid = null; }
    return markCircle(bits, nearGrid && discNames().includes(name) ? nearGrid.g : null, n, NEAR.cellMetres, x, z, NEAR_RADIUS);
  }
  // /explored and /near: {version, cells, cellMetres, players: {name: base64 bits}}. Bits the page
  // marked live are kept until the server has them too.
  function mergeGrid(d, old) {
    const players = old && old.cells === d.cells ? old.players : {};
    for (const [name, b64] of Object.entries(d.players || {})) {
      const s = atob(b64), bits = new Uint8Array(s.length), prev = players[name];
      for (let i = 0; i < s.length; i++) bits[i] = s.charCodeAt(i) | (prev && prev.length === s.length ? prev[i] : 0);
      players[name] = bits;
    }
    return { cells: d.cells, cellMetres: d.cellMetres, players };
  }
```

In `maybeRefreshExplored`, replace the block

```js
      const players = EXP && EXP.cells === d.cells ? EXP.players : {};
      for (const [name, b64] of Object.entries(d.players || {})) {
        const s = atob(b64), bits = new Uint8Array(s.length), old = players[name];
        for (let i = 0; i < s.length; i++) bits[i] = s.charCodeAt(i) | (old && old.length === s.length ? old[i] : 0);
        players[name] = bits;
      }
      EXP = { cells: d.cells, cellMetres: d.cellMetres, players };
```

with:

```js
      EXP = mergeGrid(d, EXP);
```

After `maybeRefreshExplored`, add:

```js
  function maybeRefreshNear(version) {
    const now = Date.now();
    if (!EXPLORE || version === undefined || version === nearVersion || nearFetching || now - nearLast < 15000) return;
    nearFetching = true;
    nearLast = now;
    const warn = () => { if (!nearWarned) { nearWarned = true; console.warn("livemap: /near not available; small markers stay hidden"); } };
    fetch("near" + q).then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return warn();
      NEAR = mergeGrid(d, NEAR);
      nearVersion = d.version;
      nearGrid = null;
      poiLayer.invalidate();
    }).catch(warn).finally(() => { nearFetching = false; });
  }
  // Called once, on the first state that says exploreMode. Nothing is written to localStorage, so
  // the viewer's own choices come back on a server without the mode.
  function applyExploreMode() {
    EXPLORE = true;
    NEAR = NEAR || { cells: 512, cellMetres: 20, players: {} };
    discMode = "known";
    document.body.classList.add("explore-mode");
    showFog = true;
    fog.cur = null;
    fogOverlay.addTo(map);
    drawFog();
    discPanel();
    poiLayer.invalidate();
  }
```

(f) Fog. Change `const FOG_ALPHA = 190, FOG_FADE_MS = 800;` to:

```js
  const FOG_FADE_MS = 800, fogAlphaMax = () => EXPLORE ? 255 : 190;
```

In `fogTarget`, replace `FOG_ALPHA * (1 - Math.min(1, a[i]))` with `fogAlphaMax() * (1 - Math.min(1, a[i]))`.

In `fogFrame`:
- replace `const step = FOG_ALPHA * Math.min(...)` with `const step = fogAlphaMax() * Math.min(...)`;
- change `if (!showFog || (!EXP && !DISC)) return;` to `if (!showFog || (!EXP && !DISC && !EXPLORE)) return;`.

Search the file for any other `FOG_ALPHA` with `grep -n FOG_ALPHA web/index.html` and replace each with `fogAlphaMax()`.

(g) Names. In `_drawPlaces`, change

```js
      const filter = discMode !== "all" && EXP && discNames().length;
```

to:

```js
      const filter = EXPLORE || (discMode !== "all" && EXP && discNames().length);
```

In `_drawRegions`, the loop starts `for (const [name, wx, wz] of rawPoiData.regions) {`. Add as the first line inside it:

```js
        if (EXPLORE && !exploredAt(wx, wz)) continue;
```

(h) Panel note. In `discPanel`, change the `note.textContent = ...` statement to start with the explore case:

```js
    note.textContent = EXPLORE ? "Explore mode: this server shows only what your group has found."
      : !DISC && !EXP ? "Needs the server part 1.6." : !names.length ? "Nobody has played since the update."
      : "Towns, dungeons, camps ... use the game's own state; everything else counts within 300 m of where that player has been.";
```

(i) Render. In `render(state)`, before `maybeRefreshFinds(...)`, add:

```js
    if (state.exploreMode && !EXPLORE) applyExploreMode();
```

After `maybeRefreshExplored(state.exploredVersion);`, add:

```js
    maybeRefreshNear(state.nearVersion);
```

Replace

```js
    for (const p of state.players) if (p.pos && revealLive(p.name, p.pos[0], p.pos[2])) revealed = true;
    if (revealed) { drawFog(); if (discMode !== "all") poiLayer.schedule(); }
```

with:

```js
    for (const p of state.players) {
      if (!p.pos) continue;
      if (revealLive(p.name, p.pos[0], p.pos[2])) revealed = true;
      if (EXPLORE && revealNearLive(p.name, p.pos[0], p.pos[2])) revealed = true;
    }
    if (revealed) { drawFog(); if (EXPLORE || discMode !== "all") poiLayer.schedule(); }
```

(j) Test hook. In `window.livemap.discovered = { ... }`, add next to `exp: () => EXP,`:

```js
    explore: () => EXPLORE, near: (x, z) => nearAt(x, z),
```

- [ ] **Step 4: Run the check and confirm it passes.** Run `cd tools/perf && node explore_check.mjs`. Expected: every line PASS, ending in `ALL PASS`. If "small markers" fails because the page caches drawn points, check that `poiLayer.invalidate()` runs after `NEAR` changes (in `maybeRefreshNear`) and after live marking (`poiLayer.schedule()` in render).

- [ ] **Step 5: Check that nothing changed without the mode.** Run `node fog_check.mjs`, `node discovered_check.mjs` and `node places_check.mjs` in `tools/perf`. Expected: `ALL PASS` from each, as before the change.

- [ ] **Step 6: Commit.**

```bash
git add web/index.html tools/perf/explore_check.mjs
git commit -m "Page: explore mode locks opaque fog and the Discovered filter, small markers via the near grid"
```

---

### Task 4: Search and item sources respect explore mode

**Files:**
- Modify: `web/index.html`:
  - `runSearch` (about line 1809)
  - `showSources` (about 1847)
  - `showSource` (about 1874)
  - `window.livemap` test hooks
- Modify: `tools/perf/explore_check.mjs` (add checks before the screenshot line)

**Interfaces:**
- Consumes: `EXPLORE`, `discHidden(p)`, `nearAt(x, z)`, `exploredAt(x, z)` (Task 3)
- Produces: `window.livemap.search(text) -> [{name, kind, x, z}]` for checks

- [ ] **Step 1: Add the failing checks.** In `tools/perf/explore_check.mjs`, insert before `if (shot)`:

```js
// Search: a keyed place Alice has not discovered (in the unexplored east, so no explored place
// label sits on the same spot) is not offered; one she discovered is.
const hiddenPlace = keyed.filter(([i, k]) => !keys.has(k) && pois.pois[i][4] && pois.pois[i][1] > 5600).map(([i]) => pois.pois[i])[0];
const knownPlace = keyed.filter(([, k]) => keys.has(k)).map(([i]) => pois.pois[i]).find(p => p[4]);
const nameOf = p => String(p[4]).split(" · ").pop();
const found = async p => (await page.evaluate(t => window.livemap.search(t), nameOf(p))).some(h => h.x === p[1] && h.z === p[3]);
check("search hides an undiscovered place", !(await found(hiddenPlace)), nameOf(hiddenPlace));
check("search finds a discovered place", await found(knownPlace), nameOf(knownPlace));
```

- [ ] **Step 2: Run it and confirm it fails.** Run `cd tools/perf && node explore_check.mjs`. Expected: an error that `window.livemap.search is not a function`.

- [ ] **Step 3: Implement.** Below `function searchKnown(h) { ... }`, add:

```js
  // Explore mode: nothing the group has not found, in the list or among a kind's nearest five.
  function searchHidden(e) {
    if (!EXPLORE || e.kind === "Player" || e.kind === "Item") return false;
    if (e.p) return discHidden(e.p);
    return !exploredAt(e.x, e.z);
  }
  // Explore mode: a loot source's places count once a player was within 50 m of them.
  function sourcePts(g) {
    const pts = g[4];
    if (!pts || !EXPLORE) return pts;
    const out = [];
    for (let i = 0; i < pts.length; i += 2) if (nearAt(pts[i], pts[i + 1])) out.push(pts[i], pts[i + 1]);
    return out;
  }
```

In `runSearch`, change

```js
      const hits = searchEntries().map(e => ({ ...e, r: rank(e.name) })).filter(e => e.r < 9);
```

to:

```js
      const hits = searchEntries().map(e => ({ ...e, r: rank(e.name) })).filter(e => e.r < 9 && !searchHidden(e));
```

In the same function, in the category branch, change

```js
        poiData.pois.filter(p => p[0] === ci).map(p => ({ name: p[4] ? String(p[4]).split(" · ").pop() : kind, kind, x: p[1], z: p[3], zoom: 0.5, p: p.isFind ? null : p, r: 1.5 }))
          .sort((a, b) => far(a) - far(b)).slice(0, 5)
```

to:

```js
        poiData.pois.filter(p => p[0] === ci).map(p => ({ name: p[4] ? String(p[4]).split(" · ").pop() : kind, kind, x: p[1], z: p[3], zoom: 0.5, p: p.isFind ? null : p, r: 1.5 }))
          .filter(e => !searchHidden(e)).sort((a, b) => far(a) - far(b)).slice(0, 5)
```

In `showSources`, replace

```js
      const g = LOOT.groups[gi], pts = g[4];
```

with:

```js
      const g = LOOT.groups[gi], pts = sourcePts(g);
```

Replace the `const where = ...` statement with:

```js
      const count = EXPLORE && pts ? pts.length / 2 : g[2];
      const where = near ? count + (count === 1 ? " place" : " places") + " · nearest " + awayText(from, near.x, near.z)
        : pts ? "no place found yet"
        : "found in " + (regions.length > 3 ? regions.length + " regions" : regions.join(", ") || "the world");
```

In `showSource`, replace `const pts = h.g[4];` with `const pts = sourcePts(h.g);`.

Test hook: after the `window.livemap.discovered = { ... };` statement, add:

```js
  window.livemap.search = text => { searchBox.value = text; runSearch(); return searchHits.map(h => ({ name: h.name, kind: h.kind, x: h.x, z: h.z })); };
```

- [ ] **Step 4: Run the checks.** Run `cd tools/perf && node explore_check.mjs && node loot_check.mjs`. Expected: `ALL PASS` from both. `loot_check` runs without the mode and must not change.

- [ ] **Step 5: Commit.**

```bash
git add web/index.html tools/perf/explore_check.mjs
git commit -m "Page: search and item sources leave out what explore mode hides"
```

---

### Task 5: Game test on the test server (with Oggi)

**Files:** none in the repo. The scripts go to the session scratchpad.

**Interfaces:**
- Consumes: `build/iphlpapi.dll` (Tasks 1–2), `web/index.html` (Tasks 3–4)

- [ ] **Step 1: Ask Oggi for the OK.** The test server `enshrouded-test` has to restart, and Oggi plays the test.

- [ ] **Step 2: Deploy to the test server.** Write a script to the scratchpad and run it with `ssh oggi 'bash -s' < script`, never as a nested one-liner. The script must:
  1. back up `iphlpapi.dll`, `livemap/index.html` and `livemap.ini` from `/mnt/hdd4t/enshrouded-test/server` into `/mnt/hdd4t/enshrouded-test/pre-explore-<date>/`;
  2. run `docker stop enshrouded-test`;
  3. put each new file in place as `<file>.new` followed by `mv -f` (the server files are hardlinked with live, so never write in place);
  4. write a new `livemap.ini` with `ExploreMode=1` appended, then `mv`;
  5. run `docker start enshrouded-test`.
  Upload the DLL and the page with `scp` to `/home/oggi/deploy-<date>/` beforehand and compare their sha256 with the local files.

- [ ] **Step 3: Check the server.**
  - `livemap.log` says `explore mode: the map shows only what the players found`.
  - `curl -s "http://127.0.0.1:<port>/state?key=<key>"` contains `"exploreMode":true`. Read the port and key from `livemap.ini` on the server, as `oggi_who_where.sh` does. Never print the key.
  - `/near` answers.

- [ ] **Step 4: Play-test with Oggi.**
  - The map is black except for explored land.
  - Walking to a chest, it appears within 50 m.
  - A town shows once it is discovered in game.
  - Searching an undiscovered town returns nothing.
  - After 30 s, `livemap/near.json` exists on the server.

- [ ] **Step 5: Tick the boxes in `CHECKLIST.md` and commit.**

```bash
git add CHECKLIST.md
git commit -m "Checklist: explore mode tested on the test server"
```

---

### Task 6: Release 1.9.0

**Files:**
- Modify: `CMakeLists.txt` (`VERSION 1.8.0` → `VERSION 1.9.0`)
- Modify: `nexus/changelog.txt` (the `1.9.0 (not released yet)` block already holds the thank-you line)
- Modify: `package/README.txt` (version header, settings list), `README.md` (settings table)
- Modify: `nexus/description.bbcode` ("New in 1.9.0" block, one settings line)

- [ ] **Step 1: Texts.**

`nexus/changelog.txt`: replace `1.9.0 (not released yet)` with:

```text
1.9.0
- Explore mode: ExploreMode=1 in livemap.ini shows only what your players found. The fog of
  war is always on and dark, places show once someone discovered them in the game, chests,
  shrines and other small markers once someone was within 50 m, and the search and "Where do I
  get it?" leave out the rest. Nobody can switch it off in the browser (the raw marker file
  stays readable for those who go looking). Needs Discovered=1. Asked for on Nexus and in
  GitHub issue #2.
```

Keep the existing Thanks line below it.

`package/README.txt`:
- change the title to `Enshrouded Live Map 1.9.0` (and the `=` underline to the same length);
- below the `Discovered=1` lines, add:

```text
ExploreMode=0          1 = show only what your players found: dark fog, places once
                       discovered, small markers within 50 m (needs Discovered=1)
```

`README.md`: below the `Discovered` row of the settings table, add:

```markdown
| `ExploreMode` | `0` | `1` = the map shows only what your players found: dark fog of war, places once discovered, chests and other small markers once a player was within 50 m; search and item sources follow. Needs `Discovered=1`. |
```

`nexus/description.bbcode`:
- rename the `[size=4][b]New in 1.8.0[/b][/size]` block to `New in 1.9.0`;
- make its first bullet:

```text
[*][b]Explore mode:[/b] [b]ExploreMode=1[/b] in livemap.ini shows only what your players found: dark fog, places once discovered, chests and other small markers once someone was within 50 m. Search and "Where do I get it?" follow, and nobody can turn it off in the browser.[/*]
```

- keep the 1.8.0 bullets below as `[*][b]1.8.0:[/b] server build 26430253 ...`, or move them into a one-line "1.8.0:" entry, matching how 1.7.0 was folded into 1.8.0 (see `git show 2fb9ffc -- nexus/description.bbcode`).

- [ ] **Step 2: Build, test and package.**
  - `cmd //c "C:\claudino\enshrouded-livemap\build.cmd"` (all tests pass)
  - `cd tools/perf && node explore_check.mjs && node fog_check.mjs` (ALL PASS)
  - `cmd //c "C:\claudino\enshrouded-livemap\package.cmd"` → `dist/EnshroudedLiveMap-1.9.0.zip` and `dist/EnshroudedLiveMap-HDMap-1.9.0.zip`
  - Check that the zip's `iphlpapi.dll` hash equals `build/iphlpapi.dll`.

- [ ] **Step 3: Commit.**

```bash
git add CMakeLists.txt nexus/changelog.txt package/README.txt README.md nexus/description.bbcode
git commit -m "1.9.0: explore mode"
```

- [ ] **Step 4: Ask Oggi for the OK to publish.** Then:
  1. Check `git fetch && git log origin/main..HEAD`. Only our commits may be listed; they include 1cd3184 with the thank-you lines, promised in issue #1.
  2. `git push`.
  3. `gh release create v1.9.0 dist/EnshroudedLiveMap-1.9.0.zip dist/EnshroudedLiveMap-HDMap-1.9.0.zip --title "Live Map 1.9.0" --notes-file <changelog excerpt>`.
  4. Nexus main file:

```bash
C:/claudino/nexus-cli/nexus.cmd upload enshrouded/209 dist/EnshroudedLiveMap-1.9.0.zip --to 8210925 --version 1.9.0 --name "EnshroudedLiveMap 1.9.0" --archive-old --mod-version --changelog @<1.9.0 changelog file> --yes
```

  5. Nexus HD file:

```bash
C:/claudino/nexus-cli/nexus.cmd upload enshrouded/209 dist/EnshroudedLiveMap-HDMap-1.9.0.zip --to 8217075 --category optional --version 1.9.0 --name "HD map style 1.9.0" --archive-old --no-primary --yes
```

  6. Run `nexus check enshrouded/209 --main <zip> --optional <hd zip>`, repeating while it says WAIT. Expected: PASS.
  7. `nexus description enshrouded/209 --full nexus/description.bbcode --yes`.

- [ ] **Step 5: Replies, after Oggi's OK for the texts.**
  - Nexus: reply under entrigant's comment 178349760 with `nexus reply`.
  - GitHub: comment on issue #2 that ExploreMode=1 shipped in v1.9.0, then close it.
  - Check public replies with a fresh browser without the login profile. The logged-in view is cached; see the nexus-cli note.

- [ ] **Step 6: Live server, only with Oggi's OK for the restart.**
  - Same file swap as in Task 5 Step 2, on `/mnt/hdd4t/enshrouded/server`, with `docker stop enshrouded` and `docker start enshrouded`.
  - Only the DLL and `livemap/index.html` change, plus `ExploreMode` set the way Oggi wants it on live.
  - `expected-kfc.sha256` does not list `iphlpapi.dll`, so the guard needs no change.
  - Afterwards, update `CHECKLIST.md` and the brain note `C:\rudari\prodo\notes\enshrouded-livemap.md`, putting the new value with its date on top and keeping the old one.
