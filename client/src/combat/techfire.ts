// The technique objects of the FOIE family (Foie, Gifoie, Rafoie) and the BARTA
// family (Barta, Gibarta, Rabarta), as PsoBB.exe runs them (Ephinea 1.25.13,
// addresses are VAs). Pure rules: the spawn, the motion, the hit tests, the
// target selection and the effect tables. render/techfire.ts draws them.
//
// The same objects serve every caster: the cast hands the owner (a player or an
// enemy), the position and the level to a constructor, and the object's
// update asks the collision of its owner's side (a player's object looks at
// the enemies, an enemy's at the players: UpdateAoECollision_006ea7c4 and
// AoE_TechCollisionCheck_006eb0e8).
//
// unknown_cast_tech (0x006e4a8x, `action_launch_tech`) creates them:
//   Foie    create_foie_object1 0x006e2f20 (heading) / create_directed_foie_object
//           0x006e3408 (a point), TechniqueObject_Constructor_006e2f98 / 006e3480;
//           with no target it flies along the heading, Rafoie / Barta / Gibarta
//           likewise except Rafoie (it needs a target);
//   Gifoie  create_gifoie 0x006e46ac (gifoie_constructor), always at the cast point;
//   Rafoie  create_rafoie_object 0x006ed368 (rafoie_constructor 0x006ed8f4);
//   Barta   AntiTechEntity_Constructor_006dd7e4 (heading) / 006dddac (a point);
//   Gibarta unknown_create_sorc_tech 0x006e38e0 (heading) / 0x006e4058 (a point);
//   Rabarta CreateRabartaEntity_006ec2d0 (the caster) / RabartaInit_006ec8ec (a point).
// The cast point is the weapon model node's position (unknown_get_tech_cast_location
// 0x0068c2f4: GetWeaponModelData +0x10 into the player's vtable +0x10c);
// the web client has no weapon node: ASSUMED a point WEAPON_HEIGHT above the feet.
//
// Every object is a 30 Hz update. The shared base (TechniqueEntity_Constructor
// _006efe50 / EffectEntityBaseConstructor_006f0138, EffectEntity_Constructor
// _006de5f0):
//   +0x20 position, +0x48 direction (sin h, 0, cos h) or the normalised vector
//   to the aimed point, +0x64 speed 3.0, +0x70 range 30.0, +0x74 travelled 0,
//   +0xc4 level (clamped 0..30), +0xc6 tier = AllocateEffectBuffer_006e1cec
//   (level / 5, 1..5, else 0), +0x12c hit radius 4.0 (the directed Gibarta
//   12.0), +0x128 the hit box (InitEnemyCollisionBoxes_007b9a88).

import { NO_ORIENT, orientOfDirection, type EffectFx, type Orient } from '../classic/particles.ts';
import { enemyBoxTable } from '../formats/enemyboxes.ts';
import type { CollisionBoxRow } from '../formats/collisionboxes.gen.ts';
import { EnemyShot, type ShotEffect, type ShotLook } from './enemyshots.ts';
import type { AiTarget } from './enemyai.ts';
import { STATUS } from './status.ts';
import { TECH, techData, techPower } from './techniques.ts';

const TAU = Math.PI * 2;
const bamsRad = (b: number): number => ((b & 0xffff) * TAU) / 0x10000;
const f32 = Math.fround;

// ASSUMED fallback: the height above the feet of a gun's bullet start and of the technique cast
// point, used only when the owner has no skeleton (headless, tests). A gun's start is the attach
// node's world point when a skeleton exists (combat/weaponorigin.ts, the weapon's walk entry
// named by ItemPMT +0x1f; PerformItemAttack_005e8908 0x005e8a45 -> get_weapon_position
// 0x005e83c8). The techniques' cast point (unknown_get_tech_cast_location 0x0068c2f4) is not
// moved to the node yet, so this height still stands for them.
// begin_gun_bullet_attack (FUN_005e6578, 0x005e6578) tests the line from
// (player+0x300 x, origin.y, player+0x308 z) to the target, so the y of the start
// is the caller's origin.
export const WEAPON_HEIGHT = 20;
// ASSUMED fallback: the height of the point a technique aims at on an enemy when its
// box table is not known (render/combat.ts). The exe aims at the hit box's centre
// (enemyAimHeight below).
export const AIM_HEIGHT = 22;

// The height above an enemy's origin of the point a technique aims at: the y of the
// hit box's centre (check_enemy_is_targetable, dump 785xxx, measures to each enabled
// box's position2; position2 = origin + RotY * position1, so the y is origin.y +
// position1.y). The box table is the one the enemy's own constructor sets
// (formats/enemyboxes.ts enemyBoxTable, from the .dat set type and the area); an enemy
// whose table is not resolved (a box set through a vtable, or only by a shared helper)
// falls back. ASSUMED: the first enabled row of the table (a multi-box enemy has no per-box
// pick here, the lock-on cursor's box is not modelled). An indexed table (Booma) needs the
// variant (formats/enemyboxes.ts slotVariant).
export function enemyAimHeight(type: number | null, area: number | null = null, variant: number | null = null): number {
  const b = enemyBoxTable(type, area, variant);
  if (!b) return AIM_HEIGHT;
  return rowsAimHeight(b.rows);
}

// The same rule for a box table the caller already has (a loop-built child's table,
// formats/enemyboxes.ts childBoxTable): the first enabled row's centre height.
export function rowsAimHeight(rows: readonly CollisionBoxRow[]): number {
  const row = rows.find((r) => (r.flags & 1) !== 0);
  return row ? row.offset[1] : AIM_HEIGHT;
}

// The round radius the same row gives (null when no row is enabled).
export function rowsRadius(rows: readonly CollisionBoxRow[]): number | null {
  const row = rows.find((r) => (r.flags & 1) !== 0);
  return row ? row.radius : null;
}

export type FireKind = 'foie' | 'gifoie' | 'rafoie' | 'barta' | 'gibarta' | 'rabarta';

export const FIRE_TECHS: readonly number[] = [TECH.foie, TECH.gifoie, TECH.rafoie, TECH.barta, TECH.gibarta, TECH.rabarta];
const KIND_OF: Record<number, FireKind> = {
  [TECH.foie]: 'foie',
  [TECH.gifoie]: 'gifoie',
  [TECH.rafoie]: 'rafoie',
  [TECH.barta]: 'barta',
  [TECH.gibarta]: 'gibarta',
  [TECH.rabarta]: 'rabarta',
};

export function isFireTech(tech: number): boolean {
  return KIND_OF[tech] !== undefined;
}

export function fireKind(tech: number): FireKind | null {
  return KIND_OF[tech] ?? null;
}

// The technique_group each object passes to entity_hit_by_tech (vtable +0x60):
// Foie / Gifoie / Rafoie 1, Gibarta / Rabarta 2, Barta 0x13.
export const HIT_GROUP: Record<FireKind, number> = { foie: 1, gifoie: 1, rafoie: 1, barta: 0x13, gibarta: 2, rabarta: 2 };

// The level the constructors store: the base clamps 0..0x1e (0x1d < level -> 0x1e).
export function objectLevel(level: number): number {
  const l = Math.trunc(level);
  return l < 1 ? 0 : l > 0x1d ? 0x1e : l;
}

// AllocateEffectBuffer_006e1cec: the look / sound tier, level / 5 for 1..5
// (0-based levels 0..4 are 0; level 30 divides to 6, which is 0 again).
export function effectTier(level: number): number {
  const t = Math.trunc(objectLevel(level) / 5);
  return t >= 1 && t <= 5 ? t : 0;
}

// --- targets and hit tests -----------------------------------------------------

/** A hit box the objects test: a round box on the ground plane (collision_box
 * with unk2 = 0 is tested by CheckSphereOverlap_0083dbd4 with y = 0, so only the
 * XZ distance against the sum of the radii counts; render/collision.ts Body). */
export interface TechTarget {
  id: number;
  x: number;
  z: number;
  radius: number;
  /** The target's aim height (the point a Rafoie list-form blast copies each tick, rafoie_aoe_tick). */
  y?: number;
}

// GetCollisionDataForEntity_007b65b4's cut-off: the centres must be within
// sqrt(10000) = 100 (62500 -> 250 for the AoE checks of a player caster, and
// Dark Falz' arena). ASSUMED the distance is the XZ one.
export const HIT_CUTOFF = 100;
export const HIT_CUTOFF_AOE = 250;

/** The swept box of Foie / Barta / Gibarta (UpdateAoECollision_006ea7c4): centre at the
 * midpoint of the last step, half length = half the step along the motion
 * (0x96daa8 = 0.5), half width = the object's +0x12c; the vertical extent
 * (+-50) is ignored (ASSUMED, the hit boxes are tested on the ground plane).
 * True when the box overlaps the round box (cx, cz, radius). */
export function sweptBoxHits(px: number, pz: number, x: number, z: number, halfWidth: number, dirX: number, dirZ: number, cx: number, cz: number, radius: number): boolean {
  const mx = (px + x) / 2;
  const mz = (pz + z) / 2;
  const dx = cx - mx;
  const dz = cz - mz;
  if (dx * dx + dz * dz > HIT_CUTOFF * HIT_CUTOFF) return false;
  const ex = x - px;
  const ez = z - pz;
  const len = Math.hypot(ex, ez);
  let ux = dirX;
  let uz = dirZ;
  if (len > 1e-9) {
    ux = ex / len;
    uz = ez / len;
  }
  const u = Math.abs(dx * ux + dz * uz);
  const v = Math.abs(-dx * uz + dz * ux);
  const a = Math.max(0, u - len / 2);
  const b = Math.max(0, v - halfWidth);
  return a * a + b * b < radius * radius;
}

/** The round box of the AoE objects (Gifoie, Rafoie, Rabarta): radius against the
 * target's radius (CheckSphereOverlap: distance < r1 + r2). */
export function circleHits(x: number, z: number, radius: number, t: TechTarget, cutoff = HIT_CUTOFF_AOE): boolean {
  const dx = t.x - x;
  const dz = t.z - z;
  if (dx * dx + dz * dz > cutoff * cutoff) return false;
  const r = radius + t.radius;
  return dx * dx + dz * dz < r * r;
}

// --- the base ------------------------------------------------------------------

export interface FireOptions {
  level: number; // 0-based
  x: number;
  y: number;
  z: number;
  /** BAMS-free heading in radians (the sin / cos convention of the client). */
  heading: number;
  /** The point a directed object flies at (create_directed_*). */
  aim?: { x: number; y: number; z: number } | null;
  /** An enemy's object (it hits the players, AoE_TechCollisionCheck_006eb0e8 cuts
   * at 100 instead of 250). */
  enemy?: boolean;
}

export abstract class FireObject {
  abstract readonly kind: FireKind;
  readonly tech: number;
  readonly level: number;
  readonly tier: number;
  readonly power: number;
  readonly rangeH: number;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  frames = 0;
  done = false;
  /** Set for the one step in which the object ends on something it hit (the view
   * plays the hit effect there); cleared by the next step. */
  impact = false;
  /** Set for the one step in which a Rafoie explodes. */
  burst = false;
  readonly heading: number;
  readonly directed: boolean;
  /** The centre-distance cut-off of the round-box checks. */
  readonly cutoff: number;

  protected constructor(tech: number, o: FireOptions) {
    this.tech = tech;
    this.level = objectLevel(o.level);
    this.tier = effectTier(this.level);
    const d = techData(tech, this.level);
    this.rangeH = d.rangeH;
    this.power = techPower(tech, this.level);
    this.x = this.px = o.x;
    this.y = this.py = o.y;
    this.z = this.pz = o.z;
    this.heading = o.heading;
    this.directed = !!o.aim;
    this.cutoff = o.enemy ? HIT_CUTOFF : HIT_CUTOFF_AOE;
  }

  get group(): number {
    return HIT_GROUP[this.kind];
  }

  /** One game tick. `hits` is emptied and filled with the targets struck this tick. */
  abstract step(targets: readonly TechTarget[], n: number, hits: TechTarget[]): void;
}

// The direction vector (+0x48, +0x4c, +0x50): sin / cos of the heading, or the
// normalised vector to the aimed point (EffectEntityBaseConstructor_006f0138:
// the Y part is the aim's height minus the start's).
function direction(o: FireOptions): [number, number, number] {
  if (!o.aim) return [Math.sin(o.heading), 0, Math.cos(o.heading)];
  const dx = o.aim.x - o.x;
  const dy = o.aim.y - o.y;
  const dz = o.aim.z - o.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return [Math.sin(o.heading), 0, Math.cos(o.heading)];
  return [dx / len, dy / len, dz / len];
}

// --- Foie ----------------------------------------------------------------------

/** Foie: TechniqueObject (vtable 0x00b3d280). Speed 3 + max(0, level - 4)
 * (TechniqueObject_ApplyPowerAndSpeedStats_006e31e8), range = range_h
 * (+0x70), half width 4. The update (TechniqueEntity_Update_006e36c8): move by
 * direction * speed, end when the travelled length (+0x74, grown by the speed
 * after the test) has passed the range, then the first enemy in the entity
 * array the swept box touches takes the hit (TechniqueEntity_Start_006e3754:
 * entity_hit_by_tech group 1, SE 0xaf at it) and the object is gone. It also
 * ends on the map (a ray from the last to the new point, 0x006f04c0: particles
 * 0x1dc / 0x1dd; ASSUMED not modelled, see render/techfire.ts). */
export class FoieBolt extends FireObject {
  readonly kind = 'foie' as const;
  readonly speed: number;
  readonly halfWidth = 4;
  private dx: number;
  private dy: number;
  private dz: number;
  private travelled = 0;
  /** The struck target of the last step (for the hit sound). */
  struck: TechTarget | null = null;

  constructor(o: FireOptions) {
    super(TECH.foie, o);
    const d = techData(TECH.foie, this.level);
    this.speed = f32(Math.max(0, this.level - 4) + d.speed);
    [this.dx, this.dy, this.dz] = direction(o);
  }

  step(targets: readonly TechTarget[], n: number, hits: TechTarget[]): void {
    hits.length = 0;
    this.impact = false;
    this.struck = null;
    if (this.done) return;
    this.frames++;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.x += this.dx * this.speed;
    this.y += this.dy * this.speed;
    this.z += this.dz * this.speed;
    if (this.rangeH < this.travelled) this.done = true;
    else this.travelled += this.speed;
    for (let i = 0; i < n; i++) {
      const t = targets[i];
      if (!sweptBoxHits(this.px, this.pz, this.x, this.z, this.halfWidth, this.dx, this.dz, t.x, t.z, t.radius)) continue;
      hits.push(t);
      this.struck = t;
      this.impact = true;
      this.done = true;
      break;
    }
  }
}

// --- Gibarta -------------------------------------------------------------------

/** Gibarta: g_TechniqueEntity_vtbl (0x00b3d328), update_gibarta 0x006e4214.
 * Speed 3.0 (the base's +0x64; UpdateTechniqueStatsFromData_006e3a94 does not
 * change it), range = range_h, half width 4 (12 when it is directed). It
 * pierces: ProcessAoECollisionResults_006f06c4 hits every enemy the swept
 * box touches (up to 15 a tick), each one once (a 32-entry list, 0x006e4254),
 * group 2. */
export class GibartaBolt extends FireObject {
  readonly kind = 'gibarta' as const;
  readonly speed = 3;
  readonly halfWidth: number;
  private dx: number;
  private dy: number;
  private dz: number;
  private travelled = 0;
  private readonly struck = new Set<number>();

  constructor(o: FireOptions) {
    super(TECH.gibarta, o);
    this.halfWidth = o.aim ? 12 : 4;
    [this.dx, this.dy, this.dz] = direction(o);
  }

  step(targets: readonly TechTarget[], n: number, hits: TechTarget[]): void {
    hits.length = 0;
    if (this.done) return;
    this.frames++;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.x += this.dx * this.speed;
    this.y += this.dy * this.speed;
    this.z += this.dz * this.speed;
    if (this.rangeH < this.travelled) this.done = true;
    else this.travelled += this.speed;
    for (let i = 0; i < n && hits.length < 15; i++) {
      const t = targets[i];
      if (this.struck.has(t.id) || this.struck.size >= 32) continue;
      if (!sweptBoxHits(this.px, this.pz, this.x, this.z, this.halfWidth, this.dx, this.dz, t.x, t.z, t.radius)) continue;
      this.struck.add(t.id);
      hits.push(t);
    }
  }
}

// --- Barta ---------------------------------------------------------------------

// BartaEntity_UpdatePhysics_006f0568 constants: the ground probe starts 10 above
// the object (0x96deac), the object rides 5 above the ground (0x96dea8) and ends
// when that changes its height by more than 12 (0x96dea4); an undirected Barta
// starts 5 higher (0x96c9b4).
const BARTA_PROBE = 10;
const BARTA_RIDE = 5;
const BARTA_STEP = 12;
export const BARTA_START_LIFT = 5;

/** The ground under (x, z) seen from `fromY` (render/combat.ts ground()). */
export type GroundFn = (x: number, z: number, fromY: number) => number | null;

/** Barta: g_AntiTech vtable 0x00b3ce20 (update_barta 0x006dd?), speed
 * 2 * (level / 5) + 3, range = range_h, half width 4, group 0x13. It moves on
 * the ground plane only (direction x / z), follows the floor 5 above it and ends
 * when the floor changes by more than 12; it pierces and hits every enemy once
 * (barta_hit_entity). The steep-wall test (a ray, normal more than 30 degrees
 * off) is not modelled (no wall data here). */
export class BartaBolt extends FireObject {
  readonly kind = 'barta' as const;
  readonly speed: number;
  readonly halfWidth = 4;
  private dx: number;
  private dz: number;
  private travelled = 0;
  private readonly ground: GroundFn | null;
  private readonly struck = new Set<number>();

  constructor(o: FireOptions, ground: GroundFn | null = null) {
    super(TECH.barta, { ...o, y: o.aim ? o.y : o.y + BARTA_START_LIFT });
    const d = techData(TECH.barta, this.level);
    this.speed = f32(Math.trunc(this.level / 5) * 2 + d.speed);
    const v = direction(o);
    this.dx = v[0];
    this.dz = v[2];
    this.ground = ground;
  }

  step(targets: readonly TechTarget[], n: number, hits: TechTarget[]): void {
    hits.length = 0;
    if (this.done) return;
    this.frames++;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.x += this.dx * this.speed;
    this.z += this.dz * this.speed;
    const g = this.ground?.(this.x, this.z, this.y + BARTA_PROBE);
    if (g !== null && g !== undefined) {
      const ny = g + BARTA_RIDE;
      if (Math.abs(this.py - ny) > BARTA_STEP) {
        this.y = this.py;
        this.done = true;
        return;
      }
      this.y = ny;
    }
    if (this.rangeH < this.travelled) this.done = true;
    else this.travelled += this.speed;
    for (let i = 0; i < n && hits.length < 15; i++) {
      const t = targets[i];
      if (this.struck.has(t.id) || this.struck.size >= 32) continue;
      if (!sweptBoxHits(this.px, this.pz, this.x, this.z, this.halfWidth, this.dx, this.dz, t.x, t.z, t.radius)) continue;
      this.struck.add(t.id);
      hits.push(t);
    }
  }
}

// --- Gifoie --------------------------------------------------------------------

// gifoie_particle_group_counts (0x0096d32c) by tier: how many spiral emitters.
export const GIFOIE_GROUPS: readonly number[] = [1, 1, 1, 2, 2, 3];
// g_ParticleTable_0096d340: the wobble's height by tier % 3 (0, 3.5, 7).
const GIFOIE_WOBBLE: readonly number[] = [0, 3.5, 7];
export const GIFOIE_GROW = f32(0.55); // 0x0096d37c: the spiral radius a frame
export const GIFOIE_BODY = 5; // 0x0096d390: the hit disc is the ring's distance + 5
const GIFOIE_OFFSET = 10; // the emitters start 10 from the cast point (0, 0, -10)

/** Gifoie: vtable 0x00b3d3f8 (update_gifoie 0x006e4dbc), hit entity_hit_by_gifoie
 * 0x006e4e80, group 1. At the cast point it makes `GIFOIE_GROUPS[tier]` spiral
 * emitters (ParticleEffect_Gifoie_Update_006e50f4): emitter i is centred 10 from
 * the cast point at 0x4000 + i * (360 / n) degrees (rotated (0, 0, -10)),
 * its radius grows 0.55 a frame, its angle turns tier + 9 degrees a frame and its
 * height wobbles by sin(15 * frame degrees) * (0, 3.5, 7)[tier % 3]. Each tick
 * the first emitter's distance to the cast point (XZ) + 5 is the radius of the
 * round hit box (0x006e4dbc: before that tick's emitter update); every enemy in it
 * is hit once (a 32-entry list); the object ends when the distance reaches
 * range_h. */
export class GifoieRing extends FireObject {
  readonly kind = 'gifoie' as const;
  readonly groups: number;
  /** Centres, start angles (BAMS) of the emitters. */
  readonly cx: number[] = [];
  readonly cz: number[] = [];
  readonly a0: number[] = [];
  private readonly stepBams: number;
  private readonly amp: number;
  /** The hit disc's radius of the last tick. */
  radius = 0;
  /** The first emitter's distance to the cast point at the last tick. */
  dist = 0;
  private readonly struck = new Set<number>();

  constructor(o: FireOptions) {
    super(TECH.gifoie, o);
    this.groups = GIFOIE_GROUPS[this.tier] ?? 1;
    const step = f32((this.tier + 9) * 65536) / 360;
    this.stepBams = Math.trunc(step);
    this.amp = GIFOIE_WOBBLE[this.tier % 3];
    const span = Math.trunc(f32(f32(Math.trunc(360 / this.groups)) * 65536) / 360);
    for (let i = 0; i < this.groups; i++) {
      const a = (span * i + 0x4000) & 0xffff;
      this.a0.push(a);
      // matrix_rotation_y(a) * (0, 0, -10) (the client's x = z sin a, z = z cos a).
      this.cx.push(o.x - GIFOIE_OFFSET * Math.sin(bamsRad(a)));
      this.cz.push(o.z - GIFOIE_OFFSET * Math.cos(bamsRad(a)));
    }
  }

  /** Emitter i after `frames` updates. */
  emitterAt(i: number, frames: number, out: { x: number; y: number; z: number }): void {
    const r = f32(GIFOIE_GROW * frames);
    const ang = bamsRad(this.a0[i] + frames * this.stepBams);
    out.x = this.cx[i] + r * Math.cos(ang);
    out.z = this.cz[i] + r * Math.sin(ang);
    out.y = this.y + this.amp * Math.sin((TAU * 15 * frames) / 360);
  }

  private readonly scratch = { x: 0, y: 0, z: 0 };

  step(targets: readonly TechTarget[], n: number, hits: TechTarget[]): void {
    hits.length = 0;
    if (this.done) return;
    this.frames++;
    // The emitters have been updated frames - 1 times when this tick runs.
    this.emitterAt(0, this.frames - 1, this.scratch);
    this.dist = Math.hypot(this.scratch.x - this.x, this.scratch.z - this.z);
    this.radius = this.dist + GIFOIE_BODY;
    for (let i = 0; i < n; i++) {
      const t = targets[i];
      if (this.struck.has(t.id) || this.struck.size >= 32) continue;
      if (!circleHits(this.x, this.z, this.radius, t, this.cutoff)) continue;
      this.struck.add(t.id);
      hits.push(t);
    }
    if (this.rangeH <= this.dist) this.done = true;
  }
}

// --- Rafoie --------------------------------------------------------------------

export const RAFOIE_DELAY = 10; // rafoie_aoe_tick: the blast comes with the 10th update
export const RAFOIE_BLAST_LIFT = 13; // the explosion particles: 5 (0x96dda4) + 8 (0x96dda0) above the point

/** Rafoie: vtable 0x00b3e058 (update_rafoie 0x006edfa0, hit entity_hit_by_rafoie
 * 0x006edf64), group 1. It is not a projectile: made on the first 6x47 target,
 * it follows that target's position for 10 updates (rafoie_aoe_tick copies it
 * every update), then explodes once (the model, the particles of its tier, SE
 * 0x8a) and hits every enemy whose box touches the round box of radius
 * range_h at that point (AoE_TechDamageTick_006deadc), then ends. A fixed
 * object (the enemy form, 0x006ed87c: flag +0x148 = 1) blasts at its own point
 * instead. The target gone before the blast: the object ends without it
 * (ASSUMED; the exe's update returns early every tick and the object stays). */
export class RafoieBlast extends FireObject {
  readonly kind = 'rafoie' as const;
  /** The followed target's id, or null for a fixed object. */
  readonly targetId: number | null;
  private count = 0;
  /** The point the blast is centred on (the followed target's position). */
  bx: number;
  bz: number;

  constructor(o: FireOptions, targetId: number | null = null) {
    super(TECH.rafoie, o);
    this.targetId = targetId;
    this.bx = o.x;
    this.bz = o.z;
  }

  step(targets: readonly TechTarget[], n: number, hits: TechTarget[]): void {
    hits.length = 0;
    this.burst = false;
    if (this.done) return;
    this.frames++;
    if (this.targetId !== null) {
      let t: TechTarget | null = null;
      for (let i = 0; i < n; i++) {
        if (targets[i].id === this.targetId) {
          t = targets[i];
          break;
        }
      }
      if (!t) {
        this.done = true;
        return;
      }
      this.bx = this.x = t.x;
      this.bz = this.z = t.z;
      // rafoie_aoe_tick copies the target's point (x, y, z) into the blast every tick (dump 650685):
      // the list form's y follows the target too, so the burst is at the target's y that tick.
      if (t.y !== undefined) this.y = t.y;
    }
    if (++this.count !== RAFOIE_DELAY) return;
    this.burst = true;
    for (let i = 0; i < n; i++) {
      const t = targets[i];
      if (circleHits(this.bx, this.bz, this.rangeH, t, this.cutoff)) hits.push(t);
    }
    this.done = true;
  }
}

// --- Rafoie's fire sphere ------------------------------------------------------

/** The technique BML's njcm chunk of the fire sphere (unknown_get_njcm_chunks(g_CurrentBmlBuffer, 0xb) in render_bazooka_explosion, dump 651052). */
export const SPHERE_CHUNK = 11;
/** Its life: the child updates 110 times and is gone on the 111th (update_bazooka_explosion, `0x6e < +0x58`, dump 651000). */
export const SPHERE_LIFE = 110;
/** The sphere's height above the blast point: 5 (g_RafoieParticleYOffset, 0x0096dda4); the blast particles add 8 more. */
export const SPHERE_LIFT = 5;
const SPHERE_SCALE0 = f32(1.2); // 0x3f99999a, the +0x34 / +0x38 / +0x3c of the child's constructor
const SPHERE_TARGET = f32(1.9); // 0x3ff33333, +0x40
const SPHERE_LERP_NEAR = f32(0.15); // 0x3e19999a: while scale < g_BazookaExplosionLerpThreshold + target
const SPHERE_LERP_FAR = f32(0.05); // 0x3d4ccccd: otherwise
const SPHERE_LERP_THRESHOLD = -1; // 0x0096dcd0 (g_BazookaExplosionLerpThreshold, read from the exe)
const SPHERE_FADE = f32(0.035); // 0x3d0f5c29: LerpFloat step of +0x48

/**
 * The sphere's turn about Y: matrix_rotation_y(g_pDefaultNPCCameraState->y_rotation) in its draw
 * (render_bazooka_explosion, dump 651052), the camera's yaw as a BAMS angle (0x10000 = a turn).
 * ASSUMED: the port's camera yaw (render/gameview.ts cameraYaw, the HUD's) is the same quantity.
 */
export function sphereTurnRad(cameraYawBams: number): number {
  return (cameraYawBams * Math.PI * 2) / 0x10000;
}

/**
 * The fire sphere a Rafoie blast makes on its 10th update (rafoie_aoe_tick, dump 650685, the child
 * of IndTexObject_Constructor_00504b58: a base_game_object with vtable g_ParticleEffectEntity_vtbl
 * 0x00b3e078 (update 0x006ee2b4 = update_bazooka_explosion, render 0x006ee380 =
 * render_bazooka_explosion; the dump names are wrong). It is a fixed point at (x, y + 5, z), not
 * following the target. Its scale grows toward 1.9 (Vec3LerpIfDistance, rate 0.05 here), its colour
 * alpha falls by 0.035 an update (LerpFloat on +0x48), and it is drawn as njcm chunk 11 with a Y turn.
 *
 * ASSUMED: the texture scroll (the +0x5c ring, 0..15) and the IndTex stage (the child's +0x24 object)
 * have no effect here: the active IndTex list (g_IndTexActiveList_00a72b10) is only ever reset and
 * read, never filled (exe xref 0x00a72b0c / 0x00a72b10), so ConfigureIndTexStageForMesh does nothing.
 */
export class RafoieSphere {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The uniform scale (+0x34 = +0x38 = +0x3c). */
  scale = SPHERE_SCALE0;
  /** The colour alpha (+0x48; +0x4c..+0x54 stay 1.0, so the colour is white). */
  fade = 1;
  /** Updates made (+0x58). */
  ticks = 0;
  /** The 0..15 counter (+0x5c), not read by the draw. */
  ring = 0;
  /** False once the life is over (+0x08 bit 0 set by the 111th update). */
  alive = true;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y + SPHERE_LIFT;
    this.z = z;
  }

  /** One update (the child's entity update). The life ends on the update that passes SPHERE_LIFE; the scale and fade still move on it. */
  step(): void {
    this.ticks++;
    this.ring = this.ring + 1 < 16 ? this.ring + 1 : 0;
    if (this.ticks > SPHERE_LIFE) this.alive = false;
    // Vec3LerpIfDistance_00501be8: the three components are equal, so the length is sqrt(3) * |scale - target|.
    // The rate is 0.15 while scale < threshold + target (update_bazooka_explosion, 0x006ee2ec..0x006ee329), else 0.05.
    const rate = SPHERE_LERP_THRESHOLD + SPHERE_TARGET > this.scale ? SPHERE_LERP_NEAR : SPHERE_LERP_FAR;
    const dist = f32(Math.sqrt(3) * Math.abs(this.scale - SPHERE_TARGET));
    if (dist > rate) this.scale = f32(this.scale + (SPHERE_TARGET - this.scale) * f32(dist * rate));
    // LerpFloat_00501b34 towards 0 by the step (0x006ee370): never below 0.
    this.fade = Math.max(0, f32(this.fade - SPHERE_FADE));
  }
}

// --- Rabarta -------------------------------------------------------------------

/** Rabarta: RabartaEntity_vtbl (0x00b3dee0, unknown_update_rabarta 0x006ecd4c,
 * hit rabarta_hit_target 0x006ecdb4), group 2. A round box of radius range_h
 * round the cast point (the caster's own position for the player's form, the
 * given point for the enemy's) that lives `cast` ticks + 1 (data.cast, 25 - 5 *
 * (level / 5)); each tick every enemy that touches it and was not hit yet takes
 * the hit (a 32-entry list). */
export class RabartaField extends FireObject {
  readonly kind = 'rabarta' as const;
  readonly life: number;
  private readonly struck = new Set<number>();

  constructor(o: FireOptions) {
    super(TECH.rabarta, o);
    this.life = techData(TECH.rabarta, this.level).cast;
  }

  step(targets: readonly TechTarget[], n: number, hits: TechTarget[]): void {
    hits.length = 0;
    if (this.done) return;
    this.frames++;
    for (let i = 0; i < n; i++) {
      const t = targets[i];
      if (this.struck.has(t.id) || this.struck.size >= 32) continue;
      if (!circleHits(this.x, this.z, this.rangeH, t, this.cutoff)) continue;
      this.struck.add(t.id);
      hits.push(t);
    }
    if (this.life < this.frames) this.done = true;
  }
}

// --- the factory -----------------------------------------------------------------

export interface CastRequest extends FireOptions {
  tech: number;
  /** Rafoie: the first target's id (it follows it). */
  targetId?: number | null;
  /** Rafoie: the enemy form made at a point (CreateRafoieEffectEntity_006ed87c). */
  fixed?: boolean;
  ground?: GroundFn | null;
}

/** unknown_cast_tech's construction for a technique of the two families; null
 * for a Rafoie without a target (the exe creates nothing then). A Rafoie's x / y /
 * z is the point it starts on: the aimed target's. */
export function makeFireObject(r: CastRequest): FireObject | null {
  switch (r.tech) {
    case TECH.foie:
      return new FoieBolt(r);
    case TECH.gifoie:
      return new GifoieRing(r);
    case TECH.rafoie:
      if (r.fixed) return new RafoieBlast(r, null);
      return r.targetId === undefined || r.targetId === null ? null : new RafoieBlast(r, r.targetId);
    case TECH.barta:
      return new BartaBolt(r, r.ground ?? null);
    case TECH.gibarta:
      return new GibartaBolt(r);
    case TECH.rabarta:
      return new RabartaField(r);
    default:
      return null;
  }
}

// --- target selection ----------------------------------------------------------

/** One candidate hit box for the targeting scan. */
export interface Candidate {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface TargetingParams {
  /** The technique's data (GetTechniqueData_006ded14: angleH is already the half angle). */
  rangeH: number;
  rangeV: number;
  angleH: number; // BAMS
  angleV: number; // BAMS
  targets: number;
}

const cosBams = (b: number): number => Math.cos(bamsRad(b));

/** check_enemy_is_targetable (0x007a2e74) + create_target_reticles_for_weapon_or_tech
 * (0x007a2698) for a technique's entry (unknown_update_equipment_properties_from_pmt
 * type 3):
 *   horizontal_distance = range_v + range_h, vertical_distance = range_v,
 *   target_count = targets, weapon position = the player's;
 *   a hit box counts when the XZ distance from the weapon position is within
 *   its radius + horizontal_distance;
 *   the horizontal cone (skipped when cos(angle_h) is not strictly between -1 and 1):
 *   with range_v = 0 the cone's apex is the weapon position, else the point
 *   range_v behind it (heading + 0x8000), the direction to the hit box must be
 *   within the half angle of the heading and, with an offset apex, the hit box
 *   must also be in front of the player (dot >= 0);
 *   the vertical cone (skipped when cos(angle_v) is not strictly between -1 and 1):
 *   the elevation of the hit box centre seen from the apex (the weapon position or
 *   the point behind it) within angle_v;
 *   the survivors are sorted nearest first (wpn_to_trgt_dist_sq) and the first
 *   `targets` taken; with a primary (manually locked) target and fewer than two
 *   targets only the primary may be taken.
 * Returns the number written to `out` (ids, nearest first). */
export function pickTechTargets(
  wx: number,
  wy: number,
  wz: number,
  heading: number,
  p: TargetingParams,
  cands: readonly Candidate[],
  primary: number | null,
  out: Candidate[],
): number {
  out.length = 0;
  const reach = p.rangeV + p.rangeH;
  const cosH = cosBams(p.angleH);
  const cosV = cosBams(p.angleV);
  const sinHd = Math.sin(heading);
  const cosHd = Math.cos(heading);
  const bx = wx - sinHd * p.rangeV; // heading + 0x8000
  const bz = wz - cosHd * p.rangeV;
  for (const c of cands) {
    const dx = c.x - wx;
    const dz = c.z - wz;
    const r = c.radius + reach;
    if (dx * dx + dz * dz > r * r) continue;
    const ax = p.rangeV === 0 ? wx : bx;
    const az = p.rangeV === 0 ? wz : bz;
    if (cosH > -1 && cosH < 1) {
      const tx = c.x - ax;
      const tz = c.z - az;
      const tl = Math.hypot(tx, tz);
      const dot = tl < 1e-9 ? 0 : (sinHd * tx + cosHd * tz) / tl;
      if (dot < cosH) continue;
      if (p.rangeV !== 0) {
        const px = c.x - wx;
        const pz = c.z - wz;
        const pl = Math.hypot(px, pz);
        if ((pl < 1e-9 ? 0 : (sinHd * px + cosHd * pz) / pl) < 0) continue;
      }
    }
    if (cosV > -1 && cosV < 1) {
      const tx = c.x - ax;
      const tz = c.z - az;
      const ty = c.y - wy;
      const flat = Math.hypot(tx, tz);
      const full = Math.hypot(tx, ty, tz);
      const dot = flat < 1e-9 || full < 1e-9 ? 0 : flat / full;
      if (dot < cosV) continue;
    }
    out.push(c);
  }
  out.sort((a, b) => (a.x - wx) ** 2 + (a.z - wz) ** 2 - ((b.x - wx) ** 2 + (b.z - wz) ** 2));
  let n = 0;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (n >= p.targets) break;
    if (primary !== null && c.id !== primary && p.targets < 2) continue;
    out[n++] = c;
  }
  out.length = n;
  return n;
}

// --- the effect tables -----------------------------------------------------------

/** One particle emitter of an object. */
export interface FxEmitter {
  id: number; // particleentry.dat entry
  scale: number; // the emitter's +0x44 / +0x48
  /** follow: made round the object and moved with it every update
   * (copy_pos_to_particle); fixed: a persistent emitter that stays where it was made;
   * burst: one emission. */
  mode: 'follow' | 'fixed' | 'burst';
  /** Added to the point's y. */
  dy?: number;
  /** Added along the object's heading (Gibarta's un-flagged entries: 3 ahead). */
  ahead?: number;
  /** create_particle_effect2 / 5 (the exe's flag 2 or 1 entries) with the object's angles: 'object', or 'half' (X turned half a circle, flag 1). See objectEmitterOrient. */
  angles?: 'object' | 'half';
  /** Particle flag 0x2000 (the table's 0x1000): the particles are destroyed at birth and never drawn (EffectFx.noDraw). */
  hidden?: boolean;
  /** The table's flag 0x20: the particle is the technique BML's model (EffectFx.model; the njcm chunk, and the njm chunk or none). */
  model?: { chunk: number; motion: number | null };
  /** The table's flag 0x400 (particle flag 0x400, the cloak branch; EffectFx.cloak). */
  cloak?: boolean;
}

const E = (id: number, scale: number, mode: FxEmitter['mode'], extra: Partial<FxEmitter> = {}): FxEmitter => ({ id, scale, mode, ...extra });

// Foie (g_TechniqueEffectDataPointers, 0x0096d1c8): {id, flags, scale}; flag 2 /
// 1 = create_particle_effect2 with the object's angles (1: turned half a circle),
// 0x1000 = create_particle_effect4 with particle flag 0x2000 (hidden: the particles are
// destroyed at birth, update_particle_effect spawn, dump line 288330). Every entry
// follows the ball. The one-shot create_particle_effect12(…, 0x18) at the start is the muzzle burst.
export const FOIE_MUZZLE = 0x18;
const FOIE_FX: readonly (readonly FxEmitter[])[] = [
  [E(0x14, 1, 'follow', { angles: 'object' })],
  [E(0x14, 1.2, 'follow', { angles: 'object' })],
  [E(0x14, 1.4, 'follow', { angles: 'object' })],
  [E(0x14, 1.6, 'follow', { angles: 'object' }), E(0xac, 1, 'follow', { angles: 'half' })],
  [E(0x14, 1.8, 'follow', { angles: 'object' }), E(0xac, 1, 'follow', { angles: 'half' })],
  [E(0x19e, 1, 'follow', { hidden: true }), E(0x14, 2.2, 'follow', { angles: 'object' }), E(0xac, 1, 'follow', { angles: 'half' }), E(0x19c, 1, 'follow', { angles: 'object' })],
];

/**
 * The object angles an emitter is made with (create_particle_effect2 / 5's param_2:
 * local_3c, or local_30 for flag 1 = X + 0x8000). An undirected object (Foie, Barta,
 * Gibarta, Megid's heading form) is a TechniqueEntity, whose +0x54 / +0x5c are
 * Vector3f_GetAnglesZ of its heading's direction (sin, 0, cos) (0x006efe50); a
 * directed one (EffectEntityBase: TechniqueObject_Constructor_006e3480, the aimed
 * Barta / Gibarta, Gibarta's point constructor 0x006e4058) sets +0x54 and +0x5c to 0
 * (0x006f0138), so its emitters are not turned. The exe's Y is always 0 here.
 */
export function objectEmitterOrient(o: FireObject, angles: NonNullable<FxEmitter['angles']>): Orient {
  const base: Orient = o.directed ? NO_ORIENT : orientOfDirection(Math.sin(o.heading), 0, Math.cos(o.heading));
  return angles === 'half' ? [base[0] + Math.PI, base[1], base[2]] : base;
}

/**
 * The effect flags an emitter is made with: the table's 0x1000 is particle flag 0x2000 (noDraw),
 * the table's 0x20 is the model branch (flag 0x200, speed 1: the loops' z2 = 1.0).
 */
export function emitterFx(e: FxEmitter): EffectFx {
  const fx: EffectFx = {};
  if (e.hidden) fx.noDraw = true;
  if (e.model) fx.model = { chunk: e.model.chunk, motion: e.model.motion, speed: 1 };
  if (e.cloak) fx.cloak = true;
  return fx;
}

// Gibarta (g_TechniqueVisualDefinitions, 0x0096d2f0), InitializeTechniqueVisuals_006e3ba0:
// flag 2 = create_particle_effect5 at the object with the object's angles (+0x54 / +0x5c,
// the loop's local_4c; the table's 0x181 has flag 0x2), else create_particle_effect3 3
// ahead; flag 0x40 sets the scale; flag 0x20 makes the particle a model of the
// technique BML (the static model of njcm chunk flags >> 16, `model` below). update_gibarta never moves them: they stay at
// the start. Tier 5 also makes particles 0x1e0 / 0x1e1 15 below the start.
const GIB: FxEmitter[] = [E(0x180, 1, 'fixed', { ahead: 3 })];
const GIB_ANGLED = { angles: 'object' } as const;
// The flag 0x20 entries (InitializeTechniqueVisuals_006e3ba0): flag 2 = create_particle_effect5 at
// the object with its angles, the model is njcm chunk (flags >> 16) and no motion; the model
// draws its own scale (the effect's +0x44 stays 1.0, so the table scale is not used).
const gibModel = (chunk: number): Partial<FxEmitter> => ({ angles: 'object', model: { chunk, motion: null } });
const GIBARTA_FX: readonly (readonly FxEmitter[])[] = [
  [...GIB, E(0x181, 1, 'fixed', GIB_ANGLED), E(0x182, 1, 'fixed', gibModel(2))],
  [...GIB, E(0x181, 1.2, 'fixed', GIB_ANGLED), E(0x183, 1, 'fixed', gibModel(2))],
  [...GIB, E(0x181, 1.4, 'fixed', GIB_ANGLED), E(0x184, 1, 'fixed', gibModel(2))],
  [...GIB, E(0x181, 1.6, 'fixed', GIB_ANGLED), E(0x185, 1, 'fixed', gibModel(3))],
  [...GIB, E(0x181, 1.8, 'fixed', GIB_ANGLED), E(0x186, 1, 'fixed', gibModel(3))],
  [E(0x181, 2.2, 'fixed', GIB_ANGLED), E(0x18e, 1, 'fixed', gibModel(3)), E(0x1e0, 1, 'burst', { dy: -15 }), E(0x1e1, 1, 'burst', { dy: -15 })],
];

// Barta (g_AntiTechEffectDefinitions, 0x0096ca84): flag 2 = create_particle_effect5 with
// the object's angles (AntiTechEntity_Constructor_006dd85c's local_3c = +0x54 / +0x5c),
// flag 1 (0x198) = create_particle_effect5 with X + 0x8000 (a half turn), else
// create_particle_effect3 (0x192, not turned). All follow the ball (update_barta). The
// tier 5 flag 0x20 entries (0x193 / 0x1d8 / 0x1d7, no angles) are the BML model 0 with its
// motion 0 (BARTA_PARTICLE_MODEL, dump 640489), drawn animated.
const BARTA_ANGLED = { angles: 'object' } as const;
const BARTA_MODEL = { model: { chunk: 0, motion: 0 } } as const;
const BARTA_FX: readonly (readonly FxEmitter[])[] = [
  [E(0x190, 1, 'follow', BARTA_ANGLED), E(0x191, 1, 'follow', BARTA_ANGLED), E(0x192, 1, 'follow')],
  [E(0x190, 1.2, 'follow', BARTA_ANGLED), E(0x191, 1.2, 'follow', BARTA_ANGLED), E(0x192, 1, 'follow')],
  [E(0x190, 1.4, 'follow', BARTA_ANGLED), E(0x191, 1.4, 'follow', BARTA_ANGLED), E(0x192, 1, 'follow')],
  [E(0x190, 1, 'follow', BARTA_ANGLED), E(0x191, 1, 'follow', BARTA_ANGLED), E(0x192, 1, 'follow'), E(0x198, 1, 'follow', { angles: 'half' })],
  [E(0x190, 1.2, 'follow', BARTA_ANGLED), E(0x191, 1.2, 'follow', BARTA_ANGLED), E(0x192, 1, 'follow'), E(0x198, 1, 'follow', { angles: 'half' })],
  [
    E(0x190, 1.6, 'follow', BARTA_ANGLED), E(0x191, 1.6, 'follow', BARTA_ANGLED), E(0x192, 1, 'follow'), E(0x198, 1, 'follow', { angles: 'half' }),
    E(0x193, 1, 'follow', BARTA_MODEL), E(0x1d8, 1, 'follow', BARTA_MODEL), E(0x1d7, 1, 'follow', BARTA_MODEL),
  ],
];

// Rabarta (LOOP in CreateRabartaEntity_006ec2d0 / RabartaEntity_Constructor_006ec344, dump
// 649593..649752, the table at g_ParticleEffectDataPointers 0x0096dc6c: {pointer, count} per
// tier, 8 bytes; entries {id, flags, scale} of 12 bytes, decoded from PsoBB.exe): create_particle_effect3
// at the cast point, not moved and not turned (no angles); flag 0x40 sets the scale (+0x44 / +0x48);
// flag 0x20 is a model: +0x50 = unknown_get_njcm_chunks(bml, flags >> 16), +0x58 = 0 (no motion, the
// model is static), +0x54 = the xvm, +0x60 = 1.0, +0x2c |= 0x200 (dump 649746..649760).
// The model entries: 0x1df (tier 0), 0x194 (1), 0x195 (2) chunk 2; 0x199 (3), 0x19a (4) chunk 3;
// 0x19b (5) chunk 4. Their table scales (1.4 / 1.6 / 1.8 / 1.0) have no flag 0x40, so they are not used.
// Tier 5 adds the one-shot 0x1d6 at (x, y + g_RabartaParticleEffectYOffset (5.0, 0x0096db8c), z)
// with model chunk 1 and motion 1 (get_njm_chunk(bml, 1), dump 649738..649748), z2 = 1.0.
const RABARTA_MODEL = (chunk: number): Partial<FxEmitter> => ({ model: { chunk, motion: null } });
const RABARTA_FX: readonly (readonly FxEmitter[])[] = [
  [E(0x1d9, 1, 'fixed'), E(0x1db, 1, 'fixed'), E(0x1df, 1, 'fixed', RABARTA_MODEL(2))],
  [E(0x1d9, 1, 'fixed'), E(0x1db, 1.2, 'fixed'), E(0x194, 1, 'fixed', RABARTA_MODEL(2))],
  [E(0x1d9, 1, 'fixed'), E(0x1db, 1.2, 'fixed'), E(0x195, 1, 'fixed', RABARTA_MODEL(2))],
  [E(0x1d9, 1, 'fixed'), E(0x196, 1, 'fixed'), E(0x199, 1, 'fixed', RABARTA_MODEL(3))],
  [E(0x1d9, 1, 'fixed'), E(0x196, 1.2, 'fixed'), E(0x19a, 1, 'fixed', RABARTA_MODEL(3))],
  [E(0x1d9, 1, 'fixed'), E(0x197, 1, 'fixed'), E(0x19b, 1, 'fixed', RABARTA_MODEL(4)), E(0x1d6, 1, 'burst', { dy: 5, model: { chunk: 1, motion: 1 } })],
];

// Gifoie (gifoie_particle_data, 0x0096d3f4): every spiral emitter carries these.
const GIFOIE_FX: readonly (readonly FxEmitter[])[] = [
  [E(0x22, 1, 'follow')],
  [E(0x22, 1, 'follow')],
  [E(0x22, 1, 'follow')],
  [E(0x22, 1, 'follow'), E(0xac, 1, 'follow')],
  [E(0x22, 1, 'follow'), E(0xac, 1, 'follow')],
  [E(0x22, 1, 'follow'), E(0xac, 1, 'follow'), E(0x19e, 1, 'follow')],
];

// Rafoie's explosion (rafoie_and_bazooka_particles, 0x0096dd6c) made at the
// blast (x, y + 13, z) with create_particle_effect_3; entry 0x1e6 (flag 0x10)
// follows its entity, which is only a point here.
const RAFOIE_BLAST: readonly (readonly FxEmitter[])[] = [
  [E(0x1ee, 1, 'burst')],
  [E(0x1ee, 1, 'burst')],
  [E(0x1ee, 1, 'burst')],
  [E(0x1eb, 1, 'burst'), E(0x1ee, 1, 'burst')],
  [E(0x189, 1, 'burst'), E(0x1ee, 1, 'burst')],
  [E(0x18c, 1, 'burst'), E(0x1ee, 1, 'burst'), E(0x1e2, 1, 'burst', { hidden: true }), E(0x1e6, 1, 'burst')],
];
// The marks round the target when the cast starts (RafoieEffectEntity_Constructor_006ed8f4 and
// rafoie_constructor 0x006ed8f4, dump 650318 / 650527): the fixed form makes the ring 0x1a at the
// point, then 0x3a and 0x3b; the list form makes 0x39 at the target's weapon position, then the ring
// 0x1a there. The ring is the technique BML's njcm chunk 9 with no motion (z = 0.0), z2 = 1.0, flags
// 0x600 = model | 0x400: the cloak branch, drawn only with the advanced effects setting (EffectFx.cloak,
// render/hitfx.ts; the cloak itself is not modelled, ASSUMED: drawn as the plain model).
const RAFOIE_RING = { model: { chunk: 9, motion: null }, cloak: true } as const;
export const RAFOIE_MARK_LIST: readonly FxEmitter[] = [E(0x39, 1, 'burst'), E(0x1a, 1, 'burst', RAFOIE_RING)];
export const RAFOIE_MARK_FIXED: readonly FxEmitter[] = [E(0x1a, 1, 'burst', RAFOIE_RING), E(0x3a, 1, 'burst'), E(0x3b, 1, 'burst')];

/** The emitters an object makes when it is created, by kind and tier. */
export function startEmitters(kind: FireKind, tier: number, fixedRafoie = false): readonly FxEmitter[] {
  const t = Math.max(0, Math.min(5, tier));
  switch (kind) {
    case 'foie':
      return [E(FOIE_MUZZLE, 1, 'burst'), ...FOIE_FX[t]];
    case 'gibarta':
      return GIBARTA_FX[t];
    case 'barta':
      return BARTA_FX[t];
    case 'rabarta':
      return RABARTA_FX[t];
    case 'gifoie':
      return GIFOIE_FX[t];
    case 'rafoie':
      return fixedRafoie ? RAFOIE_MARK_FIXED : RAFOIE_MARK_LIST;
  }
}

export function rafoieBlastEmitters(tier: number): readonly FxEmitter[] {
  return RAFOIE_BLAST[Math.max(0, Math.min(5, tier))];
}

// Foie's wall impact (vtable +0x10 = TechniqueEntity_CreateParticleEffects_006e37b0).
export const FOIE_WALL: readonly number[] = [0x1dc, 0x1dd];

// --- sounds ----------------------------------------------------------------------

// play_directional_sound_effect ids: the creation sound of each object (the
// pitch of ProcessAudioCommand_00814664 by tier is not modelled), the Foie hit
// (TechniqueEntity_Start 0xaf), Rafoie's blast, and the charge loops of the cast
// (TechniqueSoundEffect: Foie family 0xa3, Barta family 0xa4).
export const FIRE_SE = {
  start: { foie: 0x87, gifoie: 0x88, rafoie: 0x89, barta: 0x8b, gibarta: 0x8c, rabarta: 0x8d } as Record<FireKind, number>,
  foieHit: 0xaf,
  rafoieBlast: 0x8a,
  chargeFoie: 0xa3,
  chargeBarta: 0xa4,
} as const;

/** The pitch offset ProcessAudioCommand_00814664 gets by tier (0x100 up on the
 * lowest, down on the high ones); not played here, listed for the record. */
export function startPitch(kind: FireKind, tier: number): number {
  if (tier === 0) return 0x100;
  if (kind === 'foie') return tier <= 2 ? 0 : tier === 3 ? -0x180 : tier === 4 ? -0x250 : -0x100;
  return tier === 1 ? 0 : tier <= 3 ? -0x180 : tier === 4 ? -0x250 : -0x100;
}

// --- enemy shots -----------------------------------------------------------------

const PLAYER_HIT_RADIUS = 5; // enemyshots.ts PLAYER_RADIUS
const NO_HITS: AiTarget[] = []; // returned on the many ticks that hit nobody (read only)

/** An enemy's technique object as a shot of the FSMs (combat/enemyshots.ts):
 * ticked once per game tick against the players, hits each in `AiTarget`
 * terms. Heights are above the launch ground, like every shot's. */
export class FireShot extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook;
  readonly fire: FireObject;
  private readonly pool: TechTarget[] = [];
  private readonly hitBuf: TechTarget[] = [];

  constructor(fire: FireObject, effect: ShotEffect) {
    super(fire.x, fire.y, fire.z);
    this.fire = fire;
    this.effect = effect;
    this.look = { color: 0xff6020, size: 2 };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return NO_HITS;
    let n = 0;
    for (const t of targets) {
      if (t.dead) continue;
      const slot = this.pool[n] ?? (this.pool[n] = { id: 0, x: 0, z: 0, radius: PLAYER_HIT_RADIUS });
      slot.id = t.clientId;
      slot.x = t.x;
      slot.z = t.z;
      n++;
    }
    this.fire.step(this.pool, n, this.hitBuf);
    this.frames = this.fire.frames;
    this.x = this.fire.x;
    this.y = this.fire.y;
    this.z = this.fire.z;
    this.done = this.fire.done;
    if (!this.hitBuf.length) return NO_HITS;
    const out: AiTarget[] = [];
    for (const h of this.hitBuf) {
      const t = targets.find((a) => a.clientId === h.id);
      if (t) out.push(t);
    }
    return out;
  }
}

/** The reach of an AoE object's round box against a player's (5): its radius is
 * range_h of the technique at the level (rafoie_constructor / rabarta_constructor
 * put it in the hit box's radius), the test is strict. Dark Falz' objects use it
 * (combat/darkfalz1.ts, darkfalz2.ts). */
export function techReach(tech: number, level: number): number {
  return techData(tech, objectLevel(level)).rangeH + PLAYER_HIT_RADIUS;
}

/** Whether a player at XZ distance `dist` from an enemy's Jellen / Zalure object is
 * inside its area: strictly within techReach. Gi Gue's stomp and Sinow Zoa's cast
 * both use it (the exe's probe is range_h, the player's hit box adds 5, see the
 * DEVLOG entry "Jellen / Zalure area of an enemy cast"). */
export function inTechReach(tech: number, level: number, dist: number): boolean {
  return dist < techReach(tech, level);
}

/** The damage an enemy's object does to a player (entity_hit_by_tech group 1 / 2 /
 * 0x13 for a player defender: the same (MST * 0.5 + power) * (100 - resist) *
 * 0.002 as group 0 when the player's resist is 0, which is ASSUMED here). A
 * Gibarta / Rabarta of an enemy also freezes a player: the chance is 0.75 -
 * EIC / 100 (0x00978268, 0x00978264), the roll is get_random_float
 * (0x0077494a). */
export const ENEMY_FREEZE_CHANCE = f32(0.75);

export interface FireShotOptions extends CastRequest {
  /** The power an enemy's brain passes (techPower of the level by default). */
  power?: number;
  knockback?: number;
}

/** An enemy casting one of the six: the object plus the effect on a player. */
export function enemyFire(r: FireShotOptions): FireShot | null {
  const fire = makeFireObject(r);
  if (!fire) return null;
  const power = r.power ?? fire.power;
  const freeze = fire.kind === 'gibarta' || fire.kind === 'rabarta';
  const effect: ShotEffect = freeze
    ? { kind: 'tech', power, ...(r.knockback ? { knockback: r.knockback } : {}), status: { type: STATUS.freeze, chance: ENEMY_FREEZE_CHANCE } }
    : { kind: 'tech', power, ...(r.knockback ? { knockback: r.knockback } : {}) };
  return new FireShot(fire, effect);
}
