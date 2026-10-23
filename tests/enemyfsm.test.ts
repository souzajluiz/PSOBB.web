// Per-family enemy FSMs of Forest / Caves (combat/enemyfsm.ts): the Poison
// Lily's track / spit / bite / scream states and its spit, the Savage Wolf's
// stalk -> leap -> hop back with the leap arc, the Rag Rappy's fake death and
// the Monest's Mothmant schedule and child slots.
// Run: node tests/enemyfsm.test.ts
import {
  LILY,
  LilyAi,
  LilySpit,
  MONEST,
  MonestSpawner,
  RappyFakeDeath,
  SPIT,
  WOLF,
  WolfAi,
  wolfLeapHeight,
} from '../client/src/combat/enemyfsm.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import { STATUS } from '../client/src/combat/status.ts';
import { expandEnemySets } from '../client/src/formats/enemyslots.ts';
import type { EnemySet } from '../client/src/formats/setdata.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-3) => check(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);
const player = (x: number, z: number, angle = 0): AiTarget => ({ clientId: 0, x, z, charClass: 0, dead: false, angle });
const attack = { distanceX: 12, angle: 0x1c71 } as never;

// --- Poison Lily -------------------------------------------------------------
{
  const lily = new LilyAi({ x: 0, z: 0, angle: 0, attack, radius: 10, rng: () => 0.9 });
  lily.tick([player(0, 260)]);
  eq(lily.state, 'idle', 'Lily ignores a player at 260 (search 250)');
  let r = lily.tick([player(0, 200)]);
  eq(lily.state, 'track', 'Lily tracks a player within 250');
  eq(r.motion?.index, 6, 'from idle it plays the opening row (motion 6)');
  let spitAt = -1;
  let launched = 0;
  for (let f = 1; f <= 140; f++) {
    r = lily.tick([player(0, 200)], lily.state === 'spit' && f > 125);
    if (lily.state === 'spit' && spitAt < 0) spitAt = f;
    if (r.projectile) launched++;
  }
  eq(spitAt, LILY.spitAfter + 1, 'the spit starts once the count passes 100');
  eq(launched, 1, 'one spit launched (frame 12 of the motion)');
  lily.tick([player(0, 400)], true);
  lily.tick([player(0, 400)]);
  eq(lily.state, 'idle', 'farther than 300: back to idle');

  // Bite: closer than 50 and inside AttackData's angle.
  const b = new LilyAi({ x: 0, z: 0, angle: 0, attack, radius: 10, rng: () => 0.9 });
  b.tick([player(0, 20)]);
  b.tick([player(0, 20)]);
  eq(b.state, 'bite', 'a player in front within 50 is bitten');
  let hit = null;
  for (let f = 0; f < 6 && !hit; f++) hit = b.tick([player(0, 20)]).hit;
  check(hit !== null && hit.knockback === 3, 'the bite lands at frame 10 with knockback 3');

  // Scream after a flinch (roll < 0.3) paralyzes the player within 100.
  const s = new LilyAi({ x: 0, z: 0, angle: 0, attack, radius: 10, rng: () => 0.1 });
  s.tick([player(0, 80)]);
  s.onDamage(0);
  eq(s.resume(), 'scream', 'a flinch with roll < 0.3 screams');
  let status = null;
  let at = 0;
  for (let f = 1; f <= 30; f++) {
    const o = s.tick([player(0, 80)]);
    if (o.status) {
      status = o.status;
      at = f;
    }
  }
  eq([status?.type, at], [STATUS.paralysis, LILY.screamHit], 'the scream paralyzes at frame 25');
  eq(s.state, 'track', 'back to tracking after 30 frames');
  const n = new LilyAi({ x: 0, z: 0, angle: 0, attack, radius: 10, rng: () => 0.3 });
  n.onDamage(0);
  eq(n.resume(), 'track', 'roll 0.3 does not scream');

  // A landed spit: the satisfied state.
  s.spitLanded();
  s.tick([player(0, 80)]);
  eq(s.state, 'satisfied', 'a spit that hit -> satisfied');
}

// --- the spit ------------------------------------------------------------------
{
  const spit = new LilySpit(0, 0, 0);
  let hit = null;
  let frames = 0;
  while (!spit.done && frames < 200) {
    hit = spit.tick([player(0, 60)]) ?? hit;
    frames++;
  }
  check(hit !== null, 'the spit reaches a player 60 ahead');
  eq(frames, Math.ceil((60 - SPIT.radius - 5) / SPIT.speed), 'at 4 units per frame');
  const far = new LilySpit(0, 0, 0);
  let n = 0;
  while (!far.done && n < 200) {
    far.tick([]);
    n++;
  }
  // 12 high, falling 0.1 more per frame from frame 18.
  check(n > 18 && n < 40, `the spit lands after ${n} frames`);
  check(far.z > 18 * SPIT.speed, 'it flies straight for 18 frames first');
}

// --- Poison Lily low-HP spin (state 8) --------------------------------------
{
  const spin = (hp: number, maxHp: number, ultimate = false) => {
    const l = new LilyAi({ x: 0, z: 0, angle: 0, attack, radius: 10, ultimate, rng: () => 0.9 });
    l.setHp(hp, maxHp);
    return l;
  };
  // The flinch end: hp < maxHp >> 2 (249 of 1000, not 250) starts the spin.
  let l = spin(249, 1000);
  l.onDamage(0);
  eq(l.resume(), 'spin', 'hp 249 of 1000 (below 250) spins');
  l = spin(250, 1000);
  l.onDamage(0);
  eq(l.resume(), 'track', 'hp 250 of 1000 does not spin (roll 0.9 no scream)');
  // Spin turn and bob: the first frame turns 0x400 BAMS, the bob climbs 17.
  l = spin(10, 1000);
  l.onDamage(0);
  l.resume();
  let r = l.tick([]);
  eq([l.state, l.spinFrames], ['spin', 1], 'spin counts one frame');
  near(r.angle, 0x400 * Math.PI * 2 / 0x10000, 'spin turns 0x400 BAMS in the first frame');
  eq(l.spinBob, 17, 'the bob starts at 0 (0x41c = 1): the first step runs it down past 0 and back up 17');
  l.tick([]);
  eq(l.spinBob, 34, 'the bob climbs 17 more a frame in the first phase');
  // The blast after 450 frames: the nearest player within reach, dead, one SE.
  l = spin(10, 1000);
  l.onDamage(0);
  l.resume();
  let blast: ReturnType<LilyAi['tick']> | null = null;
  for (let i = 0; i < 451 && !blast; i++) {
    const f = l.tick([player(0, 5)]);
    if (f.hit) blast = f;
  }
  eq([l.spinFrames, l.state, l.exploded, blast?.hit?.clientId ?? null], [451, 'dead', true, 0], 'the spin blasts at count 451 (> 450): hit, dead');
  const se = l.takeSe();
  eq(se[se.length - 1], 0xfe, 'the blast SE 0xfe is the last sound (the dark variant 0x2c7)');
  // Ultimate Mode counts 20 a frame: 450 / 20 passes at the 23rd frame.
  l = spin(10, 1000, true);
  l.onDamage(0);
  l.resume();
  let frames = 0;
  while (l.state === 'spin' && frames < 100) {
    l.tick([]);
    frames++;
  }
  eq([frames, l.exploded], [23, true], 'Ultimate Mode blasts after 23 frames (count 460)');
  // A flinch during the spin re-enters it and keeps the count (bit 4 stays).
  l = spin(10, 1000);
  l.onDamage(0);
  l.resume();
  for (let i = 0; i < 10; i++) l.tick([]);
  l.onDamage(0);
  eq(l.resume(), 'spin', 'a flinch while spinning spins again');
  eq(l.spinFrames, 10, 'the count survives the re-entry');
  // The bob turns at 256 (0x1fe - v) and plays the 0xfd sound once per turn.
  l = spin(10, 1000);
  l.onDamage(0);
  l.resume();
  for (let i = 0; i < 40; i++) l.tick([]);
  eq(l.takeSe().filter((id) => id === 0xfd).length >= 1, true, 'the bob turn plays SE 0xfd');
}

// --- Savage Wolf -------------------------------------------------------------
near(wolfLeapHeight(0), 0, 'leap height at 0');
near(wolfLeapHeight(15), 20, 'leap apex 20 at frame 15');
near(wolfLeapHeight(30), 0, 'landing at frame 30');
near(wolfLeapHeight(7.5), 15, 'quarter way: 15');
{
  const wolf = new WolfAi({ x: 0, z: 0, angle: 0, detect: 225, turnRate: 1536, attack, radius: 10, entityId: 0x1003, rng: () => 0.5 });
  wolf.tick([player(0, 200, Math.PI)]);
  eq(wolf.state, 'stalk', 'the wolf stalks a player within 225');
  // The player faces the wolf: it leaps once the 45-frame wait is over.
  let leapAt = -1;
  for (let f = 1; f <= 60 && leapAt < 0; f++) {
    const p = player(0, 60, Math.PI);
    wolf.tick([p]);
    if (wolf.state === 'leap') leapAt = f;
  }
  eq(leapAt, WOLF.decideAfter + 1, 'leaps on frame 46 when the target faces it');
  let maxLift = 0;
  let hit = null;
  let f = 0;
  const z0 = wolf.z;
  while (wolf.state === 'leap' && f < 80) {
    const r = wolf.tick([player(0, wolf.z + 15, Math.PI)], f >= 40);
    maxLift = Math.max(maxLift, r.lift ?? 0);
    hit = r.hit ?? hit;
    f++;
  }
  near(maxLift, 20, 'the leap peaks at 20', 0.1);
  check(hit !== null && hit.knockback === 7, 'the leap hits at frame 20 with knockback 7');
  check(wolf.z - z0 > 30 && wolf.z - z0 < 45, `the leap covers about min(d, 40): ${(wolf.z - z0).toFixed(1)}`);
  eq(wolf.state, 'hop', 'after the hit it hops back');
  const r = wolf.tick([player(0, 300)], true);
  eq(wolf.state, 'stalk', 'the hop ends in the stalk');
  check(r.motion?.index === 13, 'stalk motion 13');
}

// --- Rag Rappy fake death ----------------------------------------------------
{
  const f = new RappyFakeDeath({ x: 0, z: 0, angle: 0, moveSpeed: 1, rng: () => 0.25 });
  let up = -1;
  for (let i = 1; i <= 1000 && up < 0; i++) if (f.tick([player(0, 50)], false) === 'getup') up = i;
  eq(up, 900, 'with a player within 120 it gets up after 900 frames');
  const g = new RappyFakeDeath({ x: 0, z: 0, angle: 0, moveSpeed: 1, rng: () => 0.25 });
  eq(g.tick([player(0, 130)], false), 'getup', 'nobody within 120: up at once');
  eq(g.tick([], true), 'run', 'the get-up motion ends: run');
  const z0 = g.z;
  const x0 = g.x;
  g.tick([], false);
  near(Math.hypot(g.x - x0, g.z - z0), 3.5, 'runs at the record speed * 3.5');
}

// --- Monest ------------------------------------------------------------------
{
  const m = new MonestSpawner(2, 30);
  eq([m.total, m.threshold], [30, 2], 'param3 total, param2 threshold');
  eq(m.tick(0, false, false).motion, null, 'waits for a player');
  eq(m.tick(0, true, false).motion?.index, 8, 'wakes up hovering (motion 8)');
  let spawned = 0;
  const times: number[] = [];
  let alive = 0;
  let animEnd = false;
  for (let f = 0; f < 600; f++) {
    const r = m.tick(alive, true, animEnd);
    animEnd = m.state === 'spawn' && !animEnd && f % 20 === 19;
    if (r.spawn) {
      spawned++;
      alive++;
      times.push(f);
    }
  }
  eq(times.slice(0, 2).length, 2, 'two per batch');
  check(times[0] >= MONEST.interval, `the first batch after the 120-frame interval (${times[0]})`);
  check(alive <= MONEST.maxAlive, 'never more than 6 alive');
  eq(new MonestSpawner(9, 99).total, 30, 'param3 is clamped to 30');
  // The n-th spawn is the slot Monest + 1 + n: the MOTHMANT slots that
  // expandEnemySets gives the Monest.
  const set = { type: 0x42, index: 0, params: [0, 0, 0, 0, 0, 0, 0], numChildren: 0, section: 0, wave: 0 } as unknown as EnemySet;
  const slots = expandEnemySets([set], 1);
  eq([slots[0].type, slots[1].type, slots[30].type, slots.length], ['MONEST', 'MOTHMANT', 'MOTHMANT', 31], 'Monest + 30 MOTHMANT slots');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsm: all checks passed');
