// Static geometry batching and transform freezing.
//
// The map and the field objects are hundreds of tiny meshes (1074 of 1158 meshes
// of a Forest 1 frame have under 200 vertices) and every material group of a
// mesh is its own draw call, so a phone is limited by submission, not by
// triangles. A StaticBatcher takes the opaque material groups of meshes that
// never change after placement, bakes their world matrices into the vertices and
// merges them per (material, render order, attribute set, spatial cell) into a
// few BufferGeometries. Nothing that can change is taken:
//
//  - blended groups are merged only per (material, cell) and drawn in placement
//    order (see BatchOptions.transparent),
//  - skinned / instanced meshes, hidden meshes and meshes flagged
//    `userData.noBatch` stay as they are,
//  - the callers pass only subtrees that are static (no map motion, no .tam
//    scroll or texture swap, no state-driven visibility): see
//    MapViewer.show and ObjectLayer.batchStatic.
//
// The spatial cell keeps frustum culling and ray casts (MapViewer.groundHeight)
// useful: one map-wide mesh would never be culled. Chunks are capped to 65535
// vertices so the index stays 16 bit.
//
// freezeStatic / thaw switch the matrix updates of objects that never move after
// placement off and on again.

import * as THREE from 'three';
import type { TexturePool } from './texturepool.ts';

export const DEFAULT_CELL_SIZE = 1500; // world units (a Forest 1 section is a few hundred)
export const MAX_BATCH_VERTICES = 65535;

export interface BatchOptions {
  cellSize: number; // 0 or Infinity: one cell
  maxVertices: number;
  // Also merge blended (transparent) groups. three sorts blended meshes back to
  // front by their centre; a merged batch is drawn in index order (the order
  // the pieces were placed in) at the depth of its own centre. Pieces of one
  // texture that overlap on screen can blend in another order: on the maps this
  // is a mean difference of 0.04-0.15 of 255 (DEVLOG), but it is not
  // pixel-identical, so ?transparent=0 turns it off.
  transparent: boolean;
  // Textures as layers of array textures (render/texturepool.ts): one draw call
  // per render state and texture size instead of per texture.
  pool: TexturePool | null;
  // Bake into this space instead of world space: the inverse world matrix of the
  // object the batches will be children of (a hideable object keeps its own
  // handle: ObjectLayer.batchStatic).
  space: THREE.Matrix4 | null;
  // Keep the vertices as they are (the mesh's own space) and leave the matrix
  // updates of the merged meshes on: for a mesh that stays under a moving node
  // (poolMeshInPlace).
  local: boolean;
}

export const DEFAULT_BATCH_OPTIONS: BatchOptions = { cellSize: DEFAULT_CELL_SIZE, maxVertices: MAX_BATCH_VERTICES, transparent: true, pool: null, space: null, local: false };

export interface BatchStats {
  meshesIn: number; // meshes that gave groups to a batch
  groupsIn: number; // material groups merged
  groupsKept: number; // groups left in their meshes (transparent, unsupported)
  batches: number; // merged meshes created
  vertices: number;
  triangles: number;
  pooled: number; // meshes rewritten in place (poolMeshInPlace)
}

const IDENTITY = new THREE.Matrix4();
const emptyStats = (): BatchStats => ({ meshesIn: 0, groupsIn: 0, groupsKept: 0, batches: 0, vertices: 0, triangles: 0, pooled: 0 });

// Which attributes a piece carries; pieces of one batch must agree: uv, colour,
// normal, texture layer. Normals are only carried when the material generates
// its UVs from them (xj-envmap).
export function attributeSignature(geometry: THREE.BufferGeometry, material: THREE.Material, pooled = false): string {
  const has = (n: string) => (geometry.getAttribute(n) ? '1' : '0');
  return `${has('uv')}${has('color')}${material.userData.envMap && geometry.getAttribute('normal') ? '1' : '0'}${pooled ? '1' : '0'}`;
}

// The key pieces are merged under. Pure: tests/batching.test.ts.
export function batchKey(material: THREE.Material, renderOrder: number, signature: string, cell: readonly [number, number, number]): string {
  return `${material.uuid}|${renderOrder}|${signature}|${cell[0]},${cell[1]},${cell[2]}`;
}

export function cellOf(center: THREE.Vector3, cellSize: number): [number, number, number] {
  if (!(cellSize > 0) || !Number.isFinite(cellSize)) return [0, 0, 0];
  return [Math.floor(center.x / cellSize), Math.floor(center.y / cellSize), Math.floor(center.z / cellSize)];
}

// A group of a mesh can be merged: an opaque basic material, drawn as it is.
export function groupBatchable(material: THREE.Material, transparent = false): boolean {
  return (transparent || !material.transparent) && material.type === 'MeshBasicMaterial';
}

// A mesh can give groups away. `visible` is checked on the mesh only: the
// callers decide about the subtree.
export function meshBatchable(mesh: THREE.Mesh): boolean {
  if (!mesh.visible || mesh.userData.noBatch) return false;
  if (mesh.type !== 'Mesh' || (mesh as THREE.InstancedMesh).isInstancedMesh) return false; // SkinnedMesh, InstancedMesh, ...
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  return !!g.index && !!pos && pos instanceof THREE.BufferAttribute && pos.itemSize === 3;
}

interface Piece {
  geometry: THREE.BufferGeometry; // vertex attributes only: keepGroups rewrites the index of a mesh that keeps groups
  indices: ArrayLike<number>; // the group's triangle indices into those attributes
  count: number;
  matrix: THREE.Matrix4;
  normalMatrix: THREE.Matrix3 | null;
  layer: number; // texture layer in the pool's array, when pooled
}

interface Batch {
  material: THREE.Material;
  renderOrder: number;
  signature: string;
  pieces: Piece[];
}

export class StaticBatcher {
  readonly options: BatchOptions;
  readonly stats: BatchStats = emptyStats();
  private batches = new Map<string, Batch>();
  private center = new THREE.Vector3();

  constructor(options: Partial<BatchOptions> = {}) {
    this.options = { ...DEFAULT_BATCH_OPTIONS, ...options };
  }

  // Takes the batchable groups of `mesh` (its matrixWorld must be current).
  // Returns the groups that stay in the mesh, as {start, count, materialIndex}
  // into the mesh's own material array (an empty list: the mesh is empty now),
  // or null when nothing was batchable and the mesh stays as it is.
  take(mesh: THREE.Mesh): THREE.BufferGeometry['groups'] | null {
    const g = mesh.geometry;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index!.count, materialIndex: 0 }];
    if (!g.boundingSphere) g.computeBoundingSphere();
    this.center.copy(g.boundingSphere!.center).applyMatrix4(mesh.matrixWorld);
    const cell = cellOf(this.center, this.options.cellSize);
    const matrix = this.options.local ? IDENTITY : this.options.space ? new THREE.Matrix4().multiplyMatrices(this.options.space, mesh.matrixWorld) : mesh.matrixWorld;
    let normalMatrix: THREE.Matrix3 | null = null;
    const kept: THREE.BufferGeometry['groups'] = [];
    let took = 0;
    for (const grp of groups) {
      const material = mats[grp.materialIndex ?? 0];
      if (!material || !groupBatchable(material, this.options.transparent) || grp.count === 0) {
        kept.push(grp);
        this.stats.groupsKept++;
        continue;
      }
      const pooled = this.options.pool && g.getAttribute('uv') ? this.options.pool.resolve(material as THREE.MeshBasicMaterial) : null;
      const target = pooled?.material ?? material;
      const signature = attributeSignature(g, target, !!pooled);
      const key = batchKey(target, mesh.renderOrder, signature, cell);
      let batch = this.batches.get(key);
      if (!batch) this.batches.set(key, (batch = { material: target, renderOrder: mesh.renderOrder, signature, pieces: [] }));
      if (signature[2] === '1') normalMatrix ??= new THREE.Matrix3().getNormalMatrix(matrix);
      batch.pieces.push({ geometry: g, indices: (g.index!.array as Uint16Array).slice(grp.start, grp.start + grp.count), count: grp.count, matrix, normalMatrix: signature[2] === '1' ? normalMatrix : null, layer: pooled?.layer ?? 0 });
      this.stats.groupsIn++;
      took++;
    }
    if (took) this.stats.meshesIn++;
    return took ? kept : null;
  }

  // The merged meshes. The batcher is empty afterwards.
  build(): THREE.Mesh[] {
    this.options.pool?.finish();
    const out: THREE.Mesh[] = [];
    for (const batch of this.batches.values()) {
      for (const chunk of splitPieces(batch.pieces, this.options.maxVertices)) {
        const mesh = new THREE.Mesh(mergePieces(chunk, batch.signature), batch.material);
        mesh.renderOrder = batch.renderOrder;
        mesh.name = 'batch';
        mesh.userData.batch = true;
        if (!this.options.local) {
          mesh.matrixAutoUpdate = false;
          mesh.matrixWorldAutoUpdate = false;
        }
        this.stats.batches++;
        this.stats.vertices += mesh.geometry.getAttribute('position').count;
        this.stats.triangles += mesh.geometry.index!.count / 3;
        out.push(mesh);
      }
    }
    this.batches.clear();
    return out;
  }
}

// Number of distinct vertices the indices of a piece use (scratch is reused).
function uniqueVertices(p: Piece, seen: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < p.count; i++) {
    const v = p.indices[i];
    if (!seen[v]) {
      seen[v] = 1;
      n++;
    }
  }
  for (let i = 0; i < p.count; i++) seen[p.indices[i]] = 0;
  return n;
}

// Splits pieces into chunks of at most `max` vertices. A single piece larger
// than `max` still gets its own chunk (the index then turns 32 bit).
export function splitPieces<T extends { geometry: THREE.BufferGeometry; indices: ArrayLike<number>; count: number }>(pieces: T[], max: number): T[][] {
  const chunks: T[][] = [];
  let cur: T[] = [];
  let used = 0;
  let seen = new Uint8Array(0);
  for (const p of pieces) {
    const need = p.geometry.getAttribute('position').count;
    if (seen.length < need) seen = new Uint8Array(need);
    const n = uniqueVertices(p as unknown as Piece, seen);
    if (cur.length && used + n > max) {
      chunks.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(p);
    used += n;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function mergePieces(pieces: Piece[], signature: string): THREE.BufferGeometry {
  const hasUv = signature[0] === '1', hasColor = signature[1] === '1', hasNormal = signature[2] === '1', hasLayer = signature[3] === '1';
  // First pass: the vertices each piece uses, in first-use order.
  let total = 0, indexTotal = 0;
  const used: Int32Array[] = [];
  const remaps: Int32Array[] = [];
  for (const p of pieces) {
    const remap = new Int32Array(p.geometry.getAttribute('position').count).fill(-1);
    const list: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const v = p.indices[i];
      if (remap[v] < 0) {
        remap[v] = list.length;
        list.push(v);
      }
    }
    used.push(Int32Array.from(list));
    remaps.push(remap);
    total += list.length;
    indexTotal += p.count;
  }
  const position = new Float32Array(total * 3);
  const normal = hasNormal ? new Float32Array(total * 3) : null;
  const color = hasColor ? new Float32Array(total * 4) : null;
  const uv = hasUv ? new Float32Array(total * 2) : null;
  const texLayer = hasLayer ? new Float32Array(total) : null;
  const indices = total > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);
  const v = new THREE.Vector3();
  let base = 0, ii = 0;
  pieces.forEach((p, k) => {
    const g = p.geometry;
    const pos = g.getAttribute('position');
    const nor = hasNormal ? g.getAttribute('normal') : null;
    const col = hasColor ? g.getAttribute('color') : null;
    const tex = hasUv ? g.getAttribute('uv') : null;
    const list = used[k];
    for (let j = 0; j < list.length; j++) {
      const s = list[j];
      const o = base + j;
      v.fromBufferAttribute(pos, s).applyMatrix4(p.matrix);
      position[o * 3] = v.x;
      position[o * 3 + 1] = v.y;
      position[o * 3 + 2] = v.z;
      if (nor && normal) {
        v.fromBufferAttribute(nor, s).applyMatrix3(p.normalMatrix!).normalize();
        normal[o * 3] = v.x;
        normal[o * 3 + 1] = v.y;
        normal[o * 3 + 2] = v.z;
      }
      if (col && color) for (let c = 0; c < 4; c++) color[o * 4 + c] = col.getComponent(s, c);
      if (texLayer) texLayer[o] = p.layer;
      if (tex && uv) {
        uv[o * 2] = tex.getX(s);
        uv[o * 2 + 1] = tex.getY(s);
      }
    }
    const remap = remaps[k];
    for (let i = 0; i < p.count; i++) indices[ii++] = base + remap[p.indices[i]];
    base += list.length;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  if (normal) out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  if (color) out.setAttribute('color', new THREE.BufferAttribute(color, 4));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (texLayer) out.setAttribute('texLayer', new THREE.BufferAttribute(texLayer, 1));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// Replaces the groups of `mesh` by `kept` (groups of its old index), compacting
// the index so only the kept triangles remain; removes the mesh when none do.
// Returns true when the mesh was removed (and its geometry disposed).
export function keepGroups(mesh: THREE.Mesh, kept: THREE.BufferGeometry['groups']): boolean {
  const g = mesh.geometry;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (!kept.length) {
    mesh.removeFromParent();
    g.dispose();
    return true;
  }
  const old = g.index!;
  const total = kept.reduce((n, k) => n + k.count, 0);
  const index = new (old.array.constructor as Uint16ArrayConstructor)(total);
  const newMats: THREE.Material[] = [];
  const newGroups: THREE.BufferGeometry['groups'] = [];
  let at = 0;
  for (const k of kept) {
    for (let i = 0; i < k.count; i++) index[at + i] = old.getX(k.start + i);
    newGroups.push({ start: at, count: k.count, materialIndex: newMats.length });
    newMats.push(mats[k.materialIndex ?? 0]);
    at += k.count;
  }
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.clearGroups();
  for (const grp of newGroups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  mesh.material = Array.isArray(mesh.material) ? newMats : newMats[0];
  return false;
}

// Merges the batchable groups of every mesh under `roots` into `batcher` and
// strips them from the tree; empty plain nodes are pruned. World matrices must
// be current (updateMatrixWorld(true) on the common ancestor). Returns the
// number of meshes that left the scene graph.
export function extractStatic(roots: Iterable<THREE.Object3D>, batcher: StaticBatcher): number {
  const meshes: THREE.Mesh[] = [];
  for (const root of roots) {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && meshBatchable(o)) meshes.push(o);
    });
  }
  let removed = 0;
  for (const mesh of meshes) {
    const parent = mesh.parent;
    const kept = batcher.take(mesh);
    if (kept && keepGroups(mesh, kept)) {
      removed++;
      if (parent) pruneEmpty(parent, roots);
    }
  }
  return removed;
}

// Merges the groups of one mesh that share a pooled material into one draw
// each, in place: the new meshes replace `mesh` under its parent (no baking, so
// a mesh under an animated node keeps following it). Worth it for a mesh with
// several textures of the same size and render state (a door's strips); a mesh
// that would not get fewer draws is left alone. Returns true when it was
// rewritten.
export function poolMeshInPlace(mesh: THREE.Mesh, pool: TexturePool): boolean {
  const g = mesh.geometry;
  if (!meshBatchable(mesh) || !Array.isArray(mesh.material) || g.groups.length < 2 || !g.getAttribute('uv') || !mesh.parent) return false;
  const mats = mesh.material;
  const keys = new Set<string>();
  g.groups.forEach((grp, i) => {
    const m = mats[grp.materialIndex ?? 0];
    keys.add((groupBatchable(m, true) && pool.keyOf(m as THREE.MeshBasicMaterial)) || `solo${i}`);
  });
  if (keys.size === g.groups.length) return false;
  const batcher = new StaticBatcher({ pool, cellSize: 0, local: true });
  const parent = mesh.parent;
  const kept = batcher.take(mesh);
  if (!kept) return false;
  for (const built of batcher.build()) parent.add(built);
  keepGroups(mesh, kept);
  return true;
}

// Removes `node` from its parent while it is a childless plain group, going up.
function pruneEmpty(node: THREE.Object3D, stop: Iterable<THREE.Object3D>): void {
  const keep = new Set(stop);
  let n: THREE.Object3D | null = node;
  while (n && !keep.has(n) && n.type === 'Group' && n.children.length === 0 && !n.userData.keep) {
    const up: THREE.Object3D | null = n.parent;
    n.removeFromParent();
    n = up;
  }
}

// Switches the matrix updates off for `root` and its descendants: they are
// placed and never move. The object and every descendant must be static, and
// so must every ancestor (scene.updateMatrixWorld() then only walks them).
// `isMoving` marks objects that stay live; a moving object keeps its whole
// subtree live, because a child follows its parent's world matrix.
export function freezeStatic(root: THREE.Object3D, isMoving: (o: THREE.Object3D) => boolean = () => false): number {
  let frozen = 0;
  root.updateWorldMatrix(true, true); // the world matrices stay as they are from here on
  const visit = (o: THREE.Object3D): void => {
    if (isMoving(o)) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false;
    o.matrixWorldNeedsUpdate = false;
    frozen++;
    for (const c of o.children) visit(c);
  };
  visit(root);
  return frozen;
}

// Undoes freezeStatic for `root` and its descendants (an object that has to
// move after all): the world matrices are recomputed on the next update.
export function thaw(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.matrixAutoUpdate = true;
    o.matrixWorldAutoUpdate = true;
    o.matrixWorldNeedsUpdate = true;
  });
}
