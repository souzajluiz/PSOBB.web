# Barba Ray: exe map (partial)

First mapping pass, 2026-10-22. No brain is ported yet: the body's damage path and
movement are not found, so a port now would be guesswork. Addresses are PsoBB.exe
VAs; "dump" is the named Ghidra dump in original-psobb-client-source.

## Established

- Enemy type 0xCB, factory 0x004af5b8 (dump name CreateSinowberillEntity_004af5b8;
  names in the dump are often wrong) -> barbaray_constructor. The factory table row
  for 0xCB points at 0x004af5b8, the row for 0xCC at 0x004cb404.
- Body vtable 0x00afab60: slot 0 0x004aee60 (destroy), slot 1 0x004b8584 (per-frame
  update), slot 2 0x004b9224, slot 3 0x004b9468, +0x100 0x004b947c. Body HP 20000.
- Body update 0x004b8584 (clean Ghidra decompile) is a mode machine at +0x278:
  mode 0 normal, 2 cooldown, 1 table playback. Normal path 0x004b8dec -> cooldown
  gate 0x004b8e1c -> execute 0x004b8e3c. Execute states: 0x13 / 0x14 send each table
  action; 0x15 / 0x16 -> state 0x1c and 6xA9 {0x1c, idx}; 0x1c / 0x1d no-op; any
  other -> 0x1b and 6xA9 {0x1b, idx}.
- Action tables: pointer array 0x009abc68 indexed by g_CurrentFloor (floors 0..3
  populated, 8-byte records). Codes 0x1e..0x27 are conditional macros; 0x45 loops.
- Attack pattern 0x004b60c4; attack parameters 0x004b416c (a +-100.0 offset, not
  damage).
- Minion (Pig Ray) ctor 0x004ad95c, update 0x004addc0, states 0..5 at 0x004ae918,
  0x004ae748, 0x004ae398, 0x004ae10c, 0x004ae024, 0x004adfac. Minion vtable
  0x00afa7b8 (a different entity from the body). Spawner 0x004b4e6c: 36 slots,
  spawn-count table 0x00905f60, destination tables 0x009abbc8 / 0x009abbb8.
- Network: 6xA9 {phase u16, attack_seq_index u16} from 0x004b8e3c; 6xAA {phase, idx,
  target u32} from 0x004b3c2c (phases 0x13 / 0x14). Subcommand 0x2a9 via 0x004b5150.
  newserv's handler-table notes for 0x004b8558 / 0x004b8594 are wrong (not entries).
- Hit feedback: 0x004b958c (+0x630 |= 0x88, SE 0x3f9), 0x004b95b4 (+0x630 |= 0x800),
  0x004b966c (+0x704 -= round(p * 0.5), SE 0x3fa).
- Minion death: state 5 0x004ae024 (particle 0x20b, SE 0x3f5); death particles
  0x20d / 0x20e (0x004adfe8).

## Decisive fact

The body has no vtable +0x60 hit call and no laser or missile code in the
0x004b8584..0x004b9f10 range, so its damage path is elsewhere and its HP drain is
not found yet.

## Open (blocks the port)

- Where the body's HP is decremented and how player hits reach it. Next step: the
  writers of +0x704 / +0x630 and the receive path that handles 6xAA on the body.
- The meaning of the action-table codes; the motion ids.
- The receive dispatcher around 0x004b0ba9 / 0x004b0276 (not in the dump).
- The body's movement; its death (states 0x1b / 0x1c) and the 0x45 loop.
- The body's particle / SE ids (only the minion and hit ids above are confirmed).
