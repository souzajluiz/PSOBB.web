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

// --- the missile (0x0076619c, update 0x007663d4) -----------------------------------------
//
// The missile flies along its launch vector at 5.0 a frame (0x00976174). Its
// model's motion (track 0 of the flags at [motion+0xa4], 0x007b5290 with
// 0x80000) ends the flight: that is the explosion 0x007667e4 (type 3, radius
// 30.0 passed on), then the kill 0x007667a8. The motion's length is in the
// missile's model file, which the port does not read.
// ASSUMED: the flight ends when the missile comes within 20.0 (0x00976190, the
// test that sets motion state 4 in 0x00766650..0x007666f7) of the point it was
// aimed at (the nearest player at launch); the motion's frames after state 4
// are not read, so the blast is at that point. ASSUMED: the path is a straight
// line on flat ground.
// The 240-frame cap (`cmp [+0x68], 0xf0`, 0x0076661d) only removes the missile
// (0x007667a8: the effect 0x6f7 and the dead bit): no blast on that path.
// The blast (0x00521cf8 with the 100.0 of 0x00521cdc): every living player
// within 100 on the XZ plane (no height test) takes iparam3 once.
export const SM_MISSILE = { speed: 5, life: 240, blast: 100, knockback: 3, arrive: 20 } as const;
// ASSUMED: the height the missile is drawn at (the player's aim height).
const SM_MISSILE_HEIGHT = 10;

export class SmMissile extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff8040, size: 1.5 };
  private vx: number;
  private vz: number;
  private travelled = 0;
  private range: number | null;

  // range: the distance the flight lasts (null: no aim, it only ends at the cap).
  constructor(x: number, z: number, angle: number, damage: number, range: number | null) {
    super(x, SM_MISSILE_HEIGHT, z);
    this.vx = Math.sin(angle) * SM_MISSILE.speed;
    this.vz = Math.cos(angle) * SM_MISSILE.speed;
    this.range = range;
    this.effect = { kind: 'blast', damage, knockback: SM_MISSILE.knockback };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.z += this.vz;
    this.travelled += SM_MISSILE.speed;
    if (this.range !== null && this.travelled >= this.range) {
      this.done = true;
      return targets.filter((t) => !t.dead && Math.hypot(t.x - this.x, t.z - this.z) <= SM_MISSILE.blast);
    }
    if (this.frames > SM_MISSILE.life) this.done = true;
    return [];
  }
}

// --- the wave (state 21: 0x00769808, the beam 0x0076cb9c, update 0x0076ccdc) -------------
//
// One beam per phase-0 pass, made on the clock's frame 28 (SM.waveFrame; the effect 0x6f9 of
// frame 27 is not drawn). Its origin O is a boss node read at frame 29 of a one-frame track,
// whose data is not read: ASSUMED the boss's position at the spawn, and its local frame is the
// boss's heading then.
// Each frame P = O + R(amp * sin θ, 0, rate * θ), θ in BAMS (65536 = 360 degrees; x sideways,
// z forward; R turns the local frame by the heading), then θ += step and ramp = min(1, ramp + 0.025).
// The hit is a ground probe under P: with ground, an explosion of type 5 at P every frame, iparam5
// to every living player within 100 on the XZ plane (no height test, no once-per-player gate);
// without ground the beam dies. The probe is the boss's ground callback when it has one, else the
// boss's arena circle (ASSUMED, see SaintMilionAi.waveFrame). ASSUMED: the life cap.
// The 10.0 the exe passes with type 5 is the knockback, meaning not known (as the missile's 3.0).
export const SM_WAVE = {
  // The types 0 .. 3 (0x009779b8): the step of θ a frame (BAMS), the rate and the amp.
  types: [
    { step: 728, rate: 0.00213623046875, amp: -140 },
    { step: 728, rate: 0.00213623046875, amp: 140 },
    { step: 280, rate: 0.007171630859375, amp: -300 },
    { step: 280, rate: 0.007171630859375, amp: 300 },
  ],
  rampStep: 0.025,
  radius: 100,
  knockback: 10,
  // ASSUMED: the height the beam is drawn at, and its life (the exe's beam ends on the ground probe).
  height: 10,
  life: 600,
} as const;

export class SmWave extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0x60c0ff, size: 1 };
  // The exe's +0x58. No hit uses it (the blast radius is 100, not ramp * 64).
  ramp = 0;
  private theta = 0;
  private readonly ox: number;
  private readonly oz: number;
  private readonly sin: number;
  private readonly cos: number;
  private readonly spec: (typeof SM_WAVE.types)[number];
  private readonly floor: (x: number, z: number) => boolean;

  // heading: BAMS. type: 0 .. 3. damage: the MovementData iparam5. floor: the ground under (x, z).
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

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    if (this.frames > SM_WAVE.life) {
      this.done = true;
      return [];
    }
    const t = this.theta;
    const lx = this.spec.amp * Math.sin(t * BAMS);
    const lz = this.spec.rate * t;
    this.x = this.ox + lx * this.cos + lz * this.sin;
    this.z = this.oz - lx * this.sin + lz * this.cos;
    if (!this.floor(this.x, this.z)) {
      this.done = true;
      return [];
    }
    this.theta += this.spec.step;
    this.ramp = Math.min(1, this.ramp + SM_WAVE.rampStep);
    return targets.filter((p) => !p.dead && Math.hypot(p.x - this.x, p.z - this.z) <= SM_WAVE.radius);
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
// One object, made on phase 4 of state 23 and kept by the boss (it is not a shot). Its counter n
// starts at 1 on its first frame and grows by 1 a frame; T = 75 * n (0x00976234). The explosion
// of radius r (0x00976224: 100, 200, 400, 1000) goes off on the frame T first passes r
// (r < T <= r + 75), so on frames 2, 3, 6 and 14. Its damage is iparam4 times the factor of
// its type 6 .. 9 (0x00768990's jump table: 1.0, 0.8, 0.64 and 0.32, the products of 0x00977484
// and 0x0097748c; trunc as the missile's), its knockback 3.0 (0x40400000 on every type).
// ASSUMED: the storm is active from its creation (the exe gates the update on a motion flag the
// port cannot read), and its centre is the arena's origin (the exe passes the runtime global
// [0x00a9b020]; not decoded). It ends after the fourth explosion.
export const SM_STORM = { step: 75, radii: [100, 200, 400, 1000], factors: [1, 0.8, 0.64, 0.32], knockback: 3 } as const;

export class SmStorm {
  done = false;
  private n = 0;
  private fired = 0;
  private readonly x: number;
  private readonly z: number;
  private readonly iparam: number;

  // x, z: the centre; iparam: the form's MovementData iparam4.
  constructor(x: number, z: number, iparam: number) {
    this.x = x;
    this.z = z;
    this.iparam = iparam;
  }

  // One frame: the explosions that go off on it.
  tick(): SmBlast[] {
    if (this.done) return [];
    this.n++;
    const t = SM_STORM.step * this.n;
    const out: SmBlast[] = [];
    while (this.fired < SM_STORM.radii.length) {
      const r = SM_STORM.radii[this.fired];
      if (!(r < t && t <= r + SM_STORM.step)) break;
      const damage = Math.trunc(f32(this.iparam * f32(SM_STORM.factors[this.fired])));
      out.push(new SmBlast(this.x, this.z, r, damage, SM_STORM.knockback));
      this.fired++;
    }
    if (this.fired >= SM_STORM.radii.length) this.done = true;
    return out;
  }
}

// --- the sand sonic (state 10 at clock 45: 0x0076c644 makes it, 0x0076c974 launches it, its update
// 0x0076c2e0) -------------------------------------------------------------------------------------
//
// It waits trunc(6 * rng) frames (0x009774ac = 6.0), then launches from the arm's tip: the start is
// node 0x17 (the exe adds 100 to its height and snaps it to the ground: ASSUMED, the port's ground
// is the boss's) and the heading is atan2 of node 4 -> node 0x17 in XZ (BAMS, the swing's
// direction). It moves 20 times (+0xb4 = 20) 10.0 a frame (+0xb0) along the heading. After each
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

  // One frame of the wait: true while it still waits.
  waiting(): boolean {
    if (this.wait <= 0) return false;
    this.wait--;
    return true;
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
  | { kind: 'se'; id: number; x: number; z: number }
  // set_monster_spawn_initdata_as_dead of a tentacle (State2 bit 0x1000: the boss is gone).
  | { kind: 'gone'; slot: number };

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
    this.hp = Math.max(0, this.hp - Math.round(damage));
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
