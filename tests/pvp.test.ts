// Player versus player in Battle mode (combat/pvp.ts): the 6x70 stats a remote player's hit
// check reads, the strike roll of a remote attacker against the local player, the knockback
// rule, the 6x8F payload (quest/battle.ts build6x8F and the parse), and the 6x46 targets that
// name the local player.
//
// Run: node tests/pvp.test.ts
import { build6x8F } from '../client/src/quest/battle.ts';
import {
  applyHpModification,
  applyLevelChangeStats,
  isPlayerEntity,
  nearestTargets,
  parse6x8F,
  parseCombatStats,
  pvpInReach,
  pvpKnockback,
  pvpStrike,
  remoteAttacker,
  type CombatStats,
} from '../client/src/combat/pvp.ts';
import { bulletSpeed, pelletTargetIndex, planGunShot } from '../client/src/combat/gunbullet.ts';
import { pickRespawn, respawnCandidates } from '../client/src/quest/battletraps.ts';
import { parseAttackTargets } from '../client/src/net/game.ts';
import { ATTACK_DAMAGE_MULT, weaponForCombat, type DefenderStats } from '../client/src/combat/formulas.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (a: unknown, b: unknown, msg: string) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// --- the 6x70 PlayerStats (0x140, little endian) ---------------------------------
{
  const body = new Uint8Array(0x4c0);
  body[0] = 0x70;
  const dv = new DataView(body.buffer);
  dv.setUint16(0x140, 120, true); // atp
  dv.setUint16(0x142, 33, true); // mst
  dv.setUint16(0x144, 44, true); // evp
  dv.setUint16(0x146, 250, true); // hp
  dv.setUint16(0x148, 55, true); // dfp
  dv.setUint16(0x14a, 66, true); // ata
  dv.setUint16(0x14c, 7, true); // lck
  eq(parseCombatStats(body), { atp: 120, evp: 44, dfp: 55, ata: 66, lck: 7 }, 'PlayerStats of a 6x70');
  eq(parseCombatStats(new Uint8Array(0x100)), null, 'a short 6x70 has no stats');
  const other = body.slice();
  other[0] = 0x71;
  eq(parseCombatStats(other), null, 'a non-6x70 has no stats');
}

// --- the remote attacker's stats -----------------------------------------------
{
  const stats: CombatStats = { atp: 100, evp: 0, dfp: 0, ata: 120, lck: 10 };
  eq(remoteAttacker(-1, stats), null, 'an unknown class has no attacker');
  eq(remoteAttacker(0, null), null, 'no 6x70 yet: no attacker');
  const a = remoteAttacker(0, stats);
  check(a !== null && a.atp === 100 && a.lck === 10 && a.isPlayer, 'attacker takes the synced ATP / LCK');
}

// --- the remote's worn weapon: its range and ATA (playerAttacker, the local composition) ---
{
  const stats: CombatStats = { atp: 100, evp: 0, dfp: 0, ata: 120, lck: 10 };
  const pmt = { getWeapon: () => ({ atpMin: 40, atpMax: 55, ata: 30 }) };
  // A Saber (40..55, ata 30) with grind 10 and two type-5 specials (30 + 20).
  const saber = weaponForCombat(new Uint8Array([0, 1, 2, 10, 0, 0, 5, 3, 5, 2, 0, 0]), pmt);
  const bare = remoteAttacker(0, stats)!;
  const armed = remoteAttacker(0, stats, saber)!;
  eq([bare.equipAtp, bare.atpSpread], [5, 5], 'no weapon: the class range 5..10');
  eq([armed.equipAtp, armed.atpSpread], [65, 20], 'the Saber: rmin 5 + (40 + 2 x 10), spread (10 + 75) - 65');
  eq([bare.ata, armed.ata], [77, 112], 'ATA: ROUND((650 + 120) x 0.1), then + 30 (weapon) + 50 / 10 (specials)');
  const hit = pvpStrike(armed, { hp: 300, maxHp: 300, evp: 0, dfp: 0 }, 0, 0, () => 0);
  const hitBare = pvpStrike(bare, { hp: 300, maxHp: 300, evp: 0, dfp: 0 }, 0, 0, () => 0);
  check(hit.damage > hitBare.damage, `an armed remote hits harder (${hit.damage} > ${hitBare.damage})`);
}

// --- the 6x30 of a remote player: the stat block's atp / evp / dfp / ata ---
{
  const s: CombatStats = { atp: 100, evp: 50, dfp: 60, ata: 70, lck: 10 };
  eq(applyLevelChangeStats(s, { atp: 130, evp: 55, dfp: 62, ata: 75 }), { atp: 130, evp: 55, dfp: 62, ata: 75, lck: 10 }, '6x30 writes atp / evp / dfp / ata and keeps LCK');
  eq(applyLevelChangeStats(undefined, { atp: 1, evp: 1, dfp: 1, ata: 1 }), undefined, 'no 6x70 yet: nothing to update');
  eq(s.atp, 100, 'the input stats are not changed');
}

// --- the strike roll ----------------------------------------------------------------
const defender: DefenderStats = { hp: 300, maxHp: 300, evp: 0, dfp: 0 };
const strong = remoteAttacker(0, { atp: 100, evp: 0, dfp: 0, ata: 1000, lck: 0 })!;
const never = () => 0.999999; // above any hit chance below 1
{
  const hit = pvpStrike(strong, defender, 0, 0, () => 0);
  check(hit.landed && hit.damage >= 1, `a sure strike lands for damage (${hit.damage})`);
  check(Number.isInteger(hit.damage), 'the damage is whole HP');
  // The class's base ATA is part of the attacker's ATA, so a miss needs EVP that drives the chance below 0.
  const miss = pvpStrike(strong, { ...defender, evp: 100000 }, 0, 0, () => 0);
  eq([miss.landed, miss.damage], [false, 0], 'a huge EVP makes the hit chance 0 (no hit)');
  const dodge = pvpStrike(strong, { ...defender, evp: 9999 }, 0, 0, never);
  eq([dodge.landed, dodge.damage], [false, 0], 'a high EVP dodges a roll near 1');
  // A heavy strike does less damage than a normal one (ATTACK_DAMAGE_MULT 1.7 vs 0.9 is the
  // multiplier; the normal strike is the reference).
  const normal = pvpStrike(strong, defender, 0, 0, () => 0);
  const heavy = pvpStrike(strong, defender, 1, 0, () => 0);
  check(heavy.damage > normal.damage, `a heavy strike hurts more (${heavy.damage} > ${normal.damage})`);
  check(ATTACK_DAMAGE_MULT[1] > ATTACK_DAMAGE_MULT[0], 'the heavy multiplier is the larger one');
}

// --- the hit threshold and the HP lost (EntityHitEntity_00773350, 0x00773893 / 0x007738e3) ---
{
  // attack type 2 multiplies by 0.5 (ATTACK_DAMAGE_MULT[2]); rng 0.5 keeps the hit roll sure,
  // the spread at 0 and the critical roll at 250 (LCK 0 never criticals).
  const one = (atp: number) => ({ atp, atpSpread: 0, equipAtp: 0, ata: 1e6, lck: 0, isPlayer: true });
  const noDef = { hp: 300, maxHp: 300, evp: 0, dfp: 0 };
  const at = (atp: number) => pvpStrike(one(atp), noDef, 2, 0, () => 0.5);
  const exactlyOne = at(10);
  eq([exactlyOne.landed, exactlyOne.damage, exactlyOne.total], [true, 1, 1], 'a total of exactly 1.0 lands');
  const short = at(9.9);
  eq([short.landed, short.damage], [false, 0], 'a total of 0.99 is a miss: no HP lost, no packet');
  const onePointNine = at(19);
  check(onePointNine.landed && onePointNine.damage === 1 && Math.abs(onePointNine.total - 1.9) < 1e-9, 'the HP lost truncates 1.9 to 1 (not rounded to 2)');
  check(Math.abs(onePointNine.total - 1.9) < 1e-9, 'the PB gain takes the untruncated total');
}

// --- knockdown (try_knockdown_player, 0x0077529c: max HP * 0.25 < total, attack type unread) ---
{
  eq(pvpKnockback(300, 75), 0, 'a total of exactly a quarter of max HP does not knock down');
  eq(pvpKnockback(300, 76), 76, 'a total above a quarter of max HP knocks down');
  eq(pvpKnockback(300, 40), 0, 'a light total does not push');
  eq(pvpKnockback(300, 76), pvpKnockback(300, 76), 'the rule is the same for a normal and a heavy strike');
}

// --- 6x8F payload and parse -----------------------------------------------------------
{
  // The sender's body: header {0x8f, 2, attacker}, then build6x8F(victim, amount).
  const body = new Uint8Array(8);
  body[0] = 0x8f;
  body[1] = 2;
  new DataView(body.buffer).setUint16(2, 3, true);
  body.set(build6x8F(1, 412), 4);
  eq(parse6x8F(body), { attacker: 3, target: 1, amount: 412 }, '6x8F parses attacker, victim and amount');
  check(isPlayerEntity(1) && isPlayerEntity(3) && !isPlayerEntity(4) && !isPlayerEntity(0x1000), 'player entities are the client ids 0..3');
  eq(parse6x8F(new Uint8Array(4)), null, 'a short 6x8F is refused');
}

// --- 6x46 names the local player ----------------------------------------------------------
{
  // [0x46, size, client id 2, unused, u32 count, {u16 entity, u16 hitbox}...]
  const body = new Uint8Array(8 + 4 * 2);
  body[0] = 0x46;
  body[1] = 4;
  const dv = new DataView(body.buffer);
  dv.setUint16(2, 2, true);
  dv.setUint32(4, 2, true);
  dv.setUint16(8, 0, true);
  dv.setUint16(10, 0, true);
  dv.setUint16(12, 0x1005, true);
  dv.setUint16(14, 0, true);
  eq(parseAttackTargets(body), { clientId: 2, targets: [0, 0x1005] }, '6x46 targets of client 2');
}


// Our strike on a remote player: the reach (cone, range, height window).
{
  const me = { x: 0, y: 0, z: 0 };
  const front = { x: 0, y: 0, z: 100 };
  eq(pvpInReach(me, front, 0, 0.5, 200), true, 'a player straight ahead within range is in reach');
  eq(pvpInReach(me, { x: 0, y: 0, z: -100 }, 0, 0.5, 200), false, 'a player behind is out of the cone');
  eq(pvpInReach(me, { x: 0, y: 0, z: 300 }, 0, 0.5, 200), false, 'a player past the weapon range is out');
  eq(pvpInReach(me, { x: 0, y: 60, z: 100 }, 0, 0.5, 200), false, 'a player 60 above is out of the height window');
}

// 6x2F: the exe's mode 0 sets (clamped), 1 adds (clamped), 2 adds the max; a negative amount or an unknown mode is refused.
{
  eq(applyHpModification(50, 300, 0, 120), 120, '6x2F set 120');
  eq(applyHpModification(50, 300, 0, 900), 300, '6x2F set clamps to max');
  eq(applyHpModification(250, 300, 1, 100), 300, '6x2F add clamps to max');
  eq(applyHpModification(50, 300, 1, 30), 80, '6x2F add 30');
  eq(applyHpModification(50, 300, 2, 0), 300, '6x2F mode 2 restores max');
  eq(applyHpModification(50, 300, 1, -5), null, '6x2F negative amount refused');
  eq(applyHpModification(50, 300, 3, 5), null, '6x2F mode 3 refused');
}

// Nearest targets: enemies and players in one list, the strike's count cut.
{
  const picked = nearestTargets(
    [
      { d: 9, value: 'enemy-a' },
      { d: 1, value: 'player-1' },
      { d: 4, value: 'enemy-b' },
    ],
    2,
  );
  eq(picked, ['player-1', 'enemy-b'], 'nearest two of mixed targets');
}

// Respawn candidates (SendTeleportRequestToPlayer): a spawn with a player within 50 is skipped, 5 at most.
{
  const spawn = (x: number, z: number) => ({ x, y: 0, z, angle: 0 });
  const points = [spawn(0, 0), spawn(100, 0), spawn(200, 0), spawn(300, 0), spawn(400, 0), spawn(500, 0)];
  const cands = respawnCandidates(points, [{ x: 100, z: 10 }]);
  eq(cands.map((c) => c.x), [0, 200, 300, 400, 500], 'spawn 100 skipped by a player 10 away');
  eq(respawnCandidates(points, []).length, 5, 'at most 5 candidates');
  eq(pickRespawn(cands, 0), cands[0], 'pickRespawn index 0 takes the first candidate');
  eq(pickRespawn([], 100), null, 'no candidates: the player stays');
}

// Gun shots on a remote player (Battle mode): the strike's list mixes enemies and players
// nearest first (the gun's pellets take it by index), and a pellet aimed at a player's point
// makes a bullet with its flight time, a wall stops it.
{
  const origin = { x: 0, y: 0, z: 0 };
  const noWall = () => false;
  const list = nearestTargets(
    [
      { d: 16, value: 'enemy-a' },
      { d: 4, value: 'player-2' },
      { d: 25, value: 'enemy-b' },
    ],
    5,
  );
  eq(list, ['player-2', 'enemy-a', 'enemy-b'], 'gun targets: the player between two enemies, nearest first');
  // Pellet i takes list[pelletTargetIndex(kind, i)]: the Shot's sixth pellet takes target 0 again.
  check(pelletTargetIndex(9, 0) === 0 && pelletTargetIndex(9, 1) === 1, 'Shot pellet 0 and 1 take targets 0 and 1');
  const aimAt = { centre: { x: 0, y: 0, z: 60 }, radius: 0 };
  const shot = planGunShot(origin, { heading: 0, angleBams: 0, horizontalDistance: 170 }, aimAt, noWall, bulletSpeed(6, 8));
  check(shot.bullet === true && shot.frames === Math.round(60 / bulletSpeed(6, 8)), 'a pellet at a player point makes a bullet (60 units at speed 11)');
  check(planGunShot(origin, { heading: 0, angleBams: 0, horizontalDistance: 170 }, aimAt, () => true, bulletSpeed(6, 8)).bullet === false, 'a wall on the way to a player: no bullet');
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
