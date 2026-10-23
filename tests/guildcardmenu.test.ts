// The lobby Home menu's Guild Card leaf (classic/guildcardmenu.ts): the menu rows
// and their greyed row, the card list built from the book (PopulateItems rules),
// the key flow menu -> card list -> menu -> closed, the actions the port does not
// have, and a drawing smoke test. Run: node tests/guildcardmenu.test.ts
import { GuildCardMenu, GUILD_CARD_POS, GUILD_MENU_STATE, cardRows, menuRows, T11_GUILD } from '../client/src/classic/guildcardmenu.ts';
import { GuildCardBook, GC_FILE, type GuildCard } from '../client/src/net/guildcard.ts';

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

// 3. Key flow: menu -> sub-list row is not ported (menu stays), card list opens and closes, Backspace closes the leaf.
{
  const book = bookWith([card(7, 'Ann'), card(9, 'Bo')]);
  const menu = new GuildCardMenu(text, { book: () => book, loggedIn: true });
  check('starts open on the menu', menu.open && menu.phase === 'menu');

  const sub = menu.key(key('Enter'));
  check('row 0x65 (sub-list) is reported as not ported', sub?.state === 3 && sub.card === -1, JSON.stringify(sub));
  check('reporting an unported row keeps the menu open', menu.phase === 'menu');

  menu.key(key('ArrowDown'));
  const opened = menu.key(key('Enter'));
  check('row 0x66 opens the card list without an action', opened === null && menu.phase === 'list');

  menu.key(key('ArrowDown'));
  const picked = menu.key(key('Enter'));
  check('a card is reported with its slot (card action menu not ported)', picked?.state === 0x0c && picked.card === 1, JSON.stringify(picked));
  check('the card list stays open after a card is chosen', menu.phase === 'list');

  menu.key(key('Backspace'));
  check('Backspace in the card list returns to the menu', menu.phase === 'menu' && menu.open);
  menu.key(key('Backspace'));
  check('Backspace in the menu closes the leaf', !menu.open && menu.phase === 'closed');
}

// 4. The greyed search row buzzes: no action and no phase change.
{
  const menu = new GuildCardMenu(text, { book: () => null, loggedIn: false });
  menu.key(key('ArrowUp')); // wraps to the last row (0x117)
  const r = menu.key(key('Enter'));
  check('greyed row 0x117 gives no action when logged out', r === null && menu.phase === 'menu');
}

// 5. Drawing: the menu alone, and with the card list open, with a stub canvas.
{
  const menu = new GuildCardMenu(text, { book: () => bookWith([card(7, 'Ann')]), loggedIn: true });
  let threw = false;
  try {
    menu.draw(ctx, skin);
    menu.key(key('ArrowDown'));
    menu.key(key('Enter'));
    menu.draw(ctx, skin);
  } catch (err) {
    threw = true;
    console.log(err);
  }
  check('draws the menu and the card list without error', !threw);
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
