// Barba Ray, the Episode 2 area 0x20 boss (enemy type 0xCB, PsoBB.exe VAs).
// Map and evidence: docs/bosses/barbaray-map.md (passes 1-4). Decoded from
// Ghidra (tools/ghidra/decomp.sh): root frame 0x004b8584, table runner
// 0x004b8dec / 0x004b8e3c, gate 0x004b8e1c, dispatcher 0x004b02b4, sender
// 0x004b5150, finale / death 0x004b5d1c / 0x004b5c98, root HP delta 0x004b947c;
// objdump: part pool 0x004ba120 / 0x004ba1b8 / 0x004b966c (the x87 control word
// 0xc00 makes the 0.5 conversion TRUNCATE, not round), root and part init
// 0x004afe59 / 0x004ba3fc.
//
// One BarbaRayAi (an EnemyBrain) owns the body, its 10 parts (the model's bone
// nodes, hit as enemy slots body + 1 .. body + 10) and the spawner's Pig Rays.
// The body's HP is two pools: the shell 708 (the first to go) and the body 704;
// a part has its own pool and, once broken, drains the body 704 by half of each
// hit. The leader runs the action table (floor tables, 0x009abc68) and sends
// 6xA9 / 6xAA for each step; followers apply the same steps (applyRemote).
// Everything the map leaves ASSUMED or open is tagged in the comments below.
import { BrainBase } from './enemyfsm.ts';
import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyBrain } from './enemyai.ts';
import { DrlEasing } from './derolle.ts';
import type { EnemyMovementData } from '../formats/battleparams.ts';

// --- constants --------------------------------------------------------------

// The shared enemy HP layout (formats.ts): +0x2bc max, +0x334 current. Part
// init 0x004ba2e4 and root ctor 0x004afe39 write 20000 (0x4e20).
export const BARBA_HP = 20000;
export const BARBA_PART_COUNT = 10;
// The loop 0x004afd1a..0x004afdd9 creates the 10 parts (cmp 0xa).

// Part positions (0x004b8584, the root update, every frame while root+0x7b4 is
// set). The update reads 11 node captures and writes 10 rows at root+0x538:
//   row r = 0.5 * (C[r] + C[r + 1]),  r = 0 .. 9
// The capture operands are root+0x3f4 (C0), +0x460 (C1) and +0x478 + 12 * (k - 2)
// for k = 2 .. 10 (the add operand of 0x0082ebac, decoded from the disassembly
// at 0x004b8c24..0x004b8d58). The captures are the model's draw-order nodes; the
// node list is ASSUMED to be the De Rol Le spine (combat/derolle.ts DRL_SPINE /
// render/combat.ts DRL_SPINE, the same body model, bm_boss7_de_rol_le_c model 0).
// Part i copies row i (0x004ba0ac). Init park value 9984.0 (0x461c4000, root ctor).
export const BARBA_CAPTURE_COUNT = 11;
export const BARBA_CAPTURE_OFFSETS: readonly number[] = [0x3f4, 0x460, 0x478, 0x484, 0x490, 0x49c, 0x4a8, 0x4b4, 0x4c0, 0x4cc, 0x4d8];
export const BARBA_ROW_PARK = 9984;
// The part's hit box radius: 50.0 (0x42480000 written to 0x009abc90 by 0x004ba2d8;
// 0x004ba2e4 copies the box at 0x009abc84.. to part+0x394.. so the radius is
// part+0x3a0). The box is centred on the part (its offset words are zero).
export const BARBA_PART_RADIUS = 50;

// The motion slots (table 0x009aba20, 16-byte rows, see the map's pass 3).
// mode 1 loops, 2 plays once and goes on to `next`, 3 plays once and holds
// (ASSUMED from the chains; the mode meaning is not read from the player).
export interface BarbaSlot {
  readonly mode: 1 | 2 | 3;
  readonly next: number;
  readonly motion: number;
  readonly speed: number;
}
const bs = (mode: 1 | 2 | 3, next: number, motion: number, speed: number): BarbaSlot => ({ mode, next, motion, speed });
// Motion ids are the BML entries of bm_boss7_de_rol_le_c (0 beam02 .. 20 hige_wait).
export const BARBA_SLOTS: readonly BarbaSlot[] = [
  bs(3, 0, 8, 0.7), // 0 op_boss2 (intro)
  bs(1, 0, 11, 0.6), // 1 forward (idle)
  bs(1, 0, 9, 1.0), // 2 fd02
  bs(3, 0, 0, 0.4), // 3 beam02
  bs(2, 1, 10, 0.3), // 4 fjump
  bs(2, 1, 14, 0.5), // 5 rljump
  bs(2, 1, 12, 0.5), // 6 lrjump
  bs(2, 9, 15, 0.28), // 7 r_bite
  bs(2, 10, 13, 0.28), // 8 l_bite
  bs(1, 0, 6, 2.0), // 9 bite_rloop
  bs(1, 0, 5, 2.0), // 10 bite_lloop
  bs(3, 0, 16, 0.6), // 11 scatter
  bs(2, 15, 2, 0.4), // 12 beam_a
  bs(3, 0, 3, 0.3), // 13 beam_b
  bs(2, 1, 4, 0.4), // 14 beam_c
  bs(1, 0, 1, 0.5), // 15 beamwait
  bs(3, 0, 7, 0.7), // 16 ed_boss2 (finale / dead)
];

// Anchors (bss 0x00a47780, 10 x (x, y, z), written by the static init
// 0x004b99d3). FUN_004b1e58(i) teleports the body to anchor i.
export const BARBA_ANCHORS: readonly (readonly [number, number, number])[] = [
  [-175, 7, 25],
  [0, 7, 500],
  [175, 7, 25],
  [0, 7, -250],
  [0, 7, 25],
  [-205, -100, 25],
  [0, -100, 528],
  [205, -100, 25],
  [0, -100, -280],
  [0, -100, 25],
];

// The action tables (pointer array 0x009abc68, floors 0..3). Each is the
// record codes in order (8-byte records, the arg dword is never read). The
// tables end at the code 0x45 (loop to record 1). Floors 4 and up are null in
// the exe. The floor index comes from DAT_00a9cd68 (.bss, not decoded: ASSUMED
// that the port's `floor` option is the index).
export const BARBA_TABLES: readonly (readonly number[])[] = [
  // 0x00906980 (67 codes)
  [3, 8, 15, 3, 40, 60, 50, 68, 57, 61, 41, 17, 63, 21, 17, 63, 21, 40, 59, 54, 68, 55, 41, 16, 18, 63, 22, 18, 63, 22, 58, 10, 40, 47, 61, 41, 61, 23, 24, 24, 25, 13, 40, 60, 50, 68, 55, 59, 58, 41, 16, 18, 63, 22, 10, 15, 17, 63, 21, 59, 5, 23, 24, 24, 25, 13, 69],
  // 0x009066c0 (86 codes)
  [3, 6, 16, 40, 58, 56, 68, 57, 59, 41, 15, 17, 63, 21, 17, 63, 21, 59, 17, 63, 21, 40, 59, 54, 59, 68, 55, 58, 41, 16, 18, 63, 22, 18, 63, 22, 58, 18, 63, 22, 10, 40, 47, 61, 41, 61, 23, 24, 24, 25, 13, 40, 60, 50, 68, 55, 60, 61, 41, 16, 18, 63, 22, 58, 18, 63, 22, 10, 15, 17, 63, 21, 59, 17, 63, 21, 59, 5, 61, 23, 24, 24, 25, 61, 13, 69],
  // 0x00906400 (87 codes)
  [3, 8, 15, 40, 59, 54, 59, 68, 55, 58, 41, 16, 18, 63, 22, 58, 18, 63, 22, 59, 40, 58, 54, 59, 68, 57, 59, 41, 15, 17, 63, 21, 59, 17, 63, 21, 58, 17, 63, 21, 59, 4, 40, 43, 61, 41, 60, 23, 24, 24, 25, 13, 40, 60, 50, 68, 55, 60, 61, 41, 16, 18, 63, 22, 58, 18, 63, 22, 10, 15, 17, 63, 21, 59, 17, 63, 21, 59, 5, 61, 23, 24, 24, 25, 61, 13, 69],
  // 0x009060e0 (96 codes)
  [3, 6, 16, 40, 58, 56, 58, 68, 59, 57, 59, 41, 59, 17, 63, 21, 59, 17, 63, 21, 58, 17, 63, 21, 40, 59, 54, 59, 68, 55, 58, 41, 16, 18, 63, 22, 58, 18, 63, 22, 58, 18, 63, 22, 40, 43, 61, 41, 61, 23, 24, 24, 24, 25, 13, 40, 60, 50, 60, 68, 55, 41, 16, 18, 63, 22, 58, 18, 63, 22, 58, 10, 15, 17, 63, 21, 59, 17, 63, 21, 59, 5, 61, 62, 61, 62, 61, 62, 23, 24, 24, 24, 25, 61, 13, 69],
];

// Phases (the table codes and the dispatcher's values).
export const BARBA_PHASE = {
  enter: 0x01,
  run0: 0x13,
  run2: 0x14,
  wall0: 0x15,
  wall2: 0x16,
  timed: 0x1b, // 0x004b60c4
  finale: 0x1c, // 0x004b5d1c
  dead: 0x1d, // 0x004b5c98
  spawn0: 0x3a,
  spawn2: 0x3c,
  loop: 0x45,
} as const;

// Sends that are 6xAA (with the root's target, root+0xe5), not 6xA9 (0x004b5150).
const AA_CODES: ReadonlySet<number> = new Set([0x13, 0x14, 0x18, 0x40, 0x41, 0x44]);

// Effects and SE ids (boss07.pac / se tables; the map's pass 3 and 4).
export const BARBA_SE = {
  partBreak: 0x3f9, // 0x004ba1b8 (and the root's shell break 0x004b958c)
  hit: 0x3fa, // root hit with flag 8 and a broken part's drain
  finaleCut: 0x3fb, // 0x1c phase 0 at timer 85.0
  pigShot: 0x3ed, // 0x004b4684 at 8.0
  beamFlash: 0x3ec, // 0x17 at 10.0
} as const;
export const BARBA_FX = {
  hit: 0x127, // root hit (owner) and a broken part's spark: 15 up, 12 back
  finaleCut: 0x20c,
  finaleTwenty: 0x20f,
  finaleLate: 0x206, // FUN_004b60a0 at 123.0 (the effect id is ASSUMED)
  spark: { up: 15, back: 12 },
} as const;

// Finale timer marks (the 1c phase 0 band tests, FUN_007aaa30(x) with the
// state timer +0xc0): 85.0, 20.0 and 123.0.
const FINALE_MARKS = { cut: 85, effect: 20, late: 123 } as const;
// The 0x1b countdown: -2.0 a frame, the re-send at the -200.0 mark (0x906d58 /
// the map's "-200.0 < +0x1be"; the comparison direction is ASSUMED).
const TIMED_STEP = 2;
const TIMED_LIMIT = -200;

// ASSUMED pacing values (not decoded; the leader's 0x1ad / 0x1b0 cadence is
// UNCLEAR): one table step per PACE ticks while the gate is open, and a state
// whose exit is not decoded advances after DWELL ticks so the brain cannot hang.
export const BARBA_PACE = 30; // ASSUMED
export const BARBA_DWELL = 150; // ASSUMED
// Spawner: 9 Pig Rays per 0x3a enter, one every 6 ticks (cooldown 5, 0x004b0910).
export const BARBA_SPAWN = { count: 9, cooldown: 5 } as const; // count: 0x004b0910 at enter (event 4, param 4); cooldown ASSUMED from the 0x738 test

// The spawner's tables (0x004b4e6c). The count row is 0x00905f60 + row * 0x24
// (9 u32 per row; ASSUMED row 0: the 0x3a..0x3c records carry 0 in the floor 0
// table at 0x00906980). 0 = no Pig Ray at this index, 1 = mode 0 (+0x35c 0.0),
// 2 = mode 1 (+0x35c 1.0). Destinations: 0x009abbc8[group] (9 vec3, stride 12),
// headings 0x009abbb8[group] (9 u32, BAMS, read as raw here).
export const BARBA_PIG_COUNT: readonly number[] = [1, 0, 1, 0, 1, 0, 1, 0, 1];
export const BARBA_PIG_DEST: readonly (readonly (readonly [number, number, number])[])[] = [
  [[72, 12, 60], [65, 12, 45], [72, 12, 30], [65, 12, 15], [72, 12, 0], [65, 12, -15], [72, 12, -30], [65, 12, -45], [72, 12, -60]],
  [[-72, 12, 60], [-65, 12, 45], [-72, 12, 30], [-65, 12, 15], [-72, 12, 0], [-65, 12, -15], [-72, 12, -30], [-65, 12, -45], [-72, 12, -60]],
  [[50, 12, 75], [37.5, 12, 65], [25, 12, 75], [12.5, 12, 65], [0, 12, 75], [-12.5, 12, 65], [-25, 12, 75], [-37.5, 12, 65], [-50, 12, 75]],
  [[50, 12, -95], [37.5, 12, -85], [25, 12, -95], [12.5, 12, -85], [0, 12, -95], [-12.5, 12, -85], [-25, 12, -95], [-37.5, 12, -85], [-50, 12, -95]],
];
export const BARBA_PIG_HEADING: readonly number[] = [0xc000, 0x4000, 0x8000, 0];
// The minion's mode from its count value (0x004ad95c's +0x35c: 1 -> 0.0, else 1.0).
export function barbaPigMode(count: number): 0 | 1 {
  return count === 1 ? 0 : 1;
}

// Corner moves of the 0x004b1e98 transitions (from, to) by phase. ASSUMED
// meaning of the sides: 0..3 are the anchors 0..3 (see BARBA_ANCHORS).
export const BARBA_MOVES: Readonly<Record<number, readonly [number, number]>> = {
  0x03: [0, 1],
  0x05: [0, 3],
  0x06: [1, 2],
  0x08: [1, 0],
  0x09: [2, 3],
  0x0b: [2, 1],
  0x0c: [3, 0],
  0x0e: [3, 2],
};

// --- the action table (0x004b8e3c, the same switch as 0x004b8584 / 0x004b0910) ---

export interface BarbaStep {
  // A phase to send (6xA9 / 6xAA), or `loop` (the 0x45 record, no send).
  phase: number | null;
  loop: boolean;
}

// The record code resolved to a phase (0x1e..0x27 / 0x45 are the table's own
// codes, anything else is sent as it is). `flag` is root+0x6cc (param 0x1b3),
// `roll` is FUN_00520bf4's value (the threshold 0.0 is 0x00906c84 / 0x00906c98).
export function barbaResolve(code: number, flag: number, roll: number): BarbaStep {
  const low = roll <= 0;
  const pick = (a: number, b: number) => ({ phase: flag === 0 ? a : b, loop: false });
  switch (code) {
    case 0x1e:
      return { phase: low ? 6 : 8, loop: false }; // ASSUMED rand split, threshold 0.0 decoded
    case 0x1f:
      return { phase: flag === 0 ? 5 : 9, loop: false };
    case 0x20:
      return { phase: low ? 0x0e : 0x0c, loop: false };
    case 0x21:
      return pick(3, 0x0b);
    case 0x23:
      return pick(4, 0x0a);
    case 0x24:
      return pick(0x0f, 0x10);
    case 0x25:
      return pick(0x11, 0x12);
    case 0x26:
      return pick(0x13, 0x14);
    case 0x27:
      return pick(0x15, 0x16);
    case BARBA_PHASE.loop:
      return { phase: null, loop: true };
    default:
      return { phase: code, loop: false };
  }
}

// --- body movement (decoded from the exe, asm checked) -----------------------
// Words: x +0x38, y +0x3c (the teleport's middle anchor entry, 7 or -100), z +0x40
// (the teleport's third entry, the arena depth), heading +0x64 (BAMS), lift +0x6f8.
// Correction to the brief: 0x004b7860 writes +0x40 = -210 (z), not y.
// Side entry 0x004b416c (the 0x13 and 0x15 enters): x = -100 (side 0) or +100,
// z = 10.0 (0x41200000), lift = 4.0 (DAT_00a47a90), heading +0x500 / -0x500.
export const BARBA_SIDE_ENTRY = { x: 100, z: 10, lift: 4, yaw: 0x500 } as const;
// Swim, phases 0x15 / 0x16 (0x004b41ac). Speed +0x744 gains 256 a frame (0x906e48)
// from 0x500 and clamps to 16384 (0x906e40 / 0x906e44). vx += 0.08 (0x906e4c),
// vy += 0.2 (0x906f64), vz += 0.1 (0x906e5c); x += dir * vx, z -= vy, lift -= vz.
// dir (+0x750) is -1 on side 0, else +1; vz starts at -1.0. Sub 1 raises the lift
// by 2.0 (0x906e50) until 0.0 (0x906e60). Sub 0 exits at lift < -137.0 (0x00a47a94).
export const BARBA_SWIM = { speed0: 0x500, speedStep: 256, speedMax: 16384, vx: 0.08, vy: 0.2, vz: 0.1, vz0: -1, exitLift: -137, rise: 2, speedSe: 0x2200 } as const;
// Path followers of phase 0x13 / 0x14 (0x004b3c2c): the four objects at root+0x6e4..
// 0x6f4 each get a target (FUN_004bd190) once every 180 ticks (+0x73c); speed 120
// (0x906e70, the default for a value outside 1..599). The wait is 41 ticks (sub 0,
// +0x734 > 40); sub 2 waits for all four to arrive (state 4) or 601 ticks.
export const BARBA_FOLLOW = { wait: 40, interval: 180, speed0: 120, limit: 600, count: 4, radius: 120 } as const;
// Lift pull (FUN_004b1c94, used by the arc): 0.4 a tick toward 0 (0x906f5c / 0x906f60).
const LIFT_STEP = 0.4;

// One of the four path followers (root+0x6e4..0x6f4). Their own update is not
// decoded: ASSUMED to move straight at speed / 30 a tick and to arrive (state 4) on
// reaching the target. They are not drawn (ASSUMED: no model; not in the e2e).
export class BarbaFollower {
  x = 0;
  y = 0;
  z = 0;
  tx = 0;
  ty = 0;
  tz = 0;
  speed: number = BARBA_FOLLOW.speed0;
  // +0x30 == 4 (FUN_004bd220). Reset when a new target is set (ASSUMED).
  arrived = false;
  // +0x3c bit 1 / +0x34: moving toward the target (FUN_004bd190 / FUN_004bd1d4 set it,
  // FUN_004bd1e8 clears it).
  moving = false;
  // FUN_004bd190(this, vec, speed): the speed is kept only in 1..599, else 120.
  set(tx: number, ty: number, tz: number, speed: number): void {
    this.tx = tx;
    this.ty = ty;
    this.tz = tz;
    this.speed = speed >= 1 && speed < BARBA_FOLLOW.limit ? speed : BARBA_FOLLOW.speed0;
    this.arrived = false;
    this.moving = true;
  }
  // FUN_004bd1e8: stop (state 5).
  stop(): void {
    this.moving = false;
  }
  step(): void {
    if (!this.moving) return;
    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const dz = this.tz - this.z;
    const d = Math.hypot(dx, dy, dz);
    const s = this.speed / 30; // ASSUMED: speed in units a second
    if (d <= s) {
      this.x = this.tx;
      this.y = this.ty;
      this.z = this.tz;
      this.moving = false;
      this.arrived = true;
      return;
    }
    const k = s / d;
    this.x += dx * k;
    this.y += dy * k;
    this.z += dz * k;
  }
}

// Row r = 0.5 * (C[r] + C[r + 1]) (0x004b8584). `out` has BARBA_PART_COUNT rows,
// `captures` BARBA_CAPTURE_COUNT positions; no allocation.
export function barbaRows(captures: readonly (readonly [number, number, number])[], out: [number, number, number][]): void {
  for (let r = 0; r < out.length; r++) {
    const a = captures[r];
    const b = captures[r + 1];
    const o = out[r];
    if (!a || !b || !o) return;
    o[0] = (a[0] + b[0]) * 0.5;
    o[1] = (a[1] + b[1]) * 0.5;
    o[2] = (a[2] + b[2]) * 0.5;
  }
}

// --- events the render layer reads ----------------------------------------

export type BarbaEvent =
  | { kind: 'send'; phase: number; cursor: number; target: number | null }
  | { kind: 'se'; id: number }
  | { kind: 'effect'; id: number; part: number | null; up?: number; back?: number }
  | { kind: 'spawn'; group: number; index: number; count: number }
  | { kind: 'killed' }
  | { kind: 'dead' };

// One part: its pool (+0x3cc), the broken flag (+0x3c4 bit 0) and its anchor.
interface BarbaPart {
  pool: number;
  broken: boolean;
}

export interface BarbaRayOptions {
  x: number;
  z: number;
  angle: number;
  rng: () => number;
  // MovementData[15] (the pools, GetDerolleAnimationSpeed8's row). ASSUMED:
  // the body pools are iparam[0] / iparam[2] of the same row (the root's
  // attack record at +0x628 is not decoded).
  movement: EnemyMovementData | null;
  floor?: number; // the table index (DAT_00a9cd68), ASSUMED default 0
  leader: () => boolean;
}

// The part pool: 0x004b98d0 reads the row 15 +0x1c (iparam[1]) through
// 0x0077a6cc. ASSUMED fallback when there is no row: BARBA_HP.
export function barbaPartPool(movement: EnemyMovementData | null): number {
  return movement && movement.iparam[1] > 0 ? movement.iparam[1] : BARBA_HP;
}

export class BarbaRayAi extends BrainBase {
  state = 'phase 1';
  readonly floor: number;
  readonly leader: () => boolean;
  // The state (+0x32e) and its motion slot (+0x2e).
  phase: number = BARBA_PHASE.enter;
  slot = 0;
  // The table cursor (+0x6bc / 0x1af): the record the next step reads.
  cursor = 0; // ASSUMED: the ctor value is not decoded, the table starts at record 0
  // The root HP pools: the shell 708 and the body 704 (shorts in the exe).
  shellHp: number;
  bodyHp: number;
  // Root flags +0x630: 0x4 gate block, 0x8 shell broken, 0x80, 0x200, 0x400, 0x800.
  flags = 0;
  // +0x1b2: the side (the corner pick of the enter paths); +0x6cc: the flag the
  // table's variants read (`variant`).
  side = 0;
  variant = 0;
  // The 0x1c kill request (+0x1cc). ASSUMED: set as soon as the cut starts.
  killReady = 0;
  // The state timer (+0xc0) and the 0x1b countdown (+0x1be).
  timer = 0;
  countdown = 0;
  // Pacing (ASSUMED values, see BARBA_PACE / BARBA_DWELL).
  private pace = 0;
  private dwell = 0;
  // The spawner counters (+0x730 spawned, +0x734 count, +0x738 cooldown).
  spawned = 0;
  spawnCount = 0;
  spawnCooldown = 0;
  // Body position: x (+0x38), y (+0x3c), z (+0x40); lift (+0x6f8); heading (+0x64, BAMS).
  y = 0;
  lift = 0;
  yaw = 0;
  // The movement words, by exe offset (the phases share them; see each handler).
  // +0x730 sub-state, +0x734 counter, +0x738 follower index / arc sub-state,
  // +0x73c count, +0x740 follower speed, +0x744 swim speed, +0x74c vx (swim) / dir (arc),
  // +0x750 dir (swim) / vy (arc), +0x754 vy (swim) / its accel (arc), +0x758 vz / z-vel,
  // +0x75c arc vx, +0x760 arc z accel.
  moveSub = 0;
  private moveCounter = 0;
  private arcSub = 0;
  private moveCount = 0;
  private followSpeed = 0;
  f744 = 0;
  f74c = 0;
  f750 = 0;
  f754 = 0;
  f758 = 0;
  f75c = 0;
  f760 = 0;
  // The arc's easing (0x00434ac4, DrlEasing) from phase 5 / 6 sub 3.
  arc: DrlEasing | null = null;
  readonly followers: BarbaFollower[] = Array.from({ length: BARBA_FOLLOW.count }, () => new BarbaFollower());
  readonly parts: BarbaPart[];
  // Two buffers swapped by drain(), so a tick allocates nothing.
  private events: BarbaEvent[] = [];
  private spare: BarbaEvent[] = [];
  private readonly out: AiFrame = { motion: null, x: 0, z: 0, angle: 0, hit: null };
  dead = false;
  readonly superArmor = true;
  // The part rows (root+0x538, barbaRows): part i stands at rows[i].
  readonly rows: [number, number, number][] = Array.from({ length: BARBA_PART_COUNT }, () => [BARBA_ROW_PARK, BARBA_ROW_PARK, BARBA_ROW_PARK]);

  constructor(opts: BarbaRayOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng);
    this.floor = opts.floor ?? 0;
    this.leader = opts.leader;
    const mv = opts.movement;
    // The root pools (ASSUMED record: MovementData[15] iparam[0] / [2]).
    this.bodyHp = mv && mv.iparam[0] > 0 ? mv.iparam[0] : BARBA_HP;
    this.shellHp = mv && mv.iparam[2] > 0 ? mv.iparam[2] : BARBA_HP;
    const pool = barbaPartPool(mv);
    this.parts = Array.from({ length: BARBA_PART_COUNT }, () => ({ pool, broken: false }));
    // The ctor sets phase 1 (0x004b017f): its enter writes slot 0.
    this.setSlot(0);
    this.state = `phase ${this.phase.toString(16)}`;
  }

  get table(): readonly number[] {
    return BARBA_TABLES[this.floor] ?? [];
  }

  // The gate of 0x004b8e1c: the body pool ran out and flag 4 is clear.
  get gateOpen(): boolean {
    return this.bodyHp < 1 && (this.flags & 4) === 0;
  }

  get shellBroken(): boolean {
    return (this.flags & 8) !== 0;
  }

  // Drains what the last steps produced (sends, SE, effects, spawns, the kill).
  // The returned array is valid until the next drain().
  drain(): BarbaEvent[] {
    const out = this.events;
    this.events = this.spare;
    this.spare = out;
    this.events.length = 0;
    return out;
  }

  // --- HP (0x004b947c root, 0x004ba120 part) ----------------------------------

  // A hit on part i of `damage` (max - hp, as the 6x0A carries it). Returns
  // what it went to: 'part' (the pool), 'broken' (the pool ran out on this
  // hit), 'drain' (a broken part: the body pool) or 'none'.
  hitPart(i: number, damage: number): 'part' | 'broken' | 'drain' | 'none' {
    const p = this.parts[i];
    const d = Math.trunc(damage);
    if (!p || d <= 0 || this.dead) return 'none';
    if (p.broken) {
      this.events.push({ kind: 'effect', id: BARBA_FX.hit, part: i, up: BARBA_FX.spark.up, back: BARBA_FX.spark.back });
      this.drainBody(Math.trunc(d * 0.5));
      return 'drain';
    }
    p.pool -= d;
    if (p.pool < 1) {
      p.broken = true;
      this.events.push({ kind: 'se', id: BARBA_SE.partBreak });
      return 'broken';
    }
    return 'part';
  }

  // The root's own hit: flag 8 (the shell is gone) sends the damage to the body
  // 704; otherwise the shell 708 takes it, and when that runs out the shell
  // breaks (0x004b958c: flags |= 0x88).
  hitRoot(damage: number): 'shell' | 'shellBroken' | 'body' | 'none' {
    const d = Math.trunc(damage);
    if (this.dead || d <= 0) return 'none';
    if (this.shellBroken) {
      this.events.push({ kind: 'effect', id: BARBA_FX.hit, part: null });
      this.events.push({ kind: 'se', id: BARBA_SE.hit });
      this.drainBody(d);
      this.flags |= 0x800; // 0x004b95b4
      return 'body';
    }
    this.shellHp -= d;
    if (this.shellHp < 0) {
      this.shellHp = 0;
      this.flags |= 0x88; // 0x004b958c
      this.events.push({ kind: 'se', id: BARBA_SE.partBreak });
      this.flags |= 0x800;
      return 'shellBroken';
    }
    this.flags |= 0x800;
    return 'shell';
  }

  private drainBody(d: number): void {
    this.bodyHp -= d;
    this.events.push({ kind: 'se', id: BARBA_SE.hit });
  }

  // --- phases ---------------------------------------------------------------------

  // The slot each state's enter writes (pass 3, item 1). Phases not listed keep
  // the slot. `side` is +0x1b2.
  slotOnEnter(phase: number): number | null {
    switch (phase) {
      case 1:
        return 0;
      case 0x13:
      case 0x14:
      case 0x15:
      case 0x16:
        return this.side === 0 ? 9 : 10;
      case 0x17:
        return 0x0c;
      case 0x18:
        return 0x0f;
      case 0x19:
      case 0x1a:
        return 0x0e;
      case 0x1c:
      case 0x1d:
        return 0x10;
      case 4:
      case 0x0a:
        return this.side === 0 ? 5 : 6;
      case 0x0f:
      case 0x10:
        return 3;
      case 0x11:
      case 0x12:
        return this.side === 0 ? 7 : 8; // ASSUMED: the write of 1 first, then the side (order not traced)
      case 0x0d:
        return 4; // 0x004b7040: 1, then 4 (the 1 is not kept)
      case 5:
      case 6:
        return this.side === 0 ? 5 : 6; // 0x004b0ee0 enter (asm: 5 on side 0, else 6)
      case 3:
      case 8:
      case 9:
      case 0x0b:
      case 0x0c:
      case 0x0e:
        return 1;
      default:
        return null;
    }
  }

  // Sets the motion slot and the motion the renderer plays.
  private setSlot(s: number): void {
    this.slot = s;
    const row = BARBA_SLOTS[s];
    if (!row) return;
    this.current = { index: row.motion, speed: row.speed, loop: row.mode === 1 };
  }

  // 0x0051f62c: event 5 to the old phase, event 4 to the new one, then the
  // phase is set. Every client runs it, the sender included (send-then-apply).
  applyPhase(phase: number, cursor: number | null): void {
    if (this.dead) return;
    if (cursor !== null) this.cursor = cursor;
    this.leave(this.phase);
    this.enter(phase);
  }

  // A 6xA9 / 6xAA from the leader (0x004b98fc / 0x004b9938): a 6xAA sets the
  // target first (0x00520fcc), then the phase applies as for 6xA9.
  applyRemote(phase: number, cursor: number, target: number | null): void {
    if (target !== null) this.targetId = target;
    this.applyPhase(phase, cursor);
  }

  private enter(phase: number): void {
    this.phase = phase;
    this.state = `phase ${phase.toString(16)}`;
    this.timer = 0;
    this.dwell = 0;
    const s = this.slotOnEnter(phase);
    if (s !== null) this.setSlot(s);
    if (phase === BARBA_PHASE.run0 || phase === BARBA_PHASE.run2) this.enterFollow();
    else if (phase === BARBA_PHASE.wall0 || phase === BARBA_PHASE.wall2) this.enterSwim();
    else if (phase === 5 || phase === 6) this.enterArc();
    if (phase === BARBA_PHASE.finale) this.enterFinale();
    else if (phase === BARBA_PHASE.dead) this.enterDead();
    else if (phase === BARBA_PHASE.timed) this.countdown = 0; // ASSUMED: the 0x1be start is not traced
    else if (phase >= BARBA_PHASE.spawn0 && phase <= BARBA_PHASE.spawn2) {
      // 0x004b0910 with param 4 (the enter): 9 Pig Rays, the counters reset.
      this.spawned = 0;
      this.spawnCount = BARBA_SPAWN.count;
      this.spawnCooldown = 0;
    }
  }

  private leave(phase: number): void {
    // The kill is the leave of 0x1c (0x0051f894: EXP and drops, 6x76 on the owner).
    if (phase === BARBA_PHASE.finale) this.events.push({ kind: 'killed' });
    // Event 5 of 0x13 / 0x14 stops the four followers (0x004b3d1f).
    if (phase === BARBA_PHASE.run0 || phase === BARBA_PHASE.run2) for (const f of this.followers) f.stop();
    // Event 5 of 0x15 / 0x16 and of 0x0ee0 clears the gate block (+0x630 bit 2); the
    // 0x0ee0 leave also takes the table's flag as the side (asm 0x004b0f26).
    if (phase === BARBA_PHASE.wall0 || phase === BARBA_PHASE.wall2 || phase === 5 || phase === 6) this.flags &= ~4;
    if (phase === 5 || phase === 6) this.side = this.variant;
  }

  // 0x1c enter (0x004b5d1c, param 4): the state is 0x10, the side 3, the body
  // to anchor 3, the body pool 704 zeroed, the timers and the flags reset.
  private enterFinale(): void {
    this.flags |= 4; // 0x004b5d1c: +0x18c = (+0x18c & ~0x300) | 4
    this.side = 3;
    this.teleport(3);
    this.bodyHp = 0;
    this.countdown = 0;
    this.killReady = 0;
  }

  // 0x1d enter (0x004b5c98): the state 0x10, the flag 4 set. The dead bit (root
  // +0x8 |= 1) is the brain's dead; the death reports on the 'dead' event.
  private enterDead(): void {
    this.flags |= 4;
    this.dead = true;
    this.state = 'dead';
    this.current = null;
    this.events.push({ kind: 'dead' });
  }

  // FUN_004b1e58(i) (asm 0x004b1e58): the body moves to anchor i (x, y, z), the lift
  // and the heading are zeroed.
  teleport(i: number): void {
    const a = BARBA_ANCHORS[i];
    if (!a) return;
    this.x = a[0];
    this.y = a[1];
    this.z = a[2];
    this.lift = 0;
    this.setYaw(0);
    this.warps++;
  }

  // +0x64 (BAMS) is the heading; the brain's angle is radians.
  private setYaw(v: number): void {
    this.yaw = v;
    this.angle = v * BAMS_TO_RAD;
  }

  // FUN_004b416c: the side entry. side 0 starts at x = -100 heading +0x500, side 1 at
  // x = +100 heading -0x500; z = 10, lift = 4.
  private sideEntry(): void {
    const s0 = this.side === 0;
    this.x = s0 ? -BARBA_SIDE_ENTRY.x : BARBA_SIDE_ENTRY.x;
    this.z = BARBA_SIDE_ENTRY.z;
    this.lift = BARBA_SIDE_ENTRY.lift;
    this.setYaw(s0 ? BARBA_SIDE_ENTRY.yaw : -BARBA_SIDE_ENTRY.yaw);
  }

  // Phase 0x13 / 0x14 enter (0x004b3c2c, event 4): side entry, the wait (+0x73c 180,
  // speed 120), the sub-state 0. The root does not move after the entry.
  private enterFollow(): void {
    this.flags &= ~0x104;
    this.sideEntry();
    this.moveCount = BARBA_FOLLOW.interval;
    this.followSpeed = BARBA_FOLLOW.speed0;
    this.moveSub = 0;
    this.moveCounter = 0;
    this.arcSub = 0;
  }

  // Phase 0x15 / 0x16 enter (0x004b41ac, event 4): the four followers stop, the side
  // entry, dir = -1 on side 0 else +1, vz = -1, speed 0x500, sub-state 0.
  private enterSwim(): void {
    for (const f of this.followers) f.stop();
    this.flags |= 4;
    this.flags &= ~0x100;
    this.sideEntry();
    this.f750 = this.side === 0 ? -1 : 1;
    this.f74c = 0;
    this.f754 = 0;
    this.f758 = BARBA_SWIM.vz0;
    this.f744 = BARBA_SWIM.speed0;
    this.moveSub = 0;
    this.moveCounter = 0;
    this.flags &= ~0x200;
  }

  // Phase 5 / 6 enter (0x004b0ee0, event 4): the body moves to anchor `side`, dir
  // (+0x74c) = -1 on side 0 else +1, every movement word zeroed, sub-state 0.
  private enterArc(): void {
    this.flags |= 4;
    this.flags &= ~0x100;
    this.teleport(this.side);
    this.f74c = this.side === 0 ? -1 : 1;
    this.f750 = 0;
    this.f754 = 0;
    this.f758 = 0;
    this.f75c = 0;
    this.f760 = 0;
    this.moveSub = 0;
    this.moveCounter = 0;
    this.arcSub = 0;
    this.moveCount = 0;
    this.arc = null;
  }

  // Event 0 of 0x13 / 0x14 (asm 0x004b3d3a): the wait, then one follower target every
  // 180 ticks (the random point or the player), then the wait for the arrivals.
  private followerFrame(targets: readonly AiTarget[]): void {
    this.timer += 1;
    switch (this.moveSub) {
      case 0:
        this.moveCounter += 1;
        if (this.moveCounter > BARBA_FOLLOW.wait) {
          this.moveSub = 1;
          this.moveCounter = 0;
          this.arcSub = 0;
        }
        return;
      case 1: {
        this.moveCounter += 1;
        if (this.moveCounter < this.moveCount) return;
        this.moveCounter = 0;
        const f = this.followers[this.arcSub];
        if (!f) return;
        // FUN_00520f04: a live target sends the follower to its position (ASSUMED y = 0).
        const t = this.target(targets);
        if (t) {
          f.set(t.x, 0, t.z, this.followSpeed);
        } else {
          // ASSUMED: the exe's random point (FUN_0082dcbc / FUN_0082ddd8) is a random
          // direction at a random distance up to 120 from the arena centre.
          const r = this.rng() * BARBA_FOLLOW.radius;
          const a = this.rng() * Math.PI * 2;
          f.set(Math.cos(a) * r, 0, Math.sin(a) * r, this.followSpeed);
        }
        this.arcSub += 1;
        if (this.arcSub < BARBA_FOLLOW.count) return;
        this.moveCounter = 0;
        this.moveSub = 2;
        return;
      }
      case 2: {
        this.moveCounter += 1;
        if (this.followers.every((f) => f.arrived)) {
          this.moveSub = 3;
          return;
        }
        if (this.moveCounter > BARBA_FOLLOW.limit) this.moveSub = 3;
        return;
      }
      default:
        return;
    }
  }

  // Event 0 of 0x15 / 0x16 (asm 0x004b41ac): sub 0 swims, sub 1 rises to the water line.
  private swimFrame(): void {
    this.timer += 1;
    if (this.moveSub === 0) {
      // +0x744 += 256, truncated; clamped to 16384 (the speed compare, then the store).
      const next = Math.trunc(this.f744 + BARBA_SWIM.speedStep);
      const sp = next < BARBA_SWIM.speedMax ? next : BARBA_SWIM.speedMax;
      this.f744 = sp;
      this.f74c += BARBA_SWIM.vx;
      this.f754 += BARBA_SWIM.vy;
      this.f758 += BARBA_SWIM.vz;
      this.x += this.f750 * this.f74c;
      this.z -= this.f754;
      this.lift -= this.f758;
      this.setYaw(Math.trunc(-this.f750 * sp));
      if (this.moveCounter === 0 && sp >= BARBA_SWIM.speedSe) {
        this.moveCounter = 1; // 0x734: the 0x3ed sound once
        this.events.push({ kind: 'se', id: 0x3ed });
      }
      if (this.lift < BARBA_SWIM.exitLift) {
        // Exit: back to the side anchor, the lift at -137, sub-state 1.
        this.moveSub = 1;
        this.teleport(this.side);
        this.lift = BARBA_SWIM.exitLift;
        this.f758 = 0;
        this.setSlot(1);
        this.flags = (this.flags & ~4) | 0x100;
      }
      return;
    }
    if (this.moveSub === 1) {
      // The rise: lift += 2.0 until 0.0, then sub 2 (done).
      const next = this.lift + BARBA_SWIM.rise;
      if (next < 0) {
        this.lift = next;
      } else {
        this.moveSub = 2;
        this.lift = 0;
      }
    }
  }

  // FUN_004b1c94: the lift returns to 0 by 0.4 a tick.
  private pullLift(): void {
    if (this.lift > LIFT_STEP) this.lift -= LIFT_STEP;
    else if (this.lift < -LIFT_STEP) this.lift += LIFT_STEP;
    else this.lift = 0;
  }

  // Event 0 of 0x0ee0 (asm 0x004b0ee0): sub-state 0 waits one frame (ASSUMED: the
  // +0xb0 bit 2 wait is not held), then the arc sub-states 0..6 by the timer marks.
  private arcFrame(): void {
    this.timer += 1;
    if (this.moveSub === 0) {
      this.moveSub = 1;
      return;
    }
    switch (this.arcSub) {
      case 0:
        if (this.timer >= 10) {
          this.arcSub = 1;
          this.f75c = (65 / 20) * this.f74c; // 0x906fd8 / 0xa47a78
        }
        break;
      case 1:
        if (this.timer >= 20) {
          this.arcSub = 2;
          this.f75c = (-90 / 16) * this.f74c; // 0x906fe0 / 0xa47a74
          // 0x906fa0 = 270, the z term of the second velocity.
          this.f760 = ((16 + 56.67) * -this.f758 + 270 - this.z) / ((0.5 * 16 + 56.67) * 16);
        }
        break;
      case 2:
        if (this.timer >= 28) {
          this.arcSub = 3;
          // FUN_004b1de4 is 0.0 (its local_c is never written): the target height is 0.
          const t = (0 - this.f750) / 2.5;
          this.f750 = t;
          this.f754 = (t * 2) / 56.67;
          this.f75c = (-370 / 56.67) * this.f74c; // 0x906fe4 / 0xa47a70
          this.moveCounter = 0;
        }
        break;
      case 3:
        if (this.timer >= 45) {
          this.arcSub = 4;
          this.f75c = (-30 / 2) * this.f74c; // 0x907000 / 0xa47a6c
          // FUN_00434ac4(7.0, |25 - z|, 0.2, 0.05): the arc's easing (ASSUMED decel guard).
          this.arc = new DrlEasing(7, Math.max(Math.abs(25 - this.z), 1e-3), 0.2, 0.05);
          this.f758 = this.z;
        }
        break;
      case 4:
        if (this.timer >= 70) {
          this.arcSub = 5;
          this.f75c = ((-175 - this.x * this.f74c) / 36) * this.f74c; // 0x906fb4 / 0xa47a68
        }
        break;
      case 5:
        if (this.timer >= 64) this.arcSub = 6; // 0x906fbc
        break;
      default:
        break;
    }
    // The per-sub writes (after the switch, as the exe).
    switch (this.arcSub) {
      case 0:
        this.f758 -= BARBA_SWIM.vy; // 0x906f64 = 0.2
        this.z += this.f758;
        break;
      case 1:
        this.x += this.f75c;
        this.z += this.f758;
        break;
      case 2: {
        const old = this.f758;
        this.x += this.f75c;
        this.f758 = old + this.f760;
        this.z = this.z + (old + this.f760);
        this.f750 = 0;
        break;
      }
      case 3:
        this.x += this.f75c;
        this.timer -= 0.5 - 0.3; // 0x906f68 - 0xa47a7c = 0.2
        this.lift += this.f750;
        this.f750 -= this.f754;
        this.z += this.f758;
        break;
      case 4:
      case 5:
        this.x += this.f75c;
        this.pullLift();
        this.arcStep();
        this.z = this.f758 - (this.arc?.pos ?? 0);
        break;
      case 6: {
        this.pullLift();
        const st = this.arcStep();
        if (st === 3) this.moveSub = 2; // FUN_0042cdc0 returns 3: done, the table goes on
        this.z = this.f758 - (this.arc?.pos ?? 0);
        if (this.slot === 1) this.flags |= 0x100;
        break;
      }
      default:
        break;
    }
  }

  // One tick of the arc's easing (FUN_0042cdc0, ASSUMED to be the DrlEasing); 0 without it.
  private arcStep(): number {
    return this.arc ? this.arc.tick() : 0;
  }

  // Event 0 of 0x1c (the frame): the cut timers (FUN_007aaa30 is a timer
  // crossing; the marks are decoded), and the kill request (ASSUMED: set as
  // soon as the cut starts, the map's pass 4 note on FUN_004d6864).
  private finaleFrame(): void {
    this.timer += 1;
    this.killReady = 1; // ASSUMED (see above)
    if (this.timer === FINALE_MARKS.cut) {
      this.events.push({ kind: 'effect', id: BARBA_FX.finaleCut, part: null }, { kind: 'se', id: BARBA_SE.finaleCut });
    }
    if (this.timer === FINALE_MARKS.effect) this.events.push({ kind: 'effect', id: BARBA_FX.finaleTwenty, part: null });
    if (this.timer === FINALE_MARKS.late) this.events.push({ kind: 'effect', id: BARBA_FX.finaleLate, part: null }); // FUN_004b60a0 (effect id ASSUMED)
  }

  // 0x1b (the timed attack, 0x004b60c4): the countdown drops by 2.0 a frame
  // and at the limit it re-sends 0x1c. The comparison direction is ASSUMED.
  private timedFrame(): void {
    this.countdown -= TIMED_STEP;
    // The send is the leader's (ASSUMED: the countdown runs on every client, the send is not repeated).
    if (this.countdown < TIMED_LIMIT && this.leader()) this.sendPhase(BARBA_PHASE.finale);
  }

  // The spawner (0x004b4e6c, the 0x3a..0x3c event 0): one Pig Ray every
  // cooldown + 1 ticks until the count is out, then the table playback goes on.
  private spawnFrame(): void {
    if (this.spawned < this.spawnCount) {
      if (this.spawnCooldown < 1) {
        const index = this.spawned;
        // count 0 = no Pig Ray at this index (the 0x00905f60 row); 1 / 2 pick the minion's mode.
        const count = BARBA_PIG_COUNT[index] ?? 0;
        this.events.push({ kind: 'spawn', group: this.phase - BARBA_PHASE.spawn0, index, count });
        this.spawned++;
        this.spawnCooldown = BARBA_SPAWN.cooldown;
      } else {
        this.spawnCooldown--;
      }
      return;
    }
    // The table playback after the count is the leader's (ASSUMED: the exe's
    // 0x3a path has no leader test; the sends are kept to the leader here).
    if (this.leader()) this.tableLoop();
  }

  // The record loop of the table (0x004b0910's and 0x004b8584's inline copy, the
  // same switch): reads records from the cursor, 0x45 jumps back to record 1,
  // a resolved code is sent. One send per call.
  tableLoop(): void {
    const t = this.table;
    if (t.length === 0) return;
    for (let guard = 0; guard < t.length * 2; guard++) {
      const code = t[this.cursor % t.length];
      this.cursor++;
      const step = barbaResolve(code, this.variant, this.rng());
      if (step.loop) {
        this.cursor = 1; // 0x45: the loop reads record 1 next
        continue;
      }
      if (step.phase !== null) this.sendPhase(step.phase);
      return;
    }
  }

  // The gate step (0x004b8e3c, the leader with the gate open): the table
  // states 0x13 / 0x14 run the loop; 0x15 / 0x16 send 0x1c (the finale); the
  // rest send the timed attack 0x1b. 0x1c / 0x1d never step.
  gateStep(): void {
    switch (this.phase) {
      case BARBA_PHASE.finale:
      case BARBA_PHASE.dead:
        return;
      case BARBA_PHASE.run0:
      case BARBA_PHASE.run2:
        this.tableLoop();
        return;
      case BARBA_PHASE.wall0:
      case BARBA_PHASE.wall2:
        this.sendPhase(BARBA_PHASE.finale);
        return;
      case BARBA_PHASE.timed:
        return; // ASSUMED: the timed attack is not re-entered by the gate (its countdown runs on)
      default:
        this.sendPhase(BARBA_PHASE.timed);
    }
  }

  // The sender side of 0x004b5150: the phase's event 6, the 6xA9 / 6xAA send
  // (6xAA for the target-carrying codes, with the root's target), then the
  // local apply (0x008003e0 runs the handler on the sender too).
  sendPhase(phase: number): void {
    if (this.dead) return;
    const aa = AA_CODES.has(phase);
    this.events.push({ kind: 'send', phase, cursor: this.cursor, target: aa ? (this.targetId ?? 0xffff) : null });
    this.applyPhase(phase, null);
  }

  // The state's own frame (event 0). Decoded: 0x1c, 0x1d, 0x1b, the spawner, and the
  // movement of 0x13 / 0x14, 0x15 / 0x16 and 0x5 / 0x6.
  private stateFrame(targets: readonly AiTarget[]): void {
    switch (this.phase) {
      case BARBA_PHASE.finale:
        this.finaleFrame();
        return;
      case BARBA_PHASE.timed:
        this.timedFrame();
        return;
      case BARBA_PHASE.run0:
      case BARBA_PHASE.run2:
        this.followerFrame(targets);
        return;
      case BARBA_PHASE.wall0:
      case BARBA_PHASE.wall2:
        this.swimFrame();
        return;
      case 5:
      case 6:
        this.arcFrame();
        return;
      default:
        if (this.phase >= BARBA_PHASE.spawn0 && this.phase <= BARBA_PHASE.spawn2) this.spawnFrame();
    }
  }

  // Event 9 of the finale (leader only): a kill request sends 0x1d.
  private doneCheck(): void {
    if (this.phase === BARBA_PHASE.finale && this.killReady === 1) this.sendPhase(BARBA_PHASE.dead);
  }

  // One game tick. The state's frame runs on every client. The leader then
  // either steps the table with the gate open (0x004b8e1c, paced by
  // BARBA_PACE), or, while the gate is closed, the states without a decoded
  // exit advance after BARBA_DWELL ticks with the table loop (ASSUMED), so
  // the brain never hangs. Followers only apply the leader's messages.
  tick(targets: readonly AiTarget[], animationEnded?: boolean): AiFrame {
    const frame = this.out;
    frame.motion = null;
    if (this.dead) return this.finish(frame);
    const before = this.current;
    this.stateFrame(targets);
    for (const f of this.followers) f.step();
    if (this.leader() && !this.dead) {
      if (this.phase === BARBA_PHASE.finale) {
        this.doneCheck();
      } else if (this.gateOpen) {
        if (this.pace <= 0) {
          this.pace = BARBA_PACE;
          this.gateStep();
        } else {
          this.pace--;
        }
      } else if (!this.hasDecodedExit()) {
        this.dwell++;
        if (this.dwell >= BARBA_DWELL) {
          this.dwell = 0;
          this.tableLoop();
        }
      }
    }
    // Motion chains: mode 2 goes on to `next` once the motion ended.
    if (animationEnded && !this.dead) {
      const row = BARBA_SLOTS[this.slot];
      if (row && row.mode === 2 && row.next !== this.slot) this.setSlot(row.next);
    }
    if (this.current !== before) frame.motion = this.current;
    return this.finish(frame);
  }

  // States with a decoded frame of their own (their exits are not the dwell).
  private hasDecodedExit(): boolean {
    return this.phase === BARBA_PHASE.timed || this.phase === BARBA_PHASE.finale || this.phase === BARBA_PHASE.dead || (this.phase >= BARBA_PHASE.spawn0 && this.phase <= BARBA_PHASE.spawn2);
  }

  onDamage(clientId: number): void {
    void clientId;
  }

  resume(): string {
    return this.state;
  }

  override kill(): void {
    this.dead = true;
    this.state = 'dead';
    this.current = null;
  }
}

// A part's enemy (the bone node i, enemy slot body + 1 + i). The render layer
// moves it to rows[i] (barbaRows) and sends its hits here (hit -> hitPart). It
// stays a target while the body lives (the broken part drains the body, hitPart).
export class BarbaPartAi implements EnemyBrain {
  state = 'part';
  readonly motion = null;
  readonly superArmor = true;
  readonly owner: BarbaRayAi;
  readonly index: number;
  private readonly frame: AiFrame = { motion: null, x: 0, z: 0, angle: 0, hit: null };
  constructor(owner: BarbaRayAi, index: number) {
    this.owner = owner;
    this.index = index;
  }
  get untargetable(): boolean {
    return this.owner.dead;
  }
  // The part's centre (the row).
  get row(): readonly [number, number, number] {
    return this.owner.rows[this.index] ?? [BARBA_ROW_PARK, BARBA_ROW_PARK, BARBA_ROW_PARK];
  }
  // A hit on this part (damage as the 6x0A carries it): the brain's part pool.
  hit(damage: number): 'part' | 'broken' | 'drain' | 'none' {
    return this.owner.hitPart(this.index, damage);
  }
  tick(): AiFrame {
    const r = this.row;
    this.frame.x = r[0];
    this.frame.z = r[2];
    return this.frame;
  }
  onDamage(): void {}
  resume(): string {
    return this.state;
  }
  kill(): void {}
}

// --- network (6xA9 / 6xAA, newserv CommandFormats.hh:5464 / 5473) ---------------

// 6xA9 {a9, 02, entity u16 @2, phase u16 @4, cursor (attack_seq_index) u16 @6}.
export function encodeBarbaA9(entity: number, phase: number, cursor: number): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  b[0] = 0xa9;
  b[1] = 2;
  dv.setUint16(2, entity & 0xffff, true);
  dv.setUint16(4, phase & 0xffff, true);
  dv.setUint16(6, cursor & 0xffff, true);
  return b;
}

// 6xAA {aa, 03, entity u16 @2, phase u16 @4, cursor u16 @6, target u32 @8}.
export function encodeBarbaAA(entity: number, phase: number, cursor: number, target: number): Uint8Array {
  const b = new Uint8Array(12);
  const dv = new DataView(b.buffer);
  b[0] = 0xaa;
  b[1] = 3;
  dv.setUint16(2, entity & 0xffff, true);
  dv.setUint16(4, phase & 0xffff, true);
  dv.setUint16(6, cursor & 0xffff, true);
  dv.setUint32(8, target >>> 0, true);
  return b;
}

export interface BarbaMessage {
  entity: number;
  phase: number;
  cursor: number;
  target: number | null;
}

// Decodes a 6xA9 (8 bytes) or 6xAA (12 bytes) body; null for anything else.
export function decodeBarbaMessage(body: Uint8Array): BarbaMessage | null {
  if (body.length < 8 || (body[0] !== 0xa9 && body[0] !== 0xaa)) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const m: BarbaMessage = { entity: dv.getUint16(2, true), phase: dv.getUint16(4, true), cursor: dv.getUint16(6, true), target: null };
  if (body[0] === 0xaa) {
    if (body.length < 12) return null;
    m.target = dv.getUint32(8, true);
  }
  return m;
}
