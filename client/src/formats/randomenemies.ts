// Random enemies and random waves of the challenge quests (Episode 1 challenge,
// quests c88101..c88109): the 'evt2' events section (formats/events.ts) and the
// quest .dat's type 4 (random enemy locations) and type 5 (random enemy
// definitions) sections are turned into the ordinary enemy list and wave events
// of each floor, the same way for every player of a lobby.
//
// The generator is newserv's MapFile::materialize_random_sections
// (vendor/newserv/src/Map.cc:3823, MIT license), which the server runs to number
// the enemies it tracks (SuperMap, Lobby::load_maps, Quest::get_supermap). Kill
// sync needs the same enemies in the same order on both sides, so every draw
// below is made in newserv's order. The seed is the lobby's random seed (the join
// packet's u32 at 0x198, net/game.ts). The exe takes the same value as its
// challenge RNG seed: handle_packet0x64 (refsrc Ghidra dump line 780096) sets
// param_1->rand_seed, which AllocateEp1cmRngState_0080ebb8 feeds to init_rng
// (dump line 868626). The exe's get_random_int (0x00763508, assets.h) is the
// 56-value subtractive generator that newserv's PSOV2 stream (formats/prc.ts
// PsoV2Cipher) also is (ASSUMED equal; the two are not compared bit by bit).
//
// The exe's own path: HandleQuestDat (0x006ba0da) takes only the object, enemy
// and event tables; the challenge tables go through handle_dat_tables_challenge
// (dump line 612602) and Ep1cmDatTablesSetup_0080de90, which generates the spawns
// with unknown_ep1cm_spawn_generator_for_floor (dump line 826420).
//
// Where newserv and the exe differ, the exe's layout wins (see spawnPoint).

import { PsoV2Cipher } from './prc.ts';
import { ENEMY_SET_SIZE, parseEnemySets } from './setdata.ts';
import { isEvt2, parseEvt2File, parseEventFile, type Event2Entry } from './events.ts';
import type { QuestDat, QuestDatFloor } from './questdat.ts';

// newserv Map.cc:3574 RAND_ENEMY_BASE_TYPES: the base type a weight entry's
// base_type_index selects. 0x00E0 is listed twice on purpose (the client does too).
export const RAND_ENEMY_BASE_TYPES: readonly number[] = [
  0x0044, 0x0043, 0x0041, 0x0042, 0x0040, 0x0060, 0x0061, 0x0062, 0x0063, 0x0064, 0x0065, 0x0080, 0x0081, 0x0082, 0x0083,
  0x0084, 0x0085, 0x00a0, 0x00a1, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00d4, 0x00d5, 0x00d6, 0x00d7,
  0x00d8, 0x00d9, 0x00da, 0x00db, 0x00dc, 0x00dd, 0x00de, 0x00df, 0x00e0, 0x00e0, 0x00e1,
];

const LOCATION_SIZE = 0x1c; // newserv RandomEnemyLocation
const ROOM_SIZE = 8; // newserv RandomEnemyRoom
const DEFINITION_SIZE = 0x20; // newserv RandomEnemyDefinition
const WEIGHT_SIZE = 4; // newserv RandomEnemyWeight
const LOCATION_INDEX_CAPACITY = 0x20; // newserv RandomState::location_index_table
const UINT32_MAX_AS_FLOAT = Math.fround(4294967296);

// C++ float arithmetic: every step is rounded to float32.
const f32 = Math.fround;

export interface RandomEnemyDefinition {
  params: [number, number, number, number, number]; // param1..param5 (f32 at 0x00..0x10)
  param7: number; // i16 at 0x14 (the struct's order is switched; see materialize)
  param6: number; // i16 at 0x16
  entryIndex: number;
  minChildren: number;
  maxChildren: number;
}

export interface RandomEnemyWeight {
  baseTypeIndex: number;
  defEntryIndex: number;
  weight: number;
}

export interface RandomEnemyRoom {
  roomId: number;
  count: number;
  offset: number; // bytes from the start of the location entries
}

export interface RandomEnemyLocation {
  pos: [number, number, number];
  angle: [number, number, number];
}

export interface RandomEnemySections {
  rooms: RandomEnemyRoom[];
  locations: RandomEnemyLocation[];
  definitions: RandomEnemyDefinition[];
  weights: RandomEnemyWeight[];
  definitionCount: number;
  weightTotal: number;
}

// Reads the type 4 and type 5 payloads of one floor.
export function parseRandomEnemySections(locations: Uint8Array, definitions: Uint8Array): RandomEnemySections {
  const lv = new DataView(locations.buffer, locations.byteOffset, locations.byteLength);
  const roomTableOffset = lv.getUint32(0, true);
  const entriesOffset = lv.getUint32(4, true);
  const numRooms = lv.getUint32(8, true);
  const rooms: RandomEnemyRoom[] = [];
  for (let i = 0; i < numRooms; i++) {
    const o = roomTableOffset + i * ROOM_SIZE;
    rooms.push({ roomId: lv.getUint16(o, true), count: lv.getUint16(o + 2, true), offset: lv.getUint32(o + 4, true) });
  }
  const locs: RandomEnemyLocation[] = [];
  for (let o = entriesOffset; o + LOCATION_SIZE <= locations.length; o += LOCATION_SIZE) {
    locs.push({
      pos: [lv.getFloat32(o, true), lv.getFloat32(o + 4, true), lv.getFloat32(o + 8, true)],
      angle: [lv.getInt32(o + 0x0c, true), lv.getInt32(o + 0x10, true), lv.getInt32(o + 0x14, true)],
    });
  }

  const dv = new DataView(definitions.buffer, definitions.byteOffset, definitions.byteLength);
  const defsOffset = dv.getUint32(0, true);
  const weightsOffset = dv.getUint32(4, true);
  const defCount = dv.getUint32(8, true);
  const weightCount = dv.getUint32(0x0c, true);
  const defs: RandomEnemyDefinition[] = [];
  for (let i = 0; i < defCount; i++) {
    const o = defsOffset + i * DEFINITION_SIZE;
    defs.push({
      params: [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true), dv.getFloat32(o + 0x0c, true), dv.getFloat32(o + 0x10, true)],
      param7: dv.getInt16(o + 0x14, true),
      param6: dv.getInt16(o + 0x16, true),
      entryIndex: dv.getUint16(o + 0x18, true),
      minChildren: dv.getUint16(o + 0x1c, true),
      maxChildren: dv.getUint16(o + 0x1e, true),
    });
  }
  const weights: RandomEnemyWeight[] = [];
  let weightTotal = 0;
  for (let i = 0; i < weightCount; i++) {
    const o = weightsOffset + i * WEIGHT_SIZE;
    const w = { baseTypeIndex: dv.getUint8(o), defEntryIndex: dv.getUint8(o + 1), weight: dv.getUint8(o + 2) };
    weights.push(w);
    weightTotal += w.weight;
  }
  return { rooms, locations: locs, definitions: defs, weights, definitionCount: defCount, weightTotal };
}

// newserv MapFile::RandomState. The location shuffle has its own stream (seeded
// with 0), so shuffling a room does not move the enemy draws.
class RandomState {
  readonly random: PsoV2Cipher;
  readonly locationRandom = new PsoV2Cipher(0);
  readonly indexTable = new Array<number>(LOCATION_INDEX_CAPACITY).fill(0);
  populated = 0;
  used = 0;
  base = 0; // the room's offset into the location entries

  constructor(seed: number) {
    this.random = new PsoV2Cipher(seed >>> 0);
  }

  // rand_int_biased(min, max): floor((max + 1) * r / 2^32), at least min.
  randIntBiased(min: number, max: number): number {
    const maxF = f32(max + 1);
    const det = f32(this.random.next());
    return Math.max(Math.floor(f32(f32(maxF * det) / UINT32_MAX_AS_FLOAT)), min);
  }

  // generate_shuffled_location_table. A room that has no table leaves the
  // previous one in place, as newserv does.
  shuffleRoom(sections: RandomEnemySections, room: number): void {
    if (sections.rooms.length === 0) throw new Error('no locations defined');
    let lo = 0;
    let hi = sections.rooms.length - 1;
    do {
      const mid = (lo + hi) >> 1;
      if (sections.rooms[mid].roomId < room) lo = mid + 1;
      else hi = mid;
    } while (lo < hi);
    const sec = sections.rooms[lo];
    if (sec.roomId !== room) return;
    if (sec.count > LOCATION_INDEX_CAPACITY) throw new Error(`room ${room} has ${sec.count} locations; the table holds ${LOCATION_INDEX_CAPACITY}`);

    this.populated = sec.count;
    this.used = 0;
    this.base = sec.offset;
    for (let z = 0; z < sec.count; z++) this.indexTable[z] = z;
    for (let z = 0; z < 4; z++) {
      for (let x = 0; x < sec.count; x++) {
        const crypt = this.locationRandom.next();
        const choice = Math.floor(f32(f32(f32(sec.count) * f32(crypt)) / UINT32_MAX_AS_FLOAT));
        const t = this.indexTable[x];
        this.indexTable[x] = this.indexTable[choice];
        this.indexTable[choice] = t;
      }
    }
  }

  nextLocationIndex(): number {
    if (this.used < this.populated) return this.indexTable[this.used++];
    return 0;
  }
}

function findDefinition(sections: RandomEnemySections, entryIndex: number): RandomEnemyDefinition {
  // newserv binary-searches the definitions by entry_index, then checks the hit.
  const defs = sections.definitions;
  let lo = 0;
  let hi = defs.length - 1;
  do {
    const mid = (lo + hi) >> 1;
    if (defs[mid].entryIndex < entryIndex) lo = mid + 1;
    else hi = mid;
  } while (lo < hi);
  const def = defs[lo];
  if (!def || def.entryIndex !== entryIndex) throw new Error(`random enemy definition ${entryIndex} not found`);
  return def;
}

// The spawn point of a generated enemy. newserv reads entries + 0x1C * index and
// ignores the room's own offset; the exe reads the room's section (its spawn
// list starts at the section: ep1cm_shuffle_spawn_list_for_section and
// ep1cm_copy_spawn_point, refsrc dump lines 827090 / 827045), and the format says
// the room offset is bytes from the entries. We follow the exe. Positions do not
// change which enemies exist or their ids, so kill sync holds either way.
function spawnPoint(sections: RandomEnemySections, state: RandomState): RandomEnemyLocation {
  const index = state.nextLocationIndex();
  const at = state.base / LOCATION_SIZE + index;
  const loc = sections.locations[at];
  if (!loc) throw new Error(`random enemy location ${at} is out of range`);
  return loc;
}

interface Event1Out {
  eventId: number;
  flags: number;
  eventType: number;
  room: number;
  wave: number;
  delay: number;
  actionOffset: number;
}

// The enemies (0x48-byte records) and the evt1 events section (with its action
// stream) that the evt2 entries and the random sections make for one floor.
export function materializeEvt2(
  floor: number,
  sections: RandomEnemySections,
  events2: Event2Entry[],
  actionStream: Uint8Array,
  state: RandomState,
): { enemyData: Uint8Array; eventData: Uint8Array } {
  const enemies: Array<{ base: number; numChildren: number; room: number; wave: number; loc: RandomEnemyLocation; def: RandomEnemyDefinition }> = [];
  const events1: Event1Out[] = [];
  const actions: number[] = Array.from(actionStream);

  for (const src of events2) {
    let remainingWaves = state.randIntBiased(1, src.maxWaves);
    let nextEventId = src.eventId >>> 0;
    let waveNumber = src.waveNumber;
    while (remainingWaves > 0) {
      remainingWaves--;
      let remainingEnemies = state.randIntBiased(src.minEnemies, src.maxEnemies);
      state.shuffleRoom(sections, src.room);

      while (remainingEnemies > 0) {
        remainingEnemies--;
        let det = state.randIntBiased(0, sections.weightTotal - 1);
        for (const w of sections.weights) {
          if (det < w.weight) {
            if (w.baseTypeIndex !== 0xff && w.defEntryIndex !== 0xff) {
              if (sections.definitionCount === 0) throw new Error('no available random enemy definitions');
              const base = RAND_ENEMY_BASE_TYPES[w.baseTypeIndex];
              if (base === undefined) throw new Error(`random enemy base type index ${w.baseTypeIndex} is out of range`);
              const def = findDefinition(sections, w.defEntryIndex);
              const numChildren = state.randIntBiased(def.minChildren, def.maxChildren);
              const loc = spawnPoint(sections, state);
              enemies.push({ base, numChildren, room: src.room, wave: waveNumber, loc, def });
            }
            break;
          }
          det -= w.weight;
        }
      }

      if (remainingWaves > 0) {
        events1.push({
          eventId: nextEventId,
          flags: src.flags,
          eventType: src.eventType,
          room: src.room,
          wave: waveNumber,
          delay: state.randIntBiased(src.minDelay, src.maxDelay),
          actionOffset: actions.length,
        });
        // The next wave of this event: trigger_event(id) then stop.
        nextEventId = (src.eventId + waveNumber + 10000) >>> 0;
        actions.push(0x0c, nextEventId & 0xff, (nextEventId >>> 8) & 0xff, (nextEventId >>> 16) & 0xff, (nextEventId >>> 24) & 0xff, 0x01);
        waveNumber++;
      }
    }

    events1.push({
      eventId: nextEventId,
      flags: src.flags,
      eventType: src.eventType,
      room: src.room,
      wave: waveNumber,
      delay: state.randIntBiased(src.minDelay, src.maxDelay),
      actionOffset: src.actionOffset,
    });
    waveNumber++;
  }

  // Enemy records: the layout parseEnemySets reads.
  const enemyData = new Uint8Array(enemies.length * ENEMY_SET_SIZE);
  const edv = new DataView(enemyData.buffer);
  enemies.forEach((e, i) => {
    const o = i * ENEMY_SET_SIZE;
    edv.setUint16(o + 0x00, e.base, true);
    edv.setUint16(o + 0x06, e.numChildren, true);
    edv.setUint16(o + 0x08, floor, true);
    edv.setUint16(o + 0x0c, e.room, true);
    edv.setUint16(o + 0x0e, e.wave, true);
    for (let k = 0; k < 3; k++) {
      edv.setFloat32(o + 0x14 + k * 4, e.loc.pos[k], true);
      edv.setInt32(o + 0x20 + k * 4, e.loc.angle[k], true);
    }
    for (let k = 0; k < 5; k++) edv.setFloat32(o + 0x2c + k * 4, e.def.params[k], true);
    edv.setInt16(o + 0x40, e.def.param6, true);
    edv.setInt16(o + 0x42, e.def.param7, true);
  });

  // Events: the evt1 section (0x10 header, 0x14 entries, then the action stream).
  const eventData = new Uint8Array(0x10 + events1.length * 0x14 + actions.length);
  const evv = new DataView(eventData.buffer);
  evv.setUint32(0x00, 0x10 + events1.length * 0x14, true);
  evv.setUint32(0x04, 0x10, true);
  evv.setUint32(0x08, events1.length, true);
  events1.forEach((e, i) => {
    const o = 0x10 + i * 0x14;
    evv.setUint32(o + 0x00, e.eventId, true);
    evv.setUint16(o + 0x04, e.flags, true);
    evv.setUint16(o + 0x06, e.eventType, true);
    evv.setUint16(o + 0x08, e.room, true);
    evv.setUint16(o + 0x0a, e.wave, true);
    evv.setUint32(o + 0x0c, e.delay, true);
    evv.setUint32(o + 0x10, e.actionOffset, true);
  });
  eventData.set(actions, 0x10 + events1.length * 0x14);

  return { enemyData, eventData };
}

// Materializes one floor of a quest .dat. A floor without an evt2 events section
// is returned as it is and draws nothing. The state is shared by the floors of
// one quest, in floor order (newserv makes one RandomState for the whole map).
export function materializeFloor(f: QuestDatFloor, state: RandomState): QuestDatFloor {
  if (!f.eventData || !isEvt2(f.eventData)) return f;
  if (!f.randomLocations || !f.randomDefinitions) {
    throw new Error('evt2 events without both random enemy sections (types 4 and 5)');
  }
  const evt2 = parseEvt2File(f.eventData);
  const sections = parseRandomEnemySections(f.randomLocations, f.randomDefinitions);
  const { enemyData, eventData } = materializeEvt2(f.floor, sections, evt2.entries, evt2.actionStream, state);
  return {
    ...f,
    enemies: parseEnemySets(enemyData).map((e) => ({ ...e, floor: f.floor })),
    enemyBytes: enemyData,
    events: parseEventFile(eventData),
    eventData,
  };
}

// The whole quest .dat with its random-wave floors materialized for a seed. A
// floor that cannot be materialized keeps its (empty) enemy list and the reason
// goes into the warnings.
export function materializeQuestDat(dat: QuestDat, seed: number): QuestDat {
  const floors = new Map<number, QuestDatFloor>();
  const warnings = [...dat.warnings];
  const state = new RandomState(seed);
  for (const [n, f] of [...dat.floors].sort((a, b) => a[0] - b[0])) {
    try {
      floors.set(n, materializeFloor(f, state));
    } catch (err) {
      floors.set(n, f);
      warnings.push(`floor ${n}: random enemies: ${(err as Error).message}`);
    }
  }
  return { chunks: dat.chunks, floors, warnings };
}
