// Classic field HUD: action palette data and icons (classic/palette.ts), the
// main menu rules (classic/fieldmenu.ts), the Item Pack rows, actions and
// amount spinner (classic/itempack.ts), the Equip window (classic/equipmenu.ts),
// the Technique menu (classic/techmenu.ts)
// and the item command bytes the menus end in (net/items.ts).
// Run: node tests/fieldhud.test.ts
import { WindowAnim, withElementWipe } from '../client/src/classic/windowanim.ts';
import { EquipMenu, equipSlots, equipSwap, slotCandidates } from '../client/src/classic/equipmenu.ts';
import { validateMenuEntry, isSafeMap, type MenuRules } from '../client/src/classic/fieldmenu.ts';
import { MENU_LAYER, STATUS_LAYER } from '../client/src/classic/hud.ts';
import {
  AmountSpinner,
  categoryIcon,
  classCanUse,
  hasBonuses,
  drawItemRow,
  ItemPackMenu,
  itemRow,
  itemRows,
  itemRowName,
  purposeItems,
  PURPOSE,
  spinnerKeyDown,
  spinnerKeyUp,
  type ItemRow,
  type RowContext,
} from '../client/src/classic/itempack.ts';
import { CONFIG_OFFSET, currentPalette, paletteFromCharacter, paletteIcon, parsePalette, slotCount, EMPTY_ICON } from '../client/src/classic/palette.ts';
import { techInfo, techItems, techTpCost, TECH_TYPES } from '../client/src/classic/techmenu.ts';
import { candidateStats, compareColor, equipContribution, equipStatRows, hasEquipPanel, magRows, magStatText, VALUE_COLOR, type EquipStatRow } from '../client/src/classic/itemdetail.ts';
import { ItemPMT } from '../client/src/formats/itempmt.ts';
import { itemFromHex, ItemNames } from '../client/src/formats/itemnames.ts';
import type { CharacterFile, InventoryItem } from '../client/src/net/charfile.ts';
import { autoSortOrder, buildDropItem, buildEquip, buildSortInventory, buildSplitStack, buildUseItem, InventoryModel, sortKey } from '../client/src/net/items.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// --- draw order: the menu / counter windows are created after the status
// window and drawn over it (classic/hud.ts MENU_LAYER) ---
eq(MENU_LAYER > STATUS_LAYER, true, 'menu and counter windows over the status window');

// --- palette (newserv config_hunter_ranger / config_force) ---
const hunterConfig = new Uint8Array(0xe8);
hunterConfig.set([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 2, 1, 0, 0, 4, 0, 0, 0], 0);
hunterConfig[60] = 1;
const pal = parsePalette(hunterConfig);
eq(pal.flipped, false, 'not flipped');
eq(currentPalette(pal).slots.map((s) => [s.group1, s.group2]), [[2, 0], [2, 1], [4, 0]], 'hunter palette: attack, heavy, Monomate');
eq(pal.palettes[1].middleOverride.group1, 1, 'second palette middle override');
eq(pal.palettes[1].slots.map((s) => s.group1), [0, 0, 0], 'second palette empty');
const raw = new Uint8Array(CONFIG_OFFSET + 0xe8);
raw.set(hunterConfig, CONFIG_OFFSET);
eq(paletteFromCharacter(raw)?.palettes[0].slots[2].group1, 4, 'palette from E7 +0x3E0');
eq(paletteFromCharacter(new Uint8Array(10)), null, 'short E7');
eq(paletteIcon(2, 0), { texture: 6, u: 200, v: 43 }, 'normal attack icon (0x009f15e8)');
eq(paletteIcon(2, 1), { texture: 6, u: 200, v: 0 }, 'heavy attack icon');
eq(paletteIcon(3, 0), { texture: 5, u: 50, v: 0 }, 'Foie icon (0x009f12e0)');
eq(paletteIcon(3, 6), { texture: 5, u: 0, v: 0 }, 'Zonde icon');
eq(paletteIcon(4, 0), { texture: 6, u: 0, v: 0 }, 'Monomate icon (0x009f1380)');
eq(paletteIcon(4, 0x0d).texture, 7, 'item index >= 0xD uses texture 7');
eq(paletteIcon(7, 8), { texture: 6, u: 150, v: 129 }, 'top special icon (0x009f1420)');
eq(paletteIcon(0, 0), EMPTY_ICON, 'empty slot');
// Battle Mode trap slots (group 1 = 4, group 2 0x0d..0x10): icon ITEM_UV[group2] on texture 7
// (0x009f1380 entries 13..16 = (0,129), (0,0), (0,86), (0,43)); count = the trap stock of type group2 - 0xd.
eq(paletteIcon(4, 0x0d), { texture: 7, u: 0, v: 129 }, 'trap slot 0 icon');
eq(paletteIcon(4, 0x0e), { texture: 7, u: 0, v: 0 }, 'trap slot 1 icon');
eq(paletteIcon(4, 0x0f), { texture: 7, u: 0, v: 86 }, 'trap slot 2 icon');
eq(paletteIcon(4, 0x10), { texture: 7, u: 0, v: 43 }, 'trap slot 3 icon');
{
  const stock = [3, 0, 2, 20];
  const st = { itemCount: () => 9, trapCount: (t: number) => stock[t] ?? 0 };
  const slot = (g2: number) => ({ group1: 4, group2: g2, disabled: false });
  eq([0x0d, 0x0e, 0x0f, 0x10].map((g) => slotCount(slot(g), st)), [3, 0, 2, 20], 'trap slot counts (stock by type)');
  eq(slotCount(slot(0x11), st), 0, 'group 2 above the four trap types shows no count (ASSUMED)');
  eq(slotCount(slot(0x0d), { itemCount: () => 9 }), 0, 'trap slot without a trap stock shows 0');
  eq(slotCount(slot(0), st), 9, 'item slot still uses the stack count');
  eq(slotCount({ group1: 2, group2: 0x0d, disabled: false }, st), 0, 'attack slot never shows a count');
}

// --- main menu rules (ValidateMenuItemCondition_00732620) ---
const field: MenuRules = { lobby: false, safe: false, online: true, questStarted: false, inTeam: false };
const city: MenuRules = { ...field, safe: true };
eq(validateMenuEntry(3, field), { id: 3, enabled: true }, 'Technique in the field');
eq(validateMenuEntry(3, city), { id: 4, enabled: false }, 'Technique in Pioneer 2');
eq(validateMenuEntry(7, field), { id: 8, enabled: true }, 'Quit online');
eq(validateMenuEntry(0x0c, city).enabled, false, 'Area Map in the city');
eq(validateMenuEntry(0x0f, field), { id: 0x10, enabled: false }, 'Quest Board without a quest');
eq(validateMenuEntry(0x1a, field).enabled, false, 'Trade Window outside Pioneer 2');
eq(validateMenuEntry(0x23, field).enabled, false, 'Team without a team');
eq(validateMenuEntry(9, { ...field, lobby: true }), { id: 10, enabled: false }, 'Equip in the lobby');
eq([0, 0x0f, 0x12, 0x2d, 1].map(isSafeMap), [true, true, true, true, false], 'safe maps 0x0097f1c8');

// --- item rows ---
const pmt = new ItemPMT();
pmt.weaponKinds = [0, 0, 1, 0, 0, 0, 6];
pmt.weapons[1] = [{ id: 10, usabilityFlags: 0xff, atpRequired: 0, mstRequired: 0, ataRequired: 0 } as never];
pmt.weapons[6] = [{ id: 11, usabilityFlags: 0x02 | 0x08 | 0x10 | 0x20 | 0x40 | 0x80, atpRequired: 0, mstRequired: 0, ataRequired: 0 } as never];
pmt.armors[0] = { id: 20, usabilityFlags: 0xff, requiredLevel: 0 } as never;
pmt.tools[0] = [{ id: 30, itemFlags: 2 } as never];
pmt.tools[2] = [{ id: 31, itemFlags: 2 } as never];
pmt.maxTechLevels = [[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 14, 29, 29, 0xff, 14, 0xff]];
const text: string[][] = [];
text[1] = [];
text[1][10] = 'Saber';
text[1][11] = 'Handgun';
text[1][20] = 'Frame';
text[1][30] = 'Monomate';
text[1][31] = 'Disk:';
text[3] = [];
text[3][30] = 'Health recovery fluid.';
text[5] = ['Foie '];
const names = new ItemNames(pmt, text);
const ctx: RowContext = { names, charClass: 0, level: 2, stats: { atp: 50, mst: 0, ata: 50 }, lobby: false };
const inv = (hex: string, equipped = false): InventoryItem => ({ index: 0, state: 1, flags: equipped ? 0x0c : 0, extensionData1: 0, extensionData2: 0, equipped, data: itemFromHex(hex) });
const saber = inv('000100000000000000000000 00010000 00000000', true);
eq(itemRow(saber, ctx), { id: 0x100, icon1: 0x0c, icon2: 0, name: 'Saber', count: '', nameColor: '#ffffff', iconColor: '#ffffff' }, 'equipped Saber row');
eq(itemRowName(itemFromHex('000100030000000000000000'), names), 'Saber +3', 'grind format "%s +%d"');
const mate = inv('030000000004000000000000 01000100 00000000');
eq(itemRow(mate, ctx).count, '×4', 'stack count "×n"');
eq(itemRow(mate, ctx).icon2, 5, 'mate icon');
eq(itemRowName(itemFromHex('030200000000000000000000'), names), 'Disk:Foie  Lv.1', 'disk "%s%s Lv.%d"');
const gun = inv('000600000000000000000000');
eq(categoryIcon(gun.data, (k) => pmt.weaponKinds[k]), 1, 'gun icon (kind 6 -> 3)');
eq(classCanUse(0, 0x02 | 0x08 | 0x10 | 0x20 | 0x40 | 0x80), false, 'HUmar cannot use a ranger-only weapon');
eq(itemRow(gun, ctx).icon1, 0x13, 'class X icon');
eq(itemRow(gun, ctx).nameColor, '#909090', 'unusable name colour');
eq(hasBonuses(itemFromHex('000100000000010a00000000')), true, 'attribute -> green');
eq(itemRow(inv('000100000000010a00000000'), ctx).nameColor, '#61e853', 'bonus colour');

// --- Purpose (ChallengePlayer_AddNormalItemList_00751324) ---
const pctx = { lobby: false, canUse: () => true, equipProblems: () => 0, undroppable: () => false };
const label = (i: number) => `#${i.toString(16)}`;
eq(purposeItems(saber, pctx, label).map((i) => [i.label, i.value, i.enabled]), [['#74', 2, true], ['#72', 3, true], ['#76', 7, true]], 'equipped weapon: Remove, Drop, Sort');
eq(purposeItems(mate, pctx, label).map((i) => i.value), [0, 3, 7], 'tool: Use, Drop, Sort');
eq(purposeItems('meseta', pctx, label).map((i) => i.value), [PURPOSE.mesetaDrop], 'meseta: Drop');
eq(purposeItems(mate, { ...pctx, lobby: true }, label).every((i) => !i.enabled), true, 'nothing in the lobby');

// --- amount spinner (CreateNumericDisplayListWindow_00728ac4) ---
const a = new AmountSpinner(25);
eq([a.digits, a.value], [2, 1], 'two digits, starts at 1');
a.up();
eq(a.value, 2, 'up adds 1');
a.left();
a.up();
eq(a.value, 12, 'tens digit adds 10');
a.up();
a.up();
eq(a.value, 1, 'over max wraps to min');
a.down();
eq(a.value, 25, 'under min wraps to max');
eq([a.digitRight(0), a.digitRight(1)], [113, 101], 'digit right edges for 2 digits (224 wide)');

// --- hold-repeat: a press steps at once; while held, the sixth frame, then every fifth
// (CheckSharedInputStateKeyHeld_007c0c6c with 6 and 5, SinowberillUIElementListWindow_HandleAction_00728d44)
{
  const h = new AmountSpinner(100);
  h.press('up');
  eq(h.value, 2, 'a press steps at once');
  const steps: number[] = [];
  for (let f = 1; f <= 12; f++) if (h.frame()) steps.push(f);
  eq([steps, h.value], [[6, 11], 4], 'held: the sixth frame, then every fifth');
  h.release('up');
  eq([h.frame(), h.value], [false, 4], 'released: no repeat');
  const w = new AmountSpinner(3);
  w.press('down');
  eq(w.value, 3, 'hold-repeat wraps like the single step');
  const k = (key: string, repeat = false) => ({ key, repeat }) as unknown as KeyboardEvent;
  const s = new AmountSpinner(100);
  spinnerKeyDown(s, k('ArrowUp'));
  spinnerKeyDown(s, k('ArrowUp', true));
  eq(s.value, 2, 'an OS repeat is not a second step');
  spinnerKeyUp(s, k('ArrowUp'));
  eq(s.frame(), false, 'a key up ends the hold');
  eq(spinnerKeyDown(s, k('Enter')), false, 'Enter is not a spinner direction');
}

// --- the Item Pack flow ends in the item actions ---
const calls: string[] = [];
const character = { meseta: 300, inventory: [saber, mate] } as unknown as CharacterFile;
const menu = new ItemPackMenu({
  character: () => character,
  rowContext: () => ctx,
  purposeContext: () => pctx,
  text: (g, i) => `${g}:${i}`,
  actions: {
    use: (id) => calls.push(`use ${id}`),
    equip: (id) => calls.push(`equip ${id}`),
    unequip: (id) => calls.push(`unequip ${id}`),
    drop: (id, n) => calls.push(`drop ${id} ${n}`),
    dropMeseta: (n) => calls.push(`meseta ${n}`),
    sortAuto: () => 0,
    sortSwap: () => 0,
    commitSort: () => 0,
  },
});
const press = (...keys: string[]) => keys.forEach((key) => menu.key({ key } as KeyboardEvent));
eq(menu.rows.length, 3, 'two items and meseta');
press('Enter', 'Enter'); // Saber: Remove
press('ArrowDown', 'Enter', 'Enter'); // Monomate: Use
press('Enter', 'ArrowDown', 'Enter', 'ArrowUp', 'ArrowUp', 'Enter'); // Monomate: Drop 3
press('ArrowDown', 'Enter', 'Enter', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'Enter'); // meseta: 101
eq(calls, ['unequip 256', 'use 65537', 'drop 65537 3', 'meseta 101'], 'menu actions');
eq(menu.key({ key: 'Backspace' } as KeyboardEvent), false, 'Backspace closes the list');

// --- the later windows run their own animation (windowanim.ts) ---
{
  const mk = () =>
    new ItemPackMenu({
      character: () => character,
      rowContext: () => ctx,
      purposeContext: () => pctx,
      text: (g, i) => `${g}:${i}`,
      actions: { use: () => 0, equip: () => 0, unequip: () => 0, drop: () => 0, dropMeseta: () => 0, sortAuto: () => 0, sortSwap: () => 0, commitSort: () => 0 },
    });
  const m = mk();
  const k = (key: string) => m.key({ key } as KeyboardEvent);
  const run = (n: number) => {
    for (let i = 0; i < n; i++) m.tick();
  };
  eq([m.detailAnim.isOpen, m.purposeAnim.visible], [true, false], 'description open, no Purpose window in the list');
  k('Enter'); // Saber: the Purpose window opens from counter 0; the description closes
  eq([m.detailAnim.animating, m.detailAnim.isOpen, m.purposeAnim.visible, m.purposeAnim.counter], [true, false, true, 0], 'Purpose opens at 0, description closes');
  run(3); // speed 1 adds 2 a frame: counter 6 < 7.5
  eq(m.purposeAnim.animating, true, 'Purpose still opening after 3 frames');
  run(1); // counter 8 >= 7.5
  eq([m.purposeAnim.isOpen, m.purposeAnim.animating], [true, false], 'Purpose open at counter 8');
  k('Backspace'); // back to the list: Purpose closes (4-frame close), the description reopens
  eq([m.purposeAnim.visible, m.purposeAnim.animating], [true, true], 'Purpose closes');
  run(5);
  eq(m.purposeAnim.visible, false, 'Purpose gone after its close');
  eq(m.detailAnim.isOpen, true, 'description open again once the list is back');

  // Meseta: Drop asks the amount in its own window; Backspace closes the spinner, the Purpose window stays.
  const m2 = mk();
  const k2 = (key: string) => m2.key({ key } as KeyboardEvent);
  k2('ArrowDown');
  k2('ArrowDown');
  k2('Enter');
  k2('Enter');
  eq([m2.debugState().state, m2.amountAnim.visible, m2.amountAnim.counter], ['amount', true, 0], 'meseta Drop opens the Amount window');
  k2('Backspace');
  eq([m2.amountAnim.animating, m2.purposeAnim.isOpen], [true, true], 'Amount closes, Purpose stays open');
}

// --- Sort (SortAndReassignChallengeItems_006a60f4, InventorySwapLinkedItems_006a6a08, 6xC4) ---
{
  const mk = (hex: string, id: number, equipped = false): InventoryItem => {
    const it = inv(hex, equipped);
    it.data.id = id;
    return it;
  };
  const tool = mk('030000000001000000000000', 10); // tool 03 00 00
  const frame2 = mk('010100000000000000000000', 11); // armor 01 01
  const unit = mk('010300000000000000000000', 12); // unit 01 03
  const wep = mk('000200000000000000000000', 13); // weapon 00 02
  const wepEq = mk('000100000000000000000000', 14, true); // weapon 00 01, equipped
  const wepNo = mk('000100000000000000000000', 15); // weapon 00 01, not equipped
  eq(sortKey(wepEq), 0x100, 'key: weapon 00 01 equipped');
  eq(sortKey(wepNo), 0x10100, 'key: not equipped adds 0x10000');
  eq(sortKey({ ...wepEq, flags: 0x08 }), 0x10100, 'key: flags 0x08 alone is not equipped (the exe needs 0x04 too)');
  eq(sortKey(frame2), (1 << 25) | (1 << 17) | 0x10000, 'key: armor shifts data1[1] by 17');
  eq(autoSortOrder([tool, frame2, unit, wep, wepNo, wepEq]).map((i) => i.data.id), [14, 15, 13, 11, 12, 10], 'sorted ascending by group, equipped first');
  const c = { meseta: 0, inventory: [tool, frame2, wepNo, wep] } as unknown as CharacterFile;
  const model = new InventoryModel(c);
  model.sortAuto();
  eq(c.inventory.map((i) => [i.data.id, i.index]), [[15, 0], [13, 1], [11, 2], [10, 3]], 'sortAuto reorders and reindexes');
  eq(model.swap(15, 10), true, 'swap');
  eq(c.inventory.map((i) => i.data.id), [10, 13, 11, 15], 'swap trades places');
  eq(model.swap(15, 99), false, 'swap with an unknown id');
  const pkt = buildSortInventory([10, 13, 11, 15]);
  eq([pkt.length, pkt[0], pkt[1], pkt[2], pkt[3]], [0x7c, 0xc4, 0x1f, 0xff, 0xff], '6xC4 header');
  eq([...new Uint32Array(pkt.buffer, 4, 6)], [10, 13, 11, 15, 0xffffffff, 0xffffffff], '6xC4 ids, -1 after the last');

  // The menu: Sort > Automatically, then Manually (pick two, trade places).
  const log: string[] = [];
  const chr = { meseta: 10, inventory: [tool, frame2, wepNo] } as unknown as CharacterFile;
  const m2 = new InventoryModel(chr);
  const sortMenu = new ItemPackMenu({
    character: () => chr,
    rowContext: () => ctx,
    purposeContext: () => pctx,
    text: (g, i) => `${g}:${i}`,
    actions: {
      use: () => 0, equip: () => 0, unequip: () => 0, drop: () => 0, dropMeseta: () => 0,
      sortAuto: () => (log.push('auto'), m2.sortAuto()),
      sortSwap: (a, b) => (log.push(`swap ${a} ${b}`), m2.swap(a, b)),
      commitSort: () => log.push('commit'),
    },
  });
  const sp = (...keys: string[]) => keys.forEach((key) => sortMenu.key({ key } as KeyboardEvent));
  sp('Enter', 'ArrowDown', 'ArrowDown', 'Enter'); // tool: Use, Drop, Sort (3rd)
  sp('Enter'); // Automatically
  eq(log, ['auto'], 'automatic sort called');
  eq(chr.inventory.map((i) => i.data.id), [15, 11, 10], 'inventory sorted');
  log.length = 0;
  sp('Enter', 'ArrowDown', 'ArrowDown', 'Enter', 'ArrowDown', 'Enter'); // wepNo: Equip, Drop, Sort > Manually
  sp('Enter', 'ArrowDown', 'Enter'); // pick 15, trade places with 11
  eq(log, ['swap 11 15'], 'manual sort swaps the picked pair');
  eq(chr.inventory.map((i) => i.data.id), [11, 15, 10], 'inventory swapped');
  sp('Backspace');
  eq(log.includes('commit'), true, 'closing the window sends the order');
}

// --- Equip window (EquipmentMenu_UpdateSlotDisplay_0074bc00, HandleItemEquipSwap_0074ad94) ---
const frame = inv('010100000002000000000000 00020000', true); // 2 unit slots
const unitA = inv('010300000100000000000000 00030000', true); // unit slot 2 (10)
const unitB = inv('010300000000000000000000 00040000');
const equipChar = { charClass: 0, meseta: 0, inventory: [saber, frame, unitA, unitB, gun] } as unknown as CharacterFile;
eq(equipSlots(equipChar).map((s) => [s.slot, s.item?.data.id ?? null]), [[6, 0x100], [2, 0x200], [9, null], [10, 0x300], [3, null], [1, null]], 'slots: weapon, armor, its 2 units, shield, mag');
eq(equipSlots(equipChar).map((s) => s.emptyIcon), [0, 0x0b, 4, 4, 0x0a, 3], 'empty slot icons (hunter weapon 0)');
eq(equipSlots({ charClass: 0, meseta: 0, inventory: [] } as unknown as CharacterFile).map((s) => s.slot), [6, 2, 3, 1], 'no armor: no unit rows');
eq(slotCandidates(equipChar, 9).map((i) => i.data.id), [0x300, 0x400], 'unit slot lists every unit');
const swaps: string[] = [];
const ea = { equip: (id: number, slot: number) => swaps.push(`equip ${id} ${slot}`), unequip: (id: number) => swaps.push(`unequip ${id}`) };
equipSwap(equipChar, 9, 0x300, ea);
equipSwap(equipChar, 10, 0x400, ea);
equipSwap(equipChar, 6, 0x100, ea);
eq(swaps, ['unequip 768', 'equip 768 9', 'unequip 768', 'equip 1024 10', 'unequip 256'], 'move a unit, replace a unit, remove the weapon');
const equipCalls: string[] = [];
const emenu = new EquipMenu({
  character: () => equipChar,
  rowContext: () => ctx,
  purposeContext: () => pctx,
  text: (g, i) => `${g}:${i}`,
  actions: { use: () => 0, equip: () => 0, unequip: () => 0, drop: () => 0, dropMeseta: () => 0, sortAuto: () => 0, sortSwap: () => 0, commitSort: () => 0 },
  equipActions: { equip: (id, slot) => equipCalls.push(`equip ${id} ${slot}`), unequip: (id) => equipCalls.push(`unequip ${id}`) },
});
const epress = (...keys: string[]) => keys.forEach((key) => emenu.key({ key } as KeyboardEvent));
epress('Enter');
eq(emenu.items.map((i) => i.data.id), [0x100, gun.data.id], 'weapon slot lists the weapons');
epress('ArrowDown', 'Enter'); // the ranger gun: disabled for a HUmar
epress('ArrowUp', 'Enter'); // the equipped Saber: removed
eq(equipCalls, ['unequip 256'], 'disabled item refused, equipped one removed');
eq(emenu.key({ key: 'Backspace' } as KeyboardEvent), false, 'Backspace on the slots closes the window');

// --- technique menu ---
const tenv = { text: (g: number, i: number) => (g === 6 && i === 0x13 ? 'Level:' : g === 7 ? '\nRequired TP: ' : g === 5 ? `T${i}` : g === 6 ? `\n\nD${i}` : ''), level: (t: number) => (t === 0 ? 3 : null), canCast: () => true };
eq(TECH_TYPES[0], [0, 6, 3], 'Simple Attack list 0x00974a4c');
eq(techTpCost(0, 0), 5, 'Foie Lv1 TP');
eq(techTpCost(0, 29), 42, 'Foie Lv30 TP (5 + 29 * 1.3 = 42.7, truncated)');
eq(techTpCost(0x11, 10), 20, 'Reverser fixed TP');
eq(techItems(0, tenv).map((i) => i.enabled), [true, false, false], 'learned Foie only');
eq(techInfo(0, tenv), 'Level:3\nRequired TP: 7\n\nD0', 'info text');
eq(techInfo(6, tenv), '', 'not learned: empty');

// --- command bytes behind the actions (net/items.ts) ---
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
eq(hex(buildEquip(0, 0x10000, 0)), '250300000000010000000000', '6x25 equip');
eq(hex(buildUseItem(1, 0x10001)), '2702010001000100', '6x27 use');
eq(hex(buildDropItem(0, 0x10002, 1, 0, 0, 0, 1)), '2a0600000100010002000100000000000000000000000000', '6x2A drop');
eq(hex(buildSplitStack(0, 0x10001, 3, 1, 0, 0)), 'c30600000100000000000000000000000100010003000000', '6xC3 split');

// --- equipment stat panel and mag rows (classic/itemdetail.ts) ---
// A weapon: ATP min 10, ATP max 20, MST 2, ATA 3 (x10 in the panel); grind 2 adds 4 to the ATP.
pmt.weapons[3] = [{ id: 40, usabilityFlags: 0xff, atpRequired: 50, mstRequired: 5, ataRequired: 20, atpMin: 10, atpMax: 20, mst: 2, ata: 3 } as never];
pmt.armors[0] = { id: 20, usabilityFlags: 0xff, requiredLevel: 0, dfp: 12, evp: 7 } as never;
const MAG_HEX = '020105002c01640090012a00' + '00000000' + '1c030000'; // data1, id, data2 (synchro 28, IQ 3)
const WEAPON_G0 = '000300000000000000000000';
const WEAPON_G2 = '000300020000000000000000';
const WEAPON_G2_SPECIAL = '000300020000050100000000'; // ATA special (type 5, value 1) = +10
const ARMOR_HEX = '010100000000000000000000';
const cur = { atp: 40, dfp: 20, mst: 5, ata: 50, evp: 10, lck: 3 };
eq(equipContribution(itemFromHex(WEAPON_G2), pmt), { atp: 14, mst: 2, ata: 30 }, 'weapon: ATP min + 2 x grind, MST, ATA x10');
eq(equipContribution(itemFromHex(WEAPON_G2_SPECIAL), pmt).ata, 40, 'weapon: the ATA special adds value x10');
eq(equipContribution(itemFromHex(ARMOR_HEX), pmt), { dfp: 12, evp: 7 }, 'armour: DFP and EVP');
eq(equipContribution(itemFromHex('030000000004000000000000'), pmt), {}, 'tool: no stat contribution');
eq([hasEquipPanel(itemFromHex(WEAPON_G0)), hasEquipPanel(itemFromHex(ARMOR_HEX)), hasEquipPanel(itemFromHex('010200000000000000000000')), hasEquipPanel(itemFromHex('030000000004000000000000')), hasEquipPanel(itemFromHex(MAG_HEX))], [true, true, true, false, false], 'panel: weapon, armour, shield');
eq(candidateStats(cur, { atp: 14, mst: 2, ata: 30 }, {}), { atp: 54, dfp: 20, mst: 7, ata: 80, evp: 10, lck: 3 }, 'candidate: current + what the item adds');
eq(candidateStats(cur, { atp: 14 }, { atp: 10 }), { ...cur, atp: 44 }, 'candidate: minus the equipped item of the slot');
const rowsOf = (r: EquipStatRow[]) => r.map((x) => [x.key, x.item, x.color]);
eq(
  rowsOf(equipStatRows(cur, itemFromHex(WEAPON_G2), null, pmt, false, true)),
  [
    ['atp', 54, VALUE_COLOR.higher],
    ['dfp', 20, VALUE_COLOR.same],
    ['mst', 7, VALUE_COLOR.higher],
    ['ata', 80, VALUE_COLOR.higher],
    ['evp', 10, VALUE_COLOR.same],
    ['lck', 3, VALUE_COLOR.same],
  ],
  'weapon with no equipped weapon: higher / equal colours per row',
);
eq(
  rowsOf(equipStatRows(cur, itemFromHex(WEAPON_G2), itemFromHex(WEAPON_G0), pmt, false, true)).slice(0, 1),
  [['atp', 44, VALUE_COLOR.higher]],
  'old grind-0 weapon removed: ATP 40 + 14 - 10',
);
eq(rowsOf(equipStatRows(cur, itemFromHex(ARMOR_HEX), null, pmt, false, true))[1], ['dfp', 32, VALUE_COLOR.higher], 'armour DFP 20 + 12');
eq(rowsOf(equipStatRows(cur, itemFromHex(WEAPON_G2), null, pmt, false, false)).map((r) => r[2]), Array(6).fill(VALUE_COLOR.none), 'not equippable: grey candidate values');
eq(rowsOf(equipStatRows(cur, itemFromHex(WEAPON_G2), null, pmt, true, true)).map((r) => r[1]), [40, 20, 5, 50, 10, 3], 'equipped item: its values are the current ones');
eq([compareColor(3, 5), compareColor(5, 5), compareColor(7, 5)], [VALUE_COLOR.lower, VALUE_COLOR.same, VALUE_COLOR.higher], 'colour rule: lower, equal, higher');
// A mag: level 5, DEF 300 / POW 100 / DEX 400 / MIND 42 (hundredths), synchro 28, IQ 3.
eq([magStatText(300), magStatText(150), magStatText(105), magStatText(42)], ['3', '1.5', '1.05', '0.42'], 'mag stat text: level, then the part');
const mag = magRows(itemFromHex(MAG_HEX));
eq(
  [mag.level, mag.synchro, mag.iq, mag.stats.map((s) => `${s.name} ${s.text}`)],
  [5, '28%', '3', ['DEF 3', 'POW 1', 'DEX 4', 'MIND 0.42']],
  'mag rows: level, synchro, IQ, DEF / POW / DEX / MIND',
);

// --- lobby Item List rows: the Item Pack's rows (itemRows), no "E " text ---
const lobbyChar = { charClass: 0, level: 2, meseta: 300, stats: { atp: 50, mst: 0, ata: 50 }, inventory: [saber, mate] } as unknown as CharacterFile;
const lobbyRows = itemRows(lobbyChar, { ...ctx, lobby: true }, 'Meseta');
eq(lobbyRows.length, 3, 'lobby Item List: two items and the meseta row');
eq(lobbyRows[0].icon1, 0x0c, 'lobby: equipped mark is icon 0x0C');
eq(lobbyRows[0].name, 'Saber', 'lobby: no "E " text on the equipped row');
eq(lobbyRows[1].count, '×4', 'lobby: stack count "×n"');
eq(lobbyRows[2].count, '300Meseta', 'lobby: meseta row count with the word');
eq(lobbyRows[2].icon2, 9, 'lobby: meseta icon');
eq(itemRows({ ...lobbyChar, meseta: 0 } as CharacterFile, ctx, 'Meseta').length, 2, 'no meseta row at 0 meseta');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
// --- the field menus' element wipe (classic/windowanim.ts withElementWipe) ---
// An Item Pack row's icons are elements of the leaf's opening wipe: at counter
// 0 (c = -8) nothing of the row shows; the open window draws both icons.
{
  let drawn = 0;
  const rctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => {
      if (k === 'drawImage') return () => drawn++;
      if (k === 'save' || k === 'restore' || k === 'beginPath' || k === 'rect' || k === 'clip') return () => {};
      return t[k as string];
    },
    set: (t, k, v) => {
      t[k as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const icons = {} as CanvasImageSource;
  const row: ItemRow = { icon1: 0x0c, icon2: 5, name: '', count: '', nameColor: '#ffffff', iconColor: '#ffffff' };
  const closedAt0 = new WindowAnim(true, true);
  closedAt0.counter = 0;
  drawn = 0;
  withElementWipe(closedAt0, 0, 0, 200, () => drawItemRow(rctx, icons, row, 0, 0, 0, 200));
  eq(drawn, 0, 'a row at the wipe start (counter 0) draws nothing');
  drawn = 0;
  const open = new WindowAnim(true, true);
  open.counter = 0x1000000;
  withElementWipe(open, 0, 0, 200, () => drawItemRow(rctx, icons, row, 0, 0, 0, 200));
  eq(drawn, 2, 'an open window draws both icons of the row');
  drawn = 0;
  drawItemRow(rctx, icons, row, 0, 0, 0, 200);
  eq(drawn, 2, 'no scope: the row draws whole, as the HUD and the main menu do');
}

console.log('fieldhud: all checks passed');
