// The lobby Home menu's Guild Card leaf (main menu entry 0xe), as PsoBB.exe
// (Ephinea 1.25.13) runs it: the Guild Card menu window, the card list, the
// card action menu and its actions, the Block list. The card book itself is
// net/guildcard.ts.
//
// Decoded from the dump (Psobb.exe-05112026.c, names of the windows trusted only
// where the code agrees with them):
//   - GuildCardMenuStateHandler_00746bdc (714652..716264): state 0 / 1 close the
//     sub-windows and open the menu window (CreateGuildCardMenuWindow_0074736c,
//     716268) at get_gui_position(0x82) = (13, 256), title unitxt(11, 0x30),
//     rows unitxt(11, 0x65) -> state 3, 0x66 -> state 0xb, 0x67 -> state 0x1d,
//     unitxt(11, 0x117) -> state 0x39 (greyed unless the scene is logged_in).
//   - The description box (state 0 creates it, the window at 0x83 = (435, 256),
//     CreateGuildCardConfirmDialog_00747430): state 2 adds the text of the menu's
//     cursor row, unitxt(11, DAT_00973414[cursor]) = 90 / 91 / 92 / 280
//     (CreateGuildCardListWindow_0074744c, 716316). It is not a confirm dialog.
//   - State 0xb (the card list, 0x88 = (194, 256)): GuildCardListWindow_PopulateItems_00748430
//     (717161) shows 7 rows at page * 7 (the page is the byte the object at +0x9c
//     points to); the page object is built with ChatShortcutMenu_SubList_SetData
//     (pages = ceil(cards / 7), at least 1), and its input handler
//     (ChatShortcutMenu_HandleInput_0073e60c) wraps the page. The card list also
//     moves the description box to get_gui_position(0x9c) = (419, 256) and shows
//     the highlighted card's comment there (SetGuildCardField_00747758 /
//     GetGuildCardFieldOffset_00781e4c: the comment at entry +0x10c).
//   - State 0xc: a card chosen -> state 0xd, the card action menu at
//     get_gui_position(0x8a) = (419, 256) (CreateGuildCardMenuList_0074762c, 716414):
//     rows unitxt(11, 0x6c) = 0x0f (search, greyed unless logged_in), 0x120 = 0x11
//     (view), 0x121 = 0x13 (comment), 0x76 = 0x1b (swap), 0x6d = 0x15 (delete).
//     Cancel -> state 0xb (the card list again).
//   - 0x0f (search): HandleGuildCardMenuSelection_0074770c (716451) sends 0040 for
//     the card (ShipConnectionManager_SendPacket_00827f28, 841367) and the leaf goes
//     to the card list (state 0x10 -> 0xb). The 0041 answer has no window of its own
//     (see SEARCH below).
//   - 0x11 (view): the comment box is shown; any key of [0xc] / [0xd] goes back to
//     the card list (state 0x12 -> 0xb).
//   - 0x13 (comment): the list closes and the keyboard opens with the comment as
//     its text (CreateGuildCardKeyboardInput_00747784); accepting calls
//     GuildCard_SetName_00781e68, which writes the comment (+0x10c, at most 0x57
//     characters) and sends 09E8 (send_packet0xe8_subcommand9); either way -> state 1.
//   - 0x1b (swap): the highlighted card is marked (0x8c selected_line), then state
//     0x1c picks the target: chosen -> SwapGuildCardData_00781d44 sends 0AE8 (the two
//     card numbers) and swaps the entries, then state 0x19 / 0x1a waits for the next
//     mark (chosen -> 0x1b) or cancel -> state 1.
//   - 0x15 (delete): the yes / no sub-window at get_gui_position(0x8b) = (419, 314),
//     width 205, cursor on No; Yes -> HandleGuildCardMenuData_00781c3c sends 05E8
//     (the card number) and removes the entry -> state 1; No or cancel -> state 0xd.
//   - 0x117 (state 0x39, the Block list): CreateGuildCardApplyListWindow_00747b38
//     (716706) at get_gui_position(0x93) = (194, 256), title unitxt(11, 0x117). Rows:
//     0x119 (unblock, state 0x3b) and 0x11a (add, state 0x3f). The add row is greyed
//     when the blocked list has no free slot (CheckForAvailableGuildCardSlot_00782640).
//       - Unblock (0x3b, 0x3c): the blocked list at 0x94 = (194, 256),
//         CreateGuildCardListWindow_00747bd0 (0x1c entries). Choosing an entry opens the
//         yes / no at 0x99 = (419, 256), width 213, text unitxt(11, 0x11b) (0x3d, the
//         cursor on No). Yes -> RemoveGuildCardSlot_007825ec sends 08E8 with the blocked
//         card's number and shifts the list (state 1); No -> back to the blocked list.
//         Cancel in the blocked list -> state 0x39.
//       - Add (0x3f): the source list at 0x96 = (429, 256), title unitxt(11, 0x30),
//         rows 0x11c (card book, state 0x41), 0x11d (a lobby player, 0x45), 0x11e
//         (an entity, 0x4a). Cancel -> state 0x39.
//         * Card book (0x41, 0x42): the card list at 0x88, paged like the menu's card
//           list. Cancel -> state 1. A card -> the confirm at 0x9a = (419, 256), width
//           213, text unitxt(11, 0x11f) (0x43, cursor on No). Yes ->
//           HandleGuildCardMenuData_007824d4: when the number is already in the blocked
//           list nothing is sent (GuildCard_CopyDataWithFlags_00781534 returns 1);
//           otherwise the card is copied to the blocked list and 07E8 is sent
//           (send_packet0xe8_subcommand7, dump 814338: byte 7, command 0x07E8, the
//           card as 0x110 bytes). The card-book add sends 07E8, not 04E8.
//         * Lobby player (0x45, 0x46): the list at 0x97 = (194, 256), title unitxt(11,
//           0x40), the other players of the lobby (slot != the current one) with their
//           names; none -> the greyed row unitxt(11, 0xf1). A player -> the same confirm
//           (0x48); Yes -> HandleGuildCardMenuStackData_0078253c: GuildCard_UpdateFromPlayer_0078175c
//           copies the player's name, class, slot and guild card number (its
//           player_guildcard; 0 means nothing is copied), then the same block copy and
//           07E8 as the card book path.
//         * Entity (0x4a, 0x4b): the list at 0x98 = (194, 256), title unitxt(11, 0x41),
//           the entities of the game (GetEntityByIndex); none -> the greyed row
//           unitxt(11, 0xf0). The port has no entity with a guild card, so only the empty row.
//
// SEARCH (0x0f, 0040 -> 0041): the exe's 0041 handler (handle_ship_packet0x41, 809943)
// gives the reply to the player-info list window (g_pChallengePlayerInfoWindowList),
// which is never created in the dump (CreateChallengePlayerInfoWindowListWindow_0074ec58
// has no caller), so the reply goes to unknown_packet_handlers[0x18] =
// GuildCardList_AddOrMoveToFront_00827f48 (776274): the recent list g_GuildCardList
// (seven 0x124-byte entries, the menu's text list row 0x67). The port keeps that list
// in GuildCardClient.recent (addRecent); its window (row 0x67) is not ported yet.
//
// ROW 0x67 (state 0x1d, the recent search list): CreateGuildCardTextListWindow_007478a8
// (716557) at get_gui_position(0x8c) = (194, 256), title unitxt(11, 0x34), 8 rows. Each
// row is an entry of g_GuildCardList (0x124 bytes: +0 card number, +4 the entry id that
// is the row's value, +8 the 16-wchar name). The name is the book's card of that number
// when the book has one (GuildCard_FindById, +4 of the record), else the reply's name
// (+0xe4). Empty -> the greyed row unitxt(11, 0xf2). Choosing a row opens the search
// result info window 0x8d and the option list 0x8e (states 0x1f / 0x20: unitxt 0x6a
// -> state 0x21, 0x6b -> state 0x25); NOT ported: the row reports state 0x1f.
//
// ROW 0x65 (state 3, the sub-list): CreateGuildCardSubListWindow_00747480 (716334) at
// get_gui_position(0x85) = (402, 256), title unitxt(11, 0x31), rows unitxt(11, 0x68) =
// value 5 (state 5) and unitxt(11, 0x69) = value 9 (state 9). Cancel -> the menu.
//   - 0x68 (state 5): the lobby players at get_gui_position(0x86) = (402, 315), title
//     unitxt(11, 0x32), the other players (slot != the current one, invincibility 3 / 6
//     skipped), none -> unitxt(11, 0xf1) greyed. Cancel -> the sub-list. A player ->
//     state 6: GuildCard_Sprintf_0078193c -> TeamQuest_SendPacket_008005b0 ->
//     send_packet0x62 (the target player's slot, not traced further), then the title
//     window 0x87 (unitxt 0x4b) until a key is held (state 8) -> state 3. NOT ported:
//     the 0x62 send (reported as state 6) and the title window.
//   - 0x69 (state 9): the keyboard (CreateGuildCardKeyboardInput_00747548) for the own
//     card's name; accepting calls GuildCard_SetName_007814bc on g_pPlayerSessionData and
//     sends 06E8 (send_packet0xe8_subcommand6, 0x110 bytes). NOT ported: reported as state 9.
//   - state 3 also creates the own card's info window at 0x84 = (194, 256)
//     (GuildCardMenu_GetOrCreateInstance_007153e0 on g_pPlayerSessionData): NOT drawn.
//
// CARD INFO WINDOW 0x89 (GuildCardMenu_CreateAtGuiPosition_00747d84 -> the factory
// GuildCardMenu_Factory_00715654 (676434) -> GuildCardMenu_InitializeListWindow_00715494
// -> GuildCardUI_UpdateListItemText_00715518 (676343..676460)). get_gui_position(0x89) =
// (419, 256). The window's text items are the card's name (+4), the card number (+0,
// shown when not 0 and the byte +0x104 bit 2 is clear, ASSUMED), the class (+0x107,
// unitxt_get_class_name: unitxt + 0x20, group 8, ASSUMED), the section (+0x106,
// unitxt_get_sectionid_name: unitxt + 0x120, group 72, the same group the port's
// charcreate uses), the team (+0x34) and the description (+0x54). The language (+0x105)
// is the exe's static list PTR_u_Jpn__009f1e60 and is not drawn. The window is created in
// the add-from-card-book list (state 0x41, its highlighted card) and in the card list
// (states 0xb / 0x1b). The port draws it in the add-from-card-book list only: the card
// list's comment box is at the same position (419, 256) in the exe too and the port's
// comment box stays where it was (overlap not resolved, see ASSUMED).
//
// The search result's option list 0x8e (row 0x67's choice) is drawn; its Send Mail (0x21) and
// Meet the User (0x25) rows act through classic/homeleaves.ts searchAction (2026-10-23 DEVLOG).
// NOT ported (logged no-ops, the menu stays open): the search result window 0x8d (not drawn),
// the row 0x65 sub-list's 0x62 send and rename,
// the own card's window 0x84, and the send packet 0xc0.
//
// ASSUMED (not traced):
//   - the page keys are ArrowLeft / ArrowRight (the exe reads g_KeyboardSharedState
//     [0x10] / [0x11]); the page wraps as ChatShortcutMenu_HandleInput does;
//   - the cursor returns to the top row of a page; the page index is not drawn;
//   - the description and comment boxes are CARD_TEXT_WIDTH wide (the width
//     the exe passes for the 0x83 box in DAT_0097340c, 188.0), wrapped to lines;
//   - the list's cursor is shown only when the list is the active window;
//   - the Yes / No labels are unitxt(11, 0x6e) / (11, 0x6f) (as the lobby's quit
//     question); the delete question is unitxt(11, 0x4c), the add and unblock
//     questions unitxt(11, 0x11f) / (11, 0x11b); the 0x33 sub-list title is not drawn;
//   - the comment editor is drawn at (331, 266) (the keyboard position 0xcf) as a
//     plain box; the exe's keyboard panel is not ported;
//   - the card list's page count is computed from the book's present cards
//     (GetNextAvailableGuildCardIndex counts the same entries);
//   - the exe's 0x7c card info window that opens with a swap or search is not drawn;
//   - the Block list's add row is recomputed each time the list opens (the exe builds
//     the window once and keeps its greyed flag);
//   - the blocked list shows the empty row unitxt(11, 0xf3) when empty;
//   - a lobby player's card: name, guild card number, section and class from the
//     lobby record, the player's slot in the language byte (+0x105, the exe's player id);
//     the team name and description are empty (the exe clears the record);
//   - the lobby player list lists every other player (the exe skips the players in
//     the invincibility states 3 and 6, not modelled);
//   - the searcher is the own guild card number (the exe's ship connection fields
//     0x12120 / 0x12124 are passed to send_packet0x40, not traced further);
//   - the book is synced once per session (BBSession.startGuildCardSync); a menu
//     opened before the sync shows the empty row.
//   - row 0x67: the recent row's name is the book's card name for that number when
//     the book has one, else the reply's name; the row value is the list index (the
//     exe's value is the entry id, +4); the window is rebuilt on each opening;
//   - row 0x65: the sub-list stays drawn under the player list (the exe calls
//     ListWindowObject_Hide on it at state 3, not traced); the own card's window
//     0x84 is not drawn;
//   - the card info window's class text is unitxt group 8 and its section text is
//     unitxt group 72 (the exe's unitxt + 0x20 / + 0x120 table offsets, read as
//     4 bytes per group); the host supplies them (GuildCardHost.unitxt);
//   - the card info window's number is hidden when the card number is 0 (the exe
//     also hides it on the byte +0x104 bit 2, not modelled);
//   - the card info window and the card list's comment box both sit at (419, 256) in
//     the exe; the port draws the info window only in the add-from-card-book list, so
//     the overlap in the card list is not decided (which one the exe keeps there is not traced).

import { se, SE } from '../audio/se.ts';
import { GCF_CARD_RECEIVED, guildCardFlags } from '../net/guildcardflags.ts';
import type { GuildCard, GuildCardBook, GuildCardClient, GuildCardSearchResult } from '../net/guildcard.ts';
import { wrapGameText } from './chat.ts';
import { drawListWindow, INSET, listKey, type ListItem } from './fieldwindows.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import type { MenuKey, Text } from './gamelist.ts';
import { drawWindowFrame, type WindowSkin } from './stage.ts';
import { Question } from './teammenu.ts';
import { CARET, caretColor, TextEditor } from './titleflow.ts';

// Position table entries (0x00971f40 + 8 * index, read with tools/exedata.py).
export const GUILD_CARD_POS = {
  menu: { x: 13, y: 256 }, // 0x82
  list: { x: 194, y: 256 }, // 0x88
  action: { x: 419, y: 256 }, // 0x8a
  question: { x: 419, y: 314 }, // 0x8b (the delete yes / no)
  description: { x: 435, y: 256 }, // 0x83 (the menu's description box)
  cardText: { x: 419, y: 256 }, // 0x9c (the card comment box in the card list)
  keyboard: { x: 331, y: 266 }, // 0xcf (the comment editor)
  blockList: { x: 194, y: 256 }, // 0x93 (the Block list: unblock / add)
  blocked: { x: 194, y: 256 }, // 0x94 (the blocked senders)
  textList: { x: 194, y: 256 }, // 0x8c (the recent search list, row 0x67)
  sub: { x: 402, y: 256 }, // 0x85 (the row 0x65 sub-list)
  playerPick: { x: 402, y: 315 }, // 0x86 (the lobby players of the sub-list's first row)
  cardInfo: { x: 419, y: 256 }, // 0x89 (the card info window of the highlighted card)
  addSource: { x: 429, y: 256 }, // 0x96 (card book / lobby player / entity)
  playerList: { x: 194, y: 256 }, // 0x97 (the lobby players)
  entityList: { x: 194, y: 256 }, // 0x98 (the entities)
  unblockAsk: { x: 419, y: 256 }, // 0x99 (the unblock yes / no)
  addAsk: { x: 419, y: 256 }, // 0x9a (the add yes / no)
  searchOptions: { x: 439, y: 256 }, // 0x8e (the recent row's option list: search keyboard / 0x25)
} as const;

// Width of the description and comment boxes (ASSUMED: DAT_0097340c = 188.0).
export const CARD_TEXT_WIDTH = 188;
// The rows per page of the card list (ChallengeMenuListWindow_Constructor(..., 7, ...)).
export const CARDS_PER_PAGE = 7;
// The longest comment: GuildCard_SetName_00781e68 copies at most 0x57 characters.
export const MAX_COMMENT = 0x57;
// The blocked list holds 0x1c senders (GetGuildCardArrayElementOffset, DAT_0000001c).
export const BLOCKED_MAX = 0x1c;

// unitxt group 11 indices used here.
export const T11_GUILD = {
  title: 0x30,
  sublist: 0x65,
  cardList: 0x66,
  textList: 0x67,
  block: 0x117,
  empty: 0xf3,
  actionSearch: 0x6c,
  actionView: 0x120,
  actionComment: 0x121,
  actionSwap: 0x76,
  actionDelete: 0x6d,
  question: 0x4c,
  yes: 0x6e,
  no: 0x6f,
  blockRemove: 0x119,
  blockAdd: 0x11a,
  unblockQuestion: 0x11b,
  addCard: 0x11c,
  addPlayer: 0x11d,
  addEntity: 0x11e,
  addQuestion: 0x11f,
  playerTitle: 0x40,
  entityTitle: 0x41,
  noEntities: 0xf0,
  noPlayers: 0xf1,
  subTitle: 0x31,
  pickTitle: 0x32,
  textTitle: 0x34,
  subShowCard: 0x68,
  subRename: 0x69,
  noRecent: 0xf2,
  searchOption21: 0x6a,
  searchOption25: 0x6b,
} as const;

// unitxt groups of the card info window's class and section names (unitxt + 0x20 and + 0x120).
export const UNITXT_GROUP = { className: 8, sectionName: 72 } as const;

// unitxt group 11 texts of the menu's cursor rows (DAT_00973414, the description box).
export const GUILD_DESCRIPTION = [0x5a, 0x5b, 0x5c, 0x118] as const;

// The exe's state codes of the menu rows (the value of each row).
export const GUILD_MENU_STATE = { sublist: 0x03, cardList: 0x0b, textList: 0x1d, block: 0x39 } as const;

// The exe's state codes of the card action menu rows (the value of each row).
export const GUILD_ACTION = { search: 0x0f, view: 0x11, comment: 0x13, swap: 0x1b, delete: 0x15 } as const;

// The exe's state codes of the Block list rows and of the add sources.
export const GUILD_BLOCK_STATE = { blockRemove: 0x3b, blockAdd: 0x3f } as const;
export const GUILD_ADD_STATE = { card: 0x41, player: 0x45, entity: 0x4a } as const;

// The row 0x65 sub-list's values (state 5: the players, state 9: the rename) and the
// state a recent row or a player reports (ported as logged no-ops).
export const GUILD_SUB_STATE = { players: 5, rename: 9 } as const;
export const GUILD_TEXT_OPEN_STATE = 0x1f;
// The send to a player (state 6) and the rename (state 9) are ported; the search option list
// (0x8e) values: 0x6a -> state 0x21 (the keyboard), 0x6b -> state 0x25 (both reported, not ported).
export const GUILD_SEARCH_OPTION = { keyboard: 0x21, option25: 0x25 } as const;

// A lobby player as the add-from-player path reads it (the lobby record's fields).
export interface LobbyPlayerCard {
  // The player's slot (the exe's player index, the list's value).
  slot: number;
  name: string;
  guildCardNumber: number;
  sectionId: number;
  charClass: number;
}

export interface GuildCardHost {
  book(): GuildCardBook | null;
  // The E8 sender of the game-server connection (null before the login sync).
  client(): GuildCardClient | null;
  // The own guild card number (the search's sender); null before the login.
  selfGuildCard(): number | null;
  // The other players of the lobby (the current player is not in the list).
  lobbyPlayers(): LobbyPlayerCard[];
  // The scene is logged_in (the lobby always is); 0x117 and search are greyed otherwise.
  loggedIn: boolean;
  // unitxt text of any group (the card info window's class and section names).
  unitxt?: (group: number, index: number) => string;
}

// What a key press asked for that the port does not do yet (the caller logs it).
export interface UnportedAction {
  state: number;
  // The card's slot index for the card action menu (-1 for a menu row).
  card: number;
}

// The card list rows of one page (GuildCardListWindow_PopulateItems_00748430): slots
// page * 7 .. page * 7 + 6 in slot order, stopping at the first empty slot; no card on
// the page gives the greyed empty row. The value of a row is the slot index.
export function cardRows(book: GuildCardBook | null, emptyLabel: string, page = 0): ListItem[] {
  const rows: ListItem[] = [];
  if (book) {
    const entries = book.view().entries;
    const first = page * CARDS_PER_PAGE;
    for (let slot = first; slot < Math.min(entries.length, first + CARDS_PER_PAGE); slot++) {
      const e = entries[slot]!;
      if (!e.card.present) break;
      rows.push({ label: e.card.name.replace(/\n/g, ' '), value: slot, enabled: true });
    }
  }
  return rows.length ? rows : [{ label: emptyLabel, value: -1, enabled: false }];
}

// The page count: ceil(cards / 7), at least 1 (ChatShortcutMenu_SubList_SetData's count).
export function cardPageCount(book: GuildCardBook | null): number {
  let n = 0;
  if (book) {
    for (const e of book.view().entries) {
      if (!e.card.present) break;
      n++;
    }
  }
  return Math.max(1, Math.ceil(n / CARDS_PER_PAGE));
}

// The blocked list's rows (the value is the slot in the blocked array), stopping at the first empty slot.
export function blockedRows(book: GuildCardBook | null, emptyLabel: string): ListItem[] {
  const rows: ListItem[] = [];
  if (book) {
    const blocked = book.view().blocked;
    for (let slot = 0; slot < Math.min(blocked.length, BLOCKED_MAX); slot++) {
      const c = blocked[slot]!;
      if (!c.present) break;
      rows.push({ label: c.name.replace(/\n/g, ' '), value: slot, enabled: true });
    }
  }
  return rows.length ? rows : [{ label: emptyLabel, value: -1, enabled: false }];
}

// The Block list (CreateGuildCardApplyListWindow_00747b38): unblock always, add only when
// the blocked list has a free slot (ASSUMED: recomputed at each opening).
export function blockRows(text: Text, hasFreeSlot: boolean): ListItem[] {
  return [
    { label: text(T11_GUILD.blockRemove), value: GUILD_BLOCK_STATE.blockRemove, enabled: true },
    { label: text(T11_GUILD.blockAdd), value: GUILD_BLOCK_STATE.blockAdd, enabled: hasFreeSlot },
  ];
}

// The add source rows (GuildCardUI_GetItemData_00747ce0).
export function addSourceRows(text: Text): ListItem[] {
  return [
    { label: text(T11_GUILD.addCard), value: GUILD_ADD_STATE.card, enabled: true },
    { label: text(T11_GUILD.addPlayer), value: GUILD_ADD_STATE.player, enabled: true },
    { label: text(T11_GUILD.addEntity), value: GUILD_ADD_STATE.entity, enabled: true },
  ];
}

// The lobby players' rows (the value is the player's slot), the greyed row when none.
export function playerRows(players: readonly LobbyPlayerCard[], emptyLabel: string): ListItem[] {
  if (!players.length) return [{ label: emptyLabel, value: -1, enabled: false }];
  return players.map((p) => ({ label: p.name.replace(/\n/g, ' '), value: p.slot, enabled: true }));
}

// The card a lobby player adds to the block list (GuildCard_UpdateFromPlayer_0078175c):
// nothing when the player has no guild card number (the exe copies nothing).
export function guildCardFromPlayer(p: LobbyPlayerCard): GuildCard | null {
  if (!p.guildCardNumber) return null;
  return {
    guildCardNumber: p.guildCardNumber,
    name: p.name,
    teamName: '',
    description: '',
    present: true,
    language: p.slot & 0xff,
    sectionId: p.sectionId,
    charClass: p.charClass,
  };
}

// The recent search list rows (row 0x67; CreateGuildCardTextListWindow_007478a8 and the
// state 0x1d fill loop). The name is the book's card name for that number when the book
// has the card (GuildCard_FindById), else the reply's name. Value: the list index (ASSUMED,
// the exe's value is the entry id). Empty -> the greyed row.
export function recentRows(recent: readonly GuildCardSearchResult[], book: GuildCardBook | null, emptyLabel: string): ListItem[] {
  if (!recent.length) return [{ label: emptyLabel, value: -1, enabled: false }];
  const cards = book ? book.cards() : [];
  return recent.map((r, i) => {
    const known = cards.find((c) => c.guildCardNumber === r.guildCardNumber);
    return { label: (known ? known.name : r.name).replace(/\n/g, ' '), value: i, enabled: true };
  });
}

// The row 0x65 sub-list (CreateGuildCardSubListWindow_00747480): the players and the rename.
export function subRows(text: Text): ListItem[] {
  return [
    { label: text(T11_GUILD.subShowCard), value: GUILD_SUB_STATE.players, enabled: true },
    { label: text(T11_GUILD.subRename), value: GUILD_SUB_STATE.rename, enabled: true },
  ];
}

// The search option list (CreateGuildCardOptionListWindow_007478e0, 0x8e): both rows enabled in the lobby.
export function searchOptionRows(text: Text): ListItem[] {
  return [
    { label: text(T11_GUILD.searchOption21), value: GUILD_SEARCH_OPTION.keyboard, enabled: true },
    { label: text(T11_GUILD.searchOption25), value: GUILD_SEARCH_OPTION.option25, enabled: true },
  ];
}

// The card info window's lines (GuildCardUI_UpdateListItemText_00715518): name, number
// (not 0), class, section, team, description. The language is not drawn (see the header).
export function cardInfoLines(card: GuildCard, unitxt: (group: number, index: number) => string): string[] {
  const lines = [card.name];
  if (card.guildCardNumber) lines.push(String(card.guildCardNumber));
  lines.push(unitxt(UNITXT_GROUP.className, Math.min(card.charClass, 0xc)));
  lines.push(unitxt(UNITXT_GROUP.sectionName, Math.min(card.sectionId, 10)));
  if (card.teamName) lines.push(card.teamName);
  if (card.description) lines.push(card.description);
  return lines.map((l) => l.replace(/\n/g, ' ')).filter((l) => l.length > 0);
}

export function menuRows(text: Text, loggedIn: boolean): ListItem[] {
  return [
    { label: text(T11_GUILD.sublist), value: GUILD_MENU_STATE.sublist, enabled: true },
    { label: text(T11_GUILD.cardList), value: GUILD_MENU_STATE.cardList, enabled: true },
    { label: text(T11_GUILD.textList), value: GUILD_MENU_STATE.textList, enabled: true },
    { label: text(T11_GUILD.block), value: GUILD_MENU_STATE.block, enabled: loggedIn },
  ];
}

// The card action menu rows, in the exe's order (CreateGuildCardMenuList_0074762c).
export function actionRows(text: Text, loggedIn: boolean): ListItem[] {
  return [
    { label: text(T11_GUILD.actionSearch), value: GUILD_ACTION.search, enabled: loggedIn },
    { label: text(T11_GUILD.actionView), value: GUILD_ACTION.view, enabled: true },
    { label: text(T11_GUILD.actionComment), value: GUILD_ACTION.comment, enabled: true },
    { label: text(T11_GUILD.actionSwap), value: GUILD_ACTION.swap, enabled: true },
    { label: text(T11_GUILD.actionDelete), value: GUILD_ACTION.delete, enabled: true },
  ];
}

// Width of a titled or plain list window: the widest label plus the inset on both sides.
function windowWidth(items: readonly ListItem[], title: string | null): number {
  const widest = Math.max(0, ...items.map((i) => gameTextWidth(i.label)), title ? gameTextWidth(title) : 0);
  return widest + 2 * INSET;
}

// A text box: the frame at (x, y) and the wrapped text, the Question's layout (14 for
// the first line, 20 for each further line, plus a 20 frame).
function drawTextBox(ctx: CanvasRenderingContext2D, skin: WindowSkin, x: number, y: number, text: string): void {
  drawTextLines(ctx, skin, x, y, [text]);
}

// The same box with several paragraphs, each wrapped on its own (the card info window's lines).
function drawTextLines(ctx: CanvasRenderingContext2D, skin: WindowSkin, x: number, y: number, paragraphs: readonly string[]): void {
  const lines = paragraphs.flatMap((p) => wrapGameText(p, CARD_TEXT_WIDTH - 2 * INSET));
  const h = 14 + 20 * Math.max(0, lines.length - 1) + 20;
  drawWindowFrame(ctx, skin.frame, x, y, CARD_TEXT_WIDTH, h);
  lines.forEach((line, i) => drawGameText(ctx, line, x + INSET, y + INSET + i * 20));
}

export type GuildCardPhase =
  | 'menu'
  | 'list'
  | 'view'
  | 'action'
  | 'delete'
  | 'comment'
  | 'swapMark'
  | 'swapTarget'
  | 'block'
  | 'blocked'
  | 'unblockAsk'
  | 'addSource'
  | 'addCard'
  | 'addPlayer'
  | 'addEntity'
  | 'addAsk'
  | 'text'
  | 'sub'
  | 'subPlayers'
  | 'searchOpts'
  | 'rename'
  | 'closed';

const PAGE_KEYS: Readonly<Record<string, -1 | 1>> = { ArrowLeft: -1, ArrowRight: 1 };

export class GuildCardMenu {
  phase: GuildCardPhase = 'menu';
  private readonly text: Text;
  private readonly host: GuildCardHost;
  private readonly menu: ListItem[];
  private readonly menuState = { cursor: 0 };
  // The card list and the other list windows (blocked, players, entities).
  private list: ListItem[] = [];
  private readonly listState = { cursor: 0 };
  private page = 0;
  // The small menus: the Block list and the add sources.
  private sub: ListItem[] = [];
  private readonly subState = { cursor: 0 };
  private action: ListItem[] = [];
  private readonly actionState = { cursor: 0 };
  // The slot the card action menu was opened for (0x2c).
  private slot = -1;
  // The value of the row an add / unblock question is about (a slot or a player's slot).
  private askValue = -1;
  // The list an add question came from (0x42 or 0x45).
  private askBack: GuildCardPhase = 'addCard';
  private question: Question | null = null;
  private editor: TextEditor | null = null;
  // The search option list of a recent row (0x8e) and its cursor.
  private searchOpts: ListItem[] = [];
  private readonly searchState = { cursor: 0 };
  // The slot marked for a swap (0x8c selected_line), -1 for none.
  private mark = -1;

  constructor(text: Text, host: GuildCardHost) {
    this.text = text;
    this.host = host;
    this.menu = menuRows(text, host.loggedIn);
  }

  get open(): boolean {
    return this.phase !== 'closed';
  }

  // The card list's rows for the current page (rebuilt when the book or the page changes).
  private buildList(): void {
    this.page = Math.min(this.page, cardPageCount(this.host.book()) - 1);
    this.list = cardRows(this.host.book(), this.text(T11_GUILD.empty), this.page);
    if (this.listState.cursor >= this.list.length) this.listState.cursor = 0;
  }

  // The card list opens (state 0xb, or the add-from-card-book list 0x41): page 0, cursor on the top row.
  private openCards(phase: 'list' | 'addCard'): void {
    this.page = 0;
    this.listState.cursor = 0;
    this.buildList();
    this.phase = phase;
  }

  // A page key (ChatShortcutMenu_HandleInput): the page wraps; the cursor goes to the top.
  private turnPage(dir: -1 | 1): void {
    const n = cardPageCount(this.host.book());
    this.page = (this.page + dir + n) % n;
    this.listState.cursor = 0;
    this.buildList();
    se(SE.cursor);
  }

  // The card number in a slot, or null when the slot is empty.
  private cardNumber(slot: number): number | null {
    const e = this.host.book()?.view().entries[slot];
    return e && e.card.present ? e.card.guildCardNumber : null;
  }

  // The blocked card number in a slot of the blocked array (RemoveGuildCardSlot's guard: slot < 0x1c).
  private blockedNumber(slot: number): number | null {
    const c = this.host.book()?.view().blocked[slot];
    return c && c.present ? c.guildCardNumber : null;
  }

  private openAction(slot: number): void {
    this.slot = slot;
    this.action = actionRows(this.text, this.host.loggedIn);
    this.actionState.cursor = 0;
    this.phase = 'action';
  }

  private startComment(): void {
    const entry = this.host.book()?.view().entries[this.slot];
    if (!entry || !entry.card.present) {
      this.phase = 'list';
      return;
    }
    this.editor = new TextEditor(entry.comment, MAX_COMMENT, false);
    this.phase = 'comment';
  }

  private startDelete(): void {
    this.question = new Question(this.text(T11_GUILD.question), { x: GUILD_CARD_POS.question.x, y: GUILD_CARD_POS.question.y, w: 205 });
    this.phase = 'delete';
  }

  // The yes / no at the given position (the Block list's unblock and the add confirms, width 213).
  private startAsk(at: { x: number; y: number }, text: number, back: GuildCardPhase, value: number): void {
    this.askBack = back;
    this.askValue = value;
    this.question = new Question(this.text(text), { x: at.x, y: at.y, w: 213 });
    this.phase = back === 'blocked' ? 'unblockAsk' : 'addAsk';
  }

  private openBlock(): void {
    const book = this.host.book();
    this.sub = blockRows(this.text, !!book && book.view().blocked.some((c) => !c.present));
    this.subState.cursor = 0;
    this.phase = 'block';
  }

  private openBlocked(): void {
    this.list = blockedRows(this.host.book(), this.text(T11_GUILD.empty));
    this.listState.cursor = 0;
    this.phase = 'blocked';
  }

  private openAddSource(): void {
    this.sub = addSourceRows(this.text);
    this.subState.cursor = 0;
    this.phase = 'addSource';
  }

  private openAddPlayer(): void {
    this.list = playerRows(this.host.lobbyPlayers(), this.text(T11_GUILD.noPlayers));
    this.listState.cursor = 0;
    this.phase = 'addPlayer';
  }

  private openSub(): void {
    this.sub = subRows(this.text);
    this.subState.cursor = 0;
    this.phase = 'sub';
  }

  // The recent search list (row 0x67): the rows of GuildCardClient.recent.
  private openText(): void {
    this.list = recentRows(this.host.client()?.recent ?? [], this.host.book(), this.text(T11_GUILD.noRecent));
    this.listState.cursor = 0;
    this.phase = 'text';
  }

  private openSubPlayers(): void {
    this.list = playerRows(this.host.lobbyPlayers(), this.text(T11_GUILD.noPlayers));
    this.listState.cursor = 0;
    this.phase = 'subPlayers';
  }

  private openAddEntity(): void {
    // The port has no entity with a guild card: the list holds only the greyed row.
    this.list = [{ label: this.text(T11_GUILD.noEntities), value: -1, enabled: false }];
    this.listState.cursor = 0;
    this.phase = 'addEntity';
  }

  // One key. Returns the action the port does not have (the menu stays open or the leaf
  // goes back to the list, as the exe does).
  key(e: MenuKey): UnportedAction | null {
    switch (this.phase) {
      case 'menu':
        return this.menuKey(e);
      case 'list':
        return this.listPhaseKey(e);
      case 'view':
        // State 0x12: Enter / Escape (the exe's [0xc] / [0xd]) returns to the card list.
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Backspace') {
          this.phase = 'list';
          se(SE.ok);
        }
        return null;
      case 'action':
        return this.actionKey(e);
      case 'delete':
        return this.deleteKey(e);
      case 'comment':
        this.commentKey(e);
        return null;
      case 'swapMark':
      case 'swapTarget':
        return this.swapKey(e);
      case 'block':
        this.blockKey(e);
        return null;
      case 'blocked':
        this.blockedKey(e);
        return null;
      case 'unblockAsk':
      case 'addAsk':
        this.askKey(e);
        return null;
      case 'addSource':
        this.addSourceKey(e);
        return null;
      case 'addCard':
        this.addCardKey(e);
        return null;
      case 'addPlayer':
        this.addPlayerKey(e);
        return null;
      case 'addEntity':
        this.addEntityKey(e);
        return null;
      case 'text':
        return this.textKey(e);
      case 'sub':
        return this.subKey(e);
      case 'subPlayers':
        return this.subPlayersKey(e);
      case 'searchOpts':
        return this.searchOptsKey(e);
      case 'rename':
        this.renameKey(e);
        return null;
      default:
        return null;
    }
  }

  private menuKey(e: MenuKey): UnportedAction | null {
    const r = listKey(e, this.menu, this.menuState);
    if (r === 'cancel') {
      // QuickMenuObject_CloseGuildCardMenu_00717d10 clears g_GuildCardFlags bit 2.
      this.phase = 'closed';
      guildCardFlags.clear(GCF_CARD_RECEIVED);
    }
    if (r !== 'decide') return null;
    const row = this.menu[this.menuState.cursor]!;
    if (row.value === GUILD_MENU_STATE.cardList) {
      this.openCards('list');
      return null;
    }
    if (row.value === GUILD_MENU_STATE.block) {
      this.openBlock();
      return null;
    }
    if (row.value === GUILD_MENU_STATE.sublist) {
      this.openSub();
      return null;
    }
    if (row.value === GUILD_MENU_STATE.textList) {
      this.openText();
      return null;
    }
    return { state: row.value, card: -1 };
  }

  // Row 0x67: a recent row opens the search option list (state 0x1f: the result window 0x8d is
  // not drawn; the option list 0x8e is).
  private textKey(e: MenuKey): UnportedAction | null {
    const r = listKey(e, this.list, this.listState);
    if (r === 'cancel') {
      this.phase = 'menu';
      return null;
    }
    if (r !== 'decide') return null;
    this.searchOpts = searchOptionRows(this.text);
    this.searchState.cursor = 0;
    this.phase = 'searchOpts';
    return null;
  }

  // The option list (state 0x20): cancel -> the recent list (state 0x1d); a row reports its state
  // (0x21 Send Mail, unitxt 0x6a; 0x25 Meet the User, unitxt 0x6b, ASSUMED label) and the recent
  // index. The owner (classic/homeleaves.ts searchAction) acts on it; the list stays drawn.
  private searchOptsKey(e: MenuKey): UnportedAction | null {
    const r = listKey(e, this.searchOpts, this.searchState);
    if (r === 'cancel') {
      this.phase = 'text';
      return null;
    }
    if (r !== 'decide') return null;
    return { state: this.searchOpts[this.searchState.cursor]!.value, card: this.list[this.listState.cursor]?.value ?? -1 };
  }

  // Row 0x65: the sub-list. The players (state 5) open the player list; the rename (state 9) opens the keyboard.
  private subKey(e: MenuKey): UnportedAction | null {
    const r = listKey(e, this.sub, this.subState);
    if (r === 'cancel') {
      this.phase = 'menu';
      return null;
    }
    if (r !== 'decide') return null;
    if (this.sub[this.subState.cursor]!.value === GUILD_SUB_STATE.players) {
      this.openSubPlayers();
      return null;
    }
    this.editor = new TextEditor('', MAX_COMMENT, false);
    this.phase = 'rename';
    return null;
  }

  // The lobby players (state 5): a player gets the card (state 6: the 0x62 send, GuildCard_Sprintf_0078193c);
  // then the player list closes and the sub-list is back (state 7 -> 8 -> 3; the title window 0x87 is not drawn).
  private subPlayersKey(e: MenuKey): UnportedAction | null {
    const r = listKey(e, this.list, this.listState);
    if (r === 'cancel') {
      this.phase = 'sub';
      return null;
    }
    if (r !== 'decide') return null;
    this.host.client()?.sendCardTo(this.list[this.listState.cursor]!.value);
    this.phase = 'sub';
    return null;
  }

  // The rename keyboard (state 9 -> 10, the text is the own card's description: GuildCard_SetName_007814bc
  // writes +0x54, at most 0x57 units, then 06E8). Enter sends the own card (when it is in the book);
  // Escape cancels. Both return to the menu (state 1).
  private renameKey(e: MenuKey): void {
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
      const self = this.host.selfGuildCard();
      const own = self === null ? undefined : this.host.book()?.find(self);
      if (own) this.host.client()?.update({ ...own.card, description: ed.text });
      this.editor = null;
      this.phase = 'menu';
    } else if (e.key === 'Backspace') {
      ed.backspace();
    } else if (e.key.length === 1) {
      ed.type(e.key);
    }
  }


  private listPhaseKey(e: MenuKey): UnportedAction | null {
    const dir = PAGE_KEYS[e.key];
    if (dir) {
      this.turnPage(dir);
      return null;
    }
    const r = listKey(e, this.list, this.listState);
    if (r === 'cancel') {
      this.phase = 'menu';
      return null;
    }
    if (r === 'decide') this.openAction(this.list[this.listState.cursor]!.value);
    return null;
  }

  private actionKey(e: MenuKey): UnportedAction | null {
    const r = listKey(e, this.action, this.actionState);
    if (r === 'cancel') {
      this.phase = 'list';
      return null;
    }
    if (r !== 'decide') return null;
    switch (this.action[this.actionState.cursor]!.value) {
      case GUILD_ACTION.search:
        // HandleGuildCardMenuSelection_0074770c: 0040 for the card; the leaf goes back to the list.
        this.search(this.cardNumber(this.slot));
        this.phase = 'list';
        return null;
      case GUILD_ACTION.view:
        this.phase = 'view';
        return null;
      case GUILD_ACTION.comment:
        this.startComment();
        return null;
      case GUILD_ACTION.swap:
        this.mark = this.slot;
        this.phase = 'swapTarget';
        return null;
      case GUILD_ACTION.delete:
        this.startDelete();
        return null;
      default:
        return null;
    }
  }

  // 0040 (send_packet0x40): the answer 0041 goes to the recent list (GuildCardClient.addRecent).
  // Nothing is sent before the login (no own number) or for an empty slot.
  private search(target: number | null): void {
    const c = this.host.client();
    const me = this.host.selfGuildCard();
    if (c === null || me === null || target === null) return;
    c.search(me, target).then(
      (r) => {
        if (r) c.addRecent(r);
      },
      () => {},
    );
  }

  private deleteKey(e: MenuKey): null {
    if (!this.question) {
      this.phase = 'action';
      return null;
    }
    this.question.key(e);
    const r = this.question.result;
    if (!r) return null;
    this.question = null;
    if (r === 'yes') {
      const num = this.cardNumber(this.slot);
      if (num !== null) this.host.client()?.remove(num);
      this.phase = 'menu';
    } else {
      this.phase = 'action';
    }
    return null;
  }

  // Enter sends the editor's text as the comment (GuildCard_SetName_00781e68 sends it
  // even when unchanged); Escape cancels (state 1, nothing sent).
  private commentKey(e: MenuKey): void {
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
      const num = this.cardNumber(this.slot);
      if (num !== null) this.host.client()?.setComment(num, ed.text);
      this.editor = null;
      this.phase = 'menu';
    } else if (e.key === 'Backspace') {
      ed.backspace();
    } else if (e.key.length === 1) {
      ed.type(e.key);
    }
  }

  // The swap: swapMark picks the card to move (state 0x1a / 0x1b), swapTarget the
  // card it goes to (state 0x1c). After a swap the leaf waits for the next mark.
  private swapKey(e: MenuKey): UnportedAction | null {
    const dir = PAGE_KEYS[e.key];
    if (dir) {
      this.turnPage(dir);
      return null;
    }
    const r = listKey(e, this.list, this.listState);
    if (r === 'cancel') {
      this.mark = -1;
      this.phase = 'menu';
      return null;
    }
    if (r !== 'decide') return null;
    const slot = this.list[this.listState.cursor]!.value;
    if (this.phase === 'swapTarget') {
      const a = this.cardNumber(this.mark);
      const b = this.cardNumber(slot);
      // SwapGuildCardData_00781d44: both slots valid -> 0AE8 with the two card numbers.
      if (a !== null && b !== null) this.host.client()?.swap(a, b);
      this.mark = -1;
      this.buildList();
      this.phase = 'swapMark';
    } else {
      this.mark = slot;
      this.phase = 'swapTarget';
    }
    return null;
  }

  // The Block list (state 0x39): unblock (0x3b) or add (0x3f); cancel -> the menu (state 1).
  private blockKey(e: MenuKey): void {
    const r = listKey(e, this.sub, this.subState);
    if (r === 'cancel') {
      this.phase = 'menu';
      return;
    }
    if (r !== 'decide') return;
    if (this.sub[this.subState.cursor]!.value === GUILD_BLOCK_STATE.blockRemove) this.openBlocked();
    else this.openAddSource();
  }

  // The blocked list (0x3b / 0x3c): cancel -> the Block list (0x39); a sender -> the unblock question.
  private blockedKey(e: MenuKey): void {
    const r = listKey(e, this.list, this.listState);
    if (r === 'cancel') {
      this.phase = 'block';
      return;
    }
    if (r !== 'decide') return;
    const slot = this.list[this.listState.cursor]!.value;
    if (slot < 0) return;
    this.startAsk(GUILD_CARD_POS.unblockAsk, T11_GUILD.unblockQuestion, 'blocked', slot);
  }

  // The unblock question (0x3d / 0x3e): Yes sends 08E8 and goes to the menu; No back to the blocked list.
  // The add question (0x43 / 0x44, 0x48 / 0x49): Yes adds the card and goes to the menu; No back to its list.
  private askKey(e: MenuKey): void {
    if (!this.question) {
      this.phase = this.askBack;
      return;
    }
    this.question.key(e);
    const r = this.question.result;
    if (!r) return;
    this.question = null;
    if (r !== 'yes') {
      this.phase = this.askBack;
      return;
    }
    if (this.askBack === 'blocked') {
      const num = this.blockedNumber(this.askValue);
      if (num !== null) this.host.client()?.unblock(num);
    } else if (this.askBack === 'addCard') {
      this.addFromBook(this.askValue);
    } else {
      this.addFromPlayer(this.askValue);
    }
    this.phase = 'menu';
  }

  // HandleGuildCardMenuData_007824d4: a card already in the blocked list sends nothing.
  private addFromBook(slot: number): void {
    const book = this.host.book();
    const entry = book?.view().entries[slot];
    const c = this.host.client();
    if (!book || !entry || !entry.card.present || !c) return;
    if (book.isBlocked(entry.card.guildCardNumber)) return;
    c.block(entry.card);
  }

  // HandleGuildCardMenuStackData_0078253c: the player's card, then the same copy and 07E8.
  private addFromPlayer(slot: number): void {
    const book = this.host.book();
    const p = this.host.lobbyPlayers().find((x) => x.slot === slot);
    const card = p ? guildCardFromPlayer(p) : null;
    const c = this.host.client();
    if (!book || !card || !c) return;
    if (book.isBlocked(card.guildCardNumber)) return;
    c.block(card);
  }

  // The add source list (state 0x40): cancel -> the Block list (0x39); a source -> its list.
  private addSourceKey(e: MenuKey): void {
    const r = listKey(e, this.sub, this.subState);
    if (r === 'cancel') {
      this.phase = 'block';
      return;
    }
    if (r !== 'decide') return;
    switch (this.sub[this.subState.cursor]!.value) {
      case GUILD_ADD_STATE.card:
        this.openCards('addCard');
        return;
      case GUILD_ADD_STATE.player:
        this.openAddPlayer();
        return;
      case GUILD_ADD_STATE.entity:
        this.openAddEntity();
        return;
    }
  }

  // The card book list for the add (state 0x42): paged; cancel -> the menu (state 1).
  private addCardKey(e: MenuKey): void {
    const dir = PAGE_KEYS[e.key];
    if (dir) {
      this.turnPage(dir);
      return;
    }
    const r = listKey(e, this.list, this.listState);
    if (r === 'cancel') {
      this.phase = 'menu';
      return;
    }
    if (r !== 'decide') return;
    const slot = this.list[this.listState.cursor]!.value;
    if (slot < 0) return;
    this.startAsk(GUILD_CARD_POS.addAsk, T11_GUILD.addQuestion, 'addCard', slot);
  }

  // The lobby player list (state 0x46): cancel -> the menu; a player -> the add question.
  private addPlayerKey(e: MenuKey): void {
    const r = listKey(e, this.list, this.listState);
    if (r === 'cancel') {
      this.phase = 'menu';
      return;
    }
    if (r !== 'decide') return;
    const slot = this.list[this.listState.cursor]!.value;
    if (slot < 0) return;
    this.startAsk(GUILD_CARD_POS.addAsk, T11_GUILD.addQuestion, 'addPlayer', slot);
  }

  // The entity list (state 0x4b): nothing to choose; cancel -> the menu.
  private addEntityKey(e: MenuKey): void {
    const r = listKey(e, this.list, this.listState);
    if (r === 'cancel') this.phase = 'menu';
  }

  // The menu window at (13, 256) is always drawn while the leaf is open; the
  // description box beside it in the menu, the card list / comment / action windows
  // in the card phases, the Block list windows in the block phases.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    const title = this.text(T11_GUILD.title);
    const m = GUILD_CARD_POS.menu;
    drawListWindow(ctx, skin, m.x, m.y, windowWidth(this.menu, title), title, this.menu, this.menuState.cursor, this.phase === 'menu');
    if (this.phase === 'menu') {
      const d = GUILD_CARD_POS.description;
      drawTextBox(ctx, skin, d.x, d.y, this.text(GUILD_DESCRIPTION[this.menuState.cursor] ?? GUILD_DESCRIPTION[0]));
    }
    const cardPhase =
      this.phase === 'list' || this.phase === 'view' || this.phase === 'action' || this.phase === 'delete' || this.phase === 'swapMark' || this.phase === 'swapTarget';
    if (cardPhase && this.phase !== 'action' && this.phase !== 'delete') {
      // The comment of the highlighted card (SetGuildCardField) at (419, 256); none on the empty row.
      const row = this.list[this.listState.cursor];
      const entry = row && row.value >= 0 ? this.host.book()?.view().entries[row.value] : undefined;
      if (entry && entry.card.present) {
        const c = GUILD_CARD_POS.cardText;
        drawTextBox(ctx, skin, c.x, c.y, entry.comment);
      }
    }
    if (cardPhase || this.phase === 'addCard' || (this.phase === 'addAsk' && this.askBack === 'addCard')) {
      const l = GUILD_CARD_POS.list;
      const active = this.phase === 'list' || this.phase === 'swapMark' || this.phase === 'swapTarget' || this.phase === 'addCard';
      drawListWindow(ctx, skin, l.x, l.y, windowWidth(this.list, null), null, this.list, this.listState.cursor, active);
    }
    if (this.phase === 'action' || this.phase === 'delete') {
      const a = GUILD_CARD_POS.action;
      drawListWindow(ctx, skin, a.x, a.y, windowWidth(this.action, title), title, this.action, this.actionState.cursor, this.phase === 'action');
    }
    if (this.phase === 'block') {
      const b = GUILD_CARD_POS.blockList;
      const blockTitle = this.text(T11_GUILD.block);
      drawListWindow(ctx, skin, b.x, b.y, windowWidth(this.sub, blockTitle), blockTitle, this.sub, this.subState.cursor, true);
    }
    if (this.phase === 'addSource') {
      const s = GUILD_CARD_POS.addSource;
      drawListWindow(ctx, skin, s.x, s.y, windowWidth(this.sub, title), title, this.sub, this.subState.cursor, true);
    }
    if (this.phase === 'text') {
      const t = GUILD_CARD_POS.textList;
      const textTitle = this.text(T11_GUILD.textTitle);
      drawListWindow(ctx, skin, t.x, t.y, windowWidth(this.list, textTitle), textTitle, this.list, this.listState.cursor, true);
    }
    if (this.phase === 'sub' || this.phase === 'subPlayers') {
      const s = GUILD_CARD_POS.sub;
      const subTitle = this.text(T11_GUILD.subTitle);
      drawListWindow(ctx, skin, s.x, s.y, windowWidth(this.sub, subTitle), subTitle, this.sub, this.subState.cursor, this.phase === 'sub');
    }
    if (this.phase === 'searchOpts') {
      const o = GUILD_CARD_POS.searchOptions;
      const optTitle = this.text(T11_GUILD.title);
      drawListWindow(ctx, skin, o.x, o.y, windowWidth(this.searchOpts, optTitle), optTitle, this.searchOpts, this.searchState.cursor, true);
    }
    if (this.phase === 'subPlayers') {
      const p = GUILD_CARD_POS.playerPick;
      const pickTitle = this.text(T11_GUILD.pickTitle);
      drawListWindow(ctx, skin, p.x, p.y, windowWidth(this.list, pickTitle), pickTitle, this.list, this.listState.cursor, true);
    }
    // The card info window 0x89 for the highlighted card of the add-from-card-book list (state 0x41 / 0x42).
    if (this.phase === 'addCard' || (this.phase === 'addAsk' && this.askBack === 'addCard')) {
      const row = this.list[this.listState.cursor];
      const entry = row && row.value >= 0 ? this.host.book()?.view().entries[row.value] : undefined;
      if (entry && entry.card.present) {
        const i = GUILD_CARD_POS.cardInfo;
        drawTextLines(ctx, skin, i.x, i.y, cardInfoLines(entry.card, this.host.unitxt ?? (() => '')));
      }
    }
    // Under a question the list it came from stays drawn (its cursor is not active).
    const under = this.phase === 'addAsk' ? this.askBack : this.phase === 'unblockAsk' ? 'blocked' : this.phase;
    const asking = under !== this.phase;
    if (under === 'blocked') {
      const b = GUILD_CARD_POS.blocked;
      drawListWindow(ctx, skin, b.x, b.y, windowWidth(this.list, null), null, this.list, this.listState.cursor, !asking);
    }
    if (under === 'addPlayer') {
      const p = GUILD_CARD_POS.playerList;
      drawListWindow(ctx, skin, p.x, p.y, windowWidth(this.list, this.text(T11_GUILD.playerTitle)), this.text(T11_GUILD.playerTitle), this.list, this.listState.cursor, !asking);
    }
    if (this.phase === 'addEntity') {
      const en = GUILD_CARD_POS.entityList;
      drawListWindow(ctx, skin, en.x, en.y, windowWidth(this.list, this.text(T11_GUILD.entityTitle)), this.text(T11_GUILD.entityTitle), this.list, this.listState.cursor, true);
    }
    if ((this.phase === 'delete' || this.phase === 'unblockAsk' || this.phase === 'addAsk') && this.question) {
      this.question.draw(ctx, skin, this.text(T11_GUILD.yes), this.text(T11_GUILD.no));
    }
    if ((this.phase === 'comment' || this.phase === 'rename') && this.editor) {
      const k = GUILD_CARD_POS.keyboard;
      drawWindowFrame(ctx, skin.frame, k.x, k.y, CARD_TEXT_WIDTH, 34);
      const shown = this.editor.shown;
      drawGameText(ctx, shown, k.x + INSET, k.y + INSET + 1);
      ctx.fillStyle = caretColor(0);
      ctx.fillRect(k.x + INSET + gameTextWidth(shown), k.y + INSET, CARET.w, CARET.h);
    }
  }
}
