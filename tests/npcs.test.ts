// NPCs: every NPC set entry of every free-play floor (SetDataTableOn/Off, all
// variations) and of every Blue Burst quest .dat newserv ships resolves to the
// class table traced from PsoBB.exe (formats/npcmodels.ts) or to one of the
// classes documented as not drawn yet; every model the table can name builds
// with three.js (64 nodes, no missing texture) and plays the town idle motion
// of plymotionnpctown.cpt; the talk parameters of the Pioneer 2 NPCs are the
// ones the area script expects; and the area script (map_city_on_e.bin) runs
// every Pioneer 2 NPC's talk label in the quest VM, reaching the counter menus
// (bb_p2_menu) of the Hunter's Guild and the government counter.
//
// Run: node tests/npcs.test.ts
// Env: PSOBB_DATA (client data/ folder), NEWSERV (newserv checkout).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientFiles } from '../client/src/data/clientfiles.ts';
import type { DataSource } from '../client/src/data/source.ts';
import { GSLArchive } from '../client/src/formats/archives.ts';
import {
  cityScriptFile,
  NGC_MODELS,
  NPC_CLASSES,
  NPC_CAMERA_MOVER_LERP,
  NPC_CAMERA_MOVER_VIEWS,
  NPC_MOTION_TABLES,
  NPC_NODES,
  NPC_TALK_CAMERA_MOVERS,
  NPC_TALK_NO_TURN,
  npcClass,
  npcModelFor,
  npcParams,
  npcShown,
  P2_MENU_GOVERNMENT,
  P2_MENU_GUILD,
  parseNpcTownMotions,
  QUEST_NPC_MOTION_FILE,
  QUEST_NPC_MOTION_SPEED,
  QUEST_NPC_TYPE,
  questNpcMotionEntry,
  questNpcTemplate,
  TEKKER_MODELS,
  type NpcModelSource,
} from '../client/src/formats/npcmodels.ts';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { parseQuestBin } from '../client/src/formats/questbin.ts';
import { parseQuestDat } from '../client/src/formats/questdat.ts';
import { enemyKind, parseEnemySets, type EnemySet } from '../client/src/formats/setdata.ts';
import { enemyModelFor, NPC_ENEMY_TYPES, stageNpcIds, stageNpcModel, stageNpcSlotId } from '../client/src/formats/enemymodels.ts';
import { NPC_PLAYER_COUNT } from '../client/src/formats/npcplayerchar.ts';
import { floorFiles, freePlayVariations, parseSetDataTable } from '../client/src/formats/setdatatable.ts';
import { floorToArea } from '../client/src/net/game.ts';
import { QuestVM, type QuestMessage } from '../client/src/quest/vm.ts';
import { EnemyArchive, NodeAnimator } from '../client/src/render/enemymodel.ts';
import { NpcAssets } from '../client/src/render/npcview.ts';
import { bodyBlocks, CollisionWorld, PLAYER_RADIUS } from '../client/src/render/collision.ts';
import { parseMapCRel } from '../client/src/formats/crel.ts';
import { parseMapNRel } from '../client/src/formats/nrel.ts';
import { parseSetFile, placeEntities } from '../client/src/formats/setdata.ts';
import { CAMERA_TALK_FOV_ANGLE, CAMERA_FOV_ANGLE, CAMERA_ZOOM, easeBams, lerpPoint, PlayerCamera } from '../client/src/render/playercamera.ts';
import {
  NPC_RADIUS,
  NPC_SPEED,
  NPC_WANDER_WAIT,
  clampAngle,
  npcBrain,
  npcCollide,
  npcTalkEnd,
  npcTalkStart,
  npcTick,
  type NpcWorld,
} from '../client/src/render/npcwander.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    if (failures < 60) console.log(`FAIL ${msg}`);
  }
};

const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
const loose = new Set(readdirSync(DATA));
const read = (name: string) => (loose.has(name) ? new Uint8Array(readFileSync(join(DATA, name))) : gsl.has(name) ? gsl.get(name) : null);
const source: DataSource = {
  label: DATA,
  list: async () => [...loose],
  read: async (name) => {
    const d = read(name);
    if (!d) throw new Error(`missing ${name}`);
    return d;
  },
};
const files = new ClientFiles(source);

// Every NPC type of the per-area factory table 0x009fba60 (dumped from the
// exe): the humanoid classes, the enemy factories' NPCs (NPC_ENEMY_TYPES, 0x33
// included) and the Episode 4 quest NPC (0x118, an NPC player of npcplayerchar.dat).
const NPC_FACTORY_TYPES = new Set([...NPC_CLASSES.map((c) => c.type), QUEST_NPC_TYPE, ...NPC_ENEMY_TYPES]);

// 1. The town motions: four NJS_ACTIONs of 64 nodes; the three motion tables
//    point into them.
const motions = parseNpcTownMotions(read('plymotionnpctown.cpt')!);
check(motions.length === 4, `plymotionnpctown.cpt: ${motions.length} motions, expected 4`);
for (const [i, m] of motions.entries()) {
  check(m.nodes.length === NPC_NODES, `town motion ${i}: ${m.nodes.length} nodes`);
  check(m.frameCount > 1, `town motion ${i}: ${m.frameCount} frames`);
}
for (const [f, t] of Object.entries(NPC_MOTION_TABLES)) {
  check(t.idle.motion < motions.length && t.walk.motion < motions.length, `${f}: motion index out of range`);
}
console.log(`town motions: ${motions.map((m) => m.frameCount).join(', ')} frames`);

// 2. Every model source builds: 64 nodes (the town motions drive them), no
//    missing texture, triangles, and the idle motion plays.
const assets = new NpcAssets(files);
const sources = new Map<string, NpcModelSource>();
const key = (s: NpcModelSource) => (s.kind === 'bml' ? s.bml : s.rel);
for (const c of NPC_CLASSES) if (typeof c.model === 'object') sources.set(key(c.model), c.model);
for (const s of [...TEKKER_MODELS, ...NGC_MODELS]) sources.set(key(s), s);
let builtCount = 0;
for (const s of sources.values()) {
  try {
    const m = await assets.build(s);
    check(m.nodes.length === NPC_NODES, `${key(s)}: ${m.nodes.length} nodes`);
    check(m.missingTextures === 0, `${key(s)}: ${m.missingTextures} missing textures`);
    check(m.triangles > 0, `${key(s)}: no triangles`);
    check(m.height > 5 && m.height < 40, `${key(s)}: height ${m.height.toFixed(1)}`);
    const a = new NodeAnimator(m.nodes, m.flags, motions[0], 0.9, true);
    for (let i = 0; i < 45; i++) a.update(1 / 30);
    builtCount++;
  } catch (err) {
    check(false, `${key(s)}: ${(err as Error).message}`);
  }
}
console.log(`${builtCount} NPC models built (${NPC_CLASSES.length} classes, 10 tekker and 14 NgcBase archives)`);

// 3. Every NPC entry of every free-play floor.
const seen = new Map<string, number>();
let npcEntries = 0;
let floors = 0;
const visit = (e: EnemySet, area: number, where: string) => {
  npcEntries++;
  // The enemy factories' quest NPCs (NPC_ENEMY_TYPES) are modelled by the enemy
  // layer: every episode / difficulty gives a spec (no class in npcmodels.ts).
  if (NPC_ENEMY_TYPES.has(e.type)) {
    for (const episode of [1, 2, 3]) for (const difficulty of [0, 3]) {
      const spec = enemyModelFor(e, { area, episode, difficulty, event: 0 });
      if (e.type === 0x33) {
        // A stage NPC slot: drawn exactly when its id is one the port models.
        const id = stageNpcSlotId(area, (Math.trunc(e.rotation[0]) << 16) >> 16);
        const drawn = id !== null && stageNpcModel(id, episode) !== null;
        check(!!spec === drawn, `${where}: NPC 0x33 slot ${e.rotation[0]} (id ${id}) drawn ${!!spec}, expected ${drawn} (episode ${episode})`);
        continue;
      }
      check(!!spec, `${where}: NPC 0x${e.type.toString(16)} has no enemy model (episode ${episode}, difficulty ${difficulty})`);
    }
    seen.set(`enemy model 0x${e.type.toString(16)}`, (seen.get(`enemy model 0x${e.type.toString(16)}`) ?? 0) + 1);
    return;
  }
  if (e.type === QUEST_NPC_TYPE) {
    // The quest NPC is an NPC player: its record must exist in npcplayerchar.dat (64 records).
    const t = questNpcTemplate(e.params[5]);
    check(t < NPC_PLAYER_COUNT, `${where}: quest NPC template ${t} is outside npcplayerchar.dat`);
    const k = `quest NPC (npcplayerchar record ${t})`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
    return;
  }
  const cls = npcClass(e.type);
  if (!cls) {
    // Types no area factory table (0x009fba60) constructs are skipped by the
    // client as well (q068 has a 0x14).
    seen.set(`no factory 0x${e.type.toString(16)}`, (seen.get(`no factory 0x${e.type.toString(16)}`) ?? 0) + 1);
    check(!NPC_FACTORY_TYPES.has(e.type), `${where}: NPC type 0x${e.type.toString(16)} has a factory but no class`);
    return;
  }
  const r = npcModelFor(e.type, { area, sectionId: 0 });
  const k = r ? `${cls.name} -> ${key(r.source)}` : `${cls.name} -> (not loaded on map type of area ${area})`;
  seen.set(k, (seen.get(k) ?? 0) + 1);
  if (cls.model !== 'ngc') check(!!r, `${where}: ${cls.name} has no model`);
};
for (const tname of ['SetDataTableOn.rel', 'SetDataTableOff.rel']) {
  const table = parseSetDataTable(read(tname)!);
  const solo = tname.includes('Off');
  for (const episode of [1, 2, 3]) {
    const areas = floorToArea(episode);
    for (let floor = 0; floor < 0x10; floor++) {
      const area = areas[floor];
      if (area < 0 || !table[area] || [0x0f, 0x10, 0x11, 0x2e].includes(area)) continue;
      const n = freePlayVariations(table, area, solo);
      for (let layout = 0; layout < n.layouts; layout++) {
        for (let v = 0; v < n.entities; v++) {
          const f = floorFiles(table, area, layout, v, floor, solo ? 'solo' : 'normal')!;
          const data = read(f.enemies);
          if (!data) continue;
          floors++;
          for (const e of parseEnemySets(data)) if (enemyKind(e, area) === 'NON_ENEMY_NPC') visit(e, area, `${f.enemies} #${e.index}`);
        }
      }
    }
  }
}
const freePlayEntries = npcEntries;

// 4. Every BB quest .dat.
const MAIN_ROOT = (() => {
  try {
    return dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim());
  } catch {
    return join(HERE, '..');
  }
})();
const NEWSERV = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(MAIN_ROOT, 'vendor/newserv')].find((d) => d && existsSync(join(d, 'system/quests')));
let questFloors = 0;
if (NEWSERV) {
  const root = join(NEWSERV, 'system/quests');
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const names = readdirSync(join(root, dir.name));
    for (const f of names) {
      const m = /^(.+)-bb-e\.bin$/.exec(f);
      if (!m || !names.includes(`${m[1]}-bb.dat`)) continue;
      try {
        const bin = parseQuestBin(prsDecompress(new Uint8Array(readFileSync(join(root, dir.name, f)))));
        const dat = parseQuestDat(prsDecompress(new Uint8Array(readFileSync(join(root, dir.name, `${m[1]}-bb.dat`)))));
        const ep = bin.header.episode === 1 ? 2 : bin.header.episode === 2 ? 3 : 1;
        for (const [floor, fd] of dat.floors) {
          questFloors++;
          const fa = bin.header.floorAssignments.find((x) => x.floor === floor);
          const area = fa && fa.area <= 0x2e ? fa.area : (floorToArea(ep)[floor] ?? 0);
          for (const e of fd.enemies) if (enemyKind(e, area) === 'NON_ENEMY_NPC') visit(e, area, `${dir.name}/${f} floor ${floor} #${e.index}`);
        }
      } catch (err) {
        check(false, `${dir.name}/${f}: ${(err as Error).message}`);
      }
    }
  }
} else console.log('SKIP quest .dat files (no newserv checkout)');
for (const [k, n] of [...seen].sort()) console.log(`  ${k} (${n})`);
console.log(`${floors} free-play floor variations (${freePlayEntries} NPC entries), ${questFloors} quest floors (${npcEntries - freePlayEntries} NPC entries)`);

// 5. Talk parameters: the Principal (0x1b) talks in the area script at label
//    1, the government receptionist Momoka (0x100) at label 870, the guild
//    clerk (0x1d, section 10) at 850; the display registers.
const city = parseEnemySets(read('map_city00_00e.dat')!);
const principal = city.find((e) => e.type === 0x1b)!;
const pp = npcParams(principal.params);
check(pp.script === 'area' && pp.label === 1 && pp.action === 1001, `Principal: ${JSON.stringify(pp)}`);
const momoka = city.find((e) => e.type === 0x100)!;
check(npcParams(momoka.params).label === 870 && npcParams(momoka.params).action === 1049, 'Momoka: label 870, action 1049');
const clerk = city.find((e) => e.type === 0x1d && e.section === 10)!;
check(npcParams(clerk.params).label === 850 && npcParams(clerk.params).action === 1011, 'guild clerk: label 850, action 1011');
check(npcParams([0, 0, 0, 105, 300, 0, 0]).script === 'quest', 'action 105 talks in the quest');
check(npcParams([0, 0, 0, 50, 300, 0, 0]).script === null, 'action 50 cannot talk');
check(npcParams([0, 1005, 0, 0, 0, 0, 0]).displayAreaScript && npcParams([0, 1005, 0, 0, 0, 0, 0]).displayOnReg === 5, 'display register >= 1000 is the area script');
check(npcShown(npcParams([0, 7, 0, 0, 0, 0, 0]), (r) => (r === 7 ? 1 : 0)), 'display-on register set: shown');
check(!npcShown(npcParams([0, 7, 0, 0, 0, 0, 0]), () => 0), 'display-on register clear: hidden');
check(!npcShown(npcParams([0, 0, 9, 0, 0, 0, 0]), (r) => (r === 9 ? 1 : 0)), 'display-off register set: hidden');
check(npcModelFor(0xf2 + 6, { area: 0x12 })?.source.kind === 'bml', 'Elly (NgcBase 6) is drawn in the Lab');
check(npcModelFor(0xf2 + 6, { area: 0x18 }) === null, 'Elly is not loaded in the jungle (map type 6)');
check(npcModelFor(0x1c, { area: 0, sectionId: 3 })?.source.kind === 'bml' && (npcModelFor(0x1c, { area: 0, sectionId: 3 })!.source as { bml: string }).bml === 'bm_n_kanteib_i_body.bml', 'tekker by section id');

// 6. The area script: every Pioneer 2 NPC's label runs to its end in the VM
//    (messages answered automatically) and the counters open their menus.
const scriptName = cityScriptFile(0, true, 'e')!;
check(scriptName === 'map_city_on_e.bin', `area script of Pioneer 2: ${scriptName}`);
check(cityScriptFile(0x12, true, 'e') === 'map_labo_on_e.bin', 'area script of the Lab');
const script = parseQuestBin(read(scriptName)!);
const menus: number[] = [];
const noLabel: number[] = [];
const said: QuestMessage[] = [];
const vm = new QuestVM({ bin: script, host: { p2Menu: (n) => menus.push(n), showMessage: (m) => said.push(m) }, autoAdvance: true });
for (const e of city) {
  const p = npcParams(e.params);
  if (p.script !== 'area') continue;
  const before = said.length;
  let done = false;
  const t = vm.startThread(p.label);
  // QuestThread2_Constructor_006bc800 kills a thread whose label is
  // 0xFFFFFFFF (or points outside the code): two NPCs (label 240, 880) have
  // no dialogue online.
  if (!t) {
    noLabel.push(p.label);
    continue;
  }
  t.onDone = () => (done = true);
  for (let i = 0; i < 400 && !done; i++) vm.frame();
  check(done, `area script label ${p.label} (NPC 0x${e.type.toString(16)}) did not finish`);
  const spoke = said.slice(before);
  // A talk either speaks (message as this NPC, or a window) or opens a counter.
  check(spoke.length > 0 || menus.length > 0, `label ${p.label}: no output`);
  for (const m of spoke) if (m.kind === 'message') check(m.target === p.action, `label ${p.label}: speaker ${m.target}, NPC action ${p.action}`);
}
check(menus.includes(P2_MENU_GUILD), `the guild clerk opens the Hunter's Guild (menus ${menus.join(',')})`);
check(menus.includes(P2_MENU_GOVERNMENT), `Momoka opens the government counter (menus ${menus.join(',')})`);
check([...vm.unimplemented.keys()].length === 0, `area script opcodes not implemented: ${[...vm.unimplemented.keys()].join(', ')}`);
console.log(`area script: labels without code ${noLabel.join(', ') || 'none'}; ${said.length} messages, counter menus ${[...new Set(menus)].sort().join(', ')}`);

// 7. Walking townspeople and NPC collision (render/npcwander.ts, from
//    0x006061ec / 0x00606280 / 0x00607284 / 0x007b7704).
{
  // A seeded generator stands in for the entity's random float.
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) / 65536;
  // param6 = 1 wanders, anything else stands (set_params clamps it to 0..1).
  check(npcBrain(0, 0, 0, 0, [24, 0, 0, 1016, 100, 1, 0]).wanders, 'param6 1 wanders');
  check(!npcBrain(0, 0, 0, 0, [0, 0, 0, 1011, 850, 0, 0]).wanders, 'param6 0 stands');
  check(npcBrain(0, 0, 0, 0, [24, 0, 0, 0, 0, 5, 0]).wanders, 'param6 5 is clamped to 1');
  check(clampAngle(0, 0x1000, 0x400) === 0x400 && clampAngle(0, 0xf000, 0x400) === 0xfc00 && clampAngle(0, 0x300, 0x400) === 0x300, 'ClampAngleDifference');

  // On open ground (no collision): the first tick picks mode 2, then a point
  // param1 away from the spawn point, walks there at 0.5 a tick turning by
  // 0x400, stops 5.5 from it, waits 121 ticks and picks the next one.
  const free: NpcWorld = { collision: null, rand };
  const TURN_R = NPC_SPEED / ((2 * Math.PI) / 64);
  const b = npcBrain(100, 0, 200, 0, [30, 0, 0, 1015, 90, 1, 0]);
  npcTick(b, free);
  check(b.mode === 2 && b.sub === 1 && b.motion === 1, `wanderer: mode ${b.mode} sub ${b.sub} motion ${b.motion} after the first tick`);
  check(Math.abs(Math.hypot(b.targetX - 100, b.targetZ - 200) - 30) < 1e-6, 'the target lies param1 from the spawn point');
  let walked = 0, maxStep = 0, waited = 0, picks = 1;
  let prev = { x: b.x, z: b.z };
  for (let i = 0; i < 6000; i++) {
    const sub = b.sub;
    npcTick(b, free);
    const step = Math.hypot(b.x - prev.x, b.z - prev.z);
    maxStep = Math.max(maxStep, step);
    if (sub === 1) walked++;
    if (sub === 3) waited++;
    if (sub === 0 && b.sub === 1) picks++;
    // It walks while it turns (0x400 a tick at 0.5: a turning circle of
    // radius 0.5 / (2 pi / 64) = 5.1), so it can swing out that far.
    check(Math.hypot(b.x - 100, b.z - 200) <= 30 + 2 * TURN_R + NPC_SPEED, `wanderer left its circle at tick ${i}`);
    if (sub === 1 && b.sub === 3) check(Math.hypot(b.targetX - b.x, b.targetZ - b.z) < NPC_SPEED + NPC_RADIUS, 'stopped 5.5 from the target');
    if (sub === 3 && b.sub === 0) check(b.wait === 0, 'wait reset');
    prev = { x: b.x, z: b.z };
  }
  check(maxStep <= NPC_SPEED + 1e-9, `step ${maxStep} > speed`);
  check(picks > 10 && walked > 500 && waited > 1000, `wander: ${picks} points, ${walked} walking ticks, ${waited} waiting ticks`);
  // The wait: 121 ticks in sub-state 3 (+0x2b0 counts to 0x78, then one more).
  const w = npcBrain(0, 0, 0, 0, [30, 0, 0, 0, 0, 1, 0]);
  w.mode = 2;
  w.sub = 3;
  let n = 0;
  while (w.sub === 3 && n < 500) {
    npcTick(w, free);
    n++;
  }
  check(n === NPC_WANDER_WAIT + 1, `wait lasts ${n} ticks`);

  // A standing NPC turned by a talk turns back to its spawn angle in its walk
  // motion, then stands idle (mode 1).
  const s = npcBrain(0, 0, 0, 0x2000, [0, 0, 0, 1011, 850, 0, 0]);
  npcTick(s, free);
  check(s.mode === 1 && s.sub === 1 && s.motion === 0, 'standing NPC idles');
  npcTalkStart(s);
  check(s.mode === 3 && s.motion === 1, 'talk start: mode 3, walk motion');
  s.angle = 0x6000;
  npcTalkEnd(s);
  let turns = 0;
  for (; turns < 100 && !(s.sub === 1 && s.angle === 0x2000); turns++) npcTick(s, free);
  check(s.angle === 0x2000 && s.motion === 0 && s.x === 0 && s.z === 0, `turned back to the spawn angle (${s.angle.toString(16)})`);
  check(turns === 2 + 0x4000 / 0x400, `turned back in ${turns} ticks`);

  // Character collision: a player standing in the way stops the wanderer
  // (touching -> sub-state 3) and the sidestep keeps it out of the player.
  const c = npcBrain(0, 0, 0, 0, [40, 0, 0, 0, 0, 1, 0]);
  c.mode = 2;
  c.sub = 1;
  c.motion = 1;
  c.targetX = 0;
  c.targetZ = 40;
  const player = { x: 0, z: 12, radius: PLAYER_RADIUS };
  let stopped = -1;
  for (let i = 0; i < 60 && stopped < 0; i++) {
    const px = c.x, py = c.y, pz = c.z;
    npcTick(c, free);
    npcCollide(c, px, py, pz, [player], free);
    if (c.sub === 3) stopped = i;
  }
  check(stopped >= 0, 'the wanderer stops at a player');
  check(Math.hypot(c.x - player.x, c.z - player.z) > NPC_RADIUS + PLAYER_RADIUS - NPC_SPEED - 0.3, `the wanderer walked into the player (${Math.hypot(c.x - player.x, c.z - player.z).toFixed(2)})`);

  // The player cannot walk into an NPC ahead, but can walk away from one.
  const npc = { x: 0, z: 0, radius: NPC_RADIUS };
  check(bodyBlocks(0, -11, 0, -9.5, 0, PLAYER_RADIUS, npc), 'walking into an NPC is refused');
  check(!bodyBlocks(0, -9.5, 0, -11, 0x8000, PLAYER_RADIUS, npc), 'walking away from an NPC is allowed');
  check(!bodyBlocks(0, -12, 0, -10.5, 0, PLAYER_RADIUS, npc), 'no overlap at 10.5');

  // The Pioneer 2 wanderers on the real map collision: they stay on the floor
  // within their circle, and the player is stopped at 10 units from them.
  const scene = join(DATA, 'scene');
  const crel = join(scene, 'map_city00_00c.rel');
  if (existsSync(crel)) {
    const world = new CollisionWorld(parseMapCRel(new Uint8Array(readFileSync(crel))));
    const sections = parseMapNRel(new Uint8Array(readFileSync(join(scene, 'map_city00_00n.rel')))).sections;
    const placed = placeEntities(parseSetFile('map_city00_00e.dat', read('map_city00_00e.dat')!), sections, 0);
    // Pioneer 2 has no hostile entities (DEVLOG 2026-10-23 "lock-on and minimap"): every
    // enemy-set entry is a NON_ENEMY_NPC, so the enemy layer (category 'enemy') takes none.
    const hostile = placed.filter((p) => p.entity.kind === 'enemy' && p.category === 'enemy');
    check(hostile.length === 0, `Pioneer 2 hostile entries: ${hostile.length}`);
    const wanderers = placed.filter((p) => p.entity.kind === 'enemy' && p.entity.params[5] === 1);
    check(wanderers.length === 7, `Pioneer 2 wanderers: ${wanderers.length}`);
    const env: NpcWorld = { collision: world, rand };
    const brains = wanderers.map((p) => npcBrain(p.world[0], p.world[1], p.world[2], Math.round((p.yaw / (Math.PI * 2)) * 0x10000), p.entity.params));
    let moved = 0;
    for (let t = 0; t < 3000; t++) {
      for (const [i, br] of brains.entries()) {
        const px = br.x, py = br.y, pz = br.z;
        npcTick(br, env);
        npcCollide(br, px, py, pz, brains.filter((o) => o !== br).map((o) => ({ x: o.x, z: o.z, radius: NPC_RADIUS })), env);
        if (px !== br.x || pz !== br.z) moved++;
        const r = br.radius + NPC_SPEED + 2 * TURN_R + NPC_RADIUS;
        check(Math.hypot(br.x - br.homeX, br.z - br.homeZ) <= r, `wanderer ${i} left its circle (${Math.hypot(br.x - br.homeX, br.z - br.homeZ).toFixed(1)})`);
        check(world.groundHeight(br.x, br.z, br.y + 10) !== null, `wanderer ${i} off the floor`);
      }
    }
    check(moved > 3000, `Pioneer 2 wanderers moved ${moved} ticks`);
    const target = brains[0];
    world.bodies = [{ x: target.x, z: target.z, radius: NPC_RADIUS }];
    let px = target.x, pz = target.z - 30, py = world.groundHeight(px, pz, target.y + 10) ?? target.y;
    for (let i = 0; i < 40; i++) {
      const r = world.move(px, py, pz, 0, 1);
      px = r.x;
      py = r.y;
      pz = r.z;
    }
    check(Math.hypot(px - target.x, pz - target.z) >= NPC_RADIUS + PLAYER_RADIUS - 1, `player walked into the NPC (${Math.hypot(px - target.x, pz - target.z).toFixed(2)})`);
    world.bodies = [];
    console.log(`wanderers: ${brains.length} in Pioneer 2, ${moved} moving ticks; player stopped ${Math.hypot(px - target.x, pz - target.z).toFixed(2)} from an NPC`);
  } else console.log('map_city00_00c.rel not found, skipping the Pioneer 2 wander checks');
}

// 8. The talk camera movers (camera_mover_constructor, update 0x004d5f88): the
//    actions that make one belong to Pioneer 2 / Lab NPCs, every mover's view
//    looks at its NPC, and the 0.725 ease reaches the view.
{
  const scene = join(DATA, 'scene');
  const where = new Map<number, { x: number; y: number; z: number; type: number }>();
  for (const [map, dat] of [['map_city00_00n.rel', 'map_city00_00e.dat'], ['map_labo00_00n.rel', 'map_labo00_00e.dat']]) {
    if (!existsSync(join(scene, map))) continue;
    const sections = parseMapNRel(new Uint8Array(readFileSync(join(scene, map)))).sections;
    for (const p of placeEntities(parseSetFile(dat, read(dat)!), sections, map.startsWith('map_city') ? 0 : 0x12)) {
      if (p.entity.kind !== 'enemy') continue;
      const a = npcParams(p.entity.params).action;
      if (NPC_TALK_CAMERA_MOVERS.has(a)) where.set(a, { x: p.world[0], y: p.world[1], z: p.world[2], type: p.entity.type });
    }
  }
  if (where.size) {
    for (const [action, type] of NPC_TALK_CAMERA_MOVERS) {
      check(NPC_TALK_NO_TURN.has(action), `camera mover action ${action} does not turn the NPC`);
      const npc = where.get(action);
      check(!!npc, `no NPC with talk action ${action}`);
      if (!npc) continue;
      const v = NPC_CAMERA_MOVER_VIEWS.get(type)!;
      // The view's target is near the NPC, its source a few tens of units off.
      const dt = Math.hypot(v.target[0] - npc.x, v.target[2] - npc.z);
      const ds = Math.hypot(v.source[0] - npc.x, v.source[2] - npc.z);
      check(dt < 40 && ds < 80, `mover ${type}: target ${dt.toFixed(1)} / source ${ds.toFixed(1)} from NPC 0x${npc.type.toString(16)} (action ${action})`);
      // Easing from 300 units away arrives within 4 seconds.
      let cur = { x: v.source[0] + 300, y: v.source[1], z: v.source[2] };
      let f = 0;
      for (; f < 120 && Math.hypot(cur.x - v.source[0], cur.z - v.source[2]) > 0.01; f++) cur = lerpPoint(cur, { x: v.source[0], y: v.source[1], z: v.source[2] }, NPC_CAMERA_MOVER_LERP);
      check(f < 120, `mover ${type} did not settle`);
    }
    console.log(`talk camera movers: ${[...where].map(([a, n]) => `${a} -> NPC 0x${n.type.toString(16)}`).join(', ')}`);
  } else console.log('scene files not found, skipping the camera mover checks');
}

// 9. The NPC talk of the player camera (UpdateUnknownPlayerCamera_004d7698,
//    UpdateCameraTarget_004d7d40): the field of view goes to 0x22d8 and back
//    by 0xb6 BAMS a frame (007a8c74); on Pioneer 2 the target height goes to
//    -3.0 in the talk and back to 0 (004d64d8, factor 1.4).
{
  check(easeBams(0x0100, 0xff00, 0xb6) === 0x004a, 'BAMS ease wraps the short way');
  check(easeBams(0x1000, 0x1000 + 0xb6, 0xb6) === 0x1000 + 0xb6, 'BAMS ease snaps within one step');
  const pos = { x: 0, y: 0, z: 0 };
  const cam = new PlayerCamera();
  cam.tick(pos, 0);
  check(cam.fovAngle === CAMERA_FOV_ANGLE, 'player camera starts at 0x36c1');
  cam.talk = true;
  let n = 0;
  while (n < 60 && cam.fovAngle !== CAMERA_TALK_FOV_ANGLE) { cam.tick(pos, 0); n++; }
  check(cam.fovAngle === CAMERA_TALK_FOV_ANGLE && n <= 30, `talk field of view reaches 0x22d8 in ${n} frames (about 29 expected)`);
  cam.talk = false;
  n = 0;
  while (n < 60 && cam.fovAngle !== CAMERA_FOV_ANGLE) { cam.tick(pos, 0); n++; }
  check(cam.fovAngle === CAMERA_FOV_ANGLE, `field of view returns to 0x36c1 in ${n} frames`);

  // Target height: only on Pioneer 2 (town); the talk moves it to -3.0.
  const outside = new PlayerCamera();
  outside.talk = true;
  for (let i = 0; i < 60; i++) outside.tick(pos, 0);
  check(outside.targetHeight === 0, 'target height is not eased outside Pioneer 2');
  const town = new PlayerCamera();
  town.town = true;
  town.talk = true;
  for (let i = 0; i < 60; i++) town.tick(pos, 0);
  check(Math.abs(town.targetHeight + 3) < 1e-3, `Pioneer 2 talk target height ${town.targetHeight.toFixed(4)} reaches -3.0`);
  const d = town.desired(pos, 0).target;
  check(Math.abs(d.y - (pos.y + CAMERA_ZOOM[town.zoom].targetY + town.targetHeight)) < 1e-9, 'the target height is added to the desired target');
  town.talk = false;
  for (let i = 0; i < 60; i++) town.tick(pos, 0);
  check(Math.abs(town.targetHeight) < 1e-3, 'target height returns to 0 after the talk');
  console.log(`player camera talk: fov 0x${CAMERA_TALK_FOV_ANGLE.toString(16)} and back, Pioneer 2 target height ${town.targetHeight.toFixed(4)} after the talk`);
}

// 10. The enemy factories' quest NPCs: Rappy (0x45) takes the Rappy loader's
//     BML (g_RappyBmlData: season by event, episode 4 sandlappy, ultimate _ap),
//     model entry 0; the Chaos Bringer NPC (0xa9) takes the Chaos Bringer's
//     BML (ultimate ModelA) with its wait row (njm 9, 0.8); the Hildebear NPC
//     (0x46) takes the moja BML with row 0 (njm 0, 0.5); the NPC types
//     without a model (0x33, 0x118) give none.
{
  const npc = (type: number, p6 = 0): EnemySet => ({
    kind: 'enemy', index: 0, type, floor: 0, section: 0, position: [0, 0, 0], rotation: [0, 0, 0],
    numChildren: 0, wave: 0, wave2: 0, unknownA1: 0, params: [0, 0, 0, 0, 0, p6, 0],
  });
  const ctx = (episode: number, difficulty: number, event: number) => ({ area: 0, episode, difficulty, event, online: true });
  const rappy = enemyModelFor(npc(0x45), ctx(1, 0, 0));
  check(rappy?.bml === 'bm_ene_lappy.bml' && rappy.parts.length === 1 && rappy.parts[0]!.model === 0, `Rappy NPC: ${rappy?.bml} model 0`);
  check(enemyModelFor(npc(0x45), ctx(1, 3, 0))?.bml === 'bm_ene_lappy_ap.bml', 'Rappy NPC ultimate takes the _ap loader');
  check(enemyModelFor(npc(0x45), ctx(1, 0, 1))?.bml === 'bm_ene_lappy_xs.bml', 'Rappy NPC in the event 1 season takes the xs BML');
  check(enemyModelFor(npc(0x45), ctx(3, 0, 0))?.bml === 'bm_ene_sandlappy.bml', 'Rappy NPC on Episode 4 takes sandlappy');
  check(rappy?.parts[0]!.textureArchive === undefined, 'Rappy NPC has no rare texture archive (model entry 0 only)');
  const bringer = enemyModelFor(npc(0xa9), ctx(1, 0, 0));
  check(bringer?.bml === 'bm_ene_df2_bringer.bml' && bringer.name === 'TObjNpcChaosBringer', 'Chaos Bringer NPC takes bm_ene_df2_bringer');
  check(enemyModelFor(npc(0xa9), ctx(1, 3, 0))?.bml === 'bm_ene_df2_bringer_a.bml', 'Chaos Bringer NPC ultimate takes ModelA');
  const motion = bringer?.parts[0]?.motion;
  check(motion?.index === 9 && Math.abs(motion.speed - 0.8) < 1e-6 && motion.loop === true, `Chaos Bringer NPC wait row: njm 9 at 0.8 (${motion?.index}, ${motion?.speed})`);
  check(NPC_ENEMY_TYPES.has(0x45) && NPC_ENEMY_TYPES.has(0xa9) && NPC_ENEMY_TYPES.has(0x46), 'NPC_ENEMY_TYPES: Rappy, Hildebear and Chaos Bringer');
  // Hildebear NPC (0x46): the enemy's moja BML (ultimate _a), model entry 0, row 0 = motion 0 at 0.5.
  const hilde = enemyModelFor(npc(0x46), ctx(1, 0, 0));
  check(hilde?.bml === 'bm_ene_bm2_moja.bml' && hilde.name === 'TObjNpcMoja', `Hildebear NPC takes bm_ene_bm2_moja (${hilde?.bml})`);
  check(hilde?.parts.length === 1 && hilde.parts[0]!.model === 0 && hilde.parts[0]!.textureArchive === undefined, 'Hildebear NPC: model entry 0, no rare texture archive');
  const hm = hilde?.parts[0]?.motion;
  check(hm?.index === 0 && Math.abs(hm.speed - 0.5) < 1e-6 && hm.loop === true, `Hildebear NPC motion row 0: motion 0 at 0.5 (${hm?.index}, ${hm?.speed})`);
  check(enemyModelFor(npc(0x46), ctx(1, 3, 0))?.bml === 'bm_ene_bm2_moja_a.bml', 'Hildebear NPC ultimate takes the _a BML');
  // init_hildebear_global_config (0x00516124): the _a BML on difficulty 3 alone, no online flag, no low branch.
  check(enemyModelFor(npc(0x46), { ...ctx(1, 3, 0), online: false })?.bml === 'bm_ene_bm2_moja_a.bml', 'Hildebear NPC offline ultimate still takes the _a BML (the exe init has no online test)');
  check(enemyModelFor(npc(0x46), { ...ctx(1, 0, 0), lowModels: true })?.bml === 'bm_ene_bm2_moja.bml', 'Hildebear NPC on low detail takes the full BML (no low branch in the NPC init)');
  check(enemyModelFor(npc(0x46), { ...ctx(1, 2, 0), online: true })?.bml === 'bm_ene_bm2_moja.bml', 'Hildebear NPC on very hard takes the base BML');
  // TObjNpcEnemy (0x33): angle.x is the rank of the area's registered id (STAGE_NPC_LISTS).
  // Forest 2 (0x02): 01..0B, 32, 33, 34, 3C, 3D; slot 12 is 0x33 (Hildebear), slot 1 is 0x02 (Booma).
  check(stageNpcIds(0x02)?.length === 16 && stageNpcSlotId(0x02, 12) === 0x33 && stageNpcSlotId(0x02, 16) === null, 'Forest 2 stage NPC list: slot 12 = 0x33');
  check(stageNpcSlotId(0x0b, 1) === null && stageNpcSlotId(0x0b, 0) === 0x01, 'Dragon: only the box (slot 0), slot 1 empty');
  check(stageNpcSlotId(0x99, 0) === null, 'an unknown area has no stage NPC list');
  const slotNpc = (slot: number, p6 = 0): EnemySet => ({ ...npc(0x33, p6), rotation: [slot, 0, 0] });
  const forest2 = (difficulty = 0) => ({ area: 0x02, episode: 1, difficulty, event: 0, online: true });
  const booma33 = enemyModelFor(slotNpc(1), forest2());
  check(booma33?.name === 'TObjNpcEnemy' && booma33.bml === 'bm_ene_re8_b_beast.bml' && booma33.parts[0]!.model === 0, `0x33 slot 1 (0x02 Booma, set 0x44 variant 0): ${booma33?.bml}`);
  const hilde33 = enemyModelFor(slotNpc(12), forest2());
  check(hilde33?.name === 'TObjNpcEnemy' && hilde33.bml === 'bm_ene_bm2_moja.bml' && hilde33.parts[0]!.model === 1, `0x33 slot 12 (Hildebear): ${hilde33?.name} ${hilde33?.bml} model ${hilde33?.parts[0]?.model}`);
  check(enemyModelFor(slotNpc(12), forest2(3))?.bml === 'bm_ene_bm2_moja_a.bml', '0x33 slot 12 ultimate takes the _a BML');
  const hildeblue33 = enemyModelFor(slotNpc(13), forest2());
  check(hildeblue33?.parts[0]!.model === 2, `slot 13 (0x34 Hildeblue) is set type 0x40 with param6 1: model ${hildeblue33?.parts[0]?.model}`);
  check(enemyModelFor(slotNpc(14), { area: 0x02, episode: 1, difficulty: 0, event: 0, online: true }) === null, 'slot 14 (0x3C, a map object) draws nothing');
  check(enemyModelFor(slotNpc(-1), { area: 0x02, episode: 1, difficulty: 0, event: 0, online: true }) === null, 'a negative slot (angle.x) is empty');
  // Episode 4 Desert (0x29): the list starts 05 (Rappy); its sandlappy is the Rappy's BML.
  check(enemyModelFor(slotNpc(0), { area: 0x29, episode: 3, difficulty: 0, event: 0, online: true })?.bml === 'bm_ene_sandlappy.bml', 'Desert slot 0 (0x05 Rappy) takes sandlappy on Episode 4');
  // The quest NPC (0x118): an NPC player, not an enemy model; its record is param6 bits 8..13.
  check(enemyModelFor(npc(QUEST_NPC_TYPE, 0x0500), ctx(3, 0, 0)) === null, 'quest NPC 0x118 is not an enemy model');
  check(questNpcTemplate(0x0500) === 5 && questNpcTemplate(0x4201) === 2 && questNpcTemplate(-1) === 63, 'quest NPC template = param6 bits 8..13 (flag bit 0 ignored)');
  // 11. The enemy-built NPCs talk (the vtables of 0x33 / 0x45 / 0x46 / 0xa9 / 0x118 all
  // carry the NPC talk: +0x2c 0x006072e0, +0x160 EnemyObjectUpdate_0060648c, +0x164
  // 0x00606a34; ASSUMED from the exe's vtable slots). Their set params are the talk
  // parameters: action 105 with label 300 talks in the quest (npcParams), as for an NPC.
  const talkEnemy = (type: number, params: number[]): EnemySet => ({ ...npc(type), params: params as EnemySet['params'] });
  for (const type of [0x33, 0x45, 0x46, 0xa9]) {
    const t = npcParams(talkEnemy(type, [0, 0, 0, 105, 300, 0, 0]).params);
    check(t.script === 'quest' && t.label === 300 && t.action === 105, `enemy-built NPC 0x${type.toString(16)} talks: ${JSON.stringify(t)}`);
    check(npcParams(talkEnemy(type, [0, 0, 0, 50, 300, 0, 0]).params).script === null, `enemy-built NPC 0x${type.toString(16)} with action 50 cannot talk`);
    check(npcParams(talkEnemy(type, [0, 0, 0, 0, 0, 0, 0]).params).script === null, `enemy-built NPC 0x${type.toString(16)} with no label cannot talk`);
  }
  const areaTalk = npcParams(talkEnemy(0x33, [0, 1005, 0, 1049, 870, 0, 0]).params);
  check(areaTalk.script === 'area' && areaTalk.label === 870 && areaTalk.displayAreaScript, 'enemy-built NPC with action 1049 talks in the area script');
  // The quest NPC (0x118) talks through the same NPC path (the NpcInstance of buildQuestNpc).
  const questTalk = npcParams(talkEnemy(QUEST_NPC_TYPE, [0, 0, 0, 105, 300, 0x0500, 0]).params);
  check(questTalk.script === 'quest' && questTalk.label === 300, 'quest NPC 0x118 talks through the NPC path');

  console.log(`enemy-modelled NPCs: Rappy ${rappy?.bml}, Hildebear ${hilde?.bml} (motion ${hm?.index} at ${hm?.speed}), Chaos Bringer ${bringer?.bml} (motion ${motion?.index} at ${motion?.speed}); stage NPC 0x33 slot 12 ${hilde33?.bml}; quest NPC records ${NPC_PLAYER_COUNT}`);
}

// 11. The Episode 4 quest NPC's idle motion (0x118, the dispatcher's
// Player__ApplyWeaponAnimationData row 0 of npcapcmot.bml, formats/npcmodels.ts): the
// class picks the NJM action (FOmarl 110, the others 112), the motions are 64-node NJM
// with 16-byte angle keys (the short form reads frames that run past the motion).
{
  check(questNpcMotionEntry(6) === 110 && questNpcMotionEntry(0) === 112 && questNpcMotionEntry(2) === 112 && questNpcMotionEntry(11) === 112, 'quest NPC idle row by class');
  check(QUEST_NPC_MOTION_SPEED === 1 && QUEST_NPC_MOTION_FILE === 'NpcApcMot.bml', 'quest NPC motion file and speed');
  const apc = new EnemyArchive(QUEST_NPC_MOTION_FILE, read(QUEST_NPC_MOTION_FILE)!, 0);
  check(apc.bml.entries.length === 120 && apc.motionCount === 120, `npcapcmot.bml: ${apc.bml.entries.length} entries, expected 120 motions`);
  check(apc.bml.entries[110].name === 'pxuZ00_A01_F_body.njm' && apc.bml.entries[112].name === 'pxuZ00_A01_W_body.njm', 'npcapcmot.bml entries 110 and 112 are the F and W idle sets');
  for (const j of [110, 112]) {
    const m = apc.motion(j, NPC_NODES, true);
    check(m.nodes.length === NPC_NODES && m.frameCount === 30, `npcapcmot ${j}: ${m.nodes.length} nodes, ${m.frameCount} frames`);
    // 16-byte keys: the first node's rotation keys run in order from frame 0 to the last frame.
    const frames = (m.nodes[0].rotation ?? []).map((k) => k.frame);
    check(frames.length > 1 && frames[0] === 0 && frames.every((f, i) => i === 0 || f > frames[i - 1]) && frames[frames.length - 1] === m.frameCount - 1, `npcapcmot ${j}: node 0 key frames ${frames.join(',')}`);
    const short = apc.motion(j, NPC_NODES, false);
    const shortFrames = short.nodes.flatMap((n) => (n.rotation ?? []).map((k) => k.frame));
    check(shortFrames.some((f) => f >= m.frameCount), `npcapcmot ${j}: the short-angle reading runs past the motion (wrong form)`);
  }
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
