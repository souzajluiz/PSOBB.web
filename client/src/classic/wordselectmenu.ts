// Word select picker: the list model (no window yet). The exe's CreateWordSelectMenuEntity_00701d00
// (dump 658278) builds a ListWindowEntity from these lists; this module ports the parts that
// decide WHAT the picker lists, not how it draws or moves the cursor:
//   - get_word_select_type (dump 664227) and get_word_select_type_by_room_map_scene (664258):
//     the category index 0..12 of the scene and whether an item is selected;
//   - WordSelectMenuPopulateItemList_00705454 (dump 661816): the item list A (the selected item's
//     list, then table1[14]) and list B (the selected item's list only);
//   - InitializePlayerNameList_007060ec (dump 662571): the four player-name lists (0x2C4..0x2C8 are
//     the header / footer phrase tokens of those lists);
//   - GetItemMetaPointer_00705544 (dump 661927): the index -> list mapping, including the
//     pseudo indices (-0x28 list A, -0x2D list B, -0x3C / -0x46 / -0x50 / -0x5A the name lists).
//   - the selection buffer (the 0x1C WordSelectMessageT at menu +0xC4: AddSelection_00708108,
//     RemoveLastSelection_007080d0, PopSelection_007080ec, InitializeSelectionBounds_00708134),
//     UpdateSelectionEffect_00706fb0 (the toggle), IsValidSelection_0070706d, GetStringIdGroup_0070682c;
//   - WordSelectMenu_ProcessID_00707f40 (0x707f40, locale 0): the category of a chosen token
//     (the four groups in the exe's data at 0x9D06A0..0x9D06CC) and the table at 0x96EA38 that
//     gives the target type (+0xC6) and the next state (+0xB4) of the root (state 0) accept;
//   - ResetAndCloseMenus_00706c94 (0x706c94) copies the 0x1C buffer out, ResetAllMenus_00706da4
//     (0x706da4) does not (WordSelectPickerModel below).
// The tables are the JP ws_data_jp.bin lists (net/wordselect.ts list1 / list2).
// Also here (2026-10-23, the picker window): the state table at 0x9d05e0 (WORD_SELECT_ENTRIES), the
// root rows (table2[type]) and the child lists (table1[value], the scene placeholder -0x1E), the
// list levels that WordSelectPickerModel pushes and pops (ProcessNextEntry / NavigateBack). The
// picker window is classic/wordselectwindow.ts. Not ported: the numeric count window (state 3 with
// GetStringIdGroup != 7), the item-based pseudo lists (-0x28 / -0x2D), the name lists in the picker,
// the multi-word path (Next, states 0x12 / 0x13), the galgryphon effects and sounds, and the
// ES/FR/DE/US locales. See DEVLOG 2026-10-23 (word select picker, window).

import { wordSelectPhrase, type WordSelectTable } from '../net/wordselect.ts';
import type { WordSelectMessage } from '../net/chatshortcut.ts';

// get_word_select_type_by_room_map_scene (dump 664258) return values (the WS_* enum).
export type WordSelectScene = 'pioneer2' | 'lobby' | 'battle' | 'challenge' | 'quest' | 'free';

// get_word_select_type (dump 664227): the scene's base index, plus 1 when an item is selected
// (the item id at +0x1C is not -1). Base: lobby 1, Pioneer 2 3, free field 5, in quest 7,
// battle 9, challenge 0xB; anything else (no scene) 0.
export function wordSelectType(scene: WordSelectScene, hasSelectedItem: boolean): number {
  const base = {
    lobby: 1,
    pioneer2: 3,
    free: 5,
    quest: 7,
    battle: 9,
    challenge: 0xb,
  }[scene] ?? 0;
  return base + (hasSelectedItem ? 1 : 0);
}

// get_word_select_type_by_room_map_scene (dump 664258), in the exe's order: Pioneer 2 map, lobby
// map, battle mode, a challenge object, a quest (+0xA0 set), else the free field.
export function wordSelectScene(p: {
  pioneer2: boolean;
  lobby: boolean;
  battleMode: boolean;
  challenge: boolean;
  inQuest: boolean;
}): WordSelectScene {
  if (p.pioneer2) return 'pioneer2';
  if (p.lobby) return 'lobby';
  if (p.battleMode) return 'battle';
  if (p.challenge) return 'challenge';
  if (p.inQuest) return 'quest';
  return 'free';
}

// The JP table indices (LoadLocaleData_00705eb8 JP: g_ListItemCount 0x11A, item count 0x12;
// WordSelectMenuPopulateItemList: the item table is GetWordSelectItemDataPtr(0x11)).
export const WORD_SELECT_JP_ITEM_TABLE_INDEX = 0x11;
// The category list the item list reads (table1 entry 14, GetItemMetaPointer(0xE)).
export const WORD_SELECT_LIST_E = 0xe;
// The first selectable item id in the item table (SetSelectedItemID range 0x7E < id < 0x139).
export const WORD_SELECT_ITEM_BASE = 0x7f;
// The phrase tokens of the player-name lists (InitializePlayerNameList_007060ec).
export const WORD_SELECT_TOKEN_PLAYER_FIRST = 0x68c;
export const WORD_SELECT_TOKEN_NAMES_HEAD = 0x2c4;
export const WORD_SELECT_TOKEN_NAME_SELF = 0x2c7;
// The item list holds at most 0x20 entries (the A / B loops compare with 0x20 / 0x1F).
export const WORD_SELECT_LIST_CAP = 0x20;
// The player name list holds at most 14 other players (the loop breaks when iVar9 reaches 0xF).
const PLAYER_LIST_CAP = 14;

// The pseudo indices GetItemMetaPointer_00705544 maps to the menu's own lists.
export const WORD_SELECT_META = {
  listA: -0x28, // g_pWordSelectListItemMeta + 0x00 (PopulateItemList list A)
  listB: -0x2d, // + 0x08 (list B: the selected item's list only)
  nameHead: -0x3c, // + 0x10 (0x2C7 then the other players)
  nameList: -0x46, // + 0x18 (0x2C4, players, 0x2C5, 0x2C6, 0x2C7)
  nameWithNext: -0x50, // + 0x20 (0x2C4, players, 0x2C7, 0x2C8)
  nameSimple: -0x5a, // + 0x28 (0x2C4, players, 0x2C7)
} as const;

// GetItemMetaPointer_00705544 for a table1 index (or the JP special -0x32 = table1[0x118]).
// Returns the list, or null for the exe's NULL (-1 and the unknown negatives, or a table1 index past
// the JP count).
export function wordSelectListAt(table: WordSelectTable | null, index: number): number[] | null {
  if (!table) return null;
  if (index === -1) return null;
  if (index === -0x32) return table.list1[0x118] ?? null; // ListItemDataBase + 0x8C0 (JP)
  if (index >= 0 && index < table.list1.length) return table.list1[index];
  return null;
}

// The item list for a selected item id: table2[0x11][id - 0x7F] (a u16, read as short) gives the
// table1 index. Null when the id is outside the item table (WordSelectMenuPopulateItemList's check).
export function wordSelectItemList(table: WordSelectTable | null, selectedItem: number): number[] | null {
  if (!table) return null;
  const items = table.list2[WORD_SELECT_JP_ITEM_TABLE_INDEX];
  if (!items) return null;
  const at = selectedItem - WORD_SELECT_ITEM_BASE;
  if (at < 0 || at >= items.length) return null;
  const value = (items[at] << 16) >> 16; // the exe reads the u16 as a short
  return wordSelectListAt(table, value);
}

// WordSelectMenuPopulateItemList_00705454 (dump 661816): list A is the selected item's list
// (up to 0x20), then table1[14] appended to the cap; list B is the item's list alone.
export function populateWordSelectItemLists(table: WordSelectTable | null, selectedItem: number): { listA: number[]; listB: number[] } {
  const listA: number[] = [];
  const listB: number[] = [];
  const item = wordSelectItemList(table, selectedItem);
  if (item && item.length > 0) {
    for (let k = 0; k < item.length; k++) {
      listA.push(item[k]);
      listB.push(item[k]);
      if (listA.length >= WORD_SELECT_LIST_CAP) break;
    }
  }
  const category = wordSelectListAt(table, WORD_SELECT_LIST_E) ?? [];
  for (let k = 0; k < category.length; k++) {
    if (listA.length > WORD_SELECT_LIST_CAP - 1) break;
    listA.push(category[k]);
  }
  return { listA, listB };
}

// InitializePlayerNameList_007060ec (dump 662571). `players(slot)` is the player in slot 0..11, or
// null for an empty slot. The name of each slot is `names(slot)` (the exe copies up to 0x18 characters;
// that is done by the caller). The other players' tokens are 0x68C + slot for every filled slot that
// is not `currentSlot`; an empty slot adds no token.
export interface WordSelectNameLists {
  nameHead: number[]; // 0x2C7, the other players
  nameList: number[]; // 0x2C4, the players, 0x2C5, 0x2C6, 0x2C7
  nameWithNext: number[]; // 0x2C4, the players, 0x2C7, 0x2C8
  nameSimple: number[]; // 0x2C4, the players, 0x2C7
  playerTokens: number[]; // the other players' tokens alone
}

export function wordSelectNameLists(filled: (slot: number) => boolean, currentSlot: number): WordSelectNameLists {
  const players: number[] = [];
  for (let slot = 0; slot < 12; slot++) {
    if (!filled(slot)) continue;
    if (slot === currentSlot) continue;
    players.push(WORD_SELECT_TOKEN_PLAYER_FIRST + slot);
    if (players.length >= PLAYER_LIST_CAP) break;
  }
  const head = WORD_SELECT_TOKEN_NAMES_HEAD;
  return {
    nameHead: [WORD_SELECT_TOKEN_NAME_SELF, ...players],
    nameList: [head, ...players, 0x2c5, 0x2c6, 0x2c7],
    nameWithNext: [head, ...players, 0x2c7, 0x2c8],
    nameSimple: [head, ...players, 0x2c7],
    playerTokens: players,
  };
}

// The name-list lookup for the pseudo indices (GetItemMetaPointer_00705544's -0x3C / -0x46 /
// -0x50 / -0x5A): the list an entry of the picker reads.
export function wordSelectNameListAt(lists: WordSelectNameLists, index: number): number[] | null {
  switch (index) {
    case WORD_SELECT_META.nameHead:
      return lists.nameHead;
    case WORD_SELECT_META.nameList:
      return lists.nameList;
    case WORD_SELECT_META.nameWithNext:
      return lists.nameWithNext;
    case WORD_SELECT_META.nameSimple:
      return lists.nameSimple;
    default:
      return null;
  }
}

// ---- Selection buffer (the 0x1C WordSelectMessageT at menu +0xC4) ----
// The exe's layout (the same bytes the 6x74 sender copies): u16 count at +0, u16 target type at +2,
// u16 tokens[8] at +4 (short index 2..9; a free slot is 0xFFFF), u32 numeric parameter at +0x14
// (GetWordSelectEntryId_0070811c / WordSelectMenu_SetCurrentItemID_00708120), u32 at +0x18.
// Values here are the signed shorts the exe compares; -1 is the free slot.
export const WORD_SELECT_TOKEN_FREE = -1;
export const WORD_SELECT_MAX_TOKENS = 8;

export interface WordSelectSelection {
  count: number;
  targetType: number;
  tokens: number[]; // 8 entries, -1 free
  numericParameter: number;
  unknownA4: number;
}

// WordselectmenuInitializeSelectionBounds_00708134 (dump 0x708134): count 0, type 0, tokens -1,
// numeric 0, +0x18 0.
export function newWordSelectSelection(): WordSelectSelection {
  return {
    count: 0,
    targetType: 0,
    tokens: new Array(WORD_SELECT_MAX_TOKENS).fill(WORD_SELECT_TOKEN_FREE),
    numericParameter: 0,
    unknownA4: 0,
  };
}

// WordSelectMenu_AddSelection_00708108: with a count above 0, the top token is overwritten.
export function addSelection(sel: WordSelectSelection, value: number): void {
  if (sel.count > 0) sel.tokens[sel.count - 1] = value;
}

// WordSelectMenu_RemoveLastSelection_007080d0 (the push): below the 8-token cap, the value goes on
// top and the count rises. The exe's name; the effect is a push.
export function pushSelection(sel: WordSelectSelection, value: number): void {
  if (sel.count < WORD_SELECT_MAX_TOKENS) {
    sel.tokens[sel.count] = value;
    sel.count++;
  }
}

// WordSelectMenu_PopSelection_007080ec: with a count above 0, the top token is cleared (-1) and
// the count falls.
export function popSelection(sel: WordSelectSelection): void {
  if (sel.count > 0) {
    sel.count--;
    sel.tokens[sel.count] = WORD_SELECT_TOKEN_FREE;
  }
}

// WordSelectMenu_IsItemInCategory_00707095 (0x707095): 0x36 < id < 0x46.
export function isItemInCategory(id: number): boolean {
  return id > 0x36 && id < 0x46;
}

// WordSelectMenu_IsValidSelection_0070706d (0x70706d): the id is not 0x2C8 and not in the category.
export function isValidSelection(id: number): boolean {
  return id !== 0x2c8 && !isItemInCategory(id);
}

// WordSelectMenu_UpdateSelectionEffect_00706fb0 (0x706fb0): run when the cursor's value changes.
// Toggle 0 (+0x98 clear): a valid value is pushed and the toggle sets; an invalid one is added over
// the top. Toggle 1: a valid value is added over the top; an invalid one pops and clears the toggle.
// `last` is the value seen last (+0x9C, -1 at the start).
export interface SelectionEffectState {
  toggle: number; // +0x98
  last: number; // +0x9C
}

export function newSelectionEffectState(): SelectionEffectState {
  return { toggle: 0, last: -1 };
}

export function updateSelectionEffect(sel: WordSelectSelection, fx: SelectionEffectState, value: number): void {
  if (value === fx.last) return;
  if (fx.toggle === 0) {
    if (!isValidSelection(value)) {
      addSelection(sel, value);
    } else {
      pushSelection(sel, value);
      fx.toggle = 1;
    }
  } else if (fx.toggle === 1) {
    if (!isValidSelection(value)) {
      popSelection(sel);
      fx.toggle = 0;
    } else {
      addSelection(sel, value);
    }
  }
  fx.last = value;
}

// WordSelectMenu_GetStringIdGroup_0070682c (0x70682c): 0x2E4 -> 0; 0x2FF < id < 0x396 -> 1;
// 0x45C < id < 0x470 except 0x46D, 0x46E -> 2; 0x4F3 -> 3; 0x635 -> 4; 0x650 -> 5; else 7.
export function stringIdGroup(id: number): number {
  if (id === 0x2e4) return 0;
  if (id > 0x2ff && id < 0x396) return 1;
  if (id > 0x45c && id < 0x470 && id !== 0x46d && id !== 0x46e) return 2;
  if (id === 0x4f3) return 3;
  if (id === 0x635) return 4;
  if (id === 0x650) return 5;
  return 7;
}

// WordSelectMenu_CanCancel_007028a8 (0x7028a8) and the confirm check: a chosen id whose group is
// not 7 opens the numeric count window (the sub-state at +0xB8); the port keeps only the test.
export function canConfirmSelection(id: number): boolean {
  return stringIdGroup(id) !== 7;
}

// IsItemInSpecialCategory_00706470 (0x706470): 0x5AB < id < 0x5FA (the state 0x14 branch).
export function isItemInSpecialCategory(id: number): boolean {
  return id > 0x5ab && id < 0x5fa;
}

// ---- Root category (WordSelectMenu_ProcessID_00707f40, dump 0x707f40, locale 0) ----
// The four groups: each has a list of tokens (the exe's data at 0x96EA68..0x96EA80, counts at
// 0x96EA84..0x96EA90), and a config id (0x9D06A8, B4, C0, CC). A token in a group gives that
// group's id; the id 2 is 1 in the JP locale; no match gives 5.
export const WORD_SELECT_CATEGORY_GROUPS: { tokens: number[]; configId: number }[] = [
  { tokens: [0x0b], configId: 0 }, // 0x96EA68
  { tokens: [0x0c], configId: 2 }, // 0x96EA6C
  { tokens: [0x0d], configId: 3 }, // 0x96EA70
  { tokens: [0x02, 0x0f, 0x18, 0x2f], configId: 4 }, // 0x96EA74
];
export const WORD_SELECT_CATEGORY_NONE = 5;

// The table at 0x96EA38: [category] = [target type (ProcessIDIndex0, +0xC6), next state
// (ProcessIDIndex1, +0xB4)]. Read from the exe: 2,5 / 3,7 / 4,12 / 6,2 / 1,3 / 1,1.
export const WORD_SELECT_ROOT_TABLE: readonly (readonly [number, number])[] = [
  [2, 5],
  [3, 7],
  [4, 12],
  [6, 2],
  [1, 3],
  [1, 1],
];

// The category index of a token (ProcessID's loop); `jpLocale` is word_select_locale == 0.
export function wordSelectCategory(token: number, jpLocale: boolean): number {
  for (const group of WORD_SELECT_CATEGORY_GROUPS) {
    if (group.tokens.includes(token)) {
      if (group.configId === 2 && jpLocale) return 1;
      return group.configId;
    }
  }
  return WORD_SELECT_CATEGORY_NONE;
}

// WordSelectMenu_ProcessIDIndex0_00707280 and ProcessIDIndex1_00707294 for a token.
export function wordSelectRootTransition(token: number, jpLocale: boolean): { targetType: number; next: number; category: number } {
  const category = wordSelectCategory(token, jpLocale);
  const row = WORD_SELECT_ROOT_TABLE[category];
  return { targetType: row[0], next: row[1], category };
}

// ---- The state table (DAT_009d05e0) and the list levels ----
// Each state is 8 bytes: flags u32, then a token u32 (0xFFFF = none). The flags: 1 selected style,
// 2 the selection pops when the state is left, 4 a child list is pushed, 8 no child. Read with
// `tools/exedata.py read 0x9d05e0 u 42` (21 states, 0..0x14). Used through GetWordSelectMenuEntryPtr_00706e40.
export const WORD_SELECT_FLAG_SELECTED_STYLE = 1;
export const WORD_SELECT_FLAG_POPS_SELECTION = 2;
export const WORD_SELECT_FLAG_CHILD = 4;
export const WORD_SELECT_FLAG_NO_CHILD = 8;
export const WORD_SELECT_ENTRIES: readonly { flags: number; token: number }[] = [
  [4, 1671], [3, -1], [11, -1], [3, -1], [3, -1], [2, 1673], [3, -1], [4, 1674], [2, -1], [2, -1], [3, -1],
  [11, -1], [4, 1674], [2, 1675], [2, -1], [2, -1], [11, -1], [2, 1672], [2, -1], [11, -1], [11, 1672],
].map(([flags, token]) => ({ flags, token }));

// The scene placeholder row (-0x1E in the root list) opens the scene's own list (GetWordSelectItemId
// -0x1E mapping in WordSelectEntity_GetSelectedItemId_00705614, case 0).
export const WORD_SELECT_SCENE_PLACEHOLDER = -0x1e;
export const WORD_SELECT_SCENE_LIST: Record<WordSelectScene, number> = {
  pioneer2: 0x10,
  lobby: 0x0f,
  quest: 0x12,
  free: 0x11,
  battle: 0x13,
  challenge: 0x14,
};

// The root rows of a word type: table2[type] (WordSelectMenuPopulateItemList's sibling, the
// GetWordSelectItemId list). Each value is a table1 index (the child list) and the phrase of the same
// number is the row's label (checked against the JP table: 23 is "Fixed: Greetings" and table1[23]
// holds the greetings).
export function wordSelectRootRows(table: WordSelectTable | null, type: number): number[] {
  return table?.list2[type] ? [...table.list2[type]] : [];
}

// The child list a row opens: table1[value] (GetItemMetaPointer_00705544), the scene list for the
// placeholder. Empty when the row has no list (the exe's NULL). ASSUMED: the item-based pseudo lists
// (-0x28 list A, -0x2D list B) and the player-name lists are not opened here.
export function wordSelectChildRows(table: WordSelectTable | null, value: number, scene: WordSelectScene = 'free'): number[] {
  const index = value === WORD_SELECT_SCENE_PLACEHOLDER ? WORD_SELECT_SCENE_LIST[scene] : value;
  return wordSelectListAt(table, index) ?? [];
}

// The row's text: the phrase of the value (a token of a child list, or a root value). A player token
// (0x68C + slot) is the player's name; the placeholder has no text (ASSUMED: the exe's label is not
// traced). Phrases with line breaks show their first line.
export function wordSelectRowLabel(table: WordSelectTable | null, value: number, names: (slot: number) => string): string {
  if (value === WORD_SELECT_SCENE_PLACEHOLDER || value < 0) return '';
  if (value >= WORD_SELECT_TOKEN_PLAYER_FIRST) return names(value - WORD_SELECT_TOKEN_PLAYER_FIRST);
  return wordSelectPhrase(table, value).split('\n')[0] ?? '';
}

// ---- The picker model (the parts above, joined by the close and cancel exits) ----
// The levels are the child-list stack (ProcessNextEntry pushes, NavigateBack pops): the root is
// level 0, and a row's child list is the next level. The caller reads the rows and the cursor,
// moves the cursor and presses accept / back; the window draws it (classic/wordselectwindow.ts).
export const WORD_SELECT_STATUS_OPEN = 0;
export const WORD_SELECT_STATUS_ACCEPTED = 2; // ResetAndCloseMenus_00706c94 (+0xA8 = 2)
export const WORD_SELECT_STATUS_CANCELLED = 3; // ResetAllMenus_00706da4 (+0xA8 = 3)

export interface WordSelectLevel {
  value: number; // the row this level opened from (-1 at the root)
  rows: number[];
  index: number; // the cursor on this level
}

export interface WordSelectPickerOptions {
  type: number; // get_word_select_type (the root list's table2 index)
  numericParameter?: number;
  table?: WordSelectTable | null;
  scene?: WordSelectScene; // the placeholder row's list (default free field)
  jpLocale?: boolean; // word_select_locale == 0 (the only locale read)
}

export class WordSelectPickerModel {
  readonly sel: WordSelectSelection = newWordSelectSelection();
  readonly fx: SelectionEffectState = newSelectionEffectState();
  state = 0; // +0xB0 (the root; the state of the top level)
  next = 0; // +0xB4
  status = WORD_SELECT_STATUS_OPEN; // +0xA8
  readonly itemType: number; // +0x88: get_word_select_type (the item table index base)
  readonly table: WordSelectTable | null;
  readonly scene: WordSelectScene;
  readonly jpLocale: boolean;
  readonly levels: WordSelectLevel[];

  constructor(p: WordSelectPickerOptions) {
    this.itemType = p.type;
    this.sel.numericParameter = p.numericParameter ?? 0;
    this.sel.targetType = 0;
    this.table = p.table ?? null;
    this.scene = p.scene ?? 'free';
    this.jpLocale = p.jpLocale ?? true;
    this.levels = [{ value: -1, rows: wordSelectRootRows(this.table, p.type), index: 0 }];
  }

  get depth(): number {
    return this.levels.length - 1;
  }

  get top(): WordSelectLevel {
    return this.levels[this.levels.length - 1];
  }

  get rows(): number[] {
    return this.top.rows;
  }

  // The value under the cursor (WordSelectMenu_GetSelectedEntryValue; -1 for an empty list).
  get cursorValue(): number {
    return this.top.rows[this.top.index] ?? WORD_SELECT_TOKEN_FREE;
  }

  // The cursor moves by `delta` and wraps. The toggle effect runs on the child levels only (the
  // root's state 0 has no UpdateSelectionEffect call).
  move(delta: number): void {
    if (this.status !== WORD_SELECT_STATUS_OPEN) return;
    const n = this.top.rows.length;
    if (n === 0) return;
    this.top.index = (this.top.index + delta + n) % n;
    if (this.depth > 0) this.cursor(this.cursorValue);
  }

  // The cursor's value is reported (UpdateSelectionEffect is called on each change).
  cursor(value: number): void {
    updateSelectionEffect(this.sel, this.fx, value);
  }

  // The root accept (State0_Update_007031b4): the chosen token's category sets the target type and
  // the next state. Returns false when the picker is not on the root.
  acceptRoot(token: number, jpLocale: boolean): boolean {
    if (this.state !== 0 || this.status !== WORD_SELECT_STATUS_OPEN) return false;
    const t = wordSelectRootTransition(token, jpLocale);
    this.sel.targetType = t.targetType;
    this.next = t.next;
    return true;
  }

  // Accept (the Select key). On the root, a row with a list opens it (the state becomes +0xB4 and the
  // child list is pushed); a root row without a list does nothing (ASSUMED). On a child level the
  // cursor's token stays in the buffer and the picker closes (ASSUMED: FinalizeSelection's close when
  // the state is not 1). Returns the copied-out message when the picker closed.
  press(): WordSelectMessage | null {
    if (this.status !== WORD_SELECT_STATUS_OPEN) return null;
    const v = this.cursorValue;
    if (this.depth === 0) {
      if (v === WORD_SELECT_TOKEN_FREE || !this.acceptRoot(v, this.jpLocale)) return null;
      const child = wordSelectChildRows(this.table, v, this.scene);
      if (child.length === 0) return null;
      this.state = this.next;
      this.fx.last = -1;
      this.levels.push({ value: v, rows: child, index: 0 });
      this.cursor(this.cursorValue);
      return null;
    }
    return this.close();
  }

  // Back (the Cancel key): a child level pops (NavigateBack_0070226c), and the leaf's token is
  // taken off again when the toggle put it there (ASSUMED: the pop of the state's flags 2). On the
  // root the picker is cancelled (ResetAllMenus).
  back(): void {
    if (this.status !== WORD_SELECT_STATUS_OPEN) return;
    if (this.depth === 0) {
      this.cancel();
      return;
    }
    this.levels.pop();
    if (this.fx.toggle === 1) {
      popSelection(this.sel);
      this.fx.toggle = 0;
    }
    this.fx.last = -1;
    this.state = 0;
    this.next = 0;
  }

  // ResetAndCloseMenus_00706c94: the 0x1C buffer is copied to the caller and the picker is accepted.
  close(): WordSelectMessage {
    this.status = WORD_SELECT_STATUS_ACCEPTED;
    return this.result();
  }

  // ResetAllMenus_00706da4: the picker is cancelled; nothing is copied out.
  cancel(): void {
    this.status = WORD_SELECT_STATUS_CANCELLED;
  }

  // The buffer as the 6x74 sender takes it (free slots keep 0xFFFF, as in the exe).
  result(): WordSelectMessage {
    return {
      numTokens: this.sel.count,
      targetType: this.sel.targetType,
      tokens: this.sel.tokens.map((t) => t & 0xffff),
      numericParameter: this.sel.numericParameter >>> 0,
      unknownA4: this.sel.unknownA4 >>> 0,
    };
  }
}

export function openWordSelectPicker(p: WordSelectPickerOptions): WordSelectPickerModel {
  return new WordSelectPickerModel(p);
}
