// The quick menu compare list's candidate values (client/src/combat/playerstats.ts): the
// exe's PlayerRecalculateStats_0068e030 / PlayerCalculateItemStats_0068e4e8 as read from the
// asm (only ATP and DFP are written; the DFP is 0), and the compare rows' colours.
// Run: node tests/playerstats.test.ts
import { ItemPMT } from '../client/src/formats/itempmt.ts';
import { itemFromHex } from '../client/src/formats/itemnames.ts';
import { compareColor, compareStatRows, equipStatRows, VALUE_COLOR, type StatBlock } from '../client/src/classic/itemdetail.ts';
import { equipmentRange, equippedCandidate, recalculateCandidate, type CompareStats } from '../client/src/combat/playerstats.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// The PMT: weapons[3][0] = a sword (ATP 10..20, MST 2, ATA 3); weapons[3][1] = a shorter one
// (ATP 8..16). Armour 0 (DFP 12, EVP 7).
const pmt = new ItemPMT();
pmt.weapons[3] = [
  { id: 40, usabilityFlags: 0xff, atpRequired: 50, mstRequired: 5, ataRequired: 20, atpMin: 10, atpMax: 20, mst: 2, ata: 3 } as never,
  { id: 41, usabilityFlags: 0xff, atpRequired: 10, mstRequired: 0, ataRequired: 0, atpMin: 8, atpMax: 16, mst: 0, ata: 0 } as never,
];
pmt.armors[0] = { id: 20, usabilityFlags: 0xff, requiredLevel: 0, dfp: 12, evp: 7 } as never;

// Item data1 = [type, sub, variant, grind, ...]. Sword grind 2 = 000300020000...; short sword
// grind 0 = 000301000000...; armour = 010100000000...
const SWORD_G2 = itemFromHex('000300020000000000000000');
const SHORT_G0 = itemFromHex('000301000000000000000000');
const ARMOR = itemFromHex('010100000000000000000000');
const TOOL = itemFromHex('030000000004000000000000');

// The file's absolute stats of a fixed character (HUmar, level 10).
const fileStats: CompareStats = { atp: 40, dfp: 20, mst: 5, ata: 50, evp: 10, lck: 3 };

// --- the range an item adds (ApplyEquipmentBonuses_005d330c: weapon ATP min / max + 2 x grind) ---
eq(equipmentRange(SWORD_G2, pmt), { min: 14, max: 24 }, 'sword grind 2: min 10 + 4, max 20 + 4');
eq(equipmentRange(SHORT_G0, pmt), { min: 8, max: 16 }, 'short sword grind 0');
eq(equipmentRange(ARMOR, pmt), { min: 0, max: 0 }, 'armour adds no ATP range');
eq(equipmentRange(TOOL, pmt), { min: 0, max: 0 }, 'tool adds no ATP range');

// --- PlayerRecalculateStats: a candidate that is not worn ---
// Nothing in the slot: the candidate's ATP range is added to the file's ATP; DFP 0, other rows 0.
eq(recalculateCandidate(fileStats, SWORD_G2, null, pmt), { atp: 64, dfp: 0, mst: 0, ata: 0, evp: 0, lck: 0 }, 'sword into an empty slot: ATP 40 + 24');
// The short sword worn (max 16) is taken off the slot's delta: 40 + 24 - 16 = 48.
eq(recalculateCandidate(fileStats, SWORD_G2, SHORT_G0, pmt).atp, 48, 'sword over the worn short sword: the worn range goes first');
// An armour changes no ATP; its DFP is the exe's 0 (the buffer's own zero).
eq(recalculateCandidate(fileStats, ARMOR, null, pmt), { atp: 40, dfp: 0, mst: 0, ata: 0, evp: 0, lck: 0 }, 'armour: ATP unchanged, DFP 0 (exe)');
// A candidate worse than the worn one lowers the ATP.
eq(recalculateCandidate(fileStats, SHORT_G0, SWORD_G2, pmt).atp, 40 + 16 - 24, 'short sword over the worn sword: ATP 32');

// --- PlayerCalculateItemStats: the worn item (its own range goes away) ---
eq(equippedCandidate(fileStats, SWORD_G2, pmt), { atp: 16, dfp: 0, mst: 0, ata: 0, evp: 0, lck: 0 }, 'worn sword: the stat block without it, ATP 40 - 24');
eq(equippedCandidate(fileStats, ARMOR, pmt).atp, 40, 'worn armour: no ATP to remove');

// The DFP is 0 for every candidate, and the other rows are 0, whatever the file says.
const all = [recalculateCandidate(fileStats, SWORD_G2, null, pmt), recalculateCandidate(fileStats, ARMOR, null, pmt), equippedCandidate(fileStats, SWORD_G2, pmt)];
eq(all.map((c) => [c.dfp, c.mst, c.ata, c.evp, c.lck].every((v) => v === 0)), [true, true, true], 'exe: only ATP is computed');

// --- the compare rows (UpdateEquipmentStatDisplay_007258dc) ---
const cur: StatBlock = { ...fileStats };
const rows = compareStatRows(cur, recalculateCandidate(fileStats, SWORD_G2, null, pmt), true);
eq(rows.map((r) => [r.key, r.label, r.current, r.item, r.color]), [
  ['atp', 0x9c, 40, 64, VALUE_COLOR.higher],
  ['dfp', 0x9d, 20, 0, VALUE_COLOR.lower],
  ['mst', 0x9e, 5, 0, VALUE_COLOR.lower],
  ['ata', 0x9f, 50, 0, VALUE_COLOR.lower],
  ['evp', 0xa0, 10, 0, VALUE_COLOR.lower],
  ['lck', 0xa1, 3, 0, VALUE_COLOR.lower],
], 'compare rows: six labels in order, candidate colours');
eq(compareStatRows(cur, recalculateCandidate(fileStats, SWORD_G2, null, pmt), false).map((r) => r.color), Array(6).fill(VALUE_COLOR.none), 'not equippable: grey');
eq(compareColor(0, 0), VALUE_COLOR.same, 'zero against zero is white');

// The Item Pack's panel keeps the item-only rows (equipStatRows): the sword's ATP is 40 + 14 (min + 2 x grind) there.
eq(equipStatRows(cur, SWORD_G2, null, pmt, false, true)[0].item, 54, 'Item Pack panel: unchanged item-only model');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
if (failures) process.exitCode = 1;
