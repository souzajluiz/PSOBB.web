# Gal Gryphon: script layer (state records, pattern table, opcodes, HP source)

Scope: how the Gal Gryphon (TBoss5Gryphon, Ep2) picks its next state and its attack pattern.
Companion to `galgryphon-states-a.md` (states 0..17) and `galgryphon-states-b.md` (states 18..34).
Read-only reading of PsoBB.exe; no code change.

Legend: **PROVEN** = read from the named decompile (`refsrc/original-psobb-client-source/src/Psobb.exe-5-10-2026.c`,
names are ours), exe bytes (`tools/exedata.py`, objdump), or Ghidra headless. **ASSUMED** = inferred
from names or patterns. **UNCLEAR** = not decoded.

## 0. Corrections to the earlier docs

1. **Byte offsets.** Ghidra prints `param_1[N]` on an `int*`, so `[0x132]` is byte `0x4c8`,
   `[0x13a]` is `0x4e8`, `[0x13b]` is `0x4ec`, `[0xcd]` is `0x334`. PROVEN by objdump of `0x004a7360`
   (`movl 0x4c8(%ecx)`, `movswl 0x334(%ecx)`). The -b doc's `+0x132` flags are byte `0x4c8`; its
   `+0x13a` leader flag is byte `0x4e8`; its `+0x13b` "movement mode" writes are byte `0x4ec`, the
   **stage** byte (ASSUMED).
2. **`+0x4c4` is not fed by `0x004a7390` / `0x004a771c`.** Those walk the pattern stream at `+0x77c`.
   The `+0x4c4` record list is seeded in the ctor and overwritten by sync event 0xA0 (section 1.3).
3. **HP gate `0x004a7360`** (PROVEN): runs the pattern (`0x004a7390`) only when `(flags 0x4c8 & 0xc) == 0`
   and short `+0x334` (cur HP) `<= 0`; otherwise `ProcessState(state, 9)`. This is the literal code.
   It contradicts the HP-ratio branch in `0x004a771c`; see section 4.3.
4. **HP fields** are `+0x2bc` (max), `+0x334` (cur), `+0x2be` (MST). The -b doc's "`+0x2bc = 700`" is
   not from the stats file (section 4).
5. `FUN_007aabd8` returns the motion frame (coordinator correction, states-a); the -b doc's "progress" = frame.

## 1. Record layouts

### 1.1 State record, 0x14 bytes (PROVEN)

| off | type | meaning |
|---|---|---|
| +0x00 | short | state index. The new state when this record becomes current |
| +0x02 | short | duration in ticks, counted down by `0x004a7de8` (not while state == 4). `0xffff` (-1) never expires |
| +0x04..+0x13 | 16 bytes | not read by the state handlers. Written by the 0xA0 receiver (+0x18..+0x24 go to `this+0x4a0..0x4ac`) |

Cursor: `this+0x4c4` (pointer). `0x004a7e20` (advance): `old = cursor; cursor = old + 0x14; new = *(short*)(old+0x14)`;
if `new != state` -> `0x0051f62c(new)` (exit old state phase 5, enter new phase 4, set `+0x32e`).
Note the new state is read from the record now at the cursor, so the cursor record is the current one.

Seed (PROVEN, `galgryphon_constructor`): `cursor = this+0x49c`; records at `+0x49c` and `+0x4b0` are
set by `initialize_gal_gryphon_action_subcommand` to `{state 0x21 (= S33), duration 0xffff}`.

### 1.2 Pattern op, 0x48 bytes (PROVEN field use; names ASSUMED)

Stream cursor `this+0x77c`, advanced +0x48 per op except op 0x22. Pattern table pointer `this+0x780`.

| off | type | use |
|---|---|---|
| +0x00 | u32 | opcode (0x00..0x22 valid) |
| +0x04 / +0x06 | short / short | min / range of the generic roll `ROUND(min + rand*range)` (`0x004a8c9c`) |
| +0x08 | int | type: branch type for op 0x21; selector for 0x0a (`t`); sign for 0x09 |
| +0x0c | int | range for 0x0a's type roll |
| +0x10 / +0x14 | int / int | min / range of the count roll (0x09: count; 0x0a: ROUND base) |
| +0x28 / +0x2c | float | min / range (0x08 `out.+8`, 0x09 `out.+0xc`, 0x0a `out.+0xc`, 0x0e `out.+8`) |
| +0x30 / +0x34 | float | min / range (0x09 `out.+0x10`, 0x0a speed, 0x0e squared term) |
| +0x38 / +0x3c | float | 0x0a type-1 xz pair |
| +0x40 | float | not read by any decoded handler; in the data this is 700.0 / 400.0 / 300.0 / 320.0 (ASSUMED: HP or distance band for the record) |

Resolved op (filled by `0x004a8c9c` and the handler, then sent): `+0x00` op (ushort), `+0x02` generic roll (short),
`+0x04` int, `+0x08`, `+0x0c`, `+0x10`. The send (`0x004a7b28`, PROVEN) is event header `0xa0`, length `0x0a`,
entity id (`this+0x1c`), pos `+0x38/+0x3c/+0x40`, heading `+0x60`, through `0x008003e0`.

### 1.3 Sync event 0xA0 (PROVEN)

Subcommand table `0x00a0fba0` (stride 8: u16 id, u16 mask, fn): entry `0xa0 -> 0x004a7034`
(`SyncPlayerToEntityTransform`). Packet: u16 entity id @2, float pos @4/@8/@0xc, heading @0x10,
then the state record bytes @0x14..0x27 (one 0x14 record). The receiver sets pos and heading, copies
the record to `this+0x49c`, sets cursor = `+0x49c`, and if the state differs calls `0x0051f62c`.
So a follower takes its state record from this event. UNCLEAR: which side builds the 20-byte tail;
the sender `0x004a7b28` only sends id, pos, heading.

## 2. Where the scripts live

### 2.1 State records

Seed: 2 records, both S33 with infinite duration (section 1.1). No other writer of the `+0x4c4` list
exists in the named dump. Each 0xA0 receipt resets the list to one incoming record, so a follower
holds one record at a time. UNCLEAR: the authority's record source (it sends the state, so it must
decide it). Not found in the exe under these names.

### 2.2 Pattern table and arrays (PROVEN bytes)

Table `0x009ab820` = `g_pGalgryphonNullVtable`; the ctor sets `this+0x780 = &that`. 29 slots at
`+0x00..+0x70` (step 4), all non-null. Arrays are in `.data` (0x009a81c0 .. 0x009ab8xx). 188 op records
in all, decoded until the first 0x21 (branch) or 0x22 (hold).

Stage entry (PROVEN, `0x004a7390`): stage `this+0x4ec` 1 -> slot `+0x68`; 3 -> `+0x6c`; 2 -> `+0x70`;
other -> `+0x64`. Fallback when the cursor is null (`0x004a8d0c`): 1 -> `+0x08`, 3 -> `+0x60`, 2 -> `+0x5c`, other -> `+0x40`.

Slot list (`Bn` = branch with type n, `Hd` = hold; op names: `nXX` = no handler, the rest are decoded opcodes):

| slot | records | ends | ops (until end) |
|---|---|---|---|
| +00 | 6 | B0 | n00 n0c n0d 0e n10 B0 |
| +04 | 22 | B0 | 09 0a 0a n1d 1e 1b 0a 0a n1d 1e n20 0a 0a n1d 1e n20 0a 0a n1d 1e n20 B0 |
| +08 | 7 | B1 | 09 n07 09 n07 09 n07 B1 |
| +0c | 7 | B1 | 09 n07 09 n07 09 n07 B1 |
| +10 | 5 | B1 | 09 n07 09 n07 B1 |
| +14 | 6 | B2 | 0a 0a n0c n0d n10 B2 |
| +18 | 5 | B3 | 0a 0a n0c n0f B3 |
| +1c | 6 | B2 | 0a 0a n11 n0d n13 B2 |
| +20 | 5 | B3 | 0a 0a n11 n12 B3 |
| +24 | 4 | B3 | 0a n1d 1e B3 |
| +28 | 4 | B3 | 0a 0a n0b B3 |
| +2c | 9 | B4 | n17 n18 n1f n17 n18 n14 n15 n16 B4 |
| +30 | 9 | B4 | n17 n18 n1f n17 n18 n1a 1b n1c B4 |
| +34 | 9 | B4 | n17 n18 n14 n15 n16 n17 n18 n1f B4 |
| +38 | 8 | B4 | n17 n1a 1b n1c n17 n18 n1f B4 |
| +3c | 8 | B4 | n17 n1a 1b n1c n14 n15 n16 B4 |
| +40 | 2 | B5 | n02 B5 |
| +44 | 5 | B5 | n02 n17 n18 n1f B5 |
| +48 | 8 | B5 | n02 n17 n18 n14 n15 n16 n02 B5 |
| +4c | 6 | B5 | n17 n18 n14 n15 n16 B5 |
| +50 | 14 | B5 | n17 n18 n14 n15 n16 n17 n18 n1f n17 n18 n14 n15 n16 B5 |
| +54 | 15 | B5 | n17 n18 n14 n15 n16 n17 n1a 1b n1c n17 n18 n14 n15 n16 B5 |
| +58 | 2 | B6 | n06 B6 |
| +5c | 2 | B0 | n10 B0 |
| +60 | 2 | B0 | 1e B0 |
| +64 | 3 | Hd | n06 n05 Hd (stage "other", the default entry) |
| +68 | 2 | Hd | n05 Hd (stage 1 entry) |
| +6c | 4 | Hd | 1e n06 n05 Hd (stage 3 entry) |
| +70 | 3 | Hd | n10 n05 Hd (stage 2 entry) |

The 0x00-op records that carry data (700.0 / 400.0 at +0x40, 0.8 / 0.7 at +0x38) are no-op steps
that hold HP-band constants for the 0x0a records. ASSUMED.

### 2.3 Per difficulty / phase / HP band

PROVEN: one pattern table, one entry per stage. No per-difficulty or per-HP-band arrays exist in
the table. Difficulty enters through battleparams (section 4). HP enters only through the type-1
branch (section 3.2).

## 3. Branching and the opcodes

### 3.1 Branch 0x21 (PROVEN, `0x004a771c`)

`type = record+0x08`; `r = rand()/32768.0`. The cursor is set to `this+0x780 + offset`. The loop in
`0x004a7390` repeats while the record at the cursor is 0x21.

| type | rule | target offsets |
|---|---|---|
| 0 | r < 0.6 -> +08; r >= 0.9 -> +10; else +0c | 08 / 0c / 10 |
| 1 | section 3.2 | 14 / 18 / 1c / 20 / 24 |
| 2 | r >= T924[P] -> +28; else +24 | 24 / 28 |
| 3 | r < 0.3 -> +2c; r < 0.4 -> +30; r < 0.6 -> +34; r < 0.8 -> +38; else +3c | 2c..3c |
| 4 | r < 0.2 -> (P<2 ? +40 : +4c); r < 0.6 -> (P<4 ? +44 : +50); else (P>5 ? +54 : +48) | 40..54 |
| 5 | +58 | 58 |
| 6 | +10 | 10 |

`P` = player count (`DAT_00a47640+0x28`). Constants (PROVEN exe bytes): `0.9 / 0.8 / 0.4 / 0.3 / 0.6 / 0.2` at
`0x903ba4 / ba8 / bac / bb0 / bb4 / bb8`; `T924[P]` at `0x903924` = {0,0,0,0,0.2,0.3,0.4,0.5} for P = 0..7;
`T900[P]` at `0x903900` = {0,0,0.1,0.2,0.2,0.3,0.4,0.4}; rand scale `0x903bbc` = 32768.

### 3.2 Type 1, the HP branch (PROVEN)

Flag `0x200` in `0x4c8` (ASSUMED "rolled this step"). If set and P > 4: clear it, go to +24. Else set it;
if `r < T924[P]`: +24. Otherwise `hp = cur/max` (short `0x334` / short `0x2bc`), `r2 = rand`:
`r2 < T900[P]` -> (`hp <= rand` ? +20 : +1c); else (`hp <= rand` ? +18 : +14).

### 3.3 Generic roll (PROVEN, `0x004a8c9c`)

`out.op = rec.op`; `out.roll = ROUND(rand/32768 * rec.range16 + rec.min16)`.

### 3.4 Opcode table `0x009a7f60` (PROVEN)

35 entries, opcodes 0..34, stride 8 `{fn, adj}`, index `op*8` (the code's `gal_gryphon_actions_ARRAY_009a7f58[op+1]`).
Dispatch (`0x004a7390`, PROVEN): call `fn` when `fn != 0` (the sentinels `0x903c48`/`0x903c4c` are 0).
Null entries are no-ops: the cursor still advances (+0x48) and the 0xA0 event is still sent.

Handlers: only 6 non-null entries exist.

| op | handler | effect on the resolved op |
|---|---|---|
| 0x08 | 0x004a61e8 | `out.+4 = f(rec,1) * f(rec,0)` (helpers 0x4a6250 / 0x4a62b4, UNCLEAR); `out.+8 = rec.f28 + rand*rec.f2c` |
| 0x09 | 0x004a6308 | `out.+4 = ROUND(rec.i10 + rand*rec.i14)`; `out.+0xc = rec.f28 + rand*rec.f2c`; `out.+0x10 = rec.f30 + rand*rec.f34`; `out.+8 = sign(rec.i8)` (>=1: 1; <0: -1; 0: rand >= 0.5 ? 1 : -1) |
| 0x0a | 0x004a6410 | `t = ROUND(rec.i8 + rand*rec.i0c)`. t == 0: `speed = rec.f30 + rand*rec.f34`, `out.+4/+8 = speed * (cos, sin)` of the heading from pos (fpatan). t == 1: `out.+4 = rec.f30+rand*f34`, `out.+8 = rec.f38+rand*f3c`. Both: `out.+0xc = rec.f28 + rand*f2c`; `out.+0x10 = ROUND(rec.i10 + rand*rec.i14)` |
| 0x0e | 0x004a65f0 | `out.+0xc = (rec.f30 + rand*rec.f34)^2`; `out.+8 = rec.f28 + rand*rec.f2c`; `out.+4 = f(rec,1)*f(rec,0)` |

The non-null entries are at opcodes 0x08, 0x09, 0x0a, 0x0e, 0x1b and 0x1e. The last two share one handler:

| op | handler | effect |
|---|---|---|
| 0x1b | 0x004a668c | `out.+4 = ROUND(rand/32768 * 4294967296.0)`: a random 32-bit value (ASSUMED a BAMS heading) |
| 0x1e | 0x004a668c | same |

Every other opcode in 0..34 (0x00..0x07, 0x0b..0x0d, 0x0f..0x1a, 0x1c, 0x1d, 0x1f..0x20) is a null
entry, i.e. a no-op step. Special-cased outside the table: 0x21 = branch (section 3.1), 0x22 = hold
(cursor not advanced; the event is still sent).

Counts: 35 opcodes total; 8 have semantics (6 handler opcodes including the two 0x668c ones, plus
0x21 and 0x22); 27 are null no-ops in the table. Helper 0x4a6250/0x4a62b4 (op 0x08's count) and
the 0x4a7b28 event payload meaning are UNCLEAR.

## 4. HP and the battleparams source

### 4.1 Index chain (PROVEN, exe bytes at the named globals)

| global | addr | value |
|---|---|---|
| `g_pGalgryphonStatsIndex` | 0x009a8108 | 30 |
| `g_pGalgryphonResistsIndex` | 0x009a80f0 | 30 |
| `g_GalgryphonAttackIndices` (5 entries) | 0x009a80f4 | 30, 31, 32, 33, 34 |
| `galgryphon_animation_speeds_bps_indices` (3) | 0x009a80e4 | 30, 31, 32 |
| `g_GalgryphonBattleParamsIndex` | 0x009a813c | 0 (the attack entry used by the ctor) |

Loader `init_galgryphon_global_config`: `galgryphon_bp_stats = get_battleparams_stats(30)` =
`g_pBattleparamsStats->stats + 30`. The shared enum has `boss_galgryphon = 30` (`bosses.h` /
the enum near line 68703 of the named dump). So the port reads **BattleParam stats entry 30**, attack entries
30..34, resist entry 30, animation speed entries 30..32 (the shared BattleParam tables; these match the
`ep1_DarkGunner__ep2_GalGryphon__ep4_YowieDesert = 30` enum in other places).

### 4.2 Where HP is written (PROVEN)

Ctor (`galgryphon_constructor`, `0x004a67c0`): calls `set_enemy_stats_from_battleparams_` (`0x00520c70`),
which calls `0x007868f8(stats, attacks, resists)` and then copies `+0x334 -> +0x346`. `0x007868f8` sets:

- `+0x2bc = stats.hp + (short)stats.unknown_hp_mst_modifier` (stats `hp` is word at byte +6; the modifier is the int at +0x18). Max HP.
- `+0x334 = +0x2bc` (cur HP = max at load), `+0x346 = +0x2bc`.
- `+0x2be = stats.mst + modifier` (MST), `+0x336 = +0x2be`, unless flag `0x2e8 & 4` (then both 0).
- `+0x2cc..+0x2fe` attack and resist copies from the attack/resist tables.

So the HP pool = BattleParam stats entry 30, field `hp`, plus the modifier. The HP value itself is not
in the exe (it is in the BattleParam file, the port's `BattleParamEntry` table index 30). The 700 seen in
the pattern records is a script constant, not the stat (ASSUMED). Damage writes to `+0x334` are UNCLEAR.

### 4.3 The HP gate contradiction

The gate `0x004a7360` (section 0.3) runs the pattern only when cur HP `<= 0`. The branch in `0x004a771c`
(type 1) reads `hp = cur/max` as a weight during the pattern. Both cannot be the live behaviour for an
alive boss. Literal reading: the pattern is a death-time or reset-time script. ASSUMED that the
ratio branch is then always the `hp <= rand` side. UNCLEAR which is right; the reading of the gate
(`jle` on `movswl 0x334`) is PROVEN, the meaning is not.

## 5. State graph (states 0..34)

Exit mechanisms, from the callers of `0x004a7e20` (advance) and `0x0051f62c` (change state) in the
Gryphon range (PROVEN call sites, `objdump`):

- **Advance on the handler's own end test** (calls `0x004a7e20`): S5, S6, S7, S10, S11, S12, S15, S16,
  S17, S18, S19, S20, S22, S23, S25, S26, S28, S29, S31, S32.
- **Direct change** (calls `0x0051f62c`): S3 at `0x004a2786` (to S11, per states-a). Frame path
  `0x004a70c8` (inside `SyncPlayerToEntityTransform`, section 1.3).
- **Script duration only** (no exit call in the handler; the duration countdown `0x004a7de8` advances):
  S21, S24, S27, S30, S33 (also S1, S2, S8, S9, S13, S14 and S34 have no exit call; S34 is the
  remove state, a dead end).
- **S4** (entry state): no exit call, excluded from the countdown. It leaves only on a 0xA0 record
  from the authority or an outside change. This is a blocker: the seed record is S33 with infinite
  duration, so a lone boss stays in S4 forever in this code.

Successors (what follows what): the code does not name them. They come from the 0xA0 record stream
(section 2.1). The known pairs from the -b doc (ASSUMED from the record flags): S20 -> S21 (takeoff chain into walk),
S23 -> S24 (chain 14), S26 -> S27 (chain 17), S29 -> S29 chain 20. The per-state list for 0..34:

| state | handler | exit mechanism | known successor (ASSUMED) |
|---|---|---|---|
| 0 | 0x004a8e34 | empty | none |
| 1 | 0x004a0d8c | none in handler | outside / record |
| 2 | 0x004a0dd8 | none in handler | outside / record |
| 3 | 0x004a2744 | direct change to S11 (`0x004a2786`) | S11 |
| 4 | 0x004a22b0 | none; entry state | outside / record |
| 5 | 0x004a2008 | advance at `0x004a229e` (after its 50-tick death hold) | next record |
| 6 | 0x004a1368 | advance at `0x004a145d` | next record |
| 7 | 0x004a1678 | advance at `0x004a1714` | next record |
| 8 | 0x004a19c8 | none | outside / record |
| 9 | 0x004a1a64 | none | outside / record |
| 10 | 0x004a1be0 | advance at `0x004a1cbc` | next record |
| 11 | 0x004a1d3c | advance at `0x004a1e6f` | next record |
| 12 | 0x004a27c8 | advance at `0x004a299d` | next record |
| 13 | 0x004a2ae0 | none | outside / record |
| 14 | 0x004a344c | none | outside / record |
| 15 | 0x004a36e4 | advance at `0x004a3843` | next record |
| 16 | 0x004a38f8 | advance at `0x004a3b20` | next record |
| 17 | 0x004a3c08 | advance at `0x004a3ddd` | next record (S26 chain) |
| 18 | 0x004a3f20 | advance at `0x004a4074` | S20 (runin) ASSUMED |
| 19 | 0x004a4170 | advance at `0x004a43ab` | next record |
| 20 | 0x004a4468 | advance at `0x004a449b` | S21 (walk) ASSUMED |
| 21 | 0x004a44d0 | none (duration only) | next record |
| 22 | 0x004a487c | advance at `0x004a4998` | next record |
| 23 | 0x004a4a08 | advance at `0x004a4a9c` | S24 (chain 14) ASSUMED |
| 24 | 0x004a4b9c | none (duration only) | next record |
| 25 | 0x004a4c20 | advance at `0x004a4c7b` | next record |
| 26 | 0x004a4cd8 | advance at `0x004a4d33` | S27 (chain 17) ASSUMED |
| 27 | 0x004a4d6c | none (duration only) | next record |
| 28 | 0x004a5530 | advance at `0x004a5591` | next record |
| 29 | 0x004a55c8 | advance at `0x004a5694` | S30 / next record |
| 30 | 0x004a5734 | none (duration only) | next record |
| 31 | 0x004a5eec | advance at `0x004a6025` | next record |
| 32 | 0x004a606c | advance at `0x004a60be` | next record |
| 33 | 0x004a6120 | none (duration only) | next record |
| 34 | 0x004a61bc | none; removes the boss | terminal |

The advance addresses are the call sites in the Gryphon range. States 0..17 need the other
agent's handler reads; this table is only the exit mechanism. S5 vs S26 for death: S5 advances to the
next record at its end (after the 50-tick hold of `0x31`); S26 advances on the chain. Both are
advance states; which one the seed script enters on death is UNCLEAR.

### 5.1 Coordinator questions

- **Who calls S3's phase 3:** no phase-3 dispatch exists in the Gryphon range (the only dispatch
  in `0x004a7360` is phase 9 at `0x004a7381`). Phase 3 comes from outside via `vtbl+0x164` (base
  enemy code or the `handle_galgryphon_behavior` wrapper). UNCLEAR which caller.
- **Exits of S1, S2, S8, S9, S13, S14:** none in the handler code (table in 5). UNCLEAR.
- **`DAT_00a47564`** (hover height, `g_GalgryphonDefaultY`) and **`DAT_00a47568/6c/70/74`** (fire
  frames) and **`DAT_00a47590`, `DAT_00a475a8`, `DAT_00a475ac`**: all in `.bss` (`0xa47564` is "not in an
  initialised section" per exedata). The named dump has **no writer** for any of them. Value
  0.0 unless a writer exists outside the dump. UNCLEAR; treat as 0 for a first port and flag it.
- **Consumer of `FUN_006ff5f8` queue** (tags 0x1c/0x60/0x80/0xa0/0xc0/0xe0): not decoded.

## 6. What still blocks a port

**Correction (2026-10-23, DEVLOG):** item 1 below is wrong for the leader. The leader picks its
states locally (the default list from S4, RNG and the table) and its packet loops back through the
local 0xA0 dispatch; only followers take records from the network. The HP gate (4.3) runs the death
script once. Ported in `client/src/combat/galgryphonscript.ts`; the state handlers are still open.

1. **Authority's record stream.** Who builds the 0x14 records that come in over 0xA0, and from what
   table. Only the seed (S33, infinite) is found. Until that is known, the state graph is not.
2. **HP gate vs HP ratio** (section 4.3). Which one is live.
3. **Runtime BSS globals** (section 5.1): hover height, fire frames, the `0x00a475xx` set.
4. **Opcode helper internals** (0x4a6250, 0x4a62b4) and what the resolved op does in the attack
   code (the attack dispatch `0x004a47a8` and the spawn functions are in the -b doc).
5. **S5 vs S26 death entry** and the death sends (6x76, EXP) are in the -b doc, not resolved here.

## 7. Completeness

- Scripts: 29 pattern slots, 188 op records decoded (all records until branch or hold). 1 state seed
  (2 records). State records from the network: UNCLEAR.
- Opcodes: 8 of 35 with semantics (6 handler entries + 0x21 + 0x22); 27 null no-ops.
- Branch rules: all 7 types (0..6) decoded.
- HP source: located (stats index 30, field hp + modifier); the stat values are in the BattleParam file, not the exe.
- State graph: exit mechanism for all 35 states; successors are data-driven and UNCLEAR.
