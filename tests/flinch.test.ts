// The took_damage flag (0x200) of a melee or weapon hit, EntityHitEntity_00773350
// (entry 0x007732ba). The threshold is the summed hitbox damage against g_Float1
// = 1.0 (0x009782b0, compare at 0x00773893 / jae 0x007738c1, set at 0x007738c4).
// A total below 1.0 is cleared to 0 and gets 0x100 only, so a 0-damage hit does
// not set 0x200 and the enemy's +0x88 check (0x00777ba4, flags & 0x200) stays
// clear: no flinch hook (EnemyUpdateLoop_0052167c, 0x0052167c).
// Run: node tests/flinch.test.ts
import { applyDamage, FLAG_BIG_HIT, FLAG_DEAD, FLAG_HIT, FLAG_MISSED, TOOK_DAMAGE_MIN, tookDamage } from '../client/src/combat/formulas.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

// The exe constant: 1.0f at 0x009782b0 (raw bytes 0x3f800000, checked against PsoBB.exe).
check(TOOK_DAMAGE_MIN === 1, 'the threshold is 1.0 (g_Float1)');

// Totals around the threshold, landed roll.
check(tookDamage(0) === false, 'a 0-damage landed hit does not take damage');
check(tookDamage(0.5) === false, 'a 0.5 total is below the threshold');
check(tookDamage(0.9999) === false, 'just under 1.0 is not a hit');
check(tookDamage(1) === true, '1.0 is the first total that sets 0x200');
check(tookDamage(1.5) === true, 'a 1.5 total sets 0x200');
check(tookDamage(5, false) === false, 'a missed roll never sets 0x200, whatever the total');

// applyDamage returns the flags the exe writes on the defender (+0x30).
{
  const d = { hp: 100, maxHp: 100, evp: 0, dfp: 0 };
  check(applyDamage(d, 0) === FLAG_MISSED && d.hp === 100, '0 damage: 0x100, no HP lost');
  check(applyDamage(d, 0.7) === FLAG_MISSED && d.hp === 100, 'a 0.7 total: 0x100, no HP lost (ROUND would have taken 1)');
  check(applyDamage(d, 1) === FLAG_HIT && d.hp === 99, 'a 1.0 total: 0x200 and one HP');
  check(applyDamage(d, 1.4) === FLAG_HIT && d.hp === 98, 'a 1.4 total rounds to 1 HP and keeps 0x200');
  check(applyDamage(d, 30) === (FLAG_HIT | FLAG_BIG_HIT) && d.hp === 68, 'a big hit keeps the big-hit flag');
  check((applyDamage(d, 80) & FLAG_DEAD) !== 0 && d.hp === 0, 'HP below 1 sets the dead flag');
}

if (failures) {
  console.log(`flinch: ${failures} failures`);
  process.exit(1);
}
console.log('flinch: all checks passed');
