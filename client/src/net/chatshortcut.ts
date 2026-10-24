// Chat shortcuts (BB): the 16 saved shortcut records in the character file, read for
// the Shift+F / F-key chat form (classic/chat.ts ChatLine.useShortcut).
//
// Layout: newserv src/SaveFileFormats.hh SaveFileChatShortcutEntryT<false, UTF16, 0x50>
// (SaveFileShortcutEntryBB, 0xA4 bytes): u32 type (1 = text, 2 = word select,
// 3 = symbol chat) at +0, the definition at +4 (UTF-16 text of 0x50 chars, or a
// SymbolChatT, 0x3C bytes, at +4). PSOBBCharacterFile.shortcuts at 0x1FAC, 0x10
// entries (0x1ACC + 12 x 0x68 = 0x1FAC: the symbol chats come first). MIT license.
//
// Exe (PsoBB.exe 1.25.13, named dump Psobb.exe-05112026.c): get_chat_shortcut_optcall
// (line 754134) returns `&puVar1[0xc].field_0x180 + index * 0xa4` of the session block
// (get_00a95df8), a 0xa4 record of the same type as the chat messages
// (ChatMessage_CopyData_0077d694 copies 0x29 dwords). The save file is the only source the port has:
// the in-game editor (the Chat > Shortcut leaf, 0x11) is not ported, so the records are
// read as the server sent them at login (ASSUMED that the session copy is the save's).

import { readUtf16 } from './bbconnection.ts';
import { parseSymbolChat, type SymbolChat } from './symbolchat.ts';

export const CHAT_SHORTCUT_FILE_OFFSET = 0x1fac;
export const CHAT_SHORTCUT_STRIDE = 0xa4;
export const CHAT_SHORTCUT_COUNT = 0x10;
export const CHAT_SHORTCUT_TEXT_CHARS = 0x50;

export const CHAT_SHORTCUT_TEXT = 1;
export const CHAT_SHORTCUT_WORD_SELECT = 2;
export const CHAT_SHORTCUT_SYMBOL = 3;

export interface ChatShortcut {
  type: number; // 0 or other = empty
  text: string; // type 1: the line as typed (the \tE marker stripped)
  symbol: SymbolChat | null; // type 3
}

// Record `index` (0..15) of a full character (00E7 data); null without the record.
export function parseChatShortcut(full: Uint8Array | null, index: number): ChatShortcut | null {
  if (!full || index < 0 || index >= CHAT_SHORTCUT_COUNT) return null;
  const o = CHAT_SHORTCUT_FILE_OFFSET + index * CHAT_SHORTCUT_STRIDE;
  if (full.length < o + CHAT_SHORTCUT_STRIDE) return null;
  const type = new DataView(full.buffer, full.byteOffset, full.byteLength).getUint32(o, true);
  const text = type === CHAT_SHORTCUT_TEXT ? readUtf16(full, o + 4, CHAT_SHORTCUT_TEXT_CHARS).replace(/^\t[A-Z]/, '') : '';
  const symbol = type === CHAT_SHORTCUT_SYMBOL ? parseSymbolChat(full, o + 4) : null;
  return { type, text, symbol };
}
