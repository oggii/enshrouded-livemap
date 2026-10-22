# Plan: finds (ore map and looted chests)

Spec: docs/superpowers/specs/2026-10-21-finds-ore-map-design.md. Each step ends with something
checked by a tool or in game, not by eye.

Status 2026-10-21 00:35: steps 1-5 done (research in RESEARCH.md section 12, DLL + page on the
test server, rollback iphlpapi.dll.pre-finds). Step 6 (in game) open: mine ore, open a random
chest, read the INTERACT / CHEST lines in livemap.log, then the live server.

1. **Research: material at the mining hook** (box 3 h). Ghidra: FUN_140226c40 and callers; what
   is in the mining context (rbp) besides the entity id at +0x14c; where the voxel material id
   comes from. Confirm with a read-only probe on the test server while the user mines two
   different ores. Output: offsets in docs/RESEARCH.md section 12, or "not found" and the XP
   hint fallback.
2. **Research: chest open event** (box 3 h). Ghidra from `g38_loot::LootGenerationSystem`,
   `DestroyOnLoot`, `AreaLoot`; find the server function that runs once when a player opens a
   LootChest_Random_* and yields the chest entity. Confirm with a probe while the user opens a
   chest. Output: pattern + registers in RESEARCH.md, or "not found" and a report to the user.
3. **DLL: finds store** (`src/finds.h/.cpp`): deposits + looted chests in memory, merge rules
   from the spec, version counter, JSON load/save (atomic, 5 s), unit test
   `tests/finds_test.cpp` wired into CMake/ctest.
4. **DLL: hooks** in `world.cpp`/`scan.cpp`: mining site (pattern from Shared XP) and chest
   site, both optional; `/finds` route and `findsVersion` in the snapshot (`web.cpp`).
   Check: selftest finds the sites; local Windows server loads with the hooks.
5. **Page**: Finds group in the panel, pickaxe glyph per sort, grey check for looted chests,
   "Hide looted chests", refetch on `findsVersion` change. Check: judge passes; a hand-written
   finds.json renders.
6. **In game** on the test server: mine ore (deposit within 5 s), open a chest (grey within
   5 s), restart (both survive). Then the live server when nobody is online.
