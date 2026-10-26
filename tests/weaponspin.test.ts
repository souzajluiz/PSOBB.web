// The Mechgun's barrel spin (client/src/render/weaponspin.ts; PsoBB.exe 0x005f473c ctor,
// 0x005f4620 do_mechguns_attack, 0x005f4688 slot 0xf4, 0x005e6364 the walk callback). Checks the
// angle math: which items spin and at which walk node, the 0x2000 per burst with the 16-bit wrap,
// BAMS to radians, and that the spun pose is the rest pose times a rotation about the node's own
// Y axis (its input side, so the node's origin stays put).
// The remote player's burst gate (6x46 -> do_attack, PsoBB.exe 0x006996c9) is checked in section 8.
// Run: node tests/weaponspin.test.ts
import * as THREE from '../client/node_modules/three/build/three.module.js';
import { addBurstSpin, applyWeaponSpin, burstSpinsOnReceipt, MECHGUN_BURST_SPIN, NO_SPIN_NODE, restPoses, spinMatrix, spinNodeOf, spinRadians, spunPose } from '../client/src/render/weaponspin.ts';

let failures = 0;
let checks = 0;
const check = (ok: boolean, what: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const pt = (v: THREE.Vector3) => `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

// 1. The spin node (ctor): 2 for group_2 8 with group_idx 5 or 7, else -1.
check(spinNodeOf(8, 5) === 2, 'group 8 idx 5 spins at walk node 2');
check(spinNodeOf(8, 7) === 2, 'group 8 idx 7 spins at walk node 2');
check(spinNodeOf(8, 0) === NO_SPIN_NODE, 'group 8 idx 0 does not spin');
check(spinNodeOf(8, 6) === NO_SPIN_NODE, 'group 8 idx 6 keeps -1 (the ctor only compares 5 and 7)');
check(spinNodeOf(8, 8) === NO_SPIN_NODE, 'group 8 idx 8 does not spin');
check(spinNodeOf(7, 5) === NO_SPIN_NODE, 'another group with idx 5 does not spin');
check(spinNodeOf(0, 5) === NO_SPIN_NODE, 'group 0 idx 5 does not spin');
check(NO_SPIN_NODE === -1, 'the no-spin node is -1 (the ctor value)');

// 2. Per burst: +0x2000, 16-bit wrap (AddAndWrapUInt16).
check(MECHGUN_BURST_SPIN === 0x2000, 'a burst adds 0x2000');
check(addBurstSpin(0) === 0x2000, 'first burst: 0x2000');
check(addBurstSpin(0x2000) === 0x4000, 'second burst: 0x4000');
check(addBurstSpin(0x6000) === 0x8000, 'fourth burst: 0x8000 (half a turn)');
check(addBurstSpin(0xe000) === 0x0000, 'eighth burst wraps to 0');
check(addBurstSpin(0xf000) === 0x1000, 'the wrap keeps 16 bits');
check(addBurstSpin(0, 3) === 0x6000, 'three bursts at once: 0x6000');
check(addBurstSpin(0xf000, 2) === 0x3000, 'several bursts wrap too');

// 3. BAMS to radians (0x10000 is a full turn).
check(near(spinRadians(0), 0), 'angle 0 is 0 rad');
check(near(spinRadians(0x4000), Math.PI / 2), '0x4000 is a quarter turn');
check(near(spinRadians(0x2000), Math.PI / 4), '0x2000 (one burst) is 45 degrees');
check(near(spinRadians(0x8000), Math.PI), '0x8000 is half a turn');
check(near(spinRadians(0x10000), 0), 'a full turn is 0 rad (the mask)');
check(near(spinRadians(0x12000), Math.PI / 4), 'values past 16 bits are masked');

// 4. The rotation: Ry(theta) in column-vector form (three's makeRotationY).
const q = spinMatrix(0x4000); // 90 degrees
const p = new THREE.Vector3(0, 0, 1).applyMatrix4(q);
check(near(p.x, 1) && near(p.y, 0) && near(p.z, 0), `Ry(90) maps local +Z to +X, got ${pt(p)}`);
const r = new THREE.Vector3(1, 0, 0).applyMatrix4(spinMatrix(0x4000));
check(near(r.x, 0) && near(r.z, -1), `Ry(90) maps local +X to -Z, got ${pt(r)}`);
const up = new THREE.Vector3(0, 1, 0).applyMatrix4(spinMatrix(0x7000));
check(near(up.y, 1), 'the spin keeps the Y axis (the barrel axis is not the one turned)');

// 5. The spun pose: rest * Ry, so the node's frame turns about its own origin. With a rest pose that
// translates and scales, a point of the node's frame goes through the rotation first.
const rest = new THREE.Matrix4().compose(new THREE.Vector3(3, -1, 2), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
const spun = spunPose(rest, 0x4000);
const local = new THREE.Vector3(0, 0, 1);
const expect = new THREE.Vector3(0, 0, 1).applyMatrix4(spinMatrix(0x4000)).applyMatrix4(rest);
const got = local.clone().applyMatrix4(spun);
check(got.distanceTo(expect) < 1e-6, `spun pose: local point goes through Ry first, got ${pt(got)} want ${pt(expect)}`);
check(near(got.x, 4) && near(got.y, -1) && near(got.z, 2), `the node origin stays at its rest translation, got ${pt(got)}`);
const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(spun);
check(origin.distanceTo(new THREE.Vector3(3, -1, 2)) < 1e-6, `the node origin is unchanged by the spin, got ${pt(origin)}`);
check(spunPose(rest, 0).elements.every((v, i) => near(v, rest.elements[i])), 'a zero spin gives the rest pose');

// 6. The bones: the spun node turns with its children (they are its bones), and the rest of the walk
// keeps the rest poses. Bones are plain Object3Ds here (the walk's bones are THREE.Bone).
const root = new THREE.Bone();
const spunBone = new THREE.Bone();
const child = new THREE.Bone();
const other = new THREE.Bone();
root.add(spunBone);
spunBone.add(child);
root.add(other);
spunBone.position.set(1, 0, 0);
child.position.set(0, 0, 2);
other.position.set(0, 5, 0);
const bones = [root, spunBone, child, other];
const rests = restPoses(bones);
applyWeaponSpin(bones, rests, 1, 0x4000);
root.updateMatrixWorld(true);
const childWorld = new THREE.Vector3(0, 0, 0).applyMatrix4(child.matrixWorld);
// The child sits at (0,0,2) in the spun node's frame: Ry(90) of (0,0,2) is (2,0,0), plus the node at (1,0,0).
check(childWorld.distanceTo(new THREE.Vector3(3, 0, 0)) < 1e-6, `the child turns with the spun node, got ${pt(childWorld)}`);
const otherWorld = new THREE.Vector3(0, 0, 0).applyMatrix4(other.matrixWorld);
check(otherWorld.distanceTo(new THREE.Vector3(0, 5, 0)) < 1e-6, `a node outside the spin keeps its rest pose, got ${pt(otherWorld)}`);
// Back to zero: the rest pose again.
applyWeaponSpin(bones, rests, 1, 0);
root.updateMatrixWorld(true);
const backWorld = new THREE.Vector3(0, 0, 0).applyMatrix4(child.matrixWorld);
check(backWorld.distanceTo(new THREE.Vector3(1, 0, 2)) < 1e-6, `spin 0 restores the rest pose, got ${pt(backWorld)}`);
// A node index outside the bones leaves every bone at rest.
applyWeaponSpin(bones, rests, NO_SPIN_NODE, 0x4000);
root.updateMatrixWorld(true);
const noneWorld = new THREE.Vector3(0, 0, 0).applyMatrix4(child.matrixWorld);
check(noneWorld.distanceTo(new THREE.Vector3(1, 0, 2)) < 1e-6, 'no spin node: every bone at rest');

// 7. Three bursts: 0x6000 (135 degrees), the spin's start over at the next weapon.
let spin = 0;
for (let i = 0; i < 3; i++) spin = addBurstSpin(spin);
check(spin === 0x6000, 'three bursts give 0x6000');
check(near(spinRadians(spin), (3 * Math.PI) / 4), 'three bursts are 135 degrees');

// 8. A received 6x46 turns the sender's barrel (action_attack_step_finish -> do_attack): another
// player's burst, in an unsafe map, with or without targets. Not the local player's echo; not a hub.
check(burstSpinsOnReceipt(3, 0, true), 'a remote burst in an unsafe map spins');
check(burstSpinsOnReceipt(0, 0, true) === false, 'the local player is not spun by its own 6x46 echo');
check(burstSpinsOnReceipt(3, 0, false) === false, 'a remote burst in a hub does not spin (is_player_in_unsafe_map)');
check(burstSpinsOnReceipt(1, 0, true), 'any other remote client id spins too');

// 9. The sincos outputs (2026-10-25, "Guns left"): the helper 0x0082d8bc gives A = cos (the stack
// pointer's output of the callee 0x008451f8) and B = sin (the first, edx). Its row mix is
// row1' = cos row1 - sin row3, row3' = sin row1 + cos row3 (a symbolic replay of 0x0082d8d9..0x0082d97a).
// That 3x3 G (rows 1 and 3, the head's row-vector form) is the transpose of the port's column-form
// Ry(theta), so the spin's input-side rotation is spinMatrix(spin): m13 = sin, m31 = -sin, m11 = m33 = cos.
const exeMix = (cos: number, sin: number, row1: number[], row3: number[]): [number[], number[]] => [
  row1.map((v, j) => cos * v - sin * row3[j]),
  row1.map((v, j) => sin * v + cos * row3[j]),
];
for (const spin of [0, 0x2000, 0x4000, 0x6000, 0xa000, 0xffff]) {
  const th = spinRadians(spin);
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const m = spinMatrix(spin).elements; // column-major: m[4 * col + row]
  // The 3x3 block of the column-major elements (m[4 * col + row]), read row by row.
  const block = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const exeG = [cos, 0, sin, 0, 1, 0, -sin, 0, cos]; // G^T, row-major: G = [[c,0,-s],[0,1,0],[s,0,c]]
  check(block.every((v, i) => near(v, exeG[i])), `spin ${spin.toString(16)}: spinMatrix is the transpose of the exe row mix (G^T)`);
  // The mix applied to a row pair equals the port's column form on the same basis vectors.
  const r1 = [1, 0, 0, 0];
  const r3 = [0, 0, 1, 0];
  const [n1, n3] = exeMix(cos, sin, r1, r3);
  check(near(n1[0], cos) && near(n1[2], -sin) && near(n3[0], sin) && near(n3[2], cos), `spin ${spin.toString(16)}: the exe mix of the identity rows is cos / -sin / sin / cos`);
}
// A quarter turn (0x4000): the sine is 1, so the spun X axis (input) goes to -Z ... checked through the matrix.
{
  const m = spinMatrix(0x4000).elements;
  check(near(m[0], 0) && near(m[8], 1) && near(m[2], -1) && near(m[10], 0), 'quarter turn 0x4000: the port turns the input X axis to (0, 0, -1) (column form, sin on m13)');
}

console.log(`${checks - failures} of ${checks} checks passed${failures ? `, ${failures} failed` : ''}`);
if (failures) process.exitCode = 1;
