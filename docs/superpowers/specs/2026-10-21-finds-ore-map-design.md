# Finds: a self-filling ore map and looted chests

Design for the first of four sub-projects of the live map (ore map and chests; then friend
navigation; then waypoints and death spots; then server overview). Decided with the user on
2026-10-21.

## Goal

Every ore a player on the server mines and every chest a player opens shows up on the web map
for everyone, within 5 seconds, and stays there across server restarts. The map fills itself
while people play; nobody has to note anything down. A map pre-filled with every ore in the
world is out of scope: ore lives in the voxel terrain, whose format is not documented.

Decisions: one shared map for the whole server (no per-player view); chests are marked looted
automatically by the server, not by hand; if the ore sort cannot be read, finds are still shown
as "ore" with the XP per hit as a hint, and the sort is added once it is found.

## 1. Capture in the server mod (DLL)

**Mining hook.** The livemap DLL hooks the mining XP site known from Shared XP: FUN_140226c40,
`add [rcx+rdx*4], r15d` at 0x140226cbc (pattern `0f b7 4e 04 4c 8b c3 48 03 ce 44 01 3c 91 48 8d
4c 24 30`, hook offset 10). At that point r15d is the XP amount and the mining context in rbp
holds the entity id at +0x14c. The player's position comes from the player slot of that entity
(the movement hook keeps it current). The research step (section 3) looks for the material id of
the mined voxel in the same context; until it is found, the sort is "unknown" and the XP per hit
is stored instead.

**Deposits, not hits.** Hits within 6 m of an existing deposit of the same sort (or unknown sort)
join it: the deposit keeps the running mean position, hit count, XP per hit, first and last time,
and the names of the finders (up to 8). Otherwise a new deposit starts. Deposits are never
removed.

**Chest hook.** The research step finds where the server handles a player opening a loot chest
(entry points: service `g38_loot::LootGenerationSystem`, components `DestroyOnLoot`,
`AreaLoot`, templates `LootChest_Random_*`). The hook yields the chest entity; its position is
read from its transform, matched to the nearest chest in web/pois.json within 3 m and stored as
looted with the player's name and the time. A chest with no match within 3 m is stored as an
"unknown chest" with its position.

**Optional hooks.** Both hooks are installed only if their patterns match exactly once. A missing
pattern is logged once; positions, time, weather and the markers keep working.

**Storage.** `livemap/finds.json` next to the server exe:

```
{ "version": 12,
  "ore": [ { "x": 3753.2, "y": 843.0, "z": 1420.9, "sort": "copper" | null, "xp": 10, "hits": 14,
             "first": 1792530000, "last": 1792531000, "by": ["OG Vanilla K"] } ],
  "chests": [ { "x": 3170.5, "y": 828.4, "z": 2684.7, "poi": 2211 | null, "by": "OG Vanilla K", "at": 1792530500 } ] }
```

Times are Unix seconds. `poi` is the index into `pois.json`'s `pois` array, or null for an
unknown chest. The file is loaded at start, written at most every 5 s when something changed,
atomically (write `finds.json.tmp`, then rename). A write error is logged and retried at the
next change; the finds stay in memory.

**Delivery.** `GET /finds?key=...` returns the file's content (JSON, `Cache-Control: no-store`).
The `/state` snapshot and the `/events` stream carry `"findsVersion": <n>`, incremented on every
change, so the page fetches `/finds` only when the number changes.

## 2. Display on the map

- The markers panel gets a third group, **Finds**: one row per known ore sort (Copper, Tin,
  Iron, ..., named from the material research) and one row "Ore (sort unknown)" while any
  deposit lacks a sort. Rows have a count and a toggle like the other categories; the browser
  remembers the choice.
- Ore icon: a pickaxe glyph (inline SVG, like the chest glyph) in the sort's colour, sized like
  the loot icons. Tooltip: "Copper ore · 14 hits · found by OG Vanilla K, 20.10."; for unknown
  sorts "Ore · 10 XP per hit · 14 hits · found by ...".
- Looted chests stay in their category but are drawn grey with a check mark; the tooltip adds
  "looted by X, 20.10.". A switch "Hide looted chests" (default off) sits under the Loot group.
  Unknown looted chests are drawn as a grey check mark at their position.
- Finds are drawn by the same canvas layer as the points of interest (`PoiLayer`), as extra
  categories merged into `poiData` at load and on every `/finds` refresh. A new deposit appears
  within 5 s of the first hit (write interval plus the next stream message).

## 3. Research, failure handling, verification

**Research first, time-boxed.**
1. Material id at the mining hook: Ghidra decompile of FUN_140226c40 and its callers, then
   read-only memory probes on the test server while the user mines; at most 3 hours.
2. Chest open event: Ghidra from the loot services and components named above, confirmed by a
   probe on the test server while the user opens a chest; at most 3 hours.
When a box runs out, the state is reported and the user decides (no silent switch to manual
marking).

**Failure handling.** A mining hit without a readable position is skipped and logged once per
entity. A chest without a pois.json match is kept as unknown. Patterns that do not match keep the
mod running without that hook. File errors are logged, never fatal.

**Verification.**
- Unit test `tests/finds_test.cpp` (plain asserts, like Shared XP's ledger test) for the deposit
  merging: hits within 6 m merge, beyond 6 m start a new deposit, different sorts never merge,
  finders are de-duplicated, mean position updates, version increments only on change.
- In game on the test server: mine a known ore deposit, the deposit appears on the map at the
  player's position within 5 s; open a chest, it turns grey within 5 s; restart the server, both
  survive.
- `tools/perf/perf_check.mjs` keeps passing.

**Out of scope here:** real in-game place names, waypoints, friend navigation, server
statistics; a pre-filled ore map from the terrain data.
