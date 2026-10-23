// Gun bullets (PsoBB.exe, Ephinea 1.25.13, addresses are VAs; the named dump
// refsrc Psobb.exe-05112026.c and objdump agree on every value below).
//
// A shot is begin_gun_bullet_attack (0x005e6578), called once per pellet
// (unk_shoot_shotgun 0x005fe004 for the Shot, 5 pellets; one call for the
// others, InitializeGunBulletAttack_005ec2bc):
//  - the aim point: with a listed target (6x46 index = the pellet index) the
//    hitbox centre, pulled back by the hitbox radius along the shot; without
//    one, horizontal_distance ahead of the hand at heading + the pellet's
//    angle (shotgun_bullet_angles 0x0092dffc = 0, +2184, -2184, +4551, -4551
//    BAMS);
//  - a map wall on the ray from the hand to that point (cast_ray_at_map_collision_geometry,
//    mask 0x8100) stops the shot: no bullet, no damage (only the effect);
//  - the flight time: frame_count = ROUND(distance to the hitbox centre / speed),
//    speed = the item's speed_maybe (+0x208), set per kind by the inner ctor
//    (see GUN_BULLET_SPEED_BY_KIND); the default 19.0 is written by
//    construct_generic_weapon 0x005e959c (movl $0x41980000, 0x208(%ecx) at
//    0x005e975e, before the kind's own write). The countdown runs one game
//    tick per frame (CountdownHelperConstructor 0x005e5b88).
//  - the effect: the item's shot callback (+0x238, shotVisualOf). Default
//    create_gun_bullet_particle_effect (0x005e4678) spawns particle 9 at the hand
//    (create_particle_effect 0x0050b510) and the gun_bullet.xj object 0x005e4704 that
//    flies from the hand to the aim point (render/guntracer.ts). The egg callback
//    0x005e4264 (Handgun group, Samba, 0x1c, 0x8b) makes no muzzle and no model: the
//    0x64-byte ShotEffect (0x005e407c) flies the same way, with particle 0x9f on it.
// At arrival gun_bullet_collision_check (0x005c7120): the target is missed when
// its hitbox centre moved at least sqrt(g_WeaponBulletCollisionRadiusSq) =
// sqrt(64) = 8 in XZ since the shot (0x0092bcb4); the miss text shows only when
// it moved towards the shooter. Otherwise the weapon's hit roll and damage
// (weapon_projectile_attack_hit_entity) run.
//
// Pure math, no three.js: runs in Node tests.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Shot tables (see above).
// Bullet speed (item speed_maybe +0x208). The default 19.0 is the generic ctor's write (0x005e959c,
// 0x005e975e); each gun's inner ctor overwrites it with its own (objdump, PsoBB.exe, and nothing
// else writes +0x208 of a weapon in the ctor range 0x005e9000..0x00602000):
//   Handgun 6  inner 0x005f3380: movl $0x41300000 (11.0) at 0x005f33ba, after the generic call at 0x005f338d
//   Shot 9     inner 0x005fe170: movl $0x41700000 (15.0) at 0x005fe1d4
//   Samba 0x48 inner 0x005fc2fc: movl $0x41300000 (11.0) at 0x005fc339
// Rifle 7 (inner 0x005fb494) and Mechgun 8 (inner 0x005f473c) keep the generic 19.0 (both call 0x005e959c).
export const GUN_BULLET_SPEED_DEFAULT = 19;
export const GUN_BULLET_SPEED_BY_KIND: ReadonlyMap<number, number> = new Map([
  [6, 11],
  [9, 15],
  [0x48, 11],
]);
export const bulletSpeed = (kind: number): number => GUN_BULLET_SPEED_BY_KIND.get(kind) ?? GUN_BULLET_SPEED_DEFAULT;
export const BULLET_COLLISION_RADIUS_SQ = 64; // g_WeaponBulletCollisionRadiusSq (0x0092bcb4)
export const BULLET_WALL_MASK = 0x8100; // cast_ray_at_map_collision_geometry flags of begin_gun_bullet_attack
export const MUZZLE_PARTICLE = 9; // create_particle_effect(hand, 9) (0x005e4678, unk_shoot_shotgun)
export const SHOT_ANGLES_BAMS: readonly number[] = [0, 2184, -2184, 4551, -4551]; // shotgun_bullet_angles (0x0092dffc)

// ItemPMT weapon kinds (data1[1]) of the guns that fire begin_gun_bullet_attack:
// Handgun 6 and Shot 9 are the rows the ItemPMT test reads (tests/rangedaim.test.ts);
// Rifle 7 and Mechgun 8 are ASSUMED to be the kinds in between. Samba Maracas 0x48 is ASSUMED
// a gun too: its own inner ctor (0x005fc2fc) writes the Handgun's bullet speed and the Handgun's
// particle callback (0x005e4264), and its motion class is the Mechgun's (8, newserv WeaponKind).
// The motion class alone is NOT the gate: the class-6..9 kinds include ~40 weapons whose ctors
// set no gun callback or speed (e.g. 0x42, 0x45, 0x65, 0x6d).
export const GUN_KINDS: ReadonlySet<number> = new Set([6, 7, 8, 9, 0x48]);
export const isGunKind = (kind: number): boolean => GUN_KINDS.has(kind);
// The Shot (kind 9) fires five pellets (unk_shoot_shotgun 0x005fe004); the others one.
export const SHOT_KIND = 9;
export const pelletCount = (kind: number): number => (kind === SHOT_KIND ? SHOT_ANGLES_BAMS.length : 1);

const TAU = Math.PI * 2;
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const distXzSq = (a: Vec3, b: Vec3): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

// The flight time of a shot covering `distance` (ROUND(local_14), ASSUMED to round
// half up for the positive values here).
export function bulletFrames(distance: number, speed = GUN_BULLET_SPEED_DEFAULT): number {
  return Math.max(0, Math.round(distance / speed));
}

// The aim point of a shot with a target: the hitbox centre pulled back by the
// hitbox radius along the shot (begin_gun_bullet_attack: vec3_normalize then
// subtract the radius, then vec3_sum with the start).
export function targetAimPoint(start: Vec3, centre: Vec3, radius: number): Vec3 {
  const d = dist(centre, start);
  if (d < 1e-9) return { ...start };
  const t = (d - radius) / d;
  return { x: start.x + (centre.x - start.x) * t, y: start.y + (centre.y - start.y) * t, z: start.z + (centre.z - start.z) * t };
}

// The aim point without a target: horizontal_distance ahead at heading + the
// pellet's angle, in the port's heading convention (heading 0 = +z).
export function openAimPoint(start: Vec3, heading: number, angleBams: number, horizontalDistance: number): Vec3 {
  const a = heading + (angleBams / 0x10000) * TAU;
  return { x: start.x + Math.sin(a) * horizontalDistance, y: start.y, z: start.z + Math.cos(a) * horizontalDistance };
}

export interface GunShot {
  end: Vec3; // where the trail ends (the aim point, or the wall hit)
  frames: number; // flight time, in game ticks
  wall: boolean; // a map wall stopped the shot
  bullet: boolean; // a bullet is created (a target, no wall): it can hurt
  // The vector and the float frame count the shot callback gets (begin_gun_bullet_attack's
  // fStack_14 = distance / speed, not rounded): `from - start`, where `from` is the target's
  // centre, or `end` for an open shot and a wall. ASSUMED for the wall: the exe's point is the
  // ground object's position, not the aim point.
  dir: Vec3;
  flight: number;
}

// One pellet: the aim point, the wall ray and the bullet's flight time.
// `wallBlocks(from, to)` is the map ray (true when a wall of mask 0x8100 is hit).
export function planGunShot(
  start: Vec3,
  aim: { heading: number; angleBams: number; horizontalDistance: number },
  target: { centre: Vec3; radius: number } | null,
  wallBlocks: (from: Vec3, to: Vec3) => boolean,
  speed = GUN_BULLET_SPEED_DEFAULT,
): GunShot {
  const end = target ? targetAimPoint(start, target.centre, target.radius) : openAimPoint(start, aim.heading, aim.angleBams, aim.horizontalDistance);
  // The wall branch: the effect only (the ground object's distance; ASSUMED the hit point).
  const wall = wallBlocks(start, end);
  const from = target && !wall ? target.centre : end;
  const d = dist(start, from);
  return {
    end,
    frames: bulletFrames(d, speed),
    wall,
    bullet: !!target && !wall,
    dir: { x: from.x - start.x, y: from.y - start.y, z: from.z - start.z },
    flight: d / speed,
  };
}

// The shot's visual (the item's shot callback at +0x238, written by the inner ctor):
//  - 'default': 0x005e4678 (create_gun_bullet_particle_effect): the muzzle particle 9 at the
//    hand and the gun_bullet.xj object of the trail (render/guntracer.ts);
//  - 'egg': 0x005e4264, the Handgun group's and the others' callback: no muzzle particle and no
//    bullet model; the effect object ShotEffect below, with particle 0x9f on it.
export type ShotVisual = 'default' | 'egg';
// The kinds whose inner ctor writes 0x005e4264 (kindmap of the item ctors): the Handgun ctor
// group 6 (ctor 0x005f3380, also 0x44, 0xaf, 0xe8), 0x1c (ctor 0x005f1188), the Samba Maracas
// 0x48 (ctor 0x005fc2fc) and 0x8b (ctor 0x005eb05c). Only the guns in GUN_KINDS fire at all.
const EGG_SHOT_KINDS: ReadonlySet<number> = new Set([6, 0x1c, 0x44, 0x48, 0x8b, 0xaf, 0xe8]);
export const shotVisualOf = (kind: number): ShotVisual => (EGG_SHOT_KINDS.has(kind) ? 'egg' : 'default');

// The egg effect (0x005e4264 -> 0x005e407c -> ctor 0x005e4158, a 0x64-byte object, vtable
// 0x00b0ff6c). Its particle is particleentry.dat entry 0x9f ("egg_bullet": type 0, rate 0.5 per
// frame, life 30 frames, colour cyan), made at the object's position with the instance flags
// 0x44 (+0x60 = 4, | 0x40): the particle does not follow the object (no flag 0x10), the emitter
// moves with it (the object's update copies its position into the particle, vtable slot 4,
// 0x005e45e8) and stops when the object dies (its destructor 0x005e3eac sets the kill flag on
// the handle). The object is not a bullet: it has no model and no hit (the arrival is the
// bullet countdown of begin_gun_bullet_attack, unchanged).
export const EGG_PARTICLE = 0x9f;
export const EGG_INSTANCE_FLAGS = 0x44;
const TIMER_END = -0.0078125; // _DAT_0092d52c

// The egg object's state. The velocity is the unit direction times distance / frames (the
// ctor's normalise and scale, 0x005e4158): dir / flight, i.e. the bullet speed per game tick.
// The timer starts at `flight` (+0x34, a float) and each tick (update 0x005e400c) moves the
// object by its velocity, then the timer drops by 1; the object dies when the timer is at or
// below -1/128 (so after floor(flight) + 1 ticks: the last move goes a tick past the end). It
// also dies when its shooter is gone; that tick still moves it (the owner check 0x005c57ac).
export class ShotEffect {
  pos: Vec3;
  readonly vel: Vec3;
  private timer: number;
  private dead = false;

  constructor(start: Vec3, dir: Vec3, flight: number) {
    this.pos = { ...start };
    this.vel = { x: dir.x / flight, y: dir.y / flight, z: dir.z / flight };
    this.timer = flight;
  }

  // The exe makes the object only when the float is not 0 (0x005e407c; flights are >= 0 here).
  static make(start: Vec3, dir: Vec3, flight: number): ShotEffect | null {
    return flight > 0 && Number.isFinite(flight) ? new ShotEffect(start, dir, flight) : null;
  }

  get alive(): boolean {
    return !this.dead;
  }

  // One game tick of the object (0x005e400c).
  tick(ownerAlive: boolean): void {
    if (this.dead) return;
    if (!ownerAlive) this.dead = true;
    this.pos = { x: this.pos.x + this.vel.x, y: this.pos.y + this.vel.y, z: this.pos.z + this.vel.z };
    this.timer -= 1;
    if (this.timer <= TIMER_END) this.dead = true;
  }
}

// gun_bullet_collision_check: the target moved too far from the shot's position.
export function bulletMissed(origCentre: Vec3, nowCentre: Vec3): boolean {
  return distXzSq(origCentre, nowCentre) >= BULLET_COLLISION_RADIUS_SQ;
}

// The miss text (display_attack_miss_text_) shows only when the target moved towards the shooter.
export function movedTowards(origCentre: Vec3, nowCentre: Vec3, shooter: Vec3): boolean {
  return distXzSq(nowCentre, shooter) < distXzSq(origCentre, shooter);
}
