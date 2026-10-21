// Particle colour slopes (classic/particles.ts particleShade): a type 0
// particle reads +0x6c / +0x70 / +0x74 (update_particle_effect_single_particle,
// 0x0050dbb8, `fmul [ecx+0x6c]` at 0x0050df88); a type 1 ring reads +0x50 /
// +0x38 / +0x3c (ParticleEffectInstance_Update_0050f3fc, `fmul [ecx+0x50]` at
// 0x0050f9cf, `[ecx+0x38]` at 0x0050f9f5, `[ecx+0x3c]` at 0x0050fa1e). Both
// add the bases +0x7c / +0x80 / +0x84 with instance flag 0x100 clear.
// The decoy fields in each entry must not be read for the other kind.
// Run: node tests/particleslope.test.ts

import { particleShade, parseParticleEntry } from '../client/src/classic/particles.ts';
import type { Particle } from '../client/src/classic/particles.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
  } else console.log(`ok   ${what}`);
};

// Values are exact in float32 so the comparison can be strict.
function entry(kind: number, slopes: [number, number, number], bases: [number, number, number], decoy: number) {
  const dat = new Uint8Array(0x98);
  const dv = new DataView(dat.buffer);
  const f = (o: number, v: number) => dv.setFloat32(o, v, true);
  dv.setInt32(0x10, kind, true);
  // The slopes of the other kind are a decoy.
  f(0x6c, kind === 0 ? slopes[0] : decoy); f(0x70, kind === 0 ? slopes[1] : decoy); f(0x74, kind === 0 ? slopes[2] : decoy);
  f(0x50, kind === 1 ? slopes[0] : decoy); f(0x38, kind === 1 ? slopes[1] : decoy); f(0x3c, kind === 1 ? slopes[2] : decoy);
  f(0x7c, bases[0]); f(0x80, bases[1]); f(0x84, bases[2]);
  return parseParticleEntry(dat, 0);
}

function particleAt(kind: number, e: ReturnType<typeof entry>, age: number): Particle {
  const q: Particle = { e: { entry: e, pos: [0, 0, 0], rotX: 0, acc: 0 }, p: [0, 0, 0], v: [0, 0, 0], step: [0, 0, 0], size: 1, age, dt: 0.1, angle: 0, spinSign: 0 };
  if (kind === 1) q.ring = { c: [0, 0, 0], ang: 0, omega: 0, r: 0, rise: 0, dy: 0 };
  return q;
}

const rgb = (kind: number, slopes: [number, number, number], bases: [number, number, number], age: number) =>
  particleShade(particleAt(kind, entry(kind, slopes, bases, 0.875), age)).rgb;

// Type 0: R = 0.5 * 0.5 + 0.125, G = 0.5 * 0.25 + 0.25, B = 0.5 * 0.125 + 0.375.
eq(rgb(0, [0.5, 0.25, 0.125], [0.125, 0.25, 0.375], 0.5), [0.375, 0.375, 0.4375], 'type 0 uses +0x6c / +0x70 / +0x74 and the +0x7c bases');

// Ring: R = 0.5 * 0.25 + 0.125, G = 0.5 * 0.5 + 0.25, B = 0.5 * 0.75 + 0.375.
eq(rgb(1, [0.25, 0.5, 0.75], [0.125, 0.25, 0.375], 0.5), [0.25, 0.5, 0.75], 'ring uses +0x50 / +0x38 / +0x3c and the +0x7c bases');

// The ring's slopes are not the type 0 ones: the same entry values give other colours.
eq(rgb(0, [0.25, 0.5, 0.75], [0, 0, 0], 1) !== rgb(1, [0.25, 0.5, 0.75], [0, 0, 0], 1), true, 'the two kinds read different fields');

// The value is clamped to 0..1 (FUN_0050dbb8 compares with 0.0 and 1.0: 0x00920438, 0x0092043c).
eq(rgb(0, [4, 0, 0], [0, 0, 0], 1)[0], 1, 'a colour above 1 is clamped to 1');

if (failures) {
  console.log(`particleslope: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('particleslope: ALL PASS');
