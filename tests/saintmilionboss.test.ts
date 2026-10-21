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
import { SM_LASER, SM_MISSILE, SM_SAND, SM_STORM, SM_WAVE, SmBlast, SmLaser, SmMissile, SmRng, SmSandSonic, SmStorm, SmWave } from '../client/src/combat/saintmilionents.ts';
import { BmlArchive } from '../client/src/formats/bml.ts';
import { parseNjmFile } from '../client/src/formats/njmotion.ts';
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

// 9. The wave (state 21): nothing on entry; one beam on the clock's frame 28 of phase 0; its type by
//    arena and roll; P each frame from θ = 0; the ramp; iparam5 to the living within 100 every frame.
{
  const drive = (ai: SaintMilionAi) => ai as unknown as { setState(s: number, first?: boolean): void; pendingShots: EnemyShot[]; arena: number };
  const waves = (shots: readonly EnemyShot[]) => shots.filter((x): x is SmWave => x instanceof SmWave);
  const row = { ...MV2, iparam: [1013, 1100, 750, 1360, 500, 0] };
  const BAMS = (Math.PI * 2) / 0x10000;
  // P of frame n (θ = n * step) for a beam at (ox, oz), heading h (BAMS) and type t: the spec of the table.
  const want = (ox: number, oz: number, h: number, t: number, n: number) => {
    const s = SM_WAVE.types[t];
    const th = n * s.step;
    const lx = s.amp * Math.sin(th * BAMS);
    const lz = s.rate * th;
    const a = h * BAMS;
    return { x: ox + lx * Math.cos(a) + lz * Math.sin(a), z: oz - lx * Math.sin(a) + lz * Math.cos(a) };
  };
  // Enters state 21 in the given arena, then ticks until the beam comes (at most 60 ticks).
  const enterWave = (b: SaintMilionAi, arena: number): { wave: SmWave | null } => {
    b.tick([player(1, 5000, 5000)]);
    drive(b).arena = arena;
    drive(b).setState(21);
    let wave: SmWave | null = null;
    for (let i = 0; i < 60 && b.sid === 21 && !wave; i++) wave = waves(b.tick([player(1, 5000, 5000)]).shots ?? [])[0] ?? null;
    return { wave };
  };

  // Entry: the wave event only, no beam; then one beam, made when the clock passes 28.
  {
    const b = make(true, { movement: [row, row] });
    b.tick([player(1, 5000, 5000)]);
    drive(b).arena = 3;
    drive(b).setState(21);
    check(b.events.some((e) => e.kind === 'effect' && e.name === 'wave'), 'state 21 entry emits the wave event');
    eq(waves(drive(b).pendingShots).length, 0, 'nothing on entry');
    let made = 0;
    let at = -1;
    for (let i = 0; i < 60 && b.sid === 21; i++) {
      // The state's dispatch runs before the clock's step of the tick, so the crossing is read on the elapsed value
      // the tick started with.
      const before = b.clock.elapsed;
      const n = waves(b.tick([player(1, 5000, 5000)]).shots ?? []);
      made += n.length;
      if (n.length) at = before;
    }
    eq(made, 1, 'one beam in state 21 phase 0');
    // The clock's stride is SM_ANIMS[21].speed (the one-shot clock has stride 0 once it has ended).
    check(at > 28 && at <= 28 + SM_ANIMS[21].speed, `made on the clock crossing 28 (elapsed ${at})`);
  }
  // The type: arenas 3 / 4 -> 2 or 3, the others 0 or 1; the higher when the roll is >= 0.5 (the boss's
  // own stream, which the state uses for nothing else in this phase).
  for (const arena of [0, 1, 2, 3, 4]) {
    const seen = new Set<number>();
    let rolled = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { wave } = enterWave(make(true, { seed, movement: [row, row] }), arena);
      if (!wave) {
        check(false, `arena ${arena} seed ${seed}: no beam`);
        continue;
      }
      const spec = (wave as unknown as { spec: (typeof SM_WAVE.types)[number] }).spec;
      const type = SM_WAVE.types.indexOf(spec);
      seen.add(type);
      const base = arena === 3 || arena === 4 ? 2 : 0;
      const roll = new SmRng((seed ^ 0x51d7) >>> 0).float();
      if (type === base + (roll >= 0.5 ? 1 : 0)) rolled++;
    }
    const pair = arena === 3 || arena === 4 ? [2, 3] : [0, 1];
    check([...seen].every((t) => pair.includes(t)), `arena ${arena}: types ${[...seen].join(',')} are ${pair.join(',')}`);
    eq(seen.size, 2, `arena ${arena}: both types come up`);
    eq(rolled, 40, `arena ${arena}: the higher type when the roll is >= 0.5`);
  }
  // P for frames 0 .. 3 (θ = n * step): P(0) = O, for type 0 heading 0 and type 2 heading 90 degrees.
  for (const [t, h] of [
    [0, 0],
    [2, 0x4000],
  ] as const) {
    const w = new SmWave(100, -50, h, t, 500, () => true);
    for (let n = 0; n < 4; n++) {
      w.tick([]);
      const p = want(100, -50, h, t, n);
      check(Math.abs(w.x - p.x) < 1e-9 && Math.abs(w.z - p.z) < 1e-9, `type ${t} heading ${h}: frame ${n} at P (${w.x}, ${w.z})`);
      if (n === 0) eq(`${w.x},${w.z}`, '100,-50', `type ${t}: P(0) is the origin`);
    }
  }
  // The ramp: 0.025 a frame, 1.0 at most.
  {
    const w = new SmWave(0, 0, 0, 0, 1, () => true);
    w.tick([]);
    check(Math.abs(w.ramp - 0.025) < 1e-12, 'the ramp grows 0.025 a frame');
    for (let i = 0; i < 39; i++) w.tick([]);
    check(Math.abs(w.ramp - 1) < 1e-9, 'the ramp is 1.0 after 40 frames');
    for (let i = 0; i < 5; i++) w.tick([]);
    eq(w.ramp, 1, 'the ramp stays at 1.0');
  }
  // The blast: iparam5 to each living player within 100 on the XZ plane, every frame, no gate.
  {
    const w = new SmWave(0, 0, 0, 0, 500, () => true);
    const near = player(1, 50, 0);
    const edge = player(4, 0, 100);
    const far = player(2, 0, 130);
    const dead = { ...player(3, 0, 0), dead: true };
    const all = [near, far, dead, edge];
    const f1 = w.tick(all).map((t) => t.clientId).join(',');
    eq(f1, '1,4', 'frame 1: the living within 100 (the edge counts), not the far one nor the dead');
    const f2 = w.tick(all).map((t) => t.clientId).join(',');
    eq(f2, '1,4', 'frame 2: the same players again (no once-per-player gate)');
    eq(w.effect.kind === 'blast' ? w.effect.damage : -1, 500, 'the blast is iparam5');
    eq(w.effect.kind === 'blast' ? w.effect.knockback : -1, 10, 'the knockback is 10.0');
  }
  // No ground under P: the beam dies on that frame with no hit (P at frame 2 is about 9.9 from the origin).
  {
    const w = new SmWave(0, 0, 0, 0, 500, (x, z) => Math.hypot(x, z) < 3);
    eq(w.tick([player(1, 0, 0)]).length, 1, 'frame 1: P is the origin, on the ground, and hits');
    eq(w.tick([player(1, 0, 0)]).length, 0, 'frame 2: no ground under P, no hit');
    check(w.done, 'the beam dies with no ground');
    eq(w.tick([player(1, 0, 0)]).length, 0, 'and it stays dead');
  }
  // The life cap (ASSUMED): with ground everywhere the beam ends after SM_WAVE.life frames.
  {
    const w = new SmWave(0, 0, 0, 0, 500, () => true);
    for (let i = 1; i <= SM_WAVE.life; i++) w.tick([]);
    check(!w.done, 'still flying at the cap');
    w.tick([]);
    check(w.done, 'ended after the cap');
  }
  // The boss's own beam with no ground callback: the arena circle (arena 3: origin (0, 0), range 620) ends it.
  {
    const b = make(true, { movement: [row, row] });
    const { wave } = enterWave(b, 3);
    if (!wave) check(false, 'arena 3 beam for the circle test');
    else {
      let n = 0;
      while (!wave.done && n < SM_WAVE.life) {
        wave.tick([]);
        n++;
      }
      check(wave.done && n < SM_WAVE.life, `the arena circle ends the beam (${n} frames)`);
    }
  }
}

// 10. The storm (state 23): one object on phase 4; its explosions on frames 2, 3, 6 and 14 (T = 75 n passes
//     100, 200, 400 and 1000), the radius and the damage factor of each (iparam4 times 1.0, 0.8, 0.64, 0.32),
//     knockback 3.0; it ends after the fourth.
{
  const drive = (ai: SaintMilionAi) => ai as unknown as { setState(s: number, first?: boolean): void; storm: SmStorm | null; arena: number };
  const blasts = (shots: readonly EnemyShot[]) => shots.filter((x): x is SmBlast => x instanceof SmBlast);
  const row = { ...MV2, iparam: [1013, 1100, 750, 1000, 500, 0] };
  // The four explosions of a storm of iparam4 1000: frame, radius (the blast's stored area) and damage.
  {
    const st = new SmStorm(0, 0, 1000);
    const at: Array<{ frame: number; damage: number; knock: number; radius: number }> = [];
    for (let n = 1; n <= 20; n++) {
      for (const b of st.tick()) {
        const e = b.effect.kind === 'blast' ? b.effect : null;
        at.push({ frame: n, damage: e?.damage ?? -1, knock: e?.knockback ?? -1, radius: (b as unknown as { radius: number }).radius });
      }
    }
    eq(at.map((x) => x.frame).join(','), '2,3,6,14', 'the explosions on frames 2, 3, 6 and 14');
    eq(at.map((x) => x.radius).join(','), SM_STORM.radii.join(','), 'the radii are 100, 200, 400 and 1000');
    eq(at.map((x) => x.damage).join(','), '1000,800,640,320', 'the damage is iparam4 times 1.0, 0.8, 0.64, 0.32');
    eq(at.every((x) => x.knock === SM_STORM.knockback), true, 'knockback 3.0');
    eq(st.tick().length, 0, 'the storm is spent after the fourth explosion');
    check(st.done, 'it ends after the fourth');
  }
  // The damage is trunc of the float product (iparam4 1360: 1088 and 870 and 435 for types 7 .. 9).
  {
    const st = new SmStorm(0, 0, 1360);
    const got: number[] = [];
    for (let n = 1; n <= 14; n++) for (const b of st.tick()) if (b.effect.kind === 'blast') got.push(b.effect.damage);
    eq(got.join(','), '1360,1088,870,435', 'iparam4 1360 gives 1360, 1088, 870 and 435');
  }
  // The explosion's area: max(radius, 100) on the XZ plane, the living only, once.
  {
    const hit = new SmBlast(10, -20, 50, 1, 3);
    eq(hit.tick([player(1, 110, -20)]).length, 1, 'a radius below 100 reaches 100 (the edge is in)');
    eq(new SmBlast(0, 0, 50, 1, 3).tick([player(1, 100.5, 0)]).length, 0, 'the edge at 100.5 is out');
    const big = new SmBlast(0, 0, 200, 1, 3);
    const all = [player(1, 150, 0), player(2, 0, 201), { ...player(3, 0, 0), dead: true }];
    eq(big.tick(all).map((t) => t.clientId).join(','), '1', 'a radius of 200 reaches 150 and not 201, dead out');
    eq(big.tick(all).length, 0, 'the explosion is once');
  }
  // The boss: one object on phase 4, the explosions on frames 2, 3, 6 and 14 after it, and it ends after the fourth.
  {
    const b = make(true, { movement: [row, row] });
    b.tick([player(1, 5000, 5000)]);
    drive(b).arena = 3;
    drive(b).setState(23);
    check(drive(b).storm instanceof SmStorm, 'state 23 entry makes the storm');
    const got: number[] = [];
    for (let n = 1; n <= 20; n++) {
      const k = blasts(b.tick([player(1, 5000, 5000)]).shots ?? []).length;
      for (let i = 0; i < k; i++) got.push(n);
    }
    eq(got.join(','), '2,3,6,14', 'the boss makes its four explosions on frames 2, 3, 6 and 14');
    eq(drive(b).storm?.done, true, 'the storm ends after the fourth');
  }
}

// 11. The sand sonic (state 10 at the clock's 45): made once; launched after trunc(6 * rng) frames; then 20 moves
//     of 10.0, one explosion per move (the base ATP, radius d * π / 6 at least 100, d from node 4); removed after the 20th.
{
  const drive = (ai: SaintMilionAi) => ai as unknown as { setState(s: number, first?: boolean): void; sonic: SmSandSonic | null };
  const sonics = (shots: readonly EnemyShot[]) => shots.filter((x): x is SmSandSonic => x instanceof SmSandSonic);
  const ATP = 777;
  // The object alone: three frames of wait, the launch, 20 moves of 10.0 along the heading, one explosion each.
  {
    const s = new SmSandSonic(3, ATP);
    eq([s.waiting(), s.waiting(), s.waiting(), s.waiting()].join(','), 'true,true,true,false', 'three frames of wait');
    s.launch(0, 0, 0, 0, 0);
    eq(s.launched, true, 'launched');
    const near = player(1, 0, 0);
    for (let i = 1; i <= SM_SAND.moves; i++) {
      s.tick([near]);
      eq(s.z, SM_SAND.speed * i, `move ${i} is 10.0 along the heading`);
      eq(s.x, 0, `move ${i} is straight`);
    }
    check(s.done, 'removed after the twentieth move');
    eq(s.tick([near]).length, 0, 'and it explodes no more');
    eq(s.effect.kind === 'blast' ? s.effect.damage : -1, ATP, 'the blast is the base ATP');
    eq(s.effect.kind === 'blast' ? s.effect.knockback : -1, SM_SAND.knockback, 'the knockback is the 10.1 the exe passes');
  }
  // The heading: sin along x, cos along z.
  {
    const s = new SmSandSonic(0, ATP);
    s.launch(5, 7, Math.PI / 2, 5, 7);
    s.tick([]);
    check(Math.abs(s.x - 15) < 1e-9 && Math.abs(s.z - 7) < 1e-9, 'heading π/2 moves along +x');
  }
  // One explosion per move: launched at (0, 50) from the pivot (0, 0), move k is d = 50 + 10 k from the pivot, so
  // the radius is 100 up to move 4 and then d * π / 6. A player just inside each radius is hit, just outside is not.
  {
    const s = new SmSandSonic(0, ATP);
    s.launch(0, 50, 0, 0, 0);
    let explosions = 0;
    for (let k = 1; k <= SM_SAND.moves; k++) {
      const z = 50 + SM_SAND.speed * k;
      const radius = Math.max((z * Math.PI) / 6, 100);
      const inside = player(1, 0, z + radius - 0.5);
      const outside = player(2, 0, z + radius + 0.5);
      const hits = s.tick([inside, outside]).map((t) => t.clientId).join(',');
      if (hits === '1') explosions++;
      eq(hits, '1', `move ${k}: the player inside the radius ${radius.toFixed(3)} is hit, the one outside is not`);
    }
    eq(explosions, SM_SAND.moves, 'one explosion per move');
  }
  // The boss: made at the clock's crossing of 45 and launched trunc(6 * rng) frames later, from node 0x17 with
  // the heading from node 4, its damage the base ATP.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const b = make(true, { seed, atp: ATP, movement: [MV2, MV2] });
    b.tick([player(1, 5000, 5000)]);
    b.nodesKnown = true;
    b.nodes.fill(0);
    b.nodes[4 * 3 + 2] = 0;
    b.nodes[0x17 * 3 + 2] = 50;
    drive(b).setState(10);
    let created = -1;
    let launched = -1;
    let damage = -1;
    let at: { x: number; z: number } | null = null;
    for (let i = 0; i < 80 && launched < 0; i++) {
      const out = b.tick([player(1, 5000, 5000)]);
      const i45 = b.events.findIndex((e) => e.kind === 'effect' && e.name === 'sandsonic');
      if (i45 >= 0) {
        if (created < 0) created = i;
        b.events.splice(0);
      }
      const s = sonics(out.shots ?? [])[0];
      if (s) {
        launched = i;
        damage = s.effect.kind === 'blast' ? s.effect.damage : -1;
        at = { x: s.x, z: s.z };
      }
    }
    const want = Math.trunc(SM_SAND.wait * new SmRng((seed ^ 0x51d7) >>> 0).float());
    eq(launched - created, want, `seed ${seed}: launched trunc(6 * rng) = ${want} frames after the crossing`);
    eq(damage, ATP, `seed ${seed}: the damage is the base ATP`);
    eq(at?.x ?? NaN, 0, `seed ${seed}: the start is node 0x17 (x)`);
    eq(at?.z ?? NaN, 50, `seed ${seed}: the start is node 0x17 (z)`);
  }
  // d is measured from node 4, not from the launch: at move 20 the sand sonic is 250 from node 4 (200 from its
  // start), so its radius is 250 * π / 6 (about 130.9): a player 130 away is hit, one 132 away is not.
  {
    const b = make(true, { seed: 9, atp: ATP, movement: [MV2, MV2] });
    b.tick([player(1, 5000, 5000)]);
    b.nodesKnown = true;
    b.nodes.fill(0);
    b.nodes[4 * 3 + 2] = 0;
    b.nodes[0x17 * 3 + 2] = 50;
    const sonic = new SmSandSonic(0, ATP);
    (b as unknown as { sonic: SmSandSonic | null }).sonic = sonic;
    let last: EnemyShot | null = null;
    for (let i = 0; i < 2; i++) last = sonics(b.tick([]).shots ?? [])[0] ?? last;
    eq(last === sonic, true, 'the sand sonic is shot once, on its launch');
    for (let k = 1; k < SM_SAND.moves; k++) sonic.tick([]);
    const radius = (250 * Math.PI) / 6;
    eq(sonic.tick([player(1, 0, 250 + 130), player(2, 0, 250 + 132)]).map((t) => t.clientId).join(','), '1', `move 20 (radius ${radius.toFixed(2)}): 130 in, 132 out`);
    check(sonic.done, 'removed after the 20th');
  }
}

// 12. The laser (states 19 / 20): one object on phase 4 and its sound; 125 updates, the last one ends it without a
//     sweep (126 frames of bm_obj_ep4_boss09_laser.bml); each update hits the living inside the wedge between the
//     previous and the current heading (span |cur - prev|, centred on the midpoint, reach L + 5) with iparam2, only
//     with a clear line; the damage is read every frame.
{
  const BAMS12 = (Math.PI * 2) / 0x10000;
  const lasers = (shots: readonly EnemyShot[]) => shots.filter((x): x is SmLaser => x instanceof SmLaser);
  const at = (angle: number, r: number) => ({ x: r * Math.sin(angle * BAMS12), z: r * Math.cos(angle * BAMS12) });
  // The aim of sweep frame k: BAMS 0x1000 * k at reach 620.
  const aimAt = (k: number) => at(0x1000 * k, 620);
  const mk = (over: Partial<ConstructorParameters<typeof SmLaser>[0]> = {}, dmg: () => number = () => 1000) =>
    new SmLaser({ origin: () => ({ x: 0, z: 0 }), aim: aimAt, damage: dmg, ...over });
  const ids = (ts: readonly AiTarget[]) => ts.map((t) => t.clientId).join(',');

  // Sweep frame 5 (the sixth update): cur 0x5000, prev 0x4000, span 0x1000, midpoint 0x4800.
  {
    const l = mk();
    for (let i = 0; i < 5; i++) l.tick([]);
    const near = at(0x4800, 100);
    const edge = at(0x4800 + 0xfff, 100);
    const out = at(0x4800 + 0x1000, 100);
    const back = at(0x4800 - 0x1000, 100);
    const far = at(0x4800, 700);
    const dead = { ...player(5, near.x, near.z), dead: true };
    const hit = l.tick([player(1, near.x, near.z), player(2, edge.x, edge.z), player(3, out.x, out.z), player(4, back.x, back.z), player(6, far.x, far.z), dead]);
    eq(ids(hit), '1,2', 'the sweep frame 5: the living inside the wedge (the midpoint, the edge in, the far and the dead out)');
    eq(l.effect.kind === 'tech' ? l.effect.power : -1, 1000, 'the effect is tech with iparam2');
  }
  // Sweep frame 0 has span |cur - prev| = 0 (prev starts at 0): nothing is hit.
  {
    const l = mk();
    eq(ids(l.tick([player(1, 0, 100)])), '', 'the first update (span 0) hits nothing');
  }
  // The line of sight: a wall between the boss and the player stops the hit.
  {
    const l = mk({ clear: () => false });
    for (let i = 0; i < 5; i++) l.tick([]);
    const near = at(0x4800, 100);
    eq(ids(l.tick([player(1, near.x, near.z)])), '', 'no clear line: no hit');
  }
  // Life: 125 updates; the 125th ends it and does not sweep. 126 frames of the motion.
  {
    const l = mk();
    const t = player(1, at(0, 100).x, at(0, 100).z);
    for (let i = 1; i < SM_LASER.frames - 1; i++) l.tick([]);
    check(!l.done, 'not done after 124 updates');
    eq(l.tick([t]).length, 0, 'the 125th update hits nothing');
    check(l.done, 'done on the 125th update');
    eq(l.tick([t]).length, 0, 'nothing after it is done');
  }
  // The damage is read each frame (the form change): iparam2 of the row being fought.
  {
    let dmg = 1000;
    const l = mk({}, () => dmg);
    l.tick([]);
    dmg = 800;
    l.tick([]);
    eq(l.effect.kind === 'tech' ? l.effect.power : -1, 800, 'the damage follows the row (iparam2 each frame)');
  }
  // The brain: phase 4 of states 19 / 20 makes one laser on the boss's position and the sound 0x6f8.
  {
    const drive = (ai: SaintMilionAi) => ai as unknown as { setState(s: number, first?: boolean): void; pendingShots: EnemyShot[] };
    const b = make(true, { x: 120, z: -40 });
    b.tick([player(1, 5000, 5000)]);
    const d = drive(b);
    d.setState(19);
    const shots = lasers(d.pendingShots);
    eq(shots.length, 1, 'state 19 phase 4: one laser');
    eq(b.events.filter((e) => e.kind === 'se' && e.id === SM_LASER.se).length, 1, 'state 19 phase 4: the sound 0x6f8 once');
    eq(b.events.filter((e) => e.kind === 'effect' && e.name === 'laser').length, 0, 'no laser effect name is left');
  }
  // The frame count of bm_obj_ep4_boss09_laser.bml (motion 0) against the client's archive, when it is there.
  {
    const dir = process.env.PSOBB_DATA ?? join(process.env.HOME ?? '', 'Downloads/psobb-client/data');
    const file = join(dir, 'bm_obj_ep4_boss09_laser.bml');
    if (!existsSync(file)) console.log('skip: no bm_obj_ep4_boss09_laser.bml');
    else {
      const bml = new BmlArchive(new Uint8Array(readFileSync(file)));
      const motion = bml.entries.find((e) => /\.njm$/i.test(e.name));
      eq(motion ? parseNjmFile(bml.get(motion.name), 1).frameCount : -1, SM_LASER.frames, 'bm_obj_ep4_boss09_laser.bml motion 0 frames');
    }
  }
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
