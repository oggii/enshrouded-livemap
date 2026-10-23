# Live map: research notes

Server build 25988414 (enshrouded_server.exe, TimeDateStamp 1792148062). Started 2026-10-20.
Goal: a server-side mod that serves a web page with the world map, live player positions,
in-game time and weather. Players install nothing.

## 1. Player positions (confirmed 2026-10-20 on the test server, in game)

Movement system FUN_140090c60 ("position += velocity * dt", also used by xpshare admin Speed).
At 0x140090e55 / e65 / e76 it adds the step to `[rdx]`, `[rdx+8]`, `[rdx+0x10]` with
`rdx = [rsp+0x58]`: the position as three int64 fixed-point values (value / 2^32 = metres,
same format as the client ESP transforms). 0x140090e7a is the join point after the adds (also
reached when the step is skipped), so a mid-hook there can read `[[rsp+0x58]]` for every
entity every tick. Entity id: `param_entity(rbx)` (rbx = system parameter, as in xpshare).

To check: which axis is up (expected y), and that players appear with the ids from the
player table.

## 2. Who is online, names (confirmed 2026-10-20)

Player table from xpshare admin (FUN_1407b34c0): manager+0x1e0, 16 slots of 0x148 bytes;
+0x0 handle, +0xA state (3 = in game), +0x10 permission bits, +0x18 entity id, +0x20 name.
Manager pointer from the login hook at 0x1407b42a5 (rsi).

## 3. In-game time (confirmed 2026-10-20 on a local Windows server)

Service registry FUN_140675e10(registry, {name, len}, object) registers "g38_daytime::Daytime"
(and "WeatherSystem", "VoxelWorld", ...) in FUN_14022d7d0. Hooking FUN_140675e10 at entry
gives every service pointer by name.

Daytime update FUN_14095d000 (log string "[g38_daytime] Ingame time not created"):
- `mov [rdi+0x48], rax` at 0x14095d1f2 stores the current time of day (int64).
- +0x28 / +0x30: day start / day end in the same unit; +0x58 byte: 1 while it is day.
- The client twin (0x140ea7df2) was used by the trainer: upper dword `[+0x4c]` = hour x 1000.
Server strings: `syncDaytime`, `syncDaytimeTick`, `adminSetDaytime`.

Confirmed: the value is **nanoseconds since midnight**. dayStart = 21600e9 (06:00), dayEnd = 79200e9
(22:00). In daytime the clock runs 32x real time (961 game seconds per 30 real seconds, default
settings). The trainer's "hour x 1000 in the upper dword" was a coincidence of the scale.

## 4. Weather (partly found)

The server owns a WeatherSystem (registered as "WeatherSystem", object = param_2[0x10] in
FUN_14022d7d0) and saves it (`weather.save_v0.WeatherSavedLayer`, `WeatherSavedLayerInstance`).
Weather is regional: layers with phenomenon instances (`WeatherSystemDebugState` ->
`WeatherSystemDebugLayerState` / `WeatherSystemDebugInstanceState`), not one global value.
`WeatherFrequency` (Disabled/Rare/Normal/Often) is a server setting.
Next: find the layer/instance arrays in the WeatherSystem object (the debug-state builder or the
save code lists them) and read phenomenon type + area per instance.

## 5. Map image (not in the server)

The server has no map art. The client stores the UI map as `UiMapResource` (opaque in the
kfc-parser reflection data) in enshrouded.kfc / .kfc_resources / .dat. Options: screenshot of
the in-game map (quick, for calibration), extract the texture from the client files on the
server owner's PC (no Keen art shipped), or render from terrain data like Dynmap.

## 6. Map images and coordinates (2026-10-20)

elxokker/Enshrouded-minimap (MIT, client minimap for Shroudtopia, Nexus #143) uses a world of
**10240 x 10240 m**: u = x / 10240, v = 1 - z / 10240 (north = +z up). Its repo ships the game's
own map texture (`assets/embervale_realmap_1280.rgba`, raw RGBA 1280x1280, Early Access world)
and a POI list (`embervale_pois.bin`, "EMPOI001"/"EMPOI002", 12-byte header, 16-byte entries
x, y, z float + kind). The Nexus 1.0 release adds a 2048x2048 "HD" texture (purple 1.0 world,
same art style as MetaForge). The web page now works in world metres (latlng = [z, x]) and
places each map image over [[0, 0], [10240, 10240]] unless maps.json gives other bounds; the
calibration helper computes those bounds from two points.

Nexus #143 main file "Minimap and Weather Clock 0.5.12" (Sparkweave Minimap, fork by Aerox912 of
elxokker's MIT minimap; source github.com/Aerox912/Enshrouded-minimap) ships
`embervale_realmap_default_2048.rgba` (HD, 1.0 world, purple) and the same Early Access
`embervale_realmap_1280.rgba` as upstream. Its realmap-provenance.json says the HD image was
"Nick supplied", author not yet identified, alignment 0..10240 "live alignment still unverified".
For a public release the HD image needs a clear source first. Solved 2026-10-22: the map is now
rendered from the game's own map data (section 13).

Weather on the client: the fork hooks the ambient_effects system's call to a weather sampler
(client RVA 0xa9b9e0, sampler(output, weather, position, time)) that returns four blend weights
Clear / Rain / Snow / Blizzard (WeatherState enum, names at client RVA 0x1bbb4d0, stride 0x28).
The server has the enum strings and the "ambient_effects" name, but not this sampler code
(byte search: 0 hits), so server weather needs its own path (WeatherSystem layers).

## 7. First in-game test (2026-10-20, test server on oggi, Wine)

- Name field +0x20 of the player slot is a string object: +0x20 pointer to the text, +0x28 length
  (12 for "OG Vanilla K"), +0x30 capacity (16). Read via the pointer, ends without NUL check needed.
- Position read for entity 1: x 3753, y 843 (height), z 1421 metres, updated several times per
  second while moving. On the HD map (0..10240 north-up) the marker sat where the player was in
  game; the user confirmed position and movement.

## 8. Weather, found 2026-10-20 (test server, read-only memory scans, then the mod)

- Weather resource (server kfc, WeatherSystemResource): world 10240 x 10240, 13 phenomena
  (0-3 clouds few/medium/overcast/fluffy, 4 and 9-12 rain, 5 rain_snow, 6-8 debug rain/blizzard/
  dragon), 9 layers: layer 0 clouds over the whole world (radius 15001/20001, 10-35 m/s), layers
  1-8 one precipitation zone each, restricted to a region mask (radius 4000-6000 m, 0-5 m/s,
  2-10 min).
- Runtime: service "WeatherSystem" (registry hook) +0x28 -> pool {allocator, records, capacity};
  72-byte records: +0x00 free-list word (bit 31 = free), +0x08 layer, +0x09 phenomenon,
  +0x10/+0x18/+0x20 spawn position (int64 32.32), +0x28 rotation, +0x2c radius, +0x30 speed,
  +0x38 spawn time, +0x40 despawn time (ns world time). [WS+0xc8] = 9 layer states, stride 0x18,
  first field = next phenomenon time.
- World time = daytime[+0x18] + (session time - daytime[+0x10]); session time = rbx at the
  daytime hook (param_2 of FUN_14095d000). Checked: active records' spawn/despawn bracket it.
- Not confirmed yet: drift direction (page assumes (cos, sin) of rotation in (x, z)); the circle is
  larger than the real rain area because each layer only rains inside its region mask; rain vs
  snow inside rain_snow depends on the snow border, the page says "Rain / snow".
- In-game check 2026-10-20 ~15:27 UTC: player at x 3366, z 1703; the page said "Rain" (zone with
  about 3 min left), and it was raining in game (rain visible, "Wet" status). First match.
- Same spot ~3 min later: page "Cloudy", game cloudy with some sun after the rain ended. Labels now split clouds_few/fluffy ("Partly cloudy") from clouds_medium ("Cloudy").

## 9. Points of interest (2026-10-20)

- The game's map markers are `keen::ecs::MapMarker` components on entity TEMPLATES
  (TemplateResource, 753 of 12267 server templates): markerType guid (24 types in use, named
  in tools/extract_pois.py from the template names), markerId = loca tag guid, dungeonId.
  Placed instances are in SceneEntityChunkResource (server unpack u-clean-25988414):
  entities[].templateIndex -> templates[] guid, transform fixed point (hi + lo/65536 metres).
  Neither the server nor the client chunks carry the component directly (0 hits), only templates.
- Chests are templates named LootChest_Random_<wood|silver|gold|shell>[_Locked_Pickable_T..]
  [_fog][_water][_Sarcophagus]: 3141 placed, plus 38 _FishingLocation_* treasure spots.
- Dungeon interiors are placed off the island in the corner x < 1600, z > 8000 (Fallen Crypt
  save points, 245 sarcophagi); the extractor drops them.
- kfc-parser filters need the qualified name (`-f tkeen::MapMarkerRegistryResource`); the client
  types come from `extract-types` run from a scratch copy of the tool (it writes
  reflection_data.json next to its own exe). The client MapMarkerRegistryResource only holds the
  49 marker TYPES (category, icon guid, fast travel flag), no positions. Localised names live in
  a compressed blob (LocaTagCollectionResource only references it), so labels come from the
  template names.
- Result: web/pois.json, 3721 points in 28 categories (3556 since 2026-10-22: fast travel
  only from registry fast travel destinations, see MARKER_TYPES in tools/extract_pois.py), rebuilt with
  `python tools/extract_pois.py --server <u-clean dir> --out web/pois.json`.

## 10. Icons (2026-10-20)

MapMarkerRegistryResource ids are FNV-1a (32 bit) over the marker type guid's little-endian
bytes (checked for all 24 types in use). The minimap mod's atlas `embervale_minimap_icons.bin`
("EMICO001", count, then {key u32, w, h, RGBA}) is keyed by the same ids, so
tools/extract_icons.py wrote web/icons/<category>.png for the 19 categories that have a game
icon. Since 2026-10-22 the icons come from the game files instead (section 13). Types without an icon in the game: fast travel platforms (icon null in the registry),
and the label-only types district / region / landmark (showLabel = 1, no icon), which the page
draws as text. Chests, sarcophagi and fishing spots get inline SVG glyphs.

## 11. Performance (2026-10-20)

Points of interest are drawn on one canvas layer (no DOM node per point): icons are
pre-rendered with their shadow per category and zoom step, only points inside the view are
drawn, hover does a hit test over the drawn points and shows a single tooltip. Measured in
Chromium at 1920x895 with all 28 categories on: 3.6 ms per full redraw at the whole-map zoom
(2696 points in view), 1.2 ms at zoom -1, under 0.6 ms zoomed in. Weather circles and player
rows are kept between the 250 ms updates and only changed when a value changes; a hidden tab
skips drawing. The server sends Cache-Control: max-age for images (1 day) and data files
(10 min), no-store for the page, /state and /events.

The judge is `node tools/perf/perf_check.mjs <page url>` (Playwright + Chrome DevTools protocol,
`npm install` in tools/perf once): time to the first full map on LAN / Fast 3G / Slow 3G, long
tasks and frame rate during 20 s of pan and zoom with all categories at 4x CPU throttling,
heap and DOM growth over a soak, seconds to reconnect after 10 s offline, transfer sizes. First
run: 9 s on Fast 3G and 37 s on Slow 3G (1.5 MB map), 36 long tasks up to 97 ms. Fixes: a 123 KB
preview image is shown first and the full image swapped in after it loaded (maps.json
`preview`), the HD image is re-encoded at quality 80 (1.0 MB), pois.json ships a gzip twin
(121 KB -> 39 KB, served when the browser accepts gzip) with per-category default labels,
redraws are limited to one per animation frame and skipped during zoom animations, icon
sprites are rendered once per category (scaled on draw) and points are projected with the
linear CRS directly, hits live in typed arrays.

Third judge run (test server, 2026-10-20): LAN 286 ms, Fast 3G 1.8 s, Slow 3G 6.7 s to the
first full map (1276 KB first load, cached afterwards), 0 long tasks and 59 fps during 20 s of
pan and zoom with all categories at 4x CPU throttling, +0.0 MB heap and +0 DOM nodes after a
60 s soak. Chromium's offline emulation does not cut an open event stream, so reconnection was
checked with a real restart of the test server while a page was open: status "connection lost,
retrying" 2 s after the stop, "live" again 2.4 s after /state answered (EventSource retries
every 3 s), 8 s of outage end to end.

Judge run 4 (after the rounding fix, bigger icons, sprite per size step, player arrows): LAN
218 ms, Fast 3G 1.8 s, Slow 3G 6.8 s, markers at all seven zoom levels with proper spread,
heap +0.0 MB; interaction at 4x CPU throttle: 56 fps and ONE long task of 53 ms in 20 s
(about 13 ms on an unthrottled machine). The 0-long-task target is missed by that one task;
left as is and reported.

The earlier "all 586 hits drawn" result hid a real bug: every point sat on one pixel because
latLngToContainerPoint rounds. Counting is not seeing; the judge now checks the spread and a
screenshot at several zoom levels is part of every render change.

## 12. Finds: ore at the dig hook, chests at the interaction system (2026-10-21)

**Ore.** The Shared XP mining site (FUN_140223520, store of the loot entry at +0x2236f8:
ebp = item id, r15d = amount, rbx = material index, rdi = mining context with the player's
entity id at +0x14c) names the item that a dig produced; `tools/extract_items.py` maps the
runtime item ids of all Material_* items to their names (`src/items_generated.h`). Only ore-like
names count (`finds::is_ore_like`), the position is the player's.

**Chests, static part (verified in game: not yet).** There is no "chest opened" event by name
that code references. The chain is: the client's actor event `LootInteractionActionEvent`
(FUN_1400753d0) and the generic interaction system FUN_1400a0340, which handles
`AcceptOfferedInteractionEvent {+0x10 guest, +0x14 entity, +0x18 offer}` and, when the offer
is current, stamps the entity's `InteractionOfferRuntime` (lastAcceptTime +0, defaultVerbId
+0x10, lastAcceptData.guestId +0x18, offerId +0x24, offer counter +0x28) and pushes an
`InteractionAcceptedEvent {+8 guest, +0xc entity, +0x10 offer}` (0x18 bytes) with
FUN_1405f5d00(queue, type, size). Hook site: 0x1400a0c4a, right after the last store into that
event (pattern `48 8b 44 24 38 8b 40 24 89 47 10 48 8b 74 24 30 4c 8b 4c 24 50 44 8b 85 58 74
00 00`, offset 0xb, unique). There: rdi = event, [rsp+0x38] = InteractionOfferRuntime*,
[rsp+0x48] = the entity record (from FUN_140646500(system, id): hash map at world+0x148,
records at world+0x188), [rbp+0x7450] = the system, [rbp+0x38] = pointer to the uint16 type
index of InteractionOfferRuntime that the system uses.

Which entities: templates with `InteractionOfferRuntime.defaultVerbId` 1317200649 are the
loot chests (69 LootChest_Random_* with RandomLootContainer) but also 104 others, among them
all player storage (Prop_Decoration_T*_Storage_*, Base_Chest_Player_Storage); 3711698580 is the
locked verb (29 locked random chests, 47 locked doors). So the verb only pre-filters; the
`keen::ecs::RandomLootContainer` component decides.

Component type ids are FNV-1a 32 of the full name ("keen::ecs::RandomLootContainer" =
0x061dda01, CurrentTransform 0x027ac564, InteractionOfferRuntime 0x78ee0f23; reflection
records in .rdata hold {short name, "ecs.Name", full name, size/align, member count, id}).
Systems use uint16 type indices: an entity record has its archetype at +0x18 (bitset of type
indices, offset table at +0x84, element size table at +0xa84, uint16 each), chunk data at +0x20
and the index in the chunk at +0x30 (FUN_1406535e0, FUN_140653690). The hash-to-index table
was not found statically (FUN_1406f3e10 is a 28-entry switch of another subsystem; entity
creation passes hashes into command records, resolved later). `ecs::find_type_table` therefore
searches at runtime: the registry (*world, bitsets at +0x190/+0x230) and everything its first
0x400 bytes point at, for the InteractionOfferRuntime hash at the known index with strides
4..128, accepting the spot where CurrentTransform and RandomLootContainer are also found below
0x280 and the chest's CurrentTransform has size 0x38. Fallback for the position only: the
first 0x38-byte component that reads like a transform (in-world int64 32.32 position and a
unit quaternion). Chests are recorded with `rl` true/false/null; the page drops false (player
storage) and shows unmatched null only when they sit within 3 m of a chest in the data.

Still open until the in-game test: whether the type table is found (log line "CHEST type
table"), whether lastAcceptData.guestId maps to anything we know (the player is taken as the
nearest one within 12 m instead), and whether opening a chest is the only path (a chest looted
by "take all" from a distance would go through the same accepted interaction).

## 13. The map and the icons from the game files (2026-10-22)

The client keeps resources in `enshrouded.kfc` and binary content in `enshrouded_NNN.dat`.
Layout after kfc-parser (github.com/Brabb3l/kfc-parser, GPL-3.0, only the layout used; our reader
is tools/kfc_content.py): KFC4 header, then 16 locations {u32 offset relative to the field, u32
count}; content map = keys ContentHash {size, hash0, hash1, hash2} and values {u32 offset,
u16 flags, u16 container, 8 padding}; a blob is `size` bytes at `offset` in
enshrouded_<container>.dat. Texture descriptors (keen::UiTextureResource, 5699 of them) come
from `kfc-parser unpack -f tkeen::UiTextureResource`.

**The in-game map is not a picture.** keen::UiMapResource 01bcbd07-bdbf-41c0-9999-5d58fb1a3aa1
(tileCount 10 x 10) has 207 texture parts, which a shader combines:

| Part | Name | Format | Content |
|---|---|---|---|
| 0 | baseGradient | 151 x 1 RGBA | colour by height, dark purple (59,42,55) to beige (169,169,156) |
| 1 | isolineGradient | 128 x 1 RGBA | contour line colour by height |
| 2 | fogZoneBorderGradient | 32 x 1 | brightness across a shroud border (0 at the edge, peak, plateau) |
| 3 | fogNoise | 512^2 BC4 | cloud noise |
| 4, 5 | fogZoneNormal, fogZoneDangerous | 256^2 BC7 | tiling shroud textures, teal and pink |
| 6 | baseHeight | 1280^2 R16 | height, 8 m per pixel, values 8415..38692, sea floor 9073 |
| 7 + 2(y*10+x) | DetailHeight(x,y) | 1024^2 BC4 | baked relief shading at 1 m per pixel, 127 = flat, lit from the top left |
| 8 + 2(y*10+x) | FogZone(x,y) | 1024^2 BC5 | ch0 distance inside a shroud zone (0 outside, about 12 at the edge, 255 deep inside); ch1 zone level: 0 land, 1..10 shroud, 16 outside the world |

- Tile row y belongs at image row block 9 - y (north up); found by matching each FogZone tile's
  "outside" mask against baseHeight (37 of 37 tiles with land and sea pointed to row 9 - y,
  correlation 0.55 to 0.89).
- Orientation and scale: the 3697 POI heights against baseHeight at (x, 10240 - z) give
  r = 0.905 (south-up 0.12, mirrored -0.41); metres = 0.0517 * baseHeight + 129.6.
- Alignment to the metre: the relief strength around the POIs (3 x 3 m mean of |shading - 127|)
  peaks at a shift of (-2, -2) m, so the map sits within about 2 m of the game's coordinates.
- The shader is not in the data. tools/render_map.py uses the game's textures with our own
  choices: height mapped from the sea floor to 31500 (gamma 0.5), land gain 1.2 (land 27 %
  brighter than the first try, 0.2 % of land pixels clip), shading strength 1.5,
  contours every 25 m and 125 m, shroud texture at 640 m per repeat with 38 % opacity and a dark
  edge line, land outside the world faded into the sea colour.
- Output: web/tiles, Leaflet CRS.Simple tiles of 512 px, zoom -5 to 0 (0 = 1 m per pixel),
  named with Leaflet's own coordinates (grid from the south-west corner, y negative):
  539 files, 9.0 MB. The old 2048 px HD image was 5 m per pixel.

**Icons:** the map markers are UiTextureResource with debug names mapmarker_* (53, 64 or
128 px). MapMarkerRegistryResource (49 entries) gives each marker type its `icon` texture guid;
tools/extract_icons.py uses that mapping (checked 2026-10-22, 19 of 19 categories with an icon;
fast travel has none there and gets mapmarker_fastTravel), crops each icon to its visible
pixels and writes 72 px PNGs. The registry also says enemy camps are drawn larger
(iconDisplaySize 100 instead of 70).

## 14. Flame Altars (player bases) and player names (2026-10-22)

- The server registers a service `PlayerBasesSystemServer`; altars carry `keen::ecs::BaseIdComponent`
  (BaseId 16 bytes, wasAbandoned at +0x28). Found the altar data first with a read-only scan of
  the test server's memory (3.7 GB of writable regions streamed to the host, numpy): the 7 altar
  positions read off an in-game map screenshot (scale from two spires, 2.4 m per pixel) all sit
  in one ECS chunk of 56-byte transforms (position 3 x int64 32.32, quaternion, scale), 10
  entries = "ACTIVE ALTARS 10" in the game.
- Code path: the ECS system `add_buildzones_server` (name in a .rdata system table:
  {name ptr, length, function}) = FUN_1400e90e0 (25988414) / FUN_1400e9f90 (26083076). It runs
  every tick, once per ECS chunk (8 + 2 altars = two calls, about 20 times a second), with an
  iterator at [rbp-0x20]: [rbp-0x18] = BaseIdComponent, [rbp-0x10] = transform, [rbp-0x8] = build
  zone (size float3 at +4, half the side: the zone box is position +- size). The DLL hooks the
  loop head 0x100 bytes after the function start (pattern `bases`, unique in both builds).
  Altars not seen for 10 s count as removed.
- Checked on the test server: the hook reports the same 10 altars as the memory scan, to the
  centimetre; build zones 40 x 40 m, the main base 80 x 80 m. On the web map every altar sits
  within 2 to 4 px of the in-game map screenshot at the same scale.
- The game's starting altar is not a player base: template
  `Prop_NPC_Ancients_HolyFlame_01_Range_AwakeningChamber` at (3695.0, 902.0, 1213.5) with the
  teleport platform marker type; tools/extract_pois.py puts it in its own category (spawn altar
  icon). 1.0.1 had dropped it with the platforms.
- Player names: the slot's name field is {char* data, u64 length, u64 capacity}, UTF-8 (raw
  dumps: "OG Vanilla K" 12/16, a 19-byte name 19/32). 1.0.x read the field as inline text first;
  a pointer without an early zero byte became a garbled name. Now pointer + length, cleaned to
  valid UTF-8 (src/text.cpp, tests/text_test.cpp).

## 15. Weather the way the client computes it (2026-10-22)

Reported: the page said "Rain" for players while it was dry in game. Cause: the page counted
everything inside a zone's circle as rain. The client decides in FUN_140a9b9e0 (client build of
2026-10-17; RVA 0xa9d530 in the build of 2026-10-20, found by the entry bytes the Sparkweave
Minimap uses), `sample(out[4], weather, position, time)` -> weights Clear / Rain / Snow / Blizzard:

- For every zone whose phenomenon has an effect (Rain = 1, Blizzard = 2; the cloud phenomena of
  layer 0 have none): v = fade (FUN_140a98860: ramp over spawnFadeTime after spawn, times the
  ramp over despawnFadeTime before despawn) x restrictMask(layer) x (1 - excludeMask(layer)) x
  rainMask(u, v), then v = clamp(v - rainThreshold, 0, 1) / (1 - rainThreshold); summed per
  effect, each capped at 1, rain = max(rain - blizzard, 0).
- Region masks are sampled at (x * worldToRelative.x, z * worldToRelative.y) (checked in the
  machine code before the call). The rain mask at the offset from the zone centre, divided by the
  radius and rotated: u = (dz sin r + dx cos r) / 2 + 1/2, v = (dz cos r - dx sin r) / 2 + 1/2;
  tiling phenomena wrap, the others clamp to 0.
- The zone centre moves along (cos r, sin r) at its speed (FUN_140a988e0), as the page assumed.
- Masks (FUN_140a97f10, tiled FUN_140a97b00): 1-bit images, originalSize, a stored sub-rectangle
  (pixelOffset, pixelCount), bits row by row, least significant first, row 0 at z = 0; bilinear
  over the four neighbours at (size * u - 0.5, size * v - 0.5).
- Snow: s = clamp(y * 0.03125 - 40.84375, 0, 1) x snowBorderMask (snowBorderRangeMapping): above
  about 1307 m and inside the mask. Output: clear = 1 - rain - blizzard, rain = (rain + blizzard)
  (1 - s), snow = rain s, blizzard = blizzard s.
- Data (WeatherSystemResource): 8 layer masks of 64 x 64 cells (160 m) that follow the biome
  borders; rain phenomena threshold 0.25 with rain mask 2 (77 x 77, only a 40 x 36 part set, so
  rain falls in a blob in the middle of the circle); layers 4 and 8 have no phenomenon (never
  rain); fades 20 s. tools/extract_weather.py writes web/weather.json (122 KB, with a 256 x 256
  snow factor grid from the game's height map). Check: the computed snow factor is white exactly
  on the snowy peaks of the HD map, and the region borders follow the biome borders.
- Page: livemap.weather.* in the console; the rain and snow that falls is a 256 x 256 raster
  (40 m) redrawn every 3 s (about 3 ms with three active zones), hover text through the marker
  hit test (nothing takes the pointer). Player labels: Light rain below 35 %, Rain, Snow, else the
  cloud cover of layer 0.
- Not yet checked in game: the first rain under the new model.

## 16. The game's own names, and player altar names (2026-10-22)

- Every MapMarker has `markerId`, a LocaTag guid. The client keeps the texts per language in one
  content blob of LocaTagCollectionResource (En_Us 1.7 MB, 16715 texts; LocaTagResource 24 bytes:
  id, text {offset, length}, arguments, genericArguments). The id is FNV-1a 32 over the guid's
  little-endian bytes, like the marker type ids (MapMarker_Tower_Capital_FastTravel ->
  "Revelwood", which the game shows as "Ancient Spire / Revelwood"). Marker types with a
  `typeName` in MapMarkerRegistryResource: only Ancient Spire and Fast Travel Point. Texts carry
  markup (<location>, <npc>, <lorename>, <craftingstation>) that tools/game_texts.py strips.
  Result: "Ancient Spire · Revelwood", "Passage to the Blackmire", "Braelyn Bridge",
  'Balefire Garrison "White Pine"', "Collections: Hollow" ... (tools/extract_pois.py --game
  --loca --registry).
- Player-given altar names ("HOME level 1" in the game's map): not on the server. Read-only
  searches on the live server: pointer walk from PlayerBasesSystemServer and
  CustomPlayerStringsSystem (about 5000 objects each), the whole writable memory for "home level"
  (case-insensitive, UTF-8 and UTF-16, 1 min at nice 19), and the world save world0.ksd (SV2C file
  with S2BH chunks, 3 zstd frames, 36 KB unpacked): no hit. What the server has: a table of
  account names (S2BH record: account id hash -> display name, e.g. "SS Kommandozentrale",
  "Cybertonic", "FindOnePiece"). The local character saves (Steam userdata 1203620, last written
  before the name was seen) had no hit either. Open: whether other players see such a name.

## 17. Flame level and deadly shroud (23 Oct 2026)

- Every shroud zone has a level 1..10 (channel 1 of the FogZone textures, section 13). The game
  draws a zone with `fogZoneDangerous` (pink) when its level is above the world's Flame level
  (shroud passage level; upgrading the Flame Altar turns deadly shroud normal). `web/shroud.png`
  (2048^2, 5 m per pixel) holds the levels; the page compares them with the Flame level.
- The server tells Steam the Flame level itself: A2S_INFO on the query port carries keywords
  `3;1273043;1;0;1;1;1;0;0`, first = Flame level (3 on our world, matching the game's Game
  Progress panel), second = the game's build number; the order matches `keen::GameParameters`
  {flameLevel, gameSettingsPreset, voiceChatMode, isVoiceChatEnabled, isTextChatEnabled}. The DLL
  asks 127.0.0.1:<queryPort> once a minute (works under Wine) and puts `flameLevel` in /state.
- Marker discovery (Nexus request 23 Oct, Known/Undiscovered filter), measured on the live server
  (build 26083076) with read-only memory dumps before and after a flight:
  - Each marker template has `RuntimeMapMarkerUnlockRequirements.visibleStateQuery` = SimpleBool,
    compare 1, `isExplicitPlayerKnowledgeQuery` true (275 templates; 32 world-scoped) with a
    knowledge id. "Discovered" = that id set to 1 in the player's knowledge. Hint/completed are
    `Extern` queries. `MapMarkerVisibilityState` is one value per entity (Hidden/Hint/Visible/
    Completed), not per player.
  - These ids are NOT in the static knowledge descriptor table (5280 entries, 0 matches) and not
    stored as id lists in world0.ksd. They live in a per-player dynamic knowledge map: sorted key
    array (uint32 ids) + parallel uint32 value array, wrapped as {ptr, count, capacity 11000,
    allocator image+0x6ebb50, image+0x14ca308}; values 1 = set, >1 = counters. The online player's
    map held 1243 entries before and 1245 after the flight; 44 of the 297 marker instances with a
    visible id were in it, all in the south (where the player has been), none in the north.
  - 81 such maps in memory, in groups of three with stride 0x5620 (one record per player slot;
    only the first record filled while one player was online). A second, identical copy of the
    key array exists (replication). The record's area is referenced from ServerPlayers-0x18
    (0x7344583fd090 -> 0x7345271cd770); no pointer path of depth 3 from the G38Knowledge,
    KnowledgeReplicationServer or ServerPlayers services reached the record yet.
  - Open: a stable way for the DLL to find each player's map (static RE of the code that fills
    it, e.g. the users of the 11000 capacity), and which slot a record belongs to.
