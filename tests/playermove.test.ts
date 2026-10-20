import assert from 'node:assert/strict';
import { RUN_SPEED, WALK_SPEED, legSpeed, rampAxis, headingStep, velocityAngle, clampAngleStep, PlayerMover, followTick } from '../client/src/render/playermove.ts';

assert.equal(RUN_SPEED, 45);
assert.equal(WALK_SPEED, 30);
assert.equal(legSpeed(1.5, true, false), 0.75);
assert.equal(legSpeed(1.0, false, true), 0.75);
let v = 0;
const seq: number[] = [];
for (let i = 0; i < 5; i++) seq.push((v = rampAxis(v, false, true)));
assert.deepEqual(seq, [32, 64, 96, 128, 128]);
assert.equal(rampAxis(128, false, false), 0);
// 0.1 and 0.75 of the sum of squares / 16384: the third poll runs, the first does not
assert.ok(32 * 32 / 16384 < 0.1 && 64 * 64 / 16384 > 0.1 && 96 * 96 / 16384 < 0.75 + 0.0001 && 128 * 128 / 16384 > 0.75);
assert.equal(headingStep(0, 0x1000), 0x400); // a quarter
assert.equal(headingStep(0, 0x6000), 0x3000); // half when far
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
console.log('playermove: ok');
