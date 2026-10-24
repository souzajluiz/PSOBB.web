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
  // gui 1: every tab's list (update_quickmenu calls get_gui_position(1) in cases 0, 3, 6, 9;
  // 0x00971f48 = 13, 317).
  list: { x: 13, y: 317, gui: 1 },
  // gui 2: the weapon tab's compare list, opened by key 0xe in state 1 (0x00971f50 = 324, 256;
  // CreateEquipListWindowObject_00725d18, dump 689984). Not a tab (2026-10-23 correction).
  compareList: { x: 324, y: 256, gui: 2 },
  // gui 0xe1: the lobby motion menu (0x00972648 = 13, 276).
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
// ---------------------------------------------------------------------------
// Tab rows and actions for the quick menu windows (2026-10-23, pure; the window
// fills the facts from the live item / player / map and acts on the result).
//
// Item facts. Offsets are the exe's item_instance fields (struct at dump line 78921):
// group_1 +0xf2 (data[0]), group_2 +0xf3 (data[1], the tool class), group_idx +0xf4
// (data[2], the tool variant), owner +0xf8, dwItemFlags +0xdc.
// ---------------------------------------------------------------------------

// The tools_techs group (group_1 == 3). Every tool in the tab lists is in this group.
export const GROUP_TOOLS_TECHS = 3;

export interface QuickMenuItemFacts {
  // item group_1 (+0xf2).
  group1: number;
  // item group_2 (+0xf3) and group_idx (+0xf4). Only read for tools.
  group2: number;
  groupIdx: number;
  // item dwItemFlags (+0xdc).
  dwItemFlags: number;
  // The raw result of CheckItemEquipConditions_005d5f40 for this item, before the
  // item-flag fix-ups of GetItemAttackData. Filled by the caller (not decoded here).
  equipCheckBits: number;
  // is_rare_weapon (is_item_rare, dump 414662).
  rare: boolean;
}

// The bits GetItemAttackData_005c50b4 returns (dump 414125, asm 5c50b4..5c510f).
export const ATTACK_BIT_BLOCKED = 0x01; // checker bit 1: the item is blocked here and now
export const ATTACK_BIT_EQUIPPABLE = 0x02; // checker bit 2 (CanEquipItem), or dwItemFlags 0x200
export const ATTACK_BIT_WEAPON = 0x08; // checker bit 8: set for every non-tool item (group_1 != 3)
export const ATTACK_BIT_FLAG80 = 0x10; // dwItemFlags 0x80 when the checker result is 0

// GetItemAttackData_005c50b4 (asm): raw = checker & mask; if dwItemFlags & 0x200, raw |= 2;
// if raw == 0 and dwItemFlags & 0x80, raw = 0x10; return raw & mask. The "attack data type"
// the populate calls pass is this mask, not an item or ItemPMT field.
export function itemAttackDataBits(f: QuickMenuItemFacts, mask: number): number {
  let raw = f.equipCheckBits & mask;
  if ((f.dwItemFlags & 0x200) !== 0) raw |= ATTACK_BIT_EQUIPPABLE;
  if (raw === 0 && (f.dwItemFlags & 0x80) !== 0) raw = ATTACK_BIT_FLAG80;
  return raw & mask;
}

// The two-handed tab (ListWindowObject_PopulateTwoHandedWeapons_0074b620, dump 719618):
// GetItemAttackData(item, 2) != 0, GetItemAttackData(item, 1) == 0, not rare. Inventory
// order is kept. The name is the populate's; the list holds tools, not two-handed weapons
// (the equipped weapon is not added here).
export function isTwoHandedTabItem(f: QuickMenuItemFacts): boolean {
  return itemAttackDataBits(f, ATTACK_BIT_EQUIPPABLE) !== 0 && itemAttackDataBits(f, ATTACK_BIT_BLOCKED) === 0 && !f.rare;
}

export interface QuickMenuListItem {
  instanceId: number;
  facts: QuickMenuItemFacts;
}

// The rows of the two-handed tab, in inventory order.
export function twoHandedTabRows<T extends QuickMenuListItem>(items: readonly T[]): T[] {
  return items.filter((it) => isTwoHandedTabItem(it.facts));
}

// GetToolTechSlotId_005de4d8 (dump 434966): the tool's slot in the tools/techs bar from
// (group_2, group_idx). -1 when the item has no slot (class 2, the technique scrolls, and
// any variant not listed).
export const TOOL_TECH_SLOT_NONE = -1;
export function toolTechSlotId(group2: number, groupIdx: number): number {
  switch (group2) {
    case 0:
      return groupIdx <= 2 ? groupIdx : TOOL_TECH_SLOT_NONE;
    case 1:
      return groupIdx <= 2 ? groupIdx + 3 : TOOL_TECH_SLOT_NONE;
    case 3:
      return 8;
    case 4:
      return 9;
    case 5:
      return 10;
    case 6:
      return groupIdx === 0 ? 6 : groupIdx === 1 ? 7 : TOOL_TECH_SLOT_NONE;
    case 7:
      return 0x0b;
    case 8:
      return 0x0c;
    default:
      return TOOL_TECH_SLOT_NONE;
  }
}

// The player action ProcessToolTechUse_00741c00 sets (dump 712224): action type 4 with the
// slot, when Player_CanPerformAction(…, 4, slot) passes (dump 786128: the player's ready bit
// (unk1 +0x10b6 bit 0) and slot 9 or 10 only, 8 < slot < 11). Setting the action clears the
// ready bit. `ready` is that bit. Returns null when nothing is set.
export const QM_ACTION_TOOL = 4;
export interface QuickMenuToolAction {
  actionType: number;
  slot: number;
}
export function toolPendingAction(slot: number, ready: boolean): QuickMenuToolAction | null {
  if (slot === TOOL_TECH_SLOT_NONE || !ready) return null;
  if (!(slot > 8 && slot < 0x0b)) return null;
  return { actionType: QM_ACTION_TOOL, slot };
}

// The tools tab's state machine (update_quickmenu cases 3..5, dump 711755..711870).
// State 3 is the populate; it goes on to state 4 in the same frame. In state 4 the list's
// flags (+0x84): bit 2 closes, bit 1 goes to 5 (the decide). In state 5 the key 0xd (held)
// cancels with SE 0x585; otherwise, when the action is allowed and the selected item still
// exists, the item is used (ChallengePlayer_HandleItemUsage) and the menu closes.
export const QM_TOOL_STATE_POPULATE = 3;
export const QM_TOOL_STATE_PICK = 4;
export const QM_TOOL_STATE_USE = 5;
export const QM_SOUND_CANCEL = 0x585;
export interface ToolTabStep {
  state: number;
  close: boolean;
  sound: number | null;
  use: boolean;
}
export function toolTabStep(
  state: number,
  listFlags: number,
  keyHeld13: boolean,
  actionAllowed: boolean,
  hasItem: boolean,
): ToolTabStep {
  if (state === QM_TOOL_STATE_POPULATE) state = QM_TOOL_STATE_PICK;
  if (state === QM_TOOL_STATE_PICK) {
    if ((listFlags & 4) !== 0) return { state, close: true, sound: null, use: false };
    if ((listFlags & 2) !== 0) state = QM_TOOL_STATE_USE;
    return { state, close: false, sound: null, use: false };
  }
  if (keyHeld13) return { state, close: true, sound: QM_SOUND_CANCEL, use: false };
  if (actionAllowed && hasItem) return { state, close: true, sound: null, use: true };
  return { state, close: false, sound: null, use: false };
}

// The traps tab (ListWindowObject_ResetAndRefresh_0074b9b4, dump 719825 -> the challenge
// status items, dump 704479). Five rows, index 0..4. Rows 0..3 are the player's challenge
// status bytes (+0x89c, SinowberillChallengePlayer_GetStatusOrAction_00698984: signed,
// 0..20, anything else reads as 0). Row 4 is the Battle Mode trap stock (the player's
// `last_attack_type` field in the dump, ClampValue_00697958: 0..99, anything else 0).
// A row is shown only when its count is above 0. Its label is unitxt group 0x11, 0x13 + row
// (ASSUMED: the label text is not read). A row is greyed (flag 0x80) unless the map is safe
// and not a boss map.
export const TRAP_ROW_COUNT = 5;
export const TRAP_STOCK_ROW = 4;
export const TRAP_LABEL_BASE = 0x13;
export const TRAP_LABEL_GROUP = 0x11;
export interface TrapRow {
  row: number;
  labelId: number;
  count: number;
  disabled: boolean;
}
export function trapStatusCount(raw: number): number {
  const v = (raw << 24) >> 24; // the status is a signed byte
  return v < 0 || v > 0x14 ? 0 : v;
}
export function trapStockCount(raw: number): number {
  return raw < 0 || raw > 99 ? 0 : raw;
}
export function trapRows(statuses: readonly number[], stock: number, safeNotBoss: boolean): TrapRow[] {
  const out: TrapRow[] = [];
  for (let row = 0; row < TRAP_ROW_COUNT; row++) {
    const count = row === TRAP_STOCK_ROW ? trapStockCount(stock) : trapStatusCount(statuses[row] ?? 0);
    if (count <= 0) continue;
    out.push({ row, labelId: TRAP_LABEL_BASE + row, count, disabled: !safeNotBoss });
  }
  return out;
}

// The Battle Mode trap entity is made only on battle_spaceship (16) and battle_ruins (17),
// and only one at a time (CreateSinowberillChallengeEntityManager_006b08b8, dump 602277;
// the map enum at dump lines 68689..68690).
export const MAP_BATTLE_SPACESHIP = 16;
export const MAP_BATTLE_RUINS = 17;
export function canCreateChallengeTrapManager(map: number, managerExists: boolean): boolean {
  return (map === MAP_BATTLE_SPACESHIP || map === MAP_BATTLE_RUINS) && !managerExists;
}

// The traps tab's decide (update_quickmenu case 8, dump 711817..711870).
export interface TrapDecideInput {
  row: number;
  keyHeld13: boolean;
  actionAllowed: boolean;
  // ChallengeUI_HandleActionForAllElements_00719200 for the player (the element gate).
  uiGate: boolean;
  // The player's +0x32c is 2 (HandleSpecialPaletteInput returns 0).
  paletteBlocked: boolean;
  // SinowberillChallengePlayer_CanPerformAction_006953ac for the palette path.
  canPerform: boolean;
  // The stock (row 4) as the decide sees it.
  stock: number;
  // The status count of the row (rows 0..3).
  status: number;
  playerId: number;
  map: number;
  managerExists: boolean;
}
export interface TrapDecision {
  kind: 'none' | 'cancel' | 'palette' | 'trap';
  close: boolean;
  sound: number | null;
  // The 6x60 subcommand 0x83 body for the palette path (ASSUMED layout: command, size 2,
  // then u16 player id, u16 row, u16 count; exe at HandleSpecialPaletteInput, dump 576703).
  packet: { sub: number; size: number; playerId: number; row: number; count: number } | null;
  // The stock after a trap (DecrementCounterAndClamp_00697968, dump 578151).
  stockAfter: number | null;
}
const NO_DECISION: TrapDecision = { kind: 'none', close: false, sound: null, packet: null, stockAfter: null };
export function trapDecide(d: TrapDecideInput): TrapDecision {
  if (d.keyHeld13) return { kind: 'cancel', close: true, sound: QM_SOUND_CANCEL, packet: null, stockAfter: null };
  if (!d.actionAllowed) return NO_DECISION;
  if (d.row !== TRAP_STOCK_ROW) {
    // HandleSpecialPaletteInput: not blocked, the element gate, can perform, count > 0.
    const sent = !d.paletteBlocked && d.uiGate && d.canPerform && d.status > 0;
    if (!sent) return NO_DECISION;
    return {
      kind: 'palette',
      close: true,
      sound: null,
      packet: { sub: 0x83, size: 2, playerId: d.playerId, row: d.row, count: d.status },
      stockAfter: null,
    };
  }
  if (!canCreateChallengeTrapManager(d.map, d.managerExists)) return NO_DECISION;
  const after = d.stock - 1 >= 0 ? d.stock - 1 : 0;
  return { kind: 'trap', close: true, sound: null, packet: null, stockAfter: after };
}

// The weapon compare list (key 0xe held in state 1 of the weapon tab, dump 711680..711740).
// Opening creates the gui 2 list and clears bit 8 of the UI flags (g_pUITextColorTable +0x1c,
// `& 0xfff7`); closing sets it. The list's rows (the stat compare, EquipmentStatDisplayObject
// UpdateEquipState 0x72582a, dump 689800) are not ported.
export const QM_KEY_COMPARE = 0x0e;
export function compareToggle(open: boolean): { open: boolean; uiBit8Set: boolean } {
  return { open: !open, uiBit8Set: open };
}

// The technique swap (update_quickmenu case 0xa, dump 711875..711960). Key 0xe held: the first
// press marks the selected row (pending = selected); the second press swaps the two rows of
// the player's 19-entry technique order (SwapTechniqueSlots_00741d28, dump 712325) and clears
// the mark. `changed` is the list's +0x2c flag the swap sets.
export const TECHNIQUE_ORDER_LENGTH = 19;
export const SWAP_NONE = -1;
export interface TechniqueSwapStep {
  pending: number;
  order: number[];
  changed: boolean;
}
export function techniqueSwapKey(pending: number, selected: number, order: readonly number[]): TechniqueSwapStep {
  if (pending === SWAP_NONE) return { pending: selected, order: [...order], changed: false };
  const next = [...order];
  const tmp = next[pending];
  next[pending] = next[selected];
  next[selected] = tmp;
  return { pending: SWAP_NONE, order: next, changed: true };
}
export interface TechniqueRow {
  slot: number;
  techId: number;
}
export function techniqueRows(order: readonly number[]): TechniqueRow[] {
  return order.slice(0, TECHNIQUE_ORDER_LENGTH).map((techId, slot) => ({ slot, techId }));
}
