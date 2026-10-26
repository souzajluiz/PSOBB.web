// An enemy's technique hit on the local player (client/src/combat/enemytechplayer.ts): the group's
// damage (the resist it reads, (100 - resist) * 0.002 * base, base = MST * 0.5 + power), the freeze
// (group 2) and shock (group 3) rolls with their state-1 gate, the Megid kill (group 5, EDK) and the
// draws the exe makes (FUN_007751b0 once before the switch). Verified against the exe's
// entity_hit_by_tech (0x00773afc) in the dump (see the module header).
// Run: node tests/enemytechplayer.test.ts
import { enemyTechOnPlayer, enemyTechRoomRefused, ENEMY_HIT_GROUP, type EnemyTechInput } from '../client/src/combat/enemytechplayer.ts';
import { BOSS_AREAS } from '../client/src/net/telepipe.ts';
import { MAP_CLASS } from '../client/src/formats/playerroom.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

const ZERO = { efr: 0, eic: 0, eth: 0, elt: 0, edk: 0 };

// A rng that returns the given values in order and counts its calls.
function seq(values: number[]): { rng: () => number; calls: () => number } {
  let i = 0;
  return { rng: () => values[i++] ?? 0.99, calls: () => i };
}

function hit(over: Partial<EnemyTechInput>, values: number[] = [0.5, 0.5]) {
  const r = seq(values);
  const out = enemyTechOnPlayer({ group: 0, power: 0, mst: 0, elements: ZERO, rng: r.rng, ...over });
  return { out, calls: r.calls() };
}

// Group 0 (fixed damage): (MST * 0.5 + power) * 0.2, truncated; no resist, no roll of its own.
eq(hit({ group: 0, power: 50, mst: 100 }).out.damage, 20, 'fixed: (50 + 50) * 0.2 = 20');
eq(hit({ group: 0, power: 50, mst: 100, elements: { ...ZERO, efr: 90 } }).out.damage, 20, 'fixed: no element resist');
eq(hit({ group: 0, power: 50, mst: 100, attackerId: 0x4000 }).out.damage, 10, 'attacker id 0x4000: the MST term is dropped (50 * 0.2)');
eq(hit({ group: 0, power: -30, mst: 0 }).out.damage, 0, 'a negative power is clamped at 0');

// Group 1 (Foie family): (100 - EFR) * 0.002 * base; base = 100 (MST 100 * 0.5 + 50).
eq(hit({ group: ENEMY_HIT_GROUP.foie, power: 50, mst: 100 }).out.damage, 20, 'Foie, EFR 0: 100 * 0.2 = 20');
eq(hit({ group: ENEMY_HIT_GROUP.foie, power: 50, mst: 100, elements: { ...ZERO, efr: 50 } }).out.damage, 10, 'Foie, EFR 50 halves it');
eq(hit({ group: ENEMY_HIT_GROUP.foie, power: 50, mst: 100, elements: { ...ZERO, eic: 90, eth: 90 } }).out.damage, 20, 'Foie reads EFR only');
eq(hit({ group: ENEMY_HIT_GROUP.foie, power: 50, mst: 100, elements: { ...ZERO, efr: 150 } }).out.damage, -10, 'Foie, EFR 150: a negative damage (the exe passes it on)');

// Group 4 (Grants): ELT; group 0x13 (Barta): EIC; both with no status.
eq(hit({ group: ENEMY_HIT_GROUP.grants, power: 50, mst: 100, elements: { ...ZERO, elt: 50 } }).out.damage, 10, 'Grants reads ELT');
eq(hit({ group: ENEMY_HIT_GROUP.barta, power: 50, mst: 100, elements: { ...ZERO, eic: 50 } }).out.damage, 10, 'Barta (0x13) reads EIC');
eq(hit({ group: ENEMY_HIT_GROUP.barta, power: 50, mst: 100, elements: { ...ZERO, eic: 0 } }, [0.5, 0.0]).out.freeze, false, 'Barta: no freeze');

// Group 3 (Zonde): ETH; the shock roll only in state 1.
eq(hit({ group: ENEMY_HIT_GROUP.zonde, power: 240, mst: 0, elements: { ...ZERO, eth: 50 } }).out.damage, 24, 'Zonde reads ETH: 240 * 0.1 = 24');
const z0 = hit({ group: ENEMY_HIT_GROUP.zonde, power: 240, mst: 0 }, [0.5, 0.0]);
eq([z0.out.shock, z0.calls], [false, 1], 'Zonde, state 0: no shock and no second roll');
const z1 = hit({ group: ENEMY_HIT_GROUP.zonde, power: 240, mst: 0, defenderState: 1 }, [0.5, 0.1]);
eq([z1.out.shock, z1.calls], [true, 2], 'Zonde, state 1: roll 0.1 < chance 0.75: shock');
const z2 = hit({ group: ENEMY_HIT_GROUP.zonde, power: 240, mst: 0, defenderState: 1 }, [0.5, 0.8]);
eq(z2.out.shock, false, 'Zonde, state 1: roll 0.8 >= 0.75: no shock');
const z3 = hit({ group: ENEMY_HIT_GROUP.zonde, power: 240, mst: 0, defenderState: 1, elements: { ...ZERO, eth: 25 } }, [0.5, 0.6]);
eq(z3.out.shock, false, 'Zonde, state 1, ETH 25: chance 0.5, roll 0.6 misses');
eq(hit({ group: ENEMY_HIT_GROUP.zonde, power: 240, mst: 0, defenderState: 1, elements: { ...ZERO, eth: 25 } }, [0.5, 0.4]).out.shock, true, 'Zonde, ETH 25: chance 0.5, roll 0.4 lands');

// Group 2 (Gibarta / Rabarta): EIC for the damage; the freeze roll is drawn after the damage and lands
// only in state 1 (the exe's defender +0x32c test; an enemy attacker never passes CheckPlayerInvincibility).
const g0 = hit({ group: ENEMY_HIT_GROUP.gibarta, power: 50, mst: 100 }, [0.5, 0.0]);
eq([g0.out.freeze, g0.calls], [false, 2], 'Gibarta, state 0: the roll is drawn, no freeze');
eq(hit({ group: ENEMY_HIT_GROUP.gibarta, power: 50, mst: 100, defenderState: 1 }, [0.5, 0.7]).out.freeze, true, 'Gibarta, state 1, EIC 0: roll 0.7 < 0.75: freeze');
eq(hit({ group: ENEMY_HIT_GROUP.gibarta, power: 50, mst: 100, defenderState: 1 }, [0.5, 0.8]).out.freeze, false, 'Gibarta, state 1: roll 0.8: no freeze');
eq(hit({ group: ENEMY_HIT_GROUP.gibarta, power: 50, mst: 100, defenderState: 1, elements: { ...ZERO, eic: 50 } }, [0.5, 0.3]).out.freeze, false, 'Gibarta, EIC 50: chance 0.25, roll 0.3: no freeze');
eq(hit({ group: ENEMY_HIT_GROUP.gibarta, power: 50, mst: 100, elements: { ...ZERO, eic: 50 } }).out.damage, 10, 'Gibarta reads EIC for the damage');

// Group 5 (Megid): no damage; kill when the roll < (power - EDK) * 0.01; the first roll is the one tested.
const m1 = hit({ group: ENEMY_HIT_GROUP.megid, power: 300, mst: 0 }, [0.5]);
eq([m1.out.megidKill, m1.out.damage, m1.out.megidChance], [true, 0, 3], 'Megid power 300, EDK 0: chance 3, kill');
eq(hit({ group: ENEMY_HIT_GROUP.megid, power: 30, mst: 0 }, [0.5]).out.megidKill, false, 'Megid power 30: chance 0.3, roll 0.5 misses');
eq(hit({ group: ENEMY_HIT_GROUP.megid, power: 30, mst: 0 }, [0.2]).out.megidKill, true, 'Megid power 30: roll 0.2 kills');
const m2 = hit({ group: ENEMY_HIT_GROUP.megid, power: 30, mst: 0, elements: { ...ZERO, edk: 10 } }, [0.25]);
eq([m2.out.megidKill, m2.out.megidChance], [false, Math.fround(Math.fround(20) * Math.fround(0.01))], 'Megid, EDK 10: chance 0.2, roll 0.25 misses');
// The megid case's gate (objdump 0x007744e2..0x00774f8a): the kill block runs off a boss map; on a
// boss map only in Ultimate with the last killer (+0x2d8, u16) at 0x1000 or more. Verified 2026-10-26.
eq(hit({ group: ENEMY_HIT_GROUP.megid, power: 300, mst: 0, ultimate: true, attackerId: 0x1000 }, [0.5]).out.megidKill, true, 'Megid, not a boss map, Ultimate, killer 0x1000: the kill block runs (not blocked)');
eq(hit({ group: ENEMY_HIT_GROUP.megid, power: 300, mst: 0, ultimate: false, attackerId: 0x1000 }, [0.5]).out.megidKill, true, 'Megid, not a boss map, outside Ultimate: kill');
eq(hit({ group: ENEMY_HIT_GROUP.megid, power: 300, mst: 0, bossMap: true }, [0.5]).out.megidKill, false, 'Megid on a boss map: no kill');
const bm = hit({ group: ENEMY_HIT_GROUP.megid, power: 300, mst: 0, bossMap: true }, [0.5]);
eq([bm.out.damage, bm.calls], [0, 1], 'Megid on a boss map: no damage, the first roll is still drawn');
eq(hit({ group: ENEMY_HIT_GROUP.megid, power: 300, mst: 0, bossMap: true, ultimate: true, attackerId: 0xfff }, [0.5]).out.megidKill, false, 'Megid, boss map, Ultimate, killer 0xfff: no kill');
eq(hit({ group: ENEMY_HIT_GROUP.megid, power: 300, mst: 0, bossMap: true, ultimate: false, attackerId: 0x1000 }, [0.5]).out.megidKill, false, 'Megid, boss map, not Ultimate, killer 0x1000: no kill');
eq(hit({ group: ENEMY_HIT_GROUP.megid, power: 300, mst: 0, bossMap: true, ultimate: true, attackerId: 0x1000 }, [0.5]).out.megidKill, true, 'Megid, boss map, Ultimate, killer 0x1000: kill');

// The attacker id is the stored +0x2d8 when the groups run: an enemy (0x1000 | index) keeps the MST term.
eq(hit({ group: 0, power: 50, mst: 100, attackerId: 0x1005 }).out.damage, 20, 'enemy id 0x1005: MST term kept ((100 * 0.5 + 50) * 0.2)');
eq(hit({ group: 0, power: 50, mst: 100 }).out.damage, 20, 'default attacker (an enemy): MST term kept ((50 + 50) * 0.2)');

// Episode 2 room gate (entity_hit_by_tech 0x00773afc): groups outside 6..10 need equal sections; a refused
// hit returns before any roll (no draw) and does no damage.
const gated = hit({ group: 1, power: 50, mst: 100, episode: 2, defenderSection: 3, attackerSection: 4, elements: ZERO }, [0.5, 0.5]);
eq([gated.out.damage, gated.out.handled, gated.calls], [0, true, 0], 'Episode 2, sections 3 and 4: refused, no roll drawn');
eq(hit({ group: 1, power: 50, mst: 100, episode: 2, defenderSection: 4, attackerSection: 4 }, [0.5]).out.damage > 0, true, 'Episode 2, equal sections: the hit lands');
eq(hit({ group: 1, power: 50, mst: 100, episode: 1, defenderSection: 3, attackerSection: 4 }, [0.5]).out.damage > 0, true, 'Episode 1: no room gate');
eq(enemyTechRoomRefused({ group: 7, episode: 2, defenderSection: 3, attackerSection: 4 }), false, 'groups 6..10 are exempt from the gate');
eq(enemyTechRoomRefused({ group: 0x13, episode: 2, defenderSection: 3, attackerSection: 4 }), true, 'Barta (0x13) is gated');
eq(enemyTechRoomRefused({ group: 0, episode: 2, defenderSection: 0x10000, attackerSection: 0 }), false, 'section words compare as 16-bit (0x10000 is 0)');

// Groups the path does not handle (the support groups, the Olga / Dark Falz fixed hits are group 0).
eq(hit({ group: 6, power: 50, mst: 100 }).out.handled, false, 'resta (6) is not a damage group here');
eq(hit({ group: 0x14, power: 50, mst: 100 }).out.handled, false, 'group 0x14 is not a damage group here');
eq(hit({ group: ENEMY_HIT_GROUP.foie, power: 50, mst: 100 }).out.handled, true, 'Foie is handled');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
if (failures) process.exitCode = 1;

// The boss-map list is unknown_map_data's class 0xb rows (0x0097f040, read with tools/exedata.py
// 2026-10-26; current_map_is_boss_map (0x00807db8) reads the row of the current map id): the port's
// BOSS_AREAS must be exactly those ids.
eq(MAP_CLASS.flatMap((c, i) => (c === 0xb ? [i] : [])), [...BOSS_AREAS].sort((a, b) => a - b), 'BOSS_AREAS = the map class 0xb rows');
eq(MAP_CLASS.length, 46, 'unknown_map_data has 46 map rows in the port (map 46 is the test map)');
