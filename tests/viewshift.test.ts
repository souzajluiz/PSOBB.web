// The main menu's view shift on the 3D camera (client/src/render/viewshift.ts,
// PsoBB.exe render_player_menu_background, dump 700858). The exe's centre at
// frame 3 is (320 + 80, 240 - 115.2) in 640 x 480 pixels with scale 0.75, so a
// point on the optical axis lands at NDC (0.25, 0.48): right and up (the y is
// screen-down in the exe; `-(115.2 * scale / 3) * frame + 240`).
// Run: node tests/viewshift.test.ts
// three is the client's (tests/ has no node_modules); the same file the helper imports.
import * as THREE from '../client/node_modules/three/build/three.module.js';
import { applyMenuViewShift } from '../client/src/render/viewshift.ts';

let failures = 0;
const near = (a: number, b: number, what: string, tol = 1e-6) => {
  if (!(Math.abs(a - b) <= tol)) {
    failures++;
    console.log(`FAIL ${what}: ${a} != ${b}`);
  }
};

// The exe's frame size is 640 x 480; the aspect is the same here.
const cam = new THREE.PerspectiveCamera(60, 640 / 480, 1, 20000);
cam.position.set(0, 0, 0);
cam.updateMatrixWorld(true);
const ndcOf = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).project(cam);

// Frame 0 is the plain projection: the optical axis projects to the centre.
applyMenuViewShift(cam, 0);
let p = ndcOf(0, 0, -100);
near(p.x, 0, 'frame 0: axis x at the centre');
near(p.y, 0, 'frame 0: axis y at the centre');

// Frame 3: the axis point moves to the exe's centre (ox 0.25, oy 0.48).
applyMenuViewShift(cam, 3);
p = ndcOf(0, 0, -100);
near(p.x, 0.25, 'frame 3: centre x (exe 320 + 80 of 640 => NDC +0.25)');
near(p.y, 0.48, 'frame 3: centre y (exe 240 - 115.2 of 480 => NDC +0.48, up)');

// The scale 0.75 with the offset: the frustum's left edge (NDC -1) goes to -0.5,
// its right edge (NDC +1) to +1.0, with the same vertical shift at the centre row.
const halfW = Math.tan(THREE.MathUtils.degToRad(30)) * (640 / 480) * 100;
const left = ndcOf(-halfW, 0, -100);
const right = ndcOf(halfW, 0, -100);
near(left.x, -0.5, 'frame 3: left edge NDC (0.75 * -1 + 0.25)', 1e-4);
near(right.x, 1.0, 'frame 3: right edge NDC (0.75 * 1 + 0.25)', 1e-4);

// The shift is rebuilt from the plain projection each call (no drift when the
// same frame is applied again, or when the menu closes back to frame 0).
applyMenuViewShift(cam, 3);
near(ndcOf(0, 0, -100).x, 0.25, 'frame 3 again: no compounding');
applyMenuViewShift(cam, 0);
near(ndcOf(0, 0, -100).x, 0, 'closed (frame 0) again: back to the plain projection');
near(ndcOf(0, 0, -100).y, 0, 'closed (frame 0) again: y back');

// The inverse is kept in step with the projection.
applyMenuViewShift(cam, 2);
const m = cam.projectionMatrix.clone().multiply(cam.projectionMatrixInverse);
for (let i = 0; i < 16; i++) near(m.elements[i], i % 5 === 0 ? 1 : 0, `projection * inverse [${i}]`, 1e-5);

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('viewshift: all checks passed');
