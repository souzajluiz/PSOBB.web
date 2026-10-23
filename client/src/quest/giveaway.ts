// The Pioneer 2 Present Counter (bb_p2_menu 8, "GIVEAWAY" in newserv): the
// Momoka item exchange. The quest header's create-item mask table holds the
// exchange: entry 0 is the item the player hands in (data1[0..2], its count in
// data1[5]), entries 1.. are the items offered back (the run of entries with
// a non-zero data1[0..2] stops the list). PsoBB.exe:
//   - the counter: MedicalCenterDialog_Constructor_006ca84c (reads
//     g_CurrentQuestPointer->+0x19c + 0x42c, stride 0x38, the list at +0x3c,
//     the hand-in item at +0x40, its count at +0x50);
//   - its states (vtable state machine BankDialog_StateMachineHandler_006ca4b8):
//     0 open (BankDialog state 0 handler 0x006cad20: welcome, window 332 x 80),
//     1 the list (0x006cab9c), 2 the list's keys (0x006ca7a8), 3 Is that OK?
//     (0x006ca660), 4 cancel (0x006ca600), 5 the send (send_packet0x60_subcommand0xd9
//     .c:624905), 6 the answer (0x006caa90), 7 / 8 the last message and close;
//   - the answer: handle_ship_packet0x23 (.c:814163) stores the 0x23 flag and
//     sets g_BankDialogPendingFlag; 6 waits up to 30 s (time_t > 0x1e) and
//     shows 0x53 (0), 0x50 (1, "you don't have an X"), 0x55 (2, inventory full)
//     or 0x56 (other); the timeout shows 0x57;
//   - the texts: unitxt_shop group 0, 0x4e title "Present Counter" .. 0x58.
// F95B (bb_replace_item, opcode_unknownF95B .c:611678) sends the same 6xD9 from
// a quest script; its labels are sent as given, and the exe never takes them
// back (the 0x23 handler only stores the flag).
//
// Quests without the 0x122C header (Qedit's 0x398 files) have no table: the
// exe reads the same zeros there, so the counter has nothing to offer.

import type { ItemData } from '../formats/itemnames.ts';

export const PRESENT_TABLE_OFFSET = 0x42c; // CreateItemMaskEntry create_item_mask_entries[0]
export const PRESENT_ENTRY_SIZE = 0x38;
export const PRESENT_ENTRIES = 0x40;
// The exe's wait for the 0x23 answer: the state 6 check is "more than 30 s" (0x1e).
export const PRESENT_TIMEOUT_MS = 30_000;

// unitxt_shop group 0 lines of the counter (the exe's message indices).
export const PRESENT_TEXT = {
  title: 0x4e,
  welcome: 0x4f,
  missing: 0x50, // "you don't have an %s" (0x23 result 1)
  offer: 0x51, // "I can exchange your %s for you..." (%s = the hand-in item)
  ok: 0x52, // "Is that OK?" (the yes / no)
  thanks: 0x53, // 0x23 result 0
  changed: 0x54, // "Did you change your mind?" (no)
  full: 0x55, // 0x23 result 2
  failed: 0x56, // any other result
  timeout: 0x57, // no answer in time
  reminder: 0x58, // "When you obtain an %s, please bring it to me" (%s = the hand-in item)
} as const;

export type ItemBytes = [number, number, number];

// bb_replace_item's arguments as the VM passes them: the two packed items
// (argItemBytes), the tokens already xored with the slot, the two labels.
export interface MomokaExchangeRequest {
  find: number;
  replace: number;
  token1: number;
  token2: number;
  label1: number;
  label2: number;
}

export interface PresentOffer {
  find: ItemBytes; // data1[0..2] of the item the player hands in
  findCount: number; // the count the table gives it (data1[5]); the exe sends it raw
  rewards: ItemBytes[]; // data1[0..2] of each offered item, in table order
  rewardCount: number; // the count every offered item carries (findCount, or 1 when 0)
}

// The exchange of a quest header's mask table (quest .bin at 0x42c), or null
// when there is none. `fullHeader` is QuestBinHeader.hasFullHeader.
export function presentOffer(data: Uint8Array, fullHeader: boolean): PresentOffer | null {
  if (!fullHeader || data.length < PRESENT_TABLE_OFFSET + PRESENT_ENTRY_SIZE) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const at = (i: number) => PRESENT_TABLE_OFFSET + i * PRESENT_ENTRY_SIZE;
  // The exe tests the three dwords data1[0..2] of an entry, not their bytes.
  const live = (i: number) => {
    const o = at(i);
    if (o + PRESENT_ENTRY_SIZE > data.length) return false;
    return dv.getUint32(o, true) !== 0 || dv.getUint32(o + 4, true) !== 0 || dv.getUint32(o + 8, true) !== 0;
  };
  const bytes = (i: number): ItemBytes => {
    const o = at(i);
    return [data[o], data[o + 4], data[o + 8]];
  };
  if (!live(0)) return null;
  const findCount = dv.getUint32(at(0) + 0x14, true);
  const rewards: ItemBytes[] = [];
  for (let i = 1; i < PRESENT_ENTRIES && live(i); i++) rewards.push(bytes(i));
  if (rewards.length === 0) return null;
  return { find: bytes(0), findCount, rewards, rewardCount: findCount || 1 };
}

// An ItemData with only data1[0..2] set, the id 0 and data2 = the count (the
// exe's compact_item_data: reset, then the three bytes and the count).
export function presentItem(bytes: readonly number[], count: number): ItemData {
  const data1 = new Uint8Array(12);
  data1.set(bytes.slice(0, 3));
  const data2 = new Uint8Array(4);
  new DataView(data2.buffer).setUint32(0, count >>> 0, true);
  return { data1, id: 0, data2 };
}

// F95B's packed arguments: data1[0] = bits 16..23, data1[1] = bits 8..15,
// data1[2] = bits 0..7 (opcode_unknownF95B .c:611678).
export function argItemBytes(arg: number): ItemBytes {
  return [(arg >>> 16) & 0xff, (arg >>> 8) & 0xff, arg & 0xff];
}

// The 6xD9 tokens of the counter: token1 = the offered item's count ^ slot,
// token2 = slot ^ 1 (send_packet0x60_subcommand0xd9).
export function presentTokens(rewardCount: number, slot: number): { token1: number; token2: number } {
  return { token1: (rewardCount ^ slot) >>> 0, token2: (slot ^ 1) >>> 0 };
}
