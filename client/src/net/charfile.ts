// E7 (SC_SyncSaveFiles_BB_E7, 0x3994 bytes): the full character file the game
// server sends after the phase-4 login, before the 07 main menu.
// Layouts from newserv src/SaveFileFormats.hh, PlayerInventory.hh,
// PlayerSubordinates.hh and LevelTable.hh (MIT license).
//
//   0000 PSOBBCharacterFile (0x2EA4)
//          0000 PlayerInventory (0x34C): u8 num_items, hp_from_materials,
//               tp_from_materials, language; 30 x PlayerInventoryItem (0x1C):
//               u8 state, u8, u8 extension_data1, u8 extension_data2,
//               u32 flags (0x08 = equipped), ItemData (0x14)
//          034C PlayerDispDataV4 (0x190): stats (0x24), visual (0x70),
//               config (0xE8), technique_levels_v1[0x14]
//          04E8 u32 play_time_seconds
//          06F4 u32 death_count
//          06F8 PlayerBank200 (0x12C8): u32 num_items, u32 meseta,
//               200 x {ItemData, u16 amount, u16 present}
//          19C0 GuildCardBB (0x108)
//          1ACC 12 x SymbolChat entries (0x68, symbolchat.ts)
//          2B44 info board (UTF-16, 0xAC chars); 29EC auto reply
//   2EA4 PSOBBBaseSystemFile (0x2B8)
//   315C PSOBBFullTeamMembership (0x838)

import { readUtf16 } from './bbconnection.ts';
import { readItemData, type ItemData } from '../formats/itemnames.ts';
import { parseSymbolChats, SYMBOL_CHAT_COUNT, SYMBOL_CHAT_ENTRY_SIZE, SYMBOL_CHAT_FILE_OFFSET, type SymbolChatEntry } from './symbolchat.ts';

export const E7_SIZE = 0x3994;

// The technique menu order (the quick menu's technique tab, 19 u16 ids). It is the save's
// `tech_menu[40]` (sylverant_bb_full_char_t, data offset 0x2DF8: the E7 body is the data
// without the 8-byte packet header, and the offsets chain to the known 2EA4 base system file).
// The exe keeps the live order at g_pCurrentCharacterData + 0x13 * sizeof + 0x108 (SwapTechnique
// Slots_00741d28, dump 712325) and sends it with ED 06 (send_packet0xed_subcommand6, dump 813854:
// u32 0, then the 40 bytes from +0x108), not in the E7 copy (E7 copies g_pCurrentSessionData).
export const TECH_MENU_OFFSET = 0x2df8;
export const TECH_MENU_SIZE = 40;
export const TECH_MENU_COUNT = 19;
export const TECH_MENU_COMMAND = 0xed;
export const TECH_MENU_FLAG = 0x06;

// The 19 ids of the save's tech menu, or null when the bytes are not a permutation of 0..18
// (a fresh save's zeros, for one). ASSUMED: the exe's load of this field is not traced.
export function techMenuOrder(save: Uint8Array): number[] | null {
  if (save.length < TECH_MENU_OFFSET + TECH_MENU_SIZE) return null;
  const dv = new DataView(save.buffer, save.byteOffset, save.byteLength);
  const order: number[] = [];
  for (let i = 0; i < TECH_MENU_COUNT; i++) order.push(dv.getUint16(TECH_MENU_OFFSET + i * 2, true));
  const seen = new Set(order);
  if (seen.size !== TECH_MENU_COUNT || order.some((t) => t >= TECH_MENU_COUNT)) return null;
  return order;
}

// The ED 06 body: u32 0, then tech_menu[40] (the 19 u16 ids, the rest zero). 44 bytes, the
// packet's 4-byte header is the connection's.
export function techMenuPayload(order: readonly number[]): Uint8Array {
  const body = new Uint8Array(4 + TECH_MENU_SIZE);
  const dv = new DataView(body.buffer);
  for (let i = 0; i < TECH_MENU_COUNT; i++) dv.setUint16(4 + i * 2, order[i] ?? 0, true);
  return body;
}

// The order written into a save copy (the E7 file the port keeps for the session).
export function writeTechMenuOrder(save: Uint8Array, order: readonly number[]): void {
  if (save.length < TECH_MENU_OFFSET + TECH_MENU_SIZE) return;
  const dv = new DataView(save.buffer, save.byteOffset, save.byteLength);
  for (let i = 0; i < TECH_MENU_COUNT; i++) dv.setUint16(TECH_MENU_OFFSET + i * 2, order[i] ?? 0, true);
}

export interface InventoryItem {
  index: number;
  state: number; // 1 = in inventory, 2 = equipped
  flags: number; // 0x08 = equipped, 0x04 = equippable, 0x100 = has kill count, 0x400 = wrapped
  extensionData1: number;
  extensionData2: number;
  equipped: boolean;
  data: ItemData;
}

export interface BankItem {
  data: ItemData;
  amount: number;
  present: number;
}

export interface CharacterStats {
  atp: number;
  mst: number;
  evp: number;
  hp: number;
  dfp: number;
  ata: number;
  lck: number;
  esp: number;
}

export interface CharacterFile {
  name: string;
  guildCardNumber: number;
  charClass: number;
  sectionId: number;
  level: number; // displayed level (wire value is 0-based)
  exp: number;
  meseta: number;
  stats: CharacterStats;
  hpFromMaterials: number;
  tpFromMaterials: number;
  // Power, Mind, Evade, Defense, Luck material counts: the extension_data2 of
  // the raw slots 8..12 (PSOBBCharacterFile::get_material_usage). Zeros when absent.
  materialCounts?: number[];
  inventory: InventoryItem[];
  bank: { meseta: number; items: BankItem[] };
  // Learned level per technique (1-based), null if not learned.
  // Level = technique_levels_v1[t] + inventory.items[t].extension_data1 (PSOBBCharacterFile::get_technique_level).
  techLevels: Array<number | null>;
  playTimeSeconds: number;
  deathCount: number;
  guildCard: { number: number; name: string; teamName: string; description: string; language: number };
  infoBoard: string;
  autoReply: string;
  // The 12 symbol chats (PSOBBCharacterFile.symbol_chats at 0x1ACC, symbolchat.ts).
  symbolChats: SymbolChatEntry[];
  teamName: string;
}

export function parseCharacterFile(data: Uint8Array): CharacterFile {
  if (data.length < 0x2ea4) throw new Error(`E7 too short: ${data.length} bytes`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  const name = (o: number, n: number) => readUtf16(data, o, n).replace(/^\t[EJ]/, '');

  const inventory: InventoryItem[] = [];
  const numItems = Math.min(data[0], 30);
  const rawItems = Array.from({ length: 30 }, (_, i) => {
    const o = 4 + i * 0x1c;
    const flags = u32(o + 4);
    return {
      index: i,
      state: data[o],
      flags,
      extensionData1: data[o + 2],
      extensionData2: data[o + 3],
      equipped: (flags & 8) !== 0,
      data: readItemData(data, o + 8),
    };
  });
  inventory.push(...rawItems.slice(0, numItems));

  const disp = 0x34c;
  const visual = disp + 0x24;
  const shared = visual + 0x10;
  const techLevels: Array<number | null> = [];
  for (let t = 0; t < 19; t++) {
    const base = data[disp + 0x17c + t];
    techLevels.push(base === 0xff ? null : base + rawItems[t].extensionData1 + 1);
  }

  const bankOff = 0x6f8;
  const bankCount = Math.min(u32(bankOff), 200);
  const bankItems: BankItem[] = [];
  for (let i = 0; i < bankCount; i++) {
    const o = bankOff + 8 + i * 0x18;
    bankItems.push({ data: readItemData(data, o), amount: u16(o + 0x14), present: u16(o + 0x16) });
  }

  const gc = 0x19c0;
  const team = 0x315c;
  return {
    name: name(visual + 0x50, 0x10),
    guildCardNumber: u32(gc),
    sectionId: data[shared + 0x20],
    charClass: data[shared + 0x21],
    stats: {
      atp: u16(disp),
      mst: u16(disp + 2),
      evp: u16(disp + 4),
      hp: u16(disp + 6),
      dfp: u16(disp + 8),
      ata: u16(disp + 0x0a),
      lck: u16(disp + 0x0c),
      esp: u16(disp + 0x0e),
    },
    level: u32(disp + 0x18) + 1,
    exp: u32(disp + 0x1c),
    meseta: u32(disp + 0x20),
    hpFromMaterials: data[1],
    tpFromMaterials: data[2],
    materialCounts: [0, 1, 2, 3, 4].map((t) => rawItems[8 + t].extensionData2),
    inventory,
    bank: { meseta: u32(bankOff + 4), items: bankItems },
    techLevels,
    playTimeSeconds: u32(0x4e8),
    deathCount: u32(0x6f4),
    guildCard: {
      number: u32(gc),
      name: name(gc + 4, 0x18),
      teamName: name(gc + 0x34, 0x10),
      description: readUtf16(data, gc + 0x54, 0x58),
      language: data[gc + 0x105],
    },
    symbolChats: data.length >= SYMBOL_CHAT_FILE_OFFSET + SYMBOL_CHAT_COUNT * SYMBOL_CHAT_ENTRY_SIZE ? parseSymbolChats(data) : [],
    autoReply: readUtf16(data, 0x29ec, 0xac),
    infoBoard: readUtf16(data, 0x2b44, 0xac),
    // PSOBBBaseTeamMembership: +0x00 team master gc, +0x04 team id, ... +0x14 team name (UTF-16, 0x10)
    teamName: data.length >= team + 0x34 ? name(team + 0x14, 0x10) : '',
  };
}

// The auto reply (Simple Mail answer service) in the save: 0xAC units at 0x29EC (newserv's
// PSOBBCharacterFile; the exe keeps it at character +0x2510 in memory, the same +0x4DC
// offset as the info board's 0x2B44 / +0x2668). Written into the raw E7 copy so the save
// that the session holds carries the text (the port does not send E7 upstream yet).
export const AUTO_REPLY_OFFSET = 0x29ec;
export const AUTO_REPLY_UNITS = 0xac;

export function writeAutoReply(raw: Uint8Array, text: string): void {
  if (raw.length < AUTO_REPLY_OFFSET + AUTO_REPLY_UNITS * 2) return;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < AUTO_REPLY_UNITS; i++) {
    dv.setUint16(AUTO_REPLY_OFFSET + i * 2, i < text.length ? text.charCodeAt(i) : 0, true);
  }
}
