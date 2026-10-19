// Releases what a model tree owns: geometries, material arrays and skeletons.
// Textures are not touched except through the materials' own dispose listeners
// (wrapped clones, render/njmesh.ts): the base textures belong to the archive
// caches (render/enemymodel.ts), which outlive the models.

import * as THREE from 'three';

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
