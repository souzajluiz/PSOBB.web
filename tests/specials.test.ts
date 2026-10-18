// Weapon specials (combat/specials.ts): who may start a special attack, the
// weapon-kind reduction, the miss retry rule and HandleSpecialAttack's
// formulas, chances and costs, checked against hand-computed values of the
// exe's constants.
// Run: node tests/specials.test.ts
import {
  canUseSpecialAttack,
  elementalSpecialDamage,
  freezeActivationChance,
  resolveSpecial,
  retriesOnMiss,
  SACRIFICE_HIT_MULT,
  SPECIAL,
  SPECIAL_HIT_MULT,
  specialReduction,
  thunderShockChance,
  weaponSpecialByte,
  type SpecialAttacker,
  type SpecialDefender,
} from '../client/src/combat/specials.ts';
import { STATUS } from '../client/src/combat/status.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNewservJson } from './lib/newservjson.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string) => check(Math.abs(a - b) < 1e-4, `${what}: ${a} != ${b}`);

// 1. Permission and the special byte.
eq(canUseSpecialAttack([0, 1, 0, 0, 0]), false, 'no special: no special attack');
eq(canUseSpecialAttack([0, 1, 0, 0, 0x05]), true, 'a special');
eq(canUseSpecialAttack([0, 1, 0, 0, 0x85]), true, 'an unidentified special still starts the attack');
eq(canUseSpecialAttack(null), false, 'bare hands');
eq(weaponSpecialByte([0, 1, 0, 0, 0x85]), { index: 5, untekked: true, byte: 0x85 }, 'special byte');

// 2. Reduction and the retry rule.
eq([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(specialReduction).map((v) => Math.round(v * 100) / 100), [1, 0.5, 0.5, 0.5, 0.33, 1, 1, 0.33, 0.33, 1], 'reduction by kind');
eq([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(retriesOnMiss), [true, true, true, true, false, false, false, true, true, false, false, true, true, false], 'retry on miss');

const attacker = (o: Partial<SpecialAttacker> = {}): SpecialAttacker => ({
  type: 0, power: 0, weaponKind: 1, level: 49, hp: 400, tp: 200, maxTp: 300, meseta: 1000, android: false, ...o,
});
const defender = (o: Partial<SpecialDefender> = {}): SpecialDefender => ({
  hp: 500, maxHp: 600, esp: 10, efr: 20, eth: 40, edk: 30, exp: 50, canTake: () => true, ...o,
});
const rolls = (...v: number[]) => {
  let i = 0;
  return () => v[i++] ?? 0.99;
};
const ctx = (r: () => number, o: { difficulty?: number; bossMap?: boolean } = {}) => ({ difficulty: o.difficulty ?? 0, episode: 1, bossMap: o.bossMap ?? false, rng: r });

// 3. HP / TP steal.
{
  const o = resolveSpecial(attacker({ type: SPECIAL.hpSteal, power: 9 }), defender(), ctx(rolls(0.5)));
  // min(9 * 500 * 0.01, 1 * 30) = 30.
  eq([o.hpDamage, o.heal, o.strikeMult === SPECIAL_HIT_MULT], [30, { what: 'hp', amount: 30 }, true], 'Fill on Normal: capped at 30');
  const h = resolveSpecial(attacker({ type: SPECIAL.hpSteal, power: 5, weaponKind: 2 }), defender({ hp: 300 }), ctx(rolls(0.5), { difficulty: 3 }));
  // min(15, 120) * 0.5 = 7.5 -> 7.
  eq(h.heal, { what: 'hp', amount: 7 }, 'Draw sword in Ultimate: 7');
  const t = resolveSpecial(attacker({ type: SPECIAL.tpSteal, power: 9 }), defender(), ctx(rolls(0.5), { difficulty: 1 }));
  // min(9 * 300 * 0.01, 2 * 25) = 27.
  eq(t.heal, { what: 'tp', amount: 27 }, 'Soul: 27 TP');
  const a = resolveSpecial(attacker({ type: SPECIAL.tpSteal, power: 9, android: true }), defender(), ctx(rolls(0.5)));
  eq([a.heal, a.strikeMult], [null, null], 'an android steals no TP');
}

// 4. Costs.
{
  eq(resolveSpecial(attacker({ type: SPECIAL.charge, meseta: 150 }), defender(), ctx(rolls(0.5))).miss, true, 'Charge needs 200 meseta');
  const c = resolveSpecial(attacker({ type: SPECIAL.charge }), defender(), ctx(rolls(0.5)));
  eq([c.cost, c.strikeMult], [{ what: 'meseta', amount: 200 }, SACRIFICE_HIT_MULT], 'Charge');
  eq(resolveSpecial(attacker({ type: SPECIAL.spirit, tp: 9 }), defender(), ctx(rolls(0.5))).miss, true, 'Spirit needs 10 TP');
  eq(resolveSpecial(attacker({ type: SPECIAL.spirit, tp: 123 }), defender(), ctx(rolls(0.5))).cost, { what: 'tp', amount: 24 }, 'Spirit: 20% of TP');
  eq(resolveSpecial(attacker({ type: SPECIAL.berserk, hp: 1 }), defender(), ctx(rolls(0.5))).miss, true, 'Berserk needs HP > 1');
  eq(resolveSpecial(attacker({ type: SPECIAL.berserk, hp: 403 }), defender(), ctx(rolls(0.5))).cost, { what: 'hp', amount: 100 }, 'Berserk: 25% of HP');
}

// 5. Status specials.
{
  // Freeze power 30 vs ESP 10: c = 0.2; the second roll decides.
  near(freezeActivationChance(0.2, false), 0.2, 'freeze chance');
  near(freezeActivationChance(0.6, false), 0.4, 'freeze chance capped at 0.4');
  near(freezeActivationChance(0.3, true), 0.2, 'Ultimate: 0.2');
  const f = resolveSpecial(attacker({ type: SPECIAL.freeze, power: 30 }), defender(), ctx(rolls(0.9, 0.1)));
  eq([f.status, f.strikeMult], [STATUS.freeze, SPECIAL_HIT_MULT], 'freeze lands');
  eq(resolveSpecial(attacker({ type: SPECIAL.freeze, power: 30 }), defender(), ctx(rolls(0.1, 0.25))).miss, true, 'freeze fails: MISS');
  const p = resolveSpecial(attacker({ type: SPECIAL.paralysis, power: 30 }), defender(), ctx(rolls(0.19)));
  eq(p.status, STATUS.paralysis, 'paralysis on the first roll below 0.2');
  eq(resolveSpecial(attacker({ type: SPECIAL.paralysis, power: 30 }), defender(), ctx(rolls(0.21))).miss, true, 'paralysis fails');
  eq(resolveSpecial(attacker({ type: SPECIAL.paralysis, power: 30, weaponKind: 9 }), defender(), ctx(rolls(0.1))).miss, true, 'shot: 0.33 of the chance');
  const c = resolveSpecial(attacker({ type: SPECIAL.confusion, power: 30 }), defender(), ctx(rolls(0.5)));
  eq([c.status, c.strikeMult, c.miss], [null, SPECIAL_HIT_MULT, false], 'confusion fails but the strike lands');
  eq(resolveSpecial(attacker({ type: SPECIAL.paralysis, power: 5 }), defender(), ctx(rolls(0))).miss, true, 'power below ESP: never');
}

// 6. Fire / thunder.
{
  // Level 50 (49 0-based), power 3, EFR 20: (80 * 0.002) * (49 / 2 + 80) * 5.
  near(elementalSpecialDamage(49, 3, 20), 0.16 * 104.5 * 5, 'Burning damage');
  const f = resolveSpecial(attacker({ type: SPECIAL.fire, power: 3 }), defender(), ctx(rolls(0.5)));
  eq([f.hpDamage, f.strikeMult, f.bigHit], [Math.trunc(0.16 * 104.5 * 5), null, false], 'fire: no strike');
  const t = resolveSpecial(attacker({ type: SPECIAL.thunder, power: 3 }), defender({ maxHp: 100 }), ctx(rolls(0.5, 0.05)));
  eq([t.status, t.bigHit], [STATUS.shock, true], 'thunder rolls the shock (1/15)');
  near(thunderShockChance(true), 0.025, 'Ultimate shock chance');
  const a = resolveSpecial(attacker({ type: SPECIAL.fire, power: 3, android: true }), defender(), ctx(rolls(0.5), { difficulty: 3 }));
  eq(a.hpDamage, f.hpDamage, 'no android +30 on fire');
}

// 7. Instant kill and HP divide.
{
  // Power 60 vs EDK 30: c = 0.3.
  eq(resolveSpecial(attacker({ type: SPECIAL.instantKill, power: 60 }), defender(), ctx(rolls(0.29))).kill, true, 'instant kill below 0.3');
  eq(resolveSpecial(attacker({ type: SPECIAL.instantKill, power: 60 }), defender(), ctx(rolls(0.31))).miss, true, 'instant kill fails');
  eq(resolveSpecial(attacker({ type: SPECIAL.instantKill, power: 60 }), defender(), ctx(rolls(0), { bossMap: true })).miss, true, 'no instant kill on a boss map');
  eq(resolveSpecial(attacker({ type: SPECIAL.instantKill, power: 40, android: true }), defender(), ctx(rolls(0.25), { difficulty: 3 })).miss, true, 'no android bonus on instant kill');
  eq(resolveSpecial(attacker({ type: SPECIAL.paralysis, power: 5, android: true }), defender(), ctx(rolls(0.2), { difficulty: 3 })).status, STATUS.paralysis, 'android +30 power in Ultimate');
  const d = resolveSpecial(attacker({ type: SPECIAL.hpDivide, power: 50 }), defender({ hp: 401 }), ctx(rolls(0.49)));
  eq(d.hpDamage, 200, "Devil's: half of the HP");
  eq(resolveSpecial(attacker({ type: SPECIAL.hpDivide, power: 50 }), defender(), ctx(rolls(0.5))).miss, true, 'HP divide fails at 0.5');
}

// 8. EXP steal: the strike, then 6xC6 unless on a boss map.
{
  const e = resolveSpecial(attacker({ type: SPECIAL.expSteal, power: 8 }), defender(), ctx(rolls(0.5)));
  eq([e.strikeMult, e.expSteal], [SPECIAL_HIT_MULT, true], 'EXP steal');
  eq(resolveSpecial(attacker({ type: SPECIAL.expSteal, power: 8 }), defender(), ctx(rolls(0.5), { bossMap: true })).expSteal, false, 'no EXP steal on a boss map');
}

// 9. The special table the server streams (newserv's ItemPMT JSON): its
// {type, amount} rows are what resolveSpecial gets as type / power.
{
  const ref = parseNewservJson(readFileSync(join(import.meta.dirname, '../vendor/newserv/system/tables/item-parameter-table-bb-v4.json'), 'utf8')) as {
    Specials: Array<{ Type: number; Amount: number }>;
  };
  const t = ref.Specials.map((r) => r.Type);
  eq(t, [0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 5, 6, 7, 7, 7, 7, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 13, 13], 'special table types');
  // Burning (0x1a, fire power 4) at level 100 on EFR 0: (100 * 0.002) * (99 + 100) * 5.
  const burning = ref.Specials[0x1a];
  near(elementalSpecialDamage(99, burning.Amount, 0), 0.2 * 199 * 5, 'Burning at level 100');
  // Hell (0x22, 93) vs EDK 30: 63%.
  const hell = ref.Specials[0x22];
  eq(resolveSpecial(attacker({ type: hell.Type, power: hell.Amount }), defender(), ctx(rolls(0.62))).kill, true, 'Hell 63%');
  // Demon's (0x28, 25): three quarters of the HP.
  const demons = ref.Specials[0x28];
  eq(resolveSpecial(attacker({ type: demons.Type, power: demons.Amount }), defender({ hp: 400 }), ctx(rolls(0.1))).hpDamage, 300, "Demon's: 3/4 of the HP");
}

if (failures) {
  console.log(`specials: ${failures} failure(s)`);
  process.exit(1);
}
console.log('specials: all checks passed');
