// BB player trade (the Home menu's Trade Window, menu id 0x1a, and the quick menu's
// trade window): the 6xA6 trade proposal subcommand, the D0..D4 item-trade
// commands, and the trade state machine that the exe runs on top of them.
//
// Exe side (PsoBB.exe, dump refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//   6xA6 table                g_Packet0x60Subcommand0xA6Handlers_00a16660[status][what]
//                             (9 x 8 entries, read with tools/exedata.py; the handler
//                             names are in the table below)
//   handle_packet0x60_subcommand0xa6 (dump 839683)   the gate: sender < 4, what < 8,
//                             sender is the partner (or there is none)
//   SendTradeRequest_008261e4 (839591) propose: what 0, result 0, meseta at +0xc,
//                             status 1; SendTradeMesetaRequest_00826284 accept: what 0,
//                             result 2, status 3; QuickMenuWindow_SendTradeReject_00826194:
//                             what 0, result 3; QuickMenuWindow_SendTradeRequest_008260cc:
//                             what 1 (item at +8, quantity at +0xc); ..._00826130: what 2
//   ProcessTradeState_00825b4c (cancel, status 1..6): what 5, result 4
//   TransitionTradeState_00825bf0 (confirms, 30 frames each): what 3 / 4, results 0 / 4
//   ProcessTradeListState_00825dfc (status 6 -> 7): builds the D0 list, flag 0x400
//   ExecuteTradeAction_00826394 (D1 handler, table index 0x34): status 7 only, removes
//                             the offered items / meseta, sends D2, status 8
//   ShowTradeErrorDialogAndReset_00827024 (D4 handler, table index 0x33): flag 0 -> text
//                             0x10b, flag 1 -> text 0x10a, then reset
//   HandleTradeListPacket_007e54bc (D0), SendTradePacket0xD2_007e87ac (D2),
//   SendTradeAbortPacket_007f6984 (D4 flag 0): the send side
// Server side (newserv src/ReceiveSubcommands.cc on_forward_check_game, 6xA6 forwarded
// in game lobbies only; src/ReceiveCommands.cc on_D0_V3_BB / on_D2_V3_BB / on_D4_V3_BB,
// CommandFormats.hh SC_TradeItems_D0_D3 and the 6xA6 comment; MIT). Newserv's 6xA6
// vocabulary (propose / accept / reject / confirms / cancel / finish) matches the exe's
// handler table row for row, which the test checks.
//
// Not ported here (the window and the map): the quick menu's windows and timers, the
// partner pick, the TObjTradeCollision zone bits (the exe's per-player flags 0..3 are
// read through the io callbacks), and the inventory side (6x29 / 6xBE are the caller's).
//
// ASSUMED (see the DEVLOG entry of 2026-10-23 "player trade"): the meaning of the
// flags 0x10 / 0x80 as the local confirm buttons; the target of the busy reply
// (CancelTrade_00824d38 takes its target from EAX, not traced: the sender is used);
// the no-op rows of the table (exe handler 0x61cdb0, not traced); the D3 handling
// (table index 0x32, not traced: no-op); the meseta offer as item id 0xffffff01 in
// the D0 list (exe ProcessTradeListState_00825dfc); newserv's handling of that id is
// NOT checked (newserv's remove_item has no meseta case).

import type { Packet } from './guildcard.ts';

export const TRADE_SUB = 0xa6;
export const TRADE_SUB_SIZE = 0x10;
export const TRADE_CMD = { items: 0xd0, advance: 0xd1, proceed: 0xd2, execute: 0xd3, complete: 0xd4 } as const;

// 6xA6 "what" values (the exe's subsubcmd at +4; newserv G_ModifyTradeProposal_6xA6).
export const TRADE_WHAT = {
  propose: 0,
  addQuantity: 1, // exe UpdateTradeWindowItems
  addItem: 2, // exe AddTradeItemToWindow
  firstConfirm: 3,
  secondConfirm: 4,
  cancelProposal: 5,
  busy: 6,
  finish: 7,
} as const;

// "result" values (the exe's field4_0x5 at +5).
export const TRADE_RESULT = { ok: 0, accept: 2, reject: 3, cancel: 4 } as const;

// The meseta pseudo item in the offer list (exe ExecuteTradeAction_00826394: item_id == 0xffffff01).
export const TRADE_MESETA_ID = 0xffffff01;
export const TRADE_OFFER_SLOTS = 0x1f; // exe: 31 offer pairs (g_QuickMenuSlotData, loop bound 0x1f)
export const TRADE_ITEM_SLOTS = 0x20; // D0 carries up to 32 items (newserv SC_TradeItems_D0_D3)
export const TRADE_ITEM_SIZE = 0x14; // one compact ItemData (5 dwords, exe ProcessTradeListState_00825dfc)
export const TRADE_LIST_BODY = 4 + TRADE_ITEM_SLOTS * TRADE_ITEM_SIZE; // 0x284: target, count, items
export const TRADE_NO_PARTNER = 4; // exe g_TradeWindowOtherPlayerSlot == 4 means none

// Status (exe g_CurrentTradeStatus); the 6xA6 table is indexed by it.
export const TRADE_STATUS = {
  none: 0,
  proposed: 1, // I proposed, waiting for the accept
  requested: 2, // the partner proposed
  open: 3, // the window is open (accepted)
  confirm1: 4, // first confirm sent
  confirm2: 5, // second confirm sent
  ready: 6, // both second confirms: the list is built next tick
  list: 7, // D0 sent, waiting for D1
  sent: 8, // D2 sent, waiting for D3 / D4
  aborted: 9, // D4 00 sent (not in the exe's table)
} as const;

// TradeStateFlags (exe g_TradeStateFlags, 16 bits). Bits 0..3 are the per-player
// "in the trade zone" flags (DerolleMapObjectVisibilityCheck_00667bb5 sets them).
export const TRADE_FLAG = {
  confirm1Pressed: 0x10, // ASSUMED: the local first-confirm button is held
  confirm1Sent: 0x20,
  partnerConfirm1: 0x40,
  confirm2Pressed: 0x80, // ASSUMED: the local second-confirm button is held
  confirm2Sent: 0x100,
  partnerConfirm2: 0x200,
  listSent: 0x400,
} as const;

// Frames a confirm is held before it is sent (exe TransitionTradeState_00825bf0: 0x1e / 0x1d).
export const TRADE_CONFIRM_FRAMES = 30;

// Text ids of the group 11 strings the exe shows (unitxt_get_group_11_String).
export const TRADE_TEXT = {
  declined: 0xf7,
  success: 0x10a,
  failed: 0x10b,
  cancelled: 0x10c,
  accepted: 0x110,
  partnerName: 0x10e, // "<name> ..." (GetPlayerNameOrErrorString_00825a0c)
  selfName: 0x10f,
} as const;

// One 6xA6 subcommand, decoded.
export interface TradeSubcommand {
  sender: number;
  what: number;
  result: number;
  completion: number; // only used with what 7 (big-endian u16 at +6)
  itemId: number; // what 1 / 2 (le u32 at +8)
  amount: number; // what 0: the sender's meseta; what 1 / 2: the quantity (le u32 at +0xc)
}

// The 6xA6 subcommand (16 bytes): the 0x62 targeted send, sender id at +2 (le u16).
export function tradeSubcommand(
  sender: number,
  what: number,
  result: number,
  opts: { completion?: number; itemId?: number; amount?: number } = {},
): Uint8Array {
  const b = new Uint8Array(TRADE_SUB_SIZE);
  const dv = new DataView(b.buffer);
  b[0] = TRADE_SUB;
  b[1] = TRADE_SUB_SIZE / 4;
  dv.setUint16(2, sender, true);
  b[4] = what;
  b[5] = result;
  dv.setUint16(6, opts.completion ?? 0, false);
  dv.setUint32(8, (opts.itemId ?? 0) >>> 0, true);
  dv.setUint32(12, (opts.amount ?? 0) >>> 0, true);
  return b;
}

export function parseTradeSubcommand(data: Uint8Array): TradeSubcommand {
  if (data.length < TRADE_SUB_SIZE || data[0] !== TRADE_SUB) throw new Error('not a 6xA6 trade subcommand');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    sender: dv.getUint16(2, true),
    what: data[4],
    result: data[5],
    completion: dv.getUint16(6, false),
    itemId: dv.getUint32(8, true),
    amount: dv.getUint32(12, true),
  };
}

// A targeted send (exe exec_packet0x60_or_send_packet0x62 with a partner: 0x62, the
// target's id in the header flag, as game.ts sends its 6x6F to a joining player).
function toPartner(partner: number, sub: Uint8Array): Packet {
  return { command: 0x62, flag: partner, payload: sub };
}

// Trade commands (BB: 8-byte header, body after it).
export function tradeItemListPacket(target: number, items: Uint8Array[]): Packet {
  if (items.length > TRADE_ITEM_SLOTS) throw new Error(`a trade offers at most ${TRADE_ITEM_SLOTS} items`);
  const body = new Uint8Array(TRADE_LIST_BODY);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, target, true);
  dv.setUint16(2, items.length, true);
  items.forEach((item, i) => {
    if (item.length !== TRADE_ITEM_SIZE) throw new Error(`a trade item is ${TRADE_ITEM_SIZE} bytes`);
    body.set(item, 4 + i * TRADE_ITEM_SIZE);
  });
  return { command: TRADE_CMD.items, flag: 0, payload: body };
}

export function tradeProceedPacket(): Packet {
  return { command: TRADE_CMD.proceed, flag: 0, payload: new Uint8Array(0) };
}

export function tradeCompletePacket(ok: boolean): Packet {
  return { command: TRADE_CMD.complete, flag: ok ? 1 : 0, payload: new Uint8Array(0) };
}

// The D0 list as the server reads it: target and count, then the items (newserv
// SC_TradeItems_D0_D3). Returns the target, the count and the item bytes.
export function parseTradeItemList(body: Uint8Array): { target: number; items: Uint8Array[] } {
  if (body.length !== TRADE_LIST_BODY) throw new Error(`a trade list is ${TRADE_LIST_BODY} bytes`);
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const count = dv.getUint16(2, true);
  if (count > TRADE_ITEM_SLOTS) throw new Error('invalid item count in trade list');
  const items: Uint8Array[] = [];
  for (let i = 0; i < count; i++) items.push(body.slice(4 + i * TRADE_ITEM_SIZE, 4 + (i + 1) * TRADE_ITEM_SIZE));
  return { target: dv.getUint16(0, true), items };
}

// ---- The state machine -----------------------------------------------------

export interface TradeOffer {
  itemId: number; // -1 for an empty slot (exe: the free slots hold -1)
  amount: number;
}

export interface TradeIO {
  // The packet sink (6xA6 goes out 0x62 to the partner, D0 / D2 / D4 to the server).
  send(p: Packet): void;
  // A group 11 text (TRADE_TEXT); the caller shows it.
  message(textId: number, partner: number): void;
  // The compact item bytes (20) of an inventory item for the D0 list (meseta: the
  // caller builds its own pseudo item). Null when the item is not in the inventory.
  compactItem(itemId: number, amount: number): Uint8Array | null;
  // Removes an offered item (or meseta when itemId is TRADE_MESETA_ID) from the local character.
  removeOffer(itemId: number, amount: number): void;
  // The trade-zone flag of a player (exe per-player flags 0..3; true when unknown).
  inTradeZone(playerId: number): boolean;
  // Whether a player is in the game (exe GetPlayer_0068d5a8 != null).
  playerPresent(playerId: number): boolean;
}

function emptyOffers(n: number): TradeOffer[] {
  return Array.from({ length: n }, () => ({ itemId: -1, amount: 0 }));
}

// The exe's list update (UpdateTradeWindowItems / AddTradeItemToWindow, simplified:
// find the item's slot and add to it, else take the first free slot). ASSUMED.
function bumpOffer(list: TradeOffer[], itemId: number, delta: number): void {
  let slot = list.find((o) => o.itemId === itemId);
  if (!slot) {
    slot = list.find((o) => o.itemId === -1);
    if (!slot) return;
    slot.itemId = itemId;
    slot.amount = 0;
  }
  slot.amount += delta;
  if (slot.amount <= 0) {
    slot.itemId = -1;
    slot.amount = 0;
  }
}

type Handler = (s: TradeSession, sender: number, p: TradeSubcommand) => void;

// g_Packet0x60Subcommand0xA6Handlers_00a16660 (rows = status, columns = what), with
// the exe's handler names. Missing entries are the exe's null entries (ignored).
const HANDLERS: Partial<Record<number, Partial<Record<number, Handler>>>> = {
  0: { 0: (s, sender, p) => s.onCardPropose(sender, p) },
  1: {
    0: (s, sender, p) => s.onCardAnswer(sender, p), // HandleTradeGuildCardState
    5: (s, _sender, p) => { if (p.result === 0) s.resetWith(TRADE_TEXT.accepted); }, // AcceptTradeRequest
    7: (s, _sender, p) => { if (p.result === 0) s.finishWithName(); }, // HandlePacket0x60Subcommand0xA6_008259e8
  },
  2: {
    5: (s, _sender, p) => { if (p.result === 4) s.clear(); }, // Status4
    7: (s, _sender, p) => { if (p.result === 0) s.clear(); }, // Status0
  },
};
const OPEN_ROWS: Record<number, Partial<Record<number, Handler>>> = {
  3: { 1: (s, sender, p) => s.onQuantity(sender, p), 2: (s, sender, p) => s.onAddItem(sender, p), 3: onSent, 4: onReceived, 5: onCancelled, 7: (s, _sn, p) => { if (p.result === 0) s.finishWithName(); } },
  4: { 1: (s, sender, p) => s.onQuantity(sender, p), 2: (s, sender, p) => s.onAddItem(sender, p), 3: onSent, 4: onReceived, 5: onCancelled, 7: (s, _sn, p) => { if (p.result === 0) s.finishWithName(); } },
  5: { 3: onSent, 4: onReceived, 5: onCancelled },
  6: { 4: onReceived, 5: onCancelled },
  7: { 4: onReceived, 5: (s, _sn, p) => { if (p.result === 4) s.abortFromServer(); } },
  8: { 4: onReceived, 5: (s, _sn, p) => { if (p.result === 4) s.abortFromServer(); } },
};
function onSent(s: TradeSession, _sender: number, p: TradeSubcommand): void {
  if (p.result === 0) s.flags |= TRADE_FLAG.partnerConfirm1;
  else if (p.result === 4) s.flags &= ~TRADE_FLAG.partnerConfirm1;
}
function onReceived(s: TradeSession, _sender: number, p: TradeSubcommand): void {
  if (p.result === 0) s.flags |= TRADE_FLAG.partnerConfirm2;
  else if (p.result === 4) s.flags &= ~TRADE_FLAG.partnerConfirm2;
}
function onCancelled(s: TradeSession, _sender: number, p: TradeSubcommand): void {
  if (p.result === 4) s.resetWith(TRADE_TEXT.cancelled);
}
for (const [row, cols] of Object.entries(OPEN_ROWS)) HANDLERS[Number(row)] = cols;

export class TradeSession {
  status: number = TRADE_STATUS.none;
  flags = 0;
  partner = TRADE_NO_PARTNER;
  partnerMeseta = 0;
  counter = 0;
  // The local offers (exe g_QuickMenuSlotData) and the partner's (g_TradeWindowItems).
  local: TradeOffer[] = emptyOffers(TRADE_OFFER_SLOTS);
  remote: TradeOffer[] = emptyOffers(TRADE_OFFER_SLOTS);

  readonly self: number;
  private io: TradeIO;

  constructor(self: number, io: TradeIO) {
    this.self = self;
    this.io = io;
  }

  // ---- Local actions (the window calls these) ----------------------------

  // Propose a trade to `target` with `meseta` (exe QuickMenuWindow_SendTradeRequest_008261e4).
  // When the partner already proposed to this target, the proposal is an accept.
  propose(target: number, meseta: number): boolean {
    if (this.partner === target) return this.accept(meseta);
    // A trade with someone else is open: it is cancelled first (exe CancelTrade_00824d38;
    // the busy reply goes to the old partner, ASSUMED: the exe takes the target from EAX).
    if (this.partner !== TRADE_NO_PARTNER) {
      this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.busy, TRADE_RESULT.ok)));
      this.clear();
    }
    this.io.send(toPartner(target, tradeSubcommand(this.self, TRADE_WHAT.propose, TRADE_RESULT.ok, { amount: meseta })));
    this.status = TRADE_STATUS.proposed;
    this.partner = target;
    return true;
  }

  // Accept a partner's proposal (exe QuickMenuWindow_SendTradeMesetaRequest_00826284).
  accept(meseta: number): boolean {
    if (this.status !== TRADE_STATUS.requested) return false;
    this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.propose, TRADE_RESULT.accept, { amount: meseta })));
    this.status = TRADE_STATUS.open;
    return true;
  }

  // Decline a partner's proposal (exe QuickMenuWindow_SendTradeReject_00826194).
  reject(): boolean {
    if (this.status !== TRADE_STATUS.requested) return false;
    this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.propose, TRADE_RESULT.reject)));
    this.clear();
    return true;
  }

  // Opens the window with a new state (exe QuickMenuWindow_UpdateTradeWindowData clears the lists).
  // Called when the trade starts (status 3).
  openWindow(): void {
    this.local = emptyOffers(TRADE_OFFER_SLOTS);
    this.remote = emptyOffers(TRADE_OFFER_SLOTS);
  }

  // Adds `delta` of an item to the local offer and tells the partner (what 1, exe QuickMenuWindow_SendTradeRequest_008260cc).
  offerQuantity(itemId: number, delta: number): boolean {
    if (this.status !== TRADE_STATUS.open) return false;
    this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.addQuantity, TRADE_RESULT.ok, { itemId, amount: delta })));
    bumpOffer(this.local, itemId, delta);
    return true;
  }

  // what 2 (exe QuickMenuWindow_SendTradeAccept_00826130; the local list is AddTradeItemToWindow).
  offerItem(itemId: number, amount: number): boolean {
    if (this.status !== TRADE_STATUS.open) return false;
    this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.addItem, TRADE_RESULT.ok, { itemId, amount })));
    bumpOffer(this.local, itemId, amount);
    return true;
  }

  // The window's confirm buttons (flags 0x10 / 0x80, ASSUMED: held while pressed).
  setConfirm1(on: boolean): void {
    this.flags = on ? this.flags | TRADE_FLAG.confirm1Pressed : this.flags & ~TRADE_FLAG.confirm1Pressed;
  }
  setConfirm2(on: boolean): void {
    this.flags = on ? this.flags | TRADE_FLAG.confirm2Pressed : this.flags & ~TRADE_FLAG.confirm2Pressed;
  }

  // Cancel the trade from the window (exe ProcessTradeState_00825b4c).
  cancel(): void {
    this.dropTrade();
  }

  // ---- Incoming -------------------------------------------------------------

  // A 6xA6 from a player (the 0x62 targeted send, or the server's relay).
  receive(data: Uint8Array): void {
    const p = parseTradeSubcommand(data);
    if (p.sender >= 4 || p.what >= 8) return;
    if (this.partner === TRADE_NO_PARTNER || p.sender === this.partner) {
      const h = HANDLERS[this.status]?.[p.what];
      if (h) h(this, p.sender, p);
      return;
    }
    // Another player while a trade is open: a proposal gets the busy reply (exe CancelTrade_00824d38).
    if (p.what === TRADE_WHAT.propose && p.result === TRADE_RESULT.ok) {
      this.io.send(toPartner(p.sender, tradeSubcommand(this.self, TRADE_WHAT.busy, TRADE_RESULT.ok)));
    }
  }

  // D1 (exe ExecuteTradeAction_00826394): status 7 only. Removes the offers, sends D2.
  onAdvance(): void {
    if (this.status !== TRADE_STATUS.list) return;
    for (const o of this.local) {
      if (o.itemId !== -1 && o.amount > 0) this.io.removeOffer(o.itemId, o.amount);
    }
    this.io.send(tradeProceedPacket());
    this.status = TRADE_STATUS.sent;
  }

  // D3 (BB): the server has already moved the items; the exe's handler is not traced (ASSUMED no-op).
  onExecute(): void {}

  // D4 (exe ShowTradeErrorDialogAndReset_00827024): flag 1 = done, 0 = failed.
  onComplete(ok: boolean): void {
    if (this.status === TRADE_STATUS.none) return;
    this.resetWith(ok ? TRADE_TEXT.success : TRADE_TEXT.failed);
  }

  // A what 5 with result 4 while the list is out: the exe's ValidateTradePacketHeader_008259cc
  // sends the D4 abort and nothing else; the server's D4 00 ends the trade.
  abortFromServer(): void {
    this.io.send(tradeCompletePacket(false));
  }

  // ---- Per frame (exe ProcessTradePacketState_00825a5c, 30 Hz) --------------

  tick(): void {
    if (this.status !== TRADE_STATUS.none && this.partner !== TRADE_NO_PARTNER) {
      if (!this.io.playerPresent(this.partner)) {
        this.dropTrade();
        return;
      }
      if (!this.io.inTradeZone(this.partner)) this.acceptance();
    }
    if (this.status !== TRADE_STATUS.none) {
      if (!this.io.playerPresent(this.self)) {
        this.dropTrade();
        return;
      }
      if (!this.io.inTradeZone(this.self)) {
        this.acceptance();
        return;
      }
    }
    this.transition();
    this.listState();
  }

  // ProcessTradeState_00825b4c: statuses 1..6 send what 5 (cancel), 7 and 8 send the D4 abort.
  private dropTrade(): void {
    if (this.status >= TRADE_STATUS.proposed && this.status <= TRADE_STATUS.ready) {
      this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.cancelProposal, TRADE_RESULT.cancel)));
      this.clear();
    } else if (this.status === TRADE_STATUS.list || this.status === TRADE_STATUS.sent) {
      this.io.send(tradeCompletePacket(false));
    }
  }

  // The partner or I left the trade zone (exe ProcessTradeAcceptance_00825ae4): what 7 to the partner.
  private acceptance(): void {
    this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.finish, TRADE_RESULT.ok)));
    if (this.status !== TRADE_STATUS.requested) {
      this.finishWithName();
      return;
    }
    this.clear();
  }

  // TransitionTradeState_00825bf0: the two confirms, each held for TRADE_CONFIRM_FRAMES.
  private transition(): void {
    const f = this.flags;
    const old = this.counter;
    if (!(f & TRADE_FLAG.confirm1Pressed)) {
      this.counter = 0;
      if (!(f & TRADE_FLAG.confirm1Sent)) return;
      this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.firstConfirm, TRADE_RESULT.cancel)));
      this.flags &= ~TRADE_FLAG.confirm1Sent;
      this.status = TRADE_STATUS.open;
      return;
    }
    if (!(f & TRADE_FLAG.confirm1Sent)) {
      this.counter = old + 1;
      if (old < TRADE_CONFIRM_FRAMES) return;
      this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.firstConfirm, TRADE_RESULT.ok)));
      this.flags |= TRADE_FLAG.confirm1Sent;
      this.counter = 0;
      this.status = TRADE_STATUS.confirm1;
      return;
    }
    if (!(f & TRADE_FLAG.confirm2Pressed)) {
      this.counter = 0;
      if (!(f & TRADE_FLAG.confirm2Sent)) return;
      this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.secondConfirm, TRADE_RESULT.cancel)));
      this.status = TRADE_STATUS.confirm1;
      this.flags &= ~TRADE_FLAG.confirm2Sent;
      return;
    }
    if (!(f & TRADE_FLAG.confirm2Sent)) {
      this.counter = old + 1;
      if (old <= 0x1d) return;
      this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.secondConfirm, TRADE_RESULT.ok)));
      this.flags |= TRADE_FLAG.confirm2Sent;
      this.counter = 0;
      this.status = TRADE_STATUS.confirm2;
    }
  }

  // ProcessTradeListState_00825dfc: both second confirms -> the list (D0) goes out.
  private listState(): void {
    if (this.status === TRADE_STATUS.confirm2) {
      if ((this.flags & (TRADE_FLAG.confirm2Sent | TRADE_FLAG.partnerConfirm2)) === (TRADE_FLAG.confirm2Sent | TRADE_FLAG.partnerConfirm2)) {
        this.status = TRADE_STATUS.ready;
      }
      return;
    }
    if (this.status === TRADE_STATUS.ready) {
      const items: Uint8Array[] = [];
      for (const o of this.local) {
        if (o.itemId === -1 || o.amount <= 0) continue;
        const compact = this.io.compactItem(o.itemId, o.amount);
        if (compact) items.push(compact);
      }
      this.io.send(tradeItemListPacket(this.partner, items));
      this.flags |= TRADE_FLAG.listSent;
      this.status = TRADE_STATUS.list;
      return;
    }
    if (this.status === TRADE_STATUS.list || this.status === TRADE_STATUS.sent) {
      if (!(this.flags & TRADE_FLAG.confirm2Sent) || !(this.flags & TRADE_FLAG.partnerConfirm2)) {
        if (this.flags & TRADE_FLAG.listSent) {
          this.io.send(tradeCompletePacket(false));
          this.status = TRADE_STATUS.aborted;
          this.flags &= ~TRADE_FLAG.listSent;
        }
      }
    }
  }

  finishWithName(): void {
    this.io.message(TRADE_TEXT.partnerName, this.partner);
    this.reset();
  }

  resetWith(textId: number): void {
    this.io.message(textId, this.partner);
    this.reset();
  }

  // ResetTradeStateAndShowDialog_00826e50: clear, then the window's dialog (the caller's message).
  private reset(): void {
    this.clear();
  }

  // ClearTradeWindowData_00824dc0: clear without a message. (The exe returns early while
  // g_GuildCardFlags bit 8 is set; that bit is not modelled, see the header.)
  clear(): void {
    this.partner = TRADE_NO_PARTNER;
    this.status = TRADE_STATUS.none;
    this.partnerMeseta = 0;
    this.counter = 0;
    this.flags &= 0xf80f;
  }

  // The handlers the table calls.
  onCardPropose(sender: number, p: TradeSubcommand): void {
    if (p.result !== TRADE_RESULT.ok) return;
    this.partner = sender;
    this.partnerMeseta = p.amount;
    this.status = TRADE_STATUS.requested;
  }

  onCardAnswer(_sender: number, p: TradeSubcommand): void {
    if (p.result === TRADE_RESULT.accept) {
      this.partnerMeseta = p.amount;
      this.status = TRADE_STATUS.open;
    } else if (p.result === TRADE_RESULT.reject) {
      this.resetWith(TRADE_TEXT.declined);
    } else if (p.result === TRADE_RESULT.ok) {
      this.io.send(toPartner(this.partner, tradeSubcommand(this.self, TRADE_WHAT.busy, TRADE_RESULT.ok)));
    }
  }

  // what 1 / 2: the amount is signed (a quantity change can be negative).
  onQuantity(sender: number, p: TradeSubcommand): void {
    if (p.result === 0 && sender === this.partner) bumpOffer(this.remote, p.itemId, p.amount | 0);
  }

  onAddItem(sender: number, p: TradeSubcommand): void {
    if (p.result === 0 && sender === this.partner) bumpOffer(this.remote, p.itemId, p.amount | 0);
  }
}
