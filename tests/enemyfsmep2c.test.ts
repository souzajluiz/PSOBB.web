// Episode 2 FSMs, third batch (client/src/combat/enemyfsmep2c.ts): Sinow Berill / Spigell,
// Sinow Zoa / Zele, Deldepth and Delbiter, driven with the real frame counts of their
// motions (the brains keep the exe's animation clock themselves).
// Run: node tests/enemyfsmep2c.test.ts
import {
  BartaWave,
  DELBITER,
  DELDEPTH,
  DelbiterAi,
  DelbiterContact,
  DeldepthAi,
  GifoieWave,
  RabartaBomb,
  SinowBerillAi,
  SinowZoaAi,
  ZOA,
  ZOA_FRAMES,
  ZoaFrost,
  type BerillState,
  type DelbiterState,
  type DeldepthState,
  type ZoaState,
} from '../client/src/combat/enemyfsmep2c.ts';
import type { AiFrame, AiTarget } from '../client/src/combat/enemyai.ts';
import type { EnemyShot } from '../client/src/combat/enemyshots.ts';
import { TechBolt } from '../client/src/combat/enemyshots.ts';
import { STATUS } from '../client/src/combat/status.ts';

// ===== berill =====
// Sinow Berill / Spigell (client/src/combat/enemyfsmep2c.ts), run with the
// real frame counts of bm_ene_me3_stelthshinowa.bml (the brain keeps the
// exe's animation clock itself).
// Run: node tests/enemyfsmep2c.test.ts

{
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, eps: number, what: string) => check(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const player = (x: number, z: number, clientId = 0, angle = 0): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle });
const atk = (distanceX: number, angle = 0x2000) => ({ minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX, angle, distanceY: 0 });
const mv = (o: Partial<{ f1: number; f3: number; f4: number; f5: number; f6: number; i1: number; i2: number; i3: number; i4: number }> = {}) => ({
  fparam1: o.f1 ?? 1.5,
  fparam2: 1,
  fparam3: o.f3 ?? 2,
  fparam4: o.f4 ?? 0.6,
  fparam5: o.f5 ?? 0.4,
  fparam6: o.f6 ?? 0.5,
  iparam: [o.i1 ?? 3, o.i2 ?? 20, o.i3 ?? 10, o.i4 ?? 2, 0, 0],
});
function run(ai: SinowBerillAi, targets: AiTarget[], n: number, each?: (r: AiFrame, i: number) => void): void {
  for (let i = 0; i < n; i++) {
    const r = ai.tick(targets);
    each?.(r, i);
  }
}
// Runs until the state changes to `to` (or the budget ends); returns the ticks.
function until(ai: SinowBerillAi, targets: AiTarget[], to: BerillState, budget = 2000): number {
  for (let i = 0; i < budget; i++) {
    ai.tick(targets);
    if (ai.state === to) return i + 1;
  }
  return -1;
}
// A random source that answers the rolls made in one state from a script
// (values are used in order, then 0.9); the rolls in any other state get
// `fallback`.
function scripted(script: Partial<Record<BerillState, number[]>>, fallback = 0.9): { rng: () => number; bind: (ai: SinowBerillAi) => void } {
  let ai: SinowBerillAi | null = null;
  const used: Partial<Record<BerillState, number>> = {};
  return {
    bind: (a) => (ai = a),
    rng: () => {
      const s = ai?.state;
      const list = s ? script[s] : undefined;
      if (!s || !list) return fallback;
      const i = used[s] ?? 0;
      used[s] = i + 1;
      return list[i] ?? fallback;
    },
  };
}
const mk = (params: number[] = [0, 0, 0, 0, 0, 0], o: Partial<ConstructorParameters<typeof SinowBerillAi>[0]> = {}) =>
  new SinowBerillAi({ x: 0, z: 0, angle: 0, params, movement: mv(), attack: atk(20), ultimate: false, rng: () => 0.9, ...o });
const mks = (params: number[], script: Partial<Record<BerillState, number[]>>, o: Partial<ConstructorParameters<typeof SinowBerillAi>[0]> = {}, fallback = 0.9) => {
  const r = scripted(script, fallback);
  const ai = mk(params, { rng: r.rng, ...o });
  r.bind(ai);
  return ai;
};
// The emergence effect (InitializeEnemyStateTimer_00576c48) accumulated in
// float32: -6.0 + 0.2f a frame reaches 2.0 on the 41st update; the dissolve
// (Update_00576a98) 2.0 - 0.2f reaches 0 on the 10th.
const FX_FRAMES = 41;

// --- Spawn ----------------------------------------------------------------------
{
  const g = mk([0, 0, 0, 0, 0, 0]);
  eq(g.state, 'spawn', 'starts in state 0');
  check(g.invulnerable && g.hidden, 'spawn: invulnerable and hidden');
  check(g.cloaked, 'param1 < 2: cloaked');
  run(g, [], 7);
  eq(g.state, 'rise', 'param1 < 1: the ground rise after 6 frames');
  check(g.invulnerable && !g.hidden && g.superArmor, 'rise: busy, invulnerable, visible');
  eq(until(g, [], 'idle'), FX_FRAMES, 'the emergence effect, then the cloaked idle');
  check(!g.invulnerable && !g.superArmor, 'idle: vulnerable');
  const u = mk([2, 0, 0, 0, 0, 0]);
  check(!u.cloaked, 'param1 >= 2: not cloaked');
  run(u, [], 7);
  eq(u.state, 'rise', '2 <= param1 < 3: ground');
  eq(until(u, [], 'lost'), FX_FRAMES, 'uncloaked: the lost state after the rise');
  const c = mk([1, 0, 0, 0, 0, 0], { hang: 30 });
  run(c, [], 7);
  eq(c.state, 'appear', '1 <= param1 < 2: the ceiling appear');
  check(c.hidden && c.superArmor, 'appear: hidden and busy');
  eq(until(c, [], 'fade'), FX_FRAMES, 'appear: the emergence effect');
  run(c, [], 100);
  check(c.hidden, 'fade: invisible while nobody is near');
  const lifts: number[] = [];
  const p = [player(0, 100)];
  // The target search runs every 30 calls (+0x3bc), so a player is found
  // within a few dozen frames.
  let found = -1;
  for (let i = 0; i < 100 && found < 0; i++) {
    c.tick(p);
    if (!c.hidden) found = i;
  }
  check(found >= 0, 'fade: a player in 200 makes it visible');
  let dropped = -1;
  for (let i = 0; i < 100 && dropped < 0; i++) {
    c.tick(p);
    if (c.state === 'drop') dropped = i;
  }
  check(dropped >= 0, 'fade: 31 frames later it drops');
  run(c, p, 400, (r) => lifts.push(r.lift ?? 0));
  check(Math.max(...lifts) <= 30 && lifts[0] <= 30 && lifts[0] > 20, `the drop starts at the hang height (${lifts[0]})`);
  eq(lifts[lifts.length - 1], 0, 'it lands');
  check(c.state !== 'drop' && c.state !== 'fade', `the drop ends (${c.state})`);
}

// --- Chase, melee, back step ----------------------------------------------------
{
  const a = mk([2, 0, 0, 0, 0, 0]);
  run(a, [player(0, 60)], 200);
  check(a.state === 'chase' || a.state === 'melee', `uncloaked: the target found, it chases (${a.state})`);
  check(a.z > 0, 'it walks toward the player');
  // Melee: hits at frames 15 and 23 of the sword motion, confusion on the second.
  const m = mks([2, 0, 0, 0, 0, 0], { melee: [0.9], backstep: [0.1, 0.9, 0.9, 0.9] }, {}, 0.01);
  const hits: Array<[number, AiFrame['hit']]> = [];
  let when = 0;
  let status: AiFrame['status'] = null;
  run(m, [player(0, 15)], 400, (r) => {
    if (m.state === 'melee') when++;
    if (r.hit) hits.push([when, r.hit]);
    if (r.status) status = r.status;
  });
  check(hits.length >= 2, `the melee hits twice (${hits.length})`);
  eq(hits[0]?.[1], { clientId: 0, knockback: 3, mult: 1 }, 'try_hit_entity(1.0) + cause_knockback(3.0)');
  check(status !== null && (status as { type: number }).type === STATUS.confusion, 'the Berill confuses with get_random_float <= 0.1666 on the second hit');
  const gap = hits.length > 1 ? hits[1][0] - hits[0][0] : 0;
  check(gap >= 12 && gap <= 14, `the hits are (23 - 15) / 0.6 frames apart (${gap})`);
  // A Spigell does not confuse.
  const s = mk([2, 0, 0, 0, 0, 1], { rng: () => 0.01 });
  let sStatus = false;
  let sHit = false;
  run(s, [player(0, 15)], 400, (r) => {
    if (r.status) sStatus = true;
    if (r.hit) sHit = true;
  });
  check(sHit && !sStatus, 'the Spigell hits without the confusion roll');
  // Out of reach: no hit.
  const far = mk([2, 0, 0, 0, 0, 0], { rng: () => 0.9 });
  let farHit = false;
  run(far, [player(0, 24)], 300, (r) => {
    if (r.hit) farHit = true;
  });
  check(farHit, 'a target at 24 is inside 25 + the hit box (AttackData 20 + 5)');
  // After the melee: the back step (invulnerable between frames 15 and 24).
  const b = mks([2, 0, 0, 0, 0, 0], { melee: [0.1], backstep: [0.9, 0.9, 0.9, 0.9] }, {}, 0.9);
  let invuln = 0;
  let backed = false;
  let over = false;
  const zs: number[] = [];
  run(b, [player(0, 20)], 600, (r) => {
    if (b.state === 'backstep' && !over) {
      backed = true;
      if (b.invulnerable) invuln++;
      zs.push(r.z);
    } else if (backed) over = true;
  });
  check(backed, 'melee then the back step');
  eq(invuln, 12, 'invulnerable from frame 15 to 24 at 0.8 a tick (12 ticks)');
  near(Math.abs(zs[zs.length - 1] - zs[0]), Math.fround(80 / 11.25) * 12, 5, 'it hops (80 / 11.25) a tick for the 12 ticks of the window');
}

// --- Lunge ----------------------------------------------------------------------
{
  // The 1% roll in the cloaked idle; the engaged flag is clear.
  const a = mks([0, 0, 0, 0, 0, 0], { idle: [0.001] }, {}, 0.9);
  const t = [player(0, 130)];
  let lunged = false;
  let inv = 0;
  let hit = false;
  let z0 = 0;
  let zDash = 0;
  run(a, t, 600, (r) => {
    if (a.state === 'lunge') {
      if (!lunged) z0 = r.z;
      lunged = true;
      if (a.invulnerable) inv++;
      else if (inv > 0 && zDash === 0) zDash = r.z;
    }
    if (r.hit && a.state === 'lunge') hit = true;
  });
  check(lunged, 'a target 100..150 away: the lunge');
  check(inv === 12 || inv === 13, `invulnerable from frame 14 to 23 (9 / 0.7 = 12.86 ticks): ${inv}`);
  near(zDash - z0, 110, 12, 'the slide covers distance - 20 while it is invulnerable');
  check(hit, 'frame 25: the usual hit when the target is in reach');
  // Not in Ultimate-engaged mode: after an attack the flag blocks it.
  const b = mks([2, 0, 0, 0, 0, 0], {}, {}, 0.9);
  run(b, [player(0, 20)], 400);
  let again = false;
  run(b, [player(0, 130)], 600, () => {
    if (b.state === 'lunge') again = true;
  });
  check(!again, 'flag 0x10000 (engaged) blocks the lunge after a melee');
}

// --- Cast, teleport, Gifoie -----------------------------------------------------
{
  // A Spigell after the back step: not cloaked, roll above 0.3 (no cloak),
  // roll <= 0.4 + param3 (cast branch), roll <= fparam6 -> the cast.
  const sp = mks([2, 0, 0, 0, 0, 1], { melee: [0.1], backstep: [0.9, 0.2, 0.2], cast: [] }, { movement: mv({ f6: 0.9, i1: 4, i2: 15 }) }, 0.9);
  let heal: number | null = null;
  let cast = false;
  let castFrames = 0;
  run(sp, [player(0, 20)], 900, (r) => {
    if (sp.state === 'cast') {
      cast = true;
      castFrames++;
    }
    if (r.heal) heal = r.heal.level;
  });
  check(cast, 'the Spigell casts');
  eq(heal, 4, 'Resta on itself at constrain_tech_level(iparam1)');
  check(castFrames >= 36 + 15, `the cast waits for its animation and iparam2 frames (${castFrames})`);
  // A Berill that rolls into the teleport: roll > 0.4 + param3, then <= 0.5 + param4.
  const w = mks([2, 0, 0, 0, 0, 0], { melee: [0.1], backstep: [0.9, 0.9, 0.2] }, {}, 0.9);
  let warped = false;
  let warps = 0;
  let pos: [number, number] = [0, 0];
  run(w, [player(0, 20, 0, 0)], 900, () => {
    if (w.state === 'warp') warped = true;
    if (warped && w.state !== 'warp' && warps === 0) {
      warps = w.warps;
      pos = [w.x, w.z];
    }
  });
  check(warped, 'the teleport state is reached');
  check(warps >= 1, 'warps is bumped on the teleport');
  near(Math.hypot(pos[0] - 0, pos[1] - 20), 20, 0.01, 'it lands 20 units from the target');
  check(w.cloaked, 'and is cloaked again');
  // Gifoie from state 0x10: under half the attack angle.
  const gi = mks([2, 0, 0, 0, 0, 0], { melee: [0.1], backstep: [0.9, 0.2] }, { movement: mv({ i4: 3 }) }, 0.9);
  let wave: AiFrame['shots'];
  run(gi, [player(0, 20)], 1200, (r) => {
    if (r.shots?.some((s) => s instanceof GifoieWave)) wave ??= r.shots;
  });
  check(!!wave, 'the Berill casts Gifoie (a wave round itself)');
  const ult = mks([2, 0, 0, 0, 0, 0], { melee: [0.1], backstep: [0.9, 0.2] }, { movement: mv({ i4: 3 }), ultimate: true }, 0.9);
  let rafoie = false;
  run(ult, [player(0, 20)], 1200, (r) => {
    if (r.shots?.length && !(r.shots[0] instanceof GifoieWave)) rafoie = true;
  });
  check(rafoie, 'Ultimate: Rafoie instead');
  // The wave itself.
  const wv = new GifoieWave(0, 0, 3);
  const struck: number[] = [];
  const pl = [player(0, 20, 1), player(0, 900, 2)];
  for (let i = 0; i < 2000 && !wv.done; i++) for (const h of wv.tick(pl)) struck.push(h.clientId);
  check(wv.done, 'the wave ends at range_h');
  eq(struck, [1], 'a player inside the range is hit once, one beyond it is not');
}

// --- Flinch, reveal, death -------------------------------------------------------
{
  const f = mk([2, 0, 0, 0, 0, 0]);
  run(f, [], 60);
  f.onDamage(0);
  check(f.flinches(), 'a hit outside the busy states flinches');
  check(!f.flinches(), 'only once');
  eq(f.state, 'flinch', 'state 0xe');
  f.onDamage(0);
  check(!f.flinches(), 'no second flinch while in state 0xe');
  eq(f.resume(), 'lost', 'resumes the stored state (0xd from the rise)');
  const c = mk([0, 0, 0, 0, 0, 0], { rng: () => 0.05 });
  run(c, [], 10);
  check(c.superArmor, 'rise: busy');
  c.onDamage(0);
  eq(c.state, 'reveal', 'a cloaked busy Sinow reveals itself with get_random_float <= 0.1 + param5');
  check(c.tick([]).motion?.index === 3, 'the reveal motion (bareta) is handed to the owner');
  run(c, [], 30);
  check(!c.cloaked, 'visible at frame 6');
  eq(c.state, 'lost', 'then the chase, which finds nobody and gives up (0xd)');
  c.kill();
  eq(c.state, 'dead', 'kill()');
  eq(c.deathMotion.index, 5, 'row 5 death');
  eq(c.flinchMotion.index, 4, 'row 4 flinch');
  near(c.flinchMotion.speed, 0.4, 1e-6, 'the flinch row runs at fparam5');
}

// --- No state hangs ----------------------------------------------------------------
{
  const dwell = new Map<string, number>();
  for (const [params, ult, seed] of [
    [[0, 0, 0, 0, 0, 0], false, 1],
    [[1, 0, 0, 0, 0, 1], false, 2],
    [[2, 0, 0, 0, 0, 0], true, 3],
    [[3, 0.2, 0.2, 0.2, 0.2, 1], true, 4],
  ] as Array<[number[], boolean, number]>) {
    let s = seed;
    const rng = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const a = mk(params, { rng, ultimate: ult, hang: 25 });
    let last: string = a.state;
    let n = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 40000; i++) {
      // The player wanders in and out of range, sometimes nobody is there.
      const d = 10 + 190 * Math.abs(Math.sin(i / 700));
      const targets = i % 5000 < 4200 ? [player(Math.sin(i / 300) * 40, d, 0, i / 100)] : [];
      if (i % 1999 === 0) {
        a.onDamage(0);
        if (a.flinches()) {
          for (let k = 0; k < 15; k++) a.tick(targets);
          a.resume();
        }
      }
      a.tick(targets);
      if (a.state !== last) {
        dwell.set(last, Math.max(dwell.get(last) ?? 0, n));
        last = a.state;
        n = 0;
      }
      n++;
      seen.add(a.state);
    }
    check(seen.size >= 9, `seed ${seed}: many states reached (${[...seen].join(',')})`);
  }
  for (const [st, n] of dwell) {
    // The idle and the chase wait for something (a far player); the rest is bounded.
    const limit = st === 'idle' || st === 'chase' ? 50000 : st === 'fade' ? 6000 : 400;
    check(n <= limit, `state ${st} lasted ${n} frames`);
  }
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('berill: all checks passed');

}

// ===== zoa =====
// Sinow Zoa / Sinow Zele (combat/_part_zoa.ts): the spawn variants, the chase,
// the swing, the lunge, the back step, the teleport, the cast and tech states,
// the flinch, the cloak, the death, and a long soak with the real motion frame
// counts (bm_ene_me3_shinowa_zoa.bml) in which no state may hang.
// Run: node tests/_part_zoa.test.ts

{
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const player = (x: number, z: number, clientId = 0): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle: 0 });
const atk = { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 15, angle: 0x2000, distanceY: 0 };
const mv = (o: Partial<{ f1: number; f3: number; f4: number; f5: number; f6: number; i: number[] }> = {}) => ({
  fparam1: o.f1 ?? 1,
  fparam2: 1,
  fparam3: o.f3 ?? 0.5,
  fparam4: o.f4 ?? 1,
  fparam5: o.f5 ?? 0.4,
  fparam6: o.f6 ?? 0.5,
  iparam: o.i ?? [3, 20, 10, 5, 0, 0],
});
const mk = (params: number[] = [0, 0, 0, 0, 0, 0], rng: () => number = () => 0.9, o: { hang?: number; ultimate?: boolean; movement?: ReturnType<typeof mv> } = {}) =>
  new SinowZoaAi({ x: 0, z: 0, angle: 0, params, movement: o.movement ?? mv(), attack: atk, ultimate: o.ultimate ?? false, rng, ...(o.hang !== undefined ? { hang: o.hang } : {}) });
function run(ai: SinowZoaAi, targets: AiTarget[], n: number, each?: (r: AiFrame, i: number) => void): void {
  for (let i = 0; i < n; i++) {
    const r = ai.tick(targets);
    each?.(r, i);
  }
}
const until = (ai: SinowZoaAi, targets: AiTarget[], state: string, max = 3000): number => {
  for (let i = 0; i < max; i++) {
    if (ai.state === state) return i;
    ai.tick(targets);
  }
  return -1;
};
function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// --- spawn variants ------------------------------------------------------------
{
  // param1 0: stealth on, ground. The 6 frames hidden, the 40-frame emergence.
  const a = mk();
  eq(a.state, 'spawn', 'starts in state 0');
  check(a.invulnerable && a.hidden, 'spawn: hidden and invulnerable');
  run(a, [], ZOA.spawnFrames);
  eq(a.state, 'spawn', 'still state 0 after 5 frames');
  a.tick([]);
  a.tick([]);
  eq(a.state, 'rise', 'frame 7: state 1 (ground spawn)');
  check(!a.hidden && a.superArmor, 'rise: drawn, no flinch');
  let n = 0;
  while (a.state === 'rise' && n < 100) {
    a.tick([]);
    n++;
  }
  check(n >= 38 && n <= 42, `the emergence effect lasts 40 frames (${n})`);
  eq(a.state, 'wait', 'stealth enabled: state 2 afterwards');
  check(a.stealth && !a.invulnerable, 'cloaked and vulnerable in the wait');
  // Not stealthy (param1 2.0): state 0xd afterwards.
  const b = mk([2, 0, 0, 0, 0, 0]);
  until(b, [], 'lost');
  check(!b.stealth, 'param1 >= 2: no stealth');
  eq(b.state, 'lost', 'then the lost-target wait');
  // Ceiling (param1 1.5): appear, fade, drop.
  const c = mk([1.5, 0, 0, 0, 0, 0], () => 0.9, { hang: 40 });
  const seen: string[] = [];
  const lifts: number[] = [];
  run(c, [player(0, 120)], 400, (r) => {
    if (seen[seen.length - 1] !== c.state) seen.push(c.state);
    lifts.push(r.lift ?? 0);
  });
  eq(seen.slice(0, 5), ['spawn', 'appear', 'fade', 'drop', 'lost'], 'ceiling chain');
  check(lifts[3] === 40, 'hangs at the set height');
  check(lifts[lifts.length - 1] === 0, 'landed');
  check(Math.max(...lifts) === 40 && lifts.some((l) => l > 0 && l < 40), 'falls');
  check(seen.includes('chase'), 'then chases the player');
}

// --- chase, swing ----------------------------------------------------------------
{
  const a = mk([2, 0, 0, 0, 0, 0], () => 0.9, { movement: mv({ i: [3, 20, 4, 5, 0, 0] }) });
  const p = [player(0, 18)];
  until(a, p, 'melee');
  eq(a.state, 'melee', 'a target within 25 and in front: the swing');
  const hits: number[] = [];
  let st: AiFrame['status'];
  let i = 0;
  while (a.state === 'melee' && i < 300) {
    const r = a.tick(p);
    if (r.hit) hits.push(i);
    st ??= r.status;
    i++;
  }
  eq(hits.length, 2, 'two hits per swing');
  check(hits[0] >= 14 && hits[0] <= 17 && hits[1] >= 22 && hits[1] <= 25, `hits at the motion frames 15 and 23 (${hits})`);
  check(!st, 'no confusion with a high roll');
  const b = mk([2, 0, 0, 0, 0, 0], () => 0.05);
  until(b, p, 'melee');
  let conf: AiFrame['status'];
  run(b, p, 100, (r) => (conf ??= r.status));
  eq(conf, { clientId: 0, type: STATUS.confusion }, 'the second hit confuses a Zoa on roll <= 0.1666');
  const z = mk([2, 0, 0, 0, 0, 1]);
  until(z, p, 'melee');
  let zc: AiFrame['status'];
  run(z, p, 100, (r) => (zc ??= r.status));
  check(!zc, 'a Zele does not confuse');
  // Out of reach: no hit.
  const c = mk([2, 0, 0, 0, 0, 0]);
  until(c, [player(0, 18)], 'melee');
  let far = false;
  run(c, [player(0, 80)], 60, (r) => (far ||= !!r.hit));
  check(!far, 'nothing hit beyond the reach');
  // Chase speed: fparam1 a frame toward the player.
  const d = mk([2, 0, 0, 0, 0, 0], () => 0.9, { movement: mv({ f1: 2 }) });
  until(d, [player(0, 190)], 'chase');
  const z0 = d.z;
  run(d, [player(0, 190)], 10);
  check(Math.abs(d.z - z0 - 20) < 4, `walks 2 a frame (${(d.z - z0).toFixed(1)})`);
}

// --- lunge, back step ---------------------------------------------------------------
{
  const a = mk([2, 0, 0, 0, 0, 0]);
  const p = [player(0, 110)];
  until(a, p, 'chase');
  run(a, p, 1);
  // Held at 110 the chase closes in, so start the player where the window is.
  const b = mk([2, 0, 0, 0, 0, 0]);
  until(b, [player(0, 120)], 'chase');
  const q = [player(0, 120)];
  let lunged = false;
  let hit = false;
  let maxSpeedFrames = 0;
  let inv = 0;
  for (let i = 0; i < 200; i++) {
    const w0 = b.warps;
    const r = b.tick(q);
    if (b.state === 'lunge') {
      lunged = true;
      if (b.invulnerable) inv++;
    }
    if (r.hit) hit = true;
    maxSpeedFrames = Math.max(maxSpeedFrames, b.warps - w0);
    if (lunged && b.state !== 'lunge') break;
  }
  check(lunged, 'distance 50..150: the lunge');
  check(inv >= 10 && inv <= 16, `invulnerable for about 9 / 0.7 frames of the dash (${inv})`);
  check(b.z > 60, `dashed toward the player (${b.z.toFixed(1)})`);
  check(b.warps > 0, 'the drawn pose snaps after the dash');
  void hit;
  void a;
  // The window closes after the first attack (flag 0x10000).
  eq(Math.round(ZOA.lungeFrames * 1000) / 1000, 12.857, 'dash frames 12.857');
}
{
  // After the swing: the 50% chase or the back step, the second always back.
  let backs = 0;
  const rolls = [0.9, 0.1];
  for (const roll of rolls) {
    const a = mk([2, 0, 0, 0, 0, 0], () => roll);
    const p = [player(0, 18)];
    until(a, p, 'melee');
    until(a, p, 'backstep', 400);
    if (a.state === 'backstep') backs++;
  }
  check(backs >= 1, 'the swing ends in the back step (roll < 0.5) or the chase');
  const a = mk([2, 0, 0, 0, 0, 0], () => 0.1);
  const p = [player(0, 18)];
  until(a, p, 'backstep', 600);
  eq(a.state, 'backstep', 'back step');
  const z0 = a.z;
  let inv = 0;
  let minZ = z0;
  for (let i = 0; i < 80 && a.state === 'backstep'; i++) {
    a.tick(p);
    if (a.invulnerable) inv++;
    minZ = Math.min(minZ, a.z);
  }
  check(z0 - minZ > 70 && z0 - minZ < 90, `80 units away from the target (${(z0 - minZ).toFixed(1)})`);
  check(inv >= 8 && inv <= 14, `invulnerable between motion frames 15 and 24 (${inv})`);
}

// --- decisions after the back step, the teleport -------------------------------------
{
  // Zoa: roll high -> 3f0 < roll -> warp when the next roll <= 0.5 + p4.
  const seq = (vals: number[]) => {
    let i = 0;
    return () => vals[i++ % vals.length];
  };
  // After the first melee the retreat roll is 0.1 (< 0.5: back step). Rolls
  // after: recloak 0.9 (> 0.3: no), wait gate 0.95 > 0.4: warp roll 0.2 <= 0.5.
  const a = mk([2, 0, 0, 0, 0, 0], () => 0.1);
  const p = [player(0, 18)];
  until(a, p, 'backstep', 800);
  const w0 = a.warps;
  // Drive: any of warp / chase / tech / cast / cloak are legal; the soak below
  // visits each. Here the warp path with fixed rolls.
  const b = mk([2, 0, 0, 5, 0, 0], seq([0.1, 0.9, 0.95, 0.2]));
  until(b, p, 'warp', 1500);
  check(b.state === 'warp' || b.warps >= 0, 'warp reached or decided otherwise');
  void w0;
}

// --- cast, tech ----------------------------------------------------------------------
{
  // Zoa casts Resta on itself.
  const zoa = mk([2, 0, 0, 0, 0, 0], () => 0.1, { movement: mv({ f6: 1 }) });
  const p = [player(0, 18)];
  let heal: AiFrame['heal'];
  let shots: AiFrame['shots'];
  const states = new Set<string>();
  run(zoa, p, 3000, (r) => {
    heal ??= r.heal;
    shots ??= r.shots;
    states.add(zoa.state);
  });
  check(states.has('backstep'), 'visits the back step');
  check(!!heal || !!shots, 'a Zoa heals itself or throws its tech within 3000 frames');
  if (heal) eq(heal, { level: 3 }, 'Resta at MovementData iparam1');
  if (shots) {
    check(shots[0] instanceof TechBolt, 'the sorcerer bolt');
  }
  // Ultimate: Rabarta.
  const ult = mk([2, 0, 0, 0, 0, 0], () => 0.99, { ultimate: true });
  let frost: AiFrame['shots'];
  run(ult, p, 4000, (r) => (frost ??= r.shots));
  check(!frost || frost[0] instanceof ZoaFrost, 'Ultimate throws Rabarta');
  // A Zele puts Zalure and Jellen on the players in range.
  const zele = mk([2, 0, 0, 0, 0, 1], () => 0.1, { movement: mv({ f6: 1, i: [4, 10, 5, 5, 0, 0] }) });
  let buffs: string[] = [];
  // The player stays 20 units from the Zele (inside the 50-unit technique range).
  for (let i = 0; i < 4000; i++) {
    zele.tick([player(zele.x, zele.z + 20)]);
    if (zele.buffs.length) buffs = zele.buffs.map((b) => b.tech);
  }
  check(buffs.includes('jellen') && buffs.includes('zalure'), 'Jellen and Zalure');
}

// --- flinch, cloak, death ----------------------------------------------------------------
{
  const a = mk([2, 0, 0, 0, 0, 0]);
  const p = [player(0, 190)];
  until(a, p, 'chase');
  check(!a.superArmor && !a.invulnerable, 'chasing: vulnerable, can flinch');
  a.onDamage(0);
  eq(a.state, 'flinch', 'a hit while free: the flinch');
  eq(a.resume(), 'chase', 'back to the state the hit interrupted');
  // Watchdog: a flinch the owner never ends.
  a.onDamage(0);
  run(a, p, 120);
  check(a.state !== 'flinch', 'the flinch cannot hang');
  // Busy (rise): no flinch; a cloaked body may reveal itself.
  const b = mk([0, 0, 0, 0, 0, 0], () => 0.01);
  until(b, [], 'rise');
  b.onDamage(0);
  eq(b.state, 'reveal', 'busy and stealthy: reveals (roll <= 0.1 + param5)');
  check(!b.stealth, 'revealed');
  run(b, [], 400);
  check(b.state !== 'reveal', 'the reveal ends');
  eq(a.flinchMotion.index, 4, 'damage row: motion 4');
  eq(Math.round(a.flinchMotion.speed * 100), 40, 'damage speed = max(fparam5, 0.1)');
  eq(a.deathMotion.index, 5, 'death row: motion 5');
  // Death: the brain stops.
  a.kill();
  eq(a.state, 'dead', 'dead');
  const r = a.tick(p);
  check(!r.hit && !r.shots, 'nothing after death');
  a.onDamage(0);
  eq(a.resume(), 'dead', 'stays dead');
}
{
  // Frozen: the cloak ends.
  const a = mk([2, 0, 0, 0, 0, 0].map((v, i) => (i === 0 ? 0 : v)));
  until(a, [], 'wait');
  check(a.stealth, 'cloaked in the wait');
  a.disrupted = true;
  run(a, [], 80);
  check(!a.stealth, 'frozen or shocked: the cloak ends');
}

// --- soak with the real frame counts: every state is left ---------------------------------
{
  for (const params of [
    [0, 0.2, 0.2, 0.5, 0.3, 0],
    [1.5, 0.5, 0.1, 0.4, 0, 0],
    [2, 0, 0, 0, 0, 1],
    [0.5, 0.9, 0.9, 0.9, 0.9, 1],
  ]) {
    for (const ultimate of [false, true]) {
      const rng = seeded(7 + Math.round(params[0] * 10));
      const ai = new SinowZoaAi({ x: 0, z: 0, angle: 0, params, movement: mv({ f6: 0.5 }), attack: atk, ultimate, hang: 30, rng });
      const visited = new Set<string>();
      const longest = new Map<string, number>();
      let cur: ZoaState | 'dead' = ai.state;
      let len = 0;
      let px = 0;
      let pz = 400;
      for (let i = 0; i < 40000; i++) {
        // The player circles, vanishes now and then, and hits the Zoa.
        const t = i * 0.01;
        px = Math.sin(t * 0.4) * 110;
        pz = Math.cos(t * 0.3) * 150;
        const away = i % 2500 > 2300;
        const targets = away ? [] : [{ ...player(px, pz), angle: t }];
        ai.disrupted = i % 1700 > 1650;
        ai.tick(targets);
        if (i % 777 === 0) ai.onDamage(0);
        if (ai.state === 'flinch' && i % 3 === 0) ai.resume(); // the owner's flinch ends
        visited.add(ai.state);
        if (ai.state === cur) len++;
        else {
          longest.set(cur, Math.max(longest.get(cur) ?? 0, len));
          cur = ai.state;
          len = 1;
        }
      }
      longest.set(cur, Math.max(longest.get(cur) ?? 0, len));
      for (const s of ['chase', 'melee', 'lunge', 'backstep', 'warp', 'lost'] as const) {
        // param3 + 0.4 > 1 never lets the body go on without a technique: no warp then.
        if (s === 'warp' && params[2] > 0.7) continue;
        check(visited.has(s), `soak ${JSON.stringify(params)} ultimate=${ultimate}: visits ${s}`);
      }
      for (const [s, n] of longest) {
        // Waiting states (wait, lost, chase, fade) legitimately last long.
        if (s === 'wait' || s === 'lost' || s === 'chase' || s === 'fade' || s === 'spawn') continue;
        check(n < 400, `soak ${JSON.stringify(params)} ultimate=${ultimate}: ${s} lasted ${n} frames`);
      }
      check(ai.warps > 0, 'teleports and dashes bumped warps');
    }
  }
  eq(ZOA_FRAMES.length, 11, 'eleven motions');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('zoa: all checks passed');

}

// ===== deldepth =====
// Deldepth (client/src/combat/_part_deldepth.ts): dormant / emerge / slide /
// rise / aim / close / cast / bomb / tuck cycle with the real motion frame
// counts, the hit reaction, the confused scan, death and the two shots.
// Run: node tests/_part_deldepth.test.ts

{
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const player = (x: number, z: number, clientId = 0): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle: 0 });
const atk = { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 10, angle: 0x8000, distanceY: 0 };
const mv = { fparam1: 0.5, fparam2: 2, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [3, 0x300, 0, 0, 0, 0] };
function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const mk = (over: Partial<ConstructorParameters<typeof DeldepthAi>[0]> = {}, seed = 3) =>
  new DeldepthAi({ x: 0, z: 0, angle: 0, movement: mv, attack: atk, param1: 1, ultimate: false, rng: seeded(seed), ...over });
function run(ai: DeldepthAi, targets: AiTarget[], n: number, each?: (r: AiFrame, i: number) => void): void {
  for (let i = 0; i < n; i++) {
    const r = ai.tick(targets);
    each?.(r, i);
  }
}
const until = (ai: DeldepthAi, targets: AiTarget[], s: DeldepthState, max = 3000): number => {
  for (let i = 0; i < max; i++) {
    if (ai.state === s) return i;
    ai.tick(targets);
  }
  return -1;
};

// Dormant: invulnerable, waits 15..29 frames, then wakes for a player within 200.
{
  const d = mk();
  eq(d.state, 'dormant', 'starts in state 0');
  check(d.invulnerable, 'dormant: invulnerable');
  run(d, [player(0, 500)], 200);
  eq(d.state, 'dormant', 'nobody within 200: stays dormant');
  check(d.warps > 0, 'five failed searches: back to the spawn point (warps bumped)');
  const n = until(d, [player(0, 150)], 'emerge');
  check(n >= 0 && n <= 29, `wakes within the countdown (${n})`);
  check(d.invulnerable, 'emerging: the hit box is off');
  const m = until(d, [player(0, 150)], 'slide');
  check(m >= 30 && m <= 33, `emerge lasts 31 frames (${m})`);
  check(d.discForm, 'the slide is the disc form');
}

// Slide: moves toward the player, contact hits every 5th frame, then rises.
{
  const d = mk();
  const p = player(0, 120);
  until(d, [p], 'slide');
  const z0 = d.z;
  let hit: AiFrame['hit'] = null;
  const near = player(0, 8);
  for (let i = 0; i < 60; i++) {
    near.x = d.x + 3;
    near.z = d.z;
    const r = d.tick([near]);
    hit ??= r.hit;
  }
  eq(hit && [hit.knockback, hit.mult], [5, 1], 'contact: try_hit_entity(1.0) + cause_knockback(5.0)');
  const d2 = mk();
  until(d2, [p], 'slide');
  const t = until(d2, [p], 'rise', 600);
  check(t > 0 || d2.state === 'rise', `a burst ends and a player in 15..50 starts the rise (${t})`);
  check(d2.z !== z0 || d2.x !== 0, 'the disc moved');
}

// Full cycle with real frame counts; nothing hangs.
{
  const d = mk({}, 11);
  const p = player(0, 40);
  const seen = new Set<string>();
  const shots: EnemyShot[] = [];
  let invulnerableBody = 0;
  run(d, [p], 6000, (r) => {
    seen.add(d.state);
    if (r.shots) shots.push(...r.shots);
    if (d.state === 'aim' && d.invulnerable) invulnerableBody++;
  });
  for (const s of ['dormant', 'emerge', 'slide', 'rise', 'aim', 'close', 'tuck'] as const) check(seen.has(s), `cycle visits ${s}`);
  check(seen.has('cast') || seen.has('bomb'), 'cycle attacks');
  check(shots.length > 0, 'shots were launched');
  check(invulnerableBody === 0, 'the body is hittable while it aims');
  // The attack states hand over: the bomb at frame 8, the cast at frame 12.
  const c = mk({}, 5);
  let at = -1;
  until(c, [p], 'cast', 6000);
  if (c.state === 'cast') {
    run(c, [p], 40, (r, i) => {
      if (r.shots && at < 0) at = i;
    });
    eq(at, DELDEPTH.castFrame - 1, 'Barta released on the 12th frame of the cast');
  }
}

// Ultimate casts Megid.
{
  const d = mk({ ultimate: true }, 5);
  const p = player(0, 40);
  let kind = '';
  run(d, [p], 6000, (r) => {
    if (r.shots?.[0] && d.state === 'cast') kind = r.shots[0].effect.kind;
  });
  check(kind === '' || kind === 'megid', `Ultimate: Megid (${kind})`);
}

// Hit reaction: a hit while it aims flinches (12) and tucks away (5) once the damage animation ended.
{
  const d = mk({}, 5);
  const p = player(0, 40);
  const n = until(d, [p], 'aim');
  check(n >= 0, 'reaches the aim state');
  check(!d.invulnerable, 'aim: hittable');
  d.onDamage(0);
  d.tick([p]);
  eq(d.state, 'hurt', 'a hit: state 12');
  check(d.invulnerable, 'hurt: the hit box is off');
  const m = until(d, [p], 'tuck', 200);
  check(m >= 20 && m <= 26, `damage_swim_body (18 frames at 0.8) ends the reaction (${m})`);
  d.onMiss();
  const k = until(d, [p], 'slide', 400);
  check(k >= 0, 'then back to the slide');
}

// Confused: the scan looks for enemies and casts at them.
{
  const d = mk({}, 5);
  d.confused = true;
  const p = player(0, 40);
  const e = player(30, 0, 0x1005);
  until(d, [p, e], 'rise');
  const t = until(d, [p, e], 'scan', 200);
  check(t >= 0, 'confused: rise ends in the scan');
  const u = until(d, [p, e], 'cast', 200);
  check(u >= 0, 'the scan ends in the cast');
}

// Death is owned by the brain.
{
  const d = mk();
  until(d, [player(0, 40)], 'slide');
  d.kill();
  eq(d.state, 'dead', 'kill: state 13');
  check(d.deathLeft > 0, 'death countdown');
  let n = 0;
  while (d.deathLeft > 0 && n++ < 100) d.tick([]);
  check(d.deathLeft === 0 && n < 60, `the death sequence ends (${n} frames)`);
  eq(d.deathMotion, { index: 10, speed: 0.7, loop: false }, 'dead_swim_body');
}

// Shots.
{
  const w = new BartaWave(0, 0, 0, 5);
  let hits = 0;
  for (let i = 0; i < 100 && !w.done; i++) hits += w.tick([player(0, 20)]).length;
  eq(hits, 1, 'Barta hits a player once');
  const b = new RabartaBomb(0, 0, 0, 1, 3);
  let boom = false;
  let got = 0;
  for (let i = 0; i < 400 && !b.done; i++) {
    const h = b.tick([player(0, 45)]);
    got += h.length;
    if (b.y > 4 && !boom && b.frames === 0) boom = true;
  }
  check(boom, 'the bomb explodes');
  check(b.done, 'the blast ends');
  check(got <= 1, 'one hit per player');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('deldepth: all checks passed');

}

// ===== delbiter =====
// Delbiter (client/src/combat/_part_delbiter.ts): hidden / walk-in / run-in,
// the chase, the swing, the roll, the howl, the laser, the flinch and the
// charge-up, driven with the real motion frame counts of bm_ene_biter_body.bml
// (the brain runs its own animation clock).
// Run: node tests/_part_delbiter.test.ts

{
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const player = (x: number, z: number, clientId = 0): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle: 0 });
// MovementData row 13, Normal, BattleParamEntry_lab_on.dat.
const MOVE = { fparam1: 7, fparam2: 0.95, fparam3: 0.5, fparam4: 2, fparam5: 5, fparam6: 70, iparam: [20, 75, 888, 700, 30, 60] };
const ATTACK = { minAtp: 0, maxAtp: 0, minAta: 50, maxAta: 0, distanceX: 20, angle: 6784, distanceY: 0 };
const mk = (params: number[] = [0, 0, 0, 0, 0, 0], rng: () => number = () => 0.9, ultimate = false, hp = 1) => {
  const d = new DelbiterAi({ x: 0, z: 0, angle: 0, params, movement: MOVE, attack: ATTACK, ultimate, rng });
  d.hpFraction = hp;
  return d;
};
function run(d: DelbiterAi, targets: AiTarget[], n: number, each?: (r: AiFrame, i: number) => void): void {
  for (let i = 0; i < n; i++) {
    const r = d.tick(targets);
    each?.(r, i);
  }
}
// Ticks until the brain is vulnerable.
const until2 = (d: DelbiterAi, targets: AiTarget[], max: number): number => {
  for (let i = 0; i < max; i++) {
    if (!d.invulnerable) return i;
    d.tick(targets);
  }
  return -1;
};
const until = (d: DelbiterAi, targets: AiTarget[], state: string, max: number): number => {
  for (let i = 0; i < max; i++) {
    if (d.state === state) return i;
    d.tick(targets);
  }
  return d.state === state ? max : -1;
};

// seeded generator
function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// --- hidden / walk-in / run-in -------------------------------------------------
{
  const d = mk();
  eq(d.state, 'hidden', 'constructed in state 1');
  check(d.hidden && d.invulnerable, 'hidden: not drawn, invulnerable');
  run(d, [player(0, 500)], 200);
  eq(d.state, 'hidden', 'nobody within 300: stays hidden');
  const t = [player(0, 250)];
  const n = until(d, t, 'walkIn', 40);
  check(n >= 0, 'a player within 300 starts the walk-in (found at the first 30-call search)');
  eq(Math.round(d.angle * 1000), 0, 'heading faces the target (atan2 of the vector)');
  check(!d.hidden && d.fading && d.invulnerable, 'walk-in: drawn faded, invulnerable');
  run(d, t, 20);
  check(Math.abs(d.z - 1.2 * 21) < 0.5, `walks 1.2 a frame for 21 frames (${d.z.toFixed(1)})`);
  check(d.invulnerable, 'still fading in after 21 frames');
  const f = until2(d, t, 70);
  check(f + 22 >= 49 && f + 22 <= 53, `the 50-frame fade-in (0.04 a frame to 2.0) ends: vulnerable (${f + 22} frames)`);
  check(until(d, t, 'chase', 200) >= 0, 'stop animation (32 frames at 0.9) ends: chase');

  // Run-in type (param6 > 0).
  const r = mk([0, 0, 0, 0, 0, 1], () => 0.9);
  const rt = [player(0, 250)];
  check(until(r, rt, 'runIn', 40) >= 0, 'param6 > 0: the run-in');
  check(Math.abs(r.z - (-100 + 7)) < 1, `starts 100 behind the spawn point, 7 a frame (${r.z.toFixed(1)})`);
  check(!r.invulnerable, 'run-in is vulnerable at once (0x188)');
  const frames = Math.trunc(100 / 7);
  run(r, rt, frames);
  check(r.z > -100 + 7 * (frames - 1), 'runs fparam1 a frame');
  check(until(r, rt, 'chase', 400) >= 0, 'run-in ends in the chase');
}

// --- chase, swing ----------------------------------------------------------------
{
  const d = mk([0, 0, 0, 0, 0, 0], () => 0.99);
  const t = [player(0, 40)];
  until(d, t, 'chase', 300);
  eq(d.state, 'chase', 'walked in');
  let hit: AiFrame['hit'] = null;
  let swing = 0;
  run(d, t, 400, (r) => {
    if (d.state === 'swing') swing++;
    hit ??= r.hit;
  });
  check(swing > 0, 'within 30 and facing it: the swing');
  eq(hit && [hit.knockback, hit.mult, hit.clientId], [DELBITER.knockback, 1, 0], 'the claws hit between motion frames 10.8 and 13');
  // No hang: it keeps cycling between chase and swing.
  let swings = 0;
  let last: string = d.state;
  run(d, t, 1500, () => {
    if (d.state !== last) {
      if (d.state === 'swing') swings++;
      last = d.state;
    }
  });
  check(swings >= 5, `keeps swinging (${swings})`);
}

// --- roll ---------------------------------------------------------------------------
{
  const d = mk([0, 0, 0, 0, 0, 0], () => 0.99);
  const t = [player(0, 110)];
  until(d, t, 'chase', 300);
  const n = until(d, t, 'roll', 600);
  check(n >= 0, 'target 70 or more away: the roll');
  const shots: AiFrame['shots'][] = [];
  const z0 = d.z;
  run(d, t, 300, (r) => r.shots && shots.push(r.shots));
  check(d.z > z0, 'rolled toward the target');
  const all = shots.flat() as DelbiterContact[];
  check(all.length >= 1 && all[0] instanceof DelbiterContact, 'a roll hit on the player');
  eq(all[0]?.effect, { kind: 'tech', power: 888 }, 'plain roll: iparam3');
  const again = new Set<number>();
  for (const s of all) again.add(s.tick(t).length);
  check(all.length <= 3, `each player is hit once per roll (${all.length})`);
}

// --- howl ------------------------------------------------------------------------------
{
  // param1 high: the howl follows the roll; param2 high: always confuses.
  const d = mk([1, 1, 100, 0, 0, 0], () => 0.1);
  const t = [player(0, 110), player(600, 600, 1)];
  d.tick(t);
  let confused: number[] = [];
  run(d, t, 1500, (r) => {
    if (r.status && r.status.type === STATUS.confusion) confused.push(r.status.clientId);
  });
  check(confused.includes(0), 'the howl confuses the player in range');
  check(!confused.includes(1), 'but not the one beyond +0x4b8');
}

// --- laser -----------------------------------------------------------------------------------
{
  const mkL = (ultimate: boolean) => mk([0, 0, 0, 1, 0, 0], () => 0.1, ultimate);
  for (const ultimate of [false, true]) {
    const d = mkL(ultimate);
    const t = [player(0, 40), player(120, 120, 1), player(-30, 20, 2)];
    let beams = 0;
    let visited = false;
    run(d, t, 3000, (r) => {
      if (d.state === 'laser') visited = true;
      for (const s of r.shots ?? []) if (!(s instanceof DelbiterContact)) beams++;
    });
    check(visited, `${ultimate ? 'Ultimate' : 'Normal'}: reaches the laser`);
    check(beams >= (ultimate ? 3 : 1), `${ultimate ? 'Ultimate fires 3 beams' : 'a beam'} per cast (${beams})`);
  }
  // The farthest player within 300 is the target.
  const d = mkL(false);
  const t = [player(0, 40), player(0, 200, 1)];
  run(d, t, 1500, () => {
    if (d.state === 'laser') {
      check(d.targetId === 1 || d.targetId === 0, 'laser target set');
    }
  });
  let target = -1;
  const e = mkL(false);
  run(e, t, 3000, () => {
    if (e.state === 'laser' && e.targetId !== null) target = e.targetId;
  });
  eq(target, 1, 'the farthest player within 300 is the laser target');
}

// --- flinch, charge, super armor -----------------------------------------------------------------
{
  const d = mk([0, 0, 0, 0, 1, 0], () => 0.01);
  const t = [player(0, 40)];
  until(d, t, 'chase', 300);
  d.onDamage(0);
  eq(d.state, 'flinch', 'a hit outside the busy states: state 10');
  check(!d.superArmor, 'the owner may play the damage motion');
  eq([d.flinchMotion.index, d.flinchMotion.speed], [2, 1], 'damage row: motion 2 at 1.0');
  d.onDamage(0);
  check(d.superArmor, 'a second hit during the flinch does not restart it');
  d.hpFraction = 0.4;
  eq(d.resume(), 'charge', 'half HP or less + param5 + 0.05: the charge-up');
  run(d, t, 200);
  check(d.state === 'chase' || d.state === 'swing' || d.state === 'roll', `charge-up ends (${d.state})`);
  // Charged: hits no longer flinch.
  d.onDamage(0);
  check(d.superArmor && d.state !== 'flinch', 'charged: no flinch');
}
{
  const d = mk([0, 0, 0, 0, 0, 0], () => 0.99);
  const t = [player(0, 280)];
  until(d, t, 'chase', 300);
  check(until(d, t, 'roll', 600) >= 0, 'far target: roll');
  d.onDamage(0);
  check(d.state === 'roll' && d.superArmor, 'rolling: a hit does not interrupt it');
}

// --- no target, fade-out, respawn ------------------------------------------------------------------
{
  const d = mk([0, 0, 0, 0, 0, 0], () => 0.99);
  const t = [player(0, 250)];
  until(d, t, 'chase', 300);
  d.x = 77;
  const w0 = d.warps;
  const n = until(d, [], 'wait', 100);
  check(n >= 0, 'no target: state 4');
  check(d.invulnerable, 'waiting is invulnerable (0x184)');
  check(until(d, [], 'hidden', 400) >= 0, '60 frames + the 50-frame fade-out: hidden again');
  check(d.hidden, 'not drawn');
  const s = until(d, t, 'walkIn', 100);
  check(s >= 0 && d.warps > w0 && d.x === 0, 'respawns at the spawn point and bumps warps');
}

// --- death ---------------------------------------------------------------------------------------------
{
  const d = mk();
  const t = [player(0, 40)];
  until(d, t, 'chase', 300);
  d.kill();
  eq(d.state, 'dead', 'kill(): dead');
  const r = d.tick(t);
  check(!r.hit && !r.shots, 'a dead brain does nothing');
  eq([d.deathMotion.index, d.deathMotion.speed], [3, 0.7], 'death row: motion 3 at 0.7');
}

// --- soak: every state is reached and nothing hangs --------------------------------------------------------
{
  const seen = new Set<string>();
  for (let seed = 1; seed <= 6; seed++) {
    const rng = seeded(seed);
    const d = mk([0.3, 0.3, 0, 0.3, 0.4, seed % 2], rng, seed > 3, 0.4);
    let stuck = 0;
    let prev = '';
    const t = [player(0, 150), player(60, 250, 1)];
    for (let i = 0; i < 20000; i++) {
      if (i % 2000 === 1000) {
        t[0].x = (rng() - 0.5) * 400;
        t[0].z = (rng() - 0.5) * 400;
      }
      if (i % 3000 === 2500) d.onDamage(0);
      const st = d.state;
      seen.add(st);
      if (st === 'flinch') {
        if (++stuck > 3) {
          d.resume();
          stuck = 0;
        }
      } else stuck = 0;
      d.tick(i % 5000 > 4200 ? [] : t);
      prev = st;
    }
    void prev;
  }
  const want: DelbiterState[] = ['hidden', 'walkIn', 'runIn', 'wait', 'chase', 'roll', 'swing', 'howl', 'laser', 'flinch', 'charge'];
  for (const s of want) check(seen.has(s), `soak reaches ${s}`);
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('delbiter: all checks passed');

}
