"""Compares two regdump frame files byte by byte and ranks 4 KB pages by changes that only ADD
bits (after & before == before, after != before): what an explored-area bitmap does when fog is
revealed. Pages with many such changes and few other changes come first.
Usage: python3 fogdiff.py before.bin after.bin [top]"""
import struct
import sys

import numpy as np

top = int(sys.argv[3]) if len(sys.argv) > 3 else 25


def frames(path):
    out = {}
    with open(path, "rb") as f:
        while True:
            head = f.read(16)
            if len(head) < 16:
                break
            start, length = struct.unpack("<QQ", head)
            out[start] = (length, f.tell())
            f.seek(length, 1)
    return out


fa, fb = frames(sys.argv[1]), frames(sys.argv[2])
ha, hb = open(sys.argv[1], "rb"), open(sys.argv[2], "rb")
pages = []
compared = 0
for start, (la, oa) in fa.items():
    if start not in fb or fb[start][0] != la:
        continue
    lb, ob = fb[start]
    ha.seek(oa)
    hb.seek(ob)
    step = 1 << 26
    for off in range(0, la, step):
        n = min(step, la - off)
        a = np.frombuffer(ha.read(n), np.uint8)
        b = np.frombuffer(hb.read(n), np.uint8)
        compared += n
        changed = a != b
        if not changed.any():
            continue
        added = changed & ((a & b) == a)
        npg = (n + 4095) // 4096
        pad = npg * 4096 - n
        idx = np.arange(0, n, 4096)
        ch = np.add.reduceat(changed.astype(np.int32), idx)
        ad = np.add.reduceat(added.astype(np.int32), idx)
        nz = np.add.reduceat((a != 0).astype(np.int32), idx)
        for i in np.nonzero((ad >= 4) & (ch <= 1500) & (nz >= 64))[0]:
            pages.append((int(ad[i]), int(ch[i]), start + off + 4096 * int(i), int(nz[i])))
print("compared %.0f MB" % (compared / 1e6))
# Rank: many added-bit bytes, nearly all changes are added bits.
pages.sort(key=lambda p: (-(p[0] / p[1] > 0.95), -p[0]))
for ad, ch, addr, nz in pages[:top]:
    print("page %#x  bits-added bytes %4d  changed %4d  nonzero before %4d" % (addr, ad, ch, nz))
