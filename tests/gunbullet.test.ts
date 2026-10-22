// Gun bullets (client/src/combat/gunbullet.ts, PsoBB.exe begin_gun_bullet_attack 0x005e6578,
// gun_bullet_collision_check 0x005c7120): the flight time from the distance and speed 19,
// the aim point pulled back by the hitbox radius, the wall ray (mask 0x8100), the
// movement miss (g_WeaponBulletCollisionRadiusSq = 64), the Shot's five pellets, and the
// trail's lifetime. Run: node tests/gunbullet.test.ts
import {
  bulletFrames,
  bulletMissed,
  GUN_BULLET_SPEED,
  isGunKind,
  movedTowards,
  openAimPoint,
  pelletCount,
  planGunShot,
  SHOT_ANGLES_BAMS,
  targetAimPoint,
} from '../client/src/combat/gunbullet.ts';
import * as THREE from 'three';
import { bulletAngles, bulletTextureIndex, GunTracers } from '../client/src/render/guntracer.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const O = { x: 0, y: 0, z: 0 };
const noWall = () => false;
const wall = () => true;

// Speed: the item speed_maybe of a gun is 19 (construct_generic_weapon 0x005e959c).
check(GUN_BULLET_SPEED === 19, 'gun bullet speed is 19');
check(bulletFrames(19) === 1 && bulletFrames(60) === 3 && bulletFrames(170) === 9, `frames = ROUND(distance / 19): 19 -> 1, 60 -> 3, 170 -> 9 (${bulletFrames(19)}, ${bulletFrames(60)}, ${bulletFrames(170)})`);
check(bulletFrames(0) === 0, 'a target at the hand arrives on the next tick (0 frames)');
check(bulletFrames(60, 10) === 6, 'speed is a parameter (60 / 10 = 6)');

// Aim point: the hitbox centre pulled back by the radius along the shot.
{
  const end = targetAimPoint(O, { x: 0, y: 0, z: 60 }, 10);
  check(near(end.z, 50) && near(end.x, 0), `aim point stops the radius short of the centre (${JSON.stringify(end)})`);
}

// Frame count uses the distance to the centre, not to the aim point (begin_gun_bullet_attack).
{
  const shot = planGunShot(O, { heading: 0, angleBams: 0, horizontalDistance: 170 }, { centre: { x: 0, y: 0, z: 60 }, radius: 10 }, noWall);
  check(shot.bullet && !shot.wall, 'a target with no wall makes a bullet');
  check(shot.frames === bulletFrames(60), `flight time to the centre: ${shot.frames} frames (60 / 19 -> 3)`);
  check(near(shot.end.z, 50), 'the trail ends at the aim point');
}

// Wall: the ray from the hand to the aim point stops the shot: no bullet, no damage.
{
  const seen: Array<[number, number]> = [];
  const shot = planGunShot(O, { heading: 0, angleBams: 0, horizontalDistance: 170 }, { centre: { x: 0, y: 0, z: 60 }, radius: 10 }, (a, b) => {
    seen.push([a.z, b.z]);
    return true;
  });
  check(shot.wall && !shot.bullet, 'a wall on the ray stops the shot (no bullet)');
  check(seen.length === 1 && near(seen[0][0], 0) && near(seen[0][1], 50), `the wall ray runs from the hand to the aim point (${JSON.stringify(seen)})`);
  check(planGunShot(O, { heading: 0, angleBams: 0, horizontalDistance: 170 }, { centre: { x: 0, y: 0, z: 60 }, radius: 10 }, wall).bullet === false, 'wall: no bullet');
}

// No target: the shot goes horizontal_distance ahead at heading + angle, no bullet.
{
  const straight = openAimPoint(O, 0, 0, 170);
  check(near(straight.x, 0) && near(straight.z, 170), `open aim at heading 0 is +z (${JSON.stringify(straight)})`);
  const quarter = openAimPoint(O, 0, 0x4000, 100); // BAMS 16384 = 90 degrees
  check(near(quarter.x, 100, 1e-6) && Math.abs(quarter.z) < 1e-6, `BAMS 0x4000 turns the open aim to +x (${JSON.stringify(quarter)})`);
  const shot = planGunShot(O, { heading: 0, angleBams: 0, horizontalDistance: 170 }, null, noWall);
  check(!shot.bullet && !shot.wall && shot.frames === bulletFrames(170), 'no target: trail only, no bullet');
}

// Shot: five pellets at the exe's angles (shotgun_bullet_angles 0x0092dffc); only kind 9 has five.
check(SHOT_ANGLES_BAMS.length === 5 && SHOT_ANGLES_BAMS[0] === 0 && SHOT_ANGLES_BAMS[1] === 2184 && SHOT_ANGLES_BAMS[3] === 4551, 'five shot angles 0, 2184, -2184, 4551, -4551');
check(pelletCount(9) === 5 && pelletCount(6) === 1 && pelletCount(7) === 1, 'the Shot fires five pellets, the other guns one');
check(isGunKind(6) && isGunKind(7) && isGunKind(8) && isGunKind(9), 'Handgun, Rifle, Mechgun, Shot are guns');
check(!isGunKind(1) && !isGunKind(10) && !isGunKind(11), 'melee kinds and the launcher are not on the bullet path');

// Movement miss: at 8 or more in XZ since the shot (64 = g_WeaponBulletCollisionRadiusSq).
{
  const orig = { x: 0, y: 0, z: 60 };
  check(!bulletMissed(orig, { x: 7.9, y: 0, z: 60 }), 'moved 7.9: hit');
  check(bulletMissed(orig, { x: 8, y: 0, z: 60 }), 'moved 8.0: missed (64 <= 64)');
  check(!bulletMissed(orig, { x: 0, y: 500, z: 60 }), 'height is not part of the test');
  check(bulletMissed(orig, { x: 5.7, y: 0, z: 65.7 }), 'a diagonal move of 8.1 in XZ is missed');
  check(movedTowards(orig, { x: 0, y: 0, z: 50 }, O) && !movedTowards(orig, { x: 0, y: 0, z: 70 }, O), 'the miss text shows only when the target came towards the shooter');
}

// Trails: one per flight, removed when it lands, and nothing after dispose.
{
  // A stand-in scene: the trails only add and remove their meshes.
  const children: unknown[] = [];
  const scene = {
    children,
    add: (o: unknown) => children.push(o),
    remove: (o: unknown) => {
      const i = children.indexOf(o);
      if (i >= 0) children.splice(i, 1);
    },
  } as unknown as import('three').Scene;
  const tracers = new GunTracers(scene);
  // A stand-in model: an empty group per bullet (the real one is gun_bullet.xj).
  tracers.setModels({ variant: () => new THREE.Object3D(), dispose: () => {} });
  tracers.spawn(O, { x: 0, y: 0, z: 50 }, 3);
  tracers.spawn(O, { x: 0, y: 0, z: 50 }, 0);
  check(tracers.count === 2 && scene.children.length === 2, 'two trails in flight');
  tracers.tick();
  check(tracers.count === 1, 'the zero-frame trail is gone after one tick');
  tracers.tick();
  tracers.tick();
  check(tracers.count === 0 && scene.children.length === 0, 'the trail is removed when its frames run out');
  tracers.spawn(O, { x: 0, y: 0, z: 50 }, 3);
  tracers.dispose();
  tracers.spawn(O, { x: 0, y: 0, z: 50 }, 3);
  check(tracers.count === 0 && scene.children.length === 0, 'dispose removes the trails; no spawn after');
}

// Orientation (0x005e4158, 0x005e43e8): yaw = atan2(x, z), pitch = -atan2(y, horizontal), roll 0.
{
  const is = (a: { pitch: number; yaw: number }, pitch: number, yaw: number) => a.pitch === pitch && a.yaw === yaw;
  check(is(bulletAngles({ x: 0, y: 0, z: 1 }), 0, 0), 'forward: no yaw, no pitch');
  check(is(bulletAngles({ x: 1, y: 0, z: 0 }), 0, 0x4000), 'toward +x: yaw 90 degrees');
  check(is(bulletAngles({ x: 0, y: 1, z: 1 }), -0x2000, 0), 'up 45 degrees: pitch -45 degrees');
  check(is(bulletAngles({ x: 0, y: -1, z: 0 }), 0x4000, 0), 'straight down: pitch +90 degrees');
}

// Texture variant (FUN_005e94c8 and the ctor's clamp).
check(bulletTextureIndex(0, 0) === 0 && bulletTextureIndex(0, 3) === 3, 'the variant is the shooter byte +0xf4');
check(bulletTextureIndex(0, 5) === 4, 'a variant out of 0..4 is 4');
check(bulletTextureIndex(0x14, 1) === 2 && bulletTextureIndex(0x14, 0) === 0, 'class 0x14: 2 for +0xf4 = 1');
check(bulletTextureIndex(0xe9, 7) === 1, 'classes 0xe8..0xeb: variant 1');

// Flight (0x005e400c): the position moves by the velocity each game tick; a frame
// between two ticks moves it part of the way.
{
  const scene = new THREE.Scene();
  const tr = new GunTracers(scene);
  tr.setModels({ variant: () => new THREE.Object3D(), dispose: () => {} });
  tr.spawn(O, { x: 0, y: 0, z: 30 }, 3, 0); // 10 units a tick
  const z = () => scene.children[0].position.z;
  check(scene.children.length === 1 && z() === 0, 'a bullet starts at the hand');
  tr.frame(0.5);
  check(near(z(), 5), 'half a tick on: z 5');
  tr.tick();
  check(near(z(), 10), 'one tick: z 10');
  tr.frame(0.25);
  check(near(z(), 12.5), 'a quarter tick on: z 12.5');
  tr.tick();
  tr.tick();
  check(tr.count === 0 && scene.children.length === 0, 'it lands after 3 ticks and is removed');
}

// The model turns to the flight: yaw 90 degrees toward +x, Euler order Y X Z.
{
  const scene = new THREE.Scene();
  const tr = new GunTracers(scene);
  tr.setModels({ variant: () => new THREE.Object3D(), dispose: () => {} });
  tr.spawn(O, { x: 10, y: 0, z: 0 }, 2, 0);
  const m = scene.children[0];
  check(near(m.rotation.y, Math.PI / 2) && near(m.rotation.x, 0) && m.rotation.z === 0 && m.rotation.order === 'YXZ', 'toward +x: yaw 90 degrees, Y X Z order');
  tr.dispose();
}

if (failures) {
  console.log(`gunbullet: ${failures} failure(s)`);
  process.exit(1);
}
console.log('gunbullet: all checks passed');
