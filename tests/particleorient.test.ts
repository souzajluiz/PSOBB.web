// The object angles of create_particle_effect2 (the emitters that the exe turns by the
// object's angles: Foie's flag 2 and 1 entries, Megid's tier 3-5 flag 2 entries) and
// the rotation they give a particle's velocity (classic/particles.ts turnStep,
// orientOfDirection; update_particle_effect_single_particle, the velocity part).
// Evidence (PsoBB.exe, named dump): create_particle_effect2 stores its vec3f as the
// effect's +0x78 / +0x7c / +0x80 (X, Y, Z); update_particle_effect hands those to the
// single particle (field49 X, rot_y Y, field51 Z); the velocity is then
// rotate_vec3f(stack) of rotate_matrix_by_int_angle(Z), maybe_rotate_x(X),
// matrix_rotation_y(Y), and each helper left-multiplies the stack, so v' = Rz Rx Ry v.
// The undirected Foie (TechniqueEntity ctor) and the heading Megid take
// Vector3f_GetAnglesZ(sin, 0, cos) of the heading; the directed Foie and the aimed Megid
// (EffectEntityBase) take 0.
// Run: node tests/particleorient.test.ts

import { ParticleSystem, NO_ORIENT, orientOfDirection, parseParticleEntry, turnStep, type Orient } from '../client/src/classic/particles.ts';
import { foieEmitterOrient, startEmitters, type FireObject } from '../client/src/combat/techfire.ts';
import { MEGID_EMITTERS, MegidOrb } from '../client/src/combat/techlightning.ts';

let failures = 0;
const near = (a: number, b: number, what: string) => {
  if (Math.abs(a - b) > 1e-9) {
    failures++;
    console.log(`FAIL ${what}: got ${a} want ${b}`);
  } else console.log(`ok   ${what}`);
};
const vecNear = (a: readonly number[], b: readonly number[], what: string) => {
  const d = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  if (!(d <= 1e-9)) {
    failures++;
    console.log(`FAIL ${what}: got [${a.map((v) => v.toFixed(6))}] want [${b.map((v) => v.toFixed(6))}]`);
  } else console.log(`ok   ${what}`);
};
const check = (what: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const HALF = Math.PI / 2;

// Vector3f_GetAnglesZ: X = atan2(z, hypot(x, y)), Z = -atan2(x, y), BAMS-rounded.
vecNear(orientOfDirection(0, 0, 1), [HALF, 0, 0], 'GetAnglesZ (0,0,1): X a quarter turn, Z 0');
vecNear(orientOfDirection(1, 0, 0), [0, 0, -HALF], 'GetAnglesZ (1,0,0): Z minus a quarter turn');
vecNear(orientOfDirection(-1, 0, 0), [0, 0, HALF], 'GetAnglesZ (-1,0,0): Z a quarter turn');
vecNear(orientOfDirection(0, 0, -1), [-HALF, 0, 0], 'GetAnglesZ (0,0,-1): X minus a quarter turn');
vecNear(orientOfDirection(Math.SQRT1_2, 0, Math.SQRT1_2), [Math.PI / 4, 0, -HALF], 'GetAnglesZ 45 degrees: X an eighth turn, Z minus a quarter');

// The rotation about each axis.
vecNear(turnStep(NO_ORIENT, [1, 2, 3]), [1, 2, 3], 'no orientation: the velocity is not turned');
vecNear(turnStep([HALF, 0, 0], [0, 1, 0]), [0, 0, 1], 'X a quarter turn: +y goes to +z (Rx)');
vecNear(turnStep([0, 0, HALF], [1, 0, 0]), [0, 1, 0], 'Z a quarter turn: +x goes to +y (Rz)');
vecNear(turnStep([0, HALF, 0], [0, 0, 1]), [1, 0, 0], 'Y a quarter turn: +z goes to +x (Ry)');

// The order is Rz Rx Ry (Ry applied first, Rz last).
vecNear(turnStep([HALF, 0, HALF], [0, 1, 0]), [0, 0, 1], 'X and Z: Rx before Rz (the other order would give -x)');
vecNear(turnStep([HALF, HALF, 0], [0, 1, 0]), [0, 0, 1], 'Y and X: Ry before Rx (the other order would give +x)');

// The general case against an explicit product Rz * Rx * Ry (standard right-handed matrices).
const mul = (a: number[][], b: number[][]) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const rx = (t: number) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const ry = (t: number) => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const rz = (t: number) => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
const apply = (m: number[][], v: number[]) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const angles: Orient[] = [[0.3, -1.1, 2.0], [-2.4, 0.7, 0.5], [1.9, 2.8, -0.6]];
const vs = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.4, -2, 1.5]];
for (const o of angles) {
  const m = mul(mul(rz(o[2]), rx(o[0])), ry(o[1]));
  for (const v of vs) {
    vecNear(turnStep(o, v as [number, number, number]), apply(m, v), `Rz Rx Ry product at [${o.map((x) => x.toFixed(1))}] on [${v}]`);
  }
  const w = turnStep(o, [0.4, -2, 1.5]);
  near(Math.hypot(...w), Math.hypot(0.4, -2, 1.5), `length kept at [${o.map((x) => x.toFixed(1))}]`);
}

// A particle of a create_particle_effect2 emitter steps along its local velocity turned by
// the emitter's angles: vertical speed 2 on +y ends on +z under a quarter turn about X.
{
  const dat = new Uint8Array(0x98);
  const dv = new DataView(dat.buffer);
  const f = (o: number, v: number) => dv.setFloat32(o, v, true);
  f(0x30, 0); f(0x34, 2); f(0x38, 0); f(0x3c, 0); f(0x44, 1);
  dv.setInt32(0x48, 10, true); dv.setInt32(0x4c, 0, true); f(0x50, 1);
  f(0x24, 1); f(0x28, 0); f(0x2c, 1);
  const e = parseParticleEntry(dat, 0);
  const turned = new ParticleSystem();
  turned.add(e, [0, 0, 0], [HALF, 0, 0]);
  turned.step(true);
  vecNear(turned.live[0].step, [0, 0, 2], 'emitter with X a quarter turn: the particle steps along +z');
  const plain = new ParticleSystem();
  plain.add(e, [0, 0, 0], null);
  plain.step(true);
  vecNear(plain.live[0].step, [0, 2, 0], 'emitter with no orientation: the particle steps along +y');
}

// The Foie emitter angles: an undirected Foie at heading h is turned by GetAnglesZ(sin h, 0, cos h);
// a directed one is not turned (EffectEntityBase); flag 1 (0xac) is a half turn more.
const foie = (heading: number, directed: boolean) => ({ heading, directed }) as unknown as FireObject;
vecNear(foieEmitterOrient(foie(0, false), 'object'), [HALF, 0, 0], 'Foie heading 0 (undirected), flag 2: X a quarter turn');
vecNear(foieEmitterOrient(foie(Math.PI / 2, false), 'object'), [0, 0, -HALF], 'Foie heading a quarter turn: Z minus a quarter turn');
vecNear(foieEmitterOrient(foie(0, true), 'object'), [0, 0, 0], 'Foie directed: no angles (EffectEntityBase sets +0x54/+0x5c to 0)');
vecNear(foieEmitterOrient(foie(0, false), 'half'), [HALF + Math.PI, 0, 0], 'Foie flag 1 (0xac), heading 0: X a half turn more');
vecNear(foieEmitterOrient(foie(0, true), 'half'), [Math.PI, 0, 0], 'Foie flag 1 (0xac), directed: X a half turn');

// The Foie table (tier 5): the muzzle burst, then 0x19e (flag 0x1000, no angles), 0x14 and 0x19c (flag 2), 0xac (flag 1).
{
  const kinds = startEmitters('foie', 5).map((e) => `${e.id.toString(16)}:${e.angles ?? '-'}`).join(' ');
  check(`Foie tier 5 emitters [${kinds}]`, kinds === '18:- 19e:- 14:object ac:half 19c:object');
}

// Megid: the tier 3-5 flag 2 entries (0x1c4, and 0x1cf in tier 5) take the object angles.
{
  const angled = MEGID_EMITTERS.map((tier) => tier.filter((e) => e.angles).map((e) => e.id.toString(16)).join(','));
  const joined = angled.join('|');
  check(`Megid angled emitters by tier [${joined}]`, joined === '|||1c4|1c4|1c4,1cf');
}

// The orb's follow event carries the base: the heading's for a flight along the heading, none when aimed.
{
  const along = new MegidOrb({ x: 0, y: 0, z: 0 }, 0, 0, 100, 27, 5, 0);
  const ev = along.events.find((x) => x.t === 'follow');
  vecNear(ev && ev.t === 'follow' ? ev.base : [9, 9, 9], [HALF, 0, 0], 'Megid along heading 0: the event base is the heading angles');
  const aimed = new MegidOrb({ x: 0, y: 0, z: 0 }, 0, 0, 100, 27, 5, 0, { x: 0, y: 0, z: 40 });
  const ev2 = aimed.events.find((x) => x.t === 'follow');
  vecNear(ev2 && ev2.t === 'follow' ? ev2.base : [9, 9, 9], [0, 0, 0], 'Megid aimed: the event base is none');
}

if (failures) {
  console.log(`particleorient: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('particleorient: ALL PASS');
