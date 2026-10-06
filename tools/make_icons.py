"""Draws the app icons (a hurdle on the app's dark background) with no dependencies.

Run from the project root:  python tools/make_icons.py
"""
import os
import struct
import zlib

BG = (15, 23, 42)
BLUE = (59, 130, 246)
LIGHT = (191, 219, 254)


def png(path, size, pixel):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x / size, y / size))

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(bytes(raw), 9)))
        f.write(chunk(b'IEND', b''))


def hurdle(u, v):
    # Everything sits inside the middle 60% so a round or squircle mask never clips it.
    if 0.26 <= u <= 0.74 and 0.34 <= v <= 0.42:
        return LIGHT                      # crossbar
    if (0.30 <= u <= 0.36 or 0.64 <= u <= 0.70) and 0.42 <= v <= 0.70:
        return BLUE                       # posts
    if (0.24 <= u <= 0.42 or 0.58 <= u <= 0.76) and 0.66 <= v <= 0.72:
        return BLUE                       # feet
    return BG


if __name__ == '__main__':
    os.makedirs('icons', exist_ok=True)
    for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
        png(os.path.join('icons', name), size, hurdle)
        print('wrote', name)
