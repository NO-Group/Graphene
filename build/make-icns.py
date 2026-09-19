#!/usr/bin/env python3
"""Build an Apple .icns from PNG files.

electron-builder needs a real .icns; a renamed PNG is silently rejected or
produces a blank icon. The format is a simple container: an 8-byte header
('icns' + total length) followed by typed chunks, each 4-byte OSType + 4-byte
big-endian length + payload. Modern types (ic07..ic10) take PNG data directly.
"""
import struct, sys, os

# (OSType, pixel size) - the set Apple expects for a complete icon family
TYPES = [
    (b"icp4", 16), (b"icp5", 32), (b"icp6", 64),
    (b"ic07", 128), (b"ic08", 256), (b"ic09", 512),
    (b"ic10", 1024),               # 512@2x
    (b"ic11", 32),                 # 16@2x
    (b"ic12", 64),                 # 32@2x
    (b"ic13", 256),                # 128@2x
    (b"ic14", 512),                # 256@2x
]

def build(src_dir, out_path):
    chunks = []
    for ostype, size in TYPES:
        png = os.path.join(src_dir, f"{size}x{size}.png")
        if not os.path.exists(png):
            print(f"  skip {ostype.decode()}: no {size}x{size}.png", file=sys.stderr)
            continue
        data = open(png, "rb").read()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            raise SystemExit(f"{png} is not a PNG")
        chunks.append(ostype + struct.pack(">I", len(data) + 8) + data)
    if not chunks:
        raise SystemExit("no icon sizes found")
    body = b"".join(chunks)
    out = b"icns" + struct.pack(">I", len(body) + 8) + body
    with open(out_path, "wb") as f:
        f.write(out)
    print(f"wrote {out_path}: {len(chunks)} variants, {len(out)} bytes")

if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
