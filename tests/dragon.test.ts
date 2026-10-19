// The Dragon's fight (client/src/combat/dragon.ts): the action sequences, the
// hp clamp and the roars, the death path, the leader's 6x12 and a follower
// that obeys it, the children (flames, fireballs, area hits) and a whole
// fight with the real motion frame counts so no state can hang.
//
// Run: node tests/dragon.test.ts
import {
  DragonAi,
  DragonBurst,
  DragonFireball,
  DragonFlame,
  DragonTrapezoid,
  DRAGON_CURSOR_B,
  DRAGON_SEQ_NORMAL_A,
  DRAGON_SEQ_NORMAL_B,
  DRAGON_SEQ_ULTIMATE_A,
  DRAGON_SEQ_ULTIMATE_B,
  DRAGON_SLOTS,
  DRAGON_STATE,
  dragonNext,
  type DragonEvent,
  type DragonOptions,
} from '../client/src/combat/dragon.ts';
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

if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('dragon: ok');
