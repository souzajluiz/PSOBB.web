// Combat: the damage and accuracy formulas, the attack combo state machine
// and the enemy slot expansion (entity ids), checked against newserv.
//
// Run: node tests/combat.test.ts
// Env: PSOBB_DATA (client data/ folder), NEWSERV (vendor/newserv)
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { BattleParams } from '../client/src/formats/battleparams.ts';
import { ENEMY_TYPE_PARAMS } from '../client/src/formats/entitynames.ts';
import { expandEnemySets } from '../client/src/formats/enemyslots.ts';
import { parseEnemySets, type EnemySet } from '../client/src/formats/setdata.ts';
import { floorFiles, parseSetDataTable } from '../client/src/formats/setdatatable.ts';
import { floorToArea } from '../client/src/net/game.ts';
import { attackMotion, AttackState, comboWindow, hitFrame } from '../client/src/combat/attack.ts';
import {
  applyDamage,
  ATTACK_ACCURACY_MULT,
  ATTACK_DAMAGE_MULT,
  COMBO_ACCURACY_MULT,
  defenceResists,
  enemyDefence,
  enemyDefender,
  FLAG_BIG_HIT,
  FLAG_DEAD,
  FLAG_HIT,
  FLAG_MISSED,
  hitChance,
  playerAttacker,
  rollDamage,
  rollHit,
} from '../client/src/combat/formulas.ts';
import { buildDropRequest, buildEnemyState, parseAttack, parseAttackTargets, parseEnemyState } from '../client/src/net/game.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
const NEWSERV = process.env.NEWSERV ?? join(ROOT, 'vendor/newserv');

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) {
    failures++;
    if (failures <= 40) console.log(`FAIL ${msg}`);
  }
};
const near = (got: number, want: number, eps: number, msg: string) => check(Math.abs(got - want) <= eps, `${msg}: got ${got}, want ${want}`);

// ---------------------------------------------------------------- 1. formulas

// Tables read out of PsoBB.exe (0x009cb9d0 / 0x009cb9dc / 0x009cb9e8).
check(ATTACK_DAMAGE_MULT.join() === '0.9,1.7,0.5', `damage multipliers: ${ATTACK_DAMAGE_MULT.join()}`);
check(ATTACK_ACCURACY_MULT.join() === '1,0.7,0.5', `accuracy multipliers: ${ATTACK_ACCURACY_MULT.join()}`);
check(COMBO_ACCURACY_MULT.join() === '1,1.3,1.69', `combo multipliers: ${COMBO_ACCURACY_MULT.join()}`);

// FUN_00777664: p = (ATA * type * combo - EVP * 0.2) * 0.01.
const atk = { atp: 300, atpSpread: 15, equipAtp: 60, ata: 180, lck: 20, isPlayer: true };
const def = { hp: 500, maxHp: 500, evp: 50, dfp: 100 };
near(hitChance(atk, def, 0, 0), (180 - 10) * 0.01, 1e-6, 'hit chance normal, first attack');
near(hitChance(atk, def, 1, 1), (180 * 0.7 * 1.3 - 10) * 0.01, 1e-6, 'hit chance heavy, second attack');
near(hitChance(atk, def, 2, 2), (180 * 0.5 * 1.69 - 10) * 0.01, 1e-6, 'hit chance special, third attack');
check(!rollHit(atk, { ...def, evp: 100000 }, 0, 0, () => 0), 'a negative chance never hits');
check(rollHit(atk, def, 0, 0, () => 0), 'a roll of 0 hits');

// GetEnemyDefense_00773a44 and the defence roll (EntityHitEntity_00773350, 0x773397).
check(enemyDefence(null) === 0, 'an enemy (null +0x324 row) has no defence');
check(enemyDefence({ short5: 0 }) === 0 && enemyDefence({ short5: -5 }) === 0, 'a row value <= 0 gives no defence');
near(enemyDefence({ short5: 30 }), 0.3, 1e-9, 'defence = value * 0.01');
check(enemyDefence({ short5: 500 }) === 1, 'defence is clamped to 1.0');
{
  let drawn = 0;
  const rng = () => ((drawn++), 0);
  check(!defenceResists(0, rng) && drawn === 0, 'a zero defence resists nothing and draws no number');
  check(defenceResists(0.3, () => 0.29) && !defenceResists(0.3, () => 0.3), 'the roll resists below the defence only');
  check(!defenceResists(enemyDefence(null), rng) && drawn === 0, 'no enemy attack is resisted: the roll is never drawn');
}

// FUN_007732b8: (ATP + spread * r) * 0.2 + equip ATP * 0.2 * (1 + attr) - DFP * 0.2, then the type multiplier.
{
  const r = 0.5;
  const base = (300 + 15 * r) * 0.2 + 60 * 0.2 - 100 * 0.2;
  const rolls = [r, 1]; // second roll: no critical (LCK 20 < 500)
  let i = 0;
  const d = rollDamage(atk, def, 0, () => rolls[i++]);
  near(d.damage, base * 0.9, 1e-4, 'normal damage');
  check(!d.critical, 'no critical with a high roll');
  i = 0;
  near(rollDamage(atk, def, 1, () => rolls[i++]).damage, base * 1.7, 1e-4, 'heavy damage');
  i = 0;
  const crit = rollDamage(atk, def, 0, () => [r, 0][i++]);
  check(crit.critical, 'a roll of 0 is a critical hit');
  near(crit.damage, base * 0.9 * 1.5, 1e-4, 'critical damage');
  // The weapon attribute adds to the equipment ATP part.
  i = 0;
  near(rollDamage({ ...atk, attributePercent: 30 }, def, 0, () => rolls[i++]).damage, (base + 60 * 0.2 * 0.3) * 0.9, 1e-4, 'attribute damage');
}

// The flags and HP of FUN_007732b8's tail (FUN_0077529c / FUN_00777414).
{
  const d = { hp: 100, maxHp: 100, evp: 0, dfp: 0 };
  check(applyDamage(d, 0.9) === FLAG_MISSED && d.hp === 100, 'damage below 1 is a miss');
  check(applyDamage(d, 10) === FLAG_HIT && d.hp === 90, 'a normal hit');
  // EntityHitEntity: a landed roll sets 0x200 (took_damage) at 0 damage; a miss is 0x100 only.
  check(applyDamage(d, 0, true) === FLAG_HIT && d.hp === 90, 'a landed 0-damage hit sends 0x200');
  check(applyDamage(d, 0, false) === FLAG_MISSED && d.hp === 90, 'a missed roll sends 0x100');
  check(applyDamage(d, 30) === (FLAG_HIT | FLAG_BIG_HIT) && d.hp === 60, 'more than 25% of max HP sets the big-hit flag');
  check((applyDamage(d, 60) & FLAG_DEAD) !== 0 && d.hp === 0, 'HP below 1 sets the dead flag');
}

// Player stats (FUN_00770da4 with the class table at 0x00968a60) and the enemy
// side (FUN_007868f8: HP = stats.hp + level, EVP / DFP get the resist bonus).
{
  const a = playerAttacker(0, { atp: 500, ata: 150, lck: 30 }, { atpMin: 40, atpMax: 55, grind: 10, ata: 30 });
  // Saved ATP 500 is the stat block (the base, DEVLOG 2026-10-23 "the save holds the stat block"):
  // rmin = 5 + 40 + 2 x 10 = 65, rmax = 10 + 55 + 2 x 10 = 85, so the variance is 20 and the
  // attack range is [500 + 65, 500 + 85]. The displayed ATP would be 585.
  check(a.atp === 500 && a.atpSpread === 20 && a.equipAtp === 65, `HUmar with a +10 Saber: ${JSON.stringify(a)}`);
  check(a.ata === Math.round((650 + 150) * 0.1) + 30, `HUmar ATA: ${a.ata}`);
  const bare = playerAttacker(9, { atp: 100, ata: 100, lck: 10 }, null);
  check(bare.equipAtp === 5 && bare.atpSpread === 5, `HUcaseal bare hands: ${JSON.stringify(bare)}`);
  const e = enemyDefender({ hp: 200, level: 3, evp: 42, dfp: 118 }, { evpBonus: 5, dfpBonus: -8 });
  check(e.maxHp === 203 && e.hp === 203 && e.evp === 47 && e.dfp === 110, `enemy stats: ${JSON.stringify(e)}`);
}

// ------------------------------------------------------- 2. combo state machine

// Motion tables 0x009cbeec / 0x009cbf04 (slots 2, 3, 4) and the hit frame and
// combo window tables (0x00968ca0, 0x00969078).
check(attackMotion(0, 1, 0).index === 99 && attackMotion(0, 1, 2).index === 101, 'male sword attack motions');
check(attackMotion(1, 0, 0).index === 407, 'female bare-hand first attack');
check(attackMotion(0, 8, 0).mode === 1, 'mechguns loop their attack motion');
check(hitFrame(1, 0, 0) === 13 && hitFrame(1, 2, 0) === 14, 'sword hit frames');
check(hitFrame(1, 0, 1) === 0, 'a sword swing has one hit');
check(hitFrame(3, 0, 0) === 12 && hitFrame(3, 0, 1) === 29 && hitFrame(3, 0, 2) === 0, 'daggers hit twice');
check(comboWindow(1, 0) === 9 && comboWindow(0, 0) === 2, 'combo windows');

// A full three-hit combo: each attack hits once, the next press inside the
// window chains to the following attack, and the combo ends after step 3.
{
  const log: string[] = [];
  const state = new AttackState(0, 1, {
    start: (step, type) => log.push(`start ${step}/${type}`),
    hit: (step) => log.push(`hit ${step}`),
    end: () => log.push('end'),
  });
  const run = (step: number, type: number, press: boolean): { step: number; type: number } | null => {
    state.begin(step, type);
    let next: { step: number; type: number } | null = null;
    for (let frame = 1; frame <= 40 && state.active; frame++) {
      const r = state.tick(frame, frame >= 30);
      if (press && frame === 20) check(state.press(0), `press inside the window of step ${step}`);
      if (r.next) next = r.next;
      if (r.next || r.idle) break;
    }
    return next;
  };
  let next = run(0, 0, true);
  check(next?.step === 1, `step 0 queued step 1: ${JSON.stringify(next)}`);
  next = run(next!.step, next!.type, true);
  check(next?.step === 2, `step 1 queued step 2: ${JSON.stringify(next)}`);
  next = run(next!.step, next!.type, false);
  check(next === null, 'the third attack ends the combo');
  check(log.join(' | ') === 'start 0/0 | hit 0 | start 1/0 | hit 1 | start 2/0 | hit 2 | end', `combo log: ${log.join(' | ')}`);
}

// A press before the hit frame loses the combo.
{
  const state = new AttackState(0, 1, { start: () => {}, hit: () => {}, end: () => {} });
  state.begin(0, 0);
  state.tick(1, false);
  check(!state.press(0), 'a press before the window does not queue');
  for (let frame = 2; frame <= 20; frame++) state.tick(frame, false);
  check(!state.press(0), 'the combo stays lost');
  // The motion plays out and the combo window runs out: back to idle, no chain.
  let r = { next: null as { step: number; type: number } | null, idle: false };
  for (let i = 0; i < 20 && !r.idle; i++) r = state.tick(30, true);
  check(r.next === null && r.idle, 'a lost combo returns to idle');
}

// A heavy attack pauses its motion for the charge phase (FUN_00698fa8 phases 1, 2).
{
  const state = new AttackState(0, 1, { start: () => {}, hit: () => {}, end: () => {} });
  state.begin(0, 1);
  check(state.paused, 'a heavy attack starts paused');
  let ticks = 0;
  while (state.paused && ticks < 20) {
    state.tick(0, false);
    ticks++;
  }
  check(ticks === 8, `the charge pause lasts ${ticks} ticks`);
}

// --------------------------------------------------------- 3. the 6x commands

{
  const a = parseAttack(Uint8Array.from([0x44, 0x02, 0x01, 0x00, 0x00, 0x40, 0x01, 0x00]));
  check(a?.clientId === 1 && a?.step === 1 && a?.attackType === 1, `6x44: ${JSON.stringify(a)}`);
  near(a!.angle, Math.PI / 2, 1e-6, '6x44 angle');
  const state = buildEnemyState(0x71, 0x38, 0x20900e00);
  check(
    [...state].map((b) => b.toString(16).padStart(2, '0')).join(' ') === '0a 03 71 10 71 00 38 00 00 0e 90 20',
    `6x0A bytes: ${[...state].map((b) => b.toString(16)).join(' ')}`,
  );
  const parsed = parseEnemyState(state);
  check(parsed?.enemyIndex === 0x71 && parsed?.totalDamage === 0x38 && parsed?.flags === 0x20900e00, `6x0A round trip: ${JSON.stringify(parsed)}`);
  const targets = parseAttackTargets(Uint8Array.from([0x46, 0x04, 0, 0, 2, 0, 0, 0, 0x71, 0x10, 0, 0, 0x72, 0x10, 0, 0]));
  check(targets?.targets.join() === '4209,4210', `6x46 targets: ${JSON.stringify(targets)}`);
  const drop = buildDropRequest({ floor: 1, rtIndex: 9, enemyIndex: 0x12, x: 1, z: 2, room: 3, area: 1 });
  const dv = new DataView(drop.buffer);
  check(drop.length === 0x18 && drop[0] === 0x60 && drop[1] === 6, '6x60 header');
  check(drop[4] === 1 && drop[5] === 9 && dv.getUint16(6, true) === 0x12 && drop[0x14] === 1, '6x60 fields');
}

// ---------------------------------- 4. enemy slots vs newserv's supermap

const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
const loose = new Set(readdirSync(DATA));
const read = (name: string) => (loose.has(name) ? new Uint8Array(readFileSync(join(DATA, name))) : gsl.has(name) ? gsl.get(name) : null);
const table = parseSetDataTable(read('SetDataTableOn.rel')!);
// newserv validates the 6x commands against its own BB map files.
const readNewservMap = (name: string): Uint8Array | null => {
  try {
    return new Uint8Array(readFileSync(join(NEWSERV, 'system/maps/bb-v4', name)));
  } catch {
    return null;
  }
};

for (const episode of [1, 2, 3]) {
  // newserv's supermap for variations 0 (the same free-play map files).
  const out = execFileSync(join(NEWSERV, 'build/newserv'), ['print-free-supermap', `--episode=${episode === 3 ? 4 : episode}`, '0'.repeat(32)], {
    cwd: NEWSERV,
    maxBuffer: 1 << 28,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  // "  FL E-xxx <12 version columns> [Enemy ... type=NAME ... is_default_rare_bb=BOOL ..."
  const want = new Map<number, Array<{ index: number; type: string; rare: boolean }>>();
  for (const line of out.split('\n')) {
    const m = /^ {2}([0-9A-F]{2}) E-[0-9A-F]{3} ((?:\S+ ){12})\[Enemy .*?type=(\w+) .*?is_default_rare_bb=(\w+)/.exec(line);
    if (!m) continue;
    const bb = m[2].trim().split(/\s+/)[11];
    if (bb === '---------') continue;
    const floor = parseInt(m[1], 16);
    const list = want.get(floor) ?? [];
    list.push({ index: parseInt(bb.slice(0, 4), 16), type: m[3], rare: m[4] === 'true' });
    want.set(floor, list);
  }
  const areas = floorToArea(episode);
  let base = 0;
  let compared = 0;
  for (let floor = 0; floor < 0x10; floor++) {
    const area = areas[floor];
    if (area < 0 || !table[area]) continue;
    const files = floorFiles(table, area, 0, 0, floor, 'normal');
    // newserv's own BB map files: its Pioneer 2 file has 21 enemy sets where
    // the Ephinea client's has 23, so only the same input can be compared.
    const data = files ? readNewservMap(files.enemies) : null;
    if (!data) continue;
    const sets = parseEnemySets(data) as EnemySet[];
    const slots = expandEnemySets(sets, area, 0);
    // newserv prints the supermap in its own (cross-version) order; the BB
    // column is where each enemy sits in a BB client's list.
    const ref = (want.get(floor) ?? []).slice().sort((a, b) => a.index - b.index);
    check(slots.length === ref.length, `episode ${episode} floor ${floor}: ${slots.length} slots, newserv ${ref.length}`);
    for (let i = 0; i < Math.min(slots.length, ref.length); i++) {
      if (i === 0) check(base + i === ref[i].index, `episode ${episode} floor ${floor}: first entity index ${base + i}, newserv ${ref[i].index}`);
      // newserv's supermap keeps the base type and flags the default rares;
      // our expansion applies the BB rare type directly.
      if (!ref[i].rare) check(slots[i].type === ref[i].type, `episode ${episode} floor ${floor} slot ${i}: ${slots[i].type}, newserv ${ref[i].type}`);
      compared++;
    }
    base += slots.length;
  }
  console.log(`episode ${episode === 3 ? 4 : episode}: ${compared} enemy slots match newserv's supermap`);
}

// Every enemy type our expansion can produce has newserv's drop and battle
// parameter indexes (ENEMY_TYPE_PARAMS, generated from newserv's type_defs).
{
  const missing = new Set<string>();
  for (const episode of [1, 2, 3]) {
    const areas = floorToArea(episode);
    for (let floor = 0; floor < 0x10; floor++) {
      const area = areas[floor];
      if (area < 0 || !table[area]) continue;
      const files = floorFiles(table, area, 0, 0, floor, 'normal');
      const data = files ? read(files.enemies) : null;
      if (!data) continue;
      for (const slot of expandEnemySets(parseEnemySets(data) as EnemySet[], area, 0)) {
        if (!ENEMY_TYPE_PARAMS[slot.type]) missing.add(slot.type);
      }
    }
  }
  check(missing.size === 0, `enemy types without newserv parameters: ${[...missing].join(', ')}`);
}

// BattleParamEntry: the binary table the server streams to BB clients, read
// with formats/battleparams.ts and compared with newserv's battle-params.json
// (Episode 1 online). The .dat is SEGA data and is not in the repository:
// BATTLE_PARAMS, else the Tethealla server folder next to this one.
{
  const file = process.env.BATTLE_PARAMS ?? join(process.env.HOME!, 'Downloads/psobb-master/BattleParamEntry_on.dat');
  let data: Uint8Array | null = null;
  try {
    data = new Uint8Array(readFileSync(file));
  } catch {
    console.log(`BattleParamEntry: ${file} not found, skipped`);
  }
  if (data) {
    const params = new BattleParams(data);
    const json = JSON.parse(readFileSync(join(NEWSERV, 'system/tables/battle-params.json'), 'utf8')) as Record<
      string,
      Record<string, Array<{ BPIndex: number; Stats: Record<string, number>; ResistData: Record<string, number> }>>
    >;
    const rows = json['Episode1-Online']['Normal'];
    let compared = 0;
    for (const row of rows) {
      const got = params.stats(0, row.BPIndex);
      const res = params.resist(0, row.BPIndex);
      const ok =
        got.atp === row.Stats.ATP &&
        got.hp === row.Stats.HP &&
        got.dfp === row.Stats.DFP &&
        got.ata === row.Stats.ATA &&
        got.evp === row.Stats.EVP &&
        got.lck === row.Stats.LCK &&
        got.exp === row.Stats.EXP &&
        res.efr === row.ResistData.EFR &&
        res.dfpBonus === row.ResistData.DFPBonus;
      check(ok, `battle params bp ${row.BPIndex}: ${JSON.stringify(got)} / ${JSON.stringify(res)} vs ${JSON.stringify(row.Stats)}`);
      compared++;
    }
    const booma = ENEMY_TYPE_PARAMS['BOOMA'];
    const defender = enemyDefender(params.stats(0, booma.stats[0]), params.resist(0, booma.resist[0]));
    console.log(`BattleParamEntry: ${compared} rows match newserv; Booma has ${defender.maxHp} HP, ${defender.dfp} DFP, ${defender.evp} EVP on Normal`);
  }
}

console.log(`${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
