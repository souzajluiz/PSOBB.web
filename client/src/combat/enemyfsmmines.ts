// Per-family enemy state machines of the Mines (PsoBB.exe, Ephinea 1.25.13,
// addresses are VAs): Dubchic / Gillchic and Garanz. Same EnemyBrain shape as
// combat/enemyfsm.ts (render/combat.ts drives them the same way); their
// projectiles are combat/enemyshots.ts.
//
// MovementData (`mv`) is the enemy's BattleParamEntry MovementData row
// (Dubchic 0x1b, Gillchic 0x1c, Garanz 0x1d): fparam1..6 = mv.f1..f6,
// iparam1..6 = mv.i1..i6.

import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyAiMotion } from './enemyai.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, loop, nearest, once, turnToward, wrap } from './enemyfsm.ts';
import { DubchicLaser, EnemyShot, GaranzMine, GaranzMissile } from './enemyshots.ts';
import { STATUS } from './status.ts';
import { isAndroid } from './progression.ts';
import { exhaustive } from '../exhaustive.ts';

const EMPTY_MV: EnemyMovementData = { fparam1: 0, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [0, 0, 0, 0, 0, 0] };

// --- Dubchic / Gillchic ---------------------------------------------------------
//
// Ctor 0x00556600 (vtable 0x00b04760, update 0x005548f0), table 0x009bdbe0,
// AI record 0x009bdd40 {150, 0, turn 1024, 30}. The selector 0x005562ec runs
// before the dispatcher 0x00554a0c (switch on +0x32e):
//   idle (0) / home (8): every 30 frames a target within the aggro radius
//     (+0x3d8: 170 when round(param1) is even, 220 when odd) -> walk.
//   walk (1, 0x00555fdc): animation 1 (motion 13, 0.7; the Gillchic's slot 19,
//     the revived one's slot 7 = motion 14 at mv.f4, Ultimate slot 0); steps
//     0.37037 (Dubchic) / 0.57037 (Gillchic) a frame (table 0xa73aa8, the
//     revived one mv.f3) toward the target, turning 1024 BAMS, and adds the
//     step to +0x3ac. Every 30 frames it re-acquires within aggro + 50
//     (0x00924c18), none -> home. While +0x3ac < 80 (0x00924c08) a target
//     inside AttackData distance_x -> melee; past 80 the count restarts and,
//     when param1 >= 0, get_random_float < 0.35 (0x00924c04) takes a random
//     player within 150 and fires the laser.
//   melee (2, 0x00555cd8): animation 2 (motion 6 at mv.f1; revived 12 =
//     motion 7 at mv.f5), turning; hits at motion frames 20 and 28 (revived 34
//     and 54, table 0xa73ab0 / 0xa73ab8): try_hit_entity(1.0) +
//     cause_knockback(3.0); the Gillchic (+0x370) also rolls <= 1/6
//     (0x00924c24) for entity_hit_by_tech group 17 (0x00924b94): slow.
//     Back to walk when the motion ends.
//   laser (9, 0x00554a58): round(param1) shots (2 when 0); animation 8
//     (motion 2, 0.6; revived 9 = motion 3, 0.4); at motion frame 2 the
//     charge (mv.i2 frames) starts, then the laser (0x005570f0) leaves along
//     the heading; 15 frames between shots, the last one on animation 17
//     (motion 8, 0.5; revived 18 = motion 9, 0.4); 30 frames after the last
//     one, back to walk.
//   home (8, 0x00554fd4): walks back to the spawn point, idle within 10
//     (100 squared, 0x00924c6c).
//   death (5, 0x00555234): a Dubchic (param6 == 0) that has died fewer than 5
//     times gets up again: it lies mv.i1 frames, then animation 14 (motion
//     5, 0.7) stands it up with full HP and the revived flag (+0x39a). A
//     Gillchic (and the 6th death) dies for good.
export const DUBCHIC = {
  search: 30,
  aggroEven: 170,
  aggroOdd: 220,
  reacquire: 50,
  walkBeforeLaser: 80,
  laserChance: Math.fround(0.35),
  laserRange: 150,
  turn: 1024,
  speed: Math.fround(0.37037035822868347),
  gillchicSpeed: Math.fround(0.5703703761100769),
  hitFrames: [20, 28],
  revivedHitFrames: [34, 54],
  knockback: 3,
  slowChance: Math.fround(1 / 6),
  chargeFrame: 2,
  shotGap: 15,
  laserEnd: 30,
  home: 10,
  maxRevives: 5,
  // ASSUMED: the muzzle height (node 0x22 of the model).
  muzzle: 12,
} as const;

export type DubchicState = 'idle' | 'walk' | 'melee' | 'laser' | 'home' | 'down' | 'dead';

export class DubchicAi extends BrainBase {
  state: DubchicState = 'idle';
  revived = false;
  deaths = 0;
  private gillchic: boolean;
  private ultimate: boolean;
  private mv: EnemyMovementData;
  private aggro: number;
  private laserOk: boolean;
  private shotCount: number;
  private reach: number;
  private reachAngle: number;
  private spawnX: number;
  private spawnZ: number;
  private timer = 0;
  private frames = 0;
  private walked = 0;
  private hitIndex = 0;
  private shots = 0;
  private charge = -1;
  private gap = -1;
  private endWait = -1;
  private downTimer = 0;
  private standing = false;

  constructor(opts: { x: number; z: number; angle: number; param1: number; gillchic: boolean; ultimate: boolean; movement: EnemyMovementData | null; attack: EnemyAttackData | null; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.gillchic = opts.gillchic;
    this.ultimate = opts.ultimate;
    this.mv = opts.movement ?? EMPTY_MV;
    const p1 = Math.round(opts.param1);
    this.aggro = (p1 & 1) === 0 ? DUBCHIC.aggroEven : DUBCHIC.aggroOdd;
    this.laserOk = opts.param1 >= 0;
    this.shotCount = p1 === 0 ? 2 : Math.abs(p1);
    this.reach = opts.attack?.distanceX ?? 0;
    this.reachAngle = ((opts.attack?.angle ?? 0x2000) & 0xffff) * BAMS_TO_RAD;
    this.current = loop(11, 0.5);
  }

  private walkMotion(): EnemyAiMotion {
    if (this.revived) return loop(14, this.mv.fparam4 || 1.2);
    if (this.ultimate) return loop(11, 0.5);
    // Slot 19's speed is 0 in the table (written at run time; ASSUMED the
    // Dubchic's 0.7).
    return loop(13, 0.7);
  }

  private walkSpeed(): number {
    if (this.revived && this.mv.fparam3 > 0) return this.mv.fparam3;
    return this.gillchic ? DUBCHIC.gillchicSpeed : DUBCHIC.speed;
  }

  private enter(out: AiFrame, state: DubchicState): void {
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    if (state === 'idle') {
      this.targetId = null;
      this.play(out, loop(11, 0.5));
    } else if (state === 'walk' || state === 'home') {
      this.walked = 0;
      this.play(out, this.walkMotion());
    } else if (state === 'melee') {
      this.hitIndex = 0;
      this.play(out, this.revived ? once(7, this.mv.fparam5 || 1) : once(6, this.mv.fparam1 || 1));
    } else if (state === 'laser') {
      this.shots = this.shotCount;
      this.charge = -1;
      this.gap = -1;
      this.endWait = -1;
      this.play(out, this.revived ? once(3, 0.4) : once(2, 0.6));
    }
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    switch (this.state) {
      case 'idle':
        if (this.timer % DUBCHIC.search === 0) {
          const t = nearest(targets, this.x, this.z, this.aggro);
          if (t) {
            this.targetId = t.clientId;
            this.enter(out, 'walk');
          }
        }
        break;
      case 'home': {
        if (this.timer % DUBCHIC.search === 0) {
          const t = nearest(targets, this.x, this.z, this.aggro);
          if (t) {
            this.targetId = t.clientId;
            this.enter(out, 'walk');
            break;
          }
        }
        const d = Math.hypot(this.spawnX - this.x, this.spawnZ - this.z);
        if (d < DUBCHIC.home) {
          this.enter(out, 'idle');
          break;
        }
        this.step(Math.atan2(this.spawnX - this.x, this.spawnZ - this.z));
        break;
      }
      case 'walk': {
        let t = this.target(targets);
        if (this.timer % DUBCHIC.search === 0) {
          t = nearest(targets, this.x, this.z, this.aggro + DUBCHIC.reacquire);
          this.targetId = t ? t.clientId : null;
        }
        if (!t) {
          this.enter(out, 'home');
          break;
        }
        this.walked += this.step(this.angleTo(t));
        if (this.walked < DUBCHIC.walkBeforeLaser) {
          if (this.dist(t) ** 2 < this.reach ** 2) this.enter(out, 'melee');
        } else {
          this.walked = 0;
          if (this.laserOk && Math.fround(this.rng()) < DUBCHIC.laserChance) {
            const pool = targets.filter((p) => !p.dead && this.dist(p) < DUBCHIC.laserRange);
            if (pool.length) {
              this.targetId = pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))].clientId;
              this.enter(out, 'laser');
            }
          }
        }
        break;
      }
      case 'melee': {
        const t = this.target(targets);
        if (t) this.angle = turnToward(this.angle, this.angleTo(t), DUBCHIC.turn * BAMS_TO_RAD);
        const frames = this.revived ? DUBCHIC.revivedHitFrames : DUBCHIC.hitFrames;
        if (this.hitIndex < frames.length && this.frames >= frames[this.hitIndex]) {
          this.hitIndex++;
          // should_push_defender: ASSUMED the AttackData reach and arc.
          if (t && this.dist(t) <= this.reach && Math.abs(wrap(this.angleTo(t) - this.angle)) <= this.reachAngle) {
            out.hit = { clientId: t.clientId, knockback: DUBCHIC.knockback, mult: 1 };
            if (this.gillchic && Math.fround(this.rng()) <= DUBCHIC.slowChance) out.status = { clientId: t.clientId, type: STATUS.slow };
          }
        }
        if (animationEnded) this.enter(out, 'walk');
        break;
      }
      case 'laser': {
        const t = this.target(targets);
        if (t) this.angle = turnToward(this.angle, this.angleTo(t), DUBCHIC.turn * BAMS_TO_RAD);
        if (this.shots > 0) {
          if (this.gap >= 0) {
            if (--this.gap < 0) {
              this.charge = Math.max(0, this.mv.iparam[1] ?? 0);
              if (this.shots === 1) this.play(out, this.revived ? once(9, 0.4) : once(8, 0.5));
            }
          } else if (this.charge < 0) {
            if (this.frames >= DUBCHIC.chargeFrame) this.charge = Math.max(0, this.mv.iparam[1] ?? 0);
          } else if (--this.charge < 0) {
            this.shots--;
            out.shots = [new DubchicLaser(this.x, DUBCHIC.muzzle, this.z, this.angle, this.mv.iparam[3] ?? 0)];
            if (this.shots > 0) this.gap = DUBCHIC.shotGap;
          }
        } else {
          if (this.endWait < 0 && (animationEnded || this.current?.loop)) this.endWait = 0;
          if (this.endWait >= 0 && ++this.endWait >= DUBCHIC.laserEnd) this.enter(out, t ? 'walk' : 'home');
        }
        break;
      }
      case 'down':
        if (!this.standing) {
          if (--this.downTimer <= 0) {
            this.standing = true;
            this.play(out, once(5, 0.7));
          }
        } else if (animationEnded) {
          this.standing = false;
          this.enter(out, this.targetId !== null ? 'walk' : 'idle');
        }
        break;
      default:
        exhaustive(this.state);
    }
    return this.finish(out);
  }

  private step(want: number): number {
    const v = this.walkSpeed();
    this.angle = turnToward(this.angle, want, DUBCHIC.turn * BAMS_TO_RAD);
    this.x += Math.sin(this.angle) * v;
    this.z += Math.cos(this.angle) * v;
    return v;
  }

  // The kill: true when the Dubchic gets up again (state 5's revive branch;
  // the owner keeps it alive and plays the fall).
  revive(): boolean {
    if (this.gillchic || this.deaths >= DUBCHIC.maxRevives - 1) {
      this.deaths++;
      return false;
    }
    this.deaths++;
    this.revived = true;
    this.state = 'down';
    this.downTimer = Math.max(1, this.mv.iparam[0] ?? 0);
    this.standing = false;
    this.current = null;
    return true;
  }

  // Lying down and getting up: hits do nothing (invulnerable until the stand
  // up's frame 25, 0x00924c68).
  get invulnerable(): boolean {
    return this.state === 'down';
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead' || this.state === 'down') return;
    this.targetId = clientId;
    this.current = null;
  }

  resume(): string {
    if (this.state === 'dead' || this.state === 'down') return this.state;
    const out = this.frame();
    this.enter(out, this.targetId !== null ? 'walk' : 'idle');
    return this.state;
  }
}

// --- Garanz ------------------------------------------------------------------------
//
// Ctor 0x0056f8f4 (vtable 0x00b05f80, update 0x0056d83c, dispatcher
// 0x0056d8f4), table 0x009be740, AI record 0x009be818 {150, mv.f2, turn
// 1024, 30}. The phase (+0x3b0) moves 0 -> 1 when HP <= max / 3 and 1 -> 2
// when HP <= max / 4 (the hit handler 0x0056f1d8).
//   idle (0) / home (8), the selector 0x0056eb08: every 30 frames up to 4
//     players within 300 (90000 squared, 0x00926804), sorted by distance and
//     padded with the farthest. None and more than 10 from the spawn point
//     -> home. Phase 0 walks (state 1) toward sorted[1]; phase 1 lays mines
//     (state 9) toward sorted[1], phase 2 toward sorted[0]. After the walk:
//     the barrage.
//   walk (1 / 9, 0x0056e6f8): animation 1 (motion 5, 0.7, then 5 = motion 6
//     loop); faces the target by 1024 and steps mv.f2 for mv.f1 units (120
//     in state 9). State 9 drops a ground mine every 20 units (0x00926824).
//   barrage (2, 0x0056dd54): super armor (flag 0x40000); animation 0 while it
//     turns (1024) until within 0xe37 of the target, then animation 2 (motion
//     0, 1.0); at frame 28 (0x0092682c) 4 / 8 / 16 missiles (phase 0 / 1 / 2)
//     at the heading +-0x800, pitched 22.5 or 45 degrees up, aimed at
//     sorted[0..3]; mv.i1 frames later back to idle.
//   flinch (4): back to walk when it ends.
export const GARANZ = {
  search: 30,
  range: 300,
  reacquire: 200,
  home: 10,
  turn: 1024,
  mineWalk: 120,
  mineEvery: 20,
  aimArc: 0xe37,
  fireFrame: 28,
  missiles: [4, 8, 16],
  spread: 0x800,
  // ASSUMED: the launchers' height (nodes 0x10..0x17 of the model).
  launcher: 20,
} as const;

export type GaranzState = 'idle' | 'walk' | 'mines' | 'barrage' | 'home' | 'dead';

export class GaranzAi extends BrainBase {
  state: GaranzState = 'idle';
  phase = 0;
  hpFraction = 1; // the owner keeps it current
  private mv: EnemyMovementData;
  private spawnX: number;
  private spawnZ: number;
  private timer = 0;
  private frames = 0;
  private walked = 0;
  private walkLength = 0;
  private nextMine = 0;
  private sorted: number[] = [];
  private aiming = true;
  private fired = false;
  private wait = -1;

  constructor(opts: { x: number; z: number; angle: number; movement: EnemyMovementData | null; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.mv = opts.movement ?? EMPTY_MV;
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.current = once(4, 0.7);
  }

  // The hit handler's phase steps.
  updatePhase(): void {
    if (this.phase === 0 && this.hpFraction <= 1 / 3) this.phase = 1;
    if (this.phase === 1 && this.hpFraction <= 1 / 4) this.phase = 2;
  }

  get superArmor(): boolean {
    return this.state === 'barrage';
  }

  // Up to 4 players within 300 by distance, padded with the farthest.
  private collect(targets: readonly AiTarget[]): number[] {
    const list = targets.filter((t) => !t.dead && (t.x - this.x) ** 2 + (t.z - this.z) ** 2 < GARANZ.range ** 2).sort((a, b) => this.dist(a) - this.dist(b)).slice(0, 4);
    const ids = list.map((t) => t.clientId);
    while (ids.length && ids.length < 4) ids.push(ids[ids.length - 1]);
    return ids;
  }

  private enter(out: AiFrame, state: GaranzState): void {
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    if (state === 'idle') this.play(out, once(4, 0.7));
    else if (state === 'walk' || state === 'mines' || state === 'home') {
      this.walked = 0;
      this.nextMine = GARANZ.mineEvery;
      this.walkLength = state === 'mines' ? GARANZ.mineWalk : this.mv.fparam1;
      this.play(out, loop(6, 0.7));
    } else if (state === 'barrage') {
      this.aiming = true;
      this.fired = false;
      this.wait = -1;
      this.play(out, once(4, 0.7));
    }
  }

  tick(targets: readonly AiTarget[], _animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    const speed = this.mv.fparam2 || 1.2;
    switch (this.state) {
      case 'idle':
      case 'home': {
        if (this.timer % GARANZ.search === 0) {
          this.sorted = this.collect(targets);
          if (this.sorted.length) {
            this.updatePhase();
            if (this.phase === 0 && this.hpFraction > 1 / 3) {
              this.targetId = this.sorted[1];
              this.enter(out, 'walk');
            } else {
              this.targetId = this.phase === 2 ? this.sorted[0] : this.phase === 1 ? this.sorted[1] : this.sorted[3];
              this.enter(out, 'mines');
            }
            break;
          }
          if (this.state === 'idle' && (this.x - this.spawnX) ** 2 + (this.z - this.spawnZ) ** 2 > GARANZ.home ** 2) this.enter(out, 'home');
        }
        if (this.state === 'home') {
          if ((this.x - this.spawnX) ** 2 + (this.z - this.spawnZ) ** 2 <= GARANZ.home ** 2) this.enter(out, 'idle');
          else this.move(Math.atan2(this.spawnX - this.x, this.spawnZ - this.z), speed);
        }
        break;
      }
      case 'walk':
      case 'mines': {
        let t = this.target(targets);
        if (this.state === 'walk' && this.timer % GARANZ.search === 0) {
          const n = nearest(targets, this.x, this.z, GARANZ.reacquire);
          if (n) t = n;
          if (!t) {
            this.enter(out, 'home');
            break;
          }
          this.targetId = t.clientId;
        }
        if (t) this.move(this.angleTo(t), speed);
        else this.move(this.angle, speed);
        this.walked += speed;
        if (this.state === 'mines' && this.walked >= this.nextMine) {
          this.nextMine += GARANZ.mineEvery;
          out.shots = [new GaranzMine(this.x, GARANZ.launcher, this.z, this.angle, this.mv.iparam[3] ?? 0, this.rng)];
        }
        if (this.walked >= this.walkLength) this.enter(out, 'barrage');
        break;
      }
      case 'barrage': {
        if (this.timer % GARANZ.search === 0) {
          const s = this.collect(targets);
          if (s.length) this.sorted = s;
        }
        const t = this.target(targets) ?? targets.find((p) => p.clientId === this.sorted[0] && !p.dead) ?? null;
        if (this.aiming) {
          if (t) this.angle = turnToward(this.angle, this.angleTo(t), GARANZ.turn * BAMS_TO_RAD);
          if (!t || Math.abs(wrap(this.angleTo(t) - this.angle)) < GARANZ.aimArc * BAMS_TO_RAD) {
            this.aiming = false;
            this.frames = 0;
            this.play(out, once(0, 1));
          }
        } else if (!this.fired && this.frames >= GARANZ.fireFrame) {
          this.fired = true;
          out.shots = this.volley();
          this.wait = Math.max(0, this.mv.iparam[0] ?? 0);
        } else if (this.fired && --this.wait <= 0) {
          this.enter(out, 'idle');
        }
        break;
      }
      default:
        exhaustive(this.state);
    }
    return this.finish(out);
  }

  private move(want: number, speed: number): void {
    this.angle = turnToward(this.angle, want, GARANZ.turn * BAMS_TO_RAD);
    this.x += Math.sin(this.angle) * speed;
    this.z += Math.cos(this.angle) * speed;
  }

  // The barrage (0x0056dee4 / 0x00570810). The pairing of the two pitches
  // with the launchers was not verified (ASSUMED alternating).
  volley(): EnemyShot[] {
    const n = GARANZ.missiles[Math.min(2, this.phase)];
    const shots: EnemyShot[] = [];
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const pitch = (((i >> 1) % 2 === 0 ? 0x1000 : 0x2000) * Math.PI * 2) / 0x10000;
      shots.push(
        new GaranzMissile({
          x: this.x,
          y: GARANZ.launcher,
          z: this.z,
          yaw: this.angle + side * GARANZ.spread * BAMS_TO_RAD,
          pitch,
          speed: this.mv.fparam4 || 1.42,
          steer: this.mv.fparam5 || 0.17,
          lifeAdjust: this.mv.iparam[1] ?? -30,
          power: this.mv.iparam[2] ?? 0,
          targetId: this.sorted.length ? this.sorted[i % this.sorted.length] : this.targetId,
        }),
      );
    }
    return shots;
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.updatePhase();
    if (this.state === 'barrage') return;
    if (this.targetId === null) this.targetId = clientId;
    this.current = null;
  }

  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    this.enter(out, this.targetId !== null ? 'walk' : 'idle');
    return this.state;
  }
}

// --- Sinow Beat / Sinow Gold ---------------------------------------------------
//
// Create 0x0058d320 (vtable 0x00b08820, init 0x00590d74), dispatcher
// 0x0058d93c, table 0x009bf8a0, AI record 0x009bf9a0 {search 225, turn
// 1536}. MovementData row 6 (Beat) / 0x10 (Gold): fparam1 walk speed,
// fparam2 the speed while the mirage is up, fparam3 the combo's lunge,
// iparam1 the Gold's technique level, iparam2 its wait after it, iparam3
// the combo's hold.
//   wait (2, 0x0058f550): animation 0 (motion 7, 0.5); FindEnemyTarget(200);
//     30 frames later the ceiling drop (3, 0x0058f250: animation 1, motion 0,
//     1.5, no flinch), then the lost-target state.
//   chase (4, 0x0058f040): animation 9 (motion 9, 0.5); fparam1 a frame,
//     turning 0x500 (in place when not facing within cos 0x1000); within
//     25 (0x00928c5c) and +-0x1e00 -> combo; 100..150 away (0x0058d09c, the
//     path check not reproduced) -> warp-strike; no target -> lost.
//   warp-strike (5, 0x0058eb18): animation 5 (motion 4); turns 0x1000 a
//     frame until motion frame 10; at 14 (0x00928c6c) it vanishes and moves
//     (distance - 20) / 12.857 a frame; at 23 (0x00928c70) it reappears; at
//     25 try_hit_entity(1.0) + cause_knockback(3.0); the slide slows by 0.85
//     a frame (0x00928c7c).
//   combo (6, 0x0058e8f0): animation 6 (motion 5); turns 0x300 before frame
//     20, lunges at fparam3 on frames 0..5; hits at 9 and 19 (0x0058cfe8:
//     try_hit_entity(1.0), cause_knockback(3.0)); the second also confuses
//     with get_random_float < 0.1666 (0x00928d44); at frame 25 it holds
//     iparam3 frames; every 2nd combo -> warp away, else chase.
//   warp away (7, 0x0058e598): animation 2 (motion 1), away from the target
//     (+0x8000), turning 0x31c7; vanishes at 15, moves 80 / 11.25 a frame,
//     reappears at 24; then the Gold casts (10), else chase.
//   technique (10, 0x0058dde4): animation 7 (motion 6, 0.7), the cast at
//     level iparam1, iparam2 frames, then chase.
//   lost (11, 0x0058dd3c): animation 8 (motion 8, 0.5); a target within 200
//     -> chase; after 90 frames it gives up (9: back to its spawn point).
//   flinch: never in Ultimate (0x005900c8).
export const SINOW = {
  search: 200,
  waitFrames: 30,
  turn: 0x500,
  facingCos: Math.cos(0x1000 * BAMS_TO_RAD),
  comboRange: 25,
  comboArc: 0x1e00,
  warpMin: 100,
  warpMax: 150,
  warpTurn: 0x1000,
  warpTurnUntil: 10,
  warpVanish: 14,
  warpAppear: 23,
  warpHit: 25,
  warpStop: 20,
  warpFrames: Math.fround(12.857),
  slide: Math.fround(0.85),
  comboTurn: 0x300,
  comboTurnUntil: 20,
  lungeUntil: 5,
  comboHits: [9, 19],
  confuseChance: Math.fround(0.1666),
  comboHold: 25,
  awayTurn: 0x31c7,
  awayVanish: 15,
  awayAppear: 24,
  awayDistance: 80,
  awayFrames: Math.fround(11.25),
  lostFrames: 90,
  knockback: 3,
} as const;

// The mirage (the cast, state 0xe, handler 0x0058fa6c; the approach, state 8,
// 0x0058e074; the clones' wait, state 0xf, 0x00590108): see SinowAi.
//   - After a warp away (7), a Beat (param2 < 1) with param1 < 1 casts the
//     mirage every other time (flag 0x20000 toggles: the exit of 0x0058e598);
//     the cast is animation 7 (the technique's), and when it ends with a target
//     in sight (cast_ray_from_entity_to_entity) the real body picks its slot
//     round-down(5 * rand) of 5 and the other four slots get a clone each: the
//     Sinow's child entities (newserv: default_num_children 4; entity id and
//     enemy index +1 + i), at full hp, on the real body's place, in state 8.
//   - State 8 (all five bodies): for 40 frames each takes the point at
//     min(max(distance +- 3 toward 80), 80) * heading_cos from the target on
//     the line from the target rotated by (slot - 2) * 0x3333 / 0x28 BAMS a
//     frame (heading_cos 1.0, multiplied by 0.8 when the move is blocked:
//     not reproduced), so the five spin round the target, the outer ones the
//     fastest; then flag 0x10 (evp halved: +0x2d0 = +0x3e4 / 2) and a chase of
//     the nearest within 200 (none: lost).
//   - The 2nd combo's end (SpawnAlly 0x0058f784) sends the clones to state 0xf
//     when flag 0x10 is set (evp back): 0.1 a frame down to -1.0, i.e. 10
//     frames, then they park below the floor (y -500) until the next cast.
export const SINOW_MIRAGE = {
  slots: 5,
  clones: 4,
  frames: 0x27, // the approach ends when its counter passes this
  engage: 80, // 0x00a7442c
  closing: 3, // g_SinowberillAttackRadius 0x00928cb8
  ramp: Math.fround(0.8), // g_SinowberillHeadingCosine 0x00928cc0
  center: 2, // round(0x00928b50 = 2.5)
  arcNum: 0x3333,
  arcDen: 0x28,
  pick: 200, // FindNearestEntities(this, 40000.0): a squared distance
  hideFrames: 10,
} as const;

// Slots 2, 5 and 6 have speed 0 in the table (written at run time).
// ASSUMED: 0.7 for the warp-strike (frames 14..23 then take 12.857 ticks, so
// the hidden move covers distance - 20; the 0.85 slide follows), 0.8 for the
// warp away (15..24 in 11.25 ticks: 80 units) and 1.0 for the combo.
const SINOW_MOTION = {
  wait: loop(7, 0.5),
  drop: once(0, 1.5),
  warpStrike: once(4, 9 / SINOW.warpFrames),
  combo: once(5, 1),
  away: once(1, 9 / SINOW.awayFrames),
  tech: once(6, 0.7),
  lost: loop(8, 0.5),
  walk: loop(9, 0.5),
};

export type SinowState = 'wait' | 'drop' | 'chase' | 'warp' | 'combo' | 'away' | 'tech' | 'lost' | 'cast' | 'approach' | 'hide' | 'dead';

// What the owner does for the mirage (render/combat.ts): the cast makes the
// clones appear round the real body; a dismiss sends them away.
export type SinowEvent =
  | { kind: 'mirage'; main: number; x: number; z: number; angle: number; targetId: number | null; tx: number; tz: number }
  | { kind: 'dismiss' };

export class SinowAi extends BrainBase {
  state: SinowState = 'wait';
  hidden = false;
  private gold: boolean;
  private ultimate: boolean;
  private mv: EnemyMovementData;
  private reach: number;
  private spawnX: number;
  private spawnZ: number;
  private timer = 0;
  private frames = 0;
  private step = 0;
  private hitIndex = 0;
  private hold = -1;
  private combos = 0;
  private dir = 0;
  // The mirage (SINOW_MIRAGE). param1 is the set entry's: a Beat with param1 >=
  // 1 never casts it. `cast` is flag 0x20000 (the cast happens every other
  // warp away), `mirage` flag 0x10 (evp halved while the clones are out),
  // `slot` the body's place in the five (+0x3dc).
  private param1: number;
  private cast = false;
  mirage = false;
  slot = 0;
  readonly ally: boolean;
  readonly events: SinowEvent[] = [];
  private tx = 0;
  private tz = 0;
  private arc = 0;
  private ramp = 1;

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    gold: boolean;
    ultimate: boolean;
    movement: EnemyMovementData | null;
    attack: EnemyAttackData | null;
    radius: number;
    rng?: () => number;
    param1?: number;
    // A clone (flag 0x1000): it waits parked (state 0xf) until the real body
    // casts the mirage.
    ally?: boolean;
  }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.gold = opts.gold;
    this.ultimate = opts.ultimate;
    this.mv = opts.movement ?? EMPTY_MV;
    this.reach = (opts.attack?.distanceX ?? 0) + opts.radius;
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.param1 = opts.param1 ?? 0;
    this.ally = opts.ally ?? false;
    this.current = SINOW_MOTION.wait;
    if (this.ally) {
      this.state = 'hide';
      this.hidden = true;
      this.timer = SINOW_MIRAGE.hideFrames;
      this.current = null;
    }
  }

  // The evp the body fights with: half while the mirage is out (+0x2d0 =
  // +0x3e4 / 2, SinowberillSetSpecialFlag 0x0058e570).
  get evpScale(): number {
    return this.mirage ? 0.5 : 1;
  }
  // A parked clone: not in the world.
  get dormant(): boolean {
    return this.state === 'hide';
  }

  // SinowberillSetAllyStates (0x0058f7b8) on the real body: with the mirage
  // out, the evp comes back and the clones leave.
  private dismissClones(): void {
    if (!this.mirage) return;
    this.mirage = false;
    this.events.push({ kind: 'dismiss' });
  }

  // The real body asks a clone to join (0x0058fa6c): it takes the body's place
  // and goes to state 8 at its slot.
  activate(x: number, z: number, angle: number, slot: number, targetId: number | null, targetX: number, targetZ: number): AiFrame {
    const out = this.frame();
    this.x = x;
    this.z = z;
    this.angle = angle;
    this.slot = slot;
    this.targetId = targetId;
    this.tx = targetX;
    this.tz = targetZ;
    this.mirage = false;
    this.beginApproach(out);
    this.play(out, SINOW_MOTION.tech);
    return this.finish(out);
  }

  // Parks the clone (state 0xf): 10 frames, then it is hidden.
  dismiss(): void {
    if (this.state === 'hide' || this.state === 'dead') return;
    const out = this.frame();
    this.enter(out, 'hide');
    this.hidden = false;
  }

  private beginApproach(out: AiFrame): void {
    this.enter(out, 'approach');
    this.ramp = 1;
    this.arc = Math.trunc(((this.slot - SINOW_MIRAGE.center) * SINOW_MIRAGE.arcNum) / SINOW_MIRAGE.arcDen);
  }

  get superArmor(): boolean {
    return this.ultimate || this.state === 'drop';
  }

  // ASSUMED: a vanished Sinow cannot be hit.
  get invulnerable(): boolean {
    return this.hidden || this.state === 'hide';
  }

  private enter(out: AiFrame, state: SinowState): void {
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    this.hitIndex = 0;
    this.hold = -1;
    this.hidden = false;
    this.step = 0;
    const m: Record<SinowState, EnemyAiMotion | null> = {
      wait: SINOW_MOTION.wait,
      drop: SINOW_MOTION.drop,
      chase: SINOW_MOTION.walk,
      warp: SINOW_MOTION.warpStrike,
      combo: SINOW_MOTION.combo,
      away: SINOW_MOTION.away,
      tech: SINOW_MOTION.tech,
      lost: SINOW_MOTION.lost,
      cast: SINOW_MOTION.tech,
      approach: null,
      hide: null,
      dead: null,
    };
    if (state === 'wait') this.targetId = null;
    const motion = m[state];
    if (motion) this.play(out, motion);
  }

  private tryHit(out: AiFrame, t: AiTarget | null, confuse: boolean): void {
    if (!t || this.dist(t) > this.reach) return;
    out.hit = { clientId: t.clientId, knockback: SINOW.knockback, mult: 1 };
    if (confuse && Math.fround(this.rng()) < SINOW.confuseChance) out.status = { clientId: t.clientId, type: STATUS.confusion };
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    const t = this.target(targets);
    switch (this.state) {
      case 'wait': {
        const n = nearest(targets, this.x, this.z, SINOW.search);
        if (n) this.targetId = n.clientId;
        if (this.targetId !== null && this.timer >= SINOW.waitFrames) this.enter(out, 'drop');
        break;
      }
      case 'drop':
        if (animationEnded) this.enter(out, 'lost');
        break;
      case 'lost': {
        const n = nearest(targets, this.x, this.z, SINOW.search);
        if (n) {
          this.targetId = n.clientId;
          this.enter(out, 'chase');
        } else if (this.timer >= SINOW.lostFrames && this.ally) {
          // ASSUMED: a clone that lost everyone leaves (the exe sends it to
          // its parent's spawn point like the body).
          this.dismiss();
        } else if (this.timer >= SINOW.lostFrames) {
          // State 9: it vanishes and starts over at its spawn point.
          this.x = this.spawnX;
          this.z = this.spawnZ;
          this.enter(out, 'wait');
        }
        break;
      }
      case 'chase': {
        if (!t) {
          this.enter(out, 'lost');
          break;
        }
        const d = this.dist(t);
        const diff = wrap(this.angleTo(t) - this.angle);
        if (d < SINOW.comboRange && Math.abs(diff) <= SINOW.comboArc * BAMS_TO_RAD) {
          this.enter(out, 'combo');
          break;
        }
        if (d >= SINOW.warpMin && d <= SINOW.warpMax) {
          this.enter(out, 'warp');
          break;
        }
        this.angle = turnToward(this.angle, this.angleTo(t), SINOW.turn * BAMS_TO_RAD);
        if (Math.cos(diff) >= SINOW.facingCos) {
          const v = this.mv.fparam1 || 1.25;
          this.x += Math.sin(this.angle) * v;
          this.z += Math.cos(this.angle) * v;
        }
        break;
      }
      case 'warp': {
        if (t && this.frames < SINOW.warpTurnUntil) this.angle = turnToward(this.angle, this.angleTo(t), SINOW.warpTurn * BAMS_TO_RAD);
        if (this.frames >= SINOW.warpVanish && this.frames < SINOW.warpAppear) {
          if (!this.hidden && this.step === 0) this.step = Math.max(0, (t ? this.dist(t) : 0) - SINOW.warpStop) / SINOW.warpFrames;
          this.hidden = true;
        } else if (this.hidden) {
          this.hidden = false;
          this.step *= SINOW.slide;
        } else if (this.frames >= SINOW.warpAppear) this.step *= SINOW.slide;
        this.x += Math.sin(this.angle) * this.step;
        this.z += Math.cos(this.angle) * this.step;
        if (this.hitIndex === 0 && this.frames >= SINOW.warpHit) {
          this.hitIndex = 1;
          this.tryHit(out, t, false);
        }
        if (animationEnded) {
          this.step = 0;
          this.enter(out, t ? 'chase' : 'lost');
        }
        break;
      }
      case 'combo': {
        if (t && this.frames < SINOW.comboTurnUntil) this.angle = turnToward(this.angle, this.angleTo(t), SINOW.comboTurn * BAMS_TO_RAD);
        if (this.frames <= SINOW.lungeUntil) {
          const v = this.mv.fparam3 || 0.6;
          this.x += Math.sin(this.angle) * v;
          this.z += Math.cos(this.angle) * v;
        }
        if (this.hitIndex < SINOW.comboHits.length && this.frames >= SINOW.comboHits[this.hitIndex]) {
          this.tryHit(out, t, this.hitIndex === 1);
          this.hitIndex++;
        }
        if (this.hold < 0 && (this.frames >= SINOW.comboHold || animationEnded)) this.hold = Math.max(0, this.mv.iparam[2] ?? 0);
        if (this.hold >= 0 && this.hold-- === 0) {
          // SpawnAlly (0x0058f784): the 2nd combo dismisses the clones and warps
          // away; a clone's own SpawnAlly (0x005901c4) only chases.
          this.combos++;
          const away = !this.ally && this.combos % 2 === 0;
          if (away) this.dismissClones();
          this.enter(out, away ? 'away' : t ? 'chase' : 'lost');
          if (away) this.dir = t ? wrap(this.angleTo(t) + Math.PI) : this.angle;
        }
        break;
      }
      case 'away':
        this.angle = turnToward(this.angle, this.dir, SINOW.awayTurn * BAMS_TO_RAD);
        if (this.frames >= SINOW.awayVanish && this.frames < SINOW.awayAppear) {
          this.hidden = true;
          const v = SINOW.awayDistance / SINOW.awayFrames;
          this.x += Math.sin(this.dir) * v;
          this.z += Math.cos(this.dir) * v;
        } else this.hidden = false;
        if (animationEnded) {
          // 0x0058e598 phase 3: the Gold casts (10); a Beat with param1 < 1
          // casts the mirage (0xe) every other time; else chase. (Ultimate with
          // param1 >= 1 goes to state 0x10, not reproduced.)
          if (this.gold) {
            this.enter(out, 'tech');
            this.hold = -1;
          } else if (!this.cast && this.param1 < 1) {
            this.cast = true;
            this.enter(out, 'cast');
          } else {
            this.cast = false;
            this.enter(out, t ? 'chase' : 'lost');
          }
        }
        break;
      case 'cast':
        // 0x0058fa6c: the technique's animation, then the clones. A clone
        // never gets here (its handler for 0xe is a stub).
        if (!this.ally && animationEnded) {
          if (t) {
            this.slot = Math.min(SINOW_MIRAGE.slots - 1, Math.floor(this.rng() * SINOW_MIRAGE.slots));
            this.tx = t.x;
            this.tz = t.z;
            this.events.push({ kind: 'mirage', main: this.slot, x: this.x, z: this.z, angle: this.angle, targetId: this.targetId, tx: t.x, tz: t.z });
            this.beginApproach(out);
          } else {
            this.dismissClones();
            this.enter(out, 'chase');
          }
        }
        break;
      case 'approach':
        this.tickApproach(out, targets, t);
        break;
      case 'hide':
        if (this.timer >= SINOW_MIRAGE.hideFrames) this.hidden = true;
        break;
      case 'tech':
        // The cast (0x006eeeb4 at level iparam1, probably Resta; Shifta /
        // Deband in Ultimate) is played, its effect is not reproduced.
        if (this.hold < 0 && animationEnded) this.hold = Math.max(0, this.mv.iparam[1] ?? 0);
        if (this.hold >= 0 && this.hold-- === 0) this.enter(out, t ? 'chase' : 'lost');
        break;
      default:
        exhaustive(this.state);
    }
    out.hidden = this.hidden;
    return this.finish(out);
  }

  // State 8 (0x0058e074): the body takes a point on the circle round the target
  // each frame, from the target's line to it turned by `arc`; for 40 frames.
  private tickApproach(out: AiFrame, targets: readonly AiTarget[], t: AiTarget | null): void {
    if (t) {
      this.tx = t.x;
      this.tz = t.z;
    }
    const vx = this.tx - this.x;
    const vz = this.tz - this.z;
    const d = Math.hypot(vx, vz);
    if (d > 0) {
      const ux = vx / d;
      const uz = vz / d;
      const c = Math.cos(this.arc * BAMS_TO_RAD);
      const s = Math.sin(this.arc * BAMS_TO_RAD);
      // RotateVector2D_00782b64: x' = x cos + z sin, z' = z cos - x sin.
      const rx = ux * c + uz * s;
      const rz = uz * c - ux * s;
      const near = SINOW_MIRAGE.engage;
      const r = d > near ? Math.max(near, d - SINOW_MIRAGE.closing) : d < near ? Math.min(near, d + SINOW_MIRAGE.closing) : near;
      // ASSUMED: the move is never blocked (the exe tests the point and
      // multiplies heading_cos by 0.8 when it is), so heading_cos stays 1.
      this.x = this.tx - rx * r * this.ramp;
      this.z = this.tz - rz * r * this.ramp;
      this.angle = Math.atan2(rx, rz);
    }
    if (this.timer > SINOW_MIRAGE.frames) {
      // SinowberillSetSpecialFlag (0x0058e570): evp halved; then the nearest.
      this.mirage = true;
      const n = nearest(targets, this.x, this.z, SINOW_MIRAGE.pick);
      if (n) this.targetId = n.clientId;
      this.enter(out, n ? 'chase' : 'lost');
    }
  }

  // The vtable's hit handler (+0x100): the real body sends the clones away
  // (0x005900b4: SetAllyStates, then the flinch 0x005900c8); a clone goes to
  // state 0xf (0x00590474) and leaves.
  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    if (this.ally) {
      this.dismiss();
      return;
    }
    this.dismissClones();
    if (this.superArmor) return;
    this.targetId = clientId;
    this.hidden = false;
    this.current = null;
  }

  // A clone does not flinch (it is on its way out); the body as ever.
  flinches(): boolean {
    return !this.ally && !this.dormant;
  }

  // The death handler (+0x104, 0x005900a0) sends the clones away first.
  override kill(): void {
    this.dismissClones();
    super.kill();
  }

  resume(): string {
    if (this.state === 'dead') return this.state;
    if (this.state === 'hide') return this.state;
    const out = this.frame();
    this.enter(out, this.targetId !== null ? 'chase' : 'lost');
    return this.state;
  }
}

// --- Canadine / Canane ------------------------------------------------------------
//
// Standalone Canadine 0x0053e770 (vtable 0x00b02be0), ring Canadine
// 0x00541494, Canane 0x005419fc (vtable 0x00b02dc0); shared init 0x005424d8,
// table 0x009bce00, AI record 0x009bceb0 {search 225, turn 1536},
// dispatcher 0x0053eee4. MovementData rows 7 / 8 / 9: fparam1 the zap
// approach speed, fparam2 / fparam3 the laser / self-destruct attack values,
// iparam1 aim frames, iparam2 hold before the shot, iparam3 wait after it,
// iparam4 shots per volley, iparam5 the flinch hold, iparam6 the Canane's
// out-fighter divisor.
// Heights above the ground: high 45 (the Canane 55, +10 from 0x009235d4),
// low 15, the in-fighter's dive height 15 + 5 r (0x00923544 / 0x00923540);
// the drawn height eases by 0.5 a frame (0x009236b4).
//   The Canane spawns its 8 ring Canadines at state 0's frame 2 (0x00541188)
//   into its CANADINE_GROUP slots (leader + 1 .. + 8), 40 (0x009235f0) around
//   it at its heading + i * 0x2000; the first ceil(8 / iparam6) are
//   out-fighters (laser), the rest in-fighters (zap). The ring does not turn.
//   idle (2, 0x00540ee0): standalone ones and the Canane look within 200;
//     ring members do not search.
//   notice (3, 0x0053e37c / 0x00541688): the Canane hands its target to the
//     ring with stagger timers 2 + 2 i; each one fades its eye in (0.06 a
//     frame, 0x00923700) and the Canane gives the go when all have.
//   rise (4): to the high height, then the attack choice (0x1ac): in-fighter
//     -> zap; ring out-fighter -> laser; standalone out-fighter and the
//     Canane cycle laser, laser, zap.
//   ring hover (5, 0x00540cb0): at the high height facing the target until
//     the Canane releases it; out-fighters blink pattern 1 then fire, in-
//     fighters blink pattern 3, dive to their low height, then zap. The
//     patterns (0x009bcf20) take 2 frames a character (0x00923704).
//   laser (6, 0x00540574): approach (turn 0x200, 0.5 a frame) to within 70
//     (0x00923604), open the shell (animation 2 -> 1), aim iparam1 frames,
//     hold iparam2, fire (0x00542cbc: 20 a frame on the XZ plane,
//     0x009238dc), wait iparam3; iparam4 shots; then orbit (standalone /
//     free) or back to the ring slot (9).
//   zap (7, 0x0053fe00): track 40 frames (turn 0x400); within 40
//     (0x00923638) approach, else dash: 4 frames at 10.607 a frame
//     (0x0092364c, 0x00923628) to the target turned +-45 degrees, the sign
//     alternating, invulnerable; approach: to the low height at fparam1
//     (turn 0x200); within 18 (0x00923650) below 20 (0x00923740) the zap:
//     frame 25 try_hit_entity(1.0) + cause_knockback(3.0) (an android is
//     shocked with 0.05, 0x00923658); after frame 50, 3 zaps -> orbit, else
//     within 13 (0x0092363c) zap again, within 40 approach, else dash.
//   orbit (8, 0x0053fa3c): 31 frames at the high height, then 8 frames
//     orbiting the target (round((+-12288 + 8192 r) * 0.125) BAMS a frame,
//     radius to 70) rising (high - alt) / 8 a frame, invulnerable; 4 orbits
//     -> the attack choice.
//   back to the ring (9, 0x0053f928): close the shell, walk home at 0.8,
//     within 1 (0x00923688) -> hover; it tells the Canane (flag 8).
//   self-destruct (10, 0x0053f6fc): the Canane's death; 150 frames chasing
//     (turn 0x200, 0.68) at the low height, then the blast (0x009bcf0c)
//     at its position.
//   The Canane (0x00541da4): blink pattern 0, release the out-fighters, wait
//   for flag 8 (a child back at its slot, or 8 - ceil(8 / iparam6) or fewer
//   alive), blink pattern 2, release the in-fighters. A child's death
//   (0x00541c10) with 4 or fewer alive frees everyone (blink pattern 4); 2 or
//   fewer alive -> the Canane and the rest leave (state 11, no EXP).
export const CANADINE = {
  search: 200,
  high: 45,
  cananeHigh: 55,
  low: 15,
  ease: 0.5,
  ringRadius: 40,
  fade: Math.fround(0.06),
  approachTurn: 0x200,
  approachSpeed: 0.5,
  laserRange: 70,
  laserSpeed: 20,
  trackFrames: 40,
  trackTurn: 0x400,
  near: 40,
  dashFrames: 4,
  dashSpeed: Math.fround(10.606601715087891),
  zapRange: 18,
  zapHeight: 20,
  zapFrame: 25,
  zapEnd: 50,
  zapAgain: 13,
  zaps: 3,
  shockChance: Math.fround(0.05),
  orbitTrack: 31,
  orbitFrames: 8,
  orbitRadius: 70,
  orbits: 4,
  homeSpeed: 0.8,
  boomFrames: 150,
  boomSpeed: Math.fround(0.68),
  knockback: 3,
  // ASSUMED: the radius of the laser's and the blast's attack record
  // ({kind 3, value, 0, 3.0, 1}); its 3.0 is taken as cause_knockback and
  // the hit as try_hit_entity(1.0).
  hitRadius: 3,
  blink: [24, 10, 27, 12, 33].map((n) => n * 2),
} as const;

// The Canadine's laser (0x00542cbc): 20 a frame on the XZ plane to the point
// it was fired at; it hits there.
export class CanadineLaser extends EnemyShot {
  readonly effect = { kind: 'melee', mult: 1, knockback: CANADINE.knockback } as const;
  readonly look = { color: 0x60c0ff, size: 1.2 };
  private tx: number;
  private tz: number;

  constructor(x: number, y: number, z: number, tx: number, tz: number) {
    super(x, y, z);
    this.tx = tx;
    this.tz = tz;
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    const d = Math.hypot(this.tx - this.x, this.tz - this.z);
    if (d <= CANADINE.laserSpeed) {
      this.x = this.tx;
      this.z = this.tz;
      this.y = 0;
      this.done = true;
      return this.within(targets, CANADINE.hitRadius);
    }
    this.x += ((this.tx - this.x) / d) * CANADINE.laserSpeed;
    this.z += ((this.tz - this.z) / d) * CANADINE.laserSpeed;
    // It only drops over the last 20 units: ASSUMED level flight before.
    return [];
  }
}

export type CanadineState = 'idle' | 'notice' | 'rise' | 'hover' | 'laser' | 'zap' | 'orbit' | 'return' | 'boom' | 'lost' | 'gone' | 'dead';

export class CanadineAi extends BrainBase {
  state: CanadineState = 'idle';
  readonly kind: 'standalone' | 'ring' | 'canane';
  inFighter: boolean;
  free: boolean; // flag 0x100000: acts on its own
  released = false; // flag 4
  noticed = false; // flag 0x8000
  go = false; // flag 2
  alt: number;
  protected mv: EnemyMovementData;
  protected reach: number;
  protected homeX: number;
  protected homeZ: number;
  protected high: number;
  protected diveAlt: number;
  protected timer = 0;
  protected frames = 0;
  protected sub = 0;
  protected count = 0;
  protected cycle = 0;
  protected side = 1;
  protected stagger = 0;
  protected orbitStep = 0;
  protected orbitAngle = 0;
  protected orbitRadius = 0;
  protected open = false;

  constructor(opts: { x: number; z: number; angle: number; kind: 'standalone' | 'ring' | 'canane'; inFighter: boolean; movement: EnemyMovementData | null; attack: EnemyAttackData | null; radius: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.kind = opts.kind;
    this.inFighter = opts.inFighter;
    this.free = opts.kind === 'standalone';
    this.mv = opts.movement ?? EMPTY_MV;
    this.reach = (opts.attack?.distanceX ?? 0) + opts.radius;
    this.homeX = opts.x;
    this.homeZ = opts.z;
    this.high = opts.kind === 'canane' ? CANADINE.cananeHigh : CANADINE.high;
    this.diveAlt = CANADINE.low + 5 * this.rng();
    this.alt = CANADINE.low;
    this.current = loop(4, 0.2);
  }

  get invulnerable(): boolean {
    return (this.state === 'zap' && this.sub === 1) || (this.state === 'orbit' && this.sub === 1);
  }

  protected ease(want: number): boolean {
    this.alt += Math.max(-CANADINE.ease, Math.min(CANADINE.ease, want - this.alt));
    return Math.abs(want - this.alt) < 1e-3;
  }

  protected setOpen(out: AiFrame, open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.play(out, open ? once(1, 0.5) : once(0, 0.5));
  }

  // Notice from the Canane: its target and the stagger timer (2 + 2 i).
  alert(targetId: number, stagger: number): void {
    if (this.state !== 'idle') return;
    this.targetId = targetId;
    this.stagger = stagger;
    this.state = 'notice';
    this.timer = 0;
  }

  protected enter(out: AiFrame, state: CanadineState): void {
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    this.sub = 0;
    this.count = 0;
    if (state === 'return') this.setOpen(out, false);
    if (state === 'laser' || state === 'zap' || state === 'orbit' || state === 'boom') this.current = this.current ?? loop(4, 0.2);
  }

  // 0x1ac: the attack choice.
  protected choose(out: AiFrame): void {
    if (this.kind !== 'canane' && this.inFighter) this.enter(out, 'zap');
    else if (this.kind === 'ring' && !this.free) this.enter(out, 'laser');
    else this.enter(out, this.cycle++ % 3 === 2 ? 'zap' : 'laser');
  }

  // The Canane's death: every child self-destructs (flag 0x20).
  selfDestruct(): void {
    if (this.state === 'dead' || this.state === 'gone') return;
    this.state = 'boom';
    this.timer = 0;
  }

  // Flag 0x40: leave without EXP (state 11).
  leave(): void {
    if (this.state !== 'dead') this.state = 'gone';
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead' || this.state === 'gone') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    let t = this.target(targets);
    const face = (turn: number) => {
      if (t) this.angle = turnToward(this.angle, this.angleTo(t), turn * BAMS_TO_RAD);
    };
    const move = (want: number, turn: number, v: number) => {
      this.angle = turnToward(this.angle, want, turn * BAMS_TO_RAD);
      this.x += Math.sin(this.angle) * v;
      this.z += Math.cos(this.angle) * v;
    };
    switch (this.state) {
      case 'idle': {
        if (this.kind === 'ring') break;
        this.ease(this.kind === 'canane' ? 25 : CANADINE.low);
        const n = nearest(targets, this.x, this.z, CANADINE.search);
        if (n) this.alert(n.clientId, 0);
        break;
      }
      case 'notice':
        // ASSUMED: the eye fade takes 1 / 0.06 frames.
        if (this.timer > this.stagger + Math.ceil(1 / CANADINE.fade)) this.noticed = true;
        if (this.noticed && (this.kind === 'standalone' || this.go)) this.enter(out, this.kind === 'ring' ? 'hover' : 'rise');
        break;
      case 'rise':
        face(CANADINE.trackTurn);
        if (this.ease(this.high) && (this.kind !== 'canane' || this.released)) this.choose(out);
        break;
      case 'hover':
        face(CANADINE.trackTurn);
        if (!this.released) {
          this.ease(this.high);
          break;
        }
        if (this.sub === 0) {
          this.sub = 1;
          this.count = CANADINE.blink[this.inFighter ? 3 : 1];
          if (this.inFighter) this.setOpen(out, true);
        } else if (this.count > 0) this.count--;
        else if (!this.inFighter || this.ease(this.diveAlt)) this.choose(out);
        break;
      case 'laser': {
        if (!t) {
          this.enter(out, 'lost');
          break;
        }
        if (this.sub === 0) {
          this.ease(this.high);
          move(this.angleTo(t), CANADINE.approachTurn, this.dist(t) > CANADINE.laserRange ? CANADINE.approachSpeed : 0);
          if (this.dist(t) <= CANADINE.laserRange) {
            this.sub = 1;
            this.setOpen(out, true);
          }
        } else if (this.sub === 1) {
          face(CANADINE.trackTurn);
          if (animationEnded || this.count++ > 30) {
            this.sub = 2;
            this.count = Math.max(0, this.mv.iparam[0] ?? 0);
          }
        } else if (this.sub === 2) {
          face(CANADINE.trackTurn);
          if (--this.count <= 0) {
            this.sub = 3;
            this.count = Math.max(0, this.mv.iparam[1] ?? 0);
          }
        } else if (this.sub === 3) {
          if (--this.count <= 0) {
            out.shots = [new CanadineLaser(this.x, this.alt, this.z, t.x, t.z)];
            this.sub = 4;
            this.count = Math.max(0, this.mv.iparam[2] ?? 0);
            this.orbitStep++;
          }
        } else if (--this.count <= 0) {
          if (this.orbitStep < Math.max(1, this.mv.iparam[3] ?? 1)) this.sub = 0;
          else {
            this.orbitStep = 0;
            this.setOpen(out, false);
            this.enter(out, this.free ? 'orbit' : 'return');
          }
        }
        break;
      }
      case 'zap': {
        if (!t) {
          this.enter(out, 'lost');
          break;
        }
        const d = this.dist(t);
        if (this.sub === 0) {
          face(CANADINE.trackTurn);
          if (this.timer >= CANADINE.trackFrames) {
            this.timer = 0;
            this.sub = d < CANADINE.near ? 2 : 1;
          }
        } else if (this.sub === 1) {
          const want = this.angleTo(t) + this.side * (Math.PI / 4);
          this.angle = want;
          this.x += Math.sin(want) * CANADINE.dashSpeed;
          this.z += Math.cos(want) * CANADINE.dashSpeed;
          this.alt += (CANADINE.low - this.alt) / CANADINE.dashFrames;
          if (this.timer >= CANADINE.dashFrames) {
            this.side = -this.side;
            this.timer = 0;
            this.sub = 0;
          }
        } else if (this.sub === 2) {
          this.ease(CANADINE.low);
          move(this.angleTo(t), CANADINE.approachTurn, this.mv.fparam1 || 0.6);
          if (d < CANADINE.zapRange && this.alt < CANADINE.zapHeight) {
            this.sub = 3;
            this.timer = 0;
          } else if (d > CANADINE.near) {
            this.sub = 1;
            this.timer = 0;
          }
        } else {
          face(CANADINE.approachTurn);
          if (this.timer === CANADINE.zapFrame) {
            this.count++;
            if (this.alt < CANADINE.zapHeight && d <= this.reach) {
              out.hit = { clientId: t.clientId, knockback: CANADINE.knockback, mult: 1 };
              // An android is also shocked with 0.05.
              if (Math.fround(this.rng()) < CANADINE.shockChance && isAndroid(t.charClass)) {
                out.status = { clientId: t.clientId, type: STATUS.shock };
              }
            }
          }
          if (this.timer > CANADINE.zapEnd) {
            this.timer = 0;
            if (this.count >= CANADINE.zaps) this.enter(out, 'orbit');
            else this.sub = d < CANADINE.zapAgain ? 3 : d < CANADINE.near ? 2 : 1;
          }
        }
        break;
      }
      case 'orbit': {
        if (!t) {
          this.enter(out, 'lost');
          break;
        }
        if (this.sub === 0) {
          face(CANADINE.trackTurn);
          this.ease(this.high);
          if (this.timer >= CANADINE.orbitTrack) {
            this.sub = 1;
            this.timer = 0;
            const r = this.rng() * 2 - 1;
            this.orbitStep = Math.round(((this.rng() < 0.5 ? -12288 : 12288) + 8192 * r) * 0.125) * BAMS_TO_RAD;
            this.orbitAngle = Math.atan2(this.x - t.x, this.z - t.z);
            this.orbitRadius = this.dist(t);
          }
        } else {
          this.orbitAngle += this.orbitStep;
          this.orbitRadius += (CANADINE.orbitRadius - this.orbitRadius) / Math.max(1, CANADINE.orbitFrames - this.timer + 1);
          this.x = t.x + Math.sin(this.orbitAngle) * this.orbitRadius;
          this.z = t.z + Math.cos(this.orbitAngle) * this.orbitRadius;
          this.alt += (this.high - this.alt) / CANADINE.orbitFrames;
          this.angle = this.angleTo(t);
          if (this.timer >= CANADINE.orbitFrames) {
            this.sub = 0;
            this.timer = 0;
            if (++this.count >= CANADINE.orbits) {
              this.orbitStep = 0;
              this.choose(out);
            }
          }
        }
        break;
      }
      case 'return': {
        const d = Math.hypot(this.homeX - this.x, this.homeZ - this.z);
        if (d < 1) {
          this.released = false;
          this.enter(out, 'hover');
          break;
        }
        this.ease(this.high);
        move(Math.atan2(this.homeX - this.x, this.homeZ - this.z), CANADINE.trackTurn, Math.min(d, CANADINE.homeSpeed));
        break;
      }
      case 'lost': {
        const n = nearest(targets, this.x, this.z, CANADINE.search);
        if (n) {
          this.targetId = n.clientId;
          t = n;
          this.choose(out);
        } else if (this.timer > 60) {
          const d = Math.hypot(this.homeX - this.x, this.homeZ - this.z);
          if (d > 1) move(Math.atan2(this.homeX - this.x, this.homeZ - this.z), CANADINE.trackTurn, Math.min(d, CANADINE.homeSpeed));
        }
        break;
      }
      case 'boom': {
        if (!t) t = nearest(targets, this.x, this.z, 1e9);
        if (t) {
          this.targetId = t.clientId;
          move(this.angleTo(t), CANADINE.approachTurn, CANADINE.boomSpeed);
        }
        this.ease(CANADINE.low);
        if (this.timer >= CANADINE.boomFrames) {
          for (const p of targets) {
            if (!p.dead && this.dist(p) <= CANADINE.hitRadius + 5) {
              out.hit = { clientId: p.clientId, knockback: CANADINE.knockback, mult: 1 };
              break;
            }
          }
          this.state = 'gone';
        }
        break;
      }
      default:
        exhaustive(this.state);
    }
    out.lift = this.alt;
    return this.finish(out);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead' || this.state === 'gone' || this.state === 'boom') return;
    if (this.targetId === null) this.targetId = clientId;
    this.current = null;
  }

  resume(): string {
    if (this.state === 'dead' || this.state === 'gone' || this.state === 'boom') return this.state;
    const out = this.frame();
    if (this.state === 'idle' || this.state === 'notice' || this.state === 'hover') return this.state;
    this.current = this.open ? loop(5, 0.2) : loop(4, 0.2);
    void out;
    return this.state;
  }
}

// The Canane: a Canadine that leads the ring (0x00541da4 stages).
export class CananeAi extends CanadineAi {
  children: CanadineAi[] = [];
  private stage = 0;
  private stageTimer = 0;
  private freed = false;
  private outCount: number;

  constructor(opts: { x: number; z: number; angle: number; movement: EnemyMovementData | null; attack: EnemyAttackData | null; radius: number; rng?: () => number }) {
    super({ ...opts, kind: 'canane', inFighter: false });
    this.outCount = Math.ceil(8 / Math.max(1, this.mv.iparam[5] || 7));
  }

  // The ring slot of child i (0x00541188).
  ringSlot(i: number): { x: number; z: number; inFighter: boolean } {
    const a = this.angle + (i * Math.PI * 2) / 8;
    return { x: this.x + Math.sin(a) * CANADINE.ringRadius, z: this.z + Math.cos(a) * CANADINE.ringRadius, inFighter: i >= this.outCount };
  }

  private alive(): CanadineAi[] {
    return this.children.filter((c) => c.state !== 'dead' && c.state !== 'gone');
  }

  // A child died or left (0x00541c10). Returns true when the ring leaves.
  childGone(): boolean {
    const n = this.alive().length;
    if (n <= 2) {
      for (const c of this.alive()) c.leave();
      this.leave();
      return true;
    }
    if (!this.freed && n <= 4) {
      this.freed = true;
      this.stage = 7;
      this.stageTimer = CANADINE.blink[4];
    }
    return false;
  }

  override tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    if (this.state === 'notice' && this.timer === 0) {
      this.children.forEach((c, i) => {
        if (this.targetId !== null) c.alert(this.targetId, 2 + 2 * i);
      });
    }
    if (this.state === 'notice' && this.noticed && this.alive().every((c) => c.noticed)) {
      this.go = true;
      for (const c of this.children) c.go = true;
      this.stage = 1;
      this.stageTimer = CANADINE.blink[0];
    }
    const alive = this.alive();
    if (this.stage === 1 && --this.stageTimer <= 0) {
      for (const c of alive) if (!c.inFighter) c.released = true;
      this.stage = 3;
    } else if (this.stage === 3) {
      if (alive.some((c) => c.state === 'return') || alive.length <= 8 - this.outCount) {
        this.stage = 4;
        this.stageTimer = CANADINE.blink[2];
      }
    } else if (this.stage === 4 && --this.stageTimer <= 0) {
      for (const c of alive) if (c.inFighter) c.released = true;
      this.released = true; // ASSUMED: the Canane's own flag 4 comes here
      this.stage = 6;
    } else if (this.stage === 7 && --this.stageTimer <= 0) {
      for (const c of alive) {
        c.free = true;
        c.released = true;
      }
      this.free = true;
      this.released = true;
      this.stage = 8;
    }
    return super.tick(targets, animationEnded);
  }
}
