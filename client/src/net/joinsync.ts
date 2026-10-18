// Join sync: the game state the leader sends a joining player and the tables
// the joiner applies it to, following PsoBB.exe (Ephinea 1.25.13). Pure data
// (no three.js, no network) so it runs in Node tests; net/game.ts owns one
// JoinSyncState per game and sends / receives the commands, render/gamefield.ts
// exports and imports the per-floor parts (set flags, wave events, switches).
//
// Leader (unknown_player_join_party, the 65 handler just before 0x0079cb0c,
// when g_CurrentPlayerSlotIndex == g_PartyLeaderIdx), in this order, each to
// the joiner (6D / 62 with the joiner's client id):
//   6x6D  SendPacket0x6D_Subcommand0x6D_0079cc64 (item state, net/game.ts)
//   6x6B  g_SavedEnemyStatusData, entity_index_count entries of 0x0C
//   6x6C  g_SavedBoxStatusData, g_EntityIndexCounter_Quest entries of 4
//   6x6E  send_packet0x6d_subcommand0x6e (the copy of
//         BuildAndSendPacket0x6E_0079cd2c): set flags, event flags and
//         switch flags
//   6x6F  send_packet0x60_subcommand0x6f (the copy of
//         SendQuestGlobalFlags_0079ce28): the quest flags
//   6x71  send_packet0x60_subcommand0x71
// then every player sends its own 6x70 (net/game.ts buildPlayerSync).
//
// 6x6B / 6x6C / 6x6E share G_SyncGameStateHeader (newserv CommandFormats.hh):
// {sub, 0, u16 0, u32 size, u32 decompressed size, u32 compressed size} and
// the compressed data. PacketCompressor_Compress_007a47dc writes the two sizes
// at +8 / +0x0C and returns compressed + 8; the size field is
// ((that + 3) & ~3) + 8. The exe's compressor is an LZSS; the web client sends
// a literal-only stream of the same format (net/game.ts bc0Encode), which the
// receivers (unknown_packet_6D_processing 0x007a59d4 and newserv
// bc0_decompress) read the same way.
//
// Tables (reset_box_enemy_rare_status, called when a game is entered):
//   g_SavedEnemyStatusData  0xB50 x {u32 flags, u16 item drop id, u16 damage
//                           taken, red buff type / level, blue buff type /
//                           level}; flags and damage zero, the drop id
//                           0x100 + 0xBA0 + i (the counter runs on from the
//                           box table)
//   g_SavedBoxStatusData    0xBA0 x {u16 flags ("was_hit"), u16 item drop
//                           id}; drop id 0x100 + i
// They follow the commands:
//   - 6x0A sent (prepare_send_packet0x60_subcommand0xa) and received
//     (action_hit_enemy): flags and damage of the enemy's slot. In Ultimate
//     the received flags keep the slot's low 6 bits (those ride in 6x9C);
//   - 6x0B (handle_packet0x60_0xb_box_break, and the senders such as
//     box_get_hit): the object's flags at +4;
//   - 6x5F (handle_packet0x60_subcommand0x5f): the drop id becomes 0xFFFF
//     (from an enemy: the u32 store `last_attacker_idx | 0xffff` leaves the
//     damage as it was).
// The enemy constructors (reset_enemy_damage_taken) zero flags and damage
// of their slot again, so on the joiner only the buffs and the drop id of
// 6x6B matter; which enemies are dead comes from the set flags of 6x6E.
//
// 6x6E decompressed (G_SyncSetFlagState_6x6E_Decompressed), built in a
// 0x4008 buffer:
//   00 u16 total size (= the next three)   02 u16 entity set flags size
//   04 u16 event flags size                 06 u16 switch flags size
//   08 entity set flags (CollectMapObjectAndMonsterFlags_008123f0):
//        {u32 0x10, u32 objects, u32 objects * 2 + 0x10, u32 enemy sets},
//        then flags & 0xFFFD of every object init entry (g_p_object_list,
//        0xBA0, nId != -1) and every enemy set entry
//        (g_MonsterInitData_00aaff60, 0x5A8, type != invalid), all floors in
//        order; its size is CalculateTotalObjectCountForPacket_00812480:
//        (objects + enemy sets) * 2 + 0x10
//   .. event flags (AggregateMapEventIds_0080d32c): flags & 0xFFFD of every
//        wave event of the floors' tables 0..0x11 (g_MapEventTablesArray),
//        file order
//   .. switch flags (CopyFloorSwitchesBitmap_00816fac): 0x240 bytes, 0x20 a
//        floor, flag f at byte f >> 3, bit 0x80 >> (f & 7)
// The compressor is given `total size` bytes from the start of the buffer, so
// the 8-byte head pushes the last 8 switch bytes out (the bug newserv's
// ReceiveSubcommands.cc describes); the joiner's
// HandleLobbyMonsterMapStateUpdate_0079fd30 copies them out of its fresh
// 0x4008 buffer anyway (ASSUMED zero here: the exe's buffer is not cleared).
// Bit 2 ("built") is masked out; set flag 8 of an enemy set = dead,
// object flags 0x01 / 0x10 = constructed (the floor loader 0x008129b0 builds
// a delayed object then), event flags 4 / 8 / 0x10 as render/waves.ts.
// The joiner applies them with copy_monster_object_init_flags,
// copy_map_event_flags and copy_floor_switches, then set_active_map_events.
//
// 6x6F (G_SetQuestFlags_BB_6x6F, 0x208): {6F, 0x82, u16 0}, the 0x200 bytes
// of g_QuestGlobalFlags (0x00a95680: 0x80 per difficulty, flag f at byte
// f >> 3, bit 0x80 >> (f & 7); SetQuestGFlag_006bb130), u32 1. The handler
// (HandleLobbyQuestFlagsUpdate_0079feb4) copies the whole table when that u32
// is not 1, and otherwise (SetQuestGlobalFlags_006bb55c) only the flags of the
// zero-terminated list at 0x00969c60 (QUEST_FLAG_APPLY_LIST), in every
// difficulty.

import { bc0Decompress } from './items.ts';

export const MAX_ENEMY_SLOTS = 0xb50;
export const MAX_OBJECTS = 0xba0;
export const MAX_ENEMY_SETS = 0x5a8;
export const ENEMY_STATUS_SIZE = 0x0c;
export const BOX_STATUS_SIZE = 4;
export const SWITCH_FLAG_BYTES = 0x240; // 0x12 floors x 0x20
export const QUEST_FLAG_TABLE_BYTES = 0x200; // 4 difficulties x 0x80
const SET_FLAG_BUILT = 0x02;
const BUFFER_6X6E = 0x4008;

// The flags 6x6F overwrites on the receiver (0x00969c60, 283 entries, read
// with tools/exedata.py; the same set as newserv's BB_QUEST_FLAG_APPLY_MASK).
const APPLY_RANGES: ReadonlyArray<readonly [number, number]> = [
  [10, 26], [30, 34], [40, 55], [70, 99], [151, 154], [301, 309], [320, 390],
  [401, 414], [420, 440], [450, 470], [500, 565], [701, 708],
];
export const QUEST_FLAG_APPLY_LIST: readonly number[] = APPLY_RANGES.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));

// Entity counts of the game (all floors), what the leader's tables hold.
export interface SyncCounts {
  enemySlots: number; // entity_index_count
  objects: number; // g_EntityIndexCounter_Quest
  enemySets: number; // enemy set entries with a type
  events: number; // wave events of all floor tables
}

// G_SyncGameStateHeader_6x6B_6x6C_6x6D_6x6E + compressed data, padded to 4.
export function bc0Encode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 8) {
    const n = Math.min(8, data.length - i);
    out.push((1 << n) - 1);
    for (let k = 0; k < n; k++) out.push(data[i + k]);
  }
  return new Uint8Array(out);
}

export function syncStateCommand(sub: number, decompressed: Uint8Array): Uint8Array {
  const compressed = bc0Encode(decompressed);
  const size = ((compressed.length + 8 + 3) & ~3) + 8;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = sub;
  out[1] = 0; // extended header
  dv.setUint32(4, size, true);
  dv.setUint32(8, decompressed.length, true);
  dv.setUint32(12, compressed.length, true);
  out.set(compressed, 0x10);
  return out;
}

// The decompressed data of a 6x6B / 6x6C / 6x6E (or null when malformed).
export function syncStateData(body: Uint8Array): Uint8Array | null {
  if (body.length < 0x10) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const compressed = dv.getUint32(12, true);
  if (0x10 + compressed > body.length) return null;
  return bc0Decompress(body.subarray(0x10, 0x10 + compressed));
}

export const questFlagGet = (table: Uint8Array, difficulty: number, flag: number): boolean =>
  !!(table[difficulty * 0x80 + (flag >> 3)] & (0x80 >> (flag & 7)));
export function questFlagSet(table: Uint8Array, difficulty: number, flag: number, set: boolean): void {
  const i = difficulty * 0x80 + (flag >> 3);
  const mask = 0x80 >> (flag & 7);
  if (set) table[i] |= mask;
  else table[i] &= ~mask;
}

export class JoinSyncState {
  readonly enemyStatus = new Uint8Array(MAX_ENEMY_SLOTS * ENEMY_STATUS_SIZE); // g_SavedEnemyStatusData
  readonly boxStatus = new Uint8Array(MAX_OBJECTS * BOX_STATUS_SIZE); // g_SavedBoxStatusData
  // Set flags by global index (all floors in order), as the joiner received
  // them or as render/gamefield.ts exported them.
  readonly objectSetFlags = new Uint16Array(MAX_OBJECTS);
  readonly enemySetFlags = new Uint16Array(MAX_ENEMY_SETS);
  readonly eventFlags = new Uint16Array(BUFFER_6X6E / 2);
  readonly switchFlags = new Uint8Array(SWITCH_FLAG_BYTES); // g_FloorSwitchesBitmap_00ac9fa0
  readonly questFlags = new Uint8Array(QUEST_FLAG_TABLE_BYTES); // g_QuestGlobalFlags
  // What the last 6x6B / 6x6C / 6x6E carried (the joiner's entity_index_count
  // and g_EntityIndexCounter_Quest; -1 until received).
  received = { enemySlots: -1, objects: -1, enemySets: -1, events: -1, setFlags: false };
  private esv: DataView;
  private bsv: DataView;

  constructor() {
    this.esv = new DataView(this.enemyStatus.buffer);
    this.bsv = new DataView(this.boxStatus.buffer);
    this.reset();
  }

  // reset_box_enemy_rare_status.
  reset(): void {
    this.boxStatus.fill(0);
    for (let i = 0; i < MAX_OBJECTS; i++) this.bsv.setUint16(i * 4 + 2, 0x100 + i, true);
    this.enemyStatus.fill(0);
    for (let i = 0; i < MAX_ENEMY_SLOTS; i++) this.esv.setUint16(i * 12 + 4, (0x100 + MAX_OBJECTS + i) & 0xffff, true);
    this.objectSetFlags.fill(0);
    this.enemySetFlags.fill(0);
    this.eventFlags.fill(0);
    this.switchFlags.fill(0);
    this.received = { enemySlots: -1, objects: -1, enemySets: -1, events: -1, setFlags: false };
  }

  enemyFlags(slot: number): number {
    return slot >= 0 && slot < MAX_ENEMY_SLOTS ? this.esv.getUint32(slot * 12, true) : 0;
  }
  enemyDamage(slot: number): number {
    return slot >= 0 && slot < MAX_ENEMY_SLOTS ? this.esv.getUint16(slot * 12 + 6, true) : 0;
  }
  enemyDropId(slot: number): number {
    return slot >= 0 && slot < MAX_ENEMY_SLOTS ? this.esv.getUint16(slot * 12 + 4, true) : 0;
  }
  objectFlags(index: number): number {
    return index >= 0 && index < MAX_OBJECTS ? this.bsv.getUint16(index * 4, true) : 0;
  }
  objectDropId(index: number): number {
    return index >= 0 && index < MAX_OBJECTS ? this.bsv.getUint16(index * 4 + 2, true) : 0;
  }

  // A 6x0A for the enemy in `slot` (0x1000 + slot is its entity id): sent by
  // us (prepare_send_packet0x60_subcommand0xa stores the full flags) or
  // received (action_hit_enemy: in Ultimate the low 6 bits stay).
  recordEnemyState(slot: number, flags: number, damage: number, received: boolean, ultimate: boolean): void {
    if (slot < 0 || slot >= MAX_ENEMY_SLOTS) return;
    const f = received && ultimate ? (this.enemyFlags(slot) & 0x3f) | (flags & ~0x3f) : flags;
    this.esv.setUint32(slot * 12, f >>> 0, true);
    this.esv.setUint16(slot * 12 + 6, damage & 0xffff, true);
  }

  // 6x0B: the object's state flags.
  recordObjectState(index: number, flags: number): void {
    if (index < 0 || index >= MAX_OBJECTS) return;
    this.bsv.setUint16(index * 4, flags & 0xffff, true);
  }

  // 6x5F: the enemy slot's or object's drop is used up.
  recordDrop(fromEnemy: boolean, index: number): void {
    if (fromEnemy) {
      if (index >= 0 && index < MAX_ENEMY_SLOTS) this.esv.setUint16(index * 12 + 4, 0xffff, true);
    } else if (index >= 0 && index < MAX_OBJECTS) this.bsv.setUint16(index * 4 + 2, 0xffff, true);
  }

  // --- the leader's commands ---

  build6x6B(enemySlots: number): Uint8Array {
    return syncStateCommand(0x6b, this.enemyStatus.slice(0, Math.min(enemySlots, MAX_ENEMY_SLOTS) * ENEMY_STATUS_SIZE));
  }

  build6x6C(objects: number): Uint8Array {
    return syncStateCommand(0x6c, this.boxStatus.slice(0, Math.min(objects, MAX_OBJECTS) * BOX_STATUS_SIZE));
  }

  // The 6x6E data in its 0x4008 buffer and the size the exe compresses.
  build6x6EData(counts: SyncCounts): { buffer: Uint8Array; size: number } {
    const buf = new Uint8Array(BUFFER_6X6E);
    const dv = new DataView(buf.buffer);
    const objects = Math.min(counts.objects, MAX_OBJECTS);
    const sets = Math.min(counts.enemySets, MAX_ENEMY_SETS);
    let o = 8;
    dv.setUint32(o, 0x10, true);
    dv.setUint32(o + 4, objects, true);
    dv.setUint32(o + 8, objects * 2 + 0x10, true);
    dv.setUint32(o + 12, sets, true);
    o += 0x10;
    for (let i = 0; i < objects; i++, o += 2) dv.setUint16(o, this.objectSetFlags[i] & ~SET_FLAG_BUILT, true);
    for (let i = 0; i < sets; i++, o += 2) dv.setUint16(o, this.enemySetFlags[i] & ~SET_FLAG_BUILT, true);
    const entitySize = (objects + sets) * 2 + 0x10;
    const events = Math.min(counts.events, (BUFFER_6X6E - 8 - entitySize - SWITCH_FLAG_BYTES) >> 1);
    for (let i = 0; i < events; i++, o += 2) dv.setUint16(o, this.eventFlags[i] & ~SET_FLAG_BUILT, true);
    buf.set(this.switchFlags, o);
    const total = entitySize + events * 2 + SWITCH_FLAG_BYTES;
    dv.setUint16(0, total, true);
    dv.setUint16(2, entitySize, true);
    dv.setUint16(4, events * 2, true);
    dv.setUint16(6, SWITCH_FLAG_BYTES, true);
    return { buffer: buf, size: total };
  }

  build6x6E(counts: SyncCounts): Uint8Array {
    const { buffer, size } = this.build6x6EData(counts);
    return syncStateCommand(0x6e, buffer.slice(0, size));
  }

  build6x6F(): Uint8Array {
    const out = new Uint8Array(0x208);
    out[0] = 0x6f;
    out[1] = 0x82;
    out.set(this.questFlags, 4);
    new DataView(out.buffer).setUint32(0x204, 1, true);
    return out;
  }

  // --- the joiner's handlers ---

  // HandleLobbyPartyStateUpdate_0079fba4 (6x6B).
  apply6x6B(body: Uint8Array): number {
    const d = syncStateData(body);
    if (!d) return -1;
    const n = Math.min(Math.floor(d.length / ENEMY_STATUS_SIZE), MAX_ENEMY_SLOTS);
    this.enemyStatus.set(d.subarray(0, n * ENEMY_STATUS_SIZE));
    this.received.enemySlots = n;
    return n;
  }

  // HandleLobbyBoxStatusUpdate_0079fc30 (6x6C).
  apply6x6C(body: Uint8Array): number {
    const d = syncStateData(body);
    if (!d) return -1;
    const n = Math.min(d.length >> 2, MAX_OBJECTS);
    this.boxStatus.set(d.subarray(0, n * BOX_STATUS_SIZE));
    this.received.objects = n;
    return n;
  }

  // HandleLobbyMonsterMapStateUpdate_0079fd30 (6x6E). The exe copies by its
  // own tables' counts; here the counts come from the command.
  apply6x6E(body: Uint8Array): boolean {
    const raw = syncStateData(body);
    if (!raw || raw.length < 8) return false;
    const d = new Uint8Array(BUFFER_6X6E);
    d.set(raw.subarray(0, Math.min(raw.length, BUFFER_6X6E)));
    const dv = new DataView(d.buffer);
    const entitySize = dv.getUint16(2, true);
    const eventSize = dv.getUint16(4, true);
    const switchSize = dv.getUint16(6, true);
    const e = 8;
    if (entitySize >= 0x10) {
      const objOffset = dv.getUint32(e, true);
      const objects = Math.min(dv.getUint32(e + 4, true), MAX_OBJECTS);
      const setOffset = dv.getUint32(e + 8, true);
      const sets = Math.min(dv.getUint32(e + 12, true), MAX_ENEMY_SETS);
      for (let i = 0; i < objects && e + objOffset + i * 2 + 2 <= BUFFER_6X6E; i++) this.objectSetFlags[i] = dv.getUint16(e + objOffset + i * 2, true);
      for (let i = 0; i < sets && e + setOffset + i * 2 + 2 <= BUFFER_6X6E; i++) this.enemySetFlags[i] = dv.getUint16(e + setOffset + i * 2, true);
      this.received.objects = Math.max(this.received.objects, objects);
      this.received.enemySets = sets;
    }
    const ev = e + entitySize;
    const events = Math.min(eventSize >> 1, this.eventFlags.length);
    for (let i = 0; i < events && ev + i * 2 + 2 <= BUFFER_6X6E; i++) this.eventFlags[i] = dv.getUint16(ev + i * 2, true);
    this.received.events = events;
    const sw = ev + eventSize;
    const n = Math.min(switchSize, SWITCH_FLAG_BYTES, BUFFER_6X6E - sw);
    if (n > 0) this.switchFlags.set(d.subarray(sw, sw + n));
    this.received.setFlags = true;
    return true;
  }

  // HandleLobbyQuestFlagsUpdate_0079feb4 (6x6F).
  apply6x6F(body: Uint8Array): boolean {
    if (body.length < 0x204) return false;
    const table = body.subarray(4, 4 + QUEST_FLAG_TABLE_BYTES);
    const mask = body.length >= 0x208 ? new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0x204, true) : 0;
    if (mask !== 1) {
      this.questFlags.set(table);
      return true;
    }
    for (let d = 0; d < 4; d++) {
      for (const f of QUEST_FLAG_APPLY_LIST) questFlagSet(this.questFlags, d, f, questFlagGet(table, d, f));
    }
    return true;
  }

  // Switch flag f of a floor (g_FloorSwitchesBitmap_00ac9fa0).
  switchFlag(floor: number, flag: number): boolean {
    if (floor < 0 || floor >= 0x12 || flag < 0 || flag >= 0x100) return false;
    return !!(this.switchFlags[floor * 0x20 + (flag >> 3)] & (0x80 >> (flag & 7)));
  }
  setSwitchFlag(floor: number, flag: number, set: boolean): void {
    if (floor < 0 || floor >= 0x12 || flag < 0 || flag >= 0x100) return;
    const i = floor * 0x20 + (flag >> 3);
    const mask = 0x80 >> (flag & 7);
    if (set) this.switchFlags[i] |= mask;
    else this.switchFlags[i] &= ~mask;
  }
}

// What the join sync needs to know about one floor's set data: its objects
// (room and group decide construct_objects), the first enemy slot of every
// enemy set entry (6x76 names a set entry by its head slot's entity id), and
// its wave event ids, plus where the floor starts in the game-wide tables.
export interface SyncFloor {
  floor: number;
  objects: ReadonlyArray<{ section: number; group: number }>;
  setFirstSlots: readonly number[];
  enemySlots: number;
  eventIds: readonly number[];
  objectBase: number;
  enemySetBase: number;
  enemySlotBase: number;
  eventBase: number;
}

export interface SyncLayout {
  floors: SyncFloor[]; // floors 0..0x11 (the exe's per-floor tables)
  counts: SyncCounts;
}

// The game-wide layout from each floor's entities, in floor order (the exe
// loads every floor's set data when the game starts).
export function buildSyncLayout(
  floors: ReadonlyArray<Pick<SyncFloor, 'floor' | 'objects' | 'setFirstSlots' | 'enemySlots' | 'eventIds'>>,
): SyncLayout {
  const out: SyncFloor[] = [];
  const counts: SyncCounts = { enemySlots: 0, objects: 0, enemySets: 0, events: 0 };
  for (const f of floors) {
    out.push({ ...f, objectBase: counts.objects, enemySetBase: counts.enemySets, enemySlotBase: counts.enemySlots, eventBase: counts.events });
    counts.objects += f.objects.length;
    counts.enemySets += f.setFirstSlots.length;
    counts.enemySlots += f.enemySlots;
    counts.events += f.eventIds.length;
  }
  return { floors: out, counts };
}
