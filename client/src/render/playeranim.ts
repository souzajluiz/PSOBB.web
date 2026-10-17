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
import { sampleKeys, type NjMotion } from '../formats/njmotion.ts';
import { EVAL_ZXY_ANG } from '../formats/xj.ts';
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

export class PlayerAnimator {
  private bones: BoneState[];
  private motions: MotionSource;
  private record: MotionRecord | null = null;
  private motion: NjMotion | null = null;
  private recordForSlot: ((slot: number) => MotionRecord) | null = null;
  frame = 0;
  step = 0;
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

  // Advances by `dt` seconds (whole game ticks; the remainder carries over).
  update(dt: number): void {
    if (!this.motion || !this.record) return;
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
    for (let i = 0; i < this.bones.length && i < m.nodes.length; i++) {
      const b = this.bones[i];
      const n = m.nodes[i];
      if (n.position) b.bone.position.fromArray(sampleKeys(n.position, frame, m.frameCount, v));
      else b.bone.position.copy(b.bindPos);
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
