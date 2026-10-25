// The local player's elemental resists (EFR / EIC / ETH / ELT / EDK), as PsoBB.exe keeps them.
//
// WHERE THE EXE KEEPS THEM. The player has two copies:
//   - the resist block (ResistData, 0x20 bytes) at player +0x320 (a pointer; the class's block
//     is inline in the player at +0xe80, LoadPlayerEntityBattleParams_006960e4, dump 577090).
//     Shorts: [0] EVP modifier (+0x0), [1] EFR (+0x2), [2] EIC (+0x4), [3] ETH (+0x6), [4] ELT (+0x8),
//     [5] EDK (+0xa); dword +0x1c DFP modifier (struct battleparams_resists, dump 1510).
//   - the live copy the battle code reads: player +0x2f6 EFR, +0x2f8 ETH, +0x2fa EIC, +0x2fc EDK,
//     +0x2fe ELT (the enemy struct's fields at the same offsets, dump 75194). unknown_set_total_stats_
//     (dump 745936, lines 746027..746031) copies the resist block into them; it runs from
//     LoadPlayerEntityBattleParams (577154), apply_base_stats (572401) and Player_UpdateStatsAndTP
//     (557343). The special handler FUN_007753b4 reads +0x2f6 (fire), +0x2f8 (thunder, 0x7759c1 and
//     the shock chance 0x007770d0), +0x2fa (ice, the freeze chance 0x007771a0) and +0x2fc (insta-kill,
//     0x7758c5).
//
// THE BASE (class). GetPlayerClassData_006acc80 (dump 599045) returns DAT_009688e0 + class * 0x20.
// That table is all zero in PsoBB.exe's .data (exedata read: 192 shorts, none set) and the only
// code reference is that read, so the class base is zero for every class (VERIFIED in the file).
//
// THE ITEMS (ASSUMED: the live block is the sum of the worn items' contributions, clamped as below).
//   - armour (type 1 sub 1, ApplyWeaponStats_005d4840, dump 426949) and shield (type 1 sub 2,
//     ApplyWeaponStatsVariant_005d4774, dump 426913): resist [1..5] += the pmt's SIGNED bytes
//     (the exe casts them to char): EFR = byte 0x15, EIC = 0x17, ETH = 0x16, ELT = 0x19, EDK = 0x18
//     (the decompile's mst_req+1, ata_req+1, ata_req, mst+1, mst of pmt_weapon_bb_t).
//   - unit (type 1 sub 3, ApplyItemStatBonuses_005d41a0, dump 426690): pmt stat 9 = EFR (+2),
//     10 = EIC (+4), 11 = ETH (+6), 12 = ELT (+8), 13 = EDK (+0xa), 14 = all five; value = pmt amount
//     + the item's modifier (bytes 6..7), a 16-bit wrap.
//   - colored ring (colored_ring_matching_boosts, dump 427069): a shield with group_idx 0x53..0x82,
//     case k = (idx - 0x53) & 7 = 7 adds barrier * 10 to all five elementals (RING_WEIGHT[7] = 10).
//   - NOT PORTED: the set-bonus branches of handle_item_set_bonus (dump 427136). The playerstats.ts
//     header claims some write resist [1..5]; in the dump those branches index param_4, which is the
//     stat block (ApplyEquipmentBonuses' 5th argument), so that claim is UNVERIFIED and no elemental
//     set bonus is added here.
//   - mags: ApplyItemStatBonuses_005d3fa4 (dump 426621) writes ATP / MST / ATA / DFP of the stat block
//     only, so a mag gives no elemental resist (VERIFIED).
//   - the option table (STAT_BOOST types 1..16) carries EVP / DFP / range / MST / LCK only, no
//     element (playerstats.ts applyOption; not re-checked here).
//
// THE CLAMP. Player_ApplyStatModifications_0068c5c0 (dump 557408) adds each delta to the block with
// a clamp: a delta that makes the value negative leaves 0, a rise stops at 0x7fff. This is applied
// per item in worn order (ASSUMED order: armour, shield, units in slot order).

import type { ItemPMT, ArmorOrShield } from '../formats/itempmt.ts';
import type { SetContext, WornEquipment, ItemLike } from './playerstats.ts';

// The five elemental resists, in the resist block's order ([1]..[5]) and their names.
export const ELEMENTS = ['efr', 'eic', 'eth', 'elt', 'edk'] as const;
export type Element5 = (typeof ELEMENTS)[number];
export type PlayerElements = Record<Element5, number>;

// The class base (DAT_009688e0, see the header): zero for every class.
export function classBaseElements(_charClass: number): PlayerElements {
  return { efr: 0, eic: 0, eth: 0, elt: 0, edk: 0 };
}

// The signed char of a pmt byte (the exe's (short)*(char *)).
const s8 = (v: number): number => (v << 24) >> 24;

// A little-endian signed 16-bit value from two item bytes (get_armor_dfp's bytes 6..7).
const s16 = (lo: number, hi: number): number => (((lo & 0xff) | ((hi & 0xff) << 8)) << 16) >> 16;
const wrap16 = (v: number): number => (v << 16) >> 16;

// The clamp of Player_ApplyStatModifications for one short: a non-positive delta stops at 0 (a
// negative sum leaves 0), a positive one stops at 0x7fff.
export function addClamped(v: number, d: number): number {
  if (d === 0) return v;
  const s = v + d;
  if (d < 0) return s < 0 ? 0 : s;
  return s < 0x8000 ? s : 0x7fff;
}

// Element index of a unit's pmt stat (9..13 one element, 14 all five); -1 for the other stats.
const UNIT_ELEMENT: Record<number, number> = { 9: 0, 10: 1, 11: 2, 12: 3, 13: 4 };

// The per-element deltas one worn item adds, in ELEMENTS order (the sign is applied by the caller).
// `barrier` is barrier_player_proximity_check's count (the colored ring case only).
export function itemElementDeltas(item: ItemLike, pmt: ItemPMT, barrier: number): number[] {
  const out = [0, 0, 0, 0, 0];
  const d = item.data1;
  if (d[0] === 1 && (d[1] === 1 || d[1] === 2)) {
    const a: ArmorOrShield | undefined = (d[1] === 1 ? pmt.armors : pmt.shields)[d[2]];
    if (a) {
      out[0] = s8(a.efr);
      out[1] = s8(a.eic);
      out[2] = s8(a.eth);
      out[3] = s8(a.elt);
      out[4] = s8(a.edk);
    }
  } else if (d[0] === 1 && d[1] === 3) {
    const u = pmt.units[d[2]];
    if (u) {
      const v = wrap16(u.amount + s16(d[6], d[7]));
      if (u.stat === 14) return [v, v, v, v, v];
      const i = UNIT_ELEMENT[u.stat];
      if (i !== undefined) out[i] = v;
    }
  }
  // The colored ring (a shield, group_idx 0x53..0x82) runs for any item in the exe, so it is added
  // on top of the shield's own elementals.
  if (d[0] === 1 && d[1] === 2 && d[2] > 0x52 && d[2] < 0x83 && ((d[2] - 0x53) & 7) === 7) {
    const s = wrap16(barrier * 10); // RING_WEIGHT[7] = 10 (the exe's local_14[7])
    for (let i = 0; i < 5; i++) out[i] = wrap16(out[i] + s);
  }
  return out;
}

// The local player's elemental resists from the worn equipment: the class base, then each worn
// item in slot order (armour, shield, units), each step clamped (see the header).
export function playerElements(worn: WornEquipment, pmt: ItemPMT, ctx: SetContext): PlayerElements {
  const base = classBaseElements(0);
  const v = ELEMENTS.map((e) => base[e]);
  const items: ItemLike[] = [];
  if (worn.armour) items.push(worn.armour);
  if (worn.shield) items.push(worn.shield);
  for (const u of worn.units) items.push(u);
  for (const it of items) {
    const d = itemElementDeltas(it, pmt, ctx.barrier);
    for (let i = 0; i < 5; i++) v[i] = addClamped(v[i], d[i]);
  }
  return { efr: v[0], eic: v[1], eth: v[2], elt: v[3], edk: v[4] };
}

// The ice freeze chance and the thunder shock chance on the player (freeze_activation_check
// 0x007771a0 with EIC, thunder_special_attack_shock_chance 0x007770d0 with ETH, B branch: an
// enemy attacker on the player): max(0, resist / -100 + 0.75).
export function statusChanceFromResist(resist: number): number {
  return Math.max(0, resist / -100 + 0.75);
}
