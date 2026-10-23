// The lobby Home menu's Guild Card leaf (classic/guildcardmenu.ts): the menu rows
// and their greyed row, the card list built from the book (PopulateItems rules, 7
// rows a page), the key flow menu -> card list -> card action menu -> menu -> closed,
// the card actions (comment, swap, delete) with the E8 packets they send, the
// actions the port does not have (search, the other menu rows), and a drawing smoke
// test. Run: node tests/guildcardmenu.test.ts
import {
  actionRows,
  cardPageCount,
  cardRows,
  GuildCardMenu,
  GUILD_ACTION,
  GUILD_CARD_POS,
  GUILD_MENU_STATE,
  menuRows,
  T11_GUILD,
} from '../client/src/classic/guildcardmenu.ts';
import { GuildCardBook, GuildCardClient, GC_CMD, GC_FILE, type GuildCard } from '../client/src/net/guildcard.ts';

// A stub canvas and skin: every call does nothing (the same trick as teammenu.test.ts).
const noop = () => {};
const ctx = new Proxy(
  {},
  {
    get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 7 }) : prop === 'getImageData' ? () => ({ data: new Uint8ClampedArray(64) }) : noop),
    set: () => true,
  },
) as unknown as CanvasRenderingContext2D;
class FakeCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return ctx;
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeCanvas;
const deep: unknown = new Proxy(function () {}, { get: () => deep, apply: () => deep });
const skin = deep as Parameters<GuildCardMenu['draw']>[1];

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
}

// Labels are "g:i" so a test can see which unitxt row was asked for.
const text = (i: number): string => `t${i.toString(16)}`;
const key = (k: string) => ({ key: k });

function card(gc: number, name: string): GuildCard {
  return { guildCardNumber: gc, name, teamName: '', description: '', present: true, language: 0, sectionId: 0, charClass: 0 };
}

function bookWith(cards: GuildCard[]): GuildCardBook {
  const book = new GuildCardBook();
  for (const c of cards) book.add(c);
  return book;
}

// A client on a recording link; the book is shared with the menu (as the session does after the sync).
interface Sent {
  command: number;
  payload: Uint8Array;
}
function menuFor(book: GuildCardBook | null, loggedIn = true): { menu: GuildCardMenu; sent: Sent[] } {
  const sent: Sent[] = [];
  const link = {
    send: (command: number, _flag: number, payload: Uint8Array = new Uint8Array()) => {
      sent.push({ command, payload });
    },
    waitFor: async () => {
      throw new Error('no reply in this test');
    },
    poll: () => null,
  };
  const client = new GuildCardClient(link);
  client.book = book;
  const menu = new GuildCardMenu(text, { book: () => book, client: () => client, loggedIn });
  return { menu, sent };
}
const le32 = (b: Uint8Array, at = 0): number => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
// From the menu: opens the card list (row 0x66) and moves the list cursor to `slot` (a fresh menu).
function openCardList(menu: GuildCardMenu, slot: number): void {
  menu.key(key('ArrowDown'));
  menu.key(key('Enter'));
  for (let i = 0; i < slot; i++) menu.key(key('ArrowDown'));
}
// From a fresh menu: chooses the card at `slot`, which opens the card action menu.
function openActionFor(menu: GuildCardMenu, slot: number): void {
  openCardList(menu, slot);
  menu.key(key('Enter'));
}
// From the card action menu (cursor on its top row): chooses the row with `value`.
function chooseAction(menu: GuildCardMenu, value: number): ReturnType<GuildCardMenu['key']> {
  const at = actionRows(text, true).findIndex((r) => r.value === value);
  for (let i = 0; i < at; i++) menu.key(key('ArrowDown'));
  return menu.key(key('Enter'));
}

// 1. The menu rows: exe order, values are the states, the search row follows logged_in.
{
  const rows = menuRows(text, true);
  check('menu rows are 0x65, 0x66, 0x67, 0x117', rows.map((r) => r.label).join(',') === 't65,t66,t67,t117', rows.map((r) => r.label).join(','));
  check('menu row values are the exe states 3 / 0xb / 0x1d / 0x39', rows.map((r) => r.value).join(',') === '3,11,29,57');
  check('search row is enabled when logged in', rows[3]!.enabled);
  check('search row is greyed when not logged in', !menuRows(text, false)[3]!.enabled);
  check('menu window at get_gui_position(0x82) = (13, 256)', GUILD_CARD_POS.menu.x === 13 && GUILD_CARD_POS.menu.y === 256);
  check('card list at get_gui_position(0x88) = (194, 256)', GUILD_CARD_POS.list.x === 194 && GUILD_CARD_POS.list.y === 256);
  check('state constants match the state handler', GUILD_MENU_STATE.cardList === 0x0b && GUILD_MENU_STATE.textList === 0x1d && T11_GUILD.empty === 0xf3);
}

// 2. Card rows: an empty book gives the greyed empty row; present cards in slot order; newlines become spaces.
{
  const empty = cardRows(new GuildCardBook(), 'EMPTY');
  check('empty book: one greyed row with the empty text', empty.length === 1 && !empty[0]!.enabled && empty[0]!.label === 'EMPTY' && empty[0]!.value === -1);
  check('no book (not synced yet): the empty row', cardRows(null, 'EMPTY')[0]!.label === 'EMPTY');

  const book = bookWith([card(7, 'Ann'), card(9, 'Bo\nb'), card(11, 'Cy')]);
  const rows = cardRows(book, 'EMPTY');
  check('rows are the present cards in slot order', rows.map((r) => r.label).join('|') === 'Ann|Bo b|Cy', rows.map((r) => r.label).join('|'));
  check('row values are the slot indices', rows.map((r) => r.value).join(',') === '0,1,2');
  check('card rows are enabled', rows.every((r) => r.enabled));

  // The loop stops at the first empty slot (PopulateItems): a gap hides the rest.
  const gap = bookWith([card(1, 'A'), card(2, 'B')]);
  gap.raw.fill(0, GC_FILE.entriesOffset, GC_FILE.entriesOffset + GC_FILE.entrySize); // slot 0 empty
  const stop = cardRows(new GuildCardBook(gap.raw), 'EMPTY');
  check('the list stops at the first empty slot', stop.length === 1 && stop[0]!.label === 'EMPTY', stop.map((r) => r.label).join('|'));
}

// 3. Key flow: menu -> sub-list row is not ported (menu stays), card list opens; a card opens the action menu; Backspace unwinds.
{
  const book = bookWith([card(7, 'Ann'), card(9, 'Bo')]);
  const { menu } = menuFor(book);
  check('starts open on the menu', menu.open && menu.phase === 'menu');

  const sub = menu.key(key('Enter'));
  check('row 0x65 (sub-list) is reported as not ported', sub?.state === 3 && sub.card === -1, JSON.stringify(sub));
  check('reporting an unported row keeps the menu open', menu.phase === 'menu');

  menu.key(key('ArrowDown'));
  const opened = menu.key(key('Enter'));
  check('row 0x66 opens the card list without an action', opened === null && menu.phase === 'list');

  menu.key(key('ArrowDown'));
  const picked = menu.key(key('Enter'));
  check('a card opens the card action menu (state 0xd), nothing reported', picked === null && menu.phase === 'action', JSON.stringify(picked));

  menu.key(key('Backspace'));
  check('Backspace in the action menu returns to the card list', menu.phase === 'list');
  menu.key(key('Backspace'));
  check('Backspace in the card list returns to the menu', menu.phase === 'menu' && menu.open);
  menu.key(key('Backspace'));
  check('Backspace in the menu closes the leaf', !menu.open && menu.phase === 'closed');
}

// 4. The greyed search row buzzes: no action and no phase change.
{
  const { menu } = menuFor(null, false);
  menu.key(key('ArrowUp')); // wraps to the last row (0x117)
  const r = menu.key(key('Enter'));
  check('greyed row 0x117 gives no action when logged out', r === null && menu.phase === 'menu');
}

// 5. Card action menu rows: the exe's order and values; search is greyed when logged out.
{
  const rows = actionRows(text, true);
  check('action rows are 0x6c, 0x120, 0x121, 0x76, 0x6d', rows.map((r) => r.label).join(',') === 't6c,t120,t121,t76,t6d', rows.map((r) => r.label).join(','));
  check('action row values are 0x0f / 0x11 / 0x13 / 0x1b / 0x15', rows.map((r) => r.value).join(',') === '15,17,19,27,21');
  check('action search row is greyed when logged out', !actionRows(text, false)[0]!.enabled && actionRows(text, false)[4]!.enabled);
  check('constants match the exe rows', T11_GUILD.actionSearch === 0x6c && T11_GUILD.actionDelete === 0x6d && GUILD_ACTION.delete === 0x15);
  check('action window at (419, 256), the delete question at (419, 314)', GUILD_CARD_POS.action.x === 419 && GUILD_CARD_POS.action.y === 256 && GUILD_CARD_POS.question.y === 314);
}

// 6. Comment: the editor opens with the card's comment; Enter sends 09E8 with the card number and the text; the menu comes back.
{
  const book = bookWith([card(7, 'Ann'), card(9, 'Bo')]);
  book.setComment(9, 'old');
  const { menu, sent } = menuFor(book);
  openActionFor(menu, 1);
  const r = chooseAction(menu, GUILD_ACTION.comment);
  check('comment opens the editor (phase comment), nothing reported', r === null && menu.phase === 'comment', menu.phase);
  for (let i = 0; i < 3; i++) menu.key(key('Backspace'));
  for (const c of 'hi') menu.key({ key: c });
  menu.key(key('Enter'));
  check('Enter returns to the menu', menu.phase === 'menu');
  const c = sent.find((p) => p.command === GC_CMD.comment);
  check('09E8 sent with the card number and the new comment', !!c && le32(c.payload) === 9 && c.payload.length === 4 + GC_FILE.commentUnits * 2);
  check('the book keeps the new comment', book.view().entries[1]!.comment === 'hi', book.view().entries[1]!.comment);
}

// 7. Comment: Escape cancels and sends nothing; the comment is at most 0x57 characters.
{
  const book = bookWith([card(7, 'Ann')]);
  const cancelled = menuFor(book);
  openActionFor(cancelled.menu, 0);
  chooseAction(cancelled.menu, GUILD_ACTION.comment);
  cancelled.menu.key({ key: 'x' });
  cancelled.menu.key(key('Escape'));
  check('Escape cancels the comment and returns to the menu', cancelled.menu.phase === 'menu' && cancelled.sent.length === 0);

  const long = menuFor(book);
  openActionFor(long.menu, 0);
  chooseAction(long.menu, GUILD_ACTION.comment);
  for (let i = 0; i < 200; i++) long.menu.key({ key: 'z' });
  long.menu.key(key('Enter'));
  const c = long.sent.find((p) => p.command === GC_CMD.comment);
  check('the comment stops at 0x57 characters', !!c && book.view().entries[0]!.comment.length === 0x57, String(book.view().entries[0]!.comment.length));
}

// 8. Delete: the question's cursor is on No; No goes back to the action menu; Yes sends 05E8 and removes the card.
{
  const book = bookWith([card(7, 'Ann'), card(9, 'Bo'), card(11, 'Cy')]);
  const no = menuFor(book);
  openActionFor(no.menu, 1);
  chooseAction(no.menu, GUILD_ACTION.delete);
  check('delete opens the question (phase delete)', no.menu.phase === 'delete');
  no.menu.key(key('Enter'));
  check('No (the default cursor) goes back to the action menu', no.menu.phase === 'action' && no.sent.length === 0);

  const yes = menuFor(book);
  openActionFor(yes.menu, 1);
  chooseAction(yes.menu, GUILD_ACTION.delete);
  yes.menu.key(key('ArrowUp'));
  yes.menu.key(key('Enter'));
  const d = yes.sent.find((p) => p.command === GC_CMD.delete);
  check('Yes sends 05E8 with the card number', !!d && le32(d.payload) === 9, String(d && le32(d.payload)));
  check('Yes removes the card from the book and returns to the menu', yes.menu.phase === 'menu' && book.cards().map((x) => x.guildCardNumber).join(',') === '7,11');
}

// 9. Swap: the highlighted card is marked, the next card is the target; the swap sends 0AE8 with the two numbers.
{
  const book = bookWith([card(7, 'Ann'), card(9, 'Bo'), card(11, 'Cy')]);
  const { menu, sent } = menuFor(book);
  openActionFor(menu, 0);
  chooseAction(menu, GUILD_ACTION.swap);
  check('swap waits for the target (phase swapTarget)', menu.phase === 'swapTarget');
  menu.key(key('ArrowDown'));
  menu.key(key('ArrowDown'));
  menu.key(key('Enter'));
  const s = sent.find((p) => p.command === GC_CMD.swap);
  check('0AE8 sent with the two card numbers', !!s && le32(s.payload, 0) === 7 && le32(s.payload, 4) === 11, s ? `${le32(s.payload, 0)},${le32(s.payload, 4)}` : 'none');
  check('the book is swapped (7 moves to the target slot)', book.cards().map((x) => x.guildCardNumber).join(',') === '11,9,7', book.cards().map((x) => x.guildCardNumber).join(','));
  check('after a swap the leaf waits for the next mark (phase swapMark)', menu.phase === 'swapMark');
  menu.key(key('Escape'));
  check('Escape in the mark list returns to the menu', menu.phase === 'menu' && menu.open);
}

// 10. Paging: 9 cards are 2 pages of 7; the page keys wrap; the rows are the page's slots.
{
  const cards = Array.from({ length: 9 }, (_, i) => card(100 + i, `C${i}`));
  const book = bookWith(cards);
  check('9 cards are 2 pages; no book is 1 page', cardPageCount(book) === 2 && cardPageCount(null) === 1 && cardPageCount(new GuildCardBook()) === 1);
  check('page 1 shows slots 7 and 8', cardRows(book, 'EMPTY', 1).map((r) => r.value).join(',') === '7,8');

  const { menu } = menuFor(book);
  openCardList(menu, 0);
  menu.key(key('ArrowRight'));
  check('ArrowRight shows the second page (the list stays open)', menu.phase === 'list');
  menu.key(key('Enter'));
  const onPage1 = chooseAction(menu, GUILD_ACTION.search);
  check('the first row of page 1 is slot 7 (the search row reports it)', onPage1?.state === 0x0f && onPage1.card === 7, JSON.stringify(onPage1));

  const wrapped = menuFor(book);
  openCardList(wrapped.menu, 0);
  wrapped.menu.key(key('ArrowLeft'));
  wrapped.menu.key(key('Enter'));
  const last = chooseAction(wrapped.menu, GUILD_ACTION.search);
  check('ArrowLeft from page 0 wraps to the last page (slot 7)', last?.card === 7, JSON.stringify(last));

  const back = menuFor(book);
  openCardList(back.menu, 0);
  back.menu.key(key('ArrowRight'));
  back.menu.key(key('ArrowRight'));
  back.menu.key(key('Enter'));
  const first = chooseAction(back.menu, GUILD_ACTION.search);
  check('ArrowRight from the last page wraps to page 0 (slot 0)', first?.card === 0, JSON.stringify(first));
}

// 11. Description box: the menu's cursor row picks the text (90 / 91 / 92 / 280), drawn beside the menu.
{
  const { menu } = menuFor(bookWith([card(7, 'Ann')]));
  let threw = false;
  try {
    menu.draw(ctx, skin);
    menu.key(key('ArrowDown'));
    menu.draw(ctx, skin);
    menu.key(key('ArrowDown'));
    menu.key(key('ArrowDown'));
    menu.draw(ctx, skin);
  } catch (err) {
    threw = true;
    console.log(err);
  }
  check('the description box draws for the menu rows', !threw);
  check('the description box sits at get_gui_position(0x83) = (435, 256)', GUILD_CARD_POS.description.x === 435 && GUILD_CARD_POS.description.y === 256);
}

// 12. The action not ported: search (0x0f) is reported and the leaf goes back to the card list.
{
  const { menu } = menuFor(bookWith([card(7, 'Ann')]));
  openActionFor(menu, 0);
  const r = chooseAction(menu, GUILD_ACTION.search);
  check('search is reported as state 0x0f with its slot', r?.state === 0x0f && r.card === 0, JSON.stringify(r));
  check('search returns to the card list', menu.phase === 'list');
}

// 13. Drawing: the card phases (list, view, action, delete, comment, swap) with a stub canvas.
{
  const book = bookWith([card(7, 'Ann')]);
  let threw = false;
  try {
    const list = menuFor(book).menu;
    list.draw(ctx, skin);
    openCardList(list, 0);
    list.draw(ctx, skin);

    const view = menuFor(book).menu;
    openActionFor(view, 0);
    chooseAction(view, GUILD_ACTION.view);
    view.draw(ctx, skin);
    view.key(key('Enter'));
    check('view returns to the card list on Enter', view.phase === 'list');

    const del = menuFor(book).menu;
    openActionFor(del, 0);
    chooseAction(del, GUILD_ACTION.delete);
    del.draw(ctx, skin);
    del.key(key('Escape'));
    check('Escape in the delete question goes back to the action menu', del.phase === 'action');

    const com = menuFor(book).menu;
    openActionFor(com, 0);
    chooseAction(com, GUILD_ACTION.comment);
    com.draw(ctx, skin);

    const swap = menuFor(book).menu;
    openActionFor(swap, 0);
    chooseAction(swap, GUILD_ACTION.swap);
    swap.draw(ctx, skin);
  } catch (err) {
    threw = true;
    console.log(err);
  }
  check('draws the list, view, action, delete, comment and swap phases without error', !threw);
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
