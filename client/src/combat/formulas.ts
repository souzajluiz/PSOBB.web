// Hit and damage formulas of PsoBB.exe (Ephinea 1.25.13, addresses are VAs),
// for a player hitting an enemy with a physical (weapon) attack.
//
// Entity stat block (offsets in the entity object), set by FUN_00770da4
// (players, from FUN_006960e4) and FUN_007868f8 (enemies, from every enemy
// constructor) out of {PlayerStats, AttackData, ResistData}:
//   +0x2bc max HP   +0x2cc ATP   +0x2ce ATP spread   +0x2d0 EVP   +0x2d2 DFP
//   +0x2d4 ATA      +0x2d6 LCK   +0x2f6 EFR  +0x2f8 ETH  +0x2fa EIC  +0x2fc EDK  +0x2fe ELT
//   +0x31c -> AttackData (its first i16, min ATP, is the "equipment" ATP)
//   +0x334 HP
// Enemies (FUN_007868f8): max HP = stats.hp + stats.level, ATP = stats.atp,
//   spread = attack.max_atp - attack.min_atp, EVP = stats.evp + resist.evp_bonus,
//   DFP = stats.dfp + resist.dfp_bonus, ATA = attack.min_ata + stats.ata,
//   LCK = stats.lck. Shifta / Zalure (+0x278 / +0x284) scale ATP, spread and DFP.
// Players (FUN_00770da4): the same, with ATA = (attack.min_ata + stats.ata) * 0.1
//   (DAT_00978358) and the class AttackData at 0x00968a60 + class * 0x30
//   ({min_atp, max_atp, min_ata}, PLAYER_CLASS_ATTACK below; HUmar {5, 10, 650}).
//
// Hit check, enemy vtable +0x70 = FUN_007775ec -> +0x74 = FUN_00777664:
//   p = (attacker.ATA * accuracy - defender.EVP * 0.2) * 0.01   (DAT_0097819c, DAT_00978198)
//   hit when p > 0 and rand() <= p, rand() = FUN_007751b0 (uniform 0..1).
//   accuracy = 0x009cb9dc[attack type] * 0x009cb9e8[combo step]
//            = {1.0, 0.7, 0.5}[normal, heavy, special] * {1.0, 1.3, 1.69}[step]
//   (FUN_006997a0, the per-target loop of the weapon hit).
//
// Damage, enemy vtable +0x5c = FUN_007732b8(defender, attacker, multiplier),
// per hit box (hit boxes flagged 0x4000000 by the hit check):
//   d = (ATP + spread * rand()) * 0.2                          (_DAT_009782b4)
//     + equipATP * 0.2 * (1 + 0.01 * attribute%)               (attribute vs the
//       defender's kind: native 1 / A.beast 2 / machine 4 / dark 8, +0x2e8)
//     + sum(elemental_i * (100 - resist_i) * 0.01)             (attacker +0x2ec..+0x2f4)
//     - DFP * 0.2                                               (_DAT_009782a8 = -0.2)
//     - hitbox[+0x28]
//   if d >= 0: d *= multiplier = 0x009cb9d0[attack type] = {0.9, 1.7, 0.5};
//     critical when rand() * (attacker is a player ? 500 : 200) <= min(LCK, 100)
//     (DAT_00978298 / DAT_0097829c / DAT_0097828c): d *= 1.5 (DAT_00978294).
//   total >= 1 (DAT_009782b0): flag 0x200 (hit), 0x400 if total > max HP * 0.25
//   (FUN_0077529c, DAT_0097822c), HP -= round(total) (FUN_00777414); HP < 1 sets
//   0x800 (dead). Otherwise flag 0x100 (miss / no damage).
// The red/white number shown is round(d) of each hit box (FUN_0078a5e8).

export type AttackType = 0 | 1 | 2; // normal, heavy, special (player +0x8a4)

export const ATTACK_DAMAGE_MULT = [0.9, 1.7, 0.5] as const; // 0x009cb9d0
export const ATTACK_ACCURACY_MULT = [1.0, 0.7, 0.5] as const; // 0x009cb9dc
export const COMBO_ACCURACY_MULT = [1.0, 1.3, 1.69] as const; // 0x009cb9e8

export interface AttackerStats {
  atp: number; // +0x2cc
  atpSpread: number; // +0x2ce
  equipAtp: number; // *(i16 *)(+0x31c)
  ata: number; // +0x2d4
  lck: number; // +0x2d6
  isPlayer: boolean; // entity id < 0x1000
  attributePercent?: number; // weapon attribute matching the defender's kind
}

export interface DefenderStats {
  hp: number; // +0x334
  maxHp: number; // +0x2bc
  evp: number; // +0x2d0
  dfp: number; // +0x2d2
}

export type Rng = () => number; // uniform in [0, 1)

// FUN_00777664.
export function hitChance(attacker: AttackerStats, defender: DefenderStats, attackType: AttackType, comboStep: number): number {
  const acc = ATTACK_ACCURACY_MULT[attackType] * COMBO_ACCURACY_MULT[Math.min(2, Math.max(0, comboStep))];
  return (attacker.ata * acc + defender.evp * -0.2) * 0.01;
}

export function rollHit(attacker: AttackerStats, defender: DefenderStats, attackType: AttackType, comboStep: number, rng: Rng): boolean {
  const p = hitChance(attacker, defender, attackType, comboStep);
  return p > 0 && rng() <= p;
}

export interface DamageResult {
  damage: number; // total before rounding (>= 1 means the hit landed)
  shown: number; // round(damage), the number above the enemy
  critical: boolean;
}

// FUN_007732b8 for one hit box without elemental parts or hit-box defense.
export function rollDamage(attacker: AttackerStats, defender: DefenderStats, attackType: AttackType, rng: Rng): DamageResult {
  const r = rng();
  const attr = 1 + 0.01 * (attacker.attributePercent ?? 0);
  let d = (attacker.atp + attacker.atpSpread * r) * 0.2 + attacker.equipAtp * 0.2 * attr + defender.dfp * -0.2;
  let critical = false;
  if (d >= 0) {
    d *= ATTACK_DAMAGE_MULT[attackType];
    const roll = rng() * (attacker.isPlayer ? 500 : 200);
    if (Math.min(attacker.lck, 100) >= roll) {
      d *= 1.5;
      critical = true;
    }
  } else {
    d = 0;
  }
  return { damage: d, shown: Math.round(d), critical };
}

// Applies a total hit to the enemy state like FUN_007732b8's tail and returns
// the 6x0A game flags bits it sets.
export const FLAG_MISSED = 0x100;
export const FLAG_HIT = 0x200;
export const FLAG_BIG_HIT = 0x400;
export const FLAG_DEAD = 0x800;

export function applyDamage(defender: DefenderStats, total: number): number {
  if (total < 1) return FLAG_MISSED;
  let flags = FLAG_HIT;
  if (total > defender.maxHp * 0.25) flags |= FLAG_BIG_HIT;
  defender.hp = Math.max(0, defender.hp - Math.round(total));
  if (defender.hp < 1) flags |= FLAG_DEAD;
  return flags;
}

// Player class AttackData (0x00968a60 + class * 0x30): {min_atp, max_atp, min_ata}.
export const PLAYER_CLASS_ATTACK = [
  [5, 10, 650], [5, 10, 610], [5, 10, 610], [1, 5, 760], [1, 5, 710], [1, 5, 730],
  [1, 3, 620], [1, 3, 600], [1, 3, 600], [5, 10, 680], [1, 3, 620], [1, 5, 680],
] as const;

export interface WeaponForCombat {
  atpMin: number; // ItemPMT weapon atp_min
  atpMax: number;
  grind: number; // data1[3]
  ata: number; // ItemPMT weapon ata
}

// Player attacker stats. ASSUMED composition (the equip path that updates
// +0x2cc / +0x31c on equip is not decoded): ATP = character ATP (disp stats),
// spread = weapon max - min (else the class AttackData spread), equipment ATP =
// weapon min + 2 * grind (the wiki's EQATP, else the class min ATP), ATA =
// (class min_ata + character ATA) * 0.1 + weapon ATA (FUN_00770da4 for the
// first part).
export function playerAttacker(
  charClass: number,
  stats: { atp: number; ata: number; lck: number },
  weapon: WeaponForCombat | null,
): AttackerStats {
  const cls = PLAYER_CLASS_ATTACK[charClass] ?? PLAYER_CLASS_ATTACK[0];
  return {
    atp: stats.atp,
    atpSpread: weapon ? weapon.atpMax - weapon.atpMin : cls[1] - cls[0],
    equipAtp: weapon ? weapon.atpMin + 2 * weapon.grind : cls[0],
    ata: Math.round((cls[2] + stats.ata) * 0.1) + (weapon?.ata ?? 0),
    lck: stats.lck,
    isPlayer: true,
  };
}

// Enemy defender stats (FUN_007868f8).
export function enemyDefender(
  stats: { hp: number; level: number; evp: number; dfp: number },
  resist: { evpBonus: number; dfpBonus: number },
): DefenderStats {
  const maxHp = stats.hp + stats.level;
  return { hp: maxHp, maxHp, evp: stats.evp + resist.evpBonus, dfp: stats.dfp + resist.dfpBonus };
}
