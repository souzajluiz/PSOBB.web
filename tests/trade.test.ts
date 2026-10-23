// The BB player trade: the 6xA6 subcommand layout, the D0 item list, the state
// machine's handler table (exe g_Packet0x60Subcommand0xA6Handlers_00a16660) and
// two players trading through a relay that does what newserv does for D0..D4
// (ReceiveCommands.cc on_D0_V3_BB / on_D2_V3_BB / on_D4_V3_BB) and 0x62 delivery.
// Run: node tests/trade.test.ts
import {
  TRADE_CMD,
  TRADE_CONFIRM_FRAMES,
  TRADE_FLAG,
  TRADE_ITEM_SIZE,
  TRADE_LIST_BODY,
  TRADE_MESETA_ID,
  TRADE_NO_PARTNER,
  TRADE_RESULT,
  TRADE_STATUS,
  TRADE_TEXT,
  TRADE_WHAT,
  TradeSession,
  parseTradeItemList,
  parseTradeSubcommand,
  tradeCompletePacket,
  tradeItemListPacket,
  tradeSubcommand,
  type TradeIO,
} from '../client/src/net/trade.ts';
import type { Packet } from '../client/src/net/guildcard.ts';
import { removeTradeOffer, tradeCompactItem, tradeIO } from '../client/src/net/tradeio.ts';
import { Lobby } from '../client/src/net/lobby.ts';
import type { CharacterFile } from '../client/src/net/charfile.ts';
import { MESETA_ITEM_ID } from '../client/src/net/items.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
}

// ---- Packet layouts --------------------------------------------------------

{
  const b = tradeSubcommand(3, TRADE_WHAT.propose, TRADE_RESULT.ok, { amount: 0x01020304 });
  check('6xA6 is 16 bytes, subcommand 0xA6, size 4', b.length === 0x10 && b[0] === 0xa6 && b[1] === 4, `${b.length} ${b[0]} ${b[1]}`);
  check('6xA6 sender id little-endian at +2', b[2] === 3 && b[3] === 0);
  check('6xA6 what at +4, result at +5', b[4] === 0 && b[5] === 0);
  check('6xA6 meseta little-endian at +12', b[12] === 0x04 && b[13] === 0x03 && b[14] === 0x02 && b[15] === 0x01);
}
{
  const b = tradeSubcommand(0, TRADE_WHAT.finish, TRADE_RESULT.ok, { completion: 0x0102 });
  check('completion client id is big-endian at +6', b[6] === 0x01 && b[7] === 0x02, `${b[6]} ${b[7]}`);
}
{
  const b = tradeSubcommand(1, TRADE_WHAT.addQuantity, TRADE_RESULT.ok, { itemId: 0xdeadbeef, amount: -2 });
  const p = parseTradeSubcommand(b);
  check('6xA6 parse round trip (item at +8)', p.sender === 1 && p.what === 1 && p.itemId === 0xdeadbeef, JSON.stringify(p));
  check('6xA6 amount -2 reads back as 0xfffffffe', (p.amount | 0) === -2 && p.amount === 0xfffffffe, String(p.amount));
}
{
  let threw = false;
  try {
    parseTradeSubcommand(new Uint8Array(16));
  } catch {
    threw = true;
  }
  check('6xA6 parse rejects a non-6xA6 buffer', threw);
}
{
  const a = new Uint8Array(TRADE_ITEM_SIZE).fill(0x11);
  const b = new Uint8Array(TRADE_ITEM_SIZE).fill(0x22);
  const p = tradeItemListPacket(2, [a, b]);
  check('D0 is command 0xD0, flag 0, body 0x284', p.command === TRADE_CMD.items && p.flag === 0 && p.payload.length === TRADE_LIST_BODY && TRADE_LIST_BODY === 0x284);
  const dv = new DataView(p.payload.buffer);
  check('D0 target at +0, count at +2 (le)', dv.getUint16(0, true) === 2 && dv.getUint16(2, true) === 2);
  check('D0 items start at +4, 20 bytes each', p.payload[4] === 0x11 && p.payload[4 + 20] === 0x22);
  const back = parseTradeItemList(p.payload);
  check('D0 parse round trip', back.target === 2 && back.items.length === 2 && back.items[1][0] === 0x22);
}
{
  let threw = false;
  try {
    tradeItemListPacket(0, Array.from({ length: 33 }, () => new Uint8Array(TRADE_ITEM_SIZE)));
  } catch {
    threw = true;
  }
  check('D0 refuses more than 32 items', threw);
}
{
  check('D2 / D4 flags: complete 1 and 0', tradeCompletePacket(true).flag === 1 && tradeCompletePacket(false).flag === 0 && tradeCompletePacket(true).command === 0xd4);
}

// ---- Handler table (one status row each) ------------------------------------

function fakeIO(): TradeIO & { out: Packet[]; msgs: Array<[number, number]>; removed: Array<[number, number]> } {
  const out: Packet[] = [];
  const msgs: Array<[number, number]> = [];
  const removed: Array<[number, number]> = [];
  return {
    out,
    msgs,
    removed,
    send: (p) => out.push(p),
    message: (id, partner) => msgs.push([id, partner]),
    compactItem: (itemId) => {
      const b = new Uint8Array(TRADE_ITEM_SIZE);
      new DataView(b.buffer).setUint32(12, itemId, true);
      return b;
    },
    removeOffer: (itemId, amount) => removed.push([itemId, amount]),
    inTradeZone: () => true,
    playerPresent: () => true,
  };
}

{
  // status 0: a proposal is taken and the status becomes 2 (exe HandleTradeGuildCardPacket)
  const io = fakeIO();
  const s = new TradeSession(0, io);
  s.receive(tradeSubcommand(1, TRADE_WHAT.propose, TRADE_RESULT.ok, { amount: 77 }));
  check('proposal from a player: status requested, partner 1, meseta 77', s.status === TRADE_STATUS.requested && s.partner === 1 && s.partnerMeseta === 77);
}
{
  // status 1: the accept gives status 3 (exe HandleTradeGuildCardState result 2)
  const io = fakeIO();
  const s = new TradeSession(0, io);
  s.propose(1, 5);
  check('propose sends what 0 result 0 with meseta 5 to 1 over 0x62', io.out.length === 1 && io.out[0].command === 0x62 && io.out[0].flag === 1);
  const sent = parseTradeSubcommand(io.out[0].payload);
  check('the proposal is what 0 result 0, meseta at +12', sent.what === 0 && sent.result === 0 && sent.amount === 5 && s.status === TRADE_STATUS.proposed);
  s.receive(tradeSubcommand(1, TRADE_WHAT.propose, TRADE_RESULT.accept, { amount: 9 }));
  check('accept (result 2) gives status open with the partner meseta', s.status === TRADE_STATUS.open && s.partnerMeseta === 9);
}
{
  // a decline (result 3) resets with the declined text (0xf7)
  const io = fakeIO();
  const s = new TradeSession(0, io);
  s.propose(2, 0);
  s.receive(tradeSubcommand(2, TRADE_WHAT.propose, TRADE_RESULT.reject));
  check('decline resets to none with text 0xf7', s.status === TRADE_STATUS.none && s.partner === TRADE_NO_PARTNER && io.msgs.length === 1 && io.msgs[0][0] === TRADE_TEXT.declined);
}
{
  // another player's proposal while a trade is open gets the busy reply (what 6)
  const io = fakeIO();
  const s = new TradeSession(0, io);
  s.receive(tradeSubcommand(1, TRADE_WHAT.propose, TRADE_RESULT.ok, { amount: 1 }));
  io.out.length = 0;
  s.receive(tradeSubcommand(2, TRADE_WHAT.propose, TRADE_RESULT.ok, { amount: 1 }));
  const busy = io.out.length === 1 && io.out[0].flag === 2 && parseTradeSubcommand(io.out[0].payload).what === TRADE_WHAT.busy;
  check('a third player gets the busy reply (what 6) and the trade stays', busy && s.partner === 1);
}
{
  // the 30-frame confirm (exe TransitionTradeState_00825bf0): sent on the 31st tick
  const io = fakeIO();
  const s = new TradeSession(0, io);
  s.status = TRADE_STATUS.open;
  s.partner = 1;
  s.setConfirm1(true);
  for (let i = 0; i < TRADE_CONFIRM_FRAMES; i++) s.tick();
  check('first confirm not sent during the first 30 frames', io.out.length === 0 && s.status === TRADE_STATUS.open);
  s.tick();
  const c = io.out.length === 1 ? parseTradeSubcommand(io.out[0].payload) : null;
  check('first confirm (what 3 result 0) on frame 31', c !== null && c.what === TRADE_WHAT.firstConfirm && c.result === TRADE_RESULT.ok && s.status === TRADE_STATUS.confirm1);
}

// ---- Two players through a relay (newserv's D0..D4 rules) -------------------

interface Peer {
  id: number;
  session: TradeSession;
  io: ReturnType<typeof fakeIO>;
}

class Relay {
  peers = new Map<number, Peer>();
  private queue: Array<{ to: number; p: Packet }> = [];
  private pending = new Map<number, { target: number; items: Uint8Array[]; confirmed: boolean }>();
  // Presence and trade-zone state per player (the fake world the io reads).
  present = new Set<number>();

  add(id: number): Peer {
    const io = fakeIO();
    const peer: Peer = { id, session: new TradeSession(id, io), io };
    // The fake io records the sends and forwards them to the relay.
    const send = io.send;
    io.send = (p) => {
      send(p);
      this.fromClient(id, p);
    };
    io.playerPresent = (other) => this.present.has(other);
    this.present.add(id);
    this.peers.set(id, peer);
    return peer;
  }

  private fromClient(from: number, p: Packet): void {
    if (p.command === 0x62) {
      this.queue.push({ to: p.flag, p: { command: 0x62, flag: from, payload: p.payload } });
    } else if (p.command === TRADE_CMD.items) {
      const { target } = parseTradeItemList(p.payload);
      if (this.pending.has(from)) throw new Error('player started a trade when one is already pending');
      const items = parseTradeItemList(p.payload).items;
      this.pending.set(from, { target, items, confirmed: false });
      this.queue.push({ to: target, p: { command: TRADE_CMD.advance, flag: 0, payload: new Uint8Array(0) } });
      if (this.pending.has(target)) this.queue.push({ to: from, p: { command: TRADE_CMD.advance, flag: 0, payload: new Uint8Array(0) } });
    } else if (p.command === TRADE_CMD.proceed) {
      const st = this.pending.get(from);
      if (!st) throw new Error('D2 with none pending');
      st.confirmed = true;
      const other = this.pending.get(st.target);
      if (other && other.confirmed) {
        for (const id of [from, st.target]) {
          this.queue.push({ to: id, p: { command: TRADE_CMD.execute, flag: 0, payload: new Uint8Array(0) } });
          this.queue.push({ to: id, p: tradeCompletePacket(true) });
        }
        this.pending.delete(from);
        this.pending.delete(st.target);
      }
    } else if (p.command === TRADE_CMD.complete) {
      const st = this.pending.get(from);
      this.queue.push({ to: from, p: tradeCompletePacket(false) });
      if (st) {
        this.pending.delete(from);
        const other = this.pending.get(st.target);
        if (other) {
          this.pending.delete(st.target);
          this.queue.push({ to: st.target, p: tradeCompletePacket(false) });
        }
      }
    }
  }

  // Delivers queued packets until none is left (the network is asynchronous).
  pump(): void {
    while (this.queue.length) {
      const { to, p } = this.queue.shift()!;
      const peer = this.peers.get(to);
      if (!peer) continue;
      if (p.command === 0x62) peer.session.receive(p.payload);
      else if (p.command === TRADE_CMD.advance) peer.session.onAdvance();
      else if (p.command === TRADE_CMD.execute) peer.session.onExecute();
      else if (p.command === TRADE_CMD.complete) peer.session.onComplete(p.flag === 1);
    }
  }
}

function tickAll(relay: Relay, ids: number[], frames: number): void {
  for (let i = 0; i < frames; i++) {
    for (const id of ids) relay.peers.get(id)!.session.tick();
    relay.pump();
  }
}

{
  const relay = new Relay();
  const a = relay.add(0);
  const b = relay.add(1);

  // Propose, accept, open.
  a.session.propose(1, 100);
  relay.pump();
  check('B sees the proposal (requested, meseta 100 from A)', b.session.status === TRADE_STATUS.requested && b.session.partnerMeseta === 100);
  b.session.accept(50);
  relay.pump();
  check('both windows open after the accept', a.session.status === TRADE_STATUS.open && b.session.status === TRADE_STATUS.open);
  check('A sees B meseta 50 after the accept', a.session.partnerMeseta === 50);
  a.session.openWindow();
  b.session.openWindow();

  // Offers: A adds an item (what 2), B adds a quantity (what 1); each side's partner list follows.
  a.session.offerItem(0x00aaaa, 2);
  b.session.offerQuantity(0x00bbbb, 1);
  relay.pump();
  check('B lists A offer (0xaaaa x2)', b.session.remote.some((o) => o.itemId === 0xaaaa && o.amount === 2));
  check('A lists B offer (0xbbbb x1)', a.session.remote.some((o) => o.itemId === 0xbbbb && o.amount === 1));

  // Confirms: each side holds the first confirm, then the second.
  a.session.setConfirm1(true);
  b.session.setConfirm1(true);
  tickAll(relay, [0, 1], TRADE_CONFIRM_FRAMES + 1);
  check('both first confirms sent (status 4)', a.session.status === TRADE_STATUS.confirm1 && b.session.status === TRADE_STATUS.confirm1);
  a.session.setConfirm2(true);
  b.session.setConfirm2(true);
  tickAll(relay, [0, 1], TRADE_CONFIRM_FRAMES + 1);
  check('both second confirms sent (status 5)', a.session.status === TRADE_STATUS.confirm2 && b.session.status === TRADE_STATUS.confirm2);

  // The list goes out (D0 from both), the server answers, both execute and complete.
  tickAll(relay, [0, 1], 3);
  check('both sides complete with text 0x10a and reset', a.session.status === TRADE_STATUS.none && b.session.status === TRADE_STATUS.none);
  check('A got the success text', a.io.msgs.some(([id]) => id === TRADE_TEXT.success) && b.io.msgs.some(([id]) => id === TRADE_TEXT.success));
  check('each side removed its own offer (A 0xaaaa x2, B 0xbbbb x1)', a.io.removed.length === 1 && a.io.removed[0][0] === 0xaaaa && a.io.removed[0][1] === 2 && b.io.removed.length === 1 && b.io.removed[0][0] === 0xbbbb && b.io.removed[0][1] === 1, JSON.stringify([a.io.removed, b.io.removed]));
  const d2 = (io: ReturnType<typeof fakeIO>) => io.out.filter((p) => p.command === TRADE_CMD.proceed).length;
  check('each side sent one D2', d2(a.io) === 1 && d2(b.io) === 1, `${d2(a.io)} ${d2(b.io)}`);
  const d0 = a.io.out.find((p) => p.command === TRADE_CMD.items);
  check('A D0 carries its one offer item at +4', d0 !== undefined && new DataView(d0.payload.buffer).getUint32(4 + 12, true) === 0xaaaa && parseTradeItemList(d0.payload).items.length === 1);
}

{
  // A cancels with the second confirm not yet made: B gets what 5 result 4, text 0x10c and resets.
  const relay = new Relay();
  const a = relay.add(0);
  const b = relay.add(1);
  a.session.propose(1, 0);
  relay.pump();
  b.session.accept(0);
  relay.pump();
  a.session.openWindow();
  b.session.openWindow();
  a.session.cancel();
  relay.pump();
  check('the cancel resets both sides, B gets text 0x10c', a.session.status === TRADE_STATUS.none && b.session.status === TRADE_STATUS.none && b.io.msgs.some(([id]) => id === TRADE_TEXT.cancelled));
}

{
  // The partner leaves the room: the proposal is cancelled (what 5 result 4) and the window resets.
  const relay = new Relay();
  const a = relay.add(0);
  const b = relay.add(1);
  a.session.propose(1, 0);
  relay.pump();
  b.session.accept(0);
  relay.pump();
  relay.present.delete(1);
  a.session.tick();
  relay.pump();
  check('partner gone: A resets to none', a.session.status === TRADE_STATUS.none && a.session.partner === TRADE_NO_PARTNER);
}

{
  // The trade zone: a player who leaves the zone gets the accept-path finish (what 7 result 0).
  const relay = new Relay();
  const a = relay.add(0);
  const b = relay.add(1);
  a.session.propose(1, 0);
  relay.pump();
  b.session.accept(0);
  relay.pump();
  let finished = false;
  const send = b.io.send;
  b.io.send = (p) => {
    if (p.command === 0x62 && parseTradeSubcommand(p.payload).what === TRADE_WHAT.finish) finished = true;
    send(p);
  };
  b.io.inTradeZone = () => false;
  b.session.tick();
  check('a player out of the zone sends what 7 result 0 and resets', finished && b.session.status === TRADE_STATUS.none);
}

{
  // A D4 00 from the server resets with text 0x10b.
  const io = fakeIO();
  const s = new TradeSession(0, io);
  s.status = TRADE_STATUS.list;
  s.onComplete(false);
  check('D4 flag 0 resets with text 0x10b', s.status === TRADE_STATUS.none && io.msgs[0][0] === TRADE_TEXT.failed);
}
{
  // The meseta pseudo item (exe -0xff) is the id the offer list uses.
  check('meseta offer id is 0xffffff01', TRADE_MESETA_ID === 0xffffff01);
}

// ---- The IO over the connection and the character (net/tradeio.ts) ---------

{
  const sword = { data1: Uint8Array.from([0x03, 0x01, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0]), id: 0x00010203, data2: Uint8Array.from([9, 8, 7, 6]) };
  const c = {
    meseta: 500,
    inventory: [{ index: 0, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: sword }],
  } as unknown as CharacterFile;
  const item = tradeCompactItem(c, 0x00010203, 2);
  check('a compact item is the ItemData (20 bytes), the offered quantity at data1[5]', !!item && item.length === 20 && item[5] === 2 && item[0] === 0x03 && item[12] === 0x03 && item[13] === 0x02 && item[16] === 9);
  check('a compact item not in the inventory is null', tradeCompactItem(c, 0x1234, 1) === null);
  const meseta = tradeCompactItem(c, TRADE_MESETA_ID, 200);
  check(
    'the meseta offer is the pseudo item 0xffffff01 with the amount in data2 (ASSUMED layout)',
    !!meseta && meseta[0] === 4 && meseta[12] === 0x01 && meseta[13] === 0xff && meseta[14] === 0xff && meseta[15] === 0xff && meseta[16] === 200,
  );
  removeTradeOffer(c, TRADE_MESETA_ID, 200);
  check('the completed meseta offer is taken from the character (the port keeps meseta under 0xffffffff)', c.meseta === 300, String(c.meseta));
  check('MESETA_ITEM_ID (items.ts) is the port id the trade maps to', MESETA_ITEM_ID === 0xffffffff);

  // The IO's presence and host plumbing: a send goes out as given; a notice reaches the host.
  const sent: Packet[] = [];
  const notes: number[] = [];
  const io = tradeIO({
    send: (p) => sent.push(p),
    host: () => ({ character: () => c, notify: (id) => notes.push(id) }),
    isPresent: (id) => id === 2,
  });
  io.send(tradeCompletePacket(true));
  io.message(TRADE_TEXT.success, 2);
  check('tradeIO forwards sends and notices to the host', sent.length === 1 && notes[0] === TRADE_TEXT.success && io.playerPresent(2) && !io.playerPresent(3));
}

// A lobby receives a partner's 6xA6 through its connection (the 0x62 relay) and the D4 result.
{
  const sent: Array<{ command: number; flag: number; data: Uint8Array }> = [];
  const conn = {
    onCommand: (() => {}) as ((c: { command: number; flag: number; data: Uint8Array }) => void) | null,
    send: (command: number, flag: number, data: Uint8Array) => sent.push({ command, flag, data }),
  };
  const lobby = new Lobby(conn as unknown as ConstructorParameters<typeof Lobby>[0]);
  lobby.selfId = 1;
  const propose = tradeSubcommand(2, TRADE_WHAT.propose, TRADE_RESULT.ok, { amount: 0 });
  conn.onCommand!({ command: 0x62, flag: 1, data: propose });
  check('a partner proposal in a 0x62 reaches the lobby session (status requested)', lobby.trade.status === TRADE_STATUS.requested && lobby.trade.partner === 2);
  const accept = lobby.trade;
  check('the session is kept while the self id is the same', lobby.trade === accept);
  lobby.trade.reject();
  check('reject answers what 0 result 3 through the connection', sent.some((p) => p.command === 0x62 && p.data[4] === TRADE_WHAT.propose && p.data[5] === TRADE_RESULT.reject));
  // A trade open (proposal, accept), then D4 flag 1 = done (0x10a): the host hears the text.
  const notes: number[] = [];
  lobby.tradeHost = { character: () => null, notify: (id) => notes.push(id) };
  conn.onCommand!({ command: 0x62, flag: 1, data: tradeSubcommand(2, TRADE_WHAT.propose, TRADE_RESULT.ok, { amount: 0 }) });
  lobby.trade.accept(0);
  check('the accepted trade is open', lobby.trade.status === TRADE_STATUS.open);
  conn.onCommand!({ command: 0xd4, flag: 1, data: new Uint8Array(0) });
  check('D4 flag 1 completes the trade with text 0x10a', notes[0] === TRADE_TEXT.success && lobby.trade.status === TRADE_STATUS.none, String(notes));
  // D1 with no trade in the list state does nothing (exe ExecuteTradeAction_00826394: status 7 only).
  conn.onCommand!({ command: 0xd1, flag: 0, data: new Uint8Array(0) });
  check('D1 without a list state sends nothing', !sent.some((p) => p.command === 0xd2));
}

// ---- The abort (exe CheckTradeTimeoutOrError_00827064, dump 840342) -------------
// With the list out (flag 0x400) and a second confirm missing, the exe sends the D4 abort
// (flag 0, what SendTradeAbortPacket_007f6984) and sets status 9; without 0x400 it sends nothing.
{
  const sent: Packet[] = [];
  const io: TradeIO = {
    send: (p) => sent.push(p),
    message: () => {},
    compactItem: () => null,
    removeOffer: () => {},
    inTradeZone: () => true,
    playerPresent: () => true,
  };
  const s = new TradeSession(1, io);
  s.partner = 2;
  s.status = TRADE_STATUS.list;
  s.flags = TRADE_FLAG.listSent | TRADE_FLAG.confirm2Sent;
  s.tick();
  check('a list out with the partner second confirm missing sends the D4 abort (flag 0)', sent.some((p) => p.command === 0xd4 && p.flag === 0) && s.status === TRADE_STATUS.aborted);
  check('the abort clears the list flag (0x400) as the exe does', (s.flags & TRADE_FLAG.listSent) === 0);
  sent.length = 0;
  s.status = TRADE_STATUS.list;
  s.flags = 0;
  s.tick();
  check('no list flag: no abort is sent', !sent.some((p) => p.command === 0xd4) && s.status === TRADE_STATUS.list);
}

console.log(failures ? `${failures} FAILED` : 'all trade checks passed');
if (failures) process.exit(1);
