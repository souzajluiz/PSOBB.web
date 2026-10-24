// Player versus player in Battle mode: what a remote player's strike does to the
// local player, and the subcommands that carry it. PsoBB.exe (Ephinea 1.25.13) runs
// the strike on the victim's side too: the attacker's client sends its strike's
// targets as 6x46 at the hit frame (ReceiveSubcommands forwards them to every client,
// the player's entity id is its client id); the victim's copy of the attacker then
// runs the hit check on its own player object (EntityHitEntity_00773350, the same
// function as for an enemy's strike on a player), so the victim is the one that
// takes the damage, sends 6x4B / 6x4C with its new HP and the knockback, and sends
// the 6x8F that gives the attacker the damage credit (ApplyHitEffectText_006917a4,
// flag 0x10000000 = the attacker is a player).
//
// Addresses (dump src/Psobb.exe-05112026.c, Ghidra where noted):
//   6x8F receive: FUN_006918fc (Ghidra; the handler is 0x006918fc in the 0x60 table at
//     0x00a0fd58, perm 7). The packet's target entity id at +4, amount at +6; the
//     scores go through HandleHitEffectText_006a9078 (score, raw sums).
//   6x8F send: ApplyHitEffectText_006917a4 (only in the logged-in / game scene, the
//     defender in battle state +0x32c == 1): {8F, 2, attacker u16 @2, victim u16 @4,
//     amount u16 @6}, the attacker being the param with the player flag.
//   6x2F PvP HP (dispatch_action_player_hurt_player, dump 0x00693348; receive
//     HandlePlayerHPModification_006933c0): header = the sender, the inner client id
//     @+0x0A names the player whose HP is set / added (the dump's version; Ghidra's
//     0x006933c0 reads the local player instead, a conflict noted in the DEVLOG). Its
//     dump callers are the special attacks, the Lily / enemy AI hits on a player and
//     the environment (sender 0xFFFF); the melee strike reports through 6x4B / 6x4C.
//   6x46 receive: FUN_00699574 (Ghidra) stores the targets in the attacker's attack
//     state and plays the motion; it deals no damage itself.
//
// ASSUMED (not traced): the victim's hit check reuses the enemy-strike formulas of
// combat/formulas.ts (rollHit / rollDamage with the attacker's stats) instead of
// EntityHitEntity's own constants; a remote player's ATP / ATA / LCK are the PlayerStats
// of its last 6x70 (no 6x70 yet: no hit); a miss sends nothing; the remote strike's
// attack type is the normal one unless the 6x43..6x45 says heavy; no team check (the
// exe's EntityHitEntity has none); knockback only for a heavy strike, of its damage.

import { playerAttacker, rollDamage, rollHit, type AttackerStats, type AttackType, type DefenderStats, type Rng, type WeaponForCombat } from './formulas.ts';
import { inWeaponCone } from './weaponaim.ts';

// PlayerStats of a 6x70 (BB, little endian) at 0x140: atp, mst, evp, hp, dfp, ata, lck.
export interface CombatStats {
  atp: number;
  evp: number;
  dfp: number;
  ata: number;
  lck: number;
}

export const STATS_OFFSET_6X70 = 0x140;

export function parseCombatStats(body: Uint8Array): CombatStats | null {
  if (body.length < STATS_OFFSET_6X70 + 0x0e || body[0] !== 0x70) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const o = STATS_OFFSET_6X70;
  return {
    atp: dv.getUint16(o, true),
    evp: dv.getUint16(o + 0x04, true),
    dfp: dv.getUint16(o + 0x08, true),
    ata: dv.getUint16(o + 0x0a, true),
    lck: dv.getUint16(o + 0x0c, true),
  };
}

// The remote attacker's stats as the attacker side of the hit check: playerAttacker, the same
// composition as the local player (class range + the equipped weapon's range and ATA, from
// formulas.ts weaponForCombat on the remote's worn weapon; null = no weapon known, ASSUMED to
// be the bare-hand case).
export function remoteAttacker(charClass: number, stats: CombatStats | null, weapon: WeaponForCombat | null = null): AttackerStats | null {
  if (!stats || charClass < 0) return null;
  return playerAttacker(charClass, { atp: stats.atp, ata: stats.ata, lck: stats.lck }, weapon);
}

// A 6x30 of another player (UpdatePlayerStatsAndLevelMessage_006928e4, the non-local branch,
// dump 574022): the command's atp / evp / dfp / ata are written straight into the player's stat
// block (battleparams_stats, player +0x2b4) and its totals follow. The command has no LCK, and
// its MST and HP go to the party window (partyStats). undefined in, undefined out (no 6x70 yet).
export function applyLevelChangeStats(stats: CombatStats | undefined, c: { atp: number; evp: number; dfp: number; ata: number }): CombatStats | undefined {
  if (!stats) return undefined;
  return { ...stats, atp: c.atp, evp: c.evp, dfp: c.dfp, ata: c.ata };
}

export interface PvpHit {
  landed: boolean; // the strike hit and did at least 1 damage
  damage: number; // before rounding (the HP lost is round(damage))
  critical: boolean;
}

// The victim's roll for one strike of a remote player: hit chance, then the damage.
export function pvpStrike(attacker: AttackerStats, defender: DefenderStats, attackType: AttackType, step: number, rng: Rng): PvpHit {
  if (!rollHit(attacker, defender, attackType, step, rng)) return { landed: false, damage: 0, critical: false };
  const r = rollDamage(attacker, defender, attackType, rng);
  const landed = Math.round(r.damage) >= 1;
  return { landed, damage: landed ? Math.round(r.damage) : 0, critical: landed && r.critical };
}

// The knockback strength of a PvP hit (ASSUMED: a heavy strike pushes by its damage).
export function pvpKnockback(attackType: number, damage: number): number {
  return attackType === 1 ? damage : 0;
}

// 6x8F as the victim sends it (after the 4-byte header): the attacker id names the
// header, then the victim and the amount. `body` is the whole subcommand.
export interface Pvp8F {
  attacker: number;
  target: number;
  amount: number;
}

export function parse6x8F(body: Uint8Array): Pvp8F | null {
  if (body.length < 8 || body[0] !== 0x8f) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { attacker: dv.getUint16(2, true), target: dv.getUint16(4, true), amount: dv.getUint16(6, true) };
}

// A 6x8F target is a player when its entity id is a client id (0..3); enemies are
// 0x1000 and up, objects 0x4000 and up.
export const PLAYER_ENTITY_LIMIT = 4;

export function isPlayerEntity(id: number): boolean {
  return id < PLAYER_ENTITY_LIMIT;
}

// --- our strikes on a remote player (Battle mode) -----------------------------------
//
// The attacker's side of a melee strike names the remote players in reach in its 6x46
// (the same list as the enemies; the victim runs the hit roll on its own copy, see
// render/combat.ts onRemoteStrikeTargets). The reach test is the enemies' cone test with
// a point at the player's origin (ASSUMED: the player's hit box is not decoded), and the
// same 40-unit height window as an enemy (ASSUMED).
export const PVP_BODY_REACH = 0;
export const PVP_HEIGHT_WINDOW = 40;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

// A remote player's body is in the weapon's reach: `heading` and `halfAngle` in radians,
// `maxDist` = horizontal + vertical range (the weapon's table, as for enemies).
export function pvpInReach(from: Point3, target: Point3, heading: number, halfAngle: number, maxDist: number): boolean {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  if (Math.hypot(dx, dz) - PVP_BODY_REACH > maxDist) return false;
  if (Math.abs(target.y - from.y) > PVP_HEIGHT_WINDOW) return false;
  return inWeaponCone(dx, dz, heading, halfAngle);
}

// The player's HP after a 6x2F (HandlePlayerHPModification_006933c0, PsoBB.exe): mode 0 sets
// the HP (ClampEntityHP_00770b58), 1 adds the amount (add_player_hp), 2 adds the max HP.
// The exe's validation (ValidateEntityForHPModification_006a9a34) refuses a mode above 2 and
// a negative amount (the short is read as signed); those, and a dead player, change nothing.
export function applyHpModification(hp: number, maxHp: number, mode: number, amount: number): number | null {
  if (amount < 0 || amount > 0x7fff || mode < 0 || mode > 2) return null;
  if (mode === 0) return Math.min(amount, maxHp);
  if (mode === 1) return Math.min(maxHp, hp + amount);
  return maxHp;
}

// The nearest `max` items by squared distance (the strike's target count; the sort is stable).
export function nearestTargets<T>(items: ReadonlyArray<{ d: number; value: T }>, max: number): T[] {
  return [...items]
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(0, max))
    .map((i) => i.value);
}
