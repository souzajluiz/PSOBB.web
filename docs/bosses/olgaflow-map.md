# Olga Flow: exe map (partial)

First mapping pass, 2026-10-22. Area 0x1f, Episode 2 floor 13 (boss flag 0x57 on area 0x1f).
Addresses are PsoBB.exe VAs. "dump" is the named Ghidra dump in original-psobb-client-source
(names often wrong). Tags: PROVEN (read in asm / table bytes), ASSUMED, UNCLEAR.
No brain is ported yet. Read-only pass: no code change.

Sources: `objdump` on PsoBB.exe (`calll` lines grepped from a 0x0048c000..0x0049f000 dump),
Ghidra headless (`tools/ghidra/decomp.sh`), `tools/exedata.py read` for tables, the repo's
`client/src/formats/bml.ts` + `archives.ts` + `enemymodels.ts` for the motion archive, and
`vendor/newserv` (EnemyType.cc, ReceiveSubcommands.cc, notes/movement-data.txt) for names.

Lessons carried from barbaray-map.md / galgryphon-*.md:

- Names in the dump are wrong. `client/src/combat/dragon.ts` cites "OlgaUpdateMainLoop
  (0x00423b7c)", but that is the Episode 1 Dragon (TBoss1Dragon). Do not port from that name.
- The Olga range 0x0048c000..0x0049f000 has no calls to the generic state switch
  0x0051f62c, nor to the on-kill sender 0x0051f894. Olga keeps its own state tables. This
  differs from Barba Ray and Gal Gryphon.
- HP offsets: +0x2bc = max, +0x334 = current (shared layout). See section 6 for a conflict.
- 0x008003e0 sends a 6x subcommand AND applies it locally (table 0x00a0fba0, 8-byte rows).

## 1. Type id, factory, ctors, vtables (PROVEN)

- Enemy type id **0xca**. Factory table row at **0x009fcc70** (stride 0x30; +0x1c = type id,
  +0x20 = factory pointer; the row for 0xcb = Barba Ray is at 0x009fcca0, factory 0x004af5b8,
  which matches barbaray-map.md). Row 0xca: **factory 0x0048d764**.
- Factory 0x0048d764: allocs 0x3e8 bytes (the object, ECX of the ctor), allocs 0x20 bytes
  (aux, ctor param_2), calls `0x00787a4c(DAT_00aca360)` on the aux, then ctor **0x0048d814**
  (this = the 0x3e8 object; param_2 = aux; param_3 = the factory argument, spawn initdata).
  PROVEN from the asm (0x48d764..0x48d80b). RESOLVED in section 12.1: the ctor's `this` is the
  0x3e8 block; the +0x688 writes (`param_1[0x1a2]`) belong to the beast ctor 0x00497580 on its 0x68c block.
- Controller ctor 0x0048d814: sets vtable **0x00af9240** (PROVEN). Reads BattleParam row 0x2c
  (= 44) via 0x0077a684 / 0x0077a698 / 0x0077a6b4 (PROVEN). Calls `0x0048d038`, `0x0048dafc`,
  `0x0048db1c`, `0x00497bc8`, `0x00497e20`, `0x004967dc`, `0x004982f4`, `0x004982d8`,
  `0x0049823c`, `0x00498320`, `0x004931c0`. Loads the sub-state 0x009a70a4-style motion
  pair from 0x009a6dc0 (see 4.3). Sets `DAT_00a46f9c = this` (PROVEN).
- Phase-1 beast spawner 0x0048d188: if `DAT_00a46f98 == 0` it calls 0x004974d0, which
  allocs **0x68c** bytes (PROVEN) and calls beast ctor **0x00497580** (aux alloc 0x20 the same
  way). Beast ctor: vtable **0x00af9820** (PROVEN), BattleParam row **0x2b** (= 43) via 0x0077a6cc.
- Controller vtable 0x00af9240 (PROVEN slots): 0 = 0x0048ce30 (dtor, calls 0x0048ce54 then
  0x005c2f74 when bit 0), 1 = **0x0048d004** (per-frame), 2 = 0x0061cdb0 (empty), 3 = 0x007879e0,
  4 = 0x00618a44 (shared base), 0x14c/4 = slot 83 (called by the ctor with param_3).
- Beast vtable 0x00af9820 (PROVEN slots): 0 = 0x0049295c (dtor), 1 = **0x00492a84** (per-frame),
  2 = 0x00493f20 (draw; calls the render 0x00494120), 3 = 0x0049749c (fall/ground check against
  -30.0, calls 0x007879e0), 4 = 0x00618a44 (shared), 5..: shared base slots.
- Form 2 entity class: NOT LOCATED (pass 1). Pass 2 (section 12.2): the 6xA5 target uses the beast
  layout (>= 0x4d0 bytes); its per-frame dispatcher 0x00499908 has no static xref at all. BLOCKER.

Form map (ASSUMED from the names and the sends; check):

| form | object | ctor / receive | BattleParam row (exe) | newserv type |
|---|---|---|---|---|
| body (the spawned boss, type 0xca) | controller 0x3e8 bytes | ctor 0x0048d814 | 44 | OLGA_FLOW_2 (stats 0x2c, rt 0x4e) |
| form 1 beast | 0x68c bytes | ctor 0x00497580, spawned by 0x0048d188 | 43 | OLGA_FLOW_1 (stats 0x2b) |
| form 2 | UNCLEAR | receive 6xA5 0x0049e3e8 | UNCLEAR | UNCLEAR |

The exe reads row 44 in the controller and row 43 in the beast. newserv gives OLGA_FLOW_1 =
43 and OLGA_FLOW_2 = 44 (EnemyType.cc:109-110). So the exe's controller is OLGA_FLOW_2 and the
beast is OLGA_FLOW_1, as the names say. The beast ctor also calls 0x00787550(0x4e), the rt of
OLGA_FLOW_2 (UNCLEAR meaning).

## 2. Per-frame (PROVEN calls, shapes ASSUMED)

Controller 0x0048d004:

1. `0x00520db8` (= 0x0067e408) gate: return if != 0.
2. `0x0048d038`: sets +0x37c = 0 when `0x0052cf54()` != 0, else 1 (ASSUMED leader / follower role).
3. If +0x37c == 0: `0x0048d05c` calls frame A of the sub-state row (table 4.1, column A).
4. `0x0048d074` calls frame B (column B), then `0x0048d098`.
5. `0x00491d74` -> `0x00491d7c`.

Beast 0x00492a84 (vtable +4):

1. Frame fn of the current beast state (table 4.2 col "frame"); leader fn (col "leader") only when
   the owner (+0x400)'s +0x37c == 0.
2. Position and velocity lerp (+0x450..+0x478), motion blend (`0x00493080`), then a loop over
   up to 7 parts at +0xa4 (0x2c-byte records) calling 0x0082f9c4 / 0x0082d7b0 / 0x00830aa0 /
   0x0082ebac (PROVEN calls, meaning ASSUMED: part transform and pose).
3. Effects: `0x0080575c(+0x58c, 0xffffa24c, 0x40a00000, 1, 1)`, `0x006946a8(this, -1)`.
4. HP ratio: +0x4e0 = (short +0x334) / (short +0x346) (PROVEN read, meaning ASSUMED, see 6).
5. Random timers +0x4f8 / +0x4fc from `_rand()` and ROUND (PROVEN); +0x4f0 height target via
   `0x0082dcbc`. Per-state branch: state 0x17 uses `0x0082e900`; states 0x1d..0x20 and 0x25 use
   +0x4f0 directly (PROVEN branches).
6. A loop over 4 entries of an array at +0x500 (PROVEN read): non-zero entries call
   `0x00508db8` (and `0x00508dd0` for the first two). Meaning ASSUMED (effect or hit emitters).

## 3. Movement and anchors

- Beast ctor 0x00497580: writes the body position from the spawn initdata (+0x38/+0x40 from
  `param_3`), and the sub-object positions from 0x009029cc / 0x009029d0 / 0x009029d4 (PROVEN
  reads; values not decoded).
- Beast 0x0049749c: when +0x3c >= -30.0 (0x00a47314 cached, PROVEN) calls 0x007879e0. Ground check, ASSUMED.
- Speeds, turn rates and path constants: NOT DECODED. The per-state vectors are in the 0x0090xxxx
  and 0x00a47xxx ranges (see the Barba tables for the same pattern). BLOCKER.

## 4. State machines (tables PROVEN; per-handler bodies NOT decoded)

Dispatch: each receive handler sets the state and copies the motion pair, then calls the row's
enter fn. Each frame calls the row's frame fn.

### 4.1 Controller sub-states (base 0x009a6c64, stride 0x14, rows 0..8)

Set by 6xA3 (0x0048db6c). It validates range 0..8 and calls the old row's leave fn (col "leave")
and the new row's enter fn. +0x380 = sub-state index.

| row | enter (w0) | leave (w1) | frame A (w2) | frame B (w3) | data (w4) |
|---|---|---|---|---|---|
| 0 | 0x0048f30c | - | 0x0048ee3c | 0x0048edf8 | 0x00901ed0 |
| 1 | 0x0048f2d8 | - | 0x0048ee3c | 0x0048ee58 | 0x00901edc |
| 2 | 0x0048f2ac | - | 0x0048ee84 | 0x0061cdb0 | 0x00901ee8 |
| 3 | 0x0048f26c | - | 0x0048eea8 | 0x0048eec4 | 0x00901ef4 |
| 4 | 0x0048f234 | - | 0x0048ef3c | 0x0048ef6c | 0x00901f04 |
| 5 | 0x0048f1e4 | - | 0x0048efec | 0x0048f008 | 0x00901f10 |
| 6 | 0x0048f1c0 | - | 0x0048f034 | 0x0061cdb0 | 0x00901f1c |
| 7 | 0x0048f120 | - | 0 | 0x0048f058 | 0x00901f28 |
| 8 | 0x0048f100 | - | 0 | 0x0048f0b8 | 0 |

Motion pair per sub-state: table 4.3 (ctor loads 9a6dc0 row 2 at start).

### 4.2 Form 1 beast states (base 0x009a70a4, stride 0x18, rows 0..39; 6xA4 cap 0x28)

Row fields (ASSUMED names from the decode of 0x00497e50 and 0x00492a84): w0 = motion-pair row
(table 4.3, -1 = keep), w1 = value stored at +0x420, w2 = enter fn (called by 6xA4), w3 =
leader fn (called when the owner state is 0), w4 = frame fn (called every frame), w5 = data ptr.

| state | motion row | value | enter | leader | frame |
|---|---|---|---|---|---|
| 0 | 2 | 1 | 0x0049978c | - | 0x0049844c |
| 1 | 2 | 1 | 0x00499728 | 0x00498484 | 0x00498554 |
| 2 | 2 | 1 | 0x004996a4 | - | 0x00498570 |
| 3 | 11 | 1 | 0x0049967c | - | 0x004985a8 |
| 4 | 11 | 1 | 0x00499654 | - | 0x004985e0 |
| 5 | 13 | 1 | 0x00499614 | - | 0x00498634 |
| 6 | 13 | 1 | 0x00499614 | - | 0x00498634 |
| 7 | 13 | 1 | 0x00499614 | - | 0x00498634 |
| 8 | 13 | 1 | 0x004995a4 | - | 0x00498674 |
| 9 | 13 | 1 | 0x004995a4 | - | 0x00498674 |
| 10 | 13 | 1 | 0x004995a4 | - | 0x00498674 |
| 11..20 | 12 | 0 | 0x00499530 | - | 0x004986c8 |
| 21 | 14 | 1 | 0x00499508 | - | 0x0049872c |
| 22 | 15 | 1 | 0x004994b4 | - | 0x0049876c |
| 23 | 20 | 0 | 0x0049946c | - | 0x00498878 |
| 24 | 0 | 1 | 0x0049943c | 0x004988d4 | 0x004988e8 |
| 25 | 0 | 1 | 0x00499414 | 0x00498934 | 0x00498998 |
| 26 | 3 | 0 | 0x004993a4 | - | 0x004989d4 |
| 27 | 0 | 0 | 0x0049935c | - | 0x00498a0c |
| 28 | 0 | 0 | 0x00499314 | 0x00498a50 | 0x00498a70 |
| 29 | 5 | 0 | 0x004992c4 | - | 0x00498ab0 |
| 30 | 8 | 2 | 0x00499260 | 0x00498bbc | 0x00498bec |
| 31 | 8 | 2 | 0x0049922c | - | 0x00498c48 |
| 32 | 9 | 0 | 0x004991ac | 0x00498c64 | 0x00498c74 |
| 33 | 2 | 0 | 0x0049916c | - | 0x00498d20 |
| 34 | 2 | 0 | 0x004990fc | - | 0x00498d8c |
| 35 | 2 | 0 | 0x004990b4 | - | 0x00498e04 |
| 36 | 2 | 0 | 0x0049906c | 0x00498e48 | 0x00498e88 |
| 37 | 2 | 0 | 0x00499034 | 0x00498ec0 | 0x00498ee4 |
| 38 | 2 | 0 | 0x00498ff4 | - | 0x00498f4c |
| 39 | -1 | 0 | - | 0x00498fd8 | - |

(Rows 0..39 come from one dump; w0 and the motion row for row 0 match DAT_009a70a4 = 2 and
DAT_009a70a8 = 1 in the ctor. "-" = zero.)

### 4.3 Motion pairs (base 0x009a6dc0, 16-byte rows: mode, next, motion_leg, motion_body)

Names are indices into the 62-entry motion list of boss06_plotfalz_dat.bml (section 7).
Model 2 (leg) gets the first motion, model 6 (body) the second (ASSUMED from the spawn
spec in enemymodels.ts: loop(44) on model 2, loop(56) on model 6).

| row | mode | next | leg | body | names (leg / body) |
|---|---|---|---|---|---|
| 0 | 0 | 0 | 44 | 45 | skywait_bossgc_pf01_leg / skywait_bssgc_pf01_body |
| 1 | 0 | 1 | 42 | 45 | skwait2_bossgc_pf01_leg / skywait_bssgc_pf01_body |
| 2 | 0 | 2 | 44 | 56 | skywait / waitside_bssgc_pf01_body |
| 3 | 2 | 0 | 40 | 41 | sidetoup_bossgc_pf01_leg / sidetoup_bssgc_pf01_body |
| 4 | 2 | 2 | 44 | 53 | skywait / uptoside_bssgc_pf01_body |
| 5 | 2 | 0 | 37 | 38 | roll_bossgc_pf01_leg / roll_bssgc_pf01_body |
| 6 | 2 | 2 | 37 | 38 | roll (same) |
| 7 | 2 | 8 | 29 | 30 | land_bossgc_pf01_leg / land_bssgc_pf01_body |
| 8 | 0 | 8 | 13 | 14 | grdwait_bossgc_pf01_leg / grdwait_bssgc_pf01_body |
| 9 | 2 | 1 | 47 | 48 | takeoff_bossgc_pf01_leg / takeoff_bssgc_pf01_body |
| 10 | 2 | 2 | 44 | 22 | skywait / kakusan_bssgc_pf01_body |
| 11 | 2 | 2 | 44 | 23 | skywait / kakuside_bssgc_pf01_body |
| 12 | 2 | 2 | 44 | 43 | skywait / skysd_bssgc_pf01_body |
| 13 | 2 | 2 | 44 | 46 | skywait / sodatk_bssgc_pf01_body |
| 14 | 2 | 2 | 51 | 52 | tlatk_bossgc_pf01_leg / tlatk_bssgc_pf01_body |
| 15 | 2 | 16 | 44 | 17 | skywait / jyut_a_bssgc_pf01_body |

The table holds 16 rows; the 0x9a6dc0 row 1 and 2 show the "next" chain (mode 1 loop,
mode 2 = play then next, mode 3 = once and hold: ASSUMED from barbaray-map.md).

### 4.4 Form 2 states (base 0x009a7684, stride 0x18, rows 0..33; 6xA5 cap 0x23)

w0 = row of motion table 0x009a7480 (16-byte rows; see 4.5), w1 = value (+0x48c), w2 = enter fn
(PROVEN call), w3 = leader fn (ASSUMED), w4 = frame fn (ASSUMED). w0 = -1 ends the table.

| state | w0 | w1 | enter | w3 | w4 |
|---|---|---|---|---|---|
| 0 | 0 | 1 | 0x0049fe3c | 0x0049ed58 | 0x0049f694 |
| 1 | 4 | 1 | 0x0049fe24 | 0 | 0x0049ee00 |
| 2 | 1 | 1 | 0x0049fdb8 | 0x0049ee50 | 0x0049f694 |
| 3 | 0 | 1 | 0x0049fda4 | 0x0049ee8c | 0x0049ee9c |
| 4 | 2 | 1 | 0x0049fd34 | 0 | 0x0049ef1c |
| 5 | 3 | 1 | 0x0049fd34 | 0 | 0x0049ef1c |
| 6 | 2 | 1 | 0x0049fcf4 | 0x0049ef68 | 0x0049efac |
| 7..8 | 2 | 1 | 0x0049fcf4 | 0x0049ef68 | 0x0049efac |
| 9..11 | 3 | 1 | 0x0049fcf4 | 0x0049ef68 | 0x0049efac |
| 12 | 4 | 1 | 0x0049fc98 | 0x0049eff8 | 0x0049f010 |
| 13 | 6 | 1 | 0x0049fc04 | 0x0049f05c | 0x0049f070 |
| 14 | 7 | 0 | 0x0049fbbc | 0x0049f158 | 0x0049f16c |
| 15 | 9 | 1 | 0x0049fb5c | 0x0049f298 | 0x0049f2ac |
| 16..23 | 8 / 10 / 9 | 1 | 0x0049fb5c | 0x0049f298 | 0x0049f2ac |
| 24 | 11 | 0 | 0x0049fa98 | 0 | 0x0049f48c |
| 25 | 11 | 0 | 0x0049f9e4 | 0 | 0x0049f578 |
| 26 | 12 | 0 | 0x0049f8c4 | 0 | 0x0049f5fc |
| 27..28 | 13 | 1 | 0x0049f864 / 0x0049f848 | 0x0049f708 / 0x0049f6b0 | 0x0049f694 |
| 29..33 | 14 | 1 | 0x0049f824 | 0x0049f7a4 | 0x0049efac |
| 34..35 | -1 | 0 | 0 | 0x0049f7d8 / 0 | 0 |

The 6xA5 receive (0x0049e3e8) sets the object's +0x37c and +0x380 to the state, runs
`0x0049e670` / `0x0049e70c`, shifts a 0x3e4..0x3c4 history (PROVEN), then the motion row.

### 4.5 Form 2 motion rows (base 0x009a7480, 16 bytes; motion = w2, speed = w3 as float)

Used by 4.4 (w0 index). Motion index (archive) per row: 0:54 wait_bossgc_pf02_body,
1:39 sarch_bossgc_pf02_body, 2:58 walk_bossgc_pf02_body, 3:59 walkgd_bossgc_pf02_body,
4:24 kamae_bossgc_pf02_body, 5:25 kaming_bossgc_pf02_body, 6:16 jump_bossgc_pf02_body,
7:6 dpb_bossgc_pf02_body, 8:27 kiri2_bossgc_pf02_body, 9:26 kiri1_bossgc_pf02_body,
10:28 kiri3_bossgc_pf02_body, 11:2 bousou_bossgc_pf02_body, 12:1 bouend_bossgc_pf02_body,
13:57 waitvsk_bossgc_pf02_body, 14:60 walkvsk_bossgc_pf02_body. Rows 15+ are not valid.
Mode / next fields: not decoded (the 0x0049e3e8 read is `*(int*)` at +0x4ac = w0 of the row).

### 4.6 Not decoded

- The handler bodies for all rows above (82 rows: 9 + 40 + 34). Only the tables, the
  dispatch, the receive writers and some per-frame code were read. States fully mapped: 0.
  Partially mapped (table row + fn addresses, no body): 82.
- Transition conditions (who picks the next state, and on which timer or HP level).
  The 6x76 sender 0x008113e4 is called from 0x0048ce9f and 0x0048d630 (PROVEN calls, state UNCLEAR).
- The sub-state transition conditions for the controller (6xA3 is sent by someone; sender not found).

## 5. Network (PROVEN rows and handler addresses; send sites partly UNCLEAR)

6x table 0x00a0fba0 rows in the Olga range (8-byte rows: u16 cmd, u16 mask, u32 handler):

| cmd | row | handler | mask | role |
|---|---|---|---|---|
| 0x76 | 21 | 0x008117a8 | 0x0007 | generic (kill / EXP send side, UNCLEAR) |
| 0xA3 | 114 | 0x0048db6c | 0x0004 | controller sub-state 0..8 (sets +0x380, leave/enter) |
| 0xA4 | 115 | 0x00497e50 | 0x0004 | form 1 beast state 0..40 (+0x37c, motion pair) |
| 0xA5 | 116 | 0x0049e3e8 | 0x0004 | form 2 state 0..35 (+0x37c, motion row) |
| 0xAD | 117 | 0x0048cb10 | 0x0004 | trap / mine events (calls 0x00490058 / 0x00490090) |

Receive path (PROVEN): the handler looks up the entity by the u16 at +2 with `0x00786b3c`
(the same lookup Barba uses). The u8 at +4 is the state index. Range checks: A3 0..8 and the
controller only (`iVar2 == DAT_00a46f9c`), A4 0..40, A5 0..35. Sends go through 0x008003e0,
which also applies the message locally (barbaray-map.md, section 3).

Send side: 0x0048db6c is also the apply step; the matching send was not located in this pass.
Pass 2: the senders are located, see section 12.3.

Newserv (vendor/newserv/src/ReceiveSubcommands.cc:3164, 3195): on area 0x1f, flag 0x0057, the
server makes the final-boss item for OLGA_FLOW_2 (boss_enemy_type). Server-side only.

## 6. HP and stats (BattleParam; values from BattleParamEntry_lab*.dat, PROVEN)

BattleParam files: `BattleParamEntry_lab.dat` (offline) and `_lab_on.dat` (online), assumed
to be the Episode 2 set (ASSUMED, the lab files are the only ones with rows 43/44 non-zero).
PlayerStats row layout (HP = u16 at +6 of the 0x24-byte row; see battleparams.ts).

| row | name (newserv) | HP d0 / d1 / d2 / d3 (offline) | HP d0 / d1 / d2 / d3 (online) |
|---|---|---|---|
| 43 (0x2b) | OLGA_FLOW_1 (beast) | 4900 / 6300 / 8100 / 10000 | 7700 / 9800 / 18900 / 23000 |
| 44 (0x2c) | OLGA_FLOW_2 (controller) | 6500 / 6300 / 9700 / 14500 | 8500 / 12000 / 21000 / 27000 |

ATP / EVP / DFP / ATA for row 44 offline: 910/120/210/270, 1300/180/220/400, 2000/175/421/422,
3000/640/920/525. Row 43 offline: 850/150/185/300, 1300/180/220/400, 1800/210/355/500,
2700/720/810/598. (d1 HP 6300 on both rows looks odd; UNCLEAR.)

HP conflict: the beast's update reads the ratio from +0x334 / +0x346 (+0x346 is set from +0x334
in the ctor, PROVEN), not from +0x2bc. So for the beast, +0x346 is the max, ASSUMED. The shared
layout (+0x2bc max) has not been checked against the beast's damage writes. BLOCKER for HP.

## 7. Motion archive (bm_boss6 family, PROVEN names; frame counts NOT decoded)

Archive: `boss06_plotfalz_dat.bml` in data.gsl (descriptor 0x009a6c3c in enemymodels.ts).
GSL/BML parsed with the repo parsers under Node 24: 19 model entries, 62 motion entries
(`.njm`). The `models` array of the descriptor (0-based, enemymodels.ts): 0 `bossgc_laser.nj`,
1 `bossgc_pf01_kirai.nj`, 2 `bossgc_pf01_leg.nj` (leg, PROVEN by the spawn spec), 3
`bossgc_pf02_body.nj`, 4 `bossgc_pf02l_body.nj`, 5 `bossgc_pf_mag.nj`, 6 `bssgc_pf01_body.nj`
(body, PROVEN by the spawn spec); 13..16 are the `lo_` (low) variants. The BML itself holds
the `.nj` files and the `.njm` motions (the BML list is alphabetical, not the model order).

Motion list (index = the number used in 4.3 and 4.5): 0 appear_bossgc_pf01_kirai, 1 bouend_bossgc_pf02_body,
2 bousou_bossgc_pf02_body, 3 dead_bossgc_pf01_leg, 4 dead_bossgc_pf_mag, 5 dead_bssgc_pf01_body,
6 dpb_bossgc_pf02_body, 7 end_bossgc_pf02_body, 8 flow_dark_body, 9 flowend1_flow_body,
10 flowend1_flow_sord, 11 flowend2_flow_body, 12 fukatu_bossgc_pf_mag, 13 grdwait_bossgc_pf01_leg,
14 grdwait_bssgc_pf01_body, 15 hoe_bssgc_pf01_body, 16 jump_bossgc_pf02_body, 17..21 jyut_a..e
(body), 22 kakusan_bssgc_pf01_body, 23 kakuside_bssgc_pf01_body, 24 kamae_bossgc_pf02_body,
25 kaming_bossgc_pf02_body, 26..28 kiri1..3_bossgc_pf02_body, 29 land_bossgc_pf01_leg,
30 land_bssgc_pf01_body, 31 op3_bossgc_pf01_leg, 32 op3_bssgc_pf01_body, 33 op_bossgc_pf01_leg,
34 op_bossgc_pf02_body, 35 op_bssgc_pf01_body, 36 op_op_flow_mark, 37 roll_bossgc_pf01_leg,
38 roll_bssgc_pf01_body, 39 sarch_bossgc_pf02_body, 40 sidetoup_bossgc_pf01_leg,
41 sidetoup_bssgc_pf01_body, 42 skwait2_bossgc_pf01_leg, 43 skysd_bssgc_pf01_body,
44 skywait_bossgc_pf01_leg, 45 skywait_bssgc_pf01_body, 46 sodatk_bssgc_pf01_body,
47 takeoff_bossgc_pf01_leg, 48 takeoff_bssgc_pf01_body, 49 tame_bossgc_pf_mag,
50 tinmoku_bossgc_pf_mag, 51 tlatk_bossgc_pf01_leg, 52 tlatk_bssgc_pf01_body,
53 uptoside_bssgc_pf01_body, 54 wait_bossgc_pf02_body, 55 wait_bossgc_pf_mag,
56 waitside_bssgc_pf01_body, 57 waitvsk_bossgc_pf02_body, 58 walk_bossgc_pf02_body,
59 walkgd_bossgc_pf02_body, 60 walkvsk_bossgc_pf02_body, 61 wxmS02_k_m_sp_rbuki.

Frame counts: NOT decoded. The NMDM header's u32 at +4 is the chunk size (e.g. 380 for a
400-byte `appear`), not a frame count, so the galgryphon "chunk+4" reading does not hold here.
Use `client/src/formats/rel.ts` (the RelFile) to read the motion frame count. BLOCKER for
motion timing.

Model-level motion ids in 4.3 are these indices; the controller motion pair is 44/56 in
the enemymodels spec (leg skywait, body waitside), which matches row 0 and row 2 of 4.3.

## 8. Attacks, hit boxes, objects (PARTIAL)

- Trap / mine events: 0x0048cb10 (cmd 0xAD). It walks 0x40 slots of u8 flags at +4 and, for
  slots 7..0x26, calls 0x00490058 (flags 0x40 / 0x20 as args) or 0x00490090. PROVEN calls,
  not read. Newserv movement-data notes (vendor/newserv/notes/movement-data.txt:445-446) name
  these objects TBoss6Mine (form 1 trap, default damage 20) and TBoss6MagMine (form 2, must be
  > 0, default 20). ASSUMED to match the trap damage in the exe.
- Beam / FX spawns: `0x0050b7a4` (FX spawn, 14 calls), `0x00509590` and `0x00508efc`
  (PROVEN calls). Effect ids: not decoded.
- Hit radii, damage flags, hit boxes: NOT DECODED. BLOCKER for hit tests.

## 9. Particles / SE (PARTIAL)

- `0x0080575c` FX with args (0xffffa24c, 0x40a00000, 1, 1) on the beast each frame (PROVEN).
- `0x0048eb24(8, 0)` and `0x0048eb24(0, 0x22)` each frame (PROVEN call, meaning UNCLEAR).
- Effect and SE ids per state: NOT DECODED.

## 10. Death and rewards (UNCLEAR)

- The generic on-kill path 0x0051f894 is NOT called in the Olga range (PROVEN, objdump grep).
  The Barba and Gal Gryphon kill (leave of the death phase) does not apply here.
- EXP: `0x00787534` is called at 0x0048d599 (PROVEN call site; the EXP routine per Barba doc
  0x00787398 / 0x00787534). Which state and which owner gate: UNCLEAR.
- Drops: 0x005c973c not seen in the Olga range. The final-boss item is server-side (newserv, flag 0x57).
- 6x76: sent from 0x0048ce9f and 0x0048d630 via 0x008113e4 (PROVEN calls); state UNCLEAR.
- The death state: NOT LOCATED. Olga's table has no obvious death row; the beast's last row
  (39) has no frame fn. UNCLEAR.

## 11. Ready to port: NO

Blockers, in order:

1. Form 2 entity class (ctor, vtable, factory) is not located. The 6xA5 target object is
   unknown. Biggest gap.
2. Controller object size: factory allocates 0x3e8 but the ctor writes to +0x688. Layout unresolved.
3. Handler bodies for 82 state rows (sections 4.2, 4.4, 4.1). Transition conditions for all states.
4. HP field: beast ratio uses +0x346 (copied from +0x334) vs the shared +0x2bc. Confirm with a damage write.
5. Motion frame counts for the 62 motions (section 7). Use `rel.ts`.
6. Hit boxes, damage flags, the trap / mine objects (0x00490058, 0x00490090), and the beam objects.
7. Kill and reward path: which state sends 6x76 and calls 0x00787534. Death row not found.
8. Speeds and path constants (0x0090xxxx / 0x00a47xxx), and the meaning of BattleParam row 43 vs 44 usage.
9. Send sites for 6xA3 / 6xA4 / 6xA5 (only the receive side is decoded).

## 12. Pass 2 (2026-10-23): resolutions

Method: objdump greps (`calll 0x...`; byte immediates print signed: 0xa3 = `$-0x5d`, 0xa4 = `$-0x5c`,
0xa5 = `$-0x5b`, 0xad = `$-0x53`, so a grep for `$0xa5` finds nothing), `tools/ghidra/decomp.sh`, a
4-byte scan of PsoBB.exe (data pointers; file offset + 0x401460 = VA for the table area), the repo's
`bml.ts` / `njmotion.ts` parsers under Node 24. Ghidra lists the thiscall args in the wrong order for the
factories; read the disassembly for the real ECX / stack order.

### 12.1 Item 2, the 0x3e8 vs 0x688 puzzle: RESOLVED (PROVEN)

- Controller factory 0x0048d764, asm 0x48d7d0..0x48d7ef: ECX = the 0x3e8 block (iVar1); the 0x20 aux block is
  pushed as ctor param_2; the factory argument is pushed as param_3. The factory returns the 0x3e8 block.
  So the controller ctor 0x0048d814 has `this` = the 0x3e8 object.
- The controller ctor's highest written field is `param_1[0xf9]` = +0x3e4, inside 0x3e8. Its helpers
  0x48d038 (+0x37c), 0x48dafc (DAT_00a46f8c), 0x48db1c (+0x38c) also stay below 0x3e8. The ctor's first
  call `0x007865e8(param_2)` takes the 0x20 aux block, not the controller.
- The `+0x688` writes (`param_1[0x1a2] = 0`, and `param_1[0x15d..0x15f]`) are in the BEAST ctor
  0x00497580, on the 0x68c block of factory 0x004974d0. `pushl $0x68c` at 0x4974ff is the only 0x68c
  allocation in the exe. The pass-1 puzzle came from attributing the beast's layout to the controller.

### 12.2 Item 1, the form 2 entity: PARTIAL, BLOCKER

- 6xA5 handler 0x0049e3e8 (PROVEN): looks up the target by id (0x00786b3c); writes +0x37c and +0x380 = state;
  shifts the history +0x380..+0x3fc (the same shift as the beast helper 0x00494c40 and the form 2 helper
  0x0049bd50); reads the motion row from 0x009a7480 into +0x4a8 / +0x4ac / +0x4b0; calls the enter fn from
  0x009a768c (table 0x009a7684, stride 0x18). Highest offset written is +0x4cc, so the target block is at least
  0x4d0 bytes, with the beast's layout.
- Form 2 per-frame dispatch: the function whose prologue is 0x00499908 (Ghidra labels an interior
  address 0x00499928) indexes table 0x009a7694 (frame fn) and 0x009a7690 (leader fn) by state * 0x18. It uses
  the beast offsets (+0x37c, +0x4a8..+0x4cc, +0x58c, +0x5b4, +0x698, +0x794). ASSUMED: form 2 is the beast
  object, with its state set by 6xA5 and its per-frame dispatch switched to this table.
- Reachability (PROVEN by grep of the disassembly and the data scan): 0x00499908 has no direct call, no jmp and no
  4-byte pointer anywhere in PsoBB.exe. The form 2 bodies (0x49ed58 leader, 0x49fe3c enter, 0x49f694 frame,
  0x49ee00, 0x49f2ac, ...) are referenced only from table 0x009a7684. The form 2 senders 0x49b19c, 0x49b474,
  0x49b7d0 and 0x49ba80 are called only from those bodies. 0x49bd50 (state set) has 16 callers, all in the form 2
  body cluster. The 6xA5 receive path itself is reachable (table row 0xa0fba4 holds 0x0049e3e8).
- Consequence: no reachable static path runs form 2 or sends 6xA5 in this build. Either the frame dispatch
  is reached through a computed call not decoded here, or form 2 is dead code. BLOCKER. Next check: a
  runtime trace of 6xA5 traffic, or a search for indirect calls through 0x009a7694 / 0x0049ed58 offsets.
- Who spawns the beast: controller sub-state 2 enter 0x0048f2ac calls 0x0048d188 (guard DAT_00a46f98), which
  calls 0x004974d0. 0x0048f2cf is a one-instruction wrapper of 0x0048d188 with no caller.

### 12.3 Item 3, send sites (PROVEN senders; gates read from asm)

- 6xA3, controller: 0x0048d10c (`movb $-0x5d` at 0x48d127). Gate: controller +0x37c == 0 (leader). Body: `_rand()`,
  then 0x008003e0 with sub index = arg. Callers: sub-state frame A fns 0x48ee3c (arg 2), 0x48ee84 (3),
  0x48eea8 (4), 0x48ef3c (5), 0x48efec (6), 0x48f034 (7).
- 6xA4, beast: 0x00494290 (`movb $-0x5c` at 0x4942d2). Gate: owner (+0x400) +0x37c == 0. Packet: {0xa4, 5, id
  via 0x00494a78, state byte at +4 = the constant 2, 3 payload bytes from 0x0049448c or 0x00494318 (chosen by
  +0x41c)}, then 0x008003e0. Callers: beast leader 0x498484 (state 1) and the frame / leader fns at 0x4984d2,
  0x498524, 0x49898e. So the only A4 announced is state 2 (row 2 enter 0x4996a4). ASSUMED meaning: state 2 is
  the beast's re-target / attack entry.
- 6xA5, form 2: 0x0049b19c (helper; `movb $-0x5b`; gate leader; id via 0x0049b1dc; state = arg), plus inline
  sends in 0x49b474, 0x49b7d0 and 0x49ba80 (state from +0x37c, +0x43c, +0x484). Callers: form 2 bodies only,
  see 12.2 (unreached).
- 6xAD, trap / mine list: 0x0048cc04 (`movb $-0x53` at 0x48ccbf and 0x48cdd7). Byte +4 = type (0 or 1),
  then up to 4 entries of (x, z) bytes from 0x0049b750; gate 0x0052cf54 (leader); send 0x008003e0. Caller:
  0x00488dc7, outside the Olga range, not identified. The receive 0x0048cb10 matches the layout: it calls 0x0049e6b4
  and 0x0048a8e4 for the entries, then 0x00490058 / 0x00490090 for each flag slot.
- 6x76: 0x008113e4 is called from the controller dtor 0x0048ce9f (sub-states 7..8 only), from the kill routine
  0x0048d4b0 (12.7), and from 0x0048d630 (which also sets +8 |= 1).

### 12.4 Item 4, the controller's 9 sub-states (PROVEN bodies; gate fns not decoded)

Timer = +0x3d4 (frame counter), +0x3d8 = armed flag, +0x3e4 = the effect/aura object of row 4.
`0x0048d6e0(n)` = local sub-state change (leave old, set +0x380, enter new). Same logic as the 6xA3 apply.

| row | enter (w0) | frame A (w2) | frame B (w3) | body (decoded) |
|---|---|---|---|---|
| 0 | 0x48f30c: zero +0x3d4, +0x3d8 | 0x48ee3c: if gate 0x6dc358, send A3 2 | 0x48edf8 | B: timer; at 0x69 msg 0x3b4; over 300 -> `0x48d6e0(1)` |
| 1 | 0x48f2d8: msg, 0x48dc3c, 0x006bb100(0x56), 0x484294 (alloc 0x68 object) | 0x48ee3c (send 2) | 0x48ee58 | B not decoded (PARTIAL) |
| 2 | 0x48f2ac: 0x44bf4c, 0x48ea5c, +0x3d8 = 1, **0x48d188 = beast spawn** | 0x48ee84: gates 0x48e5a0 and 0x6dc358, send A3 3 | 0 | |
| 3 | 0x48f26c: 0x48d3c0, 0x48cfbc, 0x815434, 0x48dc3c, 0x484830 (alloc 0x90 object) | 0x48eea8: gate 0x6dc358, send A3 4 | 0x48eec4: timer >0xf7 -> `0x48d464(0, t)` fade; over 0x101 -> `0x48d6e0(4)` | |
| 4 | 0x48f234: 0x48dc74, 0x48d440, msg 0x00900f68 (HALL), 0x48ea5c, **+0x3e4 = 0x484d90** (alloc 0x88, effect 0x225) | 0x48ef3c: if +0x3e4 and (gate 0x7a6d98 or 0x6dc358), send A3 5 | 0x48ef6c: fade timer; at 0x2d 0x44bf4c | |
| 5 | 0x48f1e4: free +0x3e4 (set flag |1), 0x48dc3c, 0x815434, msg, **0x485668** (alloc 0xf0) | 0x48efec: gate 0x6dc358, send A3 6 | 0x48f008: timer over 0x198 -> `0x48d6e0(6)` | |
| 6 | 0x48f1c0: 0x44bf4c, 0x48ea5c, zero timers, 0x48d2a4 | 0x48f034: gate 0x48e560 or 0x6dc358, send A3 7 | 0 | |
| 7 | 0x48f120: target copy (DAT_00a46f94), 0x48d400, 0x48cfe0, 0x815434, 0x48dc3c, msg 0x57, 0x491c64, **0x48619c** (alloc 0xb4) | 0 | 0x48f058: if gate 0x6dc358 timer = 0x2ca; over 0x2ca: if gate 0x44bd78 -> `0x48d6e0(8)`, else **kill 0x48d4b0** | |
| 8 | 0x48f100: 0x48dc3c, zero timers, 0x67ab80 | 0 | 0x48f0b8: timer over 0x1c6 -> **kill 0x48d4b0** | |

Gate fns not decoded: 0x6dc358 (used in 8 rows), 0x48e5a0, 0x48e560, 0x7a6d98, 0x44bd78, 0x52cf54 (leader role).
Objects created by the sub-states (all with controller as owner): 0x484294 (0x68), 0x484830 (0x90), 0x484d90 (0x88),
0x485668 (0xf0), 0x48619c (0xb4). None is 0x68c or larger, so none is the form 2 target.

### 12.5 Item 5, state bodies: 12 of 82 fully decoded (PARTIAL)

- Controller sub-states: rows 0, 2, 3, 4, 5, 6, 7, 8 full (enter, frame, transition); row 1 PARTIAL (frame B 0x48ee58).
- Beast (form 1, table 0x9a70a4):
  - state 0, entrance wait: enter 0x49978c (timer 0x5a, `0x4970a0(1)`); frame 0x49844c (timer end -> `0x494c40(1)`).
  - state 1, entrance hold: enter 0x499728 (timer = 0x5a or the motion-row length, `0x4970a0(0)`, `0x497104(1)`);
    leader 0x498484 (form flag 0x41c == 0 -> `0x494ae0(0x17)`, or the random check then the A4 send state 2, else
    `0x494678`); frame 0x498554 (timer end -> `0x494c40(0x27)`).
  - state 24, idle / pre-attack: enter 0x49943c (timer 0x5a, `0x497e20`, `0x4970a0(0)`, `0x497104(1)`); leader 0x4988d4
    (timer 0 -> `0x494ae0(0x19)`); frame 0x4988e8 (`0x496d4c`, timer end -> `0x494c40(0x27)`).
- Form 2 (table 0x9a7684): state 0 full. Enter 0x49fe3c (+0x474 = +0x478 = 0x5a). Leader 0x49ed58 (when timer +0x478 is 0,
  chooses from gates 0x49c758, 0x49ccb4, 0x49c860, 0x49ca9c, 0x49c788, 0x49a464, 0x49a4e0, then `0x49b19c` sends A5
  with state 0xd, 0x18, 0xe, 2 or 1; the branch conditions are UNCLEAR beyond these gates). Frame 0x49f694 (timer -1 -> `0x49bd50(0x22)`).
- `0x00494c40(n)` (beast state set) is local only: no send inside it, and the only A4 sender is 0x494290 (PROVEN).
- The death row: the beast's row 39 (= 0x27, reached by timers from rows 1 and 24) has no frame fn. It is the
  exit state, not a death. The death itself is the controller kill (12.7).

### 12.6 Item 6, motion frame counts (ASSUMED: header frameCount, from parseNjmFile with nodeCount 1)

Read from data.gsl `boss06_plotfalz_dat.bml`: 61 of 62 `.njm` parse. Index: frames (the list of section 7 gives the names)
0:10 1:60 2:60 3:180 4:30 5:180 6:60 7:500 8:500 9:20 10:20 11:21 12:30 13:30 14:30 15:60 16:24 17:20 18:20 19:10
20:20 21:10 22:30 23:30 24:30 25:30 26:30 27:30 28:30 29:30 30:30 31:350 32:350 33:285 34:285 35:285 36:285 37:20
38:20 39:30 40:30 41:30 42:30 43:30 44:30 45:30 46:30 47:30 48:30 49:30 50:30 51:30 52:30 53:30 54:30 55:30 56:30
57:30 58:30 59:30 60:30. Motion 61 (`wxmS02_k_m_sp_rbuki.njm`) throws "motion keys at 0x39c out of range" with
nodeCount 1: UNCLEAR (it is probably a multi-node motion; re-run with the model's node count).
Playback speed is not verified. Several values are round (30, 60, 180), which suggests a placeholder for some.

### 12.7 Item 7, death, kill and rewards (PROVEN routine, gates UNCLEAR)

- Kill routine = controller 0x0048d4b0. Callers: sub-state 7 frame B (0x48f058) and sub-state 8 frame B (0x48f0b8),
  after their timers. It runs: gate 0x00491d74 (on true: msg 0x3e5 and a 0x50b510 effect on each object with +0x3ec
  == 0x1f); copy the target from DAT_00a9c4f4 (`0x0068d5a8`) into +0xc0..+0xc2, +0xe, +0xf, +0x10, +0x2 ... ; `0x00787534`
  (EXP, same routine as Barba / Gal); `0x00787710(0x800)`; vtable slot 81 (0x144/4); `0x008113e4` (6x76); sets
  this+8 |= 1 (dead flag).
- The generic on-kill 0x0051f894 is not called in the Olga range (PROVEN, objdump). Olga's kill is 0x48d4b0 instead.
- Gates for the kill: 0x44bd78 (decides sub-state 7 -> 8 or the kill) and 0x6dc358 (sends / timer). UNCLEAR.
- Drops: 0x005c973c not in the range. The final-boss item is server side (newserv, flag 0x57).

### 12.8 HP (partial, section 6 updated)

- Beast ctor 0x00497580 sets `short +0x346 = short +0x334` (PROVEN). The beast per-frame 0x492a84 sets
  +0x4e0 = (short +0x334) / (short +0x346) (PROVEN). The form 2 per-frame body ends with +0x510 = +0x334 (PROVEN).
  So +0x334 = current HP, +0x346 = max copy. ASSUMED. The shared +0x2bc max is not checked.

### 12.9 Ready to port: NO

Blockers after pass 2:

1. Form 2 dispatch is unreached (12.2). No static call, jmp or data pointer to 0x00499908. Biggest gap.
2. Gate fns not decoded: 0x6dc358, 0x48e5a0, 0x48e560, 0x7a6d98, 0x44bd78, 0x52cf54, 0x491d74, 0x48d464, 0x48d2a4.
3. 70 of 82 state bodies not decoded. Missing beast states 2..23, 25..39 and form 2 states 1..33 (only the state table
   and some enter / frame fns are known).
4. Controller sub-state 1 frame B 0x48ee58 not decoded.
5. HP: +0x334 current and +0x346 max are ASSUMED; the shared +0x2bc max has not been checked.
6. Motion frame counts: header values only, playback not verified, motion 61 unresolved.
7. Hit boxes, speeds, path constants, reward amounts and effect ids not decoded.
8. The beast state 2 (the only A4 announced) and 0x494ae0 / 0x494678 (transitions) not decoded.

Tags used: PROVEN, ASSUMED, UNCLEAR, BLOCKER.
