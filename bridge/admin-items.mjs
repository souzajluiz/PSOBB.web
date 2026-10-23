// Game data and item codecs for the admin character editor (docs/ADMIN.md).
//
// Nothing here is Sega data committed to the repository: the tables are read at
// run time from newserv's own system/tables folder (the same files newserv loads,
// shipped with newserv, never copied into this repository):
//   level-table-v4.json            BB PlyLevelTbl (base stats, per-level deltas and EXP)
//   item-parameter-table-bb-v4.json BB ItemPMT (max grind, armour DFP / EVP ranges,
//                                   unit modifier step, MaxTechLevels by class)
//   names-v4.json                  item names by 3-byte code (newserv's reference list)
// Without the folder the editor falls back to raw values (no stat recompute, no
// class technique check, no item picker); see gameDataStatus().
//
// The rules mirror newserv's source (vendor/newserv/src):
//   LevelTable::reset_to_base / advance_to_level and
//   PSOBBCharacterFile::recompute_stats  (level -> EXP threshold, stats, materials)
//   Items.cc (tech disk use: get_max_tech_level, 0xFF = class cannot learn)
//   ItemData.hh "QUICK ITEM FORMAT REFERENCE", ItemData::assign_mag_stats,
//   mag_photon_blast_for_slot / add_mag_photon_blast (mag layout and photon blasts),
//   ItemCreator::generate_common_unit_variances (unit modifier = step x ModifierAmount)
//   ItemData::StackLimits::DEFAULT_TOOL_LIMITS_V3_V4 (tool stack sizes)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export class ItemError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const CLASS_NAMES = ['HUmar', 'HUnewearl', 'HUcast', 'RAmar', 'RAcast', 'RAcaseal', 'FOmarl', 'FOnewm', 'FOnewearl', 'HUcaseal', 'FOmar', 'RAmarl'];
export const TECH_NAMES = [
  'Foie', 'Gifoie', 'Rafoie', 'Barta', 'Gibarta', 'Rabarta', 'Zonde', 'Gizonde', 'Razonde', 'Grants',
  'Deband', 'Jellen', 'Zalure', 'Shifta', 'Ryuker', 'Resta', 'Anti', 'Reverser', 'Megid',
];

// newserv src/ItemNameIndex.cc name_for_weapon_special (index = special id 1..0x28).
export const WEAPON_SPECIALS = [
  null, 'Draw', 'Drain', 'Fill', 'Gush', 'Heart', 'Mind', 'Soul', 'Geist', "Master's", "Lord's", "King's",
  'Charge', 'Spirit', 'Berserk', 'Ice', 'Frost', 'Freeze', 'Blizzard', 'Bind', 'Hold', 'Seize', 'Arrest',
  'Heat', 'Fire', 'Flame', 'Burning', 'Shock', 'Thunder', 'Storm', 'Tempest', 'Dim', 'Shadow', 'Dark', 'Hell',
  'Panic', 'Riot', 'Havoc', 'Chaos', "Devil's", "Demon's",
];
// Weapon attribute types 1..5 (ItemNameIndex.cc: the five bonus slots, Hit last).
export const WEAPON_ATTRIBUTES = [null, 'Native', 'A.Beast', 'Machine', 'Dark', 'Hit'];
// StaticGameData.cc name_for_mag_color (0x12 = costume colour).
export const MAG_COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'black', 'white', 'cyan', 'brown', 'orange', 'light-blue', 'olive',
  'turquoise', 'fuchsia', 'grey', 'cream', 'pink', 'dark-green', 'costume'];
// ItemData.cc mag_photon_blast_for_slot.
export const PHOTON_BLASTS = ['Farlla', 'Estlla', 'Golla', 'Pilla', 'Leilla', 'Mylla & Youlla'];
// ItemData.cc DEFAULT_TOOL_LIMITS_V3_V4, indexed by data1[1]; anything past the end stacks to 1.
const TOOL_LIMITS = [10, 10, 1, 10, 10, 10, 10, 10, 10, 1, 1, 1, 1, 1, 1, 1, 99, 1];
export const MAX_MESETA = 999_999;

// ---- newserv JSON (comments, hex numbers) ------------------------------------------------

// newserv's JSON files allow // and /* */ comments, hex integers (0x1D, -0x1)
// and trailing commas. Converts them to plain JSON outside of strings.
export function parseNewservJson(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if ((c === '0' || c === '-') && /^-?0[xX][0-9a-fA-F]/.test(text.slice(i, i + 4))) {
      const m = /^(-?)0[xX]([0-9a-fA-F]+)/.exec(text.slice(i, i + 24));
      out += (m[1] ? '-' : '') + String(parseInt(m[2], 16));
      i += m[0].length;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// ---- loading ------------------------------------------------------------------------------

function readTable(dir, name) {
  const file = join(dir, name);
  if (!existsSync(file)) return null;
  return parseNewservJson(readFileSync(file, 'utf8'));
}

// Loads what exists of the three tables; missing ones are null.
export function loadGameData(tablesDir) {
  const gd = { tablesDir, levelTable: null, pmt: null, names: null };
  if (!tablesDir || !existsSync(tablesDir)) return gd;
  try { gd.levelTable = readTable(tablesDir, 'level-table-v4.json'); } catch { gd.levelTable = null; }
  try { gd.pmt = readTable(tablesDir, 'item-parameter-table-bb-v4.json'); } catch { gd.pmt = null; }
  try {
    const raw = readTable(tablesDir, 'names-v4.json');
    gd.names = raw ? new Map(Object.entries(raw).map(([k, v]) => [k.toUpperCase(), v])) : null;
  } catch { gd.names = null; }
  return gd;
}

export function gameDataStatus(gd) {
  return { levelTable: Boolean(gd?.levelTable), itemTable: Boolean(gd?.pmt), itemNames: Boolean(gd?.names) };
}

// ---- level -> EXP and stats ---------------------------------------------------------------------

export const STAT_KEYS = ['atp', 'mst', 'evp', 'hp', 'dfp', 'ata', 'lck'];

// Material counts as newserv keeps them (PlayerInventory.hh): POWER, MIND, EVADE,
// DEF, LUCK in items[8..12].extension_data2; HP / TP in hp_ / tp_from_materials >> 1.
export function readMaterials(buf, inv = 8) {
  const ext2 = (i) => buf[inv + 4 + i * 0x1c + 3];
  return { power: ext2(8), mind: ext2(9), evade: ext2(10), def: ext2(11), luck: ext2(12), hp: buf[inv + 1] >> 1, tp: buf[inv + 2] >> 1 };
}

// PSOBBCharacterFile::recompute_stats(reset_exp = true): base stats of the class,
// plus the deltas of every level up to `level` (LCK deltas are ignored, as the
// game does), EXP = the threshold of `level`, then 2 per POWER / MIND / EVADE /
// DEF / LUCK material. HP materials are not in these stats (newserv: "HP in this
// structure is unaffected by material usage"; the client adds them).
export function statsForLevel(gd, charClass, level, materials = null) {
  const lt = gd?.levelTable;
  if (!lt) throw new ItemError('the level table (level-table-v4.json) is not available', 503);
  if (!Number.isInteger(level) || level < 1 || level > 200) throw new ItemError('level must be an integer from 1 to 200');
  const base = lt.BaseStats?.[charClass];
  const deltas = lt.LevelDeltas?.[charClass];
  if (!base || !deltas) throw new ItemError(`no level table for class ${charClass}`);
  const s = { atp: base.ATP, mst: base.MST, evp: base.EVP, hp: base.HP, dfp: base.DFP, ata: base.ATA, lck: base.LCK };
  for (let l = 0; l < level - 1; l++) {
    const d = deltas[l + 1];
    s.atp += d.ATP; s.mst += d.MST; s.evp += d.EVP; s.hp += d.HP; s.dfp += d.DFP; s.ata += d.ATA;
  }
  const exp = deltas[level - 1].EXP;
  if (materials) {
    s.atp += materials.power * 2;
    s.mst += materials.mind * 2;
    s.evp += materials.evade * 2;
    s.dfp += materials.def * 2;
    s.lck += materials.luck * 2;
  }
  for (const k of STAT_KEYS) s[k] = Math.max(0, Math.min(0xffff, s[k]));
  return { level, exp, stats: s };
}

// ---- techniques --------------------------------------------------------------------------------

// Highest technique level (1-based) a class can learn, or null when it cannot
// (ItemPMT MaxTechLevels: 0-based, 0xFF = cannot). null result for the whole
// table when it is not loaded.
export function techLimitsForClass(gd, charClass) {
  const table = gd?.pmt?.MaxTechLevels;
  const cls = CLASS_NAMES[charClass];
  if (!table || !cls) return null;
  const out = {};
  for (const t of TECH_NAMES) {
    const v = table[t]?.[cls];
    out[t] = v === undefined || v === 0xff ? null : v + 1;
  }
  return out;
}

export function checkTechLevel(gd, charClass, tech, level) {
  if (level === null) return;
  const limits = techLimitsForClass(gd, charClass);
  if (!limits) return;
  const max = limits[tech];
  if (max === null) throw new ItemError(`${CLASS_NAMES[charClass]} cannot learn ${tech}`);
  if (level > max) throw new ItemError(`${tech} is limited to level ${max} for ${CLASS_NAMES[charClass]}`);
}

// ---- catalog -------------------------------------------------------------------------------------

function kindOfCode(code) {
  const b0 = parseInt(code.slice(0, 2), 16);
  const b1 = parseInt(code.slice(2, 4), 16);
  if (b0 === 0) return 'weapon';
  if (b0 === 1) return b1 === 1 ? 'armor' : b1 === 2 ? 'shield' : b1 === 3 ? 'unit' : null;
  if (b0 === 2) return 'mag';
  if (b0 === 3) return b1 === 2 ? null : 'tool';
  return null;
}

export const isSRankWeapon = (b1) => (b1 > 0x6f && b1 < 0x89) || (b1 > 0xa4 && b1 < 0xaa);

function pmtItem(gd, code) {
  return gd?.pmt?.Items?.[code] ?? null;
}

export function toolStackLimit(b1) {
  return TOOL_LIMITS[b1] ?? 1;
}

// The item list of the picker: every named item of newserv's names-v4.json with
// what the form needs from ItemPMT.
export function itemCatalog(gd) {
  const items = [];
  for (const [code, name] of gd?.names ?? []) {
    if (!/^[0-9A-F]{6}$/.test(code)) continue;
    const kind = kindOfCode(code);
    if (!kind || name === '????' || name.startsWith('<')) continue;
    const b1 = parseInt(code.slice(2, 4), 16);
    const p = pmtItem(gd, code);
    const it = { code, name, kind };
    if (kind === 'weapon') {
      it.maxGrind = p?.MaxGrind ?? 0;
      it.sRank = isSRankWeapon(b1);
    } else if (kind === 'armor' || kind === 'shield') {
      it.dfpRange = p?.DFPRange ?? 0;
      it.evpRange = p?.EVPRange ?? 0;
    } else if (kind === 'unit') {
      it.modifierAmount = p?.ModifierAmount ?? 0;
    } else if (kind === 'tool') {
      it.maxStack = toolStackLimit(b1);
    }
    items.push(it);
  }
  return {
    available: Boolean(gd?.names),
    items,
    specials: WEAPON_SPECIALS,
    attributes: WEAPON_ATTRIBUTES,
    magColors: MAG_COLORS,
    photonBlasts: PHOTON_BLASTS,
    techniques: TECH_NAMES,
  };
}

export function itemName(gd, d1) {
  const names = gd?.names;
  if (!names) return null;
  const hx = (b) => b.toString(16).padStart(2, '0').toUpperCase();
  if (d1[0] === 4) return 'Meseta';
  if (d1[0] === 3 && d1[1] === 2) return `Disk:${TECH_NAMES[d1[4]] ?? '?'} Lv.${d1[2] + 1}`;
  const code = d1[0] === 2 ? `02${hx(d1[1])}00` : d1[0] === 0 && isSRankWeapon(d1[1]) ? `00${hx(d1[1])}00` : `${hx(d1[0])}${hx(d1[1])}${hx(d1[2])}`;
  return names.get(code) ?? null;
}

// ---- item encoding ----------------------------------------------------------------------------------

function int(v, lo, hi, what) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new ItemError(`${what} must be an integer from ${lo} to ${hi}`);
  return v;
}

function knownCode(gd, code, kind) {
  if (typeof code !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(code)) throw new ItemError('item code must be 6 hex digits');
  const c = code.toUpperCase();
  if (kindOfCode(c) !== kind) throw new ItemError(`item ${c} is not a ${kind}`);
  if (gd?.names && !gd.names.has(c)) throw new ItemError(`unknown item ${c}`);
  return c;
}

// Encodes an item description from the picker into data1 (12 bytes) + data2 (4),
// following ItemData.hh's quick format reference. Returns { d1, d2, amount }
// where amount is the meseta / stack count the caller may need.
export function encodeItem(gd, spec) {
  if (!spec || typeof spec !== 'object') throw new ItemError('item spec object expected');
  const d1 = Buffer.alloc(12);
  const d2 = Buffer.alloc(4);
  const codeBytes = (c) => Buffer.from(c, 'hex').copy(d1, 0);
  switch (spec.kind) {
    case 'weapon': {
      const code = knownCode(gd, spec.code, 'weapon');
      codeBytes(code);
      const sRank = isSRankWeapon(d1[1]);
      const p = pmtItem(gd, code);
      const maxGrind = p ? p.MaxGrind : 255;
      d1[3] = int(spec.grind ?? 0, 0, maxGrind, `grind (max ${maxGrind})`);
      const special = int(spec.special ?? 0, 0, WEAPON_SPECIALS.length - 1, 'special');
      if (sRank && special) throw new ItemError('S-rank weapons have no normal special');
      d1[4] = special;
      const attrs = spec.attributes ?? [];
      if (!Array.isArray(attrs) || attrs.length > 3) throw new ItemError('attributes: up to 3 entries');
      if (sRank && attrs.some((a) => a && a.type)) throw new ItemError('S-rank weapons have no attributes (the bytes hold the name)');
      const seen = new Set();
      attrs.forEach((a, i) => {
        if (!a || !a.type) return;
        const type = int(a.type, 1, 5, 'attribute type');
        if (seen.has(type)) throw new ItemError(`attribute ${WEAPON_ATTRIBUTES[type]} is given twice`);
        seen.add(type);
        d1[6 + i * 2] = type;
        d1[7 + i * 2] = int(a.amount ?? 0, -100, 100, 'attribute percent') & 0xff;
      });
      return { d1, d2, amount: 1 };
    }
    case 'armor':
    case 'shield': {
      const code = knownCode(gd, spec.code, spec.kind);
      codeBytes(code);
      const p = pmtItem(gd, code);
      if (spec.kind === 'armor') d1[5] = int(spec.slots ?? 0, 0, 4, 'slots');
      else if (spec.slots) throw new ItemError('shields have no slots');
      d1.writeInt16LE(int(spec.dfp ?? 0, 0, p ? p.DFPRange : 255, `DFP bonus (max ${p ? p.DFPRange : 255})`), 6);
      d1.writeInt16LE(int(spec.evp ?? 0, 0, p ? p.EVPRange : 255, `EVP bonus (max ${p ? p.EVPRange : 255})`), 8);
      return { d1, d2, amount: 1 };
    }
    case 'unit': {
      const code = knownCode(gd, spec.code, 'unit');
      codeBytes(code);
      const step = int(spec.modifier ?? 0, -2, 2, 'unit modifier (-2..+2)');
      const amt = pmtItem(gd, code)?.ModifierAmount ?? 0;
      if (step && !amt) throw new ItemError('this unit has no +/- versions');
      d1.writeInt16LE(step * amt, 6);
      return { d1, d2, amount: 1 };
    }
    case 'mag': {
      const code = knownCode(gd, spec.code, 'mag');
      codeBytes(code);
      d1[2] = 0;
      encodeMagInto(gd, d1, d2, { ...DEFAULT_MAG, ...(spec.mag ?? {}), type: d1[1] });
      return { d1, d2, amount: 1 };
    }
    case 'tool': {
      const code = knownCode(gd, spec.code, 'tool');
      codeBytes(code);
      const max = toolStackLimit(d1[1]);
      const count = int(spec.count ?? 1, 1, max, `stack count (max ${max})`);
      d1[5] = max > 1 ? count : 0;
      return { d1, d2, amount: count };
    }
    case 'techdisk': {
      const tech = TECH_NAMES.indexOf(spec.tech);
      if (tech < 0) throw new ItemError('unknown technique');
      d1[0] = 3;
      d1[1] = 2;
      d1[2] = int(spec.level ?? 1, 1, 30, 'disk level') - 1;
      d1[4] = tech;
      return { d1, d2, amount: 1 };
    }
    case 'meseta': {
      d1[0] = 4;
      const amount = int(spec.amount, 1, MAX_MESETA, 'meseta');
      d2.writeUInt32LE(amount, 0);
      return { d1, d2, amount };
    }
    default:
      throw new ItemError('item kind must be weapon, armor, shield, unit, mag, tool, techdisk or meseta');
  }
}

// Reads data1 / data2 back into the picker's spec (for tests and the UI).
export function decodeItem(d1, d2) {
  const hx = (b) => b.toString(16).padStart(2, '0').toUpperCase();
  const code = `${hx(d1[0])}${hx(d1[1])}${hx(d1[2])}`;
  switch (d1[0]) {
    case 0: {
      const attributes = [0, 1, 2].map((i) => (d1[6 + i * 2] && d1[6 + i * 2] <= 5 ? { type: d1[6 + i * 2], amount: (d1[7 + i * 2] << 24) >> 24 } : null));
      return { kind: 'weapon', code, grind: d1[3], special: d1[4] & 0x3f, attributes };
    }
    case 1:
      if (d1[1] === 3) return { kind: 'unit', code, modifierRaw: d1.readInt16LE(6) };
      return { kind: d1[1] === 1 ? 'armor' : 'shield', code, ...(d1[1] === 1 ? { slots: d1[5] } : {}), dfp: d1.readInt16LE(6), evp: d1.readInt16LE(8) };
    case 2:
      return { kind: 'mag', code: `02${hx(d1[1])}00`, mag: decodeMag(d1, d2) };
    case 3:
      if (d1[1] === 2) return { kind: 'techdisk', tech: TECH_NAMES[d1[4]] ?? null, level: d1[2] + 1 };
      return { kind: 'tool', code, count: toolStackLimit(d1[1]) > 1 ? d1[5] : 1 };
    case 4:
      return { kind: 'meseta', amount: d2.readUInt32LE(0) };
    default:
      return { kind: 'unknown' };
  }
}

// ---- mags ------------------------------------------------------------------------------------------

// ItemMagStats defaults (ItemData.hh): DEF 5.00, synchro 40, colour 14 (grey).
export const DEFAULT_MAG = {
  def: { level: 5, progress: 0 }, pow: { level: 0, progress: 0 }, dex: { level: 0, progress: 0 }, mind: { level: 0, progress: 0 },
  synchro: 40, iq: 0, color: 14, photonBlasts: [null, null, null],
};
const MAG_STATS = ['def', 'pow', 'dex', 'mind'];

export function decodeMag(d1, d2) {
  const st = (w) => {
    const raw = d1.readUInt16LE(4 + w * 2);
    return { level: Math.floor(raw / 100), progress: raw % 100 };
  };
  const flags = d2[2];
  const pbNums = d1[3];
  const center = flags & 1 ? pbNums & 7 : null;
  const right = flags & 2 ? (pbNums >> 3) & 7 : null;
  let left = null;
  if (flags & 4) {
    const used = (1 << (pbNums & 7)) | (1 << ((pbNums >> 3) & 7));
    let n = (pbNums >> 6) & 3;
    for (let z = 0; z < 6; z++) {
      if (used & (1 << z)) continue;
      if (!n) { left = z; break; }
      n--;
    }
  }
  return {
    type: d1[1], level: d1[2],
    def: st(0), pow: st(1), dex: st(2), mind: st(3),
    synchro: d2[0], iq: d2[1], color: d2[3], photonBlasts: [center, right, left],
  };
}

export function validateMag(m) {
  if (!m || typeof m !== 'object') throw new ItemError('mag object expected');
  let sum = 0;
  for (const k of MAG_STATS) {
    const s = m[k];
    if (!s || typeof s !== 'object') throw new ItemError(`mag ${k.toUpperCase()} expected`);
    int(s.level, 0, 200, `mag ${k.toUpperCase()} level`);
    int(s.progress, 0, 99, `mag ${k.toUpperCase()} progress`);
    sum += s.level;
  }
  if (sum > 200) throw new ItemError(`mag level (DEF + POW + DEX + MIND = ${sum}) must be 200 or less`);
  int(m.synchro, 0, 120, 'mag synchro');
  int(m.iq, 0, 200, 'mag IQ');
  int(m.color, 0, MAG_COLORS.length - 1, 'mag colour');
  const pbs = m.photonBlasts ?? [null, null, null];
  if (!Array.isArray(pbs) || pbs.length !== 3) throw new ItemError('photonBlasts must be [center, right, left]');
  const [c, r, l] = pbs.map((p) => (p === null || p === undefined ? null : int(p, 0, 5, 'photon blast')));
  if (r !== null && c === null) throw new ItemError('the right photon blast needs the center one first');
  if (l !== null && r === null) throw new ItemError('the left photon blast needs the right one first');
  const set = [c, r, l].filter((x) => x !== null);
  if (new Set(set).size !== set.length) throw new ItemError('a photon blast can be in one slot only');
  return { sum, pbs: [c, r, l] };
}

// ItemData::assign_mag_stats + add_mag_photon_blast. data1[1] (mag type) is
// written from m.type; bits other than the three photon blast slots of the flags
// byte (data2[2], e.g. 0x40 wrapped) are kept.
export function encodeMagInto(gd, d1, d2, m) {
  const { sum, pbs } = validateMag(m);
  if (m.type !== undefined) {
    const t = int(m.type, 0, 0xff, 'mag type');
    if (gd?.names && !gd.names.has(`02${t.toString(16).padStart(2, '0').toUpperCase()}00`)) throw new ItemError('unknown mag type');
    d1[1] = t;
  }
  d1[2] = sum;
  MAG_STATS.forEach((k, i) => d1.writeUInt16LE((m[k].level * 100 + m[k].progress) & 0x7ffe, 4 + i * 2));
  const [c, r, l] = pbs;
  let pbNums = 0;
  let flags = d2[2] & ~7;
  if (c !== null) { pbNums |= c; flags |= 1; }
  if (r !== null) { pbNums |= r << 3; flags |= 2; }
  if (l !== null) {
    let n = l;
    if (c < l) n--;
    if (r < l) n--;
    pbNums |= n << 6;
    flags |= 4;
  }
  d1[3] = pbNums;
  d2[0] = m.synchro;
  d2[1] = m.iq;
  d2[2] = flags;
  d2[3] = m.color;
}
