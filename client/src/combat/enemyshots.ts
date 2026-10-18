// Enemy projectiles of the per-family FSMs (combat/enemyfsm*.ts): the
// Dubchic's laser, the Garanz's homing missiles and ground mines, the Nano
// Dragon's breath. A brain creates the shots and hands them to its owner in
// AiFrame.shots; render/combat.ts ticks them once per game tick, draws them and
// applies `effect` to the local player when a shot reports it.
//
// Heights are above the ground under the enemy that launched the shot (the
// projectiles' own map collision is not reproduced: ASSUMED flat ground).

import type { AiTarget } from './enemyai.ts';

// ASSUMED: the player's hit box radius for projectiles (the player collision
// radius 5 of render/lobbyview.ts; same value as enemyfsm.ts PLAYER_RADIUS).
const PLAYER_RADIUS = 5;
// ASSUMED: the height of the point a shot aims at / hits on a player.
export const PLAYER_AIM_HEIGHT = 10;

// What a shot does to a player it hits:
//   tech: entity_hit_by_tech with group 0 (case 0 at 0x00774cc7: damage =
//     trunc((attacker MST * 0.5 + power) * 0.2), no resistance, no evasion
//     roll; render/combat.ts applies it);
//   melee: try_hit_entity(mult) + cause_knockback(knockback);
//   status: a status effect only (combat/status.ts STATUS).
export type ShotEffect =
  | { kind: 'tech'; power: number }
  | { kind: 'melee'; mult: number; knockback: number }
  | { kind: 'status'; status: number };

export interface ShotLook {
  color: number;
  size: number;
}

export abstract class EnemyShot {
  x: number;
  y: number; // above the launch ground
  z: number;
  done = false;
  frames = 0;
  abstract readonly effect: ShotEffect;
  abstract readonly look: ShotLook;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  // One game tick; returns the players the shot hit this tick.
  abstract tick(targets: readonly AiTarget[]): AiTarget[];

  protected within(targets: readonly AiTarget[], radius: number): AiTarget[] {
    return targets.filter((t) => !t.dead && Math.hypot(t.x - this.x, t.z - this.z) <= radius + PLAYER_RADIUS);
  }
}

// --- Dubchic / Gillchic laser ----------------------------------------------
//
// The laser object (spawn 0x005570f0, update 0x00556fa0): velocity
// (0, 0, 7.0) turned by the Dubchic's yaw; a range accumulator gains 7.0 per
// frame (0x00924ea8) and the laser dies at 150 (0x00924ea4); it hits the
// first player within 7.0 on the XZ plane (0xa73b28, written at 0x00557220)
// with entity_hit_by_tech(group 0, power = MovementData iparam4) and is
// destroyed. Every 4th frame a map ray-cast from the previous position ends
// it (not reproduced).
export const LASER = { speed: 7, range: 150, radius: 7 } as const;

export class DubchicLaser extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff5050, size: 1.5 };
  private vx: number;
  private vz: number;
  private travelled = 0;

  constructor(x: number, y: number, z: number, angle: number, power: number) {
    super(x, y, z);
    this.vx = Math.sin(angle) * LASER.speed;
    this.vz = Math.cos(angle) * LASER.speed;
    this.effect = { kind: 'tech', power };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.z += this.vz;
    this.travelled += LASER.speed;
    const hit = this.within(targets, LASER.radius - PLAYER_RADIUS)[0];
    if (hit) {
      this.done = true;
      return [hit];
    }
    if (this.travelled >= LASER.range) this.done = true;
    return [];
  }
}

// --- Garanz homing missile ----------------------------------------------------
//
// Spawn 0x00570810, update 0x005709e0: the initial velocity is
// (0, 0, speed = MovementData fparam4) turned by the yaw and the pitch; from
// age > 14 it homes while the target is farther than `steer`
// (vel += normalize(to target) * steer, then vel = normalize(vel) * speed);
// within 22.0 (0x00926a48) of the ground it tests a body of radius 4.0
// against the players; it lives until age > iparam2 + 150; it explodes with
// radius 6.0 and hits with entity_hit_by_tech(group 0, power = iparam3).
export const MISSILE = { homeAfter: 14, lowHeight: 22, body: 4, blast: 6, baseLife: 150 } as const;

export class GaranzMissile extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xffa040, size: 1.5 };
  private vx: number;
  private vy: number;
  private vz: number;
  private speed: number;
  private steer: number;
  private life: number;
  readonly targetId: number | null;

  constructor(opts: { x: number; y: number; z: number; yaw: number; pitch: number; speed: number; steer: number; lifeAdjust: number; power: number; targetId: number | null }) {
    super(opts.x, opts.y, opts.z);
    const c = Math.cos(opts.pitch);
    this.vx = Math.sin(opts.yaw) * c * opts.speed;
    this.vz = Math.cos(opts.yaw) * c * opts.speed;
    this.vy = Math.sin(opts.pitch) * opts.speed;
    this.speed = opts.speed;
    this.steer = opts.steer;
    this.life = opts.lifeAdjust + MISSILE.baseLife;
    this.effect = { kind: 'tech', power: opts.power };
    this.targetId = opts.targetId;
  }

  private explode(targets: readonly AiTarget[]): AiTarget[] {
    this.done = true;
    return this.within(targets, MISSILE.blast);
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    const t = targets.find((p) => p.clientId === this.targetId && !p.dead) ?? null;
    if (t && this.frames > MISSILE.homeAfter) {
      const dx = t.x - this.x;
      const dy = PLAYER_AIM_HEIGHT - this.y;
      const dz = t.z - this.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > this.steer) {
        this.vx += (dx / d) * this.steer;
        this.vy += (dy / d) * this.steer;
        this.vz += (dz / d) * this.steer;
        const v = Math.hypot(this.vx, this.vy, this.vz) || 1;
        this.vx = (this.vx / v) * this.speed;
        this.vy = (this.vy / v) * this.speed;
        this.vz = (this.vz / v) * this.speed;
      }
    }
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    // ASSUMED: reaching the ground is the ray-cast hit that makes it explode.
    if (this.y <= 0) return this.explode(targets);
    if (this.y < MISSILE.lowHeight && this.within(targets, MISSILE.body).length) return this.explode(targets);
    if (this.frames > this.life) return this.explode(targets);
    return [];
  }
}

// --- Garanz ground mine ------------------------------------------------------
//
// Spawn 0x0056e9f8, object 0x0056ff84, update 0x00570128: launched at 0.5 a
// frame toward the heading + 0x8000 (backwards) with gravity -0.10889 a frame
// (0x009269f4); once landed it turns by a random (r * 240 - 120) degrees and
// crawls 0.8 a frame (0x009269ec) for 50 units (0x009269e8), then stops. Its
// collision is armed after 15 frames; contact radius 3.0; it explodes on
// contact or at 150 frames with radius 5.0, entity_hit_by_tech(group 0,
// power = iparam4).
export const MINE = { launch: 0.5, gravity: Math.fround(0.10889), crawl: Math.fround(0.8), crawlRange: 50, arm: 15, contact: 3, blast: 5, life: 150 } as const;

export class GaranzMine extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xd0d040, size: 1.8 };
  private angle: number;
  private vy = 0;
  private landed = false;
  private crawled = 0;
  private rng: () => number;

  constructor(x: number, y: number, z: number, heading: number, power: number, rng: () => number) {
    super(x, y, z);
    this.angle = heading + Math.PI;
    this.effect = { kind: 'tech', power };
    this.rng = rng;
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    if (!this.landed) {
      this.vy -= MINE.gravity;
      this.x += Math.sin(this.angle) * MINE.launch;
      this.z += Math.cos(this.angle) * MINE.launch;
      this.y += this.vy;
      if (this.y <= 0) {
        this.y = 0;
        this.landed = true;
        this.angle += ((this.rng() * 240 - 120) * Math.PI) / 180;
      }
    } else if (this.crawled < MINE.crawlRange) {
      this.x += Math.sin(this.angle) * MINE.crawl;
      this.z += Math.cos(this.angle) * MINE.crawl;
      this.crawled += MINE.crawl;
    }
    const contact = this.frames > MINE.arm && this.within(targets, MINE.contact).length > 0;
    if (contact || this.frames >= MINE.life) {
      this.done = true;
      return this.within(targets, MINE.blast);
    }
    return [];
  }
}
