// Ship select backdrop camera math (client/src/classic/shipselectcamera.ts). The
// exe's camera is not decoded; these tests pin the fitted circle (ASSUMED) and
// the orbit's time base. Run: node tests/shipselectcamera.test.ts
import {
  SHIP_SELECT_CAMERA,
  shipSelectCameraAngle,
  shipSelectCameraPose,
  type Vec3,
} from '../client/src/classic/shipselectcamera.ts';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.log(`FAIL: ${msg}`);
  }
}
function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}
function vnear(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  return near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.z, b.z, eps);
}

const { radius, height, rate } = SHIP_SELECT_CAMERA;

// The fitted values the port had before the split (main.ts: 260, 120, 0.05).
ok(radius === 260 && height === 120 && rate === 0.05, 'fitted radius, height and rate are unchanged');

// Angle 0: straight out on +Z, at the height.
{
  const p = shipSelectCameraPose(0);
  ok(vnear(p.position, { x: 0, y: 120, z: 260 }), `angle 0 sits at (0, 120, 260), got ${JSON.stringify(p.position)}`);
}

// Quarter turn: on +X.
{
  const p = shipSelectCameraPose(Math.PI / 2);
  ok(near(p.position.x, 260) && near(p.position.z, 0, 1e-9) && p.position.y === 120, 'a quarter turn sits on +X');
}

// Every angle: the camera stays on the circle, at the height, and looks at the origin.
for (let i = 0; i < 720; i++) {
  const a = (i / 720) * Math.PI * 2 - Math.PI;
  const { position: p, target: t } = shipSelectCameraPose(a);
  ok(near(Math.hypot(p.x, p.z), radius, 1e-9), `radius holds at angle ${a}`);
  ok(p.y === height, `height holds at angle ${a}`);
  ok(vnear(t, { x: 0, y: 0, z: 0 }), `target is the origin at angle ${a}`);
  // The view direction points at the origin: it is the position's negation, horizontally.
  const fx = t.x - p.x;
  const fz = t.z - p.z;
  const dot = fx * p.x + fz * p.z;
  ok(dot < 0 && near(Math.hypot(fx, fz) * radius, -dot, 1e-6), `the view points inward at angle ${a}`);
}

// Time base: the angle is the old `t += dt * 0.05`, summed over frames.
{
  let a = 0;
  for (let i = 0; i < 60; i++) a = shipSelectCameraAngle(a, 1 / 60);
  ok(near(a, 0.05, 1e-12), `one second is 0.05 rad, got ${a}`);
  ok(shipSelectCameraAngle(1.25, 0) === 1.25, 'a zero step keeps the angle');
  ok(near(shipSelectCameraAngle(0, 2), 0.1, 1e-12), 'the angle is linear in dt');
}

// One full turn takes 2 pi / rate seconds (about 125.7 s): the pose repeats.
{
  const period = (Math.PI * 2) / rate;
  const start = shipSelectCameraPose(0.3);
  const again = shipSelectCameraPose(shipSelectCameraAngle(0.3, period));
  ok(vnear(start.position, again.position, 1e-9), 'the orbit repeats after one period');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('shipselectcamera: all tests passed');
