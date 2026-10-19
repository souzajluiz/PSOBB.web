// Ninja shape motions (.njs, NSSM chunk): per-node vertex (and normal)
// keyframes that replace a chunk model's vertex positions while it is drawn.
// Seven BML entries of the Ephinea data.gsl carry one: Vol Opt's seal door
// (fe_obj_fuuin_doa.njs), the Seabed jellyfish (fs_obj_kurage.njs), three
// Episode 4 plants and an Episode 4 enemy body (move_ / wait_bm4_ps_mb_body).
//
// File: an NSSM chunk whose body is an NJS_MOTION (pointers relative to the
// body, as in .njm files, see njmotion.ts):
//   u32 mdata, u32 frame_count, u16 type, u16 inp_fn
//   type: 0x10 vertices, 0x20 normals (every file here: 0x30, inp_fn 2).
// mdata: one record per node of the object tree in depth-first order, except
//   nodes with eval flag 0x80 (NJD_EVAL_SHAPE_SKIP), which take none: N u32
//   key-list pointers then N u32 key counts, N = inp_fn & 0x3f. The vertex
//   list comes first when type has 0x10, then the normal list when it has 0x20.
// Key (8 bytes): u32 frame, u32 pointer to an array of f32[3], one per vertex
//   of the node's vertex chunks, in chunk order.
//
// The exe (Ephinea PsoBB.exe) draws one with NJCM_SetMinimapRenderStates_008304e0
// (= njDrawShapeMotion: object, motion, shape, frame) -> NJCM_RenderModelRecursive_0084785c:
// NJCM_SetMinimapMeshData_00830508 starts at mdata with the frame, type and
// N = inp_fn & 0xffffff3f (MinimapMeshContext_InitBuffers_00847830); every node
// without flag 0x80 takes the next record (NJCM_FinishMeshContext_00830568 /
// NJCM_RenderMeshContext_00830558), and a node with a mesh gets its vertex
// chunks rewritten by NJCM_BeginMinimapMeshContext_008473ec /
// NJM_InterpolateKeyframes_008474b8. That writes positions only for vertex
// chunk types 0x22..0x24 and 0x29..0x2c (the key arrays run on across the
// node's chunks; the other types keep theirs), and normals for 0x29..0x2c.
// Keys are picked by NJM_FindKeyframeInterval_0084ae50 (see sampleShapeKeys).

import { RelFile } from './rel.ts';

export const SHAPE_VERTICES = 0x10;
export const SHAPE_NORMALS = 0x20;
export const EVAL_SHAPE_SKIP = 0x80;

// Vertex chunk types whose positions the shape motion replaces
// (NJM_InterpolateKeyframes_008474b8), and those whose normals it replaces.
export const SHAPE_POSITION_TYPES: ReadonlySet<number> = new Set([0x22, 0x23, 0x24, 0x29, 0x2a, 0x2b, 0x2c]);
export const SHAPE_NORMAL_TYPES: ReadonlySet<number> = new Set([0x29, 0x2a, 0x2b, 0x2c]);

export interface NjShapeKey {
  frame: number;
  values: Float32Array; // x, y, z per vertex
}

export interface NjShapeNode {
  vertices: NjShapeKey[] | null;
  normals: NjShapeKey[] | null;
}

export interface NjShapeMotion {
  frameCount: number;
  type: number;
  // Per node of the tree, depth first (null for nodes with flag 0x80).
  nodes: (NjShapeNode | null)[];
}

// What the parser needs to know of each node, depth first: its eval flags and
// how many vertices its key arrays hold (shapeVertexCount of its model).
export interface NjShapeNodeInput {
  flags: number;
  vertices: number;
  normals: number;
}

// Vertices a key array holds for a model's vertex chunks: the vertices of the
// chunks whose positions (normals) the exe replaces.
export function shapeVertexCount(chunks: readonly { type: number; indices: ArrayLike<number> }[], what: 'vertices' | 'normals'): number {
  const types = what === 'vertices' ? SHAPE_POSITION_TYPES : SHAPE_NORMAL_TYPES;
  let n = 0;
  for (const c of chunks) if (types.has(c.type)) n += c.indices.length;
  return n;
}

function readKeys(rel: RelFile, p: number, count: number, values: number): NjShapeKey[] {
  if (p + count * 8 > rel.data.length) throw new Error(`shape keys at 0x${p.toString(16)} (${count}) out of range`);
  const keys: NjShapeKey[] = [];
  for (let i = 0; i < count; i++) {
    const frame = rel.u32(p + i * 8);
    const a = rel.u32(p + i * 8 + 4);
    if (a + values * 12 > rel.data.length) throw new Error(`shape key ${i} at 0x${a.toString(16)}: ${values} vertices out of range`);
    const v = new Float32Array(values * 3);
    for (let k = 0; k < values * 3; k++) v[k] = rel.f32(a + k * 4);
    keys.push({ frame, values: v });
  }
  return keys;
}

export function parseNjShapeMotion(rel: RelFile, o: number, nodes: readonly NjShapeNodeInput[]): NjShapeMotion {
  let rec = rel.u32(o);
  const frameCount = rel.u32(o + 4);
  const type = rel.u16(o + 8);
  const factors = rel.u16(o + 10) & 0x3f;
  const lists = (type & SHAPE_VERTICES ? 1 : 0) + (type & SHAPE_NORMALS ? 1 : 0);
  if (factors < lists) throw new Error(`shape motion type 0x${type.toString(16)} with ${factors} lists per node`);
  const out: (NjShapeNode | null)[] = [];
  for (const n of nodes) {
    if (n.flags & EVAL_SHAPE_SKIP) {
      out.push(null);
      continue;
    }
    if (rec + factors * 8 > rel.data.length) throw new Error(`shape record at 0x${rec.toString(16)} out of range`);
    let i = 0;
    const list = (values: number): NjShapeKey[] | null => {
      const p = rel.u32(rec + i * 4);
      const count = rel.u32(rec + (factors + i) * 4);
      i++;
      // A pointer of 0 is a missing list (the exe tests the relocated pointer;
      // every key list here starts after the records, so 0 is never a list).
      return p && count ? readKeys(rel, p, count, values) : null;
    };
    const vertices = type & SHAPE_VERTICES ? list(n.vertices) : null;
    const normals = type & SHAPE_NORMALS ? list(n.normals) : null;
    out.push({ vertices, normals });
    rec += factors * 8;
  }
  return { frameCount, type, nodes: out };
}

// Standalone shape motion file (.njs, a BML entry): an NSSM chunk.
export function parseNjsFile(data: Uint8Array, nodes: readonly NjShapeNodeInput[]): NjShapeMotion {
  const rel = RelFile.chunk(data, 'NSSM');
  if (!rel) throw new Error('no NSSM chunk found');
  return parseNjShapeMotion(rel, 0, nodes);
}

// NJM_FindKeyframeInterval_0084ae50 + NJM_InterpolateKeyframes_008474b8:
// the frame truncated to an integer picks key A, the last key whose frame is
// not above it (binary search), and B, the key after A or, past the last key,
// the first key. t = (frame - A) / (B - A) with the frame as a float, or
// frame - A when B is not after A (past the last key: one frame towards the
// first key). Each value is B * t + A * (1 - t).
export function sampleShapeKeys(keys: readonly NjShapeKey[], frame: number, out: Float32Array): Float32Array {
  const n = keys.length;
  const f = Math.trunc(frame);
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (f < keys[mid].frame) hi = mid;
    else lo = mid;
  }
  const a = keys[lo];
  const b = lo < n - 1 ? keys[lo + 1] : keys[0];
  const span = b.frame - a.frame;
  const t = span > 0 ? (frame - a.frame) / span : frame - a.frame;
  const s = 1 - t;
  const len = Math.min(out.length, a.values.length, b.values.length);
  for (let i = 0; i < len; i++) out[i] = b.values[i] * t + a.values[i] * s;
  return out;
}
