import type { ItemData } from '../formats/itemnames.ts';
import type { ItemPMT } from '../formats/itempmt.ts';
// The equipment compare list's candidate values, as PsoBB.exe computes them.
//
// Callers: UpdateEquipmentStatDisplay_007258dc (dump 689847), reached from
// EquipmentStatDisplayObject_UpdateEquipState_0072582a (dump 689797, the cursor item
// is not worn) and _UpdateUnequipState_00725b7e (dump 689960, the cursor item is worn).
// The compare list is the quick menu's weapon / armour rows (classic/quickmenuwindow.ts).
// The Item Pack's panel is a different path (ChallengePlayerListWindow_UpdateItemDetail_
// 0073175c, dump 698949): it does not call these functions, so it keeps the item-only
// rows of classic/itemdetail.ts.
//
// Evidence (PsoBB.exe 1.25.13; the asm was read at 0x68e030..0x68e43a and 0x68e4e8..0x68e816):
//   - PlayerRecalculateStats_0068e030 (dump 569766) and PlayerCalculateItemStats_0068e4e8
//     (dump 569928) store exactly two shorts into the caller's buffer: [0] = ATP
//     (`mov word ptr [ebp], bx`, 0x68e3e2) and [1] = DFP (`mov word ptr [ebp+2], si`,
//     0x68e42c). Nothing else is written; the function returns 1 (2 for the item path).
//   - The DFP is computed from the buffer's own [1] (`movsx ecx, word ptr [ebp+2]`, 0x68e328),
//     and the caller zeroes that buffer (dump 689847 `local_2c = 0`). So the DFP is 0 for
//     every candidate, and MST / ATA / EVP / LCK (the buffer's other shorts) are 0 too.
//     The port shows the exe's values, not the old delta model; see DEVLOG.
//   - The ATP is `ROUND(atp * m + (rmin + atp)) + ROUND(span + m * span)` with the clamped
//     stat block's ATP as `atp`, rmin / rmax the battleparams ATP range, span = rmax - rmin,
//     m = attack_buff_multiplier. With m = 0 it is atp + rmax.
//   - The stat block and the range are edited through the item vtable's slot +0x5c.
//     For the weapon class that is UnknownItemFunction19_005d22cc (dump 425324, the handler
//     at 0x5d22cc): it SUBTRACTS the item's stored bonuses (the range min / max at item
//     +0x124 / +0x126, the stat block at +0x100..). PlayerRecalculateStats calls it on the
//     slot's old item, then ApplyEquipmentBonuses_005d330c (dump 426168) adds the candidate
//     (the weapon: ATP min / max + 2 * grind into the range, MST into the stat block; the
//     armour's DFP / EVP into the stat block). Then it clamps the stat block to the class
//     max (g_ClassMaxStats, combat/materials.ts).
//   - The PlayerCalculateItemStats path calls the same slot +0x5c on the worn item (no
//     candidate is applied) and does not clamp. Its field23 call's arguments are not in
//     the dump (the decompile shows none); the same three arrays are ASSUMED.
//
// The model below is therefore a delta of the file's absolute stats (the file's stat
// block already holds the worn equipment): candidate ATP = current ATP + the change of
// the weapon's ATP max (+ 2 * grind), DFP = 0 (the exe's read), other rows 0.
//
// ASSUMED: m = 0 (no Shifta / Deband / Jellen at rest; the buffs are not in the file);
// the set bonus and the morning glory bonus are 1.0 and 0 (ApplyEquipmentBonuses_005d330c
// reads them through get_equipment_set_bonus, not decoded here); the clamp is not applied
// to the delta (the file's ATP is taken to be inside the class max); the battleparams
// base range is not in the file, so only its equipment part is tracked; units and mags
// add nothing (the port's contribution model, see classic/itemdetail.ts).


// The file's absolute stats the compare list reads (PlayerDispData stats, charfile.ts).
export interface CompareStats {
  atp: number;
  dfp: number;
  mst: number;
  ata: number;
  evp: number;
  lck: number;
}

// The six candidate values, in the exe's order (ATP, DFP, MST, ATA, EVP, LCK).
export type CandidateStats = CompareStats;

// The battleparams ATP range an item adds (ApplyEquipmentBonuses_005d330c: param_2[0] and
// param_2[1]). Only weapons add one; everything else is zero.
export interface EquipmentRange {
  min: number;
  max: number;
}

export function equipmentRange(item: ItemData, pmt: ItemPMT): EquipmentRange {
  const d = item.data1;
  if (d[0] !== 0) return { min: 0, max: 0 };
  const w = pmt.getWeapon(d[1], d[2]);
  if (!w) return { min: 0, max: 0 };
  const grind2 = 2 * d[3]; // the exe's iVar4 = (grind byte) * 2
  return { min: w.atpMin + grind2, max: w.atpMax + grind2 };
}

// The ATP the exe's formula gives for a range (the change matters, the base is in the file).
function atpFor(range: EquipmentRange): number {
  return range.max;
}

// PlayerRecalculateStats_0068e030: the candidate `item` in the slot of `old` (the worn item
// of that slot, or null). Returns the six values the caller stores (ATP and DFP are the
// exe's two writes; the rest are the caller's zeros).
export function recalculateCandidate(stats: CompareStats, item: ItemData, old: ItemData | null, pmt: ItemPMT): CandidateStats {
  const now = old ? equipmentRange(old, pmt) : { min: 0, max: 0 };
  const next = equipmentRange(item, pmt);
  const atp = Math.round(stats.atp + atpFor(next) - atpFor(now));
  return { atp, dfp: 0, mst: 0, ata: 0, evp: 0, lck: 0 };
}

// PlayerCalculateItemStats_0068e4e8: the worn `item` itself (the stat block without it).
// The exe returns 2 here and writes the same two values.
export function equippedCandidate(stats: CompareStats, item: ItemData, pmt: ItemPMT): CandidateStats {
  const own = equipmentRange(item, pmt);
  const atp = Math.round(stats.atp - atpFor(own));
  return { atp, dfp: 0, mst: 0, ata: 0, evp: 0, lck: 0 };
}

// ---- (merged) ATP split, PLAYER_CLASS_ATTACK, candidate ATP ----
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
