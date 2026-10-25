#!/usr/bin/env python3
"""Reads data tables out of a local PsoBB.exe by virtual address.

The named Ghidra dump (tools/refsrc.sh) carries the code but not the data, and
running Ghidra headless needs a project copy this machine may not have room
for. Most of what is missing is a plain read at a known address, which only
needs the PE section headers to map a virtual address to a file offset.

The executable is never part of this repository: point PSOBB_EXE at your own
copy (default ~/Downloads/psobb-client/PsoBB.exe).

  tools/exedata.py read 009a5210 u 4        4 uint32 (f d i u h H, or b/s/p)
  tools/exedata.py read 00934f40 f 10       10 floats (the Pioneer 2 BGM zones)
  tools/exedata.py read 008fe09c s          a zero-terminated string
  tools/exedata.py read 009f7c0c p 3        3 pointers, each with its string
  tools/exedata.py motions 009a5240 8       enemy motion table rows
  tools/exedata.py xref 009a51e0            .text references to that address
  tools/exedata.py calls 0044161c 0044172a  E8 call targets inside a range
  tools/exedata.py sections                 the section table

`xref` also prints a guess at the start of the containing function (the first
byte after the int3 padding before the reference); `calls` pins it, because a
target that is called is a function entry.
"""

import os
import struct
import sys

PATH = os.environ.get("PSOBB_EXE", os.path.expanduser("~/Downloads/psobb-client/PsoBB.exe"))

try:
    DATA = open(PATH, "rb").read()
except OSError as e:
    raise SystemExit(f"{e}\nSet PSOBB_EXE to your own PsoBB.exe (never committed here).")

_pe = struct.unpack_from("<I", DATA, 0x3C)[0]
if DATA[_pe : _pe + 4] != b"PE\0\0":
    raise SystemExit(f"{PATH} is not a PE file")
_nsect, = struct.unpack_from("<H", DATA, _pe + 6)
_optsize, = struct.unpack_from("<H", DATA, _pe + 20)
BASE, = struct.unpack_from("<I", DATA, _pe + 24 + 28)

# (name, virtual address, virtual size, raw offset, raw size)
SECTIONS = []
for i in range(_nsect):
    o = _pe + 24 + _optsize + i * 40
    name = DATA[o : o + 8].rstrip(b"\0").decode("ascii", "replace")
    vsize, va, rawsize, raw = struct.unpack_from("<IIII", DATA, o + 8)
    SECTIONS.append((name, BASE + va, max(vsize, rawsize), raw, rawsize))
TEXT = next((s for s in SECTIONS if s[0] == ".text"), SECTIONS[0])  # the unnamed first section is the code


def offset(va):
    """File offset of a virtual address, or None (not mapped / uninitialised)."""
    for _, start, size, raw, rawsize in SECTIONS:
        if start <= va < start + size:
            return raw + (va - start) if va - start < rawsize else None
    return None


def read(va, n):
    o = offset(va)
    if o is None:
        raise SystemExit(f"{va:#010x}: not in an initialised section")
    return DATA[o : o + n]


def cstr(va, limit=256):
    o = offset(va)
    if o is None:
        return None
    end = DATA.find(b"\0", o, o + limit)
    if end < 0:
        return None
    try:
        return DATA[o:end].decode("ascii")
    except UnicodeDecodeError:
        return None


def cmd_read(args):
    va = int(args[0], 16)
    fmt = args[1] if len(args) > 1 else "u"
    count = int(args[2]) if len(args) > 2 else 1
    if fmt == "s":
        print(cstr(va))
        return
    if fmt == "b":
        print(read(va, count).hex(" "))
        return
    if fmt == "p":
        for i in range(count):
            ptr, = struct.unpack("<I", read(va + i * 4, 4))
            print(f"{va + i * 4:#010x} -> {ptr:#010x} {cstr(ptr)!r}")
        return
    code = {"f": "f", "d": "d", "i": "i", "u": "I", "h": "h", "H": "H"}[fmt]
    size = struct.calcsize(code)
    for i, v in enumerate(struct.unpack("<" + code * count, read(va, size * count))):
        print(f"{va + i * size:#010x} {v}")


def cmd_motions(args):
    """Enemy motion table rows: u16 mode, u16 next, u32 motion, f32 speed, u32 flags."""
    va = int(args[0], 16)
    rows = int(args[1]) if len(args) > 1 else 8
    for i in range(rows):
        mode, nxt, motion, speed, flags = struct.unpack("<HHIfI", read(va + i * 0x10, 0x10))
        print(f"{va + i * 0x10:#010x} slot {i:2d}  mode {mode}  next {nxt:5d}  motion {motion:5d}  speed {speed:g}  flags {flags:#x}")


def cmd_xref(args):
    va = int(args[0], 16)
    _, start, _, raw, rawsize = TEXT
    blob = DATA[raw : raw + rawsize]
    needle = struct.pack("<I", va)
    pos = 0
    while True:
        i = blob.find(needle, pos)
        if i < 0:
            return
        pos = i + 1
        j, func = i, None
        while j > max(0, i - 0x1200):
            j -= 1
            if blob[j] in (0xCC, 0x90) and blob[j - 1] in (0xCC, 0x90):
                func = j + 1
                while blob[func] in (0xCC, 0x90):
                    func += 1
                break
        where = f"   function start <= {start + func:#010x}" if func else "   (no padding found)"
        print(f"ref at {start + i:#010x}{where}")


def cmd_calls(args):
    lo, hi = int(args[0], 16), int(args[1], 16)
    _, start, _, raw, rawsize = TEXT
    blob = DATA[raw : raw + rawsize]
    hits = {}
    for i in range(len(blob) - 5):
        if blob[i] != 0xE8:
            continue
        rel, = struct.unpack_from("<i", blob, i + 1)
        target = start + i + 5 + rel
        if lo <= target <= hi:
            hits.setdefault(target, []).append(start + i)
    for t in sorted(hits):
        sites = " ".join(f"{a:#x}" for a in hits[t][:8])
        print(f"target {t:#010x}  called from {sites} ({len(hits[t])} sites)")


def cmd_sections(_args):
    for name, va, size, raw, rawsize in SECTIONS:
        print(f"{name:<8} va {va:#010x} size {size:#x} raw {raw:#x}/{rawsize:#x}")


COMMANDS = {"read": cmd_read, "motions": cmd_motions, "xref": cmd_xref, "calls": cmd_calls, "sections": cmd_sections}

argv = sys.argv[1:]
if not argv or argv[0] not in COMMANDS:
    raise SystemExit(__doc__)
COMMANDS[argv[0]](argv[1:])
