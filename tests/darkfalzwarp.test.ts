// Dark Falz's DEMO_WARP0 cutscene object (exe ctor 0x004513D4, update 0x004512E0,
// render 0x00451334): the timer -> frame rule (demoWarpFrame in
// client/src/combat/darkfalz.ts), the parts the controller spec builds for it
// (client/src/formats/enemymodels.ts, case 0xc8) and their names in darkfalz_dat.bml.
// The model and motion names come from the same descriptor the spec uses, so a
// wrong index shows here. The pivot is the exe's (-20000, 0, 0).
//
// Run: node tests/darkfalzwarp.test.ts
import { demoWarpFrame, SCENE } from '../client/src/combat/darkfalz.ts';
import { SCENE_FRAMES } from '../client/src/combat/darkfalzcommon.ts';
import { DEMO_WARP_PARTS, DEMO_WARP_PIVOT, enemyAsset, enemyModelFor, type EnemyModelContext } from '../client/src/formats/enemymodels.ts';
import type { EnemySet } from '../client/src/formats/setdata.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);

// The timer: -1 at the ctor, +1 per update, held at 120. The port counts the scene
// frames from 1 at the first tick (darkfalz.ts tick), so the frame is sceneFrames - 1.
eq(demoWarpFrame(SCENE.demoWarp0, 1), 0, 'first tick is frame 0');
eq(demoWarpFrame(SCENE.demoWarp0, 2), 1, 'second tick is frame 1');
eq(demoWarpFrame(SCENE.demoWarp0, SCENE_FRAMES.demoWarp0), SCENE_FRAMES.demoWarp0 - 1, 'frame 119 before the cap');
eq(demoWarpFrame(SCENE.demoWarp0, 500), SCENE_FRAMES.demoWarp0, 'held at 120');
eq(demoWarpFrame(SCENE.waitCasket, 5), null, 'no object before DEMO_WARP0');
eq(demoWarpFrame(SCENE.demoWarp1, 5), null, 'no object after DEMO_WARP0');
eq(SCENE_FRAMES.demoWarp0, 120, 'the cap is the scene timer 0xA44EAC = 120');

// The pivot: the ctor writes -20000 to 0xA45068 (the camera pivot), the render uses 0xA45058.
eq(DEMO_WARP_PIVOT[0], -20000, 'pivot x');
eq(DEMO_WARP_PIVOT[1], 0, 'pivot y');
eq(DEMO_WARP_PIVOT[2], 0, 'pivot z');

// The descriptor (0x009A5900, darkfalz_dat.bml): NJCM chunk indices 14, 16, 17 and
// the NJM index table at 0x009A5CD4 (-1, 38, 39), read from the exe's data.
const asset = enemyAsset('darkfalz_dat.bml');
check(asset !== null, 'darkfalz_dat.bml asset descriptor');
if (asset) {
  eq(asset.models[14], 'df_event_tower.nj', 'model 14 is the event tower');
  eq(asset.models[16], 'fd_obj813_face.nj', 'model 16 is the face');
  eq(asset.models[17], 'fd_obj813_flower01.nj', 'model 17 is the flower');
  eq(asset.motions[38], 'fd_obj813_face.njm', 'motion 38 is the face');
  eq(asset.motions[39], 'fd_obj813_flower01.njm', 'motion 39 is the flower');
}

// The controller spec (Dark Falz, type 0xc8): the three warp parts.
const set = {
  kind: 'enemy', index: 0, type: 0xc8, floor: 14, section: 0, position: [0, 0, 0], rotation: [0, 0, 0],
  numChildren: 0, wave: 0, wave2: 0, unknownA1: 0, params: [0, 0, 0, 0, 0, 0, 0],
} as unknown as EnemySet;
const ctx: EnemyModelContext = { area: 0x2e, episode: 1, difficulty: 0, event: 0, online: false };
const spec = enemyModelFor(set, ctx);
check(spec !== null && spec.bml === 'darkfalz_dat.bml', 'type 0xc8 is the Dark Falz spec');
const parts = spec?.parts ?? [];
const warp = parts.filter((p) => p.place === 'world');
eq(warp.length, 3, 'three world-placed warp parts');
const byName = (name: string) => warp.find((p) => p.name === name);
const tower = byName(DEMO_WARP_PARTS.tower);
const face = byName(DEMO_WARP_PARTS.face);
const flower = byName(DEMO_WARP_PARTS.flower);
eq(tower?.model, 14, 'tower is model 14');
eq(tower?.motion ?? null, null, 'tower has no motion');
eq(face?.model, 16, 'face is model 16');
eq(face?.motion?.index, 38, 'face motion 38');
eq(face?.motion?.speed, 0, 'face motion is not stepped (the controller sets the frame)');
eq(flower?.model, 17, 'flower is model 17');
eq(flower?.motion?.index, 39, 'flower motion 39');
for (const p of warp) {
  eq(p.offset?.[0], DEMO_WARP_PIVOT[0], `${p.name} x at the pivot`);
  eq(p.offset?.[1], DEMO_WARP_PIVOT[1], `${p.name} y at the pivot`);
  eq(p.offset?.[2], DEMO_WARP_PIVOT[2], `${p.name} z at the pivot`);
  eq(p.hidden, true, `${p.name} is built hidden`);
}
eq(parts.length, 15, 'controller spec: 12 Dark Falz parts + 3 warp parts');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('darkfalzwarp tests passed');
