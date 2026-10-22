"""Writes the web map's category icons from the game's own map marker textures.

The game keeps its map markers as keen::UiTextureResource with debug names mapmarker_*
(R8G8B8A8, 64 or 128 px). Each icon is cropped to its visible pixels, centred on a square and
scaled to SIZE px (drawn at about 36 px, so this is sharp on 2x screens too).

Usage (descriptors from `kfc-parser unpack -f tkeen::UiTextureResource`):
  python tools/extract_icons.py --game "C:/Program Files (x86)/Steam/steamapps/common/Enshrouded" \
      --textures <unpack folder>/UiTextureResource --out web/icons
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kfc_content import Kfc, texture  # noqa: E402

SIZE = 72
# web map category -> game marker texture. As in MapMarkerRegistryResource (marker type id =
# FNV-1a over the type guid, see extract_pois.MARKER_TYPES; its `icon` is the texture), checked
# 2026-10-22. The fast travel marker type has no icon there, so it gets the game's fast travel
# symbol.
ICONS = {
    "spire": "mapmarker_tower",
    "fasttravel": "mapmarker_fastTravel",
    "shrine": "mapmarker_flame_essence",
    "well": "mapmarker_well_plant",
    "town": "mapmarker_village",
    "dungeon": "mapmarker_dungeon",
    "nighttemple": "mapmarker_nighttemple",
    "crypt": "mapmarker_bigDungeon",
    "vault": "mapmarker_challenge_chamber",
    "cave": "mapmarker_cave",
    "mine": "mapmarker_mine",
    "gemforge": "mapmarker_shroudforge",
    "obelisk": "mapmarker_obelisk",
    "grave": "mapmarker_tomb",
    "fognest": "mapmarker_fognest",
    "enemycamp": "mapmarker_special_enemy_camp",
    "bossunlock": "mapmarker_balefire",
    "camp": "mapmarker_survivorcamp",
    "farm": "mapmarker_farm",
    "questarea": "mapmarker_investigation",
}


def find_descriptors(folder, names):
    found = {}
    for f in os.listdir(folder):
        if not f.endswith(".json"):
            continue
        d = json.load(open(os.path.join(folder, f), encoding="utf-8"))
        if d.get("debugName") in names:
            found[d["debugName"]] = d
    missing = set(names) - set(found)
    if missing:
        raise SystemExit("not found in %s: %s" % (folder, ", ".join(sorted(missing))))
    return found


def square_icon(rgba):
    a = rgba[:, :, 3]
    ys, xs = np.nonzero(a > 10)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = Image.fromarray(rgba[y0:y1, x0:x1])
    side = max(crop.width, crop.height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", required=True)
    ap.add_argument("--textures", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    kfc = Kfc(args.game)
    desc = find_descriptors(args.textures, set(ICONS.values()))
    os.makedirs(args.out, exist_ok=True)
    index = {}
    for cat, name in sorted(ICONS.items()):
        square_icon(texture(kfc, desc[name])).save(os.path.join(args.out, cat + ".png"), optimize=True)
        index[cat] = cat + ".png"
    with open(os.path.join(args.out, "icons.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(index, f, indent=1, sort_keys=True)
        f.write("\n")
    print("%d icons in %s" % (len(index), args.out))


if __name__ == "__main__":
    main()
