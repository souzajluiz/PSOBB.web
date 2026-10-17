import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from '../client/node_modules/three/build/three.module.js';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { buildEnemy, EnemyArchive } from '../client/src/render/enemymodel.ts';
const DATA = join(process.env.HOME!, 'Downloads/psobb-client/data');
const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
const a = new EnemyArchive('item.bml', gsl.get('item.bml'), 14);
for (let i = 0; i < 14; i++) {
  const m = a.model(i);
  const b = buildEnemy(a, [{ model: i, texlistOf: 0 }]);
  const box = new THREE.Box3().setFromObject(b.root);
  const mats = new Set<string>();
  b.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const x of ms) mats.add(`${(x as THREE.MeshBasicMaterial).color?.getHexString()} map=${!!(x as THREE.MeshBasicMaterial).map} vc=${x.vertexColors} ${x.transparent ? 't' : ''} ${x.blending}`);
    }
  });
  console.log(i, m.name, m.textures.join(','), 'tris', b.triangles, 'missing', b.missingTextures, 'size', box.min.toArray().map((v) => v.toFixed(1)).join(','), box.max.toArray().map((v) => v.toFixed(1)).join(','), [...mats].join(' | '));
}
