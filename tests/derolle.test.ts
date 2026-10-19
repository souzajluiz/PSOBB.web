// De Rol Le's fight (client/src/combat/derolle.ts): the attack sequence, the
// corner moves, the HP pools, the death path, the leader's 6x13 / 6x14 and
// the children (stings, segment rocks, ceiling rocks, tentacles, beam).
//
// Run: node tests/derolle.test.ts
import {
  DeRolLeAi,
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

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
