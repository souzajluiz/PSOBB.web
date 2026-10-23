// The player trade's IO (net/trade.ts TradeIO) over the game connection and the
// local character: the 6xA6 / D0 / D2 / D4 sends go through the connection, the offers
// are read from and removed from the character's inventory (InventoryModel, the same
// local removal the Item Pack uses). Nothing here sends an inventory packet: the server
// moves the items on D2 / D3 (newserv), the exe removes them locally (ExecuteTradeAction_00826394).
import type { CharacterFile } from './charfile.ts';
import { InventoryModel, MESETA_ITEM_ID } from './items.ts';
import type { Packet } from './guildcard.ts';
import { TRADE_ITEM_SIZE, TRADE_MESETA_ID, type TradeIO } from './trade.ts';

export interface TradeHost {
  // The local character (null before the character is loaded).
  character(): CharacterFile | null;
  // A group 11 text the trade shows (net/trade.ts TRADE_TEXT); the window draws it.
  notify(textId: number, partner: number): void;
}

export interface TradeLink {
  send(p: Packet): void;
  host(): TradeHost | null;
  // The player is in the game / lobby (exe GetPlayer_0068d5a8 != null).
  isPresent(playerId: number): boolean;
  // The trade zone bit of a player (net/tradezone.ts); absent: the permissive reading.
  inTradeZone?(playerId: number): boolean;
}

// The compact item of the D0 list: the ItemData as it is stored (data1 12 bytes, id le
// u32, data2 4 bytes), with the offered quantity at data1[5] (the stack byte). The
// meseta offer is the pseudo item TRADE_MESETA_ID with the amount in data2 (ASSUMED
// layout: the exe builds it with ConstructItemInstance_005d2998(-0xff)).
export function tradeCompactItem(c: CharacterFile | null, itemId: number, amount: number): Uint8Array | null {
  const out = new Uint8Array(TRADE_ITEM_SIZE);
  const dv = new DataView(out.buffer);
  if (itemId === TRADE_MESETA_ID) {
    out[0] = 4;
    dv.setUint32(12, TRADE_MESETA_ID, true);
    dv.setUint32(16, amount >>> 0, true);
    return out;
  }
  const it = c?.inventory.find((i) => i.data.id === itemId);
  if (!it) return null;
  out.set(it.data.data1, 0);
  dv.setUint32(12, it.data.id >>> 0, true);
  out.set(it.data.data2, 16);
  if (amount > 0) out[5] = amount;
  return out;
}

// The local removal of an offer that the trade completed (D1). The exe's meseta id is
// 0xffffff01 in the trade; the port's inventory keeps meseta under MESETA_ITEM_ID.
export function removeTradeOffer(c: CharacterFile | null, itemId: number, amount: number): void {
  if (!c) return;
  const id = itemId === TRADE_MESETA_ID ? MESETA_ITEM_ID : itemId;
  new InventoryModel(c).remove(id, amount);
}

export function tradeIO(link: TradeLink): TradeIO {
  return {
    send: (p) => link.send(p),
    message: (textId, partner) => link.host()?.notify(textId, partner),
    compactItem: (itemId, amount) => tradeCompactItem(link.host()?.character() ?? null, itemId, amount),
    removeOffer: (itemId, amount) => removeTradeOffer(link.host()?.character() ?? null, itemId, amount),
    // The zone bits of the field's TObjTradeCollision objects (net/tradezone.ts); the lobby
    // has none loaded, so the trade keeps the permissive reading there (ASSUMED).
    inTradeZone: (id) => link.inTradeZone?.(id) ?? true,
    playerPresent: (id) => link.isPresent(id),
  };
}
