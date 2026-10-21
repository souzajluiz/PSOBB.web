// Boss cutscene camera files (Bo04OpCam.rel, Bo0NEnCam.rel, ... in data.gsl; the
// map's camera asset table, see combat/darkfalzcamera.ts). A REL whose root is
//   { u32 motions (pointer to an array of NJS_MOTION pointers), u32 count }
// and each NJS_MOTION is { u32 mdata, u32 frame_count, u16 type, u16 inp }.
//
// Layout and evaluation from PsoBB.exe (Ephinea 1.25.13):
// - NJM_UpdateModelTransform_00830848(out, motion, out_ptrs, frame) evaluates ONE
//   node (the camera has one: mdata holds inp & 0xF records of 8 bytes = 32 bytes).
//   The element bits of `type` are consumed in ascending order (the storage order):
//   0x001 position A (vec), 0x008 vec B, 0x040 vec B minus A, 0x080 int (out[2]),
//   0x100 int (out[3]). The other bits (0x002, 0x004, 0x010, 0x020) take a slot and
//   are not sampled here (ASSUMED: they are not used by the camera files).
// - mdata: inp & 0xF u32 key-list pointers, then as many u32 key counts (FUN_008472b0).
// - Vector keys (stride 0x10): u32 frame, f32 x3 (sampler 0x00842D04).
// - Integer keys (stride 8): u32 frame, i32 value (sampler 0x00842DE4); the step is
//   the low 16 bits of the difference (movswl) and the result is truncated (chop).
// - Key search FUN_0084AE50: the last key whose frame <= round(frame) (the first key
//   when none); k1 is the next key, or the same key at the end (so the value holds).
// - A missing list (null pointer or zero count) gives the caller's default; this port
//   uses 0 (ASSUMED: the caller's defaults are not read).
// Checked on the real bo04opcam.rel (7 motions, type 0x1C1) in tests/darkfalzcamera.test.ts.

import { RelFile } from './rel.ts';

export type Vec3 = [number, number, number];

export const CAM_POS = 0x001;
export const CAM_VEC_B = 0x008;
export const CAM_VEC_B_REL = 0x040; // B minus A
export const CAM_INT_ROLL = 0x080;
export const CAM_INT_TIME = 0x100;

const VEC_BITS = [CAM_POS, CAM_VEC_B, CAM_VEC_B_REL];
const INT_BITS = [CAM_INT_ROLL, CAM_INT_TIME];

export interface CameraVecKey {
  frame: number;
  value: Vec3;
}

export interface CameraIntKey {
  frame: number;
  value: number;
}

export interface CameraElement {
  bit: number;
  vec: CameraVecKey[] | null;
  int: CameraIntKey[] | null;
}

export interface CameraMotion {
  index: number;
  frameCount: number;
  type: number;
  elements: CameraElement[]; // storage order (ascending bits)
}

export interface CameraRel {
  motions: CameraMotion[];
}

export interface CameraSample {
  pos: Vec3; // A (out[0]), the eye
  dir: Vec3; // B (out[1]), the second vector
  roll: number; // out[2] as an int (BAMS)
  time: number; // out[3] as an int, the motion's own time
}

function readVecKeys(rel: RelFile, p: number, n: number): CameraVecKey[] {
  if (p + n * 0x10 > rel.data.length) throw new Error(`camera keys at 0x${p.toString(16)} (${n}) out of range`);
  const keys: CameraVecKey[] = [];
  for (let i = 0; i < n; i++) {
    const k = p + i * 0x10;
    keys.push({ frame: rel.u32(k), value: [rel.f32(k + 4), rel.f32(k + 8), rel.f32(k + 12)] });
  }
  return keys;
}

function readIntKeys(rel: RelFile, p: number, n: number): CameraIntKey[] {
  if (p + n * 8 > rel.data.length) throw new Error(`camera int keys at 0x${p.toString(16)} (${n}) out of range`);
  const keys: CameraIntKey[] = [];
  for (let i = 0; i < n; i++) {
    const k = p + i * 8;
    keys.push({ frame: rel.u32(k), value: rel.i32(k + 4) });
  }
  return keys;
}

// One NJS_MOTION (the node 0 record of its mdata).
export function parseCameraMotion(rel: RelFile, o: number, index: number): CameraMotion {
  const mdata = rel.ptr(o);
  const frameCount = rel.u32(o + 4);
  const type = rel.u16(o + 8);
  const inp = rel.u16(o + 10);
  const n = inp & 0xf;
  const bits: number[] = [];
  for (let bit = 1; bit <= 0x8000; bit <<= 1) if (type & bit) bits.push(bit);
  if (bits.length !== n) throw new Error(`camera motion ${index}: type 0x${type.toString(16)} does not have ${n} elements`);
  const elements: CameraElement[] = bits.map((bit, e) => {
    const count = rel.u32(mdata + (n + e) * 4);
    const p = rel.ptr(mdata + e * 4);
    const has = count > 0 && p !== 0;
    return {
      bit,
      vec: has && VEC_BITS.includes(bit) ? readVecKeys(rel, p, count) : null,
      int: has && INT_BITS.includes(bit) ? readIntKeys(rel, p, count) : null,
    };
  });
  return { index, frameCount, type, elements };
}

// The camera file: the root's motion array, one entry per motion index.
export function parseCameraRel(data: Uint8Array): CameraRel {
  const rel = new RelFile(data);
  const arr = rel.ptr(rel.root);
  const count = rel.u32(rel.root + 4);
  if (count > 0x100) throw new Error(`camera file: ${count} motions`);
  const motions: CameraMotion[] = [];
  for (let i = 0; i < count; i++) motions.push(parseCameraMotion(rel, rel.ptr(arr + i * 4), i));
  return { motions };
}

// Round half to even (the x87 default rounding of fistp, used by the key search).
function roundEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - Math.trunc(x)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// FUN_0084AE50: the bracketing keys of `frame` (k1 is k0 at the end of the list).
function bracket<K extends { frame: number }>(keys: K[], frame: number): { k0: K; k1: K; t: number } {
  const f = roundEven(frame);
  let lo = 0;
  let hi = keys.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].frame <= f) lo = mid;
    else hi = mid;
  }
  const k0 = keys[lo];
  const k1 = lo < keys.length - 1 ? keys[lo + 1] : k0;
  const diff = (k1.frame - k0.frame) | 0;
  // t is (frame - k0) / diff, or frame - k0 when the span is not positive.
  const t = diff < 1 ? frame - k0.frame : (frame - k0.frame) / diff;
  return { k0, k1, t };
}

function sampleVec(keys: CameraVecKey[], frame: number): Vec3 {
  const { k0, k1, t } = bracket(keys, frame);
  return [0, 1, 2].map((c) => k0.value[c] + (k1.value[c] - k0.value[c]) * t) as Vec3;
}

function sampleInt(keys: CameraIntKey[], frame: number): number {
  const { k0, k1, t } = bracket(keys, frame);
  const step = (((k1.value - k0.value) << 16) >> 16); // movswl: the low 16 bits, signed
  return Math.trunc(k0.value + step * t);
}

// NJM_UpdateModelTransform for one node at `frame` (the exe's out[0..3]).
export function sampleCameraMotion(m: CameraMotion, frame: number): CameraSample {
  const out: CameraSample = { pos: [0, 0, 0], dir: [0, 0, 0], roll: 0, time: 0 };
  for (const el of m.elements) {
    if (el.bit === CAM_POS) {
      if (el.vec) out.pos = sampleVec(el.vec, frame);
    } else if (el.bit === CAM_VEC_B) {
      if (el.vec) out.dir = sampleVec(el.vec, frame);
    } else if (el.bit === CAM_VEC_B_REL) {
      // B = the key minus A (A is out[0] of this same evaluation); no keys keeps the default.
      if (el.vec) {
        const b = sampleVec(el.vec, frame);
        out.dir = [b[0] - out.pos[0], b[1] - out.pos[1], b[2] - out.pos[2]];
      }
    } else if (el.bit === CAM_INT_ROLL) {
      if (el.int) out.roll = sampleInt(el.int, frame);
    } else if (el.bit === CAM_INT_TIME) {
      if (el.int) out.time = sampleInt(el.int, frame);
    }
  }
  return out;
}
