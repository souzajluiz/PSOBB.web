// Dark Falz's boss camera (PsoBB.exe, Ephinea 1.25.13, addresses are VAs).
//
// What the exe does with the camera during the fight, as read from the
// disassembly (tools/exedata.py, objdump of the .text):
//
// - The camera has modes in a table (0x00A48A00, one object per mode) and the
//   current mode byte at 0x00A489F4. SetCameraMode_004d31f4(mode) (flag 0x4)
//   makes the mode current and calls the mode's activate (vtable +0x14).
//   Modes 5 and 9 are the scripted ones: a change to them does not record the
//   previous mode (0x00A489F5), the others do.
// - ReleaseCameraMode_004d3250 clears flag 0x4; unless the mode is 5 it sets
//   flag 0x20 (the branch to 0x004D3351 is not read). It then looks up the
//   entity whose id is at 0x00A9C4F4 (0x0068D5A8, the player lookup per the
//   DEVLOG) and makes it the view's target. It is the release of every
//   cutscene object's camera.
// - SetCameraSourceTarget_004d681c(source*, target*, scalar*) writes the
//   current camera struct (0x00A48A14): source at +0x6C, target at +0x78, and
//   the scalar's Y at +0x88.
// - SetCameraRecord_004d6770(record*, time) stores the time at 0x00A48B20 and
//   the record through SetCameraRecordFields_004d67a0: type byte +0x9C, byte
//   +0x9D, word +0x9E, floats +0xA0 and +0xA4. The update returns early while
//   0x00A48B20 is -1 (0x004D68E3).
// - UpdateCameraView_004d68a0 (per frame) moves the view. It calls the spring
//   arm 0x00830848 (a collision query, 0x00AEB4A0), the vector helpers
//   0x0082DEF4 / 0x00830AA0 and the path tables at 0x00A48AE0. NOT ported.
//
// Every cutscene object's ctor pushes mode 5, the source / target pair and a
// record with a time (below); its dtor releases the camera. The pair is the
// same pointer twice in every case (source == target): the view is an orbit
// about that point, placed by the update above, so a pair alone is not a view.
//
// The scene owners (combat/darkfalzcommon.ts SCENE numbers) are the enter
// functions that create the objects: DEMO_WARP0 (0x0044E504 -> 0x004513D4),
// GET RING (0x0044E0F0 -> 0x0044FFD8), DIE TYPE2 (0x0044E120 -> 0x0044FA8C),
// APP TYPE2 (0x0044E2F4 -> 0x0044F4EC), DEMO_WARP2 (0x0044E0B8 -> 0x0045072C),
// DIE TYPE3 (0x0044DF90 -> 0x00450FC4). The control state at 0x0044D724 builds
// 0x0044EC14 from its slot +0x39C; its scene is not read. DEMO_WARP3 (0x0044E08C)
// places the players (0x0044C090, which feeds the local player to
// UpdateDefaultNPCCameraState_004d2fb4) and makes no object.
//
// ASSUMED: the mode-5 camera object's view is the boss view (nothing in the
// exe names it; the mode number is read, its use is inferred from the pushes).
// UNCLEAR: the view itself (see the update above), the time's unit (frames or
// ticks), the object-relative pivots, and the one object of 0x0044EC14.

import type { Vec3 } from './darkfalzcommon.ts';

// The mode every cutscene object pushes (0x004D31F4 with 5).
export const BOSS_CAMERA_MODE = 5;
// The modes that do not remember the previous mode (0x004D31F4 / 0x004D3250).
export const SCRIPTED_CAMERA_MODES: readonly number[] = [5, 9];

export interface CameraRecord {
  va: number;
  type: number; // byte +0 (-> +0x9C)
  flags: number; // byte +1 (-> +0x9D)
  word: number; // u16 +2 (-> +0x9E)
  a: number; // float +4 (-> +0xA0)
  b: number; // float +8 (-> +0xA4)
}

// The four constant records the owners pass (read at their VAs).
export const CAMERA_RECORDS: Readonly<Record<string, CameraRecord>> = {
  r9a5b14: { va: 0x9a5b14, type: 0, flags: 1, word: 0, a: 0, b: 0.5 },
  r9a5ba4: { va: 0x9a5ba4, type: 0, flags: 2, word: 0, a: 0, b: 0.5 },
  r9a5c10: { va: 0x9a5c10, type: 0, flags: 6, word: 0, a: 0, b: 0 },
  r9a5ce0: { va: 0x9a5ce0, type: 0, flags: 5, word: 0, a: 0, b: 0.5 },
};

// One cutscene object's camera: its ctor's mode push, the 681C pair and the
// 6770 record. `pivot` is what the pair is, as far as it is read; `record` is
// null when the record is built at run time.
export interface CutsceneCamera {
  object: string;
  ctor: number; // the object's ctor (its +290 / +393 / ... is the mode push)
  modePush: number; // the call site of SetCameraMode_004d31f4(5)
  pair: number; // the call site of SetCameraSourceTarget_004d681c
  record: number | null; // the call site of SetCameraRecord_004d6770
  recordVa: string | null; // a CAMERA_RECORDS key, or null
  time: number | null; // the 6770's time argument (the unit is UNCLEAR)
  pivot: string;
}

export const CUTSCENE_CAMERAS: readonly CutsceneCamera[] = [
  // 0x0044EC14: the pair is 0x00A44F34, written at 0x0044EE74..0x0044EE88 as
  // (0, 0, -120) (in the code before 0x0044EE94; its caller is not read); the
  // scalar is at 0x00A44F24 + 4.
  { object: 'ctor44ec14', ctor: 0x44ec14, modePush: 0x44ed36, pair: 0x44ed47, record: 0x44ed56, recordVa: 'r9a5b14', time: 0x416c, pivot: 'BSS 0x00A44F34 (set at run time)' },
  // 0x0044F4EC: the pair is the object's own +0x100 (dynamic).
  { object: 'ctor44f4ec', ctor: 0x44f4ec, modePush: 0x44f675, pair: 0x44f6a2, record: 0x44f6b1, recordVa: 'r9a5ba4', time: 0x4000, pivot: 'object +0x100 (run time)' },
  // 0x0044FA8C: the pair is the object's +0xAC; the record is the BSS pointer 0x00A44F9C.
  { object: 'ctor44fa8c', ctor: 0x44fa8c, modePush: 0x44fba8, pair: 0x44fbf6, record: 0x44fc05, recordVa: null, time: 0x4444, pivot: 'object +0xAC (run time)' },
  // 0x0044FFD8: the pair is the register esi (run time); time 0x1555.
  { object: 'ctor44ffd8', ctor: 0x44ffd8, modePush: 0x45014e, pair: 0x450196, record: 0x4501a5, recordVa: 'r9a5c10', time: 0x1555, pivot: 'register (run time)' },
  // 0x0045072C: the pair is the object's +0xE8 (0x0044FFD8 sets it to 9984.0, 0x461C4000).
  { object: 'ctor45072c', ctor: 0x45072c, modePush: 0x4508bc, pair: 0x450903, record: 0x450911, recordVa: null, time: 0x416c, pivot: 'object +0xE8' },
  // 0x00450FC4: the pair is the object's +0xD4; the record is built at run time.
  { object: 'ctor450fc4', ctor: 0x450fc4, modePush: 0x45112e, pair: 0x451175, record: 0x451183, recordVa: null, time: 0x416c, pivot: 'object +0xD4' },
  // 0x004513D4: the pair is 0x00A45068 = (-20000, 0, 0), written at 0x004514D5..0x004514FE
  // while bit 0 of 0x00A45064 is clear; time 0x392D.
  { object: 'ctor4513d4', ctor: 0x4513d4, modePush: 0x4514cf, pair: 0x451514, record: 0x451523, recordVa: 'r9a5ce0', time: 0x392d, pivot: 'BSS 0x00A45068 = (-20000, 0, 0)' },
];

// The scene (SCENE in combat/darkfalzcommon.ts) -> the cutscene object its
// enter function makes. A scene not listed makes no camera object here.
export const SCENE_CUTSCENE_CAMERA: Readonly<Record<number, string>> = {
  2: 'ctor4513d4', // DEMO_WARP0
  10: 'ctor44ffd8', // GET RING
  9: 'ctor44fa8c', // DIE TYPE2
  7: 'ctor44f4ec', // APP TYPE2
  11: 'ctor45072c', // DEMO_WARP2
  14: 'ctor450fc4', // DIE TYPE3
};

// The boss view for a scene (null: the normal camera). Not ported: the view
// is the update 0x004D68A0 of the pair above, which needs the path tables and
// the collision query (see the header). Until then no scene has a view here.
export function bossCameraView(scene: number): { source: Vec3; target: Vec3 } | null {
  void scene;
  return null;
}
