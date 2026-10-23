// Quest editor: the byte side of the .dat. Turns the editor's entity lists, wave
// events and untouched chunks back into a quest .dat (the inverse of
// formats/questdat.ts and formats/events.ts), so an edited quest can be parsed
// again with parseQuestDat and handed to the writer.
//
// Layouts: formats/setdata.ts (0x44 per object, 0x48 per enemy), formats/events.ts
// (header 0x10, entries 0x14, action stream), formats/questdat.ts (chunk header
// 0x10). Fields the client fills in at run time (set flags, entity ids, the
// client pointer) are written as zero.

import { parseActions, type EventAction, type WaveEvent } from '../formats/events.ts';
import { QUEST_DAT_CHUNK_HEADER_SIZE, QuestDatChunkType } from '../formats/questdat.ts';
import { ENEMY_SET_SIZE, OBJECT_SET_SIZE, parseEnemySets, parseObjectSets, type EnemySet, type ObjectSet } from '../formats/setdata.ts';

// The record writers. A record read from the file (SetEntryBase.raw) starts from
// its own bytes, and a field is written only when its value differs from the
// one the record was read with, so the bytes the editor does not model (the
// unknown u16s of the 0x44 and 0x48 records) survive an edit. A new record
// starts from zeros. The floor is compared with the chunk floor the record was
// read under (homeFloor): the record's own floor field is not always filled in.
type FieldKind = 'u8' | 'u16' | 'i16' | 'i32' | 'f32';

function putField(dv: DataView, off: number, kind: FieldKind, value: number, base: number | undefined): void {
  if (base !== undefined && Object.is(value, base)) return;
  if (kind === 'u8') dv.setUint8(off, value);
  else if (kind === 'u16') dv.setUint16(off, value, true);
  else if (kind === 'i16') dv.setInt16(off, value, true);
  else if (kind === 'i32') dv.setInt32(off, value, true);
  else dv.setFloat32(off, value, true);
}

function recordBase<T>(raw: Uint8Array | undefined, size: number, parse: (data: Uint8Array) => T[]): { out: Uint8Array; base: T | undefined } {
  if (raw && raw.length === size) return { out: raw.slice(), base: parse(raw)[0] };
  return { out: new Uint8Array(size), base: undefined };
}

export function serializeObjectSet(o: ObjectSet): Uint8Array {
  const { out, base } = recordBase(o.raw, OBJECT_SET_SIZE, parseObjectSets);
  const dv = new DataView(out.buffer);
  const b = base as ObjectSet | undefined;
  const floorBase = o.homeFloor ?? b?.floor;
  putField(dv, 0x00, 'u16', o.type, b?.type);
  putField(dv, 0x06, 'u16', o.floor, floorBase);
  putField(dv, 0x0a, 'u16', o.group, b?.group);
  putField(dv, 0x0c, 'u16', o.section, b?.section);
  putField(dv, 0x0e, 'u16', o.unknownA3, b?.unknownA3);
  for (let i = 0; i < 3; i++) {
    putField(dv, 0x10 + i * 4, 'f32', o.position[i], b?.position[i]);
    putField(dv, 0x1c + i * 4, 'i32', o.rotation[i] | 0, b?.rotation[i]);
    putField(dv, 0x28 + i * 4, 'f32', o.params[i], b?.params[i]);
    putField(dv, 0x34 + i * 4, 'i32', o.params[3 + i] | 0, b?.params[3 + i]);
  }
  return out;
}

export function serializeEnemySet(e: EnemySet): Uint8Array {
  const { out, base } = recordBase(e.raw, ENEMY_SET_SIZE, parseEnemySets);
  const dv = new DataView(out.buffer);
  const b = base as EnemySet | undefined;
  const floorBase = e.homeFloor ?? b?.floor;
  putField(dv, 0x00, 'u16', e.type, b?.type);
  putField(dv, 0x06, 'u16', e.numChildren, b?.numChildren);
  putField(dv, 0x08, 'u16', e.floor, floorBase);
  putField(dv, 0x0c, 'u16', e.section, b?.section);
  putField(dv, 0x0e, 'u16', e.wave, b?.wave);
  putField(dv, 0x10, 'u16', e.wave2, b?.wave2);
  putField(dv, 0x12, 'u16', e.unknownA1, b?.unknownA1);
  for (let i = 0; i < 3; i++) {
    putField(dv, 0x14 + i * 4, 'f32', e.position[i], b?.position[i]);
    putField(dv, 0x20 + i * 4, 'i32', e.rotation[i] | 0, b?.rotation[i]);
  }
  for (let i = 0; i < 5; i++) putField(dv, 0x2c + i * 4, 'f32', e.params[i], b?.params[i]);
  putField(dv, 0x40, 'i16', e.params[5], b?.params[5]);
  putField(dv, 0x42, 'i16', e.params[6], b?.params[6]);
  return out;
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export const serializeObjects = (list: readonly ObjectSet[]): Uint8Array => concat(list.map(serializeObjectSet));
export const serializeEnemies = (list: readonly EnemySet[]): Uint8Array => concat(list.map(serializeEnemySet));

// --- Wave events ------------------------------------------------------------

export function encodeActions(actions: readonly EventAction[]): Uint8Array {
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  let ended = false;
  for (const a of actions) {
    switch (a.op) {
      case 'nop':
        out.push(0x00);
        break;
      case 'stop':
        out.push(0x01);
        ended = true;
        break;
      case 'constructObjects':
        out.push(0x08);
        u16(a.room);
        u16(a.group);
        break;
      case 'constructEnemies':
        out.push(a.stop ? 0x0d : 0x09);
        u16(a.room);
        u16(a.wave);
        ended = a.stop;
        break;
      case 'setSwitchFlag':
        out.push(0x0a);
        u16(a.flag);
        break;
      case 'clearSwitchFlag':
        out.push(0x0b);
        u16(a.flag);
        break;
      case 'triggerEvent':
        out.push(0x0c, a.eventId & 0xff, (a.eventId >>> 8) & 0xff, (a.eventId >>> 16) & 0xff, (a.eventId >>> 24) & 0xff);
        break;
      case 'invalid':
        out.push(a.opcode & 0xff);
        ended = true;
        break;
    }
    if (ended) break;
  }
  if (!ended) out.push(0x01);
  return Uint8Array.from(out);
}

// An .evt file with the given events. Each event gets its own copy of its action
// list (parseEventFile can read shared lists, but writing them apart keeps an
// edit of one event from touching another).
export function serializeEvents(events: readonly WaveEvent[]): Uint8Array {
  const entriesAt = 0x10;
  const streamAt = entriesAt + events.length * 0x14;
  const streams: Uint8Array[] = [];
  const offsets: number[] = [];
  let streamLen = 0;
  for (const ev of events) {
    const bytes = encodeActions(ev.actions);
    offsets.push(streamLen);
    streams.push(bytes);
    streamLen += bytes.length;
  }
  const total = (streamAt + streamLen + 3) & ~3;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0x00, streamAt, true);
  dv.setUint32(0x04, entriesAt, true);
  dv.setUint32(0x08, events.length, true);
  dv.setUint32(0x0c, 0, true);
  events.forEach((ev, i) => {
    const o = entriesAt + i * 0x14;
    dv.setUint32(o, ev.id >>> 0, true);
    dv.setUint16(o + 4, ev.flags ?? 0, true);
    dv.setUint16(o + 6, ev.type, true);
    dv.setUint16(o + 8, ev.room, true);
    dv.setUint16(o + 0x0a, ev.wave, true);
    dv.setUint32(o + 0x0c, ev.delay >>> 0, true);
    dv.setUint32(o + 0x10, offsets[i], true);
  });
  let at = streamAt;
  for (const s of streams) {
    out.set(s, at);
    at += s.length;
  }
  return out;
}

// --- Action text ------------------------------------------------------------
// One action per line, the names of the formats/events.ts opcode table:
//   nop | stop | construct_objects <room> <group> | construct_enemies <room> <wave>
//   construct_enemies_stop <room> <wave> | set_switch_flag <n> | clear_switch_flag <n>
//   trigger_event <id> | raw <opcode>
// Numbers are decimal or 0x hex.

export function formatActions(actions: readonly EventAction[]): string {
  return actions
    .map((a) => {
      switch (a.op) {
        case 'nop':
          return 'nop';
        case 'stop':
          return 'stop';
        case 'constructObjects':
          return `construct_objects ${a.room} ${a.group}`;
        case 'constructEnemies':
          return `${a.stop ? 'construct_enemies_stop' : 'construct_enemies'} ${a.room} ${a.wave}`;
        case 'setSwitchFlag':
          return `set_switch_flag ${a.flag}`;
        case 'clearSwitchFlag':
          return `clear_switch_flag ${a.flag}`;
        case 'triggerEvent':
          return `trigger_event ${a.eventId}`;
        case 'invalid':
          return `raw 0x${a.opcode.toString(16)}`;
      }
    })
    .join('\n');
}

const num = (s: string | undefined, max: number, what: string, line: number): number => {
  if (s === undefined || !/^(0x[0-9a-f]+|\d+)$/i.test(s)) throw new Error(`line ${line}: ${what} expected`);
  const v = Number(s);
  if (v > max) throw new Error(`line ${line}: ${what} ${s} is out of range (0..${max})`);
  return v;
};

export function parseActionText(text: string): EventAction[] {
  const out: EventAction[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const words = lines[i].replace(/[#;].*$/, '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const [name, a, b] = words;
    const noMore = (n: number) => {
      if (words.length > n + 1) throw new Error(`line ${line}: too many operands for ${name}`);
    };
    switch (name.toLowerCase()) {
      case 'nop':
        noMore(0);
        out.push({ op: 'nop' });
        break;
      case 'stop':
        noMore(0);
        out.push({ op: 'stop' });
        break;
      case 'construct_objects':
        noMore(2);
        out.push({ op: 'constructObjects', room: num(a, 0xffff, 'room', line), group: num(b, 0xffff, 'group', line) });
        break;
      case 'construct_enemies':
      case 'construct_enemies_stop':
        noMore(2);
        out.push({ op: 'constructEnemies', room: num(a, 0xffff, 'room', line), wave: num(b, 0xffff, 'wave', line), stop: name.toLowerCase().endsWith('_stop') });
        break;
      case 'set_switch_flag':
        noMore(1);
        out.push({ op: 'setSwitchFlag', flag: num(a, 0xffff, 'flag', line) });
        break;
      case 'clear_switch_flag':
        noMore(1);
        out.push({ op: 'clearSwitchFlag', flag: num(a, 0xffff, 'flag', line) });
        break;
      case 'trigger_event':
        noMore(1);
        out.push({ op: 'triggerEvent', eventId: num(a, 0xffffffff, 'event id', line) });
        break;
      case 'raw':
        noMore(1);
        out.push({ op: 'invalid', opcode: num(a, 0xff, 'opcode', line) });
        break;
      default:
        throw new Error(`line ${line}: unknown action "${name}"`);
    }
  }
  return out;
}

// The actions of an .evt entry read back from bytes (used by tests and the loader).
export const actionsAt = parseActions;

// --- The whole .dat -----------------------------------------------------------

export interface RawChunk {
  type: number;
  data: Uint8Array;
}

// What the .dat holds for one floor, in the form the editor builds it from.
export interface DatFloorContent {
  floor: number;
  objects: readonly ObjectSet[];
  enemies: readonly EnemySet[];
  // The events payload to write (type 3): serializeEvents(...) or
  // serializeEvt2File(...) of the edited events, or the original bytes when
  // they are unchanged. null when the floor has no events chunk.
  events: Uint8Array | null;
  // The random-wave payloads (type 4 locations, type 5 definitions), null when
  // the floor has no such chunk.
  randomLocations: Uint8Array | null;
  randomDefinitions: Uint8Array | null;
  extra: readonly RawChunk[]; // unknown chunk types, untouched
}

// One chunk of the file, in file order: the quest .dat's chunk list is
// (type, floor) pairs, and the writer keeps that order so an unchanged file
// comes back byte for byte.
export interface ChunkSlot {
  type: number;
  floor: number;
}

function chunk(type: number, floor: number, payload: Uint8Array, align = false): Uint8Array {
  const dataSize = align ? (payload.length + 3) & ~3 : payload.length;
  const size = QUEST_DAT_CHUNK_HEADER_SIZE + dataSize;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, type, true);
  dv.setUint32(4, size, true);
  dv.setUint32(8, floor, true);
  dv.setUint32(12, dataSize, true);
  out.set(payload, QUEST_DAT_CHUNK_HEADER_SIZE);
  return out;
}

// The payload of a known chunk of a floor, or null when the floor has none to
// write. A chunk that the layout lists is written even when empty (the file had
// it); a chunk the layout does not list is written only when it has content.
function payloadOf(type: number, f: DatFloorContent, listed: boolean): Uint8Array | null {
  switch (type) {
    case QuestDatChunkType.Objects:
      return f.objects.length || listed ? serializeObjects(f.objects) : null;
    case QuestDatChunkType.Enemies:
      return f.enemies.length || listed ? serializeEnemies(f.enemies) : null;
    case QuestDatChunkType.Events:
      return f.events;
    case QuestDatChunkType.RandomEnemyLocations:
      return f.randomLocations;
    case QuestDatChunkType.RandomEnemyDefinitions:
      return f.randomDefinitions;
    default:
      return null;
  }
}

const KNOWN_TYPES = new Set<number>([QuestDatChunkType.Objects, QuestDatChunkType.Enemies, QuestDatChunkType.Events, QuestDatChunkType.RandomEnemyLocations, QuestDatChunkType.RandomEnemyDefinitions]);
const ALIGNED_TYPES = new Set<number>([QuestDatChunkType.Events]); // the events payload is padded to 4 bytes

// Writes the .dat. The chunks come out in `layout` order (the order the file had
// them); what the layout does not name follows, by floor then type. A known
// chunk's first occurrence in the layout gets the floor's content; a later
// occurrence of the same (type, floor) is folded into it.
export function buildQuestDatBytes(floors: readonly DatFloorContent[], layout: readonly ChunkSlot[] = []): Uint8Array {
  const byFloor = new Map<number, DatFloorContent>();
  for (const f of floors) byFloor.set(f.floor, f);
  const sorted = [...floors].sort((a, b) => a.floor - b.floor);
  const listed = new Set(layout.map((s) => `${s.type}:${s.floor}`));
  const extras = new Map<string, RawChunk[]>();
  for (const f of sorted) {
    for (const x of f.extra) {
      const k = `${x.type}:${f.floor}`;
      extras.set(k, [...(extras.get(k) ?? []), x]);
    }
  }
  const parts: Uint8Array[] = [];
  const done = new Set<string>();
  const emitKnown = (type: number, floor: number, isListed: boolean): void => {
    const key = `${type}:${floor}`;
    const f = byFloor.get(floor);
    if (done.has(key) || !f) return;
    const payload = payloadOf(type, f, isListed);
    if (!payload) return;
    done.add(key);
    parts.push(chunk(type, floor, payload, ALIGNED_TYPES.has(type)));
  };
  for (const s of layout) {
    if (KNOWN_TYPES.has(s.type)) {
      emitKnown(s.type, s.floor, true);
    } else {
      const queue = extras.get(`${s.type}:${s.floor}`);
      const x = queue?.shift();
      if (x) parts.push(chunk(x.type, s.floor, x.data));
    }
  }
  // Content the layout did not name: known chunks, then the unknown ones left over.
  for (const f of sorted) for (const type of [QuestDatChunkType.Objects, QuestDatChunkType.Enemies, QuestDatChunkType.Events, QuestDatChunkType.RandomEnemyLocations, QuestDatChunkType.RandomEnemyDefinitions]) {
    emitKnown(type, f.floor, listed.has(`${type}:${f.floor}`));
  }
  for (const f of sorted) for (const x of f.extra) {
    const queue = extras.get(`${x.type}:${f.floor}`);
    const left = queue?.shift();
    if (left) parts.push(chunk(left.type, f.floor, left.data));
  }
  parts.push(new Uint8Array(QUEST_DAT_CHUNK_HEADER_SIZE)); // type 0: end
  return concat(parts);
}
