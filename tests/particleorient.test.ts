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
// Also (update_particle_effect_single_particle, dump line 291383): particle flag 2 runs
// the helpers X, Y, Z (v' = Rx Ry Rz v); flag 0x20 multiplies the particle's own matrix
// in first (out = M^T ... v); the table's 0x1000 is particle flag 0x2000, which spawn
// destroys (dump line 288330) and the single particle update never submits (dump 291923).
// Run: node tests/particleorient.test.ts

import { NT_FLAGS, ParticleSystem, NO_ORIENT, modelOpaquePassSkipped, modelParticleBlend, orientOfDirection, parseParticleEntry, particleIsNt, turnStep, type Orient } from '../client/src/classic/particles.ts';
import { RAFOIE_MARK_FIXED, RAFOIE_MARK_LIST, RafoieBlast, RafoieSphere, emitterFx, objectEmitterOrient, rafoieBlastEmitters, sphereTurnRad, startEmitters, type FireKind, type FireObject, type FxEmitter, type TechTarget } from '../client/src/combat/techfire.ts';
import { MEGID_EMITTERS, MegidOrb } from '../client/src/combat/techlightning.ts';
import { advancedEffectsOn, setAdvancedEffects } from '../client/src/render/advancedeffects.ts';

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
vecNear(objectEmitterOrient(foie(0, false), 'object'), [HALF, 0, 0], 'Foie heading 0 (undirected), flag 2: X a quarter turn');
vecNear(objectEmitterOrient(foie(Math.PI / 2, false), 'object'), [0, 0, -HALF], 'Foie heading a quarter turn: Z minus a quarter turn');
vecNear(objectEmitterOrient(foie(0, true), 'object'), [0, 0, 0], 'Foie directed: no angles (EffectEntityBase sets +0x54/+0x5c to 0)');
vecNear(objectEmitterOrient(foie(0, false), 'half'), [HALF + Math.PI, 0, 0], 'Foie flag 1 (0xac), heading 0: X a half turn more');
vecNear(objectEmitterOrient(foie(0, true), 'half'), [Math.PI, 0, 0], 'Foie flag 1 (0xac), directed: X a half turn');

// The emitter tables by kind: the angles (object, or half for flag 1) and the hidden ones (flag 0x1000).
// A model entry (the table's flag 0x20) is marked $chunk, with m<motion> when it has a motion.
const kindsOf = (k: FireKind, tier: number) =>
  startEmitters(k, tier)
    .map((e) => `${e.id.toString(16)}:${e.angles ?? '-'}${e.hidden ? '!' : ''}${e.model ? `$${e.model.chunk}${e.model.motion === null ? '' : `m${e.model.motion}`}` : ''}`)
    .join(' ');

// The Foie table (tier 5): the muzzle burst, then 0x19e (flag 0x1000: hidden, no angles), 0x14 and 0x19c (flag 2), 0xac (flag 1).
{
  const kinds = kindsOf('foie', 5);
  check(`Foie tier 5 emitters [${kinds}]`, kinds === '18:- 19e:-! 14:object ac:half 19c:object');
}

// Barta (flag 2 and 1 entries take the angles, 0x192 is flag 0 and is not turned) and Gibarta (flag 2 0x181 is turned).
{
  const b0 = kindsOf('barta', 0), b3 = kindsOf('barta', 3), g0 = kindsOf('gibarta', 0), g5 = kindsOf('gibarta', 5);
  check(`Barta tier 0 emitters [${b0}]`, b0 === '190:object 191:object 192:-');
  check(`Barta tier 3 emitters [${b3}]`, b3 === '190:object 191:object 192:- 198:half');
  check(`Gibarta tier 0 emitters [${g0}]`, g0 === '180:- 181:object 182:object$2');
  check(`Gibarta tier 5 emitters [${g5}]`, g5 === '181:object 18e:object$3 1e0:- 1e1:-');
  // Gibarta's model chunk is the table flags' high word (0x20022 / 0x20062 -> 2, 0x30062 -> 3); no motion.
  const gChunks = [0, 1, 2, 3, 4].map((t) => kindsOf('gibarta', t).split(' ').filter((x) => x.includes('$')).join(' ')).join(' | ');
  check(`Gibarta model entries by tier [${gChunks}]`, gChunks === '182:object$2 | 183:object$2 | 184:object$2 | 185:object$3 | 186:object$3');
  // Barta tier 5: 0x193 / 0x1d8 / 0x1d7 (flag 0x20, no angles), njcm chunk 0 and njm 0 (dump 640489).
  const b5 = kindsOf('barta', 5);
  check(`Barta tier 5 emitters [${b5}]`, b5 === '190:object 191:object 192:- 198:half 193:-$0m0 1d8:-$0m0 1d7:-$0m0');
  const rabarta = [0, 1, 2, 3, 4, 5].map((t) => kindsOf('rabarta', t)).join(' | ');
  check('Rabarta: no emitter has angles (create_particle_effect3 only)', !/object|half/.test(rabarta));
  // Rabarta's flag 0x20 entries (decoded from the table at 0x0096dc6c): chunk = flags >> 16, no motion (dump 649746).
  const rModels = [0, 1, 2, 3, 4, 5].map((t) => kindsOf('rabarta', t).split(' ').filter((x) => x.includes('$')).join(' ')).join(' | ');
  check(`Rabarta model entries by tier [${rModels}]`, rModels === '1df:-$2 | 194:-$2 | 195:-$2 | 199:-$3 | 19a:-$3 | 19b:-$4 1d6:-$1m1');
  // Tier 5's one-shot 0x1d6: model chunk 1 with motion 1 (get_njm_chunk(bml, 1)), 5 above the point (g_RabartaParticleEffectYOffset 5.0).
  const r1d6 = startEmitters('rabarta', 5).find((e) => e.id === 0x1d6)!;
  check('Rabarta tier 5 0x1d6: burst, dy 5, model chunk 1 motion 1', r1d6.mode === 'burst' && r1d6.dy === 5 && JSON.stringify(emitterFx(r1d6).model) === '{"chunk":1,"motion":1,"speed":1}');
  check('Rabarta tier 0 model 0x1df: fixed, no motion, speed 1', (() => {
    const e = startEmitters('rabarta', 0).find((x) => x.id === 0x1df)!;
    return e.mode === 'fixed' && JSON.stringify(emitterFx(e).model) === '{"chunk":2,"motion":null,"speed":1}';
  })());
  // Rafoie's ring 0x1a: the fixed form makes it first (then 0x3a, 0x3b); the list form makes 0x39 then the ring.
  const ring = (es: readonly FxEmitter[]) => es.map((e) => `${e.id.toString(16)}${e.model ? `$${e.model.chunk}` : ''}`).join(' ');
  check(`Rafoie fixed marks [${ring(RAFOIE_MARK_FIXED)}]`, ring(RAFOIE_MARK_FIXED) === '1a$9 3a 3b');
  check(`Rafoie list marks [${ring(RAFOIE_MARK_LIST)}]`, ring(RAFOIE_MARK_LIST) === '39 1a$9');
  check('Rafoie ring: model chunk 9, no motion, speed 1', JSON.stringify(emitterFx(RAFOIE_MARK_FIXED[0]!).model) === '{"chunk":9,"motion":null,"speed":1}');
  // Rafoie's blast tier 5: 0x1e2 has flag 0x1000 (hidden; the table rafoie_and_bazooka_particles at 0x0096dd6c, tier 5 at 0x0096dd00).
  const blast5 = rafoieBlastEmitters(5);
  check('Rafoie blast tier 5: 0x1e2 is hidden', blast5.find((e) => e.id === 0x1e2)?.hidden === true && blast5.filter((e) => e.hidden).length === 1);
  check('Rafoie blast tier 5: the 0x1e2 particle is noDraw', emitterFx(blast5.find((e) => e.id === 0x1e2)!).noDraw === true);
  // The model particle's blend (SetColor_00508958): SRCALPHA / INVSRCALPHA when non-NT, SRCALPHA / ONE when NT.
  check('model blend, non-NT: SRCALPHA / INVSRCALPHA (5 / 6)', JSON.stringify(modelParticleBlend(false)) === '{"src":5,"dst":6}');
  check('model blend, NT: SRCALPHA / ONE (5 / 2)', JSON.stringify(modelParticleBlend(true)) === '{"src":5,"dst":2}');
  // Barta / Gibarta object angles: the heading's when undirected, none when aimed (EffectEntityBase).
  vecNear(objectEmitterOrient({ heading: 0, directed: false } as unknown as FireObject, 'object'), [HALF, 0, 0], 'Barta / Gibarta heading 0: X a quarter turn');
  vecNear(objectEmitterOrient({ heading: 0, directed: true } as unknown as FireObject, 'half'), [Math.PI, 0, 0], 'Barta / Gibarta aimed, flag 1: X a half turn only');
}

// The hidden emitters: Foie 0x19e and Megid 0x1cf carry particle flag 0x2000 (noDraw); the rest do not.
check('emitterFx: a hidden emitter is noDraw', emitterFx(startEmitters('foie', 5)[1]).noDraw === true);
check('emitterFx: a visible emitter has no flags', emitterFx(startEmitters('foie', 5)[2]).noDraw === undefined);
{
  const megid = MEGID_EMITTERS.map((tier) => tier.filter((e) => e.hidden).map((e) => e.id.toString(16)).join(','));
  check(`Megid hidden emitters by tier [${megid.join('|')}]`, megid.join('|') === '|||||1cf');
}

// Particle flag 2: the helpers run X, Y, Z, so Rz is applied first and Rx last (v' = Rx Ry Rz v).
{
  for (const o of angles) {
    const m = mul(mul(rx(o[0]), ry(o[1])), rz(o[2]));
    for (const v of vs) {
      vecNear(turnStep(o, v as [number, number, number], { flag2: true }), apply(m, v), `flag 2 product Rx Ry Rz at [${o.map((x) => x.toFixed(1))}] on [${v}]`);
    }
  }
  vecNear(turnStep([HALF, 0, HALF], [0, 1, 0], { flag2: true }), [-1, 0, 0], 'flag 2, X and Z a quarter turn: Z first, so +y goes to -x');
  vecNear(turnStep([HALF, 0, HALF], [0, 1, 0]), [0, 0, 1], 'flag 2 clear, same angles: X first, so +y goes to +z');
}

// Particle flag 0x20: the particle's own matrix M is multiplied in first, so out = M^T (default turn) v.
// The exe's transform reads the stack transposed (out.x = _11 x + _21 y + _31 z).
{
  check('flag 0x20: M^T e1 is the first row of M', (() => {
    const w = turnStep(null, [1, 0, 0], { matrix: [1, 2, 0, 0, 1, 0, 0, 0, 1] });
    return Math.abs(w[0] - 1) < 1e-9 && Math.abs(w[1] - 2) < 1e-9 && Math.abs(w[2]) < 1e-9;
  })());
  const tr = (a: number[][]) => a[0]!.map((_, j) => a.map((r) => r[j]!));
  const M = ry(0.9);
  const flat = M.flat();
  for (const o of angles) {
    for (const v of vs) {
      const dflt = apply(mul(mul(rz(o[2]), rx(o[0])), ry(o[1])), v);
      vecNear(turnStep(o, v as [number, number, number], { matrix: flat }), apply(tr(M), dflt), `flag 0x20 with M = Ry(0.9), default turn at [${o.map((x) => x.toFixed(1))}] on [${v}]`);
      const f2 = apply(mul(mul(rx(o[0]), ry(o[1])), rz(o[2])), v);
      vecNear(turnStep(o, v as [number, number, number], { flag2: true, matrix: flat }), apply(tr(M), f2), `flag 0x20 with flag 2 at [${o.map((x) => x.toFixed(1))}] on [${v}]`);
    }
  }
}

// Model effects: the emitter's model state (chunk, motion) and the model branch's speed; a model particle's
// motion frame (njm_elapsed, +0x110) is advanced once per update and is the particle's own.
{
  const barta5 = startEmitters('barta', 5).find((e) => e.id === 0x193)!;
  const gib2 = startEmitters('gibarta', 0).find((e) => e.id === 0x182)!;
  check('emitterFx: Barta 0x193 is model chunk 0 with motion 0, speed 1', JSON.stringify(emitterFx(barta5).model) === '{"chunk":0,"motion":0,"speed":1}');
  check('emitterFx: Gibarta 0x182 is model chunk 2, no motion, speed 1', JSON.stringify(emitterFx(gib2).model) === '{"chunk":2,"motion":null,"speed":1}');
  check('emitterFx: a quad emitter has no model', emitterFx(startEmitters('barta', 5)[0]).model === undefined);
  const dat = new Uint8Array(0x98);
  const dv = new DataView(dat.buffer);
  const f = (o: number, v: number) => dv.setFloat32(o, v, true);
  f(0x34, 2); f(0x44, 1); dv.setInt32(0x48, 10, true); dv.setInt32(0x4c, 0, true); f(0x50, 1); f(0x24, 1); f(0x2c, 1);
  const e = parseParticleEntry(dat, 0);
  const sys = new ParticleSystem();
  sys.models = true;
  sys.add(e, [0, 0, 0], null, undefined, { model: { chunk: 0, motion: 0, speed: 1 } });
  sys.step(true);
  sys.step(false);
  sys.step(false);
  check('model: the motion frame is 3 after the spawn update and two more (anim = 3)', sys.live[0]?.anim === 3);
  const quad = new ParticleSystem();
  quad.add(e, [0, 0, 0], null);
  quad.step(true);
  quad.step(false);
  check('a quad particle keeps anim 0', quad.live[0]?.anim === 0);
}

// noDraw: the particle is made and stepped but never drawn (live is empty; a plain one is drawn).
{
  const dat = new Uint8Array(0x98);
  const dv = new DataView(dat.buffer);
  const f = (o: number, v: number) => dv.setFloat32(o, v, true);
  f(0x34, 2); f(0x44, 1); dv.setInt32(0x48, 10, true); dv.setInt32(0x4c, 0, true); f(0x50, 1); f(0x24, 1); f(0x2c, 1);
  const e = parseParticleEntry(dat, 0);
  const hidden = new ParticleSystem();
  hidden.add(e, [0, 0, 0], null, undefined, { noDraw: true });
  hidden.step(true);
  check('noDraw: the particle is made (count 1)', hidden.count === 1);
  check('noDraw: the particle is not drawn (live empty)', hidden.live.length === 0);
  const plain = new ParticleSystem();
  plain.add(e, [0, 0, 0], null);
  plain.step(true);
  check('a plain emitter is drawn (live 1)', plain.live.length === 1);
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

// NT (effect_nt flag 1, IsNTParticle 0x00508a30) and the table read from the exe at 0x00a101c0.
{
  check('NT table: 108 records (effect_nt_metadata[108])', NT_FLAGS.length === 108);
  check('NT: slot 1 (flags 1) is NT', particleIsNt(1) === true);
  check('NT: slot 0 (flags 2) is not', particleIsNt(0) === false);
  check('NT: slot 55 (flags 5, bit 0) is NT', particleIsNt(55) === true);
  check('NT: slot 54 (flags 6) is not', particleIsNt(54) === false);
  check('NT: an unknown slot is not NT', particleIsNt(undefined) === false && particleIsNt(500) === false);
  // A model particle of a NT slot blends SRCALPHA / ONE, a non-NT one SRCALPHA / INVSRCALPHA.
  check('NT blend: SRCALPHA / ONE', modelParticleBlend(particleIsNt(1)).dst === 2 && modelParticleBlend(particleIsNt(1)).src === 5);
  check('non-NT blend: SRCALPHA / INVSRCALPHA', modelParticleBlend(particleIsNt(0)).dst === 6);
}

// Rafoie's ring: the cloak flag (0x400) and the advanced effects setting (render/advancedeffects.ts).
{
  const ring = startEmitters('rafoie', 0, true)[0];
  check('Rafoie ring: the ring 0x1a is the model with the cloak flag', ring.id === 0x1a && emitterFx(ring).cloak === true && emitterFx(ring).model?.chunk === 9);
  check('Rafoie mark 0x39 is not cloaked', emitterFx(startEmitters('rafoie', 0, false)[0]).cloak === undefined);
  check('advanced effects default on (ASSUMED)', advancedEffectsOn() === true);
  setAdvancedEffects(false);
  check('advanced effects switch off', advancedEffectsOn() === false);
  setAdvancedEffects(true);
}

// Rafoie's fire sphere (combat/techfire.ts RafoieSphere): the child's life, scale and fade.
{
  const s = new RafoieSphere(1, 2, 3);
  check('sphere: at the blast point, lifted 5 (g_RafoieParticleYOffset)', s.x === 1 && s.y === 7 && s.z === 3);
  check('sphere: scale starts at 1.2, alpha 1', Math.abs(s.scale - 1.2) < 1e-6 && s.fade === 1);
  s.step();
  // Vec3LerpIfDistance with rate 0.05: dist = sqrt(3) * 0.7, factor = dist * 0.05.
  const want = 1.2 + 0.7 * Math.sqrt(3) * 0.7 * 0.05;
  check('sphere: the first update grows the scale by the exe lerp', Math.abs(s.scale - want) < 1e-4);
  check('sphere: the fade falls 0.035 an update', Math.abs(s.fade - (1 - 0.035)) < 1e-6);
  for (let i = 0; i < 28; i++) s.step();
  check('sphere: the fade reaches 0 after 29 updates and stays there', s.fade === 0);
  check('sphere: alive through the 110th update', s.alive === true && s.ticks === 29);
  for (let i = 29; i < 110; i++) s.step();
  check('sphere: alive on update 110', s.alive === true && s.ticks === 110);
  s.step();
  check('sphere: gone on update 111 (0x6e < counter)', s.alive === false && s.ticks === 111);
  // The lerp factor is the distance times 0.05 (the length is sqrt(3) |diff|), so the gap shrinks by
  // about 0.0866 * gap^2 a step: the scale is still short of 1.9 at the end of the life (about 1.81 at 110).
  const long = new RafoieSphere(0, 0, 0);
  for (let i = 0; i < 110; i++) long.step();
  check('sphere: the scale is about 1.81 at update 110 (approaches 1.9 slowly)', long.scale > 1.79 && long.scale < 1.83);
  for (let i = 110; i < 5000; i++) long.step();
  check('sphere: the scale settles near 1.9 (the rate 0.05 stops the lerp at a length of 0.05)', Math.abs(long.scale - 1.9) < 0.03 && long.scale <= 1.9 + 1e-6);
  check('sphere: the 0..15 counter wraps', long.ring === 5000 % 16);
  // The list form's blast follows the target's y as well as x and z (rafoie_aoe_tick copies the
  // target's point into the blast each tick, dump 650685): the burst is at the target's y that tick.
  const lf = new RafoieBlast({ level: 0, x: 0, y: 0, z: 0, heading: 0 }, 7);
  const tgt = (y: number) => ({ id: 7, x: 3, z: 4, radius: 1, y });
  const hitsL: TechTarget[] = [];
  lf.step([tgt(40)], 1, hitsL);
  check('rafoie list: the blast takes the target\'s x, y and z each tick', lf.x === 3 && lf.y === 40 && lf.z === 4);
  lf.step([tgt(55)], 1, hitsL);
  check('rafoie list: the y follows the target on the next tick', lf.y === 55 && lf.bx === 3 && lf.bz === 4);
  const noY = new RafoieBlast({ level: 0, x: 0, y: 9, z: 0, heading: 0 }, 7);
  noY.step([{ id: 7, x: 1, z: 1, radius: 1 }], 1, hitsL);
  check('rafoie list: a target without a y keeps the blast\'s y', noY.y === 9 && noY.x === 1);
  const fixedY = new RafoieBlast({ level: 0, x: 10, y: 6, z: 10, heading: 0, enemy: true }, null);
  fixedY.step([tgt(99)], 1, hitsL);
  check('rafoie fixed: the point does not follow the target', fixedY.y === 6 && fixedY.x === 10);
  // The sphere's turn is the camera's yaw as BAMS: a quarter turn is 0x4000 = pi / 2.
  near(sphereTurnRad(0x4000), Math.PI / 2, 'sphere turn: 0x4000 is a quarter turn');
  near(sphereTurnRad(0), 0, 'sphere turn: 0 is no turn');
  near(sphereTurnRad(0x10000), Math.PI * 2, 'sphere turn: 0x10000 is a full turn');
  // The model particle's alpha test (SetColor_00508958 + dump 850240): a non-NT particle's alpha is
  // byte / 255 - 1, so the opaque pass is skipped below full alpha; an NT particle's alpha is 0.
  check('model alpha: a non-NT particle at full fade keeps the opaque pass', modelOpaquePassSkipped(false, 1) === false);
  check('model alpha: a non-NT particle at half fade skips the opaque pass', modelOpaquePassSkipped(false, 0.5) === true);
  check('model alpha: an NT particle never skips it (its alpha is 0, not below 0)', modelOpaquePassSkipped(true, 0.2) === false);
  check('model alpha: a fade of 0 skips it too', modelOpaquePassSkipped(false, 0) === true);
}

if (failures) {
  console.log(`particleorient: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('particleorient: ALL PASS');
