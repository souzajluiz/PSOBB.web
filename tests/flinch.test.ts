// The took_damage flag (0x200) of a melee or weapon hit, EntityHitEntity_00773350
// (entry 0x007732ba). The threshold is the summed hitbox damage against g_Float1
// = 1.0 (0x009782b0, compare at 0x00773893 / jae 0x007738c1, set at 0x007738c4).
// A total below 1.0 is cleared to 0 and gets 0x100 only, so a 0-damage hit does
// not set 0x200 and the enemy's +0x88 check (0x00777ba4, flags & 0x200) stays
// clear: no flinch hook (EnemyUpdateLoop_0052167c, 0x0052167c).
// Run: node tests/flinch.test.ts
import { applyDamage, FLAG_BIG_HIT, FLAG_DEAD, FLAG_HIT, FLAG_MISSED, TOOK_DAMAGE_ANY, TOOK_DAMAGE_MIN, TOOK_DAMAGE_NEVER, tookDamage } from '../client/src/combat/formulas.ts';
import { TECH, techTookDamageMin } from '../client/src/combat/techniques.ts';

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

// entity_hit_by_tech (0x00773afc) on an enemy: the technique groups' 0x200 rule.
// A damage group sets 0x200 on any landed hit, 0 damage included: the fixed group
// (0x00774d95, the rounded total goes to deal_damage and the flag is OR'd after the
// HP check, dead or not), Foie (0x00774c61), Barta (0x0077407b), Gibarta / Rabarta
// (0x00774a42), Zonde (0x00774844), Grants (0x007746fa). The 0x200 writes are the
// only ones in 0x00773afc..0x00775600; no path skips them except the early returns
// (invulnerable, resisted, dead attacker).
{
  const d = { hp: 100, maxHp: 100, evp: 0, dfp: 0 };
  const fire = TECH.foie;
  check(techTookDamageMin(TECH.foie) === TOOK_DAMAGE_ANY, 'Foie (group 1) sets 0x200 on any landed hit');
  check(techTookDamageMin(TECH.gifoie) === TOOK_DAMAGE_ANY && techTookDamageMin(TECH.rafoie) === TOOK_DAMAGE_ANY, 'Gifoie and Rafoie are the Foie group');
  check(techTookDamageMin(TECH.barta) === TOOK_DAMAGE_ANY, 'Barta (group 19, 0x0077407b) sets 0x200 on any landed hit');
  check(techTookDamageMin(TECH.gibarta) === TOOK_DAMAGE_ANY && techTookDamageMin(TECH.rabarta) === TOOK_DAMAGE_ANY, 'Gibarta / Rabarta (group 2) do too');
  check(techTookDamageMin(TECH.zonde) === TOOK_DAMAGE_ANY && techTookDamageMin(TECH.gizonde) === TOOK_DAMAGE_ANY && techTookDamageMin(TECH.razonde) === TOOK_DAMAGE_ANY, 'Zonde (group 3) does too');
  check(techTookDamageMin(TECH.grants) === TOOK_DAMAGE_ANY, 'Grants (group 4) does too');
  check(techTookDamageMin(TECH.megid) === TOOK_DAMAGE_NEVER, 'Megid is not a damage group here (its kill is the caller roll)');
  for (const t of [TECH.resta, TECH.anti, TECH.reverser, TECH.shifta, TECH.deband, TECH.jellen, TECH.zalure, TECH.ryuker]) {
    check(techTookDamageMin(t) === TOOK_DAMAGE_NEVER, `support tech ${t} never sets 0x200 from entity_hit_by_tech`);
  }
  // A 0-damage landed Foie: 0x200, no HP lost (the exe deals 0 and still OR's the flag).
  check(tookDamage(0, true, techTookDamageMin(fire)) === true, 'a 0-damage landed Foie sets 0x200');
  check(applyDamage(d, 0, true, techTookDamageMin(fire)) === FLAG_HIT && d.hp === 100, 'a 0-damage landed Foie: 0x200 and no HP');
  // A 0.5 total from a damage group still sets 0x200 (no 1.0 threshold), and rounds to 1 HP as the exe's ROUND does.
  check(applyDamage(d, 0.5, true, techTookDamageMin(fire)) === FLAG_HIT && d.hp === 99, 'a 0.5 Foie total sets 0x200 (the melee threshold does not apply)');
  // A resisted or missed roll never sets it, whatever the threshold.
  check(tookDamage(30, false, techTookDamageMin(fire)) === false, 'a resisted Foie (no roll) never sets 0x200');
  check(applyDamage(d, 30, false, TOOK_DAMAGE_ANY) === FLAG_MISSED && d.hp === 99, 'a missed roll is 0x100 with no HP lost');
  // Support groups: 0x200 never, even for a big total; no HP change.
  check(applyDamage(d, 30, true, techTookDamageMin(TECH.jellen)) === FLAG_MISSED && d.hp === 99, 'a Jellen total is 0x100 and no HP (the exe deals none)');
  d.hp = 100;
  // Megid: the kill (landed, HP as total) sets 0x200 with the dead flag; a non-kill is 0x100.
  check(applyDamage(d, 100, true) === (FLAG_HIT | FLAG_BIG_HIT | FLAG_DEAD) && d.hp === 0, 'a Megid kill: 0x200, the big-hit flag and 0x800');
  d.hp = 100;
  check(applyDamage(d, 0, false) === FLAG_MISSED && d.hp === 100, 'a Megid non-kill is 0x100 and no HP');
}

if (failures) {
  console.log(`flinch: ${failures} failures`);
  process.exit(1);
}
console.log('flinch: all checks passed');
