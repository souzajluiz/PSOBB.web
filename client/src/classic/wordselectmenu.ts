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
// The tables are the JP ws_data_jp.bin lists (net/wordselect.ts list1 / list2). Not ported: the
// state machine (WordSelectMenu_ProcessState_007023c8, about 30 handlers), the ListWindowEntity /
// WordSelectEntity drawing and cursor, the galgryphon effects, and the Shortcut / Symbol Chat
// wiring. See DEVLOG 2026-10-23 (word select picker, list model).

import type { WordSelectTable } from '../net/wordselect.ts';

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
