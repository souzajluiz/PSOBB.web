// The quick menu compare list's candidate values (client/src/combat/playerstats.ts): the
// exe's PlayerRecalculateStats_0068e030 / PlayerCalculateItemStats_0068e4e8, absolute values
// for all six rows (ATP, DFP, MST, ATA, EVP, LCK), and the compare rows' colours.
// Run: node tests/playerstats.test.ts
import { ItemPMT } from '../client/src/formats/itempmt.ts';
import { itemFromHex } from '../client/src/formats/itemnames.ts';
import { compareColor, compareStatRows, equipStatRows, VALUE_COLOR, type StatBlock } from '../client/src/classic/itemdetail.ts';
import {
  applyItem,
  blocksFromFile,
  equipmentRange,
  equippedCandidate,
  recalculateCandidate,
  wornEquipment,
  type CompareStats,
} from '../client/src/combat/playerstats.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// The PMT: weapons[3][0] = a sword (ATP 10..20, MST 2, ATA 3); weapons[3][1] = a shorter one
// (ATP 8..16, option row 1: MST +3). Armour 0 (DFP 12, EVP 7), armour 1 (DFP 30, EVP 5).
// Option rows: 0 = nothing, 1 = type 5 (MST) amount 3.
const pmt = new ItemPMT();
pmt.weapons[3] = [
  { id: 40, usabilityFlags: 0xff, atpRequired: 50, mstRequired: 5, ataRequired: 20, atpMin: 10, atpMax: 20, mst: 2, ata: 3, statBoostEntryIndex: 0 } as never,
  { id: 41, usabilityFlags: 0xff, atpRequired: 10, mstRequired: 0, ataRequired: 0, atpMin: 8, atpMax: 16, mst: 0, ata: 0, statBoostEntryIndex: 1 } as never,
];
pmt.armors[0] = { id: 20, usabilityFlags: 0xff, requiredLevel: 0, dfp: 12, evp: 7, statBoostEntryIndex: 0 } as never;
pmt.armors[1] = { id: 21, usabilityFlags: 0xff, requiredLevel: 0, dfp: 30, evp: 5, statBoostEntryIndex: 0 } as never;
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
const TOOL = itemFromHex('030000000004000000000000');

// HUmar (class 0): the class range is 5..10 with min ATA 650; the class max row is atp 1387,
// mst 732, evp 756, dfp 579, ata 1355, lck 100. The character: stat block ATP 100, MST 50,
// EVP 40, DFP 30, ATA 200 (tenths of the stat), LCK 3, worn sword G2 and armour 0.
//   range max = 10 + (20 + 4) = 34, ATA min = 650 + 30 = 680, ATA = ROUND(0.1 * 880) = 88;
//   the sword's MST 2 and the armour's DFP 12 / EVP 7 are in the displayed sums.
const wornBoth = { weapon: SWORD_G2, armour: ARMOR, shield: null };
const fileStats: CompareStats = { atp: 134, dfp: 42, mst: 52, ata: 88, evp: 47, lck: 3 };

// The same character with no weapon worn (the sword's ATP and MST, and its ATA, are gone).
const fileNoWeapon: CompareStats = { atp: 110, dfp: 42, mst: 50, ata: 85, evp: 47, lck: 3 };
const wornArmourOnly = { weapon: null, armour: ARMOR, shield: null };

// --- the range an item adds (ApplyEquipmentBonuses_005d330c: weapon ATP min / max + 2 x grind) ---
eq(equipmentRange(SWORD_G2, pmt), { min: 14, max: 24 }, 'sword grind 2: min 10 + 4, max 20 + 4');
eq(equipmentRange(SHORT_G0, pmt), { min: 8, max: 16 }, 'short sword grind 0');
eq(equipmentRange(ARMOR, pmt), { min: 0, max: 0 }, 'armour adds no ATP range');
eq(equipmentRange(TOOL, pmt), { min: 0, max: 0 }, 'tool adds no ATP range');

// --- the blocks the displayed stats stand for (the worn items come out of the sums) ---
const b0 = blocksFromFile(fileStats, wornBoth, 0, pmt);
eq([b0.atp, b0.rmax, b0.ataMin, b0.ata, b0.mst, b0.resDfp, b0.resEvp], [100, 34, 680, 200, 52, 12, 7], 'blocks: ATP base, range max, ATA min, ATA base, MST total (the sword 2 in it), resist DFP / EVP');

// --- PlayerRecalculateStats: a candidate that is not worn ---
eq(recalculateCandidate(fileNoWeapon, SWORD_G2, wornArmourOnly, 0, pmt), { atp: 134, dfp: 42, mst: 52, ata: 88, evp: 47, lck: 3 }, 'sword into an empty weapon slot: the displayed values of the worn sword');
eq(recalculateCandidate(fileStats, SHORT_G0, wornBoth, 0, pmt), { atp: 126, dfp: 42, mst: 53, ata: 85, evp: 47, lck: 3 }, 'short sword over the worn sword: ATP 100 + 16, MST 50 + option 3, ATA without the sword');
eq(recalculateCandidate(fileStats, ARMOR2, wornBoth, 0, pmt), { atp: 134, dfp: 60, mst: 52, ata: 88, evp: 45, lck: 3 }, 'armour 1 over armour 0: DFP 30 + 30, EVP 40 + 5');
eq(recalculateCandidate(fileStats, ARMOR, wornBoth, 0, pmt), fileStats, 'the worn armour as a candidate: the file values back');

// The stat block's clamp (PlayerRecalculateStats only): an ATP base above the class max is cut.
const over: CompareStats = { ...fileStats, atp: 1534 };
eq(recalculateCandidate(over, ARMOR, wornBoth, 0, pmt).atp, 1387 + 34, 'not worn: the ATP base is clamped to the class max (1387)');
eq(equippedCandidate(over, SWORD_G2, wornBoth, 0, pmt).atp, 1500 + 10, 'worn: no clamp, the sword comes out of the sum');

// --- PlayerCalculateItemStats: the worn item (its own range and MST go away) ---
eq(equippedCandidate(fileStats, SWORD_G2, wornBoth, 0, pmt), { atp: 110, dfp: 42, mst: 50, ata: 85, evp: 47, lck: 3 }, 'worn sword: the sum without it');
eq(equippedCandidate(fileStats, ARMOR, wornBoth, 0, pmt), { atp: 134, dfp: 30, mst: 52, ata: 88, evp: 40, lck: 3 }, 'worn armour: DFP 30 and EVP 40 without its resist');

// The worn-set helper takes the first equipped item of each slot.
eq(wornEquipment([SWORD_G2, ARMOR, TOOL]).weapon === SWORD_G2 && wornEquipment([SWORD_G2, ARMOR]).armour === ARMOR, true, 'wornEquipment: one item per slot');

// The resist block's DFP / EVP of an item (armour: pmt dfp / evp; bytes 6..9 add to them).
const bArmour = { atp: 0, mst: 0, evp: 0, dfp: 0, ata: 0, lck: 0, rmin: 0, rmax: 0, ataMin: 0, resEvp: 0, resDfp: 0 };
applyItem(bArmour, ARMOR, pmt, 1);
eq([bArmour.resDfp, bArmour.resEvp], [12, 7], 'armour block: DFP 12, EVP 7');

// --- the compare rows (UpdateEquipmentStatDisplay_007258dc) ---
const cur: StatBlock = { ...fileNoWeapon };
const cand = recalculateCandidate(fileNoWeapon, SWORD_G2, wornArmourOnly, 0, pmt);
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

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
if (failures) process.exitCode = 1;
