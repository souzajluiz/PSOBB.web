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
  flamePoint,
  restaFloat,
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
import { criticalFlashFrames, Dissolve, IceBlock, iceRadius, lerpFloatTo } from '../client/src/combat/hitmodels.ts';
import { DeathRun, deathPlanFor } from '../client/src/combat/deathfx.ts';
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

// 7. The floating number: white, 0x14 frames, shown from 0; "MISS" in red.
eq(FLOAT_FRAMES, 0x14, 'the text lives 0x14 frames');
eq(damageFloat(123.4), { text: '123', rgb: 0xffffff }, 'a number is white');
eq(damageFloat(0), { text: '0', rgb: 0xffffff }, 'zero damage shows 0');
eq(damageFloat(0.4), { text: '0', rgb: 0xffffff }, 'rounded');
eq(damageFloat(-3), null, 'a negative short shows nothing');
eq(damageFloat(40000), null, 'the damage is a short: 40000 wraps negative');
eq(missFloat(), { text: 'MISS', rgb: 0xff0000 }, 'MISS is red');

// The Resta text over another player: green "HP+n".
eq(restaFloat(25), { text: 'HP+25', rgb: 0x00ff00 }, 'Resta text');

// Flame: the spiral point after k updates (radius 40 - 4k around a centre 5 ahead).
{
  const c = { x: 0, y: 7, z: 0 };
  const p0 = flamePoint(c, 0, 0, 0);
  check(Math.abs(Math.hypot(p0.x, p0.z - 5) - 40) < 1e-6 && p0.y === 7, 'flame starts at radius 40 around the centre 5 ahead');
  const p10 = flamePoint(c, 0, 1, 10);
  check(Math.abs(p10.x) < 1e-6 && Math.abs(p10.z + 5) < 1e-6, 'the second flame ends on its centre, 5 behind');
}

// The critical flash: alpha 1 -> 0 by 0.15, scale towards 2, texture entries 2..7.
{
  const fr = criticalFlashFrames();
  eq(fr.length, 7, 'flash frames (made state + 6 visible updates)');
  eq(fr.map((f) => f.texture), [1, 2, 3, 4, 5, 6, 7], 'flash texture entries');
  check(Math.abs(fr[1].alpha - 0.85) < 1e-6 && Math.abs(fr[6].alpha - 0.1) < 1e-6, 'flash alpha steps');
  check(Math.abs(fr[1].scale - 1.2) < 1e-6, 'flash scale lerps 20% towards 2');
  eq(lerpFloatTo(0.1, 0, 0.15).value, 0, 'the lerp snaps to the target');
  eq(lerpFloatTo(0, 0, 0.15).done, true, 'at the target it is done');
}

// The dissolve: 10 frames unchanged, alpha out over 5, done after 20.
{
  const d = new Dissolve();
  const o: number[] = [];
  let done = 0;
  for (let i = 1; i <= 25 && !done; i++) {
    const r = d.tick();
    o.push(r.opacity);
    if (r.done) done = i;
  }
  check(o.slice(0, 10).every((x) => x > 0.999), 'the dissolve keeps the look for 10 frames');
  check(o[11] < 1 && o[14] === 0, 'then fades out in 5');
  check(done >= 20 && done <= 21, `the dissolve ends after 20 frames (${done})`);
}

// The ice block: grows 0.1 a frame, ring every third frame, shatters at the thaw.
{
  const b = new IceBlock(iceRadius(10));
  eq(iceRadius(null), 1.5, 'no hit box: 1.5');
  let rings = 0;
  let frames = 0;
  while (b.state === 0 && frames < 100) {
    if (b.tick(true).ring) rings++;
    frames++;
  }
  check(b.state === 1 && frames === 15 && rings === 5, `ice grows to 1.5 in ${frames} frames with ${rings} rings`);
  const t = b.tick(false);
  check(t.shatter && t.state === 2, 'the thaw shatters');
  let n = 0;
  while (!b.tick(false).done && n < 10) n++;
  check(n === 3, `the ice ends 3 frames after the shatter (${n})`);
}

// Death plans: per enemy.
{
  const ctx = { area: 0x08, episode: 1 };
  check(deathPlanFor('TObjEneBoom', 'BOOMA', ctx) === null, 'an enemy without a traced death has no plan');
  const claw = deathPlanFor('TObjEneBalClawClaw', 'CLAW', ctx)!;
  const r = new DeathRun(claw).tick(0, false);
  eq(r.se, [0x202], 'the Claw dies with SE 0x202');
  check(r.dissolve && r.spawn.map((s) => s.p.id).join() === '232,236', 'the Claw dissolves with the dark burst');
  eq(deathPlanFor('TObjEneRe7Berura', 'DARK_BELRA', { area: 0x13, episode: 2 })!.steps[0].se, 0x1c5, 'Dark Belra in a temple');
  const sb = new DeathRun(deathPlanFor('TObjEneMe3ShinowaReal', 'SINOW_BEAT', ctx)!);
  const se: number[] = [];
  for (let f = 0; f < 80; f++) {
    const a = sb.tick(f * 0.5, f >= 40);
    se.push(...a.se);
    if (a.remove) {
      check(f >= 60, 'Sinow explodes 20 frames after its motion');
      break;
    }
  }
  eq(se, [0x137, 0x137, 0x13b], 'Sinow Beat sounds');
  const gigue = deathPlanFor('TObjEneMe1GiGue', 'GI_GUE', ctx)!;
  check(!!gigue.instant && new DeathRun(gigue).tick(0, false).remove, 'Gi Gue dies at once');
}

if (failures) {
  console.log(`hitfx: ${failures} failure(s)`);
  process.exit(1);
}
console.log('hitfx: all checks passed');
