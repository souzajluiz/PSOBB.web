// Per-family enemy state machines of the Caves (PsoBB.exe, Ephinea 1.25.13,
// addresses are VAs): Grass Assassin and Nano Dragon. Same EnemyBrain shape
// as combat/enemyfsm.ts; projectiles in combat/enemyshots.ts. The Evil / Pal
// / Guil Shark runs the Booma handlers (combat/enemyai.ts) with its own AI
// record.

import { BAMS_TO_RAD, type AiFrame, type AiTarget } from './enemyai.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, loop, nearest, once, turnToward, wrap } from './enemyfsm.ts';
import { EnemyShot, PLAYER_AIM_HEIGHT, type ShotEffect, type ShotLook } from './enemyshots.ts';

const EMPTY_MV: EnemyMovementData = { fparam1: 0, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [0, 0, 0, 0, 0, 0] };

// --- Grass Assassin -------------------------------------------------------------
//
// Ctor 0x005249c8 (vtable 0x00b00b60), dispatcher 0x005224d0, table
// 0x009bbaa0, AI record 0x009bbb64 {search 400, speed 0.75 (written at
// 0x00525552), turn 256}. The generic controller 0x00787a80 picks the state:
// no target -> idle, in range of an attack (+0x80 = 0x0052515c) -> that
// attack, else the chase.
//   find target (0x00524d18): every 30 frames the nearest player within 400.
//   attack pick: enraged (flag 0x2000) -> the dash, whatever the range;
//     else AttackData[0] (the slash) then AttackData[1] (the web) when the
//     target is not held, only the slash when it is; a test passes with
//     distance^2 <= (10 (0x009217d4) + distance_x)^2 inside the arc.
//   mode (+0x3a4): 1 when the set's fparam2 <= 0, else 2 (the ambush: the
//     first notice runs at 0.75 * 2 to the point fparam2 ahead of the spawn
//     point, then mode 0).
//   chase (2, 0x00523cb4): v = 0.75, t = 256 (doubled when enraged, the
//     animation too, 0x00921840); substate 0 creeps at v * 0.125
//     (0x00921818) while turning until the target is inside the arc, then
//     substate 1 runs at v; farther than 400 drops the target.
//   slash (3, 0x005238e8): turns 256 until inside the arc, get_random_float
//     <= 0.5 (0x00921824) -> animation 3 (motion 4) else 2 (motion 2), 0.7;
//     at frame 14 try_hit_entity(1.0) and cause_knockback(the damage it
//     returned); then animation 0 for 15 frames.
//   dash (4, 0x00523024), everything at x2: turns 512 until inside the arc;
//     length = max(100 (0x00921838), distance + 30 (0x0092183c) + 10);
//     animation 7 (motion 3, the crouch, invulnerable) then animation 1 at
//     0.75 * 2 toward that point, turning 512; each player touched once:
//     try_hit_entity(1.0), cause_knockback(2 * damage); ends at the point
//     (within speed + radius) or after 150 frames (0x00921848); then
//     animation 0 for 90 frames (0x5a) and the target is cleared.
//   web (5, 0x00522af4): turns 256 until inside AttackData[1]'s arc,
//     animation 4 (motion 5, 0.7); when it ends the web object (0x00522fb4)
//     sits at the target for 180 frames and imposes a hold on that player
//     (6x2C through HandleHardAttackAction_0069375c: duration = frames
//     left, particle 1, the player's x / z, radius^2 0); then animation 1
//     for 15 frames.
//   flinch (7, 0x005228d0): when it ends, HP < max * fparam1 enrages it
//     (flag 0x2000) and drops the target.
export const GRASS = {
  search: 400,
  retarget: 30,
  speed: 0.75,
  turn: 256,
  targetRadius: 10,
  creep: 0.125,
  slashChance: Math.fround(0.5),
  slashFrame: 14,
  slashRecover: 15,
  dashTurn: 512,
  dashMin: 100,
  dashExtra: 30,
  dashTimeout: 150,
  dashRecover: 0x5a,
  dashKb: 2,
  webFrames: 180,
  webRecover: 15,
} as const;

export type GrassState = 'idle' | 'ambush' | 'chase' | 'slash' | 'dash' | 'web' | 'dead';

export class GrassAi extends BrainBase {
  state: GrassState = 'idle';
  enraged = false;
  hpFraction = 1; // the owner keeps it current
  private attacks: Array<EnemyAttackData | null>;
  private radius: number;
  private enrageAt: number;
  private mode: number;
  private ambushX: number;
  private ambushZ: number;
  private timer = 0;
  private frames = 0;
  private sub = 0;
  private wait = 0;
  private dealt = false;
  private dashX = 0;
  private dashZ = 0;
  private touched = new Set<number>();
  private held = new Map<number, number>(); // clientId -> frames of web left

  constructor(opts: { x: number; z: number; angle: number; attacks: Array<EnemyAttackData | null>; radius: number; fparam1: number; fparam2: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.attacks = opts.attacks;
    this.radius = opts.radius;
    this.enrageAt = opts.fparam1;
    this.mode = opts.fparam2 <= 0 ? 1 : 2;
    this.ambushX = opts.x + Math.sin(opts.angle) * opts.fparam2;
    this.ambushZ = opts.z + Math.cos(opts.angle) * opts.fparam2;
    this.current = loop(6, 0.7);
  }

  // The crouch before the dash (flags 0x28).
  get invulnerable(): boolean {
    return this.state === 'dash' && this.sub === 3;
  }

  private mult(): number {
    return this.enraged ? 2 : 1;
  }

  private inArc(t: AiTarget, a: EnemyAttackData | null): boolean {
    const arc = ((a?.angle ?? 0x2000) & 0xffff) * BAMS_TO_RAD;
    return Math.abs(wrap(this.angleTo(t) - this.angle)) <= arc;
  }

  private inRange(t: AiTarget, a: EnemyAttackData | null): boolean {
    if (!a) return false;
    return this.dist(t) ** 2 <= (GRASS.targetRadius + a.distanceX) ** 2 && this.inArc(t, a);
  }

  // 0x0052515c: the attack index, or -1.
  private pick(t: AiTarget): number {
    if (this.enraged) return 2;
    if (this.inRange(t, this.attacks[0])) return 0;
    if (!this.held.has(t.clientId) && this.inRange(t, this.attacks[1])) return 1;
    return -1;
  }

  private enter(out: AiFrame, state: GrassState): void {
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    this.sub = 0;
    this.wait = 0;
    this.dealt = false;
    const m = this.mult();
    if (state === 'idle') {
      this.targetId = null;
      this.play(out, loop(6, 0.7));
    } else if (state === 'ambush' || state === 'chase') this.play(out, loop(7, 1.3 * m));
    else if (state === 'dash') {
      this.touched.clear();
      this.play(out, loop(7, 1.3 * 2));
    } else this.play(out, loop(7, 1.3));
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    for (const [id, n] of this.held) {
      if (n <= 1) this.held.delete(id);
      else this.held.set(id, n - 1);
    }
    let t = this.target(targets);
    if (this.timer % GRASS.retarget === 0 || (!t && this.state === 'idle')) {
      if (this.state === 'idle' || this.state === 'chase') {
        const n = nearest(targets, this.x, this.z, GRASS.search);
        if (n) {
          t = n;
          this.targetId = n.clientId;
        }
      }
    }
    const v = GRASS.speed * this.mult();
    const turn = GRASS.turn * this.mult() * BAMS_TO_RAD;
    switch (this.state) {
      case 'idle':
        if (t) this.enter(out, this.mode === 2 ? 'ambush' : 'chase');
        break;
      case 'ambush': {
        const want = Math.atan2(this.ambushX - this.x, this.ambushZ - this.z);
        this.angle = turnToward(this.angle, want, turn);
        this.x += Math.sin(this.angle) * GRASS.speed * 2;
        this.z += Math.cos(this.angle) * GRASS.speed * 2;
        if (Math.hypot(this.ambushX - this.x, this.ambushZ - this.z) < GRASS.speed * 2 + this.radius) {
          this.mode = 0;
          this.enter(out, 'chase');
        }
        break;
      }
      case 'chase': {
        if (!t || this.dist(t) > GRASS.search) {
          this.enter(out, 'idle');
          break;
        }
        const a = this.pick(t);
        if (a >= 0) {
          this.enter(out, a === 0 ? 'slash' : a === 1 ? 'web' : 'dash');
          break;
        }
        this.angle = turnToward(this.angle, this.angleTo(t), turn);
        if (this.sub === 0) {
          this.x += Math.sin(this.angle) * v * GRASS.creep;
          this.z += Math.cos(this.angle) * v * GRASS.creep;
          if (this.inArc(t, this.attacks[0])) this.sub = 1;
        } else {
          this.x += Math.sin(this.angle) * v;
          this.z += Math.cos(this.angle) * v;
          if (this.dist(t) < v + this.radius) this.sub = 0;
        }
        break;
      }
      case 'slash':
        if (this.sub === 0) {
          if (t) this.angle = turnToward(this.angle, this.angleTo(t), GRASS.turn * BAMS_TO_RAD);
          if (!t || this.inArc(t, this.attacks[0])) {
            this.sub = 1;
            this.frames = 0;
            this.play(out, Math.fround(this.rng()) <= GRASS.slashChance ? once(4, 0.7) : once(2, 0.7));
          }
        } else if (this.sub === 1) {
          if (!this.dealt && this.frames >= GRASS.slashFrame) {
            this.dealt = true;
            if (t && this.inRange(t, this.attacks[0])) out.hit = { clientId: t.clientId, knockback: 0, mult: 1, kbScale: 1 };
          }
          if (animationEnded) {
            this.sub = 2;
            this.wait = GRASS.slashRecover;
            this.play(out, loop(6, 0.7));
          }
        } else if (--this.wait <= 0) this.enter(out, t ? 'chase' : 'idle');
        break;
      case 'web':
        if (this.sub === 0) {
          if (t) this.angle = turnToward(this.angle, this.angleTo(t), GRASS.turn * BAMS_TO_RAD);
          if (!t || this.inArc(t, this.attacks[1])) {
            this.sub = 1;
            this.play(out, once(5, 0.7));
          }
        } else if (this.sub === 1) {
          if (animationEnded) {
            if (t) {
              this.held.set(t.clientId, GRASS.webFrames);
              out.hold = { clientId: t.clientId, frames: GRASS.webFrames, particle: 1, x: t.x, z: t.z, radius2: 0 };
            }
            this.sub = 2;
            this.wait = GRASS.webRecover;
            this.play(out, loop(7, 1.3));
          }
        } else if (--this.wait <= 0) this.enter(out, t ? 'chase' : 'idle');
        break;
      case 'dash': {
        const dt = GRASS.dashTurn * BAMS_TO_RAD;
        if (this.sub === 0) {
          if (t) this.angle = turnToward(this.angle, this.angleTo(t), dt);
          if (!t || this.inArc(t, this.attacks[2])) {
            const len = Math.max(GRASS.dashMin, (t ? this.dist(t) : 0) + GRASS.dashExtra + GRASS.targetRadius);
            this.dashX = this.x + Math.sin(this.angle) * len;
            this.dashZ = this.z + Math.cos(this.angle) * len;
            this.sub = 3;
            this.play(out, once(3, 0.5 * 2));
          }
        } else if (this.sub === 3) {
          if (animationEnded) {
            this.sub = 1;
            this.wait = 0;
            this.play(out, loop(7, 1.3 * 2));
          }
        } else if (this.sub === 1) {
          const sp = GRASS.speed * 2;
          this.angle = turnToward(this.angle, Math.atan2(this.dashX - this.x, this.dashZ - this.z), dt);
          this.x += Math.sin(this.angle) * sp;
          this.z += Math.cos(this.angle) * sp;
          // ASSUMED: "touched" is the two bodies overlapping (10 + 5).
          for (const p of targets) {
            if (p.dead || this.touched.has(p.clientId)) continue;
            if (this.dist(p) <= this.radius + 5) {
              this.touched.add(p.clientId);
              out.hit = { clientId: p.clientId, knockback: 0, mult: 1, kbScale: GRASS.dashKb };
            }
          }
          if (Math.hypot(this.dashX - this.x, this.dashZ - this.z) < sp + this.radius || ++this.wait > GRASS.dashTimeout) {
            this.sub = 2;
            this.wait = GRASS.dashRecover;
            this.play(out, loop(6, 0.7));
          }
        } else if (--this.wait <= 0) this.enter(out, 'idle');
        break;
      }
    }
    return this.finish(out);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    this.current = null;
  }

  // The flinch ended (0x005228d0): HP below max * fparam1 enrages it.
  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    if (!this.enraged && this.hpFraction < this.enrageAt) {
      this.enraged = true;
      this.targetId = null;
      this.enter(out, 'idle');
      return this.state;
    }
    this.enter(out, this.targetId !== null ? 'chase' : 'idle');
    return this.state;
  }
}

// --- Nano Dragon ------------------------------------------------------------------
//
// Ctor 0x0057f6b0 (vtable 0x00b074e0, update 0x0057d578, dispatcher
// 0x0057d734), table 0x009befc0, AI record 0x009bf0d0 {search 150, 0.46296
// (written at 0x0057fad2), turn 768}. It walks at 0.46296 * 0.6 (0x009278ec);
// it is drawn 15 (0x009279bc) + its flight height (+0x40c) above the ground.
// MovementData (copied by 0x0057f588): fparam1 cruise speed, fparam2 breath
// speed and radius, fparam3 homing shot speed and radius, fparam4 / fparam5
// the shot's steer and its growth per frame, iparam1 breath damage, iparam2
// shot damage (both entity_hit_by_tech group 0).
//   targeting (0x0057f3b8): idle every 30 frames looks within 150 -> combat;
//     in combat a target within 50 -> take-off, none within 200
//     (0x009278f8) -> idle.
//   idle (0, 0x0057f18c): animation 1 (motion 11, 0.8) toward a wander point
//     (angle r * 65536, distance (r + 1) * param2 * 0.4 (0x009278fc) from
//     the spawn point, a new one within 20) for 150 frames, then animation 0
//     (motion 10, 0.8) for 90.
//   combat (1, 0x0057ee30): it circles (heading + 384 a frame at the walk
//     speed) for a full turn, then walks; a target within 400 (0x0092791c)
//     inside +-0xaaa of its heading: above a quarter of its HP it alternates
//     the volley (9) and the breath (10), below always the breath.
//   volley (9, 0x0057e36c): up to 12 players within 400 inside +-0xaab;
//     animation 2 (motion 0, 0.7) for 90 frames; at frame 20
//     (0x0092796c) one homing shot (0x00580544) per player at the heading
//     +-0x2000.
//   breath (10, 0x0057dfb0): animation 2 on the ground, 9 (motion 8, 0.7)
//     in the air, 90 frames facing the target; at frame 20 (0x00927978) the
//     breath (0x0057ff44) toward the target. After either: in the air ->
//     take-off, else idle.
//   take-off (0xb, 0x0057d8d4): animation 6 (motion 9, 0.9, then 7 =
//     motion 5 loop 1.4); from frame 22 (0x00927994) the height rises 2.2 a
//     frame (0x0092797c); at 50 (0x00927980) it flies at fparam1 to its
//     destination (200 rays at 120 degree steps from the target-to-self
//     direction, the longest clear one minus 20; in the air: the target),
//     turning 1536; within 10 + speed (0x00927998) it descends 2.3 a frame
//     (0x00927988), animation 8 (motion 7, 1.4), and lands -> idle.
//   flinch (4, 0x0057eb7c): animation 3 / 10; when it ends, more than a
//     quarter of the HP stored at the last flinch lost -> the breath back at
//     the attacker (in the air only within 20); else idle / take-off.
export const NANO = {
  search: 150,
  searchEvery: 30,
  near: 50,
  lose: 200,
  turn: 768,
  walk: Math.fround(0.46296295523643494) * Math.fround(0.6),
  base: 15,
  circleStep: 384,
  attackRange: 400,
  attackArc: 0xaaa,
  volleyArc: 0xaab,
  volleyMax: 12,
  volleySpread: 0x2000,
  attackTimer: 90,
  fireFrame: 20,
  idleWalk: 150,
  idleStand: 90,
  wanderScale: Math.fround(0.4),
  wanderNear: 20,
  riseFrame: 22,
  rise: Math.fround(2.2),
  cruise: 50,
  fall: Math.fround(2.3),
  arrive: 10,
  flyTurn: 1536,
  relocate: 200,
  breathRange: 500,
  shotLife: 90,
  shotNear: 150,
  // ASSUMED: the mouth height above its feet.
  mouth: 10,
} as const;

export type NanoState = 'idle' | 'combat' | 'volley' | 'breath' | 'takeoff' | 'dead';

// The breath (update 0x0057fcc0): fparam2 a frame toward the target; it
// pierces, hitting every player within fparam2 each frame, and dies after 500
// units (0x00927b8c).
export class NanoBreath extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff7020, size: 3 };
  private vx: number;
  private vy: number;
  private vz: number;
  private speed: number;
  private travelled = 0;

  constructor(x: number, y: number, z: number, tx: number, ty: number, tz: number, speed: number, power: number) {
    super(x, y, z);
    const d = Math.hypot(tx - x, ty - y, tz - z) || 1;
    this.speed = Math.max(0.1, speed);
    this.vx = ((tx - x) / d) * this.speed;
    this.vy = ((ty - y) / d) * this.speed;
    this.vz = ((tz - z) / d) * this.speed;
    this.effect = { kind: 'tech', power };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    this.travelled += this.speed;
    if (this.travelled >= NANO.breathRange || this.y <= 0) this.done = true;
    return targets.filter((t) => !t.dead && Math.hypot(t.x - this.x, PLAYER_AIM_HEIGHT - this.y, t.z - this.z) <= this.speed + 5);
  }
}

// The homing shot (0x00580544, update 0x00580270): speed fparam3; the steer
// starts at fparam4 (x2 within 150 of the target, 0x00927bcc) and grows by
// fparam5 a frame; vel += normalize(to target) * steer, renormalised to the
// speed; 90 frames; hits within fparam3 (iparam2).
export class NanoShot extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xffd060, size: 1.5 };
  private vx: number;
  private vy = 0;
  private vz: number;
  private speed: number;
  private steer: number;
  private grow: number;
  readonly targetId: number;

  constructor(opts: { x: number; y: number; z: number; yaw: number; speed: number; steer: number; grow: number; power: number; targetId: number; near: boolean }) {
    super(opts.x, opts.y, opts.z);
    this.speed = Math.max(0.1, opts.speed);
    this.vx = Math.sin(opts.yaw) * this.speed;
    this.vz = Math.cos(opts.yaw) * this.speed;
    this.steer = opts.steer * (opts.near ? 2 : 1);
    this.grow = opts.grow;
    this.targetId = opts.targetId;
    this.effect = { kind: 'tech', power: opts.power };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    if (++this.frames > NANO.shotLife) {
      this.done = true;
      return [];
    }
    const t = targets.find((p) => p.clientId === this.targetId && !p.dead);
    if (t) {
      const dx = t.x - this.x;
      const dy = PLAYER_AIM_HEIGHT - this.y;
      const dz = t.z - this.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      this.vx += (dx / d) * this.steer;
      this.vy += (dy / d) * this.steer;
      this.vz += (dz / d) * this.steer;
      this.steer += this.grow;
      const v = Math.hypot(this.vx, this.vy, this.vz) || 1;
      this.vx = (this.vx / v) * this.speed;
      this.vy = (this.vy / v) * this.speed;
      this.vz = (this.vz / v) * this.speed;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    const hit = targets.find((p) => !p.dead && Math.hypot(p.x - this.x, PLAYER_AIM_HEIGHT - this.y, p.z - this.z) <= this.speed + 5);
    if (hit) {
      this.done = true;
      return [hit];
    }
    return [];
  }
}

export class NanoDragonAi extends BrainBase {
  state: NanoState = 'idle';
  height = 0; // +0x40c
  hpFraction = 1; // the owner keeps it current
  private mv: EnemyMovementData;
  private spawnX: number;
  private spawnZ: number;
  private wanderRadius: number;
  private timer = 0;
  private frames = 0;
  private sub = 0;
  private circled = 0;
  private toggle = false;
  private fired = false;
  private wanderX: number;
  private wanderZ: number;
  private destX = 0;
  private destZ = 0;
  private flinchHp = 1;
  private volleyIds: number[] = [];

  constructor(opts: { x: number; z: number; angle: number; param2: number; movement: EnemyMovementData | null; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.mv = opts.movement ?? EMPTY_MV;
    this.spawnX = this.wanderX = opts.x;
    this.spawnZ = this.wanderZ = opts.z;
    this.wanderRadius = Math.max(0, opts.param2);
    this.current = loop(11, 0.8);
  }

  get airborne(): boolean {
    return this.height > 5; // 0x009279b4
  }

  private pickWander(): void {
    const a = this.rng() * Math.PI * 2;
    const d = (this.rng() + 1) * this.wanderRadius * NANO.wanderScale;
    this.wanderX = this.spawnX + Math.sin(a) * d;
    this.wanderZ = this.spawnZ + Math.cos(a) * d;
  }

  private enter(out: AiFrame, state: NanoState, targets: readonly AiTarget[] = []): void {
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    this.sub = 0;
    this.fired = false;
    if (state === 'idle') {
      this.targetId = null;
      this.sub = 1;
      this.pickWander();
      this.play(out, loop(11, 0.8));
    } else if (state === 'combat') {
      this.sub = 1;
      this.circled = 0;
      this.play(out, loop(11, 0.8));
    } else if (state === 'volley') {
      this.volleyIds = targets
        .filter((p) => !p.dead && this.dist(p) < NANO.attackRange && Math.abs(wrap(this.angleTo(p) - this.angle)) <= NANO.volleyArc * BAMS_TO_RAD)
        .slice(0, NANO.volleyMax)
        .map((p) => p.clientId);
      this.play(out, once(0, 0.7));
    } else if (state === 'breath') {
      this.play(out, this.airborne ? once(8, 0.7) : once(0, 0.7));
    } else if (state === 'takeoff') {
      const t = this.target(targets);
      if (this.airborne && t) {
        this.destX = t.x;
        this.destZ = t.z;
        this.sub = 1;
        this.play(out, loop(5, 1.4));
      } else {
        // ASSUMED: no map rays; the first of the three directions (away
        // from the target) is clear.
        const away = t ? Math.atan2(this.x - t.x, this.z - t.z) : this.angle;
        this.destX = this.x + Math.sin(away) * (NANO.relocate - 20);
        this.destZ = this.z + Math.cos(away) * (NANO.relocate - 20);
        this.sub = 0;
        this.play(out, once(9, 0.9));
      }
    }
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    const t = this.target(targets);
    switch (this.state) {
      case 'idle': {
        if (this.timer % NANO.searchEvery === 0) {
          const n = nearest(targets, this.x, this.z, NANO.search);
          if (n) {
            this.targetId = n.clientId;
            this.flinchHp = this.hpFraction;
            this.enter(out, 'combat');
            break;
          }
        }
        if (this.sub === 1) {
          if (Math.hypot(this.wanderX - this.x, this.wanderZ - this.z) < NANO.wanderNear) this.pickWander();
          this.walk(Math.atan2(this.wanderX - this.x, this.wanderZ - this.z));
          if (this.timer >= NANO.idleWalk) {
            this.sub = 2;
            this.timer = 0;
            this.play(out, once(10, 0.8));
          }
        } else if (this.timer >= NANO.idleStand) {
          this.sub = 1;
          this.timer = 0;
          this.play(out, loop(11, 0.8));
        }
        break;
      }
      case 'combat': {
        if (!t || this.dist(t) > NANO.lose) {
          this.enter(out, 'idle');
          break;
        }
        if (this.dist(t) < NANO.near) {
          this.enter(out, 'takeoff', targets);
          break;
        }
        if (this.dist(t) < NANO.attackRange && Math.abs(wrap(this.angleTo(t) - this.angle)) <= NANO.attackArc * BAMS_TO_RAD) {
          let next: NanoState = 'breath';
          if (this.hpFraction > 0.25) {
            this.toggle = !this.toggle;
            next = this.toggle ? 'volley' : 'breath';
          }
          this.enter(out, next, targets);
          break;
        }
        if (this.sub === 1) {
          this.angle = wrap(this.angle + NANO.circleStep * BAMS_TO_RAD);
          this.forward(NANO.walk);
          this.circled += NANO.circleStep;
          if (this.circled >= 0x10000) this.sub = 2;
        } else {
          // ASSUMED: the wander of substate 2 heads for the target.
          this.walk(this.angleTo(t));
          if (++this.circled > 0x10000 + 100 / NANO.walk) this.enter(out, 'combat');
        }
        break;
      }
      case 'volley':
        if (!this.fired && this.frames >= NANO.fireFrame) {
          this.fired = true;
          const shots: EnemyShot[] = [];
          this.volleyIds.forEach((id, i) => {
            const p = targets.find((q) => q.clientId === id);
            shots.push(
              new NanoShot({
                x: this.x,
                y: NANO.base + this.height + NANO.mouth,
                z: this.z,
                yaw: this.angle + (i % 2 === 0 ? 1 : -1) * NANO.volleySpread * BAMS_TO_RAD,
                speed: this.mv.fparam3,
                steer: this.mv.fparam4,
                grow: this.mv.fparam5,
                power: this.mv.iparam[1] ?? 0,
                targetId: id,
                near: !!p && this.dist(p) < NANO.shotNear,
              }),
            );
          });
          out.shots = shots;
        }
        if (this.timer >= NANO.attackTimer) this.after(out, targets);
        break;
      case 'breath':
        if (t) this.angle = turnToward(this.angle, this.angleTo(t), NANO.turn * BAMS_TO_RAD);
        if (!this.fired && this.frames >= NANO.fireFrame && t) {
          this.fired = true;
          const y = NANO.base + this.height + NANO.mouth;
          out.shots = [new NanoBreath(this.x, y, this.z, t.x, PLAYER_AIM_HEIGHT, t.z, this.mv.fparam2, this.mv.iparam[0] ?? 0)];
        }
        if (!t || this.timer >= NANO.attackTimer) this.after(out, targets);
        break;
      case 'takeoff': {
        if (this.sub === 0) {
          if (this.frames >= NANO.riseFrame) this.height += NANO.rise;
          if (animationEnded) this.play(out, loop(5, 1.4));
          if (this.height >= NANO.cruise) {
            this.height = NANO.cruise;
            this.sub = 1;
            this.play(out, loop(5, 1.4));
          }
        } else if (this.sub === 1) {
          const sp = this.mv.fparam1 || 1;
          const want = Math.atan2(this.destX - this.x, this.destZ - this.z);
          if (this.height > 15) this.angle = turnToward(this.angle, want, NANO.flyTurn * BAMS_TO_RAD);
          this.x += Math.sin(want) * sp;
          this.z += Math.cos(want) * sp;
          if (Math.hypot(this.destX - this.x, this.destZ - this.z) < NANO.arrive + sp) {
            this.sub = 2;
          }
        } else {
          this.height -= NANO.fall;
          // The landing row starts at height <= (1 / +0xcc + 40) * 2.3; +0xcc was
          // not resolved (ASSUMED: at 40).
          if (this.current?.index !== 7 && this.height <= 40) this.play(out, once(7, 1.4));
          if (this.height <= 0) {
            this.height = 0;
            this.enter(out, 'idle');
          }
        }
        break;
      }
    }
    out.lift = NANO.base + this.height;
    return this.finish(out);
  }

  private after(out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.airborne) this.enter(out, 'takeoff', targets);
    else this.enter(out, 'idle');
  }

  private forward(v: number): void {
    this.x += Math.sin(this.angle) * v;
    this.z += Math.cos(this.angle) * v;
  }

  private walk(want: number): void {
    this.angle = turnToward(this.angle, want, NANO.turn * BAMS_TO_RAD);
    this.forward(NANO.walk);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    this.current = null;
  }

  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    const lost = this.flinchHp - this.hpFraction;
    const big = lost > this.flinchHp / 4;
    this.flinchHp = this.hpFraction;
    if (big && !this.airborne) this.enter(out, 'breath');
    else if (this.airborne) this.enter(out, 'takeoff');
    else this.enter(out, 'idle');
    return this.state;
  }
}
