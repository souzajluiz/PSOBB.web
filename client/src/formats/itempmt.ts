// ItemPMT.prs: the BB item parameter table (V4 layout).
//
// Port of newserv src/ItemParameterTable.cc (BinaryItemParameterTableT with the
// V4 parameters: WeaponV4, ArmorOrShieldV4, UnitV4, ToolV4, MagV4, RootV3V4T,
// ItemStarsFirstID 0xB1, SpecialStarsBeginIndex 0x256), MIT license.
//
// The file is a PRS-compressed REL file. The root (pointed to by the REL footer)
// is a table of 0x17 u32 offsets. Several tables are bare arrays whose length is
// not stored anywhere: like newserv, the length is the distance to the next
// offset that appears in the relocation table (or the root / footer).
//
// On BB the file is not in data.gsl: the server sends it in the stream file
// (01EB/02EB, see BBSession.streamFiles), together with PlyLevelTbl.prs,
// ItemMagEdit.prs and the BattleParamEntry*.dat files. A loose ItemPMT.prs is
// accepted too.

import { prsDecompress } from './prs.ts';

export interface ItemBase {
  id: number; // index of the item's name in unitxt collection 1 (BB)
  type: number;
  skin: number;
  teamPoints: number;
}

export interface Weapon extends ItemBase {
  usabilityFlags: number;
  atpMin: number;
  atpMax: number;
  atpRequired: number;
  mstRequired: number;
  ataRequired: number;
  mst: number;
  maxGrind: number;
  photon: number;
  special: number;
  ata: number;
  statBoostEntryIndex: number;
  // Byte +0x1f: the weapon's attach index (ConstructWeaponArbiter 0x005d1b50 copies it to
  // item +0x1f2; get_weapon_position 0x005e83c8 reads the owner's body node, combat/weaponorigin.ts).
  projectile: number;
  trail1X: number;
  trail1Y: number;
  trail2X: number;
  trail2Y: number;
  color: number;
  unknownA1: [number, number, number];
  unknownA4: number;
  unknownA5: number;
  techBoostEntryIndex: number;
  behaviorFlags: number;
}

export interface ArmorOrShield extends ItemBase {
  dfp: number;
  evp: number;
  blockParticle: number;
  blockEffect: number;
  usabilityFlags: number;
  requiredLevel: number;
  efr: number;
  eth: number;
  eic: number;
  edk: number;
  elt: number;
  dfpRange: number;
  evpRange: number;
  statBoostEntryIndex: number;
  techBoostEntryIndex: number;
  flagsType: number;
  unknownA4: number;
}

export interface Unit extends ItemBase {
  stat: number;
  amount: number;
  modifierAmount: number;
}

export interface Mag extends ItemBase {
  feedTable: number;
  photonBlast: number;
  activation: number;
  onPBFull: number;
  onLowHP: number;
  onDeath: number;
  onBoss: number;
  onPBFullFlag: number;
  onLowHPFlag: number;
  onDeathFlag: number;
  onBossFlag: number;
  usabilityFlags: number;
}

export interface Tool extends ItemBase {
  amount: number;
  tech: number;
  cost: number;
  itemFlags: number;
}

export interface Special {
  type: number;
  amount: number;
}

export interface StatBoost {
  stat1: number;
  stat2: number;
  amount1: number;
  amount2: number;
}

export interface TechBoost {
  entries: Array<{ techNum: number; flags: number; amount: number }>;
}

export interface MagFeedResult {
  def: number;
  pow: number;
  dex: number;
  mind: number;
  iq: number;
  synchro: number;
}

export interface ItemCombination {
  usedItem: number; // 24-bit item code (data1[0..2])
  equippedItem: number;
  resultItem: number;
  magLevel: number;
  grind: number;
  level: number;
  charClass: number;
}

export interface NonWeaponSaleDivisors {
  armor: number;
  shield: number;
  unit: number;
  mag: number;
}

export interface WeaponRange {
  horizontal: number;
  vertical: number;
  horizontalHalfAngle: number; // BAMS (0x10000 = 360 degrees)
  verticalHalfAngle: number;
  maxTargets: number;
}

export interface RangedSpecial {
  data1_1: number;
  data1_2: number; // 0xFF = any
  rangeIndex: number; // weaponRanges[0xED + rangeIndex]
  flag: number; // newserv unknown_a1
}

// V4 constants (newserv ItemParameterTableV4 template arguments).
export const ITEM_STARS_FIRST_ID = 0xb1;
export const SPECIAL_STARS_BEGIN_INDEX = 0x256;

export class ItemPMT {
  weapons: Weapon[][] = []; // [data1[1]][data1[2]]
  armors: ArmorOrShield[] = []; // 0101xx
  shields: ArmorOrShield[] = []; // 0102xx
  units: Unit[] = []; // 0103xx
  mags: Mag[] = []; // 02xx
  tools: Tool[][] = []; // [data1[1]][data1[2]] (tech disks: [2][tech number])
  weaponKinds: number[] = [];
  weaponSaleDivisors: number[] = [];
  nonWeaponSaleDivisors: NonWeaponSaleDivisors = { armor: 0, shield: 0, unit: 0, mag: 0 };
  magFeedTables: MagFeedResult[][] = []; // [table][item 0..10]
  starValues: number[] = []; // indexed by id - ITEM_STARS_FIRST_ID
  specials: Special[] = [];
  statBoosts: StatBoost[] = [];
  maxTechLevels: number[][] = []; // [tech][char class], 0xFF = cannot learn
  combinations: ItemCombination[] = [];
  techBoosts: TechBoost[] = [];
  unsealableItems: number[] = [];
  weaponRanges: WeaponRange[] = []; // root +0x1C
  rangedSpecials: RangedSpecial[] = []; // root +0x58

  // Attack reach of a weapon, as PsoBB.exe FUN_005e4ba8 picks it (Ephinea
  // 1.25.13): a ranged-special row matching data1[1] and data1[2] (or 0xFF)
  // whose flag is 1, or 0 with a special attack (type 2), selects entry
  // 0xED + its index (0x1284 / 0x14); otherwise entry data1[1].
  weaponRange(data1_1: number, data1_2: number, attackType = 0): WeaponRange | undefined {
    for (const r of this.rangedSpecials) {
      if (r.data1_1 !== data1_1 || (r.data1_2 !== 0xff && r.data1_2 !== data1_2)) continue;
      // flag 0 also needs a weapon vfunc (+0x84) to return 1, not decoded: ASSUMED true.
      if (r.flag === 1 || (r.flag === 0 && attackType === 2)) return this.weaponRanges[0xed + r.rangeIndex];
    }
    return this.weaponRanges[data1_1];
  }

  getWeapon(data1_1: number, data1_2: number): Weapon | undefined {
    return this.weapons[data1_1]?.[data1_2];
  }

  getTool(data1_1: number, data1_2: number): Tool | undefined {
    return this.tools[data1_1]?.[data1_2];
  }

  // newserv get_item_stars
  itemStars(id: number): number {
    const i = id - ITEM_STARS_FIRST_ID;
    return i >= 0 && i < this.starValues.length ? this.starValues[i] : 0;
  }

  // newserv get_special_stars: specials 0x80 (unidentified) count as none
  specialStars(special: number): number {
    return special & 0x3f && !(special & 0x80) ? this.itemStars((special & 0x3f) + SPECIAL_STARS_BEGIN_INDEX) : 0;
  }
}

export function parseItemPMT(file: Uint8Array, compressed = true): ItemPMT {
  const d = compressed ? prsDecompress(file) : file;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u8 = (o: number) => d[o];
  const s8 = (o: number) => dv.getInt8(o);
  const u16 = (o: number) => dv.getUint16(o, true);
  const s16 = (o: number) => dv.getInt16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  const s32 = (o: number) => dv.getInt32(o, true);
  const f32 = (o: number) => dv.getFloat32(o, true);
  if (d.length < 0x20) throw new Error('ItemPMT: file too small');

  // newserv all_relocation_offsets_for_rel_file: every pointer target, plus the
  // root, the relocation table and the footer.
  const footer = d.length - 0x20;
  const relocTable = u32(footer);
  const relocCount = u32(footer + 4);
  const root = u32(d.length - 0x10);
  const starts = new Set<number>([footer, root, relocTable]);
  for (let i = 0, o = 0; i < relocCount; i++) {
    o += u16(relocTable + i * 2) * 4;
    starts.add(u32(o));
  }
  const sorted = [...starts].sort((a, b) => a - b);
  // newserv get_rel_array_count
  const arrayCount = (start: number, size: number): number => {
    const next = sorted.find((s) => s > start);
    if (next === undefined) throw new Error(`ItemPMT: no offset after 0x${start.toString(16)}`);
    return Math.floor((next - start) / size);
  };

  const r = (i: number) => u32(root + i * 4); // RootV3V4T fields
  const WEAPON_TABLE = r(0), ARMOR_TABLE = r(1), UNIT_TABLE = r(2), TOOL_TABLE = r(3), MAG_TABLE = r(4);
  const WEAPON_KIND_TABLE = r(5), WEAPON_SALE_DIVISOR_TABLE = r(8), NON_WEAPON_SALE_DIVISOR_TABLE = r(9);
  const MAG_FEED_TABLE = r(10), STAR_VALUE_TABLE = r(11), SPECIAL_TABLE = r(12), STAT_BOOST_TABLE = r(14);
  const MAX_TECH_LEVEL_TABLE = r(16), COMBINATION_TABLE = r(17), TECH_BOOST_TABLE = r(19);
  const UNSEALABLE_TABLE = r(21);

  const base = (o: number): ItemBase => ({ id: u32(o), type: u16(o + 4), skin: u16(o + 6), teamPoints: u32(o + 8) });
  // ArrayRefT {u32 count, u32 offset}
  const arrayRef = (o: number) => ({ count: u32(o), offset: u32(o + 4) });
  const readArray = <T>(ref: { count: number; offset: number }, size: number, read: (o: number) => T): T[] =>
    Array.from({ length: ref.count }, (_, i) => read(ref.offset + i * size));

  const pmt = new ItemPMT();

  const readWeapon = (o: number): Weapon => ({
    ...base(o),
    usabilityFlags: u16(o + 0x0c),
    atpMin: u16(o + 0x0e),
    atpMax: u16(o + 0x10),
    atpRequired: u16(o + 0x12),
    mstRequired: u16(o + 0x14),
    ataRequired: u16(o + 0x16),
    mst: u16(o + 0x18),
    maxGrind: u8(o + 0x1a),
    photon: u8(o + 0x1b),
    special: u8(o + 0x1c),
    ata: u8(o + 0x1d),
    statBoostEntryIndex: u8(o + 0x1e),
    projectile: u8(o + 0x1f),
    trail1X: s8(o + 0x20),
    trail1Y: s8(o + 0x21),
    trail2X: s8(o + 0x22),
    trail2Y: s8(o + 0x23),
    color: s8(o + 0x24),
    unknownA1: [u8(o + 0x25), u8(o + 0x26), u8(o + 0x27)],
    unknownA4: u8(o + 0x28),
    unknownA5: u8(o + 0x29),
    techBoostEntryIndex: u8(o + 0x2a),
    behaviorFlags: u8(o + 0x2b),
  });
  const weaponClasses = arrayCount(WEAPON_TABLE, 8);
  for (let c = 0; c < weaponClasses; c++) pmt.weapons.push(readArray(arrayRef(WEAPON_TABLE + c * 8), 0x2c, readWeapon));

  const readArmor = (o: number): ArmorOrShield => ({
    ...base(o),
    dfp: u16(o + 0x0c),
    evp: u16(o + 0x0e),
    blockParticle: u8(o + 0x10),
    blockEffect: u8(o + 0x11),
    usabilityFlags: u16(o + 0x12),
    requiredLevel: u8(o + 0x14),
    efr: u8(o + 0x15),
    eth: u8(o + 0x16),
    eic: u8(o + 0x17),
    edk: u8(o + 0x18),
    elt: u8(o + 0x19),
    dfpRange: u8(o + 0x1a),
    evpRange: u8(o + 0x1b),
    statBoostEntryIndex: u8(o + 0x1c),
    techBoostEntryIndex: u8(o + 0x1d),
    flagsType: u8(o + 0x1e),
    unknownA4: u8(o + 0x1f),
  });
  pmt.armors = readArray(arrayRef(ARMOR_TABLE), 0x20, readArmor);
  pmt.shields = readArray(arrayRef(ARMOR_TABLE + 8), 0x20, readArmor);

  pmt.units = readArray(arrayRef(UNIT_TABLE), 0x14, (o) => ({
    ...base(o),
    stat: u16(o + 0x0c),
    amount: u16(o + 0x0e),
    modifierAmount: s16(o + 0x10),
  }));

  pmt.mags = readArray(arrayRef(MAG_TABLE), 0x1c, (o) => ({
    ...base(o),
    feedTable: u16(o + 0x0c),
    photonBlast: u8(o + 0x0e),
    activation: u8(o + 0x0f),
    onPBFull: u8(o + 0x10),
    onLowHP: u8(o + 0x11),
    onDeath: u8(o + 0x12),
    onBoss: u8(o + 0x13),
    onPBFullFlag: u8(o + 0x14),
    onLowHPFlag: u8(o + 0x15),
    onDeathFlag: u8(o + 0x16),
    onBossFlag: u8(o + 0x17),
    usabilityFlags: u16(o + 0x18),
  }));

  const toolClasses = arrayCount(TOOL_TABLE, 8);
  for (let c = 0; c < toolClasses; c++) {
    pmt.tools.push(
      readArray(arrayRef(TOOL_TABLE + c * 8), 0x18, (o) => ({
        ...base(o),
        amount: u16(o + 0x0c),
        tech: u16(o + 0x0e),
        cost: s32(o + 0x10),
        itemFlags: u32(o + 0x14),
      })),
    );
  }

  for (let i = 0, n = arrayCount(WEAPON_KIND_TABLE, 1); i < n; i++) pmt.weaponKinds.push(u8(WEAPON_KIND_TABLE + i));
  for (let i = 0, n = arrayCount(WEAPON_SALE_DIVISOR_TABLE, 4); i < n; i++) {
    pmt.weaponSaleDivisors.push(f32(WEAPON_SALE_DIVISOR_TABLE + i * 4));
  }
  pmt.nonWeaponSaleDivisors = {
    armor: f32(NON_WEAPON_SALE_DIVISOR_TABLE),
    shield: f32(NON_WEAPON_SALE_DIVISOR_TABLE + 4),
    unit: f32(NON_WEAPON_SALE_DIVISOR_TABLE + 8),
    mag: f32(NON_WEAPON_SALE_DIVISOR_TABLE + 12),
  };
  for (let t = 0; t < 8; t++) {
    const table = u32(MAG_FEED_TABLE + t * 4);
    pmt.magFeedTables.push(
      Array.from({ length: 11 }, (_, i) => {
        const o = table + i * 8;
        return { def: s8(o), pow: s8(o + 1), dex: s8(o + 2), mind: s8(o + 3), iq: s8(o + 4), synchro: s8(o + 5) };
      }),
    );
  }
  for (let i = 0, n = arrayCount(STAR_VALUE_TABLE, 1); i < n; i++) pmt.starValues.push(u8(STAR_VALUE_TABLE + i));
  for (let i = 0, n = arrayCount(SPECIAL_TABLE, 4); i < n; i++) {
    pmt.specials.push({ type: u16(SPECIAL_TABLE + i * 4), amount: u16(SPECIAL_TABLE + i * 4 + 2) });
  }
  for (let i = 0, n = arrayCount(STAT_BOOST_TABLE, 6); i < n; i++) {
    const o = STAT_BOOST_TABLE + i * 6;
    pmt.statBoosts.push({ stat1: u8(o), stat2: u8(o + 1), amount1: u16(o + 2), amount2: u16(o + 4) });
  }
  for (let t = 0; t < 19; t++) {
    pmt.maxTechLevels.push(Array.from({ length: 12 }, (_, c) => u8(MAX_TECH_LEVEL_TABLE + t * 12 + c)));
  }
  const code3 = (o: number) => (u8(o) << 16) | (u8(o + 1) << 8) | u8(o + 2);
  pmt.combinations = readArray(arrayRef(COMBINATION_TABLE), 0x10, (o) => ({
    usedItem: code3(o),
    equippedItem: code3(o + 3),
    resultItem: code3(o + 6),
    magLevel: u8(o + 9),
    grind: u8(o + 10),
    level: u8(o + 11),
    charClass: u8(o + 12),
  }));
  for (let i = 0, n = arrayCount(TECH_BOOST_TABLE, 0x18); i < n; i++) {
    const o = TECH_BOOST_TABLE + i * 0x18;
    pmt.techBoosts.push({
      entries: [0, 1, 2].map((k) => ({ techNum: u8(o + k * 8), flags: u8(o + k * 8 + 1), amount: f32(o + k * 8 + 4) })),
    });
  }
  pmt.unsealableItems = readArray(arrayRef(UNSEALABLE_TABLE), 4, code3);
  // WeaponRange (0x14, newserv's field names): f32 reach, f32 second
  // distance, u32 half angle (BAMS), u32 second half angle, u32 max targets.
  // PsoBB.exe FUN_007a19c0 uses them as: max distance = reach + second,
  // +0xc0 = second, +0xb8 / +0xbc = the angles, +0x88 = max targets.
  const WEAPON_RANGE_TABLE = r(7);
  for (let i = 0, n = arrayCount(WEAPON_RANGE_TABLE, 0x14); i < n; i++) {
    const o = WEAPON_RANGE_TABLE + i * 0x14;
    pmt.weaponRanges.push({ horizontal: f32(o), vertical: f32(o + 4), horizontalHalfAngle: u32(o + 8), verticalHalfAngle: u32(o + 12), maxTargets: u32(o + 16) });
  }
  if (root + 0x5c <= d.length && r(22) !== 0xffffffff) {
    pmt.rangedSpecials = readArray(arrayRef(r(22)), 4, (o) => ({ data1_1: u8(o), data1_2: u8(o + 1), rangeIndex: u8(o + 2), flag: u8(o + 3) }));
  }
  return pmt;
}
