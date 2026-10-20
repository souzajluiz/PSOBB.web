// Battle Mode (quest/battle.ts): the ba_* opcodes' rule struct with the exe's
// validation and remapping, the score weights and the points formula, the places
// table, the controller's timeline against a fake host, the 6x7D / 6xCF / 6x8F
// payloads, Game.create with the battle flag, and the eight b88xxx quests
// through the VM (their rules, announcements and weights).
//
// Run: node tests/battle.test.ts
// Env: NEWSERV (newserv checkout; default: vendor/newserv of the main checkout).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { Game } from '../client/src/net/game.ts';
import {
  BattleController, BattleRecords, BattleSetup, PlayerScore, assignTeams, baInitialFloor, build6x8F, build6xCF, build6xD0, build7D,
  decodeBattleRules, effectiveRules, encodeBattleRules, formatBattleTimer, localRestrictions, newBattleRules, parse7D, rankPlayers,
  roundEven, shuffleStarts, trapNumber, weightFromRegs, ACK_FRAMES, LOADING_FRAMES, RULES_FRAMES,
  type Battle7D, type BattleHost,
} from '../client/src/quest/battle.ts';
import { QuestSession } from '../client/src/quest/session.ts';
import type { LoadedQuest } from '../client/src/net/quests.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (a: unknown, b: unknown, msg: string) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// --- the opcodes ---------------------------------------------------------------
const regs = new Int32Array(256);
const run = (s: BattleSetup, name: string, ...args: number[]) =>
  s.apply(name, { arg: (i) => args[i] ?? 0, reg: (i) => args[i] ?? 0, regs, text: () => 'rules' });
{
  const s = new BattleSetup();
  // The remapped enums (PsoBB.exe .data 0x00969788.. read with tools/exedata.py).
  run(s, 'ba_set_tech_disk_mode', 0); eq(s.rules.techDisk, 1, 'tech disk 0 -> FORBID_ALL');
  run(s, 'ba_set_tech_disk_mode', 1); eq(s.rules.techDisk, 0, 'tech disk 1 -> ALLOW');
  run(s, 'ba_set_tech_disk_mode', 2); eq(s.rules.techDisk, 2, 'tech disk 2 -> LIMIT_LEVEL');
  run(s, 'ba_set_tech_disk_mode', 9); eq(s.rules.techDisk, 2, 'tech disk out of range -> 2');
  run(s, 'ba_set_weapon_and_armor_mode', 0); eq(s.rules.weaponAndArmor, 2, 'weapons 0 -> FORBID_ALL');
  run(s, 'ba_set_weapon_and_armor_mode', 2); eq(s.rules.weaponAndArmor, 1, 'weapons 2 -> CLEAR_AND_ALLOW');
  run(s, 'ba_set_weapon_and_armor_mode', 3); eq(s.rules.weaponAndArmor, 3, 'weapons 3 -> FORBID_RARES');
  run(s, 'ba_set_forbid_mags', 0); eq(s.rules.mag, 1, 'mags 0 -> FORBID_ALL');
  run(s, 'ba_set_tool_mode', 2); eq(s.rules.tool, 1, 'tools 2 -> CLEAR_AND_ALLOW');
  run(s, 'ba_set_respawn', 0); eq(s.rules.respawn, 1, 'respawn 0 -> FORBID');
  run(s, 'ba_set_respawn', 1); eq(s.rules.respawn, 0, 'respawn 1 -> ALLOW');
  run(s, 'ba_set_respawn', 2); eq(s.rules.respawn, 2, 'respawn 2 -> LIMIT_LIVES');
  run(s, 'ba_dropwep', 1); eq(s.rules.dropWeapon, 0, 'ba_dropwep is inverted');
  run(s, 'ba_dropwep', 0); eq(s.rules.dropWeapon, 1, 'ba_dropwep 0 keeps the weapon');
  run(s, 'ba_teams', 1); eq(s.rules.teams, 1, 'teams');
  run(s, 'ba_teams', 5); eq(s.rules.teams, 0, 'teams out of range -> 0');
  run(s, 'ba_set_meseta_drop_mode', 2); eq(s.rules.meseta, 2, 'meseta mode is not remapped');
  run(s, 'ba_set_meseta_drop_mode', 3); eq(s.rules.meseta, 2, 'meseta mode out of range is ignored');
  run(s, 'ba_set_lives', 100); eq(s.rules.lives, 0, 'lives > 99 -> 0');
  run(s, 'ba_set_lives', 5); eq(s.rules.lives, 5, 'lives');
  run(s, 'ba_set_max_tech_level', 0xff); eq(s.rules.maxTechLevel, 0xff, 'max tech level 255 = unlimited');
  run(s, 'ba_set_max_tech_level', 30); eq(s.rules.maxTechLevel, 0, 'max tech level 30 -> 0');
  run(s, 'ba_set_char_level', 200); eq(s.rules.charLevel, 0, 'level 200 -> 0');
  run(s, 'ba_set_char_level', 120); eq(s.rules.charLevel, 120, 'level');
  run(s, 'ba_set_time_limit', 10); eq(s.rules.timeLimit, 10, 'time limit');
  run(s, 'ba_set_time_limit', 0x278d1); eq(s.rules.timeLimit, 0, 'time limit too large -> 0');
  run(s, 'ba_death_tech_level_up', 29); eq(s.rules.deathTechLevelUp, 29, 'death tech level');
  run(s, 'ba_death_tech_level_up', 30); eq(s.rules.deathTechLevelUp, 29, 'death tech level 30 ignored');
  run(s, 'ba_enable_sonar', 1); run(s, 'ba_sonar_count', 5); eq([s.rules.sonar, s.rules.sonarCount], [1, 5], 'sonar');
  run(s, 'ba_forbid_scape_dolls', 1); eq(s.rules.forbidScapeDolls, 1, 'scape dolls');
  run(s, 'ba_hide_target_reticle', 1); eq(s.rules.hideReticle, 1, 'reticle');
  run(s, 'ba_death_lvl_up', 3); eq(s.rules.deathLevelUp, 3, 'death level up');
  // Trap counts: quest types 0..3 land in the internal slots (damage 0, slow 2, confuse 3, freeze 1).
  regs[100] = 1; regs[101] = 7; run(s, 'ba_set_trap_count', 100); eq(s.rules.trapCounts, [0, 0, 7, 0], 'quest trap 1 (slow) -> internal 2');
  regs[100] = 3; regs[101] = 4; run(s, 'ba_set_trap_count', 100); eq(s.rules.trapCounts, [0, 4, 7, 0], 'quest trap 3 (freeze) -> internal 1');
  regs[100] = 4; regs[101] = 9; run(s, 'ba_set_trap_count', 100); eq(s.rules.trapCounts, [0, 4, 7, 0], 'trap type 4 ignored');
  // Weights: r0 + r1 / r2 as float32; trap damage the same way.
  regs[100] = 0; regs[101] = 5; regs[102] = 100; run(s, 'ba_player_give_damage_score', 100);
  eq(s.weights.playerGive, Math.fround(0.05), 'weight 0 + 5/100');
  regs[100] = 3; regs[101] = 0; regs[102] = 1; run(s, 'ba_enemy_kill_score', 100); eq(s.weights.enemyKill, 3, 'weight 3');
  regs[100] = 400; regs[101] = 0; regs[102] = 1; run(s, 'set_trap_damage', 100); eq(s.trapDamage, 400, 'trap damage override');
  check(Number.isNaN(weightFromRegs(0, 0, 0)), '0/0 stays NaN, as in the float division');
  // Announcements: eight slots, a 0 is a free slot, clear empties.
  for (let m = 1; m <= 9; m++) run(s, 'set_score_announce', m);
  eq(s.announce, [1, 2, 3, 4, 5, 6, 7, 8], 'a ninth announcement is dropped');
  run(s, 'clear_score_announce'); eq(s.announce, [0, 0, 0, 0, 0, 0, 0, 0], 'clear_score_announce');
  // clear_ba_rules leaves the weights and announcements.
  run(s, 'clear_ba_rules'); eq(s.rules, newBattleRules(), 'clear_ba_rules resets the rules');
  check(s.weights.enemyKill === 3, 'clear_ba_rules keeps the weights');
  run(s, 'ba_set_trapself'); check(s.trapsHitOwner, 'ba_set_trapself'); run(s, 'ba_clear_trapself'); check(!s.trapsHitOwner, 'ba_clear_trapself');
  run(s, 'disable_win_pfx'); check(!s.winEffects, 'disable_win_pfx'); run(s, 'enable_win_pfx'); check(s.winEffects, 'enable_win_pfx');
  check(!run(s, 'cmode_stage', 1), 'a challenge opcode is not ours');
  run(s, 'ba_start'); check(s.started && s.message === 'rules', 'ba_start');
}
eq([baInitialFloor(0), baInitialFloor(1), baInitialFloor(2), baInitialFloor(3), baInitialFloor(0x12)], [0x10, 0x11, 0, 1, null], 'ba_initial_floor');

// --- the rule struct -------------------------------------------------------------
{
  const r = newBattleRules();
  Object.assign(r, { techDisk: 2, weaponAndArmor: 3, teams: 1, deathLevelUp: 4, lives: 7, maxTechLevel: 9, charLevel: 50, timeLimit: 15, deathTechLevelUp: 2, boxDropArea: 4 });
  r.trapCounts = [1, 2, 3, 4];
  const b = encodeBattleRules(r);
  check(b.length === 0x30 && b[0] === 2 && b[1] === 3 && b[9] === 1 && b[0x0d] === 1 && b[0x10] === 4, 'rule struct layout');
  eq(decodeBattleRules(b), r, 'rule struct round trip');
  check(build6xCF(r, 6).length === 0x30 && new DataView(build6xCF(r, 6).buffer).getUint32(0x2c, true) === 6, '6xCF carries the box drop count');
  const e = effectiveRules({ ...r, trapCounts: [30, 0, 0, 0], lives: 100, maxTechLevel: 40 }, 3);
  check(e.teams === 0 && e.trapCounts[0] === 20 && e.lives === 0 && e.maxTechLevel === 0, 'effective rules: no teams below four players, trap counts <= 20, bad values -> 0');
  check(effectiveRules(r, 4).teams === 1, 'teams with four players');
  const lr = localRestrictions(effectiveRules({ ...r, respawn: 2, tool: 2, mag: 1, meseta: 1, replaceChar: 1, trapMode: 1 }, 4));
  check(lr.removeRareWeapons && !lr.removeWeapons && lr.limitTechLevel === 9 && lr.lives === 7 && lr.removeTools && lr.removeMags && lr.clearMeseta && lr.replaceCharLevel === 50 && lr.traps?.[3] === 4, 'local restrictions');
}

// --- teams, scores, places --------------------------------------------------------
eq(assignTeams([true, true, true, true], true), [2, 1, 2, 1], 'teams alternate starting with team 2');
eq(assignTeams([true, true, true, true], false), [0, 0, 0, 0], 'no teams');
{
  const w = { playerGive: 0.05, playerTake: 0.02, enemyGive: 0.01, enemyTake: 0, playerKill: 10, playerDeath: 7, enemyKill: 3, enemyDeath: 7, meseta: 0 };
  const p = new PlayerScore();
  p.kill(true, w); p.kill(false, w); p.die(false, w); p.giveDamage(300, true, w); p.takeDamage(100, true, w);
  // kills 10 + 3 = 13, given 15, taken 2, deaths 7: 13 + (15 - 2) - 7 = 19
  eq(p.total(w, 0, false), 19, 'points formula');
  const m = new PlayerScore();
  eq(m.total({ ...w, meseta: 0.001 }, 4000, false), 4, 'meseta counts while alive');
  eq(m.total({ ...w, meseta: 0.001 }, 4000, true), 0, 'meseta does not count while dead');
  check([roundEven(0.5), roundEven(1.5), roundEven(2.5), roundEven(2.4)].join() === '0,2,2,2', 'x87 round-half-even');
}
{
  const r = rankPlayers([{ id: 0, points: 10 }, { id: 1, points: 30 }, { id: 2, points: 30 }, { id: 3, points: 5 }], false);
  eq(r.map((e) => [e.id, e.place]), [[1, 0], [2, 0], [0, 2], [3, 3]], 'ties share the place, the next place skips');
  const t = rankPlayers([{ id: 0, points: 10, team: 2 }, { id: 1, points: 30, team: 1 }, { id: 2, points: 25, team: 2 }, { id: 3, points: 4, team: 1 }], true);
  eq(t.map((e) => [e.id, e.place, e.points]), [[0, 0, 35], [2, 0, 35], [1, 2, 34], [3, 2, 34]], 'teams share a total');
  check(rankPlayers([], false).length === 4, 'the table always has four entries');
}
{
  const rec = new BattleRecords([1, 0, 0, 0, 0, 0, 0]);
  rec.started(); check(rec.fields[4] === 1, 'disconnect counted at the start');
  rec.finished(1, true); check(rec.fields[1] === 1 && rec.fields[4] === 0, 'second place counted, disconnect cleared');
  rec.finished(0, false); check(rec.fields[0] === 1 && rec.fields[4] === 0, 'a shared first place counts nothing');
  const full = new BattleRecords([0xffff]); full.finished(0, true); check(full.fields[0] === 0xffff, 'counters saturate');
}
eq([formatBattleTimer(600), formatBattleTimer(59), formatBattleTimer(3725), formatBattleTimer(36000)], ["0'10\"00", "0'00\"59", "1'02\"05", "9'59\"59"], 'timer text');
eq(trapNumber(2, 3, 5), 2 * 0x50 + 3 * 0x14 + 5, 'trap number');
{
  const a = shuffleStarts(() => 0.3);
  const b = shuffleStarts(Math.random);
  check([...a].sort().join() === '0,1,2,3' && [...b].sort().join() === '0,1,2,3', 'start locations are a permutation');
}

// --- payloads ------------------------------------------------------------------------
{
  const m: Battle7D = { what: 3, phase: 0, alive: 1, params: [2, 1234, 0xffffffff, 0xffffffff] };
  const body = new Uint8Array(0x18);
  body.set(build7D(m), 4);
  body[0] = 0x7d;
  body[1] = 6;
  eq(parse7D(body), m, '6x7D round trip');
  check(build7D(m).length + 4 === 0x18, '6x7D is 0x18 bytes');
  check(build6x8F(1, 40).length + 4 === 8 && build6xD0(3).length + 4 === 8, '6x8F / 6xD0 are 8 bytes');
}

// --- the controller against a fake host ------------------------------------------------
{
  const sent: Battle7D[] = [];
  const log: string[] = [];
  const present = [true, true, false, false];
  let timer = -1;
  let ended = false;
  let resultPlace = -2;
  const records = new BattleRecords();
  const host: BattleHost = {
    localId: 0,
    leaderId: () => 0,
    present: () => present,
    send7D: (m) => sent.push(m),
    send6xCF: () => log.push('6xCF'),
    localPoints: () => 50,
    localAlive: () => true,
    showRules: () => log.push('rules'),
    showTeams: () => log.push('teams'),
    closeWindows: () => log.push('close'),
    setTimer: (s) => (timer = s),
    closeTimer: () => log.push('timer off'),
    announce: () => log.push('announce'),
    results: (_e, p) => (resultPlace = p),
    askRematch: async () => 'lobby',
    applyRestrictions: () => log.push('restrict'),
    startBattle: () => log.push('start'),
    endBattle: () => (ended = true),
    exit: () => {},
    records,
  };
  const setup = new BattleSetup();
  setup.rules.timeLimit = 1; // one minute
  setup.rules.respawn = 2;
  setup.rules.lives = 3;
  setup.announce[0] = 1;
  const c = new BattleController({ setup, host });
  const frame = (n = 1) => {
    for (let i = 0; i < n; i++) c.tick();
  };
  frame();
  check(log.includes('6xCF') && log.includes('restrict') && timer === 60 && c.state === 'rules' && c.livesLeft === 3, 'init: 6xCF by the leader, rules applied, timer set');
  check(records.fields[4] === 1, 'the record counts the battle as a disconnect until it ends');
  frame(2);
  check(log.includes('rules'), 'the rules window opens');
  frame(RULES_FRAMES + 1);
  check(!log.includes('teams'), 'no team window without teams');
  frame(3);
  check(sent.some((m) => m.what === 4 && m.params[0] === 0), 'the start acknowledgment 6x7D what 4 is sent');
  frame(5);
  check(c.state === 'rules', "still waiting for the other player's acknowledgment");
  c.receive7D(1, { what: 4, phase: 0, alive: 0, params: [1, 0, 0, 0] });
  frame(2 + LOADING_FRAMES + 1);
  check(c.state === 'battle' && log.includes('start'), 'the battle starts after the loading bar');
  c.receive7D(1, { what: 3, phase: 0, alive: 1, params: [1, 70, 0, 0] });
  frame(30 * 10);
  check(timer === 50, `the clock counts down (${timer})`);
  eq(c.onLocalDeath(), { result: 'respawn', levelUp: 0, techLevelUp: 0 }, 'a death with lives left respawns');
  check(c.livesLeft === 2, 'a life is spent');
  c.onLocalDeath();
  c.onLocalDeath();
  eq(c.onLocalDeath().result, 'out', 'no lives left: out');
  frame(30 * 50 + 1);
  check(ended && c.state === 'results' && sent.some((m) => m.what === 0 && m.phase === 3), 'the time limit ends the battle with 6x7D phase 3');
  c.receive7D(1, { what: 3, phase: 0, alive: 1, params: [1, 70, 0, 0] });
  frame(RULES_FRAMES * 3);
  check(resultPlace === 1, `results: we scored 50 against 70 -> second place (got ${resultPlace})`);
  eq(c.places.slice(0, 2).map((e) => [e.id, e.place]), [[1, 0], [0, 1]], 'result table order');
  check(records.fields[1] === 1 && records.fields[4] === 0, 'the record got a second place');
}
{
  // Alone in the game: the battle aborts (6x7D what 0 phase 5).
  const sent: Battle7D[] = [];
  let exited: boolean | null = null;
  const host: BattleHost = {
    localId: 0, leaderId: () => 0, present: () => [true, false, false, false], send7D: (m) => sent.push(m), send6xCF: () => {},
    localPoints: () => 0, localAlive: () => true, showRules: () => {}, showTeams: () => {}, closeWindows: () => {}, setTimer: () => {},
    closeTimer: () => {}, announce: () => {}, results: () => {}, askRematch: async () => null, applyRestrictions: () => {},
    startBattle: () => {}, endBattle: () => {}, exit: (a) => (exited = a),
  };
  const setup = new BattleSetup();
  setup.rules.timeLimit = 5;
  const c = new BattleController({ setup, host });
  for (let i = 0; i < RULES_FRAMES * 3 + ACK_FRAMES + LOADING_FRAMES + 50; i++) c.tick();
  check(exited === true && sent.some((m) => m.what === 0 && m.phase === 5), 'alone: abort');
}

// --- Game.create with the battle flag ------------------------------------------------------
{
  let sent: { cmd: number; body: Uint8Array } | null = null;
  const conn = { onCommand: () => {}, send: (cmd: number, _flag: number, body: Uint8Array) => (sent = { cmd, body }), waitFor: () => new Promise(() => {}) };
  const lobby = { conn, selfEntry: null } as never;
  const ctx = { guildCardNumber: 1, fullCharacter: () => null };
  void Game.create(lobby, ctx, { name: 'duel', battle: true, difficulty: 1, episode: 2 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 20));
  const s = sent as { cmd: number; body: Uint8Array } | null;
  check(!!s && s.cmd === 0xc1 && s.body[0x49] === 1 && s.body[0x4a] === 0 && s.body[0x4c] === 0 && s.body[0x48] === 1 && s.body[0x4b] === 2, 'C1 create game carries the battle flag at 0x49');
}

// --- the eight battle quests through the VM ----------------------------------------------------
const MAIN_ROOT = (() => {
  try {
    return dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim());
  } catch {
    return join(HERE, '..');
  }
})();
const NEWSERV = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(MAIN_ROOT, 'vendor/newserv')].find((d) => d && existsSync(join(d, 'system/quests/battle')));
if (!NEWSERV) console.log('SKIP no newserv checkout with system/quests/battle');
else {
  const dir = join(NEWSERV, 'system/quests/battle');
  const load = (p: string) => prsDecompress(new Uint8Array(readFileSync(p)));
  let n = 0;
  for (const f of readdirSync(dir).filter((x) => /^b88\d+-bb-e\.bin$/.test(x))) {
    const base = f.replace('-bb-e.bin', '');
    const lq: LoadedQuest = { name: base, binFilename: f, datFilename: `${base}-bb.dat`, bin: load(join(dir, f)), dat: load(join(dir, `${base}-bb.dat`)), binCompressedSize: 0, datCompressedSize: 0, download: false };
    const started: BattleSetup[] = [];
    const s = new QuestSession(lq, { log: () => {}, host: { battleStart: (b) => started.push(b), playerCount: () => 2 } });
    s.start();
    for (let fl = 0; fl < s.vm.floorHandlers.length; fl++) if (s.vm.floorHandlers[fl]! >= 0) s.enterFloor(fl);
    for (let i = 0; i < 3000; i++) s.vm.frame();
    const missing = [...s.vm.unimplemented.keys()].filter((k) => k.startsWith('ba_') || /score|trap|sonar/.test(k));
    check(missing.length === 0, `${base}: battle opcodes all implemented (${missing.join(',')})`);
    check(started.length >= 1, `${base}: ba_start fired`);
    const b = s.vm.battle;
    check(b.rules.timeLimit > 0 && b.message.length > 10, `${base}: time limit ${b.rules.timeLimit} and rules text set`);
    check(Object.values(b.weights).some((x) => x !== 0),`${base}: score weights set (${JSON.stringify(b.weights)})`);
    check(b.announce[0] === 1, `${base}: score announcements from minute 1`);
    check(b.initialFloor !== null, `${base}: ba_initial_floor read`);
    n++;
    if (base === 'b88001') {
      // From the disassembly: tech 1, weapons 1, mags 1, tools 1 (all ALLOW), trap mode 1, respawn 1 (ALLOW), no replace,
      // dropwep 1, teams 1, reticle 1, meseta 0, death level 3, time 10, sonar on with 5.
      eq([b.rules.techDisk, b.rules.weaponAndArmor, b.rules.mag, b.rules.tool, b.rules.trapMode, b.rules.respawn, b.rules.replaceChar, b.rules.dropWeapon, b.rules.teams, b.rules.hideReticle, b.rules.meseta, b.rules.deathLevelUp, b.rules.timeLimit, b.rules.sonar, b.rules.sonarCount, b.rules.deathTechLevelUp], [0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 3, 10, 1, 5, 1], 'b88001 rules');
      eq(b.rules.trapCounts, [5, 5, 5, 5], 'b88001 trap counts');
      eq(b.announce.slice(0, 5), [1, 3, 5, 7, 9], 'b88001 announcements');
    }
  }
  check(n === 8, `eight battle quests (${n})`);
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
