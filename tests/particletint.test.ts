// Particle flag 0x100 colour (classic/particles.ts particleShade). The owner's SetId
// colour (ARGB at the owner's +0x4c) is copied at spawn by the block 0x00509170..0x00509237
// into the instance as floats: +0x4c alpha, +0x50 R, +0x54 G, +0x58 B, each / 255. The
// update (0x0050dbb8, ring 0x0050f3fc) then uses +0x50..+0x58 as the colour base in place
// of the entry's +0x7c..+0x84: rgb = clamp(t * slope + tint RGB). Run: node tests/particletint.test.ts

import { particleShade, parseParticleEntry } from '../client/src/classic/particles.ts';
import type { Particle } from '../client/src/classic/particles.ts';

let failures = 0;
const near = (a: number[], b: number[], what: string) => {
  const ok = a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 1e-6);
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
  } else console.log(`ok   ${what}`);
};
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
  } else console.log(`ok   ${what}`);
};

// Values are exact in float32 so the comparison can be strict for the entry fields.
function entry(slopeType0: [number, number, number], slopeRing: [number, number, number], bases: [number, number, number], kind: number) {
  const dat = new Uint8Array(0x98);
  const dv = new DataView(dat.buffer);
  const f = (o: number, v: number) => dv.setFloat32(o, v, true);
  dv.setInt32(0x10, kind, true);
  f(0x6c, slopeType0[0]); f(0x70, slopeType0[1]); f(0x74, slopeType0[2]);
  f(0x50, slopeRing[0]); f(0x38, slopeRing[1]); f(0x3c, slopeRing[2]);
  f(0x7c, bases[0]); f(0x80, bases[1]); f(0x84, bases[2]);
  return parseParticleEntry(dat, 0);
}

function particle(e: ReturnType<typeof entry>, age: number, tint: number | undefined, ring: boolean): Particle {
  const q = {
    e: { entry: e, pos: [0, 0, 0], orient: null, fx: {}, acc: 0, tint },
    p: [0, 0, 0], v: [0, 0, 0], step: [0, 0, 0], size: 1, age, dt: 0.1, angle: 0, spinSign: 0,
  } as unknown as Particle;
  if (ring) q.ring = { c: [0, 0, 0], ang: 0, omega: 0, r: 0, rise: 0, dy: 0 } as Particle['ring'];
  return q;
}

const slopes: [number, number, number] = [0.5, 0.25, 0.125];
const ringSlopes: [number, number, number] = [0.25, 0.5, 0.75];
const bases: [number, number, number] = [0.125, 0.25, 0.375];
const rgbOf = (tint: number | undefined, age: number, ring = false, kind = ring ? 1 : 0) =>
  particleShade(particle(entry(slopes, ringSlopes, bases, kind), age, tint, ring)).rgb;

// Untinted (flag 0x100 clear): the entry bases +0x7c are added: R = 0.5 * 0.5 + 0.125.
near(rgbOf(undefined, 0.5), [0.375, 0.375, 0.4375], 'untinted type 0 adds the entry bases +0x7c');

// Tinted: the base is the tint RGB (+0x50 / +0x54 / +0x58), the entry bases are not used.
// Anti 0xff4dff99 at age 0.5: R = 0.25 + 0x4d/255, G = 0.125 + 1, B = 0.0625 + 0x99/255.
near(rgbOf(0xff4dff99, 0.5), [0.25 + 0x4d / 255, 1, 0.0625 + 0x99 / 255], 'tinted type 0 (Anti): clamp(t * slope + tint RGB)');

// At age 0 the colour is the tint itself: Shifta 0xffff9999 is red-dominant, Deband 0xff337fff blue.
near(rgbOf(0xffff9999, 0), [1, 0x99 / 255, 0x99 / 255], 'Shifta at birth is the tint (red-dominant)');
near(rgbOf(0xff337fff, 0), [0x33 / 255, 0x7f / 255, 1], 'Deband at birth is the tint (blue-dominant)');

// The alpha byte is not a colour channel (it is the +0x4c factor, not modelled here).
near(rgbOf(0x00337fff, 0), rgbOf(0xff337fff, 0), 'the alpha byte does not change the RGB base');

// Tint 0 is still flag 0x100 (SetId was called with black): base 0, not the entry base.
near(rgbOf(0, 0.5), [0.25, 0.125, 0.0625], 'tint 0 selects the 0x100 path (base 0)');

// No tint (undefined) is the only untinted state.
eq(rgbOf(undefined, 0.5)[0] !== rgbOf(0, 0.5)[0], true, 'undefined tint keeps the entry bases');

// Ring (type 1): slope +0x50 / +0x38 / +0x3c, the same base rule.
near(rgbOf(undefined, 0.5, true), [0.25 * 0.5 + 0.125, 0.5 * 0.5 + 0.25, 0.75 * 0.5 + 0.375], 'untinted ring adds the entry bases +0x7c');
near(rgbOf(0xff337fff, 0.5, true), [0.25 * 0.5 + 0x33 / 255, 0.5 * 0.5 + 0x7f / 255, Math.min(1, 0.75 * 0.5 + 1)], 'tinted ring: clamp(t * ring slope + tint RGB)');

// Clamp to 0..1 (the exe compares with 0.0 and 1.0): above 1 is 1, below 0 is 0.
near(particleShade(particle(entry([4, -4, 0], ringSlopes, bases, 0), 1, 0xff000000, false)).rgb, [1, 0, 0], 'tinted colour is clamped to 0..1');

// The fade is not changed by the tint.
eq(particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.25, 0xff000000, false)).fade,
  particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.25, undefined, false)).fade, 'the fade is the same tinted or not');

if (failures) {
  console.log(`particletint: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('particletint: ALL PASS');
