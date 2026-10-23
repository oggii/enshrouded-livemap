"""The sorted id array around an address in two regdump frame files: its bounds (longest run of
uint32 sorted by their low 15 bits... checked by trying both orders), its length, and which values
are only in one of them. Usage: python3 setdiff.py before.bin after.bin <addr hex> [names.tsv]"""
import struct
import sys


def window(path, addr, span=1 << 20):
    with open(path, "rb") as f:
        while True:
            head = f.read(16)
            if len(head) < 16:
                return None, None
            start, length = struct.unpack("<QQ", head)
            if start <= addr < start + length:
                data = f.read(length)
                lo = max(start, (addr - span) & ~3)
                hi = min(start + length, addr + span)
                return lo, data[lo - start:hi - start]
            f.seek(length, 1)


def run(lo, data, addr, key):
    words = struct.unpack("<%dI" % (len(data) // 4), data[:len(data) // 4 * 4])
    i = (addr - lo) // 4
    a = i
    while a > 0 and key(words[a - 1]) <= key(words[a]):
        a -= 1
    b = i
    while b + 1 < len(words) and key(words[b]) <= key(words[b + 1]):
        b += 1
    return lo + 4 * a, words[a:b + 1]


before_path, after_path, addr = sys.argv[1], sys.argv[2], int(sys.argv[3], 16)
for name, key in (("low15", lambda v: v & 0x7FFF), ("low16", lambda v: v & 0xFFFF), ("full", lambda v: v)):
    lo, d = window(before_path, addr)
    s0, w0 = run(lo, d, addr, key)
    lo, d = window(after_path, addr)
    s1, w1 = run(lo, d, addr, key)
    print("%-6s before %#x n=%d   after %#x n=%d" % (name, s0, len(w0), s1, len(w1)))
key = lambda v: v & 0x7FFF
lo, d = window(before_path, addr)
s0, w0 = run(lo, d, addr, key)
lo, d = window(after_path, addr)
s1, w1 = run(lo, d, addr, key)
print("first words:", " ".join("%08x" % v for v in w1[:8]), "... last:", " ".join("%08x" % v for v in w1[-4:]))
names = {}
if len(sys.argv) > 4:
    for line in open(sys.argv[4], encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if len(p) >= 2:
            names[int(p[0], 16)] = p[1]
only_after = sorted(set(w1) - set(w0))
only_before = sorted(set(w0) - set(w1))
print("only after:", ["%08x %s" % (v, names.get(v, "")) for v in only_after][:20])
print("only before:", ["%08x %s" % (v, names.get(v, "")) for v in only_before][:20])
# Words just before and after the array: a header with the count?
with open(after_path, "rb") as f:
    pass
lo, d = window(after_path, s1 - 64, 256)
pre = struct.unpack("<%dI" % (len(d) // 4), d[:len(d) // 4 * 4])
print("16 words before the array (after):", " ".join("%08x" % v for v in pre[(s1 - 64 - lo) // 4:(s1 - lo) // 4]))
