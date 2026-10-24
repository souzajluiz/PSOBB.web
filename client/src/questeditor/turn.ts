// Quest editor: the angle math of the rotation gizmo (the ring around the
// selection). Plain logic, no DOM, no three.js. Entities store their angle as
// PSO BAMS (0x10000 = 360 degrees, rotation[1] is the Y angle); the 3D view turns
// a pointer position around the pivot into such an angle.

import { BAMS_FULL, bamsToDegrees, degreesToBams, wrapBams } from './geom.ts';

// Snap step of the gizmo while Shift is held: the stored angle lands on multiples
// of 15 degrees (of the entity's own angle, the same value the inspector shows).
export const TURN_SNAP_DEG = 15;

const TWO_PI = Math.PI * 2;

// Heading of a point seen from a pivot, in radians, in the game's convention:
// atan2(dx, dz), so +Z is 0 and a yaw r is three.js rotation.y = r.
export function pivotAngle(pivotX: number, pivotZ: number, x: number, z: number): number {
  return Math.atan2(x - pivotX, z - pivotZ);
}

// The signed shortest turn from one angle to another, in (-PI, PI]: a pointer
// that crosses the atan2 seam at 180 degrees turns the short way round.
export function shortestTurn(from: number, to: number): number {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d <= -Math.PI) d += TWO_PI;
  return d;
}

// The entity's BAMS angle after the pointer turned from startAngle to angle (both
// from pivotAngle) around the pivot. baseBams is the angle when the drag started,
// so the result never accumulates rounding. With snap the result is the nearest
// multiple of TURN_SNAP_DEG. Always 0..0xffff.
export function turnedBams(baseBams: number, startAngle: number, angle: number, snap: boolean): number {
  const raw = baseBams + (shortestTurn(startAngle, angle) * BAMS_FULL) / TWO_PI;
  if (!snap) return wrapBams(raw);
  const deg = Math.round(bamsToDegrees(raw) / TURN_SNAP_DEG) * TURN_SNAP_DEG;
  return wrapBams(degreesToBams(deg));
}
