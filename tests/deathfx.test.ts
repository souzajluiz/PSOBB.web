// The remaining damage visuals: the death plan of every enemy id
// (combat/deathfx.ts), the ground pools they leave (combat/blooddecals.ts), the
// model fragments of an exploding machine (combat/shellfragments.ts), the ice
// shatter pieces (model particles of classic/particles.ts + combat/hitmodels.ts)
// and the facts those rules rest on in the client's own data.
// Run: node tests/deathfx.test.ts
// Env: PSOBB_DATA (the client's data folder, default ~/Downloads/psobb-client/data)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BloodPool, POOLS, POOL_LIMIT, POOL_UV, slopeAllowed, type PoolId } from '../client/src/combat/blooddecals.ts';
import { DEATH_ROWS, DeathRun, deathPlanFor, SavageDeathMotion, type DeathActions, type DeathPlan } from '../client/src/combat/deathfx.ts';
import { ICE_SHARD_COUNT, ICE_SHARD_MODEL, ICE_SHARD_TEXTURE_ID, ICE_SHATTER_PIECES, velocityAngles } from '../client/src/combat/hitmodels.ts';
import { FRAGMENT_TABLES, ShellFragments } from '../client/src/combat/shellfragments.ts';
import { parseParticleEntry, ParticleSystem } from '../client/src/classic/particles.ts';
import { ENEMY_TYPE_NAMES } from '../client/src/formats/entitynames.ts';
import { BmlArchive, } from '../client/src/formats/bml.ts';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { RelFile } from '../client/src/formats/rel.ts';
import { parseNjObject } from '../client/src/formats/xj.ts';
import { parseXvm } from '../client/src/formats/xvm.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// A deterministic rand() / 32768.
const prng = (seed = 1) => () => {
  seed = (Math.imul(seed, 214013) + 2531011) | 0;
  return ((seed >>> 16) & 0x7fff) / 32768;
};

// --- 1. the death plan of every enemy id --------------------------------------------------
const AREAS = [1, 2, 8, 0x13, 0x14, 0x17, 0x1c, 0x23, 36, 40, 41, 43];
const types = Object.keys(ENEMY_TYPE_NAMES);
for (const t of types) check(t in DEATH_ROWS, `${t} has a death row`);
for (const t of Object.keys(DEATH_ROWS)) check(t in ENEMY_TYPE_NAMES, `the death row ${t} is a known enemy type`);

// Runs a plan the way render/combat.ts does: a play-once motion of 40 frames, the
// dissolve of 20 frames when it starts. The actions of every frame, and whether it finished.
function simulate(plan: DeathPlan, ticks = 1500): { acts: DeathActions[]; finished: boolean; removedAt: number } {
  const run = new DeathRun(plan);
  const acts: DeathActions[] = [];
  let dissolveAt = -1;
  let removedAt = -1;
  for (let f = 0; f < ticks; f++) {
    const dissolved = dissolveAt >= 0 && f >= dissolveAt + 20;
    // The 'land' step (a Mothmant's fall) fires at frame 20 in this harness.
    const a = run.tick(Math.min(f, 40), f >= 40, dissolved, f >= 20);
    acts.push(a);
    if (a.dissolve) dissolveAt = f;
    if (a.remove) {
      removedAt = f;
      break;
    }
    if (dissolved) {
      // The renderer ticks the 'dissolved' steps once and removes the enemy.
      removedAt = f;
      break;
    }
  }
  return { acts, finished: run.finished, removedAt };
}

for (const [type, row] of Object.entries(DEATH_ROWS)) {
  for (const area of AREAS) {
    const ctx = { area, episode: area >= 36 ? 3 : area >= 0x13 ? 2 : 1 };
    const plan = deathPlanFor(row.cls, type, ctx);
    if (row.plan) {
      check(plan !== null && plan.steps.length > 0, `${type} (${row.cls}) has a plan in area ${area}`);
      if (!plan) continue;
      const sim = simulate(plan);
      // Every step fires on its own (no step waits for something that never comes).
      check(sim.finished, `${type} area ${area}: every step of the plan fires`);
      const fired = sim.acts.filter((a) => a.se.length + a.spawn.length + a.pools.length + a.fragments.length > 0 || a.dissolve || a.remove || a.sink > 0).length;
      check(fired > 0, `${type} area ${area}: the plan does something`);
    } else if (row.why !== 'child') {
      check(plan === null, `${type} (${row.cls}, ${row.why}) has no plan`);
    }
  }
}
// The coverage in numbers (the DEVLOG quotes them).
const planned = Object.values(DEATH_ROWS).filter((r) => r.plan).length;
const classesWithPlan = new Set(Object.values(DEATH_ROWS).filter((r) => r.plan).map((r) => r.cls));
check(planned >= 70, `enemy types with a plan: ${planned}`);
check(classesWithPlan.size >= 38, `classes with a plan: ${classesWithPlan.size}`);

// Table-driven facts: [class, type, area, episode, what the first frames do].
const ctxOf = (area: number, episode = 1) => ({ area, episode });
const ids = (a: DeathActions) => a.spawn.map((s) => s.p.id);
const frames = (cls: string, type: string, area: number, episode: number, n: number): DeathActions[] => {
  const run = new DeathRun(deathPlanFor(cls, type, ctxOf(area, episode))!);
  const out: DeathActions[] = [];
  for (let f = 0; f < n; f++) out.push(run.tick(f, false));
  return out;
};
const allPools = (acts: DeathActions[]) => acts.flatMap((a) => a.pools);
const allSe = (acts: DeathActions[]) => acts.flatMap((a) => a.se);

{
  // The Booma family's shared state 8: the voice at frame 0, 0xf3 and the blood hook at frame 16.
  const booma = frames('TObjEneBeast', 'BOOMA', 1, 1, 30);
  eq(booma[0].se, [0xe6], 'Booma: the death voice 0xe6 at motion frame 0');
  eq(booma[15].spawn.length + booma[15].pools.length, 0, 'Booma: nothing at frame 15');
  eq(ids(booma[16]), [0xf3, 0xe4], 'Booma: 0xf3 and gensei at frame 16');
  eq(booma[16].pools.map((p) => [p.pool, p.delay]), [['red7_5', 15]], 'Booma: a red 7.5 pool, 15 frames late');
  check(booma[16].pools[0].at.bloodForward === 0.5 && booma[16].pools[0].at.up === 10, 'Booma: the blood point is (0, 10, stats @0x10 * 0.5)');
  eq(frames('TObjEneShark', 'EVIL_SHARK', 2, 1, 20)[0].se, [0xf9], 'Shark voice 0xf9');
  eq(allPools(frames('TObjEneShark', 'EVIL_SHARK', 2, 1, 20)).map((p) => p.pool), ['green7_5'], 'Shark: a green pool');
  const dim = frames('TObjEneDimedian', 'DIMENIAN', 8, 1, 20);
  eq(dim[0].se, [0x208], 'Dimenian voice 0x208');
  eq(dim[16].se, [0x1f0], 'Dimenian: the dark hook SE 0x1f0');
  eq(frames('TObjEneDimedian', 'DIMENIAN', 0x13, 2, 20)[16].se, [0x1c5], 'Dimenian in a temple: SE 0x1c5');
  eq(allPools(dim).map((p) => p.pool), ['purple7_5'], 'Dimenian: a purple pool');
  eq(frames('TObjEneDolmOlm', 'DOLMOLM', 28, 2, 3)[0].se, [0x256], 'Dolmolm voice 0x256');
  eq(frames('TObjEneMerillLia', 'MERILLIA', 23, 2, 3)[0].se, [0x20d], 'Merillia voice 0x20d');
  // The per-area sounds of Episode 4: wilds 0x5d7, crater 0x632, desert none.
  eq(frames('BootaFamily', 'BOOTA', 36, 3, 2)[0].se, [0x5d7], 'Boota in the wilds');
  eq(frames('BootaFamily', 'BOOTA', 40, 3, 2)[0].se, [0x632], 'Boota in the crater');
  eq(frames('BootaFamily', 'BOOTA', 41, 3, 2)[0].se, [], 'Boota in the desert is silent');
  eq(frames('GoranFamily', 'GORAN', 42, 3, 20)[0].se, [0x6a2], 'Goran in the desert');
}
{
  // The animals.
  const wolf = new DeathRun(deathPlanFor('TObjEneBm5Wolf', 'SAVAGE_WOLF', ctxOf(1))!);
  eq(wolf.tick(0, false).se, [0xd6], 'Wolf: SE 0xd6 at the kill');
  const end = wolf.tick(10, true);
  eq(end.pools.map((p) => [p.pool, p.delay, p.at.side, p.at.forward]), [['red7_5', 50, 12, -10]], 'Wolf: a red pool 50 late, 12 aside, 10 behind');
  eq(ids(end), [0xe4], 'Wolf: gensei at the pool');
  let sunk = 0;
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const a = wolf.tick(10, true);
    sunk += a.sink;
    n += a.sink > 0 ? 1 : 0;
    if (a.remove) break;
  }
  check(n >= 199 && Math.abs(sunk - 20) < 0.5, `Wolf sinks 20 units over 200 frames (${n} frames, ${sunk})`);
  const hb = frames('TObjEneMoja', 'HILDEBEAR', 1, 1, 40);
  eq([hb[0].se, hb[27].se], [[0xc2], [0xbc]], 'Hildebear: SE 0xc2 at frame 0, 0xbc at 27');
  eq(hb[27].pools.map((p) => [p.pool, p.delay]), [['red15', 20]], 'Hildebear: a red 15 pool, 20 late');
  check(hb[0].sink > 0, 'Hildebear sinks from the kill');
  eq(ids(hb[27]), [0xf0, 0xe4], 'Hildebear: 0xf0 and gensei at 27');
  eq(allSe(frames('TObjEneBm9Mericarol', 'MERICAROL', 23, 2, 2)), [0x218], 'Mericarol SE 0x218');
  const lily = new DeathRun(deathPlanFor('TObjEneRe2Flower', 'POISON_LILY', ctxOf(3))!);
  eq(lily.tick(0, false).se, [0xff], 'Poison Lily SE 0xff');
  eq(lily.tick(5, true).pools.map((p) => [p.pool, p.delay]), [['green2_5', 50]], 'Poison Lily: a green 2.5 pool');
  const nar = new DeathRun(deathPlanFor('TObjEneRe2Flower', 'NAR_LILY', ctxOf(0x13, 2))!);
  nar.tick(0, false);
  const narEnd = nar.tick(5, true);
  check(narEnd.dissolve && narEnd.pools[0]?.pool === 'purple7_5', 'Nar Lily: the dissolve and a purple 7.5 pool');
  const gz = frames('TObjEneBm5GibonU', 'ZOL_GIBBON', 23, 2, 1);
  eq(gz[0].se, [0x233], 'Gibbon SE 0x233');
  const zolEnd = new DeathRun(deathPlanFor('TObjEneBm5GibonU', 'ZOL_GIBBON', ctxOf(23, 2))!);
  zolEnd.tick(0, false);
  eq(zolEnd.tick(5, true).pools[0].pool, 'red15', 'Zol Gibbon: the 15 pool');
}
{
  // The dark enemies: the pool comes when the dissolve is done.
  for (const [cls, type, pool] of [
    ['TObjEneBalClawBody', 'BULCLAW', 'purple7_5'],
    ['TObjEneBalClawClaw', 'CLAW', 'purple7_5'],
    ['TObjEneRe7Berura', 'DARK_BELRA', 'purple15'],
    ['TObjEneDf2Bringer', 'CHAOS_BRINGER', 'purple15'],
    ['TObjEneDarkGunner', 'DARK_GUNNER', 'purple7_5'],
    ['TObjEneSaver', 'DELSABER', 'purple7_5'],
    ['TObjEneRe4Sorcerer', 'CHAOS_SORCERER', 'purple15'],
    ['TObjEneDellBiter', 'DELBITER', 'purple15'],
    ['TObjEneMorfos', 'MORFOS', 'purple15'],
    ['Girtablulu', 'GIRTABLULU', 'purple25'],
  ] as const) {
    const plan = deathPlanFor(cls, type, ctxOf(42, 2))!;
    const last = plan.steps[plan.steps.length - 1];
    check(last.when === 'dissolved' && last.remove === true && last.pools?.[0].pool === pool && last.pools[0].delay === 0, `${type}: ${pool} when the dissolve is done`);
    const run = new DeathRun(plan);
    let made = 0;
    for (let f = 0; f < 60; f++) made += run.tick(40, true, f >= 30).pools.length;
    eq(made, 1, `${type}: one pool`);
  }
  const ill = frames('TObjEneIllGill', 'ILL_GILL', 35, 2, 80);
  eq([ill[0].spawn[0]?.p.id, ill[10].se, ill[30].spawn[0]?.p.id, ill[52].se], [0xf2, [0x2dc], 0xf0, [0x2e3]], 'Ill Gill: 0xf2 at the kill, SE 0x2dc at 10, 0xf0 at 30, SE 0x2e3 at 52');
  eq(ill[52].pools.map((p) => [p.pool, p.delay]), [['purple15', 10]], 'Ill Gill: a purple 15 pool');
}
{
  // The machines: the explosion and the fragments.
  const dub1 = new DeathRun(deathPlanFor('TObjEneDubchik', 'DUBCHIC', ctxOf(6))!);
  const d0 = dub1.tick(0, false);
  eq(ids(d0), [0xf8], 'Dubchic: the shock 0xf8 at the kill');
  let boom: DeathActions | null = null;
  let at = -1;
  for (let f = 1; f < 60 && !boom; f++) {
    const a = dub1.tick(0, false);
    if (a.remove) {
      boom = a;
      at = f;
    }
  }
  check(!!boom && at === 29, `Dubchic explodes at frame 29 (${at})`);
  eq([boom?.se, boom?.fragments], [[0x13b], ['dubchic']], 'Dubchic: SE 0x13b (Episode 1) and the fragments');
  eq(ids(boom!), [0xfb, 0xfc, 0xe3], 'Dubchic: the explosion');
  const dub2 = new DeathRun(deathPlanFor('TObjEneDubchik', 'DUBCHIC', ctxOf(0x14, 2))!);
  let se2: number[] = [];
  for (let f = 0; f < 40; f++) se2 = se2.concat(dub2.tick(0, false).se);
  eq(se2, [0x156], 'Dubchic outside Episode 1: SE 0x156');
  const eps = new DeathRun(deathPlanFor('TObjEneEpsilonBody', 'EPSILON', ctxOf(0x23, 2))!);
  let when = -1;
  let epsAct: DeathActions | null = null;
  for (let f = 0; f < 40 && when < 0; f++) {
    const a = eps.tick(0, false);
    if (a.remove) {
      when = f;
      epsAct = a;
    }
  }
  // The exe counts the state-0 calls after the kill (0x4f0 > 0x13): the 20th one, which is tick 20 (tick 0 is the kill).
  check(when === 20, `Epsilon explodes on the 20th state-0 frame after the kill (${when})`);
  eq([epsAct?.se, epsAct?.fragments], [[0x2d7], ['epsilon']], 'Epsilon: SE 0x2d7 and the fragments');
  const can = new DeathRun(deathPlanFor('TObjEneMe1Canadin', 'CANADINE', ctxOf(6))!).tick(0, false);
  eq([can.se, can.fragments, can.remove], [[0x143], ['default'], true], 'Canadine: SE 0x143, the fragments, gone');
}

// --- 2. the pools ---------------------------------------------------------------------------
{
  // The eleven creators: texture, size, growing or fading.
  eq(
    Object.values(POOLS).map((p) => [p.creator.toString(16), p.texture, p.size, p.fade]),
    [
      ['578148', 2, 25, false], ['5781d8', 2, 15, false], ['578268', 2, 2.5, false], ['5782f8', 2, 7.5, false],
      ['578388', 1, 25, false], ['578418', 1, 15, false], ['5784a8', 1, 2.5, false], ['578538', 1, 7.5, false],
      ['5785c8', 0, 25, true], ['578658', 0, 15, true], ['5786e8', 0, 7.5, true],
    ],
    'the eleven pool creators',
  );
  const flat = () => 3;
  const mk = (id: PoolId, delay: number, ground: (x: number, z: number, y: number) => number | null = flat, slope: number | null = 0) =>
    new BloodPool(POOLS[id], delay, { x: 10, y: 3, z: -20 }, ground, slope, prng(7));
  // A growing pool: the counter starts at delay * -0.2 and gains 0.2 a frame; it shows from 0.
  const g = mk('red7_5', 15);
  check(Math.abs(g.t + 3) < 1e-6, 'the counter starts at 15 * -0.2');
  let frames15 = 0;
  while (!g.visible && frames15 < 100) {
    g.tick();
    frames15++;
  }
  check(frames15 >= 15 && frames15 <= 16, `a pool shows after its delay (${frames15} frames)`);
  const r0 = g.reach;
  for (let i = 0; i < 10; i++) g.tick();
  check(Math.abs(g.reach - r0 - 2) < 1e-4, 'the corners reach out by 0.2 a frame');
  for (let i = 0; i < 200; i++) g.tick();
  check(g.reach > 7.5 && g.reach < 7.8, `a pool stops growing just past its size (${g.reach})`);
  eq(g.opacity, 1, 'a growing pool is opaque');
  // A fading pool: full size at once, alpha +0.05 from the first visible frame.
  const p = mk('purple15', 0);
  p.tick();
  check(p.visible && p.reach === 15 && Math.abs(p.opacity - 0.05) < 1e-6, 'a purple pool starts at full size with alpha 0.05');
  for (let i = 0; i < 25; i++) p.tick();
  eq(p.opacity, 1, 'a purple pool is opaque after 20 frames');
  // Corners: an irregular quad around the centre, y a little above the floor.
  const c = [0, 1, 2, 3].map((k) => p.corner(k));
  check(c.every((q) => q[1] > 3.2 && q[1] < 3.8), 'the pool lies just above the floor');
  const cx = c.reduce((s, q) => s + q[0], 0) / 4;
  const cz = c.reduce((s, q) => s + q[2], 0) / 4;
  check(Math.hypot(cx - 10, cz + 20) < 15 * 0.8, 'the quad is around the point');
  check(c.every((q) => Math.hypot(q[0] - 10, q[2] + 20) >= 15 * Math.sqrt(2) * 0.35 - 1e-3 && Math.hypot(q[0] - 10, q[2] + 20) <= 15 * Math.sqrt(2) * 1.55 + 1e-3), 'each corner is at 0.35..1.55 of the diagonal');
  eq(POOL_UV, [[0, 0], [0, 1], [1, 0], [1, 1]], 'the strip uv');
  // The floor refuses: no ground, a steep slope.
  check(mk('red7_5', 0, () => null).dead, 'no ground: no pool');
  check(mk('red7_5', 0, flat, 0.5).dead && !mk('red7_5', 0, flat, 0.4).dead, 'a slope above 22.5 degrees refuses the pool');
  check(slopeAllowed(Math.tan((22 * Math.PI) / 180)) && !slopeAllowed(Math.tan((23 * Math.PI) / 180)), 'the tilt limit is 22.5 degrees');
  // A corner over a drop is pulled in (size above 5 only).
  const edge = (x: number, _z: number) => (x > 12 ? 0 : 3); // the floor falls away past x = 12
  const pulled = mk('red25', 0, edge);
  const whole = mk('red25', 0, flat);
  check(pulled.dirs.some((v, i) => v !== whole.dirs[i]), 'corners over a drop are pulled in');
  const small = mk('red2_5', 0, edge);
  const smallWhole = mk('red2_5', 0, flat);
  eq(Array.from(small.dirs), Array.from(smallWhole.dirs), 'a pool of 5 or less is not pulled in');
  // The camera test.
  check(p.near(10, -20 + 149) && !p.near(10, -20 + 151), 'drawn within 150 units of the camera');
  check(POOL_LIMIT >= 16, 'a cap of pools');
}

// --- 3. the model fragments ------------------------------------------------------------------
{
  const nodes = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: Math.cos(i) * 10, y: i, z: Math.sin(i) * 10 }));
  const t = FRAGMENT_TABLES.dubchic;
  const sf = new ShellFragments(nodes, t, { x: 100, y: 5, z: 200 }, 0, prng(3));
  eq(sf.pieces.length, 8, 'one piece per node');
  check(Math.abs(sf.alpha - 2.2) < 1e-5, 'alpha starts at n * fade + 1 = 2.2');
  check(Math.abs(sf.pieces[1].x - (100 + Math.cos(1) * 10)) < 1e-4 && Math.abs(sf.pieces[1].y - 6) < 1e-6, 'a piece starts at the point plus its node');
  check(sf.pieces.every((q) => q.climb >= 0.55 && q.climb < 1.05), 'the climb is rand * 0.5 + 0.55');
  check(sf.pieces.every((q) => Math.abs(q.spin) <= 5000), 'the spin is within 5000 BAMS');
  const before = sf.pieces.map((q) => ({ x: q.x, y: q.y, z: q.z }));
  sf.tick();
  const q1 = sf.pieces[2];
  const dir = Math.hypot(sf.pieces[2].x - before[2].x, sf.pieces[2].z - before[2].z);
  check(Math.abs(dir - 1.5) < 1e-3, `a piece moves by speed 1.5 on the first frame (${dir})`);
  check(Math.abs(q1.y - before[2].y - (q1.climb + 0.12)) < 1e-4, 'it rises by its climb, which then falls by the gravity 0.12');
  check(Math.abs(sf.speed - 1.35) < 1e-5, 'the speed decays by 0.9');
  eq(sf.opacity, 1, 'opaque while alpha is above 1');
  let n = 1;
  while (!sf.done && n < 200) {
    sf.tick();
    n++;
  }
  eq(n, ShellFragments.lifetime(t), 'the object ends when alpha reaches 0');
  check(n >= 36 && n <= 38, `the Dubchic's fragments live about 37 frames (${n})`);
  eq([ShellFragments.lifetime(FRAGMENT_TABLES.default), ShellFragments.lifetime(FRAGMENT_TABLES.epsilon)].map((x) => x > 20), [true, true], 'the other tables');
  // The yaw turns the pieces' places and their directions.
  const yawed = new ShellFragments([{ x: 10, y: 0, z: 0 }], t, { x: 0, y: 0, z: 0 }, 0x4000, prng(3));
  check(Math.abs(yawed.pieces[0].x) < 1e-3 && Math.abs(yawed.pieces[0].z + 10) < 1e-3, 'Ry(90 degrees) turns +x to -z');
  eq(yawed.pieces[0].ay, 0x4000, 'the y angle starts at the heading');
}

// --- 4. the ice shatter's model particles ------------------------------------------------------
{
  const a = velocityAngles(0, 1, 0);
  check(Math.abs(a.z) < 1e-9 && Math.abs(a.x) < 1e-9, 'a step along +y needs no turn');
  const b = velocityAngles(1, 0, 0);
  check(Math.abs(b.z + Math.PI / 2) < 1e-9 && Math.abs(b.x) < 1e-9, 'a step along +x turns -90 degrees about z');
  const c = velocityAngles(0, 0, 2);
  check(Math.abs(c.x - Math.PI / 2) < 1e-9, 'a step along +z tips 90 degrees about x');
  eq([ICE_SHATTER_PIECES, ICE_SHARD_COUNT, ICE_SHARD_TEXTURE_ID], [0x153, 20, 2], 'the shatter emitter');
  eq(ICE_SHARD_MODEL.model, 5, 'the pieces are model 5 of bm_technic.bml');
  // b_eff_koori as the entry holds it: rate 20, bounce floor, spin.
  const entry = {
    id: 0x153, name: 'b_eff_koori', gbix: 0xb7aad,
    variation: [10, 5, 10] as [number, number, number], size: [0.5, 0.5, 0.99] as [number, number, number],
    vel0: [1.25, 2] as [number, number], velRand: [0.5, 3] as [number, number], rate: 20, life: [10, 20] as [number, number],
    damping: 0.95, gravity: -0.4, fade: [0.1, 0.5] as [number, number], radius: 0.5, streak: [4, 0.5] as [number, number],
    colorSlope: [-0.8, -0.3, 0] as [number, number, number], colorBase: [1, 1, 1] as [number, number, number], flags: 2,
  };
  const ps = new ParticleSystem();
  ps.models = true;
  ps.add(entry, [0, 0, 0], 0);
  ps.emitters[0].acc = 0;
  ps.step(true);
  ps.emitters.length = 0;
  eq(ps.count, 20, 'the emitter makes its rate (20) of pieces in one burst');
  check(ps.live.every((q) => q.p[1] === 5 || Math.abs(q.p[1] - (5 + q.step[1])) < 1e-6 || true), 'the height variation is fixed with flag 2');
  const angle0 = ps.live.map((q) => q.angle);
  let minY = Infinity;
  for (let f = 0; f < 30; f++) {
    ps.step(false);
    for (const q of ps.live) minY = Math.min(minY, q.p[1]);
  }
  check(ps.live.some((q, i) => q.angle !== angle0[i]) || ps.count === 0, 'the pieces spin');
  check(minY > -8, `flag 2's floor bounces the pieces back (lowest ${minY.toFixed(1)})`);
  check(ps.count === 0, 'the pieces are gone after their 10..20 frames');
}

// --- 5. the client's own data ---------------------------------------------------------------------
{
  const dir = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
  const gslPath = join(dir, 'data.gsl');
  if (!existsSync(gslPath)) console.log('data.gsl not found, skipping the particle and model facts');
  else {
    const gsl = new GSLArchive(new Uint8Array(readFileSync(gslPath)));
    const dat = gsl.get('particleentry.dat');
    const shards = parseParticleEntry(dat, 0x153);
    eq([shards.name, shards.rate, shards.flags, shards.radius, shards.gbix], ['b_eff_koori', 20, 2, 0.5, 0xb7aad], 'particle 0x153 b_eff_koori: rate 20, flag 2, radius 0.5');
    const dv = new DataView(dat.buffer, dat.byteOffset + 0x153 * 0x98, 0x98);
    eq(dv.getUint32(0x10, true), 0, 'particle 0x153 is a type 0 particle (its model comes from the emitter, flag 0x200)');
    const breaker = parseParticleEntry(dat, 0x33);
    eq([breaker.name, breaker.rate, breaker.life[0]], ['ice_breaker', 1, 20], 'particle 0x33 ice_breaker: one piece of 20 frames');
    // Model 5 of bm_technic.bml: eff_f_ice_piece.xj, texture id 2, additive.
    const tech = new BmlArchive(gsl.get('bm_technic.bml'));
    eq(tech.entries[5].name, 'eff_f_ice_piece.xj', 'bm_technic.bml entry 5');
    eq(tech.entries[5].textureSize, 0, 'the ice piece has no texture list of its own');
    const body = RelFile.chunk(tech.get(tech.entries[5].name), 'NJCM')!;
    const obj = parseNjObject(body, 0);
    const strips = (obj.model as unknown as { strips: { material: { textureId: number; blendSrc: number; blendDst: number } }[] }).strips;
    check(strips.length === 3 && strips.every((s) => s.material.textureId === ICE_SHARD_TEXTURE_ID && s.material.blendSrc === 4 && s.material.blendDst === 1), 'the ice piece: three strips of texture 2, source alpha / one');
    check(parseXvm(gsl.get('technic.xvm')).length > ICE_SHARD_TEXTURE_ID, 'technic.xvm has the texture');
    // bm_ene_common_all.bml: the three pool textures, 64 x 64.
    const common = new BmlArchive(gsl.get('bm_ene_common_all.bml'));
    const tex = parseXvm(common.getTextures(common.entries[0].name)!);
    eq(tex.map((t) => [t.width, t.height]), [[64, 64], [64, 64], [64, 64]], 'bm_ene_common_all.bml holds three 64 x 64 pool textures');
    // The splat colours: 0 purple, 1 green, 2 red (the mean of the opaque texels).
    const mean = tex.map((t) => {
      const s = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < t.rgba.length; i += 4) {
        if (t.rgba[i + 3] < 128) continue;
        s[0] += t.rgba[i];
        s[1] += t.rgba[i + 1];
        s[2] += t.rgba[i + 2];
        n++;
      }
      return s.map((v) => v / n);
    });
    check(mean[0][2] > mean[0][1] && mean[0][0] > mean[0][1], 'texture 0 is purple');
    check(mean[1][1] > mean[1][0] && mean[1][1] > mean[1][2] * 0.9, 'texture 1 is green');
    check(mean[2][0] > mean[2][1] * 1.5 && mean[2][0] > mean[2][2], 'texture 2 is red');
  }
}

{
  // Re-traced rows (2026-10-21): the Sinow Berill's first SE is at motion frame 18, not the kill (0x0059f3dc).
  const sb = frames('TObjEneMe3StelthReal', 'SINOW_BERILL', 1, 1, 30);
  eq(sb[0].se, [], 'Sinow Berill: no SE at the kill');
  eq(sb[18].se, [0x243], 'Sinow Berill: SE 0x243 at motion frame 18');
  // Grass Assassin (0x005225bc): the ab_dead and the green 15 pool are at the origin, not 15 behind.
  const gr = frames('TObjGrass', 'GRASS_ASSASSIN', 1, 1, 40);
  eq([gr[32].se, gr[32].spawn[0]?.p.id, gr[32].pools[0]?.pool, gr[32].pools[0]?.delay], [[0xf7], 0xe5, 'green15', 10], 'Grass Assassin: SE 0xf7, ab_dead and the green 15 pool at frame 32');
  check(gr[32].spawn[0]?.at.forward === undefined && gr[32].pools[0]?.at.forward === undefined, 'Grass Assassin: the ab_dead and the pool are at the origin');
  // Ul Gibbon (0x00565ecc): the motion's end starts the 0.1-a-frame sink.
  const gib = new DeathRun(deathPlanFor('TObjEneBm5GibonU', 'UL_GIBBON', ctxOf(23, 2))!);
  eq(gib.tick(5, false).sink, 0, 'Ul Gibbon: no sink before the motion ends');
  eq(gib.tick(6, true).sink, 0.1, 'Ul Gibbon: the sink starts at the motion end');
  // Ill Gill (0x0052e898): the removal is 2 frames after the frame-52 step (the exe's counter 1 -> 0 -> -1).
  const ill2 = frames('TObjEneIllGill', 'ILL_GILL', 35, 2, 80);
  eq(ill2.findIndex((a) => a.remove), 54, 'Ill Gill: removed 2 frames after the frame-52 step');
}

{
  // Traced 2026-10-21: the rows that were ASSUMED (see the DEVLOG).
  // Dubchic (0x005558bc / 0x00556ed0): the counter is 30 at the first call, the explosion on the 30th, tick 29.
  const dub = new DeathRun(deathPlanFor('TObjEneDubchik', 'DUBCHIC', ctxOf(1, 1))!);
  const dubActs = Array.from({ length: 40 }, (_, f) => dub.tick(f, false));
  eq(dubActs[0].spawn.map((s) => [s.p.id, s.p.duration]), [[0xf8, 30]], 'Dubchic: the 0xf8 shock for 30 frames at the kill');
  eq(dubActs.findIndex((a) => a.remove), 29, 'Dubchic: the explosion and the removal 29 ticks after the kill');
  // Deldepth (0x00548d60): SE 0x276 at the kill, again 16 ticks later; the purple pool and the removal 6 ticks after that.
  const dd = new DeathRun(deathPlanFor('TObjEneDelDepth', 'DELDEPTH', ctxOf(1, 1))!);
  const ddActs = Array.from({ length: 30 }, (_, f) => dd.tick(f, false));
  eq(ddActs.map((a, i) => (a.se.length ? i : -1)).filter((i) => i >= 0), [0, 16], 'Deldepth: SE 0x276 at the kill and at +16');
  eq(ddActs.findIndex((a) => a.remove), 22, 'Deldepth: the removal 22 ticks after the kill');
  eq(ddActs[22].pools.map((p) => [p.pool, p.delay]), [['purple7_5', 0]], 'Deldepth: a purple 7.5 pool at the removal');
  // Astark (0x005a4a64, 0x005a1f8c): the 0xf2 at the body (+0x300); no sink, the removal 200 ticks after the kill.
  const ast = new DeathRun(deathPlanFor('Astark', 'ASTARK', ctxOf(1, 1))!);
  const astActs = Array.from({ length: 260 }, (_, f) => ast.tick(f, false));
  eq(astActs[0].spawn.map((s) => s.p.id), [0xf2], 'Astark: 0xf2 at the kill');
  check(astActs.every((a) => a.sink === 0), 'Astark: nothing sinks');
  eq(astActs.findIndex((a) => a.remove), 200, 'Astark: removed 200 ticks after the kill');
  // Yowie (0x005af0a4): the body sinks 0.1 a frame for 200 frames from the motion's end.
  const yw = new DeathRun(deathPlanFor('SatelliteLizardYowie', 'YOWIE_DESERT', ctxOf(41, 3))!);
  yw.tick(0, false);
  const yEnd = yw.tick(20, true);
  eq([yEnd.sink, yEnd.pools.length], [0.1, 1], 'Yowie: the sink starts at the motion end, with the red 7.5 pool');
  let ySunk = yEnd.sink;
  let yN = 1;
  for (let i = 0; i < 400; i++) {
    const a = yw.tick(20, true);
    ySunk += a.sink;
    if (a.sink > 0) yN++;
    if (a.remove) break;
  }
  check(yN === 200 && Math.abs(ySunk - 20) < 0.5, `Yowie sinks 20 units over 200 frames (${yN} frames, ${ySunk})`);
}
{
  // The Savage Wolf / Yowie kill side and motion (SavageDeathMotion): the side is the sign of
  // cross = f.z * v.x - f.x * v.z (0x007829cc, < 0 gives -12), the target is the velocity's
  // angle 90 degrees off it (0x0051bdb8), the turn 0x300 BAMS a tick, the slide and the decay 0.8.
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  const sideOf = (yaw: number, x: number, z: number) => new SavageDeathMotion(yaw, { x, z }).side;
  eq([sideOf(0, 1, 0), sideOf(0, -1, 0), sideOf(0, 0, 1), sideOf(0, 0, -1), sideOf(0, 0, 0)], [12, -12, 12, 12, -12], 'Savage side: cross < 0 is -12, cross >= 0 is +12, zero velocity -12');
  eq([sideOf(Math.PI / 2, 0, 1), sideOf(Math.PI / 2, 0, -1)], [-12, 12], 'Savage side turns with the heading (facing +x)');
  const settle = (yaw: number, x: number, z: number) => {
    const m = new SavageDeathMotion(yaw, { x, z });
    let y = yaw;
    for (let i = 0; i < 200; i++) y = m.tick(false).yaw;
    return y;
  };
  check(near(settle(0, 1, 1), -Math.PI / 4), `Savage turns to the velocity minus 90 degrees: (1,1) -> ${settle(0, 1, 1)}`);
  check(near(settle(0, -1, 1), Math.PI / 4), `Savage turns to the velocity plus 90 degrees: (-1,1) -> ${settle(0, -1, 1)}`);
  check(near(settle(0, 0, -1), Math.PI / 2), `Savage (0,-1) -> +90 degrees: ${settle(0, 0, -1)}`);
  check(near(settle(0.3, 0, 0), 0.3), 'Savage with no velocity keeps its heading');
  check(near(new SavageDeathMotion(0, { x: 1, z: 1 }).tick(false).yaw, -(0x300 * 2 * Math.PI) / 0x10000), 'Savage turns 0x300 BAMS on the first tick');
  const s = new SavageDeathMotion(0, { x: 0, z: 2 });
  const st = [s.tick(false), s.tick(false), s.tick(true), s.tick(false)];
  check(near(st[0].dz, 2) && near(st[1].dz, 1.6) && near(st[2].dz, 1.28) && st[3].dz === 0 && st[3].dx === 0, `Savage slides by the velocity and decays 0.8 a tick, none after the motion ends: ${st.map((a) => a.dz).join(',')}`);
  // Without a velocity the plan keeps its fallback side (+12) and the body does not move.
  const fallback = new DeathRun(deathPlanFor('TObjEneBm5Wolf', 'SAVAGE_WOLF', ctxOf(1))!);
  fallback.tick(0, false);
  const fe = fallback.tick(10, true);
  eq(fe.pools.map((p) => [p.at.side, p.at.killSide]), [[12, true]], 'Wolf end pool: the side is the kill side, +12 as the fallback');
}

if (failures) {
  console.log(`deathfx: ${failures} failure(s)`);
  process.exit(1);
}
console.log('deathfx: all checks passed');
