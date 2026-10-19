// Smooth rendering between game ticks (client/src/render/smoothrender.ts): a
// browser convenience, not PsoBB.exe behaviour. The pure interpolation, the
// shortest-arc angle, the snaps (teleports, hidden, moves outside a tick)
// and ?fps=30; then the TickSmoother on real three.js objects: the drawn
// matrix is interpolated, the logic pose is never touched.
// Run: node tests/smoothrender.test.ts
import * as THREE from '../client/node_modules/three/build/three.module.js';
import {
  interpolatePose,
  lerpAngle,
  newPose,
  newTrack,
  observe,
  shortestArc,
  smoothingFromSearch,
  SNAP_DISTANCE,
  TickClock,
  TickSmoother,
  type Pose,
} from '../client/src/render/smoothrender.ts';
import { PlayerCamera } from '../client/src/render/playercamera.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const pose = (px: number, py: number, pz: number, ry = 0, rx = 0, rz = 0): Pose => ({ px, py, pz, rx, ry, rz });

// --- shortest-arc angle ---
check(near(shortestArc(0, 1), 1), 'arc 0 -> 1');
check(near(shortestArc(1, 0), -1), 'arc 1 -> 0');
check(near(shortestArc(3, -3), 2 * Math.PI - 6), 'arc across +PI goes the short way (+0.28)');
check(near(shortestArc(-3, 3), 6 - 2 * Math.PI), 'arc across -PI goes the short way (-0.28)');
check(near(shortestArc(0, 4 * Math.PI + 0.5), 0.5), 'whole turns drop out');
check(near(shortestArc(0.2, 0.2 + 2 * Math.PI), 0, 1e-12), 'same heading, one turn apart: no turn');
check(near(lerpAngle(3, -3, 0.5), 3 + (2 * Math.PI - 6) / 2), 'lerpAngle across PI stays near PI');
check(Math.abs(lerpAngle(3, -3, 0.5)) > 3, 'lerpAngle across PI does not swing through 0');
check(near(lerpAngle(0.25, 0.75, 0.5), 0.5), 'lerpAngle halfway');

// --- pose interpolation ---
{
  const out = interpolatePose(pose(0, 0, 0, 3), pose(10, 4, -20, -3), 0.25, newPose());
  check(near(out.px, 2.5) && near(out.py, 1) && near(out.pz, -5), 'position lerp at 1/4');
  check(near(out.ry, 3 + (2 * Math.PI - 6) * 0.25), 'yaw lerp the short way');
  const a = interpolatePose(pose(1, 2, 3), pose(5, 6, 7), 0, newPose());
  const b = interpolatePose(pose(1, 2, 3), pose(5, 6, 7), 1, newPose());
  check(a.px === 1 && a.pz === 3 && b.px === 5 && b.pz === 7, 't = 0 is prev, t = 1 is current');
}

// --- observe: tick spans and snaps ---
{
  const t = newTrack();
  observe(t, pose(0, 0, 0), 0, true, 0);
  check(t.prev.px === 0 && t.cur.px === 0, 'first sight snaps');
  observe(t, pose(5, 0, 0), 1, true, 0);
  check(t.prev.px === 0 && t.cur.px === 5, 'a tick: prev -> current');
  observe(t, pose(5, 0, 0), 1, true, 0);
  check(t.prev.px === 0 && t.cur.px === 5, 'no tick, no move: the span stays (alpha moves on)');
  observe(t, pose(9, 0, 0), 1, true, 0);
  check(t.prev.px === 9 && t.cur.px === 9, 'moved without a tick (warp / 6x24): snap');
  observe(t, pose(12, 0, 0), 2, true, 0);
  check(t.prev.px === 9 && t.cur.px === 12, 'next tick slides again');
  observe(t, pose(12 + SNAP_DISTANCE + 1, 0, 0), 3, true, 0);
  check(t.prev.px === t.cur.px, 'a one-tick move longer than SNAP_DISTANCE snaps');
  observe(t, pose(t.cur.px + 3, 0, 0), 4, true, 1);
  check(t.prev.px === t.cur.px, 'a new warp serial (De Rol Le corner, Pan Arms burrow) snaps');
  observe(t, pose(0, 0, 0), 5, false, 1);
  observe(t, pose(4, 0, 0), 6, true, 1);
  check(t.prev.px === 4 && t.cur.px === 4, 'shown again after hiding: snap (spawn)');
  t.snap = true;
  observe(t, pose(6, 0, 0), 7, true, 1);
  check(t.prev.px === 6, 'an explicit snap');
  observe(t, pose(6, 0, 0, 1), 8, true, 1);
  check(t.prev.ry === 0 && t.cur.ry === 1, 'turning in place interpolates');
}

// --- ?fps=30 ---
check(smoothingFromSearch('') === true, 'smoothing on by default');
check(smoothingFromSearch('?fps=30') === false, '?fps=30 turns it off');
check(smoothingFromSearch('?touch=1&fps=30&sound=0') === false, '?fps=30 among other options');
check(smoothingFromSearch('?fps=60') === true, 'other values keep it on');

// --- TickClock ---
{
  const c = new TickClock();
  c.advance(2, 0.4);
  c.advance(0, 0.9);
  check(c.count === 2 && near(c.alpha, 0.9), 'clock counts ticks and keeps the remainder');
}

// --- TickSmoother on three.js objects ---
{
  const parent = new THREE.Group();
  const o = new THREE.Group();
  o.add(new THREE.Object3D()); // a visible child, like a model
  parent.add(o);
  const clock = new TickClock();
  const s = new TickSmoother(true);
  const drawnX = () => new THREE.Vector3().setFromMatrixPosition(o.matrix).x;

  o.position.set(0, 0, 0);
  s.track(o, clock);
  s.restore();
  // One tick moves it 10 along x and turns it across PI.
  o.rotation.y = 3;
  s.track(o, clock); // a move without a tick: snaps
  s.restore();
  o.position.x = 10;
  o.rotation.y = -3;
  clock.advance(1, 0.5);
  s.track(o, clock);
  check(!o.matrixAutoUpdate && near(drawnX(), 5, 1e-6), 'drawn halfway at alpha 0.5');
  check(o.position.x === 10 && o.rotation.y === -3, 'the logic pose is untouched while drawn');
  const fwd = new THREE.Vector3(0, 0, 1).transformDirection(o.matrix);
  check(near(fwd.z, -1, 1e-6), 'drawn yaw at PI (the short way across PI), not 0');
  const at = s.drawnPosition(o, new THREE.Vector3());
  check(near(at.x, 5, 1e-6), 'drawnPosition reports the drawn point');
  s.restore();
  check(o.matrixAutoUpdate && near(drawnX(), 10, 1e-9), 'restore: logic matrix back');
  check(near(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).x, 10, 1e-9), 'restore: world matrix rebuilt for the logic');
  // A teleport within a tick that the logic reports: snap().
  o.position.x = 50;
  clock.advance(1, 0.2);
  s.snap(o);
  s.track(o, clock);
  check(o.matrixAutoUpdate, 'snap: drawn where the logic is (no override)');
  s.restore();
  // Disabled (?fps=30): never overrides.
  const off = new TickSmoother(false);
  o.position.x = 60;
  clock.advance(1, 0.5);
  off.track(o, clock);
  o.position.x = 70;
  clock.advance(1, 0.5);
  off.track(o, clock);
  check(o.matrixAutoUpdate, '?fps=30: the tick pose is drawn');
  off.restore();
}

// --- PlayerCamera: drawn between its last two ticks ---
{
  const cam = new PlayerCamera();
  const pos = { x: 0, y: 0, z: 0 };
  cam.tick(pos, 0);
  const first = cam.view(pos, 0, 0.5);
  check(first.source === cam.source, 'camera: the first tick snaps');
  const s0 = { ...cam.source! };
  pos.x = 5;
  cam.tick(pos, 0);
  cam.tick({ x: 10, y: 0, z: 0 }, 0);
  const s1 = { ...cam.source! };
  const mid = cam.view(pos, 0, 0.5);
  check(mid.source !== cam.source, 'camera: interpolated below alpha 1');
  check(cam.view(pos, 0).source === cam.source, 'camera: alpha 1 (default, ?fps=30) is the tick point');
  check(s0.x !== s1.x, 'camera moved');
  cam.snap();
  cam.tick(pos, 0);
  check(cam.view(pos, 0, 0.3).source === cam.source, 'camera: snap() snaps the drawn view too');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('smoothrender: all checks passed');
