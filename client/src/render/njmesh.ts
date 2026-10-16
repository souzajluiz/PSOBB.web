// Converts parsed Ninja/XJ data into three.js objects.

import * as THREE from 'three';
import type { NjObject, XjModel, XjMaterial } from '../formats/xj.ts';
import { EVAL_HIDE, EVAL_ZXY_ANG } from '../formats/xj.ts';

export type TextureLookup = (id: number) => THREE.Texture | null;

// Ninja blend factors (arg values of material type 2), as used by the client's
// nrel_renderstate_set_blendmode: 0 zero, 1 one, 2 other color, 3 inv other color,
// 4 src alpha, 5 inv src alpha, 6 dst alpha, 7 inv dst alpha.
const BLEND_FACTORS: THREE.BlendingSrcFactor[] = [
  THREE.ZeroFactor,
  THREE.OneFactor,
  THREE.SrcColorFactor,
  THREE.OneMinusSrcColorFactor,
  THREE.SrcAlphaFactor,
  THREE.OneMinusSrcAlphaFactor,
  THREE.DstAlphaFactor,
  THREE.OneMinusDstAlphaFactor,
];

// Strip -> triangle list, alternating winding and dropping degenerate triangles.
export function stripToTriangles(strip: Uint16Array): number[] {
  const out: number[] = [];
  for (let i = 2; i < strip.length; i++) {
    const a = strip[i - 2], b = strip[i - 1], c = strip[i];
    if (a === b || b === c || a === c) continue;
    if (i & 1) out.push(b, a, c);
    else out.push(a, b, c);
  }
  return out;
}

export class MaterialCache {
  private cache = new Map<string, THREE.Material>();
  private textures: TextureLookup;

  constructor(textures: TextureLookup) {
    this.textures = textures;
  }

  get(m: XjMaterial, alpha: boolean, vertexColors: boolean): THREE.Material {
    const key = `${m.textureId}|${m.blendSrc}|${m.blendDst}|${alpha}|${vertexColors}`;
    let mat = this.cache.get(key);
    if (!mat) {
      const map = m.textureId >= 0 ? this.textures(m.textureId) : null;
      const basic = new THREE.MeshBasicMaterial({
        map,
        vertexColors,
        side: THREE.DoubleSide,
        transparent: alpha,
        alphaTest: alpha ? 0 : 0.5,
        depthWrite: !alpha,
      });
      if (alpha) {
        basic.blending = THREE.CustomBlending;
        basic.blendSrc = BLEND_FACTORS[m.blendSrc] ?? THREE.SrcAlphaFactor;
        basic.blendDst = (BLEND_FACTORS[m.blendDst] ?? THREE.OneMinusSrcAlphaFactor) as THREE.BlendingDstFactor;
      }
      mat = basic;
      this.cache.set(key, mat);
    }
    return mat;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

export function buildModelMesh(model: XjModel, materials: MaterialCache): THREE.Mesh | null {
  const v = model.vertices;
  if (!v || !model.strips.length) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(v.positions, 3));
  if (v.normals) geom.setAttribute('normal', new THREE.BufferAttribute(v.normals, 3));
  if (v.colors) geom.setAttribute('color', new THREE.BufferAttribute(v.colors, 4));
  if (v.uvs) geom.setAttribute('uv', new THREE.BufferAttribute(v.uvs, 2));

  const indices: number[] = [];
  const mats: THREE.Material[] = [];
  for (const strip of model.strips) {
    const tris = stripToTriangles(strip.indices);
    if (!tris.length) continue;
    geom.addGroup(indices.length, tris.length, mats.length);
    mats.push(materials.get(strip.material, strip.alpha, !!v.colors));
    for (const t of tris) indices.push(t);
  }
  if (!indices.length) return null;
  geom.setIndex(indices);
  geom.computeBoundingSphere();
  const mesh = new THREE.Mesh(geom, mats);
  mesh.renderOrder = model.strips.some((s) => s.alpha) ? 1 : 0;
  return mesh;
}

export function buildObjectTree(obj: NjObject, materials: MaterialCache): THREE.Object3D {
  const node = new THREE.Group();
  node.position.set(...obj.position);
  // Ninja applies X, then Y, then Z (M = T * Rz * Ry * Rx); with ZXY_ANG: Y, X, Z.
  node.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2], obj.flags & EVAL_ZXY_ANG ? 'YXZ' : 'ZYX');
  node.scale.set(...obj.scale);
  if (obj.model && !(obj.flags & EVAL_HIDE)) {
    const mesh = buildModelMesh(obj.model, materials);
    if (mesh) node.add(mesh);
  }
  for (const child of obj.children) node.add(buildObjectTree(child, materials));
  return node;
}
