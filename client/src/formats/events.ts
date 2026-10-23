// Wave event files (map_<area>[_<layout>]_<entities>[_off].evt in data.gsl, or
// loose in data/ for Episode 4). One file per floor; the client loads it whole
// into g_MapEventTablesArray[floor] (LoadMapEventTableByVariant_0080cf78 in
// PsoBB.exe, Ephinea 1.25.13: the SetDataTable's enemy basename + ".evt").
//
// Layout (newserv Map.hh EventsSectionHeader / Event1Entry; the client's
// set_active_map_event_on_floor and quest_event_handler_constructor read the
// same offsets):
//   00 u32 action_stream_offset  (from the start of the file)
//   04 u32 entries_offset        (0x10)
//   08 u32 entry_count
//   0C u32 format                (0, or 'evt2' for random-wave quests)
//   entries (0x14 each):
//     00 u32 event_id   (several entries may share an id)
//     04 u16 flags      (runtime: 2 handler built, 4 active, 8 actions run, 0x10 all enemies dead)
//     06 u16 event_type (index into the handler table 0x00a11e24; 1 = the wave handler)
//     08 u16 room       \ the enemies of this event are the e.dat entries
//     0A u16 wave       / with the same room and wave number
//     0C u32 delay      (frames between the trigger and the spawn)
//     10 u32 action_offset (into the action stream)
//   action stream: opcodes run when the wave is cleared
//   (ProcessQuestEventCommands_0080cc44, dispatch table 0x00a11da0 of
//   {reader, handler} pairs; operands are read by FUN_0080ccd8 (u16) and
//   FUN_0080cd18 (u32)):
//     00            nop
//     01            stop                                   (FUN_0080cd40)
//     08 u16 u16    construct_objects(room, group)         (FUN_0080cd4c -> FUN_00810ae8)
//     09 u16 u16    construct_enemies(room, wave)          (FUN_0080cd64 -> FUN_00810e54)
//     0A u16        set_switch_flag(flag)  sends 6x05      (FUN_0080cd7c)
//     0B u16        clear_switch_flag(flag) sends 6x05     (FUN_0080cddc)
//     0C u32        trigger_event(id)      sends 6x67      (FUN_0080ce24)
//     0D u16 u16    construct_enemies + stop               (FUN_0080ce74)
//   Any other opcode ends the stream here (the client would jump through an
//   empty table slot; newserv stops too).

export type EventAction =
  | { op: 'nop' }
  | { op: 'stop' }
  | { op: 'constructObjects'; room: number; group: number }
  | { op: 'constructEnemies'; room: number; wave: number; stop: boolean }
  | { op: 'setSwitchFlag'; flag: number }
  | { op: 'clearSwitchFlag'; flag: number }
  | { op: 'triggerEvent'; eventId: number }
  | { op: 'invalid'; opcode: number };

export interface WaveEvent {
  index: number; // position in the file
  id: number;
  flags?: number; // entry +4 (runtime bits; kept so an edited file writes back what it read)
  type: number;
  room: number;
  wave: number;
  delay: number; // frames
  actionOffset: number;
  actions: EventAction[];
}

export interface EventFile {
  format: 'evt1' | 'evt2';
  events: WaveEvent[];
}

const EVT2 = 0x65767432;

export function parseActions(data: Uint8Array, start: number): EventAction[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: EventAction[] = [];
  let p = start;
  while (p < data.length) {
    const op = data[p++];
    const u16 = () => {
      const v = dv.getUint16(p, true);
      p += 2;
      return v;
    };
    switch (op) {
      case 0x00:
        out.push({ op: 'nop' });
        break;
      case 0x01:
        out.push({ op: 'stop' });
        return out;
      case 0x08: {
        const room = u16();
        out.push({ op: 'constructObjects', room, group: u16() });
        break;
      }
      case 0x09:
      case 0x0d: {
        const room = u16();
        out.push({ op: 'constructEnemies', room, wave: u16(), stop: op === 0x0d });
        if (op === 0x0d) return out;
        break;
      }
      case 0x0a:
        out.push({ op: 'setSwitchFlag', flag: u16() });
        break;
      case 0x0b:
        out.push({ op: 'clearSwitchFlag', flag: u16() });
        break;
      case 0x0c:
        out.push({ op: 'triggerEvent', eventId: dv.getUint32(p, true) });
        p += 4;
        break;
      default:
        out.push({ op: 'invalid', opcode: op });
        return out;
    }
  }
  return out;
}

export function parseEventFile(data: Uint8Array): EventFile {
  if (data.length < 0x10) throw new Error(`event file too short (${data.length} bytes)`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const actionStream = dv.getUint32(0, true);
  const entries = dv.getUint32(4, true);
  const count = dv.getUint32(8, true);
  const format = dv.getUint32(12, false) === EVT2 ? 'evt2' : 'evt1';
  if (format === 'evt2') return { format, events: [] }; // random-wave quest format: not used by free play
  const size = 0x14;
  if (entries + count * size > data.length || actionStream > data.length) throw new Error('event file offsets out of range');
  const events: WaveEvent[] = [];
  for (let i = 0; i < count; i++) {
    const o = entries + i * size;
    const actionOffset = dv.getUint32(o + 0x10, true);
    events.push({
      index: i,
      id: dv.getUint32(o, true),
      flags: dv.getUint16(o + 4, true),
      type: dv.getUint16(o + 6, true),
      room: dv.getUint16(o + 8, true),
      wave: dv.getUint16(o + 0x0a, true),
      delay: dv.getUint32(o + 0x0c, true),
      actionOffset,
      actions: parseActions(data, actionStream + actionOffset),
    });
  }
  return { format, events };
}

// --- evt2: random-wave events ----------------------------------------------
// The events section of a challenge quest (quest .dat type 3 with the 'evt2'
// format) holds templates, not waves: each entry says how many waves to run
// and how many enemies each one has, and the random enemy sections (.dat types
// 4 / 5, formats/randomenemies.ts) say which enemies and where. The entry layout
// is newserv Map.hh Event2Entry (0x18 bytes):
//   00 u32 event_id          04 u16 flags          06 u16 event_type
//   08 u16 room              0A u16 wave_number    0C u16 min_delay
//   0E u16 max_delay         10 u8  min_enemies    11 u8  max_enemies
//   12 u16 max_waves         14 u32 action_offset (into the action stream)
// The header is the same 0x10 bytes as evt1; the action stream runs from its
// action_stream_offset to the end of the section.

export interface Event2Entry {
  eventId: number;
  flags: number;
  eventType: number;
  room: number;
  waveNumber: number;
  minDelay: number;
  maxDelay: number;
  minEnemies: number;
  maxEnemies: number;
  maxWaves: number;
  actionOffset: number;
}

export interface Event2File {
  entries: Event2Entry[];
  actionStream: Uint8Array;
}

export const EVT2_ENTRY_SIZE = 0x18;

export function isEvt2(data: Uint8Array): boolean {
  if (data.length < 0x10) return false;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(12, false) === EVT2;
}

export function parseEvt2File(data: Uint8Array): Event2File {
  if (!isEvt2(data)) throw new Error('not an evt2 events section');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const actionStream = dv.getUint32(0, true);
  const entries = dv.getUint32(4, true);
  const count = dv.getUint32(8, true);
  if (entries + count * EVT2_ENTRY_SIZE > data.length || actionStream > data.length) throw new Error('evt2 offsets out of range');
  const out: Event2Entry[] = [];
  for (let i = 0; i < count; i++) {
    const o = entries + i * EVT2_ENTRY_SIZE;
    out.push({
      eventId: dv.getUint32(o, true),
      flags: dv.getUint16(o + 4, true),
      eventType: dv.getUint16(o + 6, true),
      room: dv.getUint16(o + 8, true),
      waveNumber: dv.getUint16(o + 0x0a, true),
      minDelay: dv.getUint16(o + 0x0c, true),
      maxDelay: dv.getUint16(o + 0x0e, true),
      minEnemies: dv.getUint8(o + 0x10),
      maxEnemies: dv.getUint8(o + 0x11),
      maxWaves: dv.getUint16(o + 0x12, true),
      actionOffset: dv.getUint32(o + 0x14, true),
    });
  }
  return { entries: out, actionStream: data.subarray(actionStream) };
}
