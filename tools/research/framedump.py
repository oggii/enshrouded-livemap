"""Hex view of a saved regdump frames file around an address, as uint32 rows, with known ids
marked. Usage: python3 framedump.py frames.bin marker-ids.json <addr hex> [before] [after]"""
import json
import struct
import sys

path, idfile, addr = sys.argv[1], sys.argv[2], int(sys.argv[3], 16)
before = int(sys.argv[4], 0) if len(sys.argv) > 4 else 0x100
after = int(sys.argv[5], 0) if len(sys.argv) > 5 else 0x400
ids = {int(k): v for k, v in json.load(open(idfile))["ids"].items()}
with open(path, "rb") as f:
    while True:
        head = f.read(16)
        if len(head) < 16:
            sys.exit("address not in any frame")
        start, length = struct.unpack("<QQ", head)
        if start <= addr < start + length:
            data = f.read(length)
            break
        f.seek(length, 1)
lo = max(start, (addr - before) & ~0xF)
hi = min(start + length, addr + after)
print("region %#x len %#x" % (start, length))
for row in range(lo, hi, 16):
    words = struct.unpack_from("<4I", data, row - start)
    marks = ["*" + ids[w][9:40] if w in ids else "" for w in words]
    print("%#x  %s  %s" % (row, " ".join("%08x" % w for w in words), " ".join(m for m in marks if m)))
