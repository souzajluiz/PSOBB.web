// The Dragon's fight (client/src/combat/dragon.ts): the action sequences, the
// hp clamp and the roars, the death path, the leader's 6x12 and a follower
// that obeys it, the children (flames, fireballs, area hits) and a whole
// fight with the real motion frame counts so no state can hang.
//
// Run: node tests/dragon.test.ts
import {
  DragonAi,
  DragonBurst,
  DRAGON_BODY_BOXES,
  DRAGON_MOUTH,
  DRAGON_SE,
  DRAGON_NODE_TABLE,
  DRAGON_TAIL,
  DragonFireball,
  DragonFlame,
  DragonTrapezoid,
  DRAGON_FIRE_IDS,
  DRAGON_PARTICLE_IDS,
  DRAGON_CURSOR_B,
  DRAGON_SEQ_NORMAL_A,
  DRAGON_SEQ_NORMAL_B,
  DRAGON_SEQ_ULTIMATE_A,
  DRAGON_SEQ_ULTIMATE_B,
  DRAGON_SLOTS,
  DRAGON_STATE,
  dragonNext,
  footNodes,
  type DragonEvent,
  type DragonOptions,
} from '../client/src/combat/dragon.ts';
import { MAP_PARTICLE_COUNT, MAP_PARTICLE_FIRST, particleMapFile } from '../client/src/classic/particles.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import type { EnemyMovementData } from '../client/src/formats/battleparams.ts';
import type { EnemyShot } from '../client/src/combat/enemyshots.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

// A seeded generator so runs repeat.
function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// The motions' frame counts in bm_boss1_dragon.bml (0 bossop .. 25 wngopn),
// read from the client data (data.gsl).
const REAL_FRAMES = [170, 53, 27, 130, 27, 27, 80, 44, 14, 26, 14, 30, 80, 80, 27, 27, 80, 53, 26, 50, 44, 40, 40, 27, 27, 27];
const realFrames = (m: number) => REAL_FRAMES[m] ?? 30;

// MovementData row 17, Normal and Ultimate (BattleParamEntry_on.dat).
const ROW_NORMAL: EnemyMovementData = { fparam1: 150, fparam2: 130, fparam3: 200, fparam4: 80, fparam5: 0, fparam6: 0, iparam: [0, 5, 15, 0, 0, 0] };
const ROW_ULTIMATE: EnemyMovementData = { fparam1: 1670, fparam2: 1300, fparam3: 2290, fparam4: 150, fparam5: 2, fparam6: 10, iparam: [0, 48, 75, 0, 0, 0] };

function brain(over: Partial<DragonOptions> = {}): DragonAi {
  return new DragonAi({
    x: 0,
    z: 0,
    angle: 0,
    ultimate: false,
    movement: ROW_NORMAL,
    hp: 2500,
    leader: () => true,
    frames: realFrames,
    playerHp: () => 500,
    rng: seeded(7),
    ...over,
  });
}

const player = (id: number, x: number, z: number, dead = false): AiTarget => ({ clientId: id, x, z, charClass: 0, dead });

// Runs a brain; returns what it did. `until` stops the run.
interface Run {
  ticks: number;
  events: DragonEvent[];
  shots: EnemyShot[];
  states: number[]; // each state it entered, in order
  longest: number; // the longest stay in one state
  warps: number;
}
function run(ai: DragonAi, targets: AiTarget[], max: number, until: () => boolean = () => false, follower: DragonAi | null = null): Run {
  const r: Run = { ticks: 0, events: [], shots: [], states: [ai.sid], longest: 0, warps: 0 };
  let stay = 0;
  for (; r.ticks < max; r.ticks++) {
    const f = ai.tick(targets);
    if (f.shots) r.shots.push(...f.shots);
    const ev = ai.events.splice(0);
    r.events.push(...ev);
    if (follower) {
      for (const e of ev) if (e.kind === 'send') follower.applyRemote(e.state, e.cursor, e.target, e.x, e.z);
      follower.tick(targets);
      follower.events.splice(0);
    }
    if (r.states.at(-1) !== ai.sid) {
      r.states.push(ai.sid);
      r.longest = Math.max(r.longest, stay);
      stay = 0;
    } else stay++;
    r.longest = Math.max(r.longest, stay);
    if (until()) break;
  }
  r.warps = ai.warps;
  return r;
}

const S = DRAGON_STATE;

// 1. The sequences: 0x20 / 0x21 restart, the cursor is stored plus one.
eq(DRAGON_SEQ_NORMAL_A.join(), '2,3,4,5,6,7,8,32', 'normal A');
eq(DRAGON_SEQ_NORMAL_B.join(), '5,6,15,16,18,17,18,17,18,19,8,2,3,33', 'normal B');
eq(DRAGON_SEQ_ULTIMATE_A.join(), '2,3,2,3,4,5,6,34,8,32', 'Ultimate A');
eq(DRAGON_SEQ_ULTIMATE_B.join(), '5,6,15,16,18,17,18,35,19,8,2,3,33', 'Ultimate B');
{
  let c = 0;
  const seen: number[] = [];
  for (let i = 0; i < 16; i++) {
    const n = dragonNext(c, false);
    seen.push(n.state);
    c = n.cursor;
  }
  eq(seen.join(), '2,3,4,5,6,7,8,2,3,4,5,6,7,8,2,3', 'sequence A loops');
  eq(c, 2, 'the cursor after 16 picks');
  let b = DRAGON_CURSOR_B;
  const sb: number[] = [];
  for (let i = 0; i < 14; i++) {
    const n = dragonNext(b, false);
    sb.push(n.state);
    b = n.cursor;
  }
  eq(sb.join(), '5,6,15,16,18,17,18,17,18,19,8,2,3,5', 'sequence B loops back to its start');
  eq(b, DRAGON_CURSOR_B + 1, 'B after wrapping');
  eq(dragonNext(7, false).state, 2, 'the loop token 0x20 reads entry 0');
  eq(dragonNext(7, false).cursor, 1, '... and stores 1');
}

// 2. The motion table (0x009a3ae0): spot checks.
eq(DRAGON_SLOTS.length, 27, 'slots');
eq(DRAGON_SLOTS[1].motion, 21, 'walk is motion 21');
eq(DRAGON_SLOTS[17].next, 14, 'land goes on to wngclose');
eq(DRAGON_SLOTS[19].speed, 0.5, 'the run-time speed of the death motion');

// 3. The trapezoid profile (the easing records).
{
  const t = new DragonTrapezoid();
  t.set(0.1, -0.1, 200, 2);
  check(near(t.value(0), 0), 'starts at 0');
  check(near(t.value(20), 20), 'accelerated 20 in 20 ticks');
  check(near(t.value(10000), 200), 'ends at the distance');
  let prev = -1;
  let mono = true;
  for (let i = 0; i < 400; i++) {
    const v = t.value(i);
    if (v < prev - 1e-6) mono = false;
    prev = v;
  }
  check(mono, 'monotonic');
  check(t.done(400) && !t.done(20), 'done only at the end');
  // A distance too short for the top speed: the triangle.
  const s = new DragonTrapezoid();
  s.set(16, -16, 5, 512);
  check(near(s.value(1000), 5), 'the triangle ends at the distance');
}

// 4. The entrance: bossop runs out, then the leader sends state 0, then 2.
{
  const ai = brain();
  eq(ai.sid, S.intro, 'starts in the entrance');
  check(ai.untargetable && ai.invulnerable, 'the entrance cannot be hit');
  const r = run(ai, [player(0, 100, 0)], 2000, () => ai.sid === S.walk);
  eq(ai.sid, S.walk, 'the first action is the walk');
  const sends = r.events.filter((e) => e.kind === 'send') as Extract<DragonEvent, { kind: 'send' }>[];
  eq(sends[0].state, S.wait, 'state 0 first');
  eq(sends[1].state, S.walk, 'then state 2');
  // 170 frames at 0.5: 340 ticks.
  check(r.ticks >= 335 && r.ticks < 360, `the entrance takes the motion's length (${r.ticks})`);
  eq(sends[1].cursor, 1, 'the cursor is stored plus one');
  check(!ai.untargetable, 'targetable afterwards');
}

// 5. A whole first-phase loop with the real frame counts never stalls and
//    visits every state of the sequence.
{
  const ai = brain();
  const t = player(0, 120, 60);
  // Keep the roar away: a hit-free fight.
  const r = run(ai, [t], 30 * 60 * 6, () => false);
  const first = r.states.filter((s) => s !== S.intro && s !== S.wait);
  for (const s of [S.walk, S.fire, S.tail, S.flyUp, S.flyAcross, S.flyShoot, S.land]) check(first.includes(s), `phase A visits state ${s}`);
  // The order repeats 2 3 4 5 6 7 8.
  const seq = first.slice(0, 14).join();
  eq(seq, '2,3,4,5,6,7,8,2,3,4,5,6,7,8', 'the first-phase order');
  check(r.longest < 30 * 25, `no state stays long (${r.longest} ticks)`);
  const flames = r.shots.filter((s) => s instanceof DragonFlame).length;
  const fireballs = r.shots.filter((s) => s instanceof DragonFireball).length;
  check(flames >= 50 * 3, `the breath spawns flames (${flames})`);
  check(fireballs >= 12 && fireballs % 3 === 0, `fireballs come in threes (${fireballs})`);
  check(r.shots.some((s) => s instanceof DragonBurst), 'stomps strike');
}

// 6. Per-state timing with the real motions (each state ends on its own).
{
  const limits: Record<number, number> = { 2: 600, 3: 330, 4: 120, 5: 150, 6: 700, 7: 500, 8: 300 };
  const ai = brain();
  const t = player(0, 120, 60);
  const stay = new Map<number, number>();
  let cur = -1;
  let n = 0;
  for (let i = 0; i < 30 * 60 * 4; i++) {
    ai.tick([t]);
    ai.events.splice(0);
    if (ai.sid !== cur) {
      if (cur >= 0) stay.set(cur, Math.max(stay.get(cur) ?? 0, n));
      cur = ai.sid;
      n = 0;
    }
    n++;
  }
  for (const [s, max] of Object.entries(limits)) check((stay.get(Number(s)) ?? 0) <= max, `state ${s} stays at most ${max} ticks (${stay.get(Number(s))})`);
}

// 7. The hit clamp: hp cannot go under 90 % in the first sequence; the roar
//    follows, with the second sequence for good, and the next clamp is 70 %.
{
  const ai = brain();
  const t = player(0, 120, 60);
  run(ai, [t], 2000, () => ai.sid === S.walk);
  eq(ai.thr, 2250, 'the first clamp is 90 %');
  ai.hit(1000);
  const r = run(ai, [t], 5, () => ai.sid === S.roar);
  eq(ai.hp, 2250, 'hp is held at the clamp');
  eq(ai.sid, S.roar, 'the leader roars');
  eq(ai.cursor, DRAGON_CURSOR_B, 'the second sequence starts');
  const send = r.events.find((e) => e.kind === 'send' && e.state === S.roar);
  check(!!send, 'the roar is sent');
  check(ai.invulnerable && ai.superArmor, 'invulnerable and super armor while roaring');
  run(ai, [t], 400, () => ai.sid !== S.roar);
  eq(ai.thr, 1750, 'leaving the roar moves the clamp to 70 % of 2500 (hp 2250 > 1750)');
  check(ai.sid !== S.roar, 'the roar ends');
}

// 8. The roar in the air lands first (0xb), then roars (0xd).
{
  const ai = brain();
  const t = player(0, 120, 60);
  run(ai, [t], 4000, () => ai.sid === S.flyAcross);
  eq(ai.sid, S.flyAcross, 'in the air');
  check(ai.air === 1, 'airborne');
  ai.hit(1000);
  const r = run(ai, [t], 3000, () => ai.sid === S.roar);
  eq(ai.sid, S.roar, 'it ends in the roar');
  check(r.states.includes(S.landRoar), 'through the landing roar state 0xb');
  check(ai.alt === 0, 'on the ground');
}

// 9. Death: only in the second sequence, 0x15 on the ground (0xc in the air),
//    the kill event once, on leaving state 0x15.
{
  const ai = brain();
  const t = player(0, 120, 60);
  run(ai, [t], 2000, () => ai.sid === S.walk);
  ai.hit(100000);
  // Phase A: the clamp keeps it alive.
  run(ai, [t], 3, () => false);
  check(ai.hp >= 2250 - 1 && ai.sid !== S.death, 'the first sequence cannot die');
  // Finish the roar, then kill it in the second sequence.
  run(ai, [t], 600, () => ai.sid !== S.roar && ai.cursor >= DRAGON_CURSOR_B && ai.sid !== S.wait && ai.sid !== S.walk);
  ai.hit(100000);
  const r = run(ai, [t], 4000, () => ai.dead);
  check(ai.dead, 'it dies');
  eq(r.events.filter((e) => e.kind === 'killed').length, 1, 'one kill event');
  check(r.states.includes(S.death) && r.states.includes(S.corpse), 'death, then the corpse');
  const killed = r.events.find((e) => e.kind === 'killed');
  check(!!killed, 'kill event position');
  // Dead: ticking does nothing.
  const n = ai.events.length;
  ai.tick([t]);
  eq(ai.events.length, n, 'a dead boss is quiet');
}
{
  // Killed in the air: it lands (0xc) and dies from there.
  const ai = brain();
  const t = player(0, 120, 60);
  ai.cursor = DRAGON_CURSOR_B;
  run(ai, [t], 4000, () => ai.sid === S.flyAcross);
  check(ai.air === 1, 'airborne in the second sequence');
  ai.hit(100000);
  run(ai, [t], 4000, () => ai.dead);
  check(ai.dead, 'a kill in the air also ends in death');
}

// 10. The second sequence with the real frames: dive, burrow, emerge, land.
{
  const ai = brain();
  ai.cursor = DRAGON_CURSOR_B;
  const t = player(0, 120, 60);
  ai.hit(0);
  const r = run(ai, [t], 30 * 60 * 5, () => false);
  const order = r.states.filter((s) => s !== S.intro && s !== S.wait).slice(0, 13).join();
  eq(order, '5,6,15,16,18,17,18,17,18,19,8,2,3', 'the second-phase order');
  check(r.longest < 30 * 20, `no state stays long (${r.longest} ticks)`);
  for (const s of [S.dive, S.burrowFirst, S.burrowNext, S.burrowOut, S.emerge]) check(r.states.includes(s), `phase B visits ${s}`);
  check(r.warps > 0, 'teleports bump the warp counter');
}

// 11. Underground states are invulnerable, the emergence is not.
{
  const ai = brain();
  ai.cursor = DRAGON_CURSOR_B;
  const t = player(0, 120, 60);
  let inv = true;
  let vul = false;
  let underground = true;
  for (let i = 0; i < 30 * 60 * 3; i++) {
    ai.tick([t]);
    ai.events.splice(0);
    if (ai.sid >= S.burrowFirst && ai.sid <= S.burrowOut) {
      inv &&= ai.invulnerable;
      underground &&= ai.alt < 0;
    }
    if (ai.sid === S.emerge) vul ||= !ai.invulnerable;
  }
  check(inv, 'burrowing cannot be hit');
  check(underground, 'burrowing is below the floor');
  check(vul, 'the emerging dragon can be hit');
}

// 12. Ultimate: the sequences carry 34 and 35 and the fire rain / spiral end.
{
  const ai = brain({ ultimate: true, movement: ROW_ULTIMATE, hp: 16500 });
  const t = player(0, 120, 60);
  const r = run(ai, [t], 30 * 60 * 5, () => false);
  check(r.states.includes(S.rain), 'the Ultimate A sequence rains fire');
  check(r.longest < 30 * 25, `Ultimate A never stalls (${r.longest})`);
  const balls = r.shots.filter((s) => s instanceof DragonFireball).length;
  check(balls >= 40, `the rain throws 40 fireballs (${balls})`);
  const b = brain({ ultimate: true, movement: ROW_ULTIMATE, hp: 16500 });
  b.cursor = DRAGON_CURSOR_B;
  const rb = run(b, [t], 30 * 60 * 5, () => false);
  check(rb.states.includes(S.circle), 'the Ultimate B sequence spirals');
  check(rb.longest < 30 * 25, `Ultimate B never stalls (${rb.longest})`);
}

// 13. The follower obeys the leader's 6x12 and sends nothing of its own.
{
  const lead = brain();
  const fol = brain({ leader: () => false, rng: seeded(99) });
  const t = player(0, 120, 60);
  const r = run(lead, [t], 30 * 60 * 3, () => false, fol);
  eq(fol.sid, lead.sid, 'the follower is in the leader\'s state');
  check(fol.events.length === 0, 'a follower sends nothing');
  eq(fol.cursor, lead.cursor, 'the same cursor');
  check(r.events.filter((e) => e.kind === 'send').length > 20, 'the leader sent its steps (and the walk tracking)');
}

// 14. The walk tracking: while walking, a 6x12 every 20 ticks with the target.
{
  const ai = brain();
  const t = player(3, 200, 0);
  run(ai, [t], 2000, () => ai.sid === S.walk);
  const r = run(ai, [t], 100, () => ai.sid !== S.walk);
  const sends = r.events.filter((e) => e.kind === 'send') as Extract<DragonEvent, { kind: 'send' }>[];
  check(sends.length >= 4, `tracking packets (${sends.length})`);
  check(sends.every((e) => e.state === S.walk && e.target === 3 && near(e.x, 200)), 'they carry the state, the target and its position');
}

// 15. Becoming the leader mid-burrow picks the next state at once.
{
  let lead = false;
  const ai = brain({ leader: () => lead });
  ai.applyRemote(S.burrowFirst, DRAGON_CURSOR_B + 4, null, 0, 200);
  eq(ai.sid, S.burrowFirst, 'a follower in the burrow');
  for (let i = 0; i < 10; i++) ai.tick([player(0, 0, 0)]);
  eq(ai.sid, S.burrowFirst, 'still burrowing');
  lead = true;
  ai.tick([player(0, 0, 0)]);
  check(ai.sid !== S.burrowFirst, 'the new leader moves on');
}

// 16. A follower that hears nothing for a long time takes the step itself.
{
  const ai = brain({ leader: () => false });
  let moved = false;
  for (let i = 0; i < 30 * 60 * 3 && !moved; i++) {
    ai.tick([player(0, 100, 0)]);
    if (ai.sid !== S.intro) moved = true;
  }
  check(moved, 'a follower never waits for ever');
  check(ai.events.every((e) => e.kind !== "send"), "and sends nothing");
}

// 17. Remote damage: the hp is max - damage_taken on every client, clamped.
{
  const ai = brain({ leader: () => false });
  ai.setDamageTaken(100);
  eq(ai.hp, 2400, 'restore_enemy_status');
  ai.tick([]);
  eq(ai.hp, 2400, 'above the clamp it is untouched');
  ai.setDamageTaken(900);
  ai.tick([]);
  eq(ai.hp, 2250, 'the clamp applies on a follower too');
  ai.cursor = DRAGON_CURSOR_B;
  ai.setDamageTaken(900);
  ai.tick([]);
  eq(ai.hp, 1600, 'no clamp once the second sequence runs');
}

// 18. The children: the flame flies at 5 and hits below 30 once per player; the
//     fireball lands after length / 25 ticks and bursts once.
{
  const f = new DragonFlame(0, 40, 0, 0, -0.5, 0.866, 150);
  const t = [player(0, 0, 60)];
  let hits = 0;
  for (let i = 0; i < 200 && !f.done; i++) hits += f.tick(t).length;
  eq(hits, 1, 'a flame hits a player once');
  check(f.done, 'a flame dies below -10');
  const b = new DragonFireball([0, 100, 0], [0, 0, 100], 130);
  let ticks = 0;
  let burst = 0;
  while (!b.done && ticks < 100) {
    burst += b.tick([player(0, 5, 100)]).length;
    ticks++;
  }
  eq(burst, 1, 'a fireball bursts once on the player at the aim point');
  check(ticks <= Math.ceil(141.42 / 25) + 2, `a fireball is quick (${ticks})`);
}

// 19. The breath is aimed (the flames fly down toward the aim point).
{
  const ai = brain();
  const t = player(0, 0, 200);
  const r = run(ai, [t], 4000, () => false);
  const flames = r.shots.filter((s) => s instanceof DragonFlame) as DragonFlame[];
  check(flames.length > 0, 'flames');
}

// 20. The area hits use the Dragon's AttackData (row index 0 for stomps, 4 for
//     the death).
{
  const ai = brain();
  ai.cursor = DRAGON_CURSOR_B;
  const t = player(0, 120, 60);
  ai.hit(0);
  const r = run(ai, [t], 30 * 60 * 5, () => false);
  const melee = r.shots.filter((s) => s instanceof DragonBurst && s.effect.kind === 'melee') as DragonBurst[];
  check(melee.length > 0, 'melee bursts');
  check(melee.every((m) => m.effect.kind === 'melee' && m.effect.attack === 0), 'stomps use AttackData row 0');
  const tech = r.shots.filter((s) => s instanceof DragonBurst && s.effect.kind === 'tech') as DragonBurst[];
  check(tech.length > 0, 'the burrow trail hits as a technique');
}

// 21. No allocation in the quiet frames: the tick of a settled state makes no
//     new shots and no events.
{
  const ai = brain();
  const t = player(0, 120, 60);
  run(ai, [t], 2000, () => ai.sid === S.roar || (ai.sid === S.walk && ai.cursor === 1));
  let quiet = 0;
  for (let i = 0; i < 60; i++) {
    const f = ai.tick([t]);
    if (!f.shots && ai.events.length === 0) quiet++;
    ai.events.splice(0);
  }
  check(quiet > 40, `most frames are quiet (${quiet}/60)`);
}

// 22. Motions shorter than the frame tests (1, 2 and 5 frames) cannot hang the
//     leader: the fight keeps moving through its states.
for (const n of [1, 2, 5]) {
  for (const cursor of [0, DRAGON_CURSOR_B]) {
    const ai = brain({ frames: () => n });
    ai.cursor = cursor;
    const t = player(0, 120, 60);
    const r = run(ai, [t], 30 * 60 * 20, () => false);
    check(r.states.length > 20, `${n}-frame motions, cursor ${cursor}: the fight moves on (${r.states.length} states)`);
    check(r.longest <= 2600, `${n}-frame motions, cursor ${cursor}: no state outlasts the watchdog (${r.longest})`);
  }
}

// 23. Floor 11's entry list holds exactly one Dragon entry (set type 0xC0), so
//     one brain; a stale enterFloor (overtaken by a floor change) is dropped by
//     render/combat.ts's enterToken, which is what once gave a Pioneer 2 NPC
//     entry (same set index 0) the Dragon's model and a second brain.
{
  const { existsSync, readFileSync } = await import('node:fs');
  const { parseEnemySets } = await import('../client/src/formats/setdata.ts');
  const { expandEnemySets } = await import('../client/src/formats/enemyslots.ts');
  const file = '/Users/junior/Downloads/psobb-master/tethealla/map/map_boss01e.dat';
  const src = existsSync(file) ? file : new URL('../vendor/newserv/system/maps/xb-v3/map_boss01e.dat', import.meta.url).pathname;
  if (existsSync(src)) {
    const slots = expandEnemySets(parseEnemySets(new Uint8Array(readFileSync(src))), 11);
    eq(slots.length, 1, 'floor 11 has one enemy slot');
    eq(slots[0].type, 'DRAGON', 'and it is the Dragon');
    eq(slots[0].set.type, 0xc0, 'set type 0xC0');
  }
}

// 24. The hit boxes: the body's seven spheres and the tail object's 17.
{
  eq(DRAGON_BODY_BOXES.radii.join(), '10,10,10,15,15,10,10', 'the body boxes\' radii (0x00425212..0x0042524e)');
  eq(DRAGON_BODY_BOXES.reach, Math.max(...DRAGON_BODY_BOXES.radii), 'the body reach is its biggest box');
  eq(DRAGON_NODE_TABLE.length, 34, 'the node table 0x008fb900 has 34 slots');
  eq(DRAGON_NODE_TABLE.slice(15, 32).join(), '72,74,76,79,80,81,82,83,84,85,88,89,90,91,92,93,94', 'the tail boxes follow slots 15..31');
  eq(DRAGON_TAIL.count, 17, 'seventeen tail boxes');
  eq(DRAGON_TAIL.radius, 10, 'of radius 10');
  eq(DRAGON_TAIL.attackRow, 1, 'attack row 20 (the second of 18, 20, 21, 22, 23)');

  // recordNodes: slots below 18 always, the others only with flag 0x200; high
  // from 30 above the body.
  const ai = brain();
  const asked: number[] = [];
  const at = (y: number) => (node: number, out: [number, number, number]) => {
    asked.push(node);
    out[0] = node;
    out[1] = y;
    out[2] = -node;
    return true;
  };
  ai.flags = 0;
  ai.recordNodes(at(40), 5);
  eq(asked.join(), '72,74,76', 'without 0x200 only the first three tail nodes are read');
  check(ai.tailBoxes[0].x === 72 && ai.tailBoxes[0].z === -72, 'and placed at their world position');
  check(!ai.tailBoxes[0].low, '35 above the body is high');
  check(ai.tailBoxes[3].x === 0 && ai.tailBoxes[3].z === 0, 'the unrecorded boxes keep the ctor position');
  asked.length = 0;
  ai.flags = 0x200;
  ai.recordNodes(at(34), 5);
  eq(asked.length, 17, 'with 0x200 all 17 are read');
  check(ai.tailBoxes[16].x === 94 && ai.tailBoxes[16].low, '29 above the body is low');
  ai.recordNodes(at(35), 5);
  check(!ai.tailBoxes[16].low, 'exactly 30 above is high (30.0 <= y)');

  // The swipe: from the second tick, once per player until the list resets at
  // the frame 10 and frame 23 crossings (motion 18 has 26 frames at 0.5).
  const sw = brain({ leader: () => false });
  sw.applyRemote(S.tail, DRAGON_CURSOR_B, null, 0, 0);
  eq(sw.sid, S.tail, 'a follower in the tail swipe');
  eq(sw.wantsNodes, true, 'the swipe wants the nodes');
  const victim = player(1, 100, -100);
  const far = player(2, 400, 400);
  const place = (b: { x: number; y: number; z: number }) => (node: number, out: [number, number, number]) => {
    out[0] = b.x + (node - 72) * 0.0001;
    out[1] = b.y;
    out[2] = b.z;
    return true;
  };
  let hits: { t: number; id: number }[] = [];
  let tick = 0;
  for (; tick < 70 && sw.sid === S.tail; tick++) {
    // Every box 3 above the body at the victim's feet.
    sw.flags = 0x200;
    sw.recordNodes(place({ x: 100, y: 3, z: -100 }), 0);
    const f = sw.tick([victim, far]);
    for (const s of f.shots ?? []) {
      const b = s as DragonBurst;
      const e = b.effect;
      if (e.kind === 'melee') {
        check(e.attack === 1 && e.knockback === 3, 'the swipe hits with row 20 and knockback 3');
        hits.push({ t: tick, id: b.peek([victim, far]).map((x) => x.clientId)[0] ?? -1 });
      }
    }
  }
  eq(hits.length, 3, 'a player in the swipe is struck three times (entry, frame 10, frame 23)');
  check(hits.every((h) => h.id === 1), 'and only the one in reach');
  check(hits[0].t === 1, 'the first strike is on the second tick');
  check(hits[1].t - hits[0].t > 15 && hits[2].t - hits[1].t > 15, 'the others come after the crossings (ticks ' + hits.map((h) => h.t).join(',') + ')');
  // High boxes strike nobody.
  const hi = brain({ leader: () => false });
  hi.applyRemote(S.tail, DRAGON_CURSOR_B, null, 0, 0);
  let n = 0;
  for (let i = 0; i < 60 && hi.sid === S.tail; i++) {
    hi.flags = 0x200;
    hi.recordNodes(place({ x: 100, y: 120, z: -100 }), 0);
    n += (hi.tick([victim]).shots ?? []).length;
  }
  eq(n, 0, 'a raised tail strikes no one');
  hits = [];

  // The real model (needs the client data): nodes 72..94 are the tail and the
  // swipe brings it near the ground at frames 3 and 15, up at frame 9.
  const { existsSync, readFileSync } = await import('node:fs');
  const dir = `${process.env.HOME}/Downloads/psobb-client/data`;
  if (existsSync(`${dir}/data.gsl`)) {
    const { GSLArchive } = await import('../client/src/formats/archives.ts');
    const { buildEnemy, EnemyArchive } = await import('../client/src/render/enemymodel.ts');
    const gsl = new GSLArchive(new Uint8Array(readFileSync(`${dir}/data.gsl`)));
    if (gsl.has('bm_boss1_dragon.bml')) {
      const arch = new EnemyArchive('bm_boss1_dragon.bml', gsl.get('bm_boss1_dragon.bml'), 2);
      const built = buildEnemy(arch, [{ model: 0, motion: { index: DRAGON_SLOTS[7].motion, speed: 1, loop: true }, scale: 2 }], 0, new Map(), new Map());
      const nodes = built.partNodes[0];
      check(nodes.length > DRAGON_NODE_TABLE[33], `the model has the ${DRAGON_NODE_TABLE[33] + 1}+ nodes the table indexes (${nodes.length})`);
      const rec = brain();
      rec.flags = 0x200;
      const lows = (frame: number): number => {
        built.animators[0].setFrame(frame);
        built.root.updateMatrixWorld(true);
        rec.recordNodes((node, out) => {
          const m = nodes[node]?.matrixWorld.elements;
          if (!m) return false;
          out[0] = m[12];
          out[1] = m[13];
          out[2] = m[14];
          return true;
        }, 0);
        return rec.tailBoxes.filter((b) => b.low).length;
      };
      check(lows(3) >= 10, `frame 3 of the swipe: most of the tail is low (${lows(3)})`);
      eq(lows(9), 0, 'frame 9: the tail is raised');
      check(lows(15) >= 10, `frame 15: low again (${lows(15)})`);
      const tip = rec.tailBoxes[16];
      check(Math.abs(tip.z) > 200, `the tail tip is more than 200 behind the body (${tip.z.toFixed(0)})`);
    }
  }
}

// 25. The mouth and the feet are model nodes: the stomp strikes the recorded
//     pair (50 and 51 at frame 3, 40 and 41 at frame 24), the flame starts at
//     the recorded mouth (node 60), and each flame emits its particles.
{
  eq(DRAGON_MOUTH.node, 60, 'the mouth is node 60 (the draw tracker 0x3c)');
  eq(DRAGON_MOUTH.forward, 5, 'the point (0, 0, 5) in its space');
  eq(footNodes(1).join(), '50,51', 'side +1 (frame 3) strikes nodes 50 and 51');
  eq(footNodes(-1).join(), '40,41', 'side -1 (frame 24) strikes nodes 40 and 41');
  eq(DRAGON_NODE_TABLE.indexOf(40), 3, 'node 40 is table slot 3');
  eq(DRAGON_NODE_TABLE.indexOf(51), 6, 'node 51 is table slot 6');
  eq(DRAGON_SE.breath, 0x321, 'the breath sound 0x321');
  eq(DRAGON_SE.breathAfterFrames, 30, 'and 30 frames after the breath');
  eq(DRAGON_SE.fireball, 0x31f, 'the fireball sound 0x31f');

  const feet = brain();
  const at = (n: number, out: [number, number, number]) => {
    out[0] = n;
    out[1] = 5;
    out[2] = -n;
    return true;
  };
  eq(feet.footPlaces(1).length, 1, 'without the model: one ASSUMED foot');
  feet.recordFeet(at);
  eq(JSON.stringify(feet.footPlaces(1)), '[[50,-50],[51,-51]]', 'side +1: the recorded nodes 50 and 51');
  eq(JSON.stringify(feet.footPlaces(-1)), '[[40,-40],[41,-41]]', 'side -1: the recorded nodes 40 and 41');
  feet.recordFeet((n, out) => n !== 51 && at(n, out));
  eq(feet.footPlaces(1).length, 1, 'a model without node 51: the ASSUMED foot');
  eq(feet.footPlaces(-1).length, 2, 'the other pair is still recorded');

  const m = brain();
  const guess = m.mouth().join();
  m.recordMouth([1, 2, 3]);
  eq(m.mouth().join(), '1,2,3', 'the flame starts at the recorded mouth');
  m.recordMouth(null);
  eq(m.mouth().join(), guess, 'without node 60: the ASSUMED mouth');

  // The fire's sounds: one 0x31f per fireball (its constructor), 0x321 every
  // frame of the breath and of the 30 frames after it (flames are every other
  // frame, so the breath sound outnumbers them).
  const b = brain();
  const br = run(b, [player(0, 0, 200)], 4000, () => false);
  const flames = br.shots.filter((s) => s instanceof DragonFlame).length;
  const fireballs = br.shots.filter((s) => s instanceof DragonFireball).length;
  const se = (id: number) => br.events.filter((e) => e.kind === 'se' && e.id === id).length;
  check(flames > 0, `the breath makes flames (${flames})`);
  check(fireballs > 0, `the breath's fight makes fireballs (${fireballs})`);
  eq(se(0x31f), fireballs, 'one fireball sound per fireball');
  check(se(0x321) > flames, `the breath sound plays every frame (${se(0x321)} for ${flames} flames)`);
}

// 26. The particle ids (the two tables of 0x008fbeec / 0x008fbf0c and the fire
//     tables of 0x008fc374 / 0x008fc380) are the ones the sites read; the ids
//     from 0x200 are the map's particleentrya%d.dat entries; the stomp and the
//     fireball trail make their particles at the foot and the flying fireball.
{
  const N = DRAGON_PARTICLE_IDS.normal;
  const U = DRAGON_PARTICLE_IDS.ultimate;
  eq(N.f00, 65, 'normal +0x00 (0x0041ebf0, the 0x840 flag site)');
  eq(N.f04, 76, 'normal +0x04 (0x0041c784)');
  eq(N.body, 0x223, 'normal +0x08 (the body)');
  eq(N.stomp, 240, 'normal +0x0c (the stomps)');
  eq(N.mouth, 0x222, 'normal +0x18 (the flame mouth, 0x00421b2c)');
  eq(N.launch, 0x225, 'normal +0x1c (the fireball launch, 0x004218eb)');
  eq(U.f00, 0x200, 'Ultimate +0x00');
  eq(U.f04, 0x201, 'Ultimate +0x04');
  eq(U.body, 0x202, 'Ultimate +0x08');
  eq(U.stomp, 148, 'Ultimate +0x0c');
  eq(U.mouth, 0x20b, 'Ultimate +0x18');
  eq(U.launch, 0x209, 'Ultimate +0x1c');
  eq(DRAGON_FIRE_IDS.normal.f00, 548, 'the normal fire table +0x00');
  eq(DRAGON_FIRE_IDS.normal.f04, 550, 'the normal fire table +0x04');
  eq(DRAGON_FIRE_IDS.normal.f08, 553, 'the normal fire table +0x08 (the puff)');
  eq(DRAGON_FIRE_IDS.ultimate.f00, 522, 'the Ultimate fire table +0x00');
  eq(DRAGON_FIRE_IDS.ultimate.f04, 520, 'the Ultimate fire table +0x04');
  eq(DRAGON_FIRE_IDS.ultimate.f08, 201, 'the Ultimate fire table +0x08 (particleentry.dat 0xc9)');
  const inMap = (id: number) => id >= MAP_PARTICLE_FIRST && id < MAP_PARTICLE_FIRST + MAP_PARTICLE_COUNT;
  eq(inMap(N.body) && inMap(N.mouth) && inMap(N.launch) && inMap(DRAGON_FIRE_IDS.normal.f08), true, 'the normal map ids are in the map table range');
  eq(inMap(U.f00) && inMap(U.f04) && inMap(U.body) && inMap(U.mouth) && inMap(U.launch), true, 'the Ultimate map ids are in the map table range');
  eq(inMap(N.stomp) || inMap(N.f00) || inMap(N.f04), false, 'the normal ids below 0x200 are particleentry.dat entries');
  eq(particleMapFile(11), 'particleentrya11.dat', 'the Dragon floor (area 0x0b) reads particleentrya11.dat');
  eq(particleMapFile(3), 'particleentrya03.dat', 'maps 0..9 use the 0-padded name');

  // The fireball's particles (0x00426790): the flight +0x00 each flying frame
  // and on the arrival frame; the impact (counter 1) +0x04 and +0x08 with the
  // hit; counter 2 one more +0x08; then done. The hit is on the impact frame only.
  const fl = new DragonFireball([0, 0, 0], [0, 0, 60], 1000, DRAGON_FIRE_IDS.normal);
  check(fl.flying, 'a new fireball is flying');
  const per: number[][] = [];
  const hitAt: number[] = [];
  for (let k = 0; k < 8 && !fl.done; k++) {
    const hits = fl.tick([player(1, 0, 60)]);
    if (hits.length) hitAt.push(k + 1);
    per.push(fl.drainParticles());
  }
  eq(per.map((p) => p.join('+')).join(' | '), '548 | 548 | 548 | 550+553 | 553', 'the normal fireball: flight x3, impact, puff');
  eq(hitAt.join(), '4', 'the hit is the impact frame (the fourth tick)');
  check(fl.done && !fl.flying, 'after counter 2 it is done');
  const fu = new DragonFireball([0, 0, 0], [0, 0, 60], 1000, DRAGON_FIRE_IDS.ultimate);
  const useq: string[] = [];
  for (let k = 0; k < 4; k++) {
    fu.tick([]);
    useq.push(fu.drainParticles().join('+'));
  }
  eq(useq.join(' | '), '522 | 522 | 522 | 520+201', 'the Ultimate fireball: flight 522, impact +0x04 520 and +0x08 201');

  // The fights: every fireball carries its difficulty's trail; the stomps
  // make one particle per foot, with the stomp id.
  const normal = run(brain(), [player(0, 0, 200)], 4000, () => false);
  const fbN = normal.shots.filter((s) => s instanceof DragonFireball) as DragonFireball[];
  check(fbN.length > 0, `the normal fight makes fireballs (${fbN.length})`);
  check(fbN.every((s) => s.ids === DRAGON_FIRE_IDS.normal), 'every normal fireball carries the normal fire table');
  const parts = normal.events.filter((e) => e.kind === 'particle');
  const stomps = parts.filter((e) => e.kind === 'particle' && e.id === N.stomp);
  check(stomps.length > 0, `the normal fight makes stomp particles (${stomps.length})`);
  check(stomps.every((e) => e.kind === 'particle' && e.y === 0), 'every stomp particle is on the ground');
  const known = new Set<number>([N.f04, N.body, N.stomp, N.launch]);
  check(parts.every((e) => e.kind === 'particle' && known.has(e.id)), 'every normal particle event is a wired id of its sites');
  // One particle per place of the stomp: the recorded pair (nodes 50 and 51),
  // or the one foot the fallback places in front of the body.
  const feet = brain();
  feet.recordFeet((n, out) => {
    out[0] = n;
    out[1] = 0;
    out[2] = 10;
    return n === 50 || n === 51;
  });
  (feet as unknown as { footStrike(side: number): void }).footStrike(1);
  const pair = feet.events.filter((e) => e.kind === 'particle');
  eq(pair.length, 2, 'a stomp on the recorded pair makes two particles');
  check(pair.every((e) => e.kind === 'particle' && e.id === N.stomp), 'both are the normal stomp id');
  eq(pair.map((e) => (e.kind === 'particle' ? e.x : -1)).join(), '50,51', 'at the two recorded feet');
  const lone = brain();
  (lone as unknown as { footStrike(side: number): void }).footStrike(-1);
  eq(lone.events.filter((e) => e.kind === 'particle').length, 1, 'without the feet, one particle at the fallback foot');

  const ult = run(brain({ ultimate: true, movement: ROW_ULTIMATE, hp: 16500 }), [player(0, 0, 200)], 4000, () => false);
  const fbU = ult.shots.filter((s) => s instanceof DragonFireball) as DragonFireball[];
  check(fbU.length > 0, `the Ultimate fight makes fireballs (${fbU.length})`);
  check(fbU.every((s) => s.ids === DRAGON_FIRE_IDS.ultimate), 'every Ultimate fireball carries the Ultimate fire table');
  const uStomps = ult.events.filter((e) => e.kind === 'particle' && e.id === U.stomp);
  check(uStomps.length > 0 && uStomps.every((e) => e.kind === 'particle' && e.id === U.stomp), 'the Ultimate stomps use the Ultimate stomp id 148');
  const uKnown = new Set<number>([U.f04, U.body, U.stomp, U.launch]);
  check(
    ult.events.filter((e) => e.kind === 'particle').every((e) => e.kind === 'particle' && uKnown.has(e.id)),
    'every Ultimate particle event is a wired id of its sites',
  );
}

// 27. The particle sites read in the exe, each with its state, frame and id,
//     in both difficulties: the land (the take-off at frame 11, the stomp's
//     body particle on the 4th tick on the ground), the lift (frame 46), the
//     hover roar (frame 14), and the volley's launch flash at the mouth.
{
  // The events of one frame of the brain in state s, with its motion at frame f
  // (the frame's animate adds the speed, 1): the particle events only.
  const oneFrame = (s: number, f: number, ultimate: boolean, setup: (a: DragonAi) => void = () => {}) => {
    const ai = brain({ ultimate });
    const p = ai as unknown as { setState(n: number): void; frameState(): void; speed: number };
    p.setState(s);
    setup(ai);
    ai.mframe = f;
    p.speed = 1;
    ai.events.splice(0);
    p.frameState();
    return ai.events.splice(0).filter((e) => e.kind === 'particle');
  };
  const N = DRAGON_PARTICLE_IDS.normal;
  const U = DRAGON_PARTICLE_IDS.ultimate;

  // The land (0x00420ee8, phase 0; states 0x08, 0x0a, 0x0b, 0x0c): frame 11, the take-off (+0x04) at the body.
  for (const s of [S.land, S.landCollapse, S.landRoar, S.landDie]) {
    const n = oneFrame(s, 10, false);
    eq(n.length, 1, `state 0x${s.toString(16)} frame 11 makes one particle`);
    check(n.every((e) => e.kind === 'particle' && e.id === N.f04), `state 0x${s.toString(16)} frame 11 is the take-off id 76`);
    const u = oneFrame(s, 10, true);
    check(u.length === 1 && u[0].kind === 'particle' && u[0].id === U.f04, `state 0x${s.toString(16)} Ultimate frame 11 is id 513`);
    eq(oneFrame(s, 9, false).length, 0, `state 0x${s.toString(16)} frame 10 makes none`);
  }
  // The land's stomp (0x004213b5): the 4th tick with the land's counter on the ground makes the body's +0x08.
  const ground = (a: DragonAi) => {
    const p = a as unknown as { c86c: number; c870: number };
    p.c86c = 2;
    p.c870 = 3;
  };
  const stompN = oneFrame(S.land, 0, false, ground);
  check(stompN.length === 1 && stompN[0].kind === 'particle' && stompN[0].id === N.body, 'the land stomp makes the body particle 547 on the 4th tick');
  check(stompN.length === 1 && stompN[0].kind === 'particle' && stompN[0].x === 0 && stompN[0].z === 0, 'the land stomp is at the body');
  const stompU = oneFrame(S.land, 0, true, ground);
  check(stompU.length === 1 && stompU[0].kind === 'particle' && stompU[0].id === U.body, 'the Ultimate land stomp makes the body particle 514');
  eq(oneFrame(S.land, 0, false, (a) => ((a as unknown as { c86c: number; c870: number }).c86c = 2)).length, 0, 'the first ground tick makes none');

  // The lift (0x00422430 phase 0): frame 46 makes the body's +0x04 (76 / 513).
  const liftN = oneFrame(S.flyUp, 45, false);
  check(liftN.length === 1 && liftN[0].kind === 'particle' && liftN[0].id === N.f04, 'the lift makes the take-off id 76 at frame 46');
  const liftU = oneFrame(S.flyUp, 45, true);
  check(liftU.length === 1 && liftU[0].kind === 'particle' && liftU[0].id === U.f04, 'the Ultimate lift makes id 513 at frame 46');
  eq(oneFrame(S.flyUp, 44, false).length, 0, 'the lift makes nothing at frame 45');

  // The hover roar (0x0042008c, state 0x0e): frame 14 makes the take-off (+0x04).
  const hoverN = oneFrame(S.roarAir, 13, false);
  check(hoverN.length === 1 && hoverN[0].kind === 'particle' && hoverN[0].id === N.f04, 'the hover roar makes the take-off id 76 at frame 14');
  check(oneFrame(S.roarAir, 13, true).every((e) => e.kind === 'particle' && e.id === U.f04), 'the Ultimate hover roar makes id 513');

  // The volley (0x00421494 phase 2 at frame 47): one launch flash (+0x1c) at the mouth per fireball.
  const vb = brain();
  const vp = vb as unknown as { setState(n: number): void; volley(): void };
  vp.setState(S.flyShoot);
  Object.assign(vb, { velX: 100, velZ: 0 });
  vb.events.splice(0);
  vp.volley();
  const launches = vb.events.filter((e) => e.kind === 'particle');
  eq(launches.length, 3, 'a volley makes three launch flashes');
  const m = vb.mouth();
  check(
    launches.every((e) => e.kind === 'particle' && e.id === N.launch && e.x === m[0] && e.y === m[1] && e.z === m[2]),
    'every launch flash is id 549 at the mouth',
  );
  const vu = brain({ ultimate: true });
  const vup = vu as unknown as { setState(n: number): void; volley(): void };
  vup.setState(S.flyShoot);
  Object.assign(vu, { velX: 100, velZ: 0 });
  vu.events.splice(0);
  vup.volley();
  check(
    vu.events.filter((e) => e.kind === 'particle').every((e) => e.kind === 'particle' && e.id === U.launch),
    'the Ultimate launch flash is id 521',
  );
}

// 28. The particle sites resolved from the exe (DEVLOG "Dragon particles: the
//     unresolved sites"): the flame's emitter (flyShoot sub-state 2), the
//     flyShoot take-offs (sub-states 1 and 2), the collapse's two dust rings,
//     the death's two body particles and the emerge's helper particle.
{
  // The brain at the origin, facing yaw 0 (sin 0, cos 1): the points below are
  // plain offsets from (x, z).
  const at = (ultimate: boolean, s: number, setup: (a: DragonAi) => void = () => {}) => {
    const ai = brain({ ultimate });
    const p = ai as unknown as { setState(n: number): void };
    p.setState(s);
    Object.assign(ai, { x: 10, z: 20, yaw: 0, alt: 0 });
    setup(ai);
    return ai;
  };
  // One frame at motion frame f (the frame's animate adds the speed, 1).
  const frame = (ai: DragonAi, f: number) => {
    const p = ai as unknown as { frameState(): void; speed: number };
    ai.mframe = f;
    p.speed = 1;
    ai.events.splice(0);
    p.frameState();
    return ai.events.splice(0);
  };
  const N = DRAGON_PARTICLE_IDS.normal;
  const U = DRAGON_PARTICLE_IDS.ultimate;
  const parts = (evs: DragonEvent[]) => evs.filter((e): e is Extract<DragonEvent, { kind: 'particle' }> => e.kind === 'particle');
  const emitters = (evs: DragonEvent[]) => evs.filter((e): e is Extract<DragonEvent, { kind: 'emitter' }> => e.kind === 'emitter');
  // flyShoot in sub-state `sub` with the motion the brain runs after the turn
  // (slot 18, the flyshot motion: 80 frames, so the frames 14 .. 53 do not clamp).
  const flyShot = (a: DragonAi, sub: number) => {
    (a as unknown as { setSlot(n: number): void }).setSlot(18);
    a.c86c = sub;
  };

  // The collapse (0x004203cc phase 0): frame 14 the outer ring, frame 18 the
  // inner, both on the ground at the stomp id (+0x0c); frame 7 makes no dust.
  for (const ultimate of [false, true]) {
    const ids = ultimate ? U : N;
    const outer = parts(frame(at(ultimate, S.collapse, (a) => (a.c870 = 0)), 13));
    eq(outer.length, 1, `collapse frame 14 (${ultimate ? 'Ultimate' : 'normal'}): one particle`);
    check(outer.every((e) => e.id === ids.stomp && e.x === 10 - 4 && e.y === 0 && e.z === 20 - 100), 'the outer ring is the stomp id at (x - 4, 0, z - 100) with yaw 0');
    const inner = parts(frame(at(ultimate, S.collapse, (a) => (a.c870 = 0)), 17));
    eq(inner.length, 1, `collapse frame 18 (${ultimate ? 'Ultimate' : 'normal'}): one particle`);
    check(inner.every((e) => e.id === ids.stomp && e.x === 10 - 4 && e.y === 0 && e.z === 20 + 75), 'the inner ring is at (x - 4, 0, z + 75) with yaw 0');
    // Frame 7 (the battle params) crosses in the same tick as 14 and 18: no dust at all.
    const ai = at(ultimate, S.collapse, (a) => (a.c870 = 0));
    const p = ai as unknown as { frameState(): void; speed: number };
    ai.mframe = 6;
    p.speed = 20;
    ai.events.splice(0);
    p.frameState();
    eq(parts(ai.events.splice(0)).length, 0, `collapse crossing 7 and 14 and 18 in one tick: no ring (${ultimate ? 'Ultimate' : 'normal'})`);
  }

  // The death (0x0041db28, phase 0): frame 57 and frame 88 each make one body
  // particle (+0x08) at the two area-hit points: (-35, 10) and (-60, -20).
  for (const ultimate of [false, true]) {
    const body = ultimate ? U.body : N.body;
    const d1 = parts(frame(at(ultimate, S.death, (a) => (a.c86c = 0)), 56));
    eq(d1.length, 1, `death frame 57 (${ultimate ? 'Ultimate' : 'normal'}): one particle`);
    check(d1.every((e) => e.id === body && e.x === 10 - 35 && e.y === 0 && e.z === 20 + 10), 'the death particle at frame 57 is the body id at (x - 35, z + 10)');
    const d2 = parts(frame(at(ultimate, S.death, (a) => (a.c86c = 0)), 87));
    eq(d2.length, 1, `death frame 88 (${ultimate ? 'Ultimate' : 'normal'}): one particle`);
    check(d2.every((e) => e.id === body && e.x === 10 - 60 && e.z === 20 - 20), 'the death particle at frame 88 is at (x - 60, z - 20)');
  }

  // The emerge (0x0041e966, sub 1 -> 2, the body above the ground): the helper's
  // particle (table +0x00) at the body, raised 0.05 a call for the first 12 calls.
  {
    const ai = at(false, S.emerge, (a) => {
      a.c86c = 1;
      a.alt = 5;
    });
    const first = parts(frame(ai, 0));
    eq(first.length, 1, 'emerge: the sub 1 -> 2 step makes one particle');
    check(first.every((e) => e.id === N.f00 && e.x === 10 && e.y === 5 && e.z === 20), 'the emerge particle is id 65 at the body');
    const again = at(false, S.emerge, (a) => {
      a.c86c = 1;
      a.alt = 5;
      a.riseCount = 1;
    });
    const second = parts(frame(again, 0));
    check(second.length === 1 && near(second[0].y, 5.05), 'the second helper call raises the point 0.05');
    const u = at(true, S.emerge, (a) => {
      a.c86c = 1;
      a.alt = 5;
    });
    const ue = parts(frame(u, 0));
    check(ue.length === 1 && ue[0].id === U.f00, 'the Ultimate emerge particle is id 512');
  }

  // flyShoot's take-off (0x0042197a in sub-state 1, 0x0042162e in sub-state 2): frame 14
  // makes the body's +0x04 particle; sub-state 2 also at frame 53.
  for (const sub of [1, 2]) {
    const t = parts(frame(at(false, S.flyShoot, (a) => flyShot(a, sub)), 13));
    check(t.length >= 1 && t.some((e) => e.id === N.f04 && e.x === 10 && e.z === 20), `flyShoot sub ${sub} frame 14: the take-off id 76 at the body`);
  }
  {
    const t = parts(frame(at(true, S.flyShoot, (a) => flyShot(a, 2)), 52));
    check(t.some((e) => e.id === U.f04), 'flyShoot sub 2 frame 53: the take-off id 513 (Ultimate)');
  }

  // The flame's emitter (0x00421b2c, sub-state 2): made at frame 20 with the mouth
  // id (+0x18), followed while the frame is at or under 40, stopped above 40 and
  // made again at 42 (the exe has no other test).
  {
    const ai = at(false, S.flyShoot, (a) => flyShot(a, 2));
    eq(emitters(frame(ai, 18)).length, 0, 'the flame has no emitter before frame 20');
    const made = emitters(frame(ai, 19));
    eq(made.length, 1, 'the flame is made at frame 20');
    check(made.length === 1 && made[0].id === N.mouth, 'the flame emitter is id 546 (the table +0x18, normal)');
    const handle = made[0]?.handle;
    eq(handle?.alive, true, 'the emitter is alive');
    eq(emitters(frame(ai, 29)).length, 0, 'no second emitter while the handle lives');
    eq(handle?.alive, true, 'the emitter still lives at frame 31');
    // A frame's tick adds 1: frame(ai, 40) runs the motion at 41 (above 40, stopped).
    emitters(frame(ai, 40));
    eq(handle?.alive, false, 'the emitter stops above frame 40');
    const again = emitters(frame(ai, 41)); // frame 42: no handle, so it is made again
    eq(again.length, 1, 'the exe makes the flame again the frame after it stops');
  }
  {
    const ai = at(true, S.flyShoot, (a) => flyShot(a, 2));
    const made = emitters(frame(ai, 19));
    check(made.length === 1 && made[0].id === U.mouth, 'the Ultimate flame is id 523');
  }

  // The flame's emitter ends with the volley (ASSUMED): a volley at frame 48 stops it.
  {
    const ai = at(false, S.flyShoot, (a) => flyShot(a, 2));
    frame(ai, 19);
    const handle = (ai as unknown as { mouthEmitter: { alive: boolean } | null }).mouthEmitter;
    frame(ai, 46);
    eq(handle?.alive, false, 'the volley stops the flame');
  }
}

// 29. The dive's particle sites (DEVLOG "Dragon particles: the unresolved sites",
//     resolved in the next pass): the dive's impact calls the emerge / dive helper
//     (0x0041fa7b, gate alt <= 0 and the impact not yet done), the take-off in the
//     dive's turn (0x0041ff7a, frame 14) and flyShoot's aim (0x4221b0, frame 14).
{
  const at = (ultimate: boolean, s: number, setup: (a: DragonAi) => void = () => {}) => {
    const ai = brain({ ultimate });
    const p = ai as unknown as { setState(n: number): void };
    p.setState(s);
    Object.assign(ai, { x: 10, z: 20, yaw: 0, alt: 0 });
    setup(ai);
    return ai;
  };
  const frame = (ai: DragonAi, f: number) => {
    const p = ai as unknown as { frameState(): void; speed: number };
    ai.mframe = f;
    p.speed = 1;
    ai.events.splice(0);
    p.frameState();
    return ai.events.splice(0);
  };
  const parts = (evs: DragonEvent[]) => evs.filter((e): e is Extract<DragonEvent, { kind: 'particle' }> => e.kind === 'particle');
  const N = DRAGON_PARTICLE_IDS.normal;
  const U = DRAGON_PARTICLE_IDS.ultimate;

  // The dive's impact (0x0041fa7b): sub-state 3 at alt <= 0 with the impact not yet
  // done makes the helper's particle (id +0x00) at the body, once.
  for (const ultimate of [false, true]) {
    const ids = ultimate ? U : N;
    const impact = (alt: number, riseCount = 0, dug = false) =>
      at(ultimate, S.dive, (a) => {
        a.c86c = 3;
        a.alt = alt;
        a.f888 = 0;
        a.f890 = 0;
        a.f88c = 0;
        Object.assign(a, { dug, riseCount });
      });
    const hit = parts(frame(impact(-5), 0));
    eq(hit.length, 1, `dive impact at alt -5 (${ultimate ? 'Ultimate' : 'normal'}): one helper particle`);
    check(hit.every((e) => e.id === ids.f00 && e.x === 10 && e.z === 20), 'the impact particle is the helper id (table +0x00) at the body');
    const high = parts(frame(impact(5), 0));
    eq(high.length, 0, `dive above the ground (${ultimate ? 'Ultimate' : 'normal'}): no impact particle`);
    const done = parts(frame(impact(-5, 0, true), 0));
    eq(done.length, 0, `dive impact already done (${ultimate ? 'Ultimate' : 'normal'}): no second particle`);
  }
  {
    // The helper's counter is shared with the emerge: the impact's call is the 2nd, raised 0.05.
    const ai = at(false, S.dive, (a) => {
      a.c86c = 3;
      a.alt = -5;
      a.f888 = 0;
      a.f890 = 0;
      a.f88c = 0;
      Object.assign(a, { riseCount: 1 });
    });
    const raised = parts(frame(ai, 0));
    check(raised.length === 1 && near(raised[0].y, -5 + 0.05), 'the impact after one earlier call raises the point 0.05');
  }

  // The dive's turn (0x0041ff7a, sub-state 0): the take-off helper (id +0x04) at frame 14.
  {
    const t = parts(frame(at(false, S.dive, (a) => (a.c86c = 0)), 13));
    check(t.some((e) => e.id === N.f04 && e.x === 10 && e.z === 20), 'dive turn frame 14: the take-off id 76 at the body');
    const before = parts(frame(at(false, S.dive, (a) => (a.c86c = 0)), 11));
    check(!before.some((e) => e.id === N.f04), 'dive turn at frame 12: no take-off');
    const u = parts(frame(at(true, S.dive, (a) => (a.c86c = 0)), 13));
    check(u.some((e) => e.id === U.f04), 'Ultimate dive turn frame 14: the take-off id 513');
  }

  // flyShoot's aim (0x4221b0, sub-state 0): the take-off at frame 14 before the aim.
  {
    const t = parts(frame(at(false, S.flyShoot, (a) => (a.c86c = 0)), 13));
    check(t.some((e) => e.id === N.f04 && e.x === 10 && e.z === 20), 'flyShoot aim frame 14: the take-off id 76 at the body');
    const u = parts(frame(at(true, S.flyShoot, (a) => (a.c86c = 0)), 13));
    check(u.some((e) => e.id === U.f04), 'Ultimate flyShoot aim frame 14: the take-off id 513');
  }
}

// 30. The entrance (0x0041b220): +0x86c is the variant (1 normal, 2 Ultimate, from
//     0x00420a44) and +0x874 the step of its chain. The real bossop motion (170
//     frames at 0.5): each sound, particle and emitter at its motion frame, the BGM
//     at 105 (120 in Ultimate), the flame from 105 to 150 (120 to 155), and no hang.
{
  // Every event with the motion frame it came in on (the frame after the tick).
  // The ticks it took are in `ticks` (one tick is half a motion frame).
  const timeline = (ai: DragonAi) => {
    const out: { f: number; ev: DragonEvent }[] & { ticks?: number } = [];
    let t = 0;
    for (; t < 2000 && ai.sid === S.intro; t++) {
      ai.tick([player(0, 100, 0)]);
      for (const ev of ai.events.splice(0)) out.push({ f: ai.mframe, ev });
    }
    out.ticks = t;
    return out;
  };
  const se = (t: { f: number; ev: DragonEvent }[]) => t.flatMap((x) => (x.ev.kind === 'se' ? [{ f: x.f, id: x.ev.id }] : []));
  const parts = (t: { f: number; ev: DragonEvent }[]) => t.flatMap((x) => (x.ev.kind === 'particle' ? [{ f: x.f, id: x.ev.id, x: x.ev.x, y: x.ev.y, z: x.ev.z }] : []));
  const emits = (t: { f: number; ev: DragonEvent }[]) => t.flatMap((x) => (x.ev.kind === 'emitter' ? [{ f: x.f, id: x.ev.id, handle: x.ev.handle }] : []));
  const bgms = (t: { f: number; ev: DragonEvent }[]) => t.flatMap((x) => (x.ev.kind === 'bgm' ? [{ f: x.f, name: x.ev.name }] : []));

  // Normal.
  {
    const ai = brain({ ultimate: false });
    eq(ai.c86c, 1, 'the normal entrance is variant 1');
    const t = timeline(ai);
    const sounds = se(t);
    eq(sounds.map((x) => x.id).join(','), [0x318, 0x322, 0x31a].join(','), 'normal entrance: sounds 318, 322 (optional), 31a');
    check(sounds.length === 3 && sounds[0].f === 2.5 && sounds[1].f === 32.5 && sounds[2].f === 75.5, 'the normal sounds are at frames 2.5, 32.5 and 75.5');
    const p = parts(t);
    eq(p.map((x) => x.id).join(','), [547, 549, 549].join(','), 'normal entrance: body 547, then two launch flashes 549');
    check(p[0].f === 35.5 && p[0].x === 0 && p[0].y === 0 && p[0].z === 0, 'the body particle is at frame 35.5 on the body');
    check(p[1].f === 77.5 && p[2].f === 79.5, 'the launches are every 4th tick (frames 77.5 and 79.5) until frame 80');
    check(p.slice(1).every((x) => x.x === ai.mouth()[0] && x.y === ai.mouth()[1] && x.z === ai.mouth()[2]), 'the launches are at the mouth');
    const b = bgms(t);
    check(b.length === 1 && b[0].name === 'dradeath.adx' && b[0].f === 105.5, 'the BGM is at frame 105.5');
    const em = emits(t);
    eq(em.length, 1, 'normal entrance: one flame emitter');
    check(em.length === 1 && em[0].id === DRAGON_PARTICLE_IDS.normal.intro && em[0].f === 106, 'the flame is id 545 (the table +0x14), made at frame 106');
    eq(em[0]?.handle.alive, false, 'the flame is stopped at frame 150');
    check(ai.sid !== S.intro && (t.ticks ?? 0) >= 335 && (t.ticks ?? 0) < 360, `normal entrance ends with the motion (${t.ticks} ticks)`);
  }
  // Ultimate.
  {
    const ai = brain({ ultimate: true });
    eq(ai.c86c, 2, 'the Ultimate entrance is variant 2');
    const t = timeline(ai);
    const sounds = se(t);
    eq(sounds.map((x) => x.id).join(','), [0x318, 0x318, 0x322, 0x318, 0x31a].join(','), 'Ultimate entrance: sounds 318 (9, 40), 322 (62), 318 (64), 31a (92)');
    check(sounds.map((x) => x.f).join(',') === '9.5,40.5,62.5,64.5,92.5', 'the Ultimate sounds are at frames 9.5, 40.5, 62.5, 64.5 and 92.5');
    const p = parts(t);
    eq(p.map((x) => x.id).join(','), [514, 521, 521, 521].join(','), 'Ultimate entrance: body 514, then three launch flashes 521');
    check(p[0].f === 64.5 && p.slice(1).map((x) => x.f).join(',') === '94.5,96.5,98.5', 'the Ultimate body is at 64.5, the launches at 94.5, 96.5, 98.5');
    const b = bgms(t);
    check(b.length === 1 && b[0].f === 120.5, 'the Ultimate BGM is at frame 120.5');
    const em = emits(t);
    check(em.length === 1 && em[0].id === DRAGON_PARTICLE_IDS.ultimate.intro && em[0].f === 121, 'the Ultimate flame is id 524, made at frame 121');
    eq(em[0]?.handle.alive, false, 'the Ultimate flame is stopped at frame 155');
    check(ai.sid !== S.intro && (t.ticks ?? 0) >= 335 && (t.ticks ?? 0) < 360, `the Ultimate entrance ends with the motion (${t.ticks} ticks)`);
  }
  // The crossing rule: the frame that reaches the threshold (1.5 -> 2.0) does not
  // pass it; the next one (2.0 -> 2.5) does.
  {
    const ai = brain({ ultimate: false });
    const p = ai as unknown as { speed: number };
    ai.mframe = 1.5;
    p.speed = 0.5;
    ai.events.splice(0);
    ai.tick([player(0, 100, 0)]);
    eq(ai.events.filter((e) => e.kind === 'se').length, 0, 'the 2.0 frame does not pass 2');
    ai.tick([player(0, 100, 0)]);
    eq(ai.events.filter((e) => e.kind === 'se').length, 1, 'the 2.5 frame passes 2');
  }
  // Variant 3 (no selector in the entry, see introThree): its sites 547 and 515 at 63.5.
  {
    const ai = brain({ ultimate: false });
    ai.c86c = 3;
    ai.c874 = 0;
    const t = timeline(ai);
    const p = parts(t);
    check(p.some((x) => x.id === 547 && x.f === 63.5) && p.some((x) => x.id === 515 && x.f === 63.5), 'variant 3 at frame 63.5: body 547 and 515');
  }
}

// 31. Sids 0x19 (teleport) and 0x1a (fly move) are not reachable in the normal fight
//     (DEVLOG 2026-10-21 "Dragon: sids 0x19 and 0x1a are pad-only"). Their only writers
//     are the phase 2 / 0xb handlers, which run only under the pad pick (0x00423f74 gates
//     phase 2 on the pad flag 0x00a4377c, set by the quest opcode pad_dragon; phase 0xb
//     on the Dragon's +0x768, set by control_dragon). The leader's pick never yields them,
//     so the port has no state for them.
{
  let hit = false;
  for (const ultimate of [false, true]) {
    for (let c = 0; c < 0x40; c++) {
      const r = dragonNext(c, ultimate);
      if (r.state === 0x19 || r.state === 0x1a) hit = true;
    }
  }
  check(!hit, 'the leader pick (both tables, every cursor up to 0x3f) never yields sid 0x19 or 0x1a');
  const seqs = [DRAGON_SEQ_NORMAL_A, DRAGON_SEQ_NORMAL_B, DRAGON_SEQ_ULTIMATE_A, DRAGON_SEQ_ULTIMATE_B];
  check(seqs.every((s) => !s.includes(0x19) && !s.includes(0x1a)), 'no action sequence holds 0x19 or 0x1a');
  check(!Object.values(DRAGON_STATE).includes(0x19) && !Object.values(DRAGON_STATE).includes(0x1a), 'the port names no state 0x19 or 0x1a');
}

if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('dragon: ok');
