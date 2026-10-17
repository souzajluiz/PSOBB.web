// Player motions: plymotiondata.rlc (data.gsl) and the tables PsoBB.exe uses
// to pick motions from it.
//
// plymotiondata.rlc is a RelChunk archive (formats/rlc.ts) of 572 PRC entries.
// Each entry is a REL whose root points to { u32 0, NJS_MOTION* }; every
// motion has 64 nodes (the pl?bdy00.nj skeleton, depth-first), position +
// angle elements, linear interpolation and short (16-bit BAMS) angle keys.
//
// Reverse-engineered from the Ephinea PsoBB.exe (Ghidra; addresses are VAs):
// - FUN_006a796c loads PlyMotionData.rlc; FUN_006a6f80 decompresses the
//   entries a motion set needs into 0x4000-byte slots (FUN_006a7a40 reads the
//   archive table, at most 600 entries).
// - Each player owns a motion set object at player+0x38c, created by
//   FUN_00696454. In the town/lobby (DAT_00a943cc == 0) it is the class with
//   vtable 0x00b3a040; in the field the class with vtable 0x00b39ec0 (per
//   weapon type tables at 0x009cbeec / 0x009cbf04, 6 x 19 x 72 slots).
// - FUN_006875a0 sets the motion type from the class (switch at 0x0093c584):
//   see MOTION_TYPE. The town class folds the 6 types into 2 sets
//   (FUN_006a7508: types 1, 2, 4, 5 -> set 1, others -> set 0) and loads both
//   at once (FUN_006a77bc).
// - Town tables: 0x009cc08c -> 2 x 19 (weapon) -> 56 records, 0x009cc094 ->
//   2 x 19 -> 56 archive indices; every weapon column is the same table.
//   Record (0x10): u16 mode, u16 next slot, u32 slot, f32 speed, u32 flags.
// - Town vtable getters: +0x54 idle = slot 0 (3 for FOmarl, type 2),
//   +0x50 walk = 1 (4), +0x70 run = 2 (5). Idle is chosen by FUN_0069d1bc,
//   walk by FUN_006a20a4 (walk state FUN_006a1ef0), run by the run state
//   FUN_006a1898.
// - Playback (FUN_007aa4c8 start, FUN_007aa094 tick, FUN_007a9a6c change):
//   frame += step each game tick, step = record speed, except in the walk and
//   run states which use record speed * 1.0 (DAT_00a94300) and * 1.5
//   (DAT_00a94324) (FUN_006978a0; x0.5 / x0.75 in some slowed states).
//   Modes: 1 loop at frame_count, 2 play then chain to `next`, 3 play once
//   and hold the last frame. Changing motion cross-fades from the current
//   pose over 1 / 0.2 = 5 ticks (DAT_0097d970) and restarts at frame 0,
//   unless the new record has flag 0x80000000 or the old one 0x40000000.

import { RelFile } from './rel.ts';
import { RlcArchive } from './rlc.ts';
import { parseNjMotion, type NjMotion } from './njmotion.ts';

export const PLAYER_MOTION_FILE = 'plymotiondata.rlc';
export const PLAYER_MOTION_NODES = 64;

// Motion type by character class (FUN_006875a0): 0 male, 1 female, 2 FOmarl,
// 3 FOmar, 4 HUcaseal, 5 RAmarl.
export const MOTION_TYPE = [0, 1, 0, 0, 0, 1, 2, 0, 1, 4, 3, 5] as const;

export interface MotionRecord {
  index: number; // plymotiondata.rlc entry
  mode: number; // 1 loop, 2 chain to `next`, 3 once
  next: number; // slot (mode 2), -1 otherwise
  speed: number; // frames per game tick
  flags: number;
}

type Row = readonly [number, number, number, number, number];

// [set][slot]: rlc index, mode, next, speed, flags (0x009cc08c / 0x009cc094).
const TOWN_TABLE: readonly (readonly Row[])[] = [
  [
    [201, 1, -1, 0.9, 0x1], [200, 1, -1, 1.4, 0x20000002], [207, 1, -1, 0.8, 0x20000002], [201, 1, -1, 1, 0x20000001],
    [200, 1, -1, 1, 0x20000002], [207, 1, -1, 0.8, 0x20000002], [202, 3, -1, 1.4, 0x20000040], [204, 3, -1, 3.7, 0x20000040],
    [109, 3, -1, 1.3, 0x20000400], [199, 3, -1, 3, 0x20000010], [196, 3, -1, 1.2, 0x20000004], [153, 3, -1, 1.1, 0x20000004],
    [91, 3, -1, 1.3, 0x20000004], [155, 3, -1, 1.4, 0x20000004], [178, 3, -1, 1.5, 0x20000004], [173, 3, -1, 1.5, 0x20000004],
    [194, 3, -1, 1.4, 0x20000008], [126, 3, -1, 1.4, 0x20000008], [205, 3, -1, 1, 0x80], [174, 3, -1, 0.8, 0x1],
    [187, 3, -1, 1, 0x20000008], [137, 3, -1, 1, 0x20000008], [206, 3, -1, 1, 0x20000008], [164, 3, -1, 1, 0x20000008],
    [87, 3, -1, 1, 0x20000008], [208, 3, -1, 1, 0x20000001], [209, 3, -1, 1, 0x20000001], [210, 3, -1, 1, 0x20000001],
    [211, 3, -1, 1, 0x20000001], [212, 3, -1, 1, 0x20000001], [213, 3, -1, 1, 0x20000001], [214, 3, -1, 1, 0x20000001],
    [215, 3, -1, 1, 0x20000001], [216, 3, -1, 1, 0x20000001], [217, 3, -1, 1, 0x20000001], [218, 3, -1, 1, 0x20000001],
    [219, 3, -1, 1, 0x20000001], [220, 3, -1, 1, 0x20000001], [221, 3, -1, 1, 0x20000001], [222, 3, -1, 1, 0x20000001],
    [223, 3, -1, 1, 0x20000001], [224, 3, -1, 1, 0x20000001], [225, 3, -1, 1, 0x20000001], [226, 3, -1, 1, 0x20000001],
    [227, 3, -1, 1, 0x20000001], [228, 3, -1, 1, 0x20000001], [229, 3, -1, 1, 0x20000001], [230, 3, -1, 1, 0x20000001],
    [231, 2, 54, 1, 0x30000001], [232, 2, 55, 1, 0x30000001], [233, 3, -1, 1, 0x20000001], [234, 3, -1, 1, 0x20000001],
    [235, 3, -1, 1, 0x20000001], [236, 3, -1, 1, 0x20000001], [237, 1, -1, 0.7, 0x30000001], [238, 1, -1, 0.7, 0x30000001],
  ],
  [
    [335, 1, -1, 1, 0x1], [412, 1, -1, 1, 0x20000002], [416, 1, -1, 0.8, 0x20000002], [487, 1, -1, 1, 0x20000001],
    [506, 1, -1, 1, 0x20000002], [508, 1, -1, 0.8, 0x20000002], [359, 3, -1, 1.5, 0x20000040], [413, 3, -1, 3.7, 0x20000040],
    [340, 3, -1, 1.3, 0x20000400], [411, 3, -1, 3, 0x20000010], [408, 3, -1, 1.4, 0x20000004], [369, 3, -1, 1.1, 0x20000004],
    [321, 3, -1, 1.3, 0x20000004], [371, 3, -1, 1.4, 0x20000004], [389, 3, -1, 1.5, 0x20000004], [384, 3, -1, 1.7, 0x20000004],
    [406, 3, -1, 1.4, 0x20000008], [357, 3, -1, 1.4, 0x20000008], [414, 3, -1, 1, 0x80], [385, 3, -1, 0.8, 0x1],
    [399, 3, -1, 1, 0x20000008], [363, 3, -1, 1, 0x20000008], [415, 3, -1, 1, 0x20000008], [341, 3, -1, 1, 0x20000008],
    [317, 3, -1, 1, 0x20000008], [417, 3, -1, 1, 0x20000001], [418, 3, -1, 1, 0x20000001], [419, 3, -1, 1, 0x20000001],
    [420, 3, -1, 1, 0x20000001], [421, 3, -1, 1, 0x20000001], [422, 3, -1, 1, 0x20000001], [423, 3, -1, 1, 0x20000001],
    [424, 3, -1, 1, 0x20000001], [425, 3, -1, 1, 0x20000001], [426, 3, -1, 1, 0x20000001], [427, 3, -1, 1, 0x20000001],
    [428, 3, -1, 1, 0x20000001], [429, 3, -1, 1, 0x20000001], [430, 3, -1, 1, 0x20000001], [431, 3, -1, 1, 0x20000001],
    [432, 3, -1, 1, 0x20000001], [433, 3, -1, 1, 0x20000001], [434, 3, -1, 1, 0x20000001], [435, 3, -1, 1, 0x20000001],
    [436, 3, -1, 1, 0x20000001], [437, 3, -1, 1, 0x20000001], [438, 3, -1, 1, 0x20000001], [439, 3, -1, 1, 0x20000001],
    [440, 2, 54, 1, 0x30000001], [441, 2, 55, 1, 0x30000001], [233, 3, -1, 1, 0x20000001], [234, 3, -1, 1, 0x20000001],
    [235, 3, -1, 1, 0x20000001], [236, 3, -1, 1, 0x20000001], [442, 1, -1, 0.7, 0x30000001], [443, 1, -1, 0.7, 0x30000001],
  ],
];

export const TOWN_SLOTS = 56;

export function townMotionSet(charClass: number): number {
  const t = MOTION_TYPE[charClass] ?? 0;
  return t === 0 || t === 3 ? 0 : 1;
}

export function townMotion(charClass: number, slot: number): MotionRecord {
  const row = TOWN_TABLE[townMotionSet(charClass)][slot];
  if (!row) throw new Error(`no town motion slot ${slot}`);
  return { index: row[0], mode: row[1], next: row[2], speed: row[3], flags: row[4] };
}

export type Locomotion = 'idle' | 'walk' | 'run';

// Frame step factor of the idle / walk / run states (DAT_00a94300, DAT_00a94324).
export const LOCOMOTION_FACTOR: Record<Locomotion, number> = { idle: 1, walk: 1, run: 1.5 };

// Town idle / walk / run slots (vtable 0x00b3a040 +0x54, +0x50, +0x70).
export function locomotionSlot(charClass: number, kind: Locomotion): number {
  const base = MOTION_TYPE[charClass] === 2 ? 3 : 0;
  return base + (kind === 'idle' ? 0 : kind === 'walk' ? 1 : 2);
}

export class PlayerMotions {
  readonly archive: RlcArchive;
  private cache = new Map<number, NjMotion>();

  constructor(data: Uint8Array) {
    this.archive = new RlcArchive(data);
  }

  get count(): number {
    return this.archive.count;
  }

  get(index: number): NjMotion {
    let m = this.cache.get(index);
    if (!m) {
      const rel = new RelFile(this.archive.get(index));
      const action = rel.u32(rel.root);
      m = parseNjMotion(rel, rel.u32(action + 4), PLAYER_MOTION_NODES, { shortAngles: true });
      this.cache.set(index, m);
    }
    return m;
  }
}
