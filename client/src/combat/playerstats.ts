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

import type { ItemData } from '../formats/itemnames.ts';
import type { ItemPMT } from '../formats/itempmt.ts';

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
