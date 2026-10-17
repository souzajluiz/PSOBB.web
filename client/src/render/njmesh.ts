// Converts parsed Ninja/XJ data into three.js objects.

import * as THREE from 'three';
import type { NjObject, XjModel, XjMaterial } from '../formats/xj.ts';
import { EVAL_HIDE, EVAL_ZXY_ANG, XJ_ADDRESS_CLAMP, XJ_ADDRESS_MIRROR } from '../formats/xj.ts';

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

// XJ texture address mode (material type 4) -> three.js wrap mode.
export function wrapMode(address: number): THREE.Wrapping {
  if (address === XJ_ADDRESS_CLAMP) return THREE.ClampToEdgeWrapping;
  if (address === XJ_ADDRESS_MIRROR) return THREE.MirroredRepeatWrapping;
  return THREE.RepeatWrapping; // 2, and 3 (the client's table maps it to D3DTADDRESS_WRAP too)
}

// D3D vertex colors are gamma-space values that the original multiplies with
// the texture directly. three.js treats vertex colors as linear, so convert
// (RGB only), otherwise lit areas come out washed out.
function srgbToLinearColors(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  const c = new THREE.Color();
  for (let i = 0; i < src.length; i += 4) {
    c.setRGB(src[i], src[i + 1], src[i + 2], THREE.SRGBColorSpace);
    out[i] = c.r;
    out[i + 1] = c.g;
    out[i + 2] = c.b;
    out[i + 3] = src[i + 3];
  }
  return out;
}

// D3DCOLOR (0xAARRGGBB) -> linear three.js color + alpha.
function d3dColor(argb: number): { color: THREE.Color; alpha: number } {
  const color = new THREE.Color().setRGB(((argb >>> 16) & 0xff) / 255, ((argb >>> 8) & 0xff) / 255, (argb & 0xff) / 255, THREE.SRGBColorSpace);
  return { color, alpha: (argb >>> 24) / 255 };
}

export class MaterialCache {
  private cache = new Map<string, THREE.Material>();
  // Wrap modes live on THREE.Texture, so each (texture, wrapS, wrapT) needs its own
  // Texture object. Clones share the image source.
  private wrapped = new Map<string, THREE.Texture>();
  private textures: TextureLookup;

  constructor(textures: TextureLookup) {
    this.textures = textures;
  }

  private texture(id: number, addressU: number, addressV: number): THREE.Texture | null {
    if (id < 0) return null;
    const base = this.textures(id);
    if (!base) return null;
    const s = wrapMode(addressU), t = wrapMode(addressV);
    if (base.wrapS === s && base.wrapT === t) return base;
    const key = `${id}|${s}|${t}`;
    let tex = this.wrapped.get(key);
    if (!tex) {
      tex = base.clone();
      tex.wrapS = s;
      tex.wrapT = t;
      tex.needsUpdate = true;
      this.wrapped.set(key, tex);
    }
    return tex;
  }

  get(m: XjMaterial, alpha: boolean, vertexColors: boolean): THREE.Material {
    // Material color (type 5) only matters for meshes without per-vertex colors:
    // the client feeds its diffuse in as the constant vertex color.
    const diffuse = vertexColors ? 0xffffffff : m.diffuse;
    const key = `${m.textureId}|${m.addressU}|${m.addressV}|${diffuse}|${m.blendSrc}|${m.blendDst}|${alpha}|${vertexColors}`;
    let mat = this.cache.get(key);
    if (!mat) {
      const map = this.texture(m.textureId, m.addressU, m.addressV);
      const { color, alpha: opacity } = d3dColor(diffuse);
      const basic = new THREE.MeshBasicMaterial({
        map,
        color,
        opacity: alpha ? opacity : 1,
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
      basic.userData.textureId = m.textureId;
      mat = basic;
      this.cache.set(key, mat);
    }
    return mat;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    // Only the clones are ours; the base textures belong to the caller.
    for (const t of this.wrapped.values()) t.dispose();
    this.wrapped.clear();
  }
}

export function buildModelMesh(model: XjModel, materials: MaterialCache): THREE.Mesh | null {
  const v = model.vertices;
  if (!v || !model.strips.length) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(v.positions, 3));
  if (v.normals) geom.setAttribute('normal', new THREE.BufferAttribute(v.normals, 3));
  if (v.colors) geom.setAttribute('color', new THREE.BufferAttribute(srgbToLinearColors(v.colors), 4));
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
