// Warp menus, warps, doors and switches of the game floors (render/warpmenu.ts,
// render/fieldobjects.ts): Ragol teleporter entries per episode, window
// layouts, the boss warp table, door state machine, and the warp/door objects
// found in the client's set data for free-play variation 0.
// Run: node tests/warpmenu.test.ts   (Env: PSOBB_DATA = client data/ folder)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { parseSetFile, placeEntities, type ObjectSet } from '../client/src/formats/setdata.ts';
import { floorFiles, parseSetDataTable } from '../client/src/formats/setdatatable.ts';
import { parseMapNRel } from '../client/src/formats/nrel.ts';
import { floorToArea } from '../client/src/net/game.ts';
import { parseUnitxt } from '../client/src/classic/charcreate_text.ts';
import { AREA_TEXT, areaWarpLayout, CCA_WARP, ccaWarpLayout, mainWarpItems, mainWarpLayout, mainWarpMask } from '../client/src/render/warpmenu.ts';
import { objectModelFor } from '../client/src/formats/objectmodels.ts';
import { bossWarpFloor, collectFieldObjects, doorFlags, doorLamps, stepDoor, type FieldDoor } from '../client/src/render/fieldobjects.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// --- Ragol teleporter (FUN_0064a428 / FUN_00649cec) ---
eq(mainWarpMask(1), 0xa5, 'Ep1 mask');
eq(mainWarpItems(1), [{ floor: 1, text: 0 }, { floor: 3, text: 2 }, { floor: 6, text: 5 }, { floor: 8, text: 7 }], 'Ep1 entries');
eq(mainWarpItems(2).map((i) => i.floor), [1, 3, 5, 10], 'Ep2 entries (type 0)');
eq(mainWarpItems(2, 1).map((i) => i.floor), [1, 3], 'Ep2 entries (type 1, VR)');
eq(mainWarpItems(2, 2).map((i) => i.floor), [5, 10], 'Ep2 entries (type 2, CCA)');
eq(mainWarpItems(2).map((i) => i.text), [17, 19, 21, 26], 'Ep2 names');
eq(mainWarpItems(3).map((i) => i.floor), [1, 2, 3, 4, 5, 6], 'Ep4 entries');
eq(mainWarpItems(3).map((i) => i.text), [34, 35, 36, 37, 38, 39], 'Ep4 names');
eq(mainWarpItems(1, 0, 1 << 1).map((i) => i.floor), [1, 2, 3, 6, 8], 'quest bit adds Forest 2');
eq(mainWarpLayout(4), { x: 176, y: 130, w: 288, h: 94 }, 'Ep1 window');
eq(mainWarpLayout(9).h, 160, 'height capped at 160');
eq(areaWarpLayout(50), { x: 267, y: 130, w: 70, h: 34 }, 'area warp window');

// --- CCA main gate (TObjWarpJungMain: 0x009c9660 floors, 0x009c9654 names) ---
eq(CCA_WARP.map((i) => i.floor), [6, 8, 9], 'CCA gate floors: Jungle North, Mountain, Seaside');
eq(CCA_WARP.map((i) => i.text), [22, 24, 25], 'CCA gate names');
eq(ccaWarpLayout(100), { x: 176, y: 130, w: 120, h: 74 }, 'CCA gate window (FUN_0073608c)');

// --- Boss warp destinations (0x0097f380) ---
eq([1, 2, 3, 6, 8, 10].map((f) => bossWarpFloor(1, f)), [0xb, 0xb, 0xc, 0xd, 0xe, 0xe], 'Ep1 boss floors');
eq([1, 3, 5, 10, 11].map((f) => bossWarpFloor(2, f)), [0xe, 0xf, 0xc, 0xd, 0xd], 'Ep2 boss floors');
eq([1, 5, 8].map((f) => bossWarpFloor(3, f)), [9, 9, 9], 'Ep4 boss floor');

// --- Boss warp parts by 6x6A state (SeabedTuriganeMapObjectRender_0066c38c) ---
{
  const bw = (area: number, episode: number) =>
    objectModelFor({ kind: 'object', index: 0, type: 0x19, floor: 0, group: 0, section: 0, unknownA3: 0, position: [0, 0, 0], rotation: [0, 0, 0], params: [0, 0, 0, 0, 0, 0] }, { area, episode })!;
  eq(bw(2, 1).parts.map((p) => [p.model, p.motion ?? -1, p.show ?? 'always', p.drive ?? '']), [[0, -1, 'always', ''], [2, 1, 'idle', 'restart-last'], [1, 0, 'active', 'restart-last']], 'Forest boss warp: idle model 2 / motion 1, active model 1 / motion 0');
  eq(bw(0x13, 2).parts.map((p) => [p.model, p.motion ?? -1, p.show ?? 'always']), [[0, -1, 'always'], [1, 0, 'idle'], [1, 0, 'active']], 'jungle boss warp: model 1 / motion 0 in both');
  eq(bw(9, 1).bml, 'bm_obj_warpboss_ancient.bml', 'Ruins boss warp archive');
}

// --- Doors ---
const obj = (type: number, p4: number, p5 = 0): ObjectSet => ({ kind: 'object', index: 0, type, floor: 0, group: 0, section: 0, unknownA3: 0, position: [0, 0, 0], rotation: [0, 0, 0], params: [0, 0, 0, p4, p5, 0] });
eq(doorFlags(obj(0x80, 0x0307)), { flags: [7], locked: false }, 'TObjDoor flag = param4 & 0xff');
eq(doorFlags(obj(0xc2, -1)), { flags: [], locked: false }, 'TODoorCave02 negative = open');
eq(doorFlags(obj(0xc2, 0x101)), { flags: [], locked: true }, 'TODoorCave02 > 0x100 = locked');
eq(doorFlags(obj(0xc1, 0x10, 1)), { flags: [0x10, 0x11, 0x12], locked: false }, 'TODoorCave01 three flags');
eq(doorFlags(obj(0x14b, 0x20)), { flags: [0x20, 0x21], locked: false }, 'TODoorAncient09 two flags');
eq(doorFlags(obj(0x1ab, 0x30, 2)), { flags: [0x30, 0x31], locked: false }, 'four-light Ruins door: param5 flags');
eq(doorFlags(obj(0x1c0, 0x30, 0)), { flags: [], locked: false }, 'four-light Space door: no flag = open');
eq(doorFlags(obj(0x221, 0x30, 7)), { flags: [0x30, 0x31, 0x32, 0x33], locked: false }, 'Seabed four-light door: param5 clamped to 4');
eq(doorFlags(obj(0x222, -1, 3)), { flags: [], locked: false }, 'Seabed four-light door: negative = open');
eq(doorFlags(obj(0x1ab, 0x101, 3)), { flags: [], locked: true }, 'four-light door: > 0x100 = locked');
{
  const d = { flags: [0x30, 0x31, 0x32] } as FieldDoor;
  eq(doorLamps(d, false, new Set([0x31])), [false, true, false, true], 'lamps: flag set or no flag = lit');
  eq(doorLamps(d, true, new Set()), [true, true, true, true], 'lamps: unlocked = all lit');
}
{
  const d: FieldDoor = { index: 0, type: 0x80, x: 0, y: 0, z: 0, yaw: 0, flags: [1], locked: false, state: 0, frame: 0, mesh: null };
  const states: number[] = [];
  stepDoor(d, false, 0);
  states.push(d.state);
  stepDoor(d, true, 200);
  states.push(d.state);
  stepDoor(d, true, 69);
  states.push(d.state);
  for (let i = 0; i < 20 && d.state === 4; i++) stepDoor(d, true, 69);
  states.push(d.state);
  stepDoor(d, true, 99);
  states.push(d.state);
  stepDoor(d, true, 100);
  states.push(d.state);
  for (let i = 0; i < 20 && d.state === 3; i++) stepDoor(d, true, 150);
  states.push(d.state);
  eq(states, [0, 2, 4, 5, 5, 3, 2], 'door states');
}

// --- Client data: names and objects ---
if (existsSync(join(DATA, 'data.gsl'))) {
  const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
  const loose = new Set(readdirSync(DATA));
  const read = (n: string) => (loose.has(n) ? new Uint8Array(readFileSync(join(DATA, n))) : gsl.get(n));
  const text = parseUnitxt(read(loose.has('unitxt_j.prs') ? 'unitxt_j.prs' : 'unitxt_e.prs'))[10];
  eq(mainWarpItems(1).map((i) => text[i.text]), ['Forest 1', 'Cave 1', 'Mine 1', 'Ruins 1'], 'Ep1 labels');
  console.log('Ep2 labels:', mainWarpItems(2).map((i) => text[i.text]).join(', '));
  console.log('Ep4 labels:', mainWarpItems(3).map((i) => text[i.text]).join(', '));
  console.log('CCA gate labels:', CCA_WARP.map((i) => text[i.text]).join(', '));
  eq([0x00, 0x02, 0x0b].map((a) => text[AREA_TEXT[a]]), ['Pioneer 2', 'Forest 2', 'Under the Dome'], 'area names');
  check(/^lobby$/i.test(text[AREA_TEXT[0x0f]]), 'lobby teleporter name');

  const table = parseSetDataTable(read('SetDataTableOn.rel'));
  for (const episode of [1, 2, 3]) {
    const areas = floorToArea(episode);
    for (let floor = 0; floor < 18; floor++) {
      const area = areas[floor];
      if (area === undefined || area < 0) continue;
      const files = floorFiles(table, area, 0, 0, floor, 'normal');
      if (!files || !(loose.has(files.objects) || gsl.has(files.objects))) continue;
      const nrel = [`${files.setup}n.rel`, `${files.setup}_00n.rel`].find((n) => existsSync(join(DATA, 'scene', n)));
      const sections = nrel ? parseMapNRel(new Uint8Array(readFileSync(join(DATA, 'scene', nrel)))).sections : [];
      const placed = placeEntities(parseSetFile(files.objects, read(files.objects)), sections, area);
      const o = collectFieldObjects(placed, { episode, floor, area });
      const desc = o.warps.map((w) => `${w.kind}${w.floor >= 0 ? `->${w.floor}` : ''}`).join(' ');
      console.log(`Ep${episode === 3 ? 4 : episode} floor ${String(floor).padStart(2)} area 0x${area.toString(16).padStart(2, '0')}: ${desc || '-'}; ${o.doors.length} doors, ${o.switches.length} switches`);
      if (floor === 0 && episode !== 2) check(o.warps.some((w) => w.kind === 'main'), `Ep${episode} Pioneer 2 has the Ragol teleporter`);
      if (episode === 1 && floor === 1) check(o.warps.some((w) => w.kind === 'area' && w.floor === 2) && o.doors.length > 0 && o.switches.length > 0, 'Forest 1 warp to floor 2, doors and switches');
      if (episode === 1 && floor === 2) check(o.warps.some((w) => w.kind === 'boss' && w.floor === 0xb), 'Forest 2 boss warp to the Dragon');
      if (episode === 2 && area === 0x17) check(o.warps.some((w) => w.kind === 'cca' && w.radius === 15), 'CCA has its main gate (TObjWarpJungMain)');
      if (episode === 2 && (area === 0x13 || area === 0x15 || area === 0x1c)) check(o.doors.some((d) => d.lamps), `Ep2 area 0x${area.toString(16)} has four-light doors`);
    }
  }
} else {
  console.log(`(no ${DATA}; skipping the client data checks)`);
}

console.log(failures ? `${failures} failures` : 'warp menus and field objects: all checks passed');
process.exit(failures ? 1 : 0);
