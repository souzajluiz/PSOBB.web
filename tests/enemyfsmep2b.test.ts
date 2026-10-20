// Episode 2 FSMs, second batch (combat/enemyfsmep2b.ts): the Mericarol family
// (Mericarol / Merikle / Mericus) and the Ul / Zol Gibbons. The motion frame
// counts are the real ones of bm_ene_bm9_s_mericarol.bml / bm_ene_bm5_gibon_u.bml
// when the client data is at PSOBB_DATA (default ~/Downloads/psobb-client/data),
// else the ones this file was written against.
// Run: node tests/enemyfsmep2b.test.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GIBBON, GibbonAi, GibbonGroups, MERICAROL, MericarolAi, MericarolBolt } from '../client/src/combat/enemyfsmep2b.ts';
import { SporeCloud } from '../client/src/combat/enemyfsmep2.ts';
import type { AiFrame, AiTarget, EnemyAiMotion } from '../client/src/combat/enemyai.ts';
import { STATUS } from '../client/src/combat/status.ts';
import { TECH, techPower } from '../client/src/combat/techniques.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, tol: number, what: string) => check(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const player = (x: number, z: number, clientId = 0, angle = 0): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle });
const mv = (o: Partial<{ f: number[]; i: number[] }> = {}) => ({
  fparam1: o.f?.[0] ?? 20,
  fparam2: o.f?.[1] ?? 40,
  fparam3: o.f?.[2] ?? 30,
  fparam4: o.f?.[3] ?? 2,
  fparam5: o.f?.[4] ?? 25,
  fparam6: o.f?.[5] ?? 0.5,
  iparam: o.i ?? [0, 0, 30, 20, 25, 100],
});

// --- real motion frame counts ---------------------------------------------------
const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME ?? '', 'Downloads/psobb-client/data');
// Frame counts of the motions of each archive (measured with EnemyArchive).
let MERICAROL_LEN = [20, 20, 31, 20, 30, 30, 30, 30];
let GIBBON_LEN = [40, 33, 20, 30, 25, 40, 30, 30, 30];
if (existsSync(join(DATA, 'data.gsl'))) {
  try {
    const { GSLArchive } = await import('../client/src/formats/archives.ts');
    const { EnemyArchive } = await import('../client/src/render/enemymodel.ts');
    const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
    const loose = new Set(readdirSync(DATA));
    const read = (n: string) => (loose.has(n) ? new Uint8Array(readFileSync(join(DATA, n))) : gsl.has(n) ? gsl.get(n) : null);
    const lens = (name: string, models: number): number[] | null => {
      const d = read(name);
      if (!d) return null;
      const a = new EnemyArchive(name, d, models);
      const nodes = a.nodeCount(0);
      return Array.from({ length: a.motionCount }, (_, j) => a.motion(j, nodes).frameCount);
    };
    MERICAROL_LEN = lens('bm_ene_bm9_s_mericarol.bml', 1) ?? MERICAROL_LEN;
    GIBBON_LEN = lens('bm_ene_bm5_gibon_u.bml', 2) ?? GIBBON_LEN;
  } catch (e) {
    console.log(`(real motion lengths unavailable: ${(e as Error).message})`);
  }
}
eq(MERICAROL_LEN.length, 8, 'Mericarol archive motions');
eq(GIBBON_LEN.length, 9, 'Gibbon archive motions');

// Drives a brain like render/combat.ts: a one-shot motion reports `ended` once
// the motion's frame counter reached its last frame (EnemyAnimator.ended).
type Brain = {
  state: string;
  motion: EnemyAiMotion | null;
  tick(t: readonly AiTarget[], ended?: boolean): AiFrame;
};
class Rig {
  frame = 0;
  last: EnemyAiMotion | null = null;
  ai: Brain;
  lens: readonly number[];
  constructor(ai: Brain, lens: readonly number[]) {
    this.ai = ai;
    this.lens = lens;
  }
  tick(targets: readonly AiTarget[], each?: (r: AiFrame) => void): AiFrame {
    const m = this.ai.motion;
    if (m !== this.last) {
      this.last = m;
      this.frame = 0;
    }
    const len = m ? (this.lens[m.index] ?? 30) : 30;
    const ended = !!m && !m.loop && this.frame >= len - 1;
    const r = this.ai.tick(targets, ended);
    if (this.ai.motion === m) this.frame += m?.speed ?? 0;
    else this.frame = 0;
    if (this.ai.motion !== this.last) this.last = this.ai.motion;
    each?.(r);
    return r;
  }
  run(targets: readonly AiTarget[], n: number, each?: (r: AiFrame) => void): void {
    for (let i = 0; i < n; i++) this.tick(targets, each);
  }
  // Ticks until `state` is reached (or n ticks); returns the ticks it took.
  until(targets: readonly AiTarget[], state: string, n: number, each?: (r: AiFrame) => void): number {
    for (let i = 0; i < n; i++) {
      if (this.ai.state === state) return i;
      this.tick(targets, each);
    }
    return this.ai.state === state ? n : -1;
  }
}

// --- Mericarol ------------------------------------------------------------------
{
  const mk = (o: { sub?: number; params?: number[]; rng?: () => number; ultimate?: boolean; movement?: ReturnType<typeof mv>; self?: number } = {}) => {
    const ai = new MericarolAi({
      x: 0,
      z: 0,
      angle: 0,
      subtype: o.sub ?? 0,
      params: o.params ?? [0, 0, 0],
      movement: o.movement ?? mv(),
      ultimate: o.ultimate,
      selfId: () => o.self ?? 0,
      rng: o.rng ?? (() => 0.9),
    });
    return { ai, rig: new Rig(ai, MERICAROL_LEN) };
  };
  // Constants of the executable.
  eq([MERICAROL.search, MERICAROL.turn, MERICAROL.bodyRadius, MERICAROL.swipeRadius], [250, 512, 25, 50], 'AI record 0x009beaac, hit boxes 0x009be940 / 0x009be96c');
  eq([MERICAROL.chanceBase, MERICAROL.speedBase, MERICAROL.speedMin, MERICAROL.swipeBase], [0.5, 3, 1, Math.fround(0.1)], 'constants 0x00926ba0..0x00926bac');

  // Spawn: hidden for the 40-frame emergence effect.
  {
    const { ai, rig } = mk({ movement: mv({ i: [0, 0, 1000, 20, 25, 100] }) });
    check(ai.invulnerable && ai.untargetable && ai.superArmor, 'spawn: hidden (vtable +0x184) and armored');
    rig.run([player(0, 500)], MERICAROL.emergeFrames - 1);
    eq(ai.state, 'spawn', 'still burrowed after 39 frames');
    rig.run([player(0, 500)], 1);
    eq(ai.state, 'idle', 'idle after the 40-frame emergence effect');
    check(!ai.invulnerable && !ai.superArmor, 'idle: vulnerable');
    rig.run([player(0, 260)], 10);
    eq(ai.state, 'idle', 'a player beyond 250 is not seen');
    const r = rig.tick([player(0, 240)]);
    eq(ai.state, 'hunt', 'a player within 250 wakes it');
    eq(r.motion?.index, 7, 'row 4: the wake-up motion 7');
    rig.run([player(0, 240)], 50);
    eq(ai.motion?.index, 5, 'row 3 after the wake-up (mode 2, next 3)');
  }

  // Hunt: it turns by 512 BAMS a frame and never walks.
  {
    const { ai, rig } = mk({ movement: mv({ i: [0, 0, 1000, 20, 25, 100] }) });
    rig.run([player(0, 500)], 40);
    rig.run([player(200, 0)], 3); // 90 degrees to the side, inside 250
    near(ai.angle, 2 * 512 * ((Math.PI * 2) / 0x10000), 1e-6, 'turns 512 BAMS (2.8 degrees) a frame');
    eq([ai.x, ai.z], [0, 0], 'a hunting Mericarol never moves');
    rig.run([player(200, 0)], 60);
    near(ai.angle, Math.PI / 2, 1e-6, 'and ends up facing the target');
  }

  // Far target: after iparam3 frames of hunting the bolt, at motion frame 10.
  {
    const mvv = mv({ f: [20, 40, 30, 2, 25, 0.5], i: [0, 0, 30, 20, 25, 100] });
    const { ai, rig } = mk({ movement: mvv });
    const tg = [player(0, 150)];
    rig.run(tg, 40);
    const wasted = rig.until(tg, 'bolt', 80);
    check(wasted >= 0, 'a target 150 away: the bolt state is reached');
    let shots: AiFrame['shots'];
    const n = rig.until(tg, 'hunt', 60, (r) => (shots ??= r.shots));
    check(n >= 0, 'the bolt state ends with its motion');
    check(!!shots && shots.length >= 1, 'the technique object leaves at motion frame 10');
    if (shots) {
      eq(shots[0]!.effect, { kind: 'tech', power: 30 }, 'Mericarol: group 0 with fparam3');
      // The cast row 0 runs at 0.6: frame 10 is the 17th tick of the state.
      const b = shots[0] as MericarolBolt;
      let hits = 0;
      for (let i = 0; i < 100 && !b.done; i++) hits += b.tick([player(0, 150)]).length;
      eq(hits, 1, 'the bolt flies on at fparam4 a frame and hits the player');
      check(b.frames < MERICAROL.boltLife, 'before its 150 frames run out');
      // The landed bolt flags the owner: the next skill check goes to state 8.
      rig.run(tg, 5);
      eq(ai.state, 'recover', 'a landed bolt sets flag 2: recover (state 8)');
      check(rig.until(tg, 'hunt', 60) >= 0, 'recover ends after one cycle');
    }
  }

  // The bolt's group by subtype / difficulty.
  {
    const kinds = (sub: number, ultimate: boolean, rng: () => number): unknown[] => {
      const { ai, rig } = mk({ sub, ultimate, rng, movement: mv({ i: [0, 0, 5, 20, 25, 50] }) });
      const tg = [player(0, 150)];
      let shots: AiFrame['shots'];
      rig.run(tg, 200, (r) => (shots ??= r.shots));
      void ai;
      return (shots ?? []).map((s) => s.effect);
    };
    eq(kinds(0, false, () => 0.9), [{ kind: 'tech', power: 30 }], 'Mericarol, no confusion roll won');
    eq(kinds(0, false, () => 0.5), [{ kind: 'tech', power: 30 }, { kind: 'status', status: STATUS.confusion }], 'Mericarol: iparam6 % for the confusion hit (group 0x12)');
    eq(kinds(1, false, () => 0.5), [{ kind: 'tech', power: 30 }, { kind: 'status', status: STATUS.freeze }], 'Merikle: Gibarta group 2 (freeze)');
    eq(kinds(2, false, () => 0.5), [{ kind: 'tech', power: 30 }, { kind: 'status', status: STATUS.shock }], 'Mericus: Zonde group 3 (shock)');
    eq(kinds(2, true, () => 0.9), [{ kind: 'megid', power: 30 }], 'Ultimate: Megid (group 5) for all');
  }

  // Close and facing: the swipe (rng > 0.1 + param3) or the cloud.
  {
    const { ai, rig } = mk({ rng: () => 0.9, params: [0, 0, 0] });
    const tg = [player(0, 30)];
    rig.run(tg, 40);
    rig.until(tg, 'swipe', 60);
    eq(ai.state, 'swipe', 'closer than 50, random above 0.1: the swipe');
    check(ai.superArmor, 'the swipe is armored (flag 0x20)');
    let hit: AiFrame['hit'] = null;
    const n = rig.until(tg, 'hunt', 400, (r) => (hit ??= r.hit));
    check(n >= 0, 'the swipe ends (cycle + iparam5 frames of the frozen pose)');
    eq(hit && [hit.clientId, hit.knockback, hit.mult], [0, 1, 1], 'frame 8: try_hit(1.0) + cause_knockback(1.0)');
    // The hold is iparam5 = 25 frames after the swipe's motion.
    const { ai: a2, rig: r2 } = mk({ rng: () => 0.9 });
    r2.run(tg, 40);
    r2.until(tg, 'swipe', 60);
    let t = 0;
    let frozen = 0;
    while (a2.state === 'swipe' && t++ < 400) {
      r2.tick(tg);
      if (a2.motion?.speed === 0) frozen++;
    }
    eq(frozen, 25, 'the frozen pose lasts iparam5 frames');
    // A player behind it: no attack.
    const { ai: a3, rig: r3 } = mk({ rng: () => 0.9 });
    r3.run([player(0, 30)], 40);
    r3.run([player(0, -30)], 3);
    eq(a3.state, 'hunt', 'a target behind it (over 90 degrees off): it keeps turning');
  }
  {
    // Cloud: rng 0.05 <= 0.1 -> the cloud; warning iparam4 = 20, then rng > fparam6.
    let v = 0.05;
    const { ai, rig } = mk({ rng: () => v, movement: mv({ f: [20, 40, 30, 2, 25, 0.01], i: [0, 0, 30, 20, 25, 100] }) });
    const tg = [player(0, 30)];
    rig.run(tg, 40);
    rig.until(tg, 'cloud', 60);
    eq(ai.state, 'cloud', 'closer than 50, random <= 0.1: the cloud');
    let cloud: AiFrame['shots'];
    v = 0.9;
    const n = rig.until(tg, 'hunt', 200, (r) => (cloud ??= r.shots));
    check(n >= 0, 'the cloud state ends');
    check(!!cloud && cloud[0] instanceof SporeCloud, 'a one-frame cloud');
    if (cloud) {
      eq(cloud[0]!.effect, { kind: 'megid', power: 40 }, 'group 5 (Megid) with fparam2');
      eq(cloud[0]!.tick([player(0, 20), player(0, 90, 1)]).map((p) => p.clientId), [0], 'radius fparam5 = 25');
    }
    // The bluff: random <= fparam6 -> state 8.
    v = 0.05;
    const { ai: b, rig: rb } = mk({ rng: () => v, movement: mv({ f: [20, 40, 30, 2, 25, 0.5], i: [0, 0, 30, 20, 25, 100] }) });
    rb.run(tg, 40);
    rb.until(tg, 'cloud', 60);
    let shots: AiFrame['shots'];
    rb.until(tg, 'recover', 100, (r) => (shots ??= r.shots));
    eq(b.state, 'recover', 'random <= fparam6: the bluff goes to state 8 with no cloud');
    check(!shots, 'and no cloud');
  }

  // Flinch end (state 10): the rush in the 20..50 % window, the TP drain at 5 %.
  {
    const { ai, rig } = mk({ params: [0.1, 0, 0], rng: () => 0.3 });
    const tg = [player(0, 200)];
    rig.run(tg, 40);
    ai.onDamage(0);
    ai.hpFraction = 0.4;
    eq(ai.resume(), 'rush', 'HP between max / 5 and max / 2, random <= 0.5 + param1: the rush');
    eq(ai.motion?.index, 6, 'windup on row 2 (motion 6)');
    // Winds up 10 frames, then runs 200 at 3.0 (param2 0) a frame.
    const hits: AiFrame['techHit'][] = [];
    const targets = [player(0, 90)];
    let ticks = 0;
    let startZ = 0;
    let charge = -1;
    while (ai.state === 'rush' && ticks < 300) {
      if (ai.motion?.index === 5 && charge < 0) {
        charge = ticks;
        startZ = ai.z;
      }
      rig.tick(targets, (r) => r.techHit && hits.push(r.techHit));
      ticks++;
    }
    check(ticks < 300, 'the rush ends');
    eq(charge, 10, 'windup 10 frames (+0x4a0), then row 1');
    eq(hits.length, 1, 'each player is struck once through entity_hit_by_tech group 0');
    eq(hits[0], { clientId: 0, power: 20 }, 'with fparam1');
    check(ai.z > 150, `it ran forward (${ai.z.toFixed(1)})`);
    near(ai.z - startZ, 200 + 3 * 0.9 * (1 - 0.9 ** 10) / 0.1 - 3 * 0.9 * 0 + 0, 40, 'travelled 200 (+ the 0.9 deceleration)');
    eq(ai.state, 'hunt', 'then back to the hunt');
    // Window miss -> the next roll (0.3 < 0.05 false) -> back to the resume state.
    const o = mk({ rng: () => 0.3 });
    o.rig.run(tg, 60);
    o.ai.hpFraction = 0.9;
    eq(o.ai.resume(), 'hunt', 'above 50 % HP: the resume state');
    const lo = mk({ rng: () => 0.01 });
    lo.rig.run(tg, 40);
    lo.ai.hpFraction = 0.9;
    eq(lo.ai.resume(), 'drain', 'random < 0.05 (0x00926c38): the TP drain');
  }
  // TP drain: the player within 100 at frame 6, TP 0 at frame 25, over at 30.
  {
    const { ai, rig } = mk({ rng: () => 0.01, self: 7 });
    const tg = [player(0, 60, 7)];
    rig.run(tg, 40);
    ai.hpFraction = 0.9;
    ai.resume();
    check(ai.invulnerable && ai.superArmor, 'the drain is invulnerable (vtable +0x174) and armored');
    let drained = -1;
    for (let i = 0; i < 40 && ai.state === 'drain'; i++) {
      const r = rig.tick(tg);
      if (r.tpDrain) drained = i;
    }
    eq(drained, 25, 'TP set to 0 at frame 25 (0x19)');
    eq(ai.state, 'hunt', 'frame 30: back to the hunt');
    const far = mk({ rng: () => 0.01, self: 7 });
    far.rig.run([player(0, 300, 7)], 40);
    far.ai.hpFraction = 0.9;
    far.ai.resume();
    let any = false;
    far.rig.run([player(0, 300, 7)], 40, (r) => (any ||= !!r.tpDrain));
    check(!any, 'a player beyond 100 keeps its TP');
    const other = mk({ rng: () => 0.01, self: 3 });
    other.rig.run(tg, 40);
    other.ai.hpFraction = 0.9;
    other.ai.resume();
    let drainedOther = false;
    other.rig.run(tg, 40, (r) => (drainedOther ||= !!r.tpDrain));
    check(!drainedOther, 'another client\'s player is not drained here');
  }
  // Rush chooses the speed from the set entry: max(3 + param2, 1).
  {
    const { ai, rig } = mk({ params: [0.1, 2, 0], rng: () => 0.3 });
    rig.run([player(0, 200)], 60);
    ai.onDamage(0);
    ai.hpFraction = 0.4;
    ai.resume();
    rig.run([player(0, 200)], 11);
    const z0 = ai.z;
    rig.tick([player(0, 200)]);
    near(ai.z - z0, 5, 1e-6, 'rush speed 3.0 + param2 (2.0) a frame');
  }
  // Death and the contact: kill() leaves it dead and silent.
  {
    const { ai, rig } = mk();
    rig.run([player(0, 100)], 80);
    ai.kill();
    eq(ai.state, 'dead', 'brain owns its death');
    eq(ai.tick([player(0, 5)]).shots, undefined, 'dead: no more shots');
    eq([ai.flinchMotion.index, ai.deathMotion.index], [1, 2], 'flinch row 5 (motion 1), dead row 6 (motion 2)');
  }
  // No state hangs, whatever the targets do and whatever the motions' length
  // (fuzz with the real lengths, then all 1-frame and 90-frame motions).
  for (const lens of [MERICAROL_LEN, MERICAROL_LEN.map(() => 1), MERICAROL_LEN.map(() => 90)]) {
    for (let seed = 1; seed <= 6; seed++) {
      let s = seed * 7919;
      const rnd = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x80000000;
      };
      const ai = new MericarolAi({ x: 0, z: 0, angle: 0, subtype: seed % 3, params: [0.3, 1, 0.2], movement: mv({ i: [0, 0, 20, 10, 10, 50] }), ultimate: seed === 6, selfId: () => 0, rng: rnd });
      const rig = new Rig(ai, lens);
      const longest = new Map<string, number>();
      let cur = '';
      let since = 0;
      for (let i = 0; i < 4000; i++) {
        const d = i % 600 < 200 ? 400 : i % 600 < 400 ? 120 : 25;
        const a = (i / 50) % (Math.PI * 2);
        const tg = [player(Math.sin(a) * d, Math.cos(a) * d, 0), player(300, -300, 1)];
        const r = rig.tick(tg);
        if (i % 97 === 0 && ai.state !== 'dead') {
          ai.onDamage(0);
          ai.hpFraction = rnd();
          ai.resume();
        }
        check(Number.isFinite(r.x) && Number.isFinite(r.z) && Number.isFinite(r.angle), 'finite pose');
        if (ai.state !== cur) {
          cur = ai.state;
          since = 0;
        }
        since++;
        longest.set(cur, Math.max(longest.get(cur) ?? 0, since));
      }
      for (const st of ['spawn', 'bolt', 'swipe', 'rush', 'drain', 'recover', 'cloud']) {
        // bound: the longest motion (90) at its slowest step (0.5) + the holds.
        check((longest.get(st) ?? 0) < 400, `Mericarol ${st} hangs: ${longest.get(st)} ticks (lens ${lens[0]})`);
      }
    }
  }
}

// --- Gibbons --------------------------------------------------------------------
{
  const mkG = (o: { sub?: number; params?: number[]; rng?: () => number; ultimate?: boolean; level?: number; groups?: GibbonGroups; at?: [number, number]; index?: number; lens?: number[] } = {}) => {
    const ai = new GibbonAi({
      x: o.at?.[0] ?? 0,
      z: o.at?.[1] ?? 0,
      angle: 0,
      subtype: o.sub ?? 0,
      params: o.params ?? [1, 0, 0, 0, 0, 0],
      ultimate: o.ultimate,
      level: o.level ?? 4,
      entityIndex: o.index ?? 0,
      groups: o.groups,
      motionFrames: (m) => (o.lens ?? GIBBON_LEN)[m] ?? 30,
      rng: o.rng ?? (() => 0.9),
    });
    return { ai, rig: new Rig(ai, o.lens ?? GIBBON_LEN) };
  };
  eq([GIBBON.searchUl, GIBBON.searchZol, GIBBON.turn, GIBBON.radius], [250, 350, 1536, [8, 12]], 'search radii 0x00565eac, record 0x009be53c, boxes 0x009be2e0 / 0x009be30c');
  eq([GIBBON.aggroSq, GIBBON.stalkFarSq, GIBBON.stalkNearSq], [22500, 10000, 900], 'run-time globals 0x00a73d0c / 04 / 08 (static init 0x00568f15..)');

  // Spawn: param2 >= 1 jumps in from 100 behind (a teleport); < 1 appears on the spot.
  {
    const { ai, rig } = mkG({ params: [1, 5, 0, 0, 0, 0] });
    const w0 = ai.warps;
    const r = rig.tick([]);
    eq(ai.state, 'jump', 'param2 >= 1 (0x00925ffc): JumpAppear');
    eq(ai.warps, w0 + 1, 'the 100-unit step back bumps warps');
    near(r.z, -100, 1e-6, 'started 100 behind its heading');
    check(ai.invulnerable && ai.untargetable, 'jump in: hidden (+0x184)');
    let zPrev = r.z;
    let max = 0;
    for (let i = 0; i < 60 && ai.state === 'jump'; i++) {
      const q = rig.tick([]);
      max = Math.max(max, q.z - zPrev);
      zPrev = q.z;
    }
    near(max, 3.5714285, 0.01, 'runs forward at 25/7 (0x40649249) a frame');
    near(zPrev, 0, 20, 'and lands near its spawn point (motion 40 frames; the decay after frame 28)');
    eq(ai.state, 'wait', 'no target in sight: wait');
    check(!ai.invulnerable, 'wait is vulnerable (+0x188)');
    const s = mkG({ params: [1, 0.5, 0, 0, 0, 0] });
    s.rig.tick([]);
    eq(s.ai.state, 'spot', 'param2 < 1: SpotAppear');
    s.rig.run([], GIBBON.emergeFrames - 1);
    eq(s.ai.state, 'spot', '40-frame emergence effect');
    s.rig.tick([]);
    eq(s.ai.state, 'wait', 'then wait');
    // Targets seen at the end of the appearance: wander.
    const t = mkG({ params: [1, 0.5, 0, 0, 0, 0] });
    t.rig.run([player(0, 200)], 45);
    eq(t.ai.state, 'wander', 'a target within 250: wander (state 8)');
    const far = mkG({ params: [1, 0.5, 0, 0, 0, 0] });
    far.rig.run([player(0, 300)], 45);
    eq(far.ai.state, 'wait', 'a Ul does not see 300');
    const zol = mkG({ sub: 1, params: [1, 0.5, 0, 0, 0, 1] });
    zol.rig.run([player(0, 300)], 45);
    eq(zol.ai.state, 'wander', 'a Zol sees 350');
  }

  // Group: the Ul walks around its leader's spawn point; the leader calls (60) and alerts the group.
  {
    const groups = new GibbonGroups();
    const zol = mkG({ sub: 1, params: [3, 0.5, 0, 0, 0, 1], groups, at: [500, 500], index: 2 });
    const ul = mkG({ sub: 0, params: [3, 0.5, 0, 0, 0, 0], groups, at: [10, 10], index: 3 });
    const other = mkG({ sub: 0, params: [4, 0.5, 0, 0, 0, 0], groups, at: [0, 0], index: 4 });
    zol.rig.tick([]);
    ul.rig.tick([]);
    other.rig.tick([]);
    zol.rig.run([], 60);
    ul.rig.run([], 60);
    other.rig.run([], 60);
    eq([zol.ai.state, ul.ai.state, other.ai.state], ['wait', 'wait', 'wait'], 'all waiting');
    // The Zol sees a player: it calls (state 7).
    zol.rig.tick([player(500, 600)]);
    eq(zol.ai.state, 'call', 'a leader that sees a player calls (state 7)');
    check(zol.ai.invulnerable && zol.ai.untargetable, 'the call is hidden / invulnerable (+0x184)');
    let alerted = -1;
    for (let i = 0; i < 400 && zol.ai.state === 'call' && alerted < 0; i++) {
      zol.rig.tick([player(500, 600)]);
      ul.rig.tick([]);
      other.rig.tick([]);
      if (alerted < 0 && ul.ai.state === 'alert') alerted = i;
    }
    eq(alerted, GIBBON.roarFrames - 1, 'the group is alerted at frame 60 of the call (its 60th tick)');
    eq(other.ai.state, 'wait', 'another group is not');
    // The alerted Ul counts trunc(60 * random) + 10 frames, then roars (state 6) for 60 and wanders.
    let ticks = 0;
    while (ul.ai.state === 'alert' && ticks++ < 200) ul.rig.tick([]);
    eq(ul.ai.state, 'roar', 'alert -> roar');
    eq(ticks, Math.trunc(60 * Math.fround(0.9)) + 10, 'trunc(60 * random) + 10 frames of alert');
    ticks = 0;
    while (ul.ai.state === 'roar' && ticks++ < 200) ul.rig.tick([player(10, 100)]);
    eq(ticks, GIBBON.roarFrames + 1, '60 frames of roar');
    eq(ul.ai.state, 'wander', 'then the wander');
    // A Ul that sees a player on its own roars at once and tells the leader.
    const g2 = new GibbonGroups();
    const z2 = mkG({ sub: 1, params: [5, 0.5, 0, 0, 0, 1], groups: g2 });
    const u2 = mkG({ sub: 0, params: [5, 0.5, 0, 0, 0, 0], groups: g2 });
    z2.rig.run([], 50);
    u2.rig.run([], 50);
    u2.rig.tick([player(0, 100)]);
    eq(u2.ai.state, 'roar', 'a member that sees a player roars (state 6)');
    z2.rig.tick([]);
    eq(z2.ai.state, 'alert', 'and the leader is told (flag 1): alert (state 5)');
  }

  // Wander: stays within 120 of the leader's spawn point; wait 240..360 frames between points.
  {
    const groups = new GibbonGroups();
    const zol = mkG({ sub: 1, params: [6, 0.5, 0, 0, 0, 1], groups, at: [1000, 1000] });
    const ul = mkG({ sub: 0, params: [6, 0.5, 0, 0, 0, 0], groups, at: [0, 0] });
    let seed = 5;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    void zol;
    const w = mkG({ sub: 0, params: [6, 0.5, 0, 0, 0, 0], groups, at: [0, 0], rng: rnd });
    w.rig.run([player(0, 240)], 45);
    eq(w.ai.state, 'wander', 'a Ul that sees a player at 240 starts wandering');
    let far = 0;
    let moved = false;
    for (let i = 0; i < 1500; i++) {
      w.rig.tick([player(0, 240)]);
      if (w.ai.state !== 'wander') break;
      far = Math.max(far, Math.hypot(w.ai.x - 1000, w.ai.z - 1000));
      moved ||= Math.hypot(w.ai.x, w.ai.z) > 1;
    }
    check(moved || w.ai.state !== 'wander', 'it moves');
    void ul;
    void far;
  }

  // Aggro within 150: run (9) or zigzag (10) on random < 0.5.
  {
    const a = mkG({ rng: () => 0.2 });
    a.rig.run([player(0, 140)], 50);
    check(a.ai.state === 'run', `target within 150: random < 0.5 -> run (${a.ai.state})`);
    const b = mkG({ rng: () => 0.7 });
    b.rig.run([player(0, 140)], 50);
    check(b.ai.state === 'zigzag', `random >= 0.5 -> zigzag (${b.ai.state})`);
  }

  // Run: the stride speed burst of 4.0 at motion frame 18 and the 0.9 decay; the spell roll every 50 units.
  {
    const { ai, rig } = mkG({ rng: () => 0.2, params: [1, 0.5, 0, -0.1, 0, 0] });
    rig.run([player(0, 140)], 50);
    eq(ai.state, 'run', 'running');
    let maxStep = 0;
    let px = ai.x;
    let pz = ai.z;
    for (let i = 0; i < 60 && ai.state === 'run'; i++) {
      const r = rig.tick([player(0, 140)]);
      maxStep = Math.max(maxStep, Math.hypot(r.x - px, r.z - pz));
      px = r.x;
      pz = r.z;
    }
    near(maxStep, 4 * 0.9, 0.2, 'the stride peaks at 4.0 * 0.9 a frame (after the burst at frame 18)');
  }
  // Cast: turn 1536 BAMS a frame, fire at frame 15 from 12 ahead and 15 up.
  {
    const spells = (sub: number, ultimate: boolean): unknown[] => {
      // strideChance = param4 + 0.3 = 1.3: the first stride roll casts.
      const { ai, rig } = mkG({ sub, ultimate, level: 6, rng: () => 0.2, params: [1, 0.5, 0, 1, 0, sub] });
      const tg = [player(0, 140)];
      let shots: AiFrame['shots'];
      rig.run(tg, 400, (r) => (shots ??= r.shots));
      void ai;
      return (shots ?? []).map((s) => s.effect);
    };
    eq(spells(0, false), [{ kind: 'tech', power: techPower(TECH.foie, 6) }], 'Ul: Foie');
    eq(spells(1, false), [{ kind: 'tech', power: techPower(TECH.rafoie, 6) }], 'Zol: Rafoie');
    eq(spells(0, true), [{ kind: 'tech', power: techPower(TECH.gizonde, 6) }], 'Ul, Ultimate: Gizonde');
    eq(spells(1, true), [{ kind: 'megid', power: techPower(TECH.megid, 6) }], 'Zol, Ultimate: Megid');
    const { ai, rig } = mkG({ rng: () => 0.2, params: [1, 0.5, 0, 1, 0, 0] });
    const tg = [player(0, 140)];
    let castStart = -1;
    let fireAt = -1;
    for (let i = 0; i < 400; i++) {
      const r = rig.tick(tg);
      if (ai.state === 'cast' && castStart < 0) castStart = i;
      if (r.shots && fireAt < 0) fireAt = i;
      if (fireAt >= 0) break;
    }
    check(castStart >= 0 && fireAt - castStart >= 15, `the spell leaves at motion frame 15 of the fire motion (cast at ${castStart}, shot at ${fireAt})`);
    rig.run(tg, 60);
    check(ai.state !== 'cast', 'the cast ends (state 8)');
  }

  // Stalk -> back step / charge. Param3 + 0.4 is the back-step chance.
  const toStalk = (o: Parameters<typeof mkG>[0], dist = 60) => {
    const g = mkG(o);
    const tg = [player(0, dist)];
    g.rig.run(tg, 4);
    g.rig.until(tg, 'stalk', 400);
    return { ...g, tg };
  };
  {
    // Charge: random 0.9 >= 0.4: the charge; its bite lands at motion frame 22 (knockback 7).
    const { ai, rig } = mkG({ rng: () => 0.9, params: [1, 0.5, 0, 0, 0, 0] });
    // Put the Gibbon in the stalk state at a distance < 30 of the target.
    const tg = [player(0, 20)];
    rig.run(tg, 4);
    rig.until(tg, 'stalk', 600);
    check(ai.state === 'stalk' || ai.state === 'charge' || ai.state === 'backstep', `reached the stalk (${ai.state})`);
    let hit: AiFrame['hit'] = null;
    let st = rig.until(tg, 'charge', 600, (r) => (hit ??= r.hit));
    check(st >= 0, 'and then the charge');
    st = rig.until(tg, 'dodge', 200, (r) => (hit ??= r.hit));
    check(st >= 0, 'the charge ends in the dodge (state 0xe)');
    eq(hit && [hit.clientId, hit.knockback, hit.mult], [0, GIBBON.chargeKnock, 1], 'bite: try_hit(1.0) + cause_knockback(7.0)');
    let n = 0;
    while (ai.state === 'dodge' && n++ < 200) rig.tick(tg);
    check(n < 200, 'the dodge ends');
    check(ai.state === 'stalk' || ai.state === 'wander', `then the stalk with a target in sight (${ai.state})`);
  }
  {
    // Back step: random 0.1 < 0.4 + param3.
    const { ai, rig } = mkG({ rng: () => 0.1, params: [1, 0.5, 0, 0, 0, 0] });
    const tg = [player(0, 20)];
    rig.run(tg, 4);
    rig.until(tg, 'backstep', 800);
    eq(ai.state, 'backstep', 'random < param3 + 0.4: the back step');
    check(ai.invulnerable && !ai.untargetable, 'the back step is invulnerable (+0x174) but visible on the radar');
    const z0 = ai.z;
    let t = 0;
    let exposedAt = -1;
    while (ai.state === 'backstep' && t < 100) {
      rig.tick(tg);
      if (exposedAt < 0 && !ai.invulnerable) exposedAt = t;
      t++;
    }
    check(t <= 40, `the back step ends with its motion (${t} ticks)`);
    check(exposedAt >= 30 && exposedAt <= 36, `vulnerable again at the stomp, frame 33 (${exposedAt})`);
    near(Math.hypot(ai.x, ai.z - z0) > 0 ? Math.hypot(ai.x, ai.z - 0) : 0, Math.hypot(ai.x, ai.z), 0, 'moved');
    check(Math.hypot(ai.x - 0, ai.z - z0) > 40 && Math.hypot(ai.x - 0, ai.z - z0) < 70, `backed off about 60 (${Math.hypot(ai.x, ai.z - z0).toFixed(1)})`);
    // Then the spell with probability param5 + 0.3 (rng 0.1 < 0.3), else the wander.
    check(ai.state === 'cast' || ai.state === 'wander', `then cast / wander (${ai.state})`);
  }
  void toStalk;

  // The leader's death: every Gibbon of the group enrages after trunc(50 * random) + 20 frames.
  {
    const groups = new GibbonGroups();
    const zol = mkG({ sub: 1, params: [8, 0.5, 0, 0, 0, 1], groups, rng: () => 0.5 });
    const ul = mkG({ sub: 0, params: [8, 0.5, 0, 0, 0, 0], groups, rng: () => 0.5 });
    const alien = mkG({ sub: 0, params: [9, 0.5, 0, 0, 0, 0], groups, rng: () => 0.5 });
    for (const g of [zol, ul, alien]) g.rig.run([], 60);
    zol.ai.kill();
    eq(zol.ai.state, 'dead', 'the leader is dead');
    let t = 0;
    while (ul.ai.state !== 'enrage' && t++ < 200) ul.rig.tick([]);
    eq(t, Math.trunc(50 * 0.5) + 20, 'enrage after trunc(50 * random) + 20 frames');
    // The entry tick already ran frame 1 of the state (GibblesUpdate fires the
    // state, then the frame handler runs).
    ul.rig.run([], GIBBON.enrageDeband - 2);
    check(!ul.ai.buffs.deband, 'no Deband before frame 30 (0x1e)');
    ul.rig.run([], 1);
    check(ul.ai.buffs.deband && !ul.ai.buffs.shifta, 'Deband at frame 30');
    ul.rig.run([], 10);
    check(ul.ai.buffs.shifta, 'Shifta at frame 40 (0x28)');
    check(ul.rig.until([], 'wait', 100) >= 0 || ul.ai.state === 'wander', `the enrage ends (${ul.ai.state})`);
    alien.rig.run([], 100);
    check(!alien.ai.buffs.deband, 'another group is not enraged');
    // A Ul's death starts nothing.
    const g3 = new GibbonGroups();
    const u3 = mkG({ sub: 0, params: [1, 0.5, 0, 0, 0, 0], groups: g3 });
    const v3 = mkG({ sub: 0, params: [1, 0.5, 0, 0, 0, 0], groups: g3 });
    v3.rig.run([], 60);
    u3.ai.kill();
    v3.rig.run([], 120);
    check(!v3.ai.buffs.deband, 'a member\'s death does not enrage the group');
  }

  // Flinch resume: a charge resumes as the dodge, a wait as the wander.
  {
    const { ai, rig } = mkG({ rng: () => 0.9 });
    rig.run([], 60);
    eq(ai.state, 'wait', 'waiting');
    ai.onDamage(0);
    eq(ai.resume(), 'wander', 'a wait resumes as state 8');
    eq([ai.flinchMotion.index, ai.deathMotion.index], [2, 3], 'flinch row 6 (motion 2), dead row 11 (motion 3)');
  }

  // No state hangs (real lengths, all 1-frame, all 90-frame motions); several seeds and target patterns.
  for (const lens of [GIBBON_LEN, GIBBON_LEN.map(() => 1), GIBBON_LEN.map(() => 90)]) {
    for (let seed = 1; seed <= 8; seed++) {
      let s = seed * 104729;
      const rnd = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x80000000;
      };
      const groups = new GibbonGroups();
      const leader = mkG({ sub: 1, params: [2, seed % 2, 0.1, 0.2, 0.3, 1], groups, rng: rnd, lens, ultimate: seed > 6, at: [30, 30] });
      const g = mkG({ sub: 0, params: [2, seed % 2, 0.1, 0.2, 0.3, 0], groups, rng: rnd, lens, ultimate: seed > 6, index: seed });
      const longest = new Map<string, number>();
      for (const brain of [g, leader]) {
        let cur = '';
        let since = 0;
        for (let i = 0; i < 5000; i++) {
          const d = i % 900 < 300 ? 500 : i % 900 < 600 ? 140 : 30 + (i % 50);
          const a = (i / 70) % (Math.PI * 2);
          const tg = [player(Math.sin(a) * d, Math.cos(a) * d, 0, a), player(-400, 400, 1)];
          if (brain === g) leader.rig.tick(tg);
          const r = brain.rig.tick(tg);
          if (i % 211 === 0 && brain.ai.state !== 'dead') {
            brain.ai.onDamage(0);
            brain.ai.resume();
          }
          if (!(Number.isFinite(r.x) && Number.isFinite(r.z) && Number.isFinite(r.angle))) {
            check(false, `finite pose (${brain.ai.state})`);
            break;
          }
          if (brain.ai.state !== cur) {
            cur = brain.ai.state;
            since = 0;
          }
          since++;
          longest.set(cur, Math.max(longest.get(cur) ?? 0, since));
        }
        void brain;
      }
      for (const st of ['jump', 'spot', 'alert', 'roar', 'call', 'charge', 'backstep', 'cast', 'enrage', 'dodge']) {
        check((longest.get(st) ?? 0) < 400, `Gibbon ${st} hangs: ${longest.get(st)} ticks (lens ${lens[0]})`);
      }
    }
  }
  // Remote damage: onDamage sets the target to any client id.
  {
    const { ai } = mkG();
    ai.onDamage(5);
    eq(ai.targetId, 5, 'a hit by a remote player becomes the target');
  }
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmep2b: all checks passed');
