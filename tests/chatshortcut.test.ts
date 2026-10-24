// Chat shortcuts: the save records (net/chatshortcut.ts, newserv SaveFileShortcutEntryBB
// at PSOBBCharacterFile 0x1FAC) and the key that sends each slot (input/shortcuts.ts
// chatShortcutIndex = handle_chat_shortcuts, dump 674857), with the Function Key option
// 0x2000000 (chatFormOption) that swaps plain F keys and Shift+F.
// Run: node tests/chatshortcut.test.ts
import {
  CHAT_SHORTCUT_FILE_OFFSET,
  CHAT_SHORTCUT_STRIDE,
  CHAT_SHORTCUTS_COMMAND,
  CHAT_SHORTCUTS_FLAG,
  chatShortcutsPayload,
  clearChatShortcut,
  emptyWordSelect,
  encodeChatShortcut,
  parseChatShortcut,
  wordSelectSubcommandPayload,
  writeChatShortcut,
  type ChatShortcut,
} from '../client/src/net/chatshortcut.ts';
import { SYMBOL_CHAT_FILE_OFFSET } from '../client/src/net/symbolchat.ts';
import { chatFormOption, chatShortcutIndex, functionKeyAction } from '../client/src/input/shortcuts.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// A full character with records written the way the save stores them: u32 type, then
// UTF-16 text (text) or a u32 index of a saved symbol chat (symbol) at +4, 0xA4 bytes per record.
const FULL_SIZE = CHAT_SHORTCUT_FILE_OFFSET + 16 * CHAT_SHORTCUT_STRIDE;
function character(optionFlags = 0): Uint8Array {
  const full = new Uint8Array(FULL_SIZE);
  const dv = new DataView(full.buffer);
  dv.setUint32(0x4ec, optionFlags >>> 0, true);
  const writeText = (index: number, text: string) => {
    const o = CHAT_SHORTCUT_FILE_OFFSET + index * CHAT_SHORTCUT_STRIDE;
    dv.setUint32(o, 1, true);
    for (let i = 0; i < text.length; i++) dv.setUint16(o + 4 + i * 2, text.charCodeAt(i), true);
  };
  writeText(0, 'hi all');
  writeText(5, '\tEtagged');
  // Saved symbol chat 0 is present, with spec 0x120 (SymbolChatT at its entry +0x2c).
  dv.setUint32(SYMBOL_CHAT_FILE_OFFSET, 1, true);
  dv.setUint32(SYMBOL_CHAT_FILE_OFFSET + 0x2c, 0x120, true);
  // Slot 3: a symbol chat (type 3) that points at saved chat 0 (record +4 = the index).
  const s = CHAT_SHORTCUT_FILE_OFFSET + 3 * CHAT_SHORTCUT_STRIDE;
  dv.setUint32(s, 3, true);
  dv.setUint32(s + 4, 0, true);
  // Slot 8: a symbol chat that points at saved chat 5, which is not present.
  dv.setUint32(CHAT_SHORTCUT_FILE_OFFSET + 8 * CHAT_SHORTCUT_STRIDE, 3, true);
  dv.setUint32(CHAT_SHORTCUT_FILE_OFFSET + 8 * CHAT_SHORTCUT_STRIDE + 4, 5, true);
  // Slot 7: word select (type 2): no text, no symbol.
  dv.setUint32(CHAT_SHORTCUT_FILE_OFFSET + 7 * CHAT_SHORTCUT_STRIDE, 2, true);
  return full;
}

// The records.
const full = character();
eq(parseChatShortcut(full, 0), { type: 1, text: 'hi all', symbolIndex: 0, symbol: null, word: null }, 'record 0: text');
eq(parseChatShortcut(full, 5), { type: 1, text: 'tagged', symbolIndex: 0, symbol: null, word: null }, 'record 5: the \\tE marker is stripped');
eq(parseChatShortcut(full, 1)?.type, 0, 'record 1: empty (type 0)');
eq(parseChatShortcut(full, 3)?.symbol?.spec, 0x120, 'record 3: the symbol is the saved chat its index names (0)');
eq(parseChatShortcut(full, 3)?.symbolIndex, 0, 'record 3: the index is the record +4');
eq(parseChatShortcut(full, 3)?.text, '', 'record 3: no text');
eq(parseChatShortcut(full, 8)?.symbol, null, 'record 8: a symbol that names an empty saved chat has no chat to send');
eq(parseChatShortcut(full, 8)?.symbolIndex, 5, 'record 8: the index is kept');
eq(parseChatShortcut(full, 7), { type: 2, text: '', symbolIndex: 0, symbol: null, word: emptyWordSelect() }, 'record 7: word select, all-zero message');
eq(parseChatShortcut(null, 0), null, 'no character: no record');
eq(parseChatShortcut(full, 16), null, 'slot 16 is past the save array');
eq(parseChatShortcut(new Uint8Array(0x100), 0), null, 'a short buffer: no record');
eq(CHAT_SHORTCUT_FILE_OFFSET, 0x1fac, 'the records start at 0x1FAC (after the symbol chats)');
eq(CHAT_SHORTCUT_STRIDE, 0xa4, 'the record is 0xA4 bytes (SaveFileShortcutEntryBB)');

// The option: bit 0x2000000 (Function Key: Chat Shortcuts).
eq(chatFormOption(character(0)), false, 'option clear: menu form');
eq(chatFormOption(character(0x2000000)), true, 'option set: chat form');
eq(chatFormOption(character(0x1000000)), false, 'the keyboard controls bit is not the chat form');
eq(chatFormOption(null), false, 'no character: menu form');

// The key that sends a slot. Menu form (option clear): Shift+F sends a chat slot, plain
// F does not (it is the menu key).
const key = (k: string, shift = false, ctrl = false, alt = false) => ({ key: k, shiftKey: shift, ctrlKey: ctrl, altKey: alt });
eq(chatShortcutIndex(key('F1', true), false), 0, 'menu form: Shift+F1 is slot 0');
eq(chatShortcutIndex(key('F2', true), false), 1, 'menu form: Shift+F2 is slot 1');
eq(chatShortcutIndex(key('F12', true), false), 11, 'menu form: Shift+F12 is slot 11 (0xb)');
eq(chatShortcutIndex(key('F2', false), false), -1, 'menu form: plain F2 is not a chat slot');
eq(chatShortcutIndex(key('F2', true, true), false), -1, 'menu form: Ctrl+Shift+F2 is none');
eq(chatShortcutIndex(key('F2', true, false, true), false), -1, 'menu form: Alt+Shift+F2 is none');
eq(chatShortcutIndex(key('a', true), false), -1, 'a letter is not a function key');
eq(chatShortcutIndex(key('F13', true), false), -1, 'F13 is not a slot');

// Chat form (option set): plain F keys send the slots, Shift+F is the menu.
eq(chatShortcutIndex(key('F1'), true), 0, 'chat form: plain F1 is slot 0');
eq(chatShortcutIndex(key('F12'), true), 11, 'chat form: plain F12 is slot 11');
eq(chatShortcutIndex(key('F1', true), true), -1, 'chat form: Shift+F1 is not a chat slot');

// The menu side mirrors it (functionKeyAction): with the chat form on, plain F keys are
// not menu keys and Shift+F opens the menu leaf.
const names = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'];
eq(functionKeyAction({ key: 'F2', shiftKey: false, ctrlKey: false, altKey: false }, names, true), null, 'chat form: plain F2 is no menu');
eq(functionKeyAction({ key: 'F2', shiftKey: true, ctrlKey: false, altKey: false }, names, true), { kind: 'menu', id: 0x09 }, 'chat form: Shift+F2 opens Equip');
eq(functionKeyAction({ key: 'F2', shiftKey: false, ctrlKey: false, altKey: false }, names, false), { kind: 'menu', id: 0x09 }, 'menu form: plain F2 opens Equip');
eq(functionKeyAction({ key: 'F2', shiftKey: true, ctrlKey: false, altKey: false }, names, false), null, 'menu form: Shift+F2 is no menu');

// The save side: a word select record round-trips through the save copy (the 0x1C-byte
// WordSelectMessageT at record +4, LE on BB), a text record keeps its line as typed.
const word = { numTokens: 2, targetType: 0x0100, tokens: [0x0001, 0x0203, 0, 0, 0, 0, 0, 0], numericParameter: 0x11223344, unknownA4: 0xa4 };
const save = character();
eq(writeChatShortcut(save, 7, { type: 2, text: '', symbol: null, word }), true, 'write: word select slot 7');
eq(parseChatShortcut(save, 7)?.word, word, 'word select round trip');
eq(new DataView(save.buffer).getUint16(CHAT_SHORTCUT_FILE_OFFSET + 7 * CHAT_SHORTCUT_STRIDE + 4, true), 2, 'word select: num_tokens at record +4');
eq(new DataView(save.buffer).getUint32(CHAT_SHORTCUT_FILE_OFFSET + 7 * CHAT_SHORTCUT_STRIDE + 0x18, true), 0x11223344, 'word select: numeric parameter at message +0x14');
eq(writeChatShortcut(save, 2, { type: 1, text: 'a line typed', symbol: null, word: null }), true, 'write: text slot 2');
eq(parseChatShortcut(save, 2), { type: 1, text: 'a line typed', symbolIndex: 0, symbol: null, word: null }, 'text round trip, no marker');
eq(encodeChatShortcut({ type: 1, text: 'x'.repeat(0x60), symbol: null, word: null }).length, CHAT_SHORTCUT_STRIDE, 'a long text is cut to the record');
writeChatShortcut(save, 2, { type: 1, text: 'x'.repeat(0x60), symbol: null, word: null });
eq(parseChatShortcut(save, 2)?.text, 'x'.repeat(0x4f), 'a long text keeps 0x4F characters and the terminator');
eq(writeChatShortcut(save, 16, { type: 1, text: 'no', symbol: null, word: null }), false, 'write: slot 16 is refused');
eq(writeChatShortcut(null, 0, { type: 1, text: 'no', symbol: null, word: null }), false, 'write: no character is refused');

// The symbol record: the index written at record +4 reads back, and the saved chat it names is
// the symbol (the picker's value, ChatShortcutMenu_CheckListWindowState).
const symRecord: ChatShortcut = { type: 3, text: '', symbolIndex: 0, symbol: null, word: null };
eq(writeChatShortcut(save, 4, symRecord), true, 'write: symbol slot 4');
eq(new DataView(save.buffer).getUint32(CHAT_SHORTCUT_FILE_OFFSET + 4 * CHAT_SHORTCUT_STRIDE + 4, true), 0, 'symbol record: the index is at record +4');
eq(parseChatShortcut(save, 4)?.symbol?.spec, 0x120, 'symbol record round trip: the saved chat');
eq(parseChatShortcut(save, 3)?.symbol?.spec, 0x120, 'symbol record of slot 3 is untouched by the slot 4 write');
// A clear sets only the type word (ChatMessage_ClearType_0077d6bc).
eq(clearChatShortcut(save, 4), true, 'clear: slot 4');
eq(parseChatShortcut(save, 4)?.type, 0, 'clear: the type is 0 (empty)');
eq(clearChatShortcut(save, 16), false, 'clear: slot 16 is refused');

// The 03ED body (send_packet0xed_subcommand3, dump 813730): 0xA40 bytes from the record
// block, the frame is command 0xED flag 3.
const body = chatShortcutsPayload(save);
eq(body?.length, 0xa40, '03ED body is 0xA40 bytes (16 records)');
eq(body ? Array.from(body.slice(0x20, 0x20 + 4)) : null, Array.from(save.slice(CHAT_SHORTCUT_FILE_OFFSET + 0x20, CHAT_SHORTCUT_FILE_OFFSET + 0x24)), '03ED body is the save copy from 0x1FAC');
eq(chatShortcutsPayload(new Uint8Array(0x100)), null, '03ED: a short buffer gives no body');
eq([CHAT_SHORTCUTS_COMMAND, CHAT_SHORTCUTS_FLAG], [0xed, 3], '03ED: command 0xED, flag 3');

// The 6x74 payload after the 4-byte header: 0x1C bytes, the message layout.
const wp = wordSelectSubcommandPayload(word);
eq(wp.length, 0x1c, '6x74 payload is 0x1C bytes');
eq(new DataView(wp.buffer).getUint16(6, true), 0x0203, '6x74 payload: the second token (message +4 +2)');
eq(new DataView(wp.buffer).getUint32(0x14, true), 0x11223344, '6x74 payload: the numeric parameter');
eq(wordSelectSubcommandPayload(emptyWordSelect()).every((v) => v === 0), true, '6x74 payload: the empty message is zero');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('chatshortcut: all checks passed');
