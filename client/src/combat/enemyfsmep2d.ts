// Per-family enemy state machines of Episode 2, part d (PsoBB.exe, Ephinea
// 1.25.13, addresses are VAs): the Morfos, the Recobox and its Recons, the
// Epsilon and its Epsigards. Same EnemyBrain shape as combat/enemyfsm.ts and
// combat/enemyfsmep2.ts, so render/combat.ts drives them the same way.
//
// All of them are dispatchers on enemy+0x32e whose handler takes an argument:
// 4 = enter the state, 3 = the transition check, 0 = the frame, 5 = leave the
// state (SetEnemyAiState_0051f62c runs 5 on the old state and 4 on the new
// one). The frame (EnemyTransitionAiState_0051f5bc, vtable +0x15c) runs 3 and
// then 0, except when the state was changed from outside since the last frame
// (vtable +0x160: unknown_ai_state != enemy+0x37c, set after every frame): the
// transition check is skipped once. The base update (vtable +0x154,
// ValidateEnemyTarget_0052164c -> EnemyUpdateLoop_0052167c) runs the hit handler
// (vtable +0x100) of an enemy that took damage; `flinches()` is that handler
// here. +0x380 is the state a flinch resumes into.
//
// Shared helpers of the base class (enemy ctor 0x005216f4):
//   FindEnemyTarget_00520ea0 (EnemyUpdateTarget_00520ebc): every enemy+0x3bc
//     frames (the ctors set 60 / 30 / 10 with unknown_set_state_interval_maybe
//     _00521820; the counter starts at entity_index % interval) the nearest
//     live player within the radius (FindNearestPlayer_00521160, with a map
//     ray to the player's weapon position), in between the target is kept
//     while EnemyResolveTarget_00520f04 finds it valid (alive: entity flags
//     0x2040800 clear);
//   SetEnemyTargetPosition / InitializeEnemyAnimationVelocity (0x005213d8 /
//     0x00521410): copy the target's position to enemy+0x39c and keep the
//     normalised xz direction to it at +0x3a8 / +0x3b0 and the distance at
//     +0x3b4 (both read stale when the target is gone);
//   RotateTowardsAngle_0057bb14: turn the 16-bit heading toward an angle by
//     at most a step, snapping when within it.
// The map rays (line of sight, walls) are not reproduced anywhere: ASSUMED
// open space, as in combat/enemyfsmep2.ts. Sound effects and particles are
// cited, not played. Heights: the owner keeps the enemy on the ground.
//
// The Episode 2 decompilation psobb-client-source (JP build) has no C for any
// of these classes (checked by their constants); everything here is the
// Ephinea dump plus the executable's data and disassembly.

import { BAMS_TO_RAD, COLLISION_RADIUS_DEFAULT, type AiFrame, type AiTarget, type EnemyAiMotion } from './enemyai.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, PLAYER_RADIUS, loop, once, wrap } from './enemyfsm.ts';
import { EnemyShot, PLAYER_AIM_HEIGHT, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { exhaustive } from '../exhaustive.ts';

const TAU = Math.PI * 2;
const f32 = Math.fround;

// --- shared pieces --------------------------------------------------------------

// The 16-bit angle (BAMS) of a direction, truncated like the fistp with the
// control word or'ed with 0xc00 that the handlers use, as an unsigned 16-bit.
export const bamsOf = (dx: number, dz: number): number => Math.trunc((Math.atan2(dx, dz) * 0x10000) / TAU) & 0xffff;

// CheckUShortRange_0057b218: the sweep from `a` to `b` (increasing, 16-bit)
// includes `c`.
export const sweepPasses = (a: number, b: number, c: number): boolean => ((c - a) & 0xffff) <= ((b - a) & 0xffff);

// b_minus_a: the signed 16-bit difference.
export const diff16 = (from: number, to: number): number => ((to - from) << 16) >> 16;

// The effect objects of the spawn / vanish (vtable 0x00aff758 and 0x00b069b0,
// both: speed 2.0 / 10 = 0.2 a step, 0x00512314 / 0x00576a64): InitializeParticleEffectSubEntity_00512494
// starts at -20 * 0.2, InitializeEnemyStateTimer_00576c48 at -30 * 0.2; +0x14
// adds a step and is done at 2.0 (0x0092057c / 0x00927234); +8 resets to 2.0
// and +0x10 subtracts a step, done at 0 (0x00920594 / 0x0092724c). float32.
export class FadeEffect {
  private p = 0;
  private readonly step: number;
  constructor(step = f32(f32(2) / 10)) {
    this.step = step;
  }
  start(rise: number): void {
    this.p = f32(this.step * -rise);
  }
  up(): boolean {
    this.p = f32(this.p + this.step);
    return this.p >= 2;
  }
  full(): void {
    this.p = 2;
  }
  down(): boolean {
    this.p = f32(this.p - this.step);
    return this.p <= 0;
  }
}

// The brain base of this file: a 16-bit heading kept as an integer next to the
// radian `angle` the owner reads, the target bookkeeping of the base class and
// the motion frame counter (Player__Animate / check_entity_animation_elapsed
// _threshold: the owner reports the end of a one-shot motion).
abstract class Ep2dBrain<S extends string> extends BrainBase {
  abstract override state: S | 'dead';
  confused = false; // entity+0x30 & 0x10
  hpFraction = 1; // the owner keeps it current when it has nothing better
  // Current HP as a fraction of the maximum (set by the owner at hit time).
  health: (() => number) | null = null;
  protected h: number; // y_rot, 16-bit units (not wrapped)
  protected frames = 0; // motion frames of the current animation
  protected ended = false; // the current one-shot motion ended (animation_flags & 0x10)
  protected skipCheck = false; // state changed from outside: skip the next transition check
  // Target bookkeeping (enemy+0x3b8 / 0x3bc, +0x39c, +0x3a8 / 0x3b0 / 0x3b4).
  protected retarget: number;
  protected readonly interval: number;
  protected tx = 0;
  protected tz = 0;
  protected tdx = 0;
  protected tdz = 0;
  protected tdist = 0;
  protected targets: readonly AiTarget[] = [];
  // A motion set outside tick() (a hit handler); the next tick hands it over.
  private pending: EnemyAiMotion | null = null;
  protected readonly spawnX: number;
  protected readonly spawnZ: number;

  constructor(opts: { x: number; z: number; angle: number; interval: number; phase?: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.h = Math.round(opts.angle / BAMS_TO_RAD);
    this.interval = opts.interval;
    this.retarget = (opts.phase ?? 0) % opts.interval;
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
  }

  protected get hp01(): number {
    return this.health ? this.health() : this.hpFraction;
  }

  protected sinH(h = this.h): number {
    return Math.sin(h * BAMS_TO_RAD);
  }

  protected cosH(h = this.h): number {
    return Math.cos(h * BAMS_TO_RAD);
  }

  protected setAnim(out: AiFrame | null, m: EnemyAiMotion): void {
    this.frames = 0;
    this.ended = false;
    this.current = m;
    if (out) out.motion = m;
    else this.pending = m;
  }

  // The start of every tick: the shared bookkeeping.
  protected begin(targets: readonly AiTarget[], animationEnded: boolean): AiFrame {
    const out = this.frame();
    this.targets = targets;
    this.ended = animationEnded;
    if (this.pending) {
      out.motion = this.pending;
      this.pending = null;
    }
    return out;
  }

  // The owner plays the current motion itself (after a flinch).
  protected dropPending(): void {
    this.pending = null;
  }

  // Player__Animate: the frame counter advances by the motion's step.
  protected animate(): void {
    this.frames += this.current?.speed ?? 0;
  }

  // check_entity_animation_elapsed_threshold (0x007aaa30): true on the frame
  // the motion's elapsed time crosses the threshold (threshold < elapsed <=
  // threshold + the motion's step).
  protected crossed(frame: number): boolean {
    return this.frames > frame && this.frames <= frame + (this.current?.speed ?? 0);
  }

  protected live(targets: readonly AiTarget[], id: number | null): AiTarget | null {
    if (id === null) return null;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.clientId === id && !t.dead) return t;
    }
    return null;
  }

  // EnemyResolveTarget_00520f04.
  protected resolve(targets: readonly AiTarget[]): AiTarget | null {
    const t = this.live(targets, this.targetId);
    if (!t) this.targetId = null;
    return t;
  }

  // FindNearestPlayer_00521160: the nearest live player within `radius`.
  protected nearestWithin(targets: readonly AiTarget[], radius: number): AiTarget | null {
    let best: AiTarget | null = null;
    let bestSq = radius * radius;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.dead) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d >= bestSq) continue;
      best = t;
      bestSq = d;
    }
    return best;
  }

  // FindEnemyTarget_00520ea0 / EnemyUpdateTarget_00520ebc.
  protected findTarget(targets: readonly AiTarget[], radius: number): boolean {
    if (this.retarget < this.interval) {
      this.retarget++;
      return this.resolve(targets) !== null;
    }
    this.retarget = 0;
    const t = this.nearestWithin(targets, radius);
    this.targetId = t ? t.clientId : null;
    return t !== null;
  }

  // SetEnemyTargetPosition_..005213d8 + InitializeEnemyAnimationVelocity.
  protected setTargetPoint(targets: readonly AiTarget[]): void {
    const t = this.live(targets, this.targetId);
    if (t) {
      this.tx = t.x;
      this.tz = t.z;
    }
  }

  protected initVelocity(): void {
    const dx = this.tx - this.x;
    const dz = this.tz - this.z;
    const len = Math.hypot(dx, dz);
    this.tdist = len;
    this.tdx = len > 0 ? dx / len : 0;
    this.tdz = len > 0 ? dz / len : 0;
  }

  protected aimTarget(targets: readonly AiTarget[]): void {
    this.setTargetPoint(targets);
    this.initVelocity();
  }

  // RotateTowardsAngle_0057bb14 (BAMS): true once the heading is on the angle.
  protected rotateTo(angle: number, step: number): boolean {
    const d = diff16(this.h & 0xffff, angle & 0xffff);
    if (step < d) this.h += step;
    else if (d < -step) this.h -= step;
    else {
      this.h = angle;
      return true;
    }
    return false;
  }

  // The farthest live player within `range` inside +-0xaaa of the heading
  // (the cone loops of 0x0057b730 / 0x0057bf0b: distance below 400, farther
  // than the best so far, dot with the heading above cos(0xaaa)); the map ray
  // is not reproduced.
  protected coneTarget(targets: readonly AiTarget[], range: number): AiTarget | null {
    const cone = Math.cos(0xaaa * BAMS_TO_RAD);
    const sx = this.sinH();
    const cz = this.cosH();
    let best: AiTarget | null = null;
    let bestD = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.dead) continue;
      const dx = t.x - this.x;
      const dz = t.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d >= range || d <= bestD) continue;
      if ((d > 0 ? (dx * sx + dz * cz) / d : 0) <= cone) continue;
      best = t;
      bestD = d;
    }
    return best;
  }

  protected angleToTarget(t: AiTarget): number {
    return Math.trunc((this.angleTo(t) * 0x10000) / TAU);
  }

  protected finishFrame(out: AiFrame): AiFrame {
    this.angle = wrap(this.h * BAMS_TO_RAD);
    return this.finish(out);
  }

  // The last attacker, for the hit handlers (the position it had in the last
  // tick).
  protected attackerOf(id: number | null): AiTarget | null {
    return this.live(this.targets, id);
  }

  // A hit (the owner plays the flinch if flinches() agrees and calls resume()
  // when it ends; the AI does not tick meanwhile).
  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.lastAttacker = clientId;
  }
  protected lastAttacker: number | null = null;
}

// --- Morfos ---------------------------------------------------------------------
//
// Ctor Morfos_Constructor_0057a134 (vtable 0x00b070c0, handler dispatcher
// MorfosProcessBehavior_0057a960, init MorfosInitializeEntity_0057c96c),
// animation table 0x009bee20 over bm_ene_morfos.bml (motions: 0
// attack_kabe_arm, 1 attack_kabe_body, 2 beam_kabe_body, 3 damage_kabe_body,
// 4 dead_kabe_body, 5 wait_kabe_body; rows 0 wait (5, 0.5, loop), 1 attack (1,
// 0.7), 2 beam (2, 0.7), 3 damage (3, 0.7), 4 dead (4, 0.7)), AI record
// 0x009beeec {search 225, turn 1536} (unused: it searches 400 itself). The
// Morfos clings to a wall: it crawls along it toward the player, punches with
// its arm, fires its back-facing laser and sinks into the wall when nobody is
// near. Set entry (newserv Map.cc, matching InitializeEnemyBounds_0057a208):
// param1 = step delta (+0.28, at least 0.1; enemy+0x3e0), param2 = leg length
// delta (+20, at least 5; +0x3e4), param3 = shield chance (+0.1; +0x3e8),
// param4 = flee chance (+0.1; +0x3ec), param6 < 1 = it may crawl (+0x3f0 = 1).
// MovementData row 64 (get_battleparams_animation_speeds(Morfos)): fparam1 =
// bolt speed (7; 10 on Ultimate), fparam2 = bolt power (360; 2100), iparam1 =
// turn step of the walk's aim (BAMS a frame, 500), iparam2 = turn step of the
// punch and laser aims (3000), iparam3 = frames between the two laser shots
// (60; 30), iparam4 = frames of the spin charge (60; 15), iparam5 = BAMS a
// frame of the spin charge (2000).
//   0 (0x0059adf0): the first frame -> 1.
//   1 (0x0057c5f8): appears: the two effect objects (0x00aff758 at +0x3f4,
//     0x00b069b0 at +0x410; FadeEffect) rise, the transition check steps both
//     each frame (30 and 40 steps) -> 3.
//   2 (0x0057c54c): hidden in the wall at its spawn point (flag 1, effects
//     reset); a player within 400 -> 1.
//   3 (0x0057c3d0): the wall bulge rises 0.5 a frame to 12 (24 frames) after a
//     target within 400 shows up; then (not confused) -> 4.
//   4 (0x0057bdf0): the walk. Phase 0 aim = toward the target (the heading
//     when none), 1 turn to it at iparam1, 2 not on Ultimate: crawl along the
//     heading by the step (0x00520b44.. DerolleProcessAttackHitCheck_005209d4)
//     when param6 < 1, count `leg` per leg and, from the second leg, take the
//     farthest player within 400 inside +-0xaaa of the heading (phase 3, the
//     legs restart) else aim again; on Ultimate it never crawls, takes the cone
//     target every frame and keeps aiming. Transition check: confused = none;
//     no target -> 7; target within 30 (0x00927638): rand < 0.3 (0x00927634)
//     -> 6 else 5; phase 3 -> 6.
//   5 (0x0057bb5c): the punch: turn to the target at iparam2 (not aligned and
//     30 or more away: -> 4 at once), animation 1 and the arm; at elapsed 8.0
//     the usual try_hit_entity(1.0) + cause_knockback(5.0) when the player is in
//     reach; 50 frames after the animation -> 4. No target (not confused) -> 7.
//   6 (0x0057b4e8): the laser: turn the back to the target (aim + 0x8000) at
//     iparam2, animation 2, at elapsed 6.0 the bolt flies along heading +
//     0x8000; twice, iparam3 frames apart; the second leaves it facing the
//     target. -> 4.
//   7 (0x0057b364): nobody within 400: 61 frames of waiting (a target -> 4),
//     then the effect objects fade out (reset to 2.0, 0.2 a step to 0) -> 2.
//   9 (0x0057ad0c): the spin laser (the flee state, armoured): spin up for
//     iparam4 frames at iparam5, then 3000 BAMS a frame until the heading turns
//     its back to the target (or a full turn), animation 2, the bolt at elapsed
//     6.0; 4 shots (5 on Very Hard and Ultimate), then -> 4. A flinch resumes
//     into 4.
//   10 (0x0057ab8c) the flinch (animation 3) and 11 (0x0057aa0c) the death
//     (animation 4): the owner plays both. A hit that is not a flinch from
//     behind never moves the state; 8 is never entered.
// Hit handler 0x0057c6d0 (`flinches`): from behind (|angle to the attacker -
// heading| >= 0x4000, 0xaaa..) it flinches, except while armoured (flag 4, the
// spin); from the front never, but it rolls the shield (CheckSinowbeatFlag
// _0057acb8: no shield yet, HP <= half, rand <= param3 + 0.1: the shield stays
// up) and then the flee (CheckLowHealthAndFlee_0057ac74: HP <= half, rand <=
// param4 + 0.1 -> 9). Damage handler 0x00579f98 (`guard`): with the shield up a
// hit from the front (< 0x4000) is blocked (damage 0, particles 0x214 / 0x21a);
// one from behind drops the shield and sets flag 0x20, which makes the flinch
// end (0x0057ab8c) skip the shield roll. The flinch end resumes into the state
// saved at its entry (+0x380).
// ASSUMED: the arm entity (CreateMorfosSubEntity_0057cbc4) and the wall bulge
// are visual only; the laser's muzzle node (enemy+0x4a0) is the Morfos' own
// position; the walk has no wall rays (0x00520940 stops the crawl at walls);
// nothing can hurt it while hidden (state 2); same-room checks hold.
export const MORFOS = {
  search: 400,
  retarget: 60,
  rise: f32(0.5),
  riseMax: 12,
  nearRange: 30,
  laserChance: f32(0.3),
  punchHitFrame: 8,
  punchKnockback: 5,
  punchWait: 50,
  laserFrame: 6,
  laserShots: 2,
  searchFrames: 61,
  boltRange: 500,
  boltRadius: f32(1.5),
  spinPlain: 4,
  spinHard: 5,
  stepBias: f32(0.28),
  stepMin: f32(0.1),
  legBias: 20,
  legMin: 5,
  chanceBias: f32(0.1),
  appearUp: [20, 30] as const,
  behind: 0x4000,
} as const;

const MORFOS_ANIM = {
  wait: loop(5, 0.5),
  punch: once(1, 0.7),
  beam: once(2, 0.7),
  damage: once(3, 0.7),
  dead: once(4, 0.7),
} as const;

// exe states 0..10 (8 is never entered; 11 is `dead`).
export type MorfosState = 'start' | 'appear' | 'hidden' | 'rise' | 'walk' | 'punch' | 'laser' | 'search' | 'spin' | 'flinch';

// The state a flinch resumes into (SetEnemyField0x380 in each enter).
const MORFOS_RESUME: Record<MorfosState, MorfosState> = {
  start: 'start',
  appear: 'rise',
  hidden: 'hidden',
  rise: 'walk',
  walk: 'walk',
  punch: 'punch',
  laser: 'laser',
  search: 'search',
  spin: 'walk',
  flinch: 'walk',
};

// MorfosTechProjectile (ctor 0x0057d0f4, update 0x0057ce94): flies along its
// heading at fparam1 a frame; the travelled counter gains fparam1 and the bolt
// ends at 500 (0x009277dc); it hits every live player other than its owner
// within fparam1 * 1.5 (0x009277e0) on the xz plane and within 20 (0x009277d8)
// in height (ASSUMED always) with entity_hit_by_tech(group 0, power = fparam2),
// once per player (the player's took-damage flag does the same).
export class MorfosBolt extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0x80e0ff, size: 3 };
  private vx: number;
  private vz: number;
  private travelled = 0;
  private radius: number;
  private speed: number;
  private struck = new Set<number>();

  constructor(x: number, z: number, h: number, speed: number, power: number) {
    super(x, PLAYER_AIM_HEIGHT, z);
    this.speed = speed;
    this.vx = Math.sin(h * BAMS_TO_RAD) * speed;
    this.vz = Math.cos(h * BAMS_TO_RAD) * speed;
    this.radius = f32(speed * MORFOS.boltRadius);
    this.effect = { kind: 'tech', power };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.z += this.vz;
    this.travelled = f32(this.travelled + this.speed);
    if (this.travelled >= MORFOS.boltRange) {
      this.done = true;
      return [];
    }
    const hits = this.within(targets, this.radius - PLAYER_RADIUS).filter((t) => !this.struck.has(t.clientId));
    for (const t of hits) this.struck.add(t.clientId);
    return hits;
  }
}

export class MorfosAi extends Ep2dBrain<MorfosState> {
  state: MorfosState | 'dead' = 'start';
  private step: number; // +0x3e0
  private leg: number; // +0x3e4
  private shieldChance: number; // +0x3e8
  private fleeChance: number; // +0x3ec
  private crawls: boolean; // +0x3f0 == 1
  private ultimate: boolean;
  private veryHard: boolean;
  private boltSpeed: number;
  private boltPower: number;
  private aimTurn: number; // iparam1
  private swingTurn: number; // iparam2
  private shotWait: number; // iparam3
  private spinFrames: number; // iparam4
  private spinTurn: number; // iparam5
  private reach: number;
  private arc: number;
  private radius: number;
  // Flags (enemy+0x3c8): 1 hidden, 4 armoured, 0x10 shield, 0x20 shield dropped.
  private hiddenFlag = false;
  private armour = false;
  private shield = false;
  private shieldDropped = false;
  // State-local fields (enemy+0x4b8.. / the casting info of the spin).
  private sub = 0;
  private count = 0;
  private phase = 0;
  private aim = 0;
  private accum = 0;
  private counter = 0;
  private sweepFrom = 0;
  private dirX = 0; // the sin / cos saved when the walk aligned (+0x4d4 / +0x4dc)
  private dirZ = 0;
  private dealt = false;
  private resumeInto: MorfosState = 'walk';
  private readonly fadeA = new FadeEffect(); // +0x3f4
  private readonly fadeB = new FadeEffect(); // +0x410

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    params: readonly number[]; // set entry param1..6
    movement: EnemyMovementData | null;
    attack: EnemyAttackData | null;
    difficulty?: number; // 0 Normal .. 3 Ultimate
    radius?: number;
    phase?: number;
    rng?: () => number;
  }) {
    super({ ...opts, interval: MORFOS.retarget });
    const p = (i: number) => opts.params[i] ?? 0;
    this.step = Math.max(f32(p(0) + MORFOS.stepBias), MORFOS.stepMin);
    this.leg = Math.max(f32(p(1) + MORFOS.legBias), MORFOS.legMin);
    this.shieldChance = f32(p(2) + MORFOS.chanceBias);
    this.fleeChance = f32(p(3) + MORFOS.chanceBias);
    this.crawls = Math.trunc(p(5)) < 1;
    const d = opts.difficulty ?? 0;
    this.ultimate = d === 3;
    this.veryHard = d >= 2;
    const mv = opts.movement;
    this.boltSpeed = mv?.fparam1 ?? 7;
    this.boltPower = mv?.fparam2 ?? 0;
    this.aimTurn = mv?.iparam[0] ?? 500;
    this.swingTurn = mv?.iparam[1] ?? 3000;
    this.shotWait = mv?.iparam[2] ?? 60;
    this.spinFrames = mv?.iparam[3] ?? 60;
    this.spinTurn = mv?.iparam[4] ?? 2000;
    this.reach = opts.attack?.distanceX ?? 32;
    this.arc = ((opts.attack?.angle ?? 0x1a80) & 0xffff) * BAMS_TO_RAD;
    this.radius = opts.radius ?? COLLISION_RADIUS_DEFAULT;
    this.current = MORFOS_ANIM.wait;
  }

  get invulnerable(): boolean {
    return this.state === 'hidden';
  }

  get flinchMotion(): EnemyAiMotion {
    return MORFOS_ANIM.damage;
  }

  get deathMotion(): EnemyAiMotion {
    return MORFOS_ANIM.dead;
  }

  // The shield (flag 0x10) is up.
  get shielded(): boolean {
    return this.shield;
  }

  private halfHp(): boolean {
    return this.hp01 <= 0.5;
  }

  // SetEnemyAiState_0051f62c: leave the old state, enter the new one (event 4).
  private enter(out: AiFrame | null, s: MorfosState): void {
    this.state = s;
    this.sub = 0;
    this.count = 0;
    this.phase = 0;
    this.accum = 0;
    this.counter = 0;
    this.dealt = false;
    this.hiddenFlag = false;
    this.armour = false;
    switch (s) {
      case 'start':
        break;
      case 'appear':
        // flags & ~5 | 2; the two effect objects start rising.
        this.setAnim(out, MORFOS_ANIM.wait);
        this.fadeA.start(MORFOS.appearUp[0]);
        this.fadeB.start(MORFOS.appearUp[1]);
        break;
      case 'hidden':
        // flag 1, back at the spawn point (enemy+0x50), effects reset.
        this.setAnim(out, MORFOS_ANIM.wait);
        this.hiddenFlag = true;
        if (this.x !== this.spawnX || this.z !== this.spawnZ) this.warps++;
        this.x = this.spawnX;
        this.z = this.spawnZ;
        this.fadeA.full();
        this.fadeB.full();
        break;
      case 'rise':
      case 'walk':
      case 'punch':
      case 'search':
        this.setAnim(out, MORFOS_ANIM.wait);
        break;
      case 'laser':
        // No target -> sub 6; else turn the back to it (the direction of the
        // last InitializeEnemyAnimationVelocity, stale or not).
        this.setAnim(out, MORFOS_ANIM.wait);
        if (this.resolve(this.targets)) {
          this.aim = (bamsOf(this.tdx, this.tdz) + 0x8000) & 0xffff;
        } else this.sub = 6;
        break;
      case 'spin':
        // flags & ~3 | 4: armoured.
        this.armour = true;
        this.setAnim(out, MORFOS_ANIM.wait);
        break;
      case 'flinch':
        this.setAnim(out, MORFOS_ANIM.damage);
        break;
      default:
        exhaustive(s);
    }
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    if (this.state === 'dead') return this.frame();
    const out = this.begin(targets, animationEnded);
    if (!this.skipCheck) this.transitions(out);
    this.skipCheck = false;
    this.update(out);
    out.hidden = this.hiddenFlag;
    return this.finishFrame(out);
  }

  // Event 3.
  private transitions(out: AiFrame): void {
    const state = this.state;
    if (state === 'dead') return;
    switch (state) {
      case 'start':
        this.enter(out, 'appear');
        break;
      case 'appear': {
        // Both objects are stepped every frame.
        const b = this.fadeB.up();
        const a = this.fadeA.up();
        if (a && b) this.enter(out, 'rise');
        break;
      }
      case 'hidden':
        if (this.findTarget(this.targets, MORFOS.search)) this.enter(out, 'appear');
        break;
      case 'rise':
        if (this.sub === 2 && !this.confused) this.enter(out, 'walk');
        break;
      case 'walk':
        if (this.confused) break;
        if (this.targetId === null) this.enter(out, 'search');
        else if (this.tdist <= MORFOS.nearRange) this.enter(out, f32(this.rng()) < MORFOS.laserChance ? 'laser' : 'punch');
        else if (this.phase === 3) this.enter(out, 'laser');
        break;
      case 'punch':
        if (this.sub === 0) {
          if (!this.confused && this.targetId === null) this.enter(out, 'search');
        } else if (this.sub === 3) this.enter(out, 'walk');
        break;
      case 'laser':
        if (this.sub === 6 && !this.confused) this.enter(out, 'walk');
        break;
      case 'search':
        if (this.confused) break;
        if (this.sub === 2) this.enter(out, 'walk');
        else if (this.sub === 3) this.enter(out, 'hidden');
        break;
      case 'spin':
        if (this.sub === 5 && !this.confused) this.enter(out, 'walk');
        break;
      case 'flinch':
        break;
      default:
        exhaustive(state);
    }
  }

  // Event 0.
  private update(out: AiFrame): void {
    const targets = this.targets;
    const state = this.state;
    if (state === 'dead') return;
    switch (state) {
      case 'start':
      case 'hidden':
      case 'flinch':
        break;
      case 'appear':
        this.animate();
        break;
      case 'rise':
        this.animate();
        this.riseFrame(targets);
        break;
      case 'walk':
        this.animate();
        this.walkFrame(targets);
        break;
      case 'punch':
        this.animate();
        this.punchFrame(out, targets);
        break;
      case 'laser':
        this.animate();
        this.laserFrame(out, targets);
        break;
      case 'search':
        this.animate();
        this.searchFrame(targets);
        break;
      case 'spin':
        this.animate();
        this.spinFrame(out, targets);
        break;
      default:
        exhaustive(state);
    }
  }

  // 0x0057c3d0 event 0.
  private riseFrame(targets: readonly AiTarget[]): void {
    if (this.sub === 0) {
      if (this.findTarget(targets, MORFOS.search)) {
        this.sub = 1;
        this.aimTarget(targets);
      }
    } else if (this.sub === 1) {
      this.accum = f32(MORFOS.rise + this.accum);
      if (Math.floor(this.accum) >= MORFOS.riseMax) this.sub = 2;
    }
  }

  // 0x0057bdf0 event 0.
  private walkFrame(targets: readonly AiTarget[]): void {
    if (this.findTarget(targets, MORFOS.search)) this.aimTarget(targets);
    if (this.phase === 0) {
      this.aim = this.resolve(targets) ? bamsOf(this.tdx, this.tdz) : this.h;
      this.phase = 1;
    } else if (this.phase === 1) {
      if (this.rotateTo(this.aim, this.aimTurn)) {
        this.phase = 2;
        this.dirX = this.sinH();
        this.dirZ = this.cosH();
      }
    } else if (this.phase === 2) {
      if (this.ultimate) {
        // Never crawls: the cone target at once, else keep facing the target.
        const c = this.coneTarget(targets, MORFOS.search);
        if (!c) this.aim = this.resolve(targets) ? bamsOf(this.tdx, this.tdz) : this.h & 0xffff;
        else {
          this.targetId = c.clientId;
          this.aimTarget(targets);
          this.phase = 3;
        }
        this.rotateTo(this.aim, this.aimTurn);
        return;
      }
      this.accum = f32(this.step + this.accum);
      if (this.leg <= this.accum) {
        this.accum = 0;
        this.count++;
        const c = this.count > 1 ? this.coneTarget(targets, MORFOS.search) : null;
        if (c) {
          this.targetId = c.clientId;
          this.count = 0;
          this.aimTarget(targets);
          this.phase = 3;
        } else this.phase = 0;
      }
      // DerolleProcessAttackHitCheck_005209d4: a step along the saved heading.
      if (this.crawls) {
        this.x += this.dirX * this.step;
        this.z += this.dirZ * this.step;
      }
    }
  }

  // 0x0057bb5c event 0.
  private punchFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.sub === 0) {
      // cast_ray_from_enemy_to_target: ASSUMED clear while the target lives.
      if (this.resolve(targets)) {
        this.aimTarget(targets);
        if (this.rotateTo(bamsOf(this.tdx, this.tdz), this.swingTurn)) {
          this.sub = 1;
          this.setAnim(out, MORFOS_ANIM.punch);
        } else if (MORFOS.nearRange <= this.tdist) this.sub = 3;
      }
    } else if (this.sub === 1) {
      if (!this.dealt && (this.crossed(MORFOS.punchHitFrame) || this.ended)) {
        this.dealt = true;
        const t = this.resolve(targets);
        if (t && this.inReach(t)) out.hit = { clientId: t.clientId, knockback: MORFOS.punchKnockback, mult: 1 };
      }
      if (this.ended) {
        this.sub = 2;
        this.counter = 0;
        this.setAnim(out, MORFOS_ANIM.wait);
      }
    } else if (this.sub === 2) {
      if (++this.counter >= MORFOS.punchWait) {
        this.sub = 3;
        this.setAnim(out, MORFOS_ANIM.wait);
      }
    }
  }

  // unknown_enemy_attack_should_push_defender: ASSUMED the AttackData reach
  // plus the collision radius inside its arc, as the Booma's +0x80.
  private inReach(t: AiTarget): boolean {
    return this.dist(t) <= this.reach + this.radius && Math.abs(wrap(this.angleTo(t) - this.h * BAMS_TO_RAD)) <= this.arc;
  }

  // 0x0057b4e8 event 0.
  private laserFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.sub) {
      case 0:
        if (this.rotateTo(this.aim, this.swingTurn)) {
          this.sub = 1;
          this.setAnim(out, MORFOS_ANIM.beam);
          this.dealt = false;
        }
        break;
      case 1:
        if (this.crossed(1) || this.ended) this.sub = 2;
        break;
      case 2:
        if (this.crossed(MORFOS.laserFrame) || this.ended) {
          out.shots = [new MorfosBolt(this.x, this.z, (this.aim + 0x8000) & 0xffff, this.boltSpeed, this.boltPower)];
          this.sub = 3;
        }
        break;
      case 3:
        if (this.ended) {
          this.count++;
          this.setAnim(out, MORFOS_ANIM.wait);
          if (!this.resolve(targets)) {
            // The cone loop of 0x0057b730: the farthest visible player ahead.
            const c = this.coneTarget(targets, MORFOS.search);
            if (!c) {
              this.sub = 5;
              this.aim = (this.aim + 0x8000) & 0xffff;
              break;
            }
            this.targetId = c.clientId;
            this.aimTarget(targets);
          }
          this.afterShot();
        }
        break;
      case 4:
        if (++this.counter >= this.shotWait) {
          if (!this.resolve(targets)) this.sub = 6;
          else {
            this.aimTarget(targets);
            this.sub = 0;
            this.aim = (bamsOf(this.tdx, this.tdz) + 0x8000) & 0xffff;
          }
        }
        break;
      case 5:
        if (this.rotateTo(this.aim, this.swingTurn)) this.sub = 6;
        break;
      default:
        break;
    }
  }

  // After a shot: wait for the second, or turn to face the target.
  private afterShot(): void {
    if (this.count < MORFOS.laserShots) {
      this.sub = 4;
      this.counter = 0;
    } else {
      this.aim = bamsOf(this.tdx, this.tdz);
      this.sub = 5;
    }
  }

  // 0x0057b364 event 0.
  private searchFrame(targets: readonly AiTarget[]): void {
    if (this.sub === 0) {
      if (!this.findTarget(targets, MORFOS.search)) {
        if (++this.counter < MORFOS.searchFrames) return;
        this.counter = 0;
        this.sub = 1;
        this.fadeA.full();
        this.fadeB.full();
      } else {
        this.aimTarget(targets);
        this.sub = 2;
      }
    } else if (this.sub === 1) {
      const b = this.fadeB.down();
      const a = this.fadeA.down();
      if (a && b) this.sub = 3;
    }
  }

  // 0x0057ad0c event 0.
  private spinFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.sub) {
      case 0:
        // Spin up: iparam5 BAMS a frame for iparam4 frames.
        this.sweepFrom = this.h;
        this.h += this.spinTurn;
        if (++this.accum >= this.spinFrames) {
          this.sub = 1;
          this.count = 0;
        }
        break;
      case 1: {
        const before = this.h & 0xffff;
        this.h += this.swingTurn;
        let anyone = false;
        for (let i = 0; i < targets.length; i++) if (!targets[i].dead) anyone = true;
        if (anyone) {
          // SetEnemyTargetPosition uses the *current* target (kept from the
          // walk): the aim is its direction + 0x8000.
          if (this.resolve(targets)) this.aimTarget(targets);
          this.aim = (bamsOf(this.tdx, this.tdz) + 0x8000) & 0xffff;
          if (sweepPasses(before, this.h & 0xffff, this.aim)) {
            this.h = this.aim;
            this.sub = 2;
            this.setAnim(out, MORFOS_ANIM.beam);
            break;
          }
        }
        if (sweepPasses(before, this.h & 0xffff, this.sweepFrom & 0xffff)) {
          this.sub = 2;
          this.setAnim(out, MORFOS_ANIM.beam);
        }
        break;
      }
      case 2:
        if (this.crossed(1) || this.ended) this.sub = 3;
        break;
      case 3:
        if (this.crossed(MORFOS.laserFrame) || this.ended) {
          out.shots = [new MorfosBolt(this.x, this.z, (this.h + 0x8000) & 0xffff, this.boltSpeed, this.boltPower)];
          this.sub = 4;
        }
        break;
      case 4:
        if (this.ended) {
          this.setAnim(out, MORFOS_ANIM.wait);
          this.count++;
          if (this.count < (this.veryHard ? MORFOS.spinHard : MORFOS.spinPlain)) {
            this.sweepFrom = this.h;
            this.h += this.swingTurn;
            this.sub = 1;
          } else this.sub = 5;
        }
        break;
      default:
        break;
    }
  }

  // MorfosOnHit_00579f98 (the damage handler): the shield blocks a hit from
  // the front, drops on one from behind and sets flag 0x20. True = blocked.
  guard(ax: number, az: number): boolean {
    if (!this.shield) return false;
    if (Math.abs(diff16(this.h & 0xffff, bamsOf(ax - this.x, az - this.z))) < MORFOS.behind) return true;
    this.shield = false;
    this.shieldDropped = true;
    return false;
  }

  // The hit handler 0x0057c6d0: true when the flinch (state 10) starts.
  flinches(_damage?: number, _maxHp?: number): boolean {
    if (this.state === 'dead' || this.state === 'flinch') return false;
    const a = this.attackerOf(this.lastAttacker);
    const behind = a !== null && Math.abs(diff16(this.h & 0xffff, bamsOf(a.x - this.x, a.z - this.z))) >= MORFOS.behind;
    if (behind) {
      if (this.armour) return false; // only the damage flag is cleared
      this.resumeInto = MORFOS_RESUME[this.state];
      this.state = 'flinch';
      this.hiddenFlag = false;
      this.setAnim(null, MORFOS_ANIM.damage);
      return true;
    }
    if (!this.rollShield()) this.rollFlee();
    return false;
  }

  // CheckSinowbeatFlag_0057acb8.
  private rollShield(): boolean {
    if (!this.shield && this.halfHp() && f32(this.rng()) <= this.shieldChance) {
      this.shield = true;
      return true;
    }
    return false;
  }

  // CheckLowHealthAndFlee_0057ac74: SetEnemyAiState(9) from outside.
  private rollFlee(): boolean {
    if (this.halfHp() && f32(this.rng()) <= this.fleeChance) {
      this.enter(null, 'spin');
      this.skipCheck = true;
      return true;
    }
    return false;
  }

  // The flinch ended (event 3 of 0x0057ab8c).
  resume(): string {
    if (this.state === 'dead') return this.state;
    const prev = this.resumeInto;
    if (!this.shieldDropped) {
      if (this.rollShield() || !this.rollFlee()) this.enter(null, prev);
    } else {
      this.shieldDropped = false;
      if (!this.rollFlee()) this.enter(null, prev);
    }
    // The owner plays the current motion itself.
    this.dropPending();
    this.skipCheck = false;
    return this.state;
  }
}

// --- Recobox and Recon ----------------------------------------------------------
//
// Recobox: ctor recobox_constructor 0x0058859c (vtable 0x00b07e80, handler
// dispatcher DerolleObjectDispatch_00589a2c, model 1 of bm_ene_recobox.bml,
// table 0x009bf680: row 0 close_only (motion 1, 0.1, loop), 1 open (2, 0.6),
// 2 open_only (3, 0.1, loop), 3 close (0, 0.6)). It opens, drops Recons out of
// itself one by one, closes and waits until enough of them are gone. Set entry
// (newserv Map.cc, matching recon_apply_initdata_from_recobox 0x00589374):
// param1 = Recon hover height delta (+45 +- 2), param2 = Recon orbit radius
// delta (+50 +- 5, at least -30), param4 = Recons alive at once (rounded, 0 to
// 6), param6 = 0 floor (Recons go up at 5), 1 ceiling (down at 5), 2 or more
// wall (horizontal, 2 along the heading); the set entry's num_children is
// clone_count: total = min(30, clone_count - 1) (0 when param4 is 0 or
// clone_count < 2), alive at once = min(param4, total). The Recons are the
// following slots (box + 1 + child index), each spawned at most once.
//   0 (0x00589df0): the first frame -> 1.
//   1 (0x00589268): the 40-frame fade-in (the effect object at +0x3c8) -> 2.
//   2 (0x00589148): closed: a player within 500 (nearest) and no Recon in its
//     state 5, alive <= floor(alive-at-once / 2) (0x00928624 = 2.0; the helper
//     0x0083c230 is floor) and spawned < total -> 3.
//   3 (0x005890c8): opens (row 1) -> 4 when the motion ends (spawn timer 0,
//     period 30).
//   4 (0x00588d9c): open_only; every 30 frames, while alive < at-once and
//     spawned < total, the next unused child comes out (SE 0x264); -> 5 when a
//     Recon is in its state 5 or no more can come out.
//   5 (0x00588d30): closes (row 3) -> 2 when the motion ends.
//   6 (0x0058892c): the death (OnDie +0x104): explosion; removed when its Recons
//     are gone (they die with it).
// The box has no flinch (+0x100 only clears the damage flag).
export const RECOBOX = {
  search: 500,
  fadeIn: 30, // times the 0.2 step: starts at -6.0, 40 steps to 2.0
  period: 30,
  totalMax: 30,
  aliveMax: 6,
  side: 2,
  up: 5,
  hoverBase: 45,
  hoverSpread: 2,
  radiusBase: 50,
  radiusSpread: 5,
  radiusMin: -30,
  aimBase: 15,
  aimSpread: 2,
} as const;

const RECOBOX_ANIM = {
  closed: loop(1, 0.1),
  open: once(2, 0.6),
  opened: loop(3, 0.1),
  close: once(0, 0.6),
} as const;

export type RecoboxState = 'start' | 'appear' | 'closed' | 'opening' | 'opened' | 'closing';

// One Recon to bring into the world (the owner builds its runtime in slot
// box + 1 + child and starts `recon`).
export interface ReconSpawn {
  child: number;
  recon: ReconAi;
  x: number;
  z: number;
}

export class RecoboxAi extends Ep2dBrain<RecoboxState> {
  state: RecoboxState | 'dead' = 'start';
  readonly spawns: ReconSpawn[] = [];
  readonly alive: ReconAi[] = []; // enemy+0x420 (at most 6)
  private readonly used: boolean[]; // enemy+0x42c: a child index is spawned once
  spawned = 0; // +0x41c
  private total: number; // +0x3fc
  private maxAlive: number; // +0x400
  private kind: number; // +0x3e4
  private hoverBias: number;
  private radiusBias: number;
  private ultimate: boolean;
  private timer = 0;
  private readonly fade = new FadeEffect();
  private readonly movement: EnemyMovementData | null;
  private readonly attack: EnemyAttackData | null;

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    params: readonly number[]; // set entry param1..6
    cloneCount: number; // the set entry's num_children
    movement: EnemyMovementData | null; // the Recon's row
    attack: EnemyAttackData | null; // the Recon's AttackData
    difficulty?: number;
    rng?: () => number;
  }) {
    super({ ...opts, interval: 30 });
    const p = (i: number) => opts.params[i] ?? 0;
    const p6 = Math.trunc(p(5));
    this.kind = p6 < 1 ? 0 : p6 < 2 ? p6 : 2;
    this.hoverBias = p(0);
    this.radiusBias = Math.max(p(1), RECOBOX.radiusMin);
    let n = Math.round(p(3));
    if (n > 5) n = 6;
    if (n < 1) n = 0;
    this.total = n === 0 ? 0 : RECOBOX.totalMax;
    if (opts.cloneCount < 2) this.total = 0;
    else if (opts.cloneCount <= this.total) this.total = opts.cloneCount - 1;
    this.maxAlive = Math.min(n, this.total);
    this.used = new Array<boolean>(Math.max(this.total, 1)).fill(false);
    this.ultimate = opts.difficulty === 3;
    this.movement = opts.movement;
    this.attack = opts.attack;
    this.current = RECOBOX_ANIM.closed;
  }

  flinches(): boolean {
    return false;
  }

  // ASSUMED: the exe plays no death motion (it bursts); the box closes.
  get deathMotion(): EnemyAiMotion {
    return RECOBOX_ANIM.close;
  }

  // The state a Recon reads (IsDerolleInProjectileState / the box's death).
  get dying(): boolean {
    return this.state === 'dead';
  }

  // DerolleObjectCountEntities_00589acc: whether fewer Recons than the limit
  // (2; 4 on Ultimate) already attack that player.
  hasRoomFor(targetId: number): boolean {
    let n = 0;
    for (const r of this.alive) if (r.claimedTarget === targetId) n++;
    return n < (this.ultimate ? 4 : 2);
  }

  // DerolleObjectRemovePlayer_00589b70 / ..bdc.
  release(r: ReconAi): void {
    const i = this.alive.indexOf(r);
    if (i >= 0) this.alive.splice(i, 1);
  }

  // The owner could not build the child: it never counted.
  spawnFailed(r: ReconAi): void {
    this.release(r);
  }

  private anyLeaving(): boolean {
    for (const r of this.alive) if (r.state === 'leave') return true;
    return false;
  }

  // DerolleObjectCheckState4Transition_005891c4.
  private mayReopen(): boolean {
    if (this.anyLeaving()) return false;
    return this.alive.length <= Math.floor(this.maxAlive / 2) && this.spawned < this.total;
  }

  // DerolleObjectAreProjectilesActive_00589040.
  private mustClose(): boolean {
    if (this.anyLeaving()) return true;
    return !(this.alive.length < this.maxAlive && this.spawned < this.total);
  }

  private enter(out: AiFrame | null, s: RecoboxState): void {
    this.state = s;
    switch (s) {
      case 'start':
        break;
      case 'appear':
        this.setAnim(out, RECOBOX_ANIM.closed);
        this.fade.start(RECOBOX.fadeIn);
        break;
      case 'closed':
        this.setAnim(out, RECOBOX_ANIM.closed);
        break;
      case 'opening':
        this.setAnim(out, RECOBOX_ANIM.open);
        break;
      case 'opened':
        this.setAnim(out, RECOBOX_ANIM.opened);
        break;
      case 'closing':
        this.setAnim(out, RECOBOX_ANIM.close);
        break;
      default:
        exhaustive(s);
    }
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    if (this.state === 'dead') return this.frame();
    const out = this.begin(targets, animationEnded);
    const state = this.state;
    if (!this.skipCheck) {
      switch (state) {
        case 'start':
          this.enter(out, 'appear');
          break;
        case 'appear':
          if (this.fade.up()) this.enter(out, 'closed');
          break;
        case 'closed':
          if (this.nearestWithin(targets, RECOBOX.search) && this.mayReopen()) this.enter(out, 'opening');
          break;
        case 'opening':
          if (this.ended) {
            this.timer = 0;
            this.enter(out, 'opened');
          }
          break;
        case 'opened':
          if (this.mustClose()) this.enter(out, 'closing');
          break;
        case 'closing':
          if (this.ended) this.enter(out, 'closed');
          break;
        default:
          exhaustive(state);
      }
    }
    this.skipCheck = false;
    if (this.state === 'opened') {
      this.animate();
      this.spawnFrame();
    } else if (this.state !== 'start') this.animate();
    return this.finishFrame(out);
  }

  // DerolleObjectSpawnDirectionalAttack_00588e10.
  private spawnFrame(): void {
    if (++this.timer < RECOBOX.period) return;
    this.timer = 0;
    if (this.alive.length >= this.maxAlive || this.spawned >= this.total) return;
    let child = -1;
    for (let i = 0; i < this.total; i++) {
      if (!this.used[i]) {
        child = i;
        break;
      }
    }
    if (child < 0) {
      // No unused child left: nothing more will come out.
      this.spawned = this.total;
      return;
    }
    this.used[child] = true;
    // The launch vector: floor up 5, ceiling down 5, wall along the heading.
    const vx = this.kind === 2 ? Math.sin(this.h * BAMS_TO_RAD) * RECOBOX.side : 0;
    const vz = this.kind === 2 ? Math.cos(this.h * BAMS_TO_RAD) * RECOBOX.side : 0;
    const vy = this.kind === 0 ? RECOBOX.up : this.kind === 1 ? -RECOBOX.up : 0;
    const recon = new ReconAi({
      box: this,
      x: this.x,
      z: this.z,
      angle: this.angle,
      vx,
      vy,
      vz,
      hoverBias: this.hoverBias,
      radiusBias: this.radiusBias,
      kind: this.kind,
      movement: this.movement,
      attack: this.attack,
      ultimate: this.ultimate,
      phase: child,
      rng: this.rng,
    });
    this.alive.push(recon);
    this.spawned++;
    this.spawns.push({ child, recon, x: this.x, z: this.z });
  }

  override kill(): void {
    super.kill();
    // The Recons die with the box (update_recon: the box's state 6).
    for (const r of [...this.alive]) r.boxDied();
  }

  resume(): string {
    return this.state;
  }
}

// --- Recon -----------------------------------------------------------------------
//
// Ctor recon_constructor 0x0058a2a0 (vtable 0x00b08100, dispatcher 0x0058aa78
// over the jump table 0x0092889c), fields DerolleInitializeFields_0058c250,
// model 0 of bm_ene_recobox.bml (me7_all.nj), table 0x009bf7c0: row 0 start
// (motion 8, 0.7, loop), 1 wait (9, 0.7, loop), 2 attack (4, 0.8), 3 b_attack
// (5, 0.7), 4 damage (6, 0.6), 5 dethpose (7, 0.7, loop). AI record 0x009bf824
// {search 225, +4 orbit speed 25/27 (written by 0x0058c230), +8 turn 1536}.
// BattleParam row 66: MovementData fparam1 = chase speed (1.15), fparam2 =
// bomb blast radius (18), fparam3 = bomb power (450; 2500 Ultimate), fparam4 =
// bomb speed (3.0), iparam1 = bomb life in seconds (8; 5 Ultimate; * 30
// frames), iparam2 = frames of the saw's wind-up (12); AttackData: atp
// (193; 1500) is the saw's power, distance_x (25) the reach, distance_y (15)
// the saw's hit radius, angle 768 the aim tolerance.
// Per Recon (DerolleInitializeFields): hover 2 * rand(-1, 1) + 45 + the box's
// param1, aim offset 2 * rand + 15, orbit radius 5 * rand + 50 + the box's
// param2. The vertical position is kept as a lift above the ground (the exe's
// 0x00589fdc keeps it at least 5 above the ground under it; the hover height
// is used as an absolute y there: ASSUMED relative to the floor).
//   0 (0x0058bed4): launched out of the box with the box's vector: horizontal
//     speed damped 0.95 a frame (displacement v * |v|^2, 0x005207f4), the
//     vertical speed eased (+-0.1 up to 0.3, 0.9x above it) so it lands on the
//     hover height exactly; then the horizontal speed dies (< 0.01 squared) ->
//     1.
//   1 (0x0058bde0): looks around (turns 0x400 a frame); the target stays while
//     valid, else the nearest player within 200 (0x43480000) -> 4; after 150
//     frames without (the counter is the shared +0x3b8, starts at the child
//     index % 10) -> 5.
//   4 (0x0058b21c): orbits the target at its radius and hover height (the orbit
//     point advances 65536 * speed / (2 pi r) BAMS a frame, direction random,
//     bobbing 10 * sin(0x380 t)) and faces it. After 0x5000 of orbit angle it
//     may shoot (3), after 0x8000 slash (2): only when fewer than 2 (4 on
//     Ultimate) Recons already attack that player, else it looks for another
//     player with room, else keeps orbiting. No target -> 5.
//   3 (0x0058b81c): turns to the target (0x400 a frame), 16 frames, animation
//     3, at elapsed 10.0 the bomb leaves along its heading; -> 4. Target
//     farther than 450 or lost -> 1.
//   2 (0x0058ba48): the saw: chases at fparam1 turning 1536 until within 30,
//     aligned and at its height, waits iparam2 frames, animation 2: from
//     elapsed 7.0 to 31.0 every player within 15 of the saw takes
//     entity_hit_by_tech(group 0, power = AttackData atp) and
//     cause_knockback(7.0); -> 4.
//   5 (0x0058b0cc): fades away (particle 0x79) and leaves the box's list; the
//     box dying -> 7.
//   6 (0x0058ae7c): flinch (animation 4), resumes the state it came from (a
//     slash re-checks the room limit); 7 falls dead (0x0058ab4c), 8 gone.
// The bomb is ReconBomb (0x0058c740 / 0x0058c878). ASSUMED: flat ground
// (bounces at lift 0), no walls, the saw's muzzle 12 in front of the Recon,
// no knockback vector on a hit (0x30c / 0x314).
export const RECON = {
  search: 200,
  far: 450,
  idle: 0x95,
  spin: 0x400,
  aimTurn: 0x400,
  shootWait: 0xf,
  shootFrame: 10,
  slashStart: 7,
  slashEnd: 31,
  slashRadius: 15,
  slashKnockback: 7,
  reach: 5,
  orbitSpeed: f32(25 / 27),
  chaseTurn: 1536,
  stepOut: 0.2,
  bob: 10,
  bobStep: 0x380,
  hoverMin: 5,
  muzzle: 12,
  halfTurn: 0x8000,
  shootArc: 0x5000,
} as const;

const RECON_ANIM = {
  start: loop(8, 0.7),
  wait: loop(9, 0.7),
  slash: once(4, 0.8),
  shoot: once(5, 0.7),
  damage: once(6, 0.6),
  dead: loop(7, 0.7),
} as const;

export type ReconState = 'launch' | 'look' | 'slash' | 'shoot' | 'orbit' | 'leave' | 'flinch' | 'gone';

// The bomb: ctor 0x0058c740, update 0x0058c878. Speed fparam4 along the
// Recon's heading, gravity -0.1 and a 0.95 horizontal drag every frame; the
// first ground contact bounces it (vy * -0.5), the second stops it (state 2:
// armed); armed it explodes when a player touches it; it explodes at the end
// of its life, or when the Recon is hurt or dead. The blast: every player
// within fparam2 takes entity_hit_by_tech(group 0, power = fparam3).
export class ReconBomb extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xffa040, size: 2.5 };
  private vx: number;
  private vy = 0;
  private vz: number;
  private mode = 0;
  private life: number;
  private radius: number;
  private hurt: () => boolean;

  constructor(x: number, y: number, z: number, h: number, speed: number, radius: number, power: number, life: number, hurt: () => boolean) {
    super(x, y, z);
    this.vx = f32(Math.sin(h * BAMS_TO_RAD) * speed);
    this.vz = f32(Math.cos(h * BAMS_TO_RAD) * speed);
    this.radius = radius;
    this.life = life;
    this.hurt = hurt;
    this.effect = { kind: 'tech', power };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    let explode = this.frames > this.life || this.hurt();
    if (!explode && this.mode < 2) {
      this.vy = f32(this.vy - 0.1);
      this.vx = f32(this.vx * 0.95);
      this.vz = f32(this.vz * 0.95);
      this.x += this.vx;
      this.z += this.vz;
      this.y += this.vy;
      if (this.y <= 0) {
        this.y = 0;
        if (this.mode === 0) this.vy = f32(this.vy * -0.5);
        this.mode++;
      }
    } else if (!explode) {
      // Armed: a player within 1 of its body sets it off.
      explode = this.within(targets, 1).length > 0;
    }
    if (!explode) return [];
    this.done = true;
    return this.within(targets, this.radius - PLAYER_RADIUS);
  }
}

// The saw's swing: one frame of a ring of radius 15 at the muzzle; every
// player is hit once per swing.
class ReconSlash extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xc0c0ff, size: 1 };
  private readonly victims: AiTarget[];

  constructor(x: number, z: number, victims: AiTarget[], power: number) {
    super(x, PLAYER_AIM_HEIGHT, z);
    this.victims = victims;
    this.effect = { kind: 'tech', power, knockback: RECON.slashKnockback };
  }

  tick(): AiTarget[] {
    if (this.done) return [];
    this.done = true;
    return this.victims;
  }
}

export class ReconAi extends Ep2dBrain<ReconState> {
  state: ReconState | 'dead' = 'launch';
  readonly box: RecoboxAi;
  private ry = 0; // lift above the ground (enemy+0x450)
  private vx: number;
  private vy: number;
  private vz: number;
  private hover: number; // +0x468
  private aimY: number; // +0x46c
  private orbitR: number; // +0x470
  private chase: number; // fparam1
  private bombRadius: number;
  private bombPower: number;
  private bombSpeed: number;
  private bombLife: number;
  private windup: number;
  private sawPower: number;
  private reach: number;
  private aimArc: number;
  private sub = 0;
  private counter = 0;
  private idle: number; // +0x3b8 reused as the look-around counter
  private orbitAngle = 0; // +0x3d8
  private orbitStep = 0; // +0x3dc
  private bob = 0; // +0x3e0
  private turned = 0; // cti.field14_0x14
  private turned2 = 0; // cti.field15_0x18
  private claim = false; // +0x47c
  private resumeInto: ReconState = 'look';
  private sawOn = false; // +0x3d0
  private readonly struck = new Set<number>();
  private readonly fade = new FadeEffect(); // +0x488
  private muzzleX = 0;
  private muzzleZ = 0;
  private kindCeiling: boolean;
  private kindWall: boolean;
  private gone = false;

  constructor(opts: {
    box: RecoboxAi;
    x: number;
    z: number;
    angle: number;
    vx: number;
    vy: number;
    vz: number;
    hoverBias: number;
    radiusBias: number;
    kind: number;
    movement: EnemyMovementData | null;
    attack: EnemyAttackData | null;
    ultimate: boolean;
    phase: number;
    rng?: () => number;
  }) {
    super({ ...opts, interval: 10 });
    this.box = opts.box;
    this.vx = opts.vx;
    this.vy = opts.vy;
    this.vz = opts.vz;
    const r = () => this.rng() * 2 - 1;
    // ASSUMED: never below the exe's minimum height above the ground (5), or
    // the launch's exact landing could never happen.
    this.hover = Math.max(f32(f32(RECOBOX.hoverSpread * r()) + RECOBOX.hoverBase) + opts.hoverBias, RECON.hoverMin);
    this.aimY = f32(f32(RECOBOX.aimSpread * r()) + RECOBOX.aimBase);
    this.orbitR = f32(f32(RECOBOX.radiusSpread * r()) + RECOBOX.radiusBase) + opts.radiusBias;
    const mv = opts.movement;
    this.chase = mv?.fparam1 ?? 1.15;
    this.bombRadius = mv?.fparam2 ?? 18;
    this.bombPower = mv?.fparam3 ?? 0;
    this.bombSpeed = mv?.fparam4 ?? 3;
    this.bombLife = (mv?.iparam[0] ?? 8) * 30;
    this.windup = mv?.iparam[1] ?? 12;
    this.sawPower = opts.attack?.minAtp ?? 0;
    this.reach = opts.attack?.distanceX ?? 25;
    this.aimArc = ((opts.attack?.angle ?? 768) & 0xffff) * BAMS_TO_RAD;
    this.idle = opts.phase % 10;
    this.kindCeiling = opts.kind === 1;
    this.kindWall = opts.kind === 2;
    // ASSUMED start heights (the box's own y is not known here): a floor box
    // starts on the ground, a ceiling box above the hover height, a wall box
    // at it.
    this.ry = this.kindCeiling ? this.hover + 40 : this.kindWall ? this.hover : 0;
    this.current = RECON_ANIM.start;
    this.enter(null, 'launch');
  }

  get flinchMotion(): EnemyAiMotion {
    return RECON_ANIM.damage;
  }

  get deathMotion(): EnemyAiMotion {
    return RECON_ANIM.dead;
  }

  // The player this Recon is attacking (enemy+0x47c set, +0x394), for the
  // box's room limit.
  get claimedTarget(): number | null {
    return this.claim ? this.targetId : null;
  }

  get removed(): boolean {
    return this.gone;
  }

  get lift(): number {
    return Math.max(this.ry, RECON.hoverMin);
  }

  // The box died: update_recon puts the Recon in state 7.
  boxDied(): void {
    if (this.state !== 'dead' && this.state !== 'gone') this.kill();
  }

  private enter(out: AiFrame | null, s: ReconState): void {
    // Leaving the attack states drops the claim (event 5).
    const from = this.state;
    if (from === 'shoot' || from === 'slash') this.claim = false;
    this.state = s;
    this.sub = 0;
    this.counter = 0;
    switch (s) {
      case 'launch':
        // anim 1, heading along the launch vector, no target.
        this.setAnim(out, RECON_ANIM.wait);
        this.h = bamsOf(this.vx, this.vz);
        this.targetId = null;
        break;
      case 'look':
        this.setAnim(out, RECON_ANIM.wait);
        break;
      case 'orbit':
        // Coming from itself the orbit goes on at once (sub 2); otherwise a
        // new circle starting opposite the heading.
        this.setAnim(out, RECON_ANIM.wait);
        if (from === 'orbit') this.sub = 2;
        else {
          this.orbitAngle = (this.h + RECON.halfTurn) & 0xffff;
          this.orbitStep = 0;
          this.bob = 0;
        }
        break;
      case 'shoot':
        this.setAnim(out, RECON_ANIM.wait);
        this.claim = true;
        break;
      case 'slash':
        this.setAnim(out, RECON_ANIM.wait);
        this.claim = true;
        this.sawOn = false;
        this.struck.clear();
        break;
      case 'leave':
        this.setAnim(out, RECON_ANIM.wait);
        this.fade.full();
        break;
      case 'flinch':
        this.setAnim(out, RECON_ANIM.damage);
        break;
      case 'gone':
        this.gone = true;
        this.box.release(this);
        break;
      default:
        exhaustive(s);
    }
  }

  // The nearest player within `radius` (vtable +0x1a8 at 200).
  private findNear(radius: number): boolean {
    const t = this.nearestWithin(this.targets, radius);
    this.targetId = t ? t.clientId : null;
    return t !== null;
  }

  // CheckEnemyTargetVisibility_00521238: the target is kept while it lives
  // (the map ray is not reproduced).
  private visible(): boolean {
    return this.resolve(this.targets) !== null;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    if (this.state === 'dead' || this.state === 'gone') return this.frame();
    const out = this.begin(targets, animationEnded);
    if (this.box.dying) {
      this.kill();
      return out;
    }
    if (!this.skipCheck) this.transitions(out);
    this.skipCheck = false;
    this.update(out);
    out.lift = this.lift;
    return this.finishFrame(out);
  }

  // Event 3.
  private transitions(out: AiFrame): void {
    const s = this.state;
    if (s === 'dead' || s === 'gone') return;
    switch (s) {
      case 'launch':
        if (this.sub === 2) this.enter(out, 'look');
        break;
      case 'look':
        if (this.idle > RECON.idle) this.enter(out, 'leave');
        break;
      case 'orbit':
        this.orbitCheck(out);
        break;
      case 'shoot':
        if (RECON.far < this.tdist) this.enter(out, 'look');
        else if (this.sub === 0) {
          if (this.targetId === null) this.enter(out, 'look');
        } else if (this.sub === 2) this.enter(out, 'orbit');
        break;
      case 'slash':
        if (RECON.far < this.tdist) this.enter(out, 'look');
        else if (this.sub <= 1) {
          if (this.targetId === null) this.enter(out, 'look');
        } else if (this.sub === 3) this.enter(out, 'orbit');
        break;
      case 'leave':
        if (this.fade.down()) {
          this.enter(out, 'gone');
        }
        break;
      case 'flinch':
        break;
      default:
        exhaustive(s);
    }
  }

  // Event 3 of state 4 (0x0058b21c).
  private orbitCheck(out: AiFrame): void {
    if (this.targetId === null) {
      this.enter(out, 'leave');
      return;
    }
    const half = this.turned > -0x8001 && this.turned < 0x8001;
    if (half) {
      if (!(this.turned2 > RECON.shootArc || this.turned2 < -RECON.shootArc)) return;
    }
    // Either arc is done: attack (3 after 0x5000 while under half a turn, 2
    // after more than half a turn) if the target has room, else another
    // player with room, else orbit anew.
    const attack: ReconState = half ? 'shoot' : 'slash';
    if (this.box.hasRoomFor(this.targetId)) {
      if (half) this.turned2 = 0;
      else this.turned = 0;
      this.enter(out, attack);
      return;
    }
    const other = this.otherWithRoom();
    if (other !== null) {
      if (half) this.turned2 = 0;
      else this.turned = 0;
      this.targetId = other;
      this.enter(out, attack);
      return;
    }
    this.enter(out, 'orbit');
  }

  // The nearest other player with room for one more attacker.
  private otherWithRoom(): number | null {
    const ts = this.targets;
    let best: number | null = null;
    let bestD = Infinity;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (t.dead || t.clientId === this.targetId) continue;
      if (!this.box.hasRoomFor(t.clientId)) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = t.clientId;
      }
    }
    return best;
  }

  // Event 0.
  private update(out: AiFrame): void {
    const s = this.state;
    if (s === 'dead' || s === 'gone') return;
    switch (s) {
      case 'launch':
        this.animate();
        this.launchFrame();
        break;
      case 'look':
        this.animate();
        this.lookFrame(out);
        break;
      case 'orbit':
        this.animate();
        this.orbitFrame(out);
        break;
      case 'shoot':
        this.animate();
        this.shootFrame(out);
        break;
      case 'slash':
        this.animate();
        this.slashFrame(out);
        break;
      case 'leave':
        this.animate();
        break;
      case 'flinch':
        break;
      default:
        exhaustive(s);
    }
  }

  private move(dx: number, dz: number, step: number): void {
    const mx = dx * step;
    const mz = dz * step;
    if (Math.abs(mx) < 0.01 && Math.abs(mz) < 0.01) return;
    this.x += mx;
    this.z += mz;
  }

  // 0x0058bed4 event 0.
  private launchFrame(): void {
    const len2 = this.vx * this.vx + this.vz * this.vz;
    this.move(this.vx, this.vz, len2);
    if (this.sub === 0) {
      const next = f32(this.ry + this.vy);
      if (Math.abs(this.hover - next) < 1e-3) {
        // The easing lands exactly; float rounding safeguard.
        this.ry = this.hover;
        this.sub = 1;
        return;
      }
      this.ry = next;
      this.vx = f32(this.vx * 0.95);
      this.vz = f32(this.vz * 0.95);
      let nv: number;
      if (next <= this.hover) {
        nv = this.vy >= 0.3 ? Math.max(f32(0.9 * this.vy), 0.3) : Math.min(f32(0.1 + this.vy), 0.3);
        this.vy = next + nv <= this.hover ? nv : f32(this.hover - next);
      } else {
        nv = this.vy <= -0.3 ? Math.min(f32(0.9 * this.vy), -0.3) : Math.max(f32(this.vy - 0.1), -0.3);
        this.vy = this.hover <= next + nv ? nv : f32(this.hover - next);
      }
    } else if (this.sub === 1) {
      if (0.01 < this.vx * this.vx + this.vz * this.vz) {
        this.vx = f32(this.vx * 0.95);
        this.vz = f32(this.vz * 0.95);
      } else this.sub = 2;
    }
    if (this.ry < RECON.hoverMin) this.ry = RECON.hoverMin;
  }

  // 0x0058bde0 event 0.
  private lookFrame(out: AiFrame): void {
    if (this.visible() || this.findNear(RECON.search)) this.enter(out, 'orbit');
    else this.idle++;
    // UpdateTarget_0058bebc and the spin run in either case.
    this.h = (this.h + RECON.spin) & 0xffff;
  }

  // The orbit point of unknown_set_recon_target_xyz at angle `a` around the
  // target; sets the direction and distance to it.
  private orbitPoint(t: AiTarget, a: number): void {
    this.tx = t.x + this.sinH(a) * this.orbitR;
    this.tz = t.z + this.cosH(a) * this.orbitR;
    this.initVelocity();
  }

  // 0x0058b21c event 0.
  private orbitFrame(out: AiFrame): void {
    let t = this.resolve(this.targets);
    if (!t) {
      this.findNear(RECON.search);
      t = this.resolve(this.targets);
    }
    if (!t) return;
    let bob = 0;
    if (this.sub === 0) {
      this.orbitPoint(t, this.orbitAngle);
      const near = f32(this.orbitR * 0.2);
      if (this.tdist < near * near) {
        // 0.5 (0x00928974): one way round, else the other.
        const sign = f32(this.rng()) <= 0.5 ? 1 : -1;
        this.orbitStep = Math.round((sign * 0x10000 * RECON.orbitSpeed) / (this.orbitR * Math.PI * 2));
        this.sub = 1;
      }
    } else if (this.sub === 1) {
      const half = Math.trunc(this.orbitStep / 2);
      this.orbitAngle += half;
      this.turned += half;
      this.turned2 += half;
      this.orbitPoint(t, this.orbitAngle);
      if (this.tdist < RECON.orbitSpeed) this.sub = 2;
    } else if (this.sub === 2) {
      this.orbitAngle += this.orbitStep;
      this.turned += this.orbitStep;
      this.turned2 += this.orbitStep;
      this.orbitPoint(t, this.orbitAngle);
      bob = f32(Math.sin(this.bob * BAMS_TO_RAD) * RECON.bob);
      this.bob += RECON.bobStep;
    }
    this.move(this.tdx, this.tdz, RECON.orbitSpeed);
    this.ry = this.easeY(this.ry, this.hover + bob);
    this.h = bamsOf(t.x - this.x, t.z - this.z);
    void out;
  }

  // DerolleObjectClampFloatDelta_0058a0c0.
  private easeY(cur: number, target: number): number {
    const d = target - cur;
    if (Math.abs(d) >= 0.2) {
      const step = f32(d * 0.1);
      return cur + Math.max(-1.5, Math.min(1.5, step));
    }
    return target;
  }

  // 0x0058b81c event 0.
  private shootFrame(out: AiFrame): void {
    if (!this.visible()) this.targetId = null;
    const t = this.resolve(this.targets);
    if (this.sub === 0) {
      if (t) {
        this.aimTarget(this.targets);
        const want = bamsOf(this.tdx, this.tdz);
        const d = diff16(this.h & 0xffff, want);
        this.h += Math.max(-RECON.aimTurn, Math.min(RECON.aimTurn, d));
      }
      if (++this.counter > RECON.shootWait) {
        this.sub = 1;
        this.setAnim(out, RECON_ANIM.shoot);
      }
    } else if (this.sub === 1) {
      if (this.crossed(RECON.shootFrame)) {
        this.muzzle();
        out.shots = [
          new ReconBomb(this.muzzleX, this.lift, this.muzzleZ, this.h, this.bombSpeed, this.bombRadius, this.bombPower, this.bombLife, () => this.state === 'flinch' || this.state === 'dead'),
        ];
      } else if (this.ended) {
        this.sub = 2;
      }
    }
  }

  private muzzle(): void {
    this.muzzleX = this.x + this.sinH() * RECON.muzzle;
    this.muzzleZ = this.z + this.cosH() * RECON.muzzle;
  }

  // 0x0058ba48 event 0.
  private slashFrame(out: AiFrame): void {
    if (!this.visible()) this.targetId = null;
    const t = this.resolve(this.targets);
    if (this.sub === 0) {
      if (t) {
        // unknown_recon_saw_related: the target point at its height + aimY.
        this.aimTarget(this.targets);
        const want = bamsOf(this.tdx, this.tdz);
        const d = diff16(this.h & 0xffff, want);
        this.h += Math.max(-RECON.chaseTurn, Math.min(RECON.chaseTurn, d));
        this.move(this.sinH(), this.cosH(), this.chase);
      } else this.initVelocity();
      // Targets are on the ground (the lift of a player is 0): aim at aimY.
      this.ry = this.easeY(this.ry, this.aimY);
      if (this.ry < RECON.hoverMin) this.ry = RECON.hoverMin;
      if (t && this.grounded()) {
        this.sub = 1;
      }
    } else if (this.sub === 1) {
      if (++this.counter >= this.windup) {
        this.counter = 0;
        this.sub = 2;
        this.setAnim(out, RECON_ANIM.slash);
        this.sawOn = false;
      }
    } else if (this.sub === 2) {
      if (this.crossed(RECON.slashStart)) this.sawOn = true;
      else if (this.crossed(RECON.slashEnd)) this.sawOn = false;
      if (this.sawOn) {
        this.muzzle();
        let victims: AiTarget[] | null = null;
        for (let i = 0; i < this.targets.length; i++) {
          const p = this.targets[i];
          if (p.dead || this.struck.has(p.clientId)) continue;
          if ((p.x - this.muzzleX) ** 2 + (p.z - this.muzzleZ) ** 2 > RECON.slashRadius ** 2) continue;
          this.struck.add(p.clientId);
          (victims ??= []).push(p);
        }
        if (victims) out.shots = [new ReconSlash(this.muzzleX, this.muzzleZ, victims, this.sawPower)];
      }
      if (this.ended) this.sub = 3;
    }
  }

  // DerolleObjectIsGrounded_0058a164: close enough (reach + 5), at the aim
  // height and facing the target within the attack's angle.
  private grounded(): boolean {
    if (!(this.tdist < RECON.reach + this.reach)) return false;
    if (!(Math.abs(this.ry - this.aimY) < 1)) return false;
    return this.sinH() * this.tdx + this.cosH() * this.tdz >= Math.cos(this.aimArc);
  }

  // OnHit 0x00589ab0: every damaging hit starts the flinch (state 6).
  flinches(): boolean {
    if (this.state === 'dead' || this.state === 'gone' || this.state === 'flinch') return false;
    this.resumeInto = this.state;
    this.state = 'flinch';
    this.claim = false;
    this.setAnim(null, RECON_ANIM.damage);
    return true;
  }

  // The flinch ended (event 3 of 0x0058ae7c): back to the state it came from
  // (a slash checks the room limit again).
  resume(): string {
    if (this.state !== 'flinch') return this.state;
    const prev = this.resumeInto;
    if (prev === 'slash') {
      if (this.targetId !== null && this.box.hasRoomFor(this.targetId)) this.enter(null, 'slash');
      else {
        const other = this.otherWithRoom();
        if (other !== null) {
          this.targetId = other;
          this.enter(null, 'slash');
        } else this.enter(null, 'orbit');
      }
    } else this.enter(null, prev === 'launch' ? 'look' : prev);
    this.dropPending();
    return this.state;
  }

  override kill(): void {
    this.box.release(this);
    super.kill();
  }
}

// --- Epsilon and Epsigard -------------------------------------------------------
//
// Epsilon: ctor epsilon_constructor 0x005585ac (class TObjEneEpsilonBody, the
// Tower / Seaside Night area 0x22 / 0x23, vtable 0x00b04cc0, dispatcher
// 0x0055a95c over the jump table 0x009252ac, update 0x0055a2d0), BattleParam
// row 35 (bm_ene_epsilon.bml: model 0 re6_b_bcbody is its closed look with
// motion 0 body_wait (0.3), model 1 re6_b_bal_body the open one with motion 1
// bal_wait (0.6); table 0x009bdeb8). It is a Bulclaw-like body that sends four
// Epsigards out at the players and is only vulnerable while they are out.
// Set entry (newserv Map.cc, EpsigardCalculateAttackParams_0055a1d4):
// param1 = move speed (+0.5, at least 0; +0x460), param2 = turn step in BAMS a
// frame (+512; +0x464), param3 = first attack timer ((+20, at least 5) * 30
// frames; +0x458), param4 = second timer (same; +0x45c). MovementData row 35:
// fparam2 = laser orb speed (1.5), fparam3 = laser power (780; 3200), iparam1
// = laser charge frames (180; 90), iparam2 = laser strike frames (45; 30),
// iparam3 = frames before an Epsigard pattern starts (30; 15), iparam4 = the
// delay after a hit (30; 15). Its element (enemy+0x446, 0 to 3) is random at
// creation and advances in state 6: techniques of its element's group (foie
// group 1, barta 2, zonde 3, megid 5) and weapon specials of its element (fire,
// ice, thunder, instant death: 0x0055ab30 / 0x0055aa5c) do nothing to it.
// Flags (enemy+0x440): 1 hidden, 2 closed (model 0), 4 second timer elapsed,
// 8 first timer elapsed, 0x10 hit delay, 0x20 an Epsigard touches something,
// 0x40 shielded, 0x80 no target within 400, 0x100 laser shown, 0x400 pattern
// armed, 0x800 dying. Hits (vtable +0x5c / +0x60 / +0x100) are ignored while
// bit 2 or 0x40 is set.
//   0 (0x0055ad34): hidden at its spawn point, shielded; a player within 400
//     (FindEnemyTarget every frame, interval 30) -> 1.
//   1 (0x0055a148): fades in (the effect at +0x4c8, 40 frames) -> 2.
//   2 (0x0055988c): stalks: turns toward the target by param2 and, within
//     22.5 degrees (0x1000), walks at param1; fires its laser orb (see below).
//     No target -> 7; the first timer (0x448, reset to 0x458 on leaving)
//     elapsed -> 3.
//     Laser (+0x4f0 stage): 0 pick a player within 400 (up to 4 sorted by
//     distance, padded cyclically, taken in the order 2 0 1 3 of a counter),
//     the orb starts at the Epsilon; 1 the orb creeps toward the player at
//     fparam2 for iparam1 frames; 2 iparam2 frames later it blasts (Rafoie,
//     radius 40, 0x00a73bbc = 1600 squared): every player inside takes
//     entity_hit_by_tech(group 1, power fparam3); 3 rests 30 frames.
//   3 (0x00559610): sends the Epsigards out: waits up to 15 frames for all
//     four to be at home, then places them at their slots (set at creation:
//     the spawn point and yaw), picks the orbit direction (rand < 0.5), opens
//     (flag 2 off), 60 frames for them to be out, then releases them -> 4.
//   4 (0x00559334): open and vulnerable. After iparam3 frames of all-idle
//     Epsigards a random row of the 20-row table at 0x00925160 (five empty
//     rows, then every subset) sets those Epsigards attacking; when the second
//     timer has run out (or nobody is near) and all four are idle -> 5.
//   5 (0x00558fb8): recalls the Epsigards, shields, closes -> 6.
//   6 (0x00558c84): recolours (90 frames) and moves to the next element -> 2.
//   7 (0x00558b34): nobody within 400: shielded, fades out (flag 0x40, the
//     effect's 10 steps), back to its spawn point hidden -> 0. The exe's
//     branch for a player coming back in time (sub 2) has no exit; here it
//     returns to state 2 (ASSUMED).
//   8 (0x00558a10): hit flash (16 frames) -> 4. Entered by a hit while open.
//   9 (0x005588dc): death: 20 frames, then it bursts.
// ASSUMED: map rays (line of sight, walls), the Epsigards' collision flag
// (flag 0x80: nothing touches them), the tint is a material colour (white to the
// element colour by colourT; the exe's use of it is not read), the element
// immunities (`immuneToTech`, `immuneToSpecial`) are applied by the owner
// (render/combat.ts techHitEnemy, specialHit) while Epsilon is not invulnerable.
// The exe's special immunity has two bypasses not read here (ASSUMED never
// set on Epsilon): this+0x30 bit 0x4000000 and the second argument's +0x18
// bit 0x2000000 skip the element check (0x0055ab30).
export const EPSILON = {
  search: 400,
  retarget: 30,
  fadeIn: 30,
  speedBias: f32(0.5),
  turnBias: 512,
  timerBias: 20,
  timerMin: 5,
  timerUnit: 30,
  facing: 0x1000,
  laserRange: 400,
  laserCool: 30,
  blastRadius: 40,
  order: [2, 0, 1, 3] as const,
  gatherWait: 15,
  outWait: 60,
  recallWait: 60,
  closeWait: 8,
  recolor: 30,
  hitFlashStep: 34,
  hitFlashMax: 255,
  deathFrames: 20,
  sleepFrames: 0x3c,
  patternRows: 20,
} as const;

// Which Epsigards each of the 20 patterns sets attacking (0x00925160).
export const EPSILON_PATTERNS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
  [1, 1, 0, 0],
  [1, 0, 1, 0],
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, 1, 0, 1],
  [0, 0, 1, 1],
  [1, 1, 1, 0],
  [1, 1, 0, 1],
  [1, 0, 1, 1],
  [0, 1, 1, 1],
  [1, 1, 1, 1],
];

// The technique group each element blocks, by colour 0..3 (0x0055aaf0 builds
// the array on the stack from immediates: 1, 2, 3, 5): foie, gibarta / rabarta, zonde,
// megid. Barta is group 0x13 (techfire.ts HIT_GROUP), so it is not blocked.
export const EPSILON_ELEMENT_GROUPS = [1, 2, 3, 5] as const;
// The weapon special each element blocks, by colour 0..3 (0x0055ac24 builds
// the word array on the stack from immediates: 9, 7, 10, 11): fire (9), freeze (7), thunder (10),
// instant kill (11); the numbers are special_attack_type (combat/specials.ts).
export const EPSILON_ELEMENT_SPECIALS = [9, 7, 10, 11] as const;

export const EPSILON_ANIM = {
  closed: loop(0, 0.3),
  open: loop(1, 0.6),
} as const;

// The element colours (0x00925320), RGB 0..1: red, blue, yellow, magenta (the
// 255 in front of each row is the intensity).
export const EPSILON_COLOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, 0, 1],
];

// The tint of the body (render/combat.ts): lerp(white, element colour, colourT),
// the element colour lerped from `from` to `to` by `mix` during the recolour.
export function epsilonTint(from: number, to: number, mix: number, colourT: number): [number, number, number] {
  const a = EPSILON_COLOURS[from & 3];
  const b = EPSILON_COLOURS[to & 3];
  const out: [number, number, number] = [1, 1, 1];
  for (let k = 0; k < 3; k++) {
    const c = a[k] + (b[k] - a[k]) * mix;
    out[k] = 1 + (c - 1) * colourT;
  }
  return out;
}

export type EpsilonState = 'dormant' | 'appear' | 'stalk' | 'order' | 'open' | 'recall' | 'recolor' | 'lost' | 'hit' | 'dying';

// The Rafoie blast of the laser orb: one frame, every player in its radius.
export class EpsilonBlast extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff6030, size: 6 };
  private readonly radius: number;

  constructor(x: number, z: number, radius: number, power: number) {
    super(x, PLAYER_AIM_HEIGHT, z);
    this.radius = radius;
    this.effect = { kind: 'tech', power };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.done = true;
    return this.within(targets, this.radius - PLAYER_RADIUS);
  }
}

// Sound effects the Epsilon plays (render/combat.ts plays them at its position).
export type EpsilonEvent = { kind: 'se'; id: number };

export class EpsilonAi extends Ep2dBrain<EpsilonState> {
  state: EpsilonState | 'dead' = 'dormant';
  readonly children: EpsigardAi[] = [];
  readonly events: EpsilonEvent[] = [];
  private speed: number; // +0x460
  private turn: number; // +0x464
  private firstPeriod: number; // +0x458
  private secondPeriod: number; // +0x45c
  private first: number; // +0x448
  private second: number; // +0x44c
  private laserSpeed: number;
  private laserPower: number;
  private chargeFrames: number;
  private strikeFrames: number;
  private patternDelay: number;
  private hitDelay: number;
  // Flags (enemy+0x440).
  private hidden = true; // 1
  private closed = true; // 2
  private secondUp = false; // 4
  private firstUp = false; // 8
  private delayed = false; // 0x10
  private shielded = true; // 0x40
  private noTarget = true; // 0x80
  private laserShown = false; // 0x100
  private armed = false; // 0x400
  private dying = false; // 0x800
  // State-local fields.
  private sub = 0;
  private timer = 0;
  private patternTimer = 0; // +0x450
  private flash = 0; // +0x454
  private colour = 0; // +0x446
  // The tint (epsilonTint): colourT 0..1 (+0x500), the element before the last
  // change, and the lerp from it to `colour` (0..1).
  colourT = 0;
  colourFrom = 0;
  colourMix = 1;
  // The laser (enemy+0x4f0..0x518).
  private stage = 0;
  private stageTimer = 0;
  private laserTarget: number | null = null;
  private counter = 0;
  private orbX = 0;
  private orbZ = 0;
  private aimX = 0;
  private aimZ = 0;
  private readonly fade = new FadeEffect(); // +0x4c8
  private readonly slotX: number[] = [];
  private readonly slotZ: number[] = [];
  private readonly slotH: number[] = [];

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    params: readonly number[]; // set entry param1..4
    movement: EnemyMovementData | null; // row 35
    epsigard: EnemyMovementData | null; // row 36
    ultimate?: boolean;
    phase?: number;
    rng?: () => number;
  }) {
    super({ ...opts, interval: EPSILON.retarget });
    const p = (i: number) => opts.params[i] ?? 0;
    this.speed = Math.max(f32(EPSILON.speedBias + p(0)), 0);
    this.turn = Math.round(EPSILON.turnBias + p(1));
    const period = (v: number) => Math.max(Math.round(v + EPSILON.timerBias), EPSILON.timerMin) * EPSILON.timerUnit;
    this.firstPeriod = period(p(2));
    this.secondPeriod = period(p(3));
    this.first = this.firstPeriod;
    this.second = this.secondPeriod;
    const mv = opts.movement;
    this.laserSpeed = mv?.fparam2 ?? 1.5;
    this.laserPower = mv?.fparam3 ?? 0;
    this.chargeFrames = mv?.iparam[0] ?? 180;
    this.strikeFrames = mv?.iparam[1] ?? 45;
    this.patternDelay = mv?.iparam[2] ?? 30;
    this.hitDelay = mv?.iparam[3] ?? 30;
    // The element: get_random_float * weight & 3 (the weight 0x00925404 is
    // not read: ASSUMED uniform).
    this.colour = Math.floor(f32(this.rng()) * 4) & 3;
    this.colourFrom = this.colour;
    for (let i = 0; i < 4; i++) {
      this.slotX.push(opts.x);
      this.slotZ.push(opts.z);
      this.slotH.push(this.h);
      this.children.push(new EpsigardAi({ parent: this, index: i, x: opts.x, z: opts.z, angle: opts.angle, movement: opts.epsigard, phase: i, rng: this.rng }));
    }
    this.current = EPSILON_ANIM.closed;
  }

  // Closed and shielded (hits do nothing): flags 2 or 0x40.
  get invulnerable(): boolean {
    return this.closed || this.shielded;
  }

  get open(): boolean {
    return !this.closed;
  }

  get element(): number {
    return this.colour;
  }

  get deathMotion(): EnemyAiMotion {
    return once(0, 1);
  }

  get isDying(): boolean {
    return this.dying;
  }

  // The element's technique group blocks a technique of that group
  // (EpsigardProcessTechHit_0055aa5c).
  immuneToTech(group: number): boolean {
    return this.invulnerable ? group !== 20 : group === EPSILON_ELEMENT_GROUPS[this.colour & 3];
  }

  // The weapon special of its element does nothing (EpsigardProcessSpecialAttack
  // 0x0055ab30: special_attack_type equal to the element's entry; the shown
  // "0" is the owner's, as for techniques).
  immuneToSpecial(type: number): boolean {
    return type === EPSILON_ELEMENT_SPECIALS[this.colour & 3];
  }

  // DerolleIsTargetValid_0055c0b8 on a child that still exists.
  private ready(c: EpsigardAi): boolean {
    return c.removed || c.orbiting;
  }

  private enter(out: AiFrame | null, s: EpsilonState): void {
    this.state = s;
    this.sub = 0;
    switch (s) {
      case 'dormant':
        // flags & ~0x200 | 0x43; back at the spawn point; timers reloaded.
        this.hidden = true;
        this.closed = true;
        this.shielded = true;
        this.setAnim(out, EPSILON_ANIM.closed);
        if (this.x !== this.spawnX || this.z !== this.spawnZ) this.warps++;
        this.x = this.spawnX;
        this.z = this.spawnZ;
        this.first = this.firstPeriod;
        this.second = this.secondPeriod;
        break;
      case 'appear':
        this.hidden = false;
        this.closed = true;
        this.shielded = true;
        this.setAnim(out, EPSILON_ANIM.closed);
        this.fade.start(EPSILON.fadeIn);
        break;
      case 'stalk':
        // flags & 0xfffffcf6 | 0x42: hit delay, first timer and laser flags off.
        this.hidden = false;
        this.closed = true;
        this.shielded = true;
        this.delayed = false;
        this.firstUp = false;
        this.laserShown = false;
        this.setAnim(out, EPSILON_ANIM.closed);
        this.stage = 0;
        this.stageTimer = 0;
        this.counter = 0;
        this.laserTarget = null;
        break;
      case 'order':
        this.hidden = false;
        this.closed = true;
        this.shielded = true;
        this.setAnim(out, EPSILON_ANIM.closed);
        this.timer = EPSILON.gatherWait;
        break;
      case 'open':
        // flags & 0xfffffdb8 | 0x400: open and vulnerable.
        this.closed = false;
        this.shielded = false;
        this.secondUp = false;
        this.hidden = false;
        this.armed = true;
        this.setAnim(out, EPSILON_ANIM.open);
        break;
      case 'recall':
        this.closed = false;
        this.shielded = false;
        this.hidden = false;
        this.delayed = false;
        this.setAnim(out, EPSILON_ANIM.open);
        this.timer = EPSILON.gatherWait;
        break;
      case 'recolor':
        this.hidden = false;
        this.closed = true;
        this.shielded = true;
        this.setAnim(out, EPSILON_ANIM.closed);
        this.colourT = 0;
        break;
      case 'lost':
        this.hidden = false;
        this.closed = true;
        this.shielded = true;
        this.setAnim(out, EPSILON_ANIM.closed);
        this.timer = EPSILON.sleepFrames;
        break;
      case 'hit':
        this.closed = false;
        this.shielded = false;
        this.delayed = true;
        this.hidden = false;
        this.flash = -EPSILON.hitFlashStep;
        this.setAnim(out, EPSILON_ANIM.open);
        break;
      case 'dying':
        this.closed = false;
        this.shielded = false;
        this.dying = true;
        this.timer = 0;
        break;
      default:
        exhaustive(s);
    }
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    if (this.state === 'dead') return this.frame();
    const out = this.begin(targets, animationEnded);
    // DerolleFindTarget_0055a370 runs before the state machine every frame.
    this.noTarget = !this.findTarget(targets, EPSILON.search);
    if (!this.skipCheck) this.transitions(out);
    this.skipCheck = false;
    this.update(out);
    out.hidden = this.hidden;
    return this.finishFrame(out);
  }

  // Event 3.
  private transitions(out: AiFrame): void {
    const s = this.state;
    if (s === 'dead') return;
    switch (s) {
      case 'dormant':
        if (!this.noTarget) this.enter(out, 'appear');
        break;
      case 'appear':
        if (this.fade.up()) this.enter(out, 'stalk');
        break;
      case 'stalk':
        if (this.noTarget) this.enter(out, 'lost');
        else if (this.sub === 1) {
          this.first = this.firstPeriod;
          this.enter(out, 'order');
        }
        break;
      case 'order':
        if (this.sub === 3) {
          for (const c of this.children) c.release();
          this.delayed = false;
          this.enter(out, 'open');
        } else if (this.sub === 2) this.enter(out, 'stalk');
        break;
      case 'open':
        if (this.sub === 2) this.enter(out, 'recall');
        break;
      case 'recall':
        if (this.sub === 5) this.enter(out, 'recolor');
        else if (this.sub === 4) this.enter(out, 'open');
        break;
      case 'recolor':
        if (this.sub === 3) this.enter(out, 'stalk');
        break;
      case 'lost':
        if (this.sub === 3) this.enter(out, 'dormant');
        break;
      case 'hit':
        if (this.sub === 2) this.enter(out, 'open');
        break;
      case 'dying':
        break;
      default:
        exhaustive(s);
    }
  }

  // Event 0.
  private update(out: AiFrame): void {
    const s = this.state;
    if (s === 'dead') return;
    switch (s) {
      case 'dormant':
      case 'appear':
        this.animate();
        break;
      case 'stalk':
        this.animate();
        this.stalkFrame(out);
        break;
      case 'order':
        this.animate();
        this.orderFrame();
        break;
      case 'open':
        this.animate();
        this.openFrame();
        break;
      case 'recall':
        this.animate();
        this.recallFrame();
        break;
      case 'recolor':
        this.animate();
        this.recolorFrame();
        break;
      case 'lost':
        this.animate();
        this.lostFrame();
        break;
      case 'hit':
        this.animate();
        this.hitFrame();
        break;
      case 'dying':
        this.animate();
        if (this.sub === 0 && ++this.timer >= EPSILON.deathFrames) {
          this.sub = 1;
          this.hidden = true;
        }
        break;
      default:
        exhaustive(s);
    }
  }

  // The player the laser aims at, chosen in the order of 0x0055988c: up to
  // four live players within 400 (the first four in entity order), nearest
  // first, taken cyclically in the order 2 0 1 3 of a counter.
  private pickLaserTarget(targets: readonly AiTarget[]): AiTarget | null {
    const list = this.pickList;
    const dist = this.pickDist;
    let n = 0;
    for (let i = 0; i < targets.length && n < 4; i++) {
      const t = targets[i];
      if (t.dead) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d >= EPSILON.laserRange * EPSILON.laserRange) continue;
      let k = n;
      while (k > 0 && dist[k - 1] > d) {
        list[k] = list[k - 1];
        dist[k] = dist[k - 1];
        k--;
      }
      list[k] = t;
      dist[k] = d;
      n++;
    }
    if (n === 0) return null;
    return list[EPSILON.order[Math.abs(this.counter) & 3] % n];
  }

  private readonly pickList: AiTarget[] = [];
  private readonly pickDist: number[] = [];

  // 0x0055988c event 0.
  private stalkFrame(out: AiFrame): void {
    const targets = this.targets;
    if (!this.firstUp && --this.first < 1) this.firstUp = true;
    if (!this.noTarget) {
      this.aimTarget(targets);
      const facing = this.tdx * this.sinH() + this.tdz * this.cosH();
      // UpdateEntityRotation_005214cc: toward the target by `turn`.
      const want = bamsOf(this.tdx, this.tdz);
      const d = diff16(this.h & 0xffff, want);
      this.h += Math.max(-this.turn, Math.min(this.turn, d));
      if (facing >= Math.cos(EPSILON.facing * BAMS_TO_RAD)) {
        this.x += this.sinH() * this.speed;
        this.z += this.cosH() * this.speed;
      }
      if (this.laserTarget !== null) {
        const p = this.live(targets, this.laserTarget);
        if (!p) {
          this.stage = 0;
          this.laserTarget = null;
        } else {
          this.aimX = p.x;
          this.aimZ = p.z;
        }
      } else this.stage = 0;
    } else this.stage = 0;
    switch (this.stage) {
      case 0:
        this.laserShown = false;
        if (!this.firstUp) {
          this.counter++;
          const t = this.pickLaserTarget(targets);
          this.laserTarget = t ? t.clientId : null;
          if (t) {
            this.orbX = this.x;
            this.orbZ = this.z;
            this.aimX = t.x;
            this.aimZ = t.z;
            // 0x00559c1a: the laser starts (sound 0x2d2, at the Epsilon).
            this.events.push({ kind: 'se', id: 0x2d2 });
            this.stage = 1;
            this.stageTimer = this.chargeFrames;
          }
        } else this.sub = 1;
        break;
      case 1: {
        // 0x00559cf4: the orb is created (sound 0x2d3) on the frame it is first shown.
        if (!this.laserShown) this.events.push({ kind: 'se', id: 0x2d3 });
        this.laserShown = true;
        const dx = this.aimX - this.orbX;
        const dz = this.aimZ - this.orbZ;
        const len = Math.hypot(dx, dz);
        if (len > 0) {
          this.orbX += (dx / len) * this.laserSpeed;
          this.orbZ += (dz / len) * this.laserSpeed;
        }
        if (--this.stageTimer < 1) {
          this.stage = 2;
          this.stageTimer = this.strikeFrames;
        }
        break;
      }
      case 2:
        this.laserShown = true;
        if (--this.stageTimer < 1) {
          out.shots = [new EpsilonBlast(this.orbX, this.orbZ, EPSILON.blastRadius, this.laserPower)];
          this.stageTimer = EPSILON.laserCool;
          this.stage = 3;
        }
        break;
      case 3:
        this.laserShown = false;
        if (--this.stageTimer < 1) {
          this.stage = 0;
          this.laserTarget = null;
        }
        break;
      default:
        this.stage = 0;
        this.laserTarget = null;
        this.laserShown = false;
        break;
    }
  }

  // The recolour ring's scale while the recolour state runs (the exe draws model
  // 4 while flag 0x200 is set: event 4 of state 6 sets it, 0x0055ad34 clears it;
  // colourT is 0 outside the recolour, so the ring is then a zero scale).
  get recolourRing(): number | null {
    return this.state === 'recolor' ? this.colourT : null;
  }

  // The laser orb (for drawing): where it is while shown.
  get orb(): { x: number; z: number } | null {
    return this.laserShown ? { x: this.orbX, z: this.orbZ } : null;
  }

  // 0x00559610 event 0.
  private orderFrame(): void {
    if (this.sub === 0) {
      this.timer--;
      let blocked = false;
      for (const c of this.children) {
        if (!c.removed && !c.waiting) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        if (this.timer < 1) this.sub = 2;
        return;
      }
      const reverse = f32(this.rng()) < 0.5;
      for (let i = 0; i < 4; i++) {
        const c = this.children[i];
        if (!c.removed) c.place(this.slotX[i], this.slotZ[i], this.slotH[i], reverse);
      }
      this.closed = false;
      this.sub = 1;
      this.timer = EPSILON.outWait;
    } else if (this.sub === 1) {
      this.timer--;
      let allOut = true;
      for (const c of this.children) if (!c.removed && !c.out) allOut = false;
      if (!allOut && this.timer > 0) return;
      this.sub = 3;
    }
  }

  // 0x00559334 event 0.
  private openFrame(): void {
    if (--this.second < 1) this.secondUp = true;
    if (this.sub === 0) {
      let idle = true;
      for (const c of this.children) if (!c.removed && !this.ready(c)) idle = false;
      if (!this.secondUp && !this.noTarget) this.patterns(idle);
      else if (!idle) this.patterns(idle);
      else {
        this.sub = 2;
        this.second = this.secondPeriod;
      }
    } else if (this.sub === 1) {
      if (--this.timer < 1) {
        this.sub = 0;
        this.delayed = false;
      }
    }
  }

  // The pattern arming of 0x00559334 (LAB_0055938d).
  private patterns(idle: boolean): void {
    if (!this.armed) {
      if (idle) {
        this.armed = true;
        this.patternTimer = this.patternDelay;
      }
    } else if (--this.patternTimer < 1) {
      const row = EPSILON_PATTERNS[Math.floor(f32(this.rng()) * EPSILON.patternRows) % EPSILON.patternRows];
      for (let i = 0; i < 4; i++) {
        const c = this.children[i];
        if (row[i] === 1 && !c.removed && c.orbiting) c.enableAttack();
      }
      this.armed = false;
    }
    if (this.delayed) {
      this.sub = 1;
      this.timer = this.hitDelay;
    }
  }

  // 0x00558fb8 event 0.
  private recallFrame(): void {
    switch (this.sub) {
      case 0: {
        this.timer--;
        for (const c of this.children) {
          if (!c.removed && !this.ready(c)) {
            if (this.timer < 1) this.sub = 4;
            return;
          }
        }
        for (const c of this.children) if (!c.removed) c.recall();
        this.sub = 1;
        this.shielded = true;
        this.timer = EPSILON.recallWait;
        break;
      }
      case 1: {
        // Waits for the Epsigards to leave (the first one no longer
        // orbiting) until the timer runs out.
        this.timer--;
        let allValid = true;
        for (const c of this.children) if (!c.removed && !this.ready(c)) allValid = false;
        if (!allValid && this.timer > 0) break;
        this.sub = 2;
        this.timer = EPSILON.closeWait;
        break;
      }
      case 2:
        if (--this.timer < 1) {
          this.closed = true;
          this.sub = 3;
          this.timer = EPSILON.closeWait;
        }
        break;
      case 3:
        if (--this.timer < 1) this.sub = 5;
        break;
      default:
        break;
    }
  }

  // 0x00558c84 event 0: 30 frames up, the element changes, 30 colour frames,
  // 30 frames down.
  private recolorFrame(): void {
    const step = f32(1 / 30);
    if (this.sub === 0) {
      const t = f32(this.colourT + step);
      if (t < 1) this.colourT = t;
      else {
        this.sub = 1;
        this.timer = EPSILON.recolor;
        this.colourT = 1;
        this.colourFrom = this.colour;
        this.colour = (this.colour + 1) & 3;
        this.colourMix = 0;
        this.events.push({ kind: 'se', id: 0x2d4 }); // 0x00558ef5
      }
    } else if (this.sub === 1) {
      // The colour lerps from the old element to the new one, delta / 30 a frame.
      this.colourMix = Math.min(1, f32(this.colourMix + step));
      this.events.push({ kind: 'se', id: 0x2d4 }); // 0x00558d7e, every frame of the 90
      if (--this.timer < 1) {
        this.sub = 2;
        this.colourT = 1;
      }
    } else if (this.sub === 2) {
      const t = f32(this.colourT - step);
      if (t > 0) {
        this.colourT = t;
        this.events.push({ kind: 'se', id: 0x2d4 }); // 0x00558ded
      } else {
        this.sub = 3;
        this.colourT = 0;
        this.events.push({ kind: 'se', id: 0x2d5 }); // 0x00558dcc, the end of the fall
      }
    }
  }

  // 0x00558b34 event 0.
  private lostFrame(): void {
    if (this.sub === 0) {
      if (!this.noTarget) this.sub = 2;
      else {
        this.shielded = true;
        this.sub = 1;
        this.fade.full();
      }
    } else if (this.sub === 1) {
      if (this.fade.down()) {
        this.sub = 3;
        this.hidden = true;
      }
    } else if (this.sub === 2) {
      // ASSUMED: the exe has no exit here; the Epsilon takes the player back.
      this.enter(null, 'stalk');
    }
  }

  // 0x00558a10 event 0: the alpha flash up and down.
  private hitFrame(): void {
    if (this.sub === 0) {
      const v = this.flash + EPSILON.hitFlashStep;
      if (v < EPSILON.hitFlashMax + 1) this.flash = v;
      else {
        this.flash = EPSILON.hitFlashMax;
        this.sub = 1;
      }
    } else if (this.sub === 1) {
      const v = this.flash - EPSILON.hitFlashStep;
      if (v >= 0 && v < 0x23) {
        this.flash = 0;
        this.sub = 2;
      } else this.flash = v < 0 ? 0 : v;
    } else this.sub = 2;
  }

  // The hit handler (vtable +0x100, 0x0055aa00): ignored while closed or
  // shielded and during the flash. Done internally (no flinch motion).
  flinches(): boolean {
    if (this.state === 'dead' || this.state === 'hit' || this.state === 'dying') return false;
    if (this.closed || this.shielded) return false;
    this.enter(null, 'hit');
    this.skipCheck = true;
    return false;
  }

  resume(): string {
    return this.state;
  }

  override kill(): void {
    this.dying = true;
    super.kill();
    for (const c of this.children) c.parentDied();
  }
}

// Epsigard: epsigard_constructor 0x0055c1c0 (class created by
// CreateEpsigardEntity_0055be9c, vtable 0x00b04f20, dispatcher 0x0055b798,
// update 0x0055b2a4 -> 0x0055b364 first), model 2 re6_b_claw_body of
// bm_ene_epsilon.bml with motion 2 claw_wait (1.0, loop; table 0x009bdf58),
// BattleParam row 36: fparam1 = orbit radius (50; 75), fparam2 = speed away
// from the Epsilon (2), fparam3 = orbit speed (1.5; 2.5), fparam4 = touch
// power (450; 1360), iparam1 = frames its shield holds (30; 60). Weapon
// hits and techniques do nothing to it (+0x5c 0x0055be2c, +0x60 0x0055be44:
// only group 20, always_zero_damage, goes through): it is invulnerable and
// only dies with the Epsilon. Flags (enemy+0x474): 1 go, 2 release, 4 orbiting,
// 8 recall, 0x10 waiting at home (it rides at the Epsilon's position), 0x20
// attacking, 0x40 dead, 0x100 orbit the other way, 0x200 far enough out.
//   0 (0x0055bdbc): at home, waiting; the go flag -> 1.
//   1 (0x0055bcc8): flies out: while within fparam1 + fparam2 of the Epsilon it
//     moves away from it at fparam2 (then flag 0x200); the release flag -> 2.
//   2 (0x0055ba0c): orbits the Epsilon: the orbit point turns by 65536 * v /
//     (2 pi r) BAMS a frame (negative with flag 0x100) around the Epsilon at
//     r = fparam1 and it moves toward the point at fparam3, facing away from
//     the Epsilon; the recall flag -> 3.
//   3 (0x0055b954): fades out over 20 frames (0.1 a step) -> 0 (waiting).
//   4 (0x0055b850): death (the Epsilon is gone while it is out): 20 frames, a
//     burst; 5 (0x0055b808) gone.
// While attacking (flag 0x20, set by the Epsilon's pattern) its shield grows
// 10 frames, holds iparam1 and shrinks 10 (0x0055b424), and a player it
// touches takes entity_hit_by_tech(group of the Epsilon's element, power
// fparam4) and a knockback. ASSUMED: touch radius 36 (the box grows with the
// shield animation: 0x009bdf18 = 36 * a factor), the element's status effect
// is not modelled (group 0), nothing else collides with it.
export const EPSIGARD = {
  fade: 20,
  grow: 10,
  shrink: 10,
  touch: 36,
  wasteFrames: 20,
} as const;

const EPSIGARD_ANIM = { wait: loop(2, 1) } as const;

export type EpsigardState = 'home' | 'out' | 'orbit' | 'recall' | 'dying' | 'gone';

export class EpsigardAi extends Ep2dBrain<EpsigardState> {
  state: EpsigardState | 'dead' = 'home';
  readonly parent: EpsilonAi;
  readonly index: number;
  private radius: number;
  private outSpeed: number;
  private orbitSpeed: number;
  private power: number;
  private hold: number;
  // Flags (enemy+0x474).
  private goFlag = false; // 1
  private releaseFlag = false; // 2
  private orbiting_ = false; // 4
  private recallFlag = false; // 8
  private waiting_ = true; // 0x10
  private attacking_ = false; // 0x20
  private reverse = false; // 0x100
  private far = false; // 0x200
  private deadFlag = false; // 0x40
  private sub = 0;
  private counter = 0;
  private angle3 = 0; // +0x440
  private step = 0; // +0x444
  private shield = 0; // 0 none .. 4: the stages of 0x0055b424
  private shieldT = 0;
  private shieldHold = 0;
  private readonly fade = new FadeEffect(f32(2 / 20)); // vtable +4 with 20: 0.1 a step
  private readonly touched = new Set<number>();
  private gone_ = false;

  constructor(opts: { parent: EpsilonAi; index: number; x: number; z: number; angle: number; movement: EnemyMovementData | null; phase: number; rng?: () => number }) {
    super({ ...opts, interval: 30 });
    this.parent = opts.parent;
    this.index = opts.index;
    const mv = opts.movement;
    this.radius = mv?.fparam1 ?? 50;
    this.outSpeed = mv?.fparam2 ?? 2;
    this.orbitSpeed = mv?.fparam3 ?? 1.5;
    this.power = mv?.fparam4 ?? 0;
    this.hold = mv?.iparam[0] ?? 30;
    this.current = EPSIGARD_ANIM.wait;
  }

  // Weapon hits and techniques do nothing to it.
  get invulnerable(): boolean {
    return true;
  }

  get deathMotion(): EnemyAiMotion {
    return once(2, 1);
  }

  get orbiting(): boolean {
    return this.orbiting_ && !this.waiting_ && !this.attacking_;
  }

  get waiting(): boolean {
    return this.waiting_;
  }

  get attacking(): boolean {
    return this.attacking_;
  }

  get out(): boolean {
    return this.state === 'out' && this.far;
  }

  get removed(): boolean {
    return this.gone_ || this.deadFlag;
  }

  // DerolleAimAtTarget_0055c014: placed at the Epsilon's slot, go flag.
  place(x: number, z: number, h: number, reverse: boolean): void {
    this.x = x;
    this.z = z;
    this.h = h;
    this.reverse = reverse;
    this.goFlag = true;
    this.warps++;
  }

  release(): void {
    this.releaseFlag = true;
  }

  recall(): void {
    this.recallFlag = true;
  }

  // Epsigard2EnableAttackState_0055c094.
  enableAttack(): void {
    this.attacking_ = true;
    this.shield = 0;
    this.touched.clear();
  }

  // The Epsilon is dying or gone (0x0055b364).
  parentDied(): void {
    if (this.deadFlag || this.gone_) return;
    if (this.waiting_) this.enter(null, 'gone');
    else this.enter(null, 'dying');
  }

  private enter(out: AiFrame | null, s: EpsigardState): void {
    this.state = s;
    this.sub = 0;
    this.counter = 0;
    switch (s) {
      case 'home':
        this.setAnim(out, EPSIGARD_ANIM.wait);
        this.waiting_ = true;
        this.orbiting_ = false;
        this.goFlag = false;
        break;
      case 'out':
        this.setAnim(out, EPSIGARD_ANIM.wait);
        this.releaseFlag = false;
        this.orbiting_ = false;
        this.waiting_ = false;
        this.far = false;
        break;
      case 'orbit':
        this.setAnim(out, EPSIGARD_ANIM.wait);
        this.orbiting_ = true;
        this.recallFlag = false;
        this.waiting_ = false;
        this.angle3 = this.h;
        this.step = 0;
        break;
      case 'recall':
        this.setAnim(out, EPSIGARD_ANIM.wait);
        this.fade.full();
        this.orbiting_ = false;
        this.waiting_ = false;
        break;
      case 'dying':
        this.setAnim(out, EPSIGARD_ANIM.wait);
        this.deadFlag = true;
        this.orbiting_ = false;
        this.waiting_ = false;
        this.attacking_ = false;
        break;
      case 'gone':
        this.gone_ = true;
        this.orbiting_ = false;
        this.attacking_ = true;
        break;
      default:
        exhaustive(s);
    }
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    if (this.state === 'dead' || this.gone_) return this.frame();
    const out = this.begin(targets, animationEnded);
    const p = this.parent;
    if (!this.deadFlag && (p.isDying || p.state === 'dead')) this.parentDied();
    // Waiting at home it rides at the Epsilon's position.
    if (this.waiting_ && this.state !== 'dying' && this.state !== 'gone') {
      this.x = p.x;
      this.z = p.z;
    }
    if (!this.skipCheck) this.transitions(out);
    this.skipCheck = false;
    this.update(out, targets);
    if (this.attacking_ && this.state !== 'gone' && this.state !== 'dying') this.shieldFrame(out, targets);
    // Waiting at home it is inside the Epsilon: not drawn (the update returns
    // before the collision / render calls, 0x0055b2f5).
    out.hidden = this.waiting_ || this.state === 'gone';
    return this.finishFrame(out);
  }

  private transitions(out: AiFrame): void {
    const s = this.state;
    if (s === 'dead') return;
    switch (s) {
      case 'home':
        if (this.goFlag) this.enter(out, 'out');
        break;
      case 'out':
        if (this.releaseFlag) this.enter(out, 'orbit');
        break;
      case 'orbit':
        if (this.recallFlag) this.enter(out, 'recall');
        break;
      case 'recall':
        if (this.fade.down()) {
          this.enter(out, 'home');
        }
        break;
      case 'dying':
        if (this.sub === 1) this.enter(out, 'gone');
        break;
      case 'gone':
        break;
      default:
        exhaustive(s);
    }
  }

  private update(_out: AiFrame, _targets: readonly AiTarget[]): void {
    const s = this.state;
    if (s === 'dead') return;
    const p = this.parent;
    switch (s) {
      case 'home':
        this.waiting_ = true;
        break;
      case 'out': {
        this.animate();
        this.tx = p.x;
        this.tz = p.z;
        this.initVelocity();
        if (!this.far) {
          if (this.tdist <= this.radius + this.outSpeed) {
            this.x += -this.tdx * this.outSpeed;
            this.z += -this.tdz * this.outSpeed;
          } else this.far = true;
        }
        this.h = bamsOf(this.x - p.x, this.z - p.z);
        break;
      }
      case 'orbit':
        this.animate();
        if (this.sub === 0) {
          // 65536 * v / (r * 2 pi) BAMS a frame; the other way with flag 0x100.
          const v = (0x10000 * this.orbitSpeed) / (this.radius * Math.PI * 2);
          this.step = Math.round(this.reverse ? -v : v);
          this.sub = 1;
        } else if (this.sub === 1) {
          this.angle3 += this.step;
          this.tx = p.x + this.sinH(this.angle3) * this.radius;
          this.tz = p.z + this.cosH(this.angle3) * this.radius;
          this.initVelocity();
          this.x += this.tdx * this.orbitSpeed;
          this.z += this.tdz * this.orbitSpeed;
        }
        this.h = bamsOf(this.x - p.x, this.z - p.z);
        break;
      case 'recall':
        this.animate();
        break;
      case 'dying':
        this.animate();
        if (this.sub === 0 && ++this.counter >= EPSIGARD.wasteFrames) this.sub = 1;
        break;
      case 'gone':
        break;
      default:
        exhaustive(s);
    }
  }

  // 0x0055b424: the shield animation and the touch damage of an attacking
  // Epsigard.
  private shieldFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.shield === 0) {
      this.shield = 1;
      this.shieldT = 0;
    } else if (this.shield === 1) {
      this.shieldT = f32(this.shieldT + 0.1);
      if (this.shieldT >= 1) {
        this.shield = 2;
        this.shieldT = 1;
        this.shieldHold = 0;
      }
    } else if (this.shield === 2) {
      if (++this.shieldHold >= this.hold) {
        this.shield = 3;
        this.shieldT = 1;
      }
    } else if (this.shield === 3) {
      this.shieldT = f32(this.shieldT - 0.1);
      if (this.shieldT <= 0) {
        this.shieldT = 0;
        this.attacking_ = false;
        this.shield = 0;
        return;
      }
    }
    let victims: AiTarget[] | null = null;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.dead || this.touched.has(t.clientId)) continue;
      if ((t.x - this.x) ** 2 + (t.z - this.z) ** 2 > EPSIGARD.touch ** 2) continue;
      this.touched.add(t.clientId);
      (victims ??= []).push(t);
    }
    if (victims) out.shots = [new EpsigardTouch(this.x, this.z, victims, this.power)];
  }

  flinches(): boolean {
    return false;
  }

  resume(): string {
    return this.state;
  }
}

// One frame of an Epsigard touching players.
class EpsigardTouch extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0x8080ff, size: 1 };
  private readonly victims: AiTarget[];

  constructor(x: number, z: number, victims: AiTarget[], power: number) {
    super(x, PLAYER_AIM_HEIGHT, z);
    this.victims = victims;
    this.effect = { kind: 'tech', power, knockback: 3 };
  }

  tick(): AiTarget[] {
    if (this.done) return [];
    this.done = true;
    return this.victims;
  }
}
