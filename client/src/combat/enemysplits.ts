// The Caves enemies that split (PsoBB.exe, Ephinea 1.25.13, addresses are
// VAs): Pan Arms with its halves Hidoom / Migium, and the Pofuilly Slime.
// Same EnemyBrain shape as combat/enemyfsm.ts; render/combat.ts spawns the
// child entities and keeps their HP. Neither family is decompiled in
// psobb-client-source (no matching function there), so every value below is
// from the Ghidra dump / a headless decompile of the Ephinea exe.

import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyAiMotion } from './enemyai.ts';
import type { EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, loop, nearest, once, turnToward, wrap } from './enemyfsm.ts';
import { EnemyShot, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { exhaustive } from '../exhaustive.ts';
import { bamsSin } from './derollefins.ts';

const BAMS = BAMS_TO_RAD;

// --- Pan Arms (the combined form) ------------------------------------------------
//
// Ctor 0x00582ef4 (vtable 0x00b07860), motion table 0x009bf220, state table
// 0x009bf2e0 ({init, update} pairs). MovementData row 0x31: iparam1 the
// emerge radius (at least 5), iparam2 the most frames it stays buried (at
// least 0), fparam2 / fparam3 the shockwave / bolt power (group-0 tech hits).
//   1 buried (init 0x00583d48, update 0x0058106c): back at the spawn point,
//     untargetable, drawn -1.2 * 33 under the ground; the timer (+0x390 =
//     iparam2) counts down; while it is >= 0 a player within iparam1 makes
//     it face that player and emerge, and once it runs out it emerges anyway.
//   2 emerge: vy 7.5, -0.5 a frame, lands -> 3.
//   3 walk (init 0x00583c1c): the side flag (+0x394) toggles; animation 2
//     (motion 30) on side 1, 1 (motion 29) on side 0; walks (+0x404) + 1;
//     timer (int(rand * 1.99) + 1) * 49.999996. Animation frames 0-12 turn
//     0x100 a frame toward the nearest player within 200, aiming +-0x1800 by
//     side (no offset when timer < 50 or the player is within 30); frames
//     14-20 side-step sin((f - 14) * 0x8000 / 6) * 1.5 while within 500 of
//     the spawn point. No player within 500 -> 1. The first time HP <= max / 3,
//     or walks > 2 -> 9. Timer out: side 0 -> 7 (visits + 1, spins 0), side 1 -> 5.
//   5/6 shockwave: animations 6 (motion 5) then 7 (motion 3), shot type 0;
//     90 frames -> 3.
//   7/8 bolt: animations 8 (motion 4) then 9 (motion 2), shot type 1; then
//     visits odd or spins > 3 -> 3, else 13 (spin 30 frames at +-0x111,
//     spins + 1 -> 7): every second visit fires 5 volleys.
//   9: animation 10 (motion 8) -> 10.
//   10 split: untargetable; timer 900; the halves start; HP = their sum every
//     frame; both halves dead -> 6x76 only, no EXP. Timer 0: a half attacking
//     -> retry in 15, else the merge point is the halves' midpoint, heading
//     toward Migium + 0x4000, and both halves walk there (their state 3).
//     Timer < 0 with both halves aligned (their state 4, timer < 0) and
//     neither confused -> 11; timer < -300 -> halves back to roaming, 900.
//   11 merge: HP = sum, halves -> 5; 64 frames -> 12; a half down -> 10.
//   12: targetable, animation 10 -> 3.
//   death: animation 4 (motion 12) or 5 (motion 15) by front / back; the
//     hidden halves stay hidden and never die with it.
//   damage handler 0x00582dd4: sound only, no flinch (superArmor).
export const PAN = {
  buriedDepth: -1.2 * 33,
  minEmergeRadius: 5,
  emergeVy: 7.5,
  gravity: 0.5,
  search: 200,
  leash: 500,
  turn: 0x100,
  aim: 0x1800,
  close: 30,
  sideStep: 1.5,
  walkTimer: Math.fround(49.999996),
  maxWalks: 2,
  shockFrames: 90,
  spinFrames: 30,
  spinTurn: 0x111,
  maxSpins: 3,
  splitTimer: 900,
  retry: 15,
  giveUp: -300,
  mergeFrames: 64,
} as const;

// Motion table 0x009bf220: animation -> BML motion, speed.
const PAN_ANIM = {
  wait: loop(23, 0.7),
  walk0: once(29, 0.6),
  walk1: once(30, 0.6),
  shock1: once(5, 0.7),
  shock2: once(3, 0.9),
  bolt1: once(4, 0.6),
  bolt2: once(2, 0.8),
  split: once(8, 0.6),
  deathFront: once(12, 0.7),
  deathBack: once(15, 0.7),
};

// Shot type 0 (shockwave): radius 5 growing 1.0417 a frame, 2.8 a frame
// forward, 12 frames; each player once.
export const PAN_WAVE = { radius: 5, grow: 1.0417, speed: 2.8, frames: 12 } as const;
// Shot type 1 (bolt): radius 5, 10 a frame, 12 frames; the first player.
export const PAN_BOLT = { radius: 5, speed: 10, frames: 12 } as const;

export class PanArmsShot extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook;
  private vx: number;
  private vz: number;
  private radius: number;
  private touched = new Set<number>();
  readonly kind: 'wave' | 'bolt';

  constructor(kind: 'wave' | 'bolt', x: number, z: number, angle: number, power: number) {
    super(x, 10, z);
    this.kind = kind;
    const speed = kind === 'wave' ? PAN_WAVE.speed : PAN_BOLT.speed;
    this.vx = Math.sin(angle) * speed;
    this.vz = Math.cos(angle) * speed;
    this.radius = kind === 'wave' ? PAN_WAVE.radius : PAN_BOLT.radius;
    this.effect = { kind: 'tech', power: Math.max(0, power) };
    this.look = kind === 'wave' ? { color: 0xc0a0ff, size: 3 } : { color: 0xffe060, size: 1.5 };
  }

  get size(): number {
    return this.radius;
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.z += this.vz;
    if (this.kind === 'wave') this.radius += PAN_WAVE.grow;
    const hits = this.within(targets, this.radius).filter((t) => !this.touched.has(t.clientId));
    for (const t of hits) this.touched.add(t.clientId);
    if (this.frames >= (this.kind === 'wave' ? PAN_WAVE.frames : PAN_BOLT.frames)) this.done = true;
    if (this.kind === 'bolt' && hits.length) {
      this.done = true;
      return hits.slice(0, 1);
    }
    return hits;
  }
}

export type PanState = 'buried' | 'emerge' | 'walk' | 'shock' | 'bolt' | 'spin' | 'splitting' | 'split' | 'merge' | 'rejoin' | 'dead';

export type PanEvent =
  | { kind: 'emerged' } // it rose out of the ground (owner: a log line)
  | { kind: 'split' } // the halves take over (owner: spawn / show them, HP)
  | { kind: 'merged' } // the halves are gone again (owner: HP = sum, hide them)
  | { kind: 'lost' }; // both halves died while split (owner: 6x76 only)

export class PanArmsAi extends BrainBase {
  state: PanState = 'buried';
  readonly superArmor = true;
  hpFraction = 1; // the owner keeps it current
  halves: PanHalfAi[] = []; // [Hidoom, Migium], set by the owner
  events: PanEvent[] = [];
  lift: number = PAN.buriedDepth;
  private spawnX: number;
  private spawnZ: number;
  private emergeRadius: number;
  private buriedWait: number;
  private wavePower: number;
  private boltPower: number;
  private side = 0;
  private walks = 0;
  private visits = 0;
  private spins = 0;
  private splitOnce = false;
  private timer = 0;
  private sub = 0;
  private animFrame = 0;
  private vy = 0;
  private spinDir = 1;

  constructor(opts: { x: number; z: number; angle: number; movement: EnemyMovementData | null; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    const mv = opts.movement;
    this.emergeRadius = Math.max(mv?.iparam[0] ?? 0, PAN.minEmergeRadius);
    this.buriedWait = Math.max(mv?.iparam[1] ?? 0, 0);
    this.wavePower = Math.max(mv?.fparam2 ?? 0, 0);
    this.boltPower = Math.max(mv?.fparam3 ?? 0, 0);
    this.current = PAN_ANIM.wait;
    this.timer = this.buriedWait;
  }

  // The lock flag (+0x3e4). ASSUMED initial value false (the ctor is not traced).
  lockable = false;

  // The radar icon (exe 0x00580b2c: state != 0 and (+0x3e4 set and state != 4, or state 1)).
  // State 4 is ASSUMED to be the death state (its entry 0x00582d60 runs the death clean-up).
  get radar(): boolean {
    return this.state === 'buried' || (this.lockable && this.state !== 'dead');
  }

  // enable_reticle runs while +0x3e4 is set (0x00580b2c, every state but 0).
  get lockOn(): boolean {
    return this.lockable;
  }

  // The hit: NOT PROVEN. The Pan Arms family never calls SetEnemyInvulnerableAndImmune (no
  // 0x53fdf0 call in 0x580000..0x58a000); its entries clear bit 0 of the sub-object at +0x398
  // (+0x18) in states 1, 2, 9, 10, 11, 12. This rule is the port's earlier one, ASSUMED.
  get untargetable(): boolean {
    return this.invulnerable;
  }

  get invulnerable(): boolean {
    return this.state === 'buried' || this.state === 'emerge' || this.state === 'splitting' || this.state === 'split' || this.state === 'merge';
  }

  get hidden(): boolean {
    return this.state === 'split' || this.state === 'merge';
  }

  get deathMotion() {
    return PAN_ANIM.deathFront; // ASSUMED: the front death (no attacker angle here)
  }

  private enter(out: AiFrame, s: PanState): void {
    this.state = s;
    // The lock flag (+0x3e4, read by DerolleUpdateStateTransition 0x00580b2c): the entries of
    // 2 (emerge, 0x583cf8) and 12 (rejoin, 0x5835ac) set it, 10 (split, DerolleOnHit 0x583720)
    // and 11 (merge, DerolleHandleHit 0x583648) clear it. The other entries keep it (sticky).
    if (s === 'emerge' || s === 'rejoin') this.lockable = true;
    else if (s === 'split' || s === 'merge') this.lockable = false;
    this.timer = 0;
    this.sub = 0;
    this.animFrame = 0;
    if (s === 'walk') {
      this.side ^= 1;
      this.walks++;
      this.timer = Math.trunc((Math.trunc(this.rng() * 1.99) + 1) * PAN.walkTimer);
      this.play(out, this.side ? PAN_ANIM.walk1 : PAN_ANIM.walk0);
    } else if (s === 'shock') {
      this.timer = PAN.shockFrames;
      this.play(out, PAN_ANIM.shock1);
    } else if (s === 'bolt') this.play(out, PAN_ANIM.bolt1);
    else if (s === 'spin') {
      this.timer = PAN.spinFrames;
      this.spinDir = this.side ? 1 : -1;
    } else if (s === 'splitting' || s === 'rejoin') this.play(out, PAN_ANIM.split);
    else if (s === 'split') this.timer = PAN.splitTimer;
    else if (s === 'merge') this.timer = PAN.mergeFrames;
    else if (s === 'emerge') this.vy = PAN.emergeVy;
    else if (s === 'buried') {
      this.timer = this.buriedWait;
      this.x = this.spawnX;
      this.z = this.spawnZ;
      this.lift = PAN.buriedDepth;
      this.warps++;
    }
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return this.finish(out);
    this.animFrame += this.current?.speed ?? 0;
    const t = nearest(targets, this.x, this.z, PAN.search);
    switch (this.state) {
      case 'buried': {
        this.lift = PAN.buriedDepth;
        if (--this.timer >= 0) {
          const p = nearest(targets, this.x, this.z, this.emergeRadius);
          if (!p) break;
          this.angle = this.angleTo(p);
        }
        this.enter(out, 'emerge');
        this.events.push({ kind: 'emerged' });
        break;
      }
      case 'emerge':
        this.lift += this.vy;
        this.vy -= PAN.gravity;
        if (this.vy < 0 && this.lift >= 0) {
          this.lift = 0;
          this.enter(out, 'walk');
        }
        break;
      case 'walk': {
        if (!nearest(targets, this.x, this.z, PAN.leash)) {
          this.enter(out, 'buried');
          this.play(out, PAN_ANIM.wait);
          break;
        }
        // The owner gives it its two halves; without them it cannot split.
        if (this.halves.length === 2 && ((!this.splitOnce && this.hpFraction <= 1 / 3) || this.walks > PAN.maxWalks)) {
          this.splitOnce = true;
          this.walks = 0; // ASSUMED: the split starts the count over
          this.enter(out, 'splitting');
          break;
        }
        const f = this.animFrame;
        if (t && f <= 12) {
          const offset = this.timer < 50 || Math.hypot(t.x - this.x, t.z - this.z) < PAN.close ? 0 : (this.side ? 1 : -1) * PAN.aim;
          this.angle = turnToward(this.angle, this.angleTo(t) + offset * BAMS, PAN.turn * BAMS);
        } else if (f >= 14 && f <= 20 && Math.hypot(this.x - this.spawnX, this.z - this.spawnZ) < PAN.leash) {
          const step = Math.sin((f - 14) * (0x8000 / 6) * BAMS) * PAN.sideStep;
          const s = this.side ? 1 : -1;
          this.x += Math.cos(this.angle) * step * s;
          this.z -= Math.sin(this.angle) * step * s;
        }
        if (animationEnded) {
          this.animFrame = 0;
          this.play(out, this.side ? PAN_ANIM.walk1 : PAN_ANIM.walk0);
        }
        if (--this.timer <= 0) {
          if (this.side === 0) {
            this.visits++;
            this.spins = 0;
            this.enter(out, 'bolt');
          } else this.enter(out, 'shock');
        }
        break;
      }
      case 'shock':
        if (this.sub === 0 && animationEnded) {
          this.sub = 1;
          this.play(out, PAN_ANIM.shock2);
          // ASSUMED: the wave leaves as the second animation starts.
          out.shots = [new PanArmsShot('wave', this.x, this.z, this.angle, this.wavePower)];
        }
        if (--this.timer <= 0) this.enter(out, 'walk');
        break;
      case 'bolt':
        if (this.sub === 0 && animationEnded) {
          this.sub = 1;
          this.play(out, PAN_ANIM.bolt2);
          out.shots = [new PanArmsShot('bolt', this.x, this.z, this.angle, this.boltPower)];
        } else if (this.sub === 1 && animationEnded) {
          if (this.visits % 2 === 1 || this.spins > PAN.maxSpins) this.enter(out, 'walk');
          else this.enter(out, 'spin');
        }
        break;
      case 'spin':
        this.angle = wrap(this.angle + this.spinDir * PAN.spinTurn * BAMS);
        if (--this.timer <= 0) {
          this.spins++;
          this.enter(out, 'bolt');
        }
        break;
      case 'splitting':
        if (animationEnded) {
          this.enter(out, 'split');
          this.events.push({ kind: 'split' });
          for (const h of this.halves) h.start(this.x, this.z, this.angle);
        }
        break;
      case 'split':
        this.tickSplit(out);
        break;
      case 'merge': {
        if (this.halves.some((h) => h.state === 'dead')) {
          this.enter(out, 'split');
          for (const h of this.halves) if (h.state !== 'dead') h.roam();
          break;
        }
        if (this.timer === PAN.mergeFrames) for (const h of this.halves) h.merging();
        if (--this.timer <= 0) {
          for (const h of this.halves) h.hide();
          this.events.push({ kind: 'merged' });
          this.enter(out, 'rejoin');
        }
        break;
      }
      case 'rejoin':
        if (animationEnded) this.enter(out, 'walk');
        break;
      default:
        exhaustive(this.state);
    }
    out.lift = this.lift;
    out.hidden = this.hidden;
    return this.finish(out);
  }

  private tickSplit(out: AiFrame): void {
    const [hid, mig] = this.halves;
    if (!hid || !mig) return;
    if (hid.state === 'dead' && mig.state === 'dead') {
      this.state = 'dead';
      this.events.push({ kind: 'lost' });
      return;
    }
    this.timer--;
    if (this.timer === 0) {
      if (hid.state === 'attack' || mig.state === 'attack' || hid.state === 'dead' || mig.state === 'dead') {
        // ASSUMED: a dead half also keeps the merge off (it cannot walk).
        this.timer = PAN.retry;
        return;
      }
      const mx = (hid.x + mig.x) / 2;
      const mz = (hid.z + mig.z) / 2;
      const heading = Math.atan2(mig.x - mx, mig.z - mz) + 0x4000 * BAMS;
      this.x = mx;
      this.z = mz;
      this.angle = wrap(heading);
      hid.mergeAt(mx, mz, this.angle);
      mig.mergeAt(mx, mz, this.angle);
    } else if (this.timer < 0) {
      if (hid.aligned && mig.aligned && !hid.confused && !mig.confused) {
        this.enter(out, 'merge');
        this.timer = PAN.mergeFrames;
      } else if (this.timer < PAN.giveUp) {
        hid.roam();
        mig.roam();
        this.timer = PAN.splitTimer;
      }
    }
  }

  onDamage(clientId: number): void {
    if (this.state !== 'dead') this.targetId = clientId;
  }

  resume(): string {
    return this.state;
  }
}

// --- Hidoom / Migium (the halves) --------------------------------------------------
//
// Ctor 0x00586bf8 (vtable 0x00b07a60), motion tables 0x009bf440 (Hidoom) /
// 0x009bf4e0 (Migium), state table 0x009bf580, models 1 / 2 of the Pan Arms
// BML. Slots: Hidoom = Pan Arms + 1, Migium = + 2 (newserv's separate slots).
// MovementData rows 0x32 / 0x33: Hidoom's hit power = fparam2; Migium's
// Jellen / Zalure chances = fparam2 / fparam3 (clamped 0..1), their levels
// iparam2 / iparam3; Hidoom's Resta level = Migium's iparam1.
//   c1 split: HP = (Pan HP + 1) / 2; offsets right 14.851 / -14.1604, forward
//     -5.1765 / -5.2659 of the Pan Arms; heading +-26578.
//   c2 roam: waits rand * 60 + 15, then speed + 0.025 up to 0.6 / 0.3, turn
//     0x208, toward the flank point 75 off the target; search 500, leash 500;
//     a target within 100 / 80 inside +-0x400: within 27.5 -> c10, else c9.
//     Hidoom at half its split HP -> c12; the sibling dies -> c16; Migium
//     with Hidoom in c12 -> c13 (or c10 within 27.5).
//   c3 / c4 merge walk: the merge point + right +-17.3438, forward 5.6544,
//     heading -+10558; speed up to 0.6, down to 0.3 within 15; arrives at
//     7.5; c4 aligns over 22 frames.
//   c5: merge animation 8 -> c0 (hidden).
//   c6 flinch: animation 5; not in c0 / c1 / c5 / c6.
//   c7 death: animation 7 or 6, 164 frames.
//   c9 charge: 90 frames, speed + 0.075 up to 1.25, turn 0x101; within 25 -> c11.
//   c10 back off: rand * 30 + 15 frames at speed -1.
//   c11 attack: animation 3, the hit at frame 12: Hidoom a tech hit (power
//     fparam2); Migium Jellen (0x006e7998), else Zalure (0x006f1eb0), else a
//     tech hit of power 0.
//   c12-c15: Hidoom calls (150 frames); Migium runs to it (within 25 -> c14,
//     the touch); Hidoom casts Resta (0x006eeeb4) on itself at timer -15.
//   c16 mourn: 60 frames.
export const HALF = {
  splitHeading: 26578,
  hidoomOffset: { right: 14.851, forward: -5.1765 },
  migiumOffset: { right: -14.1604, forward: -5.2659 },
  waitBase: 15,
  waitRand: 60,
  accel: 0.025,
  hidoomSpeed: 0.6,
  migiumSpeed: 0.3,
  turn: 0x208,
  flank: 75,
  search: 500,
  leash: 500,
  hidoomReach: 100,
  migiumReach: 80,
  arc: 0x400,
  tooClose: 27.5,
  mergeRight: 17.3438,
  mergeForward: 5.6544,
  mergeHeading: 10558,
  mergeSpeed: 0.6,
  mergeSlow: 0.3,
  mergeSlowWithin: 15,
  mergeArrive: 7.5,
  alignFrames: 22,
  chargeFrames: 90,
  chargeAccel: 0.075,
  chargeSpeed: 1.25,
  chargeTurn: 0x101,
  attackWithin: 25,
  backoffBase: 15,
  backoffRand: 30,
  hitFrame: 12,
  callFrames: 150,
  healAt: -15,
  touchWithin: 25,
  mournFrames: 60,
} as const;

const HALF_ANIM = {
  hidoom: { wait: loop(24, 0.8), walk: loop(27, 0.7), run: loop(21, 1), attack: once(0, 0.8), call: once(20, 0.8), flinch: once(10, 1.3), deathBack: once(13, 0.7), death: once(16, 0.7), merge: once(18, 0.7), split: once(6, 0.6) },
  // Migium's animation 4 is empty (mode 0): it has no call.
  migium: { wait: loop(25, 0.8), walk: loop(28, 0.7), run: loop(22, 1), attack: once(1, 0.8), call: loop(25, 0.8), flinch: once(11, 1.3), deathBack: once(14, 0.7), death: once(17, 0.7), merge: once(19, 0.7), split: once(7, 0.6) },
};

export type HalfState = 'hidden' | 'split' | 'roam' | 'mergeWalk' | 'align' | 'merging' | 'charge' | 'backoff' | 'attack' | 'call' | 'help' | 'touch' | 'mourn' | 'dead';

export interface HalfBuff {
  clientId: number;
  tech: 'jellen' | 'zalure';
  level: number;
}

export class PanHalfAi extends BrainBase {
  state: HalfState = 'hidden';
  confused = false;
  hpFraction = 1; // of the HP it was given at the split (the owner keeps it)
  sibling: PanHalfAi | null = null;
  aligned = false;
  touched = false; // Hidoom: Migium reached it during the call
  buff: HalfBuff | null = null; // Migium's last debuff (also in AiFrame.buff)
  private anim: (typeof HALF_ANIM)['hidoom'];
  private spawnX: number;
  private spawnZ: number;
  private speed = 0;
  private timer = 0;
  private dealt = false;
  private frames = 0;
  private called = false;
  private mourned = false;
  private mergeX = 0;
  private mergeZ = 0;
  private mergeAngle = 0;
  private power: number;
  private jellen: number;
  private zalure: number;
  private jellenLevel: number;
  private zalureLevel: number;
  readonly restaLevel: number;
  readonly kind: 'hidoom' | 'migium';

  constructor(kind: 'hidoom' | 'migium', opts: { x: number; z: number; angle: number; movement: EnemyMovementData | null; restaLevel?: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.kind = kind;
    this.anim = HALF_ANIM[kind];
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    const mv = opts.movement;
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    this.power = Math.max(0, mv?.fparam2 ?? 0);
    this.jellen = kind === 'migium' ? clamp01(mv?.fparam2 ?? 0) : 0;
    this.zalure = kind === 'migium' ? clamp01(mv?.fparam3 ?? 0) : 0;
    this.jellenLevel = mv?.iparam[1] ?? 0;
    this.zalureLevel = mv?.iparam[2] ?? 0;
    this.restaLevel = opts.restaLevel ?? 0;
    this.current = this.anim.wait;
  }

  get hidden(): boolean {
    return this.state === 'hidden';
  }

  get untargetable(): boolean {
    return this.hidden;
  }

  get invulnerable(): boolean {
    return this.state === 'hidden' || this.state === 'split' || this.state === 'merging';
  }

  get flinchMotion() {
    return this.anim.flinch;
  }

  get deathMotion() {
    return this.anim.death; // ASSUMED: the front death
  }

  flinches(): boolean {
    return !(this.state === 'hidden' || this.state === 'split' || this.state === 'merging');
  }

  private maxSpeed(): number {
    return this.kind === 'hidoom' ? HALF.hidoomSpeed : HALF.migiumSpeed;
  }

  // c1: the Pan Arms at (x, z) facing `angle` splits.
  start(x: number, z: number, angle: number): void {
    if (this.state === 'dead') return;
    const o = this.kind === 'hidoom' ? HALF.hidoomOffset : HALF.migiumOffset;
    this.x = x + Math.cos(angle) * o.right + Math.sin(angle) * o.forward;
    this.z = z - Math.sin(angle) * o.right + Math.cos(angle) * o.forward;
    this.angle = wrap(angle + (this.kind === 'hidoom' ? 1 : -1) * HALF.splitHeading * BAMS);
    this.warps++;
    this.spawnX = this.x;
    this.spawnZ = this.z;
    this.state = 'split';
    this.aligned = false;
    this.called = false;
    this.touched = false;
    this.current = this.anim.split;
    this.pending = this.anim.split;
  }

  private pending: ReturnType<typeof loop> | null = null;

  roam(): void {
    if (this.state === 'dead') return;
    this.state = 'roam';
    this.aligned = false;
    this.speed = 0;
    this.timer = Math.trunc(this.rng() * HALF.waitRand + HALF.waitBase);
    this.current = this.anim.wait;
    this.pending = this.anim.wait;
  }

  mergeAt(x: number, z: number, angle: number): void {
    if (this.state === 'dead') return;
    const s = this.kind === 'hidoom' ? 1 : -1;
    this.mergeX = x + Math.cos(angle) * HALF.mergeRight * s + Math.sin(angle) * HALF.mergeForward;
    this.mergeZ = z - Math.sin(angle) * HALF.mergeRight * s + Math.cos(angle) * HALF.mergeForward;
    this.mergeAngle = wrap(angle - s * HALF.mergeHeading * BAMS);
    this.state = 'mergeWalk';
    this.aligned = false;
    this.speed = 0;
    this.current = this.anim.walk;
    this.pending = this.anim.walk;
  }

  merging(): void {
    if (this.state === 'dead') return;
    this.state = 'merging';
    this.current = this.anim.merge;
    this.pending = this.anim.merge;
  }

  hide(): void {
    if (this.state === 'dead') return;
    this.state = 'hidden';
    this.aligned = false;
  }

  private go(out: AiFrame, s: HalfState): void {
    this.state = s;
    this.frames = 0;
    this.dealt = false;
    if (s === 'roam') {
      this.speed = 0;
      this.timer = Math.trunc(this.rng() * HALF.waitRand + HALF.waitBase);
      this.play(out, this.anim.wait);
    } else if (s === 'charge') {
      this.timer = HALF.chargeFrames;
      this.play(out, this.anim.run);
    } else if (s === 'backoff') {
      this.timer = Math.trunc(this.rng() * HALF.backoffRand + HALF.backoffBase);
      this.play(out, this.anim.walk);
    } else if (s === 'attack') this.play(out, this.anim.attack);
    else if (s === 'call') {
      this.timer = HALF.callFrames;
      this.touched = false;
      this.play(out, this.anim.call);
    } else if (s === 'help') this.play(out, this.anim.run);
    else if (s === 'touch') this.play(out, this.anim.attack); // ASSUMED: the touch reuses the attack swing
    else if (s === 'mourn') {
      this.timer = HALF.mournFrames;
      this.play(out, this.anim.wait);
    }
  }

  private move(sign = 1): void {
    this.x += Math.sin(this.angle) * this.speed * sign;
    this.z += Math.cos(this.angle) * this.speed * sign;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    this.buff = null;
    if (this.pending) {
      this.play(out, this.pending);
      this.pending = null;
    }
    if (this.state === 'dead' || this.state === 'hidden') {
      out.hidden = this.state === 'hidden';
      return this.finish(out);
    }
    this.frames += this.current?.speed ?? 0;
    let t = this.target(targets);
    if (!t || this.dist(t) > HALF.search) {
      t = nearest(targets, this.x, this.z, HALF.search);
      this.targetId = t?.clientId ?? null;
    }
    const sib = this.sibling;
    if (sib?.state === 'dead' && !this.mourned && this.state !== 'mergeWalk' && this.state !== 'align' && this.state !== 'merging') {
      this.mourned = true;
      this.go(out, 'mourn');
    }
    switch (this.state) {
      case 'split':
        if (animationEnded) this.go(out, 'roam');
        break;
      case 'roam': {
        if (this.kind === 'hidoom' && !this.called && this.hpFraction <= 0.5) {
          this.called = true;
          this.go(out, 'call');
          break;
        }
        if (this.kind === 'migium' && sib?.state === 'call' && !sib.touched) {
          this.go(out, t && this.dist(t) < HALF.tooClose ? 'backoff' : 'help');
          break;
        }
        if (this.timer > 0) {
          this.timer--;
          break;
        }
        if (this.current !== this.anim.walk) this.play(out, this.anim.walk);
        this.speed = Math.min(this.maxSpeed(), this.speed + HALF.accel);
        let wantX = this.spawnX;
        let wantZ = this.spawnZ;
        if (t && Math.hypot(this.x - this.spawnX, this.z - this.spawnZ) < HALF.leash) {
          // ASSUMED: the flank point is 75 to the target's side (Hidoom right, Migium left).
          const a = this.angleTo(t);
          const s = this.kind === 'hidoom' ? 1 : -1;
          wantX = t.x + Math.cos(a) * HALF.flank * s;
          wantZ = t.z - Math.sin(a) * HALF.flank * s;
          const reach = this.kind === 'hidoom' ? HALF.hidoomReach : HALF.migiumReach;
          if (this.dist(t) <= reach && Math.abs(wrap(a - this.angle)) <= HALF.arc * BAMS) {
            this.go(out, this.dist(t) < HALF.tooClose ? 'backoff' : 'charge');
            break;
          }
        }
        this.angle = turnToward(this.angle, Math.atan2(wantX - this.x, wantZ - this.z), HALF.turn * BAMS);
        this.move();
        break;
      }
      case 'charge':
        this.speed = Math.min(HALF.chargeSpeed, this.speed + HALF.chargeAccel);
        if (t) this.angle = turnToward(this.angle, this.angleTo(t), HALF.chargeTurn * BAMS);
        this.move();
        if (t && this.dist(t) < HALF.attackWithin) this.go(out, 'attack');
        else if (--this.timer <= 0) this.go(out, 'roam');
        break;
      case 'backoff':
        this.speed = 1;
        this.move(-1);
        if (--this.timer <= 0) this.go(out, 'roam');
        break;
      case 'attack':
        if (!this.dealt && this.frames >= HALF.hitFrame) {
          this.dealt = true;
          if (t && this.dist(t) <= HALF.attackWithin) this.strike(out, t);
        }
        if (animationEnded) this.go(out, 'roam');
        break;
      case 'call':
        this.timer--;
        if (this.timer === HALF.healAt) {
          if (this.touched) out.heal = { level: this.restaLevel };
          this.go(out, 'roam');
        }
        break;
      case 'help': {
        if (!sib || sib.state !== 'call') {
          this.go(out, 'roam');
          break;
        }
        this.speed = Math.min(HALF.hidoomSpeed, this.speed + HALF.accel); // ASSUMED: it runs at Hidoom's speed
        this.angle = turnToward(this.angle, Math.atan2(sib.x - this.x, sib.z - this.z), HALF.turn * BAMS);
        this.move();
        if (Math.hypot(sib.x - this.x, sib.z - this.z) < HALF.touchWithin) {
          sib.touched = true;
          this.go(out, 'touch');
        }
        break;
      }
      case 'touch':
        if (animationEnded) this.go(out, 'roam');
        break;
      case 'mourn':
        if (--this.timer <= 0) this.go(out, 'roam');
        break;
      case 'mergeWalk': {
        const d = Math.hypot(this.mergeX - this.x, this.mergeZ - this.z);
        const max = d < HALF.mergeSlowWithin ? HALF.mergeSlow : HALF.mergeSpeed;
        this.speed = Math.min(max, this.speed + HALF.accel);
        this.angle = turnToward(this.angle, Math.atan2(this.mergeX - this.x, this.mergeZ - this.z), HALF.turn * BAMS);
        this.move();
        if (d < HALF.mergeArrive) {
          this.state = 'align';
          this.timer = HALF.alignFrames;
          this.play(out, this.anim.wait);
        }
        break;
      }
      case 'align':
        this.angle = turnToward(this.angle, this.mergeAngle, Math.abs(wrap(this.mergeAngle - this.angle)) / Math.max(1, this.timer));
        if (--this.timer <= 0) {
          this.angle = this.mergeAngle;
          this.aligned = true;
        }
        break;
      case 'merging':
        break;
      default:
        exhaustive(this.state);
    }
    out.hidden = this.hidden;
    return this.finish(out);
  }

  // c11's hit frame.
  private strike(out: AiFrame, t: AiTarget): void {
    if (this.kind === 'hidoom') {
      out.techHit = { clientId: t.clientId, power: this.power };
      return;
    }
    if (this.rng() < this.jellen) this.buff = { clientId: t.clientId, tech: 'jellen', level: this.jellenLevel };
    else if (this.rng() < this.zalure) this.buff = { clientId: t.clientId, tech: 'zalure', level: this.zalureLevel };
    else out.techHit = { clientId: t.clientId, power: 0 };
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead' || this.state === 'hidden') return;
    this.targetId = clientId;
  }

  resume(): string {
    if (this.state === 'roam' || this.state === 'charge' || this.state === 'backoff' || this.state === 'attack' || this.state === 'touch' || this.state === 'help') {
      this.roam();
    }
    return this.state;
  }
}

// --- Pofuilly Slime ------------------------------------------------------------------
//
// The set's head slot is an invisible control (0x005959fc); the slimes are
// slots + 1 + k, k < min(num_children or 4, 4); only k = 0 is built at the
// start and a dead slot is never reused, so a set has at most 4 slimes ever.
// Slime ctor 0x00596000 (vtable 0x00b094e0), motion table 0x009bfc80, state
// table 0x009bfc00. Radii (0x0059970e): 500, 200, 50, 15.
//   0 puddle (0x00596650): every 15 + rand * 15 frames a player within 200
//     -> 1; five misses snap it back to its spawn point.
//   1 rise (0x0059670c): 1/30 a frame; then a player within 200 -> 3, else 2.
//   2 sink (0x00596884): 1/90 a frame -> 0.
//   3 crawl (0x00597c3c / 0x005969cc): no player within 200, or the point
//     within 15 -> 2; it creeps 50 + rand * 20, speed up to 2.5 (+ 0.25 *
//     0.5 * (sin + 0.5) a frame, - 0.25 to stop); then a player within 50
//     farther than 15 -> 4, else 3 again.
//   4 emerge (0x00597dbc): morph 9 -> 7 when confused, else 6.
//   5 burrow (0x00597e1c): morph 10 -> 3.
//   6 search (0x00597e7c / 0x00596d38): it turns +-0x400 a frame for
//     round(rand * 4) + 4 turns (0x600 a frame off the count) and locks the
//     first player within 162.5 inside +-0x1c71; then 8 when locked, else 5.
//   7 confused (0x00597f2c): turns +-0x888 for 30 + rand * 30 -> 9.
//   8 approach (0x00597fc0 / 0x00597094): 30 + rand * 30 frames, turn 0x200
//     (facing within 0x200 ends it), 0.2 a frame; then within 50 and
//     rand >= 0.45 -> 10, else 9.
//   9 spit (0x0059802c / 0x00597274): 90 frames, the glob at frame 19
//     (0x00597314) -> 7 when confused, else 5.
//   10 arm (0x00598070): an arm (0x00598368) rises 2.5 + rand * 5 from the
//     target; 90 frames -> 5.
//   12 flinch (0x005985c4, every hit not already in 12) -> 5.
//   13 death (0x00598648). 14 thrown (0x00598740 / 0x005975e0): lands -> 1.
// Splits (both throw a copy into the first free slot, 10 above it, a random
// direction, state 14): a landed physical hit by a player on combo step 2
// (0x00597914, the took-damage handler at vtable +0x100: `unknown_get_current_combo_step`
// of the last hitter == 2, state != 12, the slot scan over the control's slots),
// and Gibarta / Rabarta (0x005987c8, the technique group 2, before the hit).
// The box flags (the sub-object's +0x18; SetEnemyInvulnerableAndImmune_0053fdf0 sets 0x28):
// the entries of 0 (0x597b0c), 1 (0x597ba0), 2 (0x597bec), 3 (0x597c3c: 0xa000028), 4 (0x597dbc),
// 5 (0x597e1c), 12, 13 and 14 set them; the entries of 6..11 (0x597e7c, 0x597f2c, 0x597fc0,
// 0x59802c, 0x598070, 0x59856c) clear them. The set is the complement of `lockable`.
// The puddle (state 0, 0x00597b0c) is morph 7: its motion is DAT_009bfda0[rare]
// (4 normal, 5 rare, the exe table), so the puddle is drawn as that pose; the
// sink / crawl / thrown states keep the body hidden (ASSUMED).
export const SLIME = {
  outer: 500,
  near: 200,
  close: 50,
  min: 15,
  puddleWait: 15,
  misses: 5,
  riseFrames: 30,
  sinkFrames: 90,
  crawlBase: 50, // 0x00597c3c: the budget 50 + rand * 20
  crawlRand: 20,
  crawlMax: 2.5, // 0x009292e4 (0x40200000)
  crawlAccel: 0.25, // 0x009292e8: the ramp is 0.5 * (sin + 0.5) * this, the stop is this
  crawlTurn: 0x100, // 0x005969cc: the heading (+0x60) turns 0x100 a frame, no target
  crawlPhase: 0xc00, // the ramp's phase (+0x3a4) steps only while the budget lasts
  crawlSteps: 14, // the trial steps of a frame (esi = 1..14)
  crawlSweep: 0x1000, // trial i turns the direction by +-(i << 12) (odd i: minus)
  crawlSeek: 200, // 0x00597c3c: the target search of the entry (0x00a745dc)
  crawlPush: 15, // 0x00a745e4: the entry's random push of the direction
  crawlTurnRange: 1048575, // 0x009294d4: the entry's random angle, truncated, read mod 0x10000
  crawlMinDir: 0.01, // 0x009294d0: the direction's length must be above this
  crawlProbe: 15, // the probe starts 5 above the step's y (0x00929534) and FUN_007b4c58 adds 10 (0x0097e3e4)
  crawlPull: 0.5, // 0x009292e0: the step's y moves this far to the ground
  crawlLeave: 50, // 0x00a745e0 (0x42480000): the end-of-frame target search
  crawlLeaveMin: 15, // 0x00a745e4 (0x41700000): the emerge needs a distance above this
  searchTurn: 0x400,
  searchSpin: 0x600,
  searchRadius: (200 - 50) * 0.75 + 50,
  searchArc: 0x1c71,
  searchFace: 0x280,
  searchHold: 30, // ASSUMED: the wait after the sweep (a motion length)
  confusedTurn: 0x888,
  approachTurn: 0x200,
  approachSpeed: 0.2,
  armChance: 0.45,
  spitFrames: 0x5a,
  spitAt: 0x13, // the glob 19 frames into the state (+0x39c)
  armFrames: 0x5a,
  armBase: 2.5, // 0x00598070: the arm point's distance 2.5 + rand * 5 (0x00a74574 / 0x00a74578)
  armRand: 5,
  armAngle: 65536, // 0x009294a4: the arm point's angle, a full turn
  armStep: 10, // 0x00a7457c: the walk's step
  armMinDir: 0.01, // 0x0092949c: shorter walks use +x
  armProbeY: 5, // 0x009294a8: the wall test's end is 5 above the body
  morphFrames: 20, // ASSUMED: the emerge / burrow morph lengths
  throwHeight: 10,
  deathFrames: 5, // the death entry's counter (0x00598648 sets +0x398 = 5)
} as const;

// Spit glob 0x0059738c: from 20 up and 15 ahead, 0.6 a frame forward,
// -0.05 gravity, bounce * -0.975, for 200 / 0.6 frames; power = the slime's
// MovementData fparam1 (at least 0).
export const SPIT = { up: 20, ahead: 15, speed: 0.6, gravity: -0.05, bounce: -0.975, range: 200, radius: 5 } as const;

export class SlimeSpit extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0x60c040, size: 2 };
  private vx: number;
  private vz: number;
  private vy = 0;
  private life = Math.round(SPIT.range / SPIT.speed);

  constructor(x: number, z: number, angle: number, power: number) {
    super(x + Math.sin(angle) * SPIT.ahead, SPIT.up, z + Math.cos(angle) * SPIT.ahead);
    this.vx = Math.sin(angle) * SPIT.speed;
    this.vz = Math.cos(angle) * SPIT.speed;
    this.effect = { kind: 'tech', power: Math.max(0, power) };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.z += this.vz;
    this.vy += SPIT.gravity;
    this.y += this.vy;
    if (this.y <= 0) {
      this.y = 0;
      this.vy *= SPIT.bounce;
    }
    // ASSUMED: it hits a player while low enough to touch one (20 units).
    const hit = this.y <= SPIT.up ? this.within(targets, SPIT.radius)[0] : undefined;
    if (hit || this.frames >= this.life) this.done = true;
    return hit ? [hit] : [];
  }
}

// The arm sub-entity (0x00598420 constructor, vtable 0x00b097a0, motion 6): its
// update 0x00598db0 (vtable +4) runs the hit 0x00598f1c while the arm's stats
// are set. The hit (0x00598f1c) only runs while the animation frame (+0xc0) is
// 17..30 (0x00929350 / 0x0092934c). It takes the nearest player within 25
// (0x00a745a4, EnemyGetNearestTargetInRange) and hits it when that player is not
// the lock (+0x384, 0xffff at the spawn) and the arm's height is within 5 of the
// player's (0x00a745a8; the player's height +0xe3c is ASSUMED 0 here) and the
// XZ distance is within 7.5 (0x00a745ac). The hit then sets the lock to that
// player, so a player is hit once per change of the lock id.
// Branch B (the closest other entity, 0x0077170c, found within 25 and hit within
// 7.5 of the arm, the vtable +0x60 / +0x68 every frame of the window) is ported:
// the search keeps the monsters (ids 0x1000..0x3fff) and the arm itself is left out
// (flag 0x2000000 while it searches); the hit goes to the enemy path (render/combat.ts
// enemyHitsEnemy). ASSUMED: the search's type-1 test is every live enemy, the 7.5
// is measured on the XZ plane, and no cooldown is kept (the exe hits each frame).
// The arm's hit uses the slime's melee AttackData (ASSUMED), not entity_hit_by_tech.
export const ARM = { from: 17, to: 30, range: 25, radius: 7.5, height: 5, life: 45 } as const;

export class SlimeArm extends EnemyShot {
  readonly effect: ShotEffect = { kind: 'melee', mult: 1, knockback: 0 }; // ASSUMED: a plain hit with the slime's AttackData
  readonly look: ShotLook = { color: 0x80e060, size: 2.5 };
  // The lock (+0x384): the client id of the player the arm last hit.
  private lock: number | null = null;

  constructor(x: number, z: number, y = 0) {
    super(x, y, z);
  }

  // Branch A (0x00598f1c, the nearest player within 25, the lock) and branch B
  // (after it, every frame of the window): the closest other enemy within 25 (the
  // search 0x0077170c; the arm itself is excluded, the owner is not in `monsters`),
  // hit when it is within 7.5 on the XZ plane. Both hits go out together.
  tick(targets: readonly AiTarget[], monsters: readonly AiTarget[] = []): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    if (this.frames >= ARM.life) this.done = true;
    if (this.frames < ARM.from || this.frames > ARM.to) return [];
    const hits: AiTarget[] = [];
    const near = nearest(targets, this.x, this.z, ARM.range);
    if (near && near.clientId !== this.lock) {
      const dy = this.y - (near.y ?? 0);
      if (dy >= -ARM.height && dy <= ARM.height && (near.x - this.x) ** 2 + (near.z - this.z) ** 2 <= ARM.radius * ARM.radius) {
        this.lock = near.clientId;
        hits.push(near);
      }
    }
    const mon = nearest(monsters, this.x, this.z, ARM.range);
    if (mon && (mon.x - this.x) ** 2 + (mon.z - this.z) ** 2 <= ARM.radius * ARM.radius) hits.push(mon);
    return hits;
  }
}

// 'stun' is the exe's state 11 (entry 0x0059856c, update 0x00597514; the writer is the
// vtable slot +0xfc, 0x00597ae4, see `SlimeAi.pendingHit`).
// The particle the stun makes every 4th count (0x0050b510 with the effect id 0xe0).
const STUN_EFFECT = 0xe0;
export type SlimeState = 'puddle' | 'rise' | 'sink' | 'crawl' | 'emerge' | 'burrow' | 'search' | 'confused' | 'approach' | 'spit' | 'arm' | 'flinch' | 'thrown' | 'dead' | 'stun';

const SLIME_ANIM = {
  wait: loop(10, 0.5), // animation 0
  look: loop(10, 0.5), // animation 1 (chains to 2, motion 13)
  spit: once(2, 0.8), // animation 3
  hurt: once(3, 0.8), // animation 5
  stun: once(8, 0.8), // animation 4 (row 4 of 0x009bfc80: mode 3, motion 8, speed 0.8; 0x0059856c)
};

// The body's transform (PsoBB.exe 0x00596264, the slime's draw, vtable +0x08):
// +0x3a8 the alpha (nothing is drawn at or below 0, blended below 1), +0x3ac the
// height added to y, +0x3b0 / +0x3b4 / +0x3b8 the scale x / y / z. The rise
// (0x0059670c) and the sink (0x00596884) write one curve from the progress t
// (+0x3a0) and the wobble sin(count << 12) (count = +0x398, one step a frame):
// height -2.5 (1 - t), sy = t, sx = (2.5 - 1.5 t)(1 + w), sz = (2.5 - 1.5 t)(1 - w),
// w = sin * f * k with f = 1, or (1 - t) / 0.2 above t = 0.8, and k = 0.1 (rise)
// or 0.15 (sink); alpha = 2t below t = 0.5, else 1. Constants: 0x00929564 -2.5,
// 0x00929558 2.5, 0x00929570 -1.5, 0x009292d0 / 0x009292dc 0.8, 0x0092956c /
// 0x00929548 0.2, 0x009292cc 0.1, 0x009292d8 0.15, 0x00929568 / 0x00929544 2.0,
// 0x009292c8 0.5. The rise steps t by 1/30 (0x00a7453c), the sink by -1/90 (0x00a74544).
export const SLIME_XF = {
  low: -2.5, // the height under the ground (the rise and puddle entries)
  scaleBase: 2.5,
  scaleSlope: -1.5,
  edge: 0.8,
  edgeDiv: 0.2,
  alphaCut: 0.5,
  riseWobble: 0.1,
  sinkWobble: 0.15,
  deathFade: 0.2, // 0x00597594: +0x3a8 -= 0.2 a frame (0x00929300), floored at 0 (0x0092950c)
} as const;

export interface SlimeXf {
  alpha: number;
  height: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface SlimeView extends SlimeXf {
  morph: number;
  tail: boolean;
}

// The sub-object's animation id (+4, set by 0x00599c7c in each state's entry)
// picks the meshes drawn (0x00599ef0): 0..6 the body, 7 and 8 one model, 9..11
// the body and the tail (a second part). The rise has no entry write: it keeps
// the puddle's 7 (the value is the same from the thrown landing).
export const SLIME_MORPH: Readonly<Record<SlimeState, number>> = {
  puddle: 7,
  rise: 7,
  sink: 7,
  crawl: 8,
  emerge: 9,
  burrow: 10,
  search: 1,
  confused: 1,
  approach: 0,
  spit: 3,
  arm: 0,
  flinch: 5,
  thrown: 7,
  dead: 5,
  stun: 4, // 0x0059856c: morph 4 (EnemyLoadAnimationOrModel_00599c7c(4))
};

const HIDDEN_STATES: ReadonlySet<SlimeState> = new Set(['sink', 'crawl', 'thrown']);
// The states whose entry writes +0x3f4 = 1 (PsoBB.exe: search 0x597f1a, confused 0x597fb1,
// approach 0x59801b, spit 0x598061, arm 0x598338 (the arm entry 0x598070..0x598368), stun
// 0x5985b5). The other entries write 0 (0x597b86 puddle ... 0x5987bb thrown).
const RETICLE_STATES: ReadonlySet<SlimeState> = new Set(['search', 'confused', 'approach', 'spit', 'arm', 'stun']);
// DAT_009bfda0[rare]: the puddle morph's BML motion (exe 0x00597b0c -> 0x00599c7c(7)).
export const PUDDLE_MOTION = { normal: 4, rare: 5 } as const;
// ASSUMED: the puddle pose plays at the wait rate (the spawn motion's 0.5).
const PUDDLE_SPEED = 0.5;

// The map queries the crawl needs (render/combat.ts wires them to the map).
// Heights are relative to the floor under the body at the frame's start (0 there),
// so the body's `lift` is its height over the floor it stands on. ground returns
// the floor under (x, z) probed from fromY, or null for none; wall is true when
// the segment from -> to hits a wall (FUN_00780d3c).
export type SlimeGround = (x: number, z: number, fromY: number) => number | null;
export type SlimeWall = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => boolean;

// The split's gate (0x00597914, the took-damage handler, vtable +0x100, reached from the
// generic enemy path when +0x30 & 0x200 is set): a landed hit (damage) by a player
// (the local one; `comboStep` is the attacker's combo step, +0xc of its attack info) on
// combo step 2 splits the slime unless it is already in state 12 (flinch) or the hit
// kills it (the is_dead branch, 0x104). ASSUMED: the hitter is the local player.
export function slimeSplitsOnHit(state: SlimeState, comboStep: number | undefined, damage: number, byPlayer: boolean, dead: boolean): boolean {
  return byPlayer && damage >= 1 && comboStep === 2 && state !== 'flinch' && !dead;
}

export class SlimeAi extends BrainBase {
  state: SlimeState = 'puddle';
  confused = false;
  hits = 0; // landed hits (the owner compares it around a special attack)
  lift = 0;
  private spawnX: number;
  private spawnZ: number;
  private power: number;
  private timer = 0;
  private misses = 0;
  private level = 0;
  private sweep = 0;
  private turnDir = 1;
  private budget = 0;
  private speed = 0;
  private phase = 0;
  // The crawl's direction (0x3c0 / 0x3c4 / 0x3c8, unit length, kept between frames).
  private dirX = 0;
  private dirY = 0;
  private dirZ = 0;
  private locked = false;
  private fired = false;
  private vx = 0;
  private vz = 0;
  private vy = 0;
  // The body transform (SLIME_XF), the sub-object form (SLIME_MORPH) and the
  // wobble step (+0x398). The puddle's entry values are the defaults.
  private xf: SlimeXf = { alpha: 0, height: SLIME_XF.low, sx: 0, sy: 0, sz: 0 };
  private morph = SLIME_MORPH.puddle;
  private count = 0;
  private deathLeft = 0;
  // Effects the owner makes this frame (the stun's 0xe0 every 4th count); the owner
  // takes them with splice.
  readonly effects: { id: number; dy: number }[] = [];

  private readonly puddleMotion: number;
  private readonly ground: SlimeGround;
  private readonly wall: SlimeWall;

  // ground / wall default to flat open ground (ASSUMED for a test without a map).
  constructor(opts: { x: number; z: number; angle: number; movement: EnemyMovementData | null; thrown?: boolean; throwAngle?: number | undefined; rare?: boolean; rng?: () => number; ground?: SlimeGround; wall?: SlimeWall }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.power = Math.max(0, opts.movement?.fparam1 ?? 0);
    this.ground = opts.ground ?? (() => 0);
    this.wall = opts.wall ?? (() => false);
    this.puddleMotion = opts.rare ? PUDDLE_MOTION.rare : PUDDLE_MOTION.normal;
    this.current = SLIME_ANIM.wait;
    if (opts.thrown) this.throwFrom(opts.x, opts.z, opts.throwAngle);
    else {
      this.current = { index: this.puddleMotion, speed: PUDDLE_SPEED, loop: true };
      this.timer = this.puddleWait();
    }
  }

  get hidden(): boolean {
    return HIDDEN_STATES.has(this.state);
  }

  // The radar icon (PsoBB.exe SinowzoaUpdate_00596104: unknown_add_minimap_icon runs every
  // frame while field_0x38c != 0xd, the death state 13): the puddle, the burrow and the emerge
  // are on the radar too. render/combat.ts minimapEnemies reads it.
  get radar(): boolean {
    return this.state !== 'dead';
  }

  // +0x3f4 != 0 (the entries' flag above). SinowzoaUpdate (0x00596104, 0x00596168) then calls
  // enable_reticle (0x006946a8) for the slime: check_enemy_is_targetable fills the players'
  // targeting records only inside that call, so the slime is a lock-on / technique target
  // of a player only in these states. SinowzoaClearControlFlag (0x00596248) clears bit 0x1
  // of the sub-object's flags (+0x18) when +0x3f4 is 0; the bit is set again each frame at
  // 0x005961d4 (not modelled: its readers are not traced).
  get lockable(): boolean {
    return RETICLE_STATES.has(this.state);
  }

  // The box is off (0x28 set, see the table above): the slime is not struck, and the hit
  // shows "0" (render/combat.ts applyEnemyHit). ASSUMED: the hit test reads the 0x28 bits.
  get invulnerable(): boolean {
    return !this.lockable;
  }

  // What render/combat.ts draws (slimeView): the body's transform and alpha,
  // and the tail part in the forms 9..11 (0x00599ef0).
  get view(): SlimeView {
    return { ...this.xf, morph: this.morph, tail: this.morph >= 9 };
  }

  get flinchMotion() {
    return SLIME_ANIM.hurt;
  }

  get deathMotion() {
    return SLIME_ANIM.hurt;
  }

  flinches(): boolean {
    return this.state !== 'flinch';
  }

  private puddleWait(): number {
    return Math.round(this.rng() * SLIME.puddleWait) + SLIME.puddleWait;
  }

  // State 14 from (x, z): ASSUMED a 1.0 a frame hop in the heading `angle` (a split
  // passes the exe's random BAMS heading; a random one otherwise), 2.5 up, 0.2 gravity.
  private throwFrom(x: number, z: number, angle?: number): void {
    const a = angle ?? this.rng() * Math.PI * 2;
    this.x = x;
    this.z = z;
    this.warps++;
    this.vx = Math.sin(a);
    this.vz = Math.cos(a);
    this.vy = 2.5;
    this.lift = SLIME.throwHeight;
    this.state = 'thrown';
    // 0x00598740 (state 14): height -2.5, scale 0, alpha 0, morph 7.
    this.xf = { alpha: 0, height: SLIME_XF.low, sx: 0, sy: 0, sz: 0 };
    this.morph = SLIME_MORPH.thrown;
  }

  private enter(out: AiFrame, s: SlimeState, targets: readonly AiTarget[] = []): void {
    this.state = s;
    this.fired = false;
    switch (s) {
      case 'puddle':
        // 0x00597b0c: height -2.5, scale 0, alpha 0, morph 7 (the puddle is
        // not drawn: the body draw returns at alpha 0, 0x00596264).
        this.xf = { alpha: 0, height: SLIME_XF.low, sx: 0, sy: 0, sz: 0 };
        this.morph = SLIME_MORPH.puddle;
        this.timer = this.puddleWait();
        this.play(out, { index: this.puddleMotion, speed: PUDDLE_SPEED, loop: true });
        break;
      case 'rise':
        // 0x00597ba0: t = 0, height -2.5. ASSUMED: the wobble count starts at
        // 0 (the puddle's timer ran out at 0; the thrown landing keeps its own).
        this.level = 0;
        this.count = 0;
        this.xf.height = SLIME_XF.low;
        this.timer = SLIME.riseFrames;
        break;
      case 'sink':
        // 0x00597bec: t = 1, height 0, morph 7.
        this.level = 1;
        this.xf.height = 0;
        this.morph = SLIME_MORPH.sink;
        this.timer = SLIME.sinkFrames;
        break;
      case 'crawl': {
        // 0x00597c3c: the nearest target within 200 (none -> sink). The direction
        // is the offset to it plus 15 in a random XZ direction (the angle is
        // int(rand * 0x9294d4) read mod 0x10000), normalised; a length of 0.01 or
        // less -> sink. ASSUMED: the offset's height is 0 (the port has no
        // absolute body height). The budget is 50 + rand * 20.
        const t = nearest(targets, this.x, this.z, SLIME.crawlSeek);
        if (!t) {
          this.enter(out, 'sink');
          return;
        }
        const th = (Math.trunc(this.rng() * SLIME.crawlTurnRange) % 0x10000) * BAMS;
        const dx = t.x - this.x + SLIME.crawlPush * Math.sin(th);
        const dz = t.z - this.z + SLIME.crawlPush * Math.cos(th);
        const len = Math.hypot(dx, dz);
        if (len <= SLIME.crawlMinDir) {
          this.enter(out, 'sink');
          return;
        }
        this.dirX = dx / len;
        this.dirY = 0;
        this.dirZ = dz / len;
        this.budget = this.rng() * SLIME.crawlRand + SLIME.crawlBase;
        this.speed = 0;
        // 0x00597c3c: alpha 1, morph 8. The crawl is drawn (the body is not hidden).
        this.xf.alpha = 1;
        this.morph = SLIME_MORPH.crawl;
        break;
      }
      case 'emerge':
      case 'burrow':
        this.morph = s === 'emerge' ? SLIME_MORPH.emerge : SLIME_MORPH.burrow;
        this.timer = SLIME.morphFrames;
        this.play(out, SLIME_ANIM.wait);
        break;
      case 'search':
        this.targetId = null;
        this.locked = false;
        this.timer = Infinity;
        this.turnDir = this.rng() > 0.5 ? -1 : 1;
        this.sweep = Math.round(4 * this.rng()) * 0x10000 + 0x40000;
        this.morph = SLIME_MORPH.search;
        this.play(out, SLIME_ANIM.look);
        break;
      case 'confused':
        this.turnDir = this.rng() > 0.5 ? -1 : 1;
        this.timer = Math.round(30 * this.rng()) + 30;
        this.morph = SLIME_MORPH.confused;
        this.play(out, SLIME_ANIM.look);
        break;
      case 'approach':
        this.timer = Math.round(30 * this.rng()) + 30;
        this.morph = SLIME_MORPH.approach;
        this.play(out, SLIME_ANIM.wait);
        break;
      case 'spit':
        this.timer = SLIME.spitFrames;
        this.morph = SLIME_MORPH.spit;
        this.play(out, SLIME_ANIM.spit);
        break;
      case 'arm':
        this.timer = SLIME.armFrames;
        this.morph = SLIME_MORPH.arm;
        this.play(out, SLIME_ANIM.wait);
        break;
      case 'flinch':
        // 0x005985c4: scale 1, morph 5.
        this.xf.sx = this.xf.sy = this.xf.sz = 1;
        this.morph = SLIME_MORPH.flinch;
        this.play(out, SLIME_ANIM.hurt);
        break;
      case 'stun':
        // 0x0059856c: scale 1, the counter (+0x39c) to 0, morph 4 (the sub-object's +4), then
        // EnemyLoadAnimationOrModel_00599c7c(4) sets the animation slot +0xb8 = 4: row 4 of the
        // motion table 0x009bfc80 (mode 3, motion 8, speed 0.8). Only this entry loads slot 4.
        // +0x3f4 = 1 (`lockable`).
        this.xf.sx = this.xf.sy = this.xf.sz = 1;
        this.timer = 0;
        this.morph = SLIME_MORPH.stun;
        this.play(out, SLIME_ANIM.stun);
        break;
    }
  }

  // The exe's vtable slot +0xfc of the slime (0x00597ae4), called by the generic
  // enemy path (0x00543efb) when +0x30 has 0x100 and the slot +0x88 test is off
  // (0x00777ba4: +0x30 & 0x200, took_damage, which runs the flinch 0x100 slot):
  // unless the slime is already in state 11, it enters it and clears 0x100.
  // The writer of 0x100 is EntityHitEntity_00773350 when the attack does no damage
  // (the defence roll resists it, 0x773397; or the damage is negative, 0x7738af),
  // and the other hit paths that set it (0x76e8b3, 0x773221, 0x775fd4, 0x776171,
  // 0x776370, 0x777614) are not traced. hitNoDamage is the port's side of that.
  pendingHit(out: AiFrame): void {
    if (this.state === 'stun' || this.state === 'dead') return;
    this.enter(out, 'stun');
  }

  // A player's attack that does no damage to the slime (ASSUMED the port's
  // `!landed`, i.e. the exe's no-damage path; an enemy's defence is 0, so the
  // defence roll (formulas.ts defenceResists) never resists it): enters state 11
  // and returns the motion to play.
  hitNoDamage(): EnemyAiMotion | null {
    const out = this.frame();
    this.pendingHit(out);
    return out.motion;
  }

  // The rise (k = 0.1) and the sink (k = 0.15) frames (0x0059670c, 0x00596884):
  // the curves of SLIME_XF from the progress before its step, then the wobble
  // count steps (+0x398).
  private curves(k: number): void {
    const t = this.level;
    const f = t > SLIME_XF.edge ? (1 - t) / SLIME_XF.edgeDiv : 1;
    const w = bamsSin(this.count << 12) * f * k;
    const z = SLIME_XF.scaleBase + SLIME_XF.scaleSlope * t;
    this.xf.sx = z * (1 + w);
    this.xf.sz = z * (1 - w);
    this.xf.sy = t;
    this.xf.height = SLIME_XF.low * (1 - t);
    this.xf.alpha = t < SLIME_XF.alphaCut ? 2 * t : 1;
    this.count++;
  }

  // 0x00598070 (state 10's entry; the whole walk runs in one frame). The arm point
  // is the target's XZ plus (sin, cos) of a random angle (65536 a turn) at 2.5 + rand
  // * 5 (the distance is drawn first). The body walks to it in steps of 10: n =
  // round(length / 10) probes, from the body's spot. A probe needs a floor under it
  // (probed from 15 above, the crawl's probe) and no wall from the body to it (the
  // probe 5 above the body). A failed probe -> spit (9). Otherwise the arm is made at
  // the point (0x00598368). A zero walk -> burrow (5). ASSUMED: the walk is in XZ (the
  // heights of the arm point and the body are not compared), and each probe is one
  // step further along the direction (FUN_0082ebac).
  private armWalk(out: AiFrame, t: AiTarget): void {
    const r = this.rng() * SLIME.armRand + SLIME.armBase;
    const th = Math.round(SLIME.armAngle * this.rng()) * BAMS;
    const px = t.x + Math.sin(th) * r;
    const pz = t.z + Math.cos(th) * r;
    const vx = px - this.x;
    const vz = pz - this.z;
    const len = Math.hypot(vx, vz);
    if (len === 0) {
      this.enter(out, 'burrow');
      return;
    }
    const n = Math.round(len / SLIME.armStep);
    // A direction shorter than 0.01 walks along +x (the exe's default vector).
    const ux = len > SLIME.armMinDir ? vx / len : 1;
    const uz = len > SLIME.armMinDir ? vz / len : 0;
    let cx = this.x;
    let cz = this.z;
    for (let i = 0; i < n; i++) {
      const g = this.ground(cx, cz, this.lift + SLIME.crawlProbe);
      if (g === null || this.wall({ x: this.x, y: this.lift, z: this.z }, { x: cx, y: this.lift + SLIME.armProbeY, z: cz })) {
        this.enter(out, 'spit');
        return;
      }
      cx += ux * SLIME.armStep;
      cz += uz * SLIME.armStep;
    }
    this.enter(out, 'arm');
    out.shots = [new SlimeArm(px, pz, t.y ?? 0)];
  }

  // 0x005969cc, one crawl frame. The heading turns 0x100 a frame. The speed ramps
  // while the budget lasts (the phase +0x3a4 steps only then) and stops otherwise;
  // the budget runs down by it. Then up to 14 trial steps from the frame's start:
  // trial i moves by dir * speed (the height by dirY * speed), its floor is probed
  // from 15 above it (the probe) and the height moves half way down to it (0x009292e0).
  // A trial with a floor and no wall on the way from the start commits the frame
  // (lift = height - floor) and ends the search. Otherwise the direction turns by
  // +-(i << 12) (odd i: minus) and trial i + 1 runs. A frame with no committed trial
  // leaves the body where it was; the direction keeps its last turn either way.
  private crawlFrame(): void {
    this.angle = wrap(this.angle + SLIME.crawlTurn * BAMS);
    if (this.budget > 0) {
      this.phase += SLIME.crawlPhase * BAMS;
      this.speed = Math.min(SLIME.crawlMax, this.speed + 0.5 * (Math.sin(this.phase) + 0.5) * SLIME.crawlAccel);
    } else this.speed = Math.max(0, this.speed - SLIME.crawlAccel);
    this.budget -= this.speed;
    const x0 = this.x;
    const z0 = this.z;
    const y0 = this.lift;
    let dx = this.dirX;
    let dz = this.dirZ;
    for (let i = 1; i <= SLIME.crawlSteps; i++) {
      const x = x0 + dx * this.speed;
      const z = z0 + dz * this.speed;
      const yt = y0 + this.dirY * this.speed;
      const g = this.ground(x, z, yt + SLIME.crawlProbe);
      if (g !== null) {
        const y = yt + SLIME.crawlPull * (g - yt);
        if (!this.wall({ x: x0, y: y0, z: z0 }, { x, y, z })) {
          this.x = x;
          this.z = z;
          this.lift = y - g;
          this.dirX = dx;
          this.dirZ = dz;
          return;
        }
      }
      const a = (i & 1 ? -1 : 1) * (i << 12) * BAMS;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const nx = dx * c - s * dz;
      dz = dz * c + s * nx;
      dx = nx;
    }
    this.dirX = dx;
    this.dirZ = dz;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return this.finish(out);
    const t = this.target(targets);
    switch (this.state) {
      case 'puddle':
        if (--this.timer > 0) break;
        if (nearest(targets, this.x, this.z, SLIME.near)) {
          this.enter(out, 'rise');
          break;
        }
        if (++this.misses >= SLIME.misses) {
          this.misses = SLIME.misses;
          this.x = this.spawnX;
          this.z = this.spawnZ;
          this.warps++;
        }
        this.timer = this.puddleWait();
        break;
      case 'rise':
        this.curves(SLIME_XF.riseWobble);
        this.level += 1 / SLIME.riseFrames;
        if (--this.timer <= 0) this.enter(out, nearest(targets, this.x, this.z, SLIME.near) ? 'crawl' : 'sink', targets);
        break;
      case 'sink':
        this.curves(SLIME_XF.sinkWobble);
        this.level -= 1 / SLIME.sinkFrames;
        if (--this.timer < 0) this.enter(out, 'puddle');
        break;
      case 'crawl':
        this.crawlFrame();
        if (this.budget <= 0 && this.speed === 0) {
          // 0x005969cc's end: a target within 50 and farther than 15 -> emerge (4), else crawl again (3).
          const n = nearest(targets, this.x, this.z, SLIME.crawlLeave);
          if (n && Math.hypot(n.x - this.x, n.z - this.z) > SLIME.crawlLeaveMin) this.enter(out, 'emerge');
          else this.enter(out, 'crawl', targets);
        }
        break;
      case 'emerge':
        if (--this.timer <= 0) this.enter(out, this.confused ? 'confused' : 'search');
        break;
      case 'burrow':
        if (--this.timer <= 0) this.enter(out, 'crawl', targets);
        break;
      case 'search': {
        if (this.timer === Infinity) {
          this.angle = wrap(this.angle + this.turnDir * SLIME.searchTurn * BAMS);
          if (!this.locked) {
            for (const p of targets) {
              if (p.dead || this.dist(p) > SLIME.searchRadius) continue;
              if (Math.abs(wrap(this.angleTo(p) - this.angle)) < SLIME.searchArc * BAMS) {
                this.locked = true;
                this.targetId = p.clientId;
                this.sweep = 0;
                break;
              }
            }
          }
          this.sweep -= SLIME.searchSpin;
          if (this.sweep <= 0) this.timer = SLIME.searchHold;
          break;
        }
        if (t) this.angle = turnToward(this.angle, this.angleTo(t), SLIME.searchFace * BAMS);
        if (--this.timer <= 0) this.enter(out, this.locked ? 'approach' : 'burrow', targets);
        break;
      }
      case 'confused':
        // ASSUMED: the other enemies are not searched (0x0077170c); it spits
        // when the turn ends.
        this.angle = wrap(this.angle + this.turnDir * SLIME.confusedTurn * BAMS);
        if (--this.timer < 0) this.enter(out, 'spit');
        break;
      case 'approach':
        if (t) {
          const want = this.angleTo(t);
          this.angle = turnToward(this.angle, want, SLIME.approachTurn * BAMS);
          if (Math.abs(wrap(want - this.angle)) < SLIME.approachTurn * BAMS) this.timer = 0;
          this.x += Math.sin(this.angle) * SLIME.approachSpeed;
          this.z += Math.cos(this.angle) * SLIME.approachSpeed;
        }
        if (--this.timer <= 0) {
          if (t && this.dist(t) <= SLIME.close && this.rng() >= SLIME.armChance) this.armWalk(out, t);
          else this.enter(out, 'spit', targets);
        }
        break;
      case 'spit':
        if (!this.fired && SLIME.spitFrames - this.timer >= SLIME.spitAt) {
          this.fired = true;
          out.shots = [new SlimeSpit(this.x, this.z, this.angle, this.power)];
        }
        if (--this.timer <= 0) this.enter(out, this.confused ? 'confused' : 'burrow');
        break;
      case 'arm':
        if (--this.timer <= 0) this.enter(out, 'burrow');
        break;
      case 'flinch':
        if (animationEnded) this.enter(out, 'burrow');
        break;
      case 'stun':
        // 0x00597514: the counter (+0x39c, the timer here) counts a frame; every 4th
        // count the effect 0xe0 is made at +0x300 (0x0050b510, the owner plays it);
        // when the motion has ended the slime goes to confused (+0x30 & 0x10) or search.
        this.timer++;
        if (this.timer % 4 === 0) this.effects.push({ id: STUN_EFFECT, dy: 0 });
        if (animationEnded) this.enter(out, this.confused ? 'confused' : 'search');
        break;
      case 'thrown':
        this.x += this.vx;
        this.z += this.vz;
        this.vy -= 0.2;
        this.lift += this.vy;
        if (this.lift <= 0) {
          this.lift = 0;
          this.enter(out, 'rise');
        }
        break;
      default:
        exhaustive(this.state);
    }
    out.lift = this.lift;
    out.hidden = this.hidden;
    return this.finish(out);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.hits++;
    this.targetId = clientId;
    if (this.state !== 'flinch') {
      this.state = 'flinch';
      this.current = SLIME_ANIM.hurt;
      // 0x005985c4 (the flinch entry): scale 1, morph 5.
      this.xf.sx = this.xf.sy = this.xf.sz = 1;
      this.morph = SLIME_MORPH.flinch;
    }
  }

  // The death entry (0x00598648): scale 1, morph 5 (the hurt pose), the counter
  // 5. The alpha is left as it is; stepDeathFade runs the fade.
  override kill(): void {
    if (this.state === 'dead') return;
    super.kill();
    this.xf.sx = this.xf.sy = this.xf.sz = 1;
    this.morph = SLIME_MORPH.dead;
    this.deathLeft = SLIME.deathFrames;
  }

  // One death frame of the fade (0x00597594, the death state's frame): the
  // alpha drops 0.2 (floored at 0) and the counter goes down; true when the
  // counter is spent, the slime is removed then (flag +8 |= 1). The owner calls
  // it from the death plan (render/combat.ts deathSteps, the plan's `fade` step),
  // and slimeView draws the alpha, so the fade has one owner.
  stepDeathFade(): boolean {
    this.xf.alpha = Math.max(0, this.xf.alpha - SLIME_XF.deathFade);
    return --this.deathLeft <= 0;
  }

  // The flinch ended: 12 -> 5.
  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    this.enter(out, 'burrow');
    return this.state;
  }
}

// The set's head slot (0x005959fc): never drawn, never hit. It owns the
// slime slots: k < min(num_children or 4, 4); 'free' until a slime is built
// there, 'dead' once that slime died (never reused).
export type SlimeSlot = 'free' | 'live' | 'dead';

export class SlimeControl extends BrainBase {
  state = 'control';
  readonly invulnerable = true;
  readonly hidden = true;
  readonly untargetable = true;
  readonly slots: SlimeSlot[];

  constructor(opts: { x: number; z: number; angle: number; numChildren: number }) {
    super(opts.x, opts.z, opts.angle, Math.random);
    this.slots = new Array<SlimeSlot>(Math.min(opts.numChildren || 4, 4)).fill('free');
  }

  // The first free slot, taken; -1 when all four were used.
  take(): number {
    const k = this.slots.indexOf('free');
    if (k >= 0) this.slots[k] = 'live';
    return k;
  }

  died(k: number): void {
    if (this.slots[k] === 'live') this.slots[k] = 'dead';
  }

  // No slime is alive (and none can split any more): the set is dead.
  get finished(): boolean {
    return this.slots.length > 0 && !this.slots.includes('live') && this.slots[0] !== 'free';
  }

  tick(): AiFrame {
    const out = this.frame();
    out.hidden = true;
    return out;
  }

  onDamage(): void {}

  resume(): string {
    return this.state;
  }
}
