// Dark Falz's boss camera (client/src/combat/darkfalzcamera.ts): the mode the
// cutscene objects push, the records they pass (decoded from the exe's bytes),
// the scene -> object owners, and the view seam the port exposes. The view is
// not ported yet (the update 0x004D68A0), so every scene reads null.
//
// Run: node tests/darkfalzcamera.test.ts
import {
  BOSS_CAMERA_MODE,
  CAMERA_RECORDS,
  CUTSCENE_CAMERAS,
  SCENE_CUTSCENE_CAMERA,
  SCRIPTED_CAMERA_MODES,
  bossCameraView,
} from '../client/src/combat/darkfalzcamera.ts';
import { DarkFalzAi, SCENE } from '../client/src/combat/darkfalz.ts';
import { EMPTY_ROW, SCENE_NAMES } from '../client/src/combat/darkfalzcommon.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = <T>(a: T, b: T, msg: string) => check(Object.is(a, b), `${msg}: got ${String(a)}, want ${String(b)}`);

// The mode: every cutscene object's first camera call is SetCameraMode 5 (0x004D31F4).
eq(BOSS_CAMERA_MODE, 5, 'the boss camera mode is 5');
check(SCRIPTED_CAMERA_MODES.includes(5) && SCRIPTED_CAMERA_MODES.includes(9), 'modes 5 and 9 are scripted');

// The records: the bytes read at the VAs (u32 at +0: type byte, flags byte, u16 word;
// floats at +4 and +8). 0x9A5B14 = 0x100, 0x9A5BA4 = 0x200, 0x9A5C10 = 0x600, 0x9A5CE0 = 0x500.
eq(CAMERA_RECORDS.r9a5b14.flags, 1, '0x9A5B14 flags');
eq(CAMERA_RECORDS.r9a5ba4.flags, 2, '0x9A5BA4 flags');
eq(CAMERA_RECORDS.r9a5c10.flags, 6, '0x9A5C10 flags');
eq(CAMERA_RECORDS.r9a5ce0.flags, 5, '0x9A5CE0 flags');
for (const r of Object.values(CAMERA_RECORDS)) {
  eq(r.type, 0, `record ${r.va.toString(16)} type`);
  eq(r.word, 0, `record ${r.va.toString(16)} word`);
  check(r.b === 0 || r.b === 0.5, `record ${r.va.toString(16)} float +8 is 0 or 0.5`);
}
eq(CAMERA_RECORDS.r9a5b14.b, 0.5, '0x9A5B14 float +8 is 0.5 (0x3F000000)');

// The seven cutscene objects, one call site each for the mode, the pair and the record.
eq(CUTSCENE_CAMERAS.length, 7, 'seven cutscene camera objects');
const ctors = CUTSCENE_CAMERAS.map((c) => c.ctor);
check(new Set(ctors).size === ctors.length, 'the ctors are distinct');
for (const c of CUTSCENE_CAMERAS) {
  check(c.modePush > c.ctor && c.pair > c.modePush && (c.record === null || c.record > c.pair), `${c.object}: calls are in order`);
  check(c.time === null || c.time > 0, `${c.object}: time is positive`);
}
// Each object's record is a constant or a run-time block (null), never both.
for (const c of CUTSCENE_CAMERAS) {
  if (c.recordVa !== null) check(c.recordVa in CAMERA_RECORDS, `${c.object}: record key`);
}
eq(CUTSCENE_CAMERAS.find((c) => c.object === 'ctor4513d4')!.time, 0x392d, 'DEMO_WARP0 object time 0x392D');

// The scene owners: each names a listed object and the scene number is the exe's SCENE.
const names = new Set(CUTSCENE_CAMERAS.map((c) => c.object));
for (const [scene, object] of Object.entries(SCENE_CUTSCENE_CAMERA)) {
  check(names.has(object), `scene ${scene} owner ${object} is listed`);
}
eq(SCENE_CUTSCENE_CAMERA[SCENE.demoWarp0], 'ctor4513d4', 'DEMO_WARP0 owns 0x4513D4');
eq(SCENE_CUTSCENE_CAMERA[SCENE.getRing], 'ctor44ffd8', 'GET RING owns 0x44FFD8');
eq(SCENE_CUTSCENE_CAMERA[SCENE.dieType2], 'ctor44fa8c', 'DIE TYPE2 owns 0x44FA8C');
eq(SCENE_CUTSCENE_CAMERA[SCENE.appType2], 'ctor44f4ec', 'APP TYPE2 owns 0x44F4EC');
eq(SCENE_CUTSCENE_CAMERA[SCENE.demoWarp2], 'ctor45072c', 'DEMO_WARP2 owns 0x45072C');
eq(SCENE_CUTSCENE_CAMERA[SCENE.dieType3], 'ctor450fc4', 'DIE TYPE3 owns 0x450FC4');
eq(SCENE_NAMES[SCENE.dieType3], 'DIE TYPE3', 'the scene name table agrees');

// The view seam: null for every scene until the update is ported.
for (let s = 0; s < 16; s++) eq(bossCameraView(s), null, `scene ${s} has no boss view yet`);

// The control exposes the same seam for the current scene.
const rows = { darvant: EMPTY_ROW, df1: EMPTY_ROW, df2: EMPTY_ROW, df3: EMPTY_ROW, darvantFalz: EMPTY_ROW };
const ai = new DarkFalzAi({ x: 0, z: 0, angle: 0, difficulty: 0, rows, leader: () => true, selfId: () => 0, partySize: () => 1, rng: () => 0.5 });
eq(ai.cameraView(), null, 'the control reports no boss view at its start');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('darkfalzcamera tests passed');
