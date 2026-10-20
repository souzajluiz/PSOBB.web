// Quest editor: edits of the .bin header (the fields the properties panel shows)
// done on the bytes, and a minimal new .bin. The result of each edit is parsed
// again with parseQuestBin, so the QuestBin handed on always agrees with its
// bytes whatever the writer does with them.
//
// Layout: formats/questbin.ts. A header that stops at 0x398 (Qedit's) has no room
// for the floor assignments; asking for them upgrades it to the full 0x122C
// header, which only moves the bytecode and the label table: label offsets are
// relative to the bytecode and jumps use label numbers, so no code changes.

import {
  parseQuestBin,
  QUEST_BIN_HEADER_FULL_SIZE,
  type QuestBin,
  type QuestFloorAssignment,
} from '../formats/questbin.ts';
import { questOpcodeByName } from '../formats/questopcodes.ts';

export interface EditableHeader {
  questNumber: number;
  episode: number; // 0 = Ep1, 1 = Ep2, 2 = Ep4
  maxPlayers: number;
  joinable: boolean;
  name: string;
  shortDescription: string;
  longDescription: string;
  floorAssignments: QuestFloorAssignment[];
}

export const NAME_CHARS = 0x1f; // the fields hold 0x20 / 0x80 / 0x120 UTF-16 units including the terminator
export const SHORT_CHARS = 0x7f;
export const LONG_CHARS = 0x11f;
export const MAX_FLOOR_ASSIGNMENTS = 0x10;

function writeUtf16(data: Uint8Array, offset: number, capacity: number, text: string): void {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const s = text.slice(0, capacity - 1);
  for (let i = 0; i < capacity; i++) dv.setUint16(offset + i * 2, i < s.length ? s.charCodeAt(i) : 0, true);
}

export function upgradeToFullHeader(bin: QuestBin): QuestBin {
  if (bin.header.hasFullHeader) return bin;
  const first = Math.min(bin.header.textOffset, bin.header.labelTableOffset, bin.data.length);
  const grow = Math.max(0, QUEST_BIN_HEADER_FULL_SIZE - first);
  const out = new Uint8Array(bin.data.length + grow);
  // Everything below the old text offset (the header Qedit wrote), then the new
  // extension, then the old bytecode / label table moved up by `grow`.
  const oldText = bin.header.textOffset;
  const oldTable = bin.header.labelTableOffset;
  out.set(bin.data.subarray(0, first));
  out.set(bin.data.subarray(first), first + grow);
  const dv = new DataView(out.buffer);
  dv.setUint32(0x00, oldText + grow, true);
  dv.setUint32(0x04, oldTable + grow, true);
  dv.setUint32(0x08, bin.header.size + grow, true);
  // Extension: unknown_a5, solo unlock flags (0xFFFF = none), 16 unused floor
  // assignments (all 0xFF), the create-item mask (zero).
  for (let i = 0; i < 8; i++) dv.setUint16(0x39c + i * 2, 0xffff, true);
  out.fill(0xff, 0x3ac, 0x3ac + MAX_FLOOR_ASSIGNMENTS * 8);
  return parseQuestBin(out);
}

// A copy of `bin` with the given header fields written into its bytes.
export function applyHeader(bin: QuestBin, patch: Partial<EditableHeader>): QuestBin {
  let cur = bin;
  if (patch.floorAssignments && !cur.header.hasFullHeader) cur = upgradeToFullHeader(cur);
  const data = cur.data.slice();
  const dv = new DataView(data.buffer);
  if (patch.questNumber !== undefined) dv.setUint16(0x10, patch.questNumber & 0xffff, true);
  if (patch.episode !== undefined) data[0x14] = patch.episode & 0xff;
  if (patch.maxPlayers !== undefined) data[0x15] = patch.maxPlayers >= 4 ? 0 : patch.maxPlayers & 0xff; // 0 on the wire means 4
  if (patch.joinable !== undefined) data[0x16] = patch.joinable ? 1 : 0;
  if (patch.name !== undefined) writeUtf16(data, 0x18, 0x20, patch.name);
  if (patch.shortDescription !== undefined) writeUtf16(data, 0x58, 0x80, patch.shortDescription);
  if (patch.longDescription !== undefined) writeUtf16(data, 0x158, 0x120, patch.longDescription);
  if (patch.floorAssignments) {
    if (patch.floorAssignments.length > MAX_FLOOR_ASSIGNMENTS) throw new Error(`a quest can designate at most ${MAX_FLOOR_ASSIGNMENTS} floors`);
    data.fill(0xff, 0x3ac, 0x3ac + MAX_FLOOR_ASSIGNMENTS * 8);
    patch.floorAssignments.forEach((fa, i) => {
      const o = 0x3ac + i * 8;
      data[o] = fa.floor;
      data[o + 1] = fa.area;
      data[o + 2] = fa.type;
      data[o + 3] = fa.layoutVar;
      data[o + 4] = fa.entitiesVar;
    });
  }
  return parseQuestBin(data);
}

export function editableHeaderOf(bin: QuestBin): EditableHeader {
  const h = bin.header;
  return {
    questNumber: h.questNumber,
    episode: h.episode,
    maxPlayers: h.maxPlayers,
    joinable: h.joinable,
    name: h.name,
    shortDescription: h.shortDescription,
    longDescription: h.longDescription,
    floorAssignments: h.floorAssignments.map((f) => ({ ...f })),
  };
}

export interface NewQuestOptions {
  episode?: number; // 0 = Ep1, 1 = Ep2, 2 = Ep4
  questNumber?: number;
  name?: string;
  shortDescription?: string;
  longDescription?: string;
  floorAssignments?: QuestFloorAssignment[];
}

// A minimal quest: the full header, and a start label that sets the episode,
// designates the floors and returns.
//   set_episode <episode>            F8 BC i32
//   bb_map_designate f, a, t, l, e   F9 51 i8 x5   (one per assignment)
//   ret                              01
export function newQuestBin(opts: NewQuestOptions = {}): QuestBin {
  const episode = opts.episode ?? 0;
  const floors = opts.floorAssignments ?? [{ floor: 1, area: episode === 1 ? 0x17 : episode === 2 ? 0x2a : 1, type: 0, layoutVar: 0, entitiesVar: 0 }];
  const setEpisode = questOpcodeByName('set_episode');
  const designate = questOpcodeByName('bb_map_designate');
  const ret = questOpcodeByName('ret');
  if (!setEpisode || !designate || !ret) throw new Error('the opcode table lacks set_episode / bb_map_designate / ret');
  const code: number[] = [];
  const op = (opcode: number) => (opcode > 0xff ? code.push(opcode >> 8, opcode & 0xff) : code.push(opcode));
  op(setEpisode.opcode);
  code.push(episode & 0xff, 0, 0, 0);
  for (const f of floors) {
    op(designate.opcode);
    code.push(f.floor, f.area, f.type, f.layoutVar, f.entitiesVar);
  }
  op(ret.opcode);
  while (code.length % 4) code.push(0);
  const textOffset = QUEST_BIN_HEADER_FULL_SIZE;
  const labelTableOffset = textOffset + code.length;
  const size = labelTableOffset + 4; // one label: the start
  const data = new Uint8Array(size);
  const dv = new DataView(data.buffer);
  dv.setUint32(0x00, textOffset, true);
  dv.setUint32(0x04, labelTableOffset, true);
  dv.setUint32(0x08, size, true);
  dv.setUint16(0x0c, 0xffff, true);
  dv.setUint16(0x0e, 0xffff, true);
  data.set(code, textOffset);
  dv.setUint32(labelTableOffset, 0, true); // label 0 at the start of the bytecode
  for (let i = 0; i < 8; i++) dv.setUint16(0x39c + i * 2, 0xffff, true);
  const bin = parseQuestBin(data);
  return applyHeader(bin, {
    questNumber: opts.questNumber ?? 1,
    episode,
    maxPlayers: 4,
    joinable: false,
    name: opts.name ?? 'New quest',
    shortDescription: opts.shortDescription ?? 'A new quest.',
    longDescription: opts.longDescription ?? 'A new quest made in the quest editor.',
    floorAssignments: floors,
  });
}
