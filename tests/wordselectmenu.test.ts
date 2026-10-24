// Word select picker list model (client/src/classic/wordselectmenu.ts): the category index, the
// item list (WordSelectMenuPopulateItemList), the player-name lists (InitializePlayerNameList),
// and the JP table decode (table1 / table2 in net/wordselect.ts). The real ws_data_jp.bin is
// checked only when the client data folder has it. Run: node tests/wordselectmenu.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadWordSelectTable, type WordSelectTable } from '../client/src/net/wordselect.ts';
import {
  addSelection,
  canConfirmSelection,
  isItemInSpecialCategory,
  isValidSelection,
  newSelectionEffectState,
  newWordSelectSelection,
  openWordSelectPicker,
  popSelection,
  pushSelection,
  stringIdGroup,
  updateSelectionEffect,
  wordSelectCategory,
  wordSelectRootTransition,
  populateWordSelectItemLists,
  wordSelectItemList,
  wordSelectListAt,
  wordSelectNameLists,
  wordSelectNameListAt,
  wordSelectScene,
  wordSelectType,
  WORD_SELECT_JP_ITEM_TABLE_INDEX,
  WORD_SELECT_META,
} from '../client/src/classic/wordselectmenu.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// ---- get_word_select_type / scene ----
eq(wordSelectType('lobby', false), 1, 'lobby, no item: 1');
eq(wordSelectType('lobby', true), 2, 'lobby, item: 2');
eq(wordSelectType('pioneer2', false), 3, 'Pioneer 2: 3');
eq(wordSelectType('free', true), 6, 'free field, item: 6');
eq(wordSelectType('quest', false), 7, 'in quest: 7');
eq(wordSelectType('battle', true), 10, 'battle, item: 10');
eq(wordSelectType('challenge', false), 0xb, 'challenge: 0xB');
eq(wordSelectType('challenge', true), 0xc, 'challenge, item: 0xC');
const base = { pioneer2: false, lobby: false, battleMode: false, challenge: false, inQuest: false };
eq(wordSelectScene(base), 'free', 'no flag: the free field');
eq(wordSelectScene({ ...base, inQuest: true, lobby: true }), 'lobby', 'the lobby map wins over a quest');
eq(wordSelectScene({ ...base, battleMode: true, challenge: true }), 'battle', 'battle mode is checked before the challenge');
eq(wordSelectScene({ ...base, pioneer2: true, lobby: true }), 'pioneer2', 'the Pioneer 2 map is checked first');

// ---- a synthetic table (the lists are the decoded shape) ----
function mkTable(list1: number[][], list2: number[][]): WordSelectTable {
  return { tokenToPhrase: [], phrases: [], list1, list2 };
}
const list1: number[][] = [];
for (let i = 0; i < 0x11a; i++) list1.push([]);
list1[14] = [900, 901, 902]; // the category list (table1[14])
list1[56] = [10, 11, 12]; // item 0x7F's list
list1[57] = [20, 21];
list1[0x118] = [30, 31]; // the JP -0x32 entry (ListItemDataBase + 0x8C0)
const list2: number[][] = [];
for (let i = 0; i < 0x12; i++) list2.push([]);
// table2[17]: (item - 0x7F) -> table1 index; -1 (0xFFFF) is no list, -50 (0xFFCE) is the 0x118 entry.
list2[WORD_SELECT_JP_ITEM_TABLE_INDEX] = [56, 57, 0xffff, 0xffce];
const t = mkTable(list1, list2);

eq(wordSelectItemList(t, 0x7f), [10, 11, 12], 'item 0x7F -> table2[17][0] -> table1[56]');
eq(wordSelectItemList(t, 0x80), [20, 21], 'item 0x80 -> table1[57]');
eq(wordSelectItemList(t, 0x81), null, 'a -1 entry is NULL');
eq(wordSelectItemList(t, 0x82), [30, 31], 'a -50 entry is table1[0x118]');
eq(wordSelectItemList(t, 0x7e), null, 'an id below 0x7F is outside the item table');
eq(wordSelectItemList(t, 0x83), null, 'an id past the item table is NULL');
eq(wordSelectItemList(t, -1), null, 'no selected item (-1) is NULL');
eq(wordSelectListAt(t, -1), null, 'GetItemMetaPointer(-1) is NULL');
eq(wordSelectListAt(t, 0x11a), null, 'a table1 index past the JP count is NULL');

// WordSelectMenuPopulateItemList: A = item list, then table1[14] (to 0x20); B = item list only.
const pop = populateWordSelectItemLists(t, 0x7f);
eq(pop.listA, [10, 11, 12, 900, 901, 902], 'list A: the item, then the category');
eq(pop.listB, [10, 11, 12], 'list B: the item only');
const none = populateWordSelectItemLists(t, -1);
eq(none.listA, [900, 901, 902], 'no item: A is the category alone');
eq(none.listB, [], 'no item: B is empty');

// The cap: a 40-entry item list is cut at 0x20 in both lists, and the category adds nothing.
const big: number[] = Array.from({ length: 40 }, (_, i) => 100 + i);
const list1Big = list1.slice();
list1Big[56] = big;
const pb = populateWordSelectItemLists(mkTable(list1Big, list2), 0x7f);
eq(pb.listA.length, 0x20, 'list A is capped at 0x20');
eq(pb.listB.length, 0x20, 'list B is capped at 0x20');
eq(pb.listA.slice(-1), [131], 'list A keeps the first 0x20 of the item');

// The category fills A up to the cap: 0x1F item entries leave one slot for table1[14].
const list1Fill = list1.slice();
list1Fill[56] = Array.from({ length: 0x1f }, (_, i) => 200 + i);
const pf = populateWordSelectItemLists(mkTable(list1Fill, list2), 0x7f);
eq(pf.listA.length, 0x20, 'A with 0x1F item entries takes one category entry');
eq(pf.listA[0x1f], 900, 'the category entry is the first of table1[14]');
eq(pf.listB.length, 0x1f, 'B keeps the 0x1F item entries');

// ---- player name lists (InitializePlayerNameList_007060ec) ----
const filled = (s: number) => s === 0 || s === 2 || s === 5;
const names = wordSelectNameLists(filled, 2);
eq(names.playerTokens, [0x68c, 0x691], 'other players: slots 0 and 5 (the current slot 2 is skipped)');
eq(names.nameHead, [0x2c7, 0x68c, 0x691], 'the head list: 0x2C7 then the players');
eq(names.nameList, [0x2c4, 0x68c, 0x691, 0x2c5, 0x2c6, 0x2c7], 'the name list: 0x2C4, players, 0x2C5, 0x2C6, 0x2C7');
eq(names.nameWithNext, [0x2c4, 0x68c, 0x691, 0x2c7, 0x2c8], 'the with-next list ends 0x2C7, 0x2C8');
eq(names.nameSimple, [0x2c4, 0x68c, 0x691, 0x2c7], 'the simple list ends 0x2C7');
eq(wordSelectNameListAt(names, WORD_SELECT_META.nameList), names.nameList, 'GetItemMetaPointer(-0x46) is the name list');
eq(wordSelectNameListAt(names, WORD_SELECT_META.nameHead), names.nameHead, 'GetItemMetaPointer(-0x3C) is the head list');
const solo = wordSelectNameLists((s) => s === 3, 3);
eq(solo.nameHead, [0x2c7], 'alone: the head list is 0x2C7 only');
eq(solo.nameList, [0x2c4, 0x2c5, 0x2c6, 0x2c7], 'alone: the name list has no players');
const full = wordSelectNameLists(() => true, 0);
eq(full.playerTokens.length, 11, 'twelve filled slots: the other 11 players');
eq(full.playerTokens[0], 0x68d, 'the first other player is slot 1');

// ---- the real JP table (ws_data_jp.bin and unitxt_ws_j.prs in the client data folder) ----
const dataDir = join(homedir(), 'Downloads/psobb-client/data');
const dataFile = join(dataDir, 'ws_data_jp.bin');
const textFile = join(dataDir, 'unitxt_ws_j.prs');
if (existsSync(dataFile) && existsSync(textFile)) {
  const real = loadWordSelectTable(new Uint8Array(readFileSync(dataFile)), new Uint8Array(readFileSync(textFile)));
  eq(real.list1.length, 0x11a, 'JP table1 has 0x11A entries (LoadLocaleData g_ListItemCount)');
  eq(real.list2.length, 0x12, 'JP table2 has 0x12 entries (g_WordSelectItemCount)');
  eq(real.list2[WORD_SELECT_JP_ITEM_TABLE_INDEX].length, 186, 'JP table2[0x11] covers the item ids 0x7F..0x138');
  eq(real.list1[14].slice(0, 4), [99, 100, 101, 73], 'JP table1[14] starts 99, 100, 101, 73');
  eq(real.list1[14].length, 30, 'JP table1[14] has 30 entries');
  const first = real.list2[WORD_SELECT_JP_ITEM_TABLE_INDEX][0];
  eq(wordSelectItemList(real, 0x7f), real.list1[first], 'item 0x7F maps to table1[table2[0x11][0]]');
  const r = populateWordSelectItemLists(real, 0x7f);
  eq(r.listA.length > 0 && r.listA.length <= 0x20, true, 'JP item 0x7F: list A within the cap');
} else {
  console.log('SKIP wordselectmenu real JP table: client data not found');
}

// ---- selection buffer (0x1C at +0xC4) ----
{
  const s = newWordSelectSelection();
  eq([s.count, s.targetType, s.tokens], [0, 0, [-1, -1, -1, -1, -1, -1, -1, -1]], 'init: count 0, type 0, tokens free');
  addSelection(s, 5);
  eq(s.count, 0, 'add on an empty buffer does nothing');
  pushSelection(s, 0x10);
  pushSelection(s, 0x11);
  pushSelection(s, 0x12);
  eq([s.count, s.tokens.slice(0, 4)], [3, [0x10, 0x11, 0x12, -1]], 'push: tokens go on top and the count rises');
  addSelection(s, 0x20);
  eq(s.tokens.slice(0, 3), [0x10, 0x11, 0x20], 'add overwrites the top token');
  popSelection(s);
  eq([s.count, s.tokens[2]], [2, -1], 'pop clears the top and lowers the count');
  for (let i = 0; i < 10; i++) pushSelection(s, i);
  eq(s.count, 8, 'push stops at the 8-token cap');
  popSelection(newWordSelectSelection());
  eq(newWordSelectSelection().count, 0, 'pop on an empty buffer does nothing');
}

// ---- IsValidSelection / category / string groups ----
eq([isValidSelection(0x2c8), isValidSelection(0x40), isValidSelection(0x36), isValidSelection(0x46), isValidSelection(0x37)],
  [false, false, true, true, false], 'valid: not 0x2C8 and not 0x37..0x45');
eq([stringIdGroup(0x2e4), stringIdGroup(0x300), stringIdGroup(0x45d), stringIdGroup(0x46d), stringIdGroup(0x4f3), stringIdGroup(0x635), stringIdGroup(0x650), stringIdGroup(0x100)],
  [0, 1, 2, 7, 3, 4, 5, 7], 'string id groups (0x46D is excluded from group 2)');
eq([canConfirmSelection(0x2e4), canConfirmSelection(0x100)], [true, false], 'confirm needs a group other than 7');
eq([isItemInSpecialCategory(0x5ab), isItemInSpecialCategory(0x5ac), isItemInSpecialCategory(0x5f9), isItemInSpecialCategory(0x5fa)],
  [false, true, true, false], 'special category: 0x5AB < id < 0x5FA');

// ---- UpdateSelectionEffect toggle (0x706fb0) ----
{
  const s = newWordSelectSelection();
  const fx = newSelectionEffectState();
  updateSelectionEffect(s, fx, 0x40); // invalid (category), toggle 0: add (count 0, nothing)
  eq([s.count, fx.toggle, fx.last], [0, 0, 0x40], 'invalid with toggle 0 on an empty buffer: nothing pushed');
  updateSelectionEffect(s, fx, 0x100); // valid: push, toggle 1
  eq([s.count, s.tokens[0], fx.toggle], [1, 0x100, 1], 'valid value pushes and sets the toggle');
  updateSelectionEffect(s, fx, 0x101); // valid with toggle 1: add over the top
  eq([s.count, s.tokens[0]], [1, 0x101], 'valid value with toggle 1 overwrites the top');
  updateSelectionEffect(s, fx, 0x40); // invalid with toggle 1: pop, toggle 0
  eq([s.count, fx.toggle], [0, 0], 'invalid value with toggle 1 pops and clears the toggle');
  updateSelectionEffect(s, fx, 0x40);
  eq(s.count, 0, 'unchanged value does nothing');
}

// ---- ProcessID category and the root table (0x707f40, 0x96EA38) ----
eq([wordSelectCategory(0x0b, true), wordSelectCategory(0x0c, true), wordSelectCategory(0x0c, false), wordSelectCategory(0x0d, true)],
  [0, 1, 2, 3], 'categories: token 0x0B -> 0, 0x0C -> 1 (JP) or 2, 0x0D -> 3');
eq([2, 15, 24, 47].map((t) => wordSelectCategory(t, true)), [4, 4, 4, 4], 'tokens 2, 0x0F, 0x18, 0x2F -> category 4');
eq(wordSelectCategory(0x100, true), 5, 'no match: category 5');
eq(wordSelectRootTransition(0x0b, true), { targetType: 2, next: 5, category: 0 }, 'root 0: type 2, next 5');
eq(wordSelectRootTransition(0x0c, true), { targetType: 3, next: 7, category: 1 }, 'root 1 (JP): type 3, next 7');
eq(wordSelectRootTransition(0x0c, false), { targetType: 4, next: 12, category: 2 }, 'root 2: type 4, next 12');
eq(wordSelectRootTransition(0x0d, true), { targetType: 6, next: 2, category: 3 }, 'root 3: type 6, next 2');
eq(wordSelectRootTransition(0x0f, true), { targetType: 1, next: 3, category: 4 }, 'root 4: type 1, next 3');
eq(wordSelectRootTransition(0x100, true), { targetType: 1, next: 1, category: 5 }, 'root 5: type 1, next 1');

// ---- the picker model: open, cursor, root accept, close / cancel ----
{
  const p = openWordSelectPicker({ type: 1 });
  eq([p.state, p.status, p.itemType, p.sel.count], [0, 0, 1, 0], 'open: root state, open status, type 1, empty');
  p.cursor(0x100);
  p.cursor(0x101);
  eq([p.sel.count, p.sel.tokens[0]], [1, 0x101], 'cursor moves update the buffer');
  p.cursor(0x40);
  eq(p.sel.count, 0, 'cursor on a category row pops the toggled word');
  eq(p.acceptRoot(0x0b, true), true, 'root accept');
  eq([p.sel.targetType, p.next], [2, 5], 'root accept sets the target type and next state');
  p.sel.tokens[0] = 0x100;
  p.sel.count = 1;
  const msg = p.close();
  eq([p.status, msg.numTokens, msg.targetType, msg.tokens[0], msg.tokens[1]], [2, 1, 2, 0x100, 0xffff], 'close: accepted, message is the buffer (free slots 0xFFFF)');
  eq(msg.tokens.length, 8, 'close: 8 token slots');
  const q = openWordSelectPicker({ type: 9, numericParameter: 7 });
  q.cancel();
  eq([q.status, q.sel.count], [3, 0], 'cancel: cancelled status, nothing copied');
  eq(q.acceptRoot(0x0b, true), false, 'accept after cancel: the picker is no longer open, so no transition');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('wordselectmenu: all tests passed');
