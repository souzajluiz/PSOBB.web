// Plays the NJS_MOTION of animated map entries (fans, doors, signs, ...).
//
// Per game tick the client adds the entry's frame step to its current frame and
// wraps at the motion's frame count (see the "Animated entries" notes in
// docs/PROTOCOL.md). Motion nodes follow the object tree in depth-first order.

import type * as THREE from 'three';
import { sampleKeys, type NjMotion } from '../formats/njmotion.ts';

export const MAP_TICKS_PER_SECOND = 30;

interface Track {
  nodes: THREE.Object3D[];
  motion: NjMotion;
  frame: number;
  step: number;
}

export class MapAnimator {
  private tracks: Track[] = [];
  private tmp: [number, number, number] = [0, 0, 0];

  add(nodes: THREE.Object3D[], motion: NjMotion, step: number): void {
    if (!motion.frameCount) return;
    this.tracks.push({ nodes, motion, frame: 0, step: step > 0 ? step : 1 });
  }

  get count(): number {
    return this.tracks.length;
  }

  clear(): void {
    this.tracks = [];
  }

  update(dt: number): void {
    const ticks = dt * MAP_TICKS_PER_SECOND;
    for (const t of this.tracks) {
      t.frame = (t.frame + t.step * ticks) % t.motion.frameCount;
      const n = Math.min(t.nodes.length, t.motion.nodes.length);
      for (let i = 0; i < n; i++) {
        const m = t.motion.nodes[i];
        const node = t.nodes[i];
        if (m.position?.length) node.position.fromArray(sampleKeys(m.position, t.frame, t.motion.frameCount, this.tmp));
        if (m.rotation?.length) {
          const r = sampleKeys(m.rotation, t.frame, t.motion.frameCount, this.tmp, true);
          node.rotation.set(r[0], r[1], r[2]);
        }
        if (m.scale?.length) node.scale.fromArray(sampleKeys(m.scale, t.frame, t.motion.frameCount, this.tmp));
      }
    }
  }
}
