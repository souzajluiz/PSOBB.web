// The admin character editor's game rules (bridge/admin-items.mjs and their use
// in bridge/admin-chars.mjs): level -> EXP threshold and stats from newserv's BB
// level table (materials kept), technique limits by class from the BB ItemPMT,
// item encoding (picker spec -> data1 / data2 -> spec), mag encoding and
// validation (levels, synchro, IQ, colour, photon blast slots), and the
// inventory / bank additions that use them.
//
// The tables are newserv's own files, read at run time (never committed): set
// NEWSERV=<path to vendor/newserv> or keep the checkout's vendor/newserv; in a
// worktree the main checkout's copy is used. Without them the test skips.
//
// Run: node tests/admin-items.test.ts
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CHAR_FILE_SIZE, applyBankPatch, applyCharacterPatch, parseCharacter } from '../bridge/admin-chars.mjs';
import {
  DEFAULT_MAG, decodeItem, decodeMag, encodeItem, encodeMagInto, itemCatalog, loadGameData, parseNewservJson, readMaterials,
  statsForLevel, techLimitsForClass, validateMag,
} from '../bridge/admin-items.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const candidates = [process.env.NEWSERV, join(ROOT, 'vendor/newserv'), '/Users/junior/Downloads/psobb-master/web/vendor/newserv'].filter(Boolean) as string[];
const vendor = candidates.find((v) => existsSync(join(v, 'system/tables/level-table-v4.json')));
if (!vendor) {
  console.log('SKIP: newserv system/tables not found (set NEWSERV)');
  process.exit(0);
}
const gd = loadGameData(join(vendor, 'system/tables'));
const lt = gd.levelTable;

let checks = 0;
let failures = 0;
function check(ok: boolean, name: string): void {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}`);
  }
}
const eq = (a: unknown, b: unknown, name: string): void => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  check(ok, ok ? name : `${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const throws = (fn: () => unknown, re: RegExp, name: string): void => {
  try {
    fn();
    check(false, `${name}: did not throw`);
  } catch (e) {
    check(re.test((e as Error).message), `${name}: ${(e as Error).message}`);
  }
};

// ---- newserv JSON ----------------------------------------------------------------------------

eq(parseNewservJson('{\n // c\n "a": 0x1D, "b": -0x1, /* x */ "c": "0x10 // no", "d": [1, 2,],\n}'), { a: 29, b: -1, c: '0x10 // no', d: [1, 2] }, 'newserv JSON: comments, hex, trailing commas');
check(Boolean(gd.levelTable && gd.pmt && gd.names), 'the three tables load');

// ---- level -> EXP and stats ------------------------------------------------------------------

// Independent expectation, written from newserv's LevelTable::advance_to_level.
function expected(cls: number, level: number) {
  const b = lt.BaseStats[cls];
  const s = { atp: b.ATP, mst: b.MST, evp: b.EVP, hp: b.HP, dfp: b.DFP, ata: b.ATA, lck: b.LCK };
  let exp = 0;
  for (let l = 1; l < level; l++) {
    const d = lt.LevelDeltas[cls][l];
    s.atp += d.ATP; s.mst += d.MST; s.evp += d.EVP; s.hp += d.HP; s.dfp += d.DFP; s.ata += d.ATA;
    exp = d.EXP;
  }
  return { exp, stats: s };
}
const humar1 = statsForLevel(gd, 0, 1);
eq([humar1.exp, humar1.stats], [0, { atp: 35, mst: 29, evp: 45, hp: 20, dfp: 17, ata: 30, lck: 10 }], 'HUmar level 1 = base stats, 0 EXP');
eq(statsForLevel(gd, 0, 2).exp, 50, 'HUmar level 2 needs 50 EXP');
eq(statsForLevel(gd, 0, 2).stats.atp, 35 + lt.LevelDeltas[0][1].ATP, 'level 2 adds the level-1 delta');
for (const [cls, level] of [[0, 10], [2, 77], [6, 200], [11, 150], [9, 1], [4, 200]]) {
  const got = statsForLevel(gd, cls, level);
  eq({ exp: got.exp, stats: got.stats }, expected(cls, level), `class ${cls} level ${level}`);
}
eq(statsForLevel(gd, 0, 200).exp, lt.LevelDeltas[0][199].EXP, 'level 200 EXP = the last threshold');
eq(statsForLevel(gd, 0, 200).stats.lck, 10, 'LCK deltas are ignored, as newserv / the game do');
const mats = { power: 10, mind: 3, evade: 4, def: 5, luck: 6, hp: 7, tp: 8 };
const withMats = statsForLevel(gd, 0, 50, mats);
const noMats = statsForLevel(gd, 0, 50);
eq([withMats.stats.atp - noMats.stats.atp, withMats.stats.mst - noMats.stats.mst, withMats.stats.evp - noMats.stats.evp, withMats.stats.dfp - noMats.stats.dfp, withMats.stats.lck - noMats.stats.lck, withMats.stats.hp - noMats.stats.hp],
  [20, 6, 8, 10, 12, 0], 'materials add 2 each to ATP/MST/EVP/DFP/LCK, none to HP (recompute_stats)');
throws(() => statsForLevel(gd, 0, 0), /1 to 200/, 'level 0 refused');
throws(() => statsForLevel(gd, 0, 201), /1 to 200/, 'level 201 refused');
throws(() => statsForLevel({ levelTable: null }, 0, 5), /not available/, 'no table -> error');

// ---- character files: level patch -----------------------------------------------------------------

const INV = 8;
const DISP = 8 + 0x34c;
function makeChar(cls: number): Buffer {
  const b = Buffer.alloc(CHAR_FILE_SIZE);
  b.writeUInt16LE(CHAR_FILE_SIZE, 0);
  b.writeUInt16LE(0x00e7, 2);
  b[INV] = 3;
  const item = (slot: number, d1: string, d2 = '00000000') => {
    const o = INV + 4 + slot * 0x1c;
    b[o] = 1;
    Buffer.from(d1, 'hex').copy(b, o + 8);
    b.writeUInt32LE(0x10000 + slot, o + 20);
    Buffer.from(d2, 'hex').copy(b, o + 24);
  };
  item(0, '000100000000000000000000');
  item(1, '030000000005000000000000'); // Monomate x5
  item(2, '020005000000000000000000');
  // Mag (02 00 = Mag): DEF 5.00, synchro 40, colour 14 (newserv defaults)
  const mo = INV + 4 + 2 * 0x1c + 8;
  Buffer.from('020005000000000000000000', 'hex').copy(b, mo);
  b.writeUInt16LE(500, mo + 4);
  Buffer.from([40, 0, 0, 14]).copy(b, mo + 16);
  [100, 50, 60, 400, 70, 80, 10].forEach((v, i) => b.writeUInt16LE(v, DISP + i * 2));
  b.writeUInt32LE(9, DISP + 0x18);
  b.writeUInt32LE(5000, DISP + 0x1c);
  b.writeUInt32LE(1000, DISP + 0x20);
  b[DISP + 0x55] = cls;
  b.fill(0xff, DISP + 0x17c, DISP + 0x17c + 0x14);
  // materials: POWER 4 (items[8].ext2), LUCK 2 (items[12].ext2), HP 3 (hp_from_materials = 6)
  b[INV + 4 + 8 * 0x1c + 3] = 4;
  b[INV + 4 + 12 * 0x1c + 3] = 2;
  b[INV + 1] = 6;
  return b;
}

{
  const orig = makeChar(0);
  eq(readMaterials(orig, INV), { power: 4, mind: 0, evade: 0, def: 0, luck: 2, hp: 3, tp: 0 }, 'materials are read from the extension bytes');
  const { buf, changes } = applyCharacterPatch(orig, { level: 60 }, gd);
  const c = parseCharacter(buf, gd);
  const want = expected(0, 60);
  eq([c.level, c.exp], [60, want.exp], 'level 60 writes the level and its EXP threshold');
  eq(c.stats, { ...want.stats, atp: want.stats.atp + 8, lck: want.stats.lck + 4 }, 'level 60 recomputes the stats with the materials on top');
  check(changes.some((x: string) => x.startsWith('exp ')), 'the change list names the EXP');
  const viaClass = parseCharacter(applyCharacterPatch(orig, { charClass: 6 }, gd).buf, gd);
  eq(viaClass.stats.mst, expected(6, 10).stats.mst, 'a class change recomputes the stats for the new class at the same level');
  const override = parseCharacter(applyCharacterPatch(orig, { level: 60, stats: { hp: 999 }, exp: 1 }, gd).buf, gd);
  eq([override.stats.hp, override.exp], [999, 1], 'explicit stats / exp after the level win');
  const raw = parseCharacter(applyCharacterPatch(orig, { level: 60 }, null).buf);
  eq([raw.level, raw.exp, raw.stats.atp], [60, 5000, 100], 'without the tables only the level changes (old behaviour)');
}

// ---- techniques ---------------------------------------------------------------------------------------

{
  const hucast = techLimitsForClass(gd, 2);
  check(Object.values(hucast).every((v) => v === null), 'HUcast (android) learns no technique');
  const humar = techLimitsForClass(gd, 0);
  eq([humar.Foie, humar.Grants, humar.Megid, humar.Shifta, humar.Ryuker, humar.Reverser, humar.Anti], [15, null, null, null, 1, null, 5], 'HUmar limits');
  const fomarl = techLimitsForClass(gd, 6);
  eq([fomarl.Foie, fomarl.Megid, fomarl.Reverser, fomarl.Anti], [30, 30, 1, 7], 'FOmarl limits');
  eq(techLimitsForClass(gd, 1).Foie, 20, 'HUnewearl Foie up to 20');
  const orig = makeChar(0);
  throws(() => applyCharacterPatch(orig, { techniques: { Foie: 16 } }, gd), /limited to level 15/, 'HUmar Foie 16 refused');
  throws(() => applyCharacterPatch(orig, { techniques: { Grants: 1 } }, gd), /cannot learn Grants/, 'HUmar Grants refused');
  throws(() => applyCharacterPatch(makeChar(4), { techniques: { Resta: 1 } }, gd), /RAcast cannot learn Resta/, 'RAcast technique refused');
  const ok = parseCharacter(applyCharacterPatch(orig, { techniques: { Foie: 15, Resta: 10, Anti: null } }, gd).buf, gd);
  eq([ok.techniques.Foie, ok.techniques.Resta, ok.techniques.Anti], [15, 10, null], 'allowed levels are written');
  const fo = parseCharacter(applyCharacterPatch(makeChar(6), { techniques: { Megid: 30 } }, gd).buf, gd);
  eq(fo.techniques.Megid, 30, 'FOmarl Megid 30');
  // class change in the same patch: the new class's limits apply
  throws(() => applyCharacterPatch(makeChar(6), { charClass: 2, techniques: { Foie: 1 } }, gd), /HUcast cannot learn/, 'limits follow the new class');
}

// ---- item encoding --------------------------------------------------------------------------------------

const hex = (r: { d1: Buffer; d2: Buffer }) => `${r.d1.toString('hex')}/${r.d2.toString('hex')}`;
{
  // Saber +5 Charge, Native 20%, Hit 15% -> 00ZZZZGG SSNNAABB AABBAABB (ItemData.hh)
  const w = encodeItem(gd, { kind: 'weapon', code: '000100', grind: 5, special: 12, attributes: [{ type: 1, amount: 20 }, { type: 5, amount: 15 }] });
  eq(hex(w), '000100050c000114050f0000/00000000', 'weapon bytes');
  eq(decodeItem(w.d1, w.d2), { kind: 'weapon', code: '000100', grind: 5, special: 12, attributes: [{ type: 1, amount: 20 }, { type: 5, amount: 15 }, null] }, 'weapon round trip');
  const neg = encodeItem(gd, { kind: 'weapon', code: '000100', attributes: [{ type: 3, amount: -10 }] });
  eq(decodeItem(neg.d1, neg.d2).attributes[0], { type: 3, amount: -10 }, 'negative attribute round trip');
  throws(() => encodeItem(gd, { kind: 'weapon', code: '000100', grind: 36 }), /grind \(max 35\)/, 'grind above ItemPMT MaxGrind refused');
  throws(() => encodeItem(gd, { kind: 'weapon', code: '000100', attributes: [{ type: 1, amount: 5 }, { type: 1, amount: 5 }] }), /twice/, 'duplicate attribute refused');
  throws(() => encodeItem(gd, { kind: 'weapon', code: '000100', attributes: [{ type: 2, amount: 101 }] }), /-100 to 100/, 'attribute over 100 refused');
  throws(() => encodeItem(gd, { kind: 'weapon', code: '0099FF' }), /unknown item/, 'unknown code refused');
  throws(() => encodeItem(gd, { kind: 'weapon', code: '010100' }), /not a weapon/, 'kind / code mismatch refused');

  // Frame: 4 slots, DFP +2, EVP +1 -> 0101ZZ00 FFTTDDDD EEEE0000
  const a = encodeItem(gd, { kind: 'armor', code: '010100', slots: 4, dfp: 2, evp: 1 });
  eq(hex(a), '010100000004020001000000/00000000', 'armor bytes');
  eq(decodeItem(a.d1, a.d2), { kind: 'armor', code: '010100', slots: 4, dfp: 2, evp: 1 }, 'armor round trip');
  throws(() => encodeItem(gd, { kind: 'armor', code: '010100', dfp: 3 }), /DFP bonus \(max 2\)/, 'DFP above DFPRange refused');
  throws(() => encodeItem(gd, { kind: 'armor', code: '010100', slots: 5 }), /slots/, '5 slots refused');
  const s = encodeItem(gd, { kind: 'shield', code: '010200', dfp: 5, evp: 5 });
  eq(decodeItem(s.d1, s.d2), { kind: 'shield', code: '010200', dfp: 5, evp: 5 }, 'shield round trip');
  throws(() => encodeItem(gd, { kind: 'shield', code: '010200', slots: 1 }), /no slots/, 'shield slots refused');

  // Unit: modifier = step x ItemPMT ModifierAmount (ItemCreator)
  const step = gd.pmt.Items['010300'].ModifierAmount;
  const u = encodeItem(gd, { kind: 'unit', code: '010300', modifier: -2 });
  eq(decodeItem(u.d1, u.d2), { kind: 'unit', code: '010300', modifierRaw: -2 * step }, 'unit modifier is step x ModifierAmount');

  // Tools, tech disks, meseta
  const t = encodeItem(gd, { kind: 'tool', code: '030000', count: 7 });
  eq(hex(t), '030000000007000000000000/00000000', 'Monomate x7 bytes');
  throws(() => encodeItem(gd, { kind: 'tool', code: '030000', count: 11 }), /max 10/, 'stack over 10 refused');
  const pd = encodeItem(gd, { kind: 'tool', code: '031000', count: 99 });
  eq(decodeItem(pd.d1, pd.d2), { kind: 'tool', code: '031000', count: 99 }, 'Photon Drop stacks to 99');
  const td = encodeItem(gd, { kind: 'techdisk', tech: 'Resta', level: 11 });
  eq(hex(td), '03020a000f00000000000000/00000000', 'tech disk bytes (0302LL00 TT...)');
  eq(decodeItem(td.d1, td.d2), { kind: 'techdisk', tech: 'Resta', level: 11 }, 'tech disk round trip');
  const ms = encodeItem(gd, { kind: 'meseta', amount: 12345 });
  eq(hex(ms), '040000000000000000000000/39300000', 'meseta bytes (data2 = amount)');
  throws(() => encodeItem(gd, { kind: 'meseta', amount: 1_000_000 }), /999999/, 'meseta cap');

  const cat = itemCatalog(gd);
  check(cat.items.length > 1000, `catalog has the item list (${cat.items.length})`);
  check(cat.items.some((i: { code: string; name: string; maxGrind?: number }) => i.code === '000100' && i.name === 'Saber' && i.maxGrind === 35), 'catalog: Saber with its max grind');
  check(!cat.items.some((i: { code: string }) => i.code === '030200'), 'catalog: tech disks are not a plain tool');
}

// ---- mags ---------------------------------------------------------------------------------------------------

{
  const d1 = Buffer.from('020000000000000000000000', 'hex');
  const d2 = Buffer.from([0, 0, 0x40, 0]); // wrapped flag must survive
  const mag = {
    type: 0x13, def: { level: 5, progress: 40 }, pow: { level: 100, progress: 0 }, dex: { level: 45, progress: 98 }, mind: { level: 50, progress: 2 },
    synchro: 120, iq: 200, color: 3, photonBlasts: [2, 0, 5],
  };
  encodeMagInto(gd, d1, d2, mag);
  eq([d1[1], d1[2], d1.readUInt16LE(4), d1.readUInt16LE(6), d1.readUInt16LE(8), d1.readUInt16LE(10)], [0x13, 200, 540, 10000, 4598, 5002], 'mag type, level and raw stats');
  // C = 2 (Golla), R = 0 (Farlla), L = Mylla & Youlla: index 3 among the unused [1, 3, 4, 5] -> LLRRRCCC = 11 000 010
  eq([d1[3], d2[0], d2[1], d2[2], d2[3]], [0xc2, 120, 200, 0x47, 3], 'photon blasts, synchro, IQ, flags (wrapped kept), colour');
  const back = decodeMag(d1, d2);
  eq(back, { type: 0x13, level: 200, def: mag.def, pow: mag.pow, dex: mag.dex, mind: mag.mind, synchro: 120, iq: 200, color: 3, photonBlasts: [2, 0, 5] }, 'mag round trip');
  // left PB below both others: no index shift
  const e1 = Buffer.alloc(12);
  e1[0] = 2;
  const e2 = Buffer.alloc(4);
  encodeMagInto(gd, e1, e2, { ...DEFAULT_MAG, photonBlasts: [4, 5, 1] });
  eq(decodeMag(e1, e2).photonBlasts, [4, 5, 1], 'left PB 1 with C=4 R=5');
  for (const pbs of [[0, 1, 2], [5, 4, 3], [1, 3, 0], [3, 1, 5]]) {
    const f1 = Buffer.alloc(12);
    f1[0] = 2;
    const f2 = Buffer.alloc(4);
    encodeMagInto(gd, f1, f2, { ...DEFAULT_MAG, photonBlasts: pbs });
    eq(decodeMag(f1, f2).photonBlasts, pbs, `photon blasts ${pbs.join(',')} round trip`);
  }
  eq(decodeMag(d1, d2).dex.progress, 98, 'even progress kept');
  const o1 = Buffer.alloc(12);
  o1[0] = 2;
  encodeMagInto(gd, o1, Buffer.alloc(4), { ...DEFAULT_MAG, pow: { level: 1, progress: 51 } });
  eq(o1.readUInt16LE(6), 150, 'odd progress drops to even (newserv masks 0x7FFE)');

  throws(() => validateMag({ ...DEFAULT_MAG, def: { level: 101, progress: 0 }, pow: { level: 100, progress: 0 } }), /201/, 'level sum 201 refused');
  throws(() => validateMag({ ...DEFAULT_MAG, pow: { level: 201, progress: 0 } }), /0 to 200/, 'stat level 201 refused');
  throws(() => validateMag({ ...DEFAULT_MAG, pow: { level: 1, progress: 100 } }), /0 to 99/, 'progress 100 refused');
  throws(() => validateMag({ ...DEFAULT_MAG, synchro: 121 }), /synchro/, 'synchro 121 refused');
  throws(() => validateMag({ ...DEFAULT_MAG, iq: 201 }), /IQ/, 'IQ 201 refused');
  throws(() => validateMag({ ...DEFAULT_MAG, color: 19 }), /colour/, 'colour 19 refused');
  throws(() => validateMag({ ...DEFAULT_MAG, photonBlasts: [null, 1, null] }), /center one first/, 'right PB without center refused');
  throws(() => validateMag({ ...DEFAULT_MAG, photonBlasts: [1, null, 2] }), /right one first/, 'left PB without right refused');
  throws(() => validateMag({ ...DEFAULT_MAG, photonBlasts: [1, 1, null] }), /one slot only/, 'duplicate PB refused');
  throws(() => validateMag({ ...DEFAULT_MAG, photonBlasts: [6, null, null] }), /0 to 5/, 'PB 6 refused');
  throws(() => encodeMagInto(gd, Buffer.from('020000000000000000000000', 'hex'), Buffer.alloc(4), { ...DEFAULT_MAG, type: 0xfe }), /unknown mag type/, 'unknown mag type refused');

  const newMag = encodeItem(gd, { kind: 'mag', code: '020000' });
  eq(decodeMag(newMag.d1, newMag.d2), { type: 0, level: 5, def: { level: 5, progress: 0 }, pow: { level: 0, progress: 0 }, dex: { level: 0, progress: 0 }, mind: { level: 0, progress: 0 }, synchro: 40, iq: 0, color: 14, photonBlasts: [null, null, null] }, 'a new mag has newserv\'s defaults');
}

// ---- inventory / bank with the picker ------------------------------------------------------------------------

{
  const orig = makeChar(0);
  const { buf } = applyCharacterPatch(orig, {
    inventory: { add: [
      { spec: { kind: 'tool', code: '030000', count: 3 } }, // joins the Monomate x5 stack
      { spec: { kind: 'meseta', amount: 500 } }, // goes to the character's meseta
      { spec: { kind: 'weapon', code: '000100', grind: 3 } },
      { data1: '030100000100000000000000' }, // raw still works
    ] },
  }, gd);
  const c = parseCharacter(buf, gd);
  eq(c.inventory.length, 5, 'stack merge and meseta take no slot');
  eq(c.inventory[1].data1.slice(10, 12), '08', 'Monomate stack 5 + 3 = 8');
  eq(c.meseta, 1500, 'meseta added to the character');
  eq([c.inventory[3].name, c.inventory[3].data1], ['Saber', '000100030000000000000000'], 'picker weapon added with its name');
  throws(() => applyCharacterPatch(orig, { inventory: { add: [{ spec: { kind: 'tool', code: '030000', count: 6 } }] } }, gd), /would hold 11/, 'stack overflow refused');
  throws(() => applyCharacterPatch(orig, { inventory: { add: [{ spec: { kind: 'weapon', code: '000100', grind: 99 } }] } }, gd), /inventory add: grind/, 'picker errors come back as a 400 message');

  const m = applyCharacterPatch(orig, { mags: [{ slot: 2, type: 0x13, def: { level: 10, progress: 0 }, pow: { level: 20, progress: 4 }, dex: { level: 0, progress: 0 }, mind: { level: 0, progress: 0 }, synchro: 80, iq: 50, color: 1, photonBlasts: [1, null, null] }] }, gd);
  const mc = parseCharacter(m.buf, gd);
  eq([mc.inventory[2].mag.level, mc.inventory[2].mag.pow, mc.inventory[2].mag.photonBlasts, mc.inventory[2].name], [30, { level: 20, progress: 4 }, [1, null, null], 'Nandin'], 'mag edit written and read back');
  eq(mc.inventory[2].id, 0x10002, 'mag edit keeps the item id');
  throws(() => applyCharacterPatch(orig, { mags: [{ slot: 0, ...DEFAULT_MAG }] }, gd), /not a mag/, 'mag edit on a weapon refused');
  throws(() => applyCharacterPatch(orig, { mags: [{ slot: 2, ...DEFAULT_MAG, synchro: 200 }] }, gd), /mag in slot 2: mag synchro/, 'mag validation in the patch');

  const bank = applyBankPatch({ meseta: 10, items: [] }, { add: [{ spec: { kind: 'meseta', amount: 90 } }, { spec: { kind: 'tool', code: '030000', count: 4 } }] }, gd).bank;
  eq([bank.meseta, bank.items.length, bank.items[0].amount, bank.items[0].data1], [100, 1, 4, '030000000004000000000000'], 'bank: picker meseta and tool stack');
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
