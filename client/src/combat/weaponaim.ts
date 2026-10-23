// Aim of a weapon attack (PsoBB.exe, Ephinea 1.25.13, addresses are VAs).
//
// Cone: check_enemy_is_targetable (0x007a2b28) tests an enemy against the
// weapon's reticle with dot(heading direction, direction to the target) >=
// cos(horizontal_angle), so the cone is centred on the heading and its half
// angle is the weapon's horizontal half angle (ItemPMT WeaponRange, BAMS).
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
