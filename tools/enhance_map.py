"""Sharpens a low-resolution map picture with the game's own relief and cuts it into web map tiles.

A picture of the world (e.g. a 2048 px map, 5 m per pixel) is scaled up to 1 m per pixel and
multiplied with the high-pass part of the game's baked relief shading (DetailHeight, 1 m per
pixel, see render_map.py): cliffs, ruins and paths get sharp edges from real data, the picture
keeps its colours. The result is written as tiles like the game map, so a viewer loads only
what is on screen.

The picture must cover the world 0..10240 m north up; small misalignments are corrected with
--scale (around the centre) and --offset (in picture pixels), found by matching coastlines.

Usage:
  python tools/enhance_map.py --picture map.png|map.rgba [--rgba-size 2048] \
      --game "C:/Program Files (x86)/Steam/steamapps/common/Enshrouded" \
      --textures <unpack folder>/UiTextureResource --out web/tiles-hd [--scale 1.002 --offset -1 -1]
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_map  # noqa: E402

RELIEF = 1.8      # strength of the added relief: colour *= 1 + RELIEF * highpass / 127
BLUR = 3.0        # px at 1 m per pixel: the relief the picture already has (5 m per pixel)
PAD = 64


def load_picture(path, rgba_size):
    if path.endswith(".rgba"):
        raw = open(path, "rb").read()
        return np.frombuffer(raw[:rgba_size * rgba_size * 4], np.uint8).reshape(rgba_size, rgba_size, 4)[..., :3]
    return np.asarray(Image.open(path).convert("RGB"))


def enhance(picture, detail, scale, offset, band=512):
    size = render_map.WORLD
    n = picture.shape[0]
    padded = Image.fromarray(np.pad(picture, ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge"))
    per_px = n / size                  # picture pixels per metre
    c0 = n / 2 + PAD

    def px(u, o):                      # output pixel (1 m) -> padded picture coordinate
        return c0 + (u * per_px - n / 2) * scale + o

    out = np.empty((size, size, 3), np.uint8)
    margin = 16
    for r0 in range(0, size, band):
        r1 = min(size, r0 + band)
        box = (px(0, offset[0]), px(r0, offset[1]), px(size, offset[0]), px(r1, offset[1]))
        colour = np.asarray(padded.resize((size, r1 - r0), Image.LANCZOS, box=box), np.float32)
        e0, e1 = max(0, r0 - margin), min(size, r1 + margin)
        d8 = detail[e0:e1]
        blur = np.asarray(Image.fromarray(d8, "L").filter(ImageFilter.GaussianBlur(BLUR)), np.float32)
        high = (d8.astype(np.float32) - blur)[r0 - e0:r0 - e0 + (r1 - r0)]
        out[r0:r1] = np.clip(colour * (1 + RELIEF * high[..., None] / 127.0), 0, 255).astype(np.uint8)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--picture", required=True)
    ap.add_argument("--rgba-size", type=int, default=2048, help="side of a raw .rgba picture")
    ap.add_argument("--game", required=True)
    ap.add_argument("--textures", required=True)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--offset", type=float, nargs=2, default=(0.0, 0.0))
    ap.add_argument("--out", required=True, help="tile folder")
    ap.add_argument("--preview", help="also save a 1024 px preview JPG")
    ap.add_argument("--format", choices=("jpg", "webp"), default="jpg", help="tile format")
    args = ap.parse_args()

    picture = load_picture(args.picture, args.rgba_size)
    detail = render_map.load(args.game, args.textures)["detail"]
    img = enhance(picture, detail, args.scale, args.offset)
    if args.preview:
        Image.fromarray(img).resize((1024, 1024), Image.LANCZOS).save(args.preview, "JPEG", quality=85)
    border = np.concatenate([img[:, :64].reshape(-1, 3), img[:, -64:].reshape(-1, 3)])
    edge = tuple(int(round(v)) for v in border.mean(axis=0))
    render_map.WEBP_QUALITY = 89  # HD: same bytes as JPEG q84, SSIM 0.9881 vs 0.9877
    n, total = render_map.write_tiles(img, args.out, range(-5, 1), edge, args.format)
    print("%d tiles, %.1f MB in %s; background #%02x%02x%02x" % (n, total / 2 ** 20, args.out, *edge))


if __name__ == "__main__":
    main()
