// Non-BB .qst files (formats/qst.ts): the DC / PC / GC open-file and write-file
// commands, online (44 / 13) and download (A6 / A7, PSO V2 payload).
//
// The layout is newserv's: encode_qst_file, add_open_file_command_t and
// add_write_file_commands_t (src/Quest.cc) with S_OpenFile_DC_44_A6,
// S_OpenFile_PC_GC_44_A6, S_WriteFile_13_A7 (src/CommandFormats.hh) and the
// command headers of src/PSOProtocol.hh. The layout checks below read the bytes
// at those offsets, not our own writer's view of them.
//
// With the newserv binary (vendor/newserv/build/newserv; NEWSERV overrides the
// checkout) it also checks:
//   * our parse of newserv's encode-qst output (DC v2, PC, GC; online and download)
//     and our re-pack of the same compressed streams and seeds give its bytes;
//   * newserv's decode-qst reads our download .qst and returns our files.
//
// Run: node tests/qstnonbb.test.ts
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { prsCompress } from '../client/src/formats/prscompress.ts';
import { decodeDownloadQuestData, DLQ_HEADER_SIZE, psoV2Crypt } from '../client/src/formats/psov2.ts';
import { packQst, packQstFiles, parseQstFiles, qstVersion, withBinLanguage, type QstVersion } from '../client/src/formats/qst.ts';

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
const NEWSERV_BIN = NEWSERV && existsSync(join(NEWSERV, 'build/newserv')) ? join(NEWSERV, 'build/newserv') : null;

let failures = 0;
const fail = (msg: string) => {
  failures++;
  if (failures <= 40) console.log(`FAIL ${msg}`);
};
const check = (cond: boolean, msg: string) => cond || fail(msg);
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const u16 = (d: Uint8Array, at: number): number => d[at]! | (d[at + 1]! << 8);
const u32 = (d: Uint8Array, at: number): number => (d[at]! | (d[at + 1]! << 8) | (d[at + 2]! << 16) | (d[at + 3]! << 24)) >>> 0;
const cstr = (d: Uint8Array, at: number, max: number): string => {
  let s = '';
  for (let i = 0; i < max && d[at + i]; i++) s += String.fromCharCode(d[at + i]!);
  return s;
};

const rng = (() => {
  let s = 13572468;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x100000000;
})();
// Compressible synthetic data (word runs with some noise), so PRS does real work.
const synthetic = (n: number): Uint8Array => {
  const words = ['quest', 'floor', 'enemy', 'boss', 'area', '\x00\x01\x02', 'PSO'];
  const out = new Uint8Array(n);
  let at = 0;
  while (at < n) {
    const w = words[(rng() * words.length) | 0]!;
    for (let i = 0; i < w.length && at < n; i++) out[at++] = w.charCodeAt(i);
    if (at < n && rng() < 0.2) out[at++] = (rng() * 256) | 0;
  }
  return out;
};
// File sizes of the 0x400-byte chunks, in order.
const chunkLengths = (n: number): number[] => {
  const out: number[] = [];
  for (let z = 0; z < n; z += 0x400) out.push(Math.min(0x400, n - z));
  return out;
};
const u32le = (v: number): Uint8Array => Uint8Array.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const VERSIONS: QstVersion[] = ['DC', 'PC', 'GC', 'BB'];

// 1. Layout against newserv's structs.
for (const version of VERSIONS) {
  for (const download of [false, true]) {
    const tag = `${version} ${download ? 'download' : 'online'}`;
    const bin = prsCompress(synthetic(0x1234));
    const dat = prsCompress(synthetic(0x0c00));
    const seeds = { bin: 0x11223344, dat: 0x55667788 };
    const bytes = packQstFiles(
      [
        { filename: 'q9.bin', data: bin, seed: seeds.bin },
        { filename: 'q9.dat', data: dat, seed: seeds.dat },
      ],
      'Test',
      download,
      version,
    );

    const nonBB = version !== 'BB';
    const headerSize = nonBB ? 4 : 8;
    const openTotal = headerSize + (nonBB ? 0x38 : 0x50);
    const nameAt = nonBB ? 0 : 0x38;
    const filenameAt = version === 'DC' ? 0x23 : 0x24;
    const writeTotal = headerSize + 0x414 + (nonBB ? 0 : 4); // BB pads each write to 8 bytes
    const cmdOpen = download ? 0xa6 : 0x44;
    const cmdWrite = download ? 0xa7 : 0x13;
    // On a download .qst each stored file is the 8-byte payload header and the stream.
    const dlq = download && nonBB; // the payload is only PSO V2 encrypted off BB
    const storedBin = dlq ? DLQ_HEADER_SIZE + bin.length : bin.length;
    const storedDat = dlq ? DLQ_HEADER_SIZE + dat.length : dat.length;

    // Two open file commands, then the write commands.
    for (let i = 0; i < 2; i++) {
      const at = i * openTotal;
      if (version === 'PC') {
        check(u16(bytes, at) === openTotal && bytes[at + 2] === cmdOpen && bytes[at + 3] === 0, `${tag}: PC open header ${i}`);
      } else if (version === 'BB') {
        check(u16(bytes, at) === 0x58 && u16(bytes, at + 2) === cmdOpen && u32(bytes, at + 4) === 0, `${tag}: BB open header ${i}`);
      } else {
        check(bytes[at] === cmdOpen && bytes[at + 1] === 0 && u16(bytes, at + 2) === openTotal, `${tag}: ${version} open header ${i}`);
      }
      check(cstr(bytes, at + headerSize + nameAt, nonBB ? 0x22 : 0x18) === 'PSO/Test', `${tag}: name ${i}`);
      check(cstr(bytes, at + headerSize + filenameAt, 0x10) === (i ? 'q9.dat' : 'q9.bin'), `${tag}: file name ${i}`);
      check(u32(bytes, at + headerSize + 0x34) === (i ? storedDat : storedBin), `${tag}: file size ${i}`);
    }

    // Write commands: size, command, flag (chunk index within its file), data size.
    const expected = [...chunkLengths(storedBin), ...chunkLengths(storedDat)];
    let at = 2 * openTotal;
    const flags: number[] = [];
    expected.forEach((len, k) => {
      let size: number;
      let command: number;
      let flag: number;
      if (version === 'PC') {
        size = u16(bytes, at);
        command = bytes[at + 2]!;
        flag = bytes[at + 3]!;
      } else if (version === 'BB') {
        size = u16(bytes, at);
        command = u16(bytes, at + 2);
        flag = u32(bytes, at + 4);
      } else {
        command = bytes[at]!;
        flag = bytes[at + 1]!;
        size = u16(bytes, at + 2);
      }
      flags.push(flag);
      check(command === cmdWrite && size === headerSize + 0x414, `${tag}: write ${k} header (size ${size.toString(16)}, command ${command.toString(16)})`);
      check(u32(bytes, at + headerSize + 0x410) === len, `${tag}: write ${k} data size`);
      at += writeTotal;
    });
    check(at === bytes.length, `${tag}: commands end at ${at}, file is ${bytes.length}`);
    const wantFlags = [...expected.map((_, k) => k).filter((k) => k < chunkLengths(storedBin).length), ...chunkLengths(storedDat).map((_, i) => i)];
    check(flags.join(',') === wantFlags.join(','), `${tag}: chunk flags ${flags} want ${wantFlags}`);

    // The download payload: u32 decompressed size, u32 seed, then the stream under PSO V2.
    if (download && nonBB) {
      // The bin's chunks are the first ones; gather their data into the stored payload.
      const parts: Uint8Array[] = [];
      let w = 2 * openTotal;
      for (const len of chunkLengths(storedBin)) {
        parts.push(bytes.subarray(w + headerSize + 0x10, w + headerSize + 0x10 + len));
        w += writeTotal;
      }
      const stored = concat(...parts);
      check(u32(stored, 0) === prsDecompress(bin).length, `${tag}: DLQ decompressed size`);
      check(u32(stored, 4) === seeds.bin, `${tag}: DLQ seed`);
      check(same(decodeDownloadQuestData(stored).compressed, bin), `${tag}: DLQ payload decodes to the PRS stream`);
      check(same(psoV2Crypt(bin, seeds.bin), stored.subarray(DLQ_HEADER_SIZE)), `${tag}: payload is PSO V2 of the PRS stream`);
    }

    // Parse back: version, name, download flag, streams, seeds, decompressed data.
    const back = parseQstFiles(bytes);
    check(back.version === version, `${tag}: parsed version ${back.version}`);
    check(back.download === download, `${tag}: parsed download flag`);
    check(back.name === 'Test', `${tag}: parsed name "${back.name}"`);
    check(back.files.map((f) => f.filename).join(',') === 'q9.bin,q9.dat', `${tag}: file order`);
    check(same(back.files[0]!.compressed, bin) && same(back.files[1]!.compressed, dat), `${tag}: PRS streams round trip`);
    check(same(back.files[0]!.data, prsDecompress(bin)) && same(back.files[1]!.data, prsDecompress(dat)), `${tag}: decompressed files round trip`);
    if (dlq) check(back.files[0]!.seed === seeds.bin && back.files[1]!.seed === seeds.dat, `${tag}: seeds round trip`);
    else check(back.files.every((f) => f.seed === undefined), `${tag}: no seed on an online file`);
  }
}

// 2. Version from the first command; XB refused; a download needs seeds.
{
  const files = (n: number) => [
    { filename: 'a.bin', data: prsCompress(synthetic(n)) },
    { filename: 'a.dat', data: prsCompress(synthetic(n)) },
  ];
  check(qstVersion(packQstFiles(files(64), 'x', false, 'DC')) === 'DC', 'DC detected from its open file');
  check(qstVersion(packQstFiles(files(64), 'x', false, 'GC')) === 'GC', 'GC detected (type field 0)');
  check(qstVersion(packQstFiles(files(64), 'x', false, 'PC')) === 'PC', 'PC detected');
  check(qstVersion(packQstFiles(files(64), 'x', false, 'BB')) === 'BB', 'BB detected');
  let xbMsg = '';
  try {
    qstVersion(Uint8Array.from([0x44, 0, 0x54, 0, 0, 0, 0, 0]));
  } catch (e) {
    xbMsg = (e as Error).message;
  }
  check(/XB/.test(xbMsg), `XB refused (${xbMsg})`);
  let needsSeed = false;
  try {
    packQstFiles([{ filename: 'a.bin', data: prsCompress(synthetic(8)) }], 'x', true, 'PC');
  } catch (e) {
    needsSeed = e instanceof RangeError;
  }
  check(needsSeed, 'a PC download without a seed throws');
  let badSeed = false;
  try {
    packQstFiles([{ filename: 'a.bin', data: prsCompress(synthetic(8)), seed: 0 }], 'x', true, 'DC');
  } catch {
    badSeed = true;
  }
  check(badSeed, 'seed 0 is refused in a download .qst');
}

// 3. A 44 open with an A7 write is rejected on the non-BB layouts too.
{
  const online = packQstFiles(
    [
      { filename: 'a.bin', data: prsCompress(synthetic(64)) },
      { filename: 'a.dat', data: prsCompress(synthetic(64)) },
    ],
    'x',
    false,
    'PC',
  );
  const mixed = online.slice();
  const firstWrite = 2 * (4 + 0x38);
  check(mixed[firstWrite + 2] === 0x13, 'first write is 13 on PC');
  mixed[firstWrite + 2] = 0xa7;
  let threw = false;
  try {
    parseQstFiles(mixed);
  } catch {
    threw = true;
  }
  check(threw, 'a PC .qst that mixes 44 and A7 is rejected');
}

// 4. packQst: a download for a non-BB version needs seeds; the name must fit.
{
  let needsSeeds = false;
  try {
    packQst({ header: { questNumber: 1, name: 'x' } } as never, {} as never, { version: 'GC', download: true, filename: 'q1' });
  } catch (e) {
    needsSeeds = e instanceof RangeError && /seeds/.test((e as Error).message);
  }
  check(needsSeeds, 'packQst: a GC download without seeds throws');
  let tooLong = false;
  try {
    packQst({ header: { questNumber: 1, name: 'x' } } as never, {} as never, { version: 'PC', filename: 'abcdefghijkl' });
  } catch (e) {
    tooLong = /does not fit/.test((e as Error).message);
  }
  check(tooLong, 'packQst: a 12-character base does not fit the PC name field with ".bin"');
}

// 4b. The download .bin language override (newserv create_download_quest): byte 0x10
// of the decompressed .bin on DC v1/v2, PC and GC; nothing else changes. 0xFF is a
// no-op, BB has no field.
{
  const gcBinPath = NEWSERV ? join(NEWSERV, 'system/quests/events/q146-gc-e.bin') : null;
  if (gcBinPath && existsSync(gcBinPath)) {
    const prsBin = new Uint8Array(readFileSync(gcBinPath));
    const orig = prsDecompress(prsBin);
    for (const [version, lang] of [['GC', 3], ['PC', 0], ['DC', 7]] as const) {
      const out = withBinLanguage(prsBin, version, lang);
      const got = prsDecompress(out);
      check(got[0x10] === lang, `${version} language override: byte 0x10 is ${got[0x10]}, not ${lang}`);
      const expect = Uint8Array.from(orig);
      expect[0x10] = lang;
      check(same(got, expect), `${version} language override changed bytes other than 0x10`);
    }
    check(same(withBinLanguage(prsBin, 'GC', 0xff), prsBin), 'language 0xFF is not a no-op');
    let refused = false;
    try {
      withBinLanguage(prsBin, 'BB', 1);
    } catch (e) {
      refused = e instanceof RangeError;
    }
    check(refused, 'a BB .bin takes no language override');
  } else {
    console.log('SKIP language override check (no newserv GC quest)');
  }
}

// 5. newserv's own encode-qst and decode-qst.
if (NEWSERV && NEWSERV_BIN) {
  const work = mkdtempSync(join(tmpdir(), 'qstnonbb-'));
  const quests = join(NEWSERV, 'system/quests/download');
  const samples: [QstVersion, string, string, string][] = [
    ['DC', '--dc-v2', 'q052-dc-e.bin', 'q052-dc.dat'],
    ['PC', '--pc', 'q052-pc-e.bin', 'q052-pc.dat'],
    ['GC', '--gc', 'q072-gc-e.bin', 'q072-gc.dat'],
  ];
  const ns = (...args: string[]): void => {
    execFileSync(NEWSERV_BIN, args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
  };
  try {
    for (const [version, flag, binName, datName] of samples) {
      const stem = `s-${version.toLowerCase()}`;
      const binPath = join(work, `${stem}.bin`);
      copyFileSync(join(quests, binName), binPath);
      copyFileSync(join(quests, datName), join(work, `${stem}.dat`));
      for (const download of [false, true]) {
        const tag = `newserv ${version} ${download ? 'download' : 'online'}`;
        const out = join(work, `${stem}-${download ? 'dl' : 'on'}.qst`);
        ns('encode-qst', binPath, out, ...(download ? ['--download'] : []), flag);
        const theirs = new Uint8Array(readFileSync(out));
        const parsed = parseQstFiles(theirs);
        check(parsed.version === version && parsed.download === download, `${tag}: parsed as ${parsed.version}, download ${parsed.download}`);
        const ours = packQstFiles(
          parsed.files.map((f) => ({ filename: f.filename, data: f.compressed, seed: f.seed })),
          parsed.name,
          download,
          version,
        );
        check(same(ours, theirs), `${tag}: our re-pack differs from newserv's file (${ours.length} vs ${theirs.length} bytes)`);
      }
      // newserv's decode-qst reads our download .qst and gives back our files.
      const ourFiles = [
        { filename: `${stem}.bin`, data: prsCompress(prsDecompress(new Uint8Array(readFileSync(binPath)))), seed: 0x0badf00d },
        { filename: `${stem}.dat`, data: prsCompress(prsDecompress(new Uint8Array(readFileSync(join(work, `${stem}.dat`))))), seed: 0x1badcafe },
      ];
      const ourQst = join(work, `${stem}-ours.qst`);
      writeFileSync(ourQst, packQstFiles(ourFiles, 'Cross', true, version));
      ns('decode-qst', ourQst);
      for (const f of ourFiles) {
        const decodedPath = `${ourQst}-${f.filename}`;
        const source = join(work, f.filename);
        check(existsSync(decodedPath), `newserv decode-qst wrote ${f.filename} for ${version}`);
        if (existsSync(decodedPath)) {
          const back = prsDecompress(new Uint8Array(readFileSync(decodedPath)));
          check(same(back, prsDecompress(new Uint8Array(readFileSync(source)))), `newserv decodes our ${version} download ${f.filename} to the quest file`);
        }
      }
    }
  } catch (e) {
    fail(`newserv cross-check: ${(e as Error).message}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log('newserv cross-check: DC / PC / GC, online and download');
} else {
  console.log('SKIP newserv cross-check (no newserv build with system/quests)');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('OK');
