// The live combat's weapon range with the set factor (client/src/combat/formulas.ts weaponForCombat with
// the local player's SetContext). Exe: ApplyEquipmentBonuses_005d330c (dump 426168, weapon branch) writes
// ROUND((atp_min + 2 x grind) x set factor + morning) and the max likewise to the battleparams range
// (+0x31c); EntityHitEntity_00773350 (dump 747464) rolls with attacker->battleparams_attacks->atp_range_min.
//
// Run: node tests/combatsetatp.test.ts
import { applyItem, defaultSetContext, wornEquipment, type CandidateBlocks } from '../client/src/combat/playerstats.ts';
import { playerAttacker, weaponForCombat } from '../client/src/combat/formulas.ts';
import type { ItemData } from '../client/src/formats/itemnames.ts';

let failures = 0;
let checks = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

const item = (d: number[]): ItemData => ({ data1: new Uint8Array(d), id: 0, data2: new Uint8Array(4) });
const pmt = { getWeapon: () => ({ atpMin: 40, atpMax: 50, ata: 30, mst: 0, statBoostEntryIndex: 0 }), statBoosts: [] };
const blank = (): CandidateBlocks => ({ atp: 0, mst: 0, evp: 0, dfp: 0, ata: 0, lck: 0, rmin: 0, rmax: 0, ataMin: 0, resEvp: 0, resDfp: 0 });

// Weapon sub 1 idx 5 (the set with shield 0x26 + armour 0x28: factor 1.5), grind 10.
const saber = [0, 1, 5, 10, 0, 0, 0, 0, 0, 0, 0, 0];
const setShield = item([1, 2, 0x26, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const setArmour = item([1, 1, 0x28, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const setCtx = defaultSetContext(wornEquipment([setShield, setArmour]));
const noSetCtx = defaultSetContext(wornEquipment([]));

// Without a set: min (40 + 20) = 60, max (50 + 20) = 70.
eq(weaponForCombat(new Uint8Array(saber), pmt)!.range, undefined, 'no SetContext: no set range');
eq(weaponForCombat(new Uint8Array(saber), pmt, noSetCtx)!.range, { min: 60, max: 70 }, 'no matching set: factor 1, range 60..70');

// With the set: min 60 x 1.5 = 90, max 70 x 1.5 = 105.
const live = weaponForCombat(new Uint8Array(saber), pmt, setCtx)!;
eq(live.range, { min: 90, max: 105 }, 'matching set: range x 1.5');

// The attacker: ATP base 500 (saved), class HUmar 5..10. Range = [5 + 90, 10 + 105] = [95, 115].
const a = playerAttacker(0, { atp: 500, ata: 150, lck: 30 }, live);
eq([a.atp, a.atpSpread, a.equipAtp], [500, 20, 95], 'live attacker: base 500, spread 20, equipment ATP 95');
const plain = playerAttacker(0, { atp: 500, ata: 150, lck: 30 }, weaponForCombat(new Uint8Array(saber), pmt));
eq([plain.atpSpread, plain.equipAtp], [15, 65], 'no SetContext: spread 15, equipment ATP 65 (unchanged)');

// The compare list's blocks (applyItem with the same context) carry the same weapon range.
const b = blank();
applyItem(b, item(saber), pmt as never, 1, setCtx);
eq([b.rmin, b.rmax], [live.range!.min, live.range!.max], 'applyItem range = live range (set)');
const b2 = blank();
applyItem(b2, item(saber), pmt as never, 1, noSetCtx);
eq([b2.rmin, b2.rmax], [60, 70], 'applyItem range = live range (no set)');

// Morning glory: weapon sub 0x94 gets ((beat >> 1) >>> 30 + beat) >> 2 = 100 at beat 400 (no set matches).
const morningSaber = [0, 0x94, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const beatCtx = { ...noSetCtx, beatTime: 400 };
eq(weaponForCombat(new Uint8Array(morningSaber), pmt, beatCtx)!.range, { min: 140, max: 150 }, 'morning glory: +100 at beat 400');
const bm = blank();
applyItem(bm, item(morningSaber), pmt as never, 1, beatCtx);
eq([bm.rmin, bm.rmax], [140, 150], 'applyItem morning glory = live range');

// Galatine (sub 1 idx 8) at the default beat 0 is the 0.33 step of the ladder (ASSUMED default, see defaultSetContext).
const galatine = [0, 1, 8, 10, 0, 0, 0, 0, 0, 0, 0, 0];
eq(weaponForCombat(new Uint8Array(galatine), pmt, noSetCtx)!.range, { min: 20, max: 23 }, 'galatine at beat 0: x 0.33 (ASSUMED)');

console.log(`combatsetatp: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
