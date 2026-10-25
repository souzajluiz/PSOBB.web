// Episode 4 Merissa A / AA (set type 0x112; the variant is +0x380 = set param6 & 1; PsoBB.exe
// 1.25.13, addresses are VAs). The state rows, the transition, the row handlers, the hooks, the
// record table and the death / vanish path are decoded from objdump (see the DEVLOG entry
// "Merissa A / AA, part 4"). Each rule carries its address; ASSUMED marks what is not traced.
// The port brain (OWN_FSM 'MerissaA') runs the exe's states in the exe's order.
//
// Field offsets are the enemy's: +0x32e AI state (short), +0x332 previous state, +0xb8 motion
// index (short), +0xc0 animation elapsed (float, frames), +0xc4 animation frame count, +0xc8 frame
// stride, +0x2a4 target point, +0x37c state flags word, +0x3bc MovementData row (battleparams
// animation speeds), +0x3c0 attack record, +0x3c4 vanish countdown (float), +0x380 variant.
// The port keeps +0x37c as the exe writes it, and the radar follows bit 0x8.
//
// Frames: the exe's elapsed (+0xc0) advances by the stride every tick after the state handler
// has run. The port uses the same order: the handler sees `anim`, then `anim` advances by the
// played motion's speed (the motion table's speed, times the record scale for an attack, PROVEN
// as +0xd0 = speed * scale at 0x005b5294). ASSUMED: the stride is the table speed (the exe's
// MovementData override of the stride while engaged is not traced).

import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyAiMotion } from './enemyai.ts';
import type { EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, loop, nearest, once, turnToward } from './enemyfsm.ts';

// PROVEN: the vtable is 0x00b0b6a0 (written by the constructor at 0x005b6c32). Its +0 is
// 0x005b50fc (not traced), +4 is the update 0x005b66ec, +8 the lock-on render 0x005b6864.
// The death and hit entries are the vtable slots +0x104 (0x005b6a90) and +0x100 (0x005b69f4):
// the generic enemy update calls +0x104 when the enemy is dead and +0x100 when it took damage
// (the same shape as UpdateVoloptCore / UpdateDerolle, dump lines 182791..182800).
export const MERISSA_VTABLE_VA = 0x00b0b6a0;
export const MERISSA_UPDATE_VA = 0x005b66ec; // vtable +4
export const MERISSA_HIT_VA = 0x005b69f4; // vtable +0x100 (word at 0x00b0b7a0)
export const MERISSA_DEAD_VA = 0x005b6a90; // vtable +0x104 (word at 0x00b0b7a4)

// PROVEN: the update indexes the state table with the short at +0x32e: the row is
// 0x009c1a24 + state * 20 (objdump 0x005b670f..0x005b6726). The update calls the row's handler
// (+0) when it is not 0 and then, when +0x398 is not 0, the vtable +0x48 / +0x4c push (0x005b66ec).
export const MERISSA_STATE_TABLE_VA = 0x009c1a24;
export const MERISSA_STATE_ROW_BYTES = 20;

// PROVEN (the transition's writes at 0x005b5933..0x005b5967 read the row fields by these offsets):
//   +0x00 handler (the update calls it; 0 = no handler)
//   +0x04 flag argument of EnemySetStateFlag_005b5de0 (0 / 1 set +0x37c bit 0x1, 2 clears it)
//   +0x08 motion index, a short written to +0xb8 (-1 = none, the update skips the motion step)
//   +0x0c state mask, OR-ed into +0x37c after the clear
//   +0x10 hook, called with ecx = this on the transition. PROVEN: the hook that runs on the way
//         into state n is row n-1's (0x005b5963, 0x005b5bdd, 0x005b5db2, 0x005b5b5c path, 0x005b6ad8
//         path: 0x9c1a5c, 0x9c1a70, 0x9c1a34, 0x9c1a48, 0x9c1a98, 0x9c1a84 are the rows' +0x10).
export interface MerissaStateRow {
  state: number; // +0x32e value
  handler: number; // VA of the per-state handler (0 = none)
  handlerName: string; // dump name, for the comments and tests
  flagArg: number; // +0x04
  motion: number; // +0x08 (-1 = no motion write)
  mask: number; // +0x0c
  hook: number; // +0x10 VA (0 = none)
}

// PROVEN: the table words (tools/exedata.py read 009c1a24 u 40). Row 7 is all zero.
export const MERISSA_STATE_ROWS: readonly MerissaStateRow[] = [
  { state: 0, handler: 0x005b53dc, handlerName: 'unnamed (0x005b53dc)', flagArg: 1, motion: 0, mask: 0x4, hook: 0x005b51dc },
  { state: 1, handler: 0x005b54cc, handlerName: 'unnamed (0x005b54cc)', flagArg: 2, motion: 1, mask: 0x0, hook: 0x005b51e8 },
  { state: 2, handler: 0x005b5618, handlerName: 'EnemyUpdateState0_005b5618', flagArg: 2, motion: 2, mask: 0x0, hook: 0x005b51f8 },
  { state: 3, handler: 0x005b5f3c, handlerName: 'EnemyProcessState_005b5f3c', flagArg: 0, motion: 6, mask: 0x2, hook: 0x005b5294 },
  { state: 4, handler: 0x005b61a0, handlerName: 'EnemyProcessState_005b61a0', flagArg: 2, motion: -1, mask: 0x2, hook: 0x005b5260 },
  { state: 5, handler: 0x005b6108, handlerName: 'EnemyResetState_005b6108', flagArg: 2, motion: 7, mask: 0x2, hook: 0x005b52ec },
  { state: 6, handler: 0x005b6328, handlerName: 'EnemyProcessSubEntitySpawn_005b6328', flagArg: 0, motion: -1, mask: 0x8, hook: 0 },
  { state: 7, handler: 0, handlerName: '(no handler)', flagArg: 0, motion: 0, mask: 0, hook: 0 },
];

// The row hooks, by the row that owns them (PROVEN, objdump):
//   row 0 0x005b51dc: +0x30 |= 0x40000 (the guard bit, runs on the way into state 1)
//   row 1 0x005b51e8: +0xb8 = 2 (the walk, runs on the way into state 2, and on every reset)
//   row 2 0x005b51f8: the lunge vector, 3d8 = |P - pos| / 21, 3d4 = y_rot (into state 3)
//   row 3 0x005b5294: the attack motion, +0xb8 = record kind, +0xd0 = speed * scale (into state 4)
//   row 4 0x005b5260: the hit sound and particle (into state 5)
//   row 5 0x005b52ec on_merissa_dead (into state 6)
// The state row for a +0x32e value, or null past the table. The update calls the handler only
// when it is not 0 (PROVEN, 0x005b6722).
export function merissaStateRow(state: number): MerissaStateRow | null {
  if (!Number.isInteger(state) || state < 0 || state >= MERISSA_STATE_ROWS.length) return null;
  return MERISSA_STATE_ROWS[state];
}

// --- +0x37c flags --------------------------------------------------------------------------
// PROVEN: the transition (0x005b5768 tails, 0x005b5b5c, 0x005b5d2d.., 0x005b6a90, 0x005b5de0) clears
// the bits 0x2, 0x4 and 0x8 (`andl $-0xf` = 0xfffffff1), then EnemySetStateFlag ORs or clears the
// bit 0x1 (flag 0 and 1 set it, flag 2 clears it: dump lines 401592..401610), then the row's mask
// is ORed in. The bit 0x10 (freeze) and 0x20 survive.
export const MERISSA_MASK_CLEAR = 0xfffffff1;

export function merissaMaskAfterTransition(mask37c: number, rowMask: number): number {
  return ((mask37c & MERISSA_MASK_CLEAR) | rowMask) >>> 0;
}

// A full row entry: the clear, the flag argument on bit 0x1, then the row's mask.
export function merissaFlagsAfterRow(mask37c: number, row: MerissaStateRow): number {
  let f = (mask37c & MERISSA_MASK_CLEAR) >>> 0;
  if (row.flagArg === 0 || row.flagArg === 1) f = (f | 1) >>> 0;
  else if (row.flagArg === 2) f = (f & 0xfffffffe) >>> 0;
  return (f | row.mask) >>> 0;
}

// --- Radar gate -----------------------------------------------------------------------------
// PROVEN: the update's icon call (unknown_add_minimap_icon 0xffffa24c, scale 1, at 0x005b67d3)
// is skipped when `testb $0x8, %dl` on +0x37c is set (0x005b67c1 / 0x005b67c4 `jne 0x5b67e1`).
export const MERISSA_RADAR_HIDE_BIT = 0x8;

// True when the plain radar icon is drawn for a Merissa whose +0x37c is `mask37c`.
export function merissaRadarIconShown(mask37c: number): boolean {
  return (mask37c & MERISSA_RADAR_HIDE_BIT) === 0;
}

// The rows whose mask has 0x8: row 6 only (PROVEN from the table).
export function merissaStatesWithRadarHide(): readonly number[] {
  return MERISSA_STATE_ROWS.filter((r) => (r.mask & MERISSA_RADAR_HIDE_BIT) !== 0).map((r) => r.state);
}

// --- Vanish sub-entity (state 6, EnemyProcessSubEntitySpawn_005b6328) -----------------------
// PROVEN arithmetic: while the motion's end flag (+0xb0 bit 0x10) is set, the countdown +0x3c4
// drops by 0.1f each handler call (constant 0x0092aff4 = 0.10000000149); when the result is below
// -15.0f (0x0092aff0) the entity's +0x08 bit 0x1 is set (the removal bit). The countdown starts at
// 0 in on_merissa_dead (0x005b52ec, `movl $0, 0x3c4` at its first line). The green pool
// (+0x37c bit 0x40, CreateEntity_00578538 at the origin with 0x32) is deathfx's, not here.
export const MERISSA_VANISH_STEP = Math.fround(0.1);
export const MERISSA_VANISH_LIMIT = -15;

export function merissaVanishStep(countdown: number): { countdown: number; removed: boolean } {
  const next = Math.fround(Math.fround(countdown) - MERISSA_VANISH_STEP);
  return { countdown: next, removed: next < MERISSA_VANISH_LIMIT };
}

// --- Attack records -------------------------------------------------------------------------
// PROVEN layout: the 40-byte records at 0x009c1ac0 + 40 * id, read by the transition
// 0x005b5768 (`leal 0x9c1ac0(%edi,%edi)` after the id * 20 steps at 0x005b59a8 / 0x005b5a64 /
// 0x005b5ae1). The initializer 0x005b6f2c writes the float words at run time (movl $imm at
// 0x005b6f4a..0x005b70a8). Re-checked for every record this session (0x9c1ac0 .. 0x9c1bcc):
//   +0x00 float: squared XZ range (1600 / 3600 / 10000, the initializer's 0x44c80000 etc.)
//   +0x04 int: angle limit in BAMS (65536 = 360 degrees): 1820 = 10 degrees, 8192 = 45, 10922 = 60.
//         The compared angle is integer_angle_abs_difference(target.y_rot, bearing target -> Merissa)
//         (0x005b5801 pushes the target's +0x60 and the reversed bearing; see merissaFacingDiff).
//   +0x0c int: the kind = the motion slot the attack plays (the row 3 hook 0x005b5294 writes
//         +0xb8 = kind). Kinds: 3 (records 0, 1, 6), 4 (2, 3), 5 (4, 5).
//   +0x10 float: the scale (1.0 for 0..5, 1.5 for the freeze record 6); +0xd0 = slot speed * scale.
//   +0x14 float: start (10.0, all records): the handler tracks the target before it.
//   +0x18 / +0x1c floats: window start and end (equal = a single crossing, see windowHit).
//   +0x24 int: the window callback VA, called with ecx = this.
export interface MerissaAttackRecord {
  id: number;
  rangeSq: number;
  angle: number;
  kind: number;
  scale: number;
  start: number;
  windowStart: number;
  windowEnd: number;
  callback: number;
  callbackName: string;
}

export const MERISSA_ATTACK_RECORD_BASE = 0x009c1ac0;
export const MERISSA_ATTACK_RECORD_BYTES = 40;

// Records 0 and 1 (the A stab of variants A and AA), 2 and 3 (B), 4 and 5 (C), 6 (the freeze stab).
// The callbacks: 0x005b6384 = merissa_stab_attack (dump line 401866: sfx, then the target's
// should_push_defender and try_hit); 0x005b64fc = EnemyProcessAttackWindow_005b64fc (dump 401540
// area); 0x005b667c (not named in the dump, the C window); 0x005b63e4 = unknown_merissa_freeze_stab_attack
// (dump line 401891: the facing arc 0x00772c08 and the freeze).
export const MERISSA_ATTACK_RECORDS: readonly MerissaAttackRecord[] = [
  { id: 0, rangeSq: 1600, angle: 1820, kind: 3, scale: 1, start: 10, windowStart: 28, windowEnd: 28, callback: 0x005b6384, callbackName: 'merissa_stab_attack' },
  { id: 1, rangeSq: 1600, angle: 1820, kind: 3, scale: 1, start: 10, windowStart: 28, windowEnd: 28, callback: 0x005b6384, callbackName: 'merissa_stab_attack' },
  { id: 2, rangeSq: 3600, angle: 8192, kind: 4, scale: 1, start: 10, windowStart: 6, windowEnd: 15, callback: 0x005b64fc, callbackName: 'EnemyProcessAttackWindow_005b64fc' },
  { id: 3, rangeSq: 3600, angle: 8192, kind: 4, scale: 1, start: 10, windowStart: 6, windowEnd: 15, callback: 0x005b64fc, callbackName: 'EnemyProcessAttackWindow_005b64fc' },
  { id: 4, rangeSq: 10000, angle: 10922, kind: 5, scale: 1, start: 10, windowStart: 16, windowEnd: 16, callback: 0x005b667c, callbackName: '(not named in the dump)' },
  { id: 5, rangeSq: 10000, angle: 10922, kind: 5, scale: 1, start: 10, windowStart: 16, windowEnd: 16, callback: 0x005b667c, callbackName: '(not named in the dump)' },
  { id: 6, rangeSq: 1600, angle: 1820, kind: 3, scale: 1.5, start: 10, windowStart: 28, windowEnd: 90, callback: 0x005b63e4, callbackName: 'unknown_merissa_freeze_stab_attack' },
];

// PROVEN: the record ids per variant from the table 0x009c1dbc + 20 * variant (the transition's
// `movl 0x9c1dbc(,%ebp,4)` with ebp = variant * 5): word 0 (A, the near stab, 0x005b599a),
// word 1 (B, 0x005b5a52), word 2 (C, 0x005b5acf).
export const MERISSA_ATTACK_SELECT: readonly { near: number; mid: number; far: number }[] = [
  { near: 0, mid: 2, far: 4 }, // variant 0 (A)
  { near: 1, mid: 3, far: 5 }, // variant 1 (AA)
];
export const MERISSA_FREEZE_RECORD = 6; // 0x009c1bb0, the record the A branch takes on a freeze roll
export const MERISSA_FREEZE_MASK = 0x10; // OR-ed into +0x37c on the freeze roll (0x005b5a34..0x005b5a3f)

export function merissaAttackRecord(id: number): MerissaAttackRecord | null {
  return MERISSA_ATTACK_RECORDS.find((r) => r.id === id) ?? null;
}

// PROVEN gate of one attack record: dist^2 below the record's range AND the angle below its
// limit (0x005b59af fcomps then 0x005b59ba cmpl; the same shape for B and C).
export function merissaInAttackRange(rec: MerissaAttackRecord, distSq: number, angle: number): boolean {
  return Math.fround(distSq) < rec.rangeSq && angle < rec.angle;
}

// PROVEN arithmetic of the rolls (0x005b5ae1..0x005b5b50, 0x005b59e1..0x005b5a32): the RNG value
// is read as unsigned (the sign fix adds 2^32 at 0x005b59e5..0x005b59ec), then floor(n * u / 2^32)
// with n = 3 (A and B) or 10 (C), truncated (fistpll with the chop control word 0xc00).
export function merissaRngBucket(u32: number, n: number): number {
  return Math.floor(((u32 >>> 0) * n) / 4294967296);
}

// The A (near) branch once the record gate passed: a target with flag 0x20 (its +0x30 word, the
// `andl $0x20` at 0x005b5974) takes the stab without a roll; otherwise a roll of 3 picks the
// freeze record 6 when it is 0 (1 in 3, with +0x37c |= 0x10), and the stab record otherwise.
// The A branch never fails once its gate passed (PROVEN: no failure path after the roll).
export function merissaPickNearAttack(variant: number, u32: number, targetFlag20: boolean): { record: number; freeze: boolean } {
  const sel = MERISSA_ATTACK_SELECT[variant & 1];
  if (targetFlag20) return { record: sel.near, freeze: false };
  if (merissaRngBucket(u32, 3) === 0) return { record: MERISSA_FREEZE_RECORD, freeze: true };
  return { record: sel.near, freeze: false };
}

// The C (far) branch: a roll of 10, the record C only when it is 0 (1 in 10; 0x005b5b0a..0x005b5b56).
export function merissaPickFarAttack(variant: number, u32: number): number | null {
  const sel = MERISSA_ATTACK_SELECT[variant & 1];
  return merissaRngBucket(u32, 10) === 0 ? sel.far : null;
}

// --- Motion slots -----------------------------------------------------------------------------
// The motion table 0x009c1980 (16-byte rows {u16 mode, u16 next, u32 motion, f32 speed, u32 flags};
// tools/exedata.py motions 009c1980 10). The initializer 0x005b6f2c overwrites the speeds of slots 4
// (0x009c19c8 = 0.5) and 6 (0x009c19e8 = 1.0) at run time, so the file's 0 is not the speed.
// Slots 8 and 9 are the death motions (on_merissa_dead writes them). The row motions (0..7) are
// slot numbers (the row's +0x08 word). PROVEN: slot per row and per kind; the animations' own
// meanings are ASSUMED.
export const MERISSA_SLOTS: readonly EnemyAiMotion[] = [
  once(8, 0.5), // slot 0 (mode 3): the appear motion (ctor, row 0)
  loop(16, 0.5), // slot 1 (mode 1): wait (row 1)
  loop(7, 1), // slot 2 (mode 1): walk, the chase (row 2)
  once(3, 2), // slot 3 (mode 3): the stab, kind 3 (records 0, 1, 6)
  once(15, 0.5), // slot 4 (mode 3): the B swing, kind 4 (records 2, 3)
  once(2, 0.5), // slot 5 (mode 3): the C swing, kind 5 (records 4, 5)
  once(6, 1), // slot 6 (mode 3): the lunge (row 3)
  once(4, 0.5), // slot 7 (mode 3, flags 0x80000000): the flinch (row 5)
  once(10, 0.5), // slot 8 (mode 3): the death, the attacker behind (on_merissa_dead 0x005b52ec)
  once(5, 0.5), // slot 9 (mode 3): the death, the attacker in front (within 90 degrees)
];

// --- Brain timings ------------------------------------------------------------------------------
// PROVEN values; ASSUMED ones are marked.
export const MERISSA = {
  acquire: 250, // PROVEN: 0x00a749f0 (0x005b6f72), the range of 0x005b5e5c and of row 1
  appearFrames: 30, // ASSUMED: the row 0 countdown (+0xc0 and +0xc8 are not set by the ctor)
  nearDistSq: 1600, // PROVEN: 0x00a749f4 (0x005b6f4a), the N gate and the record A range
  homeDistSq: 100, // PROVEN: 0x0092b04c (100.0), the no-target return home test (0x005b5d16)
  turnFrames: 4, // PROVEN: row 2 turns while elapsed < 4.0 (0x0092b058)
  stepEnd: 16, // PROVEN: row 2 steps while 4.0 <= elapsed <= 16.0 (0x0092b054)
  lungeStart: 14, // PROVEN: row 3 rotates and steps while 14 < elapsed < 34 (0x0092b014)
  lungeEnd: 34, // PROVEN: 0x0092b010
  lungeDivisor: 21, // PROVEN: the lunge speed is |P - pos| / 21 (0x0092b08c, row 2 hook 0x005b51f8)
  lungeReach: 20, // PROVEN: the landing point is 20 units from the target (0x005b586b writes 20.0)
  lungeTurn: 0x4000, // PROVEN: row 3 turns by 0x4000 BAMS per frame (EnemyAI_UpdateRotation 0x4000)
  deathFront: 0x4000, // PROVEN: on_merissa_dead picks motion 9 when the attacker is within 0x4000 BAMS
  backstabDefault: 45, // ASSUMED: the N angle when the MovementData row is absent (degrees)
  turnDefault: 5, // ASSUMED: the chase turn when the MovementData row is absent (degrees)
};

// integer_angle_abs_difference on BAMS (dump: the same helper the Ill Gill brain uses).
const toBams = (rad: number): number => ((Math.round(rad / BAMS_TO_RAD) % 0x10000) + 0x10000) % 0x10000;
const bamsDiff = (a: number, b: number): number => {
  const d = (a - b) & 0xffff;
  return d > 0x8000 ? 0x10000 - d : d;
};
// Degrees to BAMS the way the exe does it: fildl(deg) * 65536 / 360, truncated.
const degToBams = (deg: number): number => Math.max(0, Math.trunc((deg * 65536) / 360));
const sq = (v: number): number => v * v;

export type MerissaState = 'appear' | 'idle' | 'chase' | 'lunge' | 'attack' | 'flinch' | 'vanish';

// The exe's state numbers (+0x32e): row index of MERISSA_STATE_ROWS.
export const MERISSA_STATE_NUMBER: Record<MerissaState, number> = {
  appear: 0,
  idle: 1,
  chase: 2,
  lunge: 3,
  attack: 4,
  flinch: 5,
  vanish: 6,
};

// The Merissa brain (OWN_FSM 'MerissaA', variant A or AA from set param6 & 1 = +0x380).
//   appear (row 0): the countdown, then idle with the wait motion.
//   idle (row 1): acquires the nearest player within 250, then chase (row 2).
//   chase (row 2): once per walk cycle (the crossing of elapsed 0, the transition 0x005b5768) it
//     acquires again and picks: the N lunge (state 3), the record A stab / freeze (state 4), the B
//     (records 2 / 3, roll 1 in 3) or the C (records 4 / 5, roll 1 in 10). Between the picks it
//     turns by iparam1 degrees a frame while elapsed < 4, and walks at fparam4 while 4 <= elapsed
//     <= 16 (the hit ignored in that window, flag 0x2). A target farther than 250, or none, sends it
//     home (dist^2 < 100 means idle).
//   lunge (row 3): rotates towards the target by 90 degrees a frame and steps along the heading it
//     had on entry while 14 < elapsed < 34, then chase at the animation's end.
//   attack (row 4): tracks the target while elapsed < 10 (turn by iparam1), hits in the record's
//     window (once, ASSUMED: the callback's own gate is the record range), chase at the end.
//   flinch (state 5, row 5): the hit reaction of a hit outside the 0x2 states; chase at the end.
//   vanish (state 6, row 6): the death. The kill enters it (0x005b6a90), on_merissa_dead sets the
//     countdown to 0 and the death motion (8, or 9 when the attacker is within 90 degrees); the
//     countdown drops 0.1 a frame after the motion ends and the entity is removed below -15.
export class MerissaAi extends BrainBase {
  state: MerissaState = 'appear';
  // +0x380: 0 = A, 1 = AA.
  readonly variant: number;
  // +0x37c: the state flags word (the radar gate reads bit 0x8).
  private flags = 0;
  // +0xc0: the animation elapsed in frames, reset on every state entry (ASSUMED: the motion restart).
  private anim = 0;
  private count = MERISSA.appearFrames;
  private record: MerissaAttackRecord | null = null;
  private recordHit = false;
  // The lunge's stored speed (3d8) and heading (3d4).
  private lungeSpeed = 0;
  private lungeHeading = 0;
  // +0x3c4: the vanish countdown (PROVEN arithmetic).
  private vanishCount = 0;
  private removedFlag = false;
  // The last attacker (get_enemy_last_attacker_idx) and the targets of the last frame.
  private lastAttacker: number | null = null;
  private seen: readonly AiTarget[] = [];
  private readonly home: { x: number; z: number };
  // fparam4: the walk step per frame (the engaged animation speed, the row 2 push 0x005b5618).
  private readonly walkSpeed: number;
  // iparam1 and iparam2 of the MovementData row (degrees), as BAMS and radians.
  private readonly turnStep: number;
  private readonly nearAngle: number;
  private readonly motionFrames: (index: number) => number;

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    movement: EnemyMovementData | null;
    variant: number;
    rng?: () => number;
    // The archive frame count of a motion (the loop length of the walk). Default 30 (ASSUMED).
    motionFrames?: (index: number) => number;
  }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.variant = opts.variant & 1;
    this.home = { x: opts.x, z: opts.z };
    const m = opts.movement;
    this.walkSpeed = m && m.fparam4 > 0 ? m.fparam4 : 1; // ASSUMED fallback (no MovementData row)
    const turnDeg = m ? m.iparam[0] : MERISSA.turnDefault;
    const nearDeg = m ? m.iparam[1] : MERISSA.backstabDefault;
    this.turnStep = degToBams(turnDeg) * BAMS_TO_RAD;
    this.nearAngle = degToBams(nearDeg);
    this.motionFrames = opts.motionFrames ?? (() => 30);
    // The ctor: +0x37c = 0, then EnemySetStateFlag(row 0) and the row 0 mask (PROVEN): 0x5.
    this.flags = merissaFlagsAfterRow(0, MERISSA_STATE_ROWS[0]);
    this.current = MERISSA_SLOTS[0];
  }

  // The plain radar icon (the update's icon call is skipped while +0x37c bit 0x8 is set).
  get radar(): boolean {
    return merissaRadarIconShown(this.flags);
  }

  // The flags word as the exe keeps it (+0x37c), for the owner's and the tests' reads.
  get flagsWord(): number {
    return this.flags;
  }

  // True once the vanish countdown has run out (the exe's removal bit +0x8 bit 0x1).
  get removed(): boolean {
    return this.removedFlag;
  }

  // The hit reaction's motion (row 5, slot 7).
  get flinchMotion(): EnemyAiMotion {
    return MERISSA_SLOTS[7];
  }

  // The death motion on_merissa_dead picks (8 or 9) for the last attacker.
  get deathMotion(): EnemyAiMotion {
    return MERISSA_SLOTS[this.deathSlot()];
  }

  // on_merissa_dead: integer_angle_abs_difference(y_rot, bearing to the attacker) < 0x4000 -> 9,
  // else 8 (also 8 when the attacker is not found).
  private deathSlot(): number {
    if (this.lastAttacker === null) return 8;
    const att = this.seen.find((t) => t.clientId === this.lastAttacker);
    if (!att) return 8;
    const diff = bamsDiff(toBams(this.angle), toBams(Math.atan2(att.x - this.x, att.z - this.z)));
    return diff < MERISSA.deathFront ? 9 : 8;
  }

  // The state change: the exe's transition writes (+0xc0 restarts with the motion, PROVEN the
  // flags), the new motion. `out` is null when the change comes from a hit (the renderer plays it).
  private enter(next: MerissaState, motion: EnemyAiMotion | null, out: AiFrame | null): void {
    this.state = next;
    this.anim = 0;
    this.flags = merissaFlagsAfterRow(this.flags, MERISSA_STATE_ROWS[MERISSA_STATE_NUMBER[next]]);
    if (motion) {
      this.current = motion;
      if (out) out.motion = motion;
    }
  }

  // The stride of the played motion (frames per tick).
  private stride(): number {
    return this.current?.speed ?? 0;
  }

  // The archive frame count of a motion (the wrap of a loop, the end of a once).
  private frameCount(m: EnemyAiMotion): number {
    return Math.max(1, this.motionFrames(m.index));
  }

  // The animation's end this frame (the renderer's flag 0x10, or the frame count of a once).
  private ended(animationEnded: boolean): boolean {
    const m = this.current;
    if (animationEnded) return true;
    return m !== null && !m.loop && this.anim >= this.frameCount(m);
  }

  // The animator step after the handler (Player__Animate: elapsed += stride; a loop wraps).
  private advance(): void {
    const m = this.current;
    if (!m) return;
    this.anim += m.speed;
    if (m.loop) {
      const n = this.frameCount(m);
      if (this.anim >= n) this.anim -= n;
    }
  }

  // The turn of change_enemy_direction / EnemyAI_UpdateRotation: towards `aim` by at most `step`.
  private faceTowards(aim: { x: number; z: number }, step: number): void {
    const want = Math.atan2(aim.x - this.x, aim.z - this.z);
    this.angle = turnToward(this.angle, want, step);
  }

  // The move of vtable +0x48 / +0x4c: a step of `speed` along `heading` (ASSUMED: the heading
  // convention x = sin, z = cos, the port's atan2(dx, dz) convention).
  private walk(speed: number, heading: number): void {
    this.x += Math.sin(heading) * speed;
    this.z += Math.cos(heading) * speed;
  }

  // integer_angle_abs_difference(target y_rot, bearing target -> Merissa) (0x005b5801..0x005b5806:
  // the target's +0x60 against the reversed bearing of the vector target - Merissa; PROVEN).
  private facingDiff(t: AiTarget): number {
    return bamsDiff(toBams(t.angle ?? 0), toBams(Math.atan2(this.x - t.x, this.z - t.z)));
  }

  // The rolls read the RNG word as unsigned.
  private rollWord(): number {
    return Math.floor(this.rng() * 4294967296) >>> 0;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    this.seen = targets;
    const out = this.frame();
    const before = this.state;
    const a = this.anim; // the handler's elapsed (the animator runs after the handler)
    const t = this.target(targets);
    switch (this.state) {
      case 'appear':
        // Row 0 (0x005b53dc): the countdown (ASSUMED length), then the idle.
        this.count--;
        if (this.count <= 0) {
          this.targetId = null;
          this.enter('idle', MERISSA_SLOTS[1], out);
        }
        break;
      case 'idle': {
        // Row 1 (0x005b54cc, PROVEN): the nearest player within 250 starts the chase; no movement.
        const n = nearest(targets, this.x, this.z, MERISSA.acquire);
        if (n) {
          this.targetId = n.clientId;
          this.enter('chase', MERISSA_SLOTS[2], out);
        }
        break;
      }
      case 'chase':
        this.tickChase(out, targets, a, t);
        break;
      case 'lunge':
        this.tickLunge(out, t, a, animationEnded);
        break;
      case 'attack':
        this.tickAttack(out, t, a, animationEnded);
        break;
      case 'flinch':
        // Row 5 (EnemyResetState_005b6108): the animation's end resets to the chase.
        if (this.ended(animationEnded)) this.enter('chase', MERISSA_SLOTS[2], out);
        break;
      case 'vanish':
        // Row 6 (EnemyProcessSubEntitySpawn_005b6328): the countdown, once the death motion ended.
        if (this.ended(animationEnded)) {
          const s = merissaVanishStep(this.vanishCount);
          this.vanishCount = s.countdown;
          this.removedFlag = s.removed;
        }
        break;
      default:
        break;
    }
    if (this.state === before) this.advance();
    return this.finish(out);
  }

  // Row 2 (EnemyUpdateState0_005b5618, PROVEN): the walk cycle.
  private tickChase(out: AiFrame, targets: readonly AiTarget[], a: number, t: AiTarget | null): void {
    const inWindow = a >= MERISSA.turnFrames && a <= MERISSA.stepEnd;
    if (inWindow) {
      // The walk step (vtable +0x48 with fparam4 and y_rot, then +0x4c); the flag 0x2 marks it.
      this.flags = (this.flags | 0x2) >>> 0;
      this.walk(this.walkSpeed, this.angle);
      return;
    }
    this.flags = (this.flags & ~0x2) >>> 0;
    // The transition 0x005b5768 runs once per cycle, at the crossing of elapsed 0 (0 < a <= stride).
    if (a > 0 && a <= this.stride()) {
      if (this.pick(out, targets)) return;
    }
    // a < 4 (or past 16): the turn towards the target point (+0x2a4), by iparam1 a frame.
    if (a < MERISSA.turnFrames) {
      const aim = t ?? this.home;
      this.faceTowards(aim, this.turnStep);
    }
  }

  // The transition 0x005b5768 from the chase: acquire, the N lunge, then the records A, B, C.
  // Returns true when the state changed.
  private pick(out: AiFrame, targets: readonly AiTarget[]): boolean {
    const t = nearest(targets, this.x, this.z, MERISSA.acquire);
    this.targetId = t ? t.clientId : null;
    if (!t) {
      // The no-target path 0x005b5cf2: idle when within 10 units of home, else keep walking home.
      if (sq(this.home.x - this.x) + sq(this.home.z - this.z) < MERISSA.homeDistSq) {
        this.enter('idle', MERISSA_SLOTS[1], out);
        return true;
      }
      return false;
    }
    const dSq = sq(t.x - this.x) + sq(t.z - this.z);
    const diff = this.facingDiff(t);
    const v = this.variant;
    // The N lunge (0x005b5818): dist^2 < 1600, the angle below iparam2, and the path test 0x005b5eb4
    // (ASSUMED always clear: the obstacle test 0x0077fffc is not traced).
    if (dSq < MERISSA.nearDistSq && diff < this.nearAngle) {
      this.beginLunge(t, out);
      return true;
    }
    // Record A (0x005b5974): the gate, then the flagged or the rolled stab / freeze (always an attack).
    const near = merissaAttackRecord(MERISSA_ATTACK_SELECT[v].near);
    if (near && merissaInAttackRange(near, dSq, diff)) {
      // ASSUMED: the target never carries the 0x20 flag in the port (AiTarget has no +0x30 word).
      const p = merissaPickNearAttack(v, this.rollWord(), false);
      this.startAttack(p.record, p.freeze, out);
      return true;
    }
    // Record B (0x005b5a52): the gate, the path test (ASSUMED clear), then a roll of 3. A failed
    // roll ends the pick (the C branch is not reached once the B gate passed: 0x005b5bee / 0x005b5ac5).
    const mid = merissaAttackRecord(MERISSA_ATTACK_SELECT[v].mid);
    if (mid && merissaInAttackRange(mid, dSq, diff)) {
      if (merissaRngBucket(this.rollWord(), 3) === 0) {
        this.startAttack(mid.id, false, out);
        return true;
      }
      return false;
    }
    // Record C (0x005b5acf): the gate, then a roll of 10.
    const far = merissaAttackRecord(MERISSA_ATTACK_SELECT[v].far);
    if (far && merissaInAttackRange(far, dSq, diff)) {
      const id = merissaPickFarAttack(v, this.rollWord());
      if (id !== null) {
        this.startAttack(id, false, out);
        return true;
      }
    }
    return false;
  }

  // The N lunge (state 3): the landing point P = target + 20 units along target y_rot + 180
  // (0x005b5c58 / 0x82d7b0 / 0x830aa0: the matrix of the target's +0x60 + 0x8000, PROVEN the
  // offset; ASSUMED the axis convention), the speed |P - pos| / 21 and the heading kept.
  private beginLunge(t: AiTarget, out: AiFrame): void {
    const ang = (t.angle ?? 0) + Math.PI;
    const px = t.x + Math.sin(ang) * MERISSA.lungeReach;
    const pz = t.z + Math.cos(ang) * MERISSA.lungeReach;
    this.lungeSpeed = Math.fround(Math.hypot(px - this.x, pz - this.z)) / MERISSA.lungeDivisor;
    this.lungeHeading = this.angle;
    this.enter('lunge', MERISSA_SLOTS[6], out);
  }

  // Row 3 (EnemyProcessState_005b5f3c, PROVEN): rotate and step while 14 < elapsed < 34; the
  // animation's end resets to the chase (row 3 tail, flag 0x10).
  private tickLunge(out: AiFrame, t: AiTarget | null, a: number, animationEnded: boolean): void {
    if (a > MERISSA.lungeStart && a < MERISSA.lungeEnd) {
      if (t) this.faceTowards(t, MERISSA.lungeTurn * BAMS_TO_RAD);
      this.walk(this.lungeSpeed, this.lungeHeading);
    }
    if (this.ended(animationEnded)) this.enter('chase', MERISSA_SLOTS[2], out);
  }

  // The attack (state 4) entry: the record id (+0x3c0), the freeze bit and the kind's motion at
  // speed slot.speed * scale (the row 3 hook 0x005b5294, PROVEN).
  private startAttack(recordId: number, freeze: boolean, out: AiFrame): void {
    const rec = merissaAttackRecord(recordId);
    if (!rec) return;
    if (freeze) this.flags = (this.flags | MERISSA_FREEZE_MASK) >>> 0;
    this.record = rec;
    this.recordHit = false;
    const slot = MERISSA_SLOTS[rec.kind];
    this.enter('attack', { index: slot.index, speed: slot.speed * rec.scale, loop: false }, out);
  }

  // The record window (PROVEN, 0x005b61a0 at 0x005b6219..): equal ends are one crossing
  // (threshold < elapsed <= threshold + stride), else the inclusive window.
  private windowHit(rec: MerissaAttackRecord, a: number): boolean {
    if (rec.windowStart === rec.windowEnd) return rec.windowStart < a && a <= rec.windowStart + this.stride();
    return rec.windowStart <= a && a <= rec.windowEnd;
  }

  // Row 4 (EnemyProcessState_005b61a0, PROVEN): track the target before `start`, the callback in
  // the window (the hit once, ASSUMED), then the reset to the chase at the animation's end.
  private tickAttack(out: AiFrame, t: AiTarget | null, a: number, animationEnded: boolean): void {
    const rec = this.record;
    if (rec) {
      if (a < rec.start && t) this.faceTowards(t, this.turnStep);
      if (t && !this.recordHit && this.windowHit(rec, a)) {
        const dSq = sq(t.x - this.x) + sq(t.z - this.z);
        if (dSq < rec.rangeSq) {
          this.recordHit = true;
          // The melee path the Ill Gill uses (knockback 0, mult 1).
          out.hit = { clientId: t.clientId, knockback: 0, mult: 1 };
        }
      }
    }
    if (this.ended(animationEnded)) {
      this.record = null;
      this.enter('chase', MERISSA_SLOTS[2], out);
    }
  }

  // The hit reaction (vtable +0x100, 0x005b69f4, PROVEN): a hit does nothing while +0x37c bit
  // 0x2 is set (the lunge, the attack, the flinch and the walk's step window); otherwise row 5
  // (the flinch, motion slot 7) starts. The death does not come here (the vtable +0x104 entry).
  onDamage(clientId: number): void {
    this.lastAttacker = clientId;
    if (this.state === 'vanish') return;
    if ((this.flags & 0x2) !== 0) return;
    this.enter('flinch', MERISSA_SLOTS[7], null);
  }

  resume(): string {
    return this.state;
  }

  // The death (vtable +0x104, 0x005b6a90, PROVEN): entering state 6 unless already there. The
  // row 5 hook on_merissa_dead runs on the way in: the countdown is 0 and the death motion
  // (8 or 9) is the one played. The radar goes hidden (mask 0x8).
  override kill(): void {
    if (this.state === 'vanish') return;
    const motion = MERISSA_SLOTS[this.deathSlot()];
    this.enter('vanish', motion, null);
    this.vanishCount = 0;
    this.removedFlag = false;
  }
}
