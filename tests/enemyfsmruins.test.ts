// Ruins FSMs (combat/enemyfsmruins.ts) and their shots (combat/enemyshots.ts):
// Bulclaw / Bulk / Claw, Dark Belra, Dark Gunner and its control, Chaos
// Bringer, Chaos Sorcerer, Delsaber, the confused target search and the Del
// Lily's Megid.
// Run: node tests/enemyfsmruins.test.ts
import {
  BELRA,
  BelraAi,
  BRINGER,
  BringerAi,
  BULCLAW,
  BulclawAi,
  CLAW,
  ClawAi,
  delLilyMegid,
  DELSABER,
  DelsaberAi,
  GunnerAi,
  GunnerControl,
  SORCERER,
  SorcererAi,
  updateTarget,
} from '../client/src/combat/enemyfsmruins.ts';
import { BELRA_ARM, BelraArm, GunnerLaser, TechBolt } from '../client/src/combat/enemyshots.ts';
import { aiConfig, collisionRadius, type AiTarget } from '../client/src/combat/enemyai.ts';
import { STATUS } from '../client/src/combat/status.ts';
import { TECH, techPower } from '../client/src/combat/techniques.ts';
import { expandEnemySets } from '../client/src/formats/enemyslots.ts';
import type { EnemySet } from '../client/src/formats/setdata.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-3) => check(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);
const player = (x: number, z: number, extra: Partial<AiTarget> = {}): AiTarget => ({ clientId: 0, x, z, charClass: 0, dead: false, angle: 0, ...extra });
const atk = (distanceX: number, angle = 0x2000) => ({ minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX, angle, distanceY: 0 });
const mv = (f: number[], i: number[]) => ({ fparam1: f[0] ?? 0, fparam2: f[1] ?? 0, fparam3: f[2] ?? 0, fparam4: f[3] ?? 0, fparam5: f[4] ?? 0, fparam6: f[5] ?? 0, iparam: i });

// --- Dimenian: the Booma handlers with its own record -------------------------------
eq(aiConfig('TObjEneDimedian', 0), { detect: 225, turnRate: 1024 }, 'Dimenian search 225');
eq(aiConfig('TObjEneDimedian', 2), { detect: 300, turnRate: 1024 }, 'So Dimenian search 300');
eq([0, 1, 2].map((s) => collisionRadius('TObjEneDimedian', s)), [7, 7, 8], 'Dimenian radii 7 / 7 / 8');

// --- Bulclaw / Bulk / Claw ----------------------------------------------------------
{
  const b = new BulclawAi({ x: 0, z: 0, angle: 0, movement: mv([], [10]), attack: atk(10), radius: 10, phase: 0, rng: () => 0.05 });
  check(b.superArmor, 'an idle Bulclaw is super armor');
  eq(b.rtIndex, 0x28, 'Bulclaw rt 0x28');
  let hits = 0;
  let poison = 0;
  for (let f = 0; f < 400 && b.state !== 'split'; f++) {
    const r = b.tick([player(0, 30)], b.state === 'attack');
    if (r.hit) hits++;
    if (r.status?.type === STATUS.poison) poison++;
  }
  eq(b.state, 'split', 'two swings make it split');
  eq(hits, 2, 'each swing hits once at frame 10');
  eq(poison, 2, 'the 0.1 poison roll');
  eq(b.events, [{ kind: 'split', first: true }], 'the first split asks for the Claws');
  check(b.bulk && b.rtIndex === 0x27, 'now a Bulk (rt 0x27)');
  const ring = [0, 1, 2, 3].map((i) => b.ringSlot(i));
  near(Math.hypot(ring[0].x - b.x, ring[0].z - b.z), BULCLAW.ringRadius, 'ring radius 13');
  near(Math.cos(ring[1].angle - ring[0].angle), 0, 'ring every 90 degrees');
  near(Math.sin(ring[1].angle - ring[0].angle), 1, 'ring turning the same way');
  b.events = [];
  for (let f = 0; f < BULCLAW.splitHold + 2; f++) b.tick([player(0, 30)]);
  eq(b.state, 'flee', 'the Bulk flees from its target');
  const d0 = Math.hypot(b.x, b.z - 30);
  for (let f = 0; f < 30; f++) b.tick([player(0, 30)]);
  check(Math.hypot(b.x, b.z - 30) > d0 + 10, 'it moves away');
  // Merge: no target, two Claws near.
  const c1 = new ClawAi({ x: b.x + 40, z: b.z, angle: 0, attack: atk(10), radius: 10 });
  const c2 = new ClawAi({ x: b.x - 40, z: b.z, angle: 0, attack: atk(10), radius: 10 });
  b.candidates = [c1, c2];
  for (let f = 0; f < 90 && b.state !== 'merge'; f++) b.tick([]);
  eq(b.state, 'merge', 'no target: the Bulk calls its Claws');
  eq([c1.state, c2.state], ['merge', 'merge'], 'the Claws come');
  for (let f = 0; f < 60 && !b.events.length; f++) {
    c1.tick([]);
    c2.tick([]);
    b.tick([]);
  }
  eq(b.events[0]?.kind, 'absorb', 'within 15 they are absorbed');
  check(c1.absorbed && c1.invulnerable, 'an absorbed Claw cannot be hit');
  for (let f = 0; f < 120; f++) b.tick([], true);
  check(!b.bulk, 'the merge makes it a Bulclaw again');
  // The self-destruct: a flinch ending at <= iparam1 %.
  const k = new BulclawAi({ x: 0, z: 0, angle: 0, movement: mv([], [10]), attack: atk(10), radius: 10, rng: () => 0.9 });
  k.bulk = true;
  k.hpFraction = 0.08;
  k.onDamage(0);
  eq(k.resume(), 'destruct', 'HP <= 10 %: self-destruct');
  let blown = false;
  for (let f = 0; f < 200 && !blown; f++) {
    k.tick([player(0, 15)], k.state === 'destruct');
    blown = k.events.some((e) => e.kind === 'blown');
  }
  check(blown, 'it blows up at the end of the row');
}
{
  const c = new ClawAi({ x: 0, z: 0, angle: 0, attack: atk(10), radius: 5, phase: 0 });
  let hit = 0;
  for (let f = 0; f < 120; f++) if (c.tick([player(0, 15)], c.state === 'bite').hit) hit++;
  check(hit >= 1, 'a Claw inside 20 bites');
  const z = c.z;
  for (let f = 0; f < 10 && c.state === 'back'; f++) c.tick([player(0, 15)]);
  check(c.state !== 'back' || c.z < z, 'then it backs off at 0.6');
  eq(CLAW.backOff, 120, 'the back-off lasts 120 frames');
}

// --- Dark Belra ---------------------------------------------------------------------
{
  const b = new BelraAi({ x: 0, z: 0, angle: 0, ultimate: false, attack: atk(15), radius: 10, rng: () => 0.2 });
  check(b.invulnerable, 'the Belra is invulnerable before it appears');
  b.tick([player(0, 200)]);
  eq(b.state, 'appear', 'a player within 400 makes it appear');
  for (let f = 0; f < BELRA.fadeIn; f++) b.tick([player(0, 200)]);
  eq(b.state, 'chase', 'after the fade-in it walks');
  const z0 = b.z;
  b.tick([player(0, 200)]);
  b.tick([player(0, 200)]);
  near(b.z - z0, BELRA.walk, 'it walks 0.28 a frame');
  let shots = 0;
  for (let f = 0; f < 400 && !shots; f++) shots += b.tick([player(0, 200)], false).shots?.length ?? 0;
  eq(shots, 1, 'after 40 units it throws an arm');
  check(b.flinches(20, 100) && !b.flinches(19, 100), 'only a hit of max HP / 5 flinches');
  const arm = new BelraArm(0, 20, 0, 0, true);
  const struck = new Set<number>();
  for (let f = 0; f < 40 && !arm.done; f++) for (const t of arm.tick([player(0, 60)])) struck.add(t.clientId);
  eq([...struck], [0], 'the arm hits the player once and pierces');
  check(arm.done, 'it ends after 300 units');
  eq(arm.effect.kind === 'melee' && arm.effect.attack, 1, 'the arm uses AttackData entry 19');
  check(arm.effect.kind === 'melee' && arm.effect.status?.type === STATUS.confusion, 'Ultimate: the arm confuses');
  near(BELRA_ARM.radius, 5.4, 'the arm radius 3 * 1.8');
  // The punch: within 30, paralysis at <= 1/3.
  const p = new BelraAi({ x: 0, z: 0, angle: 0, ultimate: false, attack: atk(15), radius: 10, rng: () => 0.2 });
  for (let f = 0; f < 30; f++) p.tick([player(0, 20)]);
  let par = 0;
  let hit = 0;
  for (let f = 0; f < 60; f++) {
    const r = p.tick([player(0, 20)], p.state === 'punch');
    if (r.hit) hit++;
    if (r.status?.type === STATUS.paralysis) par++;
    if (hit) break;
  }
  check(hit === 1 && par === 1, 'the punch hits and paralyses');
  // Confused: it spins and throws.
  const c = new BelraAi({ x: 0, z: 0, angle: 0, ultimate: false, attack: atk(15), radius: 10 });
  for (let f = 0; f < 30; f++) c.tick([player(0, 200)]);
  c.confused = true;
  c.tick([player(0, 200)]);
  eq(c.state, 'confused', 'confusion: the spin');
  for (let f = 0; f < 30 && c.state === 'confused'; f++) c.tick([player(0, 200)]);
  eq(c.state, 'throw', 'then it throws');
}

// --- Dark Gunner / control ----------------------------------------------------------
{
  const m = mv([7, 100, 2.5, 6], [20, 240, 1500, 250]);
  const gs = [0, 1, 2].map((i) => new GunnerAi({ x: i * 10, z: 0, angle: 0, movement: m }));
  check(gs[0].invulnerable && gs[0].shield, 'a dormant gunner: untargetable, shielded');
  const ctl = new GunnerControl(10, 0, 0);
  const t = [player(10, 300)];
  const run = (n: number) => {
    for (let f = 0; f < n; f++) {
      ctl.tick(gs, t);
      for (const g of gs) g.tick(t, true);
    }
  };
  run(31);
  eq(ctl.state, 1, 'a player within 1000: the fan');
  run(GUNNER_WAIT());
  check(gs.every((g) => g.state !== 'dormant'), 'the dash request wakes them');
  run(400);
  check(gs.filter((g) => g.death).length === 1, 'one Death Gunner');
  let lasers = 0;
  for (let f = 0; f < 600; f++) {
    ctl.tick(gs, t);
    for (const g of gs) lasers += g.tick(t, true).shots?.length ?? 0;
  }
  check(lasers > 0, 'the dashes bring them within 200: volleys');
  const g = new GunnerAi({ x: 0, z: 0, angle: 0, movement: m });
  g.requestDash();
  for (let f = 0; f < 20; f++) g.tick([], true);
  g.requestShoot();
  check(!g.shield, 'shooting drops the shield');
  let shot: GunnerLaser | null = null;
  for (let f = 0; f < 200 && !shot; f++) shot = (g.tick([player(0, 100)], true).shots?.[0] as GunnerLaser) ?? null;
  check(shot !== null, 'it fires at a player within 200');
  if (shot) {
    let hit = false;
    for (let f = 0; f < 100 && !shot.done; f++) hit ||= shot.tick([player(0, 100)]).length > 0;
    check(hit, 'the laser flies at fparam4 and hits');
    eq(shot.effect, { kind: 'tech', power: 250, knockback: 3 }, 'tech power iparam4, knockback 3');
  }
  g.death = true;
  check(g.superArmor, 'the Death Gunner shooting does not flinch');
  g.requestStun();
  eq(g.state, 'stun', 'the group stun');
  check(!g.shield, 'stunned: no shield');
}
function GUNNER_WAIT(): number {
  return 92;
}

// --- Chaos Bringer ------------------------------------------------------------------
{
  const m = mv([5, 0.8, 1, 1, 0, 20], [0, 30, 300, 400, 30, 150]);
  const b = new BringerAi({ x: 0, z: 0, angle: 0, ultimate: false, movement: m, attack: atk(20), radius: 7, phase: 0, rng: () => 0.1 });
  for (let f = 0; f < 30; f++) b.tick([player(0, 250)]);
  eq(b.state, 'appear', 'a target within 300 (searched every 30 frames): it appears');
  check(b.invulnerable, 'invulnerable during the fade-in');
  for (let f = 0; f < 80; f++) b.tick([player(0, 250)], true);
  eq(b.state, 'charge', 'farther than iparam6 (150): the charge');
  let tech = 0;
  for (let f = 0; f < 200 && b.state === 'charge'; f++) {
    const r = b.tick([player(0, 250)], true);
    if (r.techHit) {
      tech++;
      eq(r.techHit.power, 300, 'the charge hits with iparam3');
      eq(r.techHit.status?.type, STATUS.confusion, 'with the confusion roll');
    }
  }
  eq(tech, 1, 'each player once per charge');
  for (let i = 0; i < 6; i++) b.onDamage(0);
  check(b.hits > BRINGER.laserHits, 'hits count');
  b.resume();
  eq(b.state, 'laser', 'five hits: the laser');
  let drain = 0;
  let laser: TechBolt | null = null;
  b.drained(200);
  for (let f = 0; f < 300 && !laser; f++) {
    const r = b.tick([player(0, 120)], f % 40 === 39);
    if (r.tpDrain) drain = r.tpDrain;
    laser = (r.shots?.[0] as TechBolt) ?? laser;
  }
  eq(drain, 0.25, 'the TP drain 25 %');
  check(laser !== null && laser.effect.kind === 'tech' && laser.effect.power === 800, 'the laser: iparam4 * 2 after 151 TP');
}

// --- Chaos Sorcerer -----------------------------------------------------------------
{
  const s = new SorcererAi({ x: 0, z: 0, angle: 0, ultimate: false, movement: mv([], [5, 5, 3]) });
  check(s.invulnerable && s.hidden, 'it lurks hidden');
  for (let f = 0; f < 30; f++) s.tick([player(0, 200)]);
  eq(s.state, 'appear', 'a non-Ranger within 250');
  near(Math.hypot(s.x, s.z - 200), SORCERER.placeFirst, 'it appears 50 from the target');
  check(s.invulnerable, 'invulnerable while warping in');
  for (let f = 0; f < 60; f++) s.tick([player(0, 200)], true);
  eq(s.state, 'attack', 'then the attack cast');
  let bolt: TechBolt | null = null;
  for (let f = 0; f < 200 && !bolt; f++) bolt = (s.tick([player(0, 200)], true).shots?.[0] as TechBolt) ?? null;
  check(bolt !== null && bolt.effect.kind === 'tech' && bolt.effect.power === techPower(TECH.gizonde, 5), 'Gizonde at iparam1 from bit 1');
  check(s.superArmor, 'never flinches');
  const r = new SorcererAi({ x: 0, z: 0, angle: 0, ultimate: false, movement: mv([], [5, 5, 3]) });
  for (let f = 0; f < 30; f++) r.tick([player(0, 380, { charClass: 3 })]);
  eq(r.state, 'appear', 'a Ranger is seen from 400');
}

// --- Delsaber -----------------------------------------------------------------------
{
  const m = mv([1, 10, 0.6, 1], []);
  const d = new DelsaberAi({ x: 0, z: 0, angle: 0, param1: 0, movement: m, attacks: [atk(15), atk(20), atk(18)], phase: 0, guardDrain: () => 30 });
  eq(d.maxShield, 100, 'shield = param1 + 100');
  check(d.invulnerable, 'hidden: invulnerable');
  for (let f = 0; f < 31; f++) d.tick([player(0, 180)]);
  eq(d.state, 'appear', 'within 200 it appears');
  for (let f = 0; f < 200 && d.state !== 'jump'; f++) d.tick([player(0, 180)]);
  eq(d.state, 'jump', 'far (>= 150) and in line: the jump');
  const before = d.z;
  for (let f = 0; f < 60 && d.state === 'jump'; f++) d.tick([player(0, 180)], f > 40);
  check(d.z - before > 100, 'the leap covers distance - 15');
  // Guard: an attacking player within 30 facing it.
  const g = new DelsaberAi({ x: 0, z: 0, angle: 0, param1: 0, movement: m, attacks: [atk(15), atk(20), atk(18)], phase: 0, guardDrain: () => 60 });
  for (let f = 0; f < 70; f++) g.tick([player(0, 25, { angle: Math.PI })]);
  g.tick([player(0, 25, { angle: Math.PI, attacking: true })]);
  eq(g.state, 'guard', 'a swing in front: the guard');
  check(g.invulnerable, 'guarding: invulnerable');
  eq(g.shield, 40, 'the guard drains the shield');
  for (let f = 0; f < 40; f++) g.tick([player(0, 25, { angle: Math.PI, attacking: true })]);
  check(g.broken && g.shield === 0, 'drained below 1: broken');
}

// --- confusion: EnemyUpdateTarget ---------------------------------------------------
{
  const p = player(0, 100);
  const e: AiTarget = { clientId: 0x1005, x: 0, z: 40, charClass: -1, dead: false };
  eq(updateTarget([p, e], 0, 0, 250)?.clientId, 0x1005, 'confused: the nearer enemy');
  eq(updateTarget([e], 0, 0, 250), null, 'no player in range: no target');
  eq(updateTarget([p], 0, 0, 250)?.clientId, 0, 'players only');
}

// --- Del Lily Megid -----------------------------------------------------------------
{
  const m = delLilyMegid(0, 0, 0, 18, false);
  eq(m.effect, { kind: 'megid', power: techPower(TECH.megid, 13) }, 'Del Lily: Megid level clamped to 13 (Lv14)');
  eq(techPower(TECH.megid, 13), 66, 'Lv14 Megid power 66');
}

// --- slots --------------------------------------------------------------------------
{
  const set = (type: number, numChildren = 0): EnemySet =>
    ({ kind: 'enemy', type, index: 0, numChildren, section: 0, wave: 0, wave2: 0, unknownA1: 0, params: [0, 0, 0, 0, 0, 0, 0] }) as unknown as EnemySet;
  eq(
    expandEnemySets([set(0xa7)], 13, 0).map((s) => s.type),
    ['BULCLAW', 'CLAW', 'CLAW', 'CLAW', 'CLAW'],
    'a Bulclaw and its 4 Claw slots',
  );
}

if (failures) {
  console.log(`enemyfsmruins: ${failures} failures`);
  process.exit(1);
}
console.log('enemyfsmruins: all checks passed');
