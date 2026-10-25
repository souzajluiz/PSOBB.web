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
// - The object's vtable is 0x00AFC8F8 (FUN_004d66d0 stores it; the earlier note used 0x00AFC8F4,
//   one slot off). Slot 1 (+4) = MapObjectEntity_UpdateTransform_004d68a0, ported as
//   stepCameraObject below: the motion is evaluated at the frame (NJM_UpdateModelTransform_00830848),
//   the eye and target are built (+0x3C / +0x48), the frame advances and the
//   path ends (clamp or loop). Slot 9 (+0x24) = MapObjectEntity_UpdateCamera_004d6bc0 turns
//   the eye/target into the view angles (+0x190 / +0x194) and the lookAt (see below).
// - THE PER-FRAME DRIVER is FUN_004d3abc (the default camera's update, DAT_00a48a54): for the
//   current mode object (DAT_00a48a00[DAT_00a489f4]) it calls slot 1, then FUN_004d1ff4 (copies
//   the object's eye/target +0x3C..+0x50 into the camera's goal +0x1a0..+0x1b4 and, when the
//   push flag DAT_00a489fc & 0xC is set (FUN_004d31f4 sets 0x4), also into the camera's
//   current +0x178..+0x18c: this is the eye/target copy the view uses; the time +0x54 into +0x19c), then
//   FUN_004d3e90 (current = goal, the object's +0x38 flags are 0 for mode 5), then slot 9,
//   and last copies the camera's +0x194 into +0x94.
//
// Scene owners: the cutscene objects below are made by the scene enters
// (combat/darkfalzcommon.ts SCENE numbers).
//
// The motion file: the map-14 type 0 asset is `Bo04OpCam.rel` (name at 0x009095F0,
// the table at 0x009ACDE8, type 0 flags 0x48 at 0x009ACDEC). It is in data.gsl as
// `bo04opcam.rel` (client/src/formats/cameramotion.ts parses it). Its record-to-motion
// reads are checked in tests/darkfalzcamera.test.ts.
//
// The view composition, MapObjectEntity_UpdateCamera_004d6bc0 (no Ghidra function; the
// disassembly of 0x004D6BC0..0x004D6CF9 was read), is ported as composeCameraUp: the
// direction B = target - eye gives the yaw (atan2(dx, dz)) and the up vector is
// RotY(yaw) then RotZ(roll) applied to (0, 1, 0). The view is lookAt(eye, target, up),
// the exe's set_view_matrix_lookat on the default camera's source (+0x178) and target
// (+0x184): ASSUMED to be this object's eye and target (the exe's writer of those fields
// in the cutscene is not found). The angles it writes to the default camera (+0x190 pitch,
// +0x194 yaw, 0x004D6448) are not read by the view and are not modelled.
//
// RESOLVED (Ghidra, 2026-10-21): the eye/target reach the camera by FUN_004d1ff4 each frame
// (see THE PER-FRAME DRIVER above): the view's +0x178 / +0x184 are the object's +0x3C / +0x48
// of the same frame, after slot 1 and before slot 9.
//
// The pivot and yaw sources (the scalar's +4 is the yaw; FUN_004d681c stores the pivot at
// object +0x6C and the scalar+4 at +0x88 (BAMS)):
// - DEMO_WARP0 (ctor 0x4513D4): pivot BSS 0x00A45068 = (-20000, 0, 0) written by the ctor; yaw
//   BSS 0x00A45078 has NO absolute reference in the exe (the scalar 0x00A45074 is only passed):
//   yaw 0 (BSS). Verified by the absence of writers.
// - ctor 0x44EC14 (the Dark Falz object, vtable 0x00AF6BD8): pivot BSS 0x00A44F34 = (0, 0, -120),
//   written by FUN_0044EDAC (no direct call found in the exe: it runs from a jump or a table; the
//   ctor's brain is FUN_0044D739, which calls the ctor); later
//   writes to 0x00A44F34 are none (its pushes are effect spawns); yaw 0x00A44F28 has no
//   reference: 0. Its scene number is UNCLEAR (the brain state is not named).
// - APP TYPE2 (0x44F4EC, caller 0x44E30F): pivot = [0x00A44D64] + 0x38 (a vec3), yaw =
//   [0x00A44D64] + 0x60 (BAMS); the fallback (0x44E34D) is BSS 0x00A44D9C with yaw 0.
// - DIE TYPE3 (0x450FC4, caller 0x44DFC7): pivot = [0x00A44D5C] + 0x38, yaw = [0x00A44D5C] + 0x60;
//   fallback BSS 0x00A44D88 with yaw 0 (0x44E07D).
// - DIE TYPE2 (0x44FA8C, caller 0x44E1F9): pivot = the brain's +0x3A4 (the 75-unit formula below, read
//   in the exe at 0x44E14E..0x44E1CC), yaw = [0x00A44D60] + 0x60, stored to the brain's +0x3B0 (0x44E1D6).
//   [0x00A44D60] is form 2 (the serpent, see the Z note below).
// - GET RING (0x44FFD8, caller 0x44E108) and DEMO_WARP2 (0x45072C, caller 0x44E0D0): pivot =
//   the brain's +0x3A4 and yaw = the brain's +0x3B0 (the args at the call). Their brain values
//   are the DIE TYPE2 ones: the scene table reaches 10 and 11 from DIE TYPE2 only (ASSUMED: no other writer of
//   the brain's +0x3A4 / +0x3B0 on that path; the Vol Opt functions that write +0x3B0 are area 0x0D's).
// So the static source has two constant scenes (DEMO_WARP0, the Dark Falz object); every other
// scene's pivot and yaw come from live entity pointers ([0xA44D5C], [0xA44D64], [0xA44D60]) or the
// brain. The port feeds them through LiveCameraInputs (the poses captured at the scene enters,
// captureCameraLive); without them cameraSourceOf returns null for those five.
//
// The entity identities (2026-10-25, Ghidra + objdump): the three store sites and their creators
// (ports: form 1 = Y, form 2 = Z, form 3 = X):
// - X [0x00A44D5C] = create 0x0045E4F0 (form 3, vtable 0x00AF7A60, the dump's g_pVoloptEntity).
// - Y [0x00A44D64] = create 0x00457000 (form 1, vtable 0x00AF75A0, stored at 0x0044E450, the
//   dump's g_pVoloptEntityForm2 name is a community label, not a form 2).
// - Z [0x00A44D60] = create 0x00459820 (0x47C bytes, stored at 0x0044D8B0 by FUN_0044D7A8), whose
//   ctor 0x004598D0 writes vtable 0x00AF77E0 = form 2 (the serpent). The port's header citing
//   "create 0x00457E7C" for form 2 is wrong: 0x00457E7C is an update helper, not the creator.
//
// ASSUMED: mode 5 is the boss camera (nothing in the exe names it; the mode table entry 5 is
// FUN_004d665c's object, DAT_00a48a00[5] = DAT_00a48a14). The entity layout (+0x38 position, +0x60
// BAMS yaw) is taken from the field of the pivot use, not from the entity's own code.
// UNCLEAR: the time unit (frames or ticks), the 0x0044EC14 object's scene, and the 0x100 channel: it is NOT a time: the APP TYPE2 object copies its pivot
// (param 2) to its own +0x100 and its yaw (param 3) to +0x10C; FUN_004d681c reads them from there.

import { SCENE, type Vec3 } from './darkfalzcommon.ts';
import { sampleCameraMotion, type CameraRel } from '../formats/cameramotion.ts';

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
  { object: 'ctor44ec14', ctor: 0x44ec14, modePush: 0x44ed36, pair: 0x44ed47, record: 0x44ed56, recordVa: 'r9a5b14', time: 0x416c, pivot: 'BSS 0x00A44F34 = (0, 0, -120) (FUN_0044EDAC); yaw 0' },
  // 0x0044F4EC (APP TYPE2): the ctor copies its pivot argument to its own +0x100 and the yaw argument to +0x10C.
  // The caller passes [0x00A44D64]+0x38 and [0x00A44D64]+0x60 (BAMS), or BSS 0x00A44D9C with yaw 0.
  { object: 'ctor44f4ec', ctor: 0x44f4ec, modePush: 0x44f675, pair: 0x44f6a2, record: 0x44f6b1, recordVa: 'r9a5ba4', time: 0x4000, pivot: 'entity [0x00A44D64] +0x38 (live; yaw +0x60)' },
  // 0x0044FA8C (DIE TYPE2): the ctor copies the pivot argument to +0xAC and the yaw argument to +0xB8 (the scalar's +4);
  // the record is the BSS block 0x00A44F9C (time 0x4444), built at run time: recordVa null.
  { object: 'ctor44fa8c', ctor: 0x44fa8c, modePush: 0x44fba8, pair: 0x44fbf6, record: 0x44fc05, recordVa: null, time: 0x4444, pivot: 'brain +0x3A4 (computed from [0x00A44D60]; live)' },
  // 0x0044FFD8 (GET RING): the caller passes the brain's +0x3A4 (pivot) and +0x3B0 (yaw); the record is 0x009A5C10.
  { object: 'ctor44ffd8', ctor: 0x44ffd8, modePush: 0x45014e, pair: 0x450196, record: 0x4501a5, recordVa: 'r9a5c10', time: 0x1555, pivot: 'brain +0x3A4 / +0x3B0 (live)' },
  // 0x0045072C (DEMO_WARP2): the caller passes the brain's +0x3A4 and +0x3B0 (live); the record is run time.
  { object: 'ctor45072c', ctor: 0x45072c, modePush: 0x4508bc, pair: 0x450903, record: 0x450911, recordVa: null, time: 0x416c, pivot: 'brain +0x3A4 / +0x3B0 (live)' },
  // 0x00450FC4 (DIE TYPE3): the caller passes [0x00A44D5C]+0x38 and [0x00A44D5C]+0x60 (live), or BSS 0x00A44D88 with yaw 0; the record is run time.
  { object: 'ctor450fc4', ctor: 0x450fc4, modePush: 0x45112e, pair: 0x451175, record: 0x451183, recordVa: null, time: 0x416c, pivot: 'entity [0x00A44D5C] +0x38 (live; yaw +0x60)' },
  // 0x004513D4 (DEMO_WARP0): the ctor takes no pivot; it writes (-20000, 0, 0) to BSS 0x00A45068 and passes the scalar
  // 0x00A45074 whose +4 (0x00A45078) has no writer in the exe: yaw 0.
  { object: 'ctor4513d4', ctor: 0x4513d4, modePush: 0x4514cf, pair: 0x451514, record: 0x451523, recordVa: 'r9a5ce0', time: 0x392d, pivot: 'BSS 0x00A45068 = (-20000, 0, 0); yaw 0' },
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
  roll: number; // out[2] (BAMS int), stored at +0x90 (ASSUMED: by the update)
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
  up: Vec3; // from the roll (+0x90), composeCameraUp
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
  roll: number; // +0x90 (BAMS)
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
  o.roll = sample.roll;
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
    roll: 0,
  };
  for (let k = 0; k <= Math.max(0, Math.floor(frame)); k++) {
    const m = source.motion(rec.index, o.frame);
    if (!m) return null;
    stepCameraObject(o, m, cam.time);
  }
  const dir: Vec3 = [o.target[0] - o.eye[0], o.target[1] - o.eye[1], o.target[2] - o.eye[2]];
  return { source: o.eye, target: o.target, up: composeCameraUp(dir, o.roll) };
}

// 0x00909500 as the exe stores it (a double, 6.283184051513672: the low mantissa bits
// are clear) and 0x00909508 = 65536 (BAMS per turn).
const EXE_TWO_PI = 6.283184051513672;
const BAMS_PER_TURN = 65536;

// The up vector of MapObjectEntity_UpdateCamera_004d6BC0 (0x004D6BC0, the disassembly):
// with roll 0 the up is (0, 1, 0). Otherwise the yaw is a = trunc(atan2(dx, dz) * 65536 / 2pi)
// (fpatan of dx and dz: the sqrt in the call is popped and its argument is read again
// from the stack, which the callee pops), the matrix is I, RotY(a) (0x0082D8BC), RotZ(roll)
// (0x00830C04), and the up is the matrix's column 1 (0x0082EAB8 of (0, 1, 0)):
// (-sin(roll) cos(a), cos(roll), sin(roll) sin(a)). The sin / cos are exact here (ASSUMED:
// the exe's table is not read).
export function composeCameraUp(dir: Vec3, roll: number): Vec3 {
  if (roll === 0) return [0, 1, 0];
  const a = Math.trunc((Math.atan2(dir[0], dir[2]) * BAMS_PER_TURN) / EXE_TWO_PI);
  const turn = (bams: number) => ((bams & 0xffff) * Math.PI * 2) / BAMS_PER_TURN;
  const ca = Math.cos(turn(a));
  const sa = Math.sin(turn(a));
  const cr = Math.cos(turn(roll));
  const sr = Math.sin(turn(roll));
  return [-sr * ca, cr, sr * sa];
}

// A live entity's pose: its position (+0x38..+0x40) and BAMS yaw (+0x60). The layout is read
// from the exe's own uses (0x0044E162 / 0x0044E1D6 / 0x0044DFC7 / 0x0044E2F4), see the header.
export interface EntityPose {
  pos: Vec3;
  yaw: number;
}

export type EntityPoseSource = { x: number; y: number; z: number; yaw: number } | null | undefined;

// The live inputs of the five scenes whose pivot is not constant. Each field is null when the
// entity is gone (the exe then uses a fallback this port does not model, see cameraSourceOf).
export interface LiveCameraInputs {
  // [0x00A44D64] (create 0x00457000, the enemy of 0x4A4 bytes): APP TYPE2's pivot is its pos, yaw its +0x60.
  form1?: EntityPose | null;
  // [0x00A44D5C] (create 0x0045E4F0, the Form 3 object): DIE TYPE3's pivot is its pos, yaw its +0x60.
  form3?: EntityPose | null;
  // [0x00A44D60] (create 0x00459820, ctor 0x004598D0, vtable 0x00AF77E0 = form 2): the source of the brain's DIE TYPE2 pivot.
  dieType2Source?: EntityPose | null;
  // The brain's +0x3A4 / +0x3B0 as the last DIE TYPE2 setup (0x0044E120) left them: GET RING and
  // DEMO_WARP2 take these. Use brainPivotOf(dieType2Source) at that setup.
  brain?: { pivot: Vec3; yaw: number } | null;
}

// DIE TYPE2's pivot, computed by the brain's setup 0x0044E120 (InitializeVoloptMonitorWithOffset in
// the reference dump, with the Vol Opt names: they are Dark Falz's). Read in the exe:
// - [0x00A44D98] is the distance 75.0 (0x42960000), stored at 0x0044E14E the first time
//   (flag bit 0 of the byte 0x00A44D94 at 0x0044E143..0x0044E14C); the only writer.
// - the entity's (x, 0, z) is normalized by 0x0082DF08 (K = [0x0098A420] = 1.0, a zero length
//   is left as it is), and the pivot is the entity's position minus 75 times that unit vector:
//   brain +0x3A4 = x - 75 x/|xz|, +0x3AC = z - 75 z/|xz|, +0x3A8 = 0 (0x0044E1CC).
// - brain +0x3B0 = the entity's +0x60 (0x0044E1D6).
// - with no entity (0x0044E143: [0x00A44D60] is 0) the brain's pivot and yaw are 0 (0x0044E2AF).
export const DIE_TYPE2_PIVOT_DISTANCE = 75;

export function brainPivotOf(source: EntityPose | null | undefined): { pivot: Vec3; yaw: number } {
  if (!source) return { pivot: [0, 0, 0], yaw: 0 };
  const [x, , z] = source.pos;
  const len = Math.sqrt(x * x + z * z);
  const ux = len > 0 ? x / len : 0;
  const uz = len > 0 ? z / len : 0;
  return {
    pivot: [x - DIE_TYPE2_PIVOT_DISTANCE * ux, 0, z - DIE_TYPE2_PIVOT_DISTANCE * uz],
    yaw: source.yaw,
  };
}

// The pose of a form as the scene enters read it: the port's form position (x, y, z) and its BAMS yaw.
// The exe reads the same fields at +0x38..+0x40 and +0x60 (see the header); null for a form that is gone.
export function poseOf(f: { x: number; y: number; z: number; yaw: number } | null | undefined): EntityPose | null {
  return f ? { pos: [f.x, f.y, f.z], yaw: f.yaw } : null;
}

// The live inputs as the scene enters capture them. The exe's enter functions read the entity
// pointer (and the brain) and then clear it, so the pose is the one at the enter, not later:
// - APP TYPE2 (0x0044E2F4, scene 7): [0x00A44D64] = form 1 is read, then cleared.
// - DIE TYPE2 (0x0044E120, scene 9): [0x00A44D60] = form 2 is read into the brain's +0x3A4 / +0x3B0
//   (brainPivotOf), then cleared; GET RING and DEMO_WARP2 later read the brain as it stands.
// - DIE TYPE3 (0x0044DF90 / 0x0044DFB2, scene 14): [0x00A44D5C] = form 3 is read, then cleared.
// Other scenes leave the snapshot as it is. `forms` are the port's form objects before the enter drops them.
export function captureCameraLive(
  live: LiveCameraInputs,
  scene: number,
  forms: { form1: EntityPoseSource; form2: EntityPoseSource; form3: EntityPoseSource },
): LiveCameraInputs {
  if (scene === SCENE.appType2) return { ...live, form1: poseOf(forms.form1) };
  if (scene === SCENE.dieType2) {
    const dieType2Source = poseOf(forms.form2);
    return { ...live, dieType2Source, brain: brainPivotOf(dieType2Source) };
  }
  if (scene === SCENE.dieType3) return { ...live, form3: poseOf(forms.form3) };
  return live;
}

// The camera source for a loaded camera file (formats/cameramotion.ts). The constant pivots are
// the exe's (see the header): DEMO_WARP0 (-20000, 0, 0) with yaw 0, and the Dark Falz object
// (0, 0, -120) with yaw 0. The five live pivots come from `live` (null entries give no view:
// the exe's fallbacks, BSS 0x00A44D9C (APP TYPE2) and 0x00A44D88 (DIE TYPE3), are not read, so
// they are UNCLEAR and not guessed).
export function cameraSourceOf(rel: CameraRel, live: LiveCameraInputs | null = null): BossCameraSource {
  return {
    motion(index, frame) {
      const m = rel.motions[index];
      if (!m) return null;
      const s = sampleCameraMotion(m, frame);
      return { pos: s.pos, dir: s.dir, roll: s.roll, frames: m.frameCount, time: s.time };
    },
    pivot(object) {
      if (object === 'ctor4513d4') return { pivot: [-20000, 0, 0], yaw: 0 };
      if (object === 'ctor44ec14') return { pivot: [0, 0, -120], yaw: 0 };
      if (!live) return null;
      // APP TYPE2 (0x0044E30F): [0x00A44D64] pos and +0x60, passed by 0x0044E2F4.
      if (object === 'ctor44f4ec') return live.form1 ? { pivot: live.form1.pos, yaw: live.form1.yaw } : null;
      // DIE TYPE3 (0x0044DFC7): [0x00A44D5C] +0x38 and +0x60.
      if (object === 'ctor450fc4') return live.form3 ? { pivot: live.form3.pos, yaw: live.form3.yaw } : null;
      // DIE TYPE2 (0x0044E1F9): the brain's pivot and yaw computed from [0x00A44D60].
      if (object === 'ctor44fa8c') return brainPivotOf(live.dieType2Source);
      // GET RING (0x0044E108) and DEMO_WARP2 (0x0044E0D0): the brain's +0x3A4 / +0x3B0 as they stand.
      if (object === 'ctor44ffd8' || object === 'ctor45072c') return live.brain ?? null;
      return null;
    },
  };
}
