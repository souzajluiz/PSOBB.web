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

## Open (blocks the port)

1. The HP sign convention (see above) and the writer that turns 6x0A
   total_damage into the +0x2bc drop. Blocker.
2. Speeds and path per phase; the table's arg dword (unread so far, ASSUMED
   unused by the body; check 0x004b4e6c and FUN_00520bf4).
3. Receive wrapper for 6xA9 / 6xAA on a receiving client.
4. 6x76 / EXP / drops at death (0x1c / 0x1d).
5. Motion ids: bm_boss* in data.gsl, not inspected in this pass. Lead: the port's
   client/src/combat/enemymotions.ts and the GSL/NJM parsers under
   client/src/formats.
6. Particle / SE ids beyond the ones listed here.
