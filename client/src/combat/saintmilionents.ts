// Saint-Milion / Shambertin / Kondrieu: the 16 tentacle entities as the exe
// runs them (Ephinea PsoBB.exe, addresses are VAs), on top of the tables and
// the pose of combat/saintmilion.ts. combat/saintmilionboss.ts owns the boss
// and the field these entities share.
//
// One entity is a class of its own (SaintEmilionEntity, vtable 0x00b43ca0, ctor
// 0x0076dfec, 0x418 bytes): a dispatcher on +0x32e through
// HandleSaintEmilionEntityAction 0x0076db48 (vtable +0x164) that takes the
// action and a phase: 4 enters (SetInitialState 0x0076ef70 runs first, then
// the row's handler), 0 is the frame (the handler first, then ProcessState
// 0x0076dbfc), 5 leaves (no action does anything). The per-frame order of an
// entity (EnemyEntity_UpdateAI 0x0076d700 -> EnemyUpdateLoop 0x0052167c): the
// dead flag runs the death handler (vtable +0x104, 0x0076da50), else the hit
// flag runs the hit handler (+0x100, 0x0076d958), then the action's frame.
//
// What the handlers do (rows of SPINNER_ACTIONS, handler addresses):
//   0x0076d238 (0, 10): hidden wait. Entering action 0 as a lead sets the wake
//     mask to State2 bit 4 (8 when the set entry's param1 is not zero,
//     UpdateActionState 0x0076ef44). Nothing in the exe sets either bit:
//     RandomizePositionAndState forces the lead into action 1 and
//     UpdateSingleEntityPosition the follower into action 11.
//   0x0076d24c (1, 6, 11): the emergence. Enter: hit list cleared, sound
//     0x6eb (Activate 0x0076ee68); every frame the hit box touches players
//     (the table 0x009f7ac8: knockback 3.0, type 1 = try_hit_entity).
//   0x0076d2bc (8, 14): the flinch, sound 0x6ec.
//   0x0076d2d0 (4, 9, 15, 16): sinking / dying. Enter: hit list cleared, sound
//     0x6ee; in animation 1 (the reversed emergence) it touches players.
//   0x0076d320 (2): the idle. The shrink value (+0x3cc) grows to 1 (+0.1 a
//     frame), then falls by 1/180 a frame; when it is back at 0 the tentacle
//     strikes (action 3).
//   0x0076d3dc (3): the strike. At frame 26 of its animation
//     CreateRabartaEntity_006ec2d0 casts an enemy Rabarta of level MovementData
//     iparam1 of the tentacle's row at its feet (combat/techfire.ts
//     RabartaField).
//   0x0076d420 (7): the second half of the flinch; touches players.
//   0x0076d494 (12): the follower's idle: it spins by 0x888 a frame, pops up
//     (13) when a player is within 50 and goes back under (15) when none is
//     within 100.
//   0x0076d56c (13): the pop-up: the hold animation, z rising 50 units at
//     1.6666666 a frame, 60 frames at the top, then sinking and the reversed
//     animation; touches players from the top on.
//   0x0076d6d0 (5): relocates the tentacle (a new random distance on the same
//     angle, 0x0076ebd4) and goes on at once.
//
// Reaction to the player (UpdateStateMachineCounter 0x0076da04): a hit that
// takes a third of the maximum hp since the last time (the snapshot +0x346 starts
// at the maximum, and only counts while flag 1 is clear) makes a lead flinch
// (action 8; the lead of spot 0 also raises State2 bit 0x40, which the boss
// answers) and a follower flinch (action 14). Death never lasts: the lead
// raises State2 bit 0x80 << spot (the boss answers with 6xDC action 2) and
// sinks (action 9), the follower sinks (action 16), and both come back with
// full hp (vtable +0x108).
//
// ASSUMED (not traced): the radius of the player touch (the hit box of 15,
// tables 0x009f776c / 0x009f7798 / 0x009f77c4), that a hidden tentacle cannot
// be hit, the order of a player list (the exe's g_EntityArray), the shared
// random generator (the exe seeds each entity with init_rng(room seed + ...),
// which this tree does not carry), and the nearest-target test (0x007714cc)
// as the plain horizontal distance.

import type { AiTarget } from './enemyai.ts';
import { EnemyShot, PLAYER_RADIUS, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { enemyFire } from './techfire.ts';
import { TECH } from './techniques.ts';
import { chopToInt } from './chop.ts';
import {
  SPINNER_ACTIONS,
  SPINNER_ANIMATIONS,
  SPINNER_COUNT,
  SPINNER_FLAG,
  SPINNER_Z,
  spinnerFarEnough,
  spinnerFirstAction,
  spinnerFollowerSpot,
  spinnerGroup,
  spinnerIsLead,
  spinnerLeadSpot,
  spinnerStepX,
  spinnerSubId,
  type SpinnerAction,
} from './saintmilion.ts';

const f32 = Math.fround;
const BAMS = (Math.PI * 2) / 0x10000;

// The rates of the z value (+0x3c8; 0x00a9b0e0 / e4 / e8, written by the static
// initializer at 0x0076e9e0): the default fall, the sink flag's and the rise
// flag's.
export const SPINNER_RATE = { fall: 10, sink: f32(1.6666666269302368), rise: f32(1.6666666269302368) } as const;
// Per frame: the turn of the follower's idle (0x888 BAMS) and of the pop-up.
export const SPINNER_SPIN = 0x888;
// The attack frame of action 3 (0x41d00000) and the hold of the pop-up (+0x3d0).
export const SPINNER_STRIKE_FRAME = 26;
export const SPINNER_HOLD = 0x3c;
// EnemyGetNearestTargetInRange radii of the follower's idle (0x42480000, 0x42c80000).
export const SPINNER_SENSE = { pop: 50, keep: 100 } as const;
// ASSUMED radius of the hit box that touches players.
export const SPINNER_TOUCH_RADIUS = 15;
// The hit box the player's strikes find: radius 7.5 at 12.5 above the feet
// (0x009f7740), 15 while the hit box of the action is the big one.
export const SPINNER_BODY = { radius: f32(7.5), height: f32(12.5), bigRadius: 15 } as const;
// The knockback and type of the touches (0x009f7ac8 .. 0x009f7ae0: 3.0, 1).
export const SPINNER_TOUCH = { knockback: 3, mult: 1 } as const;
// UpdateStateMachineCounter divides the maximum by 3.
export const SPINNER_FLINCH_DIVISOR = 3;

// --- small generator -------------------------------------------------------------

// ASSUMED: a deterministic stream per entity (xorshift32) standing for the
// exe's init_rng(room seed + entity index). The same seed gives the same
// stream on every client, which is what keeps the spots in step.
export class SmRng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
    for (let i = 0; i < 4; i++) this.next();
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x;
  }
  // get_random_int >> 16.
  u16(): number {
    return this.next() >>> 16;
  }
  // get_random_float: [0, 1).
  float(): number {
    return this.next() / 0x100000000;
  }
}

// --- Player__Animate on one clock --------------------------------------------------

// The animation clock of Player__Animate 0x007a9e1c (enemy +0xc0 elapsed, +0xc8
// stride, +0xb0 flags 0x10 sticky / 0x20 for the tick of the end). A one-shot
// row (type 3) holds its last frame; a loop (type 1) wraps. A new animation
// is picked up by the next step (Enemy__CheckAnimationId): the step still adds
// the old stride, then StartNpcAnimation resets the clock.
export class SmClock {
  elapsed = 0;
  stride = 1;
  frames = 1;
  type = 3;
  ended = false; // animation_flags & 0x10
  pulse = false; // animation_flags & 0x20: the tick the one-shot ended
  private pending = false;
  private nextFrames = 1;
  private nextStride = 1;
  private nextLoop = false;

  set(frames: number, stride: number, loop: boolean): void {
    this.pending = true;
    this.nextFrames = Math.max(1, frames);
    this.nextStride = stride;
    this.nextLoop = loop;
  }

  // Starts at once (the constructor's Enemy__InitAnimation).
  start(frames: number, stride: number, loop: boolean): void {
    this.set(frames, stride, loop);
    this.begin();
  }

  private begin(): void {
    this.frames = this.nextFrames;
    this.stride = this.nextStride;
    this.type = this.nextLoop ? 1 : 3;
    this.elapsed = 0;
    this.ended = false;
    this.pulse = false;
    this.pending = false;
  }

  step(): void {
    this.elapsed = f32(this.elapsed + this.stride);
    this.pulse = false;
    if (this.pending) {
      if (this.frames <= this.elapsed) this.elapsed = f32(this.elapsed - this.stride);
      this.begin();
    }
    if (this.type === 1) {
      if (this.frames <= this.elapsed) this.elapsed = f32(this.elapsed - this.frames);
    } else if (this.type === 3) {
      if (this.frames - 1 <= this.elapsed) {
        this.type = 5;
        this.elapsed = f32(this.elapsed - this.stride);
        this.stride = 0;
        this.ended = true;
        this.pulse = true;
      }
    } else if (this.type === 5) {
      this.elapsed = f32(this.elapsed - this.stride);
    }
  }

  // check_entity_animation_elapsed_threshold 0x007aaa30: true on the one tick
  // the clock passes the threshold.
  crossed(threshold: number): boolean {
    return threshold < this.elapsed && this.elapsed <= f32(this.stride + threshold);
  }
}

// --- the shots the tentacles make -----------------------------------------------------

// A touch of the hit box: one try_hit_entity + knockback on the player it
// found, the tick after it was made.
export class SmTouch extends EnemyShot {
  readonly effect: ShotEffect = { kind: 'melee', mult: SPINNER_TOUCH.mult, knockback: SPINNER_TOUCH.knockback };
  readonly look: ShotLook = { color: 0x8040a0, size: 1, hidden: true };
  private who: AiTarget;
  constructor(x: number, y: number, z: number, who: AiTarget) {
    super(x, y, z);
    this.who = who;
  }
  tick(): AiTarget[] {
    if (this.done) return [];
    this.done = true;
    return [this.who];
  }
}

// --- the missile (SaintEmilionPart: ctor 0x0076619c, launch 0x0076681c, update 0x007663d4) ----
//
// Made by 0x0076b8f4 on the entry of state 18 (two: node 0x27 with the boss's id word, node 0x28 with
// id + 1) and by 0x0076968c on the clock's frame 5 in arenas 3 / 4 (two more, id + 2 and id + 3). The
// position is the node's (+0xdd4 for 0x27, +0xe14 for 0x28), the heading is the boss's (+0x60, BAMS):
// the velocity is 5.0 * (sin h, 0, cos h) with no height (0x00976174, the launch at 0x0076681c).
// The launch waits for the trail effect's flag (0x00765a90: child 0's bit 2, set by its motion), which
// the port does not read: ASSUMED it is set at once.
// Per update (0x007663d4): the frame counter goes up first; past 30 frames (the global 0x00a9b008, written
// 30 at 0x00766966) the missile steers: it scans the players from its stored index (the id mod the player
// count, then the last one it locked on) and takes the first who is alive and in line of sight (the ray
// 0x0077fffc from the missile to the feet, mask -1). With a target: speed s = max(|v| - 0.1, 1.45); the
// step is min(distance, 1.2) toward the target, added to v when the step is over 0.08; v is then scaled to s.
// Then the ray from the missile to its next position: a wall ends the missile with no blast (0x007667a8:
// effect 0x6f7 and the dead bit). Past 240 frames it ends the same way. Otherwise it moves.
// The blast comes from the motion event 0x80000 (0x007667e4: GalgryphonApplyBattleParams type 3, the row's
// iparam3, at the missile). The event is in the model's motion, which the port does not read: ASSUMED it is
// the first frame the missile is within 20.0 (0x00976190 is the band above the ground there) of its target.
// The blast reaches the living players within 100 on the XZ plane (ASSUMED: the exe passes the 30.0 radius
// of 0x007667e4 to the battle-params routine, whose threshold is 100.0 at 0x009216cc, and the 100 is not read).
export const SM_MISSILE = {
  speed: 5,
  life: 240,
  blast: 100,
  knockback: 3,
  // ASSUMED detonation distance (see above).
  arrive: 20,
  // The frame after which it steers (the frame counter must exceed 0x00a9b008 = 30).
  homingAfter: 30,
  // The steering step cap and its floor (0x00976184, 0x00976180).
  steer: 1.2,
  steerMin: 0.08,
  // The speed loss a steering frame (0x0097618c) and its floor (0x00976188).
  speedLoss: 0.1,
  speedFloor: 1.45,
} as const;

export interface SmMissileOptions {
  // The index the player scan starts at (the boss's id word, ASSUMED the entity index; the exe takes it mod the count).
  start: number;
  // The map's first wall on a segment (0x0077fffc, mask -1): the distance to it, or null when clear.
  wall?: ((from: SmPoint3, to: SmPoint3) => number | null) | undefined;
}

export class SmMissile extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff8040, size: 1.5 };
  // The exe's velocity (+0x50, +0x54, +0x58).
  vx: number;
  vy = 0;
  vz: number;
  // The scan's start (the exe's +0x6c): the player index it last locked on, or the first one to try.
  start: number;
  // The index of the player it is locked on, or -1.
  lock = -1;
  private readonly wall: SmMissileOptions['wall'];

  // heading: radians, the boss's heading (BAMS * BAMS_TO_RAD). damage: the row's iparam3.
  constructor(x: number, y: number, z: number, heading: number, damage: number, opts: SmMissileOptions) {
    super(x, y, z);
    this.vx = Math.sin(heading) * SM_MISSILE.speed;
    this.vz = Math.cos(heading) * SM_MISSILE.speed;
    this.start = opts.start;
    this.wall = opts.wall;
    this.effect = { kind: 'blast', damage, knockback: SM_MISSILE.knockback };
  }

  // The steering (0x007663d4's homing branch): the first living player in sight from the scan start.
  private steer(targets: readonly AiTarget[]): void {
    const n = targets.length;
    if (n === 0) return;
    const from = { x: this.x, y: this.y, z: this.z };
    let pick = -1;
    for (let k = 0; k < n; k++) {
      const i = (this.start + k) % n;
      const t = targets[i];
      if (!t || t.dead) continue;
      if (this.wall && this.wall(from, { x: t.x, y: t.y ?? 0, z: t.z }) !== null) continue;
      pick = i;
      break;
    }
    if (pick < 0) return;
    this.start = pick;
    this.lock = pick;
    const t = targets[pick];
    if (!t) return;
    const dx = t.x - this.x;
    const dy = (t.y ?? 0) - this.y;
    const dz = t.z - this.z;
    const dist = Math.hypot(dx, dy, dz);
    const speed = Math.max(Math.hypot(this.vx, this.vy, this.vz) - SM_MISSILE.speedLoss, SM_MISSILE.speedFloor);
    const step = Math.min(dist, SM_MISSILE.steer);
    if (step <= SM_MISSILE.steerMin || dist === 0) return;
    const ax = this.vx + (dx / dist) * step;
    const ay = this.vy + (dy / dist) * step;
    const az = this.vz + (dz / dist) * step;
    const len = Math.hypot(ax, ay, az) || 1;
    this.vx = (ax / len) * speed;
    this.vy = (ay / len) * speed;
    this.vz = (az / len) * speed;
  }

  // Returns the blast on the detonation frame (once), else nothing.
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    const old = this.frames;
    this.frames++;
    if (old > SM_MISSILE.homingAfter) this.steer(targets);
    const nx = this.x + this.vx;
    const ny = this.y + this.vy;
    const nz = this.z + this.vz;
    if (this.wall && this.wall({ x: this.x, y: this.y, z: this.z }, { x: nx, y: ny, z: nz }) !== null) {
      this.done = true;
      return [];
    }
    if (this.frames > SM_MISSILE.life) {
      this.done = true;
      return [];
    }
    this.x = nx;
    this.y = ny;
    this.z = nz;
    const t = this.lock >= 0 ? targets[this.lock] : undefined;
    if (!t || t.dead) return [];
    if (Math.hypot(t.x - this.x, (t.y ?? 0) - this.y, t.z - this.z) > SM_MISSILE.arrive) return [];
    this.done = true;
    return targets.filter((p) => !p.dead && Math.hypot(p.x - this.x, p.z - this.z) <= SM_MISSILE.blast);
  }
}

// --- the wave (state 21: 0x00769808, the beam 0x0076cb9c, update 0x0076ccdc) -------------
//
// One beam per phase-0 pass, made on the clock's frame 28 (SM.waveFrame; the effect 0x6f9 of
// frame 27 is not drawn). Read in the exe (PROVEN unless marked):
// - The origin O (0x00769808): the boss's matrix (identity, translated to the boss's position
//   +0x38, turned by its heading +0x60, 0x0082d838 / 0x0082d8bc) applied to the translation of a key
//   at frame 29 (0x00579de0, 0x00830aa0). The track is chosen by the runtime global [0xa9b078]. ASSUMED:
//   the key is 0, so O is the boss's position; the exe's O is off by the key's offset.
// - The beam's frame is the heading at the spawn (ctor +0x50, read by the update at 0x0076cd60).
// - Each update (0x0076ccdc): the ramp +0x58 = min(1, +0x58 + 0.025) first; the local point
//   (amp * sin θ, 0, rate * θ) with θ = +0x54 in BAMS (0x0076cd1d..0x0076cd53), turned by the
//   heading and added to O (0x0076cd6a..0x0076cd81); y = O.y + 10 (0x00977a00); θ += step; then the
//   probe 0x00780630(P, 0x16ef), a vertical trace through the collision objects. ASSUMED: the boss's
//   ground callback stands for it. No hit: the dead bit, no explosion. A hit: type 5 at P with the
//   radius ramp * 64 (0x009779f4) and the knockback 10.0 (dispatcher 0x00768990 case 5, no factor on
//   iparam5); the area hit takes max(radius, 100) (0x0051fc9c, threshold 0x009216d4 = 100), once per
//   frame, no once-per-player gate. Also SE 0x6fa at P each hit and a camera quake (not ported).
// - There is no life counter in the exe: the beam ends only when the probe misses.
// The 10.0 the exe passes with type 5 is the knockback, meaning not known (as the missile's 3.0).
export const SM_WAVE = {
  // The types 0 .. 3 (0x009779b8, 12 bytes each): the step of θ a frame (BAMS), the rate and the amp.
  types: [
    { step: 728, rate: 0.00213623046875, amp: -140 },
    { step: 728, rate: 0.00213623046875, amp: 140 },
    { step: 280, rate: 0.007171630859375, amp: -300 },
    { step: 280, rate: 0.007171630859375, amp: 300 },
  ],
  rampStep: 0.025,
  // The explosion's radius is ramp * 64 (0x009779f4); the area hit then takes max(radius, 100).
  radiusPerRamp: 64,
  knockback: 10,
  // The height above the boss's position: O.y + 10 (0x00977a00). The port's boss stands on the ground.
  height: 10,
} as const;

export class SmWave extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0x60c0ff, size: 1 };
  // The exe's +0x58 (the ramp, 0 .. 1). It sets the explosion's radius (ramp * 64), see tick.
  ramp = 0;
  private theta = 0;
  private readonly ox: number;
  private readonly oz: number;
  private readonly sin: number;
  private readonly cos: number;
  private readonly spec: (typeof SM_WAVE.types)[number];
  private readonly floor: (x: number, z: number) => boolean;

  // heading: BAMS (the boss's heading at the spawn). type: 0 .. 3. damage: the MovementData iparam5.
  // floor: the ground under (x, z) (the exe's probe 0x00780630, ASSUMED to be this callback).
  constructor(x: number, z: number, heading: number, type: number, damage: number, floor: (x: number, z: number) => boolean) {
    super(x, SM_WAVE.height, z);
    this.ox = x;
    this.oz = z;
    const a = heading * BAMS;
    this.sin = Math.sin(a);
    this.cos = Math.cos(a);
    this.spec = SM_WAVE.types[type] ?? SM_WAVE.types[0];
    this.floor = floor;
    this.effect = { kind: 'blast', damage, knockback: SM_WAVE.knockback };
  }

  // One update (0x0076ccdc): the ramp, the point P, θ += step, the probe; a hit is the explosion at P.
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.ramp = Math.min(1, this.ramp + SM_WAVE.rampStep);
    const t = this.theta;
    const lx = this.spec.amp * Math.sin(t * BAMS);
    const lz = this.spec.rate * t;
    this.x = this.ox + lx * this.cos + lz * this.sin;
    this.z = this.oz - lx * this.sin + lz * this.cos;
    this.theta += this.spec.step;
    if (!this.floor(this.x, this.z)) {
      this.done = true;
      return [];
    }
    const radius = Math.max(this.ramp * SM_WAVE.radiusPerRamp, SM_BLAST.minRadius);
    return targets.filter((p) => !p.dead && Math.hypot(p.x - this.x, p.z - this.z) <= radius);
  }
}

// --- the laser (states 19 / 20: ctor 0x00765c68, update 0x00765d7c, hit 0x00768a84 type 4) ---
//
// Made on phase 4 of state 19 or 20 (0x0076b85c: alloc 0x60, ProcessState 0x00765c68 with the boss's
// role [+0x3cc] and +0xe94). Its model is bm_obj_ep4_boss09_laser.bml, motion 0 (sandlaser.njm), 126
// frames, read with formats/njmotion.ts; the exe's clock is frames - 1 = 125.
// Each update (0x00765d7c, this = the laser; the ctor sets the threshold +0x34 to 125): the base update
// 0x00765a40 runs the children; the clock +0x30 gains 1.0 (0x00976108); at the threshold (`fcom [edi+0x34]`,
// 0x00765d95) the update stops the sound (0x8148d4 on the handle +0x5c) and sets the dead bit (word +0x8 |= 1),
// without a sweep. Otherwise:
// - the sound: while the handle +0x5c is negative and child slot 2 is flagged (0x00765a90, child +0x9c bit 2),
//   0x00814298(0x6f8, origin +0x38, 0, loop 1) starts it and the handle is stored. A LOOP, stopped by the end
//   update. The flag test is the only start condition found.
// - the aim: the vector aim (+0x44..+0x4c) minus origin (+0x38) (0x0082f9c4), its BAMS heading and the span to the
//   previous heading (+0x58) feed 0x00768a84 (type 4, this = the boss object at 0x00a9b07c, the laser's owner).
//   The heading is stored in +0x58 at once when child slot 1 is clear (0x00765e7d).
// - the length +0x50 grows 100.0 a frame (0x00976100) while child slot 1 is flagged, and the wall cut
//   0x0077fffc(origin +0x38, aim +0x44, mask -1) sets it to the distance to the first wall point (0x007a8c28,
//   0x0082dc9c). The cut does NOT write the point back: its pointer arguments are only read (checked in the
//   disassembly), the hit point goes to its own result list.
// - the impact: when the cut hits, 0x00661448 (group 0x10, kind 6, position = the pointer to +0x44, mask 0) is
//   spawned, so the impact sits at the unclipped aim point (the pointer is the laser's own aim slot).
// The hit (0x00768a84, this = the boss): the span is |cur - prev| (0x007a9018), the heading the midpoint
// (0x007a8cb8 = cur + ((prev - cur) as int16 >> 1)), and each player who is not dead, whose horizontal distance
// from the boss is below the reach + its box radius and whose bearing is inside the span, takes entity_hit_by_tech
// (the facing test 0x00772c08, hitbox branch: some box i with |centre_i| < radius_i + reach and |bearing_i - mid| < span;
// the port uses one circle of PLAYER_RADIUS for the box, ASSUMED; the no-hitbox branch is not a player's)
// group 0 with power = MovementData iparam2 (the row's +0x1c, dispatcher case 4), no knockback, every frame.
// The hit's own wall test (0x0077fffc with the boss's +0x38) runs only when the caller's flag (param_6) is set,
// which the laser does not set (0).
// WRITERS OF THE LASER'S +0x38 (origin) AND +0x44 (aim): the DRAW, not the update (settled 2026-10-25).
// The laser's vtable slot 2 (0x00765ed8, the render) stores &+0x38, &+0x44 and the length +0x50 in the globals
// [0x00a9b000], [0x00a9affc], [0x00a9aff8] and calls the draw callback 0x00765b44 through 0x007657c8. The
// callback keeps a pass counter [0x00a9afe8]: pass 0 calls 0x00765c1c with the origin pointer (+0x38), pass 2
// translates the render matrix by (0, 0, length) and calls 0x00765c1c with the aim pointer (+0x44). 0x00765c1c
// stores the current matrix's translation through the pointer (three dword stores at 0x00765c49..0x00765c56). So the aim is
// origin + length * forward of the render matrix, and the update reads the values the last draw wrote (one draw
// behind). The update 0x00765d7c never stores them (checked: only reads of +0x38 / +0x44..+0x4c).
// The render's heading (slot 2, 0x00765ed8) is proven (2026-10-25 later, DEVLOG): the vector op 0x0082eab8 is
// v * M with v = (0, 0, 1) (the caller's lea edx / push order), so the heading is atan2(M[2][0], M[2][2]) of the
// block M = boss+0xe94 (the matrix slot 0x2a, gated by 0x768964). The draw then rotates the render matrix about Y by
// that heading (0x0082d8bc, the sin / cos table 0x0098b560 / 0x0098c560) and translates by (0, 0, length): so
// aim = origin + length * (sin h, 0, cos h), the origin being the block's translation (+0x30..+0x38). The port
// reads that block's translation and z axis from the last draw (SaintMilionAi.nodes / axes, slot SM_LASER.headingSlot).
// The length +0x50 is a ramp: +100.0 an update (0x00976100) while child slot 1 is flagged (ASSUMED always), then the
// wall cut sets it to the distance from the origin to the first wall hit of the ray origin -> aim (0x0077fffc with
// mask -1, t in [0, 1], front faces only; 0x007a8c28 squared distance, 0x0082dc9c sqrt; proven by objdump of
// 0x00765d7c). The cut writes +0x50 only: the aim (+0x44) is never clipped, and the hit (0x00768a84) reads the aim,
// not +0x50. With no wall hit the ramp stands. The hit's line of sight is 0x0077fffc from the boss's origin to the
// player's feet (mask -1, 0x00768c87). With no wall geometry the ramp is capped at SM_LASER.reach (ASSUMED).
// ASSUMED: the origin is the boss's position read every frame; the box radius is PLAYER_RADIUS; child slots 1 and 2
// are flagged on every frame of the laser's life; the line of sight is clear when no `clear` is given.
export const SM_LASER = {
  // The clock's end: frames of bm_obj_ep4_boss09_laser.bml motion 0 (the laser is updated 125 times, the last one ends it).
  frames: 126,
  // The sound of the laser (0x6f8 of boss09's sound table): a loop from the first update to the end update.
  se: 0x6f8,
  // The length ramp (0x00976100 = 100.0, added to +0x50 each update). Proven.
  lengthStep: 100,
  // ASSUMED cap, used only without wall geometry (no `wall` callback): the exe's length stops at the first wall, so
  // the ramp is capped at the centre arenas' range (SM_ARENAS 3 / 4) as a stand-in. Not an exe constant.
  reach: 620,
  // The matrix slot of the laser's block (boss+0xe94, gated by 0x768964 with slot 0x2a): the origin and the heading
  // of the aim come from this node's transform, read by the render each draw. Proven (see above).
  headingSlot: 0x2a,
  // ASSUMED fallback, used only when the render has not recorded the node (no model, headless tests): the total
  // turn of the aim over the sweep frames, centred on the boss's heading (half a circle). Not an exe value.
  sweep: 0x8000,
} as const;

// The ramp after update k (0-based), uncapped: 100 * (k + 1) (0x00976100). The aim of an update with wall geometry.
export function laserRamp(k: number): number {
  return SM_LASER.lengthStep * (k + 1);
}

// The laser's length after update k (0-based) without wall geometry: the ramp, capped (see SM_LASER). The aim of that
// update is origin + this length along the sweep heading. ASSUMED: the exe's hit reads the previous draw's aim (one
// update behind); the port uses this update's length.
export function laserLength(k: number): number {
  return Math.min(laserRamp(k), SM_LASER.reach);
}

export interface SmPoint3 {
  x: number;
  y: number;
  z: number;
}

export interface SmLaserOptions {
  // The boss's position (the dispatcher's origin, the boss's +0x38). y is the origin's height (absent: 0, ASSUMED).
  origin: () => { x: number; y?: number; z: number };
  // The aim point of sweep frame k (0 .. frames - 4), the laser's +0x44 (XZ, at the origin's height).
  aim: (k: number) => { x: number; z: number };
  // MovementData iparam2 of the row being fought (read every frame, as the dispatcher does).
  damage: () => number;
  // The line of sight (0x0077fffc, the origin to the player's feet, mask -1); absent: clear (ASSUMED).
  clear?: (from: SmPoint3, to: SmPoint3) => boolean;
  // The wall cut (0x0077fffc, origin -> aim, mask -1): the distance to the first wall hit, or null. Absent: no cut.
  cut?: (from: SmPoint3, to: SmPoint3) => number | null;
}

const BAMS_UNIT = (Math.PI * 2) / 0x10000;
// A BAMS angle of a radian value, as u16.
const toBams = (rad: number): number => Math.round(rad / BAMS_UNIT) & 0xffff;
// A 16-bit signed difference, as the exe's (short) casts.
const toShort = (v: number): number => ((v & 0xffff) << 16) >> 16;
// integer_angle_abs_difference: |(short)(a - b)|.
const absAngleDiff = (a: number, b: number): number => Math.abs(toShort(a - b));

export class SmLaser extends EnemyShot {
  effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff3040, size: 1, hidden: true };
  // The exe's clock +0x30 (it is updated before the end test).
  private clock = 0;
  // The previous frame's aim heading (+0x58, BAMS).
  private prev = 0;
  // The drawn length (+0x50) after the last update: the wall cut when the ray hits a wall, else the aim's reach.
  length = 0;
  private readonly opts: SmLaserOptions;
  // Reused every tick (no allocation per frame).
  private readonly hits: AiTarget[] = [];

  constructor(opts: SmLaserOptions) {
    const o = opts.origin();
    super(o.x, 0, o.z);
    this.opts = opts;
    this.effect = { kind: 'tech', power: opts.damage() };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    this.hits.length = 0;
    if (this.done) return this.hits;
    const o = this.opts.origin();
    const oy = o.y ?? 0;
    this.x = o.x;
    this.z = o.z;
    this.frames++;
    const power = this.opts.damage();
    if (this.effect.kind !== 'tech' || this.effect.power !== power) this.effect = { kind: 'tech', power };
    this.clock += 1;
    if (this.clock >= SM_LASER.frames - 1) {
      this.done = true;
      return this.hits;
    }
    const aim = this.opts.aim(this.clock - 1);
    const ax = aim.x - o.x;
    const az = aim.z - o.z;
    const reach = Math.hypot(ax, az);
    // The wall cut (0x00765e20 .. 0x00765e51): the length becomes the distance to the first wall on origin -> aim.
    // The hit below reads the aim, not this length (0x00765e61 passes +0x44 to 0x00768a84).
    const cut = this.opts.cut ? this.opts.cut({ x: o.x, y: oy, z: o.z }, { x: aim.x, y: oy, z: aim.z }) : null;
    this.length = cut ?? reach;
    const cur = toBams(Math.atan2(ax, az));
    const span = absAngleDiff(cur, this.prev);
    // angle_sum (0x007a8cb8): cur + ((prev - cur) as int16 >> 1).
    const mid = (cur + (toShort(this.prev - cur) >> 1)) & 0xffff;
    this.prev = cur;
    for (const t of targets) {
      if (t.dead) continue;
      const tx = t.x - o.x;
      const tz = t.z - o.z;
      if (Math.hypot(tx, tz) >= reach + PLAYER_RADIUS) continue;
      if (absAngleDiff(toBams(Math.atan2(tx, tz)), mid) >= span) continue;
      if (this.opts.clear && !this.opts.clear({ x: o.x, y: oy, z: o.z }, { x: t.x, y: t.y ?? oy, z: t.z })) continue;
      this.hits.push(t);
    }
    return this.hits;
  }
}

// --- the explosions of the storm and the sand sonic ---------------------------------------
//
// The explosion's area hit (0x00521cdc: 100.0 for a radius up to 100, the radius itself above
// it): every living player within max(radius, 100) on the XZ plane, once. The damage is the
// value given (no formula, as the missile's blast); the knockback is cause_knockback's.
export const SM_BLAST = { minRadius: 100 } as const;

export class SmBlast extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xffffff, size: 1, hidden: true };
  private readonly radius: number;

  constructor(x: number, z: number, radius: number, damage: number, knockback: number) {
    super(x, 0, z);
    this.radius = Math.max(radius, SM_BLAST.minRadius);
    this.effect = { kind: 'blast', damage, knockback };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.done = true;
    return targets.filter((t) => !t.dead && Math.hypot(t.x - this.x, t.z - this.z) <= this.radius);
  }
}

// --- the storm (state 23: 0x0076b7a8 makes it, its update 0x00766c5c) ---------------------
//
// One object, made on phase 4 of state 23 and kept by the boss (it is not a shot). Read in the
// exe's update 0x00766c5c (PROVEN unless marked):
// - Its counter +0x68 (c) starts at 0. A frame whose child slot 2 is flagged (0x00765a90(2)) adds 1
//   before the explosions and plays SE 0x6f7 when c was below 1 (not ported). Then, when the count n
//   is above 0: T = 75 * n (0x00976234), c = n + 1. So a flagged frame moves c by 2 and an unflagged
//   one by 1 (once c is above 0).
// - For the radii r = 100, 200, 400, 1000 (0x00976224..0x00976230), in order, k = 0..3, of type 6 + k:
//   if T <= r an explosion of radius T and the scan stops; else if T <= r + 75 an explosion of radius
//   r. So a frame can give two explosions, and a ring is a radius-T blast while it grows.
// - Damage: iparam4 times 1.0, 0.8, 0.64, 0.32 for types 6 .. 9 (0x00768990's jump table; the products
//   of 0x00977484 and 0x0097748c, trunc as the missile's). Knockback 3.0 on every type.
// - The area of each explosion: max(radius, 100) (see SmBlast).
// - Once T is above 1075 (r + 75 of the last ring) no explosion can come again: the object is done.
// The exe's object has no dead bit; it is removed with the boss's state, which is not read.
// ASSUMED: the child slot 2 flag (the storm's motion window) is set on every frame (`flagged`), and
// the centre is the arena's origin (the exe passes the runtime global [0x00a9b020]; not decoded).
export const SM_STORM = { step: 75, radii: [100, 200, 400, 1000], factors: [1, 0.8, 0.64, 0.32], knockback: 3 } as const;

export class SmStorm {
  done = false;
  // The counter +0x68.
  private c = 0;
  // ASSUMED: whether child slot 2 is flagged this frame (0x00765a90(2)); the exe reads the motion.
  flagged: () => boolean = () => true;
  private readonly x: number;
  private readonly z: number;
  private readonly iparam: number;

  // x, z: the centre; iparam: the form's MovementData iparam4.
  constructor(x: number, z: number, iparam: number) {
    this.x = x;
    this.z = z;
    this.iparam = iparam;
  }

  private blast(k: number, radius: number): SmBlast {
    const damage = Math.trunc(f32(this.iparam * f32(SM_STORM.factors[k])));
    return new SmBlast(this.x, this.z, radius, damage, SM_STORM.knockback);
  }

  // One update (0x00766c5c): the explosions that go off on it.
  tick(): SmBlast[] {
    if (this.done) return [];
    let n = this.c;
    if (this.flagged()) n += 1;
    this.c = n;
    const out: SmBlast[] = [];
    if (n > 0) {
      const t = SM_STORM.step * n;
      this.c = n + 1;
      for (let k = 0; k < SM_STORM.radii.length; k++) {
        const r = SM_STORM.radii[k];
        if (t <= r) {
          out.push(this.blast(k, t));
          break;
        }
        if (t <= r + SM_STORM.step) out.push(this.blast(k, r));
      }
    }
    if (SM_STORM.step * this.c > SM_STORM.radii[SM_STORM.radii.length - 1] + SM_STORM.step) this.done = true;
    return out;
  }
}

// --- the sand sonic (state 10 at clock 45: 0x0076c644 makes it, 0x0076c974 launches it, its update
// 0x0076c2e0) -------------------------------------------------------------------------------------
//
// The wait is trunc(6 * rng) (0x009774ac = 6.0), set on the clock's 45 by 0x0076c790 (+0xb8). A wait of
// 0 or less launches on that frame (0x0076c790 calls the launch). Otherwise the update counts it down
// (0x0076c2e0), and the launch runs on the frame the count reaches 0, the same update. So a wait of w
// launches on the w-th update after the crossing. Then it launches from the arm's tip (0x0076c974): the
// start is node 0x17 (the exe adds 100 to its height and snaps it to the ground: ASSUMED, the port's
// ground is the boss's, and the port's node positions stand for the exe's +0x444 table). The heading
// is atan2(x, z) of node 0x17 alone (fpatan at 0x0076c9e8, PROVEN), not node 4 -> node 0x17; node 4 is
// read only for the radius (+0xbc, fixed at the launch). The move is then 20 times (+0xb4 = 20) 10.0 a
// frame (+0xb0) along the heading (0x0076c490, the vector (0, 0, 10) turned by the heading). After each
// move it explodes once at its position (0x0076c4ec -> 0x0076a788, type 2 with the boss's base
// ATP: the int16 at [boss+0x2c4], the damage of type 2 in 0x00768990). Its knockback is the 10.0
// of +0xb0 times 1.01 (0x00977940) passed as the third argument: its meaning is not known, as the
// missile's 3.0. Its radius is d * 120 * g (the fourth argument, 0x0097793c = 120.0), where d is the
// XZ distance from node 4, the point at +0xbc fixed at the launch, to the sand sonic, and g is a
// runtime global. ASSUMED: g = π / 720, so the radius is d * π / 6 (at least 100 by the area hit).
// It is removed after the twentieth move.
export const SM_SAND = { moves: 20, speed: 10, wait: 6, knockback: f32(10 * f32(1.01)), radiusPerDistance: Math.PI / 6 } as const;

export class SmSandSonic extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xd8b060, size: 1.5 };
  // Set by launch(): the sand sonic is a shot from then on (the boss adds it to its shots).
  launched = false;
  private wait: number;
  private moves = 0;
  private vx = 0;
  private vz = 0;
  private pivotX = 0;
  private pivotZ = 0;

  // delay: the frames to wait before the launch; damage: the boss's base ATP.
  constructor(delay: number, damage: number) {
    super(0, 0, 0);
    this.wait = Math.max(0, Math.trunc(delay));
    this.effect = { kind: 'blast', damage, knockback: SM_SAND.knockback };
  }

  // The wait is over before any update (0 or less): the launch runs at once (0x0076c790).
  ready(): boolean {
    return this.wait <= 0;
  }

  // One update of the countdown (0x0076c2e0): true while it still waits. The count that reaches 0 is the
  // launch's frame, so this returns false on that update.
  waiting(): boolean {
    if (this.wait <= 0) return false;
    this.wait--;
    return this.wait > 0;
  }

  // The launch at (x, z), heading `angle` (radians), with the arm's base (node 4) at (pivotX, pivotZ).
  launch(x: number, z: number, angle: number, pivotX: number, pivotZ: number): void {
    this.x = x;
    this.z = z;
    this.vx = Math.sin(angle) * SM_SAND.speed;
    this.vz = Math.cos(angle) * SM_SAND.speed;
    this.pivotX = pivotX;
    this.pivotZ = pivotZ;
    this.launched = true;
  }

  // One move and its explosion: the living players within the radius of its new position.
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done || !this.launched) return [];
    this.frames++;
    this.moves++;
    this.x += this.vx;
    this.z += this.vz;
    if (this.moves >= SM_SAND.moves) this.done = true;
    const d = Math.hypot(this.x - this.pivotX, this.z - this.pivotZ);
    const radius = Math.max(d * SM_SAND.radiusPerDistance, SM_BLAST.minRadius);
    return targets.filter((t) => !t.dead && Math.hypot(t.x - this.x, t.z - this.z) <= radius);
  }
}

// --- the shared field --------------------------------------------------------------------

export type SmEvent =
  // play_directional_sound_effect at the tentacle.
  | { kind: 'se'; id: number; x: number; z: number; loop?: boolean }
  // set_monster_spawn_initdata_as_dead of a tentacle (State2 bit 0x1000: the boss is gone).
  | { kind: 'gone'; slot: number }
  // The laser's end (0x8148d4 on its sound handle): stops the loop of that SE id.
  | { kind: 'seStop'; id: number };

export interface SmFieldOptions {
  // Frame count of a motion of bm_ene_boss09_tentacle.bml (0 .. 6).
  frames: (motion: number) => number;
  // Seeds the per-entity streams (the boss's entity index).
  seed: number;
  // Enemygetgroundinfo succeeded at that point (absent: always).
  ground?: (x: number, z: number) => boolean;
  // MovementData iparam1 of the tentacle rows [lead, follower] (the Rabarta level).
  level: readonly [number, number];
  // BattleParamEntry hp of the tentacle rows [lead, follower].
  hp: readonly [number, number];
  // The set entry's param1 (+0x3b8 = round(+0x35c)).
  param1: number;
}

// The global word State2 (0x00a9b070) and the 16 entities of
// g_SaintEmilionGlobalState (0x00a9b140). State2: 0x4 / 0x8 lead wake masks, 0x10
// follower wake mask, 0x20 hide, 0x40 spot-0 lead struck, 0x80 << n a lead
// of spot n died, 0x400 / 0x800 / 0x1000 are the boss's.
export class SmField {
  state2 = 0;
  players: readonly AiTarget[] = [];
  readonly events: SmEvent[] = [];
  readonly entities: SpinnerEntity[] = [];
  readonly opts: SmFieldOptions;

  constructor(opts: SmFieldOptions) {
    this.opts = opts;
    for (let i = 0; i < SPINNER_COUNT; i++) this.entities.push(new SpinnerEntity(i, this));
  }

  // SaintEmilionPart_SetStateBit 0x0076f578.
  setBit(n: number): void {
    this.state2 = (this.state2 | (0x80 << (n & 0x1f))) | 0;
  }

  // RandomizeSaintEmilionPartEntityStates 0x0076f38c: the four leads (slots
  // 0, 4, 8, 12) get a spot from r[0..3] % 3 and the same angle offset.
  randomize(r: readonly [number, number, number, number], offset: number): void {
    for (let g = 0; g < 4; g++) this.entities[g * 4].randomize(r[g] % 3, offset);
  }

  // SaintEmilionPart_UpdateBatchEntityPositions 0x0076f420: group g's three
  // followers go round player g (up to four). `avoid` is the spot they keep
  // 30 away from.
  placeFollowers(avoid: { x: number; z: number } | null, spots: ReadonlyArray<{ x: number; z: number; angle: number } | null>): void {
    for (let g = 0; g < 4; g++) {
      const p = spots[g];
      if (!p) continue;
      for (let k = 1; k < 4; k++) this.entities[g * 4 + k].place(avoid, p, p.angle);
    }
  }

  // SaintEmilionPart_UpdateAllInstances 0x0076f4f4.
  hideAll(): void {
    for (const e of this.entities) e.hide();
  }

  // SaintEmilionPart_ResetPhaseState 0x0076f514: the four leads are destroyed
  // (the followers stay).
  resetLeads(): void {
    for (let g = 0; g < 4; g++) this.entities[g * 4].gone = true;
  }

  // The first tick of every entity (the exe updates each as its own enemy).
  tick(): void {
    for (const e of this.entities) e.tick();
  }
}

// --- the entity ----------------------------------------------------------------------------

export class SpinnerEntity {
  readonly slot: number;
  readonly sub: 0 | 1;
  readonly group: number;
  readonly field: SmField;
  readonly maxHp: number;
  readonly level: number; // the Rabarta level
  readonly clock = new SmClock();
  readonly touched = new Set<number>();
  // Shots made since the owner last drained them.
  shots: EnemyShot[] = [];

  action = -1; // +0x32e
  flags = 0; // +0x3c0
  mask = 0; // +0x3c4
  anim = 0; // +0xb8
  heading = 0; // +0x60, BAMS
  x = 0; // +0x38
  z = 0; // +0x40
  rise = 0; // +0x3c8
  shrink = 0; // +0x3cc
  counter = 0; // +0x3d0
  spot = 0; // +0x3d4
  angle = 0; // +0x3d8
  hp: number;
  snap: number; // +0x346
  dead = false; // +0x30 & 0x800
  hitFlag = false; // +0x30 & 0x200
  gone = false;
  // The animation is run by hand (flag 0x40: a negative stride).
  manual = false;
  private clockId = 0; // +0xba: the animation the clock plays

  private readonly rng: SmRng;
  private readonly wake: 4 | 8;

  constructor(slot: number, field: SmField) {
    this.slot = slot;
    this.field = field;
    this.sub = spinnerSubId(slot);
    this.group = spinnerGroup(slot);
    this.rng = new SmRng(Math.imul(field.opts.seed + 1, 0x9e3779b1) ^ Math.imul(slot + 1, 0x85ebca6b));
    this.maxHp = Math.max(1, Math.trunc(field.opts.hp[this.sub]));
    this.hp = this.maxHp;
    this.snap = this.maxHp;
    this.level = field.opts.level[this.sub];
    this.wake = Math.round(field.opts.param1) === 0 ? 4 : 8;
    // The constructor: Enemy__InitAnimation(+0xb8 = 0), then the first action.
    this.clock.start(field.opts.frames(SPINNER_ANIMATIONS[0].motion), SPINNER_ANIMATIONS[0].speed, false);
    const first = spinnerFirstAction(slot);
    this.action = first;
    this.dispatch(first, 4);
  }

  get lead(): boolean {
    return spinnerIsLead(this.slot);
  }

  // Not drawn, not animated, not a target (flag 0x20).
  get hidden(): boolean {
    return (this.flags & SPINNER_FLAG.hidden) !== 0;
  }

  // ASSUMED: a hidden tentacle cannot be struck.
  get targetable(): boolean {
    return !this.hidden && !this.gone;
  }

  // The reticle (enable_reticle runs when flag 0x10 is clear).
  get lockable(): boolean {
    return this.targetable && (this.flags & SPINNER_FLAG.noReticle) === 0;
  }

  // The hit box a strike meets: radius and height above the feet.
  get hitRadius(): number {
    return this.big ? SPINNER_BODY.bigRadius : SPINNER_BODY.radius;
  }
  get hitHeight(): number {
    return f32(this.rise + SPINNER_BODY.height);
  }
  private get big(): boolean {
    const a = this.action;
    return a === 1 || a === 6 || a === 11 || a === 4 || a === 9 || a === 15 || a === 16 || a === 7 || a === 13;
  }

  // --- damage ------------------------------------------------------------------------------

  // A strike took `damage` hp (the hit sets flag 0x200, hp 0 flag 0x800).
  hit(damage: number): void {
    if (this.gone || damage < 1) return;
    this.hp = Math.max(0, this.hp - chopToInt(damage));
    this.hitFlag = true;
    if (this.hp <= 0) this.dead = true;
  }

  // restore_enemy_status from a 6x0A: hp = max - damage_taken, the hit flag.
  setDamageTaken(total: number): void {
    if (this.gone) return;
    this.hp = Math.max(0, this.maxHp - Math.max(0, Math.trunc(total)));
    this.hitFlag = true;
    this.dead = this.hp <= 0;
  }

  // vtable +0x108 (0x00779bb0): flag 0x800 off, hp back to the maximum.
  private revive(): void {
    this.dead = false;
    this.hp = this.maxHp;
  }

  // --- the frame ---------------------------------------------------------------------------

  tick(): void {
    if (this.gone) return;
    if (this.dead) this.died();
    else if (this.hitFlag) this.struck();
    this.dispatch(this.action, 0);
  }

  // vtable +0x100, 0x0076d958.
  private struck(): void {
    this.hitFlag = false;
    if (!this.flinchDue()) return;
    if (this.sub === 0) {
      if (this.spot === 0) this.field.state2 |= 0x40;
      if (this.action !== 8) this.change(8);
    } else if (this.sub === 1) {
      if (this.action !== 0xe) this.change(0xe);
    }
  }

  // UpdateStateMachineCounter 0x0076da04.
  private flinchDue(): boolean {
    const third = Math.trunc(this.maxHp / SPINNER_FLINCH_DIVISOR);
    if ((this.flags & SPINNER_FLAG.invulnerable) === 0 && third <= this.snap - this.hp) {
      this.snap -= third;
      return true;
    }
    return false;
  }

  // vtable +0x104, 0x0076da50.
  private died(): void {
    if (this.sub === 0) {
      if (this.snap > 0) {
        this.field.setBit(this.spot);
        this.snap = 0;
      }
      if (this.action !== 9) {
        this.change(9);
        this.revive();
        this.snap = this.hp;
        this.hitFlag = false;
      }
    } else if (this.sub === 1) {
      this.flags &= ~(SPINNER_FLAG.zRise | SPINNER_FLAG.zSink);
      if (this.action !== 0x10) {
        this.change(0x10);
        this.revive();
        this.snap = this.hp;
        this.hitFlag = false;
      }
    }
  }

  // --- actions -------------------------------------------------------------------------------

  // SaintEmilionEntity_ChangeAction 0x0076ded8.
  change(a: number): boolean {
    if (a < 0 || a >= SPINNER_ACTIONS.length) return false;
    if (a === this.action) return false;
    this.dispatch(this.action, 5);
    this.action = a;
    this.dispatch(a, 4);
    return true;
  }

  private dispatch(a: number, phase: number): void {
    if (a < 0 || a >= SPINNER_ACTIONS.length) return;
    const row = SPINNER_ACTIONS[a];
    if (phase === 4) this.initial(row);
    this.handle(row.handler, phase);
    if (phase === 0) this.process(row);
  }

  // SetInitialState 0x0076ef70.
  private initial(row: SpinnerAction): void {
    let f = this.flags & 0xffffef40;
    this.mask = row.mask;
    if (row.anim >= 0) this.setAnim(row.anim);
    f |= row.flags;
    if (row.flags & SPINNER_FLAG.randomHeading) this.heading = Math.round(this.rng.float() * 65536) & 0xffff;
    if (f & SPINNER_FLAG.clearRates) f &= 0xfffff0ff;
    this.flags = f;
  }

  // ProcessState 0x0076dbfc.
  private process(row: SpinnerAction): void {
    this.updateAnimation();
    if (this.field.state2 & 0x1000) {
      this.gone = true;
      this.field.events.push({ kind: 'gone', slot: this.slot });
      return;
    }
    if (this.flags & SPINNER_FLAG.nextRequested || this.mask & this.field.state2) this.change(row.next);
  }

  // The handlers by address.
  private handle(addr: number, phase: number): void {
    switch (addr) {
      case 0x76d238:
        if (phase === 4 && this.sub === 0) this.mask = this.wake;
        return;
      case 0x76d24c:
        if (phase === 4) {
          this.touched.clear();
          this.se(0x6eb);
        } else if (phase === 0) this.touch();
        return;
      case 0x76d2bc:
        if (phase === 4) this.se(0x6ec);
        return;
      case 0x76d2d0:
        if (phase === 4) {
          this.touched.clear();
          this.se(0x6ee);
        } else if (phase === 0 && this.anim === 1) this.touch();
        return;
      case 0x76d320:
        if (phase === 4) {
          if (this.flags & SPINNER_FLAG.xShrink) this.flags &= ~SPINNER_FLAG.xGrow;
        } else if (phase === 0) this.idle();
        return;
      case 0x76d3dc:
        if (phase === 0 && this.clock.crossed(SPINNER_STRIKE_FRAME)) this.strike();
        return;
      case 0x76d420:
        if (phase === 4) this.touched.clear();
        else if (phase === 0) this.touch();
        return;
      case 0x76d494:
        if (phase === 0) this.followerIdle();
        return;
      case 0x76d56c:
        if (phase === 4) {
          this.counter = SPINNER_HOLD;
          this.touched.clear();
          this.se(0x6ed);
        } else if (phase === 0) this.popUp();
        return;
      case 0x76d6d0:
        if (phase === 4) this.relocate();
        else if (phase === 0) this.flags |= SPINNER_FLAG.nextRequested;
        return;
      default:
        return;
    }
  }

  // 0x0076d340: the idle of the lead.
  private idle(): void {
    const f = this.flags;
    if (f & SPINNER_FLAG.xGrow) {
      if (this.shrink >= 1) this.flags = (f | SPINNER_FLAG.xShrink) & ~SPINNER_FLAG.xGrow;
    } else if (f & SPINNER_FLAG.xShrink) {
      if (this.shrink <= 0 && this.action !== 3) this.change(3);
    } else {
      this.flags = (f | SPINNER_FLAG.xShrink) & ~SPINNER_FLAG.xGrow;
    }
  }

  // 0x0076d4ac: the follower's idle.
  private followerIdle(): void {
    this.heading = (this.heading + SPINNER_SPIN) & 0xffff;
    if (this.rise <= 0) {
      if (this.nearest(SPINNER_SENSE.pop) && this.action !== 0xd) this.change(0xd);
    }
    if (!this.nearest(SPINNER_SENSE.keep) && this.action !== 0xf) this.change(0xf);
  }

  // 0x0076d58c: the pop-up.
  private popUp(): void {
    this.heading = (this.heading + SPINNER_SPIN) & 0xffff;
    if (this.anim === 8) {
      if (this.clock.ended) {
        this.setAnim(9);
        this.flags |= SPINNER_FLAG.zRise;
      }
      return;
    }
    if (this.anim === 9) {
      if (this.flags & SPINNER_FLAG.zRise) {
        if (this.rise >= SPINNER_Z.max) {
          this.counter -= 1;
          if (this.counter < 0) this.flags = (this.flags & ~SPINNER_FLAG.zRise) | SPINNER_FLAG.zSink;
        }
      } else if (this.rise <= 0) {
        this.setAnim(10);
        this.flags = this.flags & ~(SPINNER_FLAG.zSink | SPINNER_FLAG.invulnerable);
      }
      // The stride is written as 0: the animation holds still while it rises.
      this.clock.stride = 0;
      this.touch();
      return;
    }
    if (this.anim === 10 && this.ended()) this.flags |= SPINNER_FLAG.nextRequested;
  }

  // 0x0076ebd4: a new random distance on the stored angle.
  private relocate(): void {
    const dist = f32(f32(this.rng.u16()) * f32(0.0030517578125) + 100);
    const a = this.angle * BAMS;
    let x = dist * Math.sin(a);
    const z = dist * Math.cos(a);
    if (x < 0) x *= 1.5;
    this.x = x;
    this.z = z;
  }

  // Enemy Rabarta at the tentacle (0x006ec2d0).
  private strike(): void {
    const s = enemyFire({ tech: TECH.rabarta, level: this.level, x: this.x, y: 0, z: this.z, heading: 0, enemy: true });
    if (s) this.shots.push(s);
  }

  // The hit box touches players (once each until the list is cleared).
  private touch(): void {
    const reach = SPINNER_TOUCH_RADIUS + PLAYER_RADIUS;
    for (const p of this.field.players) {
      if (p.dead || this.touched.has(p.clientId)) continue;
      if ((p.x - this.x) ** 2 + (p.z - this.z) ** 2 > reach * reach) continue;
      this.touched.add(p.clientId);
      this.shots.push(new SmTouch(this.x, 0, this.z, p));
    }
  }

  // EnemyGetNearestTargetInRange: a live player within `range`.
  private nearest(range: number): boolean {
    for (const p of this.field.players) {
      if (!p.dead && (p.x - this.x) ** 2 + (p.z - this.z) ** 2 < range * range) return true;
    }
    return false;
  }

  private se(id: number): void {
    this.field.events.push({ kind: 'se', id, x: this.x, z: this.z });
  }

  // --- animation -----------------------------------------------------------------------------

  private setAnim(id: number): void {
    this.anim = id;
  }

  // The animation ended (+0xb0 & 0x10), whichever path runs it.
  private ended(): boolean {
    return this.clock.ended;
  }

  // 0x0076dcc8 (and the z / x steps of 0x0076de14 / 0x0076de78).
  private updateAnimation(): void {
    if (this.flags & SPINNER_FLAG.hidden) return;
    // UpdateAnimationChunk 0x0076dd34: a row with a negative speed is run by
    // hand from its last frame; any other row is Player__Animate's.
    if (this.anim !== this.clockId) {
      const row = SPINNER_ANIMATIONS[this.anim] ?? SPINNER_ANIMATIONS[0];
      const n = this.field.opts.frames(row.motion);
      if (row.speed >= 0) {
        this.manual = false;
        this.flags &= ~SPINNER_FLAG.chunkLoaded;
        this.clock.set(n, row.speed, row.loop);
      } else {
        this.clock.frames = n;
        this.clock.elapsed = f32(n - 1);
        this.clock.stride = row.speed;
        this.clock.ended = false;
        this.manual = true;
        this.flags |= SPINNER_FLAG.chunkLoaded;
      }
      this.clockId = this.anim;
    }
    if (!this.manual) {
      this.clock.step();
    } else {
      // UpdateAnimationTime 0x0076ddd4.
      const v = f32(this.clock.elapsed + this.clock.stride);
      if (v > 0) {
        this.clock.elapsed = v;
        this.clock.ended = false;
      } else {
        this.clock.elapsed = 0;
        this.clock.ended = true;
      }
    }
    this.stepZ();
    this.stepX();
    if (this.flags & SPINNER_FLAG.nextOnAnimationEnd && this.clock.ended) {
      this.clock.ended = false;
      this.flags = (this.flags & ~SPINNER_FLAG.invulnerable) | SPINNER_FLAG.nextRequested;
    }
  }

  private stepZ(): void {
    const rate = this.flags & SPINNER_FLAG.zRise ? SPINNER_RATE.rise : this.flags & SPINNER_FLAG.zSink ? -SPINNER_RATE.sink : -SPINNER_RATE.fall;
    const v = f32(rate + this.rise);
    this.rise = v >= SPINNER_Z.min ? (v < SPINNER_Z.max ? v : SPINNER_Z.max) : SPINNER_Z.min;
  }

  private stepX(): void {
    this.shrink = spinnerStepX(this.flags, this.shrink);
  }

  // --- placement -----------------------------------------------------------------------------

  // UpdatePartDisplayState 0x0076e74c.
  hide(): void {
    if (this.gone) return;
    if (this.sub === 0) {
      if (this.action !== 9) this.change(9);
    } else if (this.sub === 1 && this.action !== 0xf) this.change(0xf);
  }

  // SaintEmilionPart_RandomizePositionAndState 0x0076e48c: the lead's spot.
  randomize(spot: number, offset: number): void {
    const ground = this.field.opts.ground;
    let p = spinnerLeadSpot(this.slot, offset, this.rng.u16());
    for (let tries = 0; ground && !ground(p.x, p.z) && tries < 64; tries++) p = spinnerLeadSpot(this.slot, offset, this.rng.u16());
    this.angle = p.angle;
    this.spot = spot;
    this.x = p.x;
    this.z = p.z;
    this.revive();
    this.hitFlag = false;
    if (this.action !== 1) this.change(1);
  }

  // UpdateSingleEntityPosition 0x0076e5e8: a follower waiting in action 10
  // takes a spot round a player.
  place(avoid: { x: number; z: number } | null, center: { x: number; z: number }, angle: number): boolean {
    if (this.action !== 10) return false;
    const spot = spinnerFollowerSpot(this.slot, center, angle);
    const ground = this.field.opts.ground;
    if (ground && !ground(spot.x, spot.z)) return false;
    if (!spinnerFarEnough(spot, avoid)) return false;
    this.x = spot.x;
    this.z = spot.z;
    this.spot = 3;
    this.change(0xb);
    return true;
  }

  // The pose the owner draws.
  get motion(): number {
    return SPINNER_ANIMATIONS[this.anim]?.motion ?? 0;
  }
  get frame(): number {
    return this.clock.elapsed;
  }
}
