// Static geometry batching and transform freezing (client/src/render/batching.ts,
// texturepool.ts): the batching keys, a merged geometry equals the sum of its
// parts (positions with the world matrix baked in, uvs, colours, texture
// layers), transparent / skinned / flagged meshes stay out of a batch, the
// spatial cells and the vertex cap split batches, and the freeze rules.
// Run: node tests/batching.test.ts
import * as THREE from '../client/node_modules/three/build/three.module.js';
import {
  attributeSignature,
  batchKey,
  cellOf,
  extractStatic,
  freezeStatic,
  groupBatchable,
  meshBatchable,
  splitPieces,
  StaticBatcher,
  thaw,
} from '../client/src/render/batching.ts';
import { poolable, stateKey, TexturePool } from '../client/src/render/texturepool.ts';
import { MaterialCache } from '../client/src/render/njmesh.ts';
import { GroundIndex } from '../client/src/render/groundindex.ts';
import { ObjectLayer } from '../client/src/render/objectview.ts';
import { ClientFiles } from '../client/src/data/clientfiles.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const near = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) <= eps;

// A quad (2 triangles) with uvs and 4-component colours.
function quad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(16).fill(1), 4));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingSphere();
  return g;
}
const basic = (opts: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: true, ...opts });
const world = (m: THREE.Mesh) => {
  m.updateMatrixWorld(true);
  return m;
};
const trianglesOf = (m: THREE.Mesh) => (m.geometry.index?.count ?? 0) / 3;

// --- keys, cells, eligibility ---------------------------------------------------
{
  const a = basic(), b = basic();
  check(batchKey(a, 0, '110', [0, 0, 0]) === batchKey(a, 0, '110', [0, 0, 0]), 'same inputs, same key');
  check(batchKey(a, 0, '110', [0, 0, 0]) !== batchKey(b, 0, '110', [0, 0, 0]), 'another material, another key');
  check(batchKey(a, 0, '110', [0, 0, 0]) !== batchKey(a, 1, '110', [0, 0, 0]), 'another render order, another key');
  check(batchKey(a, 0, '110', [0, 0, 0]) !== batchKey(a, 0, '100', [0, 0, 0]), 'another attribute set, another key');
  check(batchKey(a, 0, '110', [0, 0, 0]) !== batchKey(a, 0, '110', [1, 0, 0]), 'another cell, another key');
  check(cellOf(new THREE.Vector3(1499, -1, 3000), 1500).join() === '0,-1,2', 'cell of a point');
  check(cellOf(new THREE.Vector3(9e6, 9e6, 9e6), Infinity).join() === '0,0,0', 'an infinite cell size is one cell');
  check(groupBatchable(basic()), 'an opaque basic material is batchable');
  check(!groupBatchable(basic({ transparent: true })), 'a blended material is not batchable unless asked');
  check(groupBatchable(basic({ transparent: true }), true), '... unless transparent batching is asked for');
  check(!groupBatchable(new THREE.MeshLambertMaterial()), 'a lit material is not batchable');
  const g = quad();
  check(attributeSignature(g, basic()) === '1100', 'signature: uv + colour, no normal, no layer');
  const env = basic();
  env.userData.envMap = true;
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(12), 3));
  check(attributeSignature(g, env, true) === '1111', 'signature of a pooled env-map material carries normals and the layer');
  check(attributeSignature(g, basic()) === '1100', 'normals are dropped for materials that do not read them');
}
{
  const m = new THREE.Mesh(quad(), basic());
  check(meshBatchable(m), 'a plain indexed mesh is batchable');
  m.visible = false;
  check(!meshBatchable(m), 'a hidden mesh is not');
  const f = new THREE.Mesh(quad(), basic());
  f.userData.noBatch = true;
  check(!meshBatchable(f), 'a mesh flagged noBatch is not');
  const inst = new THREE.InstancedMesh(quad(), basic(), 2);
  check(!meshBatchable(inst), 'an InstancedMesh is not');
  const skinned = new THREE.SkinnedMesh(quad(), basic());
  check(!meshBatchable(skinned), 'a SkinnedMesh is not');
  const unindexed = new THREE.Mesh(quad().toNonIndexed(), basic());
  check(!meshBatchable(unindexed), 'a non-indexed mesh is not');
}

// --- the merged geometry equals the sum of the parts ------------------------------
{
  const mat = basic();
  const root = new THREE.Group();
  const parts: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(quad(), mat);
    m.position.set(i * 10, 2, -i);
    m.rotation.y = i * 0.4;
    m.scale.set(1 + i, 1, 1);
    root.add(m);
    parts.push(m);
  }
  root.updateMatrixWorld(true);
  const batcher = new StaticBatcher({ cellSize: 0 });
  const removed = extractStatic([root], batcher);
  const out = batcher.build();
  check(removed === 3, 'the three meshes left the scene graph');
  check(root.children.length === 0, 'and nothing is left under the root');
  check(out.length === 1, 'one material, one cell: one batch');
  const m = out[0];
  check(trianglesOf(m) === 6, 'the batch has the triangles of all parts');
  check(m.geometry.getAttribute('position').count === 12, 'and their vertices');
  check(m.material === mat, 'it uses the shared material');
  // Every baked vertex equals matrixWorld * vertex.
  const pos = m.geometry.getAttribute('position');
  const uv = m.geometry.getAttribute('uv');
  const v = new THREE.Vector3();
  let exact = true;
  parts.forEach((p, k) => {
    const src = p.geometry.getAttribute('position');
    for (let j = 0; j < 4; j++) {
      const want = new THREE.Vector3().fromBufferAttribute(src, j).applyMatrix4(p.matrixWorld);
      v.fromBufferAttribute(pos, k * 4 + j);
      if (!near(v.x, want.x) || !near(v.y, want.y) || !near(v.z, want.z)) exact = false;
      if (!near(uv.getX(k * 4 + j), p.geometry.getAttribute('uv').getX(j))) exact = false;
    }
  });
  check(exact, 'positions are baked with the world matrix, uvs are kept');
  check(m.geometry.getAttribute('color').itemSize === 4, 'colours keep their four components');
  check(m.geometry.getAttribute('normal') === undefined, 'no normals for a material that does not read them');
  // Triangle area sum (in world space) is the sum of the parts'.
  const area = (g: THREE.BufferGeometry) => {
    let a = 0;
    const p = g.getAttribute('position'), idx = g.index!;
    const t = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < idx.count; i += 3) {
      for (let k = 0; k < 3; k++) t[k].fromBufferAttribute(p, idx.getX(i + k));
      a += new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).length() / 2;
    }
    return a;
  };
  const merged = area(m.geometry);
  const expect = parts.reduce((s, p) => {
    const g = p.geometry.clone();
    g.applyMatrix4(p.matrixWorld);
    return s + area(g);
  }, 0);
  check(near(merged, expect, 1e-4), 'the merged area is the sum of the parts');
  check(m.matrixAutoUpdate === false && m.matrixWorldAutoUpdate === false, 'a batch does not update its matrix');
  check(m.geometry.boundingSphere !== null && m.geometry.boundingSphere.radius > 0, 'a batch has its own bounding sphere (culling)');
}

// --- what stays out of a batch ---------------------------------------------------
{
  const opaque = basic(), blended = basic({ transparent: true, depthWrite: false });
  const root = new THREE.Group();
  const solid = new THREE.Mesh(quad(), opaque);
  const glass = new THREE.Mesh(quad(), blended);
  const hidden = new THREE.Mesh(quad(), opaque);
  hidden.visible = false;
  const flagged = new THREE.Mesh(quad(), opaque);
  flagged.userData.noBatch = true;
  const skinned = new THREE.SkinnedMesh(quad(), opaque);
  root.add(solid, glass, hidden, flagged, skinned);
  root.updateMatrixWorld(true);
  const batcher = new StaticBatcher({ transparent: false });
  extractStatic([root], batcher);
  const out = batcher.build();
  check(out.length === 1 && trianglesOf(out[0]) === 2, 'only the opaque, visible, plain mesh is merged');
  check(root.children.includes(glass) && root.children.includes(hidden) && root.children.includes(flagged) && root.children.includes(skinned), 'blended, hidden, flagged and skinned meshes stay where they are');
  check(!root.children.includes(solid), 'the merged mesh left its parent');
}
{
  // A mesh with an opaque and a blended group: the opaque one is merged, the
  // blended one stays in the mesh (indices compacted, same render order).
  const g = quad();
  g.setIndex([0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3]);
  g.addGroup(0, 6, 0);
  g.addGroup(6, 6, 1);
  const opaque = basic(), blended = basic({ transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(g, [opaque, blended]);
  mesh.renderOrder = 1;
  const root = new THREE.Group();
  root.add(mesh);
  root.updateMatrixWorld(true);
  const batcher = new StaticBatcher({ transparent: false });
  extractStatic([root], batcher);
  const out = batcher.build();
  check(out.length === 1 && trianglesOf(out[0]) === 2 && out[0].renderOrder === 1, 'the opaque group is merged and keeps the render order');
  check(root.children[0] === mesh, 'the mesh stays');
  check(Array.isArray(mesh.material) && mesh.material.length === 1 && mesh.material[0] === blended, 'with only its blended material');
  check(g.groups.length === 1 && g.groups[0].start === 0 && g.groups[0].count === 6 && g.index!.count === 6, 'and only its blended triangles');
  check(out[0].geometry.getAttribute('position').count === 4, 'the merged part used the old index (the rewrite came after the copy)');
  // The batch has the triangle (0,1,2) of the original index.
  check(Array.from(out[0].geometry.index!.array).join() === '0,1,2,0,2,3', 'with its own indices');
  // With transparent batching on, both go.
  const g2 = quad();
  g2.setIndex([0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3]);
  g2.addGroup(0, 6, 0);
  g2.addGroup(6, 6, 1);
  const m2 = new THREE.Mesh(g2, [opaque, blended]);
  const r2 = new THREE.Group();
  r2.add(m2);
  r2.updateMatrixWorld(true);
  const b2 = new StaticBatcher();
  extractStatic([r2], b2);
  check(b2.build().length === 2 && r2.children.length === 0, 'transparent batching (the default) merges the blended group as its own batch');
}

// --- cells and the vertex cap ------------------------------------------------------
{
  const mat = basic();
  const root = new THREE.Group();
  for (const x of [0, 100, 5000]) {
    const m = new THREE.Mesh(quad(), mat);
    m.position.x = x;
    root.add(m);
  }
  root.updateMatrixWorld(true);
  const b = new StaticBatcher({ cellSize: 1500 });
  extractStatic([root], b);
  const out = b.build();
  check(out.length === 2, 'two cells: two batches');
  check(out.map(trianglesOf).sort().join() === '2,4', 'with 2 + 1 meshes');
  const r2 = new THREE.Group();
  for (let i = 0; i < 5; i++) r2.add(new THREE.Mesh(quad(), mat));
  r2.updateMatrixWorld(true);
  const b2 = new StaticBatcher({ maxVertices: 8 });
  extractStatic([r2], b2);
  const out2 = b2.build();
  check(out2.length === 3 && out2.every((m) => m.geometry.getAttribute('position').count <= 8), 'the vertex cap splits a batch (4 vertices per quad, cap 8: 2 + 2 + 1)');
  check(out2.reduce((s, m) => s + trianglesOf(m), 0) === 10, 'without losing triangles');
  const chunks = splitPieces([{ geometry: quad(), indices: [0, 1, 2], count: 3 }, { geometry: quad(), indices: [0, 1, 2], count: 3 }], 4);
  check(chunks.length === 2, 'splitPieces counts the vertices a piece uses, not the vertices of its geometry');
}

// --- only the used vertices are copied ---------------------------------------------
{
  const g = quad();
  g.setIndex([0, 1, 2, 3, 2, 0]);
  g.addGroup(0, 3, 0);
  g.addGroup(3, 3, 1);
  const a = basic(), b = basic({ color: 0xff0000 });
  const mesh = new THREE.Mesh(g, [a, b]);
  const root = new THREE.Group();
  root.add(mesh);
  root.updateMatrixWorld(true);
  const batcher = new StaticBatcher();
  extractStatic([root], batcher);
  const out = batcher.build();
  check(out.length === 2, 'two materials: two batches');
  check(out.every((m) => m.geometry.getAttribute('position').count === 3), 'each copies the three vertices its triangle uses');
}

// --- texture pool --------------------------------------------------------------------
{
  const tex = (w: number, h: number, fill: number, wrap = THREE.RepeatWrapping) => {
    const t = new THREE.DataTexture(new Uint8Array(w * h * 4).fill(fill), w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = wrap;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const a = tex(4, 4, 10), b = tex(4, 4, 20), c = tex(8, 8, 30), d = tex(4, 4, 40, THREE.ClampToEdgeWrapping);
  check(poolable(a), 'a plain RGBA DataTexture is poolable');
  const scrolled = tex(4, 4, 1);
  scrolled.offset.set(0.25, 0);
  check(!poolable(scrolled), 'a scrolled texture is not');
  check(!poolable(new THREE.Texture()), 'a Texture without raw bytes is not');
  const pool = new TexturePool();
  const mats = [a, b, c, d].map((t) => basic({ map: t }));
  const r = mats.map((m) => pool.resolve(m)!);
  check(r.every(Boolean), 'all four resolve');
  check(r[0].material === r[1].material && r[0].layer === 0 && r[1].layer === 1, 'same size, wrap and state: one pooled material, layers 0 and 1');
  check(r[2].material !== r[0].material, 'another size, another array');
  check(r[3].material !== r[0].material, 'another wrap mode, another array');
  check(pool.arrayCount === 3, 'three arrays');
  check(pool.resolve(mats[0])!.layer === 0, 'resolving a texture again gives its layer');
  const alpha = basic({ map: a, alphaTest: 0.5 });
  check(pool.resolve(alpha)!.material !== r[0].material, 'another material state, another pooled material');
  check(stateKey(basic({ map: a })) === stateKey(basic({ map: b })), 'the state key ignores the texture');
  // Through the batcher: the layer attribute selects the texture.
  const root = new THREE.Group();
  [a, b].forEach((t, i) => {
    const m = new THREE.Mesh(quad(), basic({ map: t }));
    m.position.x = i;
    root.add(m);
  });
  root.updateMatrixWorld(true);
  const pool2 = new TexturePool();
  const batcher = new StaticBatcher({ pool: pool2 });
  extractStatic([root], batcher);
  const out = batcher.build();
  check(out.length === 1, 'two textures of one size: one draw');
  const layer = out[0].geometry.getAttribute('texLayer');
  check(!!layer && layer.count === 8 && layer.getX(0) === 0 && layer.getX(4) === 1, 'texLayer carries each piece\'s layer');
  const map = (out[0].material as THREE.MeshBasicMaterial).map as unknown as THREE.DataArrayTexture;
  check(map.isDataArrayTexture && map.image.depth === 2 && map.image.width === 4, 'the material samples a 2-layer array texture');
  check(map.image.data !== null && map.image.data[0] === 10 && map.image.data[4 * 4 * 4] === 20, 'whose layers are the source bytes');
  pool2.dispose();
  pool.dispose();
}

// --- MaterialCache sharing -----------------------------------------------------------
{
  const t = new THREE.DataTexture(new Uint8Array(16), 2, 2, THREE.RGBAFormat);
  const cache = new MaterialCache((id) => (id === 0 ? t : null));
  const view = cache.view((id) => (id === 7 ? t : null));
  const m = (id: number) => ({ textureId: id, addressU: 2, addressV: 2, diffuse: 0xffffffff, blendSrc: 4, blendDst: 5, envMap: false }) as unknown as Parameters<MaterialCache['get']>[0];
  check(cache.get(m(0), false, false) === view.get(m(7), false, false), 'two lookups that resolve to one texture share the material');
  check(cache.get(m(0), false, false) !== cache.get(m(0), true, false), 'alpha is part of the key');
  view.dispose();
  check(cache.get(m(0), false, false) !== undefined, 'disposing a view leaves the cache alone');
  cache.dispose();
}

// --- freeze rules ----------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const section = new THREE.Group();
  section.position.set(5, 0, 0);
  const still = new THREE.Group();
  still.position.set(0, 1, 0);
  const mover = new THREE.Group();
  const moverKid = new THREE.Group();
  moverKid.position.set(0, 0, 2);
  mover.add(moverKid);
  section.add(still, mover);
  scene.add(section);
  const n = freezeStatic(section, (o) => o === mover);
  check(n === 2, 'the section and the still node are frozen');
  check(!section.matrixAutoUpdate && !section.matrixWorldAutoUpdate && !still.matrixWorldAutoUpdate, 'frozen: no matrix update, no world update');
  check(mover.matrixAutoUpdate && mover.matrixWorldAutoUpdate && moverKid.matrixAutoUpdate && moverKid.matrixWorldAutoUpdate, 'a moving object keeps its subtree live');
  // The frozen world matrices are right, and the mover follows its frozen parent.
  scene.updateMatrixWorld();
  check(near(still.matrixWorld.elements[12], 5) && near(still.matrixWorld.elements[13], 1), 'frozen objects keep the world matrix they had');
  mover.position.set(0, 3, 0);
  scene.updateMatrixWorld();
  check(near(moverKid.matrixWorld.elements[12], 5) && near(moverKid.matrixWorld.elements[13], 3) && near(moverKid.matrixWorld.elements[14], 2), 'a moving child of a frozen parent still resolves to world space');
  // Moving a frozen object does nothing until it is thawed.
  still.position.set(0, 50, 0);
  scene.updateMatrixWorld();
  check(near(still.matrixWorld.elements[13], 1), 'a frozen object ignores a move');
  thaw(still);
  scene.updateMatrixWorld();
  check(near(still.matrixWorld.elements[13], 50), 'thaw makes it follow again');
  check(still.matrixAutoUpdate && still.matrixWorldAutoUpdate, 'and live');
  // Thawing a parent thaws its descendants (a child follows its parent's world matrix).
  thaw(mover);
  check(moverKid.matrixWorldAutoUpdate, 'thaw covers the subtree');
}

// --- ground index = the ray cast it replaces -------------------------------------------
{
  // A bumpy, rotated and scaled plane merged with a second layer above it.
  const mat = basic();
  const root = new THREE.Group();
  const lump = (n: number, y: number, seed: number) => {
    const g = new THREE.PlaneGeometry(400, 400, n, n);
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, y + 20 * Math.sin(i * 1.7 + seed) + 10 * Math.cos(i * 0.31 * seed));
    return new THREE.Mesh(g, mat);
  };
  const lower = lump(12, 0, 1), upper = lump(9, 60, 2);
  lower.position.set(30, -5, 10);
  lower.rotation.y = 0.5;
  upper.scale.set(1.3, 1, 0.8);
  root.add(lower, upper);
  root.updateMatrixWorld(true);
  const index = new GroundIndex();
  index.addObjects([root]);
  check(index.triangleCount === 12 * 12 * 2 + 9 * 9 * 2, 'the index holds every triangle');
  const ray = new THREE.Raycaster();
  let same = true, hits = 0;
  for (let i = 0; i < 400; i++) {
    const x = -350 + ((i * 37) % 700), z = -350 + ((i * 91) % 700), fromY = i % 3 === 0 ? 40 : 1000;
    ray.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(root, true)[0];
    const y = index.height(x, z, fromY);
    if ((hit === undefined) !== (y === null)) {
      // A ray that grazes a shared edge may be a hit for one test and a miss for the other.
      const edge = Math.abs((hit?.point.y ?? y!) - (y ?? hit.point.y)) < 1e-3;
      if (!edge) same = false;
    } else if (hit && y !== null) {
      hits++;
      if (!near(hit.point.y, y, 1e-3)) same = false;
    }
  }
  check(same && hits > 100, `ground index agrees with the ray cast (${hits} hits)`);
  check(index.height(5000, 5000, 1000) === null, 'no surface outside the map');
  const skipped = new GroundIndex();
  skipped.addObjects([root], (o) => o === upper);
  check(skipped.triangleCount === 12 * 12 * 2, 'a skipped subtree (a moving entry) stays out of the index');
}

// --- a hideable object's merged meshes keep the object's world matrix -------------------
{
  // ObjectLayer.batchStatic's own path (boxes, delayed objects): build() switches the merged
  // mesh's matrix updates off, so its world matrix stayed at identity and the box drew at the
  // world origin. The merged mesh must sit at the object's world matrix and keep its box.
  const stub = { label: 'stub', list: async () => [], read: async () => new Uint8Array() };
  const layer = new ObjectLayer({ scene: new THREE.Scene(), frameHooks: new Set() } as any, new ClientFiles(stub));
  const root = new THREE.Group();
  const objRoot = new THREE.Group();
  objRoot.position.set(100, 20, -50);
  objRoot.rotation.y = 0.7;
  const part = new THREE.Group();
  const crate = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x884422 }));
  crate.position.set(0, 5, 0);
  part.add(crate);
  objRoot.add(part);
  root.add(objRoot);
  root.updateMatrixWorld(true);
  (layer as any).root = root;
  layer.models.set(7, { entity: null, spec: { name: 'TObjContainerItem', bml: '', parts: [] }, root: objRoot, parts: [{ show: 'always', group: part, animator: null, drive: 'loop', nodes: [] }] } as any);
  layer.batchStatic(new Set(), new Set([7]));
  const merged = objRoot.children.find((c) => c.type === 'Mesh') as THREE.Mesh | undefined;
  check(!!merged, 'the object keeps one merged mesh under its root');
  if (merged) {
    const w = merged.matrixWorld.elements;
    check(near(w[12], 100) && near(w[13], 20) && near(w[14], -50), `the merged mesh sits at the object (${w[12]}, ${w[13]}, ${w[14]})`);
    check(merged.matrixWorld.equals(objRoot.matrixWorld), 'the merged mesh has the root world matrix');
    merged.geometry.computeBoundingBox();
    const box = merged.geometry.boundingBox!;
    check(near(box.max.y - box.min.y, 10) && near(box.min.y, 0), 'the crate keeps its own size and height in the object frame');
  }
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('batching.test: all checks passed');
