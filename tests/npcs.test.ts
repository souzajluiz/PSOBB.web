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
  NPC_MOTION_TABLES,
  NPC_NODES,
  npcClass,
  npcModelFor,
  npcParams,
  npcShown,
  P2_MENU_GOVERNMENT,
  P2_MENU_GUILD,
  parseNpcTownMotions,
  TEKKER_MODELS,
  type NpcModelSource,
} from '../client/src/formats/npcmodels.ts';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { parseQuestBin } from '../client/src/formats/questbin.ts';
import { parseQuestDat } from '../client/src/formats/questdat.ts';
import { enemyKind, parseEnemySets, type EnemySet } from '../client/src/formats/setdata.ts';
import { floorFiles, freePlayVariations, parseSetDataTable } from '../client/src/formats/setdatatable.ts';
import { floorToArea } from '../client/src/net/game.ts';
import { QuestVM, type QuestMessage } from '../client/src/quest/vm.ts';
import { NodeAnimator } from '../client/src/render/enemymodel.ts';
import { NpcAssets } from '../client/src/render/npcview.ts';

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

// Classes the set data uses that this client does not draw yet (see
// docs/ROADMAP.md): TObjNpcEnemy (0x33, a stage NPC with no model of its own),
// the NPC Rappy / Hildebear / Dark Bringer of a few quests (0x45, 0x46, 0xa9)
// and the Episode 4 quest NPC (0x118).
const NOT_YET = new Set([0x33, 0x45, 0x46, 0xa9, 0x118]);
// Every NPC type of the per-area factory table 0x009fba60 (dumped from the
// exe: the humanoid classes plus the ones above).
const NPC_FACTORY_TYPES = new Set([...NPC_CLASSES.map((c) => c.type), ...NOT_YET]);

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
  const cls = npcClass(e.type);
  if (!cls) {
    // Types no area factory table (0x009fba60) constructs are skipped by the
    // client as well (q068 has a 0x14).
    if (!NOT_YET.has(e.type)) {
      seen.set(`no factory 0x${e.type.toString(16)}`, (seen.get(`no factory 0x${e.type.toString(16)}`) ?? 0) + 1);
      check(!NPC_FACTORY_TYPES.has(e.type), `${where}: NPC type 0x${e.type.toString(16)} has a factory but no class`);
      return;
    }
    seen.set(`not drawn 0x${e.type.toString(16)}`, (seen.get(`not drawn 0x${e.type.toString(16)}`) ?? 0) + 1);
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

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
