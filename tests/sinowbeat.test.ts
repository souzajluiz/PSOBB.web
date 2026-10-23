// Sinow Beat's mirage (combat/enemyfsmmines.ts SinowAi): the cast every other
// warp away, the four clones in the child slots, the five bodies spinning round
// the target, the dismissals (a hit on the body, a clone's hit, the 2nd combo,
// the death) and the evp halving. The rest of the Sinow is
// tests/enemyfsmmines.test.ts.
//
// Run: node tests/sinowbeat.test.ts
import { SINOW, SINOW_MIRAGE, SinowAi, type SinowEvent } from '../client/src/combat/enemyfsmmines.ts';
import type { AiFrame, AiTarget } from '../client/src/combat/enemyai.ts';
import { expandEnemySets } from '../client/src/formats/enemyslots.ts';
import type { EnemySet } from '../client/src/formats/setdata.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(a === b, `${what}: ${String(a)} != ${String(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-3) => check(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);

const atk = { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 15, angle: 0x2000, distanceY: 0 };
const mv = { fparam1: 1.25, fparam2: 0, fparam3: 0.6, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [0, 0, 5, 0, 0, 0] };
const at = (x: number, z: number): AiTarget => ({ clientId: 0, x, z, charClass: 0, dead: false, angle: 0 });
const body = (over: { gold?: boolean; ultimate?: boolean; param1?: number; ally?: boolean; rng?: () => number } = {}): SinowAi =>
  new SinowAi({ x: 0, z: 0, angle: 0, gold: over.gold ?? false, ultimate: over.ultimate ?? false, movement: mv, attack: atk, radius: 10, param1: over.param1 ?? 0, ally: over.ally, rng: over.rng ?? (() => 0.5) });

// Runs the body against a standing player until `until`; the motion's end is
// reported when `frames` ticks of the current motion have passed (the real
// length does not matter for the cast).
interface Run {
  ticks: number;
  states: string[];
  events: SinowEvent[];
}
function run(ai: SinowAi, targets: AiTarget[], max: number, until: (r: Run) => boolean, endAfter = 40): Run {
  const r: Run = { ticks: 0, states: [ai.state], events: [] };
  let inState = 0;
  for (; r.ticks < max; r.ticks++) {
    inState++;
    const f: AiFrame = ai.tick(targets, inState >= endAfter);
    if (f.motion) inState = 0;
    r.events.push(...ai.events.splice(0));
    if (r.states.at(-1) !== ai.state) {
      r.states.push(ai.state);
      inState = 0;
    }
    if (until(r)) break;
  }
  return r;
}

// A Beat that has just seen a player and fights: wait, drop, chase.
function fighting(ai: SinowAi, t: AiTarget): void {
  run(ai, [t], 400, () => ai.state === 'chase');
}

// 1. The cast comes every other warp away: after the 2nd combo the body warps
//    away (the clones go if they were out), and a Beat with param1 < 1 casts
//    at the end of the first warp away, chases at the end of the second.
{
  const ai = body();
  const t = at(0, 20);
  fighting(ai, t);
  const r = run(ai, [t], 4000, (r) => r.events.some((e) => e.kind === 'mirage'));
  check(r.states.includes('away'), 'the warp away comes first');
  check(r.states.includes('cast'), 'a Beat casts after the warp away');
  const cast = r.events.find((e) => e.kind === 'mirage');
  check(!!cast && cast.kind === 'mirage' && cast.main >= 0 && cast.main < SINOW_MIRAGE.slots, 'the real body takes one of the 5 places');
  eq(ai.state, 'approach', 'and goes to state 8');
}

// 2. Which place the body takes: round-down(5 * rand), and the clones take the
//    other four in order.
{
  for (const [rng, main] of [[0, 0], [0.19, 0], [0.2, 1], [0.5, 2], [0.79, 3], [0.99, 4]] as const) {
    const ai = body({ rng: () => rng });
    const t = at(0, 20);
    fighting(ai, t);
    const r = run(ai, [t], 4000, (r) => r.events.some((e) => e.kind === 'mirage'));
    void r;
    eq(ai.slot, main, `rand ${rng}: place ${main}`);
  }
}

// 3. The clones: dormant (parked, invulnerable) until activated; they come on
//    the body's place with the target, and go to state 8.
{
  const clone = body({ ally: true });
  eq(clone.state, 'hide', 'a clone starts parked');
  check(clone.dormant && clone.invulnerable && clone.hidden, 'parked: hidden and cannot be hit');
  const t = at(0, 100);
  clone.tick([t]);
  eq(clone.state, 'hide', 'it stays parked');
  const f = clone.activate(10, 20, 1, 3, 0, 0, 100);
  eq(clone.state, 'approach', 'activated: state 8');
  check(!clone.hidden && !clone.invulnerable, 'it is out');
  near(f.x, 10, 'on the body\'s place');
  check(!!f.motion, 'the technique motion plays');
}

// 4. State 8: five bodies at the places 0..4 spin round the target at
//    (slot - 2) * 0x3333 / 0x28 BAMS a frame, closing to 80; the place 2 does not
//    spin. After 40 frames they chase.
{
  const t = at(0, 0);
  const places = [0, 1, 2, 3, 4];
  const bodies = places.map((p) => {
    const c = body({ ally: true });
    c.activate(200, 0, 0, p, 0, 0, 0);
    return c;
  });
  const ang = (c: SinowAi) => Math.atan2(c.x, c.z);
  const start = bodies.map(ang);
  for (let i = 0; i < 39; i++) for (const c of bodies) c.tick([t]);
  const turned = bodies.map((c, i) => ang(c) - start[i]);
  check(Math.abs(turned[2]) < 1e-6, 'the middle place does not spin');
  check(turned[3] * turned[1] < 0 || (turned[1] === 0 && turned[3] === 0), 'places 1 and 3 spin opposite ways');
  check(Math.abs(turned[4]) > Math.abs(turned[3]) && Math.abs(turned[0]) > Math.abs(turned[1]), 'the outer places spin faster');
  // 327 BAMS a frame for place 3: 39 frames of rotation (the first tick starts it).
  const per = (327 * Math.PI * 2) / 65536;
  near(Math.abs(turned[3]), 39 * per, 'the place-3 rate', 0.02);
  // Closing: from 200 to 80 at 3 a frame takes 40 frames, so after 39 it is at 83.
  for (const c of bodies) near(Math.hypot(c.x, c.z), 200 - 3 * 39, 'closing 3 a frame', 0.5);
  for (const c of bodies) c.tick([t]);
  for (const c of bodies) {
    eq(c.state, 'chase', 'after 40 frames: chase');
    check(c.mirage, 'flag 0x10: the evp is halved');
    eq(c.evpScale, 0.5, 'evpScale');
  }
}

// 5. A hit on a clone sends it away at once; a hit on the body dismisses every
//    clone and restores the evp.
{
  const c = body({ ally: true });
  c.activate(50, 0, 0, 1, 0, 0, 0);
  check(c.flinches() === false, 'a clone does not flinch');
  c.onDamage(0);
  eq(c.state, 'hide', 'a hit sends a clone to state 0xf');
  check(!c.hidden && c.invulnerable, 'it cannot be hit while it goes');
  for (let i = 0; i < SINOW_MIRAGE.hideFrames + 2; i++) c.tick([at(0, 0)]);
  check(c.hidden, '10 frames later it is gone');
}
{
  const ai = body();
  const t = at(0, 20);
  fighting(ai, t);
  run(ai, [t], 4000, (r) => r.events.some((e) => e.kind === 'mirage'));
  // 40 frames of spinning, then the flag.
  run(ai, [t], 60, () => ai.state === 'chase');
  check(ai.mirage && ai.evpScale === 0.5, 'the mirage is out and the evp halved');
  ai.events.splice(0);
  ai.onDamage(0);
  const ev = ai.events.splice(0);
  eq(ev.length, 1, 'a hit on the body');
  eq(ev[0]?.kind, 'dismiss', '... dismisses the clones');
  check(!ai.mirage && ai.evpScale === 1, 'the evp is back');
}

// 6. The 2nd combo with the mirage out dismisses it before the warp away; a
//    clone's combo only chases (it never warps away or casts).
{
  const ai = body();
  const t = at(0, 20);
  fighting(ai, t);
  run(ai, [t], 4000, (r) => r.events.some((e) => e.kind === 'mirage'));
  run(ai, [t], 60, () => ai.state === 'chase');
  ai.events.splice(0);
  // Keep the player in the combo's reach: the body fights, the 2nd combo ends.
  const r = run(ai, [at(ai.x, ai.z + 12)], 4000, () => ai.state === 'away');
  check(r.events.some((e) => e.kind === 'dismiss'), 'the 2nd combo sends the clones away');
  const c = body({ ally: true });
  c.activate(0, 0, 0, 0, 0, 0, 12);
  const seen = new Set<string>();
  for (let i = 0; i < 4000; i++) {
    c.tick([at(0, 12)], i % 40 === 39);
    seen.add(c.state);
    c.events.splice(0);
  }
  check(!seen.has('away') && !seen.has('cast'), 'a clone never warps away or casts');
}

// 7. Not every Sinow casts: the Gold casts its technique instead, a Beat with
//    param1 >= 1 never mirages, the second warp away chases.
{
  const t = at(0, 20);
  const gold = body({ gold: true });
  fighting(gold, t);
  const rg = run(gold, [t], 6000, () => gold.state === 'tech');
  check(!rg.states.includes('cast') && gold.state === 'tech', 'the Gold casts its technique');
  const high = body({ param1: 1 });
  fighting(high, t);
  const rh = run(high, [t], 6000, () => high.state === 'away');
  void rh;
  const after = run(high, [t], 600, () => high.state !== 'away');
  check(!after.states.includes('cast'), 'param1 >= 1: no mirage');
  // The toggle: cast, then chase at the next warp away.
  const ai = body();
  fighting(ai, t);
  let casts = 0;
  let aways = 0;
  let last = ai.state;
  for (let i = 0; i < 40000 && aways < 5; i++) {
    ai.tick([at(ai.x, ai.z + 12)], i % 30 === 29);
    ai.events.splice(0);
    if (ai.state !== last) {
      if (ai.state === 'cast') casts++;
      if (ai.state === 'away') aways++;
      last = ai.state;
    }
  }
  check(casts >= 2 && casts <= 3, `a cast every other warp away (${casts} in ${aways})`);
}

// 8. The cast without a target (or one that left) does not hang: no clones, chase.
{
  const ai = body();
  const t = at(0, 20);
  fighting(ai, t);
  run(ai, [t], 4000, () => ai.state === 'cast');
  eq(ai.state, 'cast', 'in the cast');
  for (let i = 0; i < 200 && ai.state === 'cast'; i++) ai.tick([], true);
  check(ai.state !== 'cast', 'it ends');
}

// 9. The mirage works whatever the animation lengths: a whole fight never
//    stalls in a mirage state.
{
  const ai = body();
  const t = at(0, 20);
  let worst = 0;
  let stay = 0;
  let last = ai.state;
  for (let i = 0; i < 60000; i++) {
    ai.tick([at(ai.x + 3, ai.z + 12)], i % 25 === 24);
    ai.events.splice(0);
    if (ai.state === last) stay++;
    else {
      worst = Math.max(worst, stay);
      stay = 0;
      last = ai.state;
    }
  }
  void t;
  check(worst < 500, `no state stays long (${worst})`);
}

// 10. The place count: 4 child slots follow a Sinow's own in the floor's slots.
{
  const set = (type: number, index: number): EnemySet =>
    ({ type, index, section: 0, wave: 0, delay: 0, params: [0, 0, 0, 0, 0, 0], numChildren: 0, x: 0, y: 0, z: 0, yaw: 0, floor: 0, roomX: 0, roomY: 0, roomZ: 0, rotX: 0, rotY: 0, rotZ: 0 }) as unknown as EnemySet;
  const slots = expandEnemySets([set(0x82, 0)], 3);
  eq(slots.length, 1 + SINOW_MIRAGE.clones, 'a Sinow owns 4 child slots');
  check(slots.slice(1).every((s) => s.set === slots[0].set && s.type === slots[0].type), 'the clones\' slots belong to the same set entry');
}

// 11. Dead bodies are quiet; a dead body dismisses (once).
{
  const ai = body();
  const t = at(0, 20);
  fighting(ai, t);
  run(ai, [t], 4000, (r) => r.events.some((e) => e.kind === 'mirage'));
  run(ai, [t], 60, () => ai.state === 'chase');
  ai.events.splice(0);
  ai.kill();
  eq(ai.events.filter((e) => e.kind === 'dismiss').length, 1, 'the death sends the clones away');
  eq(ai.state, 'dead', 'dead');
  ai.kill();
  eq(ai.events.filter((e) => e.kind === 'dismiss').length, 1, 'once');
}

// 9. The Gold's technique (0x0058dde4): at the motion's end Resta on itself at
//    the clamped iparam1 (13, or 28 in Ultimate); Ultimate adds Shifta at 5 and
//    Deband at 10 frames; then iparam2 frames before the chase.
{
  const m = { fparam1: 1.25, fparam2: 0, fparam3: 0.6, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [20, 3, 5, 0, 0, 0] };
  const cast = (ultimate: boolean): { heal: number | null; fx: Array<[number, string]>; leftAt: number } => {
    const g = new SinowAi({ x: 0, z: 0, angle: 0, gold: true, ultimate, movement: m, attack: atk, radius: 10, rng: () => 0.5 });
    const t = at(0, 20);
    fighting(g, t);
    run(g, [t], 6000, () => g.state === 'tech');
    g.events.splice(0);
    const first = g.tick([t], true);
    const fx: Array<[number, string]> = [];
    const note = (tick: number) => {
      for (const ev of g.events.splice(0)) if (ev.kind === 'tech') fx.push([tick, ev.tech]);
    };
    note(1);
    let tick = 1;
    while (g.state === 'tech' && tick < 100) {
      tick++;
      g.tick([t], false);
      note(tick);
    }
    return { heal: first.heal?.level ?? null, fx, leftAt: tick };
  };
  const plain = cast(false);
  eq(plain.heal, 13, 'the Resta level is clamped to 13 outside Ultimate');
  check(JSON.stringify(plain.fx) === JSON.stringify([[1, 'resta']]), `outside Ultimate only the Resta effect: ${JSON.stringify(plain.fx)}`);
  eq(plain.leftAt, 4, 'then iparam2 frames (sub 1) and the chase');
  const ult = cast(true);
  eq(ult.heal, 20, 'the Resta level in Ultimate is iparam1 (up to 28)');
  const want = [[1, 'resta'], [5, 'shifta'], [10, 'deband']];
  check(JSON.stringify(ult.fx) === JSON.stringify(want), `Ultimate: Shifta at 5, Deband at 10: ${JSON.stringify(ult.fx)}`);
  eq(ult.leftAt, 14, 'the hold after the Deband');
}

void SINOW;
if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('sinowbeat: ok');
