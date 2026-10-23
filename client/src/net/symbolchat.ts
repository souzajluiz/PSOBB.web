// Symbol chats (BB): the 12 saved symbol chats in the character file, the 0x02ED
// save command and the 6x07 subcommand that carries one chat to the room.
//
// Layouts: newserv src/SaveFileFormats.hh (SaveFileSymbolChatEntryT, BB = 0x68 bytes;
// PSOBBCharacterFile.symbol_chats at 0x1ACC, 12 entries), src/PlayerSubordinates.hh
// (SymbolChatT, 0x3C bytes; SymbolChatFacePart, 4 bytes), src/CommandFormats.hh
// (C_UpdateSymbolChats_BB_02ED, 0x4E0 bytes; G_SymbolChat_6x07, 0x44 bytes),
// src/ReceiveCommands.cc (0x02ED stores the 12 entries into the character file) and
// src/ReceiveSubcommands.cc (on_symbol_chat forwards 6x07 when can_chat and the
// client id is ours). MIT license.
//
// Exe (PsoBB.exe 1.25.13, dump refsrc/.../Psobb.exe-05112026.c):
//   - the chat messages live in the session block at get_00a95df8() + 0xd8, with
//     12 entries of 0x68 bytes (GetChatMessagePtr_0077d8d0 / _optcall_0077d8d4);
//   - ChatMessage_IsValid_0077d948: an entry is valid when bit 0 or bit 1 of its
//     u32 at +0 is set (newserv `present`; the chosen flag is set by the chat
//     window's state machine, ChatShortcutMenuWindow_Process_00758900);
//   - ProcessChatMessageType_0077d880 plays the entry's sound when bit 0 is set:
//     PlayDirectionalSoundEffect_0077d8a0(spec >> 5 & 0xf) with the spec at +0x2C,
//     i.e. the SymbolChatT starts at +0x2C (newserv: spec at 0x2C in BB entries).
// The exe's sender of 6x07 (the in-game symbol chat) is not traced here: the
// payload below is newserv's layout (ASSUMED that the exe sends entry +0x2C..+0x68
// unchanged, with its own client id).

import { readUtf16 } from './bbconnection.ts';

export const SYMBOL_CHAT_COUNT = 12;
export const SYMBOL_CHAT_ENTRY_SIZE = 0x68; // SaveFileSymbolChatEntryBB
export const SYMBOL_CHAT_NAME_OFFSET = 0x04; // pstring UTF-16, 0x14 chars
export const SYMBOL_CHAT_NAME_CHARS = 0x14;
export const SYMBOL_CHAT_SPEC_OFFSET = 0x2c; // SymbolChatT inside the entry
export const SYMBOL_CHAT_SIZE = 0x3c; // SymbolChatT
export const SYMBOL_CHAT_FILE_OFFSET = 0x1acc; // PSOBBCharacterFile.symbol_chats
export const SYMBOL_CHATS_COMMAND = 0x02ed; // C_UpdateSymbolChats_BB_02ED (body 0x4E0)
export const SYMBOL_CHAT_SUBCOMMAND = 0x07; // G_SymbolChat_6x07
export const SYMBOL_CHAT_NO_OBJECT = 0xff; // corner object Z bits all set: none
export const SYMBOL_CHAT_NO_FACE = 0xff; // face part type 0xFF: no part

export interface FacePart {
  type: number; // 0xFF = no part in this slot
  x: number;
  y: number;
  flags: number; // bit 0 = reverse horizontal, bit 1 = reverse vertical
}

export interface CornerObject {
  object: number; // Z: 0..0xFE, 0xFF = none
  color: number; // C
  reverseH: boolean;
  reverseV: boolean;
}

export interface SymbolChat {
  spec: number;
  cornerObjects: number[]; // 4 raw u16 (reading order, [0] is the top-left one)
  faceParts: FacePart[]; // 12
}

export interface SymbolChatEntry {
  // Bit 0 = set, bit 1 = chosen (exe ChatMessage_IsValid_0077d948).
  present: number;
  name: string; // the \tE / \tJ language marker is stripped, as in charfile.ts
  chat: SymbolChat;
}

// The spec word (newserv SymbolChatT: ----------------------DMSSSCCCFF).
export interface SymbolSpec {
  faceShape: number; // FF, bits 0-1
  faceColor: number; // CCC, bits 2-4
  soundBits: number; // bits 5-8: the exe's `spec >> 5 & 0xf`; 0..8 index the directional sound table (DAT_00979670), above 8 plays nothing
  mute: boolean; // M, bit 8 (newserv: mute). ASSUMED: the exe does not read it, so bit 8 alone plays table entry 8
  capture: boolean; // D, bit 9 (the chat holds a captured screen; not kept by the port)
}

export function decodeSpec(spec: number): SymbolSpec {
  return {
    faceShape: spec & 3,
    faceColor: (spec >>> 2) & 7,
    soundBits: (spec >>> 5) & 0xf,
    mute: ((spec >>> 8) & 1) !== 0,
    capture: ((spec >>> 9) & 1) !== 0,
  };
}

export function encodeSpec(s: SymbolSpec): number {
  return (
    ((s.faceShape & 3) |
      ((s.faceColor & 7) << 2) |
      ((s.soundBits & 0xf) << 5) |
      ((s.mute ? 1 : 0) << 8) |
      ((s.capture ? 1 : 0) << 9)) >>>
    0
  );
}

// A corner object word (newserv comment: ---VHCCCZZZZZZZZ).
export function decodeCornerObject(v: number): CornerObject {
  return {
    object: v & 0xff,
    color: (v >>> 8) & 7,
    reverseH: ((v >>> 11) & 1) !== 0,
    reverseV: ((v >>> 12) & 1) !== 0,
  };
}

export function encodeCornerObject(c: CornerObject): number {
  return ((c.object & 0xff) | ((c.color & 7) << 8) | ((c.reverseH ? 1 : 0) << 11) | ((c.reverseV ? 1 : 0) << 12)) & 0xffff;
}

export function emptyChat(): SymbolChat {
  return {
    spec: 0,
    cornerObjects: [0xffff, 0xffff, 0xffff, 0xffff],
    faceParts: Array.from({ length: 12 }, () => ({ type: SYMBOL_CHAT_NO_FACE, x: 0, y: 0, flags: 0 })),
  };
}

// The 0x3C-byte SymbolChatT at `off`.
export function parseSymbolChat(data: Uint8Array, off: number): SymbolChat {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chat = emptyChat();
  chat.spec = dv.getUint32(off, true);
  for (let i = 0; i < 4; i++) chat.cornerObjects[i] = dv.getUint16(off + 4 + i * 2, true);
  for (let i = 0; i < 12; i++) {
    const o = off + 0x0c + i * 4;
    chat.faceParts[i] = { type: data[o]!, x: data[o + 1]!, y: data[o + 2]!, flags: data[o + 3]! };
  }
  return chat;
}

export function writeSymbolChat(dst: Uint8Array, off: number, chat: SymbolChat): void {
  const dv = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);
  dv.setUint32(off, chat.spec >>> 0, true);
  for (let i = 0; i < 4; i++) dv.setUint16(off + 4 + i * 2, (chat.cornerObjects[i] ?? 0xffff) & 0xffff, true);
  for (let i = 0; i < 12; i++) {
    const f = chat.faceParts[i] ?? { type: SYMBOL_CHAT_NO_FACE, x: 0, y: 0, flags: 0 };
    const o = off + 0x0c + i * 4;
    dst[o] = f.type & 0xff;
    dst[o + 1] = f.x & 0xff;
    dst[o + 2] = f.y & 0xff;
    dst[o + 3] = f.flags & 0xff;
  }
}

// The 12 entries of the character file (E7 data, PSOBBCharacterFile at 0x1ACC).
export function parseSymbolChats(full: Uint8Array): SymbolChatEntry[] {
  const out: SymbolChatEntry[] = [];
  const dv = new DataView(full.buffer, full.byteOffset, full.byteLength);
  for (let i = 0; i < SYMBOL_CHAT_COUNT; i++) {
    const o = SYMBOL_CHAT_FILE_OFFSET + i * SYMBOL_CHAT_ENTRY_SIZE;
    out.push({
      present: dv.getUint32(o, true),
      name: readUtf16(full, o + SYMBOL_CHAT_NAME_OFFSET, SYMBOL_CHAT_NAME_CHARS).replace(/^\t[A-Z]/, ''),
      chat: parseSymbolChat(full, o + SYMBOL_CHAT_SPEC_OFFSET),
    });
  }
  return out;
}

// The 0x02ED body (C_UpdateSymbolChats_BB_02ED): the 12 entries, 0x4E0 bytes. The
// name is written as given (UTF-16, cut at 0x14 chars, zero terminated).
export function symbolChatsPayload(entries: readonly SymbolChatEntry[]): Uint8Array {
  const out = new Uint8Array(SYMBOL_CHAT_COUNT * SYMBOL_CHAT_ENTRY_SIZE);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < SYMBOL_CHAT_COUNT; i++) {
    const e = entries[i];
    const o = i * SYMBOL_CHAT_ENTRY_SIZE;
    if (!e) continue;
    dv.setUint32(o, e.present >>> 0, true);
    const n = e.name.slice(0, SYMBOL_CHAT_NAME_CHARS - 1);
    for (let k = 0; k < n.length; k++) dv.setUint16(o + SYMBOL_CHAT_NAME_OFFSET + k * 2, n.charCodeAt(k), true);
    writeSymbolChat(out, o + SYMBOL_CHAT_SPEC_OFFSET, e.chat);
  }
  return out;
}

// Replaces the 12 entries of a full character (E7 data) in place.
export function writeSymbolChats(full: Uint8Array | null, entries: readonly SymbolChatEntry[]): void {
  if (!full || full.length < SYMBOL_CHAT_FILE_OFFSET + SYMBOL_CHAT_COUNT * SYMBOL_CHAT_ENTRY_SIZE) return;
  full.set(symbolChatsPayload(entries), SYMBOL_CHAT_FILE_OFFSET);
}

// The 6x07 subcommand payload, after the 4-byte subcommand header that
// sendSubcommand writes: u32 client id (the sender's lobby id, the server
// compares it with ours), then the SymbolChatT: 0x40 bytes.
export function symbolChatSubcommandPayload(clientId: number, chat: SymbolChat): Uint8Array {
  const out = new Uint8Array(4 + SYMBOL_CHAT_SIZE);
  new DataView(out.buffer).setUint32(0, clientId >>> 0, true);
  writeSymbolChat(out, 4, chat);
  return out;
}

// Reads a 6x07 body (the whole subcommand, 0x44 bytes, header included).
export function parseSymbolChatSubcommand(body: Uint8Array): { clientId: number; chat: SymbolChat } | null {
  if (body.length < 4 + 4 + SYMBOL_CHAT_SIZE || body[0] !== SYMBOL_CHAT_SUBCOMMAND) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { clientId: dv.getUint32(4, true), chat: parseSymbolChat(body, 8) };
}
