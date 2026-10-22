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
import type { AiFrame, AiTarget, EnemyBrain } from './enemyai.ts';
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
  | { kind: 'spawn'; group: number; index: number }
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
      case 3:
      case 5:
      case 6:
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

  // FUN_004b1e58(i): the body moves to anchor i.
  teleport(i: number): void {
    const a = BARBA_ANCHORS[i];
    if (!a) return;
    this.x = a[0];
    this.z = a[2];
    this.warps++;
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
        this.events.push({ kind: 'spawn', group: this.phase - BARBA_PHASE.spawn0, index: this.spawned });
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

  // The state's own frame (event 0). Decoded: 0x1c, 0x1d, 0x1b, the spawner.
  private stateFrame(): void {
    switch (this.phase) {
      case BARBA_PHASE.finale:
        this.finaleFrame();
        return;
      case BARBA_PHASE.timed:
        this.timedFrame();
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
    void targets;
    const frame = this.out;
    frame.motion = null;
    if (this.dead) return this.finish(frame);
    const before = this.current;
    this.stateFrame();
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
