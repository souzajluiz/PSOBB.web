// The Home menu's Trade Window (classic/trade.ts TradeMenu) over a real TradeSession and
// the tradeio.ts IO: the partner pick and the proposal (6xA6 what 0 to the partner, 0x62),
// the accept prompt for a partner's proposal, the item list and the meseta amount (what 2
// with the offer), the confirm and cancel dialogs (the held confirm flag), a partner's
// decline as a notice, the layout values of the exe's GUI table, and a drawing smoke test.
// Run: node tests/trademenu.test.ts
import { T11_TRADE, TradeMenu, TRADE_POS, type TradeEnv, type TradePhase } from '../client/src/classic/trade.ts';
import { MESETA_ITEM_ID } from '../client/src/net/items.ts';
import type { CharacterFile } from '../client/src/net/charfile.ts';
import type { Packet } from '../client/src/net/guildcard.ts';
import { tradeIO, type TradeHost } from '../client/src/net/tradeio.ts';
import { TradeSession, TRADE_FLAG, TRADE_MESETA_ID, TRADE_RESULT, TRADE_STATUS, TRADE_WHAT, tradeSubcommand } from '../client/src/net/trade.ts';

// A stub canvas and skin: every call does nothing (the same trick as guildcardmenu.test.ts).
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
const skin = deep as Parameters<TradeMenu['draw']>[1];

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
}

const SWORD = 0x00010203;
const PARTNER = 2;
const SELF = 1;

// A character with one sword (its data1[5] is the stack byte) and 500 meseta.
function character(): CharacterFile {
  const data1 = new Uint8Array(12);
  data1[5] = 3;
  return {
    meseta: 500,
    inventory: [{ index: 0, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: { data1, id: SWORD, data2: new Uint8Array(4) } }],
  } as unknown as CharacterFile;
}

// The menu's text: group 11 index i is "t11.i" (the real strings are the game's).
const text = (g: number, i: number) => `t${g}.${i}`;

function key(k: string): { key: string } {
  return { key: k };
}

interface Rig {
  session: TradeSession;
  menu: TradeMenu;
  out: Packet[];
  char: CharacterFile;
  env: TradeEnv;
}

// One player's trade: a session on tradeio.ts's IO, the menu over it. The partner is in the game.
function rig(open: 'list' | 'requested' = 'list'): Rig {
  const out: Packet[] = [];
  const char = character();
  let menu: TradeMenu | null = null;
  const host: TradeHost = {
    character: () => char,
    notify: (textId) => menu?.notify(textId),
  };
  const session = new TradeSession(
    SELF,
    tradeIO({
      send: (p) => out.push(p),
      host: () => host,
      isPresent: () => true,
    }),
  );
  const env: TradeEnv = {
    session,
    text,
    partners: () => [{ id: PARTNER, name: 'Bob' }],
    rows: () => [
      { id: SWORD, icon1: 0, icon2: 0, name: 'Sword', count: '×3', nameColor: '#fff', iconColor: '#fff' },
      { id: MESETA_ITEM_ID, icon1: 0, icon2: 0, name: 'Meseta', count: '500', nameColor: '#fff', iconColor: '#fff' },
    ],
    count: (id) => char.inventory.find((i) => i.data.id === id)?.data.data1[5] ?? 0,
    itemName: (id) => (id === SWORD ? 'Sword' : id === TRADE_MESETA_ID ? 'Meseta' : `item ${id.toString(16)}`),
    meseta: () => char.meseta,
  };
  if (open === 'requested') session.receive(tradeSubcommand(PARTNER, TRADE_WHAT.propose, TRADE_RESULT.ok, { amount: 0 }));
  menu = new TradeMenu(env);
  return { session, menu, out, char, env };
}

const phase = (m: TradeMenu): TradePhase => m.phase;
const sentWhat = (out: Packet[], what: number) => out.some((p) => p.command === 0x62 && p.payload[4] === what);

// ---- Layout: the exe's GUI table (0x00971f40 + 8 * index) -------------------

check('partner list at get_gui_position(0x5d) = (13, 256)', TRADE_POS.partner.x === 13 && TRADE_POS.partner.y === 256);
check('confirm list at get_gui_position(0x5e) = (239, 256)', TRADE_POS.ask.x === 239 && TRADE_POS.ask.y === 256);
check('trade window at get_gui_position(0x60) = (341, 318)', TRADE_POS.window.x === 341 && TRADE_POS.window.y === 318);
check('dialog at get_gui_position(0x62) = (341, 256)', TRADE_POS.dialog.x === 341 && TRADE_POS.dialog.y === 256);
check(
  'group 11 texts: 0x32 partner title, 0x3b window title, 0x33 dialog title, 0x105 confirm, 0x116 cancel, 0xf6 propose',
  T11_TRADE.partnerTitle === 0x32 && T11_TRADE.windowTitle === 0x3b && T11_TRADE.dialogTitle === 0x33 && T11_TRADE.confirm === 0x105 && T11_TRADE.cancel === 0x116 && T11_TRADE.propose === 0xf6,
);

// ---- Partner pick and proposal ---------------------------------------------

{
  const r = rig();
  check('the leaf opens on the partner list', phase(r.menu) === 'partner');
  r.menu.key(key('Enter'));
  check('Enter on a partner asks for the trade', phase(r.menu) === 'ask');
  check('asking sends nothing', r.out.length === 0);
  r.menu.key(key('Enter'));
  check('Enter on the ask sends the proposal (6xA6 what 0 to the partner, 0x62)', phase(r.menu) === 'waiting' && r.out.length === 1 && r.out[0]!.command === 0x62 && r.out[0]!.flag === PARTNER && r.out[0]!.payload[4] === TRADE_WHAT.propose);
  check('the session is proposed', r.session.status === TRADE_STATUS.proposed);
  r.session.receive(tradeSubcommand(PARTNER, TRADE_WHAT.propose, TRADE_RESULT.reject));
  check('a decline is a notice and returns to the partner list', r.session.status === TRADE_STATUS.none);
  r.menu.tick();
  check('the decline shows the notice (0xf7) and the partner list again', phase(r.menu) === 'partner' && r.menu.notice === text(11, 0xf7), `${phase(r.menu)} ${r.menu.notice}`);
}

{
  const r = rig();
  r.menu.key(key('Enter'));
  r.menu.key(key('Enter'));
  r.menu.key(key('Backspace'));
  check('Backspace while waiting cancels the proposal (what 5 to the partner)', phase(r.menu) === 'partner' && sentWhat(r.out, TRADE_WHAT.cancelProposal) && r.session.status === TRADE_STATUS.none);
}

{
  const r = rig();
  r.menu.key(key('Escape'));
  check('Escape on the partner list closes the leaf', r.menu.open === false && phase(r.menu) === 'closed');
}

// ---- The partner accepts: the window opens, items and meseta ----------------

{
  const r = rig();
  r.menu.key(key('Enter'));
  r.menu.key(key('Enter'));
  r.session.receive(tradeSubcommand(PARTNER, TRADE_WHAT.propose, TRADE_RESULT.accept, { amount: 0 }));
  r.menu.tick();
  check('the partner accepts: the trade window opens', phase(r.menu) === 'window' && r.session.status === TRADE_STATUS.open);

  r.menu.key(key('Enter'));
  check('Enter in the window opens the item list', phase(r.menu) === 'items');
  r.menu.key(key('Enter'));
  check('Enter on the sword opens the amount spinner', phase(r.menu) === 'amount');
  r.menu.key(key('Enter'));
  const offer = r.out.find((p) => p.command === 0x62 && p.payload[4] === TRADE_WHAT.addItem);
  check('the amount sends what 2 (the item and quantity 1) and returns to the window', phase(r.menu) === 'window' && !!offer && offer.payload.length === 16, `${phase(r.menu)} ${r.out.length}`);
  check('the local offer holds the sword', r.session.local.some((o) => o.itemId === SWORD && o.amount === 1));

  r.menu.key(key('Enter'));
  r.menu.key(key('ArrowDown'));
  r.menu.key(key('Enter'));
  r.menu.key(key('Enter'));
  const meseta = r.out.find((p) => p.command === 0x62 && p.payload[4] === TRADE_WHAT.addItem && new DataView(p.payload.buffer, p.payload.byteOffset).getUint32(8, true) === TRADE_MESETA_ID);
  check('the meseta row offers the meseta pseudo item (id 0xffffff01)', !!meseta && phase(r.menu) === 'window');
}

{
  // The spinner keeps the count inside the stack: 3 swords, two presses up.
  const r = rig();
  r.menu.key(key('Enter'));
  r.menu.key(key('Enter'));
  r.session.receive(tradeSubcommand(PARTNER, TRADE_WHAT.propose, TRADE_RESULT.accept, { amount: 0 }));
  r.menu.tick();
  r.menu.key(key('Enter'));
  r.menu.key(key('Enter'));
  r.menu.key(key('ArrowUp'));
  r.menu.key(key('ArrowUp'));
  r.menu.key(key('Enter'));
  check('the amount is capped at the stack (3)', r.session.local.some((o) => o.itemId === SWORD && o.amount === 3), JSON.stringify(r.session.local.filter((o) => o.itemId !== -1)));
}

// ---- The confirm and cancel dialogs -----------------------------------------

{
  const r = rig();
  r.menu.key(key('Enter'));
  r.menu.key(key('Enter'));
  r.session.receive(tradeSubcommand(PARTNER, TRADE_WHAT.propose, TRADE_RESULT.accept, { amount: 0 }));
  r.menu.tick();
  r.menu.key(key(' '));
  check('Space opens the confirm dialog', phase(r.menu) === 'confirm');
  r.menu.key(key('Enter'));
  check('the cursor starts on No: Enter keeps the trade open', phase(r.menu) === 'window' && !(r.session.flags & TRADE_FLAG.confirm1Pressed));
  r.menu.key(key(' '));
  r.menu.key(key('ArrowUp'));
  r.menu.key(key('Enter'));
  check('Yes holds the first confirm (flag 0x10)', phase(r.menu) === 'window' && (r.session.flags & TRADE_FLAG.confirm1Pressed) !== 0);
  r.session.flags |= TRADE_FLAG.confirm1Sent;
  r.menu.tick();
  check('the held confirm is released once the session has sent it', (r.session.flags & TRADE_FLAG.confirm1Pressed) === 0);
  r.menu.key(key(' '));
  r.menu.key(key('ArrowUp'));
  r.menu.key(key('Enter'));
  check('the next Yes holds the second confirm (flag 0x80)', (r.session.flags & TRADE_FLAG.confirm2Pressed) !== 0);
}

{
  const r = rig();
  r.menu.key(key('Enter'));
  r.menu.key(key('Enter'));
  r.session.receive(tradeSubcommand(PARTNER, TRADE_WHAT.propose, TRADE_RESULT.accept, { amount: 0 }));
  r.menu.tick();
  r.menu.key(key('Backspace'));
  check('Backspace in the window opens the cancel question', phase(r.menu) === 'cancel');
  r.menu.key(key('ArrowUp'));
  const open = r.menu.key(key('Enter'));
  check('Yes on the cancel question ends the trade (what 5, result 4) and closes the leaf', open === false && r.menu.open === false && sentWhat(r.out, TRADE_WHAT.cancelProposal) && r.session.status === TRADE_STATUS.none);
}

// ---- The partner's proposal: the accept prompt -----------------------------

{
  const r = rig('requested');
  check('a proposal opens the accept prompt', phase(r.menu) === 'accept');
  r.menu.key(key('ArrowUp'));
  r.menu.key(key('Enter'));
  check('Yes accepts (what 0, result 2) and opens the window', phase(r.menu) === 'window' && r.out.some((p) => p.payload[4] === TRADE_WHAT.propose && p.payload[5] === TRADE_RESULT.accept) && r.session.status === TRADE_STATUS.open);
}

{
  const r = rig('requested');
  const open = r.menu.key(key('Enter'));
  check('No declines (what 0, result 3) and closes the prompt', open === false && r.out.some((p) => p.payload[4] === TRADE_WHAT.propose && p.payload[5] === TRADE_RESULT.reject) && r.session.status === TRADE_STATUS.none);
}

{
  const r = rig('requested');
  // The session drops the request (its reset): the prompt closes on the next tick.
  r.session.clear();
  r.menu.tick();
  check('a withdrawn proposal closes the prompt', phase(r.menu) === 'closed');
}

// ---- Drawing: every phase draws without error -------------------------------

{
  const r = rig();
  const phases: TradePhase[] = [];
  const draw = () => phases.push(phase(r.menu));
  r.menu.draw(ctx, skin);
  draw();
  r.menu.key(key('Enter'));
  r.menu.draw(ctx, skin);
  r.menu.key(key('Enter'));
  r.menu.draw(ctx, skin);
  r.session.receive(tradeSubcommand(PARTNER, TRADE_WHAT.propose, TRADE_RESULT.accept, { amount: 0 }));
  r.menu.tick();
  for (const k of ['Enter', 'Enter', 'Enter', 'Backspace', ' ', 'Escape']) {
    r.menu.key(key(k));
    r.menu.draw(ctx, skin);
    draw();
  }
  r.menu.notify(0x10b);
  r.menu.draw(ctx, skin);
  check('the menu draws in every phase it reaches (' + [...new Set(phases)].join(', ') + ')', phases.length > 0);
}

console.log(failures ? `${failures} FAILED` : 'all trademenu checks passed');
if (failures) process.exit(1);
