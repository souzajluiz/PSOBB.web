# Gal Gryphon (Ep2 boss, TBoss5Gryphon): states 18..34 (exe map, part B)

Scope: state handlers 18..34 of the ProcessState table at `0x009a7e40`, the frame update
`0x004a70e0`, the constructor `0x004a67c0`, and the helpers they call. States 0..17 are in
`galgryphon-states-a.md` (not written here). No code change; this is a reading of PsoBB.exe.

Legend: **PROVEN** = read directly from the Ghidra decompile, the exe bytes or newserv source.
**ASSUMED** = inferred from naming, a constant, or a pattern; not checked against runtime.
**UNCLEAR** = not decoded.

Sources: Ghidra headless (`tools/ghidra/decomp.sh`, PsoBB.exe), `tools/exedata.py read` for
rodata, `data.gsl` -> `bm_boss5_gryphon.bml` parsed with a small PRS/BML/NMDM reader (frame
counts only), `vendor/newserv/src/ReceiveSubcommands.cc` (6x76).

## 1. Dispatch and conventions (PROVEN unless noted)

- ProcessState `0x004a85f0(state, phase)`: `table[state].fn(phase)`, guarded by a null check
  against `0x00903bcc` / `0x00903bd0`. Table entry = 8 bytes `{fn, adj}`; index = state number.
  Entry 4 is `PTR_FUN_009a7e60` (the ctor calls it directly).
- Phases: `4` = enter, `5` = leave, `0` = per-frame, `8` / `9` = extra per-frame hooks
  (called from the frame update and from `0x004a7360`), `2` / `9` / `8` are skipped by most
  handlers in the `if (phase != 2 && phase != 9 && phase != 8)` guard.
- The state number is a short at `this+0x32e` (`*(short*)((int)this+0x32e)`).
- The motion (anim) index is a short at `this+0xb8`. Enter writes it; the motion player reads it.
  In the handlers Ghidra prints this as `*(short*)(param_1+0x2e)` (`param_1` is `int*`, so
  `+0x2e` ints = byte `+0xb8`).
- Frame counter / step fields of the motion player live in the boss object too:
  `+0xb0` flags, `+0xb4` current record flags, `+0xb8` cur anim, `+0xba` prev anim,
  `+0xc0` current time (frames), `+0xc4` anim length (frames), `+0xc8` step per tick (float),
  `+0xd8` motion table pointer (`0x009a7c80`), `+0xdc` motion data pointer, `+0xf4` mode.
- Position: `+0x38` x, `+0x3c` y (height), `+0x40` z. Heading: `+0x60` (BAMS, 65536 = 360 deg).
  Velocity: `+0x47c` x, `+0x480` y, `+0x484` z, heading vel `+0x488`. Pending displacement
  `+0x48c/+0x490/+0x494`. Positions copied into `+0x3c8..`, `+0x300..`, `+0x74..`.
- Per-state counters: `+0x1b9` busy / sub-phase, `+0x1ba` counter, `+0x1bb`, `+0x1bc`, `+0x1bf`
  (per-state slope), `+0x1c0`.
- Leader flag `+0x13a` (set in ctor from `FUN_00694cc8` / `FUN_00520db0`). `+0x13b` is a
  movement mode written by the states (values 0, 1, 3 seen). `+0x132` = bit flags (bit0 =
  removed/gone, set from the area table in the ctor; bit2 `0x4` set in several enters; `0x30`,
  `0xc4`, `0x104` masks used). `+0x4ec` = stage / phase index (0, 1, 2, 3 seen).
- Script record pointer `+0x4c4` (records of 0x14 bytes: short state @0, short duration @2),
  buffer starts at `+0x4b0`. Action-script stream pointer `+0x77c`, pattern struct `+0x780`.

### 1.1 Frame update 0x004a70e0 (PROVEN)

1. `FUN_004f7c84()` != 0 (cutscene / menu state) -> `vtbl+0x1ac()` and return.
2. `+0x132 & 1` (gone) -> `FUN_008113e4(this)` (sends the 6x76 kill event if `+0x80` != 0),
   then `*(u16*)(this+8) |= 1` (delete flag), return.
3. `FUN_00694cc8() != 0` -> leader refresh: `+0x13a = (FUN_00520db0() == 0) ? 1 : 0`.
4. `iVar1 = FUN_00520db8()`. Then `vtbl+0xac()`, `vtbl+0xb0()`.
5. If `iVar1 == 0`: `+0xc` bit `0x800` follows `+0x132 & 0x40`. Then:
   - if `+0x13a == 1`: if `vtbl+0x88() != 0` -> `FUN_0051f81c` (reset); then `ProcessState(state, 0)`.
   - else: same `vtbl+0x88()` / `FUN_0051f81c` test, then `FUN_004a7360()` (attack decision),
     `FUN_004a7b58()` (action-script executor), `ProcessState(state, 8)`, `ProcessState(state, 0)`.
   - `FUN_0051f81c` / `FUN_00817574` run only on the paths shown (`FUN_00817574` when
     `FUN_00520db8() == 0`).
   - Note: the DEVLOG said "leader -> phase 0; else phase 8 then 0", which matches. Which side
     (authority or remote) `+0x13a == 1` means is UNCLEAR.
6. `FUN_0051f604` (copy state to `+0x37c`), `FUN_004a7c44` (integrate pos/heading),
   `FUN_004a7dac` (apply pending displacement), `FUN_004a7de8` (script duration countdown),
   `vtbl+0x168()` (per-frame hook `0x004a0990`), `FUN_004a7e44` (copy pos snapshot),
   `FUN_006401f0`, `FUN_0080575c(this+0x38, 0xffffa24c, 0x40000000, 1, 1)` (UNCLEAR, a
   position-sync call), copy `+0xc0..+0xc2` to `+0x15d..+0x15f`, `FUN_00817574` if leader,
   `FUN_00520dc0(this+0x38, this+0x15a, 0x3ecccccd)` (0.4: a smoothing lerp, ASSUMED),
   4 x `FUN_005771a4` (sub-object update), and if `+0x13b != 0` -> `FUN_004a7e74`.

### 1.2 Constructor 0x004a67c0 (PROVEN unless noted)

- Calls base ctor `0x005216f4(param_2)`, sets vtable `*this = 0x00af9d40`, `FUN_008193cc(0)`.
- `_eh_vector_constructor_iterator_(this+0x588, 0x1c, 4, ...)`: 28 sub-objects (`+0x588`).
- `FUN_00763030()`; `this+4 = PTR_DAT_009a80c4`; if the global head `DAT_00a47660` is null, it
  becomes `this`. `FUN_0051f750(param_3)`.
- `+0x132 = 1` if area table entry `(short)+0x2c` (`area*0xc + DAT_00ab02b8`) has bits
  `0x12008` all set. This is the "gone" flag.
- `FUN_00521840()` (position backup), session (`DAT_00a47634`) fields: `+0x34 = session+0x42c+8`,
  `+0x24 = session+0x42c+0xc` (ASSUMED: room/area refs), `FUN_0051ff3c(&DAT_009a7ac0, 10)`.
- Motion: `+0xd8 = 0x009a7c80` (motion table), `+0xdc = session+0x430`, `+0x2c = 0`,
  `+0xb8 = 0` (anim 0), `FUN_007aa4c8(0)`.
- Model / skeleton: `+0x358 = &DAT_009a80c8`, `FUN_00520390(0x4d)`, `+0x384 = 0x41a00000`
  (= 20.0, ASSUMED radius), `FUN_005213ec(&DAT_00903f9c)` (0.0 vector), `FUN_00521820(10)`,
  `FUN_005217fc(10)`.
- Zeroes: `+0x47c..+0x494` velocity block, `+0x11f..+0x125`, `+0x1cf..+0x1df`.
- Copies position `(+0x38,+0x3c,+0x40)` into `+0x3c8..`, `+0x44c..`, `+0x2a..`, `+0x13c..+0x159`,
  `+0x15a..+0x15f` (ASSUMED: snapshot/ home position, also `+0x20`, `+0x24`, `+0x28` in
  `FUN_00521840`).
- `*(float*)(+0x2b4 + 0x10) = 10.0` (`0x41200000`, ASSUMED: enemy-data scale).
- `+0x580` = `operator new(0x10)` + `FUN_00521a4c(4)` (action list), `+0x584`
  (`FUN_005caba4(0x20)` -> `FUN_004a8f5c(this+0x4cc)`: builds an 0xb8-byte action-script object
  with vtable `0x00af9fb8` and a 0x2c-stride list of 0x1c items).
- `+0x17e = &DAT_00903bd4`. Zeroes `+0x1b9..+0x1c9`, `+0x1bf`, `+0x1ca..+0x1cd`.
- `+0x32e = 0` then `+0x13a` leader set, then `+0x32e = 4` and `PTR_FUN_009a7e60(4)`
  (= state 4 enter). So the fight starts in state 4 (DEVLOG agrees).
- **HP source:** not set in the ctor. Current HP = short `+0x334`, max HP = short `+0x2bc`
  (`0x2bc` = 700 decimal; used as `cur / max` in `0x004a7390` and `0x004a771c`). Copied to
  `+0x346` by `0x0051f81c` on reset. Where `+0x334` / `+0x2bc` are loaded: UNCLEAR (not in the
  ctor; probably the enemy-set loader).

### 1.3 Motion player (PROVEN, from decompile; names ours)

- `0x007aa094` (ECX = boss): tick. If `+0xb0 & 0x40` return. `+0xc0 += +0xc8`. Mode `+0xf4`:
  1 = loop (wrap `+0xc0 -= +0xc4` at the end), 2 = at end (`+0xc4 - 1 <= +0xc0`): if the record
  chain (u16 @+2 of the record) is set, switch to that anim and `+0xb0 |= 0x800`; else loop.
  3 = one-shot: at end `+0xc0 -= +0xc8`, `+0xc8 = 0.0` (`0x0097d978`), `+0xb0 |= 0x30`, mode -> 5.
  4 = end of a blend: `+0xc8` reloaded from the record (u32 @8), `+0xb0 &= ~4`, `|= 8`.
  5 = hold (`+0xc0 -= +0xc8`).
  Consequence (ASSUMED but consistent): the handlers' test `(float)param_1[0x32] <= 0.0` is
  the test `+0xc8 <= 0`, i.e. "one-shot motion finished". Ghidra prints it as an int cast; the
  intent is the float step.
- `0x007aaa30(ECX, t)`: true if this tick crosses frame `t`:
  `t < +0xc0 <= t + +0xc8`, and `(+0xb0 & 4) == 0 or (+0xb0 & 1)`, and no pending anim change
  (`0x007a9970`: `+0xb8 != +0xba`). Used as the **frame event** test everywhere below.
- `0x007aabd8(ECX)`: current time `+0xc0` (frames), or `0.0` if `+0xb0 & 4`.
- `0x007a9a6c(ECX, anim)`: start anim. Reads record `anim` of the table at `+0xd8`:
  u16 @0 mode -> `+0xf4`; u16 @2 chain; u32 @8 float step -> `+0xc8`; u32 @12 flags -> `+0xb4`.
  Frame count `+0xc4` comes from the motion file (not the record).

### 1.4 Motion table 0x009a7c80 (PROVEN bytes; names from enemymodels.ts order)

Record stride 0x10: u16 mode @0, u16 chain anim @2, float @4 (0 in all records), float step @8,
u32 flags @12. Anim index = position in the `motions` list of the gryphon entry in
`client/src/formats/enemymodels.ts` (line 218). This mapping is ASSUMED, but
`loop(9)` for stand in that file matches record 9 (stand), and the chain-record flags equal
their own index (0xa, 0xb, 0xd, 0xe, 0x10, 0x11, 0x13, 0x14, 0x15, 0x16), which supports it.

| idx | name | frames (NJM) | mode | chain | step @8 | flags @12 | used by |
|---|---|---|---|---|---|---|---|
| 0 | fly | 30 | 1 | - | 0.80 | 0 | S33 (stage 0) |
| 1 | hoe | 30 | 1 | - | 0.50 | 0 | - |
| 2 | kakuin | 30 | 3 | - | 0.43 | 0 | S31 |
| 3 | kakuland | 40 | 3 | - | 0.50 | 0 | - |
| 4 | kakuout | 30 | 1 | - | 0.77 | 0 | S33 (stage 1) |
| 5 | kaku | 20 | 3 | - | 0.48 | 0 | - |
| 6 | land | 40 | 2 | 7 | 0.70 | 6 | - |
| 7 | op | 500 | 1 | - | 0.90 | 7 | S33 (stage 2) |
| 8 | shot | 30 | 3 | - | 0.57 | 0 | - |
| 9 | stand | 30 | 3 | - | 0.70 | 0 | (ctor default loop 9 in enemymodels) |
| 10 | takeoff | 40 | 2 | 11 | 1.00 | 0xa | S20 |
| 11 | walk | 30 | 1 | - | 1.00 | 0xb | S21 |
| 12 | huseout | 14 | 3 | - | 1.00 | 0 | S22 |
| 13 | houko | 30 | 2 | 14 | 0.40 | 0xd | S23 |
| 14 | huse | 14 | 1 | - | 0.35 | 0xe | S24 |
| 15 | husein | 14 | 3 | - | 0.40 | 0 | S25 |
| 16 | dead | 150 | 2 | 17 | 0.75 | 0x10 | S26 |
| 17 | kiri | 20 | 1 | - | 0.35 | 0x11 | S27 |
| 18 | kiriland | 30 | 3 | - | 0.60 | 0 | S28 |
| 19 | kirin | 20 | 2 | 20 | 0.50 | 0x13 | S29 |
| 20 | kiriout | 20 | 1 | - | 1.00 | 0x14 | S19, S30 |
| 21 | run | 20 | 3 | - | 0.50 | 0x15 | - (not entered by 18..34) |
| 22 | runin | 10 | 3 | - | 0.00 | 0x16 | S18, S30 (phase 1 writes it) |
| 23 | runout | 35 | 3 | - | 0.35 | 0 | S32 |
| 24 | tuno | 10 | 3 | - | 0.65 | 0 | - |
| 25 | tunoin | 30 | 3 | - | 1.00 | 0x80000000 | (S4, ctor path, not in 18..34) |
| 26 | tunout | 30 | 3 | - | 0.50 | 0 | S5 (death candidate, see 4) |

Frame counts from `data.gsl` / `bm_boss5_gryphon.bml` (PROVEN, parsed; NMDM frameCount).
Note: "frames" is the NJM length; the record step and `+0xc4` decide the playback time.

### 1.5 Script advance and duration (PROVEN)

- `0x004a7e20` (ECX = boss) = **advance**: `rec = +0x4c4; +0x4c4 = rec + 0x14;`
  `new = *(short*)(rec + 0x14)`; if `new != +0x32e` -> `0x0051f62c(new)`.
- `0x0051f62c(new)` = **change state**: `ProcessState(old, 5)`, `ProcessState(new, 4)`,
  `+0x32e = new`.
- `0x004a7de8` (per frame, skipped when state == 4): decrements `*(short*)(rec+2)` of the
  current record; at 0 -> advance. So each state also ends when its scripted duration runs out.
- Consequence: most handlers in 18..34 never name the next state. The next state is the
  next record of the script (`+0x4c4` list). The list source is UNCLEAR (see section 6).

## 2. Helpers (name, address, purpose)

Names are ours; `FUN_` / `func_0x` names are the Ghidra ones.

- `0x004a7e20` advance script record (PROVEN).
- `0x0051f62c` change state (PROVEN).
- `0x004a7de8` script duration countdown (PROVEN).
- `0x004a7360` tick, called from the frame update on the non-leader path: if
  `(+0x132 & 0xc) == 0 && (short)+0x334 < 1` -> `0x004a7390`, else `ProcessState(state, 9)`
  (PROVEN structure). The gate reads short `+0x334`, which `0x004a771c` uses as the HP numerator.
  That is contradictory (a gate of "HP < 1" would start the action script only at zero HP).
  UNCLEAR; see section 6.
- `0x004a7390` start the next action script: sets `+0x77c` from pattern struct `+0x780` by stage
  `+0x4ec` (1, 2, 3, else), runs opcode via table `0x009a7f60` (stride 8: fn, adj), `+0x4c8 |= 8`.
  (PROVEN; opcode meanings UNCLEAR.)
- `0x004a771c` random branch (opcode `0x21`): uses `_rand()/32768.0` (`0x00903bbc`), HP ratio
  `+0x334/+0x2bc`, player count `DAT_00a47640+0x28`, thresholds `0x903ba4..0x903bb8`
  (0.9, 0.8, 0.4, 0.3, 0.6, 0.2) and `0x00903924` / `0x00903900` tables (PROVEN values, use
  ASSUMED).
- `0x004a8c9c` load action-script op: `op = rec[0]`, `param = rand * (rec[6]) + rec[2]` (PROVEN).
- `0x004a8e24` / `0x004aa758`: init action-script buffers (UNCLEAR).
- `0x004a7b58` per-frame action-script executor: if `+0x4c8 & 2`, run op at `+0x77c` (opcode table
  `0x009a7f60`), advance `+0x77c` by `0x48` unless op `0x22`, then `0x004a7b28` (send record:
  u16 `+0x1c`, pos, heading `+0x60`, through `0x008003e0`). (PROVEN structure.)
- `0x004a7c44` integrate: `pos += vel` (`+0x38,+0x3c,+0x40`), `heading += +0x488`; flag `0x10`
  path mode (uses `0x007828e4` / `0x005206cc` / `0x00520750`, UNCLEAR); then damping
  `0x004a4814(...)` with per-stage tables `0x00a475d8`, `0x00a475e8`, `0x00a475fc` (runtime).
- `0x004a7dac` apply pending `+0x48c/+0x494` to pos.
- `0x004a7e44` copy `+0x3c8` to `+0x300`, `+0x74`.
- `0x004a7e74` `0x004ab94c(+0x3c8, {0, 80.0, 0})` (UNCLEAR; a position reset).
- `0x004a15ac(this, speed)`: `+0x47c += cos(heading) * speed`, `+0x484 += sin(heading) * speed`
  (`cos`/`sin` = `0x0082dcbc` / `0x0082ddd8`, BAMS table lookups; PROVEN).
- `0x004a15fc`: ground probe at `(+0x38,+0x3c,+0x40)` with `0x00780630(pt, 0x16ef)`; if a hit has
  height `<= 6.0` (`0x00903ae0`): spawn effect `**(this+0x5f8)` at the hit point (`0x0050b7a4`
  flags 0x40) and SE `0x39b`. PROVEN calls; the probe mask `0x16ef` UNCLEAR.
- `0x004a1a48`: if frame event 14.0 (`0x41600000`) -> `0x004a15fc`.
- `0x004a1b84(this, rate)` / `0x004a5e10(this, maxStep, target)`: turn-rate limited steer of heading
  velocity `+0x488` toward `atan2(+0x3a8, +0x3b0)` (BAMS = atan * 65536 / 2pi via
  `0x903ac0`, `0x903ac8`). Clamp is `±maxStep` after `0x007a900c` angle diff, scale `0.6`
  (`0x00903c68`). PROVEN arithmetic, ASSUMED semantics.
- `0x004a5e90(this, rate)`: same turn toward the target, with `0x903a48` / `0x903a50`. UNCLEAR
  (Ghidra's arg order is confused).
- `0x004a4814(this, a, b, c)`: damping: `+0x488 *= c`, `+0x480 *= b`, `+0x47c *= a`, `+0x484 *= a`
  (PROVEN).
- `0x004a1f34(this)`: UNCLEAR: `0x004ab96c(this+0x38, {_DAT_009a8148,...})` then `0x0051fdf8`
  (a per-frame object update; ASSUMED ground marker / shadow). Values at `0x009a8148..0x009a8158`
  (`0, 0, 7.0, 1.4e-45`, runtime-ish).
- `0x004a410c(this)` and `0x004a8a24(this)`: release effect objects `+0x72c`, `+0x730`, `+0x734`
  (set bit0 "kill" on each, null the ptr). PROVEN.
- `0x004a8a88(this)`: same for `+0x73c..+0x778` (14 slots). PROVEN.
- `0x004a465c(this)`: footstep SE `0x3a2` on frame events 12.0 (`0x41400000`), 8.0 (`0x41000000`),
  15.0 (`0x41700000`), 11.0 (`0x41300000`). PROVEN.
- `0x004a46bc(this)`: lerp `+0x3c8..` toward `+0x44c..` by `0.5` (`0x903d5c`), then `0x0051fdf8`
  with `(0x41200000, _DAT_009038b4, 0x420c0000 (35.0))` ... UNCLEAR (a path / curve setup).
- `0x004a47a8(this)`: 4-way attack dispatch on frame events `DAT_00a475c4 / c8 / cc / d0`
  (runtime values): `0x004a121c`, `0x004a115c`, `0x004a109c`, `0x004a0fdc`. PROVEN dispatch.
- `0x004a121c` / `0x004a115c` / `0x004a109c` / `0x004a0fdc`: fire one of four projectile fans:
  build a point from table `0x00903814..0x00903860` (`0x41200000` = 10.0, `0x41700000` = 15.0,
  `0x41000000` = 8.0 as the y / speed terms), `0x004ab96c` + `0x0051fdf8` to spawn, then
  `0x0050b7a4` (`*(this+0x5f8)+8` as effect), and `0x004a0d3c`. PROVEN calls.
- `0x004a0d3c(effect)`: sets effect `+0x50 = 0x005b8610(1)`, `+0x54 = DAT_00a4762c`, `+0x60 = 1.0`,
  flag `0x200` on `+0x2c`. PROVEN.
- `0x004a4ae8(this)`: if `+0x474 <= 15.0` (`0x00903d34`): spawn object from `+0x470` with vector
  `(10.0, 5.0, 10.0)`-ish (`0x41200000`, `0x40a00000`), `0x0051fdf8`. PROVEN gate, args partly
  UNCLEAR.
- `0x004a4fc4(this)`: random scatter: 3 points around the boss at radius `_DAT_00903cfc` (70.0)
  using `_rand()` / 32768 scaled by `0x903d14` / `0x903d18` (32768 / 65536), effect `0x264` via
  `0x004a980c` with `(1.0, 8.0)` (`0x3f800000`, `0x41000000`), and `0x004a9d50`. PROVEN.
- `0x004a51c0(param, speed)`: spawn a projectile at param with `(DAT_009038dc, ..., 20.0)`
  (`0x41a00000`) via `0x0051fc9c`. PROVEN calls.
- `0x004a5218(this, t, flag)`: lightning / beam probe toward a random player (`0x0068d5a8` slot,
  valid check `0x00520f3c`), with `0x00763498` rand, constants `0x903a80` / `0x903a88` (0.0),
  `0x903cf8` (65536), `0x903cec` (100.0), `0x903ce8` (45056), `0x903cf4` (20480). PROVEN values,
  semantics ASSUMED (ray / bolt).
- `0x004a8f5c(this)`: constructs the action-script object (0xb8 bytes, vtable `0x00af9fb8`,
  inner vtable `0x00af9f88`), 0x2c-stride list (`0x2a` items at 35.0 spacing, `0x10003` flags).
  PROVEN.
- `0x004a91fc(this)` clear bit0 on all items of list `+0x1c` (end active attacks). PROVEN.
- `0x004a9174(this, pos, heading)`: set bit0 on items, `0x007b999c`, init list (spawns an area
  attack at pos). PROVEN calls.
- `0x004a9de0(this, pos, heading)`: create 0xa8-byte spawn object at ground (probe `0x16ef`, height
  `+ 12.0` from `0x0090441c`), `0x004a9ec4`. PROVEN calls; internals UNCLEAR.
- `0x004a0990`: per-frame hook (`vtbl+0x168`). UNCLEAR.
- `0x007be6b8(pts, n, t, mode, out)`: Bernstein weighted sum of `n` control points at parameter
  `t` (ASSUMED Bezier). PROVEN loop; uses `0x0097e508` (1.0).
- `0x0050b7a4(pos, effectId, flags)`: spawn effect object (0xd0 bytes) from effect table
  (`0x00a72cd0`, stride 0x98; ids >= `0x009bb1c8` use `0x00a72ccc - 0x13000`). PROVEN.
- `0x00814298(sfxId, emitterPtr, ...)`: play SE by id (table `0x00a13b20`). PROVEN.
- `0x008003e0(eventPtr)`: event dispatch (table `0x00a0fba0`, stride 8: ushort id, mask, fn).
  Callers in 18..34: `0x009f` (from `0x004a1328`), `0x0076` (from `0x008113e4`), and `0x004a7b28`
  (pos + heading + u16 `+0x1c`). Ids beyond 0x76 / 0x9f not decoded.
- `0x004a1328(this)`: `0x008003e0(0x9f, ...)` (PROVEN call; event 0x9f meaning UNCLEAR).
- `0x0068d5a8(id)`: player slot lookup `&0x00a94254[id]` for `id < 0xc`, else 0 (PROVEN).
  ASSUMED: the 12 client slots.
- `0x00520f3c(p)`: player valid / visible: `(*(p+0x30) & 0x2040800) == 0` and `FUN_008173b4()`
  (PROVEN).
- `0x0051f81c(this)`: reset: copies `+0x334` to `+0x346`, zeroes `+0x2e0`, clears `+0x30 & 0x200`
  and bit `0x04000000` on items in list `+0xa4`. PROVEN.
- `0x0051f604(this)`: `+0x37c = (int)state`. PROVEN.
- `0x004a4ae8`, `0x004a0d3c`, etc. above.
- `0x00694cc8` / `0x00520db8` / `0x00520db0`: leader / state probes (UNCLEAR internals).
- `0x00787534` (on-kill, called from `0x0051f894`): `FUN_00787398(+0x2da)` then `FUN_005c973c(this)`.
  PROVEN calls.
- `0x00787398(this, enemyId)`: EXP award for enemy `enemyId` (see 4.3). PROVEN structure, EXP
  formula ASSUMED.
- `0x005c973c(this)`: drop roll stub (see 4.3). PROVEN calls, drop table UNCLEAR.
- `0x008113e4(this)`: if `+0x80 != 0` -> `0x008003e0(0x76, ...)` (6x76, see 4.2), return 1. PROVEN.
- `0x0051f894(this)`: on-kill = `0x00787534` + `0x008113e4`. PROVEN.

## 3. Per-state specs

Notation: `anim N name (fr)` = motion index, name, NJM frames. "Enter" = phase 4. "Leave" = phase 5.
"Frame" = phase 0. Constants are listed in section 5 by address.

### S18 (0x004a3f20) landing / ground strike. PARTIAL.
- Enter: anim 22 runin (10 fr). `+0x13b = 1`, `+0x132 |= 4`, `+0x3c = 180.0` (`0x43340000`),
  `FUN_004a410c`, `+0x1b9 = 0`.
- Frame, busy 0: `FUN_007aa094`. Heading impulse `0x004a15ac(1.5, heading)` (`0x3fc00000`).
  Lazy init of runtime globals (flag `DAT_00a474cc & 1`): `0x00a47524 = 67.0`, `0x00a47534 = 157.0`,
  `0x00a47544 = 307.0`, `0x00a47554 = DAT_00a47564`. Height from curve: `t = progress / 17.0`
  through `0x007be6b8(0x00a47520, 4 pts, t)` -> `+0x3c`. Event at frame 17.0 (`0x41880000`):
  `+0x13b = 0`, `+0x3c = DAT_00a47564`, SE `0x3a7` (`0x00814298`), `0x0050b7a4` effect
  (`*(+0x17e+4)`, flags `0x40`) at `(x, 0, z)`, `0x004d4288(1)`, `0x004a1f34`, `+0x1b9 = 1`.
- Frame, busy 1: when `step <= 0` (motion finished) -> advance.
- Frame, always: event 4.0 (`0x40800000`) -> `0x004a15fc` (ground probe, SE `0x39b`).
- Leave: `+0x132 &= 0xfffffefb` (clears `0x104`), `0x004a8a24`.
- Transition: advance on motion end once busy == 1 (ASSUMED next = script record). Caveat:
  runin is 10 frames, so event 17.0 probably never fires unless the anim is held; UNCLEAR.

### S19 (0x004a4170) rise and spin. PARTIAL.
- Enter: anim 20 kiriout (20 fr). `+0x13b = 1`, `+0x132 |= 4`, `+0x3c = 180.0`, `FUN_004a410c`,
  `+0x1b9 = 0`, `+0x1ba = 0`.
- Frame busy 0: counter `n = +0x1ba` (0..39).
  `h = (DAT_00a475b0 - 67.0) * 0.5` (`0x903da0`). If `n >= 19.5` (`0x903d9c`): `+0x3c = 67 + h + h * cos(39 - n)`
  (`0x0082ddd8` on `0x27 - n`), else `+0x3c = 67 + h - h * sin(n)`. Pitch `+0x5c = ROUND(n * -5120.0 / 19.5)`
  (`0x903d98`, `0x903d9c`). ASSUMED sinusoid shape.
  `n++`. At `n == 11` -> anim 21 `run` (20 fr). At `n > 39` -> `+0x5c = 0`, `+0x3c = DAT_00a475b0`,
  `busy = 1`.
- Event 7.0 (`0x40e00000`) -> `0x004a15fc`.
- Frame busy 1: heading impulse `0x004a15ac(0.25, heading)` (`0x903dac`);
  `+0x3c = DAT_00a475b0 - (DAT_00a475b0 - 180.0) * cos(progress)` (`0x903fd8`).
  Advance when `step <= 0` (`0x903db0`).
- Leave: `+0x132 &= 0xfffffefb`, `0x004a8a24`, `+0x3c = 180.0`, `+0x5c = 0`.
- Transition: advance on motion end in busy 1 (ASSUMED).

### S20 (0x004a4468) takeoff, wait for walk. FULL (for the code paths read).
- Enter: anim 10 takeoff (40 fr, chain 11). `+0x13b = 0`, `+0x3c = DAT_00a47564`. No flags.
- Frame: `FUN_007aa094`. If `+0xb4 == 0xb` (the walk record's flags = the chain into walk has
  happened) -> advance.
- Transition: advance when the takeoff chain reaches walk (anim 11).

### S21 (0x004a44d0) walk / approach. PARTIAL.
- Enter: anim 11 walk (30 fr). `+0x13b = 0`, `+0x3c = DAT_00a47564`, `+0x132 |= 0x30`.
- Frame: `FUN_007aa094`; `0x004a465c` (footsteps); `0x00521410`; `0x004a46bc`; `0x004a47a8`
  (attack dispatch, see helpers). Target distance: `d = FUN_007aabd8()` (progress, not distance).
  - If `d < 10.0` or `d >= 17.0` (`0x903d78`, `0x903d74`): damping `0.9` (`0x3f666666`), speed
    `0.0` (`0x903d84`), turn `0`, runtime pair `a475c0 / a475bc`. Else: damping `0.86` (`0x3f5c28f6`),
    speed `1.0` (`0x903d8c`), turn `208` (`0xd0`), runtime pair `a475b8 / a475b4`.
  - Event 0.5 (`0x3f000000`): speed += 9.0 (`0x903d70`), turn += 1280 (`0x500`).
  - `0x004a4814(damp, runtimeB, runtimeC)` (runtime `0x00a475b4..c0`), `0x004a15ac(speed, heading)`,
    `0x004a1b84(turn)`.
- Leave: `+0x132 &= 0xffffffcf`.
- Transition: none in code; script duration (see 1.5). UNCLEAR the exact runtime values
  (`0x00a475b4..c0`, init site not found).

### S22 (0x004a487c) huse-out / strike prep. PARTIAL.
- Enter: anim 12 huseout (14 fr). `+0x13b = 0`, `+0x3c = DAT_00a47564`, `+0x132 |= 0x30`.
- Frame: `FUN_007aa094`. Chooses `(0.9 / runtime a475c0, a475bc)` if `progress < 15.0` (`0x903d40`),
  else `(0.86 / a475b8, a475b4)`. Event 3.0 (`0x40400000`) -> add 11.0 (`0x41300000`) to speed.
  `0x004a4814(f, a, b)`, `0x004a15ac(speed, heading)`.
  Event 15.0 (`0x41700000`): `0x0050b7a4` effect (`(x, 0, z)`, id from `+0x17e`... struct `+4`),
  `0x004a1f34`, SE `0x3a7`.
  Advance when `step <= 0` (`0x903d58` = 0.0).
- Leave: `+0x132 &= 0xffffffcf`.

### S23 (0x004a4a08) huse loop / emit. PARTIAL.
- Enter: anim 13 houko (30 fr, chain 14). `+0x13b = 0`, `+0x3c = DAT_00a47564`, no flags.
- Frame: `FUN_007aa094`, `0x004a4ae8` (emit at `+0x470` if `+0x474 <= 15.0`), event 10.0 (`0x40e00000`)
  -> `0x004a9174(this+0x38, heading)`, event 1.0 (`0x3f800000`) -> SE `0x3a8`.
  Advance when `+0x2d == 14` (chain into `huse`).

### S24 (0x004a4b9c) huse. MOSTLY FULL.
- Enter: anim 14 huse (14 fr). `+0x13b = 0`, `+0x3c = DAT_00a47564`, `0x004a9174(this+0x38, heading)`.
- Frame: `FUN_007aa094`, `0x004a4ae8`. Leave: `0x004a91fc`.
- Transition: script duration only.

### S25 (0x004a4c20) husein. PARTIAL.
- Enter: anim 15 husein (14 fr). `+0x13b = 0`, `+0x3c = DAT_00a47564`, `0x004a9174(...)`.
- Frame: `FUN_007aa094`, `0x004a4ae8`, event 5.0 (`0x40a00000`) -> `0x004a91fc` (end attacks).
  Advance when `step <= 0` (`0x903d2c` = 0.0).

### S26 (0x004a4cd8) dead. FULL.
- Enter: anim 16 dead (150 fr, chain 17). `+0x13b = 0`, `+0x3c = DAT_00a47564`.
- Frame: `FUN_007aa094`; event 19.0 (`0x41980000`) -> SE `0x3a9`. Advance when `+0xb4 == 0x11`
  (the chain into kiri, anim 17).
- No kill logic here (see section 4). This is a "dead" motion, not the kill handler.

### S27 (0x004a4d6c) kiri / lightning barrage. PARTIAL.
- Enter: anim 17 kiri (20 fr). `+0x13b = 0`, `+0x3c = DAT_00a47564`, `0x004a9174(this+0x38,
  heading)`, `+0x1bb = 0`, `0x0082d7b0` / `0x00830cd8` / `0x0082d838` / `0x0082d8bc` / `0x00830aa0`
  (vector setup), `0x004a9de0` x2 -> `+0x1b9`, `+0x1ba` (spawn objects), `0x0084c390(+0x131+4)`.
- Frame: `FUN_007aa094`, `0x004a4ae8`. If player count `> 1`: `0x004a4fc4` (scatter), `0x004a51c0`
  (projectile at 20.0). If `count > 3` and `(+0x1bb % 20) == 0`: `0x004a5218(...)` (beam at a
  random player). SE `0x3ab` via `0x008144b0` every frame. `+0x1bb++`.
- Leave: `0x0073d160` on `+0x1ba` and `+0x1b9` (destroy spawns), `+0x1b9 = +0x1ba = 0`,
  `0x004a91fc`.
- Transition: script duration.

### S28 (0x004a5530) kiriland. FULL.
- Enter: anim 18 kiriland (30 fr). `+0x13b = 0`, `+0x3c = DAT_00a47564`.
- Frame: `FUN_007aa094`. Event 6.0 (`0x40c00000`) -> SE `0x3aa`. Advance when `step <= 0`
  (`0x903cd4` = 0.0).

### S29 (0x004a55c8) kirin / fall. PARTIAL.
- Enter: anim 19 kirin (20 fr, chain 20). `+0x13b = 1`, `+0x132 |= 4`, `+0x3c = 180.0`,
  `+0x1ba = 0`, `+0x1b9 = 0`.
- Frame busy 0: `+0x3c = ((DAT_00a475d4 - 180.0) * t^2) / 25.0 + 180.0` (`0x903fd8`, `0x903cc8`),
  `t = FUN_007aabd8(0.28)` (`0x903ccc`, passed as an arg, UNCLEAR). Event 5.0 -> `+0x1ba = 0`, `busy = 1`.
- Frame busy 1: `+0x3c += 40.0` per frame (`0x903cc0`), `+0x1ba++`. At `> 39`: `+0x13b = 3`,
  `+0x3c = 8000.0` (`0x45fa0000`, `0x903fd0`), `+0x5c = 16384` (`0x4000`, 90 deg), advance.
- Leave: `+0x13b = 3`, clear `+0x4`, `+0x3c = 8000.0`, `+0x5c = 0x4000`. (The leave writes a
  `+0x17` = pitch of 16384 and does not reset it; ASSUMED a deliberate "stay tilted".)

### S30 (0x004a5734) the dive / bolt run. PARTIAL (major). 
- Enter: anim 20 kiriout (20 fr). `+0x13b = 3`, `+0x132 |= 4`, `+0x3c = 8000.0`,
  SE `0x3b2` (`0x00814298`), `0x0084c390(+0x131+4)`, `+0x5c = 16384`, `+0x1bc = 0`.
  `+0x1ba = ROUND(short(+0x131+2) - F)` where `F = 0x0083a248(75.0)` (`0x42960000`), and
  `+0x1bf = (8000.0 - DAT_00a47564) / (short(+0x131+2) - F)` (`0x903fd0` = 8000.0). `+0x1b9 = 0`.
  (`+0x131` is the target-data pointer, `+0x131+2` = a short, ASSUMED a height / range.)
- Frame, sub-phase `+0x1b9`:
  - 0: `FUN_007aa094`. If `(x^2 + z^2) <= 102400.0` (`0x903ca0` = 320^2): `0x004a5e10(256, atan)`
    (turn toward origin), else turn toward `-(x,z)`. `0x004a5e90(3.0)`. `+0x3c -= +0x1bf`.
    `+0x19 += 0x3311` (13073 BAMS). If `+0x1ba <= +0x1bc` -> `+0x1b9 = 1`, anim 22 `runin`
    (`+0x2c |= 1`). Path sampling: random points via `0x0082dcbc` / `0x0082ddd8` at radius
    `0x903c70` (50.0) with ground probe `0x00780630(pt, 0x16ef)` and `0x903ae0` (6.0) rejection.
    `0x004aa4ec` / `0x004aa4b0` spawn ring every 5 frames (`0x28`, `0x11`); SE `0x3ac` at 20.
  - 1: `+0x3c -= +0x1bf`, event 22.0 (`0x41b00000`) -> `+0x13b = 0`, `+0x3c = DAT_00a47564`, SE
    `0x3a7`, `0x0050b7a4` at a point, `0x004d4288(1)`, `0x004a1f34`, `+0x1b9 = 3`.
  - 2: `+0x3c -= +0x1bf`, event 22.0 path. (sub-phase 2 is the "return" path; UNCLEAR detail.)
  - 3 and other: no-op beyond the event in busy 1.
- Leave: `+0x13b = 0`, `+0x3c = DAT_00a47564`, `+0x17 = 0`, `+0x19 = 0`, clear `+0x4`.
- Transition: sub-phase flow, and `FUN_007aa094` anim; the exit to the next script record is
  via the script duration. UNCLEAR the full path math.

### S31 (0x004a5eec) kakuin / beam. PARTIAL.
- Enter: anim 2 kakuin (30 fr). `+0x13b = 0`, `+0x3c = DAT_00a47564`.
- Frame: `FUN_007aa094`. Event 22.0 (`0x41b00000`): midpoint of two stored points
  (`(+0x3d4 + +0x3e0) * 0.5`) using `0x903c60` (0.5); `FUN_005caba4(0x130)` -> `0x004aabd8(this+0x4cc, mid)`
  (creates an 0x130-byte object; body UNCLEAR), `0x004d4288(1)`, SE `0x3a0`.
  Advance when `step <= 0` (`0x903c5c` = 0.0).

### S32 (0x004a606c) runout. FULL.
- Enter: anim 23 runout (35 fr). `+0x13b = 0`, `+0x3c = DAT_00a47564`, `+0x132 &= 0xfffffffb`.
- Frame: `FUN_007aa094`. Event 12.0 (`0x41400000`) -> SE `0x3b1`. Advance when `step <= 0`
  (`0x903c54` = 0.0).
- Leave: `+0x13b = 0`, `+0x3c = DAT_00a47564`.

### S33 (0x004a6120) fly / travel. PARTIAL.
- Enter: anim chosen by stage `+0x4ec`: 0 -> anim 0 fly (30 fr), 1 -> anim 4 kakuout (30 fr),
  2 -> anim 7 op (500 fr, an opening / flyover loop). Other stages: no anim write.
- Frame: `FUN_007aa094`. Stage 1: `0x004a1a48` (ground probe at event 14.0). Stage 2:
  `0x004a15ac(3.0, heading)` (`0x40400000`, forward speed 3.0).
- No direct advance: script duration only. Stage 0 leaves no per-frame motion (ASSUMED
  hover).

### S34 (0x004a61bc) remove. FULL.
- Enter only: `+0x4c8 |= 0x80`, `*(u16*)(this+8) |= 1` (delete flag, same bit the frame update
  sets for the gone case). No frame, no leave.
- ASSUMED: the boss object is removed from the room and not re-entered. UNCLEAR whether a state
  can come back out of 34 (no advance code here).

## 4. Death, EXP, drops (what the code does)

### 4.1 Which state(s) handle death

- **S5 (0x004a2008) is the death state, PROVEN from its code path.** Its phase 4 (enter):
  anim 26 `tunout` (the anim index is PROVEN; the name is from the motions list), `+0x132 |= 0xc4`,
  `+0x3c = 180.0`, `+0x13b = 1`, `+0x1b9 = 0`, `+0x1ba = 0`, `+0x1bf = 0`. Heading is set toward
  the point `(0x903f9c, 0x903fa4)` = (0.0, 0.0) with `fpatan`. The body is then put at
  `x = -600.0 * cos + 0.0`, `z = -600.0 * sin + 0.0` (`0x903f08`) with `y = 360.0` (`0x43b40000`).
  The `cos` / `sin` argument is not clear from the decompile (UNCLEAR). It plays `dradeath.adx`
  (`0x008fc30c` via `0x00814f0c`) and a cinematic setup: `0x00717f74`, `0x004d31f4(5)`,
  `0x004d6770(0x31c7)`, `0x004d681c(...)` (ASSUMED: a death camera / cut).
- S5 frame (phase 0): `FUN_007aa094`. Event `110.0` (`0x42dc0000`) -> effects `0x201` once and
  `0x20d` x3 at the body, SE `0x3a6`. If `+0x1b9 == 0` and `(+0x2c & 0x10)` -> `+0x1b9 = 1`,
  `+0x1ba = 0`. If `+0x1b9 == 1` and `++ +0x1ba > 49` (`0x31`) -> advance.
- **S5 leave (phase 5) is the kill.** It runs `0x0051f894` = `0x00787534` (EXP + drop) +
  `0x008113e4` (6x76), then `0x006bb100(0x52)` (SE 0x52), restores the pose, `+0x0c = 0x12008`,
  `vtbl+0x130(0)`, `0x00717f38`, `0x004d3250`. PROVEN calls.
- **S26 (0x004a4cd8) `dead` (anim 16, 150 fr)** is a motion-only state with no kill call. It
  would be the visual death if reached, but the kill side is only on S5 leave. Whether S5 or
  S26 is entered on death is UNCLEAR (the script decides). This is the top open point.

### 4.2 Network sends on death (PROVEN code, partly ASSUMED meaning)

- `0x008113e4(this)`: if `+0x80 != 0`, `0x008003e0(0x76, (short)DAT_00aafca0)`. `DAT_00aafca0` is
  the local client id (ASSUMED from its use in `0x00787398`: `+0x3f0 != DAT_00aafca0`).
- newserv `on_set_entity_set_flag` (`vendor/newserv/src/ReceiveSubcommands.cc:3273`): subcommand
  **6x76** is "set entity set flags" from the client. `entity_id >= 0x1000` = enemy by index
  (`- 0x1000`); `>= 0x4000` = object. The server ORs `flags` into the enemy's set-flags.
  So the kill sends a 6x76 with the enemy's set-flag (dead bit), not an EXP packet.
- The exact flags word and the entity id are not decoded here (the `0x008003e0` call takes a
  struct; Ghidra shows only the id). UNCLEAR: the flag value.

### 4.3 EXP and drops (PROVEN calls, ASSUMED formula)

- `0x00787398(this, enemyId)`: loads enemy slot `0x0068d5a8(enemyId)`; if it is not flagged
  `0x800` in `+0x30` and its owner `+0x3f0 == DAT_00aafca0` (us):
  `base = monsterTable(+0x2b4 + 0x1c) * 10` (`* 13` if `DAT_00aafdb8 == 1`); if the enemy is the
  last hitter (`+0x2d8`): `* 10` plus `0x00770ce4(1)`, else `* 8`; if `DAT_00a49510 && DAT_00a95624 == 1`:
  `* _DAT_00a48be4`; then `/ 100 * DAT_009f9ee0`; shown via `0x0078aabc`, sent / recorded via
  `0x00787358`. ASSUMED formula (table entries not read).
- `0x005c973c(this)`: drop roll stub. If both player slots `DAT_00a9c4dc` / `DAT_00a9c4f4` are
  valid and on the same floor, and the object's `+0x2c` table entry is not -1: probe floor
  `0x00780630(pos, 1)`, then `0x00800518` (item drop spawn). Drop table / rate UNCLEAR.

## 5. Float constants (address -> value, via tools/exedata.py; PROVEN values)

Used by 18..34 unless noted. "rt" = runtime global in `.bss` (no value in the exe; set elsewhere).

| address | value | used in |
|---|---|---|
| 0x00903a48 / 0x00903a60 / 0x00903aa0 / 0x00903ac0 | 6.2831840 (2 pi) | atan to BAMS (4a1b84, 4a5734, 4a5e90) |
| 0x00903a50 / 0x00903a68 / 0x00903aa8 / 0x00903ac8 | 65536.0 | atan to BAMS |
| 0x00903a58, 0x00903a80, 0x00903a88 | 0.0 | fRam offsets (4a5734, 4a5218) |
| 0x00903ae0 | 6.0 | ground hit height limit (4a15fc, 4a9de0) |
| 0x00903ae4 | 32768.0 | rand scale (8c9c) |
| 0x00903bbc | 32768.0 | rand scale (4a771c) |
| 0x00903ba4 / ba8 / bac / bb0 / bb4 / bb8 | 0.9 / 0.8 / 0.4 / 0.3 / 0.6 / 0.2 | 4a771c tree |
| 0x00903bcc / bd0 | 0.0 / 0.0 | ProcessState null guard |
| 0x00903c54 | 0.0 | S32 end test |
| 0x00903c5c | 0.0 | S31 end test |
| 0x00903c60 | 0.5 | S31 midpoint |
| 0x00903c68 | 0.6 | turn factor (4a5e10) |
| 0x00903c6c / c70 / c78 / c90 | 50.0 | S30 path radius |
| 0x00903c74 | 360.0 | S30 |
| 0x00903c7c | 7.0 | S30 |
| 0x00903c88 | -4.0 | S30 path step |
| 0x00903c94 | 4.0 | S30 |
| 0x00903c98 | 0.5 | S30 test |
| 0x00903ca0 | 102400.0 | S30 (320^2 radius test) |
| 0x00903ca8 | 933.7857 | S30 |
| 0x00903cac | -7.0 | S30 |
| 0x00903cb0 | -49152.0 | S30 |
| 0x00903cb4 | 65536.0 | S30 / 4a5734 |
| 0x00903cbc | 1.0 | S30 |
| 0x00903cc0 | 40.0 | S29 rise / frame |
| 0x00903cc8 | 25.0 | S29 |
| 0x00903ccc | 0.28 | S29 arg |
| 0x00903cd4 | 0.0 | S28 end test |
| 0x00903cdc / ce0 / ce4 / cec | 20480 / 10000 / 250 / 100 | 4a5218 |
| 0x00903ce8 / cf4 / cf8 | 45056 / 20480 / 65536 | 4a5218 |
| 0x00903cfc | 70.0 | 4a4fc4 scatter radius |
| 0x00903d0c / d14 / d18 / d1c / d20 | 0.5 / 32768 / 65536 / 4.0 / 65536 | 4a4fc4, 4a4d6c |
| 0x00903d2c | 0.0 | S25 end test |
| 0x00903d34 | 15.0 | 4a4ae8 emit gate |
| 0x00903d40 | 15.0 | S22 speed branch |
| 0x00903d58 | 0.0 | S22 end test |
| 0x00903d5c | 0.5 | 4a46bc lerp |
| 0x00903d70 | 9.0 | S21 speed boost |
| 0x00903d74 | 17.0 | S21 distance band |
| 0x00903d78 | 10.0 | S21 distance band |
| 0x00903d84 | 0.0 | S21 speed |
| 0x00903d8c | 1.0 | S21 speed |
| 0x00903d98 | -5120.0 | S19 pitch |
| 0x00903d9c | 19.5 | S19 |
| 0x00903da0 | 0.5 | S19 |
| 0x00903da4 | 2.3 | S19 (ASSUMED use) |
| 0x00903dac | 0.25 | S19 heading impulse |
| 0x00903db0 | 0.0 | S19 end test |
| 0x00903db4 | 17.0 | S18 curve divisor |
| 0x00903dcc | 0.0 | S18 end test |
| 0x00903f08 | -600.0 | S5 body offset |
| 0x00903f9c / 0x00903fa4 | 0.0 / 0.0 | S5 target, ctor zero vector |
| 0x00903fd0 | 8000.0 | S29/S30 height |
| 0x00903fd4 | 67.0 | S19 base height |
| 0x00903fd8 | 180.0 | S19 / S29 / S30 height |
| 0x0090441c | 12.0 | 4a9de0 height offset |
| 0x0097d960 / 964 / 968 / 978 / 97c / 990 | 0.0 / 1.0 / 0.0 / 0.0 / 1.0 / 0.0 | motion player (007a9a6c, 007aa094, 007aabd8) |
| 0x009a80c8 | 225.0 | ctor `+0x358` (ASSUMED) |
| 0x009a8148 / 814c / 8154 / 8158 | 0.0 / 0.0 / 7.0 / 1.4e-45 | 4a1f34 |
| 0x00a475b0 | rt | S19 (base height, runtime) |
| 0x00a475b4 / b8 / bc / c0 | rt | S21, S22 (speed / damping, runtime) |
| 0x00a475c4 / c8 / cc / d0 | rt | 4a47a8 attack thresholds |
| 0x00a475d4 | rt | S29 |
| 0x00a475d8 / dc / e0 | 0.3 / 0.75 / 0.75 (init in 4a7c44) | 4a7c44 damping tables |
| 0x00a47524 / 534 / 544 / 554 | 67.0 / 157.0 / 307.0 / DAT_00a47564 (init in S18) | S18 curve |
| 0x00a47564 | rt | "y = ground" default used in most enters |

Runtime `.bss` values (`0x00a475b0..d4`, `0x00a475c4..d0`) are set somewhere not decoded;
UNCLEAR, and these constants dominate S21, S22 and S29.

## 6. Open points / UNCLEAR (top 3 first)

1. **The script (action list) is data we did not read.** Transitions in 18..34 go through
   `0x004a7e20`, which takes the next record at `+0x4c4 + 0x14`. The records (state short,
   duration short) and the action-script opcode table `0x009a7f60` (fed by `0x004a7390` /
   `0x004a771c` / `0x004a8c9c`) are not decoded. So the state graph (which state follows which)
   is not known for 18..34. The next pass needs the record builder and the table `0x009a7f60`.
2. **Semantics of `+0x13a` and `+0xc8`, and the runtime globals.** `+0x13a == 1` picks the
   phase-0-only path in the frame update, but which side (authority or remote) it means is not
   proven. The `0x004a7360` gate (`short +0x334 < 1`) contradicts the use of `+0x334` as the HP
   numerator in `0x004a771c`; one of the two readings is wrong. The "one-shot finished" test `(float)param_1[0x32] <= 0` is ASSUMED to be the motion
   step `+0xc8 <= 0` (the decompile prints an int cast). The `0x00a475xx` runtime constants that
   S19, S21, S22, S29 read have no init site found.
3. **Death and the drop / EXP inputs.** S5 leave is the kill (6x76 + EXP + drop roll), but the
   6x76 flag word, the EXP table entries (`monsterTable +0x1c`, `DAT_00aafdb8`, `DAT_009f9ee0`), the
   drop table, and whether S5 or S26 (`dead`) is the real death entry are not confirmed. The HP
   pool source (`+0x334` / `+0x2bc`) is also not located.

Other gaps: hit boxes (no per-state hit-box radius found in 18..34; damage goes through
`0x0050b7a4` effect objects with flag `0x40`, and the damage path itself is UNCLEAR), the
6x-subcommand ids other than 6x76 (`0x009f`, the id from `0x004a7b28`), the path math in S30, and
the internals of `0x004aabd8`, `0x004a9de0`, `0x004a0990`, `0x004a1f34`.

## 7. Completeness

- FULL (all code paths read, helpers PROVEN enough): S20, S24 (mostly), S26, S28, S32, S34.
- PARTIAL: S18, S19, S21, S22, S23, S25, S27, S29, S30, S31, S33 (11 states).
- States fully specified: 6 of 17 (S20, S24, S26, S28, S32, S34). The rest are partial.
- S5 (death) is in the other agent's range; section 4 is here because the death sequence was
  asked for. S5 details are PROVEN from its code.
