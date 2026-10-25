// Support technique effects (combat/buffs.ts): the Shifta / Deband / Jellen /
// Zalure amounts and durations of on_shifta_jellen_received (0x007791b8) /
// on_deband_zalure_received (0x007793c8), the stronger-holds rule, the frame
// ticks, the stat changes they make to the weapon damage formula
// (combat/formulas.ts), Anti's cure list, Reverser's HP and the remote level
// of a 6x8D-overridden cast.
// Run: node tests/buffs.test.ts
import {
  antiCures,
  buffFrames,
  buffMultiplier,
  chop,
  EntityBuffs,
  GROUP,
  remoteTechLevel,
  reverserHp,
  roundHalfEven,
  statusIcon,
  supportPower,
} from '../client/src/combat/buffs.ts';
import { rollDamage, type AttackerStats, type DefenderStats } from '../client/src/combat/formulas.ts';
import { buildTechLevelOverride, parseTechLevelOverride } from '../client/src/net/game.ts';
import { statusIconTexel } from '../client/src/classic/hud.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-4) => check(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);

// --- amounts and durations (0-based level = power) ---
eq(supportPower(0), 0, 'Lv1 power');
eq(supportPower(29), 29, 'Lv30 power');
near(buffMultiplier(GROUP.shifta, 0), 0.1, 'Shifta Lv1 +10%');
near(buffMultiplier(GROUP.shifta, 14), 0.282, 'Shifta Lv15 +28.2%');
near(buffMultiplier(GROUP.deband, 29), 0.477, 'Deband Lv30 +47.7%');
near(buffMultiplier(GROUP.jellen, 0), -0.1, 'Jellen Lv1 -10%');
near(buffMultiplier(GROUP.zalure, 14), -0.282, 'Zalure Lv15 -28.2%');
eq(buffFrames(0), 1200, 'Lv1 lasts 40 s');
eq(buffFrames(14), 5400, 'Lv15 lasts 180 s');
eq(buffFrames(29), 9900, 'Lv30 lasts 330 s');
eq([roundHalfEven(2.5), roundHalfEven(3.5), roundHalfEven(-2.5), roundHalfEven(-2.6), roundHalfEven(1.4)], [2, 4, -2, -3, 1], 'fistp rounding');

// --- the stat chop: the buff code's fistp runs with the control word | 0xC00 (RC = 11),
// so ATP / spread / DFP move by trunc(base * m) per term (objdump of
// on_shifta_jellen_received 0x007792b5..0x00779308 and on_deband_zalure_received
// 0x007794a5..0x007794f0), not by round-half-even. The stored m is a float.
eq([chop(2.9), chop(-2.9), chop(-2.6), chop(9.9999994)], [2, -2, -2, 9], 'chop truncates toward zero');
{
  const j = new EntityBuffs();
  j.apply(GROUP.jellen, 0); // -0.09999999404 as stored
  eq(j.atp(95), 86, 'Jellen Lv1 on ATP 95: trunc(-9.4999994) = -9 (half-even would give 85)');
  const j2 = new EntityBuffs();
  j2.apply(GROUP.jellen, 1); // -0.11299999803
  eq(j2.atp(95), 85, 'Jellen Lv2 on ATP 95: trunc(-10.735) = -10 (half-even would give 84)');
  const s = new EntityBuffs();
  s.apply(GROUP.shifta, 0);
  eq([s.atp(95), s.atpSpread(20)], [104, 21], 'Shifta Lv1: ATP 95 -> 104 (trunc 9.4999994), spread 20 -> 21 (trunc 1.9999999)');
  const d = new EntityBuffs();
  d.apply(GROUP.deband, 0);
  eq(d.dfp(100), 109, 'Deband Lv1 on DFP 100: trunc(9.9999994) = 9, not 10');
  const z = new EntityBuffs();
  z.apply(GROUP.zalure, 1);
  eq(z.dfp(95), 85, 'Zalure Lv2 on DFP 95: trunc(-10.735) = -10');
  // Two casts telescope: the chops of -old and new leave base + trunc(new * base).
  const t = new EntityBuffs();
  t.apply(GROUP.shifta, 0);
  t.apply(GROUP.shifta, 14);
  eq(t.atp(95), 121, 'Shifta Lv1 then Lv15 on ATP 95: 95 + trunc(0.282 * 95) = 121, no drift from the first cast');
}

// --- stacking: a weaker cast neither replaces nor refreshes ---
{
  const b = new EntityBuffs();
  check(b.apply(GROUP.shifta, 14), 'Shifta Lv15 lands');
  for (let i = 0; i < 100; i++) b.tick();
  check(!b.apply(GROUP.shifta, 0), 'Shifta Lv1 does not replace Lv15');
  eq(b.attack.frames, 5300, 'and does not refresh it');
  check(b.apply(GROUP.shifta, 14), 'an equal Shifta replaces');
  eq(b.attack.frames, 5400, 'and refreshes the duration');
  check(b.apply(GROUP.deband, 0), 'Deband uses its own slot');
  eq([b.attack.type, b.defense.type], [9, 10], 'slot types');
  eq(b.icons(), [6, 8], 'Shifta and Deband icons');
  check(!b.apply(GROUP.jellen, 0), 'Jellen Lv1 does not beat Shifta Lv15');
  check(b.apply(GROUP.jellen, 20), 'a stronger Jellen replaces Shifta');
  eq(b.attack.type, GROUP.jellen, 'attack slot holds Jellen');
  check(b.clearDebuffs(), 'Anti (level >= 5) clears Jellen');
  eq([b.attack.type, b.defense.type], [0, 10], 'Deband stays');
}

// --- ticks ---
{
  const b = new EntityBuffs();
  b.apply(GROUP.shifta, 0);
  let ended = 0;
  for (let i = 0; i < 1199; i++) ended += b.tick().length;
  eq([ended, b.attack.type], [0, 9], 'still on after 1199 frames');
  eq(b.tick().map((s) => s.type), [9], 'wears off on frame 1200');
  eq([b.attack.type, b.attack.mult, b.atp(500)], [0, 0, 500], 'ATP back to base');
}

// --- stats ---
{
  const b = new EntityBuffs();
  b.apply(GROUP.shifta, 14);
  // trunc(500 * 0.282) = 140, trunc(20 * 0.282) = 5 (the chop, not the half-even of 141 / 6).
  eq([b.atp(500), b.atpSpread(20)], [640, 25], 'Shifta Lv15 ATP / spread');
  b.apply(GROUP.zalure, 14);
  eq(b.dfp(100), 72, 'Zalure Lv15 DFP');
  const d = new EntityBuffs();
  d.apply(GROUP.deband, 29);
  eq(d.dfp(85), 85 + 40, 'Deband Lv30 DFP (85 * 0.477 = 40.54 -> 40)');
}

// --- the weapon damage formula with buffs ---
{
  const seq = (...v: number[]) => {
    let i = 0;
    return () => v[i++ % v.length];
  };
  const hunter: AttackerStats = { atp: 500, atpSpread: 20, equipAtp: 50, ata: 100, lck: 10, isPlayer: true };
  const enemy: DefenderStats = { hp: 1000, maxHp: 1000, evp: 0, dfp: 100 };
  // rng 0 for the spread, 0.99 for the critical roll (no critical).
  near(rollDamage(hunter, enemy, 0, seq(0, 0.99)).damage, (100 + 10 - 20) * 0.9, 'plain hit');
  const sh = new EntityBuffs();
  sh.apply(GROUP.shifta, 14);
  const shifted = { ...hunter, atp: sh.atp(hunter.atp), atpSpread: sh.atpSpread(hunter.atpSpread) };
  near(rollDamage(shifted, enemy, 0, seq(0, 0.99)).damage, (640 * 0.2 + 10 - 20) * 0.9, 'Shifta Lv15 hits harder');
  const za = new EntityBuffs();
  za.apply(GROUP.zalure, 14);
  near(rollDamage(hunter, { ...enemy, dfp: za.dfp(enemy.dfp) }, 0, seq(0, 0.99)).damage, (100 + 10 - 72 * 0.2) * 0.9, 'Zalure Lv15 enemy takes more');
  // Jellen on an enemy attacker lowers its damage to the player (multiplier 1.0).
  const booma: AttackerStats = { atp: 120, atpSpread: 10, equipAtp: 20, ata: 60, lck: 0, isPlayer: false };
  const me: DefenderStats = { hp: 300, maxHp: 300, evp: 0, dfp: 30 };
  const je = new EntityBuffs();
  je.apply(GROUP.jellen, 14);
  const jellened = { ...booma, atp: je.atp(booma.atp), atpSpread: je.atpSpread(booma.atpSpread) };
  // trunc(120 * -0.282) = -33, trunc(10 * -0.282) = -2.
  eq([jellened.atp, jellened.atpSpread], [87, 8], 'Jellen Lv15 enemy ATP / spread');
  near(rollDamage(jellened, me, 0, seq(0, 0.99), 1).damage, 87 * 0.2 + 4 - 6, 'Jellen lowers enemy damage');
  // Deband on the player.
  const de = new EntityBuffs();
  de.apply(GROUP.deband, 14);
  near(rollDamage(booma, { ...me, dfp: de.dfp(me.dfp) }, 0, seq(0, 0.99), 1).damage, 24 + 4 - 38 * 0.2, 'Deband lowers damage taken');
}

// --- Anti, Reverser, remote level, 6x8D, HUD icons ---
eq(antiCures(0), ['poison'], 'Anti Lv1 cures poison');
eq(antiCures(5).at(-1), 'Jellen / Zalure', 'Anti Lv6 also clears Jellen / Zalure');
eq(antiCures(6).length, 7, 'Anti Lv7 cures everything');
eq([reverserHp(301), reverserHp(1)], [150, 1], 'Reverser: max HP / 2');
eq([remoteTechLevel(14, 6), remoteTechLevel(5, 6)], [20, 5], 'the 6x8D override only adds to level 14');
eq(parseTechLevelOverride(buildTechLevelOverride(2, 6)), { clientId: 2, extra: 6 }, '6x8D round trip');
eq([statusIcon(9), statusIcon(10), statusIcon(11), statusIcon(12), statusIcon(0)], [6, 8, 7, 9, 14], 'get_monster_status');
eq([statusIconTexel(6), statusIconTexel(8), statusIconTexel(14)], [[32, 208], [96, 208], null], 'status icon texels');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('buffs: all checks passed');
