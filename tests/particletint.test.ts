// Particle flag 0x100 colour (classic/particles.ts particleShade). The exe's
// update_particle_effect_single_particle (0x0050dbb8) and the ring update
// (0x0050f3fc) take the base from the instance's own +0x50 when flag 0x100 is set
// (`fadd [ebp+0x50]` at 0x0050def5 / 0x0050e0b4, ring `fadd [esi+0x50]` at
// 0x0050f7b6), not from the entry's +0x7c. The owner's colour dword (SetId,
// 0x00508ee4, stores it at the owner's +0x4c) is never copied into the instance,
// and the instance ctor zeroes +0x50, so the tinted colour is the slope term alone.
// The tint value does not change the colour. Run: node tests/particletint.test.ts

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
function entry(slopeType0: [number, number, number], slopeRing: [number, number, number], bases: [number, number, number], kind: number) {
  const dat = new Uint8Array(0x98);
  const dv = new DataView(dat.buffer);
  const f = (o: number, v: number) => dv.setFloat32(o, v, true);
  dv.setInt32(0x10, kind, true);
  f(0x6c, slopeType0[0]); f(0x70, slopeType0[1]); f(0x74, slopeType0[2]);
  f(0x50, slopeRing[0]); f(0x38, slopeRing[1]); f(0x3c, slopeRing[2]);
  f(0x7c, bases[0]); f(0x80, bases[1]); f(0x84, bases[2]);
  f(0x88, 0); // fade in / out stay at their zero defaults (no fade ramp)
  return parseParticleEntry(dat, 0);
}

function particle(e: ReturnType<typeof entry>, age: number, tint: number | undefined, ring: boolean): Particle {
  const q: Particle = {
    e: { entry: e, pos: [0, 0, 0], orient: null, fx: {}, acc: 0, tint },
    p: [0, 0, 0], v: [0, 0, 0], step: [0, 0, 0], size: 1, age, dt: 0.1, angle: 0, spinSign: 0,
  } as unknown as Particle;
  if (ring) q.ring = { c: [0, 0, 0], ang: 0, omega: 0, r: 0, rise: 0, dy: 0 } as Particle['ring'];
  return q;
}

const slopes: [number, number, number] = [0.5, 0.25, 0.125];
const ringSlopes: [number, number, number] = [0.25, 0.5, 0.75];
const bases: [number, number, number] = [0.125, 0.25, 0.375];

// Untinted (flag 0x100 clear): R = 0.5 * 0.5 + 0.125 at age 0.5, the bases are added.
eq(particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.5, undefined, false)).rgb,
  [0.375, 0.375, 0.4375], 'untinted type 0 adds the entry bases +0x7c');

// Tinted (flag 0x100): the base is the instance's +0x50 (zero), so only t * slope remains.
eq(particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.5, 0xff4dff99, false)).rgb,
  [0.25, 0.125, 0.0625], 'tinted type 0: colour = t * slope, the entry bases are not used');

// The tint value is not read: another colour gives the same colour.
const a = particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.5, 0xff4dff99, false)).rgb;
const b = particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.5, 0xffff9999, false)).rgb;
const c = particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.5, 0xff000000, false)).rgb;
eq([a, b], [c, c], 'the tint colour does not change the tinted colour (0xff4dff99, 0xffff9999, 0xff000000)');

// A tint of 0 is still flag 0x100 (SetId was called): it is not "no tint".
eq(particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.5, 0, false)).rgb, c, 'tint 0 still selects the 0x100 base');

// No tint (undefined) is the only untinted state.
eq(particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.5, undefined, false)).rgb !== c, true,
  'undefined tint keeps the entry bases');

// Ring (type 1): slope +0x50 / +0x38 / +0x3c, the same base rule.
eq(particleShade(particle(entry(slopes, ringSlopes, bases, 1), 0.5, undefined, true)).rgb,
  [0.25, 0.5, 0.75].map((s, i) => 0.5 * s + bases[i]!), 'untinted ring adds the entry bases +0x7c');
eq(particleShade(particle(entry(slopes, ringSlopes, bases, 1), 0.5, 0xff337fff, true)).rgb,
  [0.125, 0.25, 0.375], 'tinted ring: colour = t * ring slope');

// Clamp to 0..1 (the exe compares with 0.0 and 1.0): a tinted colour above 1 is 1, below 0 is 0.
eq(particleShade(particle(entry([4, -4, 0], ringSlopes, bases, 0), 1, 0xff000000, false)).rgb, [1, 0, 0], 'tinted colour is clamped to 0..1');

// The fade is not changed by the tint.
eq(particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.25, 0xff000000, false)).fade,
  particleShade(particle(entry(slopes, ringSlopes, bases, 0), 0.25, undefined, false)).fade, 'the fade is the same tinted or not');

if (failures) {
  console.log(`particletint: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('particletint: ALL PASS');
