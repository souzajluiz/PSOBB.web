// Plays a Ninja shape motion (formats/njshape.ts) on a chunk model built by
// NjcmModelBuilder: every vertex the motion replaces gets the interpolated
// key position of its node, placed by that node's bind-pose matrix (the
// skinned mesh's vertices are stored in the bind pose; its bones then move
// them with the node motion, as the exe draws the shaped vertices under the
// node's matrix).
//
// The exe draws the shape at the node motion's frame (njDrawShapeMotion:
// NJCM_SetMinimapRenderStates_008304e0(object, motion, shape, frame)), so the
// caller applies the same frame to both (NodeAnimator.onFrame).

import * as THREE from 'three';
import { sampleShapeKeys, type NjShapeMotion } from '../formats/njshape.ts';
import type { NjcmShapeSources } from './njcmmesh.ts';

export class ShapeAnimator {
  readonly shape: NjShapeMotion;
  private mesh: THREE.Mesh;
  private sources: NjcmShapeSources;
  private bind: THREE.Matrix4[];
  private normalBind: THREE.Matrix3[];
  // Interpolated key arrays per node (null: the node is not shaped).
  private positions: (Float32Array | null)[];
  private normals: (Float32Array | null)[];
  private lastFrame = NaN;
  private v = new THREE.Vector3();

  constructor(shape: NjShapeMotion, mesh: THREE.Mesh, sources: NjcmShapeSources, bind: THREE.Matrix4[]) {
    this.shape = shape;
    this.mesh = mesh;
    this.sources = sources;
    this.bind = bind;
    this.normalBind = bind.map((m) => new THREE.Matrix3().getNormalMatrix(m));
    this.positions = shape.nodes.map((n) => (n?.vertices ? new Float32Array(n.vertices[0].values.length) : null));
    this.normals = shape.nodes.map((n) => (n?.normals ? new Float32Array(n.normals[0].values.length) : null));
  }

  apply(frame: number): void {
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    this.shape.nodes.forEach((n, i) => {
      if (n?.vertices) sampleShapeKeys(n.vertices, frame, this.positions[i]!);
      if (n?.normals) sampleShapeKeys(n.normals, frame, this.normals[i]!);
    });
    const geom = this.mesh.geometry;
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const nrm = geom.getAttribute('normal') as THREE.BufferAttribute;
    const { node, position, normal } = this.sources;
    const v = this.v;
    let posChanged = false;
    let nrmChanged = false;
    for (let k = 0; k < node.length; k++) {
      const n = node[k];
      if (n < 0) continue;
      const p = this.positions[n];
      const j = position[k];
      if (p && j >= 0 && j * 3 + 2 < p.length) {
        v.set(p[j * 3], p[j * 3 + 1], p[j * 3 + 2]).applyMatrix4(this.bind[n]);
        pos.setXYZ(k, v.x, v.y, v.z);
        posChanged = true;
      }
      const q = this.normals[n];
      const m = normal[k];
      if (q && m >= 0 && m * 3 + 2 < q.length) {
        v.set(q[m * 3], q[m * 3 + 1], q[m * 3 + 2]).applyMatrix3(this.normalBind[n]);
        if (v.lengthSq() > 0) v.normalize();
        nrm.setXYZ(k, v.x, v.y, v.z);
        nrmChanged = true;
      }
    }
    if (posChanged) pos.needsUpdate = true;
    if (nrmChanged) nrm.needsUpdate = true;
  }
}
