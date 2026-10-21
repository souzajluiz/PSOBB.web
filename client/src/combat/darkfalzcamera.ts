// Dark Falz's boss camera (PsoBB.exe, Ephinea 1.25.13, addresses are VAs).
//
// The camera is a map object (MapObjectEntity, 0xA8 bytes; the reference dump
// names the functions MapObjectEntity_* / UpdateCameraState / SetCameraTargetData,
// the Vol Opt-named cutscene objects in it are Dark Falz's, see the DEVLOG).
//
// - SetCameraMode_004d31f4(5) pushes the mode; the cutscene object's dtor
//   releases it (ReleaseCameraMode_004d3250). Modes 5 and 9 are scripted.
// - UpdateCameraState_004d6770(record, time): time -> 0xA48B20, the record
//   goes through MapObjectEntity_InitFromConfig_004d67a0 into the object:
//   byte +0 type (+0x9C), byte +1 MOTION INDEX (+0x9D), word +2 (+0x9E, bit 0
//   is set when the path has ended), float +4 the start frame (+0xA0), float
//   +8 the frame step per update (+0xA4). The motion is
//   (type asset)[index] (+0x94); the type's flags are the 8-byte entry of the
//   map's table (+0x98, flags dword at +4).
// - SetCameraTargetData_004d681c(pivot*, pivot*, scalar*): pivot to +0x6C,
//   scalar+4 (the yaw, BAMS) to +0x88.
// - MapObjectEntity_UpdateTransform_004d68a0 (per frame) is ported as
//   stepCameraObject below: the motion is evaluated at the frame (NJM_UpdateModelTransform_00830848),
//   the eye and target are built (+0x3C / +0x48), the frame advances and the
//   path ends (clamp or loop). MapObjectEntity_UpdateCamera_004d6bc0 then
//   turns eye/target into the view with the default NPC camera's angles and
//   up vector: NOT ported (the port's view is eye/target, as render/gamefield.ts takes it).
//
// Scene owners: the cutscene objects below are made by the scene enters
// (combat/darkfalzcommon.ts SCENE numbers).
//
// What is NOT available here (so no view is produced yet):
// - The motion file. The map-14 type 0 asset is `Bo04OpCam.rel` (name at
//   0x009095F0, the table at 0x009ACDE8, type 0 flags 0x48 at 0x009ACDEC); it is
//   not in the local client data folder, and its NJM keyframes are needed for every frame.
// - The run-time pivots (object +0x100 / +0xAC / +0xE8 / +0xD4) and the yaws
//   (the scalar's +4 in the BSS blocks 0x00A44F24 / 0x00A45074 and the object fields).
//
// ASSUMED: mode 5 is the boss camera (nothing in the exe names it).
// UNCLEAR: the time unit (frames or ticks), the 0x0044EC14 object's scene, the
// BSS writers of the pivots, and the view composition in MapObjectEntity_UpdateCamera_004d6bc0.

import type { Vec3 } from './darkfalzcommon.ts';

// The mode every cutscene object pushes (0x004D31F4 with 5).
export const BOSS_CAMERA_MODE = 5;
// The modes that do not remember the previous mode (0x004D31F4 / 0x004D3250).
export const SCRIPTED_CAMERA_MODES: readonly number[] = [5, 9];

// The map of the fight (Dark Falz, ep1 floor 14) and its camera asset (the first
// entry of the map's asset list at 0x009ACDE8, read from the exe).
export const DARKFALZ_MAP = 14;
export const DARKFALZ_CAMERA_FILE = 'Bo04OpCam.rel';
export const DARKFALZ_CAMERA_TYPE = 0;
export const DARKFALZ_CAMERA_TYPE_FLAGS = 0x48; // the type entry's flags dword (+4), 0x009ACDEC

// Type flags (the entry's +4): 0x4 = the path is relative (no yaw, no pivot); 0x80 = the
// flat-follow branch; 0x20 = loop at the end (else clamp and mark the path done).
export const CAMERA_FLAG = { relative: 0x4, flat: 0x80, loop: 0x20 } as const;

export interface CameraRecord {
  va: number;
  type: number; // byte +0 (-> +0x9C)
  index: number; // byte +1 (-> +0x9D): the motion index in the type's asset
  word: number; // u16 +2 (-> +0x9E)
  a: number; // float +4: the start frame (-> +0xA0)
  b: number; // float +8: the frame step (-> +0xA4)
}

// The four constant records the owners pass (read at their VAs).
export const CAMERA_RECORDS: Readonly<Record<string, CameraRecord>> = {
  r9a5b14: { va: 0x9a5b14, type: 0, index: 1, word: 0, a: 0, b: 0.5 },
  r9a5ba4: { va: 0x9a5ba4, type: 0, index: 2, word: 0, a: 0, b: 0.5 },
  r9a5c10: { va: 0x9a5c10, type: 0, index: 6, word: 0, a: 0, b: 0 },
  r9a5ce0: { va: 0x9a5ce0, type: 0, index: 5, word: 0, a: 0, b: 0.5 },
};

// One cutscene object's camera: its ctor's mode push, the pivot pair and the
// record call. `recordVa` is a CAMERA_RECORDS key, or null when the record is built at run time.
export interface CutsceneCamera {
  object: string;
  ctor: number;
  modePush: number; // the call site of SetCameraMode_004d31f4(5)
  pair: number; // the call site of SetCameraTargetData_004d681c
  record: number | null; // the call site of UpdateCameraState_004d6770
  recordVa: string | null;
  time: number | null; // the 6770's time argument (unit UNCLEAR)
  pivot: string;
}

export const CUTSCENE_CAMERAS: readonly CutsceneCamera[] = [
  // 0x0044EC14: the pair is 0x00A44F34 (written at 0x0044EE74..0x0044EE88 as (0, 0, -120)).
  { object: 'ctor44ec14', ctor: 0x44ec14, modePush: 0x44ed36, pair: 0x44ed47, record: 0x44ed56, recordVa: 'r9a5b14', time: 0x416c, pivot: 'BSS 0x00A44F34 (set at run time)' },
  // 0x0044F4EC (APP TYPE2): the pair is the object's +0x100.
  { object: 'ctor44f4ec', ctor: 0x44f4ec, modePush: 0x44f675, pair: 0x44f6a2, record: 0x44f6b1, recordVa: 'r9a5ba4', time: 0x4000, pivot: 'object +0x100 (run time)' },
  // 0x0044FA8C (DIE TYPE2): the pair is the object's +0xAC; the record is the BSS pointer 0x00A44F9C.
  { object: 'ctor44fa8c', ctor: 0x44fa8c, modePush: 0x44fba8, pair: 0x44fbf6, record: 0x44fc05, recordVa: null, time: 0x4444, pivot: 'object +0xAC (run time)' },
  // 0x0044FFD8 (GET RING): the pair is a register (run time); the record 0x009A5C10.
  { object: 'ctor44ffd8', ctor: 0x44ffd8, modePush: 0x45014e, pair: 0x450196, record: 0x4501a5, recordVa: 'r9a5c10', time: 0x1555, pivot: 'register (run time)' },
  // 0x0045072C (DEMO_WARP2): the pair is the object's +0xE8 (0x0044FFD8 sets it to 9984.0).
  { object: 'ctor45072c', ctor: 0x45072c, modePush: 0x4508bc, pair: 0x450903, record: 0x450911, recordVa: null, time: 0x416c, pivot: 'object +0xE8' },
  // 0x00450FC4 (DIE TYPE3): the pair is the object's +0xD4; the record is built at run time.
  { object: 'ctor450fc4', ctor: 0x450fc4, modePush: 0x45112e, pair: 0x451175, record: 0x451183, recordVa: null, time: 0x416c, pivot: 'object +0xD4' },
  // 0x004513D4 (DEMO_WARP0): the pair is 0x00A45068 = (-20000, 0, 0) (DEVLOG); the scalar 0x00A45074, its +4 the yaw (run time).
  { object: 'ctor4513d4', ctor: 0x4513d4, modePush: 0x4514cf, pair: 0x451514, record: 0x451523, recordVa: 'r9a5ce0', time: 0x392d, pivot: 'BSS 0x00A45068 = (-20000, 0, 0)' },
];

// The scene (SCENE in combat/darkfalz.ts) -> the cutscene object its enter makes.
export const SCENE_CUTSCENE_CAMERA: Readonly<Record<number, string>> = {
  2: 'ctor4513d4', // DEMO_WARP0
  10: 'ctor44ffd8', // GET RING
  9: 'ctor44fa8c', // DIE TYPE2
  7: 'ctor44f4ec', // APP TYPE2
  11: 'ctor45072c', // DEMO_WARP2
  14: 'ctor450fc4', // DIE TYPE3
};

// One motion sample of the path at a frame (what NJM_UpdateModelTransform_00830848 gives):
// pos = the position channel (A, the object's +0xA8/+0xA4/+0xA0 outputs), dir = the second
// vector (B), and the motion's frame count (motion +4) and its own time (the 8th float).
export interface MotionSample {
  pos: Vec3;
  dir: Vec3;
  frames: number;
  time: number;
}

// The inputs a view needs that the port does not have yet: the motion (per index, at a
// frame; null while the file is not loaded) and the object's pivot and yaw (run time).
export interface BossCameraSource {
  motion(index: number, frame: number): MotionSample | null;
  pivot(object: string): { pivot: Vec3; yaw: number } | null;
}

export interface CameraView {
  source: Vec3; // eye (+0x3C)
  target: Vec3; // look-at (+0x48)
}

// The map object's camera fields the update reads and writes.
export interface CameraObject {
  frame: number; // +0xA0
  step: number; // +0xA4
  index: number; // +0x9D
  flags: number; // the type entry's flags (+0x98 -> +4)
  pivot: Vec3; // +0x6C
  yaw: number; // +0x88 (BAMS)
  time: number; // +0x54
  done: boolean; // +0x9E bit 0
  eye: Vec3; // +0x3C
  target: Vec3; // +0x48
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
// vec3_normalize only when the squared length is not zero (0x00909578 is 0.0).
function normalized(v: Vec3): Vec3 {
  const m2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (m2 === 0) return v;
  const l = Math.sqrt(m2);
  return [v[0] / l, v[1] / l, v[2] / l];
}
// matrix_rotation_y (0x0082D8BC) applied to a vector: x' = cos x + sin z, z' = -sin x + cos z.
// The angle is BAMS (65536 = 360 degrees).
function rotY(v: Vec3, bams: number): Vec3 {
  const a = ((bams & 0xffff) * 2 * Math.PI) / 65536;
  const s = Math.sin(a);
  const c = Math.cos(a);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

// Constants of the exe read in the update: 0x00909570 (5000.0, the wrap bound),
// 0x00909574 (40.0, the flat branch's scale), 0x00909568 (0.0 for a count >= 1).
const WRAP_BOUND = 5000;
const FLAT_SCALE = 40;
const FLAT_TIME = 0x36c1;

// One update of MapObjectEntity_UpdateTransform_004d68a0. `sample` is the motion
// evaluated at the object's current frame (+0xA0, before the step); `time` is the
// UpdateCameraState time (-1: the motion's own time, as the exe's 0xA48B20 check).
export function stepCameraObject(o: CameraObject, sample: MotionSample, time: number): void {
  o.time = time === -1 ? sample.time : time;
  const f = o.flags;
  if ((f & CAMERA_FLAG.relative) === 0) {
    // Yaw about the pivot: the direction is normalized, both vectors turn by the yaw, then the eye moves to the pivot.
    const b = rotY(normalized(sample.dir), o.yaw);
    const a = add(rotY(sample.pos, o.yaw), o.pivot);
    o.eye = a;
    o.target = add(a, b);
  } else if ((f & CAMERA_FLAG.flat) === 0) {
    o.eye = sample.pos;
    o.target = add(sample.pos, sample.dir);
  } else {
    // The flat branch: the time is forced, the direction is flattened and scaled.
    o.time = FLAT_TIME;
    const flat = normalized([sample.dir[0], 0, sample.dir[2]]);
    const a = sample.pos;
    o.eye = [a[0] - flat[0] * FLAT_SCALE, a[1], a[2] - flat[2] * FLAT_SCALE];
    o.target = [a[0] + sample.dir[0], a[1] + sample.dir[1], a[2] + sample.dir[2]];
  }
  // The path: frame += step; stop (or loop) past the last frame (count - 1).
  const p = o.frame + o.step;
  const last = sample.frames - 1;
  o.frame = p;
  if (p <= last && p < WRAP_BOUND) return;
  if ((f & CAMERA_FLAG.loop) !== 0) {
    o.frame = 0;
    return;
  }
  o.frame = last;
  o.done = true;
}

// The seven cutscene objects' views, stepped from the start frame: the view at frame k
// is the output of the (k+1)th update. Null when the scene has no cutscene camera, the
// record is a run-time one, the motion is not loaded, or the pivot is not resolved.
export function bossCameraView(scene: number, frame: number, source: BossCameraSource | null): CameraView | null {
  const object = SCENE_CUTSCENE_CAMERA[scene];
  if (object === undefined || !source) return null;
  const cam = CUTSCENE_CAMERAS.find((c) => c.object === object);
  if (!cam || cam.recordVa === null || cam.time === null) return null;
  const rec = CAMERA_RECORDS[cam.recordVa];
  if (!rec) return null;
  const pv = source.pivot(object);
  if (!pv) return null;
  if (source.motion(rec.index, rec.a) === null) return null;
  const o: CameraObject = {
    frame: rec.a,
    step: rec.b,
    index: rec.index,
    flags: DARKFALZ_CAMERA_TYPE_FLAGS,
    pivot: pv.pivot,
    yaw: pv.yaw,
    time: cam.time,
    done: false,
    eye: pv.pivot,
    target: pv.pivot,
  };
  for (let k = 0; k <= Math.max(0, Math.floor(frame)); k++) {
    const m = source.motion(rec.index, o.frame);
    if (!m) return null;
    stepCameraObject(o, m, cam.time);
  }
  return { source: o.eye, target: o.target };
}
