// Interactive field music ("slbgm"), decoded from PsoBB.exe (Ephinea 1.25.13).
//
// The field areas do not play one looping track: FUN_00814c7c(index) starts a
// sequencer over one of twelve descriptors (pointer table 0x00a16088):
//   00 char name[0x20]     "slbgm_forest.afs"; FUN_00814c00 swaps the
//                          extension for "ogg", so the file is data/ogg/
//                          slbgm_forest.ogg
//   20 i32  record count   per table
//   24 i32, 28 i32         unused by the sequencer
//   2C ptr  calm table     records of five i16 (10 bytes):
//   30 ptr  battle table     {first, loop, count, transition, next}
// The OGG file is a chained Ogg Vorbis stream: every logical bitstream (link)
// is one musical segment. The streaming thread (FUN_0086ee8c / FUN_0086f530)
// plays queued link numbers back to back (ov_read reports the link, and
// FUN_0086fe60 seeks to the next queued one), so the sequencer only queues
// link numbers (FUN_0086e114 -> FUN_0086eb80, a 256-entry ring).
//
// Sequencer (FUN_00814c7c start, FUN_00814f30 per frame, FUN_00815170):
//   - start: queue calm[0].first, then calm[0].first + 1 (or, for a one-link
//     record, calm[calm[0].next].first);
//   - whenever the queue drains to the playing link, the next one is chosen
//     from the state of the link that just started:
//       * same mode: the next link of the record (first + counter) until
//         `count` links played, then record `next` starting at its `first`
//         link the first time a record changes (flag 0x00ac9cf0) and at its
//         `loop` link afterwards;
//       * mode change requested (FUN_00814c5c sets the target): the record's
//         `transition` link, then (FUN_00815170) the other table's record
//         other[record].next at its `loop` link; a transition of -1 switches
//         at once.
//   - the target mode is battle while the player's room has an active wave
//     event (FUN_0069821c -> FUN_006982b0 / FUN_006982d8: back to calm 90
//     frames after the room is clear); the Dark Falz music (index 4) ignores
//     it (FUN_00814c5c).

export interface SlRecord {
  first: number;
  loop: number;
  count: number;
  transition: number;
  next: number;
}

export interface SlBgm {
  file: string; // under data/ogg
  calm: SlRecord[];
  battle: SlRecord[];
}

const r = (rows: number[][]): SlRecord[] => rows.map(([first, loop, count, transition, next]) => ({ first, loop, count, transition, next }));

// Descriptors 0..11 (0x00a16088 + 4 * index), tables copied from the exe.
export const SLBGM: SlBgm[] = [
  {
    file: 'slbgm_forest.ogg', // 0x00a15ba8
    calm: r([[0, 24, 4, 25, 1], [4, 4, 4, 26, 2], [8, 8, 4, 27, 3], [12, 12, 4, 28, 4], [16, 16, 4, 29, 5], [20, 20, 4, 30, 0]]),
    battle: r([[31, 55, 4, 56, 1], [35, 35, 4, 57, 2], [39, 39, 4, 58, 3], [43, 43, 4, 59, 4], [47, 47, 4, 60, 5], [51, 51, 4, 61, 0]]),
  },
  {
    file: 'slbgm_cave.ogg', // 0x00a15d5c
    calm: r([[0, 24, 4, 25, 1], [4, 4, 4, 26, 2], [8, 8, 4, 27, 3], [12, 12, 4, 28, 4], [16, 16, 4, 29, 5], [20, 20, 4, 30, 0]]),
    battle: r([[31, 55, 4, 56, 1], [35, 35, 4, 57, 2], [39, 39, 4, 58, 3], [43, 43, 4, 59, 4], [47, 47, 4, 60, 5], [51, 51, 4, 61, 0]]),
  },
  {
    file: 'slbgm_machine.ogg', // 0x00a15df8
    calm: r([[0, 20, 4, 21, 1], [4, 4, 4, 22, 2], [8, 8, 4, 23, 3], [12, 12, 4, 24, 4], [16, 16, 4, 25, 0]]),
    battle: r([[26, 46, 4, 47, 1], [30, 30, 4, 48, 2], [34, 34, 4, 49, 3], [38, 38, 4, 50, 4], [42, 42, 4, 51, 0]]),
  },
  {
    file: 'slbgm_ancient.ogg', // 0x00a15c54
    calm: r([[0, 0, 4, 24, 1], [4, 23, 4, 25, 2], [8, 8, 2, 26, 3], [10, 10, 4, 27, 4], [14, 14, 5, 28, 5], [19, 19, 4, 29, 1]]),
    battle: r([[30, 49, 4, 50, 1], [30, 49, 4, 50, 2], [34, 34, 2, 51, 3], [36, 36, 4, 52, 4], [40, 40, 5, 53, 5], [45, 45, 4, 54, 1]]),
  },
  {
    file: 'slbgm_dark.ogg', // 0x00a15cb0
    calm: r([[0, 0, 2, -1, 1], [2, 12, 10, -1, 1]]),
    battle: r([[13, 21, 8, -1, 0], [13, 21, 8, -1, 0]]),
  },
  {
    file: 'slbgm_jungle.ogg', // 0x00a15e2c
    calm: r([[7, 35, 4, 0, 1], [11, 11, 4, 1, 2], [15, 15, 4, 2, 3], [19, 19, 4, 3, 4], [23, 23, 4, 4, 5], [27, 27, 4, 5, 6], [31, 31, 4, 6, 0]]),
    battle: r([[36, 64, 4, 65, 1], [40, 40, 4, 66, 2], [44, 44, 4, 67, 3], [48, 48, 4, 68, 4], [52, 52, 4, 69, 5], [56, 56, 4, 70, 6], [60, 60, 4, 71, 0]]),
  },
  {
    file: 'slbgm_seabed.ogg', // 0x00a15ed8
    calm: r([[0, 0, 4, 27, 1], [4, 26, 4, 28, 2], [8, 8, 4, 29, 3], [12, 12, 4, 30, 4], [16, 16, 4, 31, 5], [20, 20, 6, 32, 1]]),
    battle: r([[33, 33, 4, 60, 1], [37, 59, 4, 61, 2], [41, 41, 4, 62, 3], [45, 45, 4, 63, 4], [49, 49, 4, 64, 5], [53, 53, 6, 65, 1]]),
  },
  {
    file: 'slbgm_ruin.ogg', // 0x00a15f40
    calm: r([[0, 22, 2, 23, 1], [2, 2, 4, 24, 2], [6, 6, 2, 25, 3], [8, 8, 4, 26, 4], [12, 12, 2, 27, 5], [14, 14, 4, 28, 6], [18, 18, 4, 29, 0]]),
    battle: r([[30, 52, 2, 53, 1], [32, 32, 4, 54, 2], [36, 36, 2, 55, 3], [38, 38, 4, 56, 4], [42, 42, 2, 57, 5], [44, 44, 4, 58, 6], [48, 48, 4, 59, 0]]),
  },
  {
    file: 'slbgm_space.ogg', // 0x00a15f0c
    calm: r([[0, 0, 4, 29, 1], [4, 28, 4, 30, 2], [8, 8, 2, 31, 3], [10, 10, 4, 32, 4], [14, 14, 2, 33, 5], [16, 16, 4, 34, 6], [20, 20, 4, 35, 7], [24, 24, 4, 36, 1]]),
    battle: r([[41, 65, 4, 66, 1], [41, 65, 4, 66, 2], [45, 45, 2, 67, 3], [47, 47, 4, 68, 4], [51, 51, 2, 69, 5], [53, 53, 4, 70, 6], [57, 57, 4, 71, 7], [61, 61, 4, 72, 1]]),
  },
  {
    file: 'slbgm_wilds.ogg', // 0x00a15f74
    calm: r([[37, 38, 1, 29, 1], [39, 39, 3, 29, 2], [42, 42, 4, 30, 3], [46, 46, 4, 31, 4], [50, 50, 4, 32, 5], [54, 54, 4, 33, 6], [58, 58, 2, 34, 7], [60, 60, 4, 35, 8], [64, 64, 2, 36, 0]]),
    battle: r([[0, 1, 1, 66, 1], [2, 2, 3, 66, 2], [5, 5, 4, 67, 3], [9, 9, 4, 68, 4], [13, 13, 4, 69, 5], [17, 17, 4, 70, 6], [21, 21, 2, 71, 7], [23, 23, 4, 72, 8], [27, 27, 2, 73, 0]]),
  },
  {
    file: 'slbgm_crater.ogg', // 0x00a16020
    calm: r([[24, 25, 1, 19, 1], [26, 26, 3, 19, 2], [29, 29, 4, 20, 3], [33, 33, 4, 21, 4], [37, 37, 4, 22, 5], [41, 41, 2, 23, 0]]),
    battle: r([[0, 1, 1, 43, 1], [2, 2, 3, 43, 2], [5, 5, 4, 44, 3], [9, 9, 4, 45, 4], [13, 13, 4, 46, 5], [17, 17, 2, 47, 0]]),
  },
  {
    file: 'slbgm_desert.ogg', // 0x00a16054
    calm: r([[40, 41, 1, 33, 1], [42, 42, 3, 33, 2], [45, 45, 4, 34, 3], [49, 49, 4, 35, 4], [53, 53, 4, 36, 5], [57, 57, 4, 37, 6], [61, 61, 4, 38, 7], [65, 65, 8, 39, 0]]),
    battle: r([[0, 1, 1, 73, 1], [2, 2, 3, 73, 2], [5, 5, 4, 74, 3], [9, 9, 4, 75, 4], [13, 13, 4, 76, 5], [17, 17, 4, 77, 6], [21, 21, 4, 78, 7], [25, 25, 8, 79, 0]]),
  },
];

export const SL_DARK = 4;

// State of a queued link (the two 8-byte slots at 0x00ac9d2c / 0x00ac9d34).
interface Slot {
  mode: 0 | 1; // 0 = calm, 1 = battle
  record: number;
  counter: number;
}

// The sequencer without audio: start() gives the first two links, next()
// the link to queue when the previously queued one starts playing.
export class SlSequencer {
  readonly bgm: SlBgm;
  private index: number;
  private mode: 0 | 1 = 0; // 0x00ac9cd0
  private target: 0 | 1 = 0; // 0x00ac9cc8
  private recordChanged = false; // 0x00ac9cf0
  private inTransition = false; // 0x00ac9d28 == 2
  private queued: Slot = { mode: 0, record: 0, counter: 0 };

  constructor(index: number) {
    this.index = index;
    this.bgm = SLBGM[index];
  }

  private table(mode: 0 | 1): SlRecord[] {
    return mode ? this.bgm.battle : this.bgm.calm;
  }

  // FUN_00814c7c: the two links queued when the stream opens.
  start(): [number, number] {
    const r0 = this.bgm.calm[0];
    if (r0.count === 1) {
      this.queued = { mode: 0, record: r0.next, counter: 0 };
      return [r0.first, this.bgm.calm[r0.next].first];
    }
    this.queued = { mode: 0, record: 0, counter: 1 };
    return [r0.first, r0.first + 1];
  }

  // FUN_00814c5c: request battle (true) or calm music. Ignored for Dark Falz.
  setBattle(on: boolean): void {
    if (this.index !== SL_DARK) this.target = on ? 1 : 0;
  }

  get battle(): boolean {
    return this.mode === 1;
  }

  // FUN_00815170: after a transition link, continue in the other table.
  private switchMode(playing: Slot): number {
    const other: 0 | 1 = this.mode ? 0 : 1;
    const t = this.table(other);
    const record = t[playing.record].next;
    this.mode = other;
    this.queued = { mode: other, record, counter: 0 };
    return t[record].loop;
  }

  // FUN_00814f30: called when the queued link starts playing.
  next(): number {
    const playing = this.queued;
    if (this.inTransition) {
      this.inTransition = false;
      return this.switchMode(playing);
    }
    const rec = this.table(playing.mode)[playing.record];
    if (this.target !== this.mode) {
      if (rec.transition !== -1) {
        this.queued = { ...playing, counter: 0 };
        this.inTransition = true;
        return rec.transition;
      }
      return this.switchMode(playing);
    }
    const counter = playing.counter + 1;
    if (counter < rec.count) {
      this.queued = { ...playing, counter };
      return rec.first + counter;
    }
    const record = rec.next;
    const t = this.table(playing.mode);
    this.queued = { mode: playing.mode, record, counter: 0 };
    if (!this.recordChanged) {
      this.recordChanged = true;
      return t[record].first;
    }
    return t[record].loop;
  }
}

// Byte ranges of the logical bitstreams of a chained Ogg file: a link starts
// at a page with the beginning-of-stream flag (header type & 2). Each range
// is a complete Ogg Vorbis file (its own headers), so it can be decoded alone.
export function oggLinks(data: Uint8Array): Array<[number, number]> {
  const links: Array<[number, number]> = [];
  let o = 0;
  while (o + 27 <= data.length) {
    if (data[o] !== 0x4f || data[o + 1] !== 0x67 || data[o + 2] !== 0x67 || data[o + 3] !== 0x53) throw new Error(`no Ogg page at ${o}`);
    const segments = data[o + 26];
    let size = 27 + segments;
    for (let i = 0; i < segments; i++) size += data[o + 27 + i];
    if (data[o + 5] & 2) {
      if (links.length) links[links.length - 1][1] = o;
      links.push([o, data.length]);
    }
    o += size;
  }
  return links;
}
