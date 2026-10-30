// De Rol Le's fight (client/src/combat/derolle.ts): the attack sequence, the
// corner moves, the HP pools, the death path, the leader's 6x13 / 6x14 and
// the children (stings, segment rocks, ceiling rocks, tentacles, beam).
//
// Run: node tests/derolle.test.ts
import {
  DeRolLeAi,
  DrlSegmentAi,
  DRL_BEAM,
  beamTipPoints,
  DRL_SEGMENT,
  DrlBurst,
  DrlCeilingRock,
  DrlEasing,
  DrlRockEmitter,
  DrlSegmentRock,
  DRL_CORNERS,
  DRL_ROCK_TYPES,
  DRL_SEQUENCE_NORMAL,
  DRL_SEQUENCE_ULTIMATE,
  DRL_SLOTS,
  DRL_STATE,
  drlNextState,
  drlVariant,
  type DeRolLeOptions,
  type DrlEvent,
} from '../client/src/combat/derolle.ts';
import { radarConcealed } from '../client/src/render/combat.ts';
import {
  DRL_DEBRIS,
  DRL_FIN,
  DrlDebris,
  DrlFins,
  PIECE_FADE,
  PIECE_FALL,
  PIECE_GONE,
  PIECE_SINK,
  drlPieceRecords,
  matIdentity,
  matMul,
  matRotY,
  matScale,
  matTranslate,
  newMat,
  type DrlPieceRecord,
} from '../client/src/combat/derollefins.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as THREE from 'three';
import { NjcmModelBuilder } from '../client/src/render/njcmmesh.ts';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { BmlArchive } from '../client/src/formats/bml.ts';
import { parseNinjaChunkFile, type NjcmObject } from '../client/src/formats/njcm.ts';
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

const MOVEMENT: EnemyMovementData = { fparam1: 120, fparam2: 70, fparam3: 90, fparam4: 60, fparam5: 0.2, fparam6: 0, iparam: [3000, 400, 1500, 100, 90, 0] };

function brain(over: Partial<DeRolLeOptions> = {}): DeRolLeAi {
  return new DeRolLeAi({
    x: 0,
    z: -250,
    angle: 0,
    ultimate: false,
    movement: MOVEMENT,
    hp: 5000,
    leader: () => true,
    frames: () => 60,
    ground: () => 0,
    rng: seeded(7),
    ...over,
  });
}
const player = (clientId: number, x: number, z: number): AiTarget => ({ clientId, x, z, charClass: 0, dead: false });

// Runs ticks until `until` holds (or the limit), collecting shots and events.
function run(ai: DeRolLeAi, targets: AiTarget[], ticks: number, until?: () => boolean) {
  const shots: EnemyShot[] = [];
  const events: DrlEvent[] = [];
  let n = 0;
  for (; n < ticks; n++) {
    const r = ai.tick(targets);
    shots.push(...(r.shots ?? []));
    events.push(...ai.events.splice(0));
    if (until?.()) break;
  }
  return { shots, events, ticks: n };
}

// 1. The sequence tables and their picks.
{
  eq(DRL_SEQUENCE_NORMAL.length, 44, 'normal table: 44 entries (0x009a4380)');
  eq(DRL_SEQUENCE_NORMAL.at(-1), 0x2c, 'normal table ends with the 0x2c loop');
  eq(DRL_SEQUENCE_ULTIMATE.length, 50, 'Ultimate table: 50 entries (0x009a4440)');
  eq(drlNextState(0, false, 0, () => 0).state, 0x03, 'after the entrance: 0 -> 1');
  eq(drlNextState(1, false, 0, () => 0).state, 0x18, 'then the floor stings');
  const loop = drlNextState(42, false, 0, () => 0);
  eq(loop.cursor, 6, '0x2c sends the cursor back to 5, the pick is entry 6');
  eq(loop.state, 0x0c, 'entry 6 is the move 3 -> 0');
  eq(drlNextState(0, true, 0, () => 0).state, 0x10, 'Ultimate starts with the segment rocks (0x28, lane 0)');
  eq(drlVariant(0x28, 2, 0), 0x11, '0x28 on lane 2: rocks at corner 2');
  eq(drlVariant(0x21, 0, -0.5), 0x06, '0x21 roll <= 0: 1 -> 2');
  eq(drlVariant(0x21, 0, 0.5), 0x08, '0x21 roll > 0: 1 -> 0');
  eq(drlVariant(0x25, 0, 0.1), 0x18, '0x25 roll > 0: the floor stings');
  eq(drlVariant(0x2b, 0, 0), 0x16, '0x2b lane 0: sink 0');
  eq(drlVariant(26, 0, 0), 26, 'plain entries are states');
  eq(DRL_SLOTS[7].next, 9, 'r_bite chains to bite_rloop');
  eq(DRL_SLOTS[16].motion, 7, 'slot 16 is the die motion');
}

// 2. The easing record (Player__ApplyVelocityEasing_0042c9a0).
{
  const e = new DrlEasing(0.08, 0.08, 3, 175);
  eq(e.brake, 175 - 9 / 0.16, 'brake point = dist - max^2 / (2 decel)');
  let n = 0;
  while (e.tick() !== 3 && n < 2000) n++;
  check(n < 2000, 'the ease arrives');
  check(near(e.pos, 175, 2), `it stops near the distance (${e.pos})`);
  check(e.pos <= 175, 'never past the distance');
}

// 3. The entrance and the first corner move.
{
  const ai = brain();
  eq(ai.sid, DRL_STATE.enter, 'the ctor starts state 1');
  const r = run(ai, [player(0, 0, 0)], 3000, () => ai.sid === 0x03);
  eq(ai.sid, 0x03, 'the entrance ends in the move 0 -> 1');
  const sent = r.events.filter((e) => e.kind === 'state');
  eq(sent.length, 1, 'one 6x13 for the pick');
  // (it already ran the move's first tick)
  check(near(ai.x, DRL_CORNERS[0][0], 0.5) && near(ai.z, DRL_CORNERS[0][2], 0.5), `the move starts at corner 0 (${ai.x}, ${ai.z})`);
  run(ai, [player(0, 0, 0)], 3000, () => ai.sid !== 0x03);
  eq(ai.sid, 0x18, 'the move ends, the floor stings follow');
  check(near(ai.x, 0, 3) && Math.abs(ai.z - 500) < 15, `the body reached corner 1 before (${ai.x.toFixed(1)}, ${ai.z.toFixed(1)})`);
}

// 4. Floor stings: launched at frame 18, land on the five points, explode.
{
  // A follower (no state picks) so the sequence does not throw them again.
  const ai = brain({ leader: () => false });
  ai.setState(DRL_STATE.stings);
  const r = run(ai, [player(0, 45, 30)], 600);
  const blasts = r.shots.filter((s): s is DrlBurst => s instanceof DrlBurst);
  eq(blasts.length, 5, 'five sting blasts');
  eq(blasts[0]?.radius, 50, 'blast radius 50.0 (0x009a48bc)');
  check(blasts.some((b) => near(b.x, 45) && near(b.z, 30)), 'a blast on (45, 30)');
  eq(blasts[0]?.effect.kind === 'tech' ? blasts[0].effect.power : -1, 90, 'blast power = MovementData fparam3');
  check(r.events.some((e) => e.kind === 'se' && e.id === 0x32a), 'the launch sound 0x32a');
}

// 5. Ring stings home on the target and shadow it.
{
  const ai = brain();
  const t = player(3, 30, 100);
  ai.setState(DRL_STATE.ringStings, true, [t]);
  eq(ai.targetId, 3, 'phase 6 picks the only player');
  run(ai, [t], 400, () => ai.stings[5].phase === 'shadow');
  eq(ai.stings[5].phase, 'shadow', 'ring sting 0 reached its ring point');
  run(ai, [t], 10);
  check(Math.hypot(ai.stings[5].x - 30, ai.stings[5].z - 120) < 6, 'it sits 20 in +z of the player');
  eq(ai.stings[5].y, 17, '17.0 above the player\'s ground');
}

// 6. Segment rocks: five segments, the type's fan.
{
  const ai = brain();
  ai.setState(DRL_STATE.rocks0);
  const r = run(ai, [player(0, 0, 0)], 200, () => ai.sid !== DRL_STATE.rocks0);
  const rocks = r.shots.filter((s) => s instanceof DrlSegmentRock);
  const type = DRL_ROCK_TYPES[1]; // the first entry cycles 0 -> 1
  eq(rocks.length, 5 * type.count, 'segments 0..4 each throw one fan');
  const em = new DrlRockEmitter([0, 30, 0], 0, 0, 10);
  const fan = [em.tick(), em.tick(), em.tick()].flat();
  eq(fan.length, 3, 'type 0 throws 3 rocks');
  check(em.done, 'then the emitter is done');
  const rock = fan[0];
  let n = 0;
  while (rock.y > 8.7 && n < 200) {
    rock.tick([]);
    n++;
  }
  eq(rock.y, 8.7, 'a rock falls to 8.7 and rolls');
  const hit = new DrlSegmentRock(0, 8.7, 0, 0, 1, 5, 70).tick([player(0, 0, 10)]);
  eq(hit.length, 1, 'a rolling rock hits a player in reach');
  eq(new DrlSegmentRock(100, 8.7, 0, 0, 1, 5, 70).tick([player(0, 100, 5)]).length, 0, 'no hits outside -75..76 in x');
}

// 7. Ceiling rocks: fall, hit through the player's top, bounce.
{
  const rng = () => 0; // kind 0, heading 0
  const rock = new DrlCeilingRock(0, 120, 0, 0, rng);
  let hits = 0;
  for (let i = 0; i < 200 && !rock.done; i++) hits += rock.tick([player(0, 5, 5)]).length;
  eq(hits, 1, 'one hit on the player under it');
  const miss = new DrlCeilingRock(0, 120, 0, 0, rng);
  let far = 0;
  for (let i = 0; i < 200 && !miss.done; i++) far += miss.tick([player(0, 80, 80)]).length;
  eq(far, 0, 'no hit far away');
  const sea = new DrlCeilingRock(0, 120, 0, null, rng);
  for (let i = 0; i < 400 && !sea.done; i++) sea.tick([]);
  check(sea.done, 'without ground it sinks and is deleted');
}

// 8. The wall: the tentacles reach for the target and grab.
{
  const ai = brain();
  const t = player(1, 0, 60);
  ai.setState(DRL_STATE.wall0, true, [t]);
  eq(ai.x, -100, 'on the wall: x -100');
  eq(ai.z, 10, 'z 10');
  const r = run(ai, [t], 2000, () => ai.sid !== DRL_STATE.wall0);
  const grabs = r.shots.filter((s): s is DrlBurst => s instanceof DrlBurst && s.radius === 8);
  eq(grabs.length, 4, 'all four tentacles grab once');
  check(grabs.every((g) => g.effect.kind === 'melee'), 'a grab is a physical hit');
  check(ai.tentacles.every((tt) => tt.state === 5 || tt.state === 0), 'leaving the wall lowers them');
}

// 9. The beam: one hit per player per beam, at the beam's end.
{
  const ai = brain();
  const t = player(2, 0, -100);
  ai.setState(DRL_STATE.beam, true, [t]);
  const r = run(ai, [t], 400, () => ai.sid !== DRL_STATE.beam);
  const hits = r.shots.filter((s): s is DrlBurst => s instanceof DrlBurst);
  eq(hits.length, 1, 'one beam hit');
  const landed = hits[0]?.tick([t]) ?? [];
  eq(landed.length, 1, 'it lands on the target');
}

// 10. HP: the shell first, then the body; the death path.
{
  const ai = brain();
  eq(ai.shellMax, 1500, 'shell pool = iparam3');
  eq(ai.bodyMax, 3000, 'body pool = iparam1');
  eq(ai.hit(1000), 'shell', 'hits go to the shell');
  eq(ai.bodyHp, 3000, 'the body is untouched');
  ai.hit(600);
  check(ai.shellBroken, 'the shell broke');
  check(ai.events.some((e) => e.kind === 'shellBroken'), 'the break event');
  eq(ai.hit(500), 'body', 'then the body takes the hits');
  eq(ai.bodyHp, 2500, 'body 2500');
  ai.setState(0x03);
  ai.events.splice(0);
  ai.hit(5000);
  const r = run(ai, [player(0, 0, 0)], 3000, () => r2done());
  function r2done() {
    return ai.events.some((e) => e.kind === 'remove');
  }
  const kinds = r.events.filter((e) => e.kind === 'state').map((e) => (e.kind === 'state' ? e.state : -1));
  eq(kinds.join(), [0x1e, 0x1f, 0x20].join(), 'death: sink 0x1e, 0x1f, removal 0x20');
  const killed = r.events.find((e) => e.kind === 'killed');
  check(!!killed && killed.kind === 'killed' && near(killed.x, -55.8) && near(killed.z, 60.29), 'the kill runs at (-55.8, 2.0, 60.29)');
  check(r.events.some((e) => e.kind === 'bgm' && e.name === 'deldeath.adx'), 'deldeath.adx at frame 27');
  check(ai.invulnerable, 'no more hits once dying');
  eq(ai.hit(10), 'none', 'a hit on the dying body does nothing');

  // Dying from the dive goes to 0x1f at once.
  const b = brain();
  b.setState(DRL_STATE.sink0);
  b.events.splice(0);
  b.hit(1600);
  b.hit(4000);
  // Flag 4 holds the death while the body is under.
  run(b, [], 1000, () => b.sid === DRL_STATE.death || b.sid === DRL_STATE.sinkDeath);
  check(b.sid === DRL_STATE.death || b.sid === DRL_STATE.sinkDeath, `the sink ends in a death state (0x${b.sid.toString(16)})`);
}

// 11. A follower takes its states from the leader's 6x13 / 6x14.
{
  const ai = brain({ leader: () => false });
  run(ai, [], 400);
  eq(ai.sid, DRL_STATE.enter, 'a follower does not pick a state while the leader can still send it');
  ai.applyRemote(0x19, 15, 4);
  eq(ai.sid, 0x19, '6x14 sets the state');
  eq(ai.cursor, 15, 'and the cursor');
  eq(ai.targetId, 4, 'and the target');
  eq(ai.events.filter((e) => e.kind === 'state').length, 0, 'a follower sends nothing');
}

// 12. The dive: down at corner 3, along the ceiling, up at corner 1.
{
  const ai = brain({ leader: () => false });
  ai.setState(DRL_STATE.dive);
  const r = run(ai, [], 3000, () => near(ai.z, 500) && ai.h === 0);
  check(r.shots.some((s) => s instanceof DrlCeilingRock), 'ceiling rocks fall during the run');
  check(near(ai.x, 0) && near(ai.z, 500), 'it comes up at corner 1');
}

// The body motions' frame counts in bm_boss2_de_rol_le.bml (0 beam02 ..
// 17 tloop), read from the client data.
const REAL_FRAMES = [15, 16, 20, 26, 21, 60, 60, 150, 150, 33, 40, 34, 80, 40, 80, 40, 50, 30];
const realFrames = (m: number) => REAL_FRAMES[m] ?? 30;

// 13. The beams run to their end with the real motions (normal: sub 3 waits
//     for beam_b, 26 frames, to end; Ultimate skips it), and the sequence
//     goes on to the recovery.
for (const ultimate of [false, true]) {
  const ai = brain({ frames: realFrames, ultimate });
  const t = player(0, 0, -100);
  ai.cursor = ultimate ? 23 : 24; // the entry before 26 (beam charge)
  ai.setState(DRL_STATE.beamCharge, true, [t]);
  const seen: number[] = [];
  run(ai, [t], 3000, () => {
    if (seen.at(-1) !== ai.sid) seen.push(ai.sid);
    return ai.sid === DRL_STATE.recover;
  });
  eq(ai.sid, DRL_STATE.recover, `${ultimate ? 'Ultimate' : 'normal'}: the beams end in the recovery 0x1c`);
  check(seen.includes(DRL_STATE.beam), `${ultimate ? 'Ultimate' : 'normal'}: the beam state ran`);
}

// 14. A whole normal loop with the real frame counts never stalls.
{
  const ai = brain({ frames: realFrames });
  const states = new Set<number>();
  let last = ai.sid;
  let still = 0;
  let worst = 0;
  for (let i = 0; i < 30 * 60 * 10; i++) {
    ai.tick([player(0, 0, 100)]);
    ai.events.splice(0);
    states.add(ai.sid);
    if (ai.sid === last) worst = Math.max(worst, ++still);
    else still = 0;
    last = ai.sid;
  }
  for (const s of [0x0d, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x04]) check(states.has(s), `the loop reaches state 0x${s.toString(16)}`);
  check(worst < 30 * 60, `no state lasts a minute (longest ${worst} ticks)`);
}

// 15. The breaking hit's rest is lost (0x00433edc's shell branch never
//     touches the body pool).
{
  const ai = brain();
  ai.hit(1400);
  eq(ai.hit(1000), 'shell', 'the breaking hit is a shell hit');
  eq(ai.bodyHp, ai.bodyMax, 'the 900 past the shell are lost');
}

// 16. The dive's rumble is a sustained SE (one voice per owner).
{
  const ai = brain({ leader: () => false });
  ai.setState(DRL_STATE.dive);
  const r = run(ai, [], 400);
  const rumble = r.events.filter((e) => e.kind === 'se' && e.id === 0x329);
  check(rumble.length > 1 && rumble.every((e) => e.kind === 'se' && e.sustain), 'SE 0x329 every frame, as a sustained voice');
}

// 17. A follower that never hears from the leader takes the step itself,
//     and a dead body is always removed.
{
  const ai = brain({ leader: () => false, frames: realFrames });
  ai.setState(0x03);
  run(ai, [], 3000, () => ai.sid !== 0x03);
  eq(ai.sid, 0x18, 'after waiting, the follower moves on to the floor stings');
  eq(ai.events.filter((e) => e.kind === 'state').length, 0, 'without sending anything');
  ai.hit(5000);
  ai.hit(5000);
  const r = run(ai, [], 5000, () => r2());
  function r2() {
    return ai.events.some((e) => e.kind === 'remove');
  }
  check(r.events.some((e) => e.kind === 'remove'), 'the follower removes the dead body on its own');
}

// 18. The fin chains (derollefins.ts: 0x0078d9d0 builds, 0x0078d130 solves,
//     0x00434d34 draws).
{
  const len = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const fins = new DrlFins();
  eq(fins.active, false, 'fins: no real anchor yet');
  for (let c = 0; c < 2; c++) {
    for (let j = 0; j < DRL_FIN.points; j++) {
      const p = fins.point(c, j);
      check(p[0] === 0 && p[1] === 0 && p[2] === -5 * j, `fins: rest point ${c}.${j} = anchor + j * (0, 0, -5), got ${p}`);
    }
  }
  // An anchor far from the rest pose: every segment is back at 5.0, the chain
  // hangs from its anchor.
  const A: [number, number, number][] = [
    [100, 50, -20],
    [-100, 50, -20],
  ];
  fins.tick(A);
  eq(fins.active, true, 'fins: active after a captured tick');
  for (let c = 0; c < 2; c++) {
    const p0 = fins.point(c, 0);
    check(p0[0] === A[c][0] && p0[1] === A[c][1] && p0[2] === A[c][2], `fins: point 0 of chain ${c} is the anchor`);
    for (let j = 0; j < DRL_FIN.points - 1; j++) check(near(len(fins.point(c, j), fins.point(c, j + 1)), 5, 1e-3), `fins: chain ${c} segment ${j} keeps the length 5`);
  }
  // Left alone the delta (0, 0, -2) a tick settles the chain along -z.
  for (let n = 0; n < 200; n++) fins.tick(A);
  for (let c = 0; c < 2; c++) {
    for (let j = 0; j < DRL_FIN.points; j++) {
      const p = fins.point(c, j);
      check(near(p[0], A[c][0], 1e-2) && near(p[1], A[c][1], 1e-2) && near(p[2], A[c][2] - 5 * j, 1e-2), `fins: chain ${c} settles along -z (point ${j} = ${p})`);
    }
  }
  // The anchors move: the chain follows with the length kept.
  fins.tick([
    [100, 50, 40],
    [-100, 50, -20],
  ]);
  check(near(len(fins.point(0, 1), [100, 50, 40]), 5, 1e-3), 'fins: chain 0 follows its anchor');
  // A sphere (radius 10 + half a segment) pushes a point out: sphere 1 sits at
  // anchor 1 + (0, -7.07, 7.07); with anchor 1 = (10, 7.07, -7.07) its centre is
  // (10, 0, 0) and chain 0's first point (0, 0, -5 + delta) lies inside it.
  const spheres = new DrlFins();
  const B: [number, number, number][] = [
    [0, 0, 0],
    [10, 7.07, -7.07],
  ];
  spheres.tick(B);
  const centre = [10, 7.07 - DRL_FIN.offset, -7.07 + DRL_FIN.offset];
  const p1 = spheres.point(0, 1);
  check(len(p1, centre) > Math.hypot(10, 5) + 0.5, `fins: the sphere pushes point 1 out (${len(p1, centre)} from its centre)`);
  check(near(len(p1, [0, 0, 0]), 5, 1e-3), 'fins: and the length is kept');
  // The draw: yaw atan2(-x, -z), pitch asin(-y), both truncated to BAMS.
  const pose = new DrlFins();
  const setSeg = (d: [number, number, number]) => {
    pose.points[0] = pose.points[1] = pose.points[2] = 0;
    pose.points[3] = d[0];
    pose.points[4] = d[1];
    pose.points[5] = d[2];
    return pose.angles(0, 0);
  };
  const down = setSeg([0, -5, 0]);
  eq(down.yaw, 0, 'pose: straight down skips the yaw');
  eq(down.pitch, 0x4000, 'pose: straight down is pitch 0x4000');
  const east = setSeg([5, 0, 0]);
  eq(east.yaw, -0x4000, 'pose: +x is yaw -0x4000');
  eq(east.pitch, 0, 'pose: and level');
  const rest = setSeg([0, 0, -5]);
  eq(rest.yaw, 0, 'pose: the rest direction (-z) is yaw 0');
  eq(rest.pitch, 0, 'pose: and pitch 0');
  const zero = setSeg([0, 0, 0]);
  eq(zero.pitch, 0x4000, 'pose: a zero segment reads as (0, -1, 0)');
  eq(pose.isTip(3), false, 'pose: segment 3 draws fin_a');
  eq(pose.isTip(4), true, 'pose: the last segment draws fin_b (the tip)');
  // The rest matrix: T(p) * S(2) * Rx(-0x4000): local y -> -z, local z -> +y.
  setSeg([0, 0, -5]);
  pose.points[0] = 1;
  pose.points[1] = 2;
  pose.points[2] = 3;
  pose.points[3] = 1;
  pose.points[4] = 2;
  pose.points[5] = -2;
  const m = pose.segmentMatrix(newMat(), 0, 0);
  const col = (k: number) => [m[k * 4], m[k * 4 + 1], m[k * 4 + 2]].map((v) => Math.round(v * 1e6) / 1e6 + 0);
  eq(col(0).join(), '2,0,0', 'matrix: local x stays x, scaled by 2');
  eq(col(1).join(), '0,0,-2', 'matrix: local y lies along -z');
  eq(col(2).join(), '0,2,0', 'matrix: local z points up');
  eq([m[12], m[13], m[14]].join(), '1,2,3', 'matrix: translated to the point');
  // Straight down: Rx(+0x4000) Rx(-0x4000) cancel, only the scale is left.
  setSeg([0, -5, 0]);
  const t = pose.segmentMatrix(newMat(), 0, 0);
  check(near(t[0], 2) && near(t[5], 2) && near(t[10], 2) && near(t[1], 0) && near(t[4], 0) && near(t[6], 0), 'matrix: straight down cancels the two X turns (just the scale)');
}

// 19. The brain keeps the fins running once the body has been drawn.
{
  const ai = brain();
  run(ai, [], 5);
  eq(ai.fins.active, false, 'ai: the fins wait for the body to be drawn');
  ai.finAnchors = [
    [0, 10, 0],
    [0, 10, 0],
  ];
  run(ai, [], 3);
  eq(ai.fins.active, true, 'ai: ticks the fin chains with the captured anchors');
  eq(ai.fins.point(0, 0)[1], 10, 'ai: the chain hangs from the anchor');
}

// 20. Piece records and the debris objects (0x00512124, 0x0042a238).
{
  const recs = drlPieceRecords(
    [
      [3, 4, 4],
      [0, 1, 0],
    ],
    false,
  );
  check(near(recs[0].dir[0], 1.1 * 0.6) && recs[0].dir[1] === 0 && near(recs[0].dir[2], 1.1 * 0.8), 'records: dir = 1.1 * the xz unit, y 0');
  eq(recs[0].pos.join(), '3,4,4', 'records: the helm keeps its positions');
  eq(recs[1].dir.join(), '0,0,0', 'records: a piece on the axis has no direction');
  eq(drlPieceRecords([[3, 4, 4]], true)[0].pos.join(), '6,8,8', 'records: the shell positions are scaled by 2.0');
  const script = (...v: number[]) => {
    let i = 0;
    return () => v[i++ % v.length];
  };
  const shellRecs: DrlPieceRecord[] = [
    { pos: [10, 0, 0], dir: [1.1, 0, 0] },
    { pos: [-10, 0, 0], dir: [-1.1, 0, 0] },
  ];
  // vy, vz, ax, spin, ay: 0.5 0.5 0 0.5 0 per piece.
  const sh = DrlDebris.shell(shellRecs, [0, 12, 60], script(0.5, 0.5, 0, 0.5, 0));
  eq(sh.pos[0], 10, 'shell: piece 0 starts at the origin + its position');
  eq(sh.pos[1], 12, 'shell: height of the origin');
  eq(sh.vel[0], Math.fround(1.1), 'shell: the outward speed');
  eq(sh.vel[1], 4, 'shell: vy = rand * 4 + 2');
  eq(sh.vel[2], -3, 'shell: vz = dir.z - (rand * 4 + 1)');
  eq(sh.ax[0], 0, 'shell: start angles come from the 3rd and 5th rand');
  eq(sh.spin[0], 0, 'shell: spin = (rand - 0.5) * 2 * 3400');
  eq(sh.state[0], PIECE_FALL, 'shell: falling');
  // Draw matrix with every angle 0: T(pos) * S(2).
  const pm = sh.pieceMatrix(newMat(), 0);
  check(pm[0] === 2 && pm[5] === 2 && pm[10] === 2 && pm[12] === 10 && pm[13] === 12 && pm[14] === 60, 'shell: the piece is drawn at scale 2 at its position');
  // Falls with gravity 0.2, lands in the arena (bounce -0.8, fade), is gone.
  const seen: number[] = [];
  let fadeTicks = 0;
  let prevAlpha = 1;
  let monotone = true;
  for (let n = 1; n < DRL_DEBRIS.life; n++) {
    sh.tick();
    if (seen[seen.length - 1] !== sh.state[0]) seen.push(sh.state[0]);
    if (sh.state[0] === PIECE_FADE) {
      fadeTicks++;
      if (sh.alpha[0] > prevAlpha) monotone = false;
      prevAlpha = sh.alpha[0];
    }
  }
  eq(seen.join(), `${PIECE_FALL},${PIECE_FADE},${PIECE_GONE}`, 'shell: piece 0 falls, fades and is gone');
  check(monotone && fadeTicks >= 19 && fadeTicks <= 22, `shell: the fade takes about 20 ticks (${fadeTicks})`);
  eq(sh.done, false, 'shell: alive before the 160th tick');
  sh.tick();
  eq(sh.done, true, 'shell: deleted at the 160th tick');
  eq(sh.visible(0), false, 'shell: a gone piece is not drawn');
  // Outside the arena a piece keeps falling and sinks under -10.
  const out = DrlDebris.shell(
    [
      { pos: [200, 0, 0], dir: [0, 0, 0] },
      { pos: [200, 0, 0], dir: [0, 0, 0] },
    ],
    [0, 30, 0],
    script(0, 0, 0, 0.5, 0),
  );
  const sunk: number[] = [];
  for (let n = 1; n < 100 && out.state[0] !== PIECE_SINK; n++) {
    out.tick();
    sunk.push(...out.sunk);
  }
  eq(out.state[0], PIECE_SINK, 'shell: outside the arena the piece sinks');
  eq(sunk.join(), '0,1'.slice(0, sunk.length === 1 ? 1 : 3), 'shell: a particle only for an even piece');
  check(out.pos[1] < DRL_DEBRIS.sink + 3, 'shell: it sank from under -10');
  const y0 = out.pos[1];
  out.tick();
  check(out.pos[1] < y0, 'shell: a sinking piece keeps going down (vy * 0.2)');
  // The helm: positions through the captured matrix, directions through its
  // rotation, drawn through T(pos) Rz Rx T(-origin) M.
  const M = matIdentity(newMat());
  matTranslate(M, 10, 20, 30);
  matRotY(M, 0x4000);
  matScale(M, 2, 2, 2);
  const helm = DrlDebris.helm([{ pos: [1, 0, 0], dir: [0, 0, 1.1] }], M, script(0, 0, 0.5));
  // Ry(90): local x -> -z, local z -> +x; scaled by 2.
  check(near(helm.pos[0], 10) && near(helm.pos[1], 20) && near(helm.pos[2], 28), `helm: M * (1, 0, 0) = (10, 20, 28), got ${[...helm.pos]}`);
  check(near(helm.vel[0], 2.2), `helm: the direction goes through the rotation (${helm.vel[0]})`);
  check(near(helm.vel[1], 2) && near(helm.vel[2], -1), 'helm: vy = 2 and vz = 0 - 1 with rand 0');
  eq(helm.origin.join(), '10,20,30', 'helm: the origin is M * 0');
  const hm = helm.pieceMatrix(newMat(), 0);
  check(near(hm[0], M[0]) && near(hm[2], M[2]) && near(hm[8], M[8]) && near(hm[10], M[10]), 'helm: the piece keeps the captured turn and scale');
  check(near(hm[12], helm.pos[0]) && near(hm[13], helm.pos[1]) && near(hm[14], helm.pos[2]), "helm: and sits at its position (T(-origin) cancels M's translation)");
  const prod = matMul(matIdentity(newMat()), M);
  check(near(prod[12], 10), 'matrices: multiplying by the identity keeps M');
}

// 21. The helm break through the brain: shell pool -> flag 0x80 -> 0x40, the
//     helm debris, 160 ticks.
{
  const ai = brain();
  const recs = (n: number): DrlPieceRecord[] => Array.from({ length: n }, (_, i): DrlPieceRecord => ({ pos: [i, 1, i], dir: [0.5, 0, 0.5] }));
  ai.pieceRecords = { helm: recs(28), shell: recs(19) };
  ai.helmMatrix = matIdentity(newMat());
  const events: DrlEvent[] = [];
  ai.hit(1400);
  eq(ai.helmCut, false, 'helm: not cut before the shell breaks');
  ai.hit(200);
  eq(ai.flags & 0xc8, 0x88, 'helm: the break sets 0x88');
  events.push(...run(ai, [], 1).events);
  check(events.some((e) => e.kind === 'helmBreak'), 'helm: UpdateDerolle sees 0x80');
  eq(ai.flags & 0xc8, 0x48, 'helm: 0x80 becomes 0x40');
  eq(ai.helmCut, true, 'helm: the body is drawn without the helm');
  eq(ai.helm?.count, 28, 'helm: 28 pieces');
  run(ai, [], 100);
  eq(ai.helm?.done, false, 'helm: still flying');
  run(ai, [], 100);
  eq(ai.helm?.done, true, 'helm: gone after 160 ticks');
  eq(run(ai, [], 5).events.filter((e) => e.kind === 'helmBreak').length, 0, 'helm: breaks once');
  // No node capture: the helm is cut but nothing flies.
  const bare = brain();
  bare.hit(1400);
  bare.hit(200);
  run(bare, [], 1);
  eq(bare.helm, null, 'helm: without the capture nothing flies (ASSUMED)');
  eq(bare.helmCut, true, 'helm: the body is still cut');
  // A segment's shell break: its own debris at its place.
  const seg = brain();
  seg.pieceRecords = { helm: recs(28), shell: recs(19) };
  seg.segments = Array.from({ length: 10 }, (_, i): [number, number, number] => [i * 10, 5, 0]);
  seg.breakSegment(3);
  seg.breakSegment(3);
  eq(seg.events.filter((e) => e.kind === 'segmentBroken').length, 1, 'segment: breaks once');
  eq(seg.shells[3]?.count, 19, 'segment: 19 pieces');
  eq(seg.shells[3]?.pos[0], 30, 'segment: around the segment (piece 0 at its x)');
  eq(seg.shells[2], null, 'segment: the others are intact');
}

// 21b. The shell segments as hit targets (the DE_ROL_LE_BODY entities,
//      0x004351c4 / 0x004354c4 / 0x004350d4 / 0x00435070).
{
  eq(DRL_SEGMENT.radius, 50, 'segment: hit box radius 50 (0x009a47f0)');
  eq(DRL_SEGMENT.minY, -60, 'segment: no hit box below -10 - 50');
  const ai = brain();
  eq(ai.segmentParts.length, 10, 'segment: ten entities');
  eq(ai.segmentParts[0].pool, 400, 'segment: pool = iparam2');
  eq(ai.segmentParts[0].y, 10000, 'segment: parked at 10000 before the first draw');
  // The slots the draw left are copied on the tick.
  ai.segments = Array.from({ length: 10 }, (_, i): [number, number, number] => [i * 10, 20 - i * 9, 5]);
  run(ai, [], 1);
  eq(ai.segmentParts[3].x, 30, 'segment: copies its slot');
  eq(ai.segmentParts[0].color, 0xffffffff, 'segment: white when idle');
  check(ai.segmentParts[8].targetable === true && ai.segmentParts[8].y === -52, 'segment: y -52 is hittable');
  eq(ai.segmentParts[9].targetable, false, 'segment: y -61 has no hit box');
  const hi = brain();
  hi.segments = Array.from({ length: 10 }, (_, i): [number, number, number] => [0, i === 0 ? 30 : 29.9, 0]);
  run(hi, [], 1);
  check(hi.segmentParts[0].high && !hi.segmentParts[1].high, 'segment: flag 4 at y 30 and up (high), 2 below');
  eq(new DrlSegmentAi(ai, 9).untargetable, true, 'segment proxy: hidden while the box is off');
  // The radar: the forced icon (handle_derolle_shell_behavior, dump 176968) has no box gate.
  eq(radarConcealed({ ai: new DrlSegmentAi(ai, 9) }), false, 'segment radar: shown with its box off (forced icon 1.2)');
  eq(radarConcealed({ ai: new DrlSegmentAi(ai, 3) }), false, 'segment radar: shown with its box on');
  eq(new DrlSegmentAi(ai, 3).tick().x, 30, 'segment proxy: stands at the segment');
  // A whole segment: its own pool only, the flash.
  ai.events.splice(0);
  eq(ai.hitSegment(2, 150), 'segment', 'segment: the hit goes to its pool');
  eq(ai.segmentParts[2].pool, 250, 'segment: 400 - 150');
  check(ai.shellHp === 1500 && ai.bodyHp === 3000, 'segment: shell and body untouched');
  eq(ai.events.length, 0, 'segment: no SE, no particle for a whole segment');
  eq(ai.hitSegment(2, 0), 'none', 'segment: a 0 does nothing');
  run(ai, [], 1);
  eq(ai.segmentParts[2].color, 0xff00ffff, 'segment: the flash starts cyan');
  run(ai, [], 1);
  eq(ai.segmentParts[2].color, 0xff0dffff, 'segment: then fades (0.95: red 13)');
  run(ai, [], 19);
  eq(ai.segmentParts[2].color, 0xffffffff, 'segment: white again after 20 frames');
  // The break: the pool reaching 0 breaks (0x004354f6 test / jle).
  eq(ai.hitSegment(2, 250), 'broken', 'segment: 250 more breaks it at 0');
  eq(ai.segmentParts[2].pool, 0, 'segment: pool 0');
  check(ai.segmentParts[2].broken, 'segment: flag 1');
  eq(ai.events.filter((e) => e.kind === 'segmentBroken').length, 1, 'segment: the break event');
  eq(ai.shells[2], null, 'segment: no piece records, nothing flies (ASSUMED)');
  run(ai, [], 1);
  eq(ai.segmentParts[2].color, 0, 'segment: a broken plate has colour 0 (alpha 0)');
  // A broken segment: half to the BODY pool even with the shell whole.
  ai.events.splice(0);
  eq(ai.hitSegment(2, 7), 'body', 'segment: broken -> the body');
  eq(ai.bodyHp, 2996, 'segment: round(3.5) = 4 (x87 round to even)');
  ai.hitSegment(2, 5);
  eq(ai.bodyHp, 2994, 'segment: round(2.5) = 2');
  eq(ai.shellHp, 1500, 'segment: the shell pool is never fed by a segment');
  eq(ai.shellBroken, false, 'segment: the shell stays whole');
  const fx = ai.events.find((e) => e.kind === 'particle');
  check(!!fx && fx.kind === 'particle' && fx.id === 0x127 && fx.up === 15 && fx.back === 12 && fx.at[0] === 20, 'segment: particle 0x127, 15 up, 12 toward the camera, at the segment');
  eq(ai.events.filter((e) => e.kind === 'se' && e.id === 0x336).length, 2, 'segment: SE 0x336 per hit');
  eq(ai.hitSegment(2, 1000), 'body', 'segment: no second break');
  eq(ai.events.filter((e) => e.kind === 'segmentBroken').length, 0, 'segment: breaks once');
  // The striker's client and a 6x0A receiver feed the same pools.
  const a = brain();
  const b = brain({ leader: () => false });
  const seq: [number, number][] = [[0, 300], [0, 200], [0, 9], [4, 50], [0, 1001], [4, 400], [4, 3]];
  for (const [i, d] of seq) {
    a.hitSegment(i, d);
    b.hitSegment(i, d);
  }
  check(a.segmentParts.every((s, i) => s.pool === b.segmentParts[i].pool && s.broken === b.segmentParts[i].broken) && a.bodyHp === b.bodyHp, 'segment: every client ends with the same pools');
  // The body can die through broken segments alone; the death runs to the end
  // with the real motions, no state hangs, on the leader and on a follower
  // that never hears from it.
  for (const leader of [true, false]) {
    const k = brain({ frames: realFrames, leader: () => leader });
    k.segments = Array.from({ length: 10 }, (_, i): [number, number, number] => [i * 10, 20, 5]);
    run(k, [], 1);
    k.hitSegment(5, 400);
    while (k.bodyHp > 0) k.hitSegment(5, 2000);
    eq(k.shellBroken, false, `segment death (${leader ? 'leader' : 'follower'}): the shell was never broken`);
    k.events.splice(0);
    const r = run(k, [player(0, 0, 0)], 30 * 60 * 3, () => k.sid === DRL_STATE.remove);
    eq(k.sid, DRL_STATE.remove, `segment death (${leader ? 'leader' : 'follower'}): sinks, dies and is removed (${r.ticks} ticks)`);
    check(r.events.some((e) => e.kind === 'killed'), `segment death (${leader ? 'leader' : 'follower'}): the kill runs`);
  }
}

// 22. The model facts the fins and the debris rely on, from the client's own
//     archive (skipped without PSOBB_DATA / the default client folder).
{
  const dir = process.env.PSOBB_DATA ?? join(process.env.HOME ?? '', 'Downloads/psobb-client/data');
  const file = join(dir, 'data.gsl');
  if (!existsSync(file)) {
    console.log('skip: no client data for the De Rol Le model checks');
  } else {
    const gsl = new GSLArchive(new Uint8Array(readFileSync(file)));
    for (const bmlName of ['bm_boss2_de_rol_le.bml', 'bm_boss2_de_rol_le_a.bml']) {
      const bml = new BmlArchive(gsl.get(bmlName));
      const tree = (name: string) => {
        const all: NjcmObject[] = [];
        const parent: number[] = [];
        const walk = (o: NjcmObject, p: number) => {
          all.push(o);
          parent.push(p);
          const me = all.length - 1;
          for (const c of o.children) walk(c, me);
        };
        walk(parseNinjaChunkFile(bml.get(name)).object!, -1);
        return { all, parent };
      };
      const body = tree('boss2_b_derorure_body.nj');
      eq(body.all.length, 176, `${bmlName}: the body has 176 nodes`);
      // The draw index is the depth-first index: the captures 0x4d..0x58 of
      // table 0x008fcba0 are the 12 nodes under node 77 (the helm).
      const under = (root: number) => body.all.map((_, i) => i).filter((i) => {
        for (let k = i; k >= 0; k = body.parent[k]) if (k === root) return true;
        return false;
      });
      const helm = under(77);
      eq(`${helm[0]}..${helm[helm.length - 1]}`, '77..88', `${bmlName}: node 77's tree is draw indices 0x4d..0x58`);
      eq(body.all[77].children.length, 4, `${bmlName}: node 77 has the 4 helm parts`);
      // The fin anchors are locator nodes (no model, hidden: flags & 8).
      for (const i of [26, 96]) check(body.all[i].model === null && (body.all[i].flags & 8) !== 0, `${bmlName}: node ${i} is a hidden locator`);
      // The segment plates (the area init's walk of root->child / next, the
      // pointers DAT_00a43c0c[i] and g_DerolleRenderColorsArray[i]): the
      // root's first ten children are draw indices 1 + 2i, each a model node
      // with one model child 2 + 2i.
      const rootKids = body.all.map((_, i) => i).filter((i) => body.parent[i] === 0);
      eq(rootKids.slice(0, 10).join(), [1, 3, 5, 7, 9, 11, 13, 15, 17, 19].join(), `${bmlName}: the segment plates are draw indices 1 + 2i`);
      check(
        rootKids.slice(0, 10).every((k) => body.all[k].model !== null && body.all[k].children.length === 1 && body.all[k + 1].model !== null && body.parent[k + 1] === k),
        `${bmlName}: each plate is a model node with one model child`,
      );
      const helmBreak = tree('boss2_b_helm_break.nj');
      const shellBreak = tree('boss2_b_shell_break.nj');
      eq(helmBreak.all.length, 29, `${bmlName}: helm_break is a root and 28 pieces`);
      eq(shellBreak.all.length, 20, `${bmlName}: shell_break is a root and 19 pieces`);
      check((helmBreak.all[0].flags & 8) !== 0 && helmBreak.all.slice(1).every((o) => (o.flags & 8) === 0 && (o.flags & 0x10) !== 0 && o.model !== null), `${bmlName}: only the pieces of helm_break are model nodes`);
      eq(tree('boss2_b_derorure_fin_a.nj').all.length, 1, `${bmlName}: fin_a is one node`);
      eq(tree('boss2_b_derorure_fin_b.nj').all.length, 2, `${bmlName}: fin_b is two nodes (a tip)`);
    }
    // The plate tint (render/combat.ts): with ownMaterials, every segment plate
    // node (1 + 2i) gets materials of its own, and no other node does.
    const plates = Array.from({ length: 10 }, (_, i) => 1 + 2 * i);
    const body = new BmlArchive(gsl.get('bm_boss2_de_rol_le.bml'));
    const root = parseNinjaChunkFile(body.get('boss2_b_derorure_body.nj')).object!;
    const built = new NjcmModelBuilder().build([{ name: 'body', root, textures: () => null, ownMaterials: plates }]);
    const owned = (built.partMeshes[0]?.material as THREE.Material[]).map((m) => m.userData.node as number | undefined);
    for (const k of plates) check(owned.includes(k), `real body: plate node ${k} has its own material`);
    check(owned.every((n) => n === undefined || plates.includes(n)), 'real body: only the plates have own materials');
  }
}

// 23. The beam's particles (0x126 at its start, 0x176 at its tip every frame,
//     the emitter 0x177 while beamFiring) and the plate tint's material split
//     (NjcmPartInput.ownMaterials, a strip belongs to the node that caches it).
{
  eq(DRL_BEAM.start, 0x126, 'beam: start particle 0x126 (boss2_senkou)');
  eq(DRL_BEAM.tip, 0x176, 'beam: tip particle 0x176 (boss2_beam_a)');
  eq(DRL_BEAM.emitter, 0x177, 'beam: emitter 0x177 (boss2_beam_b)');
  const ai = brain();
  const t = player(2, 0, -100);
  eq(ai.beamFiring, false, 'beam: not firing before the state');
  ai.setState(DRL_STATE.beam, true, [t]);
  const r = run(ai, [t], 400, () => ai.sid !== DRL_STATE.beam);
  const starts = r.events.filter((e) => e.kind === 'beamStart');
  eq(starts.length, 1, 'beam: one emitter per beam');
  const parts = r.events.filter((e): e is Extract<DrlEvent, { kind: 'particle' }> => e.kind === 'particle');
  eq(parts.filter((p) => p.id === DRL_BEAM.start).length, 1, 'beam: 0x126 once, at the start');
  const tips = parts.filter((p) => p.id === DRL_BEAM.tip);
  check(tips.length >= 10, `beam: 0x176 along the beam (${tips.length})`);
  check(tips.every((p) => p.up === 0 && p.back === 0), 'beam: the tip is at the point, no lift');
  eq(ai.beamFiring, false, 'beam: not firing after its end');
  const first = r.events.findIndex((e) => e.kind === 'beamStart');
  check(first >= 0 && r.events.findIndex((e) => e.kind === 'particle' && e.id === DRL_BEAM.start) < r.events.findIndex((e) => e.kind === 'particle' && e.id === DRL_BEAM.tip), 'beam: the start particle before the first tip');
}

// 23a. The 0x176 string (0x0042fb26..0x0042fddd): phase +5 wrapping at 20, a
//      puff every 20 units from the cast point below the length.
{
  let r = beamTipPoints([0, 0, 0], [0, 0, 100], 0);
  eq(r.phase, 5, 'tip string: phase 0 -> 5');
  eq(r.points.map((p) => p[2]).join(), '5,25,45,65,85', 'tip string: every 20 from the phase');
  r = beamTipPoints([0, 0, 0], [0, 0, 100], 15);
  eq(r.phase, 0, 'tip string: phase 15 wraps to 0 (20 is not below 20)');
  eq(r.points.map((p) => p[2]).join(), '0,20,40,60,80', 'tip string: phase 0 starts at the cast point');
  eq(beamTipPoints([0, 0, 0], [0, 0, 0], 0).points.length, 0, 'tip string: a zero beam makes none');
  eq(beamTipPoints([1, 2, 3], [4, 6, 3], 0).points.length, 0, 'tip string: phase 5 is not below a length-5 beam');
  const d = beamTipPoints([1, 2, 3], [4, 6, 3], 15).points;
  eq(d.length, 1, 'tip string: one puff on a short beam');
  eq(d[0]?.join(), '1,2,3', 'tip string: at the cast point');
}

// 23b. ownMaterials on a model built from scratch: a node's strips made by the
//      cache op of that node keep its material, the draw op of another node
//      does not move them.
{
  // A node: its vertex chunks, its polys and its children (flags 0: drawn).
  const node = (children: NjcmObject[], polys: unknown[], vertices: unknown[]): NjcmObject => ({
    flags: 0,
    model: { vertices, polys, center: [0, 0, 0], radius: 1 } as unknown as NjcmObject['model'],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    children,
  });
  const vert = { type: 41, flags: 0, indexOffset: 0, indices: new Uint16Array([0, 1, 2]), positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: null, colors: null, weights: null };
  const tri = { indices: [0, 1, 2], uvs: null, colors: null, flipped: false };
  // Node 1 caches its strip (slot 3) under a red material; node 2 draws slot 3.
  const plate = node([], [{ op: 'material', src: 4, dst: 5, diffuse: 0xff0000ff, ambient: null, specular: null }, { op: 'cache', slot: 3 }, { op: 'strips', type: 0, flags: 0, strips: [tri] }], []);
  const other = node([], [{ op: 'draw', slot: 3 }], []);
  const top = node([plate, other], [], [vert]);
  const mesh = new NjcmModelBuilder().build([{ name: 'probe', root: top, textures: () => null, ownMaterials: [1] }]).partMeshes[0]!;
  const tags = (mesh.material as THREE.Material[]).map((m) => m.userData.node as number | undefined);
  check(tags.includes(1), 'ownMaterials: the cached strips of node 1 keep node 1 (the draw in node 2 does not move them)');
  check(!tags.includes(2), 'ownMaterials: node 2 has no own material');
  eq(tags.length, 1, 'ownMaterials: the only strip is node 1\'s, so one material');
  eq((mesh.material as THREE.Material[])[tags.indexOf(1)]?.userData.node, 1, 'ownMaterials: tagged with the node');
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
