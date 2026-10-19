// Ground height of the static map by a grid of triangles.
//
// MapViewer.groundHeight used to ray cast the map's meshes: cheap while a map
// was hundreds of small meshes (a bounding sphere test rejects most of them),
// but the merged batches (render/batching.ts) are large meshes, and a vertical
// ray would walk every triangle of each one it crosses. This index buckets the
// triangles of the static meshes by their (x, z) footprint once, and answers
// "the highest surface at or below fromY at (x, z)" from one bucket. Both sides
// of a triangle count, like the DoubleSide materials of the ray cast it replaces.

import * as THREE from 'three';

export const GROUND_CELL = 64;

export class GroundIndex {
  private readonly cell: number;
  private tris: number[] = []; // 9 numbers per triangle, world space
  private buckets = new Map<number, number[]>(); // (cx, cz) -> triangle numbers
  triangleCount = 0;

  constructor(cell = GROUND_CELL) {
    this.cell = cell;
  }

  private key(cx: number, cz: number): number {
    return (cx + 0x8000) * 0x10000 + (cz + 0x8000);
  }

  addTriangle(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const n = this.triangleCount++;
    this.tris.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const k = this.cell;
    const x0 = Math.floor(Math.min(ax, bx, cx) / k), x1 = Math.floor(Math.max(ax, bx, cx) / k);
    const z0 = Math.floor(Math.min(az, bz, cz) / k), z1 = Math.floor(Math.max(az, bz, cz) / k);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const key = this.key(ix, iz);
        let list = this.buckets.get(key);
        if (!list) this.buckets.set(key, (list = []));
        list.push(n);
      }
    }
  }

  // Adds the triangles of every plain mesh under `roots` (world matrices must
  // be current); `skip` leaves a subtree out (the entries that move).
  addObjects(roots: Iterable<THREE.Object3D>, skip: (o: THREE.Object3D) => boolean = () => false): void {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const visit = (o: THREE.Object3D): void => {
      if (skip(o)) return;
      if (o instanceof THREE.Mesh && o.geometry.index && !(o as THREE.InstancedMesh).isInstancedMesh) {
        const pos = o.geometry.getAttribute('position');
        const index = o.geometry.index;
        const m = o.matrixWorld;
        for (let i = 0; i + 2 < index.count; i += 3) {
          a.fromBufferAttribute(pos, index.getX(i)).applyMatrix4(m);
          b.fromBufferAttribute(pos, index.getX(i + 1)).applyMatrix4(m);
          c.fromBufferAttribute(pos, index.getX(i + 2)).applyMatrix4(m);
          this.addTriangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        }
      }
      for (const child of o.children) visit(child);
    };
    for (const r of roots) visit(r);
  }

  // The highest surface at (x, z) that is at or below fromY, or null.
  height(x: number, z: number, fromY: number): number | null {
    const list = this.buckets.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return null;
    const t = this.tris;
    let best = -Infinity;
    for (const n of list) {
      const o = n * 9;
      const ax = t[o], az = t[o + 2], bx = t[o + 3], bz = t[o + 5], cx = t[o + 6], cz = t[o + 8];
      // Barycentric coordinates of (x, z) in the triangle's footprint.
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (d === 0) continue; // vertical triangle: no footprint
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w = 1 - u - v;
      if (u < 0 || v < 0 || w < 0) continue;
      const y = u * t[o + 1] + v * t[o + 4] + w * t[o + 7];
      if (y <= fromY && y > best) best = y;
    }
    return best === -Infinity ? null : best;
  }
}
