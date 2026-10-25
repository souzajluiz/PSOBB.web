// Status effects on enemies (combat/enemystatus.ts): the immunity rules by
// enemy kind, the durations and EVP multipliers, the lock of
// update_enemy_control_object, the 6x0A / 6x9C sync and its receivers, and the
// Gibarta / Zonde rolls of entity_hit_by_tech.
// Run: node tests/enemystatus.test.ts
import {
  ENEMY_ATTR,
  ENEMY_CONFUSION_FRAMES,
  ENEMY_FREEZE_FRAMES,
  ENEMY_PARALYSIS_FRAMES,
  ENEMY_SHOCK_FRAMES,
  enemyAttribute,
  EnemyStatus,
  techFreezeChance,
  techShockChance,
} from '../client/src/combat/enemystatus.ts';
import { STATUS } from '../client/src/combat/status.ts';
import { buildEnemyState, parseEnemyState, parseEnemyStatusUltimate } from '../client/src/net/game.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string) => check(Math.abs(a - b) < 1e-5, `${what}: ${a} != ${b}`);

// 1. Kinds from the constructors.
eq(enemyAttribute('BOOMA'), ENEMY_ATTR.native, 'Booma native');
eq(enemyAttribute('SAVAGE_WOLF'), ENEMY_ATTR.native, 'Savage Wolf native');
eq(enemyAttribute('EVIL_SHARK'), ENEMY_ATTR.abeast, 'Evil Shark A.beast');
eq(enemyAttribute('GILLCHIC'), ENEMY_ATTR.machine, 'Gillchic machine');
eq(enemyAttribute('DELSABER'), ENEMY_ATTR.dark, 'Delsaber dark');
eq(enemyAttribute('GIBBLES') & ENEMY_ATTR.miniboss, ENEMY_ATTR.miniboss, 'Gibbles mini-boss');

// 2. Immunities: poison and slow never take on an enemy; a machine is not
// paralyzed but is the only kind shocked; a mini-boss is not confused.
{
  const native = new EnemyStatus(ENEMY_ATTR.native);
  const machine = new EnemyStatus(ENEMY_ATTR.machine);
  const boss = new EnemyStatus(ENEMY_ATTR.native | ENEMY_ATTR.miniboss);
  eq(native.inflict(STATUS.poison), false, 'no poison on an enemy');
  eq(native.inflict(STATUS.slow), false, 'no slow on an enemy');
  eq(native.inflict(STATUS.shock), false, 'no shock on a native enemy');
  eq(machine.inflict(STATUS.paralysis), false, 'no paralysis on a machine');
  eq(machine.inflict(STATUS.shock), true, 'shock on a machine');
  eq(boss.inflict(STATUS.confusion), false, 'no confusion on a mini-boss');
  eq(native.inflict(STATUS.confusion), true, 'confusion on a native enemy');
}

// 3. Durations, EVP and the lock.
{
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.inflict(STATUS.paralysis);
  eq(s.slot0.frames, ENEMY_PARALYSIS_FRAMES, 'paralysis 0xd2 frames');
  eq(s.evp(100), 85, 'paralysis EVP -0.15');
  eq(s.evp(50), 43, 'paralysis EVP term truncates: 50 - 7.5 -> 43 (not 42)');
  eq(s.locked, true, 'paralysis locks');
  let lockedFrames = 0;
  for (let i = 0; i < 300; i++) if (s.tick().locked) lockedFrames++;
  eq(lockedFrames, ENEMY_PARALYSIS_FRAMES - 1, 'locked until the counter reaches 0');
  eq(s.flags, 0, 'paralysis wore off');
  eq(s.evp(100), 100, 'EVP back');
}
{
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.inflict(STATUS.freeze);
  eq(s.slot1.frames, ENEMY_FREEZE_FRAMES, 'freeze 0x96 frames');
  eq(s.evp(100), 70, 'freeze EVP -0.3');
  // The EVP term is trunc(mult * EVP) (the fistp under RC = 11 in 0x00778cc0 / 0x007789c8 /
  // 0x00778e40): -0.3 * 55 = -16.5 chops to -16, round-half-even would give -17.
  eq(s.evp(55), 39, 'freeze EVP term truncates: 55 - 16.5 -> 39');
  eq(s.inflict(STATUS.freeze), false, 'no refreeze while frozen');
  for (let i = 0; i < ENEMY_FREEZE_FRAMES; i++) s.tick();
  eq(s.flags, 0, 'freeze wore off');
  eq(s.inflict(STATUS.freeze), true, 'frozen again after it ended');
}
{
  // 0x00521920 calls the paralysis, shock and freeze tests every frame (no short
  // circuit): a freeze counts down while the enemy is also paralysed.
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.inflict(STATUS.paralysis);
  s.inflict(STATUS.freeze);
  for (let i = 0; i < ENEMY_FREEZE_FRAMES; i++) s.tick();
  eq(s.has(STATUS.freeze), false, 'the freeze wears off during the paralysis');
  eq(s.has(STATUS.paralysis), true, 'the paralysis is still on');
  eq(s.locked, true, 'the enemy stays locked by the paralysis');
}
{
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.inflict(STATUS.confusion);
  eq(s.slot1.frames, ENEMY_CONFUSION_FRAMES, 'confusion 300 frames');
  eq(s.locked, false, 'confusion does not lock');
  eq(s.tick().locked, false, 'a confused enemy keeps acting');
  s.inflict(STATUS.freeze);
  eq(s.slot1.type, STATUS.freeze, 'freeze replaces confusion');
}
{
  const s = new EnemyStatus(ENEMY_ATTR.machine);
  s.inflict(STATUS.shock);
  eq(s.slot1.frames, ENEMY_SHOCK_FRAMES, 'shock 300 frames');
  eq(s.evp(200), 170, 'shock EVP -0.15');
  eq(s.tick().locked, true, 'shock locks');
}
// No chain stop at paralysis: 0x00521920 calls the paralysis, shock and freeze
// tests every frame and ORs them, so slot 1 counts down while paralysis holds.
{
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.inflict(STATUS.paralysis);
  s.inflict(STATUS.freeze);
  s.tick();
  eq([s.slot0.frames, s.slot1.frames], [ENEMY_PARALYSIS_FRAMES - 1, ENEMY_FREEZE_FRAMES - 1], 'freeze counts down while paralysis holds');
}

// 4. Sync: 6x0A carries the bits; Ultimate sends them once as 6x9C.
{
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.inflict(STATUS.freeze);
  eq(s.syncBits(false), { flags: 0x20, ultimateBits: 0 }, '6x0A carries the freeze bit');
  eq(s.syncBits(true), { flags: 0, ultimateBits: 0x20 }, 'Ultimate: 6x9C with the new bit');
  eq(s.syncBits(true), { flags: 0, ultimateBits: 0 }, 'Ultimate: only once');
  const st = parseEnemyState(buildEnemyState(5, 10, 0x20900220));
  eq(st, { enemyIndex: 5, totalDamage: 10, flags: 0x20900220 }, '6x0A round trip');
  const b = new Uint8Array([0x9c, 2, 0x05, 0x10, 0x10, 0, 0, 0]);
  eq(parseEnemyStatusUltimate(b), { enemyIndex: 5, bits: 0x10 }, '6x9C parse');
}
{
  const s = new EnemyStatus(ENEMY_ATTR.native);
  eq(s.receiveFlags(0x20900222, false), [STATUS.paralysis, STATUS.freeze], 'restore_enemy_status inflicts the new bits');
  eq(s.receiveFlags(0x20900222, false), [], 'bits already on the enemy');
  const u = new EnemyStatus(ENEMY_ATTR.native);
  eq(u.receiveFlags(0x22, true), [], 'Ultimate ignores the 6x0A bits');
  eq(u.receiveUltimate(0x10, true, false), STATUS.confusion, '6x9C confuses');
  eq(u.receiveUltimate(0x02, false, false), null, '6x9C does nothing outside Ultimate');
  eq(u.receiveUltimate(0x02, true, true), null, '6x9C does nothing on a dead enemy');
}

// 5. Technique rolls.
near(techFreezeChance(100, false), 0.125, 'Gibarta below 250 power: 0.125');
near(techFreezeChance(450, false), (200 * 0.025 + 5) * 0.025, 'Gibarta 450 power');
near(techFreezeChance(2000, false), 0.4, 'capped at 0.4');
near(techFreezeChance(2000, true), 0.2, 'Ultimate: 0.2 above 0.2');
near(techFreezeChance(100, true), 0.125, 'Ultimate below 0.2 unchanged');
near(techShockChance(false), 1 / 15, 'Zonde shock 1/15');
near(techShockChance(true), 0.025, 'Zonde shock 0.025 in Ultimate');

// 5. The 0x4000 hold (vtable 0xe8, Player_ApplyStatusEffect_00779828): round(power)
// ticks, locked while it runs; the paralysis is not counted during it.
{
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.applyHold(3);
  eq(s.locked, true, 'the hold locks at once');
  eq([s.tick().locked, s.tick().locked, s.tick().locked], [true, true, true], 'the hold locks for its round(power) ticks');
  eq(s.hold, null, 'the hold clears on its last tick');
  eq(s.tick().locked, false, 'free after the hold');
  eq(s.active, false, 'no status block once clear');
}
{
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.inflict(STATUS.paralysis);
  s.applyHold(2.4);
  s.tick();
  eq(s.slot0.frames, ENEMY_PARALYSIS_FRAMES, 'the paralysis is not counted during the hold');
  s.tick();
  eq(s.slot0.frames, ENEMY_PARALYSIS_FRAMES, 'still not counted on the hold\'s last tick');
  s.tick();
  eq(s.slot0.frames, ENEMY_PARALYSIS_FRAMES - 1, 'the paralysis counts after the hold');
}
{
  // The hold count is trunc(power) (fistp under RC = 11, 0x00779828): 2.7 -> 2, not 3.
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.applyHold(2.5);
  eq(s.hold, 2, 'trunc(power) for the hold count');
  s.applyHold(2.7);
  eq(s.hold, 2, 'the hold count truncates 2.7 to 2 (round would give 3)');
  const z = new EnemyStatus(ENEMY_ATTR.machine);
  z.applyHold(1);
  eq(z.tick().locked, true, 'a machine is held too (the hold is not an attribute check)');
}

if (failures) {
  console.log(`enemystatus: ${failures} failure(s)`);
  process.exit(1);
}
console.log('enemystatus: all checks passed');
