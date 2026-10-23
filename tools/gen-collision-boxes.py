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


def entry_like(blob, i):
    """True when the byte(s) before offset i look like the end of the previous function."""
    if i < 3 or i >= len(blob):
        return False
    return blob[i - 1] in (0xCC, 0x90, 0xC3) or blob[i - 3] == 0xC2


def section_of(va):
    for name, start, size, _, rawsize in SECTIONS:
        if start <= va < start + size:
            return name
    return None


def vtable_calls(blob, func_of, starts_va, window=0x400):
    """(call VA, slot target VA, vtable VA) for virtual calls whose vtable is stored in the same function.

    The store is `C7 /0 imm32` with mod 00 (movl $V, (%reg)); the call is `FF /2` with mod 10
    and disp32 (calll *disp32(%reg), rm != 4). The slot is the u32 at V + disp32 in the exe's
    .rdata / .data, when it points into .text. Example: Booma 0x44, its ctor 0x00535f1c stores
    0x00b01fc0 and calls *0x14c(%ebx) (slot 0x00786848)."""
    stores = []
    for m in re.finditer(rb"\xc7[\x00\x01\x02\x03\x06\x07]", blob):
        pos = m.start()
        if pos + 6 > len(blob):
            continue
        imm, = struct.unpack_from("<I", blob, pos + 2)
        if section_of(imm) in (None, ".text"):
            continue
        stores.append((TEXT_LO + pos, imm))
    store_vas = [s for s, _ in stores]
    out = []
    for m in re.finditer(rb"\xff[\x90\x91\x92\x93\x95\x96\x97]", blob):
        pos = m.start()
        if pos + 6 > len(blob):
            continue
        call_va = TEXT_LO + pos
        disp, = struct.unpack_from("<I", blob, pos + 2)
        i = bisect.bisect_left(store_vas, call_va) - 1
        if i < 0:
            continue
        s_va, vtable = stores[i]
        if call_va - s_va > window or func_of(s_va) != func_of(call_va):
            continue
        slot = u32(vtable + disp)
        if slot is None or not (TEXT_LO <= slot < TEXT_HI):
            continue
        out.append((call_va, slot, vtable))
    return out


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


# --- enemy set types ---------------------------------------------------------

# Per-area enemy factory rows: 47 pointers at 0x009fba60, each to rows of
# {u32 set type, u32 factory, f32 distance^2, u32 child count}, ended by type 0xFFFF.
# The factory allocates the enemy and runs its constructor (formats/enemymodels.ts).
ENEMY_FACTORY_TABLE = 0x009FBA60
ENEMY_AREAS = 47
DEPTH_LIMIT = 4  # call-graph depth from a factory to a constructor's box call


def enemy_factory_rows():
    """{set type: {factory VA: set of areas}} read from the per-area tables."""
    out = collections.defaultdict(lambda: collections.defaultdict(set))
    for area in range(ENEMY_AREAS):
        p = u32(ENEMY_FACTORY_TABLE + 4 * area)
        if p is None:
            raise SystemExit(f"area {area} row table pointer is not mapped")
        for _ in range(512):
            t = u32(p)
            if t is None or (t & 0xFFFF) == 0xFFFF:
                break
            out[t][u32(p + 4)].add(area)
            p += 16
    return out


def call_tree(root, graph, depth_limit):
    """{function: depth} of the functions reached from root by E8 calls (depth 0 = root)."""
    depth_of = {root: 0}
    frontier = {root}
    for d in range(1, depth_limit + 1):
        nxt = set()
        for f in frontier:
            for g in graph.get(f, ()):
                if g not in depth_of:
                    depth_of[g] = d
                    nxt.add(g)
        frontier = nxt
    return depth_of


def wrapper_sites(init_sites, func_of, calls, dynamic_funcs):
    """Constant-argument calls to a helper that passes its own table on to InitEnemyCollisionBoxes.

    The enemy base helper at 0x0051ff3c takes (table, count) as stack arguments and calls the
    init with them, so its own init site is dynamic. Each E8 call to such a helper with constant
    arguments is an effective site of the caller (the derived constructor), attributed there."""
    by_target = collections.defaultdict(list)
    for site, target in calls:
        by_target[target].append(site)
    out = []
    for w in sorted(dynamic_funcs):
        for c in by_target.get(w, []):
            args = stack_args(c)
            if args is None:
                continue
            out.append({"site": c, "func": func_of(c), "table": args[0], "count": args[1], "via": w})
    return out


def main(argv):
    summary_only = "--summary" in argv
    blob = text_bytes()
    starts = function_starts(blob)
    calls = e8_calls(blob)
    # A called address is a function entry even when the padding guess misses it (the
    # enemy base helper 0x0051ff3c follows a `ret $4`, not padding), and so is an enemy
    # factory, which the per-area table reaches through a pointer, not a call.
    factories = enemy_factory_rows()
    # The E8 scan is not instruction-aligned: a byte pair inside an instruction can read as a call.
    # A call target is a function start only when the bytes before it look like an entry (padding,
    # a `ret`, or `ret imm16`); the rest are misreads (0x00535486 split the Claw factory 0x00535408).
    starts_va = sorted({TEXT_LO + s for s in starts}
                       | {t for _, t in calls if TEXT_LO <= t < TEXT_HI and entry_like(blob, t - TEXT_LO)}
                       | {f for facs in factories.values() for f in facs})

    def func_of(va):
        i = bisect.bisect_right(starts_va, va) - 1
        return starts_va[i] if i >= 0 else None

    # Virtual calls: a ctor stores its vtable (movl $V, (%reg)) and later calls *disp32(%reg)
    # (FF /2). The target is the slot read from the exe's vtable V (ASSUMED: the nearest store
    # in the same function is the object's vtable; the register is not matched).
    vt_calls = vtable_calls(blob, func_of, starts_va)
    slot_targets = {t for _, t, _ in vt_calls}
    starts_va = sorted(set(starts_va) | slot_targets)

    callees = collections.defaultdict(set)
    for site, target in calls:
        f = func_of(site)
        if f is not None and TEXT_LO <= target < TEXT_HI:
            callees[f].add(func_of(target) or target)
    for site, target, _ in vt_calls:
        f = func_of(site)
        if f is not None:
            callees[f].add(func_of(target) or target)

    init_sites = sorted({s for s, t in calls if t == INIT})

    sites = []  # direct: the init call has constant arguments
    dynamic = []
    for s in init_sites:
        args = stack_args(s)
        f = func_of(s)
        if args is None:
            dynamic.append((s, f))
            continue
        table, count = args
        sites.append({"site": s, "func": f, "table": table, "count": count, "via": None})
    wrappers = wrapper_sites(init_sites, func_of, calls, {f for _, f in dynamic if f is not None})
    for w in wrappers:
        sites.append({"site": w["site"], "func": w["func"], "table": w["table"], "count": w["count"], "via": w["via"]})
    unresolved = len(dynamic) - len({w["via"] for w in wrappers})

    tables = {}
    for s in sites:
        if s["table"] not in tables:
            tables[s["table"]] = box_rows(s["table"], s["count"])

    site_by_func = collections.defaultdict(list)
    for s in sites:
        site_by_func[s["func"]].append(s)

    # Enemy set type -> factory (per area) -> the box table its constructor sets.
    trees = {}
    fan_in = collections.Counter()  # function -> number of set types whose factories reach it
    for t, facs in factories.items():
        seen = set()
        for fac in facs:
            trees[(t, fac)] = call_tree(fac, callees, DEPTH_LIMIT)
            seen |= set(trees[(t, fac)])
        for g in seen:
            fan_in[g] += 1

    links = collections.defaultdict(list)  # set type -> [link]
    for (t, fac), depth_of in sorted(trees.items()):
        cands = []
        for g, d in depth_of.items():
            for s in site_by_func.get(g, []):
                cands.append((d, s))
        # A function that several set types reach is a shared helper: the constructor that sets
        # this type's table is one that only this type reaches (ASSUMED: a shared helper is used
        # only when nothing else is found).
        # A pair (fan-in 2) is the one case that is resolved: two set types whose constructors call
        # the same helper with a constant table (Canadine 0x83 and Canane 0x84 both reach 0x005424d8,
        # which passes table 0x009bcecc, count 1, to 0x0051ff3c; the constant is in the helper, so each
        # caller gets the same box). ASSUMED: the pair's other factories do not overwrite it.
        own = [c for c in cands if fan_in[c[1]["func"]] <= 1]
        pair = [c for c in cands if fan_in[c[1]["func"]] == 2 and c[1]["via"] is not None]
        pool = own or pair or cands
        link = {"factory": fac, "areas": sorted(factories[t][fac]), "shared": bool(cands) and not own and not pair}
        if not pool:
            link.update({"table": None, "func": None, "depth": None, "via": None, "ambiguous": False})
        else:
            dmin = min(d for d, _ in pool)
            best = [s for d, s in pool if d == dmin]
            best_tables = sorted({s["table"] for s in best})
            pick = max((s for s in best), key=lambda s: s["site"])  # the last call in the constructor
            link.update({"table": pick["table"], "func": pick["func"], "depth": dmin, "via": pick["via"],
                         "ambiguous": len(best_tables) > 1})
        links[t].append(link)

    if summary_only:
        own_types = {t for t in links if any(l["table"] is not None and not l["shared"] for l in links[t])}
        any_types = {t for t in links if any(l["table"] is not None for l in links[t])}
        print(f"sites {len(init_sites)} direct {len(sites) - len(wrappers)} wrappers {len(wrappers)} unresolved {unresolved}")
        print(f"distinct tables {len(tables)} enemy set types {len(links)} own table {len(own_types)} "
              f"shared only {len(any_types - own_types)} none {len(links) - len(any_types)}")
        return 0

    lines = []
    lines.append("// Generated by tools/gen-collision-boxes.py from PsoBB.exe. Do not edit by hand.")
    lines.append("// Numbers only: each table is 0x2c-byte rows read at run time (x, y, z, radius at +0x0c,")
    lines.append("// half width at +0x10, shape at +0x14 (0 sphere, 1 box), flags at +0x18).")
    lines.append("// Sites: the calls to InitEnemyCollisionBoxes_007b9a88 (0x007b9a88) that pass a")
    lines.append("// constant table, and the calls to the helpers that pass their own table on (via).")
    lines.append("// ENEMY_COLLISION_LINKS maps an enemy .dat set type to its factory (per area, 0x009fba60)")
    lines.append("// and the box table its constructor sets: the shallowest site reached from the factory")
    lines.append("// down the call graph (depth 4; virtual calls resolved through the stored vtable) in a function")
    lines.append("// that only this type reaches, or that exactly two types reach with a constant helper argument")
    lines.append("// (ASSUMED; shared: only helpers reached by three or more types), the last call when ambiguous.")
    lines.append(f"// {unresolved} init sites are not decoded: their table or count is computed at run time.")
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
    lines.append("  via: number | null;")
    lines.append("}")
    lines.append("")
    lines.append("export interface CollisionTableLink {")
    lines.append("  table: number;")
    lines.append("  depth: number;")
    lines.append("}")
    lines.append("")
    lines.append("export interface EnemyCollisionLink {")
    lines.append("  factory: number;")
    lines.append("  areas: readonly number[];")
    lines.append("  table: number | null;")
    lines.append("  func: number | null;")
    lines.append("  depth: number | null;")
    lines.append("  via: number | null;")
    lines.append("  shared: boolean;")
    lines.append("  ambiguous: boolean;")
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
    lines.append(f"// Every decoded call site ({len(sites)}; the unresolved ones are not listed).")
    lines.append("export const COLLISION_SITES: readonly CollisionBoxSite[] = [")
    for s in sites:
        via = "null" if s["via"] is None else f"0x{s['via']:08x}"
        lines.append(f"  {{ site: 0x{s['site']:08x}, func: 0x{s['func']:08x}, table: 0x{s['table']:08x}, via: {via} }},")
    lines.append("];")
    lines.append("")
    lines.append("// Enemy .dat set type -> its factory links (one per factory; areas where it is used).")
    lines.append("export const ENEMY_COLLISION_LINKS: Readonly<Record<number, readonly EnemyCollisionLink[]>> = {")
    for t in sorted(links):
        parts = []
        for l in sorted(links[t], key=lambda x: x["factory"]):
            areas = "[" + ", ".join(str(a) for a in l["areas"]) + "]"
            table = "null" if l["table"] is None else f"0x{l['table']:08x}"
            func = "null" if l["func"] is None else f"0x{l['func']:08x}"
            depth = "null" if l["depth"] is None else str(l["depth"])
            via = "null" if l["via"] is None else f"0x{l['via']:08x}"
            parts.append(
                f"{{ factory: 0x{l['factory']:08x}, areas: {areas}, table: {table}, func: {func}, depth: {depth}, "
                f"via: {via}, shared: {'true' if l['shared'] else 'false'}, ambiguous: {'true' if l['ambiguous'] else 'false'} }}")
        lines.append(f"  0x{t:04x}: [{', '.join(parts)}],")
    lines.append("};")
    lines.append("")
    # Factory type id (the type table's {type, creator} rows, objects included) -> the box tables
    # its creator reaches: the depth-limited tree of the creator, the shallowest site (kept for
    # the object pillars; the enemies use ENEMY_COLLISION_LINKS, which resolves each one's own).
    creators = collections.defaultdict(set)
    for name, va, size, raw, rawsize in SECTIONS:
        if name == ".text":
            continue
        for off in range(raw, raw + rawsize - 16, 4):
            t, c, tag, zero = struct.unpack_from("<IIII", DATA, off)
            if tag == ROW_TAG and zero == 0 and TEXT_LO <= c < TEXT_HI:
                creators[t].add(func_of(c) or c)
    reach = collections.defaultdict(dict)
    for t, cs in creators.items():
        for c in cs:
            for f, d in call_tree(c, callees, DEPTH).items():
                if d < reach[f].get(t, DEPTH + 1):
                    reach[f][t] = d
    by_type = collections.defaultdict(list)
    for s in sites:
        for t, d in sorted(reach.get(s["func"], {}).items()):
            by_type[t].append((s["table"], d))
    lines.append("// Factory type id -> the box tables its constructor reaches (only types that reach a site).")
    lines.append("export const TYPE_COLLISION_TABLES: Readonly<Record<number, readonly CollisionTableLink[]>> = {")
    for t in sorted(by_type):
        links_t = sorted(set(by_type[t]), key=lambda x: (x[1], x[0]))
        body = ", ".join(f"{{ table: 0x{v:08x}, depth: {d} }}" for v, d in links_t)
        lines.append(f"  0x{t:04x}: [{body}],")
    lines.append("};")
    lines.append("")
    with open(OUT, "w") as fh:
        fh.write("\n".join(lines))
    print(f"wrote {OUT}: {len(sites)} sites ({len(wrappers)} via helpers), {len(tables)} tables, {unresolved} unresolved")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
