// The Foie and Barta families' objects (combat/techfire.ts): tiers, speeds and
// ranges, the swept box and round box hit tests, each object's life, the exact
// target selection of the targeting system, the effect tables and the enemy shots.
// Run: node tests/techfire.test.ts
import {
  BartaBolt,
  effectTier,
  enemyAimHeight,
  AIM_HEIGHT,
  WEAPON_HEIGHT,
  enemyFire,
  FIRE_SE,
  FireShot,
  FoieBolt,
  GibartaBolt,
  GifoieRing,
  isFireTech,
  makeFireObject,
  pickTechTargets,
  RabartaField,
  RafoieBlast,
  rafoieBlastEmitters,
  startEmitters,
  startPitch,
  techReach,
  inTechReach,
  sweptBoxHits,
  circleHits,
  GIFOIE_GROUPS,
  type Candidate,
  type TechTarget,
} from '../client/src/combat/techfire.ts';
import { weaponPositionY } from '../client/src/combat/weaponorigin.ts';
import { TECH, techData, techPower } from '../client/src/combat/techniques.ts';
import { STATUS } from '../client/src/combat/status.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import { TechFire } from '../client/src/render/techfire.ts';
import type { FieldParticles } from '../client/src/render/hitfx.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-4) => check(Math.abs(a - b) <= eps, `${what}: ${a} != ${b}`);
const T = (id: number, x: number, z: number, radius = 8): TechTarget => ({ id, x, z, radius });
const hits: TechTarget[] = [];

// --- tiers -----------------------------------------------------------------------
eq([0, 4, 5, 9, 10, 14, 15, 19, 20, 24, 25, 29, 30].map(effectTier), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 0], 'AllocateEffectBuffer tiers');
check(isFireTech(TECH.foie) && isFireTech(TECH.rabarta) && !isFireTech(TECH.zonde) && !isFireTech(TECH.megid), 'the six techniques');

// --- the swept box ---------------------------------------------------------------
check(sweptBoxHits(0, 0, 0, 3, 4, 0, 1, 0, 1.5, 1), 'a box on the centre');
check(sweptBoxHits(0, 0, 0, 3, 4, 0, 1, 7, 1.5, 4), 'the half width 4 plus the radius reaches 7 + 1');
check(!sweptBoxHits(0, 0, 0, 3, 4, 0, 1, 9, 1.5, 4), 'the box is too narrow');
check(sweptBoxHits(0, 0, 0, 3, 4, 0, 1, 0, 6, 4), 'the end of the box plus the radius');
check(!sweptBoxHits(0, 0, 0, 3, 4, 0, 1, 0, -4, 4), 'behind the box');
check(!sweptBoxHits(0, 0, 0, 3, 4, 0, 1, 0, 150, 60), 'beyond the 100 cut-off');
check(circleHits(0, 0, 10, T(1, 17, 0, 8)) && !circleHits(0, 0, 10, T(1, 18, 0, 8)), 'sum of radii, strict');
check(!circleHits(0, 0, 400, T(1, 260, 0, 8)) && circleHits(0, 0, 400, T(1, 240, 0, 8)), 'a player caster\'s AoE cut-off 250');
check(!circleHits(0, 0, 400, T(1, 120, 0, 8), 100) && circleHits(0, 0, 400, T(1, 90, 0, 8), 100), 'an enemy caster\'s cut-off 100');

// --- Foie ------------------------------------------------------------------------
{
  const f = new FoieBolt({ level: 0, x: 0, y: 20, z: 0, heading: 0 });
  near(f.speed, 3, 'Foie Lv1 speed 3');
  near(new FoieBolt({ level: 14, x: 0, y: 0, z: 0, heading: 0 }).speed, 13, 'Foie Lv15 speed 3 + 10');
  near(f.rangeH, 100, 'Foie Lv1 range 100');
  let frame = 0;
  while (!f.done && frame < 100) {
    f.step([], 0, hits);
    frame++;
  }
  eq(frame, 35, 'Foie Lv1 flies 35 updates (travelled 102 > 100)');
  near(f.z, 105, 'and has moved 35 * 3');
  // a hit ends it and names the target
  const g = new FoieBolt({ level: 0, x: 0, y: 20, z: 0, heading: 0 });
  const ts = [T(7, 0, 40), T(5, 0, 12), T(9, 0, 14)];
  let n = 0;
  while (!g.done && n++ < 50) g.step(ts, ts.length, hits);
  eq(hits.map((h) => h.id), [5], 'the first target in the array order that the box touches, only one');
  check(g.impact && g.struck?.id === 5, 'impact and struck');
  eq(g.frames, 2, 'the box (half width 4, step 3) touches a radius 8 box at z 12 on the 2nd update');
  // a directed Foie climbs to the aimed point
  const d = new FoieBolt({ level: 0, x: 0, y: 20, z: 0, heading: 0, aim: { x: 0, y: 20, z: 60 } });
  d.step([], 0, hits);
  near(d.z, 3, 'directed along z');
  const up = new FoieBolt({ level: 0, x: 0, y: 0, z: 0, heading: 0, aim: { x: 30, y: 40, z: 0 } });
  up.step([], 0, hits);
  near(up.y, 2.4, 'the aim\'s height tilts it', 1e-3);
  near(up.x, 1.8, 'and its horizontal speed', 1e-3);
  // headed off to the side
  const s = new FoieBolt({ level: 0, x: 0, y: 0, z: 0, heading: Math.PI / 2 });
  s.step([], 0, hits);
  near(s.x, 3, 'heading pi/2 is +x');
}

// --- Gibarta ---------------------------------------------------------------------
{
  const g = new GibartaBolt({ level: 0, x: 0, y: 0, z: 0, heading: 0 });
  near(g.speed, 3, 'Gibarta speed is the base 3');
  near(g.halfWidth, 4, 'half width 4');
  near(new GibartaBolt({ level: 0, x: 0, y: 0, z: 0, heading: 0, aim: { x: 0, y: 0, z: 50 } }).halfWidth, 12, 'a directed Gibarta 12');
  const ts = [T(1, 0, 20), T(2, 3, 30), T(3, 60, 10)];
  const struck: number[] = [];
  let n = 0;
  while (!g.done && n++ < 200) {
    g.step(ts, ts.length, hits);
    for (const h of hits) struck.push(h.id);
  }
  eq(struck, [1, 2], 'it pierces and hits each in reach once');
  near(g.rangeH, techData(TECH.gibarta, 0).rangeH, 'range from the data');
}

// --- Barta -----------------------------------------------------------------------
{
  const b = new BartaBolt({ level: 5, x: 0, y: 20, z: 0, heading: 0 });
  near(b.speed, 5, 'Barta Lv6 speed 2 + 3');
  near(b.y, 25, 'an undirected Barta starts 5 higher');
  check(new BartaBolt({ level: 0, x: 0, y: 20, z: 0, heading: 0, aim: { x: 0, y: 20, z: 50 } }).y === 20, 'a directed one does not');
  // rides the ground 5 above it
  let ground = 0;
  const r = new BartaBolt({ level: 0, x: 0, y: 0, z: 0, heading: 0 }, () => ground);
  r.step([], 0, hits);
  near(r.y, 5, 'ground 0 -> 5 above it');
  ground = 4;
  r.step([], 0, hits);
  near(r.y, 9, 'a rise of 4');
  ground = 30;
  r.step([], 0, hits);
  check(r.done, 'a step of more than 12 ends it');
  near(r.y, 9, 'at its old height');
  // the horizontal part of an aimed Barta only
  const a = new BartaBolt({ level: 0, x: 0, y: 0, z: 0, heading: 0, aim: { x: 0, y: 50, z: 50 } });
  a.step([], 0, hits);
  near(a.z, 3 * Math.SQRT1_2, 'direction z only', 1e-5);
  // pierces, once each
  const p = new BartaBolt({ level: 0, x: 0, y: 0, z: 0, heading: 0 });
  const ts = [T(1, 0, 20), T(2, 0, 40)];
  const ids: number[] = [];
  for (let i = 0; i < 50; i++) {
    p.step(ts, ts.length, hits);
    for (const h of hits) ids.push(h.id);
  }
  eq(ids, [1, 2], 'Barta hits both once');
}

// --- Gifoie ----------------------------------------------------------------------
{
  eq([...GIFOIE_GROUPS], [1, 1, 1, 2, 2, 3], 'emitters by tier');
  const g = new GifoieRing({ level: 0, x: 0, y: 20, z: 0, heading: 0 });
  near(g.rangeH, 50, 'Gifoie Lv1 range 50');
  // the emitter of group 0 starts 10 from the cast point at angle 0x4000
  near(g.cx[0], -10, 'the first emitter\'s centre x', 1e-4);
  near(g.cz[0], 0, 'and z', 1e-4);
  g.step([], 0, hits);
  near(g.dist, 10, 'frame 1: distance 10');
  near(g.radius, 15, 'disc radius 15');
  // a target 20 away with radius 6 is not in frame 1, but it is once the ring reaches it
  const t = T(3, 21, 0, 6);
  const out: number[] = [];
  let f = 1;
  let r1 = 0;
  while (!g.done && f < 200) {
    g.step([t], 1, hits);
    for (const h of hits) out.push(h.id);
    f++;
    r1 = g.radius;
  }
  eq(out, [3], 'the ring hits it once');
  check(g.done, 'and ends');
  check(g.dist >= 50, 'at the technique range');
  check(f > 60 && f < 100, `Gifoie Lv1 lives about 70 frames (${f})`);
  check(r1 > 50, 'last disc radius');
  const three = new GifoieRing({ level: 25, x: 0, y: 0, z: 0, heading: 0 });
  eq(three.groups, 3, 'tier 5 has three emitters');
  eq(three.a0.map((a) => a & 0xffff), [0x4000, 0x4000 + 0x5555, 0x4000 + 0xaaaa], 'start angles 120 degrees apart');
  const pos = { x: 0, y: 0, z: 0 };
  const w = new GifoieRing({ level: 5, x: 0, y: 0, z: 0, heading: 0 });
  w.emitterAt(0, 6, pos); // 15 * 6 = 90 degrees: sin = 1 -> 3.5
  near(pos.y, 3.5, 'tier 1 wobble 3.5', 1e-6);
}

// --- Rafoie ----------------------------------------------------------------------
{
  const r = new RafoieBlast({ level: 0, x: 0, y: 20, z: 0, heading: 0 }, 5);
  near(r.rangeH, 100, 'Rafoie Lv1 radius 100');
  const ts = [T(5, 40, 0), T(6, 110, 0, 8), T(7, 170, 0, 8), T(8, 400, 0)];
  let burstAt = 0;
  const got: number[] = [];
  for (let i = 1; i <= 12 && !r.done; i++) {
    ts[0].x = 40 + i; // the target walks
    r.step(ts, ts.length, hits);
    if (r.burst) {
      burstAt = i;
      for (const h of hits) got.push(h.id);
    }
  }
  eq(burstAt, 10, 'it blasts with the 10th update');
  near(r.bx, 50, 'at the followed target\'s position then');
  eq(got, [5, 6], 'everything within 100 + radius of it, once');
  check(r.done, 'and ends');
  // the target gone
  const q = new RafoieBlast({ level: 0, x: 0, y: 0, z: 0, heading: 0 }, 5);
  q.step([T(5, 1, 1)], 1, hits);
  q.step([], 0, hits);
  check(q.done && !q.burst, 'a vanished target ends it without a blast');
  // the fixed (enemy) form
  const fx = new RafoieBlast({ level: 0, x: 10, y: 0, z: 10, heading: 0, enemy: true }, null);
  let b = 0;
  for (let i = 1; i <= 10; i++) {
    fx.step([T(1, 10, 100, 5)], 1, hits);
    if (fx.burst) b = i;
  }
  check(b === 10 && hits.length === 1, 'fixed at its own point, an enemy\'s cut-off 100');
  check(makeFireObject({ tech: TECH.rafoie, level: 0, x: 0, y: 0, z: 0, heading: 0 }) === null, 'no Rafoie without a target');
}

// --- Rabarta ---------------------------------------------------------------------
{
  const r = new RabartaField({ level: 0, x: 0, y: 0, z: 0, heading: 0 });
  near(r.rangeH, techData(TECH.rabarta, 0).rangeH, 'Rabarta radius from the data');
  eq(r.life, 25, 'Lv1 lives 25 + 1 updates');
  const ts = [T(1, 30, 0, 8), T(2, 80, 0, 8)];
  let frames = 0;
  const got: number[] = [];
  while (!r.done && frames < 100) {
    r.step(ts, ts.length, hits);
    for (const h of hits) got.push(h.id);
    frames++;
  }
  eq(frames, 26, 'ends when frames > cast');
  eq(got, [1], 'the near one once, the far one not');
  ts[1].x = 40;
  const late = new RabartaField({ level: 0, x: 0, y: 0, z: 0, heading: 0 });
  late.step(ts, 1, hits);
  late.step(ts, 2, hits);
  eq(hits.map((h) => h.id), [2], 'one that steps in later is hit then');
  eq(new RabartaField({ level: 15, x: 0, y: 0, z: 0, heading: 0 }).life, 10, 'Lv16 lives 10');
}

// --- the target selection --------------------------------------------------------
{
  const d = techData(TECH.foie, 0);
  const p = { rangeH: d.rangeH, rangeV: d.unknown1 ? 10 : 10, angleH: d.angleH, angleV: d.angleV, targets: d.targets };
  const c = (id: number, x: number, z: number, y = 20, radius = 8): Candidate => ({ id, x, y, z, radius });
  const out: Candidate[] = [];
  eq(p.angleH, 2730, 'Foie Lv1 half angle 2730 BAMS (15 degrees)');
  eq(p.angleV, 7281, 'and the vertical 40 degrees');
  let n = pickTechTargets(0, 20, 0, 0, p, [c(1, 0, 60), c(2, 0, 30)], null, out);
  eq([n, out.map((x) => x.id)], [1, [2]], 'a single-target technique takes the nearest');
  n = pickTechTargets(0, 20, 0, 0, p, [c(1, 0, 125), c(2, 40, 30), c(3, -3, -20)], null, out);
  eq([n, out.map((x) => x.id)], [0, []], 'out of reach (110 + 8), outside 15 degrees, behind');
  n = pickTechTargets(0, 20, 0, 0, p, [c(1, 0, 117)], null, out);
  eq(n, 1, 'reach is radius + range_h + range_v = 118');
  n = pickTechTargets(0, 20, 0, 0, p, [c(1, 0, 119)], null, out);
  eq(n, 0, 'just beyond');
  n = pickTechTargets(0, 20, 0, 0, p, [c(1, 0, 40, 20 + 50)], null, out);
  eq(n, 0, 'too high: the elevation seen from the apex 10 behind (45 degrees) exceeds 40');
  n = pickTechTargets(0, 20, 0, 0, p, [c(1, 0, 40, 20 + 40)], null, out);
  eq(n, 1, 'a lower one passes (38.7 degrees)');
  // the apex is 10 behind: a target close beside the player is inside the cone
  n = pickTechTargets(0, 20, 0, 0, p, [c(1, 3, 8)], null, out);
  eq(n, 1, 'close, 20 degrees off from the weapon but inside the cone of the apex 10 behind');
  // a primary target alone
  n = pickTechTargets(0, 20, 0, 0, p, [c(1, 0, 30), c(2, 1, 60)], 2, out);
  eq([n, out.map((x) => x.id)], [1, [2]], 'with a primary and one target only it counts');
  n = pickTechTargets(0, 20, 0, 0, p, [c(1, 0, 30)], 9, out);
  eq(n, 0, 'a primary that is not a candidate leaves none');
  // many targets: Gizonde-like list, nearest first, capped
  const many = { rangeH: 200, rangeV: 0, angleH: 0x8000, angleV: 0, targets: 3 };
  n = pickTechTargets(0, 0, 0, 0, many, [c(1, 0, 90), c(2, 0, -30), c(3, 40, 0), c(4, 0, 10), c(5, 100, 100)], null, out);
  eq(out.map((x) => x.id), [4, 2, 3], 'a full circle takes the nearest three');
  // Rabarta-like: no cone at all
  const tech = techData(TECH.rabarta, 0);
  n = pickTechTargets(0, 0, 0, 0, { rangeH: tech.rangeH, rangeV: tech.unknown1 ? 0 : 0, angleH: tech.angleH, angleV: tech.angleV, targets: tech.targets }, [c(1, -20, -20)], null, out);
  eq(n, 1, 'a full-circle technique ignores the facing');
  // The origin is the player's weapon_position: the feet (weaponPositionY, bloodstain ASSUMED 0),
  // not the old WEAPON_HEIGHT 20 above them. A target 45 up at 40 out is past the 40 degree
  // vertical cone from the feet and inside it from 20 up (the vertical cone's apex is wy).
  const high = c(7, 0, 40, 45);
  n = pickTechTargets(0, weaponPositionY(0), 0, 0, p, [high], null, out);
  eq(n, 0, 'from the feet the 45-high target is outside the 40 degree cone');
  n = pickTechTargets(0, WEAPON_HEIGHT, 0, 0, p, [high], null, out);
  eq(n, 1, 'the old origin 20 up would have taken it (the change is the origin)');
  eq(weaponPositionY(0), 0, 'the weapon position height is the feet with the bloodstain offset zero');
  eq(weaponPositionY(3, 40), 23, 'weapon position = feet + 0.5 * bloodstain offset (player +0xe3c)');
}

// --- the effect tables ------------------------------------------------------------
{
  const ids = (e: readonly { id: number }[]) => e.map((x) => x.id);
  eq(ids(startEmitters('foie', 0)), [0x18, 0x14], 'Foie Lv1: the muzzle burst and the body');
  eq(ids(startEmitters('foie', 3)), [0x18, 0x14, 0xac], 'Foie tier 3');
  eq(ids(startEmitters('foie', 5)), [0x18, 0x19e, 0x14, 0xac, 0x19c], 'Foie tier 5');
  near(startEmitters('foie', 4)[1].scale, 1.8, 'Foie tier 4 scale 1.8');
  eq(ids(startEmitters('barta', 5)), [0x190, 0x191, 0x192, 0x198, 0x193, 0x1d8, 0x1d7], 'Barta tier 5 with its three model entries (flag 0x20)');
  eq(ids(startEmitters('gibarta', 2)), [0x180, 0x181, 0x184], 'Gibarta tier 2 with its spike model 0x184 (flag 0x20)');
  check(startEmitters('gibarta', 2).every((e) => e.mode === 'fixed'), 'Gibarta\'s emitters stay');
  check(startEmitters('barta', 0).every((e) => e.mode === 'follow'), 'Barta\'s follow');
  eq(ids(startEmitters('rabarta', 0)), [0x1d9, 0x1db, 0x1df], 'Rabarta tier 0 with its model 0x1df (flag 0x20)');
  eq(ids(startEmitters('gifoie', 5)), [0x22, 0xac, 0x19e], 'Gifoie tier 5');
  eq(ids(rafoieBlastEmitters(3)), [0x1eb, 0x1ee], 'Rafoie blast tier 3');
  eq(ids(rafoieBlastEmitters(5)), [0x18c, 0x1ee, 0x1e2, 0x1e6], 'tier 5 (0x1e2 hidden, 0x1e6 follows)');
  eq(ids(startEmitters('rafoie', 0, false)), [0x39, 0x1a], 'Rafoie list form mark and its ring 0x1a');
  eq(ids(startEmitters('rafoie', 0, true)), [0x1a, 0x3a, 0x3b], 'fixed form: the ring 0x1a, then the marks');
  eq([FIRE_SE.start.foie, FIRE_SE.start.rabarta, FIRE_SE.foieHit, FIRE_SE.rafoieBlast], [0x87, 0x8d, 0xaf, 0x8a], 'sound ids');
  eq([0, 1, 2, 3, 4, 5].map((t) => startPitch('foie', t)), [0x100, 0, 0, -0x180, -0x250, -0x100], 'Foie pitch by tier');
  eq([0, 1, 2, 3, 4, 5].map((t) => startPitch('barta', t)), [0x100, 0, -0x180, -0x180, -0x250, -0x100], 'Barta pitch by tier');
}

// --- enemy shots -----------------------------------------------------------------
{
  const player = (id: number, x: number, z: number): AiTarget => ({ clientId: id, x, z, charClass: 0, dead: false });
  const s = enemyFire({ tech: TECH.foie, level: 3, x: 0, y: 12, z: 0, heading: 0, enemy: true });
  check(s instanceof FireShot, 'an enemy Foie is a shot');
  const eff = s!.effect;
  check(eff.kind === 'tech' && eff.power === techPower(TECH.foie, 3) && !('status' in eff), 'its power and no status');
  let got: AiTarget[] = [];
  let ticks = 0;
  const ps = [player(2, 0, 25), player(3, 50, 25)];
  while (!s!.done && ticks++ < 100) {
    got = s!.tick(ps);
    if (got.length) break;
  }
  eq(got.map((t) => t.clientId), [2], 'it hits the player in its way (radius 5)');
  check(s!.done, 'and is spent');
  near(s!.y, 12, 'its height above the launch ground');
  const g = enemyFire({ tech: TECH.gibarta, level: 0, x: 0, y: 12, z: 0, heading: 0, enemy: true })!;
  const ge = g.effect;
  check(ge.kind === 'tech' && ge.status?.type === STATUS.freeze && Math.abs(ge.status.chance - 0.75) < 1e-6, 'an enemy Gibarta freezes with 0.75');
  const rb = enemyFire({ tech: TECH.rabarta, level: 0, x: 0, y: 0, z: 0, heading: 0, enemy: true })!;
  check(rb.effect.kind === 'tech' && !!rb.effect.status, 'and Rabarta');
  const gi = enemyFire({ tech: TECH.gifoie, level: 0, x: 0, y: 0, z: 0, heading: 0, enemy: true })!;
  check(gi.fire instanceof GifoieRing && gi.effect.kind === 'tech' && !gi.effect.status, 'Gifoie has no status');
  // dead players are ignored
  const dead = enemyFire({ tech: TECH.rabarta, level: 0, x: 0, y: 0, z: 0, heading: 0, enemy: true })!;
  eq(dead.tick([{ ...player(1, 5, 5), dead: true }]).length, 0, 'a dead player is not hit');
  // power override
  const w = enemyFire({ tech: TECH.foie, level: 0, x: 0, y: 0, z: 0, heading: 0, enemy: true, power: 77 })!;
  check(w.effect.kind === 'tech' && w.effect.power === 77, 'a brain\'s power');
  check(!enemyFire({ tech: TECH.rafoie, level: 0, x: 0, y: 0, z: 0, heading: 0, enemy: true }), 'Rafoie needs a target');
}

// --- the view: emitters and sounds ------------------------------------------------------
{
  interface Spawn {
    id: number;
    persistent: boolean;
    track: boolean;
    alive: (() => boolean) | null;
    scale: number;
    at: unknown;
  }
  const spawns: Spawn[] = [];
  const sounds: number[][] = [];
  const fx = {
    spawn(p: { id: number; duration?: number; scale?: readonly [number, number] }, at: unknown, _follow: boolean, track: boolean, alive: (() => boolean) | null) {
      spawns.push({ id: p.id, persistent: p.duration !== undefined, track, alive, scale: p.scale?.[0] ?? 1, at });
      return Promise.resolve();
    },
    // The fire sphere's model (render/rafoiesphere.ts): no model in the test, so no sphere object.
    models: { particleModel: () => Promise.resolve(null) },
    attach() {},
    detach() {},
  } as unknown as FieldParticles;
  const make = () => new TechFire({ fx: () => fx, sound: (id, x, y, z) => sounds.push([id, x, y, z]) });

  // Foie Lv1: the muzzle burst, the body follows the ball, the creation sound.
  let tf = make();
  const foie = new FoieBolt({ level: 0, x: 0, y: 20, z: 0, heading: 0 });
  const got: number[] = [];
  tf.start(foie, (_o, t) => got.push(t.id));
  eq(spawns.map((s) => [s.id, s.persistent, !!s.track]), [[0x18, false, false], [0x14, true, true]], 'Foie: burst + a following body');
  eq(sounds[0].slice(0, 1), [0x87], 'the creation sound');
  check(spawns[1].alive!(), 'the emitter lives with the object');
  const tgt = [T(4, 0, 12)];
  tf.tick(tgt, 1);
  tf.tick(tgt, 1);
  eq(got, [4], 'the hit goes to the caller');
  eq(sounds.map((s) => s[0]), [0x87, 0xaf], 'and Foie\'s hit sound plays at the target');
  check(!spawns[1].alive!() && tf.active === 0, 'the emitter stops and the object is dropped');

  // Gifoie tier 5: three emitters, each with three following particles.
  spawns.length = 0;
  tf = make();
  tf.start(new GifoieRing({ level: 25, x: 0, y: 0, z: 0, heading: 0 }), null);
  eq(spawns.length, 9, 'Gifoie tier 5: 3 x 3 emitters');
  check(spawns.every((s) => s.persistent && s.track), 'all persistent and following');

  // Rafoie (list form): the ring mark at the start, the blast with the 10th tick.
  spawns.length = 0;
  sounds.length = 0;
  tf = make();
  const raf = new RafoieBlast({ level: 0, x: 40, y: 22, z: 0, heading: 0 }, 9);
  tf.start(raf, null);
  eq(spawns.map((s) => s.id), [0x39, 0x1a], 'the list form\'s mark and ring');
  eq(sounds.length, 0, 'and no creation sound in the list form');
  for (let i = 0; i < 10; i++) tf.tick([T(9, 40, 0)], 1);
  eq(spawns.slice(2).map((s) => s.id), [0x1ee], 'the tier 0 blast');
  eq(sounds.map((s) => s[0]), [0x8a], 'and its sound');
  near(sounds[0][1], 40, 'at the target');

  // An enemy's object: attached, drawn from the shot's state, ended with the shot.
  spawns.length = 0;
  tf = make();
  const shot = enemyFire({ tech: TECH.barta, level: 0, x: 0, y: 0, z: 0, heading: 0, enemy: true })!;
  tf.attach(shot, 100);
  eq(spawns.map((s) => s.id), [0x190, 0x191, 0x192], 'Barta tier 0');
  const first = spawns[0].at as () => { y: number };
  near(first().y, 105, 'the shot is above its launch ground', 1e-6);
  shot.tick([]);
  tf.tick([], 0);
  check(spawns[0].alive!(), 'alive while flying');
  shot.done = true;
  tf.tick([], 0);
  check(!spawns[0].alive!() && tf.active === 0, 'its removal ends the emitters');
  tf.clear();
}

// --- Dark Falz' reach --------------------------------------------------------------
near(techReach(TECH.rafoie, 10), techData(TECH.rafoie, 10).rangeH + 5, 'Rafoie\'s reach is range_h + the player\'s radius');
near(techReach(TECH.rabarta, 0), 45, 'Rabarta Lv1 reaches 45');
// Jellen / Zalure (0x006e7998 / 0x006f1eb0): the probe is range_h, the player adds 5, strict.
check(inTechReach(TECH.jellen, 4, 54.99) && !inTechReach(TECH.jellen, 4, 55), 'Jellen at level 4: just inside 55, not 55');
check(inTechReach(TECH.zalure, 10, 78.99) && !inTechReach(TECH.zalure, 10, 79), 'Zalure at level 10: just inside 79, not 79');
near(techData(TECH.rafoie, 10).rangeH, 120, 'Rafoie Lv11 range_h 120');

// --- Enemy aim height (check_enemy_is_targetable: the hit box centre) -------------
// The table is the one the enemy's own constructor sets (formats/enemyboxes.ts), from the
// .dat set type: Monest 0x42 -> 0x009bb780 (factory 0x00519144 -> ctor 0x005191c0 ->
// 0x0051ff3c with the table, dump 0x0051926c) = (0, 0, 0), so 0. Hildebear 0x40 ->
// 0x009bb58c (0, 20, 0) -> 20. Dark Gunner 0xa2 is its own factory 0x00545e54 -> 0x009bd0dc
// (0, 3.5, 0). Booma 0x44: no box call is reached from its factory (its box is set through
// a vtable, not followed) -> the ASSUMED fallback. An unknown type falls back too.
check(enemyAimHeight(0x42) === 0, `Monest aims at its own box (got ${enemyAimHeight(0x42)})`);
check(enemyAimHeight(0x40) === 20, `Hildebear aims at its box centre (got ${enemyAimHeight(0x40)})`);
check(enemyAimHeight(0xa2) === 3.5, `Dark Gunner aims at its box (got ${enemyAimHeight(0xa2)})`);
check(enemyAimHeight(0x44) === AIM_HEIGHT, 'Booma without its variant falls back to AIM_HEIGHT (the index is the set record +0x40)');
check(enemyAimHeight(0x44, null, 0) === 12.5, `Booma variant 0 aims at its box centre 12.5 (got ${enemyAimHeight(0x44, null, 0)})`);
check(enemyAimHeight(0x44, null, 1) === 12.5, `Gobooma (variant 1) aims at 12.5 (got ${enemyAimHeight(0x44, null, 1)})`);
check(enemyAimHeight(0x44, null, 2) === 15, `Gigobooma (variant 2) aims at its box centre 15 (got ${enemyAimHeight(0x44, null, 2)})`);
check(enemyAimHeight(0x44, null, 3) === AIM_HEIGHT, 'a Booma variant with no box row set falls back to AIM_HEIGHT');
check(enemyAimHeight(null) === AIM_HEIGHT, 'no type falls back to AIM_HEIGHT');
check(enemyAimHeight(0xfff0) === AIM_HEIGHT, 'a type with no table falls back');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('techfire: ok');
