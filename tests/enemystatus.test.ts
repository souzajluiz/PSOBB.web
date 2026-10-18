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
  eq(s.inflict(STATUS.freeze), false, 'no refreeze while frozen');
  for (let i = 0; i < ENEMY_FREEZE_FRAMES; i++) s.tick();
  eq(s.flags, 0, 'freeze wore off');
  eq(s.inflict(STATUS.freeze), true, 'frozen again after it ended');
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
// The chain stops at paralysis: slot 1 does not count down meanwhile.
{
  const s = new EnemyStatus(ENEMY_ATTR.native);
  s.inflict(STATUS.paralysis);
  s.inflict(STATUS.freeze);
  s.tick();
  eq([s.slot0.frames, s.slot1.frames], [ENEMY_PARALYSIS_FRAMES - 1, ENEMY_FREEZE_FRAMES], 'freeze waits while paralysis holds');
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

if (failures) {
  console.log(`enemystatus: ${failures} failure(s)`);
  process.exit(1);
}
console.log('enemystatus: all checks passed');
