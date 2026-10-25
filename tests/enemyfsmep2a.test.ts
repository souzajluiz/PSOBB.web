// Episode 2 FSMs, part 2 (combat/enemyfsmep2a.ts): Gee (hovering spike
// shooter), Gi Gue (barrier, spits, bomb, Jellen / Zalure, hop) and Gibbles
// (waiting, drop-in, triple slam, guard, rage swing, leap).
// The Episode 2 archives are not on this machine, so the motion lengths below
// are plausible stand-ins (a run with several lengths guards against a state
// that waits on a length: nothing may hang).
// Run: node tests/enemyfsmep2a.test.ts
import { GEE, GIBBLES, GIGUE, GeeAi, GibblesAi, GiGueAi, GiGueBomb, GiGueSpit, GroundBlast, type GeeState, type GibblesState } from '../client/src/combat/enemyfsmep2a.ts';
import type { AiFrame, AiTarget } from '../client/src/combat/enemyai.ts';
import { STATUS } from '../client/src/combat/status.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, tol: number, what: string) => check(Math.abs(a - b) <= tol, `${what}: ${a} != ${b} (+-${tol})`);
const player = (x: number, z: number, clientId = 0, extra: Partial<AiTarget> = {}): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle: 0, ...extra });
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Drives a brain: a one-shot motion ends `len(index)` motion frames after it
// started (the owner's animator.ended).
interface Brain {
  tick(t: readonly AiTarget[], ended?: boolean): AiFrame;
  motion: { index: number; speed: number; loop: boolean } | null;
  state: string;
}
class Rig<B extends Brain> {
  frames = 0;
  t = 0;
  ai: B;
  private len: (index: number) => number;
  constructor(ai: B, len: (index: number) => number = () => 40) {
    this.ai = ai;
    this.len = len;
  }
  step(targets: readonly AiTarget[]): AiFrame {
    const m = this.ai.motion;
    const ended = !!m && !m.loop && this.frames >= this.len(m.index);
    const r = this.ai.tick(targets, ended);
    if (r.motion) this.frames = 0;
    else this.frames += this.ai.motion?.speed ?? 0;
    this.t++;
    return r;
  }
  run(targets: readonly AiTarget[], n: number, each?: (r: AiFrame, t: number) => void): void {
    for (let i = 0; i < n; i++) {
      const r = this.step(targets);
      each?.(r, this.t - 1);
    }
  }
  // Runs until the brain is in `state`; returns the ticks it took (or -1).
  until(targets: readonly AiTarget[], state: string, max: number, each?: (r: AiFrame, t: number) => void): number {
    for (let i = 0; i < max; i++) {
      if (this.ai.state === state) return i;
      const r = this.step(targets);
      each?.(r, this.t - 1);
    }
    return this.ai.state === state ? max : -1;
  }
}

const geeMove = (o: Partial<{ f1: number; f2: number; i1: number; i3: number; i4: number; i5: number }> = {}) => ({
  fparam1: o.f1 ?? 0.9,
  fparam2: o.f2 ?? 150,
  fparam3: 180,
  fparam4: 0,
  fparam5: 0,
  fparam6: 0,
  iparam: [o.i1 ?? 45, 30, o.i3 ?? 65, o.i4 ?? 2, o.i5 ?? 50, 0],
});
const gee = (params: number[], rng: () => number = () => 0.3, o = {}) => new GeeAi({ x: 0, z: 0, angle: 0, params, movement: geeMove(o), rng });

// --- Gee ----------------------------------------------------------------------
{
  // Ground start: 4 frames of state 0, the 40-frame rise (state 1), then idle.
  const g = gee([1, 0, 0, 0]);
  const rig = new Rig(g);
  const seen: [number, string][] = [];
  let prev = '';
  rig.run([], 80, (_r, t) => {
    if (g.state !== prev) seen.push([t, g.state]);
    prev = g.state;
  });
  eq(seen, [[0, 'spawn'], [4, 'rise'], [44, 'idle']], 'Gee: spawn 4 frames, rise 40 frames, idle');
  const early = gee([1, 0, 0, 0]);
  check(early.invulnerable, 'Gee: invulnerable while it spawns');
  const r44 = new Rig(early);
  r44.run([], 45);
  check(!early.invulnerable, 'Gee: vulnerable once it hovers');
  near(early.lift, GEE.hover, 0, 'Gee: drawn 15 above the ground');

  // Ceiling start: hidden 40 frames at 150, then down by max(1, param3 + 1).
  for (const [p3, step] of [[0, 1], [2, 3], [-3, 1]] as const) {
    const d = gee([1, 1, p3, 0]);
    const rd = new Rig(d);
    rd.run([], 4 + 20);
    eq(d.state, 'drop', `Gee: param2 != 0 drops from the ceiling (step ${step})`);
    near(d.lift, 150, 0, 'Gee: waits at 150 while the effect plays');
    const ticks = rd.until([], 'idle', 400);
    const expect = 40 - 20 + Math.ceil((150 - 15) / step) + 1;
    check(ticks >= expect - 2 && ticks <= expect + 3, `Gee: the drop takes ${expect} frames at step ${step} (${ticks})`);
    near(d.lift, 15, 0, 'Gee: ends at the hover height');
  }

  // The attack cycle against a player 120 away: alert 19 frames, climb 61
  // frames, two volleys of shots, melee; the strafe between.
  for (const len of [24, 40, 80]) {
    const g2 = gee([1, 0, 0, 0], () => 0.3);
    const rig2 = new Rig(g2, () => len);
    const order: string[] = [];
    const spikes: number[] = [];
    let last = '';
    const target = [player(0, 120)];
    rig2.run(target, 1500, (r) => {
      if (g2.state !== last) order.push(g2.state);
      last = g2.state;
      if (r.shots) spikes.push(r.shots.length);
    });
    const head = order.slice(0, 10).join(',');
    check(head.startsWith('spawn,rise,idle,alert,climb,shoot,strafe,shoot,strafe,melee'), `Gee (motions ${len}): spawn..shoot,strafe,shoot,strafe,melee (${head})`);
    check(spikes[0] === 1 && spikes.length >= 3, `Gee (motions ${len}): spikes are shot (${spikes.slice(0, 5)})`);
  }

  // Timings of alert and climb.
  {
    const g3 = gee([1, 0, 0, 0]);
    const rig3 = new Rig(g3);
    const times: Record<string, number> = {};
    let last = '';
    rig3.run([player(0, 150)], 400, (_r, t) => {
      if (g3.state !== last) times[g3.state] = t;
      last = g3.state;
    });
    eq(times.climb - times.alert, 19, 'Gee: the alert lasts 19 frames (the colour fade-up)');
    eq(times.shoot - times.climb, 61, 'Gee: the climb to 45 takes 61 frames');
  }

  // The spike: speed 6 + param4, power fparam2, hits a player at its aim point.
  {
    const g4 = gee([1, 0, 0, 2.5], () => 0.3, { i1: 5, i3: 5, i4: 1 });
    const rig4 = new Rig(g4);
    const p = player(0, 60);
    let spike: AiFrame['shots'] extends (infer S)[] | undefined ? S : never = undefined as never;
    rig4.run([p], 1200, (r) => {
      if (r.shots && !spike) spike = r.shots[0];
    });
    check(!!spike, 'Gee: a spike is shot');
    if (spike) {
      eq(spike.effect, { kind: 'tech', power: 150 }, 'Gee: the spike hits with entity_hit_by_tech, power fparam2');
      let hit: AiTarget[] = [];
      for (let i = 0; i < 160 && !spike.done; i++) {
        const h = spike.tick([p]);
        if (h.length) hit = h;
      }
      eq(hit.map((x) => x.clientId), [0], 'Gee: the spike reaches the player it was aimed at');
      const off = gee([1, 0, 0, 2.5], () => 0.3, { i1: 5, i3: 5, i4: 1 });
      const ro = new Rig(off);
      let s2: typeof spike | undefined;
      ro.run([p], 1200, (r) => {
        if (r.shots && !s2) s2 = r.shots[0];
      });
      let n = 0;
      while (s2 && !s2.done && n < 400) {
        s2.tick([player(500, 500)]);
        n++;
      }
      check(n <= 152 && n > 5, `Gee: a missed spike is gone after 150 frames at most (${n})`);
    }
  }

  // Melee: the sting lands at motion frame 10, knockback 3, slow on 25 %.
  for (const [roll, slow] of [[0.2, true], [0.9, false]] as const) {
    const g5 = gee([0, 0, 0, 0], () => roll);
    const rig5 = new Rig(g5, (i) => (i === 2 ? 30 : 40));
    const p = player(0, 10);
    let hit: AiFrame['hit'] = null;
    let status: AiFrame['status'] = null;
    rig5.run([p], 900, (r) => {
      if (r.hit && !hit) hit = r.hit;
      if (r.status && !status) status = r.status;
    });
    eq(hit && [hit.knockback, hit.mult], [3, 1], 'Gee: the sting is try_hit_entity(1.0) + cause_knockback(3.0)');
    eq(!!status, slow, `Gee: slow (group 0x11) on a roll of ${roll}`);
    if (status) eq((status as { type: number }).type, STATUS.slow, 'Gee: the status is slow');
  }

  // The melee-only variant never shoots.
  {
    const g6 = gee([0, 0, 0, 0]);
    const rig6 = new Rig(g6);
    const order = new Set<string>();
    rig6.run([player(0, 20)], 1500, () => order.add(g6.state));
    check(!order.has('shoot') && order.has('melee') && order.has('strafe'), 'Gee: param1 == 0 only lunges');
  }

  // The strafe: four dashes ending 70 from the player; only the first is invulnerable.
  {
    const g7 = gee([1, 0, 0, 0], () => 0.3);
    const rig7 = new Rig(g7);
    const p = player(0, 60);
    rig7.until([p], 'strafe', 3000);
    check(g7.state === 'strafe', 'Gee: reaches the strafe');
    const d0 = Math.hypot(g7.x - p.x, g7.z - p.z);
    check(g7.invulnerable, 'Gee: the first dash is invulnerable');
    let dashes = 0;
    let inDash = false;
    let end = 0;
    for (let i = 0; i < 400 && g7.state === 'strafe'; i++) {
      const before = { x: g7.x, z: g7.z };
      rig7.step([p]);
      const moved = Math.hypot(g7.x - before.x, g7.z - before.z) > 3;
      if (moved && !inDash) dashes++;
      inDash = moved;
      if (moved) end = Math.hypot(g7.x - p.x, g7.z - p.z);
    }
    check(dashes >= 4 || g7.state !== 'strafe', `Gee: four dashes (${dashes})`);
    near(end, GEE.strafeRadius, 1, `Gee: a dash ends 70 from the player (from ${d0.toFixed(1)})`);
  }

  // A hit: the flinch, then back to the state it left, within the hold.
  for (const target of [[], [player(0, 100)]]) {
    const g8 = gee([1, 0, 0, 0]);
    const rig8 = new Rig(g8);
    rig8.run(target, 160);
    const before = g8.state as GeeState;
    g8.onDamage(0);
    rig8.step(target);
    const reaction = g8.state;
    const back = rig8.until(target, before, 400);
    check(reaction === 'flinch' || before === 'spawn', `Gee: a hit starts the flinch (${before} -> ${reaction})`);
    check(back >= 0 || reaction !== 'flinch', `Gee: the flinch ends (${before})`);
    eq(g8.flinches(), false, 'Gee: the owner plays no damage motion');
  }

  // A hit while it is invulnerable does nothing.
  {
    const g9 = gee([1, 0, 0, 0]);
    const rig9 = new Rig(g9);
    rig9.run([], 10);
    g9.onDamage(3);
    rig9.step([]);
    eq(g9.state, 'rise', 'Gee: no flinch while it rises');
  }

  // Losing the target sends it home; a target brings it back.
  {
    const g10 = gee([1, 0, 0, 0]);
    const rig10 = new Rig(g10);
    const p = player(0, 80);
    rig10.until([p], 'shoot', 800);
    rig10.run([p], 30);
    rig10.run([], 400);
    eq(g10.state, 'lost', 'Gee: no target -> lost');
    check(Math.hypot(g10.x, g10.z) < 3, `Gee: back at the spawn point (${Math.hypot(g10.x, g10.z).toFixed(1)})`);
    rig10.run([player(0, 100)], 300);
    check(g10.state !== 'lost', 'Gee: a target ends the wait');
  }

  // No hang: players come and go, hits land, for a long time.
  for (const len of [10, 30, 70]) {
    const r = mulberry(len);
    const g11 = gee([r() < 0.5 ? 0 : 1, r() < 0.5 ? 0 : 1, 0, 0], r);
    const rig11 = new Rig(g11, () => len);
    let stuck = 0;
    let lastState = '';
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const phase = Math.floor(i / 700) % 3;
      const targets = phase === 0 ? [] : [player(Math.sin(i / 90) * 120, 40 + (i % 300) / 3)];
      if (r() < 0.004) g11.onDamage(0);
      rig11.step(targets);
      if (g11.state === lastState && phase !== 0 && g11.state !== 'idle' && g11.state !== 'lost') stuck++;
      else stuck = 0;
      lastState = g11.state;
      worst = Math.max(worst, stuck);
      if (!Number.isFinite(g11.x) || !Number.isFinite(g11.z) || !Number.isFinite(g11.lift)) {
        check(false, 'Gee: finite position');
        break;
      }
    }
    check(worst < 900, `Gee (motions ${len}): no state hangs with a target (${worst})`);
  }
}

// --- Gi Gue -------------------------------------------------------------------
const gigueMove = { fparam1: 5, fparam2: 5, fparam3: 7, fparam4: 3, fparam5: -0.5, fparam6: 0.25, iparam: [500, 250, 4, 3, 0, 0] };
const gigueAtk = { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 300, angle: 12288, distanceY: 0 };
const gigue = (params: number[], rng: () => number = () => 0.3) => new GiGueAi({ x: 0, z: 0, angle: 0, params, attack: gigueAtk, movement: gigueMove, rng });
{
  // Emergence: 40 frames invulnerable, then idle.
  const g = gigue([0, 0, 0, 0, 0]);
  const rig = new Rig(g);
  check(g.invulnerable && g.state === 'emerge', 'Gi Gue: starts in the emergence, invulnerable');
  const n = rig.until([], 'idle', 100);
  check(n >= 38 && n <= 42, `Gi Gue: the emergence lasts 40 frames (${n})`);
  check(!g.invulnerable, 'Gi Gue: vulnerable afterwards');

  // Sky start: 150 + param3 high, 2.3 a frame, then the approach.
  for (const p3 of [0, 40]) {
    const s = gigue([1, 0, p3, 0, 0]);
    const rs = new Rig(s);
    rs.step([]);
    near(s.lift, 150 + p3 - 2.3, 0.01, `Gi Gue: falls from 150 + ${p3}`);
    const ticks = rs.until([], 'approach', 400);
    const expect = Math.ceil((150 + p3) / 2.3);
    check(ticks >= expect - 3 && ticks <= expect + 3, `Gi Gue: ${expect} frames to the ground (${ticks})`);
    near(s.lift, 0, 0, 'Gi Gue: on the ground');
  }

  // A player in reach and in front: three rounds of spits (one each), the
  // confusion follows a roll against fparam6.
  for (const len of [10, 30, 60]) {
    const g2 = gigue([0, 0, 0, 0, 0], () => 0.2);
    const rig2 = new Rig(g2, () => len);
    const p = player(0, 120);
    const log: string[] = [];
    let last = '';
    let spits = 0;
    let statusSpits = 0;
    rig2.run([p], 400, (r) => {
      if (g2.state !== last) log.push(g2.state);
      last = g2.state;
      if (r.shots) {
        spits += r.shots.length;
        statusSpits += r.shots.filter((s) => s.effect.kind === 'status').length;
      }
    });
    check(log.slice(0, 4).join(',') === 'emerge,idle,approach,volley', `Gi Gue (${len}): emerge, idle, approach, volley (${log.join(',')})`);
    check(spits >= 3, `Gi Gue (${len}): the volley shoots spits (${spits})`);
    check(statusSpits * 2 === spits, `Gi Gue (${len}): a roll <= 0.25 adds the confusion hit to each spit (${spits}/${statusSpits})`);
  }

  // The spit: speed fparam3, steering strength fparam4 falling by fparam5, 90 frames.
  {
    const g3 = gigue([0, 0, 0, 0, 0], () => 0.9);
    const rig3 = new Rig(g3);
    const p = player(0, 120);
    let spit: NonNullable<AiFrame['shots']>[number] | undefined;
    rig3.run([p], 400, (r) => {
      if (r.shots && !spit) spit = r.shots[0];
    });
    check(!!spit, 'Gi Gue: a spit is shot');
    if (spit) {
      eq(spit.effect, { kind: 'tech', power: 250 }, 'Gi Gue: the spit hits with power iparam2');
      let n = 0;
      let hit = false;
      while (!spit.done && n < 300) {
        const before = { x: spit.x, z: spit.z };
        if (spit.tick([p]).length) hit = true;
        n++;
        void before;
      }
      check(n <= 95, `Gi Gue: a spit lives 90 frames at most (${n})`);
      void hit;
    }
  }

  // The barrier: after an attack on a roll <= param4 + 0.5, hits are blocked
  // for iparam4 * 30 frames; a blocked hit is answered with the bomb.
  {
    const g4 = gigue([0, 0, 0, 0, 0], () => 0.2);
    const rig4 = new Rig(g4);
    const p = player(0, 120);
    let up = -1;
    let down = -1;
    let bomb: NonNullable<AiFrame['shots']>[number] | undefined;
    rig4.until([p], 'barrier', 600);
    for (let i = 0; i < 400; i++) {
      rig4.step([p]);
      if (g4.invulnerable && up < 0) up = i;
      if (!g4.invulnerable && up >= 0 && down < 0) down = i;
    }
    check(up >= 0 && down > up, `Gi Gue: the barrier blocks hits, then goes (${up}..${down})`);
    const g5 = gigue([0, 0, 0, 0, 0], () => 0.2);
    const rig5 = new Rig(g5);
    rig5.until([p], 'barrier', 600);
    rig5.run([p], 50);
    g5.blocked(0);
    rig5.run([p], 60, (r) => {
      if (r.shots && g5.state === 'bomb' && !bomb) bomb = r.shots[0];
    });
    check(!!bomb, 'Gi Gue: a blocked hit is answered with the bomb');
    if (bomb) {
      eq(bomb.effect, { kind: 'tech', power: 500 }, 'Gi Gue: the bomb hits with power iparam1');
      const victims = [player(0, 120, 0), player(30, 120, 1), player(200, 120, 2)];
      let hit: AiTarget[] = [];
      for (let i = 0; i < 100 && !bomb.done; i++) hit = bomb.tick(victims);
      eq(hit.map((t) => t.clientId).sort(), [0, 1], 'Gi Gue: the bomb explodes in a radius of 40');
    }
  }

  // A player within 50 on a high roll: the Jellen / Zalure cast and a hop.
  {
    const g6 = gigue([0, 0, 0, 0, 0], () => 0.1);
    const rig6 = new Rig(g6);
    // Just outside the 67 degree cone at first (35 degrees), inside it after one
    // turn of the approach; the other player is behind. Both are 43 away, inside
    // the stomp's reach (55 at level 4); the far one is 70 away and is not hit.
    const near1 = player(25, 35, 0);
    const behind = player(25, -35, 1);
    const far = player(0, -70, 2);
    rig6.run([near1, behind, far], 300);
    const events = g6.events.splice(0);
    eq(events.map((e) => [e.clientId, e.tech]).sort(), [[0, 'jellen'], [0, 'zalure'], [1, 'jellen'], [1, 'zalure']].sort(), 'Gi Gue: the stomp hits the players within reach, not the far one');
    eq(events.slice(0, 2).map((e) => [e.tech, e.level]), [['zalure', 4], ['zalure', 4]], 'Gi Gue: iparam3 is the level (the Zalure object first)');
  }

  // The stomp's reach follows the level: 79 at level 10 (range_h 74 + 5), so a
  // player 70 away is hit there (not at level 4).
  {
    const g8 = new GiGueAi({ x: 0, z: 0, angle: 0, params: [0, 0, 0, 0, 0], attack: gigueAtk, movement: { ...gigueMove, iparam: [500, 250, 10, 3, 0, 0] }, rng: () => 0.1 });
    const rig8 = new Rig(g8);
    rig8.run([player(25, 35, 0), player(0, -70, 1)], 300);
    const hits = g8.events.splice(0);
    check(hits.some((e) => e.clientId === 1 && e.tech === 'jellen') && hits.some((e) => e.clientId === 1 && e.tech === 'zalure'), 'Gi Gue: the level 10 stomp reaches 70');
    eq(hits.every((e) => e.level === 10), true, 'Gi Gue: the stomp carries iparam3 = 10');
  }

  // The exact edge at level 4 (range_h 50 + 5 = 55, strict): 54.5 is hit, 55 is not.
  {
    const g9 = new GiGueAi({ x: 0, z: 0, angle: 0, params: [0, 0, 0, 0, 0], attack: gigueAtk, movement: gigueMove, rng: () => 0.1 });
    const rig9 = new Rig(g9);
    rig9.run([player(25, 35, 0), player(0, -54.5, 1), player(0, -55, 2)], 300);
    const edge = g9.events.splice(0);
    check(edge.some((e) => e.clientId === 1 && e.tech === 'jellen') && edge.some((e) => e.clientId === 1 && e.tech === 'zalure'), 'Gi Gue: a player 54.5 away is inside the level 4 stomp');
    check(!edge.some((e) => e.clientId === 2), 'Gi Gue: a player exactly 55 away is outside the stomp (strict)');
  }

  // The hop: crouch 60 frames, rise to 50 at 2.2, fly 200 away at fparam1, drop 2.3 a frame.
  {
    const g7 = gigue([0, 0, 0, 0, 0], () => 0.9);
    const rig7 = new Rig(g7);
    const p = player(0, 30);
    rig7.until([p], 'hop', 400);
    let peak = 0;
    for (let i = 0; i < 400 && g7.state === 'hop'; i++) {
      rig7.step([p]);
      peak = Math.max(peak, g7.lift);
    }
    near(peak, 50, 3, 'Gi Gue: the hop peaks at 50');
    near(Math.hypot(g7.x - 0, g7.z - 0), 190, 15, 'Gi Gue: it lands about 200 away from where it started');
    check(g7.z < 0, 'Gi Gue: away from the player');
    near(g7.lift, 0, 0, 'Gi Gue: back on the ground');
  }

  // A hit: the flinch (not in the bomb / prepare / hop), a quarter of the HP is answered with a volley.
  {
    const g8 = gigue([0, 0, 0, 0, 0], () => 0.9);
    const rig8 = new Rig(g8, () => 20);
    const p = player(0, 120);
    rig8.until([p], 'approach', 300);
    g8.hpFraction = 0.6;
    g8.onDamage(0);
    rig8.step([p]);
    eq(g8.state, 'flinch', 'Gi Gue: a hit starts the flinch');
    const seen = new Set<string>();
    rig8.run([p], 200, () => seen.add(g8.state));
    check(seen.has('volley'), 'Gi Gue: a hit of 25 % or more is answered with a volley');
    eq(g8.flinches(), false, 'Gi Gue: the owner plays no damage motion');
  }

  // No hang.
  for (const len of [10, 30, 70]) {
    const r = mulberry(len + 100);
    const g9 = gigue([r() < 0.5 ? 0 : 1, 0, 0, r(), r()], r);
    const rig9 = new Rig(g9, () => len);
    let stuck = 0;
    let lastState = '';
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const phase = Math.floor(i / 500) % 3;
      const targets = phase === 0 ? [] : [player(Math.sin(i / 70) * 180, 20 + (i % 260) / 2), player(-50, 80, 1)];
      if (r() < 0.004) g9.onDamage(0);
      if (r() < 0.002) g9.blocked(0);
      g9.hpFraction = Math.max(0.1, 1 - (i % 4000) / 4000);
      rig9.step(targets);
      if (g9.state === lastState && g9.state !== 'idle' && g9.state !== 'approach') stuck++;
      else stuck = 0;
      lastState = g9.state;
      worst = Math.max(worst, stuck);
      if (!Number.isFinite(g9.x) || !Number.isFinite(g9.z) || !Number.isFinite(g9.lift)) {
        check(false, 'Gi Gue: finite position');
        break;
      }
      g9.events.length = 0;
    }
    check(worst < 600, `Gi Gue (motions ${len}): no state hangs (${worst})`);
  }
}

// --- Gibbles ------------------------------------------------------------------
const at = (minAtp: number, distanceX: number, angle: number) => ({ minAtp, maxAtp: 0, minAta: 0, maxAta: 0, distanceX, angle, distanceY: 0 });
const gibAttacks = [at(300, 30, 8192), at(500, 50, 12288), at(400, 30, 7281)];
const gibMove = { fparam1: 0.7, fparam2: 7, fparam3: 0.8, fparam4: 0.3, fparam5: 0, fparam6: 0, iparam: [0, 0, 0, 0, 0, 0] };
const gibbles = (params: number[] = [0, 0, 0, 0], rng: () => number = () => 0.9) => new GibblesAi({ x: 0, z: 0, angle: 0, params, attacks: gibAttacks, movement: gibMove, rng });
const gibLen = (long: number) => (i: number) => (i === 0 ? long : i === 4 ? 34 : 20);
{
  // Waiting: hidden and untouchable until a player is within 200.
  const g = gibbles();
  const rig = new Rig(g, gibLen(60));
  const hidden: boolean[] = [];
  rig.run([player(0, 230)], 100, (r) => hidden.push(!!r.hidden));
  check(g.state === 'dormant' && g.invulnerable && hidden.every(Boolean), 'Gibbles: hidden and invulnerable while nobody is within 200');
  check(g.untargetable, 'Gibbles: untargetable (not drawn) while it lies in wait');
  const p = player(0, 150);
  const n = rig.until([p], 'arrive', 100);
  check(n >= 0, 'Gibbles: a player within 200 starts the drop-in');
  let blast: GroundBlast | undefined;
  let hiddenFor = 0;
  let hiddenMismatch = 0;
  rig.run([p], 400, (r) => {
    if (r.hidden) hiddenFor++;
    if (!!r.hidden !== g.untargetable) hiddenMismatch++;
    if (r.shots && !blast) blast = r.shots[0] as GroundBlast;
  });
  check(hiddenFor >= 39 && hiddenFor <= 45, `Gibbles: hidden through the 40-frame effect (${hiddenFor})`);
  check(hiddenMismatch === 0 && !g.untargetable, `Gibbles: untargetable exactly while hidden (${hiddenMismatch} mismatched frames)`);
  check(!!blast, 'Gibbles: the landing shockwave');
  if (blast) {
    eq(blast.effect, { kind: 'tech', power: 400 }, 'Gibbles: the shockwave is the second shockwave row (minAtp)');
    const hitList = blast.tick([player(25, 0, 0), player(80, 0, 1)]);
    eq(hitList.map((t) => t.clientId), [0], 'Gibbles: its radius is distance_x (30)');
  }
  check(g.state === 'approach' || g.state === 'combo' || g.state === 'leap', `Gibbles: fights after the landing (${g.state})`);
  check(!g.invulnerable || g.state === 'leap', 'Gibbles: vulnerable after the landing');
}
{
  // Walking speed fparam3, then the triple slam: three blasts at motion frames 8, 23 and 40.
  const g = gibbles();
  const rig = new Rig(g, gibLen(70));
  const p = player(0, 90);
  rig.until([p], 'approach', 300);
  const z0 = g.z;
  rig.run([p], 20);
  near(g.z - z0, 16, 2, 'Gibbles: walks 0.8 a frame');
  const blasts: number[] = [];
  const hands: number[] = [];
  const near2 = player(0, 25);
  rig.until([near2], 'combo', 200);
  check(g.state === 'combo' || g.z > 0, 'Gibbles: reaches the combo');
  let t0 = rig.t;
  rig.run([near2], 150, (r) => {
    if (r.shots) blasts.push(rig.t - t0);
    if (r.hit) hands.push(rig.t - t0);
  });
  check(blasts.length >= 3, `Gibbles: the triple slam (${blasts.length} blasts)`);
  check(hands.length >= 6, `Gibbles: the hands hit between the slams (${hands.length})`);
  check(hands.every((_h, i) => i === 0 || hands[i] - hands[i - 1] >= 1), 'Gibbles: hand hits are spaced');
  eq(new Set(hands.map((h) => (h + t0) % GIBBLES.handEvery)).size, 1, 'Gibbles: hand checks run on every fifth frame');
  t0 = 0;
}
{
  // The guard: a nearby attacking player makes it block for 12 frames; the
  // second block spends the 100 points and the rage swing follows, twice.
  const g = gibbles([0, 0, 0, 0]);
  const rig = new Rig(g, gibLen(70));
  const far = player(0, 100);
  rig.until([far], 'approach', 400);
  const atk = player(0, 20, 0, { attacking: true, angle: Math.PI });
  g.hpFraction = 1;
  let guarded = 0;
  const techs: number[] = [];
  const seen = new Set<string>();
  rig.run([atk], 400, (r) => {
    seen.add(g.state);
    if (g.state === 'guard') guarded++;
    if (r.techHit) techs.push(r.techHit.power);
  });
  check(seen.has('guard'), 'Gibbles: an attacking player in melee range raises the guard');
  check(guarded >= 12, `Gibbles: the guard holds (${guarded} frames)`);
  check(seen.has('rage') && techs.length >= 2 && techs.every((p) => p === 500), `Gibbles: with the guard spent the rage swing hits with the heavy row (${techs.slice(0, 3)})`);
}
{
  // The stagger, and the leap on a long way.
  const g = gibbles([0, 0, 0.5, 1], () => 0.2);
  const rig = new Rig(g, gibLen(70));
  const far = player(0, 100);
  rig.until([far], 'approach', 400);
  g.onDamage(0);
  rig.step([far]);
  eq(g.state, 'stagger', 'Gibbles: a hit staggers it');
  const seen = new Set<string>();
  rig.run([far], 200, () => seen.add(g.state));
  check(seen.has('leap'), 'Gibbles: param4 = 1 leaps after the stagger');
  eq(g.flinches(), false, 'Gibbles: the owner plays no damage motion');
  const dead = gibbles();
  eq(dead.deathMotion.index, 2, 'Gibbles: death is row 9 (motion 2)');
}
{
  const g = gibbles([0, 0, 0, 0], () => 0.9);
  const rig = new Rig(g, gibLen(70));
  const far = player(0, 190);
  rig.until([far], 'approach', 500);
  let landed = 0;
  let peak = 0;
  rig.run([far], 300, (r) => {
    if (g.state === 'leap') peak = Math.max(peak, g.lift);
    if (r.shots && g.state === 'leap') landed++;
  });
  check(peak > 20, `Gibbles: leaps (peak ${peak.toFixed(1)})`);
  check(landed >= 1, 'Gibbles: lands with a shockwave');
}
for (const len of [10, 34, 70]) {
  const r = mulberry(len + 200);
  const g = gibbles([r() * 3, 0, 0.5, 0.5], r);
  const rig = new Rig(g, gibLen(len));
  let stuck = 0;
  let lastState = '';
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const phase = Math.floor(i / 800) % 3;
    const targets = phase === 0 ? [] : [player(Math.sin(i / 120) * 150, 30 + (i % 240) / 2, 0, { attacking: i % 90 < 30, angle: Math.PI })];
    if (r() < 0.003) g.onDamage(0);
    g.hpFraction = 0.5;
    rig.step(targets);
    if (g.state === lastState && phase !== 0 && g.state !== 'approach' && g.state !== 'dormant') stuck++;
    else stuck = 0;
    lastState = g.state;
    worst = Math.max(worst, stuck);
    if (!Number.isFinite(g.x) || !Number.isFinite(g.z) || !Number.isFinite(g.lift)) {
      check(false, 'Gibbles: finite position');
      break;
    }
  }
  check(worst < 700, `Gibbles (motions ${len}): no state hangs (${worst})`);
}
// The sink of a dead Gibbles (0x005606d4): the death motion runs out, then 250
// ticks of a tenth of a unit, and it is removed on the tick after.
{
  const g = gibbles();
  eq(g.lift, 0, 'Gibbles sink: level while alive');
  g.kill();
  eq(g.removed, false, 'Gibbles sink: not removed at death');
  for (let i = 0; i < 20; i++) g.tickDead(false);
  eq([g.lift, g.removed], [0, false], 'Gibbles sink: no sink while the death motion runs');
  g.tickDead(true);
  eq(g.lift, 0, 'Gibbles sink: the motion-end tick starts the sink without moving');
  let removedAt = -1;
  let liftAt250 = 0;
  for (let k = 1; k <= 260; k++) {
    g.tickDead(false);
    if (k === 1) near(g.lift, -0.1, 1e-6, 'Gibbles sink: a tenth of a unit on the first tick');
    if (k === 100) near(g.lift, -10, 1e-3, 'Gibbles sink: 10 units after 100 ticks');
    if (k === 249) near(g.lift, -24.9, 1e-3, 'Gibbles sink: 24.9 units after 249 ticks');
    if (k === 250) liftAt250 = g.lift;
    if (g.removed && removedAt < 0) removedAt = k;
  }
  near(liftAt250, -25, 1e-3, 'Gibbles sink: 25 units after the 250th tick');
  eq(removedAt, 251, 'Gibbles sink: removed on the tick after the 250-tick sink');
  eq(g.lift, liftAt250, 'Gibbles sink: the sink stops once it is removed');
}

// --- Gibbles radar / lock-on / hit, per state (the exe's call sites, see enemyfsmep2a.ts setGate / enterBox)
// Each row: the state the handler ran in, the icon and reticle (the handler's calls), the box bit.
// The port's states only; exe 10 (the pre-activation shuffle) is not a port state.
{
  type Priv = { busy: boolean; sub: number; boxOn: boolean; targetId: number | null };
  const priv = (g: GibblesAi) => g as unknown as Priv;
  const one = (state: GibblesState, p: Partial<Priv>, targets: readonly AiTarget[] = [], busy = true) => {
    const g = gibbles();
    g.state = state;
    // The controller's search (every 30 frames) has picked the nearest player: targetId.
    Object.assign(priv(g), { busy, targetId: targets.length ? 0 : null, ...p });
    g.tick(targets, false);
    return g;
  };
  const gate = (g: GibblesAi) => [g.radar, g.lockable, g.hittable];
  // exe 0 / 1: no icon, no reticle, the box cleared.
  eq(gate(one('dormant', { boxOn: true })), [false, false, false], 'Gibbles gate 0 / 1 (dormant): no icon, no reticle, box off');
  // exe 2: icon and reticle; the box is cleared at entry.
  eq(gate(one('arrive', { boxOn: true })), [true, true, false], 'Gibbles gate 2 (arrive): icon and reticle, box off');
  // exe 3: the box is set before the target test; icon and reticle only with a target.
  eq(gate(one('approach', { boxOn: false }, [])), [false, false, true], 'Gibbles gate 3 (approach, no target): no icon, no reticle, box on');
  eq(gate(one('approach', { boxOn: false }, [player(0, 100)])), [true, true, true], 'Gibbles gate 3 (approach, target): icon, reticle, box on');
  // exe 4 / 5: icon, reticle, box set.
  eq(gate(one('combo', { boxOn: false })), [true, true, true], 'Gibbles gate 4 (combo): icon, reticle, box on');
  eq(gate(one('rage', { boxOn: false })), [true, true, true], 'Gibbles gate 5 (rage): icon, reticle, box on');
  // exe 6: icon and reticle; the box is kept through the windup, cleared by the launch and set by the landing.
  eq(gate(one('leap', { sub: 4, boxOn: true })), [true, true, true], 'Gibbles gate 6 (leap windup): icon, reticle, box kept on');
  const leap = one('leap', { sub: 4, boxOn: true }, [player(0, 60)]);
  eq([priv(leap).sub, leap.hittable], [1, false], 'Gibbles gate 6 (launch): the box is cleared');
  const rig = new Rig(leap, gibLen(60));
  let airborneHit = false;
  let landedHit: boolean | null = null;
  for (let i = 0; i < 300 && landedHit === null; i++) {
    rig.step([player(0, 60)]);
    if (priv(leap).sub === 3) landedHit = leap.hittable;
    else if (priv(leap).sub === 1 && leap.hittable) airborneHit = true;
  }
  eq([airborneHit, landedHit], [false, true], 'Gibbles gate 6: box off while airborne, on at the landing');
  // exe 7 (guard): icon and reticle; the box is not written (kept).
  eq(gate(one('guard', { boxOn: true })), [true, true, true], 'Gibbles gate 7 (guard): icon, reticle, box kept on');
  eq(gate(one('guard', { boxOn: false })), [true, true, false], 'Gibbles gate 7 (guard): box kept off');
  // exe 8 (stagger): icon and reticle; the box bit is kept (the exe clears only 0x4000000).
  eq(gate(one('stagger', { boxOn: true })), [true, true, true], 'Gibbles gate 8 (stagger): icon, reticle, box kept on');
  // exe 11 (wander): icon and reticle; the box is kept; a target starts the approach, which sets it.
  eq(gate(one('wander', { boxOn: false }, [], false)), [true, true, false], 'Gibbles gate 11 (wander, no target): icon, reticle, box kept off');
  const wander = one('wander', { boxOn: false }, [player(0, 100)], false);
  eq([wander.state, gate(wander)], ['approach', [true, true, true]], 'Gibbles gate 11 (wander, target): approach, icon, reticle, box on');
  // exe 9 (death): no icon; the reticle only in the windup (the death motion); no box write.
  const dead = gibbles();
  dead.kill();
  eq([dead.radar, dead.lockable], [false, true], 'Gibbles gate 9 (death motion): no icon, reticle in the windup');
  dead.tickDead(true);
  eq(gate(dead), [false, false, false], 'Gibbles gate 9 (sink): no icon, no reticle, not hittable');
}

// Constants cited in the comments.
eq([GEE.search, GEE.retarget, GEE.hover, GEE.high], [200, 45, 15, 45], 'Gee: 200 / 45 / 15 / 45');
eq([GIGUE.search, GIGUE.turn, GIGUE.bombRadiusSq], [150, 768, 1600], 'Gi Gue: record 150 / 768, bomb radius 40');
eq([GIBBLES.search, GIBBLES.turn, GIBBLES.dormant], [250, 1024, 200], 'Gibbles: record 250 / 1024, waits for 200');
eq([GIBBLES.sinkLimit], [25], 'Gibbles: the sink ends past velocity 25');
near(GIBBLES.sinkStep, 0.1, 1e-7, 'Gibbles: the sink steps 0.1');

// --- The Gigue spit's hit (GiGuesProjectileUpdate_0056c96c, dump 354566) ----------
// The hit is the 3D distance to the player's weapon_position (the feet, see
// the port's steer), not the XZ distance: a spit 20 above the feet does not hit.
{
  const effect = { kind: 'tech' as const, power: 1 };
  const spit = (y: number) => new GiGueSpit({ x: 0, y, z: 0, yaw: 0, delay: 1, speed: 4, strength: 0, bump: 0, effect, targetId: 1 });
  const feet: AiTarget = { clientId: 1, x: 0, z: 0, charClass: 0, dead: false, y: 0 };
  eq(spit(20).tick([feet]), [], 'a spit 20 above the feet (XZ on the target): no 3D hit');
  // yaw 0 flies 4 along +z in the first step: the target 4 out on z puts the spit 0.5 above its weapon point.
  const onWeapon: AiTarget = { clientId: 1, x: 0, z: 4, charClass: 0, dead: false, y: 0 };
  eq(spit(0.5).tick([onWeapon]).length, 1, 'a spit 0.5 above the weapon point (within the speed): hit');
}

// --- Gi Gue bomb hit (GiGuesAIUpdate_007acee8, dump 793420): the player's round box (radius 5)
// against the bomb's rectangle (half width 1 across, half length 5 along the travel), centred on
// the step's midpoint.
{
  // From (0, 20, 0) aimed along +z at the feet: after one step of speed 3 the midpoint is z 1.5.
  const bombHits = (x: number, z: number): number => new GiGueBomb(0, 20, 0, 0, 0, 100, 3, 10).tick([player(x, z, 1, { y: 0 })]).length;
  eq(bombHits(3.5, 1.5), 1, 'bomb: 3.5 across the travel (2.5 past the 1-wide strip) is inside radius 5');
  eq(bombHits(6, 1.5), 0, 'bomb: 6 across (5 past the strip edge): no hit');
  eq(bombHits(0, 1.5 + 4.9), 1, 'bomb: 4.9 along the travel (inside the 5 half length): hit');
  eq(bombHits(0, 1.5 + 10.1), 0, 'bomb: 10.1 along the travel: no hit (the old XZ-within-10 test hit it)');
  const b = new GiGueBomb(0, 20, 0, 0, 0, 100, 3, 10);
  b.tick([]);
  check(b.y < 20, 'bomb: flies down toward the feet aim (y 0)');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmep2a: all checks passed');
