# Gol Dragon: exe map

Mapped 2026-10-22 from PsoBB.exe (Ephinea 1.25.13, VAs). Episode 2 boss, area 0x21,
floor 15. Model and motions exist in the port (`formats/enemymodels.ts` case 0xcc);
no brain is attached (`render/combat.ts`). "dump" is `original-psobb-client-source`
(names often wrong). Tags: ASSUMED, UNCLEAR. Offsets `+N` are byte offsets from the
entity (`param_1[N/4]` in the decompile); `+0xb8` = short motion slot at `+0x2e`.

## Port status (2026-10-22, client/src/combat/goldragon.ts)

Ported: the brain frame (leader step, roar, death, the phase 9 pick), the sequence
cursor with the 0x21 / 0x22 sentinels, the hit clamp at +0x682, the 6xA8 codec and the
follower's applyRemote, the 7 body boxes, the motion slots (28 rows), the kill on the
leave of 0x15, and the states 0x00, 0x02, 0x03, 0x04, 0x05, 0x06 (lunge profile),
0x07 (the 3-fireball volley), 0x0d, 0x0e, 0x15, 0x16, 0x17, 0x1e (entrance).
The other states use the ASSUMED fallback (plays its slot, 120 ticks, then the pick).

ASSUMED: the roar share f (DAT_00a48508+8, runtime) = 90; the lunge's dist / vmax;
the death motion speed (table 0); the body box flags (0x8003); the 6xA8 variant byte's
use; the walk's step; the fireball ids / power (the Dragon's).

OPEN (not ported): the derived extras (vtable 0x00afbc20, flag 0x40, sequence C in use,
ctor 0x004cede4); the 4 child objects (+0x6e4, the 0x17 state drives them, so 0x17 holds
with no exit); the breath area hit (FUN_004cfc08 at +0x38, radius 100) and its flames;
the pad / dragon control (+0x1d7, DAT_00a485f8) states 0x01 and the phase 2 / 0xb sends;
+0x680 (the 90 % loop: written by the ctor, its reader not found); the kill's gate
+0x12008 (ctor, table DAT_00ab02b8); the rewards internals (0x0051f894); MovementData
row of the Gol (not read).

Blockers resolved since the first map: hit boxes (below), sids 0x10 / 0x11 (below),
states 0x01..0x07 (re-read below), the motion names (verified against the archive).

## Identity and object model

| item | value | source |
|---|---|---|
| enemy type id | 0x00cc, class `TBoss8Dragon` | `enemyids.ts` (+5 derived entities, count `1 + 5`) |
| factory | 0x004cb404 | table row 0x009fcc8c (id 0xcc, factory at +4); calls ctor with `0x8b4` bytes |
| ctor | 0x004cb480 (`__thiscall`, arg = spawn index) | factory and derived ctor both call it |
| vtable (base) | 0x00afb860 | ctor stores it at entity+0 |
| derived "extras" | ctor 0x004cede4, vtable 0x00afbc20 | writes flag `+0xf2 |= 0x40`, `+0x682 = 0xffff`, `+0x334 = +0x2bc = arg` |
| state dispatch | 0x004cd248 (vt+0x164): `table[sid](phase)` | table 0x009ac260, 8-byte records (handler, unused) |
| per-frame | vt+4 = 0x004cbf68 (update) | |

Vtable slots (only the ones seen): +0x04 update 0x004cbf68, +0x08 0x004cca58,
+0x0c 0x004cd030, +0x88 0x00777ba4 (ASSUMED: is-hit / alive query),
+0xac 0x007782b4, +0xb0 0x00778580 (ASSUMED generic enemy move/anim),
+0x100 0x0061cdb0 (hp delta, generic), +0x164 0x004cd248 (dispatcher),
+0x168 0x004c0250, +0x174 0x0052039c, +0x178 0x005203fc, +0x17c 0x0052045c,
+0x180 0x005204b0, +0x184 0x00520504, +0x188 0x00520528 (= vt+0x178 then vt+0x17c,
clear bits; ASSUMED motion start/stop pair), +0x1ac 0x0059b634, +0x1b0 0x004cd0a8.

## Dispatch table (0x009ac260)

Records valid for sid 0x00..0x2b. Null handlers: 0x14, 0x21, 0x22 (0x21/0x22 are
sequence sentinels, not states). Sids 0x2c..0x2e are not handlers (table data ends).

| sid | handler | sid | handler | sid | handler |
|---|---|---|---|---|---|
| 0x00 | 0x004cd85c | 0x0d | 0x004c36e4 | 0x1a | 0x004c7688 |
| 0x01 | 0x004c0408 | 0x0e | 0x004c38dc | 0x1b | 0x004c7dc4 |
| 0x02 | 0x004c06f8 | 0x0f | 0x004c3a28 | 0x1c | 0x004c85e0 |
| 0x03 | 0x004c1070 | 0x10 | 0x004c4298 (thunk to 0x004c42a8) | 0x1d | 0x004c8800 |
| 0x04 | 0x004c1730 | 0x11 | 0x004c4754 (thunk to 0x004c42a8) | 0x1e | 0x004c5eb0 |
| 0x05 | 0x004ca610 | 0x12 | 0x004c4764 | 0x1f | 0x004c6334 |
| 0x06 | 0x004c197c | 0x13 | 0x004c4bdc | 0x20 | 0x004c63c0 |
| 0x07 | 0x004c1f9c | 0x15 | 0x004c5408 | 0x23 | 0x004c8b2c |
| 0x08 0x0a 0x0b 0x0c | 0x004cab30 (shared) | 0x16 | 0x004c5ba4 | 0x24 | 0x004c92f8 |
| 0x09 | 0x004c2aec | 0x17 | 0x004c5dd4 | 0x25 | 0x004c9794 |
| | | 0x18 | 0x004c643c | 0x26 | 0x004c99dc |
| | | 0x19 | 0x004c6ca8 | 0x27 | 0x004c9bfc |
| | | | | 0x28 | 0x004c9f40 |
| | | | | 0x29 | 0x004ca37c (wrapper, 0x004ca610) |
| | | | | 0x2a | 0x004ca944 (wrapper, 0x004cab30) |
| | | | | 0x2b | 0x004cb19c |

Phases (second argument): 4 enter, 5 leave, 0 frame, 2 / 0xb leader attack, 9 leader
pick (sequence step), 6 fill x/z for the send, 7 after a packet arrived (copy
`+0x698/+0x69c` to `+0x39c/+0x3a4`), 8 extra sync hook (sid-dependent), 3 the 0x1f
wait-out. Entering writes `+0x32e` through `FUN_0051f62c` (leave old, enter new).

## Sequence and cursor (the "sequence" design shared with the Dragon)

- Cursor `+0x67c` (short index `0x19f`). The cursor is the same design as the Dragon's
  `+0x684` (`dragon.ts` `dragonNext`, cursor 0x32 = second sequence).
- Tables (decoded from exe, all sid codes are the sids themselves: `FUN_004c3074`
  calls `vt+0x164(code, 6)`):
  - A, cursor 0..0x31: `3 39 40 41 42 3 5 6 35 8 | 0x21` (reset to 0)
  - B, cursor 0x32..: `5 6 15 43 19 8 39 40 3 5 6 35 8 3 2 41 42 39 40 3 5 6 35 8 39 40 3 2 | 0x22` (jump to 0x32)
  - C (flag `+0xf2 & 0x40`, derived extras): `19 8 39 40 3 39 40 3 2 3 39 40 5 6 35 8 3 5 6 35 8 2 3 5 6 15 22 | 0x21`
  - Sentinels: Gol uses 0x21 = reset, 0x22 = to 0x32; the Dragon uses 0x20 / 0x21.
- Phase-9 path (every handler that picks): read entry, sentinel handling, then
  `cursor++` and `FUN_004c3074(code)` = send `6xA8` with that sid and the cursor.
- Table ids are in `DAT_009088c0` (A), `DAT_00908160` (B), `DAT_009080e0` (C).

## HP, damage, roar

- Max `+0x2bc` (short), current `+0x334` (short). Stats row 18 (`entitynames.ts`
  `GOL_DRAGON`), read in the ctor through `FUN_0077a684(0x12)` / `FUN_0077a6b4(0x12)`.
- Ctor: `+0x680` = the 90% loop (`max - max/10`, minus 20% while `hp <= it`), the same
  loop as `dragon.ts` ctor (`+0x688`). `+0x682` = `round(max * f / C)` with
  `f = *(DAT_00a48508+8)` (runtime, UNCLEAR).
- Hit clamp (update `0x004cbf68`): while `+0x67c < 0x32` and the hit flag (vt+0x88), hp
  is clamped to `max(+0x682, hp)`. This matches the Dragon's `OlgaUpdateMainLoop` clamp.
- Roar: `FUN_004c311c` (called from 0x004cc390 / 0x004cc644): when `!(+0xf2 & 0x40)` and
  `hp <= +0x682`, hp = `+0x682`, `FUN_004cdb10(1)` (ASSUMED: cursor = 0x32), then send
  sid 0xd (or 0xb when `+0xfb == 1`). Dragon's roar is the same (sid 0xd, cursor 0x32).
- Kill: state 0x15 (dying) leave calls `FUN_0051f894` (the same on-kill as the Barba Ray,
  see `barbaray-map.md` section 4). EXP / 6x76 / drop roll are inside that call and
  are not re-mapped here.

## Network (6xA8)

- Dispatch row: cmd 0xA8 at row 164 of 0x00a0fba0, mask 0x4, handler 0x004cbe80. Send
  via `FUN_008003e0` (sends and applies locally, as in the Barba notes).
- Packet (24 bytes, header `a8 06`):
  - [0] 0xA8, [1] 0x06, [2..3] entity id (`+0x1c`)
  - [4..5] sid (u16), [6..7] cursor (i16, `+0x67c`)
  - [8..9] target id (u16, `+0xe5`), [0xc] x (f32, `+0x690`), [0x10] z (f32, `+0x694`)
  - [0x14] random byte = `ROUND(rand / 32768 * 3)` (ASSUMED: attack variant; decoder
    `func_0x004cbf08` not read)
- Receive `FUN_004cbe80`: entity lookup `FUN_00786b3c(id)`, then `FUN_004cbea0`:
  set target (`FUN_00520fcc`), cursor `+0x67c` = packet cursor, x/z to `+0x698/+0x69c`,
  `vt+0x164(sid, 7)`, the random-byte hook, and `FUN_0051f62c(sid)` when the sid differs.
- Newserv relays 6xA8 untouched (same as 6xA9/6xAA on the Barba Ray; ASSUMED, not
  re-read in this pass).

## States (every handler read; partial where noted)

Confidence note: 0x00, 0x08-0x0f, 0x12-0x2b were decoded from the decompile by three
passes and spot-checked against constants. 0x01-0x07 were re-read on 2026-10-22 (Ghidra
decompile, `tools/ghidra/decomp.sh` headless). Corrections to the text below:
- 0x01 (`0x004c0408`) has NO phase 9 handler (cases 0, 2 / 0xb, 4 only): it never picks
  in normal play (pad-only, like the Dragon's 1). Phase 2 / 0xb sends 3 / 5 / 0x19 (pad).
- 0x02: sequence pick when `+0x217 > 299`, or (`>= 150` and `+0xe6 != 0`) and
  (`+0xed < +0x21d` or `FUN_004c09ec` or `> 599`). Enter `+0x21d = 0x009088f4 + FUN_00782a34`.
- 0x03 (`0x004c1070`): sub 0 turns to the heading and waits for `+0x2c & 0x10` (the motion
  end); sub 1 runs 120 ticks (`+0x219 < 0x78`) with SE 0x40e and three emitters from the
  descriptor `+0x14 / +0x18 / +0x1c`; sub 2 runs 30 ticks (SE 0x40e); sub 3 is the pick.
- 0x04 (`0x004c1730`): enter `+0x2e = 7`, `f2 = (f2 & ~0x34) | 2` (not `~0x36`), SE 0x40a
  at 12.0; 10.0 / 23.0 frame crossings call `FUN_00426b88 / FUN_00426b98`. Pick on `+0x2c & 0x10`.
- 0x05 (`0x004ca610`): enter `+0x2e = 0xf`, sub 0 turns `f2 |= 0x30`, `+0xfb = 1` at
  35.0; sub 1 counts `+0x218` (SE / emitter `FUN_007be6b8`); pick at `+0x218 > 39`.
- 0x06 (`0x004c197c`): enter `+0x2e = 0x10`; sub 0 is the approach (`FUN_00783444(0.1,
  -0.1, ...)` in enter, `FUN_00783444(16, -16, dist, vmax)` after the turn), sub 1 the
  lunge (`FUN_004c0fcc`), pick at sub 2 (phase 9 `+0x217 == 2`). Attack 0x1a (pad).
- 0x07 (`0x004c1f9c`): enter `+0x2e = 0x10` (NOT 0x12); sub 0 scans the 12 players
  (`FUN_0068d5a8`, distance >= `0x00a4850c`), sub 1 sets the heading and `+0x2e = 0x12`
  (`+0x21b`), `f2 |= 0x30`; sub 2 is the volley (SE 0x405 at 0x40000000, 0x40b at
  0x42340000, `FUN_004c1f34`, three `FUN_005caba4(0x58)` objects with `FUN_004cf34c`
  at the spread `0x1000`, `FUN_0050b7a4`), `+0x219 = 0`, `f2 &= ~0x30`; sub 3 counts
  `+0x219` to 11, then sub 4; pick at sub 4. Attack 0x1a at sub 3 (pad).
- The ported state table is `GOL_STATES` in `client/src/combat/goldragon.ts`.

Motion slot = the value written to `+0x2e` on enter. "none" means the handler
does not write it (the slot is inherited; UNCLEAR).

- **0x00 wait** (`0x004cd85c`): enter calls `FUN_004cd748` (picks the owner client,
  `+0x760`). phase 2/0xb: send `0x18` with rand byte. phase 9: sequence pick (A, or B
  from the cursor, or C when `+0xf2 & 0x40`), `FUN_004c3074`. Motion: none in the
  handler. Full.
- **0x01** (`0x004c0408`): enter `+0x2e` set 0 via `+0x2e=0`, SE 0x401 or derived
  path `FUN_004c06c0`. Phase 2/0xb: if near player (`FUN_004c6c54(target, DAT_00a0f674)`)
  send `0x03`; `DAT_00a0f67c` -> send `0x05`; `target+0x24 > DAT_009088fc` (0.1) -> send
  `0x19`. Partial (helpers).
- **0x02** (`0x004c06f8`, walk-ish): enter `+0x2e = 1`, `vt+0x188`, `+0xfb = 0`;
  phase 8 timer `+0x217` every 20 frames with `FUN_0052126c` (ASSUMED net sync). Send
  `0x18` (phase 2/0xb). Phase 9: when `+0x217 >= 150` or the target conditions, sequence
  pick. Partial.
- **0x03** (`0x004c1070`): enter via `FUN_004cc7f4` path; frame `FUN_004c0b78`
  (movement: heading to target, speed `_DAT_0090888c` / `_DAT_0090889c` * scale;
  `FUN_00521454` / `FUN_0052069c` pick the move). Sub-states `+0x217` 0..3: sub 0 turns
  (`atan2` of `+0xea/+0xec` to heading), sub 1 wait for `FUN_0052126c`, sub 2 send `0x18`
  with 3 ticks, sub 3 `+0x218` counter to 11 (`+0x219` < 0x0b) then sequence pick.
  Motion slot none written here (ASSUMED 0). Partial.
- **0x04** (`0x004c1730`): enter `+0x2e = 7`, `vt+0x188`, `+0xfb = 0`, `FUN_004cb184`,
  `+0xf2 = (f2 & ~0x36) | 2`, `FUN_00426b98`. Phase 2/0xb: send `0x18`. Phase 9:
  sequence pick. Partial (phase 0 not read).
- **0x05** (`0x004ca610`): enter `+0x2e = 0x0f`, `FUN_007aa094`, `vt+0x188`,
  `+0xfb = 0`, `FUN_004cb184`. Frame: SE `0x405` at `DAT_00a0f674`... (flags via
  `FUN_007aaa30`); SE 0x404; `FUN_004c1f34` at 0x42380000 (46.0). `+0x217 == 0` -> at
  0x420c0000 (35.0) `+0x218=0`, `+0xf2 |= 0x30`, `+0xfb=1`, `+0x217=1`. `+0x217 == 1`:
  `+0x218` counter, texture-style float `FUN_007be6b8` (ASSUMED charge). Phase 6 /
  7: `FUN_004c32c4` / `FUN_004c32b0`. Phase 9 with `+0x218 > 39`: sequence pick. Partial.
- **0x06** (`0x004c197c`, the lunge): enter `+0x2e = 0x10`, `vt+0x188`, `+0xfb = 1`,
  `FUN_004c1f00`, `+0xf2 &= ~0x36`. Frame: `FUN_004c53d8`, `FUN_004c1f18`, `+0x21d`
  accumulates `_DAT_00908824`; `FUN_00782d28` gives the stride; `+0x217 == 1` after
  `FUN_00782d9c` returns nonzero. Phase 9 with `+0x217 == 2`: sequence pick. Send `0x1a`
  (phase 2/0xb) with a rand byte; `+0x217==2`, phase 0xb sends `0x0f`. Partial.
- **0x07** (`0x004c1f9c`): enter `+0x2e = 0x12`, `vt+0x188`, `+0xfb = 1`, `+0xf2 |= 0x30`.
  Sub-states `+0x217` 0..4: sub 0 `FUN_0068d5a8` scans 12 players for distance `>=
  DAT_0090850c`, picks the nearest, sets `+0x21b` heading, `+0x222..0x224` target;
  sub 1 `FUN_004c29ec` gate; sub 2 `FUN_007aaa30(0x40000000)` SE 0x405, `0x42340000` SE
  0x40b; sub 3 counter `+0x219` >= 11 then sub 4; sub 4 sends `0x0f` on phase 2/0xb.
  Motion 0x12 is the slot used only here. Partial (the exact per-sub timers in
  `FUN_004c1f9c`, not every constant decoded).
- **0x08 / 0x0a / 0x0b / 0x0c** (`0x004cab30`, shared): enter writes `+0x2e = 0x11`
  for all four sids (ASSUMED: the shared body is a breath, the sid only changes the
  pick). Frame sub 0: aura SE (`FUN_00814298(0x405)` at 2.0 `0x40000000`), `FUN_004c1f34`
  at 11.0; at 50.0 (`0x42480000`) the breath: clears the flame list of `+0x1a2`, spawns
  `FUN_004cfc08(+0x38, 100.0, sid)` and particles `FUN_0050b7a4`, SE 0x40f, then sub 1.
  Phase 2/0xb (sub 2, `+0x2c & 0x10`): send `0x18`. Phase 9 (sub 2): 0x0a -> send 9,
  0x0b -> send 0xd, 0x0c -> send 0x15, else sequence pick. Partial (sub 1 timers
  from `+0x217 > 449`).
- **0x09** (`0x004c2aec`, attack, 2 sub-sids): enter `+0x2e = 8`, `vt+0x188`, `+0xfb = 0`,
  `FUN_004cb184`, `+0xf2 = (f2 & ~0x20) | 0x16`, SE `0x407`. Sub 0 picks `FUN_004c369c`
  (7.0), `FUN_004c34e8` (14.0) or `FUN_004c3334` (18.0); sub 1 positional SE `0x413` each
  frame, `+0x217++`, after 449 frames sub 2 with `+0x2e = 10`; sub 2 aims at
  `FUN_0082dcbc / FUN_0082ddd8` and `FUN_0052069c`. Attack (0xb, sub 2): send `0x18`
  with rand byte. Phase 9 (sub 2): `FUN_004c2f5c` (UNCLEAR). Partial.
- **0x0d** (`0x004c36e4`): enter `+0x2e = 2`, `vt+0x184` (ASSUMED stop), `+0xfb = 0`,
  `FUN_004cb184`, `+0xf2 = (f2 & ~6) | 0x30`, `vt+0x174`. Frame: `draroar.adx` cue at
  20.0. Attack 2/0xb: send `0x18` (args as 0x09). Phase 9: sequence pick (gated by
  `+0x2c & 0x10`). Full except the cue ID (ASSUMED name).
- **0x0e** (`0x004c38dc`): enter `+0x2e = 0x10`, `vt+0x188`, `+0xfb = 1`, `FUN_004c1f00`,
  `+0xf2 = (f2 & ~6) | 0x30`, `draroar.adx`, `vt+0x174`, `+0x217 = 0`. Frame:
  `+0x217++`, `FUN_004c53d8`, `FUN_004c1f18`. Phase 9 with `+0x217 > 59`: sequence pick.
  Full.
- **0x0f** (`0x004c3a28`, the big one): sub `+0x217` 0..6. Init latches `DAT_00a484a0`
  bit 0 and sets runtime floats `DAT_00a48530 = 180.0`, `DAT_00a48540 = 900.0`,
  `DAT_00a48550 = -400.0` (0x43340000 / 0x44610000 / 0xc3c80000). Enter `+0x2e = 0x10`,
  `vt+0x188`, `+0xfb = 1`, heading = `round(atan2(+0xea,+0xec) * 65536 / 2pi)` into
  `+0x21b`, `FUN_004cda5c(heading)`. Sub 1: `FUN_004c29ec` gate -> `+0x2e = 0x16`,
  sub 2. Sub 2: `FUN_007aaa30(14.0)` -> sub 3. Sub 3: spline step with `FUN_007be6b8`
  over `DAT_00a4852c`, `+0x218` to 60, SE `0x411` at 39.0, -> sub 4. Subs 4/5: up and
  down motion (`+0x21c += 0x117`, clamp 0x2811), `+0x107 <= -50.0` -> sub 5, SE `0x410`.
  At `+0xf <= 0` and `+0x228 == 0`: `FUN_004c4218`, clear `+0x1a2`, `FUN_004cfc08(+0x38,
  100.0, +7)`, `+0x228 = 1`, `vt+0x174`, `vt+0x180`, `+0xfb = 2`. `+0x218 >= 60` ->
  sub 6, `+0xf2 &= ~1`. Attack 2: send `0x1c` at sub 6; attack 0xb: send `0x25` at sub 6.
  Phase 9 at sub 6: sequence pick. Phase 6 fills a 12-entry ring `+0x1aa` with
  `FUN_00520c08(100.0, 220.0)`. Partial (`FUN_007aaa30` semantics and the spline are ASSUMED).
- **0x10 / 0x11** (thunks to `0x004c42a8`, decompiled 2026-10-22; the sid is the second
  argument, `param_3`): enter (phase 4) `vt+0x188`, `+0xfb = 2`, `FUN_004c473c`,
  `+0xf2 = (f2 & ~7) | 0x30`, `vt+0x174`, `vt+0x180`. Sid 0x10 resets the counter
  `+0x1b6` to 0, sid 0x11 adds 1; the flame list `+0x1a2` is cleared; `+0x21e` =
  `float(+0x1b6) * 0x0090892c + 0x00908930`; `+0x21d = 0`, `+0x217 = 0`, `+0x218 = 0`.
  No `+0x2e` write (the motion is inherited). Frame sub 0 (`+0x217 == 0`): the counter
  `+0x218` to `0x009086b8` (60.0), then sub 1: heading `atan2(+0x38, +0x40)` (the
  direction from the arena's centre) to `+0x18` through `FUN_007a8c74`, velocity
  `+0xea / +0xec` from `FUN_0082dcbc / FUN_0082ddd8`. Sub 1: the walk along the velocity by
  `+0x21d` (accumulated by `0x009086bc`, capped at `+0x21e`), SE `0x412` every frame,
  `FUN_0041a874` each 11 ticks (`+0x218 > 10`). Phase 2 / 0xb: send `0x1c` (pad only).
  Phase 9 (leader): `+0x22c != 0` forces the pick; sub 1 picks when `FUN_007828e4`
  (distance) is under `0x009086c0` (value UNCLEAR, the rest of the pick is not read).
  The entrance-free states 0x10/0x11 are the walk-in burrow of the Gol's sequence
  (ASSUMED name). Partial: the pick distance and `FUN_0041a874` are not read.
- **0x12** (`0x004c4764`, approach / chase): enter `vt+0x188`, `+0xfb = 2`, `FUN_004c473c`,
  `+0xf2 = (f2 & ~7) | 0x30`, `vt+0x174`, `vt+0x180`, `+0x21e = float(+0x1b6)*4.0 + 4.0`
  (0x90892c, 0x908930), `+0x217 = 0`, `+0x218 = 0`. Frame: heading (`FUN_007a8c74` at
  0x600), move `+0x21e` along heading, positional SE `0x412`, every 11 frames
  `FUN_0041a874`. Attack 2/0xb: send `0x1c`. Phase 9: distance > 350.0 (0x9086a8) ->
  sequence pick. Partial (`_DAT_00a48560` is runtime, UNCLEAR).
- **0x13** (`0x004c4bdc`, dive / charge): enter `+0x2e = 0x18`, `vt+0x188`, `+0xfb = 2`,
  `FUN_004c473c`, `+0xf2 = (f2 & ~7) | 0x30`, `+0x217 = 0`, `+0x218 = 0`. Sub 0 counts
  `+0x218` to 100.0 (0x908670), picks a dive vector, `+0x21d` from `FUN_0082dc9c`, height
  `+0xf = -170.0`. Sub 1 falls; `+0xf > 0` -> sub 2, `vt+0x178`, `vt+0x17c`, `+0xfb = 1`,
  `FUN_004c4218`, `FUN_004cfc08(+0x38, 100.0, +7)`, SE `0x410`. Sub 2 to sub 3 at
  `+0xf > 110.0`; sub 3 to sub 4 at `+0x21e < 0 && +0xf < 220.0`, `+0x21f = vy^2 / 80.0`;
  sub 4 lands (`+0x21e` to 0), sub 5 (50 ticks), sub 6 idle. Attack 2/0xb at sub 6:
  send `0x1a`. Phase 9 at sub 6: send `8` directly (no sequence table). Partial
  (`_DAT_00a48564` runtime, dive heading via `FUN_0082dc9c`).
- **0x15** (`0x004c5408`, death entry): enter `+0x2e = 0x13`, `vt+0x184`, `+0xfb = 0`,
  `FUN_004cb184`, `+0x21d = 0`, `+0xf2 |= 0x36`, `goldeath_adx` cue (ASSUMED name),
  `FUN_00717f74`, `FUN_004d31f4(5)`, `FUN_004d6770`, `FUN_004d681c`. Frame sub 0:
  SE `0x408` at 60.0 / 98.0; effects `FUN_0050b7a4` at 57.0 and 88.0, a ring of
  `FUN_0051fdf8` points at 97.0; exit to sub 1 when `+0x2c & 0x10`. Sub 1: `+0x218`
  counter to 49, then `FUN_00717f38`, `FUN_004d3250`. Leave: `FUN_0051f894` (kill /
  reward, see above), `FUN_006bb100(0x4f)`, `+0xc = 0x12008`, `vt+0x130`. Attack 2/0xb
  and phase 9 (at `+0x218 > 49`): send `0x17`. Phase 8: `FUN_004ce924`. Full on the
  flow; the reward internals are not re-mapped.
- **0x16** (`0x004c5ba4`): enter `vt+0x184`, `+0xfb = 0`, `FUN_004cb184`, `+0x217 = 0`,
  `+0xf2 |= 0xb6`; no `+0x2e` write. Frame: `+0x1a`/`+0x1c` = `2 - t/3`, `+0x1b` =
  `2 + t` (t = `+0x217`), counter with no cap. Attack/pick at `+0x217 > 5`: send `0x17`.
  Full.
- **0x17** (`0x004c5dd4`): enter `+0x2e = 0x13`, `vt+0x184`, `+0xfb = 0`, `FUN_004cb184`,
  `+0x1be = +0x1c5 = +0x1cc = +0x1d3 = 0.005f`, `+0xf2 |= 0x136`. Frame: `FUN_007aa094`;
  loop 4 children (`+0x6e4 + k*0x1c`), `vt+0x10`, first nonzero sets `+8 |= 1` and returns.
  No transitions (exit is external, UNCLEAR who consumes `+8`). Full.
- **0x18** (`0x004c643c`): enter `+0x2e = 0`, `vt+0x188`, `+0xfb = 0`, `FUN_004cb184`,
  `+0xf2 &= ~0x36`. Attack 2: if `target+0x24 > 0.1` send `0x19`, then flag masks
  (`FUN_004c6c54(flags, 1)` -> send 3, `4` -> send 4, `2` -> send 5). Phase 9 (0xb):
  `0x19` / 3 / 4 / 5 / mask pick (0x20 or 0x80) -> send 9. Phase 6 `FUN_004c32c4`,
  phase 7 `FUN_004c32b0`. Partial (flag masks `0xa0f674/0xa0f678/0xa0f67c` decoded;
  `FUN_004c6c54` and `FUN_004c6c20` not).
- **0x19** (`0x004c6ca8`): enter `+0x2e = 1`, `vt+0x188`, `+0xfb = 0`, `FUN_004cb184`,
  `+0xf2 &= ~0x36`, `+0x217 = +0x218 = 0`. Frame: `FUN_004c0dc4` when `+0x2e == 1`,
  `FUN_004c0f0c` at 24.0, `FUN_004c0e4c` at 3.0; retarget heading `FUN_007a8c74(+0x18,
  +0x21b, 0x200)` with `FUN_0052069c(x, z, 0.8)`. Phase 8 is a 30-tick timer (not net
  sync): at `+0x217 >= 30`, `+0x218 = 1` if `target+0x24 <= 0.1`, else
  `+0x21b = target+0x1c`, `FUN_004c7670`, `FUN_004c0a9c`. Attack 2: send `0x18` at
  `+0x218 == 1`, then masks -> 3 / 4 / 5. Pick 0xb: 0x18 / 3 / 4 / 5 / 9. Phase 6
  `FUN_004c7670`, phase 7 `FUN_004c7644`. Partial.
- **0x1a** (`0x004c7688`): enter `+0x2e = 0x10`, `vt+0x188`, `+0xfb = 1`, `FUN_004c1f00`,
  `+0xf2 &= ~0x36`. Frame: `FUN_004c53d8`, `FUN_004c1f18`. Attack 2: `target+0x24 > 0.1`
  -> send `0x1b`, then masks -> 7 / 0xf / 8. Pick 0xb: `p[0x1d9] > 450` or mask 4 -> 8,
  `target+0x24 > 0.1` -> 0x1b, mask 1 -> 7, `FUN_004c7d8c()` -> 0xf. Phases 6/7 as 0x18.
  Partial (`p[0x1d9]` written elsewhere).
- **0x1b** (`0x004c7dc4`): enter `+0x2e = 0x10`, `vt+0x188`, `+0xfb = 1`, `FUN_004c1f00`,
  `+0x217 = 100`, `+0x218 = 0`. Frame: heading and `FUN_00520aa8(x, z, y)` with y = 2.0
  (remote: `FUN_004c32d8`). Phase 8: the same 30-tick timer as 0x19 (first tick resets).
  Attack 2: `+0x218 == 1` -> send `0x1a`, then 7 / 0xf / 8. Pick 0xb: 8 / 0x1a / 7 / 0xf.
  Partial.
- **0x1c** (`0x004c85e0`, the breath / attack): enter `vt+0x188`, `+0xfb = 2`,
  `FUN_004c473c`, `+0xf2 = (f2 & ~7) | 0x30`, `vt+0x174`, `vt+0x180`, `+0x217 = 0`; no
  `+0x2e` write. Frame: counter `+0x217` every 11 frames, `FUN_0041a874`. Attack 2 and
  0xb (shared): `target+0x24 > 0.1` -> send `0x1d`; `&4` (`0xa0f678`) -> send `0x13` with
  explicit args. Phases 6/7 `FUN_004c32c4` / `FUN_004c32b0`. Full on transitions
  (the picks are gated by the flag tests).
- **0x1d** (`0x004c8800`): enter `+0x2e = 0x11`, `vt+0x188`, `+0xfb = 2`, `FUN_004c473c`,
  `+0xf2 = (f2 & ~7) | 0x30`, `vt+0x174`, `vt+0x180`, `+0x217 = 100`, saves `+0x222 =
  p[0xe]`, `+0x224 = p[0x10]`. Frame: move `+0xe/+0x10` by `4.0 * (dcbc, ddd8)`,
  `+0x21d` path accumulator (`FUN_0082dc9c`). Phase 8 timer as 0x19 (sets `+0x218 = 1` or
  retargets). Attack 2/0xb: `+0x218 == 1` -> send `0x1c`; `&4` -> send `0x13`. Phases
  6/7: `FUN_004c7670` / `FUN_004c7644`. Partial (`FUN_0082dc9c` is ASSUMED path length).
- **0x1e** (`0x004c5eb0`, the ENTRANCE, not a death: the ctor 0x004cb480 starts the
  singleton in it, `*(short*)(+0x32e) = 0x1e` when `this == DAT_00a485cc`; slot 26 is
  `bossopgc`, motion 1, 169 frames). Enter `+0x2e = 0x1a`, `+0x868 = 1`,
  clear `+0x8a4`, `+0x85c/+0x860/+0x864 = 0`, `FUN_005caba4(0x28)`, `FUN_004cecbc(
  DAT_00aca37c, 0.5, +0x868)`. Sub `+0x85c == 0`: waits for `+0xb0 & 0x10`, then sub 1,
  `+0x2e = 0`; timer `+0x864` steps: SE `0x405` at 2.0, SE `0x40f` at 60.0, a point
  burst at 63.0, `0x407` at 75.0, `dradeath.adx` at 105.0 (ASSUMED), then
  `FUN_007a8d98` while `+0xc0 < 150.0`. Attack / pick (sub 1 only): send `0`
  (`vt+0x164(0, 6)`). Leave: `FUN_007b9fbc`, `FUN_00717f38`, `FUN_00520e34`. Partial
  (`+0xc0` is a float, not hp; the thresholds are ASSUMED).
- **0x1f** (`0x004c6334`): enter `+0x3c = 0`, `+0xb8 = 0`, `+0x85c = 0`. Frame: if any of
  the four `FUN_0068d5a8(0..3)` lookups is nonzero, `+0x85c++`. Phase 3: at `+0x85c > 150`,
  `FUN_0051f62c(8)` (enter sid 8). Partial (`FUN_0068d5a8` semantics ASSUMED: a seat
  lookup).
- **0x20** (`0x004c63c0`): enter `+0x85c = 0`, `+0x2e = 0x0b`. Frame: counter `+0x85c`
  with period 91; on reset `+0x2e++`, wrapping to 0 at 28. Cycles slots 11..27, then
  0..27. No transitions here. Partial (which slots matter is UNCLEAR).
- **0x23** (`0x004c8b2c`, the volley): enter `+0x2e = 0x19`, `vt+0x188`, `+0xfb = 1`,
  `FUN_004c1f00`, `+0xf2 = (f2 & ~6) | 0x30`, `+0x85c/+0x860/+0x864/+0x86c = 0`. Sub
  0..6 on `+0x85c`: 0 waits for 39.0 (SE `0x411`); 1 aims `+0x5c` and waits for
  `+0xb0 & 0x10`, `+0x2e = 0x18`; 2 waits `+0xc0 > 22.0`; 3 volleys (every 4th frame,
  `FUN_005caba4(0x58)`, `FUN_004cf34c`, seat targets `FUN_0068d5a8`) until pulse 39;
  4 turns `+0x870` to the target heading (`0x1300` step, `0xecff` window); 5 steps
  `+0x60` toward `+0x870` (0.3 factor, +-512 limit); 6 idle. Attack 2/0xb: send `0x1a`
  (args UNCLEAR). Phase 5 resets `+0x5c`, `+0xb0 &= ~1`, `+0x654 = 0`. Phase 7:
  `FUN_0084c390(x*100, z*100)`. Phase 9 at sub 6: sequence pick. Partial (the volley
  arguments `FUN_004cf34c`; `DAT_00a48568` runtime).
- **0x24** (`0x004c92f8`): enter `vt+0x188`, `+0xfb = 2`, `FUN_004c473c`, `+0xf2 =
  (f2 & ~7) | 0x30`, `vt+0x174`, `vt+0x180`, `+0x878 = +0x6d8 * 4.0 + 4.0`, `+0x874 =
  int(+0x878 * 2.5)`, `+0x87c = 351.0`. No `+0x2e` write (UNCLEAR). Sub 0 waits 60.0
  frames then `FUN_004c32b0` and heading; sub 1 walks in a circle (`+0x87c` shrinks by
  `-0.00106812` per frame until < 5.0, sub 2), positional SE `0x412`. Attack (ungated):
  send `0x1c`. Phase 6: `+0x38/+0x40` at `DAT_00a4855c` radius. Phase 9: sequence pick
  when `+0x8b0 != 0` or sub 2. Partial.
- **0x25** (`0x004c9794`, charge toward the player): enter `+0x2e = 0x11`, `vt+0x188`,
  `+0xfb = 2`, `FUN_004c473c`, `+0xf2 = (f2 & ~7) | 0x30`, `vt+0x174`, `vt+0x180`,
  `FUN_004c99ac`. Frame: `+0x768 += +0x86c`; `+0x60 = +0x86c +/- 0x9800 + old`; `+0x85c++`.
  Attack 2/0xb: if `+0x85c > 449` or `FUN_004c6c54(target, DAT_00a0f67c)`, send `0x26`
  (not table-driven). Phase 6 random `+0x1a4`, `+0x1a5`. Phase 7: `+0x768 =
  ROUND(+0x698)`, `+0x86c = +/-0x180` by `+0x69c > 0`. Partial.
- **0x26** (`0x004c99dc`, the dash): enter `+0x2e = 0x11`, `vt+0x188`, `+0xfb = 2`,
  `FUN_004c473c`, `+0xf2 = (f2 & ~7) | 0x30`, `vt+0x174`, `vt+0x180`, `+0x874 = 0`,
  velocity `+0x3a8 = -x`, `+0x3b0 = -z`, normalised, `+0x60 = atan2(vx, vz)`. Frame:
  `s = min(+0x874 + 0.1, 12.0)` (0x9086bc), `+0x40 += s * vz`, `+0x38 += s * vx`,
  `+0x878 += s`. Note: `+0x874` is int-typed in the decompile, so the ramp truncates
  (ASSUMED, verify). Attack 2/0xb: if `+0x878 >= 680.0`, send `0x13`. Phase 6
  `FUN_004c32c4`, phase 7 `FUN_004c32b0`. Partial.
- **0x27** (`0x004c9bfc`, the flank): enter `+0x2e = 1`, `vt+0x188`, `+0xfb = 0`,
  `FUN_004cb184`, `+0xf2 = (f2 & ~0x36) | 0x100`, `+0x1be/0x1c5/0x1cc/0x1d3 = 0.02`,
  `+0x874 = int(5.0 + FUN_00782a34(...))`. Frame: `FUN_004c0b78` (movement), children
  `vt+0x10`. Attack 2/0xb: send `0x18`. Phase 5 clears `+0xf2 & 0x100`. Phase 6:
  `+0xee = +0xef`, `FUN_004c0b50`, `FUN_005213ec` / `FUN_005213d8`, `FUN_004c0b5c`. Phase 7:
  `FUN_004c0b34`. Phase 8: `FUN_004c0b50`, `+0x85c++`, every 20th count the sync helper
  (ASSUMED net sync). Phase 9: if no child `vt+0x20` is busy, sequence pick. Partial.
- **0x28** (`0x004c9f40`): as 0x27 with SE `0x416` on enter and steering in phase 6
  (target `+0x39c/+0x3a4` = pos plus 0.5 * |v| along `v`, or 120.0 along the heading
  when the heading differs by more than 45 degrees). Phase 9 gate on `FUN_00577244`.
  Partial (`FUN_00577244` arg lost).
- **0x29** (`0x004ca37c`, wrapper): enter children floats `+0x6f8/+0x714/+0x730/+0x74c
  = 0.08`, `+0x3c8 |= 0x100`, `FUN_004ca610(4)` (the 0x05 handler). Frame: children
  `vt+0x10` when `+0x85c == 1`; then `FUN_004ca610(0)`. Phase 2/0xb and 9: all four children
  idle -> `+0x764 = 0`, sequence pick. Phase 5 `+0x3c8 &= ~0x100`, `FUN_004ca610(5)`.
  Other phases forward to 0x004ca610.
- **0x2a** (`0x004ca944`, wrapper): enter children floats `0.00803`, `+0x3c8 |= 0x100`,
  `FUN_004cab30(4)`, SE `0x415`. Frame: children `vt+0x14`, `FUN_004cab30(0)`. Phase 6:
  random probe `FUN_00780630(candidate, 0x16ef)`, commit target if `hit.y <= 30.0`.
  Phase 5 `+0x3c8 &= ~0x100`, `FUN_004cab30(5)`. Phase 7: `FUN_004ca2f0(+0x38)`. Other
  phases forward to 0x004cab30. Partial.
- **0x2b** (`0x004cb19c`): attack 2/0xb: send `0x1c` (random byte). Enter `vt+0x188`,
  `+0xfb = 2`, `FUN_004c473c`, `+0xf2 = (f2 & ~7) | 0x30`, `vt+0x174`, `vt+0x180`; no
  `+0x2e` write. Leave: `FUN_004cea04`, `vt+0x178`, `vt+0x17c`. Phase 6:
  `FUN_004c7670(rand seed)`. Phase 7: `FUN_004c7644(+0x86c)`. Phase 9: if
  `FUN_004ce970() != 0`, sequence pick (UNCLEAR gate). Partial.

Action (send) codes seen: 0x03, 0x04, 0x05, 0x08, 0x09, 0x0d, 0x0f, 0x13, 0x15, 0x16,
0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x25, 0x26 (plus the sequence codes above).
Each is the sid of the state it enters (`FUN_004c3074` and every explicit send call
`vt+0x164(code, 6)` first; the code is the sid).

## Movement and paths

- Heading `+0x18` / target heading `+0x21b` are `BAMS` (65536 per turn).
- Speed/step constants: `_DAT_0090888c` / `_DAT_0090889c` (`FUN_004c0b78`), `0.3` /
  `0.8` / `2.0` (sid 0x19 / 0x1b), `-0.00106812` circle (0x24), `12.0` dash cap (0x26),
  `-170.0` dive start height (0x13), `0.02` (0x27 / 0x28 child floats). Runtime BSS
  floats `DAT_00a48564`, `DAT_00a4856c`, `DAT_00a48568`, `DAT_00a48560`, `DAT_00a48510`,
  `DAT_00a48520`, `DAT_00a485f0`: values UNCLEAR (not in the initialised section).
- Anchor/arena table: not read in this pass (no `FUN_004b1e58` equivalent found yet).

## Hit boxes

Body (decoded 2026-10-22): the ctor 0x004cb480 calls `FUN_0051ff3c(&DAT_009ac120, 7)`:
7 boxes, stride 0x2c (`+0xc` the radius). The static init 0x004cd532..0x004cd564 writes
the radii `0x009ac12c = 10, 0x009ac158 = 10, 0x009ac184 = 10, 0x009ac1b0 = 15,
0x009ac1dc = 15, 0x009ac208 = 10, 0x009ac234 = 10` (exe). The flags are not written
by that init (ASSUMED 0x8003, the Dragon's). The positions are not moved by any state
read so far (ASSUMED: at the origin). The tail / node table is not mapped (the Gol's
model nodes are not read; the port uses the body only). The per-child boxes (4
children at `+0x6e4`) are OPEN.

## Particles and SE (observed ids)

- SE: 0x401 (enter 0x01), 0x404 / 0x405 (aura, 0x02 / 0x03), 0x407 (0x09 enter, 0x15 /
  0x1e death), 0x408 (0x15 death), 0x40a (0x00), 0x40b, 0x40f (0x0 0x1c breath), 0x410
  (dive / land), 0x411 (0x0f / 0x23 charge), 0x412 (0x12 / 0x24 walk), 0x413 (0x09 frame),
  0x415 (0x2a), 0x416 (0x28).
- Voice / cue (ASSUMED names): `draroar.adx` (0x0d, 0x0e), `goldeath_adx` (0x15),
  `dradeath.adx` (0x1e).
- Effects: `FUN_0050b7a4` with ids from the descriptor `p[0x1dc]` (+8 / +0xc), and
  `FUN_004cfc08` (flame / explosion at `+0x38`, radius 100.0). Particle ids not decoded.

## Motion archive and slots

- Archive `bm_boss8_dragon.bml` (`data.gsl`), descriptor 0x009ac3d0 (`enemymodels.ts`).
  Models: 0 `boss1_s_nb_dragon.nj`, 1 `lo_boss1_s_nb_dragon.nj`, 2 `boss1_s_sd_dragon.nj`.
  Motion names (archive order, from the port's descriptor): 0 dead, 1 bossopgc, 2 down,
  3 frin, 4 frloop, 5 frout, 6 land, 7 lift, 8 nkdown, 9 nkup, 10 nobi, 11 stand, 12 tatk,
  13 walk, 14 wngclose, 15 wngopn, 16 daml, 17 dams, 18 fire, 19 fly, 20 flyshot, 21 kiri,
  22 tobidasi, 23 tukomi, 24 wgwalk, 25 wing. These are the Dragon's names; the archive
  is a different file with its own order, so treat the names as ASSUMED.
- Frame counts (`parseNjmFile`, node count independent in this run): dead 129,
  bossopgc 169, down 27, frin 14, frloop 27, frout 14, land 80, lift 80, nkdown 30,
  nkup 27, nobi 80, stand 52, tatk 26, walk 39, wngclose 27, wngopn 27, daml 53, dams 27,
  fire 27, fly 44, flyshot 80, kiri 30, tobidasi 50, tukomi 44, wgwalk 40, wing 27.
  (Script: `scratchpad/gol_motions.ts`, not committed; ASSUMED until checked in the
  motion player.)
- Motion table 0x009abf60, 28 rows (0x10 each, to 0x009ac11f; the earlier "24 rows"
  was a read limit). Archive names VERIFIED (`bm_boss8_dragon.bml`, motions 0..25 by
  file name, in archive order: 0 dead, 1 bossopgc, 2 down, 3 frin, 4 frloop, 5 frout,
  6 land, 7 lift, 8 nkdown, 9 nkup, 10 nobi, 11 stand, 12 tatk, 13 walk, 14 wngclose,
  15 wngopn, 16 daml, 17 dams, 18 fire, 19 fly, 20 flyshot, 21 kiri, 22 tobidasi,
  23 tukomi, 24 wgwalk, 25 wing). Rows 24..27: 24 (2,16,22,0.5),
  25 (3,0,23,1), 26 (3,0,1,0.5 bossopgc), 27 (2,8,17,0.6). Row 19 (dead) speed 0 in the
  table (ASSUMED 0.5 in the port). Row 0: (1,0,11,0.5) stand; 1 (1,0,13,0.5) walk-ish; 2 (3,0,10,0.7);
  3 (3,0,18,0.9) fire; 4 (3,0,3,0.5) frin; 5 (1,0,4,0.4); 6 (3,0,5,0.5); 7 (3,0,12,0.5) tatk;
  8 (2,9,8,0.5) nkdown; 9 (1,0,2,0.3) down; 10 (3,0,9,0.3) nkup; 11 (3,0,17,0.6) dams;
  12 (3,0,16,0.5) daml; 13 (3,0,15,0.5) wngopn; 14 (3,0,14,0.5) wngclose; 15 (3,0,7,1)
  lift; 16 (1,0,19,1) fly; 17 (2,14,6,1) land; 18 (2,16,20,1.1) flyshot; 19 (3,0,0,0) dead;
  20 (1,0,25,1) wing; 21 (1,0,24,0.5) wgwalk; 22 (2,23,23,1) tobidasi/tukomi; 23 (1,0,21,1)
  kiri. Mode 1 loop, 2 once then `next`, 3 once and hold (ASSUMED, as the Dragon).
- Enter slots used by the states above: 0x0d -> 2, 0x0e -> 0x10, 0x0f -> 0x10, 0x09 -> 8,
  0x12 none, 0x15 -> 0x13, 0x16 none, 0x17 -> 0x13, 0x18 -> 0, 0x19 -> 1, 0x1a -> 0x10,
  0x1b -> 0x10, 0x1c none, 0x1d -> 0x11, 0x1e -> 0x1a, 0x1f -> 0, 0x20 cycles 11..27,
  0x23 -> 0x19, 0x25 / 0x26 -> 0x11, 0x27 / 0x28 -> 1, 0x2b none. (Slot numbers index the
  table above.)

## Death and rewards

- Death: the 0x15 handler plays the death cinematic (sub 0 / 1) and its leave calls
  `FUN_0051f894` (the on-kill as in `barbaray-map.md` section 4: 6x76 / EXP / drop via
  0x00787534, 0x005c973c, 0x008113e4). Who runs the kill on each client was not traced
  in this pass (UNCLEAR, like the Barba Ray). The 0x1e handler is a second death-style
  sequence (`dradeath.adx`) that does not call the kill.
- Derived extras (vtable 0x00afbc20, flag 0x40, ctor 0x004cede4): the 5 extra entities
  of the type count. Their death and rewards are UNCLEAR.

## Reuse from the Dragon (dragon.ts)

- Same design, different code: the Dragon is `TBoss1Dragon` (ctor 0x00419214, vtable
  0x00af3a20, dispatcher 0x00419b14 with table 0x008fb1a0). The Gol Dragon's handlers
  are in 0x004c0000..0x004cc000 and share no function with the Dragon except the
  generic enemy helpers (0x0051f62c, 0x0051f894, 0x008003e0, 0x00814298).
- Reuse plan (port):
  - Sequence walk: `dragonNext` (`dragon.ts` line 154) with the sentinels remapped
    (0x21 = reset, 0x22 = jump to 0x32) and the third table (C) for the derived extras.
  - HP clamp and roar: `DragonAi.hit` / `setDamageTaken` (lines 788, 794) and the roar
    rule of `OlgaUpdateMainLoop` (+0x688 there, +0x682 here).
  - Packet and apply: `applyRemote` (line 1034) and `setState` (line 1002) for the 6xA8
    receive (the phase 6/7 pattern is the same), `tick` (1100) for the frame.
  - Motion slots: `DragonSlot` (`DRAGON_SLOTS`, line 76) with the Gol table above.
  - Movement helpers: `DragonTrapezoid` (line 378) fits the dive / charge (0x13) and the
    dash (0x26) ASSUMED; the circle (0x24) and the steering (0x28) need their own code.
  - Breath / fire: `DragonFlame`, `DragonFireball` (500 / 464) for 0x1c-like attacks
    (ASSUMED match, not verified against the Gol particles).
- Not reusable: hit boxes (`DRAGON_BODY_BOXES`, `DRAGON_TAIL`), the mouth and feet nodes,
  and the Dragon's particle and SE ids.

## Checks

None run; this is a map. The port has nothing to test yet. Constants above were read
from the exe by `tools/exedata.py` or from the decompile; runtime BSS floats are not.
