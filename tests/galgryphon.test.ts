// The Gal Gryphon's minion throw (client/src/combat/galgryphon.ts): the launcher made by
// CreateGalgryphonMinion_004aa808 (dump 228848), its Bezier flight
// (InterpolateMinionEffectPosition_007be6b8, dump 806436), its three states
// (UpdateGalgryphonMinionEffect_004aa968, dump 228908), the manager, and the attack
// dispatch parameters (DispatchGalGryphonAttackEffect_004a8690, dump 227054).
//
// Run: node tests/galgryphon.test.ts
import {
  GALMINION_LAUNCH,
  GALMINION_LAUNCH_STATE,
  GalgryphonMinionLauncher,
  GalgryphonMinionManager,
  galgryphonAttackParams,
  minionBezier,
  minionFlightFrames,
  type Vec3,
} from '../client/src/combat/galgryphon.ts';
import { GALMINION } from '../client/src/combat/galgryphonminion.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);
const near = (got: number, want: number, msg: string) => check(Math.abs(got - want) < 1e-9, `${msg}: got ${got}, want ${want}`);

const flat = (y: number | null) => () => y;

// The constants (0x00904468 = 0.07, 0x40a00000 = 5.0, the 30-frame floor).
eq(GALMINION_LAUNCH.durationScale, 0.07, 'the duration scale is 0x00904468');
eq(GALMINION_LAUNCH.apexY, 5, 'the target point is lifted to 5.0');
eq(GALMINION_LAUNCH.minDuration, 30, 'the minimum flight is 30 frames');

// The Bezier: the ends are the first and last control points; t = 0.5 weights 1/4, 1/2, 1/4.
{
  const p: [Vec3, Vec3, Vec3] = [
    { x: 0, y: 1, z: 2 },
    { x: 4, y: 8, z: -2 },
    { x: 10, y: 5, z: 6 },
  ];
  const a = minionBezier(p, 0);
  near(a.x, 0, 'bezier at 0 is the first point x');
  near(a.y, 1, 'bezier at 0 is the first point y');
  const b = minionBezier(p, 1);
  near(b.x, 10, 'bezier at 1 is the last point x');
  near(b.z, 6, 'bezier at 1 is the last point z');
  const m = minionBezier(p, 0.5);
  near(m.x, 0.25 * 0 + 0.5 * 4 + 0.25 * 10, 'bezier at 0.5 x');
  near(m.y, 0.25 * 1 + 0.5 * 8 + 0.25 * 5, 'bezier at 0.5 y');
}

// The flight length: ROUND(0.07 * distance), and 30 when that is below 31.
eq(minionFlightFrames({ x: 0, y: 0, z: 0 }, { x: 100, z: 0 }), 30, 'round(0.07 * 100) = 7 is raised to 30');
eq(minionFlightFrames({ x: 0, y: 0, z: 0 }, { x: 443, z: 0 }), 31, 'round(0.07 * 443) = 31 stays 31');
eq(minionFlightFrames({ x: 0, y: 0, z: 0 }, { x: 1000, z: 0 }), 70, 'round(0.07 * 1000) = 70');
eq(minionFlightFrames({ x: 0, y: 3, z: 4 }, { x: 0, z: 0 }), 30, 'the origin height is in the distance (5 units -> 30 frames)');

// The launcher: state 0 makes nothing; then the flight; the Effect on the state-2 tick.
{
  const origin: Vec3 = { x: 0, y: 2, z: 0 };
  const offset: Vec3 = { x: 150, y: -1, z: 0 };
  const target = { x: 1000, z: 0 };
  const l = GalgryphonMinionLauncher.create(origin, offset, target, 3);
  eq(l.duration, 70, 'the flight length from the distance');
  eq(l.points[1].x, 150, 'control point 1 is origin + offset');
  eq(l.points[1].y, 1, 'control point 1 keeps the offset y');
  eq(l.points[2].y, 5, 'the target point is lifted to 5.0');
  eq(l.points[2].x, 1000, 'the target keeps its x');
  eq(l.state, GALMINION_LAUNCH_STATE.init, 'starts in state 0');

  const ground = flat(4);
  eq(l.update(ground), null, 'state 0 makes nothing');
  eq(l.state, GALMINION_LAUNCH_STATE.fly, 'state 0 goes to fly');
  eq(l.pos.x, 0, 'no move on the first tick');

  let made: ReturnType<typeof l.update> = null;
  let ticks = 0;
  while (!l.dead && ticks < 500) {
    const r = l.update(ground);
    ticks++;
    if (r) made = r;
  }
  // The fly ticks sample timer 0..duration (duration + 1 ticks), the tick that sees
  // duration < timer ends the fly (1 tick), and the state-2 tick makes the Effect (1 tick).
  eq(ticks, l.duration + 3, 'the flight takes duration + 3 ticks in total');
  eq(l.state, GALMINION_LAUNCH_STATE.done, 'the launcher ends in state 3');
  check(made !== null, 'the Effect is made on the state-2 tick');
  // The last sample is at timer = duration + 1 (t > 1, the exe's extrapolation).
  const want = minionBezier(l.points, (l.duration + 1) / l.duration);
  near(l.pos.x, want.x, 'the last position is the sample at (duration + 1) / duration, x');
  near(l.pos.z, want.z, 'and z');
  eq(made?.slot, 3, 'the Effect takes the slot');
  eq(made?.y, 4, 'the Effect stands on the ground (4 <= 6)');
}

// No Effect when the ground is above 6 (the launcher still ends).
{
  const l = GalgryphonMinionLauncher.create({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, z: 0 }, 1);
  let made: ReturnType<typeof l.update> = null;
  for (let i = 0; i < 200 && !l.dead; i++) made = made ?? l.update(flat(9));
  eq(l.state, GALMINION_LAUNCH_STATE.done, 'the launcher ends with no ground');
  eq(made, null, 'no Effect above the ground limit');
}

// The manager: a throw, the flight, the Effect, the icon in the Effect's state 1 only.
{
  const m = new GalgryphonMinionManager();
  eq(m.active, false, 'an empty manager is idle');
  m.throw({ x: 0, y: 0, z: 0 }, { x: 60, y: 0, z: 0 }, { x: 200, z: 0 }, 2);
  eq(m.active, true, 'a throw makes it active');
  const players = [{ clientId: 2, x: 200, z: 0 }];
  let iconTicks = 0;
  for (let i = 0; i < 300 && m.active; i++) {
    m.update(players, flat(0));
    const icons = m.minimapIcons();
    if (icons.length > 0) {
      iconTicks++;
      eq(icons[0].scale, GALMINION.icon, 'the minion icon is 1.5');
      eq(icons[0].shape, 1, 'the minion icon shape');
    }
  }
  check(iconTicks > 0, 'the minion Effect draws icons');
  check(iconTicks <= GALMINION.life + 1, 'the icons last at most the MOVE life');
  m.clear();
  eq(m.active, false, 'clear empties the manager');
}

// The attack dispatch parameters (DispatchGalGryphonAttackEffect_004a8690): the literals 15.0 and 10.0, uint 1.
{
  const p = galgryphonAttackParams(7, 0.5);
  eq(p[0], 7, 'the intensity is passed through');
  eq(p[1], 0.5, 'the speed is passed through');
  eq(p[2], 15, 'the literal 15.0');
  eq(p[3], 10, 'the literal 10.0');
  eq(p[4], 1, 'the uint32 0x00903990');
}

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('galgryphon: all checks passed');
