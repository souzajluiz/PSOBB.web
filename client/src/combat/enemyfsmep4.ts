// Episode 4 enemy state machine: Zu / Pazuzu (set types 0x114, PsoBB.exe 1.25.13,
// addresses are VAs). The brain is ZuAi below; the pure pieces it is built from
// (the state map, the distance class, the approach ramp, the volley headings, the
// targeting test, the radar bit) are exported on their own and tested alone.
//
// Naming: the Ghidra dump (reverse/refsrc, Psobb.exe-05112026.c) calls these
// functions "Goran*" (its Goran family shares the code), and the Zu's own ones
// update_zu 0x005b27e8, handle_zu_ai (dispatcher), zu_fireball_state. The dump
// types the enemy as `player`; the offsets below are the enemy's (+0x32e state,
// +0x37c pending state, +0x384 phase, +0x388 resume state, +0x38c timer, +0x390
// entity flags, +0x3b0 squared distance to the target, +0x3b4 distance class,
// +0x3b8 class speed, +0x418 approach value, +0xb8 motion slot, +0x2a4 aim point).
// The phase is the 4 bytes at material_count.luck (+0x384): material_count's
// vtable word is the pending state (+0x37c), so `(material_count).vtable = n` in
// the dump is a write of the pending state.
//
// Per frame (update_zu 0x005b27e8): the pause gate; the target refresh
// (GoranProcessState6 0x005b4580); the approach sound / footstep (no sound here);
// the pending-state swap (if +0x32e != +0x37c: the old state runs with phase -1
// while its phase is not -1, then phase = 0 and the new state is set); then
// handle_zu_ai; the animation; the collision; the radar icon (unknown_add_minimap
// _icon 0xffffa24c, scale 1, skipped when +0x390 bit 0x40000 is set; PROVEN
// 0x005b28bc); the hit-box flags.
//
// Dispatcher handle_zu_ai (switch on +0x32e):
//   0  wander        GoranProcessWanderState_005b44f8    (phases 0, 1, -1)
//   3  spawn         EnemyAI_ProcessState3_0052c6ac      (phases 0, 1, -1; leave -> state 1)
//   4  flinch        PlayerProcessGoranState_005b41a0    (phases 0, 1, -1)
//   5  death         on_zu_killed                        (deathfx.ts plays it)
//   7  carry         ZuHandleCarryState_005b3e94         (phases 0, 1, -1)
//   9  approach      GoranUpdateProjectileState_005b3dd4 (phases 0, 1, -1)
//   10 fireball      zu_fireball_state                   (phases 0..3, -1)
//   11 dash          GoranProcessProjectileState_005b3808 (phases 0, 1, 2)
//   12 chase         GoranProcessProjectileState_005b3544 (phases 0, 1, -1)
//   13 tech          GoranProcessProjectileState_005b3234 (phases 0..4, -1)
//   14 lunge         GoranProcessState_005b29e4          (phases 0..4, -1)
//   1, 2, 6, 8        no case: the dispatcher does nothing (1 is the spawn's leave).
//
// Transitions: a state requests the next one by writing the pending state (+0x37c)
// and the resume state (+0x388) unless the no-transition bit 0x1 of +0x390 is set.
// The distance class (GoranCheckAndTransitionState_005b378c) picks the pending state
// from the table 0x0092ac88 ([9, 12, 0]) and the approach speed from 0x0092aea4
// ([10, 60, 80]). GoranTransitionToState_005b2ed4 sets the motion, class 1 and the
// speed 60, and requests state 11 (the dash) when bit 0x1 is clear.
//
// Constants marked PROVEN were read from PsoBB.exe (tools/exedata.py read, float
// or double as the decompile types them, and the disassembly). ASSUMED marks what
// is not traced: the wanderer, the player's level, the foie's mouth height, the
// wall ray's height (the Zu's own y, flat), the TechProjectile's hit radius, and the
// lunge's melee reach. The Zu's tuning is PROVEN from its config row (zu_constructor,
// see the Tunables section); the wall rays are the map ray (cast_ray_at_map_collision
// _geometry 0x0077fffc, mask -1) that render/combat.ts passes in.

import { ATTACK_DAMAGE_MULT, ATTACK_KNOCKBACK, BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyAiMotion } from './enemyai.ts';
import { BrainBase, nearest, turnToward } from './enemyfsm.ts';
import type { EnemyMovementData } from '../formats/battleparams.ts';
import { TechBolt, type EnemyShot } from './enemyshots.ts';
import { enemyFire } from './techfire.ts';
import { TECH } from './techniques.ts';

// --- The state map ----------------------------------------------------------------

export interface ZuStateInfo {
  id: number; // +0x32e value
  handler: string; // dump name
  address: number; // handler VA (0 when the dispatcher has no case)
  ported: boolean;
}
export const ZU_STATES: readonly ZuStateInfo[] = [
  { id: 0, handler: 'GoranProcessWanderState', address: 0x005b44f8, ported: true },
  { id: 1, handler: '(no case)', address: 0, ported: false },
  { id: 2, handler: '(no case)', address: 0, ported: false },
  { id: 3, handler: 'EnemyAI_ProcessState3', address: 0x0052c6ac, ported: true },
  { id: 4, handler: 'PlayerProcessGoranState', address: 0x005b41a0, ported: true },
  { id: 5, handler: 'on_zu_killed', address: 0, ported: false }, // death: combat/deathfx.ts plays it
  { id: 6, handler: '(no case)', address: 0, ported: false },
  { id: 7, handler: 'ZuHandleCarryState', address: 0x005b3e94, ported: true },
  { id: 8, handler: '(no case)', address: 0, ported: false },
  { id: 9, handler: 'GoranUpdateProjectileState', address: 0x005b3dd4, ported: true },
  // The fireball's VA is not traced (the dump names it, the disassembly was not located): 0.
  { id: 10, handler: 'zu_fireball_state', address: 0, ported: true },
  { id: 11, handler: 'GoranProcessProjectileState_3808', address: 0x005b3808, ported: true },
  { id: 12, handler: 'GoranProcessProjectileState_3544', address: 0x005b3544, ported: true },
  { id: 13, handler: 'GoranProcessProjectileState_3234', address: 0x005b3234, ported: true },
  { id: 14, handler: 'GoranProcessState_29e4', address: 0x005b29e4, ported: true },
];

// Brain names per state (ZuAi.state).
export const ZU_STATE_NAMES: Readonly<Record<number, string>> = {
  0: 'wander',
  1: 'stop',
  3: 'spawn',
  4: 'flinch',
  5: 'dead',
  7: 'carry',
  9: 'approach',
  10: 'fireball',
  11: 'dash',
  12: 'chase',
  13: 'tech',
  14: 'lunge',
};

// --- The motion table 0x009c16a0 (PROVEN: tools/exedata.py motions 009c16a0 14) ----
//
// Row = the motion slot (+0xb8). motion = the BML motion, speed the step per tick.
// A row whose `next` is itself loops; any other row plays once and then the engine
// moves the slot to `next` (ASSUMED reading of the mode / next pair, the rule the
// Ep2 families use).
export interface ZuMotionRow {
  motion: number;
  speed: number;
  mode: number;
  next: number;
}
export const ZU_MOTIONS: readonly ZuMotionRow[] = [
  { motion: 11, speed: 0.8, mode: 2, next: 0 },
  { motion: 5, speed: 1.4, mode: 1, next: 1 },
  { motion: 0, speed: 0.7, mode: 2, next: 0 },
  { motion: 2, speed: 0.8, mode: 2, next: 0 },
  { motion: 3, speed: 0.5, mode: 3, next: 4 },
  { motion: 6, speed: 0.8, mode: 2, next: 0 },
  { motion: 5, speed: 2.8, mode: 1, next: 6 },
  { motion: 10, speed: 0.5, mode: 1, next: 7 },
  { motion: 8, speed: 1, mode: 1, next: 8 },
  { motion: 9, speed: 0.9, mode: 2, next: 9 },
  { motion: 7, speed: 1.4, mode: 2, next: 0 },
  { motion: 8, speed: 0.7, mode: 2, next: 1 },
  { motion: 1, speed: 0.8, mode: 2, next: 1 },
  { motion: 4, speed: 0.5, mode: 3, next: 13 },
];

// --- Constants (PROVEN unless marked) --------------------------------------------

// The turn rate of the Zu's steering (ctor +0x3a0 = 0x300, 768 BAMS a tick).
export const ZU_TURN = 0x300;
// The retreat sweep (state 4 / 10 / GoranUpdateTargetPosition): the probe length 150
// (-150, 0, 0 rotated), the back-off threshold 40 (0x0092adb4 / 0x0092adec / 0x0092ae40)
// and the offset -20 (0x0092adb8 / 0x0092adf0 / 0x0092ae44).
export const ZU_PROBE = 150;
export const ZU_RETREAT_MIN = 40;
export const ZU_RETREAT_OFFSET = -20;
// The three rays are 0x5555 BAMS apart (about 120 degrees).
export const ZU_RAY_STEP = 0x5555;
// The side point of a blocked volley aim (state 13): 400 from the Zu (0x0092ae2c).
export const ZU_SIDE_AIM = 400;
// The approach distance to the aim point (state 11): 50 (0x0092ae00).
export const ZU_DASH_DONE = 50;
// The range and arc of the fireball (state 9), the tech (12) and the lunge (14):
// 60 / 0x2000, 180 / 0x1000, 250 / 0x400 (0x0092... ctor +0x3bc .. +0x3f4).
export const ZU_RANGE = { fire: [60, 0x2000], tech: [180, 0x1000], lunge: [250, 0x400] } as const;
// Carry (state 7): the approach value counts from 250 down by 2.2 to 80.
export const ZU_CARRY = { start: 250, floor: 80, step: Math.fround(2.2) } as const;
// The state-4 flinch is motion 12 when +0x30 bit 0x1000000 is set (the ctor sets it).
export const ZU_ENTITY_FLINCH_BIT = 0x1000000;
export const ZU_ENTITY_CARRY_BIT = 0x4000000;

// The radar flags: +0x390 bit 0x40000 hides the icon (PROVEN 0x005b28bc). The
// ctor sets 0x20000 (PROVEN 0x005b4884 region); nothing in the Zu code sets 0x40000.
export const ZU_FLAG_NO_TRANSITION = 0x1; // a flinch or carry: no state request
export const ZU_FLAG_BUSY = 0x80000; // a state is running its own motion
export const ZU_FLAG_MELEE = 0x100000; // the lunge's melee check
export const ZU_FLAG_INIT = 0x20000; // the ctor
export const ZU_FLAG_FLINCH = 0x10000; // GoranInitializeState4 sets 0x10001

// The distance class and the class speed (below).
export const ZU_CLASS_LIMIT_SQ = [Math.fround(8100), Math.fround(62500)] as const;
export const ZU_CLASS_STATE: readonly [number, number, number] = [9, 12, 0];
export const ZU_CLASS_SPEED: readonly [number, number, number] = [Math.fround(10), Math.fround(60), Math.fround(80)];

// The counters the ctor writes (PROVEN values): fireball recovery 30 (+0x3c8),
// tech recovery 10 (+0x3e4), chase gates 0 (+0x3ec) and 2 (+0x404).
export const ZU_FIREBALL_RECOVER = 30;
export const ZU_TECH_RECOVER = 10;
export const ZU_GATE_INIT = { chase: 0, lunge: 2 } as const;

// --- Tunables (PROVEN: zu_constructor 0x005b4884 reads one MovementData row) ----------
//
// g_ZuConfigArray[wide] (0x00a749c8) is a MovementData row (0x30 bytes): the
// fparams are speeds, the iparams are counters. The loader getter 0x0077a6cc is
// base + 0x30 * wide, so the rare Pazuzu is the row after the Zu's (7 / 8, 27 / 28
// in the port's ZU_* / PAZUZU_* rows). The ctor's reads (PROVEN):
//   fparam1 (+0x00) walk     = fparam1 * g_ZuStatScaleFactor   -> +0x394 (objdump 0x005b4c82..0x005b4c92)
//   fparam2 (+0x04) TechProjectile speed (its velocity's length) -> 0x00a74180
//   fparam3 (+0x08) dash     = fparam3 * g_ZuStatScaleFactor   -> +0x39c
//   fparam4 (+0x0c) x g_ZuResistanceScaleFactor (1.0)          -> +0x3d4
//   iparam1 (+0x18) fireball charge counter                    -> +0x3c4
//   iparam2 (+0x1c) fireball volley counter                    -> +0x3cc
//   iparam3 (+0x20) tech charge counter                        -> +0x3e0
//   iparam4 (+0x24) TechProjectile power (the 4th argument of entity_hit_by_tech) -> 0x00a74170
//   iparam5 (+0x28) lunge counter                              -> +0x400
//   iparam6 (+0x2c) dash wait counter                          -> +0x414
// g_ZuStatScaleFactor is 0x0092ad78 = 0x3e3da12f (5/27, a static of .data; the ctor's
// walk and dash read it). g_ZuHitboxScaleFactor is 0x00a74994 = 0x3fc97b42 (85/54,
// written by 0x005b4d34): the slide (+0x398) is that value times the entity scale 1.0,
// no row value (the stack order of 0x005b4c82..0x005b4c8a settles which global is
// which: the walk's product takes the 5/27 one).
export const ZU_STAT_SCALE = Math.fround(0.18518517911434174);
export const ZU_HITBOX_SCALE = Math.fround(1.5740740299224854);
// The TechProjectile's travel limit (0x00927b8c = 500.0): its elapsed distance gains the
// speed each frame and the bolt ends at 500 (update 0x0057fcc0).
export const ZU_TECH_TRAVEL = 500;

export interface ZuTuning {
  walk: number; // +0x394 (fparam1 x the stat scale)
  slide: number; // +0x398 (the hitbox scale; the dash of state 11)
  dash: number; // +0x39c (fparam3 x the stat scale; the lunge of state 14)
  fireCharge: number; // +0x3c4 (iparam1), the fireball's charge counter
  fireVolley: number; // +0x3cc (iparam2), the volley's counter
  techCharge: number; // +0x3e0 (iparam3), the tech's charge counter
  dashWait: number; // +0x414 (iparam6), the dash's wait counter
  lunge: number; // +0x400 (iparam5), the lunge's counter
  techSpeed: number; // fparam2: the TechProjectile speed (the velocity's length)
  techRange: number; // 500 (the travel limit, PROVEN)
  techPower: number; // iparam4: the TechProjectile power
  wander: number; // the wanderer's radius about the spawn (ASSUMED 100, the call's argument)
  meleeReach: number; // the lunge's melee reach (ASSUMED)
}

// The defaults are used only with no MovementData row (the test fixtures); the
// speeds, the counters and the walk are the old ASSUMED ones, the slide and the travel PROVEN.
export const ZU_DEFAULT_TUNING: ZuTuning = {
  walk: 2,
  slide: ZU_HITBOX_SCALE,
  dash: 6,
  fireCharge: 30,
  fireVolley: 30,
  techCharge: 20,
  dashWait: 20,
  lunge: 20,
  techSpeed: 4,
  techRange: ZU_TECH_TRAVEL,
  techPower: 20,
  wander: 100,
  meleeReach: 15,
};

export function zuTuning(movement: EnemyMovementData | null, over: Partial<ZuTuning> = {}): ZuTuning {
  const t: ZuTuning = { ...ZU_DEFAULT_TUNING };
  if (movement) {
    const ip = (k: number): number => Math.trunc(movement.iparam[k] ?? 0);
    t.walk = Math.fround(movement.fparam1 * ZU_STAT_SCALE);
    t.slide = ZU_HITBOX_SCALE;
    t.dash = Math.fround(movement.fparam3 * ZU_STAT_SCALE);
    t.techSpeed = movement.fparam2;
    t.fireCharge = ip(0);
    t.fireVolley = ip(1);
    t.techCharge = ip(2);
    t.techPower = ip(3);
    t.lunge = ip(4);
    t.dashWait = ip(5);
  }
  return { ...t, ...over };
}

// --- Pure helpers (PROVEN arithmetic) ------------------------------------------------

// BAMS of an angle in radians: trunc(angle * 65536 / 2pi), masked to 16 bits (the
// FPU truncates: control word 0xc00 before the store).
export const bamsOf = (rad: number): number => Math.trunc(rad / BAMS_TO_RAD) & 0xffff;

// The random gate of states 10 / 12: trunc(2 * u / 2^32) with the unsigned u
// (zu_fireball_state's phase 3 and GoranProcessProjectileState_005b3544; the
// denominator 0x0092adfc / 0x0092ae20 is 2^32). Nonzero for u >= 2^31: 1 half the time.
export function zuGate(u: number): number {
  return Math.trunc((2 * u) / 4294967296);
}

// The distance class (GoranCheckAndTransitionState_005b378c): 0 below 8100
// (0x0092ae08), 1 below 62500 (0x0092ae04), 2 from there on.
export const ZU_CLASS_LIMIT = { near: ZU_CLASS_LIMIT_SQ[0], far: ZU_CLASS_LIMIT_SQ[1] } as const;
export function zuDistanceClass(distSq: number): 0 | 1 | 2 {
  const d = Math.fround(distSq);
  if (d < ZU_CLASS_LIMIT_SQ[0]) return 0;
  if (d < ZU_CLASS_LIMIT_SQ[1]) return 1;
  return 2;
}

// --- Movement: the approach to the class speed (GoranWaitForProjectileToReachTarget_005b36e4)
//
// f418 is the current approach value, f3b8 the target speed of the state. The
// step is 2.2 (0x0092ae10) toward the target, or -2.2 (0x0092ae14) when the
// approach is above it; within 0.5 (0x0092ae1c) of the speed it has arrived (the
// step is then not taken). An overshoot snaps to the speed. Returns the new
// approach value and whether the approach is done. PROVEN: the constants (float
// reads at 0x0092ae0c .. 0x0092ae1c) and the branch structure of the dump.
const APPROACH = { step: Math.fround(2.2), near: Math.fround(0.5), zero: 0 } as const;
export function zuApproach(f418: number, f3b8: number): { arrived: boolean; f418: number } {
  const fr = Math.fround;
  const f1 = fr(fr(f3b8) - fr(f418));
  let step = APPROACH.step;
  if (f1 <= APPROACH.near) {
    step = -APPROACH.step;
    if (f1 >= -APPROACH.near) return { arrived: true, f418: fr(f418) };
  }
  const next = fr(fr(f418) + step);
  const f2 = fr(fr(f3b8) - next);
  if (Math.abs(f2) >= APPROACH.near && fr(f2 * f1) >= APPROACH.zero) return { arrived: false, f418: next };
  return { arrived: true, f418: fr(f3b8) };
}

// --- Attack: the projectile difficulty (GoranCalculateProjectileDifficulty_005b3d90)
//
// level = floor * 10 + trunc(playerLevel / 20), clamped to 29 (0x1d), then divided
// by 3. PROVEN: objdump 0x005b3d90..0x005b3dc4 (imul 0x66666667 >> 3 is the /20,
// clamp by cmp 0x1d, imul 0x55555556 is the /3, all signed).
export function zuProjectileDifficulty(floor: number, playerLevel: number): number {
  let v = floor * 10 + Math.trunc(playerLevel / 20);
  if (v > 0x1d) v = 0x1d;
  return Math.trunc(v / 3);
}

// --- Attack: the fireball volley (GoranSpawnProjectileEffect_005b3cb0) -----------
//
// Three foie objects, at the heading +0x1000, the heading, and the heading -0x1000
// (BAMS, masked to 16 bits), and two more at +0x2000 / -0x2000 when the wide flag
// (+0x504, the rare flag set by the ctor) is set. The order is the order of creation.
// PROVEN: dump lines 400436..400445 and the ctor's +0x504 store.
export function zuVolleyHeadings(heading: number, wide: boolean): number[] {
  const h = heading & 0xffff;
  const out = [(h + 0x1000) & 0xffff, h, (h - 0x1000) & 0xffff];
  if (wide) out.push((h + 0x2000) & 0xffff, (h - 0x2000) & 0xffff);
  return out;
}

// --- Targeting: in range and facing (Derolle_IsTargetInRangeAndFacing_00786494) --
//
// The target (dx, dz) is the player minus the Zu in XZ. Out of range when
// range^2 < dx^2 + dz^2. The bearing is atan2(dz, dx) in BAMS:
// trunc(angle * 65536 / 6.283184051513672) (the FPU is set to truncate, 0xc00,
// before the store), and the Zu faces it when the heading is within half of the
// arc of 0x4000 - bearing (the exe's 16-bit angle difference). A target with
// character flags & 0x2000800 (the dump's test; the flag names are not traced) is
// never targeted. PROVEN: the constants 65536.0 (0x0092acd8 double) and
// 6.283184051513672 (0x0092acd0 double), the 16-bit difference (integer_angle_abs_
// difference, dump 790253). ASSUMED: the double-precision division (the exe uses 80-bit).
const BAMS_PER_TURN = 6.283184051513672;
export function zuInRangeAndFacing(o: { dx: number; dz: number; heading: number; flags: number; range: number; arc: number }): boolean {
  if ((o.flags & 0x2000800) !== 0) return false;
  if (o.range * o.range < o.dx * o.dx + o.dz * o.dz) return false;
  const bearing = Math.trunc((Math.atan2(o.dz, o.dx) * 65536) / BAMS_PER_TURN);
  const want = (0x4000 - (bearing << 16 >> 16)) & 0xffff;
  let d = ((o.heading & 0xffff) - want) << 16 >> 16;
  if (d < 0) d = -d;
  return d <= Math.trunc(o.arc / 2);
}

// --- Radar: the icon bit (update_zu, PROVEN 0x005b28bc) --------------------------
//
// The radar icon of a Zu is not drawn while +0x390 has bit 0x40000. No code in
// the Zu's range sets it (the writers in the dump are other families'); the bit
// comes from the entity's flags as the factory sets them (ASSUMED, not traced).
// The brain's flags word (ZuAi.flags) carries it; render/combat.ts minimapEnemies reads it.
export const ZU_ICON_HIDDEN_BIT = 0x40000;
export function zuRadarIconHidden(flags390: number): boolean {
  return (flags390 & ZU_ICON_HIDDEN_BIT) !== 0;
}

// --- The brain -------------------------------------------------------------------------

// A map wall ray: the hit point of the segment (x0, z0) -> (x1, z1), or null.
// ASSUMED to exist only when the owner passes it (cast_ray_at_map_collision_geometry).
export type ZuPoint = { x: number; y: number; z: number };
export type ZuWall = (from: ZuPoint, to: ZuPoint) => ZuPoint | null;

export interface ZuOptions {
  x: number;
  z: number;
  angle: number; // radians (the port's heading: atan2(dx, dz))
  rng: () => number;
  movement?: EnemyMovementData | null;
  detect?: number; // the target search radius (aiConfig detect, ASSUMED 100)
  floor?: number; // g_CurrentFloor (ASSUMED: the area)
  ultimate?: boolean; // the Ultimate difficulty (ASSUMED: difficulty === 3)
  wide?: boolean; // the rare flag (+0x504): the volley has four more foie
  levelOf?: (clientId: number) => number; // the target's level (get_level)
  wall?: ZuWall | null;
  y?: number; // the Zu's height: the wall rays run at it (ASSUMED flat; the exe's weapon position is not traced)
  tuning?: Partial<ZuTuning>;
}

// The mouth height of the foie (ASSUMED: the model's origin; the exe's launch point is
// the transform of the mouth bone less 13, PROVEN 0x0092ade4 = -13).
const ZU_MOUTH_Y = 0;
const ZU_MELEE_KNOCKBACK = ATTACK_KNOCKBACK;
const ZU_MELEE_MULT = ATTACK_DAMAGE_MULT;
const WANDER_STEP = 8; // ASSUMED: the wanderer picks its next point within 8 units

// A shot point (above the launch ground) as a world point at the Zu's ground height.
function lift(p: ZuPoint, ground: number): ZuPoint {
  return { x: p.x, y: p.y + ground, z: p.z };
}

export class ZuAi extends BrainBase {
  state = 'wander';
  readonly tuning: ZuTuning;
  readonly ultimate: boolean;
  readonly wide: boolean;
  readonly floor: number;
  private readonly detect: number;
  private readonly levelOf: (clientId: number) => number;
  private readonly wall: ZuWall | null;
  private readonly y: number;
  private readonly spawnX: number;
  private readonly spawnZ: number;

  // The exe's fields (see the header).
  private id = 0; // +0x32e
  private pending = 0; // +0x37c
  private resumeId = 0; // +0x388
  private flinchResume = 0; // +0x380
  private phase = 0; // +0x384
  private timer = 0; // +0x38c
  private anim = 0; // +0x400 (unk_anim_data_object)
  private gateChase = ZU_GATE_INIT.chase; // +0x3ec
  private gateLunge = ZU_GATE_INIT.lunge; // +0x404
  private cls = 2; // +0x3b4
  private dist2 = 10000; // +0x3b0 (the ctor's value; GoranProcessState6 overwrites it)
  private speed = ZU_CLASS_SPEED[2]; // +0x3b8
  private approach = 0; // +0x418
  private stepScale = 0; // +0x408
  private flags = ZU_FLAG_INIT; // +0x390
  private entityFlags = ZU_ENTITY_FLINCH_BIT; // +0x30 (the bits this brain uses)
  private slot = 0; // +0xb8
  private elapsed = 0; // the slot's animation elapsed (check_entity_animation_elapsed_threshold)
  private aim: { x: number; z: number }; // +0x2a4 (the target point)
  private tgt: AiTarget | null = null;
  private motionDirty = false;
  private lungeHit = false;
  private wanderX: number;
  private wanderZ: number;
  private dead = false;

  constructor(opts: ZuOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng);
    this.tuning = zuTuning(opts.movement ?? null, opts.tuning);
    this.ultimate = opts.ultimate ?? false;
    this.wide = opts.wide ?? false;
    this.floor = opts.floor ?? 0;
    this.detect = opts.detect ?? 100;
    this.levelOf = opts.levelOf ?? (() => 1);
    this.wall = opts.wall ?? null;
    this.y = opts.y ?? 0;
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.aim = { x: opts.x, z: opts.z };
    this.wanderX = opts.x;
    this.wanderZ = opts.z;
  }

  // --- Public readers (the radar gate, the tests) ---

  /** The +0x390 word (only bit 0x40000 is read by the radar). */
  get flags390(): number {
    return this.flags;
  }

  /** Whether the radar icon is hidden (update_zu's gate on bit 0x40000). */
  get radarHidden(): boolean {
    return zuRadarIconHidden(this.flags);
  }

  /** The exe state id (+0x32e) and phase (+0x384), the pending state (+0x37c). */
  get exeState(): number {
    return this.id;
  }
  get exePhase(): number {
    return this.phase;
  }
  get exePending(): number {
    return this.pending;
  }
  get exeClass(): number {
    return this.cls;
  }
  get motionSlot(): number {
    return this.slot;
  }
  get aimPoint(): { x: number; z: number } {
    return { ...this.aim };
  }

  // --- The frame ------------------------------------------------------------------

  override tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.dead) return this.finish(out);
    this.resolveTarget(targets);
    this.advanceAnimation(animationEnded);
    if (this.id !== this.pending) {
      // The old state's leave runs with phase -1 (unless it already did).
      if (this.phase !== -1) {
        this.phase = -1;
        this.run(out, this.id, targets, animationEnded);
      }
      this.phase = 0;
      this.id = this.pending;
      this.state = ZU_STATE_NAMES[this.id] ?? 'stop';
    }
    this.run(out, this.id, targets, animationEnded);
    if (this.motionDirty) {
      this.motionDirty = false;
      this.play(out, this.motionOf(this.slot));
    }
    return this.finish(out);
  }

  override onDamage(_clientId: number): void {
    // GoranInitializeState4_005b2588: the flinch (state 4) is requested unless
    // already in it; the old resume state moves into +0x388 and the flags 0x10001 are set.
    // ASSUMED: every landed hit runs it (the hit vtable slot is not traced).
    if (this.dead) return;
    if (this.id !== 4) this.pending = 4;
    const old = this.flinchResume;
    this.flinchResume = 4;
    this.resumeId = old;
    this.flags |= ZU_FLAG_NO_TRANSITION | ZU_FLAG_FLINCH;
  }

  // The render's flinch path is not used: the flinch is this brain's state 4.
  flinches(_damage: number, _maxHp: number): boolean {
    return false;
  }

  override resume(): string {
    return ZU_STATE_NAMES[this.resumeId] ?? 'wander';
  }

  override kill(): void {
    this.dead = true;
    this.id = 5;
    this.state = 'dead';
    this.current = null;
  }

  // --- The dispatcher -------------------------------------------------------------

  private run(out: AiFrame, id: number, targets: readonly AiTarget[], ended: boolean): void {
    switch (id) {
      case 0:
        return this.wander(targets);
      case 3:
        return this.spawn();
      case 4:
        return this.flinch(ended);
      case 7:
        return this.carry();
      case 9:
        return this.approachState(targets);
      case 10:
        return this.fireball(out, targets);
      case 11:
        return this.dashState(targets);
      case 12:
        return this.chaseState(targets);
      case 13:
        return this.techState(out, targets);
      case 14:
        return this.lungeState(out, targets);
      default:
        return; // 1, 2, 5, 6, 8: no case
    }
  }

  // Wander (GoranProcessWanderState_005b44f8): phase 0 sets the approach to 80 and
  // motion 1; phase 1 wanders (ASSUMED wanderer), and when the approach arrives it
  // checks the class.
  private wander(targets: readonly AiTarget[]): void {
    void targets;
    if (this.phase === 0) {
      this.approach = 80;
      this.setSlot(1);
      this.flags &= ~ZU_FLAG_BUSY;
      this.phase = 1;
    } else if (this.phase === 1) {
      this.wanderStep();
      if (this.arrive()) this.classify();
    } else if (this.phase === -1) {
      this.phase = 0;
    }
  }

  // Spawn (EnemyAI_ProcessState3_0052c6ac): the timed stand; its leave requests
  // state 1, which has no case (the dispatcher is idle then). No writer of state 3
  // is traced for the Zu, so it is only reached by a request this brain does not make.
  private spawn(): void {
    if (this.phase === 0) {
      this.phase = 1;
      this.setSlot(0);
      this.entityFlags &= ~0x600000;
    } else if (this.phase === -1) {
      this.pending = 1;
      this.entityFlags &= ~0x100;
    }
  }

  // Flinch (PlayerProcessGoranState_005b41a0): the enter sets motion 12 (bit 0x1000000
  // of +0x30) or 3 and the frame runs; the frame ends it when the animation has ended;
  // the leave clears bit 0x1, requests the dash (state 11 via GoranTransitionToState 6)
  // and picks a retreat point.
  private flinch(ended: boolean): void {
    if (this.phase === 0) {
      this.setSlot(this.entityFlags & ZU_ENTITY_FLINCH_BIT ? 12 : 3);
      this.phase = 1;
    } else if (this.phase === 1) {
      if (ended) this.phase = -1;
    } else if (this.phase === -1) {
      this.flags &= ~0x1;
      this.transition(6);
      const r = this.retreat();
      if (r) this.aim = r;
    }
  }

  // Carry (ZuHandleCarryState_005b3e94): the approach value is the carry timer
  // (250 down by 2.2 to 80); the leave clears bits 0x1 and 0x4 and requests state 0
  // when the state is not 0. ASSUMED: the carried object never reports done.
  private carry(): void {
    if (this.phase === 0) {
      this.flags |= 0x4;
      this.entityFlags |= ZU_ENTITY_CARRY_BIT;
      this.approach = ZU_CARRY.start;
      this.setSlot(1);
      this.phase = 1;
    } else if (this.phase === 1) {
      const t = this.approach;
      this.approach = t > ZU_CARRY.floor ? t - ZU_CARRY.step : ZU_CARRY.floor;
      if (t <= ZU_CARRY.floor) this.phase = -1;
    } else if (this.phase === -1) {
      this.flags &= ~0x5;
      this.entityFlags &= ~ZU_ENTITY_CARRY_BIT;
      if (this.id !== 0) {
        this.pending = 0;
        this.resumeId = this.id;
      }
      this.phase = 0;
    }
  }

  // Approach (GoranUpdateProjectileState_005b3dd4 = state 9): walk at the player;
  // on arrival the class decides, or the fireball when the player is in range (60)
  // and in the 0x2000 arc.
  private approachState(targets: readonly AiTarget[]): void {
    this.updateTargetPosition(targets);
    if (this.phase === 0) {
      this.setSlot(1);
      this.flags &= ~ZU_FLAG_BUSY;
      this.phase = 1;
    } else if (this.phase === 1) {
      this.followPlayer(this.tuning.walk);
      if (this.arrive() && !this.classify()) {
        if (this.inRange(ZU_RANGE.fire[0], ZU_RANGE.fire[1]) && !(this.flags & ZU_FLAG_NO_TRANSITION) && this.id !== 10) this.request(10);
      }
    } else if (this.phase === -1) {
      this.phase = 0;
    }
  }

  // Fireball (zu_fireball_state): charge (6), fire (8) with the volley at the first
  // animation frame, recover (6), then state 9 (50 %) or a retreat through the dash (50 %).
  private fireball(out: AiFrame, targets: readonly AiTarget[]): void {
    this.updateTargetPosition(targets);
    if (this.phase === 0) {
      this.flags |= ZU_FLAG_BUSY;
      this.setSlot(6);
      this.anim = this.tuning.fireCharge;
      this.phase = 1;
    } else if (this.phase === 1) {
      this.anim -= 1;
      if (this.anim < 0) {
        this.setSlot(8);
        this.anim = this.tuning.fireVolley;
        this.phase = 2;
      }
    } else if (this.phase === 2) {
      if (this.ultimate) this.followPlayer(this.tuning.walk);
      this.anim -= 1;
      if (this.anim < 0) {
        this.anim = ZU_FIREBALL_RECOVER;
        this.setSlot(6);
        this.phase = 3;
        return;
      }
      if (this.crossed(1)) this.volley(out);
    } else if (this.phase === 3) {
      this.anim -= 1;
      if (this.anim >= 0) return;
      this.anim = 0;
      this.setSlot(1);
      if (zuGate(this.randU()) !== 0) {
        this.request(9);
        this.flags &= ~ZU_FLAG_BUSY;
      } else {
        this.transition(1);
        const r = this.retreat();
        if (r) this.aim = r;
      }
    } else if (this.phase === -1) {
      this.phase = 0;
    }
  }

  // Dash (GoranProcessProjectileState_005b3808 = state 11): motion 6 for the counter,
  // then motion 1 and the walk to the aim point; within 50 of it the class decides.
  // No updateTargetPosition here (the exe does not call it).
  private dashState(targets: readonly AiTarget[]): void {
    void targets;
    if (this.phase === 0) {
      this.phase = 1;
      this.setSlot(6);
      this.timer = this.tuning.dashWait;
    } else if (this.phase === 1) {
      this.timer -= 1;
      if (this.timer < 0) {
        this.phase = 2;
        this.setSlot(1);
      }
    } else if (this.phase === 2) {
      this.steer(this.aim, this.tuning.slide, ZU_TURN);
      if (this.arrive() && this.distTo(this.aim) < ZU_DASH_DONE) {
        this.cls = -1;
        this.classify();
      }
    }
  }

  // Chase (GoranProcessProjectileState_005b3544 = state 12): follow the player; on
  // arrival, the class; else the tech (state 13) at 180 / 0x1000 after a random gate,
  // or the lunge (state 14) at 250 / 0x400 after the lunge gate.
  private chaseState(targets: readonly AiTarget[]): void {
    this.updateTargetPosition(targets);
    if (this.phase === 0) {
      this.flags &= ~ZU_FLAG_BUSY;
      this.setSlot(1);
      this.phase = 1;
    } else if (this.phase === 1) {
      this.followPlayer(this.tuning.walk);
      if (this.arrive() && !this.classify()) {
        this.gateChase -= 1;
        if (this.gateChase < 0 && this.inRange(ZU_RANGE.tech[0], ZU_RANGE.tech[1])) {
          if (zuGate(this.randU()) !== 0) {
            if (this.flags & ZU_FLAG_NO_TRANSITION) return;
            if (this.id === 13) return;
            this.request(13);
            return;
          }
        }
        this.gateLunge -= 1;
        if (this.gateLunge < 0 && this.inRange(ZU_RANGE.lunge[0], ZU_RANGE.lunge[1]) && !(this.flags & ZU_FLAG_NO_TRANSITION) && this.id !== 14) this.request(14);
      }
    } else if (this.phase === -1) {
      this.phase = 0;
    }
  }

  // Tech (GoranProcessProjectileState_005b3234 = state 13): motion 6, the aim (the
  // timer of 300 frames to find a clear line, then state 12), the charge, the bolt,
  // the recover and the state-1 wait.
  private techState(out: AiFrame, targets: readonly AiTarget[]): void {
    this.updateTargetPosition(targets);
    if (this.phase === 0) {
      this.setSlot(6);
      this.timer = 300;
      this.flags |= ZU_FLAG_BUSY;
      this.phase = 1;
    } else if (this.phase === 1) {
      if (this.setupAim(targets)) {
        this.phase = 2;
        this.timer = this.tuning.techCharge;
        return;
      }
      this.timer -= 1;
      if (this.timer < 0 && !(this.flags & ZU_FLAG_NO_TRANSITION) && this.id !== 12) this.request(12);
    } else if (this.phase === 2) {
      this.timer -= 1;
      if (this.timer >= 0) return;
      if (!this.spawnBolt(out, targets)) {
        this.timer = 0;
        if (!(this.flags & ZU_FLAG_NO_TRANSITION) && this.id !== 12) this.request(12);
        this.phase = 0;
        return;
      }
      this.phase = 3;
    } else if (this.phase === 3) {
      if (this.timer - 1 < 0) {
        this.setSlot(6);
        this.timer = ZU_TECH_RECOVER;
        this.phase = 4;
        return;
      }
      this.timer -= 1;
    } else if (this.phase === 4) {
      this.stateOne(12);
      this.gateLunge = ZU_GATE_INIT.lunge;
    } else if (this.phase === -1) {
      this.phase = 0;
    }
  }

  // Lunge (GoranProcessState_005b29e4 = state 14): the same aim as state 13 (the
  // timer then state 12), a wait for the animation to reach 6 (or a non-6 slot), the
  // lunge at the aim point with a melee check, the recover.
  private lungeState(out: AiFrame, targets: readonly AiTarget[]): void {
    void out;
    this.updateTargetPosition(targets);
    if (this.phase === 0) {
      this.flags |= ZU_FLAG_BUSY;
      this.timer = 300;
      this.setSlot(6);
      this.phase = 1;
    } else if (this.phase === 1) {
      if (this.setupAim(targets)) {
        this.timer = 0;
        this.phase = 2;
        return;
      }
      this.timer -= 1;
      if (this.timer < 0 && !(this.flags & ZU_FLAG_NO_TRANSITION) && this.id !== 12) this.request(12);
    } else if (this.phase === 2) {
      this.anim -= 1;
      if (this.anim >= 0) return;
      if (this.slot !== 6 || this.crossed(6)) {
        this.setSlot(7);
        this.beginLunge();
      }
    } else if (this.phase === 3) {
      this.steer(this.aim, this.tuning.dash, ZU_TURN);
      this.approach = this.distTo(this.aim) * this.stepScale + 1.625;
      this.melee(out, targets);
      this.anim -= 1;
      if (this.anim < 0) {
        this.phase = 4;
        this.setSlot(1);
      }
    } else if (this.phase === 4) {
      this.flags &= ~ZU_FLAG_MELEE;
      this.stateOne(12);
      this.gateLunge = ZU_GATE_INIT.lunge;
    } else if (this.phase === -1) {
      this.phase = 0;
    }
  }

  // --- Helpers --------------------------------------------------------------------------

  // GoranTransitionToState_005b2ed4: motion, class 1, speed 60, busy; state 11 is
  // requested when no-transition is clear; the phase restarts at 0.
  private transition(motion: number): void {
    this.cls = 1;
    this.setSlot(motion);
    this.flags |= ZU_FLAG_BUSY;
    this.speed = ZU_CLASS_SPEED[this.cls];
    if (!(this.flags & ZU_FLAG_NO_TRANSITION) && this.id !== 11) {
      this.resumeId = this.id;
      this.pending = 11;
    }
    this.phase = 0;
  }

  // The state request every handler repeats: pending and resume, unless no-transition
  // is set or the state is already the one asked for.
  private request(state: number): void {
    if (this.flags & ZU_FLAG_NO_TRANSITION || this.id === state) return;
    this.resumeId = this.id;
    this.pending = state;
  }

  // GoranCheckAndTransitionState_005b378c: the class from the distance; on a change the
  // speed of the class and its state request. Returns whether the class changed.
  private classify(): boolean {
    const c = zuDistanceClass(this.dist2);
    if (c === this.cls) return false;
    this.cls = c;
    this.speed = ZU_CLASS_SPEED[c];
    this.request(ZU_CLASS_STATE[c]);
    return true;
  }

  // GoranProcessState1_005b2f5c: count the timer down; at its end the motion 1 and
  // the request of `next` (12 for the tech and lunge), and the busy bit clears.
  private stateOne(next: number): void {
    const t = this.timer - 1;
    if (t >= 0) {
      this.timer = t;
      return;
    }
    this.timer = 0;
    this.setSlot(1);
    this.request(next);
    this.flags &= ~ZU_FLAG_BUSY;
  }

  // GoranWaitForProjectileToReachTarget_005b36e4: the approach ramp toward the class speed.
  private arrive(): boolean {
    const r = zuApproach(this.approach, this.speed);
    this.approach = r.f418;
    return r.arrived;
  }

  // GoranUpdateTargetPosition_005b2ccc: with no target, the state goes to the dash and
  // the aim point is a retreat from the Zu's own position.
  private updateTargetPosition(targets: readonly AiTarget[]): void {
    void targets;
    if (this.tgt) return;
    this.transition(1);
    const r = this.retreat();
    if (r) this.aim = r;
  }

  // GoranSetupProjectileAttack_005b30c8: aim at the player's weapon position (the
  // turn toward it first); true when the line from the player to the Zu is clear.
  // Blocked (the ray 0x0077fffc, mask -1, from the weapon point to the Zu's point), the
  // aim is the Zu's point plus 400 (0x0092ae2c, PROVEN) across the direction from the Zu to
  // the weapon point: (-dz, dx) / |d| with d = weapon - Zu on XZ (objdump-checked sign). The
  // exe then computes a lob velocity (EnemyAI_CalculateProjectileVelocity_00771f5c, not traced).
  private setupAim(targets: readonly AiTarget[]): boolean {
    void targets;
    const t = this.tgt;
    if (!t) return false;
    this.aim = { x: t.x, z: t.z };
    this.turnToward(this.aim, ZU_TURN);
    if (!this.wall || !this.wall(this.p3(t.x, t.z), this.p3(this.x, this.z))) return true;
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const len = Math.hypot(dx, dz);
    const nx = len > 0 ? dx / len : 0;
    const nz = len > 0 ? dz / len : 0;
    this.aim = { x: this.x - nz * ZU_SIDE_AIM, z: this.z + nx * ZU_SIDE_AIM };
    return false;
  }

  // The tech bolt: from the Zu toward the player's weapon position (GoranSpawnTechProjectile_005b3370;
  // the flight and the damage are not traced, ASSUMED a straight bolt).
  private spawnBolt(out: AiFrame, targets: readonly AiTarget[]): boolean {
    void targets;
    const t = this.tgt;
    if (!t) return false;
    const angle = Math.atan2(t.x - this.x, t.z - this.z);
    // The shot's y is above the launch ground; the map ray runs at the Zu's height.
    const wall = this.wall;
    const ground = this.y;
    const wallBlocks = wall ? (a: ZuPoint, b: ZuPoint): boolean => wall(lift(a, ground), lift(b, ground)) !== null : undefined;
    const bolt = new TechBolt({
      x: this.x,
      y: ZU_MOUTH_Y,
      z: this.z,
      angle,
      speed: this.tuning.techSpeed,
      range: this.tuning.techRange,
      // ASSUMED: the hit radius is one step (the exe's test is the squared distance to the
      // weapon point below the speed squared; 0x78ea2c's return is not traced).
      radius: this.tuning.techSpeed,
      effect: { kind: 'tech', power: this.tuning.techPower },
      color: 0xffa040,
      // update 0x0057fcc0: the step from the old position to the new one meets the map (mask -1) first.
      wallBlocks: wallBlocks,
    });
    out.shots = [...(out.shots ?? []), bolt];
    return true;
  }

  // The fireball volley (GoranSpawnProjectileEffect_005b3cb0): with a target, the foie
  // objects at the volley headings, level = the projectile difficulty.
  private volley(out: AiFrame): void {
    const t = this.tgt;
    if (!t) return;
    const level = zuProjectileDifficulty(this.floor, this.levelOf(t.clientId));
    const shots: EnemyShot[] = [];
    for (const h of zuVolleyHeadings(bamsOf(this.angle), this.wide)) {
      const s = enemyFire({ tech: TECH.foie, level, x: this.x, y: ZU_MOUTH_Y, z: this.z, heading: h * BAMS_TO_RAD, enemy: true });
      if (s) shots.push(s);
    }
    out.shots = [...(out.shots ?? []), ...shots];
  }

  // The lunge's start (LAB_005b2bcc): the melee count, the lunge counter, the rotation
  // scale 0x408 = (approach - 1.625) / distance; no distance means state 12.
  private beginLunge(): void {
    this.lungeHit = false;
    this.anim = this.tuning.lunge;
    const d = this.distTo(this.aim);
    if (d === 0) {
      this.request(12);
    } else {
      this.stepScale = (this.approach - 1.625) / d;
    }
    this.phase = 3;
  }

  // The lunge's melee check (ASSUMED: one hit per lunge when the player is within the reach).
  private melee(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.tgt;
    if (!t || this.lungeHit) return;
    if (Math.hypot(t.x - this.x, t.z - this.z) >= this.tuning.meleeReach) return;
    this.lungeHit = true;
    out.hit = { clientId: t.clientId, knockback: ZU_MELEE_KNOCKBACK, mult: ZU_MELEE_MULT };
    void targets;
  }

  // Retreat (the sweep of PlayerProcessGoranState_005b41a0 / Fireball phase 3 /
  // GoranUpdateTargetPosition_005b2ccc): three rays 0x5555 apart from the bearing of
  // the aim, each probe 150 long, starting at heading (bearing - 0x4000) (the matrix
  // rotation of (-150, 0, 0)). The first clear ray becomes the aim. When all three hit
  // a wall, the one whose wall is furthest (less 20) takes the aim at that distance
  // back, when it is at least 40. Returns the new aim or null (no change).
  private retreat(): { x: number; z: number } | null {
    const ox = this.x;
    const oz = this.z;
    const bearing = bamsOf(Math.atan2(this.aim.x - ox, this.aim.z - oz));
    let theta = bearing;
    let best = bearing;
    let bestD = 0;
    let end: { x: number; z: number } | null = null;
    let k = 0;
    for (; k < 3; k++) {
      const r = theta * BAMS_TO_RAD;
      const e = { x: ox - ZU_PROBE * Math.cos(r), z: oz + ZU_PROBE * Math.sin(r) };
      const hit = this.wall ? this.wall(this.p3(ox, oz), this.p3(e.x, e.z)) : null;
      if (!hit) {
        end = e;
        break;
      }
      const dd = Math.hypot(hit.x - this.x, hit.z - this.z) + ZU_RETREAT_OFFSET;
      if (bestD < dd) {
        best = theta;
        bestD = dd;
      }
      theta = (theta + ZU_RAY_STEP) & 0xffff;
    }
    if (k < 3) return end;
    if (bestD < ZU_RETREAT_MIN) return null;
    const r = best * BAMS_TO_RAD;
    return { x: ox - bestD * Math.cos(r), z: oz + bestD * Math.sin(r) };
  }

  // The player's weapon point (the target's position; the exe's weapon_position, ASSUMED
  // to be the feet in XZ).
  private followPlayer(speed: number): void {
    if (this.tgt) this.aim = { x: this.tgt.x, z: this.tgt.z };
    this.steer(this.aim, speed, ZU_TURN);
  }

  // EnemyAI_UpdateProjectileVtable_0077a0d0: turn toward the point by at most `turn`
  // BAMS (change_enemy_direction), then move `speed` along the heading (vtable +0x48, +0x4c).
  private steer(p: { x: number; z: number }, speed: number, turn: number): void {
    this.turnToward(p, turn);
    this.x += Math.sin(this.angle) * speed;
    this.z += Math.cos(this.angle) * speed;
  }

  private turnToward(p: { x: number; z: number }, turn: number): void {
    const want = Math.atan2(p.x - this.x, p.z - this.z);
    this.angle = turnToward(this.angle, want, turn * BAMS_TO_RAD);
  }

  private wanderStep(): void {
    if (Math.hypot(this.wanderX - this.x, this.wanderZ - this.z) < WANDER_STEP) {
      const a = this.rng() * Math.PI * 2;
      const d = this.rng() * this.tuning.wander;
      this.wanderX = this.spawnX + Math.sin(a) * d;
      this.wanderZ = this.spawnZ + Math.cos(a) * d;
    }
    this.steer({ x: this.wanderX, z: this.wanderZ }, this.tuning.walk, ZU_TURN);
  }

  // The target: the one kept while it lives, else the nearest in the detect radius
  // (ASSUMED: the exe's EnemyUpdateTarget and its lost-target test are not traced).
  // Sets the squared XZ distance (+0x3b0) the class reads.
  private resolveTarget(targets: readonly AiTarget[]): void {
    let t: AiTarget | null = null;
    if (this.targetId !== null) t = targets.find((a) => a.clientId === this.targetId && !a.dead) ?? null;
    if (!t) t = nearest(targets, this.x, this.z, this.detect);
    this.tgt = t;
    this.targetId = t ? t.clientId : null;
    this.dist2 = t ? (t.x - this.x) ** 2 + (t.z - this.z) ** 2 : Infinity;
  }

  // A point at the Zu's height (the map rays are 3-D; the port's targets are XZ only).
  private p3(x: number, z: number): ZuPoint {
    return { x, y: this.y, z };
  }

  private distTo(p: { x: number; z: number }): number {
    return Math.hypot(p.x - this.x, p.z - this.z);
  }

  private inRange(range: number, arc: number): boolean {
    const t = this.tgt;
    if (!t) return false;
    return zuInRangeAndFacing({ dx: t.x - this.x, dz: t.z - this.z, heading: bamsOf(this.angle), flags: 0, range, arc });
  }

  private randU(): number {
    return Math.floor(this.rng() * 4294967296);
  }

  // The slot changes restart its animation; the one-shot rows chain to `next` when
  // the animation ends (the engine's reset of +0xb8).
  private setSlot(s: number): void {
    if (s === this.slot) return;
    this.slot = s;
    this.elapsed = 0;
    this.motionDirty = true;
  }

  private advanceAnimation(ended: boolean): void {
    const row = ZU_MOTIONS[this.slot];
    if (ended && row.next !== this.slot) this.setSlot(row.next);
    this.elapsed += ZU_MOTIONS[this.slot].speed;
  }

  // check_entity_animation_elapsed_threshold: threshold < elapsed <= threshold + stride.
  private crossed(threshold: number): boolean {
    const stride = ZU_MOTIONS[this.slot].speed;
    return threshold < this.elapsed && this.elapsed <= threshold + stride;
  }

  private motionOf(slot: number): EnemyAiMotion {
    const row = ZU_MOTIONS[slot];
    return { index: row.motion, speed: row.speed, loop: row.next === slot };
  }

}
