// Ninja motions (NJS_MOTION): map n.rel animated entries and the player
// motions of plymotiondata.rlc.
// Layout checked against every animated entry of the Ephinea scene/*n.rel files
// and every entry of plymotiondata.rlc.
//
// NJS_MOTION (0xC): u32 mdata, u32 frame_count, u16 type, u16 inp_fn
//   type: element bits, in storage order: 0x1 position, 0x2 angle (BAMS),
//     0x4 scale, ..., 0x2000 quaternion. Seen in maps: 0x3, 0x7, 0x2001;
//     player motions: always 0x3.
//   inp_fn: low nibble = element count per node, 0x40 = spline interpolation
//     (linear otherwise), 0x80 = user function (the player motion code sets
//     it at run time). Seen in maps: 2, 3, 0x42, 0x43; player motions: 2.
// mdata: one record per node of the object tree, in depth-first order (node,
//   its children, then its siblings). A record with N elements is N u32 key-list
//   pointers followed by N u32 key counts (NJS_MDATA2 = 0x10, NJS_MDATA3 = 0x18).
//   A list is present when its count is non-zero: in a REL file a key list can
//   start at offset 0, so its (unrelocated) pointer reads as 0.
// Keys:
//   position / scale (0x10): u32 frame, f32[3]
//   angle, long form (0x10, maps): u32 frame, i32[3] BAMS
//   angle, short form (8, player motions): u16 frame, i16[3] BAMS
//     (NJS_MKEY_SA). The motion header does not say which one is used; the
//     caller knows (the player motion data is only ever read as short keys).

import { RelFile } from './rel.ts';

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

export interface NjQuatKey {
  frame: number;
  value: [number, number, number, number]; // as stored (see readQuatKeys)
}

export interface NjNodeMotion {
  position: NjKey[] | null;
  rotation: NjKey[] | null;
  scale: NjKey[] | null;
  quaternion: NjQuatKey[] | null;
  // Elements this decoder does not expand: key counts only.
  other: Array<{ type: number; count: number }>;
}

export interface NjMotion {
  frameCount: number;
  type: number;
  spline: boolean;
  // Angle keys were NJS_MKEY_SA: 16-bit BAMS, interpolated along the shortest
  // way round (16-bit wrap-around arithmetic).
  shortAngles: boolean;
  nodes: NjNodeMotion[];
}

export interface NjMotionOptions {
  // Angle keys are NJS_MKEY_SA (8 bytes, i16 angles) instead of 16-byte keys.
  shortAngles?: boolean;
}

// Motions whose NJS_MOTION got the user-function bit (inp_fn |= 0x80) at run
// time: the exe's Enemy__SetNjmFactorFlag (`current_njm->wUnk_0x0a |= 0x80`),
// called when the animation record has 0x20000000 (player and NPC motion
// code, Enemy__InitAnimation and Player__StartNpcAnimation). The NJM evaluator
// then takes the position interpolator FUN_00842d7c from table 0x00a2271c
// (index 2), which keeps X and Y and sets Z to 0.0 (NJM_InitializeAnimationContext
// 0x008303dc). The bit is never cleared, and the motion object is shared per
// archive entry, so the mark is per object (render/playeranim.ts, the NPC walk
// in render/npcview.ts, FLAG_ROOT_Z_OFF).
const rootZOff = new WeakSet<NjMotion>();
export function markRootZOff(m: NjMotion): void {
  rootZOff.add(m);
}
export function hasRootZOff(m: NjMotion): boolean {
  return rootZOff.has(m);
}

// Quaternion keys (0x14): u32 frame, f32[4].
function readQuatKeys(rel: RelFile, p: number, n: number): NjQuatKey[] {
  if (p + n * 0x14 > rel.data.length) throw new Error(`quaternion keys at 0x${p.toString(16)} (${n}) out of range`);
  const keys: NjQuatKey[] = [];
  for (let i = 0; i < n; i++) {
    const k = p + i * 0x14;
    const frame = rel.u32(k);
    if (keys.length && frame <= keys[keys.length - 1].frame) break;
    keys.push({ frame, value: [rel.f32(k + 4), rel.f32(k + 8), rel.f32(k + 12), rel.f32(k + 16)] });
  }
  return keys;
}

function readKeys(rel: RelFile, p: number, n: number, kind: 'vec' | 'ang' | 'sang'): NjKey[] {
  const keys: NjKey[] = [];
  const size = kind === 'sang' ? 8 : 0x10;
  if (p + n * size > rel.data.length) throw new Error(`motion keys at 0x${p.toString(16)} (${n}) out of range`);
  for (let i = 0; i < n; i++) {
    const k = p + i * size;
    // A few lists claim more keys than they hold and run into the next list
    // (plymotiondata.rlc entry 20); stop at the first frame that goes back.
    const frame = kind === 'sang' ? rel.u16(k) : rel.u32(k);
    if (keys.length && frame <= keys[keys.length - 1].frame) break;
    if (kind === 'sang') {
      const a = (o: number) => rel.dv.getInt16(k + o, true) * BAMS_TO_RAD;
      keys.push({ frame: rel.u16(k), value: [a(2), a(4), a(6)] });
    } else if (kind === 'ang') {
      keys.push({ frame: rel.u32(k), value: [rel.i32(k + 4) * BAMS_TO_RAD, rel.i32(k + 8) * BAMS_TO_RAD, rel.i32(k + 12) * BAMS_TO_RAD] });
    } else {
      keys.push({ frame: rel.u32(k), value: [rel.f32(k + 4), rel.f32(k + 8), rel.f32(k + 12)] });
    }
  }
  return keys;
}

// nodeCount: number of nodes in the animated NJS_OBJECT tree.
export function parseNjMotion(rel: RelFile, o: number, nodeCount: number, opts: NjMotionOptions = {}): NjMotion {
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
  for (let n = 0; n < nodeCount; n++) {
    const rec = mdata + n * elements * 8;
    const node: NjNodeMotion = { position: null, rotation: null, scale: null, quaternion: null, other: [] };
    elemTypes.forEach((t, e) => {
      const count = rel.u32(rec + (elements + e) * 4);
      if (!count) return;
      const keys = rel.ptr(rec + e * 4);
      if (t === MTYPE_POS) node.position = readKeys(rel, keys, count, 'vec');
      else if (t === MTYPE_ANG) node.rotation = readKeys(rel, keys, count, opts.shortAngles ? 'sang' : 'ang');
      else if (t === MTYPE_SCL) node.scale = readKeys(rel, keys, count, 'vec');
      else if (t === MTYPE_QUAT) node.quaternion = readQuatKeys(rel, keys, count);
      else node.other.push({ type: t, count });
    });
    nodes.push(node);
  }
  return { frameCount, type, spline: (inp & MINTERP_SPLINE) !== 0, shortAngles: !!opts.shortAngles, nodes };
}

// Value of a key track at `frame` (0 <= frame < frameCount). Linear
// interpolation between keys; past the last key the track runs back to the
// first key at frameCount, so looping motions close up. Spline motions
// (inp_fn 0x40) are evaluated linearly too (none of the player motions use it).
// wrapAngles: interpolate along the shortest way round (16-bit BAMS keys).
export function sampleKeys(keys: NjKey[], frame: number, frameCount: number, out: [number, number, number], wrapAngles = false): [number, number, number] {
  const n = keys.length;
  if (n === 1 || frame <= keys[0].frame) {
    out[0] = keys[0].value[0];
    out[1] = keys[0].value[1];
    out[2] = keys[0].value[2];
    return out;
  }
  let i = 0;
  while (i + 1 < n && keys[i + 1].frame <= frame) i++;
  const a = keys[i];
  let b: NjKey;
  let span: number;
  if (i + 1 < n) {
    b = keys[i + 1];
    span = b.frame - a.frame;
  } else {
    b = keys[0];
    span = frameCount - a.frame;
  }
  const t = span > 0 ? Math.min(1, (frame - a.frame) / span) : 0;
  for (let c = 0; c < 3; c++) {
    let d = b.value[c] - a.value[c];
    if (wrapAngles) d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    out[c] = a.value[c] + d * t;
  }
  return out;
}

// Standalone motion file (.njm, e.g. a BML entry): an NMDM chunk whose body is
// the NJS_MOTION, pointers relative to the chunk body.
export function parseNjmFile(data: Uint8Array, nodeCount: number, opts: NjMotionOptions = {}): NjMotion {
  const rel = RelFile.chunk(data, 'NMDM');
  if (!rel) throw new Error('no NMDM chunk found');
  return parseNjMotion(rel, 0, nodeCount, opts);
}
