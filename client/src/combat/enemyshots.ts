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
export const PLAYER_RADIUS = 5;
// ASSUMED: the height of the point a shot aims at / hits on a player.
export const PLAYER_AIM_HEIGHT = 10;

// What a shot does to a player it hits:
//   tech: entity_hit_by_tech with group 0 (case 0 at 0x00774cc7: damage =
//     trunc((attacker MST * 0.5 + power) * 0.2), no resistance, no evasion
//     roll; render/combat.ts applies it); `status` is a roll after the hit
//     (the Gibarta / Rabarta freeze of combat/techfire.ts);
//   melee: try_hit_entity(mult) + cause_knockback(knockback);
//   status: a status effect only (combat/status.ts STATUS).
//   megid: an enemy Megid (entity_hit_by_tech's Megid case: death when
//     rand < (power - EDK) * 0.01);
//   heal: an enemy Resta object healing an enemy (the owner applies it).
// A melee effect may use another AttackData row of the enemy (`attack`, the
// index into its ENEMY_TYPE_PARAMS attack list: the Dark Belra's arm uses
// entry 19) and roll a status effect on the player it hit (`status`).
export type ShotEffect =
  | { kind: 'tech'; power: number; knockback?: number; status?: { type: number; chance: number } }
  | { kind: 'melee'; mult: number; knockback: number; attack?: number; status?: { type: number; chance: number } }
  | { kind: 'status'; status: number }
  | { kind: 'megid'; power: number };

export interface ShotLook {
  color: number;
  size: number;
  // Nothing is drawn for the shot itself: its owner's visuals come from
  // elsewhere (combat/techlightning.ts TechShot's events).
  hidden?: boolean;
  // The shot is a model the owner's enemy model built hidden (a part named
  // like this, placed 'world'); render/combat.ts moves it by pose() instead
  // of drawing the ball.
  model?: string;
}

// Where and how a model shot is drawn: height above the launch ground, the
// Y rotation and the scale.
export interface ShotPose {
  y: number;
  yaw: number;
  scale: readonly [number, number, number];
}

export abstract class EnemyShot {
  x: number;
  y: number; // above the launch ground
  z: number;
  done = false;
  frames = 0;
  // y is a world height, not a height above the launch ground (De Rol Le's
  // children, combat/derolle.ts).
  readonly absolute: boolean = false;
  abstract readonly effect: ShotEffect;
  abstract readonly look: ShotLook;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  // The model's placement (only for shots with look.model).
  pose?(): ShotPose;

  // Shots this one makes (a bomb's blast): the owner launches them after the
  // tick that filled it.
  spawned?: EnemyShot[];

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

// --- Dark Belra's thrown arm --------------------------------------------------
//
// Arm object (ctor 0x005398b0, vtable 0x00b02500, update 0x00539948), launched
// by 0x00539fbc along the Belra's heading (no homing) with range 300; the
// flight (0x00539c7c) moves 10.0 a frame (0x009230bc), grows its scale by 0.15
// (0x009230b0) up to 2.0 (0x009230ac) and hits a sphere of scale * 3.0 * 1.8
// (0x00539d88: 5.4 growing to 10.8); it pierces: each player is hit once per
// throw (0x00539f4c: the owner's AttackData switched to entry 19 for the hit,
// then a 3.0 push along arm -> player; in Ultimate a 0.1 (0x00923098) roll
// for entity_hit_by_tech group 18, confusion). It ends after 300 units (the
// wall ray and the map collision are not reproduced).
// ASSUMED: the 3.0 velocity push is drawn as cause_knockback(3.0).
//
// Drawn by the render at 0x00539e5c (state +0xb4 != 0): the arm model
// re7_b1_larm / rarm (model index = the arm, 0 left, 1 right) translated to
// the arm's ground point (+0x38) and lifted by +0xcc = its height above the
// ground, at least 10 (belra_arm_y_offset 0x009230b4: below it the arm is
// raised to 10), turned by the heading it was thrown with (+0x60) and scaled
// (scale, 1, scale) by the growing scale. The ground under it is ASSUMED
// flat (the height stays the launch height). The 0xdd / 0x150 particle
// effects that trail it are not drawn.
export const BELRA_ARM = { speed: 10, range: 300, scaleStep: Math.fround(0.15), scaleMax: 2, radius: Math.fround(3 * 1.8), confuse: Math.fround(0.1), minHeight: 10 } as const;

export class BelraArm extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook;
  private vx: number;
  private vz: number;
  private travelled = 0;
  private scale = 1;
  private struck = new Set<number>();
  private yaw: number;

  constructor(x: number, y: number, z: number, angle: number, ultimate: boolean, arm = 0) {
    super(x, y, z);
    this.yaw = angle;
    this.look = { color: 0x8040c0, size: 3, model: arm === 0 ? 'left arm' : 'right arm' };
    this.vx = Math.sin(angle) * BELRA_ARM.speed;
    this.vz = Math.cos(angle) * BELRA_ARM.speed;
    this.effect = { kind: 'melee', mult: 1, knockback: 3, attack: 1, ...(ultimate ? { status: { type: 0x12, chance: BELRA_ARM.confuse } } : {}) };
  }

  get radius(): number {
    return this.scale * BELRA_ARM.radius;
  }

  override pose(): ShotPose {
    return { y: Math.max(this.y, BELRA_ARM.minHeight), yaw: this.yaw, scale: [this.scale, 1, this.scale] };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.z += this.vz;
    this.travelled += BELRA_ARM.speed;
    this.scale = Math.min(BELRA_ARM.scaleMax, this.scale + BELRA_ARM.scaleStep);
    const hits = this.within(targets, this.radius).filter((t) => !this.struck.has(t.clientId));
    for (const t of hits) this.struck.add(t.clientId);
    if (this.travelled > BELRA_ARM.range) this.done = true;
    return hits;
  }
}

// --- Dark Gunner's laser ------------------------------------------------------
//
// Ctor 0x00546610 (vtable 0x00b035b0, update 0x0054649c): velocity =
// normalize(the player's aim point - the muzzle) * MovementData fparam4, in
// 3D; radius speed * 0.75 (0x00923cc0); its life is round(500 (0x00923cb4) /
// speed) frames (the client shortens it to the first map hit of a 500-unit
// ray: not reproduced); a touched player gets entity_hit_by_tech(group 0,
// power = iparam4) and cause_knockback(3.0), and the laser is deleted.
export const GUNNER_LASER = { reach: 500, radius: Math.fround(0.75), knockback: 3 } as const;

export class GunnerLaser extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook;
  private vx: number;
  private vy: number;
  private vz: number;
  private life: number;
  private radius: number;

  constructor(opts: { x: number; y: number; z: number; tx: number; tz: number; speed: number; power: number; death: boolean }) {
    super(opts.x, opts.y, opts.z);
    const dx = opts.tx - opts.x;
    const dy = PLAYER_AIM_HEIGHT - opts.y;
    const dz = opts.tz - opts.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const v = Math.max(0.1, opts.speed);
    this.vx = (dx / d) * v;
    this.vy = (dy / d) * v;
    this.vz = (dz / d) * v;
    this.life = Math.round(GUNNER_LASER.reach / v);
    this.radius = v * GUNNER_LASER.radius;
    this.effect = { kind: 'tech', power: opts.power, knockback: GUNNER_LASER.knockback };
    // FX 0xd5 (Dark Gunner) / 0xda (Death Gunner); ASSUMED colours.
    this.look = { color: opts.death ? 0xff3030 : 0x40c0ff, size: 1.5 };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    // ASSUMED: the player's body spans the ground to twice its aim height.
    const hit = this.y >= 0 && this.y <= PLAYER_AIM_HEIGHT * 2 ? this.within(targets, this.radius)[0] : undefined;
    if (hit) {
      this.done = true;
      return [hit];
    }
    if (--this.life <= 0) this.done = true;
    return [];
  }
}

// --- Enemy technique bolts (Chaos Sorcerer, Del Lily) -------------------------
//
// The client creates the player's technique objects for the enemy (Gizonde
// CreateTechniqueEffectEntity_006e54a8, Gibarta, Rafoie, Grants, Megid
// create_megid1 / CreateMegidEntity_006e98c0). Their own flight is not
// reproduced: ASSUMED a bolt flying straight at `speed` a frame toward the
// point it was aimed at, hitting the first player within `radius` and ending
// after `range`.
export class TechBolt extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook;
  // The technique and its 0-based level when the owner casts one the client
  // draws as the player's object (render/combat.ts launchShot swaps a Gizonde,
  // Grants or Megid for combat/techlightning.ts' shots).
  readonly tech: { id: number; level: number } | undefined;
  readonly angle: number;
  readonly range: number;
  private vx: number;
  private vz: number;
  private travelled = 0;
  private radius: number;
  private speed: number;
  private pierce: boolean;
  private struck = new Set<number>();

  // pierce: it flies on and hits each player once (the Chaos Bringer's laser).
  constructor(opts: { x: number; y: number; z: number; angle: number; speed: number; range: number; radius: number; effect: ShotEffect; color: number; pierce?: boolean; tech?: { id: number; level: number } }) {
    super(opts.x, opts.y, opts.z);
    this.tech = opts.tech;
    this.angle = opts.angle;
    this.speed = Math.max(0.5, opts.speed);
    this.vx = Math.sin(opts.angle) * this.speed;
    this.vz = Math.cos(opts.angle) * this.speed;
    this.range = opts.range;
    this.radius = opts.radius;
    this.effect = opts.effect;
    this.look = { color: opts.color, size: 2 };
    this.pierce = opts.pierce ?? false;
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.z += this.vz;
    this.travelled += this.speed;
    if (this.travelled >= this.range) this.done = true;
    if (this.pierce) {
      const hits = this.within(targets, this.radius).filter((t) => !this.struck.has(t.clientId));
      for (const t of hits) this.struck.add(t.clientId);
      return hits;
    }
    const hit = this.within(targets, this.radius)[0];
    if (hit) {
      this.done = true;
      return [hit];
    }
    return [];
  }
}
