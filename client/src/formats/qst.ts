// .qst: a quest as one file, the command stream the server would send, recorded
// back to back. Layouts from newserv src/Quest.cc (decode_qst_data, encode_qst_file,
// add_open_file_command_t, add_write_file_commands_t, encode_download_quest_data),
// src/CommandFormats.hh (S_OpenFile_BB_44_A6, S_OpenFile_PC_GC_44_A6,
// S_OpenFile_DC_44_A6, S_WriteFile_13_A7) and src/PSOProtocol.hh (the command
// headers), MIT license.
//
//   for each file (bin, then dat):   open file   (44 online, A6 download)
//   for each file, each 0x400 chunk: write file  (13 online, A7 download)
//
// Command header by version (the size counts the header):
//   BB:      u16 size, u16 command, u32 flag   8 bytes; every command is 8-aligned
//            (a write command is 0x41C bytes + 4 zero bytes)
//   PC:      u16 size, u8 command, u8 flag     4 bytes, no alignment
//   DC, GC:  u8 command, u8 flag, u16 size     4 bytes, no alignment
// flag is 0 for an open file and the chunk index (offset / 0x400) for a write.
//
// Bodies:
//   BB open (0x50):   u8 unused[0x22], u16 type, char filename[0x10] at 0x24,
//                     u32 file_size at 0x34, char name[0x18] at 0x38 ("PSO/<name>")
//   PC / GC open (0x38): char name[0x22] ("PSO/<name>") at 0, u16 type at 0x22,
//                     char filename[0x10] at 0x24, u32 file_size at 0x34
//   DC open (0x38):   the same with a u8 type at 0x22 and filename[0x11] at 0x23
//   XB open (0x50):   the PC / GC body (header DC-style, 4 bytes) plus xb_filename[0x10]
//                     at 0x38 ("quest<N>_<lang>.dat", ASCII) and content_meta u32 at
//                     0x48 (0x30000000 | quest number), then 4 unused bytes
//   write (0x414, all versions): char filename[0x10], u8 data[0x400], u32 data_size
//                     at 0x410
//
// file_size is the size of the file as it is stored: the PRS stream on BB; on
// DC / PC / GC the download payload (psov2.ts, an 8-byte header and the PRS stream
// encrypted with PSO V2) for an A6 / A7 .qst, and the plain PRS stream for a 44 / 13
// one. The chunks are slices of the stored bytes. The .bin and .dat inside are the
// same PRS files the server sends (net/quests.ts).
//
// XB writes the same write commands as GC (no BB alignment). Its download files
// are the PSO V2 payload, as on DC / PC / GC (newserv decode_qst_data_t applies
// its DLQ decoder to every A6 file). The BB download payload is plain PRS (see
// QST_COMMAND_OPEN_FILE_DOWNLOAD).

import { prsDecompress } from './prs.ts';
import { prsCompressOptimal } from './prscompress.ts';
import { decodeDownloadQuestData, encodeDownloadQuestData } from './psov2.ts';
import { parseQuestBin, type QuestBin } from './questbin.ts';
import { parseQuestDat, type QuestDat } from './questdat.ts';
import { serializeQuestBin, serializeQuestDat } from './questwrite.ts';

export const QST_COMMAND_OPEN_FILE = 0x44;
export const QST_COMMAND_WRITE_FILE = 0x13;
// The download-quest pair (the original client's memory-card quests, and the
// lobby's A6/A7 transfer): the same bodies as 44 / 13. On DC / PC / GC the files
// are the PSO V2 download payload (psov2.ts). On BB they are plain PRS, the same
// bytes as 44 / 13. Evidence (2026-10-25):
//   * PsoBB.exe 0x006d0174 decompress_received_quest_files (refsrc
//     src/Psobb.exe-5-10-2026.c) runs prs_decompress on the received .bin and
//     .dat with no decrypt step; the only other BB quest-file receive path,
//     HandleQuestFileHeader / receive_quest_chunk, stores the bytes as they come.
//     The exe has no 0xA6 / 0xA7 case of its own.
//   * newserv refuses to build a BB download .qst (Quest.cc create_download_quest:
//     "PSOBB does not support download quests"), so no newserv output is a BB A6.
//   * newserv's decode_qst_data_t applies its DLQ decoder to every A6 file, BB
//     included; on a plain-PRS BB A6 file that decoder fails ("backreference offset
//     beyond beginning of output"). That is newserv's assumption, not the client's.
// The port follows the client: BB A6 / A7 files are plain PRS.
export const QST_COMMAND_OPEN_FILE_DOWNLOAD = 0xa6;
export const QST_COMMAND_WRITE_FILE_DOWNLOAD = 0xa7;
export const QST_CHUNK_SIZE = 0x400;

// The game versions a .qst is written for.
export type QstVersion = 'BB' | 'DC' | 'PC' | 'GC' | 'XB';

interface QstLayout {
  headerSize: number; // 8 on BB, 4 otherwise
  openBody: number; // 0x50 on BB, 0x38 otherwise
  nameAt: number; // offset of the "PSO/<name>" field in the open body
  nameMax: number; // its size in bytes
  nameTerminated: boolean; // BB writes it as a C string; the others copy the bytes raw (newserv assign_raw)
  filenameAt: number; // offset of the file name in the open body
  filenameMax: number; // its size in bytes (the name is at most filenameMax - 1 characters)
  align: boolean; // BB only: commands are 8-aligned and write commands carry 4 zero bytes
}

const LAYOUTS: Record<QstVersion, QstLayout> = {
  BB: { headerSize: 8, openBody: 0x50, nameAt: 0x38, nameMax: 0x18, nameTerminated: true, filenameAt: 0x24, filenameMax: 0x10, align: true },
  DC: { headerSize: 4, openBody: 0x38, nameAt: 0, nameMax: 0x22, nameTerminated: false, filenameAt: 0x23, filenameMax: 0x11, align: false },
  PC: { headerSize: 4, openBody: 0x38, nameAt: 0, nameMax: 0x22, nameTerminated: false, filenameAt: 0x24, filenameMax: 0x10, align: false },
  GC: { headerSize: 4, openBody: 0x38, nameAt: 0, nameMax: 0x22, nameTerminated: false, filenameAt: 0x24, filenameMax: 0x10, align: false },
  XB: { headerSize: 4, openBody: 0x50, nameAt: 0, nameMax: 0x22, nameTerminated: false, filenameAt: 0x24, filenameMax: 0x10, align: false },
};
const FILE_SIZE_AT = 0x34; // in the open body, every version
// XB only: the open body's xb_filename (pstring, 0x10, ASCII) and content_meta (u32).
const XB_FILENAME_AT = 0x38;
const XB_FILENAME_MAX = 0x10;
const XB_CONTENT_META_AT = 0x48;
const WRITE_BODY = 0x414;
const WRITE_DATA_SIZE_AT = 0x410; // in the write body
const WRITE_DATA_AT = 0x10;

export interface QstFile {
  filename: string; // e.g. "q101.bin"
  compressed: Uint8Array; // the PRS stream (decrypted when the file was a DC / PC / GC download payload)
  data: Uint8Array; // decompressed
  seed?: number; // the PSO V2 seed of a DC / PC / GC download payload
}

export interface ParsedQstFiles {
  version: QstVersion;
  name: string; // the "PSO/..." name without the prefix
  files: QstFile[]; // in the order their open-file commands appear
  download: boolean; // written with A6 / A7 rather than 44 / 13
  binFilename: string;
  datFilename: string;
  xb?: XbMeta; // XB only: from the open-file commands
}

// XB open-file fields (newserv S_OpenFile_XB_44_A6): the Xbox file name and the
// content_meta word (0x30000000 | quest number).
export interface XbMeta {
  xbFilename: string;
  contentMeta: number;
}

export interface ParsedQst extends ParsedQstFiles {
  bin: QuestBin;
  dat: QuestDat;
}

export interface PackQstOptions {
  // Base file name without extension; default "q<quest number>". The name plus
  // ".bin" must fit the version's file name field (at most 11 characters on BB,
  // PC and GC, 12 on DC).
  filename?: string;
  // The "PSO/<name>" string; default the quest's header name when that is
  // ASCII, else the file name. Truncated to the version's name field.
  name?: string;
  // Write the A6 / A7 download pair instead of 44 / 13.
  download?: boolean;
  // The game version of the .qst. Default BB.
  version?: QstVersion;
  // XB only: the language (0..7, as newserv's Language) that names the Xbox file
  // "quest<N>_<c>.dat" with c the lowercase language letter. Default 1 (English).
  language?: number;
  // PSO V2 seeds of the .bin and the .dat payloads of a DC / PC / GC download
  // .qst (required there: newserv picks random ones, this port needs them to be
  // reproducible). Each must be 1..0xFFFFFFFF.
  seeds?: { bin: number; dat: number };
}

const readCString = (d: Uint8Array, offset: number, max: number): string => {
  let s = '';
  for (let i = 0; i < max && d[offset + i]; i++) s += String.fromCharCode(d[offset + i]);
  return s;
};

// Limits for untrusted input (the admin panel's quest upload): no real quest
// comes near them.
const QST_MAX_COMPRESSED = 8 * 1024 * 1024;
const QST_MAX_DECOMPRESSED = 16 * 1024 * 1024;

// The version of a .qst from its first command (newserv decode_qst_data): BB
// starts 58 00 44 / A6 00, PC 3C 00 44 / A6 (the size, then the command byte),
// DC and GC 44 / A6 ?? 3C 00. DC and GC are told apart by the open body's type
// field: a DC file has a file name's first character there, which is above 3.
export function qstVersion(bytes: Uint8Array): QstVersion {
  if (bytes.length < 8) throw new Error('qst: file too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isOpen = (c: number): boolean => c === QST_COMMAND_OPEN_FILE || c === QST_COMMAND_OPEN_FILE_DOWNLOAD;
  if (dv.getUint16(0, true) === 0x58 && isOpen(dv.getUint16(2, true))) return 'BB';
  if (dv.getUint16(0, true) === 0x3c && isOpen(bytes[2])) return 'PC';
  if (isOpen(bytes[0]) && dv.getUint16(2, true) === 0x3c) {
    if (bytes.length < 4 + 0x24) throw new Error('qst: open file command too short');
    return dv.getUint16(4 + 0x22, true) > 3 ? 'DC' : 'GC';
  }
  if (isOpen(bytes[0]) && dv.getUint16(2, true) === 0x54) return 'XB';
  throw new Error('qst: not a Blue Burst, PC, DC or GC quest file');
}

interface CommandHeader {
  size: number;
  command: number;
  flag: number;
}

function readHeader(dv: DataView, at: number, version: QstVersion): CommandHeader {
  if (version === 'BB') return { size: dv.getUint16(at, true), command: dv.getUint16(at + 2, true), flag: dv.getUint32(at + 4, true) };
  if (version === 'PC') return { size: dv.getUint16(at, true), command: dv.getUint8(at + 2), flag: dv.getUint8(at + 3) };
  return { size: dv.getUint16(at + 2, true), command: dv.getUint8(at), flag: dv.getUint8(at + 1) };
}

function writeHeader(dv: DataView, at: number, version: QstVersion, size: number, command: number, flag: number): void {
  if (version === 'BB') {
    dv.setUint16(at, size, true);
    dv.setUint16(at + 2, command, true);
    dv.setUint32(at + 4, flag, true);
  } else if (version === 'PC') {
    dv.setUint16(at, size, true);
    dv.setUint8(at + 2, command);
    dv.setUint8(at + 3, flag);
  } else {
    dv.setUint8(at, command);
    dv.setUint8(at + 1, flag);
    dv.setUint16(at + 2, size, true);
  }
}

// Reads the command stream of a .qst (any of the four versions) and returns its
// files, decoding the download payloads of DC / PC / GC. Does not parse the quest.
export function parseQstFiles(bytes: Uint8Array): ParsedQstFiles {
  const version = qstVersion(bytes);
  const layout = LAYOUTS[version];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  interface Pending {
    filename: string;
    name: string;
    size: number;
    body: number; // offset of the open command's body
    blocks: { index: number; data: Uint8Array }[];
  }
  const pending = new Map<string, Pending>();
  const order: Pending[] = [];
  let inOrder = true;
  let download: boolean | null = null;
  let at = 0;
  while (at < bytes.length) {
    if (layout.align) at = (at + 7) & ~7;
    if (at >= bytes.length) break;
    if (at + layout.headerSize > bytes.length) throw new Error(`qst: truncated command header at 0x${at.toString(16)}`);
    const { size, command, flag } = readHeader(dv, at, version);
    const body = at + layout.headerSize;
    const isOpen = command === QST_COMMAND_OPEN_FILE || command === QST_COMMAND_OPEN_FILE_DOWNLOAD;
    const isWrite = command === QST_COMMAND_WRITE_FILE || command === QST_COMMAND_WRITE_FILE_DOWNLOAD;
    if (isOpen || isWrite) {
      const isDownload = command === QST_COMMAND_OPEN_FILE_DOWNLOAD || command === QST_COMMAND_WRITE_FILE_DOWNLOAD;
      if (download !== null && download !== isDownload) throw new Error(`qst: 44/13 and A6/A7 commands mixed at 0x${at.toString(16)}`);
      download = isDownload;
    }
    if (isOpen) {
      if (size !== layout.headerSize + layout.openBody || body + layout.openBody > bytes.length) {
        throw new Error(`qst: open file command at 0x${at.toString(16)} has size ${size}, not ${layout.headerSize + layout.openBody} (${version} layout)`);
      }
      const filename = readCString(bytes, body + layout.filenameAt, layout.filenameMax);
      if (pending.has(filename)) throw new Error(`qst: file ${filename} is opened twice`);
      const p: Pending = {
        filename,
        name: readCString(bytes, body + layout.nameAt, layout.nameMax).replace(/^PSO\//, ''),
        size: dv.getUint32(body + FILE_SIZE_AT, true),
        body,
        blocks: [],
      };
      pending.set(filename, p);
      order.push(p);
    } else if (isWrite) {
      // Some tools stored the 4 alignment bytes inside the command size.
      if (size < layout.headerSize + WRITE_BODY || body + WRITE_BODY > bytes.length) throw new Error(`qst: write file command at 0x${at.toString(16)} has size ${size}`);
      const filename = readCString(bytes, body, 0x10);
      const dataSize = dv.getUint32(body + WRITE_DATA_SIZE_AT, true);
      if (dataSize > QST_CHUNK_SIZE) throw new Error(`qst: chunk ${filename}:${flag} claims ${dataSize} bytes`);
      const p = pending.get(filename);
      if (!p) throw new Error(`qst: chunk for ${filename} before its open file command`);
      if (flag * QST_CHUNK_SIZE + dataSize > p.size) throw new Error(`qst: chunk ${filename}:${flag} extends past the end of the file`);
      if (flag) inOrder = false;
      p.blocks.push({ index: flag, data: bytes.subarray(body + WRITE_DATA_AT, body + WRITE_DATA_AT + dataSize) });
    } else {
      throw new Error(`qst: unexpected command 0x${command.toString(16)} at 0x${at.toString(16)}`);
    }
    at += Math.max(size, layout.headerSize);
  }

  const isDownload = download === true;
  let xb: XbMeta | undefined;
  if (version === 'XB') {
    const first = order[0];
    if (first) {
      xb = {
        xbFilename: readCString(bytes, first.body + XB_FILENAME_AT, XB_FILENAME_MAX),
        contentMeta: dv.getUint32(first.body + XB_CONTENT_META_AT, true),
      };
    }
  }
  const files: QstFile[] = order.map((p) => {
    if (p.size > QST_MAX_COMPRESSED) throw new Error(`qst: ${p.filename} claims ${p.size} bytes`);
    const stored = new Uint8Array(p.size);
    if (inOrder) {
      // Chunk indexes all zero: some tools wrote them that way. Assume order.
      let o = 0;
      for (const b of p.blocks) {
        stored.set(b.data, o);
        o += b.data.length;
      }
    } else {
      for (const b of p.blocks) stored.set(b.data, b.index * QST_CHUNK_SIZE);
    }
    if (isDownload && version !== 'BB') {
      const dlq = decodeDownloadQuestData(stored);
      return { filename: p.filename, compressed: dlq.compressed, data: prsDecompress(dlq.compressed, QST_MAX_DECOMPRESSED), seed: dlq.seed };
    }
    return { filename: p.filename, compressed: stored, data: prsDecompress(stored, QST_MAX_DECOMPRESSED) };
  });
  const binFile = files.find((f) => f.filename.endsWith('.bin'));
  const datFile = files.find((f) => f.filename.endsWith('.dat'));
  if (!binFile || !datFile) throw new Error(`qst: expected a .bin and a .dat, found ${files.map((f) => f.filename).join(', ') || 'no files'}`);
  return {
    version,
    name: order[0]?.name ?? '',
    files,
    binFilename: binFile.filename,
    datFilename: datFile.filename,
    download: isDownload,
    ...(xb ? { xb } : {}),
  };
}

// Blue Burst only: the .bin and .dat are parsed as BB quests. Other versions
// give their files from parseQstFiles.
export function parseQst(bytes: Uint8Array): ParsedQst {
  const q = parseQstFiles(bytes);
  if (q.version !== 'BB') throw new Error(`qst: ${q.version} quest files are not parsed as quests; use parseQstFiles`);
  const binFile = q.files.find((f) => f.filename === q.binFilename)!;
  const datFile = q.files.find((f) => f.filename === q.datFilename)!;
  return { ...q, bin: parseQuestBin(binFile.data), dat: parseQuestDat(datFile.data) };
}

// Writes ASCII into a fixed field; a terminated field keeps its last byte for the NUL.
const writeAscii = (d: Uint8Array, offset: number, max: number, s: string, terminated = true): void => {
  const n = Math.min(s.length, terminated ? max - 1 : max);
  for (let i = 0; i < n; i++) d[offset + i] = s.charCodeAt(i) & 0x7f;
};

export interface RawQstFile {
  filename: string; // "<base>.bin" / "<base>.dat"
  data: Uint8Array; // already PRS-compressed
  seed?: number | undefined; // the PSO V2 seed of the download payload (DC / PC / GC download .qst)
}

// Writes the open-file and write-file commands for PRS-compressed files, in the
// given order: every open file command first, then the write commands. The name
// is "PSO/<name>" (truncated to the version's name field). On a DC / PC / GC
// download .qst each file's bytes are encoded with PSO V2 (psov2.ts) under its
// seed; BB writes the PRS bytes as they are.
export function packQstFiles(files: RawQstFile[], name: string, download = false, version: QstVersion = 'BB', xb?: XbMeta): Uint8Array {
  const layout = LAYOUTS[version];
  if (version === 'XB') {
    if (!xb) throw new RangeError('qst: an XB .qst needs its xb_filename and content_meta');
    if (!/^[\x20-\x7e]{1,16}$/.test(xb.xbFilename)) throw new RangeError(`qst: XB file name "${xb.xbFilename}" must be 1..16 printable ASCII characters`);
    if (!Number.isInteger(xb.contentMeta) || xb.contentMeta < 0 || xb.contentMeta > 0xffffffff) throw new RangeError('qst: XB content_meta is not a u32');
  }
  const openCmd = download ? QST_COMMAND_OPEN_FILE_DOWNLOAD : QST_COMMAND_OPEN_FILE;
  const writeCmd = download ? QST_COMMAND_WRITE_FILE_DOWNLOAD : QST_COMMAND_WRITE_FILE;
  const entries = files.map((f) => {
    if (!download || version === 'BB') return { filename: f.filename, stored: f.data };
    if (f.seed === undefined) throw new RangeError(`qst: ${f.filename} needs a seed for a ${version} download .qst`);
    return { filename: f.filename, stored: encodeDownloadQuestData(f.data, f.seed) };
  });
  const maxFlag = version === 'BB' ? 0xffffffff : 0xff; // the flag is one byte outside BB
  const writeSize = layout.headerSize + WRITE_BODY + (layout.align ? 4 : 0);
  let total = 0;
  for (const e of entries) total += layout.headerSize + layout.openBody + Math.ceil(e.stored.length / QST_CHUNK_SIZE) * writeSize;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let at = 0;
  for (const e of entries) {
    writeHeader(dv, at, version, layout.headerSize + layout.openBody, openCmd, 0);
    const body = at + layout.headerSize;
    writeAscii(out, body + layout.nameAt, layout.nameMax, `PSO/${name}`, layout.nameTerminated);
    writeAscii(out, body + layout.filenameAt, layout.filenameMax, e.filename);
    dv.setUint32(body + FILE_SIZE_AT, e.stored.length, true);
    if (xb) {
      writeAscii(out, body + XB_FILENAME_AT, XB_FILENAME_MAX, xb.xbFilename, false);
      dv.setUint32(body + XB_CONTENT_META_AT, xb.contentMeta, true);
    }
    at += layout.headerSize + layout.openBody;
  }
  for (const e of entries) {
    for (let z = 0, index = 0; z < e.stored.length; z += QST_CHUNK_SIZE, index++) {
      if (index > maxFlag) throw new RangeError(`qst: ${e.filename} has more chunks than a ${version} write command can index`);
      const chunk = e.stored.subarray(z, z + QST_CHUNK_SIZE);
      writeHeader(dv, at, version, layout.headerSize + WRITE_BODY, writeCmd, index);
      const body = at + layout.headerSize;
      writeAscii(out, body, 0x10, e.filename);
      out.set(chunk, body + WRITE_DATA_AT);
      dv.setUint32(body + WRITE_DATA_SIZE_AT, chunk.length, true);
      at += writeSize; // BB: 4 zero alignment bytes, already zero in the buffer
    }
  }
  return out;
}

// The language override of a download .bin (newserv create_download_quest, Quest.cc):
// the DC v1/v2, PC and GC / Xbox .bin headers keep a language byte at 0x10, and the
// override writes it before the download is encoded. Takes the PRS .bin, returns the
// PRS .bin with that byte set (the rest of the decompressed file is unchanged).
// Language 0xFF (UNKNOWN) changes nothing. BB .bin files have no language field.
export const QST_LANGUAGE_UNKNOWN = 0xff;
export function withBinLanguage(prsBin: Uint8Array, version: QstVersion, language: number): Uint8Array {
  if (version === 'BB') throw new RangeError('qst: a BB .bin has no language field');
  if (language === QST_LANGUAGE_UNKNOWN) return prsBin;
  if (!Number.isInteger(language) || language < 0 || language > 7) throw new RangeError(`qst: language ${language} is not 0..7 or 0xFF`);
  const bin = prsDecompress(prsBin, QST_MAX_DECOMPRESSED);
  if (bin.length <= 0x10) throw new Error('qst: .bin is too small for a header');
  bin[0x10] = language;
  return prsCompressOptimal(bin);
}

// Packs a quest into a .qst. The .bin and .dat are serialized (questwrite.ts)
// and PRS-compressed here.
export function packQst(bin: QuestBin, dat: QuestDat, opts: PackQstOptions = {}): Uint8Array {
  const version = opts.version ?? 'BB';
  const download = opts.download === true;
  const language = opts.language ?? 1;
  if (!Number.isInteger(language) || language < 0 || language > 7) throw new RangeError(`qst: language ${language} is not 0..7`);
  const base = opts.filename ?? `q${bin.header.questNumber}`;
  if (!/^[\x21-\x7e]{1,12}$/.test(base)) throw new Error(`qst: file name "${base}" must be 1..12 printable ASCII characters`);
  const fieldMax = LAYOUTS[version].filenameMax;
  if (base.length + 4 > fieldMax - 1) throw new Error(`qst: "${base}.bin" does not fit the ${version} file name field (${fieldMax} bytes)`);
  if (download && version !== 'BB' && !opts.seeds) throw new RangeError(`qst: a ${version} download .qst needs seeds for its .bin and .dat`);
  // The field is ASCII; a Japanese quest name falls back to the file name.
  const questName = bin.header.name;
  const name = opts.name ?? (/^[\x20-\x7e]+$/.test(questName) ? questName : base);
  return packQstFiles(
    [
      { filename: `${base}.bin`, data: prsCompressOptimal(serializeQuestBin(bin)), seed: opts.seeds?.bin },
      { filename: `${base}.dat`, data: prsCompressOptimal(serializeQuestDat(dat)), seed: opts.seeds?.dat },
    ],
    name,
    download,
    version,
    version === 'XB' ? { xbFilename: `quest${bin.header.questNumber}_${'jegfsbtk'[language]}.dat`, contentMeta: (0x30000000 | bin.header.questNumber) >>> 0 } : undefined,
  );
}
