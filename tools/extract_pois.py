"""Builds web/pois.json (points of interest) from unpacked Enshrouded server data.

Sources (unpacked with kfc-parser, see docs/RESEARCH.md section 9):
  --server <dir>  unpacked enshrouded_server data: TemplateResource/ (entity templates; the ones
                  with a keen::ecs::MapMarker component are the game's map markers, the
                  LootChest_* ones are chests) and SceneEntityChunkResource/ (placed entities).

Entity transforms in the chunks are fixed point: value = hi + lo / 65536 (metres).

Usage: python tools/extract_pois.py --server <dir> --out web/pois.json [--survey]
"""
import argparse
import collections
import glob
import json
import os
import re
import sys

# Map marker types of build 25988414 (keen::ecs::MapMarker.markerType), named from the
# templates that use them. Order = order in the page's marker panel.
# Fast travel: only marker types the game's MapMarkerRegistryResource marks as fast travel
# destinations with an icon (checked 2026-10-22): 2bad3206 = the 8 Ancient Spires (tower icon),
# 5ebdad4b = the 2 Ancient Lands fast travel points (fast travel icon). Flame Altars and the
# home base are fast travel destinations too, but players build them, so they are not in the
# world data. Not used: 77997dbc (teleport platforms, save points in Fallen Crypts and towers,
# beacons, braziers; 168 entities) has no icon and is never shown on the game's map.
MARKER_TYPES = {
    "2bad3206-cad7-469a-a358-64ea99181416": "spire",
    "5ebdad4b-08b6-4578-8d63-fe9917449eaf": "fasttravel",
    "d486f2ce-66a3-4ef4-86a4-bf2ea9a24373": "shrine",
    "8cc3aae1-5041-462d-a03d-bb81cef9c611": "well",
    "8e313547-131a-46fe-b430-c8d028d52573": "town",
    "0d43c5d0-1d2c-41f0-9be1-fb214f013a82": "district",
    "61342e2e-823a-4f16-82fc-0e196487b775": "region",
    "58c32c26-6267-4b3f-b412-01a94f40184a": "landmark",
    "f6889e13-fe04-4a7f-99d2-b02195d7e888": "dungeon",
    "aee9062f-4642-438e-a743-1cb156b5673a": "nighttemple",
    "8d041ba5-4af7-46c4-b76b-3751c8d5a4d8": "crypt",
    "188d04bd-6710-4fea-b38c-34f0dc42eed6": "vault",
    "a9ea4318-7cbc-4804-ad6c-7d7a6e229be5": "cave",
    "9bdc9998-a8a4-4ede-979d-9a815e106df0": "mine",
    "2db08430-3cb3-4962-bda4-ac6d2e57654b": "gemforge",
    "643190e1-b5cf-44a2-8001-7508ea877847": "obelisk",
    "593043e8-6667-4f5e-94e0-52f6e2807956": "grave",
    "cbe63957-cac4-48be-a127-8137ff2a9c0e": "fognest",
    "fe05bfcd-bd2b-4761-923f-a00e5abd2579": "enemycamp",
    "073adc32-ceee-488a-9321-1d69c78418bb": "bossunlock",
    "c85fd053-92c1-4827-9aff-d8f0dfe73977": "camp",
    "fa92b5da-6559-45d5-a7c0-66e3b5d5a90a": "farm",
    "fffa09d9-623a-4daa-b202-c7b35bfb178b": "questarea",
}

CATEGORIES = [
    # id, label, colour, shown by default
    ("spire", "Ancient Spires", "#ffd36f", True),
    ("fasttravel", "Fast travel points", "#f2b766", True),
    ("spawnaltar", "Starting Flame Altar", "#ffc04d", True),
    ("shrine", "Flame Shrines & Temples", "#ff9f6f", True),
    ("well", "Elixir Wells & Shroud Roots", "#c67cff", True),
    ("town", "Towns & ruins", "#ece6f5", True),
    ("district", "Districts & special buildings", "#d9d2e6", False),
    ("region", "Region entrances", "#b49bff", False),
    ("landmark", "Landmarks", "#b49bff", False),
    ("dungeon", "Dungeons", "#ff7a7a", True),
    ("nighttemple", "Night Temples", "#ff5c8a", True),
    ("crypt", "Fallen Crypts", "#ff8fb1", True),
    ("vault", "Vaults & hidden places", "#ffb3c6", True),
    ("cave", "Caves", "#a0a0a0", True),
    ("mine", "Mines", "#c9a978", True),
    ("gemforge", "Gem forge stations", "#6fd3c7", True),
    ("obelisk", "Ancient obelisks", "#9fd36f", True),
    ("grave", "Hidden graves", "#cfcfcf", True),
    ("fognest", "Shroud nests", "#8f6fd3", True),
    ("enemycamp", "Enemy camps", "#ff6f6f", False),
    ("bossunlock", "Boss unlocks", "#ff3b3b", False),
    ("camp", "Camps & points of interest", "#d3b26f", False),
    ("farm", "Farms & fields", "#9fd36f", False),
    ("questarea", "Quest hint areas", "#7f7f9f", False),
    ("chest_gold", "Gold chests", "#ffcc33", False),
    ("chest_silver", "Silver chests", "#cfd8e3", False),
    ("chest_wood", "Wooden chests", "#b07d4f", False),
    ("sarcophagus", "Sarcophagi", "#9b8f7a", False),
    ("fishing", "Treasure fishing spots", "#6fb4ff", False),
]
CAT_INDEX = {c[0]: i for i, c in enumerate(CATEGORIES)}

SPAWN_ALTAR = re.compile(r"^Prop_NPC_Ancients_HolyFlame_\d+_Range_AwakeningChamber$")

# Readable names for the templates that occur most; everything else is derived from the name.
NICE_LABELS = [
    (r"^Teleport_Platform_SavePoint_Tower", "Fast travel point (tower)"),
    (r"^Teleport_Platform_SavePoint_FallenCrypt", "Fast travel point (Fallen Crypt)"),
    (r"^Teleport_Platform_SavePoint|^Teleporter_.*SavePoint", "Fast travel point"),
    (r"^Prop_Ancient_Dungeon_Beacon", "Ancient dungeon beacon"),
    (r"^Prop_Tower_Beacon", "Tower beacon"),
    (r"DragonBrazier", "Dragon brazier"),
    (r"HolyFlame_\d+_Range_AwakeningChamber", "Starting Flame Altar (Awakening Chamber)"),
    (r"FogWellPlant", "Shroud Root"),
    (r"ElixirWell", "Elixir Well"),
    (r"traversalCave|Cave_generic", "Cave"),
    (r"FlameShrine", "Flame Shrine"),
    (r"FlameTemple", "Flame Temple"),
    (r"gemForgeStation", "Gem forge station"),
    (r"NightTemple", "Night Temple"),
    (r"fogNest|fognest", "Shroud nest"),
    (r"ancient_obelisk|Obelisk", "Ancient obelisk"),
    (r"hiddenGrave", "Hidden grave"),
    (r"MapMarker_Tower_AncientLands_FastTravel_\d+_gardenIsland", "Fast travel point (Ancient Lands, Garden Island)"),
    (r"MapMarker_Tower_AncientLands_FastTravel_\d+_citadel", "Fast travel point (Ancient Lands, Citadel)"),
    (r"MapMarker_Tower_(\w+?)_FastTravel", r"Ancient Spire (\1)"),
    (r"enemyCamp", "Enemy camp"),
    (r"Town_Generic_abandoned", "Abandoned town"),
]

# Dungeon interiors are placed in the top-left corner of the world, outside the island.
INTERIOR_CORNERS = [(1600.0, 8000.0), (2600.0, 8200.0)]  # (x below, z above) rectangles

LABEL_STRIP = re.compile(
    r"^(8kmaplabel_|maplabel_|mapmarker_|_npc_|npc_)|_(noui|gameplay|gameplayonly|generic|placeholder)\b",
    re.I)
BIOMES = re.compile(r"\b(deepforest|steppes|grassland|coldheights|coldHeights|desert|wetlands|ancientlands|"
                    r"ancientLands|general|generic|talltrees|tallTrees)_", re.I)


def label_from(name):
    for pattern, label in NICE_LABELS:
        m = re.search(pattern, name)
        if m:
            return m.expand(label) if "\\1" in label else label
    s = LABEL_STRIP.sub("", name)
    s = BIOMES.sub("", s)
    s = re.sub(r"[_\-]+", " ", s).strip()
    s = re.sub(r"\s+\d+(\s|$)", r"\1", s)  # drop bare numbering like " 01"
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)  # camelCase -> words
    return s[:1].upper() + s[1:] if s else name


def chest_category(name):
    n = name.lower()
    if n.startswith("_fishinglocation"):
        return "fishing", ""
    if not n.startswith("lootchest_random"):
        return None, ""
    if "sarcophagus" in n:
        cat = "sarcophagus"
    elif "gold" in n:
        cat = "chest_gold"
    elif "silver" in n:
        cat = "chest_silver"
    elif "wood" in n or "shell" in n:
        cat = "chest_wood"
    else:
        return None, ""
    flags = []
    if "locked" in n:
        m = re.search(r"t(\d)-?t?(\d)?", n)
        flags.append("locked" + (f" T{m.group(1)}" + (f"-{m.group(2)}" if m.group(2) else "") if m else ""))
    if "fog" in n:
        flags.append("in the shroud")
    if "water" in n:
        flags.append("underwater")
    return cat, ", ".join(flags)


def load_templates(server_dir, names=None):
    """names: optional (GameTexts, {marker type guid: type name}) for the game's own names."""
    templates = {}
    for path in glob.glob(os.path.join(server_dir, "TemplateResource", "*.json")):
        try:
            d = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        name = d.get("name") or ""
        comps = d.get("components") or []
        marker = next((c["$value"] for c in comps if c.get("$type") == "keen::ecs::MapMarker"), None)
        cat, flags = (MARKER_TYPES.get(marker["markerType"]), "") if marker else chest_category(name)
        # The game's own first Flame Altar (Awakening Chamber): a fast travel destination with the
        # spawn altar icon on the game's map, but its template carries the platform marker type.
        if SPAWN_ALTAR.match(name):
            cat = "spawnaltar"
        if cat is None:
            continue
        if cat == "questarea" and "noui" in name.lower():
            continue
        label = label_from(name) if marker else CATEGORIES[CAT_INDEX[cat]][1].rstrip("s").replace("Sarcophagi", "Sarcophagus")
        if marker and names:
            game_name = names[0].by_guid(marker.get("markerId"))
            type_name = names[1].get(marker["markerType"])
            if game_name and type_name and game_name != type_name:
                label = type_name + " · " + game_name     # "Ancient Spire · Revelwood"
            elif game_name or type_name:
                label = game_name or type_name
        if flags:
            label += " (" + flags + ")"
        templates[d["$guid"]] = (cat, label, name)
    return templates


def fixed(hi, lo):
    return hi + lo / 65536.0


def load_instances(server_dir, templates):
    out = []
    for path in glob.glob(os.path.join(server_dir, "SceneEntityChunkResource", "*.json")):
        try:
            d = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        tpl = d.get("templates") or []
        for e in d.get("entities") or []:
            idx = e.get("templateIndex", -1)
            if not (0 <= idx < len(tpl)) or tpl[idx] not in templates:
                continue
            t = e.get("transform") or {}
            cat, label, name = templates[tpl[idx]]
            x = round(fixed(t.get("positionX1", 0), t.get("positionX0", 0)), 1)
            y = round(fixed(t.get("positionY1", 0), t.get("positionY0", 0)), 1)
            z = round(fixed(t.get("positionZ1", 0), t.get("positionZ0", 0)), 1)
            if any(x < cx and z > cz for cx, cz in INTERIOR_CORNERS):
                continue
            out.append((cat, x, y, z, label, name))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", required=True)
    ap.add_argument("--out")
    ap.add_argument("--survey", action="store_true")
    ap.add_argument("--game", help="client folder, for the game's own names (with --loca and --registry)")
    ap.add_argument("--loca", help="unpacked LocaTagCollectionResource json (client)")
    ap.add_argument("--registry", help="unpacked MapMarkerRegistryResource json (client)")
    ap.add_argument("--language", default="En_Us")
    a = ap.parse_args()
    names = None
    if a.game and a.loca and a.registry:
        from game_texts import GameTexts, guid_id
        texts = GameTexts(a.game, a.loca, a.language)
        registry = {v["markerId"]["value"]: v for v in json.load(open(a.registry, encoding="utf-8"))["mapMarkers"]["values"]}
        type_names = {}
        for g in MARKER_TYPES:
            v = registry.get(guid_id(g))
            if v and v.get("typeName"):
                type_names[g] = texts.by_guid(v["typeName"])
        names = (texts, type_names)
        print(f"game texts: {len(texts.texts)} ({a.language}), type names {type_names}", file=sys.stderr)
    templates = load_templates(a.server, names)
    instances = load_instances(a.server, templates)
    counts = collections.Counter(i[0] for i in instances)
    for cid, label, _, _ in CATEGORIES:
        print(f"{counts.get(cid, 0):6d} {label}", file=sys.stderr)
    if a.survey:
        for cat, x, y, z, label, name in instances[:40]:
            print(cat, x, y, z, repr(label), name)
        return
    # The most common label of a category is its default; points carry a label only when it differs.
    defaults = {}
    per_cat = collections.defaultdict(collections.Counter)
    for cat, x, y, z, label, _ in instances:
        per_cat[cat][label] += 1
    for cat, c in per_cat.items():
        defaults[cat] = c.most_common(1)[0][0]
    pois = []
    for cat, x, y, z, label, _ in instances:
        entry = [CAT_INDEX[cat], x, y, z]
        if label != defaults[cat]:
            entry.append(label)
        pois.append(entry)
    pois.sort(key=lambda e: (e[0], e[1], e[3]))
    data = {"categories": [{"id": c, "label": l, "color": col, "on": on, "label_default": defaults.get(c, l)}
                           for c, l, col, on in CATEGORIES],
            "pois": pois}
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(text)
    import gzip
    with gzip.open(a.out + ".gz", "wb", compresslevel=9) as f:
        f.write(text.encode("utf-8"))
    print(f"wrote {len(pois)} pois to {a.out} ({len(text) // 1024} KB, {os.path.getsize(a.out + '.gz') // 1024} KB gzipped)",
          file=sys.stderr)


if __name__ == "__main__":
    main()
