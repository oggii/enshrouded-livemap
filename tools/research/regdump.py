"""Read-only: write the server's writable memory regions to stdout as frames
[u64 start][u64 length][bytes]. Runs inside the container (no numpy needed).
Usage: python3 regdump.py <pid>
"""
import struct
import sys

pid = int(sys.argv[1])
out = sys.stdout.buffer
with open(f"/proc/{pid}/maps") as maps, open(f"/proc/{pid}/mem", "rb", 0) as mem:
    for line in maps:
        parts = line.split()
        start, end = (int(x, 16) for x in parts[0].split("-"))
        if not parts[1].startswith("rw") or end - start > 1 << 31:
            continue
        path = parts[5] if len(parts) > 5 else ""
        if path.startswith("/usr") or ".so" in path:
            continue
        try:
            mem.seek(start)
            data = mem.read(end - start)
        except (OSError, ValueError, OverflowError):
            continue
        out.write(struct.pack("<QQ", start, len(data)))
        out.write(data)
out.flush()
