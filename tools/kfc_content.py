"""Reads content blobs (textures and other binary data) from the game's own files.

The client keeps descriptors in enshrouded.kfc and the binary data ("content") in
enshrouded_NNN.dat. Format after kfc-parser (github.com/Brabb3l/kfc-parser, crates/kfc-base,
GPL-3.0; only the layout is used here): the KFC4 header holds 16 locations {u32 offset relative
to the field, u32 count}; the content map is two parallel arrays, keys = ContentHash
{u32 size, u32 hash0, hash1, hash2} and values = ContentEntry {u32 offset, u16 flags,
u16 container, 8 padding}. A blob is `size` bytes at `offset` in enshrouded_<container>.dat.

Texture descriptors (keen::UiTextureResource) come from `kfc-parser unpack -f
tkeen::UiTextureResource`; `texture()` decodes one to an RGBA numpy array (first mip level).
"""
import json
import os
import struct

import numpy as np
import texture2ddecoder

HEADER_FIELDS = ["version", "containers", "unused0", "unused1", "resource_locations", "resource_indices",
                 "content_buckets", "content_keys", "content_values", "resource_buckets", "resource_keys",
                 "resource_values", "resource_bundle_buckets", "resource_bundle_keys", "resource_bundle_values",
                 "resource_chunks"]


class Kfc:
    def __init__(self, game_dir, name="enshrouded"):
        self.dir, self.name = game_dir, name
        with open(os.path.join(game_dir, name + ".kfc"), "rb") as f:
            head = f.read(16 + 8 * len(HEADER_FIELDS))
            if head[:4] != b"KFC4":
                raise ValueError("not a KFC4 file")
            loc = {}
            for i, field in enumerate(HEADER_FIELDS):
                pos = 16 + 8 * i
                rel, count = struct.unpack_from("<II", head, pos)
                loc[field] = (pos + rel, count)
            off, n = loc["content_keys"]
            f.seek(off)
            keys = f.read(16 * n)
            voff, vn = loc["content_values"]
            assert vn == n
            f.seek(voff)
            values = f.read(16 * n)
        self.content = {}
        for i in range(n):
            key = keys[16 * i:16 * i + 16]
            offset, flags, container = struct.unpack_from("<IHH", values, 16 * i)
            self.content[key] = (offset, flags, container)

    @staticmethod
    def key(h):
        """ContentHash from a descriptor's {"size", "hash0", "hash1", "hash2"}."""
        return struct.pack("<IIII", h["size"], h["hash0"], h["hash1"], h["hash2"])

    def read(self, h):
        k = self.key(h)
        if k not in self.content:
            raise KeyError("content not in this game's files: %r" % (h,))
        offset, _flags, container = self.content[k]
        with open(os.path.join(self.dir, "%s_%03d.dat" % (self.name, container)), "rb") as f:
            f.seek(offset)
            return f.read(h["size"])


def texture(kfc, desc):
    """RGBA uint8 array (h, w, 4) of the first mip level; R16 textures come back as uint16 (h, w)."""
    w, h = desc["size"]["x"], desc["size"]["y"]
    fmt = desc["format"]
    data = kfc.read(desc["data"]["hash"])
    if fmt == "R8G8B8A8_unorm":
        return np.frombuffer(data[:w * h * 4], np.uint8).reshape(h, w, 4).copy()
    if fmt == "R16_unorm":
        return np.frombuffer(data[:w * h * 2], "<u2").reshape(h, w).copy()
    blocks = ((w + 3) // 4) * ((h + 3) // 4)
    decode, size = {"BC4_unorm_block": (texture2ddecoder.decode_bc4, 8),
                    "BC5_unorm_block": (texture2ddecoder.decode_bc5, 16),
                    "BC7_unorm_block": (texture2ddecoder.decode_bc7, 16),
                    "BC1_unorm_block": (texture2ddecoder.decode_bc1, 8),
                    "BC3_unorm_block": (texture2ddecoder.decode_bc3, 16)}[fmt]
    bgra = np.frombuffer(decode(data[:blocks * size], w, h), np.uint8).reshape(h, w, 4)
    return bgra[:, :, [2, 1, 0, 3]].copy()


def load_descriptors(folder):
    """All unpacked UiTextureResource descriptors: {file name: descriptor}."""
    out = {}
    for f in os.listdir(folder):
        if f.endswith(".json"):
            out[f] = json.load(open(os.path.join(folder, f), encoding="utf-8"))
    return out
