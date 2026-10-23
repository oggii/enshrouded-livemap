"""Writes web/shroud.png: the level of every shroud zone, for the page's deadly-shroud overlay.

Source: channel 1 of the FogZone textures of the game's map (keen::UiMapResource, see
render_map.py and docs/RESEARCH.md section 13): 0 land, 1..10 shroud zone level, 16 outside the
world. The game draws a zone with its "dangerous" shroud texture when the zone's level is above
the world's Flame level (the shroud passage level); the page does the same with the Flame level
the server reports.

Output: one byte per pixel (PNG mode L), 2048 x 2048, 5 m per pixel, row 0 = north edge, column
0 = west edge. Each pixel is the level at the centre of its 5 x 5 m cell.

Usage:
  python tools/extract_shroud.py --game "C:/Program Files (x86)/Steam/steamapps/common/Enshrouded" \
      --textures <unpack folder>/UiTextureResource --out web/shroud.png
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_map  # noqa: E402

SIZE = 2048


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", required=True)
    ap.add_argument("--textures", required=True)
    ap.add_argument("--out", default="web/shroud.png")
    args = ap.parse_args()
    fog = render_map.load(args.game, args.textures)["fog"]
    step = render_map.WORLD // SIZE
    level = np.ascontiguousarray(fog[step // 2::step, step // 2::step, 1])
    assert level.shape == (SIZE, SIZE), level.shape
    Image.fromarray(level, "L").save(args.out, optimize=True)
    values, counts = np.unique(level, return_counts=True)
    print(args.out, os.path.getsize(args.out), "bytes")
    print("level: share of the world", {int(v): "%.1f %%" % (100 * c / level.size) for v, c in zip(values, counts)})


if __name__ == "__main__":
    main()
