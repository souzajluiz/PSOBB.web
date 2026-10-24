// Chat shortcuts: the save records (net/chatshortcut.ts, newserv SaveFileShortcutEntryBB
// at PSOBBCharacterFile 0x1FAC) and the key that sends each slot (input/shortcuts.ts
// chatShortcutIndex = handle_chat_shortcuts, dump 674857), with the Function Key option
// 0x2000000 (chatFormOption) that swaps plain F keys and Shift+F.
// Run: node tests/chatshortcut.test.ts
import { CHAT_SHORTCUT_FILE_OFFSET, CHAT_SHORTCUT_STRIDE, parseChatShortcut } from '../client/src/net/chatshortcut.ts';
import { chatFormOption, chatShortcutIndex, functionKeyAction } from '../client/src/input/shortcuts.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// A full character with records written the way the save stores them: u32 type, then
// UTF-16 text (text) or a SymbolChatT (symbol) at +4, 0xA4 bytes per record.
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
  // Slot 3: a symbol chat (type 3) with spec 0x120 at SymbolChatT +0 (record +4).
  const s = CHAT_SHORTCUT_FILE_OFFSET + 3 * CHAT_SHORTCUT_STRIDE;
  dv.setUint32(s, 3, true);
  dv.setUint32(s + 4, 0x120, true);
  // Slot 7: word select (type 2): no text, no symbol.
  dv.setUint32(CHAT_SHORTCUT_FILE_OFFSET + 7 * CHAT_SHORTCUT_STRIDE, 2, true);
  return full;
}

// The records.
const full = character();
eq(parseChatShortcut(full, 0), { type: 1, text: 'hi all', symbol: null }, 'record 0: text');
eq(parseChatShortcut(full, 5), { type: 1, text: 'tagged', symbol: null }, 'record 5: the \\tE marker is stripped');
eq(parseChatShortcut(full, 1)?.type, 0, 'record 1: empty (type 0)');
eq(parseChatShortcut(full, 3)?.symbol?.spec, 0x120, 'record 3: a symbol chat keeps its spec');
eq(parseChatShortcut(full, 3)?.text, '', 'record 3: no text');
eq(parseChatShortcut(full, 7), { type: 2, text: '', symbol: null }, 'record 7: word select has no text here');
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

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('chatshortcut: all checks passed');
