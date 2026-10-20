// Writers for the decompressed quest files: the inverse of formats/questbin.ts
// (parseQuestBin) and formats/questdat.ts (parseQuestDat). The layout is
// documented in those two files and in docs/QUESTFILES.md.
//
// Round trip rule: parse -> serialize reproduces the decompressed file byte for
// byte whenever the model is untouched. Header fields the model does not
// expose (unknown_a1/a2/a4/a5/a6, the create-item mask, the unused bytes of a
// floor assignment) are carried in `bin.data`'s header region and kept as they
// are; a model field is only written when it differs from what the header bytes
// parse to, so a field with two encodings (max_players 0 or 4) keeps its raw
// form.

import { parseQuestBinHeader, parseQuestBin, questCodeEnd, QUEST_BIN_HEADER_BASE_SIZE, QUEST_BIN_HEADER_FULL_SIZE, type QuestBin, type QuestBinHeader, type QuestFloorAssignment } from './questbin.ts';
import { parseQuestDat, QUEST_DAT_CHUNK_HEADER_SIZE, type QuestDat } from './questdat.ts';

export const QUEST_BIN_NAME_CHARS = 0x20;
export const QUEST_BIN_SHORT_DESCRIPTION_CHARS = 0x80;
export const QUEST_BIN_LONG_DESCRIPTION_CHARS = 0x120;

function writeUtf16(buf: Uint8Array, offset: number, maxChars: number, text: string, what: string): void {
  // The field must keep a terminator: the client reads it as a C string.
  if (text.length > maxChars - 1) throw new Error(`quest ${what} is ${text.length} characters, at most ${maxChars - 1} fit`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  buf.fill(0, offset, offset + maxChars * 2);
  for (let i = 0; i < text.length; i++) dv.setUint16(offset + i * 2, text.charCodeAt(i), true);
}

const sameAssignments = (a: QuestFloorAssignment[], b: QuestFloorAssignment[]): boolean =>
  a.length === b.length && a.every((x, i) => x.floor === b[i].floor && x.area === b[i].area && x.type === b[i].type && x.layoutVar === b[i].layoutVar && x.entitiesVar === b[i].entitiesVar);

const sameNumbers = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// Writes the fields of `h` that differ from `base` (what `head` parses to) into
// `head`, a header image of at least 0x398 (0x122C when h.hasFullHeader) bytes.
function overlayHeader(head: Uint8Array, h: QuestBinHeader, base: QuestBinHeader): void {
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (h.questNumber !== base.questNumber) dv.setUint16(0x10, h.questNumber, true);
  if (h.episode !== base.episode) head[0x14] = h.episode;
  if (h.maxPlayers !== base.maxPlayers) head[0x15] = h.maxPlayers;
  if (h.joinable !== base.joinable) head[0x16] = h.joinable ? 1 : 0;
  if (h.name !== base.name) writeUtf16(head, 0x18, QUEST_BIN_NAME_CHARS, h.name, 'name');
  if (h.shortDescription !== base.shortDescription) writeUtf16(head, 0x58, QUEST_BIN_SHORT_DESCRIPTION_CHARS, h.shortDescription, 'short description');
  if (h.longDescription !== base.longDescription) writeUtf16(head, 0x158, QUEST_BIN_LONG_DESCRIPTION_CHARS, h.longDescription, 'long description');
  if (!h.hasFullHeader) return;
  if (!sameNumbers(h.soloUnlockFlags, base.soloUnlockFlags)) {
    if (h.soloUnlockFlags.length > 8) throw new Error('a quest header holds at most 8 solo unlock flags');
    for (let i = 0; i < 8; i++) dv.setUint16(0x039c + i * 2, i < h.soloUnlockFlags.length ? h.soloUnlockFlags[i] : 0xffff, true);
  }
  if (!sameAssignments(h.floorAssignments, base.floorAssignments)) {
    if (h.floorAssignments.length > 0x10) throw new Error('a quest header holds at most 16 floor assignments');
    for (let i = 0; i < 0x10; i++) {
      const o = 0x03ac + i * 8;
      const fa = h.floorAssignments[i];
      if (fa) head.set([fa.floor, fa.area, fa.type, fa.layoutVar, fa.entitiesVar, 0, 0, 0], o);
      else head.fill(0xff, o, o + 8);
    }
  }
}

// The file as the three sections the header describes: header, bytecode, label
// table, in the order the header gives (the label table last in every shipped
// quest). The bytecode is taken from `bin.data` between header.textOffset and
// the label table (questCodeEnd); label offsets come from `bin.labels`.
export function serializeQuestBin(bin: QuestBin): Uint8Array {
  const h = bin.header;
  const codeFirst = h.textOffset <= h.labelTableOffset;
  const headerSize = Math.min(h.textOffset, h.labelTableOffset);
  if (headerSize < QUEST_BIN_HEADER_BASE_SIZE) throw new Error(`quest .bin sections start at 0x${headerSize.toString(16)}, inside the 0x398 header`);
  if (h.hasFullHeader && headerSize < QUEST_BIN_HEADER_FULL_SIZE) throw new Error('quest .bin claims the full header but its sections start inside it');
  const codeStart = h.textOffset;
  const codeEnd = questCodeEnd(bin);
  if (codeEnd < codeStart || codeEnd > bin.data.length) throw new Error('quest .bin bytecode range is outside the file data');
  const code = bin.data.subarray(codeStart, codeEnd);

  const tableBytes = bin.labels.length * 4;
  const total = headerSize + code.length + tableBytes;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  const head = out.subarray(0, headerSize);
  head.set(bin.data.subarray(0, Math.min(headerSize, bin.data.length)));

  // Compare against the header bytes as they were before this call touches them.
  const base = parseQuestBinHeader(head.slice());
  overlayHeader(head, h, base);

  const textOffset = codeFirst ? headerSize : headerSize + tableBytes;
  const tableOffset = codeFirst ? headerSize + code.length : headerSize;
  out.set(code, textOffset);
  bin.labels.forEach((l, i) => dv.setUint32(tableOffset + i * 4, (l - h.textOffset) >>> 0, true));
  dv.setUint32(0x00, textOffset, true);
  dv.setUint32(0x04, tableOffset, true);
  dv.setUint32(0x08, total, true);
  return out;
}

// What the editor changes in a .dat: a chunk's type, floor and payload. The
// chunk offsets and sizes are recomputed on write.
export interface QuestDatChunkInput {
  type: number;
  floor: number;
  data: Uint8Array;
}

// The chunk stream followed by the 0x10-byte all-zero end chunk the shipped
// files end with. Chunk sizes are always 0x10 + payload length: no padding
// chunk exists in any shipped quest.
export function serializeQuestDat(dat: QuestDat | { chunks: readonly QuestDatChunkInput[] }): Uint8Array {
  let total = QUEST_DAT_CHUNK_HEADER_SIZE; // the end chunk
  for (const c of dat.chunks) total += QUEST_DAT_CHUNK_HEADER_SIZE + c.data.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let at = 0;
  for (const c of dat.chunks) {
    dv.setUint32(at, c.type, true);
    dv.setUint32(at + 4, QUEST_DAT_CHUNK_HEADER_SIZE + c.data.length, true);
    dv.setUint32(at + 8, c.floor, true);
    dv.setUint32(at + 12, c.data.length, true);
    out.set(c.data, at + QUEST_DAT_CHUNK_HEADER_SIZE);
    at += QUEST_DAT_CHUNK_HEADER_SIZE + c.data.length;
  }
  return out;
}

// Builds a QuestDat (with the derived per-floor view) from bare chunks.
export function buildQuestDat(chunks: readonly QuestDatChunkInput[]): QuestDat {
  return parseQuestDat(serializeQuestDat({ chunks }));
}

// Replaces the payload of the first chunk with this type and floor, or appends
// a chunk; an empty payload removes it. Returns a new QuestDat.
export function setQuestDatChunk(dat: QuestDat, type: number, floor: number, data: Uint8Array): QuestDat {
  const chunks: QuestDatChunkInput[] = dat.chunks.map((c) => ({ type: c.type, floor: c.floor, data: c.data }));
  const i = chunks.findIndex((c) => c.type === type && c.floor === floor);
  if (i < 0) {
    if (data.length) chunks.push({ type, floor, data });
  } else if (data.length) chunks[i] = { type, floor, data };
  else chunks.splice(i, 1);
  return buildQuestDat(chunks);
}

// A fresh QuestBin from header fields and code: the header image of a
// from-scratch quest (every unknown field at newserv's default) plus the
// sections. `labelOffsets[i]` is the offset of label i inside `code`, or null
// when the label is unset (stored as 0xFFFFFFFF).
export interface NewQuestBinInput {
  header: Pick<QuestBinHeader, 'questNumber' | 'episode' | 'maxPlayers' | 'joinable' | 'name' | 'shortDescription' | 'longDescription' | 'soloUnlockFlags' | 'floorAssignments'>;
  unknownA1?: number;
  unknownA2?: number;
  unknownA4?: number;
  unknownA5?: number;
  unknownA6?: number;
  createItemMask?: readonly Uint8Array[]; // up to 0x40 entries of 0x38 bytes
  code: Uint8Array;
  labelOffsets: readonly (number | null)[];
}

export function buildQuestBin(input: NewQuestBinInput): QuestBin {
  const size = QUEST_BIN_HEADER_FULL_SIZE + input.code.length + input.labelOffsets.length * 4;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0x00, QUEST_BIN_HEADER_FULL_SIZE, true);
  dv.setUint32(0x04, QUEST_BIN_HEADER_FULL_SIZE + input.code.length, true);
  dv.setUint32(0x08, size, true);
  dv.setUint16(0x0c, input.unknownA1 ?? 0xffff, true);
  dv.setUint16(0x0e, input.unknownA2 ?? 0xffff, true);
  dv.setUint16(0x10, input.header.questNumber, true);
  dv.setUint16(0x12, input.unknownA6 ?? 0, true);
  out[0x14] = input.header.episode;
  out[0x15] = input.header.maxPlayers;
  out[0x16] = input.header.joinable ? 1 : 0;
  out[0x17] = input.unknownA4 ?? 0;
  writeUtf16(out, 0x18, QUEST_BIN_NAME_CHARS, input.header.name, 'name');
  writeUtf16(out, 0x58, QUEST_BIN_SHORT_DESCRIPTION_CHARS, input.header.shortDescription, 'short description');
  writeUtf16(out, 0x158, QUEST_BIN_LONG_DESCRIPTION_CHARS, input.header.longDescription, 'long description');
  dv.setUint32(0x398, input.unknownA5 ?? 0, true);
  if (input.header.soloUnlockFlags.length > 8) throw new Error('a quest header holds at most 8 solo unlock flags');
  for (let i = 0; i < 8; i++) dv.setUint16(0x039c + i * 2, i < input.header.soloUnlockFlags.length ? input.header.soloUnlockFlags[i] : 0xffff, true);
  if (input.header.floorAssignments.length > 0x10) throw new Error('a quest header holds at most 16 floor assignments');
  for (let i = 0; i < 0x10; i++) {
    const o = 0x03ac + i * 8;
    const fa = input.header.floorAssignments[i];
    if (fa) out.set([fa.floor, fa.area, fa.type, fa.layoutVar, fa.entitiesVar, 0, 0, 0], o);
    else out.fill(0xff, o, o + 8);
  }
  const mask = input.createItemMask ?? [];
  if (mask.length > 0x40) throw new Error('a quest header holds at most 64 create-item mask entries');
  mask.forEach((m, i) => {
    if (m.length !== 0x38) throw new Error('a create-item mask entry is 0x38 bytes');
    out.set(m, 0x042c + i * 0x38);
  });
  out.set(input.code, QUEST_BIN_HEADER_FULL_SIZE);
  const tableAt = QUEST_BIN_HEADER_FULL_SIZE + input.code.length;
  input.labelOffsets.forEach((o, i) => dv.setUint32(tableAt + i * 4, o === null ? 0xffffffff : o, true));
  return parseQuestBin(out);
}
