// TObjLobbyMain (0x0182) seasonal decoration: the model per event and set
// param4 (objectmodels.ts lobbyMainChunk / objectModelFor), checked against the
// BML's entry names in data.gsl and the lobby sets of map_lobby_NNo.dat.
// Derived from PsoBB.exe: DerolleGetMappedSeasonalEventID_00671d78,
// DerolleSetNjmChunkIdBasedOnSeason_00671e1c, DerolleSetStateID_00672410,
// the draw 0x006720e8 and the motion table 0x0093a4c0.
// Run: node web/tests/lobbymain.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { BmlArchive } from '../client/src/formats/bml.ts';
import { lobbyMainChunk, objectModelFor, type ObjectModelContext } from '../client/src/formats/objectmodels.ts';
import { parseObjectSets as parseSetObjects, type ObjectSet } from '../client/src/formats/setdata.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
const gslPath = join(DATA, 'data.gsl');
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`FAIL ${msg}`);
};
const ctx = (event?: number): ObjectModelContext => ({ area: 0, episode: 1, event });
const obj = (param4: number): ObjectSet =>
  ({ kind: 'object', index: 0, type: 0x0182, floor: 15, section: 1, position: [0, 0, 0], rotation: [0, 0, 0], group: 0, unknownA3: 0, params: [1, 1, 1, param4, 0, 0] }) as ObjectSet;

// 1. The event table: each seasonal event names its entry (BML entries 0..17).
const EVENTS: Record<number, number> = { 1: 12, 3: 16, 4: 14, 5: 15, 7: 10, 8: 11, 9: 17, 10: 1, 11: 13 };
for (const [event, chunk] of Object.entries(EVENTS)) {
  for (const p4 of [0, 1, 4, 9]) {
    if (lobbyMainChunk(Number(event), p4) !== chunk) fail(`event ${event} param4 ${p4}: chunk ${lobbyMainChunk(Number(event), p4)} != ${chunk}`);
  }
}
// 2. No event (0) and 0x0c have no case: the set's param4 1..9, else 0. 0x0d
// maps to 8 (the Sakura case, 11) in every set.
for (const event of [0, 0x0c]) {
  for (let p4 = 0; p4 <= 10; p4++) {
    const want = p4 >= 1 && p4 <= 9 ? p4 : 0;
    if (lobbyMainChunk(event, p4) !== want) fail(`event ${event} param4 ${p4}: chunk ${lobbyMainChunk(event, p4)} != ${want}`);
  }
}
for (let p4 = 0; p4 <= 10; p4++) {
  if (lobbyMainChunk(0x0d, p4) !== 11) fail(`event 13 param4 ${p4}: chunk ${lobbyMainChunk(0x0d, p4)} != 11`);
}
// 3. Other events (2, 6, and 0x0e.. ) are not seasonal in the exe either: param4.
for (const event of [2, 6, 0x0e, 0x20]) {
  if (lobbyMainChunk(event, 5) !== 5) fail(`event ${event}: chunk ${lobbyMainChunk(event, 5)} != 5`);
}

// 4. The spec: the part's model is the chunk; motion and loop from the table
// (7 -> motion 0, 8 -> 1, 9 -> 2, 15 -> 3, 16 and 17 -> 4; the rest are still).
const motionOf = (event: number, p4: number) => {
  const spec = objectModelFor(obj(p4), ctx(event));
  if (!spec || spec.bml !== 'bm_obj_lobby_main.bml') fail(`event ${event} param4 ${p4}: no lobby main spec`);
  return spec!.parts[0];
};
const cases: Array<[number, number, number, number | undefined]> = [
  [0, 7, 7, 0],
  [0, 8, 8, 1],
  [0, 9, 9, 2],
  [0, 4, 4, undefined],
  [0, 6, 6, undefined],
  [1, 0, 12, undefined],
  [9, 0, 17, 4],
  [5, 0, 15, 3],
  [3, 0, 16, 4],
  [11, 0, 13, undefined],
];
for (const [event, p4, model, motion] of cases) {
  const part = motionOf(event, p4);
  if (part.model !== model) fail(`event ${event} param4 ${p4}: model ${part.model} != ${model}`);
  if (part.motion !== motion) fail(`event ${event} param4 ${p4}: motion ${part.motion} != ${motion}`);
  if (motion !== undefined && (part.drive !== 'loop-last' || part.speed !== 1)) fail(`event ${event}: motion not a one-frame-a-tick loop`);
}
// The round box of the object is the one the lobby's collision reads (0x009c9778, radius 32).
const box = objectModelFor(obj(1), ctx())?.collision;
if (!box || box.address !== 0x009c9778 || box.type !== 0 || box.halfX !== 32) fail('TObjLobbyMain collision box is not 0x009c9778 radius 32');

// 5. The real files: every chunk is an entry of bm_obj_lobby_main.bml with the
// name the exe's table implies, and the lobby sets pick the expected models.
if (existsSync(gslPath)) {
  const gsl = new GSLArchive(new Uint8Array(readFileSync(gslPath)));
  const bml = new BmlArchive(gsl.get('bm_obj_lobby_main.bml'));
  const names = bml.entries.map((e) => e.name);
  const expect: Record<number, string> = { 0: 'lobby_kusabatake_waku.xj', 1: 'lobby_chou_nobana.xj', 7: 'lobby_fuusya_waku.xj', 8: 'lobby_nijipipe_waku.xj', 9: 'lobby_planet_waku.xj', 10: 'lobby_obj_kadomatu_waku.xj', 11: 'lobby_tree_sakura_waku.xj', 12: 'lobby_ivent_christmas.xj', 13: 'lobby_momiji_waku.xj', 14: 'lobby_egg_kago.xj', 15: 'lobby_kabocya_l.xj', 16: 'lobby_obj_vday_main.xj', 17: 'lobby_obj_wday_main.xj' };
  for (const [i, name] of Object.entries(expect)) if (names[Number(i)] !== name) fail(`bml entry ${i} is ${names[Number(i)]}, not ${name}`);
  if (names[18] !== 'lobby_fuusya_waku.njm' || names[21] !== 'lobby_kabocya_l.njm' || names[22] !== 'lobby_obj_vday_main.njm') fail('bml motion entries 18..22 are not the expected .njm');
  let sets = 0;
  for (let n = 1; n <= 10; n++) {
    const name = `map_lobby_${String(n).padStart(2, '0')}o.dat`;
    if (!gsl.has(name)) continue;
    for (const o of parseSetObjects(gsl.get(name))) {
      if (o.type !== 0x0182) continue;
      sets++;
      // No event: param4 1..9 is the model, 10 and 11 (lobby 06's Kadomatsu and
      // Sakura sets) fall back to model 0; events 7 and 8 pick them.
      const p4 = o.params[3];
      const part = objectModelFor(o, ctx(0))?.parts[0];
      if (!part || part.model !== (p4 >= 1 && p4 <= 9 ? p4 : 0)) fail(`${name}: param4 ${p4} draws model ${part?.model}`);
      const seasonal = objectModelFor(o, ctx(p4 === 10 ? 7 : p4 === 11 ? 8 : 0))?.parts[0];
      if (p4 === 10 || p4 === 11) {
        if (seasonal?.model !== p4) fail(`${name}: param4 ${p4} with its event draws model ${seasonal?.model}`);
      }
    }
  }
  if (sets < 30) fail(`only ${sets} TObjLobbyMain sets in the lobbies`);
  console.log(`TObjLobbyMain: ${sets} sets in lobbies 01..10; ${names.length} BML entries`);
} else {
  console.log(`SKIP data.gsl not found at ${gslPath}`);
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
