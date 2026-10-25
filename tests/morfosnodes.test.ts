// The Morfos' draw captures (client/src/render/morfosnodes.ts): the arm and the
// laser's muzzle take the node points of the last draw (the exe's
// unknown_morfos_render2 capture into enemy+0x4a0 / +0x4ac), not this tick's pose.
// Run: node tests/morfosnodes.test.ts
import * as THREE from '../client/node_modules/three/build/three.module.js';
import { armLocalFromCapture, drawnWorldOrigin } from '../client/src/render/morfosnodes.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const near = (a: number, b: number, what: string, eps = 1e-6) => check(Math.abs(a - b) <= eps, `${what}: ${a} != ${b}`);
const nearV = (v: THREE.Vector3, x: number, y: number, z: number, what: string) => {
  near(v.x, x, `${what} x`);
  near(v.y, y, `${what} y`);
  near(v.z, z, `${what} z`);
};

// A root (the enemy) with one node below it, drawn once: the render refreshes
// the matrices (scene.updateMatrixWorld), then the state moves on without a draw.
const rig = () => {
  const root = new THREE.Group();
  const node = new THREE.Object3D();
  root.add(node);
  root.position.set(0, 0, 0);
  node.position.set(5, 0, 0);
  root.updateMatrixWorld(true); // the last draw
  return { root, node };
};

// 1. The drawn origin is the last draw's, not the current pose.
{
  const { root, node } = rig();
  node.position.set(9, 0, 0); // the tick moved the body after the draw
  root.position.set(3, 0, 0);
  const v = drawnWorldOrigin(node, new THREE.Vector3());
  nearV(v, 5, 0, 0, 'drawn origin is the last draw');
  void root;
}

// 2. Reading the capture never refreshes it: a second read is the same.
{
  const { node } = rig();
  node.position.set(9, 0, 0);
  const a = drawnWorldOrigin(node, new THREE.Vector3());
  const b = drawnWorldOrigin(node, new THREE.Vector3());
  nearV(a, 5, 0, 0, 'first read');
  nearV(b, 5, 0, 0, 'second read');
}

// 3. The arm's place is the captured world point in the root's current local space.
//    Captured at (5,0,0) with the root at the origin; the root has since moved to
//    (3,0,0): the local point is (2,0,0), not the current node (9-3 = 6) and not 4.
{
  const { root, node } = rig();
  node.position.set(9, 0, 0);
  root.position.set(3, 0, 0);
  const captured = drawnWorldOrigin(node, new THREE.Vector3());
  const out = armLocalFromCapture(root, captured, new THREE.Vector3());
  nearV(out, 2, 0, 0, 'arm local under the moved root');
  nearV(captured, 5, 0, 0, 'captured point is not changed by the placement');
}

// 4. A rotated root turns the captured point with it: the arm stays at the
//    captured world point (world = root * local).
{
  const root = new THREE.Group();
  const node = new THREE.Object3D();
  root.add(node);
  node.position.set(0, 0, 4);
  root.updateMatrixWorld(true); // the draw: world (0,0,4)
  root.rotation.y = Math.PI / 2; // the tick turns the enemy, not drawn yet
  const captured = drawnWorldOrigin(node, new THREE.Vector3());
  nearV(captured, 0, 0, 4, 'captured under the draw');
  const local = armLocalFromCapture(root, captured, new THREE.Vector3());
  const back = local.clone().applyMatrix4(root.matrixWorld);
  nearV(back, 0, 0, 4, 'the arm stays on the captured world point');
}

// 5. A node that was never drawn sits at the identity origin.
{
  const node = new THREE.Object3D();
  node.position.set(7, 1, 2);
  nearV(drawnWorldOrigin(node, new THREE.Vector3()), 0, 0, 0, 'never drawn is the identity origin');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('morfosnodes: all checks passed');
