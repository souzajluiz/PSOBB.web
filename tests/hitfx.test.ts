// What an enemy shows and sounds when it is hit (combat/hitfx.ts): the hit
// spark and the critical spark, the kind particle (exact compare, so a
// mini-boss has none), the technique and special families, the status
// particles / sounds and their 45-frame repeat (combat/enemystatus.ts), the
// death particles and the floating number rules.
// Run: node tests/hitfx.test.ts
import {
  CRITICAL_SE,
  CRITICAL_SPARK,
  damageFloat,
  deathParticles,
  FLOAT_FRAMES,
  hitParticles,
  HIT_SPARK,
  kindParticle,
  missFloat,
  specialHandlerParticles,
  specialHitFx,
  statusApplyFx,
  statusTickFx,
  techHitFx,
} from '../client/src/combat/hitfx.ts';
import { ENEMY_ATTR, ENEMY_CONFUSION_FRAMES, ENEMY_PARALYSIS_FRAMES, ENEMY_SHOCK_FRAMES, ENEMY_FREEZE_FRAMES, EnemyStatus } from '../client/src/combat/enemystatus.ts';
import { STATUS } from '../client/src/combat/status.ts';
import { TECH } from '../client/src/combat/techniques.ts';
import { SPECIAL } from '../client/src/combat/specials.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const ids = (l: { id: number }[]) => l.map((p) => p.id);

// 1. The spark: particles 4, 5, 6 (raised -15) and 0xd; critical 7, 0xb, 0xc (raised -20), 0xe.
eq(ids([...HIT_SPARK]), [4, 5, 6, 0xd], 'hit spark particles');
eq(HIT_SPARK.find((p) => p.id === 6)?.dy, -15, 'hit_c is raised by -15');
eq(ids([...CRITICAL_SPARK]), [7, 0xb, 0xc, 0xe], 'critical spark particles');
eq(CRITICAL_SPARK.find((p) => p.id === 0xc)?.dy, -20, 'critical_c is raised by -20');
eq(CRITICAL_SE, 0x42, 'critical sound');

// 2. The kind particle is an exact compare of the enemy attribute.
eq(kindParticle(1)?.id, 0xf1, 'native');
eq(kindParticle(2)?.id, 0xf2, 'A.beast');
eq(kindParticle(4)?.id, 0xe3, 'machine');
eq(kindParticle(8)?.id, 0x10d, 'dark');
eq(kindParticle(ENEMY_ATTR.native | ENEMY_ATTR.miniboss), null, 'a mini-boss has no kind particle');
eq(kindParticle(0), null, 'no kind');
eq(ids(hitParticles('weapon', false, 1)), [4, 5, 6, 0xd, 0xf1], 'a normal strike on a native enemy');
eq(ids(hitParticles('weapon', true, 4)), [7, 0xb, 0xc, 0xe, 0xe3], 'a critical strike on a machine');
eq(ids(hitParticles('weapon', false, 0x11)), [4, 5, 6, 0xd], 'a normal strike on a native mini-boss');

// 3. Techniques and specials.
eq(techHitFx(TECH.foie), 'foie', 'Foie');
eq(techHitFx(TECH.rabarta), 'foie', 'Rabarta');
eq(techHitFx(TECH.grants), 'foie', 'Grants');
eq(techHitFx(TECH.zonde), 'zonde', 'Zonde');
eq(techHitFx(TECH.razonde), 'zonde', 'Razonde');
eq(techHitFx(TECH.megid), 'spark', 'Megid');
eq(techHitFx(TECH.resta), 'none', 'Resta');
eq(ids(hitParticles('zonde', false, 2)), [0xb9, 0xba, 0xf2], 'the Zonde family on an A.beast');
eq(ids(hitParticles('spark', false, 8)), [4, 5, 6, 0xd], 'Megid: the spark alone');
eq(ids(hitParticles('none', true, 8)), [], 'a support technique');
eq(specialHitFx(SPECIAL.fire), 'foie', 'the fire special');
eq(specialHitFx(SPECIAL.thunder), 'zonde', 'the thunder special');
eq(specialHitFx(SPECIAL.hpSteal), 'spark', 'the HP steal special');
eq(specialHitFx(SPECIAL.confusion), 'none', 'the confusion special');

// 4. weapon_special_handlers' particles by the special byte.
eq(ids(specialHandlerParticles(1)), [0x10a], 'Draw');
eq(specialHandlerParticles(1)[0].at, 'player', 'Draw is made at the attacker');
eq(specialHandlerParticles(5)[0].scale, [0.2, 0.3], 'Heart is scaled');
eq(ids(specialHandlerParticles(9)), [0xa8], "Master's");
eq(ids(specialHandlerParticles(12)), [0x66], 'Charge');
eq(ids(specialHandlerParticles(14)), [0x67], 'Berserk');
eq(specialHandlerParticles(17), [{ id: 0x9a, delay: 0, duration: 0xf }], 'Freeze');
eq(specialHandlerParticles(23), [{ id: 0x18, delay: 0, duration: 5 }], 'Heat');
eq(ids(specialHandlerParticles(31)), [200, 0x101], 'Dim');
eq(specialHandlerParticles(34).every((p) => p.scale?.[0] === 2), true, 'Hell doubles its particles');
eq(ids(specialHandlerParticles(39)), [0x1ac], "Devil's");
eq(specialHandlerParticles(15), [], 'Ice has no hit particle');
eq(specialHandlerParticles(27), [], 'Shock has no particle (its bolt is an object)');
eq(specialHandlerParticles(0), [], 'no special');

// 5. Status application and the 45-frame repeat.
eq(statusApplyFx('paralysis'), { particle: { id: 0x26 }, se: null }, 'paralysis lands');
eq(statusApplyFx('confusion'), { particle: { id: 0x24 }, se: null }, 'confusion lands');
eq(statusApplyFx('shock'), { particle: { id: 0x21 }, se: 0x11 }, 'shock lands');
eq(statusApplyFx('freeze'), { particle: { id: 0x12e }, se: 0x10 }, 'freeze lands');
eq(statusTickFx('paralysis'), { particle: { id: 0x26 }, se: 0xd }, 'paralysis repeats');
eq(statusTickFx('confusion'), { particle: { id: 0x24 }, se: 0xf }, 'confusion repeats');
eq(statusTickFx('shock'), { particle: { id: 0x21 }, se: 0x11 }, 'shock repeats');
eq(statusTickFx('freeze'), { particle: null, se: 0x10 }, 'freeze repeats its sound only');

const pulsesOf = (type: typeof STATUS.paralysis | typeof STATUS.confusion | typeof STATUS.shock | typeof STATUS.freeze, frames: number, attribute: number): number => {
  const s = new EnemyStatus(attribute);
  check(s.inflict(type), 'inflict');
  let n = 0;
  for (let i = 0; i < frames + 5; i++) if (s.tick().pulses.includes(type)) n++;
  return n;
};
eq(pulsesOf(STATUS.paralysis, ENEMY_PARALYSIS_FRAMES, ENEMY_ATTR.native), Math.floor((ENEMY_PARALYSIS_FRAMES - 1) / 45), 'paralysis pulses');
eq(pulsesOf(STATUS.confusion, ENEMY_CONFUSION_FRAMES, ENEMY_ATTR.native), Math.floor((ENEMY_CONFUSION_FRAMES - 1) / 45), 'confusion pulses');
eq(pulsesOf(STATUS.shock, ENEMY_SHOCK_FRAMES, ENEMY_ATTR.machine), Math.floor((ENEMY_SHOCK_FRAMES - 1) / 45), 'shock pulses');
eq(pulsesOf(STATUS.freeze, ENEMY_FREEZE_FRAMES, ENEMY_ATTR.native), Math.floor((ENEMY_FREEZE_FRAMES - 1) / 45), 'freeze pulses');
{
  // The first pulse comes 45 frames before the end, and `pulse` is the first of `pulses`.
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.inflict(STATUS.confusion);
  let first = -1;
  for (let i = 1; i <= ENEMY_CONFUSION_FRAMES && first < 0; i++) {
    const t = s.tick();
    if (t.pulse !== null) {
      first = i;
      eq(t.pulses, [STATUS.confusion], 'confusion pulse list');
    }
  }
  eq(first, 30, 'confusion first pulse when 270 frames are left (a multiple of 45)');
  const c = new EnemyStatus(ENEMY_ATTR.native);
  c.inflict(STATUS.confusion);
  eq(c.tick().locked, false, 'a confused enemy is not locked by the pulse');
}

// 6. Death particles by kind.
eq(ids(deathParticles(1)), [0xe4], 'native death');
eq(ids(deathParticles(2)), [0xe5], 'A.beast death');
eq(ids(deathParticles(4)), [0xfb, 0xfc, 0xe3], 'machine death');
eq(deathParticles(8).map((p) => [p.id, p.delay, p.duration]), [[0xe8, 10, 1], [0xec, 10, 1]], 'dark death is delayed 10 frames');
eq(ids(deathParticles(0x11)), [0xe4], 'a native mini-boss keeps the native death (kind & 0xf)');
eq(deathParticles(0), [], 'no kind, no death particles');

// 7. The floating number: white, 0x14 frames, shown from 0; "MISS" in red.
eq(FLOAT_FRAMES, 0x14, 'the text lives 0x14 frames');
eq(damageFloat(123.4), { text: '123', rgb: 0xffffff }, 'a number is white');
eq(damageFloat(0), { text: '0', rgb: 0xffffff }, 'zero damage shows 0');
eq(damageFloat(0.4), { text: '0', rgb: 0xffffff }, 'rounded');
eq(damageFloat(-3), null, 'a negative short shows nothing');
eq(damageFloat(40000), null, 'the damage is a short: 40000 wraps negative');
eq(missFloat(), { text: 'MISS', rgb: 0xff0000 }, 'MISS is red');

if (failures) {
  console.log(`hitfx: ${failures} failure(s)`);
  process.exit(1);
}
console.log('hitfx: all checks passed');
