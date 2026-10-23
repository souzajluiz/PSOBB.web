// Episode 2 FSMs, part d (combat/enemyfsmep2d.ts): the Morfos, the Recobox and
// its Recons, the Epsilon and its Epsigards.
// Run: node tests/enemyfsmep2d.test.ts
import {
  EPSILON,
  EPSILON_ELEMENT_GROUPS,
  EPSILON_ELEMENT_SPECIALS,
  EPSILON_PATTERNS,
  EpsilonAi,
  EpsigardAi,
  FadeEffect,
  MORFOS,
  MorfosAi,
  MorfosBolt,
  RECON,
  ReconAi,
  ReconBomb,
  RecoboxAi,
  bamsOf,
  derolleTiltX,
  epsilonTint,
  sweepPasses,
} from '../client/src/combat/enemyfsmep2d.ts';
import type { AiFrame, AiTarget, EnemyBrain } from '../client/src/combat/enemyai.ts';
import type { EnemyShot } from '../client/src/combat/enemyshots.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-3) => check(Math.abs(a - b) <= eps, `${what}: ${a} != ${b}`);
const player = (x: number, z: number, clientId = 0): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle: 0 });
const atk = (distanceX: number, angle = 0x2000, distanceY = 0) => ({ minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX, angle, distanceY });

// The owner's side: reports the end of a one-shot motion after `len` frames
// of it, plays the flinch when flinches() says so and resumes it.
interface Rig {
  ai: EnemyBrain & { flinches?: (d: number, m: number) => boolean };
  frames: number;
  last: unknown;
  shots: EnemyShot[];
}
function rig(ai: Rig['ai']): Rig {
  return { ai, frames: 0, last: null, shots: [] };
}
function step(r: Rig, targets: AiTarget[], len = 30): AiFrame {
  const m = r.ai.motion;
  if (m !== r.last) {
    r.last = m;
    r.frames = 0;
  }
  const ended = !!m && !m.loop && r.frames >= len;
  const f = r.ai.tick(targets, ended);
  r.frames++;
  if (f.shots) r.shots.push(...f.shots);
  return f;
}
function run(r: Rig, targets: AiTarget[], n: number, len = 30, each?: (f: AiFrame, i: number) => void): void {
  for (let i = 0; i < n; i++) {
    const f = step(r, targets, len);
    each?.(f, i);
  }
}
// The Epsilon with its four Epsigards, each ticked like its own runtime.
function runGroup(e: EpsilonAi, rigs: Rig[], targets: AiTarget[], n: number, len = 30, each?: (f: AiFrame, i: number) => void): void {
  for (let i = 0; i < n; i++) {
    const f = step(rigs[0], targets, len);
    for (let k = 1; k < rigs.length; k++) step(rigs[k], targets, len);
    each?.(f, i);
  }
  void e;
}
const groupRigs = (e: EpsilonAi): Rig[] => [rig(e), ...e.children.map((c) => rig(c))];

// Plays a flinch like the owner: motion for `len` frames, then resume().
function hit(r: Rig, targets: AiTarget[], attacker: number, len = 20): boolean {
  r.ai.onDamage(attacker);
  const f = r.ai.flinches?.(10, 100) ?? true;
  if (!f) return false;
  for (let i = 0; i < len; i++);
  r.ai.resume();
  r.last = null;
  void targets;
  return true;
}

// --- helpers --------------------------------------------------------------------
{
  eq(bamsOf(0, 1), 0, 'bamsOf: +z is 0');
  eq(bamsOf(1, 0), 0x4000, 'bamsOf: +x is a quarter turn');
  eq(bamsOf(0, -1), 0x8000, 'bamsOf: -z is a half turn');
  check(sweepPasses(10, 20, 15) && !sweepPasses(10, 20, 25) && sweepPasses(0xfff0, 0x10, 0) && !sweepPasses(0xfff0, 0x10, 0x8000), 'CheckUShortRange: 16-bit sweep');
  // The effect objects: 0.2 a step in float32, +20 * 0.2 = 30 steps, +30 = 40.
  const a = new FadeEffect();
  a.start(30);
  let n = 0;
  while (!a.up()) n++;
  check(n + 1 >= 40 && n + 1 <= 41, `the 0x00b069b0 object takes 40 steps (${n + 1})`);
  const b = new FadeEffect();
  b.full();
  n = 0;
  while (!b.down()) n++;
  check(n + 1 >= 10 && n + 1 <= 11, `the fade-out takes 10 steps (${n + 1})`);
}

// --- Morfos ---------------------------------------------------------------------
const mv = (o: Partial<{ f1: number; f2: number; i: number[] }> = {}) => ({
  fparam1: o.f1 ?? 7,
  fparam2: o.f2 ?? 360,
  fparam3: 0,
  fparam4: 0,
  fparam5: 0,
  fparam6: 0,
  iparam: o.i ?? [500, 3000, 60, 60, 2000, 0],
});
const morfos = (o: { params?: number[]; rng?: () => number; difficulty?: number; movement?: ReturnType<typeof mv> } = {}) =>
  new MorfosAi({ x: 0, z: 0, angle: 0, params: o.params ?? [0, 0, 0, 0, 0, 0], movement: o.movement ?? mv(), attack: atk(32, 6784), difficulty: o.difficulty ?? 0, rng: o.rng ?? (() => 0.9) });
{
  const m = morfos();
  const r = rig(m);
  eq(m.state, 'start', 'Morfos starts in state 0');
  step(r, []);
  eq(m.state, 'appear', 'the first frame -> 1 (appear)');
  check(!step(r, []).hidden, 'visible while it appears');
  // 30 / 40 steps of the effect objects: state 3 after about 41 frames.
  let t = 0;
  while (m.state === 'appear' && t < 200) {
    step(r, []);
    t++;
  }
  eq(m.state, 'rise', 'the appear effects end -> 3');
  check(t >= 38 && t <= 44, `the appear lasts the 40-step effect (${t})`);
  // No player: it waits for a target before the wall bulge rises.
  run(r, [], 100);
  eq(m.state, 'rise', 'state 3 waits for a target within 400');
  run(r, [player(0, 300)], 120);
  check(m.state === 'walk' || m.state === 'punch' || m.state === 'laser' || m.state === 'search', `with a target: it rises (24 frames) then walks on (${m.state})`);

  // The walk: it turns toward the player and crawls along its heading.
  const w = morfos();
  const rw = rig(w);
  run(rw, [player(0, 300)], 400);
  check(w.z > 5, `it crawls toward the player (${w.z.toFixed(1)})`);
  check(w.state !== 'search', 'it keeps its target');
}
{
  // Param6 >= 1 disables the crawl; param1 / param2 set the step and the leg.
  const c = morfos({ params: [0, 0, 0, 0, 0, 1] });
  const r = rig(c);
  run(r, [player(0, 300)], 400);
  near(Math.hypot(c.x, c.z), 0, 'param6 >= 1: it does not crawl');
  const fast = morfos({ params: [1, 0, 0, 0, 0, 0] });
  const rf = rig(fast);
  run(rf, [player(0, 395)], 330);
  const slow = morfos({ params: [0, 0, 0, 0, 0, 0] });
  const rs = rig(slow);
  run(rs, [player(0, 395)], 330);
  check(Math.hypot(fast.x, fast.z) > Math.hypot(slow.x, slow.z), 'a higher param1 crawls faster');
}
{
  // Within 30 (0x00927638): the punch (rand >= 0.3) with the arm hit at
  // elapsed 8, 5.0 knockback; or the laser (rand < 0.3).
  const m = morfos({ rng: () => 0.9 });
  const r = rig(m);
  const p = player(0, 20);
  let hitF: AiFrame['hit'] = null;
  run(r, [p], 200, 20, (f) => (hitF ??= f.hit));
  check(!!hitF, 'the punch lands');
  eq(hitF && [hitF.knockback, hitF.mult], [MORFOS.punchKnockback, 1], 'try_hit_entity(1.0) + cause_knockback(5.0)');
  // The arm sub-entity (CreateMorfosSubEntity_0057cbc4) is out only during the
  // swing (punch sub 1), never in another state.
  const pm = morfos({ rng: () => 0.9 });
  const rp = rig(pm);
  let armFrames = 0;
  let armOutside = 0;
  run(rp, [player(0, 20)], 200, 20, () => {
    if (pm.armOut) {
      armFrames++;
      if (pm.state !== 'punch') armOutside++;
    }
  });
  check(armFrames > 0, `the arm is out during the punch swing (${armFrames} frames)`);
  eq(armOutside, 0, 'the arm is out only in the punch state');
  const l = morfos({ rng: () => 0.1 });
  const rl = rig(l);
  let bolt: EnemyShot | undefined;
  run(rl, [player(0, 20)], 200, 30, () => {
    bolt ??= rl.shots[0];
  });
  check(bolt instanceof MorfosBolt, 'rand < 0.3: the laser fires a bolt');
  if (bolt) {
    eq(bolt.effect, { kind: 'tech', power: 360 }, 'bolt power = fparam2');
    // The bolt flies straight at fparam1, ends at 500, hits once within 1.5 * speed.
    const target = player(bolt.x, bolt.z + 100);
    let done = 0;
    let hits = 0;
    for (let i = 0; i < 100 && !bolt.done; i++) {
      hits += bolt.tick([target]).length;
      done++;
    }
    check(done <= 80, `the bolt ends (${done} ticks)`);
    check(hits <= 1, 'the bolt hits a player once');
  }
}
{
  // The bolt: 500 range at speed 7.
  const b = new MorfosBolt(0, 0, 0, 7, 10);
  let n = 0;
  while (!b.done && n < 200) {
    b.tick([]);
    n++;
  }
  eq(n, Math.ceil(500 / 7), 'bolt: 500 / 7 ticks');
  const hitter = new MorfosBolt(0, 0, 0, 7, 10);
  hitter.tick([]);
  eq(hitter.tick([player(0, 20)]).length, 1, 'bolt radius 1.5 * speed (10.5) + the player radius');
  const miss = new MorfosBolt(0, 0, 0, 7, 10);
  eq(miss.tick([player(0, 40)]).length, 0, 'a far player is missed');
}
{
  // No target: state 7 after 61 frames, fade out, hidden at the spawn point; a
  // player within 400 brings it back.
  const m = morfos({ rng: () => 0.9 });
  const r = rig(m);
  run(r, [player(0, 300)], 400);
  run(r, [], 300);
  eq(m.state, 'hidden', 'target lost: search, fade out, hidden in the wall (2)');
  check(m.invulnerable, 'hidden: ASSUMED invulnerable');
  check(step(r, []).hidden === true, 'the model is hidden');
  run(r, [player(0, 300)], 50);
  check(m.state === 'appear' || m.state === 'rise' || m.state === 'walk', `a player within 400 wakes it (${m.state})`);
}
{
  // The hit handler: from behind it flinches, from the front it never does.
  const m = morfos();
  const r = rig(m);
  const p = player(0, 300);
  run(r, [p], 120);
  m.hpFraction = 1;
  // The Morfos faces the player (heading toward +z): a hit from the front.
  eq(hit(r, [p], 0), false, 'a hit from the front does not flinch it');
  const behind = player(0, -50, 7);
  run(r, [p, behind], 2);
  m.onDamage(7);
  eq(m.flinches(), true, 'a hit from behind flinches it (state 10)');
  eq(m.state, 'flinch', 'state flinch');
  eq(m.motion?.index, 3, 'the damage animation (row 3, motion 3)');
  const s = m.resume();
  check(s !== 'flinch' && s !== 'dead', `the flinch resumes (${s})`);
}
{
  // Shield: HP <= half and rand <= param3 + 0.1; blocks the front, drops from behind.
  const m = morfos({ params: [0, 0, 0.9, -1, 0, 0], rng: () => 0.5 });
  const r = rig(m);
  const p = player(0, 300);
  run(r, [p], 120);
  m.hpFraction = 0.4;
  m.onDamage(0);
  eq(m.flinches(), false, 'a front hit at half HP does not flinch');
  check(m.shielded, 'the shield is up (rand 0.5 <= 0.9 + 0.1)');
  check(m.guard(0, 300), 'a hit from the front is blocked');
  check(!m.guard(0, -100), 'a hit from behind is not blocked');
  check(!m.shielded, 'and drops the shield');
  const q = morfos({ params: [0, 0, -1, -1, 0, 0], rng: () => 0.5 });
  const rq = rig(q);
  run(rq, [p], 120);
  q.hpFraction = 0.4;
  q.onDamage(0);
  q.flinches();
  check(!q.shielded && q.state !== 'spin', 'chances -1 + 0.1: neither shield nor flee');
}
{
  // Flee: HP <= half and rand <= param4 + 0.1 -> the spin laser (4 shots on
  // Normal, 5 on Ultimate), armoured, then back to the walk. Every motion
  // length from 1 to 120 frames: it never hangs.
  for (const len of [1, 2, 5, 12, 30, 60, 120]) {
    for (const difficulty of [0, 3]) {
      const m = morfos({ params: [0, 0, -1, 0.9, 0, 0], rng: () => 0.5, difficulty });
      const r = rig(m);
      const p = player(0, 300);
      run(r, [p], 120, len);
      m.hpFraction = 0.4;
      m.onDamage(0);
      m.flinches();
      eq(m.state, 'spin', `HP <= half, rand <= 1.0: the spin (len ${len})`);
      let bolts = 0;
      let back = false;
      for (let i = 0; i < 4000 && !back; i++) {
        const f = step(r, [p], len);
        if (f.shots) bolts += f.shots.length;
        if (bolts > 0 && m.state === 'walk') back = true;
      }
      check(back, `the spin ends (len ${len}, difficulty ${difficulty}, ${m.state})`);
      eq(bolts, difficulty === 3 ? 5 : 4, `spin shots (len ${len}, difficulty ${difficulty})`);
    }
  }
}
{
  // Armoured in the spin: a hit from behind does not flinch.
  const m = morfos({ params: [0, 0, -1, 0.9, 0, 0], rng: () => 0.5 });
  const r = rig(m);
  const p = player(0, 300);
  run(r, [p], 120);
  m.hpFraction = 0.4;
  m.onDamage(0);
  m.flinches();
  const behind = player(0, -50, 7);
  run(r, [p, behind], 1);
  m.onDamage(7);
  eq(m.flinches(), false, 'armoured: a hit from behind during the spin does not flinch');
}
{
  // Whole-life run with several motion lengths: the states keep changing.
  for (const len of [1, 3, 8, 30, 90]) {
    const m = morfos({ rng: () => 0.2 });
    const r = rig(m);
    const seen = new Set<string>();
    const p = player(0, 200);
    run(r, [p], 3000, len, () => seen.add(m.state));
    check(seen.has('walk') && (seen.has('punch') || seen.has('laser')), `a long run attacks (len ${len}: ${[...seen].join(',')})`);
    check(m.state !== 'dead', 'alive');
  }
  const m = morfos();
  m.kill();
  eq(m.state, 'dead', 'the brain owns its death');
  eq(m.tick([player(0, 10)]).motion, null, 'a dead Morfos does nothing');
}


{
  // Durations from the exe: the wall bulge rises 0.5 a frame to 12 (24
  // frames), the search waits 61 frames, the fade-out takes 10.
  const m = morfos();
  const r = rig(m);
  const p = player(0, 300);
  let rise = 0;
  let sawRise = false;
  for (let i = 0; i < 400 && m.state !== 'walk'; i++) {
    step(r, [p]);
    if (m.state === 'rise') {
      sawRise = true;
      rise++;
    }
  }
  check(sawRise, 'it passed through state 3');
  // Lose the target: 61 frames of search, then the fade (10 steps) and the teleport home.
  run(r, [p], 40);
  m.x = 50;
  m.z = 80;
  const warps = m.warps;
  let t = 0;
  while (m.state !== 'hidden' && t < 500) {
    step(r, []);
    t++;
  }
  eq(m.state, 'hidden', 'target lost: hidden again');
  check(t >= 70 && t <= 90, `61 frames of search + 10 of fade-out (${t})`);
  check(m.x === 0 && m.z === 0 && m.warps === warps + 1, 'it is back at its spawn point (a warp for the smooth renderer)');
  void rise;
}
{
  // Remote damage: the attacker is a player of the party it can see.
  const m = morfos();
  const r = rig(m);
  const front = player(0, 150, 0);
  const side = player(0, -300, 5);
  run(r, [front], 160);
  eq(m.state, 'walk', 'walking toward the front player');
  step(r, [front, side]);
  m.onDamage(5);
  eq(m.flinches(0, 100), true, 'a remote hit from behind flinches (6x0A from another client)');
  m.resume();
  m.onDamage(99);
  eq(m.flinches(0, 100), false, 'a hit by an unknown attacker never flinches');
}
{
  // Ultimate: it never crawls; it re-aims every frame.
  const m = morfos({ difficulty: 3, movement: mv({ f1: 10, f2: 2100, i: [1500, 6000, 30, 15, 5000, 0] }) });
  const r = rig(m);
  run(r, [player(0, 395)], 600);
  near(Math.hypot(m.x, m.z), 0, 'Ultimate: no crawl');
  check(m.state === 'laser' || m.state === 'walk' || m.state === 'search', `Ultimate engages from the cone (${m.state})`);
}

{
  // The wall bulge (enemy+0x3dc): zeroed at the rise's entry, floor(0.5 k) a
  // frame, 12 at the cap (k = 24) and kept at 12 after the rise (the exit);
  // the arm's stream value is trunc(bulge / 2.0).
  const m = morfos();
  const r = rig(m);
  const p = player(0, 300);
  step(r, [p]);
  step(r, []);
  let t = 0;
  while (m.state !== 'rise' && t < 200) {
    step(r, [p]);
    t++;
  }
  eq(m.state, 'rise', 'the rise is reached');
  eq(m.wallBulge, 0, 'the rise entry zeroes the bulge');
  const seen: number[] = [];
  let frames = 0;
  while (m.state === 'rise' && frames < 100) {
    step(r, [p]);
    frames++;
    if (m.state === 'rise' || m.state === 'walk') seen.push(m.wallBulge);
  }
  // The target search waits for the retarget interval (60 frames) before the
  // rise's steps begin. From the first step that reads 1 (acc 1.0) on, acc
  // gains 0.5 a frame, so the bulge is 1 + floor(k / 2) after k more steps and
  // 12 from k = 22 (acc 12.0).
  const a = seen.findIndex((v) => v > 0);
  check(a > 0, `the rise waits for a target before it bulges (${a} frames)`);
  eq(seen[a - 1], 0, 'the frame before the first bulge is 0');
  const expect = Array.from({ length: 23 }, (_, k) => Math.min(12, 1 + Math.floor(k / 2)));
  eq(seen.slice(a, a + 23), expect, 'the bulge is 1 + floor(k / 2) per frame while it rises');
  eq(seen[seen.length - 1], 12, 'the rise ends at 12');
  eq(m.wallBulge, 12, 'the exit keeps the bulge at 12 (the walk)');
  eq(m.armBulge, 6, 'the arm stream is trunc(12 / 2.0)');
  // Hidden or searching keeps the bulge; only the next rise restarts it.
  run(r, [], 70);
  run(r, [p], 60);
  eq(m.wallBulge, 12, 'walk and search keep the bulge');
  eq(new MorfosAi({ x: 0, z: 0, angle: 0, params: [0, 0, 0, 0, 0, 0], movement: mv(), attack: atk(32, 6784), rng: () => 0.9 }).wallBulge, 0, 'a new Morfos starts at 0');
}
// --- Recobox and Recon----------------------------------------------------------
const rmv = { fparam1: 1.15, fparam2: 18, fparam3: 450, fparam4: 3, fparam5: 0, fparam6: 0, iparam: [8, 12, 0, 0, 0, 0] };
const box = (o: { params?: number[]; clones?: number; difficulty?: number; rng?: () => number } = {}) =>
  new RecoboxAi({ x: 0, z: 0, angle: 0, params: o.params ?? [0, 0, 0, 3, 0, 0], cloneCount: o.clones ?? 8, movement: rmv, attack: atk(25, 768, 15), difficulty: o.difficulty ?? 0, rng: o.rng ?? (() => 0.5) });
{
  const b = box();
  const r = rig(b);
  step(r, []);
  eq(b.state, 'appear', 'Recobox: 0 -> 1');
  run(r, [], 60);
  eq(b.state, 'closed', 'the 40-step fade-in -> 2 (closed)');
  run(r, [player(0, 600)], 30);
  eq(b.state, 'closed', 'a player beyond 500 does not open it');
  run(r, [player(0, 300)], 3);
  eq(b.state, 'opening', 'a player within 500 opens it (3)');
  eq(b.motion?.index, 2, 'open: row 1 (motion 2)');
  run(r, [player(0, 300)], 40);
  eq(b.state, 'opened', 'open ended: spawning (4)');
  // The Recons come out one per 30 frames, three at once (param4 = 3).
  const kinds: number[] = [];
  let ticks = 0;
  while (kinds.length < 3 && ticks < 400) {
    step(r, [player(0, 300)]);
    ticks++;
    for (const s of b.spawns.splice(0)) kinds.push(s.child);
  }
  check(ticks < 200, `three Recons within 200 frames (${ticks})`);
  eq(kinds, [0, 1, 2], 'children 0, 1, 2 come out in order');
  eq(b.alive.length, 3, 'three alive');
}
{
  // The total: min(30, clone_count - 1); alive at once min(param4, total).
  const small = box({ clones: 1 });
  const r = rig(small);
  run(r, [player(0, 300)], 400);
  eq(small.spawned, 0, 'clone_count < 2: nothing comes out');
  const two = box({ clones: 3, params: [0, 0, 0, 6, 0, 0] });
  const r2 = rig(two);
  run(r2, [player(0, 300)], 600);
  eq(two.spawned, 2, 'clone_count 3: two Recons in total, even with 6 at once');
  const zero = box({ params: [0, 0, 0, 0, 0, 0] });
  run(rig(zero), [player(0, 300)], 400);
  eq(zero.spawned, 0, 'param4 = 0: none');
}
{
  // Closing and reopening: the box closes when it has its limit out and opens
  // again once half of them are gone.
  const b = box({ params: [0, 0, 0, 4, 0, 0], clones: 20 });
  const r = rig(b);
  const p = player(0, 300);
  run(r, [p], 400);
  eq(b.alive.length, 4, 'four out');
  check(b.state === 'closed' || b.state === 'closing', `the box closes with its limit out (${b.state})`);
  const first = b.alive[0];
  b.alive.splice(0, 3).forEach((x) => x.kill());
  eq(b.alive.length, 1, 'three gone');
  run(r, [p], 200);
  check(b.spawned > 4, `it opens again (${b.spawned})`);
  void first;
}
{
  // The launch vector by type.
  const types = [0, 1, 2].map((k) => {
    const b = box({ params: [0, 0, 0, 1, 0, k] });
    const r = rig(b);
    run(r, [player(0, 300)], 300);
    return b.alive[0];
  });
  check(types.every((t) => !!t), 'a Recon in every type');
}
{
  // Death: the Recons die with the box; no flinch.
  const b = box();
  const r = rig(b);
  run(r, [player(0, 300)], 300);
  const n = b.alive.length;
  check(n > 0, 'some out');
  eq(b.flinches(), false, 'the box does not flinch');
  b.kill();
  eq(b.alive.length, 0, 'the Recons die with the box');
}
{
  // A Recon: launch, look, orbit, attack; every motion length.
  for (const len of [1, 4, 12, 30, 60]) {
    const b = box({ params: [0, 0, 0, 2, 0, 0], clones: 10 });
    const r = rig(b);
    const p = player(0, 120);
    run(r, [p], 150, len);
    const recon = b.alive[0];
    check(!!recon, `a Recon came out (len ${len})`);
    if (!recon) continue;
    const rr = rig(recon);
    const seen = new Set<string>();
    let bomb: ReconBomb | undefined;
    let slash = false;
    let lift = 0;
    for (let i = 0; i < 3000; i++) {
      const f = step(rr, [p], len);
      seen.add(recon.state);
      lift = f.lift ?? lift;
      for (const s of f.shots ?? []) {
        if (s instanceof ReconBomb) bomb ??= s;
        else slash = true;
      }
    }
    check(seen.has('launch') && seen.has('orbit'), `the Recon launches and orbits (len ${len}: ${[...seen].join(',')})`);
    check(seen.has('shoot') || seen.has('slash'), `the Recon attacks (len ${len})`);
    check(lift >= RECON.hoverMin, `the Recon hovers (lift ${lift.toFixed(1)})`);
    void bomb;
    void slash;
  }
  // The launch lands exactly on the hover height.
  const b = box({ params: [0, 0, 0, 1, 0, 0] });
  const r = rig(b);
  run(r, [player(0, 300)], 400);
  const rec = b.alive[0];
  const rr = rig(rec);
  let l = 0;
  run(rr, [], 400, 30, (f) => (l = f.lift ?? l));
  check(l > 40 && l < 50, `a floor Recon rises to its hover height 45 +- 2 (${l.toFixed(1)})`);
  check(rec.state === 'look' || rec.state === 'leave' || rec.state === 'gone', `then it looks around (${rec.state})`);
  // 150 frames without a target: it fades away and leaves the box.
  run(rr, [], 400);
  eq(rec.state, 'gone', 'no target: it leaves (state 5 -> removed)');
  check(rec.removed, 'removed');
  eq(b.alive.includes(rec), false, 'and is gone from the box');
}
{
  // The room limit: 2 Recons per player (4 on Ultimate).
  const b = box({ params: [0, 0, 0, 4, 0, 0], clones: 10 });
  const r = rig(b);
  const p = player(0, 120);
  run(r, [p], 400);
  const recons = [...b.alive];
  check(recons.length === 4, '4 Recons');
  eq(b.hasRoomFor(0), true, 'nobody attacks yet');
  const u = box({ difficulty: 3 });
  eq(u.hasRoomFor(0), true, 'Ultimate box');
}
{
  // The bomb: gravity, a bounce, then armed; explodes on touch; the blast
  // radius is fparam2.
  let hurt = false;
  const bomb = new ReconBomb(0, 20, 0, 0, 3, 18, 450, 240, () => hurt);
  let t = 0;
  while (bomb.y > 0 && t < 100) {
    bomb.tick([]);
    t++;
  }
  check(t > 5 && t < 40, `it falls (${t} ticks)`);
  for (let i = 0; i < 100; i++) bomb.tick([]);
  check(!bomb.done, 'it lies armed after the second bounce');
  eq(bomb.effect, { kind: 'tech', power: 450 }, 'blast power = fparam3');
  const walk = player(bomb.x, bomb.z + 30);
  eq(bomb.tick([walk]).length, 0, 'a player 30 away does not set it off');
  const hits = bomb.tick([player(bomb.x, bomb.z)]);
  eq(hits.length, 1, 'touching it sets it off: the blast hits the player');
  check(bomb.done, 'and it is spent');
  const life = new ReconBomb(0, 0, 0, 0, 3, 18, 450, 10, () => false);
  let n = 0;
  while (!life.done && n < 100) {
    life.tick([]);
    n++;
  }
  eq(n, 11, 'it explodes at the end of its life');
  const owner = new ReconBomb(0, 0, 0, 0, 3, 18, 450, 240, () => hurt);
  hurt = true;
  owner.tick([]);
  check(owner.done, 'it explodes when its Recon is hurt');
}


{
  // The room limit holds over a long run: at most 2 Recons (4 on Ultimate)
  // attack one player at a time.
  for (const difficulty of [0, 3]) {
    const b = box({ params: [0, 0, 0, 6, 0, 0], clones: 12, difficulty });
    const rigs = new Map<ReconAi, Rig>();
    const rb = rig(b);
    const p = player(0, 130);
    let most = 0;
    for (let i = 0; i < 4000; i++) {
      step(rb, [p]);
      for (const sp of b.spawns.splice(0)) rigs.set(sp.recon, rig(sp.recon));
      for (const rr of rigs.values()) step(rr, [p]);
      let claims = 0;
      for (const rc of rigs.keys()) if (rc.claimedTarget === 0) claims++;
      most = Math.max(most, claims);
    }
    check(most >= 1 && most <= (difficulty === 3 ? 4 : 2), `difficulty ${difficulty}: at most ${difficulty === 3 ? 4 : 2} attack one player (${most})`);
  }
}
{
  // Launch vectors: a floor Recon rises, a ceiling one comes down, a wall one
  // slides out along the box's heading.
  const lifts: Record<number, number[]> = {};
  const moved: Record<number, number> = {};
  for (const kind of [0, 1, 2]) {
    const b = new RecoboxAi({ x: 0, z: 0, angle: Math.PI / 2, params: [0, 0, 0, 1, 0, kind], cloneCount: 4, movement: rmv, attack: atk(25, 768, 15), rng: () => 0.5 });
    const rb = rig(b);
    run(rb, [player(0, 300)], 250);
    const rc = b.alive[0];
    check(!!rc, `a Recon of type ${kind}`);
    if (!rc) continue;
    const rr = rig(rc);
    lifts[kind] = [];
    for (let i = 0; i < 15; i++) lifts[kind].push(step(rr, []).lift ?? 0);
    moved[kind] = Math.hypot(rc.x, rc.z);
  }
  check(lifts[0][1] > lifts[0][0], 'floor: it rises');
  check(lifts[1][1] < lifts[1][0], 'ceiling: it comes down');
  check(moved[2] > 40 && moved[2] < 60 && moved[0] < 1, `wall: it slides out along the heading (${moved[2].toFixed(1)}), floor: it does not`);
}
{
  // Orientation (0x0058958c / recon_debug_display): yaw, then X by 0x8000 for
  // kind 1 and 0x4000 for kind 2; kind 0 is upright. The Recon keeps its kind.
  near(derolleTiltX(0), 0, 'floor tilt is 0');
  near(derolleTiltX(1), Math.PI, 'ceiling tilt is 0x8000 (pi)', 1e-9);
  near(derolleTiltX(2), Math.PI / 2, 'wall tilt is 0x4000 (pi / 2)', 1e-9);
  for (const kind of [0, 1, 2]) {
    const b = new RecoboxAi({ x: 0, z: 0, angle: 0.3, params: [0, 0, 0, 1, 0, kind], cloneCount: 4, movement: rmv, attack: atk(25, 768, 15), rng: () => 0.5 });
    near(b.tiltX, derolleTiltX(kind), `box kind ${kind} tilt`, 1e-9);
    const rb = rig(b);
    run(rb, [player(0, 300)], 250);
    const rc = b.alive[0];
    if (rc) near(rc.tiltX, derolleTiltX(kind), `recon kind ${kind} tilt`, 1e-9);
    else check(false, `a Recon of type ${kind} for the tilt`);
  }
}
{
  // Hover: 45 +- 2 plus the box's param1.
  const b = box({ params: [30, 0, 0, 2, 0, 0], clones: 6 });
  const rb = rig(b);
  run(rb, [player(0, 300)], 400);
  const rc = b.alive[0];
  const rr = rig(rc);
  let l = 0;
  run(rr, [], 300, 30, (f) => (l = f.lift ?? l));
  check(l > 73 && l < 77, `param1 30: hover 45 + 30 +- 2 (${l.toFixed(1)})`);
}

// --- Epsilon ----------------------------------------------------------------------
const emv = { fparam1: 0, fparam2: 1.5, fparam3: 780, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [180, 45, 30, 30, 0, 0] };
const gmv = { fparam1: 50, fparam2: 2, fparam3: 1.5, fparam4: 450, fparam5: 0, fparam6: 0, iparam: [30, 0, 0, 0, 0, 0] };
const epsilon = (o: { params?: number[]; rng?: () => number } = {}) =>
  new EpsilonAi({ x: 0, z: 0, angle: 0, params: o.params ?? [0, 0, 0, 0], movement: emv, epsigard: gmv, rng: o.rng ?? (() => 0.3) });
{
  const e = epsilon();
  const r = rig(e);
  eq(e.children.length, 4, 'four Epsigards');
  check(e.invulnerable, 'dormant: shielded');
  run(r, [player(0, 900)], 100);
  eq(e.state, 'dormant', 'nobody within 400: dormant');
  run(r, [player(0, 200)], 40);
  check(e.state === 'appear' || e.state === 'stalk', `a player within 400 wakes it (${e.state})`);
  run(r, [player(0, 200)], 60);
  check(e.state !== 'appear' && e.state !== 'dormant', `the appear ends (${e.state})`);
  check(e.invulnerable, 'closed while it stalks: hits do nothing');
  eq(e.flinches(), false, 'no flinch');
  const t0 = Math.hypot(e.x, e.z);
  run(r, [player(0, 200)], 60);
  check(Math.hypot(e.x, e.z) >= t0, 'it stalks the player');
}
{
  // The full cycle with several player distances: stalk -> order -> open ->
  // recall -> recolor -> stalk, never hanging.
  for (const rand of [0.1, 0.9]) {
    const e = epsilon({ params: [0, 0, -15, -15], rng: () => rand });
    const gr = groupRigs(e);
    const p = player(0, 150);
    const seen = new Set<string>();
    let blasts = 0;
    runGroup(e, gr, [p], 12000, 30, (f) => {
      seen.add(e.state);
      for (const s of f.shots ?? []) if (s.effect.kind === 'tech') blasts++;
    });
    for (const st of ['appear', 'stalk', 'order', 'open', 'recall', 'recolor']) check(seen.has(st), `Epsilon reaches ${st} (rand ${rand}: ${[...seen].join(',')})`);
    check(blasts > 0, `the laser orb blasts (${blasts})`);
  }
  // Timers: param3 + 20 (at least 5) * 30 frames.
  const quick = epsilon({ params: [0, 0, -15, -15] });
  const slow = epsilon({ params: [0, 0, 40, 40] });
  const p = player(0, 150);
  const rq = groupRigs(quick);
  const rs = groupRigs(slow);
  let tq = 0;
  let ts = 0;
  for (let i = 0; i < 6000; i++) {
    for (const x of rq) step(x, [p]);
    for (const x of rs) step(x, [p]);
    if (!tq && quick.state === 'order') tq = i;
    if (!ts && slow.state === 'order') ts = i;
  }
  check(tq > 0 && (ts === 0 || ts > tq), `a longer first timer sends the Epsigards later (${tq} vs ${ts})`);
}
{
  // Vulnerable only open: a hit while open -> the flash (state 8) -> open.
  const e = epsilon({ params: [0, 0, -15, 20] });
  const gr = groupRigs(e);
  const r = gr[0];
  const p = player(0, 150);
  let opened = false;
  for (let i = 0; i < 6000 && !opened; i++) {
    for (const x of gr) step(x, [p]);
    if (e.state === 'open') opened = true;
  }
  check(opened, 'it opens');
  check(!e.invulnerable, 'open: hits count');
  e.onDamage(0);
  e.flinches();
  eq(e.state, 'hit', 'a hit while open: the flash (8)');
  runGroup(e, gr, [p], 30);
  eq(e.state, 'open', 'then open again (4)');
  void r;
  // The Epsigards: invulnerable orbiters.
  const g = e.children[0];
  check(g.invulnerable, 'an Epsigard cannot be hurt');
  check(g.state === 'orbit' || g.state === 'out' || g.state === 'home' || g.state === 'recall', `Epsigard state ${g.state}`);
  // Element immunity.
  const el = e.element;
  check(e.immuneToTech(1) === (el === 0) || e.invulnerable, 'foie group is blocked by the fire element');
}
{
  // An Epsigard orbits at the radius of its row and attacks with a shield.
  const e = epsilon({ params: [0, 0, -15, 20] });
  const gr = groupRigs(e);
  const p = player(0, 150);
  let maxDist = 0;
  let touched = 0;
  let attacked = false;
  runGroup(e, gr, [p], 4000, 30, (f) => {
    for (const c of e.children) {
      if (c.state === 'orbit') maxDist = Math.max(maxDist, Math.hypot(c.x - e.x, c.z - e.z));
      if (c.attacking) attacked = true;
    }
    for (const s of f.shots ?? []) if (s.effect.kind === 'tech') touched++;
  });
  check(attacked, 'the Epsigards attack');
  check(maxDist > 40 && maxDist < 120, `the orbit stays near the radius 50 (${maxDist.toFixed(1)})`);
  void touched;
  // Death: the Epsilon dies, its Epsigards follow.
  e.kill();
  eq(e.state, 'dead', 'the Epsilon owns its death');
  check(e.children.every((c) => c.state === 'dying' || c.state === 'gone'), 'the Epsigards follow');
  run(rig(e.children[0]), [], 100);
  eq(e.children[0].state, 'gone', 'a dying Epsigard is gone after its burst');
}

{
  // The tint (render/combat.ts): lerp(white, element colour, colourT), the
  // element colour lerped from the old element to the new one by colourMix.
  eq(epsilonTint(0, 0, 0, 0), [1, 1, 1], 'no colour: white');
  eq(epsilonTint(0, 0, 0, 1), [1, 0, 0], 'element 0 (red) at full colour');
  eq(epsilonTint(1, 1, 1, 1), [0, 0, 1], 'element 1 (blue) at full colour');
  eq(epsilonTint(0, 1, 0.5, 1), [0.5, 0, 0.5], 'red to blue, halfway');
  eq(epsilonTint(2, 2, 0, 0.5), [1, 1, 0.5], 'half colour: yellow lerped with white');
  eq(epsilonTint(5, 5, 0, 1), epsilonTint(1, 1, 0, 1), 'the element is taken mod 4');
}
{
  // The brain side of the tint: colourT rises, the element changes at its top
  // with colourMix 0, and colourMix reaches 1 about 30 frames later.
  const e = epsilon({ params: [0, 0, 10, -15] });
  const gr = groupRigs(e);
  const p = player(0, 150);
  let prev = e.element;
  let changes = 0;
  let mixFrames = -1;
  let sinceChange = -1;
  let shownOpen = false;
  let shownClosed = true;
  runGroup(e, gr, [p], 3000, 30, () => {
    if (e.open) shownOpen = true;
    else shownClosed = true;
    if (e.element !== prev) {
      check(e.colourFrom === prev && e.colourMix === 0, `the recolour starts from the old element (${prev} -> ${e.element})`);
      prev = e.element;
      changes++;
      sinceChange = 0;
      mixFrames = -1;
    } else if (sinceChange >= 0) {
      sinceChange++;
      if (e.colourMix >= 1 && mixFrames < 0) mixFrames = sinceChange;
    }
  });
  check(changes >= 2, `the element changed (${changes} times)`);
  check(mixFrames >= 29 && mixFrames <= 31, `the colour lerp takes 30 frames (${mixFrames})`);
  check(shownOpen && shownClosed, 'the body is open and closed in the cycle');
}
{
  // The recolour ring (render/epsilonfx.ts): its scale is colourT while the
  // recolour state runs, null in every other state.
  const e = epsilon({ params: [0, 0, 10, -15] });
  const gr = groupRigs(e);
  const p = player(0, 150);
  eq(e.recolourRing, null, 'no ring before the first recolour');
  let ringSeen = false;
  let ringBad = false;
  runGroup(e, gr, [p], 3000, 30, () => {
    const t = e.recolourRing;
    if (e.state === 'recolor') {
      ringSeen = true;
      if (t === null || t < 0 || t > 1) ringBad = true;
    } else if (t !== null) ringBad = true;
  });
  check(ringSeen, 'the ring is drawn during a recolour');
  check(!ringBad, 'the ring is null outside the recolour and a 0..1 scale inside');
}
{
  // The special immunity (EpsigardProcessSpecialAttack 0x0055ab30): the
  // element's special type (0x0055ac24's stack array: fire 9, ice 7, thunder 10, instant
  // kill 11), by colour 0..3 (the element is read as the colour & 3).
  eq(EPSILON_ELEMENT_SPECIALS, [9, 7, 10, 11], 'the element specials (0x0055ac24)');
  eq(EPSILON_ELEMENT_GROUPS, [1, 2, 3, 5], 'the element groups (0x0055aaf0)');
  for (let c = 0; c < 4; c++) {
    const e = epsilon({ rng: () => (c + 0.5) / 4 });
    eq(e.element, c, `colour ${c} from the rng`);
    for (const t of [1, 7, 9, 10, 11, 12]) {
      eq(e.immuneToSpecial(t), t === EPSILON_ELEMENT_SPECIALS[c], `colour ${c} is immune to special ${t} only as its element`);
    }
  }
}
{
  // The sounds (exe: play_directional_sound_effect at the Epsilon): the laser
  // starts (0x2d2) and its orb is made (0x2d3) once per laser; the recolour plays
  // 0x2d4 on each of its frames and 0x2d5 when the colour has fallen.
  const e = epsilon({ params: [0, 0, 10, -15] });
  const gr = groupRigs(e);
  const p = player(0, 150);
  const ids: number[] = [];
  runGroup(e, gr, [p], 3000, 30, () => {
    for (const ev of e.events.splice(0)) ids.push(ev.id);
  });
  const count = (id: number) => ids.filter((x) => x === id).length;
  check(ids.every((x) => x === 0x2d2 || x === 0x2d3 || x === 0x2d4 || x === 0x2d5), `only the Epsilon's sounds are emitted (${[...new Set(ids)].map((x) => x.toString(16))})`);
  check(count(0x2d2) >= 1 && count(0x2d2) === count(0x2d3), `one orb per laser start (${count(0x2d2)} starts, ${count(0x2d3)} orbs)`);
  check(count(0x2d5) >= 1 && count(0x2d4) >= 30 * count(0x2d5),`the recolour: 0x2d4 each frame (${count(0x2d4)}), 0x2d5 at the end (${count(0x2d5)})`);
}
{
  // The first timer: (param3 + 20, at least 5) * 30 frames of stalking before
  // the Epsigards are sent; the element advances in the recolour.
  const e = epsilon({ params: [0, 0, 10, -15] });
  const gr = groupRigs(e);
  const p = player(0, 150);
  let stalkStart = -1;
  let orderAt = -1;
  const colours: number[] = [];
  runGroup(e, gr, [p], 3000, 30, (_f, i) => {
    if (stalkStart < 0 && e.state === 'stalk') stalkStart = i;
    if (orderAt < 0 && e.state === 'order') orderAt = i;
    if (colours[colours.length - 1] !== e.element) colours.push(e.element);
  });
  const want = 30 * 30;
  // The laser round in progress (up to 180 + 45 + 30 frames) finishes first.
  check(orderAt - stalkStart >= want - 2 && orderAt - stalkStart <= want + 260, `param3 10: 30 * 30 frames of stalking (${orderAt - stalkStart})`);
  check(colours.length >= 2 && colours.every((c, i) => i === 0 || c === (colours[i - 1] + 1) % 4), `the element advances by one (${colours.join(',')})`);
}
{
  // The laser orb: iparam1 frames of creeping at 1.5, iparam2 frames to strike;
  // the blast hits players within 40.
  const e = epsilon({ params: [0, 0, 40, 40] });
  const gr = groupRigs(e);
  const p = player(0, 300);
  let blast: EnemyShot | undefined;
  let pickedAt = -1;
  let blastAt = -1;
  runGroup(e, gr, [p], 1200, 30, (f, i) => {
    if (pickedAt < 0 && e.orb) pickedAt = i;
    for (const sh of f.shots ?? []) {
      if (!blast) {
        blast = sh;
        blastAt = i;
      }
    }
  });
  check(!!blast && pickedAt >= 0, 'the Epsilon picks a target and blasts');
  check(blastAt - pickedAt >= 180 + 45 - 3 && blastAt - pickedAt <= 180 + 45 + 3, `charge 180 + strike 45 frames (${blastAt - pickedAt})`);
  if (blast) {
    eq(blast.effect, { kind: 'tech', power: 780 }, 'blast power = fparam3');
    eq(blast.tick([player(blast.x, blast.z + 30, 0), player(blast.x, blast.z + 60, 1)]).map((t) => t.clientId), [0], 'radius 40');
  }
}
{
  // Out of reach: no target within 400 -> lost -> dormant again at its spawn.
  const e = epsilon();
  const gr = groupRigs(e);
  runGroup(e, gr, [player(0, 150)], 200);
  e.x = 40;
  e.z = 30;
  const w = e.warps;
  runGroup(e, gr, [], 600);
  eq(e.state, 'dormant', 'target lost: it fades out and sleeps (7 -> 0)');
  check(e.x === 0 && e.z === 0 && e.warps > w, 'back at its spawn point, warped');
  check(step(gr[0], []).hidden === true, 'hidden');
  // The sub 2 dead end of the exe: a player coming back during state 7.
  const f = epsilon();
  const gf = groupRigs(f);
  runGroup(f, gf, [player(0, 150)], 200);
  for (let i = 0; i < 400; i++) for (const x of gf) step(x, i < 5 ? [] : [player(0, 150)]);
  runGroup(f, gf, [player(0, 150)], 300);
  check(f.state !== 'lost', `a player coming back during state 7 does not hang it (${f.state})`);
}

{
  eq(EPSILON_PATTERNS.length, EPSILON.patternRows, '20 patterns');
  eq(EPSILON_PATTERNS.slice(0, 5).every((r) => r.every((v) => v === 0)), true, 'five empty rows');
  eq(EPSILON_PATTERNS[19], [1, 1, 1, 1], 'the last row sends all four');
  // Lost target: fades out and goes dormant at its spawn point.
  const e = epsilon();
  const r = rig(e);
  run(r, [player(0, 100)], 100);
  e.kill();
  void near;
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmep2d: all checks passed');
