// Symbol chats (BB): the spec word, the corner objects and face parts, the
// 12 entries in the character file (0x1ACC, 0x68 stride, the exe's
// GetChatMessagePtr_0077d8d0 stride and spec offset 0x2C), the 0x02ED save body
// (0x4E0) and the 6x07 subcommand (0x44 bytes, the server's client id check).
// Layouts from newserv (SaveFileFormats.hh, PlayerSubordinates.hh,
// CommandFormats.hh, SaveFileFormats.cc DEFAULT_SYMBOL_CHATS).
// Run: node tests/symbolchat.test.ts
import {
  decodeCornerObject,
  decodeSpec,
  emptyChat,
  encodeCornerObject,
  encodeSpec,
  parseSymbolChat,
  parseSymbolChatSubcommand,
  parseSymbolChats,
  SYMBOL_CHAT_COUNT,
  SYMBOL_CHAT_ENTRY_SIZE,
  SYMBOL_CHAT_FILE_OFFSET,
  SYMBOL_CHAT_SIZE,
  SYMBOL_CHAT_SUBCOMMAND,
  symbolChatSubcommandPayload,
  symbolChatsPayload,
  writeSymbolChat,
  writeSymbolChats,
  type SymbolChat,
  type SymbolChatEntry,
} from '../client/src/net/symbolchat.ts';
import { parseCharacterFile, E7_SIZE } from '../client/src/net/charfile.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
}

// newserv DEFAULT_SYMBOL_CHATS[0] ("Hello", the \tE marker in the stored name).
const HELLO: SymbolChatEntry = {
  present: 1,
  name: 'Hello',
  chat: {
    spec: 0x28,
    cornerObjects: [0xffff, 0x000d, 0xffff, 0xffff],
    faceParts: [
      { type: 0x05, x: 0x18, y: 0x1d, flags: 0x00 },
      { type: 0x05, x: 0x28, y: 0x1d, flags: 0x01 },
      { type: 0x36, x: 0x20, y: 0x2a, flags: 0x00 },
      { type: 0x3c, x: 0x00, y: 0x32, flags: 0x00 },
      { type: 0xff, x: 0, y: 0, flags: 0 },
      { type: 0xff, x: 0, y: 0, flags: 0 },
      { type: 0xff, x: 0, y: 0, flags: 0 },
      { type: 0xff, x: 0, y: 0, flags: 0x02 },
      { type: 0xff, x: 0, y: 0, flags: 0x02 },
      { type: 0xff, x: 0, y: 0, flags: 0x02 },
      { type: 0xff, x: 0, y: 0, flags: 0x02 },
      { type: 0xff, x: 0, y: 0, flags: 0x02 },
    ],
  },
};

function fullFile(): Uint8Array {
  return new Uint8Array(E7_SIZE);
}

// Sizes (newserv static checks).
check('BB entry is 0x68 bytes', SYMBOL_CHAT_ENTRY_SIZE === 0x68);
check('SymbolChatT is 0x3C bytes', SYMBOL_CHAT_SIZE === 0x3c);
check('12 entries', SYMBOL_CHAT_COUNT === 12);
check('02ED body is 0x4E0 bytes', symbolChatsPayload([]).length === 0x4e0);
check('the entries end where the shortcuts start (0x1FAC)', SYMBOL_CHAT_FILE_OFFSET + 0x4e0 === 0x1fac);
check('6x07 subcommand is 0x44 bytes', 4 + 4 + SYMBOL_CHAT_SIZE === 0x44);

// Spec word (newserv: ----------------------DMSSSCCCFF).
{
  const s = decodeSpec(0x28);
  check('spec 0x28: face shape 0, colour 2, sound 1', s.faceShape === 0 && s.faceColor === 2 && s.soundBits === 1, JSON.stringify(s));
  check('spec 0x28: no mute, no capture', !s.mute && !s.capture);
  const t = decodeSpec(0x74);
  check('spec 0x74 (Good-bye): colour 5, sound 3', t.faceColor === 5 && t.soundBits === 3, JSON.stringify(t));
  const c = decodeSpec(0x200 | 0x100 | 0x03);
  // Bits 5-8 are the exe's `spec >> 5 & 0xf`, so bit 8 (mute) reads as sound 8 there (ASSUMED, symbolchat.ts).
  check('spec bit 9 is capture, bit 8 is mute (and sound 8 in the exe)', c.capture && c.mute && c.faceShape === 3 && c.soundBits === 8);
  let rt = true;
  for (let spec = 0; spec < 0x400; spec++) if (encodeSpec(decodeSpec(spec)) !== spec) rt = false;
  check('spec encode/decode round-trips all 10 used bits', rt);
}

// Corner objects (---VHCCCZZZZZZZZ).
{
  const none = decodeCornerObject(0xffff);
  check('corner 0xFFFF: no object (Z = 0xFF)', none.object === 0xff);
  const v = decodeCornerObject(0x1000 | 0x0800 | 0x0500 | 0x42);
  check('corner: Z, C, H, V bits', v.object === 0x42 && v.color === 5 && v.reverseH && v.reverseV, JSON.stringify(v));
  check('corner round-trip', encodeCornerObject(v) === 0x1000 | 0x0800 | 0x0500 | 0x42);
}

// The file: 12 entries at 0x1ACC, name and spec placement.
{
  const full = fullFile();
  writeSymbolChats(full, [HELLO]);
  const dv = new DataView(full.buffer);
  check('entry 0 present flag at 0x1ACC', dv.getUint32(0x1acc, true) === 1);
  check('spec of entry 0 at +0x2C (exe ChatMessage sound reads param[0xb])', dv.getUint32(0x1acc + 0x2c, true) === 0x28);
  const back = parseSymbolChats(full);
  check('12 entries are parsed', back.length === 12);
  check('entry 0 name', back[0]!.name === 'Hello', back[0]!.name);
  check('entry 0 present', back[0]!.present === 1);
  check('entry 0 chat round-trips', JSON.stringify(back[0]!.chat) === JSON.stringify(HELLO.chat), JSON.stringify(back[0]!.chat));
  check('empty entries parse as not present', back[1]!.present === 0 && back[11]!.present === 0);
  const blank = fullFile();
  writeSymbolChats(blank, Array.from({ length: 12 }, () => ({ present: 0, name: '', chat: emptyChat() })));
  check('an emptied entry writes no face parts (type 0xFF)', parseSymbolChats(blank)[5]!.chat.faceParts.every((f) => f.type === 0xff));
}

// The name's language marker is stripped on read (charfile.ts does the same).
{
  const full = fullFile();
  writeSymbolChats(full, [{ ...HELLO, name: 'Hi' }]);
  // Store the marked form by hand: "\tE" + "Hi" as UTF-16.
  const dv = new DataView(full.buffer);
  [0x09, 0x45, 0x48, 0x69].forEach((c, i) => dv.setUint16(0x1acc + 4 + i * 2, c, true));
  check('the \\tE language marker is stripped from the name', parseSymbolChats(full)[0]!.name === 'Hi');
}

// 02ED: the body is the same bytes as the file's 12 entries.
{
  const full = fullFile();
  const entries: SymbolChatEntry[] = Array.from({ length: 12 }, (_, i) => (i === 3 ? { ...HELLO, name: 'Bye' } : { present: 0, name: '', chat: emptyChat() }));
  writeSymbolChats(full, entries);
  const body = symbolChatsPayload(entries);
  check('02ED body equals the file block', body.every((b, i) => b === full[0x1acc + i]));
  const again = parseSymbolChats(full);
  check('save / load keeps entry 3', again[3]!.name === 'Bye' && again[3]!.chat.spec === 0x28);
  check('save keeps the other entries empty', again[0]!.present === 0 && again[11]!.present === 0);
}

// Full character parse: the 12 entries come with the rest of E7.
{
  const full = fullFile();
  writeSymbolChats(full, [HELLO]);
  const cf = parseCharacterFile(full);
  check('parseCharacterFile fills symbolChats', cf.symbolChats.length === 12 && cf.symbolChats[0]!.name === 'Hello');
}

// 6x07: payload = client id + SymbolChatT; the body carries the 4-byte header.
{
  const chat: SymbolChat = HELLO.chat;
  const payload = symbolChatSubcommandPayload(7, chat);
  check('6x07 payload is 0x40 bytes', payload.length === 0x40);
  const body = new Uint8Array(4 + payload.length);
  body[0] = SYMBOL_CHAT_SUBCOMMAND;
  body[1] = body.length / 4; // 0x11
  new DataView(body.buffer).setUint16(2, 99, true); // the sender's header field (sendSubcommand)
  body.set(payload, 4);
  check('6x07 body size word is 0x11', body[1] === 0x11);
  const got = parseSymbolChatSubcommand(body);
  check('6x07 parses the client id', got?.clientId === 7, String(got?.clientId));
  check('6x07 chat round-trips', JSON.stringify(got?.chat) === JSON.stringify(chat));
  const wrong = new Uint8Array(body);
  wrong[0] = 0x06;
  check('6x07 rejects another subcommand', parseSymbolChatSubcommand(wrong) === null);
  check('6x07 rejects a short body', parseSymbolChatSubcommand(body.subarray(0, 0x20)) === null);
}

// parseSymbolChat / writeSymbolChat at an arbitrary offset.
{
  const buf = new Uint8Array(0x3c + 8);
  const chat = emptyChat();
  chat.spec = 0x74;
  chat.cornerObjects[2] = 0x0476;
  writeSymbolChat(buf, 8, chat);
  check('SymbolChatT parses at an offset', JSON.stringify(parseSymbolChat(buf, 8)) === JSON.stringify(chat));
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
