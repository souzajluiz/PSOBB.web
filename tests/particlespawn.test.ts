// The spawn velocity of a type 0 particle (classic/particles.ts spawn, FUN_0050ec4c).
// The exe takes the local velocity (vx, vy, 0) with vx = rand * speed_x + vacume at
// +0x40 and vy = rand * cr_rt + gravity at +0x44, then FUN_007829f4 (0x007829f4)
// rotates the vector's x and z (indices 0 and 2) by a BAMS angle of ROUND(rand * 360 *
// 0x10000 / 360) = 2 * rand (0x0050ec4c: the call at 0x0050ee9c, the rand before it,
// the 0x0092040c = 32768 and 0x00920400 = 65536 constants). The y component is not
// rotated, so a particle with a vertical speed keeps it.
// Run: node tests/particlespawn.test.ts

import { ParticleSystem, parseParticleEntry } from '../client/src/classic/particles.ts';

let failures = 0;
const near = (a: number, b: number, what: string) => {
  if (Math.abs(a - b) > 1e-9) {
    failures++;
    console.log(`FAIL ${what}: got ${a} want ${b}`);
  } else console.log(`ok   ${what}`);
};

// A type 0 entry: vel0 (+0x30, +0x34), velRand (+0x38, +0x3c), life 10 frames, damping 1,
// gravity 0, rate 1 (one particle per step). Values are exact in float32.
function entry(vel0: [number, number], velRand: [number, number]) {
  const dat = new Uint8Array(0x98);
  const dv = new DataView(dat.buffer);
  const f = (o: number, v: number) => dv.setFloat32(o, v, true);
  f(0x30, vel0[0]); f(0x34, vel0[1]);
  f(0x38, velRand[0]); f(0x3c, velRand[1]);
  f(0x44, 1); // rate
  dv.setInt32(0x48, 10, true); // life base
  dv.setInt32(0x4c, 0, true); // life spread
  f(0x50, 1); // damping
  f(0x24, 1); f(0x28, 0); f(0x2c, 1); // size base, spread, growth
  return parseParticleEntry(dat, 0);
}

// The LCG of the exe's _rand (0x343fd, 0x269ec3; the port's rand, seed 1).
function draws(n: number): number[] {
  let seed = 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 214013) + 2531011) | 0;
    out.push(((seed >>> 16) & 0x7fff) / 32768);
  }
  return out;
}

// The first particle of a fresh system. Draws in spawn order: x, z, y, size, life,
// vx, vy, angle (the eight calls before the spin draws).
const d = draws(8);
const vx = d[5] * 4 + 2; // velRand[0] 4, vel0[0] 2
const vy = d[6] * 0 + 3; // velRand[1] 0, vel0[1] 3 (a vertical speed)
const a = d[7] * Math.PI * 2; // BAMS 2 * rand = rand / 32768 of a turn

const sys = new ParticleSystem();
sys.add(entry([2, 3], [4, 0]), [0, 0, 0], 0);
sys.step(true);
const p = sys.live[0];

near(p.v[0], vx * Math.cos(a), 'spawn vx is rotated into x by cos(angle)');
near(p.v[2], -vx * Math.sin(a), 'spawn vx is rotated into z by -sin(angle)');
near(p.v[1], vy, 'spawn vy is not rotated (kept as the vertical speed)');
near(Math.hypot(p.v[0], p.v[2]), vx, 'the rotation keeps the horizontal speed');

// Many particles: every one keeps its vy and its horizontal speed, and the angle
// covers the circle.
const many = new ParticleSystem();
many.add(entry([2, -1.5], [4, 0]), [0, 0, 0], 0);
// vx = rand * 4 + 2 is in [2, 6): the horizontal speed stays in that band.
let minA = Infinity, maxA = -Infinity, badY = 0, badSpeed = 0;
for (let i = 0; i < 200; i++) {
  many.step(true);
  const q = many.live[many.live.length - 1];
  if (q.v[1] !== -1.5) badY++;
  const s = Math.hypot(q.v[0], q.v[2]);
  if (s < 2 || s >= 6) badSpeed++;
  const ang = Math.atan2(-q.v[2], q.v[0]);
  minA = Math.min(minA, ang);
  maxA = Math.max(maxA, ang);
}
near(badY, 0, 'every spawned particle keeps vy = -1.5');
near(badSpeed, 0, 'every spawned particle keeps its horizontal speed in [2, 6)');
near(maxA - minA > 4 ? 1 : 0, 1, 'the spawn angles spread over the circle');

if (failures) {
  console.log(`particlespawn: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('particlespawn: ALL PASS');
