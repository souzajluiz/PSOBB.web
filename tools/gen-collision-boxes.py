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
import json
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

# The MSVC frame prologue `push ebp; mov ebp, esp`.
PROLOGUE = b"\x55\x8b\xec"


def function_starts(blob):
    starts = []
    pads = (0xCC, 0x90)
    for i in range(2, len(blob)):
        if blob[i] not in pads and blob[i - 1] in pads and blob[i - 2] in pads:
            starts.append(i)
        elif prologue_after_jump(blob, i):
            starts.append(i)
    return starts


def prologue_after_jump(blob, i):
    """A prologue right after a short `jmp` (EB xx) or a `ret`, with no padding. Plot Falz's
    constructor 0x0048d814 is one: `0048d812: eb xx` ends the function before it (the factory 0x0048d764
    calls it), so the padding guess missed it and its call target folded into the previous function."""
    if blob[i:i + 3] != PROLOGUE:
        return False
    if blob[i - 1] == 0xC3:  # a ret
        return True
    # the SEH-style epilogue `xor eax, eax; jmp L` right before it, or one nop after the jump
    # (0x00662ef0 follows `jmp; nop`: `0662eed: eb xx`, `0662eef: 90`)
    return (blob[i - 2] == 0xEB and blob[i - 4:i - 2] == b"\x33\xc0") or (blob[i - 1] == 0x90 and blob[i - 3] == 0xEB)


def entry_like(blob, i):
    """True when the byte(s) before offset i look like the end of the previous function."""
    if i < 3 or i >= len(blob):
        return False
    return blob[i - 1] in (0xCC, 0x90, 0xC3) or blob[i - 3] == 0xC2 or prologue_after_jump(blob, i)


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


def global_ptr_calls(blob, func_of, window=0x20):
    """(call VA, target VA, global VA) for `mov abs, %reg; ...; call *%reg` with the pointer read from the exe.

    The load is `8b /r` with mod 00 and rm 101 (a disp32 absolute: `mov 0x9a6c64, %eax` is 8b 05); the
    call is `ff /2` with mod 11 on the same register, within `window` bytes, and no other call between
    (ASSUMED: the first call after the load is the one that uses it). The target is the u32 at the
    global, read from the exe's .data (ASSUMED: nothing stores to it at run time; the Plot Falz state table
    0x009a6c64 has three reads and no store in the exe). Plot Falz's constructor 0x0048d814 calls
    its state-0 enter handler this way (0x0048dad1 / 0x0048dada)."""
    out = []
    for m in re.finditer(rb"\x8b[\x05\x0d\x15\x1d\x35\x3d]", blob):
        pos = m.start()
        if pos + 6 > len(blob):
            continue
        reg = (blob[pos + 1] >> 3) & 7
        glob, = struct.unpack_from("<I", blob, pos + 2)
        slot = u32(glob)
        if slot is None or not (TEXT_LO <= slot < TEXT_HI):
            continue
        for k in range(pos + 6, min(pos + 6 + window, len(blob) - 1)):
            if blob[k] == 0xE8:  # another call comes first
                break
            if blob[k] == 0xFF and 0xD0 <= blob[k + 1] <= 0xD7 and (blob[k + 1] & 7) == reg:
                out.append((TEXT_LO + k, slot, glob))
                break
    return out


def e8_calls(blob):
    """(site VA, target VA) for every direct call instruction inside .text.

    Read from objdump, so the sites are instruction-aligned: a raw E8 byte scan also matches an E8 inside
    another instruction (0x004accd0 is the byte before the call at 0x004accd1; its rel32 is the call's
    opcode and the next bytes), and those false edges fed the call graph (the 0xcb link through
    0x004acc98 -> 0x004cb480, DEVLOG 2026-10-25 Plot Falz)."""
    out = subprocess.run(["objdump", "-d", "--no-show-raw-insn", PATH], capture_output=True, text=True, check=True).stdout
    res = []
    for line in out.splitlines():
        m = re.match(r"^\s*([0-9a-f]+):\s.*\tcalll?\s+0x([0-9a-f]+)\s", line)
        if m and TEXT_LO <= int(m.group(1), 16) < TEXT_HI:
            res.append((int(m.group(1), 16), int(m.group(2), 16)))
    return res


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


# --- indexed tables: a linear walk of the constructor ------------------------
#
# A constructor can pick its table by an index it copied from the spawn record:
# `table = base + stride * [this+off]` (Booma 0x44, ctor 0x00535f1c: `leal
# 0x9bc8e0(%ebx,%ebx)` with edx = [this+0x33c], which the vtable slot 0x00786848 filled from
# its argument's s16 at +0x3c; 0x00536001..0x00536089). The walk below follows a function
# from its entry to the init call with linear forms. A value is (constant, ((leaf, coeff), ...)).
# Leaves: ('arg', k) (the k-th stack argument, 1-based), ('this',) (ECX at entry), ('M', addr
# terms, addr constant, width, signed) (a load no store of the walk reaches) and ('G', addr,
# width, signed) (an absolute load). A store of unknown value or address is kept as unknown or
# dropped (ASSUMED: no alias). A call whose target is constant (a vtable slot read from the
# exe, or a global function pointer) is walked into, depth 2, so its stores to the object count;
# any other call is opaque (eax, ecx, edx unknown). Branches are not followed: the walk is
# straight-line from the entry (ASSUMED: the path to the call is the one that matters).

ESP_ENTRY = 0x10000
STK = ("STK",)
THIS = ("this",)
INLINE_DEPTH = 2
REG_NAMES = {"ax": "eax", "al": "eax", "bx": "ebx", "bl": "ebx", "cx": "ecx", "cl": "ecx",
             "dx": "edx", "dl": "edx", "si": "esi", "di": "edi", "bp": "ebp", "sp": "esp"}
MEM_RE = re.compile(r"^(-?0x[0-9a-f]+|-?\d+)?\((%\w+)?(?:,(%\w+)(?:,(\d))?)?\)$")


class Unwalkable(Exception):
    pass


def L_const(c):
    return (c, ())


def L_add(a, b, k=1):
    if a is None or b is None:
        return None
    d = dict(a[1])
    for leaf, c in b[1]:
        d[leaf] = d.get(leaf, 0) + k * c
    return (a[0] + k * b[0], tuple(sorted(((x, c) for x, c in d.items() if c), key=repr)))


def L_scale(a, k):
    if a is None:
        return None
    return (a[0] * k, tuple(sorted(((x, c * k) for x, c in a[1] if c * k), key=repr)))


def split_ops(ops):
    return [p.strip() for p in re.split(r",(?![^()]*\))", ops) if p.strip()]


def sext(v, width):
    bits = width * 8
    v &= (1 << bits) - 1
    return v - (1 << bits) if v >> (bits - 1) else v


class Walk:
    def __init__(self, depth=0):
        self.regs = {r: None for r in ("eax", "ebx", "ecx", "edx", "esi", "edi", "ebp", "esp")}
        self.mem = {}
        self.depth = depth
        self.branches = 0

    def entry(self, nargs=4):
        self.regs["esp"] = (ESP_ENTRY, ((STK, 1),))
        self.regs["ecx"] = (0, ((THIS, 1),))
        self.mem[("S", ESP_ENTRY, 4)] = None  # the return address
        for k in range(1, nargs + 1):
            self.mem[("S", ESP_ENTRY + 4 * k, 4)] = (0, ((("arg", k), 1),))

    def operand(self, op):
        """(kind, value-or-address): ('imm', n), ('reg', name, width), ('mem', addr, width), ('bad', None)."""
        op = op.strip()
        if op.startswith("$"):
            return ("imm", int(op[1:], 0))
        if op.startswith("%") and ":" not in op:
            r = op[1:]
            if r in ("eax", "ebx", "ecx", "edx", "esi", "edi", "ebp", "esp"):
                return ("reg", r, 4)
            if r in REG_NAMES:
                return ("reg", REG_NAMES[r], 2 if r in ("ax", "bx", "cx", "dx", "si", "di", "bp", "sp") else 1)
            return ("bad", None)
        if ":" in op or op.startswith("*"):
            return ("bad", None)
        m = MEM_RE.match(op)
        if m:
            disp = int(m.group(1), 0) if m.group(1) else 0
            return ("mem", (disp, m.group(2)[1:] if m.group(2) else None, m.group(3)[1:] if m.group(3) else None, int(m.group(4) or 1)))
        if re.match(r"^-?0x[0-9a-f]+$", op):
            return ("mem", (int(op, 0), None, None, 1))
        return ("bad", None)

    def addr_of(self, parts):
        disp, base, index, scale = parts
        v = L_const(disp)
        if base:
            v = L_add(v, self.regs.get(base))
        if index:
            v = L_add(v, L_scale(self.regs.get(index), scale))
        return v

    @staticmethod
    def key(addr, width):
        if addr is None:
            return None
        c, terms = addr
        if terms == ():
            return ("A", c, width)
        if terms == ((STK, 1),):
            return ("S", c, width)
        return ("H", terms, c, width)

    @staticmethod
    def span(key):
        """(space, base, lo, hi) of a memory key: keys overlap when the spans do."""
        if key[0] == "H":
            return ("H", key[1], key[2], key[2] + key[3])
        return (key[0], None, key[1], key[1] + key[2])

    def store(self, addr, width, value):
        key = self.key(addr, width)
        if key is None:
            return
        sp = self.span(key)
        for k in list(self.mem):
            if k == key:
                continue
            s2 = self.span(k)
            if s2[0] == sp[0] and s2[1] == sp[1] and s2[2] < sp[3] and sp[2] < s2[3]:
                del self.mem[k]
        self.mem[key] = value

    def load(self, addr, width, signed=False):
        key = self.key(addr, width)
        if key is None:
            return None
        if key in self.mem:
            v = self.mem[key]
            if v is None or width == 4:
                return v
            if v[1] != ():
                return None
            return L_const(sext(v[0], width) if signed else v[0] & ((1 << width * 8) - 1))
        if key[0] == "A":
            leaf = ("G", key[1], width, signed)
        elif key[0] == "S":
            leaf = ("U", key[1], width, signed)
        else:
            leaf = ("M", addr[1], addr[0], width, signed)
        return (0, ((leaf, 1),))

    def read(self, kind, val, width, signed=False):
        if kind == "imm":
            return L_const(val)
        if kind == "reg":
            return self.regs[val] if width == 4 else None
        if kind == "mem":
            return self.load(self.addr_of(val), width, signed)
        return None

    def write(self, kind, val, width, value):
        if kind == "reg":
            self.regs[val] = value if width == 4 else None
        elif kind == "mem":
            self.store(self.addr_of(val), width, value)

    def push(self, value):
        esp = L_add(self.regs["esp"], L_const(-4))
        self.regs["esp"] = esp
        self.store(esp, 4, value)

    def pop(self):
        v = self.load(self.regs["esp"], 4)
        self.regs["esp"] = L_add(self.regs["esp"], L_const(4))
        return v


def walk_function(start, stop, depth, info, text_fn):
    """Walks the function at start up to stop (the call to the init). Returns the Walk."""
    w = Walk(depth)
    w.entry()
    insns = text_fn(start, stop)
    for addr, mnem, ops in insns:
        if addr >= stop:
            break
        if mnem.startswith(("j", "loop")):
            w.branches += 1
            continue
        if mnem.startswith("ret"):
            if mnem == "retl" and ops:
                n = int(ops.strip().lstrip("$"), 0)
            else:
                n = 0
            w.regs["esp"] = L_add(w.regs["esp"], L_const(4 + n))
            return w
        step(w, mnem, ops, info, text_fn)
    return w


def step(w, mnem, ops, info, text_fn):
    args = split_ops(ops) if ops else []
    if mnem in ("movl", "movw", "movb"):
        width = {"movl": 4, "movw": 2, "movb": 1}[mnem]
        s, d = w.operand(args[0]), w.operand(args[1])
        v = w.read(s[0], s[1], width) if s[0] in ("imm", "reg", "mem") else None
        if d[0] == "reg":
            w.write("reg", d[1], width, v if width == 4 else None)
        elif d[0] == "mem":
            w.write("mem", d[1], width, v)
        return
    if mnem in ("movzwl", "movswl", "movzbl", "movsbl"):
        width = 2 if mnem[4] == "w" else 1  # movzwl / movswl / movzbl / movsbl
        signed = mnem[3] == "s"
        s, d = w.operand(args[0]), w.operand(args[1])
        v = w.read("mem", s[1], width, signed) if s[0] == "mem" else None
        if d[0] == "reg":
            w.write("reg", d[1], 4, v)
        return
    if mnem == "leal":
        s, d = w.operand(args[0]), w.operand(args[1])
        v = w.addr_of(s[1]) if s[0] == "mem" else None
        if d[0] == "reg":
            w.write("reg", d[1], 4, v)
        return
    if mnem in ("addl", "subl"):
        s, d = w.operand(args[0]), w.operand(args[1])
        sv = w.read(s[0], s[1], 4) if s[0] in ("imm", "reg", "mem") else None
        dv = w.read(d[0], d[1], 4) if d[0] in ("reg", "mem") else None
        v = L_add(dv, sv, 1 if mnem == "addl" else -1)
        w.write(d[0], d[1], 4, v) if d[0] in ("reg", "mem") else None
        return
    if mnem == "xorl" and len(args) == 2 and args[0] == args[1]:
        d = w.operand(args[1])
        if d[0] == "reg":
            w.write("reg", d[1], 4, L_const(0))
        return
    if mnem == "shll" and len(args) == 2:
        s, d = w.operand(args[0]), w.operand(args[1])
        if s[0] == "imm" and d[0] == "reg":
            w.write("reg", d[1], 4, L_scale(w.regs[d[1]], 1 << s[1]))
            return
    if mnem == "imull" and len(args) in (2, 3):
        s = w.operand(args[0])
        dst = w.operand(args[-1])
        if s[0] == "imm" and dst[0] == "reg":
            src = w.operand(args[-2]) if len(args) == 3 else dst
            if src[0] == "reg":
                w.write("reg", dst[1], 4, L_scale(w.regs[src[1]], s[1]))
                return
    if mnem == "andl" and len(args) == 2:
        # `and $2^k-1, %reg` on one leaf (the Vol Opt monitor's shape: `and $3, %eax` at 0x004416b8, the
        # stack argument 4 masked): a leaf of its own, ('and', leaf, mask). Any other `and` is unknown.
        s, d = w.operand(args[0]), w.operand(args[1])
        if s[0] == "imm" and d[0] == "reg":
            v = w.regs[d[1]]
            mask = s[1]
            if v is not None and v[0] == 0 and len(v[1]) == 1 and v[1][0][1] == 1 and mask >= 0 and (mask & (mask + 1)) == 0:
                w.write("reg", d[1], 4, (0, ((("and", v[1][0][0], mask), 1),)))
            else:
                w.write("reg", d[1], 4, None)
        return
    if mnem == "pushl":
        s = w.operand(args[0])
        w.push(w.read(s[0], s[1], 4) if s[0] in ("imm", "reg", "mem") else None)
        return
    if mnem == "popl":
        d = w.operand(args[0])
        v = w.pop()
        if d[0] == "reg":
            w.write("reg", d[1], 4, v)
        return
    if mnem == "calll":
        # The walk stops at the init call itself (step never sees it); other calls come here.
        return call(w, args[0] if args else "", info, text_fn)
    if mnem in ("testl", "cmpl", "nop", "nopw", "nopl", "cmpw", "testw"):
        return
    # Anything else writes its last operand, if it is a register or memory: unknown.
    if args:
        d = w.operand(args[-1])
        if d[0] == "reg":
            w.write("reg", d[1], 4, None)
        elif d[0] == "mem" and mnem not in ("cmpw", "testw"):
            w.store(w.addr_of(d[1]), 4, None)


def call(w, target_op, info, text_fn):
    """A call: an indirect call with a constant target is walked into (depth 2), else opaque."""
    target = None
    if target_op.startswith("*"):
        t = w.operand(target_op[1:])
        if t[0] == "reg":
            v = w.regs[t[1]]
        elif t[0] == "mem":
            a = w.addr_of(t[1])
            # A constant address is read from the exe: a vtable slot or a global function pointer.
            v = (u32(a[0]), ()) if a is not None and a[1] == () and u32(a[0]) is not None else None
        else:
            v = None
        if v is not None and v[1] == ():
            target = v[0]
    else:
        target = int(target_op.split("<")[0].strip(), 16)
    text_lo, text_hi = info["text"]
    indirect = target_op.startswith("*")
    inlined = indirect and target is not None and text_lo <= target < text_hi and w.depth < INLINE_DEPTH
    if inlined:
        sub = Walk(w.depth + 1)
        sub.regs = dict(w.regs)
        sub.mem = w.mem  # the callee's stores land in the caller's memory
        sub.regs["esp"] = L_add(w.regs["esp"], L_const(-4))
        sub.store(sub.regs["esp"], 4, None)
        insns = text_fn(target, target + 0x200)
        for addr, mnem, ops in insns:
            if mnem.startswith("ret"):
                n = int(ops.strip().lstrip("$"), 0) if mnem == "retl" and ops else 0
                w.regs["esp"] = L_add(sub.regs["esp"], L_const(4 + n))
                w.regs["eax"] = sub.regs["eax"]
                w.regs["ebx"] = sub.regs["ebx"]
                w.regs["esi"] = sub.regs["esi"]
                w.regs["edi"] = sub.regs["edi"]
                w.regs["ebp"] = sub.regs["ebp"]
                w.regs["ecx"] = None
                w.regs["edx"] = None
                return
            if mnem.startswith("j"):
                raise Unwalkable("branch in callee")
            step(sub, mnem, ops, info, text_fn)
        raise Unwalkable("callee has no ret")
    for r in ("eax", "ecx", "edx"):
        w.regs[r] = None
    # An opaque callee pops its own stack arguments when it is stdcall (`retl $n`); cdecl callers
    # pop them after the call, so n is the callee's pop count (None when unknown).
    n = callee_pops(target, info, text_fn) if target is not None else None
    w.regs["esp"] = None if n is None else L_add(w.regs["esp"], L_const(n))


def callee_pops(target, info, text_fn):
    """The bytes a function pops on return (`retl $n`): the first ret in its code (ASSUMED: the
    straight-line path; branches before it are not followed). None when there is no ret nearby."""
    for _, mnem, ops in text_fn(target, target + 0x1000):
        if mnem.startswith("ret"):
            return int(ops.strip().lstrip("$"), 0) if mnem == "retl" and ops else 0
    return None


def indexed_site(site, func, info, text_fn):
    """The index of an init call whose table is base + stride * (a load), or None.

    Returns {'base', 'stride', 'index': leaf, 'count'} for the table argument, else None."""
    try:
        w = walk_function(func, site, 0, info, text_fn)
    except Unwalkable:
        return None
    esp = w.regs["esp"]
    if esp is None or esp[1] != ((STK, 1),):
        return None
    table = w.load(esp, 4)
    count = w.load(L_add(esp, L_const(4)), 4)
    if table is None or count is None or count[1] != () or table[1] == ():
        return None
    if len(table[1]) != 1:
        return None
    leaf, stride = table[1][0]
    if not (isinstance(leaf, tuple) and leaf[0] in ("M", "and")):
        return None
    if leaf[0] == "and" and not (isinstance(leaf[1], tuple) and leaf[1][0] == "arg"):
        return None
    return {"base": table[0], "stride": stride, "index": leaf, "count": count[0],
            "branches": w.branches}


def text_fn(start, stop):
    """(VA, mnemonic, operands) of the instructions from start up to stop (objdump, comments cut)."""
    out = subprocess.run(
        ["objdump", "-d", "--no-show-raw-insn", f"--start-address={start:#x}", f"--stop-address={stop:#x}", PATH],
        capture_output=True, text=True, check=True,
    ).stdout
    rows = []
    for line in out.splitlines():
        m = LINE.match(line)
        if m:
            rows.append((int(m.group(1), 16), m.group(2), m.group(3).split("#")[0].strip()))
    return rows


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
DEPTH_LIMIT = 5  # call-graph depth from a factory to a constructor's box call


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


MAX_VARIANTS = 16  # an indexed table is read up to this many rows (ASSUMED bound)

# Constructors that are built in a loop by a function outside every factory tree (the AI's build
# state, not the constructor's own vtable), so ENEMY_COLLISION_LINKS cannot reach them. Each entry is
# a hand-read exe fact, checked by main(): the constructor (key), the E8 call site in the loop (site),
# the stack argument that carries the loop counter (arg), and the loop's count. Child k (0-based, in
# creation order) gets the table of variant k & mask. Vol Opt (set type 0xc2): its state 0 build
# (EnemyProcessAiState, 0x0043c680) runs the 0x18 loop at 0x0043c8a2..0x0043c94d; the counter
# [ebp-0x18] is pushed as argument 4 at 0x0043c92e, and the monitor's constructor 0x0044161c masks it
# with 3 (0x004416b8) for its shape. ASSUMED: the counter is the monitor's index (VoloptMonitor(i)).
CHILD_CALLERS = {
    0x0044161C: {"set": 0x00C2, "site": 0x0043C92E, "arg": 4, "count": 0x18, "bound": 0x0043C94A},
}

# Loop-built children with one constant table (no index): every child takes the same row set
# (variant 0, written with mask 0). Dark Falz's Darvants (set type 0xc8): the grid 0x0044c430 builds
# them in its rings (5, 15, 25, 35: 80 in all, ASSUMED from the ring bounds, DEVLOG 2026-10-25) by
# calling the factory 0x0045fb24 at 0x0044c605; the factory calls the constructor 0x0045fbd4 at
# 0x0045fbaf, and that constructor's init (0x0045fca0) passes the constant table 0x009a67c8, one row.
CHILD_CONST_CALLERS = {
    0x0045FBD4: {"set": 0x00C8, "site": 0x0044C605, "factory": 0x0045FB24, "count": 80,
                 "factory_site": 0x0045FBAF, "init_site": 0x0045FCA0, "table": 0x009A67C8},
}


# Init sites that box a CHILD object the constructor allocates, not the enemy itself. The enemy link
# (ENEMY_COLLISION_LINKS) skips them; TYPE_COLLISION_TABLES still lists them (reach only). Each is a
# hand-read exe fact (DEVLOG 2026-10-25, Plot Falz row / 0x116 + 0x65 check):
#   0x005a9f65: the 0x116 ctor 0x005a9c58 allocates 0xac (0x005a9f16) and stores it at this+0x4a4; the
#     init at 0x005a9f65 runs with ecx = the child (`mov %eax, %ecx` at 0x005a9f5c), table 0x009c0844.
#     The own box is the init at 0x005a9cb9 (ecx = this, via 0x0051ff3c, table 0x009c07c0).
#   0x00586d40: the 0x65 sub-factory 0x00586b44 (called by the 0x65 ctor 0x00582ef4 at 0x005832c0)
#     allocates a 0x478 object and constructs it with 0x00586bf8 (`call` at 0x00586bd2, ecx = the
#     object); its init at 0x00586d40 boxes the child with table 0x009bf60c. The own box is 0x00582fde.
CHILD_OBJECT_SITES = {
    0x005A9F65: "0x116 child (0xac, this+0x4a4) in the ctor 0x005a9c58",
    0x00586D40: "0x65 child (0x478) built by 0x586b44 in the ctor 0x582ef4",
    # The 0x116 ctor 0x005a9c58 news two more children (0x5caba4 at 0x005a9e68 and 0x005a9ec5, stored in ebp-0x3c
    # and passed as ecx), each initialised through the base helper 0x00521c5c with table 0x009c07ec / 0x009c0818, count 1.
    0x005A9E95: "0x116 child (new'd at 0x005a9e68) in the ctor 0x005a9c58, table 0x009c07ec",
    0x005A9EEC: "0x116 child (new'd at 0x005a9ec5) in the ctor 0x005a9c58, table 0x009c0818",
    # The two 0x108-byte children of ctor 0x007ae360 (this+0x74 / +0x78; their box is at +0xac) and of 0x007aea10
    # (the same two slots): the box is the child's, not the parent's (ASSUMED, DEVLOG 2026-10-25 SITE_OVERRIDES).
    0x007AE641: "child 0x108 at this+0x74 of ctor 0x7ae360 (type 0x1b reaches it)",
    0x007AE80F: "child 0x108 at this+0x78 of ctor 0x7ae360",
    0x007AECEB: "child 0x108 at this+0x74 of ctor 0x7aea10",
    0x007AEEB9: "child 0x108 at this+0x78 of ctor 0x7aea10",
    # The 0xac children of the in-object rows (CONSTRUCTED_SITES below holds the same-pattern children): 0x006ebef1
    # (ctor 0x6ebd58, child at this+0xdc, row this+0xb0), 0x007acd78 (ctor 0x7acaf8, child at this+0x68, row this+0x3c).
    0x006EBEF1: "0xac child (this+0xdc) of ctor 0x6ebd58; row this+0xb0 is its own constant box",
    0x007ACD78: "0xac child (this+0x68) of ctor 0x7acaf8; row this+0x3c is its own constant box",
}


# Init sites whose table or count the decoder cannot read (dynamic), resolved by hand from the exe
# (DEVLOG 2026-10-25, the 27 unresolved sites). Each entry gives one of:
#   "table": a static table VA read from the exe (its rows are decoded like any other table);
#   "variants": {index: table VA}, the table chosen by a runtime index (the rows are read and checked);
#   "rows": the box row built on the caller's stack (no exe VA; the key is the site VA itself). The rows are the constructor's stores, read from the objdump (ASSUMED: the
#     gate in front of the init, a BSS flag, is taken as set).
# "count" is the init's count argument. Sites not listed stay unresolved.
INLINE_ROWS = {
    # Dark Falz / Vol Opt style sphere rows built per type on the stack (count 1, flags 0x10003):
    "sphere13": {"offset": [0.0, 0.0, 0.0], "radius": 13.0, "halfX": 0.0, "shape": 0, "flags": 0x10003},
    "sphere22_5": {"offset": [0.0, 0.0, 0.0], "radius": 22.5, "halfX": 0.0, "shape": 0, "flags": 0x10003},
    "sphere23": {"offset": [0.0, 0.0, 0.0], "radius": 23.0, "halfX": 0.0, "shape": 0, "flags": 0x10003},
    "sphere3": {"offset": [0.0, 0.0, 0.0], "radius": 3.0, "halfX": 0.0, "shape": 0, "flags": 0x10003},
    # Object-embedded record (this+0xac of the 0x108-byte child at this+0x74 / +0x78): sphere r19 at z 5.
    "child19": {"offset": [0.0, 0.0, 5.0], "radius": 19.0, "halfX": 5.0, "shape": 0, "flags": 0x1103},
    # Child boxes stored as constants by their constructors (DEVLOG 2026-10-25, collision sites: the last two):
    # 0x006ebd58 writes the row at this+0xb0 (x 0, y 0, z 0, radius 10, halfX 1, shape 0, flags 0x40107) and
    # inits its 0xac child (this+0xdc) with it; 0x007acaf8 writes the row at this+0x3c (offset 0, radius 5, halfX 1,
    # shape 1, flags 0x40007, the offset is the constant 0.0 at 0x0097dbd8) and inits its child (this+0x68).
    "child10_sphere_40107": {"offset": [0.0, 0.0, 0.0], "radius": 10.0, "halfX": 1.0, "shape": 0, "flags": 0x40107},
    "child5_box_40007": {"offset": [0.0, 0.0, 0.0], "radius": 5.0, "halfX": 1.0, "shape": 1, "flags": 0x40007},
}

SITE_OVERRIDES = {
    # 0x00524b90 (type 0x60, ctor 0x005249c8): table = 0x009bbb80 + 92 * [this+0x370]; the ctor stores 0 there
    # at 0x00524ac5 before the call, so the index is 0. (Exe row: centre y 15, radius 10, sphere, flags 0x8003.)
    0x00524B90: {"table": 0x009BBB80, "count": 1},
    # 0x00664461 (type 0x223, ctor 0x006643a4): table = 0x009c8ae0 + 44 * idx, idx = min(trunc(|[this+0x84]|), 3).
    0x00664461: {"variants": {0: 0x009C8AE0, 1: 0x009C8B0C, 2: 0x009C8B38, 3: 0x009C8B64}, "count": 1},
    # 0x00664647 (type 0x224, ctor 0x00664564): table = 0x009c8f00 + 44 * idx, idx = min(trunc(|[this+0x88]|), 2).
    0x00664647: {"variants": {0: 0x009C8F00, 1: 0x009C8F2C, 2: 0x009C8F58}, "count": 1},
    # Signed index (type 0x82, ctor 0x0065db10; type 0x96, ctor 0x0065deb8 reached through a pointer): v = [this+0x8c],
    # idx = sign(v) * (|v| & 1) (cdq / xor / sub / and 1 / xor / sub at 0x0065dcb0..0x0065dcc4), table
    # 0x009c8340 + 132 * idx (eax = 4 * idx, ebx = 128 * idx, lea 0x9c8340(%eax,%ebx) at 0x0065dcd1), count 3 (push $3 at 0x0065dcae).
    # idx = -1 would read 0x009c82bc, which holds pointers (0x00938a..), not a box, so it is not a variant. ASSUMED: v >= 0
    # (the set record's field is never negative), so only idx 0 / 1 are reachable.
    0x0065DCD9: {"variants": {0: 0x009C8340, 1: 0x009C83C4}, "count": 3},
    0x0065E0DD: {"variants": {0: 0x009C8340, 1: 0x009C83C4}, "count": 3},
    # Type 0x83, ctor 0x0065e5bc: the same signed index, table 0x009c84e0 + 220 * idx (ebx = 110 * idx, lea
    # 0x9c84e0(%ebx,%ebx) at 0x0065e7a7), count 5 (push $5 at 0x0065e780). idx = -1 reads 0x009c8404 (not a box: the
    # pointers 0x00938b.. of another table), so only 0 / 1 (ASSUMED v >= 0, as above).
    0x0065E7AF: {"variants": {0: 0x009C84E0, 1: 0x009C85BC}, "count": 5},
    # The sphere rows on the caller's stack (count 1): 0x4b r13, 0x4c r13, 0x4d r22.5, 0x50 r23, 0x51 r3.
    0x00647B4B: {"rows": "sphere13", "count": 1},  # type 0x4b (ctor 0x00647a84)
    0x00647E23: {"rows": "sphere13", "count": 1},  # type 0x4c (ctor 0x00647d5c)
    0x00648117: {"rows": "sphere22_5", "count": 1},  # type 0x4d (ctor 0x00648050)
    0x006486CF: {"rows": "sphere23", "count": 1},  # type 0x50 (ctor 0x00648608)
    0x006489EC: {"rows": "sphere3", "count": 1},  # type 0x51 (ctor 0x00648928)
    # The loop-free object children of the ctor 0x007ae360 (sites 0x007ae641, 0x007ae80f) and 0x007aea10 (0x007aeceb,
    # 0x007aeeb9): each child's record at +0xac, one row, count 1 (types 0x1b and 0x141).
    0x007AE641: {"rows": "child19", "count": 1},
    0x007AE80F: {"rows": "child19", "count": 1},
    0x007AECEB: {"rows": "child19", "count": 1},
    0x007AEEB9: {"rows": "child19", "count": 1},
    0x006EBEF1: {"rows": "child10_sphere_40107", "count": 1},
    0x007ACD78: {"rows": "child5_box_40007", "count": 1},
}

# Init sites whose box is written by the constructor at run time from the object's own fields or from its
# set record, not a constant row (DEVLOG 2026-10-25, collision sites). Not decoded into a table: each entry is
# the constructed row as formula text, kept in CONSTRUCTED_BOXES. Grammar (exe addresses are the constructor's own
# arguments and fields): `arg1` = the constructor's first argument (kept at this+0x1c), `arg2` = its second argument
# (the set record), `this` = the constructed object, `.f32+0xNN` = a float at that offset, `.word+0xNN` / `.dword+0xNN`
# = an integer. `table` names the block the init reads: `this+0xNN` (in the object), `stack` (a row on the caller's
# stack, copied from the template 0x00935a94 with its radius and halfX replaced), or `heap` (a fresh 0x2c block
# from operator new at this+0x33c, zeroed x/y/z by the ctor and then written by a sync function).
# `owner` is the object the init boxes: `child` (a 0xac object the ctor allocates) or `self`.
FLAGS_W_D = ".word+0x1c of arg1 >= 4 || .dword+0x8fc of arg1 != 0 ? 0x40007 : 0x40107"
ROW_SPHERE10_W_D = {"offset": ["0", "0", "0"], "radius": "10", "halfX": "1", "shape": "0", "flags": FLAGS_W_D}
ROW_BOX5_Z10_W_D = {"offset": ["0", "0", "-10"], "radius": "5", "halfX": "1", "shape": "1", "flags": FLAGS_W_D}
ROW_STACK_TEMPLATE = {"offset": ["0", "0", "0"], "radius": ".f32+0x0c of arg3", "halfX": ".f32+0x10 of arg3",
                      "shape": "1", "flags": "0x10003"}
# The door ctor 0x6460d8 (types 0x46..0x49): its third argument is a per-type template block, pushed as a constant
# by each caller (checked below). The stack row is the template 0x00935a94 with radius / halfX from the block.
DOOR_CTOR = 0x006460D8
DOOR_TEMPLATE_VA = 0x00935A94
DOOR_CALLERS = {  # call site: (object type, block VA)
    0x00646091: (0x0046, 0x00935AC4),
    0x00646309: (0x0047, 0x00935A78),
    0x00646581: (0x0048, 0x009C7114),
    0x006467A5: (0x0049, 0x00935A54),
}
ROW_RECORD_SIGN = {"offset": ["0", "0", "0"], "radius": ".f32+0x24 of arg2", "halfX": ".f32+0x28 of arg2",
                   "shape": ".f32+0x2c of arg2 < 0 ? 1 : 0",
                   "flags": "0x10001 | (abs(.f32+0x2c of arg2) >= 1000 ? 0x100 : 0)"}
ROW_HEAP_SYNC = {"offset": ["0", "0", "0"],
                 "radius": ".dword+0x8c of this == 0 ? .f32+0x70 of this : .f32+0x6c of this",
                 "halfX": ".dword+0x8c of this == 0 ? .f32+0x68 of this : .f32+0x6c of this",
                 "shape": "1", "flags": "0x18002"}
CONSTRUCTED_SITES = {
    # The sphere in an object's row at this+0xbc (ctor 0x6de5f0 at 0x006de7d0; ctor 0x6de7fc at 0x006de9d7): the
    # child (0xac, parent+0xe8) is inited with it. Flags 0x40007 when the first argument's word +0x1c is >= 4 or its
    # dword +0x8fc is set (0x006de943..0x006de96e), else 0x40107.
    0x006DE7D0: {"func": 0x006DE5F0, "owner": "child", "table": "this+0xbc", "count": 1, "row": ROW_SPHERE10_W_D},
    0x006DE9D7: {"func": 0x006DE7FC, "owner": "child", "table": "this+0xbc", "count": 1, "row": ROW_SPHERE10_W_D},
    # Type 0xd7 (the dynamic listing reaches 0x006f010b from set type 215). Row at this+0xfc, child at this+0x128
    # (ctor 0x6efe50, site 0x006f010b; ctor 0x6f0138, site 0x006f0435, the same row).
    0x006F010B: {"func": 0x006EFE50, "owner": "child", "table": "this+0xfc", "count": 1, "row": ROW_BOX5_Z10_W_D},
    0x006F0435: {"func": 0x006F0138, "owner": "child", "table": "this+0xfc", "count": 1, "row": ROW_BOX5_Z10_W_D},
    # The stack row of ctor 0x6460d8 (types 0x46..0x49, DOOR_CALLERS): radius and halfX from the per-type template
    # block stored at this+0xb8 (= the ctor's third argument, a constant pushed by each caller; NOT the set record).
    0x006461CF: {"func": 0x006460D8, "owner": "self", "table": "stack", "count": 1, "row": ROW_STACK_TEMPLATE},
    # Type 9 (ctor 0x77c070, factory 0x77c000): the row at this+0xac, from the set record arg2 (the same record fields as
    # the object's +0x38..+0x70 copies). Shape 1 when arg2 +0x2c is negative; flag 0x100 when |arg2 +0x2c| >= 1000.
    0x0077C197: {"func": 0x0077C070, "owner": "self", "table": "this+0xac", "count": 1, "row": ROW_RECORD_SIGN},
    # The heap blocks of 0x38a (ctor 0x619680), 0x388 (ctor 0x635d98), 0x389 (ctor 0x638188): the block at this+0x33c is
    # zeroed in x/y/z, then the sync (this+0x8c == 0: 0x619a84 / 0x63613c / 0x638530; else 0x619a18 / 0x6360d4 / 0x6384d8)
    # writes radius, halfX, shape 1 and flags 0x18002. ASSUMED: the live box is this block (the init copies it first).
    0x00619759: {"func": 0x00619680, "owner": "self", "table": "heap", "count": 1, "row": ROW_HEAP_SYNC},
    0x00635E71: {"func": 0x00635D98, "owner": "self", "table": "heap", "count": 1, "row": ROW_HEAP_SYNC},
    0x00638261: {"func": 0x00638188, "owner": "self", "table": "heap", "count": 1, "row": ROW_HEAP_SYNC},
}


def row_is_set(r):
    """A plausible box row: finite, bounded numbers, shape 0 or 1, and a flag or a radius set."""
    nums = [*r["offset"], r["radius"], r["halfX"]]
    if any(v != v or abs(v) > 1e4 for v in nums):  # NaN or far outside the room
        return False
    return r["shape"] in (0, 1) and bool(r["flags"] or r["radius"])


def table_key(s):
    if s["table"] is not None:
        return s["table"]
    idx = s["indexed"]
    return ("indexed", idx["base"], idx["stride"], idx["index"])


def variants_text(v):
    if not v:
        return "null"
    return "{ " + ", ".join(f"{k}: 0x{t:08x}" for k, t in sorted(v.items())) + " }"


def index_mask(idx):
    """The mask the index is ANDed with (2^k - 1), or None."""
    if idx.get("index") is None:  # a SITE_OVERRIDES variant set has no decoded index
        return None
    return idx["index"][2] if idx["index"][0] == "and" else None


def index_text(idx):
    if idx is None or idx.get("index") is None:
        return "null"
    leaf = idx["index"]
    if leaf[0] == "and":  # ("and", ("arg", k), mask): a masked stack argument (Vol Opt monitors, 0x0044161c)
        arg, disp, width, signed, rec = leaf[1][1], 0, 4, False, "null"
        mask = str(leaf[2])
    else:  # ("M", ((("arg", k), 1),), disp, width, signed)
        arg = leaf[1][0][0][1]
        disp, width, signed = leaf[2], leaf[3], leaf[4]
        rec = f"{disp + 4:#x}" if arg == 2 else "null"
        mask = "null"
    return ("{ arg: %d, disp: 0x%x, width: %d, signed: %s, mask: %s, base: 0x%08x, stride: %d, recordOffset: %s }" % (
        arg, disp, width, "true" if signed else "false", mask, idx["base"], idx["stride"], rec))


def call_pushes(site, n):
    """The operands of the last n pushes before a call (AT&T, nearest first), or None."""
    rows = insns_before(site, span=0x120)
    pushes = []
    for _, mnem, ops in reversed(rows):
        if mnem.startswith("push"):
            pushes.append(ops)
            if len(pushes) == n:
                return pushes
        elif mnem.startswith(("call", "jmp", "ret")) or "%esp" in ops:
            break
    return None


# Helpers whose (table, count) are not the last two pushes: the value is the (table, count) pair's
# index in call_pushes order (nearest push first). 0x0051ff3c takes the table last (the default,
# stack_args). 0x00521c5c takes four stack arguments (ret 0x10): arg3 (its table) is the third push
# before the call and arg4 (its count) the fourth (the callers push `$count; $table; reg; reg`), read
# from objdump at 0x00426a38 / 0x004cf72c / 0x005398eb / 0x0053cf1e / 0x0054dabe / 0x0054db15 /
# 0x005a9e95 / 0x005a9eec.
WRAPPER_PUSH_INDEX = {0x00521C5C: (2, 3)}


def wrapper_args(c, w):
    if w not in WRAPPER_PUSH_INDEX:
        return stack_args(c)
    ti, ci = WRAPPER_PUSH_INDEX[w]
    pushes = call_pushes(c, max(ti, ci) + 1)
    if pushes is None or not pushes[ti].startswith("$") or not pushes[ci].startswith("$"):
        return None
    return int(pushes[ti][1:], 16), int(pushes[ci][1:], 16)


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
            args = wrapper_args(c, w)
            if args is None:
                continue
            out.append({"site": c, "func": func_of(c), "table": args[0], "count": args[1], "via": w})
    return out


def override_site(s, f, ov):
    """A site entry from SITE_OVERRIDES (see there): a static table, a runtime-indexed set, or inline rows."""
    if "rows" in ov:
        return {"site": s, "func": f, "table": s, "count": ov["count"], "via": None, "inline": [INLINE_ROWS[ov["rows"]]]}
    if "table" in ov:
        return {"site": s, "func": f, "table": ov["table"], "count": ov["count"], "via": None}
    idx = {"variants": dict(ov["variants"]), "index": None, "base": 0, "stride": 0, "override": True}
    return {"site": s, "func": f, "table": None, "count": ov["count"], "via": None, "indexed": idx}


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
    # Global function pointers (`mov abs, %reg; call *%reg`): the pointer's target is a function start.
    gp_calls = global_ptr_calls(blob, func_of)
    slot_targets |= {t for _, t, _ in gp_calls}
    starts_va = sorted(set(starts_va) | slot_targets)
    # Function starts read from the disassembly (checked by main): Plot Falz's constructor (after an
    # `xor; jmp` epilogue, DEVLOG), the SEH epilogue cases 0x662ef0 (after `jmp; nop`), the Dragon's
    # constructor 0x419214 (the link's func) and the 0x64 factory's constructor 0x5959fc.
    for must in (0x0048D814, 0x00662EF0, 0x00419214, 0x005959FC, 0x004570B0):
        if must not in set(starts_va):
            raise SystemExit(f"function start {must:#x} not detected")

    callees = collections.defaultdict(set)
    for site, target in calls:
        f = func_of(site)
        if f is not None and TEXT_LO <= target < TEXT_HI:
            callees[f].add(func_of(target) or target)
    for site, target, _ in vt_calls:
        f = func_of(site)
        if f is not None:
            callees[f].add(func_of(target) or target)
    for site, target, _ in gp_calls:
        f = func_of(site)
        if f is not None:
            callees[f].add(func_of(target) or target)

    init_sites = sorted({s for s, t in calls if t == INIT})

    info = {"text": (TEXT_LO, TEXT_HI)}
    sites = []  # direct: the init call has constant arguments
    dynamic = []
    constructed = []  # run-time rows of the constructor (CONSTRUCTED_SITES): formula text, no table
    for s in CONSTRUCTED_SITES:
        if s not in init_sites or func_of(s) != CONSTRUCTED_SITES[s]["func"]:
            raise SystemExit(f"CONSTRUCTED_SITES: {s:#x} is not an init call in {CONSTRUCTED_SITES[s]['func']:#x}")
    for s in init_sites:
        f = func_of(s)
        if s in CONSTRUCTED_SITES:
            constructed.append({"site": s, **CONSTRUCTED_SITES[s]})
            continue
        if s in SITE_OVERRIDES:  # resolved by hand (SITE_OVERRIDES); not a dynamic site any more
            sites.append(override_site(s, f, SITE_OVERRIDES[s]))
            continue
        args = stack_args(s)
        if args is None:
            idx = indexed_site(s, f, info, text_fn) if f is not None else None
            if idx is not None:  # table = base + stride * [field]: one row set per variant
                sites.append({"site": s, "func": f, "table": None, "count": idx["count"], "via": None, "indexed": idx})
            else:
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
        if "inline" in s:  # the rows are the caller's stack stores (no exe table): keyed by the site VA
            tables[s["table"]] = s["inline"]
            continue
        if s["table"] is None:
            idx = s["indexed"]
            if idx.get("override"):  # SITE_OVERRIDES variants: each table is read and must hold a box
                for v, t in sorted(idx["variants"].items()):
                    rows = box_rows(t, s["count"])
                    if not any(row_is_set(r) for r in rows):
                        raise SystemExit(f"SITE_OVERRIDES {s['site']:#x}: table {t:#x} (variant {v}) holds no box")
                    tables[t] = rows
                continue
            # Indexed: the variants are the rows base + stride * v, v = 0 up to the first row that holds
            # no box (ASSUMED: an index past the array's boxes reads no box).
            idx["variants"] = {}
            # A masked index (`and $m`) has m + 1 variants at most (the mask is read from the exe).
            limit = min(MAX_VARIANTS, index_mask(idx) + 1) if index_mask(idx) is not None else MAX_VARIANTS
            for v in range(limit):
                t = idx["base"] + idx["stride"] * v
                if offset(t) is None or offset(t + ROW * s["count"] - 4) is None:
                    break
                rows = box_rows(t, s["count"])
                if not any(row_is_set(r) for r in rows):
                    break
                idx["variants"][v] = t
                tables[t] = rows
            continue
        if s["table"] not in tables:
            tables[s["table"]] = box_rows(s["table"], s["count"])

    site_by_func = collections.defaultdict(list)
    for s in sites:
        site_by_func[s["func"]].append(s)

    # Loop-built children (CHILD_CALLERS): checked against the exe, then child k -> variant k & mask.
    child_links = {}
    for callee, spec in CHILD_CALLERS.items():
        if (spec["site"], callee) not in calls:
            raise SystemExit(f"CHILD_CALLERS: {spec['site']:#x} does not call {callee:#x}")
        bound = " ".join(t[2] for t in text_fn(spec["bound"], spec["bound"] + 3))
        if f"$0x{spec['count']:x}" not in bound:
            raise SystemExit(f"CHILD_CALLERS: {spec['bound']:#x} is not `cmp ${spec['count']:#x}`: {bound}")
        cs = [s for s in site_by_func.get(callee, [])
              if s["table"] is None and s["indexed"]["index"][0] == "and" and s["indexed"]["index"][1][1] == spec["arg"]]
        if len(cs) != 1:
            raise SystemExit(f"CHILD_CALLERS: {callee:#x} has no single masked index on argument {spec['arg']}")
        idx = cs[0]["indexed"]
        child_links[spec["set"]] = {"callee": callee, "count": spec["count"], "mask": index_mask(idx),
                                    "variants": idx["variants"]}

    # Loop-built children with one constant table (CHILD_CONST_CALLERS): the loop's call, the
    # factory's call of the constructor, and the constructor's own init with that table (one row).
    for callee, spec in CHILD_CONST_CALLERS.items():
        if (spec["site"], spec["factory"]) not in calls or (spec["factory_site"], callee) not in calls:
            raise SystemExit(f"CHILD_CONST_CALLERS: {spec['site']:#x} / {spec['factory_site']:#x} do not chain to {callee:#x}")
        inits = [s for s in site_by_func.get(callee, []) if s["site"] == spec["init_site"]]
        if len(inits) != 1 or inits[0]["table"] != spec["table"] or inits[0]["count"] != 1:
            raise SystemExit(f"CHILD_CONST_CALLERS: {spec['init_site']:#x} is not the constant table {spec['table']:#x}")
        child_links[spec["set"]] = {"callee": callee, "count": spec["count"], "mask": 0,
                                    "variants": {0: spec["table"]}}

    for child_site in CHILD_OBJECT_SITES:
        if child_site not in {s["site"] for s in sites}:
            raise SystemExit(f"CHILD_OBJECT_SITES: {child_site:#x} is not a decoded init site")

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
                if s["site"] not in CHILD_OBJECT_SITES:  # a child's box, not the enemy's own
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
            link.update({"table": None, "func": None, "depth": None, "via": None, "ambiguous": False,
                         "indexed": None, "variants": None})
        else:
            dmin = min(d for d, _ in pool)
            best = [s for d, s in pool if d == dmin]
            best_tables = sorted({table_key(s) for s in best}, key=repr)
            pick = max((s for s in best), key=lambda s: s["site"])  # the last call in the constructor
            idx = pick.get("indexed")
            link.update({"table": pick["table"], "func": pick["func"], "depth": dmin, "via": pick["via"],
                         "ambiguous": len(best_tables) > 1, "indexed": idx,
                         "variants": idx["variants"] if idx else None})
        links[t].append(link)

    if "--dynamic" in argv:
        reach_by_func = collections.defaultdict(set)
        for (t, fac), depth_of in trees.items():
            for g in depth_of:
                reach_by_func[g].add(t)
        for s_va, f in dynamic:
            print(f"site {s_va:#010x} func {f:#010x} set types {sorted(reach_by_func.get(f, ()))}")
        return 0
    if summary_only:
        def has_box(l):
            return l["table"] is not None or bool(l["variants"])
        own_types = {t for t in links if any(has_box(l) and not l["shared"] for l in links[t])}
        any_types = {t for t in links if any(has_box(l) for l in links[t])}
        indexed = sum(1 for s in sites if s["table"] is None)
        print(f"constructed {len(constructed)} "
              f"sites {len(init_sites)} direct {len(sites) - len(wrappers) - indexed} indexed {indexed} "
              f"wrappers {len(wrappers)} unresolved {unresolved}")
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
    lines.append(f"// {len(constructed)} more are built by their constructor at run time (CONSTRUCTED_BOXES: the row as formula text).")
    lines.append("// Indexed sites (table = base + stride * [field], e.g. Booma 0x44) have one row set per variant.")
    lines.append("")
    lines.append("export interface CollisionBoxRow {")
    lines.append("  offset: readonly [number, number, number];")
    lines.append("  radius: number;")
    lines.append("  halfX: number;")
    lines.append("  shape: number;")
    lines.append("  flags: number;")
    lines.append("}")
    lines.append("")
    lines.append("export interface CollisionIndex {")
    lines.append("  base: number; // the array's exe address (variant 0)")
    lines.append("  stride: number; // bytes per variant row")
    lines.append("  arg: number; // the constructor's stack argument the index is read from (1-based)")
    lines.append("  disp: number; // the field's offset in that argument")
    lines.append("  width: number; // 1, 2 or 4 bytes")
    lines.append("  signed: boolean;")
    lines.append("  mask: number | null; // the index is ANDed with this (2^k - 1) first; null when not masked")
    lines.append("  recordOffset: number | null; // the offset in the set record (factory argument = record + 4; arg 2 only)")
    lines.append("}")
    lines.append("")
    lines.append("export interface CollisionBoxSite {")
    lines.append("  site: number;")
    lines.append("  func: number;")
    lines.append("  table: number | null; // null for an indexed site")
    lines.append("  via: number | null;")
    lines.append("  variants: Readonly<Record<number, number>> | null; // indexed sites: index value -> table VA")
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
    lines.append("  table: number | null; // null for an indexed link (see index and variants)")
    lines.append("  func: number | null;")
    lines.append("  depth: number | null;")
    lines.append("  via: number | null;")
    lines.append("  shared: boolean;")
    lines.append("  ambiguous: boolean;")
    lines.append("  index: CollisionIndex | null;")
    lines.append("  variants: Readonly<Record<number, number>> | null; // set record variant -> table VA")
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
        table = "null" if s["table"] is None else f"0x{s['table']:08x}"
        variants = variants_text(s["indexed"]["variants"]) if s["table"] is None else "null"
        lines.append(f"  {{ site: 0x{s['site']:08x}, func: 0x{s['func']:08x}, table: {table}, via: {via}, variants: {variants} }},")
    lines.append("];")
    lines.append("")
    # Door boxes (DOOR_CALLERS): each caller must call the door ctor with its block pushed as a constant (checked
    # against the bytes before the call); the row is the stack template (offset, shape, flags) plus the block's radius / halfX.
    call_set = set(calls)
    for site, (t, block) in DOOR_CALLERS.items():
        o = offset(site)
        if (site, DOOR_CTOR) not in call_set or o is None or b"\x68" + struct.pack("<I", block) not in DATA[o - 16 : o]:
            raise SystemExit(f"DOOR_CALLERS: {site:#x} does not push block {block:#x} before the call to {DOOR_CTOR:#x}")
    st = DOOR_TEMPLATE_VA
    if u32(st + 0x14) != 1 or u32(st + 0x18) != 0x10003 or f32(st) != 0.0 or f32(st + 4) != 0.0 or f32(st + 8) != 0.0:
        raise SystemExit("DOOR_TEMPLATE_VA: the stack template is not offset 0, shape 1, flags 0x10003")
    lines.append("// Door boxes by object type (DOOR_CALLERS in the generator, DEVLOG 2026-10-25): the constructor 0x006460d8 copies the")
    lines.append("// stack template 0x00935a94 (offset, shape, flags) and takes radius / halfX from the per-type block its caller pushes")
    lines.append("// (block +0x0c radius, +0x10 halfX). `block` is the exe address of that block.")
    lines.append("export const DOOR_BOXES: Readonly<Record<number, CollisionBoxRow & { block: number }>> = {")
    for site, (t, block) in sorted(DOOR_CALLERS.items(), key=lambda kv: kv[1][0]):
        lines.append(f"  0x{t:04x}: {{ block: 0x{block:08x}, offset: [0, 0, 0], radius: {fmt_num(f32(block + 0x0C))}, "
                     f"halfX: {fmt_num(f32(block + 0x10))}, shape: 1, flags: 0x10003 }},")
    lines.append("};")
    lines.append("")
    # The factory types each constructor is reached from: the type table's creators (the {type, creator,
    # 0x48742400, 0} rows) and their depth-limited call trees; reach[func][type] = calls from the creator.
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
    lines.append("// Init sites whose box the constructor writes at run time (CONSTRUCTED_SITES in the generator, DEVLOG")
    lines.append("// 2026-10-25 collision sites). Formula text: arg1 = the constructor's first argument (this+0x1c),")
    lines.append("// arg2 = its second (the set record), this = the object; `.f32+0xNN of X` a float, `.word` / `.dword` integers.")
    lines.append("// ASSUMED where the reader is not traced: the heap rows' fields (this+0x68 / +0x6c / +0x70 / +0x8c) come from the set record.")
    lines.append("export interface ConstructedBox {")
    lines.append("  site: number;")
    lines.append("  func: number; // the constructor")
    lines.append("  owner: 'child' | 'self'; // the object the init boxes (a child: the 0xac object the constructor allocates)")
    lines.append("  table: string; // where the init reads the row: 'this+0xNN', 'stack' or 'heap'")
    lines.append("  count: number;")
    lines.append("  types: readonly { type: number; depth: number }[]; // object factory types whose creator reaches the constructor (depth in calls)")
    lines.append("  enemies: readonly { type: number; depth: number }[]; // enemy set types whose factory tree reaches it (depth in calls)")
    lines.append("  row: { offset: readonly [string, string, string]; radius: string; halfX: string; shape: string; flags: string };")
    lines.append("}")
    lines.append("")
    lines.append("export const CONSTRUCTED_BOXES: readonly ConstructedBox[] = [")
    for c in constructed:
        r = c["row"]
        off = ", ".join(json.dumps(v) for v in r["offset"])
        types = ", ".join(f"{{ type: 0x{t:04x}, depth: {d} }}" for t, d in sorted(reach.get(c["func"], {}).items(), key=lambda x: (x[1], x[0])))
        # Enemy set types whose factory call tree reaches the constructor (the enemy trees above, depth DEPTH_LIMIT).
        enemy = collections.defaultdict(lambda: DEPTH_LIMIT + 1)
        for (t, fac), depth_of in trees.items():
            if c["func"] in depth_of:
                enemy[t] = min(enemy[t], depth_of[c["func"]])
        enemies = ", ".join(f"{{ type: 0x{t:04x}, depth: {d} }}" for t, d in sorted(enemy.items(), key=lambda x: (x[1], x[0])))
        lines.append(f"  {{ site: 0x{c['site']:08x}, func: 0x{c['func']:08x}, owner: '{c['owner']}', table: {json.dumps(c['table'])}, "
                     f"count: {c['count']}, types: [{types}], enemies: [{enemies}], row: {{ offset: [{off}], radius: {json.dumps(r['radius'])}, "
                     f"halfX: {json.dumps(r['halfX'])}, shape: {json.dumps(r['shape'])}, flags: {json.dumps(r['flags'])} }} }},")
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
                f"via: {via}, shared: {'true' if l['shared'] else 'false'}, ambiguous: {'true' if l['ambiguous'] else 'false'}, "
                f"index: {index_text(l['indexed'])}, variants: {variants_text(l['variants'])} }}")
        lines.append(f"  0x{t:04x}: [{', '.join(parts)}],")
    lines.append("};")
    lines.append("")
    lines.append("// Set type -> children built in a caller's loop (CHILD_CALLERS, hand-read and checked): child k")
    lines.append("// (0-based, creation order) takes the box table of variant k & mask.")
    lines.append("export interface CollisionChildLink {")
    lines.append("  callee: number; // the child's constructor")
    lines.append("  count: number; // children built by the loop")
    lines.append("  mask: number; // the constructor's `and` on the loop counter (0: one constant table, variant 0)")
    lines.append("  variants: Readonly<Record<number, number>>; // variant -> table VA")
    lines.append("}")
    lines.append("")
    lines.append("export const CHILD_COLLISION_LINKS: Readonly<Record<number, CollisionChildLink>> = {")
    for t in sorted(child_links):
        c = child_links[t]
        lines.append(f"  0x{t:04x}: {{ callee: 0x{c['callee']:08x}, count: {c['count']}, mask: {c['mask']}, "
                     f"variants: {variants_text(c['variants'])} }},")
    lines.append("};")
    lines.append("")
    # Factory type id (the type table's {type, creator} rows, objects included) -> the box tables
    # its creator reaches: the depth-limited tree of the creator, the shallowest site (kept for
    # the object pillars; the enemies use ENEMY_COLLISION_LINKS, which resolves each one's own).
    by_type = collections.defaultdict(list)
    for s in sites:
        tabs = list(s["indexed"]["variants"].values()) if s["table"] is None else [s["table"]]
        for t, d in sorted(reach.get(s["func"], {}).items()):
            for tab in tabs:
                by_type[t].append((tab, d))
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
