"""Reads regdump.py frames from stdin and finds where the map markers' "visible" knowledge ids
(uint32, from the templates) sit in the server's memory: every 4-byte aligned hit, then the
densest clusters (many different ids close together = a per-player "discovered" list or a
lookup table). Read-only analysis on the host (numpy).
Usage: ... | python3 idscan_host.py marker-ids.json [--save frames.bin]
"""
import json
import struct
import sys
from collections import Counter, defaultdict

import numpy as np

ids_by = {int(k): v for k, v in json.load(open(sys.argv[1]))["ids"].items()}
ids = np.array(sorted(ids_by), dtype=np.uint32)
save = open(sys.argv[3], "wb") if len(sys.argv) > 3 and sys.argv[2] == "--save" else None
inp = sys.stdin.buffer
hits = []  # (address, id)
total = 0
while True:
    head = inp.read(16)
    if len(head) < 16:
        break
    start, length = struct.unpack("<QQ", head)
    data = inp.read(length)
    total += len(data)
    if save:
        save.write(head)
        save.write(data)
    if len(data) < 4:
        continue
    a = np.frombuffer(data[:(len(data) // 4) * 4], "<u4")
    m = np.isin(a, ids)
    for i in np.nonzero(m)[0]:
        hits.append((start + 4 * int(i), int(a[i])))
print("scanned %.0f MB, %d hits of %d ids, %d distinct ids found" % (total / 1e6, len(hits), len(ids), len({h[1] for h in hits})))
hits.sort()
# Clusters: hits less than 4 KB apart belong together.
clusters = []
cur = []
for h in hits:
    if cur and h[0] - cur[-1][0] > 4096:
        clusters.append(cur)
        cur = []
    cur.append(h)
if cur:
    clusters.append(cur)
clusters.sort(key=lambda c: -len({h[1] for h in c}))
for c in clusters[:15]:
    distinct = len({h[1] for h in c})
    strides = Counter(b[0] - a[0] for a, b in zip(c, c[1:])).most_common(3)
    print("cluster %#x..%#x  hits %d distinct %d  strides %s" % (c[0][0], c[-1][0], len(c), distinct, strides))
    for addr, v in c[:4]:
        print("    %#x  %08x  %s" % (addr, v, ids_by[v]))
