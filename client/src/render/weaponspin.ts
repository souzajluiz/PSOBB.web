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
// Who spins it (proven, objdump of PsoBB.exe): a burst is one do_attack, and a remote player's
// burst reaches this client as its 6x46 (action_attack_step_finish, exe 0x00699570..0x006996d0:
// GetPlayer(sender), IsPlayerRootObject, is_player_in_unsafe_map, then the sender's weapon
// vtable +0x70 at 0x006996c9 = PerformItemAttack 0x005e8908, which calls the +0xcc hook at
// 0x005e8a14 = do_mechguns_attack). The local player's bursts come from the local attack
// (gunShot). burstSpinsOnReceipt is that receiver's gate.
//
// The cosine and sine (PROVEN 2026-10-25, "Guns left"; objdump of PsoBB.exe, replay in the DEVLOG):
// the helper 0x0082d8bc calls the sincos callee 0x008451f8 with the angle in ecx, the address of B in
// edx (its first output, the sine) and the address of A on the stack (its second, the cosine). Its
// quadrant-0 path (0x008453b1) stores the sine table [0x0098b560 + 4i] (sin(i * 2pi / 4096), checked
// at i = 512: 0.70710677) through edx and the cosine table [0x0098c560 - 4i] (cos, 1.0 at i = 0)
// through the stack pointer; so A = cos and B = sin, the dump's int_angle_sincos(angle, &sin, &cos)
// order. A symbolic replay of the helper's x87 code (0x0082d8d9..0x0082d97a) gives, for all eight
// entries: _11' = cos _11 - sin _31, _12' = cos _12 - sin _32, _13' = cos _13 - sin _33,
// _14' = cos _14 - sin _34, _31' = sin _11 + cos _31, ..., _34' = sin _14 + cos _34, so row1' and
// row3' are the port's mix with c = cos, s = sin. The angle index is the BAMS value >> 4 (positive
// is the table's positive index), so the spin is +2pi * spin / 0x10000 about +Y, and the port's
// spinMatrix (three.js makeRotationY, column form) is the transpose of the helper's 3x3 row mix
// (checked by tests/weaponspin.test.ts section 9). Not checked: the visual (no Playwright here).

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

// Whether a received 6x46 from `sender` turns the sender's held weapon on this client (exe
// action_attack_step_finish): every 6x46 from another player does one do_attack, in a map where the
// player attacks (is_player_in_unsafe_map), whatever its target count. The local player's own
// 6x46 is not echoed to it, and its bursts are spun by gunShot.
export function burstSpinsOnReceipt(sender: number, selfId: number, unsafeMap: boolean): boolean {
  return sender !== selfId && unsafeMap;
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
