// A whole Episode 1 quest through the VM, headless: "Mop-up Operation #1"
// (extermination/q101) from its start label to the reward, the way the game
// drives it (quest/town.ts): the floor 0 handler places the players
// (set_player_start_position -> 6x24) and opens the Ragol warp; talking to the
// lieutenant (the .dat NPC with talk action 105) runs his label and speaks in
// balloons over him (message 105 + add_msg); the briefing starts the mission
// (r0); once the job is done (r255) the Hunter's Guild runs the
// set_qt_success label, which shows the reward window and pays it (6xC9).
// Also the 6x24 / 6x69 / 6xC9 / 6x75 / 6x77 layouts and npcplayerchar.dat.
//
// Run: node tests/questflow.test.ts
// Env: NEWSERV (newserv checkout), PSOBB_DATA (client data/ folder).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { npcParams } from '../client/src/formats/npcmodels.ts';
import { buildMesetaReward, buildNpcControl, buildTeleport, parseNpcControl, parseNpcPlayerTemplates } from '../client/src/formats/npcplayerchar.ts';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { parseQuestBin } from '../client/src/formats/questbin.ts';
import { parseQuestDat } from '../client/src/formats/questdat.ts';
import { QuestVM, type QuestMessage, type QuestNpcRequest } from '../client/src/quest/vm.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};

// --- packet layouts (newserv CommandFormats.hh sizes; the size byte counts dwords)
const tp = buildTeleport(2, 0x4000, 1, 2, 3);
check(tp.length === 0x14 && tp[1] * 4 === tp.length && tp[0] === 0x24, '6x24 is 0x14 bytes');
const nc = buildNpcControl({ param1: 0, param2: 1, command: 0, param3: 7 });
check(nc.length === 0x0c && nc[1] * 4 === nc.length, '6x69 is 0x0C bytes');
check(JSON.stringify(parseNpcControl(nc)) === JSON.stringify({ param1: 0, param2: 1, command: 0, param3: 7 }), '6x69 round trip');
const ms = buildMesetaReward(1500);
check(ms.length === 8 && ms[1] * 4 === ms.length && new DataView(ms.buffer).getInt32(4, true) === 1500, '6xC9 is 8 bytes');
// 6x75 / 6x77 (net/game.ts) carry 0x0C bytes: their size byte must be 3.
const gameSrc = readFileSync(join(HERE, '../client/src/net/game.ts'), 'utf8');
check(/body\[0\] = 0x75;\s*body\[1\] = 0x03/.test(gameSrc), '6x75 size byte is 3');
check(/body\[0\] = 0x77;\s*body\[1\] = 0x03/.test(gameSrc), '6x77 size byte is 3');

// --- npcplayerchar.dat
const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
if (existsSync(join(DATA, 'data.gsl'))) {
  const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
  const loose = new Set(readdirSync(DATA));
  const file = loose.has('npcplayerchar.dat') ? new Uint8Array(readFileSync(join(DATA, 'npcplayerchar.dat'))) : gsl.get('npcplayerchar.dat');
  const t = parseNpcPlayerTemplates(file);
  check(t.length === 64, `npcplayerchar.dat: ${t.length} templates`);
  check(t[0].name === 'NOL' && t[0].charClass === 1 && t[0].appearance.hair === 8, `template 0: ${JSON.stringify(t[0])}`);
  check(t.every((x) => x.charClass < 12), 'every template has a player class');
  console.log(`npcplayerchar.dat: ${t.slice(0, 8).map((x) => x.name).join(', ')}, ...`);
}

// --- Mop-up Operation #1
const MAIN_ROOT = (() => {
  try {
    return dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim());
  } catch {
    return join(HERE, '..');
  }
})();
const NEWSERV = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(MAIN_ROOT, 'vendor/newserv')].find((d) => d && existsSync(join(d, 'system/quests')));
if (!NEWSERV) {
  console.log('SKIP the quest run (no newserv checkout)');
} else {
  const dir = join(NEWSERV, 'system/quests/extermination');
  const bin = parseQuestBin(prsDecompress(new Uint8Array(readFileSync(join(dir, 'q101-bb-e.bin')))));
  const dat = parseQuestDat(prsDecompress(new Uint8Array(readFileSync(join(dir, 'q101-bb.dat')))));
  const teleports: Array<[number, { x: number; y: number; z: number; angle: number }]> = [];
  const said: QuestMessage[] = [];
  const closed: string[] = [];
  const meseta: number[] = [];
  const npcs: QuestNpcRequest[] = [];
  const mainwarp: number[] = [];
  const synced = new Map<number, number>();
  const vm = new QuestVM({
    bin,
    autoAdvance: true,
    host: {
      clientId: () => 0,
      difficulty: () => 0,
      playerCount: () => 1,
      playersPresent: () => [true, false, false, false],
      playerFloor: () => 0,
      teleport: (id, p) => teleports.push([id, p]),
      showMessage: (m) => said.push(m),
      closeMessage: (k) => closed.push(k),
      addMeseta: (n) => meseta.push(n),
      npcCreated: (n) => npcs.push(n),
      mainwarpChanged: (f, on) => on && mainwarp.push(f),
      syncRegister: (r, v) => synced.set(r, v),
      zoneCleared: () => false,
    },
  });
  vm.start();
  vm.frame();
  check(vm.qtSuccess >= 0, 'set_qt_success registered a label');
  vm.enterFloor(0);
  vm.runFrames(3);
  check(teleports.length === 4 && teleports[0][0] === 0, `floor 0 handler placed ${teleports.length} players`);
  check(teleports[0][1].x === 0xed && teleports[0][1].z === 0x14d && teleports[0][1].angle === -15, `player 0 start ${JSON.stringify(teleports[0]?.[1])}`);
  check(mainwarp.includes(1), 'the Ragol warp to floor 1 is open');

  // The lieutenant: the .dat NPC whose talk action is 105.
  const floor0 = dat.floors.get(0)!;
  const lieutenant = floor0.enemies.map((e) => ({ e, p: npcParams(e.params) })).find((x) => x.p.action === 105);
  check(!!lieutenant && lieutenant.p.script === 'quest', 'the lieutenant talks in the quest');
  if (lieutenant) {
    const before = said.length;
    let done = false;
    const t = vm.startThread(lieutenant.p.label);
    check(!!t, `label ${lieutenant.p.label} has code`);
    if (t) t.onDone = () => (done = true);
    for (let i = 0; i < 200 && !done; i++) vm.frame();
    check(done, 'the briefing thread ended');
    const lines = said.slice(before).filter((m) => m.kind === 'message');
    check(lines.length >= 5, `the briefing has ${lines.length} balloon pages`);
    check(lines.every((m) => m.target === 105), 'every page of the briefing is spoken by NPC 105 (add_msg keeps the speaker)');
    check(closed.includes('message'), 'message_end closed the balloon');
    check(vm.regsI[0] === 1, 'the briefing set r0 (the mission started)');
    vm.runFrames(5);
    check(synced.get(0) === 1, 'r0 was synced to the others (6x77)');
  }

  // The job is done (r255): the guild's success label pays the reward.
  vm.regsI[255] = 1;
  const before = said.length;
  let paid = false;
  const t = vm.startThread(vm.qtSuccess);
  if (t) t.onDone = () => (paid = true);
  for (let i = 0; i < 100 && !paid; i++) vm.frame();
  check(paid, 'the success label ended');
  check(meseta.length === 1 && meseta[0] === 1500, `reward on Normal: ${meseta.join(',')} meseta`);
  const win = said.slice(before).find((m) => m.kind === 'window');
  check(!!win && /1500/.test(win.pages[0]) , `reward window: ${win?.pages[0]}`);
  check([...vm.unimplemented.keys()].every((k) => ['playbgm_epi'].includes(k) || !['message', 'add_msg', 'window_msg'].includes(k)), 'no text opcode left out');
  console.log(`q101: ${teleports.length} start positions, ${said.length} text pages, reward ${meseta.join(',')} meseta; not implemented: ${[...vm.unimplemented.keys()].join(', ') || 'none'}`);
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
