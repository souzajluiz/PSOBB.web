// Per-family enemy state machines of Forest / Caves (PsoBB.exe, Ephinea
// 1.25.13, addresses are VAs): Poison Lily, Savage / Barbarous Wolf, the Rag
// Rappy's fake death and the Monest's Mothmant spawning. The generic walking
// FSM every other family uses is combat/enemyai.ts; these classes have the
// same EnemyBrain shape so render/combat.ts drives them the same way.
//
// Every one of these AIs is a dispatcher on enemy+0x32e whose handlers take an
// argument: 4 = enter the state, 0 = the frame, 3 = the transition check after
// the frame, 5 = leave it (SetEnemyAiState_0051f62c runs 5 on the old state
// and 4 on the new one). The enemy's resume state after a flinch is +0x380.

import {
  BAMS_TO_RAD,
  type AiFrame,
  type AiState,
  type AiTarget,
  type EnemyAiMotion,
  type EnemyBrain,
} from './enemyai.ts';
import type { EnemyAttackData } from '../formats/battleparams.ts';
import { STATUS } from './status.ts';

const loop = (index: number, speed: number): EnemyAiMotion => ({ index, speed, loop: true });
const once = (index: number, speed: number): EnemyAiMotion => ({ index, speed, loop: false });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ClampAngleDifference_007a8c74 in radians.
function turnToward(from: number, to: number, max: number): number {
  return wrap(from + Math.max(-max, Math.min(max, wrap(to - from))));
}

function nearest(targets: readonly AiTarget[], x: number, z: number, range: number): AiTarget | null {
  let best: AiTarget | null = null;
  let bestSq = range * range;
  for (const t of targets) {
    if (t.dead) continue;
    const d = (t.x - x) ** 2 + (t.z - z) ** 2;
    if (d >= bestSq) continue;
    best = t;
    bestSq = d;
  }
  return best;
}

abstract class BrainBase implements EnemyBrain {
  abstract state: string;
  x: number;
  z: number;
  angle: number;
  targetId: number | null = null;
  protected current: EnemyAiMotion | null = null;
  protected rng: () => number;

  constructor(x: number, z: number, angle: number, rng: () => number) {
    this.x = x;
    this.z = z;
    this.angle = angle;
    this.rng = rng;
  }

  get motion(): EnemyAiMotion | null {
    return this.current;
  }

  protected frame(): AiFrame {
    return { motion: null, x: this.x, z: this.z, angle: this.angle, hit: null };
  }

  protected play(out: AiFrame, m: EnemyAiMotion): void {
    // A state entry restarts its motion even when it is the same row.
    this.current = m;
    out.motion = m;
  }

  protected target(targets: readonly AiTarget[]): AiTarget | null {
    return this.targetId === null ? null : (targets.find((t) => t.clientId === this.targetId && !t.dead) ?? null);
  }

  protected dist(t: AiTarget): number {
    return Math.hypot(t.x - this.x, t.z - this.z);
  }

  protected angleTo(t: AiTarget): number {
    return Math.atan2(t.x - this.x, t.z - this.z);
  }

  protected finish(out: AiFrame): AiFrame {
    out.x = this.x;
    out.z = this.z;
    out.angle = this.angle;
    return out;
  }

  abstract tick(targets: readonly AiTarget[], animationEnded?: boolean): AiFrame;
  abstract onDamage(clientId: number): void;
  abstract resume(): string;

  kill(): void {
    this.state = 'dead';
    this.current = null;
  }
}

// --- Poison Lily -------------------------------------------------------------
//
// LilyAI_Update_00527e74 dispatches 0x32e: 1 spawn (0x00529228), 2 idle
// (0x00529184), 3 track (0x00528efc), 4 spit (0x00528c38), 5 bite
// (0x00528a24), 6 scream (0x005286f4), 7 satisfied (0x005285f4), 8 the
// low-HP spin (0x005282d0), 9 damage, 10 death. The animation rows are the
// table 0x009bc280: 0 spit (motion 0, 0.6), 1 closed (4, 0.3, loop), 2 open
// (5, 0.5, loop), 3 opening (6, 0.6, chains to 2), 6 satisfied (3, 0.6,
// loop), 7 bite (0, 2.0).
//   idle: FindEnemyTarget_00520ea0(250) -> track.
//   track: animation 3 coming from idle, else 2; the target is refreshed every
//     20 frames; the Lily turns toward it by its turn rate (the record
//     0x009bc33c, 512 BAMS) and counts frames (+0x41c). Then: farther than
//     300 (0x00922044) or no target -> idle; closer than 50 (0x00922040) and
//     within AttackData's angle -> bite; else after 100 frames (0x0092203c)
//     -> spit.
//   spit: animation 0; at frame 12 LilySpawnMegidProjectile_00529e68 launches
//     the spit from the mouth (12 above, 0x0092204c) along the Lily's
//     heading; back to track when the animation ends. A spit that hits sets
//     +0x3cc bit 2 (LilyAI_SetActiveFlag_00529c78) and LilyAI_CheckStatus
//     _00528ee0 puts the Lily into the satisfied state.
//   bite: animation 7; at frame 10 the usual try_hit_entity(1.0) +
//     cause_knockback(3.0); the animation holds its last frame 3 frames
//     (0x00922058), then 20 more (> 0x13) and back to track.
//   damage: when the flinch ends, below a quarter of its HP it goes to the
//     spin state (8), else with get_random_float < 0.3 (0x00922084) it
//     screams, else it returns to +0x380.
//   scream: animation 1; at frame 6 it takes the first live player within
//     100 (g_LilyTechMaxSpeed_00a72f9c = 10000 squared), at frame 25 it calls
//     that player's entity_hit_by_tech with group 0x10 (0x00922070 = 0x10,
//     0.0): paralysis; after 30 frames back to track.
export const LILY = {
  idleSearch: 250,
  lose: 300,
  biteRange: 50,
  spitAfter: 100,
  spitFrame: 12,
  mouth: 12,
  biteFrame: 10,
  biteHold: 3 + 20,
  screamChance: Math.fround(0.3),
  screamRange: 100,
  screamLock: 6,
  screamHit: 25,
  screamEnd: 30,
  turnRate: 512,
  retarget: 20,
} as const;

const LILY_MOTION = {
  spit: once(0, 0.6),
  closed: loop(4, 0.3),
  open: loop(5, 0.5),
  opening: once(6, 0.6),
  satisfied: loop(3, 0.6),
  bite: once(0, 2),
};

export type LilyState = 'idle' | 'track' | 'spit' | 'bite' | 'scream' | 'satisfied' | 'spin' | 'dead';

export class LilyAi extends BrainBase {
  state: LilyState = 'idle';
  private timer = 0;
  private frames = 0; // motion frames of the current state
  private opening = false;
  private retarget = 0;
  private dealt = false;
  private held = -1;
  private satisfiedPending = false;
  private screamTarget: number | null = null;
  private attackAngle: number;
  private reach: number;
  hpFraction = 1; // the owner keeps it current (the spin state below 1/4)

  constructor(opts: { x: number; z: number; angle: number; attack: EnemyAttackData | null; radius: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.attackAngle = ((opts.attack?.angle ?? 0x2000) & 0xffff) * BAMS_TO_RAD;
    this.reach = (opts.attack?.distanceX ?? 0) + opts.radius;
    this.current = LILY_MOTION.closed;
  }

  // The spit hit a player (LilyAI_SetActiveFlag_00529c78).
  spitLanded(): void {
    this.satisfiedPending = true;
  }

  private enter(out: AiFrame, state: LilyState): void {
    const from = this.state;
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    this.dealt = false;
    this.held = -1;
    if (state === 'idle') {
      this.targetId = null;
      this.play(out, LILY_MOTION.closed);
    } else if (state === 'track') {
      this.opening = from === 'idle';
      this.play(out, this.opening ? LILY_MOTION.opening : LILY_MOTION.open);
    } else if (state === 'spit') this.play(out, LILY_MOTION.spit);
    else if (state === 'bite') this.play(out, LILY_MOTION.bite);
    else if (state === 'scream') {
      this.screamTarget = null;
      this.play(out, LILY_MOTION.closed);
    } else if (state === 'satisfied') this.play(out, LILY_MOTION.satisfied);
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead' || this.state === 'spin') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    if (this.satisfiedPending && this.state !== 'scream') {
      this.satisfiedPending = false;
      this.enter(out, 'satisfied');
      return this.finish(out);
    }
    switch (this.state) {
      case 'idle': {
        const t = nearest(targets, this.x, this.z, LILY.idleSearch);
        if (t) {
          this.targetId = t.clientId;
          this.enter(out, 'track');
        }
        break;
      }
      case 'track': {
        if (this.opening && animationEnded) {
          this.opening = false;
          this.play(out, LILY_MOTION.open);
        }
        let t = this.target(targets);
        if (++this.retarget >= LILY.retarget) {
          this.retarget = 0;
          if (t && this.dist(t) > 30) {
            const closer = nearest(targets, this.x, this.z, this.dist(t) - 30);
            if (closer) t = closer;
            this.targetId = t.clientId;
          }
        }
        if (t) this.angle = turnToward(this.angle, this.angleTo(t), LILY.turnRate * BAMS_TO_RAD);
        if (!t || this.dist(t) > LILY.lose) {
          this.enter(out, 'idle');
          break;
        }
        const d = this.dist(t);
        if (d < LILY.biteRange) {
          if (Math.abs(wrap(this.angleTo(t) - this.angle)) < this.attackAngle) this.enter(out, 'bite');
        } else if (this.timer > LILY.spitAfter) {
          this.enter(out, 'spit');
        }
        break;
      }
      case 'spit':
        if (!this.dealt && this.frames >= LILY.spitFrame) {
          this.dealt = true;
          out.projectile = { x: this.x, z: this.z, angle: this.angle };
        }
        if (animationEnded) this.enter(out, 'track');
        break;
      case 'bite': {
        if (!this.dealt && this.frames >= LILY.biteFrame) {
          this.dealt = true;
          const t = this.target(targets);
          if (t && this.dist(t) <= this.reach && Math.abs(wrap(this.angleTo(t) - this.angle)) <= this.attackAngle) {
            out.hit = { clientId: t.clientId, knockback: 3, mult: 1 };
          }
        }
        if (animationEnded && this.held < 0) this.held = 0;
        if (this.held >= 0 && ++this.held > LILY.biteHold) this.enter(out, 'track');
        break;
      }
      case 'scream':
        if (this.timer === LILY.screamLock) {
          const t = targets.find((p) => !p.dead && (p.x - this.x) ** 2 + (p.z - this.z) ** 2 < LILY.screamRange ** 2);
          this.screamTarget = t ? t.clientId : null;
        } else if (this.timer === LILY.screamHit && this.screamTarget !== null) {
          out.status = { clientId: this.screamTarget, type: STATUS.paralysis };
        }
        if (this.timer > LILY.screamEnd - 1) this.enter(out, 'track');
        break;
      case 'satisfied':
        // ASSUMED: one pass of the motion (LilyAI_ProcessState4_005285f4
        // waits for g_LilyAnimElapsedThreshold + the motion's length).
        if (this.timer >= 60) this.enter(out, 'track');
        break;
    }
    return this.finish(out);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    this.current = null;
  }

  // The flinch ended (unknown_lily_handle_damage_taken, argument 3).
  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    if (this.hpFraction < 0.25) {
      // The spin of state 8 (SinowberillAI_ProcessState_005282d0) is not
      // reproduced: the Lily keeps tracking (left out).
      this.enter(out, 'track');
    } else if (Math.fround(this.rng()) < LILY.screamChance) this.enter(out, 'scream');
    else this.enter(out, 'track');
    return this.state;
  }
}

// LilySpawnMegidProjectile_00529e68 / its update 0x0052a08c (vtable
// 0x00b011e0): 4.0 units per frame along the heading (0x009221c4); after 18
// frames (0x12) the vertical speed drops by 0.1 per frame (0x009221b4); it
// lives 150 frames (0x009221b8). Its hit box (radius 2.0, 0x009bc38c) hits a
// player with {group 0x0f = poison, 2.0} (0x009bc384): poison only, no
// damage; the hit tells the Lily (LilyAI_SetActiveFlag_00529c78). A map
// collision 7 units ahead ends it (ASSUMED here: reaching the ground).
export const SPIT = { speed: 4, dropAfter: 18, gravity: Math.fround(0.1), life: 150, radius: 2 } as const;
// ASSUMED: the player's hit box radius for projectiles (the player collision
// radius 5 of render/lobbyview.ts).
export const PLAYER_RADIUS = 5;

export class LilySpit {
  x: number;
  z: number;
  height: number; // above the Lily's feet
  private vx: number;
  private vz: number;
  private vy = 0;
  private frames = 0;
  done = false;

  constructor(x: number, z: number, angle: number) {
    this.x = x;
    this.z = z;
    this.height = LILY.mouth;
    this.vx = Math.sin(angle) * SPIT.speed;
    this.vz = Math.cos(angle) * SPIT.speed;
  }

  // One frame; returns the player it hit, if any.
  tick(targets: readonly AiTarget[]): AiTarget | null {
    if (this.done) return null;
    if (++this.frames >= SPIT.life) {
      this.done = true;
      return null;
    }
    if (this.frames >= SPIT.dropAfter) this.vy -= SPIT.gravity;
    this.x += this.vx;
    this.z += this.vz;
    this.height += this.vy;
    if (this.height <= 0) {
      this.done = true;
      return null;
    }
    for (const t of targets) {
      if (t.dead) continue;
      if (Math.hypot(t.x - this.x, t.z - this.z) <= SPIT.radius + PLAYER_RADIUS) {
        this.done = true;
        return t;
      }
    }
    return null;
  }
}

// --- Savage / Barbarous Wolf -------------------------------------------------
//
// The wolf's dispatcher (0x0051dXXX, the switch at 0x0051e1xx) runs 10 stalk
// (SavageWolfProcessTargetLogic_0051cdfc), 0xb leap (SavageWolfProcessState
// Attack_0051c810), 0xc side dash (0x0051c5ac), 0xd hop back (0x0051c264), 0xe
// howl (0x0051c0ac: the Barbarous Wolf casts Zalure at 30 and Jellen at 40).
// Animation rows: table 0x009bb860.
//   stalk: animation 1 (13, 1.0); it circles the target at a radius that
//     eases (0.2 per frame, 0x009212bc) toward a random 50..80. From 45
//     frames on: 100 or more away (0xa72e00 = 10000 squared) it closes in
//     (SavageWolfProcessFarTargetLogic_0051d430); closer than 30 (0xa72e04 =
//     900) it leaps; when the target faces it (the target's heading against
//     the wolf-to-target direction below cos(0x6aaa)) it leaps; every 451
//     frames (0x1c3) it leaps with get_random_float < 0.5 (0x009212c0).
//   leap: animation 0xc (motion 5); d = min(distance, 40) (0x009212ec), the
//     step is d / 13.333 per frame (0x00921300); while the motion frame is at
//     most 30 (0x009212f4) the height is 20 - 20 * (t - 15)^2 / 15^2
//     (0x009212f0, 0xa72dfc = 15, 0x009212fc = -20), then the step shrinks by
//     0.8 per frame (0x009212f8). At frame 20 a hit with try_hit_entity(1.0)
//     and cause_knockback(7.0). When the motion ends: after a hit straight to
//     the hop back, else 10 more frames sliding first.
//   hop back: animation 0x12 (motion 9); the direction is the heading turned
//     by +-(0x1800 + n * 0x1000) (the first one whose ground is free; the sign
//     follows entity id & 1), 1.8 units per frame (GalGryphonProcessMovement
//     argument), turning by at most 0xf00; back to stalk when it ends.
export const WOLF = {
  stalkMin: 50,
  stalkMax: 80,
  radiusEase: Math.fround(0.2),
  decideAfter: 45,
  far: 100,
  near: 30,
  facingCos: Math.cos(0x6aaa * BAMS_TO_RAD),
  rethink: 0x1c3,
  rethinkChance: Math.fround(0.5),
  leapMax: 40,
  leapFrames: Math.fround(13.333333015441895),
  airFrames: 30,
  apex: 15,
  height: 20,
  slow: Math.fround(0.8),
  hitFrame: 20,
  knockback: 7,
  slide: 10,
  hopTurn: 0x1800,
  hopSpeed: 1.8,
  hopTurnRate: 0xf00,
  // ASSUMED: the stalk step (+0x408 = 0.7 is the stalk state's value; how it
  // becomes a speed through LerpFloat_0051d3c4 was not traced).
  stalkSpeed: 0.7,
} as const;

// The leap's height above the ground at motion frame t.
export function wolfLeapHeight(t: number): number {
  if (t > WOLF.airFrames) return 0;
  return Math.max(0, WOLF.height - (WOLF.height * (t - WOLF.apex) ** 2) / WOLF.apex ** 2);
}

const WOLF_MOTION = {
  wait: loop(12, 0.8),
  stalk: loop(13, 1),
  // The table's speed fields of slots 0xc and 0x12 are 0 and written at run
  // time. ASSUMED: the leap runs 30 / 13.333 = 2.25 motion frames per tick,
  // so its 30 airborne frames take 13.333 ticks and the step d / 13.333
  // covers exactly d; the hop back 1.0.
  leap: once(5, 30 / WOLF.leapFrames),
  hop: once(9, 1),
};

export type WolfState = 'idle' | 'stalk' | 'leap' | 'hop' | 'dead';

export class WolfAi extends BrainBase {
  state: WolfState = 'idle';
  private detect: number;
  private turn: number;
  private reach: number;
  private timer = 0;
  private frames = 0;
  private orbit = 65;
  private orbitWant = 65;
  private side = 1;
  private step = 0;
  private hit = false;
  private dealt = false;
  private ended = -1;
  private hopAngle = 0;
  private parity: number;
  lift = 0;

  constructor(opts: { x: number; z: number; angle: number; detect: number; turnRate: number; attack: EnemyAttackData | null; radius: number; entityId: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.detect = opts.detect;
    this.turn = opts.turnRate * BAMS_TO_RAD;
    this.reach = (opts.attack?.distanceX ?? 0) + opts.radius;
    this.parity = opts.entityId & 1;
    this.current = WOLF_MOTION.wait;
  }

  private enter(out: AiFrame, state: WolfState, t: AiTarget | null): void {
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    this.lift = 0;
    if (state === 'idle') {
      this.targetId = null;
      this.play(out, WOLF_MOTION.wait);
    } else if (state === 'stalk') {
      this.orbitWant = WOLF.stalkMin + this.rng() * (WOLF.stalkMax - WOLF.stalkMin);
      this.side = this.rng() < 0.5 ? 1 : -1;
      if (t) this.orbit = this.dist(t);
      this.play(out, WOLF_MOTION.stalk);
    } else if (state === 'leap') {
      // SavageWolfCalculateAttackPosition_0051ccc8 aims at the target (its
      // lead was not decoded: ASSUMED the current position).
      const d = t ? this.dist(t) : 0;
      if (t) this.angle = this.angleTo(t);
      this.step = Math.min(d, WOLF.leapMax) / WOLF.leapFrames;
      this.hit = false;
      this.dealt = false;
      this.ended = -1;
      this.play(out, WOLF_MOTION.leap);
    } else if (state === 'hop') {
      const sign = this.parity === 0 ? -1 : 1;
      this.hopAngle = wrap(this.angle + sign * WOLF.hopTurn * BAMS_TO_RAD);
      this.play(out, WOLF_MOTION.hop);
    }
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    switch (this.state) {
      case 'idle': {
        const t = nearest(targets, this.x, this.z, this.detect);
        if (t) {
          this.targetId = t.clientId;
          this.enter(out, 'stalk', t);
        }
        break;
      }
      case 'stalk': {
        const t = this.target(targets);
        if (!t) {
          this.enter(out, 'idle', null);
          break;
        }
        const d = this.dist(t);
        // The orbit radius eases toward its pick by 0.2 per frame.
        this.orbit += Math.max(-WOLF.radiusEase, Math.min(WOLF.radiusEase, this.orbitWant - this.orbit));
        // A point on the circle a little ahead of the wolf's side of it.
        const around = Math.atan2(this.x - t.x, this.z - t.z) + this.side * 0.3;
        const goalX = t.x + Math.sin(around) * this.orbit;
        const goalZ = t.z + Math.cos(around) * this.orbit;
        const want = Math.atan2(goalX - this.x, goalZ - this.z);
        this.angle = turnToward(this.angle, want, this.turn);
        this.x += Math.sin(this.angle) * WOLF.stalkSpeed;
        this.z += Math.cos(this.angle) * WOLF.stalkSpeed;
        if (this.timer >= WOLF.rethink) {
          this.timer = 0;
          if (this.rng() < WOLF.rethinkChance) this.enter(out, 'leap', t);
          break;
        }
        if (this.timer > WOLF.decideAfter) {
          if (d >= WOLF.far) {
            // The far logic closes in: ASSUMED a straight run at the target.
            this.angle = turnToward(this.angle, this.angleTo(t), this.turn);
          } else if (d < WOLF.near) {
            this.enter(out, 'leap', t);
          } else if (t.angle !== undefined) {
            const fx = Math.sin(t.angle);
            const fz = Math.cos(t.angle);
            const dot = (fx * (t.x - this.x) + fz * (t.z - this.z)) / Math.max(1e-6, d);
            if (dot < WOLF.facingCos) this.enter(out, 'leap', t);
          }
        }
        break;
      }
      case 'leap': {
        const t = this.target(targets);
        const f = this.frames;
        if (f <= WOLF.airFrames) {
          this.lift = wolfLeapHeight(f);
        } else {
          this.lift = 0;
          if (!this.hit) this.step *= WOLF.slow;
        }
        if (!this.hit || f <= WOLF.airFrames) {
          this.x += Math.sin(this.angle) * this.step;
          this.z += Math.cos(this.angle) * this.step;
        }
        if (!this.dealt && f >= WOLF.hitFrame) {
          this.dealt = true;
          if (t && this.dist(t) <= this.reach + this.step) {
            this.hit = true;
            out.hit = { clientId: t.clientId, knockback: WOLF.knockback, mult: 1 };
          }
        }
        if (animationEnded && this.ended < 0) this.ended = 0;
        if (this.ended >= 0) {
          if (this.hit || ++this.ended > WOLF.slide - 1) this.enter(out, 'hop', t);
        }
        break;
      }
      case 'hop':
        this.angle = turnToward(this.angle, this.hopAngle, WOLF.hopTurnRate * BAMS_TO_RAD);
        this.x += Math.sin(this.hopAngle) * WOLF.hopSpeed;
        this.z += Math.cos(this.hopAngle) * WOLF.hopSpeed;
        if (animationEnded) {
          const t = this.target(targets);
          this.enter(out, t ? 'stalk' : 'idle', t);
        }
        break;
    }
    out.lift = this.lift;
    return this.finish(out);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    this.lift = 0;
    this.current = null;
  }

  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    this.enter(out, this.targetId !== null ? 'stalk' : 'idle', null);
    return this.state;
  }
}

// --- Rag Rappy / Al Rappy: the fake death -----------------------------------
//
// update_rappy (0x00525xxx): once the Rappy is dead and has not faked yet
// (+0x3a8 bit 2), +0x388 counts frames; when no player is within 120
// (EnemyGetNearestTargetInRange_007714cc) or after 900 frames (> 899)
// PlayerProcessVulnerableState_00525c90 gets it up: HP 1, the dead flags
// cleared, a random turn per frame round(r * 360 * 65536 / 360)
// (0x00921c18 = 360, 0x00921c14 = 65536), animation 9 (motion 7) and
// substate 3. Substate 3 spins by that amount every frame until the motion
// ends (it chains to animation 4, motion 3, the run), then substate 4 runs
// at the record's speed * 3.5 (0x00921be8): after 15 frames, a player within
// 300 that is within 0xaaa BAMS of its heading turns it 90 degrees either way
// (get_random_float < 0.5). It is deleted when its next step finds no
// ground or the 14 turned retries all fail.
export const RAPPY = {
  clearRange: 120,
  maxWait: 899,
  fleeFactor: 3.5,
  dodgeAfter: 15,
  dodgeRange: 300,
  dodgeArc: 0xaaa,
} as const;

export type RappyFakePhase = 'down' | 'up' | 'flee' | 'gone';

export class RappyFakeDeath {
  phase: RappyFakePhase = 'down';
  x: number;
  z: number;
  angle: number;
  private counter = 0;
  private spin = 0;
  private dodge = 0;
  private speed: number;
  private rng: () => number;
  frames = 0;

  constructor(opts: { x: number; z: number; angle: number; moveSpeed: number; rng?: () => number }) {
    this.x = opts.x;
    this.z = opts.z;
    this.angle = opts.angle;
    this.speed = opts.moveSpeed * RAPPY.fleeFactor;
    this.rng = opts.rng ?? Math.random;
  }

  // One frame after the death motion. Returns the motion to start, if any:
  // 'getup' (animation 9) or 'run' (animation 4).
  tick(targets: readonly AiTarget[], animationEnded: boolean): 'getup' | 'run' | null {
    this.frames++;
    if (this.phase === 'down') {
      this.counter++;
      if (!nearest(targets, this.x, this.z, RAPPY.clearRange) || this.counter > RAPPY.maxWait) {
        this.phase = 'up';
        this.spin = Math.round(this.rng() * 65536);
        return 'getup';
      }
      return null;
    }
    if (this.phase === 'up') {
      this.angle = wrap(this.angle + this.spin * BAMS_TO_RAD);
      if (animationEnded) {
        this.phase = 'flee';
        return 'run';
      }
      return null;
    }
    if (this.phase === 'flee') {
      if (++this.dodge > RAPPY.dodgeAfter) {
        const t = nearest(targets, this.x, this.z, RAPPY.dodgeRange);
        if (t && Math.abs(wrap(Math.atan2(t.x - this.x, t.z - this.z) - this.angle)) < RAPPY.dodgeArc * BAMS_TO_RAD) {
          this.angle = wrap(this.angle + (this.rng() < 0.5 ? 1 : -1) * Math.PI / 2);
          this.dodge = 0;
        }
      }
      this.x += Math.sin(this.angle) * this.speed;
      this.z += Math.cos(this.angle) * this.speed;
    }
    return null;
  }
}

// --- Monest: spawning Mothmants ---------------------------------------------
//
// monest_constructor (0x005191c0 area): the total it may ever spawn is
// initdata_param3 clamped to 0..30 (MothmanSetTarget_0051a1fc, +0x39c), the
// "wave" threshold initdata_param2 clamped to 1..6 (+0x358 slot of the
// target field). Its first child's entity index is its own + 1 (+0x3cc),
// then +1 per spawn; newserv's expandEnemySets gives a Monest the next 30
// (or num_children) slots as MOTHMANT, so the n-th spawn is the slot
// Monest + 1 + n.
//   hover (state 5, animation 4 = motion 8, 0.3, loop): the first time it
//     sets the batch size 2 (+0x4c8) and the interval 120 frames (+0x4cc).
//     MothmanManageSpawnLogic_00519ad0: while not armed it arms itself when
//     the live children are at most param2 / 2 (or it was activated); armed,
//     a counter runs to 120 and then sets the count to spawn to
//     min(2, 6 - alive, total - spawned). Any count left -> spawn state.
//   spawn (state 6, animation 5 = motion 7, 0.7): at motion frame 15
//     spawn_mothmant_from_monest (nothing while more than 6 are alive) puts
//     one at the Monest + 25 up (0x00920e68), SE 0xe0; the count drops; back
//     to hover when the motion ends.
// ASSUMED: the Monest wakes up (state 1 -> 5) when a player is within its
// search radius 225 (the record 0x009bb764); state 1 was not traced.
export const MONEST = { batch: 2, interval: 120, maxAlive: 6, spawnFrame: 15, height: 25, maxTotal: 30 } as const;

const MONEST_MOTION = { wait: loop(14, 0.3), hover: loop(8, 0.3), spawn: once(7, 0.7) };

export class MonestSpawner {
  total: number;
  threshold: number;
  spawned = 0;
  active = false;
  state: 'wait' | 'hover' | 'spawn' = 'wait';
  private armed = false;
  private counter = 0;
  private pending = 0;
  private frames = 0;
  private fired = false;

  constructor(param2: number, param3: number) {
    this.total = Math.max(0, Math.min(MONEST.maxTotal, Math.round(param3)));
    const p2 = Math.round(param2);
    this.threshold = p2 > 5 ? 6 : p2 < 1 ? 0 : p2;
  }

  get motion(): EnemyAiMotion {
    return this.state === 'wait' ? MONEST_MOTION.wait : this.state === 'hover' ? MONEST_MOTION.hover : MONEST_MOTION.spawn;
  }

  // One frame. `alive` is the number of its live Mothmants. Returns the motion
  // to start (when it changed) and whether a Mothmant is spawned this frame.
  tick(alive: number, playerNear: boolean, animationEnded: boolean): { motion: EnemyAiMotion | null; spawn: boolean } {
    let motion: EnemyAiMotion | null = null;
    let spawn = false;
    if (this.state === 'wait') {
      if (playerNear) {
        this.state = 'hover';
        this.active = true;
        motion = MONEST_MOTION.hover;
      }
      return { motion, spawn };
    }
    if (this.state === 'hover') {
      if (!this.armed) {
        if (alive <= Math.trunc(this.threshold / 2) || this.active) {
          this.armed = true;
          this.counter = 0;
        }
      } else if (++this.counter > MONEST.interval) {
        this.counter = 0;
        this.pending = Math.min(MONEST.batch, MONEST.maxAlive - alive, this.total - this.spawned);
      }
      if (this.pending > 0) {
        this.state = 'spawn';
        this.frames = 0;
        this.fired = false;
        motion = MONEST_MOTION.spawn;
      }
      return { motion, spawn };
    }
    // spawn
    this.frames += MONEST_MOTION.spawn.speed;
    if (!this.fired && this.frames >= MONEST.spawnFrame) {
      this.fired = true;
      this.pending--;
      if (alive <= MONEST.maxAlive && this.spawned < this.total) {
        this.spawned++;
        spawn = true;
      }
    }
    if (animationEnded && this.fired) {
      this.state = 'hover';
      motion = MONEST_MOTION.hover;
    }
    return { motion, spawn };
  }
}

// Mothmant (MothmanConstructor_005168a4 -> 0x00518bfc, table 0x009bb5c0,
// record 0x009bb614: search 225, turn 1536): its own FSM (the state
// functions around 0x0051784c) is not reproduced; it uses the generic FSM
// with these rows: 0 fly (motion 10, 0.6, loop), 2 the attack (0, 1.0) whose
// hit lands at frame 9 there (7 in the generic FSM: ASSUMED close enough).
export const MOTHMANT_PROFILE = {
  idle: loop(10, 0.6),
  walk: loop(10, 0.6),
  notice: null,
  attacks: [once(0, 1)],
} as const;
// ASSUMED: the height a Mothmant flies at above the ground (it spawns 25
// above the Monest).
export const MOTHMANT_FLY_HEIGHT = 15;

export type { AiState };
