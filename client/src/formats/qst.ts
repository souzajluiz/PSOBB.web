// .qst: a Blue Burst online quest as one file, the 44 / 13 command stream the
// server would send, recorded back to back. Layout from newserv
// src/Quest.cc (decode_qst_data_t, encode_qst_file, MIT license) and
// src/CommandFormats.hh (S_OpenFile_BB_44_A6, S_WriteFile_13_A7):
//
//   for each file (bin, then dat):   44 open file
//   for each file, each 0x400 chunk: 13 write file
//
// Every command starts with the 8-byte BB header
//   u16 size (including the header), u16 command, u32 flag
// and the stream is aligned to 8 bytes.
//
//   44 body (0x50): u8 unused[0x22], u16 type (0), char filename[0x10],
//                   u32 file_size, char name[0x18] ("PSO/<quest name>")
//                   size = 0x58, flag = 0
//   13 body (0x414): char filename[0x10], u8 data[0x400], u32 data_size
//                   size = 0x41C, flag = chunk index; 4 zero bytes follow to
//                   keep the next command 8-byte aligned (size 0x41C is
//                   not a multiple of 8)
//
// file_size is the size of the PRS-compressed file; the chunks are slices of
// the compressed bytes. The .bin and .dat inside are the same PRS files the
// server sends (net/quests.ts).

import { prsDecompress } from './prs.ts';
import { prsCompress } from './prscompress.ts';
import { parseQuestBin, type QuestBin } from './questbin.ts';
import { parseQuestDat, type QuestDat } from './questdat.ts';
import { serializeQuestBin, serializeQuestDat } from './questwrite.ts';

export const QST_COMMAND_OPEN_FILE = 0x44;
export const QST_COMMAND_WRITE_FILE = 0x13;
export const QST_CHUNK_SIZE = 0x400;
const HEADER_SIZE = 8;
const OPEN_FILE_BODY = 0x50;
const WRITE_FILE_BODY = 0x414;

export interface QstFile {
  filename: string; // e.g. "q101.bin"
  compressed: Uint8Array; // as stored in the .qst (PRS)
  data: Uint8Array; // decompressed
}

export interface ParsedQst {
  name: string; // the "PSO/..." name without the prefix
  files: QstFile[]; // in the order their open-file commands appear
  binFilename: string;
  datFilename: string;
  bin: QuestBin;
  dat: QuestDat;
}

export interface PackQstOptions {
  // Base file name without extension; default "q<quest number>". At most 12
  // characters (the field is 0x10 bytes with ".bin"/".dat" and a terminator).
  filename?: string;
  // The "PSO/<name>" string; default the quest's header name when that is
  // ASCII, else the file name. Truncated to the
  // 0x18-byte field.
  name?: string;
}

const readCString = (d: Uint8Array, offset: number, max: number): string => {
  let s = '';
  for (let i = 0; i < max && d[offset + i]; i++) s += String.fromCharCode(d[offset + i]);
  return s;
};

export function parseQst(bytes: Uint8Array): ParsedQst {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  interface Pending {
    filename: string;
    name: string;
    size: number;
    blocks: { index: number; data: Uint8Array }[];
  }
  const pending = new Map<string, Pending>();
  const order: Pending[] = [];
  let inOrder = true;
  let at = 0;
  while (at < bytes.length) {
    at = (at + 7) & ~7;
    if (at >= bytes.length) break;
    if (at + HEADER_SIZE > bytes.length) throw new Error(`qst: truncated command header at 0x${at.toString(16)}`);
    const size = dv.getUint16(at, true);
    const command = dv.getUint16(at + 2, true);
    const flag = dv.getUint32(at + 4, true);
    const body = at + HEADER_SIZE;
    if (command === 0xa6 || command === 0xa7) throw new Error('qst: download quests (A6 / A7) are encrypted and not supported');
    if (command === QST_COMMAND_OPEN_FILE) {
      if (size !== HEADER_SIZE + OPEN_FILE_BODY || body + OPEN_FILE_BODY > bytes.length) throw new Error(`qst: open file command at 0x${at.toString(16)} has size ${size}, not ${HEADER_SIZE + OPEN_FILE_BODY} (is this a Blue Burst qst?)`);
      const filename = readCString(bytes, body + 0x24, 0x10);
      if (pending.has(filename)) throw new Error(`qst: file ${filename} is opened twice`);
      const p: Pending = { filename, name: readCString(bytes, body + 0x38, 0x18).replace(/^PSO\//, ''), size: dv.getUint32(body + 0x34, true), blocks: [] };
      pending.set(filename, p);
      order.push(p);
    } else if (command === QST_COMMAND_WRITE_FILE) {
      // Some tools stored the 4 alignment bytes inside the command size.
      if (size < HEADER_SIZE + WRITE_FILE_BODY || body + WRITE_FILE_BODY > bytes.length) throw new Error(`qst: write file command at 0x${at.toString(16)} has size ${size}`);
      const filename = readCString(bytes, body, 0x10);
      const dataSize = dv.getUint32(body + 0x414 - 4, true);
      if (dataSize > QST_CHUNK_SIZE) throw new Error(`qst: chunk ${filename}:${flag} claims ${dataSize} bytes`);
      const p = pending.get(filename);
      if (!p) throw new Error(`qst: chunk for ${filename} before its open file command`);
      if (flag * QST_CHUNK_SIZE + dataSize > p.size) throw new Error(`qst: chunk ${filename}:${flag} extends past the end of the file`);
      if (flag) inOrder = false;
      p.blocks.push({ index: flag, data: bytes.subarray(body + 0x10, body + 0x10 + dataSize) });
    } else {
      throw new Error(`qst: unexpected command 0x${command.toString(16)} at 0x${at.toString(16)}`);
    }
    at += Math.max(size, HEADER_SIZE);
  }

  const files: QstFile[] = order.map((p) => {
    const compressed = new Uint8Array(p.size);
    if (inOrder) {
      // Chunk indexes all zero: some tools wrote them that way. Assume order.
      let o = 0;
      for (const b of p.blocks) {
        compressed.set(b.data, o);
        o += b.data.length;
      }
    } else {
      for (const b of p.blocks) compressed.set(b.data, b.index * QST_CHUNK_SIZE);
    }
    return { filename: p.filename, compressed, data: prsDecompress(compressed) };
  });
  const binFile = files.find((f) => f.filename.endsWith('.bin'));
  const datFile = files.find((f) => f.filename.endsWith('.dat'));
  if (!binFile || !datFile) throw new Error(`qst: expected a .bin and a .dat, found ${files.map((f) => f.filename).join(', ') || 'no files'}`);
  return {
    name: order[0]?.name ?? '',
    files,
    binFilename: binFile.filename,
    datFilename: datFile.filename,
    bin: parseQuestBin(binFile.data),
    dat: parseQuestDat(datFile.data),
  };
}

const writeAscii = (d: Uint8Array, offset: number, max: number, s: string): void => {
  for (let i = 0; i < Math.min(s.length, max - 1); i++) d[offset + i] = s.charCodeAt(i) & 0x7f;
};

// Packs a quest into a .qst. The .bin and .dat are serialized (questwrite.ts)
// and PRS-compressed here.
export function packQst(bin: QuestBin, dat: QuestDat, opts: PackQstOptions = {}): Uint8Array {
  const base = opts.filename ?? `q${bin.header.questNumber}`;
  if (!/^[\x21-\x7e]{1,12}$/.test(base)) throw new Error(`qst: file name "${base}" must be 1..12 printable ASCII characters`);
  // The field is ASCII; a Japanese quest name falls back to the file name.
  const questName = bin.header.name;
  const name = `PSO/${opts.name ?? (/^[\x20-\x7e]+$/.test(questName) ? questName : base)}`;
  const files = [
    { filename: `${base}.bin`, data: prsCompress(serializeQuestBin(bin)) },
    { filename: `${base}.dat`, data: prsCompress(serializeQuestDat(dat)) },
  ];
  let total = 0;
  for (const f of files) total += HEADER_SIZE + OPEN_FILE_BODY + Math.ceil(f.data.length / QST_CHUNK_SIZE) * (HEADER_SIZE + WRITE_FILE_BODY + 4);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let at = 0;
  const header = (size: number, command: number, flag: number): void => {
    dv.setUint16(at, size, true);
    dv.setUint16(at + 2, command, true);
    dv.setUint32(at + 4, flag, true);
  };
  for (const f of files) {
    header(HEADER_SIZE + OPEN_FILE_BODY, QST_COMMAND_OPEN_FILE, 0);
    const body = at + HEADER_SIZE;
    writeAscii(out, body + 0x24, 0x10, f.filename);
    dv.setUint32(body + 0x34, f.data.length, true);
    writeAscii(out, body + 0x38, 0x18, name);
    at += HEADER_SIZE + OPEN_FILE_BODY;
  }
  for (const f of files) {
    for (let z = 0, index = 0; z < f.data.length; z += QST_CHUNK_SIZE, index++) {
      const chunk = f.data.subarray(z, z + QST_CHUNK_SIZE);
      header(HEADER_SIZE + WRITE_FILE_BODY, QST_COMMAND_WRITE_FILE, index);
      const body = at + HEADER_SIZE;
      writeAscii(out, body, 0x10, f.filename);
      out.set(chunk, body + 0x10);
      dv.setUint32(body + 0x10 + QST_CHUNK_SIZE, chunk.length, true);
      at += HEADER_SIZE + WRITE_FILE_BODY + 4; // 4 zero alignment bytes
    }
  }
  return out;
}
