# Explore mode: a server switch that hides what nobody has found yet

Design for the first of three features promised on Nexus on 2026-11-25 (order: explore mode,
players in dungeons at the entrance, tiles lit from the top left). Asked for by entrigant
(comment 178349760) and unholyhakisak (178686288) on Nexus and by anthony-spruyt in GitHub issue
#2, whose name `ExploreMode` the setting takes. Decided with the user on 2026-11-25.

## Goal

A group that plays Enshrouded for the first time can keep the map open without it giving away
the world. With the switch on, the map shows only land someone has explored and only places
someone has discovered or been close to. Nobody on the page can turn this off.

Decisions:
- The page enforces it. The server only says the switch is on. Anyone who opens `pois.json`
  directly still sees every marker; the description says so. Server-side filtering was
  rejected: it would cost two to three times the work for a guard against deliberate cheating,
  which friends do not need.
- Small markers appear once a player was within 50 m.
- The fog stays at the game's 300 m.

## 1. Switch

`ExploreMode=0` in `livemap.ini` (default off), read in `config.cpp` next to `Discovered`.
- `/state` carries `"exploreMode":true` when it is on.
- With `Discovered=0` the server has no exploration data, so the switch would hide everything.
  In that case the DLL logs `ExploreMode needs Discovered=1; explore mode off` and leaves the
  switch off.

## 2. Server: the "near" grid

A second `explored::Store` with a radius of 50 m instead of 300 m, on the same grid of 512 x 512
cells of 20 m.
- `Store` gets its radius as a constructor argument. The existing store keeps
  `kRadiusMetres` (300).
- `refresh_explored()` in `world.cpp` reveals each position in both stores.
- The near store is saved to `livemap/near.json` in the same format and on the same schedule as
  `explored.json` (main.cpp).
- It is served at `/near`. `/state` gains `nearVersion`.
- The near store runs only when the switch is on, so servers without it pay nothing.

There is no near data from before the update. Small markers in areas explored earlier appear
once someone passes by again. The fog and the game's own discovered places are not affected,
because they come from the existing data.

## 3. Page with `exploreMode`

**Fog**
- Always on and fully opaque over unexplored land, instead of alpha 190.
- Explored land is the union of all players' areas.
- The player chooser can narrow it to one player but never widen it.
- The "Fog of war" checkbox and the "all places" choice of the Discovered filter are hidden.
  The mode is fixed to "discovered".

**Markers**
- Places with a discovery key (towns, dungeons, camps, …) show once anyone discovered them in
  the game (`/discovered`), as now.
- Every other marker (chests, shrines, wells, ore, …) shows once its position lies in a cell
  of the near grid.
- Finds, Flame Altars, players, creatures near players, weather and the clock stay as they are.
  Players made those, or they show only what is around players.

**Names**
- Place names show where the land is explored, as the Discovered filter shows them today.
- A region name shows once its label point lies in explored land.

**Search and "Where do I get it?"**
- They list only markers and places that are visible under these rules.
- Item sources count only visible chests and enemies, both for the list and for the "nearest
  one".

**Explanation**
- One line in the marker panel: "Explore mode: this server shows only what your group has found."

Pages from before 1.9.0 ignore the flag. With the switch on, the server therefore needs the new
page, which the zip includes as always.

## 4. Errors

- `/near` missing or failing (old DLL): small markers stay hidden. That is the safe side.
- The page logs once to the console.

## 5. Tests

- `tests/explored_test.cpp`: a store with radius 50 marks the cells within 50 m and nothing at
  60 m, and the to_json/from_json round trip still works. The 300 m cases stay unchanged.
- `tools/perf/explore_check.mjs` (like `fog_check.mjs`, fixtures with a small explored and
  near grid) checks:
  - a chest outside the near grid is missing and one inside it shows;
  - an undiscovered town is missing;
  - the fog is opaque and its checkbox is gone;
  - search finds no hidden marker.
- The existing page checks pass unchanged with the switch off.
- Game test on the test server, with `ExploreMode=1`:
  - walk to a chest; it appears within 50 m;
  - an unexplored region stays black.

## 6. Release

- Version 1.9.0: changelog, README.txt (new ini line), Nexus description ("New in 1.9.0" plus a
  line under the settings).
- Reply to entrigant and unholyhakisak once it is out.
- The live server gets the new DLL and page only after Oggi's OK for a restart.
