// The Chat > Shortcut leaf (Home menu 0x11): the 16 chat shortcut slots, the slot's action
// list (edit / clear), the text keyboard, the symbol chat picker and the Yes / No confirms.
// The records are read and written in the save copy (net/chatshortcut.ts); the 03ED save
// goes out when the leaf closes after an action was picked (classic/homeleaves.ts).
//
// PsoBB.exe (Psobb.exe-05112026.c; the dump's names for the sub-windows are wrong in places,
// the state flow below is from the code paths):
//   - ChatShortcutMenu_Constructor_00754c8c (726737): the leaf's fields, +0x28 (picked) = 0.
//   - ChatShortcutMenu_Process_00754cd8 (726760), the state at +0x1c:
//       0 / 1  the slot list (ChatShortcutMenu_CreateSubList_007553d8 at get_gui_position(0x75),
//              title unitxt(11, 0x40); 4 rows a page, the page keys change the page). The rows:
//              the record's text, the saved symbol chat's name, or the empty label.
//              Cancel -> the owner closes the leaf (state 0xb).
//       3 / 4  the action list (ChatShortcutMenu_CreateShortcutList_007551d0 at 0x77, title
//              unitxt(11, 0x3f)): 0x97 (value 5, edit), 0x6d (value 9, clear; disabled on an
//              empty slot). Cancel -> 1. A pick sets +0x28 = 1 (state 4).
//       5 / 6  the text window (ChallengePlayerInfoWindow_Constructor_00713540 over the buffer
//              +0x44; the slot list is closed; +0x24 = the slot). Enter -> 7 (the buffer's
//              type 1 and text), Escape -> 1.
//       7 / 8  the Yes / No confirm (ChatShortcutMenu_CreateGameList_00755274 at 0x78, width 205,
//              title unitxt(11, 0x33), message unitxt(11, 0x50)). Yes copies the buffer into the
//              slot (ChatMessage_CopyData_0077d694); Yes and No both go to 1.
//       9 / 10 the clear confirm (ChatShortcutMenu_CreateShortcutListSub_007552bc at 0x79, message
//              unitxt(11, 0x51), No selected by default). Yes clears the slot
//              (ChatMessage_ClearType_0077d6bc) and goes to 1; No and cancel go to 3.
//   - The text window's keys (UIPanel_Update 674540 / UIPanel_ProcessChatShortcuts 674964): the
//     keyboard control 0xe (the Symbol Chat key, BINDING.symbolChat) opens the type's picker;
//     an Enter in the keyboard confirms (flag 0x10), a cancel closes to the slot list (0x20).
//     The buffer's type word: 1 text, 2 word select, 3 symbol chat (the picker's value is the
//     saved chat's index, written at +4: ChatShortcutMenu_CheckListWindowState 674799).
//   - Destructor CloseAllListMenusAndCleanup_00754ba4 (726700): send_packet0xed_subcommand3
//     (03ED) when +0x28 is set.
//
// ASSUMED / left (see DEVLOG 2026-10-23):
//   - The Symbol Chat key alternates the word picker and the symbol picker (openMode, the mode byte
//     +0x1C; the exe's order is ASSUMED, see openMode). The word picker is classic/wordselectwindow.ts
//     over classic/wordselectmenu.ts; its window placement and title are ASSUMED. Accept makes a word
//     record (type 2) and asks the confirm; Cancel returns to the keyboard. The key does nothing
//     inside a picker.
//   - The word select row's label (the slot list) is the empty label; the picker shows the sentence.
//   - The picker is not opened when the keyboard is activated (the exe's flags 0x240 / key 0xf path is
//     not traced): it opens on the Symbol Chat key only.
//   - The preview box (InformationCounterListWindow at 0x76, title unitxt(11, 0x48)) between the
//     keyboard and the confirm is not drawn.
//   - The keyboard starts empty (the exe copies nothing from the slot into the buffer; the
//     keyboard's initial text is ASSUMED empty).
//   - Enter / Escape for the keyboard and the lists; Left / Right page the slot list (ASSUMED:
//     the exe's page keys are keyboard controls 0x10 / 0x11, not mapped here).
//   - The keyboard box sits at get_gui_position(0xc9) with the 200 px width of the exe's text
//     keyboard (SetSize 200); the picker shows 5 rows (the exe's list height is not traced).
//   - The Yes / No strings are unitxt(11, 0x6e) / (11, 0x6f) (the same ones the teams use).
import { se, SE } from '../audio/se.ts';
import { KEYS, menuKeyOf } from '../input/keyconfig.ts';
import { clearChatShortcut, CHAT_SHORTCUT_SYMBOL, CHAT_SHORTCUT_TEXT, CHAT_SHORTCUT_TEXT_MAX, CHAT_SHORTCUT_WORD_SELECT, parseChatShortcut, writeChatShortcut, type ChatShortcut } from '../net/chatshortcut.ts';
import { currentWordSelectTable } from '../net/wordselect.ts';
import { parseSymbolChats } from '../net/symbolchat.ts';
import { drawListWindow, INSET, listKey, type ListItem } from './fieldwindows.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import type { MenuKey } from './gamelist.ts';
import { openWordSelectPicker, wordSelectType, WORD_SELECT_STATUS_ACCEPTED, WORD_SELECT_STATUS_CANCELLED, type WordSelectScene } from './wordselectmenu.ts';
import { WordSelectWindow } from './wordselectwindow.ts';
import { symbolChatRows, type SymbolRow } from './symbolchat.ts';
import { drawWindowFrame, type WindowSkin } from './stage.ts';
import { CARET, caretColor, TextEditor } from './titleflow.ts';
import { Question } from './teammenu.ts';

// The unitxt group 11 strings (the exe's unitxt_get_group_11_String indices).
export const SHORTCUT_TEXT = {
  slotTitle: 0x40,
  actionTitle: 0x3f,
  edit: 0x97,
  clear: 0x6d,
  confirmMessage: 0x50,
  clearMessage: 0x51,
  yes: 0x6e,
  no: 0x6f,
} as const;

// The windows' places: get_gui_position (0x00971f40 + 8 * id, read with tools/exedata.py).
export const SHORTCUT_POS = {
  slots: { x: 13, y: 256 }, // 0x75 (13, 256)
  actions: { x: 420, y: 256 }, // 0x77 (420, 256)
  confirm: { x: 420, y: 256, w: 205 }, // 0x78 (420, 256), width 205 (exe literal)
  clearConfirm: { x: 420, y: 314, w: 205 }, // 0x79 (420, 314)
  keyboard: { x: 7, y: 397, w: 200 }, // 0xc9 (7, 397); the text keyboard's 200 px (ASSUMED position)
  picker: { x: 30, y: 314 }, // DAT_0096fc50 (30, 314)
} as const;

export const SHORTCUT_PAGE_ROWS = 4; // the slot list shows 4 rows a page, 4 pages (16 records)
export const SHORTCUT_PAGES = 4;
export const SHORTCUT_COUNT = SHORTCUT_PAGE_ROWS * SHORTCUT_PAGES;
export const SHORTCUT_PICKER_ROWS = 5; // the picker's visible rows (ASSUMED, see the header)

export type ShortcutPhase = 'slots' | 'actions' | 'keyboard' | 'picker' | 'wordPicker' | 'confirm' | 'clearConfirm' | 'closed';

export interface ChatShortcutHost {
  // The scene the word picker's root list is read for (get_word_select_type). ASSUMED 'lobby' when
  // the host does not say (the Shortcut leaf is reached from the lobby and the field).
  wordScene?: () => WordSelectScene;
  // unitxt lookup (group, index), the Home menu's text.
  text: (group: number, index: number) => string;
  // The save copy (the session's full character), read and written in place. Null without one.
  full: () => Uint8Array | null;
  // The destructor: called once when the leaf closes; picked = an action row was chosen (+0x28).
  onClose: (picked: boolean) => void;
}

// The label of a slot row (the exe's kind of row per type: text, word select, symbol, empty).
function slotLabel(full: Uint8Array | null, slot: number, text: (i: number) => string): string {
  const s = parseChatShortcut(full, slot);
  if (!s || s.type === 0) return '';
  if (s.type === CHAT_SHORTCUT_TEXT) return s.text;
  if (s.type === CHAT_SHORTCUT_SYMBOL) {
    const rows = symbolChatRows(full ? parseSymbolChats(full) : [], (_g, i) => text(i));
    return rows[s.symbolIndex ?? -1]?.label ?? '';
  }
  return ''; // word select: the word table is not in the port (ASSUMED empty label)
}

function windowWidth(items: readonly ListItem[], title: string | null): number {
  const widest = Math.max(0, ...items.map((i) => gameTextWidth(i.label)), title ? gameTextWidth(title) : 0);
  return Math.max(widest + 2 * INSET, 120);
}

export class ChatShortcutMenu {
  phase: ShortcutPhase = 'slots';
  private readonly host: ChatShortcutHost;
  // The slot list: the page and the row on it; the selected slot is page * 4 + row.
  private page = 0;
  private row = 0;
  // +0x24: the slot the text window edits (the slot list reopens on it).
  private slot = 0;
  // +0x28: an action row was picked (the destructor sends 03ED).
  private picked = false;
  private actionCursor = 0;
  // The record the confirm will write (the buffer +0x44).
  private pending: ChatShortcut | null = null;
  private editor: TextEditor | null = null;
  private pickerRows: SymbolRow[] = [];
  private readonly pickerState = { cursor: 0 };
  private pickerTop = 0;
  private question: Question | null = null;
  // The keyboard's mode (the exe's +0x1C byte, its constructor's 0 = word): the picker the Symbol
  // Chat key opens next. It alternates word / symbol with each key press (see openMode).
  private mode: 'word' | 'symbol' = 'word';
  private wordPicker: WordSelectWindow | null = null;

  constructor(host: ChatShortcutHost) {
    this.host = host;
  }

  get open(): boolean {
    return this.phase !== 'closed';
  }

  get selectedSlot(): number {
    return this.page * SHORTCUT_PAGE_ROWS + this.row;
  }

  private text(i: number): string {
    return this.host.text(11, i);
  }

  private slotItems(): ListItem[] {
    const full = this.host.full();
    const out: ListItem[] = [];
    for (let r = 0; r < SHORTCUT_PAGE_ROWS; r++) {
      const slot = this.page * SHORTCUT_PAGE_ROWS + r;
      out.push({ label: slotLabel(full, slot, (i) => this.text(i)), value: slot, enabled: true });
    }
    return out;
  }

  private actionItems(): ListItem[] {
    const s = parseChatShortcut(this.host.full(), this.selectedSlot);
    const empty = !s || s.type === 0;
    return [
      { label: this.text(SHORTCUT_TEXT.edit), value: 5, enabled: true },
      { label: this.text(SHORTCUT_TEXT.clear), value: 9, enabled: !empty },
    ];
  }

  // Back to the slot list. From the text window, the picker or a confirm the exe has closed
  // the list, so it reopens on the edited slot (+0x24).
  private toSlots(reopenOnSlot: boolean): void {
    if (reopenOnSlot) {
      this.page = Math.floor(this.slot / SHORTCUT_PAGE_ROWS);
      this.row = this.slot % SHORTCUT_PAGE_ROWS;
    }
    this.editor = null;
    this.question = null;
    this.pending = null;
    this.phase = 'slots';
  }

  private finish(): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.editor = null;
    this.question = null;
    this.wordPicker = null;
    this.host.onClose(this.picked);
  }

  // Closes the leaf from outside (the owner's leave): the destructor runs as well.
  dispose(): void {
    this.finish();
  }

  key(e: MenuKey): void {
    switch (this.phase) {
      case 'slots':
        this.slotsKey(e);
        return;
      case 'actions':
        this.actionsKey(e);
        return;
      case 'keyboard':
        this.keyboardKey(e);
        return;
      case 'picker':
        this.pickerKey(e);
        return;
      case 'wordPicker':
        this.wordPickerKey(e);
        return;
      case 'confirm':
        this.confirmKey(e, false);
        return;
      case 'clearConfirm':
        this.confirmKey(e, true);
        return;
      default:
        return;
    }
  }

  private slotsKey(e: MenuKey): void {
    const k = menuKeyOf(e);
    if (k === 'left' || k === 'right') {
      // Page keys: the page wraps over the 4 pages, the row stays.
      this.page = (this.page + (k === 'right' ? 1 : SHORTCUT_PAGES - 1)) % SHORTCUT_PAGES;
      se(SE.cursor);
      return;
    }
    const state = { cursor: this.row };
    const r = listKey(e as { key: string }, this.slotItems(), state);
    this.row = state.cursor;
    if (r === 'cancel') {
      this.finish();
    } else if (r === 'decide') {
      this.actionCursor = 0;
      this.phase = 'actions';
    }
  }

  private actionsKey(e: MenuKey): void {
    const state = { cursor: this.actionCursor };
    const r = listKey(e as { key: string }, this.actionItems(), state);
    this.actionCursor = state.cursor;
    if (r === 'cancel') {
      this.phase = 'slots';
    } else if (r === 'decide') {
      this.picked = true;
      const value = this.actionItems()[this.actionCursor].value;
      if (value === 5) {
        this.slot = this.selectedSlot;
        this.editor = new TextEditor('', CHAT_SHORTCUT_TEXT_MAX, false);
        this.phase = 'keyboard';
      } else {
        this.slot = this.selectedSlot;
        this.question = new Question(this.text(SHORTCUT_TEXT.clearMessage), {
          x: SHORTCUT_POS.clearConfirm.x,
          y: SHORTCUT_POS.clearConfirm.y,
          w: SHORTCUT_POS.clearConfirm.w,
        });
        this.question.cursor = 1; // No is selected (exe SetSelectedIndex 1)
        this.phase = 'clearConfirm';
      }
    }
  }

  private keyboardKey(e: MenuKey): void {
    const ed = this.editor;
    if (!ed) return;
    if (e.key === 'Escape') {
      se(SE.cancel);
      this.toSlots(true);
      return;
    }
    if (e.key === 'Enter') {
      se(SE.ok);
      this.pending = { type: CHAT_SHORTCUT_TEXT, text: ed.text, symbolIndex: 0, symbol: null, word: null };
      this.question = new Question(this.text(SHORTCUT_TEXT.confirmMessage), {
        x: SHORTCUT_POS.confirm.x,
        y: SHORTCUT_POS.confirm.y,
        w: SHORTCUT_POS.confirm.w,
      });
      this.question.cursor = 0; // Yes is selected (the exe's list starts on its first row)
      this.phase = 'confirm';
      return;
    }
    if (e.key === 'Backspace') {
      ed.backspace();
      return;
    }
    // The Symbol Chat key (keyboard control 0xe, BINDING.symbolChat) opens the next picker.
    if (KEYS.symbolChat && e.key.toLowerCase() === KEYS.symbolChat) {
      this.openMode();
      return;
    }
    if (e.key.length === 1) ed.type(e.key);
  }

  // The Symbol Chat key: the word picker, then the symbol picker, alternately (the mode byte). ASSUMED:
  // the exe's toggle (ChallengePlayerInfoWindow_Update, 0x713830) flips the mode before it opens, so
  // its first key would give the symbol picker; the port opens the word picker first because the exe's
  // first picker is the word one (DEVLOG 2026-10-23, the word select picker).
  private openMode(): void {
    if (this.mode === 'word') this.openWordPicker();
    else this.openPicker();
    this.mode = this.mode === 'word' ? 'symbol' : 'word';
  }

  // CreateWordSelectMenuEntity_00701d00 (the word picker over the keyboard): the root list is the
  // word type of the scene (wordSelectType, no item selected), the table is the JP one.
  private openWordPicker(): void {
    const scene = this.host.wordScene?.() ?? 'lobby';
    const model = openWordSelectPicker({
      type: wordSelectType(scene, false),
      table: currentWordSelectTable(),
      scene,
      jpLocale: true,
    });
    this.wordPicker = new WordSelectWindow(model);
    this.phase = 'wordPicker';
  }

  // The word picker: Select accepts (the sentence becomes a word record, asked as a confirm); Cancel
  // closes it and the keyboard stays (the exe's child closes, the text window goes on).
  private wordPickerKey(e: MenuKey): void {
    const w = this.wordPicker;
    if (!w) return;
    w.key(e as { key: string });
    const status = w.model.status;
    if (status === WORD_SELECT_STATUS_ACCEPTED) {
      this.wordPicker = null;
      this.pending = { type: CHAT_SHORTCUT_WORD_SELECT, text: '', symbolIndex: 0, symbol: null, word: w.model.result() };
      this.question = new Question(this.text(SHORTCUT_TEXT.confirmMessage), {
        x: SHORTCUT_POS.confirm.x,
        y: SHORTCUT_POS.confirm.y,
        w: SHORTCUT_POS.confirm.w,
      });
      this.question.cursor = 0;
      this.phase = 'confirm';
    } else if (status === WORD_SELECT_STATUS_CANCELLED) {
      this.wordPicker = null;
      this.phase = 'keyboard';
    }
  }

  private openPicker(): void {
    const full = this.host.full();
    this.pickerRows = symbolChatRows(full ? parseSymbolChats(full) : [], (_g, i) => this.text(i));
    this.pickerState.cursor = 0;
    this.pickerTop = 0;
    this.phase = 'picker';
  }

  private pickerKey(e: MenuKey): void {
    const items = this.pickerItems();
    const r = listKey(e as { key: string }, items, this.pickerState);
    this.scrollPicker();
    if (r === 'cancel') {
      this.toSlots(true);
      return;
    }
    if (r !== 'decide') return;
    const row = this.pickerRows[this.pickerState.cursor];
    this.pending = { type: CHAT_SHORTCUT_SYMBOL, text: '', symbolIndex: row.index, symbol: row.chat, word: null };
    this.question = new Question(this.text(SHORTCUT_TEXT.confirmMessage), {
      x: SHORTCUT_POS.confirm.x,
      y: SHORTCUT_POS.confirm.y,
      w: SHORTCUT_POS.confirm.w,
    });
    this.question.cursor = 0;
    this.phase = 'confirm';
  }

  private pickerItems(): ListItem[] {
    return this.pickerRows.map((r) => ({ label: r.label, value: r.index, enabled: r.valid }));
  }

  private scrollPicker(): void {
    const c = this.pickerState.cursor;
    if (c < this.pickerTop) this.pickerTop = c;
    if (c >= this.pickerTop + SHORTCUT_PICKER_ROWS) this.pickerTop = c - SHORTCUT_PICKER_ROWS + 1;
  }

  // The Yes / No confirm: copy (state 8) or clear (state 10). Cancel is No.
  private confirmKey(e: MenuKey, clearing: boolean): void {
    const q = this.question;
    if (!q) return;
    q.key(e);
    if (!q.result) return;
    const yes = q.result === 'yes';
    this.question = null;
    const full = this.host.full();
    if (clearing) {
      if (yes) {
        clearChatShortcut(full, this.selectedSlot);
        this.toSlots(false);
      } else {
        this.phase = 'actions';
      }
      return;
    }
    if (yes && this.pending) writeChatShortcut(full, this.slot, this.pending);
    this.toSlots(true);
  }

  // The window: the slot list, the action list, the keyboard, the picker or a confirm.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    if (this.phase === 'closed') return;
    const p = this.phase;
    if (p === 'slots' || p === 'actions' || p === 'clearConfirm') {
      const items = this.slotItems();
      const title = this.text(SHORTCUT_TEXT.slotTitle);
      drawListWindow(ctx, skin, SHORTCUT_POS.slots.x, SHORTCUT_POS.slots.y, windowWidth(items, title), title, items, this.row);
    }
    if (p === 'actions' || p === 'clearConfirm') {
      const items = this.actionItems();
      const title = this.text(SHORTCUT_TEXT.actionTitle);
      drawListWindow(ctx, skin, SHORTCUT_POS.actions.x, SHORTCUT_POS.actions.y, windowWidth(items, title), title, items, this.actionCursor);
    }
    if (p === 'keyboard' && this.editor) drawKeyboard(ctx, skin, this.editor);
    if (p === 'wordPicker') {
      if (this.editor) drawKeyboard(ctx, skin, this.editor);
      this.wordPicker?.draw(ctx, skin);
    }
    if (p === 'picker') {
      const items = this.pickerItems().slice(this.pickerTop, this.pickerTop + SHORTCUT_PICKER_ROWS);
      drawListWindow(ctx, skin, SHORTCUT_POS.picker.x, SHORTCUT_POS.picker.y, windowWidth(items, null), null, items, this.pickerState.cursor - this.pickerTop);
    }
    if ((p === 'confirm' || p === 'clearConfirm') && this.question) {
      this.question.draw(ctx, skin, this.text(SHORTCUT_TEXT.yes), this.text(SHORTCUT_TEXT.no));
    }
  }

  // The text the keyboard holds (test helper).
  get value(): string {
    return this.editor?.text ?? '';
  }

  // The record the confirm would write (test helper).
  get pendingRecord(): ChatShortcut | null {
    return this.pending;
  }
}

// The text keyboard's frame, text and caret (the chat form's box, 200 wide).
function drawKeyboard(ctx: CanvasRenderingContext2D, skin: WindowSkin, ed: TextEditor): void {
  const at = SHORTCUT_POS.keyboard;
  drawWindowFrame(ctx, skin.frame, at.x, at.y, at.w, 34);
  const shown = ed.shown;
  drawGameText(ctx, shown, at.x + INSET, at.y + INSET + 1);
  ctx.fillStyle = caretColor(0);
  ctx.fillRect(at.x + INSET + gameTextWidth(shown), at.y + INSET, CARET.w, CARET.h);
}
