// The write side of the quest formats: PRS compressor, .bin / .dat writers,
// .qst packer / parser, and the script assembler / disassembler.
//
// Over every Blue Burst quest newserv ships (system/quests/**/q*-bb-*.bin):
//   * parse -> serialize reproduces the decompressed .bin and .dat byte for byte
//   * disassemble -> assemble -> serialize reproduces the .bin byte for byte
//   * packQst -> parseQst gives the same decompressed files back
// With the newserv binary (vendor/newserv/build/newserv) it also checks that
// newserv decodes our .qst, decompresses our PRS, and disassembles a
// re-assembled .bin to the same text as the original.
//
// Run: node tests/questwrite.test.ts
// Env: NEWSERV (newserv checkout; default: vendor/newserv next to the main checkout).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { prsCompress } from '../client/src/formats/prscompress.ts';
import { parseQuestBin } from '../client/src/formats/questbin.ts';
import { parseQuestDat } from '../client/src/formats/questdat.ts';
import { QUEST_OPCODES, questOpcode, questOpcodeByName } from '../client/src/formats/questopcodes.ts';
import { assembleQuest, disassembleQuest, QuestAssemblyError } from '../client/src/formats/questasm.ts';
import { decodeTypedData, encodeTypedData, typedLayout, type FieldValue, type TypedRecord } from '../client/src/formats/questdata.ts';
import { buildQuestDat, serializeQuestBin, serializeQuestDat, setQuestDatChunk } from '../client/src/formats/questwrite.ts';
import { packQst, parseQst, parseQstFiles } from '../client/src/formats/qst.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_ROOT = (() => {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim();
    return dirname(common);
  } catch {
    return join(HERE, '..');
  }
})();
const NEWSERV = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(MAIN_ROOT, 'vendor/newserv')].find((d) => d && existsSync(join(d, 'system/quests')));
if (!NEWSERV) {
  console.log('SKIP no newserv checkout with system/quests (set NEWSERV)');
  process.exit(0);
}
const NEWSERV_BIN = existsSync(join(NEWSERV, 'build/newserv')) ? join(NEWSERV, 'build/newserv') : null;

let failures = 0;
const fail = (msg: string) => {
  failures++;
  if (failures <= 40) console.log(`FAIL ${msg}`);
};
const check = (cond: boolean, msg: string) => cond || fail(msg);
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const firstDiff = (a: Uint8Array, b: Uint8Array): string => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return `first difference at 0x${i.toString(16)} (${a[i]} vs ${b[i]}), sizes ${a.length} / ${b.length}`;
  return `sizes ${a.length} / ${b.length}`;
};

// --- PRS ---------------------------------------------------------------------
{
  const rng = (() => {
    let s = 12345;
    return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x100000000;
  })();
  const cases: Record<string, Uint8Array> = {
    empty: new Uint8Array(0),
    one: Uint8Array.of(7),
    zeros: new Uint8Array(100000),
    random: Uint8Array.from({ length: 5000 }, () => (rng() * 256) | 0),
    text: new TextEncoder().encode('the quick brown fox jumps over the lazy dog. '.repeat(500)),
    mixed: Uint8Array.from({ length: 70000 }, (_, i) => (i % 97 < 60 ? (i * 7) & 0xff : (rng() * 8) | 0)),
    pairs: Uint8Array.from({ length: 4000 }, (_, i) => (i % 5 === 0 ? 0xaa : (rng() * 256) | 0)),
    far: (() => {
      const a = new Uint8Array(30000);
      for (let i = 0; i < 4000; i++) a[i] = (rng() * 256) | 0;
      a.copyWithin(8100, 0, 3000); // a match near the maximum distance
      a.copyWithin(20000, 8100 - 8191 + 8100 > 0 ? 100 : 0, 2000);
      return a;
    })(),
  };
  for (const [name, data] of Object.entries(cases)) {
    const packed = prsCompress(data);
    check(same(prsDecompress(packed), data), `prs ${name}: round trip failed`);
  }
  const text = prsCompress(cases.text);
  check(text.length < cases.text.length / 20, `prs: repeated text only compressed to ${text.length} of ${cases.text.length}`);
  check(prsCompress(cases.zeros).length < 2000, `prs: 100000 zeros compressed to ${prsCompress(cases.zeros).length}`);
}

// --- Collect the BB quests -----------------------------------------------------
interface QuestFiles { label: string; stem: string; bin: string; dat: string | null }
const quests: QuestFiles[] = [];
const root = join(NEWSERV, 'system/quests');
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const files = readdirSync(join(root, dir.name));
  for (const f of files) {
    const m = /^(.+)-bb-([a-z])\.bin$/.exec(f);
    if (!m) continue;
    const dat = `${m[1]}-bb.dat`;
    quests.push({ label: `${dir.name}/${f}`, stem: m[1], bin: join(root, dir.name, f), dat: files.includes(dat) ? join(root, dir.name, dat) : null });
  }
}
quests.sort((a, b) => a.label.localeCompare(b.label));
console.log(`${quests.length} Blue Burst quest files in ${root}`);
check(quests.length > 100, `expected over 100 BB quest files, found ${quests.length}`);

// The opcode names must be unique so the disassembler's output assembles back.
for (const d of QUEST_OPCODES) check(questOpcodeByName(d.name) === d, `opcode name ${d.name} resolves to another opcode`);

const load = (path: string): Uint8Array => prsDecompress(new Uint8Array(readFileSync(path)));
const tmp = mkdtempSync(join(tmpdir(), 'questwrite-'));
let binExact = 0;
let datExact = 0;
let asmExact = 0;
let qstExact = 0;
let ratioSum = 0;
let ratioN = 0;
let dataSections = 0;
let typedSections = 0;
let totalLines = 0;
const newservSample = quests.filter((_, i) => i % 12 === 0);

try {
  for (const q of quests) {
    const raw = new Uint8Array(readFileSync(q.bin));
    const bytes = prsDecompress(raw);
    const bin = parseQuestBin(bytes);

    // .bin writer
    const written = serializeQuestBin(bin);
    if (same(written, bytes)) binExact++;
    else fail(`${q.label}: serializeQuestBin differs: ${firstDiff(written, bytes)}`);

    // PRS on the real data, and the ratio against the shipped compression.
    const packed = prsCompress(bytes);
    check(same(prsDecompress(packed), bytes), `${q.label}: PRS round trip`);
    ratioSum += packed.length / raw.length;
    ratioN++;

    // assembler / disassembler
    let text = '';
    try {
      text = disassembleQuest(bin);
      totalLines += text.split('\n').length;
      dataSections += (text.match(/^ {2}\.data /gm) ?? []).length;
      typedSections += (text.match(/^ {2}\.(struct|cstr) /gm) ?? []).length;
      const again = assembleQuest(text);
      const out = serializeQuestBin(again);
      if (same(out, bytes)) asmExact++;
      else fail(`${q.label}: disassemble -> assemble differs: ${firstDiff(out, bytes)}`);
      // The text is a fixed point.
      check(disassembleQuest(again) === text, `${q.label}: disassembly of the re-assembled quest differs from the first disassembly`);
    } catch (err) {
      fail(`${q.label}: asm round trip threw: ${(err as Error).message}`);
    }

    if (!q.dat) continue;
    const datBytes = load(q.dat);
    const dat = parseQuestDat(datBytes);
    const datOut = serializeQuestDat(dat);
    if (same(datOut, datBytes)) datExact++;
    else fail(`${q.label}: serializeQuestDat differs: ${firstDiff(datOut, datBytes)}`);

    // .qst
    const qst = packQst(bin, dat, { filename: q.stem.slice(0, 12) });
    check(qst.length % 8 === 0, `${q.label}: qst length ${qst.length} is not 8-aligned`);
    const back = parseQst(qst);
    if (same(serializeQuestBin(back.bin), bytes) && same(serializeQuestDat(back.dat), datBytes) && back.name === (/^[\x20-\x7e]+$/.test(bin.header.name) ? bin.header.name.slice(0, 19) : q.stem.slice(0, 12))) qstExact++;
    else fail(`${q.label}: packQst -> parseQst differs (name "${back.name}")`);
  }

  // --- newserv cross-checks ----------------------------------------------------
  if (NEWSERV_BIN) {
    let newservChecked = 0;
    for (const q of newservSample) {
      if (!q.dat) continue;
      const bytes = load(q.bin);
      const bin = parseQuestBin(bytes);
      const dat = parseQuestDat(load(q.dat));
      const qstPath = join(tmp, `${q.stem}.qst`);
      writeFileSync(qstPath, packQst(bin, dat, { filename: q.stem.slice(0, 12) }));
      try {
        execFileSync(NEWSERV_BIN, ['decode-qst', qstPath], { cwd: NEWSERV, encoding: 'utf8', stdio: 'pipe' });
        const stem = q.stem.slice(0, 12);
        const nBin = new Uint8Array(readFileSync(`${qstPath}-${stem}.bin`));
        const nDat = new Uint8Array(readFileSync(`${qstPath}-${stem}.dat`));
        check(same(prsDecompress(nBin), bytes), `${q.label}: newserv decode-qst .bin differs from ours`);
        check(same(prsDecompress(nDat), load(q.dat)), `${q.label}: newserv decode-qst .dat differs from ours`);
        // newserv decompresses our PRS the same way.
        const binPath = `${qstPath}-${stem}.bin`;
        const decPath = join(tmp, `${stem}.dec`);
        execFileSync(NEWSERV_BIN, ['decompress-prs', binPath, decPath], { cwd: NEWSERV, stdio: 'pipe' });
        check(same(new Uint8Array(readFileSync(decPath)), bytes), `${q.label}: newserv decompress-prs of our .bin differs`);
        // Same disassembly for the original and for the re-assembled script.
        const origText = execFileSync(NEWSERV_BIN, ['disassemble-quest-script', '--bb', q.bin, '-'], { cwd: NEWSERV, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 << 20 });
        const reText = execFileSync(NEWSERV_BIN, ['disassemble-quest-script', '--bb', binPath, '-'], { cwd: NEWSERV, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 << 20 });
        check(origText === reText, `${q.label}: newserv disassembles our packed .bin differently`);
        // And newserv's own assembler accepts a quest we assembled from text:
        // its disassembly of our assembled bin matches the original.
        const asmBin = serializeQuestBin(assembleQuest(disassembleQuest(bin)));
        const asmPath = join(tmp, `${stem}-asm.bin`);
        writeFileSync(asmPath, prsCompress(asmBin));
        const asmText = execFileSync(NEWSERV_BIN, ['disassemble-quest-script', '--bb', asmPath, '-'], { cwd: NEWSERV, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 << 20 });
        check(origText === asmText, `${q.label}: newserv disassembles our assembled .bin differently`);
        newservChecked++;
      } catch (err) {
        fail(`${q.label}: newserv check threw: ${((err as { stderr?: string }).stderr ?? (err as Error).message).toString().slice(0, 300)}`);
      }
    }
    console.log(`newserv cross-check: ${newservChecked} quests`);
    check(newservChecked > 10, 'newserv cross-check ran on too few quests');
  } else {
    console.log('newserv binary not built: skipping the newserv cross-checks');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const withDat = quests.filter((q) => q.dat).length;
console.log(`.bin exact ${binExact}/${quests.length}, asm exact ${asmExact}/${quests.length}, .dat exact ${datExact}/${withDat}, qst ${qstExact}/${withDat}`);
console.log(`PRS: our output is ${(ratioSum / ratioN * 100).toFixed(1)}% of the shipped size on average; ${dataSections} .data lines and ${typedSections} typed labels (.struct / .cstr) in ${totalLines} lines of disassembly`);
check(binExact === quests.length, 'not every .bin round-trips');
check(asmExact === quests.length, 'not every .bin round-trips through the assembler');
check(datExact === withDat, 'not every .dat round-trips');
check(ratioSum / ratioN < 1.5, `PRS output averages ${(ratioSum / ratioN).toFixed(2)}x the shipped size`);

// --- BB download .qst (A6 / A7): the payload is plain PRS ----------------------
// Evidence (docs/QUESTFILES.md): PsoBB.exe's receive path decompresses A6 / A7 bytes
// without a decrypt, and newserv refuses to build a BB download .qst. So a BB A6 file
// holds the same PRS stream as a BB 44 file, with no PSO V2 header.
{
  const dlTmp = mkdtempSync(join(tmpdir(), 'bbdl-'));
  try {
    let dlExact = 0;
    for (const q of quests.filter((_, i) => i % 6 === 0)) {
      if (!q.dat) continue;
      const bin = parseQuestBin(load(q.bin));
      const dat = parseQuestDat(load(q.dat));
      const binSerialized = serializeQuestBin(bin);
      const datSerialized = serializeQuestDat(dat);
      const dl = packQst(bin, dat, { filename: q.stem.slice(0, 12), download: true });
      const dv = new DataView(dl.buffer, dl.byteOffset, dl.byteLength);
      check(dv.getUint16(0, true) === 0x58 && dv.getUint16(2, true) === 0xa6, `${q.label}: BB download .qst does not start with an A6 open`);
      check(dl.length % 8 === 0, `${q.label}: BB download .qst is not 8-aligned`);
      const parsed = parseQstFiles(dl);
      check(parsed.version === 'BB' && parsed.download === true, `${q.label}: BB download parsed as ${parsed.version}, download ${parsed.download}`);
      const binFile = parsed.files.find((f) => f.filename.endsWith('.bin'))!;
      const datFile = parsed.files.find((f) => f.filename.endsWith('.dat'))!;
      // The stored bytes are the PRS streams themselves (no DLQ header, no seed).
      check(binFile.seed === undefined && datFile.seed === undefined, `${q.label}: BB download file has a PSO V2 seed`);
      check(same(prsDecompress(binFile.compressed), binSerialized), `${q.label}: BB A6 .bin is not plain PRS of the .bin`);
      check(same(prsDecompress(datFile.compressed), datSerialized), `${q.label}: BB A6 .dat is not plain PRS of the .dat`);
      const back = parseQst(dl);
      if (back.download && same(serializeQuestBin(back.bin), binSerialized) && same(serializeQuestDat(back.dat), datSerialized)) dlExact++;
      else fail(`${q.label}: BB download packQst -> parseQst differs`);
    }
    check(dlExact > 10, `BB download round trip ran on too few quests (${dlExact})`);
    console.log(`BB download .qst: ${dlExact} quests round-trip as plain PRS`);

    // newserv will not build one: this is the record of that refusal.
    if (NEWSERV_BIN) {
      const sample = quests.find((q) => q.dat);
      if (sample) {
        const binCopy = join(dlTmp, `${sample.stem}.bin`);
        // newserv reads its inputs as the PRS files they are on disk (load() decompresses).
        writeFileSync(binCopy, readFileSync(sample.bin));
        writeFileSync(join(dlTmp, `${sample.stem}.dat`), readFileSync(sample.dat!));
        const out = join(dlTmp, `${sample.stem}-dl.qst`);
        let refused = false;
        try {
          execFileSync(NEWSERV_BIN, ['encode-qst', binCopy, out, '--bb', '--download'], { cwd: NEWSERV, stdio: 'pipe' });
        } catch (err) {
          refused = String((err as { stderr?: Buffer }).stderr ?? '').includes('does not support download quests');
        }
        check(refused, 'newserv encode-qst --bb --download did not refuse (the BB download assumption may need a look)');

        // Cross-check: newserv's BB 44 / 13 .qst, with only the commands relabeled to A6 / A7
        // (the bytes of every file unchanged), parses here as a download whose files are
        // the same PRS streams newserv's own .qst carries.
        const onlinePath = join(dlTmp, `${sample.stem}-on.qst`);
        execFileSync(NEWSERV_BIN, ['encode-qst', binCopy, onlinePath, '--bb'], { cwd: NEWSERV, stdio: 'pipe' });
        const online = new Uint8Array(readFileSync(onlinePath));
        const relabeled = new Uint8Array(online);
        for (let at = 0; at + 8 <= relabeled.length; ) {
          const rdv = new DataView(relabeled.buffer);
          const size = rdv.getUint16(at, true);
          const cmd = rdv.getUint16(at + 2, true);
          if (cmd === 0x44) rdv.setUint16(at + 2, 0xa6, true);
          else if (cmd === 0x13) rdv.setUint16(at + 2, 0xa7, true);
          at += Math.max(size, 8);
          at = (at + 7) & ~7;
        }
        const asOnline = parseQstFiles(online);
        const asDownload = parseQstFiles(relabeled);
        check(!asOnline.download && asDownload.download, 'relabeled newserv .qst is not parsed as a download');
        check(asOnline.files.length === 2 && asDownload.files.length === 2, 'relabeled newserv .qst lost a file');
        for (let i = 0; i < 2; i++) {
          check(asDownload.files[i].filename === asOnline.files[i].filename && same(asDownload.files[i].compressed, asOnline.files[i].compressed), `BB relabeled A6 file ${i} differs from newserv's 44 file`);
        }
        console.log(`BB download cross-check: newserv's ${sample.stem} .qst relabeled to A6 / A7 parses to the same PRS files`);
      }
    }
  } finally {
    rmSync(dlTmp, { recursive: true, force: true });
  }
}

// --- Assembler behaviour -------------------------------------------------------
{
  const src = `
.version BB_V4
.quest_num 4242
.name "Test Quest"
.short_desc "short"
.long_desc "line one\\nline two \\u00e9"
.episode Episode2
.max_players 2
.joinable
.solo_unlock_flag 0x0102

start:
  leti  r60, 1
  set_floor_handler 0, loop_a   // auto arg_push form
  bb_map_designate 0, 0, 0, 0, 0
  bb_map_designate 1, 2, 0, 3, 4
  window_msg "hi \\"there\\""
  jmpi_eq r60, -1, loop_a
  ret
loop_a:
  addi r60, 1
  jmp_le r60, r61, loop_a
  switch_jmp r1, [loop_a, start]
  ret
  .data 0a 0b
`;
  const bin = assembleQuest(src);
  check(bin.header.name === 'Test Quest' && bin.header.questNumber === 4242 && bin.header.episode === 1 && bin.header.maxPlayers === 2 && bin.header.joinable, 'assembler header directives');
  check(bin.header.longDescription === 'line one\nline two \u00e9', 'assembler string escapes');
  check(bin.header.soloUnlockFlags.join() === '258', 'solo unlock flag');
  check(bin.header.floorAssignments.length === 2 && bin.header.floorAssignments[1].area === 2 && bin.header.floorAssignments[1].entitiesVar === 4, 'floor assignments derived from bb_map_designate');
  check(bin.labels.length === 2 && bin.labels[0] === bin.header.textOffset, 'label table');
  // named label got the lowest free number (1) and the F_ARGS opcode got 2 pushes
  const text = disassembleQuest(bin);
  check(/^label0001:/m.test(text) && /set_floor_handler\s+\/\/ 0x00000000, label0001/.test(text), 'named label numbering / arg stack annotation:\n' + text);
  check(same(serializeQuestBin(assembleQuest(text)), serializeQuestBin(bin)), 'small program round trip');
  // Overrides
  const o = assembleQuest(src, { name: 'Other', questNumber: 7, episode: 2, maxPlayers: 4 });
  check(o.header.name === 'Other' && o.header.questNumber === 7 && o.header.episode === 2 && o.header.maxPlayers === 4, 'header options override directives');
  // Errors
  const bad = (s: string, re: RegExp, what: string) => {
    try {
      assembleQuest(s);
      fail(`assembler accepted ${what}`);
    } catch (err) {
      check(err instanceof QuestAssemblyError && re.test((err as Error).message), `assembler error for ${what}: ${(err as Error).message}`);
    }
  };
  bad('start:\n  nope\n', /line 2: unknown opcode/, 'an unknown opcode');
  bad('start:\n  jmp label0005\n', /never defined/, 'an undefined label');
  bad('start:\n  leti r1\n', /takes 2/, 'a wrong argument count');
  bad('start:\n  letb r1, 300\n', /out of range/, 'an out-of-range immediate');
  bad('x:\n  ret\n', /label 0/, 'a missing start label');
  bad('start:\n  ret\nstart:\n  ret\n', /defined twice/, 'a duplicate label');
  bad('.name "' + 'x'.repeat(40) + '"\nstart:\n  ret\n', /characters/, 'a too long name');
}

// --- .dat helpers ------------------------------------------------------------------
{
  const dat = buildQuestDat([{ type: 1, floor: 0, data: new Uint8Array(0x44) }, { type: 2, floor: 0, data: new Uint8Array(0x48 * 2) }]);
  check(dat.floors.get(0)?.objects.length === 1 && dat.floors.get(0)?.enemies.length === 2, 'buildQuestDat floor view');
  const next = setQuestDatChunk(dat, 2, 0, new Uint8Array(0x48));
  check(next.floors.get(0)?.enemies.length === 1, 'setQuestDatChunk replace');
  const gone = setQuestDatChunk(next, 1, 0, new Uint8Array(0));
  check(gone.chunks.length === 1, 'setQuestDatChunk remove');
  check(questOpcode(0x01)?.name === 'ret', 'opcode table sanity');
}

// --- download quests (A6 / A7 .qst) -------------------------------------------
{
  const dq = quests.find((x) => x.dat);
  if (dq) {
    const bin = parseQuestBin(load(dq.bin));
    const dat = parseQuestDat(load(dq.dat!));
    const online = packQst(bin, dat, { filename: dq.stem.slice(0, 12) });
    const download = packQst(bin, dat, { filename: dq.stem.slice(0, 12), download: true });
    check(download.length === online.length, 'A6/A7 .qst has the same length as the 44/13 one');
    const dv = new DataView(download.buffer, download.byteOffset, download.byteLength);
    check(dv.getUint16(2, true) === 0xa6, 'download .qst opens with A6');
    check(new DataView(online.buffer, online.byteOffset, online.byteLength).getUint16(2, true) === 0x44, 'online .qst opens with 44');
    const back = parseQst(download);
    check(back.download, 'A6/A7 .qst parses with download set');
    check(!parseQst(online).download, '44/13 .qst parses without download');
    check(same(serializeQuestBin(back.bin), load(dq.bin)) && same(serializeQuestDat(back.dat), load(dq.dat!)), 'A6/A7 .qst round trips the quest');
    // A 44 open followed by A7 writes (or the reverse) is not a download .qst.
    const mixed = online.slice();
    new DataView(mixed.buffer).setUint16(2, 0xa6, true);
    let threw = false;
    try {
      parseQst(mixed);
    } catch {
      threw = true;
    }
    check(threw, 'a .qst that mixes 44 and A6 is rejected');
  }
}

// --- typed data labels ------------------------------------------------------
// A label that a code reference types (questopcodes.ts data types) is printed
// as `.struct` / `.cstr`, and re-assembles to the same bytes; a label that
// does not fit its type stays `.data` hex.
{
  let seed = 4242;
  const rnd = (n: number): Uint8Array =>
    Uint8Array.from({ length: n }, () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed >>> 24;
    });
  const dotData = (b: Uint8Array): string => `  .data ${[...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')}`;
  for (const kind of ['PLAYER_STATS', 'RESIST_DATA', 'ATTACK_DATA', 'MOVEMENT_DATA'] as const) {
    const size = typedLayout(kind).size;
    for (let k = 0; k < 50; k++) {
      const b = rnd(size);
      const rec = decodeTypedData(kind, b);
      check(rec !== null && same(encodeTypedData(kind, rec), b), `${kind}: random record does not re-encode`);
    }
    check(decodeTypedData(kind, rnd(size - 1)) === null, `${kind}: a short label is not decoded`);
  }
  // The visual config: a record with a guild card number and a name.
  const visual = decodeTypedData('PLAYER_VISUAL_CONFIG', new Uint8Array(0x70));
  check(visual !== null, 'a zero PLAYER_VISUAL_CONFIG decodes');
  const setField = (rec: TypedRecord, name: string, v: FieldValue): void => {
    const e = rec.find(([n]) => n === name);
    if (!e) throw new Error(`no field ${name}`);
    e[1] = v;
  };
  const vrec = visual![0];
  setField(vrec, 'guild_card_number', { text: '22000010' });
  setField(vrec, 'name', { text: 'Ann' });
  setField(vrec, 'name_color', { int: 0xffffffff });
  setField(vrec, 'proportion_x', { float: 0x3f800000 });
  const visualBytes = encodeTypedData('PLAYER_VISUAL_CONFIG', [vrec]);

  const script = [
    'start:',
    '  set_enemy_physical_data stats',
    '  set_enemy_attack_data attack',
    '  set_enemy_resist_data resist',
    '  set_enemy_movement_data move',
    '  prepare_npc_visual visual',
    '  set_enemy_physical_data short',
    '  npc_text_id r60, r61, greeting',
    '  npc_text_id r60, r61, junk',
    '  ret',
    'stats:',
    dotData(rnd(0x24)),
    'attack:',
    dotData(rnd(0x30)),
    'resist:',
    dotData(rnd(0x20)),
    'move:',
    dotData(rnd(0x30)),
    'visual:',
    dotData(visualBytes),
    'short:',
    dotData(rnd(0x20)),
    'greeting:',
    '  .cstr "Hi \\u3042!"',
    'junk:',
    '  .data 48 00 69 00 00 00 99',
    '',
  ].join('\n');
  const bin1 = assembleQuest(script);
  const text1 = disassembleQuest(bin1);
  for (const want of ['.struct PLAYER_STATS', '.struct ATTACK_DATA', '.struct RESIST_DATA', '.struct MOVEMENT_DATA', '.struct PLAYER_VISUAL_CONFIG', '  .field name "Ann"', '  .cstr "Hi ']) {
    check(text1.includes(want), `typed disassembly has ${want}`);
  }
  // Labels print under their numbers: the short PlayerStats (0x20 bytes) is the one with no .struct.
  check(text1.split('.struct PLAYER_STATS').length === 2, 'a PLAYER_STATS label of the wrong size stays .data');
  check(text1.includes('  .data 48 00 69 00 00 00 99'), 'a CSTRING label with trailing bytes stays .data');
  const out1 = serializeQuestBin(bin1);
  const bin2 = assembleQuest(text1);
  check(same(serializeQuestBin(bin2), out1), `typed labels re-assemble to the same bytes`);
  check(disassembleQuest(bin2) === text1, 'typed disassembly is a fixed point');

  // Assembler errors on the typed forms.
  const rejects = (src: string, what: string): void => {
    let threw = false;
    try {
      assembleQuest(src);
    } catch (err) {
      threw = err instanceof QuestAssemblyError;
    }
    check(threw, `${what} is rejected`);
  };
  rejects('start:\n  ret\nx:\n  .struct PLAYER_STATS\n  .field atp 1\n', 'a PLAYER_STATS with missing fields');
  rejects('start:\n  ret\nx:\n  .struct PLAYER_STATS\n  .field nope 1\n', 'a PLAYER_STATS with an unknown field');
  rejects('start:\n  ret\nx:\n  .struct PLAYER_STATS\n  .field atp 70000\n', 'a field value out of range');
  rejects('start:\n  ret\nx:\n  .struct NOPE\n', 'an unknown .struct kind');
  rejects('start:\n  ret\n  .field atp 1\n', 'a .field outside .struct');
  rejects('start:\n  ret\nx:\n  .struct VECTOR4F_LIST\n  .vector 1 2 3\n', 'a .vector with three values');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('OK');
