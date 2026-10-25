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
  applyColoredRing,
  applyItem,
  blocksFromFile,
  defaultSetContext,
  displayedStats,
  equipmentRange,
  equippedCandidate,
  itemSetBonusDelta,
  magStatContribution,
  morningGloryAtpBonus,
  recalculateCandidate,
  setFactorAtp,
  setFactorDfp,
  setFactorEvp,
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

// --- set bonuses, colored rings and the item set bonus (2026-10-25; Ghidra addresses in the module) ---
const F = (x: number) => Math.fround(x);
const it = (hex: string) => itemFromHex(hex.padEnd(24, '0'));
const W_G1_I5 = it('000105');  // weapon group 1 idx 5 (a sabre-like weapon, the 1.5 set)
const W_G1_I8 = it('000108');  // galatine (beat-time ladder)
const W_G2_I0 = it('000300');  // weapon sub 3 idx 0 (no set)
const S_26 = it('010226');     // shield 0x26
const A_28 = it('010128');     // armour 0x28
const A_45 = it('010145');     // sweetheart armour
const A_18 = it('010118');     // hunter/ranger/force armour
const S_92 = it('010292');     // honeycomb reflector
const S_2A = it('01022a');     // shield 0x2a
const S_55 = it('010255');     // colored ring (0x55: k = 2)
const S_57 = it('010257');     // k = 4 (ATA range)
const S_58 = it('010258');     // k = 5 (ATP range)
const S_5B = it('01025b');     // k = 0 (nothing)
const S_85 = it('010285');     // handle_barrier: weapon sub switch
const S_87 = it('010287');
const S_95 = it('010295');    // shield 0x95: team count ATP (2026-10-25)
const A_56 = it('010156');     // frame: weapon sub 0x10 idx < 7
const WPN_10_2 = it('001002'); // weapon sub 0x10 idx 2
const WPN_65 = it('006500');
const WPN_7_8 = it('000708');
const WPN_BF = it('00bf00');
const WPN_B4 = it('00b400');
const WPN_6_8 = it('000608');
const WPN_14_1 = it('001401');
const WPN_SWORD_SAINT = it('000309'); // the proof table's first triple
const UNIT_H = it('010348');
const UNIT_P = it('010350');
const MAG_H = it('024800');
const A_40 = it('010140');     // an armour with no DFP set

// The factor functions read the worn slots: a worn shield / armour / weapon of the given items.
const ctxOf = (worn: WornEquipment, over: Partial<ReturnType<typeof defaultSetContext>> = {}) => ({
  ...defaultSetContext(worn),
  ...over,
});
const wornOf = (over: Partial<WornEquipment>): WornEquipment => ({ weapon: null, armour: null, shield: null, units: [], mag: null, ...over });

// get_equipment_set_atp_bonus_weapon: the set conditions on the worn shield / armour.
eq(setFactorAtp(W_G1_I5, ctxOf(wornOf({ shield: S_26, armour: A_28 }))), F(1.5), 'ATP set: weapon 1/5 with shield 0x26 and armour 0x28 is 1.5');
eq(setFactorAtp(W_G1_I5, ctxOf(wornOf({ shield: S_26 }))), F(1.0), 'ATP set: without the armour the factor is 1.0');
eq(setFactorAtp(W_G2_I0, ctxOf(wornOf({ shield: S_26, armour: A_28 }))), F(1.0), 'ATP set: a weapon with no set row is 1.0');
// The galatine ladder (beat time): 0.33 up to 124, 0.5, 1.0, 2.0, 3.0, 2.0, 1.0 (749..875), 0.5 after.
const galatine = (beat: number) => setFactorAtp(W_G1_I8, ctxOf(wornOf({}), { beatTime: beat }));
eq([0, 124, 125, 249, 300, 400, 500, 700, 800, 875, 900].map(galatine), [0.33, 0.33, 0.5, 0.5, 1, 2, 3, 2, 1, 0.5, 0.5].map(F), 'galatine ladder by beat time');
// Morning glory: only sub 0x94 gets floor(beat / 4); other subs get 0.0.
eq(morningGloryAtpBonus(it('009400'), 400), 100, 'morning glory: beat 400 gives 100');
eq(morningGloryAtpBonus(W_G2_I0, 400), 0, 'morning glory: other subs give 0');
// The armour set factor (DFP): the sweetheart's teammates, the party loop, the honeycomb reflector.
const dfpOf = (item: ReturnType<typeof it>, over: Partial<ReturnType<typeof defaultSetContext>>, worn = wornOf({})) => setFactorDfp(item, ctxOf(worn, over));
eq([1, 2, 3, 0].map((n) => dfpOf(A_45, { nearby: n })), [0.85, 0.8, 0.75, 1.0].map(F), 'DFP set: sweetheart 0x45 by teammates 1..3 (0 is 1.0)');
eq(dfpOf(A_45, { nearby: 2 }, wornOf({ shield: S_2A })), F(1.1), 'DFP set: shield 0x2a (1.1) replaces the sweetheart factor (assignment in the exe)');
eq(dfpOf(A_18, { party: [0x19] }), F(1.2), 'DFP set: a hunter/ranger/force armour with a 0x19 in the party is 1.2');
eq(dfpOf(A_18, { party: [0x1b] }), F(1.0), 'DFP set: no matching party armour is 1.0');
eq(dfpOf(it('010126'), {}, wornOf({ weapon: it('000205'), shield: it('010224') })), F(1.5), 'DFP set: armour 0x26 with weapon 2/5 and shield 0x24 is 1.5');
eq(dfpOf(A_40, { movement: 0 }, wornOf({ shield: S_92 })), F(0.5), 'DFP set: honeycomb reflector (shield 0x92) not standing and still is 0.5');
eq(dfpOf(A_40, { movement: 4 }, wornOf({ shield: S_92 })), F(1.0), 'DFP set: honeycomb reflector moving is 1.0');
eq(dfpOf(A_40, { movement: 2 }, wornOf({ shield: S_92 })), F(1.0), 'DFP set: honeycomb reflector standing leaves the factor alone');
// The shield's EVP factor: the weapon / armour pairs and the 0x92 movement rule.
const evpOf = (item: ReturnType<typeof it>, over: Partial<ReturnType<typeof defaultSetContext>>, worn = wornOf({})) => setFactorEvp(item, ctxOf(worn, over));
eq(evpOf(it('01021a'), {}, wornOf({ weapon: it('001a00') })), F(2.0), 'EVP set: shield 0x1a with a weapon of sub 0x1a is 2.0');
eq(evpOf(S_26, {}, wornOf({ weapon: it('000105'), armour: A_28 })), F(1.5), 'EVP set: shield 0x26 with weapon 1/5 and armour 0x28 is 1.5');
eq([evpOf(S_92, { movement: 2 }), evpOf(S_92, { movement: 0 }), evpOf(S_92, { movement: 4 })], [1.5, 0.5, 1.0].map(F), 'EVP set: shield 0x92 standing 1.5, still 0.5, moving 1.0');
// applyItem scales the weapon's range by the set factor and the morning bonus (ROUND, dump 426168).
const block = () => ({ atp: 0, mst: 0, evp: 0, dfp: 0, ata: 0, lck: 0, rmin: 0, rmax: 0, ataMin: 0, resEvp: 0, resDfp: 0 });
pmt.weapons[1] = [];
pmt.weapons[1][5] = { id: 50, usabilityFlags: 0xff, atpRequired: 0, mstRequired: 0, ataRequired: 0, atpMin: 10, atpMax: 20, mst: 0, ata: 0, statBoostEntryIndex: 0 } as never;
pmt.armors[0x28] = { id: 40, usabilityFlags: 0xff, requiredLevel: 0, dfp: 0, evp: 0, statBoostEntryIndex: 0 } as never;
pmt.shields[0x26] = { id: 41, usabilityFlags: 0xff, requiredLevel: 0, dfp: 0, evp: 0, statBoostEntryIndex: 0 } as never;
const setWorn = wornOf({ armour: A_28, shield: S_26 });
const setBlock = block();
applyItem(setBlock, W_G1_I5, pmt, 1, defaultSetContext(setWorn));
eq([setBlock.rmin, setBlock.rmax], [15, 30], 'applyItem: the set 1.5 scales the weapon range (ROUND(10 x 1.5), ROUND(20 x 1.5))');
const plainBlock = block();
applyItem(plainBlock, W_G1_I5, pmt, 1);
eq([plainBlock.rmin, plainBlock.rmax], [10, 20], 'applyItem with no context: the range is the PMT range');
// The compare: the weapon 1/5 scaled by the worn set (range max 20 x 1.5 = 30) against the unscaled 20.
const setStats: CompareStats = { atp: 100, dfp: 30, mst: 52, ata: 200, evp: 40, lck: 3 };
eq(recalculateCandidate(setStats, W_G1_I5, setWorn, 0, pmt).atp, 100 + 10 + 30, 'compare: ATP = base + class range max 10 + the scaled range max 30');
eq(recalculateCandidate(setStats, W_G1_I5, wornOf({ armour: A_28 }), 0, pmt).atp, 100 + 10 + 20, 'compare: without the shield the range max stays 20');

// Colored rings (colored_ring_matching_boosts): a shield 0x53..0x82 with barrier count n.
const ringBlock = (item: ReturnType<typeof it>, barrier: number) => {
  const t = block();
  applyColoredRing(item, barrier, t);
  return t;
};
eq([ringBlock(S_55, 2).resEvp], [50], 'colored ring: idx 0x55 (k = 2): EVP += 25 x 2');
eq([ringBlock(S_57, 2).ataMin], [200], 'colored ring: idx 0x57 (k = 4): ATA range += 100 x 2');
eq([ringBlock(S_58, 2).rmin, ringBlock(S_58, 2).rmax], [100, 100], 'colored ring: idx 0x58 (k = 5): ATP range += 50 x 2 on both ends');
eq(ringBlock(S_5B, 3), block(), 'colored ring: idx 0x5b (k = 0) adds nothing');
eq(ringBlock(it('010155'), 3), block(), 'colored ring: an armour in the same index range adds nothing');
eq(ringBlock(S_55, 0), block(), 'colored ring: no teammate (the default) adds nothing');

// handle_item_set_bonus: each handler keyed by the candidate's sub / index, the worn items as the condition.
const sets = (item: ReturnType<typeof it>, worn: WornEquipment, over: Partial<ReturnType<typeof defaultSetContext>> = {}) => {
  const t = itemSetBonusDelta(item, ctxOf(worn, over));
  return t;
};
eq(sets(WPN_B4, wornOf({ units: [UNIT_H] })).ataMin, 300, 'item set: weapon sub 0xb4 with a unit H worn: ATA range +300');
eq(sets(WPN_B4, wornOf({})).ataMin, 0, 'item set: weapon sub 0xb4 without the unit: nothing');
eq(sets(WPN_6_8, wornOf({ mag: MAG_H })).lck, 100, 'item set: weapon sub 6 idx 8 with the mag H: LCK +100');
eq(sets(S_87, wornOf({ weapon: WPN_BF })).atp, 50, 'item set: shield 0x87 with a weapon sub 0xbf: ATP +50 (stat [0], objdump 0x005d5128)');
eq(sets(S_87, wornOf({ weapon: WPN_BF })).resEvp, 0, 'item set: shield 0x87 writes no EVP resist');
// The team count term (GetChallengeDataById 0x00797790 -> the record's byte +0x11, capped at 100, doubled):
// armour 0x55 adds it to the DFP resist, shield 0x95 to the ATP stat (objdump 0x005d5492, 0x005d4f47).
const TEAM_7 = { masterGuildCard: 0x1234, teamId: 0, unknownA5: 0, unknownA6: 0, memberCount: 7 };
const TEAM_NONE = { masterGuildCard: 0, teamId: 0, unknownA5: 0, unknownA6: 0, memberCount: 9 };
eq(sets(it('010155'), wornOf({}), { team: TEAM_7 }).resDfp, 14, 'team: armour 0x55 with a team of 7 members adds DFP 14 (2 x 7)');
eq(sets(it('010155'), wornOf({}), { team: null }).resDfp, 0, 'team: armour 0x55 with no record adds nothing');
eq(sets(it('010155'), wornOf({}), { team: TEAM_NONE }).resDfp, 0, 'team: armour 0x55 with the four membership dwords zero adds nothing (count 9 ignored)');
eq(sets(it('010155'), wornOf({}), { team: { ...TEAM_7, memberCount: 200 } }).resDfp, 200, 'team: the member count is capped at 100 before doubling');
eq(sets(it('010155'), wornOf({}), { team: { ...TEAM_7, teamId: 5 } }).resDfp, 14, 'team: a team id alone counts as a record');
eq(sets(S_95, wornOf({}), { team: TEAM_7 }).atp, 14, 'team: shield 0x95 with a team of 7 members adds ATP 14 (stat [0])');
eq(sets(S_95, wornOf({}), { team: null }).atp, 0, 'team: shield 0x95 with no record adds nothing');
eq(sets(S_95, wornOf({}), { team: TEAM_7 }).resDfp, 0, 'team: shield 0x95 writes no DFP resist');
eq(sets(S_85, wornOf({ weapon: WPN_65 })).ataMin, 300, 'item set: shield 0x85 with a weapon sub 0x65: ATA range +300');
eq([sets(S_85, wornOf({ weapon: WPN_7_8 })).ataMin, sets(S_85, wornOf({ weapon: WPN_7_8 })).resDfp], [-200, -10], 'item set: shield 0x85 with weapon 7/8: ATA -200 and DFP -10');
eq(sets(S_2A, wornOf({ weapon: WPN_14_1 })).ataMin, 300, 'item set: shield 0x2a with weapon 0x14/1: ATA range +300');
eq(sets(A_56, wornOf({ weapon: WPN_10_2 })).ataMin, 200, 'item set: armour 0x56 with weapon 0x10 (idx < 7): ATA range +200');
eq(sets(A_56, wornOf({ weapon: WPN_65 })).ataMin, 0, 'item set: armour 0x56 with another weapon: nothing');
eq(sets(UNIT_P, wornOf({ weapon: WPN_SWORD_SAINT })), { ...block(), ataMin: 300, resEvp: 60, resDfp: -20 }, 'item set: unit P with a proof weapon: ATA +300, EVP +60, DFP -20');
eq(sets(UNIT_P, wornOf({ weapon: WPN_65 })), block(), 'item set: unit P with a weapon outside the table: nothing');
eq(wornEquipment([MAG_H]).mag === MAG_H, true, 'wornEquipment: the mag slot is kept');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
if (failures) process.exitCode = 1;
