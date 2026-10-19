#!/usr/bin/env python3
"""Extracts the application icon of PsoBB.exe as an .ico file (stdlib only).

Usage: tools/exeicon.py [PsoBB.exe] [out.ico]
Defaults to $PSOBB_EXE or ~/Downloads/psobb-client/PsoBB.exe and exe-icon.ico.
The exe stays outside the repository; so does the .ico unless it was chosen
as the site's favicon (docs/LEGAL.md).
"""
import os
import struct
import sys

RT_ICON, RT_GROUP_ICON = 3, 14


def u16(d, o): return struct.unpack_from('<H', d, o)[0]
def u32(d, o): return struct.unpack_from('<I', d, o)[0]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('PSOBB_EXE', os.path.expanduser('~/Downloads/psobb-client/PsoBB.exe'))
    out = sys.argv[2] if len(sys.argv) > 2 else 'exe-icon.ico'
    d = open(path, 'rb').read()
    pe = u32(d, 0x3C)
    nsec = u16(d, pe + 6)
    opt = pe + 24
    rsrc_rva = u32(d, opt + 96 + 2 * 8)  # data directory 2 = resources
    sec = opt + u16(d, pe + 20)
    sections = [(u32(d, sec + i * 40 + 12), u32(d, sec + i * 40 + 8), u32(d, sec + i * 40 + 20)) for i in range(nsec)]

    def rva_off(rva):
        for va, vs, raw in sections:
            if va <= rva < va + max(vs, 1):
                return rva - va + raw
        raise ValueError(f'rva {rva:#x} not in a section')

    base = rva_off(rsrc_rva)

    def entries(off):
        n = u16(d, off + 12) + u16(d, off + 14)
        for i in range(n):
            name, target = struct.unpack_from('<II', d, off + 16 + i * 8)
            yield name, base + (target & 0x7FFFFFFF), bool(target & 0x80000000)

    def leaves(off):
        # first data entry under a directory node, any language
        for _, t, is_dir in entries(off):
            return leaves(t) if is_dir else t
        raise ValueError('empty resource directory')

    def data_at(off):
        rva, size = u32(d, off), u32(d, off + 4)
        return d[rva_off(rva):rva_off(rva) + size]

    types = {name: t for name, t, _ in entries(base)}
    icons = {name: leaves(t) for name, t, _ in entries(types[RT_ICON])}
    groups = {name: t for name, t, _ in entries(types[RT_GROUP_ICON])}
    # The lowest group id is the application icon Explorer shows.
    gid = min(groups)
    group = data_at(leaves(groups[gid]))
    count = u16(group, 4)
    images, header = [], b''
    for i in range(count):
        w, h, colors, _, planes, bpp, size, ident = struct.unpack_from('<BBBBHHIH', group, 6 + i * 14)
        images.append((w, h, colors, planes, bpp, data_at(icons[ident])))
    offset = 6 + 16 * count
    ico = struct.pack('<HHH', 0, 1, count)
    blob = b''
    for w, h, colors, planes, bpp, img in images:
        ico += struct.pack('<BBBBHHII', w, h, colors, 0, planes, bpp, len(img), offset + len(blob))
        blob += img
    open(out, 'wb').write(ico + blob)
    print(f'group {gid}: ' + ', '.join(f'{w or 256}x{h or 256}/{bpp}bpp' for w, h, _, _, bpp, _ in images) + f' -> {out}')


main()
