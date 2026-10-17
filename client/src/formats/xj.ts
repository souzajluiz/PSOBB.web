// Ninja object trees (NJS_OBJECT) with XJ (Xbox Ninja) models, as used by PSOBB.
// Layouts verified against map_city00_00n.rel; draw path documented in the
// original-psobb-client-source decomp (headers/rendering.h, XJ mesh path).
//
// NJS_OBJECT (0x34): u32 eval_flags, u32 model, f32 pos[3], i32 ang[3] (BAMS,
//   0x10000 = 360 degrees), f32 scale[3], u32 child, u32 sibling
// XJ model (0x2C): u32 flags, u32 vertex_info, u32 vertex_info_count,
//   u32 opaque_strips, u32 opaque_count, u32 alpha_strips, u32 alpha_count,
//   f32 center[3], f32 radius
// Vertex info (0x10): u32 type, u32 vertices, u32 vertex_size, u32 vertex_count
// Strip list entry (0x14): u32 materials, u32 material_count, u32 indices,
//   u32 index_count, u32 unused. Indices are u16 triangle strips.
// Material (0x10): u32 type, u32 arg1, u32 arg2, u32 arg3. The type indexes the
//   client's 9-entry g_StandardRenderStateSetters table (read from PsoBB.exe at
//   0xa218c0): 0/1 no-op, 2 blend, 3 texture, 4 texture addressing,
//   5 material color, 6 lighting, 7 texture-coordinate generation (env map),
//   8 material color source.

import type { RelFile } from './rel.ts';

export const EVAL_UNIT_POS = 0x01;
export const EVAL_UNIT_ANG = 0x02;
export const EVAL_UNIT_SCL = 0x04;
export const EVAL_HIDE = 0x08;
export const EVAL_BREAK = 0x10;
export const EVAL_ZXY_ANG = 0x20;

export interface XjVertices {
  type: number;
  stride: number;
  count: number;
  positions: Float32Array;
  normals: Float32Array | null;
  colors: Float32Array | null; // RGBA 0..1
  uvs: Float32Array | null;
}

// Texture address modes (material type 4 args). The client maps them through the
// D3D enum table at 0xa21944 = [3, 2, 1, 1, ...]: 0 -> D3DTADDRESS_CLAMP,
// 1 -> MIRROR, 2 -> WRAP, 3 -> WRAP (index 3 already belongs to the blend part of
// the table). Map data agrees: UVs stay in [0, 1] for 98-100% of mode 0/3 strips
// and leave it for 97-99% of mode 1/2 strips.
export const XJ_ADDRESS_CLAMP = 0;
export const XJ_ADDRESS_MIRROR = 1;
export const XJ_ADDRESS_WRAP = 2;
export const XJ_ADDRESS_WRAP_3 = 3;

export interface XjMaterial {
  textureId: number; // -1 if none
  blendSrc: number;
  blendDst: number;
  addressU: number; // XJ_ADDRESS_*
  addressV: number;
  lighting: boolean;
  // Material type 5: D3DCOLOR (0xAARRGGBB; bytes B, G, R, A in the file).
  // The client uses diffuse as the constant vertex color of meshes without
  // per-vertex colors; ambient only reaches D3D when the material source is
  // switched to "material". 0xffffffff when never set.
  ambient: number;
  diffuse: number;
  // Material type 7: texture coordinates generated from camera space
  // (environment mapping) instead of the vertex UVs.
  envMap: boolean;
}

export const XJ_DEFAULT_MATERIAL: Readonly<XjMaterial> = {
  textureId: -1,
  blendSrc: 4,
  blendDst: 5,
  addressU: XJ_ADDRESS_WRAP, // D3D default; every map strip sets its own mode
  addressV: XJ_ADDRESS_WRAP,
  lighting: true,
  ambient: 0xffffffff,
  diffuse: 0xffffffff,
  envMap: false,
};

export interface XjStrip {
  material: XjMaterial;
  indices: Uint16Array; // triangle strip
  alpha: boolean;
}

export interface XjModel {
  vertices: XjVertices | null;
  strips: XjStrip[];
  center: [number, number, number];
  radius: number;
}

export interface NjObject {
  flags: number;
  model: XjModel | null;
  position: [number, number, number];
  rotation: [number, number, number]; // radians
  scale: [number, number, number];
  children: NjObject[];
}

const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

// Vertex layout by stride. Stride 24 is ambiguous (position+normal vs
// position+color+uv); the type field disambiguates. Observed in map n.rel:
// type 4/16 bytes, type 5/24 bytes, type 7/36 bytes.
function vertexLayout(type: number, stride: number): { normal: boolean; color: boolean; uv: boolean } {
  switch (stride) {
    case 12: return { normal: false, color: false, uv: false };
    case 16: return { normal: false, color: true, uv: false };
    case 20: return { normal: false, color: false, uv: true };
    case 24:
      return (type & 0xffff) === 5 ? { normal: false, color: true, uv: true } : { normal: true, color: false, uv: false };
    case 28: return { normal: true, color: true, uv: false };
    case 32: return { normal: true, color: false, uv: true };
    case 36: return { normal: true, color: true, uv: true };
    default: throw new Error(`unknown XJ vertex stride ${stride} (type ${type})`);
  }
}

function parseVertices(rel: RelFile, o: number): XjVertices {
  const type = rel.u32(o);
  const base = rel.ptr(o + 4);
  const stride = rel.u32(o + 8);
  const count = rel.u32(o + 12);
  const layout = vertexLayout(type, stride);
  const positions = new Float32Array(count * 3);
  const normals = layout.normal ? new Float32Array(count * 3) : null;
  const colors = layout.color ? new Float32Array(count * 4) : null;
  const uvs = layout.uv ? new Float32Array(count * 2) : null;
  for (let i = 0; i < count; i++) {
    let p = base + i * stride;
    positions[i * 3] = rel.f32(p);
    positions[i * 3 + 1] = rel.f32(p + 4);
    positions[i * 3 + 2] = rel.f32(p + 8);
    p += 12;
    if (normals) {
      normals[i * 3] = rel.f32(p);
      normals[i * 3 + 1] = rel.f32(p + 4);
      normals[i * 3 + 2] = rel.f32(p + 8);
      p += 12;
    }
    if (colors) {
      // D3DCOLOR: bytes B, G, R, A
      colors[i * 4] = rel.u8(p + 2) / 255;
      colors[i * 4 + 1] = rel.u8(p + 1) / 255;
      colors[i * 4 + 2] = rel.u8(p) / 255;
      colors[i * 4 + 3] = rel.u8(p + 3) / 255;
      p += 4;
    }
    if (uvs) {
      uvs[i * 2] = rel.f32(p);
      uvs[i * 2 + 1] = rel.f32(p + 4);
    }
  }
  return { type, stride, count, positions, normals, colors, uvs };
}

function parseStrips(rel: RelFile, o: number, count: number, alpha: boolean, state: XjMaterial): XjStrip[] {
  const strips: XjStrip[] = [];
  for (let i = 0; i < count; i++) {
    const e = o + i * 0x14;
    const mats = rel.ptr(e);
    const matCount = rel.u32(e + 4);
    const idx = rel.ptr(e + 8);
    const idxCount = rel.u32(e + 12);
    // Render state is sticky across strips: each strip only lists what changes.
    for (let m = 0; m < matCount; m++) {
      const mo = mats + m * 0x10;
      const kind = rel.u32(mo);
      const a1 = rel.u32(mo + 4);
      const a2 = rel.u32(mo + 8);
      if (kind === 2) {
        state.blendSrc = a1;
        state.blendDst = a2;
      } else if (kind === 3) {
        state.textureId = a1;
      } else if (kind === 4) {
        state.addressU = a1;
        state.addressV = a2;
      } else if (kind === 5) {
        state.ambient = a1;
        state.diffuse = a2;
      } else if (kind === 6) {
        state.lighting = a1 !== 0;
      } else if (kind === 7) {
        state.envMap = a1 !== 0;
      }
    }
    const indices = new Uint16Array(idxCount);
    for (let k = 0; k < idxCount; k++) indices[k] = rel.u16(idx + k * 2);
    strips.push({ material: { ...state }, indices, alpha });
  }
  return strips;
}

export function parseXjModel(rel: RelFile, o: number): XjModel {
  const viPtr = rel.ptr(o + 4);
  const viCount = rel.u32(o + 8);
  const state: XjMaterial = { ...XJ_DEFAULT_MATERIAL };
  const strips = [
    ...parseStrips(rel, rel.ptr(o + 0x0c), rel.u32(o + 0x10), false, state),
    ...parseStrips(rel, rel.ptr(o + 0x14), rel.u32(o + 0x18), true, state),
  ];
  return {
    vertices: viPtr && viCount ? parseVertices(rel, viPtr) : null,
    strips,
    center: [rel.f32(o + 0x1c), rel.f32(o + 0x20), rel.f32(o + 0x24)],
    radius: rel.f32(o + 0x28),
  };
}

export function parseNjObject(rel: RelFile, o: number, depth = 0): NjObject {
  if (depth > 256) throw new Error('NJS_OBJECT tree too deep');
  const modelPtr = rel.ptr(o + 4);
  const obj: NjObject = {
    flags: rel.u32(o),
    model: modelPtr ? parseXjModel(rel, modelPtr) : null,
    position: [rel.f32(o + 8), rel.f32(o + 0x0c), rel.f32(o + 0x10)],
    rotation: [rel.i32(o + 0x14) * BAMS_TO_RAD, rel.i32(o + 0x18) * BAMS_TO_RAD, rel.i32(o + 0x1c) * BAMS_TO_RAD],
    scale: [rel.f32(o + 0x20), rel.f32(o + 0x24), rel.f32(o + 0x28)],
    children: [],
  };
  // Children are a linked list: child, then the child's siblings.
  for (let c = rel.ptr(o + 0x2c); c; c = rel.ptr(c + 0x30)) obj.children.push(parseNjObject(rel, c, depth + 1));
  return obj;
}
