// Texture pools: the textures of merged meshes as layers of array textures.
//
// A merged mesh (render/batching.ts) still needs one draw call per texture. The
// map's textures come in a handful of sizes, so a pool copies them into
// DataArrayTextures (one per size / wrap / filter) and the merged meshes pick
// the layer per vertex (`texLayer`). One draw call then covers every texture of
// the same size and render state, with the same samples as before: the layer is
// constant over a triangle, so the derivatives (mip level) are those of the
// plain texture, and each layer is mipmapped by itself.
//
// The pool owns its array textures and the pooled materials; the source
// textures belong to whoever made them.

import * as THREE from 'three';
import { patchEnvironmentTexgen } from './njmesh.ts';

export const POOL_MAX_LAYERS = 128; // WebGL2 guarantees 256
export const POOL_MAX_BYTES = 64 * 1024 * 1024;

export interface PooledMaterial {
  material: THREE.MeshBasicMaterial;
  layer: number;
}

interface PoolArray {
  texture: THREE.DataArrayTexture;
  width: number;
  height: number;
  layers: THREE.Texture[]; // source textures, in layer order
  layerOf: Map<string, number>; // source texture uuid -> layer
  bytes: number;
  built: number; // layers copied into the texture
}

// A texture the pool can copy: raw RGBA bytes, unmodified sampling transform.
export function poolable(t: THREE.Texture | null): t is THREE.DataTexture {
  if (!t || !(t as THREE.DataTexture).isDataTexture) return false;
  const img = t.image as { data?: ArrayLike<number>; width: number; height: number };
  if (!(img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray)) return false;
  if (t.format !== THREE.RGBAFormat || t.type !== THREE.UnsignedByteType) return false;
  if (img.data.length !== img.width * img.height * 4) return false;
  if (t.flipY || t.anisotropy !== 1 || t.rotation !== 0) return false;
  return t.offset.x === 0 && t.offset.y === 0 && t.repeat.x === 1 && t.repeat.y === 1 && t.center.x === 0 && t.center.y === 0;
}

// The sampling and blending state two materials must share to be one pooled material.
export function stateKey(m: THREE.MeshBasicMaterial): string {
  return [
    m.color.getHex(THREE.LinearSRGBColorSpace), m.opacity, m.vertexColors, m.side, m.transparent, m.alphaTest, m.depthWrite, m.depthTest,
    m.blending, m.blendSrc, m.blendDst, m.fog, !!m.userData.envMap,
  ].join('|');
}

export function poolShaderPatch(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float texLayer;\nvarying float vTexLayer;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTexLayer = texLayer;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <map_pars_fragment>', '#ifdef USE_MAP\nuniform sampler2DArray map;\nvarying float vTexLayer;\n#endif')
    .replace(
      '#include <map_fragment>',
      '#ifdef USE_MAP\ndiffuseColor *= texture( map, vec3( vMapUv, floor( vTexLayer + 0.5 ) ) );\n#endif',
    );
}

function arrayKeyOf(map: THREE.Texture): string {
  const { width, height } = map.image as { width: number; height: number };
  return `${width}x${height}|${map.wrapS}|${map.wrapT}|${map.minFilter}|${map.magFilter}|${map.colorSpace}|${map.generateMipmaps}`;
}

export class TexturePool {
  private arrays = new Map<string, PoolArray[]>();
  private materials = new Map<string, THREE.MeshBasicMaterial>();
  private maxLayers: number;
  private maxBytes: number;

  constructor(maxLayers = POOL_MAX_LAYERS, maxBytes = POOL_MAX_BYTES) {
    this.maxLayers = maxLayers;
    this.maxBytes = maxBytes;
  }

  get arrayCount(): number {
    let n = 0;
    for (const list of this.arrays.values()) n += list.length;
    return n;
  }

  // What resolve(source) would share between materials: the array and the
  // state, without registering the texture. null when it cannot be pooled.
  keyOf(source: THREE.MeshBasicMaterial): string | null {
    const map = source.map;
    if (!poolable(map)) return null;
    return `${arrayKeyOf(map)}|${stateKey(source)}`;
  }

  // The pooled material for `source` (a MeshBasicMaterial with a map) and the
  // layer of its texture; null when the texture cannot be pooled. Materials
  // with the same state and array are the same object. Call finish() before
  // the first render.
  resolve(source: THREE.MeshBasicMaterial): PooledMaterial | null {
    const map = source.map;
    if (!poolable(map)) return null;
    const { width, height } = map.image as { width: number; height: number };
    const arrayKey = arrayKeyOf(map);
    let list = this.arrays.get(arrayKey);
    if (!list) this.arrays.set(arrayKey, (list = []));
    const size = width * height * 4;
    let arr = list.find((a) => a.layerOf.has(map.uuid));
    if (!arr) {
      arr = list.find((a) => a.layers.length < this.maxLayers && a.bytes + size <= this.maxBytes);
      if (!arr) {
        const texture = new THREE.DataArrayTexture(null, width, height, 1);
        texture.wrapS = map.wrapS;
        texture.wrapT = map.wrapT;
        texture.minFilter = map.minFilter;
        texture.magFilter = map.magFilter;
        texture.colorSpace = map.colorSpace;
        texture.generateMipmaps = map.generateMipmaps;
        texture.format = THREE.RGBAFormat;
        texture.type = THREE.UnsignedByteType;
        texture.unpackAlignment = 4;
        arr = { texture, width, height, layers: [], layerOf: new Map(), bytes: 0, built: 0 };
        list.push(arr);
      }
      arr.layerOf.set(map.uuid, arr.layers.length);
      arr.layers.push(map);
      arr.bytes += size;
    }
    const key = `${arr.texture.uuid}|${stateKey(source)}`;
    let material = this.materials.get(key);
    if (!material) {
      material = source.clone();
      material.map = arr.texture as unknown as THREE.Texture;
      const env = !!source.userData.envMap;
      material.onBeforeCompile = (shader) => {
        if (env) patchEnvironmentTexgen(shader);
        poolShaderPatch(shader);
      };
      material.customProgramCacheKey = () => (env ? 'xj-texpool-envmap' : 'xj-texpool');
      material.userData.pooled = true;
      this.materials.set(key, material);
    }
    return { material, layer: arr.layerOf.get(map.uuid)! };
  }

  // Fills the array textures with the layers resolved so far. Idempotent: an
  // array is rebuilt when layers were added since.
  finish(): void {
    for (const list of this.arrays.values()) {
      for (const a of list) {
        if (a.built === a.layers.length) continue;
        a.built = a.layers.length;
        const layerBytes = a.width * a.height * 4;
        const data = new Uint8Array(layerBytes * a.layers.length);
        a.layers.forEach((t, i) => data.set((t.image as { data: Uint8Array }).data, i * layerBytes));
        a.texture.image = { data, width: a.width, height: a.height, depth: a.layers.length };
        // The bytes are in the GPU copy after the first upload; the CPU copy is not
        // needed again (the app does not handle WebGL context loss anyway).
        a.texture.onUpdate = () => {
          (a.texture.image as { data: Uint8Array | null }).data = null;
          a.texture.onUpdate = null;
        };
        a.texture.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const list of this.arrays.values()) for (const a of list) a.texture.dispose();
    this.arrays.clear();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
