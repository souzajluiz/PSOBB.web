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
// The held palette keys the jump reads (g_KeyboardSharedState[0xe] = Left, [0xc] = Right ASSUMED).
export interface BarbaInput {
  readonly left: boolean;
  readonly right: boolean;
}

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
  idle: 0x00, // 0x004b9e54 (SetEnemyAnimationState): slot 1, the event 0 is Player__Animate
  enter: 0x01,
  run0: 0x13,
  run2: 0x14,
  wall0: 0x15,
  wall2: 0x16,
  drop: 0x0d, // 0x004b7040 (HandleSinowberillMovementState)
  volopt0: 0x0f, // 0x004b2cd0 (ProcessPlayerVoloptInteractionState2, side 0)
  volopt2: 0x10, // 0x004b2cd0 (side 2)
  beam: 0x17, // 0x004b6d08 (ProcessSinowberillActionState)
  shot0: 0x19, // 0x004b4684 (ProcessSinowberillAction)
  shot2: 0x1a, // 0x004b4684 (the same handler)
  arc0: 0x04, // 0x004b0ee0 (Ghidra dispatch: FUN_004b0ee0(p, 0, 2))
  arc2: 0x0a, // 0x004b0ee0 (FUN_004b0ee0(p, 2, 0))
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
  volopt: 0x3f8, // UpdateVoloptInteractionPoint (0x004b2cd0): one a point, at the part's row
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
// The Ghidra dispatch 0x004b02b4 (case values): 0x28 / 0x29 go from the current anchor
// (+0x6c8) to the one 5 below (when > 4) or 5 above it; the rest are fixed pairs (anchors
// 5..9 are the raised ring, y = -100).
export const BARBA_MOVES: Readonly<Record<number, readonly [number, number]>> = {
  0x03: [0, 1],
  0x05: [0, 3],
  0x06: [1, 2],
  0x08: [1, 0],
  0x09: [2, 3],
  0x0b: [2, 1],
  0x0c: [3, 0],
  0x0e: [3, 2],
  0x2a: [6, 7],
  0x2b: [7, 8],
  0x2c: [8, 5],
  0x2d: [5, 6],
  0x2e: [6, 5],
  0x2f: [5, 8],
  0x30: [8, 7],
  0x31: [7, 6],
  0x32: [6, 9],
  0x33: [9, 8],
  0x34: [8, 9],
  0x35: [9, 6],
  0x36: [5, 9],
  0x37: [9, 7],
  0x38: [7, 9],
  0x39: [9, 5],
};

// The phases that run 0x004b1e98 (the dispatch's ProcessPlayerInteractionState cases).
export function isBarbaTransition(phase: number): boolean {
  return phase === 0x28 || phase === 0x29 || BARBA_MOVES[phase] !== undefined;
}

// The phases whose event 9 steps the table once their own sequence is done (the leader's step).
export function isSequenced(phase: number): boolean {
  return isBarbaTransition(phase) || phase === BARBA_PHASE.drop || isVoloptPhase(phase) || phase === BARBA_PHASE.beam || isShotPhase(phase);
}

function isVoloptPhase(phase: number): boolean {
  return phase === BARBA_PHASE.volopt0 || phase === BARBA_PHASE.volopt2;
}

function isShotPhase(phase: number): boolean {
  return phase === BARBA_PHASE.shot0 || phase === BARBA_PHASE.shot2;
}

// The phases whose step waits on the motion chain or the part rows (the dwell guards them).
function isMotionPhase(phase: number): boolean {
  return isVoloptPhase(phase) || phase === BARBA_PHASE.beam || isShotPhase(phase);
}

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

// Corner transitions (0x004b1e98, ProcessPlayerInteractionState). The constants are the
// exe's floats (exedata.py): 0x906f18 5.0, 0x906f1c 0.2, 0x906f20 7.0, 0x906f24 0.08,
// 0x906f28 3.0, 0x906f2c 10.0, 0x906f30 0.4, 0x906f34 14.0, 0x906f38 0.16, 0x906f3c 6.0;
// the waits 0x906ef4 380 (sub 1), 0x906ef8 160 (sub 2), 0x906efc 200 (sub 2, state 3),
// 0x906f04 100 (sub 3), 0x906ee8 30 (sub 0), 0x906f08 0.9 and 0x906f0c 0.1 (the wait
// counter, +0xc8). The sub 0 z velocity clamp is 0x906eec 4.0 and its step 0x906ef0 0.1.
export const BARBA_TRANSITION = {
  near: 5, // to < 5 takes the low curve (the ground anchors 0..3 and the centre 4)
  wait1: 380,
  wait2: 160,
  wait2z: 200,
  wait3: 100,
  approachX: 30,
  zVelClamp: 4,
  zVelStep: 0.1,
  tickWait: 0.1,
  doneWait: 0.9,
  waitDown: 0.3,
} as const;

// Phase 0x0d (0x004b7040): the fall (sub 0, 21 ticks), the drop's sub-states (0x734: 0 wait for
// the timer 10.5, 1 the lift timer 16, 2 the speed halved at 22, 3 at 29), the rise by the
// z easing (ez, 7 / 0.2 / 0.05). The exe's floats (exedata): 906d28 0.5, 906d1c 2.0, 906e74 7.0
// (the fall's speed clamp), 906cec 300, 906cf0 10.5, 906cf4 40, 906cf8 16, 906cfc 22, 906d00 29,
// 906d20 4.0, 906cd8 13.5, 906cd0 180, 906cd4 50, 906cdc -20, 906ce0 50, 906ce4 26, 906ce8 21,
// 906ccc 500, 906cc8 0.3, 906d24 0.0, 906f64 0.2.
// PROVEN: a47a9c (A), a47a98 (B) and a47aa0 are .bss words written once by the static init
// fn 0x004b99a0 (objdump 0x004b9b28..0x004b9bba; the only other refs are reads in 0x004b7040 and
// 0x004b6ac0). The init does fld 906c1c (6.0) and fld 906c30 (17.0) first, then:
//   a47aa0 = 0.195 (movl 0x3e47ae15, 0x004b9b68)
//   a47a98 = 6.0 / a47aa0 = 30.769 (fdiv at 0x004b9b72, fstp at 0x004b9b78)
//   a47a9c = 18.333 (movl 0x4192aaaa, 0x004b9b7e)
//   (17.0 / 0.3 = 56.67 goes to a47a70, the 0x906fe4 multiplier, not this drop's.)
// The Ghidra body of 0x004b7040 (refsrc Psobb.exe-05112026.c) uses A = a47a9c and B = a47a98 in
// the rise speed formula and B as the divisor of the sub 1 / sub 2 values. Ghidra's sub 2 lift
// (fsub a47aa0 at 0x004b73f2) confirms liftZero: timer -= 0.3 - 0.195.
export const BARBA_DROP = {
  fallWait: 20, // sub 0 ends when the counter passes 20
  vyStep: 0.2,
  vyMin: -7,
  wait0: 10.5,
  wait1: 16,
  wait2: 22,
  wait3: 29,
  attackLo: 21, // the attack object's timer band (ASSUMED path, not spawned)
  attackHi: 26,
  attackA: 18.333332, // a47a9c = 0x4192aaaa (PROVEN, static init 0x004b9b7e)
  attackB: 6 / 0.195, // a47a98 = 6.0 / a47aa0 (PROVEN, static init 0x004b9b72; float32 30.769229)
  liftZero: 0.195, // a47aa0 = 0x3e47ae15 (PROVEN, static init 0x004b9b68)
  z0: 300,
  // The clock's stride at the enter (+0xc8, ASSUMED: the carry of slot 1's 0.6 from the idle). The
  // strides after it come from the rows (animateClock): the fall runs in slot 1 (row speed 0.6);
  // sub 0 -> 1 writes slot 4, whose blend wraps at the clock 1.0 to clock 0 and stride 0.3 (row 4).
  fallStride: 0.6,
  zTarget: 500,
  zMaxRise: 7,
  zAccel: 0.2,
  zDecel: 0.05,
} as const;

// Phases 0x11 / 0x12 (0x004b30fc, ProcessPlayerAction4; the dispatcher passes side 0 / 2).
// JP: src/Psobb.exe-05112026.c ProcessPlayerAction4_004b30fc (the names there are the reference's).
// Enter (event 4): slot 1 (0xb8 = 1), the gate block set (0x630 = (0x630 & ~0x100) | 4), the body to
// anchor `side` (0x6c8 = 0x1b2 = side, FUN_004b1e58), z0 = the anchor's z, vz = 0, the z accel -0.2.
// Event 0: sub 0 = 11 frames of windup (z sinks, vz -0.2 a tick, clamp -7), then slot 7 (side 0) or
// 8 (the blend: the clock wraps to 0 on the next tick); sub 1 waits for that wrap (0xb0 bit 4, PROVEN);
// sub 2..5 are the jump, timed by the clock at 6 / 13 / 20 / 25; sub 6 is the landing (0x3ee, 0x630 |= 0x200).
// Event 2 (the keyboard, ASSUMED the mode-2 poll): palette Left (g_KeyboardSharedState[0xe]) sends
// 0x13 / 0x14 (6xAA), else Right (index 0xc, ASSUMED) sends 0x15 / 0x16 (6xA9). Event 9 steps the table
// once the chain is in slot 9 / 10 (r_bite / l_bite chained into the bite loop).
// Constants: the .data floats from the exe (906e8c.. ; the .bss a47a80..90 from the static init
// 0x004b9b92..0x004b9bba: movs of 5.0, 7.0, 12.0, 7.0, 4.0 at a80, a84, a88, a8c, a90).
export const BARBA_JUMP = {
  windup: 11, // sub 0 ends on the 11th frame (0x734 + 1 < 11 stores)
  t2: 6.0, // 0x906e8c: sub 2 -> 3 (the clock)
  t3: 13.0, // 0x906e98: sub 3 -> 4
  t4: 20.0, // 0x906ea4: sub 4 -> 5
  t5: 25.0, // 0x906ea8: sub 5 -> 6 (the landing)
  xStart: 100, // 0x906e94 (x = 100 * dir at the sub 2 -> 3 and 3 -> 4 starts)
  xMid: 135, // 0x906ea0 (x = 135 * dir: the sub 3 -> 4 target, the sub 4 -> 5 start)
  xEnd: 100, // 0x906e9c (the sub 4 -> 5 target)
  zTop: 10.0, // 0x906e90 (the sub 3 -> 4 accel's z target)
  zGain: 2.0, // 0x906ecc
  vzFloor: -7.0, // 0x906eb0 (the windup's clamp)
  vzAccel: -0.2, // enter: 0x75c = 0xbe4ccccd
  yawSpeed: 1280, // 0x906ed0 (the yaw speed is -yawSpeed * dir / divA, a tick)
  divA: 5.0, // a47a80 = 5.0 (static init)
  divB: 7.0, // a47a84 = 7.0
  divC: 12.0, // a47a88 = 12.0 (squared)
  divD: 7.0, // a47a8c = 7.0
  liftCap: 4.0, // a47a90 = 4.0 (g_SinowberillAttackParams)
  liftK: 7.0 * 4.0, // a84 * a90: the lift's rise a tick (min with the cap)
  zTerm: 7.0, // 0x906e74 (sub 3's z term)
  half: 0.5, // 0x906eb8
  // The sound marks (check_entity_animation_elapsed_threshold, ASSUMED a crossing):
  seFallMark: 8.5, // 0x41080000: sub 3 plays 0x3ed
  seAirMark: 15.0, // 0x41700000: sub 2+ plays 0x3ec
  seLand: 0x3ee, // the landing, play_directional_sound_effect at once
  seJump: 0x3ed,
  seAir: 0x3ec,
} as const;

export function isJumpPhase(phase: number): boolean {
  return phase === 0x11 || phase === 0x12;
}

// A velocity-easing record of the exe (InitializeMovementTargetStruct_00434ac4 /
// _00434afc, NormalizeMovementTarget_00434a3c, Player__ApplyVelocityEasing 0x0042c9a0).
// Fields in the exe's order: state +0, accel +4, decel +8, max +0xc, v +0x10, dist +0x14,
// pos +0x18 (the output, clamped to dist), brake +0x1c (the decel point, a pos value).
// The same curve as DrlEasing (derolle.ts), but the arguments are the exe's own order and
// the struct is reused in place (no allocation per transition or arc).
export class BarbaEase {
  state = 0;
  accel = 0;
  decel = 0;
  max = 0;
  v = 0;
  dist = 0;
  pos = 0;
  brake = 0;
  // 00434ac4(max, dist, accel, decel): the exe's p3 is accel (+4), p4 decel (+8).
  init(max: number, dist: number, accel: number, decel: number): void {
    this.state = 0;
    this.accel = accel;
    this.decel = decel;
    this.max = max;
    this.v = 0;
    this.dist = dist;
    this.pos = 0;
    this.normalize();
  }
  // 00434afc(max, dist, rate): accel and decel are both the rate.
  initSym(max: number, dist: number, rate: number): void {
    this.init(max, dist, rate, rate);
  }
  // NormalizeMovementTarget_00434a3c: k = 1 / accel + 1 / decel; the brake point is
  // dist - max^2 / (2 decel), with the max lowered when the curve cannot reach it.
  private normalize(): void {
    const d = -this.decel; // fVar2 (the exe keeps decel negated here)
    const k = 1 / this.accel - 1 / d; // 1 * (1 / accel) + (-1) / d
    const t = (this.v * this.v) / (-2 * d) + this.dist;
    if (t < this.v * this.v * 0.5 * k) this.max = Math.sqrt(Math.max(0, (t + t) / k));
    this.brake = (this.max * this.max * 0.5) / d + this.dist;
  }
  // One tick: returns the state (3 = arrived). The output pos is min(pos + v, dist).
  tick(): number {
    let next: number;
    switch (this.state) {
      case 0:
        next = this.v + this.accel;
        if (next <= this.max) {
          this.v = next;
        } else {
          this.state = 1;
          this.v = this.max;
          next = this.max;
        }
        break;
      case 1:
        if (this.pos <= this.brake) {
          next = this.v;
        } else {
          this.v -= this.decel;
          this.state = 2;
          next = this.v;
        }
        break;
      case 2:
        next = this.v - this.decel;
        if (next >= 0) {
          this.v = next;
        } else {
          this.state = 3;
          this.v = 0;
          next = 0;
        }
        break;
      default:
        next = this.v;
        break;
    }
    const p = this.pos + next;
    this.pos = p < this.dist ? p : this.dist;
    return this.state;
  }
}

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
  // The leader's held palette keys for 0x11 / 0x12 (set by the render layer each frame; null = none).
  input: BarbaInput | null = null;
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
  // Phase 0x0d: the 0x734 sub-state of the drop and its counter (+0x734 / +0x73c).
  private dropSub = 0;
  private dropCount = 0;
  // Phase 0x0f / 0x10: the sweep's sub-state (+0x734) and the volopt kind (+0x70c, 0..2).
  private voloptSub = 0;
  // The animation clock's stride in effect (+0xc8) and the slot the body was last started in (+0xba,
  // the started id): the carry at spawn is the intro row's speed (ASSUMED: Enemy__InitAnimation of 0).
  // blendOn = the blend's wrap (clock 1.0) is pending (+0xb0 bit 4). See animateClock.
  private animStride = BARBA_SLOTS[0]!.speed;
  private startedSlot = 0;
  private blendOn = false;
  private voloptKind = 0;
  private followSpeed = 0;
  f744 = 0;
  f74c = 0;
  f750 = 0;
  f754 = 0;
  f758 = 0;
  f75c = 0;
  f760 = 0;
  f764 = 0; // the jump's z start (0x764)
  f768 = 0; // the jump's yaw speed (0x768)
  // The arc's easing (0x00434ac4) from phase 5 / 6 sub 3, reused in place.
  readonly arcEase = new BarbaEase();
  arcStarted = false;
  // The corner transition (phases 3, 5, 6, 8, 9, 0xb, 0xc, 0xe): the 0x638 / 0x658 /
  // 0x678 easings for x, y, z; the sign of each axis's move (+0x754 / +0x760 / +0x758);
  // the start (+0x74c / +0x75c / +0x750); the from / to anchors (+0x6c8 / +0x6cc); the
  // sub-states (+0x734 sub, +0x6d0 / +0x6d8 state, +0x6d4 done flag, +0xc8 wait).
  readonly ex = new BarbaEase();
  readonly ey = new BarbaEase();
  readonly ez = new BarbaEase();
  sgnX = 0;
  sgnY = 0;
  sgnZ = 0;
  tBaseX = 0;
  tBaseY = 0;
  tBaseZ = 0;
  tFrom = 0;
  tTo = 0;
  tSub = 0;
  tA = 0;
  tB = 0;
  tDone = 0;
  tWait = 0;
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
      case 0:
        return 1; // 0x004b9e54 enter (SetEnemyAnimationState): the slot 1 (idle), nothing else
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
        return this.side === 0 ? 5 : 6; // the arc (0x004b0ee0, Ghidra dispatch 0x004b02b4)
      case 0x0f:
      case 0x10:
        return 3;
      case 0x11:
      case 0x12:
        return 1; // 0x004b30fc enter writes 0xb8 = 1; the sub 0 end writes 7 / 8 by side (BARBA_JUMP)
      case 0x0d:
        return 1; // 0x004b7040 enter writes 1; the frame writes 4 when the fall's 21 ticks are over
      case 3:
      case 5:
      case 6:
      case 8:
      case 9:
      case 0x0b:
      case 0x0c:
      case 0x0e:
        return 1; // the corner transitions (0x004b1e98): slot 1 as the other transitions (ASSUMED)
      default:
        return null;
    }
  }

  // 0x004b30fc enter (event 4, side = 0 for 0x11, 2 for 0x12): the body to anchor side (0x6c8 and
  // 0x1b2 are the same word, so both fields take the side), the gate block set and 0x100 cleared,
  // z0 = the anchor's z, the z velocity 0 and its accel -0.2, the sub-state 0.
  private enterJump(side: number): void {
    this.side = side;
    this.tFrom = side;
    this.flags = (this.flags & ~0x100) | 4;
    this.teleport(side);
    this.moveSub = 0;
    this.moveCounter = 0;
    this.f74c = 0;
    this.f750 = 0;
    this.f754 = 0;
    this.f758 = 0;
    this.f764 = this.z;
    this.f75c = BARBA_JUMP.vzAccel;
    this.f760 = 0;
    this.f768 = 0;
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
    else if (phase === BARBA_PHASE.drop) this.enterDrop();
    else if (phase === BARBA_PHASE.beam) this.enterBeam();
    else if (isShotPhase(phase)) this.enterShot();
    else if (phase === BARBA_PHASE.volopt0 || phase === BARBA_PHASE.volopt2) this.enterVolopt(phase === BARBA_PHASE.volopt2 ? 2 : 0);
    else if (phase === BARBA_PHASE.wall0 || phase === BARBA_PHASE.wall2) this.enterSwim();
    else if (phase === BARBA_PHASE.arc0 || phase === BARBA_PHASE.arc2) this.enterArc();
    else if (isJumpPhase(phase)) this.enterJump(phase === 0x12 ? 2 : 0);
    if (phase === 0x28 || phase === 0x29) {
      // The dispatch reads the current anchor (+0x6c8) before the enter writes it.
      const cur = this.tFrom;
      this.enterTransition(cur, cur > 4 ? cur - 5 : cur + 5);
    } else {
      const move = BARBA_MOVES[phase];
      if (move) this.enterTransition(move[0], move[1]);
    }
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
    if (phase === BARBA_PHASE.wall0 || phase === BARBA_PHASE.wall2 || phase === BARBA_PHASE.arc0 || phase === BARBA_PHASE.arc2) this.flags &= ~4;
    if (phase === BARBA_PHASE.arc0 || phase === BARBA_PHASE.arc2) this.side = this.variant;
    // Event 5 of 0x0d (asm: 0x6c8 = 1, the gate block cleared).
    if (phase === BARBA_PHASE.drop) {
      this.tFrom = 1;
      this.flags &= ~4;
    }
    // Event 5 of 0x11 / 0x12 clears the gate block (asm: 0x630 &= ~4).
    if (isJumpPhase(phase)) this.flags &= ~4;
    if (isBarbaTransition(phase)) this.leaveTransition();
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
    this.warps++; // a jump from wherever the body was (the smooth renderer must not slide)
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

  // Phase 4 / 0xa enter (0x004b0ee0, event 4; the dispatch passes (0, 2) and (2, 0)): the body moves to anchor `side`, dir
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
    this.arcStarted = false;
  }

  // 0x004b1e98 enter (event 4, from / to are the dispatch's two anchors). The body goes to
  // anchor `from` (ProcessPlayerAction4: lift and heading zeroed, a warp), then each axis
  // is an easing from that anchor toward `to`, signed by the direction of the move. The
  // curve's max and accel depend on `to` (< 5: the low curve) and on the z sign.
  private enterTransition(from: number, to: number): void {
    this.flags = (this.flags & ~4) | 0x100; // gate open (0x630: bit 2 cleared, bit 8 set)
    this.tFrom = from;
    this.tTo = to;
    this.teleport(from);
    this.tBaseX = this.x;
    this.tBaseY = this.y;
    this.tBaseZ = this.z;
    const a = BARBA_ANCHORS[from]!;
    const b = BARBA_ANCHORS[to]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    this.sgnX = Math.sign(dx);
    this.sgnY = Math.sign(dy);
    this.sgnZ = Math.sign(dz);
    const low = to < BARBA_TRANSITION.near;
    // x and y: max 3 / accel 0.08 (to < 5) or 6 / 0.16. Same curve for both axes.
    const maxXY = low ? 3 : 6;
    const rateXY = low ? 0.08 : 0.16;
    this.ex.initSym(maxXY, Math.abs(dx), rateXY); // 0x638: 00434afc
    this.ey.initSym(maxXY, Math.abs(dy), rateXY); // 0x658: 00434afc
    // z: the z-down side (sign <= 0) uses 7 / 0.2 (low) or 14 / 0.4 with decel 0.05 (the
    // ac4 call); the other side 5 / 0.08 or 10 / 0.16 (the afc call).
    if (this.sgnZ <= 0) {
      this.ez.init(low ? 7 : 14, Math.abs(dz), low ? 0.2 : 0.4, 0.05); // 0x678: 00434ac4
    } else {
      this.ez.initSym(low ? 5 : 10, Math.abs(dz), low ? 0.08 : 0.16); // 0x678: 00434afc
    }
    this.moveSub = 0;
    this.tDone = 0;
    this.tA = this.sgnZ === 0 ? 1 : 0;
    if (this.sgnZ <= 0) this.tB = this.sgnX === 0 ? 2 : 0;
    else this.tB = this.sgnX === 0 ? 3 : 1;
    if (this.sgnY === 0) {
      // Sub-state by the anchors: the approach (0), the x-first (1, 2) or the z-first (3).
      if (from === 1 || from === 6) this.tSub = 2;
      else if (from === 3 || from === 8) this.tSub = 0;
      else if (to === 1 || to === 6) this.tSub = 1;
      else this.tSub = 3;
    } else {
      // A climb or a drop: sub 4 waits for all three easings, and the volopt flag (0x400)
      // and its sound follow the direction (ASSUMED: the flag's pillar objects are not drawn).
      this.tSub = 4;
      if (this.sgnY > 0) {
        this.flags &= ~0x400;
        this.events.push({ kind: 'se', id: 0x3e9 });
      } else {
        this.flags |= 0x400;
        this.events.push({ kind: 'se', id: 1000 });
      }
    }
  }

  // The transition's frame (event 0): the sub-state, then the body is each axis's
  // easing output, signed, from the start. The done flag (0x730 = 1) is the leader's cue
  // for the next table step (event 9).
  private transitionFrame(): void {
    this.animateClock(); // asm 0x004b1e98 event 0 runs Player__Animate first (PROVEN); no clock threshold
    let done = false;
    switch (this.tSub) {
      case 0:
        done = this.approachStep();
        break;
      case 1:
        done = this.xFirstStep();
        break;
      case 2:
        done = this.xThenZStep();
        break;
      case 3:
        done = this.zFirstStep();
        break;
      case 4:
        done = this.settleStep();
        break;
      default:
        break;
    }
    if (done) this.moveSub = 1;
    this.x = this.ex.pos * this.sgnX + this.tBaseX;
    this.y = this.ey.pos * this.sgnY + this.tBaseY;
    this.z = this.ez.pos * this.sgnZ + this.tBaseZ;
  }

  private bumpWait(): void {
    const w = this.tWait + BARBA_TRANSITION.tickWait;
    this.tWait = w < BARBA_TRANSITION.doneWait ? w : BARBA_TRANSITION.doneWait;
  }

  // Sub 0 (ProcessPlayerApproachPhase): x and y ease; z runs on its own velocity (state 1,
  // clamped to -4 a tick and the step 0.1) until x passes 30, then z eases (state 3).
  private approachStep(): boolean {
    this.ex.tick();
    if (this.ey.tick() === 3) this.tDone = 1;
    let st = this.tB;
    if (st === 1) {
      let vz = this.ez.v - BARBA_TRANSITION.zVelStep;
      if (vz < -BARBA_TRANSITION.zVelClamp) vz = -BARBA_TRANSITION.zVelClamp;
      this.ez.v = vz;
      this.ez.pos += vz;
      if (BARBA_TRANSITION.approachX < this.ex.pos) st = 3;
    } else if (st === 3) {
      if (this.ez.tick() === 3) st = 4;
    }
    this.tB = st;
    this.bumpWait();
    return st === 4 && this.tDone === 1;
  }

  // Sub 1 (ProcessSinowberillMovementState_004b2b14): z eases; x follows once z passed 380.
  private xFirstStep(): boolean {
    this.ez.tick();
    if (this.ey.tick() === 3) this.tDone = 1;
    let st = this.tA;
    if (st === 0) {
      if (BARBA_TRANSITION.wait1 < this.ez.pos) st = 1;
    } else if (st === 1) {
      if (this.ex.tick() === 3) st = 2;
    }
    this.tA = st;
    this.bumpWait();
    return st === 2 && this.tDone === 1;
  }

  // Sub 2 (ProcessSinowberillMovementState_004b2a24): x eases; z starts once x passes 160,
  // and runs its own easing from the wait (0.3), then sub 4's gate.
  private xThenZStep(): boolean {
    this.ex.tick();
    if (this.ey.tick() === 3) this.tDone = 1;
    let st = this.tB;
    if (st === 0) {
      if (BARBA_TRANSITION.wait2 < this.ex.pos) st = 2;
    } else if (st === 2) {
      this.tWait = BARBA_TRANSITION.waitDown; // 0xc8 = 0.3 (0x3e99999a)
      st = 3;
    } else if (st === 3) {
      if (this.ez.tick() === 3) st = 4;
      if (BARBA_TRANSITION.wait2z < this.ez.pos) this.bumpWait();
    }
    this.tB = st;
    return st === 4 && this.tDone === 1;
  }

  // Sub 3 (ProcessSinowberillMovementState_004b2954): z eases first; x follows once z
  // passes 100; the wait saturates at 0.9 while z is past 100.
  private zFirstStep(): boolean {
    this.ez.tick();
    if (this.ey.tick() === 3) this.tDone = 1;
    let st = this.tA;
    if (st === 0) {
      this.tWait = BARBA_TRANSITION.waitDown;
      if (BARBA_TRANSITION.wait3 < this.ez.pos) st = 1;
    } else if (st === 1) {
      if (this.ex.tick() === 3) st = 2;
    }
    this.tA = st;
    if (BARBA_TRANSITION.wait3 < this.ez.pos) this.tWait = BARBA_TRANSITION.doneWait;
    return st === 2 && this.tDone === 1;
  }

  // Sub 4 (the event 0 case 4): all three easings done and the wait past 0.9 (0.1 a tick).
  // While not all are done, a descent (sign y < 0) holds the wait at 0.3.
  private settleStep(): boolean {
    const sz = this.ez.tick();
    const sx = this.ex.tick();
    const sy = this.ey.tick();
    if (sz === 3 && sx === 3 && sy === 3) {
      this.tWait += BARBA_TRANSITION.tickWait;
      return BARBA_TRANSITION.doneWait < this.tWait;
    }
    if (this.sgnY < 0) this.tWait = BARBA_TRANSITION.waitDown;
    return false;
  }

  // Event 5 of 0x004b1e98 (the leave): the anchor the body reached is the current one.
  private leaveTransition(): void {
    this.tFrom = this.tTo;
  }

  // 0x004b4684 enter (event 4, phases 0x19 and 0x1a): the gate open (0x630: bit 2 cleared, bit 8
  // set), slot 0xe (set by slotOnEnter), the body to anchor 3 (ProcessPlayerAction4).
  private enterShot(): void {
    this.flags = (this.flags & ~4) | 0x100;
    this.tFrom = 3;
    this.teleport(3);
  }

  // Event 0 of 0x19 / 0x1a (asm 0x004b4684): Player__Animate, then the shot's sound (0x3ed) when the
  // clock passes 8.0 (check_entity_animation_elapsed_threshold, PROVEN). The beam_c blend starts the
  // clock from 0, so the sound is about 20 ticks after the enter (stride 0.4).
  private shotFrame(): void {
    this.animateClock();
    if (this.crossed(8)) this.events.push({ kind: 'se', id: BARBA_SE.pigShot });
  }

  // 0x004b6d08 enter (event 4): the gate open (0x630: bit 2 cleared, bit 8 set), the body to
  // anchor 3 (ProcessPlayerAction4), slot 0xc (beam_a, set by slotOnEnter), the counter 730 = 0.
  private enterBeam(): void {
    this.flags = (this.flags & ~4) | 0x100;
    this.tFrom = 3;
    this.teleport(3);
    this.moveSub = 0;
  }

  // Event 0 of 0x17 (asm 0x004b6d08): the counter (730) counts the frames; at timers 10..14 with
  // the counter at 3 or more the counter restarts and the attack object (UpdateSinowberillAttackPos3,
  // 0x201, at (x + 30 r, -5, z + 80)) is made. ASSUMED: the attack object is not spawned and its
  // random draw is not taken. The beam sound (0x3ec) at the clock's crossing of 10.0 (PROVEN:
  // FUN_007aaa30 is check_entity_animation_elapsed_threshold). Player__Animate runs first (PROVEN).
  private beamFrame(): void {
    this.animateClock();
    this.moveSub += 1;
    if (this.timer >= 10 && this.timer <= 14 && this.moveSub >= 3) {
      this.moveSub = 0;
      // ASSUMED: the attack object is not made (see above).
    }
    if (this.crossed(10)) this.events.push({ kind: 'se', id: BARBA_SE.beamFlash });
  }

  // 0x004b2cd0 enter (event 4, side = 0 for 0x0f, 2 for 0x10): the gate block and 0x100 cleared,
  // 0x6c8 = side and the body to that anchor (ProcessPlayerAction4), f74c = -1000, the sweep at
  // point 0, and the volopt kind cycles 0, 1, 2 (+0x70c).
  private enterVolopt(side: number): void {
    this.flags &= ~0x104;
    this.tFrom = side;
    this.teleport(side);
    this.f74c = -1000; // 0xc47a0000
    this.moveSub = 0;
    this.voloptSub = 0;
    this.voloptKind = this.voloptKind < 2 ? this.voloptKind + 1 : 0;
  }

  // Event 0 of 0x0f / 0x10 (asm 0x004b2cd0). Sub 0 places point 0 (UpdateVoloptInteractionPoint)
  // and goes to sub 1; sub 1 places the next point each time row i's y is below row i + 1's y
  // (the part rows, root+0x538), and sub 2 once the index reaches 4 (0x906ee4). ASSUMED: the
  // animation hold (0xb0 bit 4) is clear. The point's visual is not drawn (the sub-entity).
  private voloptFrame(): void {
    this.animateClock(); // asm 0x004b2cd0 event 0 runs Player__Animate (PROVEN); no clock threshold
    if (this.voloptSub === 0) {
      this.updateVolopt();
      this.voloptSub = 1;
    } else if (this.voloptSub === 1) {
      const i = this.moveSub;
      if (this.rows[i]![1] < this.rows[i + 1]![1]) {
        this.moveSub = i + 1;
        if (this.moveSub >= 4) this.voloptSub = 2;
        this.updateVolopt();
      }
    }
  }

  // UpdateVoloptInteractionPoint (asm 0x004b2cd0's helper): the point's sound at row i. The
  // sub-entity (the drawn point, the angle from i) is ASSUMED not drawn.
  private updateVolopt(): void {
    this.events.push({ kind: 'se', id: BARBA_SE.volopt });
  }

  // 0x004b7040 enter (event 4): the gate block set and 0x100 cleared, the body to anchor 3
  // (ProcessPlayerAction4 writes 0x6c8 = 3), the movement words zeroed.
  private enterDrop(): void {
    this.flags = (this.flags & ~0x100) | 4;
    this.tFrom = 3;
    this.teleport(3);
    this.moveSub = 0;
    this.moveCounter = 0;
    this.dropSub = 0;
    this.dropCount = 0;
    this.f74c = 0;
    this.f750 = 0;
    this.f754 = 0;
    this.f758 = 0;
    // The enter writes no +0xc0 (PROVEN: no store in 0x004b7040 event 4); the stride carry is slot 1's
    // (ASSUMED, see BARBA_DROP.fallStride). The clock's phase is the loop's (not traced): the blend's
    // wrap at sub 0 -> 1 resets it, so the phase does not matter.
    this.animStride = BARBA_DROP.fallStride;
  }

  // The animation clock (+0xc0 = current_animation_elapsed, +0xc8 = animation_frame_stride; PROVEN).
  // Player__Animate (refsrc Psobb.exe-05112026.c line 791218; objdump 0x007aa094) runs at the top of
  // event 0 of every state the exe runs it in, whether or not the state reads the clock: the idle (0),
  // the drop, the jump, the shot, the beam, the arc, the finale, the volopt, the followers, the swim and
  // the corner transitions. The timed attack (0x1b) and the dead (0x1d) do not. Its steps, in order:
  //   1. +0xc0 += +0xc8 (animStride);
  //   2. the id check (+0xb8 != +0xba, CheckAnimationId 0x007a9970): StartNpc (0x007a9a6c) starts a
  //      BLEND (+0xb0 |= 6, type 4) when the row flags allow it (PROVEN: the new row's 0x80000000 and
  //      the old row's 0x40000000 are clear, which holds for every slot but 0, whose flags are
  //      0xc0000000; the +0xb0 & 0x81 test is ASSUMED clear). The else branch leaves +0xc0 and +0xc8;
  //   3. type 4 (0x007aa369): when 1.0 <= +0xc0 (0x97d97c), +0xc0 = 0 (0x97d978), +0xc8 = the speed of
  //      the row now playing (table 0x009aba20, BARBA_SLOTS), +0xb0 &= ~4 (the blend's wait ends).
  // The mode 1 loop wrap, the mode 2 chain and the mode 3 hold are not here: the chain is the
  // renderer's animationEnded (tick), and no threshold these states read on the clock is past a loop
  // wrap, chain or hold (the njm frame counts, map Pass 14). The slot change is the caller's setSlot.
  private animateClock(): void {
    this.timer += this.animStride;
    if (this.slot !== this.startedSlot) {
      if (this.startedSlot !== 0 && this.slot !== 0) this.blendOn = true;
      this.startedSlot = this.slot;
    }
    if (this.blendOn && this.timer >= 1.0) {
      this.timer = 0;
      this.animStride = BARBA_SLOTS[this.slot]?.speed ?? this.animStride;
      this.blendOn = false;
    }
  }

  // check_entity_animation_elapsed_threshold (0x007aaa30 = refsrc line 791545, PROVEN): true on the
  // frame the clock passes `th` (th < +0xc0 <= th + stride), with no blend pending and no id change.
  private crossed(th: number): boolean {
    return !this.blendOn && this.slot === this.startedSlot && th < this.timer && this.timer <= this.animStride + th;
  }

  // Event 0 of 0x0d (asm 0x004b7040 param 0): Player__Animate first, then the sub-states.
  private dropFrame(): void {
    this.animateClock();
    if (this.moveSub === 0) {
      // The fall: 21 ticks, the speed drops 0.2 a tick to -7 and z follows it.
      this.moveCounter += 1;
      if (this.moveCounter > BARBA_DROP.fallWait) {
        this.moveSub = 1;
        this.setSlot(4); // the id change: the next Player__Animate starts the blend (sub 1 waits for it)
      }
      this.f754 = Math.max(this.f754 - BARBA_DROP.vyStep, BARBA_DROP.vyMin);
      this.z += this.f754;
      return;
    }
    if (this.moveSub === 1) {
      // asm 0x004b7040 sub 1: 0xb0 bit 4 (the blend's flag) clear -> sub 2 (the wrap ends the blend).
      if (!this.blendOn) this.moveSub = 2;
      return;
    }
    if (this.moveSub !== 2) return; // 3: done (the leader's table step)
    this.dropTimers();
    this.dropCounters();
    // ASSUMED: the sounds (0x3ec / 0x3ed by check_entity_animation_elapsed_threshold) and
    // ProcessAnimationPhase are not ported.
    this.dropMotion();
  }

  // The 0x730 == 2 sub-states (0x734) by the timer (asm 0x004b7040, the ladder after the fall).
  private dropTimers(): void {
    const { attackA: A, attackB: B } = BARBA_DROP;
    const t = this.timer;
    switch (this.dropSub) {
      case 0:
        if (BARBA_DROP.wait0 <= t) {
          // The lift's speed for the rise: ((A + B) * -vy + (300 - z)) / ((0.5 A + B) A).
          this.f758 = ((A + B) * -this.f754 + (BARBA_DROP.z0 - this.z)) / ((0.5 * A + B) * A);
          this.dropSub = 1;
          this.dropCount = 0;
        }
        break;
      case 1:
        if (BARBA_DROP.wait1 <= t) {
          const f = ((40 - this.y) * 4.0) / B;
          this.dropSub = 2;
          this.f74c = f;
          this.f750 = (f * 2.0) / B;
          this.dropCount = 0;
        }
        break;
      case 2:
        if (BARBA_DROP.wait2 <= t) {
          this.f754 *= 0.5;
          this.dropSub = 3;
          this.f758 = 0;
        }
        break;
      case 3:
        if (BARBA_DROP.wait3 <= t) this.dropSub = 4;
        break;
      default:
        break;
    }
  }

  // The 0x734 counters of the attack objects (asm 0x004b7040, the two branches before the
  // motion). The attack itself (UpdateSinowberillAttackPos3, object 0x201) is ASSUMED not
  // spawned and its random draw is not taken.
  private dropCounters(): void {
    if (this.dropSub === 1) {
      this.dropCount += 1;
      if (this.timer >= 13.5 && this.dropCount >= 2) this.dropCount = 0; // 0x906cd8
    } else if (this.dropSub === 2 || this.dropSub === 3) {
      this.dropCount += 1;
      if (this.dropCount >= 2 && this.timer >= BARBA_DROP.attackLo && this.timer <= BARBA_DROP.attackHi) this.dropCount = 0;
    }
  }

  // The body's motion by 0x734 (asm 0x004b7040, after the ladder; fVar6 is 0.3 and fVar3 0.0 here).
  private dropMotion(): void {
    switch (this.dropSub) {
      case 0: {
        this.f754 = Math.max(this.f754 - BARBA_DROP.vyStep, BARBA_DROP.vyMin);
        this.z += this.f754;
        break;
      }
      case 1:
        this.f754 += this.f758;
        this.z += this.f754;
        this.f74c = this.y; // ASSUMED: GetPlayerLocalY (the model's node height) is the body's y
        break;
      case 2:
        this.z += this.f754;
        this.lift += this.f74c;
        this.f74c -= this.f750;
        this.timer -= 0.3 - BARBA_DROP.liftZero; // 0x906cc8 minus a47aa0
        break;
      default:
        // Sub 3 / 4: the rise by the z easing once its speed is positive (f758 > 0), else the
        // speed falls until it reaches 0 and the easing takes over (ez: 7 / 0.2 / 0.05).
        if (this.f758 > 0) {
          if (this.ez.tick() === 3) this.moveSub = 3;
          else this.z = this.f754 - this.ez.pos;
        } else {
          this.f754 -= BARBA_DROP.vyStep;
          if (this.f754 <= 0) {
            this.f758 = 1;
            this.ez.init(BARBA_DROP.zMaxRise, Math.abs(BARBA_DROP.zTarget - this.z), BARBA_DROP.zAccel, BARBA_DROP.zDecel);
            this.f754 = this.z;
          } else {
            this.z += this.f754;
          }
        }
        break;
    }
  }

  // Event 0 of 0x13 / 0x14 (asm 0x004b3d3a): the wait, then one follower target every
  // 180 ticks (the random point or the player), then the wait for the arrivals.
  private followerFrame(targets: readonly AiTarget[]): void {
    this.animateClock(); // asm 0x004b3c2c event 0 (PROVEN); no clock threshold in the followers
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
    this.animateClock(); // asm 0x004b41ac event 0 (PROVEN); no clock threshold in the swim
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

  // Event 0 of 0x0ee0 (asm 0x004b0ee0): sub-state 0 waits for the blend into the arc's motion (slot 5 /
  // 6) to wrap, then the arc sub-states 0..6 by the clock marks (+0xc0: 10 / 20 / 28 / 45 / 46 / 64).
  private arcFrame(): void {
    this.animateClock(); // Player__Animate in sub 0 and sub 1 (PROVEN)
    if (this.moveSub === 0) {
      // sub 0 waits for the blend's wrap (+0xb0 bit 4 clear, PROVEN), then sub 1 on the same tick.
      if (!this.blendOn) this.moveSub = 1;
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
          // 0x004b0ee0 sub 3 (refsrc Psobb.exe-05112026.c:233873): 00434ac4(max 7.0, dist |25 - z|, accel 0.2, decel 0.05).
          this.arcEase.init(7, Math.abs(25 - this.z), 0.2, 0.05);
          this.arcStarted = true;
          this.f758 = this.z;
        }
        break;
      case 4:
        // 0x906fb8 = 46.0 (exedata; the older note said 70). Refsrc 233881.
        if (this.timer >= 46) {
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
        this.timer -= 0.5 - 0.3; // 0x906f68 - 0xa47a7c = 0.2 (sub 3's clock step, as the exe)
        this.lift += this.f750;
        this.f750 -= this.f754;
        this.z += this.f758;
        break;
      case 4:
      case 5:
        this.x += this.f75c;
        this.pullLift();
        this.arcStep();
        this.z = this.f758 - this.arcEase.pos;
        break;
      case 6: {
        this.pullLift();
        const st = this.arcStep();
        if (st === 3) this.moveSub = 2; // FUN_0042cdc0 returns 3: done, the table goes on
        this.z = this.f758 - this.arcEase.pos;
        if (this.slot === 1) this.flags |= 0x100;
        break;
      }
      default:
        break;
    }
  }

  // One tick of the arc's easing (ASSUMED: FUN_0042cdc0 is this record's tick, returns 3 when done).
  private arcStep(): number {
    return this.arcEase.tick();
  }

  // Event 0 of 0x1c (the frame): the cut timers (FUN_007aaa30 is a timer
  // crossing; the marks are decoded), and the kill request (ASSUMED: set as
  // soon as the cut starts, the map's pass 4 note on FUN_004d6864).
  private finaleFrame(): void {
    this.animateClock(); // Player__Animate first (PROVEN, asm 0x004b5d1c event 0)
    this.killReady = 1; // ASSUMED (see above)
    if (this.crossed(FINALE_MARKS.cut)) {
      this.events.push({ kind: 'effect', id: BARBA_FX.finaleCut, part: null }, { kind: 'se', id: BARBA_SE.finaleCut });
    }
    if (this.crossed(FINALE_MARKS.effect)) this.events.push({ kind: 'effect', id: BARBA_FX.finaleTwenty, part: null });
    if (this.crossed(FINALE_MARKS.late)) this.events.push({ kind: 'effect', id: BARBA_FX.finaleLate, part: null }); // FUN_004b60a0 (effect id ASSUMED)
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

  // Whether the sequenced phase has reached its done state (the leader's table step, event 9):
  // transitions at 0x730 == 1, the drop at 0x730 == 3, the volopt sweep at 0x734 == 2.
  private phaseDone(): boolean {
    if (this.phase === BARBA_PHASE.drop) return this.moveSub === 3;
    if (isVoloptPhase(this.phase)) return this.voloptSub === 2;
    // The beam (0x17): event 9 steps once the beam_a motion has chained into beamwait (slot 15).
    if (this.phase === BARBA_PHASE.beam) return this.slot === 15;
    // The shot (0x19 / 0x1a): event 9 steps at slot 1 (the beam_c motion chained into idle).
    if (isShotPhase(this.phase)) return this.slot === 1;
    return this.moveSub === 1;
  }

  // The state's own frame (event 0). Decoded: 0x1c, 0x1d, 0x1b, the spawner, and the
  // movement of 0x13 / 0x14, 0x15 / 0x16, 0x4 / 0xa (the arc) and the corner transitions.
  private stateFrame(targets: readonly AiTarget[]): void {
    if (isBarbaTransition(this.phase)) {
      this.transitionFrame();
      return;
    }
    if (isJumpPhase(this.phase)) {
      this.jumpFrame();
      return;
    }
    switch (this.phase) {
      case BARBA_PHASE.idle:
        this.animateClock(); // 0x004b9e54 event 0 is Player__Animate and nothing else (PROVEN)
        return;
      case BARBA_PHASE.finale:
        this.finaleFrame();
        return;
      case BARBA_PHASE.drop:
        this.dropFrame();
        return;
      case BARBA_PHASE.volopt0:
      case BARBA_PHASE.volopt2:
        this.voloptFrame();
        return;
      case BARBA_PHASE.beam:
        this.beamFrame();
        return;
      case BARBA_PHASE.shot0:
      case BARBA_PHASE.shot2:
        this.shotFrame();
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
      case BARBA_PHASE.arc0:
      case BARBA_PHASE.arc2:
        this.arcFrame();
        return;
      default:
        if (this.phase >= BARBA_PHASE.spawn0 && this.phase <= BARBA_PHASE.spawn2) this.spawnFrame();
    }
  }

  // --- phases 0x11 / 0x12 (0x004b30fc, see BARBA_JUMP) ----------------------------------------

  // Event 0 (the frame). Player__Animate runs first (PROVEN, asm 0x004b30fc event 0 at 235288); the
  // clock then reads the sub-state marks. The windup's slot change (7 / 8) is a blend: the clock
  // restarts at its wrap on the next tick (no write here, PROVEN), so sub 1 lasts that one tick.
  // The sub transition runs first, then the sounds and the motion of the post-transition sub.
  private jumpFrame(): void {
    const J = BARBA_JUMP;
    this.animateClock();
    const t = this.timer;
    switch (this.moveSub) {
      case 0: {
        const n = this.moveCounter + 1;
        if (n < J.windup) {
          this.moveCounter = n;
          break;
        }
        const side0 = this.tFrom === 0;
        this.moveCounter = 0;
        this.moveSub = 1;
        this.f74c = side0 ? -1 : 1;
        this.setSlot(side0 ? 7 : 8);
        break;
      }
      case 1:
        // asm 0x004b30fc sub 1: 0xb0 bit 4 (the blend's wait) clear -> sub 2 (PROVEN; the wrap ends it).
        if (!this.blendOn) this.moveSub = 2;
        break;
      case 2:
        if (t >= J.t2) this.jumpTakeoff();
        break;
      case 3:
        if (t >= J.t3) this.jumpApex();
        break;
      case 4:
        if (t >= J.t4) this.jumpDescent();
        break;
      case 5:
        if (t >= J.t5) this.jumpLand();
        break;
      default:
        break;
    }
    // The 15.0 mark of the air (sub 2 and on) plays 0x3ec (check_entity_animation_elapsed_threshold, PROVEN).
    if (this.moveSub >= 2 && this.crossed(J.seAirMark)) this.events.push({ kind: 'se', id: J.seAir });
    // The motion of the post-transition sub: sub 0..2 the z fall, 3 the take-off arc, 4 the apex,
    // 5 the descent with the yaw; 6 is the landing (no motion).
    const s = this.moveSub;
    if (s < 3) {
      let vz = this.f760 + this.f75c;
      if (vz >= J.vzFloor) {
        this.f760 = vz;
      } else {
        this.f760 = J.vzFloor;
        vz = J.vzFloor;
      }
      this.z += vz;
    } else if (s === 3) {
      const u = t - J.t2;
      this.x = this.f754 * u + this.f750;
      this.z = (J.half * this.f75c * u - J.zTerm) * u + this.f764;
      if (this.crossed(J.seFallMark)) this.events.push({ kind: 'se', id: J.seJump });
    } else if (s === 4) {
      const u = t - J.t3;
      this.z = J.half * this.f75c * u * u + this.f764;
      this.x = this.f754 * u + this.f750;
      this.lift = Math.min(J.liftK * u, J.liftCap);
    } else if (s === 5) {
      const u = t - J.t4;
      const v = t - J.t3;
      this.z = v * J.half * this.f75c * v + this.f764;
      this.x = this.f754 * u + this.f750;
      this.yaw = Math.round(u * this.f768);
    }
  }

  // Sub 2 -> 3 (the clock at 6.0): x runs from the body to 100 * dir over divD frames, the z accel is
  // the windup's velocity over -divD, and the z start is the body's z.
  private jumpTakeoff(): void {
    const J = BARBA_JUMP;
    const target = J.xStart * this.f74c;
    this.moveSub = 3;
    this.f750 = this.x;
    this.f758 = 0;
    this.f754 = (target - this.x) / J.divD;
    this.f764 = this.z;
    this.f75c = this.f760 / -J.divD;
    this.f760 = 0;
  }

  // Sub 3 -> 4 (the clock at 13.0): x to 135 * dir over divB frames (from 100 * dir), the z accel
  // (zTop - z) * zGain / divC^2.
  private jumpApex(): void {
    const J = BARBA_JUMP;
    const x0 = J.xStart * this.f74c;
    this.moveSub = 4;
    this.f750 = x0;
    this.f758 = 0;
    this.f754 = (J.xMid * this.f74c - x0) / J.divB;
    this.f764 = this.z;
    this.f75c = ((J.zTop - this.z) * J.zGain) / (J.divC * J.divC);
    this.f760 = 0;
  }

  // Sub 4 -> 5 (the clock at 20.0): x from 135 * dir to 100 * dir over divA frames, the yaw speed
  // -1280 * dir / divA a tick.
  private jumpDescent(): void {
    const J = BARBA_JUMP;
    const x0 = J.xMid * this.f74c;
    this.moveSub = 5;
    this.f750 = x0;
    this.f758 = 0;
    this.f754 = (J.xEnd * this.f74c - x0) / J.divA;
    this.f768 = (-J.yawSpeed * this.f74c) / J.divA;
  }

  // Sub 5 -> 6 (the clock at 25.0): the landing. The sound and the 0x200 flag are ported; the camera
  // shake, the crate flags, the Galgryphon minion (CreateGalgryphonMinionEntity) and the four
  // volopt frictions (0x6e4..) are not (ASSUMED no effect here).
  private jumpLand(): void {
    this.moveSub = 6;
    this.events.push({ kind: 'se', id: BARBA_JUMP.seLand });
    this.flags |= 0x200;
  }

  // Event 2 (the keyboard): the held Left (g_KeyboardSharedState[0xe]) sends the followers, 0x13 /
  // 0x14 (6xAA); else the held Right (index 0xc, ASSUMED) sends the swim, 0x15 / 0x16 (6xA9).
  // The side is the enter's (0x6c8 == 0 picks the first of each pair).
  private jumpInput(input: BarbaInput): void {
    const side0 = this.tFrom === 0;
    if (input.left) this.sendPhase(side0 ? 0x13 : 0x14);
    else if (input.right) this.sendPhase(side0 ? 0x15 : 0x16);
  }

  // The leader's step of 0x11 / 0x12. With the keyboard (`input`, the mode-2 poll, ASSUMED) the
  // keys decide. Without it, event 9 steps the table once the bite chain reaches its loop (slot 9 /
  // 10, the r_bite / l_bite chains; ASSUMED mode 0).
  private jumpLeader(): void {
    if (this.input) {
      this.jumpInput(this.input);
      return;
    }
    if (this.slot === 9 || this.slot === 10) this.tableLoop();
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
      } else if (isSequenced(this.phase)) {
        // Event 9 of 0x004b1e98 (0x730 == 1, the transition is done): the next table step at
        // once, not paced (ASSUMED: the gate's 0x1b is not sent during a transition). With the
        // gate closed the step waits BARBA_DWELL ticks, as the other undecoded waits do.
        // Event 9 of 0x0d is the same step at 0x730 == 3 (the drop is done).
        if (this.phaseDone()) {
          if (this.gateOpen) {
            this.tableLoop();
          } else {
            this.dwell++;
            if (this.dwell >= BARBA_DWELL) {
              this.dwell = 0;
              this.tableLoop();
            }
          }
        } else if (isMotionPhase(this.phase)) {
          // The sweep waits for the part rows to rise (the renderer's positions), the beam for
          // its motion chain (slot 15). ASSUMED: one that does not advance (flat rows, no model,
          // no motion end) falls back to the dwell, so the brain never hangs.
          this.dwell++;
          if (this.dwell >= BARBA_DWELL) {
            this.dwell = 0;
            this.tableLoop();
          }
        }
      } else if (isJumpPhase(this.phase)) {
        this.jumpLeader();
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
    return (
      this.phase === BARBA_PHASE.timed ||
      this.phase === BARBA_PHASE.finale ||
      this.phase === BARBA_PHASE.dead ||
      isSequenced(this.phase) ||
      (this.phase >= BARBA_PHASE.spawn0 && this.phase <= BARBA_PHASE.spawn2)
    );
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
