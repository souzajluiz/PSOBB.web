# Gal Gryphon brain: states 0..17 (exe map)

Scope: state table `0x009a7e40` entries 0..17 (the handlers), their phases, motion, transitions,
movement, attacks, FX/SE and the shared helpers they call. States 18..34 are in
`galgryphon-states-b.md`. No code change in this file.

Source: Ghidra headless on `PsoBB.exe` (`tools/ghidra/Decompile.java`, run from this worktree)
for every handler and helper named here; constants read with `tools/exedata.py`; motion rows
read with `tools/exedata.py motions`; motion names and frame counts parsed from
`bm_boss5_gryphon.bml` in `data.gsl` with `client/src/formats/archives.ts` + `bml.ts` +
`rel.ts` (NMDM header, frameCount at chunk+4). Net-message names from `vendor/newserv`.

Legend: **PROVEN** = read in the decompile or data. **ASSUMED** = inferred from a name, a table
shape or a consumer; check before porting. **UNCLEAR** = not decided by what was read.

## Conventions (read first)

- Ghidra prints `param_1[N]` (int index). Byte offset = N*4. This doc uses **byte offsets**.
  The DEVLOG's "+0x132 busy" is `param_1[0x132]` = **+0x4c8**; "+0x13b" = **+0x4ec**; "+0x1b9" =
  **+0x6e4** (sub-step), "+0x1ba" = **+0x6e8**, "+0x131" = **+0x4c4** (pattern record pointer),
  "+0x2e" (short) = **+0xb8** (motion slot), "+0x2c" = **+0xb0** (motion flags), "+0x2d" = **+0xb4**
  (current motion's flags column), "+0x32" = **+0xc8** (frame step).
- Motion object fields (all byte offsets on the boss, PROVEN from `FUN_007aa094` /
  `FUN_007a9a6c` / `FUN_007aaa30`): `+0xb8` slot (short), `+0xba` previous slot, `+0xb0` motion
  flags (bit 0x10 = motion-finished, PROVEN for the reader in states 4/5; setter ASSUMED),
  `+0xb4` flags of the current row, `+0xc0` frame (float), `+0xc4` end frame, `+0xc8` step,
  `+0xd8` motion table pointer (ctor writes `&DAT_009a7c80` at `param_1[0x36]`, i.e. **+0xd8**;
  the DEVLOG's "this+0x144" is wrong), `+0xf4` loop mode.
- Position `+0x38/+0x3c/+0x40` = x / height y / z (PROVEN from `FUN_0078730c`, state 5 code).
  Heading `+0x60` = 16-bit BAMS angle (0x10000 = 360 deg), PROVEN from `FUN_0082dcbc`.
  Velocity accumulators `+0x47c` (x) and `+0x484` (z), PROVEN from `FUN_004a15ac`.
  Turn accumulator `+0x488`, PROVEN from `FUN_004a5e10`.
  Target: entity id short `+0x394`, target x `+0x39c`, target z `+0x3a4` (PROVEN, `FUN_004a1328`).
  Vector to target `+0x3a8/+0x3b0`, distance `+0x3b4` (PROVEN, `FUN_00521410`/`FUN_007828e4`).
  Sound emitter position `+0x568` (ASSUMED, the `param_1+0x15a` pointer passed to SE calls).
  FX template table pointer `+0x5f8` (PROVEN): `*(int*)(+0x5f8)` is an int array; slot k is
  `*(int*)(*(int*)(+0x5f8) + 4k)`. Used slots: 0 (ground impact), 1 (cutscene event), 2 (shot),
  3 (beam), 4..8 (see states), 0x10 (muzzle), 0x18/0x1c/0x20 (flame/aura). The ids are data,
  not literals.
- Pattern record pointer `+0x4c4`: `FUN_004a7e20` advances it by 0x14 and transitions to the
  `short` at the new record's offset 0 (PROVEN). Record fields used: `+4` int (turn), `+8` (speed
  or sign, see states 8/9/14), `+0xc` float (speed or radius), `+0x10` float (radius). Who fills
  the table: UNCLEAR (not in 0..17 nor the ctor `0x004a67c0`).
- Phases (PROVEN from `FUN_004a70e0` and the handler switches): `4` enter, `5` leave, `0` frame.
  Frame update calls phase `0` only when `+0x4e8 == 1`, else phase `8` then `0`. Phases `2`, `9`,
  `0xb` are no-ops in most handlers (ASSUMED: hit/damage notifications). Phase `3` is read only by
  state 3 (dispatcher for it UNCLEAR). `+0x4e8` (leader flag) = `FUN_00694cc8()!=0 && FUN_00520db0()==0`
  (ctor and frame update; the meaning of those two calls is UNCLEAR).
- Dispatcher `0x004a85f0` (PROVEN): `table[state*8](phase)`, with the `adj` word compared
  to `DAT_00903bd0` (0 in all 35 rows).
- Motion slot = row index in `0x009a7c80` (16-byte rows, PROVEN from `tools/exedata.py motions`:
  `u16 mode, u16 next, u32 motion, f32 speed, u32 flags`). Slots 28..39 read past the table and
  are the state table itself, so valid slots are **0..27**.
- Motion index -> name: the `motion` column is the 0-based index of the `.njm` entries of
  `bm_boss5_gryphon.bml` in BML order (ASSUMED but strongly supported: slot 0 loop = `stand`,
  slot 4 loop = `fly`, slot 3 once = `takeoff`, slot 5 once = `land`, slot 24 = `shot`,
  slot 26 once = `dead`, slot 25 = `op` 500 frames).

### BML motion list (PROVEN: names and NMDM frame counts)

| idx | file | frames | | idx | file | frames |
|---|---|---|---|---|---|---|
| 0 | fly_boss5_s_body.njm | 30 | | 14 | huse_boss5_s_body.njm | 14 |
| 1 | hoe_boss5_s_body.njm | 30 | | 15 | husein_boss5_s_body.njm | 14 |
| 2 | kakuin_boss5_s_body.njm | 30 | | 16 | dead_boss5_s_body.njm | 150 |
| 3 | kakuland_boss5_s_body.njm | 40 | | 17 | kiri_boss5_s_body.njm | 20 |
| 4 | kakuout_boss5_s_body.njm | 30 | | 18 | kiriland_boss5_s_body.njm | 30 |
| 5 | kaku_boss5_s_body.njm | 20 | | 19 | kirin_boss5_s_body.njm | 20 |
| 6 | land_boss5_s_body.njm | 40 | | 20 | kiriout_boss5_s_body.njm | 20 |
| 7 | op_boss5_s_body.njm | 500 | | 21 | run_boss5_s_body.njm | 20 |
| 8 | shot_boss5_s_body.njm | 30 | | 22 | runin_boss5_s_body.njm | 10 |
| 9 | stand_boss5_s_body.njm | 30 | | 23 | runout_boss5_s_body.njm | 35 |
| 10 | takeoff_boss5_s_body.njm | 40 | | 24 | tuno_boss5_s_body.njm | 10 |
| 11 | walk_boss5_s_body.njm | 30 | | 25 | tunoin_boss5_s_body.njm | 30 |
| 12 | huseout_boss5_s_body.njm | 14 | | 26 | tunout_boss5_s_body.njm | 30 |
| 13 | houko_boss5_s_body.njm | 30 | | | | |

Other BML entries are the models `boss5_s_body.nj`, `boss5_ss_body.nj`, `lo_boss5_s_body.nj`,
`lo_boss5_ss_body.nj` (not motions).

### Motion slot rows used by states 0..17 (PROVEN from the table; names from the BML list)

| slot | mode | next | motion (name, frames) | speed | flags |
|---|---|---|---|---|---|
| 0 | 1 loop | 0 | 9 (stand, 30) | 0.8 | 0 |
| 1 | 1 loop | 0 | 11 (walk, 30) | 0.5 | 0 |
| 3 | 3 once | 0 | 10 (takeoff, 40) | 0.5 | 0 |
| 4 | 1 loop | 0 | 0 (fly, 30) | 0.77 | 0 |
| 5 | 3 once | 0 | 6 (land, 40) | 0.48 | 0 |
| 6 | 2 chain | 7 | 2 (kakuin, 30) | 0.7 | 6 |
| 7 | 1 loop | 0 | 5 (kaku, 20) | 0.9 | 7 |
| 8 | 3 once | 0 | 4 (kakuout, 30) | 0.57 | 0 |
| 9 | 3 once | 0 | 3 (kakuland, 40) | 0.7 | 0 |
| 19 | 2 chain | 20 | 19 (kirin, 20) | 0.5 | 0x13 |
| 20 | 1 loop | 0 | 17 (kiri, 20) | 1.0 | 0x14 |
| 24 | 3 once | 0 | 8 (shot, 30) | 0.65 | 0 |
| 25 | 3 once | 0 | 7 (op, 500) | 1.0 | 0x80000000 |
| 26 | 3 once | 0 | 16 (dead, 150) | 0.5 | 0 |

Mode meaning (ASSUMED from `FUN_007aa094`, which does the reading): 1 = wrap at end (loop);
3 = at end switch to mode 5 and step 0 (play once, hold last frame); 2 = at end, if the `next`
slot has data, `FUN_007a9a6c(next)`, else wrap; 5 = hold (frame -= step). Mode 4 is set by
`FUN_007a9a6c` on a slot change (ASSUMED: blend/transition). Row `flags` equals the slot number
in every row above, so `+0xb4 == N` tests "slot N is playing" (PROVEN for states 12 and 17).

---

## Helpers (shared; each address once)

| addr | name used | what it does (PROVEN unless noted) |
|---|---|---|
| 0x007aa094 | motion tick | Per tick: `+0xc0 += +0xc8`; mode switch on `+0xf4` (wrap / chain / hold). Sets `+0xb0` bits. Calls `FUN_007a9a6c` on chain. Skipped if `+0xb0 & 0x40`. |
| 0x007a9a6c | motion start | `FUN_007a9a6c(slot)`: writes `+0xb8`, `+0xc0`, `+0xc4` (frames from `*(+0xf8)+4`), `+0xc8` (row speed), `+0xf4` (row mode), `+0xb4` (row flags). |
| 0x007aaa30 | motion event | `FUN_007aaa30(f)` = 1 iff `f < +0xc0 <= f + +0xc8` and not "anim change pending" (`FUN_007a9970`). "Frame f was crossed this tick". Every `0x4xxxxxxx` argument in the states is a frame number. |
| 0x007aabd8 | motion frame | Returns `+0xc0` (the current motion frame), or 0 if `+0xb0 & 4`. **Not a distance** (the DEVLOG says distance; it is the frame). |
| 0x007a99a0 | frame getter | Returns `+0xc0`. Used by `FUN_007aabd8`. |
| 0x007a9970 | anim pending | `*(short*)(+0xb8) != *(short*)(+0xba)`. |
| 0x007a9928 / 0x007a994c | flag test / clear | Test / clear bits of `+0xb0`. |
| 0x007aab94 | next slot ok | Frame-data existence check for a slot index (returns a dword from `+0xdc`). |
| 0x004a15ac | step | `FUN_004a15ac(speed, heading)`: `+0x47c += sin(h)*speed`, `+0x484 += cos(h)*speed`. Called as `func_0x004a15ac(speed, +0x60)`. |
| 0x0082dcbc | sin16 | `sin(angle16)` (4096-entry table at 0x0098b560, starts 0.0). |
| 0x0082ddd8 | cos16 | `cos(angle16)` (table 0x0098c560, starts 1.0). |
| 0x004a15e8 | front pair | Calls `FUN_004a121c` and `FUN_004a115c` (two muzzle shots, see 4a121c). |
| 0x004a15fc | ground impact | `FUN_004a15fc()`: sphere query (`FUN_00780630`, mask 0x16ef) at the boss point (x, y, z). If a hit and the hit's y <= `DAT_00903ae0` (6.0): FX slot 0 at boss pos + SE 0x39b at `+0x568`. Y-test only; no damage here (PROVEN code, ASSUMED meaning). |
| 0x00780630 | sphere query | Walks the collider list at `DAT_00aab3f0+0x1c` (entries: `+4` x, `+0xc` z, `+0x10` radius, `+0x14` mask). Returns the first hit with `mask & m` and XZ distance <= radius (max 0x100 hits). |
| 0x004a1a48 | ground check | `if FUN_007aaa30(14.0) FUN_004a15fc()`. |
| 0x004a1b84 | steer to target | `FUN_004a1b84(rate)`: `FUN_00521410` (vector to target), then `FUN_004a5e10(rate, atan2(+0x3a8,+0x3b0) as angle16)`. |
| 0x004a5e10 | turn toward | `FUN_004a5e10(rate, target)`: `d = angdiff(target, +0x60)`, `e = angdiff(0.6*d (int), +0x488)`, clamp e to +-rate, `+0x488 -= e`. |
| 0x00521410 | target vector | `+0x3a8 = +0x39c - x`, `+0x3b0 = +0x3a4 - z`, `+0x3b4 = hypot(+0x3a8,+0x3b0)`. |
| 0x004a0f10 | SE tick | `FUN_004a0f10()`: `if FUN_007aaa30(21|5|20|8)` then SE 0x3a2 at `+0x568`. |
| 0x004a0f70 | shot tick | `FUN_004a0f70()`: 4 frame events from `DAT_00a47568/6c/70/74` (runtime, UNCLEAR values) call `FUN_004a121c` / `FUN_004a115c` / `FUN_004a109c` / `FUN_004a0fdc`. |
| 0x004a121c, 0x004a115c, 0x004a109c, 0x004a0fdc | muzzle fire | Each: builds local point `(0, 10, 15)` (PROVEN constants), transforms by the bone matrix (`FUN_004ab96c`, `FUN_0051fdf8`) into `+0x3d4` / `+0x3e0` / `+0x458` / `+0x464`, then spawns FX slot 2 there (`FUN_0050b7a4`) and calls `FUN_004a0d3c`. |
| 0x004a0d3c | shot object | `FUN_004a0d3c()`: `obj = FUN_0050b7a4()` (FX spawn object, 0xd0 bytes), `obj+0x50 = FUN_005b8610(1)`, `obj+0x54 = DAT_00a4762c`, `obj+0x60 = 1.0`, `obj+0x2c |= 0x200`. A projectile/bullet object; its damage path is UNCLEAR. |
| 0x004a12dc | sync tick | Every 32 calls (`+0x498 & 0x1f == 0`): `FUN_0052126c` decides between `FUN_005213ec(0,0)` and `FUN_005213d8`, then `FUN_004a1328`. Called only from phase 8 (non-leader path). |
| 0x004a1328 | 6x9F send | `FUN_008003e0(0x9f, +0x394 (entity id), +0x39c (x), +0x3a4 (z))`. newserv `G_GalGryphonBossActions_6x9F` = {entity header, u32 target_entity_id, f32 target_x, f32 target_z} (PROVEN match). |
| 0x008003e0 | net packet | Builds and queues a game subcommand from `(cmd, args...)`. Used with 0x9f (6x9F), 0x76 (6x76), 0x75 (6x75). |
| 0x006b9b44 | 6x75 | `FUN_006b9b44(id)` = `FUN_008003e0(0x75, id, difficulty DAT_00a9cd68)`: 6x75 set-quest-flag (newserv `G_UpdateQuestFlag_V3_BB_6x75`). |
| 0x006bb100 | flag or send | `FUN_006bb100(id)`: if `FUN_007a61a4() == 0xb` then `FUN_006b9b44(id)` (6x75) else `FUN_006bb130()` (local bit set, no packet). `FUN_007a61a4` returns `DAT_00aab384` (ASSUMED: mode/lobby state). |
| 0x008113e4 | 6x76 | `if (+0x80 != 0) { FUN_008003e0(0x76, DAT_00aafca0 as short); return 1 }` (ASSUMED: sets the boss set-flag on death; newserv `G_SetEntitySetFlags_6x76`). |
| 0x0051f894 | on-killed | `FUN_00787534(); FUN_008113e4(this)`. Called from state 5 leave. |
| 0x0078730c | pos save | Copies `+0x38/+0x3c/+0x40` to `+0x300/+0x304/+0x308`; if `+0x2b4` set, `+0x304 = obj+0x10 * DAT_0097a1ec + y` (PROVEN). |
| 0x00814298 | SE | `FUN_00814298(sfx, pos*, 0, 0)`: plays SE id, positional if `pos` given (returns handle). |
| 0x008144b0 | SE (variant) | Same shape as `FUN_00814298`, extra flag argument (used with 0x39c). |
| 0x0050b7a4 / 0x0050981c | FX spawn | `FUN_0050b7a4(pos*, fx_index, flags)` allocates a 0xd0-byte effect object (vtable `0x00aff308`), position copied from `pos`, effect table `DAT_00a72cd0 + index*0x98`. `FUN_0050981c` is the same without the `+0x34 = 1` line. |
| 0x004d31f4 | director mode | `FUN_004d31f4(5)` sets the director mode byte (`DAT_00a489f4`) and calls its vtable `+0x14`. Used at state 4 enter and state 5 enter (ASSUMED boss-cam). |
| 0x004d6770 | director event | `FUN_004d6770(buf, id)` writes `DAT_00a48b20 = id` and `DAT_00a48b24 = object`. Ids used: 0x31c7 (state 5 enter), 0x238e (`FUN_004a92b4`). ASSUMED cutscene events; UNCLEAR. |
| 0x004d430c | camera shake | `FUN_004d430c(amp, duration)`: sets `DAT_00a48a54+0x1c4 = amp`, `+0x1c0 = duration`, then `FUN_006ff5f8(0x60, duration)`. |
| 0x004d4288 | shake preset | `FUN_004d4288(k)`: k=0 -> (0.0175 0x3c8f5c29, 20 frames, `FUN_006ff5f8(0x60,20)`), k=1 -> (0.175 0x3e333333, 30, `FUN_006ff5f8(0xa0,30)`), k=2 -> (0.05 0x3d4ccccd, 30, `FUN_006ff5f8(0xe0,30)`). |
| 0x006ff5f8 | event queue | Writes a 16-slot record: tag byte `0x1d`, `+0x10 = a` (short), `+0x12 = b` (short). The consumer is not decoded (UNCLEAR). First-argument values seen: 0x1c, 0x60, 0x80, 0xa0, 0xc0, 0xe0 (these coincide with newserv subcommand numbers 6x60 drop request, 6xC0 shop sell, 6xE0 quest drop, 6xA0 boss actions, so the consumer may send some of them; NOT verified). |
| 0x004a92b4 | aura | Allocates a 0x28-byte object `FUN_005caba4(0x28)` (through `FUN_007a8a38`), then `FUN_004a92b4(DAT_00aca37c, 1.0, +0x6f0)` creates an aura (vtable `0x00afa018`), and `FUN_004d6770(buf, 0x238e)`. |
| 0x004a8a88 | FX release | Sets bit 0 (dead) on the FX handles at `+0x73c..+0x778` and clears them. |
| 0x004a8d0c / 0x004a8d5c | event script VM | `FUN_004a8d0c`: selects a script pointer at `+0x77c` from `+0x780` by `+0x4ec` (1->+0x8, 2->+0x5c, 3->+0x60, else +0x40). `FUN_004a8d5c`: runs one 0x48-byte opcode record; opcodes 0x21 skip, 0x22 end, others via table `0x009a7f60`. Its opcodes (and any `FUN_0051f62c`) are the data-driven transitions of state 4 (UNCLEAR). |
| 0x004a7e20 | next state | `FUN_004a7e20()`: `rec = +0x4c4; +0x4c4 += 0x14; s = *(short*)(rec+0x14)`; if `s != +0xb8` then `FUN_0051f62c(s)`. PROVEN. Data-driven: the next state is the pattern table's next record. |
| 0x0051f62c | transition | `FUN_0051f62c(s)`: `ProcessState(old, 5)`, `ProcessState(s, 4)`, `+0x32e = s`. PROVEN. |
| 0x0051f81c | death check | Called from the frame update when vtable `+0x88` returns nonzero (ASSUMED: death/ kill test; not read). |
| 0x004a9174 / 0x004a91fc | part toggles | `FUN_004a9174` sets bit 0 on each part entry (stride 0x2c) of `+0x1c`'s list (hide), `FUN_004a91fc` clears it (show). Not called from states 0..17 (ASSUMED used elsewhere). |
| 0x004a2bb0 / 0x004a2ea8 / 0x004a323c / 0x004a3314 | beam geometry | Render-side geometry for lightning / beam (control points at `+0x3ec..+0x448`, 4-point curves, `DAT_00a47654`, `DAT_00a47648` ribbon handles). `FUN_004a3314` spawns or updates three FX at `+0x44c` + sin/cos offset, slots `+0x18/+0x1c/+0x20`, handles `+0x72c/+0x730/+0x734`. Not gameplay (ASSUMED). `FUN_004a2ea8` is not fully read. |
| 0x004a1f34 | landing FX | Builds a vector at `DAT_00a47640+0x10`, `FUN_004ab96c(+0x38, v)`, `FUN_0051fdf8(+0x38, v, ...)` (emit line/ring FX). UNCLEAR detail. |
| 0x007be6b8 | cubic Bezier | `FUN_007be6b8(points, n=4, t, mode, out)`: Bernstein weights `C(n-1,i) * t^i * (1-t)^(n-1-i)` over the control points (x,y,z stride 0x10). Used by state 15. |
| 0x0082e900 | fabs | `fabs(float)`. |
| 0x007a900c | angle diff | `(short)(b - a)`, wrapped 16-bit difference. |
| 0x007828e4 | hypot2 | `sqrt(x*x + z*z)` of a vector (x at +0, z at +8). |
| 0x00520750 | move attempt | `FUN_00520750(this, point)`: calls vtable `+0x1a4(point)` (collision/ path test, UNCLEAR detail); on success stores the previous position and `+0x94..+0x96` from its result and sets `+0xe3 = 0`; on failure `+0xe3++`. |
| 0x00521454 | step request | `FUN_00521454(flag, dist)` = `FUN_00521480(buf, flag, dist)` then `FUN_00520750(buf)`. In state 2: `(0x100, 1.8)`. UNCLEAR detail of `FUN_00521480`. |
| 0x0068d5a8 | player present | `FUN_0068d5a8(i)`: `(&DAT_00a94254)[i]` for 0 <= i < 12, else 0. Presence of player slot i (ASSUMED). |
| 0x00717f74 / 0x00717f38 | slot freeze | Loops over 12 slots of `DAT_00a98478+0x54`, calls `FUN_007160a0` (freeze) or `FUN_007160b4` (release). ASSUMED: player freeze during the op cinematic. |
| 0x00520e2c / 0x00520e34 | cine on/off | Call `FUN_0069448c` / `FUN_006944b8`. UNCLEAR. |
| 0x004d3250 | boss-cam | Copies the boss object's camera fields and calls the director object's vtable `+0x1c` for target `FUN_0068d5a8(DAT_00a9c4f4)`. ASSUMED. |
| 0x00814f0c | cutscene audio | `FUN_00814f0c()`: `if FUN_00483748() FUN_0086df38(DAT_00ac9ca8, FUN_00814c00())`. Called with `"dradeath.adx"` (`0x008fc30c`) in state 5 enter. ASSUMED: plays the ADX. |
| 0x00787578 (vtable +0x130) | | Called with 0 from state 5 leave. UNCLEAR. |
| 0x007782b4 (vtable +0xac), 0x00778580 (vtable +0xb0) | | Called in the frame update before the state tick. UNCLEAR. |
| 0x00520504 (vtable +0x184), 0x00520528 (vtable +0x188) | set anim | Called on enter in all states (after writing `+0xb8`). Not read; they wrap `FUN_007a9a6c`. ASSUMED. |

Frame update `0x004a70e0` (PROVEN): returns early if `FUN_004f7c84()`; if `+0x4c8 & 1` (flinch/ busy),
`FUN_008113e4` and set bit; sets the leader flag; calls vtable `+0xac`, `+0xb0`; if `FUN_00520db8()==0`
it runs `ProcessState(state, 0)` (leader) or `ProcessState(state, 8)` then `ProcessState(state, 0)`
(non-leader); then `FUN_0051f604`, `FUN_004a7c44`, `FUN_004a7dac`, `FUN_004a7de8`, vtable `+0x168`,
`FUN_004a7e44`, `FUN_006401f0`, `FUN_0080575c`, `FUN_00817574`, `FUN_00520dc0`, four `FUN_005771a4`,
and `FUN_004a7e74` when `+0x4ec != 0`.

---

## Per-state specifications

Handler addresses are the table entries (`0x009a7e40 + 8*N`). "enter" = phase 4; "leave" = phase 5.
Sub-step variable = `+0x6e4` (sub) and `+0x6e8` (count) unless stated.

### S0 - `0x004a8e34` - FULLY SPECIFIED (empty)
- Every phase returns immediately. Ghidra folds the 12 switch cases to one target.
- Motion: none. Transitions: none. Not used by the Gryphon brain as far as states 0..17 show
  (ASSUMED: placeholder row).

### S1 - `0x004a0d8c` - FULLY SPECIFIED (idle, no exit inside this state)
- enter: `+0xb8 = 0` (slot 0 = stand, loop, speed 0.8). `+0x4ec = 0`. `+0x3c = DAT_00a47564`
  (default height, runtime, UNCLEAR value).
- frame (0): `FUN_007aa094()` only.
- No transitions in this handler. Exit only from outside (UNCLEAR who).

### S2 - `0x004a0dd8` - FULLY SPECIFIED except the fire-frame globals (walk, shoot, step)
- enter: `+0xb8 = 1` (slot 1 = walk, loop, speed 0.5). `+0x4c8 |= 0x10` (busy). `+0x4ec = 0`.
  `+0x3c = DAT_00a47564`. `+0x498 = 0` (sync counter).
- frame (0): `FUN_007aa094()`; `FUN_004a0f10()` (SE 0x3a2 at motion frames 21, 5, 20, 8);
  `FUN_00521410()` (vector to target); `FUN_004a0f70()` (4 muzzle shots at frames
  `DAT_00a47568/6c/70/74`, values UNCLEAR, see helpers); then step on `d = FUN_007aabd8()`
  (the motion FRAME, not a distance):
  - `d < 4.0` (`DAT_00903fc4`): `FUN_00521454(0x100, 1.8)`.
  - `4.0 <= d < 10.0` (`DAT_00903fc0`): nothing.
  - `10.0 <= d < 18.0` (`DAT_00903fbc`): `FUN_00521454(0x100, 1.8)`.
  - `18.0 <= d < 25.0` (`DAT_00903fb8`): nothing.
  - `d >= 25.0`: `FUN_00521454(0x100, 1.8)`.
- phase 8 (non-leader only, before frame): `FUN_004a12dc()` = 6x9F target sync every 32 ticks.
- leave: `+0x4c8 &= ~0x10`.
- Transitions: none inside. Motion: slot 1 only.

### S3 - `0x004a2744` - FULLY SPECIFIED (wait for players, then to S11)
- enter: `+0xb8 = 0` (stand). `+0x6e4 = 0` (counter).
- frame (0): if any of `FUN_0068d5a8(0..3)` is nonzero (a player in slot 0..3): `+0x6e4 += 1`.
- phase 3: `if (+0x6e4 > 150) FUN_0051f62c(11)` (to S11 land). 0x96 = 150 frames.
- Motion: stand (slot 0). No movement. Heights unchanged.
- UNCLEAR: which code dispatches phase 3 (not the frame update). Likely the base or a host hook.

### S4 - `0x004a22b0` - PARTIAL (the entrance cinematic "op")
- enter: init-once (`DAT_00a474c0 & 1`): `DAT_009a8134 = 180.0` (`0x43340000`). Then:
  `+0x4ec = 1`, `+0xb8 = 0`, `FUN_007aa094()`, `+0x38 = 0`, `+0x3c = 0`, `+0x40 = 0`, `+0x5c = 0`,
  `+0x60 = 0`, `+0x64 = 0`, `+0x6e4 = 0`, `+0x6e8 = 0`, `+0x6ec = 0`, `+0x6f0 = 1`, `+0x4c8 |= 0x80`.
  Aura: `FUN_005caba4(0x28)`; if ok `FUN_004a92b4(DAT_00aca37c, 1.0, +0x6f0)`.
  `+0xb8 = 0x19` (slot 25 = op, 500 frames, once, speed 1.0). `FUN_00717f74()` (freeze slots),
  `FUN_00520e2c()`.
- frame (0):
  - if `+0x6e4 == 0`: `FUN_007aa094()`; if `+0xb0 & 0x10` (motion finished): `+0x6e4 = 1`,
    `FUN_00717f38()` (release slots), `+0xb8 = 4` (fly loop). Then if `+0x6ec == 0`: the timeline
    (motion frames, PROVEN events):
    - frame 68.0 (`0x42880000`): FX slot 1 at `DAT_009a8118` (27, 0, 175), queue `0x1c, 0x3c`.
    - else frame 212.0 (`0x43520000`): FX slot 1 at `DAT_009a8124` (153, 437, 1347), queue `0xc0, 0xf`.
    - else frame 418.0 or 463.0: FX slot 0 at `DAT_009a8124`.
    - frame 290.0 (`0x43910000`): SE 0x39a at origin (0,0,0), queue `0xa0, 0x3c`.
    - frame 100.0 (`0x42c80000`) or 405.0 (`0x43ca8000`): SE 0x3a3 at origin.
    - frame 212.0: SE 0x3a7 at origin.
    - frame 455.0 (`0x43e38000`): SE 0x3a3 at origin, queue `0x80, 7`.
    - frame 265.0 (`0x43848000`): `FUN_004ab934()`.
    - Note the 68/212/418/463 branch is nested as in the code (only one FX per frame).
  - else if `+0x6e4 == 1`: copy home position: `+0x38 = DAT_009a8130` (23.0), `+0x3c = DAT_009a8134`
    (180.0 after init), `+0x40 = DAT_009a8138` (991.0), `+0x5c/+0x60/+0x64 = DAT_00903ec0/ec4/ec8`
    (raw words, see constants); `FUN_007aa094()`.
  - else return.
- phase 2 / 9: if `+0x6e4 == 1`: `FUN_004a8d5c()` (one event-script opcode).
- leave: `+0x48c = 0; +0x38 = DAT_009a8130; +0x3c = DAT_009a8134; +0x40 = DAT_009a8138;
  +0x490 = 0; +0x494 = 0; +0x5c/+0x60/+0x64 = raw; +0x6f0 = 0; +0x4c8 &= ~0x80; FUN_00717f38();
  FUN_00520e34()`.
- Transitions: none in code. Exit is data-driven via the script VM (UNCLEAR).
- Note: `+0x6e8` is written 0 at enter (the DEVLOG did not list it).

### S5 - `0x004a2008` - PARTIAL (death cinematic, ASSUMED; "dradeath.adx")
- enter: `+0xb8 = 0x1a` (slot 26 = dead, once, 150 frames, speed 0.5). `+0x4ec = 1`. `+0x4c8 |= 0xc4`
  (busy 0x80|0x40|0x4). `+0x3c = 180.0`. `+0x6e4 = 0`, `+0x6e8 = 0`, `+0x6fc = 0`. Heading `+0x60` = angle16 of `atan2(0 - x, 0 - z)` (face the origin). Position:
  `x = -600 * sin(h)`, `z = -600 * cos(h)` (from `DAT_00903f08 = -600`), i.e. 600 units from origin,
  height 180. `FUN_00814f0c()` (plays "dradeath.adx" at `0x008fc30c`). `FUN_00717f74()`.
  Camera: `FUN_004d31f4(5)`, `FUN_004d6770(buf, 0x31c7)` (cutscene event, UNCLEAR), `FUN_004d681c(+0x38,+0x38,+0x5c)`
  (director: position/ target, UNCLEAR).
- frame (0): `FUN_007aa094()`. If `FUN_007aaa30(110.0)` (`0x42dc0000`): `FUN_0050b7a4` x4 at
  `(x, -30.0, z)` with FX ids: slot `0x201`, then `0x20d` three times; SE 0x3a6 at origin.
  Sub-step on `+0x6e4`:
  - sub 0: if `+0xb0 & 0x10` (dead motion finished): sub = 1, count = 0.
  - sub 1: `count += 1`; when `count > 49` (i.e. count reaches 50): `FUN_004a7e20()` (next state).
- leave: `+0x4c8 &= ~0x84`; save pos to `+0x300..`; `FUN_0051f894()` (on-killed: `FUN_00787534`,
  `FUN_008113e4` = 6x76); `FUN_006bb100(0x52)` (quest flag 0x52: 6x75 if mode 0xb, else local bit);
  restore pos; `FUN_0078730c()`; `+0x30 = 0x12008`; vtable `+0x130(0)`; `FUN_00717f38()`; `FUN_004d3250()`.
- Transitions: sub 1 -> next record (queue, S5 is the only state in this file that ends by queue after a fixed count).

### S6 - `0x004a1368` - FULLY SPECIFIED (takeoff, climb, descend to hover)
- enter: `+0xb8 = 3` (takeoff, once, 40 frames, speed 0.5). `+0x4ec = 0`. `+0x3c = DAT_00a47564`.
  `+0x6e8 = 0` (sub count, `param_1[0x1ba]`).
- frame (0): `FUN_007aa094()`; then by `sub = +0x6e8`:
  - sub 0: if `FUN_007aaa30(25.0)` (`0x41c80000`): `FUN_004a15ac(5.0, +0x60)`, `+0x4c8 |= 4`,
    `FUN_004a15e8()` (two front shots), `+0x4ec = 1`, `FUN_004d430c(0.15, 20)` (camera shake),
    SE 0x3a3 at `+0x568`, `+0x6e8 = 1`.
  - sub 1: `y = 12.5 * (d - 25)^2 + DAT_00a47564` where `d = FUN_007aabd8()` (frame);
    `FUN_004a15ac(1.0, +0x60)`; if `FUN_007aaa30(27.0)` (`0x41d80000`): `+0x6e8 = 2`.
  - sub 2: `y = 180 + ((180 - (50 + DAT_00a47564)) * -((30 - d)^2)) / 9`; `FUN_004a15ac(1.0, +0x60)`;
    if `FUN_007aaa30(30.0)` (`0x41f00000`): `+0x3c = 180`, `+0x6e8 = 3`.
  - sub 3: `FUN_004a15ac(1.0, +0x60)`; if `+0xc8 <= 0.0` (motion ended): `FUN_004a7e20()`.
  - Then (all subs): if `FUN_007aaa30(20.0)` or `FUN_007aaa30(28.0)`: `FUN_004a15fc()` (ground impact).
  - Constants: `DAT_00903f5c` = 25.0, `DAT_00903f60` = 50.0, `DAT_00903f64` = 30.0, `DAT_00903f80` = 4.0,
    `DAT_00903f84` = 50.0, `DAT_00903f8c` = 9.0, `DAT_00903f90` = 0.0, `DAT_00903fd8` = 180.0.
- leave: `+0x4ec = 1`, `+0x4c8 &= ~4`, `+0x3c = 180`.
- Transitions: sub 3 -> next record (queue) when the takeoff motion has ended.

### S7 - `0x004a1678` - PARTIAL (shot, beam; sub 0/1/2)
- enter: `+0xb8 = 0x18` (slot 24 = shot, once, 30 frames, speed 0.65). `+0x1b9 = 0` (sub),
  `+0x72c = 0` (beam handle), `+0x498 = 0`, `+0x3c = 180`, `+0x4ec = 1`.
- frame (0): `FUN_007aa094()`; sub:
  - sub 0 -> sub 1 (`+0x6e4 = 1`).
  - sub 1: `FUN_007aaa30(8.0)`: SE 0x39d at `+0x568`; `FUN_007aaa30(20.0)`: SE 0x39e; `FUN_007aaa30(12.0)`:
    `FUN_004a15fc()`. Then with `d = FUN_007aabd8()` (frame) and beam handle `+0x72c`:
    - no handle and `8.0 <= d <= 18.0`: create via `FUN_0050981c(+0x44c, FX slot 3, ...)`, store handle.
    - handle and `d > 18.0`: set dead bit on handle, clear.
    - handle otherwise: `FUN_00508db8(+0x44c, pos)` (move beam origin).
    Also `if FUN_007aaa30(20.5)`: target vector `(x,z)` = `(+0x39c, +0x3a4)` relative; beam from `+0x44c`
    to target + 150.0 * (cos, sin) of the vector heading (`DAT_00903f38` = 150.0);
    `FUN_005caba4(0x70)` + `FUN_004aa808(+0x4cc, this, +0x44c, pts, &vec, +0x394)` (beam object);
    `FUN_0050b7a4(+0x44c, FX slot 0x10, 0x40)` (muzzle); sub = 2.
  - sub 2: if `+0xc8 <= 0.0` (speed zero, motion ended): `FUN_004a7e20()`.
  - `FUN_004a15ac(speed, +0x60)` with speed from `+0xc8`.
- phase 8: `FUN_004a12dc()` (6x9F sync).
- leave: if `+0x72c` set: dead bit, clear.
- Constants: `DAT_00903f3c` = 8.0, `DAT_00903f40` = 18.0, `DAT_00903f44` = 0.5 (`0.5*y` on beam),
  `DAT_00903f58` = 0.0. `DAT_00903f38` = 150.0.
- Transitions: sub 2 -> next record (queue).

### S8 - `0x004a19c8` - PARTIAL (pattern-record flight)
- enter: `+0xb8 = 4` (fly). `+0x4ec = 1`. `+0x3c = 180`.
- frame (0): `FUN_007aa094()`; `FUN_004a1a48()` (ground check at frame 14); with record `r = +0x4c4`:
  `FUN_004a15ac(r.+8 (float), +0x60)` and `+0x488 += r.+4` (turn accumulator, PROVEN code).
- No transitions in code. Exit via outside (UNCLEAR).

### S9 - `0x004a1a64` - PARTIAL (orbit around origin)
- enter: `+0xb8 = 4`. `+0x4ec = 1`. `+0x3c = 180`. `+0x498 = 0`.
- frame (0): `FUN_007aa094()`; `FUN_004a1a48()`; `r = +0x4c4`:
  - `ang = atan2(x, z)` of the position (angle16 via `DAT_00903ad8/ad0` = 65536 / 2pi, double).
  - `k = 0x4000` (90 deg), or `0x5000` (112.5 deg) if `r.+0x10^2 < x^2 + z^2`; negated if `r.+8 < 1` (int).
  - `FUN_004a15ac(r.+0xc (float), ang + k)`.
  - `FUN_004a1b84(r.+4)`: steer toward target bearing with rate `r.+4`.
- No transitions in code. Exit via outside (UNCLEAR).

### S10 - `0x004a1be0` - PARTIAL (fly to waypoint)
- enter: `+0xb8 = 4`, `+0x4ec = 1`, `+0x3c = 180`. `+0x6f4 = angle16(atan2(r.+4 - x, r.+8 - z))`
  (r = `+0x4c4`; waypoint = `(r.+4, r.+8)` as floats; PROVEN code).
- frame (0): `FUN_007aa094()`; `FUN_004a1a48()`; `FUN_004a5e10(r.+0x10, +0x6f4)` (steer, rate r.+0x10);
  `FUN_004a15ac(r.+0xc, angle of fStack_20/fStack_1c)`; `if fStack_20 < 10.0 (DAT_00903f30)`:
  `FUN_004a7e20()`.
- CAVEAT: `fStack_20` and `fStack_1c` are not set in the decompile (Ghidra loses the write).
  ASSUMED: they are the waypoint delta `(dx, dz)`. Re-check the asm before porting.

### S11 - `0x004a1d3c` - FULLY SPECIFIED (land / descend)
- enter: `+0xb8 = 5` (land, once, 40 frames, speed 0.48). `+0x4c8 |= 4`. `+0x4ec = 1`. `+0x3c = 180`.
  `+0x6e4 = 0`.
- frame (0): `FUN_007aa094()`; sub `+0x6e4`:
  - sub 0: `FUN_004a15ac(0.75, +0x60)`; if `FUN_007aaa30(1.0)` (`0x3f800000`): sub = 1.
  - sub 1: `d = FUN_007aabd8()` (frame); `+0x3c = (180 - DAT_00a47564) * -((d - 1.0)^2) / 484.0 + 180`;
    `FUN_004a15ac(0.75, +0x60)`; if `FUN_007aaa30(23.0)` (`0x41b80000`):
    `+0x4ec = 0`, `+0x3c = DAT_00a47564`, SE 0x3a7 at `+0x568`, `FUN_0050b7a4(pos, FX slot 1, 0x40)`,
    `FUN_004d4288(1)` (shake preset), `FUN_004a1f34()` (landing FX), sub = 2.
  - sub 2: if `+0xc8 <= 0.0`: `FUN_004a7e20()`.
  - Always: `if FUN_007aaa30(24.0)` (`0x41c00000`): `FUN_004a15fc()`.
- leave: `+0x4ec = 0`, `+0x3c = DAT_00a47564`, `+0x4c8 &= ~4`.
- Constants: `DAT_00903fd8` = 180.0, `DAT_00903f14` = 1.0, `DAT_00903f28` = 484.0, `DAT_00903f2c` = 0.0,
  `DAT_00a47564` = runtime (UNCLEAR).

### S12 - `0x004a27c8` - FULLY SPECIFIED (kakuin, chained into kaku; wait for slot 7)
- enter: `+0xb8 = 6` (kakuin, loop mode 2 chaining to slot 7). `+0x4c8 |= 4`. `+0x4ec = 1`.
  `+0x3c = 180`. `+0x6e4 = 0`.
- frame (0): `FUN_007aa094()`; sub `+0x6e4`:
  - sub 0: height `y = (DAT_00a47590 - 180) * sin-ish + 180` (the cos term via `FUN_0082dcbc`; UNCLEAR
    which angle). If `FUN_007aaa30(18.0)` (`0x41900000`): sub = 1, count = 0.
  - sub 1: `count` runs 0..29 (`0x1e`): height and pitch `+0x5c = count * 6144 / 15` (`DAT_00903ea8`, `DAT_00903eb0`);
    the height interpolates between `DAT_00a47590` and 67.0 with amplitude `DAT_00903eb4` = 0.5. At 30:
    `+0x3c = 67.0`, `+0x5c = 0`, `+0x4ec = 2`, sub = 2.
  - sub 2: if `+0xb4 == 7` (slot 7 is now playing, i.e. the chain fired): `FUN_004a7e20()`.
  - Always: `FUN_004a15ac(0.25 or 2.1 table, +0x60)`; if `FUN_007aaa30(10.0)` (`0x41200000`): `FUN_004a15fc()`.
- leave: `+0x4ec = 2`, `+0x4c8 &= ~4`, `+0x3c = 67.0`, `+0x5c = 0`.
- Constants: `DAT_00903ea4` = 0.25, `DAT_00903ea8` = 6144.0, `DAT_00903eb0` = 15.0, `DAT_00903eb4` = 0.5,
  `DAT_00903eb8` = 2.1, `DAT_00903fd4` = 67.0, `DAT_00903fd8` = 180.0.

### S13 - `0x004a2ae0` - PARTIAL (kaku, beam or kiri mode)
- enter: `+0xb8 = 7` if `+0x4c8 & 0x100` == 0, else `0x14` (slot 20 = kiri). `+0x4ec = 2`. `+0x3c = 67.0`.
  `+0x6e8 = 0`.
- frame (0): `FUN_007aa094()`; `FUN_004a15ac(3.5, +0x60)`; if `+0x4c8 & 0x100`: `FUN_004a323c()` (beam ribbon
  build), `FUN_004a3314()` (three FX at `+0x44c`), return. Else: `FUN_004a2bb0()` (lightning mesh),
  `FUN_004a2ea8()` (not fully read; calls FX spawn and `FUN_004a8a88`), `FUN_008144b0(0x39c, this, +0x568, 0, 0)`.
- No transitions in code. The `0x100` flag is set by S17 and never cleared in 0..17 (UNCLEAR who clears it).

### S14 - `0x004a344c` - PARTIAL (kaku orbit with turn accumulator)
- enter: same as S13 (`+0xb8` = 7 or 0x14 by `+0x4c8 & 0x100`, `+0x4ec = 2`, `+0x3c = 67.0`).
- frame (0): `FUN_007aa094()`; `r = +0x4c4`; `k = 0x4000` or `0x5000` (outside radius test `r.+0xc`);
  `ang = atan2(x, z)`; `ang + k` vs `+0x60` via `FUN_007a900c`: `+0x488 += r.+4` when the diff is
  positive/negative (see code); `fStack_c = r.+8`; scaled by 0.8 when `|+0x488| > 6144.0`;
  `FUN_004a15ac(speed, +0x60)`; the `+0x64` damping (`DAT_00903e3c` = 6.0 test, `DAT_00903e38` = -4.0 gain,
  `DAT_00903e34` = 0.2 scale, `DAT_00903e44` = 6144.0 test, `DAT_00903e40` = 0.8 speed factor;
  the clamp is `+-0x5ff`/`0x600`); then the same beam / lightning split as S13 and `FUN_008144b0(0x39c, ...)`.
- No transitions in code.

### S15 - `0x004a36e4` - FULLY SPECIFIED (kakuland: Bezier descent, then to hover)
- enter: `+0xb8 = 9` (kakuland, once, 40 frames, speed 0.7). `+0x4c8 |= 4`, `+0x4ec = 1`, `+0x3c = 180`.
  `+0x498 = 0`. Clear the 16 FX handles at `+0x73c..+0x778` (`FUN_00508db8(0x9a810c)`, `FUN_00508f48`).
  `+0x6e4 = 0`.
- Bezier init once (`DAT_00a474c8 & 1`): `DAT_00a474e4 = 67.0`, `DAT_00a474f4 = 107.0`, `DAT_00a47504 = 147.0`,
  `DAT_00a47514 = DAT_00a47564`. (The x/z of the four control points at `0xa474e0..` are not set here.)
- frame (0): `FUN_007aa094()`; `FUN_004a15ac(1.5, +0x60)`; `t = FUN_007aabd8() / 20.0`;
  `FUN_007be6b8(0xa474e0, 4, t, 0, out)`; `+0x3c = out.y` (ASSUMED); sub `+0x6e4`:
  - sub 0: if `FUN_007aaa30(20.0)`: `+0x4ec = 0`, `+0x3c = DAT_00a47564`, SE 0x3a7 at `+0x568`,
    `FUN_0050b7a4(pos, FX slot 1, 0x40)`, `FUN_004d4288(1)` (shake), `FUN_004a1f34()` (landing FX), sub = 1.
  - sub 1: if `+0xc8 <= 0.0`: `FUN_004a7e20()`.
- leave (phase 5): `+0x4c8 &= ~4`; `FUN_004a8a88()`.
- Constants: `DAT_00903e1c` = 20.0, `DAT_00903e30` = 0.0; `DAT_00a47564` (runtime, UNCLEAR).

### S16 - `0x004a38f8` - MOSTLY SPECIFIED (dive/ rise with pitch count; uses runtime `DAT_00a475a8`)
- enter: `+0xb8 = 7` (kaku, loop, 20 frames, speed 0.9). `+0x4c8 |= 4`, `+0x4ec = 1`, `+0x3c = 180`.
  Clear FX handles (as S15). `+0x6e4 = 0`, `+0x6e8 = 0`.
- frame (0): `FUN_007aa094()`; sub `+0x6e4`:
  - sub 0: `count = +0x6e8`; `y = a475a8 + (a475a8 - 67) * 0.5 * cos-ish`, with the `DAT_00903e00` (19.5)
    split (`count >= 19.5`: plus, else minus); `+0x5c = count * DAT_00903dfc (-5120) / 19.5`;
    `count += 1`; at count 17 (`0x11`): `+0x2e = 8` (anim to slot 8 = kakuout); at count > 39 (`0x27`):
    `+0x5c = 0`, `+0x3c = a475a8`, sub = 1.
  - sub 1: `FUN_004a15ac(0.25, +0x60)` (speed `DAT_00903e14`); `d = FUN_007aabd8()`; `y = a475a8 - (a475a8 - 180) * cos-ish(d)`;
    if `FUN_007aaa30(17.0)` (`0x41880000`): `FUN_004a15fc()`; if `+0xc8 <= 0.0`: `FUN_004a7e20()`.
- leave: `+0x4c8 &= ~4`, `FUN_004a8a88()`, `+0x5c = 0`.
- Constants: `DAT_00903e04` = 0.5, `DAT_00903dfc` = -5120.0, `DAT_00903e00` = 19.5, `DAT_00903e08` = 2.3,
  `DAT_00903e14` = 0.25, `DAT_00903e18` = 0.0, `DAT_00903e1c` = 20.0, `DAT_00903fd4` = 67.0, `DAT_00903fd8` = 180.0,
  `DAT_00a475a8` = runtime (UNCLEAR).

### S17 - `0x004a3c08` - FULLY SPECIFIED (kirin -> kiri; sets flag 0x100)
- enter: `+0xb8 = 0x13` (kirin, chain to 20, 20 frames, speed 0.5). `+0x4c8 |= 0x104` (0x100 + 4).
  `+0x3c = 180`. `+0x6e4 = 0`.
- frame (0): `FUN_007aa094()`; sub `+0x6e4`:
  - sub 0: `d = FUN_007aabd8()`; `y = (a475ac - 180) * sin-ish + 180`; if `FUN_007aaa30(9.0)` (`0x41100000`):
    sub = 1, count = 0.
  - sub 1: `count` 0..20 (`0x14`): `y` interpolates between `a475ac` and 67.0 with amplitude `DAT_00903dec` = 0.5;
    `+0x5c = count * 6144 / 10` (`DAT_00903de0`, `DAT_00903de8`); at count 21: `+0x3c = 67.0`, `+0x5c = 0`,
    `+0x4ec = 2`, sub = 2.
  - sub 2: if `+0xb4 == 0x14` (kiri playing): `FUN_004a7e20()`.
  - Always: `FUN_004a15ac(2.1 or 0.25, +0x60)` (`DAT_00903df0` = 2.1, `DAT_00903ddc` = 0.25); if `FUN_007aaa30(5.0)` (`0x40a00000`): `FUN_004a15fc()`.
- leave: `+0x4ec = 2`, `+0x4c8 &= ~4` (the 0x100 bit is NOT cleared), `+0x3c = 67.0`, `+0x5c = 0`.
- Constants: `DAT_00903ddc` = 0.25, `DAT_00903de0` = 6144.0, `DAT_00903de8` = 10.0,
  `DAT_00903dec` = 0.5, `DAT_00903df0` = 2.1, `DAT_00903fd4` = 67.0, `DAT_00903fd8` = 180.0, `DAT_00a475ac` = runtime.

---

## Constants (address -> value)

Read from `tools/exedata.py read ADDR f 1` (4-byte float) unless marked. Values marked `d` are
8-byte doubles read with `read ADDR d 1` (used in `float10` expressions).

| addr | value | used in |
|---|---|---|
| 0x00903f9c | 0.0 | S4/S5 origin x (also sync origin) |
| 0x00903fa4 | 0.0 | S4/S5 origin z |
| 0x00903f08 | -600.0 | S5 death radius |
| 0x00903fb8 | 25.0 | S2 threshold (`>=`) |
| 0x00903fbc | 18.0 | S2 threshold |
| 0x00903fc0 | 10.0 | S2 threshold |
| 0x00903fc4 | 4.0 | S2 threshold |
| 0x00903fd4 | 67.0 | hover low height S12/S13/S14/S16/S17 |
| 0x00903fd8 | 180.0 | hover high height S1..S17 |
| 0x00903f14 | 1.0 | S11 descent offset |
| 0x00903f28 | 484.0 | S11 descent divisor |
| 0x00903f2c | 0.0 | S11 end test |
| 0x00903f30 | 10.0 | S10 waypoint radius |
| 0x00903f38 | 150.0 | S7 beam length |
| 0x00903f3c | 8.0 | S7 beam window start |
| 0x00903f40 | 18.0 | S7 beam window end |
| 0x00903f44 | 0.5 | S7 beam height factor |
| 0x00903f58 | 0.0 | S7 sub-2 speed test |
| 0x00903f5c | 25.0 | S6 parabola |
| 0x00903f60 | 50.0 | S6 descent |
| 0x00903f64 | 30.0 | S6 descent |
| 0x00903f80 | 4.0 | S6 parabola divisor |
| 0x00903f84 | 50.0 | S6 parabola factor |
| 0x00903f8c | 9.0 | S6 descent divisor |
| 0x00903f90 | 0.0 | S6 sub-3 test |
| 0x00903ae0 | 6.0 | `FUN_004a15fc` impact height |
| 0x00903e04 | 0.5 | S16 amplitude |
| 0x00903dfc | -5120.0 | S16/S17 pitch rate |
| 0x00903e00 | 19.5 | S16 count split |
| 0x00903e08 | 2.3 | S16 speed sub 0 |
| 0x00903e14 | 0.25 | S16 speed sub 1 |
| 0x00903e18 | 0.0 | S16 end test |
| 0x00903e1c | 20.0 | S15 Bezier divisor |
| 0x00903e30 | 0.0 | S15 end test |
| 0x00903e34 | 0.2 | S14 damping |
| 0x00903e38 | -4.0 | S14 gain |
| 0x00903e3c | 6.0 | S14 test |
| 0x00903e40 | 0.8 | S14 speed factor |
| 0x00903e44 | 6144.0 | S14 test |
| 0x00903ea4 | 0.25 | S12 speed |
| 0x00903ea8 | 6144.0 | S12 pitch scale |
| 0x00903eb0 | 15.0 | S12 count divisor |
| 0x00903eb4 | 0.5 | S12 amplitude |
| 0x00903eb8 | 2.1 | S12 speed sub 2 |
| 0x00903ddc | 0.25 | S17 speed sub 0 |
| 0x00903de0 | 6144.0 | S17 pitch scale |
| 0x00903de8 | 10.0 | S17 count divisor |
| 0x00903dec | 0.5 | S17 amplitude |
| 0x00903df0 | 2.1 | S17 speed |
| 0x00903ec0 | raw 0xFFFFF490 (NaN as float) | S4 `+0x5c` (raw, UNCLEAR) |
| 0x00903ec4 | raw 0x00008F7E (int 36734) | S4 `+0x60` (raw, UNCLEAR) |
| 0x00903ec8 | 0.0 (raw 0) | S4 `+0x64` |
| 0x00903c68 | 0.6 | `FUN_004a5e10` error gain (`d`: 0.6000000238) |
| 0x00903aa0 | 2pi (`d` 6.283184) | angle16 = atan2 * 65536 / (2pi) (`FUN_004a1b84`, S9, S10, S4) |
| 0x00903aa8 | 65536.0 (`d`) | same |
| 0x00903ab0 / 0x00903ab8 / 0x00903ac0 / 0x00903ac8 / 0x00903ad0 / 0x00903ad8 | 2pi / 65536 (`d`) | same pattern |
| 0x0097d978 | 0.0 | motion step on mode 3 end |
| 0x0097d97c | 1.0 | motion helper |
| 0x0097d990 | 0.0 | `FUN_007aabd8` return when flag 4 |
| 0x0097e508 | 1.0 | Bezier helper |
| 0x0090385c | 8.0 | (fire point helper) |
| 0x00903850 / 0x0090383c / 0x00903828 / 0x00903814 | 0.0 | muzzle local x (`FUN_004a121c` etc.) |
| 0x00903860 / 0x00903838 / 0x00903824 / 0x0090384c | raw 1.4e-45 (int 1) | muzzle local w (raw) |
| 0x009a8118 / 0x009a811c / 0x009a8120 | 27.0 / 0.0 / 175.0 | S4 FX position (68 event) |
| 0x009a8124 / 0x009a8128 / 0x009a812c | 153.0 / 437.0 / 1347.0 | S4 FX position (212, 418, 463) |
| 0x009a8130 / 0x009a8134 / 0x009a8138 | 23.0 / 0.0 (180 after init) / 991.0 | S4 home position (x, y, z) |
| 0x00a474c0 bit 0 | init flag S4 | sets `DAT_009a8134 = 180.0` on first run |
| 0x00a474c4 bit 0 | init flag S13/S14 | sets `0x00a47594 = 20.0`, `0x00a47598 = 30.0`, `0x00a4759c = 50.0`, `0x00a475a0 = 30.0`, `0x00a475a4 = 20.0` (beam point data, not height) |
| 0x00a474c8 bit 0 | init flag S15 | sets `0x00a474e4 = 67.0`, `0x00a474f4 = 107.0`, `0x00a47504 = 147.0`, `0x00a47514 = DAT_00a47564` |
| 0x00a47564 | RUNTIME (BSS) | default hover height; never written in the decompiled set. UNCLEAR. |
| 0x00a47568 / 0x00a4756c / 0x00a47570 / 0x00a47574 | RUNTIME (BSS) | muzzle fire frames for `FUN_004a0f70`. UNCLEAR. |
| 0x00a47590 | RUNTIME (BSS) | S12 base height. UNCLEAR. |
| 0x00a475a8 / 0x00a475ac | RUNTIME (BSS) | S16 / S17 base height. UNCLEAR. |
| 0x00a4762c | RUNTIME | shot object flag (`FUN_004a0d3c`). UNCLEAR. |

Motion `op` (slot 25) has `flags = 0x80000000`; this bit is read nowhere in 0..17 (UNCLEAR).

---

## Transitions summary

| from | to | condition |
|---|---|---|
| S3 | S11 | `+0x6e4 > 150` at phase 3; counter counts ticks with a player in slot 0..3 (PROVEN code) |
| S4 | data | script VM opcodes at phase 2/9 (`FUN_004a8d5c`), UNCLEAR |
| S5 | next record | 50 ticks after `+0xb0 & 0x10` (dead motion finished) (PROVEN code) |
| S6 | next record | takeoff motion ended (`+0xc8 <= 0`) |
| S7 | next record | beam phase done, motion ended |
| S10 | next record | waypoint within 10.0 (`fStack_20 < 10.0`, see caveat) |
| S11 | next record | land motion ended |
| S12 | next record | slot 7 playing (`+0xb4 == 7`) |
| S15 | next record | Bezier descent motion ended |
| S16 | next record | motion ended (`+0xc8 <= 0`, sub 1) |
| S17 | next record | slot 20 playing (`+0xb4 == 0x14`) |
| S3 (phase 3) | S11 | as above |
| any | any | none in S0, S1, S2, S8, S9, S13, S14 (exit must come from outside, UNCLEAR) |

"next record" = `FUN_004a7e20` (PROVEN). Randomness: **no RNG call appears in states 0..17**. Every
branch is either a motion frame, a motion end, a counter, a distance-free presence test, or the
pattern queue. There are no random rolls to port from this range. (The pattern queue contents are the
closest thing to a "table" and are UNCLEAR.)

HP thresholds: none in 0..17 (no HP field is read). Death entry is via the base (`FUN_0051f81c`,
ASSUMED).

Hit boxes / damage: the only spatial tests in 0..17 are `FUN_004a15fc` (sphere query at the boss
point, mask 0x16ef, y <= 6.0) and the beam/ shot objects (`FUN_004aa808`, `FUN_004a0d3c`) whose
damage code was NOT read. So: no damage value, no hit radius in this range (UNCLEAR, see top items).

---

## Attacks and sends (summary)

- 6x9F (`G_GalGryphonBossActions_6x9F`: entity id, target x, target z): sent by `FUN_004a1328`,
  called from `FUN_004a12dc` every 32 phase-8 ticks in S2, S7, S9 (PROVEN call graph; the sender
  side is ASSUMED: phase 8 is the non-leader path).
- 6x76 (`G_SetEntitySetFlags_6x76`): on death via `FUN_008113e4`, `if (+0x80 != 0)`, flags
  `DAT_00aafca0` (ASSUMED value, the payload layout is not verified).
- 6x75 (`G_UpdateQuestFlag_V3_BB_6x75`, flag 0x52): from S5 leave via `FUN_006bb100(0x52)` when
  `FUN_007a61a4() == 0xb`, else only a local bit (ASSUMED meaning of 0xb).
- 6xA0 (`G_GalGryphonBossActions_6xA0`: pos, angle, phase, action) is NOT sent in 0..17 directly.
  Candidate: the consumer of `FUN_006ff5f8` (UNCLEAR).
- Shots (S2, S6 `FUN_004a15e8`, muzzle fire `FUN_004a0f70`): local FX + projectile objects. The
  damage path and net sync of projectiles are UNCLEAR.

## Particles / SE ids (summary)

- SE: 0x3a2 (S2 muzzle), 0x3a3 (S6, S4), 0x3a6 (S5), 0x3a7 (S4, S11, S15), 0x39a (S4), 0x39b (ground impact),
  0x39c (S13/S14 looped, positional), 0x39d / 0x39e (S7), 0x52 (S5 death quest flag, via `FUN_006bb100`), 0x9f
  (`FUN_004a1328` is the 6x9F packet, not an SE).
- FX: template slots from `+0x5f8` (see conventions); literal ids seen: 0x201, 0x20d (S5 death), 0x2040 (`FUN_004a3314`
  flag), 0x31c7 and 0x238e (director events, not FX).

## Points to confirm before porting (top 3)

1. Runtime-only globals and the pattern queue: `DAT_00a47564`, `DAT_00a47568/6c/70/74`,
   `DAT_00a47590`, `DAT_00a475a8/ac` (BSS, never written in the decompile set), and the pattern
   table at `+0x4c4` (who fills it, whether it is random). Without these, the fire timing, the
   hover height and the S16/S17 heights are not decided.
2. Exits and dispatch: which driver calls phase 3 (S3), which code leaves S1, S2, S8, S9, S13, S14, and the
   event-script opcodes that end S4. Also the consumer of the `FUN_006ff5f8` queue (0x1c/0x60/0x80/0xa0/0xc0/0xe0).
3. Network sender side: `FUN_004a12dc` (6x9F) sits on the non-leader path (phase 8). Confirm
   `FUN_00520db0` / `FUN_00694cc8` (the leader flag `+0x4e8`) before deciding who sends 6x9F and
   6x76/6x75. Also the projectile damage path (`FUN_004a0d3c` -> `FUN_0050b7a4` object vtable).

## Corrections to the DEVLOG entry (2026-10-22)

- `FUN_007aabd8` returns the motion frame (`+0xc0`), not a distance. S2/S6/S7/S11/S12/S15/S16/S17 thresholds are frame numbers.
- Motion table pointer is at `+0xd8` (ctor `param_1[0x36]`), not `this+0x144`.
- Busy flags are at `+0x4c8` (`param_1[0x132]`), not `+0x132`. Same for the other indexed fields listed in the conventions.
- State 5 is the death cinematic (ASSUMED); the DEVLOG's "state 5 anim 0x1a" is right.
- State 3's counter is `+0x6e4`, and the transition to S11 is at 150 counted frames, not "more than 0x96 frames while FUN_0068d5a8 finds a player" (same thing, now proven).

## Status per state

| state | status |
|---|---|
| 0 | fully specified (empty) |
| 1 | fully specified |
| 2 | fully specified, fire-frame globals UNCLEAR |
| 3 | fully specified, phase-3 dispatcher UNCLEAR |
| 4 | partial (script VM, raw words) |
| 5 | partial (death cinematic, ASSUMED) |
| 6 | fully specified |
| 7 | partial (beam FX internals) |
| 8 | partial (pattern record semantics) |
| 9 | partial (orbit; exit UNCLEAR) |
| 10 | partial (fStack_20 caveat) |
| 11 | fully specified |
| 12 | fully specified |
| 13 | partial (`FUN_004a2ea8` not read) |
| 14 | partial (orbit + beam split) |
| 15 | fully specified |
| 16 | mostly (`DAT_00a475a8` runtime) |
| 17 | fully specified |

Count: 9 fully specified (0, 1, 2, 3, 6, 11, 12, 15, 17), 9 partial (4, 5, 7, 8, 9, 10, 13, 14, 16).
