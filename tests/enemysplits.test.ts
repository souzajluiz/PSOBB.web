// Caves splitters (combat/enemysplits.ts): Pan Arms's emerge / walk /
// shockwave / bolt and its split into Hidoom and Migium (roam, attack, call
// and Resta, merge); the Pofuilly Slime's puddle / rise / crawl cycle, its
// spit and arm, its flinch, and the control's four-slot budget.
// Run: node tests/enemysplits.test.ts
import { HALF, PAN, PAN_BOLT, PAN_WAVE, PanArmsAi, PanArmsShot, PanHalfAi, type PanState, PUDDLE_MOTION, SLIME, SlimeAi, SlimeArm, SlimeControl, slimeSplitsOnHit, SlimeSpit, SLIME_MORPH, SPIT } from '../client/src/combat/enemysplits.ts';
import type { AiFrame, AiTarget } from '../client/src/combat/enemyai.ts';
import type { EnemyMovementData } from '../client/src/formats/battleparams.ts';
import { splitLockOk, splitRadarOk, splitStruckOk } from '../client/src/render/combat.ts';
import { GibblesAi, type GibblesState } from '../client/src/combat/enemyfsmep2a.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const player = (x: number, z: number, clientId = 0, y?: number): AiTarget => ({ clientId, x, y, z, charClass: 0, dead: false, angle: 0 });
const mv = (o: Partial<EnemyMovementData> = {}): EnemyMovementData => ({ fparam1: 0, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [0, 0, 0, 0, 0, 0], ...o });

// --- Pan Arms ----------------------------------------------------------------------
{
  const pan = new PanArmsAi({ x: 0, z: 0, angle: 0, movement: mv({ iparam: [40, 3, 0, 0, 0, 0], fparam2: 30, fparam3: 50 }), rng: () => 0.2 });
  eq(pan.state, 'buried', 'it starts buried');
  check(pan.invulnerable && pan.untargetable && pan.superArmor, 'buried: untargetable; hits never flinch it');
  const near = [player(0, 20)];
  pan.tick([player(0, 100)]);
  eq(pan.state, 'buried', 'a player outside iparam1 does not raise it');
  pan.tick(near);
  eq(pan.state, 'emerge', 'a player within iparam1 raises it (0x0058106c)');
  eq(pan.events.splice(0), [{ kind: 'emerged' }], 'the owner hears of it');
  let n = 0;
  while (pan.state === 'emerge' && n++ < 100) pan.tick(near);
  eq(pan.state, 'walk', 'it lands and walks');
  eq(pan.lift, 0, 'on the ground');

  // Walk side 1 (the first toggle) ends in the shockwave.
  let shots: PanArmsShot[] = [];
  n = 0;
  while (pan.state === 'walk' && n++ < 200) pan.tick(near, n % 20 === 0);
  eq(pan.state, 'shock', 'side 1: the shockwave');
  for (let i = 0; i < PAN.shockFrames && pan.state === 'shock'; i++) {
    const r = pan.tick(near, i === 5);
    if (r.shots) shots = shots.concat(r.shots as PanArmsShot[]);
  }
  eq(shots.map((s) => s.kind), ['wave'], 'one shockwave');
  eq(shots[0]?.effect, { kind: 'tech', power: 30 }, 'its power is fparam2');
  eq(pan.state, 'walk', 'after 90 frames it walks again');

  // The wave hits each player in reach once and lives 12 frames.
  const w = new PanArmsShot('wave', 0, 0, 0, 30);
  let hits = 0;
  for (let i = 0; i < 20; i++) hits += w.tick([player(0, 20), player(3, 25, 1)]).length;
  eq(hits, 2, 'the wave hits both players once');
  check(w.done && w.frames === PAN_WAVE.frames, 'the wave lasts 12 frames');
  const b = new PanArmsShot('bolt', 0, 0, 0, 50);
  let got = 0;
  for (let i = 0; i < 20 && !b.done; i++) got += b.tick([player(0, 40), player(0, 45, 1)]).length;
  eq(got, 1, 'the bolt stops at the first player');
  check(PAN_BOLT.speed === 10 && PAN_BOLT.frames === 12, 'bolt: 10 a frame, 12 frames');
}

// The buried timer (iparam2) runs out: it emerges with nobody near; iparam2 0
// emerges on the first frame.
{
  const late = new PanArmsAi({ x: 0, z: 0, angle: 0, movement: mv({ iparam: [5, 3, 0, 0, 0, 0] }) });
  const far = [player(0, 300)];
  for (let i = 0; i < 3; i++) late.tick(far);
  eq(late.state, 'buried', 'it waits iparam2 frames for a player');
  late.tick(far);
  eq(late.state, 'emerge', 'then it emerges anyway');
  const now = new PanArmsAi({ x: 0, z: 0, angle: 0, movement: mv({ iparam: [30, 0, 0, 0, 0, 0] }) });
  now.tick([]);
  eq(now.state, 'emerge', 'iparam2 0: it emerges at once');
  // Without its halves it never splits.
  while (now.state === 'emerge') now.tick([player(0, 20)]);
  now.hpFraction = 0.1;
  now.tick([player(0, 20)]);
  eq(now.state, 'walk', 'no halves: no split');
}

// Side 0 -> bolt; the first visit (odd) goes back to walking.
{
  const pan = new PanArmsAi({ x: 0, z: 0, angle: 0, movement: mv({ fparam3: 50, iparam: [40, 0, 0, 0, 0, 0] }), rng: () => 0.2 });
  const near = [player(0, 20)];
  pan.tick(near);
  while (pan.state === 'emerge') pan.tick(near);
  let n = 0;
  while (pan.state === 'walk' && n++ < 200) pan.tick(near);
  eq(pan.state, 'shock', 'walk 1 ends in the shockwave');
  while (pan.state === 'shock') pan.tick(near, true);
  n = 0;
  while (pan.state === 'walk' && n++ < 200) pan.tick(near);
  eq(pan.state, 'bolt', 'walk 2 (side 0) ends in the bolt');
  const kinds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const r = pan.tick(near, true);
    for (const s of (r.shots ?? []) as PanArmsShot[]) kinds.push(s.kind);
  }
  eq(kinds, ['bolt'], 'one bolt');
  eq(pan.state, 'walk', 'visit 1 (odd): back to walking');
}

// The split: HP <= a third, the halves walk, merge and the Pan Arms rejoins.
{
  const pan = new PanArmsAi({ x: 0, z: 0, angle: 0, movement: mv({ iparam: [40, 0, 0, 0, 0, 0] }), rng: () => 0.2 });
  const hid = new PanHalfAi('hidoom', { x: 0, z: 0, angle: 0, movement: mv({ fparam2: 40 }), restaLevel: 4, rng: () => 0.9 });
  const mig = new PanHalfAi('migium', { x: 0, z: 0, angle: 0, movement: mv({ fparam2: 1, iparam: [0, 7, 0, 0, 0, 0] }), rng: () => 0.1 });
  hid.sibling = mig;
  mig.sibling = hid;
  pan.halves = [hid, mig];
  check(hid.hidden && hid.invulnerable, 'the halves start hidden and untargetable');
  const near = [player(0, 20)];
  pan.tick(near);
  while (pan.state === 'emerge') pan.tick(near);
  pan.hpFraction = 0.3;
  pan.tick(near);
  eq(pan.state, 'splitting', 'HP <= a third: the split animation');
  pan.tick(near, true);
  eq(pan.state, 'split', 'then split');
  check(pan.hidden && pan.invulnerable, 'split: the Pan Arms is hidden and untargetable');
  eq(pan.events.map((e) => e.kind), ['emerged', 'split'], 'the owner hears of the split');
  eq([hid.state, mig.state], ['split', 'split'], 'both halves start');
  check(hid.x > 0 && mig.x < 0, 'Hidoom stands right, Migium left');
  const hf = hid.tick(near, true);
  mig.tick(near, true);
  eq([hid.state, mig.state], ['roam', 'roam'], 'they roam after the split animation');
  check(hf.hidden === false && !hid.untargetable, 'a split half is drawn and can be targeted');

  // Hidoom at half its split HP calls; Migium runs to it; Resta at -15.
  hid.hpFraction = 0.5;
  for (let i = 0; i < 80; i++) hid.tick(near);
  eq(hid.state, 'call', 'Hidoom at half HP calls');
  mig.tick([player(500, 500)]);
  eq(mig.state, 'help', 'Migium answers the call');
  let n = 0;
  while (mig.state === 'help' && n++ < 400) mig.tick([player(500, 500)]);
  eq(mig.state, 'touch', 'it reaches Hidoom');
  check(hid.touched, 'Hidoom was touched');
  let heal: unknown = null;
  for (let i = 0; i < HALF.callFrames + 20 && hid.state === 'call'; i++) heal = hid.tick(near).heal ?? heal;
  eq(heal, { level: 4 }, "Hidoom casts Resta at Migium's iparam1 level");

  // Migium's strike: Jellen when rand < fparam2.
  const m2 = new PanHalfAi('migium', { x: 0, z: 0, angle: 0, movement: mv({ fparam2: 1, iparam: [0, 7, 0, 0, 0, 0] }), rng: () => 0.1 });
  m2.start(0, 0, 0);
  m2.tick(near, true);
  // A player 50 ahead: out of 27.5, inside 80 and the arc -> charge, attack.
  const ahead = [player(m2.x + Math.sin(m2.angle) * 50, m2.z + Math.cos(m2.angle) * 50)];
  let buff = null;
  for (let i = 0; i < 300 && !buff; i++) {
    m2.tick(ahead, m2.state === 'attack' && i % 20 === 19);
    buff = m2.buff ?? buff;
  }
  eq(buff, { clientId: 0, tech: 'jellen', level: 7 }, 'Migium casts Jellen (chance fparam2, level iparam2)');

  // The merge: at timer 0 both walk to the point, align, merge.
  const far = [player(2000, 2000)];
  for (let i = 0; i < PAN.splitTimer; i++) {
    pan.tick(far);
    hid.tick(far);
    mig.tick(far);
  }
  check(hid.state === 'mergeWalk' || hid.state === 'align', `the halves walk to the merge point (${hid.state})`);
  n = 0;
  while (pan.state === 'split' && n++ < 3000) {
    pan.tick(far);
    hid.tick(far);
    mig.tick(far);
  }
  eq(pan.state, 'merge', 'both aligned: the merge');
  for (let i = 0; i < PAN.mergeFrames; i++) pan.tick(far);
  eq(pan.state, 'rejoin', 'after 64 frames it rejoins');
  check(hid.hidden && mig.hidden, 'the halves are hidden again');
  eq(pan.events.map((e) => e.kind), ['emerged', 'split', 'merged'], 'the owner hears of the merge');
}

// Both halves dead while split: the set is lost.
{
  const pan = new PanArmsAi({ x: 0, z: 0, angle: 0, movement: mv({ iparam: [40, 0, 0, 0, 0, 0] }), rng: () => 0.2 });
  const hid = new PanHalfAi('hidoom', { x: 0, z: 0, angle: 0, movement: mv() });
  const mig = new PanHalfAi('migium', { x: 0, z: 0, angle: 0, movement: mv() });
  pan.halves = [hid, mig];
  const near = [player(0, 20)];
  pan.tick(near);
  while (pan.state === 'emerge') pan.tick(near);
  pan.hpFraction = 0.2;
  pan.tick(near);
  pan.tick(near, true);
  hid.kill();
  mig.kill();
  pan.tick(near);
  eq(pan.state, 'dead', 'both halves dead: the Pan Arms is gone');
  eq(pan.events.at(-1), { kind: 'lost' }, '6x76 only');
}

// --- Pofuilly Slime ------------------------------------------------------------------
{
  const s = new SlimeAi({ x: 0, z: 0, angle: 0, movement: mv({ fparam1: 12 }), rng: () => 0.5 });
  check(!s.hidden && s.invulnerable && s.radar, 'a puddle is drawn (morph 7), on the radar, and cannot be hit (box off, 0x597b0c)');
  eq(s.motion, { index: PUDDLE_MOTION.normal, speed: 0.5, loop: true }, 'the puddle pose is DAT_009bfda0[0] = motion 4');
  const rareSlime = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, rare: true, rng: () => 0.5 });
  eq(rareSlime.motion?.index, PUDDLE_MOTION.rare, 'a rare puddle uses DAT_009bfda0[1] = motion 5');
  const near = [player(0, 40)];
  let n = 0;
  while (s.state === 'puddle' && n++ < 100) s.tick(near);
  eq(s.state, 'rise', 'a player within 200 raises it');
  for (let i = 0; i < SLIME.riseFrames; i++) s.tick(near);
  eq(s.state, 'crawl', 'risen with a player near: it crawls');
  n = 0;
  while (s.state === 'crawl' && n++ < 500) s.tick(near);
  eq(s.state, 'emerge', 'within 50 of the player: it emerges');
  check(s.invulnerable && s.radar, 'emerge: the box is off (0x597dbc sets 0x28), still on the radar');
  for (let i = 0; i < SLIME.morphFrames; i++) s.tick(near);
  eq(s.state, 'search', 'then it searches');
  check(!s.invulnerable, 'search: the box is on (0x597e7c clears 0x28): it can be hit');
  n = 0;
  while (s.state === 'search' && n++ < 1000) s.tick(near);
  eq(s.state, 'approach', 'a player in the sweep: it approaches');
  n = 0;
  let shot: unknown = null;
  while (n++ < 200 && !shot) shot = s.tick(near).shots?.[0] ?? null;
  check(shot instanceof SlimeSpit || shot instanceof SlimeArm, 'it spits or reaches with an arm');

  s.onDamage(0);
  eq(s.state, 'flinch', 'every hit flinches it (12)');
  check(s.invulnerable, 'flinching: untargetable');
  s.resume();
  eq(s.state, 'burrow', 'the flinch ends in the burrow (5)');
}

// The spit: 0.6 a frame, gravity, a tech hit of fparam1.
{
  const sp = new SlimeSpit(0, 0, 0, 12);
  eq(sp.effect, { kind: 'tech', power: 12 }, 'the spit is a tech hit of fparam1');
  let hit = 0;
  for (let i = 0; i < 400 && !sp.done; i++) hit += sp.tick([player(0, 40)]).length;
  eq(hit, 1, 'it reaches a player 40 away');
  const miss = new SlimeSpit(0, 0, 0, 12);
  let f = 0;
  while (!miss.done && f++ < 1000) miss.tick([]);
  eq(f, Math.round(SPIT.range / SPIT.speed), 'it lives 200 / 0.6 frames');
  const arm = new SlimeArm(0, 0);
  const hits: number[] = [];
  for (let i = 1; i <= 45; i++) if (arm.tick([player(0, 2)]).length) hits.push(i);
  eq(hits, [17], 'the arm hits once, from frame 17');
}

// The arm's hit (0x00598f1c): the nearest player within 25, hit when it is not
// the lock, within 5 in height and 7.5 in XZ; the hit sets the lock. Frames 17..30.
{
  const armAt = (frame: number, y = 0) => {
    const a = new SlimeArm(0, 0, y);
    for (let i = 1; i < frame; i++) a.tick([]);
    return a;
  };
  const a1 = armAt(17);
  eq(a1.tick([player(0, 8, 1)]).length, 0, 'a player 8 away is out of the 7.5 reach');
  eq(a1.tick([player(0, 7, 2)]).map((t) => t.clientId), [2], 'at 7 the frame-18 hit lands');
  const a2 = armAt(17);
  eq(a2.tick([player(0, 1, 3, 20)]).length, 0, 'a player 20 above is out of the height window');
  eq(a2.tick([player(0, 1, 3, 0)]).map((t) => t.clientId), [3], 'the same player level with the arm hits');
  // The lock: the nearest player is hit once; a different nearest one is hit, and the first again after it.
  const a3 = armAt(17);
  const seq = [
    a3.tick([player(0, 2, 7)]).map((t) => t.clientId),
    a3.tick([player(0, 2, 7)]).map((t) => t.clientId),
    a3.tick([player(0, 2, 7), player(0, 1, 8)]).map((t) => t.clientId),
    a3.tick([player(0, 2, 7)]).map((t) => t.clientId),
  ];
  eq(seq, [[7], [], [8], [7]], 'a player is hit once per change of the lock id');
  const far = armAt(17);
  eq(far.tick([player(0, 26, 4)]).length, 0, 'the nearest player beyond 25 is not in range');
  eq(armAt(31).tick([player(0, 1, 5)]).length, 0, 'nothing after frame 30');
}

// The death fade (0x00597594): the death entry (0x00598648) sets the scale to 1 and
// the counter to 5; the alpha drops 0.2 a frame (floored at 0) and the slime is
// removed when the counter is spent, on the 5th frame.
{
  const s = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, rng: () => 0.5 });
  (s as unknown as { xf: { alpha: number } }).xf.alpha = 1;
  s.kill();
  eq(s.view.morph, SLIME_MORPH.dead, 'the death pose (morph 5)');
  eq([s.view.sx, s.view.sy, s.view.sz], [1, 1, 1], 'the death entry sets the scale to 1');
  const alphas: number[] = [];
  let removed = -1;
  for (let i = 1; i <= 5; i++) {
    if (s.stepDeathFade() && removed < 0) removed = i;
    alphas.push(Math.round(s.view.alpha * 10) / 10);
  }
  eq(alphas, [0.8, 0.6, 0.4, 0.2, 0], 'the alpha drops 0.2 a frame to 0');
  eq(removed, 5, 'removed on the 5th frame');
}

// The control: four slots at most, never reused.
{
  const c = new SlimeControl({ x: 0, z: 0, angle: 0, numChildren: 0 });
  eq(c.slots.length, 4, 'num_children 0 means 4');
  eq([c.take(), c.take()], [0, 1], 'slots are taken in order');
  c.died(0);
  eq(c.take(), 2, 'a dead slot is not reused');
  eq(c.take(), 3, 'the fourth slime');
  eq(c.take(), -1, 'no fifth slime');
  check(!c.finished, 'slimes 1-3 still live');
  for (const k of [1, 2, 3]) c.died(k);
  check(c.finished, 'all dead: the set is cleared');
  eq(new SlimeControl({ x: 0, z: 0, angle: 0, numChildren: 2 }).slots.length, 2, 'num_children 2 caps it at 2');
  const t = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, thrown: true, rng: () => 0.25 });
  eq(t.state, 'thrown', 'a split copy is thrown (14)');
  let n = 0;
  while (t.state === 'thrown' && n++ < 100) t.tick([]);
  eq(t.state, 'rise', 'it lands and rises (1)');
}

// --- Pofuilly Slime: the body transform (SLIME_XF, 0x00596264 / 0x0059670c / 0x00596884) ---
{
  const near = [player(0, 40)];
  const near5 = (v: number, want: number, what: string) => check(Math.abs(v - want) < 1e-6, `${what}: ${v} != ${want}`);
  const fresh = () => new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, rng: () => 0.5 });

  // The puddle (0x00597b0c) is not drawn: alpha 0 (the body draw returns at alpha <= 0).
  const p = fresh();
  near5(p.view.alpha, 0, 'puddle: alpha 0');
  near5(p.view.height, -2.5, 'puddle: height -2.5');
  near5(p.view.sx + p.view.sy + p.view.sz, 0, 'puddle: scale 0');
  eq(p.view.morph, 7, 'puddle: morph 7');
  check(!p.view.tail, 'puddle: no tail');

  // The thrown entry (0x00598740) is the same: alpha 0, scale 0.
  const th = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, thrown: true, rng: () => 0.5 });
  eq(th.state, 'thrown', 'thrown: state 14');
  near5(th.view.alpha, 0, 'thrown: alpha 0');
  near5(th.view.sx + th.view.sy + th.view.sz, 0, 'thrown: scale 0');

  // Rise: the first frame (count 0, t 0): alpha 0, height -2.5, scale 2.5 / 0 / 2.5.
  const r = fresh();
  let n = 0;
  while (r.state === 'puddle' && n++ < 100) r.tick(near);
  eq(r.state, 'rise', 'rise: the puddle rose');
  r.tick(near);
  near5(r.view.alpha, 0, 'rise frame 0: alpha 0');
  near5(r.view.height, -2.5, 'rise frame 0: height -2.5');
  near5(r.view.sx, 2.5, 'rise frame 0: sx 2.5');
  near5(r.view.sz, 2.5, 'rise frame 0: sz 2.5');
  near5(r.view.sy, 0, 'rise frame 0: sy 0');
  // Frame 5 (count 4, sin(0x4000) = 1, t = 4/30, f = 1): w = 0.1, sx = 2.3 * 1.1, sz = 2.3 * 0.9.
  for (let i = 0; i < 4; i++) r.tick(near);
  const t5 = 4 / 30;
  near5(r.view.sy, t5, 'rise frame 4: sy = t');
  near5(r.view.alpha, 2 * t5, 'rise frame 4: alpha 2t');
  near5(r.view.height, -2.5 * (1 - t5), 'rise frame 4: height -2.5 (1 - t)');
  near5(r.view.sx, (2.5 - 1.5 * t5) * 1.1, 'rise frame 4: sx = (2.5 - 1.5t)(1 + 0.1 sin)');
  near5(r.view.sz, (2.5 - 1.5 * t5) * 0.9, 'rise frame 4: sz = (2.5 - 1.5t)(1 - 0.1 sin)');

  // Sink (0x00596884): after the rise with nobody near, the sink starts at t = 1
  // (height 0, alpha 1) and its frame 70 (count 99, t = 1 - 69/90) has the sink wobble.
  const s = fresh();
  n = 0;
  while (s.state === 'puddle' && n++ < 100) s.tick(near);
  n = 0;
  while (s.state === 'rise' && n++ < 100) s.tick([]);
  eq(s.state, 'sink', 'sink: a risen slime with nobody near sinks');
  s.tick([]);
  near5(s.view.sx, 1, 'sink frame 0: t = 1, sx 1');
  near5(s.view.alpha, 1, 'sink frame 0: alpha 1');
  near5(s.view.height, 0, 'sink frame 0: height 0');
  for (let i = 1; i < 70; i++) s.tick([]);
  eq(s.state, 'sink', 'sink: still sinking at frame 70');
  const tk = 1 - 69 / 90;
  near5(s.view.alpha, 2 * tk, 'sink frame 69: alpha 2t');
  near5(s.view.height, -2.5 * (1 - tk), 'sink frame 69: height');
  near5(s.view.sy, tk, 'sink frame 69: sy = t');
  // count 99 << 12 = 0x3000 (3/16 of a turn): w = 0.15 * sin(67.5 deg).
  const w = 0.15 * Math.sin((3 * Math.PI) / 8);
  near5(s.view.sx, (2.5 - 1.5 * tk) * (1 + w), 'sink frame 69: sx = z (1 + w)');
  near5(s.view.sz, (2.5 - 1.5 * tk) * (1 - w), 'sink frame 69: sz = z (1 - w)');

  // The crawl (0x00597c3c): drawn at alpha 1, morph 8, no tail; the emerge (morph 9) has the tail.
  const c = fresh();
  n = 0;
  while (c.state === 'puddle' && n++ < 100) c.tick(near);
  n = 0;
  while (c.state === 'rise' && n++ < 100) c.tick(near);
  eq(c.state, 'crawl', 'crawl: a risen slime with a player near crawls');
  near5(c.view.alpha, 1, 'crawl: alpha 1');
  eq(c.view.morph, 8, 'crawl: morph 8');
  check(!c.view.tail, 'crawl: one model, no tail');
  n = 0;
  while (c.state === 'crawl' && n++ < 500) c.tick(near);
  eq(c.state, 'emerge', 'emerge: within 50');
  eq(c.view.morph, 9, 'emerge: morph 9');
  check(c.view.tail, 'emerge: the body and the tail are drawn (forms 9..11)');

  // A flinch (0x005985c4) sets the scale to 1 and the morph to 5; the alpha stays.
  const f = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, thrown: true, rng: () => 0.5 });
  f.onDamage(0);
  eq(f.state, 'flinch', 'flinch: state 12');
  near5(f.view.sx + f.view.sy + f.view.sz, 3, 'flinch: scale 1');
  eq(f.view.morph, 5, 'flinch: morph 5');
  near5(f.view.alpha, 0, 'flinch: the alpha is kept');
}

// --- Pofuilly Slime's state 11 (stun) -------------------------------------------------
// The writer (PsoBB.exe 0x00597ae4, the slime's vtable slot +0xfc, reached from the
// generic enemy path 0x00543efb): unless the slime is in state 11 it sets +0x38c = 11,
// clears +0x30 & 0x100 and enters 11 (0x0059856c: scale 1, counter 0, morph 4). Its
// update (0x00597514) counts a frame; when the motion has ended it goes to confused
// (+0x30 & 0x10, state 7) or search (state 6).
{
  const st = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, thrown: true, rng: () => 0.5 });
  const pf = (st as unknown as { frame(): AiFrame }).frame();
  st.pendingHit(pf);
  eq(st.state, 'stun', 'pendingHit enters state 11');
  eq(st.view.morph, SLIME_MORPH.stun, 'stun: morph 4');
  check(Math.abs(st.view.sx + st.view.sy + st.view.sz - 3) < 1e-5, 'stun: scale 1');
  st.pendingHit(pf);
  eq(st.state, 'stun', 'pendingHit in state 11 changes nothing');
  for (let i = 0; i < 5; i++) st.tick([], false);
  eq(st.state, 'stun', 'stun holds while its motion runs');
  st.tick([], true);
  eq(st.state, 'search', 'stun ends at the motion end: search (6) when not confused');
  const sc = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, thrown: true, rng: () => 0.5 });
  sc.pendingHit(pf);
  sc.confused = true;
  sc.tick([], true);
  eq(sc.state, 'confused', 'stun ends at the motion end: confused (7) when +0x30 has 0x10');
  // The effect 0xe0 is made on every 4th count (0x00597514: the count goes up, then
  // testb $3): counts 4, 8, ... make it, the others do not.
  const ef = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, thrown: true, rng: () => 0.5 });
  ef.pendingHit(pf);
  const made: number[] = [];
  for (let i = 1; i <= 12; i++) {
    ef.tick([], false);
    if (ef.effects.length) made.push(i);
    ef.effects.splice(0);
  }
  eq(made.join(','), '4,8,12', 'stun: effect 0xe0 on every 4th count');
  eq(ef.effects.length, 0, 'the effects are taken by the owner');
  // hitNoDamage: the no-damage hit enters state 11 and returns the motion to play; a
  // second one in state 11 returns nothing (pendingHit changes nothing there).
  const hn = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, thrown: true, rng: () => 0.5 });
  const m1 = hn.hitNoDamage();
  eq(hn.state, 'stun', 'hitNoDamage enters state 11');
  check(m1 !== null, 'hitNoDamage returns the stun motion');
  eq(hn.hitNoDamage(), null, 'hitNoDamage in state 11 returns no motion');
  eq(hn.hits, 0, 'a no-damage hit is not counted as a landed hit');
}

// --- Pofuilly Slime's crawl frame (0x005969cc) ----------------------------------------
{
  // A risen slime with a player 100 ahead: the entry (0x00597c3c) aims at the player
  // (the random 15 push at angle ~0 leaves the direction along +z).
  const toCrawl = (opts: { ground?: (x: number, z: number, fromY: number) => number | null; wall?: () => boolean }) => {
    const s = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, rng: () => 0.5, ...opts });
    const near = [player(0, 100)];
    let n = 0;
    while (s.state === 'puddle' && n++ < 100) s.tick(near);
    for (let i = 0; i < SLIME.riseFrames; i++) s.tick(near);
    eq(s.state, 'crawl', 'crawl: entered after the rise');
    return s;
  };
  const near = [player(0, 100)];

  // Flat open ground: the first trial commits, so the body moves along the direction.
  const flat = toCrawl({});
  flat.tick(near);
  check(flat.z > 0 && Math.abs(flat.x) < 1e-2, `crawl: flat ground moves it along +z (${flat.x}, ${flat.z})`);
  eq(flat.lift, 0, 'crawl: flat ground keeps the lift at 0');

  // No wall and no floor: no trial commits, so the body stays put (the frame does not move it).
  const noFloor = toCrawl({ ground: () => null });
  noFloor.tick(near);
  eq([noFloor.x, noFloor.z], [0, 0], 'crawl: no floor under any trial: no move');
  eq(noFloor.state, 'crawl', 'crawl: no floor does not end the crawl');

  // A wall on every segment: nothing commits, the body stays and the crawl goes on.
  const walled = toCrawl({ wall: () => true });
  walled.tick(near);
  eq([walled.x, walled.z], [0, 0], 'crawl: a wall on every trial: no move');
  eq(walled.state, 'crawl', 'crawl: a blocked frame does not end the crawl (0x596bda)');

  // The floor 4 below: the height moves half way (y = -2) and the lift is the gap to the floor, 2.
  const low = toCrawl({ ground: () => -4 });
  low.tick(near);
  check(low.z > 0, 'crawl: a lower floor still moves it');
  check(Math.abs(low.lift - 2) < 1e-9, `crawl: the height moves half way to the floor (lift ${low.lift})`);
}

// --- Pofuilly Slime's arm walk (0x00598070) and the arm's branch B (0x00598f1c) ----------
{
  type Walker = { armWalk(out: AiFrame, t: AiTarget): void; frame(): AiFrame };
  const walker = (opts: { ground?: (x: number, z: number, fromY: number) => number | null; wall?: () => boolean }) =>
    new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, rng: () => 0.5, ...opts }) as unknown as Walker & SlimeAi;
  const target = player(0, 30, 2);

  // Flat open ground: the walk completes and the arm is made at the point (target + 2.5..7.5 away).
  const ok = walker({});
  const okOut = ok.frame();
  ok.armWalk(okOut, target);
  eq(ok.state, 'arm', 'arm walk: a clear walk makes the arm');
  const shot = okOut.shots?.[0];
  check(shot instanceof SlimeArm, 'arm walk: the arm is a SlimeArm');
  if (shot instanceof SlimeArm) {
    const d = Math.hypot(shot.x - target.x, shot.z - target.z);
    check(d >= 2.5 - 1e-9 && d <= 7.5 + 1e-9, `arm walk: the arm point is 2.5..7.5 from the target (${d})`);
  }

  // A wall on the way: the first probe fails and the slime spits instead (state 9).
  const walled = walker({ wall: () => true });
  const walledOut = walled.frame();
  walled.armWalk(walledOut, target);
  eq(walled.state, 'spit', 'arm walk: a wall on the way: the slime spits (state 9)');
  check(!walledOut.shots?.some((s) => s instanceof SlimeArm), 'arm walk: no arm when blocked');

  // No floor under the walk: the same fallback.
  const holed = walker({ ground: () => null });
  holed.armWalk(holed.frame(), target);
  eq(holed.state, 'spit', 'arm walk: no floor: spit');

  // Branch B: the closest other enemy within 7.5 of the arm is hit every frame of the window.
  const arm = new SlimeArm(0, 0, 0);
  const mon = { clientId: 0x1000 | 3, x: 5, z: 0, charClass: -1, dead: false };
  for (let i = 1; i <= 16; i++) arm.tick([], [mon]);
  const hitsB = arm.tick([], [mon]); // frame 17
  eq(hitsB.map((t) => t.clientId), [0x1003], 'arm: an enemy 5 away is hit (branch B) from frame 17');
  eq(new SlimeArm(0, 0, 0).tick([], [{ ...mon, x: 9 }]).length, 0, 'arm: an enemy 9 away (over 7.5) is not hit');
  const armFar = new SlimeArm(0, 0, 0);
  for (let i = 1; i <= 16; i++) armFar.tick([], []);
  eq(armFar.tick([], [{ ...mon, x: 5 }]).length, 1, 'arm: a frame-17 hit on an enemy');
  eq(new SlimeArm(0, 0, 0).tick([], [mon]).length, 0, 'arm: nothing before frame 17');
}

// --- Pofuilly Slime's split gate (0x00597914) and the copy's heading --------------------
{
  // A landed hit by a player on combo step 2 splits a slime that is not flinching.
  check(slimeSplitsOnHit('emerge', 2, 5, true, false), 'split: a landed step-2 hit on an emerged slime');
  check(slimeSplitsOnHit('puddle', 2, 5, true, false), 'split: the gate tests only flinch and death, not the puddle');
  check(!slimeSplitsOnHit('flinch', 2, 5, true, false), 'split: no split while flinching (state 12)');
  check(!slimeSplitsOnHit('emerge', 1, 5, true, false), 'split: combo step 1 does not split');
  check(!slimeSplitsOnHit('emerge', 0, 5, true, false), 'split: combo step 0 does not split');
  check(!slimeSplitsOnHit('emerge', undefined, 5, true, false), 'split: no attacker strike, no split');
  check(!slimeSplitsOnHit('emerge', 2, 0, true, false), 'split: a hit that does no damage does not split');
  check(!slimeSplitsOnHit('emerge', 2, 5, false, false), 'split: a hit that is not the local player does not split');
  check(!slimeSplitsOnHit('emerge', 2, 5, true, true), 'split: a killing hit does not split (the is_dead branch)');
  // The copy is thrown with the exe's heading: vx = sin, vz = cos of it.
  const t = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, thrown: true, throwAngle: Math.PI / 2, rng: () => 0.5 });
  eq(t.state, 'thrown', 'a split copy starts thrown (state 14)');
  t.tick([]);
  check(Math.abs(t.x - 1) < 1e-9 && Math.abs(t.z) < 1e-9, `the copy moves along (sin, cos) of its heading: ${t.x}, ${t.z}`);
}

// --- Pan Arms: the radar, the lock-on and the hit, per state ----------------------------
// DerolleUpdateStateTransition (PsoBB.exe 0x00580b2c, Ephinea 1.25.13): the radar icon while
// the state is nonzero and (+0x3e4 set and state != 4, or state 1); enable_reticle while
// +0x3e4 is set. +0x3e4 is written by the entries of 2 (emerge, 0x583cf8) and 12 (rejoin,
// 0x5835ac) as 1, and of 10 (split, 0x583720) and 11 (merge, 0x583648) as 0; the other
// entries keep it. The exe's state 4 is ASSUMED to be the death. The hit is NOT proven (the
// family never calls SetEnemyInvulnerableAndImmune): the port's old rule stays, ASSUMED.
{
  const ALL: PanState[] = ['buried', 'emerge', 'walk', 'shock', 'bolt', 'spin', 'splitting', 'split', 'merge', 'rejoin', 'dead'];
  const out = {} as AiFrame;
  const fresh = (s: PanState, lockable: boolean) => {
    const pan = new PanArmsAi({ x: 0, z: 0, angle: 0, movement: null, rng: () => 0.5 });
    (pan as unknown as { state: PanState }).state = s;
    pan.lockable = lockable;
    return pan;
  };
  // Per state, the flag the entry leaves: a fresh sticky value (true and false) is checked
  // by the radar and the reticle rules.
  for (const s of ALL) {
    for (const lk of [true, false]) {
      const pan = fresh(s, lk);
      const radar = s === 'buried' || (lk && s !== 'dead');
      eq(pan.radar, radar, `Pan Arms radar in ${s} (lock flag ${lk})`);
      eq(pan.lockOn, lk, `Pan Arms reticle in ${s} (lock flag ${lk}): enable_reticle only while +0x3e4 is set`);
      eq(splitRadarOk({ ai: pan }), radar, `splitRadarOk in ${s} (lock flag ${lk})`);
      eq(splitLockOk({ ai: pan }), lk, `splitLockOk in ${s} (lock flag ${lk})`);
      eq(splitStruckOk({ ai: pan }), !pan.invulnerable, `splitStruckOk in ${s} (lock flag ${lk}): the ASSUMED hit rule`);
    }
  }
  // The entries: emerge and rejoin set the flag, split and merge clear it, the rest keep it.
  const pan = new PanArmsAi({ x: 0, z: 0, angle: 0, movement: null, rng: () => 0.5 });
  const enter = (s: PanState) => (pan as unknown as { enter(o: AiFrame, s: PanState): void }).enter(out, s);
  eq(pan.lockable, false, 'a new Pan Arms is not lockable (ASSUMED: the ctor is not traced)');
  enter('emerge');
  eq([pan.lockable, pan.radar], [true, true], 'emerge: lockable and on the radar');
  for (const s of ['walk', 'shock', 'bolt', 'spin', 'splitting'] as PanState[]) {
    enter(s);
    eq([pan.lockable, pan.radar], [true, true], `${s}: the flag is kept (sticky), on the radar`);
  }
  enter('split');
  eq([pan.lockable, pan.radar, pan.lockOn], [false, false, false], 'split: the flag is cleared, off the radar, not locked on');
  enter('merge');
  eq([pan.lockable, pan.radar], [false, false], 'merge: the flag stays clear, off the radar');
  enter('rejoin');
  eq([pan.lockable, pan.radar, pan.lockOn], [true, true, true], 'rejoin: the flag is set again, on the radar, locked on');
  enter('buried');
  eq([pan.lockable, pan.radar], [true, true], 'buried after a rejoin walk keeps the flag and the radar');
  eq(splitStruckOk({ ai: pan }), false, 'buried: not struck (the ASSUMED hit rule: the box is off)');
}

// --- Pofuilly Slime's +0x3f4 (lockable) and the stun motion (animation 4) ----------------
// The entries write +0x3f4 = 1 in states 6..11 and 0 in 0..5, 12, 13, 14 (PsoBB.exe
// 0x597e7c .. 0x5987c8). SinowzoaUpdate calls enable_reticle only while it is nonzero, so
// `lockable` is that set. The stun's entry 0x0059856c loads animation 4: row 4 of the motion
// table 0x009bfc80 (mode 3, motion 8, speed 0.8), the only entry that loads slot 4.
{
  const LOCKABLE = ['search', 'confused', 'approach', 'spit', 'arm', 'stun'];
  const ALL = ['puddle', 'rise', 'sink', 'crawl', 'emerge', 'burrow', 'search', 'confused', 'approach', 'spit', 'arm', 'flinch', 'thrown', 'dead', 'stun'];
  for (const s of ALL) {
    const st = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, rng: () => 0.5 });
    (st as unknown as { state: string }).state = s;
    eq(st.lockable, LOCKABLE.includes(s), `lockable (+0x3f4 != 0) in state ${s}`);
  }
  const sl = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, thrown: true, rng: () => 0.5 });
  const pfs = (sl as unknown as { frame(): AiFrame }).frame();
  sl.pendingHit(pfs);
  eq(sl.motion, { index: 8, speed: 0.8, loop: false }, 'stun plays animation 4 = motion 8 at 0.8, once (0x59856c, row 4)');
  eq(sl.view.morph, 4, 'stun: the sub-object form 4');
  check(sl.lockable, 'stun: lockable');
  const fl = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, thrown: true, rng: () => 0.5 });
  fl.hitNoDamage();
  check(fl.lockable === (fl.state === 'stun'), 'a no-damage hit (stun) makes the slime lockable');
}

// --- Pofuilly Slime: the radar, the lock-on and the hit (the exe's rules) ----------------
// The radar icon: SinowzoaUpdate (0x00596104) adds it every frame while field_0x38c != 0xd
// (the death state), whatever the state. The lock-on: enable_reticle runs only while +0x3f4 is
// set (lockable). The hit: the box is on (the 0x28 bits of the sub-object's +0x18 are clear)
// in exactly the lockable states (the entries' writes, DEVLOG 2026-10-25 Pofuilly).
{
  const LOCK = ['search', 'confused', 'approach', 'spit', 'arm', 'stun'];
  const ALL = ['puddle', 'rise', 'sink', 'crawl', 'emerge', 'burrow', 'search', 'confused', 'approach', 'spit', 'arm', 'flinch', 'thrown', 'dead', 'stun'];
  for (const st of ALL) {
    const sl = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, rng: () => 0.5 });
    (sl as unknown as { state: string }).state = st;
    const e = { ai: sl };
    eq(splitRadarOk(e), st !== 'dead', `radar in ${st}: every frame but the dead one`);
    eq(splitLockOk(e), LOCK.includes(st), `lock-on in ${st}: only through the reticle records (+0x3f4)`);
    eq(splitStruckOk(e), LOCK.includes(st), `hit in ${st}: only while the box is on`);
    eq(sl.invulnerable, !LOCK.includes(st), `invulnerable (box off) in ${st}`);
  }
  eq(splitRadarOk({ ai: null }), true, 'a non-slime enemy is not gated by the slime rules (radar)');
  eq(splitLockOk({ ai: null }), true, 'a non-slime enemy is not gated by the slime rules (lock)');
  eq(splitStruckOk({ ai: null }), true, 'a non-slime enemy is not gated by the slime rules (hit)');
  const killed = new SlimeAi({ x: 0, z: 0, angle: 0, movement: null, rng: () => 0.5 });
  killed.onDamage(0);
  eq(killed.state, 'flinch', 'a hit flinches it');
  check(!splitStruckOk({ ai: killed }), 'a flinching slime is not struck');
  check(splitRadarOk({ ai: killed }), 'a flinching slime is on the radar');
}

// --- Hidoom / Migium: the radar, the lock-on and the hit (FUN_00583eb0 and the state entries) ---
// The radar icon: state != 0, +0x38c set and state != 7 (0x583fb3, 0x58407d). The lock-on
// (enable_reticle, 0x7aa094): state != 0 and +0x38c set. The hit: bit 0 of the box (+0x384 / +0x18),
// written by each state's entry (0x9bf580 table) and cleared by the update's tail while the
// timer flag (+0x390) is 0. The entries' rows are in HALF_ENTRY (combat/enemysplits.ts).
{
  const setState = (h: PanHalfAi, s: string) => (h as unknown as { setState(x: string): void }).setState(s);
  const half = (kind: 'hidoom' | 'migium' = 'hidoom') => new PanHalfAi(kind, { x: 0, z: 0, angle: 0, movement: mv({ fparam2: 0.5, fparam3: 0.5 }), restaLevel: 0, rng: () => 0.5 });
  const EXPECT: Record<string, [boolean, boolean, boolean]> = {
    // [radar, lock-on, struck] after the entry, from a half that already has its lock flag set
    split: [true, true, false],
    roam: [true, true, true],
    mergeWalk: [true, true, true],
    align: [true, true, true],
    merging: [true, true, false],
    charge: [true, true, true],
    backoff: [true, true, true],
    attack: [true, true, true],
    call: [true, true, true],
    help: [true, true, true],
    touch: [true, true, true],
    mourn: [true, true, true],
  };
  for (const [st, [radar, lock, struck]] of Object.entries(EXPECT)) {
    const h = half();
    setState(h, 'split');
    setState(h, 'roam');
    setState(h, st);
    eq(splitRadarOk({ ai: h }), radar, `Hidoom radar in ${st} (+0x38c set, state != 7)`);
    eq(splitLockOk({ ai: h }), lock, `Hidoom lock-on in ${st} (enable_reticle gate)`);
    eq(splitStruckOk({ ai: h }), struck, `Hidoom hit in ${st} (box bit 0, the entry's write)`);
  }
  // Hidden (state 0): nothing is drawn on the radar, locked or struck, whatever came before.
  {
    const h = half();
    setState(h, 'split');
    setState(h, 'hidden');
    eq([splitRadarOk({ ai: h }), splitLockOk({ ai: h }), splitStruckOk({ ai: h })], [false, false, false], 'Hidoom hidden: no radar, no lock, no hit');
    check(h.untargetable && h.hidden, 'Hidoom hidden: untargetable');
  }
  // The death (state 7): off the radar and not struck once the update has run; the reticle
  // gate stays on (the combat code drops a dead half from the lock-on list by e.dead).
  {
    const h = half();
    setState(h, 'split');
    setState(h, 'roam');
    h.kill();
    eq(splitRadarOk({ ai: h }), false, 'Hidoom dead: off the radar');
    eq(splitLockOk({ ai: h }), true, 'Hidoom dead: the reticle gate is on (+0x38c), the dead are dropped by the caller');
    h.tick([]);
    eq(splitStruckOk({ ai: h }), false, 'Hidoom dead: the update clears the box (+0x390 = 0)');
  }
  // The lock flag is sticky: a half that never split (+0x38c clear) is off the radar in a walk,
  // and its box is cleared by the update's tail (+0x390 clear) once it ticks.
  {
    const h = half('migium');
    h.mergeAt(100, 0, 0); // far from the merge point, so the walk does not end on this tick
    eq([splitRadarOk({ ai: h }), splitLockOk({ ai: h }), splitStruckOk({ ai: h })], [false, false, true], 'mergeWalk without the lock flag: no radar, no lock, struck (box set by the entry)');
    h.tick([]);
    eq(h.state, 'mergeWalk', 'still walking after the tick');
    eq(splitStruckOk({ ai: h }), false, 'mergeWalk without the timer flag: the tail clears the box');
  }
}

// Gibbles through the same predicates (render/combat.ts splitRadarOk / splitLockOk / splitStruckOk):
// the icon, the reticle and the box bit of each state (enemyfsmep2a.ts setGate / enterBox).
{
  const gib = (state: GibblesState, box: boolean, targetId: number | null) => {
    const g = new GibblesAi({ x: 0, z: 0, angle: 0, params: [0, 0, 0, 0], attacks: [], movement: null, rng: () => 0.9 });
    g.state = state;
    Object.assign(g as unknown as { busy: boolean; boxOn: boolean; targetId: number | null }, { busy: true, boxOn: box, targetId });
    g.tick([{ clientId: 0, x: 0, z: 100, charClass: 0, dead: false, angle: 0 }], false);
    return { ai: g };
  };
  const rows: Array<[GibblesState, boolean, boolean, boolean]> = [
    // state, radar, lock, struck (the box after the handler ran: dormant and arrive clear it, the others keep or set it)
    ['dormant', false, false, false],
    ['arrive', true, true, false],
    ['approach', true, true, true],
    ['combo', true, true, true],
    ['rage', true, true, true],
    ['guard', true, true, true],
    ['stagger', true, true, true],
  ];
  for (const [s, radar, lock, struck] of rows) {
    const e = gib(s, true, 0);
    eq([splitRadarOk(e), splitLockOk(e), splitStruckOk(e)], [radar, lock, struck], `Gibbles ${s}: radar / lock-on / hit (exe 0-8)`);
  }
  const off = gib('combo', false, 0);
  eq(splitStruckOk(off), true, 'Gibbles combo: the entry sets the box, so it is struck');
  const noTarget = gib('approach', false, null);
  eq([splitRadarOk(noTarget), splitLockOk(noTarget)], [false, false], 'Gibbles approach without a target: no radar, no lock-on (exe 3 gate)');
  const dead = new GibblesAi({ x: 0, z: 0, angle: 0, params: [0, 0, 0, 0], attacks: [], movement: null, rng: () => 0.9 });
  dead.kill();
  eq([splitRadarOk({ ai: dead }), splitLockOk({ ai: dead })], [false, true], 'Gibbles death: no radar, lock-on in the windup');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemysplits: all checks passed');
