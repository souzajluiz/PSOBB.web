// Quest set data file (<quest>.dat): the quest's own objects, enemies and wave
// events for the floors it overrides.
//
// Unlike a free-play map file (formats/setdata.ts), which is a bare array of
// fixed-size records for one floor, the quest .dat is a stream of typed chunks
// covering every floor the quest touches. The client walks it in
// HandleQuestDat (PsoBB.exe 0x006ba0da, headers/quests.h): for each floor
// 0..0x11 it takes the chunks whose floor matches and appends them to the
// floor's object / enemy / event lists, unless the floor's designation type is
// 1 or 2 (then the free-play assets of the designated map are loaded instead).
//
// Chunk header (headers/quests.h quest_dat_chunk, cross-checked against
// newserv src/Map.hh MapFile::SectionHeader, MIT license):
//   00 u32 type         0 = end, 1 = objects, 2 = enemies, 3 = events,
//                       4 = random enemy locations, 5 = random enemy definitions
//   04 u32 section_size size of this chunk INCLUDING the 0x10 header
//   08 u32 floor        0..0x11
//   0C u32 data_size    size of the payload
//   10 payload[data_size]
//
// Record sizes are the same as free play: 0x44 per object, 0x48 per enemy; the
// events payload is byte-for-byte an .evt file (formats/events.ts), with its
// offsets relative to the start of the payload.
//
// Types 4 and 5 only appear in the challenge quests that place enemies randomly
// (the 'evt2' event format goes with them; newserv Map.hh RandomEnemyLocations /
// RandomEnemyDefinitions). Their payloads are kept per floor here and turned
// into enemies and wave events by formats/randomenemies.ts once the game's
// random seed is known.

import { parseEventFile, type EventFile } from './events.ts';
import { ENEMY_SET_SIZE, OBJECT_SET_SIZE, parseEnemySets, parseObjectSets, type EnemySet, type ObjectSet } from './setdata.ts';

export const QUEST_DAT_CHUNK_HEADER_SIZE = 0x10;

const EMPTY = new Uint8Array(0);

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b.slice();
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export const QuestDatChunkType = {
  End: 0,
  Objects: 1,
  Enemies: 2,
  Events: 3,
  RandomEnemyLocations: 4,
  RandomEnemyDefinitions: 5,
} as const;

export interface QuestDatChunk {
  type: number;
  floor: number;
  offset: number; // of the chunk header in the file
  size: number; // including the header
  data: Uint8Array; // the payload
}

// Everything one floor of the quest brings with it.
export interface QuestDatFloor {
  floor: number;
  objects: ObjectSet[];
  enemies: EnemySet[];
  events: EventFile | null;
  // The raw payloads, concatenated in chunk order. They are byte-for-byte what
  // a free-play o.dat / e.dat / .evt holds, so anything that reads those files
  // (formats/objset.ts, render/gamefield.ts) can take these instead.
  objectBytes: Uint8Array;
  enemyBytes: Uint8Array;
  eventData: Uint8Array | null;
  randomEnemies: boolean; // a type 4 / 5 chunk is present
  // The random enemy sections' payloads (formats/randomenemies.ts reads them).
  randomLocations: Uint8Array | null; // type 4
  randomDefinitions: Uint8Array | null; // type 5
}

export interface QuestDat {
  chunks: QuestDatChunk[];
  floors: Map<number, QuestDatFloor>;
  warnings: string[];
}

export function parseQuestDatChunks(data: Uint8Array): QuestDatChunk[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: QuestDatChunk[] = [];
  let at = 0;
  while (at + QUEST_DAT_CHUNK_HEADER_SIZE <= data.length) {
    const type = dv.getUint32(at, true);
    if (type === QuestDatChunkType.End) break;
    const size = dv.getUint32(at + 4, true);
    const floor = dv.getUint32(at + 8, true);
    const dataSize = dv.getUint32(at + 12, true);
    if (size < QUEST_DAT_CHUNK_HEADER_SIZE || at + size > data.length) {
      throw new Error(`quest .dat chunk at 0x${at.toString(16)} has size ${size} (file has ${data.length - at} bytes left)`);
    }
    if (dataSize > size - QUEST_DAT_CHUNK_HEADER_SIZE) {
      throw new Error(`quest .dat chunk at 0x${at.toString(16)} claims ${dataSize} payload bytes in a ${size}-byte chunk`);
    }
    out.push({ type, floor, offset: at, size, data: data.subarray(at + QUEST_DAT_CHUNK_HEADER_SIZE, at + QUEST_DAT_CHUNK_HEADER_SIZE + dataSize) });
    at += size;
  }
  return out;
}

function floorOf(floors: Map<number, QuestDatFloor>, floor: number): QuestDatFloor {
  let f = floors.get(floor);
  if (!f) {
    floors.set(floor, (f = { floor, objects: [], enemies: [], events: null, objectBytes: EMPTY, enemyBytes: EMPTY, eventData: null, randomEnemies: false, randomLocations: null, randomDefinitions: null }));
  }
  return f;
}

export function parseQuestDat(data: Uint8Array): QuestDat {
  const chunks = parseQuestDatChunks(data);
  const floors = new Map<number, QuestDatFloor>();
  const warnings: string[] = [];
  for (const c of chunks) {
    const where = `chunk at 0x${c.offset.toString(16)} (floor ${c.floor})`;
    switch (c.type) {
      case QuestDatChunkType.Objects: {
        if (c.data.length % OBJECT_SET_SIZE) {
          warnings.push(`${where}: ${c.data.length} object bytes is not a multiple of 0x44`);
          break;
        }
        // The DAT's own floor field in each record is not always filled in;
        // the chunk's floor is what HandleQuestDat uses.
        const objects = parseObjectSets(c.data).map((o) => ({ ...o, floor: c.floor }));
        const f = floorOf(floors, c.floor);
        f.objects.push(...objects);
        f.objectBytes = concatBytes(f.objectBytes, c.data);
        break;
      }
      case QuestDatChunkType.Enemies: {
        if (c.data.length % ENEMY_SET_SIZE) {
          warnings.push(`${where}: ${c.data.length} enemy bytes is not a multiple of 0x48`);
          break;
        }
        const enemies = parseEnemySets(c.data).map((e) => ({ ...e, floor: c.floor }));
        const f = floorOf(floors, c.floor);
        f.enemies.push(...enemies);
        f.enemyBytes = concatBytes(f.enemyBytes, c.data);
        break;
      }
      case QuestDatChunkType.Events: {
        const f = floorOf(floors, c.floor);
        f.eventData = c.data;
        try {
          f.events = parseEventFile(c.data);
        } catch (err) {
          warnings.push(`${where}: ${(err as Error).message}`);
        }
        break;
      }
      case QuestDatChunkType.RandomEnemyLocations: {
        const f = floorOf(floors, c.floor);
        f.randomEnemies = true;
        f.randomLocations = c.data;
        break;
      }
      case QuestDatChunkType.RandomEnemyDefinitions: {
        const f = floorOf(floors, c.floor);
        f.randomEnemies = true;
        f.randomDefinitions = c.data;
        break;
      }
      default:
        warnings.push(`${where}: unknown chunk type ${c.type}`);
    }
  }
  // Re-index each floor's entries from 0, as the client does when it appends
  // them to the floor's lists (AssignMapObjectIds / AssignEnemyIds,
  // PsoBB.exe 0x0080eda0 / 0x0080ee4c).
  for (const f of floors.values()) {
    f.objects = f.objects.map((o, i) => ({ ...o, index: i }));
    f.enemies = f.enemies.map((e, i) => ({ ...e, index: i }));
  }
  return { chunks, floors, warnings };
}
