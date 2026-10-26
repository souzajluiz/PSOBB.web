// The Gol Dragon, the Episode 2 boss (area 0x21, floor 15; PsoBB.exe, Ephinea
// 1.25.13, addresses are VAs). One EnemyBrain drives the body, its fireballs and
// its area hits. render/combat.ts places the body and applies the hits.
//
// Sources: docs/bosses/goldragon-map.md (the map), the Ghidra decompile of the
// states (scratchpad reads of 0x004c0408..0x004c1f9c, 0x004c42a8, 0x004cb480,
// 0x004cbf68, 0x004c311c, 0x004c3074, 0x004cbe80/0x004cbea0, 0x004cc390,
// 0x004cc7f4, 0x004cdb10) and tools/exedata.py for the tables. Tags in the
// comments: `exe` = read in the decompile or the table, `map` = the map's
// reading (not re-read), `ASSUMED` = not proven, the value or the meaning is a
// guess. The derived extras (vtable 0x00afbc20, flag 0x40, ctor 0x004cede4, the
// 5 extra entities) and the 4 child objects at +0x6e4 are NOT ported (OPEN): the
// sequence C and the flag 0x40 are never set here, and the state 0x17 (which
// drives the children) holds without a transition.
//
// The brain: the leader decides (roar, death, the table walk of phase 9) and
// sends the state as a 6xA8 (encodeGolA8); every client applies it (applyRemote)
// through the same setState / phase path. Followers that hear nothing for a long
// time take the leader's step themselves so the fight cannot hang.

import { BAMS_TO_RAD, type AiFrame, type AiTarget } from './enemyai.ts';
import type { EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase } from './enemyfsm.ts';
import { enemyTargetStateSets } from './enemystate.ts';
import { DragonFireball, DragonTrapezoid, DRAGON_FIRE_IDS, type DragonEmitter } from './dragon.ts';
import { EnemyShot, PLAYER_RADIUS, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { chopToInt } from './chop.ts';

const BAMS = BAMS_TO_RAD;

// --- motion slots -------------------------------------------------------------

// The motion table 0x009abf60 (28 rows of 0x10; exe, `tools/exedata.py motions`).
// `motion` is the entry of bm_boss8_dragon.bml after its 3 models (verified in the
// archive: 0 dead .. 27 wing, see the frame counts in the map). mode 1 loops, 2 plays
// once and goes on to `next`, 3 plays once and holds.
export interface GolSlot {
  readonly motion: number;
  readonly mode: 1 | 2 | 3;
  readonly next: number;
  readonly speed: number;
}
const slot = (motion: number, mode: 1 | 2 | 3, next: number, speed: number): GolSlot => ({ motion, mode, next, speed });
export const GOL_SLOTS: readonly GolSlot[] = [
  slot(11, 1, 0, 0.5), // 0 stand (exe)
  slot(13, 1, 0, 0.5), // 1 walk (exe)
  slot(10, 3, 0, 0.7), // 2 nobi (exe)
  slot(18, 3, 0, 0.9), // 3 fire (exe)
  slot(3, 3, 0, 0.5), // 4 frin (exe)
  slot(4, 1, 0, 0.4), // 5 frloop (exe)
  slot(5, 3, 0, 0.5), // 6 frout (exe)
  slot(12, 3, 0, 0.5), // 7 tatk (exe)
  slot(8, 2, 9, 0.5), // 8 nkdown (exe)
  slot(2, 1, 0, 0.3), // 9 down (exe)
  slot(9, 3, 0, 0.3), // 10 nkup (exe)
  slot(17, 3, 0, 0.6), // 11 dams (exe)
  slot(16, 3, 0, 0.5), // 12 daml (exe)
  slot(15, 3, 0, 0.5), // 13 wngopn (exe)
  slot(14, 3, 0, 0.5), // 14 wngclose (exe)
  slot(7, 3, 0, 1), // 15 lift (exe)
  slot(19, 1, 0, 1), // 16 fly (exe)
  slot(6, 2, 14, 1), // 17 land (exe)
  slot(20, 2, 16, 1.1), // 18 flyshot (exe)
  // 19 dead: the table holds speed 0; ASSUMED 0.5 (the Dragon's init writes 0.5 here, the Gol's init is not read).
  slot(0, 3, 0, 0.5), // 19 dead (exe motion, ASSUMED speed)
  slot(25, 1, 0, 1), // 20 wing (exe)
  slot(24, 1, 0, 0.5), // 21 wgwalk (exe)
  slot(23, 2, 23, 1), // 22 tobidasi/tukomi (exe: mode 2, next 23)
  slot(21, 1, 0, 1), // 23 kiri (exe)
  slot(22, 2, 16, 0.5), // 24 wgwalk-to-fly (exe, flags 0x80000000)
  slot(23, 3, 0, 1), // 25 wing-hold (exe)
  slot(1, 3, 0, 0.5), // 26 bossopgc, the entrance (exe, flags 0x80000000)
  slot(17, 2, 8, 0.6), // 27 dams then nkdown (exe)
];

// --- states -------------------------------------------------------------------

export const GOL_STATE = {
  wait: 0x00,
  walk: 0x02,
  turn: 0x03,
  tail: 0x04,
  charge: 0x05,
  lunge: 0x06,
  volley: 0x07,
  breathA: 0x08,
  collapse: 0x09,
  breathB: 0x0a,
  landRoar: 0x0b,
  landDie: 0x0c,
  roar: 0x0d,
  hover: 0x0e,
  dive: 0x0f,
  burrowFirst: 0x10,
  burrowNext: 0x11,
  burrowOut: 0x12,
  emerge: 0x13,
  death: 0x15,
  corpse: 0x16,
  children: 0x17,
  attack2b: 0x2b,
  entrance: 0x1e,
  dash: 0x26,
  flank: 0x27,
} as const;

// One gate of a state: the state holds until each gate passes in order, then the
// leader picks (phase 9). 'now' passes at once, 'frames' after n ticks, 'motion'
// when the body's motion ends (a loop passes after one loop, see tick), 'dash'
// when the lunge's profile is done, 'never' holds the state (no transition).
// 'near' passes when the body is within r of the arena centre (the phase 9 pick of 0x10 / 0x11,
// exe 0x004c42a8 case 9: FUN_007828e4 < 50.0).
// 'extras' passes while the 5 extra slots (body + 1 .. 5) are free (the phase 9 of 0x2b: FUN_004ce970 != 0).
export type GolGate =
  | { kind: 'now' }
  | { kind: 'frames'; n: number }
  | { kind: 'motion' }
  | { kind: 'dash' }
  | { kind: 'never' }
  | { kind: 'near'; r: number }
  | { kind: 'children' }
  | { kind: 'extras' };

export interface GolStateDef {
  readonly name: string;
  // The motion slot the state writes on entry (null: inherited; the exe's +0x2e write is absent).
  readonly slot: number | null;
  readonly gates: readonly GolGate[];
  // The state the leader picks after the gates: 'seq' (the table walk), a fixed sid,
  // or 'none' (the state holds, see 'never').
  readonly next: 'seq' | number | 'none';
  // +0xf2 bits: `set` / `clear` on entry (the map and the decompile of the state).
  readonly f2set?: number;
  readonly f2clear?: number;
  // Where the entry comes from: exe (decompiled or table in this pass), map, ASSUMED.
  readonly src: 'exe' | 'map' | 'ASSUMED';
}

const D = (name: string, slotIndex: number | null, gates: GolGate[], next: GolStateDef['next'], src: GolStateDef['src'], f2set?: number, f2clear?: number): GolStateDef => ({
  name,
  slot: slotIndex,
  gates,
  next,
  src,
  ...(f2set !== undefined ? { f2set } : {}),
  ...(f2clear !== undefined ? { f2clear } : {}),
});

// The states the port runs. The ones not listed (0x01 is pad-only: no phase 9
// handler; the rest, see the map) use the ASSUMED fallback of stateDef().
export const GOL_STATES: Readonly<Record<number, GolStateDef>> = {
  0x00: D('wait', null, [{ kind: 'now' }], 'seq', 'exe'), // 0x004cd85c: phase 9 picks at once
  0x02: D('walk', 1, [{ kind: 'frames', n: 300 }], 'seq', 'exe', 0, 0x36), // 0x004c06f8: count > 299 (the exe's other gate is ASSUMED away)
  0x03: D('turn', 1, [{ kind: 'motion' }, { kind: 'frames', n: 120 }, { kind: 'frames', n: 30 }], 'seq', 'map'), // 0x004c1070 sub 0..3 (timers from the exe)
  0x04: D('tail', 7, [{ kind: 'motion' }], 'seq', 'exe', 0x02, 0x34), // 0x004c1730: phase 9 gated by +0x2c & 0x10
  0x05: D('charge', 15, [{ kind: 'frames', n: 40 }], 'seq', 'exe', 0x30, 0x36), // 0x004ca610: +0x218 > 39
  0x06: D('lunge', 16, [{ kind: 'dash' }], 'seq', 'exe', 0, 0x36), // 0x004c197c: phase 9 at +0x217 == 2 (the profile)
  0x07: D('volley', 16, [{ kind: 'frames', n: 1 }, { kind: 'frames', n: 11 }], 'seq', 'exe', 0x30, 0x36), // 0x004c1f9c: sub 2 volley, sub 3 counter 11
  // The breath family (0x004cab30): sub 0 counts to 50 (the breath: the flame object, see GolBreath), then sub 1
  // until the counter passes 449 (the 400 frames left).
  0x0a: D('breath', 17, [{ kind: 'frames', n: 50 }, { kind: 'frames', n: 400 }], 9, 'ASSUMED'), // 0x0a -> send 9
  0x0b: D('land roar', 17, [{ kind: 'frames', n: 50 }, { kind: 'frames', n: 400 }], 0x0d, 'ASSUMED'), // 0x0b -> send 0xd (map)
  0x0c: D('land die', 17, [{ kind: 'frames', n: 50 }, { kind: 'frames', n: 400 }], 0x15, 'ASSUMED'), // 0x0c -> send 0x15 (map)
  0x08: D('breath first', 17, [{ kind: 'frames', n: 50 }, { kind: 'frames', n: 400 }], 'seq', 'exe'), // sub 0 breath at 50.0 (exe 0x004cab30)
  // The walk-in burrow (0x004c42a8, sids 0x10 / 0x11): sub 0 counts 60 and aims at the centre (+0x60 = atan2 + 0x8000),
  // sub 1 walks along the heading, the pick waits for the body within 50.0 of the centre.
  0x10: D('burrow first', null, [{ kind: 'frames', n: 60 }, { kind: 'near', r: 50 }], 'seq', 'exe', 0x30, 0x07),
  0x11: D('burrow next', null, [{ kind: 'frames', n: 60 }, { kind: 'near', r: 50 }], 'seq', 'exe', 0x30, 0x07),
  0x0d: D('roar', 2, [{ kind: 'motion' }], 'seq', 'exe', 0x30, 0x06), // 0x004c36e4 (map flags)
  0x0e: D('hover roar', 16, [{ kind: 'frames', n: 60 }], 'seq', 'exe', 0x30, 0x06), // 0x004c38dc: +0x217 > 59
  0x15: D('death', 19, [{ kind: 'motion' }, { kind: 'frames', n: 50 }], 0x17, 'exe', 0x36), // 0x004c5408: sub 1 counter 49, then send 0x17 (the kill runs on leave)
  0x16: D('corpse', null, [{ kind: 'frames', n: 6 }], 0x17, 'exe', 0xb6), // 0x004c5ba4: +0x217 > 5 -> send 0x17
  // 0x004c5dd4: enter motion 0x13 (slot 19), the 4 children's rates 0.005; no pick. The exit is the children's
  // timers (frameState): the first child that expires sets the body's +8 bit 0 (removed, see GolChild).
  0x17: D('children', 19, [{ kind: 'children' }], 'none', 'exe', 0x136),
  // 0x004cb19c case 4 (enter: f2 = f2 & ~7 | 0x30), case 5 (leave: the extras, see extraRing), phase 9 gated by
  // the free extra slots (FUN_004ce970). Sequence B holds it at cursor 0x35.
  0x2b: D('attack 2/0xb', null, [{ kind: 'extras' }], 'seq', 'exe', 0x30, 0x07),
  0x1e: D('entrance', 26, [{ kind: 'motion' }, { kind: 'frames', n: 1 }], 0, 'map'), // 0x004c5eb0: slot 26 = bossopgc; sub 1 sends 0 (the map's death-cinematic name is wrong)
  0x26: D('dash', 2, [{ kind: 'frames', n: 60 }], 'seq', 'ASSUMED'), // 0x004c99dc (map): profile ends at +0x878 >= 680 (ASSUMED 60 frames)
};

// A state the port does not model in detail: it plays its map slot (or stands) and
// passes after a short ASSUMED time. This keeps the sequence moving through the
// states of the table that the port does not reproduce.
function stateDef(sid: number): GolStateDef {
  const known = GOL_STATES[sid];
  if (known) return known;
  return D(`state ${sid}`, 0, [{ kind: 'frames', n: 120 }], 'seq', 'ASSUMED');
}

// The sequences (exe): A at cursor 0..0x31 (table 0x009088c0), B at 0x32.. (0x00908160),
// C (0x009080e0) only with the derived copies (flag 0x40, see golNext's derived flag).
export const GOL_SEQ_A: readonly number[] = [3, 39, 40, 41, 42, 3, 5, 6, 35, 8, 0x21];
export const GOL_SEQ_B: readonly number[] = [5, 6, 15, 43, 19, 8, 39, 40, 3, 5, 6, 35, 8, 3, 2, 41, 42, 39, 40, 3, 5, 6, 35, 8, 39, 40, 3, 2, 0x22];
export const GOL_SEQ_C: readonly number[] = [19, 8, 39, 40, 3, 39, 40, 3, 2, 3, 39, 40, 5, 6, 35, 8, 3, 5, 6, 35, 8, 2, 3, 5, 6, 15, 22, 0x21];
export const GOL_CURSOR_B = 0x32;

// The table walk of every phase 9 that picks (exe: 0x004c3074's callers, e.g. the
// phase 9 of 0x004c0408..). A sentinel 0x21 restarts the same table at 0 (cursor 0);
// 0x22 jumps to the second sequence (cursor 0x32). The read after a sentinel uses
// element 0 of the table in use (as the exe does), the stored cursor is the base + 1.
export function golNext(cursor: number, derived = false): { state: number; cursor: number } {
  let base = cursor;
  let table: readonly number[];
  if (derived) table = GOL_SEQ_C;
  else table = cursor < GOL_CURSOR_B ? GOL_SEQ_A : GOL_SEQ_B;
  let i = cursor < GOL_CURSOR_B || derived ? cursor : cursor - GOL_CURSOR_B;
  for (let n = 0; n < 4; n++) {
    const v = table[i] ?? table[0];
    if (v === 0x21) {
      base = 0;
      i = 0;
      continue;
    }
    if (v === 0x22) {
      base = GOL_CURSOR_B;
      i = 0;
      continue;
    }
    return { state: v, cursor: base + 1 };
  }
  return { state: table[0], cursor: base + 1 };
}

// --- network: 6xA8 (exe: dispatch row 164 of 0x00a0fba0, handler 0x004cbe80) ----

// The 24-byte packet (the sender's FUN_008003e0 with the header word 0x06A8):
// [0] 0xA8, [1] 0x06, [2..3] entity id (+0x1c), [4..5] state, [6..7] cursor (+0x67c),
// [8..9] target client (+0x394, 0xffff none), [0xc] x (+0x690), [0x10] z (+0x694),
// [0x14] attack variant (ASSUMED: ROUND(rand / 32768 * 3), the exe's constants at
// 0x00908780 / 0x00908784, the byte's use is not read).
export interface GolA8 {
  entity: number;
  state: number;
  cursor: number;
  target: number | null;
  x: number;
  z: number;
  variant: number;
}
export const GOL_A8_SIZE = 24;
export function encodeGolA8(m: GolA8): Uint8Array {
  const b = new Uint8Array(GOL_A8_SIZE);
  const dv = new DataView(b.buffer);
  b[0] = 0xa8;
  b[1] = 6;
  dv.setUint16(2, m.entity & 0xffff, true);
  dv.setUint16(4, m.state & 0xffff, true);
  dv.setInt16(6, m.cursor, true);
  dv.setUint16(8, m.target === null ? 0xffff : m.target & 0xffff, true);
  dv.setFloat32(0xc, m.x, true);
  dv.setFloat32(0x10, m.z, true);
  b[0x14] = m.variant & 0xff;
  return b;
}
export function decodeGolA8(body: Uint8Array): GolA8 | null {
  if (body.length < GOL_A8_SIZE || body[0] !== 0xa8) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const t = dv.getUint16(8, true);
  return {
    entity: dv.getUint16(2, true),
    state: dv.getUint16(4, true),
    cursor: dv.getInt16(6, true),
    target: t === 0xffff ? null : t,
    x: dv.getFloat32(0xc, true),
    z: dv.getFloat32(0x10, true),
    variant: body[0x14],
  };
}

// --- hit boxes (exe) ----------------------------------------------------------

// The body's seven boxes: the ctor 0x004cb480 loads 7 boxes from table 0x009ac120
// (stride 0x2c, +0xc = the radius). The static init 0x004cd532..0x004cd564 writes
// the radii 10, 10, 10, 15, 15, 10, 10 (exe). Their flags are not read (ASSUMED as
// the Dragon's 0x8003); the boxes sit at the body's origin (nothing moves them in
// the states read so far, ASSUMED like the Dragon).
export const GOL_BODY_BOXES = { radii: [10, 10, 10, 15, 15, 10, 10], flags: 0x8003, reach: 15 } as const;

// Constants read from the exe (tools/exedata.py read).
export const GOL = {
  clampDivisor: 100, // 0x0090842c = 100.0 (the +0x682 formula's divisor)
  clampShareAssumed: 90, // ASSUMED: DAT_00a48508 + 8 (runtime) is read as 90 (the 90 % roar)
  randDivisor: 32768, // 0x00908780
  randScale: 3, // 0x00908784
  stateMax: 2400, // ASSUMED: a leader leaves a state that has lasted this long (no exit in some gates)
  followerWait: 900, // ASSUMED: a follower that heard nothing this long takes the leader's step
  fireballSpeed: 25, // ASSUMED: the Dragon's fireball, the Gol's table is not read
  fireballRadius: 30, // ASSUMED (the Dragon's)
  fireballPower: 130, // ASSUMED: the Dragon's MovementData fallback (fparam2)
  dashCap: 12, // 0x009086bc = 12.0 (exe, the dash's step cap, map)
  burstRadius: 60, // ASSUMED
} as const;

// --- helpers ------------------------------------------------------------------

const sinB = (a: number): number => Math.sin(a * BAMS);
const cosB = (a: number): number => Math.cos(a * BAMS);
const bamsOf = (x: number, z: number): number => Math.trunc((Math.atan2(x, z) * 65536) / (Math.PI * 2));

// The exe's ROUND(rand / 32768 * 3) for the attack variant byte.
function variantOf(rng: () => number): number {
  return Math.round((Math.floor(rng() * GOL.randDivisor) / GOL.randDivisor) * GOL.randScale) & 0xff;
}

// --- the children (exe 0x004c5dd4, 0x005794d8) ----------------------------------------

// The 4 children at +0x6e4 (stride 0x1c, ctor 0x0057713c, vtable 0x00b06aa8). Their update 0x005794d8 counts
// `timer` down by `rate` and returns true once it is <= -1.0 (then latches -1.0). The state 0x17 runs them in
// order and the first expired one sets the body's +8 bit 0 (the object is removed). The rate is 0.005 on the
// state's entry (0x004c5dd4 case 4); the timers start at 0 (ASSUMED: the ctor's reset 0x0057739c is not read).
export class GolChild {
  timer = 0;
  rate = 0;
  update(): boolean {
    if (this.timer <= -1) {
      this.timer = -1;
      return true;
    }
    this.timer -= this.rate;
    return false;
  }
}
export const GOL_CHILD_RATE = 0.005;

// --- the derived extras (exe 0x004cb19c case 5 -> 0x004cea04 -> 0x004cede4) -----------

// The 0x2b leave: the body and its copies go on a ring of radius 320 (0x00908a10) around the arena centre.
// The body takes the seed's angle h (sin / cos of the BAMS angle into +0x38 / +0x40, yaw h + 0x8000 into +0x60);
// the copy k (1..count) takes h + k * (0x10000 / (count + 1)) (the exe's int step) and the same facing.
// ASSUMED: count 5 (the exe caps the fan at 5 and enemyids.ts reserves body + 1..5 for the Gol entry), the
// seed is the port's deterministic value (the exe draws it on the leader in 0x2b phase 6, not sent).
export const GOL_EXTRA = { count: 5, radius: 320 } as const;
export interface GolExtraPlacement {
  x: number;
  z: number;
  // BAMS, as the body's yaw.
  yaw: number;
}
export function golExtraRing(seed: number, count = GOL_EXTRA.count): { body: GolExtraPlacement; extras: GolExtraPlacement[] } {
  const h0 = seed & 0xffff;
  const step = Math.trunc(0x10000 / (count + 1));
  const at = (h: number, r: number): GolExtraPlacement => ({ x: sinB(h) * r, z: cosB(h) * r, yaw: (h + 0x8000) & 0xffff });
  const extras: GolExtraPlacement[] = [];
  let h = h0;
  for (let k = 0; k < count; k++) {
    h += step;
    extras.push(at(h, GOL_EXTRA.radius));
  }
  return { body: at(h0, GOL_EXTRA.radius), extras };
}

// --- the breath (exe 0x004cab30 sub 0 -> 0x004cfc08 -> flame object 0x004d02a4 / vtable 0x00afc0c8) --------

// The lattice of the flame (exe 0x00908c00, read in full): one ring of (z index, x index) pairs per frame, the
// rings 0..3 (1 + 6 + 12 + 18 cells). The world step is x 37.5 (0x00a486e8), z 43.3 (0x00a486ec), an odd x index
// is shifted by -21.65 in z (0x00a486f0): the four floats are the immediates of 0x004d046c..0x004d048c. The table
// goes on with float data after ring 3 (no sentinel): the port stops at ring 3 (UNCLEAR, see the map).
export const GOL_FLAME_RINGS: readonly (readonly [number, number])[][] = [
  [[0, 0]],
  [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1]],
  [[2, 0], [-2, 0], [-1, 1], [-1, -1], [2, 1], [2, -1], [-1, 2], [-1, -2], [0, 2], [0, -2], [1, 2], [1, -2]],
  [[3, 0], [-3, 0], [-2, 1], [-2, -1], [3, 1], [3, -1], [2, 2], [2, -2], [-2, 2], [-2, -2], [-1, 3], [-1, -3], [0, 3], [0, -3], [1, 3], [1, -3], [2, 3], [2, -3]],
];
export const GOL_FLAME = {
  stepX: 37.5, // 0x00a486e8
  stepZ: 43.3, // 0x00a486ec (43.300003)
  oddShift: -21.65, // 0x00a486f0
  reach: 373, // 0x00908d74 (398.0) - 0x00a486e4 (25.0): a cell is made only inside this radius of the centre
  cellRadius: 25, // 0x00a486dc (25.0): the hit radius of a cell (FUN_004cd344)
  frames: 51, // the flame ends after 50 ticks (0x004d0300: +0x28 > 0x32)
  cellFrames: 30, // ASSUMED: a cell's life (its effect's frame count is not read)
} as const;

// One breath: spawned at the body (+0x38 / +0x40), a cell of the ring k appears at frame k and hits each player
// within 25 of it once. The damage is a 'tech' effect with the power of the attack (ASSUMED: the Dragon's fireball power).
export class GolBreath extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff8030, size: 3 };
  private cells: { x: number; z: number; age: number }[] = [];
  private hitIds = new Set<number>();
  private ring = 0;
  constructor(x: number, z: number, power: number) {
    super(x, 0, z);
    this.effect = { kind: 'tech', power };
  }
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    if (this.ring < GOL_FLAME_RINGS.length) {
      for (const [zi, xi] of GOL_FLAME_RINGS[this.ring]) {
        const px = this.x + xi * GOL_FLAME.stepX;
        const pz = this.z + zi * GOL_FLAME.stepZ + (xi & 1 ? GOL_FLAME.oddShift : 0);
        if (Math.hypot(px, pz) <= GOL_FLAME.reach) this.cells.push({ x: px, z: pz, age: 0 });
      }
      this.ring++;
    }
    const hits: AiTarget[] = [];
    for (const t of this.inCells(targets)) {
      if (this.hitIds.has(t.clientId)) continue;
      this.hitIds.add(t.clientId);
      hits.push(t);
    }
    for (const c of this.cells) c.age++;
    this.cells = this.cells.filter((c) => c.age < GOL_FLAME.cellFrames);
    if (this.frames >= GOL_FLAME.frames && this.cells.length === 0) this.done = true;
    return hits;
  }
  // The live players within reach of a cell (the base within() tests the shot's own spot, the cells are elsewhere).
  private inCells(targets: readonly AiTarget[]): AiTarget[] {
    return targets.filter((t) => !t.dead && this.cells.some((c) => Math.hypot(t.x - c.x, t.z - c.z) <= GOL_FLAME.cellRadius + PLAYER_RADIUS));
  }
}

// --- shots ---------------------------------------------------------------------
// The fireball is the Dragon's object (dragon.ts DragonFireball): the Gol's fireball
// table is not read, so the ids and the power are ASSUMED to match the Dragon's.

export interface GolEvent {
  // The 6xA8 the leader sends (sendGolAction) or a sound.
  // 'gone': the body is removed (the children's exit, or a gone spawn); 'effect': FUN_0041a874's effect 0xe0 at the body.
  // 'extras': the 0x2b leave's copies (the renderer spawns them, see extras).
  kind: 'send' | 'se' | 'killed' | 'particle' | 'emitter' | 'gone' | 'effect' | 'extras';
  extras?: GolExtraPlacement[];
  state?: number;
  variant?: number;
  cursor?: number;
  target?: number | null;
  x?: number;
  z?: number;
  id?: number;
  handle?: DragonEmitter;
}

export interface GolOptions {
  x: number;
  z: number;
  angle: number;
  ultimate: boolean;
  movement: EnemyMovementData | null;
  hp: number; // stats row 18's hp (the maximum)
  leader: () => boolean;
  // Frame count of a body motion (archive order).
  frames: (motion: number) => number;
  playerHp: (clientId: number) => number;
  rng: () => number;
  // ASSUMED: true when the entrance spawns (the singleton, ctor 0x004cb480's
  // DAT_00a485cc check); the ctor then starts in 0x1e.
  singleton?: boolean;
  // ASSUMED from the area table (0x004cb480: bits 0x12008 of the spawn's entry): the body is gone at once.
  gone?: boolean;
  // The derived extras (ctor 0x004cede4, vtable 0x00afbc20): flag 0x40 (sequence C), no hit clamp (+0x682 = 0xffff).
  derived?: boolean;
  // The phase 9 gate of 0x2b (FUN_004ce970): true while the copies' slots are free. Default: free.
  extrasFree?: () => boolean;
}

// Flag bits of +0xf2 the port reads: 0x10 (the roar gate below cursor 0x32), 0x20 (the
// death gate above it), 0x40 (derived extras: never set here), 0x1 (set by the ctor).
const F_ROAR = 0x10;
const F_DEATH = 0x20;

export class GoldDragonAi extends BrainBase {
  state = 'entrance';
  sid: number = GOL_STATE.entrance;
  // The sequence cursor (+0x67c).
  cursor = 0;
  yaw = 0; // +0x18, BAMS
  alt = 0;
  flags = 1; // +0xf2
  air = 0; // +0xfb: 1 when the body is airborne (the roar / death variant)
  hp: number;
  readonly maxHp: number;
  // The hit clamp (+0x682) = ROUND(max * f / 100), the roar threshold: at or below
  // it the leader roars (hp = clamp, cursor = 0x32).
  clamp: number;
  // The derived extras (flag 0x40): sequence C, and the clamp is off.
  readonly derived: boolean;
  // The 4 children at +0x6e4 (state 0x17).
  readonly children = [new GolChild(), new GolChild(), new GolChild(), new GolChild()];
  // The walk-in burrow (0x10 / 0x11): +0x1b6 (reset by 0x10, +1 by 0x11), the sub 1 effect counter (+0x218).
  private burrowCount = 0;
  private burrowTick = 0;
  // Set on the tick the aim is taken: the walk starts on the next tick (the exe runs one sub per tick).
  private aimed = false;
  private walkStep = 0;
  private walkCap = 4;
  private walkVx = 0;
  private walkVz = 0;
  // The body is removed (+8 bit 0): the children expired, or the spawn is gone.
  private removed = false;
  // The 0x2b seed (the exe's +0x86c, drawn in phase 6 of 0x2b), and whether the death kill of a copy went out.
  private extraSeed = 0;
  private killedCopy = false;
  // ASSUMED from the area table (see GolOptions.gone): the body is removed on its first tick.
  private readonly gone: boolean;
  private hitFlag = false;
  // Motion: slot +0x2e, frame +0x2c-ish, speed.
  slotIndex = 26;
  mframe = 0;
  speed = 0.5;
  ended = false; // the motion's end (+0x2c & 0x10 in the states)
  private motionDirty = true;
  readonly events: GolEvent[] = [];
  dead = false;
  private pendingShots: EnemyShot[] = [];
  // The gate machine: the state's gates and how far it has come.
  private gateIndex = 0;
  private gateCount = 0;
  private age = 0;
  private stall = 0;
  private dashProfile = new DragonTrapezoid();
  private dashSpeed = 0;
  private dashCount = 0;
  private last: readonly AiTarget[] = [];
  private opts: GolOptions;
  private killedSent = false;
  private readonly fireballs: EnemyShot[] = [];

  constructor(opts: GolOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng);
    this.opts = opts;
    this.maxHp = Math.max(1, Math.trunc(opts.hp));
    this.hp = this.maxHp;
    this.clamp = Math.round((this.maxHp * GOL.clampShareAssumed) / GOL.clampDivisor);
    this.derived = !!opts.derived;
    this.gone = !!opts.gone;
    if (this.derived) {
      this.flags |= 0x40;
      this.clamp = -1; // *(short*)(+0x682) = 0xffff
    }
    // The ctor puts a fresh singleton in the entrance (0x1e), other spawns in wait.
    this.setState(opts.singleton === false ? GOL_STATE.wait : GOL_STATE.entrance);
  }

  // --- what the owner reads --------------------------------------------------------

  get invulnerable(): boolean {
    const s = this.sid;
    return s === 0x0d || s === 0x0e || s === 0x15 || s === 0x16 || s === 0x1e;
  }
  get superArmor(): boolean {
    return this.sid === 0x0d || this.sid === 0x15 || this.sid === 0x16;
  }
  get untargetable(): boolean {
    return this.sid === GOL_STATE.entrance;
  }
  get dying(): boolean {
    return this.sid === GOL_STATE.death || this.sid === GOL_STATE.corpse;
  }
  flinches(): boolean {
    return false;
  }
  get motionSlot(): GolSlot {
    return GOL_SLOTS[this.slotIndex] ?? GOL_SLOTS[0];
  }

  // --- hp ---------------------------------------------------------------------------

  // OlgaUpdate-style hit: lower hp, set the flag the clamp reads on the next tick.
  hit(damage: number): void {
    this.hp -= Math.max(0, chopToInt(damage));
    this.hitFlag = true;
  }

  // restore_enemy_status (6x0A from another client): hp = max - damage_taken.
  setDamageTaken(total: number): void {
    this.hp = this.maxHp - Math.max(0, Math.trunc(total));
    this.hitFlag = true;
  }

  // --- motion (Player__Animate) ------------------------------------------------------

  private setSlot(i: number): void {
    this.slotIndex = i;
    this.mframe = 0;
    this.speed = GOL_SLOTS[i]?.speed ?? 0.5;
    this.ended = false;
    this.motionDirty = true;
  }

  private animate(): void {
    const s = this.motionSlot;
    const count = Math.max(1, this.opts.frames(s.motion));
    this.mframe += this.speed;
    if (s.mode === 1) {
      if (this.mframe >= count) this.mframe -= count;
      // A loop never ends by itself: it reports one full loop as its end (ASSUMED, so
      // a motion-gated state cannot wait forever on a looping slot).
      if (this.mframe < this.speed) this.ended = true;
    } else if (this.mframe >= count - 1) {
      if (s.mode === 2 && s.next !== 0) {
        this.setSlot(s.next);
        this.ended = true;
      } else {
        this.mframe = count - 1;
        this.ended = true;
      }
    }
  }

  private emit(e: GolEvent): void {
    this.events.push(e);
  }

  // --- the states ----------------------------------------------------------------

  // Phase 4 (enter) of a state: the slot and the flags of the state's definition.
  private enter(sid: number): void {
    const d = stateDef(sid);
    if (sid === GOL_STATE.burrowFirst) this.burrowCount = 0;
    else if (sid === GOL_STATE.burrowNext) this.burrowCount++;
    if (sid === GOL_STATE.burrowFirst || sid === GOL_STATE.burrowNext) {
      this.air = 2; // +0xfb = 2
      this.walkStep = 0;
      this.walkCap = 4 + 4 * this.burrowCount; // +0x21e = (+0x1b6) * 4 + 4
      this.burrowTick = 0;
    }
    if (sid === GOL_STATE.children) for (const c of this.children) c.rate = GOL_CHILD_RATE;
    // ASSUMED seed: the exe's phase 6 draws it on the leader (FUN_004c7670); the port derives it from the
    // sequence cursor so every client builds the same ring.
    if (sid === GOL_STATE.attack2b) this.extraSeed = (Math.imul(this.cursor, 0x9e37) ^ 0x5a5a) & 0xffff;
    if (d.slot !== null) this.setSlot(d.slot);
    if (d.f2set !== undefined) this.flags |= d.f2set;
    if (d.f2clear !== undefined) this.flags &= ~d.f2clear;
    this.gateIndex = 0;
    this.gateCount = 0;
    this.ended = false;
    if (sid === GOL_STATE.lunge) this.startDash();
  }

  // Phase 5 (leave): the death's kill (EnemyOnKilledHandler_0051f894, exe, in the
  // state 0x15's leave) runs once.
  private leave(sid: number): void {
    if (sid === GOL_STATE.death && !this.killedSent) {
      this.killedSent = true;
      this.emit({ kind: 'killed', x: this.x, z: this.z });
    }
    // Phase 5 of 0x2b (exe 0x004cb19c case 5): FUN_004cea04(+0xa48500 +0x28 count, +0x24 hp, seed). The body
    // takes its ring place (FUN_004cea04 writes the body's +0x38 / +0x40 / +0x60) and the copies are spawned.
    if (sid === GOL_STATE.attack2b) {
      const ring = golExtraRing(this.extraSeed);
      this.x = ring.body.x;
      this.z = ring.body.z;
      this.yaw = ring.body.yaw;
      this.emit({ kind: 'extras', extras: ring.extras });
    }
  }

  // setState (SetEnemyAiState_0051f62c): phase 5 on the old, phase 4 on the new.
  setState(next: number): void {
    if (this.dead) return;
    this.leave(this.sid);
    this.age = 0;
    this.enter(next);
    this.sid = next;
    this.state = stateDef(next).name;
  }

  // The leader's send: the new state's phase 6 (the x / z of the 6xA8; the body's
  // place, ASSUMED: the exe's phase 6 values are not all read) then the packet goes out
  // and runs here at once (FUN_008003e0 sends and applies locally).
  private sendState(next: number): void {
    this.emit({ kind: 'send', state: next, cursor: this.cursor, target: this.targetId, x: this.x, z: this.z, variant: variantOf(this.opts.rng) });
    this.applyPacket(next, this.cursor, this.targetId, this.x, this.z);
  }

  // FUN_004cbea0 (exe): the target, the cursor, x / z, phase 7 on the old state, then
  // the state change when it differs.
  private applyPacket(state: number, cursor: number, target: number | null, _x: number, _z: number): void {
    // x / z are the 6xA8's place: the lunge and the walk read the body's own (ASSUMED).
    this.targetId = target;
    this.cursor = cursor;
    this.stall = 0;
    this.receive(state);
    if (state !== this.sid) this.setState(state);
  }


  // Phase 7 of the current state after a packet: nothing is ported per state beyond
  // the lunge's, which reads the packet's x / z (ASSUMED, the exe's phase 7 of 0x06).
  private receive(_state: number): void {
    void _state;
  }

  applyRemote(state: number, cursor: number, target: number | null, x: number, z: number): void {
    this.applyPacket(state, cursor, target, x, z);
  }

  // A 6x10 / 6x11 (the same handlers as the Dragon's, combat/enemystate.ts): the target, the cursor,
  // then the state (6x11 only on a change). No x / z, no phase 7.
  applyTargetState(state: number, cursor: number, target: number | null, sub: number): void {
    this.targetId = target;
    this.cursor = cursor;
    if (enemyTargetStateSets(sub, state, this.sid)) this.setState(state);
  }

  // The table walk of phase 9 (pickNext): the state the sequence names, and the cursor.
  private pickNext(send: boolean): void {
    const n = golNext(this.cursor, this.derived);
    this.cursor = n.cursor;
    this.sendPick(n.state, send);
  }

  private sendPick(state: number, send: boolean): void {
    if (send) this.sendState(state);
    else this.applyPacket(state, this.cursor, this.targetId, this.x, this.z);
  }

  // The leader's step (UpdateDragonAiState-style, exe 0x004cc390): below cursor 0x32
  // the roar, from it the death; then the phase 9 pick.
  private leaderStep(send: boolean): void {
    if (this.cursor < GOL_CURSOR_B) {
      if (!(this.flags & F_ROAR) && this.hp <= this.clamp) {
        // FUN_004c311c (exe): hp = clamp, cursor = 0x32 (FUN_004cdb10(1)), roar 0xd or 0xb.
        this.hp = this.clamp;
        this.cursor = GOL_CURSOR_B;
        this.sendPick(this.air === 1 ? GOL_STATE.landRoar : GOL_STATE.roar, send);
        return;
      }
    } else if (!(this.flags & F_DEATH) && this.hp < 1) {
      // Death: 0xc when airborne (it lands and goes on), else 0x15 (exe).
      this.sendPick(this.air === 1 ? GOL_STATE.landDie : GOL_STATE.death, send);
      return;
    }
    if (this.age > GOL.stateMax && this.sid !== GOL_STATE.corpse && this.sid !== GOL_STATE.children) {
      this.age = 0;
      this.pickNext(send);
      return;
    }
    // The state holds until its gates have passed (advanceGates); then phase 9 picks.
    if (this.gateIndex < stateDef(this.sid).gates.length) return;
    this.pick(send);
  }

  // The pick of the current state (phase 9): its own successor or the table walk.
  private pick(send: boolean): void {
    const d = stateDef(this.sid);
    if (d.next === 'none') return;
    if (d.next === 'seq') return this.pickNext(send);
    this.sendPick(d.next, send);
  }

  // The sub 0 end of the states that do something at it: the burrow's aim (0x004c42a8 case 0: heading
  // atan2(x, z) + 0x8000, velocity sin / cos of it) and the breath (0x004cab30: FUN_004cfc08 at the body).
  private onGateZero(): void {
    const s = this.sid;
    if (s === GOL_STATE.burrowFirst || s === GOL_STATE.burrowNext) {
      const h = (Math.round((Math.atan2(this.x, this.z) * 65536) / (Math.PI * 2)) + 0x8000) & 0xffff;
      this.yaw = h;
      this.walkVx = sinB(h);
      this.walkVz = cosB(h);
      this.aimed = true;
    } else if (s === GOL_STATE.breathA || s === GOL_STATE.breathB || s === GOL_STATE.landRoar || s === GOL_STATE.landDie) {
      this.pendingShots.push(new GolBreath(this.x, this.z, GOL.fireballPower));
    }
  }

  // The burrow's walk (0x004c42a8 case 0 sub 1): the step grows 0.1 a tick up to the cap (+0x21e), the body moves
  // along the heading by the step, and FUN_0041a874 (effect 0xe0) every 11 ticks.
  private burrowWalk(): void {
    this.walkStep = Math.min(this.walkStep + 0.1, this.walkCap);
    this.x += this.walkVx * this.walkStep;
    this.z += this.walkVz * this.walkStep;
    this.burrowTick++;
    if (this.burrowTick > 10) {
      this.emit({ kind: 'effect', id: 0xe0, x: this.x, z: this.z });
      this.burrowTick = 0;
    }
  }

  // The removal (+8 bit 0 in the exe): the body is gone and the brain stops.
  private remove(): void {
    if (this.dead) return;
    this.removed = true;
    this.dead = true;
    this.emit({ kind: 'gone' });
  }

  // The gate machine, run once per tick by the leader and the follower alike (phase 0).
  private advanceGates(): void {
    const d = stateDef(this.sid);
    if (this.gateIndex >= d.gates.length) return;
    const g = d.gates[this.gateIndex];
    this.gateCount++;
    let pass = false;
    switch (g.kind) {
      case 'now':
        pass = true;
        break;
      case 'frames':
        pass = this.gateCount >= g.n;
        break;
      case 'motion':
        pass = this.ended;
        break;
      case 'near':
        pass = Math.hypot(this.x, this.z) < g.r;
        break;
      case 'extras':
        pass = this.opts.extrasFree ? this.opts.extrasFree() : true;
        break;
      case 'children':
        pass = this.removed;
        break;
      case 'dash':
        pass = this.dashProfile.done(this.dashCount);
        break;
      case 'never':
        pass = false;
        break;
    }
    if (pass) {
      if (this.gateIndex === 0) this.onGateZero();
      this.gateIndex++;
      this.gateCount = 0;
      this.ended = false;
    }
  }

  // The lunge (0x004c197c): a DragonTrapezoid over 0x41800000 / 0xc1800000 (16 / -16
  // per tick, exe) to the distance the trapezoid gives. ASSUMED: the dash distance is
  // the Dragon's dash profile.
  private startDash(): void {
    this.dashCount = 0;
    this.dashSpeed = 0;
    // ASSUMED dist and vmax: the exe's second profile is FUN_00783444(16, -16, dist, vmax)
    // with dist from the turn (not read here).
    this.dashProfile.set(16, -16, 120, GOL.dashCap);
  }

  private tickDash(): void {
    if (this.gateIndex >= stateDef(this.sid).gates.length) return;
    if (stateDef(this.sid).gates[this.gateIndex]?.kind !== 'dash') return;
    this.dashCount++;
    const v = this.dashProfile.value(this.dashCount);
    const step = v - this.dashSpeed;
    this.dashSpeed = v;
    this.x += sinB(this.yaw) * step;
    this.z += cosB(this.yaw) * step;
  }

  // The volley (0x007): 3 fireballs at the first gate's end (exe: three attack objects
  // at the sub 2 spread 0x1000); the aim point is the target (ASSUMED).
  private volley(): void {
    const t = this.targetNow();
    const tx = t ? t.x : this.x + sinB(this.yaw) * 125;
    const tz = t ? t.z : this.z + cosB(this.yaw) * 125;
    const ids = DRAGON_FIRE_IDS.normal;
    for (const spread of [0, 0x1000, -0x1000]) {
      const a = bamsOf(tx - this.x, tz - this.z) + spread;
      const dir = [sinB(a), 0, cosB(a)] as const;
      const to: [number, number, number] = [this.x + dir[0] * 125, 0, this.z + dir[2] * 125];
      this.fireballs.push(new DragonFireball([this.x, 30, this.z], to, GOL.fireballPower, ids));
    }
  }

  private targetNow(): AiTarget | null {
    if (this.targetId === null) return null;
    for (const t of this.last) if (t.clientId === this.targetId && !t.dead) return t;
    return null;
  }

  // Per-state frame work of the port (phase 0).
  private frameState(): void {
    const s = this.sid;
    if (s === GOL_STATE.lunge) this.tickDash();
    if ((s === GOL_STATE.burrowFirst || s === GOL_STATE.burrowNext) && this.gateIndex === 1 && !this.aimed) this.burrowWalk();
    // 0x17 (exe 0x004c5dd4 case 0): the children in order; the first expired one removes the body.
    if (s === GOL_STATE.children) {
      for (const c of this.children) {
        if (c.update()) {
          this.remove();
          break;
        }
      }
    }
    if (s === GOL_STATE.volley && this.gateIndex === 1 && this.gateCount === 1) this.volley();
    if (s === GOL_STATE.walk) {
      // ASSUMED: the walk steps toward the body's heading at the walk speed (MovementData unread).
      this.x += sinB(this.yaw) * 0.8;
      this.z += cosB(this.yaw) * 0.8;
      const r = Math.hypot(this.x, this.z);
      if (r > 350) {
        this.x *= 350 / r;
        this.z *= 350 / r;
      }
    }
  }

  // --- the frame -----------------------------------------------------------------

  tick(targets: readonly AiTarget[]): AiFrame {
    const out = this.frame0();
    this.last = targets;
    if (this.gone && !this.dead) this.remove();
    if (this.dead) return this.finish0(out);
    // A copy (derived) has no clamp, so it dies at hp < 1 (ASSUMED: the exe's generic death of a hit entity, flag 8,
    // then the derived update's 6x76 and removal, 0x004cee30). The kill is the same bossKilled path as the body's.
    if (this.derived && this.hp < 1 && !this.killedCopy) {
      this.killedCopy = true;
      this.dead = true;
      this.emit({ kind: 'killed', x: this.x, z: this.z });
      return this.finish0(out);
    }
    const leaderNow = this.opts.leader();
    // The hit clamp (update 0x004cbf68, exe): while the cursor is below 0x32 a hit
    // cannot take hp under the clamp (+0x682).
    if (this.hitFlag) {
      if (this.cursor < GOL_CURSOR_B && this.clamp > this.hp) this.hp = this.clamp;
      this.hitFlag = false;
    }
    if (leaderNow) {
      this.leaderStep(true);
    } else if (++this.stall >= GOL.followerWait) {
      // ASSUMED: a follower that has heard nothing this long takes the leader's step.
      this.stall = 0;
      this.leaderStep(false);
    }
    this.advanceGates();
    this.age++;
    this.animate();
    this.frameState();
    this.aimed = false;
    if (this.motionDirty) {
      this.motionDirty = false;
      const s = this.motionSlot;
      this.play(out, { index: s.motion, speed: s.speed, loop: s.mode === 1 });
    }
    return this.finish0(out);
  }

  private frame0(): AiFrame {
    return { motion: null, x: this.x, z: this.z, angle: this.yaw * BAMS, hit: null };
  }

  private finish0(out: AiFrame): AiFrame {
    out.x = this.x;
    out.z = this.z;
    this.angle = this.yaw * BAMS;
    out.angle = this.angle;
    out.lift = this.alt;
    const shots = [...this.pendingShots, ...this.fireballs.splice(0)];
    this.pendingShots = [];
    if (shots.length) out.shots = shots;
    return out;
  }

  onDamage(): void {
    // No flinch: hits only lower hp (the clamp and the roar do the rest).
  }

  resume(): string {
    return this.state;
  }

  // The events for the renderer, drained by the owner.
  drainEvents(): GolEvent[] {
    return this.events.splice(0);
  }
}

