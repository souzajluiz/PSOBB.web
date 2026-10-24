// Material use (item 03 0B xx): the Power / Mind / Evade / HP / TP / Defense /
// Luck materials, ported from PsoBB.exe. Pure logic; the owner
// (render/combat.ts, through PlayerProgression) applies the result and the
// item use (net/items.ts) sends 6x27 and removes the item.
//
// From PsoBB.exe (named dump: Psobb.exe-05112026.c; VAs are the functions'):
//   - Item index: data1[2] of 03 0B xx = the material kind (0 Power, 1 Mind,
//     2 Evade, 3 HP, 4 TP, 5 Defense, 6 Luck; 7 is refused in BB). The kind is
//     the item's +0xf4 byte, the apply is ApplyMaterialToItem (0x005df458).
//   - Use check (the item-use validation, the 03 0B branch at 0x005d6268 (the
//     joined label), in the function at 0x005d4c38 whose dump name
//     handle_item_set_bonus does not fit it (ASSUMED that it is the use check:
//     its other branches are the use checks of the port's canUse)):
//       stat kinds (Power, Mind, Evade, Defense, Luck): usable when the stat
//         (battleparams_stats, +0x00..+0x0c) is below the class maximum
//         g_ClassMaxStats[class] (0x00968560, 0x24 bytes a row) AND the
//         material total is below the class cap (can_use_material, 0x006a6e74);
//       HP: usable when the HP material bonus (half_added_hp, player +0x2c0)
//         is below 0xfa (CalculateEffectiveHP_005c55b0 minus the units' HP
//         specials; the specials are not read here, ASSUMED 0);
//       TP: usable when the TP bonus (player +0x2c2) is below 0xfa
//         (CalculateEffectiveDEF_005c5630 reads +0x2c2, its name is wrong).
//       No class check for any kind in the use check.
//   - Material cap (get_max_material_count, 0x006a6ed1): 0x96 (150) for the
//     classes 1, 2, 4, 5, 7, 8, 9 (HUnewearl, HUcast, RAcast, RAcaseal,
//     FOnewm, FOnewearl, HUcaseal), 0xfa (250) for the rest. The total is the
//     sum of the five stat counters (get_material_count, 0x006a6ef4 caller),
//     HP and TP are not in it.
//   - Apply (ApplyMaterialToItem, 0x005df458), amount 2 each:
//       Power / Evade / Defense / Luck: add_*_material (0x00691b74, 0x00691c54,
//         0x00691cc4, 0x00691d34): stat += 2 clamped to the class maximum
//         (ClampAndApplyStatIncrement, 0x0069320e), counter += 1 (check_and_add,
//         0x006a6ef4).
//       Mind: add_mind_material (0x00691be0), NOT used by an android (class_check
//         0xd7 at 0x005ca3d0 must be 0; the android classes are the ones with
//         flag 0x10, see progression.ts isAndroid).
//       HP: Player_AddHp (0x00770ba4) += 2 to the HP bonus (no counter).
//       TP: Player_ModifyTp (0x00770c18) += 2 to the TP bonus, not used by an
//         android (class_check 0xd7 == 0 gates it, 0x005df458 case 4).
//   - Challenge Mode (return1_if_challenge_quest, 0x00688b8c): the amount is
//     x5 (10) for every kind that applies it: add_power / mind / evasion /
//     defense / luck (the x5 in each add_*: 0x00691b74, 0x00691be0 (Ghidra),
//     0x00691c54, 0x00691cc4, 0x00691d34), and the HP / TP apply
//     (ApplyHpIncreaseMaterialToPlayer 0x00691da4, ApplyTpIncrease 0x00691dd0).
//     The counter still goes up by 1.
//   - Max HP / TP follow the bonuses (progression.ts maxHpFor / maxTpFor). The
//     exe refills nothing: current HP and TP stay (ASSUMED from the code: the
//     apply only changes the bonus and calls the player's vtable +0x12c, the
//     total-stats refresh).
//   - Refused uses: the caller's refusal sound is SE 0x17 (the same path as the
//     Sinowberill items, combat/buffs.ts); the port shows no Use button for
//     an unusable item (ui/inventoryPanel.ts), so nothing is sent.

export const MATERIAL_POWER = 0;
export const MATERIAL_MIND = 1;
export const MATERIAL_EVADE = 2;
export const MATERIAL_HP = 3;
export const MATERIAL_TP = 4;
export const MATERIAL_DEFENSE = 5;
export const MATERIAL_LUCK = 6;

export const MATERIAL_NAMES = ['Power', 'Mind', 'Evade', 'HP', 'TP', 'Defense', 'Luck'] as const;

// The stat each stat material raises, and the slot of its counter (the
// material_count order: power, mind, evade, defense, luck).
const STAT_MATERIALS: Record<number, { stat: 'atp' | 'mst' | 'evp' | 'dfp' | 'lck'; slot: number }> = {
  [MATERIAL_POWER]: { stat: 'atp', slot: 0 },
  [MATERIAL_MIND]: { stat: 'mst', slot: 1 },
  [MATERIAL_EVADE]: { stat: 'evp', slot: 2 },
  [MATERIAL_DEFENSE]: { stat: 'dfp', slot: 3 },
  [MATERIAL_LUCK]: { stat: 'lck', slot: 4 },
};

// The Challenge Mode multiplier (return1_if_challenge_quest) and the amount of
// one material (the exe's `2` in ApplyMaterialToItem).
export const MATERIAL_AMOUNT = 2;
export const CHALLENGE_MATERIAL_MULTIPLIER = 5;
// The HP / TP bonus a material use is refused at (0xfa).
export const MATERIAL_BONUS_LIMIT = 0xfa;

// g_ClassMaxStats (0x00968560, 0x24 bytes a row, class_max_stats in the dump: atp, mst, evp,
// hp, dfp, ata, lck, esp as shorts): atp, mst, evp, dfp, ata, lck per class (hp and esp are
// not used here). ata is the exe's clamp for the stat block's ATA (PlayerRecalculateStats_0068e030,
// dump 569766). Read with tools/exedata.py read 00968560 h 216 (the 18-short rows).
export const CLASS_MAX_STATS: readonly { atp: number; mst: number; evp: number; dfp: number; ata: number; lck: number }[] = [
  { atp: 1387, mst: 732, evp: 756, dfp: 579, ata: 1355, lck: 100 }, // HUmar
  { atp: 1227, mst: 1177, evp: 811, dfp: 589, ata: 1388, lck: 100 }, // HUnewearl
  { atp: 1629, mst: 0, evp: 660, dfp: 601, ata: 1300, lck: 100 }, // HUcast (android)
  { atp: 1255, mst: 665, evp: 715, dfp: 515, ata: 1739, lck: 100 }, // RAmar
  { atp: 1345, mst: 0, evp: 699, dfp: 606, ata: 1530, lck: 100 }, // RAcast (android)
  { atp: 1170, mst: 0, evp: 787, dfp: 688, ata: 1580, lck: 100 }, // RAcaseal (android)
  { atp: 869, mst: 1284, evp: 588, dfp: 498, ata: 1088, lck: 100 }, // FOmarl
  { atp: 811, mst: 1500, evp: 679, dfp: 463, ata: 1200, lck: 100 }, // FOnewm
  { atp: 580, mst: 1750, evp: 883, dfp: 390, ata: 1260, lck: 100 }, // FOnewearl
  { atp: 1291, mst: 0, evp: 877, dfp: 525, ata: 1500, lck: 100 }, // HUcaseal (android)
  { atp: 999, mst: 1340, evp: 651, dfp: 470, ata: 1010, lck: 100 }, // FOmar
  { atp: 1140, mst: 1031, evp: 900, dfp: 577, ata: 1730, lck: 100 }, // RAmarl
];

// The android classes: class_check(player, 0xd7) is 1 for them (the flag 0x10
// of CLASS_FLAGS, progression.ts).
const ANDROID_CLASSES = new Set([2, 4, 5, 9]);

// get_max_material_count: 150 for the classes 1, 2, 4, 5, 7, 8, 9, else 250.
export function materialCap(charClass: number): number {
  return [1, 2, 4, 5, 7, 8, 9].includes(charClass) ? 0x96 : 0xfa;
}

// What the material rules read and change. PlayerProgression implements it.
export interface MaterialHolder {
  charClass: number;
  stats: { atp: number; mst: number; evp: number; dfp: number; lck: number };
  // power, mind, evade, defense, luck (the exe's material_count).
  materialCounts: number[];
  hpMaterials: number; // the HP bonus (the raw inventory byte 1)
  tpMaterials: number; // the TP bonus (the raw inventory byte 2)
}

export function materialTotal(h: MaterialHolder): number {
  return h.materialCounts.reduce((a, b) => a + b, 0) & 0xff;
}

// The use check (see the header). False for an unknown kind.
export function materialUsable(kind: number, h: MaterialHolder): boolean {
  if (!Number.isInteger(kind) || kind < 0 || kind > MATERIAL_LUCK) return false;
  if (kind === MATERIAL_HP) return h.hpMaterials < MATERIAL_BONUS_LIMIT;
  if (kind === MATERIAL_TP) return h.tpMaterials < MATERIAL_BONUS_LIMIT;
  const m = STAT_MATERIALS[kind];
  const max = CLASS_MAX_STATS[h.charClass];
  if (!m || !max) return false;
  if (h.stats[m.stat] >= max[m.stat]) return false;
  return materialTotal(h) < materialCap(h.charClass);
}

// ClampAndApplyStatIncrement (0x0069320e): v + inc, not below 0, not above max.
export function clampStatIncrement(v: number, inc: number, max: number): number {
  const s = v + inc;
  if (s < 0) return 0;
  return s - max > 0 ? max : s;
}

// Applies one material (after materialUsable). Returns the amount applied
// (0 when the material does nothing, e.g. Mind or TP for an android).
export function applyMaterial(kind: number, h: MaterialHolder, challenge: boolean): number {
  const amount = challenge ? MATERIAL_AMOUNT * CHALLENGE_MATERIAL_MULTIPLIER : MATERIAL_AMOUNT;
  const android = ANDROID_CLASSES.has(h.charClass);
  if (kind === MATERIAL_HP) {
    h.hpMaterials += amount;
    return amount;
  }
  if (kind === MATERIAL_TP) {
    if (android) return 0;
    h.tpMaterials += amount;
    return amount;
  }
  const m = STAT_MATERIALS[kind];
  if (!m) return 0;
  if (kind === MATERIAL_MIND && android) return 0;
  h.stats[m.stat] = clampStatIncrement(h.stats[m.stat], amount, CLASS_MAX_STATS[h.charClass][m.stat]);
  // check_and_add_materials: counts 1 unless the total would pass the cap.
  if (materialCap(h.charClass) >= ((materialTotal(h) + 1) & 0xff)) h.materialCounts[m.slot] += 1;
  return amount;
}
