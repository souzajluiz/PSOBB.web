// The Gal Gryphon's hook bodies as pure functions (client/src/combat/galgryphonfx.ts): the
// ground probe, the threshold dispatch, the area hit, the spawn ring's anchor, the S27 lightning
// and beam value, the S30 dive beam, and the minion ring's particle tick.
//
// Run: node tests/galgryphonfx.test.ts
import {
  GALFX,
  GALFX_RING,
  activateHitboxes,
  diveBeamPoints,
  galgryphonAttackBurst,
  galgryphonTransformContext,
  groundProbe,
  lightningArc,
  lightningBeamPlacement,
  lightningPointCount,
  markForDestruction,
  minionRingSpawn,
  minionRingTick,
  minionThresholdDispatch,
  polylineLength,
  ringAnchor,
  s27Beam,
  s27BeamValue,
  s33StageOneProbe,
  sinowberillBranch,
  type Vec3,
} from '../client/src/combat/galgryphonfx.ts';
import { DrlBurst } from '../client/src/combat/derolle.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const eq = (a: unknown, b: unknown, msg: string) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const target = (clientId: number, x: number, z: number): AiTarget => ({ clientId, x, z, charClass: 0, dead: false });

// ---- the ground probe (0x004a15fc) ----
{
  const pos: Vec3 = { x: 3, y: 50, z: -4 };
  eq(groundProbe(pos, null), null, 'probe: no ground, nothing');
  eq(groundProbe(pos, { y: 6.5 }), null, 'probe: a hit above 6.0 is no landing');
  const at6 = groundProbe(pos, { y: 6 });
  check(at6 !== null && at6.effect.y === 6 && at6.sfx === 0x39b, 'probe: 6.0 exactly is a landing');
  const low = groundProbe(pos, { y: -3 });
  eq(low, { effect: { x: 3, y: -3, z: -4 }, sfx: 0x39b }, 'probe: the effect is at the hit height, sound 0x39b');
  check(GALFX.groundLimit === 6 && GALFX.groundFlag === 0x16ef, 'probe: constants 6.0 (0x903ae0) and 0x16ef');
}

// ---- the S33 stage-1 probe (0x004a1a48) ----
{
  let calls = 0;
  const probe = () => {
    calls++;
    return null;
  };
  s33StageOneProbe(false, probe);
  check(calls === 0, 's33: no probe before the 14.0 event');
  s33StageOneProbe(true, probe);
  check(calls === 1, 's33: the probe runs at the 14.0 event');
}

// ---- the threshold dispatch (0x004a47a8) ----
{
  const seen: number[] = [];
  const r = minionThresholdDispatch((i) => {
    seen.push(i);
    return i === 1;
  });
  eq(r, 'state2', 'dispatch: the second threshold calls state 2');
  eq(seen, [0, 1], 'dispatch: tests stop at the first crossing (lazy, in order)');
  eq(minionThresholdDispatch(() => false), null, 'dispatch: nothing crossed, nothing called');
  eq(minionThresholdDispatch((i) => i === 3), 'init', 'dispatch: the last threshold is the init');
}

// ---- the area hit (0x004a8690 / 0x0051fc9c) ----
{
  // DispatchGalGryphonAttackEffect: [intensity, speed, 15, 10, 1]; the radius is the +8 word, 15.
  const b = galgryphonAttackBurst({ x: 0, y: 0, z: 0 }, 2, 3);
  check(b instanceof DrlBurst, 'attack: a DrlBurst');
  check(b.radius === 15, 'attack: radius is the +8 word (15.0, ASSUMED reading)');
  eq(b.effect, { kind: 'tech', power: 2 }, 'attack: power is the intensity (ASSUMED)');
  // Reach: radius + PLAYER_RADIUS (5). A player at 20 is hit, one at 21 is not.
  const hits = galgryphonAttackBurst({ x: 0, y: 0, z: 0 }, 2, 3).tick([target(1, 20, 0), target(2, 21, 0)]);
  eq(hits.map((t) => t.clientId), [1], 'attack: hits the player inside radius + 5 only');
  eq(sinowberillBranch([2, 3, 15, 10, 1]), 'x34', 'branch: a +8 word of 15 takes vtable +0x34');
  eq(sinowberillBranch([2, 3, 100.5, 10, 1]), 'x30', 'branch: above 100.0 takes vtable +0x30');
  eq(sinowberillBranch([2, 3, 100, 10, 1]), 'x34', 'branch: exactly 100.0 takes +0x34');
  eq(galgryphonTransformContext(7, 1.5, 60, 9), [7, 1.5, 60, 20, 9], 'transform: [p1, speed3, value, 20.0, p2]');
}

// ---- the spawn ring's anchor (0x004a9174) ----
{
  const pos = { x: 10, y: 0, z: 20 };
  const local = { x: 1, y: 2, z: 3 };
  eq(ringAnchor(pos, 0, local), { x: 11, y: 2, z: 23 }, 'ring: heading 0 is the identity');
  const q = ringAnchor(pos, 0x4000, { x: 1, y: 0, z: 0 });
  check(near(q.x, 10) && near(q.z, 19), 'ring: heading 90 deg turns +x into -z (matrix_rotation_y)');
  eq(activateHitboxes([0, 4, 0x20]), [1, 5, 0x21], 'ring: each hitbox gets bit 1');
}

// ---- the S27 lightning beam (0x004a9de0) ----
{
  const p0: Vec3 = { x: 0, y: 99, z: 0 };
  const none = lightningBeamPlacement(p0, null, 0);
  check(near(none.pos.y, 6 + 12), 'beam: no ground is 6.0, plus 12.0');
  check(near(lightningBeamPlacement(p0, { y: 2 }, 0).pos.y, 14), 'beam: a low ground keeps its height');
  check(near(lightningBeamPlacement(p0, { y: 9 }, 0).pos.y, 18), 'beam: a high ground is clamped to 6.0');
  const east = lightningBeamPlacement(p0, null, 0x4000);
  check(near(east.offsetX, 5) && near(east.offsetZ, 0), 'beam: offset is sin, cos times 5.0 (90 deg)');
}

// ---- the lightning arc (0x004a9869) ----
{
  eq(lightningPointCount(0), 2, 'arc: at least 2 points');
  eq(lightningPointCount(16), 2, 'arc: ROUND(16/16) + 1 = 2');
  eq(lightningPointCount(32), 3, 'arc: ROUND(32/16) + 1 = 3');
  eq(lightningPointCount(1000), 13, 'arc: at most 13 points');
  const line = (t: number): Vec3 => ({ x: 100 * t, y: 0, z: 0 });
  const arc = lightningArc(line, 0, 1);
  eq(arc.points.length, 7, 'arc: a 100-unit line is ROUND(6.25) + 1 = 7 points');
  check(near(arc.points[3]!.x, 50), 'arc: the middle point is at t = 0.5');
  check(near(arc.length, 100), 'arc: the polyline length is the sum of the segments');
  check(near(polylineLength([{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }]), 5), 'arc: a 3-4-5 segment is 5');
}

// ---- the S27 beam value (0x004a4dd5..0x004a4e7b) ----
{
  eq(s27BeamValue(0), 0, 'S27 value: 0');
  eq(s27BeamValue(16384), 1, 'S27 value: 16384 -> 1');
  eq(s27BeamValue(32768), 2, 'S27 value: 32768 -> 2');
  eq(s27BeamValue(65535), 3, 'S27 value: 65535 -> 3 (truncated, not rounded to 4)');
  let drawn = 0;
  const rnd = () => {
    drawn++;
    return 32768;
  };
  eq(s27Beam(5, rnd), null, 'S27 beam: off the 20-tick grid, nothing');
  check(drawn === 0, 'S27 beam: no random draw off the grid');
  eq(s27Beam(0, rnd), { flag: true, value: 2 }, 'S27 beam: m = 0 is flag true');
  eq(s27Beam(20, rnd), { flag: false, value: 2 }, 'S27 beam: m = 20 is flag false');
  eq(s27Beam(40, rnd), { flag: true, value: 2 }, 'S27 beam: m = 40 is flag true');
}

// ---- the 0x0073d160 release ----
{
  eq(markForDestruction(0), 1, 'release: sets bit 0');
  eq(markForDestruction(0x0002), 0x0003, 'release: keeps the other bits');
}

// ---- the S30 dive beam (0x004aa4b0 / 0x004aa4ec) ----
{
  const from: Vec3 = { x: 1, y: 50, z: 2 };
  const to: Vec3 = { x: 10, y: 0, z: 20 };
  const beam = diveBeamPoints(from, to, { y: 2 });
  eq(beam.points[0], from, 'dive: P0 is the start');
  eq(beam.points[1], { x: 10, y: 50, z: 20 }, 'dive: P1 is (to.x, from.y, to.z) (ASSUMED reading)');
  eq(beam.points[2], { x: 10, y: 2, z: 20 }, 'dive: P2 is the target at the ground height');
  eq([beam.start, beam.end], [40, 57], 'dive: frames 40 to 57');
  eq(diveBeamPoints(from, to, null).points[2]!.y, 6, 'dive: no ground, the end is 6.0');
}

// ---- the minion ring (0x004aabd8 / 0x004aade4) ----
{
  eq(minionRingSpawn({ x: 1, z: 2 }), { x: 1, y: 2, z: 2 }, 'ring spawn: y is 2.0 (0x40000000)');
  const opts = { speed0: 1.5, variant: 9, variantParam2: 1 };
  const t0 = minionRingTick(0, 0, { x: 0, z: 0 }, opts);
  eq(t0.state, 0, 'ring: state 0 at counter 0');
  eq(t0.counter, 1, 'ring: the counter goes up');
  eq(t0.attack, [9, 1.5 * 2, 0, 10, 1], 'ring: attack context at counter 0 (factor 2, radius 0)');
  eq(t0.slots?.length, GALFX_RING.slots, 'ring: 32 slots');
  eq(t0.slots![0]!.outer, { x: 0, z: 10 }, 'ring: slot 0 outer is 10 along +z');
  const t10 = minionRingTick(0, 10, { x: 0, z: 0 }, opts);
  check(near(t10.attack![2], 70), 'ring: radius is counter * 7');
  const quarter = t10.slots![8]!.primary; // k = 8 is a quarter turn (0x4000 BAMS)
  check(near(quarter.x, 70) && near(quarter.z, 0, 1e-9), 'ring: slot 8 sits a quarter turn round');
  const last = minionRingTick(0, 30, { x: 0, z: 0 }, opts);
  eq([last.state, last.counter], [1, 0], 'ring: after 31 spawn ticks it goes to the fade');
  check(near(last.attack![1], 1.5), 'ring: the factor is 1 at counter 30');
  const fadeIn = minionRingTick(1, 29, { x: 0, z: 0 }, opts);
  eq([fadeIn.counter, fadeIn.dead, fadeIn.attack, fadeIn.slots], [30, false, null, null], 'ring: fade at 29 -> 30 is alive');
  const fadeOut = minionRingTick(1, 30, { x: 0, z: 0 }, opts);
  eq([fadeOut.counter, fadeOut.dead], [31, true], 'ring: fade past 30 is dead');
  check(GALFX_RING.spawnFrames === 31 && GALFX_RING.lastFrame === 30, 'ring: 31 spawn frames, last frame 30');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('galgryphonfx tests passed');
