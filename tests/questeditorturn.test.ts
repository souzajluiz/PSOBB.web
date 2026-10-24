// Quest editor: the rotation gizmo's angle math (client/src/questeditor/turn.ts):
// a pointer angle around the pivot becomes a PSO BAMS angle, across the atan2 seam
// the short way round, wrapped to 0..0xffff, and snapped to 15 degrees with Shift.
//
// Run: node tests/questeditorturn.test.ts
import { BAMS_FULL, degreesToBams } from '../client/src/questeditor/geom.ts';
import { pivotAngle, shortestTurn, turnedBams } from '../client/src/questeditor/turn.ts';

let failures = 0;
let checks = 0;
const check = (cond: boolean, msg: string) => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (a: unknown, b: unknown, msg: string) => check(a === b, `${msg}: ${String(a)} != ${String(b)}`);
const deg = (d: number) => (d * Math.PI) / 180;

// The heading convention: +Z is 0, +X is a quarter turn, the same as three.js rotation.y.
eq(pivotAngle(0, 0, 0, 5), 0, 'pivot angle: +Z is 0');
eq(pivotAngle(0, 0, 5, 0), Math.PI / 2, 'pivot angle: +X is a quarter turn');
eq(pivotAngle(10, 10, 10, -3), Math.PI, 'pivot angle: -Z from the pivot is half a turn');

// A drag of 90 degrees is a quarter turn in PSO units (0x4000).
eq(turnedBams(0, pivotAngle(0, 0, 0, 1), pivotAngle(0, 0, 1, 0), false), 0x4000, 'drag +90 degrees: 0x4000');
eq(turnedBams(0, pivotAngle(0, 0, 0, 1), pivotAngle(0, 0, -1, 0), false), 0xc000, 'drag -90 degrees: wraps to 0xc000');
eq(turnedBams(0x1234, 1, 1, false), 0x1234, 'no drag keeps the angle');

// Drag amounts are relative to the press, not accumulated: the same pointer angle gives the same result.
{
  const base = 0x7000;
  const a = turnedBams(base, 0.2, 0.9, false);
  const b = turnedBams(base, 0.2, 0.9, false);
  eq(a, b, 'the drag is a function of the press and the pointer only');
  eq(a, Math.round(base + ((0.7 * BAMS_FULL) / (Math.PI * 2))) % BAMS_FULL, 'drag 0.7 rad from 0x7000');
}

// The atan2 seam: from 170 degrees to -170 degrees is a turn of +20 degrees, not -340.
eq(shortestTurn(deg(170), deg(-170)) > 0, true, 'seam: crossing 180 degrees turns the short way');
eq(Math.abs(shortestTurn(deg(170), deg(-170)) - deg(20)) < 1e-9, true, 'seam: 170 to -170 is +20 degrees');
eq(turnedBams(0x8000, deg(170), deg(-170), false), Math.round(0x8000 + (deg(20) * BAMS_FULL) / (Math.PI * 2)), 'seam: BAMS turn of +20 degrees');
eq(Math.abs(shortestTurn(deg(-179), deg(179))) < deg(3), true, 'seam: -179 to 179 is 2 degrees');

// Wrap past 0xffff: 0xfff0 plus 2 degrees (364.09 BAMS) is 348.
eq(turnedBams(0xfff0, 0, deg(2), false), 348, 'wrap: 0xfff0 plus 2 degrees wraps past 0xffff');
// Wrap below 0: 0 minus 2 degrees is 0xffff minus 364.
eq(turnedBams(0, 0, deg(-2), false), 0x10000 - 364, 'wrap: 0 minus 2 degrees goes to the top of the range');

// Snap to 15 degrees (Shift). The stored angle lands on multiples of 15 degrees.
eq(turnedBams(0, 0, deg(7), true), degreesToBams(0), 'snap: 7 degrees rounds down to 0');
eq(turnedBams(0, 0, deg(8), true), degreesToBams(15), 'snap: 8 degrees rounds up to 15');
eq(turnedBams(0, 0, deg(20), true), degreesToBams(15), 'snap: 20 degrees is 15');
eq(turnedBams(0, 0, deg(-20), true), degreesToBams(-15) + BAMS_FULL, 'snap: -20 degrees is -15, wrapped');
eq(turnedBams(0, 0, deg(-20), true), 0x10000 - 2731, 'snap: -15 degrees is 0xffff minus 2731 (15 degrees of BAMS)');
eq(turnedBams(degreesToBams(45), 0, deg(-20), true), degreesToBams(30), 'snap: from 45 degrees, -20 degrees lands on 30');
eq(turnedBams(0, 0, deg(179), true), degreesToBams(180), 'snap: 179 degrees lands on 180');
eq(turnedBams(0x8000, deg(179), deg(-179), true), degreesToBams(180), 'snap across the seam: 180 degrees stays 180');
for (let k = 0; k < 24; k++) {
  const d = turnedBams(0, 0, deg(k * 15), true);
  check(d >= 0 && d < BAMS_FULL, `snap: ${k * 15} degrees is in range`);
}

// Every result is in range.
for (let i = 0; i < 360; i++) {
  const v = turnedBams(i * 181, deg(i) - 0.4, deg(-i * 3), i % 2 === 0);
  check(Number.isInteger(v) && v >= 0 && v < BAMS_FULL, `range: step ${i} gives ${v}`);
}

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
