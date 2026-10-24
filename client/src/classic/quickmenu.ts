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
// Not ported here (see DEVLOG 2026-10-23 "quick menu"): the windows themselves
// (the tab lists, the motion menu's drawing and its sub-lists, the trade path
// states 0x13..0x20 of QuickMenuWindow, the 0x61 player list) and the chat
// cooldown owner (the quick menu object at g_pUITextColorTable, not the End window).
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
export const QUICK_MENU_GUI = {
  // gui 1: the weapon and technique lists (0x00971f48 = 13, 317).
  list: { x: 13, y: 317, gui: 1 },
  // gui 2: the two-handed list's position (0x00971f50 = 324, 256).
  twoHandedList: { x: 324, y: 256, gui: 2 },
  // gui 0xe1: the lobby motion menu (0x00972648 = 13, 276).
  motionList: { x: 13, y: 276, gui: 0xe1 },
  // gui 0xe2: the motion menu's sub-list (0x00972650 = 13, 317).
  motionSubList: { x: 13, y: 317, gui: 0xe2 },
} as const;

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
