// Ninja motions (NJS_MOTION) as found in map n.rel animated entries.
// Layout checked against every animated entry of the Ephinea scene/*n.rel files.
//
// NJS_MOTION (0xC): u32 mdata, u32 frame_count, u16 type, u16 inp_fn
//   type: element bits, in storage order: 0x1 position, 0x2 angle (BAMS),
//     0x4 scale, ..., 0x2000 quaternion. Seen in maps: 0x3, 0x7, 0x2001.
//   inp_fn: low nibble = element count per node, 0x40 = spline interpolation
//     (linear otherwise). Seen in maps: 2, 3, 0x42, 0x43.
// mdata: one record per node of the object tree, in depth-first order (node,
//   its children, then its siblings). A record with N elements is N u32 key-list
//   pointers followed by N u32 key counts (NJS_MDATA2 = 0x10, NJS_MDATA3 = 0x18).
// Keys (0x10): u32 frame, then f32[3] position / i32[3] angle / f32[3] scale.

import type { RelFile } from './rel.ts';

export const MTYPE_POS = 0x1;
export const MTYPE_ANG = 0x2;
export const MTYPE_SCL = 0x4;
export const MTYPE_QUAT = 0x2000;
export const MINTERP_SPLINE = 0x40;

const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

export interface NjKey {
  frame: number;
  value: [number, number, number]; // angles already in radians
}

export interface NjNodeMotion {
  position: NjKey[] | null;
  rotation: NjKey[] | null;
  scale: NjKey[] | null;
  // Elements this decoder does not expand (e.g. quaternions): key counts only.
  other: Array<{ type: number; count: number }>;
}

export interface NjMotion {
  frameCount: number;
  type: number;
  spline: boolean;
  nodes: NjNodeMotion[];
}

function readKeys(rel: RelFile, p: number, n: number, angles: boolean): NjKey[] {
  const keys: NjKey[] = [];
  for (let i = 0; i < n; i++) {
    const k = p + i * 0x10;
    const value: [number, number, number] = angles
      ? [rel.i32(k + 4) * BAMS_TO_RAD, rel.i32(k + 8) * BAMS_TO_RAD, rel.i32(k + 12) * BAMS_TO_RAD]
      : [rel.f32(k + 4), rel.f32(k + 8), rel.f32(k + 12)];
    keys.push({ frame: rel.u32(k), value });
  }
  return keys;
}

// nodeCount: number of nodes in the animated NJS_OBJECT tree.
export function parseNjMotion(rel: RelFile, o: number, nodeCount: number): NjMotion {
  const mdata = rel.ptr(o);
  const frameCount = rel.u32(o + 4);
  const type = rel.u16(o + 8);
  const inp = rel.u16(o + 10);
  const elements = inp & 0xf;
  // Element types in storage order: the set bits of `type`, lowest first.
  const elemTypes: number[] = [];
  for (let bit = 1; bit <= 0x8000 && elemTypes.length < elements; bit <<= 1) if (type & bit) elemTypes.push(bit);
  if (elemTypes.length !== elements) throw new Error(`motion type 0x${type.toString(16)} does not have ${elements} elements`);

  const nodes: NjNodeMotion[] = [];
  for (let n = 0; mdata && n < nodeCount; n++) {
    const rec = mdata + n * elements * 8;
    const node: NjNodeMotion = { position: null, rotation: null, scale: null, other: [] };
    elemTypes.forEach((t, e) => {
      const keys = rel.ptr(rec + e * 4);
      const count = rel.u32(rec + (elements + e) * 4);
      if (!keys || !count) return;
      if (t === MTYPE_POS) node.position = readKeys(rel, keys, count, false);
      else if (t === MTYPE_ANG) node.rotation = readKeys(rel, keys, count, true);
      else if (t === MTYPE_SCL) node.scale = readKeys(rel, keys, count, false);
      else node.other.push({ type: t, count });
    });
    nodes.push(node);
  }
  return { frameCount, type, spline: (inp & MINTERP_SPLINE) !== 0, nodes };
}
