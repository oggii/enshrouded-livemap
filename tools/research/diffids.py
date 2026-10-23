"""Compares two regdump frame files: where marker "visible" ids appear in the second but not the
first (and the other way round). Read-only analysis on the host.
Usage: python3 diffids.py before.bin after.bin marker-ids.json"""
import json
import struct
import sys
from collections import defaultdict

import numpy as np

ids_by = {int(k): v for k, v in json.load(open(sys.argv[3]))["ids"].items()}
ids = np.array(sorted(ids_by), dtype=np.uint32)


def hits(path):
    out = set()
    with open(path, "rb") as f:
        while True:
            head = f.read(16)
            if len(head) < 16:
                break
            start, length = struct.unpack("<QQ", head)
            data = f.read(length)
            a = np.frombuffer(data[:(len(data) // 4) * 4], "<u4")
            for i in np.nonzero(np.isin(a, ids))[0]:
                out.add((start + 4 * int(i), int(a[i])))
    return out


before, after = hits(sys.argv[1]), hits(sys.argv[2])
new, gone = sorted(after - before), sorted(before - after)
print("before %d hits, after %d, new %d, gone %d" % (len(before), len(after), len(new), len(gone)))
for title, rows in (("NEW", new), ("GONE", gone)):
    by_id = defaultdict(list)
    for addr, v in rows:
        by_id[v].append(addr)
    print("== %s: %d ids" % (title, len(by_id)))
    for v, addrs in sorted(by_id.items(), key=lambda kv: kv[1][0])[:60]:
        print("  %08x  %-70s %s" % (v, ids_by[v][:70], " ".join("%#x" % a for a in addrs[:4])))
