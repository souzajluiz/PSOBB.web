#!/usr/bin/env python3
"""Generates the port's table of enemy / object collision boxes from PsoBB.exe.

Every constructor that gives a game object its hitboxes calls
InitEnemyCollisionBoxes_007b9a88 (thiscall: this in ECX; stack: the table
pointer, pushed last, then the box count). This script:

  1. finds every E8 call to 0x007b9a88 in .text (the call sites);
  2. reads the two pushes before each call with objdump (the table and the
     count are immediates; a site that is not of that form is kept as
     "dynamic" and not decoded);
  3. decodes each table (0x2c-byte rows: centre x/y/z, radius at +0x0c, half
     width at +0x10, shape at +0x14 (0 sphere, 1 box), flags at +0x18);
  4. finds the factory rows of the type table ({u32 type, u32 creator,
     u32 0x48742400, u32 0}, 16 bytes) and walks the call graph down from each
     creator (depth 3) to see which type reaches which call site;
  5. writes client/src/formats/collisionboxes.gen.ts with the numbers only (no
     binary blobs): the box rows per table, and the type id -> table map.

Function starts are the first byte after two padding bytes (0xCC / 0x90) in a
row, the same guess as tools/exedata.py xref; a site's function is the one that
contains it. ASSUMED where the type map is not unique (the table is then shared).

  tools/gen-collision-boxes.py               write the generated file
  tools/gen-collision-boxes.py --summary     print counts only

The executable is never part of this repository: PSOBB_EXE (default
~/Downloads/psobb-client/PsoBB.exe) is read at run time.
"""

import bisect
import collections
import os
import re
import struct
import subprocess
import sys

PATH = os.environ.get("PSOBB_EXE", os.path.expanduser("~/Downloads/psobb-client/PsoBB.exe"))
INIT = 0x007B9A88
ROW = 0x2C
ROW_TAG = 0x48742400  # third word of a type-table row (ASSUMED: a per-row constant)
DEPTH = 3
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "client", "src", "formats", "collisionboxes.gen.ts")

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
SECTIONS = []
for i in range(_nsect):
    o = _pe + 24 + _optsize + i * 40
    name = DATA[o : o + 8].rstrip(b"\0").decode("ascii", "replace")
    vsize, va, rawsize, raw = struct.unpack_from("<IIII", DATA, o + 8)
    SECTIONS.append((name, BASE + va, max(vsize, rawsize), raw, rawsize))
TEXT = next(s for s in SECTIONS if s[0] == ".text")
TEXT_LO, TEXT_HI = TEXT[1], TEXT[1] + TEXT[2]


def offset(va):
    for _, start, size, raw, rawsize in SECTIONS:
        if start <= va < start + size:
            return raw + (va - start) if va - start < rawsize else None
    return None


def u32(va):
    o = offset(va)
    return struct.unpack_from("<I", DATA, o)[0] if o is not None else None


def f32(va):
    o = offset(va)
    return struct.unpack_from("<f", DATA, o)[0] if o is not None else None


def text_bytes():
    _, _, _, raw, rawsize = TEXT
    return DATA[raw : raw + rawsize]


# --- function starts and call graph -----------------------------------------

def function_starts(blob):
    starts = []
    pads = (0xCC, 0x90)
    for i in range(2, len(blob)):
        if blob[i] not in pads and blob[i - 1] in pads and blob[i - 2] in pads:
            starts.append(i)
    return starts


def e8_calls(blob):
    """(site VA, target VA) for every E8 rel32 call inside .text."""
    out = []
    pos = blob.find(b"\xe8")
    while pos >= 0 and pos + 5 <= len(blob):
        rel, = struct.unpack_from("<i", blob, pos + 1)
        out.append((TEXT_LO + pos, TEXT_LO + pos + 5 + rel))
        pos = blob.find(b"\xe8", pos + 1)
    return out


# --- objdump argument reading -----------------------------------------------

LINE = re.compile(r"^\s*([0-9a-f]+):\s*\t(\S+)\s*(.*)$")


def insns_before(site, span=0x60):
    out = subprocess.run(
        ["objdump", "-d", "--no-show-raw-insn", f"--start-address={site - span:#x}", f"--stop-address={site + 5:#x}", PATH],
        capture_output=True, text=True, check=True,
    ).stdout
    rows = []
    for line in out.splitlines():
        m = LINE.match(line)
        if not m:
            continue
        addr = int(m.group(1), 16)
        ops = m.group(3).split("#")[0].strip()
        rows.append((addr, m.group(2), ops))
    return [r for r in rows if r[0] < site]


def reg_immediate(rows, index, reg):
    """The immediate that the nearest earlier `movl $imm, reg` (or xorl reg, reg) left in reg, or None."""
    for addr, mnem, ops in reversed(rows[:index]):
        if mnem.startswith(("call", "jmp", "ret")):
            return None
        dst = ops.split(",")[-1].strip() if "," in ops else ""
        if dst != reg:
            continue
        if mnem == "movl" and ops.startswith("$"):
            return int(ops.split(",")[0][1:], 16)
        if mnem == "xorl" and ops.split(",")[0].strip() == reg:
            return 0
        return None
    return None


def stack_args(site):
    """(table, count) from the two pushes before a call, or None when they are not constants."""
    rows = insns_before(site, span=0x120)
    pushes = []  # (operand, index in rows)
    for i in range(len(rows) - 1, -1, -1):
        addr, mnem, ops = rows[i]
        if mnem.startswith("push"):
            pushes.append((ops, i))
            if len(pushes) == 2:
                break
        elif mnem.startswith(("call", "jmp", "ret")) or "%esp" in ops:
            break
    if len(pushes) < 2:
        return None
    (table_op, ti), (count_op, ci) = pushes
    if not table_op.startswith("$"):
        return None
    if count_op.startswith("$"):
        count = int(count_op[1:], 16)
    elif count_op.startswith("%"):
        count = reg_immediate(rows, ci, count_op)
        if count is None:
            return None
    else:
        return None
    return int(table_op[1:], 16), count


# --- boxes -------------------------------------------------------------------

def box_rows(table, count):
    rows = []
    for n in range(count):
        base = table + n * ROW
        if offset(base + ROW - 4) is None:
            raise SystemExit(f"box table {table:#010x} row {n} is not mapped in the exe")
        rows.append({
            "offset": [f32(base), f32(base + 4), f32(base + 8)],
            "radius": f32(base + 0x0C),
            "halfX": f32(base + 0x10),
            "shape": u32(base + 0x14),
            "flags": u32(base + 0x18),
        })
    return rows


def fmt_num(v):
    if v is None:
        return "0"
    if float(v).is_integer():
        return str(int(v))
    return repr(float(v))


# --- main --------------------------------------------------------------------

def main(argv):
    summary_only = "--summary" in argv
    blob = text_bytes()
    starts = function_starts(blob)
    starts_va = [TEXT_LO + s for s in starts]

    def func_of(va):
        i = bisect.bisect_right(starts_va, va) - 1
        return starts_va[i] if i >= 0 else None

    calls = e8_calls(blob)
    callees = collections.defaultdict(set)
    for site, target in calls:
        f = func_of(site)
        if f is not None and TEXT_LO <= target < TEXT_HI:
            callees[f].add(func_of(target) or target)

    init_sites = sorted({s for s, t in calls if t == INIT})

    sites = []
    dynamic = []
    for s in init_sites:
        args = stack_args(s)
        f = func_of(s)
        if args is None:
            dynamic.append((s, f))
            continue
        table, count = args
        sites.append({"site": s, "func": f, "table": table, "count": count})

    # Factory rows: {u32 type, u32 creator, u32 tag, u32 0} in the data sections.
    factory = collections.defaultdict(set)
    for name, va, size, raw, rawsize in SECTIONS:
        if name == ".text":
            continue
        for off in range(raw, raw + rawsize - 16, 4):
            t, c, tag, zero = struct.unpack_from("<IIII", DATA, off)
            if tag == ROW_TAG and zero == 0 and TEXT_LO <= c < TEXT_HI:
                factory[t].add(func_of(c) or c)

    # Types reaching each function down the call graph: reach[func][type] is the
    # shallowest depth (0 = the creator itself, 1 = a function it calls, ...).
    reach = collections.defaultdict(dict)
    for t, creators in factory.items():
        for c in creators:
            depth_of = {c: 0}
            frontier = {c}
            for d in range(1, DEPTH + 1):
                nxt = set()
                for f in frontier:
                    for g in callees.get(f, ()):
                        if g not in depth_of:
                            depth_of[g] = d
                            nxt.add(g)
                frontier = nxt
            for f, d in depth_of.items():
                if d < reach[f].get(t, DEPTH + 1):
                    reach[f][t] = d

    # Boxes per table (one decode per distinct table).
    tables = {}
    for s in sites:
        if s["table"] not in tables:
            tables[s["table"]] = box_rows(s["table"], s["count"])
    by_type = collections.defaultdict(list)  # type -> [(table, depth)]
    for s in sites:
        for t, d in sorted(reach.get(s["func"], {}).items()):
            by_type[t].append((s["table"], d))

    if summary_only:
        print(f"sites {len(init_sites)} decoded {len(sites)} dynamic {len(dynamic)}")
        print(f"distinct tables {len(tables)} factory types {len(factory)}")
        unique = sum(1 for t in by_type if len({v for v, _ in by_type[t]}) == 1)
        print(f"types with a box {len(by_type)} (one table: {unique})")
        return 0

    lines = []
    lines.append("// Generated by tools/gen-collision-boxes.py from PsoBB.exe. Do not edit by hand.")
    lines.append("// Numbers only: each table is 0x2c-byte rows read at run time (x, y, z, radius at +0x0c,")
    lines.append("// half width at +0x10, shape at +0x14 (0 sphere, 1 box), flags at +0x18).")
    lines.append("// Sites: the calls to InitEnemyCollisionBoxes_007b9a88 (0x007b9a88) that pass a")
    lines.append("// constant table. TYPE_COLLISION_TABLES maps a factory type id to the tables its")
    lines.append("// constructor reaches: depth 0 = the constructor is the site's function, depth 1 = it")
    lines.append("// calls that function, and so on (ASSUMED: the shallowest depth is kept; a shared")
    lines.append("// helper serves every type that reaches it).")
    lines.append(f"// {len(dynamic)} sites are not decoded: their table or count is computed at run time.")
    lines.append("")
    lines.append("export interface CollisionBoxRow {")
    lines.append("  offset: readonly [number, number, number];")
    lines.append("  radius: number;")
    lines.append("  halfX: number;")
    lines.append("  shape: number;")
    lines.append("  flags: number;")
    lines.append("}")
    lines.append("")
    lines.append("export interface CollisionBoxSite {")
    lines.append("  site: number;")
    lines.append("  func: number;")
    lines.append("  table: number;")
    lines.append("}")
    lines.append("")
    lines.append("export interface CollisionTableLink {")
    lines.append("  table: number;")
    lines.append("  depth: number;")
    lines.append("}")
    lines.append("")
    lines.append("// Box tables keyed by their exe address (InitEnemyCollisionBoxes table argument).")
    lines.append("export const COLLISION_TABLES: Readonly<Record<number, readonly CollisionBoxRow[]>> = {")
    for va in sorted(tables):
        rows = tables[va]
        body = ", ".join(
            "{ offset: [%s, %s, %s], radius: %s, halfX: %s, shape: %d, flags: 0x%x }" % (
                fmt_num(r["offset"][0]), fmt_num(r["offset"][1]), fmt_num(r["offset"][2]),
                fmt_num(r["radius"]), fmt_num(r["halfX"]), r["shape"] or 0, r["flags"] or 0)
            for r in rows)
        lines.append(f"  0x{va:08x}: [{body}],")
    lines.append("};")
    lines.append("")
    lines.append("// Every decoded call site (243 in the exe; the dynamic ones are not listed).")
    lines.append("export const COLLISION_SITES: readonly CollisionBoxSite[] = [")
    for s in sites:
        lines.append(f"  {{ site: 0x{s['site']:08x}, func: 0x{s['func']:08x}, table: 0x{s['table']:08x} }},")
    lines.append("];")
    lines.append("")
    lines.append("// Factory type id -> the box tables its constructor reaches (only types that reach a site).")
    lines.append("export const TYPE_COLLISION_TABLES: Readonly<Record<number, readonly CollisionTableLink[]>> = {")
    for t in sorted(by_type):
        links = sorted(set(by_type[t]), key=lambda x: (x[1], x[0]))
        body = ", ".join(f"{{ table: 0x{v:08x}, depth: {d} }}" for v, d in links)
        lines.append(f"  0x{t:04x}: [{body}],")
    lines.append("};")
    lines.append("")
    with open(OUT, "w") as fh:
        fh.write("\n".join(lines))
    print(f"wrote {OUT}: {len(sites)} sites, {len(tables)} tables, {len(dynamic)} dynamic")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
