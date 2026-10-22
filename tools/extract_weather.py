"""Writes web/weather.json: what the page needs to compute rain and snow the way the game does.

Source: the server's keen::WeatherSystemResource (unpacked with kfc-parser). The game client
decides the weather at a point in FUN_140a9b9e0 (client build of 2026-10-17; 0xa9d530 in the
build of 2026-10-20), see docs/RESEARCH.md section 15. For every active weather instance whose
phenomenon has an effect (rain or blizzard):
  v = fade(time) * restrictMask(layer) * (1 - excludeMask(layer)) * rainMask(rotated offset)
  v = clamp(v - rainThreshold, 0, 1) / (1 - rainThreshold)
summed per effect; snow = clamp(y * a + b, 0, 1) * snowBorderMask decides rain or snow.

Masks are 1-bit images: originalSize, a stored sub-rectangle (pixelOffset, pixelCount) and the
bits row by row, least significant bit first, row 0 at z = 0 (south). They are sampled
bilinearly at relative coordinates (x * worldToRelative.x, z * worldToRelative.y), or for the
rain mask at the offset from the zone centre rotated by the zone's rotation, /radius * 0.5 + 0.5.

With --game/--textures the file also gets a 256 x 256 grid of the snow factor (from the game's
height map), so the page can colour snow without a player standing there.

Usage: python tools/extract_weather.py --server <u-clean dir> --out web/weather.json
           [--game <client dir> --textures <unpack>/UiTextureResource]
"""
import argparse
import base64
import glob
import gzip
import json
import os
import sys

import numpy as np


def mask_json(m):
    return {"w2r": [m["worldToRelative"]["x"], m["worldToRelative"]["y"]],
            "size": [m["originalSize"]["x"], m["originalSize"]["y"]],
            "offset": [m["pixelOffset"]["x"], m["pixelOffset"]["y"]],
            "count": [m["pixelCount"]["x"], m["pixelCount"]["y"]],
            "bits": base64.b64encode(bytes(m["pixelData"])).decode()}


def sample(m, u, v):
    """Bilinear sample of a mask at relative (u, v), as the client does (numpy arrays)."""
    bits = np.unpackbits(np.frombuffer(bytes(m["pixelData"]), np.uint8), bitorder="little")
    sx, sy = m["originalSize"]["x"], m["originalSize"]["y"]
    ox, oy = m["pixelOffset"]["x"], m["pixelOffset"]["y"]
    cx, cy = m["pixelCount"]["x"], m["pixelCount"]["y"]
    fx, fy = sx * u - 0.5, sy * v - 0.5
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - x0, fy - y0

    def bit(px, py):
        ok = (px >= 0) & (py >= 0) & (px < sx) & (py < sy) & (px >= ox) & (py >= oy) & (px < ox + cx) & (py < oy + cy)
        idx = np.where(ok, (py - oy) * cx + (px - ox), 0)
        return np.where(ok, bits[np.clip(idx, 0, len(bits) - 1)], 0).astype(np.float32)

    a = bit(x0, y0) + (bit(x0 + 1, y0) - bit(x0, y0)) * tx
    b = bit(x0, y0 + 1) + (bit(x0 + 1, y0 + 1) - bit(x0, y0 + 1)) * tx
    return a + (b - a) * ty


def snow_grid(resource, game, textures, n=256):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import render_map
    from PIL import Image
    data = render_map.load(game, textures)
    base = data["base"]                       # 1280 x 1280, row 0 = north
    metres = base * render_map.METRES_PER_UNIT + 129.6
    h = np.asarray(Image.fromarray(metres.astype(np.float32), "F").resize((n, n), Image.BILINEAR), np.float32)
    h = h[::-1]                               # row 0 = south, like the masks
    a, b = resource["snowBorderRangeMapping"]["x"], resource["snowBorderRangeMapping"]["y"]
    world = resource["worldSize"]["x"]
    c = (np.arange(n) + 0.5) * world / n
    xs, zs = np.meshgrid(c, c)
    m = resource["snowBorderMask"]
    snow = np.clip(h * a + b, 0, 1) * sample(m, xs * m["worldToRelative"]["x"], zs * m["worldToRelative"]["y"])
    return base64.b64encode(np.round(snow * 255).astype(np.uint8).tobytes()).decode()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--game")
    ap.add_argument("--textures")
    args = ap.parse_args()
    path = glob.glob(os.path.join(args.server, "WeatherSystemResource", "*.json"))[0]
    r = json.load(open(path, encoding="utf-8"))
    out = {
        "source": "keen::WeatherSystemResource " + r["$guid"],
        "worldSize": r["worldSize"]["x"],
        "snowRange": [r["snowBorderRangeMapping"]["x"], r["snowBorderRangeMapping"]["y"]],
        "snowMask": mask_json(r["snowBorderMask"]),
        "layers": [{"restrict": L["restrictMaskIndex"], "exclude": L["excludeMaskIndex"]} for L in r["layers"]],
        "layerMasks": [mask_json(m["mask"]) for m in r["layerMasks"]],
        "rainMasks": [mask_json(m) for m in r["rainMasks"]],
        "phenomena": [{"name": p["debugName"], "effect": p.get("effect") or "None",
                       "fadeIn": p["spawnFadeTime"]["value"] / 1e9, "fadeOut": p["despawnFadeTime"]["value"] / 1e9,
                       "threshold": p.get("rainThreshold", 1.0), "rainMask": p.get("rainMaskIndex", 255),
                       "tiling": "Tiling" in p["flags"], "rotation": "Rotation" in p["flags"]}
                      for p in r["phenomenons"]],
    }
    if args.game and args.textures:
        out["snowGrid"] = {"n": 256, "bytes": snow_grid(r, args.game, args.textures)}
    text = json.dumps(out, separators=(",", ":"))
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    # Pre-compressed twin: the web server sends it to browsers that accept gzip.
    with gzip.open(args.out + ".gz", "wb", compresslevel=9) as f:
        f.write(text.encode("utf-8"))
    print("wrote %s (%d KB, %d KB gzipped)" % (args.out, os.path.getsize(args.out) // 1024,
                                              os.path.getsize(args.out + ".gz") // 1024))


if __name__ == "__main__":
    main()
