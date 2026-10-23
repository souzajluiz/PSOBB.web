// Material use (03 0B xx; combat/materials.ts, PlayerProgression, net/items.ts):
// the use check (class maximums, the material cap, the HP / TP bonus limit),
// the change (stat +2 clamped to the class maximum, counters, HP / TP bonus),
// the Challenge x5, the android rules (no Mind, no TP) and the 6x27 send.
// Run: node tests/materials.test.ts
import {
  CLASS_MAX_STATS,
  MATERIAL_AMOUNT,
  MATERIAL_DEFENSE,
  MATERIAL_EVADE,
  MATERIAL_HP,
  MATERIAL_LUCK,
  MATERIAL_MIND,
  MATERIAL_POWER,
  MATERIAL_TP,
  applyMaterial,
  clampStatIncrement,
  materialCap,
  materialTotal,
  materialUsable,
  type MaterialHolder,
} from '../client/src/combat/materials.ts';
import { PlayerProgression } from '../client/src/combat/progression.ts';
import { GameItems, writeCharacterInventory } from '../client/src/net/items.ts';
import { itemFromHex } from '../client/src/formats/itemnames.ts';
import type { CharacterFile, InventoryItem } from '../client/src/net/charfile.ts';

let failures = 0;
let checks = 0;
const check = (ok: boolean, what: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL: ${what}`);
  }
};

// A holder of the given class: stats at the class maximum minus `room`, zero counters.
const holder = (charClass: number, over: Partial<MaterialHolder> = {}, room = 100): MaterialHolder => {
  const max = CLASS_MAX_STATS[charClass];
  return {
    charClass,
    stats: { atp: max.atp - room, mst: max.mst - room, evp: max.evp - room, dfp: max.dfp - room, lck: max.lck - room },
    materialCounts: [0, 0, 0, 0, 0],
    hpMaterials: 0,
    tpMaterials: 0,
    ...over,
  };
};

// The class table and the caps (the exe's g_ClassMaxStats and get_max_material_count).
check(CLASS_MAX_STATS.length === 12 && CLASS_MAX_STATS[0].atp === 1387 && CLASS_MAX_STATS[8].mst === 1750, 'g_ClassMaxStats rows (HUmar atp 1387, FOnewearl mst 1750)');
check(CLASS_MAX_STATS.every((r) => r.lck === 100), 'the luck maximum is 100 for every class');
check(CLASS_MAX_STATS[2].mst === 0 && CLASS_MAX_STATS[9].mst === 0, 'the android casts have no Mind maximum');
check([0, 3, 6, 10, 11].every((c) => materialCap(c) === 250), 'cap 250 for HUmar, RAmar, FOmarl, FOmar, RAmarl');
check([1, 2, 4, 5, 7, 8, 9].every((c) => materialCap(c) === 150), 'cap 150 for HUnewearl, HUcast, RAcast, RAcaseal, FOnewm, FOnewearl, HUcaseal');

// The clamp (ClampAndApplyStatIncrement): not below 0, not above the maximum.
check(clampStatIncrement(10, 2, 100) === 12 && clampStatIncrement(99, 2, 100) === 100 && clampStatIncrement(0, -5, 100) === 0, 'stat clamp: +2, the maximum, not below 0');

// The use check: a stat below its class maximum and the total below the cap.
{
  const h = holder(0, {}, 3);
  check(materialUsable(MATERIAL_POWER, h), 'Power: below the class maximum and the cap, usable');
  h.stats.atp = CLASS_MAX_STATS[0].atp;
  check(!materialUsable(MATERIAL_POWER, h), 'Power: at the class maximum, refused');
  const full = holder(0, { materialCounts: [250, 0, 0, 0, 0] });
  check(!materialUsable(MATERIAL_POWER, full), 'Power: the total at the cap (250), refused');
  const newman = holder(1, { materialCounts: [150, 0, 0, 0, 0] });
  check(!materialUsable(MATERIAL_EVADE, newman) && materialUsable(MATERIAL_EVADE, holder(1, {}, 3)), 'a newman: the cap is 150 (refused at 150, usable below)');
  check(!materialUsable(MATERIAL_MIND, holder(2, {}, 0)), 'an android cast has mst 0: Mind refused by the stat maximum');
  check(!materialUsable(7, holder(0)) && !materialUsable(-1, holder(0)), 'kinds outside 0..6 refused');
}

// HP / TP: the bonus below 0xfa, no counter, no stat.
{
  check(materialUsable(MATERIAL_HP, holder(0, { hpMaterials: 248 })), 'HP: a bonus of 248 is still usable');
  check(!materialUsable(MATERIAL_HP, holder(0, { hpMaterials: 250 })), 'HP: a bonus of 250 refuses');
  check(!materialUsable(MATERIAL_TP, holder(0, { tpMaterials: 250 })), 'TP: a bonus of 250 refuses');
  check(materialUsable(MATERIAL_TP, holder(0, { materialCounts: [250, 0, 0, 0, 0] })), 'TP ignores the stat counters (the total is not in its check)');
}

// Apply: +2 per material, the counter +1, HP / TP bonuses without counters.
{
  const h = holder(0, {}, 50);
  const before = h.stats.atp;
  check(applyMaterial(MATERIAL_POWER, h, false) === 2 && h.stats.atp === before + 2, 'Power: +2 atp');
  check(h.materialCounts[0] === 1 && materialTotal(h) === 1, 'Power: the counter goes up by 1');
  const hp = holder(0);
  applyMaterial(MATERIAL_HP, hp, false);
  check(hp.hpMaterials === 2 && materialTotal(hp) === 0, 'HP: the bonus +2, no counter');
  const tp = holder(0);
  applyMaterial(MATERIAL_TP, tp, false);
  check(tp.tpMaterials === 2 && materialTotal(tp) === 0, 'TP: the bonus +2 for a human, no counter');
  const luck = holder(0, {}, 50);
  applyMaterial(MATERIAL_LUCK, luck, false);
  check(luck.materialCounts[4] === 1 && luck.stats.lck === CLASS_MAX_STATS[0].lck - 48, 'Luck: slot 4, lck +2');
  const def = holder(0, {}, 50);
  applyMaterial(MATERIAL_DEFENSE, def, false);
  check(def.materialCounts[3] === 1 && def.stats.dfp === CLASS_MAX_STATS[0].dfp - 48, 'Defense: slot 3, dfp +2');
  const evade = holder(0, {}, 50);
  applyMaterial(MATERIAL_EVADE, evade, false);
  check(evade.materialCounts[2] === 1 && evade.stats.evp === CLASS_MAX_STATS[0].evp - 48, 'Evade: slot 2, evp +2');
  const near = holder(0, {}, 1);
  applyMaterial(MATERIAL_POWER, near, false);
  check(near.stats.atp === CLASS_MAX_STATS[0].atp, 'Power: +2 past the maximum stops at the maximum');
}

// Challenge Mode: x5 (10) for every kind that applies it; the counter still +1.
{
  const h = holder(0, {}, 50);
  check(applyMaterial(MATERIAL_POWER, h, true) === MATERIAL_AMOUNT * 5 && h.stats.atp === CLASS_MAX_STATS[0].atp - 40, 'Challenge Power: +10 atp');
  check(h.materialCounts[0] === 1, 'Challenge Power: one counter');
  const hp = holder(0);
  applyMaterial(MATERIAL_HP, hp, true);
  check(hp.hpMaterials === 10, 'Challenge HP: +10 bonus');
  const tp = holder(0);
  applyMaterial(MATERIAL_TP, tp, true);
  check(tp.tpMaterials === 10, 'Challenge TP: +10 bonus');
  const mind = holder(3, {}, 50);
  applyMaterial(MATERIAL_MIND, mind, true);
  check(mind.stats.mst === CLASS_MAX_STATS[3].mst - 40 && mind.materialCounts[1] === 1, 'Challenge Mind (a human): x5 as well');
}

// Androids: Mind and TP do nothing (class_check 0xd7 gates them), the other stats apply.
{
  const cast = holder(5, { tpMaterials: 0 }, 50);
  check(applyMaterial(MATERIAL_TP, cast, false) === 0 && cast.tpMaterials === 0, 'android TP: no bonus');
  const mind = holder(1, {}, 50); // HUnewearl: not an android, Mind applies
  applyMaterial(MATERIAL_MIND, mind, false);
  check(mind.materialCounts[1] === 1, 'a newman (not an android): Mind applies');
  const ra = holder(4, {}, 0); // RAcast: android, mst 0 (the stat maximum) -> refused by usable
  check(!materialUsable(MATERIAL_MIND, ra), 'RAcast: Mind is refused by the use check (mst maximum 0)');
  const luck = holder(4, {}, 50);
  applyMaterial(MATERIAL_LUCK, luck, false);
  check(luck.materialCounts[4] === 1, 'an android: Luck still applies');
}

// Cap accounting: a counter goes up only while the total stays within the cap.
{
  const h = holder(1, { materialCounts: [149, 0, 0, 0, 0] }, 50);
  applyMaterial(MATERIAL_POWER, h, false);
  check(materialTotal(h) === 150 && h.materialCounts[0] === 150, 'a newman reaches the cap of 150');
  check(!materialUsable(MATERIAL_POWER, h), 'a newman at 150 is refused');
  const full = holder(1, { materialCounts: [150, 0, 0, 0, 0] }, 50);
  check(applyMaterial(MATERIAL_POWER, full, false) === 2 && full.materialCounts[0] === 150, 'apply past the cap still changes the stat, not the counter');
}

// PlayerProgression: the use updates the stats, the bonuses, the counters and the max HP / TP.
{
  const table = {} as never; // the level table is not read by the material rules
  const p = new PlayerProgression(table, {
    charClass: 0,
    level: 0,
    exp: 0,
    stats: { atp: 100, mst: 50, evp: 40, hp: 100, dfp: 30, ata: 0, lck: 10, esp: 0 },
    hpMaterials: 0,
    tpMaterials: 0,
    materialCounts: [0, 0, 0, 0, 0],
  } as never);
  check(p.maxHp === 200, 'HUmar, HP 100, level 0: max HP 200 (factor 2.0)');
  check(p.useMaterial(MATERIAL_HP, false) && p.maxHp === 202, 'HP material: max HP +2 (the bonus is raw)');
  check(p.useMaterial(MATERIAL_POWER, false) && p.stats.atp === 102 && p.materialCounts[0] === 1, 'Power material: atp 102, counter 1');
  check(p.useMaterial(MATERIAL_POWER, true) && p.stats.atp === 112 && p.materialCounts[0] === 2, 'Challenge Power: atp 112 (x5), counter 2');
  check(p.materialUsable(MATERIAL_POWER) === true, 'still usable below the maximum');
}

// The item use: the check is refused without the material rules; with them, 6x27 then the change.
{
  const sent: Array<[number, string]> = [];
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
  const game = {
    on: () => {},
    conn: { onCommand: () => {}, send: () => {} },
    info: null,
    players: new Map(),
    selfId: 2,
    active: true,
    sendSubcommand: (sub: number, body: Uint8Array) => sent.push([sub, hex(body)]),
  } as never;
  const inv = (h: string, id: number): InventoryItem => ({ index: 0, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: { ...itemFromHex(h), id } });
  const power = inv('030b0000 00000000 00000000 00000000 00000000', 0x20);
  const hpMat = inv('030b0300 00000000 00000000 00000000 00000000', 0x21);
  const ch = {
    meseta: 0,
    inventory: [power, hpMat],
    techLevels: [],
    stats: { atp: 100, mst: 0, evp: 0, hp: 0, dfp: 0, ata: 0, lck: 0, esp: 0 },
    charClass: 0,
    sectionId: 0,
    hpFromMaterials: 0,
    tpFromMaterials: 0,
    materialCounts: [0, 0, 0, 0, 0],
  } as unknown as CharacterFile;
  const used: number[] = [];
  const items = new GameItems(game, { character: () => ch, fullCharacter: () => null } as never);
  check(!items.canUse(power, {}), 'no material rules: a Power material is not usable');
  items.use(0x20, {});
  check(sent.length === 0 && ch.inventory.length === 2, 'no rules: nothing sent, not used up');
  const rules = { material: { canUse: (k: number) => k === MATERIAL_POWER || k === MATERIAL_HP, use: (k: number) => used.push(k) } };
  check(items.canUse(power, rules) && items.canUse(hpMat, rules), 'the rules say usable: the Power and HP materials');
  items.use(0x20, rules);
  check(sent.length === 1 && sent[0][0] === 0x27 && used.join() === String(MATERIAL_POWER), 'Power: 6x27, then the material change');
  check(ch.inventory.length === 1 && ch.inventory[0].data.id === 0x21, 'the used material is removed');
  check(!items.canUse(power, { material: { canUse: () => false, use: () => {} } }), 'the rules refuse: not usable');
}

// The raw save: the bonuses go to bytes 1 / 2, the counters to the raw slots 8..12 (extension_data2).
{
  const raw = new Uint8Array(0x2ea4);
  const c = { inventory: [], hpFromMaterials: 6, tpFromMaterials: 8, materialCounts: [1, 2, 3, 4, 5] } as unknown as CharacterFile;
  writeCharacterInventory(c, raw);
  check(raw[0] === 0 && raw[1] === 6 && raw[2] === 8, 'the raw save: count 0, HP bonus 6 (byte 1), TP bonus 8 (byte 2)');
  check([0, 1, 2, 3, 4].every((t) => raw[4 + (8 + t) * 0x1c + 3] === t + 1), 'the raw save: the counters in the extension_data2 of slots 8..12');
  const none = new Uint8Array(0x2ea4);
  writeCharacterInventory({ inventory: [], hpFromMaterials: 0, tpFromMaterials: 0 } as unknown as CharacterFile, none);
  check(none[1] === 0 && none[4 + 8 * 0x1c + 3] === 0, 'no counters on the character: the bytes are left alone');
}

console.log(`${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ' ALL PASS'}`);
if (failures) process.exitCode = 1;
