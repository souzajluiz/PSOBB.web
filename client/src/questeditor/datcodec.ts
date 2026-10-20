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
import { ENEMY_SET_SIZE, OBJECT_SET_SIZE, type EnemySet, type ObjectSet } from '../formats/setdata.ts';

export function serializeObjectSet(o: ObjectSet): Uint8Array {
  const out = new Uint8Array(OBJECT_SET_SIZE);
  const dv = new DataView(out.buffer);
  dv.setUint16(0x00, o.type, true);
  dv.setUint16(0x06, o.floor, true);
  dv.setUint16(0x0a, o.group, true);
  dv.setUint16(0x0c, o.section, true);
  dv.setUint16(0x0e, o.unknownA3, true);
  for (let i = 0; i < 3; i++) {
    dv.setFloat32(0x10 + i * 4, o.position[i], true);
    dv.setInt32(0x1c + i * 4, o.rotation[i] | 0, true);
    dv.setFloat32(0x28 + i * 4, o.params[i], true);
    dv.setInt32(0x34 + i * 4, o.params[3 + i] | 0, true);
  }
  return out;
}

export function serializeEnemySet(e: EnemySet): Uint8Array {
  const out = new Uint8Array(ENEMY_SET_SIZE);
  const dv = new DataView(out.buffer);
  dv.setUint16(0x00, e.type, true);
  dv.setUint16(0x06, e.numChildren, true);
  dv.setUint16(0x08, e.floor, true);
  dv.setUint16(0x0c, e.section, true);
  dv.setUint16(0x0e, e.wave, true);
  dv.setUint16(0x10, e.wave2, true);
  dv.setUint16(0x12, e.unknownA1, true);
  for (let i = 0; i < 3; i++) {
    dv.setFloat32(0x14 + i * 4, e.position[i], true);
    dv.setInt32(0x20 + i * 4, e.rotation[i] | 0, true);
  }
  for (let i = 0; i < 5; i++) dv.setFloat32(0x2c + i * 4, e.params[i], true);
  dv.setInt16(0x40, e.params[5], true);
  dv.setInt16(0x42, e.params[6], true);
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
  // The events payload to write: serializeEvents(...) of the edited events, or
  // the original bytes when they cannot be edited (the 'evt2' format).
  events: Uint8Array | null;
  extra: readonly RawChunk[]; // random-wave sections (types 4 / 5) and unknown chunks, untouched
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

export function buildQuestDatBytes(floors: readonly DatFloorContent[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of [...floors].sort((a, b) => a.floor - b.floor)) {
    if (f.objects.length) parts.push(chunk(QuestDatChunkType.Objects, f.floor, serializeObjects(f.objects)));
    if (f.enemies.length) parts.push(chunk(QuestDatChunkType.Enemies, f.floor, serializeEnemies(f.enemies)));
    if (f.events) parts.push(chunk(QuestDatChunkType.Events, f.floor, f.events, true));
    for (const x of f.extra) parts.push(chunk(x.type, f.floor, x.data));
  }
  parts.push(new Uint8Array(QUEST_DAT_CHUNK_HEADER_SIZE)); // type 0: end
  return concat(parts);
}
