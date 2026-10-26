import assert from 'node:assert/strict';
import { toBams, RUN_SPEED, WALK_SPEED, legSpeed, rampAxis, KEY_RAMP_WALK_MAX, autoForwardRamp, lateralDecay, headingStep, velocityAngle, clampAngleStep, PlayerMover, followTick, remoteStep, slowApplies, inUnsafeMap, guardStance, GUARD_HUNTER_CLASSES, rampFrozen, CAMERA_GATE_ACTIONS, cameraGateKeyHeld } from '../client/src/render/playermove.ts';

assert.equal(RUN_SPEED, 45);
assert.equal(WALK_SPEED, 30);
assert.equal(legSpeed(1.5, true, false), 0.75);
assert.equal(legSpeed(1.0, false, true), 0.75);
let v = 0;
const seq: number[] = [];
for (let i = 0; i < 5; i++) seq.push((v = rampAxis(v, false, true)));
assert.deepEqual(seq, [32, 64, 96, 128, 128]);
assert.equal(rampAxis(128, false, false), 0);
// The keyboard ramp of PsoBB.exe (0x0070a60c, dump get_input_movement_speed), re-read from objdump:
// the step is 0x0096ed7c = 32.0, the cap 0x0096ed88 = 128.0 and 0x0096ed84 = 64.0 under the auto
// walk setting; the lateral decay is 0x0096ed74 = -8.0 and 0x0096ed78 = 8.0 (tools/exedata.py read).
assert.equal(KEY_RAMP_WALK_MAX, 64);
{
  // a held forward key (the port's +) ramps 32 a poll to the cap
  let f = 0;
  const fs: number[] = [];
  for (let i = 0; i < 6; i++) fs.push((f = rampAxis(f, false, true, false)));
  assert.deepEqual(fs, [32, 64, 96, 128, 128, 128]);
  // under the auto walk the cap is 64
  assert.equal(rampAxis(64, false, true, false, KEY_RAMP_WALK_MAX), 64);
  assert.equal(rampAxis(32, false, true, false, KEY_RAMP_WALK_MAX), 64);
  // both held: forward wins over back (exe 0x70a7fb je to 0x70a82a, 0x70a828 jmp past back),
  // left wins over right (exe 0x70a8e8 jmp past right)
  assert.equal(rampAxis(0, true, true, false), 32, 'forward and back held: forward');
  assert.equal(rampAxis(0, true, true, true), -32, 'left and right held: left');
  // a released key is 0 at once (the auto move off, 0x70aa4c)
  assert.equal(rampAxis(96, false, false, false), 0);
  // the auto forward ramp: 32 a poll to the auto walk cap (0x70aa6d), never a jump
  let a = 0;
  const as: number[] = [];
  for (let i = 0; i < 4; i++) as.push((a = autoForwardRamp(a, KEY_RAMP_WALK_MAX)));
  assert.deepEqual(as, [32, 64, 64, 64]);
  // the lateral decay: 8 a poll toward 0 from either side, then 0
  assert.equal(lateralDecay(20), 12);
  assert.equal(lateralDecay(12), 4);
  assert.equal(lateralDecay(4), 0);
  assert.equal(lateralDecay(0), 0);
  assert.equal(lateralDecay(-20), -12);
  assert.equal(lateralDecay(-4), 0);
}
// 0.1 and 0.75 of the sum of squares / 16384: the third poll runs, the first does not
assert.ok(32 * 32 / 16384 < 0.1 && 64 * 64 / 16384 > 0.1 && 96 * 96 / 16384 < 0.75 + 0.0001 && 128 * 128 / 16384 > 0.75);
assert.equal(headingStep(0, 0x1000), 0x400); // a quarter
assert.equal(headingStep(0, 0x6000), 0x3000); // half when far
// the same step turning the other way and across the 16-bit wrap (0x0 -> 0xf000 is -0x1000)
assert.equal(headingStep(0, 0xf000), 0xfc00); // -0x800 + 0x400: a quarter, toward the target
assert.equal(headingStep(0xfff0, 0x0010), 0xfff8); // diff 0x20 across the wrap: step 0x10 - 0x8 = 0x8
assert.equal(velocityAngle(0, 0x1000), 0x800);
assert.equal(clampAngleStep(0, 0x2000, 0x800), 0x800);
assert.equal(clampAngleStep(0, 0x400, 0x800), 0x400);
// the tick machine: walk at 1.0 a tick, run (1.5) after 6 ticks of a full stick, leg-end stop
const free = (m: PlayerMover) => (dx: number, dz: number) => ({ x: m.x + dx, z: m.z + dz });
const up = { lr: 0, fb: 128, cameraYaw: Math.PI, keyboard: false }; // camera at yaw PI: forward = +z
const m = new PlayerMover(0, 0);
m.tick(up, free(m));
assert.equal(m.state, 'walk');
assert.ok(m.z > 0 && m.z <= 1.0 + 1e-9, 'walk moves at most 1.0 a tick');
for (let i = 0; i < 40; i++) m.tick(up, free(m));
assert.equal(m.state, 'run');
const z2 = m.z;
m.tick(up, free(m));
assert.ok(Math.abs(m.z - z2 - 1.5) < 0.2, 'run is about 1.5 a tick (velocity direction lags the heading)');
const none = { lr: 0, fb: 0, cameraYaw: Math.PI, keyboard: false };
let ticks = 0;
while (m.state !== 'stand' && ticks++ < 50) m.tick(none, free(m));
assert.equal(m.state, 'stand');
assert.ok(ticks >= 1 && ticks <= 8, 'a released run ends within its leg: ' + ticks);
// keyboard sideways only turns in place, then walks
const k = new PlayerMover(0, 0);
const side = { lr: 128, fb: 0, cameraYaw: Math.PI, keyboard: true };
k.tick(side, free(k));
assert.equal(k.state, 'stand');
assert.equal(k.x, 0);
for (let i = 0; i < 10; i++) k.tick(side, free(k));
assert.equal(k.state, 'walk');
// a wall: the leg ends, a released key then stands, and a new direction applies
const wall = new PlayerMover(0, 0);
const blocked = () => ({ x: wall.x, z: wall.z });
for (let i = 0; i < 20; i++) wall.tick(up, i < 3 ? free(wall) : blocked);
wall.tick(none, blocked);
assert.equal(wall.state, 'stand', 'released against a wall stands');
const back = { lr: 0, fb: -128, cameraYaw: Math.PI, keyboard: false };
const w2 = new PlayerMover(0, 0);
for (let i = 0; i < 20; i++) w2.tick(up, i < 3 ? free(w2) : () => ({ x: w2.x, z: w2.z }));
const zWall = w2.z;
for (let i = 0; i < 6; i++) w2.tick(back, free(w2));
assert.ok(w2.z < zWall - 1, 'turns away from the wall');
// a remote follower reaches its target at 1.5 a tick running, 1.0 walking, never overshooting
const f = { x: 0, z: 0, heading: 0 };
let n = 0;
while (followTick(f, 0, 30, true) && n < 100) n++;
assert.ok(n >= 20 && n <= 24, 'run 30 units: ' + n);
assert.equal(f.z, 30);
const w = { x: 0, z: 0, heading: 0 };
n = 0;
while (followTick(w, 0, 30, false) && n < 100) n++;
assert.ok(n >= 30 && n <= 34, 'walk 30 units: ' + n);
// the slow counts outside the hubs (map ids 0, 15, 18, 45 are exempt, 0x00690344)
for (const area of [0, 15, 18, 45]) assert.equal(slowApplies(area), false, 'hub ' + area);
for (const area of [1, 0x0d, 0x12 + 1, 0x2c, 0x2d + 1]) assert.equal(slowApplies(area), true, 'field ' + area);
// the attack and technique gate is the same table (is_player_in_unsafe_map 0x0068a3fc):
// no attack or technique in a hub (0, 15, 18, 45), both allowed in a field map
for (const area of [0, 15, 18, 45]) assert.equal(inUnsafeMap(area), false, 'hub gate ' + area);
for (const area of [1, 0x0d, 0x12 + 1, 0x2c, 0x2d + 1]) assert.equal(inUnsafeMap(area), true, 'field gate ' + area);
// the guard stance: hunters (classes 0, 1, 2, 9) enter within 50 (d^2 2500) and leave beyond 100 (10000);
// Rangers and Forces enter within 100 (10000) and leave beyond 150 (22500)
assert.deepEqual([...GUARD_HUNTER_CLASSES].sort((a, b) => a - b), [0, 1, 2, 9]);
for (const cls of [0, 1, 2, 9]) {
  assert.equal(guardStance(false, 2499, cls), true, 'hunter enters inside 50 ' + cls);
  assert.equal(guardStance(false, 2500, cls), false, 'hunter does not enter at 50 ' + cls);
  assert.equal(guardStance(true, 10000, cls), true, 'hunter holds at 100 ' + cls);
  assert.equal(guardStance(true, 10001, cls), false, 'hunter leaves beyond 100 ' + cls);
  assert.equal(guardStance(true, 5000, cls), true, 'hunter holds inside 100 ' + cls);
  assert.equal(guardStance(false, 5000, cls), false, 'hunter 70 units away stays off ' + cls);
}
for (const cls of [3, 4, 5, 6, 7, 8, 10, 11]) {
  assert.equal(guardStance(false, 9999, cls), true, 'other enters inside 100 ' + cls);
  assert.equal(guardStance(false, 10000, cls), false, 'other does not enter at 100 ' + cls);
  assert.equal(guardStance(true, 22500, cls), true, 'other holds at 150 ' + cls);
  assert.equal(guardStance(true, 22501, cls), false, 'other leaves beyond 150 ' + cls);
  assert.equal(guardStance(true, null, cls), false, 'no target drops the stance ' + cls);
}
assert.equal(guardStance(false, 60 * 60, 0), false, 'a hunter 60 away is not on');
assert.equal(guardStance(false, 60 * 60, 3), true, 'a ranger 60 away is on');
// the mover: the slow and the guard set its step (walk 1.0 a tick); from rest the first tick moves the full leg speed
{
  const mv = new PlayerMover(0, 0);
  mv.slowed = true;
  mv.tick(up, free(mv));
  assert.equal(mv.z, 0.5, 'slowed walk moves 0.5 a tick');
  const g = new PlayerMover(0, 0);
  g.setGuard(2000, 0);
  assert.equal(g.guard, true);
  g.tick(up, free(g));
  assert.equal(g.z, 0.75, 'guard walk moves 0.75 a tick');
  g.setGuard(null, 0);
  assert.equal(g.guard, false, 'no target clears the guard');
}
// the walk / run frame step: record speed * legSpeed(LOCOMOTION_FACTOR, slowed, guard)
assert.equal(legSpeed(1.0, false, false), 1);
assert.equal(legSpeed(1.5, false, false), 1.5);
assert.equal(legSpeed(1.5, true, false), 0.75);
assert.equal(legSpeed(1.5, false, true), 1.125);
assert.equal(legSpeed(1.0, true, true), 0.5, 'slowed beats guard');

// Remote follower (render side): dead reckoning while the packet says moving.
{
  // Moving, at the leg point: carries on along the leg direction, every tick moves.
  const f = { x: 0, z: 0, heading: 0 };
  const dir = { x: 0, z: 1 };
  let moved = 0;
  for (let i = 0; i < 40; i++) {
    const before = f.z;
    if (remoteStep(f, { x: 0, z: 0 }, false, true, dir)) moved++;
    assert.ok(f.z - before > 0.5, `tick ${i} moves on: ${f.z - before}`);
  }
  assert.equal(moved, 40);
  assert.ok(Math.abs(f.z - 40 * 1.0) < 1e-6, 'walks at 1.0 a tick');
}
{
  // Stopped and ahead of the stop point: jumps back to it, no step backwards.
  const f = { x: 0, z: 3, heading: 0 };
  assert.equal(remoteStep(f, { x: 0, z: 0 }, false, false, { x: 0, z: 1 }), true);
  assert.deepEqual([f.x, f.z], [0, 0]);
  // Stopped on the point: nothing moves.
  assert.equal(remoteStep(f, { x: 0, z: 0 }, false, false, { x: 0, z: 1 }), false);
  // Stopped and behind: walks up at the normal speed.
  const g = { x: 0, z: -5, heading: 0 };
  assert.equal(remoteStep(g, { x: 0, z: 0 }, false, false, { x: 0, z: 1 }), true);
  assert.ok(Math.abs(g.z - (-5 + 1.0)) < 1e-6);
}
{
  // The mover's legs are counted: one 6x40 / 6x42 per leg, aimed 8 ahead.
  const m = new PlayerMover(0, 0);
  const pushing = { lr: 0, fb: 128, cameraYaw: 0, keyboard: true };
  const noMove = (dx: number, dz: number) => ({ x: dx, z: dz });
  let serial = m.legSerial;
  m.tick(pushing, (dx, dz) => ({ x: m.x + dx, z: m.z + dz }));
  assert.equal(m.legSerial, serial + 1, 'the first tick starts a leg');
  const end = m.legEnd();
  assert.ok(Math.abs(Math.hypot(end.x, end.z) - 8) < 1e-6, 'the leg point is 8 ahead');
  void noMove;
  serial = m.legSerial;
  for (let i = 0; i < 3; i++) m.tick(pushing, (dx, dz) => ({ x: m.x + dx, z: m.z + dz }));
  assert.equal(m.legSerial, serial, 'no new leg before the arrival');
}
console.log('playermove: ok');

// The move-start tick (UpdatePlayerVelocity_0069babc, dump line 581618): a walk from
// a stand moves the full step along the input direction and leaves the heading as
// it was; the next tick smooths the heading toward the leg (half of the turn when
// it is 0x3000 or more away) and moves half way round.
{
  const s = new PlayerMover(0, 0);
  const east = { lr: 0, fb: 128, cameraYaw: -Math.PI / 2, keyboard: false }; // forward = +x
  s.tick(east, free(s));
  assert.equal(s.state, 'walk');
  assert.ok(Math.abs(s.x - 1.0) < 1e-9 && Math.abs(s.z) < 1e-9, 'launch tick moves 1.0 along the input');
  assert.equal(s.heading, 0, 'launch tick does not smooth the heading');
  s.tick(east, free(s));
  assert.equal(s.heading, 0x2000, 'second tick: heading half way to the leg (0x4000)');
  assert.ok(Math.abs(s.x - (1.0 + Math.sin((0x3000 / 0x10000) * Math.PI * 2))) < 1e-9, 'second tick moves along the half-way angle');
}

// The keyboard direction against the exe (unknown_handle_gamepad_input_move, dump line
// 587209): the target heading is the camera yaw plus fpatan(lr, fb) (atan2(lr, fb)), with
// the camera yaw g_pDefaultNPCCameraState->field_0x94 = y_rotation (apply_camera_angle_rotations,
// dump line 254525: atan2 of the direction from the camera's target to its source). The exe's
// fb is negative for forward (get_input_movement_speed, dump line 667077: move_forwards sets
// -move_speed, move_left the negative lr, move_right the positive), so the port's forward-positive
// fb is the exe's fb with the sign flipped. Checked by the leg direction of the launch tick.
{
  const yaws = [0, 0.7, Math.PI / 2, 2.5, -2.0];
  const keys: Array<[number, number]> = [[0, 128], [0, -128], [128, 0], [-128, 0], [96, 64], [-64, 128]];
  for (const yaw of yaws) {
    for (const [lr, fb] of keys) {
      const m = new PlayerMover(0, 0);
      m.tick({ lr, fb, cameraYaw: yaw, keyboard: false }, free(m));
      const exeHeading = yaw + Math.atan2(lr, -fb);
      const dir = Math.atan2(m.x, m.z);
      const diff = Math.atan2(Math.sin(dir - exeHeading), Math.cos(dir - exeHeading));
      assert.ok(Math.abs(diff) < 2e-4, `yaw ${yaw} lr ${lr} fb ${fb}: leg ${dir} vs exe ${exeHeading}`);
    }
  }
  // Forward is away from the camera (the camera sits at yaw, looking back at the player),
  // right is screen right (camera looking along -(sin yaw, cos yaw): right = (cos yaw, -sin yaw)).
  const fwd = new PlayerMover(0, 0);
  fwd.tick({ lr: 0, fb: 128, cameraYaw: 0, keyboard: false }, free(fwd));
  assert.ok(fwd.z < -0.99 && Math.abs(fwd.x) < 1e-9, 'forward with the camera at yaw 0 runs to -z (away from the camera at +z)');
  const right = new PlayerMover(0, 0);
  right.tick({ lr: 128, fb: 0, cameraYaw: 0, keyboard: false }, free(right));
  assert.ok(right.x > 0.99 && Math.abs(right.z) < 1e-9, 'right with the camera at yaw 0 runs to +x');
}
// The run gate: a stick runs by its amount (unknown_handle_gamepad_input_move, the
// amount > 0.1 branch, dump line 587209: amount 0.78 is above 0.75), the keys by the
// sum of squares (0.61 here, so they only walk).
const padFwd = { lr: 0, fb: 100, cameraYaw: Math.PI, keyboard: false };
const padRun = new PlayerMover(0, 0);
for (let i = 0; i < 40; i++) padRun.tick(padFwd, free(padRun));
assert.equal(padRun.state, 'run', 'a stick at amount 0.78 runs');
const keyWalk = new PlayerMover(0, 0);
for (let i = 0; i < 40; i++) keyWalk.tick({ ...padFwd, keyboard: true }, free(keyWalk));
assert.equal(keyWalk.state, 'walk', 'the same deflection on the keys walks (sum of squares 0.61)');
// The camera input gate (0x0070a6c4..0x0070a750): X = camera != 1; the function returns before
// any axis is written when X is set and a key of the table is held. Re-read from objdump: the
// getter 0x007917b8 is `movzx eax, byte [0x009ff3d4]`, `cmp eax, 1`, `je 0x70aab7` (camera 1 gives
// X = 0), and the held branch 0x70aaa3 sets ebp = 1 then `test eax / je 0x70a751` / `test ebp /
// je 0x70a751` / 0x70a74c `ret`, so the return needs X != 0 and a held key.
assert.equal(rampFrozen(true, true), false, 'camera input on: a held key still ramps');
assert.equal(rampFrozen(true, false), false, 'camera input on, no key: the ramp runs');
assert.equal(rampFrozen(false, false), false, 'keys off with no key held: the auto move ramp still runs');
assert.equal(rampFrozen(false, true), true, 'keys off (a menu) and a key held: the axes are frozen');
// The six-key table (0x70a6da array 0..5 -> the enum move_forwards..autowalk): the held test is any of the six.
assert.deepEqual([...CAMERA_GATE_ACTIONS], ['moveForward', 'moveBackward', 'moveLeft', 'moveRight', 'autorun', 'autowalk'], 'the exe table order 0..5');
assert.equal(cameraGateKeyHeld((a) => a === 'autorun'), true, 'a held autorun key counts (table index 4)');
assert.equal(cameraGateKeyHeld((a) => a === 'autowalk'), true, 'a held autowalk key counts (table index 5)');
assert.equal(cameraGateKeyHeld(() => false), false, 'no key of the six held: the gate passes');
{
  // The frozen axis keeps its value across a skipped poll and ramps again from it once free.
  let f = rampAxis(0, false, true, false);
  f = rampAxis(f, false, true, false);
  assert.equal(f, 64);
  const frozen = rampFrozen(false, true);
  if (!frozen) f = rampAxis(f, false, true, false);
  assert.equal(f, 64, 'the menu poll writes nothing');
  f = rampAxis(f, false, true, false);
  assert.equal(f, 96, 'after the menu, a key still held ramps from the frozen 64');
}
console.log('playermove exe keyboard mapping: ok');
