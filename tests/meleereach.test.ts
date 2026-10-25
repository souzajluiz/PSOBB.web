// Melee reticle reach (combat/weaponaim.ts inMeleeReach, the port's weaponTargets): the exe's
// check_enemy_is_targetable (PsoBB.exe 0x007a2b5c) tests each target with the weapon's ItemPMT row.
// The reach counts the target's radius; the cone's apex is the weapon, or vertical_distance units
// behind it (the usual row has vertical 18, so the apex is behind); the elevation is a cone too,
// with no height window. Run: node tests/meleereach.test.ts
import { inMeleeReach, meleeReachAny, MELEE_BOX_KIND, type MeleeAim } from '../client/src/combat/weaponaim.ts';
import { weaponPositionY } from '../client/src/combat/weaponorigin.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// The usual sword row (h 14, v 18, half angles 0x127d, n 1): horizontal reach 14 + 18 = 32,
// apex 18 behind the weapon, cone and elevation half angle ~26 degrees.
const SWORD: MeleeAim = { heading: 0, horizontal: 14, vertical: 18, hAngle: 0x127d, vAngle: 0x127d };
const W = { x: 0, y: 0, z: 0 };
const at = (x: number, y: number, z: number) => ({ x, y, z });

// A. straight ahead inside the reach (the apex is 18 behind, so the cone is centred on it)
check(inMeleeReach(W, SWORD, at(0, 0, 30), 0), 'a target 30 ahead is in the sword reach');
// B. past the horizontal reach (14 + 18)
check(!inMeleeReach(W, SWORD, at(0, 0, 33), 0), 'a target 33 ahead is past the 32 reach');
// C. the apex shift widens the cone: (15, 25) is 31 degrees off the weapon but ~19 from the apex
check(inMeleeReach(W, SWORD, at(15, 0, 25), 0), 'a target 15 right and 25 ahead is in the cone from the apex (exe apex 18 behind)');
// D. outside the cone even from the apex
check(!inMeleeReach(W, SWORD, at(20, 0, 10), 0), 'a target 20 right and 10 ahead is outside the cone');
// E. elevation: 30 units up at 20 ahead is ~38 degrees from the apex, past the ~26 degree cone
check(!inMeleeReach(W, SWORD, at(0, 30, 20), 0), 'a target 30 units up at 20 ahead is out of the elevation cone (no 40 height window)');
// F. 10 units up at 20 ahead is ~15 degrees, inside
check(inMeleeReach(W, SWORD, at(0, 10, 20), 0), 'a target 10 units up at 20 ahead is inside the elevation cone');
// G. the target's radius counts: 40 ahead with radius 10 reaches 42
check(inMeleeReach(W, SWORD, at(0, 0, 40), 10), 'a target 40 ahead with radius 10 is in reach');
check(!inMeleeReach(W, SWORD, at(0, 0, 40), 0), 'the same target without its radius is out of reach');
// H. a zero half angle (BAMS 0) is omnidirectional in the exe (cos 1 skips the cone)
const OMNI: MeleeAim = { heading: 0, horizontal: 14, vertical: 0, hAngle: 0, vAngle: 0 };
check(inMeleeReach(W, OMNI, at(12, 0, 0), 0), 'a zero horizontal half angle reaches a target 12 to the side');
// I. vertical 0x4000 and a target exactly above the weapon: struck with no cone test
const UP: MeleeAim = { heading: 0, horizontal: 14, vertical: 18, hAngle: 0x127d, vAngle: 0x4000 };
check(inMeleeReach(W, UP, at(0, 50, 0), 0), 'a target exactly above the weapon with vertical 0x4000 is struck');
check(!inMeleeReach(W, SWORD, at(0, 50, 0), 0), 'the same point with the sword vertical cone is out (elevation)');
// J. vertical distance 0: the apex is the weapon itself
const FLAT: MeleeAim = { heading: 0, horizontal: 14, vertical: 0, hAngle: 0x127d, vAngle: 0x127d };
check(inMeleeReach(W, FLAT, at(0, 0, 13), 0), 'with vertical 0 a target 13 ahead is in the 14 reach');
check(!inMeleeReach(W, FLAT, at(0, 0, 15), 0), 'with vertical 0 a target 15 ahead is past the 14 reach');
check(!inMeleeReach(W, FLAT, at(15, 0, 25), 0), 'with vertical 0 the apex is the weapon: (15, 25) is 31 degrees off, outside');
// K. the heading turns the cone: facing +x, a target 30 along +x is ahead
check(inMeleeReach(W, { ...SWORD, heading: Math.PI / 2 }, at(30, 0, 0), 0), 'facing +x, a target 30 along +x is in reach');

// L. the weapon point is the feet with 0.5 * the bloodstain offset (exe 0x0077a1f4; the offset ASSUMED 0)
check(weaponPositionY(7) === 7, 'the weapon point height is the feet (bloodstain offset 0, ASSUMED)');
check(weaponPositionY(7, 40) === 27, 'the weapon point height is the feet plus half the bloodstain offset');

// M. per-box reach (check_enemy_is_targetable's loop over hitbox_count): a box passes only when enabled
// (bit 0) and of the weapon's kind (0x8000); the key is the nearest passing box's XZ distance squared
const BOX = (x: number, y: number, z: number, radius: number, flags: number) => ({ x, y, z, radius, flags });
const ON = 0x8001;
check(meleeReachAny(W, SWORD, [BOX(0, 0, 30, 0, ON)]) === 900, 'an enabled kind box 30 ahead gives key 900');
check(meleeReachAny(W, SWORD, [BOX(0, 0, 30, 0, 0x0001)]) === Infinity, 'a box without the kind bit 0x8000 is not a target');
check(meleeReachAny(W, SWORD, [BOX(0, 0, 30, 0, 0x8000)]) === Infinity, 'a disabled box (bit 0 clear) is not a target');
check(meleeReachAny(W, SWORD, [BOX(0, 0, 60, 0, ON), BOX(0, 0, 20, 0, ON)]) === 400, 'the nearest passing box gives the key');
check(meleeReachAny(W, SWORD, [BOX(0, 0, 60, 0, ON), BOX(0, 0, 33, 0, ON)]) === Infinity, 'boxes past the reach do not pass');
check(meleeReachAny(W, SWORD, [BOX(0, 0, 60, 0, ON), BOX(0, 0, 40, 10, ON)]) === 1600, 'a box with radius 10 reaches 40 ahead (its own radius)');
check(MELEE_BOX_KIND === 0x8000, 'the weapon kind mask is 0x8000 (ApplyTargetingUIConfig field4)');
check(!inMeleeReach(W, { ...SWORD, heading: Math.PI / 2 }, at(0, 0, 30), 0), 'facing +x, a target 30 along +z is behind the cone');

console.log(failures === 0 ? 'meleereach: all ok' : `meleereach: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
