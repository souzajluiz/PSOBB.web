# Barba Ray: exe map (partial)

First mapping pass, 2026-10-22; second pass the same day resolves most of the
"Open" list below; the coordinator then resolved the HP sign. No brain is ported
yet: speeds / paths, the 6xAA receive side, death rewards and motion ids are open.
Addresses are PsoBB.exe VAs. "dump" is the named Ghidra dump in
original-psobb-client-source (names often wrong). Tags: ASSUMED, UNCLEAR.

## Object model (resolved, pass 2)

- Factory 0x004af5b8 (type 0xCB): allocs 0x7dc bytes, ctor 0x004af634 writes the
  root vtable 0x00afab60. (Pass 1 said the body is this vtable; that holds.)
- The root owns 10 PART objects, one per loop of 0x004afd1a..0x004afdd9: each
  part is 0x3d0 bytes, vtable 0x00afada0, created by ctor 0x004b9ff0 (+ init
  0x004ba2e4). Part pointers sit at root[0x180..0x189] (root+0x600+4*i). The
  root's [0x16c..0x17f] pointers are model bone nodes, not parts.
- Part vtable 0x00afada0: slot 0 0x004b9eec (destroy), slot 1 0x004ba0ac (position
  update), +0x100 0x004ba120 (HP delta), +0x164 0x00618a44, +0x168 0x004b9f78.
- Root vtable 0x00afab60: +0x164 0x004b02b4 (the message dispatcher, see below),
  +0x100 0x004b947c (root HP delta), slot 1 0x004b8584 (per-frame update).
- Part +0x14 is the owner (root). Root +0x630 is a flag word (0x8, 0x4, 0x200,
  0x400, 0x800 used); root +0x32e is the state (short).

## Body HP and damage (pass 2)

- HP fields are shorts: +0x2bc = max, +0x334 = current (see "SIGN RESOLVED" below). 20000
  (0x4e20): set in root ctor 0x004afe78, part init 0x004ba2e4, part reset
  0x004ba230 (= 0x004ba1b8). Same convention in De Rol Le ctor 0x0042ad4c
  (0x004350d4 too), so this is the shared enemy-HP layout.
- Part delta 0x004ba120 (vt+0x100): delta = cur - prev. Flag +0x3c4 bit0 clear:
  pool +0x3cc -= delta; pool < 1 -> 0x004ba1b8 (set bit0, reset cur/prev to 20000,
  SE 0x3f9, optional FUN_004acc98 when the 0x2c check passes). Bit0 set: spark
  0x004b96bc(part+0x38, 15.0, 12.0), then 0x004b966c with owner root: root+0x704
  -= round(delta * 0.5) (0x00906c60 = 0.5), SE 0x3fa.
- Root delta 0x004b947c (vt+0x100): delta = cur - prev. If root +0x630 & 8:
  root+0x704 -= delta, effect 0x127 at owner, SE 0x3fa. Else root+0x708 -= delta,
  and if < 0 -> 0x708 = 0 and 0x004b958c (+0x630 |= 0x88, SE 0x3f9).
  Then 0x004b95b4 (+0x630 |= 0x800).
- Boss advance gate 0x004b8e1c: returns 1 when root+0x704 < 1 and +0x630 & 4 is
  clear. The normal path 0x004b8dec then runs the table (0x004b8e3c) instead of
  waiting. So root+0x704 is the boss HP that drives phase changes (decisive).
- The damage input is 6x0A: newserv G_UpdateEnemyStateT_6x0A {enemy_index,
  total_damage u16, game_flags; 0x200 = "was hit"} (vendor/newserv
  ReceiveSubcommands.cc:3470). Each client computes the HP change locally.
- The exe writer that turns 6x0A total_damage into the +0x2bc drop is NOT in the
  Barba range (0x004b8584..0x004bxxxx). Writers found outside it: 0x004cede4
  (another enemy's ctor), 0x00520c98 (save/restore of 700/334/2be/336 around a
  call), 0x00618ae4 (swap helper). The receive-side damage code is still open.
- SIGN RESOLVED (coordinator, objdump 0x004ba124..0x004ba185): the field names
  above are swapped. The shared enemy layout (client/src/combat/formulas.ts) is
  +0x2bc = max HP, +0x334 = current HP. The part delta loads edx = [+0x2bc],
  ebp = [+0x334], computes ebp = max - hp (the damage since the last call),
  does pool -= damage, then writes +0x334 = +0x2bc (HP back to max). So every
  hit drains the pool (+0x3cc) or, once broken, root+0x704 by round(damage * 0.5),
  and the part's own HP never falls. The root delta 0x004b947c is read the same
  way (damage = max - hp). This matches "< 1 = broken" and "root+0x704 < 1 =
  advance". The 6x0A total_damage reaches +0x334 through the generic enemy hit
  path, as for every other enemy.
- Newserv relays 6xA9 / 6xAA with no HP logic (ReceiveSubcommands.cc:5772-5773,
  forward_subcommand_with_entity_id_transcode_t): the server does not own boss HP.

## Movement (pass 2, partial)

- Part position: 0x004ba0ac copies a 3-float row from the table pointer at
  part+0x3c8 into part+0x38 (x,y,z at +0x38/+0x3c/+0x40), then vt+0x154 and
  vt+0x168, and 0x0080575c (effect) when bit0 of owner+0x18 is set.
- Root per frame 0x004b8584 runs the state logic, vt+0xac / vt+0xb0, 0x004b903c
  (smoothing: 0x00520dc0 lerp of pos +0x38 toward +0x514 with 0.3 = 0x3e99999a;
  velocity +0x52c..+0x534 scaled by 0.5; effects 0x3ea / 0x3eb when +0x630 &
  0x400, 0x3ef when +0x630 & 0x200), then 0x004b9198 (effect 0x40000000).
- The path/speed numbers per phase are not decoded yet.

## Action table (pass 2)

- Pointer array 0x009abc68, indexed by floor (0..3 filled). Each table is
  8-byte records. Header at +0 is (1, 0); the executor reads record i at
  base + 8 + 8*i (Ghidra: puVar1 + idx*8 + 8). The first dword is the code, the
  second dword (the arg) is never read by the state code.
- Codes are decimal in exedata output. Floor 0 starts 3, 8, 15, 3, 40, 60, 50,
  68, 57, 61, 41, 17, 63, 21, 17, 63, 21, 40, 59 ... and ends 13, 69. Code 69
  (0x45) is the loop: next index = 1 (restart at record 1). Codes 0x1e..0x27
  (30..39) are NOT in the first ~80 records of floors 0..3.
- Values resolved by the executor (0x004b8e3c, 0x004b3c2c, 0x004b60c4, 0x004b4684,
  0x004b02b4 share the same switch):
  - 0x1e: FUN_00520bf4() <= 0.0 ? 6 : 8. (ASSUMED: rand split, 0.0 threshold.)
  - 0x20: same test -> 0x0e : 0x0c.
  - 0x1f: flag +0x6cc == 0 ? 5 : 9.
  - 0x21 -> 3 : 0x0b; 0x23 -> 4 : 0x0a; 0x24 -> 0x0f : 0x10; 0x25 -> 0x11 : 0x12;
    0x26 -> 0x13 : 0x14; 0x27 -> 0x15 : 0x16. (Flag at +0x6cc = param[0x1b3].)
  - Anything else goes to FUN_004b5150(code): sends 6xA9 {code, idx} with the
    subcommand 0x2a9; codes 0x13, 0x14, 0x18, 0x40, 0x41, 0x44 send 6xAA {code,
    idx, root[0xe5]} instead.
  - 0x45: next index = 1.
- Dispatch table 0x004b02b4 (slot +0x164, phase = param_2): 0x13 -> 0x004b3c2c(0),
  0x14 -> (2), 0x15 / 0x16 -> 0x004b41ac(0/2), 0x17 0x004b6d08, 0x18 0x004b6300,
  0x19 / 0x1a 0x004b4684(0/1), 0x1b 0x004b60c4, 0x1c 0x004b5d1c, 0x1d 0x004b5c98,
  0x3a / 0x3b / 0x3c -> spawner 0x004b4e6c(0/1/2, idx) with a count at +0x730 /
  +0x734 and table playback. Phases 0x03..0x39 otherwise are transitions via
  0x004b1e98 / 0x004b0ee0 / 0x004b2cd0 / 0x004b30fc / 0x004b7040 / 0x004b7860.

## States (pass 2, corrects pass 1)

- Pass 1 said states 0x1b / 0x1c are death. They are not:
  - 0x1b = timed attack (0x004b60c4): countdown +0x1be -= 2.0 each frame; at
    -200.0 < +0x1be it re-sends 0x1c. Not death.
  - 0x1c = finale / death sequence (0x004b5d1c). Phase 0: at 85.0 (0x42aa0000) a
    0x20c effect and SE 0x3fb, at 20.0 (0x41a00000) effect 0x20f, flags. When bit 0
    of the ushort at +2 of FUN_004d6864's result is set it sets +0x1cc = 1; phase 9
    with +0x1cc == 1 sends state 0x1d. Phase 5 leaves (model restore,
    FUN_006bb100(0x4c)). (ASSUMED: that bit is the kill signal.)
  - 0x1d = dead (0x004b5c98): enter sets +0x2e = 0x10, calls 0x004bff10, and phase 0
    sets bit 0 of the ushort at +2 (the entity-dead bit). This is the death state.
- 6x76 / EXP / drops: not located yet (the 0x004b5d1c path only calls FUN_004bff28,
  FUN_00717f74, FUN_004d3250 which are unexplored).

## Minion and spawner (pass 6: decoded, ported as a brain)

Sources: Ghidra (0x004ad95c, 0x004addc0, 0x004ae918, 0x004ae748, 0x004ae398,
0x004ae10c, 0x004ae024, 0x004adfac, 0x004adfe8, 0x004ae724, 0x004add2c,
0x004b4e6c), exedata for the constants and tables.

- Minion update 0x004addc0: the state at +0x32e. A killed entity (+0x30 & 0x800)
  moves to state 4 (dying) unless it is already 5. State 4 plays SE 0x3f5 and sets
  the animation code +0xb8 = 1, then state 5. State 3 sets +0xb8 = 4.
- State 0 (appear, 0x004ae918): timer +0x3d0 = motion frames (+0x3a8 +0x18) - 10,
  counted down; below 0 it goes to state 1 (SE 0x3f1 mode 0 / 0x3f2 mode 1 at 9.0).
- State 1 (aim, 0x004ae748): a random direction (FUN_0082dcbc / FUN_0082ddd8,
  scaled by 1 + the motion's first float), heading = atan2(x, z), then state 2.
- State 2 (advance, 0x004ae398): +0xc8 = (1 + f) * 0.1; the velocity is scaled by
  (1 + f) each tick; the move (FUN_004add2c) is refused when the old x is past 75.0
  (0x00904850); a refused move goes to state 3 (ASSUMED meaning of the x test).
  The latch loop runs here and in state 3: alive targets not yet latched join the
  list (4 at most). Mode 1 sends the attack (0x60 on the target, value 100.0);
  mode 0 does not (0x50 / 0x5c). Aura 0x20b on entry, removed on leaving.
- State 3 (hold, 0x004ae10c): SE 0x3f4 and the death sparks at 8.0; the latch
  loop; it stays until the kill.
- State 4 / 5 (0x004ae024 / 0x004adfac): the death sparks 0x20d / 0x20e at 14.0
  (0x004adfe8), and the dead bit (+8 bit 0) once the float +0xc8 is 0.
- Spawner 0x004b4e6c (phases 0x3a / 0x3b / 0x3c = group 0 / 1 / 2, index 0..8):
  the count is 0x00905f60 + row * 0x24 (9 u32); 0 = no minion, 1 = mode 0, 2 =
  mode 1. Row 0 is used (ASSUMED: the 0x3a..0x3c records have 0 in the second
  word of the floor 0 table at 0x00906980). Destinations 0x009abbc8[group] (9 vec3,
  stride 12): group 0 x = +72 / +65 (z 60..-60), group 1 x = -72 / -65, group 2 z =
  75 / 65 (x 50..-50), group 3 z = -95 / -85 (unused). Headings 0x009abbb8[group]
  (u32 BAMS): 0xC000, 0x4000, 0x8000, 0.
- Slot: the free child with the highest k in 1..35 (k = 0 is never used; the
  test is `0 < sVar7`) at body index + 11 + k (the 0xcb row's 36 PIG_RAY slots).
  The scan is 0x004b5013; a taken slot makes no spawn.
- Stats: PIG_RAY = BattleParam row 8 (entitynames.ts: stats [8], attack [8],
  resist [8]); the ctor reads 0x0077a684/0x0077a6cc with 8 (mode 0) or 9.

Port: combat/barbaminion.ts (PigRayAi, states 0..5, the latch list), combat/barbaray.ts
(BARBA_PIG_COUNT, BARBA_PIG_DEST, BARBA_PIG_HEADING, barbaPigMode; the spawn event
carries the count), render/combat.ts (spawnPigRay, pigDrain).

ASSUMED / open for the minion: the motion frame count (30 in the port, the real
record is not read), the speed term (0), the attack values (knockback 0, mult 1),
the death countdown (PIG_DEATH_TICKS, the exe gates it on +0xc8), the random aim,
the wall test (no ground test in the spawner's path), the minion's move speed, and
the kill path (the generic enemy death calls ai.kill(); not exercised in the e2e).
The minion's network sync is the generic enemy one (its own entity ids); the
6xA9 / 6xAA are the body's only.


- Pig Ray minion ctor 0x004ad95c, update 0x004addc0, states 0..5 at 0x004ae918,
  0x004ae748, 0x004ae398, 0x004ae10c, 0x004ae024, 0x004adfac. Minion vtable
  0x00afa7b8 (a different entity). Spawner 0x004b4e6c: 36 slots, spawn-count
  table 0x00905f60, destination tables 0x009abbc8 / 0x009abbb8.
- Minion death: state 5 0x004ae024 (particle 0x20b, SE 0x3f5); death particles
  0x20d / 0x20e (0x004adfe8).

## Network (pass 2)

- 6xA9 {phase u16, attack_seq_index u16} (0x004b8e3c, 0x004b5150, 0x004b3c2c).
- 6xAA {phase, idx, target u32} (0x004b5150 for the list above; 0x004b3c2c uses
  phases 0x13 / 0x14 on the send side).
- Receive side: the local dispatcher 0x004b02b4 is what vt+0x164 calls, and the
  network path calls it with (phase, param). What a receiving client does with
  6xA9 / 6xAA phase values is still UNCLEAR (the 6xAA receive wrapper is not
  located in this pass). newserv relays both without touching state.

## Pass 3 (resolutions; objdump and Ghidra, all addresses VAs)

Status per item of the brief: 1 PARTIAL (archive and slot table resolved, the
leader-side phase change is not), 2 PARTIAL, 3 RESOLVED (receive path), 4 PARTIAL
(kill path resolved, who runs it on each client is not), 5 PARTIAL (ids only).

### 1. Motion ids (PARTIAL)

- Archive: `bm_boss7_de_rol_le_c.bml` (descriptor 0x009abb4c, enemymodels.ts,
  `TBoss7DeRolLeC`). The ctor 0x004af634 spawns the Barba Ray with it. Models: 0
  body, 1 tentacle, 5 hige tentacle. Motion list (0-based, from the descriptor):
  0 beam02, 1 beamwait, 2 beam_a, 3 beam_b, 4 beam_c, 5 bite_lloop, 6 bite_rloop,
  7 ed_boss2, 8 op_boss2, 9 fd02, 10 fjump, 11 forward, 12 lrjump, 13 l_bite,
  14 rljump, 15 r_bite, 16 scatter, 17 tloop (tentacle), 18 hige_down, 19 hige_up,
  20 hige_wait. The existing idle/tentacle/hige picks (11, 17, 20) agree.
- The motion table is `0x009aba20`, 16-byte rows: u16 mode, u16 next, u32 motion,
  f32 speed, u32 flags (PROTOCOL.md layout). Slots 0..16 are valid; slot 17+ is
  not part of it. The decoded rows (file value, then the static init 0x004b9bd8
  overwrite where it writes one):

  | slot | mode | next | motion | name | speed |
  |---|---|---|---|---|---|
  | 0 | 3 | 0 | 8 | op_boss2 (intro) | 0.7 |
  | 1 | 1 | 0 | 11 | forward (idle) | 0.6 |
  | 2 | 1 | 0 | 9 | fd02 | 1.0 |
  | 3 | 3 | 0 | 0 | beam02 | 0.4 |
  | 4 | 2 | 1 | 10 | fjump | 0.3 |
  | 5 | 2 | 1 | 14 | rljump | 0.5 |
  | 6 | 2 | 1 | 12 | lrjump | 0.5 |
  | 7 | 2 | 9 | 15 | r_bite | 0.28 |
  | 8 | 2 | 10 | 13 | l_bite | 0.28 |
  | 9 | 1 | 0 | 6 | bite_rloop | 2.0 |
  | 10 | 1 | 0 | 5 | bite_lloop | 2.0 |
  | 11 | 3 | 0 | 16 | scatter | 0.6 |
  | 12 | 2 | 15 | 2 | beam_a | 0.4 |
  | 13 | 3 | 0 | 3 | beam_b | 0.3 |
  | 14 | 2 | 1 | 4 | beam_c | 0.4 |
  | 15 | 1 | 0 | 1 | beamwait | 0.5 |
  | 16 | 3 | 0 | 7 | ed_boss2 (finale / dead) | 0.7 |

  The `next` chains match the names (r_bite -> bite_rloop, l_bite -> bite_lloop,
  beam_a -> beamwait, fjump -> forward), so mode 1 = loop, mode 2 = play then go to
  `next`, mode 3 = play once and hold (ASSUMED from those chains; the mode meaning
  is not read from the player code).
- The state field `*(short*)(root+0x2e)` is the slot index, not the motion id.
  Writers in the Barba range (the enter and sub-state writes):
  0x004b8034 phase 1 enter: 0. 0x004b3c2c and 0x004b41ac (phases 0x13 / 0x15 and
  their 0x14 / 0x16 twins): 9 if root+0x1b2 == 0 else 10 (enter). 0x004b6d08
  (0x17): 0xc. 0x004b6300 (0x18): 0xf. 0x004b4684 (0x19 / 0x1a): 0xe. 0x004b5d1c
  (0x1c) and 0x004b5c98 (0x1d): 0x10. 0x004b1e98 (transitions): 1. 0x004b0ee0:
  5 or 6 by side. 0x004b2cd0: 3. 0x004b30fc: 1, then 7 or 8 by side. 0x004b7040:
  1, then 4. 0x004b7860: not decoded.
- Per-frame motion calls are vtable calls with no index: vt+0x184 and vt+0x188
  on the root and on the 10 parts (root+0x180..0x189). ASSUMED: 0x184 = stop /
  hold and 0x188 = start (the enter paths call 0x188 with +0x2e set, the death
  and 0x004b60c4 event 4 call 0x184). Not verified in the motion player.

### 2. Speeds and paths (PARTIAL)

- Anchors: a 10-entry table of 3 floats at 0x00a47780 (stride 12; .bss, so it
  is filled by code, not by the file). The static init 0x004b99d3 writes it
  (objdump 0x004b99fc..0x004b9b1e). Entries as (x, y, z):
  0 (-175, 7, 25); 1 (0, 7, 500); 2 (175, 7, 25); 3 (0, 7, -250); 4 (0, 7, 25);
  5 (-205, -100, 25); 6 (0, -100, 528); 7 (205, -100, 25); 8 (0, -100, -280);
  9 (0, -100, 25).
- FUN_004b1e58(i) (0x004b1e58) teleports the root to anchor i (x,y,z at +0x38,
  +0x3c, +0x40), zeroes +0x64 and +0x6f8.
- FUN_004b416c (0x004b416c, entry side): pos x = -100 (0xc2c80000) and +0x64 =
  0x500 when root+0x6c8 == 0, else x = +100 and +0x64 = -0x500; y = 10.0; +0x6f8
  = DAT_00a47a90. (Constants are the enter pose, ASSUMED to be the swim-in.)
- Phase 0x15 (0x004b41ac) moves the root with +0x1d1 (0x500 start) and a gravity
  term; it leaves to state 1 when +0x1be < DAT_00a47a94. Phase 0x13 uses a
  count (+0x1cc / +0x1cd): a 41-tick wait, then 4 steps of FUN_004bd190 (what
  the steps place is ASSUMED, not read).
- Root per frame 0x004b903c: pos (+0x38) lerps to target +0x514 with factor 0.3
  (0x3e99999a, 0x00520dc0). Velocity +0x52c..+0x534 = lerp of +0x4cc toward
  +0x520 with 0.3, then scaled by DAT_00906c7c (not decoded).
- Part positions: part+0x3c8 points to root+0x538 + 12*i (root ctor 0x004af634
  stores 9984.0 = 0x461c4000 in the three floats, so a part parks until written).
  Part ctor 0x004b9ff0 writes +0x3c8 (0x004ba079) and +0x3c0. Who writes the
  rows at run time is not located.
- Turn rates and the per-phase path numbers (DAT_00906... and DAT_00a47a..) are
  not all decoded. The table arg dword is still not read by the body.

### 3. 6xA9 / 6xAA receive (RESOLVED)

- Dispatch: 0x008003e0 (checked_call_packet0x60_subcommand) matches the packet
  byte 0 against the rows at 0x00a0fba0, 8 bytes each: u16 cmd key, u16 mask,
  u32 handler (+4). The key is the cmd byte only (`*param_1` is a byte).
  0x008003e0 is send-then-apply: if DAT_00aab284 != 0 it goes through
  FUN_007d3f38 (logs, and sends the 0x60 frame when the connected flag +0x12130
  is set), then, if (mask & DAT_00a10160[DAT_00aafc9c]) != 0, it calls the
  row's handler with the same packet. So the sender applies its own message
  locally (ASSUMED that the network receive path does not use the send step).
  Rows found: cmd 0xA9 at row 165 -> handler 0x004b98dc, mask 0x0004. cmd 0xAA
  at row 166 -> handler 0x004b9918, mask 0x0004. (The reads at 0x00a100ec /
  0x00a100f4 in an earlier pass were the wrong rows.)
- 0x004b98dc: looks up the entity by the u16 at +2 with 0x00786b3c (ids in
  0x1000..0x3fff, sorted list DAT_00aad720, key +0x1c); if found, 0x004b98fc.
- 0x004b98fc (6xA9 body): root+0x6bc = u16 at +6 (attack_seq_index); 0x0051f62c
  (phase = u16 at +4).
- 0x004b9918 (6xAA): same entity test; 0x004b9938: 0x00520fcc(u16 at +8) sets the
  target (+0x394 id, +0x398 = 0x00578c74(id)), then as 6xA9.
- 0x0051f62c(this, phase): event 5 to the old phase, event 4 to the new one,
  then +0x32e = phase. This is the generic enemy state switch (many callers in
  the exe). In the Barba range it is the only writer of the phase after the
  ctor: both the receive bodies and, through 0x008003e0, the owner's own sends
  reach it.
- newserv relays 6xA9 / 6xAA to the other clients only (the sender is skipped,
  vendor/newserv/src/ReceiveSubcommands.cc:375-400 and the rows at 5771-5772), with
  structs CommandFormats.hh:5464 / 5473 (phase @+4, seq @+6, target u32 @+8).

### 4. Death rewards (PARTIAL)

- Kill = the leave (event 5) of phase 0x1c. 0x004b5d1c (0x1c) event 5 does
  `mov ecx, edi` (edi = root, 0x004b5d23) and `call 0x0051f894`, the same on-kill
  as the Gal Gryphon (galgryphon-states-b.md 4.1). 0x0051f894 runs 0x00787534
  (EXP, via 0x00787398 with the enemy id at +0x2da, needs owner +0x3f0 == local
  client id) and 0x005c973c (drop roll stub), then 0x008113e4: 6x76 with
  DAT_00aafca0 if root+0x80 != 0. PROVEN calls; the EXP / drop formulas are
  the Gal Gryphon's ASSUMED ones.
- 0x004bff28 only clears DAT_00a48488 bits 0x3000 (no reward). 0x00717f74 /
  0x00717f38 loop over 12 slots of DAT_00a98478+0x54 (calls 0x007160a0 / 0x007160b4;
  effect or SE handles, ASSUMED). 0x004d3250 writes DAT_00a48a14 / DAT_00a48a54
  player-side fields (ASSUMED camera or lock-on bookkeeping). None awards EXP.
- 0x004bff10 (called from 0x1d enter 0x004b5c98): sets DAT_00a48488 bit 0x200
  then 0x004bff28. 0x1d event 0: root+0x8 |= 1 (dead bit, PROVEN store). 0x1d
  enter also sets +0x2e = 0x10 and sets 0x4 / clears 0x100 in +0x18c.
- The kill fires on whoever leaves 0x1c. The 0x1c -> 0x1d switch is the 6xA9
  phase 0x1d applied by 0x0051f62c (on receivers, and on the owner through its
  own 0x008003e0 send, see item 3). Who sends the 6x76 (root+0x80 set by whom)
  is UNCLEAR.
- The 0x1c phase-0 "kill signal" test (FUN_004d6864 result, bit 0 of its +2)
  sets bit 0 of 0x009e and then reads it, so it is true whenever FUN_004d30f4
  is not 5. ASSUMED: a cutscene-stage check, and so the 0x1c -> 0x1d request
  fires as soon as the cut starts.

### 5. Attack objects (PARTIAL, ids only)

- Beam / projectile spawns: 0x004b6d08 event 0 (phase 0x17) runs
  FUN_004be7c0(pos, 0x201) and SE 0x3ec at 0x41200000 (10.0 time check, ASSUMED);
  0x004b4684 SE 0x3ed at 0x41000000 (8.0); 0x004b5d1c effect 0x20c with SE 0x3fb
  at 85.0 and effect 0x20f via FUN_0050981c at 20.0.
- Phase 0x18 (0x004b6300) spawns objects via FUN_004ba894 (types 6 with 0x208,
  0xf with 0x209); SE 0x3f6 when sub-state 0 ends, 0x3f7 at the 13.0 mark
  (0x41500000) of sub-state 1. 0x004bae8c /
  0x004baf8c / 0x004baec4 are its object updates (not decoded).
- Root update effects: 0x3ea / 0x3eb (root+0x630 & 0x400), 0x3ef (& 0x200),
  0x127 at the owner and SE 0x3fa on a hit, SE 0x3f9 on a break. Part sparks
  0x004b96bc (15.0, 12.0). Hit radii, damage and the damaging-object flags are
  not decoded. ASSUMED: the beam and ice objects use 0x201 / 0x208 / 0x209.

### Open (blocks the port)

1. Owner phase change: closed by 0x008003e0 (item 3), ASSUMED that the owner's
   sends are the only route. The ctor sets phase 1 (0x004b017f). Confirm with a
   trace or with the send step's callers if needed.
2. Motion-player semantics of vt+0x184 / 0x188, and the mode field (1 / 2 / 3).
3. Path constants (DAT_00906c7c, DAT_00a47a.., and the 0.2 / 0.3 / 2.0 forms),
   the per-phase turn rates, and the part row writer (root+0x538 rows).
4. The 6x76 sender gate (root+0x80) and who holds the kill.
5. Hit radii, damage flags and the object update functions 0x004bae8c, 0x004baf8c,
   0x004baec4, 0x004be7c0.
6. Particle / SE ids beyond the ones listed here.

Ready to port the brain: NO (pass 3). Pass 4 below closes most of items 1-3.

## Pass 4 (speeds, paths, 6x76 gate, hit objects)

Sources: Ghidra decompiles (tools/ghidra/decomp.sh), objdump of the call sites,
tools/exedata.py reads. Correction to pass 2: +0x514 is NOT a movement target.
The root update 0x004b903c calls 0x00520dc0(src=+0x38, dst=+0x514, k=0.3). That
helper (disasm 0x00520dc0..0x00520e20) does dst = src - G, normalizes it and
keeps the length, scales by length*k, then dst += G. Net: +0x514 = G + 0.3 *
(pos - G). G = the vector at *(0x00a48a54)+0x178. 0x00a48a54 is the default camera
(docs/DEVLOG.md "Dark Falz camera: the per-frame driver": FUN_004D3ABC updates the
camera at DAT_00A48A54 and +0x178..+0x18C is its current eye / target), so G is
the camera's eye (coordinator; ASSUMED until the +0x178 field is checked for
this camera mode). +0x514 is the body pulled 30% of the way toward the camera. Same for +0x520 = G +
0.3 * (+0x4cc - G). Velocity +0x52c..+0x534 = 0.5 * (+0x520..+0x528) (0x00906c7c
= 0.5). Effects 0x3ea / 0x3eb (+0x630 & 0x400), 0x3ef (& 0x200) take +0x52c and
+0x514 as their positions. So +0x514 / +0x52c are render/effect anchors, not a
chase target.

### 1. Speeds and paths

Writers of the part rows (root+0x538 = 0x14e, rows i at 0x14e + 3i, 10 rows,
0x14e..0x16b; part i reads its row from part+0x3c8):
- 0x004b8584 (root per-frame update), gated by root+0x7b4 (param_1[0x1ed]) != 0.
  Row 0 = 0.5 * (+0x3f4 model vec after matrix op), row 1 (stored at 0x151) =
  0.5 * (+0x460 after the matrix op), rows 2..9 = 0.5 * (+0x478 + 12i after the
  matrix op). Each is the body's own model node pointed at by the model, so the
  parts sit ON the skeleton (no spline, no delay, no chain solver). ASSUMED: the
  0.5 is the model-to-world scale; the add operand of 0x0082ebac in that branch
  is not decoded (UNCLEAR, the call sites are past the objdump window I checked).
- Init 9984.0 (0x461c4000) in the root ctor parks each row until the first frame.
- 0x004b8584 also runs the 3-point trail (DAT_009abc5c / 009abc50 offsets, Y
  = -5.0) and the 6-slot emitter list at root+0x7a8 (0x004be78c): trail /
  effect plumbing, not the body.
- 0x004ba0ac (part update, vt+0x164/0x168 around it): copies row -> part+0x38
  (x,y,z at +0x38/+0x3c/+0x40), then 0x0080575c effect when owner+0x18 bit0.

Root movement per phase (0x0051f62c runs the phase switch; the enter events
call 0x004b1e58(anchor) or 0x004b416c):
- Anchor table 0x00a47780 (10 x 3 floats, .bss): written by the static init
  0x004b99d3 (objdump 0x004b99fc..0x004b9b1e; decoded values as in pass 3).
  FUN_004b1e58(i) teleports the root to anchor i and zeroes +0x6f8 and +0x64.
  Indices used: side 0/1 -> anchors 0 (-175,7,25) and 2 (175,7,25) on the
  0x0ee0 / 0x1e98 entries (ASSUMED that side picks these, from the +0x1b2 side
  flag), 3 (0,7,-250) on the 0x17 / 0x18 / 0x19 / 0x1c / 0x1d enters.
- 0x004b416c (side entry, used by 0x13 and 0x15): x = -100 (0xc2c80000) if
  root+0x6c8 == 0, else +100; +0x64 = +0x500 or -0x500; y = 10.0; +0x6f8 = 4.0
  (0x00a47a90).
- 0x004b41ac (phase 0x15, exits to state 1 when +0x6f8 < -137.0 = 0x00a47a94):
  per frame: speed +0x744 (int) += 256 (0x00906e48) from 0x500, clamped to
  0x4000 at >= 16384 (0x00906e40 / 0x00906e44); effect 0x3ed once when speed >=
  0x21ff (SE). vx(+0x74c) += 0.08 (0x00906e4c) from 0; x += (0.08 + vx) * dir,
  dir = +0x750 (-4.0 on side 0, +1.0 else). vy(+0x754) += 0.2 (0x00906f64);
  z -= vy. vz(+0x758) starts -4.0, += 0.1 (0x00906e5c); +0x6f8 -= vz. Yaw +0x64
  = round(-dir * speed-ratio). This is the "swim in" arc; y never changes.
- 0x004b3c2c (phase 0x13): the root does not move. Four path followers at
  root+0x6e4..0x6f4 are the movers: FUN_004bd190(follower, vec, speed) sets the
  follower's target (follower+0x14c..+0x154) and speed (+0x168, default 120 =
  0x00906e70 when outside 1..599). Sub-state 1 chooses vec = player pos (root
  +0x398 target, its +0x38) when FUN_00520f04 says so, else a random point:
  120 * FUN_007751b0 (rand) and two angle helpers (0x0082dcbc, 0x0082ddd8,
  coefficient -1.2 = 0xbfeccccd), then 0x00782bb0 (normalize). Sub-state 2 waits
  until all four followers return FUN_004bd220 (their +0x30 == 4) or 601 ticks.
- 0x004b0ee0 (phase 5 / 6 by side; +0x32e = 5 or 6 on enter, +0x1b2 = side): the
  richest path. Sub-state at +0x1ce (0..6), timer +0xc0 (float, +1 per frame
  via FUN_007aa094). Constants read from the decompile (ASSUMED meaning of each
  step, the vector formulas are decoded but the names are not):
  - sub 0 waits until +0xc0 >= 10.0 (0x00906f9c), then sub 1: vx(+0x75c) =
    (65 / 20) * dir (0x00906fd8 / 0x00a47a78), dir = +0x74c (+-1.0).
  - sub 1 until 20.0 (0x00906fa4): vx = (-90 / 16) * dir (0x00a47a74); a second
    rate from 0x00a47a70 (56.67); spawn 0x20f via 0x0050981c at root+0x7bc
    (+0x7b8 handle).
  - sub 2 until 28.0 (0x00906fa8): height target from FUN_004b1de4(), a step
    of (target - y) / 2.5 (0x00906fec), then 2.0 (0x00906fe8) / 56.67.
    Sub 3 until 25.0 (0x00906fac): arc through FUN_00434ac4 (the DrlEasing init
    of the De Rol Le port, args 7.0, dist, 0.2, 0.05).
  - sub 4 until 45.0 (0x00906fb0), sub 5 until 70.0 (0x00906fb8): descent with
    FUN_004b1c94 and FUN_0042cdc0 (ground follow; y is set from +0x1a4).
  - sub 6: FUN_0042cdc0 returns 3 -> +0x1cc = 2 (done, return to the table).
  - 0x201 spawns (FUN_004be7c0) when +0xc0 is in the 41.0 / 46.0 band or the
    24.0 / 32.0 band (0x00906f80 / 0x00906f7c / 0x00906f98 / 0x00906f94).
- 0x004b1e98 / 0x004b2cd0 / 0x004b30fc / 0x004b7040 / 0x004b7860: the transitions
  write (x,y,z) = (+0x1d3..) * scale + base, with per-phase vectors from +0x1d4,
  +0x1d5, +0x1d6 and the ring rows at 0x14e..0x16b (0x004b0ee0 scan). 0x004b7860
  sets y = -210 (0xc3520000) and +0x64 = 0. Constants are in the 0x0090xxxx
  and 0x00a47a.. ranges (table below). Not each decoded line by line: PARTIAL.
- Table of .bss constants (static init 0x004b99d3..0x004b9bce, addr = value):
  a47a68 36.0, a47a6c 2.0, a47a70 56.67 (17/0.3), a47a74 16.0, a47a78 20.0,
  a47a7c 0.3, a47a80 5.0, a47a84 7.0, a47a88 12.0, a47a8c 7.0, a47a90 4.0,
  a47a94 -137.0, a47a98 30.77 (6/0.195), a47a9c 18.33, a47aa0 0.195,
  a47ab0 1.0, a47ab4 8.0, a47ab8 1.5, a47abc 7.0, a47ac0 23.33, a47aa4/a8/ac
  2.5, a47af0 0.4. .data constants (exedata): 906c7c 0.5, 906e40/44 16384, 906e48
  256, 906e4c 0.08, 906e50 2.0, 906e5c 0.1, 906e70 120, 906f64 0.2, 906f68 0.5,
  906f6c 60, 906f70 10, 906f74 20, 906f78 20, 906f7c 46, 906f80 41, 906f88 70,
  906f9c 10, 906fa4 20, 906fa8 28, 906fac 25, 906fb0 45, 906fb8 70, 906fbc 64,
  906fd8 65, 906fdc 0.5, 906fe0 -90, 906fe4 -370, 906fe8 2.0, 906fec 2.5,
  906ff0 -0.5, 907000 -30, 906d2c 80, 906d30 30, 906d34 3, 906d38 14, 906d3c 10,
  906d4c 12, 906d50 13, 906d58 -200, 906d5c 2.0, 906ccc 500, 906cd0 180.
- Timers: 0x17 (0x004b6d08) uses +0xc0 (param_1[0x30]) in the band 10.0
  (0x906d3c) .. 14.0 (0x906d38) and a counter >= 3 (0x906d34) to spawn 0x201 at
  (x + 30*rnd, -5.0, z + 80) (0x906d30 / 0x906d2c). 0x18 (0x004b6300) sets
  +0xc0 = 13.0 (0x41500000) at its sub 1 end and spawns 0x208 / 0x209 with
  FUN_004ba894 (types 6 / 0xf).

Pass 2 read of "the path/speed numbers are not decoded" is now answered for
0x41ac, 0x3c2c, 0x0ee0 and 0x903c. Still open: the transitions' per-line
vectors and the 0x1e98 side targets.

### 2. 6x76 gate root+0x80 (PARTIAL, writer not found)

- 0x008113e4 (the on-kill call, reached from 0x0051f894 and from 0x004b8584 when
  root+0x18c bit 0x8000): if root+0x80 != 0 -> 0x008003e0(0x76, DAT_00aafca0),
  return 1. So +0x80 is a non-null pointer tested for "this enemy has a set entry".
- Barba ctor 0x004af634 has no store to +0x80 (checked: no `0x80(%reg)` store in
  0x004af5b8..0x004afe80). The base chain 0x005216f4 -> 0x00521738 -> 0x007865e8
  -> 0x00770748 -> 0x007a9e5c has no +0x80 store either. 0x0051f760 copies the
  spawn record's u16 +0x28 / +0x2a into the enemy, so the spawn record is the
  candidate; the spawner that stores +0x80 after the factory is NOT located.
- Factory table: u32 0x004af5b8 is at VA 0x009fc860 (type 0xcb record). The
  caller that indexes it is not found by a direct call search (no `call
  0x4af5b8`). ASSUMED: the spawner (set-table) writes +0x80 = set record.
- Port side: client/src/net/game.ts sendEntitySetFlags(0x1000|index, floor, 8) is
  sent for every boss kill (render/combat.ts 2009 / 2334 / 4488 / 4530 /
  6250). That already matches the exe when +0x80 != 0, which is the normal case
  for quest-spawned bosses. UNCLEAR for a boss with no set record.

### 3. Hit objects (PARTIAL)

- Effects 0x201 / 0x20c / 0x20f / 0x206 / 0x207 / 0x20a / 0x177 / 0x127: visual.
  Effect records are 0x98 bytes at 0x00a72cd0 + id*0x98 (ids < 0x200) or
  0x00a72ccc - 0x13000 + id*0x98 (0x200..0x23f), 0x0050cd1c. 0x004be7d8 (the
  0x201 path) allocs 0xd0, 0x00508c34 (emitter, flag 0x40), then start vt+4 and
  ages its sub-node +0x48 by -5.0. No hit test, no damage write. 0x0050ac1c
  (0x20c, args 0,0,0xa0,0x40) and 0x0050981c (0x20f) are the same family
  (ASSUMED, not read line by line).
- SE ids (boss07.pac, se_tables.ts): 0x3ec at the 10.0 / 0x41200000 test, 0x3ed
  at 8.0 and at 9216 ticks, 0x3ee, 0x3ef, 0x3f6 / 0x3f7 (0x18 start / 13.0), 0x3f9
  break, 0x3fa hit, 0x3fb kill 85.0. These are sounds, not hits.
- Objects 0x208 (type 6) and 0x209 (type 0xf): FUN_004ba894(root, type, id)
  builds the object (vtable 0x00afafe8: slot 0 0x004baaec, slot 1 0x004ba6c8 =
  the 20-point trail update, +0x164 via base). Two states: 1 = flight
  (0x004bacc0: timer +0x4c += 0x00907220 per frame, direction from +0x2c via
  fpatan, emits 0x206 / 0x207 through 0x0050bd5c, ends at 0x00907218 -> state
  2, releases 0x44 / 0x48). 0x004baec4 launches (0x20a via 0x0050b7a4, 0x177
  via 0x0050981c). The vtable slots that would be hit tests (+0x100, +0x104,
  ...) are the base 0x0061cdb0 no-op. So these objects deal NO damage in their
  own code.
- The damage template: phase 0x18 event 0 (0x004b6300) calls FUN_0051fc9c(
  object+0x1e0 pos, &rec, param_1[0x1c8]). rec = { 0.0, *(root+0x628) (the
  attack record pointer), 0.0, 20.0 (0x009abbb0), 1 }, read from 0x009abba4..
  0x009abbb4 (decoded as 0.0, [*], 0.0, 20.0, 1). 0x0051fc9c calls the global
  manager DAT_00a72eb4 vt+0x30 (when rec+8 > 0x009216d4) or vt+0x34, UNCLEAR.
  So the damage object is created through the same area-hit path De Rol Le uses
  (DrlBurst, client/src/combat/derolle.ts:248, "0x0051fc9c's {group, power,
  radius}"). The attack index (ATP / BattleParam) is the value at *(root+0x628):
  NOT decoded. Radius: ASSUMED 20.0 (0x009abbb0). The 120.0 at 0x009abba8 is
  not in that record.
- Body / parts / minions: the part hit box is set in part init 0x004b9ff0 ->
  0x004ba2e4 (generic; same as De Rol Le's segment boxes) and in base 0x0051f760.
  Radii and offsets NOT decoded. Minion (Pig Ray) boxes unchanged from pass 1.

### Port reuse

- client/src/combat/derolle.ts: DrlEasing (line ~190) is the same 0x00434ac4 /
  0x00434afc movement-target easing that 0x004b0ee0 uses. Reuse for the arc
  and descent. DrlBurst (line ~248) is the 0x0051fc9c area hit: reuse for the
  ice / beam hit with radius 20 (ASSUMED) and the attack record from the
  BattleParam row. DrlSegment / DrlSegmentAi (lines 844 / 2293): the same
  "body owns, part follows" pattern as the Barba rows, but the port has no
  model node capture (DeRolLeAi.segmentAt is ASSUMED: trails the head 20 apart).
  Barba needs the node capture first (read the model's bones into the 10 rows
  at 0.5 * (node) each frame). Fix the De Rol Le segments the same way.
- client/src/combat/derollefins.ts (follow-the-leader chain): NOT Barba's
  mechanism. Barba parts are bone-driven, so do not reuse the chain solver.

### Open after pass 4 (blocks the port)

1. G (the centre at *(0x00a48a54)+0x178) writer, and the vector add operand in
   0x004b8584 (row build). Model node capture (bone positions) in the port.
2. Transition vectors in 0x1e98 / 0x2cd0 / 0x30fc / 0x7040 / 0x7860, and the
   random helper values for 0x13 sub-state 1.
3. The attack record at *(root+0x628) (ATP / BattleParam index), and the
   manager DAT_00a72eb4 vt+0x30 / +0x34 (the area-hit dispatch).
4. Who stores root+0x80 (spawn set record) and whether the Barba spawn always
   sets it.
5. Part hit box radii (0x004ba2e4) and the minion boxes.

Ready to port the brain: NO. The movement math for 0x15, 0x13 and 0x0ee0 is
decoded and the anchors / constants are known, so a port could start on the
phase logic with the 0x0ee0 timers, but it would ship with ASSUMED targets
(G, side -> anchor), an undecoded attack record, and no part hit boxes.
Items 1 and 3 are PARTIAL; item 2 is PARTIAL (writer not found).

## Pass 5 (part rows, part hit boxes)

Sources: Ghidra (the root update 0x004b8584, the part init 0x004ba2e4, the static
init 0x004ba2b0), objdump of 0x004b8b88..0x004b8d70 and of the data words.

- Row build (0x004b8584, asm 0x004b8c1e..0x004b8d58): row r = 0.5 * (C[r] + C[r+1]),
  r = 0..9. The add operand of 0x0082ebac (vector add, dst += src) is the next
  capture: C0 = root+0x3f4, C1 = +0x460, C2..C10 = +0x478 + 12 * (k - 2). Rows are
  stored as floats (fstps), not truncated.
- The captures' writer (the draw-order node callback) is NOT found. The De Rol Le
  one is 0x0042a904 (DAT_00ae6dc0, set by 0x0082fac4 before 0x0083046c); the Barba
  draw 0x004b9224 sets no callback, so its capture path is still open. The node
  list is ASSUMED to be De Rol Le's spine (11 draw-order nodes, the same body model
  bm_boss7_de_rol_le_c model 0). The port reads the matrixWorld of those nodes.
- Part box radius 50.0: 0x004ba2d8 writes 0x42480000 to 0x009abc90; 0x004ba2e4
  copies the box 0x009abc84.. to part+0x394.. (radius at +0x3a0, centre words
  zero). Part stats: rows 16 / 15 / 16, HP 20000 (0x004ba2e4), as De Rol Le's segment.
- Park value of the rows: 0x461c4000 = 9984.0.
- Port: combat/barbaray.ts (barbaRows, BarbaPartAi, BARBA_PART_RADIUS),
  render/combat.ts (spawnBarbaParts, tickBarbaParts, barbaPartHit).

## Pass 6: body movement (ported)

Sources: objdump of 0x004b1e58, 0x004b416c, 0x004b41ac (phase 0x15), 0x004b3c2c (0x13),
0x004b0ee0 (phases 5 / 6), 0x004b1c94, 0x004b1de4, 0x0082e900; Ghidra for structure only.
The Ghidra `(int)` casts on the movement words are display artifacts: the asm stores
them as floats (fstps). `int *param_1` indexes are byte offset / 4 (param_1[0x1d3] is
+0x74c, param_1[0x2c] is +0xb0). Port: combat/barbaray.ts (`BarbaRayAi.swimFrame`,
`arcFrame`, `followerFrame`, `enterSwim` / `enterArc` / `enterFollow`, `sideEntry`,
`teleport`, `BarbaFollower`), tests/barbaray.test.ts "body movement".

Axes. x = +0x38, y = +0x3c (the teleport's middle anchor entry), z = +0x40 (third
entry). Heading +0x64 is BAMS (ASSUMED; the port's `angle` is radians). Lift +0x6f8.

Corrections to the brief and to the earlier passes:
- 0x004b7860 (phase 0x1b path, asm 0x004b7dcf) writes +0x40 = -210 (0xc3520000): that is
  z, not y. The side entry 0x004b416c also writes +0x40 = 10.0 (z), not y.
- Dir (+0x750 for the swim) is -1.0 on side 0, +1.0 else (pass 4 said -4.0). The arc's dir
  (+0x74c) is the same -1 / +1 (its enter writes the literal 0xc0800000 = -4.0 only in the
  Ghidra int form, which reads as -0x40800000 = 0xbf800000 = -1.0; asm checked).
- The swim's vz starts at -1.0 (0xbf800000), not -4.0.
- Arc sub thresholds (asm 0x004b0ee0, cmp against the timer +0xc0): sub 0 -> 1 at 10
  (0x906f9c), 1 -> 2 at 20 (0x906fa4), 2 -> 3 at 28 (0x906fa8), 3 -> 4 at 45 (0x906fb0),
  4 -> 5 at 70 (0x906fb8), 5 -> 6 at 64 (0x906fbc, true at once). The pass 4 list
  (25 / 45 / 70) mixed the 25 (0x906fac, the `25 - z` of the sub 3 entry) into the marks.
- The random-direction argument is -1.85 (0xbfeccccd), not -1.2.
- FUN_004b1de4 returns 0.0 (its local_c is never written): the arc's target height is 0.
- 0x82e900 is fabs (asm: the sign test and fchs), not a sqrt.

Swim (phase 0x15 / 0x16, 0x004b41ac). Enter (event 4): followers stop (FUN_004bd1e8),
gate block +0x630 bit 2 set, bit 8 cleared, side entry (x = -100 / +100, z = 10, lift = 4,
heading +0x500 / -0x500), dir = -1 / +1, vx = 0, vy = 0, vz = -1, speed = 0x500, sub 0.
Frame, sub 0: speed = trunc(speed + 256), clamp 16384; vx += 0.08, vy += 0.2, vz += 0.1;
x += dir * vx; z -= vy; lift -= vz; heading = trunc(-dir * speed); the 0x3ed sound once at
speed >= 0x2200. Exit at lift < -137.0: teleport(side), lift = -137, vz = 0, slot 1,
sub 1. Sub 1: lift += 2.0 until >= 0.0, then sub 2 (done; the table step is the leader's).
Frame timing: speed clamps at frame 59, the exit is near frame 63 (ported test).
Leave (event 5): bit 2 cleared only.

Arc (phases 5 / 6, 0x004b0ee0). Enter (event 4): gate block set, bit 8 cleared,
teleport(side) (asm 0x004b1e58), dir (+0x74c) = -1 / +1, slot 5 (side 0) / 6, every
movement word zeroed, sub 0. Event 5 (leave): gate block cleared and side := the table's
flag (+0x6cc). Frame: timer +1; sub 0 of the state waits one frame (ASSUMED: the +0xb0
bit 2 wait is not held). Then the arc sub-states (see the thresholds above):
- sub 0 (10): vx(+0x75c) = (65/20) * dir. Per-frame: vz -= 0.2, z += vz.
- sub 1 (20): vx = (-90/16) * dir; vz-accel (+0x760) = ((16 + 56.67) * -vz + 270 - z) /
  ((0.5 * 16 + 56.67) * 16). Per-frame: x += vx, z += vz.
- sub 2 (28): vy(+0x750) = (0 - vy) / 2.5; accel (+0x754) = vy * 2 / 56.67; vx =
  (-370 / 56.67) * dir. Per-frame: x += vx, vz += accel2, z += vz, vy = 0.
- sub 3 (45): vx = (-30 / 2) * dir; easing = DrlEasing(7, |25 - z|, 0.2, 0.05)
  (0x00434ac4; the decel guard at 0 is ASSUMED); vz = z. Per-frame: x += vx, timer -= 0.2,
  lift += vy, vy -= accel, z += vz.
- sub 4 (70): vx = ((-175 - x * dir) / 36) * dir. Per-frame: x += vx, lift pulled to 0
  (0.4 a tick, FUN_004b1c94), easing tick, z = vz - easing.pos (0x1a4 ASSUMED to be the
  easing's position).
- sub 5 (64, true at once): the same writes as sub 4.
- sub 6: the same pull and easing tick; the easing's state 3 (FUN_0042cdc0 returns 3)
  ends the phase (sub 2 of +0x730); bit 8 of the flags set when the slot is 1.

Side 0 anchor 0 is (-175, 7, 25), side 1 is anchor 1 (0, 7, 500).

Followers (phase 0x13 / 0x14, 0x004b3c2c). Enter: side entry, the wait count +0x73c = 180,
speed +0x740 = 120, sub 0, gate block bit 2 cleared (the 0x13 enter masks 0x104).
Sub 0: 41 ticks (`+0x734 > 40`), then sub 1. Sub 1: one follower every 180 ticks
(+0x73c): a live target (FUN_00520f04) is the target's position, else a random point
(r = 120 * rnd, a random direction; ASSUMED form), each via FUN_004bd190 with the speed
kept only in 1..599 (else 120). After four, sub 2: wait until all four are at state 4 or
601 ticks, then sub 3. The root never moves in 0x13 (the body stands at the side entry).
Followers' own motion is not decoded (ASSUMED: straight at speed / 30 a tick, arrival
resets nothing else); they are not drawn.

Not ported (open):
1. Transition bodies: 0x004b1e98 (its per-line vectors use the ring rows 0x14e..0x16b and
   0x194 / 0x19c / 0x1a4), 0x004b2cd0 (speed -0x3b860000 = -(a float), the 0x1e58 anchor
   teleport at enter), 0x004b30fc (x / z velocities from 0x1d3..0x1da), 0x004b7040, and the
   0x004b7860 pull-back to z = -210 (its condition is the flag tests on *(0x62c)+8). Their
   teleports are not wired; the phase -> handler map for 0x03..0x0e, 0x0d and 0x11..0x12
   is not decoded (only phases 5 / 6, 0x13 / 0x14, 0x15 / 0x16 are dispatched).
2. The 0x201 / 0x20f / 0x20c effect spawns (0x004be7c0, 0x0050981c) and the 0x3ec / 0x3ed
   sound timers of the arc: visual, not emitted.
3. The side the enter uses: 0x0051f62c passes no side, so the port uses the last side
   (BarbaRayAi.side). The 0x0ee0 leave's side := variant is decoded; the enter's
   param_3 / param_4 source is not (the 6xA9 carries no side).
4. The ground / arc value: FUN_0042cdc0 is ASSUMED to be the DrlEasing of the arc (its
   state 3 = done). The z = vz - 0x1a4 assignment is taken as written.
5. The followers' drawing, start position (ASSUMED: the origin) and speed unit.
6. The 0x0ee0 wait bit (+0xb0 bit 2) and the motion-player meaning of vt+0x184 / 0x188.

Result: the body moves in the 0x13 side entries (x = -100 / +100, z = 10, heading), the
0x15 swim (x and z drift, the heading turns, the teleport back at the exit) and the 0x5 /
0x6 arcs (teleport to the side anchor, x and z moves). The e2e records the body place per
sample (barbaray-smoke.spec.ts).

## Pass 7: the phase dispatch (Ghidra) and the corner transitions

Source: `tools/ghidra/decomp.sh 0x004b02b4` (the dispatcher `FUN_004b02b4`, the switch on the
phase). It corrects pass 6: the arc is phases 4 and 0xa (`FUN_004b0ee0(p, 0, 2)` /
`(p, 2, 0)`); 5 and 6 are corner transitions (`FUN_004b1e98(p, 0, 3)` / `(p, 1, 2)`).
Full map: 3 (0,1), 5 (0,3), 6 (1,2), 8 (1,0), 9 (2,3), 0xb (2,1), 0xc (3,0), 0xe (3,2);
0x28 / 0x29 (current anchor -> its 5 below / above); 0x2a..0x39 fixed (6,7) (7,8) (8,5)
(5,6) (6,5) (5,8) (8,7) (7,6) (6,9) (9,8) (8,9) (9,6) (5,9) (9,7) (7,9) (9,5);
0x0d 0x004b7040; 0x0f / 0x10 0x004b2cd0; 0x11 / 0x12 0x004b30fc; 0x13 / 0x14 0x004b3c2c;
0x15 / 0x16 0x004b41ac; 0x17 0x004b6d08; 0x18 0x004b6300; 0x19 / 0x1a 0x004b4684;
0x1b 0x004b60c4; 0x1c 0x004b5d1c; 0x1d 0x004b5c98; 0x3a..0x3c the spawner (0x004b4e6c).
Dispatch 0 / 1 / 2: 0x004b9e54 / 0x004b8034 / 0x004b7860 (the pull-back to z = -210).

The transition body 0x004b1e98 (ported, `BarbaRayAi.enterTransition` / `transitionFrame`):
enter (event 4): the body to anchor `from` (0x004b1e58 via ProcessPlayerAction4, lift 0,
heading 0); the x, y, z origins are the body; signs +0x754 / +0x760 / +0x758 are sign(to - from)
per axis; the x and y easings are 00434afc(max 3 / 6, dist, rate 0.08 / 0.16) (low when to < 5);
the z easing is 00434ac4(max 7 / 14, dist, accel 0.2 / 0.4, decel 0.05) when the z sign is <= 0,
else 00434afc(max 5 / 10, dist, rate 0.08 / 0.16); the sub-state (+0x734) is 1 / 2 / 3 by the
anchors when y does not move, 4 when it does. Frame (event 0): the sub-state (approach 0,
x-first 1, x-then-z 2, z-first 3, settle 4), then x = out_x * sign_x + x0, y and z alike. Done
(0x730 = 1) sets the leader's cue (event 9): the next table step.

Constants are the exe's (exedata): see DEVLOG 2026-10-24. Open: the volopt holders (+0x6e4),
the animation-speed ramp (+0xc8 shared), the arrival ack (event 2), and the phases listed in the
DEVLOG entry. CONFLICT (not resolved): the arc's enter teleports to `side` (asm), but the dispatch
passes (0, 2) and (2, 0); for phase 0xa the from anchor is 2.

## Pass 8: the body phases (0x0d, 0x0f/0x10, 0x17, 0x19/0x1a, dispatch 0)

Ported in `combat/barbaray.ts` (2026-10-24, DEVLOG). Each has a test in `tests/barbaray.test.ts`.
This supersedes the "still open" list of pass 7 for these phases.

| Phase | Handler (Ghidra name) | Status | Decisive fact (address) |
| --- | --- | --- | --- |
| 0x0d | `HandleSinowberillMovementState_004b7040` | ported | enter: slot 1, `0x6c8 = 3`, teleport 3; event 9 at 0x730 == 3; event 5: `0x6c8 = 1`, gate block clear |
| 0x0f | `ProcessPlayerVoloptInteractionState2_004b2cd0` (side 0) | ported | enter: `0x6c8 = param`, slot 3; sweep: row i y < row i+1 y, index 4 = `0x906ee4` |
| 0x10 | same (side 2) | ported | as 0x0f with side 2 |
| 0x11 / 0x12 | `ProcessPlayerAction4_004b30fc` | ported (pass 9) | enter: slot 1, anchor = side; sub 0 windup 11 frames then slot 7 / 8; the jump on the clock 6 / 13 / 20 / 25; event 2 = the keyboard (Left 0xe, Right 0xc ASSUMED) |
| 0x17 | `ProcessSinowberillActionState_004B6D08` | ported | enter: slot 0xc, gate open, anchor 3; event 9 at `b8 == 0xf`; 0x3ec at timer 10.0 |
| 0x18 | `ProcessSinowberillPlayerState_004b6300` | ported (pass 15) | targets a player (`FindAndProcessSinowberillTarget_00521324`), map ray cast, attack sub-entities |
| 0x19 / 0x1a | `ProcessSinowberillAction_004b4684` | ported | enter: slot 0xe, gate open; event 9 at `b8 == 1`; 0x3ed at timer 8.0 |
| dispatch 0 | `SetEnemyAnimationState_004b9e54` | ported | enter writes `b8 = 1`; the frame runs `Player__Animate` only |
| dispatch 1 | `HandleSinowberillSpecialAttackState_004b8034` | open | the intro: photon-blast check, NPC camera, cues at 60 / 83 / 105 / 85 / 98; table step on `GetGlobalGameState()+2 & 1` |
| dispatch 2 | `HandleSinowberillInputState_004b7860` | open | the local keyboard (`g_KeyboardSharedState`); key 0xd on side 0 sets z = -210 |

**The sequence of a ported phase.** Event 0 is the phase's frame; the leader's event 9 is the table
step once the phase reports done. For the drop (0x0d) done is 0x730 == 3; for the volopt (0x0f / 0x10)
it is the sweep's index 4 (0x734 == 2); for the beam (0x17) it is slot 15 (beamwait), reached through
the beam_a chain (`BARBA_SLOTS[12]`, mode 2, next 15); for the shot (0x19 / 0x1a) it is slot 1,
reached through the beam_c chain (`BARBA_SLOTS[14]`, next 1). The volopt, beam and shot waits fall back
to `BARBA_DWELL` when they never finish (ASSUMED: flat rows, no model, no motion end), so the brain
never hangs.

**The .bss constants.** 0x0d reads `DAT_00a47a9c`, `DAT_00a47a98` and `DAT_00a47aa0`. They are written
once by the static init (pass 10: a9c 18.33, a98 30.77, aa0 0.195, PROVEN), not dynamic. The pass 9 values
1.0 / 30.0 / 0.0 were ASSUMED and are replaced (see Pass 10). The 0x11 / 0x12 jump reads `DAT_00a47a80` .. `DAT_00a47a8c` (the same
kind, not ported).

**ASSUMED (all marked in the code):** +0xc0 is the animation clock (one a tick); the animation hold
(0xb0 bit 4) is clear; the volopt's done assumes 0xb0 bit 0x10 is set; the acks (event 2, 0x2a9 / 0x3aa)
are not sent; the attack objects (`UpdateSinowberillAttackPos3`, 0x201) are not spawned, so their random
draws are not taken; the per-frame sounds use a stride of 1 at the threshold crossing;
`GetPlayerLocalY` is the body's y.

**Open for the next pass:** 0x18 (the player targets and the attack effects), dispatch 1 (the global
game-state flag and the camera), dispatch 2 (the mode of the input poll, see pass 9). The attack object
(0x201) is the largest unported effect; the port draws none.

## Pass 9: the jump (0x11 / 0x12, 0x004b30fc), 2026-10-25

Ported in `combat/barbaray.ts` (`BARBA_JUMP`, `BarbaRayAi.jumpFrame` / `jumpLeader` / `jumpInput`), the
input is `BarbaRayAi.input` (set by `render/combat.ts` for the leader). Tests: `tests/barbaray.test.ts`
(the jump block). Sources: the reference dump `src/Psobb.exe-05112026.c` (`ProcessPlayerAction4_004b30fc`,
line 235078; the names there are the reference's, used for the offsets), `tools/ghidra/decomp.sh 0x004b30fc`
(cross-check), `tools/exedata.py read` for the .data floats, and objdump of the static init
(`mov dword ptr [0xa47a80..0xa47a90]`, `objdump -d -M intel PsoBB.exe --start-address=0x4b9b28`).

Proven:
- Dispatch: `0x11` -> `ProcessPlayerAction4_004b30fc(this, event, 0)`, `0x12` -> `(this, event, 2)` (the
  dispatcher, reference line 232976..232985). The third argument is the side: the anchor (0x6c8, the same
  word as +0x1b2) and the dir.
- Enter (event 4): slot `0xb8 = 1` first; the gate block (`0x630 = (0x630 & ~0x100) | 4`); the body to
  anchor `side` (FUN_004b1e58); z0 = the anchor's z; vz 0; z accel -0.2 (0xbe4ccccd); the sub-state 0.
  The pass 8 ASSUMED order (7 / 8 at the enter) is wrong: the enter writes 1 and the sub 0 end writes 7 / 8.
- Event 0, sub 0 (windup): 11 frames (`0x734 + 1 < 11` stores, the 11th frame ends). The end sets dir
  (`0x74c` = -1 side 0, +1 side 2), slot 7 (r_bite) / 8 (l_bite). The motion (z += vz, vz += accel, clamp -7)
  runs in subs 0..2.
- Sub 2 -> 3 at the clock 6.0 (0x906e8c): x0 = x, vx = (100 dir - x) / 7.0 (a8c), z0 = z, accel = vz / -7.0.
  Sub 3 -> 4 at 13.0 (0x906e98): x0 = 100 dir, vx = (135 dir - 100 dir) / 7.0 (a84), accel = (10.0 - z) * 2.0 / 144
  (a88 squared). Sub 4 -> 5 at 20.0 (0x906ea4): x0 = 135 dir, vx = (100 dir - 135 dir) / 5.0 (a80), yaw speed
  -1280 dir / 5.0 (0x906ed0). Sub 5 -> 6 at 25.0 (0x906ea8): the landing.
- Motion of the post-transition sub: sub 3 x = vx t + x0, z = (0.5 accel t - 7.0) t + z0 (t = clock - 6);
  sub 4 z = 0.5 accel t^2 + z0 (t = clock - 13), x as sub 3, lift = min(7 * 4 * t, 4.0) (a84 * a90, a90 the cap);
  sub 5 z = 0.5 accel t^2 + z0 (t = clock - 13), x = vx t + x0 (t = clock - 20), yaw = round(yaw speed * t).
  The landing frame (clock 25) has no motion, so the last x is 107 dir (sub 5 at t = 24).
- The constants: .data (exedata) 906e8c 6.0, 906e98 13.0, 906ea4 20.0, 906ea8 25.0, 906e94 100.0, 906ea0 135.0,
  906e9c 100.0, 906e90 10.0, 906ecc 2.0, 906eb0 -7.0, 906ed0 1280.0, 906eb8 0.5, 906e74 7.0, 906e88 15.0,
  906e84 17.0 (the attack band, not used), 41080000 = 8.5, 41700000 = 15.0.
  The .bss (static init 0x004b9b28..0x004b9bba, `mov` immediates): a80 = 5.0, a84 = 7.0, a88 = 12.0,
  a8c = 7.0, a90 = 4.0 (the reference's `g_SinowberillAttackParams`).
- Sounds: 0x3ed at the clock 8.5 (sub 3), 0x3ec at 15.0 (sub 2 and on), 0x3ee at the landing.
- Event 9 (the table step) is gated by slot 9 / 10 in the reference (the reference line 235198). Slot 9 / 10 are
  the bite loops that r_bite / l_bite chain into, so the table steps once the jump's motion chain has ended.
- Event 2 (the keyboard, reference line 235148): `g_KeyboardSharedState[0xe]` (Left) set -> send 0x13 (side 0) /
  0x14 (side 2) with 6xAA; else `[0xc]` set -> 0x15 / 0x16 with 6xA9. The root frame sends event 2 only in the
  mode that polls the keyboard (the mode writers are not decoded).
- Event 5: clears the gate block (0x630 & ~4).

ASSUMED (all marked in the code):
- The clock (+0xc0) starts at the sub 0 end (the slot 7 / 8 start) and counts one a tick from sub 1 on.
- Sub 1's wait on 0xb0 bit 2 is clear (one tick).
- `g_KeyboardSharedState[0xc]` is the Right palette key (the Left key is `[0xe]`, the keyconfig comment).
- Event 2 is the leader's poll: with `BarbaRayAi.input` set, the keys decide and event 9 does not run; without
  it, event 9 steps the table at slot 9 / 10 (the mode-0 path). The render layer always sets the input for the
  leader, so the jump waits for a key (the stated behaviour, to check against the exe's mode).
- The sound marks are crossings (one a frame).
- Not ported: the camera shake (`unknown_camera_shake_from_enemy_landing_and_jump`), the crate flags
  (CrateEntity_SetFlag12 / 13, 0x004bff38 / 0x004bff50), the minion (CreateGalgryphonMinionEntity, 0x004ac9ac,
  a Galgryphon minion, not the Pig Ray), the four volopt frictions on 0x6e4..0x6f0 (ProcessVoloptInteractionFriction),
  the particles (0x161, 0x448 / 0x454) and the attack objects (0x201, UpdateSinowberillAttackPos3, not spawned,
  so no random draw).

Pass 9's correction (the static init writes a9c / a98 / aa0) is resolved in Pass 10 below.

## Pass 10: the 0x0d drop constants from the static init, 2026-10-25

Proven (objdump -d -M intel PsoBB.exe; `tools/exedata.py xref 00a47aa0 / 00a47a98 / 00a47a9c`):
- The static init is the function at 0x004b99a0 (not 0x004b99d3: the entry is the two `fld` at 0x004b99a0
  and 0x004b99a6, then the movs from 0x004b99ac). It loads `fld dword [0x906c30]` (17.0, ST(1)) then
  `fld dword [0x906c1c]` (6.0, ST(0)). Then:
  - 0x004b9b28: `a47a7c = 0.3`; `fxch`; `fdiv a47a7c`; `fstp a47a70` = 17.0 / 0.3 = 56.67 (the 0x906fe4 multiplier;
    `(-370 / 56.67)` in the port's arc).
  - 0x004b9b68: `a47aa0 = 0x3e47ae15` = 0.195 (liftZero).
  - 0x004b9b72: `fdiv a47aa0`; 0x004b9b78: `fstp a47a98` = 6.0 / 0.195 = 30.769 (attackB, B).
  - 0x004b9b7e: `a47a9c = 0x4192aaaa` = 18.333 (attackA, A).
  - 0x004b9b88 / 0x004b9b92..0x004b9bba: a47ac0, a47a8c..a47a90 (the pass 9 jump constants, unchanged).
- Only writers: the init (xref hits 0x004b9b68 / 0x004b9b6a..74 for aa0, 0x004b9b7a for a98, 0x004b9b80 for a9c).
  The other refs are reads: 0x004b718b / 0x004b7199 / 0x004b75d7 (the rise and the sub 1 values, divisor B),
  0x004b75df / 0x004b75e5 (A), 0x004b73f2 (`fsub a47aa0`, then `timer - (0.3 - aa0)`). The static-init writes
  are literal absolute stores, so this is the full set of direct writers; a write through a computed base
  pointer into the same words was not searched for (none is expected: the words sit in the init's block).
- Ghidra body (refsrc `HandleSinowberillMovementState_004b7040`, `Psobb.exe-05112026.c` line 238247): the rise
  speed `((A + B) * -vy + (300 - z)) / ((0.5 A + B) * A)` with A = `_DAT_00a47a9c`, B = `_DAT_00a47a98`,
  fVar3 = 0.5 (906d28); the sub 1 `((40 - y) * 4.0) / B` and `(f * 2.0) / B`; the sub 2 `timer -= 0.3 - aa0`.
  The port's formulas match this; only the three values were ASSUMED.
- Port: `BARBA_DROP.attackA` 18.333332, `attackB` 6 / 0.195, `liftZero` 0.195 (PROVEN). The sub 2 clock step is
  1 - 0.105 = 0.895 a tick (was 0.7 with the assumed 0.0 aa0). The rise speed at the sub 0 -> 1 transition is
  802.43 / 732.2 = 1.096 (the old 1.0 / 30.0 gave 726.4 / 30.5 = 23.8), so the drop's rise differs from pass 9.
- Test changes (`tests/barbaray.test.ts`, the 0x0d block): the constants are asserted; the fall speed min
  (-4.2, never the -7 clamp in the fall); the rise speed 1.096 after the sub 0 -> 1 transition; the sub 2 clock step
  0.895 (once: the clock is already past 22 when sub 2 starts, so sub 2 lasts one tick). The old "speed clamped
  at -7 over 61 ticks" check was dropped: after sub 2 the port's sub 3 sets the speed to z (Ghidra: `0x754 = 0x40`
  when the speed reaches 0), so the speed is not -7-bounded past the fall (faithful to the Ghidra body).

Observed, NOT changed (a follow-up): after the drop's sub 3 the port's body keeps moving down (z falls from -302
to -575 over 60 ticks in the trace), because the rise easing `ez` adds `pos` and `z = 0x754 - pos`. The Ghidra
body says the same (`0x40 = 0x754 - 0x690`), so the sign of the easing output (`Player__ApplyVelocityEasing`,
`InitializeMovementTargetStruct_00434ac4(7, |500 - z|, 0.2, 0.05)`) is the suspect, not these constants.

Pass 9's correction (the static init writes a9c / a98 / aa0) was resolved above in this pass.

Pass 9's note, kept for the record:
- The static init (0x004b9b68..0x004b9b88) writes `a47aa0 = 0.195` (0x3e47ae15), `a47a98 = X / 0.195` (the fdiv
  of the FPU top, 6.0 per the pass 8 table, so 30.77), and `a47a9c = 18.33` (0x4192aaaa). `BARBA_DROP` used the
  ASSUMED values 1.0 (a9c), 30.0 (a98) and 0.0 (aa0). The drop reads `liftZero` at its timer step
  (`timer -= 0.3 - liftZero`), so the drop's timer step is 0.105 a tick, not 0.3, if the static init holds.
  Pass 8's "dynamic, no value in the image" was wrong for these three.

## Pass 11: the drop's z after sub 3 (the easing sign), verdict NOT a port bug, 2026-10-25

Question (Pass 10's follow-up): after the drop's sub 3 the body's z keeps falling (-302 to -575 over 60 ticks). Is the
easing's sign wrong in the port?

Proven (objdump -d -M intel ~/Downloads/psobb-client/PsoBB.exe; `tools/exedata.py calls / xref`):
- Drop sub 3 rise (0x004b7040, the branch on f758 > 0 at 0x4b74a5..0x4b74c7): `call 0x42cdc0` (Player__ApplyVelocityEasing
  on this+0x678); `cmp eax, 3; je` sets 0x730 = 3 (done) and does NOT write z; else `fld [0x754]; fsub [0x690]; fstp [0x40]`,
  i.e. z = speed - easing.pos (0x690 = 0x678 + 0x18, the pos). Ghidra body (`HandleSinowberillMovementState_004b7040`,
  refsrc Psobb.exe-05112026.c line 238247) says the same: `*(0x40) = *(0x754) - *(0x690)`.
- The easing init (0x4b7455..0x4b749d): dist = |500 - z| (`fabsf`), `0x40e00000` (7.0) = max, `0x3e4ccccd` (0.2) = accel,
  `0x3d4ccccd` (0.05) = decel, `call 0x434ac4` (InitializeMovementTargetStruct_00434ac4), then speed (0x754) = z (0x40).
  The `else` branch (f758 = 0) takes speed -= 0.2 and inits when speed <= 0.0 (`0x906f64` 0.2, `0x8fd044` 0.0).
- ApplyVelocityEasing (0x42cdc0) and the port's `BarbaEase.tick` match instruction for instruction: state 0 v += accel up to
  max; state 1 holds v until pos > brake, then v -= decel; state 2 v -= decel until v < 0 (state 3, v = 0); pos = min(pos + v,
  dist). pos is never negative, so the sign of z - pos is the exe's own. Normalize (0x434a3c) with the constants 1.0
  (8fcc40), -1.0 (8fcc44), -2.0 (8fcc3c), 0.5 (8fcc38) matches the port's `normalize()`.

Conclusion: the port's easing and the drop's z formula are the exe's. No code change to `BarbaEase` (shared with the transition
and the arc in `barbaray.ts`; no other port uses it). The "keeps falling" is the exe branch with a negative speed: the port's
clock (ASSUMED one a tick, `timer += 1`) makes sub 0 -> 1 -> 2 -> 3 run in 3 ticks at clock 21..24 (the thresholds 10.5 / 16 /
22 are already past), so the rise speed (f758 = 1.096) adds once to -4.2 and sub 3 starts at -1.55 <= 0. The easing then starts
from the body's z at -302.4 (not the designed apex near 300), with dist 802.4, and z settles after the easing is done:
at tick 228 after the drop starts (moveSub 3), z = -1103.908 = -302.408 - 801.5 (pos stops at 801.5, state 3 with v = 0), and
it stays there (checked 50 more ticks). So the body settles; it does not run away.

What is still open (ASSUMED): the clock 0xc0 is the animation time (Player__Animate not ported). If the exe's clock runs slower
or resets at the slot 4 change, sub 1 / 2 last longer, the rise reaches the apex near 300, and the drop ends near 100. That
needs Player__Animate (the 0xc0 writers) to decide; the easing is not the cause.

Test: `tests/barbaray.test.ts`, the drop block after the enter / fall checks: the easing's max / accel / decel / dist from
the apex, pos >= 0, z settled (no tick moves it over 50 ticks) and z = apex - pos (`node tests/barbaray.test.ts` ALL PASS).

## Pass 12: the drop's clock (+0xc0, Player__Animate), 2026-10-25 (its stride and start: superseded by Pass 13)

**Question:** who writes +0xc0 on this entity, at what rate in the drop motion, and when is it reset? Pass 10 / 11 assumed one a tick, which runs the drop's sub 0 -> 1 -> 2 -> 3 in 3 ticks and settles at z -1104.

**Proven (refsrc `Psobb.exe-05112026.c`; objdump `~/Downloads/psobb-client/PsoBB.exe`):**
- +0xc0 is `current_animation_elapsed` (enemy struct, line 74933). NJM_UpdateAnimation is called with (+0xf8 current_njm, +0xc0 elapsed) at lines 174946 / 234146 (same struct layout).
- Writer: `Player__Animate` (line 791218). Each call: `elapsed += stride` (+0xc8, `animation_frame_stride`) unless `animation_flags & 0x40` (+0xb0); then the id check (`animation_id` +0xb8 vs `field99_0xba`, `Player__StartNpcAnimation` on a change); then the sType 1..5 wraps (sType 4 resets `elapsed = g_AnimationFrameStride`; sType 5 is a net-zero hold).
- The drop calls it once per tick: the drop's event 0 (`HandleSinowberillMovementState_004b7040`, `param_1 == 0`, line 238386) runs `Player__Animate(this)` before its sub-states. The per-frame root `UpdateSinowberillEntity_004b8584` (line 239279) calls `vt+0x164(state, 0)` (the dispatcher 0x004b02b4 = `PlayerActionDispatch`, line 232924) each tick, so event 0 of phase 0x0d runs every tick. (The root vt+0xac / vt+0xb0 are countdowns, 0x007782b4 / 0x00778580, not the clock.)
- The drop's enter (event 4, line 238247..) writes +0xb8 = 1, the gate, 0x6c8 = 3 and the 0x730..0x758 words. It does NOT write +0xc0 or +0xc8. So the clock is not reset at the enter (the value it carries is the previous motion's; the port resets it to 0 in the generic enter, ASSUMED, and it does not matter: see below).
- The stride: `Enemy__InitAnimation` (line 791358) sets +0xc8 = the row speed `unknown_animation_data[id] +8` (the table is 0x009aba20: the Barba ctor 0x004af634 stores it at +0xd8, `objdump` 0x4af894). The static init 0x004b9bd8 writes slot 0/1/3/4/5 speeds as 0.7 / 0.6 / 0.4 / 0.3 / 0.5 (objdump 0x4b9bf6..0x4b9c1e, the port's table is right).
- `Player__StartNpcAnimation` (line 791013), the else branch, writes `animation_speed` at +0xcc (player struct, line 76371), not +0xc8. So a slot change alone does NOT change the drop's stride.
- The sub 2 lift step (line 238527): `elapsed -= (0.3 - a47aa0)` with `a47aa0 = 0.195`.

**Consequence (the clock is exact at a stride of 0.3 ASSUMED):** the designed constants line up only with a stride of 0.3 in the drop:
- sub 0 (fall, 21 ticks) + sub 2's wait (734 == 0, 14 ticks) = 35 ticks, the clock 10.5 (0x906cf0) at 35 x 0.3 (the speed reaches the -7 clamp, 906e74, on the same tick).
- sub 2 (734 == 1, the accel): 16 - 10.5 = 5.5 = 18.33 x 0.3, so A = a47a9c = 18.333 ticks.
- sub 2 (734 == 2, the lift): net 0.3 - 0.105 = 0.195 a tick, 22 - 16 = 6, so B = 6 / 0.195 = 30.77 ticks = a47a98.
These exact matches are the evidence for 0.3, but the stride itself is not traced: it is the +0xc8 value left by the last `Enemy__InitAnimation` / sType path, which this pass did not find. ASSUMED: 0.3 (`BARBA_DROP.clockStride`).

**Port (`combat/barbaray.ts`):** `playerAnimate()` (the add) runs first in `dropFrame()`; the lift step is `- (0.3 - liftZero)`; the stride is `BARBA_DROP.clockStride` (0.3). The one-a-tick `timer += 1` is gone. The sub-state thresholds, the rise formula and the easing are unchanged.

**Result (probe, 900 ticks):** the fall bottoms near z -373 at tick 35; the rise (sub 1 accel 18 ticks, sub 2 lift 31 ticks) peaks near 559 at the sub 3 halving and sub 3 / 4's deceleration; the easing then settles on z 500 (anchor 1) and stays there. The body no longer runs away to -1104.

**NOT matching the docs' "apex near 300":** with these constants the peak is ~559, not 300. The 300 is the rise formula's target (`z0`), and the rise overshoots it by the 14 ticks of sub 2's fall (the speed reaches -7 before the accel) and by the sub 3 / 4 deceleration after the speed halving. Whether the exe really peaks near 300 is NOT settled: the stride or the start clock could differ (a different fall stride gives a different sub 0 / 2 split), and the exe's apex is unproven. Open for the next pass: the +0xc8 writer that sets 0.3 before the drop (the previous motion's `Enemy__InitAnimation`, or a sType 4 wrap), and the njm frame counts of motions 10 / 11 (not decoded: the mode 1 / 2 wraps are ASSUMED not to fire in the drop's ~60 ticks).

**ASSUMED (marked in code):** the stride 0.3 (`clockStride`), the hold 0x40 clear, the blend branch of StartNpc not taken, the generic enter's clock reset to 0, the sType 1 / 2 wraps not reached in the drop.

**Tests (`tests/barbaray.test.ts`, the 0x0d block):** the rise speed is checked at the 35th tick (the clock reaches 10.5) against the formula with the values before that tick; the lift steps the clock 0.195 for ~30 ticks; the other sub-states step 0.3; the fall bottoms near -373, the peak lies in (300, 600), the body lands on z 500 (+-0.5) after the easing.

## Pass 13: the drop's stride is the blend's (slot 4, 0.3), the clock resets there, the apex is ~672, 2026-10-25

**Question (Pass 12's open items):** (1) what writes +0xc8 = 0.3 before the drop; (2) why the port's apex is ~559, not ~300.

**Verdict:** the stride 0.3 is PROVEN (it is slot 4's row speed, written by the blend's wrap). The clock resets to 0 at the
sub 0 -> 1 change (Pass 12 missed this: the port kept the clock running through the fall). With the reset the exe-model apex is
~672 (not 300): the port's 559 is the no-reset run, reproduced exactly by a discrete replay (below). The "300" is the rise
formula's target only.

**Proven (Ghidra refsrc `Psobb.exe-05112026.c`; objdump of `~/Downloads/psobb-client/PsoBB.exe`):**
- Player__Animate = 0x007aa094 (called from the drop's event 0 at 0x004b70a4). Its asm: `+0xc0 += +0xc8` (0x007aa0ba..c5), then
  `Enemy__CheckAnimationId` (0x007a9970 = `(+0xb8 != +0xba)`), then the sType switch (`+0xf4`).
- The blend: StartNpc (0x007a9a6c, Player__StartNpcAnimation) copies the new row's flags (row +0xc) to +0xb4, then takes the BLEND
  branch (0x007a9c70) when `(+0xb0 & 0x81) == 0`, `(new flags & 0x80000000) == 0` and `(old row flags & 0x40000000) == 0`. The
  blend sets `+0xb0 |= 6` and `animation_type = 4`; the else branch clears `+0xb0 & 4` and sets the type from the row.
- sType 4 wrap (0x007aa369): when `1.0 <= +0xc0` (0x97d97c = 1.0): `+0xc0 = [0x97d978]` = 0.0, `+0xc8` = row speed of
  `animation_id` (`[+0xd8 + 16*id + 8]`, unless `+0xb0 & 0x100`), type = next (`+0xf6`), `+0xb0 = (+0xb0 & ~4) | 8`.
- Drop sub 1 (0x004b7040, the `iVar4 == 1` branch): `if ((+0xb0 & 4) == 0) 0x730 = 2`. So sub 1 lasts until the wrap.
- Rows (0x009aba20, 16 bytes; `tools/exedata.py motions`): slot 1 = motion 11 forward, mode 1, speed 0.6 (static init writes
  0x009aba38 = 0x3f19999a); slot 4 = motion 10 fjump, mode 2, next 1, speed 0.3 (0x009aba68 = 0x3e99999a, static init 0x004b9c14).
  The flags word is 0 for slots 1 and 4; slot 0 has 0xc0000000 (so the blend never starts from or into slot 0 in this drop).
- Frame counts (njm frameCount of `bm_boss7_de_rol_le_c.bml` from `data.gsl`, BML entry 6 + motion, parsed with
  `formats/njmotion.ts`): motion 10 = 40, motion 11 = 34. The exe's count is `dwUnk + (1.0 or 0.0)`, so the off-by-one is ASSUMED
  irrelevant here.
- Sequence: enter (slot 1, +0xc0 not written) -> 21 fall ticks at stride 0.6 (slot 1's loop) -> tick 21 writes 0xb8 = 4 -> tick 22:
  Player__Animate adds 0.6, StartNpc(4) blends, the clock is >= 1.0 at once, wraps to 0 with stride 0.3, and sub 1 ends in the same
  tick -> sub 2 from tick 23 with the clock 0 and step 0.3 (the lift steps 0.195). The clock hits 10.5 on tick 57, 16 on tick 76, 22 on
  tick 106, 29 on tick 130. Motion 10's end (type 2, clock 39 = count - 1) comes at tick ~163, after the rise and sub 3's halving; it
  re-blends into slot 1 and resets the clock again but nothing reads the clock after 29, so the drop's z is unaffected.

**Discrete replay (scratchpad `drop_sim.py`, float32, the exe's sub-state ladder: one transition per tick, the motion of the new
state in the same tick):** z at tick 57 = -521.4 (rise start), the fall bottom -528.2 (tick 60), the speed reaches 23.1 at the lift
end, sub 3 halves it to 11.3 (tick 106, z 356), then the -0.2 decel adds ~320 above it. Easing starts at tick 163 with z = 672.44;
it lands on 500 (`apex - |500 - apex|` = 500 for any apex above 500). The fall-stride choice (0.6 or 0.3) does not change the apex
(the reset erases it); the apex varies only 667..684 for a 1-2 tick shift of the blend wrap (ASSUMED: the loop's phase at sub 0's
end, the wrap is at tick 22 or 23).
- Port-like run (no reset, stride 0.3 throughout, the clock from the enter): apex 558.95 = the port's old 559. That is the whole
  difference: the port kept the clock running through the 21 fall ticks (its sub 2 wait started at tick 35, not 57).

**Why ~300 is not the apex (the "sub 3 rule"):** the rise formula `a = ((A+B)(-v0) + (300 - z0)) / ((0.5A + B) A)` makes the
continuous z reach 300 after A + B ticks, but the speed at the lift's end is not 0. Sub 3 halves it (0x004b7040 `0x754 *= 0.5`) and
the else branch then decelerates it by 0.2 a tick while adding it to z, which adds about (v/2)^2 / 0.4 above the 300. The easing starts
only when the speed reaches 0 (`fVar6 <= 0.0`, 906d24), with `z = 0x754` at that tick. So the apex is 300 + that overshoot.

**Port (`combat/barbaray.ts`):** `BARBA_DROP.fallStride` 0.6 and `dropStride` 0.3 replace `clockStride`. `playerAnimate()` adds the
stride, starts the blend on the id change (`blendWait`), and wraps at 1.0 (`blendOn`: clock 0, stride 0.3). Sub 1 waits for the wrap
(`moveSub = 2` only when neither flag is set). `tests/barbaray.test.ts`: the blend tick (22), the rise at tick 57 (k = 56), the fall
bottom -528 (-545..-515), the apex 672 (600..700), the landing 500 (unchanged).

**ASSUMED (marked in the code):** the blend branch is taken (the +0xb0 bits 0x1 and 0x80 are clear: no writer found in the Barba's
code; the ctor sets `animation_flags = 0`, dump line 232606); the loop's phase at sub 0's end (the wrap at tick 22 or 23, +-2 units of
apex); the njm frame count off by one (no effect); the clock's start at the enter (not traced; erased by the wrap); the type 2 end of
motion 10 and its re-blend after the rise (no effect on z).

**Not changed, open (closed by Pass 14):** the other phases still used `timer += 1` a tick (the jump 0x11 / 0x12, the arc, the volopt, the shot).

## Pass 14: the other Barba states on the shared clock (Player__Animate), 2026-10-25

**Question:** which Barba states still advance the clock by 1 a tick, which of them read +0xc0 at all, and do the
exe's motion slots (stride per row, blend on the id change, wrap to 0 at 1.0) change their timing?

**Shared model (`combat/barbaray.ts`, `animateClock` / `crossed`; one helper for every state):** Player__Animate
(refsrc `Psobb.exe-05112026.c` line 791218, objdump 0x007aa094) is called at the top of event 0 in the exe for:
the idle 0 (`SetEnemyAnimationState_004b9e54`, the only thing in its event 0), the drop 0x0d (0x004b7040, 0x004b70a4),
the jump 0x11 / 0x12 (0x004b30fc, line 235288), the shot 0x19 / 0x1a (0x004b4684, line 236150), the beam 0x17
(FUN_004b6d08, `FUN_007aa094()` first), the arc 0x04 / 0x0a (FUN_004b0ee0, sub 0 and sub 1), the volopt 0x0f / 0x10
(FUN_004b2cd0), the followers 0x13 / 0x14 (0x004b3c2c, line 235672), the swim 0x15 / 0x16 (0x004b41ac, line 235957),
the transitions 0x03..0x0e (0x004b1e98, FUN_007aa094 first) and the finale 0x1c (0x004b5d1c, line 237402). The timed
0x1b (0x004b60c4) and the dead 0x1d (0x004b5c98) do not call it.

Its steps (PROVEN, from the refsrc body): (1) `+0xc0 += +0xc8`; (2) the id check: `Enemy__CheckAnimationId` (+0xb8 vs
+0xba, the started id) and `Player__StartNpcAnimation` on a change; the BLEND branch (`+0xb0 |= 6`, type 4) is taken when
`(+0xb0 & 0x81) == 0`, the new row's flags have no 0x80000000 and the old row's no 0x40000000 (every row but slot 0,
whose flags are 0xc0000000, so a change from or into the intro's slot 0 is the else branch: no clock reset, no stride
change); (3) type 4: when `1.0 <= +0xc0` (0x97d97c), `+0xc0 = 0` and `+0xc8` = the speed of the row now playing.
The threshold tests that read the clock are `check_entity_animation_elapsed_threshold` (0x007aaa30 = the same function,
refsrc line 791545): true when `th < +0xc0 <= th + stride` with the blend's bit (`+0xb0 & 4`) clear and no id change.

The port's `animateClock` is that step list (the blend starts when the slot differs from the started slot and neither is
0; the wrap sets the stride from `BARBA_SLOTS[slot].speed`); `crossed(th)` is the crossing test. The state handlers call
`animateClock()` first, like the exe. `setSlot` is the only writer of the slot; a mode 2 chain (the renderer's
`animationEnded`) is a slot change and so a blend too.

**Frame counts (`bm_boss7_de_rol_le_c.bml` from `data.gsl`, BML entry 6 + motion, `formats/njmotion.ts` frameCount;
Pass 13's 40 / 34 for motions 10 / 11 agree):** motion 0 15, 1 16, 2 20, 3 26, 4 21, 5 60, 6 60, 7 200, 8 150, 9 33,
10 40, 11 34, 12 80, 13 40, 14 80, 15 40, 16 50. The mode 1 loop wrap (`frameCount <= +0xc0`, subtract the count), the
mode 2 chain (`frameCount - 1 <= +0xc0`) and the mode 3 hold (the clock freezes at the end) are NOT in the brain: the
chain is the renderer's `animationEnded`, and every clock threshold these states read is reached before the first
wrap, chain or hold (checked below: beam_a chains at clock 19, the 10..14 window and the 10.0 sound come first; beam_c
at 20 with the 8.0 sound first; r_bite at 39 with the 25.0 landing first; rljump / lrjump at 79 with the arc's 64 first;
motion 10 (drop) at 39 after the 29 mark; ed_boss2 holds at 199 after the finale's 123 mark). ASSUMED: the exe's
`Enemy__GetAnimationMotions` is non-zero for each chain (no fallback subtract).

**Per state (verdict; the exe's reads of +0xc0 and what changed):**

| state (exe) | slot (speed) | clock reads (exe) | verdict and port change |
|---|---|---|---|
| idle 0 (0x004b9e54) | 1 (0.6) | none; Player__Animate only | the helper runs (keeps the started id); no threshold |
| drop 0x0d | 1 (0.6), 4 (0.3) | 13.5/10.5/16/22/29 (0x906cd8.. ), crossings none | unchanged numbers: the blend wrap at 22, the rise at tick 57; the 0.3 stride is now the row's (slot 4), not a constant |
| jump 0x11 / 0x12 (0x004b30fc) | 1 windup, 7 / 8 (0.28) | 6.0 (0x906e8c), 13.0 (0x906e98), 20.0 (0x906ea4), 25.0 (0x906ea8) by `>=`; 15.0 (0x3ec) and 8.5 (0x3ed) by crossing | CHANGED: the port's `timer += 1` and the `timer = 0` at the windup end are gone; the windup's id change blends, sub 1 waits for the wrap (`+0xb0 & 4`, PROVEN). Counted from the wrap tick: the take-off (sub 3) on the 23rd tick (clock 6.16), the landing on the 91st (clock 25.2), was 25 ticks |
| arc 0x04 / 0x0a (0x004b0ee0) | 5 / 6 (0.5) | the sub-state marks 0x906f9c, 0x906fa4, 0x906fa8, 0x906fb0, 0x906fb8, 0x906fbc (the port's 10 / 20 / 28 / 45 / 46 / 64 by `>=`, values not re-read here); the sub 3 step `-= 0.2`; the arc sounds 0x3ec / 0x3ed by crossing (10 / 41 / 25.0; not ported) | CHANGED: sub 0 waits for the blend's wrap (was one frame); the clock runs at 0.5 a tick (was 1) |
| volopt 0x0f / 0x10 (0x004b2cd0) | 3 (0.4, hold) | none (the sweep reads the rows and 0x1cc / 0x1cd) | no change to the logic; the helper runs (the exe's Player__Animate) |
| shot 0x19 / 0x1a (0x004b4684) | 14 (0.4) | 8.0 crossing (0x3ed) only | CHANGED: the sound is at tick 22 (the wrap at tick 2, then 0.4 a tick); was tick 9 |
| beam 0x17 (0x004b6d08) | 12 (0.4) | 10..14 window (0x906d3c / 0x906d38; `>=` and `<=`) for the attack, the 10.0 crossing (0x3ec) | CHANGED: the sound at tick 27 and the attack window at ticks 27..37 (was 10..14). The enter from the spawn's slot 0 does not blend (the clock stays at the spawn stride 0.7: the 10.0 sound at tick 15) |
| transitions 0x03..0x0e (0x004b1e98) | 1 (0.6) | none in the sub-states checked (approach, the x/z easings, the wait 0xc8); FUN_004b2904 (sub 4's settle) not decoded | no change to the timing; the helper runs. ASSUMED: 0x004b2904 reads no clock |
| followers 0x13 / 0x14 (0x004b3c2c) | 9 / 10 | none (the counter 0x734 and the arrival flags) | no change; the helper runs |
| swim 0x15 / 0x16 (0x004b41ac) | 9 / 10 by side (2.0, the bite loops; enter writes them), 1 (0.6) on the exit | none | no change; the helper runs |
| finale 0x1c (0x004b5d1c) | 16 (0.7, hold at 199) | 85.0 (the cut), 20.0 (0x20f) and 123.0 (the late effect) by crossing | CHANGED: the marks are crossings on the clock, not `timer === mark` on the +1 count: on the 29th, 122nd and 176th step after the wrap at 0.7 (were 20 / 85 / 123 ticks) |
| timed 0x1b (0x004b60c4) | none | the countdown (0x1be) only | no Player__Animate; unchanged |
| dead 0x1d (0x004b5c98) | none | none | no Player__Animate; unchanged |

**Proven:** the Player__Animate call list above (each line is a call in the handler's event 0, Ghidra refsrc or the
`decomp.sh` body of the unnamed handlers 0x004b6d08, 0x004b2cd0, 0x004b0ee0, 0x004b1e98); the threshold forms; the
blend rule; `check_entity_animation_elapsed_threshold` = 0x007aaa30 (its body: `th < +0xc0 <= +0xc8 + th`, and the
flags / id gate).

**ASSUMED (marked in the code):** the blend's `+0xb0 & 0x81` test is clear (no writer found in the Barba's code); the
clock's start at each enter is 0 (the generic enter; the exe writes no +0xc0 at the enters, so the carry of the last
state is what the exe would have, and it is erased by the first blend wrap in every state checked); the spawn's stride
0.7 (the intro row, slot 0; `Enemy__InitAnimation` of id 0 is not traced); the renderer's `animationEnded` is the mode 2
chain's frame (within one tick of the clock's `frameCount - 1`); the arc's sounds (not ported); the transitions' FUN_004b2904.

**Tests (`tests/barbaray.test.ts`):** the beam block (the idle first, then the sound at tick 27; the spawn's no-blend case at
tick 15); the shot block (the sound at tick 22, with the chain); the jump block (the landing at `1 + ceil(25 / 0.28)` ticks,
the 15.0 crossing tick, x and yaw on the last descent frame from the clock); the drop block unchanged. `node tests/barbaray.test.ts`
ALL PASS; `client` `tsc --noEmit` clean; `NEWSERV=... node tests/combat.test.ts` 5859 checks, 0 failures.

## Pass 15: the player attack (0x18, 0x004b6300) and its area hit, 2026-10-25

**Question (pass 4's open items 3 and 5):** what record is `*(root+0x628)`, and what is the area-hit dispatch `DAT_00a72eb4` vt+0x30 / +0x34? Then port 0x18 on the shared clock with the hit.

**Record (PROVEN).** The root ctor (0x004af634) stores `0x0077a6cc(15)` at root+0x628. `0x0077a6cc(i) = [0xa9b1d0] + 0x30*i`, the table that the loader 0x0077b462..0x0077b491 fills with the block pointers (`a9b1dc` physical 0x24 rows, `a9b1d8` attack 0x30 rows at +0xd80 (read by 0x0077a698), `a9b1d4` resist 0x20 rows at +0x1f80, `a9b1d0` movement 0x30 rows at +0x2b80). So the record is **MovementData[15]**, not an AttackData row. The 0x18 hit reads its dword 0 (`0x004b669a..0x004b66a9`: `[[root+0x628]]`) as the float power, which is `fparam1` (lab file: 250 normal, 720 hard, 1300 very hard, 2400 ultimate solo; the online file 300..2590). The movement row 15 is also the pool row of the same root (Pass 5 / `barbaPartPool`), so one row serves both. ASSUMED: the port's `movement(d, 15)` (the kind-major layout of `formats/battleparams.ts`) is the row the exe's block layout reaches at index 15; the pools already rely on it.

**Dispatch (PROVEN).** `DispatchSinowberillAttackEffect_0051fc9c(root, to, rec, hitlist)` (refsrc line 303366) makes `g_pDerolleObject` (an enemy instance, base vtable 0x00b009a0) carry the transform `to` and the attacker (+0xac = root). Then: `rec[2] > 100.0` (0x009216d4) -> vt+0x30 (0x00521cf8) with radius `rec[2]`; else vt+0x34 (0x00521cdc) -> vt+0x30 with radius 100.0. The 0x18 call has `rec[2]` = 120.0 (0x009abba8), so the 120 branch.

- `EnemyUpdateLogic_00521cf8(obj, rec+0xc, rec, hitlist, radius)`: flag bit 0 of rec+0x10 (= 1) -> `Entity_CheckAllCollisions_007b8618(obj, radius)`: each player (g_EntityArray up to g_PlayerEntityCount) with `dist^2 <= radius^2` on xz from `to`, not the attacker, not `obj+0x30 & 0x800` and not the 0x80000800 entity flags, then `CheckTwoHitboxCollision_007b5e40` (the box overlap, NOT ported) sets the box flag 0x4000000 and the player goes to `g_CollisionResultCache`.
- Then for each cached player (`+0x96 == 1`, not the attacker, `+0x30 & 0x4000000 == 0`): skip if in the hitlist (`root+0x720`, the once-per-attack list); else append and call vt+0x4c (0x005221c0, `DerolleProcessAttackHit`).
- `DerolleProcessAttackHit`: the first hitbox with 0x4000000 -> `entity_hit_by_tech(player, root, rec[0] (0.0 = group 0), rec[1] as float, &box.position1, -1, -1)`. Then (episode 2 and the result == DAT_009216f8 = 0.0) return; `player+0x32c == 2` return; else vt+0x48 (0x00522154, `EnemyAI_MoveTowardsTarget`): the player's +0x30c / +0x314 += the unit xz vector (player - `to`) * 20.0 (rec[3] = 0x009abbb0). The knockback rule for zero damage never fires here (power > 0).

**The timeline (PROVEN from the body; `attackFrame` in `barbaray.ts`).** Event 0 runs Player__Animate first.
- enter (event 4): gate open (0x630 bit 2 clear, bit 8 set), anchor 3, slot 0xf (beamwait, the enter writes +0xb8 = 0xf), 0x730 / 0x734 / the hitlist 0.
- sub 0: the 0x734 counter; the 20th frame ends it (`iVar8 < 0x14` keeps counting): hitlist cleared, +0xb8 = 0xd (beam_b, speed 0.3, blends from 15), the target point, sound 0x3f6.
- sub 1: waits for the clock `>= 13.0` (0x906d50, `>=`); the clock is set to 13.0, sound 0x3f7, sub 2. (The 12.0 mark, 0x906d4c, only runs the aura's pending flags.)
- sub 2: the clock is pinned at 13.0; the ground point (`0x780` from the aura position's ray cast, `0x0051fc9c` each frame) and the area hit each frame; the aura's state 2 ends sub 2 (`IsSinowberillAuraActive_004baf7c` = aura+0x1c == 2, PROVEN; the aura starts at state 1 in `InitializeSinowberillAuraEffect_004baec4`, PROVEN).
- sub 3: the animation hold (0xb0 bit 0x10) -> sub 4; sub 4 is the done state (the leader's event 9 steps the table).

Ticks (port): the windup 20; the blend wrap on the 21st, the clock from 0 at 0.3 a tick, 13.0 on about the 44th; then the aura hold and sub 3. The hit comes on the first sub 2 frame and never again for the same player.

**ASSUMED (marked in the code):**
- the aura hold, `BARBA_ATTACK.aura = 30` frames: the writer of aura state 2 (the aura object's update, not decoded) decides sub 2's length;
- the area's centre is the leader's target position (6xAA target, `targetGround`); FindAndProcessSinowberillTarget (0x00521324) and the aura's ray-cast ground point (0x004bae8c) are not decoded or ported; with no target the body is the centre;
- the hitbox overlap (0x007b5e40) is not ported: the sphere (radius 120 on xz) decides;
- the sub 3 hold (0xb0 & 0x10) is taken as set (the volopt's rule);
- the 0x208 / 0x209 attack objects (`InitializeSinowberillSubEntity_004ba894`) and the aura's particles are not spawned; the 0x72c counter and the event-2 packets (0x18 / 0x19 to the server) are not ported;
- the knockback unit: the port's `damage.hit(…, knockback)` is taken as the exe's +0x30c / +0x314 step of 20.0 (not re-traced in the renderer).

**Changes:** `barbaray.ts` (BARBA_ATTACK, BARBA_PHASE.attack, `enterAttack`, `attackFrame`, `targetGround`, `attackArea`, the `hit` event, the done hook); `render/combat.ts` (`barbaDrain` case `hit`: the local player only, `enemyTechHitsPlayer` with the row's power and knockback 20); `tests/barbaray.test.ts` (the 0x18 block: enter, the 20-frame windup, the fire at the clock, one hit inside 120 and not the far or dead player, the power and knockback, the range edge, the target point). `node tests/barbaray.test.ts` ALL PASS; `client` `tsc --noEmit` clean; `NEWSERV=... node tests/combat.test.ts` 5859 checks, 0 failures.

## Pass 16: the Pass 15 ASSUMED points, 2026-10-25

**Question:** resolve the Pass 15 ASSUMED points: (1) the aura hold, (2) the attack centre, (3) the hitbox overlap 0x007b5e40, (4) the sub 3 hold on 0xb0 & 0x10. Change the port only where proven.

**1. Aura hold (PROVEN, port changed: `BARBA_ATTACK.aura` 30 -> 14).** The writer of aura +0x1c == 2 is not the reader: `IsSinowberillAuraActive_004baf7c` (0x004baf7c, refsrc 240747) only reads it. The writer is the aura's own vtable update, slot +4 of the dual sub-entity vtable 0x00afb048 (the ctor `FUN_004babbc` = 0x004bac40 sets the vtable and `+0x4c = 0x42a00000` = 80.0), which is `FUN_004bacc0` (Ghidra; refsrc has no name for it). Each update in state 1: `+0x4c += 0x00907220` (30.0), recompute the bounds, emit 0x206 / 0x207, and when `+0x4c >= 0x00907218` (500.0) set `+0x1c = 2` and release the particle refs. 80 + 30 * 14 = 500, so the 14th update writes state 2. The aura is made at sub 0 end (0x004b6300 event 0, `InitializeSinowberillDualSubEntity_004BAC40`), and state 1 is written at sub 1 end (`InitializeSinowberillAuraEffect_004baec4`, clock 13.0). Sub 2's body reads the state each tick after the area hit. Either update order (aura before or after the leader in a tick) gives the leader 14 sub 2 bodies: the leader sees k updates at its k-th body in both. Timing: the aura is an object ticking with the leader (ASSUMED one update a tick, the 30 Hz clock).

**2. Attack centre (PARTLY PROVEN: the target is NOT the centre; port unchanged, stand-in kept).** Sub 2's body (0x004b6300 `iVar8 == 2`) calls `CalculateSinowberillSpawnPosition_004bafc4` (point = aura origin +0x20 plus the offset +0x38..0x40) into `to = &field_0x780`, then `cast_ray_at_map_collision_geometry(visual point, to, 0x16ef)`; a hit overwrites 0x780..0x788 with the ground point. `DispatchSinowberillAttackEffect_0051fc9c(this, to = 0x780, ...)` takes that point. So the area centre is 0x780, the aura's ground point; 0x774..0x77c (FindAndProcessSinowberillTarget's target position, sub 0 end) is only the aura's direction: `+0x2c` = target, then `normalize_xz(target - origin)` (`InitializeSinowberillAuraEffect_004baec4`). The offset is `dir.xz * scale` and `y = minY - origin.y` (`UpdateSinowberillVisualEffectBounds_004bac98`), so the centre moves from origin + dir * 80 to origin + dir * 500 over the hold (scale is the aura's `+0x4c`). The visual point (`CalculateSinowberillVisualEffectPosition_004bafec`) is at height 10.0 (0x00907208), so the ray is slanted from `origin + dir * scale * f` (f = (10 - oy) / (minY - oy)) down to `origin + dir * scale`. ASSUMED / not decoded: the origin (`CalculateSinowberillAttackPosition_004bae8c`: x = 10 * cast+0x90.x + cast+0x84.x, y and z = 5 * cast+0x90 + cast+0x84; the `currently_casting_tech_info` fields 0x84 / 0x90 are not named in the dump's struct), the map ray-cast result, and the case of no aura (0x7b0 == 0, 0x780 keeps its last value). The port's centre (target position, body when none) stays as an ASSUMED stand-in, documented in `targetGround` and `attackArea`.

**3. Hitbox overlap (PROVEN that the exe tests it; not ported).** `Entity_CheckAllCollisions_007b8618` (refsrc 801364): the sweep runs only when the attacker has a hitbox list (+0xa4 != 0). For each player in range (`dist^2 <= r^2` on xz), it calls `CheckTwoHitboxCollision_007b5e40` with the attacker's list (+0xa4, count +0xa8, position, y_rot) and the player's list (`pbVar1[3]` +0xa4 / +0xa8, the player's position and y_rot at +0x2c). A null player list (+0xa4 == 0) fails the test (the `||` chain goes to the skip label), so the player is not hit. Ghidra (`tools/ghidra/decomp.sh 0x007b5e40`) shows 0x007b5e40 lies in `FUN_007b5318` (no dump name): it loops over the attacker's records (stride 0x2c, flags +0x18) and the player's records; each pair must pass the flag gates (bits 0x1..0x80 with the exclusions 0x2000 / 0x4000 / 0x8000 / 0x10000 / 0x40000) and then a primitive test by shape (+0x14 == 1 is the oriented box, `FUN_00844540`; the others `FUN_0083d2fc` / `FUN_0083dbd4`). On a hit it returns the player's record pointer, and the sweep sets flag 0x4000000 on it. The attacker's list is `g_pDerolleObject +0xa4` (set by `DerolleInitializeItemDisplay_0051fcf4`; its record constants are not decoded). Not ported: the box data of the attacker (its records) is not decoded, so the sphere alone still decides in the port; the player's own hitboxes are not the gate here. ASSUMED: a player always has a list (so the sphere is the whole test in practice).

**4. Sub 3 hold (PROVEN, port changed: sub 3 waits for the play-once end).** `Player__Animate` (refsrc 791218) sets `animation_flags |= 0x30` (bits 0x10 and 0x20) when `animation_type == 3` and `elapsed >= frame_count - g_AnimationTimeOffset` (1.0 at 0x0097d97c, PROVEN; `enemyfsmep2c.ts` already has the same rule as ANIM_END_OFFSET). The `& 0xfffff7d5` at the top of Animate clears 0x800 / 0x20 / 0x08 / 0x02 but not 0x10, so the bit holds until the next animation starts. Slot 13 (beam_b) is row `bs(3, 0, 3, 0.3)`: a type 3 play-once of motion 3. The clock is pinned at 13.0 by sub 2 and climbs 0.3 a tick in sub 3, so the bit is set at elapsed 25.0 (26 frames - 1.0): 40 ticks. The frame count 26 is the njm count from the Pass 14 table; ASSUMED (the Pass 13 note): the exe's count is `dwUnk + (1.0 or 0.0)`, so the threshold is 25.0 or 26.0. The port: `case 3: if (timer >= BARBA_ATTACK.animEnd) sub = 4` (animEnd 25).

**Ticks (port, after Pass 16):** windup 20; blend wrap, clock from 0 at 0.3, 13.0 about the 44th; sub 2 for 14 bodies (one hit on the first); sub 3 for 40 ticks; then sub 4.

**Still ASSUMED:** the centre's origin and the map ray-cast (point 2); the hitbox records (point 3); the frame count off-by-one (point 4); the attack objects 0x208 / 0x209, the aura's particles, the 0x72c counter and the 0x18 / 0x19 packets (unchanged from Pass 15); the knockback unit (unchanged).
