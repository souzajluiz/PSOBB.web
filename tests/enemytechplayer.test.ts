// An enemy's technique hit on the local player (client/src/combat/enemytechplayer.ts): the group's
// damage (the resist it reads, (100 - resist) * 0.002 * base, base = MST * 0.5 + power), the freeze
// (group 2) and shock (group 3) rolls with their state-1 gate, the Megid kill (group 5, EDK) and the
// draws the exe makes (FUN_007751b0 once before the switch). Verified against the exe's
// entity_hit_by_tech (0x00773afc) in the dump (see the module header).
// Run: node tests/enemytechplayer.test.ts
import { enemyTechOnPlayer, ENEMY_HIT_GROUP, type EnemyTechInput } from '../client/src/combat/enemytechplayer.ts';

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
eq(hit({ group: 0, power: 50, mst: 100, lastKiller: 0x4000 }).out.damage, 10, 'lastKiller 0x4000: the MST term is dropped (50 * 0.2)');
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
eq(hit({ group: ENEMY_HIT_GROUP.megid, power: 300, mst: 0, ultimate: true, lastKiller: 0x1000 }, [0.5]).out.megidKill, false, 'Megid in Ultimate with a last killer above 0xfff: blocked');
eq(hit({ group: ENEMY_HIT_GROUP.megid, power: 300, mst: 0, ultimate: false, lastKiller: 0x1000 }, [0.5]).out.megidKill, true, 'Megid outside Ultimate: not blocked');

// Groups the path does not handle (the support groups, the Olga / Dark Falz fixed hits are group 0).
eq(hit({ group: 6, power: 50, mst: 100 }).out.handled, false, 'resta (6) is not a damage group here');
eq(hit({ group: 0x14, power: 50, mst: 100 }).out.handled, false, 'group 0x14 is not a damage group here');
eq(hit({ group: ENEMY_HIT_GROUP.foie, power: 50, mst: 100 }).out.handled, true, 'Foie is handled');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
if (failures) process.exitCode = 1;
