// Aim of a weapon attack (PsoBB.exe, Ephinea 1.25.13, addresses are VAs).
//
// Cone: check_enemy_is_targetable (0x007a2b5c, the .c near line 785551) tests a target
// against the weapon's reticle with dot(heading direction, direction to the target) >=
// cos(horizontal_angle), so the cone is centred on the heading and its half angle is the
// weapon's horizontal half angle (ItemPMT WeaponRange, BAMS). The cone's apex is the weapon
// itself, or the point vertical_distance units behind it when that distance is not 0
// (inMeleeReach). See inMeleeReach for the melee rule.
//
// Facing: dispatch_action_attack_step1 (0x006a0f58) sends the attack's angle
// toward the primary target (get_player_primary_target_position: the nearest
// reticle target) and the heading when there is none.

// Signed angle from the heading to the direction (dx, dz), in (-pi, pi].
export function coneOffset(dx: number, dz: number, heading: number): number {
  const diff = Math.atan2(dx, dz) - heading;
  return Math.atan2(Math.sin(diff), Math.cos(diff));
}

// Whether (dx, dz) lies inside the cone of `halfAngle` radians around `heading`.
export function inWeaponCone(dx: number, dz: number, heading: number, halfAngle: number): boolean {
  return Math.abs(coneOffset(dx, dz, heading)) <= halfAngle;
}

// The facing (angle around y, the port's heading convention) toward (dx, dz).
export function facingOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

// The weapon's target reach from the player: the origin, the heading and the
// weapon's range and cone (WeaponRange of the ItemPMT entry, render/combat.ts weaponRange).
export interface WeaponReach {
  x: number;
  y: number;
  z: number;
  heading: number;
  maxDist: number; // horizontal + vertical range
  halfAngle: number; // radians
}

// Whether a point is in the weapon's target reach. find_targets_for_weapons_and_techs
// (PsoBB.exe .c:785117) keeps a target inside the range and the cone; the 40-unit height
// window is the port's enemy rule (render/combat.ts weaponTargets), ASSUMED for the others.
export function inWeaponReach(r: WeaponReach, x: number, y: number, z: number): boolean {
  const dx = x - r.x;
  const dz = z - r.z;
  if (Math.hypot(dx, dz) > r.maxDist) return false;
  if (Math.abs(y - r.y) > 40) return false;
  return inWeaponCone(dx, dz, r.heading, r.halfAngle);
}

// The melee reticle test of one target point (check_enemy_is_targetable, PsoBB.exe
// 0x007a2b5c, .c near line 785551), with the weapon's ItemPMT row:
//   - reach: the XZ distance from the weapon to the target <= horizontal + vertical + radius
//     (the target's collision radius counts, the exe's `radius + horizontal_distance`);
//   - the apex: the weapon itself when vertical_distance is 0, else the point vertical_distance
//     units behind it along the heading (the exe's "back" point);
//   - horizontal cone: dot(heading direction, unit(target - apex) on XZ) >= cos(horizontal_angle);
//   - vertical cone: dot(unit(target - apex) on XZ, unit(target - weapon)) >= cos(vertical_angle)
//     (the elevation as seen from the apex, with the height from the weapon), so there is no
//     height window;
//   - a half angle whose cosine is +-1 (BAMS 0 or 0x8000) skips that cone; a target exactly
//     above the weapon with vertical_angle 0x4000 is struck with no cone test.
// Angles are BAMS (0x10000 = 360 degrees) as the ItemPMT row keeps them; `heading` is radians
// (the port's convention, facingOf). A zero-length direction is the zero vector (vec3_safe_normalize).
export interface MeleeAim {
  heading: number; // radians
  horizontal: number; // the PMT horizontal distance (the exe adds vertical to it)
  vertical: number; // the PMT vertical distance
  hAngle: number; // PMT horizontal half angle, BAMS
  vAngle: number; // PMT vertical half angle, BAMS
}

const BAMS_RAD = (Math.PI * 2) / 0x10000;

export function inMeleeReach(
  w: { x: number; y: number; z: number },
  aim: MeleeAim,
  p: { x: number; y: number; z: number },
  radius: number,
): boolean {
  const dx = p.x - w.x;
  const dz = p.z - w.z;
  const reach = aim.horizontal + aim.vertical + radius;
  if (dx * dx + dz * dz > reach * reach) return false;
  if (aim.vAngle === 0x4000 && dx === 0 && dz === 0) return true;
  const sinH = Math.sin(aim.heading);
  const cosH = Math.cos(aim.heading);
  const apx = aim.vertical === 0 ? w.x : w.x - aim.vertical * sinH;
  const apz = aim.vertical === 0 ? w.z : w.z - aim.vertical * cosH;
  const hCos = Math.cos(aim.hAngle * BAMS_RAD);
  const vCos = Math.cos(aim.vAngle * BAMS_RAD);
  if (!(hCos <= -1 || hCos >= 1)) {
    const hx = p.x - apx;
    const hz = p.z - apz;
    const m = Math.hypot(hx, hz);
    const dot = m === 0 ? 0 : (hx / m) * sinH + (hz / m) * cosH;
    if (dot < hCos) return false;
  }
  if (!(vCos <= -1 || vCos >= 1)) {
    const hx = p.x - apx;
    const hz = p.z - apz;
    const dy = p.y - w.y;
    // unit(hx, 0, hz) . unit(hx, dy, hz) = |h| / |(h, dy)|; a zero horizontal part is the zero vector.
    const mh = Math.hypot(hx, hz);
    const m3 = Math.hypot(hx, dy, hz);
    const dot = mh === 0 || m3 === 0 ? 0 : mh / m3;
    if (dot < vCos) return false;
  }
  return true;
}
