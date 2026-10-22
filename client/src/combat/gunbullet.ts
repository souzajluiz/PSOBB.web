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
//    speed = item speed_maybe = 19.0 (construct_generic_weapon 0x005e959c; the
//    other writers are 7.0 belra cannon 0x005ebecc and 10.0 0x005f0e34 /
//    0x005f44cc, not guns). The countdown runs one game tick per frame
//    (CountdownHelperConstructor 0x005e5b88).
//  - the effect: create_gun_bullet_particle_effect (0x005e4678) spawns particle
//    9 at the hand (create_particle_effect 0x0050b510) and a trail object from
//    the hand to the aim point over the same frames (object 0x005e4704, body
//    not decoded: ASSUMED shape).
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
export const GUN_BULLET_SPEED = 19; // item speed_maybe of a gun (construct_generic_weapon, 0x005e959c)
export const BULLET_COLLISION_RADIUS_SQ = 64; // g_WeaponBulletCollisionRadiusSq (0x0092bcb4)
export const BULLET_WALL_MASK = 0x8100; // cast_ray_at_map_collision_geometry flags of begin_gun_bullet_attack
export const MUZZLE_PARTICLE = 9; // create_particle_effect(hand, 9) (0x005e4678, unk_shoot_shotgun)
export const SHOT_ANGLES_BAMS: readonly number[] = [0, 2184, -2184, 4551, -4551]; // shotgun_bullet_angles (0x0092dffc)

// ItemPMT weapon kinds (data1[1]) of the guns that fire begin_gun_bullet_attack:
// Handgun 6 and Shot 9 are the rows the ItemPMT test reads (tests/rangedaim.test.ts);
// Rifle 7 and Mechgun 8 are ASSUMED to be the kinds in between.
export const GUN_KINDS: ReadonlySet<number> = new Set([6, 7, 8, 9]);
export const isGunKind = (kind: number): boolean => GUN_KINDS.has(kind);
// The Shot (kind 9) fires five pellets (unk_shoot_shotgun 0x005fe004); the others one.
export const SHOT_KIND = 9;
export const pelletCount = (kind: number): number => (kind === SHOT_KIND ? SHOT_ANGLES_BAMS.length : 1);

const TAU = Math.PI * 2;
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const distXzSq = (a: Vec3, b: Vec3): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

// The flight time of a shot covering `distance` (ROUND(local_14), ASSUMED to round
// half up for the positive values here).
export function bulletFrames(distance: number, speed = GUN_BULLET_SPEED): number {
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
}

// One pellet: the aim point, the wall ray and the bullet's flight time.
// `wallBlocks(from, to)` is the map ray (true when a wall of mask 0x8100 is hit).
export function planGunShot(
  start: Vec3,
  aim: { heading: number; angleBams: number; horizontalDistance: number },
  target: { centre: Vec3; radius: number } | null,
  wallBlocks: (from: Vec3, to: Vec3) => boolean,
): GunShot {
  const end = target ? targetAimPoint(start, target.centre, target.radius) : openAimPoint(start, aim.heading, aim.angleBams, aim.horizontalDistance);
  if (wallBlocks(start, end)) {
    // The wall branch: the effect only (the ground object's distance; ASSUMED the hit point).
    return { end, frames: bulletFrames(dist(start, end)), wall: true, bullet: false };
  }
  if (!target) return { end, frames: bulletFrames(dist(start, end)), wall: false, bullet: false };
  return { end, frames: bulletFrames(dist(start, target.centre)), wall: false, bullet: true };
}

// gun_bullet_collision_check: the target moved too far from the shot's position.
export function bulletMissed(origCentre: Vec3, nowCentre: Vec3): boolean {
  return distXzSq(origCentre, nowCentre) >= BULLET_COLLISION_RADIUS_SQ;
}

// The miss text (display_attack_miss_text_) shows only when the target moved towards the shooter.
export function movedTowards(origCentre: Vec3, nowCentre: Vec3, shooter: Vec3): boolean {
  return distXzSq(nowCentre, shooter) < distXzSq(origCentre, shooter);
}
