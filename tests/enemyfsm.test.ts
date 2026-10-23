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

// --- Savage / Barbarous Wolf: side dash and howl -----------------------------
{
  // The howl: the countdown enters it, the casts land on frames 30 and 40 on
  // the target, the sound once the motion has run past 10, and the motion's
  // end goes to the roam state (idle here).
  const w = new WolfAi({ x: 0, z: 0, angle: 0, detect: 225, turnRate: 1536, attack: null, radius: 10, entityId: 0x1005, rng: () => 0.5 });
  const p = player(0, 20, Math.PI);
  w.tick([p]);
  eq(w.state, 'stalk', 'the howl test wolf stalks first');
  w.armHowl(3);
  w.tick([p]);
  w.tick([p]);
  eq(w.state, 'stalk', 'the countdown is still running');
  const entry = w.tick([p]);
  eq(w.state, 'howl', 'the countdown reaches 0 and the wolf howls');
  eq(entry.motion?.index, 4, 'the howl plays motion 4');
  eq(entry.motion?.loop, false, 'the howl is a once motion');
  let zalureAt = -1;
  let jellenAt = -1;
  let soundAt = -1;
  let t = 0;
  for (let i = 1; i <= 200 && w.state === 'howl'; i++) {
    w.casts.length = 0;
    w.sounds.length = 0;
    const end = i >= 90;
    w.tick([p], end);
    t = i;
    for (const c of w.casts) if (c.tech === 'zalure') zalureAt = i;
    for (const c of w.casts) if (c.tech === 'jellen') jellenAt = i;
    if (w.sounds.includes(0xd3)) soundAt = i;
  }
  eq(zalureAt, 30, 'Zalure on the 30th frame of the howl (the entry tick is frame 0)');
  eq(jellenAt, 40, 'Jellen on the 40th frame');
  check(soundAt >= 20 && soundAt <= 27, `the sound 0xd3 plays once the motion has run 10 frames (tick ${soundAt})`);
  eq(w.state, 'idle', 'the motion end leaves the howl for the roam state');
  check(t >= 90, 'the howl runs to its motion end');
}
{
  // Side dash: a target on the + side of the heading starts the dash to +x.
  const w = new WolfAi({ x: 0, z: 0, angle: 0, detect: 225, turnRate: 1536, attack: null, radius: 10, entityId: 0x1005, rng: () => 0.9 });
  const far = player(-50, 0);
  const out = w.startDash(far);
  eq(w.state, 'dash', 'startDash enters the side dash');
  eq(out.motion?.index, 13, 'the dash plays the stalk motion (animation 1)');
  w.tick([far]);
  check(w.x > 0, `a target on the cross side starts the dash to +x (x ${w.x.toFixed(2)})`);
  // The dash ends in the roam state after 150 frames.
  let n = 0;
  while (w.state === 'dash' && n < 400) {
    w.tick([far]);
    n++;
  }
  eq(n, 150, 'the dash runs 150 frames (the counter passes 0x96)');
  eq(w.state, 'idle', 'then the roam state');
  // Without a target the dash is random in side and ends at once (no goal to walk to).
  const v = new WolfAi({ x: 0, z: 0, angle: 0, detect: 225, turnRate: 1536, attack: null, radius: 10, entityId: 0x1005, rng: () => 0.9 });
  v.startDash(null);
  eq(v.state, 'dash', 'startDash works with no target');
  v.tick([]);
  eq(v.state, 'idle', 'the dash ends at once with no target');
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
