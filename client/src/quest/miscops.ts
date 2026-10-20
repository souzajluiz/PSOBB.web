// Logic of the smaller quest opcodes that does not belong in the vm.ts switch:
// the inventory search (find_inventory_item / _ex), the keyword detector
// (enable_keyword_detect / check_for_keyword) and the enemy battle parameter
// overrides (set_override_enemy_bp_index / set_enemy_*_data).

import { BATTLE_PARAM_ROWS, BATTLE_PARAM_ROW_COUNT, type BattleParamKind } from '../formats/battleparams.ts';

// --- find_inventory_item ------------------------------------------------------

export interface QuestInventoryItem {
  id: number;
  data1: ArrayLike<number>;
}

// opcode_item_check / opcode_pl_chk_item2 (PsoBB.exe .c:606045 / .c:606082):
// the registers give data1[0..2] (and data1[3] of _ex, which becomes the
// compact item's fifth byte), FindItemInInventory_006a4e50 compares each
// inventory item with items_equal (.c:419047):
//   weapon (0)  data1[1], data1[2] and data1[4] equal
//   armor (1)   data1[1], data1[2]
//   mag (2)     data1[1]
//   tool (3)    data1[1], data1[2]; a tech disk (data1[1] == 2) also data1[4]
//   meseta (4)  data1[1]
// The plain form leaves data1[4] at 0 (reset_item_data), so it finds weapons
// without a special and discs of level 1 only; newserv's QuestScript.cc says
// the same. The result is the item id, or 0xFFFFFFFF.
// ASSUMED: the compact representation's fifth byte is data1[4] (the exe reads
// it through a vtable call that the dump does not resolve); items on the
// ground near the player, which FindItemInInventory also walks, are not
// searched.
export function findInventoryItem(items: readonly QuestInventoryItem[], want: readonly number[], ex: boolean): number {
  const w = [want[0] & 0xff, want[1] & 0xff, want[2] & 0xff];
  const w4 = ex ? want[3] & 0xff : 0;
  for (const it of items) {
    const d = it.data1;
    if ((d[0] & 0xff) !== w[0] || (d[1] & 0xff) !== w[1]) continue;
    const type = w[0];
    if (type === 0 && ((d[2] & 0xff) !== w[2] || (d[4] & 0xff) !== w4)) continue;
    if (type === 1 && (d[2] & 0xff) !== w[2]) continue;
    if (type === 3 && ((d[2] & 0xff) !== w[2] || (w[1] === 2 && (d[4] & 0xff) !== w4))) continue;
    if (type > 4) continue;
    return it.id >>> 0;
  }
  return 0xffffffff;
}

// --- get_gender ----------------------------------------------------------------

// opcode_get_gender (.c:608085): 0 male, 1 female, 2 when there is no such
// player or it is neither. Class numbers are the 0..11 of the character file
// (newserv: HUmar HUnewearl HUcast RAmar RAcast RAcaseal FOmarl FOnewm
// FOnewearl HUcaseal FOmar RAmarl).
const FEMALE_CLASSES = new Set([1, 5, 6, 8, 9, 11]);
export function genderOfClass(charClass: number): number {
  return charClass < 0 || charClass > 11 ? 2 : FEMALE_CLASSES.has(charClass) ? 1 : 0;
}

// --- keyword detection -----------------------------------------------------------

// The quest keyword detect object (InitializeQuestKeywordDetectObject_00616928,
// SetQuestKeywordString_00616a2c, UpdateQuestKeywordDetectObject_00616a04,
// CheckQuestKeywordMatch_00616a64, FindKeywordIndexInList_00814028): it keeps
// the last chat line of each of the four players for 0x78 updates. It exists
// only after enable_keyword_detect, so chat said before that is lost and
// check_for_keyword answers 0.
export const KEYWORD_LIFETIME = 0x78;

export class KeywordDetector {
  private enabled = false;
  private readonly lines: Array<{ text: string; ttl: number }> = [0, 1, 2, 3].map(() => ({ text: '', ttl: 0 }));

  enable(): void {
    this.enabled = true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  // The player said `text` (chat packet / ProcessChatMessageForQuest_006b96a4).
  say(clientId: number, text: string): void {
    if (!this.enabled || clientId < 0 || clientId >= 4) return;
    this.lines[clientId] = { text, ttl: KEYWORD_LIFETIME };
  }

  // One tick: lines that reach 0 are erased.
  update(): void {
    for (const l of this.lines) {
      if (l.ttl !== 0 && --l.ttl === 0) l.text = '';
    }
  }

  // opcode_Keyword: the keyword is cut at its first newline / vertical tab
  // and at 32 characters; the line is lowercased (ASCII only) and padded with a
  // space on both sides, and the keyword matches anywhere inside it. So a
  // keyword with a leading and trailing space matches a whole word.
  check(clientId: number, keyword: string): boolean {
    if (!this.enabled || clientId < 0 || clientId >= 4) return false;
    let k = keyword.slice(0, 32);
    const cut = k.search(/[\n\v]/);
    if (cut >= 0) k = k.slice(0, cut);
    if (k === '') return false;
    const line = ` ${this.lines[clientId].text.slice(0, 0xfd).replace(/[A-Z]/g, (c) => c.toLowerCase())} `;
    return line.includes(k);
  }
}

// --- enemy battle parameter overrides ---------------------------------------------

// The label data of each set_enemy_*_data opcode: 0x24 bytes of PlayerStats,
// 0x30 of AttackData, 0x20 of ResistData, 0x30 of MovementData.
export const BP_OPCODES: Record<string, BattleParamKind> = {
  set_enemy_physical_data: 'physical',
  set_enemy_attack_data: 'attack',
  set_enemy_resist_data: 'resist',
  set_enemy_movement_data: 'movement',
};

// The bytes at `offset` of the quest, or null when they run past the file
// (the exe would read whatever follows).
export function readBattleParamRow(data: Uint8Array, offset: number, kind: BattleParamKind): Uint8Array | null {
  const size = BATTLE_PARAM_ROWS[kind].size;
  if (offset < 0 || offset + size > data.length) return null;
  return data.slice(offset, offset + size);
}

// maybe_valid_bp_index (.c:751989).
export function validBpIndex(index: number): boolean {
  return index >= 0 && index < BATTLE_PARAM_ROW_COUNT;
}
