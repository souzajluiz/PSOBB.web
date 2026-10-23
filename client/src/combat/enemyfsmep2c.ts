// Episode 2 enemy state machines, third batch (PsoBB.exe, Ephinea 1.25.13,
// addresses are VAs): the Sinow family (Sinow Berill / Sinow Spigell, Sinow
// Zoa / Sinow Zele), Deldepth and Delbiter. Same EnemyBrain shape as
// combat/enemyfsm.ts and combat/enemyfsmep2.ts, so render/combat.ts drives
// them the same way.
//
// None of these classes sits on the Booma substrate of enemyfsmep2.ts. They
// are written directly against the enemy base (CreateEnemyInstance_005216f4)
// and its per-frame update, which every class here shares:
//   Update (vtable +0x04):   the state's transition check (handler argument 3)
//     unless the state was changed from outside since the last update (the
//     hit handler, vtable +0x160 compares the two state fields), then the
//     state's frame (argument 0), then the two state fields are synced.
//   SetEnemyAiState_0051f62c: leave the old state (argument 5), enter the new
//     one (argument 4).
// A handler is `ProcessState(state, argument)` at vtable +0x164; its entry
// code writes the animation id (+0xb8), the state the enemy returns to after a
// flinch (SetEnemyField0x380, +0x380) and the vtable +0x184 / +0x188 pair
// (vanish: the entity flags 0x4040000 with the hit boxes off / reappear).
//
// The animation clock (Player__Animate 0x007a9e1c area, check_entity_
// animation_elapsed_threshold 0x007aaa30) is reproduced by ExeBrain below,
// from the rows of the enemy's motion table and the real frame counts of its
// motions: elapsed += the row's speed on every Animate; a one-shot motion
// (row mode 3) is "ended" (animation flag 0x10, sticky until the next
// animation starts) once elapsed >= frame count - 1.0 (g_AnimationTimeOffset
// 0x0097d97c); a threshold test fires on the one tick on which elapsed passes
// it (threshold < elapsed <= threshold + speed). The brains run this clock
// themselves, so a state never waits for the owner's motion to end; the owner
// still plays the motions the brain asks for (AiFrame.motion). ASSUMED: the
// cross-fade a new animation starts with (animation type 4, ends with
// animation flag 8) is over within the tick the animation starts.
//
// Mapping of "enemy tables" and fields used by all brains (names from the
// dump are FidDB guesses and often wrong, see docs/HANDOFF.md):
//   enemy+0x32e AI state, +0x380 resume state, +0x398 target entity,
//   +0x39c.. target position, +0x3a8 / +0x3b0 unit vector to the target,
//   +0x3b4 its length, +0x3b8 / +0x3bc target search timer / interval (30),
//   +0x42c state sub-step, +0x430 / +0x438 / +0x43c per-state scratch.
//
// The Episode 2 decompilation psobb-client-source (JP build) has no C for any
// of these classes; everything here is the Ephinea dump (src/Psobb.exe-*.c)
// plus Ghidra on the same build (the community .gzf, scratch project).

import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyAiMotion } from './enemyai.ts';
import { bamsSin } from './derollefins.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, loop, nearest, once, PLAYER_RADIUS, turnToward, wrap } from './enemyfsm.ts';
import { EnemyShot, PLAYER_AIM_HEIGHT, TechBolt, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { enemyFire, inTechReach } from './techfire.ts';
import { TECH } from './techniques.ts';
import { STATUS } from './status.ts';
import { delLilyMegid } from './enemyfsmruins.ts';
import { exhaustive } from '../exhaustive.ts';

export const EMPTY_MV: EnemyMovementData = { fparam1: 0, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [0, 0, 0, 0, 0, 0] };

// g_AnimationTimeOffset (0x0097d97c).
export const ANIM_END_OFFSET = 1;
// The target search interval every enemy sets in its constructor
// (unknown_set_state_interval_maybe(this, 0x1e), enemy+0x3bc).
export const TARGET_INTERVAL = 30;
// The effect object InitializeEnemyStateTimer_00576c48 starts (vtable
// 0x00b069b0, ParticleEffectInstance): t = -30 * 0.2 = -6.0 (0x0092720c), +0.2 a
// frame (2.0 / 10, DragonSetSpeedFactor_00576a64 with 10), done at t >= 2.0
// (0x00927234); its progress is -1 while t <= 0, else t - 1. The other
// direction (ParticleEffectInstance_ResetValues_00512324: t = 2.0, then
// Update_00576a98: t -= 0.2, done at t <= 0) is the dissolve.
export const FX = {
  start: Math.fround(-6),
  step: Math.fround(0.2),
  done: 2,
  reset: 2,
  visible: Math.fround(-0.75),
} as const;

// angle in BAMS (0x10000 = a turn) <-> the radians of the brains.
export const bamsToRad = (b: number): number => b * BAMS_TO_RAD;
export const radToBams = (r: number): number => Math.trunc(r / BAMS_TO_RAD);

// The exe's direction vector of a heading: (sin, cos) (int_sin / int_cos of
// the 16-bit heading at +0x60).
export function inFront(angle: number, dirX: number, dirZ: number): number {
  return Math.sin(angle) * dirX + Math.cos(angle) * dirZ;
}

// One row of an enemy's motion table (the rows formats/enemymodels.ts and
// combat/enemymotions.ts cite): the motion entry of the archive, the frames
// per tick and whether the row loops (mode 1).
export interface MotionRow {
  readonly motion: EnemyAiMotion;
  readonly frames: number; // frame count of the motion in the real archive
}

export const row = (index: number, speed: number, frames: number, looping = false): MotionRow => ({
  motion: looping ? loop(index, speed) : once(index, speed),
  frames,
});

// The shared brain scaffolding: the exe's animation clock, the target search
// of FindEnemyTarget_00520ea0 and the target vector of SetEnemyTargetPosition
// + InitializeEnemyAnimationVelocity.
export abstract class ExeBrain extends BrainBase {
  abstract override state: string;
  confused = false;
  hpFraction = 1; // the owner keeps it current
  // The animation clock (enemy+0xc0 elapsed, +0xc8 step, 0xb0 & 0x10 ended).
  protected elapsed = 0;
  protected stride = 0;
  protected frameCount = 1;
  protected ended = false;
  protected looping = false;
  // FindEnemyTarget_00520ea0's timer (+0x3b8, interval +0x3bc = 30).
  protected searchTimer = 0;
  // SetEnemyTargetPosition / InitializeEnemyAnimationVelocity: the unit vector
  // to the target (+0x3a8, +0x3b0) and its length (+0x3b4).
  protected dirX = 0;
  protected dirZ = 0;
  protected tdist = 0;

  constructor(x: number, z: number, angle: number, rng: () => number, phase = 0) {
    super(x, z, angle, rng);
    // InitializeEnemyStateInterval_005217fc: (entity_index + 3) % interval.
    this.searchTimer = (phase + 3) % TARGET_INTERVAL;
  }

  // Starts a motion row (the animation id write of a state's entry code).
  protected start(out: AiFrame, r: MotionRow): void {
    this.elapsed = 0;
    this.stride = r.motion.speed;
    this.frameCount = r.frames;
    this.looping = r.motion.loop;
    this.ended = false;
    this.play(out, r.motion);
  }

  // Player__Animate: one tick of the clock.
  protected animate(): void {
    this.elapsed = Math.fround(this.elapsed + this.stride);
    if (this.looping) {
      if (this.elapsed >= this.frameCount) this.elapsed = Math.fround(this.elapsed - this.frameCount);
    } else if (this.elapsed >= this.frameCount - ANIM_END_OFFSET) {
      // Animation type 3 turns into type 5 (it holds its last frame) and sets
      // the sticky flag 0x10.
      this.ended = true;
    }
  }

  // check_entity_animation_elapsed_threshold (0x007aaa30).
  protected crossed(threshold: number): boolean {
    return threshold < this.elapsed && this.elapsed <= Math.fround(this.stride + threshold);
  }

  // `threshold <= elapsed + step` (the look-ahead tests of the dash states).
  protected reaches(threshold: number): boolean {
    return threshold <= Math.fround(this.elapsed + this.stride);
  }

  // EnemyUpdateTarget_00520ebc via FindEnemyTarget_00520ea0(radius): the timer
  // counts calls; below the interval the current target is kept while it is
  // valid, on the interval the nearest player within `radius` is taken
  // (FindNearestPlayer_00521160, squared distance < radius squared; the
  // line-of-sight ray is not reproduced). The result is whether a target is
  // set (handle_setting_target_by_idx returns 1 / 0).
  protected find(targets: readonly AiTarget[], radius: number): AiTarget | null {
    if (this.searchTimer < TARGET_INTERVAL) {
      this.searchTimer++;
      const t = this.target(targets);
      if (!t) this.targetId = null;
      return t;
    }
    this.searchTimer = 0;
    const t = nearest(targets, this.x, this.z, radius);
    this.targetId = t ? t.clientId : null;
    return t;
  }

  // SetEnemyTargetPosition + InitializeEnemyAnimationVelocity.
  protected aim(t: AiTarget): void {
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const d = Math.hypot(dx, dz);
    this.tdist = d;
    if (d > 0) {
      this.dirX = dx / d;
      this.dirZ = dz / d;
    } else {
      this.dirX = dx;
      this.dirZ = dz;
    }
  }

  // UpdateEntityRotation_005214cc: turn toward the unit vector at +0x3a8 /
  // +0x3b0 by at most `rate` BAMS.
  protected turnToDir(rate: number): void {
    this.angle = turnToward(this.angle, Math.atan2(this.dirX, this.dirZ), bamsToRad(rate));
  }

  // The melee test of the player's vtable +0x50
  // (unknown_enemy_attack_should_push_defender 0x00772e60): the target inside
  // the attacker's AttackData max_x_distance plus the target's hit box radius
  // and within AttackData's angle of the heading. ASSUMED: the player's hit
  // box radius is PLAYER_RADIUS (5).
  protected inAttack(t: AiTarget, attack: EnemyAttackData | null): boolean {
    const reach = (attack?.distanceX ?? 0) + PLAYER_RADIUS;
    const arc = bamsToRad((attack?.angle ?? 0x2000) & 0xffff);
    return this.dist(t) <= reach && Math.abs(wrap(this.angleTo(t) - this.angle)) <= arc;
  }

}

// --- Sinow Berill / Sinow Spigell ------------------------------------------------
//
// The stealth Sinow of Episode 2 (the Sinow Beat / Gold of combat/enemyfsmmines.ts
// is another class). TObjEneMe3StelthReal: factory create_sinowberill
// 0x0059e028, ctor 0x0059e0a4 (vtable 0x00b0a120, Update 0x0059e288, state
// handler ProcessState 0x0059eb08 at +0x164, flinch hook +0x100 0x005a148c,
// tech-hit hook +0x60 0x005a13d8), init 0x0059e1a4 (set entry params), model
// bm_ene_me3_stelthshinowa.bml, motion table 0x009bffa0, class init
// 0x005a155c (static init of the run-time table values 0x005a1500). The name
// is Sinow Berill for param6 <= 0, Sinow Spigell for param6 > 0
// (0x0059e8f..: +0x3f8 is the float's bits, set_sinowberill_name_unitxt_id
// 0x0059e824); MovementData row 6 (Berill) / 0x10 (Spigell) of the episode's
// table, AI record 0x009c0108 {search 225, turn 0x600}, collision radius 8
// (0x009c0130). The exe's search radius for every FindEnemyTarget is 200.
//
// Set entry params (0x0059e1a4): param1 < 2 -> the Sinow starts cloaked
// (enemy+0x3c8 = 1; 2 or more: STELTH_DISABLE); it hangs from the ceiling
// (spawn state 3, animation 0) unless param1 < 1 or 2 <= param1 < 3 (ground
// spawn, state 1, animation 2); +0x3e0 = 0.4 + param3, +0x3e4 = 0.3 + param2,
// +0x3e8 = 0.1 + param5, +0x3ec = 0.5 + param4 (chances); +0x3f8 = param6.
// MovementData R (fields read as record + offset): fparam1 the chase speed,
// fparam3 the melee lunge speed, fparam4 / fparam5 the speeds of the melee
// and flinch rows (0x009c0018 / 0x009bffe8, at least 0.1, written by the
// class init), fparam6 the cast chance, iparam1 the Resta level (and the
// Ultimate Shifta / Deband), iparam2 the frames the cast holds, iparam3 the
// frames the melee holds on frame 25, iparam4 the Gifoie / Rafoie level.
//
// Motion table 0x009bffa0 (13 rows {mode, next, motion, speed, flags}); the
// speeds of rows 3 (0.8), 6 (0.7), 7 and 4 are written at run time by
// 0x005a1500 / 0x005a155c: row 0 t_wait (motion 0, 0.5 loop, ceiling), 1
// apper (1, 0.7), 2 wait (9, 0.5 loop), 3 backstep (2, 0.8), 4 damage (4,
// fparam5), 5 death (5, 0.6), 6 f_attack (6, 0.7, the lunge), 7 sword (7,
// fparam4, the melee), 8 transform (8, 1.0, the cast), 9 wait (9, 0.5 loop),
// 10 walk (10, 1.1 loop), 11 bareta (3, 0.7, the reveal), 12 transform (8,
// 1.0). Frame counts: 14 55 40 10 15 35 47 36 36 14 39.
//
// States (ProcessState argument 4 = enter, 3 = transition, 0 = frame, 5 =
// leave; "inv" = vtable +0x184 on entry: invulnerable and the hit boxes off,
// 0x4040000; flag 1 = busy: the hit handler does not flinch):
//   0 spawn (0x005a1aa4): inv; hidden; the spawn point; 6 frames, then the
//     ground rise (1) or the ceiling appear (3). Return state of 0xa.
//   1 rise (0x005a12ac): ground spawn, busy, inv, animation 2; the 40-frame
//     emergence effect (FX); when it is done: cloaked -> 2, else 0xd.
//   2 cloaked idle (0x005a1110): animation 9; turns toward the target
//     (0x500 a frame) when it is not within cos(0x1000); transition: no
//     target for 3600 frames -> 0xd; a target within 40 -> 0xd; otherwise the
//     lunge chance: while the engaged flag is clear and the target is 100..150
//     away, one in a hundred a frame -> 7 (a roll every 60 frames).
//   3 appear (0x005a1054): ceiling spawn, busy, hidden, inv, animation 0; the
//     emergence effect, then 4.
//   4 fade-in (0x005a0ef8): inv; animation 0, invisible until a player is
//     within 200, then the alpha grows 16 a frame; 31 frames after that -> 5.
//   5 drop (0x005a0c90): animation 1 (apper), busy: the ceiling Sinow falls
//     (-0.3 a frame^2 up to -5.0 a frame), the motion holds frame 29 until
//     it lands, then it plays out and animation 9 -> 0xd.
//   6 chase (0x005a0a74): animation 10; FindEnemyTarget(200); turns 0x500 a
//     frame and walks at fparam1 when the target is within cos(0x1000) of its
//     heading, else it turns in place. Transition: no target -> 0xd; the
//     target within 25 and cos(0x1e00) of the heading -> 8; the lunge
//     condition -> 7.
//   7 lunge (0x005a0590): animation 6, flag 0x10000 set; turns 0x1000 a frame
//     until frame 10; at frame 14 (look-ahead) it becomes invulnerable
//     (0x174) and slides (distance - 20) / 12.857 a frame along the target
//     direction for 9 / 0.7 frames; at frame 23 it is vulnerable again; at
//     frame 25 the usual hit; then slows by 0.85 a frame; the end -> 6.
//   8 melee (0x005a0348): animation 7 (sword), flag 0x10000; hits at frames
//     15 and 23 (0x0059dc48: the hit is the target's vtable +0x50 range test,
//     try_hit_entity(1.0), cause_knockback(3.0); the Berill's second hit
//     confuses with get_random_float <= 0.1666 (0x00929dfc)); turns 0x300 a
//     frame before frame 20; lunges at fparam3 on frames 0..5; at frame 25 it
//     waits iparam3 frames holding frame 25; the end (0x005a144c) -> chase
//     (first time with get_random_float >= 0.5) or the back step.
//   9 back step (0x0059ffcc): animation 3; turns 0x31c7 toward the target;
//     invulnerable from frame 15 to 24 (look-ahead) while it moves 80 / 11.25
//     a frame away; at the end: a cloaked-or-not roll for 0x11, then 0xc
//     (chance 0.5 + param4), 6, 0x10 or (Spigell) 0xb.
//   0xa return (0x0059fedc): inv; animation 8 and a 10-frame dissolve -> 0.
//   0xb cast (0x0059fd3c): animation 8; at its end Resta on itself at level
//     iparam1 (CreateSpecialAttackEntity_006eeeb4); Ultimate also Shifta at
//     5 and Deband at 10 frames (0x006f0984 / 0x006e2634); holds iparam2
//     frames -> 6.
//   0xc teleport (0x0059f830): busy, inv; animation 12 to its end, a
//     10-frame dissolve, then it moves to 20 units from the target at
//     (target heading + k * 0x4000 + 0x4000) (k from two rolls, the first
//     free place; the map tests are not reproduced: ASSUMED the first is free)
//     and becomes cloaked; -> 1 (get_random_float > +0x3e0) or 0x10 / 0xb.
//   0xd lost (0x0059f780): inv; animation 9; a target within 200 -> 6, after
//     90 frames -> 0xa.
//   0xe flinch (0x0059f640): the owner plays row 4; at its end a cloaked
//     Sinow reveals itself with get_random_float <= +0x3e8 (0x12), else it
//     returns to the state in +0x380.
//   0xf death (0x0059f3dc): kill().
//   0x10 Gifoie (0x0059f064): animation 10 while it turns 0x600 a frame to
//     the target, then animation 8; at frame 10 Gifoie (Rafoie in Ultimate)
//     at level iparam4 when the remaining angle is under half of AttackData's
//     angle; then 60 frames -> 6.
//   0x11 cloak (0x0059ee80): animation 12; cloaked at frame 25 -> 6.
//   0x12 reveal (0x0059ec74): animation 11; visible at frame 6 -> 6.
export const BERILL = {
  search: 200,
  spawnFrames: 5,
  idleWatchFrames: 0xe0f,
  idleNear: 40,
  idleLungeChance: Math.fround(0.01),
  idleLungeWait: 60,
  fadeFrames: 0x1e,
  fadeStep: 16,
  fadeMax: 255,
  fallStep: Math.fround(0.3),
  fallMax: 5,
  holdFrame: 29,
  chaseTurn: 0x500,
  turnFacing: 0x1000,
  meleeFacing: 0x1e00,
  meleeNear: 25,
  meleeHeight: 20,
  lungeMin: 100,
  lungeMax: 150,
  lungeStop: 20,
  lungeTurn: 0x1000,
  lungeTurnUntil: 10,
  lungeStart: 14,
  lungeEnd: 23,
  lungeHit: 25,
  lungeFrames: Math.fround(12.857), // 0x00a74718 (= 9 / 0.7)
  slide: Math.fround(0.85),
  meleeHits: [15, 23] as readonly number[],
  meleeTurn: 0x300,
  meleeTurnUntil: 20,
  meleeMoveUntil: 5,
  meleeHold: 25,
  confuseChance: Math.fround(0.1666),
  backChance: Math.fround(0.5),
  backTurn: 0x31c7,
  backStart: 15,
  backEnd: 24,
  backDistance: 80,
  backFrames: Math.fround(11.25), // 0x00a74714 (= 9 / 0.8)
  lostFrames: 0x59,
  homeDissolve: 10,
  warpRing: 20,
  warpStep: 0x4000,
  gifoieTurn: 0x600,
  gifoieFrame: 10,
  gifoieWait: 59,
  cloakFrame: 25,
  revealFrame: 6,
  knockback: 3,
} as const;

// Motion indices of bm_ene_me3_stelthshinowa.bml and their frame counts.
const BERILL_FRAMES = [14, 55, 40, 10, 15, 35, 47, 36, 36, 14, 39] as const;

export type BerillState =
  | 'spawn'
  | 'rise'
  | 'idle'
  | 'appear'
  | 'fade'
  | 'drop'
  | 'chase'
  | 'lunge'
  | 'melee'
  | 'backstep'
  | 'home'
  | 'cast'
  | 'warp'
  | 'lost'
  | 'flinch'
  | 'dead'
  | 'gifoie'
  | 'cloak'
  | 'reveal';

export interface BerillOptions {
  x: number;
  z: number;
  angle: number;
  params: readonly number[]; // set entry param1..6
  movement: EnemyMovementData | null; // MovementData row 6 (Berill) / 0x10 (Spigell)
  attack: EnemyAttackData | null;
  ultimate: boolean;
  // Height of the set position above the ground under it (a ceiling Sinow
  // hangs there until it drops: enemy+0x3dc).
  hang?: number;
  phase?: number; // the enemy index (the target search phase)
  rng?: () => number;
}

export class SinowBerillAi extends ExeBrain {
  state: BerillState = 'spawn';
  // The state handlers of the exe's enemy flags (+0x3d4): 1 busy, 2 hidden,
  // 0x10000 engaged; +0x3c8 cloaked.
  cloaked: boolean;
  private busy = false;
  private hide = false;
  private engaged = false;
  private invuln = true;
  private cur: readonly AiTarget[] = [];
  private deferred: EnemyAiMotion | null = null;
  private readonly spigell: boolean;
  private readonly ground: boolean;
  private readonly ultimate: boolean;
  private readonly mv: EnemyMovementData;
  private readonly attack: EnemyAttackData | null;
  private readonly hang: number;
  private readonly rows: readonly MotionRow[];
  private readonly spawnX: number;
  private readonly spawnZ: number;
  // +0x3e0 / +0x3e4 / +0x3e8 / +0x3ec.
  private readonly pCast: number;
  private readonly pCloak: number;
  private readonly pReveal: number;
  private readonly pWarp: number;
  private sub = 0; // +0x42c
  private count = 0; // +0x430
  private frames = 0; // the idle / lost / spawn frame counter
  private idleJump = 0;
  private hits = 0; // +0x3f4
  private resumeState: BerillState = 'chase';
  private skip = false;
  private fxT = 0;
  private fxP = -1;
  private lift = 0;
  private fall = 0;
  private speed = 0; // +0x438
  private slide = 0; // +0x43c
  private back = 0; // +0x434 as radians
  private flinchPending = false;

  constructor(opts: BerillOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random, opts.phase ?? 0);
    const p = (i: number) => opts.params[i] ?? 0;
    this.spigell = p(5) > 0;
    this.mv = opts.movement ?? EMPTY_MV;
    this.attack = opts.attack;
    this.ultimate = opts.ultimate;
    this.hang = opts.hang ?? 0;
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    // get_sinow_param_ceiling_spawn 0x0059e254 (1 = ground).
    const p1 = p(0);
    this.ground = p1 < 1 || (p1 >= 2 && p1 < 3);
    this.cloaked = p1 < 2; // 0x00929dd0
    this.pCast = Math.fround(Math.fround(0.4) + p(2));
    this.pCloak = Math.fround(Math.fround(0.3) + p(1));
    this.pReveal = Math.fround(Math.fround(0.1) + p(4));
    this.pWarp = Math.fround(Math.fround(0.5) + p(3));
    const f = BERILL_FRAMES;
    this.rows = [
      row(0, 0.5, f[0], true),
      row(1, 0.7, f[1]),
      row(9, 0.5, f[9], true),
      row(2, 0.8, f[2]), // run-time value of 0x009bffd8
      row(4, Math.max(this.mv.fparam5, Math.fround(0.1)), f[4]),
      row(5, 0.6, f[5]),
      row(6, 0.7, f[6]), // run-time value of 0x009c0008
      row(7, Math.max(this.mv.fparam4, Math.fround(0.1)), f[7]),
      row(8, 1, f[8]),
      row(9, 0.5, f[9], true),
      row(10, 1.1, f[10], true),
      row(3, 0.7, f[3]),
      row(8, 1, f[8]),
    ];
    this.current = this.rows[this.ground ? 2 : 0].motion;
    this.stride = this.current.speed;
    this.frameCount = BERILL_FRAMES[this.current.index];
    this.looping = true;
    this.lift = this.hang;
    this.hide = true;
    this.resumeState = this.ground ? 'rise' : 'appear';
  }

  // Row 4 at the run-time speed (the owner plays it as the flinch).
  get flinchMotion(): EnemyAiMotion {
    return this.rows[4].motion;
  }

  get deathMotion(): EnemyAiMotion {
    return this.rows[5].motion;
  }

  get invulnerable(): boolean {
    return this.invuln;
  }

  // Flag 1: the hit handler 0x005a148c does not flinch.
  get superArmor(): boolean {
    return this.busy;
  }

  get hidden(): boolean {
    return this.hide || (this.state === 'fade' && this.sub === 0);
  }

  // Whether the hit that was just reported starts the flinch (the owner asks
  // right after onDamage).
  flinches(): boolean {
    const f = this.flinchPending;
    this.flinchPending = false;
    return f;
  }

  private slot(i: number): MotionRow {
    return this.rows[i];
  }

  // The vtable +0x1b0 test (0x0059dd64): not engaged and the target 100..150
  // away (the collision probe of SetTransform is not reproduced: ASSUMED the
  // path is clear).
  private lungeOk(): boolean {
    return !this.engaged && BERILL.lungeMin < this.tdist && this.tdist < BERILL.lungeMax;
  }

  private move(dx: number, dz: number, v: number): void {
    this.x += dx * v;
    this.z += dz * v;
  }

  // The effect timer (InitializeEnemyStateTimer_00576c48 / vtable +0x14).
  private fxStart(): void {
    this.fxT = FX.start;
    this.fxP = -1;
  }

  private fxUp(): boolean {
    this.fxT = Math.fround(this.fxT + FX.step);
    const t = this.fxT;
    this.fxP = t <= 0 ? -1 : t < 2 ? (Math.fround(t - 1) === 0 ? 0.01 : Math.fround(t - 1)) : 1;
    return t >= FX.done;
  }

  // ParticleEffectInstance_Update_00576a98 (the dissolve).
  private fxDown(): boolean {
    this.fxT = Math.fround(this.fxT - FX.step);
    return this.fxT <= 0;
  }

  private enter(out: AiFrame, s: BerillState): void {
    // Argument 5 of the old state.
    if (this.state === 'lunge' || this.state === 'backstep') this.invuln = false;
    if (this.state === 'drop') this.busy = false;
    this.state = s;
    this.sub = 0;
    switch (s) {
      case 'spawn':
        this.resumeState = this.ground ? 'rise' : 'appear';
        this.busy = false;
        this.hide = true;
        this.invuln = true;
        if (this.ultimate) this.engaged = false;
        if (this.x !== this.spawnX || this.z !== this.spawnZ) this.warps++;
        this.x = this.spawnX;
        this.z = this.spawnZ;
        this.frames = 0;
        this.hits = 0;
        this.start(out, this.slot(this.ground ? 2 : 0));
        break;
      case 'rise':
        this.resumeState = 'spawn';
        this.busy = true;
        this.hide = false;
        this.invuln = true;
        this.fxStart();
        this.start(out, this.slot(2));
        break;
      case 'idle':
        this.resumeState = 'lost';
        this.busy = false;
        this.hide = false;
        this.invuln = false;
        this.frames = 0;
        this.idleJump = 0;
        this.start(out, this.slot(9));
        break;
      case 'appear':
        this.resumeState = 'spawn';
        this.busy = true;
        this.hide = true;
        this.invuln = true;
        this.fxStart();
        this.start(out, this.slot(0));
        break;
      case 'fade':
        this.resumeState = 'drop';
        this.busy = false;
        this.hide = false;
        this.invuln = true;
        this.count = 0;
        this.start(out, this.slot(0));
        break;
      case 'drop':
        this.resumeState = 'lost';
        this.busy = true;
        this.hide = false;
        this.invuln = false;
        this.fall = 0;
        this.start(out, this.slot(1));
        break;
      case 'chase':
        this.resumeState = 'chase';
        this.busy = false;
        this.hide = false;
        this.invuln = false;
        this.tdist = 300; // 0x43960000
        this.speed = this.mv.fparam1;
        this.start(out, this.slot(10));
        break;
      case 'lunge':
        this.resumeState = 'chase';
        this.busy = false;
        this.hide = false;
        this.invuln = false;
        this.engaged = true;
        this.slide = 0;
        this.start(out, this.slot(6));
        break;
      case 'melee':
        this.resumeState = 'warp';
        this.busy = false;
        this.hide = false;
        this.invuln = false;
        this.engaged = true;
        this.count = 0;
        this.start(out, this.slot(7));
        break;
      case 'backstep':
        this.resumeState = 'chase';
        this.busy = false;
        this.hide = false;
        this.invuln = false;
        this.hits = 0;
        this.sub = 3;
        this.start(out, this.slot(3));
        {
          // vtable +0x1a8 (FindDerolleTarget, not timer gated) with 200; then
          // the direction to the target turned round, 80 / 11.25 a frame.
          const t = nearest(this.cur, this.x, this.z, BERILL.search);
          this.targetId = t ? t.clientId : null;
          if (t) {
            this.aim(t);
            this.back = Math.atan2(this.dirX, this.dirZ);
            this.dirX = -this.dirX;
            this.dirZ = -this.dirZ;
            this.speed = Math.fround(BERILL.backDistance / BERILL.backFrames);
            this.sub = 0; // ASSUMED: the probe 80 units back (SetTransform) is clear
          }
        }
        break;
      case 'home':
        this.resumeState = 'chase';
        this.busy = false;
        this.hide = false;
        this.invuln = true;
        this.sub = 1;
        this.fxT = FX.reset;
        this.start(out, this.slot(8));
        break;
      case 'cast':
        this.resumeState = 'cast';
        this.busy = true;
        this.hide = false;
        this.invuln = false;
        this.count = 0;
        this.start(out, this.slot(8));
        break;
      case 'warp':
        this.resumeState = 'warp';
        this.busy = true;
        this.hide = false;
        this.invuln = true;
        this.start(out, this.slot(12));
        break;
      case 'lost':
        this.resumeState = 'lost';
        this.busy = false;
        this.hide = false;
        this.invuln = true;
        this.hits = 0;
        this.count = 0;
        this.start(out, this.slot(9));
        break;
      case 'flinch':
        break;
      case 'dead':
        break;
      case 'gifoie':
        this.resumeState = 'chase';
        this.busy = false;
        this.hide = false;
        this.invuln = false;
        this.engaged = true;
        this.start(out, this.slot(10));
        break;
      case 'cloak':
        this.resumeState = 'chase';
        this.busy = true;
        this.hide = false;
        this.invuln = false;
        this.start(out, this.slot(12));
        break;
      case 'reveal':
        this.resumeState = 'chase';
        this.busy = true;
        this.hide = false;
        this.invuln = false;
        this.start(out, this.slot(11));
        break;
      default:
        exhaustive(s);
    }
  }

  // The hit handler (vtable +0x100, 0x005a148c): outside the busy states the
  // Sinow flinches (state 0xe); inside them a cloaked one may reveal itself.
  onDamage(_clientId: number): void {
    if (this.state === 'dead') return;
    const out = this.frame();
    if (!this.busy) {
      if (this.state !== 'flinch') {
        this.flinchPending = true;
        this.state = 'flinch';
        this.current = null;
        this.skip = true;
      }
    } else if (this.cloaked && Math.fround(this.rng()) <= this.pReveal) {
      this.enter(out, 'reveal');
      this.deferred = this.current;
      this.skip = true;
    }
  }

  // The end of the flinch (0x0059f640 argument 3).
  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    if (this.cloaked && Math.fround(this.rng()) <= this.pReveal) this.enter(out, 'reveal');
    else this.enter(out, this.resumeState);
    this.skip = true;
    return this.state;
  }

  override kill(): void {
    this.invuln = false;
    super.kill();
  }

  tick(targets: readonly AiTarget[], _animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.cur = targets;
    if (this.skip) this.skip = false;
    else this.transition(out, targets);
    this.run(out, targets);
    if (this.deferred) {
      out.motion ??= this.deferred;
      this.deferred = null;
    }
    out.lift = this.lift;
    out.hidden = this.hidden;
    return this.finish(out);
  }

  // Argument 3 of the current state.
  private transition(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.state) {
      case 'spawn':
        if (this.frames > BERILL.spawnFrames) this.enter(out, this.ground ? 'rise' : 'appear');
        break;
      case 'rise':
        if (this.fxUp()) this.enter(out, this.cloaked ? 'idle' : 'lost');
        break;
      case 'appear':
        if (this.fxUp()) this.enter(out, 'fade');
        break;
      case 'fade':
        if (this.sub > BERILL.fadeFrames) this.enter(out, 'drop');
        break;
      case 'drop':
        if (this.sub === 3) this.enter(out, 'lost');
        break;
      case 'idle': {
        const t = this.find(targets, BERILL.search);
        if (!t) {
          if (this.frames > BERILL.idleWatchFrames) this.enter(out, 'lost');
          break;
        }
        if (this.tdist <= BERILL.idleNear) {
          this.enter(out, 'lost');
          break;
        }
        this.idleJump--;
        if (this.idleJump < 1 && this.lungeOk()) {
          this.idleJump = BERILL.idleLungeWait;
          if (Math.fround(this.rng()) <= BERILL.idleLungeChance) this.enter(out, 'lunge');
        }
        break;
      }
      case 'chase': {
        const t = this.target(targets);
        if (!t) {
          this.enter(out, 'lost');
          break;
        }
        // |dy| < 20 (flat ground: ASSUMED), within 25, within cos(0x1e00).
        if (this.tdist <= BERILL.meleeNear && inFront(this.angle, this.dirX, this.dirZ) >= Math.cos(bamsToRad(BERILL.meleeFacing))) this.enter(out, 'melee');
        else if (this.lungeOk()) this.enter(out, 'lunge');
        break;
      }
      case 'lunge':
        if (this.sub === 5 || this.ended) this.enter(out, 'chase');
        break;
      case 'melee':
        if (this.ended) {
          // FUN_005a144c (vtable +0x1b4).
          this.hits++;
          if (this.hits < 2 && Math.fround(this.rng()) >= 0.5) this.enter(out, 'chase');
          else this.enter(out, 'backstep');
        }
        break;
      case 'backstep':
        if (this.sub === 3) this.afterBackstep(out);
        break;
      case 'home':
        if (this.sub === 2) this.enter(out, 'spawn');
        break;
      case 'cast':
        if (this.mv.iparam[1] < this.count) this.enter(out, 'chase');
        break;
      case 'warp':
        if (this.sub === 2) this.afterWarp(out);
        break;
      case 'lost': {
        const t = this.find(targets, BERILL.search);
        if (t) this.enter(out, 'chase');
        else if (this.count > BERILL.lostFrames) this.enter(out, 'home');
        break;
      }
      case 'flinch':
      case 'dead':
        break;
      case 'gifoie':
        if (this.sub === 3) this.enter(out, 'chase');
        break;
      case 'cloak':
      case 'reveal':
        if (this.sub === 3) this.enter(out, 'chase');
        break;
      default:
        exhaustive(this.state);
    }
  }

  // 0x0059ffcc argument 3 (sub-step 3).
  private afterBackstep(out: AiFrame): void {
    if (!this.cloaked && Math.fround(this.rng()) <= this.pCloak) {
      this.enter(out, 'cloak');
      return;
    }
    if (this.pCast < Math.fround(this.rng())) {
      if (Math.fround(this.rng()) <= this.pWarp) this.enter(out, 'warp');
      else this.enter(out, 'chase');
      return;
    }
    if (!this.spigell) {
      this.enter(out, 'gifoie');
      return;
    }
    // 0x0059ffcc: Spigell casts with a roll above fparam6.
    if (this.mv.fparam6 < Math.fround(this.rng())) this.enter(out, 'gifoie');
    else this.enter(out, 'cast');
  }

  // 0x0059f830 argument 3.
  private afterWarp(out: AiFrame): void {
    this.cloaked = true; // +0x3c8 = 1, the cloak flag 0x8000000
    if (this.pCast < Math.fround(this.rng())) {
      this.enter(out, 'rise');
      return;
    }
    if (!this.spigell) {
      this.enter(out, 'gifoie');
      return;
    }
    if (Math.fround(this.rng()) <= this.mv.fparam6) this.enter(out, 'cast');
    else this.enter(out, 'gifoie');
  }

  // Argument 0 of the current state.
  private run(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.state) {
      case 'spawn':
        this.frames++;
        if (this.frames === 1) this.lift = this.hang;
        break;
      case 'rise':
        if (this.fxP >= FX.visible) this.animate();
        break;
      case 'appear':
        break;
      case 'fade':
        this.animate();
        if (this.sub === 0) {
          if (this.find(targets, BERILL.search)) {
            this.sub = 1;
            this.count = 0;
          }
        } else {
          this.sub++;
          this.count = Math.min(this.count + BERILL.fadeStep, BERILL.fadeMax);
          // cast_ray_from_enemy_to_target: ASSUMED always in sight.
        }
        break;
      case 'drop':
        this.runDrop(out);
        break;
      case 'idle': {
        this.frames++;
        this.animate();
        const t = this.find(targets, BERILL.search);
        if (t) {
          this.aim(t);
          this.slide = inFront(this.angle, this.dirX, this.dirZ);
          if (this.slide < Math.cos(bamsToRad(BERILL.turnFacing))) this.turnToDir(BERILL.chaseTurn);
        }
        break;
      }
      case 'chase': {
        this.animate();
        const t = this.find(targets, BERILL.search);
        if (t) {
          this.aim(t);
          const dot = inFront(this.angle, this.dirX, this.dirZ);
          this.slide = dot;
          this.turnToDir(BERILL.chaseTurn);
          if (Math.cos(bamsToRad(BERILL.turnFacing)) <= dot) this.move(Math.sin(this.angle), Math.cos(this.angle), this.speed);
        }
        break;
      }
      case 'lunge':
        this.runLunge(out, targets);
        break;
      case 'melee':
        this.runMelee(out, targets);
        break;
      case 'backstep':
        this.runBackstep(targets);
        break;
      case 'home':
        this.animate();
        if (this.sub === 1 && this.fxDown()) this.sub = 2;
        break;
      case 'cast':
        this.runCast(out);
        break;
      case 'warp':
        this.runWarp(targets);
        break;
      case 'lost':
        this.count++;
        this.animate();
        break;
      case 'flinch':
      case 'dead':
        break;
      case 'gifoie':
        this.runGifoie(out, targets);
        break;
      case 'cloak':
        this.animate();
        if (!this.ended) {
          // The advanced-effects branch (the other one sets the flag back to
          // 0, which the exe also does in 0x0059ee80: ASSUMED the setting is on).
          if (this.crossed(BERILL.cloakFrame)) this.cloaked = true;
        } else this.sub = 3;
        break;
      case 'reveal':
        this.animate();
        if (!this.ended) {
          if (this.crossed(BERILL.revealFrame)) this.cloaked = false;
        } else this.sub = 3;
        break;
      default:
        exhaustive(this.state);
    }
  }

  // 0x005a0c90 argument 0.
  private runDrop(out: AiFrame): void {
    if (this.sub === 0) {
      this.animate();
      this.sub = 1;
    } else if (this.sub === 1) {
      this.animate();
      if (this.elapsed >= BERILL.holdFrame) this.elapsed = BERILL.holdFrame;
      this.fall = Math.max(Math.fround(this.fall - BERILL.fallStep), -BERILL.fallMax);
      // ASSUMED: without the animation's own root-height compensation.
      this.lift = Math.fround(this.lift + this.fall);
      if (this.lift < 0) {
        this.lift = 0;
        this.sub = 2;
      }
    } else if (this.sub === 2) {
      if (this.ended) {
        this.sub = 3;
        this.lift = 0;
        this.start(out, this.slot(9));
      }
      this.animate();
    }
  }

  // 0x005a0590 argument 0.
  private runLunge(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.target(targets);
    this.animate();
    switch (this.sub) {
      case 0:
        // Waits for the cross-fade (animation flag 8): ASSUMED immediate.
        this.sub = 1;
        break;
      case 1:
        if (t) {
          this.aim(t);
          this.turnToDir(BERILL.lungeTurn);
        }
        if (this.crossed(BERILL.lungeTurnUntil)) this.sub = 2;
        break;
      case 2:
        if (t) this.aim(t);
        if (this.reaches(BERILL.lungeStart)) {
          // The probe along the path and the ground / room tests are not
          // reproduced: ASSUMED they pass.
          this.slide = Math.fround((this.tdist - BERILL.lungeStop) / BERILL.lungeFrames);
          this.sub = 3;
          this.invuln = true;
        }
        break;
      case 3:
        if (this.reaches(BERILL.lungeEnd)) {
          this.sub = 4;
          this.invuln = false;
        }
        this.move(this.dirX, this.dirZ, this.slide);
        break;
      case 4:
        if (this.crossed(BERILL.lungeHit)) this.tryHit(out, t, false);
        this.slide = Math.fround(this.slide * BERILL.slide);
        this.move(this.dirX, this.dirZ, this.slide);
        break;
      default:
        break;
    }
  }

  // try_hit_entity(1.0) + cause_knockback(3.0) on the current target.
  private tryHit(out: AiFrame, t: AiTarget | null, confuse: boolean): void {
    if (!t || !this.inAttack(t, this.attack)) return;
    out.hit = { clientId: t.clientId, knockback: BERILL.knockback, mult: 1 };
    if (confuse && !this.spigell && Math.fround(this.rng()) <= BERILL.confuseChance) out.status = { clientId: t.clientId, type: STATUS.confusion };
    // ASSUMED not reproduced: the Spigell's hit unequips the player's weapon
    // (Player_UnequipItem_0068dfd8, 0x0059dc48).
  }

  // 0x005a0348 argument 0.
  private runMelee(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.target(targets);
    this.animate();
    if (this.sub === 0) {
      // 0x0059dc48: the two hits.
      const second = this.crossed(BERILL.meleeHits[1]);
      if (second || this.crossed(BERILL.meleeHits[0])) this.tryHit(out, t, second);
      if (this.elapsed < BERILL.meleeTurnUntil) {
        let desired = this.angle;
        if (t) {
          this.aim(t);
          desired = Math.atan2(this.dirX, this.dirZ);
        }
        this.angle = turnToward(this.angle, desired, bamsToRad(BERILL.meleeTurn));
        this.dirX = Math.sin(this.angle);
        this.dirZ = Math.cos(this.angle);
      }
      if (this.elapsed >= 0 && this.elapsed <= BERILL.meleeMoveUntil) this.move(this.dirX, this.dirZ, this.mv.fparam3);
      if (this.elapsed >= BERILL.meleeHold) {
        this.sub = 1;
        this.elapsed = BERILL.meleeHold;
      }
    } else if (this.sub === 1) {
      this.count++;
      if (this.count <= this.mv.iparam[2]) this.elapsed = BERILL.meleeHold;
    }
  }

  // 0x0059ffcc argument 0 (the entry code is in backStart).
  private runBackstep(targets: readonly AiTarget[]): void {
    void targets;
    this.animate();
    if (this.sub === 0) {
      this.angle = turnToward(this.angle, this.back, bamsToRad(BERILL.backTurn));
      if (this.reaches(BERILL.backStart)) {
        this.sub = 1;
        this.invuln = true;
      }
    } else if (this.sub === 1) {
      if (this.reaches(BERILL.backEnd)) {
        this.sub = 2;
        this.invuln = false;
      }
      this.move(this.dirX, this.dirZ, this.speed);
    } else if (this.sub === 2) {
      if (this.ended) this.sub = 3;
    }
  }

  // 0x0059fd3c argument 0.
  private runCast(out: AiFrame): void {
    this.animate();
    if (this.sub === 0) {
      if (this.ended) {
        // CreateSpecialAttackEntity_006eeeb4: the Sinow's own Resta.
        out.heal = { level: this.techLevel() };
        this.sub = this.ultimate ? 2 : 1;
        this.count = 0;
      }
    } else if (this.sub === 1) this.count++;
    else if (this.sub === 2) {
      this.count++;
      // ASSUMED not reproduced: Shifta at 5 and Deband at 10 on the Sinow
      // (0x006f0984 / 0x006e2634); the client has no enemy buff to apply.
      if (this.count === 10) {
        this.sub = 1;
        this.count = 0;
      }
    }
  }

  // constrain_tech_level (0x00520e3c): 0-based, 0..13 (Ultimate 0..28).
  private techLevel(): number {
    return Math.max(0, Math.min(this.ultimate ? 28 : 13, this.mv.iparam[0]));
  }

  // 0x0059f830 argument 0.
  private runWarp(targets: readonly AiTarget[]): void {
    if (this.sub === 0) {
      this.animate();
      if (this.ended) {
        this.sub = 1;
        this.fxT = FX.reset;
      }
    } else if (this.sub === 1 && this.fxDown()) {
      this.hide = true;
      const t = this.find(targets, BERILL.search);
      if (t) this.teleport(t);
      this.sub = 2;
    }
  }

  // The ring round the target (0x0059f830): a0 = trunc(3 r) - 1, a1 = ..., the
  // first of the three places is taken (the map tests are not reproduced).
  private teleport(t: AiTarget): void {
    // a0 = trunc(3 r) - 1 (0x00929d14 = 3.0); the second roll (a1 = trunc(2 r) -
    // 1, or trunc(2 r) when it is not above a0) and a2 = -(a0 + a1) are the
    // places tried next when the first is blocked. ASSUMED: the first is free.
    const a0 = Math.trunc(3 * this.rng()) - 1;
    const r2 = this.rng();
    const a1 = Math.trunc(r2 + r2) - 1;
    void a1;
    const heading = radToBams(t.angle ?? 0);
    const ang = a0 * BERILL.warpStep + BERILL.warpStep + heading;
    const rad = bamsToRad(ang);
    this.x = Math.fround(t.x + Math.cos(rad) * BERILL.warpRing);
    this.z = Math.fround(t.z - Math.sin(rad) * BERILL.warpRing);
    this.angle = wrap(bamsToRad(ang + 0xc000));
    this.warps++;
  }

  // EnemyAI_UpdateRotation_00771858 with the AI record's turn rate (0x600):
  // turns toward the target; returns the angle left (radians).
  private rotateTo(t: AiTarget): number {
    const want = Math.atan2(t.x - this.x, t.z - this.z);
    this.angle = turnToward(this.angle, want, bamsToRad(BERILL.gifoieTurn));
    return Math.abs(wrap(want - this.angle));
  }

  // 0x0059f064 argument 0. Sub-step 1 plays the cast, 2 waits, 3 leaves; 0
  // turns toward the target on animation 10 until it is within 0x100.
  private runGifoie(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.target(targets);
    if (this.sub === 1) {
      this.animate();
      if (this.ended) {
        this.count = 0;
        this.sub = 2;
      }
      if (this.crossed(BERILL.gifoieFrame)) {
        // The hand position (a model node) is ASSUMED to be the Sinow itself.
        const half = bamsToRad(((this.attack?.angle ?? 0x2000) & 0xffff) / 2);
        if (t && this.rotateTo(t) < half) this.castGifoie(out, t);
        else this.sub = 3;
      }
    } else if (this.sub === 2) {
      this.count++;
      if (this.count > BERILL.gifoieWait) this.sub = 3;
    } else if (!t) this.enter(out, 'chase');
    else if (this.rotateTo(t) < bamsToRad(0x100)) {
      this.sub = 1;
      this.start(out, this.slot(8));
    }
  }

  // 0x00586d00 area: Ultimate makes CreateRafoieEffectEntity_006ed87c at the target
  // position the Sinow remembered (+0x39c), else create_gifoie at its hand node
  // (combat/techfire.ts; ASSUMED the node is 10 above the Sinow's feet).
  private castGifoie(out: AiFrame, t: AiTarget): void {
    const level = this.techLevel2();
    const shot = this.ultimate
      ? enemyFire({ tech: TECH.rafoie, level, x: t.x, y: PLAYER_AIM_HEIGHT, z: t.z, heading: this.angle, fixed: true, enemy: true })
      : enemyFire({ tech: TECH.gifoie, level, x: this.x, y: 10, z: this.z, heading: this.angle, enemy: true });
    if (shot) (out.shots ??= []).push(shot);
  }

  private techLevel2(): number {
    return Math.max(0, Math.min(this.ultimate ? 28 : 13, this.mv.iparam[3]));
  }
}

// --- Sinow Zoa / Sinow Zele --------------------------------------------------------
//
// Class TObjEneMe3SinowZoaReal (set type 0xe0 outside the Epsilon area; the
// dump calls everything here "Sinowzoa..." which for once is right). Create
// 0x005914dc, constructor 0x00591558 (base 0x005915ec, vtable 0x00b08f00,
// name block 0x009bfb64), parameters 0x00591658, init 0x00595234, dispatcher
// handle_sinowzoa_behavior 0x00591f20 (vtable +0x164), Update 0x0059173c
// (vtable +0x04), table 0x009bfa00, AI record 0x009bfb68 {search 225, turn
// 0x600}, collision radius 12.0 (0x009bfb90, written by the static init
// 0x00594bd4 with the animation speeds below). Model bm_ene_me3_shinowa_zoa.bml.
//
// It is the Sinow Berill's machine (combat/enemyfsmep2c.ts SinowBerillAi, class
// at 0x0059dc24..0x005a1be8) with the same 19 states and the same motion
// rows, on a Seabed body: the sub-step counter is enemy+0x43c (Berill 0x42c),
// the scratch fields are shifted by 0x10, and it differs in
//   - the lunge window (50 < distance < 150, 0x00929178 / 0x0092917c; the
//     Berill's is 100..150), the melee, which reveals a cloaked body for the
//     swing and has no frozen hold frame (the hold is iparam3 frames AFTER the
//     swing), and the cast / tech states, which also reveal it;
//   - the techniques: Zoa casts Resta on itself (CreateSpecialAttackEntity
//     _006eeeb4), Zele a Zalure (0x006f1eb0) and a Jellen (0x006e7998) at its
//     own position (the players inside the technique's range get them), the
//     tech state throws the sorcerer technique 0x006e38e0 (a bolt: speed 3.0
//     0x006efe50 +0x64, 30 range 0x41f00000, box radius 4.0) or, in Ultimate,
//     Rabarta (0x006ec8ec); Ultimate adds Shifta (0x006f0984) and Deband
//     (0x006e2634) to the cast states;
//   - the cloak (entity flag 0x8000000, enemy+0x3c8 "stealth enabled", flag
//     0x100000 "revealed for the attack", the effect object at +0x41c, vtable
//     0x00b069b0) is a timed effect shared by all states, and the per-frame
//     SinowzoaHandlePlayerInteraction_005917e0 (called by Update after the
//     state) ends it when the body is frozen or shocked. The effect is kept
//     (fx*) because its value times the teleport / cloak states;
//   - the dissolve of the teleport, home and cloak states runs at 2.0 / 30
//     per frame (DragonSetSpeedFactor_00576a64 with 0x1e) instead of 0.2.
// MovementData rows (A_00928fa0): Zoa 67, Zele 68 (stats / attack / resist
// rows the same). Set entry: param1 < 2.0 -> stealth enabled (+0x3c8 = 1,
// 0x00929154), param1 in [1, 2) or >= 3 -> hangs from the ceiling (animation
// row 0, else row 2, 0x00591708), param2 + 0.3 (0x3f4) the chance to cloak
// again after the back step, param3 + 0.4 (0x3f0) the "go on without a
// technique" threshold, param4 + 0.5 (0x3fc) the teleport chance, param5 + 0.1
// (0x3f8) the chance to uncloak when hit, param6 > 0 -> Zele (+0x408, row 1).
// MovementData: fparam1 chase speed (0x448), fparam3 swing advance, fparam4
// swing speed, fparam5 flinch speed (rows 7 / 4 of the table, written at run
// time 0x00594c30 with a floor of 0.1, 0x00928fc4), fparam6 the cast chance,
// iparam1 the technique level of the cast, iparam2 the cast's wait, iparam3
// the swing's hold, iparam4 the tech's level.
//
// States (exe ids), handler address, row (animation id +0xb8), resume (+0x380):
//   0 spawn 0x005950f0 (row 2 / 0, hidden 6 frames, back to the spawn point)
//   1 rise 0x00594934 (row 2, the 40-frame emergence effect; then 2 when stealth
//     is enabled, else 0xd)                                         resume 0
//   2 wait 0x00594794 (row 9; turns to a target in 200; within 40 -> 0xd; with
//     the lunge window open 1% per 60 frames -> lunge)              resume 0xd
//   3 appear 0x005946d8 (ceiling: hidden, effect) -> 4              resume 0
//   4 fade 0x0059457c (row 0; invisible until a target within 200, then +16 alpha a
//     frame; 31 frames -> 5)                                         resume 5
//   5 drop 0x00594294 (row 1, from the ceiling: gravity 0.3, max 5.0)  resume 0xd
//   6 chase 0x0059405c (row 10, speed fparam1, turn 0x500)             resume 6
//   7 lunge 0x00593ae8 (row 6; dash of distance - 20 over 12.857 ticks, hit at 25)
//   8 melee 0x005937a8 (row 7)                                          resume 0xc
//   9 back step 0x00593438 (row 3; 80 units over 11.25 ticks)           resume 6
//   0xa home 0x00593330 (row 8, 30-frame dissolve -> 0)                 resume 6
//   0xb cast 0x00592fdc (row 8)                                         resume 0xb
//   0xc teleport 0x00592ac4 (row 12)                                    resume 0xc
//   0xd lost 0x00592a10 (row 9; 90 frames, a target in 200 -> 6)        resume 0xd
//   0xe flinch 0x005928c0 (row 4, played by the owner)
//   0xf death 0x005926c4 (row 5, played by the owner)
//   0x10 tech 0x00592250 (rows 10 / 8)                                  resume 6
//   0x11 cloak 0x0059213c (row 12)                                      resume 6
//   0x12 reveal 0x00592038 (row 11)                                     resume 6
// Hit handler (vtable +0x100, 0x00594b68): not busy (flag 1) -> flinch (0xe);
// busy: stealth and get_random_float <= +0x3f8 -> reveal. The technique hit
// (vtable +0x60, 0x00594a6c) does the same roll after the damage and wakes the
// waiting state (2 -> 6): the owner reports both as onDamage (ASSUMED the
// melee handler for all).
//
// ASSUMED / not reproduced: the map tests (wall probe and ground checks of the
// lunge and the back step: open ground, the teleport takes the first of its
// three candidate places), the vertical difference of the chase (the body is
// on the target's level: the 20-unit test that sends it teleporting is never
// taken), the cross-fade of a new animation (over within the tick), the hand
// node the technique leaves from (the body's position), the Gibarta
// identification of 0x006e38e0 (a straight ice bolt of speed 3.0), Rabarta as
// a one-frame disc of the technique's range around the body, the Ultimate
// Shifta / Deband on the allies, the Zele's weapon removal, knockback glide of
// the flinch, sound and particles. The non-"advanced effects" branch of the
// cloak is not read (the advanced one is).


export const ZOA = {
  search: 200, // FindEnemyTarget_00520ea0(200.0)
  turn: 0x500, // chase / wait rotation
  faceCos: 0x1000, // cos(0x1000): the chase moves when facing within this
  meleeRange: 25, // 0x00929034
  meleeCos: 0x1e00,
  lungeMin: 50, // 0x0092917c
  lungeMax: 150, // 0x00929178
  lungeStop: 20, // 0x00929174
  waitNear: 40, // 0x00929004
  waitJump: Math.fround(0.01), // 0x00929000
  waitReload: 60, // 0x3c
  waitLimit: 0xe0f,
  lostFrames: 0x59,
  fadeFrames: 30,
  fadeAlpha: 0x10,
  spawnFrames: 5,
  dropGravity: Math.fround(0.3), // 0x00929028
  dropMax: 5, // 0x00929024
  dropPose: 29, // 0x0092902c
  lungeTurn: 0x1000,
  lungeTurnUntil: 10,
  lungeProbe: 14, // 0x00929048
  lungeAppear: 23, // 0x0092904c
  lungeRelease: 15, // 0x00929050
  lungeHit: 25,
  lungeFrames: Math.fround(12.857), // 0x00a744b4 (static init 0x00594be8)
  slide: Math.fround(0.85), // 0x00929064
  swingTurn: 0x300,
  swingTurnUntil: 20, // 0x0092908c
  swingMoveFrom: 0, // 0x00929088
  swingMoveTo: 5, // 0x00929084
  swingHits: [15, 23] as readonly number[],
  confuseChance: Math.fround(0.1666), // 0x00929180
  backTurn: 0x31c7,
  backVanish: 15, // 0x00929098
  backAppear: 24, // 0x0092909c
  backDistance: 80, // 0x00929094
  backFrames: Math.fround(11.25), // 0x00a744b0
  warpRadius: 20, // 0x009290b0 / 0x009290b8
  warpCandidates: 3, // 0x009290bc
  techTurn: 0x600, // AI record 0x009bfb68 +8
  techAim: 0x100,
  techFrame: 10,
  techWait: 0x27,
  retreatChance: Math.fround(0.5), // 0x00928ff4
  fxCloak: 30, // DragonSetSpeedFactor(0x1e)
  fxReveal: Math.fround(0.05), // 0x3d4ccccd
  fxRevealTo: Math.fround(0.2),
  knockback: 3,
  // The bolt of 0x006efe50 (+0x64 speed, +0x70 range, +0x12c box radius).
  boltSpeed: 3,
  boltRange: 36,
  boltRadius: 4,
  boltHeight: 10,
  stateLimit: 300, // watchdog (ASSUMED)
  maxLevel: 13,
  maxLevelUltimate: 28,
} as const;

// Frame counts of the motions of bm_ene_me3_shinowa_zoa.bml (and its low-detail
// twin): t_wait 14, apper 55, backstep 40, bareta 10, damage 15, death 35,
// f_attack 47, sword 36, transform 36, wait 14, walk 39 (motion 0..10).
export const ZOA_FRAMES = [14, 55, 40, 10, 15, 35, 47, 36, 36, 14, 39] as const;

// The effect object at enemy+0x41c (vtable 0x00b069b0, ParticleEffectInstance):
// t and its step (+0x18 / +0x14). Constructed with step 0.04
// (DragonInitializeSub_0057946c) and cleared (t = 0) by the init 0x00595234.
class CloakFx {
  t = 0;
  rate = Math.fround(0.04);
  setRate(n: number): void {
    this.rate = Math.fround(2 / n); // DragonSetSpeedFactor_00576a64 (0x00927260 = 2.0)
  }
  init(): void {
    // InitializeEnemyStateTimer_00576c48
    this.setRate(10);
    this.t = Math.fround(this.rate * -30);
  }
  reset(): void {
    this.t = 2; // vtable +8
  }
  clear(): void {
    this.t = 0; // vtable +0xc
  }
  down(): boolean {
    this.t = Math.fround(this.t - this.rate); // vtable +0x10 (0x00576a98)
    return this.t <= 0;
  }
  up(): boolean {
    this.t = Math.fround(this.t + this.rate); // vtable +0x14 (0x00576b18)
    return this.t >= 2;
  }
  upTo(x: number): boolean {
    this.t = Math.fround(this.t + this.rate); // 0x00576bb8
    return this.t >= x;
  }
  get inRange(): boolean {
    return this.t > 0 && this.t < 2; // CheckFloatInRange_00576be4 (0x00927224 / 0x00927220)
  }
  // enemy+0x420: -1 while t <= 0, else t - 1 (0x00576ac4).
  get progress(): number {
    if (this.t <= 0) return -1;
    if (this.t < 2) {
      const p = Math.fround(this.t - 1);
      return p === 0 ? 0.01 : p;
    }
    return 1;
  }
}

export type ZoaState =
  | 'spawn'
  | 'rise'
  | 'wait'
  | 'appear'
  | 'fade'
  | 'drop'
  | 'chase'
  | 'lunge'
  | 'melee'
  | 'backstep'
  | 'home'
  | 'cast'
  | 'warp'
  | 'lost'
  | 'flinch'
  | 'tech'
  | 'cloak'
  | 'reveal';

// A support technique the Zele puts on the players near it: the owner applies
// `tech` (jellen = attack down, zalure = defense down) to the local player when
// clientId is its own.
export interface ZoaBuff {
  clientId: number;
  tech: 'jellen' | 'zalure';
  level: number;
}

const COS_FACE = Math.cos(bamsToRad(ZOA.faceCos));
const COS_MELEE = Math.cos(bamsToRad(ZOA.meleeCos));

function turnTowardRad(from: number, to: number, max: number): number {
  return wrap(from + Math.max(-max, Math.min(max, wrap(to - from))));
}

export class SinowZoaAi extends ExeBrain {
  state: ZoaState | 'dead' = 'spawn';
  readonly zele: boolean;
  // The owner keeps this current: the body is frozen or shocked (character
  // flags 0x20 / 0x04).
  disrupted = false;
  // The techniques the Zele cast this tick (cleared on every tick).
  readonly buffs: ZoaBuff[] = [];
  private mv: EnemyMovementData;
  private attack: EnemyAttackData | null;
  private ultimate: boolean;
  private ground: boolean; // enemy+0x3cc: stands on the ground (row 2 / state 1)
  private cloaked: boolean; // enemy+0x3c8
  private stealthEntity: boolean; // entity flag 0x8000000
  private pRecloak: number; // +0x3f4
  private pWait: number; // +0x3f0
  private pWarp: number; // +0x3fc
  private pReveal: number; // +0x3f8
  private spawnX: number;
  private spawnZ: number;
  private hang: number; // height of the set position above the ground
  private rows: readonly MotionRow[];
  private fx = new CloakFx();
  private tg: readonly AiTarget[] = [];
  // flags 0x3d4
  private busy = false; // 1: no flinch
  private hid = false; // 2: model not drawn
  private fxOn = false; // 4
  private engaged = false; // 0x10000: the lunge window is closed
  private shown = false; // 0x100000: revealed for an attack
  private vanished = false; // vtable +0x184 / +0x174: entity flag 0x4000000
  private sub = 0; // +0x43c
  private cnt = 0; // +0x440
  private aim434 = 0; // +0x444: BAMS heading to the target
  private spd = 0; // +0x448
  private afterMelee = 0; // +0x404
  private jump = 0; // +0x440 in the wait state
  private idle = 0; // +0x43c in the wait state
  private resumeTo: ZoaState = 'spawn';
  private skipCheck = false;
  private lift = 0; // +0x3ec
  private flinchFrames = 0;
  private stateFrames = 0; // frames in the current state (the watchdog)

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    params: readonly number[]; // set entry param1..6
    movement: EnemyMovementData | null; // row 67 (Zoa) / 68 (Zele)
    attack: EnemyAttackData | null;
    ultimate: boolean;
    hang?: number;
    phase?: number;
    rng?: () => number;
  }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random, opts.phase ?? 0);
    const p = (i: number) => opts.params[i] ?? 0;
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.hang = Math.max(0, opts.hang ?? 0);
    this.ultimate = opts.ultimate;
    this.mv = opts.movement ?? EMPTY_MV;
    this.attack = opts.attack;
    this.zele = p(5) > 0;
    this.cloaked = p(0) < 2; // 0x00929154
    this.stealthEntity = this.cloaked;
    // SinowzoaCheckInitialAnimationState_00591708 (1.0 / 2.0 / 3.0).
    this.ground = !(p(0) >= 1 && (p(0) < 2 || p(0) >= 3));
    this.pWait = Math.fround(0.4 + p(2));
    this.pRecloak = Math.fround(0.3 + p(1));
    this.pReveal = Math.fround(0.1 + p(4));
    this.pWarp = Math.fround(0.5 + p(3));
    const f4 = Math.fround(this.mv.fparam4 < 0.1 ? 0.1 : this.mv.fparam4);
    const f5 = Math.fround(this.mv.fparam5 < 0.1 ? 0.1 : this.mv.fparam5);
    // The table 0x009bfa00 with the speeds the static init 0x00594bd4 and
    // init_sinowzoa_subtypes_global_config 0x00594c30 write.
    this.rows = [
      row(0, 0.5, ZOA_FRAMES[0], true),
      row(1, Math.fround(0.7), ZOA_FRAMES[1]),
      row(9, 0.5, ZOA_FRAMES[9], true),
      row(2, Math.fround(0.8), ZOA_FRAMES[2]),
      row(4, f5, ZOA_FRAMES[4]),
      row(5, Math.fround(0.6), ZOA_FRAMES[5]),
      row(6, Math.fround(0.7), ZOA_FRAMES[6]),
      row(7, f4, ZOA_FRAMES[7]),
      row(8, 1, ZOA_FRAMES[8]),
      row(9, 0.5, ZOA_FRAMES[9], true),
      row(10, Math.fround(1.1), ZOA_FRAMES[10], true),
      row(3, Math.fround(0.7), ZOA_FRAMES[3]),
      row(8, 1, ZOA_FRAMES[8]),
    ];
    this.fx.clear();
    this.enter(this.frame(), 'spawn');
    // The constructor's first motion is the one the init wrote (row 2 / 0).
    this.current = this.rows[this.ground ? 2 : 0].motion;
  }

  // --- what the owner reads ---------------------------------------------------

  // vtable +0x184 / +0x174: the entity flag 0x4000000.
  get invulnerable(): boolean {
    return this.vanished;
  }
  // Flag 1: no flinch.
  get superArmor(): boolean {
    return this.busy;
  }
  // The cloak (entity flag 0x8000000): the model is drawn translucent.
  get stealth(): boolean {
    return this.stealthEntity;
  }
  // The damage motion (row 4, speed MovementData fparam5) and death (row 5).
  get flinchMotion(): EnemyAiMotion {
    return this.rows[4].motion;
  }
  get deathMotion(): EnemyAiMotion {
    return this.rows[5].motion;
  }
  // The model is not drawn (flag 2, or the fade before it has a target).
  get hidden(): boolean {
    return this.hid || (this.state === 'fade' && this.sub === 0);
  }

  // --- helpers -----------------------------------------------------------------

  private cur(): AiTarget | null {
    return this.target(this.tg);
  }

  private look(): AiTarget | null {
    return this.find(this.tg, ZOA.search);
  }

  private level(i: number): number {
    return Math.max(0, Math.min(this.ultimate ? ZOA.maxLevelUltimate : ZOA.maxLevel, Math.trunc(this.mv.iparam[i] ?? 0)));
  }

  private slot(out: AiFrame, i: number): void {
    this.start(out, this.rows[i]);
  }

  // The wall probes of the lunge and the back step (SinowzoaUpdateHitbox
  // 0x005911cc): ASSUMED open ground.
  private pathOpen(): boolean {
    return true;
  }

  // FUN_00591170 (vtable +0x1b0): the lunge window.
  private lungeOk(): boolean {
    return !this.engaged && ZOA.lungeMin < this.tdist && this.tdist < ZOA.lungeMax && this.pathOpen();
  }

  // SinowzoaCheckState10Transition_005941e4 (ASSUMED level ground: the 20-unit
  // height test that would send the body teleporting is never taken).
  private meleeOk(): boolean {
    if (this.tdist > ZOA.meleeRange) return false;
    return inFront(this.angle, this.dirX, this.dirZ) >= COS_MELEE;
  }

  // The cast of the "reveal first" states: the cloaked body shows itself with
  // the fade-in 0.05 a frame (WordSelectMenu_SetCurrentItemID_00708120).
  private revealFirst(): void {
    this.fx.rate = ZOA.fxReveal;
    this.fx.clear();
    this.shown = true;
    this.stealthEntity = false;
  }

  // Strike: vtable +0x1ac, sinowzoa_zele_attack_related 0x00591054: at the
  // motion frames 15 and 23 the target in reach is hit (try_hit_entity(1.0) and
  // cause_knockback(3.0)); the second also confuses the Zoa's victim.
  private strike(out: AiFrame): void {
    const second = this.crossed(ZOA.swingHits[1]);
    if (!second && !this.crossed(ZOA.swingHits[0])) return;
    const t = this.cur();
    if (t && this.inAttack(t, this.attack)) {
      out.hit = { clientId: t.clientId, knockback: ZOA.knockback, mult: 1 };
      if (!this.zele && second && Math.fround(this.rng()) <= ZOA.confuseChance) out.status = { clientId: t.clientId, type: STATUS.confusion };
      // The Zele (+0x408 >= 1) takes the player's weapon off (Player_UnequipItem
      // _0068dfd8): not reproduced.
    }
  }

  // --- state entry (op 4) and exit (op 5) -----------------------------------------

  private leave(): void {
    switch (this.state) {
      case 'rise':
      case 'appear':
      case 'home':
      case 'warp':
        this.fxOn = false;
        break;
      case 'drop':
        this.lift = 0;
        this.busy = false;
        break;
      case 'lunge':
        this.lift = 0;
        this.vanished = false;
        break;
      case 'backstep':
        this.vanished = false;
        break;
      default:
        break;
    }
  }

  private enter(out: AiFrame, s: ZoaState): void {
    this.leave();
    this.state = s;
    this.sub = 0;
    this.stateFrames = 0;
    if (s !== 'appear') this.shown = false;
    const clearLow = (): void => {
      this.busy = false;
      this.hid = false;
      this.fxOn = false;
    };
    switch (s) {
      case 'spawn':
        this.slot(out, this.ground ? 2 : 0);
        this.resumeTo = this.ground ? 'rise' : 'appear';
        this.vanished = true;
        this.busy = false;
        this.fxOn = false;
        this.hid = true;
        if (this.ultimate) this.engaged = false;
        if (this.x !== this.spawnX || this.z !== this.spawnZ) this.warps++;
        this.x = this.spawnX;
        this.z = this.spawnZ;
        this.afterMelee = 0;
        break;
      case 'rise':
        this.slot(out, 2);
        this.resumeTo = 'spawn';
        this.vanished = true;
        this.hid = false;
        this.busy = true;
        this.fxOn = true;
        this.fx.init();
        break;
      case 'wait':
        this.slot(out, 9);
        this.resumeTo = 'lost';
        this.vanished = false;
        clearLow();
        this.idle = 0;
        this.jump = 0;
        break;
      case 'appear':
        this.slot(out, 0);
        this.resumeTo = 'spawn';
        this.vanished = true;
        this.hid = true;
        this.busy = true;
        this.fxOn = true;
        this.fx.init();
        break;
      case 'fade':
        this.slot(out, 0);
        this.resumeTo = 'drop';
        this.vanished = true;
        clearLow();
        this.cnt = 0;
        break;
      case 'drop': {
        this.slot(out, 1);
        this.resumeTo = 'lost';
        this.vanished = false;
        clearLow();
        this.busy = true;
        this.spd = 0;
        const t = this.cur();
        if (t) this.aim(t);
        break;
      }
      case 'chase':
        this.slot(out, 10);
        this.resumeTo = 'chase';
        this.vanished = false;
        clearLow();
        this.tdist = 300; // 0x43960000
        this.spd = this.mv.fparam1;
        break;
      case 'lunge':
        this.slot(out, 6);
        this.resumeTo = 'chase';
        this.vanished = false;
        clearLow();
        this.engaged = true;
        this.spd = 0;
        break;
      case 'melee':
        this.slot(out, 7);
        this.resumeTo = 'warp';
        this.vanished = false;
        clearLow();
        this.engaged = true;
        this.stealthEntity = false;
        if (!this.cloaked) this.sub = 1;
        else this.revealFirst();
        this.cnt = 0;
        break;
      case 'backstep': {
        this.slot(out, 3);
        this.resumeTo = 'chase';
        this.vanished = false;
        clearLow();
        this.afterMelee = 0;
        this.sub = 3;
        // vtable +0x1a8 called straight: the nearest player in 200, no timer.
        const t = nearest(this.tg, this.x, this.z, ZOA.search);
        this.targetId = t ? t.clientId : null;
        if (t) {
          this.aim(t);
          this.aim434 = Math.trunc(Math.atan2(this.dirX, this.dirZ) / BAMS_TO_RAD);
          if (this.pathOpen()) {
            this.dirX = -this.dirX;
            this.dirZ = -this.dirZ;
            this.sub = 0;
            this.spd = Math.fround(ZOA.backDistance / ZOA.backFrames);
          }
        }
        break;
      }
      case 'home':
        this.slot(out, 8);
        this.resumeTo = 'chase';
        this.vanished = true;
        this.busy = false;
        this.hid = false;
        this.fxOn = true;
        this.fx.setRate(ZOA.fxCloak);
        this.fx.reset();
        this.sub = 1;
        break;
      case 'cast':
        this.slot(out, 8);
        this.resumeTo = 'cast';
        this.vanished = false;
        clearLow();
        if (!this.cloaked) this.sub = 1;
        else this.revealFirst();
        this.cnt = 0;
        break;
      case 'warp':
        this.slot(out, 12);
        this.resumeTo = 'warp';
        this.vanished = true;
        this.hid = false;
        this.fxOn = false;
        this.busy = true;
        break;
      case 'lost':
        this.slot(out, 9);
        this.resumeTo = 'lost';
        clearLow();
        this.vanished = true;
        this.afterMelee = 0;
        this.cnt = 0;
        break;
      case 'flinch':
        // Row 4: played by the owner. The flags are cleared (0xffeffff8).
        clearLow();
        this.flinchFrames = 0;
        break;
      case 'tech': {
        this.slot(out, 10);
        this.resumeTo = 'chase';
        this.vanished = false;
        clearLow();
        this.engaged = true;
        const t = this.cur();
        if (t) this.aim(t);
        break;
      }
      case 'cloak':
        this.slot(out, 12);
        this.resumeTo = 'chase';
        this.vanished = false;
        this.hid = false;
        this.busy = true;
        this.fxOn = true;
        this.fx.setRate(ZOA.fxCloak);
        break;
      case 'reveal':
        this.slot(out, 11);
        this.resumeTo = 'chase';
        this.vanished = false;
        this.hid = false;
        this.busy = true;
        this.fxOn = true;
        this.fx.setRate(ZOA.fxCloak);
        this.cloaked = false;
        this.stealthEntity = false;
        break;
      default:
        exhaustive(s);
    }
  }

  // --- the tick ----------------------------------------------------------------

  tick(targets: readonly AiTarget[], _animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.tg = targets;
    this.buffs.length = 0;
    if (this.state === 'flinch') {
      // The owner plays the damage motion and calls resume(); a watchdog in
      // case it never does (a locked enemy does not flinch).
      if (++this.flinchFrames > Math.ceil(ZOA_FRAMES[4] / this.rows[4].motion.speed) + 30) this.resume();
      out.lift = this.lift;
      return this.finish(out);
    }
    if (this.skipCheck) this.skipCheck = false;
    else this.transition(out);
    this.run(out);
    this.watchdog(out);
    this.interact(out);
    out.lift = this.lift;
    out.hidden = this.hidden;
    return this.finish(out);
  }

  // ASSUMED (not in the exe): the dissolve / fade waits of the cloak states are
  // timed by the shared effect, which SinowzoaHandlePlayerInteraction fights
  // when the body is frozen or shocked at the wrong moment (the exe's state
  // then never ends); a state that outlasts its longest legal run (the wait
  // states are exempt) is left through its normal exit.
  private watchdog(out: AiFrame): void {
    const s = this.state;
    if (s === 'wait' || s === 'lost' || s === 'chase' || s === 'fade' || s === 'spawn' || s === 'flinch') return;
    if (++this.stateFrames > ZOA.stateLimit) this.enter(out, s === 'home' ? 'spawn' : 'chase');
  }

  // SinowzoaHandlePlayerInteraction_005917e0: runs after the state's frame.
  private interact(out: AiFrame): void {
    if (!this.disrupted) {
      if (this.shown || this.fxOn || !this.fx.inRange) return;
      if (this.cloaked) {
        if (this.fx.down()) this.stealthEntity = true;
      } else if (this.fx.up()) this.stealthEntity = false;
      return;
    }
    if (this.cloaked || this.shown || this.fxOn) {
      this.fxOn = true;
      if (this.fx.up()) {
        this.cloaked = false;
        this.fxOn = false;
        this.shown = false;
        this.stealthEntity = false;
      }
    }
    if (this.state === 'cloak') this.enter(out, 'reveal');
  }

  // op 3 of the current state.
  private transition(out: AiFrame): void {
    switch (this.state) {
      case 'spawn':
        if (this.sub > ZOA.spawnFrames) this.enter(out, this.ground ? 'rise' : 'appear');
        break;
      case 'rise':
        if (this.fx.up()) this.enter(out, this.cloaked ? 'wait' : 'lost');
        break;
      case 'appear':
        if (this.fx.up()) this.enter(out, 'fade');
        break;
      case 'fade':
        if (this.sub > ZOA.fadeFrames) this.enter(out, 'drop');
        break;
      case 'wait': {
        const t = this.look();
        if (!t) {
          if (this.idle > ZOA.waitLimit) this.enter(out, 'lost');
        } else if (this.tdist <= ZOA.waitNear) {
          this.enter(out, 'lost');
        } else if (--this.jump < 1 && this.lungeOk()) {
          this.jump = ZOA.waitReload;
          if (Math.fround(this.rng()) <= ZOA.waitJump) this.enter(out, 'lunge');
        }
        break;
      }
      case 'drop':
        if (this.sub === 3) this.enter(out, 'lost');
        break;
      case 'chase':
        if (this.targetId === null) this.enter(out, 'lost');
        else if (this.meleeOk()) this.enter(out, 'melee');
        else if (this.lungeOk()) this.enter(out, 'lunge');
        break;
      case 'lunge':
        if (this.sub === 7 || this.ended) this.enter(out, 'chase');
        break;
      case 'melee':
        if (this.sub === 4) this.afterSwing(out);
        break;
      case 'backstep':
        if (this.sub === 3) this.afterBackstep(out);
        break;
      case 'home':
        if (this.sub === 2) this.enter(out, 'spawn');
        break;
      case 'cast':
        if ((this.mv.iparam[1] ?? 0) < this.cnt) this.enter(out, 'chase');
        break;
      case 'warp':
        if (this.sub === 2) this.afterWarp(out);
        break;
      case 'lost': {
        const t = this.look();
        if (!t) {
          if (this.cnt > ZOA.lostFrames) this.enter(out, 'home');
        } else this.enter(out, 'chase');
        break;
      }
      case 'tech':
        if (this.sub === 5) this.enter(out, 'chase');
        break;
      case 'cloak':
        if (this.sub === 1 && this.fx.down()) {
          this.cloaked = true;
          this.enter(out, 'chase');
          this.stealthEntity = true;
        }
        break;
      case 'reveal':
        if (this.sub === 1 && this.fx.up()) this.enter(out, 'chase');
        break;
      case 'flinch':
      case 'dead':
        break;
      default:
        exhaustive(this.state);
    }
  }

  // FUN_00594b18 (vtable +0x1b4): after the first swing 50% -> the chase, else
  // (and always the second time) the back step.
  private afterSwing(out: AiFrame): void {
    if (++this.afterMelee < 2 && Math.fround(this.rng()) >= ZOA.retreatChance) this.enter(out, 'chase');
    else this.enter(out, 'backstep');
  }

  // op 3 of the back step (sub 3).
  private afterBackstep(out: AiFrame): void {
    if (!this.cloaked && Math.fround(this.rng()) <= this.pRecloak) {
      this.enter(out, 'cloak');
      return;
    }
    if (this.pWait < Math.fround(this.rng())) {
      this.enter(out, Math.fround(this.rng()) <= this.pWarp ? 'warp' : 'chase');
      return;
    }
    if (!this.zele) this.enter(out, 'tech');
    else this.enter(out, this.mv.fparam6 < Math.fround(this.rng()) ? 'tech' : 'cast');
  }

  // op 3 of the teleport (sub 2).
  private afterWarp(out: AiFrame): void {
    this.cloaked = true;
    this.stealthEntity = true;
    if (this.pWait < Math.fround(this.rng())) this.enter(out, 'rise');
    else if (!this.zele) this.enter(out, 'tech');
    else this.enter(out, Math.fround(this.rng()) <= this.mv.fparam6 ? 'cast' : 'tech');
  }

  // --- op 0 --------------------------------------------------------------------

  private run(out: AiFrame): void {
    switch (this.state) {
      case 'spawn':
        if (++this.sub === 1) this.lift = this.hang;
        break;
      case 'rise':
        if (this.fx.progress >= FX_VISIBLE) this.animate();
        break;
      case 'appear':
        break;
      case 'fade':
        this.runFade();
        break;
      case 'wait': {
        this.idle++;
        this.animate();
        const t = this.look();
        if (t) {
          this.aim(t);
          if (inFront(this.angle, this.dirX, this.dirZ) < COS_FACE) this.turnToDir(ZOA.turn);
        }
        break;
      }
      case 'drop':
        this.runDrop(out);
        break;
      case 'chase':
        this.runChase();
        break;
      case 'lunge':
        this.runLunge(out);
        break;
      case 'melee':
        this.runMelee(out);
        break;
      case 'backstep':
        this.runBackstep();
        break;
      case 'home':
        this.animate();
        if (this.sub === 1 && this.fx.down()) this.sub = 2;
        break;
      case 'cast':
        this.runCast(out);
        break;
      case 'warp':
        this.runWarp();
        break;
      case 'lost':
        this.cnt++;
        this.animate();
        break;
      case 'tech':
        this.runTech(out);
        break;
      case 'cloak':
      case 'reveal':
        this.animate();
        if (this.ended) this.sub = 1;
        break;
      case 'flinch':
      case 'dead':
        break;
      default:
        exhaustive(this.state);
    }
  }

  // 0x0059457c: invisible until a target is within 200, then +16 alpha a frame.
  private runFade(): void {
    this.animate();
    if (this.sub === 0) {
      if (this.look()) {
        this.sub = 1;
        this.cnt = 0;
      }
    } else {
      this.sub++;
      this.cnt = Math.min(this.cnt + ZOA.fadeAlpha, 0xff);
    }
  }

  // 0x00594294. ASSUMED: the model height follows the gravity alone (the exe
  // also cancels the motion's own root offset, SinowzoaGetAnimationHeight
  // _005944ec).
  private runDrop(out: AiFrame): void {
    if (this.sub === 0) {
      this.animate();
      this.sub = 1;
    } else if (this.sub === 1) {
      this.animate();
      this.spd = Math.max(Math.fround(this.spd - ZOA.dropGravity), -ZOA.dropMax);
      if (this.elapsed >= ZOA.dropPose) this.elapsed = ZOA.dropPose;
      this.lift = Math.fround(this.lift + this.spd);
      if (this.lift < 0) {
        this.lift = 0;
        this.sub = 2;
      }
    } else if (this.sub === 2) {
      if (this.ended) {
        this.sub = 3;
        this.lift = 0;
        this.slot(out, 9);
      }
      this.animate();
    }
  }

  // 0x0059405c.
  private runChase(): void {
    this.animate();
    const t = this.look();
    if (!t) return;
    this.aim(t);
    const dot = inFront(this.angle, this.dirX, this.dirZ);
    this.turnToDir(ZOA.turn);
    if (COS_FACE <= dot) {
      this.x += Math.sin(this.angle) * this.spd;
      this.z += Math.cos(this.angle) * this.spd;
    }
  }

  private dash(): void {
    this.x += this.dirX * this.spd;
    this.z += this.dirZ * this.spd;
  }

  // handle_sinowzoa_jump_behavior 0x00593ae8.
  private runLunge(out: AiFrame): void {
    if (this.sub === 0) {
      // The cross-fade into the attack row (ASSUMED over at once).
      this.animate();
      this.sub = 1;
    } else if (this.sub === 1) {
      this.animate();
      const t = this.cur();
      if (t) {
        this.aim(t);
        this.angle = turnTowardRad(this.angle, Math.atan2(this.dirX, this.dirZ), bamsToRad(ZOA.lungeTurn));
      }
      if (this.crossed(ZOA.lungeTurnUntil)) this.sub = 2;
    } else if (this.sub === 2) {
      this.animate();
      const t = this.cur();
      if (t) this.aim(t);
      if (this.reaches(ZOA.lungeProbe)) {
        if (!this.pathOpen()) this.sub = 7;
        else {
          if (!this.cloaked) this.sub = 4;
          else {
            this.revealFirst();
            this.sub = 3;
          }
          this.spd = Math.fround((this.tdist - ZOA.lungeStop) / ZOA.lungeFrames);
          this.vanished = true;
        }
      }
    } else if (this.sub === 3 || this.sub === 4) {
      if (this.sub === 3 && this.fx.upTo(ZOA.fxRevealTo)) this.sub = 4;
      this.animate();
      if (this.reaches(ZOA.lungeAppear)) {
        this.sub = this.shown ? 5 : 6;
        this.vanished = false;
        this.warps++; // the drawn pose snaps after the dash
      }
      this.dash();
    } else if (this.sub === 5 || this.sub === 6) {
      if (this.sub === 5 && ZOA.lungeRelease < this.elapsed && this.fx.down()) {
        this.sub = 6;
        this.shown = false;
        this.stealthEntity = true;
      }
      this.animate();
      if (this.crossed(ZOA.lungeHit)) {
        const t = this.cur();
        if (t && this.inAttack(t, this.attack)) out.hit = { clientId: t.clientId, knockback: ZOA.knockback, mult: 1 };
      }
      this.spd = Math.fround(this.spd * ZOA.slide);
      this.dash();
    }
  }

  // 0x005937a8.
  private runMelee(out: AiFrame): void {
    if (this.sub === 0) {
      if (this.fx.upTo(ZOA.fxRevealTo)) this.sub = 1;
    } else if (this.sub !== 1) {
      if (this.sub === 2) {
        this.cnt++;
        if ((this.mv.iparam[2] ?? 0) <= this.cnt) this.sub = this.shown ? 3 : 4;
      } else if (this.sub === 3 && this.fx.down()) {
        this.sub = 4;
        this.shown = false;
        this.stealthEntity = true;
      }
      return;
    }
    this.animate();
    this.strike(out);
    if (this.elapsed < ZOA.swingTurnUntil) {
      const t = this.cur();
      if (t) {
        this.aim(t);
        this.angle = turnTowardRad(this.angle, Math.atan2(this.dirX, this.dirZ), bamsToRad(ZOA.swingTurn));
      }
      this.dirX = Math.sin(this.angle);
      this.dirZ = Math.cos(this.angle);
    }
    if (!(this.elapsed < ZOA.swingMoveFrom || ZOA.swingMoveTo < this.elapsed)) {
      this.x += this.dirX * this.mv.fparam3;
      this.z += this.dirZ * this.mv.fparam3;
    }
    if (this.ended) this.sub = 2;
  }

  // 0x00593438.
  private runBackstep(): void {
    this.animate();
    if (this.sub === 0) {
      this.angle = turnTowardRad(this.angle, bamsToRad(this.aim434), bamsToRad(ZOA.backTurn));
      if (this.reaches(ZOA.backVanish)) {
        this.sub = 1;
        this.vanished = true;
      }
    } else if (this.sub === 1) {
      if (this.reaches(ZOA.backAppear)) {
        this.sub = 2;
        this.vanished = false;
        this.warps++;
      }
      this.dash();
    } else if (this.sub === 2 && this.ended) this.sub = 3;
  }

  // 0x00592fdc.
  private runCast(out: AiFrame): void {
    this.animate();
    if (this.sub === 0) {
      this.animate();
      if (this.fx.upTo(ZOA.fxRevealTo)) this.sub = 1;
    } else if (this.sub !== 1) {
      if (this.sub === 2) this.cnt++;
      else if (this.sub === 3) {
        // Ultimate: Shifta at 5 and Deband at 10 on the allies (not applied).
        if (++this.cnt === 10) {
          this.sub = this.shown ? 4 : 2;
          this.cnt = 0;
        }
      } else if (this.sub === 4 && this.fx.down()) {
        this.sub = 2;
        this.shown = false;
        this.stealthEntity = true;
      }
      return;
    }
    if (this.ended) {
      this.cast(out);
      this.sub = this.ultimate ? 3 : this.shown ? 4 : 2;
      this.cnt = 0;
    }
  }

  // SinowzoaExecuteSpecialTech_00593268.
  private cast(out: AiFrame): void {
    const level = this.level(0);
    if (!this.zele) {
      out.heal = { level }; // Resta on itself
      return;
    }
    if (this.ultimate) return; // Shifta + Deband on the allies: not applied
    // Zalure (0x006f1eb0) and Jellen (0x006e7998) at its own place: their area tick
    // reaches range_h + 5 (inTechReach), as Gi Gue's stomp.
    for (const t of this.tg) {
      if (t.dead) continue;
      const dist = Math.hypot(t.x - this.x, t.z - this.z);
      if (inTechReach(TECH.zalure, level, dist)) this.buffs.push({ clientId: t.clientId, tech: 'zalure', level });
      if (inTechReach(TECH.jellen, level, dist)) this.buffs.push({ clientId: t.clientId, tech: 'jellen', level });
    }
  }

  // 0x00592ac4.
  private runWarp(): void {
    if (this.sub === 0) {
      this.animate();
      if (this.ended) {
        this.fxOn = true;
        this.fx.setRate(ZOA.fxCloak);
        this.sub = 1;
      }
    } else if (this.sub === 1 && this.fx.down()) {
      this.hid = true;
      const t = this.look();
      if (t) this.teleport(t);
      this.sub = 2;
    }
  }

  // The candidate places round the target (0x00592ac4, sub 1).
  private teleport(t: AiTarget): void {
    const a0 = Math.trunc(Math.fround(this.rng()) * ZOA.warpCandidates) - 1;
    // ASSUMED: the place is free (the exe tests the hit box, a wall ray and the
    // ground), so the first candidate is taken; the draws are the exe's.
    const r1 = Math.trunc(Math.fround(this.rng()) * 2);
    void r1;
    const head = Math.trunc((t.angle ?? 0) / BAMS_TO_RAD);
    const ang = (a0 * 0x4000 + 0x4000 + head) & 0xffff;
    const rad = bamsToRad(ang);
    this.x = t.x + Math.cos(rad) * ZOA.warpRadius;
    this.z = t.z + Math.sin(rad) * -ZOA.warpRadius;
    this.angle = wrap(bamsToRad((ang + 0xc000) & 0xffff));
    this.warps++;
  }

  // 0x00592250.
  private runTech(out: AiFrame): void {
    if (this.sub === 3) {
      if (++this.cnt > ZOA.techWait) this.sub = this.shown ? 4 : 5;
      return;
    }
    if (this.sub === 4) {
      if (this.fx.down()) {
        this.sub = 5;
        this.shown = false;
        this.stealthEntity = true;
      }
      return;
    }
    if (this.sub === 5) return;
    if (this.sub === 0) {
      const t = this.cur();
      if (!t) {
        this.enter(out, 'chase');
        return;
      }
      if (this.turnToTarget(t) < ZOA.techAim) {
        if (!this.cloaked) this.sub = 2;
        else {
          this.revealFirst();
          this.sub = 1;
        }
        this.slot(out, 8);
      } else if (this.current !== this.rows[10].motion) this.slot(out, 10);
      return;
    }
    if (this.sub === 1) {
      this.animate();
      if (this.fx.upTo(ZOA.fxRevealTo)) this.sub = 2;
    }
    this.animate();
    if (this.ended) {
      this.cnt = 0;
      this.sub = 3;
    }
    if (this.crossed(ZOA.techFrame)) {
      const t = this.cur();
      const diff = t ? this.turnToTarget(t) : 0;
      const half = Math.trunc(((this.attack?.angle ?? 0x2000) & 0xffff) / 2);
      if (t && diff < half) this.castTech(out);
      else this.sub = this.shown ? 4 : 5;
    }
  }

  // EnemyAI_UpdateRotation_00771858 with the AI record's turn rate: turn toward
  // the target, return the remaining angle in BAMS.
  private turnToTarget(t: AiTarget): number {
    const want = Math.atan2(t.x - this.x, t.z - this.z);
    this.angle = turnTowardRad(this.angle, want, bamsToRad(ZOA.techTurn));
    return Math.abs(Math.trunc(wrap(want - this.angle) / BAMS_TO_RAD));
  }

  // unknown_create_sorc_tech 0x006e38e0 (along the heading) / RabartaInit_006ec8ec
  // (centred on the Sinow itself), combat/techfire.ts. ASSUMED: the hand node
  // the exe casts from is the Sinow's own position, ZOA.boltHeight up.
  private castTech(out: AiFrame): void {
    const level = this.level(3);
    const shot = enemyFire({ tech: this.ultimate ? TECH.rabarta : TECH.gibarta, level, x: this.x, y: ZOA.boltHeight, z: this.z, heading: this.angle, enemy: true });
    if (shot) (out.shots ??= []).push(shot);
  }

  // --- the owner's hooks -------------------------------------------------------

  // The hit handler (vtable +0x100, 0x00594b68).
  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    if (this.targetId === null) this.targetId = clientId;
    this.current = null;
    if (!this.busy) {
      if (this.state !== 'flinch') {
        this.enter(this.frame(), 'flinch');
        this.skipCheck = true;
      }
      return;
    }
    if (this.cloaked && Math.fround(this.rng()) <= this.pReveal) {
      this.enter(this.frame(), 'reveal');
      this.skipCheck = true;
    }
  }

  // The flinch ended (the transition of state 0xe, 0x005928c0).
  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    if (this.cloaked && Math.fround(this.rng()) <= this.pReveal) this.enter(out, 'reveal');
    else this.enter(out, this.resumeTo);
    this.skipCheck = true;
    return this.state;
  }

  override kill(): void {
    // Death (0xf): SinowzoaHandleState14 clears the stealth flag.
    this.cloaked = false;
    this.stealthEntity = false;
    this.vanished = false;
    this.busy = false;
    super.kill();
  }
}

const FX_VISIBLE = -0.75; // 0x00928ffc

// Deldepth (PsoBB.exe, Ephinea 1.25.13, addresses are VAs): class
// TObjEneDelDepth (set type 0xdb, rt 0x47, stats / attack / resist / MovementData
// row 48 of the Episode 2 tables, model bm_ene_del_depth.bml: 3 models (0 body,
// 1 disc, 2 "kirai" = the Rabarta bomb) and 12 motions). Create 0x00549900,
// ctor 0x005499b0 (vtable 0x00b037a0), update 0x00547670.
//
// Not a vtable +0x164 handler machine like the Sinow classes: the update runs
// a table of {entry, frame} function pairs at 0x009bd160 + 8 * state (the
// frame pointer is at 0x009bd164 + 8 * state), and a frame function changes
// state by writing enemy+0x37c and calling the new state's entry. The update
// (0x00547670): hit box flag 1 set, the state's frame, the lock-on target,
// the collision step, the sub-object's animation (0x0054a33c), hit box flag 1
// cleared again when enemy+0x3f8 == 0, then the status effects.
//
// States (the dump names are FidDB guesses; entry / frame):
//   0 dormant   0x00549148 / 0x00547aac  under the floor, invulnerable
//   1 emerge    0x005491dc / 0x00547b70  growing out of the floor
//   2 retreat   0x00549228 / 0x00547cfc  sinking back
//   3 slide     0x00549278 / 0x00547e44  the disc glides in bursts, contact hits
//   4 rise      0x005493f8 / 0x005483b8  disc -> body (animation 10)
//   5 tuck      0x00549460 / 0x00548404  body -> disc (animation 11)
//   6 aim       0x005494c8 / 0x00548450  spinning in bursts, then locks a player
//   7 scan      0x0054957c / 0x005486dc  confused: spins, looks for enemies
//   8 close     0x00549610 / 0x005487ac  creeps toward the locked player
//   9 cast      0x005496c0 / 0x00548bcc  Barta (Megid in Ultimate)
//   10 bomb     0x0054967c / 0x0054898c  throws the Rabarta bomb
//   11 miss     0x00549704 / 0x00548c6c  reaction to a missed attack
//   12 hurt     0x00549764 / 0x00548ca0  reaction to a hit
//   13 dead     0x005497fc / 0x00548d60  death
//   14          0x00549890 / 0x00548e80  falling back to the floor: no state
//                                       ever enters it (no reference to its
//                                       table slot), not ported.
// The three vtable hooks switch state from outside: +0xfc (a missed attack,
// projectile_attack_accuracy_check sets entity flag 0x100) -> 11, +0x100 (a
// hit taken) -> 12, +0x104 (death) -> 13; each only when not in that state.
//
// Flags: entity flag 0x4000000 = invulnerable (the owner's `invulnerable`),
// enemy+0x3f8 = the hit box is enabled (hit box flag 1 is cleared every frame
// when it is 0, so nothing can hit it). Both are in `invulnerable` below.
// MovementData row 48: fparam1 slide acceleration / deceleration, fparam2 top
// slide speed, iparam1 the tech level (Barta / Megid and the Rabarta bomb),
// iparam2 the spin rate in BAMS per frame. Set entry param1: the bomb's
// speed is max(0.6 + param1, 0) (0x005477f8).
//
// Animation ids (DeldepthSetAnimation_0054a160): 0..5 are rows of the enemy
// table 0x009bd1e0 played by Player__Animate (0 wait_swim_body loop, 1
// attack_swim_body chaining to 0, 2 attack2, 3 wait once, 4 damage, 5 dead);
// 6..9 are the disc model's own motions (6 / 7 move, 8 damage, 9 dead); 10 / 11
// are the changeb / changea transformations (disc and body model together,
// step 0.6, they hold their last frame, "done" = the clock reached frame count
// - 1). The web client has only the body model: the brain plays the body
// motions (ASSUMED stand-ins for the disc ids: wait_swim_body) and exposes
// `discForm` so the owner can swap models.
//
// Real motion frame counts (bm_ene_del_depth.bml): 5 attack 30, 6 attack2 20,
// 7 changea_body 20, 8 changeb_body 20, 9 damage 18, 10 dead 20, 11 wait 20.


export const DELDEPTH = {
  // Static init 0x00549d2b: a738a4 = 500.0 (the confused scan), a738a8 = 200.0
  // (the wake-up and search radius), a738ac = 50.0 (the attack radius),
  // a738b0 = 15.0 (the minimum attack distance and the slide's random offset),
  // 009bd2fc = 10.0 (the contact radius, the collision box's), a738b8 = 200.0
  // (the bomb's range), a738b4 = trunc(200 / 0.6 + 2.0) = 335 (its life).
  scanRange: 500,
  spawnRange: 200,
  attackRange: 50,
  attackMin: 15,
  contactRadius: 10,
  bombRange: 200,
  bombLife: Math.trunc(200 / Math.fround(0.6) + 2),
  // 0x00923efc / 0x00547b30: the dormant countdown is trunc(15 * rand) + 15.
  dormantRand: 15,
  dormantBase: 15,
  homeAfter: 5,
  // 0x00a73870 = 0.033333335 per frame (31 frames), 0x00a73878 = -0.011111111.
  emergeStep: Math.fround(0.033333335),
  retreatStep: Math.fround(-0.011111111),
  // Slide (0x00547e44): the speed phase advances 0xc00 BAMS a frame and the
  // speed gains 0.5 * (sin + 0.5) * fparam1 (0x00923eb0 = 0.5), capped at
  // fparam2; the contact test runs every 5th frame with try_hit_entity(1.0) +
  // cause_knockback(5.0) (0x40a00000).
  speedPhase: 0xc00,
  speedGain: 0.5,
  contactEvery: 5,
  knockback: 5,
  slideBase: 70,
  slideRand: 30,
  slideAngle: 1048575, // 0x00923e54: the random offset angle, in BAMS
  slideMin: Math.fround(0.01),
  // Aim (0x00548450): the spin envelope phase starts at (trunc(4 * rand) +
  // 4) * 0x10000 and falls 0x600 a frame; the target lock radius is
  // (200 - 50) * 0.75 + 50 = 162.5 within 0x1c71 BAMS of the heading.
  aimPhaseRand: 4,
  aimPhaseBase: 0x40000,
  aimPhaseStep: 0x600,
  aimLockRadius: (200 - 50) * 0.75 + 50,
  aimLockArc: 0x1c71,
  aimTurn: 0x280,
  aimWait: 40, // trunc(wait_swim_body frames 20 / 0.5)
  spinSign: 0.5,
  // Close (0x005487ac).
  closeStep: Math.fround(0.2),
  closeTurn: 0x200,
  closeBase: 30,
  closeRand: 30,
  bombChance: Math.fround(0.45), // rand >= 0.45 -> bomb, else Barta
  // Cast / bomb timing.
  castFrame: 12,
  bombFrame: 8,
  actionFrames: 30,
  // Scan (0x005486dc).
  scanSpin: 0x888,
  scanArc: 0x444,
  scanBase: 30,
  scanRand: 30,
  // The bomb (0x00548b1c, update 0x00549a80): vy -= 0.05 a frame (0x00923d6c),
  // ground probe 5 above (0x00923d68). ASSUMED: the launch point (the model
  // node at matrix slot 0x5c0) is the body's centre height, 15 (the collision
  // box's y, 009bd2f4), and flat ground.
  bombGravity: Math.fround(-0.05),
  bombHeight: 15,
  bombSpeedBase: Math.fround(0.6),
  // Death (0x00548d60): 34 frames (body) / 32 (disc), then 5 of fading.
  deathBody: 0x22,
  deathDisc: 0x20,
  deathFade: 5,
  tickHeight: 5,
} as const;

// Frames of the real motions (see the header).
const DELDEPTH_FRAMES = { attack: 30, attack2: 20, changea: 20, changeb: 20, damage: 18, dead: 20, wait: 20 } as const;

// The disc transform (the sub-object's +0x3a0 alpha, +0x3a4 height, +0x3a8 /
// +0x3ac / +0x3b0 scale): the sub-object is drawn at (x, y + 0x3a4, z) with the
// heading (+0x60) and this scale (0x0054793c, 0x0054781c, both paths). Written by
// the emerge and retreat frames (0x00547b70, 0x00547cfc), the entries (the
// dormant 0x00549148, emerge 0x005491dc, retreat 0x00549228, slide 0x00549278,
// miss 0x00549704, hurt 0x00549764, dead 0x005497fc) and the death fade
// (0x00548d60). Rise (0x005493f8) and tuck (0x00549460) write none.
export interface DeldepthXf {
  y: number; // +0x3a4
  sx: number; // +0x3a8
  sy: number; // +0x3ac
  sz: number; // +0x3b0
  alpha: number; // +0x3a0 (drawn when > 0)
}
const DELDEPTH_XF = {
  sink: -2.5, // 0xc0200000: the dormant, emerge and retreat entries' height (the emerge curve's start)
  drop: -2.5, // 0x00923ee4: the emerge / retreat curve's height, -2.5 * (1 - t)
  base: 2.5, // 0x00923ed8 (x) and 0x00923ee0 (z)
  slope: -1.5, // 0x00923ef0 (emerge) and 0x00923ecc (retreat)
  knee: 0.8, // 0x00923d2c / 0x00923d38: the wobble starts above t = 0.8
  span: 0.2, // 0x00923eec / 0x00923ec8: the wobble fades over (1 - t) / 0.2
  emergeSpin: 0.1, // 0x00923d28
  retreatSpin: 0.15, // 0x00923d34
  alphaKnee: 0.5, // 0x00923d24 / 0x00923d30
  alphaSlope: 2, // 0x00923ee8 / 0x00923ec4
  fade: -0.2, // 0x00923d58: the death fade, a frame
} as const;

// The emerge (spin 0.1) and retreat (spin 0.15) curves: t is the progress before
// its step, count the spin phase (+0x38c, BAMS count << 12) before its increment.
function riseCurves(xf: DeldepthXf, t: number, count: number, spin: number): void {
  const C = DELDEPTH_XF;
  xf.sx = Math.fround(C.base + C.slope * t);
  xf.sz = Math.fround(C.slope * t + C.base);
  xf.y = Math.fround(C.drop * (1 - t));
  xf.sy = Math.fround(t);
  const wobble = (t > C.knee ? Math.fround((1 - t) / C.span) : 1) * bamsSin(count * 0x1000) * spin;
  xf.sx = Math.fround((wobble + 1) * xf.sx);
  xf.sz = Math.fround((1 - wobble) * xf.sz);
  xf.alpha = Math.fround(t < C.alphaKnee ? C.alphaSlope * t : 1);
}

// Body motion rows used for each animation id. Ids 6..9 (the disc's own
// motions) have no body counterpart: ASSUMED wait_swim_body.
const WAIT = row(11, 0.5, DELDEPTH_FRAMES.wait, true);
const ROWS: readonly MotionRow[] = [
  WAIT, // 0 wait_swim_body, loop
  row(5, 0.8, DELDEPTH_FRAMES.attack), // 1 attack (mode 2: chains to 0)
  row(6, 0.8, DELDEPTH_FRAMES.attack2), // 2
  row(11, 0.5, DELDEPTH_FRAMES.wait), // 3
  row(9, 0.8, DELDEPTH_FRAMES.damage), // 4 damage
  row(10, 0.7, DELDEPTH_FRAMES.dead), // 5 dead
  WAIT, // 6 move_swim_disc
  WAIT, // 7 move_swim_disc
  WAIT, // 8 damage_swim_disc
  WAIT, // 9 dead_swim_disc
  row(8, 0.6, DELDEPTH_FRAMES.changeb), // 10 changeb (disc -> body)
  row(7, 0.6, DELDEPTH_FRAMES.changea), // 11 changea (body -> disc)
];

export type DeldepthState = 'dormant' | 'emerge' | 'retreat' | 'slide' | 'rise' | 'tuck' | 'aim' | 'scan' | 'close' | 'cast' | 'bomb' | 'miss' | 'hurt' | 'dead';

const clampLevel = (n: number): number => Math.max(0, Math.min(0x1e, Math.trunc(n)));

// The Barta of a cast (AntiTechEntity_Constructor_006dd85c, update_barta) is
// combat/techfire.ts BartaBolt: the entity starts 5 above the caster's point
// along its heading.
export function deldepthBarta(x: number, z: number, angle: number, level: number): EnemyShot | null {
  return enemyFire({ tech: TECH.barta, level: clampLevel(level), x, y: 0, z, heading: angle, enemy: true });
}

// --- Rabarta bomb (DeldepthInitStateStruct_00548b1c) --------------------------------
//
// Launch: velocity (sin h, 0, cos h) * speed, speed = max(0.6 + param1, 0).
// Every frame (PlayerUpdateAndCheckGround_00549a80): vy -= 0.05, position +=
// velocity, frame counter + 1; it explodes when the counter passed 335, when
// the ground 5 below is missing or at or above the bomb, or when the distance
// travelled (speed a frame) reaches 200. The explosion is RabartaInit
// _006ec8ec at (x, y + 5, z): combat/techfire.ts RabartaField (a round box of
// Rabarta's range_h that lives `cast` frames and hits each entity once, entity
// _hit_by_tech group 2, with its freeze roll); the bomb ends and hands it over
// in `spawned`. ASSUMED: flat ground at the launch height.
export class RabartaBomb extends EnemyShot {
  readonly effect: ShotEffect = { kind: 'tech', power: 0 };
  readonly look: ShotLook = { color: 0x60c0ff, size: 2.5 };
  private vx: number;
  private vy = 0;
  private vz: number;
  private speed: number;
  private travelled = 0;
  private level: number;

  constructor(x: number, z: number, angle: number, param1: number, level: number) {
    super(x, DELDEPTH.bombHeight, z);
    this.level = clampLevel(level);
    const sp = Math.fround(DELDEPTH.bombSpeedBase + param1);
    this.speed = sp <= 0 ? 0 : sp;
    this.vx = Math.sin(angle) * this.speed;
    this.vz = Math.cos(angle) * this.speed;
  }

  tick(_targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.vy = Math.fround(this.vy + DELDEPTH.bombGravity);
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    this.frames++;
    let over = this.frames > DELDEPTH.bombLife;
    if (this.y <= 0) over = true; // ASSUMED flat ground
    this.travelled = Math.fround(this.travelled + this.speed);
    if (this.travelled >= DELDEPTH.bombRange || over) {
      this.done = true;
      const blast = enemyFire({ tech: TECH.rabarta, level: this.level, x: this.x, y: this.y + DELDEPTH.tickHeight, z: this.z, heading: 0, enemy: true });
      if (blast) (this.spawned ??= []).push(blast);
    }
    return [];
  }
}

// --- The brain ---------------------------------------------------------------------

export interface DeldepthOptions {
  x: number;
  z: number;
  angle: number;
  movement: EnemyMovementData | null; // row 48
  attack: EnemyAttackData | null; // AttackData row 48
  param1: number; // set entry param1 (the bomb's speed)
  ultimate: boolean;
  phase?: number; // entity index, for the shared scaffolding
  rng?: () => number;
}

export class DeldepthAi extends ExeBrain {
  state: DeldepthState = 'dormant';
  // The hit handler of the exe plays the reaction itself (state 12): the owner
  // must not start its own damage motion.
  readonly superArmor = true;
  private mv: EnemyMovementData;
  private attack: EnemyAttackData | null;
  private param1: number;
  private ultimate: boolean;
  private spawnX: number;
  private spawnZ: number;
  // Fields by their enemy offsets.
  private invuln = true; // entity flag 0x4000000
  private hitBox = false; // +0x3f8
  private animId = 6; // the sub-object's animation id (+4)
  private t = 0; // +0x394: the emerge / retreat progress, the slide's distance left
  private xf: DeldepthXf = { y: 0, sx: 0, sy: 0, sz: 0, alpha: 0 };
  private count = 0; // +0x38c
  private count2 = 0; // +0x390
  private spin = 0; // +0x3c4
  private theta = 0; // +0x39c: the spin envelope phase / the speed phase
  private lockId = -1; // +0x3cc
  private slideSpeed = 0; // +0x3b4
  private slideX = 0; // +0x3b8
  private slideZ = 0; // +0x3c0
  private tries = 0; // +0x3c8
  private ticks = 0;
  private fresh = false;
  private sx = 0;
  private sz = 0;
  deathLeft = 0;
  private readonly speeds: { gain: number; max: number };

  constructor(opts: DeldepthOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random, opts.phase ?? 0);
    this.mv = opts.movement ?? EMPTY_MV;
    this.attack = opts.attack;
    this.param1 = opts.param1;
    this.ultimate = opts.ultimate;
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    // ASSUMED guard for missing MovementData (the slide would never move).
    const gain = this.mv.fparam1 > 0 ? this.mv.fparam1 : 0.5;
    this.speeds = { gain, max: Math.max(this.mv.fparam2, gain) };
    this.current = ROWS[6].motion;
    this.enterDormant();
  }

  // Disc form (ids 6..9): the owner may show the disc model instead.
  get discForm(): boolean {
    return this.animId >= 6 && this.animId < 10;
  }

  // What the sub-object draws (0x0054a38c): ids 0..5 the body (model 0), 6..9 the
  // disc (model 1), 10 / 11 the transformations draw both.
  get discShown(): boolean {
    return this.animId >= 6;
  }
  get bodyShown(): boolean {
    return this.animId < 6 || this.animId >= 10;
  }

  // The disc transform of this frame (height, scale, alpha).
  get transform(): Readonly<DeldepthXf> {
    return this.xf;
  }

  // Miss, hurt and death set the scale back to 1.0 (0x00549704, 0x00549764, 0x005497fc).
  private resetScale(): void {
    this.xf.sx = 1;
    this.xf.sy = 1;
    this.xf.sz = 1;
  }

  // Entity flag 0x4000000 or the disabled hit box (+0x3f8 == 0).
  get invulnerable(): boolean {
    return this.invuln || !this.hitBox;
  }

  get deathMotion(): EnemyAiMotion {
    return ROWS[5].motion;
  }

  private anim(out: AiFrame, id: number): void {
    this.animId = id;
    this.start(out, ROWS[id]);
    this.fresh = true; // the first Animate after the id write restarts, it does not step
  }

  private enter(out: AiFrame, s: DeldepthState): void {
    this.state = s;
    switch (s) {
      case 'dormant':
        this.enterDormant();
        this.anim(out, 6);
        break;
      case 'emerge': // 0x005491dc
        this.hitBox = false;
        this.invuln = false;
        this.t = 0;
        this.xf.y = DELDEPTH_XF.sink;
        break;
      case 'retreat': // 0x00549228
        this.t = 1;
        this.xf.y = 0;
        this.hitBox = false;
        this.anim(out, 6);
        break;
      case 'slide': // 0x00549278 (alpha 1.0: the disc is no longer fading)
        this.xf.alpha = 1;
        this.spawnLogic(out);
        break;
      case 'rise': // 0x005493f8
        this.count2 = 8;
        this.invuln = true;
        this.anim(out, 10);
        this.hitBox = false;
        break;
      case 'tuck': // 0x00549460
        this.count2 = 0x14;
        this.invuln = true;
        this.anim(out, 11);
        this.hitBox = false;
        break;
      case 'aim': // 0x005494c8
        this.lockId = -1;
        this.count = 0x7fffffff;
        this.theta = Math.trunc(DELDEPTH.aimPhaseRand * this.rng()) * 0x10000 + DELDEPTH.aimPhaseBase;
        this.spin = Math.trunc(this.mv.iparam[1] ?? 0);
        if (this.rng() > DELDEPTH.spinSign) this.spin = -this.spin;
        this.anim(out, 0);
        this.hitBox = true;
        break;
      case 'scan': // 0x0054957c
        this.spin = DELDEPTH.scanSpin;
        this.count = Math.round(DELDEPTH.scanRand * this.rng()) + DELDEPTH.scanBase;
        if (this.rng() > DELDEPTH.spinSign) this.spin = -this.spin;
        this.anim(out, 0);
        this.hitBox = true;
        break;
      case 'close': // 0x00549610
        this.count = Math.round(DELDEPTH.closeRand * this.rng()) + DELDEPTH.closeBase;
        this.anim(out, 0);
        this.hitBox = true;
        break;
      case 'cast': // 0x005496c0
        this.count = DELDEPTH.actionFrames;
        this.count2 = DELDEPTH.castFrame;
        this.anim(out, 1);
        this.hitBox = true;
        break;
      case 'bomb': // 0x0054967c
        this.count = DELDEPTH.actionFrames;
        this.count2 = DELDEPTH.bombFrame;
        this.anim(out, 2);
        this.hitBox = true;
        break;
      case 'miss': // 0x00549704
        this.resetScale();
        this.invuln = false;
        this.count2 = 0;
        this.anim(out, 3);
        this.hitBox = true;
        break;
      case 'hurt': // 0x00549764
        this.resetScale();
        this.invuln = false;
        if (this.animId < 6) this.anim(out, 4);
        else {
          this.count = 0x10;
          this.anim(out, 8);
        }
        this.hitBox = false;
        break;
      case 'dead': // 0x005497fc
        this.resetScale();
        if (this.animId < 6) {
          this.count = DELDEPTH.deathBody;
          this.anim(out, 5);
        } else {
          this.count = DELDEPTH.deathDisc;
          this.anim(out, 9);
        }
        this.deathLeft = this.count + DELDEPTH.deathFade + 1;
        this.hitBox = false;
        break;
      default:
        exhaustive(s);
    }
  }

  // 0x00549148: the state 0 entry (also run by the constructor).
  private enterDormant(): void {
    // 0x00549148: height -2.5, scale 0, alpha 0 (nothing is drawn).
    this.xf = { y: DELDEPTH_XF.sink, sx: 0, sy: 0, sz: 0, alpha: 0 };
    this.hitBox = false;
    this.invuln = true;
    this.tries = 0;
    this.animId = 6;
    this.count = Math.trunc(this.rng() * DELDEPTH.dormantRand) + DELDEPTH.dormantBase;
  }

  // EnemyGetNearestTargetInRange_007714cc: the nearest player (entities below
  // 0x1000) within the radius. The line-of-sight ray is not reproduced.
  private nearestPlayer(targets: readonly AiTarget[], radius: number): AiTarget | null {
    let best: AiTarget | null = null;
    let bestSq = radius * radius;
    for (const p of targets) {
      if (p.dead || p.clientId >= 0x1000) continue;
      const d = (p.x - this.x) ** 2 + (p.z - this.z) ** 2;
      if (d < bestSq) {
        best = p;
        bestSq = d;
        this.sx = p.x - this.x;
        this.sz = p.z - this.z;
      }
    }
    return best;
  }

  // EnemyGetDistanceToPlayer_007713d4 for the locked player; the default
  // vector (1, 0, 0) when it is gone.
  private lockedVector(targets: readonly AiTarget[]): void {
    this.sx = 1;
    this.sz = 0;
    if (this.lockId < 0) return;
    for (const p of targets) {
      if (p.clientId === this.lockId && !p.dead) {
        this.sx = p.x - this.x;
        this.sz = p.z - this.z;
        return;
      }
    }
  }

  // DeldepthSpawnLogic_00549278.
  private spawnLogic(out: AiFrame): void {
    this.slideSpeed = 0;
    const p = this.nearestPlayer(this.targetsNow, DELDEPTH.spawnRange);
    if (!p) {
      this.enter(out, 'retreat');
      return;
    }
    this.slideX = this.sx;
    this.slideZ = this.sz;
    const a = DELDEPTH.slideAngle * this.rng();
    const bams = Math.round(a);
    this.slideX += DELDEPTH.attackMin * Math.sin(bamsToRad(bams & 0xffff));
    this.slideZ += DELDEPTH.attackMin * Math.cos(bamsToRad(bams & 0xffff));
    const len = Math.hypot(this.slideX, this.slideZ);
    if (len <= DELDEPTH.slideMin) {
      this.enter(out, 'retreat');
      return;
    }
    this.slideX /= len;
    this.slideZ /= len;
    this.t = DELDEPTH.slideRand * this.rng() + DELDEPTH.slideBase;
    this.anim(out, 7);
    this.hitBox = true;
  }

  private targetsNow: readonly AiTarget[] = [];

  tick(targets: readonly AiTarget[], _animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead' && this.deathLeft <= 0) return this.finish(out);
    this.targetsNow = targets;
    this.ticks++;
    if (this.pendingHook) {
      const h = this.pendingHook;
      this.pendingHook = null;
      if (this.state !== h && this.state !== 'dead') this.enter(out, h);
    }
    this.run(out, targets);
    this.advance(out);
    return this.finish(out);
  }

  // The sub-object's animation step (DeldepthAdvanceFloatState_0054a33c): the
  // body ids run Player__Animate, the transformations hold their last frame.
  private advance(out: AiFrame): void {
    if (this.fresh) {
      this.fresh = false;
      return;
    }
    this.animate();
    // Animation type 2 (id 1): at the end it continues with row 0.
    if (this.animId === 1 && this.elapsed >= this.frameCount - 1) this.anim(out, 0);
  }

  // The frame functions.
  private run(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.state) {
      case 'dormant': {
        // 0x00547aac.
        if (--this.count > 0) return;
        const p = this.nearestPlayer(targets, DELDEPTH.spawnRange);
        if (!p) {
          if (++this.tries >= DELDEPTH.homeAfter) {
            this.tries = DELDEPTH.homeAfter;
            this.x = this.spawnX;
            this.z = this.spawnZ;
            this.warps++;
          }
          this.count = Math.trunc(this.rng() * DELDEPTH.dormantRand) + DELDEPTH.dormantBase;
          return;
        }
        this.enter(out, 'emerge');
        return;
      }
      case 'emerge':
        // 0x00547b70.
        riseCurves(this.xf, this.t, this.count, DELDEPTH_XF.emergeSpin);
        this.count++;
        this.t = Math.fround(this.t + DELDEPTH.emergeStep);
        if (this.t > 1) {
          if (!this.nearestPlayer(targets, DELDEPTH.spawnRange)) this.enter(out, 'retreat');
          else this.enter(out, 'slide');
        }
        return;
      case 'retreat':
        // 0x00547cfc.
        riseCurves(this.xf, this.t, this.count, DELDEPTH_XF.retreatSpin);
        this.count++;
        this.t = Math.fround(this.t + DELDEPTH.retreatStep);
        if (this.t < 0) this.enter(out, 'dormant');
        return;
      case 'slide':
        this.slide(out, targets);
        return;
      case 'rise':
        // 0x005483b8: the transformation is done.
        if (!this.ended) return;
        this.invuln = false;
        this.enter(out, this.confused ? 'scan' : 'aim');
        return;
      case 'tuck':
        // 0x00548404.
        if (!this.ended) return;
        this.invuln = true;
        this.enter(out, 'slide');
        return;
      case 'aim':
        this.aimState(out, targets);
        return;
      case 'scan':
        this.scan(out, targets);
        return;
      case 'close':
        this.close(out, targets);
        return;
      case 'cast':
        if (--this.count2 === 0) this.castTech(out);
        if (--this.count > 0) return;
        this.enter(out, this.confused ? 'scan' : 'tuck');
        return;
      case 'bomb':
        if (--this.count2 === 0) {
          (out.shots ??= []).push(new RabartaBomb(this.x, this.z, this.angle, this.param1, this.mv.iparam[0] ?? 0));
        }
        if (--this.count > 0) return;
        this.enter(out, this.confused ? 'scan' : 'tuck');
        return;
      case 'miss':
        // 0x00548c6c.
        if (!this.ended) return;
        this.enter(out, this.confused ? 'scan' : 'aim');
        return;
      case 'hurt':
        // 0x00548ca0.
        if (this.animId < 6) {
          if (this.ended) this.enter(out, 'tuck');
        } else if (--this.count < 1) {
          const p = this.nearestPlayer(targets, DELDEPTH.attackRange);
          if (p && Math.hypot(this.sx, this.sz) > DELDEPTH.attackMin) this.enter(out, 'rise');
          else this.enter(out, 'slide');
        }
        return;
      case 'dead':
        // 0x00548d60: the countdown, 5 frames of fading (alpha -0.2 a frame, 0 once
        // it would go below), then it is removed.
        if (this.deathLeft <= DELDEPTH.deathFade) {
          const a = Math.fround(DELDEPTH_XF.fade + this.xf.alpha);
          this.xf.alpha = a >= 0 ? a : 0;
        }
        if (this.deathLeft > 0) this.deathLeft--;
        return;
      default:
        exhaustive(this.state);
    }
  }

  // 0x00547e44.
  private slide(out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.ticks % DELDEPTH.contactEvery === 0) {
      for (const p of targets) {
        if (p.dead || p.clientId >= 0x1000) continue;
        if (this.dist(p) > DELDEPTH.contactRadius + PLAYER_RADIUS) continue;
        if (!this.inAttack(p, this.attack)) continue;
        out.hit = { clientId: p.clientId, knockback: DELDEPTH.knockback, mult: 1 };
        break;
      }
    }
    if (this.t > 0) {
      this.theta += DELDEPTH.speedPhase;
      const s = Math.sin(bamsToRad(this.theta & 0xffff));
      this.slideSpeed += DELDEPTH.speedGain * (s + DELDEPTH.speedGain) * this.speeds.gain;
      if (this.slideSpeed > this.speeds.max) this.slideSpeed = this.speeds.max;
    } else {
      const v = this.slideSpeed - this.speeds.gain;
      this.slideSpeed = v >= 0 ? v : 0;
    }
    const move = Math.abs(this.slideSpeed);
    this.t -= move;
    // ASSUMED: no wall (the exe probes the map and turns the direction by
    // 0x1000 steps): the disc moves along its direction.
    this.x += this.slideX * this.slideSpeed;
    this.z += this.slideZ * this.slideSpeed;
    if (this.t > 0 || this.slideSpeed !== 0) return;
    const p = this.nearestPlayer(targets, DELDEPTH.attackRange);
    if (p && Math.hypot(this.sx, this.sz) > DELDEPTH.attackMin) this.enter(out, 'rise');
    else this.enter(out, 'slide');
  }

  // 0x00548450.
  private aimState(out: AiFrame, targets: readonly AiTarget[]): void {
    const env = Math.max(Math.sin(bamsToRad(this.theta & 0xffff)), 0);
    this.angle = wrap(this.angle + bamsToRad(this.spin * env));
    let th = this.theta;
    if (this.lockId < 0) {
      const p = this.nearestPlayer(targets, DELDEPTH.aimLockRadius);
      if (p) {
        const diff = Math.abs(wrap(this.angle - Math.atan2(this.sx, this.sz)));
        if (diff < bamsToRad(DELDEPTH.aimLockArc)) {
          th = 0;
          this.lockId = p.clientId;
        }
      }
    }
    this.theta = th - DELDEPTH.aimPhaseStep;
    if (this.theta >= 1) return;
    this.theta = 0;
    if (this.lockId >= 0) {
      this.lockedVector(targets);
      this.angle = turnToward(this.angle, Math.atan2(this.sx, this.sz), bamsToRad(DELDEPTH.aimTurn));
    }
    if (DELDEPTH.aimWait < this.count) {
      this.anim(out, 0);
      this.count = DELDEPTH.aimWait;
      return;
    }
    if (--this.count < 1) this.enter(out, this.lockId >= 0 ? 'close' : 'tuck');
  }

  // 0x005486dc: confused, looks for other enemies.
  private scan(out: AiFrame, targets: readonly AiTarget[]): void {
    this.angle = wrap(this.angle + bamsToRad(this.spin));
    let found = false;
    let bestSq = DELDEPTH.scanRange * DELDEPTH.scanRange;
    let tx = 0;
    let tz = 0;
    for (const p of targets) {
      if (p.dead || p.clientId < 0x1000 || p.clientId >= 0x4000) continue;
      const d = (p.x - this.x) ** 2 + (p.z - this.z) ** 2;
      if (d < bestSq) {
        bestSq = d;
        tx = p.x - this.x;
        tz = p.z - this.z;
        found = true;
      }
    }
    let faced = false;
    if (found) {
      const a = Math.atan2(tx, tz);
      if (Math.abs(wrap(this.angle - a)) < bamsToRad(DELDEPTH.scanArc)) {
        this.angle = a;
        faced = true;
      }
    }
    this.count--;
    if (!faced && this.count >= 0) return;
    this.enter(out, 'cast');
  }

  // 0x005487ac.
  private close(out: AiFrame, targets: readonly AiTarget[]): void {
    this.lockedVector(targets);
    const a = Math.atan2(this.sx, this.sz);
    this.angle = turnToward(this.angle, a, bamsToRad(DELDEPTH.closeTurn));
    if (Math.abs(wrap(this.angle - a)) < bamsToRad(DELDEPTH.closeTurn)) this.count = 0;
    const len = Math.hypot(this.sx, this.sz);
    const ux = len > DELDEPTH.slideMin ? this.sx / len : 1;
    const uz = len > DELDEPTH.slideMin ? this.sz / len : 0;
    // ASSUMED: no ground / wall test (the exe undoes the step without ground).
    this.x += ux * DELDEPTH.closeStep;
    this.z += uz * DELDEPTH.closeStep;
    if (--this.count > 0) return;
    // The exe compares the scaled step's length (0.2) with 50: always true.
    if (this.rng() >= DELDEPTH.bombChance) this.enter(out, 'bomb');
    else this.enter(out, 'cast');
  }

  private castTech(out: AiFrame): void {
    const level = this.mv.iparam[0] ?? 0;
    (out.shots ??= []).push(this.ultimate ? delLilyMegid(this.x, this.z, this.angle, level, true) : deldepthBarta(this.x, this.z, this.angle, level)!);
  }

  // The vtable +0xfc hook: an attack of a player missed it.
  onMiss(): void {
    if (this.state === 'dead' || this.state === 'miss') return;
    this.pendingHook = 'miss';
  }

  private pendingHook: 'miss' | 'hurt' | null = null;

  // The vtable +0x100 hook: a hit taken (the owner only reports hits that
  // landed, i.e. not while `invulnerable`).
  onDamage(clientId: number): void {
    if (this.state === 'dead' || this.state === 'hurt') return;
    this.targetId = clientId;
    this.pendingHook = 'hurt';
  }

  resume(): string {
    return this.state;
  }

  // The vtable +0x104 hook: death (the owner plays the death motion).
  override kill(): void {
    this.pendingHook = null;
    this.enter(this.frame(), 'dead');
    this.invuln = true;
  }
}

export { DELDEPTH as DELDEPTH_CONSTANTS };

// Delbiter (class TObjEneDellBiter, set type 0xdc, Seabed; PsoBB.exe, Ephinea
// 1.25.13, addresses are VAs). The class is written directly against the
// enemy base (see the header of combat/enemyfsmep2c.ts for the per-frame
// update, the state handler argument convention 4 / 3 / 0 / 5 and the
// animation clock ExeBrain reproduces). The dump names every function of it
// "Deldepth..." (FidDB); they are the Delbiter's.
//
// create_delbiter 0x0054a6a0, ctor delbiter_constructor 0x0054a71c (vtable
// 0x00b03be0, update 0x0054a864, render 0x0054aa7c, hit handler +0x100
// 0x005a99d8, death handler +0x104 0x0054d680, ProcessState +0x164 =
// 0x0054aef8 with the jump table 0x009240d8), init 0x0054d8c8 (it enters state
// 1), global config 0x0054d724 (BML bm_ene_biter_body.bml, descriptor
// 0x009bd578 / low 0x009bd534), parameters set_delbiter_params 0x0054a7d0,
// motion table 0x009bd460, AI record 0x009bd58c {search 225, turn 0x600}
// (every target search below passes its own radius 300). Stats / attack /
// resist / MovementData are all row 13 (ep1_ChaosBringer__ep2_Delbiter__ep4_
// SatelliteLizardCrater); collision body radius 10 (0x009bd3ac), the roll
// body radius 15 (0x009bd430), the two claw bodies radius 15 (0x009bd3d8,
// 0x009bd404); the model is drawn at scale 0.6.
//
// Set entry parameters (set_delbiter_params):
//   +0x4b0 = param1 + 0.3   chance (after a roll, a flinch) of the howl (8)
//   +0x4b4 = param2 + 0.3   chance a player in range is confused by the howl
//   +0x4b8 = max(param3 + 30, 10)  the howl's confusion range
//   +0x4bc = param4 + 0.3   chance of the laser (9) after a roll / swing /
//                           flinch
//   +0x4c0 = param5 + 0.05  chance of the charge-up (12) after a flinch at
//                           half HP or less
//   +0x4c4 = param6 > 0     the run-in type (state 3) instead of the walk-in
//                           (state 2) ("TYPE_RUN" / "TYPE_STAND" in the
//                           debug overlay)
// MovementData row 13 (G): fparam1 the roll / run speed, fparam2 the walk
// speed, fparam3 the swing's animation step (min 0.1, 0x009bd4a8), fparam4
// the laser's (min 0.1, 0x009bd4b8), fparam5 the roll's travel limit,
// fparam6 the distance from which it rolls, iparam1 the hold after a swing in
// frames, iparam2 the power of the charged roll (Megid in Ultimate), iparam3
// the power of the plain roll, iparam4 the laser's power, iparam5 the
// distance at which it stops walking up, iparam6 the charge's length in
// seconds (x 30 frames).
//
// States (ProcessState 0x0054aef8, jump table 0x009240d8; entry = argument 4,
// frame = argument 0, check = argument 3), the motion rows are the table
// 0x009bd460 (motion, step): 0 wait (8, 0.5, loop), 1 walk (9, 0.7, loop), 2
// run (5, 0.8, loop), 3 stop (6, 0.9), 4 attack (0, G fparam3), 5 beam (1, G
// fparam4), 6 damage (2, 1.0), 7 kamae (4, 0.7), 8 tpkyu (7, 1.0), 9 dead
// (3, 0.7):
//   0 (0x0054d868) unreachable: it only counts and goes to 1.
//   1 hidden (0x0054d5b0): not drawn (+0x3c8 bit 1), invulnerable (+0x184),
//     back at the spawn point; every frame FindEnemyTarget(300): a target ->
//     the heading faces it and the type picks 3 or 2.
//   2 walk-in (0x0054d3d4): animation 1, the spawn point, a 50-frame fade-in
//     (the effect object 0x00aff758: t 0 -> 2 in steps of 0.04, invulnerable
//     until done); for 21 frames it walks 1.2 a frame along the vector to the
//     target at the time of state 1, then animation 3 (stop) to its end.
//   3 run-in (0x0054cda4): animation 2; starts 100 behind the spawn point
//     (along the heading), runs fparam1 a frame for trunc(100 / fparam1)
//     frames (hitting players with the roll body), then 10 frames at that
//     speed, then animation 3 with the speed x 0.9 a frame until it ends.
//   4 wait (0x0054cc74): animation 0, invulnerable; a target within 300 -> 5;
//     60 frames without one: a 50-frame fade-out, then 1.
//   5 chase (0x0054ca10): animation 1; below FindEnemyTarget(300) (or the
//     attacker); turns 0x300 a frame toward the target; farther than iparam5
//     it walks fparam2 a frame along its heading, else once the target is
//     within cos(0x1800) of the heading it swings. Check: no target -> 4;
//     target at least fparam6 away with fewer than 2 rolls since the last
//     swing -> 6; swing ready -> 7.
//   6 roll (0x0054c1b8): animation 7 (kamae) to its end (the dust at motion
//     frames 16 and 26), then animation 2 and the charge: every frame fparam1
//     toward the target (the unit vector of the last look), hitting each
//     player once with the roll body (radius 15); it stops when the target is
//     30 or more away and behind the heading, or after a hit / a wall /
//     fparam5 travelled; then 10 frames at speed, then animation 3 with the
//     speed x 0.9 a frame to its end. Check: howl (8) with +0x4b0, laser (9)
//     with +0x4bc, else 5.
//   7 swing (0x0054bc98): animation 4; the claws hit between motion frames
//     10.8 and 13.0; at the end animation 0 for iparam1 frames. Check (every
//     second swing drops the aggro): laser (9) with +0x4bc, else 5.
//   8 howl (0x0054b9f4): animation 8 (tpkyu); at motion frame 11 every player
//     within +0x4b8 is confused with +0x4b4 (entity_hit_by_tech, group
//     confuse).
//   9 laser (0x0054b478): the farthest player within 300; turns 0x300 a frame
//     (animation 1) until it faces it, then animation 5; at motion frame 14 it
//     fires a Dorphon laser (0x0054df68: 5 a frame along the heading, power
//     iparam4); Ultimate fires 3 times.
//   10 flinch (0x0054b2b4): animation 6. Check (the owner's resume): at half
//     HP or less and not charged, +0x4c0 -> 12; else howl, laser, or back.
//   11 death (0x0054b144): animation 9.
//   12 charge (0x0054afb4): animation 8; at its end the charged flag (+0x3c8
//     bit 0x10) for iparam6 * 30 frames: rolls then hit with Megid (Ultimate)
//     or Zonde (group 3) at iparam2 instead of the plain hit at iparam3, and
//     a hit no longer makes it flinch.
// The hit handler (0x005a99d8): unless it is in state 10 the attacker becomes
// the target (+0x3c8 bit 8); a flinch (10) only when neither bit 4 (the
// rolling / swinging / casting states) nor bit 0x10 (charged) is set.
//
// ASSUMED / not reproduced: the map rays (line of sight, the wall ahead of
// the roll, wall hits: the roll never stops on a wall), the collision push
// between enemies, the claw bodies' own overlap test (the claws are placed by
// the render function from model nodes: ASSUMED a player inside AttackData's
// reach and arc is hit once per swing during the window), the player's hit
// box radius (5), the flinch's knockback glide (velocity x 0.8 a frame), the
// 0x600 flags the roll sets on a player and its impact effect object
// (0x0054dda0), group 3 (Zonde) resistance (a plain technique hit), the laser
// mouth position (the render function's node: ASSUMED 8 ahead, 14 up) and its
// range (the map ray ends it: ASSUMED 500), the melee knockback (3, as every
// melee), all particles and sound effects.


export const DELBITER = {
  search: 300,
  // DeldepthHandleRollStateTransition_0054d5b0: FindEnemyTarget_00520ea0(300.0).
  baseChance: Math.fround(0.3), // 0x00924278
  baseRange: 30, // 0x00924274
  minRange: 10, // 0x0092426c
  baseCharge: Math.fround(0.05), // 0x00924270
  minAnimStep: Math.fround(0.1), // 0x00924174
  // Effect object 0x00aff758: step 0.04 (0x3d23d70a), 0 -> 2.
  fadeStep: Math.fround(0.04),
  fadeDone: 2,
  walkIn: { frames: 20, speed: Math.fround(1.2), stopFootstep: 21 },
  runIn: { behind: -100, distance: 100, hold: 9, slow: Math.fround(0.9) },
  waitFrames: 59,
  chaseTurn: 0x300,
  chaseAlign: 0x1800,
  rollWindupTurn: 0x280,
  rollFrames: [16, 26] as readonly number[],
  rollStopDistance: 30, // 0x009241d0
  rollHold: 9,
  rollSlow: Math.fround(0.9), // 0x009241b4
  rollMaxRolls: 2,
  rollBodyRadius: 15, // 0x009bd430
  clawWindow: [Math.fround(10.8), 13] as readonly number[], // 0x009241f0, 0x009241ec
  howlFrame: 11,
  laserTurn: 0x300,
  laserFrame: 14,
  laserShots: 3,
  laserSearchSq: 90000, // 0x00a738f8 = 0x47afc800
  laser: { speed: 5, radius: Math.fround(2.5), range: 500 }, // 0x00924468, 0x0054e0a8; range ASSUMED
  chargeFrames: 30,
  halfHp: 0.5,
  knockback: 3,
  mouthAhead: 8, // ASSUMED
  mouthHeight: 14, // ASSUMED
} as const;

// Frame counts of the motions of bm_ene_biter_body.bml (real archive, index
// relative to the first motion): attack 25, beam 25, damage 40, dead 45,
// kamae 35, run 15, stop 32, tpkyu 60, wait 20, walk 28.
const DELBITER_FRAMES = [25, 25, 40, 45, 35, 15, 32, 60, 20, 28] as const;

export type DelbiterState = 'hidden' | 'walkIn' | 'runIn' | 'wait' | 'chase' | 'roll' | 'swing' | 'howl' | 'laser' | 'flinch' | 'charge';

// A contact hit on one player (the roll body's entity_hit_by_tech): reports
// the target on its first tick.
export class DelbiterContact extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xc060ff, size: 2 };
  private id: number;

  constructor(t: AiTarget, effect: ShotEffect) {
    super(t.x, PLAYER_RADIUS, t.z);
    this.id = t.clientId;
    this.effect = effect;
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.done = true;
    const t = targets.find((x) => x.clientId === this.id && !x.dead);
    return t ? [t] : [];
  }
}

export interface DelbiterOptions {
  x: number;
  z: number;
  angle: number;
  params: readonly number[]; // set entry param1..6
  movement: EnemyMovementData | null; // MovementData row 13
  attack: EnemyAttackData | null; // row 13
  ultimate: boolean;
  phase?: number; // the target search phase (entity index)
  rng?: () => number;
}

export class DelbiterAi extends ExeBrain {
  state: DelbiterState | 'dead' = 'hidden';
  private mv: EnemyMovementData;
  private attack: EnemyAttackData | null;
  private ultimate: boolean;
  private spawnX: number;
  private spawnZ: number;
  // set_delbiter_params
  private howlChance: number;
  private confuseChance: number;
  private confuseRange: number;
  private laserChance: number;
  private chargeChance: number;
  private running: boolean;
  // the motion rows
  private rows: { wait: MotionRow; walk: MotionRow; run: MotionRow; stop: MotionRow; attack: MotionRow; beam: MotionRow; damage: MotionRow; kamae: MotionRow; howl: MotionRow; dead: MotionRow };
  private animId = -1;
  // flags (+0x3c8)
  private fade = false; // bit 2
  private busy = false; // bit 4
  private aggro = false; // bit 8
  private charged = false; // bit 0x10
  private chargeTimer = 0; // +0x498
  private vanished = true; // +0x184 / +0x188 (entity flags 0x4040000)
  private fadeT = 0;
  // scratch
  private a = 0; // +0x4d4
  private b = 0; // +0x4d8
  private swings = 0; // +0x490
  private rolls = 0; // +0x494
  private speedV = 0; // +0x4e4
  private travelled = 0; // +0x4e8
  private laserHeading = 0; // +0x4e0
  private resumeState: DelbiterState = 'hidden';
  private skipCheck = false;
  private hitFlinch = false;
  private hits = new Set<number>();
  private confusions: number[] = [];

  constructor(o: DelbiterOptions) {
    super(o.x, o.z, o.angle, o.rng ?? Math.random, o.phase ?? 0);
    const p = (i: number) => Math.fround(o.params[i] ?? 0);
    this.mv = o.movement ?? EMPTY_MV;
    this.attack = o.attack;
    this.ultimate = o.ultimate;
    this.spawnX = o.x;
    this.spawnZ = o.z;
    this.howlChance = Math.fround(p(0) + DELBITER.baseChance);
    this.confuseChance = Math.fround(p(1) + DELBITER.baseChance);
    this.confuseRange = Math.max(Math.fround(p(2) + DELBITER.baseRange), DELBITER.minRange);
    this.laserChance = Math.fround(p(3) + DELBITER.baseChance);
    this.chargeChance = Math.fround(p(4) + DELBITER.baseCharge);
    this.running = (o.params[5] ?? 0) > 0;
    this.rows = {
      wait: row(8, 0.5, DELBITER_FRAMES[8], true),
      walk: row(9, 0.7, DELBITER_FRAMES[9], true),
      run: row(5, 0.8, DELBITER_FRAMES[5], true),
      stop: row(6, 0.9, DELBITER_FRAMES[6]),
      attack: row(0, Math.max(this.mv.fparam3, DELBITER.minAnimStep), DELBITER_FRAMES[0]),
      beam: row(1, Math.max(this.mv.fparam4, DELBITER.minAnimStep), DELBITER_FRAMES[1]),
      damage: row(2, 1, DELBITER_FRAMES[2]),
      kamae: row(4, 0.7, DELBITER_FRAMES[4]),
      howl: row(7, 1, DELBITER_FRAMES[7]),
      dead: row(3, 0.7, DELBITER_FRAMES[3]),
    };
    // DeldepthInitialize_0054d8c8: animation 0 started, state 1 entered (the
    // effect object is set to 0, resume state 1).
    this.start(this.frame(), this.rows.wait);
    this.animId = 0;
    this.enterHidden();
  }

  // --- owner-facing flags ---------------------------------------------------

  // +0x184 vanish: the entity flag 0x4000000, hits do nothing.
  get invulnerable(): boolean {
    return this.vanished;
  }

  // +0x3c8 bit 2: drawn through the fade effect (translucent).
  get fading(): boolean {
    return this.fade;
  }

  // +0x3c8 bit 1: the render function skips the model.
  get hidden(): boolean {
    return this.state === 'hidden';
  }

  // Hits do not start the damage motion while bit 4 or bit 0x10 is set, nor
  // while the flinch state is already running (0x005a99d8).
  get superArmor(): boolean {
    return !this.hitFlinch;
  }

  get flinchMotion() {
    return this.rows.damage.motion;
  }

  get deathMotion() {
    return this.rows.dead.motion;
  }

  // --- helpers --------------------------------------------------------------

  private setAnim(out: AiFrame, id: number, r: MotionRow): void {
    // The animation id write: the clock restarts only when the id changes.
    if (this.animId === id) return;
    this.animId = id;
    this.start(out, r);
  }

  // ChaosBringerCheckLineOfSight_0053c3d0: bit 8 clear -> FindEnemyTarget(300);
  // else the ray to the target (ASSUMED visible while it lives).
  private los(targets: readonly AiTarget[]): AiTarget | null {
    if (!this.aggro) return this.find(targets, DELBITER.search);
    const t = this.target(targets);
    if (!t) {
      this.aggro = false;
      this.targetId = null;
    }
    return t;
  }

  private headingToDir(): number {
    return Math.atan2(this.dirX, this.dirZ);
  }

  // Delbiter hit list + roll body: every player the body overlaps this frame
  // and not hit yet gets entity_hit_by_tech (group 0 power iparam3; charged:
  // Megid in Ultimate / Zonde at iparam2).
  private bodyHits(out: AiFrame, targets: readonly AiTarget[]): boolean {
    let any = false;
    for (const t of targets) {
      if (t.dead || this.hits.has(t.clientId)) continue;
      if (this.dist(t) > DELBITER.rollBodyRadius + PLAYER_RADIUS) continue;
      this.hits.add(t.clientId);
      any = true;
      let effect: ShotEffect;
      if (!this.charged) effect = { kind: 'tech', power: this.mv.iparam[2] ?? 0 };
      else if (this.ultimate) effect = { kind: 'megid', power: this.mv.iparam[1] ?? 0 };
      else effect = { kind: 'tech', power: this.mv.iparam[1] ?? 0 };
      (out.shots ??= []).push(new DelbiterContact(t, effect));
    }
    return any;
  }

  // --- state entry (argument 4) / leave (argument 5) ------------------------

  private leave(next: DelbiterState): void {
    switch (this.state) {
      case 'walkIn':
        // 0x0054d3d4 argument 5: +0x188.
        this.vanished = false;
        break;
      case 'runIn':
      case 'roll':
        this.busy = false;
        this.hits.clear();
        break;
      case 'laser':
        this.aggro = false;
        break;
      case 'howl':
      case 'swing':
      case 'chase':
      case 'wait':
      case 'hidden':
      case 'flinch':
      case 'charge':
      case 'dead':
        break;
      default:
        exhaustive(this.state);
    }
    void next;
  }

  private enter(out: AiFrame, next: DelbiterState): void {
    if (this.state !== 'dead') this.leave(next);
    this.state = next;
    this.a = 0;
    this.b = 0;
    switch (next) {
      case 'hidden':
        this.enterHidden();
        break;
      case 'walkIn':
        this.resumeState = 'chase';
        this.fade = true;
        this.busy = false;
        this.vanished = true;
        this.fadeT = 0;
        this.swings = 0;
        this.rolls = 0;
        this.toSpawn();
        this.animId = -1;
        this.setAnim(out, 1, this.rows.walk);
        break;
      case 'runIn':
        this.resumeState = 'chase';
        this.fade = true;
        this.busy = true;
        this.vanished = false;
        this.fadeT = 0;
        this.speedV = this.mv.fparam1;
        this.hits.clear();
        this.toSpawn();
        this.x = Math.fround(this.x + Math.sin(this.angle) * DELBITER.runIn.behind);
        this.z = Math.fround(this.z + Math.cos(this.angle) * DELBITER.runIn.behind);
        this.a = this.mv.fparam1 > 0 ? Math.trunc(DELBITER.runIn.distance / this.mv.fparam1) : 0;
        this.animId = -1;
        this.setAnim(out, 2, this.rows.run);
        break;
      case 'wait':
        this.resumeState = 'wait';
        this.fade = false;
        this.busy = false;
        this.vanished = true;
        this.animId = -1;
        this.setAnim(out, 0, this.rows.wait);
        break;
      case 'chase':
        this.resumeState = 'chase';
        this.fade = false;
        this.busy = false;
        this.vanished = false;
        this.animId = -1;
        this.setAnim(out, 1, this.rows.walk);
        break;
      case 'roll':
        this.resumeState = 'chase';
        this.busy = true;
        this.fade = false;
        this.speedV = this.mv.fparam1;
        this.travelled = 0;
        this.hits.clear();
        this.animId = -1;
        this.setAnim(out, 7, this.rows.kamae);
        break;
      case 'swing':
        this.resumeState = 'chase';
        this.busy = true;
        this.fade = false;
        this.hits.clear();
        this.rolls = 0;
        this.animId = -1;
        this.setAnim(out, 4, this.rows.attack);
        break;
      case 'howl':
        this.resumeState = 'chase';
        this.busy = true;
        this.fade = false;
        this.animId = -1;
        this.setAnim(out, 8, this.rows.howl);
        break;
      case 'laser':
        this.resumeState = 'chase';
        this.busy = true;
        this.fade = false;
        this.laserHeading = 0;
        this.animId = -1;
        this.setAnim(out, 1, this.rows.walk);
        break;
      case 'flinch':
        this.fade = false;
        this.animId = -1;
        this.setAnim(out, 6, this.rows.damage);
        break;
      case 'charge':
        this.resumeState = 'chase';
        this.busy = true;
        this.fade = false;
        this.animId = -1;
        this.setAnim(out, 8, this.rows.howl);
        break;
      default:
        exhaustive(next);
    }
  }

  private enterHidden(): void {
    this.state = 'hidden';
    this.resumeState = 'hidden';
    this.fade = false;
    this.busy = false;
    this.vanished = true;
    this.toSpawn();
  }

  // The entry code writes the spawn point (enemy+0x50..0x58) into the position.
  private toSpawn(): void {
    if (this.x !== this.spawnX || this.z !== this.spawnZ) this.warps++;
    this.x = this.spawnX;
    this.z = this.spawnZ;
  }

  // --- the update -----------------------------------------------------------

  tick(targets: readonly AiTarget[], _animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead' || this.state === 'flinch') return this.finish(out);
    if (!this.skipCheck) this.check(out, targets);
    else this.skipCheck = false;
    this.run(out, targets);
    // DeldepthUpdateParticles_0054a8f0: the charged flag runs out.
    if (this.charged) {
      if (this.chargeTimer < 1) this.charged = false;
      this.chargeTimer--;
    }
    // One queued confusion per tick (the owner applies one status a frame).
    if (this.confusions.length > 0) out.status = { clientId: this.confusions.shift() as number, type: STATUS.confusion };
    out.hidden = this.hidden;
    return this.finish(out);
  }

  // Argument 3.
  private check(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.state) {
      case 'hidden': {
        // 0x0054d5b0: FindEnemyTarget(300) -> heading to the target.
        const t = this.find(targets, DELBITER.search);
        if (t) {
          this.aim(t);
          this.angle = this.headingToDir();
          this.enter(out, this.running ? 'runIn' : 'walkIn');
        }
        break;
      }
      case 'walkIn':
      case 'runIn':
        if (this.b === 2) this.enter(out, 'chase');
        break;
      case 'wait':
        if (this.a === 2) this.enter(out, 'chase');
        else if (this.a === 3) this.enter(out, 'hidden');
        break;
      case 'chase':
        if (!this.target(targets)) this.enter(out, 'wait');
        else if (this.mv.fparam6 <= this.tdist && this.rolls < DELBITER.rollMaxRolls) this.enter(out, 'roll');
        else if (this.a === 1) this.enter(out, 'swing');
        break;
      case 'roll':
        if (this.a === 3) {
          this.rolls++;
          this.aggro = false;
          if (Math.fround(this.rng()) <= this.howlChance) this.enter(out, 'howl');
          else if (Math.fround(this.rng()) <= this.laserChance) this.enter(out, 'laser');
          else this.enter(out, 'chase');
        }
        break;
      case 'swing':
        if (this.b === 2) {
          this.swings++;
          if (this.swings >= 2) {
            this.swings = 0;
            this.aggro = false;
          }
          if (Math.fround(this.rng()) <= this.laserChance) this.enter(out, 'laser');
          else this.enter(out, 'chase');
        }
        break;
      case 'howl':
      case 'charge':
        if (this.a === 1) this.enter(out, 'chase');
        break;
      case 'laser':
        if (this.a === 4) this.enter(out, 'chase');
        break;
      case 'flinch':
      case 'dead':
        break;
      default:
        exhaustive(this.state);
    }
  }

  // Argument 0.
  private run(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.state) {
      case 'hidden':
        break;
      case 'walkIn':
        this.walkIn(out, targets);
        break;
      case 'runIn':
        this.runIn(out, targets);
        break;
      case 'wait':
        this.waiting(targets);
        break;
      case 'chase':
        this.chasing(out, targets);
        break;
      case 'roll':
        this.rolling(out, targets);
        break;
      case 'swing':
        this.swinging(out, targets);
        break;
      case 'howl':
        this.howling(targets);
        break;
      case 'laser':
        this.lasering(out, targets);
        break;
      case 'charge':
        this.charging();
        break;
      case 'flinch':
      case 'dead':
        break;
      default:
        exhaustive(this.state);
    }
  }

  // The effect object's +0x14 (t += 0.04, done at t >= 2): fade-in.
  private fadeIn(): void {
    this.fadeT = Math.fround(this.fadeT + DELBITER.fadeStep);
    if (this.fadeT >= DELBITER.fadeDone) {
      this.fade = false;
      this.vanished = false; // 0x188 (state 2); state 3 was never vanished
    }
  }

  private walkIn(out: AiFrame, targets: readonly AiTarget[]): void {
    this.animate();
    this.find(targets, DELBITER.search);
    this.a++;
    if (this.b === 0) {
      if (this.a > DELBITER.walkIn.frames) {
        this.b = 1;
        this.setAnim(out, 3, this.rows.stop);
      }
      this.x = Math.fround(this.x + this.dirX * DELBITER.walkIn.speed);
      this.z = Math.fround(this.z + this.dirZ * DELBITER.walkIn.speed);
    } else if (this.b === 1) {
      if (this.ended) this.b = 2;
    }
    this.fadeIn();
  }

  private runIn(out: AiFrame, targets: readonly AiTarget[]): void {
    this.animate();
    if (this.b === 0) {
      this.x = Math.fround(this.x + Math.sin(this.angle) * this.speedV);
      this.z = Math.fround(this.z + Math.cos(this.angle) * this.speedV);
      this.bodyHits(out, targets);
      const left = this.a - 1;
      if (left < 1) {
        this.b = 1;
        this.a = 0;
        this.busy = false;
      } else this.a = left;
    } else if (this.b === 1) {
      this.a++;
      if (this.a > DELBITER.runIn.hold) {
        this.setAnim(out, 3, this.rows.stop);
        if (this.ended) this.b = 2;
        this.speedV = Math.fround(this.speedV * DELBITER.runIn.slow);
      }
      this.bodyHits(out, targets);
      this.x = Math.fround(this.x + this.dirX * this.speedV);
      this.z = Math.fround(this.z + this.dirZ * this.speedV);
    }
    this.fadeIn();
  }

  private waiting(targets: readonly AiTarget[]): void {
    this.animate();
    if (this.a === 0) {
      const t = this.find(targets, DELBITER.search);
      if (!t) {
        this.b++;
        if (this.b > DELBITER.waitFrames) {
          this.a = 1;
          this.fadeT = DELBITER.fadeDone; // +8: t = 2
          this.fade = true;
        }
      } else this.a = 2;
    } else if (this.a === 1) {
      this.fadeT = Math.fround(this.fadeT - DELBITER.fadeStep);
      if (this.fadeT <= 0) this.a = 3;
    }
  }

  private chasing(out: AiFrame, targets: readonly AiTarget[]): void {
    this.animate();
    if (this.los(targets)) {
      const t = this.target(targets);
      if (t) this.aim(t);
    }
    this.angle = turnToward(this.angle, this.headingToDir(), bamsToRad(DELBITER.chaseTurn));
    const stop = this.mv.iparam[4] ?? 0;
    if (stop < this.tdist) {
      this.x = Math.fround(this.x + Math.sin(this.angle) * this.mv.fparam2);
      this.z = Math.fround(this.z + Math.cos(this.angle) * this.mv.fparam2);
    } else if (Math.sin(this.angle) * this.dirX + Math.cos(this.angle) * this.dirZ >= Math.cos(bamsToRad(DELBITER.chaseAlign))) this.a = 1;
    void out;
  }

  // The look-and-aim shared by the roll's frames.
  private aimIfSeen(targets: readonly AiTarget[]): void {
    if (this.los(targets)) {
      const t = this.target(targets);
      if (t) this.aim(t);
    }
  }

  private rolling(out: AiFrame, targets: readonly AiTarget[]): void {
    this.animate();
    if (this.a === 0) {
      // The dust at motion frames 16 and 26 (DELBITER.rollFrames) is cosmetic.
      if (this.ended) {
        this.a = 1;
        this.setAnim(out, 2, this.rows.run);
      }
      this.aimIfSeen(targets);
      this.angle = turnToward(this.angle, this.headingToDir(), bamsToRad(DELBITER.rollWindupTurn));
      return;
    }
    if (this.a === 1) {
      this.aimIfSeen(targets);
      this.x = Math.fround(this.x + this.dirX * this.speedV);
      this.z = Math.fround(this.z + this.dirZ * this.speedV);
      this.travelled = Math.fround(this.travelled + this.mv.fparam1);
      const hit = this.bodyHits(out, targets);
      // 0x0054c4d9..: the stop rule. ASSUMED no wall in the way.
      const t = this.target(targets);
      let keep = !hit && this.travelled < this.mv.fparam5;
      if (t) {
        const d = Math.hypot(t.x - this.x, t.z - this.z);
        if (d >= DELBITER.rollStopDistance) {
          const ux = (t.x - this.x) / d;
          const uz = (t.z - this.z) / d;
          if (Math.sin(this.angle) * ux + Math.cos(this.angle) * uz < 0) keep = false;
        }
      }
      if (!keep) {
        this.a = 2;
        this.b = 0;
        this.resumeState = 'chase';
      }
      return;
    }
    if (this.a === 2) {
      this.b++;
      if (this.b > DELBITER.rollHold) {
        this.setAnim(out, 3, this.rows.stop);
        if (this.ended) {
          this.a = 3;
          this.busy = false;
        }
        this.speedV = Math.fround(this.speedV * DELBITER.rollSlow);
      }
      this.bodyHits(out, targets);
      this.x = Math.fround(this.x + this.dirX * this.speedV);
      this.z = Math.fround(this.z + this.dirZ * this.speedV);
    }
  }

  private swinging(out: AiFrame, targets: readonly AiTarget[]): void {
    this.animate();
    if (this.b === 0) {
      // The claws are live between motion frames 10.8 and 13.
      if (this.elapsed >= DELBITER.clawWindow[0] && this.elapsed <= DELBITER.clawWindow[1]) {
        for (const t of targets) {
          if (t.dead || this.hits.has(t.clientId) || !this.inAttack(t, this.attack)) continue;
          this.hits.add(t.clientId);
          out.hit = { clientId: t.clientId, knockback: DELBITER.knockback, mult: 1 };
          break;
        }
      }
      if (this.ended) {
        this.b = 1;
        this.setAnim(out, 0, this.rows.wait);
        this.a = 0;
      }
    } else if (this.b === 1) {
      this.a++;
      if ((this.mv.iparam[0] ?? 0) <= this.a) this.b = 2;
    }
  }

  private howling(targets: readonly AiTarget[]): void {
    this.animate();
    if (!this.ended) {
      if (this.crossed(DELBITER.howlFrame)) {
        for (const t of targets) {
          if (t.dead) continue;
          if (this.dist(t) > this.confuseRange) continue;
          if (Math.fround(this.rng()) <= this.confuseChance) this.confusions.push(t.clientId);
        }
      }
    } else this.a = 1;
  }

  // The farthest living player within 300 (strictly beyond 0): 0x0054b4f5.
  private farthest(targets: readonly AiTarget[]): AiTarget | null {
    let best: AiTarget | null = null;
    let bestSq = 0;
    for (const t of targets) {
      if (t.dead) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d < DELBITER.laserSearchSq && bestSq < d) {
        best = t;
        bestSq = d;
      }
    }
    return best;
  }

  private pickLaserTarget(targets: readonly AiTarget[]): boolean {
    const t = this.farthest(targets);
    if (!t) {
      this.targetId = null;
      this.a = 4;
      return false;
    }
    this.targetId = t.clientId;
    this.aim(t);
    this.laserHeading = this.headingToDir();
    return true;
  }

  private lasering(out: AiFrame, targets: readonly AiTarget[]): void {
    this.animate();
    if (this.a === 0) {
      if (this.pickLaserTarget(targets)) this.a = 1;
    } else if (this.a === 1) {
      const diff = wrap(this.laserHeading - this.angle);
      const step = bamsToRad(DELBITER.laserTurn);
      if (Math.abs(diff) <= step) {
        this.angle = this.laserHeading;
        this.a = 2;
        this.setAnim(out, 5, this.rows.beam);
      } else this.angle = wrap(this.angle + Math.sign(diff) * step);
    } else if (this.a === 2) {
      if (this.ended) {
        if (!this.ultimate) this.a = 4;
        else {
          this.b++;
          if (this.b < DELBITER.laserShots) {
            if (this.pickLaserTarget(targets)) {
              this.a = 0;
              this.animId = -1;
              this.setAnim(out, 1, this.rows.walk);
            }
          } else this.a = 4;
        }
      }
      if (this.crossed(DELBITER.laserFrame)) {
        (out.shots ??= []).push(
          new TechBolt({
            x: this.x + Math.sin(this.angle) * DELBITER.mouthAhead,
            y: DELBITER.mouthHeight,
            z: this.z + Math.cos(this.angle) * DELBITER.mouthAhead,
            angle: this.angle,
            speed: DELBITER.laser.speed,
            range: DELBITER.laser.range,
            radius: DELBITER.laser.radius,
            effect: { kind: 'tech', power: this.mv.iparam[3] ?? 0 },
            color: 0xff40a0,
            pierce: true,
          }),
        );
      }
    }
  }

  private charging(): void {
    this.animate();
    if (this.ended) {
      this.a = 1;
      this.charged = true;
      this.chargeTimer = (this.mv.iparam[5] ?? 0) * DELBITER.chargeFrames;
    }
  }

  // --- owner hooks ----------------------------------------------------------

  // The hit handler 0x005a99d8.
  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.hitFlinch = false;
    if (this.state === 'flinch') return;
    this.targetId = clientId;
    this.aggro = true;
    this.current = null;
    if (this.busy || this.charged) return;
    this.hitFlinch = true;
    this.state = 'flinch';
    this.a = 0;
    this.b = 0;
    this.animId = 6;
    this.start(this.frame(), this.rows.damage);
  }

  // The flinch ended (the check of state 10, 0x0054b2b4).
  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    this.hitFlinch = false;
    this.skipCheck = true;
    if (!this.charged && this.hpFraction <= DELBITER.halfHp && Math.fround(this.rng()) <= this.chargeChance) this.enter(out, 'charge');
    else if (Math.fround(this.rng()) <= this.howlChance) this.enter(out, 'howl');
    else if (Math.fround(this.rng()) <= this.laserChance) this.enter(out, 'laser');
    else this.enter(out, this.resumeState);
    return this.state;
  }
}

