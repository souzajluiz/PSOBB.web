// IMAGE_DATA labels (PRS-compressed images, newserv DataType::IMAGE_DATA, the
// call_image_data opcode 0xF8EE): a label that a code reference types as an
// image is printed decompressed, as `.struct IMAGE_DATA` with `.data` hex lines,
// and the assembler compresses it back with prsCompressOptimal. The printed form
// is used only when that compressor reproduces the label's bytes; otherwise the
// label stays `.data` hex. Synthetic data only (no Sega files).
//
// Run: node tests/questimage.test.ts
import { prsDecompress } from '../client/src/formats/prs.ts';
import { prsCompressOptimal } from '../client/src/formats/prscompress.ts';
import { assembleQuest, disassembleQuest, QuestAssemblyError } from '../client/src/formats/questasm.ts';
import { parseQuestBin } from '../client/src/formats/questbin.ts';
import { serializeQuestBin } from '../client/src/formats/questwrite.ts';

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`FAIL ${msg}`);
};
const check = (cond: boolean, msg: string) => cond || fail(msg);
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

// A synthetic image: a seeded noise run, a repeated tile (so the PRS stream has
// long copies), and a flat run.
function makeImage(seed: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let s = seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s >>> 24;
  };
  const tile = Uint8Array.from({ length: 48 }, next);
  for (let i = 0; i < size; i++) {
    if (i < size / 3) out[i] = next();
    else if (i < (2 * size) / 3) out[i] = tile[i % tile.length];
    else out[i] = 0x7f;
  }
  return out;
}

const dotData = (b: Uint8Array): string => `  .data ${[...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')}`;
// The disassembly prints hex in capitals.
const printed = (b: Uint8Array): string => dotData(b).trim().toUpperCase();

// --- a typed image label -----------------------------------------------------
{
  const image = makeImage(0x5eed, 0x1800);
  const packed = prsCompressOptimal(image);
  check(same(prsDecompress(packed), image), 'synthetic image: PRS round trip');
  check(packed.length < image.length, 'synthetic image compresses');

  const script = [
    'start:',
    '  leti r60, 1',
    '  call_image_data 0, picture',
    '  ret',
    'picture:',
    dotData(packed),
    'after:',
    '  .cstr "tail"',
    '',
  ].join('\n');
  const bin1 = assembleQuest(script);
  const out1 = serializeQuestBin(bin1);
  const text1 = disassembleQuest(bin1);
  check(text1.includes('  .struct IMAGE_DATA'), 'an IMAGE_DATA label prints as .struct IMAGE_DATA');
  check(!text1.toUpperCase().includes(printed(packed)), 'the compressed bytes are not printed');
  check(text1.toUpperCase().includes(printed(image.subarray(0, 32))), 'the decompressed image is printed');
  const bin2 = assembleQuest(text1);
  check(same(serializeQuestBin(bin2), out1), 'IMAGE_DATA label re-assembles to the same bytes');
  check(disassembleQuest(bin2) === text1, 'IMAGE_DATA disassembly is a fixed point');

  // The parsed .bin path (the bytes a server or the editor reads) gives the same text.
  const parsed = parseQuestBin(out1);
  check(disassembleQuest(parsed) === text1, 'disassembly of a parsed .bin matches');
  check(same(serializeQuestBin(assembleQuest(disassembleQuest(parsed))), out1), 'parsed .bin round trip');

  // An empty image: the compressed stream is only the end marker.
  const emptyScript = ['start:', '  call_image_data 0, e', '  ret', 'e:', dotData(prsCompressOptimal(new Uint8Array(0))), ''].join('\n');
  const emptyBin = assembleQuest(emptyScript);
  const emptyText = disassembleQuest(emptyBin);
  check(emptyText.includes('.struct IMAGE_DATA'), 'an empty image prints as .struct IMAGE_DATA');
  check(same(serializeQuestBin(assembleQuest(emptyText)), serializeQuestBin(emptyBin)), 'an empty image round trip');
}

// --- a label that does not re-compress to its bytes stays hex ------------------
{
  const image = makeImage(0x1234, 0x900);
  const packed = prsCompressOptimal(image);
  const withTail = new Uint8Array([...packed, 0x00, 0x11]); // bytes after the end marker
  const script = ['start:', '  call_image_data 0, p', '  ret', 'p:', dotData(withTail), ''].join('\n');
  const bin = assembleQuest(script);
  const text = disassembleQuest(bin);
  // The label's section can run past the stream (newserv: "Extra data after compressed data").
  check(text.includes('.struct IMAGE_DATA') && text.includes('  .extra\n'), 'an image with trailing bytes prints .extra');
  check(text.toUpperCase().includes(dotData(new Uint8Array([0x00, 0x11])).trim().toUpperCase()), 'the trailing bytes print after .extra');
  check(disassembleQuest(assembleQuest(text)) === text, 'trailing-bytes image disassembly is a fixed point');
  check(same(serializeQuestBin(assembleQuest(text)), serializeQuestBin(bin)), 'trailing-bytes image round trip');

  const junk = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff);
  const junkScript = ['start:', '  call_image_data 0, j', '  ret', 'j:', dotData(junk), ''].join('\n');
  const junkBin = assembleQuest(junkScript);
  const junkText = disassembleQuest(junkBin);
  check(!junkText.includes('.struct IMAGE_DATA'), 'a non-PRS label stays .data');
  check(same(serializeQuestBin(assembleQuest(junkText)), serializeQuestBin(junkBin)), 'non-PRS label round trip');
}

// --- assembler errors on .struct IMAGE_DATA ------------------------------------
{
  const rejects = (src: string, what: string): void => {
    let threw = false;
    try {
      assembleQuest(src);
    } catch (err) {
      threw = err instanceof QuestAssemblyError;
    }
    check(threw, `${what} is rejected`);
  };
  rejects('start:\n  ret\nx:\n  .struct IMAGE_DATA\n  .data 0g\n', 'an IMAGE_DATA with non-hex bytes');
  rejects('start:\n  ret\nx:\n  .struct IMAGE_DATA\n  .field atp 1\n', 'an IMAGE_DATA with a .field line');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('questimage: all checks passed');
