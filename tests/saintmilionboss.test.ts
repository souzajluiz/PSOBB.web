// Saint-Milion's fight (combat/saintmilionboss.ts, combat/saintmilionents.ts):
// the state table, the leader's 6xDC and a follower applying them, the two
// forms' parts and the death, the tentacles, and that no state hangs.
//
// Frame counts: the motions of bm_ene_boss09.bml and bm_ene_boss09_tentacle.bml
// read from the client's own archive (the numbers below; the last section
// checks them against PSOBB_DATA when it is there).
//
// Run: node tests/saintmilionboss.test.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { EnemyArchive } from '../client/src/render/enemymodel.ts';
import {
  SM_ANIMS,
  SM_STATES,
  SM_WEIGHTS,
  SaintMilionAi,
  weightedPick,
  type SmBossEvent,
  type SmBossOptions,
} from '../client/src/combat/saintmilionboss.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import { SM_MISSILE, SmMissile } from '../client/src/combat/saintmilionents.ts';
import type { EnemyShot } from '../client/src/combat/enemyshots.ts';
import type { EnemyMovementData } from '../client/src/formats/battleparams.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);

// bm_ene_boss09.bml motions 0 .. 30 and bm_ene_boss09_tentacle.bml 0 .. 6.
const BODY_FRAMES = [46, 40, 80, 85, 85, 85, 16, 31, 31, 6501, 61, 61, 61, 86, 60, 81, 20, 156, 91, 61, 71, 141, 125, 125, 40, 31, 39, 376, 411, 141, 151];
const TENT_FRAMES = [31, 61, 3, 30, 110, 60, 30];

// BattleParamEntry_ep4_on.dat, Normal, rows 32 / 34 and 33 / 35.
const MV1: EnemyMovementData = { fparam1: 0, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [1000, 0, 0, 0, 0, 0] };
const MV2: EnemyMovementData = { fparam1: 0, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [1013, 1100, 750, 1360, 500, 0] };
const MVL: EnemyMovementData = { fparam1: 0, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [8, 700, 0, 0, 0, 0] };

function make(leader: boolean, over: Partial<SmBossOptions> = {}): SaintMilionAi {
  return new SaintMilionAi({
    x: 0,
    z: 0,
    angle: 0,
    variant: 0,
    param1: 0,
    seed: 7,
    movement: [MV1, MV2],
    hp: [6930, 9775],
    tentacleHp: [1125, 900],
    tentacleMovement: [MVL, MVL],
    leader: () => leader,
    frames: (m) => BODY_FRAMES[m] ?? 30,
    tentacleFrames: (m) => TENT_FRAMES[m] ?? 30,
    ...over,
  });
}

const player = (id: number, x: number, z: number): AiTarget => ({ clientId: id, x, z, charClass: 0, dead: false });
// A player in the intro's reach, one in arena 2's, one at the origin of arena 0 / 1.
const NEAR_WAIT = player(1, -50, 24);

// Runs both brains the way the owner does: the follower applies what the
// leader sends. Returns the events of the leader.
function run(lead: SaintMilionAi, follow: SaintMilionAi | null, ticks: number, targets: AiTarget[], until?: () => boolean): SmBossEvent[] {
  const seen: SmBossEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    lead.tick(targets);
    follow?.tick(targets);
    for (const e of lead.events.splice(0)) {
      seen.push(e);
      if (e.kind === 'send') follow?.applyRemote(e.action, e.param);
    }
    follow?.events.splice(0);
    if (until?.()) break;
  }
  return seen;
}

// 1. The table: 31 states, every next state exists, every animation row too.
{
  eq(SM_STATES.length, 31, '31 states');
  check(SM_STATES.every((s) => s.next === -1 || (s.next >= 0 && s.next < 31)), 'every next state exists');
  check(SM_STATES.every((s) => s.anim === -1 || (s.anim >= 0 && s.anim < SM_ANIMS.length)), 'every animation row exists');
  check(SM_ANIMS.every((a) => a.motion < BODY_FRAMES.length), 'every motion exists in the archive');
  eq(weightedPick([0, 0, 0, 0], 0.5), 0, 'weights of 0 pick 0');
  eq(weightedPick(SM_WEIGHTS.a[0], 0.0), 0, 'first weight');
  eq(weightedPick(SM_WEIGHTS.a[0], 0.99), 3, 'last weight');
  eq(weightedPick([10, 10, 10, 10], 0.5), 2, 'the running total decides');
}

// 2. The start: nobody near, it waits; a player near, the leader sends 6xDC {0, 0x19}
//    and the follower follows; the introduction ends by itself in state 2.
{
  const lead = make(true);
  const fol = make(false);
  const far = [player(1, 5000, 5000)];
  run(lead, fol, 200, far);
  eq(lead.sid, 0, 'waits while nobody is near');
  const ev = run(lead, fol, 4, [NEAR_WAIT]);
  const send = ev.find((e) => e.kind === 'send');
  check(!!send && send.kind === 'send' && send.action === 0 && send.param === 0x19, 'the leader sends {0, 0x19}');
  eq(lead.sid, 0x19, 'the leader is in the introduction');
  eq(fol.sid, 0x19, 'the follower is too');
  const out = run(lead, fol, 3000, [NEAR_WAIT], () => lead.sid === 2 && fol.sid === 2);
  void out;
  eq(lead.sid, 2, 'the introduction hands over to state 2');
  eq(fol.sid, 2, 'and so does the follower');
  eq(lead.kind, 2, 'form 1');
  check(lead.events.length === 0, 'drained');
}

// 3. Form 1: parts 0 .. 3 come back every frame, parts 4 .. 7 die; the fourth
//    death starts form 2 at state 0x1a and reaches state 13 on its own.
{
  const lead = make(true);
  const fol = make(false);
  run(lead, fol, 5, [NEAR_WAIT]);
  run(lead, fol, 3000, [NEAR_WAIT], () => lead.sid === 2);
  eq(lead.sid, 2, 'form 1 running');
  eq(lead.remaining, 4, 'four parts to kill');
  // A decoy part is killed: it is back at once and nothing is counted.
  lead.hitPart(0, 99999, true);
  run(lead, fol, 3, [NEAR_WAIT]);
  eq(lead.parts[0].hp, lead.parts[0].maxHp, 'part 0 is revived');
  eq(lead.remaining, 4, 'part 0 does not count');
  eq(lead.parts[4].maxHp, Math.trunc(6930 / 4), 'a part has hp / 4');
  for (let i = 4; i < 7; i++) {
    lead.hitPart(i, 99999, true);
    run(lead, fol, 2, [NEAR_WAIT]);
  }
  eq(lead.remaining, 1, 'three parts counted');
  check(lead.sid !== 0x1a, 'the form goes on');
  lead.hitPart(7, 99999, true);
  run(lead, fol, 2, [NEAR_WAIT]);
  eq(lead.sid, 0x1a, 'the fourth part ends form 1: state 0x1a');
  eq(lead.kind, 5, 'a cutscene kind');
  eq(lead.remaining, 4, 'form 2 starts with four parts to kill');
  eq(lead.parts[0].maxHp, Math.trunc(9775 / 4), 'the parts have form 2\'s hp / 4');
  // The follower goes through the same change (it is not sent: every client runs the death).
  eq(fol.sid, 2, 'a follower that saw no part die stays in form 1 (the 6x0A carries the death to it)');
}

// 4. Form 2 to the death, a leader and a follower in step; nothing hangs.
{
  const lead = make(true);
  const fol = make(false);
  const at = [player(1, 533, -522)];
  const all = (ai: SaintMilionAi) => {
    for (let i = 4; i < 8; i++) ai.hitPart(i, 99999, true);
  };
  run(lead, fol, 5, [NEAR_WAIT]);
  run(lead, fol, 3000, [NEAR_WAIT], () => lead.sid === 2 && fol.sid === 2);
  // Every client sees the parts die (6x0A): do it to both.
  all(lead);
  all(fol);
  run(lead, fol, 2, at);
  eq(lead.sid, 0x1a, 'leader in the change');
  eq(fol.sid, 0x1a, 'follower in the change');
  run(lead, fol, 5000, at, () => lead.sid === 15 && fol.sid === 15);
  eq(lead.sid, 15, 'form 2 reaches the attack choice');
  eq(fol.sid, 15, 'for the follower too');
  check(lead.kind === 3 && fol.kind === 3, 'form 2');
  const sents: Array<[number, number]> = [];
  // Kill parts 0 .. 2 (each makes the leader send {0, 0x10}).
  for (let i = 0; i < 3; i++) {
    lead.hitPart(i, 99999, true);
    fol.hitPart(i, 99999, true);
    const ev = run(lead, fol, 3, at);
    for (const e of ev) if (e.kind === 'send') sents.push([e.action, e.param]);
  }
  check(sents.some((s) => s[0] === 0 && s[1] === 0x10), 'a part\'s death sends {0, 0x10}');
  eq(lead.remaining, 1, 'one part to go');
  // The fourth does not die: the last stand.
  lead.hitPart(3, 99999, true);
  fol.hitPart(3, 99999, true);
  run(lead, fol, 3, at);
  check(!lead.parts[3].counted, 'the last part is not counted');
  check((lead.field.state2 & 0x800) !== 0, 'State2 0x800');
  eq(lead.parts[3].hp, 1013, 'its hp is MovementData iparam1');
  run(lead, fol, 3000, at, () => lead.sid === 11 && (lead.field.state2 & 0x400) !== 0);
  check((lead.field.state2 & 0x400) !== 0, 'state 11 turns 0x800 into 0x400');
  eq(lead.lastPart, 3, 'the part left is remembered');
  // Now a death is the boss\'s.
  lead.hitPart(3, 99999, true);
  fol.hitPart(3, 99999, true);
  const ev = run(lead, fol, 5, at);
  check(ev.some((e) => e.kind === 'send' && e.action === 0 && e.param === 0x1b), 'the leader sends {0, 0x1b}');
  eq(lead.sid, 0x1b, 'the ending');
  const ev2 = run(lead, fol, 6000, at, () => lead.sid === 0x1e && fol.sid === 0x1e);
  eq(lead.sid, 0x1e, 'the leader ends in 0x1e');
  eq(fol.sid, 0x1e, 'the follower too (nothing hung)');
  const kills = ev2.filter((e) => e.kind === 'killed');
  eq(kills.length, 1, 'one kill');
  const k = kills[0];
  check(k?.kind === 'killed' && k.ours === true, 'the last attacker is read from the part');
}

// 5. A message of another client applies the way the leader's does; the move
//    state sends the arena and the arrival.
{
  const lead = make(true);
  const fol = make(false);
  const at = [player(1, 533, -522)];
  run(lead, fol, 5, [NEAR_WAIT]);
  run(lead, fol, 3000, [NEAR_WAIT], () => lead.sid === 2);
  for (let i = 4; i < 8; i++) {
    lead.hitPart(i, 99999, true);
    fol.hitPart(i, 99999, true);
  }
  run(lead, fol, 2, at);
  run(lead, fol, 8000, at, () => lead.sid === 15);
  lead.hitPart(0, 99999, true);
  fol.hitPart(0, 99999, true);
  const ev = run(lead, fol, 3000, at, () => lead.sid === 11);
  check(ev.some((e) => e.kind === 'send' && e.action === 3), 'state 11 sends the arena');
  const ev3 = run(lead, fol, 3000, at, () => lead.sid === 12);
  check(ev3.some((e) => e.kind === 'send' && e.action === 4), 'and the arrival');
  eq(fol.sid, 12, 'the follower arrived too');
  eq(Math.round(lead.x), Math.round(fol.x), 'at the same x');
  eq(Math.round(lead.z), Math.round(fol.z), 'at the same z');
}

// 6. The tentacles: the leads take spots, the lead of a spot dies, the boss answers.
{
  const lead = make(true);
  const fol = make(false);
  run(lead, fol, 5, [NEAR_WAIT]);
  run(lead, fol, 3000, [NEAR_WAIT], () => lead.sid === 2);
  run(lead, fol, 2, [NEAR_WAIT]);
  const ents = lead.field.entities;
  eq(ents[0].action === 1 || ents[0].action === 2, true, 'a lead came up');
  eq(ents[1].action, 10, 'a follower waits');
  run(lead, fol, 60, [NEAR_WAIT]);
  eq(ents[0].action, 2, 'the lead idles');
  // Strike it for a third of its hp: it flinches.
  ents[0].hit(400);
  run(lead, fol, 2, [NEAR_WAIT]);
  eq(ents[0].action === 8 || ents[0].action === 7, true, 'a third of the hp: it flinches');
  // Kill it: the boss comes up at its spot.
  const spot = ents[4].spot;
  ents[4].hit(99999);
  run(lead, fol, 1, [NEAR_WAIT]);
  eq(ents[4].action, 9, 'a dead lead sinks');
  eq(ents[4].hp, ents[4].maxHp, 'and is back with full hp');
  const ev = run(lead, fol, 6, [NEAR_WAIT]);
  check(ev.some((e) => e.kind === 'send' && e.action === 2), 'the leader sends 6xDC action 2');
  eq(lead.sid, 4 + spot, 'the boss comes up at the spot');
  eq(fol.sid, 4 + spot, 'the follower too');
  eq(ents.filter((e) => e.sub === 1).every((e) => e.action === 0xf || e.action === 10), true, 'the followers went under');
  run(lead, fol, 6000, [NEAR_WAIT], () => lead.sid === 2);
  eq(lead.sid, 2, 'and the boss returns to state 2 (the swing then state 2)');
}

// 6b. A lead's cycle with real frame counts: appear (40 -> 61 frames), idle, strike at
//     frame 26 of the strike animation (an enemy Rabarta), sink, come up again.
{
  const lead = make(true);
  run(lead, null, 5, [NEAR_WAIT]);
  run(lead, null, 3000, [NEAR_WAIT], () => lead.sid === 2);
  const e = lead.field.entities[8];
  const seenActions = new Set<number>();
  let shots = 0;
  for (let i = 0; i < 1200; i++) {
    lead.tick([player(1, 5000, 5000)]);
    lead.events.splice(0);
    seenActions.add(e.action);
    shots += e.shots.splice(0).length;
  }
  for (const a of [1, 2, 3, 4, 6]) check(seenActions.has(a), `the lead went through action ${a}`);
  check(shots >= 1, 'the strike made its Rabarta');
  check(e.shrink >= 0 && e.shrink <= 1 && e.rise >= 0 && e.rise <= 50, 'shrink and rise stay in range');
  // A follower pops up under a player, holds 60 frames, sinks and goes away; a player touching it is hit once.
  const f = lead.field.entities[9];
  const p = player(2, 0, 0);
  f.x = 0;
  f.z = 0;
  f.change(11);
  let touches = 0;
  const acts: number[] = [];
  for (let i = 0; i < 600; i++) {
    lead.field.players = [p];
    f.tick();
    touches += f.shots.splice(0).length;
    if (acts[acts.length - 1] !== f.action) acts.push(f.action);
  }
  check(acts.includes(0xd), 'the follower popped up');
  check(touches >= 1 && touches <= 3, `the touch hit about once per activation (${touches})`);
  // The boss gone: every tentacle is gone at once.
  lead.field.state2 |= 0x1000;
  lead.field.tick();
  check(lead.field.entities.every((x) => x.gone), 'State2 0x1000 removes the tentacles');
}

// 7. The motion frame counts against the client's archives, when they are there.
{
  const dir = process.env.PSOBB_DATA ?? join(process.env.HOME ?? '', 'Downloads/psobb-client/data');
  if (!existsSync(join(dir, 'data.gsl'))) console.log('skip: no client data for the frame counts');
  else {
    const gsl = new GSLArchive(new Uint8Array(readFileSync(join(dir, 'data.gsl'))));
    const loose = new Set(readdirSync(dir));
    const read = (n: string) => (loose.has(n) ? new Uint8Array(readFileSync(join(dir, n))) : gsl.has(n) ? gsl.get(n) : null);
    for (const [name, table, nodes] of [['bm_ene_boss09.bml', BODY_FRAMES, 0], ['bm_ene_boss09_tentacle.bml', TENT_FRAMES, 59]] as const) {
      const d = read(name);
      if (!d) {
        console.log(`skip: no ${name}`);
        continue;
      }
      const a = new EnemyArchive(name, d, 3);
      eq(a.motionCount, table.length, `${name}: motions`);
      for (let m = 0; m < table.length; m++) eq(a.motion(m, nodes === 0 ? 0 : m === 0 ? 59 : 32).frameCount, table[m], `${name}: motion ${m}`);
    }
  }
}

// 8. The missiles (state 18): one on entry, two more on frame 5 in arenas 3 / 4; each flies 5.0 a
//    frame for 240 frames and then explodes once, iparam3 to the living players within 100 (XZ).
{
  const drive = (ai: SaintMilionAi) => ai as unknown as { setState(s: number, first?: boolean): void; pendingShots: EnemyShot[]; arena: number };
  const missiles = (shots: readonly EnemyShot[]) => shots.filter((x): x is SmMissile => x instanceof SmMissile);
  const row = { ...MV2, iparam: [1013, 1100, 750, 1360, 500, 0] };
  // Entry (phase 4): one missile, carrying iparam3 (750) as its blast.
  {
    const b = make(true, { movement: [row, row] });
    b.tick([player(1, 5000, 5000)]);
    drive(b).arena = 0;
    drive(b).setState(18);
    const m = missiles(drive(b).pendingShots);
    eq(m.length, 1, 'state 18 entry makes one missile');
    eq(m[0]?.effect.kind === 'blast' ? m[0].effect.damage : -1, 750, 'the blast is iparam3');
    eq(m[0]?.effect.kind === 'blast' ? m[0].effect.knockback : -1, 3, 'the blast knockback is 3.0');
  }
  // Phase 0: on the clock's frame 5 two more in arenas 3 and 4 only.
  for (const arena of [0, 1, 2, 3, 4]) {
    const b = make(true, { movement: [row, row] });
    b.tick([player(1, 5000, 5000)]);
    drive(b).arena = arena;
    drive(b).setState(18);
    drive(b).pendingShots.length = 0;
    let extra = 0;
    for (let i = 0; i < 12 && b.sid === 18; i++) extra += missiles(b.tick([player(1, 5000, 5000)]).shots ?? []).length;
    eq(extra, arena === 3 || arena === 4 ? 2 : 0, `arena ${arena}: phase 0 missiles`);
  }
  // Flight without an aim: 5.0 a frame along the launch vector; at the 240-frame cap it is removed with no blast.
  {
    const m = new SmMissile(0, 0, 0, 750, null);
    const near = player(1, 0, 1200);
    for (let i = 1; i <= SM_MISSILE.life; i++) {
      const hits = m.tick([near]);
      if (i === 1) eq(m.z, 5, 'one frame is 5.0 along the launch vector');
      eq(hits.length, 0, `no blast at frame ${i}`);
    }
    eq(m.z, 5 * SM_MISSILE.life, 'after 240 frames the missile is 1200 along');
    eq(m.x, 0, 'a straight line');
    check(!m.done, 'the missile is still flying at 240 frames');
    eq(m.tick([near]).length, 0, 'the cap removes it with no blast, even on a player');
    check(m.done, 'removed at the cap');
  }
  // Aimed at a player 400 ahead: the flight ends within 20.0 of the aim point (380 along), with the blast there.
  {
    const m = new SmMissile(0, 0, 0, 750, 400 - SM_MISSILE.arrive);
    for (let i = 1; i < 76; i++) eq(m.tick([]).length, 0, `still flying at frame ${i}`);
    // The 76th tick moves it onto the end (380 along, 20.0 short of the aim) and blasts there.
    const at = { x: m.x, z: m.z + SM_MISSILE.speed };
    const inside = player(1, at.x, at.z + 99);
    const edge = player(2, at.x + 60, at.z + 80);
    const outside = player(3, at.x, at.z + 101);
    const dead = { ...player(4, at.x, at.z + 1), dead: true };
    const high = player(5, at.x + 10, at.z);
    const all = [inside, edge, outside, dead, high];
    const hits = m.tick(all);
    eq(m.done, true, 'the missile is spent after the blast');
    eq(hits.map((t) => t.clientId).join(','), '1,2,5', 'the blast reaches the living within 100 on the XZ plane');
    eq(m.tick(all).length, 0, 'it explodes once');
    eq(hits.length, 3, 'each player once');
  }
  // Aimed at a player who is already within 20.0: the blast comes on the first frame.
  {
    const m = new SmMissile(0, 0, 0, 750, 0);
    const hits = m.tick([player(1, 0, 5)]);
    eq(hits.length, 1, 'an aim within 20.0 explodes at once');
  }
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
