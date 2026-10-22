"""Renders the world map from the game's own map data and cuts it into web map tiles.

The in-game map is not a painted picture: the game draws it with a shader from the textures of
keen::UiMapResource 01bcbd07-bdbf-41c0-9999-5d58fb1a3aa1 (see docs/RESEARCH.md, section 13):

  part 0    baseGradient           151 x 1   colour by height (dark purple low, beige high)
  part 1    isolineGradient        128 x 1   colour of the contour lines by height
  part 2    fogZoneBorderGradient   32 x 1   brightness across a shroud border
  part 3    fogNoise               512^2     cloud noise
  part 4/5  fogZoneNormal/Dangerous 256^2    tiling shroud textures (teal / pink)
  part 6    baseHeight            1280^2     R16 height, 8 m per pixel
  7 + 2*(y*10+x)  DetailHeight(x,y) 1024^2   baked relief shading, 127 = flat
  8 + 2*(y*10+x)  FogZone(x,y)      1024^2   ch0 distance inside a shroud zone, ch1 zone level
                                             (0 land, 1..10 shroud, 16 outside the world)

Tile row y of the detail and fog textures is image row block 9 - y (north up). The shader itself
is not in the data, so the colour mapping and line spacing below are our own choices in the
game's palette; every pixel comes from the game's data.

Usage (descriptors from `kfc-parser unpack -f tkeen::UiTextureResource`):
  python tools/render_map.py --game "C:/Program Files (x86)/Steam/steamapps/common/Enshrouded" \
      --textures <unpack folder>/UiTextureResource --out web/tiles [--size 2048 --png preview.png]
"""
import argparse
import io
import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kfc_content import Kfc, texture  # noqa: E402

MAP_GUID = "01bcbd07-bdbf-41c0-9999-5d58fb1a3aa1"
WORLD = 10240            # metres; one detail pixel = 1 m
SEA_FLOOR = 9073         # baseHeight of the flat shroud sea
HEIGHT_TOP = 31500       # baseHeight that gets the brightest colour (99.5 % of the land is below)
HEIGHT_GAMMA = 0.5       # < 1 spreads the low land over more of the gradient
METRES_PER_UNIT = 0.0517  # baseHeight -> metres (fitted against 3697 POI heights, r = 0.91)
SHADE_STRENGTH = 1.5     # relief shading: colour *= 1 + strength * (detail - 127) / 127
BRIGHTNESS = 1.2         # land colour gain (1.0 was too dark next to the markers)
CONTOURS = ((25, 0.20), (125, 0.55))   # (spacing in metres, opacity)
CONTOUR_WIDTH = 0.9      # in output pixels
SHROUD_ALPHA = 0.38
SHROUD_TEXTURE_METRES = 640  # one repeat of the shroud texture
SHROUD_OUTLINE = 0.45     # dark line along the zone edge
OUTSIDE_FADE = 0.7        # land outside the playable world fades into the sea colour
SHROUD_BORDER = (10, 50)     # zone distance values mapped onto the border gradient
SEA_NOISE = 0.18
TILE = 512
JPEG_QUALITY = 84


def descriptor(folder, part):
    for name in os.listdir(folder):
        if name.startswith(MAP_GUID) and name.endswith("_%d.json" % part):
            return json.load(open(os.path.join(folder, name), encoding="utf-8"))
    raise FileNotFoundError("map texture part %d not in %s" % (part, folder))


def load(game, folder):
    kfc = Kfc(game)
    tex = lambda part: texture(kfc, descriptor(folder, part))
    data = {"baseGradient": tex(0)[0, :, :3].astype(np.float32),
            "isolineGradient": tex(1)[0, :, :3].astype(np.float32),
            "borderGradient": tex(2)[0, :, 0].astype(np.float32) / 255,
            "fogNoise": tex(3)[:, :, 0].astype(np.float32) / 255,
            "shroud": tex(4)[:, :, :3].astype(np.float32),
            "base": tex(6).astype(np.float32)}
    detail = np.empty((WORLD, WORLD), np.uint8)
    fog = np.empty((WORLD, WORLD, 2), np.uint8)
    for y in range(10):
        for x in range(10):
            part = 7 + 2 * (y * 10 + x)
            d, f = descriptor(folder, part), descriptor(folder, part + 1)
            assert d["debugName"] == "DetailHeight(%d,%d)" % (x, y), d["debugName"]
            assert f["debugName"] == "FogZone(%d,%d)" % (x, y), f["debugName"]
            rows = slice((9 - y) * 1024, (10 - y) * 1024)
            cols = slice(x * 1024, (x + 1) * 1024)
            detail[rows, cols] = texture(kfc, d)[:, :, 0]
            fog[rows, cols] = texture(kfc, f)[:, :, :2]
    data["detail"], data["fog"] = detail, fog
    return data


def gradient(g, t):
    x = np.clip(t, 0, 1) * (len(g) - 1)
    i = np.floor(x).astype(np.int32)
    i1 = np.minimum(i + 1, len(g) - 1)
    w = (x - i)[..., None]
    return g[i] * (1 - w) + g[i1] * w


def resample(img, size, box):
    """Bicubic resample of the float image region `box` (x0, y0, x1, y1 in source pixels)."""
    return np.asarray(Image.fromarray(img, "F").resize(size, Image.BICUBIC, box=box), np.float32)


def area_mean(a, k):
    if k == 1:
        return a.astype(np.float32)
    h, w = a.shape[0] // k, a.shape[1] // k
    return a[:h * k, :w * k].reshape(h, k, w, k, *a.shape[2:]).astype(np.float32).mean(axis=(1, 3))


def tiled(tex, rows, cols, metres_per_px, repeat_metres):
    """Samples a tiling texture (bilinear) over output pixel centres (rows, cols) with
    `repeat_metres` per repeat. Fine for magnification; smaller outputs come from the full
    render scaled down, which averages the texture."""
    n = tex.shape[0]
    fy = rows * metres_per_px / repeat_metres * n - 0.5
    fx = cols * metres_per_px / repeat_metres * n - 0.5
    y0, x0 = np.floor(fy).astype(np.int64), np.floor(fx).astype(np.int64)
    wy, wx = (fy - y0)[:, None], (fx - x0)[None, :]
    if tex.ndim == 3:
        wy, wx = wy[..., None], wx[..., None]
    y0, y1, x0, x1 = y0 % n, (y0 + 1) % n, x0 % n, (x0 + 1) % n
    top = tex[y0[:, None], x0[None, :]] * (1 - wx) + tex[y0[:, None], x1[None, :]] * wx
    bottom = tex[y1[:, None], x0[None, :]] * (1 - wx) + tex[y1[:, None], x1[None, :]] * wx
    return top * (1 - wy) + bottom * wy


def render(data, size, band=512):
    """The whole map as an RGB uint8 array (size x size), north up."""
    k = WORLD // size
    assert k * size == WORLD, "size must divide 10240"
    mpp = WORLD / size                    # metres per output pixel
    base = data["base"]
    out = np.empty((size, size, 3), np.uint8)
    for r0 in range(0, size, band):
        r1 = min(size, r0 + band)
        # one extra row above and below for the contour line gradients
        e0, e1 = max(0, r0 - 1), min(size, r1 + 1)
        box = (0, e0 * mpp / 8, 1280, e1 * mpp / 8)
        H = resample(base, (size, e1 - e0), box)
        t = (np.clip((H - SEA_FLOOR) / (HEIGHT_TOP - SEA_FLOOR), 0, 1)) ** HEIGHT_GAMMA
        detail = area_mean(data["detail"][e0 * k:e1 * k], k)
        fog = data["fog"][e0 * k:e1 * k]
        level = fog[::k, ::k, 1]
        zone = area_mean(fog[..., 0], k)

        col = gradient(data["baseGradient"], t)
        col *= np.clip(1 + SHADE_STRENGTH * (detail - 127) / 127, 0.2, 2.5)[..., None] * BRIGHTNESS

        # contour lines, anti-aliased by the local height change per pixel
        metres = H * METRES_PER_UNIT
        line_col = gradient(data["isolineGradient"], t)
        land = level != 16
        for spacing, alpha in CONTOURS:
            v = metres / spacing
            dist = np.abs(v - np.round(v))
            gy, gx = np.gradient(v)
            per_px = np.sqrt(gx * gx + gy * gy) + 1e-6
            a = np.clip(1 - dist / (per_px * CONTOUR_WIDTH), 0, 1) * alpha
            a *= np.clip(per_px * 40, 0, 1)   # no lines on flat ground (the sea floor)
            a *= land
            col = col * (1 - a[..., None]) + line_col * a[..., None]

        rows = np.arange(e0, e1, dtype=np.float64) + 0.5
        cols = np.arange(size, dtype=np.float64) + 0.5
        # outside the world: the shroud sea, with the game's cloud noise
        noise = tiled(data["fogNoise"], rows, cols, mpp, 1024)
        sea = ~land
        sea_col = data["baseGradient"][0] * (1 - SEA_NOISE + 2 * SEA_NOISE * noise[sea])[:, None]
        col[sea] = col[sea] * (1 - OUTSIDE_FADE) + sea_col * OUTSIDE_FADE
        # shroud zones: the game's teal shroud texture, fading in across the border
        shroud = (level >= 1) & (level <= 10)
        if shroud.any():
            u = np.clip((zone - SHROUD_BORDER[0]) / (SHROUD_BORDER[1] - SHROUD_BORDER[0]), 0, 1)
            edge = np.interp(u, np.linspace(0, 1, len(data["borderGradient"])), data["borderGradient"])
            a = (edge / data["borderGradient"].max()) * SHROUD_ALPHA * shroud
            stex = tiled(data["shroud"], rows, cols, mpp, SHROUD_TEXTURE_METRES)
            col = col * (1 - a[..., None]) + stex * a[..., None]
            line = np.exp(-((zone - SHROUD_BORDER[0]) / 4) ** 2) * SHROUD_OUTLINE * shroud
            col *= (1 - line)[..., None]

        out[r0:r1] = np.clip(col[r0 - e0:r0 - e0 + (r1 - r0)], 0, 255).astype(np.uint8)
    return out


def write_tiles(img, out_dir, levels, background):
    """Leaflet CRS.Simple tiles: at zoom z one metre is 2^z pixels; native zoom 0 = 1 m/px.
    Files are named <z>_<x>_<y>.jpg with Leaflet's own tile coordinates: the grid starts at the
    south-west corner (world 0, 0), so y is negative (-1 = the southern row). Where a level is
    not a whole number of tiles, the rest of the top row is `background`."""
    os.makedirs(out_dir, exist_ok=True)
    pil = Image.fromarray(img)
    written = total = 0
    for z in levels:
        size = round(WORLD * 2 ** z)
        level_img = pil if size == pil.width else pil.resize((size, size), Image.LANCZOS)
        n = math.ceil(size / TILE)
        for y in range(-n, 0):
            top = size + y * TILE          # image row of the tile's top edge (may be < 0)
            for x in range(n):
                tile = Image.new("RGB", (TILE, TILE), background)
                box = (x * TILE, max(0, top), min(size, (x + 1) * TILE), top + TILE)
                tile.paste(level_img.crop(box), (0, box[1] - top))
                buf = io.BytesIO()
                tile.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
                with open(os.path.join(out_dir, "%d_%d_%d.jpg" % (z, x, y)), "wb") as f:
                    f.write(buf.getvalue())
                written += 1
                total += len(buf.getvalue())
    return written, total


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", required=True)
    ap.add_argument("--textures", required=True, help="folder with the unpacked UiTextureResource descriptors")
    ap.add_argument("--size", type=int, default=WORLD, help="render size in pixels (10240 = 1 m per pixel)")
    ap.add_argument("--png", help="also save the whole render as this image")
    ap.add_argument("--preview", help="save a small JPG preview (1024 px) here")
    ap.add_argument("--out", help="tile folder (only with --size 10240)")
    args = ap.parse_args()

    data = load(args.game, args.textures)
    img = render(data, args.size)
    if args.png:
        Image.fromarray(img).save(args.png)
    if args.preview:
        Image.fromarray(img).resize((1024, 1024), Image.LANCZOS).save(args.preview, "JPEG", quality=85, optimize=True)
    if args.out:
        assert args.size == WORLD, "tiles need the full 10240 render"
        # The average sea at the world's edge fills partial tiles and is the page background
        # (maps.json "background"), so the map has no visible edge.
        border = np.concatenate([img[:, :64].reshape(-1, 3), img[:, -64:].reshape(-1, 3)])
        sea = tuple(int(round(v)) for v in border.mean(axis=0))
        n, total = write_tiles(img, args.out, range(-5, 1), sea)
        print("%d tiles, %.1f MB in %s; background %s" % (n, total / 2 ** 20, args.out, "#%02x%02x%02x" % sea))


if __name__ == "__main__":
    main()
