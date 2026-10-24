// Chat shortcuts (BB): the 16 saved shortcut records in the character file, read for
// the Shift+F / F-key chat form (classic/chat.ts ChatLine.useShortcut), written by the
// Chat > Shortcut leaf (menu 0x11) and saved with 03ED.
//
// Layout: newserv src/SaveFileFormats.hh SaveFileChatShortcutEntryT<false, UTF16, 0x50>
// (SaveFileShortcutEntryBB, 0xA4 bytes): u32 type (1 = text, 2 = word select,
// 3 = symbol chat) at +0, the definition at +4 (UTF-16 text of 0x50 chars, a SymbolChatT
// at +4, or a WordSelectMessageT at +4, 0x1C bytes: u16 num_tokens, u16 target_type,
// u16 tokens[8], u32 numeric_parameter, u32 unknown_a4). PSOBBCharacterFile.shortcuts at
// 0x1FAC, 0x10 entries (0x1ACC + 12 x 0x68 = 0x1FAC: the symbol chats come first). MIT license.
//
// Exe (PsoBB.exe 1.25.13, named dump Psobb.exe-05112026.c): get_chat_shortcut_optcall
// (line 754134) returns `&puVar1[0xc].field_0x180 + index * 0xa4` of the session block
// (get_00a95df8), the save copy. ChatMessage_CopyData_0077d694 (754145) writes a 0xA4
// record there (0x29 dwords), ChatMessage_ClearType_0077d6bc (754167) sets type 0.
// send_packet0xed_subcommand3 (813730) sends 03ED: the 16 records from that block, 0xA40
// bytes (the header's size word is 0xA48, the 8-byte frame). It is called from the leaf's
// destructor (ChatShortcutMenu_Destructor, dump 726726) when the leaf's change flag (+0x28)
// is set.

import { readUtf16 } from './bbconnection.ts';
import { parseSymbolChat, writeSymbolChat, type SymbolChat } from './symbolchat.ts';

export const CHAT_SHORTCUT_FILE_OFFSET = 0x1fac;
export const CHAT_SHORTCUT_STRIDE = 0xa4;
export const CHAT_SHORTCUT_COUNT = 0x10;
export const CHAT_SHORTCUT_TEXT_CHARS = 0x50;
// The text keeps a terminator: the editor stores at most this many characters (ASSUMED:
// the exe's own limit is not traced).
export const CHAT_SHORTCUT_TEXT_MAX = CHAT_SHORTCUT_TEXT_CHARS - 1;
export const CHAT_SHORTCUTS_PAYLOAD_SIZE = CHAT_SHORTCUT_STRIDE * CHAT_SHORTCUT_COUNT; // 0xA40: 03ED body
// The 03ED frame: command 0xED, flag 3 (C_UpdateChatShortcuts_BB_03ED; the exe's
// send_packet0xed_subcommand3 writes 0xED to byte 2 and 3 to byte 3 of its frame).
export const CHAT_SHORTCUTS_COMMAND = 0xed;
export const CHAT_SHORTCUTS_FLAG = 3;

export const CHAT_SHORTCUT_TEXT = 1;
export const CHAT_SHORTCUT_WORD_SELECT = 2;
export const CHAT_SHORTCUT_SYMBOL = 3;

// The 6x74 word select subcommand (newserv CommandFormats.hh G_WordSelectT_6x74; exe
// send_chat_message_word_select, dump 664328: subcommand 0x74, size 8 dwords).
export const WORD_SELECT_SUBCOMMAND = 0x74;
export const WORD_SELECT_MESSAGE_SIZE = 0x1c;

export interface WordSelectMessage {
  numTokens: number;
  targetType: number;
  tokens: number[]; // 8 entries (u16 word ids)
  numericParameter: number;
  unknownA4: number;
}

export interface ChatShortcut {
  type: number; // 0 or other = empty
  text: string; // type 1: the line as typed (the \tE marker stripped)
  symbol: SymbolChat | null; // type 3
  word: WordSelectMessage | null; // type 2
}

export function emptyWordSelect(): WordSelectMessage {
  return { numTokens: 0, targetType: 0, tokens: new Array(8).fill(0), numericParameter: 0, unknownA4: 0 };
}

// The word select message at `off` (little-endian: BB).
export function parseWordSelectMessage(data: Uint8Array, off: number): WordSelectMessage {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tokens: number[] = [];
  for (let i = 0; i < 8; i++) tokens.push(dv.getUint16(off + 4 + i * 2, true));
  return {
    numTokens: dv.getUint16(off, true),
    targetType: dv.getUint16(off + 2, true),
    tokens,
    numericParameter: dv.getUint32(off + 0x14, true),
    unknownA4: dv.getUint32(off + 0x18, true),
  };
}

export function writeWordSelectMessage(dst: Uint8Array, off: number, m: WordSelectMessage): void {
  const dv = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);
  dv.setUint16(off, m.numTokens & 0xffff, true);
  dv.setUint16(off + 2, m.targetType & 0xffff, true);
  for (let i = 0; i < 8; i++) dv.setUint16(off + 4 + i * 2, (m.tokens[i] ?? 0) & 0xffff, true);
  dv.setUint32(off + 0x14, m.numericParameter >>> 0, true);
  dv.setUint32(off + 0x18, m.unknownA4 >>> 0, true);
}

// The 6x74 payload after the 4-byte subcommand header that Lobby.sendSubcommand writes
// (the header's client id is the sender's). 0x1C bytes.
export function wordSelectSubcommandPayload(m: WordSelectMessage): Uint8Array {
  const out = new Uint8Array(WORD_SELECT_MESSAGE_SIZE);
  writeWordSelectMessage(out, 0, m);
  return out;
}

// Record `index` (0..15) of a full character (00E7 data); null without the record.
export function parseChatShortcut(full: Uint8Array | null, index: number): ChatShortcut | null {
  if (!full || index < 0 || index >= CHAT_SHORTCUT_COUNT) return null;
  const o = CHAT_SHORTCUT_FILE_OFFSET + index * CHAT_SHORTCUT_STRIDE;
  if (full.length < o + CHAT_SHORTCUT_STRIDE) return null;
  const type = new DataView(full.buffer, full.byteOffset, full.byteLength).getUint32(o, true);
  const text = type === CHAT_SHORTCUT_TEXT ? readUtf16(full, o + 4, CHAT_SHORTCUT_TEXT_CHARS).replace(/^\t[A-Z]/, '') : '';
  const symbol = type === CHAT_SHORTCUT_SYMBOL ? parseSymbolChat(full, o + 4) : null;
  const word = type === CHAT_SHORTCUT_WORD_SELECT ? parseWordSelectMessage(full, o + 4) : null;
  return { type, text, symbol, word };
}

// One record as the save stores it (0xA4 bytes). A text record keeps its line as typed
// (no \tE marker; the sender adds it). A record whose definition is missing is empty.
export function encodeChatShortcut(s: ChatShortcut): Uint8Array {
  const out = new Uint8Array(CHAT_SHORTCUT_STRIDE);
  const dv = new DataView(out.buffer);
  if (s.type === CHAT_SHORTCUT_TEXT) {
    dv.setUint32(0, CHAT_SHORTCUT_TEXT, true);
    const t = s.text.slice(0, CHAT_SHORTCUT_TEXT_MAX);
    for (let i = 0; i < t.length; i++) dv.setUint16(4 + i * 2, t.charCodeAt(i), true);
  } else if (s.type === CHAT_SHORTCUT_SYMBOL && s.symbol) {
    dv.setUint32(0, CHAT_SHORTCUT_SYMBOL, true);
    writeSymbolChat(out, 4, s.symbol);
  } else if (s.type === CHAT_SHORTCUT_WORD_SELECT && s.word) {
    dv.setUint32(0, CHAT_SHORTCUT_WORD_SELECT, true);
    writeWordSelectMessage(out, 4, s.word);
  }
  return out;
}

// Replaces record `index` of a full character in place (the save copy). Returns false
// when the buffer has no such record.
export function writeChatShortcut(full: Uint8Array | null, index: number, s: ChatShortcut): boolean {
  if (!full || index < 0 || index >= CHAT_SHORTCUT_COUNT) return false;
  const o = CHAT_SHORTCUT_FILE_OFFSET + index * CHAT_SHORTCUT_STRIDE;
  if (full.length < o + CHAT_SHORTCUT_STRIDE) return false;
  full.set(encodeChatShortcut(s), o);
  return true;
}

// The 03ED body: the 16 records as send_packet0xed_subcommand3 copies them (0xA40 bytes
// from the save copy). Null without a full character.
export function chatShortcutsPayload(full: Uint8Array | null): Uint8Array | null {
  if (!full || full.length < CHAT_SHORTCUT_FILE_OFFSET + CHAT_SHORTCUTS_PAYLOAD_SIZE) return null;
  return full.slice(CHAT_SHORTCUT_FILE_OFFSET, CHAT_SHORTCUT_FILE_OFFSET + CHAT_SHORTCUTS_PAYLOAD_SIZE);
}
