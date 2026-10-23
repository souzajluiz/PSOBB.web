// The lobby Home menu's Guild Card leaf (main menu entry 0xe), as PsoBB.exe
// (Ephinea 1.25.13) runs it: the Guild Card menu window and the card list
// window beside it. The card book itself is net/guildcard.ts.
//
// Decoded from the dump (Psobb.exe-05112026.c, names of the windows trusted only
// where the code agrees with them):
//   - GuildCardMenuStateHandler_00746bdc (714652..716264): state 0 / 1 close the
//     sub-windows and open the menu window (CreateGuildCardMenuWindow_0074736c,
//     716268) at get_gui_position(0x82) = (13, 256), title unitxt(11, 0x30),
//     rows unitxt(11, 0x65) -> state 3, 0x66 -> state 0xb, 0x67 -> state 0x1d,
//     unitxt(11, 0x117) -> state 0x39 (greyed unless the scene is logged_in).
//   - State 0xb (the card list, 716465 region): the list window at
//     get_gui_position(0x88) = (194, 256) (GuildCardListWindow_AllocateAndConstruct_00747ef4)
//     fed by GuildCardListWindow_PopulateItems_00748430 (717161): the rows are the
//     book's present cards in slot order (the name at +4, '\n' shown as a space,
//     the loop stops at the first empty slot); value = the slot index. With no
//     card the greyed row unitxt(11, 0xf3) (the exe's empty text, ASSUMED).
//   - Back in the card list -> state 0xc -> state 1 -> the menu again (the menu
//     window stays open); Back in the menu -> state 0x4f (the leaf closes, the
//     Home menu shows again).
//
// NOT ported (the row or card opens a sub-flow the port does not have): the
// card action menu (state 0xd, 0x8a, rows 0x6c / 0x120 / 0x121 / 0x76 / 0x6d),
// row 0x65 (state 3: 0x68 / 0x69 sub-list, then the lobby player picker or
// keyboard entry), row 0x67 (state 0x1d: a card text list), row 0x117 (state
// 0x39), the search and send packets (0x40 / 0xc0) and the confirm dialog
// 0x83 at (435, 256) that state 0 opens (its rows are not traced). A chosen
// one of these is reported to the caller and the menu stays open.
//
// ASSUMED: the exe pages the card list 7 rows at a time (its page index is the
// byte at +0x9c, the constructor's paged sub-list); this port shows every card
// in one scrolling list. The list width (the exe sets it from the constructor
// and the paging bar) is the widest row plus the window inset. The list has no
// title. The book is synced once per session (BBSession.startGuildCardSync); a
// menu opened before the sync shows the empty row.

import type { GuildCardBook } from '../net/guildcard.ts';
import { drawListWindow, INSET, listKey, type ListItem } from './fieldwindows.ts';
import { gameTextWidth } from './gametext.ts';
import type { MenuKey, Text } from './gamelist.ts';
import type { WindowSkin } from './stage.ts';

// Position table entries (0x00971f40 + 8 * index, read with tools/exedata.py).
export const GUILD_CARD_POS = {
  menu: { x: 13, y: 256 }, // 0x82
  list: { x: 194, y: 256 }, // 0x88
} as const;

// unitxt group 11 indices used here.
export const T11_GUILD = { title: 0x30, sublist: 0x65, cardList: 0x66, textList: 0x67, search: 0x117, empty: 0xf3 } as const;

// The exe's state codes of the menu rows (the value of each row).
export const GUILD_MENU_STATE = { sublist: 0x03, cardList: 0x0b, textList: 0x1d, search: 0x39 } as const;

export interface GuildCardHost {
  book(): GuildCardBook | null;
  // The scene is logged_in (the lobby always is); 0x117 is greyed otherwise.
  loggedIn: boolean;
}

// What a key press asked for that the port does not do yet (the caller logs it).
export interface UnportedAction {
  state: number;
  // The card's slot index for the card action menu (-1 for a menu row).
  card: number;
}

// The card list rows (GuildCardListWindow_PopulateItems_00748430): the present
// cards in slot order, stopping at the first empty slot; no card gives the greyed
// empty row.
export function cardRows(book: GuildCardBook | null, emptyLabel: string): ListItem[] {
  const rows: ListItem[] = [];
  if (book) {
    for (const [slot, e] of book.view().entries.entries()) {
      if (!e.card.present) break;
      rows.push({ label: e.card.name.replace(/\n/g, ' '), value: slot, enabled: true });
    }
  }
  return rows.length ? rows : [{ label: emptyLabel, value: -1, enabled: false }];
}

export function menuRows(text: Text, loggedIn: boolean): ListItem[] {
  return [
    { label: text(T11_GUILD.sublist), value: GUILD_MENU_STATE.sublist, enabled: true },
    { label: text(T11_GUILD.cardList), value: GUILD_MENU_STATE.cardList, enabled: true },
    { label: text(T11_GUILD.textList), value: GUILD_MENU_STATE.textList, enabled: true },
    { label: text(T11_GUILD.search), value: GUILD_MENU_STATE.search, enabled: loggedIn },
  ];
}

// Width of a titled or plain list window: the widest label plus the inset on both sides.
function windowWidth(items: readonly ListItem[], title: string | null): number {
  const widest = Math.max(0, ...items.map((i) => gameTextWidth(i.label)), title ? gameTextWidth(title) : 0);
  return widest + 2 * INSET;
}

export type GuildCardPhase = 'menu' | 'list' | 'closed';

export class GuildCardMenu {
  phase: GuildCardPhase = 'menu';
  private readonly text: Text;
  private readonly host: GuildCardHost;
  private readonly menu: ListItem[];
  private readonly menuState = { cursor: 0 };
  private list: ListItem[] = [];
  private readonly listState = { cursor: 0 };

  constructor(text: Text, host: GuildCardHost) {
    this.text = text;
    this.host = host;
    this.menu = menuRows(text, host.loggedIn);
  }

  get open(): boolean {
    return this.phase !== 'closed';
  }

  // The card list's rows as the exe builds them when the list opens (state 0xb).
  private openList(): void {
    this.list = cardRows(this.host.book(), this.text(T11_GUILD.empty));
    this.listState.cursor = 0;
    this.phase = 'list';
  }

  // One key. Returns the action the port does not have (the menu stays open).
  key(e: MenuKey): UnportedAction | null {
    if (this.phase === 'list') {
      const r = listKey(e, this.list, this.listState);
      if (r === 'cancel') this.phase = 'menu';
      if (r !== 'decide') return null;
      const row = this.list[this.listState.cursor]!;
      return { state: 0x0c, card: row.value };
    }
    if (this.phase === 'menu') {
      const r = listKey(e, this.menu, this.menuState);
      if (r === 'cancel') this.phase = 'closed';
      if (r !== 'decide') return null;
      const row = this.menu[this.menuState.cursor]!;
      if (row.value === GUILD_MENU_STATE.cardList) {
        this.openList();
        return null;
      }
      return { state: row.value, card: -1 };
    }
    return null;
  }

  // The menu window at (13, 256); the card list at (194, 256) while it is open.
  // Both are drawn by the caller in the lobby's mid band.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    const title = this.text(T11_GUILD.title);
    const m = GUILD_CARD_POS.menu;
    drawListWindow(ctx, skin, m.x, m.y, windowWidth(this.menu, title), title, this.menu, this.menuState.cursor, this.phase === 'menu');
    if (this.phase === 'list') {
      const l = GUILD_CARD_POS.list;
      drawListWindow(ctx, skin, l.x, l.y, windowWidth(this.list, null), null, this.list, this.listState.cursor);
    }
  }
}
