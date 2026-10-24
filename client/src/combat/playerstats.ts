// The player's ATP as the exe keeps it, and the equip compare's ATP candidate.
//
// Evidence (PsoBB.exe, Ephinea 1.25.13; dump = refsrc Psobb.exe-05112026.c):
//   - UpdateEquipmentStatDisplay_007258dc (dump 689847, disasm 0x7258dc): the current ATP
//     row is  base_atp_with_shifta (+0x2cc) + atp_variance_with_shifta (+0x2ce) +
//     battleparams_attacks->atp_range_min (+0x31c -> first i16). The same sum is written to
//     the displayed stats by UpdatePlayerDisplayStats (dump 728017).
//   - ApplyItemStatsToPlayer_005d1f0c (dump 425117): on equip the item's own ATP range (its
//     block at item +0x124 / +0x126) is ADDED to battleparams_attacks: atp_range_min +=
//     item +0x124, atp_range_max += item +0x126. So the equipment ATP is additive to the
//     class range (the port's older "replaces the class min" note was wrong).
//   - PlayerRecalculateStats_0068e030 (dump 569766): the candidate's ATP output is
//       out[0] = ROUND(atp * m + rmin + atp) + ROUND((rmax - rmin) * (1 + m))
//     with atp = the candidate's base ATP, rmin / rmax the range after the item, m =
//     attack_buff_multiplier (Shifta, dump shifta_jellen_effect_tick 750440).
//   - The buff ticks move the displayed fields by the same multiplier: on expiry
//     base_atp_with_shifta += ROUND(-m * base_atp) and atp_variance_with_shifta +=
//     ROUND(-m * atp_variance) (dump 750440). Shifta is therefore already inside the
//     displayed sum, and the exe's ATP row needs no separate m.
//
// Derived split (ASSUMED where the file does not hold it): the saved ATP is the displayed
// sum base + variance + rmin. Since variance + rmin = rmax, base = ATP - rmax, the variance
// is rmax - rmin, and rmin is the equipment ATP the damage formula reads at +0x31c.
//
// ASSUMED: the class range is PLAYER_CLASS_ATTACK (formulas.ts: min / max / min ATA of the
// class AttackData 0x00968a60); an item's range is atp_min + 2 x grind (min) and atp_max +
// 2 x grind (max), the same contribution the port uses for the panel's ATP min; the buff
// multiplier is 0 in the compare list (the live m is not read there).

// Player class AttackData (0x00968a60 + class * 0x30): {min_atp, max_atp, min_ata}.
export const PLAYER_CLASS_ATTACK = [
  [5, 10, 650], [5, 10, 610], [5, 10, 610], [1, 5, 760], [1, 5, 710], [1, 5, 730],
  [1, 3, 620], [1, 3, 600], [1, 3, 600], [5, 10, 680], [1, 3, 620], [1, 5, 680],
] as const;

export interface AttackRange {
  min: number;
  max: number;
}

export interface WeaponRangeInput {
  atpMin: number;
  atpMax: number;
  grind: number;
}

// The class's battleparams attack range (rmin, rmax) before any item.
export function classAttackRange(charClass: number): AttackRange {
  const c = PLAYER_CLASS_ATTACK[charClass] ?? PLAYER_CLASS_ATTACK[0];
  return { min: c[0], max: c[1] };
}

// The range a weapon adds on equip (ASSUMED, see the header).
export function weaponAttackRange(w: WeaponRangeInput | null | undefined): AttackRange {
  if (!w) return { min: 0, max: 0 };
  return { min: w.atpMin + 2 * w.grind, max: w.atpMax + 2 * w.grind };
}

export interface AttackSplit {
  base: number; // +0x2cc (base_atp_with_shifta)
  variance: number; // +0x2ce (atp_variance_with_shifta), the attack spread
  rmin: number; // +0x31c -> atp_range_min, the equipment ATP
}

// The exe's displayed ATP split into its parts (see the header). base + variance + rmin
// is the input again, so the current row and the combat attacker agree.
export function splitAttack(displayedAtp: number, charClass: number, weapon: WeaponRangeInput | null): AttackSplit {
  const c = classAttackRange(charClass);
  const w = weaponAttackRange(weapon);
  const rmin = c.min + w.min;
  const rmax = c.max + w.max;
  return { base: displayedAtp - rmax, variance: rmax - rmin, rmin };
}

// PlayerRecalculateStats' ATP output (dump 569766) for a candidate weapon in the slot
// whose current weapon is `old` (null when the slot is empty). With m = 0 the base cancels:
// the candidate is the displayed ATP with the weapon's range max swapped. Armour and shield
// candidates do not change the weapon's range, so their ATP is the displayed one.
export function candidateAtp(
  displayedAtp: number,
  candidate: WeaponRangeInput | null,
  old: WeaponRangeInput | null,
  buffMultiplier = 0,
  charClass = 0,
): number {
  if (!candidate) return displayedAtp;
  const oldMax = weaponAttackRange(old).max;
  const newMax = weaponAttackRange(candidate).max;
  // The displayed ATP is base + rmax (the variance and rmin sum to rmax), so swapping the
  // weapon moves it by the max difference.
  const base = displayedAtp - (classAttackRange(charClass).max + oldMax);
  const rmin = classAttackRange(charClass).min + weaponAttackRange(candidate).min;
  const rmax = classAttackRange(charClass).max + newMax;
  const m = buffMultiplier;
  return Math.round(base * m + rmin + base) + Math.round((rmax - rmin) * (1 + m));
}
