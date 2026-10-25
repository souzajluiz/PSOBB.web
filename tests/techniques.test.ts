// Techniques (combat/techniques.ts): the technique table, the per-level
// scaling of GetTechniqueData_006ded14, TP costs, power, the damage / heal
// formulas, the cast state machine and the 6x8D / 6x47 / 6x48 bytes, checked
// against values worked out by hand from PsoBB.exe's tables (0x009cf3c0,
// 0x009cf720, 0x009cc550) and newserv's CommandFormats.hh.
// Run: node tests/techniques.test.ts
import {
  castMotion,
  megidChance,
  releaseFrame,
  remoteRestaHeal,
  restaHeal,
  splitLevel,
  targetListKind,
  TECH,
  TechCast,
  techData,
  techDamage,
  techGroup,
  techHitShowsNumber,
  techPower,
  techTookDamageMin,
  techTpCost,
} from '../client/src/combat/techniques.ts';
import { TOOK_DAMAGE_NEVER } from '../client/src/combat/formulas.ts';
import {
  buildCastTechnique,
  buildCastTechniqueComplete,
  buildTechLevelOverride,
  parseCastTechnique,
  parseCastTechniqueComplete,
  parsePlayerSync,
} from '../client/src/net/game.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string) => check(Math.abs(a - b) < 1e-3, `${what}: ${a} != ${b}`);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const noResist = { efr: 0, eic: 0, eth: 0, elt: 0, edk: 0 };

// --- TP cost: trunc(tp_cost + level * v_tp_cost / 100) (fistp, truncating) ---
eq(
  Array.from({ length: 30 }, (_, l) => techTpCost(TECH.foie, l)),
  [5, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20, 21, 23, 24, 25, 27, 28, 29, 31, 32, 33, 34, 36, 37, 38, 40, 41, 42],
  'Foie TP Lv1..30',
);
eq(techTpCost(TECH.megid, 0), 30, 'Megid Lv1 TP');
eq(techTpCost(TECH.megid, 19), 49, 'Megid Lv20 TP (30 + 19 * 1.05 = 49.95)');
eq(techTpCost(TECH.resta, 0), 15, 'Resta Lv1 TP');
eq(techTpCost(TECH.gifoie, 2), 21, 'Gifoie Lv3 TP (20 + 1.4)');
eq(techTpCost(TECH.reverser, 20), 20, 'Reverser: fixed TP');
eq(techTpCost(TECH.ryuker, 0), 10, 'Ryuker: fixed TP');

// --- per-level scaling ---
{
  const f = techData(TECH.foie, 29);
  eq([f.rangeH, f.charge, f.unknown1, f.cast, f.angleH], [350, 0, 620, 10, 5005], 'Foie Lv30 range / charge / unknown1 / cast / angle');
  const f1 = techData(TECH.foie, 0);
  eq([f1.rangeH, f1.charge, f1.cast, f1.angleH, f1.targets], [100, 5, 15, 2730, 1], 'Foie Lv1 (angle halved)');
  const m = techData(TECH.megid, 29);
  eq([m.rangeH, m.unknown1, m.cast, m.angleH], [200, 972, 20, 8190], 'Megid Lv30');
  eq([techData(TECH.barta, 29).rangeH, techData(TECH.barta, 29).cast, techData(TECH.barta, 29).angleH], [240, 10, 13651], 'Barta Lv30 (90 + 30 * (29 / 5))');
  eq([techData(TECH.gibarta, 29).cast, techData(TECH.gibarta, 29).angleH], [25, 24575], 'Gibarta Lv30');
  eq(techData(TECH.gifoie, 10).cast, 40, 'Gifoie: fixed cast 40');
  eq(techData(TECH.gifoie, 0).angleH, 32768, 'Gifoie: full circle (65536 / 2)');
  eq(techData(TECH.resta, 1).targets, 0, 'Resta Lv2: caster only');
  eq(techData(TECH.resta, 2).targets, 10, 'Resta Lv3: party');
  eq(techData(TECH.anti, 0).targets, 0, 'Anti Lv1: caster only');
  near(techData(TECH.resta, 0, 6).rangeH, 120, 'FOmarl Resta range x (1 + 1.0)');
  near(techData(TECH.grants, 0, 10).power, 1534, 'FOmar Grants power x 1.3');
}

// --- power (GetTechniquePower_006dec5c) ---
eq(techPower(TECH.foie, 0), 110, 'Foie Lv1 power');
eq(techPower(TECH.foie, 14), 110 + 50 * 14, 'Foie Lv15 power');
eq(techPower(TECH.foie, 15), -85 + 65 * 15, 'Foie Lv16 power (0x009cf720)');
eq(techPower(TECH.foie, 29), -85 + 65 * 29, 'Foie Lv30 power');
eq(techPower(TECH.megid, 20), 42 + 2 * 20, 'Megid Lv21 power');
eq(techPower(TECH.gifoie, 0), 260, 'Gifoie Lv1 power');

// --- damage: (MST + power) * (1 + class boost) * (100 - resist) * 0.002 ---
near(techDamage(TECH.foie, 0, 100, 6, noResist), 42, 'FOmarl Foie Lv1, MST 100');
near(techDamage(TECH.foie, 0, 100, 8, noResist), Math.fround(Math.fround(210 * 1.3) * 0.2), 'FOnewearl Foie Lv1 (boost 0.3)');
near(techDamage(TECH.foie, 0, 100, 6, { ...noResist, efr: 50 }), 21, 'EFR 50 halves fire');
near(techDamage(TECH.barta, 0, 100, 6, { ...noResist, eic: 30 }), Math.fround(150 * Math.fround(70 * 0.002)), 'Barta reads EIC');
near(techDamage(TECH.zonde, 0, 100, 6, { ...noResist, efr: 90, eth: 20 }), Math.fround(180 * Math.fround(80 * 0.002)), 'Zonde reads ETH');
near(techDamage(TECH.grants, 0, 100, 0, { ...noResist, elt: 10 }), Math.fround(1280 * Math.fround(90 * 0.002)), 'Grants reads ELT');
near(megidChance(0, 10), 0.17, 'Megid Lv1 vs EDK 10');
eq(restaHeal(0, 100), 100, 'Resta Lv1, MST 100: 100 * 0.5 + 50');
eq(restaHeal(9, 150), 75 + 50 + 5 * 9, 'Resta Lv10, MST 150');

// A remote Resta heals the local player by the caster's MST (PsoBB.exe entity_hit_by_tech case
// resta: round(MST * 0.5 + power)), only when the local id is in the 6x47 list, alive, Lv3+.
const SELF = 1;
eq(remoteRestaHeal([0, SELF, 2], SELF, false, 2, 200, 0), restaHeal(2, 200, 0), 'remote Resta Lv3 lists self: the caster MST');
eq(remoteRestaHeal([0, SELF, 2], SELF, false, 2, 200, 0) - remoteRestaHeal([0, SELF, 2], SELF, false, 2, 0, 0), 100, 'the MST part is MST * 0.5');
eq(remoteRestaHeal([0, 2], SELF, false, 2, 200, 0), 0, 'self not in the 6x47 list: no heal');
eq(remoteRestaHeal([SELF], SELF, true, 2, 200, 0), 0, 'a dead local player takes no heal');
eq(remoteRestaHeal([SELF], SELF, false, 1, 200, 0), 0, 'Lv2 (0-based 1): the entity hits the caster only');
eq(remoteRestaHeal([SELF], SELF, false, 0, 200, 0), 0, 'Lv1: no list hit');
eq(remoteRestaHeal([SELF], SELF, false, 9, 150, 2), restaHeal(9, 150, 2), 'a remote Lv10 heal uses the given class');

// --- 6x47 targets and the level split ---
eq([targetListKind(TECH.foie), targetListKind(TECH.gifoie), targetListKind(TECH.gizonde), targetListKind(TECH.resta)], ['one', 'none', 'list', 'list'], '6x47 target kinds');
eq(splitLevel(9), { sent: 9, extra: 0 }, 'level 10: no override');
eq(splitLevel(20), { sent: 14, extra: 6 }, 'level 21: 14 + 6');

// --- the caster's MST from a 6x70 (PlayerStats at 0x140: atp, mst at +2) ---
{
  const body = new Uint8Array(0x500); // parsePlayerSync reads the floor at 0x4b0
  body[0] = 0x70;
  new DataView(body.buffer).setUint16(0x142, 77, true);
  const into = {} as Parameters<typeof parsePlayerSync>[1];
  parsePlayerSync(body, into);
  eq(into.mst, 77, '6x70 MST at 0x142');
}

// --- commands ---
eq(hex(buildTechLevelOverride(1, 6)), '8d02010006000000', '6x8D');
eq(hex(buildCastTechnique(1, TECH.foie, 3, [{ entityId: 0x1005 }])), '470301000000030105100000', '6x47 one target');
eq(hex(buildCastTechnique(0, TECH.gifoie, 0, [])), '4702000001000000', '6x47 no target');
eq(hex(buildCastTechniqueComplete(2, TECH.megid, 14)), '480202001200 0e00'.replace(' ', ''), '6x48');
eq(parseCastTechnique(buildCastTechnique(1, 7, 5, [{ entityId: 0x1001 }, { entityId: 0x1002 }])), { clientId: 1, tech: 7, level: 5, targets: [0x1001, 0x1002] }, '6x47 round trip');
eq(parseCastTechniqueComplete(buildCastTechniqueComplete(3, 15, 2)), { clientId: 3, tech: 15, level: 2 }, '6x48 round trip');

// --- cast motion and timing ---
eq(castMotion(0, 0), { index: 194, mode: 3, next: -1, speed: 1.4, flags: 0x20000008 }, 'male bare-hand cast motion (slot 1)');
eq(castMotion(2, 18).speed, 1.5, 'FOmarl class 18 cast speed');
eq([releaseFrame(0, 0), releaseFrame(1, 0), releaseFrame(2, 0), releaseFrame(0, 5)], [8, 17, 13, 13], 'release frames');
{
  const log: string[] = [];
  const data = techData(TECH.foie, 0); // charge 5, cast 15
  const c = new TechCast(data, 8, { release: () => log.push('release'), done: () => log.push('done') });
  let frame = 0;
  let ticks = 0;
  while (c.phase !== 'idle' && ticks < 200) {
    if (!c.holding) frame += 1.4;
    c.tick(frame, frame >= 30);
    ticks++;
    if (log.length === 1 && log[0] === 'release' && !log.includes('t')) log.push('t'), log.push(String(ticks));
  }
  // Charge counts 5 down to -1 (6 ticks), then the motion runs 1.4 frames
  // per tick to frame 8 (6 ticks) and releases.
  eq(log.slice(0, 3), ['release', 't', '12'], 'release tick');
  check(log.includes('done'), 'cast ends after the motion');
}
{
  // The technique_group entity_hit_by_tech gets (Epsilon's immunity compares
  // it with 1, 2, 3, 5; Barta is 0x13, techfire.ts HIT_GROUP).
  eq([TECH.foie, TECH.gifoie, TECH.rafoie].map(techGroup), [1, 1, 1], 'the foie family is group 1');
  eq(techGroup(TECH.barta), 0x13, 'Barta is group 0x13');
  eq([TECH.gibarta, TECH.rabarta].map(techGroup), [2, 2], 'the gibarta family is group 2');
  eq([TECH.zonde, TECH.gizonde, TECH.razonde].map(techGroup), [3, 3, 3], 'the zonde family is group 3');
  eq(techGroup(TECH.grants), 4, 'Grants is group 4');
  eq(techGroup(TECH.megid), 5, 'Megid is group 5');
  eq(techGroup(TECH.resta), 0, 'a support technique has no attack group');
}

// The damage number over an enemy hit (entity_hit_by_tech's case calls of
// display_floating_text_at_position): the elemental attack groups show it, 0 included;
// Megid shows none (its case has no number call); the support techniques and Ryuker none.
{
  const shows = [TECH.foie, TECH.gifoie, TECH.rafoie, TECH.barta, TECH.gibarta, TECH.rabarta, TECH.zonde, TECH.gizonde, TECH.razonde, TECH.grants];
  eq(shows.map(techHitShowsNumber).every((x) => x), true, 'the elemental attack groups show the number');
  eq(techHitShowsNumber(TECH.megid), false, 'Megid shows no number (its spark only)');
  const quiet = [TECH.deband, TECH.jellen, TECH.zalure, TECH.shifta, TECH.ryuker, TECH.resta, TECH.anti, TECH.reverser];
  eq(quiet.map(techHitShowsNumber).some((x) => x), false, 'the support techniques and Ryuker show no number');
  // Ryuker never reaches enemies: no 6x47 target list, and the caster's client only opens the pipe
  // (unknown_cast_tech case ryuker; the other clients break out, no entity_hit_by_tech).
  eq([targetListKind(TECH.ryuker), techTookDamageMin(TECH.ryuker)], ['none', TOOK_DAMAGE_NEVER], 'Ryuker: no target list, no 0x200 group');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('techniques: all checks passed');
