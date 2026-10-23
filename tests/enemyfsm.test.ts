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
  MONEST_DORMANT,
  MONEST_WAKE,
  MOTHMANT,
  MothmantAi,
  MonestSpawner,
  RappyFakeDeath,
  SPIT,
  WOLF,
  WOLF_DASH,
  WOLF_PACK_HOWL,
  WOLF_ROAM,
  RAPPY_ALIVE,
  RappyAi,
  WolfAi,
  armPackHowl,
  wolfLeapHeight,
} from '../client/src/combat/enemyfsm.ts';
import { AI_PROFILES, type AiTarget, type EnemyAiProfile } from '../client/src/combat/enemyai.ts';
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
{
  // The dash's hit check: the speed lerps 0.2 a frame toward 1.6 and the step is
  // along a heading turned by at most 0x500 BAMS toward the aim.
  const w = new WolfAi({ x: 0, z: 0, angle: 0, detect: 225, turnRate: 1536, attack: null, radius: 10, entityId: 0x1005, rng: () => 0.9 });
  const g = w as unknown as { speed: number };
  w.startDash(player(-50, 0));
  const a0 = w.angle;
  w.tick([player(-50, 0)]);
  near(g.speed, WOLF_DASH.lerp, 'the first dash frame lerps the speed to 0.2');
  check(Math.abs(w.angle - a0) <= (WOLF_DASH.turn * Math.PI) / 32768 + 1e-6, 'the heading turns by at most 0x500 BAMS');
  check(w.x > 0, 'the step goes to the cross side');
  w.tick([player(-50, 0)]);
  near(g.speed, 2 * WOLF_DASH.lerp, 'the second frame lerps to 0.4');
}
{
  // The dash's speed test: a goal nearer than the threshold 0x43c goes to the stalk.
  const w = new WolfAi({ x: 0, z: 0, angle: 0, detect: 225, turnRate: 1536, attack: null, radius: 10, entityId: 0x1005, rng: () => 0.9 });
  (w as unknown as { arriveAt: number }).arriveAt = 200;
  w.startDash(player(-50, 0));
  w.tick([player(-50, 0)]);
  eq(w.state, 'stalk', 'the dash goes to the stalk when the goal is inside the threshold');
}
{
  // The roam (state 7): the idle walks to a goal up to 120 from the spawn on a
  // random heading, the speed ramps 0.05 a frame toward 0.3 + 0.7 r, the arrival
  // goes to the slow-down, then a rest of 240..360 frames and a new goal.
  const w = new WolfAi({ x: 0, z: 0, angle: 0, detect: 225, turnRate: 1536, attack: null, radius: 10, entityId: 0x1007, rng: () => 0.5 });
  const g = w as unknown as { goalX: number; goalZ: number; speed: number; roamPhase: number; wantSpeed: number };
  const r0 = w.tick([]);
  eq(w.state, 'idle', 'with no target the wolf roams (state 7)');
  eq(r0.motion?.index, 13, 'the walk plays the stalk motion (13)');
  // rng 0.5: heading 32768 BAMS (180 degrees), distance 60.
  near(g.goalX, 0, 'the goal x for rng 0.5');
  near(g.goalZ, -60, 'the goal z for rng 0.5');
  near(g.wantSpeed, 0.65, 'the walk speed 0.3 + 0.7 * 0.5');
  near(g.speed, WOLF_ROAM.up, 'the first walk frame ramps the speed by 0.05');
  let phase1At = -1;
  let phase2At = -1;
  let restMotion = -1;
  let back0At = -1;
  let maxDist = 0;
  for (let i = 1; i <= 1200 && back0At < 0; i++) {
    const before = g.roamPhase;
    const r = w.tick([]);
    maxDist = Math.max(maxDist, Math.hypot(w.x, w.z));
    if (before === 0 && g.roamPhase === 1 && phase1At < 0) phase1At = i;
    if (before === 1 && g.roamPhase === 2 && phase2At < 0) {
      phase2At = i;
      restMotion = r.motion?.index ?? -1;
    }
    if (before === 2 && g.roamPhase === 0) back0At = i;
  }
  check(phase1At > 0 && phase1At < 200, `the walk arrives (phase 1 at ${phase1At})`);
  eq(restMotion, 12, 'the rest plays the wait motion (12)');
  const rest = back0At - phase2At;
  check(rest >= 240 && rest <= 361, `the rest is 240..360 frames (${rest})`);
  check(maxDist < WOLF_ROAM.radius + 10, `the wolf stays about within 120 of the spawn (${maxDist.toFixed(1)})`);
}
{
  // The howl's trigger (DerolleProcessState_0051ba20, state 0x10 entry): a
  // Barbarous Wolf's death arms each live packmate (the same pack) with the
  // countdown 20 + round(50 r); the dead, the other packs and a non-Barbarous
  // death arm nobody.
  const mk = (pack: number, barbarous: boolean, id: number) =>
    new WolfAi({ x: 0, z: 0, angle: 0, detect: 225, turnRate: 1536, attack: null, radius: 10, entityId: id, pack, barbarous, rng: () => 0.5 });
  const dead = mk(7, true, 0x1010);
  const mate = mk(7, false, 0x1011);
  const other = mk(8, false, 0x1012);
  const gone = mk(7, false, 0x1013);
  gone.kill();
  eq(armPackHowl(dead, [dead, mate, other, gone], () => 0.5), 1, 'one live packmate is armed');
  let howlAt = -1;
  for (let i = 1; i <= 60 && howlAt < 0; i++) {
    mate.tick([]);
    if (mate.state === 'howl') howlAt = i;
  }
  eq(howlAt, WOLF_PACK_HOWL.base + Math.round(WOLF_PACK_HOWL.range * 0.5), 'the packmate howls after 20 + round(50 * 0.5) = 45 frames');
  for (let i = 0; i < 60; i++) other.tick([]);
  check(other.state !== 'howl', 'a wolf of another pack is not armed');
  eq(armPackHowl(mate, [mate, dead], () => 0.5), 0, 'a non-Barbarous death arms nobody');
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
// The wake-up (state 1): 61 idle ticks, then one Mothmant every 10 ticks from
// tick 70 until the threshold (param2) is reached; then dormant (state 2).
{
  const m = new MonestSpawner(2, 30);
  eq([m.total, m.threshold], [30, 2], 'param3 total, param2 threshold');
  eq(m.tick(0, false, false).motion, null, 'waits for a player');
  eq(m.tick(0, true, false).motion?.index, 14, 'wakes up on the wait motion (animation 0)');
  const spawnTicks: number[] = [];
  let dormantTick = -1;
  for (let f = 1; f <= 120; f++) {
    const r = m.tick(0, true, false);
    if (r.spawn) spawnTicks.push(f);
    if (r.motion?.index === 14 && dormantTick < 0 && f > 1) dormantTick = f;
  }
  eq(spawnTicks, [70, 80], 'the wake-up spawns at wake ticks 70 and 80');
  eq(m.state, 'dormant', 'then dormant (state 2)');
  eq(MONEST_WAKE.idleTicks, 61, 'the wake-up idles 61 ticks');
  eq(new MonestSpawner(0, 9).tick(0, true, false).motion?.index, 14, 'threshold 0 still wakes');
  const none = new MonestSpawner(0, 9);
  none.tick(0, true, false);
  let anySpawn = false;
  for (let f = 0; f < 200; f++) anySpawn ||= none.tick(0, true, false).spawn;
  check(!anySpawn, 'threshold 0 wakes and spawns nothing in the wake-up');
  eq(new MonestSpawner(9, 99).total, 30, 'param3 is clamped to 30');
  eq(new MonestSpawner(9, 99).threshold, 6, 'param2 above 5 is 6');
  // Dormant: armed while the live children are at most threshold / 2; one
  // child per pending batch (batch 1, interval 150).
  const d = new MonestSpawner(2, 30);
  d.tick(0, true, false);
  for (let f = 0; f < 80; f++) d.tick(0, true, false);
  const dormantSpawns: number[] = [];
  let alive = 0;
  for (let f = 0; f < 600; f++) {
    const r = d.tick(alive, true, false);
    if (r.spawn) {
      dormantSpawns.push(f);
      alive++;
    }
  }
  check(dormantSpawns.length >= 1, 'the dormant Monest spawns once it is armed');
  check(dormantSpawns.length <= 600 / MONEST_DORMANT.interval + 1, 'at most one child per 150-tick interval');
  check(alive <= MONEST.maxAlive, 'never more than 6 alive');
  // The n-th spawn is the slot Monest + 1 + n: the MOTHMANT slots that
  // expandEnemySets gives the Monest.
  const set = { type: 0x42, index: 0, params: [0, 0, 0, 0, 0, 0, 0], numChildren: 0, section: 0, wave: 0 } as unknown as EnemySet;
  const slots = expandEnemySets([set], 1);
  eq([slots[0].type, slots[1].type, slots[30].type, slots.length], ['MONEST', 'MOTHMANT', 'MOTHMANT', 31], 'Monest + 30 MOTHMANT slots');
}

// --- Mothmant ----------------------------------------------------------------
{
  const noop = () => 0;
  const make = (over: Partial<ConstructorParameters<typeof MothmantAi>[0]> = {}) =>
    new MothmantAi({ x: 0, z: 0, angle: 0, turnRate: 1536, speed: 2, attack: null, radius: 10, siblingsOn: noop, rng: () => 0.5, spawnLift: 25, ...over });
  // Launch: 41 ticks of throw, then the approach to the ring point, then wander.
  const m = make();
  eq([m.state, m.lift], ['launch', 25], 'a Mothmant starts launching at its spawn height');
  for (let f = 0; f < 41; f++) m.tick([]);
  eq(m.state, 'launch', 'still launching after the 41-tick throw');
  for (let f = 0; f < 400 && m.state === 'launch'; f++) m.tick([]);
  eq(m.state, 'wander', 'then flies to its ring point and wanders');
  // Wander -> chase inside 200; chase gives up beyond 450 (hover).
  const near = { clientId: 1, x: 150, z: 0, charClass: 0, dead: false };
  const settle = (x: MothmantAi) => {
    for (let f = 0; f < 400 && x.state === 'launch'; f++) x.tick([]);
  };
  const r = m.tick([near]);
  eq(m.state, 'chase', 'a player within 200 starts the chase');
  check(r.motion !== null, 'the chase starts its flight motion');
  const far = { clientId: 1, x: 600, z: 0, charClass: 0, dead: false };
  m.tick([far]);
  eq(m.state, 'hover', 'a target beyond 450 sends it to hover');
  // Attack: inside 100 with fewer than 2 siblings on the player.
  const a = make({ attack: null, radius: 10, rng: () => 0.5 });
  settle(a);
  a.tick([near]);
  for (let f = 0; f < 200 && a.state === 'chase'; f++) a.tick([{ ...near, x: 40 }]);
  eq(a.state, 'attack', 'inside 100 with no sibling on the player it attacks');
  // The strike lands at animation frame 9 after the 20-tick wind-up (ASSUMED).
  let hits = 0;
  for (let f = 0; f < 60; f++) {
    const out = a.tick([{ ...near, x: a.x + 5, z: a.z }], f > 0 && f % 30 === 0);
    if (out.hit) hits++;
  }
  check(hits >= 1, `the strike hits a player within reach (${hits})`);
  // Two siblings on the player: the swoop instead of the attack.
  const b = make({ siblingsOn: () => 2 });
  settle(b);
  b.tick([near]);
  for (let f = 0; f < 200 && b.state === 'chase'; f++) b.tick([{ ...near, x: 40 }]);
  eq(b.state, 'swoop', 'two siblings on the player send it to the swoop');
  eq(MOTHMANT.leash, 450, 'the leash 450 (0x920cc4)');
  eq(MOTHMANT.detect, 200, 'the search radius 200 (0x920c08)');
}

// --- Rag Rappy: its own alive FSM (RappyAi) ----------------------------------
{
  const rappy = (over: Partial<ConstructorParameters<typeof RappyAi>[0]> = {}) =>
    new RappyAi({
      x: 0,
      z: 0,
      angle: 0,
      profile: AI_PROFILES.TObjEneLappy as EnemyAiProfile,
      detect: 150,
      turnRate: 1024,
      attack: { distanceX: 20, angle: 0x2000 } as unknown as import('../client/src/formats/battleparams.ts').EnemyAttackData,
      speed: 1,
      radius: 10,
      wander: 0,
      entityId: 7,
      rng: () => 0.5,
      ...over,
    });
  eq(RAPPY_ALIVE.gate, 30, 'the think gate is vtable +0x44(30)');
  eq(RAPPY_ALIVE.lose, 150, 'the range 150 (0x009bc144 / _DAT_00921bd8 = 150 squared)');
  eq(RAPPY_ALIVE.hitFrame, 14, 'the lunge hits at elapsed 14');
  eq(RAPPY_ALIVE.recoverTicks, 15, 'the recovery is 15 ticks (+0x344 = 0xf)');

  // The leash test runs only on the think tick of this entity: tick 7 (7 % 30), not tick 6.
  const leash = rappy({ wander: 0, radius: 10 });
  leash.x = 50; // far outside the leash of 10 (the spawn at 0, 0)
  let motionAt6 = null as number | null;
  let motionAt7 = null as number | null;
  for (let t = 1; t <= 7; t++) {
    const out = leash.tick([]);
    if (t === 6) motionAt6 = out.motion?.index ?? motionAt6;
    if (t === 7) motionAt7 = out.motion?.index ?? motionAt7;
  }
  eq(motionAt6, null, 'no motion change on a non-think tick (the pause keeps the idle motion)');
  eq(motionAt7, 9, 'the think tick sends the Rappy home on the walk (motion 9)');
  check(leash.x < 50, 'the walk home moves toward the spawn');

  // Acquisition inside 150 starts the chase; past 150 nothing is acquired.
  const far = rappy();
  far.tick([{ clientId: 0, x: 0, z: 200, charClass: 0, dead: false }]);
  eq(far.state, 'wander', 'a player beyond 150 is not acquired');
  const near = rappy();
  near.tick([{ clientId: 0, x: 0, z: 60, charClass: 0, dead: false }]);
  eq(near.state, 'chase', 'a player within 150 starts the chase (ASSUMED entry)');

  // Lunge timing: the target dead ahead at 12. Entry on tick 2 (engaged, in reach 20).
  const lunge = rappy();
  const foe = { clientId: 0, x: 0, z: 12, charClass: 0, dead: false };
  lunge.tick([foe]); // tick 1: wander -> chase
  lunge.tick([foe]); // tick 2: engaged (144 < 100 squared? no: 144 < 10000) and in reach -> lunge
  eq(lunge.state, 'lunge', 'an engaged Rappy in reach lunges');
  const hitTicks: number[] = [];
  let hitAt: { knockback: number; mult: number } | null = null;
  for (let t = 3; t <= 16; t++) {
    const out = lunge.tick([foe], false);
    if (out.hit) {
      hitTicks.push(t);
      hitAt = { knockback: out.hit.knockback, mult: out.hit.mult };
    }
  }
  eq(hitTicks, [16], 'the lunge hits on its 14th elapsed tick (tick 2 + 14)');
  eq(hitAt, { knockback: 3, mult: 1 }, 'the hit knocks back 3.0 and tries 1.0');
  eq(lunge.sounds.includes(RAPPY_ALIVE.sfxHit), true, 'the hit plays 0xc6');
  // Wait 30 ticks after the hit, then the coast until the animation ends.
  for (let t = 17; t <= 59; t++) lunge.tick([foe], false);
  eq(lunge.state, 'lunge', 'the coast waits for the animation to end');
  lunge.tick([foe], true);
  eq(lunge.state, 'recover', 'the animation ends into the recovery');
  // +0x344 = 15 counts down over 16 ticks (15..0, the 16th ends at -1); the 17th leaves.
  for (let t = 0; t < 16; t++) lunge.tick([foe], false);
  eq(lunge.state, 'recover', 'the recovery holds through its 16 counted ticks');
  lunge.tick([foe], false);
  eq(lunge.state, 'chase', 'the 17th tick leaves (ASSUMED: back to the chase)');

  // Dropping: engaged, the player walks past 150 -> no target, back to the wander.
  const drop = rappy();
  drop.tick([{ clientId: 0, x: 0, z: 100, charClass: 0, dead: false }]);
  drop.tick([{ clientId: 0, x: 0, z: 160, charClass: 0, dead: false }]);
  eq(drop.targetId, null, 'a target past 150 is dropped');
  drop.tick([{ clientId: 0, x: 0, z: 160, charClass: 0, dead: false }]);
  eq(drop.state, 'wander', 'with no target the Rappy wanders');

  // The pause ends with the 0xc4 sound and a 30-unit walk.
  const pause = rappy();
  for (let t = 0; t < 70; t++) pause.tick([]);
  check(pause.sounds.includes(RAPPY_ALIVE.sfxIdle), 'the pause end plays 0xc4');

  // A hit on a wandering Rappy starts the chase on the attacker.
  const hurt = rappy();
  hurt.onDamage(4);
  eq(hurt.state, 'chase', 'a hit starts the chase');
  eq(hurt.targetId, 4, 'the attacker is the target');
  eq(hurt.resume(), 'chase', 'resume keeps the chase');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsm: all checks passed');
