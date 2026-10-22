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

## Minion and spawner (pass 1, unchanged)

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
