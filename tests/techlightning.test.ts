// The technique objects of combat/techlightning.ts: the 13 point jagged bolt
// (its geometry, jitter and alpha timeline), the Zonde / Gizonde / Razonde
// plans per effect tier, the Megid flight and hit rules, the Grants timeline,
// the support rings, the weapon special objects and the enemy-cast shots, all
// checked against values worked out by hand from PsoBB.exe (the constants at
// 0x0096e050..0x0096e0e4, 0x0096ddd0.., the tier tables at 0x0096da78,
// 0x0096d5b4, 0x0096d6cc, 0x0096db38, 0x0096de24) and the particle names of the
// client's particleentry.dat.
// Run: node tests/techlightning.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseParticleEntry } from '../client/src/classic/particles.ts';
import {
  aoeTargets,
  boltBetween,
  BOLT_POINTS,
  BURNING,
  CAST_LIGHT,
  CHARGE_SE,
  dominantAxis,
  effectTier,
  GizondeStrike,
  gizondeStrike,
  GRANTS_BURST,
  GRANTS_EMITTERS,
  GrantsStrike,
  GrantsTimeline,
  jitterDirection,
  LightningBolt,
  MEGID_EMITTERS,
  MegidFlight,
  MegidOrb,
  megidSpeed,
  pitchRate,
  RafoieBall,
  razondeSpiral,
  razondeStep,
  razondeStrike,
  RingWave,
  ringTier,
  SE,
  shockBolt,
  specialStart,
  stormBolts,
  supportCastFx,
  supportRadius,
  techSound,
  zondePoints,
  zondeStrike,
  type TechFxEvent,
} from '../client/src/combat/techlightning.ts';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { TECH, techBoost } from '../client/src/combat/techniques.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-3) => check(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);
const half = () => 0.5;
const O = { x: 0, y: 0, z: 0 };

// 1. The effect tier (AllocateEffectBuffer_006e1cec): level / 5 for 1..5, else 0.
eq([0, 4, 5, 9, 10, 14, 15, 19, 20, 24, 25, 29, 30, 35, -3].map(effectTier), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 0, 0, 0], 'tier by level');

// 2. Sounds: the tier pitch tables (units 1/256 semitone, ASSUMED).
eq([0, 1, 2, 3, 4, 5].map((t) => techSound(SE.zonde, O, t).pitch), [0x100, 0, -0x180, -0x180, -0x250, -0x100], 'attack technique pitch by tier');
eq([0, 1, 2, 3, 4, 5].map((t) => techSound(SE.resta, O, t, true).pitch), [0x100, 0x100, 0, 0, -0x100, -0x100], 'support pitch by tier');
eq([SE.zonde, SE.gizonde, SE.razonde, SE.megid, SE.grants, SE.megidHit], [0x8f, 0x90, 0x91, 0x92, 0x93, 0xb0], 'sound ids');
near(pitchRate(0x100), 2 ** (1 / 12), 'one semitone is 256');
eq(CHARGE_SE.length, 19, 'a charge sound per technique');
eq([TECH.foie, TECH.zonde, TECH.grants, TECH.deband, TECH.shifta, TECH.megid, TECH.resta, TECH.barta].map((t) => CHARGE_SE[t]), [0xa3, 0xa5, 0xa7, 0xa2, 0xa2, 0xa6, 0xa7, 0xa4], 'charge sound per family');
eq(CAST_LIGHT.length, 19, 'a cast light per technique');
eq(CAST_LIGHT[TECH.zonde], [1, 1, 1, 0.3], 'the Zonde cast light');

// 3. get_dominant_axis and the jitter.
eq([[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 1, 1], [2, 1, 0], [0, 1, 1], [1, 2, 3]].map(([x, y, z]) => dominantAxis(x, y, z)), [0, 1, 2, 1, 2, 0, 2, 2], 'dominant axis');
{
  const out = new Float32Array(3);
  jitterDirection({ x: 0, y: -1, z: 0 }, 1, half, out, 0);
  eq([out[0], out[1], out[2]], [0, 0, 0], 'a constant 0.5 random gives a zero jitter (not normalised)');
  let n = 0;
  jitterDirection({ x: 0, y: -1, z: 0 }, 1, () => [0.9, 0.2][n++ % 2], out, 0);
  near(Math.hypot(out[0], out[1], out[2]), 1, 'a jitter direction is unit length');
  near(out[1], 0, 'a vertical bolt jitters sideways only');
  // The dominant axis term adds, it does not negate: x dominant, y = 0.4, z = -0.4 -> x = (z * dz + y * dy) / dx.
  let m = 0;
  jitterDirection({ x: 1, y: 0.5, z: 0.25 }, 0, () => [0.7, 0.3][m++ % 2], out, 0);
  const y = (0.7 - 0.5) * 2 * 10;
  const z = (0.3 - 0.5) * 2 * 10;
  const x = z * 0.25 + y * 0.5;
  const len = Math.hypot(x, y, z);
  near(out[0], x / len, 'x dominant: x = (z dz + y dy) / dx, normalised');
}

// 4. The bolt: points on the segment, the alpha timeline.
{
  const b = new LightningBolt({ x: 1, y: 100, z: 2 }, { x: 0, y: -1, z: 0 }, 120, 0.5, half);
  eq(BOLT_POINTS, 13, 'thirteen points');
  eq(Array.from({ length: 13 }, (_, i) => b.base[i * 3 + 1]), Array.from({ length: 13 }, (_, i) => 100 - 10 * i), 'points every length / 12');
  eq([b.base[0], b.base[2], b.base[36], b.base[38]], [1, 2, 1, 2], 'a vertical bolt keeps its x and z');
  check(!b.visible && b.counter === 0, 'not drawn before its first update');
  const alphas: number[] = [];
  let doneAt = 0;
  for (let k = 1; k <= 60 && !b.done; k++) {
    b.tick();
    if (b.done) doneAt = k;
    else alphas.push(b.alpha);
  }
  check(b.visible, 'drawn after its first update');
  eq(alphas.slice(0, 21).every((a) => a === 255), true, 'alpha holds for 21 updates (the hold of 0x14 is counter <= 20)');
  eq([alphas[21], alphas[22], alphas[32], alphas[33]], [235, 215, 15, 0], 'then 20 less an update, 15 at the 33rd, 0 at the 34th');
  eq(doneAt, 35, 'ends on the 35th update');
  // Razonde's bolt holds 6.
  const r = new LightningBolt(O, { x: 1, y: 0, z: 0 }, 12, 5, half, 6);
  let k = 0;
  while (!r.done && k < 100) {
    r.tick();
    k++;
  }
  eq(k, 21, 'a hold of 6 ends on the 21st update');
  // The jitter scale: a constant 0.5 starts every scale at 0, the first update floors it at 1.
  const s = new LightningBolt(O, { x: 0, y: -1, z: 0 }, 120, 0.5, half);
  s.tick();
  eq(Array.from(s.scale).every((v) => v === 1), true, 'jitter scale floors at 1');
  const big = new LightningBolt(O, { x: 0, y: -1, z: 0 }, 120, 0.5, () => 0.999);
  big.tick();
  near(big.scale[5], (0.999 - 0.5) * 2 * 8 - 0.05, 'inner scale (rand - 0.5) * 16 minus 0.05');
  eq([big.scale[0], big.scale[12]], [1, 1], 'the two ends start at 0 and floor at 1');
  near(b.opacity, 0, 'a finished bolt is transparent');
  const t = boltBetween({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }, 0.7, half);
  eq([t.length, t.thickness, t.hold], [10, 0.7, 0x14], 'boltBetween');
}

// 5. Zonde (CreateTechniqueEffectEntity_006f2570, update 0x006f2840).
{
  const pts = zondePoints({ x: 10, y: 5, z: -4 }, 0, half);
  eq(pts.length, 14, '14 points');
  eq([pts[0].x, pts[0].y, pts[0].z], [10, 105, -4], 'point 0 is straight above the target');
  near(pts[3].x, 0.5 * 3 * 13 + 10, 'x spread rand * i * 13 toward +x');
  near(pts[3].z, 0.5 * 3 * 13 - 4, 'z spread toward +z');
  eq(zondePoints(O, 5, half)[0].y, 500, 'tier 5 point 0 is 500 up');
  eq(zondePoints(O, 5, half)[1].y, 100, 'the others 100');
  const shape = (level: number) => {
    const p = zondeStrike(level, { x: 0, y: 0, z: 0 }, half);
    return { tier: p.tier, n: p.bolts.length, t: p.bolts.map((b) => b.thickness), parts: p.particles.map((q) => q.id), pitch: p.sounds[0].pitch };
  };
  eq(shape(0), { tier: 0, n: 1, t: [0.5], parts: [0x19f], pitch: 0x100 }, 'Zonde Lv1');
  eq(shape(5), { tier: 1, n: 1, t: [0.6], parts: [0x19f], pitch: 0 }, 'Zonde Lv6');
  eq(shape(10), { tier: 2, n: 1, t: [0.7], parts: [0x19f], pitch: -0x180 }, 'Zonde Lv11');
  eq(shape(15), { tier: 3, n: 3, t: [0.5, 0.5, 0.5], parts: [0x19f], pitch: -0x180 }, 'Zonde Lv16');
  eq(shape(20), { tier: 4, n: 3, t: [0.7, 0.7, 0.7], parts: [0x19f], pitch: -0x250 }, 'Zonde Lv21');
  const t5 = shape(25);
  eq([t5.tier, t5.n, t5.t[0], t5.t[1], t5.t[13], t5.parts, t5.pitch], [5, 14, 5, 0.5, 0.5, [], -0x100], 'Zonde Lv26: 14 bolts, the first 5.0, no 0x19f');
  eq(shape(29).tier, 5, 'Lv30 is tier 5');
  const p = zondeStrike(0, { x: 0, y: 0, z: 0 }, half);
  const b = p.bolts[0];
  near(b.length, 100, 'the bolt runs from 100 up to the target');
  check(p.sounds[0].id === SE.zonde && p.sounds[0].at.y === 0, 'SE 0x8f at the target');
}

// 6. Gizonde (TechniqueEffectEntity_Constructor_006e5520, UpdateGizondeTechniqueVisuals_006e5954).
{
  const cast = { x: 0, y: 20, z: 0 };
  const a = { x: 30, y: 26, z: 0 };
  const b = { x: 60, y: 26, z: 10 };
  const c = { x: 60, y: 26, z: 10 };
  eq(gizondeStrike(0, cast, [], half).hits, false, 'no target: no hit');
  eq(gizondeStrike(0, cast, [{ ...cast }], half).hits, false, 'a target at zero distance: no hit at all');
  const one = gizondeStrike(0, cast, [a], half);
  eq([one.hits, one.bolts.length, one.bolts[0].thickness, one.particles.map((p) => p.id), one.sounds[0].id, one.sounds[0].pitch], [true, 1, 0.5, [0x19f], 0x90, 0x100], 'Gizonde Lv1 on one target');
  eq(one.particles[0].at, a, 'the hit particle is at the first hit box');
  // The exe's return 0 on a bad pair (asm 6e6148 / 6e605f): the bolts before it stay, nothing is hit.
  const chain = gizondeStrike(0, cast, [a, b, c], half);
  eq([chain.bolts.length, chain.hits], [2, false], 'b -> c is at zero distance: the chain stops, no hit (the first bolt and a -> b stay)');
  eq(gizondeStrike(0, cast, [a, null, b], half).bolts.length, 1, 'a missing entity in the middle: the chain stops after the first bolt');
  const stop = gizondeStrike(0, cast, [a, null, b], half);
  eq(stop.hits, false, 'a missing entity in the middle: no hit');
  const ok = gizondeStrike(0, cast, [a, b, { x: 90, y: 26, z: 10 }], half);
  eq([ok.bolts.length, ok.hits], [3, true], 'a clean chain of three: first bolt + two pairs, every target hit');
  eq(gizondeStrike(0, cast, [null, a], half).bolts.length, 0, 'a missing first target: nothing is drawn');
  const t5 = gizondeStrike(25, cast, [a, b], half);
  eq(t5.bolts.map((x) => x.thickness), [5, 0.5, 0.5, 5, 0.5, 0.5], 'tier 5: three bolts per segment');
  eq(t5.particles.map((p) => p.id), [0x19f, 0x188], 'tier 5 particles');
  eq(gizondeStrike(15, cast, [a], half).particles.map((p) => p.id), [0x19f, 0x188], 'tier 3 adds 0x188');
  eq(gizondeStrike(5, cast, [a], half).bolts[0].thickness, 0.6, 'tier 1: 0.6');
  eq(gizondeStrike(10, cast, [a], half).bolts[0].thickness, 0.7, 'tier 2: 0.7');
  eq(gizondeStrike(15, cast, [a], half).bolts[0].thickness, 0.6, 'tier 3: 0.6');
  eq(gizondeStrike(20, cast, [a], half).bolts[0].thickness, 0.7, 'tier 4: 0.7');
}

// 7. Razonde (RafoieEffectEntity_Constructor_006ee674).
{
  eq([0, 14, 15, 24, 25, 29, 30].map(razondeStep), [5.4, 5.4, 8.1, 8.1, 10.8, 10.8, 5.4], 'spiral step by level');
  const sp = razondeSpiral({ x: 10, y: 20, z: 5 }, 0);
  const a1 = 0x2aaa * ((2 * Math.PI) / 0x10000);
  near(sp[0].x, Math.cos(a1) * 5.4 + 10, 'point 0 x = cos * step + x');
  near(sp[0].z, Math.sin(a1) * 5.4 + 5, 'point 0 z = sin * step + z');
  eq(sp.every((p) => p.y === 20), true, 'the spiral stays at the cast height');
  near(Math.hypot(sp[7].x - 10, sp[7].z - 5), 5.4 * 8, 'point 7 is at 8 steps');
  const H = { x: 1, y: 2, z: 3 };
  const W = { x: 7, y: 8, z: 9 };
  const lv0 = razondeStrike(0, { x: 0, y: 0, z: 0 }, half, { hand: H, weapon: W });
  eq([lv0.bolts.length, lv0.bolts[0].thickness, lv0.bolts[0].hold, lv0.particles.map((p) => p.id), lv0.sounds[0].id], [7, 5, 6, [0x93], 0x91], 'Razonde Lv1');
  eq(lv0.casterParticles, [{ id: 0x93, at: H }], 'the caster gets the first table particle at the hand');
  const lv16 = razondeStrike(15, { x: 0, y: 0, z: 0 }, half, { hand: H, weapon: W });
  eq(lv16.particles.map((p) => [p.id, p.at.x === lv16.spiral[lv16.particles.indexOf(p)].x]), [[0xaa, true], [0xad, true]], 'tier 3 particles at the first two spiral points');
  eq(lv16.casterParticles.map((p) => [p.id, p.duration ?? null]), [[0xaa, null], [0xad, 60]], 'table[1] is a 60 frame emitter on the caster');
  eq(lv16.casterParticles[1].at, W, 'the 60 frame emitter is at the weapon position (caster + 0x300), not the hand');
  eq(razondeStrike(15, O, half, null).casterParticles, [], 'an enemy caster makes none');
  eq(razondeStrike(25, O, half, null).bolts.length, 14, 'tier 5 adds a thin bolt per segment');
  eq(razondeStrike(25, O, half, null).particles.map((p) => p.id), [0xab, 0xae], 'tier 5 particle table');
  const list = Array.from({ length: 20 }, (_, i) => ({ id: i, x: i, y: 0, z: 0, radius: 5 }));
  eq(aoeTargets(O, 50, list).length, 15, 'at most 15 hits');
  eq(aoeTargets(O, 10, [{ id: 1, x: 20, y: 0, z: 0, radius: 5 }, { id: 2, x: 21, y: 0, z: 0, radius: 5 }]).map((t) => t.id), [1], 'range_h + 5 + the hit box radius: 20 is in, 21 is out');
  eq(aoeTargets(O, 10, [{ id: 3, x: 0, y: 19, z: 0, radius: 5 }]).length, 1, 'a sphere: height counts');
  eq(aoeTargets(O, 10, [{ id: 3, x: 0, y: 21, z: 0, radius: 5 }]).length, 0, 'a sphere: too high');
}

// 8. Megid.
{
  eq([0, 4, 5, 9, 10, 29].map(megidSpeed), [2, 2, 4, 4, 6, 12], 'Megid speed (level / 5) * 2 + 2');
  eq(MEGID_EMITTERS.map((e) => e.map((x) => x.id)), [[0x1c5, 0x1c8], [0x1c5, 0x1c8], [0x1c5, 0x1c8], [0x1c4, 0x1c5, 0x1c8], [0x1c4, 0x1c5, 0x1c8], [0x1c4, 0x1c5, 0x1c8, 0x1c7, 0x1cf]], 'emitters by tier');
  eq(MEGID_EMITTERS.map((e) => e.find((x) => x.id === 0x1c5)?.scale ?? null), [null, 1.4, 1.8, 2.2, 2.6, 3], 'emitter scale by tier');
  const f = MegidFlight.along(O, 0, 2, 10, false);
  let ticks = 0;
  while (!f.done && ticks < 50) {
    f.tick([]);
    ticks++;
  }
  eq([ticks, f.z], [7, 14], 'range 10 at speed 2: the 7th update ends it (range < travelled), 14 along');
  eq(MegidFlight.along(O, Math.PI / 2, 3, 100, false).tick([]), null, 'no target: no hit');
  // The hit sphere: 5 + the hit box radius, the first entity of the list only.
  const g = MegidFlight.along(O, 0, 2, 100, false);
  const A = { id: 1, x: 0, y: 0, z: 14, radius: 5 };
  const B = { id: 2, x: 0, y: 0, z: 13, radius: 5 };
  eq(g.tick([A])?.id ?? null, null, 'z 2: A at 14 is 12 away, out of 10');
  g.tick([]);
  g.tick([]);
  eq(g.tick([A])?.id ?? null, 1, 'z 8: A is 6 away: hit');
  check(g.done, 'a non piercing orb ends on its hit');
  const p = MegidFlight.along(O, 0, 2, 100, true);
  for (let i = 0; i < 3; i++) p.tick([]);
  eq(p.tick([A, B])?.id ?? null, 1, 'only the first overlapping entity is processed');
  eq(p.tick([A, B])?.id ?? null, null, 'A is struck: B waits (the exe processes list[0] only)');
  check(!p.done, 'a piercing orb flies on');
  eq(p.tick([B])?.id ?? null, 2, 'B once A is out of the list');
  eq(p.struck, [1, 2], 'struck list');
  eq([megidSpeed(0) === 2, techBoost(8, TECH.megid)], [true, 1], 'FOnewearl Megid boost is exactly 1.0 (the pierce bit)');
  eq([...Array(12).keys()].filter((c) => techBoost(c, TECH.megid) === 1), [8], 'only FOnewearl (class 8) pierces');
  const at = MegidFlight.at({ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 10 }, 1, 100, false);
  near(at.dir.y, Math.SQRT1_2, 'a target flight is 3D');
  // The map ray (UpdateTechniqueEntityPositionWithRaycast_006f04c0): from the old point to the new one, mask 0x100.
  const rays: Array<[Vec3, Vec3]> = [];
  const wall = (a: Vec3, b: Vec3): Vec3 | null => {
    rays.push([a, b]);
    return b.z > 7 ? { x: 0, y: 3, z: 7.5 } : null; // a wall across z 7.5
  };
  const w = MegidFlight.along(O, 0, 2, 100, true);
  w.tick([], wall);
  w.tick([], wall);
  eq([rays[1][0].z, rays[1][1].z], [2, 4], 'the ray runs from the old point to the new one');
  check(!w.done, 'no wall on z 4');
  const w2 = MegidFlight.along(O, 0, 2, 100, true);
  for (let i = 0; i < 4; i++) w2.tick([], wall);
  eq([w2.done, w2.z, w2.y], [true, 7.5, 3], 'a wall at z 8 ends the orb at the hit point');
  eq(w2.tick([], wall), null, 'nothing more after the wall');
  // The hit of the same update still counts: the orb moves to the hit point, then looks for the entity there.
  const w3 = MegidFlight.along(O, 0, 2, 100, true);
  for (let i = 0; i < 3; i++) w3.tick([], wall);
  eq(w3.tick([{ id: 5, x: 0, y: 3, z: 7.5, radius: 0 }], wall)?.id ?? null, 5, 'the entity at the hit point is hit on the wall update');
  // The enemy orb takes the same ray: it stops at the wall and its hit point is the last point.
  const ord = new MegidOrb({ x: 0, y: 0, z: 0 }, 0, 0, 100, 27, 5, 0, undefined, wall);
  let ot = 0;
  while (!ord.done && ot < 50) {
    ord.tick([]);
    ot++;
  }
  eq([ot, ord.z], [4, 7.5], 'an enemy orb stops at the wall too (4 updates: z 8 is past the wall)');
}

// 9. Grants (UpdateTechniqueTargetingEntity_006e6efc and its tracker 0x006e72bc).
{
  const tl = new GrantsTimeline(0);
  const log: Array<{ u: number; e: TechFxEvent }> = [];
  let hitAt = -1;
  for (let u = 0; u < 40 && !tl.done; u++) {
    tl.update({ x: 4, y: 0, z: 5 });
    for (const e of tl.events) log.push({ u, e });
    tl.events = [];
    if (tl.hit) hitAt = u;
  }
  eq(hitAt, 30, 'the target is hit on the 31st update (counter above 0x1e)');
  const first = log.filter((l) => l.u === 0).map((l) => l.e.t);
  eq(first, ['emitters', 'se'], 'update 0: the tier emitters and SE 0x93');
  const em = log[0].e;
  eq(em.t === 'emitters' ? em.ids : null, GRANTS_EMITTERS[0], 'tier 0 emitters 1d3 1d4 1cb');
  const se = log[1].e;
  eq(se.t === 'se' ? [se.s.id, se.s.pitch] : null, [0x93, 0x100], 'SE 0x93, tier 0 pitch');
  eq(log.filter((l) => l.e.t === 'ring').map((l) => l.u), [5, 10, 15, 20, 25, 30], 'a ring wave every 5th tracker update');
  const burst = log.filter((l) => l.e.t === 'particle');
  eq([burst.map((l) => l.u), burst.map((l) => (l.e.t === 'particle' ? l.e.p.id : 0))], [[30, 30, 30], GRANTS_BURST], 'the 0xb4 0xb5 0xb6 burst on the 30th');
  const end = log.filter((l) => l.u === 30 && l.e.t === 'se').map((l) => (l.e.t === 'se' ? [l.e.s.id, l.e.s.pitch] : []));
  eq(end, [[0x94, 0x100]], 'SE 0x94 with its own pitch');
  eq(GRANTS_EMITTERS.map((e) => e.length), [3, 3, 3, 3, 3, 4], 'emitter counts by tier');
  eq(GRANTS_EMITTERS[5], [0x1c2, 0x1d4, 0x1c9, 0x1da], 'tier 5 emitters');
  // A target missing on the first update: no tracker, the hit time is the same.
  const late = new GrantsTimeline(0);
  late.update(null);
  late.update({ x: 0, y: 0, z: 0 });
  check(late.events.length === 0, 'no tracker when the target was missing at counter 0');
  let u = 2;
  for (; !late.done && u < 100; u++) late.update({ x: 0, y: 0, z: 0 });
  eq(u, 31, 'it still ends on the 31st update');
}

// 10. The support rings (PlayTechniqueHitParticles_006ec06c, GetPlayerTechBoost_006e1fc8).
{
  eq([ringTier(0, 5), ringTier(1, 5), ringTier(2, 0), ringTier(2, 0.3), ringTier(2, 1), ringTier(2, 1.99), ringTier(2, 2)], [0, 0, 1, 1, 2, 2, 3], 'ring tier by level and boost');
  const at = { x: 1, y: 2, z: 3 };
  const resta = supportCastFx('resta', 0, 0, at);
  eq([resta.particles.map((p) => p.id), resta.particles[0].tint ?? null, resta.sounds[0].id, resta.sounds[0].pitch], [[0x1ed], null, 0x95, 0x100], 'Resta Lv1: hojo_0m, no tint, SE 0x95 +0x100');
  const anti = supportCastFx('anti', 5, 0, at);
  eq([anti.particles.map((p) => p.id), anti.particles[0].tint, anti.sounds[0].id], [[0x1f9], 0xff4dff99, 0x97], 'Anti Lv6: hojo_5m tinted green');
  const shifta = supportCastFx('shifta', 10, 2.5, at);
  eq(shifta.particles.map((p) => [p.id, p.tint]), [[0x1fb, 0xffff9999], [0x1f2, 0xffff9999], [0x19d, 0xffff9999]], 'Shifta with a 2.0+ boost: hojo_15m + b + c, all tinted');
  eq(supportCastFx('deband', 3, 1, at).particles.map((p) => [p.id, p.tint]), [[0x1fa, 0xff337fff]], 'Deband tier 2: hojo_10m tinted blue');
  eq(supportCastFx('jellen', 5, 0, at).particles, [], 'Jellen has no ring');
  eq(supportCastFx('zalure', 5, 0, at).sounds[0].id, 0x9e, 'Zalure SE 0x9e');
  eq([supportCastFx('jellen', 0, 0, at).sounds[0].id, supportCastFx('deband', 0, 0, at).sounds[0].id, supportCastFx('shifta', 0, 0, at).sounds[0].id], [0x9c, 0x9d, 0x9b], 'Jellen / Deband / Shifta sounds');
  eq(supportCastFx('reverser', 12, 0, at).sounds, [{ id: 0x99, at, pitch: 0 }], 'Reverser: SE 0x99, no pitch');
  eq([supportCastFx('resta', 15, 0, at).sounds[0].pitch, supportCastFx('resta', 25, 0, at).sounds[0].pitch], [0, -0x100], 'Resta pitch by tier');
  eq([supportRadius('resta', 60), supportRadius('jellen', 50), supportRadius('reverser', 100), supportRadius('deband', 10)], [65, 50, 10, 15], 'support area range_h + 5, Jellen range_h, Reverser the default 10');
}

// 11. The weapon specials.
{
  eq([25, 26, 27, 28, 29, 30, 24, 31, 0].map((s) => specialStart(s)?.particle ?? null), [0x69, 0x69, 0xbe, 0xbe, 0xa0, 0xa0, null, null, null], 'type 0 particles');
  const sb = shockBolt({ x: 3, y: 4, z: 5 }, half);
  eq([sb.length, sb.thickness, sb.base[1], sb.base[37]], [100, 1.8, 104, 4], 'Shock: 100 above the hit, straight down, thickness 1.8');
  const st = stormBolts({ x: 3, y: 4, z: 5 }, half);
  eq([st.length, st.map((b) => b.thickness)], [3, [0.7, 0.7, 0.7]], 'Storm: three bolts of 0.7');
  eq(st[0].base[0], 3, 'Storm point 0 is above the hit');
  const ball = new RafoieBall();
  for (let i = 0; i < 10; i++) ball.tick();
  near(ball.scale, 0.6 + 0.2 * (1 - 0.85 ** 10), 'Burning ball scale grows 15% of the gap an update');
  near(ball.alpha, 0.965 ** 10, 'alpha falls 3.5% an update');
  const life = new RafoieBall();
  let n = 0;
  while (!life.done && n < 500) {
    life.tick();
    n++;
  }
  eq(n, 0x6f, 'ends when the counter passes 0x6e');
  eq([BURNING.particle, BURNING.particleDy], [0x1ee, 13], 'Burning particle 0x1ee at +13');
}

// 12. The ring wave.
{
  const w = new RingWave();
  let n = 0;
  while (!w.done && n < 100) {
    w.tick();
    n++;
  }
  eq(n, 30, 'a ring wave lives 30 updates');
  near(w.scale, 1.2 - (1.2 - 0.05) * 0.95 ** 30, 'scale 0.05 toward 1.2 by 5%');
  near(w.alpha, 0.9 ** 30, 'alpha toward 0 by 10%');
}

// 13. The enemy-cast shots.
{
  const target = { clientId: 1, x: 40, z: 0, charClass: 0, dead: false };
  const from = { x: 0, y: 12, z: 0 };
  const gz = new GizondeStrike(from, target, 0, 30, half, 0);
  const evs: TechFxEvent[] = [];
  gz.drain((e) => evs.push(e));
  eq(evs.map((e) => e.t), ['bolt', 'particle', 'se'], 'a Gizonde strike queues its bolt, particle and sound at launch');
  const hits = gz.tick();
  eq([hits.length, gz.done], [1, true], 'it hits on its first update and is gone');
  eq(gz.look.hidden, true, 'no ball is drawn');
  check(gz.absolute, 'world heights');
  const dead = new GizondeStrike(from, { ...target, dead: true }, 0, 30, half, 0);
  eq(dead.tick().length, 0, 'a dead player is not hit');
  const gr = new GrantsStrike(from, target, 0, 50, 0);
  let hitTick = -1;
  const seen: string[] = [];
  for (let i = 0; i < 40 && !gr.done; i++) {
    if (gr.tick([target]).length) hitTick = i;
    gr.drain((e) => seen.push(e.t));
  }
  eq(hitTick, 30, 'Grants hits on the 31st update');
  eq(seen.filter((t) => t === 'ring').length, 6, 'six ring waves');
  const orb = new MegidOrb({ x: 0, y: 12, z: 0 }, 0, 0, 20, 27, 5, 0);
  let first = -1;
  let tick = 0;
  while (!orb.done && tick < 50) {
    tick++;
    const h = orb.tick([{ clientId: 7, x: 0, z: 14, charClass: 0, dead: false }]);
    if (h.length && first < 0) first = tick;
  }
  check(first > 0, 'the orb reaches a player in line');
  check(orb.done && tick >= 11, 'an enemy orb is not ended by its hit: it flies its whole range');
  const e2 = new MegidOrb({ x: 0, y: 12, z: 0 }, 0, 10, 100, 27, 5, 0);
  const seen2: string[] = [];
  e2.drain((e) => seen2.push(e.t));
  eq(seen2, ['se', 'follow'], 'launch queues SE 0x92 and the tier emitters');
  eq(e2.speed, 6, 'Lv11 orb speed 6');
}

// 14. The particle entries of the client's data.
{
  const gslPath = join(process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data'), 'data.gsl');
  if (!existsSync(gslPath)) console.log('data.gsl not found, skipping the particleentry.dat names');
  else {
    const dat = new GSLArchive(new Uint8Array(readFileSync(gslPath))).get('particleentry.dat');
    const e = (id: number) => parseParticleEntry(dat, id);
    const name = (id: number) => e(id).name;
    eq(name(0x1f0), 'zonde_ryuusi', 'the bolt particle');
    eq(e(0x1f0).rate, 3, 'the bolt particle emits 3 a point');
    eq([0x19f, 0x188, 0x93, 0xaa, 0xab, 0xad, 0xae].map(name), ['razonde_kona', 'razondebari', 'razonde_1', 'razonde_2', 'razonde_3', 'razonde_kami1', 'razonde_kami2'], 'Razonde particles');
    eq([0x1c4, 0x1c5, 0x1c7, 0x1c8, 0x1cf].map(name), ['megido_lebel01ke', 'megido_lebel01ta', 'megido_lv6face', 'megido_lv01pa', 'megidolv6sphere'], 'Megid particles');
    eq([0x1d3, 0x1d4, 0x1cb, 0x1cc, 0x1a4, 0x1c2, 0x1da].map(name), ['granz_konakona', 'granz_kona', 'granz_lv1', 'granz_lv3', 'granzlv5', 'granzlv6_kona', 'granz_lv6_center'], 'Grants particles');
    eq([0xb4, 0xb5, 0xb6].map(name), ['hikari', 'hikari_shougeki', 'hikari_wakka'], 'the Grants burst');
    eq([0x1ed, 0x1f9, 0x1fa, 0x1fb, 0x1f2, 0x19d].map(name), ['hojo_0m', 'hojo_5m', 'hojo_10m', 'hojo_15m', 'hojo_15m_b', 'hojo_15m_c'], 'the support rings');
    eq([0x1f6, 0x1f7, 0x1f8, 0x1ff].map(name), ['resta_other_a', 'resta_other_b', 'anti_other_a', 'anti_karadahikar'], 'the targets of Resta and Anti (the name field holds 16 characters)');
    eq([0x69, 0xbe, 0xa0, 0x1ee].map(name), ['extra_frame', 'extra_shock', 'zonde_tame', 'rafoie_hinoko'], 'the special start / Burning particles');
    console.log('particleentry.dat: names of the technique particles match');
  }
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('techlightning: all checks passed');
