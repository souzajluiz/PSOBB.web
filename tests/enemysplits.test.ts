// Caves splitters (combat/enemysplits.ts): Pan Arms's emerge / walk /
// shockwave / bolt and its split into Hidoom and Migium (roam, attack, call
// and Resta, merge); the Pofuilly Slime's puddle / rise / crawl cycle, its
// spit and arm, its flinch, and the control's four-slot budget.
// Run: node tests/enemysplits.test.ts
import { HALF, PAN, PAN_BOLT, PAN_WAVE, PanArmsAi, PanArmsShot, PanHalfAi, PUDDLE_MOTION, SLIME, SlimeAi, SlimeArm, SlimeControl, SlimeSpit, SPIT } from '../client/src/combat/enemysplits.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import type { EnemyMovementData } from '../client/src/formats/battleparams.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const player = (x: number, z: number, clientId = 0): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle: 0 });
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
  check(!s.hidden && s.untargetable && s.invulnerable, 'a puddle is drawn (morph 7) and cannot be hit');
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
  check(!s.invulnerable, 'emerged: it can be hit');
  for (let i = 0; i < SLIME.morphFrames; i++) s.tick(near);
  eq(s.state, 'search', 'then it searches');
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

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemysplits: all checks passed');
