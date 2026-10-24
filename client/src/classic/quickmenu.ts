// The End-key quick menu (classic), the model part: which tab the menu opens on,
// how the tab cursor moves, and the gui positions of its lists.
//
// Premise correction (per the exe, 2026-10-23): key role 14 (enum `quickmenu`,
// dump 86172; key config "Symbol Chat Open") opens the quick menu, not a symbol
// chat picker. `unknown_handle_quickmenu` (dump 682493) calls
// `quick_menu_constructor` (dump 711543). The quick menu's tabs are the weapon
// list, the two-handed list, the traps list and the technique list; in the lobby
// it is the motion menu (8 categories). None of its tabs is a symbol chat row.
// The symbol chat row belongs to the challenge / player list windows, not here.
//
// The model is here; the window is classic/quickmenuwindow.ts. Not ported (see DEVLOG
// 2026-10-23 "quick menu"): the two-handed and traps lists (update_quickmenu cases 3..5
// and 6..8), the compare list (gui 2), the trade path states 0x13..0x20 of
// QuickMenuWindow, the 0x61 player list, and the chat cooldown owner (the quick menu
// object at g_pUITextColorTable, not the End window).
//
// Refs: dump line numbers are from ../reverse/refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c.

// The tab mapping (UpdateQuickMenuTabFromCharacterOption_00742070, dump 712540):
// tab = byte at g_QuickMenuTabMappingTable_00972f76 + cursor + 2. The bytes at
// 0x00972f78 are 00 03 06 09 (exedata read). Cursor 2 is the traps tab.
export const QUICK_MENU_TAB_TABLE: readonly number[] = [0x00, 0x03, 0x06, 0x09];
// Cursor values from the character option bits 16..17 (GetCharacterOptionsCursorMode_007be270,
// dump 806201: (options & 0x30000) >> 16). The lobby has no cursor: 0xff, tab 0x0c
// (quick_menu_constructor, dump 711596..711597).
export const QUICK_MENU_LOBBY_CURSOR = 0xff;
export const QUICK_MENU_LOBBY_TAB = 0x0c;
// The quick menu's own states past the tabs: 0x0c..0x10 the motion menu (lobby, case 0xc
// of update_quickmenu at dump 711997), 0x11 the character option pick (dump 712424).
export const QUICK_MENU_STATE_LOBBY_MOTIONS = 0x0c;
export const QUICK_MENU_STATE_OPTION_DONE = 0x11;

// should_have_traps_quick_menu (dump 712522): battle mode or an Android player.
export function quickMenuShouldHaveTraps(battleMode: boolean, android: boolean): boolean {
  return battleMode || android;
}

// The cursor a new quick menu starts on (quick_menu_constructor, dump 711577..711594).
// `mode` is the character option cursor mode (0..3). Mode 2 is skipped when the
// player has no traps (one step on, to 3); an Android on mode 3 starts on 0.
export function quickMenuStartCursor(mode: number, traps: boolean, android: boolean): number {
  let cursor = mode & 0xff;
  if (cursor === 2 && !traps) cursor = stepRaw(cursor);
  if (android && cursor === 3) cursor = 0;
  return cursor;
}

// One step of the tab cursor (InformationCounterListWindow_HandleInput_007419d4,
// dump 712096): +1, wrapping 3 -> 0; a 2 is skipped when there are no traps, and an
// Android's 3 is skipped (to 0). The menu is not stepped in the lobby or while a
// game list is open (the caller checks those).
export function quickMenuStepCursor(cursor: number, traps: boolean, android: boolean): number {
  let next = stepRaw(cursor);
  if (next === 2 && !traps) next = stepRaw(next);
  if (android && next === 3) next = stepRaw(next);
  return next;
}

// The exe's +1 with wrap: `c + 1` if below 4, else `c - 3` (dump 712096 and 711581).
function stepRaw(c: number): number {
  return c + 1 < 4 ? c + 1 : c - 3;
}

// The tab state for a cursor (the byte at quick menu +0x1d). The lobby cursor is 0xff.
export function quickMenuTabFor(cursor: number): number {
  if (cursor === QUICK_MENU_LOBBY_CURSOR) return QUICK_MENU_LOBBY_TAB;
  return QUICK_MENU_TAB_TABLE[cursor] ?? 0;
}

// The gui positions the quick menu's lists use (get_gui_position(n) reads the
// vec2f table at 0x00971f40, 8 bytes an entry; the values read with exedata.py).
// Every tab's list is gui 1 (update_quickmenu cases 0, 3, 6, 9: get_gui_position(1)).
// gui 2 is not a tab: the weapon tab's compare list (CreateEquipListWindowObject_00725d18,
// key 0xe in state 1) opens there. The earlier "two-handed at gui 2" reading was wrong.
export const QUICK_MENU_GUI = {
  // gui 1: the weapon, two-handed, traps and technique lists (0x00971f48 = 13, 317).
  list: { x: 13, y: 317, gui: 1 },
  // gui 2: the weapon tab's compare list (0x00971f50 = 324, 256).
  compareList: { x: 324, y: 256, gui: 2 },
  // gui 0xe1: the lobby motion menu's categories (0x00972648 = 13, 276).
  motionList: { x: 13, y: 276, gui: 0xe1 },
  // gui 0xe2: the motion menu's sub-list (0x00972650 = 13, 317).
  motionSubList: { x: 13, y: 317, gui: 0xe2 },
} as const;
// The list width (ASSUMED: g_QuickMenuEquipListConfig is not read; the lists are
// ListWindowObject_Initialize(0x439a0000 = 308.0, height) in the exe, height 124,
// the categories 165).
export const QUICK_MENU_LIST_W = 308;
export const QUICK_MENU_LIST_H = 124;
export const QUICK_MENU_CATEGORY_H = 165;

// The technique list: the 19 techniques (CreateTechniqueListWindow_00741c88 loops
// 0x13 entries of the player's technique order at 0x00a95df8 + 0x108). The order is the
// default one (ASSUMED: the swap key 0xe, state 0xa, is not ported).
export const QUICK_MENU_TECH_COUNT = 0x13;
// The "here" colour of a learned technique that cannot be cast on this map (0xfffd3901, as techmenu.ts).
export const QUICK_MENU_TECH_HERE = '#fd3901';

// One row of a quick menu list. `value` is the row's id: an item id (weapons), a
// technique number, a category index or an emote slot (motions).
export interface QuickRow {
  label: string;
  value: number;
  enabled: boolean;
  color?: string | undefined;
}

// The lobby motion menu's rows (case 0xc and 0xe of update_quickmenu, dump 711997..712030;
// the table at 0x00972ea0, 12-byte entries: text base, value base, count). The text is
// unitxt group 0x42 (the motion names, e.g. 0x0a "Greeting1"; 0..7 are the categories).
export interface QuickMenuMotionRow {
  textBase: number;
  valueBase: number;
  count: number;
}
export const QUICK_MENU_MOTION_ROWS: readonly QuickMenuMotionRow[] = [
  { textBase: 10, valueBase: 2, count: 5 },
  { textBase: 15, valueBase: 7, count: 5 },
  { textBase: 20, valueBase: 12, count: 4 },
  { textBase: 24, valueBase: 16, count: 6 },
  { textBase: 30, valueBase: 22, count: 7 },
  { textBase: 37, valueBase: 29, count: 6 },
  { textBase: 43, valueBase: 35, count: 13 },
  { textBase: 8, valueBase: 0, count: 2 },
];

// The cursor one step back (the inverse of quickMenuStepCursor, for the Left key;
// ASSUMED: the exe only steps forward). Walks the valid cursors backwards.
export function quickMenuStepBack(cursor: number, traps: boolean, android: boolean): number {
  for (let k = 1; k <= 4; k++) {
    const c = (cursor - k + 4) % 4;
    if (c === 2 && !traps) continue;
    if (android && c === 3) continue;
    if (quickMenuStepCursor(c, traps, android) === cursor) return c;
  }
  return cursor;
}

// The weapon tab (PopulateEquippableWeapons, dump 719571): the inventory's weapons that
// are not equipped and not wrapped (the exe also checks the class and level through
// ValidateItemInstanceForEquip, which is not ported here: ASSUMED every weapon is listed),
// then the equipped weapon last. Weapons are data1[0] == 0 (ItemData).
export function quickMenuWeaponRows<T extends { equipped: boolean; data: { id: number; data1: Uint8Array } }>(
  inventory: readonly T[],
  name: (it: T) => string,
): QuickRow[] {
  const rows: QuickRow[] = [];
  const wrapped = (d: Uint8Array): boolean => (d[4] & 0x40) !== 0;
  for (const it of inventory) {
    if (it.equipped || it.data.data1[0] !== 0 || wrapped(it.data.data1)) continue;
    rows.push({ label: name(it), value: it.data.id, enabled: true });
  }
  for (const it of inventory) {
    if (it.equipped && it.data.data1[0] === 0) rows.push({ label: name(it), value: it.data.id, enabled: true });
  }
  return rows;
}

// The technique tab (CreateTechniqueListWindow_00741c88 / UpdateTechniqueListItem_0075e7e0):
// all 19 techniques, a technique the character has not learned is disabled, one it knows
// but cannot cast on this map is drawn in QUICK_MENU_TECH_HERE.
export function quickMenuTechRows(
  text: (group: number, index: number) => string,
  level: (tech: number) => number | null,
  canCast: boolean,
): QuickRow[] {
  const rows: QuickRow[] = [];
  for (let t = 0; t < QUICK_MENU_TECH_COUNT; t++) {
    const learned = level(t) !== null;
    rows.push({ label: text(5, t), value: t, enabled: learned, color: learned && !canCast ? QUICK_MENU_TECH_HERE : undefined });
  }
  return rows;
}

// The lobby motion menu's categories (case 0xc: unitxt group 0x42, indices 0..7).
export function quickMenuMotionCategoryRows(text: (group: number, index: number) => string): QuickRow[] {
  return QUICK_MENU_MOTION_ROWS.map((_, i) => ({ label: text(0x42, i), value: i, enabled: true }));
}

// A motion category's sub-list (case 0xe, dump 712010..712030): row k is unitxt
// (0x42, textBase + k), its value the emote slot valueBase + k.
export function quickMenuMotionSubRows(category: number, text: (group: number, index: number) => string): QuickRow[] {
  const row = QUICK_MENU_MOTION_ROWS[category];
  if (!row) return [];
  const out: QuickRow[] = [];
  for (let k = 0; k < row.count; k++) out.push({ label: text(0x42, row.textBase + k), value: row.valueBase + k, enabled: true });
  return out;
}
