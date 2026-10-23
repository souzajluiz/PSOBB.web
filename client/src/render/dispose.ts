// Releases what a model tree owns: geometries, material arrays and skeletons.
// Textures are not touched except through the materials' own dispose listeners
// (wrapped clones, render/njmesh.ts): the base textures belong to the archive
// caches (render/enemymodel.ts), which outlive the models.

import * as THREE from 'three';

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
}

// Points the meshes of `dst` at the geometries and materials of `src`, two trees built from the same model
// (their meshes pair up in traversal order). The copy's own geometries and materials are released, the
// source's stay (disposeTree of either tree would release the shared ones: copies are never removed alone).
// Returns false and changes nothing when the trees do not pair up or hold skinned meshes.
export function shareMeshResources(src: THREE.Object3D, dst: THREE.Object3D): boolean {
  const from = meshesOf(src);
  const to = meshesOf(dst);
  if (from.length === 0 || from.length !== to.length) return false;
  if (from.some((m, i) => m instanceof THREE.SkinnedMesh || to[i] instanceof THREE.SkinnedMesh)) return false;
  for (let i = 0; i < from.length; i++) {
    const a = from[i]!;
    const b = to[i]!;
    if (a.geometry === b.geometry) continue;
    b.geometry.dispose();
    for (const m of Array.isArray(b.material) ? b.material : [b.material]) m.dispose();
    b.geometry = a.geometry;
    b.material = a.material;
  }
  return true;
}

export function disposeTree(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
    if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
  });
  for (const m of materials) m.dispose();
}
