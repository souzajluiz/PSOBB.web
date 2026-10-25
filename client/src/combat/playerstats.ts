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
//     setFactorAtp (get_equipment_set_atp_bonus_weapon) scales the range, 1.0 unless its set matches;
//     the morning glory base is 0.0 at 0x0092c448, the sub 0x94 term is beat time / 4); ata_range_min += ata * 10 plus
//     10 * (next byte) for each special slot whose byte is 5; stat MST += mst.
//   - armour (type 1, sub 1, ApplyWeaponStats_005d4840, dump 426949): resist EVP += pmt evp
//     (0x0e) + get_armor_evp (item bytes 8..9); resist DFP dword += pmt dfp (0x0c) +
//     get_armor_dfp (item bytes 6..7). The pmt DFP is ROUND(dfp * setFactorDfp + morning) (2026-10-25).
//   - shield (type 1, sub 2, ApplyWeaponStatsVariant_005d4774, dump 426913): resist EVP += get_armor_evp
//     + ROUND(pmt evp * setFactorEvp + morning); resist DFP += pmt dfp + get_armor_dfp (no factor).
//   - unit (type 1, sub 3, ApplyItemStatBonuses_005d41a0, dump 426690): value = pmt amount (0x0e)
//     + the item's modifier (bytes 6..7); pmt stat (0x0c) picks the stat-block field (0 ATP, 1 MST,
//     2 ATA x10, 3 EVP, 6 DFP, 7 LCK, 8 all of ATP / MST / ATA / EVP / DFP / LCK), 4 / 5 are the HP /
//     TP block, 9..14 the elemental resists; then the unit's id (byte 2) specials: 0x4c MST +5, 0x4d
//     -30 on ATP / MST / EVP / DFP / LCK and -100 ATA, 0x4e +10 on the same and +200 ATA. Units have
//     no option row (GetItemOptTable_005e5518 gives row 0 for sub 3).
//   - the option row (ApplyEquipmentBonuses_005d490c, dump 427003): the entry index is pmt
//     +0x1e for a weapon and +0x1c for armour (statBoostEntryIndex in itempmt.ts), and the rows
//     are the pmt's STAT_BOOST table at root +0x38 (6-byte rows: type, then amount as a short at
//     +2). Types 1..8 add (range, ata * 10, resist EVP, resist DFP, MST, LCK), 9..16 are their
//     negatives; type 6 (HP) is not one of the six stats.
// PlayerRecalculateStats clamps each stat-block value to [0, g_ClassMaxStats row]
// (get_player_class_max_stats, dump 598456). PlayerCalculateItemStats does not clamp.
//
// WHAT THE SAVE HOLDS (settled 2026-10-23, see the DEVLOG entry of that date): the E7 / 0x61
// stats (PlayerDispData stats, net/charfile.ts) are the STAT BLOCK (+0x2b4), not the displayed
// totals. SerializeSinowberillPlayerData_006aa8fc (dump 596496, the E7 sent by send_packet0xe7, dump 811346)
// and SerializePlayerDataToBuffer_006aa4b0 (dump 596129) call ClampPlayerStats_006948dc (dump
// 575719), which copies +0x2b4 [0..6] to the save's stats at 0x34C. The displayed values are
// computed from the same block plus the range (+0x31c) and the resist block (+0x320):
// UpdatePlayerBattleStats (dump 557356) puts the worn items' stat contributions into +0x2b4, and
// the init (dump 746015) gives base_atp = stats->atp, variance = max - min, evp / dfp = stats +
// resist, total_ata = ROUND((ata_range_min + stats->ata) * g_AttackStatMultiplier).
// So the file holds: ATP = base only (no class range, no weapon range), MST and LCK = the
// stat block (worn weapon MST and option MST / LCK included), EVP / DFP = stat only (no worn
// armour / shield resist), ATA = stat only (no range ATA). The displayed ATP = base + class
// range max + weapon range max; the displayed EVP / DFP = file + worn resist; the displayed ATA =
// ROUND((class min ATA + weapon ATA + file ATA) * 0.1).
// blocksFromFile() takes the file as the stat block and adds the range and resist from the
// class and the worn items; displayedStats() gives the totals the compare list's current row shows.
//
// ASSUMED (marked in code): the buff multipliers m / md are 0 (no Shifta / Deband / Jellen /
// Megid in the file); the set factors and the item set bonus read the beat time (the caller's; the
// live client passes liveBeatTime(), tests a fixed value), the teammates
// close by (0), the colored ring count (0), the party (the worn armour only) and the movement bits
// (standing), which the save does not hold (SetContext, defaultSetContext); the unit specials
// 0x52 (beat time) and 0x5c (challenge data) add nothing; mags: magStatContribution is the mag's
// own stat effect (ApplyItemStatBonuses_005d3fa4, its stats pointer = the stat block, factors read
// from the exe). PlayerRecalculateStats_0068e030 reads the mag slot only for a mag candidate (dump
// 569856..569876), so a weapon / armour / shield / unit candidate never removes or adds a worn
// mag: its effect stays in the file's stat block (ASSUMED, as the file model above), and the
// compare does not apply magStatContribution; the elemental resists that armour, shields, units and
// the set bonuses write (resist [1..5]) are not kept, as the compare list does not show them; the
// set-bonus branches listed above handle_item_set_bonus are not ported; the
// file is the save at login, so an equip made in this session is not in its stat block.

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

export function equipmentRange(item: ItemLike, pmt: ItemPMT): EquipmentRange {
  const d = item.data1;
  if (d[0] !== 0) return { min: 0, max: 0 };
  const w = pmt.getWeapon(d[1], d[2]);
  if (!w) return { min: 0, max: 0 };
  const grind2 = 2 * d[3]; // the exe's iVar4 = (grind byte) * 2
  return { min: w.atpMin + grind2, max: w.atpMax + grind2 };
}

// The worn items the candidate needs: one per slot (the first equipped of the kind), and the
// units (the exe's unit1..unit4 slots, equipment_slot 9..12).
export interface WornEquipment {
  weapon: ItemData | null;
  armour: ItemData | null;
  shield: ItemData | null;
  units: ItemData[];
  mag?: ItemData | null; // equipment slot 1 (the set bonuses read it, handle_item_set_bonus)
}

// Units are group 1 = 1, group 2 = 3 (item_group_2 units = 3).
export function isUnit(item: ItemLike): boolean {
  return item.data1[0] === 1 && item.data1[1] === 3;
}

// The exe's `group_1 == armors_shields_units && group_2 == sabers_armors` test (armour only).
function isArmour(item: ItemLike): boolean {
  return item.data1[0] === 1 && item.data1[1] === 1;
}

export type CompareSlot = 'weapon' | 'armour' | 'shield';

// The slot a compare candidate goes to (the exe's equipment_slot of the item's type).
export function compareSlot(item: ItemLike): CompareSlot | null {
  const d = item.data1;
  if (d[0] === 0) return 'weapon';
  if (d[0] === 1 && d[1] === 1) return 'armour';
  if (d[0] === 1 && d[1] === 2) return 'shield';
  return null;
}

export function wornEquipment(equipped: readonly ItemData[]): WornEquipment {
  const w: WornEquipment = { weapon: null, armour: null, shield: null, units: [], mag: null };
  for (const it of equipped) {
    if (isUnit(it)) {
      if (w.units.length < 4) w.units.push(it);
      continue;
    }
    if (it.data1[0] === 2) {
      if (!w.mag) w.mag = it;
      continue;
    }
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
// (ApplyEquipmentBonuses_005d330c, dump 426168: `(byte * 4 + byte) * 2`, the same as 10 * byte.)
export function ataSpecials(d: Uint8Array | readonly number[]): number {
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

// The data1 an item helper reads (an ItemData, or the worn item of the live combat).
export interface ItemLike {
  readonly data1: Uint8Array;
}

// A weapon's own range contribution, the numbers applyItem adds for a weapon: ROUND((atp + 2 x grind)
// x set factor + morning) and the item set's range deltas (applySetBonuses). ApplyEquipmentBonuses_005d330c
// (dump 426168) writes it to the battleparams range (+0x31c), which the live hit reads as
// attacker->battleparams_attacks->atp_range_min (EntityHitEntity_00773350, dump 747464).
export function weaponRangeContribution(item: ItemLike, w: { atpMin: number; atpMax: number }, ctx: SetContext | null): AttackRange {
  const g2 = 2 * item.data1[3];
  const f = ctx ? setFactorAtp(item, ctx) : 1;
  const m = ctx ? morningGloryAtpBonus(item, ctx.beatTime) : 0;
  const t = ctx ? itemSetBonusDelta(item, ctx) : zeroBlocks();
  return {
    min: roundF(F(F(F(w.atpMin + g2) * F(f)) + m)) + t.rmin,
    max: roundF(F(F(F(w.atpMax + g2) * F(f)) + m)) + t.rmax,
  };
}

// The item's contribution to the blocks, added (sign 1) or taken away (sign -1). The exe takes
// an item away with its stored bonuses (UnknownItemFunction19_005d22cc); the same formula with
// sign -1 is equal when the stored values are the current ones (ASSUMED).
export function applyItem(b: CandidateBlocks, item: ItemLike, pmt: ItemPMT, sign: 1 | -1, ctx: SetContext | null = null): void {
  const d = item.data1;
  if (d[0] === 0) {
    const w = pmt.getWeapon(d[1], d[2]);
    if (!w) return;
    const g2 = 2 * d[3];
    // ApplyEquipmentBonuses_005d330c (dump 426168): the weapon's ATP range is scaled by the set
    // factor and gets the morning glory bonus (ROUND(x * factor + morning)); ATA and MST are not.
    const f = ctx ? setFactorAtp(item, ctx) : 1;
    const m = ctx ? morningGloryAtpBonus(item, ctx.beatTime) : 0;
    b.rmin += sign * roundF(F(F(F(w.atpMin + g2) * F(f)) + m));
    b.rmax += sign * roundF(F(F(F(w.atpMax + g2) * F(f)) + m));
    b.ataMin += sign * (w.ata * 10 + ataSpecials(d));
    b.mst += sign * w.mst;
    applyOption(b, w.statBoostEntryIndex, pmt, sign);
    if (ctx) applySetBonuses(item, ctx, b, sign);
    return;
  }
  if (d[0] === 1 && (d[1] === 1 || d[1] === 2)) {
    // Armour (ApplyWeaponStats_005d4840, dump 426949): the pmt DFP is ROUND(dfp * setDfp + morning),
    // the pmt EVP is added as it is. Shield (ApplyWeaponStatsVariant_005d4774, dump 426913): the pmt
    // EVP is the scaled one (setEvp), the pmt DFP is added as it is.
    const a = (d[1] === 1 ? pmt.armors : pmt.shields)[d[2]];
    if (!a) return;
    const f = ctx ? (d[1] === 1 ? setFactorDfp(item, ctx) : setFactorEvp(item, ctx)) : 1;
    const m = ctx ? morningGloryAtpBonus(item, ctx.beatTime) : 0;
    if (d[1] === 1) {
      b.resDfp += sign * (roundF(F(F(a.dfp * F(f)) + m)) + s16(d[6], d[7]));
      b.resEvp += sign * (a.evp + s16(d[8], d[9]));
    } else {
      b.resDfp += sign * (a.dfp + s16(d[6], d[7]));
      b.resEvp += sign * (roundF(F(F(a.evp * F(f)) + m)) + s16(d[8], d[9]));
    }
    applyOption(b, a.statBoostEntryIndex, pmt, sign);
    if (ctx) applySetBonuses(item, ctx, b, sign);
    return;
  }
  if (isUnit(item)) applyUnit(b, d, pmt, sign);
  if (ctx && d[0] === 1 && d[1] === 3) applySetBonuses(item, ctx, b, sign);
}

// ApplyItemStatBonuses_005d41a0 (dump 426690), a unit: the pmt amount plus the item's modifier
// (get_armor_dfp, bytes 6..7) goes to the stat-block field the pmt's stat selects (the switch on
// the pmt's word at 0x0c). Cases 4 / 5 (HP / TP block) and 9..14 (elemental resists) are not among
// the six compare stats and add nothing here. The unit's id (item byte 2) has fixed specials
// (0x4c..0x4e); 0x52 (beat time) and 0x5c (challenge data) are ASSUMED 0.
function applyUnit(b: CandidateBlocks, d: Uint8Array | number[], pmt: ItemPMT, sign: 1 | -1): void {
  const u = pmt.units[d[2]];
  if (u) {
    const k = sign * wrap16(u.amount + s16(d[6], d[7]));
    switch (u.stat) {
      case 0: b.atp += k; break;
      case 1: b.mst += k; break;
      case 2: b.ata += 10 * k; break;
      case 3: b.evp += k; break;
      case 6: b.dfp += k; break;
      case 7: b.lck += k; break;
      case 8:
        b.atp += k; b.mst += k; b.ata += k; b.evp += k; b.dfp += k; b.lck += k;
        break;
      default:
        break;
    }
  }
  switch (d[2]) {
    case 0x4c:
      b.mst += 5 * sign;
      break;
    case 0x4d:
      b.atp -= 30 * sign; b.mst -= 30 * sign; b.evp -= 30 * sign; b.dfp -= 30 * sign; b.lck -= 30 * sign;
      b.ata -= 100 * sign;
      break;
    case 0x4e:
      b.atp += 10 * sign; b.mst += 10 * sign; b.evp += 10 * sign; b.dfp += 10 * sign; b.lck += 10 * sign;
      b.ata += 200 * sign;
      break;
    default:
      break;
  }
}

// ---- Set bonuses, colored rings and the item set bonus (ported 2026-10-25) ----
// Ghidra (tools/ghidra/decomp.sh) of PsoBB.exe; the dump's community names in brackets. Addresses:
//   get_equipment_set_bonus            0x005d3584 [dump 426246] dispatch on the candidate: weapon ->
//                                      ATP factor; armour (sub 1) -> DFP factor; shield (sub 2) -> EVP
//                                      factor; anything else 1.0 (g_DefaultEquipmentSetBonus 0x0092c4a4).
//   get_equipment_set_atp_bonus_weapon 0x005d3b54 [dump 426491]
//   get_equipment_set_dfp_bonus        0x005d3780 [dump 426335]
//   get_equipment_set_evp_bonus        0x005d35d0 [dump 426273]
//   colored_ring_matching_boosts       0x005d4afc [dump 427069]: a shield (1, 2) with idx 0x53..0x82.
//   handle_item_set_bonus              0x005d4c38 [dump 427136]: weapon -> 0x005d583c, armour ->
//                                      0x005d53ac, shield -> 0x005d4e14, unit 'P' (0x50) -> the table
//                                      DAT_0092c280 (proof_of_sword_saint_weapons, 27 triples).
//   morning_glory_atp_bonus            0x005d3f70 [dump 426ff]
// Callers: ApplyEquipmentBonuses_005d330c (dump 426168) runs the set factor (weapon / armour /
// shield), the option row, colored_ring_matching_boosts and handle_item_set_bonus, in that order.
// The Ghidra decompile reads the worn items through FUN_0069792c(slot) (the current player); the
// dump reads the party loop through each player's equipment, so the party loop follows the dump.
// Equipment slots (dump 89169): mag 1, armor 2, shield 3, weapon 6, unit1..unit4 9..12.
// Item bytes: data1[0] type, [1] sub (group_2), [2] index (group_idx), [3] grind.
//
// The float constants are the exe's (tools/exedata.py read 0092c440 f 28), named by their Ghidra address.
// Each is a float32, so Math.fround gives the same value; products are float32 (F).
const F = (x: number): number => Math.fround(x);
const roundF = (x: number): number => roundHalfEven(x);
const SET_F = {
  one: F(1.0), // 0x0092c470 / 0x0092c490 / 0x0092c4a0 / 0x0092c4a4
  atpArmourSet: F(1.5), // 0x0092c468: weapon sub 1 idx 5 with shield 0x26 + armour 0x28, and the other set pairs
  atpSet1_3: F(1.3), // 0x0092c46c: armour 0x40 (x) / 0x45 / 0x56 with the matching weapon
  atpShieldSet: F(2.0), // 0x0092c464: weapon sub 0x1a with a shield 0x1a
  atpLow: F(0.5), // 0x0092c460
  atpGalatine: [F(0.33), F(0.5), F(1.0), F(2.0), F(3.0)] as const, // 0x0092c458 / 0x460 / 470 / 464 / 45c
  atpNearby: [F(1.15), F(1.2), F(1.25)] as const, // 0x0092c44c / 0x450 / 0x454 (armour 0x45 with 1..3 players)
  dfpArmourSet: F(1.2), // 0x0092c478
  dfpSwordShield: F(1.5), // 0x0092c47c
  dfpHoneycombMoving: F(0.5), // 0x0092c474
  dfpSweetheart: [F(0.85), F(0.8), F(0.75)] as const, // 0x0092c484 / 0x488 / 0x48c (1..3 nearby)
  dfpShield2A: F(1.1), // 0x0092c480
  evpSwordShield: F(2.0), // 0x0092c494 (weapon sub 0x1a)
  evpSaberArmour: F(1.5), // 0x0092c49c
  evpNoMovement: F(0.5), // 0x0092c498
  morningBase: 0, // 0x0092c448
};

// The worn state and the inputs the exe reads from the game (none of them is in the save).
// The player's lobby team record (the 0x85c entry of the lobby's team table that
// GetChallengeDataById_00797790 returns for the player's guild card, objdump 0x00797790): the first
// 16 bytes are the membership (masterGuildCard, teamId, unknownA5, unknownA6, the same four dwords
// that net/team.ts parseMembership reads), byte +0x11 the member count.
export interface TeamRecord {
  masterGuildCard: number;
  teamId: number;
  unknownA5: number;
  unknownA6: number;
  memberCount: number;
}

// The live team record: the client sets its source (classic/main.ts, the connection's TeamClient
// membership, ASSUMED to be the lobby table's entry for the player); none is null.
let liveTeamSource: () => TeamRecord | null = () => null;
export function setLiveTeamSource(source: () => TeamRecord | null): void {
  liveTeamSource = source;
}

export interface SetContext {
  worn: WornEquipment;
  beatTime: number; // get_beat_time (FUN_0077bab4): the clock behind galatine and morning glory
  nearby: number; // count_nearby_players (FUN_005e27a8): the teammates close by
  barrier: number; // barrier_player_proximity_check (FUN_005e26dc): the colored ring count
  party: readonly number[]; // the armour index of each party member (the DFP 0x18..0x1a loop)
  movement: number; // player +0x328, the movement bits (standing = 0x2, moving = 0x1e & ~0x2)
  team: TeamRecord | null; // the player's lobby team record (teamFrameBonus); null = no record
}

// The beat time is passed in: the live client reads the clock (liveBeatTime, combat/beattime.ts), a
// test passes a fixed value. The other inputs are not in the save or the game, so the defaults are
// ASSUMED: nobody nearby, no colored ring count, the party is the worn armour (the player's own),
// and the player stands still.
export function defaultSetContext(worn: WornEquipment, beatTime: number = 0): SetContext {
  return {
    worn,
    beatTime,
    nearby: 0,
    barrier: 0,
    party: worn.armour ? [worn.armour.data1[2]] : [],
    movement: 0x2,
    team: liveTeamSource(),
  };
}

// The team count term of the armour 0x55 (DFP) and the shield 0x95 (ATP) set bonuses
// (handle_frame_weapon_set_bonus 0x005d53ac case 0x55, handle_barrier_and_weapon_set_bonus
// 0x005d4e14 case 0x95; objdump 0x005d53fd..0x005d54d4 and 0x005d4e75..0x005d4f4a). The record is
// found when its first four dwords are not all zero (the exe's test on the copied record; no
// record zeroes the copy); then the byte +0x11 is taken, capped at 100, and doubled. Not found: 0.
export function teamFrameBonus(ctx: SetContext): number {
  const r = ctx.team;
  if (!r || (r.masterGuildCard | r.teamId | r.unknownA5 | r.unknownA6) === 0) return 0;
  return 2 * Math.min(100, r.memberCount);
}

// The movement bits at player +0x328: standing 0x2; the 0x1e mask is running | unknown | walking | standing.
const STANDING = 0x2;

// A worn item's group_2 / index, -1 when the slot is empty (no compare matches -1).
const slotByte = (it: ItemData | null | undefined, i: number): number => (it ? it.data1[i] : -1);

// morning_glory_atp_bonus (FUN_005d3f70): only an item whose sub is 0x94 gets the beat-time term,
// ((beat >> 1) >>> 30) + beat) >> 2; otherwise the base 0.0 (0x0092c448).
export function morningGloryAtpBonus(item: ItemLike, beatTime: number): number {
  if (item.data1[1] !== 0x94) return SET_F.morningBase;
  return ((((beatTime >> 1) >>> 30) + beatTime) >> 2);
}

// get_equipment_set_atp_bonus_weapon (FUN_005d3b54). The galatine (sub 1, idx 8) factor is a
// ladder on the beat time: the exe's && chain leaves the last assigned value at each step.
function galatineFactor(t: number): number {
  const g = SET_F.atpGalatine;
  if (t <= 124) return g[0];
  if (t <= 249) return g[1];
  if (t <= 374) return g[2];
  if (t <= 499) return g[3];
  if (t <= 624) return g[4];
  if (t <= 749) return g[3];
  if (t < 875) return g[2];
  return g[1];
}

export function setFactorAtp(item: ItemLike, ctx: SetContext): number {
  const d = item.data1;
  const { worn } = ctx;
  const shield = slotByte(worn.shield, 2);
  const armour = slotByte(worn.armour, 2);
  const weapon = d[2];
  let f = SET_F.one;
  if (d[1] === 1) {
    if (d[2] === 5) {
      if (shield === 0x26 && armour === 0x28) f = SET_F.atpArmourSet;
    } else if (d[2] === 8) {
      f = galatineFactor(ctx.beatTime);
    }
  } else if (d[1] === 2) {
    if (d[2] === 5 && shield === 0x24 && armour === 0x26) f = SET_F.atpArmourSet;
  } else if (d[1] === 6) {
    if (d[2] === 6 && shield === 0x25 && armour === 0x27) f = SET_F.atpArmourSet;
  } else if (d[1] === 0x1a) {
    if (shield === 0x1a) f = SET_F.atpShieldSet;
  } else if (d[1] === 0x2d || d[1] === 0x39 || d[1] === 0x41) {
    if (armour === 0x40) f = SET_F.atpSet1_3;
    else if (armour === 0x50) f = SET_F.atpArmourSet;
  } else if (d[1] === 5) {
    if (armour === 0x41 && weapon > 4 && weapon < 8) f = SET_F.atpArmourSet;
  } else if (d[1] === 0x99) {
    if (armour === 0x45) f = SET_F.atpSet1_3;
  } else if (d[1] === 0x10) {
    if (armour === 0x56 && weapon < 7) f = SET_F.atpSet1_3;
  }
  // The sweetheart armour (0x45) multiplies by the teammates close by (after the weapon branch).
  if (armour === 0x45) {
    if (ctx.nearby === 1) f = F(f * SET_F.atpNearby[0]);
    else if (ctx.nearby === 2) f = F(f * SET_F.atpNearby[1]);
    else if (ctx.nearby === 3) f = F(f * SET_F.atpNearby[2]);
  }
  return f;
}

// get_equipment_set_dfp_bonus (FUN_005d3780, dump 426335): the armour's DFP factor.
export function setFactorDfp(item: ItemLike, ctx: SetContext): number {
  const { worn } = ctx;
  const shield = slotByte(worn.shield, 2);
  const weaponSub = slotByte(worn.weapon, 1);
  const weaponIdx = slotByte(worn.weapon, 2);
  const party = (set: readonly number[]) => ctx.party.some((i) => set.includes(i));
  let f = SET_F.one;
  switch (item.data1[2]) {
    case 0x18:
      if (party([0x19, 0x1a])) f = SET_F.dfpArmourSet;
      break;
    case 0x19:
      if (party([0x1a, 0x18])) f = SET_F.dfpArmourSet;
      break;
    case 0x1a:
      if (party([0x19, 0x18])) f = SET_F.dfpArmourSet;
      break;
    case 0x26:
      if (weaponSub === 2 && weaponIdx === 5 && shield === 0x24) f = SET_F.dfpSwordShield;
      break;
    case 0x27:
      if (weaponSub === 6 && weaponIdx === 6 && shield === 0x25) f = SET_F.dfpSwordShield;
      break;
    case 0x28:
      if (weaponSub === 1 && weaponIdx === 5 && shield === 0x26) f = SET_F.dfpSwordShield;
      break;
    case 0x2d:
      if (ctx.nearby !== 0) f = SET_F.dfpSwordShield;
      break;
    case 0x45:
      if (ctx.nearby === 1) f = SET_F.dfpSweetheart[0];
      else if (ctx.nearby === 2) f = SET_F.dfpSweetheart[1];
      else if (ctx.nearby === 3) f = SET_F.dfpSweetheart[2];
      if (shield === 0x2a) f = SET_F.dfpShield2A;
      break;
    default:
      break;
  }
  // The honeycomb reflector (shield 0x92) overrides the factor while the player is not standing.
  if (shield === 0x92 && (ctx.movement & STANDING) === 0) {
    f = (ctx.movement & 0x1e) !== 0 ? SET_F.one : SET_F.dfpHoneycombMoving;
  }
  return f;
}

// get_equipment_set_evp_bonus (FUN_005d35d0, dump 426273): the shield's EVP factor.
export function setFactorEvp(item: ItemLike, ctx: SetContext): number {
  const { worn } = ctx;
  const armour = slotByte(worn.armour, 2);
  const weaponSub = slotByte(worn.weapon, 1);
  const weaponIdx = slotByte(worn.weapon, 2);
  let f = SET_F.one;
  switch (item.data1[2]) {
    case 0x1a:
      if (weaponSub === 0x1a) f = SET_F.evpSwordShield;
      break;
    case 0x26:
      if (weaponSub === 1 && weaponIdx === 5 && armour === 0x28) f = SET_F.evpSaberArmour;
      break;
    case 0x24:
      if (weaponSub === 2 && weaponIdx === 5 && armour === 0x26) f = SET_F.evpSaberArmour;
      break;
    case 0x25:
      if (weaponSub === 6 && weaponIdx === 6 && armour === 0x27) f = SET_F.evpSaberArmour;
      break;
    case 0x92:
      // g_EquipmentSetBonus_SaberArmor (1.5) while standing, else NoMovement (0.5) when still and 1.0 when moving.
      if ((ctx.movement & STANDING) !== 0) f = SET_F.evpSaberArmour;
      else f = (ctx.movement & 0x1e) !== 0 ? SET_F.one : SET_F.evpNoMovement;
      break;
    default:
      break;
  }
  return f;
}

// colored_ring_matching_boosts (FUN_005d4afc, dump 427069): shields 0x53..0x82 scale their effect
// with the colored ring count (barrier_player_proximity_check) by a table of 8 weights on
// (idx - 0x53) & 7. Writes go into t (the caller adds them with its sign).
const RING_WEIGHT = [0, 50, 25, 25, 100, 50, 50, 10] as const;
export function applyColoredRing(item: ItemLike, barrier: number, t: CandidateBlocks): void {
  const d = item.data1;
  if (!(d[0] === 1 && d[1] === 2 && d[2] > 0x52 && d[2] < 0x83)) return;
  const k = (d[2] - 0x53) & 7;
  const s = barrier * RING_WEIGHT[k];
  switch (k) {
    case 1: t.resDfp += s; break; // resist dword +0x1c (DFP)
    case 2: t.resEvp += s; break; // resist [0] (EVP)
    case 3: t.lck += s; break; // stat [6]
    case 4: t.ataMin += s; break; // range [2] (ATA, tenths)
    case 5: t.rmin += s; t.rmax += s; break; // range [0], [1] (ATP)
    case 6: t.mst += s; break; // stat [1]
    default: break; // 0: nothing; 7: the elemental resists [1..5], not compared
  }
}

// handle_item_set_bonus (FUN_005d4c38, dump 427136) and its handlers. Only the branches whose
// effect is a stat or the compared resist (DFP / EVP) and whose condition is in the worn slots
// are ported. Not ported (ASSUMED no effect in the compare): the branches that write the
// elemental resists [1..5] (weapon 0xc5 / 0xac, armour 0x9b, shield 0x9b / 0x93 / 0x2a's armour
// part, mag 'D'); the branches gated on param_6 (the float writes and the stat of a 0xe / 0xc
// slot, null in PlayerRecalculateStats); the weapon-misc tail (party table). The armour 0x55 and
// the shield 0x95 read the player's team record (teamFrameBonus, 2026-10-25).
const PROOF_OF_SWORD_SAINT: readonly (readonly [number, number, number])[] = [
  [0x00, 0x03, 0x09], [0x00, 0x89, 0x00], [0x00, 0x89, 0x01], [0x00, 0x89, 0x02], [0x00, 0x89, 0x03],
  [0x00, 0xb8, 0x00], [0x00, 0x10, 0x00], [0x00, 0x10, 0x07], [0x00, 0x8a, 0x00], [0x00, 0x8a, 0x01],
  [0x00, 0x8a, 0x02], [0x00, 0x29, 0x00], [0x00, 0xb6, 0x00], [0x00, 0xb7, 0x00], [0x00, 0xc6, 0x00],
  [0x00, 0xc7, 0x00], [0x00, 0x01, 0x06], [0x00, 0x01, 0x07], [0x00, 0x01, 0x08], [0x00, 0x2d, 0x00],
  [0x00, 0x1a, 0x00], [0x00, 0x2c, 0x00], [0x00, 0x1f, 0x00], [0x00, 0x27, 0x00], [0x00, 0xb4, 0x00],
  [0x00, 0xac, 0x00], [0x00, 0xb9, 0x00],
];

// handle_weapon_misc_set_bonus (FUN_005d583c): keyed by the candidate weapon's sub (d[1]).
function weaponMiscSetBonus(d: Uint8Array | number[], ctx: SetContext, t: CandidateBlocks): void {
  const { worn } = ctx;
  const sub = d[1];
  if (sub === 0x06) {
    // The mag slot (1) with sub 'H' (0x48) and the weapon index 8: LCK +100.
    if (d[2] === 8 && worn.mag && worn.mag.data1[1] === 0x48) t.lck += 100;
  } else if (sub === 0xb4) {
    // A unit 'H' in the unit slots: ATA range +300 (once).
    if (worn.units.some((u) => u.data1[0] === 1 && u.data1[1] === 3 && u.data1[2] === 0x48)) t.ataMin += 300;
  } else if (sub === 0xbf) {
    // The shield 0x87 (1, 2): ATP range +30.
    const s = worn.shield;
    if (s && s.data1[0] === 1 && s.data1[1] === 2 && s.data1[2] === 0x87) {
      t.rmin += 30;
      t.rmax += 30;
    }
  }
}

// handle_frame_weapon_set_bonus (FUN_005d53ac): keyed by the candidate armour's index (d[2]); the
// weapon in slot 6 is the condition.
function frameWeaponSetBonus(idx: number, ctx: SetContext, t: CandidateBlocks): void {
  const sub = slotByte(ctx.worn.weapon, 1);
  const wi = slotByte(ctx.worn.weapon, 2);
  switch (idx) {
    case 0x37:
      if (sub === 0x94) { t.rmin += 150; t.rmax += 150; t.ataMin += 100; }
      break;
    case 0x3b:
      if ((sub === 0x89 && wi === 3) || (sub === 0x8a && wi < 3)) { t.rmin += 100; t.rmax += 100; t.ataMin += 100; }
      break;
    case 0x40:
      if (sub === 0x2d || sub === 0x39 || sub === 0x41) t.ataMin += 150;
      break;
    case 0x41:
      if (sub === 0x05 && wi > 4 && wi < 8) t.ataMin += 300;
      break;
    case 0x45:
      if (sub === 0x99) t.ataMin += 120;
      break;
    case 0x50:
      if (sub === 0x2d || sub === 0x39 || sub === 0x41) t.ataMin += 220;
      break;
    case 0x56:
      if (sub === 0x10 && wi < 7) t.ataMin += 200;
      break;
    case 0x55:
      // The team count term: DFP (the resist dword +0x1c, objdump 0x005d5492..0x005d54d0).
      t.resDfp += teamFrameBonus(ctx);
      break;
    default:
      break;
  }
}

// handle_barrier_and_weapon_set_bonus (FUN_005d4e14): keyed by the candidate shield's index (d[2]).
function barrierWeaponSetBonus(idx: number, ctx: SetContext, t: CandidateBlocks): void {
  const sub = slotByte(ctx.worn.weapon, 1);
  const wi = slotByte(ctx.worn.weapon, 2);
  if (idx === 0x2a) {
    if (sub === 0x14 && wi === 1) t.ataMin += 300;
  } else if (idx === 0x85) {
    // The weapon's sub decides; the ATA range goes down for 0x07 items by their index.
    if (sub === 0x65 || (sub >= 0x6a && sub <= 0x6c)) {
      t.ataMin += 300;
    } else if (sub === 0x07) {
      if (wi === 8) { t.ataMin -= 200; t.resDfp -= 10; }
      else if (wi >= 9 && wi <= 0xc) t.ataMin -= 200;
      else if (wi === 0xd) t.ataMin -= 300;
    }
  } else if (idx === 0x87) {
    // The stat [0] word (ATP), not the EVP resist: objdump 0x005d5128 `add word [eax], 0x32`.
    if (sub === 0xbf) t.atp += 50;
  } else if (idx === 0x95) {
    // The team count term on the stat [0] word (ATP), objdump 0x005d4f47 `add word [ecx], ax`.
    t.atp += teamFrameBonus(ctx);
  }
}

// PlayerRecalculateStats' candidate also runs handle_item_set_bonus for a unit 'P' (0x50): the worn
// weapon in the table gives ATA range +300, EVP +60 and DFP -20.
function proofOfSwordSaint(ctx: SetContext, t: CandidateBlocks): void {
  const w = ctx.worn.weapon;
  if (!w) return;
  const d = w.data1;
  if (PROOF_OF_SWORD_SAINT.some(([a, b, c]) => d[0] === a && d[1] === b && d[2] === c)) {
    t.ataMin += 300;
    t.resEvp += 60;
    t.resDfp -= 20;
  }
}

// The colored ring and the item set bonus for one candidate (both run for every item in
// ApplyEquipmentBonuses_005d330c). Writes into t; the caller adds t with its sign.
export function itemSetBonusDelta(item: ItemLike, ctx: SetContext): CandidateBlocks {
  const t = zeroBlocks();
  const d = item.data1;
  applyColoredRing(item, ctx.barrier, t);
  if (d[0] === 0) weaponMiscSetBonus(d, ctx, t);
  else if (d[0] === 1 && d[1] === 1) frameWeaponSetBonus(d[2], ctx, t);
  else if (d[0] === 1 && d[1] === 2) barrierWeaponSetBonus(d[2], ctx, t);
  else if (d[0] === 1 && d[1] === 3 && d[2] === 0x50) proofOfSwordSaint(ctx, t);
  return t;
}

function applySetBonuses(item: ItemLike, ctx: SetContext, b: CandidateBlocks, sign: 1 | -1): void {
  const t = itemSetBonusDelta(item, ctx);
  for (const k of Object.keys(t) as (keyof CandidateBlocks)[]) b[k] += sign * t[k];
}

// One item's stat-block contribution (stat [0] ATP, [1] MST, [5] ATA): what ApplyEquipmentBonuses_005d330c
// adds to the stat block (its param_4). ValidateItemForEquip_005c9e40 (dump 418164) takes it off the
// displayed stats of the worn weapon before it compares a candidate's requirements (see itempack.ts).
export function statContribution(item: ItemLike, pmt: ItemPMT): { atp: number; mst: number; ata: number } {
  const b = zeroBlocks();
  applyItem(b, item, pmt, 1);
  return { atp: b.atp, mst: b.mst, ata: b.ata };
}

// A worn mag's stat effect: ApplyItemStatBonuses_005d3fa4 (PsoBB.exe 0x005d3fa4, dump 426621), the
// branch of ApplyEquipmentBonuses_005d330c for data1[0] == 2. Its stats pointer is the dispatcher's
// fourth stack argument (the disassembly: `mov edi, [esp+0x50]` after two pushes and `sub esp, 0x38`,
// which is param_4 of the dispatcher, the stat block). Stat block indices: [0] ATP, [1] MST, [4] DFP,
// [5] ATA (tenths). The four factors are the exe's floats (tools/exedata.py read): g_ItemStatMultiplier
// 0x0092c158 = 2.0 (POW -> ATP), 0x0092c15c = 0.5 (DEX x 10 -> ATA), 0x0092c160 = 1.0 (DEF -> DFP),
// 0x0092c164 = 2.0 (MIND -> MST). Each mag field is the 16-bit word & 0x7ffe (GetItemMagData_005d4108,
// dump 426644) over 100 (an integer division), and the products are exact, so ROUND is the identity here.
export const MAG_STAT_FACTORS = { pow: 2.0, dex: 0.5, def: 1.0, mind: 2.0 } as const;

export function magStatContribution(item: ItemLike): { atp: number; mst: number; dfp: number; ata: number } {
  const d = item.data1;
  if (d[0] !== 2) return { atp: 0, mst: 0, dfp: 0, ata: 0 };
  // data1 words: [2] def, [3] pow, [4] dex, [5] mind (the port's magStats / newserv layout).
  const level = (word: number) => Math.floor(((d[word * 2] | (d[word * 2 + 1] << 8)) & 0x7ffe) / 100);
  const def = level(2);
  const pow = level(3);
  const dex = level(4);
  const mind = level(5);
  return {
    atp: Math.round(pow * MAG_STAT_FACTORS.pow),
    mst: Math.round(mind * MAG_STAT_FACTORS.mind),
    dfp: Math.round(def * MAG_STAT_FACTORS.def),
    ata: Math.round(dex * 10 * MAG_STAT_FACTORS.dex),
  };
}

// The blocks of the current state. The file's stats are the stat block (the save, see the
// header), so the stat fields are taken as they are; the range (class + worn weapon and options)
// and the resist (worn armour / shield and options) come from the class and the worn items. The
// worn items' stat contributions are already in the file and are not added again.
export function blocksFromFile(file: CompareStats, worn: WornEquipment, charClass: number, pmt: ItemPMT, beatTime = 0): CandidateBlocks {
  const cls = PLAYER_CLASS_ATTACK[charClass] ?? PLAYER_CLASS_ATTACK[0];
  const wz = zeroBlocks();
  const ctx = defaultSetContext(worn, beatTime);
  for (const it of [worn.weapon, worn.armour, worn.shield, ...worn.units]) if (it) applyItem(wz, it, pmt, 1, ctx);
  return {
    atp: file.atp,
    mst: file.mst,
    evp: file.evp,
    dfp: file.dfp,
    ata: file.ata,
    lck: file.lck,
    rmin: cls[0] + wz.rmin,
    rmax: cls[1] + wz.rmax,
    ataMin: cls[2] + wz.ataMin,
    resEvp: wz.resEvp,
    resDfp: wz.resDfp,
  };
}

// The totals the compare list's current row shows (UpdatePlayerDisplayStats, dump 728017):
// CalculateChallengeDamage's six values for the worn state (no clamp: the save was clamped).
export function displayedStats(file: CompareStats, worn: WornEquipment, charClass: number, pmt: ItemPMT, beatTime = 0): CandidateStats {
  return challengeOutputs(blocksFromFile(file, worn, charClass, pmt, beatTime));
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
// (vtable 0x5c), and when that item is an armour the four unit slots' units come out too (dump
// 569766, the unit1..unit4 loop: the candidate is not given the units back), the candidate goes
// in (ApplyEquipmentBonuses), the stat block is clamped, and CalculateChallengeDamage gives the
// six values.
export function recalculateCandidate(file: CompareStats, item: ItemLike, worn: WornEquipment, charClass: number, pmt: ItemPMT, beatTime = 0): CandidateStats {
  const s = blocksFromFile(file, worn, charClass, pmt, beatTime);
  const ctx = defaultSetContext(worn, beatTime);
  const slot = compareSlot(item);
  const old = slot ? worn[slot] : null;
  if (old) {
    applyItem(s, old, pmt, -1, ctx);
    if (isArmour(old)) for (const u of worn.units) applyItem(s, u, pmt, -1, ctx);
  }
  applyItem(s, item, pmt, 1, ctx);
  clampToClass(s, charClass);
  return challengeOutputs(s);
}

// PlayerCalculateItemStats_0068e4e8, the cursor item worn: the item comes out of the copies
// (and, for an armour, the worn units too; dump 569928), no candidate, no clamp, then
// CalculateChallengeDamage.
export function equippedCandidate(file: CompareStats, item: ItemLike, worn: WornEquipment, charClass: number, pmt: ItemPMT, beatTime = 0): CandidateStats {
  const s = blocksFromFile(file, worn, charClass, pmt, beatTime);
  const ctx = defaultSetContext(worn, beatTime);
  applyItem(s, item, pmt, -1, ctx);
  if (isArmour(item)) for (const u of worn.units) applyItem(s, u, pmt, -1, ctx);
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
// Settled split (2026-10-23, DEVLOG "the save holds the stat block"): the saved ATP IS the
// base (+0x2cc, base_atp = stats->atp in the init, dump 746015). The exe's range is
// [base + rmin, base + rmax]: variance = rmax - rmin (+0x2ce, the init's sVar2) and rmin = the
// class range min + the weapon's range min (+0x31c, atp_range_min, ApplyItemStatsToPlayer_005d1f0c).
// The displayed ATP (UpdatePlayerDisplayStats, dump 728017) is base + variance + rmin = base + rmax,
// so the displayed value is NOT the saved one: it is saved + rmax.
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
  // The weapon's range with the set factor and the item set (weaponRangeContribution, live combat
  // with a SetContext). Absent: the range without a set, atp + 2 x grind.
  range?: AttackRange | undefined;
}

// The class's battleparams attack range (rmin, rmax) before any item.
export function classAttackRange(charClass: number): AttackRange {
  const c = PLAYER_CLASS_ATTACK[charClass] ?? PLAYER_CLASS_ATTACK[0];
  return { min: c[0], max: c[1] };
}

// The range a weapon adds on equip (ASSUMED, see the header).
export function weaponAttackRange(w: WeaponRangeInput | null | undefined): AttackRange {
  if (!w) return { min: 0, max: 0 };
  if (w.range) return w.range;
  return { min: w.atpMin + 2 * w.grind, max: w.atpMax + 2 * w.grind };
}

export interface AttackSplit {
  base: number; // +0x2cc (base_atp_with_shifta)
  variance: number; // +0x2ce (atp_variance_with_shifta), the attack spread
  rmin: number; // +0x31c -> atp_range_min, the equipment ATP
}

// The attacker's ATP split from the saved ATP (the base, see the header): {base, variance, rmin}.
// The damage roll reads base + variance * r + rmin, so its range is [base + rmin, base + rmax].
export function splitAttack(savedAtp: number, charClass: number, weapon: WeaponRangeInput | null): AttackSplit {
  const c = classAttackRange(charClass);
  const w = weaponAttackRange(weapon);
  const rmin = c.min + w.min;
  const rmax = c.max + w.max;
  return { base: savedAtp, variance: rmax - rmin, rmin };
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
