// The Mechgun's barrel spin on the held weapon (PsoBB.exe 0x005f473c / 0x005f4620 / 0x005f4688 /
// 0x005e6364; DEVLOG 2026-10-25 "Mechgun barrel spin"):
//
//   - The ctor (0x005f473c) sets the item's +0x258 (the spin node) to -1, or to 2 when byte[1]
//     (group_2) is 8 and byte[2] (group_idx) is 5 or 7 (proven: objdump 0x005f4773, 0x005f47b3,
//     0x005f47bf). It sets +0x25c (the spin angle, BAMS) to 0.
//   - do_mechguns_attack (0x005f4620) adds 0x2000 to +0x25c per burst, with the 16-bit wrap of
//     AddAndWrapUInt16 (0x005dd6d0). 0x2000 is 45 degrees.
//   - The spin is applied by the weapon's walk, not by the Mechgun itself. unk_apply_weapon_model
//     _transforms_from_nj (dump 411822) calls the item's per-node callback (item +0xe0,
//     UpdateTargetSwitchWeaponVisuals_005e6364 during UpdateItemPosition) for every node it visits,
//     in walk order, before the node's children and mesh. That callback reads the BSS counter
//     0xa8d84c, which is g_RenderMode (the dump's `g_RenderMode = 0` in UpdateItemPosition and the
//     `g_RenderMode = g_RenderMode + 1` at the end of the callback; the xref sites match), and calls
//     slot 0xf4 (0x005f4688): when the item's +0x258 equals that counter, the helper 0x0082d8bc turns
//     the transform stack head by +0x25c. So the counter is the node's walk index (0 = the root).
//   - The helper mixes rows 1 and 3 of the head (D3DMATRIX _11.._14 and _31.._34) by the sine and
//     cosine of the angle: row1' = c row1 - s row3, row3' = s row1 + c row3. The head is row-vector
//     (D3D) with the translation in row 4 (_41..43), which the helper leaves alone. Rows are the
//     images of the local x and z, so the mix rotates the node's INPUT coordinates before its own
//     pose: a rotation about the node's own Y axis through its origin, with the children and the
//     mesh inside it. Its matrix in column-vector form is Ry(theta) with theta the spin angle.
//
// ASSUMED: the sine is the helper's first output and the cosine the second (the lookup table
// 0x00989560 did not decode to a plain sine table here, so the sign of the angle is not checked);
// the spin angle is BAMS (0x10000 = a full turn) and positive is right-handed about +Y. The visual
// is not checked in a browser (no Playwright here).

import * as THREE from 'three';

// BAMS: 0x10000 is a full turn.
export const BAMS_TURN = 0x10000;
// The spin per burst (do_mechguns_attack).
export const MECHGUN_BURST_SPIN = 0x2000;
// The spin node when the weapon does not spin (the item's +0x258 is -1).
export const NO_SPIN_NODE = -1;
// group_2 of the Mechgun (kind 8 in ItemPMT) and the group_idx values that spin (the ctor's compare).
const MECHGUN_GROUP = 8;
const SPINNING_GROUP_IDX: readonly number[] = [5, 7];

// The walk index whose transform the spin turns (the item's +0x258), or NO_SPIN_NODE.
export function spinNodeOf(group2: number, groupIdx: number): number {
  return group2 === MECHGUN_GROUP && SPINNING_GROUP_IDX.includes(groupIdx) ? 2 : NO_SPIN_NODE;
}

// The spin after `bursts` bursts (AddAndWrapUInt16: a 16-bit wrap).
export function addBurstSpin(spin: number, bursts = 1): number {
  return (spin + MECHGUN_BURST_SPIN * bursts) & (BAMS_TURN - 1);
}

// The spin in radians (BAMS to radians, the same scale as render/magmotion.ts BAMS_TURN).
export function spinRadians(spin: number): number {
  return ((spin & (BAMS_TURN - 1)) / BAMS_TURN) * Math.PI * 2;
}

// Ry(theta): a rotation about the node's own Y axis (the input side of its pose).
export function spinMatrix(spin: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(spinRadians(spin));
}

// The node's pose with the spin: rest * Ry(theta) (column-vector form), so a point p of the node's
// own frame goes to rest * Ry(theta) * p. `out` is written and returned.
export function spunPose(rest: THREE.Matrix4, spin: number, out: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  return out.copy(rest).multiply(spinMatrix(spin));
}

// Sets the held weapon's bones: the spun node gets its rest pose times Ry(theta); every other node
// keeps its rest pose. `bones` and `rest` are in the walk order (playermodel.ts weaponBones). The
// children of the spun node are bones of it, so they turn with it. A node index outside the
// bones leaves every bone at rest.
export function applyWeaponSpin(bones: readonly THREE.Bone[], rest: readonly THREE.Matrix4[], node: number, spin: number): void {
  bones.forEach((bone, i) => {
    const r = rest[i];
    if (!r) return;
    bone.matrixAutoUpdate = false;
    if (i === node && spin !== 0) spunPose(r, spin, bone.matrix);
    else bone.matrix.copy(r);
    bone.matrixWorldNeedsUpdate = true;
  });
}

// The rest poses of the bones (their matrices from position, quaternion and scale), taken once at
// build time, before applyWeaponSpin turns them.
export function restPoses(bones: readonly THREE.Bone[]): THREE.Matrix4[] {
  return bones.map((b) => {
    b.updateMatrix();
    return b.matrix.clone();
  });
}
