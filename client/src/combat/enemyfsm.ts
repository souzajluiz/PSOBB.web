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
  ATTACK_DAMAGE_MULT,
  ATTACK_KNOCKBACK,
  BAMS_TO_RAD,
  type AiFrame,
  type AiState,
  type AiTarget,
  type EnemyAiMotion,
  type EnemyBrain,
} from './enemyai.ts';
import type { EnemyAttackData } from '../formats/battleparams.ts';
import { STATUS } from './status.ts';
import { exhaustive } from '../exhaustive.ts';

export const loop = (index: number, speed: number): EnemyAiMotion => ({ index, speed, loop: true });
export const once = (index: number, speed: number): EnemyAiMotion => ({ index, speed, loop: false });
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ClampAngleDifference_007a8c74 in radians.
export function turnToward(from: number, to: number, max: number): number {
  return wrap(from + Math.max(-max, Math.min(max, wrap(to - from))));
}

export function nearest(targets: readonly AiTarget[], x: number, z: number, range: number): AiTarget | null {
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

export abstract class BrainBase implements EnemyBrain {
  abstract state: string;
  x: number;
  z: number;
  angle: number;
  targetId: number | null = null;
  // Render hint (EnemyBrain.warps): bumped on a teleport, read by no logic.
  warps = 0;
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
  // The low-HP spin (state 8, SinowberillAI_ProcessState_005282d0): below
  // max HP >> 2 (the damage handler's test, hp < max / 4 in shorts) the flinch
  // ends in the spin; the count (+0x418) passing 450 (0x1c2) is the blast.
  spinLimit: 450,
  spinUltimateStep: 20, // Ultimate Mode adds 20 a frame (is_ultimate_mode)
  spinBobTop: 0x100, // the bob (+0x3e0) turns at 256 and runs back from 0x1fe
  spinBobFull: 0xff, // the bob is 255 from count 435 on
} as const;

// The spin's heading turn (BAMS a frame) and bob step by count (+0x418): under
// 300 0x400 / 0x11, under 360 0x800 / 0x22, under 435 0x1000 / 0x44; from 435
// on the Lily stops turning and its bob holds at 255.
const LILY_SPIN_PHASES = [
  { until: 300, turn: 0x400, bob: 0x11 },
  { until: 360, turn: 0x800, bob: 0x22 },
  { until: 435, turn: 0x1000, bob: 0x44 },
] as const;

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
  // The owner keeps these current (setHp). The spin tests hp < maxHp >> 2.
  hp = 0;
  maxHp = 0;
  // Ultimate Mode (is_ultimate_mode: the count runs 20 a frame) and the Nar
  // (dark) variant (entity flag 0x800: other sounds). The owner sets them.
  ultimate = false;
  dark = false;
  // Spin (state 8): the count (+0x418), the bob (+0x3e0, 0..255 with the
  // direction +0x41c), the flag that the spin started (+0x3cc bit 4, kept
  // across re-entries), the resume state (+0x380 == 8) and the blast.
  spinFrames = 0;
  spinBob = 0;
  private spinDown = false;
  private spinStarted = false;
  private spinResume = false;
  exploded = false;
  private sePending: number[] = [];

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    attack: EnemyAttackData | null;
    radius: number;
    ultimate?: boolean;
    rng?: () => number;
  }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.attackAngle = ((opts.attack?.angle ?? 0x2000) & 0xffff) * BAMS_TO_RAD;
    this.reach = (opts.attack?.distanceX ?? 0) + opts.radius;
    this.ultimate = opts.ultimate ?? false;
    this.current = LILY_MOTION.closed;
  }

  // The owner keeps the HP current (the enemy's stats).
  setHp(hp: number, maxHp: number): void {
    this.hp = hp;
    this.maxHp = maxHp;
  }

  // The sounds of the spin's bob and blast, taken by the owner (play them).
  takeSe(): number[] {
    return this.sePending.splice(0);
  }

  // The damage handler's low-HP test: hp < (maxHp >> 2).
  private lowHp(): boolean {
    return this.maxHp > 0 && this.hp < this.maxHp >> 2;
  }

  // The spit hit a player (LilyAI_SetActiveFlag_00529c78).
  spitLanded(): void {
    this.satisfiedPending = true;
  }

  // SinowberillAI_ProcessState_005282d0 at arg 0: the count, the turn and the bob.
  private spinFrame(): void {
    this.spinFrames += this.ultimate ? LILY.spinUltimateStep : 1;
    const c = this.spinFrames;
    const phase = LILY_SPIN_PHASES.find((p) => c < p.until);
    if (!phase) {
      this.spinBob = LILY.spinBobFull;
      return;
    }
    this.angle = wrap(this.angle + phase.turn * BAMS_TO_RAD);
    if (!this.spinDown) {
      const v = this.spinBob + phase.bob;
      if (v < LILY.spinBobTop) this.spinBob = v;
      else {
        // The bob turns at the top (0x41c = 1): the blow-up sound.
        this.spinDown = true;
        this.spinBob = 0x1fe - v;
        this.sePending.push(this.dark ? 0x2c6 : 0xfd);
      }
    } else {
      const v = this.spinBob - phase.bob;
      if (v < 0) {
        this.spinDown = false;
        this.spinBob = -v;
      } else this.spinBob = v;
    }
  }

  private enter(out: AiFrame, state: LilyState): void {
    const from = this.state;
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    this.dealt = false;
    this.held = -1;
    if (state === 'spin') {
      // Entered again after a flinch it keeps its count (bit 4 set).
      this.spinResume = true;
      if (!this.spinStarted) {
        this.spinStarted = true;
        this.spinFrames = 0;
        this.spinDown = true;
        this.spinBob = 0;
      }
      this.play(out, LILY_MOTION.closed);
      return;
    }
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
    if (this.state === 'dead') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    if (this.satisfiedPending && this.state !== 'scream' && this.state !== 'spin') {
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
      case 'spin': {
        // Arg 0 then the transition check (arg 3): past 450 the Lily goes to
        // its death state (10). The blast's damage is ASSUMED to be the
        // nearest player within its reach (the battle-params record at
        // 0x009bc358 is not traced); its SE is 0xfe (0x2c7 dark).
        this.spinFrame();
        if (this.spinFrames > LILY.spinLimit) {
          this.sePending.push(this.dark ? 0x2c7 : 0xfe);
          const t = nearest(targets, this.x, this.z, this.reach);
          if (t) out.hit = { clientId: t.clientId, knockback: 3, mult: 1 };
          this.exploded = true;
          this.state = 'dead';
          this.current = null;
        }
        break;
      }
      default:
        exhaustive(this.state);
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
    // unknown_lily_handle_damage_taken (arg 3): a spinning Lily spins again;
    // below max HP >> 2 it starts the spin; else the scream roll; else the
    // resume state (track).
    if (this.spinResume || this.lowHp()) this.enter(out, 'spin');
    else if (Math.fround(this.rng()) < LILY.screamChance) this.enter(out, 'scream');
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

// The side dash (state 0xc, DerolleProcessStateAttack_0051c5ac, the
// Derolle-named handler in the dump). Entry (state 4): the animation is 1 (the
// stalk motion), the dash speed 0x408 = 1.6 (0x3fcccccd), the origin is the
// wolf's position, the heading 0x438 is the wolf's heading and the dash angle
// 0x434 is heading +- 0x5000 (112.5 degrees): with a target the sign is +
// when CheckVectorCrossProduct_007829cc(facing, target - wolf) is nonzero,
// else -; without one a random float >= 0.5 (0x00921330) gives -, else +.
// Frame (state 0): the dash angle turns toward the heading by 0x100 a frame
// (ClampAngleDifference_007a8c74(0x434, 0x438, 0x100)); the goal is the origin
// plus 90 (0x0092132c) along the dash angle. Exit (state 3): no target, or the
// frame counter 0x424 past 0x96 (150), goes to the roam state 7.
// ASSUMED: the step toward the goal is the speed 1.6 (LerpFloat_0051d3c4 0.2
// was not traced); the facing turns toward the target at the stalk's rate; the
// dash's hit check (ProcessGalgryphonHitCheck_00521528(0x500, 0x40c)) and its
// sound are not ported; the state 3 speed test (0x3b4 < 0x43c, back to the
// stalk) is not ported. Entry sources: not found in the dumped code (nothing
// writes state 0xc for the wolf), so startDash is the entry for now.
export const WOLF_DASH = {
  speed: Math.fround(1.6),
  radius: 90,
  side: 0x5000,
  turnFrame: 0x100,
  frames: 0x96,
  sideChance: 0.5,
} as const;

// The howl (state 0xe, SavageWolfProcessState_0051c0ac): the animation is 0xb
// (motion 4, mode 3, speed 0.4), it plays the sound 0xd3 once the animation has
// run past 10 (check_entity_animation_elapsed_threshold), casts Zalure (tech
// 0xc) on the target at frame 30 (0x1e) and Jellen (tech 0xb) at frame 40
// (0x28) through the target's entity_hit_by_tech with power 1.0 (0x3f800000),
// and ends in the roam state 7 when the motion ends (flag 0x10 of 0xb0). It
// does not touch the other wolves: its entry's search through the pack list
// (g_DerolleEntityListHead) stores nothing. Entry: the countdown 0x41c that
// DerolleHandleStatusEffect_0051e45c (vtable slot 1) runs each tick; when it
// reaches 0 the wolf enters state 0xe unless dead. What arms 0x41c is not
// found in the dumped code (armHowl). ASSUMED: the sound's threshold is the
// motion frames the port has run (the elapsed unit is not traced).
export const WOLF_HOWL = {
  sound: 0xd3,
  soundFrames: 10,
  zalure: 30,
  jellen: 40,
} as const;

// One Jellen / Zalure cast from the howl: entity_hit_by_tech on this player.
export interface WolfCast {
  clientId: number;
  tech: 'jellen' | 'zalure';
  power: number;
}

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
  // The howl: mode 3 (once), speed 0.4 (table row 0xb, 0x009bb8b0 area).
  howl: once(4, 0.4),
};

export type WolfState = 'idle' | 'stalk' | 'leap' | 'hop' | 'dash' | 'howl' | 'dead';

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
  private dashOrigin = { x: 0, z: 0 };
  private dashHeading = 0;
  private dashAngle = 0;
  private howlSounded = false;
  // The howl's countdown (0x41c); 0 = not armed.
  private howlIn = 0;
  lift = 0;
  // Output of the howl for render/combat.ts: the Jellen / Zalure casts on
  // the players and the sound effects to play at the wolf.
  casts: WolfCast[] = [];
  sounds: number[] = [];

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
    } else if (state === 'dash') {
      // The side the dash starts on (see WOLF_DASH).
      this.dashOrigin = { x: this.x, z: this.z };
      this.dashHeading = this.angle;
      this.dashAngle = wrap(this.angle + this.dashSide(t) * WOLF_DASH.side * BAMS_TO_RAD);
      this.play(out, WOLF_MOTION.stalk);
    } else if (state === 'howl') {
      this.howlSounded = false;
      this.play(out, WOLF_MOTION.howl);
    }
  }

  // +1 or -1: the side of the heading the dash starts on.
  private dashSide(t: AiTarget | null): number {
    if (!t) return this.rng() >= WOLF_DASH.sideChance ? -1 : 1;
    const fx = Math.sin(this.angle);
    const fz = Math.cos(this.angle);
    const vx = t.x - this.x;
    const vz = t.z - this.z;
    // ASSUMED: CheckVectorCrossProduct_007829cc is nonzero when fz * vx < fx * vz.
    return fz * vx < fx * vz ? 1 : -1;
  }

  // Starts the side dash (state 0xc). The exe entry is not found yet, so this
  // is the hook for it; the returned frame carries the motion.
  startDash(t: AiTarget | null): AiFrame {
    this.targetId = t?.clientId ?? null;
    const out = this.frame();
    this.enter(out, 'dash', t);
    return this.finish(out);
  }

  // Arms the howl's countdown (0x41c): it enters state 0xe when it reaches 0.
  // The exe's arming is not found yet.
  armHowl(ticks: number): void {
    this.howlIn = ticks;
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
      case 'dash': {
        const t = this.target(targets);
        if (!t) {
          this.enter(out, 'idle', null);
          break;
        }
        // The dash angle turns toward the heading, the goal sits 90 out along it.
        this.dashAngle = turnToward(this.dashAngle, this.dashHeading, WOLF_DASH.turnFrame * BAMS_TO_RAD);
        const gx = this.dashOrigin.x + Math.sin(this.dashAngle) * WOLF_DASH.radius;
        const gz = this.dashOrigin.z + Math.cos(this.dashAngle) * WOLF_DASH.radius;
        const dx = gx - this.x;
        const dz = gz - this.z;
        const d = Math.hypot(dx, dz);
        if (d > 0) {
          const s = Math.min(d, WOLF_DASH.speed);
          this.x += (dx / d) * s;
          this.z += (dz / d) * s;
        }
        this.angle = turnToward(this.angle, this.angleTo(t), this.turn);
        if (this.timer > WOLF_DASH.frames) this.enter(out, 'idle', null);
        break;
      }
      case 'howl': {
        // SavageWolfProcessState_0051c0ac: the sound once past its threshold,
        // then the casts at frames 30 and 40 on the target (0x3e8).
        if (!this.howlSounded && this.frames > WOLF_HOWL.soundFrames) {
          this.howlSounded = true;
          this.sounds.push(WOLF_HOWL.sound);
        }
        const t = this.target(targets);
        if (t && this.timer === WOLF_HOWL.zalure) this.casts.push({ clientId: t.clientId, tech: 'zalure', power: 1 });
        if (t && this.timer === WOLF_HOWL.jellen) this.casts.push({ clientId: t.clientId, tech: 'jellen', power: 1 });
        if (animationEnded) this.enter(out, 'idle', null);
        break;
      }
      default:
        exhaustive(this.state);
    }
    // The howl's countdown (DerolleHandleStatusEffect_0051e45c): the wolf enters
    // the howl when it reaches 0 (a dead wolf returned above).
    if (this.howlIn > 0 && --this.howlIn === 0) this.enter(out, 'howl', this.target(targets));
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

// --- Monest: the wake-up and the Mothmant spawns ----------------------------
//
// handle_monest_behavior (dump 0x00519xxx, the Monest's dispatcher on +0x32e):
// 0 intro (MothmanProcessState_00519e20: six orbit pieces, the nest drops
// and rises), 1 wake-up (MonestProcessState_0051ae9c), 2 dormant
// (MothmanProcessState_00519d98), 3 spawn one (MothmanProcessState_00519d08),
// 4 flinch (00519b6c), 5 hover (00519a30), 6 spawn one (005198b4), 7 hit
// reaction (005197a0), 8 (00519550), 9 the fall (sub-entities).
//
// monest_constructor (0x005191c0) sets: the wake threshold initdata_param2
// clamped to 0..6 (MothmanSetTarget_0051a1fc: +0x398, 6 when above 5), the
// total initdata_param3 clamped to 0..30 (+0x39c), its first child's entity
// index (+0x3cc = own + 1) and the spawned count (+0x3bc).
//
// Wake-up (state 1, 0x0051ae9c): entered from the intro. Animation 0 (motion
// 14) for 61 ticks, then animation 1 (motion 11, ASSUMED 12 - animation) and
// every 10 ticks counted from the start of the state (ticks 70, 80, ...)
// spawn_mothmant_from_monest puts one Mothmant at Monest + 25 up (0x00920e68)
// until the wake count reaches the threshold; then the next state is +0x394,
// which the constructor leaves at 2 (dormant). spawn_mothmant_from_monest
// does nothing while more than 6 children are alive.
//
// Dormant (state 2, 0x00519d98): animation 0; MothmanManageSpawnLogic_00519ad0
// with batch 1 and interval 150 (0x96). Spawn one (state 3, 0x00519d08):
// animation 1, the spawn at animation frame 15, back to dormant when the
// animation ends. Hover (state 5, 0x00519a30): batch 2 and interval 120
// (0x78), set only the first time (+0x3b0 == 0); state 6 spawns one at
// animation 5 (motion 7) frame 15.
//
// MothmanManageSpawnLogic_00519ad0: while not armed it arms itself when the
// live children are at most threshold / 2 (C integer division) or when the
// hover state has been entered (+0x3b0); armed, a counter runs past the
// interval and then the pending count becomes min(batch, 6 - alive,
// total - spawned).
//
// ASSUMED: the Monest wakes up (wait -> wake) when a player is within the
// search radius 225 (the record 0x009bb764). The intro's six-piece motion is
// not modelled (deathfx / the renderer only see the nest's motion).
export const MONEST = { batch: 2, interval: 120, maxAlive: 6, spawnFrame: 15, height: 25, maxTotal: 30 } as const;
// The dormant interval and batch (state 2).
export const MONEST_DORMANT = { batch: 1, interval: 150 } as const;
// The wake-up: 61 idle ticks, then one spawn every 10 ticks.
export const MONEST_WAKE = { idleTicks: 61, every: 10 } as const;

const MONEST_MOTION = {
  wait: loop(14, 0.3), // animation 0
  wake: loop(11, 0.3), // animation 1 (ASSUMED motion 11 = 12 - animation, as the hover / spawn rows)
  hover: loop(8, 0.3), // animation 4
  spawn: once(7, 0.7), // animation 5
};

export class MonestSpawner {
  total: number;
  threshold: number;
  spawned = 0;
  // Whether the hover state (5) was ever entered: +0x3b0, the arming test.
  active = false;
  state: 'wait' | 'wake' | 'dormant' | 'spawn' | 'hover' | 'spawnHover' = 'wait';
  private armed = false;
  private counter = 0;
  private pending = 0;
  private frames = 0;
  private fired = false;
  // Ticks since the wake-up started (+0x4d0).
  private wakeTicks = 0;
  // Mothmants the wake-up put out (+0x4d4).
  private wakeSpawned = 0;
  private batch: number = 1;
  private interval: number = MONEST_DORMANT.interval;

  constructor(param2: number, param3: number) {
    this.total = Math.max(0, Math.min(MONEST.maxTotal, Math.round(param3)));
    const p2 = Math.round(param2);
    this.threshold = p2 > 5 ? 6 : p2 < 1 ? 0 : p2;
  }

  get motion(): EnemyAiMotion {
    switch (this.state) {
      case 'wait':
      case 'dormant':
        return MONEST_MOTION.wait;
      case 'wake':
        return MONEST_MOTION.wake;
      case 'hover':
        return MONEST_MOTION.hover;
      case 'spawn':
      case 'spawnHover':
        return MONEST_MOTION.spawn;
    }
  }

  private enter(state: MonestSpawner['state']): EnemyAiMotion {
    this.state = state;
    this.frames = 0;
    this.fired = false;
    if (state === 'dormant') {
      this.batch = MONEST_DORMANT.batch;
      this.interval = MONEST_DORMANT.interval;
    }
    if (state === 'hover' && !this.active) {
      this.active = true;
      this.batch = MONEST.batch;
      this.interval = MONEST.interval;
    }
    return this.motion;
  }

  // One frame. `alive` is the number of its live Mothmants. Returns the motion
  // to start (when it changed) and whether a Mothmant is spawned this frame.
  tick(alive: number, playerNear: boolean, animationEnded: boolean): { motion: EnemyAiMotion | null; spawn: boolean } {
    if (this.state === 'wait') {
      if (!playerNear) return { motion: null, spawn: false };
      this.wakeTicks = 0;
      this.wakeSpawned = 0;
      this.enter('wake');
      return { motion: MONEST_MOTION.wait, spawn: false };
    }
    if (this.state === 'wake') {
      this.wakeTicks++;
      if (this.wakeTicks <= MONEST_WAKE.idleTicks) return { motion: null, spawn: false };
      if (this.wakeTicks === MONEST_WAKE.idleTicks + 1) return { motion: MONEST_MOTION.wake, spawn: false };
      if (this.wakeTicks % MONEST_WAKE.every !== 0) return { motion: null, spawn: false };
      if (this.wakeSpawned >= this.threshold) {
        // The next state is +0x394, the dormant state (2).
        return { motion: this.enter('dormant'), spawn: false };
      }
      this.wakeSpawned++;
      const spawn = alive <= MONEST.maxAlive;
      if (spawn) this.spawned++;
      return { motion: null, spawn };
    }
    if (this.state === 'dormant' || this.state === 'hover') {
      if (!this.armed) {
        if (alive <= Math.trunc(this.threshold / 2) || this.active) {
          this.armed = true;
          this.counter = 0;
        }
      } else if (++this.counter > this.interval) {
        this.counter = 0;
        this.pending = Math.min(this.batch, MONEST.maxAlive - alive, this.total - this.spawned);
      }
      if (this.pending > 0) {
        return { motion: this.enter(this.state === 'hover' ? 'spawnHover' : 'spawn'), spawn: false };
      }
      return { motion: null, spawn: false };
    }
    // spawn / spawnHover: one child at animation frame 15, then back.
    this.frames += MONEST_MOTION.spawn.speed;
    let spawn = false;
    if (!this.fired && this.frames >= MONEST.spawnFrame) {
      this.fired = true;
      this.pending--;
      if (alive <= MONEST.maxAlive && this.spawned < this.total) {
        this.spawned++;
        spawn = true;
      }
    }
    if (animationEnded && this.fired) {
      const next = this.state === 'spawnHover' ? 'hover' : 'dormant';
      return { motion: this.enter(next), spawn };
    }
    return { motion: null, spawn };
  }
}

// --- Mothmant: its own state machine ----------------------------------------
//
// unknown_handle_mothmant_behavior (dump 0x00516xxx..0x00518xxx, the
// Mothmant's dispatcher on +0x32e): 0 launch (HildebearProcessState_0051845c),
// 1 wander (HildebearProcessState_00518144), 2 chase
// (HildebearProcessState_00517b28), 3 attack (HildebearProcessState_0051784c),
// 4 swoop (HildebearProcessState_0051738c), 5 hover (HildebearProcessState_00517200),
// 6 flinch (HildebearProcessState_00516fbc), 7 the ground kill
// (00516ed8), 8 the fall (00516c60), 9 the dead flag (EnemySetStateFlag_00516c2c).
// The death states are not run here: the kill and the fall are deathfx.ts /
// the owner's (EnemyOnKilledHandler_0051f894).
//
// Constructor (Mothman_Constructor_00518bfc): state 0 is entered at once.
// Distances are world units and angles BAMS in the dump; the constants below
// are the float / integer literals of those functions (addresses in the
// comments; exedata.py reads the float32 values).
export const MOTHMANT = {
  detect: 200, // 0x00920c08: FindEnemyTarget_00520ea0(200) in wander and hover
  leash: 450, // 0x00920cc4: the chase and attack give up beyond this
  attackRange: 100, // 0x00920bf0: the chase decides attack / swoop inside it
  launchFrames: 41, // 0x29 = 0x0051845c: state 0 flies this many ticks first
  launchDrag: Math.fround(0.9), // 0x00920bd8: the launch velocity's decay
  gravity: Math.fround(0.1), // 0x00921680 = -0.1 added to the vertical velocity
  accel: Math.fround(0.1), // 0x00920bdc: the approach speed ramps by this per tick
  approachMax: Math.fround(2), // 0x00920bd0: the approach speed stops at 2.0
  bob: Math.fround(10), // 0x00920be4: the wander / hover height sine amplitude
  wanderRandom: 512, // 0x00920be8: the wander phase offset is random +-512 BAMS
  height: 15, // 0x00920ba0 + 2 * random (0x0051735c / 0x00518bfc): flying height
  heightJitter: 2, // 0x00920ba4 / 0x00920b9c
  strikeFrame: 9, // 9.0 (0x0051784c): the strike lands at animation frame 9
  strikes: 4, // 0x448 < 4: four strikes per attack
  // ASSUMED: the wind-up before a strike is g_MothmantAnimSpeedParams+0x1c
  // (a battleparams row not decoded); 20 ticks is the placeholder.
  windup: 20,
  // ASSUMED: the ring around the spawn point (g_HildebearSwordMoveAmplitude,
  // a global set from the battleparams that was not decoded).
  ringRadius: 20,
  swoopArc: 0x8000, // the swoop ends after half a turn (+0x3d4 > 0x8000, BAMS)
} as const;

const MOTHMANT_MOTION = {
  fly: loop(10, 0.6), // animation 1 / 0 fly
  strike: once(0, 1), // the attack motion (the profile's attack row)
  flinch: once(3, 1),
};

export type MothmantState = 'launch' | 'wander' | 'chase' | 'attack' | 'swoop' | 'hover' | 'dead';

// The Mothmant's own states. The brain sees its siblings through `siblingsOn`:
// HildebearCheckEntityCount_0051a924 counts the live children of the same
// Monest that already target a player (fewer than 2, or 4 in Ultimate, may
// attack that player).
export class MothmantAi extends BrainBase {
  state: MothmantState = 'launch';
  private detect: number;
  private turn: number;
  private reach: number;
  private speed: number;
  private home: { x: number; z: number };
  private phase: number;
  private hover: number;
  private timer = 0;
  private approach = 0;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private height: number;
  private strike = 0;
  private sub: 'idle' | 'windup' | 'strike' = 'idle';
  private sweep = 0;
  private sweepStep = 0;
  private siblingsOn: (clientId: number, self: MothmantAi) => number;
  private hitDone = false;
  lift = 0;

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    detect?: number;
    turnRate: number;
    speed: number;
    attack: EnemyAttackData | null;
    radius: number;
    siblingsOn?: (clientId: number, self: MothmantAi) => number;
    rng?: () => number;
    // The height above the ground at spawn (a Monest's child: 25 above it).
    spawnLift?: number;
  }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.detect = opts.detect ?? MOTHMANT.detect;
    this.turn = opts.turnRate * BAMS_TO_RAD;
    this.speed = opts.speed;
    this.reach = (opts.attack?.distanceX ?? 0) + opts.radius;
    this.home = { x: opts.x, z: opts.z };
    this.phase = this.rng() * Math.PI * 2;
    this.hover = MOTHMANT.height + (this.rng() * 2 - 1) * MOTHMANT.heightJitter;
    this.height = opts.spawnLift ?? MOTHMANT.height;
    this.lift = this.height;
    this.siblingsOn = opts.siblingsOn ?? (() => 0);
    // create_mothmant's launch velocity is not decoded: ASSUMED a random
    // sideways throw that the launch decays.
    this.vx = (this.rng() * 2 - 1) * 1;
    this.vz = (this.rng() * 2 - 1) * 1;
    this.vy = 0.5;
    this.current = MOTHMANT_MOTION.fly;
  }

  private enter(out: AiFrame, state: MothmantState, t: AiTarget | null): void {
    this.state = state;
    this.timer = 0;
    this.sub = 'idle';
    this.hitDone = false;
    if (state === 'wander') {
      this.targetId = null;
      this.approach = 0;
      this.phase = wrap(this.phase + this.rng() * 0.5);
    } else if (state === 'hover') {
      this.targetId = null;
    } else if (state === 'chase') {
      this.approach = 0;
      if (t) this.angle = this.angleTo(t);
    } else if (state === 'attack') {
      this.strike = 0;
    } else if (state === 'swoop') {
      this.sweep = 0;
      // sub 0 of the swoop picks the sweep rate: +- 65536 * speed / 439.82 BAMS
      // (0x00920c28 / 0x00920c24, the half of the coin in 0x00920c2c).
      const dv = Math.round((65536 * this.speed) / 439.8228759765625) * (this.rng() <= 0.5 ? 1 : -1);
      this.sweepStep = dv * BAMS_TO_RAD;
    }
    this.play(out, MOTHMANT_MOTION.fly);
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.timer++;
    switch (this.state) {
      case 'launch': {
        // 0x0051845c sub 0: the throw decays for 41 ticks (vx, vz * 0.9, vy - 0.1).
        if (this.timer <= MOTHMANT.launchFrames) {
          this.x += this.vx;
          this.z += this.vz;
          this.height += this.vy;
          this.vx *= MOTHMANT.launchDrag;
          this.vz *= MOTHMANT.launchDrag;
          this.vy -= MOTHMANT.gravity;
          this.lift = this.height;
          break;
        }
        // sub 1: fly to the ring point at the spawn (accelerating by 0.1 to 2.0),
        // sub 2 arrives and the wander starts.
        const ang = this.phase;
        const gx = this.home.x + Math.sin(ang) * MOTHMANT.ringRadius;
        const gz = this.home.z + Math.cos(ang) * MOTHMANT.ringRadius;
        const dx = gx - this.x;
        const dz = gz - this.z;
        const d = Math.hypot(dx, dz);
        this.approach = Math.min(MOTHMANT.approachMax, this.approach + MOTHMANT.accel);
        if (d <= this.approach) {
          this.x = gx;
          this.z = gz;
          this.enter(out, 'wander', null);
          break;
        }
        this.angle = Math.atan2(dx, dz);
        this.x += (dx / d) * this.approach;
        this.z += (dz / d) * this.approach;
        this.lift = this.hover;
        break;
      }
      case 'wander': {
        const t = nearest(targets, this.x, this.z, this.detect);
        if (t) {
          this.targetId = t.clientId;
          this.enter(out, 'chase', t);
          break;
        }
        this.phase = wrap(this.phase + 0.02);
        this.x = this.home.x + Math.sin(this.phase) * MOTHMANT.ringRadius;
        this.z = this.home.z + Math.cos(this.phase) * MOTHMANT.ringRadius;
        this.angle = wrap(this.phase + Math.PI / 2);
        this.lift = this.hover + Math.sin(this.timer * 0.1) * MOTHMANT.bob * 0.1;
        break;
      }
      case 'hover': {
        const t = nearest(targets, this.x, this.z, this.detect);
        if (t) {
          this.targetId = t.clientId;
          this.enter(out, 'chase', t);
          break;
        }
        this.lift = this.hover + Math.sin(this.timer * 0.1) * MOTHMANT.bob * 0.1;
        if (this.timer > 300) this.enter(out, 'wander', null);
        break;
      }
      case 'chase': {
        const t = this.target(targets);
        if (!t || this.dist(t) > MOTHMANT.leash) {
          this.enter(out, 'hover', null);
          break;
        }
        const d = this.dist(t);
        if (d < MOTHMANT.attackRange) {
          // The attack needs fewer than 2 siblings on this player; otherwise
          // the swoop takes it around (ASSUMED: the retarget loop is not run).
          this.enter(out, this.siblingsOn(t.clientId, this) < 2 ? 'attack' : 'swoop', t);
          break;
        }
        this.angle = turnToward(this.angle, this.angleTo(t), this.turn);
        this.approach = Math.min(this.speed, this.approach + MOTHMANT.accel);
        this.x += Math.sin(this.angle) * this.approach;
        this.z += Math.cos(this.angle) * this.approach;
        this.lift = this.hover;
        break;
      }
      case 'attack': {
        const t = this.target(targets);
        if (!t) {
          this.enter(out, 'hover', null);
          break;
        }
        this.angle = turnToward(this.angle, this.angleTo(t), this.turn);
        if (this.sub === 'idle') {
          if (this.dist(t) < MOTHMANT.attackRange) {
            this.sub = 'windup';
            this.timer = 0;
          }
        } else if (this.sub === 'windup') {
          if (this.timer >= MOTHMANT.windup) {
            this.sub = 'strike';
            this.timer = 0;
            this.hitDone = false;
            this.play(out, MOTHMANT_MOTION.strike);
          }
        } else if (!this.hitDone && this.timer >= MOTHMANT.strikeFrame) {
          this.hitDone = true;
          if (this.dist(t) <= this.reach) {
            out.hit = { clientId: t.clientId, knockback: ATTACK_KNOCKBACK, mult: ATTACK_DAMAGE_MULT };
          }
        }
        if (this.sub === 'strike' && animationEnded) {
          this.strike++;
          this.sub = 'idle';
          this.timer = 0;
          if (this.strike >= MOTHMANT.strikes) this.enter(out, 'swoop', t);
          else this.play(out, MOTHMANT_MOTION.fly);
        }
        break;
      }
      case 'swoop': {
        // A half turn around the target at the approach speed (ASSUMED: the
        // dive's three sub-steps are not decoded beyond the arc).
        const t = this.target(targets);
        if (!t) {
          this.enter(out, 'hover', null);
          break;
        }
        this.sweep += Math.abs(this.sweepStep);
        const side = this.sweepStep < 0 ? -1 : 1;
        this.angle = turnToward(this.angle, this.angleTo(t) + side * Math.PI / 2, this.turn);
        this.x += Math.sin(this.angle) * this.speed;
        this.z += Math.cos(this.angle) * this.speed;
        this.lift = this.hover;
        if (this.sweep >= MOTHMANT.swoopArc * BAMS_TO_RAD) this.enter(out, 'chase', t);
        break;
      }
      default:
        exhaustive(this.state);
    }
    out.lift = this.lift;
    return this.finish(out);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    this.lift = this.hover;
    this.current = null;
  }

  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    this.enter(out, this.targetId !== null ? 'chase' : 'wander', null);
    return this.state;
  }
}

// Mothmant (MothmanConstructor_005168a4 -> 0x00518bfc, table 0x009bb5c0,
// record 0x009bb614: search 225, turn 1536). The generic FSM uses these rows
// for the Mothmants the Monest spawned before MothmantAi.
export const MOTHMANT_PROFILE = {
  idle: loop(10, 0.6),
  walk: loop(10, 0.6),
  notice: null,
  attacks: [once(0, 1)],
} as const;
// ASSUMED: the height a Mothmant flies at above the ground (0x00920ba0 = 15
// plus a random 2 (0x00920ba4) in the constructor; which state reads it was
// not traced).
export const MOTHMANT_FLY_HEIGHT = 15;

export type { AiState };
