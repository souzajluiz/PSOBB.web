// Dark Falz's boss camera (client/src/combat/darkfalzcamera.ts): the mode the
// cutscene objects push, the records they pass (decoded from the exe's bytes),
// the scene -> object owners, the per-frame update (MapObjectEntity_UpdateTransform_004d68a0),
// the view composition (the up vector from the roll), and the view seam. The motion
// file is parsed by client/src/formats/cameramotion.ts: a synthetic REL with hand-computed
// samples, and bo04opcam.rel from data.gsl when it is present (skipped otherwise). The
// synthetic motion below is a test fixture, not a game value.
//
// Run: node tests/darkfalzcamera.test.ts
import fs from 'node:fs';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { parseCameraRel, sampleCameraMotion } from '../client/src/formats/cameramotion.ts';
import {
  BOSS_CAMERA_MODE,
  CAMERA_FLAG,
  CAMERA_RECORDS,
  CUTSCENE_CAMERAS,
  DARKFALZ_CAMERA_FILE,
  DARKFALZ_CAMERA_TYPE_FLAGS,
  SCENE_CUTSCENE_CAMERA,
  SCRIPTED_CAMERA_MODES,
  bossCameraView,
  cameraSourceOf,
  composeCameraUp,
  stepCameraObject,
  type BossCameraSource,
  type CameraObject,
  type MotionSample,
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
const near = (a: number, b: number, msg: string) => check(Math.abs(a - b) < 1e-6, `${msg}: got ${a}, want ${b}`);
const nearV = (a: readonly number[], b: readonly number[], msg: string) =>
  a.forEach((v, i) => near(v, b[i], `${msg}[${i}]`));

// The mode: every cutscene object's first camera call is SetCameraMode 5 (0x004D31F4).
eq(BOSS_CAMERA_MODE, 5, 'the boss camera mode is 5');
check(SCRIPTED_CAMERA_MODES.includes(5) && SCRIPTED_CAMERA_MODES.includes(9), 'modes 5 and 9 are scripted');

// The records: u32 at +0 is the type byte, the MOTION INDEX byte (+1, -> +0x9D), the u16 word;
// the floats are the start frame (+4) and the frame step (+8). 0x9A5B14 = 0x100, 0x9A5BA4 = 0x200,
// 0x9A5C10 = 0x600, 0x9A5CE0 = 0x500 (exe bytes, tools/exedata.py read).
eq(CAMERA_RECORDS.r9a5b14.index, 1, '0x9A5B14 motion index');
eq(CAMERA_RECORDS.r9a5ba4.index, 2, '0x9A5BA4 motion index');
eq(CAMERA_RECORDS.r9a5c10.index, 6, '0x9A5C10 motion index');
eq(CAMERA_RECORDS.r9a5ce0.index, 5, '0x9A5CE0 motion index');
for (const r of Object.values(CAMERA_RECORDS)) {
  eq(r.type, 0, `record ${r.va.toString(16)} type`);
  eq(r.word, 0, `record ${r.va.toString(16)} word`);
  eq(r.a, 0, `record ${r.va.toString(16)} start frame`);
  check(r.b === 0 || r.b === 0.5, `record ${r.va.toString(16)} step is 0 or 0.5`);
}
eq(CAMERA_RECORDS.r9a5b14.b, 0.5, '0x9A5B14 step is 0.5 (0x3F000000)');
eq(CAMERA_RECORDS.r9a5c10.b, 0, '0x9A5C10 step is 0');

// The map's camera asset: type 0 of map 14 is Bo04OpCam.rel, flags 0x48 (exe 0x009ACDEC).
eq(DARKFALZ_CAMERA_FILE, 'Bo04OpCam.rel', 'the camera asset file (0x009095F0)');
eq(DARKFALZ_CAMERA_TYPE_FLAGS, 0x48, 'the type 0 flags dword');
check((DARKFALZ_CAMERA_TYPE_FLAGS & (CAMERA_FLAG.relative | CAMERA_FLAG.flat)) === 0, 'type 0 is the yaw / pivot branch');

// The seven cutscene objects, one call site each for the mode, the pair and the record.
eq(CUTSCENE_CAMERAS.length, 7, 'seven cutscene camera objects');
const ctors = CUTSCENE_CAMERAS.map((c) => c.ctor);
check(new Set(ctors).size === ctors.length, 'the ctors are distinct');
for (const c of CUTSCENE_CAMERAS) {
  check(c.modePush > c.ctor && c.pair > c.modePush && (c.record === null || c.record > c.pair), `${c.object}: calls are in order`);
  check(c.time === null || c.time > 0, `${c.object}: time is positive`);
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

// --- the per-frame update (synthetic fixtures: the math, not the game's motion) ---
const fixture = (over: Partial<CameraObject> = {}): CameraObject => ({
  frame: 0,
  step: 0.5,
  index: 5,
  flags: DARKFALZ_CAMERA_TYPE_FLAGS,
  pivot: [100, 0, 0],
  yaw: 0,
  time: 0,
  done: false,
  roll: 0,
  eye: [0, 0, 0],
  target: [0, 0, 0],
  ...over,
});
const sample = (over: Partial<MotionSample> = {}): MotionSample => ({
  pos: [1, 2, 3],
  dir: [0, 0, 5],
  roll: 0,
  frames: 4,
  time: 77,
  ...over,
});

// The yaw / pivot branch (type flags 0x48): the direction is normalized, both turn by the
// yaw, the eye moves to the pivot, the target is eye + direction.
{
  const o = fixture();
  stepCameraObject(o, sample(), 0x392d);
  nearV(o.eye, [101, 2, 3], 'pivot branch eye');
  nearV(o.target, [101, 2, 4], 'pivot branch target (dir normalized to 1)');
  eq(o.time, 0x392d, 'the time is the UpdateCameraState time');
  near(o.frame, 0.5, 'the frame advances by the step');
}
// The yaw is BAMS (16384 = 90 degrees): x' = cos x + sin z, z' = -sin x + cos z.
{
  const o = fixture({ pivot: [0, 0, 0], yaw: 16384 });
  stepCameraObject(o, sample({ pos: [1, 0, 0], dir: [0, 0, 1] }), 1);
  nearV(o.eye, [0, 0, -1], 'yaw 90 turns the position');
  nearV(o.target, [1, 0, -1], 'yaw 90 turns the direction (0,0,1) to (1,0,0) before adding the eye');
}
// The relative branch (0x4): no pivot, no yaw.
{
  const o = fixture({ flags: CAMERA_FLAG.relative });
  stepCameraObject(o, sample(), 1);
  nearV(o.eye, [1, 2, 3], 'relative eye is the position');
  nearV(o.target, [1, 2, 8], 'relative target is position + direction (not normalized)');
}
// The flat branch (0x84): time forced to 0x36C1, the direction flattened and scaled by 40.
{
  const o = fixture({ flags: CAMERA_FLAG.relative | CAMERA_FLAG.flat });
  stepCameraObject(o, sample({ pos: [10, 2, 10], dir: [3, 7, 4] }), 1);
  eq(o.time, 0x36c1, 'flat branch forces the time');
  nearV(o.eye, [10 - 0.6 * 40, 2, 10 - 0.8 * 40], 'flat eye is pos minus 40 x the flat unit direction');
  nearV(o.target, [13, 9, 14], 'flat target is pos + dir');
}
// The time -1 takes the motion's own time, else the given one.
{
  const a = fixture();
  stepCameraObject(a, sample({ time: 77 }), -1);
  eq(a.time, 77, 'time -1 takes the motion time');
  const b = fixture();
  stepCameraObject(b, sample({ time: 77 }), 0x416c);
  eq(b.time, 0x416c, 'a time is kept');
}
// The path: start 0, step 0.5, last frame 3 (count 4). Six updates stay in range; the
// seventh passes the end and clamps to 3 and marks the path done.
{
  const o = fixture({ frame: 0, step: 0.5, flags: CAMERA_FLAG.relative });
  for (let i = 0; i < 6; i++) stepCameraObject(o, sample(), 1);
  near(o.frame, 3, 'six steps reach the last frame');
  check(!o.done, 'the path is not done at the last frame');
  stepCameraObject(o, sample(), 1);
  near(o.frame, 3, 'past the end the frame clamps to the last frame');
  check(o.done, 'the path is done past the end');
}
// The loop flag (0x20) restarts the frame at 0 and does not mark the path done.
{
  const o = fixture({ frame: 0, step: 0.5, flags: CAMERA_FLAG.relative | CAMERA_FLAG.loop });
  for (let i = 0; i < 7; i++) stepCameraObject(o, sample(), 1);
  eq(o.frame, 0, 'a loop restarts at 0');
  check(!o.done, 'a loop is not done');
}

// --- the seam -------------------------------------------------------------------
// A synthetic source: the motion's position is its frame on x (test fixture), the pivot is
// DEMO_WARP0's (-20000, 0, 0) from the DEVLOG, yaw 0 (not a game value: the exe's yaw is run time).
const synthetic: BossCameraSource = {
  motion: (index: number, frame: number) => (index === 5 ? { pos: [frame, 0, 0], dir: [0, 0, 1], roll: 0, frames: 100, time: 0 } : null),
  pivot: (object: string) => (object === 'ctor4513d4' ? { pivot: [-20000, 0, 0], yaw: 0 } : null),
};

// Without a source (the game today: the motion is not read) every scene reads null.
for (let s = 0; s < 16; s++) eq(bossCameraView(s, 0, null), null, `scene ${s} has no boss view without the source`);
// The source's gaps each give null: an unlisted scene, a run-time record, no pivot, no motion.
eq(bossCameraView(SCENE.editor, 0, synthetic), null, 'an unlisted scene has no boss view');
eq(bossCameraView(SCENE.dieType2, 0, synthetic), null, 'a run-time record (DIE TYPE2) has no view yet');
eq(bossCameraView(SCENE.getRing, 0, synthetic), null, 'GET RING (its pivot is a register) has no view yet');
eq(bossCameraView(SCENE.demoWarp2, 0, synthetic), null, 'DEMO_WARP2 (run-time record) has no view yet');
eq(bossCameraView(SCENE.dieType3, 0, synthetic), null, 'DIE TYPE3 (run-time record) has no view yet');
eq(bossCameraView(SCENE.demoWarp0, 0, { ...synthetic, pivot: () => null }), null, 'an unresolved pivot gives no view');
eq(bossCameraView(SCENE.demoWarp0, 0, { ...synthetic, motion: () => null }), null, 'no motion gives no view');

// With the fixture: frame k is the (k+1)th update; the motion is read at 0.5 k (start 0, step 0.5).
{
  const v0 = bossCameraView(SCENE.demoWarp0, 0, synthetic);
  check(v0 !== null, 'DEMO_WARP0 has a view with the fixture');
  if (v0) {
    nearV(v0.source, [-20000, 0, 0], 'frame 0 eye (the first update reads frame 0)');
    nearV(v0.target, [-20000, 0, 1], 'frame 0 target');
  }
  const v4 = bossCameraView(SCENE.demoWarp0, 4, synthetic);
  if (v4) nearV(v4.source, [-20000 + 0.5 * 4, 0, 0], 'frame 4 eye follows the motion at 0.5 per frame');
  else check(false, 'frame 4 has a view');
  // The same result by stepping the object by hand.
  const o = fixture({ frame: 0, step: 0.5, pivot: [-20000, 0, 0], yaw: 0, flags: DARKFALZ_CAMERA_TYPE_FLAGS });
  for (let i = 0; i <= 4; i++) stepCameraObject(o, synthetic.motion(5, o.frame)!, 0x392d);
  nearV(o.eye, v4!.source, 'the seam steps the same update as stepCameraObject');
}

// The control exposes the same seam for the current scene (null until a source is given).
const rows = { darvant: EMPTY_ROW, df1: EMPTY_ROW, df2: EMPTY_ROW, df3: EMPTY_ROW, darvantFalz: EMPTY_ROW };
const ai = new DarkFalzAi({ x: 0, z: 0, angle: 0, difficulty: 0, rows, leader: () => true, selfId: () => 0, partySize: () => 1, rng: () => 0.5 });
eq(ai.cameraView(), null, 'the control reports no boss view at its start');
eq(ai.cameraView(synthetic), null, 'the control at its start (editor scene) has no view even with a source');


// --- the view composition (MapObjectEntity_UpdateCamera_004d6BC0) ----------------
// roll 0 keeps the up vector; the yaw is atan2(dx, dz) in BAMS (65536 a turn).
eq(composeCameraUp([0, 0, 1], 0)[1], 1, 'roll 0: up is (0, 1, 0)');
nearV(composeCameraUp([0, 0, 1], 16384), [-1, 0, 0], 'dir +z, roll 90 degrees: up is -x');
nearV(composeCameraUp([1, 0, 0], 16384), [0, 0, 1], 'dir +x (yaw 90), roll 90: up is +z');
const s2 = Math.SQRT1_2;
nearV(composeCameraUp([1, 0, 1], 16384), [-s2, 0, s2], 'dir (1,0,1) (yaw 45), roll 90: up is (-s, 0, s)');
{
  // |up| = 1, and up . dir = cos(roll) * dy (the yaw cancels): checked for an arbitrary direction.
  const d: [number, number, number] = [-72.084, 12.041, -175.723];
  const up = composeCameraUp(d, 82);
  near(Math.hypot(...up), 1, 'the up vector is a unit vector');
  // The yaw is truncated to whole BAMS (one step of error at most), so the identity holds to that bound.
  const bound = Math.hypot(d[0], d[2]) * Math.abs(Math.sin((82 * 2 * Math.PI) / 65536)) * ((2 * Math.PI) / 65536) + 1e-9;
  check(Math.abs(up[0] * d[0] + up[1] * d[1] + up[2] * d[2] - Math.cos((82 * 2 * Math.PI) / 65536) * d[1]) <= bound, 'up . dir = cos(roll) dy (to the yaw truncation)');
}

// --- the camera file format (formats/cameramotion.ts) ---------------------------
// A synthetic REL: root {motions, count}; motion 0 = type 0x181 (position, roll, time) with
// the keys (0,0,0)/(10,20,30), roll 0 -> 16384 and time 100 -> 200 over frames 0 and 10;
// motion 1 = type 0x41 (position, B = key - A) with one B key (30, 20, 10).
function buildCameraRel(): Uint8Array {
  const buf = new Uint8Array(0x400);
  const dv = new DataView(buf.buffer);
  let top = 0x20;
  const alloc = (n: number) => {
    const at = top;
    top += n;
    return at;
  };
  const vec = (at: number, frame: number, x: number, y: number, z: number) => {
    dv.setUint32(at, frame, true);
    dv.setFloat32(at + 4, x, true);
    dv.setFloat32(at + 8, y, true);
    dv.setFloat32(at + 12, z, true);
  };
  const int = (at: number, frame: number, v: number) => {
    dv.setUint32(at, frame, true);
    dv.setInt32(at + 4, v, true);
  };
  const posKeys = alloc(0x20);
  vec(posKeys, 0, 0, 0, 0);
  vec(posKeys + 0x10, 10, 10, 20, 30);
  const rollKeys = alloc(0x10);
  int(rollKeys, 0, 0);
  int(rollKeys + 8, 10, 16384);
  const timeKeys = alloc(0x10);
  int(timeKeys, 0, 100);
  int(timeKeys + 8, 10, 200);
  const bKeys = alloc(0x10);
  vec(bKeys, 0, 30, 20, 10);
  // motion 0: mdata = 3 pointers then 3 counts
  const md0 = alloc(0x18);
  for (const [i, p] of [posKeys, rollKeys, timeKeys].entries()) dv.setUint32(md0 + i * 4, p, true);
  for (const [i, c] of [2, 2, 2].entries()) dv.setUint32(md0 + 12 + i * 4, c, true);
  const md1 = alloc(0x10);
  dv.setUint32(md1, posKeys, true);
  dv.setUint32(md1 + 4, bKeys, true);
  dv.setUint32(md1 + 8, 2, true);
  dv.setUint32(md1 + 12, 1, true);
  const m0 = alloc(12);
  dv.setUint32(m0, md0, true);
  dv.setUint32(m0 + 4, 20, true);
  dv.setUint16(m0 + 8, 0x181, true);
  dv.setUint16(m0 + 10, 3, true);
  const m1 = alloc(12);
  dv.setUint32(m1, md1, true);
  dv.setUint32(m1 + 4, 30, true);
  dv.setUint16(m1 + 8, 0x41, true);
  dv.setUint16(m1 + 10, 2, true);
  const arr = alloc(8);
  dv.setUint32(arr, m0, true);
  dv.setUint32(arr + 4, m1, true);
  const root = alloc(8);
  dv.setUint32(root, arr, true);
  dv.setUint32(root + 4, 2, true);
  // the footer: relocations (none), root at len - 0x10
  const len = (top + 0x20 + 0xf) & ~0xf;
  const out = new Uint8Array(len);
  out.set(buf.subarray(0, len));
  const f = new DataView(out.buffer);
  f.setUint32(len - 0x10, root, true);
  return out;
}
{
  const rel = parseCameraRel(buildCameraRel());
  eq(rel.motions.length, 2, 'the synthetic file has two motions');
  eq(rel.motions[0].frameCount, 20, 'motion 0 frame count (NJS_MOTION +4)');
  eq(rel.motions[0].type, 0x181, 'motion 0 type');
  eq(rel.motions[0].elements.map((e) => e.bit).join(','), `${0x1},${0x80},${0x100}`, 'motion 0 elements in storage order');
  const at = (f: number) => sampleCameraMotion(rel.motions[0], f);
  nearV(at(0).pos, [0, 0, 0], 'frame 0 position');
  eq(at(0).roll, 0, 'frame 0 roll');
  nearV(at(5).pos, [5, 10, 15], 'frame 5 position (linear between the keys)');
  eq(at(5).roll, 8192, 'frame 5 roll (16384 / 2)');
  eq(at(5).time, 150, 'frame 5 time (100 + 50)');
  eq(at(3).roll, 4915, 'an int key truncates toward zero (16384 * 0.3 = 4915.2)');
  nearV(at(2.5).pos, [2.5, 5, 7.5], 'a fractional frame: the bracket is the key at round(2.5) = 2, t = 0.25 of the span');
  nearV(at(10).pos, [10, 20, 30], 'the last key holds');
  nearV(at(40).pos, [10, 20, 30], 'past the last key the value holds (no wrap)');
  eq(at(40).time, 200, 'past the last key the int holds');
  const b = sampleCameraMotion(rel.motions[1], 0);
  nearV(b.pos, [0, 0, 0], 'motion 1 position');
  nearV(b.dir, [30, 20, 10], 'motion 1 B = the key minus A (A = 0)');
  const b10 = sampleCameraMotion(rel.motions[1], 10);
  nearV(b10.pos, [10, 20, 30], 'motion 1 position at frame 10');
  nearV(b10.dir, [20, 0, -20], 'motion 1 B at frame 10 = key (30, 20, 10) minus A (10, 20, 30)');
  eq(b10.roll, 0, 'a motion without the roll element has roll 0');
}

// The real file, when data.gsl is present (the same name in any case: bo04opcam.rel).
const GSL = '/Users/junior/Downloads/psobb-client/data/data.gsl';
if (fs.existsSync(GSL)) {
  const gsl = new GSLArchive(new Uint8Array(fs.readFileSync(GSL)));
  const name = [...gsl.entries.keys()].find((n) => n.toLowerCase() === 'bo04opcam.rel');
  if (!name) check(false, 'data.gsl has bo04opcam.rel');
  else {
    const rel = parseCameraRel(gsl.get(name));
    eq(rel.motions.length, 7, 'bo04opcam.rel has seven motions');
    eq(rel.motions.map((m) => m.frameCount).join(','), '120,140,150,120,150,121,150', 'bo04opcam.rel frame counts');
    check(rel.motions.every((m) => m.type === 0x1c1), 'every motion of bo04opcam.rel has type 0x1c1');
    for (const [i, { roll }] of [[2, { roll: 82 }]] as const) {
      const m = sampleCameraMotion(rel.motions[i], 10);
      eq(m.roll, roll, `motion ${i} roll at frame 10`);
      const up = composeCameraUp(m.dir, m.roll);
      near(Math.hypot(...up), 1, `motion ${i} up is a unit vector`);
      const bound = Math.hypot(m.dir[0], m.dir[2]) * Math.abs(Math.sin((roll * 2 * Math.PI) / 65536)) * ((2 * Math.PI) / 65536) + 1e-9;
      const dot = up[0] * m.dir[0] + up[1] * m.dir[1] + up[2] * m.dir[2];
      check(Math.abs(dot - Math.cos((roll * 2 * Math.PI) / 65536) * m.dir[1]) <= bound, `motion ${i} up . dir = cos(roll) dy (to the yaw truncation)`);
    }
    // The first motion's B is the key minus A: at frame 0 its eye is the first position key.
    const m1 = sampleCameraMotion(rel.motions[1], 0);
    nearV(m1.pos, [110.87528991699219, 157.8880157470703, 72.7130355834961], 'bo04opcam motion 1 eye at frame 0 (the first key)');
    check(m1.dir.every(Number.isFinite), 'bo04opcam motion 1 dir is finite');
    // The source of the seam: DEMO_WARP0 (motion 5, the pivot (-20000, 0, 0)) gives a view.
    const v = bossCameraView(SCENE.demoWarp0, 0, cameraSourceOf(rel));
    check(v !== null && v.up.length === 3, 'DEMO_WARP0 has a view from the real file');
    if (v) nearV(v.up, [0, 1, 0], 'DEMO_WARP0 frame 0: roll 0, so up is (0, 1, 0)');
  }
} else {
  console.log('darkfalzcamera: data.gsl not found, the real-file checks are skipped');
}

// The static pivots (no file needed): DEMO_WARP0 and the Dark Falz object have constant pivots from the exe;
// every scene whose pivot is an entity or the brain's field is live, so the source gives null for it.
{
  const stat = cameraSourceOf({ motions: [] } as never);
  const w0 = stat.pivot('ctor4513d4');
  nearV(w0 ? w0.pivot : [NaN], [-20000, 0, 0], 'DEMO_WARP0 pivot (BSS 0x00A45068)');
  eq(w0 ? w0.yaw : NaN, 0, 'DEMO_WARP0 yaw 0 (no writer of 0x00A45078 in the exe)');
  const dark = stat.pivot('ctor44ec14');
  nearV(dark ? dark.pivot : [NaN], [0, 0, -120], 'Dark Falz object pivot (BSS 0x00A44F34, FUN_0044EDAC)');
  eq(dark ? dark.yaw : NaN, 0, 'Dark Falz object yaw 0 (no reference to 0x00A44F28)');
  for (const live of ['ctor44f4ec', 'ctor44fa8c', 'ctor44ffd8', 'ctor45072c', 'ctor450fc4']) {
    eq(stat.pivot(live), null, `${live} pivot is live (no static source)`);
  }
  // The camera's per-frame eye/target copy is from the mode object (+0x3C / +0x48, FUN_004d1ff4): the CUTSCENE_CAMERAS
  // record of each cutscene matches the call sites checked in the exe (pair, record, mode push).
  eq(CUTSCENE_CAMERAS.find((c) => c.object === 'ctor4513d4')?.pair, 0x451514, 'DEMO_WARP0 pair call site');
  eq(CUTSCENE_CAMERAS.find((c) => c.object === 'ctor44ec14')?.pivot.startsWith('BSS 0x00A44F34'), true, 'Dark Falz pivot note');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('darkfalzcamera tests passed');
