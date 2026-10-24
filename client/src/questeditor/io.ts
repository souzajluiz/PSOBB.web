// Quest editor: reading and writing quest files. This is the only module that
// uses the write side (formats/prscompress.ts, questwrite.ts, qst.ts,
// questasm.ts); the model and the panels do not import it.
//
// Quest files on disk are PRS-compressed (.bin, .dat) as they are on the wire; a
// .qst holds both. The functions here accept either form of a loose file.

import { prsDecompress } from '../formats/prs.ts';
import { prsCompressOptimal } from '../formats/prscompress.ts';
import { parseQuestBin } from '../formats/questbin.ts';
import { parseQuestDat } from '../formats/questdat.ts';
import { assembleQuest, disassembleQuest } from '../formats/questasm.ts';
import { serializeQuestBin, serializeQuestDat } from '../formats/questwrite.ts';
import { packQst, parseQst } from '../formats/qst.ts';
import type { EditableHeader } from './binhead.ts';
import { QuestDocument } from './model.ts';

export interface NamedBytes {
  name: string;
  bytes: Uint8Array;
}

const u32 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(at, true);

// A .bin that is not compressed starts with its text / label table offsets and
// carries its own size at +8.
function looksLikeBin(d: Uint8Array): boolean {
  return d.length >= 0x398 && u32(d, 0) >= 0x398 && u32(d, 0) < d.length && u32(d, 4) >= 0x398 && u32(d, 4) <= d.length && u32(d, 8) <= d.length && u32(d, 8) >= 0x398;
}

// A .dat that is not compressed starts with a chunk header (type 1..5, size).
function looksLikeDat(d: Uint8Array): boolean {
  if (d.length < 16) return false;
  const type = u32(d, 0);
  const size = u32(d, 4);
  return type <= 5 && (type === 0 || (size >= 16 && size <= d.length));
}

export const stemOf = (fileName: string): string => fileName.replace(/^.*[\\/]/, '').replace(/\.(qst|bin|dat)$/i, '');

export function questFromBytes(bin: Uint8Array, dat: Uint8Array | null, fileName: string): QuestDocument {
  const binBytes = looksLikeBin(bin) ? bin : prsDecompress(bin);
  const questBin = parseQuestBin(binBytes);
  let questDat = null;
  if (dat) questDat = parseQuestDat(looksLikeDat(dat) ? dat : prsDecompress(dat));
  const doc = QuestDocument.fromQuest(questBin, questDat, fileName);
  if (!dat) doc.warnings.push('No .dat was given: the quest has no objects, enemies or events.');
  return doc;
}

// Opens one .qst, or a .bin with its .dat (any order, any number of files; the
// first file of each kind wins).
export function openQuestFiles(files: NamedBytes[]): QuestDocument {
  const qst = files.find((f) => /\.qst$/i.test(f.name));
  if (qst) {
    const parsed = parseQst(qst.bytes);
    return QuestDocument.fromQuest(parsed.bin, parsed.dat, stemOf(qst.name) || parsed.name);
  }
  const bin = files.find((f) => /\.bin$/i.test(f.name));
  const dat = files.find((f) => /\.dat$/i.test(f.name));
  if (!bin) throw new Error('Choose a .qst file, or a .bin together with its .dat.');
  return questFromBytes(bin.bytes, dat?.bytes ?? null, stemOf(bin.name));
}

export interface QuestPackage {
  name: string; // the quest's name (header)
  stem: string; // file name without extension
  qst: Uint8Array; // BB .qst
  bin: Uint8Array; // PRS-compressed, as the server stores them
  dat: Uint8Array;
  binRaw: Uint8Array; // decompressed
  datRaw: Uint8Array;
}

export function buildPackage(doc: QuestDocument): QuestPackage {
  const stem = doc.fileName || 'quest';
  const binRaw = serializeQuestBin(doc.toQuestBin());
  const datRaw = serializeQuestDat(doc.toQuestDat());
  const name = doc.header.name || stem;
  return {
    name,
    stem,
    qst: packQst(doc.toQuestBin(), doc.toQuestDat(), { name }),
    bin: prsCompressOptimal(binRaw),
    dat: prsCompressOptimal(datRaw),
    binRaw,
    datRaw,
  };
}

export const disassemble = (doc: QuestDocument): string => disassembleQuest(doc.bin);

export const scriptHost = {
  disassemble: disassembleQuest,
  assemble: (text: string, header: Partial<EditableHeader>) => assembleQuest(text, header),
};
