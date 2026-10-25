// The quick menu compare list's candidate values (client/src/combat/playerstats.ts): the
// exe's PlayerRecalculateStats_0068e030 / PlayerCalculateItemStats_0068e4e8, absolute values
// for all six rows (ATP, DFP, MST, ATA, EVP, LCK), and the compare rows' colours.
// The save's stats are the stat block (+0x2b4), not the displayed totals: the file values below
// are the stat block (ATP = base, EVP / DFP / ATA without the worn resist and range).
// Run: node tests/playerstats.test.ts
import { ItemPMT } from '../client/src/formats/itempmt.ts';
import { itemFromHex } from '../client/src/formats/itemnames.ts';
import { compareColor, compareStatRows, equipStatRows, VALUE_COLOR, type StatBlock } from '../client/src/classic/itemdetail.ts';
import {
  applyItem,
  blocksFromFile,
  displayedStats,
  equipmentRange,
  equippedCandidate,
  magStatContribution,
  recalculateCandidate,
  wornEquipment,
  type CompareStats,
  type WornEquipment,
} from '../client/src/combat/playerstats.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// The PMT: weapons[3][0] = a sword (ATP 10..20, MST 2, ATA 3); weapons[3][1] = a shorter one
// (ATP 8..16, option row 1: MST +3). Armour 0 (DFP 12, EVP 7), armour 1 (DFP 30, EVP 5),
// shield 0 (DFP 4, EVP 9), unit 1 (stat 0 = ATP, amount 5).
// Option rows: 0 = nothing, 1 = type 5 (MST) amount 3.
const pmt = new ItemPMT();
pmt.weapons[3] = [
  { id: 40, usabilityFlags: 0xff, atpRequired: 50, mstRequired: 5, ataRequired: 20, atpMin: 10, atpMax: 20, mst: 2, ata: 3, statBoostEntryIndex: 0 } as never,
  { id: 41, usabilityFlags: 0xff, atpRequired: 10, mstRequired: 0, ataRequired: 0, atpMin: 8, atpMax: 16, mst: 0, ata: 0, statBoostEntryIndex: 1 } as never,
];
pmt.armors[0] = { id: 20, usabilityFlags: 0xff, requiredLevel: 0, dfp: 12, evp: 7, statBoostEntryIndex: 0 } as never;
pmt.armors[1] = { id: 21, usabilityFlags: 0xff, requiredLevel: 0, dfp: 30, evp: 5, statBoostEntryIndex: 0 } as never;
pmt.shields[0] = { id: 30, usabilityFlags: 0xff, requiredLevel: 0, dfp: 4, evp: 9, statBoostEntryIndex: 0 } as never;
pmt.units[1] = { id: 50, stat: 0, amount: 5, modifierAmount: 0 } as never;
pmt.statBoosts = [
  { stat1: 0, stat2: 0, amount1: 0, amount2: 0 },
  { stat1: 5, stat2: 0, amount1: 3, amount2: 0 },
];

// Item data1 = [type, sub, variant, grind, ...]. Sword grind 2 = 000300020000...; short sword
// grind 0 = 000301000000...; armour 0 = 010100000000..., armour 1 = 010101000000...
const SWORD_G2 = itemFromHex('000300020000000000000000');
const SHORT_G0 = itemFromHex('000301000000000000000000');
const ARMOR = itemFromHex('010100000000000000000000');
const ARMOR2 = itemFromHex('010101000000000000000000');
const SHIELD0 = itemFromHex('010200000000000000000000');
const UNIT1 = itemFromHex('010301000000000000000000');
const TOOL = itemFromHex('030000000004000000000000');

// HUmar (class 0): the class range is 5..10 with min ATA 650; the class max row is atp 1387,
// mst 732, evp 756, dfp 579, ata 1355, lck 100. The save (the stat block): ATP 100 (base), MST 52
// (the sword's 2 in it), EVP 40, DFP 30, ATA 200 (tenths, no range), LCK 3; worn sword G2 and
// armour 0. The displayed totals: range max 10 + (20 + 4) = 34, so ATP 134; ATA min 650 + 30 =
// 680, so ATA = ROUND(0.1 * 880) = 88; DFP 30 + 12 = 42; EVP 40 + 7 = 47.
const wornBoth: WornEquipment = { weapon: SWORD_G2, armour: ARMOR, shield: null, units: [] };
const saveStats: CompareStats = { atp: 100, dfp: 30, mst: 52, ata: 200, evp: 40, lck: 3 };
const totalsBoth = { atp: 134, dfp: 42, mst: 52, ata: 88, evp: 47, lck: 3 };

// The same character with no weapon worn: the stat block loses the sword's MST only.
const saveNoWeapon: CompareStats = { atp: 100, dfp: 30, mst: 50, ata: 200, evp: 40, lck: 3 };
const wornArmourOnly: WornEquipment = { weapon: null, armour: ARMOR, shield: null, units: [] };

// --- the range an item adds (ApplyEquipmentBonuses_005d330c: weapon ATP min / max + 2 x grind) ---
eq(equipmentRange(SWORD_G2, pmt), { min: 14, max: 24 }, 'sword grind 2: min 10 + 4, max 20 + 4');
eq(equipmentRange(SHORT_G0, pmt), { min: 8, max: 16 }, 'short sword grind 0');
eq(equipmentRange(ARMOR, pmt), { min: 0, max: 0 }, 'armour adds no ATP range');
eq(equipmentRange(TOOL, pmt), { min: 0, max: 0 }, 'tool adds no ATP range');

// --- the save is the stat block; the totals are what the current row shows ---
const b0 = blocksFromFile(saveStats, wornBoth, 0, pmt);
eq([b0.atp, b0.rmax, b0.ataMin, b0.ata, b0.mst, b0.resDfp, b0.resEvp], [100, 34, 680, 200, 52, 12, 7], 'blocks: stat ATP base, range max, ATA min, stat ATA, stat MST, resist DFP / EVP');
eq(displayedStats(saveStats, wornBoth, 0, pmt), totalsBoth, 'displayed totals of the worn sword and armour: ATP 134, DFP 42, ATA 88, EVP 47');

// --- PlayerRecalculateStats: a candidate that is not worn ---
eq(recalculateCandidate(saveNoWeapon, SWORD_G2, wornArmourOnly, 0, pmt), totalsBoth, 'sword into an empty weapon slot: the displayed values with the sword');
eq(recalculateCandidate(saveStats, SHORT_G0, wornBoth, 0, pmt), { atp: 126, dfp: 42, mst: 53, ata: 85, evp: 47, lck: 3 }, 'short sword over the worn sword: ATP 100 + 10 + 16, MST 50 + option 3, ATA without the sword');
eq(recalculateCandidate(saveStats, ARMOR2, wornBoth, 0, pmt), { atp: 134, dfp: 60, mst: 52, ata: 88, evp: 45, lck: 3 }, 'armour 1 over armour 0: DFP 30 + 30, EVP 40 + 5');
eq(recalculateCandidate(saveStats, ARMOR, wornBoth, 0, pmt), totalsBoth, 'the worn armour as a candidate: the displayed values back');
eq(recalculateCandidate(saveStats, SHIELD0, { weapon: SWORD_G2, armour: null, shield: null, units: [] }, 0, pmt), { atp: 134, dfp: 34, mst: 52, ata: 88, evp: 49, lck: 3 }, 'shield into an empty slot: DFP 30 + 4, EVP 40 + 9');

// The stat block's clamp (PlayerRecalculateStats only): an ATP base above the class max is cut.
const over: CompareStats = { ...saveStats, atp: 1534 };
eq(recalculateCandidate(over, ARMOR, wornBoth, 0, pmt).atp, 1387 + 34, 'not worn: the ATP base is clamped to the class max (1387)');
eq(equippedCandidate(over, SWORD_G2, wornBoth, 0, pmt).atp, 1534 + 10, 'worn: no clamp, the sword comes out of the sum');

// --- PlayerCalculateItemStats: the worn item (its own range and MST go away) ---
eq(equippedCandidate(saveStats, SWORD_G2, wornBoth, 0, pmt), { atp: 110, dfp: 42, mst: 50, ata: 85, evp: 47, lck: 3 }, 'worn sword: the sum without it');
eq(equippedCandidate(saveStats, ARMOR, wornBoth, 0, pmt), { atp: 134, dfp: 30, mst: 52, ata: 88, evp: 40, lck: 3 }, 'worn armour: DFP 30 and EVP 40 without its resist');

// --- units: ApplyItemStatBonuses_005d41a0 (stat block), and the armour's unit loop ---
// The save holds the unit's ATP 5 in the stat block (ATP 105); the class range is unchanged.
const wornUnit: WornEquipment = { weapon: SWORD_G2, armour: ARMOR, shield: null, units: [UNIT1] };
const saveUnit: CompareStats = { ...saveStats, atp: 105 };
eq(displayedStats(saveUnit, wornUnit, 0, pmt).atp, 139, 'unit ATP 5 is in the stat block: the displayed ATP is 139');
// A unit as a candidate (no slot to replace): its ATP 5 goes into the stat block.
eq(recalculateCandidate(saveNoWeapon, UNIT1, wornArmourOnly, 0, pmt).atp, 110 + 5, 'unit candidate: ATP 5 added to the stat block');
// The armour's loop (dump 569766): a candidate armour takes the worn units out and does not put
// them back, so the unit's ATP 5 is gone from the armour 1 candidate.
eq(recalculateCandidate(saveUnit, ARMOR2, wornUnit, 0, pmt), { atp: 134, dfp: 60, mst: 52, ata: 88, evp: 45, lck: 3 }, 'armour candidate: worn units taken out (ATP back to 134)');
// A worn armour's unloop (PlayerCalculateItemStats, dump 569928) takes the units out too.
eq(equippedCandidate(saveUnit, ARMOR, wornUnit, 0, pmt).atp, 134, 'worn armour: the units come out with it');
// A weapon's candidate leaves the units in (the loop is for armour only).
eq(equippedCandidate(saveUnit, SWORD_G2, wornUnit, 0, pmt).atp, 105 + 10, 'worn sword: the units stay');

// --- shields: the same numbers as the armour formula, with the set factors at 1.0 (ASSUMED) ---
const shieldBlock = { atp: 0, mst: 0, evp: 0, dfp: 0, ata: 0, lck: 0, rmin: 0, rmax: 0, ataMin: 0, resEvp: 0, resDfp: 0 };
applyItem(shieldBlock, SHIELD0, pmt, 1);
eq([shieldBlock.resDfp, shieldBlock.resEvp], [4, 9], 'shield block: DFP 4, EVP 9');

// The worn-set helper takes the first equipped item of each slot, and the units apart.
eq(wornEquipment([SWORD_G2, ARMOR, TOOL]).weapon === SWORD_G2 && wornEquipment([SWORD_G2, ARMOR]).armour === ARMOR, true, 'wornEquipment: one item per slot');
eq(wornEquipment([UNIT1, SWORD_G2]).units.length, 1, 'wornEquipment: units are kept apart');

// The resist block's DFP / EVP of an item (armour: pmt dfp / evp; bytes 6..9 add to them).
const bArmour = { atp: 0, mst: 0, evp: 0, dfp: 0, ata: 0, lck: 0, rmin: 0, rmax: 0, ataMin: 0, resEvp: 0, resDfp: 0 };
applyItem(bArmour, ARMOR, pmt, 1);
eq([bArmour.resDfp, bArmour.resEvp], [12, 7], 'armour block: DFP 12, EVP 7');

// --- the compare rows (UpdateEquipmentStatDisplay_007258dc) ---
const cur: StatBlock = displayedStats(saveNoWeapon, wornArmourOnly, 0, pmt);
const cand = recalculateCandidate(saveNoWeapon, SWORD_G2, wornArmourOnly, 0, pmt);
eq(cur, { atp: 110, dfp: 42, mst: 50, ata: 85, evp: 47, lck: 3 }, 'current row: the displayed values without the sword');
eq(compareStatRows(cur, cand, true).map((r) => [r.key, r.label, r.current, r.item, r.color]), [
  ['atp', 0x9c, 110, 134, VALUE_COLOR.higher],
  ['dfp', 0x9d, 42, 42, VALUE_COLOR.same],
  ['mst', 0x9e, 50, 52, VALUE_COLOR.higher],
  ['ata', 0x9f, 85, 88, VALUE_COLOR.higher],
  ['evp', 0xa0, 47, 47, VALUE_COLOR.same],
  ['lck', 0xa1, 3, 3, VALUE_COLOR.same],
], 'compare rows: six labels in order, candidate colours');
eq(compareStatRows(cur, cand, false).map((r) => r.color), Array(6).fill(VALUE_COLOR.none), 'not equippable: grey');
eq(compareColor(0, 0), VALUE_COLOR.same, 'zero against zero is white');

// The Item Pack's panel keeps the item-only rows (equipStatRows): the sword's ATP is 40 + 14 (min + 2 x grind) there.
eq(equipStatRows(cur, SWORD_G2, null, pmt, false, true)[0].item, 124, 'Item Pack panel: the item-only delta (110 + min 10 + 2 x grind 2), unchanged');

// --- a worn mag's stat effect (ApplyItemStatBonuses_005d3fa4, dump 426621; the factors are the exe's floats) ---
// data1: type 2, id 1, level 10; def 350 (3), pow 1251 (& 0x7ffe = 1250, level 12), dex 720 (7), mind 880 (8).
const MAG = itemFromHex('02010a005e01e304d0027003');
eq(magStatContribution(MAG), { atp: 24, mst: 16, dfp: 3, ata: 35 }, 'mag: POW x2 to ATP, MIND x2 to MST, DEF x1 to DFP, DEX x10 x0.5 to ATA (tenths)');
eq(magStatContribution(SWORD_G2), { atp: 0, mst: 0, dfp: 0, ata: 0 }, 'mag effect: a weapon adds none here');
eq(magStatContribution(itemFromHex('02010a006300000000000000')), { atp: 0, mst: 0, dfp: 0, ata: 0 }, 'mag effect: under one level adds nothing');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
if (failures) process.exitCode = 1;
