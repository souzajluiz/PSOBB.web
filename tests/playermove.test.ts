import assert from 'node:assert/strict';
import { RUN_SPEED, WALK_SPEED, legSpeed, rampAxis, headingStep, velocityAngle, clampAngleStep } from '../client/src/render/playermove.ts';

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
console.log('playermove: ok');
