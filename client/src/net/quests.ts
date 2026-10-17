// Quest selection and download.
//
// Command layouts from newserv src/CommandFormats.hh and the send/receive
// paths in src/SendCommands.cc / src/ReceiveCommands.cc (MIT license).
//
// The flow in a game, as newserv drives it (on_10_quest_categories,
// on_10_quest_menu, set_lobby_quest, on_AC_V3_BB):
//
//   C->S A2 (no body)                 ask for the quest menu
//   S->C A2 flag=count                categories, entries of 0x13C bytes
//   C->S 09 {menu_id, item_id}        ask about one entry (a quest, not a
//                                     category: newserv answers nothing for a
//                                     category, whose short description came
//                                     with the entry)
//   S->C A3                           long description, plain UTF-16 text
//   C->S 10 {menu_id, item_id}        choose a category -> another A2 with the
//                                     quests of that category; choose a quest
//                                     -> the two files
//   S->C 44 {S_OpenFile_BB_44_A6}     open <quest>.bin, then <quest>.dat
//   C->S 44 {filename[0x10]}          acknowledge, flag echoed
//   S->C 13 flag=chunk {filename[0x10], data[0x400], u32 data_size}
//   C->S 13 flag=chunk {filename}     acknowledge each chunk; newserv keeps 4
//                                     chunks in flight (V3_V4_QUEST_LOAD_MAX_
//                                     CHUNKS_IN_FLIGHT) and sends chunk
//                                     flag+4 on each ack
//   C->S AC (no body)                 the quest barrier: this client is loaded
//   S->C AC (no body)                 every client is loaded; the quest starts
//
// Outside a game the same exchange uses A6 and A7 instead of 44 and 13 (the
// download-quest variants, which the original client would write to the memory
// card). newserv sends those when a client picks a quest from the lobby menu.
//
// Both files arrive PRS-compressed and are decompressed here, as the client
// does in decompress_received_quest_files (PsoBB.exe 0x006d0174), which
// decompresses the .bin and then the .dat into one buffer and sets the quest
// state to 7 ("ready to start").

import { readAscii, readUtf16, writeAscii, type BBConnection, type Command } from './bbconnection.ts';
import { prsDecompress } from '../formats/prs.ts';
import { stripMarkers } from './lobby.ts';

// newserv src/Menu.hh
export const MENU_ID_QUEST_CATEGORIES_EP1_EP3_EP4 = 0x01000001;
export const MENU_ID_QUEST_CATEGORIES_EP2 = 0x02000002;
export const MENU_ID_QUEST_EP1 = 0x55010155;
export const MENU_ID_QUEST_EP2 = 0x55020255;

export const QUEST_MENU_ENTRY_SIZE_BB = 0x13c;
export const QUEST_CHUNK_SIZE = 0x400;

export interface QuestMenuEntry {
  menuId: number;
  itemId: number;
  name: string;
  shortDescription: string;
  disabled: boolean;
  // The quest menu's menu_id is three fields on the client: the first byte is
  // the episode (only used to pick the Challenge Mode times window), the
  // second the icon (0 = online quest, 1 = download, 2 = completed download).
  episodeByte: number;
  iconByte: number;
  isCategory: boolean;
}

// S_QuestMenuEntry_BB_A2_A4 (0x13C): menu_id, item_id, utf16 name[0x20],
// utf16 short_description[0x78], u8 disabled, 3 unused.
export function parseQuestMenu(data: Uint8Array): QuestMenuEntry[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: QuestMenuEntry[] = [];
  for (let o = 0; o + QUEST_MENU_ENTRY_SIZE_BB <= data.length; o += QUEST_MENU_ENTRY_SIZE_BB) {
    const menuId = dv.getUint32(o, true);
    out.push({
      menuId,
      itemId: dv.getUint32(o + 4, true),
      name: stripMarkers(readUtf16(data, o + 8, 0x20)),
      shortDescription: stripMarkers(readUtf16(data, o + 8 + 0x40, 0x78)),
      disabled: data[o + 8 + 0x40 + 0xf0] !== 0,
      episodeByte: menuId & 0xff,
      iconByte: (menuId >> 8) & 0xff,
      isCategory: menuId === MENU_ID_QUEST_CATEGORIES_EP1_EP3_EP4 || menuId === MENU_ID_QUEST_CATEGORIES_EP2,
    });
  }
  return out;
}

export interface OpenQuestFile {
  filename: string;
  size: number;
  name: string; // the "PSO/<quest name>" string
  type: number; // only meaningful for A6: 0 = download quest, 1 = with .pvr, ...
  download: boolean; // A6/A7 rather than 44/13
}

// S_OpenFile_BB_44_A6 (0x50): u8 unused[0x22], u16 type, char filename[0x10],
// u32 file_size, char name[0x18].
export function parseOpenFile(c: Command): OpenQuestFile {
  const dv = new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
  return {
    type: dv.getUint16(0x22, true),
    filename: readAscii(c.data, 0x24, 0x10),
    size: dv.getUint32(0x34, true),
    name: stripMarkers(readAscii(c.data, 0x38, 0x18)),
    download: c.command === 0xa6,
  };
}

interface Incoming {
  file: OpenQuestFile;
  chunks: Uint8Array[]; // by chunk index
  received: number;
  complete: boolean;
}

export interface LoadedQuest {
  name: string; // from the 44/A6 "PSO/<name>" string
  binFilename: string;
  datFilename: string;
  bin: Uint8Array; // decompressed
  dat: Uint8Array; // decompressed
  binCompressedSize: number;
  datCompressedSize: number;
  download: boolean;
}

export interface QuestClientOptions {
  log?: (msg: string) => void;
  // Called when both files have arrived and been decompressed. The AC barrier
  // is sent right after, unless `autoBarrier` is false.
  onQuest?: (q: LoadedQuest) => void;
  // Called when the server's AC says every client is loaded: start the quest.
  onStart?: () => void;
  autoBarrier?: boolean;
}

// Handles the quest menu and the file transfer on one connection. Install it
// once per connection; it chains onto conn.onCommand the way Lobby does, so
// the menus and the files are seen wherever the client is (lobby or game).
export class QuestClient {
  private conn: BBConnection;
  private opts: QuestClientOptions;
  private files = new Map<string, Incoming>();
  private menuWaiters: Array<(e: QuestMenuEntry[]) => void> = [];
  private infoWaiters: Array<(s: string) => void> = [];
  private questWaiters: Array<(q: LoadedQuest) => void> = [];
  // The last menu the server sent, so the UI can re-render without asking again.
  lastMenu: QuestMenuEntry[] = [];
  loaded: LoadedQuest | null = null;
  // True between the local AC and the server's AC.
  atBarrier = false;

  constructor(conn: BBConnection, opts: QuestClientOptions = {}) {
    this.conn = conn;
    this.opts = opts;
    const prev = conn.onCommand;
    conn.onCommand = (c) => {
      prev(c);
      this.handle(c);
    };
  }

  private log(msg: string): void {
    this.opts.log?.(msg);
  }

  private handle(c: Command): void {
    switch (c.command) {
      case 0xa2: // quest menu (in a game)
      case 0xa4: // download quest menu (in a lobby)
        this.lastMenu = parseQuestMenu(c.data);
        this.log(`quest menu (${c.command.toString(16).toUpperCase()}): ${this.lastMenu.length} entries`);
        for (const w of this.menuWaiters.splice(0)) w(this.lastMenu);
        return;
      case 0xa3: // quest information (same format as 1A/D5: plain UTF-16)
      case 0xa5: {
        const text = stripMarkers(readUtf16(c.data, 0, c.data.length >> 1));
        for (const w of this.infoWaiters.splice(0)) w(text);
        return;
      }
      case 0x44:
      case 0xa6:
        this.onOpenFile(c);
        return;
      case 0x13:
      case 0xa7:
        this.onFileChunk(c);
        return;
      case 0xac:
        // The server's AC: everyone is loaded, the quest starts now.
        this.atBarrier = false;
        this.log('quest barrier released (AC)');
        this.opts.onStart?.();
        return;
    }
  }

  // C->S A2: ask for the quest menu. Resolves with the category list.
  requestMenu(): Promise<QuestMenuEntry[]> {
    const p = new Promise<QuestMenuEntry[]>((resolve) => this.menuWaiters.push(resolve));
    this.conn.send(0xa2, 0);
    return p;
  }

  // C->S 10: choose a category. Resolves with that category's quest list.
  selectCategory(entry: QuestMenuEntry): Promise<QuestMenuEntry[]> {
    const p = new Promise<QuestMenuEntry[]>((resolve) => this.menuWaiters.push(resolve));
    this.conn.send(0x10, 0, menuSelection(entry));
    return p;
  }

  // C->S 09: ask for a quest's long description (A3).
  requestInfo(entry: QuestMenuEntry): Promise<string> {
    const p = new Promise<string>((resolve) => this.infoWaiters.push(resolve));
    this.conn.send(0x09, 0, menuSelection(entry));
    return p;
  }

  // C->S 10 on a quest entry: the server answers with the 44/13 (or A6/A7)
  // file pair. Resolves once both files are in and decompressed.
  selectQuest(entry: QuestMenuEntry): Promise<LoadedQuest> {
    const p = new Promise<LoadedQuest>((resolve) => this.questWaiters.push(resolve));
    this.files.clear();
    this.conn.send(0x10, 0, menuSelection(entry));
    return p;
  }

  // Waits for a quest the server starts on its own (another player picked it).
  awaitQuest(): Promise<LoadedQuest> {
    return new Promise<LoadedQuest>((resolve) => this.questWaiters.push(resolve));
  }

  // C->S AC: this client has finished loading the quest.
  sendBarrier(): void {
    this.atBarrier = true;
    this.conn.send(0xac, 0);
    this.log('quest barrier sent (AC)');
  }

  private onOpenFile(c: Command): void {
    const file = parseOpenFile(c);
    if (!/\.(bin|dat)$/i.test(file.filename)) {
      this.log(`ignoring quest file ${file.filename} (not .bin or .dat)`);
      return;
    }
    this.files.set(file.filename, { file, chunks: [], received: 0, complete: false });
    this.log(`quest file ${file.filename}: ${file.size} bytes ("${file.name}")`);
    // C_OpenFileConfirmation_44_A6: the filename, with the server's flag.
    const ack = new Uint8Array(0x10);
    writeAscii(ack, 0, 0x10, file.filename);
    this.conn.send(c.command, c.flag, ack);
  }

  private onFileChunk(c: Command): void {
    // S_WriteFile_13_A7 (0x414): char filename[0x10], u8 data[0x400], u32 size.
    if (c.data.length < 0x414) return;
    const dv = new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
    const filename = readAscii(c.data, 0, 0x10);
    const size = dv.getUint32(0x410, true);
    const entry = this.files.get(filename);
    if (!entry) {
      this.log(`quest chunk for unknown file ${filename}`);
      return;
    }
    if (!entry.chunks[c.flag]) entry.received += Math.min(size, QUEST_CHUNK_SIZE);
    entry.chunks[c.flag] = c.data.slice(0x10, 0x10 + Math.min(size, QUEST_CHUNK_SIZE));
    // C_WriteFileConfirmation_V3_BB_13_A7: the filename, flag = chunk index.
    // newserv answers each ack with chunk flag+4, so this keeps the transfer
    // moving.
    const ack = new Uint8Array(0x10);
    writeAscii(ack, 0, 0x10, filename);
    this.conn.send(c.command, c.flag, ack);
    // The original client only considers a file done when a chunk is shorter
    // than 0x400 (which is why newserv pads a file whose size is a multiple of
    // 0x400 with one extra byte). The byte count is checked too, so a server
    // that does not pad still works here.
    if (size < QUEST_CHUNK_SIZE || entry.received >= entry.file.size) entry.complete = true;
    if (entry.complete) this.finishIfReady();
  }

  private finishIfReady(): void {
    const all = [...this.files.values()];
    const bin = all.find((e) => /\.bin$/i.test(e.file.filename));
    const dat = all.find((e) => /\.dat$/i.test(e.file.filename));
    if (!bin?.complete || !dat?.complete) return;
    const binRaw = concat(bin.chunks, bin.file.size);
    const datRaw = concat(dat.chunks, dat.file.size);
    let loaded: LoadedQuest;
    try {
      loaded = {
        name: bin.file.name || dat.file.name,
        binFilename: bin.file.filename,
        datFilename: dat.file.filename,
        bin: prsDecompress(binRaw),
        dat: prsDecompress(datRaw),
        binCompressedSize: binRaw.length,
        datCompressedSize: datRaw.length,
        download: bin.file.download,
      };
    } catch (err) {
      this.log(`quest files failed to decompress: ${(err as Error).message}`);
      this.files.clear();
      return;
    }
    this.files.clear();
    this.loaded = loaded;
    this.log(`quest "${loaded.name}" loaded: ${loaded.binFilename} ${loaded.bin.length} bytes, ${loaded.datFilename} ${loaded.dat.length} bytes (from ${loaded.binCompressedSize}+${loaded.datCompressedSize} compressed)`);
    for (const w of this.questWaiters.splice(0)) w(loaded);
    this.opts.onQuest?.(loaded);
    if (this.opts.autoBarrier !== false && !loaded.download) this.sendBarrier();
  }
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const total = chunks.reduce((n, c) => n + (c?.length ?? 0), 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    if (!c) continue;
    out.set(c, at);
    at += c.length;
  }
  // A file whose size is a multiple of 0x400 gets one padding byte from
  // newserv; PRS stops at its own end marker, so trimming is safe either way.
  return total > size ? out.subarray(0, size) : out;
}

// C_MenuSelection_10 / C_MenuItemInfoRequest_09: {menu_id, item_id}.
function menuSelection(entry: QuestMenuEntry): Uint8Array {
  const body = new Uint8Array(8);
  const dv = new DataView(body.buffer);
  dv.setUint32(0, entry.menuId, true);
  dv.setUint32(4, entry.itemId, true);
  return body;
}
