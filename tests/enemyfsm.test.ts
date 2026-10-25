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
import { AI_PROFILES, EnemyAi, type AiTarget, type EnemyAiProfile } from '../client/src/combat/enemyai.ts';
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
  // The vertical gate (0x0052a08c's FUN_0082e900 test, 0x009221bc = 30): the spit's world y (the Lily's
  // feet + 12 at the mouth, 4 units ahead in the first step) against the target's feet.
  const spitHitsAt = (ty: number): boolean => new LilySpit(0, 0, 0, 0).tick([{ ...player(0, 4), y: ty }]) !== null;
  check(spitHitsAt(0), 'spit: a target at the spit height hits');
  check(spitHitsAt(40), 'spit: 28 below the spit (within 30): hits');
  check(!spitHitsAt(43), 'spit: 31 below the spit: no hit (the y gate)');
  check(!spitHitsAt(-20), 'spit: 32 under the spit: no hit');
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
// The intro (state 0, MothmanProcessState_00519e20): the nest drops from 100
// and lands; it wakes only after its last cycle when the animation has ended.
{
  const m = new MonestSpawner(2, 30);
  eq([m.total, m.threshold], [30, 2], 'param3 total, param2 threshold');
  eq(m.state, 'intro', 'the Monest starts in the intro (state 0)');
  let drop = -1;
  for (let f = 1; f <= 400; f++) {
    const r = m.tick(0, false);
    if (r.motion?.index === 3 && drop < 0) drop = f;
  }
  check(drop > 100 && drop < 260, `the drop reaches the animation 9 threshold near tick ${drop}`);
  eq(m.state, 'intro', 'no wake while the animation has not ended');
  m.tick(0, true);
  eq(m.state, 'wake', 'the wake-up follows the last cycle once the animation ends');
  // Intro length with the animation ended from the start: the drop (100 -> 18,
  // then -5) plus 24 cycle ticks.
  const q = new MonestSpawner(2, 30);
  let t = 0;
  while (q.state === 'intro' && t < 2000) {
    q.tick(0, true);
    t++;
  }
  check(t > 120 && t < 260, `the intro lasts ${t} ticks (drop and six cycles)`);
}
// The wake-up: counted from its first tick (the transition tick), 60 idle
// ticks, the animation 1 from the 61st, then a child at the 70th and every 10
// ticks; the threshold reached, the next check goes dormant.
{
  const m = new MonestSpawner(2, 30);
  while (m.state === 'intro') m.tick(0, true);
  const spawnTicks: number[] = [];
  let wakeMotion = -1;
  let dormantTick = -1;
  for (let f = 1; f <= 120; f++) {
    const r = m.tick(0, false);
    if (r.spawn) spawnTicks.push(f);
    if (r.motion?.index === 11 && wakeMotion < 0) wakeMotion = f;
    if (m.state === 'dormant' && dormantTick < 0) dormantTick = f;
  }
  eq(wakeMotion, 60, 'the animation 1 starts at the 61st wake-up tick (tick 1 is the transition)');
  eq(spawnTicks, [69, 79], 'children at wake-up ticks 70 and 80');
  eq(dormantTick, 90, 'the threshold reached at tick 90: dormant on the next check');
  eq(m.state, 'dormant', 'then dormant (state 2)');
  eq(MONEST_WAKE.idleTicks, 60, 'the wake-up idles 60 ticks (0x3c)');
  const none = new MonestSpawner(0, 9);
  while (none.state === 'intro') none.tick(0, true);
  let anySpawn = false;
  for (let f = 0; f < 200; f++) anySpawn ||= none.tick(0, false).spawn;
  check(!anySpawn, 'threshold 0 wakes and spawns nothing in the wake-up');
  eq(new MonestSpawner(9, 99).total, 30, 'param3 is clamped to 30');
  eq(new MonestSpawner(9, 99).threshold, 6, 'param2 above 5 is 6');
  // Dormant: armed while the live children are at most threshold / 2; one
  // child per pending batch (batch 1, interval 150).
  const d = new MonestSpawner(2, 30);
  while (d.state !== 'dormant') d.tick(0, true);
  const dormantSpawns: number[] = [];
  let alive = 0;
  for (let f = 0; f < 600; f++) {
    const r = d.tick(alive, false);
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
// --- Monest: hit reaction, flinch, the killing hit (set_monest_dead) ---------
// Vtable 0x100 (a hit that does not kill) -> state 7; vtable 0x104 (set_monest_dead,
// every tick while dead): not active -> flinch (4), active -> kill (8). The
// flinch's end goes to hover (5), which arms the nest, so a dead inactive
// Monest is revived for one flinch and dies in the tick after its hover.
{
  // Runs the Monest to dormant (state 2) and returns it.
  const dormant = (): MonestSpawner => {
    const m = new MonestSpawner(2, 30);
    while (m.state !== 'dormant') m.tick(0, true);
    return m;
  };
  // Ticks until the state changes (or the cap), with the animation ended.
  const untilState = (m: MonestSpawner, s: string, cap = 50): number => {
    for (let f = 1; f <= cap; f++) {
      m.tick(0, true);
      if (m.state === s) return f;
    }
    return -1;
  };

  // A killing hit on an inactive Monest: flinch, then hover (active), then kill.
  const k = dormant();
  eq(k.active, false, 'a dormant Monest that was never hovered is not active');
  k.die();
  const k1 = k.tick(0, false);
  eq([k.state, k1.motion?.index], ['flinch', 9], 'a killing hit on an inactive Monest goes to the flinch (animation 3, motion 9)');
  check(untilState(k, 'hover') > 0, 'the flinch ends in hover (5) once its animation ends');
  eq(k.active, true, 'the hover arms the nest (+0x3b0 = 1)');
  const kill = k.tick(0, false);
  eq([k.state, kill.motion?.index], ['kill', 5], 'the dead Monest goes to the kill (8) on the tick after its hover, animation 7 (motion 5)');
  // The kill plays its animation, then the body sinks 0.1 a tick until +0x4e0
  // reaches 20 (about 200 ticks); the dead state (9) then removes it once no
  // child is alive. A live child keeps the body.
  let sunk = 0;
  let f = 0;
  for (; f < 400 && k.state !== 'dead'; f++) sunk += k.tick(1, true).sink ?? 0;
  check(f >= 200 && f <= 203, `the kill sinks for about 200 ticks before the dead state (${f})`);
  // The first tick ends the animation (no sink), the last one runs the check (no sink).
  check(Math.abs(sunk - 0.1 * (f - 2)) < 1e-3, `the body sinks 0.1 a tick (${sunk.toFixed(2)})`);
  eq(k.tick(1, true).removed ?? false, false, 'the dead Monest with a live child is not removed');
  eq(k.tick(0, true).removed, true, 'the dead state removes the body once no child is alive');
  eq(k.tick(0, true).removed ?? false, false, 'the removal is reported once');

  // A killing hit on an active Monest: the kill at once.
  const a = dormant();
  a.hit(false); // the hit reaction, dormant state, HP above half: back to dormant
  for (let f = 0; f < 3; f++) a.tick(0, false);
  eq(a.state, 'hit', 'a hit that does not kill starts the hit reaction (7)');
  a.tick(0, true);
  eq(a.state, 'dormant', 'a hit reaction above half HP returns to the previous state');
  // Activate through a low-HP hit: the hit reaction goes to the flinch, then hover.
  const b = dormant();
  b.hit(false);
  b.tick(0, true, true);
  eq(b.state, 'flinch', 'a hit that leaves the Monest at most half HP goes to the flinch (4)');
  b.tick(0, true);
  eq(b.state, 'hover', 'the flinch ends in hover');
  b.die();
  b.tick(0, false);
  eq(b.state, 'kill', 'an active Monest that is killed goes straight to the kill (8)');
}
{
  // A non-lethal hit on an inactive Monest uses animation 2 (motion 10); on an
  // active one animation 6 (motion 6).
  const m = new MonestSpawner(2, 30);
  while (m.state !== 'dormant') m.tick(0, true);
  const h = m.hit(false);
  eq(h?.index, 10, 'a non-lethal hit on an inactive Monest plays animation 2 (motion 10)');
  // Ultimate: a spawn in progress ignores a hit (the 0x100 handler's state 3 test).
  const s = new MonestSpawner(2, 30);
  while (s.state !== 'dormant') s.tick(0, true);
  for (let f = 0; f < 200 && s.state !== 'spawn'; f++) s.tick(0, false);
  eq(s.state, 'spawn', 'an armed dormant Monest starts a spawn');
  eq(s.hit(true), null, 'in Ultimate a hit on a spawning Monest is ignored');
  check(s.hit(false) !== null, 'outside Ultimate the same hit starts the hit reaction');
  // A hit is ignored while the flinch or the kill runs.
  const f = new MonestSpawner(2, 30);
  while (f.state !== 'dormant') f.tick(0, true);
  f.die();
  f.tick(0, false);
  eq(f.hit(false), null, 'a hit during the flinch is ignored');
  // A dying Monest stays dying: set_monest_dead runs each tick (no kill while the flinch lasts).
  eq(f.state, 'flinch', 'the flinch holds while dying');
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

// --- Mothmant: the ring, the flinch and the swoop's sub-steps -----------------
{
  eq(MOTHMANT.ringRadius, 30, 'the ring is 30 (the float at 0x00920c44, read by the hover, wander and launch; no writer)');
  let sib = 0;
  const make2 = (over: Partial<ConstructorParameters<typeof MothmantAi>[0]> = {}) =>
    new MothmantAi({ x: 0, z: 0, angle: 0, turnRate: 1536, speed: 2, attack: null, radius: 10, siblingsOn: () => sib, rng: () => 0.5, spawnLift: 25, ...over });
  const near = { clientId: 1, x: 40, z: 0, charClass: 0, dead: false };
  const landed = (x: MothmantAi) => {
    for (let f = 0; f < 500 && x.state === 'launch'; f++) x.tick([]);
  };
  // Flinch (HildebearProcessState_00516fbc): the animation's end returns to the
  // state it came from.
  const f1 = make2();
  landed(f1);
  eq(f1.state, 'wander', 'a Mothmant that landed wanders');
  f1.flinch();
  f1.tick([], false);
  eq(f1.state, 'flinch', 'the flinch takes the flinch state');
  f1.tick([], false);
  eq(f1.state, 'flinch', 'the flinch holds until its animation ends');
  f1.tick([], true);
  eq(f1.state, 'wander', 'then back to the state it came from');
  // A landed hit flinches from any state, the launch included (vtable 0x100 of
  // the Mothmant, 0x00589ab0: `if state != 6, SetEnemyAiState(6)`).
  const f0 = make2();
  f0.flinch();
  f0.tick([], false);
  eq(f0.state, 'flinch', 'a landed hit flinches a Mothmant still in its launch');
  eq(f0.motion?.index, 3, 'the flinch plays animation 3 (motion 3)');
  // The lethal death (0x005187a0): state 7 (the ground kill) when a landed melee
  // hit set +0x2e0 bit 2, else state 8 (the fall). The fall lands on the floor
  // (1.2 over the ground), bounces once while the motion runs, then sinks to
  // 20 under the floor and goes (0x00516c60 check); the ground kill is dead
  // after two update frames (0x00516ed8, `count > 1`).
  const fallM = make2();
  landed(fallM);
  fallM.tick([near]);
  eq(fallM.beginDeath(), 'fall', 'a Mothmant with no landed melee hit falls (state 8)');
  eq([fallM.dying, fallM.state], [true, 'dead'], 'the fall starts the death state and ends the AI');
  let landedAt = -1;
  let deadAt = -1;
  let lift0 = fallM.lift;
  for (let f = 0; f < 1000 && deadAt < 0; f++) {
    const r = fallM.deathTick(f >= 60);
    if (!r) break;
    if (r.landed && landedAt < 0) landedAt = f;
    if (r.dead) deadAt = f;
  }
  check(landedAt > 0, 'the fall reaches the floor (the land step)');
  check(deadAt > landedAt + 200 && deadAt < landedAt + 240, `the fall's sink takes about 212 ticks after the landing (got ${deadAt - landedAt})`);
  check(fallM.lift < lift0, 'the fall moves the body down');
  const meleeM = make2();
  landed(meleeM);
  meleeM.tick([near]);
  meleeM.noteMeleeHit();
  eq(meleeM.beginDeath(), 'ground', 'a Mothmant with a landed melee hit goes to the ground kill (state 7)');
  eq(meleeM.deathTick(false)?.dead, false, 'the ground kill is not dead after one update frame');
  eq(meleeM.deathTick(false)?.dead, true, 'the ground kill is dead after two update frames');
  const techM = make2();
  landed(techM);
  techM.tick([near]);
  eq(techM.beginDeath(), 'fall', 'a tech kill (bit 4 only) falls');
  // Flinch out of the attack: the attack goes on when fewer than 2 siblings are on the player.
  sib = 0;
  const f2 = make2();
  landed(f2);
  f2.tick([near]);
  f2.tick([near]);
  eq(f2.state, 'attack', 'a player inside 100 with no sibling on it is attacked');
  f2.flinch();
  f2.tick([near], true);
  eq(f2.state, 'attack', 'a flinched attacker keeps its player when it may take it');
  // ... and swoops when two siblings are on the player and no other player is free.
  sib = 2;
  const f3 = make2();
  landed(f3);
  f3.tick([near]);
  f3.tick([near]);
  eq(f3.state, 'swoop', 'two siblings on the player send the chase to the swoop');
  f3.flinch();
  f3.tick([near], true);
  eq(f3.state, 'swoop', 'a flinched attacker with no free player swoops');
  // The swoop's sweep: it holds while the arc is under a half turn, and ends in
  // the attack once the siblings allow it.
  sib = 2;
  const s = make2();
  landed(s);
  s.tick([near]);
  s.tick([near]);
  eq(s.state, 'swoop', 'the swoop starts');
  for (let f = 0; f < 60; f++) s.tick([near]);
  eq(s.state, 'swoop', 'the swoop holds through its approach and its first sweep');
  sib = 0;
  let end = -1;
  for (let f = 0; f < 800 && end < 0; f++) {
    s.tick([near]);
    if (s.state !== 'swoop') end = f;
  }
  check(end > 0 && end < 800, `after a half turn the swoop ends in the attack (after ${end} ticks)`);
  eq(s.state, 'attack', 'the exit is the attack once the player may be taken');
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

// --- Booma spawn (exe state 0, unknown_booma_enemy_spawn_handler 0x00535a6c) ---
{
  const boomaSpawn = (spawn: boolean, profile: EnemyAiProfile = AI_PROFILES.TObjEneBeast as EnemyAiProfile) =>
    new EnemyAi({
      x: 0,
      z: 0,
      angle: 0,
      profile,
      detect: 225,
      turnRate: 1024,
      attack: { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 12, angle: 0x1c71, distanceY: 0 },
      speeds: { idleMove: 0.8, idleAnim: 0.8, engagedMove: 0.5, engagedAnim: 0.5 },
      radius: 7,
      wander: 0,
      spawn,
    });
  const near: AiTarget = { clientId: 0, x: 50, z: 0, charClass: 0, dead: false };
  const spawnMotion = AI_PROFILES.TObjEneBeast.spawn!;
  const idleMotion = AI_PROFILES.TObjEneBeast.idle;

  // The Booma profile has the spawn animation 0xb: motion 0, once, 0.5 (slot 11 of 0x009bc980).
  eq(spawnMotion, { index: 0, speed: 0.5, loop: false }, 'the Booma spawn animation is motion 0, once, speed 0.5');

  // Spawn: the first tick plays animation 0xb and sets invulnerable; no target search.
  const ai = boomaSpawn(true);
  eq(ai.state, 'spawn', 'a Booma with spawn starts in the spawn state');
  const r0 = ai.tick([near]);
  eq(r0.motion, spawnMotion, 'the first tick plays the spawn animation');
  eq([ai.state, ai.invulnerable, ai.targetId], ['spawn', true, null], 'spawning: invulnerable, no target search');
  // The owner reports the end test only after the first tick, so an ended animation before it is ignored.
  const ai2 = boomaSpawn(true);
  ai2.tick([], true);
  eq([ai2.state, ai2.invulnerable], ['spawn', true], 'an end reported on the first tick does not end the spawn');
  // The animation plays: no motion change, the player in range does not start the war cry.
  const r1 = ai.tick([near], false);
  eq([r1.motion, ai.state], [null, 'spawn'], 'while the animation plays nothing changes');
  // The end test: animation 0 (idle) and no longer invulnerable; the state changes on the next tick.
  const r2 = ai.tick([near], true);
  eq([r2.motion, ai.state, ai.invulnerable], [idleMotion, 'spawn', false], 'the end test plays idle and drops the invulnerable flag');
  const r3 = ai.tick([near]);
  eq([ai.state, r3.motion], ['idle', null], 'the next tick is state 1 (idle), the motion already plays');
  // Idle is the normal brain from here: the player in range starts the war cry (state 3).
  const r4 = ai.tick([near]);
  eq([ai.state, r4.motion], ['notice', AI_PROFILES.TObjEneBeast.notice], 'after the spawn a near player starts the war cry');

  // A hit after the spawn lands: the brain goes to the chase on the attacker.
  const hitAfter = boomaSpawn(true);
  hitAfter.tick([]);
  hitAfter.tick([], true);
  hitAfter.tick([]);
  eq(hitAfter.state, 'idle', 'the spawn ended');
  hitAfter.onDamage(4);
  eq(hitAfter.state, 'chase', 'a hit after the spawn starts the chase');

  // No current_target == 1 (spawn false): the else branch. The first tick is sub 2 with no motion,
  // the state stays spawn and nothing is invulnerable; the next tick is idle.
  const noAnim = boomaSpawn(false);
  const n0 = noAnim.tick([near]);
  eq([noAnim.state, n0.motion, noAnim.invulnerable], ['spawn', null, false], 'no spawn animation: the first tick plays nothing');
  const n1 = noAnim.tick([near]);
  eq([noAnim.state, n1.motion], ['idle', null], 'no spawn animation: the next tick is idle');
  // A family without a spawn profile starts idle as before.
  eq(boomaSpawn(true, AI_PROFILES.TObjEneBeast as EnemyAiProfile).state, 'spawn', 'a Booma starts in the spawn state');
  eq(boomaSpawn(true).invulnerable, false, 'a fresh spawn is not invulnerable before its first tick');
  eq(boomaSpawn(true, AI_PROFILES.TObjEneMoja as EnemyAiProfile).state, 'idle', 'a family without a spawn profile starts idle');
  eq(boomaSpawn(true, AI_PROFILES.TObjEneShark as EnemyAiProfile).state, 'spawn', 'the Shark starts in the spawn state');
  eq(boomaSpawn(true, AI_PROFILES.TObjEneDimedian as EnemyAiProfile).state, 'spawn', 'the Dimenian starts in the spawn state');
}

// --- Shark / Dimenian timed spawn (exe 0x00552704 / 0x005ad51c, the 0x3b0 state timer) ---
{
  const f32 = Math.fround;
  // The exe's float32 loop: acc = f32(step * scale), then acc = f32(acc + step) until acc >= 2.0.
  const advancing = (divisor: number, scale: number): number => {
    const step = f32(2 / divisor);
    let acc = f32(f32(step * scale));
    let n = 0;
    do {
      acc = f32(acc + step);
      n++;
    } while (acc < 2 && n < 1000);
    return n;
  };
  // Shark: -6.0 start, 40 ideal steps, but float32 accumulation reaches 2.0 on the 41st add.
  eq(advancing(10, -30), 41, 'the Shark timer takes 41 advancing ticks in float32');
  // Dimenian: -4.0 start, 30 steps, exact.
  eq(advancing(10, -20), 30, 'the Dimenian timer takes 30 advancing ticks');

  const timed = (profile: EnemyAiProfile, spawn: boolean) =>
    new EnemyAi({
      x: 0,
      z: 0,
      angle: 0,
      profile,
      detect: 225,
      turnRate: 1024,
      attack: { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 12, angle: 0x1c71, distanceY: 0 },
      speeds: { idleMove: 0.8, idleAnim: 0.8, engagedMove: 0.5, engagedAnim: 0.5 },
      radius: 7,
      wander: 0,
      spawn,
    });
  const near: AiTarget = { clientId: 0, x: 50, z: 0, charClass: 0, dead: false };
  const shark = AI_PROFILES.TObjEneShark as EnemyAiProfile;
  const dimenian = AI_PROFILES.TObjEneDimedian as EnemyAiProfile;

  // Profiles: no animation spawn, a timer with the exe's sound and particles.
  eq([shark.spawn, shark.spawnTimer?.sound, shark.spawnTimer?.effects], [undefined, 0x124, [{ id: 0xea, dy: 0 }, { id: 0xe9, dy: 30 }]], 'Shark spawn: timer, sound 0x124 fallback, particles 0xea and 0xe9 +30');
  eq([dimenian.spawn, dimenian.spawnTimer?.sound, dimenian.spawnTimer?.effects], [undefined, 0x1d1, [{ id: 0xe6, dy: 30 }]], 'Dimenian spawn: timer, sound 0x1d1 fallback, particle 0xe6 +30');

  for (const [name, profile, ticks] of [
    ['Shark', shark, 41],
    ['Dimenian', dimenian, 30],
  ] as const) {
    const ai = timed(profile, true);
    const first = ai.tick([near]);
    eq([ai.state, first.motion, first.spawnFx], ['spawn', null, { sound: profile.spawnTimer!.sound, effects: profile.spawnTimer!.effects }], `${name}: the first tick plays the sound and particles, no motion`);
    eq([ai.invulnerable, ai.timedSpawn], [false, true], `${name}: not invulnerable, a timed spawn`);
    let motions = 0;
    let fx = 0;
    let idleAt = -1;
    // Global tick numbers: tick 1 is the init (sub 0, already run above); ticks 2..ticks+1 advance the
    // timer, the last one sets sub 2 (still spawn, no motion); tick ticks+2 is the sub-2 tick: idle.
    let tickNo = 1;
    while (idleAt < 0 && tickNo < ticks + 10) {
      const r = ai.tick([near]);
      tickNo++;
      if (r.motion) motions++;
      if (r.spawnFx) fx++;
      if (ai.state === 'idle') idleAt = tickNo;
    }
    eq([motions, fx], [0, 0], `${name}: no motion and no second sound while spawning`);
    eq(idleAt, ticks + 2, `${name}: idle on tick ${ticks + 2} (1 init, ${ticks} advancing, 1 sub-2 tick)`);
    // Then idle is the normal brain: the idle motion plays on the next tick.
    eq(ai.tick([]).motion, profile.idle, `${name}: the idle motion plays after the spawn`);
  }

  // The no-spawn branch (+0x398 == 0): sub 2 on the first tick, nothing played, idle on the next.
  const none = timed(shark, false);
  const n0 = none.tick([near]);
  eq([none.state, n0.motion, n0.spawnFx], ['spawn', null, undefined], 'Shark without +0x398: the first tick plays nothing');
  none.tick([near]);
  eq(none.state, 'idle', 'Shark without +0x398: idle on the next tick');

  // A fresh Dimenian: its ctor writes +0x398 = 0 and only EnableDerolleEntity (state 9) writes 1, so the
  // first spawn tick takes the no-effect branch (render/combat.ts passes spawn false for it).
  const freshDim = timed(dimenian, false);
  const fd0 = freshDim.tick([near]);
  eq([freshDim.state, fd0.motion, fd0.spawnFx], ['spawn', null, undefined], 'a fresh Dimenian (+0x398 == 0): the first tick plays no sound and no particles');
  freshDim.tick([near]);
  eq(freshDim.state, 'idle', 'a fresh Dimenian: idle on the next tick');

  // Hits during the timed spawn land (no invulnerability): the chase starts on the attacker.
  const hit = timed(dimenian, true);
  hit.tick([]);
  hit.onDamage(4);
  eq([hit.state, hit.targetId], ['chase', 4], 'a Dimenian hit during its spawn starts the chase');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsm: all checks passed');
