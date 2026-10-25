// The local player's elemental resists (client/src/combat/playerresist.ts): where the exe keeps
// them (player +0x2f6..+0x2fe, the resist block's shorts [1..5]), the class base (zero), the
// armour / shield pmt bytes (signed, EFR 0x15, EIC 0x17, ETH 0x16, ELT 0x19, EDK 0x18), the unit
// stats 9..14, the colored ring case 7, the clamp of Player_ApplyStatModifications, and the
// chances the Ill Gill special reads (freeze EIC, shock ETH, insta-kill EDK).
// Run: node tests/playerresist.test.ts
// Env: ITEMPMT (optional ItemPMT.prs; the real-table checks skip without it; default
// ~/Downloads/psobb-master/tethealla/ItemPMT.prs). Sega data is never committed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ItemPMT, parseItemPMT } from '../client/src/formats/itempmt.ts';
import { itemFromHex } from '../client/src/formats/itemnames.ts';
import { defaultSetContext, type WornEquipment } from '../client/src/combat/playerstats.ts';
import {
  addClamped,
  classBaseElements,
  itemElementDeltas,
  playerElements,
  statusChanceFromResist,
} from '../client/src/combat/playerresist.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// The synthetic PMT: armour 0 (EFR 3, EIC 5, ETH 4, ELT 7, EDK 6), armour 1 with negative bytes
// (EFR 0xff = -1, EIC 0x80 = -128), shield 0 (ETH 9), units 2 (stat 9 = EFR, amount 10), 3 (stat
// 14 = all five, amount 2), 4 (stat 11 = ETH, amount 0xfffe = -2 as a short).
const pmt = new ItemPMT();
pmt.armors[0] = { id: 20, dfp: 12, evp: 7, efr: 3, eic: 5, eth: 4, elt: 7, edk: 6 } as never;
pmt.armors[1] = { id: 21, dfp: 30, evp: 5, efr: 0xff, eic: 0x80, eth: 0, elt: 0, edk: 0 } as never;
pmt.shields[0] = { id: 30, dfp: 4, evp: 9, efr: 0, eic: 0, eth: 9, elt: 0, edk: 0 } as never;
pmt.units[2] = { id: 50, stat: 9, amount: 10, modifierAmount: 0 } as never;
pmt.units[3] = { id: 51, stat: 14, amount: 2, modifierAmount: 0 } as never;
pmt.units[4] = { id: 52, stat: 11, amount: 0xfffe, modifierAmount: 0 } as never;
pmt.units[5] = { id: 53, stat: 0, amount: 5, modifierAmount: 0 } as never;

const ARMOR0 = itemFromHex('010100000000000000000000');
const ARMOR1 = itemFromHex('010101000000000000000000');
const SHIELD0 = itemFromHex('010200000000000000000000');
const UNIT2 = itemFromHex('010302000000000000000000');
const UNIT3 = itemFromHex('010303000000000000000000');
const UNIT2_MOD5 = itemFromHex('010302000000050000000000'); // the modifier bytes 6..7 = +5
const RING_SHIELD = itemFromHex('01025a' + '0'.repeat(18)); // shield group_idx 0x5a (d[2]): (0x5a - 0x53) & 7 = 7
const worn = (w: Partial<WornEquipment>): WornEquipment => ({ weapon: null, armour: null, shield: null, units: [], mag: null, ...w });
const res = (w: WornEquipment, barrier = 0) => playerElements(w, pmt, { ...defaultSetContext(w), barrier });
const ZERO = { efr: 0, eic: 0, eth: 0, elt: 0, edk: 0 };

// The class base: every class is zero (DAT_009688e0, all 0x180 bytes zero in PsoBB.exe).
for (let c = 0; c < 12; c++) eq(classBaseElements(c), ZERO, `class base ${c}: zero`);

// The clamp (Player_ApplyStatModifications): a negative sum stops at 0, a rise stops at 0x7fff.
eq(addClamped(3, -5), 0, 'clamp: 3 - 5 stops at 0');
eq(addClamped(10, -4), 6, 'clamp: 10 - 4 = 6');
eq(addClamped(0x7ff0, 0x100), 0x7fff, 'clamp: a rise stops at 0x7fff');
eq(addClamped(7, 0), 7, 'clamp: a zero delta changes nothing');

// Armour: the pmt bytes land on the exe's slots (resist [1] EFR, [2] EIC, [3] ETH, [4] ELT, [5] EDK).
eq(itemElementDeltas(ARMOR0, pmt, 0), [3, 5, 4, 7, 6], 'armour 0: EFR 3, EIC 5, ETH 4, ELT 7, EDK 6');
eq(res(worn({ armour: ARMOR0 })), { efr: 3, eic: 5, eth: 4, elt: 7, edk: 6 }, 'worn armour 0: the live block is its bytes');
// Signed chars: 0xff is -1, 0x80 is -128; the clamp then keeps the live value at 0.
eq(itemElementDeltas(ARMOR1, pmt, 0), [-1, -128, 0, 0, 0], 'armour 1: the bytes read as signed chars');
eq(res(worn({ armour: ARMOR1 })), ZERO, 'worn armour 1: negative resists clamp to 0');
// The shield (ApplyWeaponStatsVariant): the same byte slots, ETH 9 here.
eq(res(worn({ shield: SHIELD0 })), { ...ZERO, eth: 9 }, 'worn shield 0: ETH 9');

// Units: stat 9 is EFR (+2), stat 14 all five, the item's modifier (bytes 6..7) is added.
eq(res(worn({ units: [UNIT2] })), { ...ZERO, efr: 10 }, 'unit stat 9: EFR 10');
eq(res(worn({ units: [UNIT2_MOD5] })), { ...ZERO, efr: 15 }, 'unit stat 9 with modifier +5: EFR 15');
eq(res(worn({ units: [UNIT3] })), { efr: 2, eic: 2, eth: 2, elt: 2, edk: 2 }, 'unit stat 14: all five +2');
eq(res(worn({ units: [itemFromHex('010305000000000000000000')] })), ZERO, 'unit stat 0 (ATP) adds no elemental');
// Unit 4 is stat 11 (ETH) with amount -2: the negative step clamps the live block at 0.
eq(res(worn({ units: [itemFromHex('010304000000000000000000')] })), ZERO, 'unit stat 11 amount -2: clamps to 0');

// Stacking: armour and units add in slot order; each step clamps.
eq(res(worn({ armour: ARMOR0, units: [UNIT2, UNIT3] })), { efr: 3 + 10 + 2, eic: 5 + 2, eth: 4 + 2, elt: 7 + 2, edk: 6 + 2 }, 'armour + two units: sums');

// The colored ring (a shield with group_idx 0x5a, case 7): barrier * 10 on all five.
eq(itemElementDeltas(RING_SHIELD, pmt, 3), [30, 30, 30, 30, 30], 'colored ring case 7 with 3 rings: +30 each');
eq(res(worn({ shield: RING_SHIELD }), 2), { efr: 20, eic: 20, eth: 20, elt: 20, edk: 20 }, 'worn ring shield, 2 rings: +20 each');
eq(res(worn({ shield: RING_SHIELD }), 0), ZERO, 'worn ring shield, no ring around: nothing');

// The chances the special reads: max(0, resist / -100 + 0.75).
eq(statusChanceFromResist(0), 0.75, 'freeze / shock chance with no resist: 0.75');
eq(statusChanceFromResist(25), 0.5, 'resist 25: chance 0.5');
eq(statusChanceFromResist(100), 0, 'resist 100: chance floored at 0');
eq(statusChanceFromResist(200), 0, 'resist 200: still 0');

// The set bonuses that write the resist block (handle_item_set_bonus; setBonusElementDeltas): the shield
// 0x2a with a worn armour 0x45 (+2, +2, +2, +5, +5), the shield 0x9b with a worn armour 0x56 (+20 each),
// the shield 0x93 (+50 on one element by beat time: 0 EFR, 1 EIC, 2 ETH, 3 EDK), the weapon 0xc5 (+15 each,
// no condition) and the weapon 0xac with a worn mag 0x44 (ELT +10, EDK +10).
const W = (hex: string) => itemFromHex((hex + '0'.repeat(24)).slice(0, 24));
const MAG44 = W('024400');
eq(res(worn({ weapon: W('00c5') })), { efr: 15, eic: 15, eth: 15, elt: 15, edk: 15 }, 'weapon 0xc5: +15 on all five');
eq(res(worn({ weapon: W('00ac') })), ZERO, 'weapon 0xac without the mag 0x44: nothing');
eq(res(worn({ weapon: W('00ac'), mag: MAG44 })), { ...ZERO, elt: 10, edk: 10 }, 'weapon 0xac with mag 0x44: ELT and EDK +10');
eq(res(worn({ shield: W('01022a'), armour: W('010145') })), { efr: 2, eic: 2, eth: 2, elt: 5, edk: 5 }, 'shield 0x2a with armour 0x45: +2 +2 +2 +5 +5');
eq(res(worn({ shield: W('01022a') })), ZERO, 'shield 0x2a without armour 0x45: nothing');
eq(res(worn({ shield: W('01029b'), armour: W('010156') })), { efr: 20, eic: 20, eth: 20, elt: 20, edk: 20 }, 'shield 0x9b with armour 0x56: +20 each');
eq(res(worn({ shield: W('01029b') })), ZERO, 'shield 0x9b without armour 0x56: nothing');
const beatShield = W('010293');
for (const [beat, want] of [[0, { ...ZERO, efr: 50 }], [2, { ...ZERO, eic: 50 }], [4, { ...ZERO, eth: 50 }], [6, { ...ZERO, edk: 50 }], [8, { ...ZERO, efr: 50 }]] as const) {
  const ctx = { ...defaultSetContext(worn({ shield: beatShield })), beatTime: beat };
  eq(playerElements(worn({ shield: beatShield }), pmt, ctx), want, `shield 0x93 at beat ${beat}: one element +50`);
}
// The armour's set bonus writes DFP only: an armour with its own group index adds no elemental here.
eq(res(worn({ armour: W('010145') })), ZERO, 'armour 0x45 alone (its set bonus is DFP): no elemental');

// The real table (when present): every armour and shield's bytes land on the same slots, and a unit
// with stat 9..14 gives its slot. Checked against the raw bytes of the parsed entries.
const real = process.env.ITEMPMT ?? join(process.env.HOME ?? '', 'Downloads/psobb-master/tethealla/ItemPMT.prs');
if (existsSync(real)) {
  const rp = parseItemPMT(new Uint8Array(readFileSync(real)));
  const s8 = (v: number) => (v << 24) >> 24;
  let armours = 0;
  let nonzero = 0;
  for (let i = 0; i < rp.armors.length; i++) {
    const a = rp.armors[i];
    if (!a) continue;
    armours++;
    const want = [s8(a.efr), s8(a.eic), s8(a.eth), s8(a.elt), s8(a.edk)];
    if (want.some((v) => v !== 0)) nonzero++;
    eq(itemElementDeltas(itemFromHex(`0101${i.toString(16).padStart(2, '0')}000000000000000000`), rp, 0), want, `real armour ${i}: slot bytes`);
  }
  for (let i = 0; i < rp.units.length; i++) {
    const u = rp.units[i];
    if (!u || u.stat < 9 || u.stat > 14) continue;
    const d = itemFromHex(`0103${i.toString(16).padStart(2, '0')}000000000000000000`);
    const v = (u.amount << 16) >> 16;
    const want = u.stat === 14 ? [v, v, v, v, v] : [0, 1, 2, 3, 4].map((k) => (k === u.stat - 9 ? v : 0));
    eq(itemElementDeltas(d, rp, 0), want, `real unit ${i} (stat ${u.stat}): slot`);
  }
  console.log(`real ItemPMT: ${armours} armour rows, ${nonzero} with an elemental byte`);
} else {
  console.log('real ItemPMT: skipped (no file)');
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
if (failures) process.exitCode = 1;
