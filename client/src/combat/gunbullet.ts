// Gun bullets (PsoBB.exe, Ephinea 1.25.13, addresses are VAs; the named dump
// refsrc Psobb.exe-05112026.c and objdump agree on every value below).
//
// A shot is begin_gun_bullet_attack (0x005e6578), called once per pellet
// (unk_shoot_shotgun 0x005fe004 for the Shot, 5 pellets, plus the regular shot: 6 in all;
// one call for the others, InitializeGunBulletAttack_005ec2bc):
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
//    0x005e4264 (Handgun 6 with group_idx 8, Samba 0x48, 0x1c) makes no muzzle and no
//    model: the 0x64-byte ShotEffect (0x005e407c) flies the same way, with particle 0x9f on it.
//
// WHICH weapons shoot (the gate, traced 2026-10-23 with objdump on PsoBB.exe and the named dump):
//  - the item's do_attack (vtable +0x70) is PerformItemAttack (0x005e8908) for every weapon
//    vtable read so far (base 0x00b10200, Handgun 0x00b15640, 0x1c 0x00b14580, Rifle 0x00b19f40,
//    Mechgun 0x00b16260, Shot 0x00b1b400, 0x42 0x00b10500, 0x65 0x00b1d140, 0x45 0x00b14d80, 0x6d 0x00b167e0).
//    It runs the extraspecial hook (+0xcc) first, then re-reads the item flags at +0x1dc
//    (0x005e8a1a): bit 0x2 -> no regular shot; bit 0x8000 -> the launcher projectile;
//    bit 0x20000 -> do_regular_melee_attack (0x005e90e8) and return; else the regular shot
//    begin_gun_bullet_attack (+0xc8, 0x005e6578) once, called as (vec, 0, 0, 1) at 0x005e8cc9.
//    The default hook 0x0061cdb0 does nothing.
//  - the melee split, bit 0x20000 (corrected 2026-10-23; the earlier "never set" read the EBP at
//    0x005e93c8, which is inside the function, not its result): construct_generic_weapon calls
//    UpdateItemFlagBasedOnStatus (0x005e9578), which calls the item's vtable +0x78 = 0x005e93a8
//    (UnknownItemFunction26; the same slot in the base, Handgun and 0x1c vtables). That returns
//    bit 0 set unless the animation class is 3: the class is GetWeaponAnimationTableEntry (0x005d6724),
//    the PMT byte at group_2 (ItemPMT weaponKinds) indexed into the table at 0x0092c360. So a class-3
//    weapon gets 0x10000 (the gun path), any other weapon gets 0x20000 (melee). Bit 0x10000 is the
//    flag the regular path needs.
//  - the animation class 3 kinds (param/ItemPMT.bin, PMT weaponKinds through the table): 6 7 8 9 12 13 14 15
//    1b 1c 1e 26 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 65 66 67 6a 6b 6c 6d 75 76 77 78 7e 7f 83 84 8b 8d 91
//    99 9e a3 a6 ad af b0 b1 bf c0 c1 cd d2 e8 e9 ea eb. Only the ones traced below are in GUN_KINDS; the rest
//    are NOT traced (ASSUMED not guns until their ctors are read).
//  - the guns on the regular path (flags 0x10000, no 0x2): Handgun 6 (factory 0x005f32ec, also 0x44,
//    0xaf, 0xe8), the 0x1c factory (0x005f10f4), Rifle 7 (factory 0x005fb400, inner ctor 0x005fb494,
//    vtable 0xb19f40), Shot 9 (its hook below, then the regular shot too), 0x65 (factory 0x00601c8c, inner
//    0x00601d20), 0x42 (factory 0x005ea260, inner 0x005ea2f4; its variant 1 hook 0x005ea204 shoots the
//    same single pellet, so 0x42 is a gun in every variant).
//  - the own-hook guns (2 flags 0x203 or 0x22 in the ctor): Samba 0x48 (0x005fc348 calls +0xc8 itself);
//    Mechgun 8 (factory 0x005f46a8, inner 0x005f473c, flags 0x203, hook 0x005f4620 calls +0xc8 twice:
//    the vectors at +0x240 and +0x24c; the second is a bullet only when the first made none; the
//    +0x24c start is ASSUMED the node point, see DEVLOG 2026-10-25); 0x45 (factory 0x005f211c, inner 0x005f21b0,
//    flags 0x22, hook 0x005f205c: when the player's state at +0x8a4 is 2 and its vtable +0x84 is 1 it fires
//    the projectile 0x005e6df8 (ASSUMED state meaning, 0x005e90b0), else for group_idx != 1 it calls +0xc8
//    once; group_idx 1 is the projectile).
//  - the Shot (9, factory 0x005fe0dc, inner 0x005fe170, vtable 0xb1b400): its hook 0x005fe004 calls +0xc8
//    for five pellets (the angles 0x0092dffc) and the muzzle once; the regular path then calls it once
//    more at angle 0 (target index 0), so six begin calls per trigger.
//  - the Rifle's group_idx 13 (ctor 0x005fb4f7 sets flags 0x8000 | 0x4000000) is the launcher projectile:
//    no begin_gun call on its path (not a bullet). group_idx 12 is the regular path.
//  - no bullet: kind 0x6d (factory 0x005f4f64, vtable 0xb167e0, flags 0x2, hook 0x005d20b8: no direct
//    call to +0xc8 or begin_gun; indirect callees not traced). Kind 0x8b (ctor 0x005eb05c, flags 0x2) shoots
//    through its own hook 0x005eae08, which calls 0x005e6df8 / 0x005e7014, not begin_gun_bullet_attack.
//  - the factory table 0x009c2244 is indexed by kind - 1 (Handgun at index 5, Samba at 71,
//    the 0x8b at 138; checked with tools/exedata.py reads).
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
// Rifle 7 (inner 0x005fb494), Mechgun 8 (inner 0x005f473c), 0x42 and 0x45 keep the generic 19.0 (no
// 0x208 write in their inner ctors). Kind 0x65 (inner 0x00601d20): movl $0x41a00000 (20.0) at 0x00601d52.
// The Handgun's 11.0 is written only in its egg branch (0x005f3380: group_2 == 6 and group_idx == 8,
// the bytes at item +0xf3 / +0xf4); the other Handguns keep 19.0. The 0x1c ctor (0x005f1188) writes 11.0.
export const GUN_BULLET_SPEED_DEFAULT = 19;
export const HANDGUN_KIND = 6;
export const HANDGUN_EGG_VARIANT = 8; // group_idx (data1[2]) of the Handgun branch 0x005f3380 tests
export const GUN_BULLET_SPEED_BY_KIND: ReadonlyMap<number, number> = new Map([
  [0x1c, 11],
  [9, 15],
  [0x48, 11],
  [0x65, 20],
]);
// variant = the item's group_idx (data1[2]); only the Handgun's speed depends on it.
export const bulletSpeed = (kind: number, variant = -1): number => {
  if (kind === HANDGUN_KIND) return variant === HANDGUN_EGG_VARIANT ? 11 : GUN_BULLET_SPEED_DEFAULT;
  return GUN_BULLET_SPEED_BY_KIND.get(kind) ?? GUN_BULLET_SPEED_DEFAULT;
};
export const BULLET_COLLISION_RADIUS_SQ = 64; // g_WeaponBulletCollisionRadiusSq (0x0092bcb4)
export const BULLET_WALL_MASK = 0x8100; // cast_ray_at_map_collision_geometry flags of begin_gun_bullet_attack
export const MUZZLE_PARTICLE = 9; // create_particle_effect(hand, 9) (0x005e4678, unk_shoot_shotgun)
export const SHOT_ANGLES_BAMS: readonly number[] = [0, 2184, -2184, 4551, -4551]; // shotgun_bullet_angles (0x0092dffc)

// ItemPMT weapon kinds (data1[1]) of the guns that fire begin_gun_bullet_attack (see the gate in
// the header; all traced 2026-10-23). Handgun 6 and Shot 9 are the rows the ItemPMT test reads
// (tests/rangedaim.test.ts). Rifle 7 (regular shot), Mechgun 8 (own hook), 0x42 and 0x45 (variant 1
// is the projectile, see firesGunBullet) and 0x65 (regular shot, no callback) are guns. Samba Maracas
// 0x48 fires from its own hook (0x005fc348). The Handgun factory's kinds 0x44, 0xaf, 0xe8 share the
// Handgun vtable and flags 0 (the regular shot). The 0x1c ctor has flags 0 too. Not guns: 0x6d (no
// begin call on its path) and 0x8b (its own hook, 0x005eae08). The other class-3 kinds are not traced.
export const GUN_KINDS: ReadonlySet<number> = new Set([6, 7, 8, 9, 0x1c, 0x42, 0x44, 0x45, 0x48, 0x65, 0xaf, 0xe8]);
export const isGunKind = (kind: number): boolean => GUN_KINDS.has(kind);
// Whether this item's attack puts a bullet on the bullet path (variant = data1[2] = group_idx):
//  - Rifle 7, group_idx 13: ctor flags 0x8000 (launcher projectile), no begin call;
//  - 0x45, group_idx 1: the hook's projectile branch (0x005f20bf), no begin call.
export const firesGunBullet = (kind: number, variant = -1): boolean => {
  if (!isGunKind(kind)) return false;
  if (kind === 7 && variant === 13) return false;
  if (kind === 0x45 && variant === 1) return false;
  return true;
};
// The Shot (kind 9) makes six begin calls per trigger: the hook 0x005fe004's five pellets (angles
// SHOT_ANGLES_BAMS, targets 0..4), then the regular shot (0x005e8cc9) at angle 0 with target 0.
// The Mechgun makes two (the second is visual-only when the first made a bullet); the others make one.
export const SHOT_KIND = 9;
// The Mechgun (kind 8) makes two begin_gun_bullet_attack calls per do_attack (do_mechguns_attack
// 0x005f4620, dump line 452534): the first at the weapon point +0x240, the second at +0x24c with
// is_allowed_to_hit = (the first made no bullet). Both aim at listed target 0 (the 0,0,1 call).
export const MECHGUN_KIND = 8;
export const pelletCount = (kind: number): number => {
  if (kind === SHOT_KIND) return SHOT_ANGLES_BAMS.length + 1;
  if (kind === MECHGUN_KIND) return 2;
  return 1;
};
// The pellet's angle (BAMS) and its listed target index (pellet 5 of the Shot is the regular shot).
export const pelletAngleBams = (kind: number, i: number): number => {
  if (kind === MECHGUN_KIND) return 0; // (vec, 0, 0, 1): both calls at angle 0
  return kind === SHOT_KIND && i === SHOT_ANGLES_BAMS.length ? 0 : (SHOT_ANGLES_BAMS[i] ?? 0);
};
export const pelletTargetIndex = (kind: number, i: number): number => {
  if (kind === MECHGUN_KIND) return 0;
  return kind === SHOT_KIND && i === SHOT_ANGLES_BAMS.length ? 0 : i;
};
// Whether pellet i may make a bullet (begin's is_allowed_to_hit): the Mechgun's second call is
// allowed only when the first made none (do_mechguns_attack: iVar1 == 0). Every other pellet is allowed.
export const pelletAllowed = (kind: number, i: number, bulletMadeSoFar: boolean): boolean =>
  !(kind === MECHGUN_KIND && i === 1 && bulletMadeSoFar);
// The Rifle (kind 7, group_idx 8..13) hook ExecutePartisanWeaponAttack (0x005fb310) puts a muzzle
// particle 9 at the hand before the regular shot (for group_idx 12 that is the second muzzle, the
// default callback's is the other). Returns true for those variants.
export const RIFLE_KIND = 7;
export const rifleHookMuzzle = (kind: number, variant: number): boolean => kind === RIFLE_KIND && variant >= 8 && variant <= 13;

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
  allowed = true,
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
    // begin_gun_bullet_attack creates the bullet only in the no-wall target branch with is_allowed_to_hit != 0.
    bullet: !!target && !wall && allowed,
    dir: { x: from.x - start.x, y: from.y - start.y, z: from.z - start.z },
    flight: d / speed,
  };
}

// The shot's visual (the item's shot callback at +0x238, written by the inner ctor):
//  - 'default': 0x005e4678 (create_gun_bullet_particle_effect): the muzzle particle 9 at the
//    hand and the gun_bullet.xj object of the trail (render/guntracer.ts);
//  - 'egg': 0x005e4264, no muzzle particle and no bullet model; the effect object ShotEffect
//    below, with particle 0x9f on it;
//  - 'none': the callback is 0 (the ctor writes 0 to +0x238), so begin_gun makes no visual at all
//    (the sites at 0x005e6957 and 0x005e6d73 test it). The muzzle may still come from the hook.
export type ShotVisual = 'default' | 'egg' | 'none';
// The inner ctors that write the shot callback (read from the exe, 2026-10-23):
//  - Handgun 6 (ctor 0x005f3380): 0x005e4264 only when group_idx (data1[2], item +0xf4) is 8; other
//    Handguns, including 0x44 / 0xaf / 0xe8 (their group_2 is not 6), keep the default 0x005e4678;
//  - 0x1c (ctor 0x005f1188) and Samba 0x48 (ctor 0x005fc2fc): 0x005e4264 always;
//  - Shot 9 (ctor 0x005fe170, 0x005fe19c) and 0x65 (ctor 0x00601d20, 0x00601d3a): 0 (none);
//  - Rifle 7 (ctor 0x005fb494): 0 for group_idx 8..11 and 13, default for 12 and the others;
//  - 0x8b (ctor 0x005eb05c, group_idx 3): written, but 0x8b's shots do not reach the callback;
//  - every other ctor traced (Mechgun 0x005f473c, 0x42 0x005ea2f4, 0x45 0x005f21b0) writes nothing,
//    so the generic ctor's default 0x005e4678 (written at 0x005e96d9) stays.
export const shotVisualOf = (kind: number, variant = -1): ShotVisual => {
  if (kind === HANDGUN_KIND) return variant === HANDGUN_EGG_VARIANT ? 'egg' : 'default';
  if (kind === 0x1c || kind === 0x48) return 'egg';
  if (kind === SHOT_KIND || kind === 0x65) return 'none';
  if (kind === 7 && ((variant >= 8 && variant <= 11) || variant === 13)) return 'none';
  return 'default';
};

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
