// The lobby Home menu's Info Board leaf (main menu entry 0x16): the menu window, the
// board list (one row a player of the lobby, its message in the box beside it) and
// the keyboard that writes the player's own message. The packets are net/infoboard.ts.
//
// Decoded from PsoBB.exe (Psobb.exe-05112026.c; the dump's names for this window are
// wrong: the vtable 0x00b42210 carries the "GuildCardListWindow" names, the window is
// the info board, see DEVLOG 2026-10-23):
//   - Constructor 0x750184 is the one handle_player_menu_select (700118) calls for
//     info_board_menu (0x16); its state machine is FUN_007501e0 (dump 'ChallengePlayer'
//     family, the decompile at tools/ghidra/decomp.sh 0x7501e0).
//   - States 0 / 1 open the menu FUN_00750690 at get_gui_position(0xab) = (13, 256),
//     title unitxt(11, 0x30) = "Select". Rows: unitxt(11, 0x141) = "View the board"
//     (value 3, enabled only when FUN_007a61a4() == 0xb) and unitxt(11, 0x142) =
//     "Board: Write" (value 9).
//   - State 2 reads the menu's cursor; cancel (flag 4) closes it, a chosen row goes to
//     the row's value as the next state.
//   - State 3 (View): FUN_0078e0b0 opens the request (FUN_007d79f4 sends 00D8); state 4
//     waits for the answer. The cancel sound 0x585 and a close happen if the wait is
//     cancelled (FUN_007c1160 path). The answer (FUN_0078e11c, see net/infoboard.ts)
//     moves to state 6.
//   - State 6 builds the list (FUN_00750690's window at (194, 256), FUN_00750514 is the
//     write keyboard): one row per entry with its name; the empty list gets the greyed
//     row unitxt(11, 0xf1) = "No Player". The title is unitxt(11, 0x30).
//   - State 7 (list): the highlighted row's message is shown in the box at get_gui_position(0xae)
//     = (419, 256) (FUN_007505e8 adds the message to the object made by FUN_00750634 at 0xae).
//     Cancel -> state 8 -> state 5 (the request is released) -> state 1 (the menu).
//   - State 9 (Write): the menu closes and the keyboard opens at get_gui_position(0xcf)
//     = (331, 266) with the player's current message as its text (FUN_0078e050 gives the
//     character's board text, FUN_0078e000 stores at most 0xab units). Accept (FUN_0078ed14)
//     stores the text and FUN_0078e070 sends 00D9 with it; cancel (FUN_0078ed20) sends
//     nothing; both go to state 0xb -> state 1 (the menu again).
//
// ASSUMED (not traced): the lobby test in state 0 (0xb is taken as "in the lobby");
// empty-message rows use the FUN_00735ee0 row variant (taken as a plain row, the
// difference is not decoded); the keyboard's Escape / Enter mapping is the guild card
// comment editor's.
import { se, SE } from '../audio/se.ts';
import { InfoBoardClient, INFO_BOARD_TYPED_MAX, type InfoBoardEntry } from '../net/infoboard.ts';
import { drawListWindow, INSET, listKey, type ListItem } from './fieldwindows.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import type { MenuKey, Text } from './gamelist.ts';
import { wrapGameText } from './chat.ts';
import { drawWindowFrame, type WindowSkin } from './stage.ts';
import { CARET, caretColor, TextEditor } from './titleflow.ts';

// The table of get_gui_position (0x00971f40 + 8 * id), read with tools/exedata.py:
// 0xab = (13, 256), 0xad = (194, 256), 0xae = (419, 256), 0xcf = (331, 266).
export const INFO_BOARD_POS = {
  menu: { x: 13, y: 256 }, // 0xab
  list: { x: 194, y: 256 }, // 0xad
  message: { x: 419, y: 256 }, // 0xae
  keyboard: { x: 331, y: 266 }, // 0xcf
} as const;

// The menu's row values are the exe's next states (3 = View, 9 = Write).
export const INFO_BOARD_ROW = { view: 3, write: 9 } as const;
// The text rows (unitxt group 11).
export const INFO_BOARD_TEXT = { title: 0x30, view: 0x141, write: 0x142, noPlayer: 0xf1 } as const;
export const INFO_BOARD_MESSAGE_WIDTH = 188;

export type InfoBoardPhase = 'menu' | 'loading' | 'list' | 'write' | 'closed';

export interface InfoBoardHost {
  client: InfoBoardClient;
  // The lobby test of the exe's menu rows (FUN_007a61a4() == 0xb).
  inLobby(): boolean;
  // The player's own message (the character's board text).
  own(): string;
  // Keeps the text the keyboard accepted as the own message.
  setOwn(text: string): void;
}

function windowWidth(items: readonly ListItem[], title: string | null): number {
  const widest = Math.max(0, ...items.map((i) => gameTextWidth(i.label)), title ? gameTextWidth(title) : 0);
  return widest + 2 * INSET;
}

export class InfoBoardMenu {
  phase: InfoBoardPhase = 'menu';
  private readonly text: Text;
  private readonly host: InfoBoardHost;
  private menu: ListItem[];
  private readonly menuState = { cursor: 0 };
  private list: ListItem[] = [];
  private readonly listState = { cursor: 0 };
  private entries: InfoBoardEntry[] = [];
  private editor: TextEditor | null = null;
  private loadToken = 0;

  constructor(text: Text, host: InfoBoardHost) {
    this.text = text;
    this.host = host;
    this.menu = this.menuRows();
  }

  get open(): boolean {
    return this.phase !== 'closed';
  }

  // The menu rows: View the board (greyed outside the lobby), Board: Write.
  menuRows(): ListItem[] {
    return [
      { label: this.text(INFO_BOARD_TEXT.view), value: INFO_BOARD_ROW.view, enabled: this.host.inLobby() },
      { label: this.text(INFO_BOARD_TEXT.write), value: INFO_BOARD_ROW.write, enabled: true },
    ];
  }

  // The keys of the menu, the list and the keyboard.
  key(e: MenuKey): void {
    switch (this.phase) {
      case 'menu':
        this.menuKey(e);
        return;
      case 'list':
        this.listKey(e);
        return;
      case 'write':
        this.writeKey(e);
        return;
      default:
        return;
    }
  }

  private menuKey(e: MenuKey): void {
    const r = listKey(e, this.menu, this.menuState);
    if (r === 'cancel') {
      se(SE.cancel);
      this.phase = 'closed';
    } else if (r === 'decide') {
      const row = this.menu[this.menuState.cursor];
      if (!row || !row.enabled) return;
      se(SE.ok);
      if (row.value === INFO_BOARD_ROW.view) void this.view();
      else this.startWrite();
    }
  }

  // State 3 to 6: request the board and wait for the answer. A failed or cancelled wait goes
  // back to the menu (state 4's cancel path plays SE 0x585).
  private async view(): Promise<void> {
    const token = ++this.loadToken;
    this.phase = 'loading';
    try {
      const entries = await this.host.client.fetch();
      if (token !== this.loadToken || this.phase !== 'loading') return;
      this.entries = entries;
      this.list = this.listRows(entries);
      this.listState.cursor = 0;
      this.phase = 'list';
    } catch {
      if (token !== this.loadToken) return;
      se(SE.cancel);
      this.phase = 'menu';
    }
  }

  // The board's rows: one per player (the name), or the greyed No Player row.
  listRows(entries: readonly InfoBoardEntry[]): ListItem[] {
    if (entries.length === 0) return [{ label: this.text(INFO_BOARD_TEXT.noPlayer), value: -1, enabled: false }];
    return entries.map((e, i) => ({ label: e.name, value: i, enabled: true }));
  }

  private listKey(e: MenuKey): void {
    const r = listKey(e, this.list, this.listState);
    if (r === 'cancel') {
      se(SE.cancel);
      this.phase = 'menu';
      this.menu = this.menuRows();
    } else if (r === 'decide') se(SE.ok);
  }

  // State 9: the keyboard with the own message.
  private startWrite(): void {
    this.editor = new TextEditor(this.host.own(), INFO_BOARD_TYPED_MAX, false);
    this.phase = 'write';
  }

  private writeKey(e: MenuKey): void {
    const ed = this.editor;
    if (!ed) {
      this.phase = 'menu';
      return;
    }
    if (e.key === 'Escape') {
      se(SE.cancel);
      this.editor = null;
      this.phase = 'menu';
    } else if (e.key === 'Enter') {
      se(SE.ok);
      const text = ed.text;
      this.host.setOwn(text);
      this.host.client.write(text);
      this.editor = null;
      this.phase = 'menu';
    } else if (e.key === 'Backspace') {
      ed.backspace();
    } else if (e.key.length === 1) {
      ed.type(e.key);
    }
  }

  // The message of the highlighted row (state 7).
  highlightedMessage(): string | null {
    if (this.phase !== 'list') return null;
    const row = this.list[this.listState.cursor];
    if (!row || row.value < 0) return null;
    return this.entries[row.value]?.message ?? null;
  }

  // Draws the menu, the board list with its message box, or the keyboard.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    if (this.phase === 'closed') return;
    if (this.phase === 'write' && this.editor) {
      const k = INFO_BOARD_POS.keyboard;
      drawWindowFrame(ctx, skin.frame, k.x, k.y, INFO_BOARD_MESSAGE_WIDTH, 34);
      const shown = this.editor.shown;
      drawGameText(ctx, shown, k.x + INSET, k.y + INSET + 1);
      ctx.fillStyle = caretColor(0);
      ctx.fillRect(k.x + INSET + gameTextWidth(shown), k.y + INSET, CARET.w, CARET.h);
      return;
    }
    if (this.phase === 'menu' || this.phase === 'loading') {
      const m = INFO_BOARD_POS.menu;
      const title = this.text(INFO_BOARD_TEXT.title);
      drawListWindow(ctx, skin, m.x, m.y, windowWidth(this.menu, title), title, this.menu, this.menuState.cursor, this.phase === 'menu');
      return;
    }
    const l = INFO_BOARD_POS.list;
    const title = this.text(INFO_BOARD_TEXT.title);
    drawListWindow(ctx, skin, l.x, l.y, windowWidth(this.list, title), title, this.list, this.listState.cursor, true);
    const msg = this.highlightedMessage();
    if (msg !== null) {
      const d = INFO_BOARD_POS.message;
      const lines = wrapGameText(msg, INFO_BOARD_MESSAGE_WIDTH - 2 * INSET);
      const h = 14 + 20 * Math.max(0, lines.length - 1) + 20;
      drawWindowFrame(ctx, skin.frame, d.x, d.y, INFO_BOARD_MESSAGE_WIDTH, h);
      lines.forEach((line, i) => drawGameText(ctx, line, d.x + INSET, d.y + INSET + i * 20));
    }
  }
}
