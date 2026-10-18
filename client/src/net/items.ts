// Items in a game: floor items, the local inventory and the item commands.
//
// Command layouts from newserv src/CommandFormats.hh, behaviour from
// src/ReceiveSubcommands.cc, src/SendCommands.cc, src/Lobby.cc,
// src/PlayerInventory.hh, src/SaveFileFormats.cc and src/Items.cc (MIT), and
// from the real-client capture tests/GC-ForestGameRareMagFeed.test.txt
// (box opened: 6x0B then 6xA2 via 62 to the leader).
//
// On BB the server owns the items:
//   drops      S->C 6x5F {floor, source 1 enemy / 2 box, entity, x, z, room,
//              drop number, ItemData} (box/enemy drop) or 6x5D {floor, room,
//              x, z, ItemData} (stack split, player drop of meseta or part of a
//              stack). Both go to every player, the requester included.
//   pickup     C->S 6x5A {item id, floor}; S->C 6x59 {picker, floor, item id}
//              to every player (the picker too) when the item exists, is
//              within 30 units (newserv: dist^2 <= 900) and fits.
//   drop       C->S 6x2A {amount, floor, item id, x, y, z}: a whole item or
//              stack. The server forwards it to the others, not to the sender.
//              C->S 6xC3 {floor, x, z, item id, amount}: part of a stack, or
//              meseta (item id 0xFFFFFFFF). The server answers 6x5D to all
//              and expects the dropper to send 6x29 {item id, amount} after
//              it (it adds the amount back until then).
//   equip      C->S 6x25 {item id, slot} (slot 0 = the item's default slot),
//   unequip    6x26 {item id}, use 6x27 {item id}: forwarded to the others;
//              the sender applies them itself.
//   destroy    6x29 {item id, amount} (inventory), 6x63 {item id, floor} (floor).
//   create     S->C 6xBE {client id, ItemData}: an item appears in a
//              player's inventory (bank, shop, tekker, unwrap results).
//   box        C->S 6x0B {entity 0x4000 + object index, flags 1, object
//              index} (via 60), then 6xA2 {floor, rt_index 0x30, object index,
//              x, z, room, ignore_def, area, param3..6} (via 62 to the
//              leader); the server answers with 6x5F to everyone.
//   join sync  S->C 6x6D (BC0-compressed G_SyncItemState_6x6D: next drop
//              number per floor, next item id per player, item count per
//              floor, then FloorItem records), sent by newserv to a joiner
//              once the leader has sent its own 6x6D.
//
// Item ids: newserv (Lobby::reset_next_item_ids) starts player n at
// 0x00010000 + 0x00200000 * n. The creator of a game takes the first ids for
// its inventory, in slot order; a joiner gets the ids its 6x6D says are next.

import { maxStackSize, type ItemData } from '../formats/itemnames.ts';
import type { CharacterFile, InventoryItem } from './charfile.ts';
import type { Command } from './bbconnection.ts';
import type { Game } from './game.ts';

export const MESETA_ITEM_ID = 0xffffffff;
export const PICKUP_SERVER_RANGE = 30; // newserv: dist^2 > 900 is refused

export interface FloorItem {
  id: number;
  floor: number;
  x: number;
  z: number;
  data: ItemData;
  source: 'enemy' | 'box' | 'player' | 'sync';
  entityIndex: number; // 0xFFFF when not from an entity
}

export interface BoxRequest {
  floor: number;
  area: number;
  objectIndex: number; // across all floors (entity id - 0x4000)
  type: number;
  room: number;
  x: number;
  z: number;
  params: [number, number, number, number, number, number];
}

// Object types that drop an item when broken (newserv Map.cc; the
// specializable ones read param1..6 as a fixed drop).
export const ITEM_BOX_TYPES = new Set([0x0088, 0x0092, 0x0161, 0x0162, 0x0200, 0x0203, 0x038d]);
// Always-empty boxes: they break but request nothing.
export const EMPTY_BOX_TYPES = new Set([0x0095, 0x0165]);

// --- BC0 (newserv Compression.cc bc0_decompress) ------------------------------

export function bc0Decompress(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  const memo = new Uint8Array(0x1000);
  let memoOffset = 0x0fee;
  let control = 0;
  let r = 0;
  while (r < src.length) {
    control >>= 1;
    if ((control & 0x100) === 0) {
      control = 0xff00 | src[r++];
      if (r >= src.length) break;
    }
    if ((control & 1) === 0) {
      const a1 = src[r++];
      if (r >= src.length) break;
      const a2 = src[r++];
      const count = (a2 & 0x0f) + 3;
      const offset = a1 | ((a2 << 4) & 0xf00);
      for (let z = 0; z < count; z++) {
        const v = memo[(offset + z) & 0xfff];
        out.push(v);
        memo[memoOffset] = v;
        memoOffset = (memoOffset + 1) & 0xfff;
      }
    } else {
      const v = src[r++];
      out.push(v);
      memo[memoOffset] = v;
      memoOffset = (memoOffset + 1) & 0xfff;
    }
  }
  return new Uint8Array(out);
}

// --- Builders (whole subcommands, header included) ----------------------------

function sub(code: number, size: number, clientId: number): { b: Uint8Array; dv: DataView } {
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  b[0] = code;
  b[1] = size / 4;
  dv.setUint16(2, clientId, true);
  return { b, dv };
}

function writeItemData(dst: Uint8Array, o: number, item: ItemData): void {
  dst.set(item.data1.subarray(0, 12), o);
  new DataView(dst.buffer, dst.byteOffset).setUint32(o + 12, item.id >>> 0, true);
  dst.set(item.data2.subarray(0, 4), o + 16);
}

// G_PickUpItemRequest_6x5A (0x0C)
export function buildPickUpRequest(clientId: number, itemId: number, floor: number): Uint8Array {
  const { b, dv } = sub(0x5a, 0x0c, clientId);
  dv.setUint32(4, itemId >>> 0, true);
  dv.setUint16(8, floor, true);
  return b;
}

// G_DropItem_6x2A (0x18)
export function buildDropItem(clientId: number, itemId: number, floor: number, x: number, y: number, z: number, amount = 1): Uint8Array {
  const { b, dv } = sub(0x2a, 0x18, clientId);
  dv.setUint16(4, amount, true);
  dv.setUint16(6, floor, true);
  dv.setUint32(8, itemId >>> 0, true);
  dv.setFloat32(12, x, true);
  dv.setFloat32(16, y, true);
  dv.setFloat32(20, z, true);
  return b;
}

// G_SplitStackedItem_BB_6xC3 (0x18)
export function buildSplitStack(clientId: number, itemId: number, amount: number, floor: number, x: number, z: number): Uint8Array {
  const { b, dv } = sub(0xc3, 0x18, clientId);
  dv.setUint16(4, floor, true);
  dv.setFloat32(8, x, true);
  dv.setFloat32(12, z, true);
  dv.setUint32(16, itemId >>> 0, true);
  dv.setUint32(20, amount, true);
  return b;
}

// G_EquipItem_6x25 / G_UnequipItem_6x26 (0x0C), G_UseItem_6x27 (8)
export function buildEquip(clientId: number, itemId: number, slot: number): Uint8Array {
  const { b, dv } = sub(0x25, 0x0c, clientId);
  dv.setUint32(4, itemId >>> 0, true);
  dv.setUint32(8, slot, true);
  return b;
}
export function buildUnequip(clientId: number, itemId: number): Uint8Array {
  const { b, dv } = sub(0x26, 0x0c, clientId);
  dv.setUint32(4, itemId >>> 0, true);
  return b;
}
export function buildUseItem(clientId: number, itemId: number): Uint8Array {
  const { b, dv } = sub(0x27, 0x08, clientId);
  dv.setUint32(4, itemId >>> 0, true);
  return b;
}

// G_DeleteInventoryItem_6x29 (0x0C)
export function buildDeleteItem(clientId: number, itemId: number, amount: number): Uint8Array {
  const { b, dv } = sub(0x29, 0x0c, clientId);
  dv.setUint32(4, itemId >>> 0, true);
  dv.setUint32(8, amount, true);
  return b;
}

// G_UpdateObjectState_6x0B (0x0C): header entity id = 0x4000 + object index.
export function buildObjectState(objectIndex: number, flags: number): Uint8Array {
  const { b, dv } = sub(0x0b, 0x0c, 0x4000 + objectIndex);
  dv.setUint32(4, flags, true);
  dv.setUint32(8, objectIndex, true);
  return b;
}

// G_SpecializableItemDropRequest_6xA2 (0x28). ignore_def as newserv's
// reconcile_drop_request_with_map expects it: TObjContainerBase (0x92),
// TOContainerAncientItemCommon (0x161) and TObjContainerJungEx (0x203)
// specialize when param1 <= 0, the desert crystal box (0x38D) when
// (int)param1 == 2; every other box ignores its params.
export function boxIgnoresDef(type: number, param1: number): boolean {
  if (type === 0x0092 || type === 0x0161 || type === 0x0203) return param1 > 0;
  if (type === 0x038d) return Math.floor(param1) !== 2;
  return true;
}

export function buildBoxDropRequest(r: BoxRequest): Uint8Array {
  const { b, dv } = sub(0xa2, 0x28, 0);
  b[4] = r.floor;
  b[5] = 0x30; // rt_index 0x30 = box
  dv.setUint16(6, r.objectIndex, true);
  dv.setFloat32(8, r.x, true);
  dv.setFloat32(12, r.z, true);
  dv.setUint16(16, r.room, true);
  dv.setUint16(18, boxIgnoresDef(r.type, r.params[0]) ? 1 : 0, true);
  b[20] = r.area;
  dv.setFloat32(24, r.params[2], true);
  dv.setInt32(28, r.params[3], true);
  dv.setInt32(32, r.params[4], true);
  dv.setInt32(36, r.params[5], true);
  return b;
}

// --- Parsers -----------------------------------------------------------------

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function readItem(b: Uint8Array, o: number): ItemData {
  return { data1: b.slice(o, o + 12), id: view(b).getUint32(o + 12, true), data2: b.slice(o + 16, o + 20) };
}

// 6x5F (G_DropItem_PC_V3_BB_6x5F, 0x2C): FloorItem at +4.
export function parseBoxOrEnemyDrop(body: Uint8Array): FloorItem | null {
  if (body.length < 0x28) return null;
  const dv = view(body);
  return {
    floor: body[4],
    source: body[5] === 1 ? 'enemy' : 'box',
    entityIndex: dv.getUint16(6, true),
    x: dv.getFloat32(8, true),
    z: dv.getFloat32(12, true),
    data: readItem(body, 0x14),
    id: dv.getUint32(0x20, true),
  };
}

// 6x5D (G_DropStackedItem_PC_V3_BB_6x5D, 0x28)
export function parseStackedDrop(body: Uint8Array): FloorItem | null {
  if (body.length < 0x24) return null;
  const dv = view(body);
  const data = readItem(body, 0x10);
  return { floor: dv.getUint16(4, true), source: 'player', entityIndex: 0xffff, x: dv.getFloat32(8, true), z: dv.getFloat32(12, true), data, id: data.id };
}

// 6x6D: header {6D, 0, client, u32 size, u32 decompressed, u32 compressed} + BC0.
export interface ItemSync {
  nextItemIds: number[]; // per player
  items: FloorItem[];
}
export function parseItemSync(body: Uint8Array): ItemSync | null {
  if (body.length < 0x10) return null;
  const dv = view(body);
  const compressed = dv.getUint32(12, true);
  const d = bc0Decompress(body.subarray(0x10, 0x10 + compressed));
  if (d.length < 0x8c) return null;
  const ddv = view(d);
  const nextItemIds = Array.from({ length: 12 }, (_, i) => ddv.getUint32(0x20 + i * 4, true));
  let count = 0;
  for (let f = 0; f < 15; f++) count += ddv.getUint32(0x50 + f * 4, true);
  const items: FloorItem[] = [];
  for (let i = 0; i < count && 0x8c + (i + 1) * 0x24 <= d.length; i++) {
    const o = 0x8c + i * 0x24;
    const data = readItem(d, o + 0x10);
    items.push({ floor: d[o], source: 'sync', entityIndex: ddv.getUint16(o + 2, true), x: ddv.getFloat32(o + 4, true), z: ddv.getFloat32(o + 8, true), data, id: data.id });
  }
  return { nextItemIds, items };
}

// PlayerInventory items (count, then 0x1C-byte PlayerInventoryItem with ItemData at +8).
export function parseInventoryItems(b: Uint8Array, countOffset: number, itemsOffset: number): ItemData[] {
  const n = Math.min(b[countOffset] ?? 0, 30);
  const out: ItemData[] = [];
  for (let i = 0; i < n && itemsOffset + i * 0x1c + 0x1c <= b.length; i++) out.push(readItem(b, itemsOffset + i * 0x1c + 8));
  return out;
}

// --- Inventory rules (newserv PSOBBCharacterFile / PlayerInventory) -----------

export const SLOT_UNKNOWN = 0;
export const SLOT_MAG = 1;
export const SLOT_ARMOR = 2;
export const SLOT_SHIELD = 3;
export const SLOT_WEAPON = 6;
export const SLOT_UNIT_1 = 9;

export function isEquippable(d: Uint8Array): boolean {
  return d[0] === 0 || d[0] === 2 || (d[0] === 1 && d[1] >= 1 && d[1] <= 3);
}

// ItemData::default_equip_slot
export function defaultEquipSlot(d: Uint8Array): number {
  if (d[0] === 0) return SLOT_WEAPON;
  if (d[0] === 2) return SLOT_MAG;
  if (d[0] === 1) return d[1] === 1 ? SLOT_ARMOR : d[1] === 2 ? SLOT_SHIELD : SLOT_UNIT_1;
  return SLOT_UNKNOWN;
}

function slotMatches(it: InventoryItem, slot: number): boolean {
  const d = it.data.data1;
  if (slot === SLOT_MAG) return d[0] === 2;
  if (slot === SLOT_ARMOR) return d[0] === 1 && d[1] === 1;
  if (slot === SLOT_SHIELD) return d[0] === 1 && d[1] === 2;
  if (slot === SLOT_WEAPON) return d[0] === 0;
  if (slot >= SLOT_UNIT_1 && slot <= SLOT_UNIT_1 + 3) return d[0] === 1 && d[1] === 3 && d[4] === slot - SLOT_UNIT_1;
  return false;
}

export function stackSize(item: ItemData): number {
  return maxStackSize(item) > 1 ? item.data1[5] : 1;
}

function itemKey(d: Uint8Array): string {
  // primary identifier for stack merging (tools: class, type, subtype; disks are never stackable)
  return `${d[0]}:${d[1]}:${d[2]}`;
}

const cloneItem = (i: ItemData): ItemData => ({ data1: i.data1.slice(), id: i.id, data2: i.data2.slice() });

export class InventoryFullError extends Error {}

// The operations newserv applies to the character's inventory, applied to the
// parsed character file (CharacterFile) so the panels show the same thing.
export class InventoryModel {
  readonly c: CharacterFile;
  constructor(c: CharacterFile) {
    this.c = c;
  }

  get items(): InventoryItem[] {
    return this.c.inventory;
  }

  find(id: number): InventoryItem | undefined {
    return this.c.inventory.find((i) => i.data.id === id);
  }

  private reindex(): void {
    this.c.inventory.forEach((it, i) => (it.index = i));
  }

  // PSOBBCharacterFile::add_item
  add(item: ItemData): void {
    const d = item.data1;
    if (d[0] === 4) {
      this.c.meseta = Math.min(this.c.meseta + view(item.data2).getUint32(0, true), 999999);
      return;
    }
    const max = maxStackSize(item);
    if (max > 1) {
      const same = this.c.inventory.find((i) => itemKey(i.data.data1) === itemKey(d));
      if (same) {
        const n = same.data.data1[5] + d[5];
        if (n > max) throw new InventoryFullError('stack is too large');
        same.data.data1[5] = n;
        return;
      }
    }
    if (this.c.inventory.length >= 30) throw new InventoryFullError('inventory is full');
    this.c.inventory.push({ index: this.c.inventory.length, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: cloneItem(item) });
  }

  // PSOBBCharacterFile::remove_item: amount 0 = the whole item / stack.
  remove(id: number, amount = 0): ItemData {
    if (id === MESETA_ITEM_ID) {
      this.c.meseta = Math.max(0, this.c.meseta - amount);
      const data2 = new Uint8Array(4);
      view(data2).setUint32(0, amount, true);
      const data1 = new Uint8Array(12);
      data1[0] = 4;
      return { data1, id: MESETA_ITEM_ID, data2 };
    }
    const index = this.c.inventory.findIndex((i) => i.data.id === id);
    if (index < 0) throw new Error(`no inventory item ${id.toString(16)}`);
    const it = this.c.inventory[index];
    const size = stackSize(it.data);
    if (amount && amount < size) {
      const out = cloneItem(it.data);
      out.data1[5] = amount;
      it.data.data1[5] -= amount;
      return out;
    }
    if (it.equipped) this.unequipIndex(index);
    this.c.inventory.splice(index, 1);
    this.reindex();
    return it.data;
  }

  // PlayerInventory::equip_item_index
  equip(id: number, slot: number): void {
    const it = this.find(id);
    if (!it) return;
    if (slot === SLOT_UNKNOWN || !slotMatchesClass(it, slot)) slot = defaultEquipSlot(it.data.data1);
    const current = this.c.inventory.findIndex((i) => i.equipped && slotMatches(i, slot));
    if (current >= 0) this.unequipIndex(current);
    setEquipped(it, true);
    if (it.data.data1[0] === 1 && it.data.data1[1] === 3) it.data.data1[4] = slot - SLOT_UNIT_1;
  }

  unequip(id: number): void {
    const index = this.c.inventory.findIndex((i) => i.data.id === id);
    if (index >= 0) this.unequipIndex(index);
  }

  // PlayerInventory::unequip_item_index: armor takes the units with it.
  private unequipIndex(index: number): void {
    const it = this.c.inventory[index];
    setEquipped(it, false);
    const d = it.data.data1;
    if (d[0] === 1 && d[1] === 3) d[4] = 0;
    if (d[0] === 1 && d[1] === 1) {
      for (const u of this.c.inventory) {
        if (u.data.data1[0] === 1 && u.data.data1[1] === 3) {
          setEquipped(u, false);
          u.data.data1[4] = 0;
        }
      }
    }
  }

  // First free unit slot (9..12), or slot 9 when all four are taken.
  freeUnitSlot(): number {
    for (let s = SLOT_UNIT_1; s < SLOT_UNIT_1 + 4; s++) if (!this.c.inventory.some((i) => i.equipped && slotMatches(i, s))) return s;
    return SLOT_UNIT_1;
  }
}

function slotMatchesClass(it: InventoryItem, slot: number): boolean {
  const d = it.data.data1;
  if (slot >= SLOT_UNIT_1 && slot <= SLOT_UNIT_1 + 3) return d[0] === 1 && d[1] === 3;
  return slotMatches(it, slot);
}

function setEquipped(it: InventoryItem, on: boolean): void {
  it.equipped = on;
  it.flags = on ? it.flags | 8 : it.flags & ~8;
  it.state = on ? 2 : 1;
}

// Writes the inventory and meseta back into the raw E7 character file
// (PlayerInventory at 0, PlayerDispDataV4.stats.meseta at 0x34C + 0x20).
export function writeCharacterInventory(c: CharacterFile, raw: Uint8Array): void {
  const dv = view(raw);
  raw.fill(0, 4, 4 + 30 * 0x1c);
  raw[0] = c.inventory.length;
  c.inventory.forEach((it, i) => {
    const o = 4 + i * 0x1c;
    raw[o] = it.state;
    raw[o + 2] = it.extensionData1;
    raw[o + 3] = it.extensionData2;
    dv.setUint32(o + 4, it.flags >>> 0, true);
    writeItemData(raw, o + 8, it.data);
  });
  dv.setUint32(0x34c + 0x20, c.meseta, true);
}

// --- Game item state ----------------------------------------------------------

export interface GameItemsOptions {
  character: () => CharacterFile | null; // session.character (updated in place)
  fullCharacter: () => Uint8Array | null; // session.fullCharacter (raw E7, kept in sync)
  log?: (msg: string) => void;
}

interface PendingSplit {
  itemId: number;
  amount: number;
  floor: number;
  x: number;
  z: number;
}

export class GameItems {
  readonly game: Game;
  readonly floorItems = new Map<number, FloorItem>();
  // Other players' inventories by client id (item id -> data), from 65, 6x70,
  // 6x59, 6xBE, 6x29 and 6x2A; needed to show what they drop.
  readonly others = new Map<number, Map<number, ItemData>>();
  // Objects whose box was opened, by object index (all floors).
  readonly openedBoxes = new Set<number>();
  idsAssigned = false;
  onFloorItemAdded: (item: FloorItem) => void = () => {};
  onFloorItemRemoved: (item: FloorItem) => void = () => {};
  onInventoryChanged: () => void = () => {};
  onBoxOpened: (objectIndex: number) => void = () => {};
  private opts: GameItemsOptions;
  private pendingSplits: PendingSplit[] = [];
  private disposed = false;

  constructor(game: Game, opts: GameItemsOptions) {
    this.game = game;
    this.opts = opts;
    game.on('subcommand', (sub, clientId, body) => {
      if (!this.disposed) this.onSubcommand(sub, clientId, body);
    });
    game.on('playerLeft', (id) => this.others.delete(id));
    // 65 carries the joining player's inventory (entry +0x44, item ids
    // already assigned by the server); Game handles 65 itself, so listen on
    // the connection behind it.
    const conn = game.conn;
    const prev = conn.onCommand;
    conn.onCommand = (c: Command) => {
      prev(c);
      if (!this.disposed && game.active && c.command === 0x65 && c.data.length >= 0x0c + 0x520) this.onPlayerEntry(c.data.subarray(0x0c, 0x0c + 0x520));
    };
    // The creator of the game takes the first item ids (newserv
    // Lobby::add_client -> reset_next_item_ids -> assign_inventory_and_bank_item_ids).
    const info = game.info;
    if (info && info.clientId === info.leaderId && game.players.size <= 1) this.assignIds(0x00010000 + 0x00200000 * info.clientId);
  }

  private get character(): CharacterFile | null {
    return this.opts.character();
  }

  get inventory(): InventoryModel | null {
    const c = this.character;
    return c ? new InventoryModel(c) : null;
  }

  private log(msg: string): void {
    this.opts.log?.(`items: ${msg}`);
  }

  private changed(): void {
    const c = this.character;
    const raw = this.opts.fullCharacter();
    if (c && raw && raw.length >= 0x34c + 0x24) writeCharacterInventory(c, raw);
    this.onInventoryChanged();
  }

  private assignIds(first: number): void {
    const c = this.character;
    if (!c) return;
    c.inventory.forEach((it, i) => (it.data.id = (first + i) >>> 0));
    this.idsAssigned = true;
    this.log(`inventory item ids ${first.toString(16)}..${(first + c.inventory.length - 1).toString(16)}`);
    this.changed();
  }

  // Joiners: if no 6x6D came (no leader sync), fall back to the slot's base id.
  ensureIds(): void {
    if (!this.idsAssigned && this.game.info) this.assignIds(0x00010000 + 0x00200000 * this.game.selfId);
  }

  private onPlayerEntry(entry: Uint8Array): void {
    const clientId = view(entry).getUint32(0x1c, true);
    if (clientId === this.game.selfId) return;
    this.others.set(clientId, new Map(parseInventoryItems(entry, 0x44, 0x48).map((d) => [d.id, d])));
  }

  private addFloorItem(item: FloorItem): void {
    if (this.floorItems.has(item.id)) this.removeFloorItem(item.id);
    this.floorItems.set(item.id, item);
    this.onFloorItemAdded(item);
  }

  private removeFloorItem(id: number): FloorItem | undefined {
    const item = this.floorItems.get(id);
    if (!item) return undefined;
    this.floorItems.delete(id);
    this.onFloorItemRemoved(item);
    return item;
  }

  private otherInventory(clientId: number): Map<number, ItemData> {
    let m = this.others.get(clientId);
    if (!m) this.others.set(clientId, (m = new Map()));
    return m;
  }

  private onSubcommand(sub: number, clientId: number, body: Uint8Array): void {
    const dv = view(body);
    const self = this.game.selfId;
    switch (sub) {
      case 0x5f: {
        const it = parseBoxOrEnemyDrop(body);
        if (it) {
          this.addFloorItem(it);
          if (it.source === 'box' && it.entityIndex !== 0xffff) this.markBoxOpened(it.entityIndex);
        }
        break;
      }
      case 0x5d: {
        const it = parseStackedDrop(body);
        if (!it) break;
        this.addFloorItem(it);
        // Our own split: the client deletes the amount with 6x29 after the 6x5D.
        const i = this.pendingSplits.findIndex((p) => p.floor === it.floor && Math.abs(p.x - it.x) < 0.01 && Math.abs(p.z - it.z) < 0.01);
        if (i >= 0) {
          const p = this.pendingSplits.splice(i, 1)[0];
          this.inventory?.remove(p.itemId, p.amount);
          this.game.sendSubcommand(0x29, buildDeleteItem(self, p.itemId, p.amount).subarray(4));
          this.changed();
        }
        break;
      }
      case 0x59: {
        if (body.length < 0x0c) break;
        const picker = dv.getUint16(4, true);
        const itemId = dv.getUint32(8, true);
        const it = this.removeFloorItem(itemId);
        if (!it) break;
        if (picker === self) {
          try {
            this.inventory?.add(it.data);
          } catch (err) {
            this.log(`pickup: ${(err as Error).message}`);
          }
          this.log(`picked up ${itemId.toString(16)}`);
          this.changed();
        } else if (it.data.data1[0] !== 4) {
          this.otherInventory(picker).set(it.id, it.data);
        }
        break;
      }
      case 0x63:
      case 0x5c:
        if (body.length >= 0x0c) this.removeFloorItem(dv.getUint32(4, true));
        break;
      case 0x2a: {
        // Another player dropped a whole item (we add our own drops ourselves).
        if (body.length < 0x18 || clientId === self) break;
        const itemId = dv.getUint32(8, true);
        const inv = this.otherInventory(clientId);
        const data = inv.get(itemId);
        inv.delete(itemId);
        if (!data) {
          this.log(`player ${clientId} dropped unknown item ${itemId.toString(16)}`);
          break;
        }
        this.addFloorItem({ id: itemId, floor: dv.getUint16(6, true), x: dv.getFloat32(12, true), z: dv.getFloat32(20, true), data, source: 'player', entityIndex: 0xffff });
        break;
      }
      case 0x29: {
        if (body.length < 0x0c) break;
        const itemId = dv.getUint32(4, true);
        const amount = dv.getUint32(8, true);
        if (clientId === self) {
          try {
            this.inventory?.remove(itemId, amount);
            this.changed();
          } catch {
            // already removed locally
          }
        } else {
          const inv = this.otherInventory(clientId);
          const data = inv.get(itemId);
          if (data && (!amount || amount >= stackSize(data))) inv.delete(itemId);
          else if (data) data.data1[5] -= amount;
        }
        break;
      }
      case 0xbe: {
        if (body.length < 0x18) break;
        const data = readItem(body, 4);
        if (clientId === self) {
          try {
            this.inventory?.add(data);
          } catch (err) {
            this.log(`6xBE: ${(err as Error).message}`);
          }
          this.changed();
        } else {
          this.otherInventory(clientId).set(data.id, data);
        }
        break;
      }
      case 0x70: {
        if (body.length < 0x4c0) break;
        const id = dv.getUint16(0x08, true);
        if (id !== self) this.others.set(id, new Map(parseInventoryItems(body, 0x164, 0x168).map((d) => [d.id, d])));
        break;
      }
      case 0x6d: {
        const s = parseItemSync(body);
        if (!s) break;
        for (const it of s.items) this.addFloorItem(it);
        if (!this.idsAssigned && self >= 0) this.assignIds(s.nextItemIds[self]);
        this.log(`6x6D: ${s.items.length} floor items, next ids ${s.nextItemIds.slice(0, 4).map((v) => v.toString(16)).join(' ')}`);
        break;
      }
      case 0x0b: {
        // Another player opened a box.
        if (body.length >= 0x0c && clientId >= 0x4000 && dv.getUint32(4, true) & 1) this.markBoxOpened(dv.getUint32(8, true));
        break;
      }
    }
  }

  private markBoxOpened(objectIndex: number): void {
    if (this.openedBoxes.has(objectIndex)) return;
    this.openedBoxes.add(objectIndex);
    this.onBoxOpened(objectIndex);
  }

  // --- actions ---

  // 6x5A. The server answers 6x59 when the pickup is accepted.
  pickUp(item: FloorItem): void {
    this.game.sendSubcommand(0x5a, buildPickUpRequest(this.game.selfId, item.id, item.floor).subarray(4));
  }

  // Drop a whole item (6x2A) or part of a stack / meseta (6xC3).
  drop(itemId: number, amount = 0): void {
    const me = this.game.self;
    const inv = this.inventory;
    if (!me || !inv) return;
    const { x, y, z } = me.position;
    if (itemId === MESETA_ITEM_ID) {
      if (amount <= 0 || amount > (this.character?.meseta ?? 0)) return;
      this.pendingSplits.push({ itemId, amount, floor: me.floor, x, z });
      this.game.sendSubcommand(0xc3, buildSplitStack(this.game.selfId, itemId, amount, me.floor, x, z).subarray(4));
      return;
    }
    const it = inv.find(itemId);
    if (!it) return;
    const size = stackSize(it.data);
    if (amount && amount < size) {
      this.pendingSplits.push({ itemId, amount, floor: me.floor, x, z });
      this.game.sendSubcommand(0xc3, buildSplitStack(this.game.selfId, itemId, amount, me.floor, x, z).subarray(4));
      return;
    }
    this.game.sendSubcommand(0x2a, buildDropItem(this.game.selfId, itemId, me.floor, x, y, z, 1).subarray(4));
    const data = inv.remove(itemId);
    this.addFloorItem({ id: itemId, floor: me.floor, x, z, data, source: 'player', entityIndex: 0xffff });
    this.changed();
  }

  // `slot`: the Equip window's slot (6x25 carries it); without one, units go
  // to the first free unit slot and everything else uses slot 0 (the receiver
  // picks the default slot, as for the Item Pack menu).
  equip(itemId: number, slot?: number): void {
    const inv = this.inventory;
    const it = inv?.find(itemId);
    if (!inv || !it || !isEquippable(it.data.data1)) return;
    const d = it.data.data1;
    slot ??= d[0] === 1 && d[1] === 3 ? inv.freeUnitSlot() : SLOT_UNKNOWN;
    this.game.sendSubcommand(0x25, buildEquip(this.game.selfId, itemId, slot).subarray(4));
    inv.equip(itemId, slot);
    this.changed();
  }

  unequip(itemId: number): void {
    const inv = this.inventory;
    if (!inv?.find(itemId)?.equipped) return;
    this.game.sendSubcommand(0x26, buildUnequip(this.game.selfId, itemId).subarray(4));
    inv.unequip(itemId);
    this.changed();
  }

  // Whether newserv's player_use_item accepts the item (it disconnects on an
  // exception): wrapped items, common consumables (0300..0309 except disks),
  // technique disks the class can learn, grinders with an equipped weapon
  // below its max grind, and the materials. `maxTechLevel(tech)` and
  // `maxGrind()` come from ItemPMT.
  canUse(it: InventoryItem, rules: { maxTechLevel?: (tech: number) => number; maxGrind?: (weapon: ItemData) => number } = {}): boolean {
    const d = it.data.data1;
    if (wrappedFlag(it.data)) return true;
    if (d[0] !== 3) return false;
    if (d[1] < 0x0a && d[1] !== 2) return true;
    if (d[1] === 2) {
      const max = rules.maxTechLevel?.(d[4]);
      return max !== undefined && max !== 0xff && d[2] <= max;
    }
    if (d[1] === 0x0a) {
      const w = this.character?.inventory.find((i) => i.equipped && i.data.data1[0] === 0);
      const max = w ? rules.maxGrind?.(w.data) : undefined;
      return !!w && d[2] <= 2 && max !== undefined && w.data.data1[3] < max;
    }
    if (d[1] === 0x0b) return d[2] <= 6;
    return false;
  }

  // 6x27; applies newserv's player_use_item effects that the panels show.
  use(itemId: number, rules: Parameters<GameItems['canUse']>[1] = {}): void {
    const inv = this.inventory;
    const c = this.character;
    const it = inv?.find(itemId);
    if (!inv || !c || !it || !this.canUse(it, rules)) return;
    this.game.sendSubcommand(0x27, buildUseItem(this.game.selfId, itemId).subarray(4));
    const d = it.data.data1;
    if (wrappedFlag(it.data)) {
      unwrap(it.data);
    } else {
      if (d[1] === 2) c.techLevels[d[4]] = d[2] + 1;
      if (d[1] === 0x0a) {
        const w = c.inventory.find((i) => i.equipped && i.data.data1[0] === 0)!;
        w.data.data1[3] = Math.min(w.data.data1[3] + d[2] + 1, rules.maxGrind?.(w.data) ?? 0xff);
      }
      if (d[1] === 0x0b) {
        const stat = ['atp', 'mst', 'evp', null, null, 'dfp', 'lck'][d[2]] as keyof CharacterFile['stats'] | null;
        if (stat) c.stats[stat] += 2;
      }
      inv.remove(itemId, 1);
    }
    this.changed();
  }

  // Break a box: 6x0B (object state, flag 1) then 6xA2 to the leader.
  openBox(r: BoxRequest): void {
    if (this.openedBoxes.has(r.objectIndex)) return;
    this.game.conn.send(0x60, 0, buildObjectState(r.objectIndex, 1)); // header carries the object's entity id
    this.markBoxOpened(r.objectIndex);
    if (!ITEM_BOX_TYPES.has(r.type)) return;
    this.game.conn.send(0x62, Math.max(0, this.game.leaderId), buildBoxDropRequest(r));
  }

  dispose(): void {
    this.disposed = true;
  }
}

function wrappedFlag(item: ItemData): boolean {
  const d = item.data1;
  if (d[0] === 0 || d[0] === 1) return (d[4] & 0x40) !== 0;
  if (d[0] === 2) return (item.data2[2] & 0x40) !== 0;
  if (d[0] === 3) return maxStackSize(item) === 1 && (d[3] & 0x40) !== 0;
  return false;
}

// ItemData::unwrap
function unwrap(item: ItemData): void {
  const d = item.data1;
  if (d[0] === 0 || d[0] === 1) d[4] &= ~0x40;
  else if (d[0] === 2) item.data2[2] &= ~0x40;
  else if (d[0] === 3) d[3] &= ~0x40;
}
