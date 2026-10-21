// Ninja chunk models (NJCM), the model format of PSO player characters
// (pl?nj.bml / pl????00.nj), enemies (bm_ene_*.bml) and many objects.
//
// Sources: the chunk type numbers and layouts follow the Sega Ninja SDK
// conventions (NJD_CV_* / NJD_CB_* / NJD_CM_* / NJD_CS_*), as also decoded by
// phantasmal-world (MIT) and the PSOv2 web client (dashgl/psov2); every layout
// below was checked against the Ephinea client's pl?nj.bml files.
//
// File: a sequence of IFF chunks {char tag[4]; u32 size; u8 data[size]}:
//   NJTL texture name list, NJCM model, POF0 pointer fixups (not needed: all
//   pointers are offsets from the start of the chunk's data), NMDM motion.
// NJCM data starts with the root NJS_OBJECT (0x34 bytes, same layout as the XJ
//   object tree, see xj.ts) whose model pointer targets an NJS_CNK_MODEL:
//   u32 vlist, u32 plist, f32 center[3], f32 radius
//
// Vertex chunk list (vlist), until a chunk of type 0xFF:
//   u8 type, u8 flags, u16 size (u32 words after this field),
//   u16 index_offset, u16 count, then count vertices.
//   Types 32..50 (NJD_CV_*): every vertex starts with f32 position[3]; 32 and
//   33 pad it to 4 floats. Then: 33 normal (4 floats); 34 nothing; 35 D8 color;
//   36 user flags; 37 Ninja flags; 38/39 16-bit diffuse+specular; 40 intensity;
//   41 normal; 42 normal+D8; 43 normal+UF; 44 normal+NF; 45..47 normal+16-bit
//   colors; 48 packed normal (10:10:10); 49 packed normal+D8; 50 packed normal+UF.
//   Ninja flags (NF) carry the skinning data: low 16 bits = vertex index
//   (added to index_offset), high 16 bits = weight (0..255). The chunk's
//   flags & 3 tell how the weighted vertex is accumulated into the shared
//   vertex buffer: 0 start (overwrite), 1 middle (add), 2 end (add).
//
// Polygon chunk list (plist), until a chunk of type 0xFF. Each chunk starts
//   with u8 type, u8 flags:
//   0      null
//   1      blend alpha: flags bits 3-5 = src factor, 0-2 = dst factor
//   2      mipmap 'D' adjust; 3 specular exponent
//   4      cache: the rest of this list is stored in cache slot `flags` and
//          drawn later by a type 5 chunk (often in another node, after the
//          vertices it needs were written)
//   5      draw cached list `flags`
//   8, 9   texture id: + u16 (bits 0-12 texture id); flags 0x80 flip U,
//          0x40 flip V, 0x20 clamp U, 0x10 clamp V
//   16..31 material: + u16 size (u16 words); blend factors in flags like type 1;
//          type bit 0 diffuse, bit 1 ambient, bit 2 specular (u32 BGRA each,
//          in that order)
//   56..58 volume: + u16 size (u16 words), skipped
//   64..75 strips: + u16 size (u16 words), u16 (bits 0-13 strip count,
//          bits 14-15 user-offset words per vertex). Per strip: i16 length
//          (negative = start with the opposite winding), then per vertex:
//          u16 index, [i16 u, v], [i16 normal[3]], [u32 color], and from the
//          third vertex on, the user-offset words. 64 plain, 65 UVN (uv/255),
//          66 UVH (uv/1023), 67-69 the same with normals, 70-72 with D8 color,
//          73-75 with two uv sets (only the first is used here).
//          Strip flags: 0x01 ignore light, 0x08 use alpha, 0x10 double sided,
//          0x40 environment map.

import { BAMS_TO_RAD } from './xj.ts';

export interface NjcmVertexChunk {
  type: number;
  flags: number;
  indexOffset: number;
  // Per vertex: destination index in the shared vertex buffer.
  indices: Uint16Array;
  positions: Float32Array;
  normals: Float32Array | null;
  colors: Float32Array | null; // RGBA 0..1
  // Skinning weight 0..1 (only for NF chunks, else null = weight 1).
  weights: Float32Array | null;
}

export interface NjcmStrip {
  indices: number[]; // vertex buffer indices, in strip order
  uvs: number[] | null; // 2 per vertex
  colors: number[] | null; // RGBA per vertex
  flipped: boolean; // negative length: first triangle has reversed winding
}

export type NjcmPolyOp =
  | { op: 'blend'; src: number; dst: number }
  | { op: 'texture'; id: number; flags: number }
  | { op: 'material'; src: number; dst: number; diffuse: number | null; ambient: number | null; specular: number | null }
  | { op: 'strips'; type: number; flags: number; strips: NjcmStrip[] }
  | { op: 'cache'; slot: number }
  | { op: 'draw'; slot: number }
  | { op: 'unknown'; type: number };

export interface NjcmModel {
  vertices: NjcmVertexChunk[];
  polys: NjcmPolyOp[];
  center: [number, number, number];
  radius: number;
}

export interface NjcmObject {
  flags: number;
  model: NjcmModel | null;
  position: [number, number, number];
  rotation: [number, number, number]; // radians
  scale: [number, number, number];
  children: NjcmObject[];
}

export interface NinjaChunkFile {
  object: NjcmObject | null;
  textureNames: string[];
}

class Reader {
  readonly data: Uint8Array;
  readonly dv: DataView;
  constructor(data: Uint8Array) {
    this.data = data;
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  check(o: number, n: number): void {
    if (o < 0 || o + n > this.data.length) throw new Error(`NJCM read 0x${o.toString(16)}+${n} out of range`);
  }
  u8(o: number): number {
    this.check(o, 1);
    return this.data[o];
  }
  u16(o: number): number {
    this.check(o, 2);
    return this.dv.getUint16(o, true);
  }
  i16(o: number): number {
    this.check(o, 2);
    return this.dv.getInt16(o, true);
  }
  u32(o: number): number {
    this.check(o, 4);
    return this.dv.getUint32(o, true);
  }
  i32(o: number): number {
    this.check(o, 4);
    return this.dv.getInt32(o, true);
  }
  f32(o: number): number {
    this.check(o, 4);
    return this.dv.getFloat32(o, true);
  }
  ptr(o: number): number {
    const p = this.u32(o);
    if (p >= this.data.length) throw new Error(`NJCM pointer 0x${p.toString(16)} at 0x${o.toString(16)} out of range`);
    return p;
  }
}

// D3D-style BGRA u32 to RGBA floats.
function bgra(r: Reader, o: number, out: Float32Array | number[], i: number): void {
  out[i] = r.u8(o + 2) / 255;
  out[i + 1] = r.u8(o + 1) / 255;
  out[i + 2] = r.u8(o) / 255;
  out[i + 3] = r.u8(o + 3) / 255;
}

function parseVertexChunk(r: Reader, o: number, type: number, flags: number): NjcmVertexChunk {
  const indexOffset = r.u16(o + 4);
  const count = r.u16(o + 6);
  const size = r.u16(o + 2) * 4 + 4; // bytes from o
  // Bytes per vertex, and what follows the position.
  let stride: number;
  let normal: 'none' | 'f3' | 'f4' | 'packed' = 'none';
  let extra: 'none' | 'd8' | 'nf' | 'u32' = 'none';
  switch (type) {
    case 32: stride = 16; break;
    case 33: stride = 32; normal = 'f4'; break;
    case 34: stride = 12; break;
    case 35: stride = 16; extra = 'd8'; break;
    case 36: case 38: case 39: case 40: stride = 16; extra = 'u32'; break;
    case 37: stride = 16; extra = 'nf'; break;
    case 41: stride = 24; normal = 'f3'; break;
    case 42: stride = 28; normal = 'f3'; extra = 'd8'; break;
    case 43: case 45: case 46: case 47: stride = 28; normal = 'f3'; extra = 'u32'; break;
    case 44: stride = 28; normal = 'f3'; extra = 'nf'; break;
    case 48: stride = 16; normal = 'packed'; break;
    case 49: stride = 20; normal = 'packed'; extra = 'd8'; break;
    case 50: stride = 20; normal = 'packed'; extra = 'u32'; break;
    default: throw new Error(`unknown NJCM vertex chunk type ${type}`);
  }
  if (8 + count * stride > size) throw new Error(`NJCM vertex chunk type ${type} too small for ${count} vertices`);
  const indices = new Uint16Array(count);
  const positions = new Float32Array(count * 3);
  const normals = normal !== 'none' ? new Float32Array(count * 3) : null;
  const colors = extra === 'd8' ? new Float32Array(count * 4) : null;
  const weights = extra === 'nf' ? new Float32Array(count) : null;
  for (let i = 0; i < count; i++) {
    let p = o + 8 + i * stride;
    positions[i * 3] = r.f32(p);
    positions[i * 3 + 1] = r.f32(p + 4);
    positions[i * 3 + 2] = r.f32(p + 8);
    p += type === 32 || type === 33 ? 16 : 12;
    if (normals) {
      if (normal === 'packed') {
        // 10:10:10 signed, x in the high bits (NJD_CV_VNX).
        const v = r.u32(p);
        const s10 = (x: number) => ((x & 0x3ff) << 22 >> 22) / 511;
        normals[i * 3] = s10(v >>> 20);
        normals[i * 3 + 1] = s10(v >>> 10);
        normals[i * 3 + 2] = s10(v);
        p += 4;
      } else {
        normals[i * 3] = r.f32(p);
        normals[i * 3 + 1] = r.f32(p + 4);
        normals[i * 3 + 2] = r.f32(p + 8);
        p += normal === 'f4' ? 16 : 12;
      }
    }
    indices[i] = indexOffset + i;
    if (colors) bgra(r, p, colors, i * 4);
    if (weights) {
      const nf = r.u32(p);
      indices[i] = indexOffset + (nf & 0xffff);
      weights[i] = (nf >>> 16) / 255;
    }
  }
  return { type, flags, indexOffset, indices, positions, normals, colors, weights };
}

function parseVertexList(r: Reader, o: number): NjcmVertexChunk[] {
  const out: NjcmVertexChunk[] = [];
  for (let guard = 0; guard < 0x10000; guard++) {
    const type = r.u8(o);
    const flags = r.u8(o + 1);
    if (type === 0xff) return out;
    if (type < 32 || type > 50) throw new Error(`unexpected NJCM vertex chunk type ${type} at 0x${o.toString(16)}`);
    out.push(parseVertexChunk(r, o, type, flags));
    o += 4 + r.u16(o + 2) * 4;
  }
  throw new Error('NJCM vertex list not terminated');
}

function parseStrips(r: Reader, o: number, type: number): NjcmStrip[] {
  const header = r.u16(o + 4);
  const count = header & 0x3fff;
  const userWords = header >> 14;
  const kind = (type - 64) % 3; // 0 none, 1 UVN, 2 UVH
  const group = Math.floor((type - 64) / 3); // 0 plain, 1 normals, 2 color, 3 two uv sets
  const hasUv = kind !== 0;
  const uvScale = kind === 1 ? 255 : 1023;
  const hasNormal = group === 1;
  const hasColor = group === 2;
  const uvSets = group === 3 && hasUv ? 2 : 1;
  const strips: NjcmStrip[] = [];
  let p = o + 6;
  for (let s = 0; s < count; s++) {
    const len = r.i16(p);
    p += 2;
    const n = Math.abs(len);
    const strip: NjcmStrip = { indices: [], uvs: hasUv ? [] : null, colors: hasColor ? [] : null, flipped: len < 0 };
    for (let v = 0; v < n; v++) {
      strip.indices.push(r.u16(p));
      p += 2;
      if (hasUv) {
        strip.uvs!.push(r.i16(p) / uvScale, r.i16(p + 2) / uvScale);
        p += 4 * uvSets;
      }
      if (hasNormal) p += 6;
      if (hasColor) {
        bgra(r, p, strip.colors!, strip.colors!.length);
        p += 4;
      }
      if (v >= 2) p += userWords * 2;
    }
    strips.push(strip);
  }
  return strips;
}

function parsePolyList(r: Reader, o: number): NjcmPolyOp[] {
  const out: NjcmPolyOp[] = [];
  const start = o;
  for (let guard = 0; guard < 0x10000; guard++) {
    const type = r.u8(o);
    const flags = r.u8(o + 1);
    if (type === 0xff) return out;
    if (type === 0) {
      o += 2;
    } else if (type <= 7) {
      if (type === 1) out.push({ op: 'blend', src: (flags >> 3) & 7, dst: flags & 7 });
      else if (type === 4) out.push({ op: 'cache', slot: flags });
      else if (type === 5) out.push({ op: 'draw', slot: flags });
      o += 2;
    } else if (type <= 15) {
      if (type === 8 || type === 9) out.push({ op: 'texture', id: r.u16(o + 2) & 0x1fff, flags });
      o += 4;
    } else if (type <= 31) {
      let p = o + 4;
      const color = (bit: number): number | null => {
        if (!(type & bit)) return null;
        const v = r.u32(p);
        p += 4;
        return v;
      };
      const diffuse = color(1);
      const ambient = color(2);
      const specular = color(4);
      out.push({ op: 'material', src: (flags >> 3) & 7, dst: flags & 7, diffuse, ambient, specular });
      o += 4 + r.u16(o + 2) * 2;
    } else if (type >= 56 && type <= 58) {
      o += 4 + r.u16(o + 2) * 2;
    } else if (type >= 64 && type <= 75) {
      out.push({ op: 'strips', type, flags, strips: parseStrips(r, o, type) });
      o += 4 + r.u16(o + 2) * 2;
    } else if (type < 0xc0) {
      // Not a Ninja SDK type, but laid out like one with a size field (seen:
      // 89 in the extra-character bodies plO..plRbdy00.nj inside pl?nj.bml).
      out.push({ op: 'unknown', type });
      o += 4 + r.u16(o + 2) * 2;
    } else {
      throw new Error(`unknown NJCM polygon chunk type ${type} at 0x${o.toString(16)} (list at 0x${start.toString(16)})`);
    }
  }
  throw new Error('NJCM polygon list not terminated');
}

// Vertex-buffer models (the weapon and item models of ItemModel.afs). The
// model is the exe's njcm_mesh (0x1C bytes) at the object's +4, and it is the
// PC-baked form of a Ninja model: vertices and strips are already laid out for
// the D3D vertex and index buffers (LoadItemAsset / prepare_mesh_buffers):
//   +0x00 u32 vlist (0 in every item model; a classic model when not 0)
//   +0x04 u32 vertex buffer list: njcm_vertex_buffer records of 0x10 bytes
//         {u32 vertex_format, u32 data, u32 vertex_size, u32 vertex_count}
//   +0x08 u32 vertex buffer count
//   +0x0C u32 alpha index buffer table, +0x10 its count
//   +0x14 u32 opaque index buffer table, +0x18 its count
// Index buffer record (0x14 bytes): u32 renderargs, u32 renderargs count,
//   u32 indices (u16 triangle strip), u32 index count, u32 vertex buffer index.
// renderargs record (0x10 bytes, nrel_mesh_renderargs): u32 setter, i32 arg1,
//   i32 arg2, i32 arg3. Setters of g_StandardRenderStateSetters (0x00A218C0):
//   2 blend (arg1 src, arg2 dst, Ninja factors), 3 texture (arg1 = NJTL index),
//   4 texture addressing, 5 material, 6 lighting (arg1 bool), 7 transform,
//   8 material source. The alpha table is drawn with alpha blending.
// Vertex formats: 7 = 36 bytes {f32 position[3], f32 normal[3], u32 diffuse
// (BGRA), f32 u, v}; 6 = 28 bytes, the same without the uv.
const VB_FORMAT_UV = 7;
const VB_FORMAT_PLAIN = 6;
const VB_STRIDE: Record<number, number> = { [VB_FORMAT_UV]: 0x24, [VB_FORMAT_PLAIN]: 0x1c };
const VB_INDEX_RECORD = 0x14;
const VB_RENDERARG_RECORD = 0x10;
const SETTER_BLEND = 2;
const SETTER_TEXTURE = 3;
const SETTER_LIGHTING = 6;
// Strip flags (NJD_FST_*) the mesh builder reads.
const STRIP_IGNORE_LIGHT = 0x01;
const STRIP_USE_ALPHA = 0x08;

// Reads a u32 or -1 when the offset is outside the chunk (for probing).
function probeU32(r: Reader, o: number): number {
  return o >= 0 && o + 4 <= r.data.length ? r.dv.getUint32(o, true) : -1;
}

// True when the model at `o` is a vertex-buffer model: no classic vertex list,
// and the first vertex buffer record has a known format and stride.
function isVertexBufferModel(r: Reader, o: number): boolean {
  if (probeU32(r, o) !== 0) return false;
  const list = probeU32(r, o + 4);
  const count = probeU32(r, o + 8);
  if (list <= 0 || count < 1 || count > 8) return false;
  const format = probeU32(r, list) & 0xffff;
  const stride = VB_STRIDE[format];
  return stride !== undefined && probeU32(r, list + 8) === stride && probeU32(r, list + 12) > 0;
}

function parseVertexBufferModel(r: Reader, o: number): NjcmModel {
  const list = r.ptr(o + 4);
  const count = r.u32(o + 8);
  const chunks: NjcmVertexChunk[] = [];
  const bases: number[] = [];
  const uvs: Float32Array[] = []; // per vertex buffer, 2 per vertex
  const polys: NjcmPolyOp[] = [];
  let total = 0;
  for (let b = 0; b < count; b++) {
    const h = list + b * 16;
    // The format's high half is a flag word (entry 1: 0x10006 is format 6).
    const format = r.u32(h) & 0xffff;
    const data = r.ptr(h + 4);
    const size = r.u32(h + 8);
    const n = r.u32(h + 12);
    if (VB_STRIDE[format] !== size) throw new Error(`NJCM vertex buffer ${b}: format ${format} with size ${size}`);
    r.check(data, n * size);
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    const colors = new Float32Array(n * 4);
    const uv = new Float32Array(n * 2);
    const indices = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const p = data + i * size;
      for (let k = 0; k < 3; k++) {
        positions[i * 3 + k] = r.f32(p + k * 4);
        normals[i * 3 + k] = r.f32(p + 12 + k * 4);
      }
      bgra(r, p + 24, colors, i * 4);
      if (format === VB_FORMAT_UV) {
        uv[i * 2] = r.f32(p + 28);
        uv[i * 2 + 1] = r.f32(p + 32);
      }
      indices[i] = total + i;
    }
    bases.push(total);
    uvs.push(uv);
    chunks.push({ type: format, flags: 0, indexOffset: total, indices, positions, normals, colors, weights: null });
    total += n;
  }

  const emitTable = (table: number, tableCount: number, alpha: boolean): void => {
    for (let e = 0; e < tableCount; e++) {
      const entry = table + e * VB_INDEX_RECORD;
      const args = r.ptr(entry);
      const argCount = r.u32(entry + 4);
      const indexData = r.ptr(entry + 8);
      const indexCount = r.u32(entry + 12);
      const vb = r.u32(entry + 16);
      if (vb >= count) throw new Error(`NJCM index buffer ${e}: vertex buffer ${vb} of ${count}`);
      let blend: NjcmPolyOp = { op: 'blend', src: 1, dst: 0 };
      let texId = -1;
      let lit = true;
      for (let a = 0; a < argCount; a++) {
        const rec = args + a * VB_RENDERARG_RECORD;
        const setter = r.u32(rec);
        const arg1 = r.i32(rec + 4);
        if (setter === SETTER_BLEND) blend = { op: 'blend', src: arg1, dst: r.i32(rec + 8) };
        else if (setter === SETTER_TEXTURE) texId = arg1;
        else if (setter === SETTER_LIGHTING) lit = arg1 !== 0;
      }
      const strip: NjcmStrip = { indices: [], uvs: [], colors: null, flipped: false };
      for (let i = 0; i < indexCount; i++) {
        const local = r.u16(indexData + i * 2);
        if (local >= chunks[vb].indices.length) throw new Error(`NJCM index ${local} outside vertex buffer ${vb}`);
        const v = bases[vb] + local;
        strip.indices.push(v);
        strip.uvs!.push(uvs[vb][local * 2], uvs[vb][local * 2 + 1]);
      }
      polys.push(blend);
      polys.push({ op: 'texture', id: texId, flags: 0 });
      polys.push({ op: 'strips', type: 64, flags: (alpha ? STRIP_USE_ALPHA : 0) | (lit ? 0 : STRIP_IGNORE_LIGHT), strips: [strip] });
    }
  };
  // Opaque geometry first (the exe draws it in its own pass), then alpha.
  emitTable(r.ptr(o + 0x14), r.u32(o + 0x18), false);
  emitTable(r.ptr(o + 0x0c), r.u32(o + 0x10), true);

  // Bounding sphere of the vertices (the record's center and radius are not
  // stored in this layout).
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of chunks) {
    for (let i = 0; i < c.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], c.positions[i + k]);
        max[k] = Math.max(max[k], c.positions[i + k]);
      }
    }
  }
  const center: [number, number, number] = total ? [0, 1, 2].map((k) => (min[k] + max[k]) / 2) as [number, number, number] : [0, 0, 0];
  let radius = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.positions.length; i += 3) {
      const d = Math.hypot(c.positions[i] - center[0], c.positions[i + 1] - center[1], c.positions[i + 2] - center[2]);
      radius = Math.max(radius, d);
    }
  }
  return { vertices: chunks, polys, center, radius };
}

function parseModel(r: Reader, o: number): NjcmModel {
  if (isVertexBufferModel(r, o)) return parseVertexBufferModel(r, o);
  const vlist = r.ptr(o);
  const plist = r.ptr(o + 4);
  return {
    vertices: vlist ? parseVertexList(r, vlist) : [],
    polys: plist ? parsePolyList(r, plist) : [],
    center: [r.f32(o + 8), r.f32(o + 12), r.f32(o + 16)],
    radius: r.f32(o + 20),
  };
}

function parseObject(r: Reader, o: number, depth: number): NjcmObject {
  if (depth > 256) throw new Error('NJCM object tree too deep');
  const modelPtr = r.ptr(o + 4);
  const obj: NjcmObject = {
    flags: r.u32(o),
    model: modelPtr ? parseModel(r, modelPtr) : null,
    position: [r.f32(o + 8), r.f32(o + 0x0c), r.f32(o + 0x10)],
    rotation: [r.i32(o + 0x14) * BAMS_TO_RAD, r.i32(o + 0x18) * BAMS_TO_RAD, r.i32(o + 0x1c) * BAMS_TO_RAD],
    scale: [r.f32(o + 0x20), r.f32(o + 0x24), r.f32(o + 0x28)],
    children: [],
  };
  for (let c = r.ptr(o + 0x2c); c; c = r.ptr(c + 0x30)) obj.children.push(parseObject(r, c, depth + 1));
  return obj;
}

// Parses the object tree of an NJCM chunk's data (root object at offset 0).
export function parseNjcmObject(data: Uint8Array, offset = 0): NjcmObject {
  return parseObject(new Reader(data), offset, 0);
}

// Parses one NJS_CNK_MODEL at `offset` (a model without an object, e.g. the
// rooms of a map_*r.rel minimap, formats/minimap.ts).
export function parseNjcmModel(data: Uint8Array, offset: number): NjcmModel {
  return parseModel(new Reader(data), offset);
}

// NJTL data: u32 names_offset, u32 count; entry (0x0C): u32 name, u32, u32.
export function parseNjtl(data: Uint8Array): string[] {
  const r = new Reader(data);
  const list = r.ptr(0);
  const count = r.u32(4);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    let p = r.ptr(list + i * 12);
    let s = '';
    while (p < data.length && data[p]) s += String.fromCharCode(data[p++]);
    names.push(s);
  }
  return names;
}

// Walks the IFF chunks of a .nj file (or BML entry) and parses the first
// NJCM model and NJTL texture list.
export function parseNinjaChunkFile(data: Uint8Array): NinjaChunkFile {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: NinjaChunkFile = { object: null, textureNames: [] };
  for (let o = 0; o + 8 <= data.length; ) {
    const tag = String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);
    const size = dv.getUint32(o + 4, true);
    if (o + 8 + size > data.length) throw new Error(`Ninja chunk ${tag} extends beyond end of file`);
    const body = data.subarray(o + 8, o + 8 + size);
    if (tag === 'NJCM' && !out.object) out.object = parseNjcmObject(body);
    else if (tag === 'NJTL' && !out.textureNames.length) out.textureNames = parseNjtl(body);
    o += 8 + size;
  }
  if (!out.object) throw new Error('no NJCM chunk found');
  return out;
}
