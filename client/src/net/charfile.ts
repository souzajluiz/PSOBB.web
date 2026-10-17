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
//          2B44 info board (UTF-16, 0xAC chars); 29EC auto reply
//   2EA4 PSOBBBaseSystemFile (0x2B8)
//   315C PSOBBFullTeamMembership (0x838)

import { readUtf16 } from './bbconnection.ts';
import { readItemData, type ItemData } from '../formats/itemnames.ts';

export const E7_SIZE = 0x3994;

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
    autoReply: readUtf16(data, 0x29ec, 0xac),
    infoBoard: readUtf16(data, 0x2b44, 0xac),
    // PSOBBBaseTeamMembership: +0x00 team master gc, +0x04 team id, ... +0x14 team name (UTF-16, 0x10)
    teamName: data.length >= team + 0x34 ? name(team + 0x14, 0x10) : '',
  };
}
