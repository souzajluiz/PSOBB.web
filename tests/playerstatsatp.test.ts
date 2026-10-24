// Player ATP as the exe keeps it (client/src/combat/playerstats.ts): the saved ATP is the base
// (the stat block, +0x2cc), the displayed ATP is base + variance + battleparams rmin = base + rmax,
// the attack range is [base + rmin, base + rmax], and the equip compare's ATP candidate is
// PlayerRecalculateStats' output (DEVLOG 2026-10-23, the stat block).
//
// Run: node tests/playerstats.test.ts
import { classAttackRange, candidateAtp, splitAttack, weaponAttackRange } from '../client/src/combat/playerstats.ts';
import { playerAttacker } from '../client/src/combat/formulas.ts';

let failures = 0;
let checks = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// Class range: HUmar (class 0) is 5..10, HUcaseal (class 9) is 5..10 (the class AttackData table).
eq(classAttackRange(0), { min: 5, max: 10 }, 'HUmar class range');
eq(classAttackRange(9), { min: 5, max: 10 }, 'HUcaseal class range');
eq(classAttackRange(99), classAttackRange(0), 'unknown class falls back to class 0');

// The item range adds 2 x grind to both ends (ASSUMED, see the header).
eq(weaponAttackRange({ atpMin: 40, atpMax: 55, grind: 10 }), { min: 60, max: 75 }, 'weapon range with grind');
eq(weaponAttackRange(null), { min: 0, max: 0 }, 'no weapon: no range');

// The attacker split from the saved ATP: base = saved, variance = rmax - rmin, rmin = class min + weapon min.
eq(splitAttack(500, 0, { atpMin: 40, atpMax: 55, grind: 10 }), { base: 500, variance: 20, rmin: 65 }, 'HUmar +10 Saber split');
eq(splitAttack(100, 9, null), { base: 100, variance: 5, rmin: 5 }, 'HUcaseal bare hands split');

// The displayed ATP (the compare / character window) is saved + rmax: base + variance + rmin.
for (const [saved, cls, w] of [
  [500, 0, { atpMin: 40, atpMax: 55, grind: 10 }],
  [100, 9, null],
  [321, 4, { atpMin: 10, atpMax: 20, grind: 0 }],
] as const) {
  const s = splitAttack(saved, cls, w);
  const rmax = classAttackRange(cls).max + weaponAttackRange(w).max;
  eq(s.base + s.variance + s.rmin, saved + rmax, `displayed = saved + rmax for ${saved}`);
  eq(s.base + s.rmin, saved + classAttackRange(cls).min + weaponAttackRange(w).min, `range min for ${saved}`);
}

// The combat attacker takes the split: +0x2cc base (the saved ATP), +0x2ce variance, +0x31c equipment ATP.
const a = playerAttacker(0, { atp: 500, ata: 150, lck: 30 }, { atpMin: 40, atpMax: 55, grind: 10, ata: 30 });
eq([a.atp, a.atpSpread, a.equipAtp], [500, 20, 65], 'attacker split from the saved ATP');

// The compare candidate (m = 0): the displayed ATP with the weapon's range max swapped.
eq(candidateAtp(40, null, null), 40, 'no candidate weapon: the displayed ATP');
eq(candidateAtp(40, { atpMin: 10, atpMax: 20, grind: 2 }, null), 64, 'empty slot: 40 + max 24');
eq(candidateAtp(40, { atpMin: 10, atpMax: 20, grind: 2 }, { atpMin: 10, atpMax: 20, grind: 0 }), 44, 'swap to grind 2: 40 + 24 - 20');
eq(candidateAtp(40, { atpMin: 10, atpMax: 20, grind: 0 }, { atpMin: 10, atpMax: 20, grind: 0 }), 40, 'same weapon: unchanged');

// PlayerRecalculateStats' formula with m: round(base*m + rmin + base) + round((rmax - rmin)(1 + m)).
// HUmar, no old weapon, candidate min 10 / max 20 grind 0: base = 40 - 10 = 30, rmin = 15, rmax = 30.
eq(candidateAtp(40, { atpMin: 10, atpMax: 20, grind: 0 }, null, 0.5), Math.round(30 * 0.5 + 15 + 30) + Math.round((30 - 15) * 1.5), 'buffed candidate (m = 0.5)');

console.log(`playerstats: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
