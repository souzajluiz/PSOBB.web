// Quest editor: coordinate helpers. Entities store their position relative to
// their section (formats/setdata.ts); the 3D view works in world space.

import { sectionToWorld, type SectionTransform, type Vec3 } from '../formats/setdata.ts';

export const BAMS_FULL = 0x10000;
export const bamsToDegrees = (bams: number): number => (bams * 360) / BAMS_FULL;
export const degreesToBams = (deg: number): number => Math.round((deg * BAMS_FULL) / 360);
// Wraps a BAMS angle into 0..0xFFFF.
export const wrapBams = (bams: number): number => ((Math.round(bams) % BAMS_FULL) + BAMS_FULL) % BAMS_FULL;

// The inverse of sectionToWorld: the game rotates about X, then Z, then Y and
// translates, so this translates back and undoes Y, Z, X.
export function worldToSection(section: SectionTransform, w: Vec3): Vec3 {
  let x = w[0] - section.position[0];
  let y = w[1] - section.position[1];
  let z = w[2] - section.position[2];
  const [ax, ay, az] = section.rotation;
  if (ay) [x, z] = [x * Math.cos(ay) - z * Math.sin(ay), x * Math.sin(ay) + z * Math.cos(ay)];
  if (az) [x, y] = [x * Math.cos(az) + y * Math.sin(az), -x * Math.sin(az) + y * Math.cos(az)];
  if (ax) [y, z] = [y * Math.cos(ax) + z * Math.sin(ax), -y * Math.sin(ax) + z * Math.cos(ax)];
  return [x, y, z];
}

// The section whose origin is nearest to a world point in the horizontal plane
// (the sections of a map are rooms laid out around their origins).
export function nearestSection<T extends SectionTransform>(sections: readonly T[], w: Vec3): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const s of sections) {
    const d = (s.position[0] - w[0]) ** 2 + (s.position[2] - w[2]) ** 2;
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export { sectionToWorld };
