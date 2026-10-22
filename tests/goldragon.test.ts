// The Gol Dragon's fight (client/src/combat/goldragon.ts): the sequence cursor and
// its sentinels (0x21 reset, 0x22 jump to 0x32), the hit clamp and the roar, the
// death path with its kill, the 6xA8 codec and a follower that obeys it, the
// motion slots against the real frame counts of bm_boss8_dragon.bml (data.gsl),
// and a whole fight with those counts so no state can hang.
//
// Run: node tests/goldragon.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GoldDragonAi,
  GOL_BODY_BOXES,
  GOL_CURSOR_B,
  GOL_SEQ_A,
  GOL_SEQ_B,
  GOL_SEQ_C,
  GOL_SLOTS,
  GOL_STATE,
  GOL_A8_SIZE,
  decodeGolA8,
  encodeGolA8,
  golNext,
  type GolEvent,
  type GolOptions,
} from '../client/src/combat/goldragon.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import { BmlArchive } from '../client/src/formats/bml.ts';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { parseNjmFile } from '../client/src/formats/njmotion.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);

// A seeded generator so runs repeat.
function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// The motions' frame counts in bm_boss8_dragon.bml (motion index = archive order
// after the 3 models), read from data.gsl by the test below when the client data is
// there; the list is the same reading (dead 129 .. wing 27).
const REAL_FRAMES = [129, 169, 27, 14, 27, 14, 80, 80, 30, 27, 80, 52, 26, 39, 27, 27, 53, 27, 27, 44, 80, 30, 50, 44, 40, 27];
const realFrames = (m: number) => REAL_FRAMES[m] ?? 30;

const S = GOL_STATE;

function brain(over: Partial<GolOptions> = {}, leader = true): GoldDragonAi {
  return new GoldDragonAi({
    x: 0,
    z: 0,
    angle: 0,
    ultimate: false,
    movement: null,
    hp: 10000,
    leader: () => leader,
    frames: realFrames,
    playerHp: () => 300,
    rng: seeded(7),
    singleton: false, // start in wait so the tests drive the sequence themselves
    ...over,
  });
}

const player = (id: number, x: number, z: number, dead = false): AiTarget => ({ clientId: id, x, z, charClass: 0, dead });

// Ticks until `until` holds or `max` ticks pass; the events drained on the way.
function run(ai: GoldDragonAi, targets: AiTarget[], max: number, until: () => boolean = () => false): { ticks: number; events: GolEvent[]; states: number[] } {
  const events: GolEvent[] = [];
  const states: number[] = [];
  let last = ai.sid;
  states.push(last);
  let t = 0;
  for (; t < max && !until(); t++) {
    ai.tick(targets);
    for (const e of ai.drainEvents()) events.push(e);
    if (ai.sid !== last) {
      last = ai.sid;
      states.push(last);
    }
  }
  return { ticks: t, events, states };
}

// --- sequence -----------------------------------------------------------------

// Walks the first sequence from cursor 0: each pick yields the next table entry, the
// 0x21 sentinel restarts table A at 0 (the stored cursor is 0 + 1).
{
  let c = 0;
  const got: number[] = [];
  for (let i = 0; i < 12; i++) {
    const n = golNext(c);
    got.push(n.state);
    c = n.cursor;
  }
  eq(got.join(','), [3, 39, 40, 41, 42, 3, 5, 6, 35, 8, 3, 39].join(','), 'table A from cursor 0, with the 0x21 restart after its 10th entry');
  eq(golNext(10).state, 3, 'the sentinel at A[10] restarts at A[0]');
  eq(golNext(10).cursor, 1, 'the restart stores cursor 1 (base 0 + 1)');
}

// The 0x22 sentinel at the end of table B jumps to the second sequence's start (0x32).
{
  const last = GOL_CURSOR_B + GOL_SEQ_B.length - 1;
  eq(GOL_SEQ_B[GOL_SEQ_B.length - 1], 0x22, 'table B ends with the 0x22 sentinel');
  const n = golNext(last);
  eq(n.state, GOL_SEQ_B[0], 'the 0x22 jump reads element 0 of the table in use (exe)');
  eq(n.cursor, GOL_CURSOR_B + 1, 'the jump stores cursor 0x33');
  eq(golNext(GOL_CURSOR_B).state, 5, 'the second sequence starts at 5 (table B[0])');
  // Table A's 0x21 is the reset; B's and C's sentinels are the same two codes.
  check(GOL_SEQ_A.includes(0x21) && !GOL_SEQ_A.includes(0x22), 'table A holds the 0x21 reset only');
  check(GOL_SEQ_C.includes(0x21), 'table C (derived extras, unused) keeps its 0x21 sentinel');
}

// Every reachable pick from every cursor is a real state (no sentinel leaks out).
{
  let bad = 0;
  for (let c = 0; c < 0x40; c++) {
    const n = golNext(c);
    if (n.state === 0x21 || n.state === 0x22 || n.state > 0x2b) bad++;
  }
  eq(bad, 0, 'no pick from cursors 0..0x3f yields a sentinel or a sid above 0x2b');
}

// --- sids and motion slots ------------------------------------------------------

eq(GOL_SLOTS.length, 28, 'the motion table has 28 rows (exe 0x009abf60..0x009ac11f)');
eq(GOL_SLOTS[0].motion, 11, 'slot 0 is stand (archive motion 11)');
eq(GOL_SLOTS[19].motion, 0, 'slot 19 is dead (archive motion 0)');
eq(GOL_SLOTS[26].motion, 1, 'slot 26 is bossopgc, the entrance (archive motion 1)');
eq(GOL_SLOTS[16].mode, 1, 'slot 16 (fly) loops');
eq(GOL_SLOTS[8].next, 9, 'slot 8 (nkdown) goes on to slot 9 (down)');

// --- the motion archive (data.gsl) -----------------------------------------------

{
  const dir = process.env.PSOBB_DATA ?? join(process.env.HOME ?? '', 'Downloads/psobb-client/data');
  const file = join(dir, 'data.gsl');
  if (!existsSync(file)) console.log('skip: no data.gsl (the motion counts are the recorded ones)');
  else {
    const gsl = new GSLArchive(new Uint8Array(readFileSync(file)));
    const bml = new BmlArchive(gsl.get('bm_boss8_dragon.bml'));
    const motions = bml.entries.filter((e) => /\.njm$/i.test(e.name));
    eq(motions.length, REAL_FRAMES.length, 'bm_boss8_dragon.bml holds 26 motions');
    motions.forEach((e, i) => {
      const n = parseNjmFile(bml.get(e.name), 1).frameCount;
      eq(n, REAL_FRAMES[i], `motion ${i} (${e.name}) frame count`);
    });
    eq(motions[0].name.startsWith('dead_'), true, 'archive motion 0 is dead');
    eq(motions[11].name.startsWith('stand_'), true, 'archive motion 11 is stand');
  }
}

// --- hit boxes -------------------------------------------------------------------

eq(GOL_BODY_BOXES.radii.length, 7, 'seven body boxes (ctor 0x004cb480 loads 7)');
eq(GOL_BODY_BOXES.radii.join(','), [10, 10, 10, 15, 15, 10, 10].join(','), 'the radii of the static init 0x004cd532..0x004cd564');
eq(GOL_BODY_BOXES.reach, 15, 'the biggest box is 15');

// --- the 6xA8 codec -----------------------------------------------------------------

{
  const b = encodeGolA8({ entity: 0x1005, state: 0x0d, cursor: 0x33, target: 2, x: 12.5, z: -7.25, variant: 2 });
  eq(b.length, GOL_A8_SIZE, '6xA8 is 24 bytes');
  eq(b[0], 0xa8, 'subcommand 0xa8');
  eq(b[1], 6, 'size word 6 (24 bytes)');
  eq(b[2] | (b[3] << 8), 0x1005, 'entity id at [2..3]');
  eq(b[4] | (b[5] << 8), 0x0d, 'state at [4..5]');
  eq(b[6] | (b[7] << 8), 0x33, 'cursor at [6..7]');
  eq(b[8] | (b[9] << 8), 2, 'target at [8..9]');
  eq(b[0x14], 2, 'variant byte at [0x14]');
  const d = decodeGolA8(b);
  eq(d?.entity, 0x1005, 'decode: entity');
  eq(d?.state, 0x0d, 'decode: state');
  eq(d?.cursor, 0x33, 'decode: cursor');
  eq(d?.target, 2, 'decode: target');
  check(d !== null && Math.abs(d.x - 12.5) < 1e-6 && Math.abs(d.z + 7.25) < 1e-6, 'decode: x / z');
  const none = decodeGolA8(encodeGolA8({ entity: 0x1000, state: 0, cursor: 0, target: null, x: 0, z: 0, variant: 0 }));
  eq(none?.target, null, 'a null target is 0xffff on the wire and decodes to null');
  eq(decodeGolA8(new Uint8Array(10)), null, 'a short body is rejected');
  const bad = encodeGolA8({ entity: 1, state: 1, cursor: 1, target: null, x: 0, z: 0, variant: 0 });
  bad[0] = 0xa9;
  eq(decodeGolA8(bad), null, 'a wrong subcommand is rejected');
}

// --- the hit clamp and the roar --------------------------------------------------------

{
  // Below cursor 0x32 a hit cannot take hp under the clamp (+0x682 = 90 % of max, ASSUMED f).
  const ai = brain({ hp: 1000 });
  const clamp = ai.clamp;
  eq(clamp, 900, 'the clamp is 90 % of the maximum (ASSUMED f = 90)');
  ai.hit(400);
  ai.tick([]);
  eq(ai.hp, clamp, 'a hit below cursor 0x32 is clamped to the clamp');
}
{
  // From cursor 0x32 the clamp does not apply: the hp goes down to the death range.
  const ai = brain({ hp: 1000 });
  ai.cursor = GOL_CURSOR_B;
  ai.hit(950);
  ai.tick([]);
  check(ai.hp < ai.clamp, 'from cursor 0x32 a hit is not clamped');
}
{
  // The roar: hp at or under the clamp, cursor below 0x32: hp = clamp, cursor 0x32, state 0xd (landed).
  const ai = brain({ hp: 1000 });
  ai.hp = 850;
  ai.tick([]);
  const sends = ai.drainEvents().filter((e) => e.kind === 'send');
  eq(sends.length > 0 && sends[0].state, S.roar, 'the roar is sent as state 0x0d (landed)');
  eq(ai.hp, ai.clamp, 'the roar sets hp to the clamp');
  eq(ai.sid, S.roar, 'the body is in the roar');
  check(ai.cursor >= GOL_CURSOR_B, 'the roar moves the cursor to 0x32');
  const air = brain({ hp: 1000 });
  air.air = 1;
  air.hp = 850;
  air.tick([]);
  eq(air.drainEvents().find((e) => e.kind === 'send')?.state, S.landRoar, 'an airborne roar is 0x0b (lands, then roars)');
}
{
  // The roar does not fire again (its gate, flag 0x10, and the cursor 0x32 both stop it).
  const ai = brain({ hp: 1000 });
  ai.hp = 850;
  run(ai, [], 300, () => ai.sid === S.roar);
  const again = run(ai, [], 600, () => false);
  eq(again.events.filter((e) => e.kind === 'send' && e.state === S.roar).length, 0, 'no second roar');
}

// --- death and the kill ---------------------------------------------------------------

{
  const ai = brain({ hp: 1000 });
  ai.cursor = GOL_CURSOR_B;
  ai.hp = 0;
  ai.tick([]);
  const send = ai.drainEvents().find((e) => e.kind === 'send');
  eq(send?.state, S.death, 'hp < 1 from cursor 0x32: the death 0x15');
  const r = run(ai, [], 4000, () => ai.sid === S.children);
  const killed = r.events.filter((e) => e.kind === 'killed');
  eq(ai.sid, S.children, 'the death runs its gates and picks 0x17');
  eq(killed.length, 1, 'the kill runs once, when 0x15 is left');
  check(r.states.includes(S.death), 'the states pass 0x15');
}
{
  // An airborne death is 0xc (lands, then dies).
  const ai = brain({ hp: 1000 });
  ai.cursor = GOL_CURSOR_B;
  ai.air = 1;
  ai.hp = 0;
  ai.tick([]);
  eq(ai.drainEvents().find((e) => e.kind === 'send')?.state, S.landDie, 'an airborne death sends 0x0c');
}

// --- a state holds until its gates pass -----------------------------------------------

{
  // Walk (0x02) holds for its 300-tick gate: no pick before, one state change after.
  const ai = brain({ hp: 1000 });
  ai.cursor = 0;
  ai.setState(S.walk);
  let changedEarly = false;
  for (let i = 0; i < 299; i++) {
    ai.tick([]);
    if (ai.sid !== S.walk) changedEarly = true;
  }
  check(!changedEarly, 'walk holds for its 300 ticks');
  const after = run(ai, [], 5, () => ai.sid !== S.walk);
  check(ai.sid !== S.walk, 'walk ends after its gate');
  check(after.events.some((e) => e.kind === 'send'), 'the leader sends the next state when the gate passes');
}

// --- follower and remote packets ------------------------------------------------------

{
  const leader = brain({ hp: 1000 }, true);
  const follower = brain({ hp: 1000 }, false);
  // The leader's packet to a follower: the state, the cursor and the target.
  const ev = run(leader, [player(1, 40, 0)], 1400, () => leader.cursor > 3).events.find((e) => e.kind === 'send');
  check(ev !== undefined, 'the leader sends a state');
  if (ev?.kind === 'send') {
    const body = encodeGolA8({ entity: 0x1000, state: ev.state ?? 0, cursor: ev.cursor ?? 0, target: ev.target ?? null, x: ev.x ?? 0, z: ev.z ?? 0, variant: ev.variant ?? 0 });
    const m = decodeGolA8(body);
    if (m) follower.applyRemote(m.state, m.cursor, m.target, m.x, m.z);
    eq(follower.sid, ev.state, 'a follower takes the leader\'s state');
    eq(follower.cursor, ev.cursor, 'a follower takes the leader\'s cursor');
  }
  follower.applyRemote(S.walk, 5, 3, 10, 20);
  eq(follower.sid, S.walk, 'a remote packet changes the state');
  eq(follower.cursor, 5, 'a remote packet sets the cursor');
  eq(follower.targetId, 3, 'a remote packet sets the target');
  // A follower with no packet still ends its states (the stall guard takes the leader's step).
  const lonely = brain({ hp: 1000 }, false);
  const lr = run(lonely, [], 6000);
  check(lr.states.length > 2, 'a follower that hears nothing still changes state');
}

// --- a whole fight with the real frame counts ------------------------------------------

{
  // Leader fight: the hp is hit down over time, the roar and the death come, and every state
  // ends (no hang). A bounded run must see the sequence, the roar and the death.
  // The players hit every 5th tick (60 damage); the clamp holds the hp up until the
  // sequence has run, then the death comes. The run ends at the kill.
  const ai = brain({ hp: 3000 });
  const players = [player(1, 60, 0), player(2, -40, 50)];
  const events: GolEvent[] = [];
  const states: number[] = [ai.sid];
  let t = 0;
  for (; t < 60000 && !(ai.sid === S.children && events.some((e) => e.kind === 'killed')); t++) {
    if (t % 5 === 0 && ai.hp > 0) ai.hit(60);
    ai.tick(players);
    for (const e of ai.drainEvents()) events.push(e);
    if (ai.sid !== states[states.length - 1]) states.push(ai.sid);
  }
  check(states.length >= 6, `a fight passes several states (${states.length})`);
  check(states.includes(S.roar), 'the fight roars');
  check(states.includes(S.death), 'the fight dies');
  eq(events.filter((e) => e.kind === 'killed').length, 1, 'the fight kills once');
  check(t < 60000, `the fight ends inside its bound (${t} ticks)`);
}
{
  // Hits during the sequence: the clamp keeps the body above the roar until the sequence has run.
  const ai = brain({ hp: 3000 });
  const targets = [player(1, 60, 0)];
  let minHp = Infinity;
  for (let i = 0; i < 4000; i++) {
    if (i % 3 === 0 && ai.cursor < GOL_CURSOR_B) ai.hit(120);
    ai.tick(targets);
    ai.drainEvents();
    if (ai.cursor < GOL_CURSOR_B) minHp = Math.min(minHp, ai.hp);
    if (ai.cursor >= GOL_CURSOR_B) break;
  }
  check(minHp >= ai.clamp || ai.cursor >= GOL_CURSOR_B, 'the clamp holds hp at the clamp before the roar');
}

if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('goldragon: ok');
