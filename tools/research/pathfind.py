"""Offline pointer search in a regdump frames file: from each start object, breadth-first over
pointers (reading `span` bytes per node) until a node holds a pointer into one of the target
ranges; prints the path as base+offset steps. Usage:
python3 pathfind.py frames.bin <start hex>[,<start hex>...] <target lo hex>-<hi hex>[,...] [depth] [span hex]"""
import bisect
import struct
import sys

path = sys.argv[1]
starts = [int(s, 16) for s in sys.argv[2].split(",")]
targets = [tuple(int(x, 16) for x in t.split("-")) for t in sys.argv[3].split(",")]
depth = int(sys.argv[4]) if len(sys.argv) > 4 else 3
span = int(sys.argv[5], 16) if len(sys.argv) > 5 else 0x400

regions = []
with open(path, "rb") as f:
    while True:
        head = f.read(16)
        if len(head) < 16:
            break
        start, length = struct.unpack("<QQ", head)
        regions.append((start, length, f.tell()))
        f.seek(length, 1)
regions.sort()
starts_idx = [r[0] for r in regions]
fh = open(path, "rb")


def read(addr, n):
    i = bisect.bisect_right(starts_idx, addr) - 1
    if i < 0:
        return None
    start, length, off = regions[i]
    if not (start <= addr < start + length):
        return None
    n = min(n, start + length - addr)
    fh.seek(off + addr - start)
    return fh.read(n)


def in_target(v):
    return any(lo <= v < hi for lo, hi in targets)


for s in starts:
    seen = {s}
    frontier = [(s, [])]
    found = 0
    for d in range(depth):
        nxt = []
        for node, trail in frontier:
            data = read(node, span)
            if not data:
                continue
            for off in range(0, len(data) - 7, 8):
                v = struct.unpack_from("<Q", data, off)[0]
                if in_target(v):
                    found += 1
                    if found <= 12:
                        print("%#x: %s +%#x -> %#x" % (s, "".join("+%#x>" % o for o in trail), off, v))
                elif 0x7000_0000_0000 <= v < 0x8000_0000_0000 and v not in seen and len(seen) < 200000:
                    seen.add(v)
                    nxt.append((v, trail + [off]))
        frontier = nxt
    print("start %#x: %d hits, %d nodes" % (s, found, len(seen)))
