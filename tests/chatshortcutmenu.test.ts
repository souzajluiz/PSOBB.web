// The Chat > Shortcut leaf (Home menu 0x11, classic/chatshortcutmenu.ts): the slot list and its
// pages, the action rows, the text keyboard, the symbol picker, the Yes / No confirms and the
// 03ED send on close (classic/homeleaves.ts). The state flow is PsoBB.exe
// ChatShortcutMenu_Process_00754cd8 (dump Psobb.exe-05112026.c line 726760).
// Run: node tests/chatshortcutmenu.test.ts
import { KEYS } from '../client/src/input/keyconfig.ts';
import {
  CHAT_SHORTCUT_FILE_OFFSET,
  CHAT_SHORTCUT_STRIDE,
  parseChatShortcut,
} from '../client/src/net/chatshortcut.ts';
import { SYMBOL_CHAT_FILE_OFFSET } from '../client/src/net/symbolchat.ts';
import { setWordSelectTable } from '../client/src/net/wordselect.ts';

// The Question and the text helpers measure on an OffscreenCanvas (gametext.ts).
const measure = new Proxy({} as Record<string, unknown>, {
  get: (t, p) => (p in t ? t[p as string] : p === 'measureText' ? () => ({ width: 7 }) : p === 'getImageData' ? () => ({ data: new Uint8ClampedArray(64) }) : () => undefined),
  set: (t, p, v) => {
    t[p as string] = v;
    return true;
  },
});
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext() {
    return measure;
  }
};
const { ChatShortcutMenu, SHORTCUT_TEXT } = await import('../client/src/classic/chatshortcutmenu.ts');
const { HomeLeaves } = await import('../client/src/classic/homeleaves.ts');

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

// Key names as the views deliver them: KEYS holds lower-case DOM names.
KEYS.selectUp = 'arrowup';
KEYS.selectDown = 'arrowdown';
KEYS.selectLeft = 'arrowleft';
KEYS.selectRight = 'arrowright';
KEYS.decide = 'enter';
KEYS.cancel = 'x';
KEYS.symbolChat = 'tab';
const press = (k: string) => ({ key: k, preventDefault() {} }) as unknown as KeyboardEvent;
// A context that accepts every call (the window drawing is checked for errors only).
const ctx = new Proxy({} as Record<string, unknown>, {
  get: (t, p) => (p in t ? t[p as string] : (p === 'measureText' ? () => ({ width: 7 }) : () => undefined)),
  set: (t, p, v) => {
    t[p as string] = v;
    return true;
  },
}) as unknown as CanvasRenderingContext2D;

// A save copy: record 0 is text "hi all", record 2 is an empty text, saved symbol chat 0 is
// present (spec 0x120) and record 5 is a symbol chat that names saved chat 0.
const FULL = CHAT_SHORTCUT_FILE_OFFSET + 16 * CHAT_SHORTCUT_STRIDE;
function save(): Uint8Array {
  const full = new Uint8Array(FULL);
  const dv = new DataView(full.buffer);
  const writeText = (i: number, t: string) => {
    const o = CHAT_SHORTCUT_FILE_OFFSET + i * CHAT_SHORTCUT_STRIDE;
    dv.setUint32(o, 1, true);
    for (let k = 0; k < t.length; k++) dv.setUint16(o + 4 + k * 2, t.charCodeAt(k), true);
  };
  writeText(0, 'hi all');
  dv.setUint32(SYMBOL_CHAT_FILE_OFFSET, 1, true);
  dv.setUint32(SYMBOL_CHAT_FILE_OFFSET + 0x2c, 0x120, true);
  dv.setUint32(CHAT_SHORTCUT_FILE_OFFSET + 5 * CHAT_SHORTCUT_STRIDE, 3, true);
  dv.setUint32(CHAT_SHORTCUT_FILE_OFFSET + 5 * CHAT_SHORTCUT_STRIDE + 4, 0, true);
  return full;
}

const text = (g: number, i: number) => `t${g}.${i}`;
type Closed = { picked: boolean }[];
function leaf(full: Uint8Array) {
  const closed: Closed = [];
  const menu = new ChatShortcutMenu({
    text,
    full: () => full,
    onClose: (picked) => closed.push({ picked }),
  });
  return { menu, closed };
}

// The slot list starts on slot 0 (page 0, row 0). Enter on an empty slot opens the actions.
{
  const full = save();
  const { menu, closed } = leaf(full);
  check(menu.open && menu.phase === 'slots' && menu.selectedSlot === 0, 'the leaf opens on the slot list at slot 0');
  menu.key(press('ArrowDown'));
  check(menu.selectedSlot === 1, 'Down moves to slot 1');
  menu.key(press('ArrowDown'));
  menu.key(press('ArrowDown'));
  menu.key(press('ArrowDown'));
  check(menu.selectedSlot === 0, 'the page wraps over its 4 rows');
  menu.key(press('ArrowRight'));
  check(menu.selectedSlot === 4, 'Right pages to page 1 (slot 4)');
  menu.key(press('ArrowLeft'));
  check(menu.selectedSlot === 0, 'Left pages back to page 0');
  menu.key(press('x'));
  check(!menu.open && closed.length === 1 && closed[0].picked === false, 'Cancel closes the leaf with no pick (no 03ED)');
  menu.key(press('Enter'));
  check(closed.length === 1, 'a closed leaf takes no key');
}

// Edit an empty slot: Enter -> the actions, Edit -> the keyboard -> type -> Enter -> Yes writes it.
{
  const full = save();
  const { menu, closed } = leaf(full);
  menu.key(press('ArrowDown'));
  menu.key(press('ArrowDown')); // slot 2 (an empty record)
  menu.key(press('Enter'));
  check(menu.phase === 'actions', 'Enter on a slot opens its action list');
  menu.key(press('Enter')); // Edit (row 0)
  check(menu.phase === 'keyboard', 'Edit opens the text keyboard');
  for (const c of 'abc') menu.key(press(c));
  menu.key(press('Backspace'));
  menu.key(press('d'));
  check(menu.value === 'abd', 'the keyboard types and backspaces');
  menu.key(press('Enter'));
  check(menu.phase === 'confirm' && menu.pendingRecord?.text === 'abd', 'Enter on the keyboard asks the confirm with the text');
  menu.key(press('Enter')); // Yes (the copy confirm starts on Yes)
  check(menu.phase === 'slots', 'Yes returns to the slot list');
  const rec = parseChatShortcut(full, 2);
  check(rec?.type === 1 && rec.text === 'abd', 'Yes copies the text record into slot 2 of the save copy');
  menu.key(press('x'));
  check(closed.length === 1 && closed[0].picked === true, 'closing after an action sends the 03ED (picked)');
}

// A text confirm answered with No writes nothing, and Escape on the keyboard writes nothing.
{
  const full = save();
  const before = Uint8Array.from(full);
  const { menu, closed } = leaf(full);
  menu.key(press('Enter')); // slot 0 (text "hi all")
  menu.key(press('Enter')); // Edit
  menu.key(press('q'));
  menu.key(press('Escape'));
  check(menu.phase === 'slots', 'Escape on the keyboard returns to the slot list');
  check(Array.from(full).every((v, i) => v === before[i]), 'Escape writes nothing');
  menu.key(press('Enter')); // slot 0 again: the action list
  menu.key(press('Enter')); // Edit
  menu.key(press('q'));
  menu.key(press('Enter')); // confirm
  menu.key(press('ArrowDown')); // No
  menu.key(press('Enter'));
  check(menu.phase === 'slots' && parseChatShortcut(full, 0)?.text === 'hi all', 'No keeps the record');
  menu.key(press('x'));
  check(closed[0]?.picked === true, 'a picked action counts even when nothing was written (exe +0x28)');
}

// Clear: the clear row of a text slot, No (the default) goes back to the actions, Yes clears.
{
  const full = save();
  const { menu } = leaf(full);
  menu.key(press('Enter')); // slot 0
  menu.key(press('ArrowDown')); // Clear row
  menu.key(press('Enter'));
  check(menu.phase === 'clearConfirm', 'Clear opens its confirm');
  menu.key(press('Enter')); // No is the default
  check(menu.phase === 'actions', 'the clear confirm on No goes back to the actions');
  menu.key(press('Enter')); // the list kept its cursor on Clear
  menu.key(press('ArrowUp')); // Yes
  menu.key(press('Enter'));
  check(menu.phase === 'slots', 'Yes on the clear confirm returns to the slot list');
  check(parseChatShortcut(full, 0)?.type === 0, 'Yes clears the slot (type 0)');
}

// The Clear row is disabled on an empty slot: Enter buzzes and the list stays.
{
  const full = save();
  const { menu } = leaf(full);
  menu.key(press('ArrowDown')); // slot 1: empty
  menu.key(press('Enter'));
  menu.key(press('ArrowDown'));
  menu.key(press('Enter'));
  check(menu.phase === 'actions', 'Clear is refused on an empty slot');
}

// A symbol record: the Symbol Chat key in the keyboard opens the picker over the saved chats;
// row 0 is valid, row 1 is empty (refused); the pick writes the index at the record's +4.
{
  const full = save();
  const { menu } = leaf(full);
  menu.key(press('ArrowDown'));
  menu.key(press('ArrowDown'));
  menu.key(press('ArrowDown')); // slot 3, empty
  menu.key(press('Enter'));
  menu.key(press('Enter')); // Edit
  menu.key(press('Tab')); // the symbol key: the word picker first (the mode starts at word)
  check(menu.phase === 'wordPicker', 'the Symbol Chat key opens the word picker first');
  menu.key(press('x')); // Cancel: back to the keyboard
  check(menu.phase === 'keyboard', 'Cancel in the word picker returns to the keyboard');
  menu.key(press('Tab')); // the next Symbol Chat key: the symbol picker
  check(menu.phase === 'picker', 'the next Symbol Chat key opens the symbol picker');
  menu.key(press('ArrowDown')); // row 1: an empty saved chat
  menu.key(press('Enter'));
  check(menu.phase === 'picker', 'an empty saved chat cannot be picked');
  menu.key(press('ArrowUp')); // row 0
  menu.key(press('Enter'));
  check(menu.phase === 'confirm' && menu.pendingRecord?.type === 3 && menu.pendingRecord?.symbolIndex === 0, 'the pick asks the confirm for a symbol record');
  menu.key(press('Enter')); // Yes
  const rec = parseChatShortcut(full, 3);
  check(rec?.type === 3 && rec.symbolIndex === 0 && rec.symbol?.spec === 0x120, 'the symbol record is written: index 0 and the saved chat');
}

// Escape in the picker closes to the slot list (exe 0x20 -> state 1), and the pick on a
// symbol slot reopens the list on the edited slot.
{
  const full = save();
  const { menu } = leaf(full);
  menu.key(press('ArrowDown'));
  menu.key(press('Enter'));
  menu.key(press('Enter'));
  menu.key(press('Tab')); // the word picker
  menu.key(press('x'));
  menu.key(press('Tab')); // the symbol picker
  menu.key(press('x'));
  check(menu.phase === 'slots', 'Cancel in the symbol picker goes to the slot list');
}

// The sub-windows' keyboard: the Symbol key in the word picker does nothing, and Left / Right page
// only the slot list.
{
  const full = save();
  const { menu } = leaf(full);
  menu.key(press('Enter'));
  menu.key(press('Enter'));
  menu.key(press('Tab'));
  menu.key(press('Tab'));
  check(menu.phase === 'wordPicker', 'the Symbol key in the word picker is a no-op');
  menu.key(press('x'));
  menu.key(press('Escape'));
  check(menu.phase === 'slots', 'Escape on the keyboard returns to the slot list');
  menu.key(press('ArrowRight'));
  check(menu.selectedSlot === 4, 'Right pages the slot list, not the actions');
}

// The record label rows and the drawing run without error on a stub context.
{
  const full = save();
  const { menu } = leaf(full);
  menu.draw(ctx, { frame: {} } as never);
  menu.key(press('Enter'));
  menu.draw(ctx, { frame: {} } as never);
  menu.key(press('Enter'));
  menu.draw(ctx, { frame: {} } as never);
  menu.key(press('Tab'));
  menu.draw(ctx, { frame: {} } as never);
  check(true, 'draws in every phase');
}

// HomeLeaves: 0x11 is a shared leaf; it needs a save copy, and closing after an edit sends 03ED.
{
  let sent = 0;
  let full: Uint8Array | null = save();
  const host = (over: Record<string, unknown> = {}) => ({
    text,
    lobby: { self: undefined, selfId: 0, players: new Map() } as never,
    guildCards: () => null,
    guildCardClient: () => null,
    mailbox: () => null,
    fullCharacter: () => full,
    team: () => null,
    sendShortcuts: () => {
      sent++;
    },
    ...over,
  });
  const leaves = new HomeLeaves(() => host() as never);
  check(leaves.openLeaf(0x11) === true && leaves.open === true, 'Chat > Shortcut opens with a save copy');
  leaves.key(press('Enter'));
  leaves.key(press('Enter'));
  leaves.key(press('a'));
  leaves.key(press('Enter'));
  leaves.key(press('Enter'));
  check(parseChatShortcut(full, 0)?.text === 'a' && sent === 0, 'an edit is written; the 03ED waits for the close');
  leaves.key(press('x'));
  check(leaves.open === false && sent === 1, 'the leaf closes and sends 03ED after the pick');
  // Without a save copy the leaf does not open.
  full = null;
  check(new HomeLeaves(() => host() as never).openLeaf(0x11) === false, 'no save copy, no Chat > Shortcut');
  // The owner's close() also sends 03ED once a pick was made.
  full = save();
  const owner = new HomeLeaves(() => host() as never);
  owner.openLeaf(0x11);
  owner.key(press('Enter'));
  owner.key(press('Enter'));
  owner.close();
  check(sent === 2 && owner.open === false, 'close() sends 03ED after a pick');
  const quiet = new HomeLeaves(() => host() as never);
  quiet.openLeaf(0x11);
  quiet.close();
  check(sent === 2, 'close() with no pick sends nothing');
}

check(SHORTCUT_TEXT.edit === 0x97 && SHORTCUT_TEXT.clear === 0x6d, 'the action rows are unitxt 0x97 (edit) and 0x6d (clear)');

// A word record: the Symbol key opens the word picker over the table (the lobby root, table2[1] =
// [23]); Enter opens row 23's list, Enter on token 70 accepts it, and Yes writes the type 2 record.
{
  const list1: number[][] = Array.from({ length: 0x11a }, () => []);
  list1[23] = [70, 71];
  const list2: number[][] = Array.from({ length: 0x12 }, () => []);
  list2[1] = [23];
  // Token 70 reads "Hello." (phrase 0); the other tokens have no phrase (0xFFFF).
  const tokenToPhrase = Array.from({ length: 0x100 }, (_, i) => (i === 70 ? 0 : 0xffff));
  setWordSelectTable({ tokenToPhrase, phrases: ['Hello.'], list1, list2 });
  const full = save();
  const { menu } = leaf(full);
  menu.key(press('ArrowDown'));
  menu.key(press('ArrowDown'));
  menu.key(press('ArrowDown')); // slot 3, empty
  menu.key(press('Enter'));
  menu.key(press('Enter')); // Edit
  menu.key(press('Tab'));
  check(menu.phase === 'wordPicker', 'the Symbol key opens the word picker over the table');
  menu.key(press('Enter')); // row 23: its list
  menu.key(press('Enter')); // token 70: the word (its NEXT / SELECT row, NEXT has the focus)
  menu.key(press('ArrowDown')); // SELECT
  menu.key(press('Enter')); // SELECT closes the picker: the confirm
  const word = menu.pendingRecord?.word;
  check(menu.phase === 'confirm' && menu.pendingRecord?.type === 2 && word?.numTokens === 1 && word?.tokens[0] === 70, 'the word accept asks the confirm for a word record');
  menu.key(press('Enter')); // Yes
  const rec = parseChatShortcut(full, 3);
  check(rec?.type === 2 && rec.word?.tokens[0] === 70, 'the word record is written to slot 3');
  // The slot row of a word record shows the rendered sentence (renderWordSelect, the balloon's text).
  const rows = (menu as unknown as { slotItems(): { label: string }[] }).slotItems();
  check(rows[3]?.label === 'Hello.', `the word record's slot label is its sentence (got ${JSON.stringify(rows[3]?.label)})`);
  setWordSelectTable(null);
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('chatshortcutmenu: all checks passed');
