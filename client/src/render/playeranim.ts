// Plays player motions (formats/plymotion.ts) on a skinned player model
// (render/playermodel.ts) by writing the body bones directly, the way the
// game's motion player does (FUN_007aa094 and friends, see plymotion.ts):
//   - time runs in game ticks (30 per second); each tick frame += step;
//   - mode 1 loops at frame_count, 2 chains to `next`, 3 holds the end;
//   - switching motion cross-fades from the current pose over 5 ticks and
//     restarts the new motion at frame 0.
// Bone i is depth-first node i of pl?bdy00.nj, which is also the node order
// of the motion data. Nodes without keys keep their bind values; the Euler
// order follows the node's ZXY flag like the bind pose in njcmmesh.ts.

import * as THREE from 'three';
import type { NjcmObject } from '../formats/njcm.ts';
import { hasRootZOff, markRootZOff, sampleKeys, type NjMotion } from '../formats/njmotion.ts';
import { EVAL_BREAK, EVAL_ZXY_ANG } from '../formats/xj.ts';
import type { MotionRecord } from '../formats/plymotion.ts';

// Where motions come from: plymotiondata.rlc (PlayerMotions) or the
// character screens' charamakingmot.bml (classic/playerview.ts).
export interface MotionSource {
  get(index: number): NjMotion;
}

export const GAME_TICKS_PER_SECOND = 30;
const BLEND_STEP = 0.2; // DAT_0097d970
const FLAG_NO_BLEND_IN = 0x80000000;
const FLAG_NO_BLEND_OUT = 0x40000000;
// Record flag 0x20000000 (the walk and run rows of the field tables, and the
// town walk / run): the motion's position channel drops its Z (root) keys.
// PsoBB.exe: FUN_007aa4c8 (start) and FUN_007a9a6c (change) call FUN_007a98fc
// when the record has the bit, which ORs 0x80 into the NJS_MOTION's inp_fn
// (+0xa) of the motion now playing: `*(u16*)(motion + 0xa) |= 0x80`. The NJM
// evaluator (NJM_MotionUpdate 0x00830364 / NJM_InitializeAnimationContext
// 0x008303dc) takes the position interpolator from table 0x00a2271c by
// (inp_fn & 0xc0) >> 6, and index 2 is FUN_00842d7c: X and Y are interpolated
// from the keys, Z is set to 0.0 (`param_4[2] = 0.0`). The flag is never
// cleared, so every later use of that NJS_MOTION object (the motion objects
// are shared per archive entry) keeps Z = 0. Verified: the field walk / run
// motions (e.g. 104, 111, 350) key node 0's Z from 0 to ~25 (the forward root
// travel), and this rule drops it; the model's bob (Y) and sway (X) stay.
export const FLAG_ROOT_Z_OFF = 0x20000000;

interface BoneState {
  bone: THREE.Bone;
  order: THREE.EulerOrder;
  bindPos: THREE.Vector3;
  bindQuat: THREE.Quaternion;
}

export function depthFirstNodes(root: NjcmObject): NjcmObject[] {
  const out: NjcmObject[] = [];
  const walk = (n: NjcmObject) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

// The order the exe's node walk visits a model in (UpdateWeaponModelTransformations_005c3568,
// unk_apply_weapon_model_transforms_from_nj): pre-order, and a node with EVAL_BREAK takes no
// children. Returns the depth-first index (as depthFirstNodes) of each visited node, in the
// walk's order: entry k is the node whose matrix the exe writes to unk_matrix_array + k.
export function exeWalkIndices(root: NjcmObject): number[] {
  const out: number[] = [];
  let full = 0;
  const walk = (n: NjcmObject, visited: boolean) => {
    const self = full++;
    if (visited) out.push(self);
    for (const c of n.children) walk(c, visited && !(n.flags & EVAL_BREAK));
  };
  walk(root, true);
  return out;
}

export class PlayerAnimator {
  private bones: BoneState[];
  private motions: MotionSource;
  private record: MotionRecord | null = null;
  private motion: NjMotion | null = null;
  private recordForSlot: ((slot: number) => MotionRecord) | null = null;
  frame = 0;
  step = 0;
  // Set while the motion must not advance (the charge phase of a heavy or
  // special attack, FUN_00698fa8 phase 1/2 in render/combat.ts).
  paused = false;
  // Cross-fade: pose captured when the motion changed, and progress 0..1.
  private blendFrom: { pos: THREE.Vector3; quat: THREE.Quaternion }[] | null = null;
  private blend = 1;
  private tickRemainder = 0;
  private tmp: [number, number, number] = [0, 0, 0];
  private euler = new THREE.Euler();
  private q = new THREE.Quaternion();

  // bodyBones: the body part's bones (NjcmModel.partBones[0]); bodyRoot: the
  // pl?bdy00.nj object they were built from.
  constructor(bodyBones: THREE.Bone[], bodyRoot: NjcmObject, motions: MotionSource) {
    const nodes = depthFirstNodes(bodyRoot);
    this.bones = bodyBones.map((bone, i) => ({
      bone,
      order: nodes[i] && nodes[i].flags & EVAL_ZXY_ANG ? 'YXZ' : 'ZYX',
      bindPos: bone.position.clone(),
      bindQuat: bone.quaternion.clone(),
    }));
    this.motions = motions;
  }

  get current(): MotionRecord | null {
    return this.record;
  }

  // The motion reached its last frame (modes 2 and 3 hold it there).
  get ended(): boolean {
    return !!this.motion && this.record?.mode !== 1 && this.frame >= this.motion.frameCount - 1;
  }

  // Starts `record` (a town/field motion table entry). `stepFactor` scales the
  // record speed (1.5 for the run state). `slots` resolves `next` for mode 2.
  play(record: MotionRecord, stepFactor = 1, slots?: (slot: number) => MotionRecord): void {
    const step = record.speed * stepFactor;
    if (this.record && this.record.index === record.index && this.record.mode === record.mode) {
      this.step = step;
      return;
    }
    const prev = this.record;
    this.motion = this.motions.get(record.index);
    if (record.flags & FLAG_ROOT_Z_OFF) markRootZOff(this.motion);
    this.recordForSlot = slots ?? this.recordForSlot;
    const fade = prev !== null && !(record.flags & FLAG_NO_BLEND_IN) && !(prev.flags & FLAG_NO_BLEND_OUT);
    if (fade) {
      this.blendFrom = this.bones.map((b) => ({ pos: b.bone.position.clone(), quat: b.bone.quaternion.clone() }));
      this.blend = 0;
    } else {
      this.blendFrom = null;
      this.blend = 1;
    }
    this.record = record;
    this.step = step;
    this.frame = 0;
    this.apply();
  }

  // Sets the step factor of the motion playing now (the walk / run tie to the
  // leg speed, render/playermove.ts legSpeed): the record speed * stepFactor.
  setRate(stepFactor: number): void {
    if (this.record) this.step = this.record.speed * stepFactor;
  }

  // Advances by `dt` seconds (whole game ticks; the remainder carries over).
  update(dt: number): void {
    if (!this.motion || !this.record || this.paused) return;
    this.tickRemainder += dt * GAME_TICKS_PER_SECOND;
    let ticks = Math.floor(this.tickRemainder);
    this.tickRemainder -= ticks;
    ticks = Math.min(ticks, 30); // a stalled tab should not spin through many loops
    for (let i = 0; i < ticks; i++) this.tick();
    this.apply(this.tickRemainder);
  }

  private tick(): void {
    const m = this.motion!;
    const r = this.record!;
    if (this.blend < 1) {
      // During the fade the new motion stays on frame 0.
      this.blend = Math.min(1, this.blend + BLEND_STEP);
      if (this.blend >= 1) this.blendFrom = null;
      return;
    }
    this.frame += this.step;
    const end = m.frameCount - 1;
    if (r.mode === 1) {
      if (this.frame >= m.frameCount) this.frame -= m.frameCount;
    } else if (r.mode === 2) {
      if (this.frame >= end) {
        const next = r.next >= 0 && this.recordForSlot ? this.recordForSlot(r.next) : null;
        if (next) this.play(next, 1);
        else this.frame -= m.frameCount;
      }
    } else if (this.frame >= end) {
      this.frame = end;
    }
  }

  // Writes the pose; `sub` (0..1) is the fraction of the next tick for smooth
  // rendering above 30 fps.
  private apply(sub = 0): void {
    const m = this.motion;
    if (!m) return;
    let frame = this.frame;
    let blend = this.blend;
    if (blend < 1) blend = Math.min(1, blend + BLEND_STEP * sub);
    else if (this.record?.mode === 1) frame = (frame + this.step * sub) % m.frameCount;
    else frame = Math.min(frame + this.step * sub, m.frameCount - 1);
    const v = this.tmp;
    const zOff = hasRootZOff(m);
    for (let i = 0; i < this.bones.length && i < m.nodes.length; i++) {
      const b = this.bones[i];
      const n = m.nodes[i];
      if (n.position) {
        sampleKeys(n.position, frame, m.frameCount, v);
        if (zOff) v[2] = 0; // FUN_00842d7c: the position's Z is 0.0 (see FLAG_ROOT_Z_OFF)
        b.bone.position.fromArray(v);
      } else b.bone.position.copy(b.bindPos);
      if (n.rotation) {
        sampleKeys(n.rotation, frame, m.frameCount, v, m.shortAngles);
        b.bone.quaternion.setFromEuler(this.euler.set(v[0], v[1], v[2], b.order));
      } else {
        b.bone.quaternion.copy(b.bindQuat);
      }
      const from = this.blendFrom?.[i];
      if (from && blend < 1) {
        b.bone.position.lerpVectors(from.pos, b.bone.position, blend);
        b.bone.quaternion.slerpQuaternions(from.quat, this.q.copy(b.bone.quaternion), blend);
      }
    }
  }
}

const boneTmp = new THREE.Vector3();

// The world point of body node `node` (the bone of the same depth-first index, the exe's
// unk_matrix_array + node) into `out`; false when the skeleton has no such node. The chain's
// world matrices are refreshed first, so the point is the current pose (no allocation).
export function skeletonNodePosition(bones: readonly THREE.Object3D[] | null | undefined, node: number, out: { x: number; y: number; z: number }): boolean {
  const bone = bones?.[node];
  if (!bone) return false;
  bone.updateWorldMatrix(true, false);
  bone.getWorldPosition(boneTmp);
  out.x = boneTmp.x;
  out.y = boneTmp.y;
  out.z = boneTmp.z;
  return true;
}
