import type { ItemData } from '../formats/itemnames.ts';
import type { ItemPMT } from '../formats/itempmt.ts';
import { roundHalfEven } from './buffs.ts';
import { CLASS_MAX_STATS } from './materials.ts';
// The equipment compare list's candidate values, as PsoBB.exe computes them (absolute, not a delta).
//
// Callers: UpdateEquipmentStatDisplay_007258dc (dump 689847, the compare rows), through
// EquipmentStatDisplayObject_UpdateEquipState_0072582a (dump 689797, the cursor item is not
// worn: PlayerRecalculateStats_0068e030) and _UpdateUnequipState_00725b7e (dump 689960, the
// cursor item is worn: PlayerCalculateItemStats_0068e4e8, see IsEquippedItemValid_00725b14).
// The Item Pack's panel (ChallengePlayerListWindow_UpdateItemDetail_0073175c, dump 698949)
// does not call these functions and keeps the item-only rows of classic/itemdetail.ts.
//
// The exe's working blocks (PlayerRecalculateStats_0068e030 locals; PlayerCalculateItemStats
// copies the same three):
//   stat   (player +0x2b4, battleparams_stats): [0] ATP base, [1] MST, [2] EVP, [4] DFP,
//          [5] ATA, [6] LCK (the clamp at [0], [1], [2], [4], [5], [6]).
//   range  (player +0x31c, battleparams_attacks): [0] atp_range_min, [1] atp_range_max,
//          [2] ata_range_min (tenths of an ATA).
//   resist (player +0x320): [0] the EVP modifier, dword +0x1c the DFP modifier.
// CalculateChallengeDamage_0069807c (dump 578524) turns them into the six shorts the list
// shows: out[0] ATP = atp + range_max (the ATP line of PlayerRecalculateStats), out[1] DFP =
// max(0, dfp + dfp_mod), out[2] MST = mst, out[3] ATA = ROUND((ata_range_min + ata) * 0.1),
// out[4] EVP = max(0, evp + evp_mod), out[5] LCK = lck. The 0.1 is the float at 0x0093ca14
// (fmuls at 0x6980d5). total_ata (the displayed ATA, dump 746023) is the same formula, so the
// displayed and the candidate ATA share one unit.
//
// The item part (ApplyEquipmentBonuses_005d330c, dump 426168, and its helpers):
//   - weapon (type 0): range min / max += atp_min / atp_max + 2 * grind (the set factor
//     get_equipment_set_atp_bonus_weapon is 1.0 unless its set matches, and the morning glory
//     base g_MorningGlory_ATP_Bonus_Base is 0.0 at 0x0092c448); ata_range_min += ata * 10 plus
//     10 * (next byte) for each special slot whose byte is 5; stat MST += mst.
//   - armour (type 1, sub 1, ApplyWeaponStats_005d4840, dump 426949): resist EVP += pmt evp
//     (0x0e) + get_armor_evp (item bytes 8..9); resist DFP dword += pmt dfp (0x0c) +
//     get_armor_dfp (item bytes 6..7). The set factors are 1.0.
//   - shield (type 1, sub 2): the exe calls ApplyWeaponStatsVariant_005d4774 (not decoded);
//     the armour formula is used here (ASSUMED).
//   - the option row (ApplyEquipmentBonuses_005d490c, dump 427003): the entry index is pmt
//     +0x1e for a weapon and +0x1c for armour (statBoostEntryIndex in itempmt.ts), and the rows
//     are the pmt's STAT_BOOST table at root +0x38 (6-byte rows: type, then amount as a short at
//     +2). Types 1..8 add (range, ata * 10, resist EVP, resist DFP, MST, LCK), 9..16 are their
//     negatives; type 6 (HP) is not one of the six stats.
// PlayerRecalculateStats clamps each stat-block value to [0, g_ClassMaxStats row]
// (get_player_class_max_stats, dump 598456). PlayerCalculateItemStats does not clamp.
//
// The file's displayed stats (PlayerDispData, net/charfile.ts) are the sums of these blocks,
// so the port rebuilds the blocks from the displayed values with the worn items' contributions
// (blocksFromFile). That is exact for ATP, MST, DFP, EVP and LCK; the ATA is exact only up to
// the rounding of total_ata (ASSUMED: the centre of the rounding interval).
//
// ASSUMED (marked in code): the buff multipliers m / md are 0 (no Shifta / Deband / Jellen /
// Megid in the file); the set factors are 1.0; shields use the armour formula; the resist
// block has no non-equipment part (the file's EVP / DFP are stat + worn resist); units and mags
// add nothing (the exe's unit loop, subtracting units when the old armour is worn, and
// ApplyItemStatBonuses_005d41a0 are not decoded); colored rings and the item set bonus
// (colored_ring_matching_boosts, handle_item_set_bonus) are not applied (not decoded).

// The file's displayed stats the compare list reads (PlayerDispData stats, net/charfile.ts).
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

// The worn items the candidate needs: one per slot (the first equipped of the kind).
export interface WornEquipment {
  weapon: ItemData | null;
  armour: ItemData | null;
  shield: ItemData | null;
}

export type CompareSlot = keyof WornEquipment;

// The slot a compare candidate goes to (the exe's equipment_slot of the item's type).
export function compareSlot(item: ItemData): CompareSlot | null {
  const d = item.data1;
  if (d[0] === 0) return 'weapon';
  if (d[0] === 1 && d[1] === 1) return 'armour';
  if (d[0] === 1 && d[1] === 2) return 'shield';
  return null;
}

export function wornEquipment(equipped: readonly ItemData[]): WornEquipment {
  const w: WornEquipment = { weapon: null, armour: null, shield: null };
  for (const it of equipped) {
    const slot = compareSlot(it);
    if (slot && !w[slot]) w[slot] = it;
  }
  return w;
}

// The exe's three blocks (see the header). Zero-based for an item's own contribution.
export interface CandidateBlocks {
  atp: number; // stat [0]
  mst: number; // stat [1]
  evp: number; // stat [2]
  dfp: number; // stat [4]
  ata: number; // stat [5]
  lck: number; // stat [6]
  rmin: number; // range [0]
  rmax: number; // range [1]
  ataMin: number; // range [2]
  resEvp: number; // resist [0]
  resDfp: number; // resist dword +0x1c
}

const zeroBlocks = (): CandidateBlocks => ({
  atp: 0, mst: 0, evp: 0, dfp: 0, ata: 0, lck: 0, rmin: 0, rmax: 0, ataMin: 0, resEvp: 0, resDfp: 0,
});

// A little-endian signed short from two bytes (the exe's (short) of a byte pair).
function s16(lo: number, hi: number): number {
  const v = (lo & 0xff) | ((hi & 0xff) << 8);
  return v >= 0x8000 ? v - 0x10000 : v;
}

// The 16-bit wrap the exe's shorts apply to every sum.
const wrap16 = (v: number): number => ((v & 0xffff) << 16) >> 16;

// The ATA of a weapon's three special slots (bytes 6..11): a type 5 adds 10 * the next byte.
function ataSpecials(d: Uint8Array | number[]): number {
  let ata = 0;
  for (let i = 0; i < 3; i++) if (d[6 + 2 * i] === 5) ata += d[7 + 2 * i] * 10;
  return ata;
}

// ApplyEquipmentBonuses_005d490c (dump 427003): the option row of the item's entry.
function applyOption(b: CandidateBlocks, index: number, pmt: ItemPMT, sign: 1 | -1): void {
  const e = pmt.statBoosts[index];
  if (!e) return;
  const v = s16(e.amount1 & 0xff, e.amount1 >> 8);
  const t = e.stat1;
  const neg = t >= 9 && t <= 16;
  const k = sign * (neg ? -v : v);
  switch (neg ? t - 8 : t) {
    case 1:
      b.rmin += k;
      b.rmax += k;
      break;
    case 2:
      b.ataMin += 10 * k;
      break;
    case 3:
      b.resEvp += k;
      break;
    case 4:
      b.resDfp += k;
      break;
    case 5:
      b.mst += k;
      break;
    case 7:
      b.lck += k;
      break;
    case 8:
      b.rmin += k;
      b.rmax += k;
      b.ataMin += 10 * k;
      b.resEvp += k;
      b.resDfp += k;
      b.mst += k;
      b.lck += k;
      break;
    default:
      // 0 and 6 (the HP field, not one of the six stats) change nothing here.
      break;
  }
}

// The item's contribution to the blocks, added (sign 1) or taken away (sign -1). The exe takes
// an item away with its stored bonuses (UnknownItemFunction19_005d22cc); the same formula with
// sign -1 is equal when the stored values are the current ones (ASSUMED).
export function applyItem(b: CandidateBlocks, item: ItemData, pmt: ItemPMT, sign: 1 | -1): void {
  const d = item.data1;
  if (d[0] === 0) {
    const w = pmt.getWeapon(d[1], d[2]);
    if (!w) return;
    const g2 = 2 * d[3];
    b.rmin += sign * (w.atpMin + g2);
    b.rmax += sign * (w.atpMax + g2);
    b.ataMin += sign * (w.ata * 10 + ataSpecials(d));
    b.mst += sign * w.mst;
    applyOption(b, w.statBoostEntryIndex, pmt, sign);
    return;
  }
  if (d[0] === 1 && (d[1] === 1 || d[1] === 2)) {
    const a = (d[1] === 1 ? pmt.armors : pmt.shields)[d[2]];
    if (!a) return;
    b.resDfp += sign * (a.dfp + s16(d[6], d[7]));
    b.resEvp += sign * (a.evp + s16(d[8], d[9]));
    applyOption(b, a.statBoostEntryIndex, pmt, sign);
  }
}

// The blocks the displayed stats of the file stand for. The file holds the sums (ATP = atp +
// range max, DFP = dfp + resist DFP, EVP = evp + resist EVP, ATA = ROUND((ata_min + ata) * 0.1)),
// so the worn items' contributions are taken out of them. The resist block's non-equipment part
// is taken as 0 (ASSUMED).
export function blocksFromFile(file: CompareStats, worn: WornEquipment, charClass: number, pmt: ItemPMT): CandidateBlocks {
  const cls = PLAYER_CLASS_ATTACK[charClass] ?? PLAYER_CLASS_ATTACK[0];
  const wz = zeroBlocks();
  for (const it of [worn.weapon, worn.armour, worn.shield]) if (it) applyItem(wz, it, pmt, 1);
  const rmax = cls[1] + wz.rmax;
  const ataMin = cls[2] + wz.ataMin;
  return {
    atp: file.atp - rmax,
    mst: file.mst, // the stat MST holds the worn weapon's and the options' MST (A[1])
    evp: file.evp - wz.resEvp,
    dfp: file.dfp - wz.resDfp,
    ata: file.ata * 10 - ataMin, // ASSUMED: the centre of the total_ata rounding
    lck: file.lck, // the stat LCK holds the options' LCK (A[6])
    rmin: cls[0] + wz.rmin,
    rmax,
    ataMin,
    resEvp: wz.resEvp,
    resDfp: wz.resDfp,
  };
}

// CalculateChallengeDamage_0069807c's six outputs, with the ATP line of PlayerRecalculateStats
// (m = 0: ROUND(atp + rmin) + ROUND(rmax - rmin) = atp + rmax) and md = 0.
function challengeOutputs(s: CandidateBlocks): CompareStats {
  const ataFloat = Math.fround(Math.fround(s.ataMin + s.ata) * Math.fround(0.1));
  return {
    atp: wrap16(s.atp + s.rmax),
    dfp: Math.max(0, wrap16(s.dfp + s.resDfp)),
    mst: wrap16(s.mst),
    ata: wrap16(roundHalfEven(ataFloat)),
    evp: Math.max(0, wrap16(s.evp + s.resEvp)),
    lck: wrap16(s.lck),
  };
}

// The stat block's clamp to the class maximum (PlayerRecalculateStats_0068e030, dump 569766).
function clampToClass(s: CandidateBlocks, charClass: number): void {
  const m = CLASS_MAX_STATS[charClass] ?? CLASS_MAX_STATS[0];
  const clamp = (v: number, hi: number) => Math.min(Math.max(v, 0), hi);
  s.atp = clamp(s.atp, m.atp);
  s.mst = clamp(s.mst, m.mst);
  s.evp = clamp(s.evp, m.evp);
  s.dfp = clamp(s.dfp, m.dfp);
  s.ata = clamp(s.ata, m.ata);
  s.lck = clamp(s.lck, m.lck);
}

// PlayerRecalculateStats_0068e030, the cursor item not worn: the slot's worn item comes out
// (vtable 0x5c), the candidate goes in (ApplyEquipmentBonuses), the stat block is clamped, and
// CalculateChallengeDamage gives the six values.
export function recalculateCandidate(file: CompareStats, item: ItemData, worn: WornEquipment, charClass: number, pmt: ItemPMT): CandidateStats {
  const s = blocksFromFile(file, worn, charClass, pmt);
  const slot = compareSlot(item);
  const old = slot ? worn[slot] : null;
  if (old) applyItem(s, old, pmt, -1);
  applyItem(s, item, pmt, 1);
  clampToClass(s, charClass);
  return challengeOutputs(s);
}

// PlayerCalculateItemStats_0068e4e8, the cursor item worn: the item comes out of the copies
// (no candidate, no clamp), then CalculateChallengeDamage.
export function equippedCandidate(file: CompareStats, item: ItemData, worn: WornEquipment, charClass: number, pmt: ItemPMT): CandidateStats {
  const s = blocksFromFile(file, worn, charClass, pmt);
  applyItem(s, item, pmt, -1);
  return challengeOutputs(s);
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
