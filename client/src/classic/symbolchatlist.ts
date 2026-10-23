// The symbol chat list window (classic): the 12 saved chats as a list with a
// cursor. Two users of it:
//   - 'home': the lobby Home menu's Chat > Symbol Chat leaf (0x12). A decided
//     row previews its sound only (ProcessChatMessageType_0077d880, state 2 of
//     ChatShortcutMenuWindow_Process_00758900: no send, no balloon). The window
//     stays open; Cancel closes it. (The exe's leaf goes on to the option list
//     and the icon editor, states 3..9; not ported, see DEVLOG.)
//   - 'chat': the End-key picker (a stand-in for the quick menu's chat row, see
//     DEVLOG). A decided row is sent to the room (6x07) when the chat cooldown
//     is over; the callback says whether it was taken, and only then the window
//     closes. While the cooldown runs the row waits and the window stays open.
// Keys and the list drawing are the field windows' (fieldwindows.ts listKey,
// drawListWindow). The rows are symbolchat.ts symbolChatRows.

import { se, SE } from '../audio/se.ts';
import { menuKeyOf } from '../input/keyconfig.ts';
import { drawListWindow, listKey, type ListItem } from './fieldwindows.ts';
import { SYMBOL_LIST, type SymbolRow } from './symbolchat.ts';
import type { WindowSkin } from './stage.ts';

export type SymbolListMode = 'home' | 'chat';

// Where the window sits (ASSUMED: the exe's get_gui_position(0x7a) is not read).
export const SYMBOL_LIST_POS = { x: 16, y: 40 };

export class SymbolChatList {
  readonly mode: SymbolListMode;
  readonly rows: readonly SymbolRow[];
  readonly title: string;
  cursor = 0;
  top = 0;
  open = true;
  // Returns true when the row was taken (the 'chat' window then closes).
  private onDecide: (row: SymbolRow) => boolean;

  constructor(mode: SymbolListMode, title: string, rows: readonly SymbolRow[], onDecide: (row: SymbolRow) => boolean) {
    this.mode = mode;
    this.title = title;
    this.rows = rows;
    this.onDecide = onDecide;
  }

  private get items(): ListItem[] {
    return this.rows.map((r) => ({ label: r.label, value: r.index, enabled: r.valid }));
  }

  private scroll(): void {
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + SYMBOL_LIST.visible) this.top = this.cursor - SYMBOL_LIST.visible + 1;
  }

  key(e: { key: string }): void {
    if (!this.open) return;
    if (menuKeyOf(e) === 'cancel') {
      se(SE.cancel);
      this.open = false;
      return;
    }
    const state = { cursor: this.cursor };
    const r = listKey(e, this.items, state);
    this.cursor = state.cursor;
    this.scroll();
    if (r !== 'decide') return;
    const row = this.rows[this.cursor];
    const taken = this.onDecide(row);
    if (this.mode === 'chat' && taken) this.open = false;
  }

  close(): void {
    this.open = false;
  }

  // The window: the list's frame and rows, the title pill above it.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    if (!this.open) return;
    const visible = this.items.slice(this.top, this.top + SYMBOL_LIST.visible);
    drawListWindow(ctx, skin, SYMBOL_LIST_POS.x, SYMBOL_LIST_POS.y, SYMBOL_LIST.w, this.title, visible, this.cursor - this.top);
  }
}
